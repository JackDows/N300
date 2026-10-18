import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const config = process.env.N300_TEST_CONFIGURATION ?? "Debug";
const exe = process.env.N300_DESKTOP_TEST_EXE ?? join(root, "artifacts/desktop", config, "N300Desk.exe");
let app: ChildProcess;
let appEnv: NodeJS.ProcessEnv;
let browser: Browser;
let page: Page;
const errors: string[] = [];
let rpcId = -1;
let feed: Server;
let feedUrl = "";
let updateMode: "current" | "new" | "error" = "current";
const appVersion = JSON.parse(readFileSync(join(root, "desktop/src-tauri/tauri.conf.json"), "utf8")).version;
test.describe.configure({ mode: "serial" });

// Use the packaged core's real JSON-RPC channel, including its native error paths.
async function coreRequest(method: string, params: Record<string, unknown> = {}) {
  return page.evaluate(async (request) => {
    const ipc = (window as any).__TAURI_INTERNALS__;
    let complete!: (reply: any) => void;
    const reply = new Promise<any>((resolve) => { complete = resolve; });
    const callback = ipc.transformCallback((event: { payload: { line: string } }) => {
      const message = JSON.parse(event.payload.line);
      if (message.id === request.id) complete(message);
    });
    let eventId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      eventId = await ipc.invoke("plugin:event|listen", { event: "n300://line", target: { kind: "Any" }, handler: callback });
      await ipc.invoke("core_send", { line: JSON.stringify(request) });
      return await Promise.race([reply, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Native ${request.method} timed out`)), 5000);
      })]);
    } finally {
      clearTimeout(timer);
      if (eventId !== undefined) await ipc.invoke("plugin:event|unlisten", { event: "n300://line", eventId });
      ipc.unregisterCallback(callback);
    }
  }, { jsonrpc: "2.0", id: rpcId--, method, params });
}

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
function journal() {
  const directory = join(process.env.LOCALAPPDATA!, "local.n300.desktop", "logs");
  return readdirSync(directory).filter((name) => /^n300(?:\.\d+)?\.jsonl$/.test(name))
    .flatMap((name) => readFileSync(join(directory, name), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)))
    .filter((row) => row.process_id === app.pid);
}

test.beforeAll(async () => {
  expect(existsSync(exe), "Run Build before Test").toBe(true);
  feed = createHttpServer((request, response) => {
    if (request.url === "/update.exe") {
      // The signature matches the original fixture, but these downloaded bytes do not.
      response.end("Tampered update package");
    } else if (updateMode === "current") { response.writeHead(204).end(); }
    else if (updateMode === "error") { response.writeHead(503).end("Unavailable"); }
    else {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ version: "99.0.0", notes: "更新回归测试", url: feedUrl + "/update.exe",
        signature: readFileSync(join(root, "desktop/tests/fixtures/update-payload.sig"), "utf8").trim() }));
    }
  });
  feed.listen(0, "127.0.0.1"); await once(feed, "listening");
  feedUrl = `http://127.0.0.1:${(feed.address() as { port: number }).port}`;
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port; await new Promise<void>((done) => server.close(() => done()));
  const profile = join(root, "artifacts/validation/webview", `${config}-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const env = { ...process.env, N300_OFFLINE: "1", N300_UPDATE_URL: feedUrl + "/latest.json", WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1` };
  delete env.N300_EXE;
  appEnv = env;
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
  await new Promise<void>((done) => feed?.close(() => done()));
});

test("volume, readback, write failure recovery and input selection", async () => {
  const volume = page.getByRole("slider", { name: "音量" });
  await volume.press("ArrowUp");
  await expect(volume).toHaveAttribute("aria-valuenow", "9");
  await expect.poll(async () => (await coreRequest("get", { property: "volume" })).result.value).toBe(9);
  await expect(page.locator(".toast")).toHaveCount(0);
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
  await expect(page.locator(".toast.is-error")).toHaveText("操作未完成，请重试");
  await expect(volume).toHaveAttribute("aria-valuenow", "9");
  const failure = journal().find((row) => row.data.message?.error?.data?.code === "invalid_argument");
  expect(failure.data.message.error.data.message).toContain("volume");
  expect(journal().some((row) => row.event === "core.request"
    && row.data.generation === failure.data.generation && row.data.message.id === failure.data.message.id
    && row.data.message.params.value === 999)).toBe(true);
  await page.getByRole("radio", { name: "USB", exact: true }).click();
  await expect(page.getByRole("radio", { name: "USB", exact: true })).toHaveAttribute("aria-checked", "true");
  expect((await coreRequest("get", { property: "input" })).result.value).toBe("usb");
  await expect(page.locator(".toast")).toHaveCount(0);
  await screenshot("home");
});

test("input switching stays pending until confirmed, with correlated engineering records", async () => {
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      if (String(url).endsWith("/core_send") && options?.body) {
        const message = JSON.parse(JSON.parse(String(options.body)).line);
        if (message.method === "set" && message.params.property === "input") {
          window.fetch = originalFetch;
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      return originalFetch(url, options);
    };
  });
  const inputs = page.getByRole("radiogroup", { name: "输入源" });
  await inputs.getByRole("radio", { name: "蓝牙", exact: true }).click();
  await expect(inputs).toHaveAttribute("aria-busy", "true");
  for (const option of await inputs.getByRole("radio").all()) await expect(option).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("正在切换");
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(inputs).not.toHaveAttribute("aria-busy", "true");
  await expect(inputs.getByRole("radio", { name: "蓝牙", exact: true })).toHaveAttribute("aria-checked", "true");
  expect((await coreRequest("get", { property: "input" })).result.value).toBe("bluetooth");
  await expect(page.locator(".home__source-status")).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveCount(0);
  const rows = journal();
  const request = rows.findLast((row) => row.event === "core.request" && row.data.message?.params?.value === "bluetooth");
  const operation = rows.find((row) => row.data.generation === request.data.generation
    && row.data.message?.params?.type === "operation" && row.data.message.params.request_id === request.data.message.id);
  expect(operation.data.message.params.outcome).toBe("confirmed");
  expect(operation.data.message.params.readbacks.length).toBeGreaterThan(0);
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
  await expect.poll(async () => (await coreRequest("get", { property: "eq" })).result.value[0].gain_db).toBeGreaterThan(0);
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.getByRole("button", { name: "复位", exact: true }).click();
  await expect(page.getByRole("button", { name: "复位", exact: true })).toBeDisabled();
  expect((await coreRequest("get", { property: "eq" })).result.value.every((band: { gain_db: number }) => band.gain_db === 0)).toBe(true);
  await screenshot("sound");
});

test("settings, disconnect and reconnect preserve confirmed simulator state", async () => {
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "设置" }).click();
  await expect(page.getByText(/非官方控制程序|与 EDIFIER 无关联/)).toHaveCount(0);
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
  await expect(page.locator(".titlebar__status")).toHaveText("连接已中断");
  await page.getByRole("button", { name: /^连接音箱/ }).click();
  await expect(page.getByRole("switch", { name: "指示灯", exact: true })).toBeEnabled();
  const next = coreChildren(); expect(next).toHaveLength(1);
  expect(next[0].ProcessId).not.toBe(current[0].ProcessId);
  await page.reload();
  await expect(page.getByRole("slider", { name: "音量" })).toHaveAttribute("aria-valuenow", "8");
  expect(coreChildren()[0].ProcessId).toBe(next[0].ProcessId);
  expect(errors).toEqual([]);
});

