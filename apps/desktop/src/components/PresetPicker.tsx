import type { Choice } from "../device/types";
import { presetIcon } from "./icons";
import "./PresetPicker.css";

interface Props {
  choices: Choice[];
  value: string | number | undefined;
  disabled?: boolean;
  onChange(choice: Choice): void;
}

export function PresetPicker({ choices, value, disabled, onChange }: Props) {
  return (
    <div className="presets" role="radiogroup" aria-label="音效预设" style={{ gridTemplateColumns: `repeat(${choices.length}, 1fr)` }}>
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            role="radio"
            aria-checked={on}
            className={`preset${on ? " is-on" : ""}`}
            disabled={disabled}
            onClick={() => !on && onChange(c)}
          >
            <span className="preset__orb">{presetIcon(c.value, 20)}</span>
            <span className="preset__label">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
