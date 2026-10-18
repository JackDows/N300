use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    last_result: Mutex<Option<String>>,
}

struct Busy<'a>(&'a AtomicBool);
impl<'a> Busy<'a> {
    fn acquire(value: &'a AtomicBool) -> Result<Self, String> {
        value
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "更新操作正在进行，请稍候".to_string())?;
        Ok(Self(value))
    }
}
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    version: String,
    last_result: Option<String>,
}
#[derive(Serialize)]
pub struct Available {
    version: String,
    notes: String,
}
#[derive(Clone, Serialize)]
pub struct Progress {
    stage: &'static str,
    downloaded: usize,
    total: Option<u64>,
}
#[derive(Serialize, Deserialize)]
struct Cleanup {
    version: String,
    temp_root: PathBuf,
    directories: Vec<PathBuf>,
    #[serde(default)]
    before: Vec<PathBuf>,
}

fn marker(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("pending-update.json"))
}
fn save_marker(path: &Path, value: &Cleanup) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    match std::fs::rename(&temp, path) {
        Ok(()) => Ok(()),
        // Redirected/virtualized Windows profile folders can report different
        // volumes even for two names under the same logical directory.
        Err(error) if error.raw_os_error() == Some(17) => {
            std::fs::copy(&temp, path).map_err(|e| format!("无法保存更新记录：{e}"))?;
            let _ = std::fs::remove_file(&temp);
            Ok(())
        }
        Err(error) => Err(format!("无法保存更新记录：{error}")),
    }
}
fn version_is_filename_safe(version: &str) -> bool {
    !version.is_empty()
        && version
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b".-+".contains(&c))
}
fn installer_dirs(root: &Path, version: &str) -> BTreeSet<PathBuf> {
    if !version_is_filename_safe(version) {
        return BTreeSet::new();
    }
    let prefix = format!("N300-{version}-updater-");
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path).ok()?;
            (meta.is_dir()
                && !meta.file_type().is_symlink()
                && entry.file_name().to_string_lossy().starts_with(&prefix))
            .then_some(path)
        })
        .collect()
}

// Only remove the exact NSIS file created by our updater. Never recursively delete
// a temp directory, follow links, or touch the downloaded user installer.
fn cleanup_files(value: &Cleanup, allowed_root: &Path) -> bool {
    if !version_is_filename_safe(&value.version) {
        return false;
    }
    let Ok(root) = value.temp_root.canonicalize() else {
        return false;
    };
    if !allowed_root
        .canonicalize()
        .is_ok_and(|actual| actual == root)
    {
        return false;
    }
    let prefix = format!("N300-{}-updater-", value.version);
    let filename = format!("N300-{}-installer.exe", value.version);
    let mut complete = true;
    for dir in &value.directories {
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
            complete = false;
            continue;
        }
        let installer = dir.join(&filename);
        if installer.exists() {
            let regular = std::fs::symlink_metadata(&installer)
                .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink());
            if !regular || std::fs::remove_file(&installer).is_err() {
                complete = false;
                continue;
            }
        }
        if std::fs::remove_dir(dir).is_err() {
            complete = false;
        }
    }
    complete
}

