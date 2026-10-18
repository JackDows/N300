import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { zipSync } from 'fflate';
import { root,config,digest,sign,verifySignature } from '../scripts/signing.mjs';

export async function updateFixtures(directory){
  mkdirSync(directory,{recursive:true});
  const keyPath=join(directory,'fixture-only.key');
  const generated=spawnSync(process.execPath,[resolve(root,'node_modules/@tauri-apps/cli/tauri.js'),'signer','generate','--ci','--password','','--write-keys',keyPath],{encoding:'utf8',windowsHide:true});
  if(generated.status!==0)throw new Error('Cannot generate temporary test signing key');
  const publicKey=readFileSync(keyPath+'.pub','utf8').trim(),files=new Map();
  let mode='normal',catalog,origin;
  const server=createServer((request,response)=>{
    if(request.url==='/catalog.json'){
      if(mode==='catalog-error'){response.writeHead(503).end('Unavailable');return;}
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify(catalog));return;
    }
    const bytes=files.get(request.url);
    if(!bytes){response.writeHead(404).end();return;}
    response.writeHead(200,{'Content-Length':bytes.length,'Content-Type':'application/octet-stream'});response.flushHeaders();
    if(mode==='stall')return;
    if(mode==='cut'){response.write(bytes.subarray(0,Math.max(1,bytes.length>>1)));setTimeout(()=>response.destroy(),30);return;}
    if(mode==='tamper'){const bad=Buffer.from(bytes);bad[bad.length-1]^=1;response.end(bad);return;}
    response.end(bytes);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}`;
  const updateConfig=join(directory,'updates.json');
  writeFileSync(updateConfig,JSON.stringify({...config,moduleCatalog:origin+'/catalog.json',appFeed:origin+'/latest.json',publicKey}));
  function artifact(filename,bytes,{appVersion}={}){
    const path=join(directory,filename);writeFileSync(path,bytes);const signature=sign(path,{keyPath,appVersion});verifySignature(bytes,signature,publicKey);
    files.set('/'+filename,Buffer.from(bytes));return {url:origin+'/'+filename,signature,sha256:digest(bytes),size:bytes.length};
  }
  function module(version,{runtimeVersion=version,failConnect=false,extra={},minimumHubVersion='0.3.0'}={}){
    const configuration=process.env.DESKHUB_CONFIGURATION??'Debug';
    const executable=readFileSync(resolve(root,'artifacts/build/backend',configuration.toLowerCase(),'deskhub-test-module.exe'));
    const identity=Buffer.from(JSON.stringify({version:runtimeVersion,capability:`test.v${runtimeVersion}`,failConnect}));
    const manifest={id:'test-device',name:'Update test module',version,protocolVersion:1,executable:'module.exe',files:{'module.exe':digest(executable),'identity.json':digest(identity)}};
    const contents={'module.exe':executable,'identity.json':identity,'module.json':Buffer.from(JSON.stringify(manifest)),...extra};
    const bytes=zipSync(contents,{level:1});
    const release={moduleId:'test-device',name:'Test module',version,minimumHubVersion,protocolVersion:1,platform:'windows-x86_64',notes:'Update acceptance fixture',artifact:artifact(`module-${version}.zip`,bytes)};
    const local=join(directory,`local-${version}`);mkdirSync(local,{recursive:true});
    for(const[name,bytes]of Object.entries(contents))if(!name.includes('/'))writeFileSync(join(local,name),bytes);
    return {release,local};
  }
  function setCatalog(releases,{badSignature=false}={}){
    const payload=Buffer.from(JSON.stringify({schemaVersion:1,modules:releases}));const path=join(directory,'catalog.payload.json');writeFileSync(path,payload);
    const signature=sign(path,{keyPath});verifySignature(payload,signature,publicKey);
    catalog={payload:payload.toString('base64'),signature};
    if(badSignature)catalog.payload=Buffer.from(JSON.stringify({schemaVersion:1,modules:[]})).toString('base64');
    return catalog;
  }
  return {directory,origin,updateConfig,keyPath,publicKey,files,module,artifact,setCatalog,setMode(value){mode=value;},async close(){server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
export async function waitJob(client,id,states=['ready','completed','failed','cancelled','interrupted'],timeout=20000){
  const until=Date.now()+timeout;let job;
  while(Date.now()<until){job=await client.request('updates.get',{jobId:id});if(states.includes(job.state))return job;await new Promise(r=>setTimeout(r,30));}
  throw new Error(`Update job timed out: ${JSON.stringify(job)}`);
}
