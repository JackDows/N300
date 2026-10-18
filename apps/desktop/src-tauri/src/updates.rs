use crate::Desktop;
use deskhub_backend::{
    downloads::{checked_url, update_error, Artifact, UpdateConfig},
    error::{self, Error, Result},
    storage::atomic_json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const METHODS: &[&str] = &[
    "app.updates.info",
    "app.updates.check",
    "app.updates.download",
    "app.updates.install",
];
#[derive(Default)]
pub struct Updates {
    checking: AtomicBool,
    candidate: Mutex<Option<Update>>,
    downloads: Mutex<BTreeMap<String, Update>>,
    last_result: Mutex<Value>,
}
struct CheckGuard<'a>(&'a AtomicBool);
impl Drop for CheckGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallRecord {
    version: String,
    job_id: String,
    connected_devices: Vec<String>,
    temp_root: PathBuf,
    before: Vec<PathBuf>,
    directories: Vec<PathBuf>,
}
fn marker(app: &AppHandle) -> Result<PathBuf> {
    let info = app
        .state::<Desktop>()
        .hub
        .dispatch("hub.describe", json!({}), Value::Null)?;
    Ok(PathBuf::from(info["dataDirectory"].as_str().unwrap()).join("updates/app-install.json"))
}
fn installer_dirs(root: &Path, version: &str) -> BTreeSet<PathBuf> {
    let prefix = format!("DeskHub-{version}-updater-");
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let meta = std::fs::symlink_metadata(entry.path()).ok()?;
            (meta.is_dir()
                && !meta.file_type().is_symlink()
                && entry.file_name().to_string_lossy().starts_with(&prefix))
            .then(|| entry.path())
        })
        .collect()
}
fn cleanup(record: &InstallRecord) -> Result<bool> {
    let root = std::env::temp_dir().canonicalize()?;
    if record.temp_root.canonicalize()? != root {
        return Err(Error::argument("Unexpected installer temporary directory"));
    }
    if !record
        .version
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b".-+".contains(&b))
    {
        return Err(Error::argument("Invalid installation version"));
    }
    let prefix = format!("DeskHub-{}-updater-", record.version);
    let mut complete = true;
    for dir in &record.directories {
        if !dir.exists() {
            continue;
        }
        let valid = std::fs::symlink_metadata(dir)
            .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
            && dir
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(&prefix))
            && dir
                .canonicalize()
                .is_ok_and(|p| p.parent() == Some(root.as_path()));
        if !valid {
            return Err(Error::argument("Invalid installer cleanup record"));
        }
        let file = dir.join(format!("DeskHub-{}-installer.exe", record.version));
        if file.exists() && std::fs::remove_file(&file).is_err() {
            complete = false;
            continue;
        }
        if std::fs::remove_dir(dir).is_err() {
            complete = false;
        }
    }
    Ok(complete)
}
pub fn configure(context: &mut tauri::Context<tauri::Wry>) -> Result<()> {
    let settings = UpdateConfig::load()?;
    let feed = checked_url(&settings.app_feed)?;
    let config = context
        .config_mut()
        .plugins
        .0
        .get_mut("updater")
        .ok_or_else(|| Error::argument("Missing updater configuration"))?;
    config["endpoints"] = json!([settings.app_feed]);
    config["pubkey"] = json!(settings.public_key);
    config["dangerousInsecureTransportProtocol"] = json!(feed.scheme() == "http");
    Ok(())
}
pub fn initialize(app: &AppHandle) -> Result<()> {
    let path = marker(app)?;
    let result_path = path.with_file_name("app-result.json");
    if result_path.is_file() {
        *app.state::<Updates>().last_result.lock().unwrap() =
            serde_json::from_slice(&std::fs::read(&result_path)?)?;
    }
    if !path.is_file() {
        return Ok(());
    }
    let record: InstallRecord = serde_json::from_slice(&std::fs::read(&path)?)?;
    let success = record.version == app.package_info().version.to_string();
    let result = json!({"version":record.version,"jobId":record.job_id,"state":if success {"completed"}else{"interrupted"},"cleanupPending":true});
    *app.state::<Updates>().last_result.lock().unwrap() = result.clone();
    atomic_json(&result_path, &result)?;
    let hub = app.state::<Desktop>().hub.clone();
    let downloads = hub.downloads();
    if success {
        downloads.finish(
            &record.job_id,
            Ok((
                "completed",
                json!({"version":record.version,"restarted":true}),
            )),
        );
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        for id in &record.connected_devices {
            if let Err(e) = hub.dispatch(
                "devices.connect",
                json!({"deviceId":id}),
                json!("app-update-restore"),
            ) {
                hub.record(
                    "app.update_reconnect_failed",
                    json!({"deviceId":id,"error":e}),
                );
            }
        }
        for _ in 0..60 {
            match cleanup(&record) {
                Ok(true) => {
                    let _ = std::fs::remove_file(&path);
                    let mut result = result.clone();
                    result["cleanupPending"] = json!(false);
                    let _ = atomic_json(&result_path, &result);
                    *handle.state::<Updates>().last_result.lock().unwrap() = result;
                    return;
                }
                Ok(false) => std::thread::sleep(Duration::from_secs(2)),
                Err(e) => {
                    hub.record("app.update_cleanup_failed", json!(e));
                    return;
                }
            }
        }
    });
    Ok(())
}
pub async fn request(app: &AppHandle, method: &str, params: Value) -> Result<Value> {
    if !params.is_object() {
        return Err(Error::argument("params must be an object"));
    }
    let state = app.state::<Updates>();
    let hub = app.state::<Desktop>().hub.clone();
    let jobs = hub.downloads();
    match method {
        "app.updates.info" => Ok(
            json!({"version":app.package_info().version.to_string(),"lastResult":*state.last_result.lock().unwrap()}),
        ),
        "app.updates.check" => {
            state
                .checking
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .map_err(|_| update_error("update_busy", "Already checking"))?;
            let _guard = CheckGuard(&state.checking);
            let handle = app.clone();
            let path = marker(app)?;
            let update = app
                .updater_builder()
                .timeout(Duration::from_secs(30))
                .on_before_exit(move || {
                    if let Ok(bytes) = std::fs::read(&path) {
                        if let Ok(mut record) = serde_json::from_slice::<InstallRecord>(&bytes) {
                            let previous: BTreeSet<_> = record.before.drain(..).collect();
                            record.directories = installer_dirs(&record.temp_root, &record.version)
                                .difference(&previous)
                                .cloned()
                                .collect();
                            let _ = atomic_json(&path, &json!(record));
                        }
                    }
                    handle.state::<Desktop>().hub.shutdown();
                    handle.cleanup_before_exit();
                })
                .build()
                .map_err(|e| update_error("update_failed", e))?
                .check()
                .await
                .map_err(|e| update_error("download_failed", e))?;
            let view = if let Some(update) = &update {
                checked_url(update.download_url.as_str())?;
                Some(
                    json!({"version":update.version,"notes":update.body.clone().unwrap_or_default()}),
                )
            } else {
                None
            };
            *state.candidate.lock().unwrap() = update;
            Ok(json!({"currentVersion":app.package_info().version.to_string(),"release":view}))
        }
        "app.updates.download" => {
            let update = state.candidate.lock().unwrap().clone().ok_or_else(|| {
                Error::new(
                    "check_required",
                    "Check for a release first",
                    "请先检查更新。",
                )
            })?;
            let metadata = update
                .raw_json
                .get("platforms")
                .and_then(|p| p.get("windows-x86_64"))
                .unwrap_or(&update.raw_json);
            let artifact = Artifact {
                url: update.download_url.to_string(),
                signature: update.signature.clone(),
                sha256: error::string(metadata, "sha256")?.into(),
                size: metadata["size"]
                    .as_u64()
                    .ok_or_else(|| Error::argument("Update feed must include size"))?,
            };
            let job = jobs.create("app", "deskhub", &update.version, artifact)?;
            state
                .downloads
                .lock()
                .unwrap()
                .insert(job.id.clone(), update.clone());
            let worker = jobs.clone();
            let id = job.id.clone();
            jobs.spawn(id.clone(), move || {
                worker.download(&id)?;
                update
                    .verify(&worker.bytes(&id)?)
                    .map_err(|e| update_error("signature_invalid", e))?;
                Ok(("ready", json!({})))
            });
            Ok(json!(job))
        }
        "app.updates.install" => {
            let id = error::string(&params, "jobId")?.to_owned();
            let update = state
                .downloads
                .lock()
                .unwrap()
                .get(&id)
                .cloned()
                .ok_or_else(|| {
                    Error::new(
                        "check_required",
                        "Downloaded update handle is unavailable",
                        "请重新检查并下载更新。",
                    )
                })?;
            let path = marker(app)?;
            let snapshot = jobs.get(&id)?;
            if snapshot.kind != "app" || snapshot.state != "ready" {
                return Err(Error::argument(
                    "A verified application download is required",
                ));
            }
            let verified = jobs.bytes(&id).and_then(|bytes| {
                update
                    .verify(&bytes)
                    .map_err(|e| update_error("signature_invalid", e))?;
                Ok(bytes)
            });
            let bytes = match verified {
                Ok(bytes) => bytes,
                Err(e) => {
                    jobs.finish(&id, Err(e.clone()));
                    return Err(e);
                }
            };
            let devices = hub.dispatch("devices.list", json!({}), Value::Null)?;
            let connected: Vec<String> = devices
                .as_array()
                .unwrap()
                .iter()
                .filter(|d| d["phase"] == "connected")
                .filter_map(|d| d["id"].as_str().map(str::to_owned))
                .collect();
            let temp_root = std::env::temp_dir().canonicalize()?;
            let job = jobs.begin_install(&id, "app")?;
            if let Err(e) = atomic_json(
                &path,
                &json!(InstallRecord {
                    version: update.version.clone(),
                    job_id: id.clone(),
                    connected_devices: connected.clone(),
                    before: installer_dirs(&temp_root, &update.version)
                        .into_iter()
                        .collect(),
                    directories: vec![],
                    temp_root
                }),
            ) {
                jobs.reopen();
                jobs.finish(&id, Err(e.clone()));
                return Err(e);
            }
            let worker = jobs.clone();
            std::thread::spawn(move || {
                // Let the accepted response reach the renderer before closing the host.
                std::thread::sleep(Duration::from_millis(150));
                hub.shutdown();
                if let Err(e) = update.install(bytes) {
                    hub.resume();
                    worker.finish(&id, Err(update_error("install_failed", e)));
                    let _ = std::fs::remove_file(&path);
                    for device in connected {
                        let _ = hub.dispatch(
                            "devices.connect",
                            json!({"deviceId":device}),
                            json!("app-update-recovery"),
                        );
                    }
                }
            });
            Ok(json!(job))
        }
        _ => Err(Error::new(
            "unknown_method",
            "Unknown desktop update method",
            "暂不支持这项操作。",
        )),
    }
}