pub fn initialize(app: &AppHandle) {
    let Ok(path) = marker(app) else {
        return;
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return;
    };
    let Ok(record) = serde_json::from_slice::<Cleanup>(&bytes) else {
        return;
    };
    let message = if record.version == app.package_info().version.to_string() {
        format!("已更新到 {}", record.version)
    } else {
        "上次更新未完成，可以重新检查更新".to_string()
    };
    *app.state::<Updates>().last_result.lock().unwrap() = Some(message);
    // The NSIS process may still be exiting when it relaunches the app.
    std::thread::spawn(move || {
        for _ in 0..60 {
            if cleanup_files(&record, &std::env::temp_dir()) {
                let _ = std::fs::remove_file(&path);
                break;
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

fn loopback_http(url: &tauri::Url) -> bool {
    url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"))
}
fn allowed_url(url: &tauri::Url) -> bool {
    url.scheme() == "https" || loopback_http(url)
}

pub fn configure(context: &mut tauri::Context<tauri::Wry>) -> Result<(), String> {
    // Test/local release feeds may use loopback HTTP. Remote feeds always require
    // HTTPS; TLS certificate and package-signature verification remain enabled.
    if let Ok(endpoint) = std::env::var("N300_UPDATE_URL") {
        let url = tauri::Url::parse(&endpoint).map_err(|e| e.to_string())?;
        if !allowed_url(&url) {
            return Err("更新地址必须使用 HTTPS".into());
        }
        let config = context
            .config_mut()
            .plugins
            .0
            .get_mut("updater")
            .ok_or("缺少更新配置")?;
        config["endpoints"] = serde_json::json!([endpoint]);
        config["dangerousInsecureTransportProtocol"] = serde_json::json!(loopback_http(&url));
    }
    Ok(())
}

#[tauri::command]
pub fn update_info(app: AppHandle, state: State<'_, Updates>) -> Info {
    Info {
        version: app.package_info().version.to_string(),
        last_result: state.last_result.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, Updates>,
) -> Result<Option<Available>, String> {
    let _busy = Busy::acquire(&state.busy)?;
    let shutdown = app.clone();
    let marker_path = marker(&app)?;
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(30))
        .on_before_exit(move || {
            // install() has already created the NSIS executable at this point.
            if let Ok(bytes) = std::fs::read(&marker_path) {
                if let Ok(mut record) = serde_json::from_slice::<Cleanup>(&bytes) {
                    let existing: BTreeSet<_> = record.before.drain(..).collect();
                    record.directories = installer_dirs(&record.temp_root, &record.version)
                        .difference(&existing)
                        .cloned()
                        .collect();
                    let _ = save_marker(&marker_path, &record);
                }
            }
            crate::shutdown_core(&shutdown);
            shutdown.cleanup_before_exit();
        })
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("暂时无法检查更新，请稍后重试（{e}）"))?;
    if update
        .as_ref()
        .is_some_and(|u| !allowed_url(&u.download_url))
    {
        return Err("更新包下载地址必须使用 HTTPS".into());
    }
    let result = update.as_ref().map(|u| Available {
        version: u.version.clone(),
        notes: u.body.clone().unwrap_or_default(),
    });
    *state.pending.lock().map_err(|e| e.to_string())? = update;
    Ok(result)
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    state: State<'_, Updates>,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let _busy = Busy::acquire(&state.busy)?;
    let update = state
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("请先检查更新")?;
    let mut downloaded = 0;
    let bytes = update
        .download(
            |count, total| {
                downloaded += count;
                let _ = on_progress.send(Progress {
                    stage: "downloading",
                    downloaded,
                    total,
                });
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载或校验失败，当前版本未改变，可重新尝试（{e}）"))?;
    let root = std::env::temp_dir()
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = marker(&app)?;
    save_marker(
        &path,
        &Cleanup {
            version: update.version.clone(),
            before: installer_dirs(&root, &update.version).into_iter().collect(),
            directories: vec![],
            temp_root: root,
        },
    )?;
    let _ = on_progress.send(Progress {
        stage: "installing",
        downloaded: bytes.len(),
        total: Some(bytes.len() as u64),
    });
    let result = tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())?;
    // A successful Windows installation exits above. A failed launch remains usable.
    app.state::<crate::Core>()
        .shutting_down
        .store(false, Ordering::SeqCst);
    result.map_err(|e| format!("无法启动更新安装程序：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleanup_only_removes_its_recorded_installer() {
        let temp = tempfile::tempdir().unwrap();
        let owned = temp.path().join("N300-0.2.0-updater-test");
        std::fs::create_dir(&owned).unwrap();
        std::fs::write(owned.join("N300-0.2.0-installer.exe"), b"test").unwrap();
        let record = Cleanup {
            version: "0.2.0".into(),
            temp_root: temp.path().into(),
            directories: vec![owned.clone()],
            before: vec![],
        };
        assert!(cleanup_files(&record, temp.path()));
        assert!(!owned.exists());
        let unrelated = temp.path().join("other-program");
        std::fs::create_dir(&unrelated).unwrap();
        let mut invalid = record;
        invalid.directories = vec![unrelated.clone()];
        assert!(!cleanup_files(&invalid, temp.path()));
        assert!(unrelated.exists());
    }
    #[test]
    fn remote_http_is_rejected_and_loopback_is_allowed() {
        assert!(!allowed_url(
            &"http://example.com/update.json".parse().unwrap()
        ));
        assert!(allowed_url(
            &"https://github.com/JackDows/N300/releases/latest/download/latest.json"
                .parse()
                .unwrap()
        ));
        assert!(allowed_url(
            &"http://127.0.0.1:9123/latest.json".parse().unwrap()
        ));
    }
}
