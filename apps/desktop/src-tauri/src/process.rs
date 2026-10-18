use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub enum Event {
    Line(String),
    Diagnostic(String),
    Exit,
}
pub struct CoreProcess {
    child: Child,
    input: Option<ChildStdin>,
    readers: Vec<JoinHandle<()>>,
    #[cfg(windows)]
    _job: std::os::windows::io::OwnedHandle,
}

#[cfg(windows)]
fn own_process(child: &Child) -> std::io::Result<std::os::windows::io::OwnedHandle> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::System::JobObjects::*;
    // OS ownership also terminates the BLE process if the desktop crashes.
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let job = OwnedHandle::from_raw_handle(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        ) == 0
            || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(job)
    }
}

impl CoreProcess {
    pub fn spawn(
        exe: &Path,
        offline: bool,
        emit: Arc<dyn Fn(Event) + Send + Sync>,
    ) -> Result<Self, String> {
        if !exe.is_file() {
            return Err(format!("找不到控制程序：{}", exe.display()));
        }
        let mut command = Command::new(exe);
        if offline {
            command.arg("--offline");
        }
        command
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = exe.parent() {
            command.current_dir(dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("启动控制程序失败：{error}"))?;
        #[cfg(windows)]
        let job = match own_process(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("托管控制进程失败：{error}"));
            }
        };
        let input = child.stdin.take();
        let stdout = child.stdout.take().ok_or("无法读取控制程序输出")?;
        let stderr = child.stderr.take().ok_or("无法读取控制程序诊断")?;
        let diagnostic = emit.clone();
        let readers = vec![
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    match line {
                        Ok(line) if !line.trim().is_empty() => emit(Event::Line(line)),
                        Ok(_) => {}
                        Err(_) => break,
                    }
                }
                emit(Event::Exit);
            }),
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    diagnostic(Event::Diagnostic(line));
                }
            }),
        ];
        Ok(Self {
            child,
            input,
            readers,
            #[cfg(windows)]
            _job: job,
        })
    }
    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
    pub fn send(&mut self, line: &str) -> Result<(), String> {
        if line.len() > 1024 * 1024 || line.contains(['\r', '\n']) {
            return Err("无效的控制请求行".into());
        }
        let input = self.input.as_mut().ok_or("控制核心未启动")?;
        input
            .write_all(line.as_bytes())
            .and_then(|_| input.write_all(b"\n"))
            .and_then(|_| input.flush())
            .map_err(|error| error.to_string())
    }
}
impl Drop for CoreProcess {
    fn drop(&mut self) {
        self.input.take();
        let until = Instant::now() + Duration::from_millis(1500);
        while self.alive() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(25));
        }
        if self.alive() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        for reader in self.readers.drain(..) {
            let _ = reader.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_core_roundtrip_and_cleanup() {
        let exe = std::env::var_os("N300_CORE_TEST_EXE")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../modules/edifier-n300/artifacts/package/Debug/n300.exe")
            });
        let (send, receive) = std::sync::mpsc::channel();
        let mut core = CoreProcess::spawn(
            &exe,
            true,
            Arc::new(move |event| {
                let _ = send.send(event);
            }),
        )
        .unwrap();
        assert!(core.send("{}\n{}").is_err());
        assert!(core.send(&"a".repeat(1024 * 1024 + 1)).is_err());
        core.send(r#"{"jsonrpc":"2.0","id":991,"method":"status","params":{"full":true}}"#)
            .unwrap();
        let until = Instant::now() + Duration::from_secs(10);
        let mut replied = false;
        while Instant::now() < until {
            if let Event::Line(line) = receive.recv_timeout(Duration::from_secs(5)).unwrap() {
                if line.contains("\"id\":991") {
                    assert!(line.contains("\"offline\":true"));
                    assert!(line.contains("\"volume\""));
                    replied = true;
                    break;
                }
            }
        }
        assert!(replied);
        drop(core);
        assert!(receive.try_iter().any(|event| matches!(event, Event::Exit)));
    }
}
