import { useDevice } from "../device/DeviceContext";

/** 未连接时在子页面顶部提示，并给出连接入口。 */
export function OfflineBanner() {
  const { phase, connect } = useDevice();
  if (phase === "connected") return null;
  const busy = phase !== "disconnected";
  return (
    <div className="offline-banner">
      <span className={`status-dot is-${busy ? "busy" : "off"}`} />
      <span className="offline-banner__text">{busy ? "正在连接音箱…" : "音箱未连接"}</span>
      {!busy && (
        <button className="btn-ghost is-accent" onClick={connect}>
          连接
        </button>
      )}
    </div>
  );
}
