import { errorText, useDevice } from "../device/DeviceContext";

/** 未连接时在子页面顶部提示，并给出连接入口。 */
export function OfflineBanner() {
  const { phase, error, stopping, connect, disconnect } = useDevice();
  if (phase === "connected") return null;
  const busy = phase === "starting" || phase === "connecting";
  return (
    <div className="offline-banner">
      <span className={`status-dot is-${busy ? "busy" : "off"}`} />
      <span className="offline-banner__text">{busy ? "正在连接音箱…" : error ? errorText(error) : "音箱未连接"}</span>
      <button className="btn-ghost is-accent" disabled={stopping} onClick={phase === "disconnected" ? connect : disconnect}>
        {stopping ? "停止中…" : phase === "disconnected" ? "连接" : "停止"}
      </button>
    </div>
  );
}
