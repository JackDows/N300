// Device view models for N300 Speaker & FL-ESPORTS OG98 Keyboard.

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

export interface KeyboardLightingState {
  brightness: number;
  mode: number;
  optionRaw: number;
  rgbRaw: [number, number, number];
  speedRaw: number;
  userPictureSlot?: number;
}

export interface KeyboardSleepValue {
  bluetoothDeepSeconds: number;
  bluetoothSeconds: number;
  wirelessDeepSeconds: number;
  wirelessSeconds: number;
}

export interface KeyboardOptionsValue {
  keyboardLocked: boolean;
  ledOff: boolean;
  powerSave: boolean;
  raw: number[];
  wasdSwapped: boolean;
  winLocked: boolean;
}

export interface KeyboardView {
  id: string;
  label: string;
  phase: "stopped" | "starting" | "connecting" | "waiting" | "connected" | "disconnected" | "faulted";
  offline: boolean;
  connected: boolean;
  moduleVersion: string | null;
  valueState: "unknown" | "confirmed" | "stale";
  error: DeviceErrorInfo | null;
  brightness: VolumeValue | null;
  lighting: KeyboardLightingState | null;
  reportRateHz: number | null;
  profile: number | null;
  debounce: number | null;
  autoOS: boolean | null;
  sleep: KeyboardSleepValue | null;
  options: KeyboardOptionsValue | null;
  firmwareText: string | null;
  path: string | null;
}
