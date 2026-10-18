import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevron } from "./icons";
import "./List.css";

export function Group({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className="group-wrap">
      {label && <div className="section-label">{label}</div>}
      <div className="group">{children}</div>
    </section>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}

export function Row({ icon, title, desc, children, onClick, disabled, tone = "default" }: RowProps) {
  const body = (
    <>
      {icon && <span className="row__icon">{icon}</span>}
      <span className="row__text">
        <span className="row__title">{title}</span>
        {desc && <span className="row__desc">{desc}</span>}
      </span>
      {children != null && <span className="row__trail">{children}</span>}
    </>
  );
  const cls = `row row--${tone}${disabled ? " is-disabled" : ""}${onClick ? " is-button" : ""}`;
  return onClick ? (
    <button className={cls} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** 可展开行：点击后在下方展开内容，高度过渡用 grid 0fr → 1fr 实现。 */
export function ExpandRow({
  open,
  onToggle,
  children,
  value,
  ...row
}: Omit<RowProps, "children" | "onClick"> & { open: boolean; onToggle(): void; value: ReactNode; children: ReactNode }) {
  return (
    <div className={`expand${open ? " is-open" : ""}`}>
      <Row {...row} onClick={onToggle}>
        <span className="row__value">{value}</span>
        <IconChevron size={16} className="expand__chevron" />
      </Row>
      <div className="expand__body">
        <div className="expand__inner">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange(v: boolean): void; disabled?: boolean; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${on ? " is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="toggle__knob" />
    </button>
  );
}

const HOLD_MS = 1100;

/** 长按确认：用于关机这类不可撤销的操作。 */
export function HoldRow({ icon, title, hint, onConfirm, disabled }: { icon: ReactNode; title: string; hint: string; onConfirm(): void; disabled?: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = () => {
    if (disabled) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <button
      className={`row row--danger is-button hold${holding ? " is-holding" : ""}${disabled ? " is-disabled" : ""}`}
      style={{ ["--hold-ms" as string]: `${HOLD_MS}ms` }}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      <span className="hold__fill" />
      <span className="row__icon">{icon}</span>
      <span className="row__text">
        <span className="row__title">{title}</span>
      </span>
      <span className="row__trail row__value">{holding ? "继续按住…" : hint}</span>
    </button>
  );
}
