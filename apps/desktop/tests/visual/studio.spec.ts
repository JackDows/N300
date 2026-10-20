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
    await page.setViewportSize(size);await focused(page,'keyboard');
    const p=await page.evaluate(()=>window.__studio.projectKey(72));await page.mouse.click(p.x,p.y);
    const panel=page.getByRole('region',{name:'按键设置'});await expect(panel).toBeVisible();
    const box=await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(size.width);
    expect(box!.y).toBeGreaterThan(50);expect(box!.y+box!.height).toBeLessThan(size.height);
    expect(box!.y+box!.height).toBeLessThan(p.y-12);
    await page.getByRole('button',{name:'返回桌面',exact:true}).click();
    await page.waitForFunction(()=>window.__studio.state.phase==='desk');
  }
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
