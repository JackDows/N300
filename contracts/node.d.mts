import type { DeskHubClient, HubInfo } from './client.mjs';
export function startBackend(options: { executable: string; moduleRoot: string; dataDirectory: string; offline?: boolean; updateConfig?: string; onDiagnostic?: (line: string) => void }): Promise<{ client: DeskHubClient; info: HubInfo; process: { pid?: number }; close(): Promise<void> }>;
