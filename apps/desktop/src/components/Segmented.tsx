import type { CSSProperties, ReactNode } from "react";
import "./Segmented.css";
import { radioKeys } from "./radioKeys";

export interface SegmentOption {
  value: string | number;
  label: string;
  icon?: ReactNode;
}

interface Props {
  options: SegmentOption[];
  value: string | number | undefined;
  onChange(value: string | number): void;
  disabled?: boolean;
  busy?: boolean;
  size?: "m" | "s";
  ariaLabel?: string;
}

/** 分段选择器：选中项背后有一块滑动的“滑块”，切换时平滑移动。 */
export function Segmented({ options, value, onChange, disabled, busy, size = "m", ariaLabel }: Props) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      className={`seg seg--${size}${disabled ? " is-disabled" : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      onKeyDown={radioKeys}
      style={{ "--n": options.length, "--i": Math.max(index, 0) } as CSSProperties}
    >
      <span className={`seg__thumb${index < 0 ? " is-hidden" : ""}`} />
      {options.map((o, i) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === Math.max(0, index) ? 0 : -1}
          className={`seg__item${o.value === value ? " is-on" : ""}`}
          disabled={disabled}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
