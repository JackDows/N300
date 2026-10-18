//! Own one native control process. Hardware state remains in n300 core.
mod process;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

#[derive(Default)]
struct Core {
    current: Mutex<(u64, Option<process::CoreProcess>)>,
}
#[derive(Clone, serde::Serialize)]
struct CoreLine {
    generation: u64,
    line: String,
}

fn core_exe(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("N300_EXE") {
        let path = PathBuf::from(path);
        return if path.is_absolute() && path.is_file() {
            Ok(path)
        } else {
            Err("N300_EXE 必须指向有效的绝对路径".into())
        };
    }
    let path = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("n300/n300.exe");
    if path.is_file() {
        return Ok(path);
    }
    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../artifacts/package/Debug/n300.exe");
        if path.is_file() {
            return Ok(path);
        }
    }
    Err("缺少 n300/n300.exe，请重新构建或完整解压安装包".into())
}

#[tauri::command]
async fn core_start(app: AppHandle) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Core>();
        let mut slot = state.current.lock().map_err(|error| error.to_string())?;
        if slot.1.as_mut().is_some_and(|child| child.alive()) {
            return Ok(slot.0);
        }
        slot.1.take();
        slot.0 += 1;
        let generation = slot.0;
        let exe = core_exe(&app)?;
        let offline = std::env::args().any(|arg| arg == "--offline")
            || std::env::var("N300_OFFLINE").is_ok_and(|value| value == "1");
        let output = app.clone();
        slot.1 = Some(process::CoreProcess::spawn(
            &exe,
            offline,
            Arc::new(move |event| match event {
                process::Event::Line(line) => {
                    let _ = output.emit("n300://line", CoreLine { generation, line });
                }
                process::Event::Exit => {
                    let _ = output.emit("n300://exit", generation);
                }
            }),
        )?);
        Ok(generation)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
async fn core_send(app: AppHandle, line: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let core = app.state::<Core>();
        let mut slot = core.current.lock().map_err(|error| error.to_string())?;
        slot.1.as_mut().ok_or("控制核心未启动")?.send(&line)
    })
    .await
    .map_err(|error| error.to_string())?
}
pub fn run() {
    tauri::Builder::default()
        .manage(Core::default())
        .invoke_handler(tauri::generate_handler![core_start, core_send])
        .build(tauri::generate_context!())
        .expect("failed to build N300 desktop")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Ok(mut slot) = app.state::<Core>().current.lock() {
                    slot.1.take();
                }
            }
        });
}
