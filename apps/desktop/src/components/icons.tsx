import type { ReactNode, SVGProps } from "react";

// 统一 24 栅格、1.6 线宽的线性图标；尺寸由 size 控制，颜色继承 currentColor。

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function make(paths: ReactNode) {
  return function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconDial = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 12l3.5-3.5" />
    <path d="M12 3.5v1.5M20.5 12H19M5 12H3.5" />
  </>,
);
export const IconWave = make(<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />);
export const IconSliders = make(
  <>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </>,
);

export const IconBluetooth = make(<path d="M7 7.5l10 9-5 4.5V3l5 4.5-10 9" />);
export const IconAux = make(
  <>
    <path d="M12 21v-4" />
    <rect x="9" y="10" width="6" height="7" rx="1.5" />
    <path d="M12 10V3" />
    <path d="M10.5 6.5h3" />
  </>,
);
export const IconUsb = make(
  <>
    <path d="M12 3v14" />
    <path d="M9 6l3-3 3 3" />
    <path d="M12 13l-4-2.5V8M12 15l4-2.5V10" />
    <circle cx="12" cy="19" r="2" />
  </>,
);
export const IconInput = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </>,
);

export const IconMusic = make(
  <>
    <path d="M9 18V6l11-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </>,
);
export const IconMonitor = make(
  <>
    <path d="M4 15v-3a8 8 0 0116 0v3" />
    <rect x="3" y="14" width="4.5" height="6.5" rx="1.8" />
    <rect x="16.5" y="14" width="4.5" height="6.5" rx="1.8" />
  </>,
);
export const IconGame = make(
  <>
    <path d="M7 8h10a5 5 0 014.8 6.4l-.6 2a2.5 2.5 0 01-4.3.9L15 15H9l-1.9 2.3a2.5 2.5 0 01-4.3-.9l-.6-2A5 5 0 017 8z" />
    <path d="M8 10.5v3M6.5 12h3" />
    <path d="M16 11h.01M18 13h.01" />
  </>,
);
export const IconMovie = make(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M10 9.5v5l4.5-2.5z" />
  </>,
);
export const IconCustom = make(
  <>
    <path d="M6 4v6M6 14v6M12 4v2M12 10v10M18 4v10M18 18v2" />
    <path d="M4 12h4M10 8h4M16 16h4" />
  </>,
);

export const IconLight = make(
  <>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1" />
  </>,
);
export const IconMoon = make(<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />);
export const IconTimer = make(
  <>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9.5V13l2.5 1.5M10 2.5h4" />
  </>,
);
export const IconLink = make(
  <>
    <path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1" />
  </>,
);
export const IconPower = make(
  <>
    <path d="M12 3v8" />
    <path d="M6.3 6.8a8 8 0 1011.4 0" />
  </>,
);
export const IconPencil = make(<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z" />);
export const IconChevron = make(<path d="M9 6l6 6-6 6" />);
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconAlert = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </>,
);
export const IconMinimize = make(<path d="M6 12h12" />);
export const IconClose = make(<path d="M7 7l10 10M17 7L7 17" />);

const INPUT_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  bluetooth: IconBluetooth,
  aux: IconAux,
  usb: IconUsb,
  usb_audio: IconUsb,
};

const PRESET_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  music: IconMusic,
  monitor: IconMonitor,
  game: IconGame,
  movie: IconMovie,
  customized: IconCustom,
};

export const inputIcon = (value: string, size?: number) => (INPUT_ICONS[value] ?? IconInput)({ size });
export const presetIcon = (value: string, size?: number) => (PRESET_ICONS[value] ?? IconWave)({ size });
