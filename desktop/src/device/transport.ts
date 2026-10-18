import type { DeviceEvent } from "./types";

/** 前端与设备核心之间的通道：桌面版走 Tauri → n300.exe serve，浏览器预览走内存模拟。 */
export interface Transport {
  readonly kind: "tauri" | "mock";
  start(): Promise<void>;
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  subscribe(listener: (event: DeviceEvent) => void): () => void;
  dispose?(): void;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let instance: Promise<Transport> | null = null;

export function getTransport(): Promise<Transport> {
  instance ??= isTauri
    ? import("./tauriTransport").then((m) => m.createTauriTransport())
    : import("./mockTransport").then((m) => m.createMockTransport());
  return instance;
}

if (import.meta.hot) import.meta.hot.dispose(() => { void instance?.then((transport) => transport.dispose?.()); });
