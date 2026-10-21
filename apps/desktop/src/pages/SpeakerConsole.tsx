import { useState } from "react";
import { ConsoleHeader } from "../components/ConsoleHeader";
import { EqCurve } from "../components/EqCurve";
import { ExpandRow, Group, HoldRow, Row, Toggle } from "../components/List";
import { PresetPicker } from "../components/PresetPicker";
import { Segmented } from "../components/Segmented";
import { ValueSlider } from "../components/ValueSlider";
import {
  IconCheck,
  IconClose,
  IconDial,
  IconLight,
  IconLink,
  IconMoon,
  IconPencil,
  IconPower,
  IconSliders,
  IconTimer,
  inputIcon,
} from "../components/icons";
import { useDevice } from "../device/DeviceContext";
import type { Choice } from "../device/types";

const PLACEHOLDER_INPUTS: Choice[] = [
  { label: "蓝牙", raw: 1, value: "bluetooth" },
  { label: "AUX", raw: 2, value: "aux" },
  { label: "USB", raw: 3, value: "usb" },
];

const PLACEHOLDER_PRESETS: Choice[] = [
  { label: "音乐", raw: 0, value: "music" },
  { label: "监听", raw: 1, value: "monitor" },
  { label: "游戏", raw: 2, value: "game" },
  { label: "电影", raw: 3, value: "movie" },
  { label: "自定义", raw: 4, value: "customized" },
];

const TIMER_OPTIONS = [0, 30, 60, 90, 120];
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

function SpeakerNameEditor() {
  const { phase, state, values, set } = useDevice();
  const name = values.name?.value ?? state?.target?.name ?? "音响";
  const limit = state?.capabilities.rename_bytes ?? 24;
  const [draft, setDraft] = useState<string | null>(null);
  const editable = phase === "connected" && !!values.name;

  if (draft == null) {
    return (
      <span className="name-field">
        <span className="name-field__text">{name}</span>
        {editable && (
          <button className="icon-btn" aria-label="重命名" onClick={() => setDraft(name)}>
            <IconPencil size={13} />
          </button>
        )}
      </span>
    );
  }

  const bytes = utf8Bytes(draft.trim());
  const valid = bytes > 0 && bytes <= limit;
  const commit = () => {
    if (!valid) return;
    const next = draft.trim();
    setDraft(null);
    if (valid && next !== name) void set("name", next);
  };

  return (
    <span className="name-field is-editing">
      <input
        autoFocus
        className="name-field__input"
        aria-label="音箱名称"
        aria-invalid={!valid}
        value={draft}
        maxLength={64}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(null); }
        }}
      />
      <button className="icon-btn" aria-label="取消" onClick={() => setDraft(null)}>
        <IconClose size={13} />
      </button>
      <button className="icon-btn is-accent" aria-label="保存" disabled={!valid} onClick={commit}>
        <IconCheck size={13} />
      </button>
      {!valid && <span className="name-field__error">{bytes === 0 ? "请输入名称" : "名称过长"}</span>}
    </span>
  );
}

