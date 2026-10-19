import test,{after} from 'node:test';
import {MOCK_UPDATE_VERSION} from '../contracts/version.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {startBackend} from '../contracts/node.mjs';
import {createMockClient} from '../contracts/mock.mjs';
import {root} from '../scripts/signing.mjs';
import {updateFixtures,waitJob} from './update-fixtures.mjs';
const configuration=process.env.DESKHUB_CONFIGURATION??'Debug';
const run=join(root,'artifacts/validation',`updates-${configuration}-${Date.now()}`);
const fixture=await updateFixtures(run);after(()=>fixture.close());
const v1=fixture.module('0.1.0'),v2=fixture.module('0.2.0'),badStart=fixture.module('0.3.0',{failConnect:true}),wrongIdentity=fixture.module('0.4.0',{runtimeVersion:'0.1.0'}),escape=fixture.module('0.5.0',{extra:{'../escaped.txt':Buffer.from('escape')}}),incompatible=fixture.module('0.6.0',{minimumHubVersion:'99.0.0'});
const all=[v1,v2,badStart,wrongIdentity,escape,incompatible].map(x=>x.release);
const options=name=>({executable:join(root,'artifacts/package',configuration,'deskhub.exe'),moduleRoot:join(root,'artifacts/package',configuration,'modules'),dataDirectory:join(run,name),offline:true,updateConfig:fixture.updateConfig});
async function open(name){fixture.setMode('normal');fixture.setCatalog(all);const backend=await startBackend(options(name));return backend;}
async function setup(client){
  await client.request('devices.add',{id:'target',packagePath:v1.local});await client.request('devices.connect',{deviceId:'target'});
  await client.request('devices.add',{id:'peer',moduleId:'flesports-og98'});await client.request('devices.connect',{deviceId:'peer'});
  return {target:await client.request('devices.get',{deviceId:'target'}),peer:await client.request('devices.get',{deviceId:'peer'})};
}
async function downloaded(client,version='0.2.0'){
  await client.request('modules.catalog');
  const job=await client.request('modules.download',{moduleId:'test-device',version});
  const ready=await waitJob(client,job.id);assert.equal(ready.state,'ready',JSON.stringify(ready.error));return ready;
}
test('HTTP module download, install, activation and restart preserve bindings and peer process',async()=>{
  const backend=await open('success'),c=backend.client;let before;
  try{
    before=await setup(c);const events=[];c.subscribe(e=>{if(e.type==='updates.changed')events.push(e.job.state);});
    const job=await downloaded(c);
    assert.equal((await c.request('devices.get',{deviceId:'target'})).moduleVersion,'0.1.0');
    await c.request('modules.install',{jobId:job.id,deviceId:'target'});
    const done=await waitJob(c,job.id);assert.equal(done.state,'completed',JSON.stringify(done.error));
    assert.equal(done.result.device.moduleVersion,'0.2.0');assert.equal(done.result.device.phase,'connected');
    assert.equal((await c.request('devices.get',{deviceId:'peer'})).processId,before.peer.processId);
    assert.ok((await c.request('modules.list')).some(p=>p.manifest.id==='test-device'&&p.manifest.version==='0.2.0'));
    const newest=await c.request('modules.inspect',{moduleId:'test-device'});assert.equal(newest.manifest.version,'0.2.0');
    assert.ok(events.includes('downloading')&&events.includes('verifying')&&events.includes('installing')&&events.includes('completed'));
    assert.equal(existsSync(join(options('success').dataDirectory,'updates/downloads',job.id,'payload')),false);
    await assert.rejects(c.request('modules.install',{jobId:job.id}),e=>e.code==='invalid_argument');
  }finally{await backend.close();}
  const reopened=await startBackend(options('success'));
  try{const device=await reopened.client.request('devices.connect',{deviceId:'target'});assert.equal(device.moduleVersion,'0.2.0');assert.equal(device.label,before.target.label);assert.equal((await reopened.client.request('devices.list')).length,2);}
  finally{await reopened.close();}
});
test('installation without a device exposes the module for later binding',async()=>{
  const backend=await open('new-install'),c=backend.client;
  try{const job=await downloaded(c);await c.request('modules.install',{jobId:job.id});const done=await waitJob(c,job.id);assert.equal(done.state,'completed');assert.equal((await c.request('devices.list')).length,0);
    await c.request('devices.add',{id:'new',packagePath:done.result.package.packagePath});assert.equal((await c.request('devices.connect',{deviceId:'new'})).moduleVersion,'0.2.0');}
  finally{await backend.close();}
});
test('activation failure rolls back the original module while leaving the peer running',async()=>{
  const backend=await open('rollback'),c=backend.client;
  try{const before=await setup(c);const job=await downloaded(c,'0.3.0');await c.request('modules.install',{jobId:job.id,deviceId:'target'});const failed=await waitJob(c,job.id);
    assert.equal(failed.state,'failed');assert.equal(failed.error.details.rolledBack,true,JSON.stringify(failed.error));
    const restored=await c.request('devices.get',{deviceId:'target'});assert.equal(restored.moduleVersion,'0.1.0');assert.equal(restored.phase,'connected');
    assert.equal((await c.request('devices.get',{deviceId:'peer'})).processId,before.peer.processId);assert.equal((await c.request('devices.read',{deviceId:'target',capability:'test.counter'})).value,0);}
  finally{await backend.close();}
});
test('untrusted catalog, incompatible versions and invalid signatures are rejected before activation',async()=>{
  const backend=await open('trust'),c=backend.client;
  try{const before=await setup(c);fixture.setCatalog(all,{badSignature:true});await assert.rejects(c.request('modules.catalog'),e=>e.code==='signature_invalid');
    fixture.setCatalog(all);await c.request('modules.catalog');await assert.rejects(c.request('modules.download',{moduleId:'test-device',version:'0.6.0'}),e=>e.code==='incompatible_module');
    const bad=structuredClone(v2.release);bad.artifact.signature=v1.release.artifact.signature;fixture.setCatalog([bad]);await c.request('modules.catalog');
    const job=await c.request('modules.download',{moduleId:'test-device',version:'0.2.0'});const failed=await waitJob(c,job.id);assert.equal(failed.error.code,'signature_invalid');
    assert.equal((await c.request('devices.get',{deviceId:'target'})).processId,before.target.processId);}
  finally{await backend.close();}
});
test('truncated and tampered HTTP packages cannot change the installed device',async()=>{
  const backend=await open('bad-download'),c=backend.client;
  try{const before=await setup(c);await c.request('modules.catalog');for(const mode of ['cut','tamper']){
    fixture.setMode(mode);const job=await c.request('modules.download',{moduleId:'test-device',version:'0.2.0'});const failed=await waitJob(c,job.id);assert.equal(failed.state,'failed');assert.ok(['download_failed','package_corrupt'].includes(failed.error.code));
    assert.equal(existsSync(join(options('bad-download').dataDirectory,'updates/downloads',job.id,'payload.part')),false);
    assert.equal((await c.request('devices.get',{deviceId:'target'})).processId,before.target.processId);
  }}finally{await backend.close();fixture.setMode('normal');}
});
test('cancel aborts a stalled network request without blocking another device',async()=>{
  const backend=await open('cancel'),c=backend.client;
  try{const before=await setup(c);await c.request('modules.catalog');fixture.setMode('stall');const job=await c.request('modules.download',{moduleId:'test-device',version:'0.2.0'});
    await waitJob(c,job.id,['downloading']);assert.equal((await c.request('devices.read',{deviceId:'peer',capability:'lighting.brightness'})).value,4);
    await assert.rejects(c.request('modules.download',{moduleId:'test-device',version:'0.2.0'}),e=>e.code==='update_busy');
    const start=performance.now();await c.request('updates.cancel',{jobId:job.id});assert.equal((await waitJob(c,job.id)).state,'cancelled');assert.ok(performance.now()-start<1500);
    assert.equal((await c.request('devices.get',{deviceId:'peer'})).processId,before.peer.processId);
    fixture.setMode('normal');assert.equal((await downloaded(c)).state,'ready');
  }finally{await backend.close();fixture.setMode('normal');}
});
test('ZIP traversal, runtime mismatch and cached package corruption preserve the previous module',async()=>{
  const backend=await open('unsafe-package'),c=backend.client;
  try{const before=await setup(c);for(const version of ['0.4.0','0.5.0','0.2.0']){
    const job=await downloaded(c,version);
    if(version==='0.2.0'){const path=join(options('unsafe-package').dataDirectory,'updates/downloads',job.id,'payload');const bytes=readFileSync(path);bytes[0]^=1;writeFileSync(path,bytes);}
    await c.request('modules.install',{jobId:job.id,deviceId:'target'});const failed=await waitJob(c,job.id);assert.equal(failed.state,'failed');
    assert.equal((await c.request('devices.get',{deviceId:'target'})).processId,before.target.processId);
    assert.equal(existsSync(join(options('unsafe-package').dataDirectory,'updates/downloads',job.id,'escaped.txt')),false);
  }}finally{await backend.close();}
});
test('restart reports an interrupted download and removes only its owned cached payload',async()=>{
  const backend=await open('restart'),c=backend.client;const job=await downloaded(c);
  const unrelated=join(options('restart').dataDirectory,'keep-user-file.txt');writeFileSync(unrelated,'preserve');await backend.close();
  const reopened=await startBackend(options('restart'));
  try{assert.equal((await reopened.client.request('updates.get',{jobId:job.id})).state,'interrupted');assert.equal(existsSync(join(options('restart').dataDirectory,'updates/downloads',job.id,'payload')),false);assert.equal(readFileSync(unrelated,'utf8'),'preserve');}
  finally{await reopened.close();}
});
test('browser simulator supports update progress, independent module activation, cancellation and failure states',async()=>{
  const seed=JSON.parse(readFileSync(join(root,'contracts/fixtures/devices.json'),'utf8'));
  for(const scenario of ['success','network-error','bad-signature','install-failure']){
    const c=createMockClient(seed,{latencyMs:1,updateScenario:scenario});
    try{const job=await c.request('modules.download',{moduleId:'flesports-og98'});let state=await waitJob(c,job.id);
      if(['network-error','bad-signature'].includes(scenario)){assert.equal(state.state,'failed');continue;}
      await c.request('modules.install',{jobId:job.id,deviceId:'keyboard'});state=await waitJob(c,job.id);assert.equal(state.state,scenario==='success'?'completed':'failed');
      assert.equal((await c.request('devices.read',{deviceId:'speaker',capability:'audio.volume'})).value,8);
      if(scenario==='success'){await c.request('app.updates.check');const app=await c.request('app.updates.download');await waitJob(c,app.id);await c.request('app.updates.install',{jobId:app.id});await waitJob(c,app.id);assert.equal((await c.request('app.updates.info')).version,MOCK_UPDATE_VERSION);}
    }finally{c.close();}
  }
});
