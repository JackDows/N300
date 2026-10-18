import { isTauri, getTransport } from "./device/transport";

export function recordUiError(error: unknown, context: string) {
  if (!isTauri) return;
  let detail: string;
  try {
    detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : typeof error === "string" ? error : JSON.stringify(error);
  }
  catch { detail = String(error); }
  void getTransport().then(client => client.request("diagnostics.report", { context, detail: (detail ?? String(error)).slice(0,4000) })).catch(() => {});
}
