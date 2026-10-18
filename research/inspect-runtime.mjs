import { readFileSync, writeFileSync } from 'node:fs';
import { Cdp } from './cdp.mjs';
import './verify-inputs.mjs';
const source = readFileSync(new URL('../research/inputs/official/dist/static/js/main_36623ada.js', import.meta.url), 'utf8');
const client = await Cdp.connect('http://127.0.0.1:19381');
const events = [];
try {
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');
  client.on('Runtime.exceptionThrown', (p) => events.push({ type: 'exception', details: p.exceptionDetails }));
  client.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error' || entry.level === 'warning') events.push({ type: 'log', text: entry.text, source: entry.source }); });
  client.on('Network.requestWillBeSent', (p) => { if (p.request.url.startsWith('http://127.0.0.1:3814/')) events.push({ type: 'request', id: p.requestId, method: p.request.url.split('/').at(-1), timestamp: p.timestamp }); });
  client.on('Network.loadingFailed', (p) => events.push({ type: 'network-failed', id: p.requestId, error: p.errorText }));
  await client.send('Debugger.enable');
  const offset = source.indexOf('h1n.init().then');
  if (offset < 0) throw new Error('Expected initialization marker is absent');
  const breakpoint = await client.send('Debugger.setBreakpointByUrl', { lineNumber: 0, columnNumber: offset, urlRegex: 'main_36623ada\\.js$' });
  const paused = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Initialization breakpoint not reached')), 20000);
    client.once('Debugger.paused', (event) => { clearTimeout(timer); resolve(event); });
  });
  await client.send('Page.reload');
  const pause = await paused;
  const exposed = await client.send('Debugger.evaluateOnCallFrame', {
    callFrameId: pause.callFrames[0].callFrameId,
    expression: 'window.__OG98_RE={store:Axn,devices:osn,client:ao,protobuf:Wn,allModels:Im,lightLayout:yc,keyLayout:oS,models:Vf.filter(x=>x.name==="yc3121_k249_soc")};Object.keys(Axn)',
    returnByValue: true,
  });
  if (exposed.exceptionDetails) throw new Error(JSON.stringify(exposed.exceptionDetails));
  await client.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
  await client.send('Debugger.resume');
  await client.send('Debugger.disable');
  await new Promise((resolve) => setTimeout(resolve, 6500));
  const snapshot = await client.evaluate(`(() => {
    const r=window.__OG98_RE, d=r.store.deviceStore.currentDev;
    return {storeKeys:Object.keys(r.store),deviceStoreKeys:Object.keys(r.store.deviceStore),devicesAPI:Object.keys(r.devices),
      selected:d?{type:d.type,deviceType:d.deviceType,fields:Object.keys(d),prototype:Object.getOwnPropertyNames(Object.getPrototypeOf(d))}:null,
      devices:r.devices.getDeviceInstanceArr().map(x=>({type:x.type,deviceType:x.deviceType})), models:r.models, lightLayout:r.lightLayout,keyLayout:r.keyLayout,text:document.body.innerText};
  })()`);
  writeFileSync(new URL('../artifacts/analysis/runtime-state.json', import.meta.url), JSON.stringify({ snapshot, events }, null, 2));
  console.log(JSON.stringify({ storeKeys:snapshot.storeKeys,deviceStoreKeys:snapshot.deviceStoreKeys,devicesAPI:snapshot.devicesAPI,selected:snapshot.selected,devices:snapshot.devices,events }));
} finally {
  await client.send('Debugger.resume').catch(() => {});
  await client.send('Debugger.disable').catch(() => {});
  client.close();
}
