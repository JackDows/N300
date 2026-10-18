import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startBackend } from '../contracts/node.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const configuration = process.env.DESKHUB_CONFIGURATION ?? 'Debug';
const binary = join(root, 'artifacts/package', configuration, 'deskhub.exe');
const moduleRoot = join(root, 'artifacts/package', configuration, 'modules');
const run = join(root, 'artifacts/validation', `integration-${configuration}-${Date.now()}`);
await mkdir(run, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(version, runtimeVersion = version) {
  const path = join(run, 'packages', `${version}-${runtimeVersion}`);
  await mkdir(path, { recursive: true });
  await copyFile(join(root, 'artifacts/build/backend', configuration.toLowerCase(), 'deskhub-test-module.exe'), join(path, 'module.exe'));
  await writeFile(join(path, 'identity.json'), JSON.stringify({ version: runtimeVersion, capability: `test.v${runtimeVersion}` }));
  const files = {};
  for (const name of ['module.exe', 'identity.json']) files[name] = sha(await readFile(join(path, name)));
  await writeFile(join(path, 'module.json'), JSON.stringify({ id: 'test-device', name: 'Test device', version, protocolVersion: 1, executable: 'module.exe', files }));
  return path;
}
const v1 = await fixture('0.1.0');
const v2 = await fixture('0.2.0');
const mismatch = await fixture('0.3.0', '0.1.0');
async function open(name, offline = true) {
  return startBackend({ executable: binary, moduleRoot, dataDirectory: join(run, name), offline });
}
const request = (client, method, deviceId, extra = {}) => client.request(method, { deviceId, ...extra });
async function rejects(promise, codes) {
  await assert.rejects(promise, (e) => { assert.ok(codes.includes(e.code), `expected ${codes}, got ${e.code}: ${e.technicalMessage}`); return true; });
}
async function addFixture(client, id) { await client.request('devices.add', { id, packagePath: v1 }); return request(client, 'devices.connect', id); }

test('request schema and backend method inventory agree',async()=>{
  const backend=await open('schema');
  try{
    const schema=JSON.parse(await readFile(join(root,'contracts/api.schema.json'),'utf8'));
    assert.deepEqual([...backend.info.methods].sort(),schema.properties.method.enum.filter(m=>!m.startsWith('app.')).sort());
    await rejects(backend.client.request('not.a.method'),['unknown_method']);
  }finally{await backend.close();}
});

test('queued request expiry sends no write and does not terminate the active operation',async()=>{
  const backend=await open('queue');const client=backend.client;
  try{
    const before=await addFixture(client,'device');
    const slow=request(client,'devices.invoke','device',{capability:'test.delay',arguments:{ms:800}});
    await new Promise(r=>setTimeout(r,30));
    await rejects(request(client,'devices.write','device',{capability:'test.counter',value:77,timeoutMs:50}),['queue_timeout']);
    await slow;
    assert.equal((await request(client,'devices.get','device')).processId,before.processId);
    assert.equal((await request(client,'devices.read','device',{capability:'test.counter'})).value,0);
  }finally{await backend.close();}
});

test('physical bindings require explicit selection and cannot claim the same resource twice',async()=>{
  const backend=await open('binding-rules',false);const client=backend.client;
  try{
    await client.request('devices.add',{id:'one',packagePath:v1});
    await rejects(request(client,'devices.connect','one'),['target_required']);
    await request(client,'devices.rebind','one',{packagePath:v1,target:{resourceId:'fixture:123'}});
    await rejects(client.request('devices.add',{id:'two',packagePath:v1,target:{resourceId:'fixture:123'}}),['device_in_use']);
    assert.equal((await client.request('devices.list')).length,1);
  }finally{await backend.close();}
});

test('native modules: independent instances, capabilities, readback, persistence and export', async () => {
  const backend = await open('native');
  const client = backend.client;
  const events = [];
  client.subscribe((event) => events.push(event));
  try {
    await Promise.all([client.request('devices.add', { id: 'speaker', moduleId: 'edifier-n300' }), client.request('devices.add', { id: 'keyboard', moduleId: 'flesports-og98' })]);
    const [speaker, keyboard] = await Promise.all(['speaker', 'keyboard'].map((id) => request(client, 'devices.connect', id)));
    assert.notEqual(speaker.processId, keyboard.processId);
    assert.equal(speaker.offline, true); assert.equal(keyboard.offline, true);
    const changed = await request(client, 'devices.write', 'keyboard', { capability: 'lighting.brightness', value: 2 });
    assert.equal(changed.value, 2); assert.equal(changed.verified, true);
    assert.equal((await request(client, 'devices.read', 'speaker', { capability: 'audio.volume' })).value, 8);
    await request(client, 'devices.stop', 'keyboard');
    assert.equal((await request(client, 'devices.get', 'keyboard')).phase, 'stopped');
    assert.equal((await request(client, 'devices.get', 'speaker')).processId, speaker.processId);
    await rejects(request(client, 'devices.write', 'keyboard', { capability: 'lighting.brightness', value: 3 }), ['not_connected']);
    const restarted = await request(client, 'devices.connect', 'keyboard');
    assert.equal(restarted.values['lighting.brightness'].value, 4); // No automatic replay of the old value.
    await request(client, 'devices.rename', 'keyboard', { label: '我的键盘' });
    const exported = await client.request('diagnostics.export');
    const summary = JSON.parse(await readFile(join(exported.directory, 'summary.json'), 'utf8'));
    assert.equal(summary.devices.length, 2);
    assert.ok(events.some((event) => event.type === 'devices.changed' && event.device.id === 'keyboard'));
    assert.ok(events.some((event) => event.type === 'operations.changed' && event.state === 'completed'));
  } finally { await backend.close(); }
  const reopened = await open('native');
  try {
    const devices = await reopened.client.request('devices.list');
    assert.equal(devices.find((d) => d.id === 'keyboard').label, '我的键盘');
    assert.ok(devices.every((d) => d.phase === 'stopped' && d.processId === null));
  } finally { await reopened.close(); }
});

test('replacement: version handshake, corrupt package rejection, independent restart', async () => {
  const backend = await open('replace'); const client = backend.client;
  try {
    const original = await addFixture(client, 'replaceable');
    const peer = await addFixture(client, 'peer');
    await request(client, 'devices.write', 'replaceable', { capability: 'test.counter', value: 9 });
    await rejects(request(client, 'devices.replace', 'replaceable', { packagePath: mismatch }), ['incompatible_module']);
    assert.equal((await request(client, 'devices.get', 'replaceable')).processId, original.processId);
    assert.equal((await request(client, 'devices.read', 'replaceable', { capability: 'test.counter' })).value, 9);
    const corrupt = join(run, 'packages/corrupt'); await cp(v2, corrupt, { recursive: true });
    await writeFile(join(corrupt, 'identity.json'), '{}');
    await rejects(request(client, 'devices.replace', 'replaceable', { packagePath: corrupt }), ['package_corrupt']);
    const changed = await request(client, 'devices.replace', 'replaceable', { packagePath: v2 });
    assert.equal(changed.moduleVersion, '0.2.0'); assert.equal(changed.phase, 'connected');
    assert.notEqual(changed.processId, original.processId); assert.ok(changed.generation > original.generation);
    assert.ok(changed.capabilities.some((c) => c.id === 'test.v0.2.0'));
    assert.equal((await request(client, 'devices.get', 'peer')).processId, peer.processId);
    assert.equal((await request(client, 'devices.read', 'replaceable', { capability: 'test.counter' })).value, 0);
  } finally { await backend.close(); }
});

test('blocked and crashed module cannot block its peer; uncertain writes are never replayed', async () => {
  const backend = await open('faults'); const client = backend.client;
  try {
    await addFixture(client, 'bad'); await addFixture(client, 'good');
    const pending = request(client, 'devices.write', 'bad', { capability: 'test.counter', value: 'hang', timeoutMs: 700 });
    const rejected = rejects(pending, ['write_unconfirmed']);
    const started = performance.now();
    assert.equal((await request(client, 'devices.read', 'good', { capability: 'test.counter' })).value, 0);
    assert.ok(performance.now() - started < 600, 'peer was blocked by another device');
    await rejected;
    assert.equal((await request(client, 'devices.get', 'bad')).phase, 'faulted');
    await request(client, 'devices.connect', 'bad');
    assert.equal((await request(client, 'devices.read', 'bad', { capability: 'test.counter' })).value, 0);
    await rejects(request(client, 'devices.invoke', 'bad', { capability: 'test.crash' }), ['write_unconfirmed']);
    assert.equal((await request(client, 'devices.read', 'good', { capability: 'test.counter' })).value, 0);
  } finally { await backend.close(); }
});

test('stop cancels the old generation; queued operations cannot reach the replacement', async () => {
  const backend = await open('generation'); const client = backend.client;
  try {
    const before = await addFixture(client, 'device');
    const first = rejects(request(client, 'devices.invoke', 'device', { capability: 'test.delay', arguments: { ms: 5000 } }), ['stale_session', 'session_stopped', 'write_unconfirmed']);
    const queued = rejects(request(client, 'devices.write', 'device', { capability: 'test.counter', value: 99 }), ['stale_session', 'session_stopped']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const start = performance.now();
    await request(client, 'devices.stop', 'device');
    assert.ok(performance.now() - start < 3500);
    await Promise.all([first, queued]);
    const after = await request(client, 'devices.connect', 'device');
    assert.ok(after.generation > before.generation);
    assert.equal((await request(client, 'devices.read', 'device', { capability: 'test.counter' })).value, 0);
  } finally { await backend.close(); }
});

test('hardware rebinding changes the module and capabilities while preserving the logical role', async () => {
  const backend = await open('rebind'); const client = backend.client;
  try {
    await client.request('devices.add', { id: 'desk', label: '我的设备', moduleId: 'edifier-n300' });
    await request(client, 'devices.connect', 'desk');
    const rebound = await request(client, 'devices.rebind', 'desk', { moduleId: 'flesports-og98', target: {} });
    assert.equal(rebound.label, '我的设备'); assert.equal(rebound.id, 'desk'); assert.equal(rebound.moduleId, 'flesports-og98');
    assert.ok(rebound.capabilities.some((c) => c.id === 'lighting.brightness'));
    assert.ok(!rebound.capabilities.some((c) => c.id === 'audio.volume'));
    await rejects(request(client, 'devices.read', 'desk', { capability: 'audio.volume' }), ['unsupported_capability']);
  } finally { await backend.close(); }
});

test('modules can run standalone through the same protocol', async () => {
  for (const [id, executable] of [['edifier-n300','deskhub-n300.exe'],['flesports-og98','deskhub-og98.exe']]) {
    const manifest=JSON.parse(await readFile(join(root,'modules',id,'module.json'),'utf8'));
    const child = spawn(join(moduleRoot, id, manifest.version, executable), [], { stdio: ['pipe','pipe','pipe'], windowsHide: true });
    let output = '', errors = ''; child.stdout.on('data', (s) => output += s); child.stderr.on('data', (s) => errors += s);
    const done = new Promise((resolve) => child.once('close', resolve));
    for (const row of [{ id:1,method:'module.describe' },{ id:2,method:'session.initialize',params:{offline:true} },{ id:3,method:'device.connect' }]) child.stdin.write(JSON.stringify({ jsonrpc:'2.0',...row })+'\n');
    child.stdin.end();
    assert.equal(await done, 0, errors);
    const responses = output.trim().split(/\r?\n/).map(JSON.parse).filter((r) => Object.hasOwn(r,'id'));
    assert.equal(responses.find((r) => r.id === 1).result.id, id);
    assert.equal(responses.find((r) => r.id === 3).result.phase, 'connected');
  }
});
