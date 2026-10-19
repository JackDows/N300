import {test,expect} from '@playwright/test';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
// These helpers execute the packaged Windows application, not a browser imitation.
// @ts-ignore JavaScript acceptance helpers are shared with the installation test.
import {launch,alive,until} from '../../../../tests/desktop-harness.mjs';
// @ts-ignore
import {updateFixtures,waitJob} from '../../../../tests/update-fixtures.mjs';
const root=resolve(import.meta.dirname,'../../../..');
const appVersion=JSON.parse(readFileSync(join(root,'apps/desktop/src-tauri/tauri.conf.json'),'utf8')).version;
const configuration=process.env.DESKHUB_TEST_CONFIGURATION??'Debug';
const executable=join(root,'artifacts/desktop',configuration,'DeskHub.exe');
const directory=join(root,'artifacts/validation',`desktop-${configuration}-${Date.now()}`);
let app:any,fixture:any;const errors:string[]=[];
test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{
  fixture=await updateFixtures(join(directory,'feed'));
  fixture.files.set('/latest.json',Buffer.from(JSON.stringify({version:appVersion,url:fixture.origin+'/none.exe',signature:'none',sha256:'0'.repeat(64),size:1})));
  app=await launch({executable,directory,updateConfig:fixture.updateConfig});
  app.page.on('pageerror',(e:Error)=>errors.push(e.message));
  await until(async()=>(await app.request('devices.list')).some((d:any)=>d.id==='speaker'&&d.phase==='connected'));
});
test.afterAll(async()=>{await app?.close();await fixture?.close();});
test('desktop hosts the shared backend and the existing controls use the new API',async()=>{
  const info=await app.request('hub.describe');expect(info.name).toBe('DeskHub');expect(info.desktop.updater).toBe(true);
  expect(info.methods).toContain('modules.download');expect(info.methods).toContain('app.updates.install');
  await expect(app.page.locator('.titlebar__name')).toHaveText('DeskHub');
  await app.page.getByRole('button',{name:'音响设置',exact:true}).click();
  await app.request('devices.write',{deviceId:'speaker',capability:'audio.volume',value:10});
  await expect(app.page.getByRole('slider',{name:'音量'})).toHaveAttribute('aria-valuenow','10');
  await app.page.getByRole('radio',{name:'蓝牙',exact:true}).click({timeout:10000});
  await until(async()=>(await app.request('devices.read',{deviceId:'speaker',capability:'audio.input'})).value==='bluetooth');
});
test('keyboard and speaker remain independent inside the actual desktop process',async()=>{
  const speaker=await app.request('devices.get',{deviceId:'speaker'});
  await app.request('devices.add',{id:'keyboard',moduleId:'flesports-og98',offline:true});await app.request('devices.connect',{deviceId:'keyboard'});
  await app.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:2});
  await app.page.getByRole('button',{name:'关闭浮窗'}).click();
  await app.page.getByRole('button',{name:'键盘设置',exact:true}).click();
  await expect(app.page.getByRole('radio',{name:'柔和',exact:true})).toBeChecked();
  await app.page.getByRole('radio',{name:'明亮',exact:true}).click();
  await until(async()=>(await app.request('devices.read',{deviceId:'keyboard',capability:'lighting.brightness'})).value===3);
  await app.request('devices.restart',{deviceId:'keyboard'});
  expect((await app.request('devices.get',{deviceId:'speaker'})).processId).toBe(speaker.processId);
  expect((await app.request('devices.read',{deviceId:'speaker',capability:'audio.volume'})).value).toBe(10);
});
test('update check, signed download rejection and retry preserve the running app',async()=>{
  expect((await app.request('app.updates.check')).release).toBeNull();
  const artifact=fixture.artifact('bad-update.exe',Buffer.from('signed-test-payload'));
  fixture.files.set('/bad-update.exe',Buffer.from('changed-test-payload'));
  fixture.files.set('/latest.json',Buffer.from(JSON.stringify({version:'99.0.0',notes:'更新验收',platforms:{'windows-x86_64':artifact}})));
  expect((await app.request('app.updates.check')).release.version).toBe('99.0.0');
  const before=await app.request('devices.get',{deviceId:'speaker'});
  const job=await app.request('app.updates.download');const result=await waitJob({request:app.request},job.id);
  expect(result.state).toBe('failed');expect(['package_corrupt','signature_invalid']).toContain(result.error.code);
  expect((await app.request('devices.get',{deviceId:'speaker'})).processId).toBe(before.processId);
  expect((await app.request('app.updates.info')).version).toBe(appVersion);
});
test('second launch activates the existing host and diagnostics export includes update records',async()=>{
  const second=spawn(executable,['--offline'],{env:app.env,stdio:'ignore',windowsHide:true});
  await until(()=>second.exitCode!==null);expect(second.exitCode).toBe(0);
  await expect(app.page.getByText('程序已在运行',{exact:true})).toBeVisible();
  await app.page.getByRole('button',{name:'关闭浮窗'}).click();
  await app.page.getByRole('button',{name:'显示器与系统中枢'}).click();
  await app.page.getByRole('button',{name:'导出日志'}).click();
  const location=app.page.getByRole('textbox',{name:'日志保存位置'});
  await expect(location).toBeVisible();
  expect(existsSync(join(await location.inputValue(),'summary.json'))).toBe(true);
  expect(errors).toEqual([]);
});
test('signed version binding and install-time cache validation reject stale or altered application packages',async()=>{
  const older=fixture.artifact('old-signed.exe',Buffer.from('old-signed-installer'),{appVersion:'0.2.0'});
  fixture.files.set('/latest.json',Buffer.from(JSON.stringify({version:'99.0.0',platforms:{'windows-x86_64':older}})));
  await app.request('app.updates.check');const stale=await app.request('app.updates.download');
  expect((await waitJob({request:app.request},stale.id)).error.code).toBe('signature_invalid');
  const fresh=fixture.artifact('fresh-signed.exe',Buffer.from('fresh-signed-installer'),{appVersion:'99.0.0'});
  fixture.files.set('/latest.json',Buffer.from(JSON.stringify({version:'99.0.0',platforms:{'windows-x86_64':fresh}})));
  await app.request('app.updates.check');const job=await app.request('app.updates.download');
  expect((await waitJob({request:app.request},job.id)).state).toBe('ready');
  const file=join(directory,'data/updates/downloads',job.id,'payload'),bytes=readFileSync(file);bytes[0]^=1;writeFileSync(file,bytes);
  await expect(app.request('app.updates.install',{jobId:job.id})).rejects.toMatchObject({code:'package_corrupt'});
  expect((await app.request('updates.get',{jobId:job.id})).state).toBe('failed');
  const retry=await app.request('app.updates.download');await app.request('updates.cancel',{jobId:retry.id});
  expect((await waitJob({request:app.request},retry.id)).state).toBe('cancelled');
  expect((await app.request('devices.read',{deviceId:'speaker',capability:'audio.volume'})).value).toBe(10);
});
test('closing the desktop terminates every module process',async()=>{
  const pids=(await app.request('devices.list')).map((d:any)=>d.processId).filter(Boolean);
  await app.close();for(const pid of pids)await until(()=>!alive(pid));app=null;
});
