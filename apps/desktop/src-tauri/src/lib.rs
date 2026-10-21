//! Desktop host for the same DeskHub supervisor used by the CLI and tests.
mod updates;
mod workstation;
use deskhub_backend::{
    error::{self, Error},
    Hub,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

pub struct Desktop {
    pub hub: Hub,
    notice: AtomicBool,
    offline: bool,
}

#[tauri::command]
async fn hub_request(app: AppHandle, request: Value) -> Value {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    if request.to_string().len() > 65535
        || request["jsonrpc"] != "2.0"
        || !(id.is_string() || id.is_i64() || id.is_u64())
    {
        return error::response(
            id,
            Err(Error::argument("Expected JSON-RPC 2.0 request, max 64 KiB")),
        );
    }
    let method = request["method"].as_str().unwrap_or("").to_owned();
    if workstation::METHODS.contains(&method.as_str()) {
        let offline = app.state::<Desktop>().offline;
        let operation = method.clone();
        let result = tauri::async_runtime::spawn_blocking(move || workstation::request(&operation, offline)).await
            .unwrap_or_else(|e| Err(Error::new("host_error", e.to_string(), "操作未完成，请重试。")));
        if let Err(error) = &result { app.state::<Desktop>().hub.record(&method, json!({"error":error})); }
        return error::response(id, result);
    }
    if method == "app.takeActivationNotice" {
        return error::response(
            id,
            Ok(json!(app
                .state::<Desktop>()
                .notice
                .swap(false, Ordering::SeqCst))),
        );
    }
    if method.starts_with("app.updates.") {
        let result = updates::request(
            &app,
            &method,
            request.get("params").cloned().unwrap_or(json!({})),
        )
        .await;
        return error::response(id, result);
    }
    let hub = app.state::<Desktop>().hub.clone();
    let result = tauri::async_runtime::spawn_blocking(move || hub.request(request)).await;
    match result {
        Ok(mut response) => {
            if method == "hub.describe" && response.get("result").is_some() {
                let methods = response["result"]["methods"].as_array_mut().unwrap();
                methods.extend(updates::METHODS.iter().map(|s| json!(s)));
                methods.extend(workstation::METHODS.iter().map(|s| json!(s)));
                methods.push(json!("app.takeActivationNotice"));
                response["result"]["desktop"] =
                    json!({"version":app.package_info().version.to_string(),"updater":true});
            }
            response
        }
        Err(error) => error::response(
            id,
            Err(Error::new(
                "host_error",
                error.to_string(),
                "操作未完成，请重试。",
            )),
        ),
    }
}
pub fn run() {
    let mut context = tauri::generate_context!();
    if std::env::var("DESKHUB_TEST_HIDE_WINDOW").as_deref() == Ok("1") {
        for window in &mut context.config_mut().app.windows {
            window.visible = false;
        }
    }
    updates::configure(&mut context).expect("invalid DeskHub update configuration");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(desktop) = app.try_state::<Desktop>() {
                desktop.notice.store(true, Ordering::SeqCst);
                desktop.hub.record("app.already_running", json!({}));
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit(
                "deskhub://event",
                json!({"jsonrpc":"2.0","method":"app.activated","params":{}}),
            );
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .setup(|app| {
            let offline = std::env::args().any(|s| s == "--offline")
                || std::env::var("DESKHUB_OFFLINE").as_deref() == Ok("1");
            let module_root = std::env::var_os("DESKHUB_MODULE_ROOT")
                .map(PathBuf::from)
                .unwrap_or(app.path().resource_dir()?.join("modules"));
            let data = std::env::var_os("DESKHUB_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA"))
                        .join("DeskHub/backend")
                        .join(if offline { "offline" } else { "online" })
                });
            let output = app.handle().clone();
            let hub = Hub::open(
                module_root,
                data,
                offline,
                Arc::new(move |event| {
                    let _ = output.emit("deskhub://event", event);
                }),
            )?;
            hub.record(
                "app.started",
                json!({"version":app.package_info().version.to_string(),"pid":std::process::id()}),
            );
            app.manage(Desktop {
                hub,
                notice: AtomicBool::new(false),
                offline,
            });
            updates::initialize(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![hub_request])
        .build(context)
        .expect("failed to build DeskHub desktop")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Desktop>().hub.shutdown();
            }
        });
}
