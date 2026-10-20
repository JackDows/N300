import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const url=process.env.DESKHUB_VISUAL_URL??'http://127.0.0.1:1421';
const profile=path.resolve('../../.local/visual-runtime');
const output=path.resolve('../../artifacts/visual');
await mkdir(output,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{
  channel:'msedge',headless:false,viewport:null,chromiumSandbox:true,
  args:[`--app=${url}/visual.html`,'--window-size=1440,900','--no-first-run'],
  ignoreDefaultArgs:['--enable-automation'],
});
let page=context.pages().find(page=>page.url().includes('/visual.html'))??context.pages()[0];
if(!page.url().includes('/visual.html'))await page.goto(`${url}/visual.html`);
await page.waitForFunction(()=>window.__studio?.state.ready||document.querySelector('.studio-loading')?.textContent.includes('无法启用'),{},{timeout:60000});
const ready=await page.evaluate(()=>!!window.__studio?.state.ready);
if(!ready){console.error('DeskHub could not start hardware rendering. See the preview window.');await context.waitForEvent('close',{timeout:0});process.exit(1);}
const gpu=await page.evaluate(()=>{
  const gl=document.querySelector('canvas').getContext('webgl2');
  const ext=gl.getExtension('WEBGL_debug_renderer_info');
  return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),dpr:devicePixelRatio,size:[innerWidth,innerHeight]};
});
if(/swiftshader|llvmpipe|software|basic render/i.test(gpu.renderer)){
  await writeFile(path.join(output,'performance.json'),JSON.stringify({gpu,error:'Software rendering'},null,2));
  console.error(JSON.stringify({gpu,error:'Hardware acceleration is required for this preview'}));
}else if(process.argv.includes('--benchmark')){
  const timings=await page.evaluate(async()=>{
    const runs=[];
    const transition=async(id,open)=>{
      const times=[];let last=performance.now();
      if(open)window.__studio.open(id);else window.__studio.close();
      const target=open?'focused':'desk';
      while(window.__studio.state.phase!==target){await new Promise(resolve=>requestAnimationFrame(now=>{times.push(now-last);last=now;resolve();}));}
      return times;
    };
    for(let round=0;round<2;round++)for(const id of ['keyboard','mouse','computer']){
      const opening=await transition(id,true),closing=await transition(id,false);runs.push({round,id,opening,closing});
    }
    return runs;
  });
  const summary=timings.map(run=>{const values=[...run.opening,...run.closing].filter(v=>v>0).sort((a,b)=>a-b);return{round:run.round,device:run.id,frames:values.length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1)};});
  await writeFile(path.join(output,'performance.json'),JSON.stringify({gpu,summary,timings},null,2));
  console.log(JSON.stringify({gpu,summary}));
}else console.log(JSON.stringify({gpu,url}));
console.log('DeskHub preview is open. Close its window to end this process.');
await context.waitForEvent('close',{timeout:0});
