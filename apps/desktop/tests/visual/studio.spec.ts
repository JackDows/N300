import {test,expect,chromium,type Page} from '@playwright/test';

const ready=async(page:Page)=>{await page.goto('/visual.html');await page.waitForFunction(()=>window.__studio?.state.ready);};
const focused=async(page:Page,id:string)=>{await page.evaluate(id=>window.__studio.open(id),id);await page.waitForFunction(()=>window.__studio.state.phase==='focused');};

test('each actual key is picked independently; unselected keys stay visually unchanged',async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await ready(page);
  const deskKey=await page.evaluate(()=>window.__studio.projectDevice('keyboard'));
  await page.mouse.move(deskKey.x,deskKey.y);
  await expect.poll(()=>page.evaluate(()=>window.__studio.state.hover)).toBe('keyboard');
  await page.mouse.click(deskKey.x,deskKey.y);
  await page.waitForFunction(()=>window.__studio.state.phase==='focused');
  const initial=await page.evaluate(()=>window.__studio.audit());
  expect(initial.keys).toBe(99);
  const neighbours=await page.evaluate(()=>[0,60,63].map(s=>window.__studio.projectKey(s)));
  const captures=[];
  for(const p of neighbours)captures.push(await page.screenshot({clip:{x:Math.round(p.x)-14,y:Math.round(p.y)-14,width:28,height:28}}));
  const f12=await page.evaluate(()=>window.__studio.projectKey(72));
  await page.mouse.click(f12.x,f12.y);
  await expect(page.getByRole('region',{name:'按键设置'})).toBeVisible();
  for(let i=0;i<neighbours.length;i++){
    const p=neighbours[i];
    const after=await page.screenshot({clip:{x:Math.round(p.x)-14,y:Math.round(p.y)-14,width:28,height:28}});
    const maxDelta=await page.evaluate(async({before,after})=>{
      const decode=async(data:string)=>{const image=await createImageBitmap(await(await fetch(`data:image/png;base64,${data}`)).blob());const canvas=new OffscreenCanvas(image.width,image.height);const context=canvas.getContext('2d')!;context.drawImage(image,0,0);return context.getImageData(0,0,image.width,image.height).data;};
      const a=await decode(before),b=await decode(after);let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));return max;
    },{before:captures[i].toString('base64'),after:after.toString('base64')});
    if(maxDelta>1){await testInfo.attach(`key-${i}-before`,{body:captures[i],contentType:'image/png'});await testInfo.attach(`key-${i}-after`,{body:after,contentType:'image/png'});}
    // Half-float lighting and MSAA can round a few channels by one 8-bit unit.
    expect(maxDelta,`Unselected key index ${i} changed`).toBeLessThanOrEqual(1);
  }
  for(const key of initial.materials){
    const p=await page.evaluate(slot=>window.__studio.projectKey(slot),key.slot);
    await page.mouse.click(p.x,p.y);
    await expect.poll(()=>page.evaluate(()=>window.__studio.state.selection?.slot)).toBe(key.slot);
  }
  const after=await page.evaluate(()=>window.__studio.audit());
  expect(after.materials.map(k=>k.geometry)).toEqual(initial.materials.map(k=>k.geometry));
  await page.mouse.click(40,400);
  await page.waitForFunction(()=>window.__studio.state.phase==='desk');
  const frames=await page.evaluate(()=>window.__studio.audit().frames);
  await page.waitForTimeout(200);
  expect(await page.evaluate(()=>window.__studio.audit().frames)).toBe(frames);
  expect(errors).toEqual([]);
});

test('case opens continuously; visible parts pick correctly; blank area closes',async({page})=>{
  await ready(page);await focused(page,'computer');
  for(const id of ['cpu','gpu','memory','storage','network']){
    const p=await page.evaluate(id=>window.__studio.projectPart(id),id);
    expect(p).not.toBeNull();
    await page.mouse.click(p.x,p.y);
    await expect.poll(()=>page.evaluate(()=>window.__studio.state.selection?.id)).toBe(id);
    await expect(page.getByRole('region',{name:'部件信息'})).toBeVisible();
  }
  await page.mouse.click(1400,700);
  await page.waitForFunction(()=>window.__studio.state.phase==='desk');
  await page.evaluate(()=>{window.__studio.open('computer');setTimeout(()=>window.__studio.close(),100);setTimeout(()=>window.__studio.open('computer'),200);});
  await page.waitForFunction(()=>window.__studio.state.phase==='focused');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.__studio.state.phase==='desk');
});

test('controls stay reachable at desktop minimum and narrow preview sizes',async({page})=>{
  await ready(page);
  for(const size of [{width:1280,height:800},{width:960,height:640},{width:375,height:812}]){
    await page.evaluate(()=>window.__studio.open('keyboard'));
    await page.setViewportSize(size);
    await page.waitForFunction(()=>window.__studio.state.phase==='focused');
    const p=await page.evaluate(()=>window.__studio.projectKey(72));await page.mouse.click(p.x,p.y);
    await expect.poll(()=>page.evaluate(()=>window.__studio.state.selection?.slot)).toBe(72);
    const panel=page.getByRole('region',{name:'按键设置'});await expect(panel).toBeVisible();
    const box=await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(size.width);
    expect(box!.y).toBeGreaterThan(50);expect(box!.y+box!.height).toBeLessThan(size.height);
    const separated=box!.x>p.x+12||box!.x+box!.width<p.x-12||box!.y+box!.height<p.y-12;
    expect(separated,`Inspector overlaps at ${size.width}×${size.height}: ${JSON.stringify({key:p,panel:box})}`).toBe(true);
    await page.getByRole('button',{name:'返回桌面',exact:true}).click();
    await page.waitForFunction(()=>window.__studio.state.phase==='desk');
  }
});

