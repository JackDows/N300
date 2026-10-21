import {useState} from "react";
import {ConsoleHeader} from "../components/ConsoleHeader";
import {hardwareParts,useHardware} from "../device/HardwareContext";
import {getTransport} from "../device/transport";
import {recordUiError} from "../diagnostics";
export function ComputerConsole({onClose}:{onClose():void}){
 const {inventory,busy,message,refresh}=useHardware();const [opening,setOpening]=useState(false),[notice,setNotice]=useState("");
 async function openMangoDisk(){setOpening(true);setNotice("");try{await(await getTransport()).request("app.mangodisk.open");}catch(e){recordUiError(e,"computer.mangodisk");setNotice("未能打开 MangoDisk，请确认它已安装。");}finally{setOpening(false);}}
 return <div className="console-modal console-modal--computer"><ConsoleHeader title="我的主机" subtitle="硬件与应用" onClose={onClose} actions={<button className="btn-ghost" disabled={busy} onClick={refresh}>{busy?"读取中…":"刷新信息"}</button>}/><div className="hardware-inventory">{hardwareParts.map(part=><section key={part.id} className="hardware-part"><div><span>{String(hardwareParts.indexOf(part)+1).padStart(2,"0")}</span><h2>{part.name}</h2></div><div>{inventory?.parts[part.id]?.length?inventory.parts[part.id]!.map((item,i)=><div className="hardware-item" key={i}><strong>{item.name}</strong>{item.detail&&<span>{item.detail}</span>}</div>):<p>{busy?"读取中…":"暂未读取到信息"}</p>}</div></section>)}</div>{message&&<p className="editor-message" role="status">{message}</p>}<section className="hardware-application"><div><h2>MangoDisk</h2><p>{inventory?.mangodisk?"打开主机管理与系统工具。":"尚未发现 MangoDisk。"}</p></div><button className="btn-primary" disabled={!inventory?.mangodisk||opening} onClick={()=>void openMangoDisk()}>{opening?"打开中…":"打开 MangoDisk ↗"}</button></section>{notice&&<p className="editor-message" role="status">{notice}</p>}</div>;
}
