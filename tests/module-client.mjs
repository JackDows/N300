import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createClient} from '../contracts/client.mjs';

export function startModule(executable, args=[]) {
  const process=spawn(executable,args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const listeners=new Set(), diagnostics=[];
  createInterface({input:process.stdout}).on('line',line=>{const value=JSON.parse(line);for(const listener of listeners)listener(value);});
  createInterface({input:process.stderr}).on('line',line=>diagnostics.push(line));
  const client=createClient({send:message=>process.stdin.write(JSON.stringify(message)+'\n'),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}});
  process.on('exit',()=>client.close());
  process.on('error',()=>client.close());
  return {client,process,diagnostics,async close(){
    if(process.exitCode===null){
      await Promise.race([client.request('module.shutdown'),new Promise((_,reject)=>{const timer=setTimeout(()=>{process.kill();reject(new Error('Module shutdown timed out'));},5000);timer.unref();})]);
      if(process.exitCode===null)await Promise.race([once(process,'exit'),new Promise((_,reject)=>{const timer=setTimeout(()=>{process.kill();reject(new Error('Module did not stop'));},5000);timer.unref();})]);
    }
    client.close();
  }};
}
