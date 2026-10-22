import {test,expect} from '@playwright/test';

test('Fn assignments include firmware functions and change only after saving',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').map(e=>e.name).find(n=>new URL(n).pathname==='/src/device/transport.ts')!;
    const c=await (await import(url)).getTransport();
    const {value:map}=await c.request('devices.read',{deviceId:'keyboard',capability:'keyboard.fnKeymap'});
    // Seed only the isolated browser simulator: a normal key, media, macro and firmware action.
    const assigned:Record<string,number[]>={F1:[0,0,58,0],F2:[3,0,233,0],F3:[9,0,1,0],F4:[13,6,0,0]};
    for(const key of map.keys)await c.request('devices.invoke',{deviceId:'keyboard',capability:'keyboard.keymap.set',arguments:{layer:'fn',slot:key.slot,action:{type:'restore',raw:assigned[key.label]??[0,0,0,0]}}});
    const request=c.request.bind(c),w=window as any;w.keyWrites=[];
    c.request=async(method:string,params:any={})=>{
      if(['devices.invoke','devices.write'].includes(method)&&params.deviceId==='keyboard')w.keyWrites.push(params);
      const result=await request(method,params);
      if(method==='devices.read'&&params.capability==='keyboard.fnKeymap')await new Promise<void>(resolve=>w.releaseFn=resolve);
      return result;
    };
  });
  await page.getByRole('button',{name:'键盘设置',exact:true}).click();
  await expect(page.getByRole('button',{name:'按键 F12',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Fn 层',exact:true}).click();
  await expect(page.getByRole('button',{name:'读取中…',exact:true})).toBeVisible();
  await expect(page.locator('.model-key.is-assigned')).toHaveCount(0);
  await page.waitForFunction(()=>typeof (window as any).releaseFn==='function');
  await page.evaluate(()=>(window as any).releaseFn());
  await expect(page.locator('.model-key.is-assigned')).toHaveCount(4);
  for(const label of ['F1','F2','F3','F4'])await expect(page.getByRole('button',{name:`按键 ${label}`,exact:true})).toHaveAttribute('aria-description','Fn 层已设置功能');
  await expect(page.getByText('已设置 4 键',{exact:true})).toBeVisible();
  const key=page.getByRole('button',{name:'按键 A',exact:true});await key.click();
  await expect(key).toHaveAttribute('aria-pressed','true');await expect(key).toHaveAttribute('aria-description','Fn 层未设置功能');
  await page.getByLabel('按键功能',{exact:true}).selectOption('key');
  await expect(key).not.toHaveClass(/is-assigned/);
  expect(await page.evaluate(()=>(window as any).keyWrites.length)).toBe(0);
  await page.getByRole('button',{name:'保存按键',exact:true}).click();
  await expect(key).toHaveClass(/is-assigned/);await expect(page.getByText('已设置 5 键',{exact:true})).toBeVisible();
  await page.getByLabel('按键功能',{exact:true}).selectOption('disabled');
  await expect(key).toHaveClass(/is-assigned/);
  await page.getByRole('button',{name:'保存按键',exact:true}).click();
  await expect(key).not.toHaveClass(/is-assigned/);await expect(page.getByText('已设置 4 键',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'普通层',exact:true}).click();await expect(page.locator('.model-key.is-assigned')).toHaveCount(0);
  await page.getByRole('button',{name:'Fn 层',exact:true}).click();await expect(page.locator('.model-key.is-assigned')).toHaveCount(4);
  await page.getByRole('button',{name:'设备与应用',exact:true}).click();await page.getByRole('button',{name:'断开 OG98'}).click();
  await page.getByRole('button',{name:'键盘设置',exact:true}).click();await expect(page.locator('.model-key.is-assigned')).toHaveCount(0);
});

test('layer switching caches reads, preserves drafts and never writes automatically',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').map(e=>e.name).find(n=>new URL(n).pathname==='/src/device/transport.ts')!;
    const c=await (await import(url)).getTransport(),request=c.request.bind(c),w=window as any;
    w.keyRequests=[];w.holdFn=true;
    c.request=async(method:string,params:any={})=>{
      if(params.capability?.startsWith('keyboard.'))w.keyRequests.push({method,capability:params.capability});
      const result=structuredClone(await request(method,params));
      if(method==='devices.read'&&params.capability==='keyboard.fnKeymap'&&w.holdFn)await new Promise<void>(resolve=>w.releaseFn=()=>{w.holdFn=false;resolve();});
      return result;
    };
  });
  await page.getByRole('button',{name:'键盘设置',exact:true}).click();
  const key=page.getByRole('button',{name:'按键 F12',exact:true});await expect(key).toBeEnabled();await key.click();
  await page.getByLabel('目标按键',{exact:true}).selectOption('104');
  await page.getByRole('button',{name:'Fn 层',exact:true}).click();
  await expect(page.getByRole('button',{name:'读取中…',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'普通层',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'普通层',exact:true}).click();
  await expect(key).toBeEnabled();await expect(page.getByLabel('目标按键',{exact:true})).toHaveValue('104');
  await expect(page.getByRole('button',{name:'保存中…',exact:true})).toHaveCount(0);
  await page.evaluate(()=>(window as any).releaseFn());
  for(let i=0;i<3;i++)for(const label of ['Fn 层','普通层']){
    await page.getByRole('button',{name:label,exact:true}).click();await expect(key).toBeEnabled();
  }
  await expect(page.getByLabel('目标按键',{exact:true})).toHaveValue('104');
  const calls=await page.evaluate(()=>(window as any).keyRequests);
  expect(calls.filter((r:any)=>r.method==='devices.read'&&r.capability==='keyboard.keymap')).toHaveLength(1);
  expect(calls.filter((r:any)=>r.method==='devices.read'&&r.capability==='keyboard.fnKeymap')).toHaveLength(1);
  expect(calls.filter((r:any)=>['devices.write','devices.invoke'].includes(r.method))).toEqual([]);
});

