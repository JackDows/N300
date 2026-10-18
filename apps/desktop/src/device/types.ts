// 与 n300.exe serve / n300.dll 返回结构一致的类型（见 edifier-n300/docs/api.md）。

export interface Choice {
  label: string;
  raw: number;
  value: string;
}

export interface VolumeValue {
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface SelectValue {
  value: string | number;
  raw?: number;
  group?: number;
  choices: Choice[];
}

export interface EqBand {
  index: number;
  frequency_hz: number;
  gain_db: number;
  q: number;
}

export interface EqValue {
  gain_min: number;
  gain_max: number;
  gain_step: number;
  value: EqBand[];
}

export interface Values {
  volume?: VolumeValue;
  input?: SelectValue;
  preset?: SelectValue;
  eq?: EqValue;
  led?: { value: boolean };
  idle_shutdown?: { value: boolean };
  timer?: { value: number; unit?: string };
  name?: { value: string };
  firmware?: { value: string };
}

export type WritableProperty = "volume" | "input" | "preset" | "led" | "idle_shutdown" | "timer" | "name";

export interface Target {
  address: string;
  name?: string;
  rssi?: number;
  service?: string;
  protocol?: number;
  encryption?: number;
}

export interface Capabilities {
  rename_bytes?: number;
  [key: string]: unknown;
}

export interface DeviceState {
  api_version: number;
  offline: boolean;
  connected: boolean;
  auto_reconnect: boolean;
  target: Target | null;
  capabilities: Capabilities;
  values: Values;
  unavailable?: Record<string, unknown>;
}

export interface DeviceErrorInfo {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export type DeviceEvent =
  | { type: "ready"; offline: boolean }
  | { type: "state"; sequence: number; state: DeviceState }
  | { type: "connection_error"; sequence: number; error: DeviceErrorInfo; retry_in_ms?: number }
  | { type: "core_exit" };

export class DeviceRequestError extends Error {
  readonly info: DeviceErrorInfo;
  constructor(info: DeviceErrorInfo) {
    super(info.message);
    this.info = info;
  }
}
