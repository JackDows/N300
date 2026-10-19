import { useState } from "react";
import type { ModalKind } from "./DeskStage";

interface DeskScene25DProps {
  spkConnected: boolean;
  spkLed: boolean;
  spkVolumeRatio: number;
  kbConnected: boolean;
  kbBrightnessRatio: number;
  kbRgb: [number, number, number];
  mouseConnected: boolean;
  mouseName: string;
  onSelectDevice(modal: Exclude<ModalKind, null>): void;
}

// 98 配列在 2.5D 透视下的 6 行键宽分布（无任何文字噪音，纯立体键帽几何雕塑）
const KB_PERSPECTIVE_ROWS: { w: number; kind?: "esc" | "enter" | "space" | "fn" | "oled" }[][] = [
  // Row 0: ESC + F区 + 右上角灯窗
  [
    { w: 1, kind: "esc" },
    { w: 0.25 },
    { w: 1, kind: "fn" },
    { w: 1, kind: "fn" },
    { w: 1, kind: "fn" },
    { w: 1, kind: "fn" },
    { w: 0.2 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 0.2 },
    { w: 1, kind: "fn" },
    { w: 1, kind: "fn" },
    { w: 1, kind: "fn" },
    { w: 1, kind: "fn" },
    { w: 0.2 },
    { w: 1, kind: "fn" },
    { w: 0.35 },
    { w: 3.8, kind: "oled" },
  ],
  // Row 1: 数字行 + 小键盘顶行
  [
    { w: 1, kind: "fn" },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1.85, kind: "fn" },
    { w: 0.35 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9, kind: "fn" },
  ],
  // Row 2: QWERTY
  [
    { w: 1.4, kind: "fn" },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1.45, kind: "fn" },
    { w: 0.35 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9, kind: "fn" },
  ],
  // Row 3: ASDF
  [
    { w: 1.7, kind: "fn" },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 2.15, kind: "enter" },
    { w: 0.35 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9, kind: "fn" },
  ],
  // Row 4: ZXCV + 上方向键 + 小键盘
  [
    { w: 2.15, kind: "fn" },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1 },
    { w: 1.65, kind: "fn" },
    { w: 0.15 },
    { w: 0.95, kind: "fn" },
    { w: 0.25 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9, kind: "enter" },
  ],
  // Row 5: 底行空格与方向键
  [
    { w: 1.25, kind: "fn" },
    { w: 1.25, kind: "fn" },
    { w: 1.25, kind: "fn" },
    { w: 6.1, kind: "space" },
    { w: 1.15, kind: "fn" },
    { w: 1.15, kind: "fn" },
    { w: 0.25 },
    { w: 0.95, kind: "fn" },
    { w: 0.95, kind: "fn" },
    { w: 0.95, kind: "fn" },
    { w: 0.25 },
    { w: 0.9 },
    { w: 0.9 },
    { w: 0.9, kind: "fn" },
  ],
];

