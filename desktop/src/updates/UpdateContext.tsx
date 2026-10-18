import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isTauri } from "../device/transport";

type Stage = "idle" | "checking" | "current" | "available" | "downloading" | "installing" | "error";
interface Release { version: string; notes: string }
interface Progress { stage: "downloading" | "installing"; downloaded: number; total?: number }
interface UpdateState {
  version: string; stage: Stage; release: Release | null; message: string;
  downloaded: number; total?: number; dismissed: boolean;
}
interface UpdateActions { check(): Promise<void>; install(): Promise<void>; dismiss(): void }
const Context = createContext<(UpdateState & UpdateActions) | null>(null);
const initial: UpdateState = { version: "", stage: "idle", release: null, message: "", downloaded: 0, dismissed: false };
const readableError = (error: unknown) => String(error).split("（")[0];

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initial);
  const busy = useRef(false);
  const alive = useRef(true);
  const check = useCallback(async () => {
    if (busy.current || !isTauri) return;
    busy.current = true;
    setState((s) => ({ ...s, stage: "checking", message: "" }));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const release = await invoke<Release | null>("update_check");
      if (alive.current) setState((s) => ({ ...s, release, stage: release ? "available" : "current", dismissed: release?.version === s.release?.version && s.dismissed }));
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, stage: "error", message: readableError(error) }));
    } finally { busy.current = false; }
  }, []);

  const install = useCallback(async () => {
    if (busy.current || !isTauri) return;
    busy.current = true;
    setState((s) => ({ ...s, stage: "downloading", downloaded: 0, total: undefined, message: "" }));
    try {
      const { invoke, Channel } = await import("@tauri-apps/api/core");
      const onProgress = new Channel<Progress>((progress) => {
        if (alive.current) setState((s) => ({ ...s, ...progress }));
      });
      await invoke("update_install", { onProgress });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, stage: "error", message: readableError(error) }));
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    if (isTauri) import("@tauri-apps/api/core").then(({ invoke }) => invoke<{ version: string; lastResult?: string }>("update_info"))
      .then((info) => {
        if (disposed) return;
        setState((s) => ({ ...s, version: info.version, message: info.lastResult ?? "" }));
        timer = setTimeout(check, 8000);
      }).catch((error) => { if (!disposed) setState((s) => ({ ...s, stage: "error", message: readableError(error) })); });
    return () => { disposed = true; alive.current = false; clearTimeout(timer); };
  }, [check]);
  return <Context.Provider value={{ ...state, check, install, dismiss: () => setState((s) => ({ ...s, dismissed: true })) }}>{children}</Context.Provider>;
}
export function useUpdate() { const value = useContext(Context); if (!value) throw new Error("UpdateProvider missing"); return value; }
