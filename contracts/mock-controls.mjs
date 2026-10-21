/** Stateful browser simulation of the key/macro capabilities. Native modules own hardware I/O. */
export function createMockControls(fail) {
  const libraries=new Map();let sequence=0;
  const invalid=(message='设置格式不正确。')=>fail('invalid_argument',message);
  const integer=(n,min,max)=>{if(!Number.isInteger(n)||n<min||n>max)invalid();return n;};
  function validateMacro(macro){
    if(!macro||typeof macro.name!=='string'||!macro.name.trim()||macro.name.includes('\0')||new TextEncoder().encode(macro.name).length>192)invalid('请输入 1 到 64 个字的宏名称。');
    if(!['once','hold','toggle','sequence'].includes(macro.mode))invalid();
    const pressed=new Set();let count=0;
    function stage(steps=[]){if(!Array.isArray(steps))invalid();count+=steps.length;
      for(const step of steps){
        if(step.type==='delay'){integer(step.ms,0,60000);continue;}
        if(step.type==='wheel'){if(!['vertical','horizontal'].includes(step.axis??'vertical')||typeof step.positive!=='boolean')invalid();continue;}
        if(!['key','mouse'].includes(step.type)||typeof step.down!=='boolean')invalid();
        const id=`${step.type}:${integer(step.type==='key'?step.code:step.button,step.type==='key'?4:1,step.type==='key'?231:8)}`;
        if(step.type==='key'&&step.label!==undefined&&(typeof step.label!=='string'||new TextEncoder().encode(step.label).length>80))invalid();
        if(step.down?pressed.has(id):!pressed.has(id))invalid('按下和松开动作不匹配，请检查动作顺序。');
        if(step.down)pressed.add(id);else pressed.delete(id);
      }
    }
    if(macro.mode==='sequence'){stage(macro.press);const before=[...pressed].sort().join();stage(macro.hold);if([...pressed].sort().join()!==before)invalid('按住阶段的按下和松开需要成对。');stage(macro.release);}else stage(macro.steps);
    if(pressed.size)invalid('请为按下的按键添加松开动作。');if(count<1||count>256)invalid('宏需要包含 1 到 256 个动作。');
  }
  const summary=card=>Object.fromEntries(['id','name','type','readOnly'].map(k=>[k,card[k]]));
  function library(device){if(!libraries.has(device.id)){const map=new Map();for(const b of device.values['mouse.bindings'].value.buttons)map.set(b.card.id,structuredClone(b.card));libraries.set(device.id,map);}return libraries.get(device.id);}
  function binding(raw){return {raw,type:raw[0]===0?(raw.some(Boolean)?'key':'disabled'):raw[0]===3?'media':raw[0]===9?'macro':'special',...(raw[0]===0?{modifier:raw[1],key:raw[2],second:raw[3]}:raw[0]===3?{code:raw[2]+raw[3]*256}:raw[0]===9?{slot:raw[2]}:{})};}
  return {
    reset(id){libraries.delete(id);},
    invoke(device,op,args={}){
      if(op==='keyboard.keymap.set'){
        const layer=args.layer??'normal';if(!['normal','fn'].includes(layer))invalid();
        const map=device.values[layer==='fn'?'keyboard.fnKeymap':'keyboard.keymap'].value;
        if(args.profile!==undefined&&args.profile!==map.profile)fail('profile_changed','键盘配置已切换，请重新同步键位。');
        const key=map.keys.find(k=>k.slot===args.slot);if(!key)invalid('请选择要修改的键。');
        const a=args.action;if(!a||typeof a!=='object')invalid();let raw;
        if(a.type==='key'){const m=integer(a.modifier??0,0,231),s=integer(a.second??0,0,231);if((m&&m<224)||(s&&s<4))invalid();raw=[0,m,integer(a.key,4,231),s];}
        else if(a.type==='media'){if(![182,181,183,205,226,234,233,402,387].includes(a.code))invalid();raw=[3,0,a.code&255,a.code>>8];}
        else if(a.type==='disabled')raw=[0,0,0,0];
        else if(a.type==='default'&&layer==='normal')raw=key.defaultBinding.raw.slice();
        else if(a.type==='restore'){if(!Array.isArray(a.raw)||a.raw.length!==4)invalid();raw=a.raw.map(n=>integer(n,0,255));}
        else invalid();
        const before=structuredClone(key.binding);key.binding=binding(raw);map.matrix.splice(args.slot*4,4,...raw);
        return {before,after:key.binding,verified:true,layer,slot:args.slot};
      }
      const view=device.values['mouse.bindings']?.value;if(!view)fail('unavailable','暂时没有按键设置。');
      if(args.profileId!==undefined&&args.profileId!==view.profileId)fail('profile_changed','当前配置已切换，请重新读取后操作。');
      const cards=library(device),find=id=>cards.get(id)??fail('backend_rejected','没有找到这个宏。');
      if(op==='macros.list'){const offset=integer(args.offset??0,0,10000),limit=integer(args.limit??50,1,100);return {profileId:view.profileId,total:cards.size,offset,items:[...cards.values()].slice(offset,offset+limit).map(summary)};}
      if(op==='macros.get'){const card=find(args.id);return {...structuredClone(card),editable:card.type==='SEQUENCE'&&!card.readOnly};}
      if(op==='macros.save'){
        const m=args.macro;validateMacro(m);
        if(m.id&&find(m.id).readOnly)fail('setting_read_only','此项目只允许绑定，不能修改。');
        const id=m.id||`macro-${++sequence}`;
        const card={id,name:m.name,type:'SEQUENCE',readOnly:false,editable:true,mode:m.mode,...(m.mode==='sequence'?{press:m.press??[],hold:m.hold??[],release:m.release??[]}:{steps:m.steps??[]})};cards.set(id,structuredClone(card));
        for(const b of view.buttons)if(b.card.id===id)b.card=summary(card);
        return {...card,verified:true};
      }
      if(op==='macros.remove'){
        if(find(args.id).readOnly)fail('setting_read_only','此项目只允许绑定，不能修改。');
        if(view.buttons.some(b=>b.card.id===args.id))fail('macro_in_use','这个宏仍被按键使用，请先解除绑定。');cards.delete(args.id);return {removed:true};
      }
      if(op==='mouse.bindings.set'){
        const b=view.buttons.find(b=>b.slotId===args.slotId);if(!b)invalid('请选择这只鼠标的按键。');
        if(!view.softwareMode)fail('setting_read_only','切换到软件控制后再设置按键。');
        const card=find(args.restoreDefault?`button-${b.number}`:args.cardId);b.card=summary(card);return {verified:true,binding:{slotId:b.slotId,cardId:card.id}};
      }
      fail('unsupported_capability','暂不支持此操作。');
    },
    options(device,value){
      if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)invalid();
      const options=device.values['keyboard.options'].value;
      for(const [key,v]of Object.entries(value)){if(!['winLocked','wasdSwapped'].includes(key)||typeof v!=='boolean')invalid();}
      for(const [key,v]of Object.entries(value)){const mask=key==='winLocked'?1:8;options[key]=v;options.raw[0]=v?options.raw[0]|mask:options.raw[0]&~mask;}
      return {...device.values['keyboard.options'],verified:true};
    },
  };
}
