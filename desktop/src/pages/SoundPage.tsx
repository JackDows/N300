import { EqCurve } from "../components/EqCurve";
import { PresetPicker } from "../components/PresetPicker";
import { useDevice } from "../device/DeviceContext";
import { OfflineBanner } from "./OfflineBanner";

const DESCRIPTIONS: Record<string, string> = {
  music: "均衡饱满，适合日常聆听",
  monitor: "平直还原，尽量接近原声",
  game: "强调定位与细节",
  movie: "宽广声场，对白清晰",
  customized: "按你的耳朵调节均衡器",
};

const PLACEHOLDER = [
  { label: "音乐", raw: 0, value: "music" },
  { label: "监听", raw: 1, value: "monitor" },
  { label: "游戏", raw: 2, value: "game" },
  { label: "电影", raw: 3, value: "movie" },
  { label: "自定义", raw: 4, value: "customized" },
];

export function SoundPage() {
  const { phase, values, set, setEqBand, resetEq } = useDevice();
  const connected = phase === "connected";
  const preset = values.preset;
  const eq = values.eq;
  const current = preset?.choices.find((c) => c.value === preset.value);
  const customChoice = preset?.choices.find((choice) => choice.value === "customized" || choice.value === "audiophile");
  const custom = preset?.value === "customized" || preset?.value === "audiophile";
  const flat = !eq || eq.value.every((b) => b.gain_db === 0);

  return (
    <div className="page">
      <header className="page-head">
        <h2>音效</h2>
        <p key={String(preset?.value)} className="fade-text">
          {current ? (DESCRIPTIONS[String(current.value)] ?? current.label) : "选择一种声音风格"}
        </p>
      </header>

      <OfflineBanner />

      <PresetPicker
        choices={preset?.choices ?? PLACEHOLDER}
        value={preset?.value}
        disabled={!connected || !preset}
        onChange={(c) => set("preset", c.value)}
      />

      <section className={`eq-card${connected && eq ? "" : " is-disabled"}`}>
        <div className="eq-card__head">
          <div>
            <div className="eq-card__title">均衡器</div>
            <div className="eq-card__sub">
              {custom ? "拖动节点调节各频段增益" : current ? `${current.label}模式由音箱内部调校` : "连接后可调节"}
            </div>
          </div>
          {custom ? (
            <button className="btn-ghost" disabled={flat} onClick={resetEq}>
              复位
            </button>
          ) : (
            <button
              className="btn-ghost is-accent"
              disabled={!connected || !customChoice}
              onClick={() => { if (customChoice) void set("preset", customChoice.value); }}
            >
              自定义
            </button>
          )}
        </div>
        <EqCurve eq={eq} editable={!!custom && connected} onCommit={setEqBand} />
      </section>
    </div>
  );
}
