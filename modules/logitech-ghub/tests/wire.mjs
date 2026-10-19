import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {startModule} from '../../../tests/module-client.mjs';
const executable=process.env.DESKHUB_GHUB_TEST_EXE;
if(!executable)throw Error('DESKHUB_GHUB_TEST_EXE is required');
const clone=structuredClone;
async function fixture(){
  const device={id:'test-mouse',deviceSignature:'MOUSE.test.1',deviceType:'MOUSE',deviceBaseModel:'test',deviceModel:'test',displayName:'Test Mouse',state:'ACTIVE',slotPrefix:'test',connectionType:'WIRELESS',displayConnectionType:'LIGHTSPEED',fwInfo:[{firmwareVersion:'1.0'}],capabilities:{onboardProfiles:{supportsOnboardMode:true}}};
  const reference={id:'reference',readOnly:false,attribute:'MOUSE_SENSITIVITY',mouseSensitivity:{presetId:'preset',activeDpiIndex:2},preserve:'reference-field'};
  const preset={id:'preset',readOnly:false,attribute:'MOUSE_SETTINGS_ADVANCED',mouseSettings:{advancedDpiTable:{entries:{1:{dpi:800,dpiX:800,dpiY:800,lod:2},2:{dpi:1600,dpiX:1600,dpiY:1600,lod:2}},defaultIndex:2,shiftIndex:1,advancedEnabled:false},reportRate:{value:1000,wirelessRate:1000},correctionId:'calibration'}};
  const state={devices:[device],onboard:false,slot:'PROFILE_1',cards:{reference,preset},requests:[],stall:false,deny:false,fragment:false};
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  server.on('connection',socket=>socket.on('message',bytes=>{
    const q=JSON.parse(bytes);state.requests.push(q);if(state.stall)return;
    let payload={},code='SUCCESS';const id=q.path.split('/')[2],onboardBase='/onboard_profiles/test-mouse';
    if(q.verb==='GET'){
      if(q.path==='/devices/list')payload={deviceInfos:state.devices};
      else if(q.path===onboardBase+'/onboard_mode')payload={enabled:state.onboard};
      else if(q.path===onboardBase+'/active_profile')payload={onboardSlotId:state.slot};
      else if(q.path===onboardBase+'/profiles')payload={directoryEntries:['PROFILE_1','PROFILE_2'].map(slot=>({onboardSlotId:slot,enabled:true,name:slot,mouseSettings:state.cards.preset.mouseSettings}))};
      else if(q.path==='/profile/active')payload={id:'active'};
      else if(q.path==='/profile')payload={id:'active',name:'Active profile',assignments:[{slotId:'test_mouse_sensitivity',cardId:'reference'}]};
      else if(q.path==='/card')payload=state.cards[q.payload.id];
      else if(q.path==='/report_rate/test-mouse/report_rate_list')payload={rates:[125,500,1000],wirelessRates:[500,1000,2000]};
      else if(q.path==='/battery/test-mouse/state')payload={percentage:73,charging:false};
      else code='NO_SUCH_PATH';
    } else if(q.verb==='SET'){
      if(state.deny)code='INVALID_ARG';
      else if(q.path==='/card'){state.cards[q.payload.id]=clone(q.payload);payload=state.cards[q.payload.id];}
      else if(q.path===onboardBase+'/onboard_mode'){state.onboard=q.payload.mode==='ONBOARD';payload={enabled:state.onboard};}
      else if(q.path===onboardBase+'/active_profile'){state.slot=q.payload.onboardSlotId;payload={onboardSlotId:state.slot};}
      else code='NO_SUCH_PATH';
    }else code='INVALID_VERB';
    if(q.verb==='SET'&&code==='SUCCESS')state.afterSet?.(q);
    const response=JSON.stringify({msgId:q.msgId,verb:q.verb,path:q.path,result:{code,what:code==='SUCCESS'?'':'fixture rejection'},payload});
    if(state.fragment){const mid=Math.floor(response.length/2);socket.send(response.slice(0,mid),{fin:false});socket.send(response.slice(mid));}else socket.send(response);
  }));
  const module=startModule(executable);
  await module.client.request('session.initialize',{offline:false,target:{resourceId:'ghub:mouse.test.1'},config:{port:server.address().port}});
  return {state,module,server,async close(){try{await module.close();}finally{for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));}}};
}
test('native WebSocket requests preserve settings and confirm writes',{timeout:15000},async()=>{
  const f=await fixture();try{
    f.state.fragment=true;
    const connected=await f.module.client.request('device.connect');assert.equal(connected.phase,'connected');assert.equal(connected.values['device.battery'].value.percentage,73);
    const original=clone(f.state.cards.preset);
    const dpi=await f.module.client.request('capability.write',{capability:'mouse.dpiStage',value:'1'});assert.equal(dpi.verified,true);
    assert.deepEqual(f.state.cards.preset,original);assert.equal(f.state.cards.reference.preserve,'reference-field');
    const rate=await f.module.client.request('capability.write',{capability:'mouse.reportRate',value:500});assert.equal(rate.value,500);
    assert.equal(f.state.cards.preset.mouseSettings.reportRate.value,1000);assert.equal(f.state.cards.preset.mouseSettings.correctionId,'calibration');
    assert.deepEqual(f.state.cards.preset.mouseSettings.advancedDpiTable,original.mouseSettings.advancedDpiTable);
    const writes=f.state.requests.filter(q=>q.verb==='SET').length;
    await assert.rejects(f.module.client.request('capability.write',{capability:'mouse.reportRate',value:333}),e=>e.code==='invalid_argument');
    assert.equal(f.state.requests.filter(q=>q.verb==='SET').length,writes);
  }finally{await f.close();}
});
test('board mode changes availability without rewriting other controls',{timeout:15000},async()=>{
  const f=await fixture();try{
    await f.module.client.request('device.connect');const before=clone(f.state.cards);
    await f.module.client.request('capability.write',{capability:'device.onboardMode',value:true});
    await assert.rejects(f.module.client.request('capability.write',{capability:'mouse.dpiStage',value:'1'}),e=>e.code==='setting_read_only');
    await f.module.client.request('capability.write',{capability:'mouse.profile',value:'PROFILE_2'});assert.equal(f.state.slot,'PROFILE_2');
    await f.module.client.request('capability.write',{capability:'device.onboardMode',value:false});
    assert.deepEqual(f.state.cards,before);
  }finally{await f.close();}
});
test('unplug waits, replug restores, and explicit disconnect stops reconnecting',{timeout:12000},async()=>{
  const f=await fixture();try{
    f.state.devices[0].state='NOT_CONNECTED';let view=await f.module.client.request('device.connect');assert.equal(view.phase,'waiting');assert.equal(view.values['mouse.dpiStage'],undefined);
    f.state.devices[0].state='ACTIVE';view=await f.module.client.request('device.snapshot');assert.equal(view.phase,'connected');
    f.state.devices=[];view=await f.module.client.request('device.snapshot');assert.equal(view.phase,'waiting');
    await f.module.client.request('device.disconnect');assert.equal((await f.module.client.request('device.snapshot')).phase,'disconnected');
  }finally{await f.close();}
});
test('a rejected mutation is reported and never silently replayed',{timeout:12000},async()=>{
  const f=await fixture();try{
    await f.module.client.request('device.connect');f.state.deny=true;
    await assert.rejects(f.module.client.request('capability.write',{capability:'mouse.dpiStage',value:'1'}),e=>e.code==='ghub_request_failed');
    assert.equal(f.state.requests.filter(q=>q.verb==='SET').length,1);
    assert.equal((await f.module.client.request('capability.read',{capability:'mouse.dpiStage'})).value,'2');
  }finally{await f.close();}
});
test('mode transition waits for the device without a false readback error',{timeout:12000},async()=>{
  const f=await fixture();try{
    await f.module.client.request('device.connect');
    f.state.afterSet=()=>{f.state.devices[0].state='INITIALIZING';setTimeout(()=>{f.state.devices[0].state='ACTIVE';},450);};
    const result=await f.module.client.request('capability.write',{capability:'device.onboardMode',value:true});
    assert.equal(result.value,true);assert.equal(result.verified,true);
    assert.equal(f.state.requests.filter(q=>q.verb==='SET').length,1);
  }finally{await f.close();}
});
test('unresponsive backend is bounded and shutdown cancels a blocked receive',{timeout:15000},async()=>{
  const f=await fixture();try{
    f.state.stall=true;const start=Date.now();const state=await f.module.client.request('device.connect');
    assert.equal(state.phase,'waiting');assert.equal(state.unavailable.connection.code,'ghub_timeout');assert.ok(Date.now()-start<5000);
    const pending=f.module.client.request('device.connect').catch(()=>null);await new Promise(r=>setTimeout(r,100));
    const stopping=Date.now();await f.module.close();await pending;assert.ok(Date.now()-stopping<2500);assert.equal(f.module.process.exitCode,0);
  }finally{await f.close();}
});
