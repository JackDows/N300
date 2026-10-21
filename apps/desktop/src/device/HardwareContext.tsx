import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from "react";
import {getTransport} from "./transport";
import {recordUiError} from "../diagnostics";
export const hardwareParts=[{id:"cpu",name:"处理器"},{id:"gpu",name:"显卡"},{id:"memory",name:"内存"},{id:"storage",name:"磁盘"},{id:"network",name:"网络"},{id:"motherboard",name:"主板"}] as const;
export type HardwarePart=typeof hardwareParts[number]["id"];
export interface HardwareInventory{parts:Partial<Record<HardwarePart,{name:string;detail?:string}[]>>;mangodisk:boolean}
const Context=createContext<{inventory:HardwareInventory|null;busy:boolean;message:string;refresh():void}|null>(null);
export function HardwareProvider({children}:{children:ReactNode}){
  const [inventory,setInventory]=useState<HardwareInventory|null>(null),[busy,setBusy]=useState(true),[message,setMessage]=useState("");
  const [revision,setRevision]=useState(0);
  useEffect(()=>{let alive=true;setBusy(true);setMessage("");void getTransport().then(c=>c.request("app.hardware.inspect")).then(v=>{if(alive)setInventory(v as HardwareInventory);}).catch(e=>{recordUiError(e,"hardware.inspect");if(alive)setMessage("暂时未能读取硬件信息，请重试。");}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[revision]);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  return <Context.Provider value={{inventory,busy,message,refresh}}>{children}</Context.Provider>;
}
export function useHardware(){const c=useContext(Context);if(!c)throw new Error("HardwareProvider missing");return c;}
