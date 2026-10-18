//! 桌面壳只做一件事：启动 `n300.exe serve`，把前端的 JSON-RPC 行写进 stdin，
//! 把 stdout 的每一行作为事件转给前端。协议、连接、重连都由 n300 core 负责。

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

#[derive(Default)]
struct Core {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
}

/// 查找顺序：环境变量 N300_EXE → 安装包资源目录 → 开发时相邻的 edifier-n300 构建产物。
fn core_exe(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("N300_EXE") {
        return Ok(PathBuf::from(path));
    }
    if let Ok(dir) = app.path().resource_dir() {
        let path = dir.join("n300").join("n300.exe");
        if path.exists() {
            return Ok(path);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../edifier-n300/artifacts/package/Release/n300.exe");
    if dev.exists() {
        return Ok(dev);
    }
    Err("找不到 n300.exe：请先构建 edifier-n300，或设置 N300_EXE".into())
}

#[tauri::command]
fn core_start(app: AppHandle, core: State<'_, Core>) -> Result<bool, String> {
    let mut slot = core.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = slot.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(false); // 已在运行
        }
    }

    let exe = core_exe(&app)?;
    let mut cmd = Command::new(&exe);
    if std::env::var("N300_OFFLINE").map(|v| v == "1").unwrap_or(false) {
        cmd.arg("--offline");
    }
    cmd.arg("serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 {} 失败：{e}", exe.display()))?;
    let stdout = child.stdout.take().ok_or_else(|| "无法读取 stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "无法读取 stderr".to_string())?;
    *core.stdin.lock().map_err(|e| e.to_string())? = child.stdin.take();
    *slot = Some(child);

    let out_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    let _ = out_app.emit("n300://line", line);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = out_app.emit("n300://exit", ());
    });

    // stderr 必须持续读取，否则缓冲区写满会阻塞子进程。
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("[n300] {line}");
        }
    });

    Ok(true)
}

#[tauri::command]
fn core_send(core: State<'_, Core>, line: String) -> Result<(), String> {
    let mut guard = core.stdin.lock().map_err(|e| e.to_string())?;
    let stdin = guard
        .as_mut()
        .ok_or_else(|| "n300 core 未启动".to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

/// 关闭 stdin 让 core 自行断开蓝牙并退出；超过 1.5 秒仍未退出再强制结束。
fn shutdown_core(app: &AppHandle) {
    let core = app.state::<Core>();
    if let Ok(mut stdin) = core.stdin.lock() {
        stdin.take();
    }
    let Ok(mut slot) = core.child.lock() else { return };
    let Some(mut child) = slot.take() else { return };
    for _ in 0..30 {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn run() {
    tauri::Builder::default()
        .manage(Core::default())
        .invoke_handler(tauri::generate_handler![core_start, core_send])
        .build(tauri::generate_context!())
        .expect("failed to build N300 desktop app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                shutdown_core(app);
            }
        });
}
