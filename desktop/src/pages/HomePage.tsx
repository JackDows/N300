import { Segmented } from "../components/Segmented";
import { VolumeDial } from "../components/VolumeDial";
import { inputIcon } from "../components/icons";
import { errorText, useDevice } from "../device/DeviceContext";
import type { Choice } from "../device/types";

const PLACEHOLDER_INPUTS: Choice[] = [
  { label: "蓝牙", raw: 1, value: "bluetooth" },
  { label: "AUX", raw: 2, value: "aux" },
  { label: "USB", raw: 3, value: "usb" },
];

export function HomePage() {
  const { phase, state, values, error, stopping, pendingInput, set, connect, disconnect } = useDevice();
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
      : phase === "disconnected" || phase === "waiting"
        ? error ? errorText(error) : "未连接"
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
        statusLabel={phase === "waiting" ? "等待重试" : phase === "disconnected" ? "未连接" : undefined}
        onCommit={(v) => set("volume", v)}
      />

      <div className="home__source">
        {phase !== "connected" ? (
          <div className="connection-panel">
            {(phase === "waiting" || phase === "disconnected") && (
              <p className="connection-panel__hint">确认音箱已开机、电脑蓝牙已打开。<br />音箱可被发现后再连接。</p>
            )}
            <div className="connection-panel__actions">
              {(phase === "waiting" || phase === "disconnected") && (
                <button className="btn-primary" onClick={connect} disabled={stopping}>
                  {phase === "waiting" ? "重新连接" : "连接音箱"}
                </button>
              )}
              {phase !== "disconnected" && (
                <button className="btn-ghost" onClick={disconnect} disabled={stopping}>
                  {stopping ? "正在停止…" : phase === "waiting" ? "停止重试" : "取消连接"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <Segmented
              ariaLabel="输入源"
              options={(input?.choices ?? PLACEHOLDER_INPUTS).map((c) => ({
                value: c.value,
                label: c.label,
                icon: inputIcon(c.value, 16),
              }))}
              value={pendingInput ?? input?.value}
              disabled={!input || pendingInput !== null}
              busy={pendingInput !== null}
              onChange={(v) => set("input", v)}
            />
            {pendingInput !== null && <span className="home__source-status" role="status">正在切换…</span>}
          </>
        )}
      </div>
    </div>
  );
}
