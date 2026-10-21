import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMouse } from "../device/MouseContext";
import { useDeviceAction } from "../device/useDeviceAction";
import { keyChoices, keyCode, keyName } from "../device/keyCodes";
import type { DeskHubClient } from "../../../../contracts/client.mjs";
import "./Editors.css";

type Card={id:string;name:string;type:string;readOnly:boolean};
type Bindings={profileId:string;profileName:string;softwareMode:boolean;buttons:{slotId:string;number:number;shifted:boolean;card:Card}[]};
type Step={type:"key";code:number;down:boolean;label?:string}|{type:"mouse";button:number;down:boolean}|{type:"wheel";axis:"vertical"|"horizontal";positive:boolean}|{type:"delay";ms:number};
type Macro=Partial<Card>&{name:string;editable?:boolean;mode:"once"|"hold"|"toggle"|"sequence";steps:Step[];press:Step[];hold:Step[];release:Step[]};
type Stage="steps"|"press"|"hold"|"release";
const blank=():Macro=>({name:"",mode:"once",steps:[],press:[],hold:[],release:[],editable:true});
const buttonNames:Record<number,string>={1:"左键",2:"右键",3:"滚轮中键",4:"后退侧键",5:"前进侧键"};
const cardNames:Record<string,string>={PRIMARY_CLICK:"左键单击",SECONDARY_CLICK:"右键单击",MIDDLE_CLICK:"中键单击",BACK:"后退",FORWARD:"前进",DPI_UP:"提高 DPI",DPI_DOWN:"降低 DPI",DPI_CYCLE:"循环 DPI",DPI_SHIFT:"DPI 切换",G_SHIFT:"G-Shift",DISABLED:"禁用"};
const cardName=(card:Card)=>cardNames[card.name]??card.name;
const stepName=(s:Step)=>s.type==="key"?`${keyName(s.code)} · ${s.down?"按下":"松开"}`:s.type==="mouse"?`${buttonNames[s.button]??`鼠标按钮 ${s.button}`} · ${s.down?"按下":"松开"}`:s.type==="wheel"?`滚轮${s.axis==="vertical"?(s.positive?"向上":"向下"):(s.positive?"向右":"向左")}`:"等待";