export function SpeakerConsole({ onClose }: { onClose(): void }) {
  const {
    phase,
    values,
    stopping,
    pendingInput,
    set,
    setEqBand,
    resetEq,
    connect,
    disconnect,
    powerOff,
  } = useDevice();
  const [subTab, setSubTab] = useState<"studio" | "prefs">("studio");
  const [timerOpen, setTimerOpen] = useState(false);

  const connected = phase === "connected";
  const volume = connected ? values.volume : undefined;
  const input = connected ? values.input : undefined;
  const preset = connected ? values.preset : undefined;
  const eq = connected ? values.eq : undefined;
  const led = connected ? values.led?.value : undefined;
  const idle = connected ? values.idle_shutdown?.value : undefined;
  const timer = connected ? values.timer?.value : undefined;

  const customChoice = preset?.choices.find(
    (c) => c.value === "customized" || c.value === "audiophile",
  );
  const isCustom = preset?.value === "customized" || preset?.value === "audiophile";
  const flatEq = !eq || eq.value.every((b) => b.gain_db === 0);

  return (
    <div className="console-modal console-modal--speaker">
      <ConsoleHeader title={<SpeakerNameEditor />}
        subtitle={`音响 · ${connected ? "已连接" : phase === "connecting" ? "正在连接" : "未连接"}`}
        status={connected ? "ok" : phase === "connecting" ? "busy" : "off"}
        onClose={onClose}
        actions={
          <button
            className={`console-icon-toggle${subTab === "prefs" ? " is-active" : ""}`}
            aria-label={subTab === "studio" ? "音箱偏好设置" : "返回声场主控"}
            title={subTab === "studio" ? "偏好设置" : "返回调音台"}
            onClick={() => setSubTab(subTab === "studio" ? "prefs" : "studio")}
            aria-pressed={subTab === "prefs"}
          >
            {subTab === "studio" ? <IconSliders size={14} /> : <IconDial size={14} />}
            <span>{subTab === "studio" ? "设备设置" : "返回调音"}</span>
          </button>
        }
      />

      {subTab === "studio" ? (
        <div className="speaker-studio">
          {/* 左翼：阻尼旋钮与输入源切换 */}
          <div className="speaker-studio__left">
            <div className="speaker-studio__dial-wrap">
              <div className="speaker-volume-readout"><strong>{connected?volume?.value??"—":"—"}</strong><span>/ {volume?.max??16}</span></div>
              <ValueSlider label="音量"
                value={connected?volume?.value ?? null:null}
                min={volume?.min ?? 0}
                max={volume?.max ?? 16}
                step={volume?.step ?? 1}
                disabled={!connected}
                showValue={false}
                onCommit={(v) => set("volume", v)}
              />
            </div>

            <div className="speaker-studio__source">
              {!connected ? (
                <div className="connection-panel">
                  {(phase === "waiting" || phase === "disconnected") && (
                    <button className="btn-primary" onClick={connect} disabled={stopping}>
                      {phase === "waiting" ? "重新连接" : "连接音箱"}
                    </button>
                  )}
                </div>
              ) : (
                <Segmented
                  ariaLabel="输入源"
                  size="s"
                  options={(input?.choices ?? PLACEHOLDER_INPUTS).map((c) => ({
                    value: c.value,
                    label: c.label,
                    icon: inputIcon(c.value, 14),
                  }))}
                  value={pendingInput ?? input?.value}
                  disabled={!input || pendingInput !== null}
                  busy={pendingInput !== null}
                  onChange={(v) => void set("input", v)}
                />
              )}
            </div>
          </div>

          {/* 频段和范围由设备能力提供。 */}
          <div className="speaker-studio__right">
            <div className="speaker-studio__preset-box">
              <div className="speaker-studio__section-head">
                <span className="speaker-studio__title">音效模式</span>
              </div>
              <PresetPicker
                choices={preset?.choices ?? PLACEHOLDER_PRESETS}
                value={preset?.value}
                disabled={!connected || !preset}
                onChange={(c) => void set("preset", c.value)}
              />
            </div>

            <section className={`eq-card speaker-studio__eq${connected && eq ? "" : " is-disabled"}`}>
              <div className="eq-card__head">
                <span className="eq-card__title">均衡器</span>
                {isCustom ? (
                  <button className="btn-ghost" disabled={flatEq} onClick={resetEq}>
                    重置
                  </button>
                ) : (
                  <button
                    className="btn-ghost is-accent"
                    disabled={!connected || !customChoice}
                    onClick={() => {
                      if (customChoice) void set("preset", customChoice.value);
                    }}
                  >
                    自定义调节
                  </button>
                )}
              </div>
              <EqCurve eq={eq} editable={!!isCustom && connected} onCommit={setEqBand} />
            </section>
          </div>
        </div>
      ) : (
        <div className="speaker-prefs">
          <div className="speaker-prefs__grid">
            <div className="speaker-prefs__card">
              <Group label="硬件偏好">
                <Row icon={<IconLight />} title="状态指示灯" desc="音箱底部呼吸灯开关" disabled={led == null}>
                  <Toggle
                    label="指示灯"
                    on={!!led}
                    disabled={led == null}
                    onChange={(v) => void set("led", v)}
                  />
                </Row>
                <Row
                  icon={<IconMoon />}
                  title="无信号自动待机"
                  desc="无音频输入时自动休眠"
                  disabled={idle == null}
                >
                  <Toggle
                    label="无信号自动关机"
                    on={!!idle}
                    disabled={idle == null}
                    onChange={(v) => void set("idle_shutdown", v)}
                  />
                </Row>
              </Group>
            </div>

            <div className="speaker-prefs__card">
              <Group label="定时与电源">
                <ExpandRow
                  icon={<IconTimer />}
                  title="睡眠定时"
                  value={timer == null ? "—" : timer === 0 ? "关闭" : `${timer} 分钟`}
                  open={timerOpen && timer != null}
                  disabled={timer == null}
                  onToggle={() => setTimerOpen((o) => !o)}
                >
                  <Segmented
                    size="s"
                    ariaLabel="定时关机"
                    options={TIMER_OPTIONS.map((m) => ({
                      value: m,
                      label: m === 0 ? "关闭" : `${m}′`,
                    }))}
                    value={timer}
                    onChange={(v) => void set("timer", v)}
                  />
                </ExpandRow>
                <Row
                  icon={<IconLink />}
                  title={connected ? "断开连接" : "连接音箱"}
                  disabled={stopping}
                  onClick={connected ? disconnect : connect}
                />
                <HoldRow
                  icon={<IconPower />}
                  title="关闭音箱电源"
                  hint="长按 1.1 秒"
                  disabled={!connected}
                  onConfirm={powerOff}
                />
              </Group>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
