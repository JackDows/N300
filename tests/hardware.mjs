// Explicit opt-in real-device verification. Not invoked by the normal offline test command.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { startBackend } from '../contracts/node.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const targetFile = process.argv.find((arg) => arg.startsWith('--targets='))?.slice(10);
if (!targetFile) throw new Error('Pass --targets=<devices.json from an explicitly selected hardware session>');
const writeEnabled = process.argv.includes('--write-and-restore');
const inputSwitchEnabled = process.argv.includes('--include-input-switch');
const configuration = process.env.DESKHUB_CONFIGURATION ?? 'Release';
const bindings = JSON.parse(await readFile(resolve(targetFile), 'utf8')).devices;
const directory = join(root, 'artifacts/validation', `hardware-${Date.now()}`);
await mkdir(directory, { recursive: true });
const report = { startedAt: new Date().toISOString(), writesEnabled: writeEnabled, inputSwitchEnabled, checks: [], devices: {} };
const available = [];
const backend = await startBackend({ executable: join(root, 'artifacts/package', configuration, 'deskhub.exe'), moduleRoot: join(root, 'artifacts/package', configuration, 'modules'), dataDirectory: join(directory, 'data'), offline: false });
const client = backend.client;
const read = async (id, capability) => client.request('devices.read', { deviceId: id, capability });
const write = async (id, capability, value) => {
  await client.request('devices.write', { deviceId: id, capability, value });
  assert.deepEqual((await read(id, capability)).value, value, `${id}/${capability} readback`);
};
async function roundTrip(id, capability, changed) {
  const original = (await read(id, capability)).value;
  try { await write(id, capability, changed); }
  finally { await write(id, capability, original); }
  report.checks.push({ device: id, capability, result: 'write-read-restore-confirmed' });
}
try {
  for (const binding of bindings) {
    if (!['edifier-n300', 'flesports-og98'].includes(binding.moduleId) || !binding.target?.resourceId) throw new Error('Explicit supported hardware targets required');
    try {
    await client.request('devices.add', { id: binding.id, moduleId: binding.moduleId, target: binding.target });
    const before = await client.request('devices.connect', { deviceId: binding.id });
    report.devices[binding.id] = { before, unavailable: before.unavailable };
    for (const capability of before.capabilities.filter((c) => c.read && before.values[c.id])) {
      await read(binding.id, capability.id);
      report.checks.push({ device: binding.id, capability: capability.id, result: 'read-confirmed' });
    }
    available.push(binding);
    } catch (error) {
      report.devices[binding.id] = { error: { code: error.code, message: error.message, technicalMessage: error.technicalMessage } };
    }
  }
  if (writeEnabled) {
    const speaker = available.find((d) => d.moduleId === 'edifier-n300')?.id;
    const keyboard = available.find((d) => d.moduleId === 'flesports-og98')?.id;
    if (speaker) {
      const volume = await read(speaker, 'audio.volume');
      await roundTrip(speaker, 'audio.volume', volume.value > volume.min ? volume.value - volume.step : volume.value + volume.step);
      for (const capability of inputSwitchEnabled ? ['audio.input', 'audio.preset'] : ['audio.preset']) {
        for (const choice of (await read(speaker, capability)).choices) await roundTrip(speaker, capability, choice.value);
      }
      await roundTrip(speaker, 'device.name', 'DeskHub N300');
      const preset = (await read(speaker, 'audio.preset')).value;
      try {
        await write(speaker, 'audio.preset', 'customized');
        const eq = await read(speaker, 'audio.eq');
        for (const band of eq.value) {
          const gain = band.gain_db + eq.gain_step <= eq.gain_max ? band.gain_db + eq.gain_step : band.gain_db - eq.gain_step;
          const set = async (value) => {
            await client.request('devices.invoke', { deviceId: speaker, capability: 'audio.eq.setBand', arguments: { band: band.index, gain: value } });
            assert.equal((await read(speaker, 'audio.eq')).value[band.index].gain_db, value);
          };
          try { await set(gain); } finally { await set(band.gain_db); }
          report.checks.push({ device: speaker, capability: 'audio.eq.setBand', band: band.index, result: 'write-read-restore-confirmed' });
        }
      } finally { await write(speaker, 'audio.preset', preset); }
      for (const capability of ['lighting.enabled', 'device.idleShutdown', 'device.timer']) {
        const value = report.devices[speaker].before.values[capability]?.value;
        if (value === undefined) continue;
        await roundTrip(speaker, capability, typeof value === 'boolean' ? !value : value === 240 ? 239 : 240);
      }
    }
    if (keyboard) {
      const brightness = await read(keyboard, 'lighting.brightness');
      await roundTrip(keyboard, 'lighting.brightness', brightness.value > 0 ? brightness.value - 1 : 1);
    }
  }
  for (const binding of available) {
    const after = await client.request('devices.restart', { deviceId: binding.id });
    report.devices[binding.id].after = after;
    assert.deepEqual(after.values, report.devices[binding.id].before.values, `${binding.id}: settings changed after verification`);
    report.checks.push({ device: binding.id, result: 'restart-and-settings-preserved' });
  }
  report.result = Object.values(report.devices).some((d) => d.error) ? 'incomplete' : 'passed';
  if (report.result !== 'passed') process.exitCode = 1;
} catch (error) {
  report.result = 'failed'; report.error = { code: error.code, message: error.message, technicalMessage: error.technicalMessage };
  process.exitCode = 1;
} finally {
  await backend.close();
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ directory, result: report.result, checks: report.checks.length, error: report.error, devices: Object.fromEntries(Object.entries(report.devices).map(([id, state]) => [id, { unavailable: state.unavailable, error: state.error }])) }));
}
