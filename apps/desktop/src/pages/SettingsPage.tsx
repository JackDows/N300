import { useState } from "react";
import { ExpandRow, Group, HoldRow, Row, Toggle } from "../components/List";
import { Segmented } from "../components/Segmented";
import { SpeakerArt } from "../components/SpeakerArt";
import { IconCheck, IconClose, IconLight, IconLink, IconMoon, IconPencil, IconPower, IconTimer } from "../components/icons";
import { useDevice } from "../device/DeviceContext";
import { OfflineBanner } from "./OfflineBanner";
import { UpdatePanel } from "../updates/UpdatePanel";

const TIMER_OPTIONS = [0, 30, 60, 90, 120];
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

function NameField() {
  const { phase, state, values, set } = useDevice();
  const name = values.name?.value ?? state?.target?.name ?? "N300";
  const limit = state?.capabilities.rename_bytes ?? 24;
  const [draft, setDraft] = useState<string | null>(null);
  const editable = phase === "connected" && !!values.name;

  if (draft == null) {
    return (
      <div className="name-field">
        <span className="name-field__text">{name}</span>
        {editable && (
          <button className="icon-btn" aria-label="重命名" onClick={() => setDraft(name)}>
            <IconPencil size={15} />
          </button>
        )}
      </div>
    );
  }

  const bytes = utf8Bytes(draft.trim());
  const valid = bytes > 0 && bytes <= limit;
  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (valid && next !== name) set("name", next);
  };

  return (
    <div className="name-field is-editing">
      <input
        autoFocus
        className="name-field__input"
        value={draft}
        maxLength={64}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
      <span className={`name-field__count${valid ? "" : " is-over"}`}>
        {bytes}/{limit}
      </span>
      <button className="icon-btn" aria-label="取消" onClick={() => setDraft(null)}>
        <IconClose size={15} />
      </button>
      <button className="icon-btn is-accent" aria-label="保存" disabled={!valid} onClick={commit}>
        <IconCheck size={15} />
      </button>
    </div>
  );
}

export function SettingsPage() {
  const { phase, state, values, stopping, set, connect, disconnect, powerOff } = useDevice();
  const [timerOpen, setTimerOpen] = useState(false);
  const connected = phase === "connected";
  const led = values.led?.value;
  const idle = values.idle_shutdown?.value;
  const timer = values.timer?.value;
  const target = state?.target;

  return (
    <div className="page">
      <header className="page-head">
        <h2>设置</h2>
      </header>

      <OfflineBanner />

      <section className="device-card">
        <div className="device-card__art">
          <SpeakerArt led={connected && !!led} size={64} />
        </div>
        <div className="device-card__info">
          <NameField />
          <dl className="device-card__meta">
            <div>
              <dt>固件</dt>
              <dd>{values.firmware?.value ?? "—"}</dd>
            </div>
            <div>
              <dt>信号</dt>
              <dd>{connected && target?.rssi != null ? `${target.rssi} dBm` : "—"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <Group label="音箱">
        <Row icon={<IconLight />} title="指示灯" disabled={led == null}>
          <Toggle label="指示灯" on={!!led} disabled={led == null} onChange={(v) => set("led", v)} />
        </Row>
        <Row icon={<IconMoon />} title="无信号自动关机" desc="长时间没有音频输入时关机" disabled={idle == null}>
          <Toggle
            label="无信号自动关机"
            on={!!idle}
            disabled={idle == null}
            onChange={(v) => set("idle_shutdown", v)}
          />
        </Row>
        <ExpandRow
          icon={<IconTimer />}
          title="定时关机"
          value={timer == null ? "—" : timer === 0 ? "关闭" : `${timer} 分钟后`}
          open={timerOpen && timer != null}
          disabled={timer == null}
          onToggle={() => setTimerOpen((o) => !o)}
        >
          <Segmented
            size="s"
            ariaLabel="定时关机"
            options={TIMER_OPTIONS.map((m) => ({ value: m, label: m === 0 ? "关闭" : `${m}′` }))}
            value={timer}
            onChange={(v) => set("timer", v)}
          />
        </ExpandRow>
      </Group>

      <Group label="连接">
        <Row
          icon={<IconLink />}
          title={stopping ? "正在停止…" : connected ? "断开连接" : phase === "disconnected" ? "连接音箱" : phase === "waiting" ? "停止重试" : "取消连接"}
          desc={target?.address}
          disabled={stopping}
          onClick={phase === "disconnected" ? connect : disconnect}
        />
        <HoldRow icon={<IconPower />} title="关闭音箱" hint="长按" disabled={!connected} onConfirm={powerOff} />
      </Group>

      <UpdatePanel />
    </div>
  );
}
