//! Deterministic fault injection executable. Built only by Test; never packaged.
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::time::Duration;
fn main() {
    let identity: Value = serde_json::from_slice(&std::fs::read("identity.json").unwrap()).unwrap();
    let mut counter = 0;
    let mut connected = false;
    let mut offline = false;
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        let request: Value = serde_json::from_str(&line).unwrap();
        let params = &request["params"];
        let snapshot = |connected: bool, counter: i64, offline: bool| json!({"phase":if connected{"connected"}else{"disconnected"},"offline":offline,"target":{"serial":"fixture"},"values":{"test.counter":{"value":counter}}});
        let result = match request["method"].as_str().unwrap() {
            "module.describe" => {
                json!({"id":"test-device","version":identity["version"],"protocolVersion":1,"simulation":true,
                "capabilities":[{"id":"test.counter","read":true,"write":true},{"id":identity["capability"],"read":true},
                    {"id":"test.crash","invoke":true},{"id":"test.hang","invoke":true},{"id":"test.delay","invoke":true}]})
            }
            "session.initialize" => {
                offline = params["offline"].as_bool().unwrap();
                snapshot(false, counter, offline)
            }
            "device.connect" => {
                connected = true;
                snapshot(connected, counter, offline)
            }
            "device.disconnect" => {
                connected = false;
                snapshot(connected, counter, offline)
            }
            "device.snapshot" => snapshot(connected, counter, offline),
            "capability.read" => json!({"value":counter}),
            "capability.write" => {
                if params["value"] == "hang" {
                    counter += 1;
                    std::thread::sleep(Duration::from_secs(15));
                } else {
                    counter = params["value"].as_i64().unwrap();
                }
                json!({"value":counter})
            }
            "capability.invoke" => {
                match params["capability"].as_str().unwrap_or("") {
                    "test.crash" => std::process::exit(7),
                    "test.hang" => std::thread::sleep(Duration::from_secs(15)),
                    "test.delay" => std::thread::sleep(Duration::from_millis(
                        params["arguments"]["ms"].as_u64().unwrap_or(1000),
                    )),
                    _ => {}
                }
                json!({"value":counter})
            }
            _ => json!({}),
        };
        println!(
            "{}",
            json!({"jsonrpc":"2.0","id":request["id"],"result":result})
        );
        std::io::stdout().flush().unwrap();
    }
}
