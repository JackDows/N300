import type { DeskHubClient } from './client.mjs';
export function createDesktopClient(bridge: {
  invoke(command: string, args: Record<string, unknown>): Promise<any>;
  listen(event: string, listener: (event: { payload: any }) => void): Promise<() => void>;
}): Promise<DeskHubClient>;
