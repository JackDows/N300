import {useEffect,useRef,useState} from "react";
interface Props{label:string;value:number|null;min:number;max:number;step?:number;disabled?:boolean;onCommit(value:number):Promise<void>|void;showValue?:boolean;unit?:string}
export function ValueSlider({label,value,min,max,step=1,disabled=false,onCommit,showValue=true,unit=""}:Props){
  const [draft,setDraft]=useState<number|null>(null),[pending,setPending]=useState(false);
  const active=useRef(false),alive=useRef(true),draftRef=useRef<number|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const current=draft??value;
  async function commit(next:number){if(active.current||disabled||value===null)return;draftRef.current=null;if(next===value){setDraft(null);return;}active.current=true;setPending(true);try{await onCommit(next);}finally{active.current=false;if(alive.current){setPending(false);setDraft(null);}}}
  return <div className={`value-slider${pending?" is-pending":""}`} aria-busy={pending}><div className="value-slider__label"><span>{label}</span>{showValue&&<output>{current===null?"—":current}{current!==null&&unit}</output>}</div><input type="range" aria-label={label} aria-valuenow={current??undefined} aria-valuetext={current===null?"尚未连接":undefined} min={min} max={max} step={step} value={current??min} disabled={disabled||value===null||pending} onChange={e=>{draftRef.current=Number(e.target.value);setDraft(draftRef.current);}} onPointerUp={e=>void commit(Number(e.currentTarget.value))} onKeyUp={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown"].includes(e.key))void commit(Number(e.currentTarget.value));}} onBlur={()=>{if(draftRef.current!==null)void commit(draftRef.current);}}/><div className="value-slider__limits"><span>{min}</span><span>{max}{unit}</span></div></div>;
}
