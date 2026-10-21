import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {zipSync} from 'fflate';
import {root,config,digest,sign,verifySignature} from './signing.mjs';
const mode=process.argv[2],args=process.argv.slice(3);
const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const notes=readFileSync(resolve(root,'packaging/release-notes.md'),'utf8').trim();
if(mode==='app'){
  const version=option('--version')??JSON.parse(readFileSync(resolve(root,'apps/desktop/src-tauri/tauri.conf.json'),'utf8')).version;
  const directory=resolve(root,'artifacts/releases',version),filename=`DeskHub_${version}_x64-setup.exe`;
  const bytes=readFileSync(join(directory,filename)),signature=readFileSync(join(directory,filename+'.sig'),'utf8').trim();
  verifySignature(bytes,signature);
  const artifact={url:`https://github.com/${config.repository}/releases/download/v${version}/${filename}`,signature,sha256:digest(bytes),size:bytes.length};
  const manifest={version,notes,pub_date:new Date().toISOString(),platforms:{'windows-x86_64':artifact}};
  writeFileSync(join(directory,'latest.json'),JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(join(directory,'SHA256SUMS'),`${artifact.sha256}  ${filename}\n`);
  console.log(`Signed DeskHub ${version} release ready: ${directory}`);
}else if(mode==='modules'){
  const selected=args.flatMap((value,index)=>value==='--module'?[args[index+1]]:[]);
  if(selected.some(id=>!id||! /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)))throw new Error('Each --module requires a module ID');
  const ids=readdirSync(resolve(root,'modules'),{withFileTypes:true}).filter(d=>d.isDirectory()&&existsSync(resolve(root,'modules',d.name,'module.json'))&&(!selected.length||selected.includes(d.name))).map(d=>d.name);
  if(selected.some(id=>!ids.includes(id)))throw new Error('Unknown selected module');
  if(!ids.length)throw new Error('No matching module');
  const directory=resolve(root,'artifacts/module-releases');mkdirSync(directory,{recursive:true});
  const modules=[];
  for(const id of ids){
    const source=JSON.parse(readFileSync(resolve(root,'modules',id,'module.json'),'utf8'));
    const packageRoot=resolve(root,'artifacts/package/Release/modules',id,source.version);
    const manifestBytes=readFileSync(join(packageRoot,'module.json')),manifest=JSON.parse(manifestBytes);
    const files={'module.json':new Uint8Array(manifestBytes)};
    for(const [name,hash]of Object.entries(manifest.files)){
      const bytes=readFileSync(join(packageRoot,name));if(digest(bytes)!==hash)throw new Error(`Package checksum mismatch: ${id}/${name}`);
      files[name.replaceAll('\\','/')]=new Uint8Array(bytes);
    }
    const filename=`${id}-${source.version}-windows-x86_64.zip`,path=join(directory,filename);
    const bytes=zipSync(files,{level:6,mtime:new Date(1980,0,1)});writeFileSync(path,bytes);
    const signature=sign(path);verifySignature(bytes,signature);
    modules.push({moduleId:id,name:source.name,version:source.version,minimumHubVersion:'0.3.0',protocolVersion:1,platform:'windows-x86_64',notes,
      artifact:{url:`https://github.com/${config.repository}/releases/download/module-${id}-v${source.version}/${filename}`,signature,sha256:digest(bytes),size:bytes.length}});
  }
  writeFileSync(join(directory,'selected.json'),JSON.stringify({schemaVersion:1,modules},null,2)+'\n');
  console.log(`Signed module packages ready: ${directory}`);
}else throw new Error('Usage: node scripts/package-release.mjs app [--version V] | modules [--module ID]');
