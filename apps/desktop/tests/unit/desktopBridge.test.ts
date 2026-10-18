import {describe,it,expect} from 'vitest';
import {createDesktopClient} from '../../../../contracts/desktop.mjs';
describe('desktop SDK bridge',()=>{
  it('delivers backend events and structured errors through the same transport',async()=>{
    let emit:(event:any)=>void=()=>{};let released=false;
    const client=await createDesktopClient({listen:async(_name,callback)=>{emit=callback;return()=>{released=true;};},invoke:async(_command,{request}:any)=>({jsonrpc:'2.0',id:request.id,error:{data:{code:'signature_invalid',message:'Bad signature',userMessage:'文件校验失败。',details:{}}}})});
    const events:any[]=[];client.subscribe(e=>events.push(e));emit({payload:{jsonrpc:'2.0',method:'updates.changed',params:{job:{id:'job',state:'ready'}}}});
    expect(events[0].job.state).toBe('ready');await expect(client.request('app.updates.check')).rejects.toMatchObject({code:'signature_invalid',message:'文件校验失败。'});
    client.close();expect(released).toBe(true);
  });
});
