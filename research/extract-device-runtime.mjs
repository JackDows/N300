import { writeFileSync } from 'node:fs';
import { Cdp } from './cdp.mjs';
const client = await Cdp.connect('http://127.0.0.1:19381');
try {
  const data = await client.evaluate(`(() => {
    const r=window.__OG98_RE,d=r.store.deviceStore.currentDev;if(!d)throw new Error('No selected device');
    const classes=[];let p=d;
    while((p=Object.getPrototypeOf(p))&&p!==Object.prototype){
      const methods={};for(const name of Object.getOwnPropertyNames(p)){
        const value=Object.getOwnPropertyDescriptor(p,name)?.value;
        if(typeof value==='function')methods[name]=Function.prototype.toString.call(value);
      }classes.push({name:p.constructor.name,methods});
    }
    const properties={};for(const name of Object.keys(d)){
      const v=d[name];if(typeof v!=='function')properties[name]=v;
    }
    const stores={};for(const name of ['deviceStore','macroStore','configStore','userLightStore','themeStore','upgradeStore','keyboardTestStore','sleepStore']){
      const s=r.store[name];stores[name]={fields:Object.keys(s),methods:Object.getOwnPropertyNames(Object.getPrototypeOf(s)).filter(x=>x!=='constructor')};
    }
    return {classes,properties,stores,ui:document.body.innerText,deviceFields:Object.keys(d),models:r.models,layout:r.keyLayout};
  })()`);
  writeFileSync(new URL('../artifacts/analysis/device-runtime.json', import.meta.url), JSON.stringify(data, null, 2));
  for(let i=0;i<data.classes.length;i++) for(const [name,source] of Object.entries(data.classes[i].methods)) {
    if(!source.includes('[native code]'))writeFileSync(new URL('../artifacts/analysis/class-'+i+'-'+name+'.js', import.meta.url), '('+source+')');
  }
  console.log(JSON.stringify({classes:data.classes.map(x=>({name:x.name,methods:Object.keys(x.methods),constructorLength:x.methods.constructor?.length})),properties:data.properties,stores:data.stores,ui:data.ui}));
} finally {client.close();}