test("reduced motion disables loading animations instead of accelerating their infinite loops", async () => {
  // Exercise the production loading selectors even though the offline device connects instantly.
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "motion-regression";
    fixture.style.cssText = "position:fixed;left:-2000px;pointer-events:none";
    fixture.innerHTML = '<div class="dial is-loading"><span class="dial__caption">连接中</span><svg><g class="dial__spinner"></g></svg></div><span class="status-dot is-busy"></span>';
    document.body.append(fixture);
  });
  const motion = () => page.locator("#motion-regression .dial__caption, #motion-regression .dial__spinner, #motion-regression .status-dot")
    .evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return { name: style.animationName, duration: parseFloat(style.animationDuration), iterations: style.animationIterationCount };
    }));
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await motion()).toEqual(Array(3).fill({ name: "none", duration: 0, iterations: "1" }));
    await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "音效" }).click();
    await expect(page.locator(".page-head h2")).toHaveText("音效");
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "音量" }).click();
    await expect(page.getByRole("slider", { name: "音量" })).toHaveAttribute("aria-valuenow", "8");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const animation of await motion()) {
      expect(animation.name).not.toBe("none");
      expect(animation.duration).toBeGreaterThanOrEqual(1.2);
      expect(animation.iterations).toBe("infinite");
    }
  } finally {
    await page.locator("#motion-regression").evaluate((element) => element.remove());
    await page.emulateMedia({ reducedMotion: null });
  }
});

