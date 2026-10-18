import { useId } from "react";

/**
 * 音箱示意插画（矢量，非官方产品图）。正式版可换成官方渲染图。
 * led 控制前面板指示灯是否点亮。
 */
export function SpeakerArt({ led = false, size = 72 }: { led?: boolean; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size * 1.5} viewBox="0 0 120 180" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}cab`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2c2c31" />
          <stop offset="1" stopColor="#131315" />
        </linearGradient>
        <radialGradient id={`${id}cone`} cx="0.42" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#34343a" />
          <stop offset="0.65" stopColor="#141416" />
          <stop offset="1" stopColor="#0b0b0c" />
        </radialGradient>
        <radialGradient id={`${id}dome`} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#77777f" />
          <stop offset="0.5" stopColor="#2a2a2f" />
          <stop offset="1" stopColor="#111113" />
        </radialGradient>
        <filter id={`${id}glow`} x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      <rect x="4" y="4" width="112" height="172" rx="16" fill={`url(#${id}cab)`} />
      <rect x="4.5" y="4.5" width="111" height="171" rx="15.5" fill="none" stroke="rgba(255,255,255,.09)" />
      <path d="M20 5h80" stroke="rgba(255,255,255,.12)" />

      {/* 高音 */}
      <circle cx="60" cy="50" r="17" fill="#0d0d0f" stroke="rgba(255,255,255,.07)" />
      <circle cx="60" cy="50" r="9" fill={`url(#${id}dome)`} />

      {/* 低音 */}
      <circle cx="60" cy="114" r="38" fill="#0c0c0e" stroke="rgba(255,255,255,.07)" />
      <circle cx="60" cy="114" r="32" fill={`url(#${id}cone)`} />
      <circle cx="60" cy="114" r="24" fill="none" stroke="rgba(255,255,255,.035)" />
      <circle cx="60" cy="114" r="11" fill={`url(#${id}dome)`} />

      {/* 指示灯 */}
      {led && <circle cx="60" cy="164" r="3" fill="var(--accent)" filter={`url(#${id}glow)`} />}
      <circle cx="60" cy="164" r="1.6" style={{ fill: led ? "var(--accent-hi)" : "#2a2a2e", transition: "fill .3s" }} />
    </svg>
  );
}
