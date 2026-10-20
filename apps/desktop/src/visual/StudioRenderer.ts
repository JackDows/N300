import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RectAreaLightUniformsLib} from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import modelUrl from '../../../../artifacts/visual/studio-v1/deskhub-studio.glb?url';

export type DeviceId='speaker'|'keyboard'|'mouse'|'computer'|'system';
export type Selection={kind:'key';slot:number;label:string}|{kind:'part';id:string}|null;
export interface StudioState {ready:boolean;active:DeviceId|null;hover:DeviceId|null;hoverSelection:Selection;selection:Selection;phase:'desk'|'opening'|'focused'|'closing';error:string}
type Pose={position:THREE.Vector3;quaternion:THREE.Quaternion;scale:THREE.Vector3};
type Transition={from:Pose;to:Pose;start:number;duration:number;dimFrom:number;dimTo:number;doorFrom:number;doorTo:number;done():void};
const initial:StudioState={ready:false,active:null,hover:null,hoverSelection:null,selection:null,phase:'desk',error:''};
const capture=(object:THREE.Object3D):Pose=>({position:object.position.clone(),quaternion:object.quaternion.clone(),scale:object.scale.clone()});
const ease=(t:number)=>t*t*t*(t*(t*6-15)+10);

/** One model per device across every pose. Picking and feedback use its actual geometry. */
export class StudioRenderer {
  state:StudioState={...initial};
  private renderer:THREE.WebGLRenderer;
  private scene=new THREE.Scene();
  private foreground=new THREE.Scene();
  private dimScene=new THREE.Scene();
  private dimCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  private dimMaterial=new THREE.MeshBasicMaterial({color:0x060b0e,transparent:true,opacity:0,depthTest:false,depthWrite:false,toneMapped:false});
  private camera=new THREE.PerspectiveCamera(28,1.6,.02,30);
  private cameraOrigin=new THREE.Vector3();
  private cameraTarget=new THREE.Vector3(.03,.20,-.04);
  private roots=new Map<DeviceId,THREE.Object3D[]>();
  private keys=new Map<number,THREE.Object3D>();
  private parts=new Map<string,THREE.Object3D>();
  private materials=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>();
  private originals=new Map<THREE.Object3D,{parent:THREE.Object3D;pose:Pose}>();
  private selected:THREE.Object3D|null=null;
  private highlighted:THREE.Object3D|null=null;
  private door:THREE.Object3D|null=null;
  private animation:Transition|null=null;
  private hoverAnimations=new Map<THREE.Object3D,{from:number;to:number;start:number;duration:number}>();
  private pointer=new THREE.Vector2();
  private raycaster=new THREE.Raycaster();
  private observer:ResizeObserver;
  private abort=new AbortController();
  private frame=0;
  private disposed=false;
  private frameCount=0;
  private width=1;
  private height=1;
  private environment:THREE.WebGLRenderTarget;
  private ao:GTAOPass|null=null;
  private aoTarget=new THREE.WebGLRenderTarget(1,1);
  private aoMaterial=new THREE.ShaderMaterial({uniforms:{map:{value:null},strength:{value:.42}},vertexShader:'varying vec2 uv0;void main(){uv0=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform sampler2D map;uniform float strength;varying vec2 uv0;void main(){float ao=texture2D(map,uv0).r;gl_FragColor=vec4(vec3(mix(1.,ao,strength)),1.);}',depthTest:false,depthWrite:false,transparent:true,premultipliedAlpha:true,blending:THREE.MultiplyBlending});
  private aoQuad=new FullScreenQuad(this.aoMaterial);
  private glass:THREE.Mesh[]=[];
  private modelBytes=0;
  private caseLight:THREE.PointLight|null=null;
  private colorTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  private bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.06,.25,3.0);
  private output=new OutputPass();

  constructor(private host:HTMLElement,private onState:(state:StudioState)=>void){
    RectAreaLightUniformsLib.init();
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',failIfMajorPerformanceCaveat:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=.96;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.VSMShadowMap;
    this.renderer.autoClear=false;
    this.output.renderToScreen=true;
    this.renderer.domElement.setAttribute('aria-label','DeskHub 可交互桌搭');
    this.host.appendChild(this.renderer.domElement);
    this.scene.background=new THREE.Color('#12171b');
    const room=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(this.renderer);
    this.environment=pmrem.fromScene(room,.04);room.dispose();pmrem.dispose();
    this.scene.environment=this.foreground.environment=this.environment.texture;
    this.scene.environmentIntensity=.26;
    this.foreground.environmentIntensity=.34;
    this.lighting(this.scene);this.lighting(this.foreground,true);
    this.dimScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.dimMaterial));
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    this.renderer.domElement.addEventListener('pointermove',this.move);
    this.renderer.domElement.addEventListener('pointerleave',this.leave);
    this.renderer.domElement.addEventListener('click',this.click);
    this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
    this.load().catch(error=>{if(!this.disposed){console.error(error);this.publish({error:'桌面未能载入，请刷新后重试。'});}});
  }

  private lighting(scene:THREE.Scene,focused=false){
    scene.add(new THREE.HemisphereLight(0xe3edf2,0x30383b,.22));
    const key=new THREE.DirectionalLight(0xe9eff2,.7);key.position.set(-.8,1.8,.8);key.target.position.set(0,.15,0);
    key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-1.4;key.shadow.camera.right=1.4;key.shadow.camera.top=1.2;key.shadow.camera.bottom=-1.2;key.shadow.camera.near=.1;key.shadow.camera.far=5;key.shadow.bias=-.0002;key.shadow.normalBias=.0015;
    key.shadow.radius=5;key.shadow.blurSamples=8;scene.add(key,key.target);
    const wash=new THREE.SpotLight(0xd4e7eb,2.4,4,.8,1,2);wash.position.set(-.5,1.4,.65);wash.target.position.set(-.1,.02,-.1);scene.add(wash,wash.target);
    const softbox=new THREE.RectAreaLight(0xe9eff2,focused?3.6:3,1.6,.95);softbox.position.set(-.6,1.7,.7);softbox.lookAt(0,.15,0);scene.add(softbox);
    const fill=new THREE.RectAreaLight(0xfff7ec,1.8,1.2,.7);fill.position.set(.8,.9,1.1);fill.lookAt(0,.2,0);scene.add(fill);
    const rim=new THREE.RectAreaLight(0xa9d5de,2.4,.9,.35);rim.position.set(.2,1.1,-.6);rim.lookAt(0,.25,0);scene.add(rim);
    const wall=new THREE.SpotLight(0x629baf,2,2,.95,1,2);wall.position.set(-.2,.1,-.4);wall.target.position.set(-.15,.35,-.66);scene.add(wall,wall.target);
  }

  private async load(){
    const response=await fetch(modelUrl,{signal:this.abort.signal});if(!response.ok)throw Error(`Model ${response.status}`);
    const bytes=await response.arrayBuffer();this.modelBytes=bytes.byteLength;
    const gltf=await new GLTFLoader().parseAsync(bytes,'');
    if(this.disposed){this.disposeModel(gltf.scene);return;}
    this.scene.add(gltf.scene);
    if(gltf.cameras[0] instanceof THREE.PerspectiveCamera){this.camera=gltf.cameras[0];this.camera.near=.02;this.camera.far=30;}
    this.camera.updateWorldMatrix(true,false);this.cameraOrigin.copy(this.camera.position);
    gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('camera.target'))?.getWorldPosition(this.cameraTarget);
    gltf.scene.traverse(object=>{
      const id=object.userData.device_id as DeviceId|undefined;
      if(id){const list=this.roots.get(id)??[];list.push(object);this.roots.set(id,list);this.originals.set(object,{parent:object.parent!,pose:capture(object)});}
      if(typeof object.userData.slot_id==='number')this.keys.set(object.userData.slot_id,object);
      if(object.userData.part_id)this.parts.set(object.userData.part_id,object);
      if(object.userData.animation_role==='side_panel')this.door=object;
      if(object instanceof THREE.Mesh){
        const materials=Array.isArray(object.material)?object.material:[object.material];
        for(const material of materials)for(const value of Object.values(material))if(value instanceof THREE.Texture)value.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
        const glass=materials.some(m=>m instanceof THREE.MeshPhysicalMaterial&&m.transmission>.5);
        object.castShadow=!glass&&!object.name.startsWith('legend');object.receiveShadow=!glass;
        if(glass){object.userData.ignorePick=true;object.renderOrder=2;this.glass.push(object);for(const material of materials){if(material instanceof THREE.MeshPhysicalMaterial){material.transmission=0;material.transparent=true;material.opacity=.04;material.depthWrite=false;material.side=THREE.DoubleSide;material.forceSinglePass=true;material.roughness=.12;material.envMapIntensity=.15;material.specularIntensity=.25;}}}
      }
    });
    this.caseLight=new THREE.PointLight(0xb9d4db,.045,.65,2);this.caseLight.position.set(-.05,.38,.02);this.roots.get('computer')?.[0].add(this.caseLight);
    this.ao=new GTAOPass(this.scene,this.camera,512,512);this.ao.output=GTAOPass.OUTPUT.Off;this.ao.updateGtaoMaterial({radius:.045,distanceExponent:1,thickness:1,scale:1,samples:16});this.ao.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:4,rings:2,samples:16});
    this.aoMaterial.uniforms.map.value=this.ao.gtaoMap;
    this.resize();
    // The foreground has no interior light when a peripheral is selected. Warm
    // that lighting variant before accepting input, rather than compiling it on
    // the user's first click. The clone shares assets and is never displayed.
    await this.renderer.compileAsync(this.scene,this.camera);
    const warm=gltf.scene.clone(true);warm.traverse(object=>{if(object instanceof THREE.Light)object.visible=false;});
    this.foreground.add(warm);
    try {
      await this.renderer.compileAsync(this.foreground,this.camera);
      // Drivers can defer pipeline creation and shadow/normal-pass programs
      // until the first draw, even after compileAsync has resolved.
      this.renderer.setRenderTarget(this.colorTarget);this.renderer.clear();
      this.renderer.render(this.foreground,this.camera);this.occlusion(this.foreground);
      this.renderer.getContext().finish();
    } finally {this.foreground.remove(warm);}
    if(this.disposed)return;
    cancelAnimationFrame(this.frame);this.frame=0;
    await new Promise<void>(resolve=>requestAnimationFrame(now=>{this.render(now);resolve();}));
    if(!this.disposed)this.publish({ready:true});
  }

  private publish(patch:Partial<StudioState>){this.state={...this.state,...patch};this.onState(this.state);}

  private resize(){
    this.width=Math.max(1,this.host.clientWidth);this.height=Math.max(1,this.host.clientHeight);
    this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;
    const dpr=this.renderer.getPixelRatio();this.colorTarget.setSize(Math.round(this.width*dpr),Math.round(this.height*dpr));this.bloom.setSize(Math.round(this.width*dpr),Math.round(this.height*dpr));
    this.ao?.setSize(this.width,this.height);
    if(this.cameraOrigin.lengthSq()){
      const fit=Math.max(1,1.6/this.camera.aspect);
      this.camera.position.copy(this.cameraTarget).add(this.cameraOrigin.clone().sub(this.cameraTarget).multiplyScalar(fit));
    }
    this.camera.updateProjectionMatrix();this.camera.updateWorldMatrix(true,false);
    if(this.selected&&this.state.phase==='focused'){const pose=this.focusPose(this.state.active!,this.selected);this.selected.position.copy(pose.position);this.selected.quaternion.copy(pose.quaternion);this.selected.scale.copy(pose.scale);}
    else if(this.selected&&this.state.phase==='opening'&&this.animation)this.animation.to=this.focusPose(this.state.active!,this.selected);
    this.requestFrame();
  }

  private focusPose(id:DeviceId,object:THREE.Object3D):Pose{
    const distance=2.25;
    const h=2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*distance,w=h*this.camera.aspect;
    const original=this.originals.get(object)!.pose;
    const wideKeyboard=this.width>=1180;
    const keyboardWidth=wideKeyboard?(this.width-416)/this.width:.84;
    const ratio=id==='keyboard'?Math.min(w*keyboardWidth/.400,h*(wideKeyboard?.48:.44)/.154):id==='computer'?Math.min(h*.60/.465,w*.52/.55):id==='mouse'?Math.min(h*.53/.13,w*.5/.07):id==='speaker'?Math.min(h*.59/.168,w*.46/.105):Math.min(w*.75/.615,h*.7/.52);
    const quaternion=original.quaternion.clone();
    if(id==='keyboard'||id==='mouse')quaternion.copy(this.camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),THREE.MathUtils.degToRad(id==='keyboard'?73:67)));
    if(id==='mouse')quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-.20));
    const localCenter=id==='keyboard'?new THREE.Vector3(0,.018,0):id==='computer'?new THREE.Vector3(0,.235,0):id==='mouse'?new THREE.Vector3(0,.023,0):id==='speaker'?new THREE.Vector3(0,.09,0):new THREE.Vector3(0,.27,0);
    const center=new THREE.Vector3(id==='keyboard'&&wideKeyboard?-w*160/this.width:id==='computer'?w*.06:0,id==='keyboard'?-h*(wideKeyboard?.035:.18):-h*.01,-distance).applyMatrix4(this.camera.matrixWorld);
    const scale=new THREE.Vector3(ratio,ratio,ratio);
    return{position:center.sub(localCenter.multiply(scale).applyQuaternion(quaternion)),quaternion,scale};
  }

  open(id:DeviceId,clickedRoot?:THREE.Object3D){
    if(!this.state.ready)return;
    // A native resize can precede ResizeObserver delivery. Start in the current
    // layout and keep the target responsive while the opening animation runs.
    this.resize();
    if(this.selected){if(this.state.active===id&&this.state.phase==='closing'){this.publish({phase:'opening'});this.animateTo(this.focusPose(id,this.selected),.66,id==='computer'?-1.22:0,()=>this.publish({phase:'focused'}));}return;}
    const candidates=this.roots.get(id),root=clickedRoot&&candidates?.includes(clickedRoot)?clickedRoot:candidates?.[0];if(!root)return;
    this.restoreHover(root);this.hoverAnimations.delete(root);this.highlight(null);
    this.foreground.attach(root);this.selected=root;
    this.publish({active:id,selection:null,phase:'opening',hover:null,hoverSelection:null});
    this.animateTo(this.focusPose(id,root),.66,id==='computer'?-1.22:0,()=>this.publish({phase:'focused'}));
  }

  close(){
    if(!this.selected||this.state.phase==='closing')return;
    const object=this.selected,original=this.originals.get(object)!;
    this.highlight(null);this.publish({selection:null,hoverSelection:null,phase:'closing'});
    this.animateTo(original.pose,0,0,()=>{
      original.parent.add(object);object.position.copy(original.pose.position);object.quaternion.copy(original.pose.quaternion);object.scale.copy(original.pose.scale);
      this.selected=null;this.publish({active:null,phase:'desk',selection:null});
    });
  }

  private animateTo(to:Pose,dimTo:number,doorTo:number,done:()=>void){
    if(!this.selected)return;
    this.animation={from:capture(this.selected),to,start:performance.now(),duration:matchMedia('(prefers-reduced-motion: reduce)').matches?1:650,dimFrom:this.dimMaterial.opacity,dimTo,doorFrom:this.door?.rotation.y??0,doorTo,done};
    this.requestFrame();
  }

  selectKey(slot:number){const key=this.keys.get(slot);if(!key||this.state.active!=='keyboard')return;this.highlight(key);this.publish({selection:{kind:'key',slot,label:key.userData.key_label.replaceAll('\n',' ')}});this.requestFrame();}
  selectPart(id:string){const part=this.parts.get(id);if(!part||this.state.active!=='computer')return;this.highlight(part);this.publish({selection:{kind:'part',id}});this.requestFrame();}
  clearSelection(){this.highlight(null);this.publish({selection:null});this.requestFrame();}

  private highlight(object:THREE.Object3D|null,hover=false){
    if(this.highlighted===object)return;
    for(const [mesh,original] of this.materials){const current=Array.isArray(mesh.material)?mesh.material:[mesh.material];for(const material of current)material.dispose();mesh.material=original;}
    this.materials.clear();this.highlighted=object;
    object?.traverse(node=>{
      if(!(node instanceof THREE.Mesh)||node.name.startsWith('legend')||object.userData.part_id==='cpu'&&node.name.startsWith('cpucoolant'))return;
      this.materials.set(node,node.material);
      const update=(material:THREE.Material)=>{const clone=material.clone();if(clone instanceof THREE.MeshStandardMaterial){clone.color.lerp(new THREE.Color('#82dbe0'),hover?.035:object?.userData.part_id?.12:.23);clone.emissive.set('#64b9c0');clone.emissiveIntensity=hover?.014:.10;}return clone;};
      node.material=Array.isArray(node.material)?node.material.map(update):update(node.material);
    });
  }

  private hit(event:PointerEvent|MouseEvent){
    const box=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-box.x)/box.width*2-1,-(event.clientY-box.y)/box.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const objects=this.selected?[this.selected]:[...this.roots.values()].flat();
    const hit=this.raycaster.intersectObjects(objects,true).find(hit=>!hit.object.userData.ignorePick);
    let object=hit?.object;
    while(object){
      if(this.selected&&(object.userData.slot_id!==undefined||object.userData.part_id))return object;
      if(object.userData.device_id)return object;
      object=object.parent??undefined;
    }
    return null;
  }

  private move=(event:PointerEvent)=>{
    if(!this.state.ready||this.state.phase==='closing'||this.state.phase==='opening')return;
    const hit=this.hit(event);this.renderer.domElement.style.cursor=hit?'pointer':'default';
    if(this.selected){
      const hoverSelection:Selection=typeof hit?.userData.slot_id==='number'?{kind:'key',slot:hit.userData.slot_id,label:hit.userData.key_label.replaceAll('\n',' ')}:hit?.userData.part_id?{kind:'part',id:hit.userData.part_id}:null;
      if(JSON.stringify(hoverSelection)!==JSON.stringify(this.state.hoverSelection))this.publish({hoverSelection});
      return;
    }
    const id=(hit?.userData.device_id??null) as DeviceId|null;
    if(id===this.state.hover&&hit===this.highlighted)return;
    this.restoreHover();this.highlight(hit,true);this.publish({hover:id});
    if(hit&&id){const base=this.originals.get(hit)!.pose.position.y;this.hoverAnimations.set(hit,{from:hit.position.y,to:base+.009,start:performance.now(),duration:200});}
    this.requestFrame();
  };
  private restoreHover(except?:THREE.Object3D){
    for(const roots of this.roots.values())for(const root of roots){
      if(root===this.selected||root===except)continue;
      const target=this.originals.get(root)!.pose.position.y;
      if(Math.abs(root.position.y-target)>1e-7)this.hoverAnimations.set(root,{from:root.position.y,to:target,start:performance.now(),duration:240});
      else this.hoverAnimations.delete(root);
    }
  }
  private leave=()=>{if(!this.selected){this.restoreHover();this.highlight(null);this.publish({hover:null});this.requestFrame();}else if(this.state.hoverSelection)this.publish({hoverSelection:null});};
  private click=(event:MouseEvent)=>{
    if(this.state.phase==='opening'||this.state.phase==='closing')return;
    const hit=this.hit(event);
    if(!this.selected){if(hit?.userData.device_id)this.open(hit.userData.device_id,hit);return;}
    if(!hit){this.close();return;}
    if(typeof hit.userData.slot_id==='number')this.selectKey(hit.userData.slot_id);
    else if(hit.userData.part_id)this.selectPart(hit.userData.part_id);
  };
  private contextLost=(event:Event)=>{event.preventDefault();this.publish({error:'桌面显示已中断，请刷新后重试。'});};

  private requestFrame(){if(!this.frame&&!this.disposed)this.frame=requestAnimationFrame(this.render);}
  private render=(now:number)=>{
    this.frame=0;if(this.disposed)return;
    if(this.animation&&this.selected){
      const animation=this.animation,t=Math.min(1,(now-animation.start)/animation.duration),e=ease(t);
      this.selected.position.lerpVectors(animation.from.position,animation.to.position,e);this.selected.quaternion.slerpQuaternions(animation.from.quaternion,animation.to.quaternion,e);this.selected.scale.lerpVectors(animation.from.scale,animation.to.scale,e);
      this.dimMaterial.opacity=THREE.MathUtils.lerp(animation.dimFrom,animation.dimTo,e);
      const doorT=animation.doorTo<animation.doorFrom?THREE.MathUtils.clamp((t-.15)/.85,0,1):THREE.MathUtils.clamp(t/.8,0,1);
      if(this.door)this.door.rotation.y=THREE.MathUtils.lerp(animation.doorFrom,animation.doorTo,ease(doorT));
      if(t===1){this.animation=null;animation.done();}
    }
    for(const [root,a] of this.hoverAnimations){const t=Math.min(1,(now-a.start)/a.duration);root.position.y=THREE.MathUtils.lerp(a.from,a.to,ease(t));if(t===1)this.hoverAnimations.delete(root);}
    if(this.caseLight){const scale=this.roots.get('computer')![0].scale.y;this.caseLight.intensity=.045*scale*scale;this.caseLight.distance=.65*scale;}
    this.renderer.setRenderTarget(this.colorTarget);this.renderer.clear();this.renderer.render(this.scene,this.camera);this.occlusion(this.scene);
    if(this.selected){this.renderer.render(this.dimScene,this.dimCamera);this.renderer.clearDepth();this.renderer.render(this.foreground,this.camera);this.occlusion(this.foreground);}
    this.bloom.render(this.renderer,this.colorTarget,this.colorTarget,0,false);this.output.render(this.renderer,this.colorTarget,this.colorTarget,0,false);
    this.frameCount++;
    if(this.animation||this.hoverAnimations.size)this.requestFrame();
  };

  private occlusion(scene:THREE.Scene){
    if(!this.ao)return;
    for(const glass of this.glass)glass.visible=false;
    this.ao.scene=scene;this.ao.render(this.renderer,this.aoTarget,this.aoTarget,0,false);
    for(const glass of this.glass)glass.visible=true;
    this.renderer.setRenderTarget(this.colorTarget);this.aoQuad.render(this.renderer);
  }

  projectKey(slot:number){return this.project(this.keys.get(slot));}
  projectDevice(id:DeviceId,index=0){return this.project(this.roots.get(id)?.[index]);}
  projectMouseFeature(name:'wheel'|'mark'|'side.button.0'|'side.button.1'){return this.project(this.roots.get('mouse')?.[0].getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`mouse.${name}`)));}
  mouseAppearance(){const root=this.roots.get('mouse')?.[0];const color=(name:string)=>{const mesh=root?.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`mouse.${name}`)) as THREE.Mesh|undefined;const material=mesh?.material as THREE.MeshStandardMaterial|undefined;return material?.color.getHexString();};return{body:color('shell'),sideButtons:[color('side.button.0'),color('side.button.1')]};}
  devicePose(id:DeviceId,index=0){const root=this.roots.get(id)?.[index];return root?{name:root.name,position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray()}:null;}
  projectPart(id:string){const root=this.parts.get(id);const anchor=id==='cpu'?'cpu.face':id==='gpu'?'gpu.side.trim':id==='memory'?'memory.light':id==='storage'?'storage.m2.heatsink':id==='network'?'network.controller':null;return this.project(anchor?root?.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(anchor)):root);}
  private project(object?:THREE.Object3D){if(!object)return null;object.updateWorldMatrix(true,true);const position=new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()).project(this.camera);return{x:(position.x+1)*this.width/2,y:(1-position.y)*this.height/2};}
  audit(){const gl=this.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return{state:this.state,gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),keys:this.keys.size,frames:this.frameCount,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,devicePixelRatio:this.renderer.getPixelRatio(),materials:[...this.keys.entries()].map(([slot,root])=>({slot,label:root.userData.key_label,geometry:root.children.find(c=>c instanceof THREE.Mesh)?.uuid,selected:root===this.highlighted})),modelBytes:this.modelBytes};}
  private disposeModel(root:THREE.Object3D){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();root.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const m of Array.isArray(object.material)?object.material:[object.material])materials.add(m);}});for(const g of geometries)g.dispose();for(const m of materials){for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose();}for(const texture of textures)texture.dispose();}
  dispose(){this.disposed=true;this.abort.abort();cancelAnimationFrame(this.frame);this.observer.disconnect();this.highlight(null);this.disposeModel(this.scene);this.disposeModel(this.foreground);this.disposeModel(this.dimScene);this.environment.dispose();this.ao?.dispose();this.aoTarget.dispose();this.aoMaterial.dispose();this.aoQuad.dispose();this.colorTarget.dispose();this.bloom.dispose();this.output.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
