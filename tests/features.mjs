import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startBackend } from '../contracts/node.mjs';
import { createMockClient } from '../contracts/mock.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const configuration = process.env.DESKHUB_CONFIGURATION ?? 'Debug';
const seed = JSON.parse(await readFile(join(root, 'contracts/fixtures/devices.json'), 'utf8'));
const run = join(root, 'artifacts/validation', `features-${configuration}-${Date.now()}`);
async function open(mode, name) {
  if (mode === 'browser') {
    const client = createMockClient(seed, { latencyMs: 0 });
    return { client, close: async () => client.close() };
  }
  const backend = await startBackend({ executable: join(root, 'artifacts/package', configuration, 'deskhub.exe'), moduleRoot: join(root, 'artifacts/package', configuration, 'modules'), dataDirectory: join(run, name), offline: true });
  for (const device of seed) {
    await backend.client.request('devices.add', { id: device.id, moduleId: device.moduleId });
    await backend.client.request('devices.connect', { deviceId: device.id });
  }
  return backend;
}
const request = (client, method, deviceId, rest = {}) => client.request(method, { deviceId, ...rest });
const read = (client, id, capability) => request(client, 'devices.read', id, { capability });
const write = async (client, id, capability, value) => {
  await request(client, 'devices.write', id, { capability, value });
  assert.deepEqual((await read(client, id, capability)).value, value);
};
for (const mode of ['native', 'browser']) {
  test(`${mode}: every declared reading and all writable settings`, async () => {
    const backend = await open(mode, 'settings'); const client = backend.client;
    try {
      for (const device of await client.request('devices.list')) {
        for (const capability of device.capabilities.filter((c) => c.read)) {
          const result = await read(client, device.id, capability.id);
          assert.ok(Object.hasOwn(result, 'value'), capability.id);
          if (!capability.write) await assert.rejects(request(client, 'devices.write', device.id, { capability: capability.id, value: 0 }));
        }
      }
      for (const capability of ['audio.input', 'audio.preset']) {
        for (const choice of (await read(client, 'speaker', capability)).choices) await write(client, 'speaker', capability, choice.value);
        await assert.rejects(request(client, 'devices.write', 'speaker', { capability, value: 'unknown-option' }));
      }
      for (const [id, capability] of [['speaker', 'audio.volume'], ['speaker', 'device.timer'], ['keyboard', 'lighting.brightness']]) {
        const range = await read(client, id, capability);
        for (const value of [range.min, range.max, range.min + (range.step ?? 1)]) await write(client, id, capability, value);
        for (const value of [range.min - 1, range.max + 1, 0.5, '1', null]) await assert.rejects(request(client, 'devices.write', id, { capability, value }));
      }
      for (const capability of ['lighting.enabled', 'device.idleShutdown']) {
        for (const value of [false, true]) await write(client, 'speaker', capability, value);
        await assert.rejects(request(client, 'devices.write', 'speaker', { capability, value: 2 }));
      }
      await write(client, 'speaker', 'device.name', 'DeskHub 测试');
      for (const value of ['', ' ', '\0bad', 'x'.repeat(128)]) await assert.rejects(request(client, 'devices.write', 'speaker', { capability: 'device.name', value }));
      assert.equal((await read(client, 'keyboard', 'lighting.state')).value.brightness, (await read(client, 'keyboard', 'lighting.brightness')).value);
    } finally { await backend.close(); }
  });
  test(`${mode}: mouse choices, board restrictions, repeated mode changes and restart`, async () => {
    const backend = await open(mode, 'mouse'); const client = backend.client;
    try {
      const peers = await Promise.all(['speaker', 'keyboard'].map(id => request(client, 'devices.get', id)));
      for (const capability of ['mouse.dpiStage', 'mouse.reportRate']) {
        for (const choice of (await read(client, 'mouse', capability)).choices) await write(client, 'mouse', capability, choice.value);
        await assert.rejects(request(client, 'devices.write', 'mouse', { capability, value: 'unknown-choice' }));
      }
      await write(client, 'mouse', 'mouse.dpiStage', '1');
      await write(client, 'mouse', 'device.onboardMode', true);
      await write(client, 'mouse', 'device.onboardMode', true);
      for (const [capability, value] of [['mouse.dpiStage', '2'], ['mouse.reportRate', 500]]) {
        assert.equal((await read(client, 'mouse', capability)).writable, false);
        await assert.rejects(request(client, 'devices.write', 'mouse', { capability, value }));
      }
      for (const choice of (await read(client, 'mouse', 'mouse.profile')).choices) await write(client, 'mouse', 'mouse.profile', choice.value);
      await write(client, 'mouse', 'device.onboardMode', false);
      assert.equal((await read(client, 'mouse', 'mouse.dpiStage')).value, '1');
      await write(client, 'mouse', 'device.onboardMode', true);
      await request(client, 'devices.restart', 'mouse');
      assert.equal((await read(client, 'mouse', 'device.onboardMode')).value, false);
      assert.equal((await read(client, 'mouse', 'mouse.dpiStage')).value, '3');
      for (const peer of peers) {
        const current = await request(client, 'devices.get', peer.id);
        assert.equal(current.processId, peer.processId); assert.deepEqual(current.values, peer.values);
      }
    } finally { await backend.close(); }
  });
  test(`${mode}: every EQ band, restrictions and offline power-off`, async () => {
    const backend = await open(mode, 'eq'); const client = backend.client;
    try {
      await write(client, 'speaker', 'audio.preset', 'customized');
      const eq = await read(client, 'speaker', 'audio.eq');
      for (const band of eq.value) {
        await request(client, 'devices.invoke', 'speaker', { capability: 'audio.eq.setBand', arguments: { band: band.index, gain: eq.gain_min } });
        assert.equal((await read(client, 'speaker', 'audio.eq')).value[band.index].gain_db, eq.gain_min);
      }
      for (const arguments_ of [{ band: -1, gain: 0 }, { band: eq.value.length, gain: 0 }, { band: 0, gain: eq.gain_max + 1 }, { band: 0, gain: eq.gain_step / 2 }]) await assert.rejects(request(client, 'devices.invoke', 'speaker', { capability: 'audio.eq.setBand', arguments: arguments_ }));
      await write(client, 'speaker', 'audio.preset', 'music');
      await assert.rejects(request(client, 'devices.invoke', 'speaker', { capability: 'audio.eq.setBand', arguments: { band: 0, gain: 0 } }));
      const off = await request(client, 'devices.invoke', 'speaker', { capability: 'device.powerOff' });
      assert.equal(off.command_sent, true);
      assert.equal((await request(client, 'devices.get', 'speaker')).phase, 'disconnected');
      assert.equal((await request(client, 'devices.get', 'keyboard')).phase, 'connected');
    } finally { await backend.close(); }
  });
  test(`${mode}: connect is idempotent, session lifecycle and same-model instances`, async () => {
    const backend = await open(mode, 'lifecycle'); const client = backend.client;
    try {
      await write(client, 'speaker', 'audio.volume', 3);
      await request(client, 'devices.connect', 'speaker');
      assert.equal((await read(client, 'speaker', 'audio.volume')).value, 3);
      await request(client, 'devices.disconnect', 'speaker');
      await assert.rejects(read(client, 'speaker', 'audio.volume'));
      assert.equal((await request(client, 'devices.restart', 'speaker')).phase, 'disconnected');
      await request(client, 'devices.connect', 'speaker');
      await client.request('devices.add', { id: 'second-speaker', moduleId: 'edifier-n300', label: '第二台音响' });
      await request(client, 'devices.connect', 'second-speaker');
      await write(client, 'second-speaker', 'audio.volume', 2);
      assert.equal((await read(client, 'speaker', 'audio.volume')).value, 8);
      await request(client, 'devices.rename', 'second-speaker', { label: '替换位置' });
      await request(client, 'devices.replace', 'second-speaker', { moduleId: 'edifier-n300' });
      assert.equal((await request(client, 'devices.get', 'second-speaker')).label, '替换位置');
      await request(client, 'devices.remove', 'second-speaker');
      await assert.rejects(request(client, 'devices.get', 'second-speaker'));
      await request(client, 'devices.stop', 'keyboard');
      const rebound = await request(client, 'devices.rebind', 'keyboard', { moduleId: 'edifier-n300', target: {} });
      assert.equal(rebound.phase, 'disconnected');
      assert.equal(rebound.moduleId, 'edifier-n300');
      await request(client, 'devices.connect', 'keyboard');
      assert.equal((await read(client, 'keyboard', 'audio.volume')).value, 8);
      assert.equal((await client.request('modules.inspect', { moduleId: 'edifier-n300' })).manifest.id, 'edifier-n300');
    } finally { await backend.close(); }
  });
}
