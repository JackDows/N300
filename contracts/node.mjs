import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createClient } from './client.mjs';

export async function startBackend({ executable, moduleRoot, dataDirectory, offline = false, updateConfig, onDiagnostic = () => {} }) {
  const args = ['--module-root', moduleRoot, '--data-dir', dataDirectory, 'serve'];
  if (offline) args.unshift('--offline');
  const env = { ...process.env };
  if (updateConfig) env.DESKHUB_UPDATE_CONFIG = updateConfig;
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
  const listeners = new Set();
  const output = createInterface({ input: child.stdout });
  const diagnostic = createInterface({ input: child.stderr });
  const client = createClient({
    send(message) { return new Promise((resolve, reject) => child.stdin.write(JSON.stringify(message) + '\n', (error) => error ? reject(error) : resolve())); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
  output.on('line', (line) => {
    try { const message = JSON.parse(line); for (const listener of listeners) listener(message); }
    catch (error) { client.close(error.message); }
  });
  diagnostic.on('line', onDiagnostic);
  child.on('error', (error) => client.close(error.message));
  child.stdin.on('error', (error) => client.close(error.message));
  const exited = new Promise((resolve) => child.once('close', (code) => { client.close(); resolve(code); }));
  async function close() {
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000);
    await exited; clearTimeout(timer); output.close(); diagnostic.close();
  }
  try { const info = await client.request('hub.describe'); return { client, info, process: child, close }; }
  catch (error) { await close(); throw error; }
}
