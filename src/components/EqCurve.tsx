import { useEffect, useRef, useState, type PointerEvent } from "react";
import { formatHz } from "../device/DeviceContext";
import type { EqValue } from "../device/types";
import "./EqCurve.css";

interface Props {
  eq: EqValue | undefined;
  editable: boolean;
  onCommit(band: number, gain: number): void;
}

const W = 340;
const H = 176;
const PAD = { l: 30, r: 14, t: 26, b: 30 };
const PW = W - PAD.l - PAD.r;
const PH = H - PAD.t - PAD.b;
const F_MIN = 20;
const F_MAX = 20000;

const fx = (f: number) => PAD.l + (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * PW;

/** 曲线只是示意：把每个频段近似成对数频率上的钟形峰，用来直观展示增益走向。 */
function response(f: number, bands: { frequency_hz: number; gain_db: number }[]) {
  return bands.reduce((s, b) => s + b.gain_db * Math.exp(-(Math.log2(f / b.frequency_hz) ** 2) / (2 * 0.62 ** 2)), 0);
}

export function EqCurve({ eq, editable, onCommit }: Props) {
  const min = eq?.gain_min ?? -6;
  const max = eq?.gain_max ?? 6;
  const step = eq?.gain_step || 1;
  const [gains, setGains] = useState<number[]>(() => eq?.value.map((b) => b.gain_db) ?? []);
  const [dragging, setDragging] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (dragging == null && eq) setGains(eq.value.map((b) => b.gain_db));
  }, [eq, dragging]);

  const gy = (g: number) => PAD.t + ((max - g) / (max - min)) * PH;
  const bands = (eq?.value ?? []).map((b, i) => ({ ...b, gain_db: editable ? (gains[i] ?? b.gain_db) : 0 }));

  let line = "";
  for (let i = 0; i <= 180; i++) {
    const f = F_MIN * (F_MAX / F_MIN) ** (i / 180);
    const g = Math.max(min - 0.6, Math.min(max + 0.6, response(f, bands)));
    line += `${i ? "L" : "M"}${fx(f).toFixed(1)} ${gy(g).toFixed(1)}`;
  }
  const area = `${line}L${fx(F_MAX)} ${gy(0)}L${fx(F_MIN)} ${gy(0)}Z`;

  function gainAt(e: PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * H;
    const raw = max - ((y - PAD.t) / PH) * (max - min);
    return Math.max(min, Math.min(max, Math.round(raw / step) * step));
  }

  function onDown(e: PointerEvent<SVGGElement>, i: number) {
    if (!editable) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    setDragging(i);
  }

  function onMove(e: PointerEvent<SVGSVGElement>) {
    if (dragging == null) return;
    const g = gainAt(e);
    setGains((prev) => (prev[dragging] === g ? prev : prev.map((v, i) => (i === dragging ? g : v))));
  }

  function onUp() {
    if (dragging == null || !eq) return;
    const i = dragging;
    setDragging(null);
    if (gains[i] !== eq.value[i].gain_db) onCommit(eq.value[i].index, gains[i]);
  }

  return (
    <svg
      ref={svgRef}
      className={`eq${editable ? " is-editable" : ""}${dragging != null ? " is-dragging" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <defs>
        <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--accent)" }} stopOpacity="0.28" />
          <stop offset="1" style={{ stopColor: "var(--accent)" }} stopOpacity="0" />
        </linearGradient>
        <linearGradient id="eq-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--accent-lo)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--accent)" }} />
          <stop offset="1" style={{ stopColor: "var(--accent-hi)" }} />
        </linearGradient>
      </defs>

      {[max, 0, min].map((g) => (
        <g key={g}>
          <line className={`eq__grid${g === 0 ? " is-zero" : ""}`} x1={PAD.l} x2={W - PAD.r} y1={gy(g)} y2={gy(g)} />
          <text className="eq__axis" x={PAD.l - 8} y={gy(g) + 4} textAnchor="end">
            {g > 0 ? `+${g}` : g}
          </text>
        </g>
      ))}

      <path className="eq__area" d={area} fill="url(#eq-fill)" />
      <path className="eq__line" d={line} />

      {bands.map((b, i) => {
        const x = fx(b.frequency_hz);
        const y = gy(b.gain_db);
        return (
          <g
            key={b.index}
            className={`eq__band${dragging === i ? " is-active" : ""}`}
            onPointerDown={(e) => onDown(e, i)}
          >
            <text className="eq__freq" x={x} y={H - 8} textAnchor="middle">
              {formatHz(b.frequency_hz)}
            </text>
            {editable && (
              <>
                <line className="eq__stem" x1={x} x2={x} y1={gy(0)} y2={y} />
                <circle className="eq__hit" cx={x} cy={y} r={20} />
                <circle className="eq__handle" cx={x} cy={y} r={dragging === i ? 8 : 6.5} />
                <text className="eq__gain" x={x} y={y - 14} textAnchor="middle">
                  {b.gain_db > 0 ? `+${b.gain_db}` : b.gain_db}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
