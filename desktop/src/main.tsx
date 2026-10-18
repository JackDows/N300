import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DeviceProvider } from "./device/DeviceContext";
import { UpdateProvider } from "./updates/UpdateContext";
import { isTauri } from "./device/transport";
import { recordUiError } from "./diagnostics";
import "./styles/tokens.css";
import "./styles/base.css";

// 浏览器预览时把应用放进一个模拟的桌面窗口里。
if (!isTauri) document.documentElement.classList.add("is-browser");

// 桌面版屏蔽 WebView 默认右键菜单。
if (isTauri && !import.meta.env.DEV) window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("error", (event) => recordUiError(event.error ?? event.message, "window.error"));
window.addEventListener("unhandledrejection", (event) => recordUiError(event.reason, "window.unhandledrejection"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeviceProvider>
      <UpdateProvider><App /></UpdateProvider>
    </DeviceProvider>
  </StrictMode>,
);
