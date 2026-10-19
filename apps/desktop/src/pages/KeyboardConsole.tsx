import type { CSSProperties } from "react";
import { ConsoleHeader } from "../components/ConsoleHeader";
import { IconLight } from "../components/icons";
import { radioKeys } from "../components/radioKeys";
import { useDevice } from "../device/DeviceContext";

const BRIGHTNESS_STEPS = [
  { level: 0, code: "0%", label: "关闭", barH: "0%" },
  { level: 1, code: "25%", label: "微光", barH: "25%" },
  { level: 2, code: "50%", label: "柔和", barH: "50%" },
  { level: 3, code: "75%", label: "明亮", barH: "75%" },
  { level: 4, code: "100%", label: "最亮", barH: "100%" },
];
const MODE_NAMES: Record<number, string> = { 0: "恒定常亮", 1: "呼吸律动", 2: "光谱流转", 3: "涟漪扩散", 13: "自定义光效" };

export function KeyboardConsole({ onClose }: { onClose(): void }) {
  const { keyboard, kbBusy, connectKeyboard, refreshKeyboard, setKeyboardBrightness } = useDevice();
  const connected = keyboard.connected;
  const level = connected ? (keyboard.brightness?.value ?? keyboard.lighting?.brightness) : undefined;
  const rgb = keyboard.lighting?.rgbRaw;
  const rgbHex = rgb ? `#${rgb.map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("").toUpperCase()}` : null;
  const modeName = connected && keyboard.lighting ? (MODE_NAMES[keyboard.lighting.mode] ?? "当前灯效") : "灯效";
  const connecting = keyboard.phase === "connecting";
  return <div className="console-modal console-modal--keyboard" style={{ "--kb-color": rgbHex } as CSSProperties}>
    <ConsoleHeader title="OG98" subtitle={`键盘 · ${connected ? "已连接" : connecting ? "正在连接" : "未连接"}`}
      status={connected ? "ok" : connecting ? "busy" : "off"} onClose={onClose}
      actions={<button className="console-icon-toggle" disabled={kbBusy || connecting}
        onClick={() => void (connected ? refreshKeyboard() : connectKeyboard())}>
        {connecting ? "连接中…" : kbBusy ? "同步中…" : connected ? "同步状态" : "连接键盘"}
      </button>} />
    <div className="kb-deck">
      <section className="kb-lumina-panel" aria-label="键盘灯光">
        <div className="kb-lumina-main">
          <div className="kb-lumina-head">
            <span className="kb-lumina-title"><IconLight size={16} />背光亮度</span>
            <span className="kb-lumina-readout">{level == null ? "—" : BRIGHTNESS_STEPS[level]?.label}</span>
          </div>
          <div className="kb-energy-bars" role="radiogroup" aria-label="键盘背光亮度" aria-busy={kbBusy} onKeyDown={radioKeys}>
            {BRIGHTNESS_STEPS.map((s) => <button key={s.level} role="radio" aria-label={s.label}
              aria-checked={level === s.level} disabled={!connected || kbBusy || level == null}
              tabIndex={level === s.level ? 0 : -1}
              className={`kb-energy-cell${level === s.level ? " is-active" : ""}${level != null && s.level > 0 && s.level <= level ? " is-lit" : ""}`}
              onClick={() => s.level !== level && void setKeyboardBrightness(s.level)}>
              <span className="kb-energy-cell__well" aria-hidden="true"><span className="kb-energy-cell__pillar" style={{ height: s.barH }} /></span>
              <span className="kb-energy-cell__code" aria-hidden="true">{s.code}</span>
              <span className="kb-energy-cell__name">{s.label}</span>
            </button>)}
          </div>
        </div>
        <div className="kb-spectrum-box">
          <div className="kb-spectrum-orb" aria-hidden="true" style={connected && rgbHex && level ? {
            background: `radial-gradient(circle at 32% 25%, #dcece9, ${rgbHex} 55%, #17282b)`,
            boxShadow: `0 8px 24px -14px ${rgbHex}`,
          } : undefined} />
          <div className="kb-spectrum-meta"><span className="kb-spectrum-mode">{modeName}</span><span className="kb-spectrum-hex">{connected ? rgbHex ?? "—" : "—"}</span></div>
        </div>
      </section>
      <dl className="kb-status" aria-label="当前键盘状态">
        <div><dt>系统自适应</dt><dd>{!connected || keyboard.autoOS == null ? "—" : keyboard.autoOS ? "自动切换" : "手动切换"}</dd></div>
        <div><dt>Win 键</dt><dd>{!connected || !keyboard.options ? "—" : keyboard.options.winLocked ? "已锁定" : "正常"}</dd></div>
        <div><dt>方向键映射</dt><dd>{!connected || !keyboard.options ? "—" : keyboard.options.wasdSwapped ? "已互换" : "标准配列"}</dd></div>
      </dl>
    </div>
  </div>;
}
