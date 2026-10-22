import {useRef,type CSSProperties,type KeyboardEvent} from "react";
import layout from "../../../../modules/flesports-og98/assets/layout.json";
import "./KeyboardModel.css";
export interface KeyBindingView{slot:number;binding:{raw:number[]};defaultBinding:{raw:number[]}}
// Fn bindings include media, macros and firmware functions, not just key codes.
export const hasKeyAssignment=(key:KeyBindingView)=>key.binding.raw.length===4&&key.binding.raw.some(byte=>byte!==0);
interface Props{decorative?:boolean;disabled?:boolean;selectedSlot?:number|null;keys?:KeyBindingView[];layer?:string;brightness?:number;color?:[number,number,number];onSelectKey?(slot:number):void}
const caps:Record<string,string>={"Print\nScreen":"PrtSc","Page\nUp":"PgUp","Page\nDown":"PgDn","BackSpace":"Backspace","Caps Lock":"Caps","Num\nLock":"Num","(space)":"","R Shift":"Shift","R Ctrl":"Ctrl","R Alt":"Alt","fn":"Fn",Delete:"Del",Insert:"Ins"};
const minX=117,minY=46,width=637,height=213;
export function KeyboardModel({decorative=false,disabled=false,selectedSlot=null,keys,layer="normal",onSelectKey}:Props){
 const buttons=useRef(new Map<number,HTMLButtonElement>());
 function move(event:KeyboardEvent,slot:number){const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!direction)return;event.preventDefault();event.stopPropagation();const current=layout.find(k=>k.slot===slot)!;const next=layout.map(k=>{const dx=k.x+k.w/2-current.x-current.w/2,dy=k.y+k.h/2-current.y-current.h/2;return {slot:k.slot,forward:dx*direction[0]+dy*direction[1],cross:Math.abs(dx*direction[1]+dy*direction[0])};}).filter(k=>k.forward>1).sort((a,b)=>(a.forward+a.cross*4)-(b.forward+b.cross*4))[0];if(next){onSelectKey?.(next.slot);buttons.current.get(next.slot)?.focus();}}
 return <div className={`keyboard-model${decorative?" is-decorative":""}`} aria-hidden={decorative?true:undefined}>
  <div className="keyboard-model__case">
   {!decorative&&<div className="keyboard-model__label"><span>FL·ESPORTS</span><span>OG98 / {layer==="fn"?"Fn 层":"普通层"}</span></div>}
   <div className="keyboard-model__plate" role={decorative?undefined:"group"} aria-label={decorative?undefined:"键盘按键"} style={{aspectRatio:`${width}/${height}`}}>
    {layout.map(k=>{
     const value=keys?.find(v=>v.slot===k.slot);
     const changed=layer==="normal"&&value&&JSON.stringify(value.binding.raw)!==JSON.stringify(value.defaultBinding.raw);
     const assigned=layer==="fn"&&value&&hasKeyAssignment(value);
     const description=layer==="fn"&&value?(assigned?"Fn 层已设置功能":"Fn 层未设置功能"):changed?"已改绑":undefined;
     const className=`model-key${!decorative&&k.slot===selectedSlot?" is-selected":""}${assigned?" is-assigned":""}${changed?" is-modified":""}${k.label.length>3?" has-long-label":""}`;
     const style={left:`${(k.x-minX)/width*100}%`,top:`${(k.y-minY)/height*100}%`,width:`${k.w/width*100}%`,height:`${k.h/height*100}%`} as CSSProperties;
     const content=<span className="model-key__cap"><span>{caps[k.label]??k.label}</span>{changed&&<i aria-hidden="true"/>}</span>;
     return decorative?<span key={k.slot} className={className} style={style}>{content}</span>:<button key={k.slot} data-slot={k.slot} ref={el=>{if(el)buttons.current.set(k.slot,el);else buttons.current.delete(k.slot);}} className={className} style={style} aria-label={`按键 ${k.label}`} aria-description={description} aria-pressed={selectedSlot===k.slot} title={description?`${k.label} · ${description}`:k.label} disabled={disabled} tabIndex={(selectedSlot??72)===k.slot?0:-1} onClick={()=>onSelectKey?.(k.slot)} onKeyDown={e=>move(e,k.slot)}>{content}</button>;
    })}
   </div>
  </div>
 </div>;
}
