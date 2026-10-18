use deskhub_backend::{
    manifest::Package,
    process::read_frame,
    storage::{atomic_json, lock_directory},
    Hub,
};
use serde_json::json;
use std::io::Cursor;
use std::sync::Arc;

#[test]
fn framing_rejects_oversize_and_invalid_utf8_without_consuming_unbounded_memory() {
    let mut source = Cursor::new("{\"label\":\"键盘\"}\r\n{}\n");
    assert_eq!(
        read_frame(&mut source).unwrap().unwrap(),
        "{\"label\":\"键盘\"}"
    );
    assert_eq!(read_frame(&mut source).unwrap().unwrap(), "{}");
    assert!(read_frame(&mut source).unwrap().is_none());
    assert!(read_frame(&mut Cursor::new(vec![b'x'; 65537])).is_err());
    assert!(read_frame(&mut Cursor::new(vec![255, b'\n'])).is_err());
}

#[test]
fn persisted_config_and_invalid_requests_leave_hardware_unopened() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../artifacts/validation")
        .join(format!(
            "deskhub-tests-{}-{}",
            std::process::id(),
            deskhub_backend::storage::now_ms()
        ));
    std::fs::create_dir_all(&directory).unwrap();
    let hub = Hub::open(
        directory.join("modules"),
        directory.clone(),
        true,
        Arc::new(|_| {}),
    )
    .unwrap();
    assert_eq!(
        hub.request(json!({"jsonrpc":"2.0","id":7,"method":"devices.list"}))["result"],
        json!([])
    );
    assert_eq!(
        hub.request(json!([]))["error"]["data"]["code"],
        "invalid_argument"
    );
    assert_eq!(
        hub.request(json!({"jsonrpc":"2.0","id":8,"method":"unknown"}))["error"]["data"]["code"],
        "unknown_method"
    );
    #[cfg(windows)]
    assert!(lock_directory(&directory).is_err());
    let file = directory.join("配置.json");
    atomic_json(&file, &json!({"revision":1})).unwrap();
    atomic_json(&file, &json!({"revision":2})).unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&std::fs::read(&file).unwrap()).unwrap()
            ["revision"],
        2
    );
    hub.shutdown();
    drop(hub);
    // Keep the bounded acceptance directory for the manual development closeout.
}

#[test]
fn module_manifest_rejects_external_executable_paths() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../artifacts/validation")
        .join(format!("deskhub-package-test-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("module.json");
    std::fs::write(&path,json!({"id":"test","name":"test","version":"0.1.0","protocolVersion":1,"executable":"../outside.exe","files":{"../outside.exe":"0".repeat(64)}}).to_string()).unwrap();
    assert_eq!(Package::load(&path).unwrap_err().code, "invalid_argument");
}
