import {useEffect,useRef,useState} from "react";
import layout from "../../../../modules/flesports-og98/assets/layout.json";
import {useDevice} from "../device/DeviceContext";
import {useDeviceAction} from "../device/useDeviceAction";
import {keyChoices,keyCode,keyName,mediaChoices} from "../device/keyCodes";
import {KeyboardModel} from "../components/KeyboardModel";
import {getTransport} from "../device/transport";
import {recordUiError} from "../diagnostics";
import "./Editors.css";
import "./KeymapEditor.css";

type Binding={type:string;raw:number[];modifier?:number;key?:number;second?:number;code?:number};
type Key=typeof layout[number]&{binding:Binding;defaultBinding:Binding};
type Keymap={layer:string;profile:number;keys:Key[];matrix:number[]};
type Draft={kind:string;modifier:number;primary:number;second:number;media:number};
const fromBinding=(b:Binding):Draft=>({kind:b.type,modifier:b.modifier??0,primary:b.key||69,second:b.second??0,media:b.code??205});
const bindingLabel=(b?:Binding)=>!b?"读取后显示":b.type==="disabled"?"已禁用":b.type==="key"?[b.modifier,b.key,b.second].filter(Boolean).map(n=>keyName(n!)).join(" + "):b.type==="media"?mediaChoices.find(v=>v.code===b.code)?.label??"媒体功能":b.type==="macro"?"已有宏":"自定义功能";
const firstSlot=layout.find(k=>k.label==="F12")!.slot;

