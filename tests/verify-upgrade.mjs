// Explicit Windows installation acceptance. Run against an installed DeskHub test baseline.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {root,config} from '../scripts/signing.mjs';
import {launch,attach,alive,until} from './desktop-harness.mjs';
import {waitJob} from './update-fixtures.mjs';
const executable=process.env.DESKHUB_UPGRADE_TEST_EXE;
if(!executable||!existsSync(executable))throw new Error('Set DESKHUB_UPGRADE_TEST_EXE to the installed DeskHub baseline executable');
const version=JSON.parse(readFileSync(join(root,'apps/desktop/src-tauri/tauri.conf.json'),'utf8')).version;
const published=process.argv.includes('--published');
const release=join(root,'artifacts/releases',version),filename=`DeskHub_${version}_x64-setup.exe`;
const manifest=published?await fetch(config.appFeed).then(async response=>{assert.equal(response.status,200);return response.json();}):JSON.parse(readFileSync(join(release,'latest.json'),'utf8'));
assert.equal(manifest.version,version,'The update feed must match the release under test');
const installer=published?null:readFileSync(join(release,filename));
const directory=join(root,'artifacts/validation',`upgrade-${Date.now()}`);mkdirSync(directory,{recursive:true});
let origin;
const feed=createServer((request,response)=>{
  if(request.url==='/latest.json'){const value=structuredClone(manifest);value.platforms['windows-x86_64'].url=origin+'/setup.exe';response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));}
  else if(request.url==='/setup.exe'&&installer){response.writeHead(200,{'Content-Length':installer.length});response.end(installer);}
  else response.writeHead(404).end();
});
feed.listen(0,'127.0.0.1');await once(feed,'listening');origin=`http://127.0.0.1:${feed.address().port}`;
const updateConfig=join(directory,'updates.json');writeFileSync(updateConfig,JSON.stringify({...config,appFeed:published?config.appFeed:origin+'/latest.json'}));
const expectedPath=resolve(executable).toLowerCase();
function installedProcesses(){
  const result=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name = 'DeskHub.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true});
  const value=JSON.parse(result.trim()||'[]');return(Array.isArray(value)?value:[value]).filter(p=>String(p.ExecutablePath).toLowerCase()===expectedPath);
}
let app,after;
try{
  assert.equal(installedProcesses().length,0,'Close the specified test baseline first');
  app=await launch({executable,directory,updateConfig});
  await until(async()=>(await app.request('devices.list')).some(d=>d.id==='speaker'&&d.phase==='connected'));
  const before=await app.request('app.updates.info');assert.notEqual(before.version,version);
  await app.request('devices.add',{id:'keyboard',moduleId:'flesports-og98',offline:true,label:'升级验收键盘'});await app.request('devices.connect',{deviceId:'keyboard'});
  const devicesBefore=await app.request('devices.list'),pids=devicesBefore.map(d=>d.processId).filter(Boolean);
  const bindings=JSON.parse(readFileSync(join(directory,'data/devices.json'),'utf8'));
  const userFile=join(directory,'data/user-settings.json');writeFileSync(userFile,'{"acceptance":"preserve"}');
  await app.page.evaluate(()=>localStorage.setItem('deskhub-upgrade-check','preserve'));
  const check=await app.request('app.updates.check');assert.equal(check.release.version,version);
  const download=await app.request('app.updates.download');assert.equal((await waitJob({request:app.request},download.id,undefined,60000)).state,'ready');
  const installed=await app.request('app.updates.install',{jobId:download.id});assert.equal(installed.state,'installing');
  await until(()=>!alive(app.process.pid),{timeout:30000,message:'Old application did not exit'});
  await app.browser.close();
  const processes=await until(()=>{const p=installedProcesses();return p.length===1&&p[0].ProcessId!==app.process.pid?p:null;},{timeout:90000,message:'Updated application did not restart'});
  after=await attach(app.port);
  const info=await after.request('app.updates.info');assert.equal(info.version,version);assert.equal(info.lastResult.state,'completed');
  await until(async()=>{const devices=await after.request('devices.list');return ['speaker','keyboard','mouse'].every(id=>devices.some(d=>d.id===id&&d.phase==='connected'));},{timeout:30000});
  const saved=JSON.parse(readFileSync(join(directory,'data/devices.json'),'utf8'));
  assert.equal(saved.schemaVersion,bindings.schemaVersion);
  for(const binding of bindings.devices)assert.deepEqual(saved.devices.find(d=>d.id===binding.id),binding,'Existing device binding changed during upgrade');
  assert.equal(readFileSync(userFile,'utf8'),'{"acceptance":"preserve"}');
  assert.equal(await after.page.evaluate(()=>localStorage.getItem('deskhub-upgrade-check')),'preserve');
  assert.ok(pids.every(pid=>!alive(pid)),'An old module process survived the installer');
  await until(async()=>!(await after.request('app.updates.info')).lastResult.cleanupPending,{timeout:120000,message:'Updater installer was not removed'});
  assert.equal(existsSync(join(directory,'data/updates/app-install.json')),false);
  assert.equal(existsSync(join(directory,'data/updates/downloads',download.id,'payload')),false);
  assert.equal((await after.request('updates.get',{jobId:download.id})).state,'completed');
  assert.equal((await after.request('devices.read',{deviceId:'keyboard',capability:'lighting.brightness'})).value,4);
  assert.equal((await after.request('devices.read',{deviceId:'speaker',capability:'audio.volume'})).value,8);
  assert.equal((await after.request('devices.read',{deviceId:'mouse',capability:'mouse.dpiStage'})).value,'3');
  const result={source:published?'github':'loopback',before:before.version,after:info.version,installation:executable,restarted:true,oldModuleProcessesExited:true,bindingsPreserved:true,userSettingsPreserved:true,rendererSettingsPreserved:true,downloadAndInstallerRemoved:true,independentModulesWorking:true,appProcessId:processes[0].ProcessId};
  writeFileSync(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{
  if(after){try{await after.page.getByRole('button',{name:'关闭窗口',exact:true}).click();}catch{}await until(()=>installedProcesses().length===0,{timeout:10000});await after.browser.close();}
  else await app?.close();
  feed.closeAllConnections();await new Promise(r=>feed.close(r));
}