export function MouseTools({panel,active}:{panel:"buttons"|"macros";active:boolean}) {
  const mouse=useMouse(),deviceId=mouse.snapshot?.id??"mouse",identity=`${deviceId}:${mouse.snapshot?.generation}`;
  const action=useDeviceAction(identity);
  const [bindings,setBindings]=useState<Bindings|null>(null),[library,setLibrary]=useState<Card[]>([]),[shifted,setShifted]=useState(false),[assignments,setAssignments]=useState<Record<string,string>>({});
  const [draft,setDraft]=useState<Macro>(blank),[stage,setStage]=useState<Stage>("steps"),[recording,setRecording]=useState(false),[key,setKey]=useState(4),[manual,setManual]=useState("key");
  const recordTarget=useRef<HTMLDivElement>(null),recordButton=useRef<HTMLButtonElement>(null),pressed=useRef(new Map<number,string>()),lastTime=useRef(0),recordingRef=useRef(false),draftRef=useRef(draft),stageRef=useRef(stage);
  draftRef.current=draft;stageRef.current=stage;recordingRef.current=recording;
  const disabled=!mouse.connected||mouse.busy||action.busy;
  const editable=draft.editable!==false&&!draft.readOnly;
  const currentSteps=draft[stage]??[];
  const count=draft.mode==="sequence"?draft.press.length+draft.hold.length+draft.release.length:draft.steps.length;
  const invoke=(c:DeskHubClient,capability:string,args:Record<string,unknown>={})=>c.request("devices.invoke",{deviceId,capability,arguments:args});
  async function readLibrary(c:DeskHubClient,profileId:string) {
    const cards:Card[]=[];let total=1;
    while(cards.length<total){const page=await invoke(c,"macros.list",{profileId,offset:cards.length,limit:100}) as {items:Card[];total:number};total=page.total;if(!page.items.length)break;cards.push(...page.items);}
    return cards;
  }
  function load(){void action.run("mouse.bindings.read",async c=>{const b=(await c.request("devices.read",{deviceId,capability:"mouse.bindings"})).value as Bindings;return {b,cards:await readLibrary(c,b.profileId)};},({b,cards})=>{setBindings(b);setLibrary(cards);setAssignments({});});}
  useEffect(()=>{setBindings(null);setLibrary([]);setDraft(blank());setRecording(false);pressed.current.clear();},[identity,mouse.connected]);
  useEffect(()=>{if(active&&mouse.connected&&!bindings)load();},[active,mouse.connected,identity]);
  useEffect(()=>{const mode=mouse.snapshot?.values["device.onboardMode"]?.value;if(typeof mode==="boolean")setBindings(old=>old?{...old,softwareMode:!mode}:old);},[mouse.snapshot?.values["device.onboardMode"]?.value]);
  useEffect(()=>{if(!active||panel!=="macros")stopRecording();},[active,panel]);
  function append(steps:Step[]){setDraft(old=>({...old,[stageRef.current]:[...(old[stageRef.current]??[]),...steps]}));}
  function stopRecording(focus=false){
    if(!recordingRef.current)return;
    recordingRef.current=false;setRecording(false);
    const releases:Step[]=[...pressed.current].map(([code,label])=>({type:"key",code,label,down:false}));pressed.current.clear();if(releases.length)append(releases);if(focus)queueMicrotask(()=>recordButton.current?.focus());
  }
  function record(event:KeyboardEvent,down:boolean) {
    if(!recordingRef.current)return;
    event.preventDefault();event.stopPropagation();
    if(event.code==="Escape"){if(down)stopRecording(true);return;}
    const code=keyCode(event.code);if(!code||event.repeat)return;
    if(down?pressed.current.has(code):!pressed.current.has(code))return;
    const total=draftRef.current.mode==="sequence"?draftRef.current.press.length+draftRef.current.hold.length+draftRef.current.release.length:draftRef.current.steps.length;
    if(down&&total+pressed.current.size+3>=256){stopRecording();action.setMessage("已达到动作数量上限。");return;}
    const now=performance.now(),steps:Step[]=[];
    if(lastTime.current&&now-lastTime.current>=1&&total+pressed.current.size+2<256)steps.push({type:"delay",ms:Math.min(60000,Math.round(now-lastTime.current))});
    const label=keyName(code);steps.push({type:"key",code,down,label});if(down)pressed.current.set(code,label);else pressed.current.delete(code);lastTime.current=now;append(steps);
  }
  function selectMacro(id:string){stopRecording();if(!id){setDraft(blank());setStage("steps");return;}void action.run("mouse.macros.get",async c=>invoke(c,"macros.get",{id,profileId:bindings?.profileId}),value=>{const macro={...blank(),...value as Macro};setDraft(macro);setStage(macro.mode==="sequence"?"press":"steps");});}
  function save(){stopRecording();void action.run("mouse.macros.save",async c=>{const saved=await invoke(c,"macros.save",{profileId:bindings?.profileId,macro:draft}) as Macro;return {saved,cards:await readLibrary(c,bindings!.profileId)};},({saved,cards})=>{setDraft({...blank(),...saved});setLibrary(cards);},"宏已保存，可在按键页绑定使用。");}
  function remove(){if(!draft.id)return;void action.run("mouse.macros.remove",async c=>{await invoke(c,"macros.remove",{id:draft.id,profileId:bindings?.profileId});return readLibrary(c,bindings!.profileId);},cards=>{setLibrary(cards);setDraft(blank());setStage("steps");},"宏已删除");}
  function assign(slotId:string,restoreDefault=false){void action.run("mouse.bindings.set",async c=>{await invoke(c,"mouse.bindings.set",{profileId:bindings?.profileId,slotId,...(restoreDefault?{restoreDefault:true}:{cardId:assignments[slotId]})});return (await c.request("devices.read",{deviceId,capability:"mouse.bindings"})).value as Bindings;},b=>{setBindings(b);setAssignments(old=>{const next={...old};delete next[slotId];return next;});},"按键已保存");}
  function changeMode(mode:Macro["mode"]){setDraft(old=>{if(mode==="sequence")return {...old,mode,press:old.steps,hold:[],release:[],steps:[]};if(old.mode==="sequence")return {...old,mode,steps:[...old.press,...old.hold,...old.release],press:[],hold:[],release:[]};return {...old,mode};});setStage(mode==="sequence"?"press":"steps");}
  function addManual(){const steps:Step[]=manual==="delay"?[{type:"delay",ms:50}]:manual==="key"?[{type:"key",code:key,down:true,label:keyName(key)},{type:"key",code:key,down:false,label:keyName(key)}]:manual.startsWith("mouse")?[{type:"mouse",button:Number(manual.slice(5)),down:true},{type:"mouse",button:Number(manual.slice(5)),down:false}]:[{type:"wheel",axis:"vertical",positive:manual==="wheelUp"}];if(count+steps.length<=256)append(steps);}
  return <div className="mouse-tools editor-panel">
    <div className="editor-toolbar"><span className="editor-hint">{bindings?`当前配置 · ${bindings.profileName||"默认"}`:mouse.connected?"正在读取当前配置…":"连接鼠标后设置按键和宏。"}</span><div className="editor-spacer"/><button className="btn-ghost" disabled={disabled||recording} onClick={load}>同步设置</button></div>
    <div hidden={panel!=="buttons"}>
      <div className="editor-segments" role="group" aria-label="鼠标按键层"><button aria-pressed={!shifted} onClick={()=>setShifted(false)}>标准按键</button><button aria-pressed={shifted} onClick={()=>setShifted(true)}>G-Shift</button></div>
      {bindings&&!bindings.softwareMode&&<p className="editor-message">切换到软件控制后再设置按键。<button className="btn-ghost" disabled={disabled} onClick={async()=>{await mouse.write("device.onboardMode",false);load();}}>使用软件控制</button></p>}
      <div className="mouse-bindings" aria-label="鼠标按键绑定">{bindings?.buttons.filter(b=>b.shifted===shifted).map(b=><div className="mouse-binding" key={b.slotId}>
        <span className="mouse-binding__number">{b.number}</span><div className="mouse-binding__name"><strong>{buttonNames[b.number]??`按钮 ${b.number}`}</strong><span>{cardName(b.card)}</span></div>
        <select aria-label={`${buttonNames[b.number]??`按钮 ${b.number}`}功能`} disabled={disabled||!bindings.softwareMode} value={assignments[b.slotId]??b.card.id} onChange={e=>setAssignments(old=>({...old,[b.slotId]:e.target.value}))}>
          {!library.some(c=>c.id===b.card.id)&&<option value={b.card.id}>{cardName(b.card)}</option>}{library.map(c=><option value={c.id} key={c.id}>{cardName(c)}</option>)}
        </select><button className="btn-ghost" disabled={disabled||!bindings.softwareMode} onClick={()=>assign(b.slotId,true)}>恢复默认</button><button className="btn-ghost is-accent" disabled={disabled||!bindings.softwareMode||!assignments[b.slotId]||assignments[b.slotId]===b.card.id} onClick={()=>assign(b.slotId)}>应用</button>
      </div>)}</div>
      {shifted&&<p className="editor-hint">将一个按键设为 G-Shift，按住它时使用这一层的功能。</p>}
    </div>
    <div hidden={panel!=="macros"} className="macro-workspace">
      <aside className="macro-library"><button className="btn-ghost is-accent" disabled={disabled||recording} onClick={()=>selectMacro("")}>＋ 新建宏</button><div role="group" aria-label="宏列表">{library.filter(c=>c.type==="SEQUENCE"||!c.readOnly).map(c=><button key={c.id} className="macro-library__item" aria-pressed={draft.id===c.id} disabled={disabled||recording} onClick={()=>selectMacro(c.id)}><span>{cardName(c)}</span>{c.readOnly&&<small>只读</small>}</button>)}</div>{!library.some(c=>c.type==="SEQUENCE"||!c.readOnly)&&<p className="macro-library__empty">保存的宏会显示在这里。</p>}</aside>
      <section className="macro-editor" aria-label="宏编辑器">
        <div className="macro-settings"><div className="editor-fields"><label className="macro-name">名称<input aria-label="宏名称" maxLength={64} placeholder="给这个宏起个名字" value={draft.name} disabled={disabled||!editable||recording} onChange={e=>setDraft(old=>({...old,name:e.target.value}))}/></label><label>执行方式<select aria-label="宏执行方式" value={draft.mode} disabled={disabled||!editable||recording} onChange={e=>changeMode(e.target.value as Macro["mode"])}><option value="once">执行一次</option><option value="hold">按住重复</option><option value="toggle">切换重复</option><option value="sequence">分阶段执行</option></select></label></div>
        <div className="editor-toolbar macro-actions">{draft.id&&!draft.readOnly&&<button className="btn-ghost" disabled={disabled||recording} onClick={remove}>删除宏</button>}<div className="editor-spacer"/><button className="btn-primary" disabled={disabled||recording||!editable||!bindings||!draft.name.trim()||!count} onClick={save}>{action.busy?"请稍候…":"保存宏"}</button></div></div><div className="macro-timeline"><div className="macro-timeline__title"><h2>{draft.name||"新建宏"}</h2><span>{count} 个动作</span></div>
        {!editable?<p className="editor-message">{draft.readOnly?"此宏只允许绑定，不能修改。":"此宏包含暂未支持的动作，可以继续绑定使用。"}</p>:<>
          {draft.mode==="sequence"&&<div className="editor-segments" role="group" aria-label="宏阶段">{([["press","按下"],["hold","按住循环"],["release","松开"]] as const).map(([s,label])=><button key={s} aria-pressed={stage===s} disabled={recording} onClick={()=>setStage(s)}>{label}</button>)}</div>}
          <div ref={recordTarget} tabIndex={recording?0:-1} className={`macro-recorder${recording?" is-recording":""}`} aria-label="键盘录制区" onKeyDown={e=>record(e,true)} onKeyUp={e=>record(e,false)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))stopRecording();}}>
            <span>{recording?"正在录制键盘 · Esc 停止":"只在开始录制后记录键盘动作"}</span><button ref={recordButton} className={`btn-ghost${recording?" is-accent":""}`} disabled={disabled||count>=254} onPointerDown={e=>{if(recording)e.preventDefault();}} onClick={()=>{if(recording){stopRecording(true);return;}pressed.current.clear();lastTime.current=0;recordingRef.current=true;setRecording(true);queueMicrotask(()=>recordTarget.current?.focus());}}>{recording?"停止录制":"录制键盘"}</button>
          </div>
          <ol className="macro-steps" aria-label="宏动作">{currentSteps.map((step,i)=><li key={i}><span className="macro-step__index">{i+1}</span><span className="macro-step__name">{stepName(step)}</span>{step.type==="delay"&&<label className="macro-delay"><input aria-label={`动作 ${i+1} 等待毫秒`} type="number" min={0} max={60000} value={step.ms} disabled={disabled||recording} onChange={e=>setDraft(old=>({...old,[stage]:old[stage].map((v,j)=>j===i?{type:"delay",ms:Math.max(0,Math.min(60000,Number(e.target.value)))}:v)}))}/>ms</label>}<button className="icon-btn" aria-label={`上移动作 ${i+1}`} disabled={disabled||recording||i===0} onClick={()=>setDraft(old=>{const steps=[...old[stage]];[steps[i-1],steps[i]]=[steps[i],steps[i-1]];return {...old,[stage]:steps};})}>↑</button><button className="icon-btn" aria-label={`删除动作 ${i+1}`} disabled={disabled||recording} onClick={()=>setDraft(old=>({...old,[stage]:old[stage].filter((_,j)=>j!==i)}))}>×</button></li>)}{!currentSteps.length&&<li className="macro-steps__empty"><strong>从一段操作开始</strong><span>录制键盘，或在下方添加动作</span></li>}</ol>
          <div className="macro-add"><select aria-label="添加动作类型" disabled={disabled||recording} value={manual} onChange={e=>setManual(e.target.value)}><option value="key">键盘按键</option><option value="delay">等待</option>{[1,2,3,4,5].map(n=><option value={`mouse${n}`} key={n}>{buttonNames[n]}</option>)}<option value="wheelUp">滚轮向上</option><option value="wheelDown">滚轮向下</option></select>{manual==="key"&&<select aria-label="宏动作按键" disabled={disabled||recording} value={key} onChange={e=>setKey(Number(e.target.value))}>{keyChoices.map(k=><option value={k.code} key={k.code}>{k.label}</option>)}</select>}<button className="btn-ghost" disabled={disabled||recording||count>=(manual==="key"||manual.startsWith("mouse")?255:256)} onClick={addManual}>添加动作</button><span className="editor-hint">{count} / 256</span></div>
        </>}

      </div></section>
    </div>
    {action.message&&<p className="editor-message" role="status">{action.message}</p>}
  </div>;
}
