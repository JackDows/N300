import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Transport } from "./transport";
import { DeviceRequestError, type DeviceEvent } from "./types";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

/** Rust 侧启动 `n300.exe serve`，逐行转发 stdout；这里负责 JSON-RPC 的 id 匹配。 */
export function createTauriTransport(): Transport {
  const listeners = new Set<(event: DeviceEvent) => void>();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let started: Promise<void> | null = null;

  const emit = (event: DeviceEvent) => listeners.forEach((l) => l(event));

  function onLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method === "event" && msg.params) {
      emit(msg.params as DeviceEvent);
      return;
    }
    if (typeof msg.id !== "number") return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new DeviceRequestError(msg.error.data ?? { code: "rpc_error", message: msg.error.message }));
    } else {
      p.resolve(msg.result);
    }
  }

  function start() {
    started ??= (async () => {
      await listen<string>("n300://line", (e) => onLine(e.payload));
      await listen("n300://exit", () => {
        pending.forEach((p) => {
          clearTimeout(p.timer);
          p.reject(new DeviceRequestError({ code: "core_exit", message: "控制核心已退出" }));
        });
        pending.clear();
        emit({ type: "core_exit" });
      });
      await invoke("core_start");
    })();
    return started;
  }

  async function request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await start();
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new DeviceRequestError({ code: "timeout", message: "请求超时", retryable: true }));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      invoke("core_send", { line: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }).catch((err) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(new DeviceRequestError({ code: "core_unavailable", message: String(err) }));
      });
    });
  }

  return {
    kind: "tauri",
    start,
    request,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
