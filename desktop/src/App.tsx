import { useState, type CSSProperties } from "react";
import { Nav, ToastPill, type NavItem } from "./components/Nav";
import { TitleBar } from "./components/TitleBar";
import { IconDial, IconSliders, IconWave } from "./components/icons";
import { errorText, useDevice } from "./device/DeviceContext";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SoundPage } from "./pages/SoundPage";
import "./pages/pages.css";

type Tab = "home" | "sound" | "settings";

const TABS: NavItem<Tab>[] = [
  { id: "home", label: "音量", icon: <IconDial size={19} /> },
  { id: "sound", label: "音效", icon: <IconWave size={19} /> },
  { id: "settings", label: "设置", icon: <IconSliders size={19} /> },
];

const order = (t: Tab) => TABS.findIndex((x) => x.id === t);

// 预览时可用 ?tab=sound / ?tab=settings 直接打开指定页面。
const initialTab = (): Tab => {
  const t = new URLSearchParams(location.search).get("tab");
  return TABS.some((x) => x.id === t) ? (t as Tab) : "home";
};

export default function App() {
  const { phase, state, error, toast } = useDevice();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dir, setDir] = useState(1);

  const go = (next: Tab) => {
    if (next === tab) return;
    setDir(order(next) > order(tab) ? 1 : -1);
    setTab(next);
  };

  const status =
    phase === "connected"
      ? ({ tone: "ok", text: state?.offline ? "离线演示" : "已连接" } as const)
      : phase === "disconnected"
        ? ({ tone: "off", text: error ? errorText(error) : "未连接" } as const)
        : ({ tone: "busy", text: error ? `${errorText(error)}，重试中` : "连接中" } as const);

  return (
    <div className="app">
      <TitleBar status={status} />
      <main className="stage">
        <div key={tab} className="page-anim" style={{ "--dir": dir } as CSSProperties}>
          {tab === "home" && <HomePage />}
          {tab === "sound" && <SoundPage />}
          {tab === "settings" && <SettingsPage />}
        </div>
      </main>
      <ToastPill toast={toast} />
      <Nav items={TABS} active={tab} onChange={go} />
    </div>
  );
}
