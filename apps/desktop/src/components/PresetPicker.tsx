import type { Choice } from "../device/types";
import { presetIcon } from "./icons";
import "./PresetPicker.css";
import { radioKeys } from "./radioKeys";

interface Props {
  choices: Choice[];
  value: string | number | undefined;
  disabled?: boolean;
  onChange(choice: Choice): void;
}

export function PresetPicker({ choices, value, disabled, onChange }: Props) {
  return (
    <div className="presets" role="radiogroup" aria-label="音效预设" onKeyDown={radioKeys} style={{ gridTemplateColumns: `repeat(${choices.length}, 1fr)` }}>
      {choices.map((c, i) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            role="radio"
            aria-checked={on}
            tabIndex={i === Math.max(0, choices.findIndex(choice => choice.value === value)) ? 0 : -1}
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
