import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startBackend } from '../contracts/node.mjs';
const config = process.env.DESKHUB_CONFIGURATION ?? 'Debug';
const root = new URL('../', import.meta.url);
const backend = await startBackend({
  executable: fileURLToPath(new URL(`artifacts/package/${config}/deskhub.exe`, root)),
  moduleRoot: fileURLToPath(new URL(`artifacts/package/${config}/modules/`, root)),
  dataDirectory: fileURLToPath(new URL(`artifacts/data/fixtures-${Date.now()}/`, root)), offline: true,
});
try {
  const devices = [];
  for (const [id,moduleId,label] of [['speaker','edifier-n300','桌面音响'],['keyboard','flesports-og98','桌面键盘']]) {
    await backend.client.request('devices.add', { id,moduleId,label });
    const device = await backend.client.request('devices.connect', { deviceId:id });
    device.processId = null; device.generation = 1; device.revision = 1;
    devices.push(device);
  }
  await mkdir(new URL('contracts/fixtures/', root), { recursive: true });
  await writeFile(new URL('contracts/fixtures/devices.json', root), JSON.stringify(devices,null,2)+'\n');
  console.log('Captured native offline fixtures for frontend development.');
} finally { await backend.close(); }
