import { ConsoleHeader } from "../components/ConsoleHeader";
import { useState } from "react";
import { MouseTools } from "./MouseTools";
import { Segmented } from "../components/Segmented";
import { useMouse, type MouseReading } from "../device/MouseContext";
import "./MouseConsole.css";

export function MouseConsole({ onClose, active=true }: { onClose(): void; active?:boolean }) {
  const [panel,setPanel]=useState<"sensitivity"|"buttons"|"macros">("sensitivity");
  const mouse = useMouse();
  const values = mouse.connected ? mouse.snapshot?.values ?? {} : {};
  const stage = values["mouse.dpiStage"] as MouseReading<string> | undefined;
  const rate = values["mouse.reportRate"] as MouseReading<number> | undefined;
  const mode = values["device.onboardMode"] as MouseReading<boolean> | undefined;
  const profile = values["mouse.profile"] as MouseReading<string> | undefined;
  const battery = values["device.battery"]?.value as { percentage?: number; charging?: boolean } | undefined;
  const selected = stage?.choices?.find(choice => choice.value === stage.value);
  const disabled = !mouse.connected || mouse.busy;
  return <div className="console-modal console-modal--mouse" data-panel={panel}>
    <ConsoleHeader title={mouse.info?.name ?? "Logitech 鼠标"} subtitle={`鼠标 · ${mouse.status}`}
      status={mouse.connected ? "ok" : mouse.busy || mouse.snapshot?.phase === "waiting" ? "busy" : "off"} onClose={onClose}
      actions={(panel==="sensitivity"||!mouse.connected)&&<button className="console-icon-toggle" disabled={mouse.busy} onClick={mouse.connected ? mouse.refresh : mouse.connect}>
        {mouse.busy ? "请稍候…" : mouse.connected ? "刷新状态" : "重新连接"}
      </button>} />
    <div className="console-tabs" role="tablist" aria-label="鼠标设置页面">{([["sensitivity","灵敏度"],["buttons","按键"],["macros","宏"]] as const).map(([value,label])=><button key={value} role="tab" aria-selected={panel===value} onClick={()=>setPanel(value)}>{label}</button>)}</div>
    <div hidden={panel==="sensitivity"}><MouseTools active={active&&panel!=="sensitivity"} panel={panel==="macros"?"macros":"buttons"}/></div>
    <div className="mouse-console" hidden={panel!=="sensitivity"}>
      {mouse.message && <p className="mouse-message" role="status">{mouse.message}</p>}
      <section className="mouse-sensitivity" aria-label="鼠标灵敏度">
        <div className="mouse-sensitivity__head">
          <span>{stage?.label ?? "灵敏度"}</span>
          {battery?.percentage != null && <span className="mouse-battery"><span className="mouse-battery__icon" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, battery.percentage))}%` }} /></span>{battery.charging ? "充电中 · " : ""}{Math.round(battery.percentage)}%</span>}
        </div>
        <div className="mouse-dpi"><strong>{mouse.connected && selected ? selected.label : "—"}</strong><span>DPI</span></div>
        <div className="mouse-stages">
          {stage?.choices?.length ? <Segmented ariaLabel="DPI 档位" size="s" options={stage.choices} value={stage.value}
            disabled={disabled || !stage.writable} onChange={value => void mouse.write("mouse.dpiStage", value)} /> : <span className="mouse-empty">{mouse.connected ? "当前配置暂无 DPI 档位" : "连接后显示 DPI 档位"}</span>}
        </div>
      </section>
      <section className="mouse-preferences" aria-label="鼠标控制设置">
        <div className="mouse-setting"><div><span className="mouse-setting__label">回报率</span><span className="mouse-setting__detail">每秒向电脑报告的位置次数</span></div>
          <select aria-label="回报率" value={rate?.value ?? ""} disabled={disabled || !rate?.writable}
            onChange={event => void mouse.write("mouse.reportRate", Number(event.target.value))}>
            {!rate?.choices?.length && <option value={rate?.value ?? ""}>{rate?.value ? `${rate.value} Hz` : "—"}</option>}
            {rate?.choices?.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        </div>
        <div className="mouse-setting mouse-setting--mode"><span className="mouse-setting__label">控制模式</span>
          <Segmented ariaLabel="鼠标控制模式" size="s" options={[{value:"software",label:"软件控制"},{value:"onboard",label:"板载配置"}]}
            value={mode == null ? undefined : mode.value ? "onboard" : "software"} disabled={disabled || !mode?.writable}
            onChange={value => void mouse.write("device.onboardMode", value === "onboard")} />
        </div>
        {mode?.value && <div className="mouse-setting">
          <div><span className="mouse-setting__label">板载配置</span><span className="mouse-setting__detail">调整 DPI 和回报率请切换到软件控制</span></div>
          <select aria-label="板载配置" value={profile?.value ?? ""} disabled={disabled || !profile?.writable}
            onChange={event => void mouse.write("mouse.profile", event.target.value)}>
            {!profile?.choices?.length && <option value="">—</option>}
            {profile?.choices?.map(choice => <option value={choice.value} key={choice.value}>{choice.label}</option>)}
          </select>
        </div>}
      </section>
      <div className="mouse-footer">
        <span>{mouse.info?.connection === "LIGHTSPEED" ? "LIGHTSPEED 无线" : mouse.info?.connection || "Logitech G HUB"}{mouse.info?.firmware ? ` · 固件 ${mouse.info.firmware}` : ""}</span>
        <button className="btn-ghost" disabled={mouse.busy} onClick={mouse.scan}>选择设备</button>
      </div>
      {mouse.candidates.length > 1 && <div className="mouse-picker" role="group" aria-label="选择罗技鼠标">
        {mouse.candidates.map(candidate => <button className="btn-ghost" key={candidate.target.resourceId} disabled={mouse.busy}
          aria-pressed={candidate.target.resourceId === mouse.snapshot?.bindingTarget.resourceId} onClick={() => void mouse.select(candidate)}>{candidate.label}{candidate.available === false ? " · 未连接" : ""}</button>)}
      </div>}
    </div>
  </div>;
}
