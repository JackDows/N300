import { createClient } from './client.mjs';

/** Tauri transport. Dependency injection keeps the SDK free of UI/framework dependencies. */
export async function createDesktopClient({ invoke, listen }) {
  const listeners = new Set();
  const release = await listen('deskhub://event', (event) => {
    for (const listener of listeners) listener(event.payload);
  });
  const client = createClient({
    async send(request) {
      const response = await invoke('hub_request', { request });
      for (const listener of listeners) listener(response);
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  const close = client.close;
  client.close = (reason) => { close(reason); release(); };
  return client;
}
