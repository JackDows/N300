// Explicit real-device acceptance. Never included in the normal offline Test workflow.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {startModule} from './module-client.mjs';
const args=process.argv.slice(2),targetArg=args.find(a=>a.startsWith('--targets='));
if(!args.includes('--write-and-restore'))throw new Error('Explicit --write-and-restore is required.');
const config=process.env.DESKHUB_CONFIGURATION??'Release',root=resolve('.'),directory=join(root,'artifacts/validation',`hardware-controls-${Date.now()}`);
await mkdir(directory,{recursive:true});const results={configuration:config,started:new Date().toISOString(),checks:[]};
const targets=targetArg?JSON.parse(await readFile(targetArg.slice(10),'utf8')).devices:[];
const check=(name,details={})=>{results.checks.push({name,...details});console.log(name);};
async function open(id,target={}){
  const manifest=JSON.parse(await readFile(join(root,'modules',id,'module.json'),'utf8'));
  const module=startModule(join(root,'artifacts/package',config,'modules',id,manifest.version,manifest.executable));
  await module.client.request('session.initialize',{offline:false,target,diagnosticPath:join(directory,`${id}.jsonl`)});
  return module;
}
try{
  if(!args.includes('--mouse-only')){
    const target=targets.find(d=>d.moduleId==='flesports-og98')?.target;if(!target)throw new Error('Pass --targets=path with the selected OG98 binding.');
    const m=await open('flesports-og98',target),c=m.client;
    try{
      await c.request('device.connect');
      for(const [layer,capability]of [['normal','keyboard.keymap'],['fn','keyboard.fnKeymap']]){
        const before=(await c.request('capability.read',{capability})).value,key=before.keys.find(k=>k.label==='F12');
        await writeFile(join(directory,`keyboard-${layer}-before.json`),JSON.stringify(before,null,2));
        try{
          const start=performance.now(),written=await c.request('capability.invoke',{capability:'keyboard.keymap.set',arguments:{layer,slot:key.slot,profile:before.profile,action:{type:'key',modifier:0,key:104,second:0}}});
          assert.equal(written.verified,true);assert.deepEqual(written.after.raw,[0,0,104,0]);check(`keyboard ${layer}: F12 → F13`,{elapsedMs:Math.round(performance.now()-start)});
        }finally{
          const restored=await c.request('capability.invoke',{capability:'keyboard.keymap.set',arguments:{layer,slot:key.slot,profile:before.profile,action:{type:'restore',raw:key.binding.raw}}});assert.equal(restored.verified,true);
          assert.deepEqual((await c.request('capability.read',{capability})).value.matrix,before.matrix);check(`keyboard ${layer}: full matrix restored`);
        }
      }
    }finally{await m.close();}
  }
  if(!args.includes('--keyboard-only')){
    const m=await open('logitech-ghub'),c=m.client;let saved,side,view,originalMode;
    const invoke=(capability,arguments_={})=>c.request('capability.invoke',{capability,arguments:arguments_});
    try{
      const connected=await c.request('device.connect');assert.equal(connected.phase,'connected');
      originalMode=(await c.request('capability.read',{capability:'device.onboardMode'})).value;
      if(originalMode)await c.request('capability.write',{capability:'device.onboardMode',value:false});
      view=(await c.request('capability.read',{capability:'mouse.bindings'})).value;assert.equal(view.softwareMode,true);
      side=view.buttons.find(b=>b.number===4&&!b.shifted);assert.ok(side);
      await writeFile(join(directory,'mouse-bindings-before.json'),JSON.stringify(view,null,2));
      saved=await invoke('macros.save',{profileId:view.profileId,macro:{name:`DeskHub 验证 ${Date.now()}`,mode:'once',steps:[{type:'key',code:115,down:true,label:'F24'},{type:'delay',ms:20},{type:'key',code:115,down:false,label:'F24'}]}});
      assert.equal(saved.verified,true);check('mouse: macro saved and read back');
      const bound=await invoke('mouse.bindings.set',{profileId:view.profileId,slotId:side.slotId,cardId:saved.id});assert.equal(bound.verified,true);
      const after=(await c.request('capability.read',{capability:'mouse.bindings'})).value;assert.equal(after.buttons.find(b=>b.slotId===side.slotId).card.id,saved.id);check('mouse: side button binding confirmed');
      assert.deepEqual(after.buttons.filter(b=>b.slotId!==side.slotId),view.buttons.filter(b=>b.slotId!==side.slotId));check('mouse: other button bindings preserved');
    }finally{
      try{
        if(saved&&side){await invoke('mouse.bindings.set',{profileId:view.profileId,slotId:side.slotId,cardId:side.card.id});
          assert.deepEqual((await c.request('capability.read',{capability:'mouse.bindings'})).value.buttons,view.buttons);check('mouse: all button bindings restored');
          await invoke('macros.remove',{profileId:view.profileId,id:saved.id});await assert.rejects(invoke('macros.get',{id:saved.id}));check('mouse: temporary macro removed');}
      }finally{try{if(originalMode){await c.request('capability.write',{capability:'device.onboardMode',value:true});assert.equal((await c.request('capability.read',{capability:'device.onboardMode'})).value,true);check('mouse: original onboard mode restored');}}finally{await m.close();}}
    }
  }
  results.passed=true;
}catch(error){results.passed=false;results.error={message:error.message,code:error.code};throw error;}
finally{await writeFile(join(directory,'result.json'),JSON.stringify(results,null,2));console.log(directory);}
