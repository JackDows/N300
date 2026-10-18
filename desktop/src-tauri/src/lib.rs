//! Own one native control process. Hardware state remains in n300 core.
mod diagnostics;
mod process;
mod updates;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

#[derive(Default)]
struct Core {
    current: Mutex<(u64, Option<process::CoreProcess>)>,
    shutting_down: AtomicBool,
    activation_notice: AtomicBool,
}

fn shutdown_core(app: &AppHandle) {
    diagnostics::record("core.stopping", serde_json::json!({}));
    let core = app.state::<Core>();
    core.shutting_down.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = core.current.lock() {
        slot.1.take();
    };
}
#[tauri::command]
fn take_activation_notice(app: AppHandle) -> bool {
    app.state::<Core>()
        .activation_notice
        .swap(false, Ordering::SeqCst)
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
        if state.shutting_down.load(Ordering::SeqCst) {
            return Err("应用正在更新或退出".into());
        }
        if slot.1.as_mut().is_some_and(|child| child.alive()) {
            return Ok(slot.0);
        }
        slot.1.take();
        slot.0 += 1;
        let generation = slot.0;
        let exe = core_exe(&app).map_err(|error| {
            diagnostics::record("core.start_failed", serde_json::json!({"error":error}));
            error
        })?;
        let offline = std::env::args().any(|arg| arg == "--offline")
            || std::env::var("N300_OFFLINE").is_ok_and(|value| value == "1");
        let output = app.clone();
        diagnostics::record(
            "core.starting",
            serde_json::json!({"generation":generation,"executable":exe,"offline":offline}),
        );
        slot.1 = Some(
            process::CoreProcess::spawn(
                &exe,
                offline,
                Arc::new(move |event| match event {
                    process::Event::Line(line) => {
                        if !diagnostics::core_message(generation, &line) {
                            let _ = output.emit("n300://line", CoreLine { generation, line });
                        }
                    }
                    process::Event::Diagnostic(line) => diagnostics::record(
                        "core.stderr",
                        serde_json::json!({"generation":generation,"line":line}),
                    ),
                    process::Event::Exit => {
                        diagnostics::record(
                            "core.exited",
                            serde_json::json!({"generation":generation}),
                        );
                        let _ = output.emit("n300://exit", generation);
                    }
                }),
            )
            .map_err(|error| {
                diagnostics::record(
                    "core.start_failed",
                    serde_json::json!({"generation":generation,"error":error}),
                );
                error
            })?,
        );
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
        let generation = slot.0;
        diagnostics::record("core.request", serde_json::json!({"generation":generation,"message":serde_json::from_str::<serde_json::Value>(&line).unwrap_or(serde_json::Value::String(line.clone()))}));
        slot.1.as_mut().ok_or("控制核心未启动")?.send(&line).map_err(|error| {
            diagnostics::record("core.send_failed", serde_json::json!({"generation":generation,"error":error})); error
        })
    })
    .await
    .map_err(|error| error.to_string())?
}
pub fn run() {
    let mut context = tauri::generate_context!();
    updates::configure(&mut context).expect("invalid update configuration");
    tauri::Builder::default()
        .manage(Core::default())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            app.state::<Core>()
                .activation_notice
                .store(true, Ordering::SeqCst);
            diagnostics::record("app.already_running", serde_json::json!({}));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("n300://already-running", ());
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            diagnostics::initialize(app.handle());
            updates::initialize(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_start,
            core_send,
            take_activation_notice,
            diagnostics::report_frontend_error,
            updates::update_info,
            updates::update_check,
            updates::update_install
        ])
        .build(context)
        .expect("failed to build N300 desktop")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                diagnostics::record("app.exiting", serde_json::json!({}));
                shutdown_core(app);
            }
        });
}
