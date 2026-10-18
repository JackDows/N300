import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {getTransport,isTauri} from '../device/transport';
import {recordUiError} from '../diagnostics';
import type {UpdateJob} from '../../../../contracts/client.mjs';
type Stage='idle'|'checking'|'current'|'available'|'downloading'|'installing'|'error';
interface Release{version:string;notes:string}
interface State{version:string;stage:Stage;release:Release|null;message:string;downloaded:number;total?:number;dismissed:boolean}
interface Actions{check():Promise<void>;install():Promise<void>;dismiss():void}
const Context=createContext<(State&Actions)|null>(null);
const initial:State={version:'',stage:'idle',release:null,message:'',downloaded:0,dismissed:false};
export function UpdateProvider({children}:{children:ReactNode}){
  const [state,setState]=useState(initial);const busy=useRef(false),alive=useRef(true);
  const check=useCallback(async()=>{
    if(busy.current||!isTauri)return;busy.current=true;setState(s=>({...s,stage:'checking',message:''}));
    try{const c=await getTransport();const {release}=await c.request('app.updates.check');if(alive.current)setState(s=>({...s,release,stage:release?'available':'current',dismissed:release?.version===s.release?.version&&s.dismissed}));}
    catch(e){recordUiError(e,'update.check');if(alive.current)setState(s=>({...s,stage:'error',message:'暂时无法检查更新，请稍后重试'}));}finally{busy.current=false;}
  },[]);
  const install=useCallback(async()=>{
    if(busy.current||!isTauri)return;busy.current=true;
    setState(s=>({...s,stage:'downloading',downloaded:0,message:''}));
    let off=()=>{};
    try{
      const c=await getTransport();let job=await c.request('app.updates.download');
      const progress=(j:UpdateJob)=>{if(alive.current)setState(s=>({...s,downloaded:j.downloaded,total:j.total,stage:j.state==='installing'?'installing':'downloading'}));};
      off=c.subscribe(e=>{if(e.type==='updates.changed'&&e.job.id===job.id)progress(e.job);});
      while(!['ready','failed','cancelled','interrupted'].includes(job.state)) {await new Promise(r=>setTimeout(r,150));job=await c.request('updates.get',{jobId:job.id});if(!alive.current)return;}
      if(job.state!=='ready')throw job.error??new Error('下载未完成');
      setState(s=>({...s,stage:'installing'}));job=await c.request('app.updates.install',{jobId:job.id});
      while(alive.current&&job.state==='installing'){await new Promise(r=>setTimeout(r,200));job=await c.request('updates.get',{jobId:job.id});}
      if(alive.current&&job.state==='failed')throw job.error??new Error('安装未完成');
    }catch(e){recordUiError(e,'update.install');if(alive.current)setState(s=>({...s,stage:'error',message:'更新未完成，请重试'}));}finally{off();busy.current=false;}
  },[]);
  useEffect(()=>{
    alive.current=true;let disposed=false;let timer:ReturnType<typeof setTimeout>;
    if(isTauri)getTransport().then(c=>c.request('app.updates.info')).then(info=>{
      if(disposed)return;setState(s=>({...s,version:info.version,message:info.lastResult?.state==='completed'?`已更新到 ${info.lastResult.version}`:info.lastResult?'上次更新未完成，请重试':''}));timer=setTimeout(check,8000);
    }).catch(e=>recordUiError(e,'update.info'));
    return()=>{disposed=true;alive.current=false;clearTimeout(timer);};
  },[check]);
  return <Context.Provider value={{...state,check,install,dismiss:()=>setState(s=>({...s,dismissed:true}))}}>{children}</Context.Provider>;
}
export function useUpdate(){const value=useContext(Context);if(!value)throw new Error('UpdateProvider missing');return value;}
