import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const config = process.env.N300_TEST_CONFIGURATION ?? "Debug";
const exe = process.env.N300_DESKTOP_TEST_EXE ?? join(root, "artifacts/desktop", config, "N300Desk.exe");
let app: ChildProcess;
let browser: Browser;
let page: Page;
const errors: string[] = [];
test.describe.configure({ mode: "serial" });

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function screenshot(name: string) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
  await page.screenshot({ path: join(root, "artifacts/validation", `desktop-${config}-${name}.png`) });
}

function children() {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${app.pid}" | Where-Object Name -eq 'n300.exe' | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress`], { encoding: "utf8" }).trim() || "[]");
}
function coreChildren(): { ProcessId: number; CommandLine: string }[] {
  const result = children(); return Array.isArray(result) ? result : [result];
}

test.beforeAll(async () => {
  expect(existsSync(exe), "Run Build before Test").toBe(true);
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port; await new Promise<void>((done) => server.close(() => done()));
  const profile = join(root, "artifacts/validation/webview", `${config}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const env = { ...process.env, N300_OFFLINE: "1", WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` };
  delete env.N300_EXE;
  app = spawn(exe, ["--offline"], { env, cwd: resolve(exe, ".."), stdio: "ignore", windowsHide: true });
  app.on("error", (error) => errors.push(error.message));
  const endpoint = `http://127.0.0.1:${port}`;
  await expect.poll(async () => fetch(endpoint + "/json/version").then((r) => r.ok).catch(() => false), { timeout: 30_000 }).toBe(true);
  browser = await chromium.connectOverCDP(endpoint);
  await expect.poll(() => browser.contexts().flatMap((c) => c.pages()).length).toBeGreaterThan(0);
  page = browser.contexts().flatMap((c) => c.pages())[0];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("slider", { name: "音量" })).toHaveAttribute("aria-valuenow", "8");
  await expect(page.getByText("离线演示", { exact: true })).toBeVisible();
  expect(coreChildren()).toHaveLength(1);
  expect(coreChildren()[0].CommandLine).toContain("--offline");
});

test.afterAll(async () => {
  if (page && !page.isClosed()) await page.screenshot({ path: join(root, "artifacts/validation", `desktop-${config}.png`) });
  if (page && !page.isClosed()) await page.getByRole("button", { name: "关闭", exact: true }).click();
  if (app && app.exitCode === null) {
    await Promise.race([once(app, "exit"), new Promise((done) => setTimeout(done, 5000))]);
  }
  if (app && app.exitCode === null) app.kill();
  await browser?.close();
});

test("volume, readback, write failure recovery and input selection", async () => {
  const volume = page.getByRole("slider", { name: "音量" });
  await volume.press("ArrowUp");
  await expect(volume).toHaveAttribute("aria-valuenow", "9");
  await expect(page.locator(".toast")).toContainText("音量 9");
  // Force one out-of-range native write. The subsequent get returns the unchanged value,
  // which the native core intentionally does not repeat as a state event.
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url).endsWith("/core_send") && options?.body) {
        const args = JSON.parse(String(options.body));
        const message = JSON.parse(args.line);
        if (message.method === "set" && message.params.property === "volume") {
          window.fetch = originalFetch;
          message.params.value = 999;
          return originalFetch(url, { ...options, body: JSON.stringify({ ...args, line: JSON.stringify(message) }) });
        }
      }
      return originalFetch(url, options);
    };
  });
  await volume.press("ArrowUp");
  await expect(page.locator(".toast.is-error")).toBeVisible();
  await expect(volume).toHaveAttribute("aria-valuenow", "9");
  await page.getByRole("radio", { name: "USB", exact: true }).click();
  await expect(page.getByRole("radio", { name: "USB", exact: true })).toHaveAttribute("aria-checked", "true");
  await screenshot("home");
});

test("presets and equalizer are connected to the native simulator", async () => {
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "音效" }).click();
  await page.getByRole("radio", { name: "音乐", exact: true }).click();
  await expect(page.getByRole("radio", { name: "音乐", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "自定义", exact: true }).click();
  const handle = page.locator(".eq__handle").first();
  const box = await handle.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2, box!.y - 25); await page.mouse.up();
  await expect(page.locator(".toast")).toContainText("dB");
  await page.getByRole("button", { name: "复位", exact: true }).click();
  await expect(page.getByRole("button", { name: "复位", exact: true })).toBeDisabled();
  await screenshot("sound");
});

test("settings, disconnect and reconnect preserve confirmed simulator state", async () => {
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "设置" }).click();
  const led = page.getByRole("switch", { name: "指示灯", exact: true });
  await led.click(); await expect(led).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.locator(".name-field__input").fill("离线测试 N300");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".name-field__text")).toHaveText("离线测试 N300");
  await page.getByRole("button", { name: /^定时关机/ }).click();
  await page.getByRole("radio", { name: "30′", exact: true }).click();
  await expect(page.getByRole("button", { name: /^定时关机/ })).toContainText("30 分钟后");
  await page.getByRole("button", { name: /^断开连接/ }).click();
  await expect(led).toBeDisabled();
  await page.getByRole("button", { name: /^连接音箱/ }).click();
  await expect(led).toBeEnabled(); await expect(led).toHaveAttribute("aria-checked", "false");
  await screenshot("settings");
});

test("a crashed core can be restarted, and reloading the renderer restores its state", async () => {
  const current = coreChildren(); expect(current).toHaveLength(1);
  process.kill(current[0].ProcessId);
  await expect(page.getByText("控制核心已退出", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^连接音箱/ }).click();
  await expect(page.getByRole("switch", { name: "指示灯", exact: true })).toBeEnabled();
  const next = coreChildren(); expect(next).toHaveLength(1);
  expect(next[0].ProcessId).not.toBe(current[0].ProcessId);
  await page.reload();
  await expect(page.getByRole("slider", { name: "音量" })).toHaveAttribute("aria-valuenow", "8");
  expect(coreChildren()[0].ProcessId).toBe(next[0].ProcessId);
  expect(errors).toEqual([]);
});

test("closing the window releases its native control process", async () => {
  const pid = coreChildren()[0].ProcessId;
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect.poll(() => app.exitCode !== null).toBe(true);
  await expect.poll(() => alive(pid)).toBe(false);
});
