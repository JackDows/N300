import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, '../../apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
const endpoint = new URL(config.plugins.updater.endpoints[0]);
const repository = endpoint.hostname === 'github.com' && endpoint.pathname.match(/^\/([^/]+\/[^/]+)\/releases\//)?.[1];
if (!repository) throw new Error('Configure a GitHub release endpoint first');
const version = config.version;
const directory = resolve(root, 'artifacts/updates', version);
const installer = `N300_${version}_x64-setup.exe`;
const filenames = [installer, installer + '.sig', 'latest.json', 'SHA256SUMS'];
const files = new Map(filenames.map((name) => [name, readFileSync(resolve(directory, name))]));
const manifest = JSON.parse(files.get('latest.json'));
const url = `https://github.com/${repository}/releases/download/v${version}/${installer}`;
if (manifest.version !== version || manifest.platforms['windows-x86_64'].url !== url
    || manifest.platforms['windows-x86_64'].signature !== files.get(installer + '.sig').toString().trim()) {
  throw new Error('Update metadata does not match this release; run Build Release again');
}
const digest = createHash('sha256').update(files.get(installer)).digest('hex');
if (files.get('SHA256SUMS').toString().trim() !== `${digest}  ${installer}`) throw new Error('Installer checksum mismatch');

let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  // Read credentials via Git's configured helper. Never write or print the token.
  const credential = spawnSync('git', ['-c', 'credential.interactive=false', 'credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (credential.status !== 0) throw new Error('Sign into GitHub using Git, or set GH_TOKEN for publishing');
  token = credential.stdout.match(/^password=(.+)$/m)?.[1];
}
if (!token) throw new Error('GitHub publishing credential unavailable');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'N300-release' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
const tag = `v${version}`;
const releases = await api(`/repos/${repository}/releases?per_page=100`);
let release = releases.find((item) => item.tag_name === tag);
if (release && !release.draft) throw new Error(`${tag} is already published; bump the version instead of replacing installed releases`);
release ??= await api(`/repos/${repository}/releases`, 'POST', { tag_name: tag, name: `N300 ${version}`, body: manifest.notes, draft: true });
const upload = new URL(release.upload_url.split('{')[0]);
if (upload.origin !== 'https://uploads.github.com') throw new Error('Unexpected upload endpoint');
for (const [name, bytes] of files) {
  const previous = release.assets?.find((asset) => asset.name === name);
  if (previous) await api(`/repos/${repository}/releases/assets/${previous.id}`, 'DELETE');
  const target = new URL(upload); target.searchParams.set('name', name);
  const response = await fetch(target, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes });
  if (!response.ok) throw new Error(`Upload ${name}: ${response.status} ${await response.text()}`);
}
if (process.argv.includes('--publish')) release = await api(`/repos/${repository}/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true' });
console.log(`${release.draft ? 'Draft' : 'Published'}: ${release.html_url}`);
