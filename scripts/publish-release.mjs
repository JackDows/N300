import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {root,config,digest,sign,verifySignature} from './signing.mjs';
const kind=process.argv[2];
if(!['app','modules'].includes(kind))throw new Error('Usage: node scripts/publish-release.mjs app|modules [--publish]');
const publish=process.argv.includes('--publish');
function git(args,input){const r=spawnSync('git',args,{cwd:root,input,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});if(r.status!==0)throw new Error('Git verification/credential lookup failed');return r.stdout.trim();}
if(git(['status','--porcelain']).length)throw new Error('Commit and push the reviewed source before publishing');
const head=git(['rev-parse','HEAD']),remote=git(['ls-remote','origin','refs/heads/main']).split(/\s+/)[0];
if(head!==remote)throw new Error('GitHub main must match the release source commit');
let token=process.env.GH_TOKEN??process.env.GITHUB_TOKEN;
if(!token)token=git(['-c','credential.interactive=false','credential','fill'],'protocol=https\nhost=github.com\n\n').match(/^password=(.+)$/m)?.[1];
if(!token)throw new Error('A GitHub publishing credential is required');
const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'DeskHub-release'};
async function api(path,method='GET',body){
  const response=await fetch(`https://api.github.com/repos/${config.repository}${path}`,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.status===404&&method==='GET')return null;
  if(!response.ok)throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
  return response.status===204?null:response.json();
}
async function upload(release,name,bytes,replace){
  const existing=release.assets?.find(a=>a.name===name);
  if(existing){if(!replace)throw new Error(`Asset already published: ${name}`);await api(`/releases/assets/${existing.id}`,'DELETE');}
  const url=new URL(release.upload_url.split('{')[0]);if(url.origin!=='https://uploads.github.com')throw new Error('Unexpected GitHub upload endpoint');url.searchParams.set('name',name);
  const result=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes});if(!result.ok)throw new Error(`Upload failed: ${name} HTTP ${result.status}`);
}
async function immutable(tag,name,files){
  let release=await api('/releases/tags/'+encodeURIComponent(tag));
  if(release&&!release.draft){
    // Independent module releases may already exist when only a peer module changes.
    for(const [filename,bytes]of files){
      const asset=release.assets.find(a=>a.name===filename);if(!asset)throw new Error(`Published release is missing ${filename}`);
      const response=await fetch(asset.browser_download_url);if(!response.ok)throw new Error(`Cannot verify ${tag}/${filename}`);
      const published=Buffer.from(await response.arrayBuffer());
      if(filename.endsWith('.sig')){verifySignature(files.find(([name])=>name===filename.slice(0,-4))[1],published.toString());}
      else if(digest(published)!==digest(bytes))throw new Error(`Published ${tag}/${filename} differs; increase the version`);
    }
    return release;
  }
  release??=await api('/releases','POST',{tag_name:tag,target_commitish:head,name,body:`DeskHub release source: ${head}`,draft:true});
  for(const [filename,bytes]of files)await upload(release,filename,bytes,true);
  if(publish)release=await api(`/releases/${release.id}`,'PATCH',{draft:false,make_latest:kind==='app'?'true':'false'});
  return release;
}
async function channel(tag,name,bytes){
  if(!publish)return;
  let release=await api('/releases/tags/'+tag);
  release??=await api('/releases','POST',{tag_name:tag,target_commitish:head,name:tag,body:'Signed update feed. Versioned packages are published separately.',draft:false,prerelease:true,make_latest:'false'});
  await upload(release,name,bytes,true);
}
if(kind==='app'){
  const version=JSON.parse(readFileSync(resolve(root,'apps/desktop/src-tauri/tauri.conf.json'),'utf8')).version;
  const dir=resolve(root,'artifacts/releases',version),filename=`DeskHub_${version}_x64-setup.exe`;
  const bytes=readFileSync(join(dir,filename)),signature=readFileSync(join(dir,filename+'.sig'),'utf8').trim(),manifest=JSON.parse(readFileSync(join(dir,'latest.json'),'utf8'));
  verifySignature(bytes,signature);
  const artifact=manifest.platforms['windows-x86_64'];
  if(manifest.version!==version||artifact.sha256!==digest(bytes)||artifact.size!==bytes.length||artifact.signature!==signature||artifact.url!==`https://github.com/${config.repository}/releases/download/v${version}/${filename}`)throw new Error('App manifest does not match the installer');
  const release=await immutable(`v${version}`,`DeskHub ${version}`,[[filename,bytes],[filename+'.sig',readFileSync(join(dir,filename+'.sig'))],['SHA256SUMS',readFileSync(join(dir,'SHA256SUMS'))]]);
  await channel('deskhub-stable','latest.json',readFileSync(join(dir,'latest.json')));
  console.log(`${publish?'Published':'Draft'}: ${release.html_url}`);
}else{
  const dir=resolve(root,'artifacts/module-releases'),selected=JSON.parse(readFileSync(join(dir,'selected.json'),'utf8'));
  let current=[];const response=await fetch(config.moduleCatalog);
  if(response.ok){const envelope=await response.json(),payload=Buffer.from(envelope.payload,'base64');verifySignature(payload,envelope.signature);current=JSON.parse(payload).modules;}
  else if(response.status!==404)throw new Error(`Cannot load existing module catalog: ${response.status}`);
  for(const entry of selected.modules){
    const filename=`${entry.moduleId}-${entry.version}-windows-x86_64.zip`,bytes=readFileSync(join(dir,filename));verifySignature(bytes,entry.artifact.signature);
    if(entry.artifact.sha256!==digest(bytes)||entry.artifact.size!==bytes.length)throw new Error('Module metadata does not match its ZIP');
    const release=await immutable(`module-${entry.moduleId}-v${entry.version}`,`${entry.name} ${entry.version}`,[[filename,bytes],[filename+'.sig',Buffer.from(entry.artifact.signature)]]);
    console.log(`${publish?'Published':'Draft'}: ${release.html_url}`);
    current=current.filter(r=>r.moduleId!==entry.moduleId||r.platform!==entry.platform);current.push(entry);
  }
  current.sort((a,b)=>a.moduleId.localeCompare(b.moduleId));
  const payload=Buffer.from(JSON.stringify({schemaVersion:1,modules:current},null,2)+'\n'),path=join(dir,'catalog.payload.json');writeFileSync(path,payload);
  const signature=sign(path);verifySignature(payload,signature);
  const catalog=Buffer.from(JSON.stringify({payload:payload.toString('base64'),signature},null,2)+'\n');writeFileSync(join(dir,'catalog.json'),catalog);
  await channel('modules-stable','catalog.json',catalog);
}
