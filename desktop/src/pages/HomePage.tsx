import { Segmented } from "../components/Segmented";
import { VolumeDial } from "../components/VolumeDial";
import { inputIcon } from "../components/icons";
import { useDevice } from "../device/DeviceContext";
import type { Choice } from "../device/types";

const PLACEHOLDER_INPUTS: Choice[] = [
  { label: "蓝牙", raw: 1, value: "bluetooth" },
  { label: "AUX", raw: 2, value: "aux" },
  { label: "USB", raw: 3, value: "usb" },
];

export function HomePage() {
  const { phase, state, values, set, connect } = useDevice();
  const volume = values.volume;
  const input = values.input;
  const preset = values.preset;
  const name = values.name?.value ?? state?.target?.name ?? "N300";
  const presetLabel = preset?.choices.find((c) => c.value === preset.value)?.label;

  const eyebrow =
    phase === "connected"
      ? presetLabel
        ? `${presetLabel}音效`
        : "已连接"
      : phase === "disconnected"
        ? "未连接"
        : "正在寻找音箱…";

  return (
    <div className="page home">
      <header className="home__head">
        <div className={`home__eyebrow is-${phase}`}>{eyebrow}</div>
        <h1 className="home__name">{name}</h1>
      </header>

      <VolumeDial
        value={volume?.value ?? null}
        min={volume?.min ?? 0}
        max={volume?.max ?? 16}
        step={volume?.step ?? 1}
        loading={phase === "connecting" || phase === "starting"}
        onCommit={(v) => set("volume", v, `音量 ${v}`)}
      />

      <div className="home__source">
        {phase === "disconnected" ? (
          <button className="btn-primary" onClick={connect}>
            连接音箱
          </button>
        ) : (
          <Segmented
            ariaLabel="输入源"
            options={(input?.choices ?? PLACEHOLDER_INPUTS).map((c) => ({
              value: c.value,
              label: c.label,
              icon: inputIcon(c.value, 16),
            }))}
            value={input?.value}
            disabled={!input}
            onChange={(v) => {
              const label = input?.choices.find((c) => c.value === v)?.label ?? String(v);
              set("input", v, `已切换到 ${label}`);
            }}
          />
        )}
      </div>
    </div>
  );
}
