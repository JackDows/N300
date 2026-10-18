import type { Transport } from "./transport";
import { DeviceRequestError, type DeviceEvent } from "./types";

export interface CoreLine { generation: number; line: string }
export interface CoreBridge {
  start(): Promise<number>;
  send(line: string): Promise<void>;
  listenLine(callback: (value: CoreLine) => void): Promise<() => void>;
  listenExit(callback: (generation: number) => void): Promise<() => void>;
}
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Match replies by ID and process generation; restarting never replays a write. */
export function createRpcTransport(bridge: CoreBridge, timeoutMs = 30_000): Transport {
  const listeners = new Set<(event: DeviceEvent) => void>();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let started: Promise<void> | null = null;
  let subscriptions: Promise<void> | null = null;
  let generation: number | null = null;
  const unlisten: (() => void)[] = [];
  let buffered: ({ kind: "line"; value: CoreLine } | { kind: "exit"; value: number })[] = [];
  let disposed = false;
  const emit = (event: DeviceEvent) => listeners.forEach((listener) => listener(event));
  const failed = (code: string, message: string) => new DeviceRequestError({ code, message });

  function rejectPending(error: DeviceRequestError) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  }
  function onLine(value: CoreLine) {
    if (generation === null) {
      if (started && buffered.length < 1024) buffered.push({ kind: "line", value });
      return;
    }
    if (value.generation !== generation) return;
    let msg;
    try { msg = JSON.parse(value.line); } catch { return; }
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return;
    if (msg.method === "event" && msg.params && typeof msg.params.type === "string") { emit(msg.params as DeviceEvent); return; }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) {
      const info = msg.error.data;
      entry.reject(new DeviceRequestError(info && typeof info.code === "string" && typeof info.message === "string"
        ? info : { code: "rpc_error", message: String(msg.error.message ?? "无效响应") }));
    } else { entry.resolve(msg.result); }
  }
  function onExit(value: number) {
    if (generation === null) { if (started) buffered.push({ kind: "exit", value }); return; }
    if (value !== generation) return;
    generation = null;
    started = null;
    rejectPending(failed("core_exit", "控制核心已退出"));
    emit({ type: "core_exit" });
  }
  function subscribeBridge() {
    subscriptions ??= (async () => {
      try {
        unlisten.push(await bridge.listenLine(onLine));
        unlisten.push(await bridge.listenExit(onExit));
      } catch (error) {
        for (const off of unlisten.splice(0)) off();
        subscriptions = null;
        throw error;
      }
    })();
    return subscriptions;
  }
  function start() {
    if (disposed) return Promise.reject(failed("core_unavailable", "通道已关闭"));
    started ??= (async () => {
      await subscribeBridge();
      const current = await bridge.start();
      if (disposed) throw failed("core_unavailable", "通道已关闭");
      generation = current;
      const messages = buffered;
      buffered = [];
      for (const event of messages) {
        if (event.kind === "line") onLine(event.value);
        else onExit(event.value);
      }
      if (generation !== current) throw failed("core_exit", "控制核心在启动时退出");
    })().catch((error) => { started = null; generation = null; buffered = []; throw error; });
    return started;
  }
  async function request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await start();
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(failed("timeout", "请求超时")); }, timeoutMs);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      bridge.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })).catch((error) => {
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.reject(failed("core_unavailable", String(error)));
      });
    });
  }
  return {
    kind: "tauri", start, request,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      disposed = true;
      for (const off of unlisten.splice(0)) off();
      listeners.clear();
      buffered = [];
      rejectPending(failed("core_unavailable", "通道已关闭"));
    },
  };
}
