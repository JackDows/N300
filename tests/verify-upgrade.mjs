// Explicit installation integration test. Run against an already installed older
// N300 build which has the updater. This does not run as part of ordinary Test.
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createPort } from 'node:net';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '..');
const { chromium, expect } = createRequire(join(root, 'desktop/package.json'))('@playwright/test');
const exe = process.env.N300_UPGRADE_TEST_EXE;
if (!exe || !existsSync(exe)) throw new Error('Set N300_UPGRADE_TEST_EXE to the installed older N300Desk.exe');
const version = JSON.parse(readFileSync(join(root, 'desktop/src-tauri/tauri.conf.json'), 'utf8')).version;
const directory = join(root, 'artifacts/updates', version);
const manifest = JSON.parse(readFileSync(join(directory, 'latest.json'), 'utf8'));
const filename = `N300_${version}_x64-setup.exe`;
const bytes = readFileSync(join(directory, filename));
let feedUrl;
const feed = createServer((request, response) => {
  if (request.url === '/latest.json') {
    const current = structuredClone(manifest);
    current.platforms['windows-x86_64'].url = feedUrl + '/update.exe';
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(current));
  } else if (request.url === '/update.exe') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length });
    response.end(bytes);
  } else { response.writeHead(404).end(); }
});
feed.listen(0, '127.0.0.1'); await once(feed, 'listening');
feedUrl = `http://127.0.0.1:${feed.address().port}`;
const portServer = createPort(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
const port = portServer.address().port; await new Promise((done) => portServer.close(done));
const endpoint = `http://127.0.0.1:${port}`;
const profile = join(root, 'artifacts/validation/webview', `upgrade-${Date.now()}`); mkdirSync(profile, { recursive: true });
const cache = join(process.env.LOCALAPPDATA, 'n300/target.json');
const hash = () => existsSync(cache) ? createHash('sha256').update(readFileSync(cache)).digest('hex') : null;
const cacheBefore = hash();
const tempPrefix = `N300-${version}-updater-`;
const folders = () => readdirSync(tmpdir()).filter((name) => name.startsWith(tempPrefix));
const before = folders();
const env = { ...process.env, N300_OFFLINE: '1', N300_UPDATE_URL: feedUrl + '/latest.json', WEBVIEW2_USER_DATA_FOLDER: profile,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` };
delete env.N300_EXE;
let browser, page, app, currentPid;
const processes = () => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '@(Get-CimInstance Win32_Process -Filter "Name = \'N300Desk.exe\' OR Name = \'n300.exe\'" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true }).trim();
  const result = JSON.parse(output || '[]');
  return Array.isArray(result) ? result : [result];
};
const samePath = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const connect = async () => {
  await expect.poll(() => fetch(endpoint + '/json/version').then((r) => r.json()).catch(() => null), { timeout: 30000 }).not.toBeNull();
  browser = await chromium.connectOverCDP(endpoint);
  await expect.poll(() => browser.contexts().flatMap((c) => c.pages()).length).toBeGreaterThan(0);
  page = browser.contexts().flatMap((c) => c.pages())[0];
  await page.locator('.titlebar').waitFor();
};
try {
  if (processes().some((p) => samePath(p.ExecutablePath, exe))) throw new Error('Close the installed app before this test');
  app = spawn(exe, ['--offline'], { env, cwd: resolve(exe, '..'), stdio: 'ignore', windowsHide: true });
  currentPid = app.pid;
  await connect();
  const oldVersion = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('update_info'));
  expect(oldVersion.version).not.toBe(version);
  await expect(page.getByRole('slider', { name: '音量' })).toHaveAttribute('aria-valuenow', '8');
  const oldCore = processes().find((p) => p.ParentProcessId === app.pid && p.ExecutablePath?.endsWith('n300.exe'));
  expect(oldCore).toBeDefined();
  await page.evaluate(() => localStorage.setItem('upgrade-preservation-check', 'preserved'));
  // Let the real startup check announce the update without clicking Check.
  await expect(page.getByRole('complementary', { name: '更新提醒' })).toContainText(version, { timeout: 40000 });
  await page.getByRole('button', { name: '查看更新', exact: true }).click();
  const panel = page.getByRole('region', { name: '软件更新' });
  await expect(panel).toContainText(version);
  await page.screenshot({ path: join(root, 'artifacts/validation/upgrade-offer.png') });
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith('/update_install')) window.__upgradeResponse = await response.clone().text();
      return response;
    };
  });
  await panel.getByRole('button', { name: '下载并更新', exact: true }).click();
  await expect.poll(() => app.exitCode, { timeout: 30000 }).toBe(0);
  await browser.close(); browser = undefined;
  await expect.poll(() => processes().filter((p) => samePath(p.ExecutablePath, exe) && p.ProcessId !== app.pid).length, { timeout: 60000 }).toBe(1);
  currentPid = processes().find((p) => samePath(p.ExecutablePath, exe)).ProcessId;
  await connect();
  const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('update_info'));
  expect(info.version).toBe(version);
  expect(info.lastResult).toBe(`已更新到 ${version}`);
  expect(await page.evaluate(() => localStorage.getItem('upgrade-preservation-check'))).toBe('preserved');
  expect(hash()).toBe(cacheBefore);
  expect(processes().some((p) => p.ProcessId === oldCore.ProcessId)).toBe(false);
  await expect(page.getByRole('slider', { name: '音量' })).toHaveAttribute('aria-valuenow', '8');
  await expect.poll(() => folders().filter((name) => !before.includes(name)), { timeout: 120000 }).toEqual([]);
  expect(existsSync(join(process.env.LOCALAPPDATA, 'local.n300.desktop/pending-update.json'))).toBe(false);
  await page.getByRole('navigation', { name: '页面' }).getByRole('button', { name: '设置' }).click();
  await page.getByRole('region', { name: '软件更新' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(root, 'artifacts/validation/upgrade-complete.png') });
  const result = { before: oldVersion.version, after: info.version, installation: exe,
    cachePreserved: true, webviewSettingsPreserved: true, oldCoreExited: true, installerDeleted: true, restarted: true };
  writeFileSync(join(root, 'artifacts/validation/upgrade-roundtrip.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (page && !page.isClosed()) {
    console.error(await page.locator('#software-update').innerText().catch(() => 'Update page unavailable'));
    console.error(await page.evaluate(() => window.__upgradeResponse).catch(() => 'IPC response unavailable'));
    await page.screenshot({ path: join(root, 'artifacts/validation/upgrade-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (page && !page.isClosed()) await page.getByRole('button', { name: '关闭', exact: true }).click().catch(() => {});
  if (currentPid) {
    await expect.poll(() => processes().some((p) => p.ProcessId === currentPid), { timeout: 10000 }).toBe(false).catch(() => { try { process.kill(currentPid); } catch {} });
  }
  await browser?.close();
  await new Promise((done) => feed.close(done));
}
