import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioRenderer,type StudioState,type DeviceId} from './StudioRenderer';
import layout from '../../../../modules/flesports-og98/assets/layout.json';
import workstation from '../../../../contracts/fixtures/workstation.json';
import '../styles/tokens.css';
import './studio.css';

const names:Record<DeviceId,string>={speaker:'EDIFIER N300',keyboard:'OG98',mouse:'PRO X SUPERLIGHT 2 SE',computer:'我的主机',system:'DeskHub'};
const parts:Record<string,string>={cpu:'处理器',gpu:'显卡',memory:'内存',motherboard:'主板',storage:'存储',network:'网络'};
const start:StudioState={ready:false,active:null,hover:null,selection:null,phase:'desk',error:''};

// §2.1: the device is primary. §2.8: one contextual apply action, no permanent inspector wall.
function Studio(){
  const host=useRef<HTMLDivElement>(null),engine=useRef<StudioRenderer|null>(null);
  const [state,setState]=useState(start),[binding,setBinding]=useState('F12'),[applied,setApplied]=useState(false);
  const [bindings,setBindings]=useState<Record<number,string>>({});
  useEffect(()=>{if(!host.current)return;let renderer:StudioRenderer;try{renderer=new StudioRenderer(host.current,setState);}catch(error){console.error('studio.graphics.startup',error);setState({...start,error:'无法启用图形加速，请使用独立预览入口打开。'});return;}engine.current=renderer;(window as any).__studio=renderer;return()=>{renderer.dispose();engine.current=null;delete(window as any).__studio;};},[]);
  useEffect(()=>{if(state.selection?.kind==='key'){setBinding(bindings[state.selection.slot]??state.selection.label);setApplied(false);}},[state.selection]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();if(engine.current?.state.selection)engine.current.clearSelection();else engine.current?.close();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  const chosenPart=state.selection?.kind==='part'?state.selection.id:null;
  const info=chosenPart?(workstation.parts as Record<string,{name:string;detail?:string}[]>)[chosenPart]:null;
  return <div className={`studio${state.active?' has-focus':''}`} data-phase={state.phase}>
    <div className="studio-scene" ref={host}/>
    <header className="studio-header"><a className="studio-brand" href="#" onClick={event=>{event.preventDefault();engine.current?.close();}}><i/>DeskHub</a><nav aria-label="场景视图">{([['keyboard','键盘'],['computer','主机']] as const).map(([id,name])=><button key={id} disabled={!state.ready||!!state.active&&state.active!==id} aria-pressed={state.active===id} onClick={()=>state.active===id?engine.current?.close():engine.current?.open(id)}>{name}</button>)}<span className="studio-preview">视觉样板</span></nav></header>
    {state.active&&<div className="studio-focus-heading"><div><span className="studio-eyebrow">{state.active==='computer'?'WORKSTATION':state.active==='keyboard'?'KEYBOARD':'DEVICE'}</span><h1>{names[state.active]}</h1></div><button className="studio-close" aria-label="返回桌面" onClick={()=>engine.current?.close()}>×</button></div>}
    {(!state.ready||state.error)&&<div className="studio-loading" role="status">{state.error||'正在准备桌面…'}</div>}
    {state.selection?.kind==='key'&&<section className="studio-control studio-control--key" aria-label="按键设置"><header><div><span>按键</span><strong>{state.selection.label}</strong></div><button aria-label="关闭按键设置" onClick={()=>engine.current?.clearSelection()}>×</button></header><label>功能<select aria-label="预览按键功能" value={binding} onChange={event=>{setBinding(event.target.value);setApplied(false);}}>{[...new Set([state.selection.label,'F12','F13','播放 / 暂停','静音','禁用'])].map(name=><option key={name}>{name}</option>)}</select></label><footer><span>{applied?'预览已更新':'普通层'}</span><button className="studio-primary" onClick={()=>{if(state.selection?.kind==='key')setBindings({...bindings,[state.selection.slot]:binding});setApplied(true);}}>应用到预览</button></footer></section>}
    {chosenPart&&<section className="studio-control studio-control--part" aria-label="部件信息"><header><span>{parts[chosenPart]}</span><button aria-label="关闭部件信息" onClick={()=>engine.current?.clearSelection()}>×</button></header><div className="studio-part-list">{info?.map((item,i)=><div key={i}><strong>{item.name}</strong>{item.detail&&<span>{item.detail}</span>}</div>)}</div></section>}
    <div className="studio-caption" aria-live="polite">{state.active==='keyboard'?'选择一个按键':state.active==='computer'?'选择机箱内的部件':state.hover?names[state.hover]:'将鼠标移至设备'}</div>
    {state.active&&<div className="studio-return-hint">点击空白处返回<span>Esc</span></div>}
    {state.active==='keyboard'&&<div className="studio-accessible-keys" aria-label="键盘按键">{layout.map(key=><button key={key.slot} onClick={()=>engine.current?.selectKey(key.slot)} onFocus={()=>engine.current?.selectKey(key.slot)} aria-label={`按键 ${key.label}`}>{key.label}</button>)}</div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Studio/>);