test("a missing speaker remains still during native retries and can be stopped or reconnected", async () => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    const before = (await coreRequest("diagnostics")).result.scan_count;
    // The native simulator advertises only 00:11:22:33:44:55. This goes through
    // the same not_found and exponential retry code as a missing physical speaker.
    const missing = await coreRequest("connect", { address: "00:00:00:00:00:00" });
    expect(missing.error.data.code).toBe("not_found");
    await expect(page.locator(".titlebar__status")).toHaveText("等待重试");
    await expect(page.locator(".home__eyebrow")).toHaveText("没有找到音箱");
    await expect(page.locator(".dial__caption")).toHaveText("等待重试");
    await expect(page.locator(".dial__spinner")).toHaveCount(0);
    await expect.poll(async () => (await coreRequest("diagnostics")).result.scan_count).toBeGreaterThanOrEqual(before + 3);
    await expect(page.locator(".dial__caption")).toHaveText("等待重试");
    expect(await page.evaluate(() => document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity).length)).toBe(0);
    await screenshot(`missing-${reducedMotion}`);

    await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "音效" }).click();
    await expect(page.locator(".offline-banner")).toContainText("没有找到音箱");
    await expect(page.locator(".offline-banner").getByRole("button", { name: "停止", exact: true })).toBeEnabled();
    await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "音量" }).click();

    const retried = (await coreRequest("diagnostics")).result.scan_count;
    await page.getByRole("button", { name: "重新连接", exact: true }).click();
    await expect.poll(async () => (await coreRequest("diagnostics")).result.scan_count).toBeGreaterThan(retried);
    await expect(page.getByRole("button", { name: "停止重试", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "停止重试", exact: true }).click();
    await expect(page.locator(".dial__caption")).toHaveText("未连接");
    expect((await coreRequest("tick")).result.auto_reconnect).toBe(false);
    const stopped = (await coreRequest("diagnostics")).result.scan_count;
    await page.waitForTimeout(1300); // Cross the next retry deadline; stopping must cancel it.
    expect((await coreRequest("diagnostics")).result.scan_count).toBe(stopped);
    await expect(page.getByRole("button", { name: "连接音箱", exact: true })).toBeEnabled();

    expect((await coreRequest("connect", { address: "00:11:22:33:44:55" })).result.connected).toBe(true);
    await expect(page.getByRole("slider", { name: "音量" })).toHaveAttribute("aria-valuenow", "8");
    await expect(page.locator(".titlebar__status")).toHaveText("离线演示");
  }
  await page.emulateMedia({ reducedMotion: null });
  expect(errors).toEqual([]);
});

test("update checks, prompts and a rejected package keep the running app usable", async () => {
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "设置" }).click();
  const panel = page.getByRole("region", { name: "软件更新" });
  await expect(panel).toContainText(`当前版本 ${appVersion}`);
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(panel).toContainText("已是最新版本");
  updateMode = "error";
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("暂时无法检查更新");
  updateMode = "new";
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "更新提醒" })).toContainText("99.0.0");
  await page.getByRole("button", { name: "稍后", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "更新提醒" })).toHaveCount(0);
  const core = coreChildren()[0].ProcessId;
  await panel.getByRole("button", { name: "下载并更新", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("更新未完成，当前版本保持不变，请重试");
  await expect.poll(() => journal().some((row) => row.event === "ui.error" && row.data.context === "update.install"
    && /signature/i.test(row.data.detail))).toBe(true);
  await expect(panel.getByRole("button", { name: "重试更新", exact: true })).toBeEnabled();
  expect(app.exitCode).toBeNull();
  expect(coreChildren()[0].ProcessId).toBe(core);
  await screenshot("update-failure");
  updateMode = "current";
  await panel.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(panel).toContainText("已是最新版本");
  await page.getByRole("navigation", { name: "页面" }).getByRole("button", { name: "音量" }).click();
  await expect(page.getByRole("slider", { name: "音量" })).toHaveAttribute("aria-valuenow", "8");
  expect(errors).toEqual([]);
});

test("a second launch restores the existing window and explains that it is already running", async () => {
  const core = coreChildren()[0].ProcessId;
  await page.getByRole("button", { name: "最小化", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", { label: "main" }))).toBe(true);
  const duplicate = spawn(exe, ["--offline"], { env: appEnv, cwd: resolve(exe, ".."), stdio: "ignore", windowsHide: true });
  try {
    await expect.poll(() => duplicate.exitCode).toBe(0);
    await expect(page.locator(".toast")).toHaveText("程序已在运行");
    await expect.poll(() => page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", { label: "main" }))).toBe(false);
    expect(coreChildren()).toHaveLength(1);
    expect(coreChildren()[0].ProcessId).toBe(core);
    expect(journal().some((row) => row.event === "app.already_running")).toBe(true);
  } finally {
    if (duplicate.exitCode === null) duplicate.kill();
  }
});

test("closing the window releases its native control process", async () => {
  const pid = coreChildren()[0].ProcessId;
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect.poll(() => app.exitCode !== null).toBe(true);
  await expect.poll(() => alive(pid)).toBe(false);
});
