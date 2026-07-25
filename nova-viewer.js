(function(){
if(customElements.get('nova-viewer'))return;
const CDN='https://esm.sh/three@0.160.0';
let libsP=null;
const libs=()=>libsP||(libsP=Promise.all([
 import(CDN),
 import(CDN+'/examples/jsm/loaders/GLTFLoader.js'),
 import(CDN+'/examples/jsm/controls/OrbitControls.js'),
 import(CDN+'/examples/jsm/environments/RoomEnvironment.js')
]).then(([T,G,O,R])=>({T,GLTFLoader:G.GLTFLoader,OrbitControls:O.OrbitControls,RoomEnvironment:R.RoomEnvironment})));
const PAL=['#e8b73a','#6fbf8b','#f47fb0','#a986e0','#5fa8e6','#f0925e','#b8b34e','#54c4ba'];
const SVGNS='http://www.w3.org/2000/svg';
const easeIO=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
class NovaViewer extends HTMLElement{
 static get observedAttributes(){return['src','wireframe','normals','labels','explode','spin','rig']}
 constructor(){super();this._movers=[];this._labels=[];this._meshes=[];this._orig=new Map();this._mgroup=new Map();this._hl=null;this._hlSet=null;this._loadId=0;this._f=0;this._manual=false;this._hover=null;this._pickObj=null;this._introDone=false;}
 _on(n){const v=this.getAttribute(n);return v!=null&&v!=='false'&&v!=='0'}
 _num(n,d){const v=parseFloat(this.getAttribute(n));return isNaN(v)?d:v}
 _attr(n){const v=this.getAttribute(n);return v!=null?v:this.getAttribute(n.replace(/-/g,''));}
 connectedCallback(){
  if(this._built){
   if(this._ro)this._ro.observe(this);
   this._startLoop();
   if(this._root){this._t0=performance.now();this._lastT=this._t0;this._manual=false;this._introDone=false;}
   return;
  }
  this._built=true;
  this.style.cssText+=';display:block;position:relative;overflow:hidden;width:100%;height:100%;min-height:'+(this.getAttribute('min-h')||'0')+';';
  this._lab=document.createElement('div');
  this._lab.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2';
  this._svg=document.createElementNS(SVGNS,'svg');
  this._svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;overflow:visible';
  this._lab.appendChild(this._svg);
  // hover tooltip — instant part-name feedback, follows the cursor
  this._tip=document.createElement('div');
  this._tip.style.cssText='position:absolute;left:0;top:0;font-family:"Space Mono",monospace;font-weight:700;font-size:10.5px;background:#221d18;color:#ffd23e;border-radius:7px;padding:3px 9px;white-space:nowrap;opacity:0;transition:opacity .12s;will-change:transform;z-index:3';
  this._lab.appendChild(this._tip);
  this._load=document.createElement('div');
  this._load.style.cssText="position:absolute;inset:0;display:grid;place-items:center;z-index:3;font-family:'Pixelify Sans',monospace;color:#a09685;font-size:15px;transition:opacity .3s";
  this._load.innerHTML='<div style="text-align:center"><div style="letter-spacing:5px;font-size:22px">▚▚▚</div><div style="margin-top:8px">assembling parts…</div></div>';
  this.appendChild(this._lab);this.appendChild(this._load);
  this._init();
 }
 async _init(){
  const {T,OrbitControls,RoomEnvironment}=await libs();
  this.T=T;
  const r=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  r.setPixelRatio(Math.min(1.5,window.devicePixelRatio||1));
  r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=1.05;
  r.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:1;touch-action:none';
  this.insertBefore(r.domElement,this._lab);
  this.renderer=r;
  this.scene=new T.Scene();
  const pm=new T.PMREMGenerator(r);
  this.scene.environment=pm.fromScene(new RoomEnvironment(),0.04).texture;
  this.camera=new T.PerspectiveCamera(38,1,0.05,60);
  this.camera.position.set(3.1,1.7,3.7);
  {const _cy=this._attr('cam-yaw'),_cp=this._attr('cam-pitch');if(_cy!=null||_cp!=null){const yaw=parseFloat(_cy)||0,pitch=(_cp!=null?parseFloat(_cp):0.15),d=5;this.camera.position.set(Math.sin(yaw)*Math.cos(pitch)*d,Math.sin(pitch)*d,Math.cos(yaw)*Math.cos(pitch)*d);}}
  this.controls=new OrbitControls(this.camera,r.domElement);
  this.controls.enableDamping=true;this.controls.dampingFactor=0.08;
  this.controls.minDistance=1.6;this.controls.maxDistance=12;
  // Wipe grab (capture phase, so it pre-empts OrbitControls): grabbing within
  // ~34px of the divider drags the split; anywhere else orbits the model.
  r.domElement.addEventListener('pointerdown',e=>{
   if(!this._wipeMode)return;
   const rect=this.getBoundingClientRect();
   if(Math.abs((e.clientX-rect.left)-this._wipe*rect.width)>34)return;
   e.stopPropagation();this._wipeAuto=false;this._wipeDrag=true;
   try{r.domElement.setPointerCapture(e.pointerId)}catch(x){}
   this._setWipe(this._pf(e));
  },true);
  r.domElement.addEventListener('pointermove',e=>{
   if(!this._wipeMode)return;
   const rect=this.getBoundingClientRect();
   const near=Math.abs((e.clientX-rect.left)-this._wipe*rect.width)<=34;
   r.domElement.style.cursor=(this._wipeDrag||near)?'ew-resize':'grab';
   if(this._wipeDrag){e.stopPropagation();this._setWipe(this._pf(e));}
  },true);
  r.domElement.addEventListener('pointerup',e=>{if(this._wipeDrag){this._wipeDrag=false;e.stopPropagation();}},true);
  r.domElement.addEventListener('pointerdown',e=>{this._pd=[e.clientX,e.clientY];this._emitAct();});
  r.domElement.addEventListener('wheel',()=>this._emitAct(),{passive:true});
  r.domElement.addEventListener('pointerup',e=>{if(this._pd){const dx=e.clientX-this._pd[0],dy=e.clientY-this._pd[1];if(dx*dx+dy*dy<25)this._pick(e);this._pd=null;}});
  r.domElement.addEventListener('pointermove',e=>{this._hovEvt=(this._pd||this._wipeDrag)?null:e;});
  r.domElement.addEventListener('pointerleave',()=>{this._hovEvt=null;this._setHover(null);});
  const dl=new T.DirectionalLight(0xffffff,0.8);dl.position.set(3,5,2);this.scene.add(dl);
  this.scene.add(new T.AmbientLight(0xffffff,0.25));
  this._normMat=new T.MeshNormalMaterial();
  this._hlMat=new T.MeshBasicMaterial({color:0xf47fb0});
  this._hovMat=new T.MeshBasicMaterial({color:0xffd23e});
  this._pickMat=new T.MeshBasicMaterial({color:0xf47fb0});
  this._ro=new ResizeObserver(()=>this._resize());this._ro.observe(this);
  this._onScreen=true;
  this._vis=new IntersectionObserver((es)=>{es.forEach((x)=>{this._onScreen=x.isIntersecting;});},{rootMargin:'150px'});
  this._vis.observe(this);
  // Hold the GLB fetch until the stage is within ~a screen of the viewport.
  // The rig viewer is the default tab but sits ~4 screens down, so on a phone
  // its model used to download during first paint, competing with the content
  // actually on screen. The observer fires on the next frame, so anything
  // already in view still loads immediately.
  this._near=new IntersectionObserver((es,ob)=>{
   if(!es.some(x=>x.isIntersecting))return;
   ob.disconnect();this._near=null;
   const s=this._pendingSrc;this._pendingSrc=null;
   if(s)this._loadSrc(s);
  },{rootMargin:'700px 0px'});
  this._near.observe(this);
  this._resize();
  this._startLoop();
  if(this.getAttribute('src'))this._pendingSrc=this.getAttribute('src');
 }
 _startLoop(){
  if(this._looping||!this.renderer)return;
  this._looping=true;this._lastT=performance.now();
  const tick=()=>{if(!this._looping)return;this._raf=requestAnimationFrame(tick);this._tick();};
  tick();
 }
 _resize(){
  if(!this.renderer)return;
  const w=this.clientWidth||1,h=this.clientHeight||1;
  this.renderer.setSize(w,h,false);
  this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
  this._frame();
 }
 _frame(){
  // fit + center the model for whatever box this viewer lives in
  if(!this._root||!this.camera||!this.T)return;
  const T=this.T;
  const sph=new T.Box3().setFromObject(this._root).getBoundingSphere(new T.Sphere());
  if(!(sph.radius>0))return;
  const fovV=this.camera.fov*Math.PI/180;
  const fovH=2*Math.atan(Math.tan(fovV/2)*Math.max(this.camera.aspect,1e-3));
  let dist=sph.radius/Math.sin(Math.min(fovV,fovH)/2)*1.12;
  if((this.clientHeight||0)<420){
   // small embed: tighter box-projection fit (rotation-safe via max horizontal extent)
   const bx=new this.T.Box3().setFromObject(this._root).getSize(new this.T.Vector3());
   const horiz=(Math.max(bx.x,bx.z)/2)/Math.tan(fovH/2);
   const vert=(bx.y/2)/Math.tan(fovV/2);
   dist=Math.max(horiz,vert)*1.15+Math.max(bx.x,bx.z)*0.18+this._target()*0.6;
  }
  dist*=(parseFloat(this._attr('fit'))||1);   // <1 pulls the camera in (tighter crop)
  const dir=this.camera.position.clone().sub(this.controls.target);
  if(dir.lengthSq()<1e-9)dir.set(0.55,0.35,0.75);
  dir.normalize();
  this.controls.target.copy(sph.center);
  this.camera.position.copy(sph.center.clone().add(dir.multiplyScalar(dist)));
  this.controls.minDistance=Math.min(1.6,dist*0.35);
  this.controls.maxDistance=Math.max(12,dist*2.5);
 }
 attributeChangedCallback(n,o,v){
  if(o===v)return;
  // still waiting to come into view: swap the pending src, don't fetch yet
  if(n==='src'&&this.renderer&&v){if(this._near)this._pendingSrc=v;else this._loadSrc(v);}
  if((n==='wireframe'||n==='normals')&&this.renderer)this._applyMats();
  if(n==='explode'&&this._root&&o!=null)this._manual=true;
 }
 async _loadSrc(src){
  const id=++this._loadId;
  this._load.style.opacity='1';this._load.style.display='';
  const {T,GLTFLoader}=await libs();
  if(this._root){this.scene.remove(this._root);this._root.traverse(o=>{if(o.geometry)o.geometry.dispose()});this._root=null;}
  this._movers=[];this._meshes=[];this._orig=new Map();this._mgroup=new Map();this._hl=null;this._hlSet=null;this._manual=false;this._introDone=false;this._pinMode=false;this._compareRoots=null;this._cmpT0=null;this._pinSpec=null;this._fade=null;this._cmpMats=null;this._rig=null;this._rigLean=null;this._clearPick();this._setHover(null);
  this._labels.forEach(L=>{L.el.remove();L.line.remove();L.dot.remove()});this._labels=[];
  if(this._cmpBadge){this._cmpBadge.remove();this._cmpBadge=null;}
  ['_divLine','_divHandle','_tagA','_tagB'].forEach(k=>{if(this[k]){this[k].remove();this[k]=null;}});
  this._wipeMode=false;this._wipeDrag=false;this._planeA=null;this._planeB=null;
  if(this.controls)this.controls.enabled=true;this.style.cursor='';
  let gltf=null;
  try{gltf=await new GLTFLoader().loadAsync(src);}catch(e){this._load.innerHTML='<div>could not load asset</div>';return;}
  if(!gltf||id!==this._loadId)return;
  const root=gltf.scene;
  const _cs=this._attr('compare-src');
  if(_cs){await this._setupCompare(src,_cs,root,id);return;}  // both models are pre-aligned; keep raw
  const na=this._normOf(root);
  root.scale.setScalar(na.s);
  root.position.set(-na.c.x*na.s,-na.c.y*na.s,-na.c.z*na.s);
  // Rig mode inserts two transform wrappers ABOVE the model so the demo can
  // squash and lean it without touching the asset's own hierarchy:
  //   wrap (=_root) : idle turntable + impact squash, origin ON THE GROUND so
  //                   the squash grows upward instead of about the bbox centre
  //     lean        : roll/pitch, INSIDE the turntable so the tilt stays
  //                   model-relative as the kart spins
  //       root      : the normalized GLB, untouched
  if(this._attr('rig')){
   root.updateMatrixWorld(true);
   const ground=new T.Box3().setFromObject(root).min.y;
   const wrap=new T.Group(),lean=new T.Group();
   wrap.position.y=ground;root.position.y-=ground;
   lean.add(root);wrap.add(lean);
   this.scene.add(wrap);this._root=wrap;this._rigLean=lean;
  }else{
   this.scene.add(root);this._root=root;
  }
  root.updateMatrixWorld(true);
  let gr=null;root.traverse(n=>{if(!gr&&/_root$/i.test(n.name||''))gr=n;});
  if(!gr){gr=root;while(gr.children.length===1)gr=gr.children[0];}
  const hasMesh=o=>{let f=false;o.traverse(x=>{if(x.isMesh)f=true});return f;};
  // Choose the level to explode (and to list in the scene graph) at. Some
  // models hang everything off one or two big assemblies — the DSLR gun is
  // Camera_Body_Root + Weapon_Frame_Root, the cheesecake is Cake_Body +
  // Garnish — so exploding the root's own children pulls 183 parts into two
  // lumps and says nothing about how the thing is built. Step down into the
  // busiest group until there are enough pieces to read as a structure, while
  // stopping well short of turning the model into a parts bin.
  // MIN is 4 deliberately: the robot rabbit already has exactly four groups
  // (Arms/Body/Ears/Face) and must be left exactly as it is.
  const MIN_G=4,MAX_G=14;
  let groups=gr.children.filter(hasMesh);
  for(let guard=0;guard<8&&groups.length<MIN_G;guard++){
   const cand=groups
    .map((g,i)=>({i,kids:g.children.filter(hasMesh)}))
    .filter(c=>c.kids.length&&groups.length-1+c.kids.length<=MAX_G)
    .sort((a,b)=>b.kids.length-a.kids.length)[0];
   if(!cand)break;
   groups=[...groups.slice(0,cand.i),...cand.kids,...groups.slice(cand.i+1)];
  }
  root.traverse(o=>{if(o.isMesh){this._meshes.push(o);this._orig.set(o,o.material);}});
  groups.forEach(g=>g.traverse(o=>{if(o.isMesh)this._mgroup.set(o,g.name)}));
  const worldC=o=>new T.Box3().setFromObject(o).getCenter(new T.Vector3());
  const mkMover=(obj,dirW,dist)=>{
   const p=obj.parent;const ws=p.getWorldScale(new T.Vector3()).x||1;
   const dir=p.worldToLocal(dirW.clone()).sub(p.worldToLocal(new T.Vector3(0,0,0)));
   if(dir.lengthSq()<1e-8)dir.set(0,1,0);dir.normalize();
   this._movers.push({obj,base:obj.position.clone(),dir,dist:dist/ws});
  };
  groups.forEach((g,i)=>{
   const gc=worldC(g);
   if(gc.length()>0.24){mkMover(g,gc,0.8);}
   else{
    const kids=g.children.filter(hasMesh);
    if(kids.length)kids.forEach(k=>{const kc=worldC(k);mkMover(k,kc.lengthSq()<1e-4?new T.Vector3(0,1,0):kc,0.6);});
    else mkMover(g,new T.Vector3(0,1,0),0.4);
   }
   const el=document.createElement('div');
   // ('0'+n) alone printed "011" once a model had more than nine groups
   el.innerHTML='<span style="opacity:.45">'+('0'+(i+1)).slice(-2)+'</span>&nbsp;'+g.name;
   el.style.cssText='position:absolute;left:0;top:0;font-family:"Space Mono",monospace;font-size:10.5px;letter-spacing:.3px;color:var(--ink,#221d18);white-space:nowrap;opacity:0;transition:opacity .35s';
   this._lab.appendChild(el);
   const line=document.createElementNS(SVGNS,'polyline');
   line.setAttribute('fill','none');line.setAttribute('stroke','var(--ink,#221d18)');
   line.setAttribute('stroke-width','1.2');line.setAttribute('stroke-opacity','.45');
   line.style.transition='opacity .35s';line.style.opacity='0';
   const dot=document.createElementNS(SVGNS,'circle');
   dot.setAttribute('r','3.4');dot.setAttribute('fill',PAL[i%PAL.length]);
   dot.setAttribute('stroke','var(--ink,#221d18)');dot.setAttribute('stroke-width','1.2');
   dot.style.transition='opacity .35s';dot.style.opacity='0';
   this._svg.appendChild(line);this._svg.appendChild(dot);
   this._labels.push({el,line,dot,anchor:g,local:g.worldToLocal(gc.clone())});
  });
  this._counts=(function build(list){return list.map(g=>{let n=0;g.traverse(o=>{if(o.isMesh)n++});return{name:g.name,count:n,children:build(g.children.filter(hasMesh))}})})(groups);
  // Custom pins: label ONLY the named parts with live leader lines (same
  // tracking as the auto group labels), overriding auto labels when present.
  // Format: "match1:label1;match2:label2" — anchors to the combined bbox of
  // every mesh whose name contains `match`, so it works across model versions.
  const pinsAttr=this.getAttribute('pins');
  if(pinsAttr){
   const spec=pinsAttr.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf(':');return{match:x.slice(0,i),text:x.slice(i+1)}}).filter(p=>p.match);
   if(spec.length){
    this._labels.forEach(L=>{L.el.remove();L.line.remove();L.dot.remove()});this._labels=[];
    spec.forEach(pin=>{
     const bb=new T.Box3();let found=false;
     root.traverse(o=>{if(o.isMesh&&o.name&&o.name.indexOf(pin.match)>=0){bb.expandByObject(o);found=true}});
     if(!found)return;
     const c=bb.getCenter(new T.Vector3());
     const el=document.createElement('div');el.textContent=pin.text;
     el.style.cssText='position:absolute;left:0;top:0;font-family:"Pixelify Sans",monospace;font-size:12.5px;color:#ffd23e;background:#221d18;border-radius:999px;padding:2px 11px;white-space:nowrap;opacity:0;transition:opacity .35s;box-shadow:2px 2px 0 rgba(34,29,24,.22)';
     this._lab.appendChild(el);
     const line=document.createElementNS(SVGNS,'polyline');line.setAttribute('fill','none');line.setAttribute('stroke','#c76a86');line.setAttribute('stroke-width','1.5');line.style.transition='opacity .35s';line.style.opacity='0';
     const dot=document.createElementNS(SVGNS,'circle');dot.setAttribute('r','3.8');dot.setAttribute('fill','#f47fb0');dot.setAttribute('stroke','#221d18');dot.setAttribute('stroke-width','1.3');dot.style.transition='opacity .35s';dot.style.opacity='0';
     this._svg.appendChild(line);this._svg.appendChild(dot);
     this._labels.push({el,line,dot,anchor:root,local:root.worldToLocal(c.clone())});
    });
    this._pinMode=this._labels.length>0;
   }
  }
  if(this._attr('rig'))this._buildRig(root);
  this._applyMats();
  this._load.style.opacity='0';const ld=this._load;setTimeout(()=>{if(id===this._loadId)ld.style.display='none'},350);
  this._t0=performance.now();this._lastT=this._t0;this._baseRot=this._root.rotation.y;this._introSnapped=false;
  // _frame() fits target+distance to the new model; _applyCamAngle() then locks
  // the orbit angle back to the front, so every (re)load starts front-facing.
  this._frame();this._applyCamAngle();
  this.dispatchEvent(new CustomEvent('nova-ready',{bubbles:true,composed:true,detail:{src,root:gr.name||'root',parts:this._meshes.length,groups:this._counts}}));
 }
 // Normalize a model for the view. With `body-match`, scale/center by the bbox
 // of meshes whose name contains that string (e.g. "Pig_Body_Shell") so two
 // model versions line up on the shared part and only the edits differ.
 _normOf(root){
  const T=this.T,bm=this._attr('body-match');
  let box=null;
  if(bm){box=new T.Box3();root.traverse(o=>{if(o.isMesh&&o.name&&o.name.indexOf(bm)>=0)box.expandByObject(o)});if(box.isEmpty())box=null;}
  if(!box)box=new T.Box3().setFromObject(root);
  const size=box.getSize(new T.Vector3()),c=box.getCenter(new T.Vector3());
  const target=bm?1.7:2;
  return{s:target/Math.max(size.x,size.y,size.z,1e-6),c};
 }
 // Compare mode: a WIPE slider. Both models render at once, split by a vertical
 // clipping plane — the original on the left of the divider, the edit on the
 // right. The divider is draggable and also auto-sweeps. Because both models are
 // pre-aligned and viewed head-on, the shared parts line up across the seam and
 // only the real differences (wings, nameplate) straddle it.
 async _setupCompare(src,compareSrc,rootA,id){
  const {T,GLTFLoader}=await libs();
  let g2=null;try{g2=await new GLTFLoader().loadAsync(compareSrc);}catch(e){}
  if(id!==this._loadId)return;
  const container=new T.Group();container.add(rootA);
  let rootB=null;
  if(g2){rootB=g2.scene;container.add(rootB);
   // compare-offset="x,y,z": nudge the EDITED model into the original's frame.
   // Needed when the two GLBs were authored/exported at different origins —
   // compare mode draws both raw, so without this the shared parts don't line
   // up across the divider (one sits higher/further back than the other).
   const off=this._attr('compare-offset');
   if(off){const a=off.split(',').map(v=>parseFloat(v));
    if(a.length===3&&a.every(n=>!isNaN(n))){rootB.position.x+=a[0];rootB.position.y+=a[1];rootB.position.z+=a[2];}}
  }
  this.scene.add(container);this._root=container;container.updateMatrixWorld(true);
  this._compareRoots=rootB?[rootA,rootB]:[rootA];
  rootA.traverse(o=>{if(o.isMesh){this._meshes.push(o);this._orig.set(o,o.material);}});
  const _matsOf=r=>{const s=new Set();r.traverse(o=>{if(o.isMesh){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(m)s.add(m)})}});return[...s];};
  this._cmpMats=[_matsOf(rootA),rootB?_matsOf(rootB):[]];
  // world-X clipping planes: A keeps x<=divider (left), B keeps x>=divider (right)
  this.renderer.localClippingEnabled=true;
  this._planeA=new T.Plane(new T.Vector3(-1,0,0),0);
  this._planeB=new T.Plane(new T.Vector3(1,0,0),0);
  this._cmpMats[0].forEach(m=>{m.clippingPlanes=[this._planeA];m.needsUpdate=true;});
  this._cmpMats[1].forEach(m=>{m.clippingPlanes=[this._planeB];m.needsUpdate=true;});
  // divider line + handle
  this._divLine=document.createElement('div');
  this._divLine.style.cssText='position:absolute;top:0;bottom:0;width:2.5px;margin-left:-1.25px;background:#221d18;z-index:3;pointer-events:none';
  this._divHandle=document.createElement('div');
  this._divHandle.style.cssText='position:absolute;top:50%;margin-top:-19px;margin-left:-19px;width:38px;height:38px;border-radius:50%;background:#fff;border:2px solid #221d18;box-shadow:2px 2px 0 rgba(34,29,24,.22);display:grid;place-items:center;z-index:4;font-family:monospace;font-size:16px;color:#221d18;pointer-events:none';
  this._divHandle.textContent='⇆';
  this._lab.appendChild(this._divLine);this._lab.appendChild(this._divHandle);
  const mkTag=(txt,side)=>{const d=document.createElement('div');d.textContent=txt;d.style.cssText='position:absolute;top:12px;'+side+':12px;font-family:"Pixelify Sans",monospace;font-size:12px;color:#ffd23e;background:#221d18;border-radius:999px;padding:2px 12px;z-index:4;box-shadow:2px 2px 0 rgba(34,29,24,.2);pointer-events:none';this._lab.appendChild(d);return d;};
  this._tagA=mkTag(this._attr('compare-label-a')||'original','left');
  this._tagB=mkTag(this._attr('compare-label-b')||'edited','right');
  this._wipeMode=true;this._wipe=0.5;this._wipeAuto=true;this._wipeDrag=false;this._wipeT0=null;
  this._applyMats();
  this._load.style.opacity='0';const ld=this._load;setTimeout(()=>{if(id===this._loadId)ld.style.display='none'},350);
  this._t0=performance.now();this._lastT=this._t0;this._baseRot=container.rotation.y;this._introSnapped=false;
  this._frame();this._applyCamAngle();this._setWipe(0.5);
  this.dispatchEvent(new CustomEvent('nova-ready',{bubbles:true,composed:true,detail:{src,root:'compare',parts:this._meshes.length,groups:[]}}));
 }
 _pf(e){const r=this.getBoundingClientRect();return (e.clientX-r.left)/Math.max(1,r.width);}
 _setWipe(f){
  f=Math.max(0.03,Math.min(0.97,f));this._wipe=f;
  if(this._divLine){this._divLine.style.left=(f*100)+'%';this._divHandle.style.left=(f*100)+'%';}
  this._updWipePlanes();
 }
 // Keep the split aligned to the SCREEN: the clip planes are rebuilt from the
 // camera's right-vector every frame, so the seam stays a vertical line on
 // screen no matter how the model is orbited.
 _updWipePlanes(){
  if(!this._planeA||!this._planeB||!this.T||!this.camera)return;
  const T=this.T,cam=this.camera;
  cam.updateMatrixWorld();
  const right=new T.Vector3().setFromMatrixColumn(cam.matrixWorld,0).normalize();
  const tgt=this.controls?this.controls.target:new T.Vector3();
  const dist=cam.position.distanceTo(tgt)||5;
  const halfH=Math.tan((cam.fov*Math.PI/180)/2)*dist;
  const halfW=halfH*(cam.aspect||1);
  const P=tgt.clone().addScaledVector(right,(this._wipe-0.5)*2*halfW);
  const d=right.dot(P);
  this._planeA.normal.copy(right).negate();this._planeA.constant=d;
  this._planeB.normal.copy(right);this._planeB.constant=-d;
 }
 // Re-assert the configured load angle around the current target (guarantees a
 // consistent front-on framing even if the element was re-mounted).
 // Deterministic camera placement. Runs after _frame(), which has already set a
 // fit-derived target + distance, so only the ORBIT ANGLE is decided here.
 // Two things make this "every time" rather than "the first time":
 //   - no early return: a viewer with no cam-* attrs still gets re-aimed to the
 //     default front angle instead of inheriting wherever the user left it;
 //   - controls.update() resyncs OrbitControls' damped internal spherical state,
 //     which otherwise snaps the camera back to the previous orbit on reload.
 _applyCamAngle(){
  const cy=this._attr('cam-yaw'),cp=this._attr('cam-pitch');
  // No cam-* attrs (e.g. the hero studio viewer) => reproduce the original
  // three-quarter default from the constructor's (3.1, 1.7, 3.7) camera, so
  // that viewer keeps its designed framing and merely becomes repeatable.
  const yaw=cy!=null?(parseFloat(cy)||0):0.697;
  const pitch=cp!=null?(parseFloat(cp)||0):0.338;
  const t=this.controls?this.controls.target:new this.T.Vector3();
  const d=this.camera.position.distanceTo(t)||5;
  this.camera.position.set(t.x+Math.sin(yaw)*Math.cos(pitch)*d,t.y+Math.sin(pitch)*d,t.z+Math.cos(yaw)*Math.cos(pitch)*d);
  this.camera.lookAt(t);
  // Snap OrbitControls' internal spherical to the position we just set. Damping
  // must be OFF for this one update, otherwise the leftover sphericalDelta from
  // the previous orbit is re-applied and drags the camera back off-front.
  if(this.controls){
   const damp=this.controls.enableDamping;
   this.controls.enableDamping=false;
   this.controls.update();
   this.controls.enableDamping=damp;
  }
 }
 _buildPins(){
  this._labels.forEach(L=>{L.el.remove();L.line.remove();L.dot.remove()});this._labels=[];
  (this._pinSpec||[]).forEach(pin=>{
   const el=document.createElement('div');el.textContent=pin.text;
   el.style.cssText='position:absolute;left:0;top:0;font-family:"Pixelify Sans",monospace;font-size:12.5px;color:#ffd23e;background:#221d18;border-radius:999px;padding:2px 11px;white-space:nowrap;opacity:0;transition:opacity .35s;box-shadow:2px 2px 0 rgba(34,29,24,.22)';
   this._lab.appendChild(el);
   const line=document.createElementNS(SVGNS,'polyline');line.setAttribute('fill','none');line.setAttribute('stroke','#c76a86');line.setAttribute('stroke-width','1.5');line.style.transition='opacity .35s';line.style.opacity='0';
   const dot=document.createElementNS(SVGNS,'circle');dot.setAttribute('r','3.8');dot.setAttribute('fill','#f47fb0');dot.setAttribute('stroke','#221d18');dot.setAttribute('stroke-width','1.3');dot.style.transition='opacity .35s';dot.style.opacity='0';
   this._svg.appendChild(line);this._svg.appendChild(dot);
   this._labels.push({el,line,dot,anchor:this._root,local:new this.T.Vector3(),spec:pin});
  });
 }
 _repin(model){
  const T=this.T;
  this._labels.forEach(L=>{
   if(!L.spec)return;
   const bb=new T.Box3();let found=false;
   model.traverse(o=>{if(o.isMesh&&o.name&&o.name.indexOf(L.spec.match)>=0){bb.expandByObject(o);found=true}});
   if(found){const c=bb.getCenter(new T.Vector3());L.anchor=this._root;L.local=this._root.worldToLocal(c.clone());}
  });
 }
 // ── RIG MODE ───────────────────────────────────────────────────────────────
 // Drives the asset's OWN named nodes — nothing here is baked animation and no
 // bones are added. Wheel_* already carry pivots on their axles, so a rotation
 // assignment is the whole "rig". The steering wheel is the one part generation
 // did NOT place a pivot for (its origin sits ~0.86m off the disc it draws), so
 // we insert a pivot at the disc's own centre — which is exactly the work the
 // articulation pass automates.
 _buildRig(model){
  const T=this.T;
  const find=n=>{let f=null;model.traverse(o=>{if(!f&&o.name===n)f=o});return f};
  const wheels=['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR'].map(find).filter(Boolean);
  wheels.forEach(w=>{w.rotation.order='YXZ'});
  model.updateMatrixWorld(true);
  // spin rate needs the wheel's on-screen radius (the model is normalized)
  let radius=0.26;
  if(wheels.length){const s=new T.Box3().setFromObject(wheels[0]).getSize(new T.Vector3());radius=Math.max(1e-3,Math.max(s.y,s.z)/2);}
  let steerPivot=null;
  const sw=find('Steering_Wheel');
  if(sw&&sw.parent){
   // The steering assembly is SEVERAL sibling nodes (rim, hub, spokes) — rotating
   // the rim alone is invisible, because a ring spinning about its own axis looks
   // identical. Everything except the column (the fixed shaft) turns together.
   const parts=[];
   model.traverse(o=>{if(/^Steering_(Wheel|Spoke|Hub|Rim|Grip)/i.test(o.name||''))parts.push(o)});
   const c=new T.Box3().setFromObject(sw).getCenter(new T.Vector3());
   const axis=new T.Vector3().setFromMatrixColumn(sw.matrixWorld,1).normalize();   // disc normal = column axis
   const p=new T.Group();
   p.position.copy(sw.parent.worldToLocal(c.clone()));
   const inv=sw.parent.getWorldQuaternion(new T.Quaternion()).invert();
   p.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.applyQuaternion(inv).normalize());
   sw.parent.add(p);
   parts.forEach(o=>{if(o!==p)p.attach(o)});                                       // attach keeps world transform
   steerPivot=p;this._rigSteerParts=parts.length;
  }
  this._rig={wheels,front:wheels.slice(0,2),steerPivot,radius,
             spin:0,steer:0,sq:{s:0,v:0},manual:false,thr:0,tgt:0,mSteer:0,
             t0:performance.now(),lastK:-1,started:false};
 }
 // One 6s cycle: roll forward → straighten → roll back, steering sweeping the
 // whole time, with an impact every 2s. Scalar math only — no per-frame allocs.
 _rigTick(dt,now){
  const R=this._rig;if(!R)return;
  let v,steer;
  if(R.manual){v=R.thr*5.5;steer=R.mSteer;}
  else{
   const t=((now-R.t0)/1000)%6,w=2*Math.PI/6;
   v=5.5*Math.sin(w*t);steer=Math.cos(w*t);
   const k=Math.floor(t/2);
   if(k!==R.lastK){if(R.started)R.sq.v-=4.2;R.lastK=k;R.started=true;}
  }
  R.tgt+=(v-R.tgt)*Math.min(1,dt*6);                       // ease so control changes never jerk
  R.spin=(R.spin+(R.tgt/R.radius)*dt)%6.283185307179586;   // wrap: never let the angle drift into float mush
  for(let i=0;i<R.wheels.length;i++)R.wheels[i].rotation.x=-R.spin;
  R.steer+=(steer*0.42-R.steer)*Math.min(1,dt*8);
  for(let i=0;i<R.front.length;i++)R.front[i].rotation.y=R.steer;
  if(R.steerPivot)R.steerPivot.rotation.y=-R.steer*2.4;    // hands turn further than the road wheels
  const sq=R.sq;                                           // impact spring
  sq.v+=(-sq.s*90-sq.v*12)*dt;sq.s+=sq.v*dt;
  const k2=Math.max(-0.32,Math.min(0.32,sq.s));
  this._root.scale.set(1-k2*0.6,1+k2,1-k2*0.6);
  if(this._rigLean){
   const lean=-R.steer*Math.min(1,Math.abs(R.tgt)/6)*0.30,pitch=-R.tgt*0.004,e=Math.min(1,dt*7);
   this._rigLean.rotation.z+=(lean-this._rigLean.rotation.z)*e;
   this._rigLean.rotation.x+=(pitch-this._rigLean.rotation.x)*e;
  }
 }
 // Any control hands the rig to the user and stops the auto cycle + turntable.
 rigSet(kind,val){const R=this._rig;if(!R)return;R.manual=true;if(kind==='thr')R.thr=val;else R.mSteer=val;}
 rigWhack(){const R=this._rig;if(!R)return;R.manual=true;R.sq.v-=4.6;}
 rigAuto(){const R=this._rig;if(!R)return;R.manual=false;R.thr=0;R.mSteer=0;R.t0=performance.now();R.lastK=-1;R.started=false;}
 rigManual(){return!!(this._rig&&this._rig.manual)}
 _target(){return Math.max(0,Math.min(1,this._num('explode',42)/100))}
 _setExplode(f){this._f=f;this._movers.forEach(m=>{m.obj.position.copy(m.base).addScaledVector(m.dir,f*m.dist)})}
 _tick(){
  if(!this.renderer)return;
  if(!this._onScreen||document.hidden){this._lastT=performance.now();return;}
  const now=performance.now();
  const dt=Math.min(0.05,(now-(this._lastT||now))/1000);this._lastT=now;
  this.controls.update();
  if(this._wipeMode&&this._wipeAuto){
   const HOLD=1.5,SWEEP=1.15,LO=0.2,HI=0.8,PER=HOLD+SWEEP+HOLD+SWEEP;
   if(this._wipeT0==null)this._wipeT0=now;
   const ct=((now-this._wipeT0)/1000)%PER;
   let f;
   if(ct<HOLD)f=LO;
   else if(ct<HOLD+SWEEP)f=LO+(HI-LO)*easeIO((ct-HOLD)/SWEEP);
   else if(ct<HOLD+SWEEP+HOLD)f=HI;
   else f=HI-(HI-LO)*easeIO((ct-HOLD-SWEEP-HOLD)/SWEEP);
   this._setWipe(f);
  }
  if(this._wipeMode)this._updWipePlanes();
  if(this._root){
   const t=(now-this._t0)/1000;
   const spinD=this._num('spin',2.2);
   this._introDone=t>=spinD;
   let f=0;
   if(t<spinD){
    this._root.rotation.y=this._baseRot+easeIO(Math.min(1,t/spinD))*Math.PI*2*this._num('spins',1);
   }else{
    // Snap to the intro's exact end pose once. The intro is a whole number of
    // turns, so that pose IS _baseRot. Without this, a short spin (e.g. 0.01s)
    // ends wherever the last intro frame happened to land — and with rot=0
    // nothing ever corrects it, so the model froze at a random angle on some
    // loads and the correct one on others.
    if(!this._introSnapped){this._root.rotation.y=this._baseRot;this._introSnapped=true;}
    // rig mode: the turntable idles only while the cycle is playing — once the
    // user takes a control, the view holds still so they can inspect the joint
    if(!(this._rig&&this._rig.manual))this._root.rotation.y+=dt*this._num('rot',0.3);
    if(this._manual){f=this._target();}
    else{
     const EXP=0.9,HOLD=1.7,RET=0.9,REST=3.5,CYC=EXP+HOLD+RET+REST;
     const ct=(t-spinD)%CYC;
     if(ct<EXP)f=easeIO(ct/EXP)*this._target();
     else if(ct<EXP+HOLD)f=this._target();
     else if(ct<EXP+HOLD+RET)f=this._target()*(1-easeIO((ct-EXP-HOLD)/RET));
     else f=0;
    }
   }
   this._setExplode(f);
   if(this._rig)this._rigTick(dt,now);
  }
  this._procHover();
  this._updateLabels();
  this.renderer.render(this.scene,this.camera);
 }
 _emitAct(){this.dispatchEvent(new CustomEvent('nova-interact',{bubbles:true,composed:true}))}
 _ndc(e){
  const rect=this.renderer.domElement.getBoundingClientRect();
  return{v:new this.T.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1),
         x:e.clientX-rect.left,y:e.clientY-rect.top};
 }
 _raycast(e){
  const T=this.T;if(!this._root||!T)return null;
  this._ray=this._ray||new T.Raycaster();
  this._ray.setFromCamera(this._ndc(e).v,this.camera);
  const hits=this._ray.intersectObjects(this._meshes.filter(m=>m.visible),false);
  return hits.length?hits[0]:null;
 }
 // hover: raycast at most once per frame, only when the pointer moved
 _procHover(){
  // A tap fires pointermove too, so on touch the dark cursor-tooltip would
  // appear alongside the pinned pick label — two copies of the same name, the
  // stray one left hanging where the finger lifted. Touch gets the pin only.
  if(this._coarse===undefined)this._coarse=!!(window.matchMedia&&window.matchMedia('(hover:none),(pointer:coarse)').matches);
  if(this._coarse){this._hovEvt=null;return;}
  const e=this._hovEvt;if(e==null)return;this._hovEvt=null;
  const hit=this._raycast(e);
  this._setHover(hit?hit.object:null);
  if(hit){
   const p=this._ndc(e);
   this._tip.textContent=hit.object.name||'(unnamed part)';
   this._tip.style.transform='translate('+(p.x+15)+'px,'+(p.y+14)+'px)';
  }
 }
 _setHover(m){
  if(this._hover===m)return;
  this._hover=m;
  this.renderer.domElement.style.cursor=m?'pointer':'';
  this._tip.style.opacity=m?'1':'0';
  this._applyMats();
 }
 _pick(e){
  const hit=this._raycast(e);
  if(!hit){this._clearPick();return;}
  const h=hit;
  if(!this._pk){
   const el=document.createElement('div');
   el.style.cssText='position:absolute;left:0;top:0;font-family:"Space Mono",monospace;font-weight:700;font-size:10.5px;background:#f47fb0;color:#221d18;border-radius:7px;padding:3px 9px;white-space:nowrap;opacity:0;transition:opacity .2s';
   this._lab.appendChild(el);
   const line=document.createElementNS(SVGNS,'polyline');
   line.setAttribute('fill','none');line.setAttribute('stroke','#f47fb0');line.setAttribute('stroke-width','1.4');
   const dot=document.createElementNS(SVGNS,'circle');
   dot.setAttribute('r','3.6');dot.setAttribute('fill','#f47fb0');dot.setAttribute('stroke','var(--ink,#221d18)');dot.setAttribute('stroke-width','1.2');
   this._svg.appendChild(line);this._svg.appendChild(dot);
   this._pk={el,line,dot};
  }
  this._pk.anchor=h.object;this._pk.local=h.object.worldToLocal(h.point.clone());
  this._pk.el.textContent=h.object.name||'(unnamed part)';
  this._pickObj=h.object;
  this._applyMats();
  this.dispatchEvent(new CustomEvent('nova-pick',{bubbles:true,composed:true,detail:{name:h.object.name||'(unnamed part)',group:this._mgroup.get(h.object)||null,src:this.getAttribute('src')}}));
 }
 _clearPick(){
  if(this._pk){this._pk.anchor=null;this._pk.el.style.opacity='0';this._pk.line.style.opacity='0';this._pk.dot.style.opacity='0';}
  if(this._pickObj){this._pickObj=null;if(this.renderer)this._applyMats();}
 }
 _updateLabels(){
  if(!this._labels.length)return;
  const w=this.clientWidth,h=this.clientHeight;
  // group callouts: faintly visible at rest (after the intro spin), full during explode
  const rest=this._introDone?0.55:0;
  const expA=this._f>0.1?Math.min(1,(this._f-0.1)/0.18):0;
  const alpha=this._pinMode?1:(this._on('labels')?Math.max(rest,expA):0);
  this._labels.forEach(L=>{
   const v=L.anchor.localToWorld(L.local.clone()).project(this.camera);
   L.px=(v.x*0.5+0.5)*w;L.py=(-v.y*0.5+0.5)*h;L.behind=v.z>1;
  });
  // Narrow stage: two 110px label columns on a ~390px canvas leave the model
  // nowhere to sit, so the callouts end up over it. Shrink the type and give
  // each one a paper chip to sit on — they stay readable wherever they land,
  // instead of being dropped. Applied once per breakpoint change, not per frame.
  const narrow=w<520;
  if(this._labNarrow!==narrow){
   this._labNarrow=narrow;
   this._labels.forEach(L=>{
    L.el.style.fontSize=narrow?'9px':'10.5px';
    L.el.style.padding=narrow?'2px 5px':'';
    L.el.style.borderRadius=narrow?'6px':'';
    L.el.style.background=narrow?'color-mix(in oklab, var(--paper,#fff) 82%, transparent)':'';
   });
  }
  const pad=narrow?8:14,gap=narrow?21:26,edge=narrow?14:20;
  const left=[],right=[];
  this._labels.forEach(L=>{(L.px<w/2?left:right).push(L)});
  [['l',left],['r',right]].forEach(([side,arr])=>{
   arr.sort((a,b)=>a.py-b.py);
   let prev=-1e9;
   arr.forEach(L=>{
    let ly=Math.max(edge,Math.min(h-edge,L.py));
    ly=Math.max(ly,prev+gap);prev=ly;
    const lw=L.el.offsetWidth||80;
    const lx=side==='l'?pad:w-pad-lw;
    L.el.style.transform='translate('+lx+'px,'+(ly-8)+'px)';
    const ax=side==='l'?lx+lw+6:lx-6;
    L.line.setAttribute('points',ax+','+ly+' '+L.px+','+L.py);
    L.dot.setAttribute('cx',L.px);L.dot.setAttribute('cy',L.py);
    const o=L.behind?0:alpha;
    L.el.style.opacity=o;L.line.style.opacity=o;L.dot.style.opacity=o;
   });
  });
  if(this._pk&&this._pk.anchor){
   const v=this._pk.anchor.localToWorld(this._pk.local.clone()).project(this.camera);
   const px=(v.x*0.5+0.5)*w,py=(-v.y*0.5+0.5)*h;
   const o=v.z>1?0:1;
   this._pk.el.style.transform='translate('+(px+16)+'px,'+(py-30)+'px)';
   this._pk.line.setAttribute('points',(px+14)+','+(py-18)+' '+px+','+py);
   this._pk.dot.setAttribute('cx',px);this._pk.dot.setAttribute('cy',py);
   this._pk.el.style.opacity=o;this._pk.line.style.opacity=o;this._pk.dot.style.opacity=o;
  }
 }
 _applyMats(){
  if(!this._meshes.length)return;
  const nOn=this._on('normals'),wf=this._on('wireframe');
  this._meshes.forEach(m=>{
   const inHl=this._hlSet?this._hlSet.has(m):(this._hl&&this._mgroup.get(m)===this._hl);
   m.material=(m===this._pickObj)?this._pickMat
    :(m===this._hover)?this._hovMat
    :inHl?this._hlMat
    :(nOn?this._normMat:this._orig.get(m));
  });
  const seen=new Set();
  this._meshes.forEach(m=>{const o=this._orig.get(m);(Array.isArray(o)?o:[o]).forEach(x=>{if(x&&!seen.has(x)){x.wireframe=wf;seen.add(x)}})});
  this._normMat.wireframe=wf;this._hlMat.wireframe=wf;this._hovMat.wireframe=wf;this._pickMat.wireframe=wf;
 }
 toggleGroup(name,visible){if(this._root)this._root.traverse(o=>{if(o.name===name)o.visible=visible;})}
 // highlight any named node's subtree (scene-graph rows at any depth)
 highlightNode(name,on){
  if(!on||!name||!this._root){this._hlSet=null;this._hl=null;this._applyMats();return;}
  let target=null;this._root.traverse(o=>{if(!target&&o.name===name)target=o;});
  if(!target){this._hlSet=null;this._hl=null;this._applyMats();return;}
  const set=new Set();target.traverse(o=>{if(o.isMesh)set.add(o);});
  this._hlSet=set;this._hl=name;this._applyMats();
 }
 highlightGroup(name,on){this.highlightNode(name,on);}
 replay(){if(this._root){this._manual=false;this._root.rotation.y=this._baseRot||0;this._t0=performance.now();this._introDone=false;this._introSnapped=false;}}
 disconnectedCallback(){this._looping=false;cancelAnimationFrame(this._raf);if(this._ro)this._ro.disconnect();if(this._vis)this._vis.disconnect();if(this._near){this._near.disconnect();this._near=null;}}
}
customElements.define('nova-viewer',NovaViewer);
})();
