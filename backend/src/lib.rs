//! DeskHub's UI-independent, per-device process supervisor.
pub mod downloads;
pub mod error;
pub mod hub;
pub mod manifest;
pub mod module_updates;
pub mod process;
pub mod storage;
pub use hub::{Events, Hub};
pub const METHODS: &[&str] = &[
    "hub.describe",
    "modules.list",
    "modules.inspect",
    "modules.catalog",
    "modules.checkUpdates",
    "modules.download",
    "modules.install",
    "updates.list",
    "updates.get",
    "updates.cancel",
    "devices.list",
    "devices.add",
    "devices.get",
    "devices.start",
    "devices.stop",
    "devices.restart",
    "devices.replace",
    "devices.rebind",
    "devices.rename",
    "devices.remove",
    "devices.scan",
    "devices.connect",
    "devices.disconnect",
    "devices.refresh",
    "devices.read",
    "devices.write",
    "devices.invoke",
    "diagnostics.export",
    "diagnostics.report",
];
