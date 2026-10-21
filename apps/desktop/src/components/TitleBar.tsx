import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconClose, IconMinimize } from "./icons";
import "./Shell.css";

const runWindowCommand = (fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<void>) => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  void fn(getCurrentWindow()).catch(() => {});
};

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <span className="titlebar__glyph" aria-hidden="true" />
        <span className="titlebar__name">DeskHub</span>
      </div>

      <div className="titlebar__win">
        <button
          className="winbtn"
          aria-label="最小化窗口"
          title="最小化"
          onClick={() => runWindowCommand((w) => w.minimize())}
        >
          <IconMinimize size={13} />
        </button>
        <button className="winbtn" aria-label="最大化或还原窗口" title="最大化 / 还原" onClick={()=>runWindowCommand(w=>w.toggleMaximize())}>
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor"/></svg>
        </button>
        <button
          className="winbtn winbtn--close"
          aria-label="关闭窗口"
          title="退出 DeskHub"
          onClick={() => runWindowCommand((w) => w.close())}
        >
          <IconClose size={13} />
        </button>
      </div>
    </header>
  );
}
