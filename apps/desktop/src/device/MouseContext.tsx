import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Candidate, DeskHubClient, DeviceSnapshot, Reading } from "../../../../contracts/client.mjs";
import { getTransport } from "./transport";
import { recordUiError } from "../diagnostics";

export interface MouseChoice { value: string | number; label: string; dpiX?: number; dpiY?: number }
export interface MouseReading<T> extends Reading<T> { choices?: MouseChoice[]; writable?: boolean; label?: string }
interface MouseInfo { name: string; model: string; connection: string; firmware: string; backend: string }
interface MouseState {
  snapshot: DeviceSnapshot | null;
  info: MouseInfo | null;
  candidates: Candidate[];
  busy: boolean;
  message: string;
  connected: boolean;
  status: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  scan(): Promise<void>;
  select(candidate: Candidate): Promise<void>;
  write(capability: string, value: unknown): Promise<void>;
}
const Context = createContext<MouseState | null>(null);
const userMessage = (error: unknown) => error instanceof Error ? error.message : "操作未完成，请重试。";

export function MouseProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const client = useRef<DeskHubClient | null>(null);
  const current = useRef(snapshot), active = useRef(false), alive = useRef(true);
  current.current = snapshot;
  const accept = useCallback((device: DeviceSnapshot) => {
    if (!alive.current) return;
    setSnapshot(previous => previous && (previous.generation > device.generation || (previous.generation === device.generation && previous.revision > device.revision)) ? previous : device);
  }, []);
  const run = useCallback(async (name: string, action: (c: DeskHubClient) => Promise<void>) => {
    if (!client.current || active.current) return;
    active.current = true; setBusy(true); setMessage("");
    try { await action(client.current); }
    catch (error) { recordUiError(error, `mouse.${name}`); if (alive.current) setMessage(userMessage(error)); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  }, []);
  const connect = useCallback(() => run("connect", async c => {
    let device = current.current;
    if (!device) {
      const hub = await c.request("hub.describe");
      device = await c.request("devices.add", { id: "mouse", label: "罗技鼠标", moduleId: "logitech-ghub", offline: hub.offline });
      current.current = device; accept(device);
    }
    if (!device.bindingTarget.resourceId) {
      try {
        const found = await c.request("devices.scan", { deviceId: device.id });
        if (alive.current) setCandidates(found);
        if (found.length === 1) device = await c.request("devices.rebind", { deviceId: device.id, moduleId: device.moduleId, target: found[0].target });
      } catch (error) { recordUiError(error, "mouse.scan"); }
    }
    accept(await c.request("devices.connect", { deviceId: device.id }));
  }), [accept, run]);
  useEffect(() => {
    alive.current = true; let disposed = false, off = () => {};
    void getTransport().then(async c => {
      if (disposed) return;
      client.current = c;
      off = c.subscribe(event => {
        if (event.type === "devices.changed" && event.device.id === "mouse") {
          accept(event.device);
          if (event.device.phase === "connected" && alive.current) setMessage("");
        }
        if (event.type === "devices.removed" && event.deviceId === "mouse") { current.current = null; setSnapshot(null); }
      });
      const devices = await c.request("devices.list");
      if (disposed) return;
      const device = devices.find(d => d.id === "mouse");
      if (device) { current.current = device; accept(device); }
      if (device?.phase !== "connected") await connect();
    }).catch(error => { recordUiError(error, "mouse.initialize"); if (!disposed) setMessage(userMessage(error)); });
    return () => { disposed = true; alive.current = false; off(); };
  }, [accept, connect]);
  const info = snapshot?.values["device.info"]?.value as MouseInfo | undefined;
  const connection = snapshot?.unavailable.connection as { userMessage?: string } | undefined;
  const settingsError = snapshot?.unavailable["mouse.settings"] as { userMessage?: string } | undefined;
  const connected = snapshot?.phase === "connected";
  return <Context.Provider value={{ snapshot, info: info ?? null, candidates, busy, connected,
    message: message || connection?.userMessage || settingsError?.userMessage || "",
    status: connected ? "已连接" : busy ? "正在连接" : snapshot?.phase === "waiting" ? "等待连接" : "未连接",
    connect,
    disconnect: () => run("disconnect", async c => { if (current.current) accept(await c.request("devices.disconnect", { deviceId: current.current.id })); }),
    refresh: () => run("refresh", async c => { if (current.current) accept(await c.request("devices.refresh", { deviceId: current.current.id })); }),
    scan: () => run("scan", async c => { if (current.current) setCandidates(await c.request("devices.scan", { deviceId: current.current.id })); }),
    select: candidate => run("select", async c => {
      if (!current.current) return;
      const device = await c.request("devices.rebind", { deviceId: current.current.id, moduleId: current.current.moduleId, target: candidate.target });
      current.current = device; accept(device);
      accept(await c.request("devices.connect", { deviceId: device.id }));
    }),
    write: (capability, value) => run("write", async c => {
      if (!current.current) return;
      await c.request("devices.write", { deviceId: current.current.id, capability, value });
    }),
  }}>{children}</Context.Provider>;
}
export function useMouse() { const state = useContext(Context); if (!state) throw new Error("MouseProvider missing"); return state; }
