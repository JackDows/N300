import type { DeskHubClient, DeviceSnapshot } from './client.mjs';
export function createMockClient(seed: DeviceSnapshot[], options?: { latencyMs?: number }): DeskHubClient & {
  simulate(deviceId: string, phase: 'connected' | 'disconnected' | 'waiting' | 'faulted'): DeviceSnapshot;
};
