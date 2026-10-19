import type { ReactNode } from "react";
import { IconClose } from "./icons";

export function ConsoleHeader({ title, subtitle, status, actions, onClose }: {
  title: ReactNode;
  subtitle: string;
  status?: "ok" | "busy" | "off";
  actions?: ReactNode;
  onClose(): void;
}) {
  return <header className="console-modal__header">
    <div className="console-modal__identity">
      <h2 className="console-modal__title" id="console-title">{title}</h2>
      <p className="console-modal__subtitle">
        {status && <span className={`status-dot is-${status}`} aria-hidden="true" />}
        {subtitle}
      </p>
    </div>
    <div className="console-modal__nav">
      {actions}
      <button className="console-close" aria-label="关闭浮窗" title="关闭 · Esc" onClick={onClose}>
        <IconClose size={16} />
      </button>
    </div>
  </header>;
}
