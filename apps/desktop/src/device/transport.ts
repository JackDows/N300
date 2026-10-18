import type { DeskHubClient } from '../../../../contracts/client.mjs';
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
let instance: Promise<DeskHubClient> | null = null;
export function getTransport(): Promise<DeskHubClient> {
  instance ??= isTauri
    ? Promise.all([import('@tauri-apps/api/core'),import('@tauri-apps/api/event'),import('../../../../contracts/desktop.mjs')])
      .then(([{invoke},{listen},{createDesktopClient}])=>createDesktopClient({invoke,listen}))
    : Promise.all([import('../../../../contracts/mock.mjs'),import('../../../../contracts/fixtures/devices.json')])
      .then(([{createMockClient},seed])=>createMockClient(seed.default as any));
  return instance;
}
if(import.meta.hot)import.meta.hot.dispose(()=>{void instance?.then(c=>c.close());});
