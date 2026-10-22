use crate::downloads::{Downloads, UpdateConfig};
use crate::error::{self, Error, Result};
use crate::manifest::{inventory, Package};
use crate::module_updates::{self, ModuleUpdates};
use crate::process::{Event, Process};
use crate::storage::{atomic_json, lock_directory, now_ms, Logger};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, RwLock,
};
use std::time::Duration;

pub type Events = Arc<dyn Fn(Value) + Send + Sync>;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    id: String,
    label: String,
    module_id: String,
    package_path: PathBuf,
    offline: bool,
    target: Value,
    config: Value,
}
struct State {
    binding: Binding,
    generation: u64,
    revision: u64,
    phase: String,
    values: Value,
    target: Value,
    capabilities: Value,
    unavailable: Value,
    error: Value,
    value_state: String,
    process: Option<Arc<Process>>,
    module_version: Option<String>,
}
impl State {
    fn view(&self) -> Value {
        json!({"id":self.binding.id,"label":self.binding.label,"moduleId":self.binding.module_id,"moduleVersion":self.module_version,
            "generation":self.generation,"revision":self.revision,"phase":self.phase,"offline":self.binding.offline,
            "target":self.target,"bindingTarget":self.binding.target,"capabilities":self.capabilities,"values":self.values,
            "unavailable":self.unavailable,
            "valueState":self.value_state,"error":self.error,"processId":self.process.as_ref().filter(|p|p.alive()).map(|p|p.pid)})
    }
    fn apply(&mut self, snapshot: &Value) {
        if let Some(phase) = snapshot["phase"].as_str() {
            self.phase = phase.into();
        }
        if snapshot["values"].is_object() {
            self.values = snapshot["values"].clone();
        }
        if let Some(target) = snapshot.get("target") {
            self.target = target.clone();
        }
        self.unavailable = snapshot.get("unavailable").cloned().unwrap_or(json!({}));
        self.error = Value::Null;
        self.value_state = "confirmed".into();
    }
}
struct Slot {
    state: Mutex<State>,
    lifecycle: Mutex<()>,
    emit: Events,
}
impl Slot {
    fn new(binding: Binding, emit: Events) -> Self {
        let target = binding.target.clone();
        Self {
            state: Mutex::new(State {
                binding,
                generation: 0,
                revision: 0,
                phase: "stopped".into(),
                values: json!({}),
                target,
                capabilities: json!([]),
                unavailable: json!({}),
                error: Value::Null,
                value_state: "unknown".into(),
                process: None,
                module_version: None,
            }),
            lifecycle: Mutex::new(()),
            emit,
        }
    }
    fn publish(&self) -> Value {
        let view = {
            let mut state = self.state.lock().unwrap();
            state.revision += 1;
            state.view()
        };
        (self.emit)(json!({"jsonrpc":"2.0","method":"devices.changed","params":{"device":view}}));
        view
    }
    fn on_event(&self, generation: u64, event: Event) {
        {
            let mut state = self.state.lock().unwrap();
            if state.generation != generation {
                return;
            }
            match event {
                Event::Message(message) if message["type"] == "snapshot" => {
                    let before = state.view();
                    state.apply(&message["data"]);
                    if state.view() == before {
                        return;
                    }
                }
                Event::Message(_) => return,
                Event::Exit(error) => {
                    state.phase = "faulted".into();
                    state.values = json!({});
                    state.value_state = "unknown".into();
                    state.error = json!(error);
                }
            }
        }
        self.publish();
    }
}
struct Inner {
    slots: Mutex<BTreeMap<String, Arc<Slot>>>,
    configuration: Mutex<()>,
    module_root: PathBuf,
    data: PathBuf,
    force_offline: bool,
    logger: Logger,
    emit: Events,
    updates: ModuleUpdates,
    downloads: Downloads,
    gate: RwLock<()>,
    closing: AtomicBool,
    _lock: File,
}
#[derive(Clone)]
pub struct Hub(Arc<Inner>);
struct Prepared {
    process: Arc<Process>,
    descriptor: Value,
    snapshot: Value,
}
impl Hub {
    /// A UI bridge may call this on an application-owned background executor.
    pub fn request(&self, request: Value) -> Value {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let result = (|| -> Result<Value> {
            if request.to_string().len() > 65535
                || !request.is_object()
                || request["jsonrpc"] != "2.0"
                || !(id.is_string() || id.is_i64() || id.is_u64())
            {
                return Err(Error::argument(
                    "Expected a JSON-RPC 2.0 request with an ID, within 64 KiB",
                ));
            }
            self.dispatch(
                error::string(&request, "method")?,
                request.get("params").cloned().unwrap_or(json!({})),
                id.clone(),
            )
        })();
        error::response(id, result)
    }
    pub fn open(
        module_root: PathBuf,
        data: PathBuf,
        force_offline: bool,
        emit: Events,
    ) -> Result<Self> {
        let lock = lock_directory(&data)?;
        // Windows may expose an AppData directory in the user profile while
        // redirecting its files to a packaged application's store. The lock
        // has actually been opened, so its resolved parent is the data store
        // used by this process, including for later log/download renames.
        let data = data.join("backend.lock").canonicalize()?
            .parent().expect("Backend lock directory").to_path_buf();
        let logger = Logger::new(&data.join("logs"))?;
        let update_config = UpdateConfig::load()?;
        let downloads = Downloads::open(
            data.join("updates/downloads"),
            update_config.public_key.clone(),
            emit.clone(),
            logger.clone(),
        )?;
        let updates = ModuleUpdates::new(update_config, data.join("updates/catalog.json"));
        let mut slots = BTreeMap::new();
        if data.join("devices.json").is_file() {
            let saved: Value = serde_json::from_slice(&std::fs::read(data.join("devices.json"))?)?;
            if saved["schemaVersion"] != 1 {
                return Err(Error::new(
                    "configuration_version",
                    "Unknown binding schema",
                    "设备配置版本不兼容。",
                ));
            }
            let bindings: Vec<Binding> = serde_json::from_value(saved["devices"].clone())?;
            for mut binding in bindings {
                if !error::valid_id(&binding.id)
                    || !binding.target.is_object()
                    || !binding.config.is_object()
                {
                    return Err(Error::argument("Invalid saved binding"));
                }
                if force_offline {
                    binding.offline = true;
                }
                if slots
                    .insert(
                        binding.id.clone(),
                        Arc::new(Slot::new(binding, emit.clone())),
                    )
                    .is_some()
                {
                    return Err(Error::argument("Duplicate saved device ID"));
                }
            }
        }
        logger.record(
            "backend.start",
            json!({"version":env!("CARGO_PKG_VERSION"),"offline":force_offline,"moduleRoot":module_root}),
        );
        Ok(Self(Arc::new(Inner {
            slots: Mutex::new(slots),
            configuration: Mutex::new(()),
            module_root,
            data,
            force_offline,
            logger,
            emit,
            updates,
            downloads,
            gate: RwLock::new(()),
            closing: AtomicBool::new(false),
            _lock: lock,
        })))
    }
    fn slot(&self, id: &str) -> Result<Arc<Slot>> {
        self.0
            .slots
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| {
                Error::new(
                    "device_not_found",
                    format!("Unknown instance: {id}"),
                    "这个设备尚未添加。",
                )
            })
    }
    fn choose_package(&self, params: &Value) -> Result<Package> {
        if let Some(path) = params.get("packagePath") {
            let path = path
                .as_str()
                .ok_or_else(|| Error::argument("packagePath must be a string"))?;
            return Package::load(Path::new(path));
        }
        let id = error::string(params, "moduleId")?;
        let mut candidates: Vec<_> = self
            .packages()?
            .into_iter()
            .filter(|p| p.manifest.id == id)
            .collect();
        let latest = candidates
            .iter()
            .filter_map(|p| module_updates::version(&p.manifest.version).ok())
            .filter(|v| v.pre.is_empty())
            .max();
        if let Some(latest) = latest {
            candidates.retain(|p| {
                module_updates::version(&p.manifest.version).is_ok_and(|v| v == latest)
            });
        }
        if candidates.len() != 1 {
            return Err(Error::new(
                "module_selection_required",
                format!(
                    "Found {} packages for {id}; specify packagePath",
                    candidates.len()
                ),
                "请选择要使用的设备模块版本。",
            ));
        }
        Ok(candidates.into_iter().next().unwrap())
    }
    // Caller holds configuration lock. On-disk commit precedes changing the in-memory binding.
    fn save(&self, replacement: Option<&Binding>, removed: Option<&str>) -> Result<()> {
        let mut bindings = Vec::new();
        for (id, slot) in self.0.slots.lock().unwrap().iter() {
            if Some(id.as_str()) == removed || replacement.is_some_and(|r| &r.id == id) {
                continue;
            }
            bindings.push(slot.state.lock().unwrap().binding.clone());
        }
        if let Some(replacement) = replacement {
            bindings.push(replacement.clone());
        }
        let mut resources = std::collections::HashSet::new();
        for binding in &bindings {
            if !binding.offline {
                if let Some(resource) = binding.target["resourceId"].as_str() {
                    if resource.is_empty() || !resources.insert(resource.to_ascii_lowercase()) {
                        return Err(Error::new(
                            "device_in_use",
                            "A physical resource is already assigned to another instance",
                            "这台设备已经绑定，请先解除原来的绑定。",
                        ));
                    }
                }
            }
        }
        atomic_json(
            &self.0.data.join("devices.json"),
            &json!({"schemaVersion":1,"devices":bindings}),
        )
    }
    fn prepare(
        &self,
        slot: &Arc<Slot>,
        package: &Package,
        binding: &Binding,
        generation: u64,
    ) -> Result<Prepared> {
        let weak = Arc::downgrade(slot);
        let process = Arc::new(Process::spawn(
            package,
            json!({"id":binding.id,"generation":generation,"moduleId":binding.module_id}),
            self.0.logger.clone(),
            Arc::new(move |event| {
                if let Some(slot) = weak.upgrade() {
                    slot.on_event(generation, event);
                }
            }),
        )?);
        let descriptor = process.request(
            "module.describe",
            json!({}),
            Duration::from_secs(5),
            json!("handshake"),
        )?;
        if descriptor["id"] != package.manifest.id
            || descriptor["version"] != package.manifest.version
            || descriptor["protocolVersion"] != 1
            || !descriptor["capabilities"].is_array()
        {
            return Err(Error::new(
                "incompatible_module",
                "Runtime identity does not match manifest/protocol",
                "设备模块与其清单不一致，请重新获取模块包。",
            ));
        }
        let diagnostic = self
            .0
            .data
            .join("logs")
            .join(format!("{}-{generation}.jsonl", binding.id));
        let snapshot = process.request("session.initialize", json!({"offline":binding.offline,"target":binding.target,"config":binding.config,"diagnosticPath":diagnostic}), Duration::from_secs(5), json!("initialize"))?;
        if snapshot["offline"] != binding.offline {
            return Err(Error::new(
                "initialization_failed",
                "Module did not acknowledge the selected simulation mode",
                "设备模块初始化失败。",
            ));
        }
        Ok(Prepared {
            process,
            descriptor,
            snapshot,
        })
    }
    fn start_locked(&self, slot: &Arc<Slot>) -> Result<Value> {
        let (binding, generation, old) = {
            let mut state = slot.state.lock().unwrap();
            if state.process.as_ref().is_some_and(|p| p.alive()) {
                return Ok(state.view());
            }
            state.generation += 1;
            state.phase = "starting".into();
            state.values = json!({});
            state.value_state = "unknown".into();
            (
                state.binding.clone(),
                state.generation,
                state.process.take(),
            )
        };
        slot.publish();
        if let Some(old) = old {
            old.stop();
        }
        let outcome = (|| -> Result<Prepared> {
            let current = Package::load(&binding.package_path)?;
            let current_version = module_updates::version(&current.manifest.version)?;
            // The app bundle is the supported baseline. A persisted package path
            // must not keep an old module beneath a newly installed frontend.
            // Independently installed newer modules are never downgraded.
            let mut newer = inventory(&self.0.module_root.join(&binding.module_id))?
                .into_iter()
                .filter(|p| p.manifest.id == binding.module_id)
                .filter_map(|p| module_updates::version(&p.manifest.version).ok().map(|v| (v, p)))
                .filter(|(v, _)| v.pre.is_empty() && *v > current_version)
                .collect::<Vec<_>>();
            newer.sort_by(|a, b| b.0.cmp(&a.0));
            if let Some((version, package)) = newer.first() {
                if newer.iter().skip(1).any(|(v, p)| v == version && p.fingerprint != package.fingerprint) {
                    return Err(Error::new("module_selection_required", "Conflicting bundled module packages", "设备模块文件冲突，请重新安装应用。"));
                }
                let package = package.stage(&self.0.data.join("modules"))?;
                let mut updated = binding.clone();
                updated.package_path = package.directory.clone();
                // Verify runtime identity and initialize without opening hardware
                // before changing the saved binding. Failure affects this device only.
                let prepared = self.prepare(slot, &package, &updated, generation)?;
                {
                    let _configuration = self.0.configuration.lock().unwrap();
                    self.save(Some(&updated), None)?;
                    slot.state.lock().unwrap().binding = updated.clone();
                }
                self.0.logger.record("module.bundle_applied", json!({"deviceId":binding.id,"moduleId":binding.module_id,"fromVersion":current.manifest.version,"toVersion":package.manifest.version}));
                Ok(prepared)
            } else {
                self.prepare(slot, &current, &binding, generation)
            }
        })();
        match outcome {
            Ok(prepared) => {
                let mut state = slot.state.lock().unwrap();
                state.apply(&prepared.snapshot);
                state.capabilities = prepared.descriptor["capabilities"].clone();
                state.module_version = prepared.descriptor["version"].as_str().map(str::to_owned);
                state.process = Some(prepared.process);
            }
            Err(error) => {
                let mut state = slot.state.lock().unwrap();
                state.phase = "faulted".into();
                state.error = json!(error);
                drop(state);
                slot.publish();
                return Err(error);
            }
        }
        Ok(slot.publish())
    }
    fn start(&self, slot: &Arc<Slot>) -> Result<Value> {
        let _guard = slot.lifecycle.lock().unwrap();
        self.start_locked(slot)
    }
    fn stop_locked(&self, slot: &Arc<Slot>) -> Value {
        let old = {
            let mut state = slot.state.lock().unwrap();
            state.generation += 1;
            state.phase = "stopped".into();
            state.values = json!({});
            state.error = Value::Null;
            state.value_state = "unknown".into();
            state.process.take()
        };
        let view = slot.publish();
        if let Some(process) = old {
            process.stop();
        }
        view
    }
    fn invoke(
        &self,
        slot: &Arc<Slot>,
        method: &str,
        params: Value,
        timeout: Duration,
        trace: Value,
    ) -> Result<Value> {
        let capability = params
            .get("capability")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let (process, generation, id) = {
            let state = slot.state.lock().unwrap();
            if method.starts_with("capability.") && state.phase != "connected" {
                return Err(Error::new(
                    "not_connected",
                    "Connect before accessing a capability",
                    "请先连接设备。",
                ));
            }
            if let Some(capability) = &capability {
                let operation = method.strip_prefix("capability.").unwrap_or("");
                if !state.capabilities.as_array().is_some_and(|items| {
                    items
                        .iter()
                        .any(|c| c["id"] == *capability && c[operation] == true)
                }) {
                    return Err(Error::new(
                        "unsupported_capability",
                        "Capability does not advertise this operation",
                        "此设备暂不支持这项操作。",
                    ));
                }
            }
            (
                state.process.clone().ok_or_else(|| {
                    Error::new(
                        "not_running",
                        "Start the module first",
                        "请先启动设备模块。",
                    )
                })?,
                state.generation,
                state.binding.id.clone(),
            )
        };
        (self.0.emit)(
            json!({"jsonrpc":"2.0","method":"operations.changed","params":{"deviceId":id,"generation":generation,"requestId":trace,"state":"pending","operation":method}}),
        );
        let result = process.request(method, params, timeout, trace.clone());
        {
            let mut state = slot.state.lock().unwrap();
            if state.generation != generation {
                let error = Error::new(
                    "stale_session",
                    "Response belongs to an old device generation",
                    "设备连接已更新，请重新读取状态。",
                )
                .details(json!({"previousGeneration":generation,"writeSent":"unknown"}));
                drop(state);
                (self.0.emit)(
                    json!({"jsonrpc":"2.0","method":"operations.changed","params":{"deviceId":id,"generation":generation,"requestId":trace,"state":"failed","error":error}}),
                );
                return Err(error);
            }
            match &result {
                Ok(snapshot) if method.starts_with("device.") && snapshot["phase"].is_string() => {
                    state.apply(snapshot)
                }
                Ok(value) => {
                    state.error = Value::Null;
                    if matches!(method, "capability.read" | "capability.write")
                        && value.get("value").is_some()
                    {
                        if let Some(capability) = &capability {
                            state.values[capability] = value.clone();
                            state.value_state = "confirmed".into();
                        }
                    }
                }
                Err(error) => {
                    state.error = json!(error);
                    state.value_state = "stale".into();
                }
            }
        }
        slot.publish();
        (self.0.emit)(
            json!({"jsonrpc":"2.0","method":"operations.changed","params":{"deviceId":id,"generation":generation,"requestId":trace,
            "state":if result.is_ok(){"completed"}else{"failed"},"error":result.as_ref().err()}}),
        );
        result
    }
    fn switch(
        &self,
        slot: &Arc<Slot>,
        params: &Value,
        rebind: bool,
        trace: Value,
    ) -> Result<Value> {
        let _lifecycle = slot.lifecycle.lock().unwrap();
        let (original, generation, connected) = {
            let state = slot.state.lock().unwrap();
            (
                state.binding.clone(),
                state.generation,
                state.phase == "connected",
            )
        };
        match self.switch_locked(slot, params, rebind, trace.clone()) {
            Ok(value) => Ok(value),
            Err(error) => {
                if slot.state.lock().unwrap().generation == generation {
                    return Err(error);
                }
                let restore = self.switch_locked(slot, &json!({"packagePath":original.package_path,"target":original.target,"config":original.config}), true, trace.clone())
                    .and_then(|value| {
                        if connected { self.invoke(slot,"device.connect",json!({}),Duration::from_secs(30),trace)?; }
                        Ok(value)
                    });
                self.0.logger.record("module.rollback",json!({"deviceId":original.id,"cause":error,"restored":restore.is_ok(),"restoreError":restore.as_ref().err()}));
                Err(error
                    .details(json!({"rolledBack":restore.is_ok(),"restoreError":restore.err()})))
            }
        }
    }
    fn switch_locked(
        &self,
        slot: &Arc<Slot>,
        params: &Value,
        rebind: bool,
        trace: Value,
    ) -> Result<Value> {
        let original = slot.state.lock().unwrap().binding.clone();
        let package = self
            .choose_package(params)?
            .stage(&self.0.data.join("modules"))?;
        if !rebind && package.manifest.id != original.module_id {
            return Err(Error::argument(
                "replace requires the same moduleId; use devices.rebind to change hardware family",
            ));
        }
        let mut binding = original;
        binding.module_id = package.manifest.id.clone();
        binding.package_path = package.directory.clone();
        if rebind {
            binding.target = params
                .get("target")
                .cloned()
                .ok_or_else(|| Error::argument("rebind requires target"))?;
            binding.config = params.get("config").cloned().unwrap_or(json!({}));
        }
        if !binding.target.is_object() || !binding.config.is_object() {
            return Err(Error::argument("target/config must be objects"));
        }
        if rebind
            && !binding.offline
            && binding.target["resourceId"]
                .as_str()
                .is_none_or(str::is_empty)
        {
            return Err(Error::new(
                "target_required",
                "Physical rebinding requires a scanned resourceId",
                "请先搜索并选择要连接的设备。",
            ));
        }
        let generation = slot.state.lock().unwrap().generation + 1;
        // Preflight runs without opening hardware; a bad package leaves the old instance intact.
        let prepared = self.prepare(slot, &package, &binding, generation)?;
        let (old, reconnect) = {
            let _configuration = self.0.configuration.lock().unwrap();
            self.save(Some(&binding), None)?;
            let mut state = slot.state.lock().unwrap();
            let reconnect = state.phase == "connected";
            let old = state.process.take();
            state.binding = binding;
            state.generation = generation;
            state.apply(&prepared.snapshot);
            state.capabilities = prepared.descriptor["capabilities"].clone();
            state.module_version = Some(package.manifest.version.clone());
            state.process = Some(prepared.process);
            (old, reconnect)
        };
        slot.publish();
        if let Some(old) = old {
            old.stop();
        }
        if reconnect {
            self.invoke(
                slot,
                "device.connect",
                json!({}),
                Duration::from_secs(30),
                trace,
            )
            .map_err(|e| {
                e.details(json!({"replacementActivated":true,"nextAction":"devices.connect"}))
            })?;
        }
        Ok(slot.state.lock().unwrap().view())
    }
    pub fn dispatch(&self, method: &str, params: Value, trace: Value) -> Result<Value> {
        let _gate = self.0.gate.read().unwrap();
        if self.0.closing.load(Ordering::SeqCst)
            && !matches!(method, "updates.list" | "updates.get" | "hub.describe")
        {
            return Err(Error::new(
                "app_exiting",
                "Host is shutting down",
                "应用正在更新或退出。",
            ));
        }
        if !params.is_object() {
            return Err(Error::argument("params must be an object"));
        }
        self.0.logger.record(
            "api.request",
            json!({"method":method,"params":params,"requestId":trace}),
        );
        let result = self.route(method, &params, trace.clone());
        self.0.logger.record(
            "api.response",
            json!({"method":method,"requestId":trace,"result":result}),
        );
        result
    }
    fn route(&self, method: &str, params: &Value, trace: Value) -> Result<Value> {
        if !crate::METHODS.contains(&method) {
            return Err(Error::new(
                "unknown_method",
                format!("Unknown method: {method}"),
                "暂不支持这项操作。",
            ));
        }
        match method {
            "hub.describe" => {
                return Ok(
                    json!({"name":"DeskHub","version":env!("CARGO_PKG_VERSION"),"protocolVersion":1,"offline":self.0.force_offline,"dataDirectory":self.0.data,"maxFrameBytes":65536,"methods":crate::METHODS}),
                )
            }
            "modules.list" => {
                return Ok(json!(self
                    .packages()?
                    .iter()
                    .map(module_updates::view)
                    .collect::<Vec<_>>()))
            }
            "modules.inspect" => {
                let p = self.choose_package(params)?;
                return Ok(
                    json!({"manifest":p.manifest,"packagePath":p.directory,"fingerprint":p.fingerprint}),
                );
            }
            "modules.catalog" | "modules.checkUpdates" => {
                let catalog = self.0.updates.check()?;
                let packages = self.packages()?;
                let devices = self.route("devices.list", &json!({}), Value::Null)?;
                let releases: Vec<_> = catalog.modules.iter().map(|r| {
                    let installed: Vec<_> = packages.iter().filter(|p|p.manifest.id==r.module_id).map(|p|p.manifest.version.clone()).collect();
                    let affected: Vec<_> = devices.as_array().unwrap().iter().filter(|d| d["moduleId"]==r.module_id).map(|d|json!({"deviceId":d["id"],"version":d["moduleVersion"]})).collect();
                    let compatible = r.protocol_version==1 && r.platform=="windows-x86_64" && module_updates::version(&r.minimum_hub_version).unwrap() <= module_updates::version(env!("CARGO_PKG_VERSION")).unwrap();
                    let available = installed.iter().filter_map(|s|module_updates::version(s).ok()).max().is_none_or(|v|v<module_updates::version(&r.version).unwrap());
                    json!({"release":r,"installedVersions":installed,"devices":affected,"compatible":compatible,"available":available})
                }).collect();
                return Ok(json!({"releases":releases}));
            }
            "updates.list" => return Ok(json!(self.0.downloads.list())),
            "updates.get" => {
                return Ok(json!(self
                    .0
                    .downloads
                    .get(error::string(params, "jobId")?)?))
            }
            "updates.cancel" => {
                return Ok(json!(self
                    .0
                    .downloads
                    .cancel(error::string(params, "jobId")?)?))
            }
            "modules.download" => {
                let release = self.0.updates.select(
                    error::string(params, "moduleId")?,
                    params
                        .get("version")
                        .map(|_| error::string(params, "version"))
                        .transpose()?,
                )?;
                let job = self.0.downloads.create(
                    "module",
                    &release.module_id,
                    &release.version,
                    release.artifact,
                )?;
                let downloads = self.0.downloads.clone();
                let id = job.id.clone();
                self.0.downloads.spawn(job.id.clone(), move || {
                    downloads.download(&id)?;
                    Ok(("ready", json!({})))
                });
                return Ok(json!(job));
            }
            "modules.install" => {
                let job_id = error::string(params, "jobId")?;
                let job = self.0.downloads.get(job_id)?;
                let device_id = params
                    .get("deviceId")
                    .map(|_| error::string(params, "deviceId").map(str::to_owned))
                    .transpose()?;
                if let Some(id) = &device_id {
                    let slot = self.slot(id)?;
                    let state = slot.state.lock().unwrap();
                    if state.binding.module_id != job.subject {
                        return Err(Error::argument(
                            "The selected device uses a different module",
                        ));
                    }
                    let old = Package::load(&state.binding.package_path)?;
                    if module_updates::version(&job.version)?
                        < module_updates::version(&old.manifest.version)?
                    {
                        return Err(Error::argument(
                            "Online module installation cannot downgrade a device",
                        ));
                    }
                }
                let job = self.0.downloads.begin_install(job_id, "module")?;
                let hub = self.clone();
                let id = job.id.clone();
                self.0.downloads.spawn(id.clone(), move || {
                    let unpacked = module_updates::unpack(&hub.0.downloads, &id)?;
                    let package = unpacked.package()?.stage(&hub.0.data.join("modules"))?;
                    let device = if let Some(device_id) = device_id {
                        Some(hub.dispatch(
                            "devices.replace",
                            json!({"deviceId":device_id,"packagePath":package.directory}),
                            json!(id),
                        )?)
                    } else {
                        None
                    };
                    Ok((
                        "completed",
                        json!({"package":module_updates::view(&package),"device":device}),
                    ))
                });
                return Ok(json!(job));
            }
            "devices.list" => {
                return Ok(json!(self
                    .0
                    .slots
                    .lock()
                    .unwrap()
                    .values()
                    .map(|slot| slot.state.lock().unwrap().view())
                    .collect::<Vec<_>>()))
            }
            "devices.add" => {
                let id = error::string(params, "id")?;
                if !error::valid_id(id) {
                    return Err(Error::argument("Invalid device ID"));
                }
                let label = params.get("label").and_then(Value::as_str).unwrap_or(id);
                if label.len() > 240 {
                    return Err(Error::argument("Label is too long"));
                }
                if params.get("offline").is_some_and(|v| !v.is_boolean()) {
                    return Err(Error::argument("offline must be boolean"));
                }
                let package = self
                    .choose_package(params)?
                    .stage(&self.0.data.join("modules"))?;
                let binding = Binding {
                    id: id.into(),
                    label: label.into(),
                    module_id: package.manifest.id.clone(),
                    package_path: package.directory,
                    offline: self.0.force_offline || params["offline"].as_bool().unwrap_or(false),
                    target: params.get("target").cloned().unwrap_or(json!({})),
                    config: params.get("config").cloned().unwrap_or(json!({})),
                };
                if !binding.target.is_object() || !binding.config.is_object() {
                    return Err(Error::argument("target/config must be objects"));
                }
                let _configuration = self.0.configuration.lock().unwrap();
                if self.0.slots.lock().unwrap().contains_key(id) {
                    return Err(Error::new(
                        "duplicate_device",
                        "Device ID already exists",
                        "这个设备名称已经被使用。",
                    ));
                }
                self.save(Some(&binding), None)?;
                let slot = Arc::new(Slot::new(binding, self.0.emit.clone()));
                self.0.slots.lock().unwrap().insert(id.into(), slot.clone());
                return Ok(slot.publish());
            }
            "diagnostics.export" => return self.export(),
            "diagnostics.report" => {
                let context = error::string(params, "context")?;
                let detail = error::string(params, "detail")?;
                if context.len() > 256 || detail.len() > 16 * 1024 {
                    return Err(Error::argument("Diagnostic entry is too large"));
                }
                self.0
                    .logger
                    .record("frontend.error", json!({"context":context,"detail":detail}));
                return Ok(json!({"recorded":true}));
            }
            _ => {}
        }
        let id = error::string(params, "deviceId")?;
        let slot = self.slot(id)?;
        let timeout_ms = params
            .get("timeoutMs")
            .map(|v| {
                v.as_u64()
                    .ok_or_else(|| Error::argument("timeoutMs must be an integer"))
            })
            .transpose()?
            .unwrap_or(30_000);
        if !(50..=60_000).contains(&timeout_ms) {
            return Err(Error::argument("timeoutMs must be between 50 and 60000"));
        }
        let timeout = Duration::from_millis(timeout_ms);
        match method {
            "devices.get" => Ok(slot.state.lock().unwrap().view()),
            "devices.start" => self.start(&slot),
            "devices.stop" => {
                let _guard = slot.lifecycle.lock().unwrap();
                Ok(self.stop_locked(&slot))
            }
            "devices.restart" => {
                let _guard = slot.lifecycle.lock().unwrap();
                let connected = slot.state.lock().unwrap().phase == "connected";
                self.stop_locked(&slot);
                self.start_locked(&slot)?;
                if connected {
                    self.invoke(&slot, "device.connect", json!({}), timeout, trace)?;
                }
                Ok(slot.state.lock().unwrap().view())
            }
            "devices.replace" => self.switch(&slot, params, false, trace),
            "devices.rebind" => self.switch(&slot, params, true, trace),
            "devices.rename" => {
                let _guard = slot.lifecycle.lock().unwrap();
                let _configuration = self.0.configuration.lock().unwrap();
                let label = error::string(params, "label")?;
                if label.is_empty() || label.len() > 240 {
                    return Err(Error::argument("Invalid device label"));
                }
                let mut binding = slot.state.lock().unwrap().binding.clone();
                binding.label = label.into();
                self.save(Some(&binding), None)?;
                slot.state.lock().unwrap().binding = binding;
                Ok(slot.publish())
            }
            "devices.remove" => {
                let _guard = slot.lifecycle.lock().unwrap();
                let _configuration = self.0.configuration.lock().unwrap();
                self.save(None, Some(id))?;
                self.stop_locked(&slot);
                self.0.slots.lock().unwrap().remove(id);
                (self.0.emit)(
                    json!({"jsonrpc":"2.0","method":"devices.removed","params":{"deviceId":id}}),
                );
                Ok(json!({"removed":true}))
            }
            "devices.scan" | "devices.connect" => {
                if method == "devices.connect" {
                    let state = slot.state.lock().unwrap();
                    if !state.binding.offline
                        && state.binding.target["resourceId"]
                            .as_str()
                            .is_none_or(str::is_empty)
                    {
                        return Err(Error::new("target_required", "Scan and bind an explicit resourceId before connecting a physical device", "请先搜索并选择要连接的设备。"));
                    }
                }
                self.start(&slot)?;
                let response = self.invoke(
                    &slot,
                    if method == "devices.scan" {
                        "device.scan"
                    } else {
                        "device.connect"
                    },
                    params.get("arguments").cloned().unwrap_or(json!({})),
                    timeout,
                    trace,
                )?;
                if method == "devices.connect" {
                    Ok(slot.state.lock().unwrap().view())
                } else {
                    Ok(response)
                }
            }
            "devices.disconnect" | "devices.refresh" => {
                self.invoke(
                    &slot,
                    if method == "devices.disconnect" {
                        "device.disconnect"
                    } else {
                        "device.snapshot"
                    },
                    json!({}),
                    timeout,
                    trace,
                )?;
                Ok(slot.state.lock().unwrap().view())
            }
            "devices.read" | "devices.write" | "devices.invoke" => {
                let capability = error::string(params, "capability")?;
                let mut arguments = json!({"capability":capability});
                let operation = match method {
                    "devices.read" => "capability.read",
                    "devices.write" => {
                        arguments["value"] = params
                            .get("value")
                            .cloned()
                            .ok_or_else(|| Error::argument("value is required"))?;
                        "capability.write"
                    }
                    _ => {
                        arguments["arguments"] =
                            params.get("arguments").cloned().unwrap_or(json!({}));
                        "capability.invoke"
                    }
                };
                self.invoke(&slot, operation, arguments, timeout, trace)
            }
            _ => Err(Error::new(
                "unknown_method",
                format!("Unknown method: {method}"),
                "暂不支持这项操作。",
            )),
        }
    }
    fn export(&self) -> Result<Value> {
        let destination = self
            .0
            .data
            .join("exports")
            .join(format!("deskhub-{}", now_ms()));
        std::fs::create_dir_all(destination.join("logs"))?;
        // Log files are individually bounded; export uses a byte copy and does not stop devices.
        for entry in std::fs::read_dir(self.0.data.join("logs"))? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                std::fs::copy(
                    entry.path(),
                    destination.join("logs").join(entry.file_name()),
                )?;
            }
        }
        let devices = self.route("devices.list", &json!({}), Value::Null)?;
        atomic_json(
            &destination.join("summary.json"),
            &json!({"version":env!("CARGO_PKG_VERSION"),"capturedAtUnixMs":now_ms(),"devices":devices,"updates":self.0.downloads.list()}),
        )?;
        Ok(json!({"directory":destination}))
    }
    pub fn shutdown(&self) {
        self.0.closing.store(true, Ordering::SeqCst);
        self.0.downloads.close();
        let _gate = self.0.gate.write().unwrap();
        let slots: Vec<_> = self.0.slots.lock().unwrap().values().cloned().collect();
        let mut threads = Vec::new();
        for slot in slots {
            let hub = self.clone();
            threads.push(std::thread::spawn(move || {
                let _guard = slot.lifecycle.lock().unwrap();
                hub.stop_locked(&slot);
            }));
        }
        for thread in threads {
            let _ = thread.join();
        }
        self.0.logger.record("backend.stop", json!({}));
    }
    pub fn resume(&self) {
        self.0.downloads.reopen();
        self.0.closing.store(false, Ordering::SeqCst);
    }
    pub fn downloads(&self) -> Downloads {
        self.0.downloads.clone()
    }
    pub fn record(&self, event: &str, data: Value) {
        self.0.logger.record(event, data);
    }
    pub fn update_config(&self) -> UpdateConfig {
        self.0.updates.config.clone()
    }
    fn packages(&self) -> Result<Vec<Package>> {
        let mut packages = inventory(&self.0.module_root)?;
        packages.extend(inventory(&self.0.data.join("modules"))?);
        packages.sort_by(|a, b| a.fingerprint.cmp(&b.fingerprint));
        packages.dedup_by(|a, b| a.fingerprint == b.fingerprint);
        Ok(packages)
    }
}
