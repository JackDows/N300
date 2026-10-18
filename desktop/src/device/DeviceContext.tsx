import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getTransport, type Transport } from "./transport";
import { DeviceRequestError, type DeviceErrorInfo, type DeviceState, type Values, type WritableProperty } from "./types";

export type Phase = "starting" | "connecting" | "connected" | "disconnected";

export interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

interface DeviceContextValue {
  phase: Phase;
  state: DeviceState | null;
  values: Values;
  error: DeviceErrorInfo | null;
  toast: Toast | null;
  set(property: WritableProperty, value: unknown, label: string): Promise<void>;
  setEqBand(band: number, gain: number): Promise<void>;
  resetEq(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  powerOff(): Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

const ERROR_TEXT: Record<string, string> = {
  timeout: "设备响应超时",
  disconnected: "连接已断开",
  verification_failed: "回读校验未通过",
  busy: "设备忙，请稍后",
  unsupported: "设备不支持该功能",
  not_found: "没有找到音箱",
  ambiguous_device: "附近有多台音箱，请指定设备",
  bluetooth_unavailable: "蓝牙不可用",
  connection_failed: "连接失败",
  core_exit: "控制核心已退出",
  core_unavailable: "控制核心未启动",
};

export function errorInfo(e: unknown): DeviceErrorInfo {
  if (e instanceof DeviceRequestError) return e.info;
  if (e && typeof e === "object" && "code" in e && "message" in e) return e as DeviceErrorInfo;
  return { code: "internal_error", message: String(e) };
}

export function errorText(e: unknown) {
  const info = errorInfo(e);
  return ERROR_TEXT[info.code] ?? info.message;
}

export const formatHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function patchValue(s: DeviceState, property: WritableProperty, value: unknown): DeviceState {
  const values: Values = { ...s.values };
  switch (property) {
    case "volume":
      if (values.volume) values.volume = { ...values.volume, value: value as number };
      break;
    case "input":
    case "preset": {
      const sel = values[property];
      const c = sel?.choices.find((x) => x.value === value);
      if (sel) values[property] = { ...sel, value: value as string, raw: c?.raw ?? sel.raw };
      break;
    }
    case "timer":
      values.timer = { ...values.timer, value: value as number };
      break;
    case "led":
    case "idle_shutdown":
      values[property] = { value: value as boolean };
      break;
    case "name":
      values.name = { value: value as string };
      break;
  }
  return { ...s, values };
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DeviceState | null>(null);
  const [error, setError] = useState<DeviceErrorInfo | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const sequenceRef = useRef(0);
  const loadedRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastId = useRef(0);
  const stateRef = useRef(state);
  const revisions = useRef<Record<string, number>>({});
  const epoch = useRef(0);
  stateRef.current = state;

  const showToast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ id: ++toastId.current, text, kind });
    toastTimer.current = setTimeout(() => setToast(null), kind === "error" ? 2800 : 1600);
  }, []);

  // 订阅设备事件；StrictMode 下重复挂载由 disposed 标记和通道单例保证只启动一次。
  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    getTransport().then((t) => {
      if (disposed) return;
      transportRef.current = t;
      unsubscribe = t.subscribe((event) => {
        switch (event.type) {
          case "ready":
            sequenceRef.current = 0;
            loadedRef.current = false;
            break;
          case "state":
            if (event.sequence <= sequenceRef.current) return;
            sequenceRef.current = event.sequence;
            setState(event.state);
            if (!event.state.connected) epoch.current++;
            if (event.state.connected) setError(null);
            break;
          case "connection_error":
            setError(event.error);
            break;
          case "core_exit":
            epoch.current++;
            sequenceRef.current = 0;
            setState(null);
            setError({ code: "core_exit", message: "控制核心已退出" });
            break;
        }
      });
      // A renderer reload can attach to a core that has already emitted its state.
      const before = sequenceRef.current;
      t.start().then(() => t.request<DeviceState>("tick")).then((snapshot) => {
        if (!disposed && sequenceRef.current === before) setState(snapshot);
      }).catch((e) => { if (!disposed) setError(errorInfo(e)); });
    }).catch((e) => { if (!disposed) setError(errorInfo(e)); });
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(toastTimer.current);
    };
  }, []);

  // 每次连上后批量读取一次全部设置。
  const connected = !!state?.connected;
  useEffect(() => {
    if (!connected) {
      loadedRef.current = false;
      return;
    }
    if (loadedRef.current) return;
    loadedRef.current = true;
    let disposed = false;
    transportRef.current?.request<DeviceState>("status", { full: true }).then((snapshot) => {
      if (!disposed) setState(snapshot);
    }).catch((e) => { if (!disposed) showToast(errorText(e), "error"); });
    return () => { disposed = true; };
  }, [connected, showToast]);

  const updateValue = useCallback((property: keyof Values, value: unknown) => {
    setState((s) => {
      if (!s?.connected) return s;
      const values = { ...s.values };
      if (value === undefined) delete values[property];
      else (values as Record<string, unknown>)[property] = value;
      return { ...s, values };
    });
  }, []);

  const recoverValue = useCallback(async (t: Transport, property: keyof Values, revision: number, connection: number) => {
    if (epoch.current !== connection || !stateRef.current?.connected) return;
    let confirmed: unknown;
    try { confirmed = await t.request("get", { property }); } catch { confirmed = undefined; }
    if (epoch.current === connection && revisions.current[property] === revision) updateValue(property, confirmed);
  }, [updateValue]);

  const set = useCallback(
    async (property: WritableProperty, value: unknown, label: string) => {
      const t = transportRef.current;
      if (!t || !stateRef.current?.connected) return;
      const revision = revisions.current[property] = (revisions.current[property] ?? 0) + 1;
      const connection = epoch.current;
      setState((s) => (s ? patchValue(s, property, value) : s));
      try {
        const confirmed = await t.request("set", { property, value });
        if (revisions.current[property] === revision && epoch.current === connection) {
          updateValue(property, confirmed);
          showToast(label);
        }
      } catch (e) {
        showToast(errorText(e), "error");
        await recoverValue(t, property, revision, connection);
      }
    },
    [showToast, updateValue, recoverValue],
  );

  const setEqBand = useCallback(
    async (band: number, gain: number) => {
      const t = transportRef.current;
      if (!t || !stateRef.current?.connected) return;
      const revision = revisions.current.eq = (revisions.current.eq ?? 0) + 1;
      const connection = epoch.current;
      const hz = stateRef.current?.values.eq?.value.find((b) => b.index === band)?.frequency_hz ?? 0;
      setState((s) => {
        const eq = s?.values.eq;
        if (!s || !eq) return s;
        return {
          ...s,
          values: { ...s.values, eq: { ...eq, value: eq.value.map((b) => (b.index === band ? { ...b, gain_db: gain } : b)) } },
        };
      });
      try {
        const confirmed = await t.request("eq.set", { band, gain });
        if (revisions.current.eq === revision && epoch.current === connection) {
          updateValue("eq", confirmed);
          showToast(`${formatHz(hz)}Hz  ${signed(gain)} dB`);
        }
      } catch (e) {
        showToast(errorText(e), "error");
        await recoverValue(t, "eq", revision, connection);
      }
    },
    [showToast, updateValue, recoverValue],
  );

  const resetEq = useCallback(async () => {
    const t = transportRef.current;
    const bands = stateRef.current?.values.eq?.value.filter((b) => b.gain_db !== 0) ?? [];
    if (!t || !bands.length) return;
    const revision = revisions.current.eq = (revisions.current.eq ?? 0) + 1;
    const connection = epoch.current;
    try {
      for (const b of bands) await t.request("eq.set", { band: b.index, gain: 0 });
      showToast("均衡器已复位");
    } catch (e) {
      showToast(errorText(e), "error");
      await recoverValue(t, "eq", revision, connection);
    }
  }, [showToast, recoverValue]);

  const call = useCallback(
    async (method: string, okText?: string) => {
      const t = transportRef.current;
      if (!t) return;
      try {
        await t.request(method);
        if (okText) showToast(okText);
      } catch (e) {
        showToast(errorText(e), "error");
      }
    },
    [showToast],
  );

  const phase: Phase = !state
    ? error
      ? "disconnected"
      : "starting"
    : state.connected
      ? "connected"
      : state.auto_reconnect
        ? "connecting"
        : "disconnected";

  const value = useMemo<DeviceContextValue>(
    () => ({
      phase,
      state,
      values: state?.connected ? state.values : {},
      error,
      toast,
      set,
      setEqBand,
      resetEq,
      connect: () => call("start"),
      disconnect: () => call("stop"),
      powerOff: () => call("power.off", "关机指令已发送"),
    }),
    [phase, state, error, toast, set, setEqBand, resetEq, call],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDevice 必须在 DeviceProvider 内使用");
  return ctx;
}
