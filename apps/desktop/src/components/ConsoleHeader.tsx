import {useId,type ReactNode} from "react";
export function ConsoleHeader({title,subtitle,status,actions,onClose}:{title:ReactNode;subtitle:string;status?:"ok"|"busy"|"off";actions?:ReactNode;onClose():void}){
 const id=useId();
 return <header className="console-modal__header"><div className="console-modal__identity"><h1 className="console-modal__title" id={id}>{title}</h1><p className="console-modal__subtitle">{status&&<span className={`status-dot is-${status}`} aria-hidden="true"/>}{subtitle}</p></div><div className="console-modal__nav">{actions}<button className="console-back" aria-label="返回总览" title="返回设备总览" onClick={onClose}>↗</button></div></header>;
}
