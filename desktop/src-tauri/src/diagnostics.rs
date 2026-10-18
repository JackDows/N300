use serde_json::{json, Value};
use std::{
    fs::{File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

static LOG: OnceLock<Mutex<Journal>> = OnceLock::new();
const MAX_BYTES: u64 = 5 * 1024 * 1024;
const BACKUPS: usize = 3;

struct Journal {
    directory: PathBuf,
    file: Option<File>,
    bytes: u64,
    limit: u64,
    version: String,
}
impl Journal {
    fn open(directory: PathBuf, version: String, limit: u64) -> io::Result<Self> {
        std::fs::create_dir_all(&directory)?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(directory.join("n300.jsonl"))?;
        let bytes = file.metadata()?.len();
        Ok(Self {
            directory,
            file: Some(file),
            bytes,
            limit,
            version,
        })
    }
    fn append(&mut self, event: &str, data: Value) -> io::Result<()> {
        let entry = json!({"timestamp_ms":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis(),
            "app_version":self.version,"process_id":std::process::id(),"event":event,"data":data});
        let mut bytes = serde_json::to_vec(&entry)?;
        bytes.push(b'\n');
        if self.bytes > 0 && self.bytes + bytes.len() as u64 > self.limit {
            self.file.take();
            let last = self.directory.join(format!("n300.{BACKUPS}.jsonl"));
            if last.exists() {
                std::fs::remove_file(last)?;
            }
            for index in (1..BACKUPS).rev() {
                let source = self.directory.join(format!("n300.{index}.jsonl"));
                if source.exists() {
                    move_file(
                        &source,
                        &self.directory.join(format!("n300.{}.jsonl", index + 1)),
                    )?;
                }
            }
            move_file(
                &self.directory.join("n300.jsonl"),
                &self.directory.join("n300.1.jsonl"),
            )?;
            self.file = Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(self.directory.join("n300.jsonl"))?,
            );
            self.bytes = 0;
        }
        self.file
            .as_mut()
            .ok_or_else(|| io::Error::other("diagnostic file is closed"))?
            .write_all(&bytes)?;
        self.bytes += bytes.len() as u64;
        Ok(())
    }
}
fn move_file(source: &Path, target: &Path) -> io::Result<()> {
    match std::fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(17) => {
            std::fs::copy(source, target)?;
            std::fs::remove_file(source)
        }
        Err(e) => Err(e),
    }
}
pub fn initialize(app: &AppHandle) {
    match app
        .path()
        .app_log_dir()
        .map_err(|e| io::Error::other(e.to_string()))
        .and_then(|directory| {
            Journal::open(directory, app.package_info().version.to_string(), MAX_BYTES)
        }) {
        Ok(journal) => {
            let _ = LOG.set(Mutex::new(journal));
        }
        Err(e) => eprintln!("Cannot initialize diagnostic journal: {e}"),
    }
    record(
        "app.started",
        json!({"executable":std::env::current_exe().ok(),"os":std::env::consts::OS,"arch":std::env::consts::ARCH}),
    );
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record("app.panic", json!({"detail":info.to_string()}));
        previous(info);
    }));
}
pub fn record(event: &str, data: Value) {
    if let Some(log) = LOG.get() {
        if let Ok(mut journal) = log.lock() {
            if let Err(e) = journal.append(event, data) {
                eprintln!("Diagnostic write failed: {e}");
            }
        }
    }
}
pub fn core_message(generation: u64, line: &str) -> bool {
    let value = serde_json::from_str::<Value>(line).unwrap_or_else(|_| json!({"raw":line}));
    let diagnostic = value.get("method").and_then(Value::as_str) == Some("event")
        && value.pointer("/params/type").and_then(Value::as_str) == Some("operation");
    record(
        "core.received",
        json!({"generation":generation,"message":value}),
    );
    diagnostic
}
#[tauri::command]
pub fn report_frontend_error(context: String, detail: String) {
    record(
        "ui.error",
        json!({"context":context.chars().take(128).collect::<String>(),"detail":detail.chars().take(16384).collect::<String>()}),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn records_remain_structured_and_rotation_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let mut log = Journal::open(dir.path().into(), "0.2.1".into(), 400).unwrap();
        for id in 0..12 {
            log.append(
                "core.received",
                json!({"id":id,"error":{"code":"verification_failed","expected":1,"actual":3}}),
            )
            .unwrap();
        }
        let mut count = 0;
        for entry in std::fs::read_dir(dir.path()).unwrap() {
            count += 1;
            for line in std::fs::read_to_string(entry.unwrap().path())
                .unwrap()
                .lines()
            {
                let row: Value = serde_json::from_str(line).unwrap();
                assert_eq!(row["app_version"], "0.2.1");
                assert_eq!(row["data"]["error"]["code"], "verification_failed");
                assert_eq!(row["data"]["error"]["actual"], 3);
            }
        }
        assert_eq!(count, BACKUPS + 1);
    }
}
