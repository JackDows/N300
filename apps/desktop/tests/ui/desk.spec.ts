import {test,expect,type Page} from '@playwright/test';
import {APP_VERSION,MOCK_UPDATE_VERSION} from '../../../../contracts/version.mjs';
const openSpeaker=async(page:Page)=>page.getByRole('button',{name:'音响设置',exact:true}).click();
const back=async(page:Page)=>page.getByRole('button',{name:'返回总览',exact:true}).click();

test('workspace navigation preserves an unsaved key edit and accessible controls',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'键盘设置',exact:true}).click();const key=page.getByRole('button',{name:'按键 F12',exact:true});await expect(key).toBeEnabled();await key.click();await page.getByLabel('目标按键',{exact:true}).selectOption('104');
 await openSpeaker(page);await expect(page.getByRole('heading',{name:/N300/})).toBeVisible();await page.getByRole('button',{name:'重命名',exact:true}).click();await page.getByLabel('音箱名称',{exact:true}).fill('未保存名称');await page.keyboard.press('Escape');await expect(page.getByLabel('音箱名称',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'键盘设置',exact:true}).click();await expect(page.getByLabel('目标按键',{exact:true})).toHaveValue('104');await expect(page.getByRole('button',{name:'保存按键',exact:true})).toBeEnabled();await expect(page.getByRole('dialog')).toHaveCount(0);await key.focus();await page.keyboard.press('ArrowLeft');await expect(page.getByRole('button',{name:'按键 F11',exact:true})).toBeFocused();
});

test('speaker commits volume once and retains source, EQ and settings across pages',async({page})=>{
 await page.goto('/?view=speaker');const volume=page.getByRole('slider',{name:'音量',exact:true});await expect(volume).toHaveAttribute('aria-valuenow','8');await volume.focus();await page.keyboard.press('ArrowUp');await expect(volume).toHaveAttribute('aria-valuenow','9');await back(page);await openSpeaker(page);await expect(volume).toHaveAttribute('aria-valuenow','9');
 await page.getByRole('radio',{name:'蓝牙',exact:true}).click();await expect(page.getByRole('radiogroup',{name:'输入源'})).not.toHaveAttribute('aria-busy','true');await page.getByRole('radio',{name:'音乐',exact:true}).click();await expect(page.getByRole('slider',{name:'100 Hz 增益'})).toHaveCount(0);await page.getByRole('button',{name:'自定义调节'}).click();const eq=page.getByRole('slider',{name:'100 Hz 增益'});await eq.focus();await page.keyboard.press('ArrowUp');await expect(eq).toHaveAttribute('aria-valuenow','1');await page.getByRole('button',{name:'重置',exact:true}).click();await expect(eq).toHaveAttribute('aria-valuenow','0');await back(page);await openSpeaker(page);await expect(volume).toHaveAttribute('aria-valuenow','9');await expect(page.getByRole('radio',{name:'蓝牙',exact:true})).toBeChecked();
});

test('keyboard backlight and offline values retain truthful state',async({page})=>{
 await page.goto('/?view=keyboard');await page.getByRole('tab',{name:'灯光',exact:true}).click();await page.getByRole('radio',{name:'柔和',exact:true}).click();await expect(page.getByRole('radio',{name:'柔和',exact:true})).toBeChecked();await expect(page.getByRole('radio',{name:'柔和',exact:true})).toBeEnabled();await page.getByRole('radio',{name:'柔和',exact:true}).focus();await page.keyboard.press('Home');await expect(page.getByRole('radio',{name:'关闭',exact:true})).toBeChecked();await page.getByRole('button',{name:'设备与应用',exact:true}).click();await page.getByRole('button',{name:'断开 OG98'}).click();await page.getByRole('button',{name:'打开 OG98 设置'}).click();await page.getByRole('tab',{name:'灯光',exact:true}).click();await expect(page.getByRole('radio',{name:'最亮',exact:true})).toBeDisabled();await expect(page.getByLabel('当前键盘状态')).not.toContainText('正常');await page.getByRole('button',{name:'连接键盘'}).click();await expect(page.getByRole('radio',{name:'关闭',exact:true})).toBeEnabled();
});

test('app update and independent module installation complete through the UI',async({page})=>{
 await page.goto('/?view=system');await expect(page.getByText(`当前版本 ${APP_VERSION}`)).toBeVisible();await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载并更新',exact:true}).click();await expect(page.getByText(`当前版本 ${MOCK_UPDATE_VERSION}`)).toBeVisible();await expect(page.getByText('已是最新版本',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'检查模块更新',exact:true}).click();const module=page.locator('.module-row').filter({has:page.getByRole('heading',{name:'OG98 键盘',exact:true})});await expect(module.getByRole('button',{name:'下载更新',exact:true})).toBeVisible();await module.getByRole('button',{name:'下载更新',exact:true}).click();await module.getByRole('button',{name:'安装并应用',exact:true}).click();await expect(module.getByText('安装完成',{exact:true})).toBeVisible();
});

