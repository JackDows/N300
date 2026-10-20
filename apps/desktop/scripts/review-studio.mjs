import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const output=path.resolve('../../artifacts/visual/studio-v1/review');
const url=process.env.DESKHUB_VISUAL_URL??'http://127.0.0.1:1420';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1.5});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
try {
  await page.goto(`${url}/visual.html`);
  await page.waitForFunction(()=>window.__studio?.state.ready,{},{timeout:60000});
  await page.screenshot({path:path.join(output,'01-desktop.png')});
  await page.evaluate(()=>window.__studio.open('keyboard'));
  await page.waitForFunction(()=>window.__studio.state.phase==='focused');
  await page.screenshot({path:path.join(output,'02-keyboard.png')});
  const slot=72;
  const key=await page.evaluate(s=>window.__studio.projectKey(s),slot);
  await page.mouse.click(key.x,key.y);
  await page.getByLabel('预览按键功能').selectOption('F13');
  await page.waitForTimeout(220);
  await page.screenshot({path:path.join(output,'03-keyboard-selected.png')});
  await page.evaluate(()=>window.__studio.close());
  await page.waitForFunction(()=>window.__studio.state.phase==='desk');
  await page.evaluate(()=>window.__studio.open('computer'));
  await page.waitForFunction(()=>window.__studio.state.phase==='focused');
  await page.screenshot({path:path.join(output,'04-case.png')});
  const cpu=await page.evaluate(()=>window.__studio.projectPart('cpu'));
  await page.mouse.click(cpu.x,cpu.y);
  await page.waitForTimeout(220);
  await page.screenshot({path:path.join(output,'05-cpu.png')});
  await page.evaluate(()=>window.__studio.close());await page.waitForFunction(()=>window.__studio.state.phase==='desk');
  await page.evaluate(()=>window.__studio.open('mouse'));await page.waitForFunction(()=>window.__studio.state.phase==='focused');
  await page.screenshot({path:path.join(output,'06-mouse.png')});
  const audit=await page.evaluate(()=>window.__studio.audit());
  for(const [label,width,height,dpr] of [['minimum',960,640,1.25],['narrow',375,812,2],['desktop-200',1280,800,2]]){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
    const check=await context.newPage();await check.goto(`${url}/visual.html`);await check.waitForFunction(()=>window.__studio?.state.ready);
    await check.evaluate(()=>window.__studio.open('keyboard'));await check.waitForFunction(()=>window.__studio.state.phase==='focused');
    await check.evaluate(()=>window.__studio.selectKey(72));await check.waitForTimeout(220);
    await check.screenshot({path:path.join(output,`check-${label}.png`)});await context.close();
  }
  await writeFile(path.join(output,'audit.json'),JSON.stringify({url,errors,state:audit.state,gpu:audit.gpu,keys:audit.keys,modelBytes:audit.modelBytes,devicePixelRatio:audit.devicePixelRatio},null,2));
  console.log(JSON.stringify({errors,state:audit.state,keys:audit.keys,modelBytes:audit.modelBytes,output}));
} finally {await browser.close();}
