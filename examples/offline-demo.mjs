import { fileURLToPath } from 'node:url';
import { startBackend } from '../contracts/node.mjs';
const config = process.env.DESKHUB_CONFIGURATION ?? 'Debug';
const root = new URL('../', import.meta.url);
const backend = await startBackend({
  executable: fileURLToPath(new URL(`artifacts/package/${config}/deskhub.exe`, root)),
  moduleRoot: fileURLToPath(new URL(`artifacts/package/${config}/modules/`, root)),
  dataDirectory: fileURLToPath(new URL('artifacts/data/example-offline/', root)), offline: true,
});
try {
  const client = backend.client;
  const existing = await client.request('devices.list');
  for (const [id, moduleId, label] of [['speaker','edifier-n300','桌面音响'],['keyboard','flesports-og98','桌面键盘']]) {
    if (!existing.some((device) => device.id === id)) await client.request('devices.add', { id, moduleId, label });
  }
  await Promise.all(['speaker','keyboard'].map((deviceId) => client.request('devices.connect', { deviceId })));
  console.log('音量：', await client.request('devices.read', { deviceId: 'speaker', capability: 'audio.volume' }));
  console.log('灯光：', await client.request('devices.write', { deviceId: 'keyboard', capability: 'lighting.brightness', value: 2 }));
  await client.request('devices.restart', { deviceId: 'keyboard' });
  console.log('键盘模块重启后，音响仍可用：', await client.request('devices.read', { deviceId: 'speaker', capability: 'audio.volume' }));
  console.log(JSON.stringify(await client.request('devices.list'), null, 2));
} finally { await backend.close(); }
