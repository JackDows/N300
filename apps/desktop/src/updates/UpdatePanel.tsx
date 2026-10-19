import { useUpdate } from "./UpdateContext";
import "./updates.css";

export function UpdateNotice({ onOpen }: { onOpen(): void }) {
  const update = useUpdate();
  if (!update.release || update.dismissed || update.stage !== "available") return null;
  return <aside className="update-notice" aria-label="更新提醒">
    <span>新版本 {update.release.version} 可用</span>
    <button className="btn-ghost is-accent" onClick={onOpen}>查看更新</button>
    <button className="btn-ghost" onClick={update.dismiss}>稍后</button>
  </aside>;
}

export function UpdatePanel() {
  const update = useUpdate();
  const busy = update.stage === "downloading" || update.stage === "installing";
  const percent = update.total ? Math.min(100, Math.round(update.downloaded / update.total * 100)) : null;
  const status = update.stage === "checking" ? "正在检查更新…"
    : update.stage === "current" ? "已是最新版本"
    : update.stage === "installing" ? "正在安装，应用将自动重启…"
    : update.stage === "downloading" ? `正在下载${percent == null ? "…" : ` ${percent}%`}`
    : update.message;
  return <section className="update-panel" aria-label="软件更新" id="software-update">
    <div className="update-panel__heading"><div><h3>软件更新</h3><span>当前版本 {update.version || "—"}</span></div>
      <button className="btn-ghost" onClick={update.check} disabled={busy || update.stage === "checking"}>检查更新</button>
    </div>
    {status && <p className={update.stage === "error" ? "update-panel__error" : ""} role="status">{status}</p>}
    {update.release && <div className="update-panel__release">
      <strong>新版本 {update.release.version}</strong>
      {update.release.notes && <p className="update-panel__notes">{update.release.notes}</p>}
      <p>更新后应用会自动重启，你的设置和设备记录会保留。</p>
      {busy ? <progress aria-label="更新下载进度" max={100} value={percent ?? undefined} />
        : <button className="btn-primary" onClick={update.install}>{update.stage === "error" ? "重试更新" : "下载并更新"}</button>}
    </div>}
  </section>;
}
