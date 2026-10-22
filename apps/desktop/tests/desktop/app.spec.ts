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
  // No manual add/connect: startup itself must create and connect the keyboard.
  await until(async()=>(await app.request('devices.list')).some((d:any)=>d.id==='keyboard'&&d.phase==='connected'));
  await app.request('devices.write',{deviceId:'keyboard',capability:'lighting.brightness',value:2});
  await app.page.getByRole('button',{name:'返回总览'}).click();
  await app.page.getByRole('button',{name:'键盘设置',exact:true}).click();
  await app.page.getByRole('tab',{name:'灯光',exact:true}).click();
  await expect(app.page.getByRole('radio',{name:'柔和',exact:true})).toBeChecked();
  await app.page.getByRole('radio',{name:'明亮',exact:true}).click();
  await until(async()=>(await app.request('devices.read',{deviceId:'keyboard',capability:'lighting.brightness'})).value===3);
  await app.request('devices.restart',{deviceId:'keyboard'});
  expect((await app.request('devices.get',{deviceId:'speaker'})).processId).toBe(speaker.processId);
  expect((await app.request('devices.read',{deviceId:'speaker',capability:'audio.volume'})).value).toBe(10);
});
test('key editor and macro recorder use the native device modules',async()=>{
  await app.page.getByRole('tab',{name:'按键',exact:true}).click();
  await expect(app.page.getByRole('button',{name:'按键 F12',exact:true})).toBeEnabled();
  await app.page.getByRole('button',{name:'按键 F12',exact:true}).click();await app.page.getByLabel('目标按键',{exact:true}).selectOption('104');await app.page.getByRole('button',{name:'保存按键',exact:true}).click();
  await expect(app.page.getByText('当前：F13',{exact:true})).toBeVisible();
  const keys=await app.request('devices.read',{deviceId:'keyboard',capability:'keyboard.keymap'});expect(keys.value.keys.find((k:any)=>k.label==='F12').binding.raw).toEqual([0,0,104,0]);
  await app.page.getByRole('button',{name:'恢复原键',exact:true}).click();await expect(app.page.getByText('当前：F12',{exact:true})).toBeVisible();
  await app.page.getByRole('button',{name:'返回总览'}).click();await app.page.getByRole('button',{name:'鼠标设置',exact:true}).click();
  await app.page.getByRole('tab',{name:'宏',exact:true}).click();await expect(app.page.getByRole('button',{name:'录制键盘',exact:true})).toBeEnabled();
  await app.page.getByLabel('宏名称',{exact:true}).fill('桌面验收');await app.page.getByRole('button',{name:'录制键盘',exact:true}).click();await app.page.keyboard.press('Control+c');await app.page.keyboard.press('Escape');
  await app.page.getByRole('button',{name:'保存宏',exact:true}).click();await expect(app.page.getByText('宏已保存，可在按键页绑定使用。',{exact:true})).toBeVisible();
  const library=await app.request('devices.invoke',{deviceId:'mouse',capability:'macros.list'});expect(library.items.some((m:any)=>m.name==='桌面验收')).toBe(true);
  await app.page.getByRole('tab',{name:'按键',exact:true}).click();const row=app.page.locator('.mouse-binding').filter({has:app.page.getByText('后退侧键',{exact:true})});await row.getByRole('combobox').selectOption({label:'桌面验收'});await row.getByRole('button',{name:'应用',exact:true}).click();await expect(row.locator('.mouse-binding__name span')).toHaveText('桌面验收');
  await row.getByRole('button',{name:'恢复默认',exact:true}).click();await expect(row.locator('.mouse-binding__name span')).toHaveText('后退');
  await app.page.getByRole('tab',{name:'宏',exact:true}).click();await app.page.getByRole('button',{name:'删除宏',exact:true}).click();await expect(app.page.getByRole('button',{name:'桌面验收',exact:true})).toHaveCount(0);
});

test('mouse controls use the native module and replacement leaves both other devices running',async()=>{
  await until(async()=>(await app.request('devices.get',{deviceId:'mouse'})).phase==='connected');
  const peers=await Promise.all(['speaker','keyboard'].map(deviceId=>app.request('devices.get',{deviceId})));
  await app.page.getByRole('button',{name:'返回总览'}).click();
  await app.page.getByRole('button',{name:'鼠标设置',exact:true}).click();
  await app.page.getByRole('tab',{name:'灵敏度',exact:true}).click();await app.page.getByRole('radio',{name:'800',exact:true}).click();
  await until(async()=>(await app.request('devices.read',{deviceId:'mouse',capability:'mouse.dpiStage'})).value==='1');
  await app.page.getByRole('combobox',{name:'回报率',exact:true}).selectOption('500');
  await until(async()=>(await app.request('devices.read',{deviceId:'mouse',capability:'mouse.reportRate'})).value===500);
  await app.page.getByRole('radio',{name:'板载配置',exact:true}).click();
  await expect(app.page.getByRole('radio',{name:'800',exact:true})).toBeDisabled();
  await app.page.getByRole('combobox',{name:'板载配置',exact:true}).selectOption('PROFILE_2');
  await until(async()=>(await app.request('devices.read',{deviceId:'mouse',capability:'mouse.profile'})).value==='PROFILE_2');
  await app.page.getByRole('radio',{name:'软件控制',exact:true}).click();
  await expect(app.page.getByRole('radio',{name:'800',exact:true})).toBeChecked();
  const before=await app.request('devices.get',{deviceId:'mouse'});
  const replacement=(await app.request('modules.list')).find((p:any)=>p.manifest.id==='logitech-ghub');
  await app.request('devices.replace',{deviceId:'mouse',packagePath:replacement.packagePath});
  const after=await app.request('devices.get',{deviceId:'mouse'});
  expect(after.processId).not.toBe(before.processId);expect(after.phase).toBe('connected');
  await until(()=>!alive(before.processId));
  await expect(app.page.getByRole('radio',{name:'1600',exact:true})).toBeChecked();
  for(const peer of peers){
    const current=await app.request('devices.get',{deviceId:peer.id});
    expect(current.processId).toBe(peer.processId);expect(current.values).toEqual(peer.values);
  }
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
  await app.page.getByRole('button',{name:'返回总览'}).click();
  await app.page.getByRole('button',{name:'设备与应用'}).click();
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