export function DeskScene25D({
  spkConnected,
  spkLed,
  spkVolumeRatio,
  kbConnected,
  kbBrightnessRatio,
  kbRgb,
  mouseConnected,
  mouseName,
  onSelectDevice,
}: DeskScene25DProps) {
  const [hoverTarget, setHoverTarget] = useState<"speaker" | "keyboard" | "mouse" | "system" | null>(
    null,
  );

  const [kr, kg, kb] = kbRgb;
  const kbColor = `rgb(${kr}, ${kg}, ${kb})`;
  const kbAlpha = (a: number) => `rgba(${kr}, ${kg}, ${kb}, ${a.toFixed(3)})`;
  const effKbRatio = kbConnected ? Math.max(0, Math.min(1, kbBrightnessRatio)) : 0;
  const effSpkRatio = spkConnected ? Math.max(0.2, spkVolumeRatio) : 0.15;

  // 2.5D 键盘透视投影函数：将键盘局部坐标 (u: 0..1, v: 0..1) 映射到 2.5D 桌面透视梯形
  const projectKb = (u: number, v: number) => {
    const topLeftX = 278;
    const topRightX = 682;
    const botLeftX = 250;
    const botRightX = 702;
    const topY = 474;
    const botY = 584;

    // 随景深 v 略微加速的透视插值
    const vp = Math.pow(v, 1.06);
    const leftX = topLeftX + (botLeftX - topLeftX) * vp;
    const rightX = topRightX + (botRightX - topRightX) * vp;
    const x = leftX + (rightX - leftX) * u;
    const y = topY + (botY - topY) * vp;
    return { x, y };
  };

  return (
    <div className="desk25d-wrap">
      <svg
        className="desk25d-svg"
        viewBox="0 0 1100 700"
        preserveAspectRatio="xMidYMid meet"
        aria-label="桌面设备"
      >
        <defs>
          {/* 1. 暗室建筑背景渐变 */}
          <linearGradient id="room-wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0c0f13" />
            <stop offset="52%" stopColor="#11161c" />
            <stop offset="100%" stopColor="#0c0f13" />
          </linearGradient>

          {/* 赛博朦胧背景主光雾（显示器背后的青紫双色霓虹云） */}
          <radialGradient id="haze-cyber-center" cx="50%" cy="34%" r="46%">
            <stop offset="0%" stopColor="#9ebdb8" stopOpacity="0.22" />
            <stop offset="38%" stopColor="#a5aaa3" stopOpacity="0.16" />
            <stop offset="72%" stopColor="#dfb77b" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#0c0f13" stopOpacity="0" />
          </radialGradient>

          {/* 左右音响背后的暖珀色声学朦胧光雾 */}
          <radialGradient id="haze-spk-left" cx="21%" cy="42%" r="24%">
            <stop offset="0%" stopColor="#d9b988" stopOpacity={0.04 + effSpkRatio * 0.062} />
            <stop offset="55%" stopColor="#a18968" stopOpacity={0.04 + effSpkRatio * 0.06} />
            <stop offset="100%" stopColor="#0c0f13" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="haze-spk-right" cx="79%" cy="42%" r="24%">
            <stop offset="0%" stopColor="#d9b988" stopOpacity={0.04 + effSpkRatio * 0.062} />
            <stop offset="55%" stopColor="#a18968" stopOpacity={0.04 + effSpkRatio * 0.06} />
            <stop offset="100%" stopColor="#0c0f13" stopOpacity="0" />
          </radialGradient>

          {/* 2.5D 桌面台面材质（深黑曜石胡桃哑光台面） */}
          <linearGradient id="desk-surface" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22272f" />
            <stop offset="32%" stopColor="#1b2027" />
            <stop offset="85%" stopColor="#151a20" />
            <stop offset="100%" stopColor="#11151a" />
          </linearGradient>

          {/* 桌沿背部 RGB 氛围灯带漫反射 */}
          <linearGradient id="desk-back-led" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#dfb77b" stopOpacity="0" />
            <stop offset="20%" stopColor="#dfb77b" stopOpacity="0.65" />
            <stop offset="50%" stopColor="#8bcac3" stopOpacity="0.85" />
            <stop offset="80%" stopColor="#dfb77b" stopOpacity="0.65" />
            <stop offset="100%" stopColor="#dfb77b" stopOpacity="0" />
          </linearGradient>

          {/* 桌面屏幕挂灯锥形投射光 */}
          <radialGradient id="screenbar-cone" cx="50%" cy="18%" r="52%">
            <stop offset="0%" stopColor="#fae1b0" stopOpacity="0.2" />
            <stop offset="45%" stopColor="#8bcac3" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>

          {/* 2.5D 桌垫材质 */}
          <linearGradient id="desk-mat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d1018" />
            <stop offset="100%" stopColor="#080a10" />
          </linearGradient>

          {/* 键盘底盘漫射光晕 */}
          <radialGradient id="kb-mat-bleed" cx="48%" cy="54%" r="48%">
            <stop offset="0%" stopColor={kbColor} stopOpacity={0.36 * effKbRatio} />
            <stop offset="65%" stopColor={kbColor} stopOpacity={0.12 * effKbRatio} />
            <stop offset="100%" stopColor={kbColor} stopOpacity="0" />
          </radialGradient>

          {/* 显示器壁纸渐变 */}
          <linearGradient id="mon-wallpaper" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#19252c" />
            <stop offset="48%" stopColor="#20282b" />
            <stop offset="100%" stopColor="#121a21" />
          </linearGradient>
          <radialGradient id="mon-sun" cx="50%" cy="62%" r="42%">
            <stop offset="0%" stopColor="#f6c87a" stopOpacity="0.42" />
            <stop offset="42%" stopColor="#b9c7bd" stopOpacity="0.22" />
            <stop offset="78%" stopColor="#8bcac3" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#121a21" stopOpacity="0" />
          </radialGradient>

          {/* 音箱立体箱体渐变 */}
          <linearGradient id="spk-front" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#343b44" />
            <stop offset="100%" stopColor="#1c222b" />
          </linearGradient>
          <linearGradient id="spk-side" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1b1d26" />
            <stop offset="100%" stopColor="#0c0e14" />
          </linearGradient>
          <radialGradient id="spk-cone" cx="45%" cy="40%" r="65%">
            <stop offset="0%" stopColor="#353844" />
            <stop offset="60%" stopColor="#161820" />
            <stop offset="100%" stopColor="#0a0b0f" />
          </radialGradient>

          <linearGradient id="key-surface" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#3b434d" /><stop offset="1" stopColor="#242c35" /></linearGradient>
          <linearGradient id="screen-ribbon" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b3cfc7" stopOpacity=".7" /><stop offset=".5" stopColor="#5b7e80" stopOpacity=".16" /><stop offset="1" stopColor="#dfb77b" stopOpacity=".5" /></linearGradient>
          <filter id="blur-soft" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <filter id="blur-tight" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* ==================== 1. 远景：赛博暗室声学格栅墙与朦胧光雾 ==================== */}
        <rect x="0" y="0" width="1100" height="700" fill="url(#room-wall)" />

        {/* 竖向暗室建筑格栅线 */}
        <g opacity="0.28">
          {Array.from({ length: 34 }).map((_, i) => {
            const x = 60 + i * 30;
            return (
              <line
                key={i}
                x1={x}
                y1="0"
                x2={x}
                y2="375"
                stroke="rgba(255, 255, 255, 0.045)"
                strokeWidth="2"
              />
            );
          })}
        </g>

        {/* 墙面朦胧赛博光雾层 */}
        <rect x="0" y="0" width="1100" height="520" fill="url(#haze-cyber-center)" />
        <rect x="0" y="0" width="1100" height="560" fill="url(#haze-spk-left)" />
        <rect x="0" y="0" width="1100" height="560" fill="url(#haze-spk-right)" />

        {/* ==================== 2. 2.5D 透视虚拟桌面台面 (Perspective Desk Slab) ==================== */}
        {/* 桌底地面暗影 */}
        <polygon
          points="35,668 1065,668 1100,700 0,700"
          fill="rgba(2, 3, 6, 0.92)"
        />

        {/* 桌沿背部 RGB 氛围灯带与墙根漫射 */}
        <line
          x1="145"
          y1="370"
          x2="955"
          y2="370"
          stroke="url(#desk-back-led)"
          strokeWidth="3.5"
          filter="url(#blur-tight)"
        />
        <line
          x1="155"
          y1="371"
          x2="945"
          y2="371"
          stroke="url(#desk-back-led)"
          strokeWidth="1.2"
        />

        {/* 2.5D 桌面主台面（后窄前宽的一点透视台面） */}
        <polygon
          points="140,372 960,372 1082,646 18,646"
          fill="url(#desk-surface)"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth="1"
        />

        {/* 台面透视暗纹网格线（强化 2.5D 空间纵深感） */}
        <g opacity="0.32" pointerEvents="none">
          {/* 横向透视等分线 */}
          {[0.18, 0.38, 0.62, 0.85].map((t, idx) => {
            const y = 372 + (646 - 372) * t;
            const lx = 140 + (18 - 140) * t;
            const rx = 960 + (1082 - 960) * t;
            return (
              <line
                key={`h-${idx}`}
                x1={lx}
                y1={y}
                x2={rx}
                y2={y}
                stroke="rgba(255, 255, 255, 0.03)"
                strokeWidth="1"
              />
            );
          })}
          {/* 纵向灭点放射线 */}
          {[-3, -2, -1, 0, 1, 2, 3].map((k) => (
            <line
              key={`v-${k}`}
              x1={550 + k * 110}
              y1={372}
              x2={550 + k * 150}
              y2={646}
              stroke="rgba(255, 255, 255, 0.025)"
              strokeWidth="1"
            />
          ))}
        </g>

        {/* 台面上的屏幕挂灯与环境光漫反射池 */}
        <polygon
          points="140,372 960,372 1082,646 18,646"
          fill="url(#screenbar-cone)"
          pointerEvents="none"
        />

        {/* 2.5D 桌面立体前缘倒角面 + 实心桌板厚度面 */}
        <polygon
          points="18,646 1082,646 1076,653 24,653"
          fill="#2b3139"
        />
        <line
          x1="18"
          y1="646.5"
          x2="1082"
          y2="646.5"
          stroke="rgba(255, 255, 255, 0.22)"
          strokeWidth="1"
        />
        <polygon
          points="24,653 1076,653 1068,672 32,672"
          fill="#0a0c13"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth="0.8"
        />
        {/* 桌板底部暗藏流光反射 */}
        <line
          x1="180"
          y1="673"
          x2="920"
          y2="673"
          stroke="rgba(92, 225, 230, 0.28)"
          strokeWidth="2"
          filter="url(#blur-tight)"
        />

        {/* ==================== 3. 2.5D 透视桌垫 (Perspective Desk Mat) ==================== */}
        <g pointerEvents="none">
          {/* 桌垫接触阴影與厚度边 */}
          <path
            d="M 244 456 L 856 456 C 864 456 870 461 872 468 L 912 612 C 915 621 908 627 896 627 L 204 627 C 192 627 185 621 188 612 L 228 468 C 230 461 236 456 244 456 Z"
            fill="#0c0f13"
            transform="translate(0, 4)"
          />
          {/* 桌垫本体表面 */}
          <path
            d="M 244 456 L 856 456 C 864 456 870 461 872 468 L 912 612 C 915 621 908 627 896 627 L 204 627 C 192 627 185 621 188 612 L 228 468 C 230 461 236 456 244 456 Z"
            fill="url(#desk-mat)"
            stroke="rgba(255, 255, 255, 0.09)"
            strokeWidth="1.2"
          />
          {/* 桌垫内圈精密包边缝线 */}
          <path
            d="M 248 461 L 852 461 L 904 619 L 196 619 Z"
            fill="none"
            stroke="rgba(255, 255, 255, 0.03)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        </g>

        {/* ==================== 4. 中央 2.5D 显示器与增高架 (Monitor & Stand Riser) ==================== */}
        <g
          role="button"
          tabIndex={0}
          aria-label="显示器与系统中枢"
          className={`desk25d-node desk25d-node--monitor${hoverTarget === "system" ? " is-hovered" : ""}`}
          onFocus={() => setHoverTarget("system")}
          onBlur={() => setHoverTarget(null)}
          onMouseEnter={() => setHoverTarget("system")}
          onMouseLeave={() => setHoverTarget(null)}
          onClick={() => onSelectDevice("system")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectDevice("system");
            }
          }}
        >
          {/* 增高架底部暖光漫射 */}
          <ellipse
            cx="550"
            cy="416"
            rx="185"
            ry="18"
            fill="rgba(92, 225, 230, 0.14)"
            filter="url(#blur-soft)"
          />

          {/* 2.5D 桌面增高架 (Monitor Riser Shelf) */}
          {/* 左右斜撑金属脚 */}
          <polygon points="362,398 378,398 372,424 354,424" fill="#0d0f16" />
          <polygon points="722,398 738,398 746,424 728,424" fill="#0d0f16" />
          {/* 增高架台面（透视梯形） */}
          <polygon
            points="356,368 744,368 764,398 336,398"
            fill="#181b26"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth="1"
          />
          {/* 增高架前缘立体厚度面 */}
          <polygon
            points="336,398 764,398 761,406 339,406"
            fill="#0c0e15"
            stroke="rgba(255, 255, 255, 0.06)"
            strokeWidth="0.6"
          />
          {/* 增高架下方内藏氛围灯条 */}
          <line
            x1="395"
            y1="406.5"
            x2="705"
            y2="406.5"
            stroke="rgba(246, 200, 122, 0.52)"
            strokeWidth="1.5"
          />

          {/* 显示器 2.5D 金属支架底座与立柱 */}
          <ellipse
            cx="550"
            cy="384"
            rx="64"
            ry="10"
            fill="#12151e"
            stroke="rgba(255, 255, 255, 0.13)"
            strokeWidth="1"
          />
          <path d="M 532 328 L 568 328 L 574 382 L 526 382 Z" fill="#1b1f2c" />
          <line x1="550" y1="330" x2="550" y2="382" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />

          {/* 显示器外壳立体顶部厚度面 (2.5D 顶沿) */}
          <polygon
            points="338,108 762,108 770,115 330,115"
            fill="#2b3040"
            stroke="rgba(255, 255, 255, 0.16)"
            strokeWidth="0.8"
          />

          {/* 显示器主外框 */}
          <rect
            x="330"
            y="114"
            width="440"
            height="230"
            rx="12"
            fill="#141720"
            stroke="rgba(255, 255, 255, 0.15)"
            strokeWidth="1.2"
          />
          {/* 显示器下巴立体斜切面 */}
          <polygon
            points="334,336 766,336 762,344 338,344"
            fill="#0d0f16"
          />

          {/* 显示面板内部：朦胧赛博地平线光影壁纸（无任何文字干扰） */}
          <rect
            x="338"
            y="122"
            width="424"
            height="212"
            rx="7"
            fill="url(#mon-wallpaper)"
          />
          <rect
            x="338"
            y="122"
            width="424"
            height="212"
            rx="7"
            fill="url(#mon-sun)"
          />

          <g aria-hidden="true">
            <ellipse cx="548" cy="238" rx="110" ry="60" fill="#0c11152e" />
            <path d="M 412 266 C 410 164, 570 146, 652 198 C 720 242, 591 309, 488 280 C 414 259, 462 212, 548 212 C 604 212, 636 237, 620 256 C 599 284, 475 280, 460 237 C 446 195, 571 173, 647 214" fill="none" stroke="url(#screen-ribbon)" strokeWidth="20" strokeLinecap="round" />
            <path d="M 413 264 C 410 164, 570 146, 652 198 C 720 242, 591 309, 488 280" fill="none" stroke="#bfd5cd" strokeOpacity=".35" strokeWidth=".8" />
            <circle cx="550" cy="317" r="2" fill="#d9c5a5" fillOpacity=".7" />
          </g>

          {/* 屏幕斜向玻璃光泽 */}
          <polygon
            points="342,124 510,124 430,332 342,332"
            fill="rgba(255, 255, 255, 0.022)"
          />

          {/* 顶部 Screenbar 屏幕挂灯（2.5D 立体灯管与夹具） */}
          <rect
            x="524"
            y="101"
            width="52"
            height="10"
            rx="3"
            fill="#1e222e"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="0.8"
          />
          <rect
            x="430"
            y="103"
            width="240"
            height="5"
            rx="2.5"
            fill="#282c3a"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth="0.7"
          />
          <line
            x1="440"
            y1="108.5"
            x2="660"
            y2="108.5"
            stroke="#fce3b4"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>

        {/* ==================== 5. 左/右 2.5D 内倾监听音箱 (2.5D Toed-In Stereo Speakers) ==================== */}
        {/* --- 左声道音箱 (向中心内倾 22°，展示左侧立体箱壁 + 顶面 + 前障板) --- */}
        <g
          role="button"
          tabIndex={0}
          aria-label="音响设置"
          className={`desk25d-node desk25d-node--speaker${hoverTarget === "speaker" ? " is-hovered" : ""}`}
          onFocus={() => setHoverTarget("speaker")}
          onBlur={() => setHoverTarget(null)}
          onMouseEnter={() => setHoverTarget("speaker")}
          onMouseLeave={() => setHoverTarget(null)}
          onClick={() => onSelectDevice("speaker")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectDevice("speaker");
            }
          }}
        >
          {/* 桌面暖金倒影池与底部接触阴影 */}
          <ellipse
            cx="226"
            cy="426"
            rx="62"
            ry="18"
            fill="rgba(232, 173, 85, 0.16)"
            filter="url(#blur-soft)"
          />
          <ellipse cx="226" cy="420" rx="46" ry="9" fill="rgba(0, 0, 0, 0.75)" />

          {/* 2.5D 倾角金属避震底座 */}
          <polygon
            points="178,408 266,414 274,424 190,418"
            fill="#141720"
            stroke="rgba(232, 173, 85, 0.32)"
            strokeWidth="1"
          />
          {/* 音箱左侧 3D 纵深箱壁 */}
          <polygon
            points="168,262 194,254 194,408 168,400"
            fill="url(#spk-side)"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="0.9"
          />
          {/* 音箱顶部 3D 厚度面 */}
          <polygon
            points="168,262 252,268 278,260 194,254"
            fill="#3b424c"
            stroke="rgba(255, 255, 255, 0.14)"
            strokeWidth="0.8"
          />
          {/* 音箱内倾前障板 (Front Baffle) */}
          <polygon
            points="194,254 278,260 278,414 194,408"
            fill="url(#spk-front)"
            stroke="rgba(255, 255, 255, 0.14)"
            strokeWidth="1"
          />
          {/* 顶部触控金线 */}
          <line
            x1="214"
            y1="256.5"
            x2="258"
            y2="259.5"
            stroke={spkLed ? "rgba(246, 204, 132, 0.72)" : "rgba(255,255,255,0.18)"}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          {/* 2.5D 透视椭圆高音单元 (Tweeter) */}
          <ellipse
            cx="236"
            cy="296"
            rx="17"
            ry="19"
            transform="rotate(4 236 296)"
            fill="#0a0c10"
            stroke="rgba(240, 188, 108, 0.58)"
            strokeWidth="1.4"
          />
          <ellipse cx="236" cy="296" rx="9" ry="10" fill="#2c303c" />
          <circle cx="234" cy="293" r="2.2" fill="rgba(255,255,255,0.3)" />

          {/* 2.5D 透视椭圆中低音单元 (Mid-Woofer) */}
          <ellipse
            cx="236"
            cy="358"
            rx="31"
            ry="35"
            transform="rotate(4 236 358)"
            fill="#090a0e"
            stroke="rgba(240, 188, 108, 0.65)"
            strokeWidth="1.6"
          />
          <ellipse
            cx="236"
            cy="358"
            rx="25"
            ry="28"
            transform="rotate(4 236 358)"
            fill="url(#spk-cone)"
          />
          <ellipse
            cx="236"
            cy="358"
            rx="10"
            ry="11.5"
            fill="#252833"
            stroke="rgba(240, 188, 108, 0.45)"
            strokeWidth="0.9"
          />
          {/* 状态呼吸灯 */}
          {spkLed && (
            <circle
              cx="236"
              cy="401"
              r="3.8"
              fill="#f3bd68"
              filter="url(#blur-tight)"
            />
          )}
          <circle cx="236" cy="401" r="1.8" fill={spkLed ? "#fbe0a8" : "#343744"} />
        </g>

        {/* --- 右声道音箱 (向中心对称内倾 22°，展示右侧立体箱壁 + 顶面 + 前障板) --- */}
        <g
          role="button"
          tabIndex={0}
          aria-label="音响设置 (右声道)"
          className={`desk25d-node desk25d-node--speaker${hoverTarget === "speaker" ? " is-hovered" : ""}`}
          onFocus={() => setHoverTarget("speaker")}
          onBlur={() => setHoverTarget(null)}
          onMouseEnter={() => setHoverTarget("speaker")}
          onMouseLeave={() => setHoverTarget(null)}
          onClick={() => onSelectDevice("speaker")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectDevice("speaker");
            }
          }}
        >
          <ellipse
            cx="874"
            cy="426"
            rx="62"
            ry="18"
            fill="rgba(232, 173, 85, 0.16)"
            filter="url(#blur-soft)"
          />
          <ellipse cx="874" cy="420" rx="46" ry="9" fill="rgba(0, 0, 0, 0.75)" />

          {/* 2.5D 倾角底座 */}
          <polygon
            points="834,414 922,408 910,418 826,424"
            fill="#141720"
            stroke="rgba(232, 173, 85, 0.32)"
            strokeWidth="1"
          />
          {/* 音箱右侧 3D 纵深箱壁 */}
          <polygon
            points="906,254 932,262 932,400 906,408"
            fill="url(#spk-side)"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="0.9"
          />
          {/* 音箱顶部 3D 厚度面 */}
          <polygon
            points="822,260 906,254 932,262 848,268"
            fill="#3b424c"
            stroke="rgba(255, 255, 255, 0.14)"
            strokeWidth="0.8"
          />
          {/* 音箱内倾前障板 */}
          <polygon
            points="822,260 906,254 906,408 822,414"
            fill="url(#spk-front)"
            stroke="rgba(255, 255, 255, 0.14)"
            strokeWidth="1"
          />
          <line
            x1="842"
            y1="259.5"
            x2="886"
            y2="256.5"
            stroke={spkLed ? "rgba(246, 204, 132, 0.72)" : "rgba(255,255,255,0.18)"}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          {/* 高音 */}
          <ellipse
            cx="864"
            cy="296"
            rx="17"
            ry="19"
            transform="rotate(-4 864 296)"
            fill="#0a0c10"
            stroke="rgba(240, 188, 108, 0.58)"
            strokeWidth="1.4"
          />
          <ellipse cx="864" cy="296" rx="9" ry="10" fill="#2c303c" />
          <circle cx="862" cy="293" r="2.2" fill="rgba(255,255,255,0.3)" />

          {/* 中低音 */}
          <ellipse
            cx="864"
            cy="358"
            rx="31"
            ry="35"
            transform="rotate(-4 864 358)"
            fill="#090a0e"
            stroke="rgba(240, 188, 108, 0.65)"
            strokeWidth="1.6"
          />
          <ellipse
            cx="864"
            cy="358"
            rx="25"
            ry="28"
            transform="rotate(-4 864 358)"
            fill="url(#spk-cone)"
          />
          <ellipse
            cx="864"
            cy="358"
            rx="10"
            ry="11.5"
            fill="#252833"
            stroke="rgba(240, 188, 108, 0.45)"
            strokeWidth="0.9"
          />
          {spkLed && (
            <circle
              cx="864"
              cy="401"
              r="3.8"
              fill="#f3bd68"
              filter="url(#blur-tight)"
            />
          )}
          <circle cx="864" cy="401" r="1.8" fill={spkLed ? "#fbe0a8" : "#343744"} />
        </g>

        {/* ==================== 6. 2.5D 透视机械键盘 (Perspective Mechanical Keyboard) ==================== */}
        <g
          role="button"
          tabIndex={0}
          aria-label="键盘设置"
          className={`desk25d-node desk25d-node--keyboard${hoverTarget === "keyboard" ? " is-hovered" : ""}`}
          onFocus={() => setHoverTarget("keyboard")}
          onBlur={() => setHoverTarget(null)}
          onMouseEnter={() => setHoverTarget("keyboard")}
          onMouseLeave={() => setHoverTarget(null)}
          onClick={() => onSelectDevice("keyboard")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectDevice("keyboard");
            }
          }}
        >
          {/* 键盘底盘在桌垫上的朦胧背光漫射 */}
          <ellipse
            cx="476"
            cy="542"
            rx="246"
            ry="74"
            fill="url(#kb-mat-bleed)"
            filter="url(#blur-soft)"
          />

          {/* 键盘桌垫接触实影 */}
          <polygon
            points="266,474 690,474 714,598 242,598"
            fill="rgba(0, 0, 0, 0.8)"
            filter="url(#blur-tight)"
          />

          {/* 键盘铝合金外壳顶面（2.5D 透视梯形） */}
          <polygon
            points="268,468 692,468 712,584 240,584"
            fill="#191c26"
            stroke="rgba(255, 255, 255, 0.16)"
            strokeWidth="1.1"
          />
          {/* 键盘前高立体斜切面 (Front Wrist Bevel Face) */}
          <polygon
            points="240,584 712,584 706,598 246,598"
            fill="#0d0f16"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="0.8"
          />
          {/* 前沿贯穿式氛围底灯条 */}
          <line
            x1="280"
            y1="597.5"
            x2="672"
            y2="597.5"
            stroke={kbColor}
            strokeOpacity={0.45 * effKbRatio}
            strokeWidth="1.8"
          />

          {/* 键盘沉金内胆凹槽 (Switch Plate Well) */}
          <polygon
            points="275,473 685,473 704,578 248,578"
            fill="#080a0f"
            stroke={kbAlpha(0.28 * effKbRatio)}
            strokeWidth="1"
          />

          {/* 轴下导光板光雾 */}
          <polygon
            points="277,475 683,475 701,576 251,576"
            fill={kbColor}
            opacity={0.18 * effKbRatio}
            filter="url(#blur-tight)"
          />

          {/* 6 行 2.5D 透视立体键帽阵列 */}
          {KB_PERSPECTIVE_ROWS.map((row, rIdx) => {
            const totalU = row.reduce((acc, k) => acc + k.w, 0);
            const v0 = (rIdx + 0.08) / 6;
            const v1 = (rIdx + 0.84) / 6;
            let curU = 0;

            return row.map((k, kIdx) => {
              const u0 = (curU + 0.06) / totalU;
              const u1 = (curU + k.w - 0.06) / totalU;
              curU += k.w;

              // 空隙槽位不绘制实体键帽
              if (k.w < 0.45 && !k.kind) return null;

              const pTL = projectKb(u0, v0);
              const pTR = projectKb(u1, v0);
              const pBR = projectKb(u1, v1);
              const pBL = projectKb(u0, v1);

              // 右上角状态灯铭牌
              if (k.kind === "oled") {
                return (
                  <g key={`${rIdx}-${kIdx}`}>
                    <polygon
                      points={`${pTL.x},${pTL.y} ${pTR.x},${pTR.y} ${pBR.x},${pBR.y} ${pBL.x},${pBL.y}`}
                      fill="#07090e"
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="0.8"
                    />
                    <line
                      x1={pTL.x + 8}
                      y1={(pTL.y + pBL.y) / 2}
                      x2={pTR.x - 16}
                      y2={(pTR.y + pBR.y) / 2}
                      stroke={kbColor}
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      opacity={0.65 * effKbRatio}
                    />
                  </g>
                );
              }

              // 3D 键帽顶面相较于底裙向上抬升 3.2px 并微幅内缩
              const lift = 3.2;
              const topPts = `${pTL.x + 1.8},${pTL.y - lift} ${pTR.x - 1.8},${pTR.y - lift} ${pBR.x - 1.5},${pBR.y - lift} ${pBL.x + 1.5},${pBL.y - lift}`;
              const basePts = `${pTL.x},${pTL.y} ${pTR.x},${pTR.y} ${pBR.x},${pBR.y} ${pBL.x},${pBL.y}`;
              const frontSkirtPts = `${pBL.x + 1.5},${pBL.y - lift} ${pBR.x - 1.5},${pBR.y - lift} ${pBR.x},${pBR.y} ${pBL.x},${pBL.y}`;

              const topFill =
                k.kind === "esc"
                  ? "#76644e"
                  : k.kind === "enter"
                    ? "#3d5959"
                    : k.kind === "fn"
                      ? "#29313a"
                      : "url(#key-surface)";

              return (
                <g key={`${rIdx}-${kIdx}`}>
                  {/* 键帽底裙与轴下透光边 */}
                  <polygon
                    points={basePts}
                    fill="#0d1017"
                    stroke={kbAlpha(0.24 * effKbRatio)}
                    strokeWidth="0.75"
                  />
                  {/* 键帽前向 3D 立体裙面 */}
                  <polygon points={frontSkirtPts} fill="#141822" />
                  {/* 键帽 3D 悬浮指腹顶面 */}
                  <polygon
                    points={topPts}
                    fill={topFill}
                    stroke="rgba(255, 255, 255, 0.08)"
                    strokeWidth="0.5"
                  />
                  {rIdx >= 1 && rIdx <= 4 && kIdx > 0 && kIdx < 11 && k.w === 1 && (
                    <text x={(pTL.x + pTR.x + pBL.x + pBR.x) / 4} y={(pTL.y + pBL.y) / 2 - .8} textAnchor="middle" fontSize="5" fill="#c5ced6" fillOpacity=".45" aria-hidden="true">
                      {(["", "1234567890", "QWERTYUIOP", "ASDFGHJKL;", "ZXCVBNM,./"][rIdx])[kIdx - 1]}
                    </text>
                  )}
                  {/* 空格键微光导光条 */}
                  {k.kind === "space" && (
                    <line
                      x1={(pBL.x + pBR.x) / 2 - 22}
                      y1={(pTL.y + pBL.y) / 2 - lift}
                      x2={(pBL.x + pBR.x) / 2 + 22}
                      y2={(pTR.y + pBR.y) / 2 - lift}
                      stroke={kbColor}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      opacity={0.45 * effKbRatio}
                    />
                  )}
                </g>
              );
            });
          })}
        </g>

        {/* ==================== 7. 2.5D 透视无线鼠标 (Perspective Wireless Mouse) ==================== */}
        <g role="button" tabIndex={0} aria-label="鼠标设置"
          className={`desk25d-node desk25d-node--mouse${hoverTarget === "mouse" ? " is-hovered" : ""}`}
          onFocus={() => setHoverTarget("mouse")} onBlur={() => setHoverTarget(null)}
          onMouseEnter={() => setHoverTarget("mouse")} onMouseLeave={() => setHoverTarget(null)}
          onClick={() => onSelectDevice("mouse")}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectDevice("mouse"); } }}>
          {/* 鼠标接触投影与尾部微光 */}
          <ellipse cx="812" cy="548" rx="38" ry="48" fill="rgba(0, 0, 0, 0.72)" filter="url(#blur-tight)" />
          <ellipse
            cx="812"
            cy="562"
            rx="32"
            ry="22"
            fill="rgba(92, 225, 230, 0.12)"
            filter="url(#blur-soft)"
          />

          {/* 2.5D 鼠标流线型三维背壳 */}
          <path
            d="M 784 512 C 785 492, 839 492, 840 512 L 845 558 C 846 582, 778 582, 779 558 Z"
            fill="#141720"
            stroke="rgba(255, 255, 255, 0.13)"
            strokeWidth="1"
          />
          {/* 鼠标拱起掌托高光面 (2.5D Hump) */}
          <path
            d="M 786 510 C 788 494, 836 494, 838 510 L 841 552 C 841 572, 783 572, 783 552 Z"
            fill="#1f2330"
            stroke="rgba(255, 255, 255, 0.06)"
            strokeWidth="0.6"
          />
          {/* 分体式左右按键缝与滚轮 */}
          <line x1="812" y1="496" x2="812" y2="528" stroke="#090b10" strokeWidth="1.6" />
          <path
            d="M 785 528 Q 812 533 839 528"
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="0.9"
          />
          <rect
            x="808.5"
            y="504"
            width="7"
            height="16"
            rx="3.5"
            fill="#0e1017"
            stroke={mouseConnected ? "rgba(170, 189, 219, 0.7)" : "rgba(170, 189, 219, 0.2)"}
            strokeWidth="0.9"
          />
          {/* 尾部流光灯带 */}
          <path
            d="M 792 568 Q 812 576 832 568"
            fill="none"
            stroke={mouseConnected ? "rgba(170, 189, 219, 0.65)" : "rgba(170, 189, 219, 0.15)"}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </g>
      </svg>
      <div className={`desk-caption${hoverTarget ? " is-active" : ""}`} aria-hidden="true">
        {hoverTarget ? <><span>{hoverTarget === "speaker" ? "N300" : hoverTarget === "keyboard" ? "OG98" : hoverTarget === "mouse" ? mouseName : "DeskHub"}</span><span className="desk-caption__detail">{hoverTarget === "speaker" ? "音响控制" : hoverTarget === "keyboard" ? "键盘灯光" : hoverTarget === "mouse" ? "鼠标控制" : "设备与应用"}</span><span className="desk-caption__key">↵</span></> : "选择桌面上的设备"}
      </div>
    </div>
  );
}
