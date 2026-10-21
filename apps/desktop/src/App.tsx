import { useRef, useState } from "react";
import { ToastPill } from "./components/Toast";
import { TitleBar } from "./components/TitleBar";
import { useDevice } from "./device/DeviceContext";
import { UpdateNotice } from "./updates/UpdatePanel";
import { Overview } from "./pages/Overview";
import { SpeakerConsole } from "./pages/SpeakerConsole";
import { KeyboardConsole } from "./pages/KeyboardConsole";
import { MouseConsole } from "./pages/MouseConsole";
import { ComputerConsole } from "./pages/ComputerConsole";
import { SystemConsole } from "./pages/SystemConsole";
import { useMouse } from "./device/MouseContext";
import { HardwareProvider } from "./device/HardwareContext";
import "./styles/workbench.css";

export type PageId="overview"|"speaker"|"keyboard"|"mouse"|"computer"|"system";
const routes:PageId[]=["overview","speaker","keyboard","mouse","computer","system"];
const initialPage=():PageId=>{const v=new URLSearchParams(location.search).get("view");return routes.includes(v as PageId)?v as PageId:"overview";};
// Approved B: typography and flat geometry drive hierarchy. Device workspace is primary;
// connection metadata is secondary. Editors retain their state across navigation.
export default function App(){
  const {phase,keyboard,toast}=useDevice(),mouse=useMouse();
  const [page,setPage]=useState<PageId>(initialPage),[visited,setVisited]=useState<Set<PageId>>(()=>new Set([initialPage()]));
  const main=useRef<HTMLElement>(null);
  const connected=Number(phase==="connected")+Number(keyboard.connected)+Number(mouse.connected);
  function navigate(next:PageId){setVisited(old=>new Set([...old,next]));setPage(next);const url=new URL(location.href);url.searchParams.set("view",next);history.replaceState(null,"",url);main.current?.scrollTo(0,0);}
  const back=()=>navigate("overview");
  const nav=[{id:"overview",name:"我的设备",detail:"",online:false},{id:"speaker",name:"N300",detail:"音响",online:phase==="connected"},{id:"keyboard",name:"OG98",detail:"键盘",online:keyboard.connected},{id:"mouse",name:mouse.info?.name??"Logitech 鼠标",detail:"鼠标",online:mouse.connected},{id:"computer",name:"我的主机",detail:"硬件与应用",online:false}] as const;
  return <HardwareProvider><div className="app graphic-workbench"><TitleBar/><UpdateNotice onOpen={()=>navigate("system")}/><div className="workbench-layout">
    <aside className="device-navigation"><button className="workbench-brand" onClick={back} aria-label="返回设备总览">DeskHub<span>.</span></button><span className="nav-caption">工作空间</span><nav aria-label="设备导航">{nav.map((item,i)=><button key={item.id} className={`device-nav-item${page===item.id?" is-current":""}`} onClick={()=>navigate(item.id)} aria-current={page===item.id?"page":undefined} aria-label={item.id==="speaker"?"音响设置":item.id==="keyboard"?"键盘设置":item.id==="mouse"?"鼠标设置":item.name}><span className="nav-index">{String(i+1).padStart(2,"0")}</span><span className="nav-device-name">{item.name}{item.detail&&<small>{item.detail}{["speaker","keyboard","mouse"].includes(item.id)&&<span> · {item.online?"已连接":"未连接"}</span>}</small>}</span><span className="nav-current-arrow" aria-hidden="true">↗</span></button>)}</nav><button className={`application-nav${page==="system"?" is-current":""}`} aria-current={page==="system"?"page":undefined} onClick={()=>navigate("system")}>设备与应用 <span aria-hidden="true">↗</span></button></aside>
    <main className="workbench-main" ref={main} aria-label="设备工作区">
      {visited.has("overview")&&<section hidden={page!=="overview"}><Overview navigate={navigate}/></section>}
      {visited.has("speaker")&&<section hidden={page!=="speaker"}><SpeakerConsole onClose={back}/></section>}
      {visited.has("keyboard")&&<section hidden={page!=="keyboard"}><KeyboardConsole onClose={back} active={page==="keyboard"}/></section>}
      {visited.has("mouse")&&<section hidden={page!=="mouse"}><MouseConsole onClose={back} active={page==="mouse"}/></section>}
      {visited.has("computer")&&<section hidden={page!=="computer"}><ComputerConsole onClose={back}/></section>}
      {visited.has("system")&&<section hidden={page!=="system"}><SystemConsole onClose={back} onSelectDevice={navigate}/></section>}
    </main></div><footer className="workbench-footer"><span><i aria-hidden="true"/>{connected} 台外设已连接</span><span>个人设备中心</span></footer><ToastPill toast={toast}/></div></HardwareProvider>;
}