test('explicit keymap refresh shows reading and stale reads cannot replace a new session',async({page})=>{
  await page.goto('/?view=keyboard');const key=page.getByRole('button',{name:'按键 F12',exact:true});await expect(key).toBeEnabled();
  await page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').map(e=>e.name).find(n=>new URL(n).pathname==='/src/device/transport.ts')!;
    const c=await (await import(url)).getTransport(),request=c.request.bind(c),w=window as any;
    w.testClient=c;w.deferOnce=true;
    c.request=async(method:string,params:any={})=>{
      const result=structuredClone(await request(method,params));
      if(method==='devices.read'&&params.capability==='keyboard.keymap'&&w.deferOnce){
        w.deferOnce=false;result.value.keys.find((k:any)=>k.label==='F12').binding={type:'key',raw:[0,0,104,0],modifier:0,key:104,second:0};
        await new Promise<void>(resolve=>w.releaseOldRead=resolve);
      }
      return result;
    };
  });
  await page.getByRole('button',{name:'同步键位',exact:true}).click();
  await expect(page.getByRole('button',{name:'读取中…',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存按键',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存中…',exact:true})).toHaveCount(0);
  await page.waitForFunction(()=>typeof (window as any).releaseOldRead==='function');
  await page.evaluate(async()=>{const w=window as any;await w.testClient.request('devices.restart',{deviceId:'keyboard'});await w.testClient.request('devices.connect',{deviceId:'keyboard'});});
  await expect(key).toBeEnabled();await expect(page.getByText('当前：F12',{exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).releaseOldRead());
  await expect(page.getByText('当前：F13',{exact:true})).toHaveCount(0);
  await expect(page.getByText('当前：F12',{exact:true})).toBeVisible();
});

test('keyboard edits both layers, restores one key and retains settings after reopening',async({page})=>{
  await page.goto('/?view=keyboard');
  const key=page.getByRole('button',{name:'按键 F12',exact:true});await expect(key).toBeEnabled();await key.click();
  await page.getByLabel('目标按键',{exact:true}).selectOption('104');await page.getByRole('button',{name:'保存按键',exact:true}).click();
  await expect(page.getByText('当前：F13',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回总览'}).click();await page.getByRole('button',{name:'键盘设置',exact:true}).click();await key.click();await expect(page.getByText('当前：F13',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'恢复原键',exact:true}).click();await expect(page.getByText('当前：F12',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Fn 层',exact:true}).click();await expect(key).toBeEnabled();
  const previous=await page.locator('.key-detail__identity>span').innerText();
  await page.getByLabel('按键功能',{exact:true}).selectOption('media');await page.getByLabel('媒体功能',{exact:true}).selectOption('205');await page.getByRole('button',{name:'保存按键',exact:true}).click();
  await expect(page.getByText('当前：播放 / 暂停',{exact:true})).toBeVisible();await page.getByRole('button',{name:'撤销本次修改',exact:true}).click();await expect(page.locator('.key-detail__identity span')).toHaveText(previous);
  await page.getByRole('checkbox',{name:'锁定 Win 键'}).click();await expect(page.getByRole('checkbox',{name:'锁定 Win 键'})).toBeChecked();
});

test('macro recording, editing, binding and removal complete through the UI',async({page})=>{
  await page.goto('/?view=mouse');await page.getByRole('tab',{name:'宏',exact:true}).click();
  await expect(page.getByRole('button',{name:'录制键盘',exact:true})).toBeEnabled();
  await page.getByLabel('宏名称',{exact:true}).fill('测试复制');await page.getByRole('button',{name:'录制键盘',exact:true}).click();
  await page.keyboard.press('Control+c');await page.keyboard.press('Escape');
  await expect(page.locator('.macro-editor')).toBeVisible();await expect(page.getByRole('button',{name:'录制键盘',exact:true})).toBeEnabled();await expect(page.getByLabel('宏动作',{exact:true})).toContainText('C · 松开');
  await page.getByRole('button',{name:'保存宏',exact:true}).click();await expect(page.getByText('宏已保存，可在按键页绑定使用。',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'按键',exact:true}).click();const row=page.locator('.mouse-binding').filter({has:page.getByText('后退侧键',{exact:true})});
  await row.getByRole('combobox').selectOption({label:'测试复制'});await row.getByRole('button',{name:'应用',exact:true}).click();await expect(row.locator('.mouse-binding__name span')).toHaveText('测试复制');
  await page.getByRole('tab',{name:'宏',exact:true}).click();await page.getByRole('button',{name:'删除宏',exact:true}).click();await expect(page.getByText('这个宏仍被按键使用，请先解除绑定。',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'按键',exact:true}).click();await row.getByRole('button',{name:'恢复默认',exact:true}).click();await expect(row.locator('.mouse-binding__name span')).toHaveText('后退');
  await page.getByRole('tab',{name:'宏',exact:true}).click();await page.getByRole('button',{name:'删除宏',exact:true}).click();await expect(page.getByRole('button',{name:'测试复制',exact:true})).toHaveCount(0);
});
