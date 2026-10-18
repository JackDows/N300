import { DeskHubError } from './client.mjs';

/** Browser-only UI simulator. Native process/package checks are tested through node.mjs. */
export function createMockClient(seed, { latencyMs = 20 } = {}) {
  const original = structuredClone(seed);
  const devices = new Map(original.map((device) => [device.id, structuredClone(device)]));
  const listeners = new Set(), queues = new Map();
  let closed = false, nextId = 0;
  const fail = (code, userMessage) => { throw new DeskHubError({ code, userMessage, message: code }); };
  const emit = (event) => { for (const listener of listeners) listener(structuredClone(event)); };
  const publish = (device) => { device.revision++; emit({ type:'devices.changed', device }); return structuredClone(device); };
  const get = (id) => devices.get(id) ?? fail('device_not_found','这个设备尚未添加。');
  async function execute(method, params, requestId) {
    if (closed) fail('transport_closed','模拟器已经关闭。');
    if (method === 'hub.describe') return { name:'DeskHub',version:'0.1.0',protocolVersion:1,offline:true,dataDirectory:'browser-memory',maxFrameBytes:65536,methods:[] };
    if (method === 'devices.list') return structuredClone([...devices.values()]);
    if (method === 'modules.list') return original.map((device) => ({ manifest:{id:device.moduleId,name:device.label,version:device.moduleVersion,protocolVersion:1,executable:'browser-mock',files:{}},packagePath:`mock://${device.moduleId}`,fingerprint:'mock' }));
    if (method === 'devices.add') {
      if (devices.has(params.id)) fail('duplicate_device','这个设备名称已经被使用。');
      const template = original.find((d) => d.moduleId === params.moduleId) ?? fail('module_selection_required','模拟器中没有这个设备模块。');
      const device = {...structuredClone(template),id:params.id,label:params.label??params.id,generation:0,revision:0,phase:'stopped',values:{},target:params.target??{},bindingTarget:params.target??{}};
      devices.set(params.id,device); return publish(device);
    }
    const device = get(params.deviceId);
    const baseline = () => structuredClone(original.find((d) => d.moduleId === device.moduleId));
    if (method === 'devices.get') return structuredClone(device);
    if (method === 'devices.remove') { devices.delete(device.id); emit({type:'devices.removed',deviceId:device.id}); return {removed:true}; }
    if (method === 'devices.rename') { device.label=params.label; return publish(device); }
    if (method === 'devices.stop' || method === 'devices.disconnect') {
      device.generation++; device.phase=method==='devices.stop'?'stopped':'disconnected'; device.values={}; device.error=null; device.valueState='unknown'; return publish(device);
    }
    if (method === 'devices.start') { if(device.phase==='stopped'){device.generation++;device.phase='disconnected';} return publish(device); }
    if (method === 'devices.restart') { device.generation+=2; device.values=baseline().values; device.phase='connected'; device.error=null; device.valueState='confirmed'; return publish(device); }
    if (method === 'devices.rebind') {
      const template=original.find((d)=>d.moduleId===params.moduleId)??fail('module_selection_required','模拟器中没有这个设备模块。');
      Object.assign(device,{moduleId:template.moduleId,moduleVersion:template.moduleVersion,capabilities:structuredClone(template.capabilities),values:structuredClone(template.values),bindingTarget:params.target,target:params.target,phase:'connected',generation:device.generation+1});
      return publish(device);
    }
    if (method === 'devices.connect') {
      if(device.phase==='stopped')device.generation++;
      device.phase='connected'; device.error=null; device.valueState='confirmed'; device.values=baseline().values; return publish(device);
    }
    if(method==='devices.scan')return [{label:device.label,modelVerified:device.moduleId!=='flesports-og98',target:{resourceId:`mock:${device.id}`}}];
    if(method==='devices.refresh'){device.valueState='confirmed';device.error=null;return publish(device);}
    if(!['devices.read','devices.write'].includes(method))fail('unsupported_mock_operation','这项操作请连接原生离线后端测试。');
    if(device.phase!=='connected')fail('not_connected','请先连接设备。');
    const capability=device.capabilities.find((c)=>c.id===params.capability);
    if(!capability?.[method==='devices.read'?'read':'write'])fail('unsupported_capability','此设备暂不支持这项操作。');
    const generation=device.generation;
    emit({type:'operations.changed',deviceId:device.id,generation,requestId,state:'pending',operation:method==='devices.read'?'capability.read':'capability.write'});
    try {
      await new Promise((resolve)=>setTimeout(resolve,latencyMs));
      if(closed)fail('transport_closed','模拟器已经关闭。');
      if(device.generation!==generation)fail('stale_session','设备连接已更新，请重新读取状态。');
      const reading=device.values[params.capability];
      if(!reading)fail('unavailable','暂时没有这项设置的数据。');
      if(method==='devices.write'){
        const value=params.value;
        if(capability.valueType==='integer'&&(!Number.isInteger(value)||(reading.min!==undefined&&value<reading.min)||(reading.max!==undefined&&value>reading.max)))fail('invalid_argument','设置值不在允许的范围内。');
        if(capability.valueType==='boolean'&&typeof value!=='boolean')fail('invalid_argument','参数格式不正确。');
        if(reading.choices&&!reading.choices.some((choice)=>choice.value===value))fail('invalid_argument','请选择设备支持的选项。');
        reading.value=structuredClone(value);
        if(params.capability==='lighting.brightness'&&device.values['lighting.state'])device.values['lighting.state'].value.brightness=value;
        publish(device);
      }
      emit({type:'operations.changed',deviceId:device.id,generation,requestId,state:'completed'});
      return structuredClone(reading);
    } catch(error){emit({type:'operations.changed',deviceId:device.id,generation,requestId,state:'failed',error:{code:error.code,userMessage:error.message,message:error.technicalMessage,details:error.details}});throw error;}
  }
  return {
    request(method,params={}){
      const id=++nextId;
      if(!['devices.read','devices.write','devices.refresh'].includes(method))return execute(method,params,id);
      const previous=queues.get(params.deviceId)??Promise.resolve();
      const next=previous.catch(()=>{}).then(()=>execute(method,params,id));
      queues.set(params.deviceId,next); return next;
    },
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    close(){closed=true;listeners.clear();},
    simulate(deviceId,phase){
      const device=get(deviceId); device.generation++;device.phase=phase;
      device.values=phase==='connected'?baselineFor(device).values:{};device.valueState=phase==='connected'?'confirmed':'unknown';return publish(device);
    },
  };
  function baselineFor(device){return structuredClone(original.find((d)=>d.moduleId===device.moduleId));}
}
