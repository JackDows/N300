use crate::error::{Error, Result};
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
pub fn lock_directory(directory: &Path) -> Result<File> {
    std::fs::create_dir_all(directory)?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options.open(directory.join("backend.lock")).map_err(|e| {
        Error::new(
            "already_running",
            e.to_string(),
            "这个 DeskHub 后端已经在运行。",
        )
    })
}
pub fn atomic_json(path: &Path, value: &Value) -> Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut file = File::create(&temporary)?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.sync_all()?;
    drop(file);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    #[cfg(not(windows))]
    std::fs::rename(temporary, path)?;
    Ok(())
}
#[derive(Clone)]
pub struct Logger(Arc<Mutex<PathBuf>>);
impl Logger {
    pub fn new(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        let path = directory.join("backend.jsonl");
        OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self(Arc::new(Mutex::new(path))))
    }
    pub fn record(&self, event: &str, data: Value) {
        let path = self.0.lock().unwrap();
        let write = || -> std::io::Result<()> {
            if std::fs::metadata(&*path).is_ok_and(|m| m.len() >= 2 * 1024 * 1024) {
                for i in (1..=3).rev() {
                    let to = path.with_extension(format!("jsonl.{i}"));
                    let from = if i == 1 {
                        path.clone()
                    } else {
                        path.with_extension(format!("jsonl.{}", i - 1))
                    };
                    if to.exists() {
                        std::fs::remove_file(&to)?;
                    }
                    if from.exists() {
                        std::fs::rename(from, to)?;
                    }
                }
            }
            let mut stream = OpenOptions::new().create(true).append(true).open(&*path)?;
            writeln!(
                stream,
                "{}",
                json!({"timeUnixMs":now_ms(),"event":event,"data":data})
            )
        };
        if let Err(error) = write() {
            eprintln!(
                "{}",
                json!({"event":"log_error","message":error.to_string()})
            );
        }
    }
}
