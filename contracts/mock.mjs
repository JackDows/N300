import { DeskHubError } from './client.mjs';

/** Browser-only device simulator. Package integrity and filesystem export use the native host. */
export function createMockClient(seed, { latencyMs = 20 } = {}) {
  const original = structuredClone(seed);
  const devices = new Map(original.map((device) => [device.id, structuredClone(device)]));
  const sessions = new Map(original.map((device) => [device.id, structuredClone(device.values)]));
  const listeners = new Set(), queues = new Map();
  let closed = false, nextId = 0;
  const fail = (code, userMessage) => { throw new DeskHubError({ code, userMessage, message: code }); };
  const emit = (event) => { for (const listener of listeners) listener(structuredClone(event)); };
  const publish = (device) => { device.revision++; emit({ type: 'devices.changed', device }); return structuredClone(device); };
  const get = (id) => devices.get(id) ?? fail('device_not_found', '这个设备尚未添加。');
  const templateFor = (id) => original.find((d) => d.moduleId === id) ?? fail('module_selection_required', '模拟器中没有这个设备模块。');
  const select = (params) => templateFor(params.moduleId ?? params.packagePath?.replace(/^mock:\/\//, ''));
  const packageFor = (device) => ({ manifest: { id: device.moduleId, name: device.label, version: device.moduleVersion, protocolVersion: 1, executable: 'browser-mock', files: {} }, packagePath: `mock://${device.moduleId}`, fingerprint: 'mock' });
  const validLabel = (label) => typeof label === 'string' && label.length > 0 && new TextEncoder().encode(label).length <= 240;
  function connect(device) {
    if (device.phase === 'connected') return publish(device);
    if (device.phase === 'stopped' || device.phase === 'faulted') device.generation++;
    device.values = structuredClone(sessions.get(device.id) ?? templateFor(device.moduleId).values);
    sessions.set(device.id, structuredClone(device.values));
    Object.assign(device, { phase: 'connected', error: null, valueState: 'confirmed', unavailable: {} });
    return publish(device);
  }
  function stop(device) {
    device.generation++; sessions.delete(device.id);
    Object.assign(device, { phase: 'stopped', values: {}, error: null, valueState: 'unknown', unavailable: {} });
    return publish(device);
  }
  async function execute(method, params, requestId) {
    if (closed) fail('transport_closed', '模拟器已经关闭。');
    if (method === 'hub.describe') return { name: 'DeskHub', version: '0.1.0', protocolVersion: 1, offline: true, dataDirectory: 'browser-memory', maxFrameBytes: 65536, methods: methods.slice() };
    if (method === 'devices.list') return structuredClone([...devices.values()]);
    if (method === 'modules.list') return [...new Map(original.map((d) => [d.moduleId, packageFor(d)])).values()];
    if (method === 'modules.inspect') return packageFor(select(params));
    if (method === 'diagnostics.export') fail('unsupported_mock_operation', '诊断文件导出请连接原生离线后端测试。');
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
      const connected = device.phase === 'connected'; sessions.delete(device.id);
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
      if (operation === 'invoke' && params.capability === 'audio.eq.setBand') {
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
          reading.value = structuredClone(value);
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
  const methods = ['hub.describe', 'modules.list', 'modules.inspect', 'devices.list', 'devices.add', 'devices.get', 'devices.start', 'devices.stop', 'devices.restart', 'devices.replace', 'devices.rebind', 'devices.rename', 'devices.remove', 'devices.scan', 'devices.connect', 'devices.disconnect', 'devices.refresh', 'devices.read', 'devices.write', 'devices.invoke', 'diagnostics.export'];
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
