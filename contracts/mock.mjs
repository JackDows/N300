import { DeskHubError } from './client.mjs';
import { APP_VERSION, MOCK_UPDATE_VERSION } from './version.mjs';
import { createMockControls } from './mock-controls.mjs';
import workstation from './fixtures/workstation.json' with {type:'json'};

/** Browser-only device simulator. Package integrity and filesystem export use the native host. */
export function createMockClient(seed, { latencyMs = 20, updateScenario = 'success' } = {}) {
  const original = structuredClone(seed);
  const devices = new Map(original.map((device) => [device.id, structuredClone(device)]));
  const sessions = new Map(original.map((device) => [device.id, structuredClone(device.values)]));
  const mouseSoftware = new Map();
  const listeners = new Set(), queues = new Map();
  let closed = false, nextId = 0;
  const jobs = new Map(), installed = new Map();
  let appVersion = APP_VERSION, lastResult = null, appChecked = false;
  const fail = (code, userMessage) => { throw new DeskHubError({ code, userMessage, message: code }); };
  const controls = createMockControls(fail);
  const emit = (event) => { for (const listener of listeners) listener(structuredClone(event)); };
  const publish = (device) => { device.revision++; emit({ type: 'devices.changed', device }); return structuredClone(device); };
  const get = (id) => devices.get(id) ?? fail('device_not_found', '这个设备尚未添加。');
  const templateFor = (id) => original.find((d) => d.moduleId === id) ?? fail('module_selection_required', '模拟器中没有这个设备模块。');
  const select = (params) => {
    const [id, version] = params.packagePath?.replace(/^mock:\/\//, '').split('/') ?? [params.moduleId];
    const template = templateFor(id);
    return version ? { ...template, moduleVersion: version } : template;
  };
  const packageFor = (device) => ({ manifest: { id: device.moduleId, name: device.label, version: device.moduleVersion, protocolVersion: 1, executable: 'browser-mock', files: {} }, packagePath: `mock://${device.moduleId}`, fingerprint: 'mock' });
  const validLabel = (label) => typeof label === 'string' && label.length > 0 && new TextEncoder().encode(label).length <= 240;
  const jobView = (job) => structuredClone(job);
  const jobGet = (id) => jobs.get(id) ?? fail('job_not_found', '找不到这次更新。');
  const jobEmit = (job) => { if (!closed) emit({type:'updates.changed',job}); return jobView(job); };
  const nextVersion = (value) => { const parts = value.split('.').map(Number); return `${parts[0]}.${parts[1]}.${parts[2]+1}`; };
  const releases = [...new Map(original.map(d=>[d.moduleId,d])).values()].map(d=>({moduleId:d.moduleId,name:d.label,version:nextVersion(d.moduleVersion),minimumHubVersion:'0.3.0',protocolVersion:1,platform:'windows-x86_64',notes:'离线模拟更新',artifact:{url:`https://example.invalid/${d.moduleId}.zip`,size:1000,sha256:'0'.repeat(64),signature:'offline-simulation'}}));
  const jobFail = (job, code) => {job.state='failed';job.error={code,message:code,userMessage:'更新未完成，请重试。',details:{}};jobEmit(job);};
  function download(kind,subject,version){
    if([...jobs.values()].some(j=>j.kind===kind&&j.subject===subject&&!['completed','failed','cancelled','interrupted'].includes(j.state)))fail('update_busy','更新操作正在进行。');
    const job={id:`mock-${++nextId}`,kind,subject,version,state:'queued',downloaded:0,total:1000,createdAtUnixMs:Date.now(),error:null,result:null};
    jobs.set(job.id,job);
    void(async()=>{
      for(const amount of [250,500,750,1000]){
        await new Promise(r=>setTimeout(r,Math.max(10,latencyMs)));
        if(closed||job.state==='cancelled')return;
        if(updateScenario==='network-error'){jobFail(job,'download_failed');return;}
        job.state='downloading';job.downloaded=amount;jobEmit(job);
      }
      job.state='verifying';jobEmit(job);
      await new Promise(r=>setTimeout(r,Math.max(10,latencyMs)));
      if(closed||job.state==='cancelled')return;
      if(updateScenario==='bad-signature'){jobFail(job,'signature_invalid');return;}
      job.state='ready';jobEmit(job);
    })();
    return jobEmit(job);
  }
  function install(job,deviceId){
    if(job.state!=='ready')fail('invalid_argument','请先完成下载。');
    const device=deviceId?get(deviceId):null;
    if(device&&device.moduleId!==job.subject)fail('invalid_argument','请选择使用该模块的设备。');
    job.state='installing';
    void(async()=>{
      await new Promise(r=>setTimeout(r,Math.max(10,latencyMs)));
      if(closed)return;
      if(updateScenario==='install-failure'){jobFail(job,'install_failed');return;}
      if(job.kind==='app'){
        appVersion=job.version;job.result={version:appVersion,restarted:true};lastResult={version:appVersion,jobId:job.id,state:'completed',cleanupPending:false};
      }else{
        const template=templateFor(job.subject),p=packageFor({...template,moduleVersion:job.version});
        p.packagePath+=`/${job.version}`;p.fingerprint=`mock-${job.subject}-${job.version}`;installed.set(p.packagePath,p);
        if(device){device.generation++;device.moduleVersion=job.version;publish(device);}
        job.result={package:p,device:device?structuredClone(device):null};
      }
      job.state='completed';jobEmit(job);
    })();
    return jobEmit(job);
  }
  function connect(device) {
    if (device.phase === 'connected') return publish(device);
    if (device.phase === 'stopped' || device.phase === 'faulted') device.generation++;
    device.values = structuredClone(sessions.get(device.id) ?? templateFor(device.moduleId).values);
    sessions.set(device.id, structuredClone(device.values));
    Object.assign(device, { phase: 'connected', error: null, valueState: 'confirmed', unavailable: {} });
    return publish(device);
  }
  function stop(device) {
    device.generation++; sessions.delete(device.id); mouseSoftware.delete(device.id); controls.reset(device.id);
    Object.assign(device, { phase: 'stopped', values: {}, error: null, valueState: 'unknown', unavailable: {} });
    return publish(device);
  }
  async function execute(method, params, requestId) {
    if (closed) fail('transport_closed', '模拟器已经关闭。');
    if (method === 'hub.describe') return { name: 'DeskHub', version: APP_VERSION, protocolVersion: 1, offline: true, dataDirectory: 'browser-memory', maxFrameBytes: 65536, methods: methods.slice(), desktop: {version:appVersion,updater:true} };
    if (method === 'devices.list') return structuredClone([...devices.values()]);
    if (method === 'modules.list') return [...new Map(original.map((d) => [d.moduleId, packageFor(d)])).values(),...installed.values()].map(p=>structuredClone(p));
    if (method === 'modules.inspect') return packageFor(select(params));
    if (method === 'diagnostics.export') fail('unsupported_mock_operation', '诊断文件导出请连接原生离线后端测试。');
    if (method === 'diagnostics.report') return {recorded:true};
    if (method === 'app.takeActivationNotice') return false;
    if (method === 'app.hardware.inspect') return structuredClone(workstation);
    if (method === 'app.mangodisk.open') return {opened:true,simulated:true};
    if (method === 'updates.list') return [...jobs.values()].map(jobView);
    if (method === 'updates.get') return jobView(jobGet(params.jobId));
    if (method === 'updates.cancel') {
      const job=jobGet(params.jobId);
      if(job.state==='installing')fail('update_busy','正在安装，请稍后。');
      if(!['completed','failed','cancelled','interrupted'].includes(job.state)){job.state='cancelled';job.error={code:'download_cancelled',message:'Cancelled',userMessage:'下载已取消。',details:{}};}
      return jobEmit(job);
    }
    if (method === 'app.updates.info') return {version:appVersion,lastResult:structuredClone(lastResult)};
    if (method === 'app.updates.check') {appChecked=true;return {currentVersion:appVersion,release:appVersion===MOCK_UPDATE_VERSION?null:{version:MOCK_UPDATE_VERSION,notes:'离线模拟整包更新'}};}
    if (method === 'app.updates.download') {if(!appChecked)fail('check_required','请先检查更新。');return download('app','deskhub',MOCK_UPDATE_VERSION);}
    if (method === 'app.updates.install') {const job=jobGet(params.jobId);if(job.kind!=='app')fail('invalid_argument','更新类型不匹配。');return install(job);}
    if (method === 'modules.catalog'||method === 'modules.checkUpdates') return {releases:releases.map(release=>({release:structuredClone(release),compatible:true,available:![...installed.values()].some(p=>p.manifest.id===release.moduleId&&p.manifest.version===release.version),installedVersions:[templateFor(release.moduleId).moduleVersion,...[...installed.values()].filter(p=>p.manifest.id===release.moduleId).map(p=>p.manifest.version)],devices:[...devices.values()].filter(d=>d.moduleId===release.moduleId).map(d=>({deviceId:d.id,version:d.moduleVersion}))}))};
    if (method === 'modules.download') {const release=releases.find(r=>r.moduleId===params.moduleId&&(!params.version||params.version===r.version));if(!release)fail('release_not_found','没有找到模块版本。');return download('module',release.moduleId,release.version);}
    if (method === 'modules.install') {const job=jobGet(params.jobId);if(job.kind!=='module')fail('invalid_argument','更新类型不匹配。');return install(job,params.deviceId);}
    if (!methods.includes(method)) fail('unknown_method', '暂不支持这项操作。');
    if (method === 'devices.add') {
      if (typeof params.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(params.id) || !validLabel(params.label ?? params.id)) fail('invalid_argument', '设备名称格式不正确。');
      if (devices.has(params.id)) fail('duplicate_device', '这个设备名称已经被使用。');
      const template = select(params);
      const device = { ...structuredClone(template), id: params.id, label: params.label ?? params.id, generation: 0, revision: 0, phase: 'stopped', values: {}, valueState: 'unknown', error: null, target: params.target ?? {}, bindingTarget: params.target ?? {} };
      devices.set(params.id, device); return publish(device);
    }
    const device = get(params.deviceId);
    if (method === 'devices.get') return structuredClone(device);
    if (method === 'devices.remove') {
      stop(device); devices.delete(device.id); queues.delete(device.id);
      emit({ type: 'devices.removed', deviceId: device.id }); return { removed: true };
    }
    if (method === 'devices.rename') { if (!validLabel(params.label)) fail('invalid_argument', '设备名称格式不正确。'); device.label = params.label; return publish(device); }
    if (method === 'devices.stop') return stop(device);
    if (method === 'devices.disconnect') {
      if (device.phase === 'stopped' || device.phase === 'faulted') fail('not_connected', '请先连接设备。');
      if (device.phase === 'connected') sessions.set(device.id, structuredClone(device.values));
      Object.assign(device, { phase: 'disconnected', values: {}, error: null, valueState: 'unknown' }); return publish(device);
    }
    if (method === 'devices.start') {
      if (device.phase === 'stopped' || device.phase === 'faulted') { device.generation++; device.phase = 'disconnected'; }
      return publish(device);
    }
    if (method === 'devices.restart') {
      const connected = device.phase === 'connected'; stop(device); device.generation++; device.phase = 'disconnected';
      return connected ? connect(device) : publish(device);
    }
    if (method === 'devices.rebind' || method === 'devices.replace') {
      const template = select(params);
      if (method === 'devices.replace' && template.moduleId !== device.moduleId) fail('invalid_argument', '更换设备类型请使用重新绑定。');
      if (method === 'devices.rebind' && (!params.target || typeof params.target !== 'object' || Array.isArray(params.target))) fail('invalid_argument', '请选择设备。');
      const connected = device.phase === 'connected'; sessions.delete(device.id); mouseSoftware.delete(device.id); controls.reset(device.id);
      Object.assign(device, { moduleId: template.moduleId, moduleVersion: template.moduleVersion, capabilities: structuredClone(template.capabilities), values: {}, error: null, unavailable: {}, valueState: 'unknown', phase: 'disconnected', generation: device.generation + 1 });
      if (method === 'devices.rebind') Object.assign(device, { bindingTarget: structuredClone(params.target), target: structuredClone(params.target) });
      return connected ? connect(device) : publish(device);
    }
    if (method === 'devices.connect') return connect(device);
    if (method === 'devices.scan') return [{ label: device.label, modelVerified: device.moduleId !== 'flesports-og98', target: { resourceId: `mock:${device.id}` } }];
    if (device.phase !== 'connected') fail('not_connected', '请先连接设备。');
    if (method === 'devices.refresh') { device.valueState = 'confirmed'; device.error = null; return publish(device); }
    const operation = method === 'devices.read' ? 'read' : method === 'devices.write' ? 'write' : 'invoke';
    const capability = device.capabilities.find((c) => c.id === params.capability);
    if (!capability?.[operation]) fail('unsupported_capability', '此设备暂不支持这项操作。');
    const generation = device.generation;
    emit({ type: 'operations.changed', deviceId: device.id, generation, requestId, state: 'pending', operation: `capability.${operation}` });
    try {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (closed) fail('transport_closed', '模拟器已经关闭。');
      if (device.generation !== generation || devices.get(device.id) !== device) fail('stale_session', '设备连接已更新，请重新读取状态。');
      let reading = device.values[params.capability];
      if (operation === 'invoke' && (params.capability === 'keyboard.keymap.set' || params.capability === 'mouse.bindings.set' || params.capability.startsWith('macros.'))) {
        reading = controls.invoke(device, params.capability, params.arguments);
      } else if (operation === 'write' && params.capability === 'keyboard.options') {
        reading = controls.options(device, params.value);
      } else if (operation === 'invoke' && params.capability === 'audio.eq.setBand') {
        const { band, gain } = params.arguments ?? {};
        reading = device.values['audio.eq'];
        if (!['customized', 'audiophile'].includes(device.values['audio.preset']?.value) || !Number.isInteger(band) || !reading?.value[band] || typeof gain !== 'number' || !Number.isFinite(gain) || gain < reading.gain_min || gain > reading.gain_max || Math.abs(gain / reading.gain_step - Math.round(gain / reading.gain_step)) > 1e-8) fail('invalid_argument', '请先选择自定义音效，再设置允许范围内的均衡器增益。');
        reading.value[band].gain_db = gain;
      } else if (operation === 'invoke' && params.capability === 'device.powerOff') {
        sessions.set(device.id, structuredClone(device.values));
        Object.assign(device, { phase: 'disconnected', values: {}, valueState: 'unknown' });
        reading = { command_sent: true, power_state: 'unverified' };
      } else {
        if (!reading) fail('unavailable', '暂时没有这项设置的数据。');
        if (operation === 'write') {
          if (reading.writable === false) fail('setting_read_only', '当前模式下不能调整此项。');
          let value = params.value;
          if (capability.valueType === 'integer' && (!Number.isInteger(value) || (reading.min !== undefined && value < reading.min) || (reading.max !== undefined && value > reading.max))) fail('invalid_argument', '设置值不在允许的范围内。');
          if (capability.valueType === 'boolean' && typeof value !== 'boolean') fail('invalid_argument', '参数格式不正确。');
          if (reading.choices) {
            const choice = reading.choices.find((choice) => choice.value === value || choice.raw === value);
            if (!choice) fail('invalid_argument', '请选择设备支持的选项。');
            value = choice.value; reading.raw = choice.raw;
          }
          if (params.capability === 'device.name') {
            if (typeof value !== 'string' || !value.trim() || value.includes('\0') || new TextEncoder().encode(value.trim()).length > (reading.maxBytes ?? 24)) fail('invalid_argument', '设备名称格式不正确。');
            value = value.trim();
          }
          const previousValue = reading.value;
          reading.value = structuredClone(value);
          if (params.capability === 'device.onboardMode' && device.moduleId === 'logitech-ghub' && previousValue !== value) {
            if (value) {
              mouseSoftware.set(device.id, {stage:structuredClone(device.values['mouse.dpiStage']),profile:structuredClone(device.values['mouse.profile'])});
              device.values['mouse.profile']={value:'PROFILE_1',label:'板载配置',writable:true,choices:[{value:'PROFILE_1',label:'配置 1'},{value:'PROFILE_2',label:'配置 2'}]};
              device.values['mouse.dpiStage'].value=templateFor(device.moduleId).values['mouse.dpiStage'].value;
              device.values['mouse.dpiStage'].label='默认 DPI';
            } else {
              const previous=mouseSoftware.get(device.id);
              device.values['mouse.profile']=structuredClone(previous?.profile??templateFor(device.moduleId).values['mouse.profile']);
              device.values['mouse.dpiStage']=structuredClone(previous?.stage??templateFor(device.moduleId).values['mouse.dpiStage']);
            }
            device.values['mouse.dpiStage'].writable=!value;
            device.values['mouse.reportRate'].writable=!value;
            if(device.values['mouse.bindings'])device.values['mouse.bindings'].value.softwareMode=!value;
          }
          if (params.capability === 'lighting.brightness') { device.values['lighting.state'].value.brightness = value; reading = { ...reading, verified: true }; }
        }
      }
      if (operation !== 'read') {
        if (device.phase === 'connected') sessions.set(device.id, structuredClone(device.values));
        publish(device);
      }
      emit({ type: 'operations.changed', deviceId: device.id, generation, requestId, state: 'completed' });
      return structuredClone(reading);
    } catch (error) {
      emit({ type: 'operations.changed', deviceId: device.id, generation, requestId, state: 'failed', error: { code: error.code, userMessage: error.message, message: error.technicalMessage, details: error.details } });
      throw error;
    }
  }
  const methods = ['hub.describe', 'modules.list', 'modules.inspect','modules.catalog','modules.checkUpdates','modules.download','modules.install','updates.list','updates.get','updates.cancel','app.updates.info','app.updates.check','app.updates.download','app.updates.install','app.takeActivationNotice','app.hardware.inspect','app.mangodisk.open', 'devices.list', 'devices.add', 'devices.get', 'devices.start', 'devices.stop', 'devices.restart', 'devices.replace', 'devices.rebind', 'devices.rename', 'devices.remove', 'devices.scan', 'devices.connect', 'devices.disconnect', 'devices.refresh', 'devices.read', 'devices.write', 'devices.invoke', 'diagnostics.export','diagnostics.report'];
  return {
    request(method, params = {}) {
      const id = ++nextId;
      if (!['devices.read', 'devices.write', 'devices.invoke', 'devices.refresh', 'devices.disconnect'].includes(method)) return execute(method, params, id);
      const instance = devices.get(params.deviceId), generation = instance?.generation;
      const previous = queues.get(params.deviceId) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(() => {
        if (instance && (devices.get(params.deviceId) !== instance || instance.generation !== generation)) fail('stale_session', '设备连接已更新，请重新读取状态。');
        return execute(method, params, id);
      });
      queues.set(params.deviceId, next); return next;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { closed = true; listeners.clear(); },
    simulate(deviceId, phase) {
      if (closed) fail('transport_closed', '模拟器已经关闭。');
      const device = get(deviceId); device.generation++; device.phase = phase;
      device.values = phase === 'connected' ? structuredClone(templateFor(device.moduleId).values) : {};
      device.valueState = phase === 'connected' ? 'confirmed' : 'unknown'; return publish(device);
    },
  };
}