test('an installed module can be applied to a device still using its earlier version',async({page})=>{
 await page.goto('/?view=system');
 const version=await page.evaluate(async()=>{
  // Exercise the separate download/install flow, with no device activation.
  const transportUrl=performance.getEntriesByType('resource').map(e=>e.name).find(name=>new URL(name).pathname==='/src/device/transport.ts');
  if(!transportUrl)throw new Error('Application transport did not load');
  const {getTransport}=await import(transportUrl);const c=await getTransport();
  const catalog=await c.request('modules.checkUpdates');const version=catalog.releases.find((r:any)=>r.release.moduleId==='flesports-og98').release.version;
  const job=await c.request('modules.download',{moduleId:'flesports-og98',version});
  while((await c.request('updates.get',{jobId:job.id})).state!=='ready')await new Promise(r=>setTimeout(r,30));
  await c.request('modules.install',{jobId:job.id});
  while((await c.request('updates.get',{jobId:job.id})).state!=='completed')await new Promise(r=>setTimeout(r,30));
  return version;
 });
 const module=page.locator('.module-row').filter({has:page.getByRole('heading',{name:'OG98 键盘',exact:true})});
 await module.getByRole('button',{name:'应用已安装版本',exact:true}).click();
 await expect(module.getByText(`当前设备使用 ${version}`,{exact:true})).toBeVisible();
 await expect(module.getByRole('button',{name:'应用已安装版本',exact:true})).toHaveCount(0);
});

test('mouse sensitivity, onboard profiles and disconnected state are independent',async({page})=>{
 await page.goto('/?view=mouse');await expect(page.getByRole('heading',{name:'PRO X SUPERLIGHT 2 SE',exact:true})).toBeVisible();await expect(page.getByRole('radio',{name:'1600',exact:true})).toBeChecked();await page.getByRole('radio',{name:'800',exact:true}).click();await expect(page.locator('.mouse-dpi strong')).toHaveText('800');await page.getByRole('combobox',{name:'回报率',exact:true}).selectOption('500');await expect(page.getByRole('combobox',{name:'回报率',exact:true})).toHaveValue('500');await page.getByRole('radio',{name:'板载配置',exact:true}).click();await expect(page.getByRole('radio',{name:'800',exact:true})).toBeDisabled();await page.getByRole('combobox',{name:'板载配置',exact:true}).selectOption('PROFILE_2');await page.getByRole('radio',{name:'软件控制',exact:true}).click();await expect(page.locator('.mouse-dpi strong')).toHaveText('800');await openSpeaker(page);await expect(page.getByRole('slider',{name:'音量',exact:true})).toHaveAttribute('aria-valuenow','8');await page.getByRole('button',{name:'设备与应用',exact:true}).click();await page.getByRole('button',{name:'断开 PRO X SUPERLIGHT 2 SE'}).click();await page.getByRole('button',{name:'鼠标设置',exact:true}).click();await expect(page.locator('.mouse-dpi strong')).toHaveText('—');await expect(page.getByRole('combobox',{name:'回报率',exact:true})).toBeDisabled();
});

for(const [width,height] of [[960,680],[1360,900],[1920,1080],[375,812]]){
 test(`workspace remains reachable at ${width}x${height}`,async({page})=>{await page.setViewportSize({width,height});for(const view of ['overview','keyboard','speaker','mouse','computer','system']){await page.goto('/?view='+view);await expect(page.locator('.workbench-main h1')).toBeVisible();expect(await page.locator('.workbench-main').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);if(view!=='overview')await expect(page.getByRole('button',{name:'返回总览',exact:true})).toBeInViewport();if(view==='keyboard'){await expect(page.getByRole('button',{name:'按键 F12',exact:true})).toBeEnabled();await page.getByLabel('目标按键',{exact:true}).selectOption('104');await page.getByRole('button',{name:'保存按键',exact:true}).click();await expect(page.getByText('当前：F13',{exact:true})).toBeVisible();}if(view==='speaker'){await page.getByRole('button',{name:'音箱偏好设置'}).click();await page.getByText('睡眠定时',{exact:true}).click();await page.getByRole('radio',{name:'60′',exact:true}).click();await expect(page.getByRole('radio',{name:'60′',exact:true})).toBeChecked();}}});
}
