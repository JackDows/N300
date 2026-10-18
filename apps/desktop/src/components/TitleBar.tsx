import { isTauri } from "../device/transport";
import { IconClose, IconMinimize } from "./icons";
import "./Shell.css";

async function windowAction(action: "minimize" | "close") {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  await (action === "minimize" ? w.minimize() : w.close());
}

/** 无边框窗口的标题栏：整条可拖动，只保留最小化和关闭。 */
export function TitleBar({ status }: { status: { tone: "ok" | "busy" | "warn" | "off"; text: string } }) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand">
        <span className="brand-mark" />
        <span className="titlebar__name">DeskHub</span>
        <span className={`status-dot is-${status.tone}`} />
        <span className="titlebar__status">{status.text}</span>
      </div>
      <div className="titlebar__actions">
        <button className="win-btn" aria-label="最小化" onClick={() => windowAction("minimize")}>
          <IconMinimize size={16} />
        </button>
        <button className="win-btn win-btn--close" aria-label="关闭" onClick={() => windowAction("close")}>
          <IconClose size={16} />
        </button>
      </div>
    </header>
  );
}
