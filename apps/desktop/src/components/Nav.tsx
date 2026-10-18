import type { ReactNode } from "react";
import type { Toast } from "../device/DeviceContext";
import { IconAlert, IconCheck } from "./icons";
import "./Shell.css";

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

/** 悬浮胶囊导航：选中项展开文字，其余只显示图标。 */
export function Nav<T extends string>({ items, active, onChange }: { items: NavItem<T>[]; active: T; onChange(id: T): void }) {
  return (
    <nav className="nav" aria-label="页面">
      {items.map((it) => (
        <button
          key={it.id}
          className={`nav__item${it.id === active ? " is-active" : ""}`}
          aria-current={it.id === active ? "page" : undefined}
          onClick={() => onChange(it.id)}
        >
          {it.icon}
          <span className="nav__label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ToastPill({ toast }: { toast: Toast | null }) {
  return (
    <div className="toast-layer" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast is-${toast.kind}`}>
          {toast.kind === "ok" ? <IconCheck size={14} /> : <IconAlert size={14} />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
