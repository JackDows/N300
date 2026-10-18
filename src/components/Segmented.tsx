import type { CSSProperties, ReactNode } from "react";
import "./Segmented.css";

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
  size?: "m" | "s";
  ariaLabel?: string;
}

/** 分段选择器：选中项背后有一块滑动的“滑块”，切换时平滑移动。 */
export function Segmented({ options, value, onChange, disabled, size = "m", ariaLabel }: Props) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      className={`seg seg--${size}${disabled ? " is-disabled" : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--n": options.length, "--i": Math.max(index, 0) } as CSSProperties}
    >
      <span className={`seg__thumb${index < 0 ? " is-hidden" : ""}`} />
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
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
