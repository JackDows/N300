import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, 'desktop/src-tauri/tauri.conf.json'), 'utf8'));
const version = config.version;
const npm = JSON.parse(readFileSync(resolve(root, 'desktop/package.json'), 'utf8'));
const rust = readFileSync(resolve(root, 'desktop/src-tauri/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1];
if (npm.version !== version || rust !== version) throw new Error('Desktop version fields must match');
const endpoint = new URL(config.plugins.updater.endpoints[0]);
const repo = endpoint.pathname.match(/^\/([^/]+\/[^/]+)\/releases\//)?.[1];
if (endpoint.hostname !== 'github.com' || !repo) throw new Error('Configure the GitHub release endpoint before packaging updates');
const directory = resolve(root, 'artifacts/updates', version);
mkdirSync(directory, { recursive: true });
const filename = `N300_${version}_x64-setup.exe`;
const source = resolve(root, 'artifacts/installers/Release', filename);
const signature = readFileSync(source + '.sig', 'utf8').trim();
const notes = readFileSync(resolve(root, 'packaging/release-notes.md'), 'utf8').trim();
const manifest = { version, notes, pub_date: new Date().toISOString(), platforms: {
  'windows-x86_64': { signature, url: `https://github.com/${repo}/releases/download/v${version}/${filename}` },
} };
copyFileSync(source, resolve(directory, filename));
copyFileSync(source + '.sig', resolve(directory, filename + '.sig'));
writeFileSync(resolve(directory, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(resolve(directory, 'SHA256SUMS'), createHash('sha256').update(readFileSync(source)).digest('hex') + '  ' + filename + '\n');
console.log(`Signed update ready: ${directory}`);
