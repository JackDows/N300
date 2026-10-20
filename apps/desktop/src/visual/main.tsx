import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioRenderer,type StudioState,type DeviceId} from './StudioRenderer';
import layout from '../../../../modules/flesports-og98/assets/layout.json';
import workstation from '../../../../contracts/fixtures/workstation.json';
import '../styles/tokens.css';
import './studio.css';

const names:Record<DeviceId,string>={speaker:'EDIFIER N300',keyboard:'OG98',mouse:'PRO X SUPERLIGHT 2 SE',computer:'我的主机',system:'DeskHub'};
const parts:Record<string,string>={cpu:'处理器',gpu:'显卡',memory:'内存',motherboard:'主板',storage:'存储',network:'网络'};
const start:StudioState={ready:false,active:null,hover:null,hoverSelection:null,selection:null,phase:'desk',error:''};
const CloseIcon=()=> <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;

// §2.1 / §3.6: the keyboard owns the left display area; its inspector is secondary.
// Selection, current binding and pending binding are distinct. One apply action.
// Project tokens: --accent, --text-2/3; spacing 8/12/16/24/32; type 12/14/20/32.
function Studio(){
  const host=useRef<HTMLDivElement>(null),engine=useRef<StudioRenderer|null>(null);
  const [state,setState]=useState(start),[binding,setBinding]=useState('F12'),[applied,setApplied]=useState(false);
  const [bindings,setBindings]=useState<Record<number,string>>({});
  useEffect(()=>{if(!host.current)return;let renderer:StudioRenderer;try{renderer=new StudioRenderer(host.current,setState);}catch(error){console.error('studio.graphics.startup',error);setState({...start,error:'无法启用图形加速，请使用独立预览入口打开。'});return;}engine.current=renderer;(window as any).__studio=renderer;return()=>{renderer.dispose();engine.current=null;delete(window as any).__studio;};},[]);
  useEffect(()=>{if(state.selection?.kind==='key'){setBinding(bindings[state.selection.slot]??state.selection.label);setApplied(false);}},[state.selection]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();if(engine.current?.state.selection)engine.current.clearSelection();else engine.current?.close();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  const chosenPart=state.selection?.kind==='part'?state.selection.id:null;
  const chosenKey=state.selection?.kind==='key'?state.selection:null;
  const savedBinding=chosenKey?(bindings[chosenKey.slot]??chosenKey.label):'';
  const info=chosenPart?(workstation.parts as Record<string,{name:string;detail?:string}[]>)[chosenPart]:null;
  const hint=state.hoverSelection?.kind==='key'?state.hoverSelection.label:state.hoverSelection?.kind==='part'?parts[state.hoverSelection.id]:chosenKey?chosenKey.label:state.active==='keyboard'?'选择一个按键':state.active==='computer'?'选择机箱内的部件':state.active==='mouse'?'PRO X SUPERLIGHT 2 SE':state.active==='speaker'?'EDIFIER N300':state.hover?names[state.hover]:'选择桌面上的设备';
  const unchanged=state.selection?.kind==='key'&&binding===(bindings[state.selection.slot]??state.selection.label);
  return <div className={`studio${state.active?' has-focus':''}`} data-phase={state.phase}>
    <div className="studio-scene" ref={host}/>
    <header className="studio-header"><a className="studio-brand" href="#" onClick={event=>{event.preventDefault();engine.current?.close();}}><i/>DeskHub</a><nav aria-label="场景视图">{([['keyboard','键盘'],['mouse','鼠标'],['computer','主机']] as const).map(([id,name])=><button key={id} disabled={!state.ready||!!state.active&&state.active!==id} aria-pressed={state.active===id} onClick={()=>state.active===id?engine.current?.close():engine.current?.open(id)}>{name}</button>)}<span className="studio-preview">视觉样板</span></nav></header>
    {state.active&&<div className="studio-focus-heading"><div><span className="studio-eyebrow">{state.active==='computer'?'WORKSTATION':state.active==='keyboard'?'KEYBOARD':state.active==='mouse'?'MOUSE':'DEVICE'}</span><h1>{names[state.active]}</h1></div><button className="studio-close" aria-label="返回桌面" onClick={()=>engine.current?.close()}><CloseIcon/></button></div>}
    {(!state.ready||state.error)&&<div className="studio-loading" role="status">{state.error||'正在准备桌面…'}</div>}
    {state.active==='keyboard'&&<section className="studio-control studio-control--key" aria-label="按键设置">
      <header><div><span className="studio-inspector-title">按键映射</span><span className="studio-layer-label">普通层</span></div>{chosenKey&&<button aria-label="关闭按键设置" onClick={()=>engine.current?.clearSelection()}><CloseIcon/></button>}</header>
      {chosenKey?<>
        <div className="studio-key-summary"><div className="studio-key-token">{chosenKey.label}</div><div><span>当前功能</span><strong>{savedBinding}</strong></div></div>
        <label className="studio-key-field">设置功能<span className="studio-select"><select aria-label="预览按键功能" value={binding} onChange={event=>{setBinding(event.target.value);setApplied(false);}}>{[...new Set([chosenKey.label,'F12','F13','播放 / 暂停','静音','禁用'])].map(name=><option key={name}>{name}</option>)}</select><svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span></label>
        <footer><button className="studio-reset" disabled={binding===chosenKey.label} onClick={()=>{setBinding(chosenKey.label);setApplied(false);}}>恢复原键</button><button className="studio-primary" disabled={unchanged} onClick={()=>{setBindings({...bindings,[chosenKey.slot]:binding});setApplied(true);}}>{applied?'已应用':'应用到预览'}</button></footer>
      </>:<div className="studio-key-empty"><svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="8" y="7" width="30" height="30" rx="7" stroke="currentColor"/><path d="M14 18v-5h5M27 31h5v-5M24 21l16 9-8 2-3 8-5-19Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg><strong>选择一个按键</strong><p>点击键盘上的按键，<br/>在这里设置它的功能。</p></div>}
    </section>}
    {chosenPart&&<section className="studio-control studio-control--part" aria-label="部件信息"><header><span>{parts[chosenPart]}</span><button aria-label="关闭部件信息" onClick={()=>engine.current?.clearSelection()}><CloseIcon/></button></header><div className="studio-part-list">{info?.map((item,i)=><div key={i}><strong>{item.name}</strong>{item.detail&&<span>{item.detail}</span>}</div>)}</div></section>}
    <div className="studio-caption" aria-live="polite">{hint}</div>
    {state.active&&<div className="studio-return-hint">点击空白处返回<span>Esc</span></div>}
    {state.active==='keyboard'&&<div className="studio-accessible-keys" aria-label="键盘按键">{layout.map(key=><button key={key.slot} onClick={()=>engine.current?.selectKey(key.slot)} onFocus={()=>engine.current?.selectKey(key.slot)} aria-label={`按键 ${key.label}`}>{key.label}</button>)}</div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Studio/>);
