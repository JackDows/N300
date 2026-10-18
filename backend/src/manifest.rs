use crate::error::{valid_id, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
static STAGING: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub protocol_version: u32,
    pub executable: String,
    #[serde(default)]
    pub transport: Vec<String>,
    pub files: BTreeMap<String, String>,
}
#[derive(Clone, Debug)]
pub struct Package {
    pub manifest: Manifest,
    pub directory: PathBuf,
    pub executable: PathBuf,
    pub fingerprint: String,
}
fn relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\0', ':'])
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}
impl Package {
    pub fn load(path: &Path) -> Result<Self> {
        let manifest_path = if path.is_dir() {
            path.join("module.json")
        } else {
            path.to_owned()
        };
        let manifest_path = manifest_path.canonicalize()?;
        let directory = manifest_path
            .parent()
            .ok_or_else(|| Error::argument("Missing package directory"))?
            .to_owned();
        let bytes = std::fs::read(&manifest_path)?;
        if bytes.len() > 64 * 1024 {
            return Err(Error::argument("Manifest exceeds 64 KiB"));
        }
        let manifest: Manifest = serde_json::from_slice(&bytes)?;
        if !valid_id(&manifest.id) || !valid_id(&manifest.version) {
            return Err(Error::argument("Invalid module ID/version"));
        }
        if manifest.protocol_version != 1 {
            return Err(Error::new(
                "incompatible_module",
                "Only module protocol version 1 is supported",
                "这个模块版本与 DeskHub 不兼容。",
            ));
        }
        if !relative(&manifest.executable) || !manifest.files.contains_key(&manifest.executable) {
            return Err(Error::argument(
                "Executable must be a checksummed package-relative file",
            ));
        }
        for (name, expected) in &manifest.files {
            if !relative(name) || expected.len() != 64 {
                return Err(Error::argument("Invalid package file entry"));
            }
            let file = directory.join(name).canonicalize()?;
            if !file.starts_with(&directory) || !file.is_file() {
                return Err(Error::argument("Package file escaped its directory"));
            }
            let actual = format!("{:x}", Sha256::digest(std::fs::read(&file)?));
            if &actual != expected {
                return Err(Error::new(
                    "package_corrupt",
                    format!("SHA-256 mismatch: {name}"),
                    "模块文件校验失败，请重新获取完整模块包。",
                ));
            }
        }
        let executable = directory.join(&manifest.executable).canonicalize()?;
        let fingerprint = format!("{:x}", Sha256::digest(serde_json::to_vec(&manifest)?));
        Ok(Self {
            manifest,
            directory,
            executable,
            fingerprint,
        })
    }
    pub fn stage(&self, root: &Path) -> Result<Self> {
        let _staging = STAGING.lock().unwrap();
        let destination = root
            .join(&self.manifest.id)
            .join(&self.manifest.version)
            .join(&self.fingerprint[..16]);
        if destination.join("module.json").exists() {
            return Self::load(&destination);
        }
        std::fs::create_dir_all(&destination)?;
        for name in self.manifest.files.keys() {
            let to = destination.join(name);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(self.directory.join(name), to)?;
        }
        std::fs::write(
            destination.join("module.json"),
            serde_json::to_vec_pretty(&self.manifest)?,
        )?;
        Self::load(&destination)
    }
}
pub fn inventory(root: &Path) -> Result<Vec<Package>> {
    let mut result = Vec::new();
    if !root.exists() {
        return Ok(result);
    }
    fn visit(root: &Path, depth: usize, result: &mut Vec<Package>) -> Result<()> {
        if root.join("module.json").is_file() {
            result.push(Package::load(root)?);
            return Ok(());
        }
        if depth == 0 {
            return Ok(());
        }
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                visit(&entry.path(), depth - 1, result)?;
            }
        }
        Ok(())
    }
    visit(root, 4, &mut result)?;
    result.sort_by(|a, b| {
        (&a.manifest.id, &a.manifest.version).cmp(&(&b.manifest.id, &b.manifest.version))
    });
    Ok(result)
}
