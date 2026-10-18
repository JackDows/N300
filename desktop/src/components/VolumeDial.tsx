import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import "./VolumeDial.css";

interface Props {
  value: number | null;
  min: number;
  max: number;
  step: number;
  loading?: boolean;
  onCommit(value: number): void;
}

const SIZE = 288;
const C = SIZE / 2;
const R_ARC = 116;
const START = -135;
const SWEEP = 270;
const COMMIT_DELAY = 160;

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)] as const;
};

const arcPath = (from: number, to: number, r: number) => {
  const [x0, y0] = polar(from, r);
  const [x1, y1] = polar(to, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/**
 * 音量旋钮。拖动采用“相对旋转”：按下时不跳值，只按转过的角度增减，避免误触把音量拉满。
 * 同时支持滚轮和方向键；停止操作 160 ms 后才提交写入。
 */
export function VolumeDial({ value, min, max, step, loading, onCommit }: Props) {
  const disabled = value == null;
  const [draft, setDraft] = useState(value ?? min);
  const [active, setActive] = useState(false);
  const draftRef = useRef(draft);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ last: number; acc: number; base: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // 设备回读的值在用户没操作时同步到界面。
  useEffect(() => {
    if (value == null || commitTimer.current || drag.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => () => clearTimeout(commitTimer.current ?? undefined), []);

  const steps = Math.max(1, Math.round((max - min) / step));
  const clamp = (v: number) => Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));

  function change(next: number) {
    next = clamp(next);
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraft(next);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      onCommitRef.current(draftRef.current);
    }, COMMIT_DELAY);
  }

  const pointerAngle = (e: PointerEvent) => {
    const r = rootRef.current!.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { last: pointerAngle(e), acc: 0, base: draftRef.current };
    setActive(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const a = pointerAngle(e);
    let delta = a - d.last;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    d.last = a;
    d.acc += delta;
    change(d.base + Math.round(d.acc / (SWEEP / steps)) * step);
  }

  function endDrag() {
    drag.current = null;
    setActive(false);
  }

  // React 的 wheel 监听是 passive，这里手动注册以便阻止页面滚动。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (disabled) return;
      e.preventDefault();
      change(draftRef.current + (e.deltaY < 0 ? step : -step));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onKeyDown(e: KeyboardEvent) {
    if (disabled) return;
    const map: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: step * 4,
      PageDown: -step * 4,
    };
    if (e.key in map) change(draftRef.current + map[e.key]);
    else if (e.key === "Home") change(min);
    else if (e.key === "End") change(max);
    else return;
    e.preventDefault();
  }

  const shown = disabled ? min : draft;
  const ratio = (shown - min) / (max - min || 1);
  const angle = START + SWEEP * ratio;
  const tickCount = Math.min(steps, 48) + 1;

  return (
    <div
      ref={rootRef}
      className={`dial${disabled ? " is-disabled" : ""}${active ? " is-active" : ""}${loading ? " is-loading" : ""}`}
      style={{ "--ratio": ratio } as CSSProperties}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="音量"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={disabled ? undefined : draft}
      aria-disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="dial__glow" />

      <svg className="dial__ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id="dial-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--accent-lo)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--accent)" }} />
            <stop offset="1" style={{ stopColor: "var(--accent-hi)" }} />
          </linearGradient>
          <filter id="dial-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {Array.from({ length: tickCount }, (_, i) => {
          const t = i / (tickCount - 1);
          const deg = START + SWEEP * t;
          const major = i === 0 || i === tickCount - 1 || i % 4 === 0;
          const [x0, y0] = polar(deg, 128);
          const [x1, y1] = polar(deg, major ? 136 : 133);
          const on = !disabled && t <= ratio + 1e-6;
          return (
            <line
              key={i}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              className={`dial__tick${on ? " is-on" : ""}${major ? " is-major" : ""}`}
            />
          );
        })}

        <path className="dial__track" d={arcPath(START, START + SWEEP, R_ARC)} />
        {!disabled && ratio > 0 && (
          <>
            <path className="dial__value-glow" d={arcPath(START, angle, R_ARC)} filter="url(#dial-blur)" />
            <path className="dial__value" d={arcPath(START, angle, R_ARC)} />
          </>
        )}
        {loading && (
          <g className="dial__spinner">
            <path d={arcPath(-40, 40, R_ARC)} />
          </g>
        )}
      </svg>

      <div className="dial__face">
        <div className="dial__indicator" style={{ transform: `rotate(${angle}deg)` }}>
          <span />
        </div>
        <div className="dial__readout">
          <span className="dial__value-text">{disabled ? "–" : draft}</span>
          <span className="dial__caption">{loading ? "连接中" : "音量"}</span>
        </div>
      </div>
    </div>
  );
}
