import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {root} from '../scripts/signing.mjs';
const {chromium}=createRequire(join(root,'apps/desktop/package.json'))('@playwright/test');
export const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
export async function until(probe,{timeout=30000,message='Condition not reached'}={}){
  const end=Date.now()+timeout;while(Date.now()<end){const value=await probe();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error(message);
}
export async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));return port;}
export async function attach(port){
  const endpoint=`http://127.0.0.1:${port}`;await until(()=>fetch(endpoint+'/json/version').then(r=>r.ok).catch(()=>false));
  const browser=await chromium.connectOverCDP(endpoint);const page=await until(()=>browser.contexts().flatMap(c=>c.pages())[0]);
  await until(()=>page.evaluate(()=>!!window.__TAURI_INTERNALS__).catch(()=>false));
  let id=0;
  const request=async(method,params={})=>{
    const response=await page.evaluate(request=>window.__TAURI_INTERNALS__.invoke('hub_request',{request}),{jsonrpc:'2.0',id:++id,method,params});
    if(response.error){const e=new Error(response.error.message);Object.assign(e,response.error.data);throw e;}return response.result;
  };
  return {browser,page,request};
}
export async function launch({executable,directory,updateConfig,port,extraEnv={}}){
  port??=await freePort();mkdirSync(directory,{recursive:true});
  const env={...process.env,DESKHUB_OFFLINE:'1',DESKHUB_DATA_DIR:join(directory,'data'),DESKHUB_UPDATE_CONFIG:updateConfig,
    DESKHUB_TEST_HIDE_WINDOW:'1',WEBVIEW2_USER_DATA_FOLDER:join(directory,'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,...extraEnv};
  const processHandle=spawn(executable,['--offline'],{env,cwd:dirname(executable),stdio:'ignore',windowsHide:true});
  const connection=await attach(port);
  return {...connection,process:processHandle,port,env,async close(){
    try{await connection.page.getByRole('button',{name:'关闭',exact:true}).click({timeout:3000});}catch{}
    await until(()=>!alive(processHandle.pid),{timeout:5000}).catch(()=>processHandle.kill());
    await connection.browser.close();
  }};
}
