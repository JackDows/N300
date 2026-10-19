import type { Toast } from "../device/DeviceContext";
import { IconAlert, IconCheck } from "./icons";
import "./Shell.css";

export function ToastPill({ toast }: { toast: Toast | null }) {
  return <div className="toast-layer" aria-live="polite">
    {toast && <div key={toast.id} className={`toast is-${toast.kind}`}>
      {toast.kind === "ok" ? <IconCheck size={14} /> : <IconAlert size={14} />}
      <span>{toast.text}</span>
    </div>}
  </div>;
}
