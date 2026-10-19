import { test, expect, type Page } from "@playwright/test";
import { APP_VERSION, MOCK_UPDATE_VERSION } from "../../../../contracts/version.mjs";

const openSpeaker = async (page: Page) => page.getByRole("button", { name: "音响设置", exact: true }).click();
const closePanel = async (page: Page) => page.getByRole("button", { name: "关闭浮窗" }).click();

test("device dialogs isolate focus, dismiss, and restore the scene trigger", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "音响设置", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭浮窗" }).focus();
  for (let n = 0; n < 20; n++) {
    await page.keyboard.press("Tab");
    expect(await page.locator(".desk-modal").evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "重命名" }).click();
  await page.getByRole("textbox", { name: "音箱名称" }).fill("未保存的名称");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "音箱名称" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "N300" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("speaker controls keep values across dialogs and support keyboard EQ adjustments", async ({ page }) => {
  await page.goto("/"); await openSpeaker(page);
  const volume = page.getByRole("slider", { name: "音量", exact: true });
  await expect(volume).toHaveAttribute("aria-valuenow", "8");
  await volume.focus(); await page.keyboard.press("ArrowUp");
  await expect(volume).toHaveAttribute("aria-valuenow", "9");
  // Closing before the debounce expires must still commit the visible setting.
  await closePanel(page); await openSpeaker(page);
  await expect(volume).toHaveAttribute("aria-valuenow", "9");
  await page.getByRole("radio", { name: "蓝牙", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "输入源" })).not.toHaveAttribute("aria-busy", "true");
  await page.getByRole("radio", { name: "音乐", exact: true }).click();
  await expect(page.getByRole("slider", { name: "100 Hz 增益" })).toHaveCount(0);
  await page.getByRole("button", { name: "自定义调节" }).click();
  const eq = page.getByRole("slider", { name: "100 Hz 增益" });
  await eq.focus(); await page.keyboard.press("ArrowUp");
  await expect(eq).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(eq).toHaveAttribute("aria-valuenow", "0");
  await closePanel(page); await openSpeaker(page);
  await expect(volume).toHaveAttribute("aria-valuenow", "9");
  await expect(page.getByRole("radio", { name: "蓝牙", exact: true })).toBeChecked();
});

test("keyboard brightness, backlight off and disconnected controls reflect actual state", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "键盘设置", exact: true }).click();
  await page.getByRole("radio", { name: "柔和", exact: true }).click();
  await expect(page.getByRole("radio", { name: "柔和", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "柔和", exact: true })).toBeEnabled();
  await page.getByRole("radio", { name: "柔和", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("radio", { name: "关闭", exact: true })).toBeChecked();
  await closePanel(page);
  await expect(page.locator('.desk25d-node--keyboard > line')).toHaveAttribute("stroke-opacity", "0");
  await page.getByRole("button", { name: "显示器与系统中枢" }).click();
  await page.getByRole("button", { name: "断开 OG98" }).click();
  await expect(page.getByRole("button", { name: "连接 OG98" })).toBeVisible();
  await page.getByRole("button", { name: "打开 OG98 设置" }).click();
  await expect(page.getByRole("radio", { name: "最亮", exact: true })).toBeDisabled();
  await expect(page.getByLabel("当前键盘状态")).not.toContainText("正常");
  await page.getByRole("button", { name: "连接键盘" }).click();
  await expect(page.getByRole("radio", { name: "关闭", exact: true })).toBeEnabled();
});

test("offline update preview completes instead of leaving dead controls", async ({ page }) => {
  await page.goto("/?modal=system");
  await expect(page.getByText(`当前版本 ${APP_VERSION}`)).toBeVisible();
  await page.getByRole("button", { name: "检查更新" }).click();
  await expect(page.getByRole("button", { name: "下载并更新" })).toBeVisible();
  await page.getByRole("button", { name: "下载并更新" }).click();
  await expect(page.getByText(`当前版本 ${MOCK_UPDATE_VERSION}`)).toBeVisible();
  await expect(page.getByText("已是最新版本", { exact: true })).toBeVisible();
});

test("mouse controls share the desktop and respect software and onboard modes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "鼠标设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PRO X SUPERLIGHT 2 SE" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "1600", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "800", exact: true }).click();
  await expect(page.locator(".mouse-dpi strong")).toHaveText("800");
  await page.getByRole("combobox", { name: "回报率", exact: true }).selectOption("500");
  await expect(page.getByRole("combobox", { name: "回报率", exact: true })).toHaveValue("500");
  await page.getByRole("radio", { name: "板载配置", exact: true }).click();
  await expect(page.getByRole("radio", { name: "800", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "板载配置", exact: true }).selectOption("PROFILE_2");
  await expect(page.getByRole("combobox", { name: "板载配置", exact: true })).toHaveValue("PROFILE_2");
  await page.getByRole("radio", { name: "软件控制", exact: true }).click();
  await expect(page.locator(".mouse-dpi strong")).toHaveText("800");
  await closePanel(page); await openSpeaker(page);
  await expect(page.getByRole("slider", { name: "音量", exact: true })).toHaveAttribute("aria-valuenow", "8");
  await closePanel(page); await page.getByRole("button", { name: "显示器与系统中枢" }).click();
  await page.getByRole("button", { name: "断开 PRO X SUPERLIGHT 2 SE" }).click();
  await page.getByRole("button", { name: "打开 Logitech 鼠标 设置" }).click();
  await expect(page.locator(".mouse-dpi strong")).toHaveText("—");
  await expect(page.getByRole("combobox", { name: "回报率", exact: true })).toBeDisabled();
});

for (const [width, height] of [[806, 566], [1100, 760], [1480, 980], [540, 720]]) {
  test(`console layout remains reachable at ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const modal of ["speaker", "keyboard", "mouse", "system"]) {
      await page.goto(`/?modal=${modal}`);
      const panel = page.getByRole("dialog");
      await expect(panel).toBeVisible();
      await expect(page.getByRole("button", { name: "关闭浮窗" })).toBeInViewport();
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const box = await panel.boundingBox();
      expect(box!.y).toBeGreaterThan(44);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      if (modal === "speaker") {
        await page.getByRole("button", { name: "音箱偏好设置" }).click();
        await page.getByText("睡眠定时", { exact: true }).click();
        await page.getByRole("radio", { name: "60′", exact: true }).click();
        await expect(page.getByRole("radio", { name: "60′", exact: true })).toBeChecked();
      }
    }
  });
}
