use crate::error::{Error, Result};
use crate::manifest::Package;
use crate::storage::Logger;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub enum Event {
    Message(Value),
    Exit(Error),
}
pub type Callback = Arc<dyn Fn(Event) + Send + Sync>;
struct Work {
    method: String,
    params: Value,
    deadline: Instant,
    reply: mpsc::SyncSender<Result<Value>>,
    trace: Value,
    // 0 queued, 1 executing, 2 completed, 3 cancelled before execution.
    state: Arc<AtomicU8>,
}
struct Inner {
    child: Mutex<Child>,
    input: Mutex<Option<ChildStdin>>,
    alive: AtomicBool,
    stopping: AtomicBool,
    pending: Mutex<HashMap<u64, mpsc::SyncSender<Result<Value>>>>,
    callback: Callback,
    logger: Logger,
    identity: Value,
    next_id: AtomicU64,
    #[cfg(windows)]
    job: std::os::windows::io::OwnedHandle,
}
impl Inner {
    fn fail(&self, error: Error) {
        if self.alive.swap(false, Ordering::SeqCst) {
            for (_, pending) in self.pending.lock().unwrap().drain() {
                let _ = pending.send(Err(error.clone()));
            }
            self.logger
                .record("module.exit", json!({"device":self.identity,"error":error}));
            (self.callback)(Event::Exit(error));
        }
    }
    fn terminate(&self) {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(
                    self.job.as_raw_handle(),
                    1,
                );
            }
        }
        let _ = self.child.lock().unwrap().kill();
    }
}
pub struct Process {
    inner: Arc<Inner>,
    jobs: mpsc::SyncSender<Work>,
    threads: Mutex<Vec<JoinHandle<()>>>,
    pub pid: u32,
}
#[cfg(windows)]
fn own_process(child: &Child) -> std::io::Result<std::os::windows::io::OwnedHandle> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::System::JobObjects::*;
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
pub fn read_frame(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut bytes = Vec::new();
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
            };
        }
        let end = buffer.iter().position(|b| *b == b'\n');
        let count = end.map_or(buffer.len(), |p| p + 1);
        if bytes.len() + count > 65536 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Protocol frame exceeds 64 KiB",
            ));
        }
        bytes.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if end.is_some() {
            return String::from_utf8(bytes)
                .map(|s| Some(s.trim_end_matches(['\r', '\n']).into()))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e));
        }
    }
}
impl Process {
    pub fn spawn(
        package: &Package,
        identity: Value,
        logger: Logger,
        callback: Callback,
    ) -> Result<Self> {
        // Recheck immediately before launching an immutable staged package.
        let verified = Package::load(&package.directory)?;
        if verified.fingerprint != package.fingerprint {
            return Err(Error::new(
                "package_changed",
                "Package changed after selection",
                "模块文件已变化，请重新选择。",
            ));
        }
        let mut command = Command::new(&package.executable);
        command
            .current_dir(&package.directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn()?;
        #[cfg(windows)]
        let job = match own_process(&child) {
            Ok(job) => job,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.into());
            }
        };
        let pid = child.id();
        let input = child.stdin.take();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Error::new("spawn_failed", "Missing stdout", "设备模块启动失败。"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| Error::new("spawn_failed", "Missing stderr", "设备模块启动失败。"))?;
        logger.record(
            "module.spawn",
            json!({"device":identity,"pid":pid,"module":package.manifest,"path":package.directory}),
        );
        let inner = Arc::new(Inner {
            child: Mutex::new(child),
            input: Mutex::new(input),
            alive: AtomicBool::new(true),
            stopping: AtomicBool::new(false),
            pending: Mutex::new(HashMap::new()),
            callback,
            logger,
            identity,
            next_id: AtomicU64::new(1),
            #[cfg(windows)]
            job,
        });
        let (send, receive) = mpsc::sync_channel::<Work>(32);
        let read_inner = inner.clone();
        let reader = std::thread::Builder::new()
            .name(format!("module-output-{pid}"))
            .spawn(move || {
                let mut stream = BufReader::new(stdout);
                loop {
                    let text = match read_frame(&mut stream) {
                        Ok(Some(text)) if text.is_empty() => continue,
                        Ok(Some(text)) => text,
                        Ok(None) => break,
                        Err(error) => {
                            read_inner.fail(Error::new(
                                "protocol_error",
                                error.to_string(),
                                "设备模块响应异常。",
                            ));
                            read_inner.terminate();
                            return;
                        }
                    };
                    let message: Value = match serde_json::from_str(&text) {
                        Ok(message) => message,
                        Err(error) => {
                            read_inner.fail(Error::new(
                                "protocol_error",
                                error.to_string(),
                                "设备模块响应异常。",
                            ));
                            read_inner.terminate();
                            return;
                        }
                    };
                    if message["jsonrpc"] != "2.0" {
                        read_inner.fail(Error::new(
                            "protocol_error",
                            "Invalid JSON-RPC version",
                            "设备模块响应异常。",
                        ));
                        read_inner.terminate();
                        return;
                    }
                    if let Some(id) = message["id"].as_u64() {
                        if let Some(pending) = read_inner.pending.lock().unwrap().remove(&id) {
                            let result = if let Some(error) = message.get("error") {
                                Err(Error::module(error))
                            } else if let Some(result) = message.get("result") {
                                Ok(result.clone())
                            } else {
                                Err(Error::new(
                                    "protocol_error",
                                    "Response has no result/error",
                                    "设备模块响应异常。",
                                ))
                            };
                            let _ = pending.send(result);
                        } else {
                            read_inner.logger.record(
                                "module.stale_response",
                                json!({"device":read_inner.identity,"id":id}),
                            );
                        }
                    } else if message["method"] == "module.event" {
                        (read_inner.callback)(Event::Message(message["params"].clone()));
                    }
                }
                read_inner.fail(Error::new(
                    "module_exit",
                    "Module stdout closed",
                    "设备模块已停止，可以重新连接。",
                ));
            })?;
        let diagnostic_inner = inner.clone();
        let diagnostic = std::thread::Builder::new()
            .name(format!("module-log-{pid}"))
            .spawn(move || {
                let mut stream = BufReader::new(stderr);
                while let Ok(Some(line)) = read_frame(&mut stream) {
                    diagnostic_inner.logger.record(
                        "module.diagnostic",
                        json!({"device":diagnostic_inner.identity,"line":line}),
                    );
                }
            })?;
        let work_inner = inner.clone();
        let worker = std::thread::Builder::new().name(format!("device-worker-{pid}")).spawn(move || {
            while work_inner.alive.load(Ordering::SeqCst) && !work_inner.stopping.load(Ordering::SeqCst) {
                let work = match receive.recv_timeout(Duration::from_millis(100)) { Ok(work) => work, Err(mpsc::RecvTimeoutError::Timeout) => continue, Err(_) => break };
                if Instant::now() >= work.deadline {
                    work.state.store(2, Ordering::SeqCst);
                    let _ = work.reply.send(Err(Error::new("queue_timeout", "Expired before execution", "设备繁忙，操作尚未执行。").details(json!({"writeSent":false})))); continue;
                }
                if work.state.compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst).is_err() { continue; }
                let id = work_inner.next_id.fetch_add(1, Ordering::Relaxed);
                let request = json!({"jsonrpc":"2.0","id":id,"method":work.method,"params":work.params});
                let text = request.to_string();
                if text.len() + 1 > 65536 { work.state.store(2, Ordering::SeqCst); let _ = work.reply.send(Err(Error::argument("Module request exceeds 64 KiB"))); continue; }
                work_inner.logger.record("module.request", json!({"device":work_inner.identity,"traceId":work.trace,"request":request}));
                let (tx, rx) = mpsc::sync_channel(1);
                work_inner.pending.lock().unwrap().insert(id, tx);
                let written = {
                    let mut input = work_inner.input.lock().unwrap();
                    match input.as_mut() {
                        Some(stream) => writeln!(stream, "{text}").and_then(|_| stream.flush()),
                        None => Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "Module stdin closed")),
                    }
                };
                let mut result = match written {
                    Ok(()) => rx.recv_timeout(work.deadline.saturating_duration_since(Instant::now())).unwrap_or_else(|_| Err(Error::new("request_timeout", "Module request deadline elapsed", "设备暂时没有响应，请重新连接。"))),
                    Err(error) => Err(Error::new("module_exit", error.to_string(), "设备模块已停止，可以重新连接。")),
                };
                work_inner.pending.lock().unwrap().remove(&id);
                let uncertain = matches!(work.method.as_str(), "capability.write" | "capability.invoke");
                if let Err(error) = &result {
                    if matches!(error.code.as_str(), "request_timeout" | "module_exit" | "protocol_error") {
                        let cause = error.clone();
                        work_inner.fail(cause.clone()); work_inner.terminate();
                        if uncertain { result = Err(Error::new("write_unconfirmed", "Write/invocation may have reached the device", "操作已发送，暂时无法确认结果，请重新连接后读取状态。").details(json!({"cause":cause,"writeSent":"unknown"}))); }
                    }
                }
                work_inner.logger.record("module.response", json!({"device":work_inner.identity,"traceId":work.trace,"moduleRequestId":id,"result":result}));
                work.state.store(2, Ordering::SeqCst);
                let _ = work.reply.send(result);
            }
            for work in receive.try_iter() { work.state.store(2, Ordering::SeqCst); let _ = work.reply.send(Err(Error::new("session_stopped", "Module session stopped before execution", "设备连接已更新，请重试。").details(json!({"writeSent":false})))); }
        })?;
        Ok(Self {
            inner,
            jobs: send,
            threads: Mutex::new(vec![worker, reader, diagnostic]),
            pid,
        })
    }
    pub fn alive(&self) -> bool {
        self.inner.alive.load(Ordering::SeqCst) && !self.inner.stopping.load(Ordering::SeqCst)
    }
    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
        trace: Value,
    ) -> Result<Value> {
        if !self.alive() {
            return Err(Error::new(
                "session_stopped",
                "Module is not running",
                "设备模块尚未运行，请重新连接。",
            ));
        }
        let (tx, rx) = mpsc::sync_channel(1);
        let state = Arc::new(AtomicU8::new(0));
        self.jobs
            .try_send(Work {
                method: method.into(),
                params,
                deadline: Instant::now() + timeout,
                reply: tx,
                trace,
                state: state.clone(),
            })
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => Error::new(
                    "busy",
                    "Per-device queue is full",
                    "设备正在处理其他操作，请稍后重试。",
                ),
                mpsc::TrySendError::Disconnected(_) => Error::new(
                    "session_stopped",
                    "Worker has exited",
                    "设备模块已停止，请重新连接。",
                ),
            })?;
        rx.recv_timeout(timeout + Duration::from_millis(250))
            .unwrap_or_else(|_| {
                if state
                    .compare_exchange(0, 3, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    return Err(Error::new(
                        "queue_timeout",
                        "Expired in the device queue; no command sent",
                        "设备繁忙，操作尚未执行。",
                    )
                    .details(json!({"writeSent":false})));
                }
                if state.load(Ordering::SeqCst) == 2 {
                    if let Ok(result) = rx.recv_timeout(Duration::from_millis(100)) {
                        return result;
                    }
                }
                self.inner.fail(Error::new(
                    "request_timeout",
                    "Worker deadline elapsed",
                    "设备暂时没有响应，请重新连接。",
                ));
                self.inner.terminate();
                Err(Error::new(
                    if method == "capability.write" || method == "capability.invoke" {
                        "write_unconfirmed"
                    } else {
                        "request_timeout"
                    },
                    "Worker deadline elapsed; no automatic replay",
                    "设备暂时没有响应，请重新连接后读取状态。",
                ))
            })
    }
    pub fn stop(&self) {
        if self.inner.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        self.inner.fail(Error::new(
            "session_stopped",
            "Module stop requested",
            "设备连接已停止。",
        ));
        if let Ok(mut input) = self.inner.input.try_lock() {
            input.take();
        }
        let grace = Instant::now() + Duration::from_millis(750);
        while Instant::now() < grace {
            if self
                .inner
                .child
                .lock()
                .unwrap()
                .try_wait()
                .ok()
                .flatten()
                .is_some()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        self.inner.terminate();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline
            && self
                .threads
                .lock()
                .unwrap()
                .iter()
                .any(|t| !t.is_finished())
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        for thread in self.threads.lock().unwrap().drain(..) {
            if thread.is_finished() {
                let _ = thread.join();
            } else {
                self.inner
                    .logger
                    .record("module.cleanup_pending", self.inner.identity.clone());
            }
        }
        let _ = self.inner.child.lock().unwrap().try_wait();
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        self.stop();
    }
}