test('key inspector keeps a pending assignment separate and can restore the original key',async({page})=>{
  await ready(page);await focused(page,'keyboard');
  await expect(page.getByRole('region',{name:'按键设置'})).toContainText('选择一个按键');
  const key=await page.evaluate(()=>window.__studio.projectKey(72));await page.mouse.click(key.x,key.y);
  const field=page.getByLabel('预览按键功能');
  await field.selectOption('F13');
  await expect(page.locator('.studio-key-summary strong')).toHaveText('F12');
  await page.getByRole('button',{name:'应用到预览',exact:true}).click();
  await expect(page.locator('.studio-key-summary strong')).toHaveText('F13');
  await page.getByRole('button',{name:'恢复原键',exact:true}).click();
  await expect(field).toHaveValue('F12');
  await expect(page.locator('.studio-key-summary strong')).toHaveText('F13');
  await page.getByRole('button',{name:'应用到预览',exact:true}).click();
  await expect(page.locator('.studio-key-summary strong')).toHaveText('F12');
});

test('software WebGL is refused before expensive scene loading',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--use-angle=swiftshader-webgl']});
  try{
    const page=await browser.newPage();const models:string[]=[];
    page.on('request',request=>{if(request.url().includes('.glb'))models.push(request.url());});
    await page.goto(`${process.env.DESKHUB_VISUAL_URL??'http://127.0.0.1:1420'}/visual.html`);
    await expect(page.getByRole('status')).toHaveText('无法启用图形加速，请使用独立预览入口打开。');
    expect(models).toEqual([]);
    expect(await page.evaluate(()=>!!window.__studio)).toBe(false);
  }finally{await browser.close();}
});

test('mouse keeps white side buttons and a forward-facing wheel in both poses',async({page})=>{
  await ready(page);
  const home=await page.evaluate(()=>({wheel:window.__studio.projectMouseFeature('wheel'),rear:window.__studio.projectMouseFeature('mark'),appearance:window.__studio.mouseAppearance()}));
  expect(home.wheel.y).toBeLessThan(home.rear.y);
  expect(home.appearance.body).toBe('d9dcd5');
  expect(home.appearance.sideButtons).toEqual([home.appearance.body,home.appearance.body]);
  await focused(page,'mouse');
  const front=await page.evaluate(()=>({wheel:window.__studio.projectMouseFeature('wheel'),rear:window.__studio.projectMouseFeature('mark'),side:window.__studio.projectMouseFeature('side.button.0')}));
  expect(front.wheel.y).toBeLessThan(front.rear.y);
  expect(front.side.x).toBeLessThan(front.wheel.x);
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__studio.state.phase==='desk');
  expect(await page.evaluate(()=>window.__studio.projectMouseFeature('wheel'))).toEqual(home.wheel);
});

test('hover settles smoothly and the clicked speaker is the one that rises',async({page})=>{
  await ready(page);
  const base=await page.evaluate(()=>window.__studio.devicePose('mouse').position[1]);
  const p=await page.evaluate(()=>window.__studio.projectDevice('mouse'));
  await page.mouse.move(p.x,p.y);await page.waitForTimeout(240);
  const lifted=await page.evaluate(()=>window.__studio.devicePose('mouse').position[1]);expect(lifted-base).toBeGreaterThan(.008);
  await page.mouse.move(40,400);
  const leaving=await page.evaluate(()=>window.__studio.devicePose('mouse').position[1]);expect(leaving-base).toBeGreaterThan(.004);
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>window.__studio.devicePose('mouse').position[1])).toBeCloseTo(base,7);
  const left=await page.evaluate(()=>window.__studio.projectDevice('speaker',0));
  await page.mouse.move(left.x,left.y);await page.waitForTimeout(240);
  const right=await page.evaluate(()=>window.__studio.projectDevice('speaker',1));
  await page.mouse.move(right.x,right.y);await page.waitForTimeout(300);
  const speakers=await page.evaluate(()=>[window.__studio.devicePose('speaker',0),window.__studio.devicePose('speaker',1)]);
  expect(speakers[1].position[1]-speakers[0].position[1]).toBeCloseTo(.009,6);
  await page.mouse.click(right.x,right.y);await page.waitForFunction(()=>window.__studio.state.phase==='focused');
  expect(await page.evaluate(()=>window.__studio.devicePose('speaker',1).scale[0])).toBeGreaterThan(1);
  expect(await page.evaluate(()=>window.__studio.devicePose('speaker',0).scale[0])).toBe(1);
  await page.mouse.click(40,400);await page.waitForFunction(()=>window.__studio.state.phase==='desk');
});
