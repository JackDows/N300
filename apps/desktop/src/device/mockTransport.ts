import type { Transport } from "./transport";
import { DeviceRequestError, type DeviceEvent, type DeviceState, type Values } from "./types";

// 浏览器预览的示例状态；桌面离线测试使用真正的 n300.exe --offline。

const TARGET = {
  address: "00:11:22:33:44:55",
  name: "N300",
  rssi: -48,
  protocol: 1,
  encryption: 0,
  service: "48097e01-1a48-11e9-ab14-d663bd873d93",
};

const CAPABILITIES = {
  ambient_light: false,
  firmware: true,
  idle_shutdown: true,
  input: true,
  name: true,
  power_off: true,
  rename_bytes: 24,
  timer: true,
  volume: true,
};

function initialDevice(): Required<Values> {
  return {
    volume: { value: 8, min: 0, max: 16, step: 1 },
    input: {
      value: "aux",
      raw: 2,
      group: 5,
      choices: [
        { label: "蓝牙", raw: 1, value: "bluetooth" },
        { label: "AUX", raw: 2, value: "aux" },
        { label: "USB", raw: 3, value: "usb" },
      ],
    },
    preset: {
      value: "music",
      raw: 0,
      choices: [
        { label: "音乐", raw: 0, value: "music" },
        { label: "监听", raw: 1, value: "monitor" },
        { label: "游戏", raw: 2, value: "game" },
        { label: "电影", raw: 3, value: "movie" },
        { label: "自定义", raw: 4, value: "customized" },
      ],
    },
    eq: {
      gain_min: -6,
      gain_max: 6,
      gain_step: 1,
      value: [100, 500, 2000, 8000].map((f, i) => ({ index: i, frequency_hz: f, gain_db: [2, -1, 1, 3][i], q: 7 })),
    },
    led: { value: true },
    idle_shutdown: { value: false },
    timer: { value: 0, unit: "minutes" },
    name: { value: "N300" },
    firmware: { value: "1.5.1" },
  };
}

const clone = <T>(v: T): T => structuredClone(v);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockTransport(): Transport {
  const listeners = new Set<(event: DeviceEvent) => void>();
  const device = initialDevice();
  // 预览用：?preset=customized 可直接查看可编辑的均衡器。
  const presetParam = new URLSearchParams(location.search).get("preset");
  const initialPreset = device.preset.choices.find((c) => c.value === presetParam);
  if (initialPreset) {
    device.preset.value = initialPreset.value;
    device.preset.raw = initialPreset.raw;
  }
  const state: DeviceState = {
    api_version: 1,
    offline: true,
    connected: false,
    auto_reconnect: false,
    target: null,
    capabilities: {},
    values: {},
  };
  let sequence = 0;
  let started = false;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (event: DeviceEvent) => listeners.forEach((l) => l(event));
  const emitState = () => emit({ type: "state", sequence: ++sequence, state: clone(state) });

  function beginConnect() {
    state.auto_reconnect = true;
    emitState();
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      state.connected = true;
      state.target = { ...TARGET, name: device.name.value };
      state.capabilities = { ...CAPABILITIES };
      state.values = { volume: clone(device.volume) };
      emitState();
    }, 1600);
  }

  function dropConnection() {
    clearTimeout(connectTimer);
    state.connected = false;
    state.auto_reconnect = false;
    state.capabilities = {};
    state.values = {};
    emitState();
  }

  function requireConnected() {
    if (!state.connected) throw new DeviceRequestError({ code: "disconnected", message: "音箱未连接", retryable: true });
  }

  function publish<K extends keyof Values>(key: K) {
    (state.values as Values)[key] = clone(device[key]) as Values[K];
    emitState();
    return clone(device[key]);
  }

  function setProperty(property: string, value: unknown) {
    const bad = () => {
      throw new DeviceRequestError({ code: "invalid_argument", message: `无效的 ${property}` });
    };
    switch (property) {
      case "volume": {
        const v = device.volume;
        if (typeof value !== "number") bad();
        v.value = Math.max(v.min, Math.min(v.max, Math.round(value as number)));
        return publish("volume");
      }
      case "input":
      case "preset": {
        const sel = device[property];
        const choice = sel.choices.find((c) => c.value === value || c.raw === value);
        if (!choice) bad();
        sel.value = choice!.value;
        sel.raw = choice!.raw;
        return publish(property);
      }
      case "led":
      case "idle_shutdown":
        if (typeof value !== "boolean") bad();
        device[property].value = value as boolean;
        return publish(property);
      case "timer":
        if (typeof value !== "number" || value < 0 || value > 240) bad();
        device.timer.value = value as number;
        return publish("timer");
      case "name":
        if (typeof value !== "string" || !value || new TextEncoder().encode(value).length > 24) bad();
        device.name.value = value as string;
        return publish("name");
      default:
        throw new DeviceRequestError({ code: "unsupported", message: `不支持写入 ${property}` });
    }
  }

  async function request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await delay(40 + Math.random() * 90);
    switch (method) {
      case "start":
        if (!state.connected) beginConnect();
        return clone(state) as T;
      case "stop":
      case "disconnect":
        dropConnection();
        return clone(state) as T;
      case "status": {
        requireConnected();
        const keys: (keyof Values)[] = ["name", "firmware", "volume", "input", "preset"];
        if (params.full) keys.push("eq", "led", "idle_shutdown", "timer");
        for (const k of keys) (state.values as Record<string, unknown>)[k] = clone(device[k]);
        emitState();
        return clone(state) as T;
      }
      case "tick":
        return clone(state) as T;
      case "get":
        requireConnected();
        return publish(params.property as keyof Values) as T;
      case "set":
        requireConnected();
        return setProperty(String(params.property), params.value) as T;
      case "eq.set": {
        requireConnected();
        if (device.preset.value !== "customized" && device.preset.value !== "audiophile") {
          throw new DeviceRequestError({ code: "invalid_argument", message: "请先选择自定义音效" });
        }
        const band = device.eq.value[Number(params.band)];
        const gain = Number(params.gain);
        if (!band || !Number.isInteger(params.band) || !Number.isFinite(gain) || gain < device.eq.gain_min || gain > device.eq.gain_max || gain % device.eq.gain_step !== 0) throw new DeviceRequestError({ code: "invalid_argument", message: "无效的 EQ 参数" });
        band.gain_db = gain;
        (state.values as Values).preset = clone(device.preset);
        return publish("eq") as T;
      }
      case "power.off":
        requireConnected();
        dropConnection();
        return { command_sent: true, power_state: "unverified" } as T;
      default:
        throw new DeviceRequestError({ code: "method_not_found", message: method });
    }
  }

  return {
    kind: "mock",
    async start() {
      if (started) return;
      started = true;
      setTimeout(() => {
        emit({ type: "ready", offline: true });
        beginConnect();
      }, 0);
    },
    request,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { clearTimeout(connectTimer); listeners.clear(); },
  };
}
