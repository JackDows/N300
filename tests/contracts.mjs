import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockClient } from '../contracts/mock.mjs';
import { createClient } from '../contracts/client.mjs';
const fixture=JSON.parse(await readFile(new URL('../contracts/fixtures/devices.json',import.meta.url),'utf8'));
test('browser mock follows native capability ranges, serializes a device and isolates peers',async()=>{
  const client=createMockClient(fixture,{latencyMs:30});
  try{
    assert.equal((await client.request('devices.list')).length,fixture.length);
    const writing=client.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:2});
    const reading=client.request('devices.read',{deviceId:'keyboard',capability:'lighting.brightness'});
    await writing;assert.equal((await reading).value,2);
    await assert.rejects(client.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:9}),e=>e.code==='invalid_argument');
    client.simulate('keyboard','waiting');
    await assert.rejects(client.request('devices.read',{deviceId:'keyboard',capability:'lighting.brightness'}),e=>e.code==='not_connected');
    assert.equal((await client.request('devices.read',{deviceId:'speaker',capability:'audio.volume'})).value,8);
  }finally{client.close();}
});
test('browser mock discards in-flight writes after a session change',async()=>{
  const client=createMockClient(fixture,{latencyMs:50});
  const pending=client.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:1});
  const result=assert.rejects(pending,e=>e.code==='stale_session');
  await new Promise(r=>setTimeout(r,10));await client.request('devices.restart',{deviceId:'keyboard'});await result;
  assert.equal((await client.request('devices.get',{deviceId:'keyboard'})).values['lighting.brightness'].value,4);client.close();
});
test('client matches out-of-order replies and closes pending requests',async()=>{
  let deliver;const sent=[];
  const client=createClient({send:x=>sent.push(x),subscribe:callback=>{deliver=callback;return()=>{};}});
  const first=client.request('devices.list'),second=client.request('hub.describe');
  await Promise.resolve();await Promise.resolve();
  deliver({jsonrpc:'2.0',id:sent[1].id,result:{name:'DeskHub'}});deliver({jsonrpc:'2.0',id:sent[0].id,result:[]});
  assert.equal((await second).name,'DeskHub');assert.deepEqual(await first,[]);
  const pending=client.request('devices.list');client.close();await assert.rejects(pending,e=>e.code==='transport_closed');
});

test('removing a mock instance cancels its pending write and cannot change a new instance',async()=>{
  const client=createMockClient(fixture,{latencyMs:50});
  try{
    const pending=client.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:1});
    const rejected=assert.rejects(pending,e=>e.code==='stale_session');
    await new Promise(r=>setTimeout(r,10));
    await client.request('devices.remove',{deviceId:'keyboard'});
    await client.request('devices.add',{id:'keyboard',moduleId:'flesports-og98'});
    await client.request('devices.connect',{deviceId:'keyboard'});
    await rejected;
    assert.equal((await client.request('devices.read',{deviceId:'keyboard',capability:'lighting.brightness'})).value,4);
  }finally{client.close();}
});

test('mock metadata and closed transport report the same public interface',async()=>{
  const client=createMockClient(fixture);
  const schema=JSON.parse(await readFile(new URL('../contracts/api.schema.json',import.meta.url),'utf8'));
  assert.deepEqual((await client.request('hub.describe')).methods.sort(),schema.properties.method.enum.sort());
  const packages=await client.request('modules.list');
  assert.equal((await client.request('modules.inspect',{packagePath:packages[0].packagePath})).manifest.id,packages[0].manifest.id);
  client.close();
  await assert.rejects(client.request('devices.list'),e=>e.code==='transport_closed');
});

test('mock restart discards queued writes as well as the in-flight command',async()=>{
  const client=createMockClient(fixture,{latencyMs:50});
  try{
    const first=client.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:1});
    const queued=client.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:2});
    const rejected=Promise.all([first,queued].map(p=>assert.rejects(p,e=>e.code==='stale_session')));
    await new Promise(r=>setTimeout(r,10));
    await client.request('devices.restart',{deviceId:'keyboard'});
    await rejected;
    assert.equal((await client.request('devices.read',{deviceId:'keyboard',capability:'lighting.brightness'})).value,4);
  }finally{client.close();}
});
