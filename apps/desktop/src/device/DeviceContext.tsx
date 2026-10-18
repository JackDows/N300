import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {DeskHubClient,DeviceSnapshot,Reading} from '../../../../contracts/client.mjs';
import {getTransport,isTauri} from './transport';
import {recordUiError} from '../diagnostics';
import type {DeviceErrorInfo,DeviceState,Values,WritableProperty} from './types';

export type Phase='starting'|'connecting'|'waiting'|'connected'|'disconnected';
export interface Toast{id:number;text:string;kind:'ok'|'error'}
interface ContextValue {
  phase:Phase;state:DeviceState|null;values:Values;error:DeviceErrorInfo|null;toast:Toast|null;stopping:boolean;pendingInput:string|number|null;
  set(property:WritableProperty,value:unknown):Promise<void>;setEqBand(band:number,gain:number):Promise<void>;resetEq():Promise<void>;
  connect():Promise<void>;disconnect():Promise<void>;powerOff():Promise<void>;
}
const Context=createContext<ContextValue|null>(null);
const capabilities:Record<keyof Values,string>={volume:'audio.volume',input:'audio.input',preset:'audio.preset',eq:'audio.eq',led:'lighting.enabled',idle_shutdown:'device.idleShutdown',timer:'device.timer',name:'device.name',firmware:'device.firmware'};
export const formatHz=(hz:number)=>hz>=1000?`${hz/1000}k`:`${hz}`;
export function errorInfo(error:unknown):DeviceErrorInfo {
  if(error && typeof error==='object' && 'code' in error) return {code:String(error.code),message:'userMessage' in error?String(error.userMessage):'message' in error?String(error.message):'操作未完成，请重试'};
  return {code:'internal_error',message:'操作未完成，请重试'};
}
export function errorText(error:unknown){return errorInfo(error).message;}
export function speakerView(snapshot:DeviceSnapshot):DeviceState {
  const values=Object.fromEntries(Object.entries(capabilities).filter(([,id])=>snapshot.values[id]).map(([name,id])=>[name,snapshot.values[id]])) as Values;
  return {api_version:1,offline:snapshot.offline,connected:snapshot.phase==='connected',auto_reconnect:false,
    target:snapshot.target as DeviceState['target'],capabilities:{rename_bytes:snapshot.values['device.name']?.maxBytes},values,unavailable:snapshot.unavailable};
}
export async function connectSpeaker(client:DeskHubClient):Promise<DeviceSnapshot> {
  const info=await client.request('hub.describe');
  const devices=await client.request('devices.list');
  let device=devices.find(d=>d.id==='speaker');
  device??=await client.request('devices.add',{id:'speaker',moduleId:'edifier-n300',label:'桌面音响',offline:info.offline});
  if(device.phase==='connected')return device;
  if(!device.offline&&!device.bindingTarget.resourceId){
    const candidates=await client.request('devices.scan',{deviceId:device.id});
    if(candidates.length!==1)throw {code:candidates.length?'ambiguous_device':'not_found',message:candidates.length?'附近有多台音箱，请选择设备':'没有找到音箱，请稍后重试'};
    device=await client.request('devices.rebind',{deviceId:device.id,moduleId:device.moduleId,target:candidates[0].target});
  }
  return client.request('devices.connect',{deviceId:device.id});
}
export function DeviceProvider({children}:{children:ReactNode}){
  const [snapshot,setSnapshot]=useState<DeviceSnapshot|null>(null);
  const [error,setError]=useState<DeviceErrorInfo|null>(null);
  const [toast,setToast]=useState<Toast|null>(null);
  const [connecting,setConnecting]=useState(true);
  const [stopping,setStopping]=useState(false);
  const [pendingInput,setPendingInput]=useState<string|number|null>(null);
  const client=useRef<DeskHubClient|null>(null),current=useRef(snapshot),toastTimer=useRef<ReturnType<typeof setTimeout>>(undefined),toastId=useRef(0),inputBusy=useRef(false);
  current.current=snapshot;
  const notify=useCallback((text:string,kind:Toast['kind']='ok')=>{clearTimeout(toastTimer.current);setToast({id:++toastId.current,text,kind});toastTimer.current=setTimeout(()=>setToast(null),kind==='error'?2800:1600);},[]);
  useEffect(()=>{
    let disposed=false;let off=()=>{};
    getTransport().then(async c=>{
      if(disposed)return;client.current=c;
      off=c.subscribe(event=>{
        if(event.type==='devices.changed'&&event.device.id==='speaker'){
          setSnapshot(previous=>previous&&previous.revision>event.device.revision?previous:event.device);
          if(event.device.phase==='connected')setError(null);
        }
        if(event.type==='app.activated')void c.request('app.takeActivationNotice').then(show=>{if(show&&!disposed)notify('程序已在运行');});
      });
      if(isTauri&&await c.request('app.takeActivationNotice'))notify('程序已在运行');
      try {const value=await connectSpeaker(c);if(!disposed)setSnapshot(value);}
      catch(e){recordUiError(e,'speaker.connect');if(!disposed)setError(errorInfo(e));}
      finally{if(!disposed)setConnecting(false);}
    }).catch(e=>{recordUiError(e,'hub.connect');if(!disposed){setError(errorInfo(e));setConnecting(false);}});
    return()=>{disposed=true;off();clearTimeout(toastTimer.current);};
  },[notify]);
  const connect=useCallback(async()=>{
    if(!client.current)return;setConnecting(true);setError(null);
    try{setSnapshot(await connectSpeaker(client.current));}catch(e){setError(errorInfo(e));recordUiError(e,'speaker.connect');}finally{setConnecting(false);}
  },[]);
  const set=useCallback(async(property:WritableProperty,value:unknown)=>{
    const c=client.current,s=current.current;if(!c||s?.phase!=='connected')return;
    if(property==='input'){if(inputBusy.current)return;inputBusy.current=true;setPendingInput(value as string|number);}
    setToast(null);const capability=capabilities[property];
    try{
      const confirmed=await c.request('devices.write',{deviceId:s.id,capability,value});
      setSnapshot(previous=>previous?{...previous,values:{...previous.values,[capability]:confirmed}}:previous);
    }catch(e){recordUiError(e,`speaker.${property}`);notify(property==='input'?'没有切换成功，请重试':errorText(e),'error');
      try{const value=await c.request('devices.read',{deviceId:s.id,capability});setSnapshot(previous=>previous?{...previous,values:{...previous.values,[capability]:value}}:previous);}catch{/* The backend snapshot retains stale/error state. */}
    }finally{if(property==='input'){inputBusy.current=false;setPendingInput(null);}}
  },[notify]);
  const setEqBand=useCallback(async(band:number,gain:number)=>{
    const c=client.current,s=current.current;if(!c||s?.phase!=='connected')return;
    try{const eq=await c.request('devices.invoke',{deviceId:s.id,capability:'audio.eq.setBand',arguments:{band,gain}}) as Reading;setSnapshot(p=>p?{...p,values:{...p.values,'audio.eq':eq}}:p);}
    catch(e){recordUiError(e,'speaker.eq');notify(errorText(e),'error');}
  },[notify]);
  const resetEq=useCallback(async()=>{const bands=(current.current?.values['audio.eq']?.value??[]) as Array<{index:number;gain_db:number}>;for(const band of bands)if(band.gain_db)await setEqBand(band.index,0);},[setEqBand]);
  const disconnect=useCallback(async()=>{if(!client.current||!current.current)return;setStopping(true);try{setSnapshot(await client.current.request('devices.disconnect',{deviceId:current.current.id}));}catch(e){notify(errorText(e),'error');}finally{setStopping(false);}},[notify]);
  const powerOff=useCallback(async()=>{if(!client.current||!current.current)return;try{await client.current.request('devices.invoke',{deviceId:current.current.id,capability:'device.powerOff'});notify('已请求关闭音箱');}catch(e){notify(errorText(e),'error');}},[notify]);
  const state=useMemo(()=>snapshot?speakerView(snapshot):null,[snapshot]);
  const phase:Phase=connecting?'connecting':snapshot?.phase==='connected'?'connected':'disconnected';
  return <Context.Provider value={{phase,state,values:state?.connected?state.values:{},error,toast,stopping,pendingInput,set,setEqBand,resetEq,connect,disconnect,powerOff}}>{children}</Context.Provider>;
}
export function useDevice(){const value=useContext(Context);if(!value)throw new Error('DeviceProvider missing');return value;}