// Approved B: full physical key layout above a persistent editing bar. Every key uses
// the same surface; selection only changes the chosen key. Save is the primary action.
export function KeymapEditor({active}:{active:boolean}){
 const {keyboard,kbBusy,refreshKeyboard}=useDevice();
 const [layer,setLayer]=useState("normal"),[maps,setMaps]=useState<Record<string,Keymap>>({}),[slot,setSlot]=useState(firstSlot);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[undo,setUndo]=useState<Record<string,Binding>>({}),[recording,setRecording]=useState(false);
 const [reading,setReading]=useState<Record<string,boolean>>({}),[readErrors,setReadErrors]=useState<Record<string,string>>({}),[savingKey,setSavingKey]=useState(false);
 const readEpoch=useRef(0),pendingReads=useRef(new Set<string>()),readSession=useRef(""),readAlive=useRef(false);
 const action=useDeviceAction(`${keyboard.id}:${keyboard.generation}`),map=maps[layer],selected=map?.keys.find(k=>k.slot===slot),id=`${layer}:${slot}`;
 const disabled=!keyboard.connected||action.busy||kbBusy;
 const draft=drafts[id]??(selected?fromBinding(selected.binding):{kind:"key",modifier:0,primary:69,second:0,media:205});
 const dirty=!!selected&&JSON.stringify(draft)!==JSON.stringify(fromBinding(selected.binding));
 const recorder=useRef<HTMLButtonElement>(null);
 function edit(patch:Partial<Draft>){setDrafts(old=>({...old,[id]:{...draft,...patch}}));action.setMessage("");}
 function load(which=layer){
  if(!keyboard.connected||pendingReads.current.has(which))return;
  const epoch=readEpoch.current;pendingReads.current.add(which);
  setReading(old=>({...old,[which]:true}));setReadErrors(old=>({...old,[which]:""}));
  void getTransport().then(c=>c.request("devices.read",{deviceId:keyboard.id,capability:which==="fn"?"keyboard.fnKeymap":"keyboard.keymap",timeoutMs:30000})).then(result=>{
   if(readAlive.current&&epoch===readEpoch.current)setMaps(old=>({...old,[which]:result.value as Keymap}));
  }).catch(error=>{
   recordUiError(error,"keyboard.keymap.read");
   if(readAlive.current&&epoch===readEpoch.current)setReadErrors(old=>({...old,[which]:error instanceof Error?error.message:"读取未完成，请重试。"}));
  }).finally(()=>{if(readAlive.current&&epoch===readEpoch.current){pendingReads.current.delete(which);setReading(old=>({...old,[which]:false}));}});
 }
 useEffect(()=>{setMaps({});setDrafts({});setUndo({});setRecording(false);},[keyboard.id,keyboard.generation]);
 useEffect(()=>{
  readAlive.current=true;
  const session=`${keyboard.id}:${keyboard.generation}:${keyboard.connected}:${keyboard.profile}`;
  if(readSession.current!==session){readSession.current=session;readEpoch.current++;pendingReads.current.clear();setMaps({});setReading({});setReadErrors({});}
  return()=>{readAlive.current=false;};
 },[keyboard.id,keyboard.generation,keyboard.connected,keyboard.profile]);
 // Cache each layer for this device session. Navigation never commits a draft;
 // only an explicit refresh, reconnect or profile change reads it again.
 useEffect(()=>{if(active&&keyboard.connected&&!maps[layer]&&!reading[layer]&&!readErrors[layer])load();},[active,keyboard.connected,keyboard.generation,layer,maps,reading,readErrors]);
 useEffect(()=>{if(!active||disabled)setRecording(false);},[active,disabled]);
 function save(value:Record<string,unknown>,restoring=false){if(!map||disabled||reading[layer])return;const currentLayer=layer,currentSlot=slot,currentId=id;setRecording(false);setSavingKey(true);void action.run("keyboard.keymap.set",async c=>c.request("devices.invoke",{deviceId:keyboard.id,capability:"keyboard.keymap.set",arguments:{layer:currentLayer,slot:currentSlot,profile:map.profile,action:value}}),value=>{const r=value as {before:Binding;after:Binding};setMaps(old=>({...old,[currentLayer]:{...old[currentLayer],keys:old[currentLayer].keys.map(k=>k.slot===currentSlot?{...k,binding:r.after}:k)}}));setDrafts(old=>{const next={...old};delete next[currentId];return next;});setUndo(old=>{const next={...old};if(restoring)delete next[currentId];else next[currentId]=r.before;return next;});},"按键已保存").finally(()=>setSavingKey(false));}
 function option(name:"winLocked"|"wasdSwapped",value:boolean){void action.run("keyboard.options",async c=>{await c.request("devices.write",{deviceId:keyboard.id,capability:"keyboard.options",value:{[name]:value}});await refreshKeyboard();},()=>{},"设置已保存");}
 return <div className="key-editor editor-panel">
  <div className="key-tools"><div className="editor-segments" role="group" aria-label="键盘层">{[["normal","普通层"],["fn","Fn 层"]].map(([value,label])=><button key={value} aria-pressed={layer===value} disabled={action.busy} onClick={()=>{setLayer(value);setRecording(false);}}>{label}</button>)}</div><span className="editor-hint">选择一个按键，设置它的功能</span><button className="btn-ghost" disabled={disabled||reading[layer]} onClick={()=>load()}>{reading[layer]?"读取中…":"同步键位"}</button></div>
  <div className="key-layout-scroll"><KeyboardModel selectedSlot={slot} keys={map?.keys} layer={layer} disabled={!map||action.busy} onSelectKey={value=>{setSlot(value);setRecording(false);action.setMessage("");}}/></div>
  <div className="key-map-hint"><span role="status">{!keyboard.connected?"键盘未连接，重新连接后可以保存设置。":reading[layer]?"正在读取键盘上的设置…":!map?"点击同步键位重试读取。":layer==="fn"?"Fn 层 · 按住 Fn 时使用":"普通层"}</span><span>■ 当前选择 · 已改绑的按键带有标记</span></div>
  <div className="keyboard-switches" aria-label="键盘偏好设置"><label><input type="checkbox" checked={keyboard.options?.winLocked??false} disabled={disabled||!keyboard.options} onChange={e=>option("winLocked",e.target.checked)}/>锁定 Win 键</label><label><input type="checkbox" checked={keyboard.options?.wasdSwapped??false} disabled={disabled||!keyboard.options} onChange={e=>option("wasdSwapped",e.target.checked)}/>WASD 与方向键互换</label></div>
  {selected&&<section className="key-detail" aria-label="选中按键设置"><div className="key-detail__heading"><h2>按键功能</h2><span>{dirty?"● 未保存":"与键盘一致"}</span></div><div className="key-detail__identity"><strong>{selected.label.replaceAll("\n"," ")==="(space)"?"Space":selected.label.replaceAll("\n"," ")}</strong><span>当前：{bindingLabel(selected.binding)}</span></div>
    <label className="key-kind">功能类型<select aria-label="按键功能" value={draft.kind} disabled={disabled} onChange={e=>edit({kind:e.target.value})}>{!["key","media","disabled"].includes(draft.kind)&&<option value={draft.kind}>保留现有功能</option>}<option value="key">按键 / 组合键</option><option value="media">媒体控制</option><option value="disabled">禁用此键</option></select></label>
    {draft.kind==="key"&&<div className="key-manual editor-fields"><label>修饰键<select aria-label="修饰键" value={draft.modifier} disabled={disabled} onChange={e=>edit({modifier:Number(e.target.value)})}><option value={0}>无</option>{keyChoices.filter(k=>k.code>=224).map(k=><option key={k.code} value={k.code}>{k.label}</option>)}</select></label><label>目标按键<select aria-label="目标按键" value={draft.primary} disabled={disabled} onChange={e=>edit({primary:Number(e.target.value)})}>{keyChoices.map(k=><option key={k.code} value={k.code}>{k.label}</option>)}</select></label><label>附加键<select aria-label="附加键" value={draft.second} disabled={disabled} onChange={e=>edit({second:Number(e.target.value)})}><option value={0}>无</option>{keyChoices.map(k=><option key={k.code} value={k.code}>{k.label}</option>)}</select></label></div>}
    {draft.kind==="media"&&<label className="key-media">媒体功能<select aria-label="媒体功能" value={draft.media} disabled={disabled} onChange={e=>edit({media:Number(e.target.value)})}>{mediaChoices.map(k=><option key={k.code} value={k.code}>{k.label}</option>)}</select></label>}
    {draft.kind==="disabled"&&<p className="key-disabled-note">保存后，此键将不再触发按键动作。</p>}
    <div className="key-actions"><button className="btn-primary" disabled={disabled||reading[layer]||!dirty} onClick={()=>save(draft.kind==="key"?{type:"key",modifier:draft.modifier,key:draft.primary,second:draft.second}:draft.kind==="media"?{type:"media",code:draft.media}:{type:"disabled"})}>{savingKey?"保存中…":"保存按键"}</button>{layer==="normal"&&<button className="text-action" disabled={disabled||reading[layer]} onClick={()=>save({type:"default"})}>恢复原键</button>}</div>
    <div className="key-detail__footer">{draft.kind==="key"&&<button ref={recorder} className={`key-recorder${recording?" is-recording":""}`} disabled={disabled} onBlur={()=>setRecording(false)} onClick={()=>setRecording(true)} onKeyDown={e=>{if(!recording)return;e.preventDefault();e.stopPropagation();if(e.key==="Escape"){setRecording(false);return;}const code=keyCode(e.code);if(!code||code>=224)return;const mods=[e.ctrlKey?224:0,e.shiftKey?225:0,e.altKey?226:0,e.metaKey?227:0].filter(Boolean);if(mods.length>2){action.setMessage("最多设置三个按键的组合。");return;}edit({modifier:mods[0]??0,primary:mods[1]??code,second:mods[1]?code:0});setRecording(false);}}>{recording?"请按下组合键 · Esc 取消":"录入组合键"}</button>}{undo[id]&&<button className="text-action" disabled={disabled} onClick={()=>save({type:"restore",raw:undo[id].raw},true)}>撤销本次修改</button>}<span>保存后应用到当前按键层。</span></div>
  </section>}
  {action.message&&<p className="editor-message" role="status">{action.message}</p>}
  {readErrors[layer]&&<p className="editor-message" role="status">{readErrors[layer]}</p>}
 </div>;
}
