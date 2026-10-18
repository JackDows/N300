use deskhub_backend::{
    error::{self, Error, Result},
    process::read_frame,
    Hub,
};
use serde_json::{json, Value};
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

fn emit(value: Value, output: &Mutex<()>) {
    let _guard = output.lock().unwrap();
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{value}");
    let _ = stdout.flush();
}
fn request(hub: &Hub, value: Value) -> Value {
    hub.request(value)
}
fn run() -> Result<()> {
    let executable = std::env::current_exe()?;
    let mut module_root = executable.parent().unwrap().join("modules");
    let mut data = None;
    let mut offline = false;
    let mut mode = "shell".to_owned();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--module-root" => {
                module_root = PathBuf::from(
                    args.next()
                        .ok_or_else(|| Error::argument("Missing module root"))?,
                )
            }
            "--data-dir" => {
                data = Some(PathBuf::from(
                    args.next()
                        .ok_or_else(|| Error::argument("Missing data directory"))?,
                ))
            }
            "--offline" => offline = true,
            "serve" | "shell" => mode = arg,
            "--help" | "-h" => {
                println!("DeskHub {}\ndeskhub [--offline] [--module-root PATH] [--data-dir PATH] serve|shell\nserve: JSON-RPC lines on stdin/stdout; shell: interactive backend console.",env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            _ => return Err(Error::argument(format!("Unknown argument: {arg}"))),
        }
    }
    let data = data.unwrap_or_else(|| {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| executable.parent().unwrap().to_owned())
            .join("DeskHub/backend")
            .join(if offline { "offline" } else { "online" })
    });
    let output = Arc::new(Mutex::new(()));
    let events_output = output.clone();
    let machine_mode = mode == "serve";
    let hub = Hub::open(
        module_root,
        data,
        offline,
        Arc::new(move |value| {
            if machine_mode {
                emit(value, &events_output);
            }
        }),
    )?;
    if !machine_mode {
        println!("DeskHub backend console{}\nCommands: list, modules, connect ID, stop ID, restart ID, read ID CAPABILITY, write ID CAPABILITY JSON, quit\nOr enter a complete JSON-RPC request.\n", if offline {" (OFFLINE)"} else {""});
        if offline
            && hub
                .dispatch("devices.list", json!({}), Value::Null)?
                .as_array()
                .is_some_and(Vec::is_empty)
        {
            for (id, module, label) in [
                ("speaker", "edifier-n300", "桌面音响"),
                ("keyboard", "flesports-og98", "桌面键盘"),
            ] {
                hub.dispatch(
                    "devices.add",
                    json!({"id":id,"moduleId":module,"label":label}),
                    Value::Null,
                )?;
                hub.dispatch("devices.connect", json!({"deviceId":id}), Value::Null)?;
            }
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&hub.dispatch("devices.list", json!({}), Value::Null)?)?
        );
    }
    let mut input = BufReader::new(std::io::stdin().lock());
    let active = Arc::new(AtomicUsize::new(0));
    let mut workers = Vec::new();
    loop {
        if !machine_mode {
            print!("deskhub> ");
            let _ = std::io::stdout().flush();
        }
        let line = match read_frame(&mut input) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(error) => {
                emit(error::response(Value::Null, Err(error.into())), &output);
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        if !machine_mode && matches!(line.trim(), "quit" | "exit") {
            break;
        }
        let value = if machine_mode || line.trim_start().starts_with('{') {
            serde_json::from_str::<Value>(&line).map_err(Error::from)
        } else {
            shell_request(&line)
        };
        let value = match value {
            Ok(value) => value,
            Err(error) => {
                emit(error::response(Value::Null, Err(error)), &output);
                continue;
            }
        };
        if !machine_mode {
            println!("{}", serde_json::to_string_pretty(&request(&hub, value))?);
            continue;
        }
        let management = value["method"].as_str().is_some_and(|m| {
            matches!(
                m,
                "devices.stop"
                    | "devices.restart"
                    | "devices.replace"
                    | "devices.rebind"
                    | "devices.remove"
            )
        });
        if active.load(Ordering::SeqCst) >= if management { 72 } else { 64 } {
            emit(
                error::response(
                    value["id"].clone(),
                    Err(Error::new(
                        "busy",
                        "Host dispatch capacity reached",
                        "请求较多，请稍后重试。",
                    )),
                ),
                &output,
            );
            continue;
        }
        active.fetch_add(1, Ordering::SeqCst);
        let (hub, output, active) = (hub.clone(), output.clone(), active.clone());
        workers.push(std::thread::spawn(move || {
            emit(request(&hub, value), &output);
            active.fetch_sub(1, Ordering::SeqCst);
        }));
        let mut i = 0;
        while i < workers.len() {
            if workers[i].is_finished() {
                let _ = workers.swap_remove(i).join();
            } else {
                i += 1;
            }
        }
    }
    // EOF drains accepted requests. Call devices.stop for immediate per-device cancellation.
    for worker in workers {
        let _ = worker.join();
    }
    hub.shutdown();
    Ok(())
}
fn shell_request(line: &str) -> Result<Value> {
    let mut parts = line.splitn(4, ' ');
    let method = parts.next().unwrap_or("");
    let id = parts.next().unwrap_or("");
    let capability = parts.next().unwrap_or("");
    let (method, params) = match method {
        "list" => ("devices.list", json!({})),
        "modules" => ("modules.list", json!({})),
        "connect" => ("devices.connect", json!({"deviceId":id})),
        "stop" => ("devices.stop", json!({"deviceId":id})),
        "restart" => ("devices.restart", json!({"deviceId":id})),
        "read" => (
            "devices.read",
            json!({"deviceId":id,"capability":capability}),
        ),
        "write" => (
            "devices.write",
            json!({"deviceId":id,"capability":capability,"value":serde_json::from_str::<Value>(parts.next().ok_or_else(||Error::argument("Missing JSON value"))?)?}),
        ),
        _ => {
            return Err(Error::argument(
                "Unknown console command; a JSON-RPC request is also accepted",
            ))
        }
    };
    Ok(json!({"jsonrpc":"2.0","id":"console","method":method,"params":params}))
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{}", serde_json::to_string(&error).unwrap());
        std::process::exit(1);
    }
}
