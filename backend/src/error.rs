use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: String,
    pub message: String,
    pub user_message: String,
    pub details: Value,
}
pub type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn new(code: &str, message: impl Into<String>, user: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            user_message: user.into(),
            details: json!({}),
        }
    }
    pub fn details(mut self, details: Value) -> Self {
        self.details = details;
        self
    }
    pub fn argument(message: impl Into<String>) -> Self {
        Self::new("invalid_argument", message, "参数格式不正确。")
    }
    pub fn module(value: &Value) -> Self {
        let d = value.get("data").unwrap_or(value);
        Self {
            code: d["code"].as_str().unwrap_or("module_error").into(),
            message: d["message"]
                .as_str()
                .unwrap_or("Module request failed")
                .into(),
            user_message: d["userMessage"]
                .as_str()
                .unwrap_or("设备操作未完成。")
                .into(),
            details: d.get("details").cloned().unwrap_or(json!({})),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for Error {}
impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Self::new(
            "io_error",
            e.to_string(),
            "操作未完成，请检查文件或设备连接。",
        )
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Self::argument(e.to_string())
    }
}
pub fn response(id: Value, result: Result<Value>) -> Value {
    match result {
        Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":value}),
        Err(error) => {
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":error.user_message,"data":error}})
        }
    }
}
pub fn string<'a>(params: &'a Value, key: &str) -> Result<&'a str> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.contains('\0'))
        .ok_or_else(|| Error::argument(format!("{key} must be a string")))
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        && id != "."
        && id != ".."
}
