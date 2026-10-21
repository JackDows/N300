// Explicitly invoked prototype verification. No automatic cleanup or background services.
import { chromium } from '../../apps/desktop/node_modules/playwright-core/index.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const dir=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({channel:'msedge',headless:true});
const report={viewport:{width:1440,height:1000},errors:[],pages:[],interactions:[],overflow:[]};
await fs.mkdir(path.join(dir,'previews'),{recursive:true});
const page=await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
const go=async(style,view)=>{await page.goto(pathToFileURL(path.join(dir,'index.html')).href+`?style=${style}&view=${view}`);await page.locator('main h1').waitFor();await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);await page.waitForTimeout(160);};
try{
for(const style of ['industrial','graphic','future']){
 for(const view of ['overview','keyboard','macros','specs']){
  await go(style,view);
  await page.screenshot({path:path.join(dir,'previews',`${style}-${view}.png`)});
  report.pages.push({style,view,keyCount:await page.locator('.key-grid .key').count()});
 }
 await go(style,'keyboard');
 await page.getByRole('button',{name:'保存按键',exact:true}).click();
 if(!await page.getByRole('button',{name:'保存按键',exact:true}).isDisabled())throw Error('Save state did not settle');
 await page.getByRole('button',{name:'F11',exact:true}).click();
 await page.getByRole('button',{name:'Shift',exact:true}).last().click();
 await page.locator('#target-key').selectOption('C');
 await page.getByRole('button',{name:'保存按键',exact:true}).click();
 if(!await page.locator('.key-identity').textContent().then(t=>t.includes('Shift + C')))throw Error('Key binding not persisted');
 await page.getByRole('button',{name:'预览离线状态'}).click();
 if(!await page.locator('.inline-notice').isVisible())throw Error('Offline state absent');
 if(!await page.getByRole('switch',{name:'锁定 Win 键',exact:true}).isDisabled())throw Error('Offline instant control not disabled');
 await page.getByRole('button',{name:'恢复连接'}).click();
 await page.locator('[data-layer="fn"]').click();
 if(await page.locator('.key-grid .key').count()!==99)throw Error('Layout keys lost');
 await page.locator('[data-style="graphic"]').click();
 if(!await page.locator('[data-layer="fn"]').getAttribute('class').then(s=>s.includes('active')))throw Error('Theme reset interaction');
 report.interactions.push(style+': key binding/save/layer/offline/theme persistence passed');
 await go(style,'macros');
 await page.locator('#step-delay').fill('120');
 await page.locator('#step-delay').dispatchEvent('change');
 if(!await page.locator('.step-row.selected').textContent().then(t=>t.includes('120 ms')))throw Error('Macro delay not updated');
 await page.getByRole('button',{name:'下移',exact:true}).click();
 await page.getByRole('button',{name:'保存宏',exact:true}).click();
 await page.getByRole('button',{name:'新建宏',exact:true}).click();
 if(!await page.locator('.empty-sequence').isVisible())throw Error('Empty state absent');
 await page.getByRole('button',{name:'开始录制',exact:true}).click();
 await page.keyboard.press('Control+c');
 await page.getByRole('button',{name:'停止录制',exact:true}).click();
 if(await page.locator('.step-row').count()<4)throw Error('Recorder did not capture balanced shortcut');
 await page.getByRole('button',{name:'保存宏',exact:true}).click();
 report.interactions.push(style+': macro edit/reorder/empty/record/save passed');
 await go(style,'overview');
 if(style==='industrial'){
  await page.getByRole('slider',{name:'音量旋钮'}).focus();
  await page.keyboard.press('ArrowRight');
  if(await page.getByRole('slider',{name:'音量旋钮'}).getAttribute('aria-valuenow')!=='11')throw Error('Dial keyboard control failed');
  await page.getByRole('button',{name:'亮度 50%',exact:true}).click();
 }else if(style==='graphic'){
  await page.locator('#editorial-brightness').focus();
  await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 }else{
  await page.getByRole('button',{name:'音量 6',exact:true}).click();
  if(await page.locator('[data-readout="volume"]').textContent()!=='6')throw Error('Segmented volume control failed');
  await page.getByRole('button',{name:'亮度 50%',exact:true}).click();
 }
 await page.locator('[data-dpi="1600"]').click();
 if(await page.locator('[data-readout="dpi"]').textContent()!=='1600')throw Error('DPI selection failed');
 report.interactions.push(style+': independent overview controls passed');
 await go(style,'specs');
 await page.locator('#sample-input').focus();
 await page.screenshot({path:path.join(dir,'previews',`${style}-focus.png`)});
 for(const width of [1280,960,375]){
  await page.setViewportSize({width,height:900});
  for(const view of ['overview','keyboard','macros','specs']){
   await go(style,view);
   const metrics=await page.evaluate(()=>({w:innerWidth,body:document.documentElement.scrollWidth,app:document.querySelector('.app').scrollWidth}));
   if(metrics.body>width+1)report.overflow.push({style,view,width,...metrics});
   if(width===375&&view==='keyboard')await page.screenshot({path:path.join(dir,'previews',`${style}-mobile.png`),fullPage:true});
  }
 }
 await page.setViewportSize(report.viewport);
}
await go('future','keyboard');
await page.locator('#grayscale').check();
await page.screenshot({path:path.join(dir,'previews','future-grayscale.png')});
const tokens=JSON.parse(await fs.readFile(path.join(dir,'design-tokens.json'),'utf8'));
const pairs=[];
for(const style of ['industrial','graphic','future']){
 await go(style,'specs');
 const samples=await page.evaluate(()=>{
  const cs=getComputedStyle(document.querySelector('.app'));
  const names=['bg','panel','raised','well','text','secondary','muted','accent','on-accent'];
  const vals={};for(const name of names)vals[name]=cs.getPropertyValue('--'+name).trim();
  return vals;
 });
 for(const bg of ['bg','panel','raised','well'])for(const fg of ['text','secondary','muted'])pairs.push({name:`${style}/${fg}/${bg}`,fg:samples[fg],bg:samples[bg]});
 pairs.push({name:`${style}/primary`,fg:samples['on-accent'],bg:samples.accent});
}
pairs.push({name:'industrial/secondary/hover',fg:'#dbdbdb',bg:'#555555'});
pairs.push({name:'graphic/active-hover',fg:'#dbdbdb',bg:'#404040'});
pairs.push({name:'graphic/keyboard-label',fg:'#555555',bg:'#dbdbdb'});
tokens.pairs=pairs;
await fs.writeFile(path.join(dir,'design-tokens.json'),JSON.stringify(tokens,null,2));
await page.goto(pathToFileURL(path.join(dir,'compare.html')).href);
await page.locator('img').first().waitFor();
await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
await page.screenshot({path:path.join(dir,'previews','comparison.png'),fullPage:true});
await page.getByRole('button',{name:'键盘',exact:true}).click();
if(!await page.locator('img').first().getAttribute('src').then(s=>s.includes('keyboard')))throw Error('Comparison page navigation failed');
await page.locator('.preview').first().click();
await page.locator('.key-grid').waitFor();
report.interactions.push('comparison page: view switch and entry link passed');
if(report.errors.length||report.overflow.length)throw Error(JSON.stringify({errors:report.errors,overflow:report.overflow}));
report.result='passed';
}catch(e){report.result='failed';report.failure=String(e);process.exitCode=1;}
finally{await fs.writeFile(path.join(dir,'review-results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
