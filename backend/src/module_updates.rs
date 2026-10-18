use crate::downloads::{
    fetch_small, update_error, verify_signature, Artifact, Downloads, UpdateConfig,
};
use crate::error::{Error, Result};
use crate::manifest::Package;
use crate::storage::atomic_json;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{Cursor, Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Release {
    pub module_id: String,
    pub name: String,
    pub version: String,
    pub minimum_hub_version: String,
    pub protocol_version: u32,
    pub platform: String,
    pub notes: String,
    pub artifact: Artifact,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub modules: Vec<Release>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
}
pub struct ModuleUpdates {
    pub config: UpdateConfig,
    catalog: Mutex<Option<Catalog>>,
    cache: PathBuf,
}
impl ModuleUpdates {
    pub fn new(config: UpdateConfig, cache: PathBuf) -> Self {
        Self {
            config,
            catalog: Mutex::new(None),
            cache,
        }
    }
    fn decode(&self, bytes: &[u8]) -> Result<Catalog> {
        let envelope: Envelope = serde_json::from_slice(bytes)?;
        let payload = STANDARD
            .decode(&envelope.payload)
            .map_err(|e| Error::argument(e.to_string()))?;
        if payload.len() > 512 * 1024 {
            return Err(Error::argument("Catalog is too large"));
        }
        verify_signature(&payload, &envelope.signature, &self.config.public_key)?;
        let catalog: Catalog = serde_json::from_slice(&payload)?;
        if catalog.schema_version != 1 || catalog.modules.len() > 128 {
            return Err(Error::argument("Unsupported catalog schema/size"));
        }
        let mut identities = HashSet::new();
        for module in &catalog.modules {
            if !crate::error::valid_id(&module.module_id)
                || !identities.insert((&module.module_id, &module.version, &module.platform))
            {
                return Err(Error::argument("Invalid or duplicate catalog entry"));
            }
            version(&module.version)?;
            version(&module.minimum_hub_version)?;
            module.artifact.validate()?;
        }
        Ok(catalog)
    }
    pub fn check(&self) -> Result<Catalog> {
        let bytes = fetch_small(&self.config.module_catalog, 1024 * 1024)?;
        let catalog = self.decode(&bytes)?;
        std::fs::create_dir_all(self.cache.parent().unwrap())?;
        atomic_json(&self.cache, &serde_json::from_slice(&bytes)?)?;
        *self.catalog.lock().unwrap() = Some(catalog.clone());
        Ok(catalog)
    }
    pub fn select(&self, id: &str, requested_version: Option<&str>) -> Result<Release> {
        let cached = self.catalog.lock().unwrap().clone();
        let catalog = match cached {
            Some(c) => c,
            None => self.check()?,
        };
        let mut releases: Vec<_> = catalog
            .modules
            .into_iter()
            .filter(|r| {
                r.module_id == id
                    && r.platform == "windows-x86_64"
                    && requested_version.map_or_else(
                        || version(&r.version).is_ok_and(|v| v.pre.is_empty()),
                        |v| v == r.version,
                    )
            })
            .collect();
        releases.sort_by_key(|r| version(&r.version).unwrap());
        let release = releases.pop().ok_or_else(|| {
            Error::new(
                "release_not_found",
                "No matching module release",
                "没有找到适用于这台电脑的模块版本。",
            )
        })?;
        if release.protocol_version != 1
            || version(&release.minimum_hub_version)? > version(env!("CARGO_PKG_VERSION"))?
        {
            return Err(Error::new(
                "incompatible_module",
                "Module requires a newer DeskHub/protocol",
                "请先更新 DeskHub，再安装这个模块。",
            ));
        }
        Ok(release)
    }
}
pub fn version(value: &str) -> Result<semver::Version> {
    semver::Version::parse(value).map_err(|e| Error::argument(e.to_string()))
}

/// Extract only regular, uniquely named, manifest-declared files within this operation's directory.
pub fn unpack(downloads: &Downloads, job_id: &str) -> Result<Extracted> {
    let bytes = downloads.bytes(job_id)?;
    let path = downloads.path(job_id)?.parent().unwrap().join("unpacked");
    std::fs::create_dir(&path)?;
    let guard = Extracted(path);
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| update_error("package_corrupt", e))?;
    if archive.len() == 0 || archive.len() > 256 {
        return Err(Error::argument("Module archive must contain 1..256 files"));
    }
    let mut names = HashSet::new();
    let mut expanded = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| update_error("package_corrupt", e))?;
        let name = entry.name().replace('\\', "/");
        if entry.is_dir() {
            continue;
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
            || !safe_path(&name)
            || !names.insert(name.to_ascii_lowercase())
        {
            return Err(Error::argument(
                "Archive contains a link, duplicate or unsafe path",
            ));
        }
        expanded = expanded
            .checked_add(entry.size())
            .ok_or_else(|| Error::argument("Archive size overflow"))?;
        if expanded > 256 * 1024 * 1024 {
            return Err(Error::argument("Expanded module exceeds 256 MiB"));
        }
        let destination = guard.0.join(&name);
        std::fs::create_dir_all(destination.parent().unwrap())?;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&destination)?;
        let limit = entry.size();
        let count = std::io::copy(&mut entry.by_ref().take(limit + 1), &mut file)?;
        if count != limit {
            return Err(update_error("package_corrupt", "ZIP entry length mismatch"));
        }
        file.flush()?;
    }
    let package = Package::load(&guard.0)?;
    let expected: HashSet<_> = package
        .manifest
        .files
        .keys()
        .map(|s| s.replace('\\', "/").to_ascii_lowercase())
        .chain(["module.json".into()])
        .collect();
    if expected != names {
        return Err(Error::argument(
            "Archive files differ from the module manifest",
        ));
    }
    let job = downloads.get(job_id)?;
    if package.manifest.id != job.subject || package.manifest.version != job.version {
        return Err(update_error(
            "package_corrupt",
            "Package identity differs from signed catalog",
        ));
    }
    Ok(guard)
}
fn safe_path(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 240
        && name.split('/').all(|part| {
            let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with([' ', '.'])
                && !part.chars().any(|c| c < ' ' || ":*?\"<>|".contains(c))
                && !matches!(
                    base.as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
}
pub struct Extracted(PathBuf);
impl Extracted {
    pub fn package(&self) -> Result<Package> {
        Package::load(&self.0)
    }
}
impl Drop for Extracted {
    fn drop(&mut self) {
        // This directory was created by unpack(), and the extractor forbids links.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
pub fn view(package: &Package) -> Value {
    json!({"manifest":package.manifest,"packagePath":package.directory,"fingerprint":package.fingerprint})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_paths_follow_windows_rules() {
        for name in [
            "../escape",
            "x/../../escape",
            "C:/escape",
            "/root",
            "NUL.txt",
            "a:stream",
            "a./file",
            "a//b",
        ] {
            assert!(!safe_path(name), "{name}");
        }
        assert!(safe_path("bin/module.exe"));
    }
}
