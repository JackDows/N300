import { isTauri } from "./device/transport";
import { DeviceRequestError } from "./device/types";

export function recordUiError(error: unknown, context: string) {
  if (!isTauri) return;
  let detail: string;
  try {
    detail = error instanceof DeviceRequestError
      ? JSON.stringify({ ...error.info, stack: error.stack })
      : error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : typeof error === "string" ? error : JSON.stringify(error);
  }
  catch { detail = String(error); }
  void import("@tauri-apps/api/core").then(({ invoke }) => invoke("report_frontend_error", { context, detail: detail ?? String(error) })).catch(() => {});
}
