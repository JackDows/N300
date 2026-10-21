import { useState } from "react";
import { ConsoleHeader } from "../components/ConsoleHeader";
import { useDevice } from "../device/DeviceContext";
import { getTransport, isTauri } from "../device/transport";
import { recordUiError } from "../diagnostics";
import { UpdatePanel } from "../updates/UpdatePanel";
import { useMouse } from "../device/MouseContext";
import { ModulePanel } from "../updates/ModulePanel";

export function SystemConsole({ onClose, onSelectDevice }: {
  onClose(): void;
  onSelectDevice(device: "speaker" | "keyboard" | "mouse"): void;
}) {
  const { phase, stopping, connect, disconnect, keyboard, kbBusy, connectKeyboard, disconnectKeyboard, notify } = useDevice();
  const mouse = useMouse();
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const nodes = [
    { id: "speaker" as const, name: "N300", kind: "音响", connected: phase === "connected", connecting: phase === "connecting", busy: stopping, connect, disconnect },
    { id: "keyboard" as const, name: "OG98", kind: "键盘", connected: keyboard.connected, connecting: keyboard.phase === "connecting", busy: kbBusy, connect: connectKeyboard, disconnect: disconnectKeyboard },
    { id: "mouse" as const, name: mouse.info?.name ?? "Logitech 鼠标", kind: "鼠标", connected: mouse.connected, connecting: mouse.busy, busy: mouse.busy, connect: mouse.connect, disconnect: mouse.disconnect },
  ];
  const exportLogs = async () => {
    setExporting(true);
    try {
      const { directory } = await (await getTransport()).request("diagnostics.export");
      setExportPath(directory);
      notify("日志已导出");
    } catch (error) { recordUiError(error, "diagnostics.export"); notify("日志导出未完成，请重试", "error"); }
    finally { setExporting(false); }
  };
  return <div className="console-modal console-modal--system">
    <ConsoleHeader title="DeskHub" subtitle="设备与应用" onClose={onClose} />
    <div className="sys-popover">
      <div className="sys-nodes">
        {nodes.map(node => <div className="sys-node-card" key={node.id}>
          <button className="sys-node-card__main" onClick={() => onSelectDevice(node.id)} aria-label={`打开 ${node.name} 设置`}>
            <span className={`status-dot is-${node.connected ? "ok" : node.connecting ? "busy" : "off"}`} aria-hidden="true" />
            <span className="sys-node-card__info">
              <span className="sys-node-card__title">{node.name}</span>
              <span className="sys-node-card__desc">{node.kind} · {node.connected ? "已连接" : node.connecting ? "正在连接" : "未连接"}</span>
            </span>
          </button>
          <div className="sys-node-card__actions">
            <button className="btn-ghost" aria-label={`${node.connected ? "断开" : "连接"} ${node.name}`}
              disabled={node.busy || node.connecting} onClick={node.connected ? node.disconnect : node.connect}>
              {node.connecting ? "连接中…" : node.busy ? "请稍候…" : node.connected ? "断开" : "连接"}
            </button>
          </div>
        </div>)}
      </div>
      <UpdatePanel />
      <ModulePanel />
      <div className="diagnostics-row">
        <div className="diagnostics-row__head"><span>问题排查</span>
          <button className="btn-ghost" disabled={!isTauri || exporting} onClick={exportLogs}>{exporting ? "正在导出…" : "导出日志"}</button>
        </div>
        {exportPath && <input className="diagnostics-path" aria-label="日志保存位置" readOnly value={exportPath} onFocus={event => event.target.select()} />}
      </div>
    </div>
  </div>;
}
