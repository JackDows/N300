//! Bounded, signed downloads shared by module updates and the desktop installer.
use crate::error::{Error, Result};
use crate::hub::Events;
use crate::storage::{atomic_json, now_ms, Logger};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

const MAX_DOWNLOAD: u64 = 256 * 1024 * 1024;
static SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateConfig {
    pub repository: String,
    pub app_feed: String,
    pub module_catalog: String,
    pub public_key: String,
}
impl UpdateConfig {
    pub fn load() -> Result<Self> {
        let bytes = if let Some(path) = std::env::var_os("DESKHUB_UPDATE_CONFIG") {
            std::fs::read(path)?
        } else {
            include_bytes!("../../distribution.json").to_vec()
        };
        let config: Self = serde_json::from_slice(&bytes)?;
        checked_url(&config.app_feed)?;
        checked_url(&config.module_catalog)?;
        public_key(&config.public_key)?;
        Ok(config)
    }
}

pub fn update_error(code: &str, detail: impl ToString) -> Error {
    let message = match code {
        "download_cancelled" => "下载已取消。",
        "signature_invalid" | "package_corrupt" => "下载文件校验失败，请重新下载。",
        "update_busy" => "更新操作正在进行，请稍后重试。",
        "download_failed" => "下载未完成，请检查网络后重试。",
        "update_interrupted" => "上次更新未完成，请重新下载。",
        _ => "更新未完成，当前版本仍可使用。",
    };
    Error::new(code, detail.to_string(), message)
}
pub fn checked_url(value: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(value).map_err(|e| Error::argument(e.to_string()))?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (!url.username().is_empty())
        || url.password().is_some()
        || !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
    {
        return Err(Error::argument(
            "Updates require HTTPS (HTTP is allowed only on loopback)",
        ));
    }
    Ok(url)
}
fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("DeskHub/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 {
                attempt.error("Too many redirects")
            } else if checked_url(attempt.url().as_str()).is_err() {
                attempt.error("Insecure update redirect")
            } else if attempt
                .previous()
                .first()
                .is_some_and(|u| u.scheme() == "https")
                && attempt.url().scheme() != "https"
            {
                attempt.error("HTTPS downgrade")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| update_error("download_failed", e))
}
pub fn fetch_small(url: &str, limit: usize) -> Result<Vec<u8>> {
    let mut response = client()?
        .get(checked_url(url)?)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| update_error("download_failed", e))?;
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(Error::argument("Update metadata exceeds its size limit"));
    }
    Ok(bytes)
}
fn decode_text(value: &str) -> Result<String> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|e| update_error("signature_invalid", e))?;
    String::from_utf8(bytes).map_err(|e| update_error("signature_invalid", e))
}
fn public_key(encoded: &str) -> Result<minisign_verify::PublicKey> {
    minisign_verify::PublicKey::decode(&decode_text(encoded)?)
        .map_err(|e| update_error("signature_invalid", e))
}
pub fn verify_signature(bytes: &[u8], signature: &str, key: &str) -> Result<()> {
    let sig = minisign_verify::Signature::decode(&decode_text(signature)?)
        .map_err(|e| update_error("signature_invalid", e))?;
    public_key(key)?
        .verify(bytes, &sig, false)
        .map_err(|e| update_error("signature_invalid", e))
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifact {
    pub url: String,
    pub signature: String,
    pub sha256: String,
    pub size: u64,
}
impl Artifact {
    pub fn validate(&self) -> Result<()> {
        checked_url(&self.url)?;
        if self.size == 0
            || self.size > MAX_DOWNLOAD
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || self.signature.len() > 4096
        {
            return Err(Error::argument(
                "Invalid artifact size, checksum or signature",
            ));
        }
        Ok(())
    }
    pub fn verify(&self, bytes: &[u8], key: &str) -> Result<()> {
        if bytes.len() as u64 != self.size
            || format!("{:x}", Sha256::digest(bytes)) != self.sha256.to_ascii_lowercase()
        {
            return Err(update_error(
                "package_corrupt",
                "Artifact size/SHA-256 mismatch",
            ));
        }
        verify_signature(bytes, &self.signature, key)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub subject: String,
    pub version: String,
    pub state: String,
    pub downloaded: u64,
    pub total: u64,
    pub created_at_unix_ms: u128,
    pub error: Option<Error>,
    pub result: Value,
}
#[derive(Clone, Deserialize, Serialize)]
struct Record {
    job: Job,
    artifact: Artifact,
}
struct Entry {
    record: Record,
    cancel: Arc<AtomicBool>,
    active: bool,
}
struct Inner {
    root: PathBuf,
    key: String,
    entries: Mutex<BTreeMap<String, Entry>>,
    closing: AtomicBool,
    events: Events,
    logger: Logger,
}
#[derive(Clone)]
pub struct Downloads(Arc<Inner>);
impl Downloads {
    pub fn open(root: PathBuf, key: String, events: Events, logger: Logger) -> Result<Self> {
        std::fs::create_dir_all(&root)?;
        let root = root.canonicalize()?;
        let mut entries = BTreeMap::new();
        if root.join("jobs.json").is_file() {
            let bytes = std::fs::read(root.join("jobs.json"))?;
            if bytes.len() > 2 * 1024 * 1024 {
                return Err(Error::argument("Update journal is too large"));
            }
            let records: Vec<Record> = serde_json::from_slice(&bytes)?;
            for mut record in records {
                if !crate::error::valid_id(&record.job.id) {
                    return Err(Error::argument("Invalid update job ID"));
                }
                if !matches!(
                    record.job.state.as_str(),
                    "completed" | "failed" | "cancelled" | "interrupted"
                ) {
                    record.job.state = "interrupted".into();
                    record.job.error = Some(update_error(
                        "update_interrupted",
                        "The host exited before the operation completed",
                    ));
                }
                entries.insert(
                    record.job.id.clone(),
                    Entry {
                        record,
                        cancel: Arc::new(AtomicBool::new(false)),
                        active: false,
                    },
                );
            }
        }
        let this = Self(Arc::new(Inner {
            root,
            key,
            entries: Mutex::new(entries),
            closing: AtomicBool::new(false),
            events,
            logger,
        }));
        // Only operation-owned payloads referenced by our journal are removed.
        for job in this.list() {
            this.discard_payload(&job.id)?;
        }
        this.persist(&this.0.entries.lock().unwrap())?;
        Ok(this)
    }
    fn persist(&self, entries: &BTreeMap<String, Entry>) -> Result<()> {
        atomic_json(
            &self.0.root.join("jobs.json"),
            &json!(entries.values().map(|e| &e.record).collect::<Vec<_>>()),
        )
    }
    fn emit(&self, job: &Job) {
        (self.0.events)(json!({"jsonrpc":"2.0","method":"updates.changed","params":{"job":job}}));
    }
    pub fn list(&self) -> Vec<Job> {
        self.0
            .entries
            .lock()
            .unwrap()
            .values()
            .map(|e| e.record.job.clone())
            .collect()
    }
    pub fn get(&self, id: &str) -> Result<Job> {
        self.0
            .entries
            .lock()
            .unwrap()
            .get(id)
            .map(|e| e.record.job.clone())
            .ok_or_else(|| {
                Error::new(
                    "job_not_found",
                    "Unknown update job",
                    "找不到这次更新，请重新检查更新。",
                )
            })
    }
    pub fn create(
        &self,
        kind: &str,
        subject: &str,
        version: &str,
        artifact: Artifact,
    ) -> Result<Job> {
        artifact.validate()?;
        let mut entries = self.0.entries.lock().unwrap();
        if self.0.closing.load(Ordering::SeqCst)
            || entries.values().any(|e| {
                e.record.job.kind == kind
                    && e.record.job.subject == subject
                    && (e.active || e.record.job.state == "ready")
            })
        {
            return Err(update_error(
                "update_busy",
                "An operation for this subject is already active",
            ));
        }
        while entries.len() >= 100 {
            let oldest = entries
                .values()
                .filter(|e| !e.active && e.record.job.state != "ready")
                .min_by_key(|e| e.record.job.created_at_unix_ms)
                .map(|e| e.record.job.id.clone())
                .ok_or_else(|| update_error("update_busy", "Too many pending downloads"))?;
            entries.remove(&oldest);
        }
        let id = format!(
            "{}-{}-{}",
            now_ms(),
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::SeqCst)
        );
        let job = Job {
            id: id.clone(),
            kind: kind.into(),
            subject: subject.into(),
            version: version.into(),
            state: "queued".into(),
            downloaded: 0,
            total: artifact.size,
            created_at_unix_ms: now_ms(),
            error: None,
            result: Value::Null,
        };
        std::fs::create_dir(self.0.root.join(&id))?;
        entries.insert(
            id,
            Entry {
                record: Record {
                    job: job.clone(),
                    artifact,
                },
                cancel: Arc::new(AtomicBool::new(false)),
                active: true,
            },
        );
        self.persist(&entries)?;
        drop(entries);
        self.emit(&job);
        Ok(job)
    }
    pub fn cancelled(&self, id: &str) -> Result<()> {
        let entries = self.0.entries.lock().unwrap();
        if self.0.closing.load(Ordering::SeqCst)
            || entries
                .get(id)
                .is_none_or(|e| e.cancel.load(Ordering::SeqCst))
        {
            Err(update_error("download_cancelled", "Update cancelled"))
        } else {
            Ok(())
        }
    }
    pub fn progress(&self, id: &str, state: &str, downloaded: u64) -> Result<()> {
        let mut entries = self.0.entries.lock().unwrap();
        let entry = entries
            .get_mut(id)
            .ok_or_else(|| Error::argument("Unknown job"))?;
        let changed = entry.record.job.state != state;
        entry.record.job.state = state.into();
        entry.record.job.downloaded = downloaded;
        let job = entry.record.job.clone();
        if changed {
            self.persist(&entries)?;
        }
        drop(entries);
        self.emit(&job);
        Ok(())
    }
    pub fn finish(&self, id: &str, outcome: Result<(&str, Value)>) {
        let mut entries = self.0.entries.lock().unwrap();
        let Some(entry) = entries.get_mut(id) else {
            return;
        };
        let outcome = if matches!(outcome, Ok(("ready", _)))
            && (entry.cancel.load(Ordering::SeqCst) || self.0.closing.load(Ordering::SeqCst))
        {
            Err(update_error(
                "download_cancelled",
                "Cancelled before download completion",
            ))
        } else {
            outcome
        };
        entry.active = false;
        match outcome {
            Ok((state, result)) => {
                entry.record.job.state = state.into();
                entry.record.job.result = result;
                entry.record.job.error = None;
            }
            Err(error) => {
                entry.record.job.state = if error.code == "download_cancelled" {
                    "cancelled"
                } else {
                    "failed"
                }
                .into();
                entry.record.job.error = Some(error);
            }
        }
        let job = entry.record.job.clone();
        let persisted = self.persist(&entries);
        drop(entries);
        if let Err(e) = persisted {
            self.0.logger.record("update.journal_error", json!(e));
        }
        if job.state != "ready" {
            if let Err(e) = self.discard_payload(id) {
                self.0
                    .logger
                    .record("update.cleanup_error", json!({"jobId":id,"error":e}));
            }
        }
        self.0.logger.record("update.result", json!(job));
        self.emit(&job);
    }
    pub fn spawn<F>(&self, id: String, task: F)
    where
        F: FnOnce() -> Result<(&'static str, Value)> + Send + 'static,
    {
        let this = self.clone();
        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(task))
                .unwrap_or_else(|_| Err(update_error("update_failed", "Update worker panicked")));
            this.finish(&id, result);
        });
    }
    pub fn begin_install(&self, id: &str, kind: &str) -> Result<Job> {
        let mut entries = self.0.entries.lock().unwrap();
        if self.0.closing.load(Ordering::SeqCst) {
            return Err(update_error("update_busy", "Host is closing"));
        }
        if kind == "app" && entries.values().any(|e| e.active && e.record.job.id != id) {
            return Err(update_error("update_busy", "Other updates are active"));
        }
        let entry = entries
            .get_mut(id)
            .ok_or_else(|| Error::argument("Unknown job"))?;
        if entry.active || entry.record.job.state != "ready" || entry.record.job.kind != kind {
            return Err(Error::argument(
                "A verified download of the requested kind is required",
            ));
        }
        entry.active = true;
        entry.record.job.state = "installing".into();
        let job = entry.record.job.clone();
        self.persist(&entries)?;
        if kind == "app" {
            self.0.closing.store(true, Ordering::SeqCst);
        }
        drop(entries);
        self.emit(&job);
        Ok(job)
    }
    pub fn cancel(&self, id: &str) -> Result<Job> {
        let mut entries = self.0.entries.lock().unwrap();
        let entry = entries
            .get_mut(id)
            .ok_or_else(|| Error::argument("Unknown job"))?;
        if matches!(
            entry.record.job.state.as_str(),
            "completed" | "failed" | "cancelled" | "interrupted"
        ) {
            return Ok(entry.record.job.clone());
        }
        if entry.record.job.state == "installing" {
            return Err(update_error(
                "update_busy",
                "Installation cannot be cancelled after activation starts",
            ));
        }
        entry.cancel.store(true, Ordering::SeqCst);
        let active = entry.active;
        drop(entries);
        if !active {
            self.finish(
                id,
                Err(update_error("download_cancelled", "Cancelled by user")),
            );
        }
        self.get(id)
    }
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        self.get(id)?;
        if !crate::error::valid_id(id) {
            return Err(Error::argument("Invalid job ID"));
        }
        Ok(self.0.root.join(id).join("payload"))
    }
    pub fn discard_payload(&self, id: &str) -> Result<()> {
        let payload = self.path(id)?;
        for path in [&payload, &payload.with_extension("part")] {
            if path.exists() {
                std::fs::remove_file(path)?;
            }
        }
        let parent = payload.parent().unwrap();
        if parent.exists() && std::fs::read_dir(parent)?.next().is_none() {
            std::fs::remove_dir(parent)?;
        }
        Ok(())
    }
    pub fn bytes(&self, id: &str) -> Result<Vec<u8>> {
        let artifact = self
            .0
            .entries
            .lock()
            .unwrap()
            .get(id)
            .ok_or_else(|| Error::argument("Unknown job"))?
            .record
            .artifact
            .clone();
        let file = std::fs::File::open(self.path(id)?)?;
        let mut bytes = Vec::new();
        file.take(MAX_DOWNLOAD + 1).read_to_end(&mut bytes)?;
        artifact.verify(&bytes, &self.0.key)?;
        Ok(bytes)
    }
    pub fn download(&self, id: &str) -> Result<()> {
        self.cancelled(id)?;
        let artifact = self
            .0
            .entries
            .lock()
            .unwrap()
            .get(id)
            .ok_or_else(|| Error::argument("Unknown job"))?
            .record
            .artifact
            .clone();
        let path = self.path(id)?;
        std::fs::create_dir_all(path.parent().unwrap())?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        let count = runtime.block_on(async {
            let request = async {
                let client = reqwest::Client::builder()
                    .connect_timeout(Duration::from_secs(10))
                    .timeout(Duration::from_secs(600))
                    .user_agent(concat!("DeskHub/", env!("CARGO_PKG_VERSION")))
                    .redirect(reqwest::redirect::Policy::custom(|attempt| {
                        if attempt.previous().len() >= 8 {
                            attempt.error("Too many redirects")
                        } else if checked_url(attempt.url().as_str()).is_err() {
                            attempt.error("Insecure redirect")
                        } else if attempt
                            .previous()
                            .first()
                            .is_some_and(|u| u.scheme() == "https")
                            && attempt.url().scheme() != "https"
                        {
                            attempt.error("HTTPS downgrade")
                        } else {
                            attempt.follow()
                        }
                    }))
                    .build()
                    .map_err(|e| update_error("download_failed", e))?;
                let mut response = client
                    .get(checked_url(&artifact.url)?)
                    .send()
                    .await
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| update_error("download_failed", e))?;
                if response
                    .content_length()
                    .is_some_and(|size| size != artifact.size)
                {
                    return Err(update_error(
                        "package_corrupt",
                        "HTTP length differs from signed metadata",
                    ));
                }
                let mut file = std::fs::File::create(path.with_extension("part"))?;
                let mut count = 0u64;
                let mut last = Instant::now();
                self.progress(id, "downloading", 0)?;
                while let Some(chunk) = response
                    .chunk()
                    .await
                    .map_err(|e| update_error("download_failed", e))?
                {
                    self.cancelled(id)?;
                    count += chunk.len() as u64;
                    if count > artifact.size {
                        return Err(update_error(
                            "package_corrupt",
                            "Download exceeded declared size",
                        ));
                    }
                    file.write_all(&chunk)?;
                    if last.elapsed() >= Duration::from_millis(150) {
                        self.progress(id, "downloading", count)?;
                        last = Instant::now();
                    }
                }
                file.sync_all()?;
                Ok::<u64, Error>(count)
            };
            tokio::pin!(request);
            loop {
                tokio::select! {
                    result = &mut request => break result,
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {self.cancelled(id)?;}
                }
            }
        })?;
        self.cancelled(id)?;
        self.progress(id, "verifying", count)?;
        artifact.verify(&std::fs::read(path.with_extension("part"))?, &self.0.key)?;
        self.cancelled(id)?;
        std::fs::rename(path.with_extension("part"), path)?;
        Ok(())
    }
    pub fn active_except(&self, id: &str) -> bool {
        self.0
            .entries
            .lock()
            .unwrap()
            .values()
            .any(|e| e.active && e.record.job.id != id)
    }
    pub fn close(&self) {
        self.0.closing.store(true, Ordering::SeqCst);
    }
    pub fn reopen(&self) {
        self.0.closing.store(false, Ordering::SeqCst);
    }
}
