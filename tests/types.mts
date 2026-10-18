import { createClient, type DeviceSnapshot } from '../contracts/client.mjs';
import { createMockClient } from '../contracts/mock.mjs';
import { startBackend } from '../contracts/node.mjs';
const client = createClient({ send() {}, subscribe() {} });
const state: Promise<DeviceSnapshot> = client.request('devices.get', { deviceId:'keyboard' });
void state;
void client.request('devices.list');
void client.request('devices.write', { deviceId:'keyboard', capability:'lighting.brightness', value:3 });
// @ts-expect-error Device ID is required.
void client.request('devices.get');
// @ts-expect-error A write requires a value.
void client.request('devices.write', { deviceId:'keyboard', capability:'lighting.brightness' });
// @ts-expect-error Module selection is required.
void client.request('devices.add', { id:'keyboard' });
// @ts-expect-error Method names are constrained by the public contract.
void client.request('devices.whatever');
client.subscribe((event) => { if(event.type==='devices.changed') console.log(event.device.generation); });
const mock = createMockClient([]); mock.simulate('keyboard','waiting');
void startBackend({ executable:'deskhub.exe', moduleRoot:'modules', dataDirectory:'data', offline:true });
