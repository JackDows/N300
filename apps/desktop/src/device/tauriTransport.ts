import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createRpcTransport, type CoreLine } from "./rpcTransport";

export function createTauriTransport() {
  return createRpcTransport({
    start: () => invoke<number>("core_start"),
    send: (line) => invoke("core_send", { line }),
    listenLine: (callback) => listen<CoreLine>("n300://line", (event) => callback(event.payload)),
    listenExit: (callback) => listen<number>("n300://exit", (event) => callback(event.payload)),
  });
}
