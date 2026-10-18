import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcTransport, type CoreBridge, type CoreLine } from "../../src/device/rpcTransport";

function fixture(timeout = 1000) {
  let line: (value: CoreLine) => void = () => {};
  let exit: (generation: number) => void = () => {};
  const off = vi.fn();
  const bridge: CoreBridge = {
    start: vi.fn().mockResolvedValue(1),
    send: vi.fn().mockResolvedValue(undefined),
    listenLine: vi.fn(async (callback) => { line = callback; return off; }),
    listenExit: vi.fn(async (callback) => { exit = callback; return off; }),
  };
  return {
    bridge, transport: createRpcTransport(bridge, timeout), off,
    exit: (generation = 1) => exit(generation),
    message: (message: unknown, generation = 1) => line({ generation, line: JSON.stringify(message) }),
  };
}
afterEach(() => vi.useRealTimers());
describe("native RPC lifecycle", () => {
  it("shares one startup and preserves events emitted before the startup reply", async () => {
    const f = fixture();
    const event = { type: "ready", offline: true };
    vi.mocked(f.bridge.start).mockImplementation(async () => { f.message({ jsonrpc: "2.0", method: "event", params: event }); return 1; });
    const listener = vi.fn(); f.transport.subscribe(listener);
    await Promise.all([f.transport.start(), f.transport.start()]);
    expect(f.bridge.start).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
    f.transport.dispose?.();
  });
  it("can retry a failed launch without accumulating event subscriptions", async () => {
    const f = fixture();
    vi.mocked(f.bridge.start).mockRejectedValueOnce(new Error("missing exe"));
    await expect(f.transport.start()).rejects.toThrow("missing exe");
    await f.transport.start();
    expect(f.bridge.start).toHaveBeenCalledTimes(2);
    expect(f.bridge.listenLine).toHaveBeenCalledTimes(1);
    f.transport.dispose?.();
  });
  it("matches out-of-order responses and ignores replies from an old process", async () => {
    const f = fixture();
    const first = f.transport.request("get", { property: "volume" });
    const second = f.transport.request("get", { property: "firmware" });
    await vi.waitFor(() => expect(f.bridge.send).toHaveBeenCalledTimes(2));
    const ids = vi.mocked(f.bridge.send).mock.calls.map(([line]) => JSON.parse(line).id);
    f.message({ jsonrpc: "2.0", id: ids[0], result: "stale" }, 99);
    f.message({ jsonrpc: "2.0", id: ids[1], result: "1.5.1" });
    f.message({ jsonrpc: "2.0", id: ids[0], result: 8 });
    expect(await Promise.all([first, second])).toEqual([8, "1.5.1"]);
    f.transport.dispose?.();
  });
  it("rejects pending writes on exit and allows explicit restart without replay", async () => {
    const f = fixture();
    const first = f.transport.request("set", { property: "volume", value: 10 });
    const rejected = expect(first).rejects.toMatchObject({ info: { code: "core_exit" } });
    await vi.waitFor(() => expect(f.bridge.send).toHaveBeenCalledTimes(1));
    f.exit(); await rejected;
    vi.mocked(f.bridge.start).mockResolvedValue(2);
    const restarted = f.transport.request("start");
    await vi.waitFor(() => expect(f.bridge.send).toHaveBeenCalledTimes(2));
    const msg = JSON.parse(vi.mocked(f.bridge.send).mock.calls[1][0]);
    expect(msg.method).toBe("start");
    f.exit(1);
    f.message({ jsonrpc: "2.0", id: msg.id, result: true }, 2);
    expect(await restarted).toBe(true);
    f.transport.dispose?.();
  });
  it("times out once without silently replaying a command", async () => {
    vi.useFakeTimers();
    const f = fixture(50);
    const pending = f.transport.request("set", { property: "led", value: false });
    const rejected = expect(pending).rejects.toMatchObject({ info: { code: "timeout" } });
    await vi.advanceTimersByTimeAsync(60); await rejected;
    expect(f.bridge.send).toHaveBeenCalledTimes(1);
    f.transport.dispose?.();
  });
  it("cleans up partially installed listeners after an IPC subscription failure", async () => {
    const f = fixture();
    vi.mocked(f.bridge.listenExit).mockRejectedValueOnce(new Error("bridge unavailable"));
    await expect(f.transport.start()).rejects.toThrow("bridge unavailable");
    expect(f.off).toHaveBeenCalledTimes(1);
    await f.transport.start();
    expect(f.bridge.listenLine).toHaveBeenCalledTimes(2);
    f.transport.dispose?.();
  });
  it("rejects pending requests and releases listeners on renderer disposal", async () => {
    const f = fixture();
    const pending = f.transport.request("get", { property: "volume" });
    const rejected = expect(pending).rejects.toMatchObject({ info: { code: "core_unavailable" } });
    await vi.waitFor(() => expect(f.bridge.send).toHaveBeenCalledTimes(1));
    f.transport.dispose?.(); await rejected;
    expect(f.off).toHaveBeenCalledTimes(2);
    await expect(f.transport.start()).rejects.toMatchObject({ info: { code: "core_unavailable" } });
  });
});
