use deskhub_backend::error::{Error, Result};
use serde_json::Value;
use std::{io::Read, process::{Command, Stdio}, thread, time::{Duration, Instant}};

pub const METHODS: &[&str] = &["app.hardware.inspect", "app.mangodisk.open"];

pub fn request(method: &str, offline: bool) -> Result<Value> {
    let launch = method == "app.mangodisk.open";
    if offline {
        return if launch { Ok(serde_json::json!({"opened":true,"simulated":true})) }
        else { Ok(serde_json::from_str(include_str!("../../../../contracts/fixtures/workstation.json"))?) };
    }
    let user_message = if launch { "未能打开 MangoDisk，请检查它是否已安装。" } else { "暂时未能读取设备信息。" };
    let failure = |message: String| Error::new("workstation_unavailable", message, user_message);
    let root = std::env::var_os("SystemRoot").ok_or_else(|| failure("SystemRoot missing".into()))?;
    let executable = std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let action = if launch { "OpenMangoDisk" } else { "Inspect" };
    // Both the script and action are fixed application resources; the UI cannot pass a command/path.
    let script = format!("& {{ {} }} -Action {}", include_str!("workstation.ps1"), action);
    let mut command = Command::new(executable);
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", &script])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| failure(e.to_string()))?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let output = thread::spawn(move || { let mut data = Vec::new(); stdout.read_to_end(&mut data).map(|_| data) });
    let errors = thread::spawn(move || { let mut data = Vec::new(); stderr.read_to_end(&mut data).map(|_| data) });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() < Duration::from_secs(15) => thread::sleep(Duration::from_millis(40)),
            result => {
                let _ = child.kill(); let _ = child.wait();
                break Err(failure(format!("Workstation probe did not finish: {result:?}")));
            }
        }
    };
    let data = output.join().map_err(|_| failure("Inventory reader failed".into()))?.map_err(|e| failure(e.to_string()))?;
    let error = errors.join().map_err(|_| failure("Inventory error reader failed".into()))?.map_err(|e| failure(e.to_string()))?;
    if !status?.success() { return Err(failure(String::from_utf8_lossy(&error).to_string())); }
    serde_json::from_slice(&data).map_err(|e| failure(e.to_string()))
}
