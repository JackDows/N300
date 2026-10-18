import type { DeskHubClient, DeviceSnapshot } from './client.mjs';
export function createMockClient(seed: DeviceSnapshot[], options?: { latencyMs?: number; updateScenario?: 'success' | 'network-error' | 'bad-signature' | 'install-failure' }): DeskHubClient & {
  simulate(deviceId: string, phase: 'connected' | 'disconnected' | 'waiting' | 'faulted'): DeviceSnapshot;
};
