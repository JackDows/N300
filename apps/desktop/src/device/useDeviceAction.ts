import { useEffect, useRef, useState } from "react";
import type { DeskHubClient } from "../../../../contracts/client.mjs";
import { getTransport } from "./transport";
import { recordUiError } from "../diagnostics";

/** One editor operation at a time; results from a closed/replaced editor cannot update it. */
export function useDeviceAction(identity:string) {
  const [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  const alive=useRef(false), active=useRef(false), epoch=useRef(0);
  useEffect(()=>{alive.current=true;epoch.current++;active.current=false;setBusy(false);setMessage("");return()=>{alive.current=false;epoch.current++;};},[identity]);
  async function run<T>(context:string, work:(client:DeskHubClient)=>Promise<T>, accept:(value:T)=>void, success="") {
    if (active.current || !alive.current) return;
    const ticket=epoch.current;active.current=true;setBusy(true);setMessage("");
    try {const value=await work(await getTransport());if(alive.current&&ticket===epoch.current){accept(value);setMessage(success);}}
    catch(error){recordUiError(error,context);if(alive.current&&ticket===epoch.current)setMessage(error instanceof Error?error.message:"操作未完成，请重试。");}
    finally{if(alive.current&&ticket===epoch.current){active.current=false;setBusy(false);}}
  }
  return {busy,message,setMessage,run};
}
