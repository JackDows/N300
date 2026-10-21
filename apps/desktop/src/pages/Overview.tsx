import type {PageId} from "../App";
import {useDevice} from "../device/DeviceContext";
import {useMouse,type MouseReading} from "../device/MouseContext";
import {useHardware} from "../device/HardwareContext";
import {ValueSlider} from "../components/ValueSlider";
import {KeyboardModel} from "../components/KeyboardModel";
export function Overview({navigate}:{navigate(page:PageId):void}){
  const {phase,values,keyboard,kbBusy,set,setKeyboardBrightness}=useDevice(),mouse=useMouse(),{inventory}=useHardware();
  const spk=phase==="connected",count=Number(spk)+Number(keyboard.connected)+Number(mouse.connected);
  const level=keyboard.connected?(keyboard.brightness?.value??keyboard.lighting?.brightness):undefined;
  const stage=mouse.snapshot?.values["mouse.dpiStage"] as MouseReading<string>|undefined;
  const dpi=mouse.connected?stage?.choices?.find(c=>c.value===stage.value)?.label:undefined;
  const source=spk?values.input?.choices.find(c=>c.value===values.input?.value)?.label:undefined;
  const preset=spk?values.preset?.choices.find(c=>c.value===values.preset?.value)?.label:undefined;
  const mouseName=mouse.info?.name??"Logitech 鼠标";
  return <div className="overview"><div className="overview-heading"><div><p>个人设备中心</p><h1>我的设备<span>.</span></h1></div><div className="connected-count"><strong>{String(count).padStart(2,"0")}</strong><span>台外设<br/>已连接</span></div></div><div className="overview-grid">
    <section className="overview-keyboard" aria-label="键盘概览"><div className="overview-label"><span>01 / 输入</span><span>FL·ESPORTS</span></div><div className="overview-keyboard__title"><h2>OG98</h2><button className="round-action" aria-label="打开键盘设置" onClick={()=>navigate("keyboard")}>↗</button></div><button className="overview-keyboard__graphic" aria-label="打开 OG98 按键图" onClick={()=>navigate("keyboard")}><KeyboardModel decorative/></button><ValueSlider label="背光亮度" min={0} max={100} step={25} value={level==null?null:level*25} unit="%" disabled={kbBusy||!keyboard.connected} onCommit={v=>setKeyboardBrightness(v/25)}/>{!keyboard.connected&&<p className="overview-disconnected">{keyboard.phase==="connecting"?"正在连接键盘…":"键盘未连接"}</p>}</section>
    <section className="overview-mouse" aria-label="鼠标概览"><div className="overview-label"><span>02 / 指向</span><span>{mouse.connected?"已连接":"未连接"}</span></div><h2>{mouseName}</h2><p>{mouse.connected?"当前灵敏度":"连接后显示灵敏度"}</p><div className="overview-dpi"><strong>{dpi??"—"}</strong><span>DPI</span></div><div className="overview-dpi-options" role="group" aria-label="首页 DPI 档位">{stage?.choices?.map(c=><button key={c.value} aria-pressed={mouse.connected&&c.value===stage.value} disabled={!mouse.connected||mouse.busy||!stage.writable} onClick={()=>void mouse.write("mouse.dpiStage",c.value)}>{c.label}</button>)}</div><button className="overview-mouse__link" onClick={()=>navigate("mouse")}>按键与宏 <span aria-hidden="true">→</span></button></section>
    <section className="overview-audio" aria-label="音响概览"><div className="overview-label"><span>03 / 声音</span><span>EDIFIER</span></div><div className="overview-audio__controls"><div><h2>N300</h2><span>{spk?[source,preset].filter(Boolean).join(" · ")||"已连接":phase==="connecting"||phase==="starting"?"正在连接…":"音响未连接"}</span></div><div className="overview-volume"><strong>{spk?values.volume?.value??"—":"—"}</strong><span>/ {values.volume?.max??16}</span></div><ValueSlider label="音量" showValue={false} value={spk?values.volume?.value??null:null} min={values.volume?.min??0} max={values.volume?.max??16} step={values.volume?.step??1} disabled={!spk} onCommit={v=>set("volume",v)}/><button className="round-action" aria-label="打开音响设置" onClick={()=>navigate("speaker")}>↗</button></div></section>
  </div><button className="overview-host" onClick={()=>navigate("computer")}><span>我的主机</span><strong>{inventory?[inventory.parts.cpu?.[0]?.name,inventory.parts.gpu?.[0]?.name].filter(Boolean).join(" · ")||"查看硬件信息":"读取硬件信息…"}</strong><span aria-hidden="true">→</span></button></div>;
}
