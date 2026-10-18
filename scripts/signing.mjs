import { createHash, createPublicKey, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export const root=resolve(import.meta.dirname,'..');
export const config=JSON.parse(readFileSync(resolve(root,'distribution.json'),'utf8'));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifySignature(bytes,encodedSignature,encodedKey=config.publicKey){
  const keyLines=Buffer.from(encodedKey.trim(),'base64').toString('utf8').trim().split(/\r?\n/);
  const lines=Buffer.from(encodedSignature.trim(),'base64').toString('utf8').trim().split(/\r?\n/);
  if(lines.length!==4||!lines[2].startsWith('trusted comment: ')||keyLines.length!==2)throw new Error('Malformed Minisign signature/key');
  const key=Buffer.from(keyLines[1],'base64'),signature=Buffer.from(lines[1],'base64');
  if(key.length!==42||signature.length!==74||!key.subarray(2,10).equals(signature.subarray(2,10)))throw new Error('Signing key mismatch');
  const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key.subarray(10)]),format:'der',type:'spki'});
  if(signature.subarray(0,2).toString()!=='ED')throw new Error('Only prehashed Minisign signatures are accepted');
  const message=createHash('blake2b512').update(bytes).digest();
  if(!verify(null,message,publicKey,signature.subarray(10))||!verify(null,Buffer.concat([signature.subarray(10),Buffer.from(lines[2].slice(17))]),publicKey,Buffer.from(lines[3],'base64')))throw new Error('Signature verification failed');
}
export function sign(path,{keyPath,appVersion}={}){
  const configuredPath=process.env.TAURI_SIGNING_PRIVATE_KEY_PATH??(existsSync(process.env.TAURI_SIGNING_PRIVATE_KEY??'')?process.env.TAURI_SIGNING_PRIVATE_KEY:undefined);
  const key=keyPath??configuredPath??resolve(root,'.local/keys/deskhub-updater.key');
  const args=[resolve(root,'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign'];
  if(existsSync(key))args.push('--private-key-path',key);
  else if(!process.env.TAURI_SIGNING_PRIVATE_KEY)throw new Error('A release signing key is required');
  if(appVersion)args.push('--app-version',appVersion);
  args.push(path);
  const env={...process.env,TAURI_SIGNING_PRIVATE_KEY_PASSWORD:keyPath?'':process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD??''};
  if(existsSync(key)){delete env.TAURI_SIGNING_PRIVATE_KEY;delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;}
  const result=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,env});
  if(result.status!==0)throw new Error(`Signing failed (exit ${result.status}); verify the signing key/password`);
  return readFileSync(path+'.sig','utf8').trim();
}
