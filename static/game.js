import * as THREE from 'three';
import {initAds, setGameplayActive, prepareNaturalBreak} from './ads.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const randCode=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const WORLD_ACCENTS={classic:'#f4b942',voxel:'#79c64a',stadium:'#36c76c',battle:'#b067ff',clan:'#e5a93a'};
const BLOCK_TYPES=['dirt','stone','wood','glass','redstone','lamp','lever'];
const BLOCK_COLORS={dirt:'#8a5a32',stone:'#777777',wood:'#9b6b3f',glass:'#9ed7e5',redstone:'#8f1d1d',lamp:'#d7a632',lever:'#74604b'};

const state={
  config:null,siteConfig:null,ws:null,id:null,connected:false,playing:false,room:'PUBLIC',mode:'FFA',world:localStorage.getItem('bf_world')||'classic',
  name:localStorage.getItem('bf_name')||`Guest_${Math.floor(Math.random()*900+100)}`,
  klass:localStorage.getItem('bf_class')||'Triggerman',
  settings:{sens:+(localStorage.getItem('bf_sens')||1),fov:+(localStorage.getItem('bf_fov')||82),bob:localStorage.getItem('bf_bob')!=='0',quality:localStorage.getItem('bf_quality')!=='0'},
  hp:100,alive:true,ammo:30,reloading:false,lastShot:0,players:new Map(),killfeed:[],keys:{},mouseDown:false,ads:false,
  yaw:0,pitch:0,pos:new THREE.Vector3(0,0,0),vel:new THREE.Vector3(),grounded:true,slide:0,crouched:false,jumpLatch:false,landGrace:0,speedBoost:1,chat:false,
  remote:new Map(),mobs:new Map(),ping:0,currentBoxes:[],dynamicBlocks:new Map(),buildMode:false,blockIndex:0,worldTime:0,
};

let scene,camera,renderer,clock,weaponGroup,muzzle,worldGroup,dynamicGroup,remoteGroup,mobGroup,decorGroup,hardpointMesh;
let hemi,sun,moonLight,skySun,skyMoon,stars,stormRing;
const raycaster=new THREE.Raycaster();
const textureCache=new Map();

async function boot(){
  [state.config,state.siteConfig]=await Promise.all([
    fetch('/api/config').then(r=>r.json()),
    fetch('/api/site-config').then(r=>r.json()).catch(()=>({ads:{enabled:false}})),
  ]);
  if(!state.config.classes[state.klass]) state.klass='Triggerman';
  if(!state.config.worlds[state.world]) state.world='classic';
  const url=new URL(location.href);
  const qworld=url.searchParams.get('world');if(qworld&&state.config.worlds[qworld])state.world=qworld;
  const qroom=url.searchParams.get('room');const qmode=url.searchParams.get('mode');
  if(qroom)state.room=qroom.toUpperCase();if(qmode)state.mode=qmode.toUpperCase();
  setupScene();setupUI();applySettings();buildClassGrid();buildWorldSelectors();buildWorld(state.world);refreshAllUI();
  initAds(state.siteConfig);
  connect();animate();
}

function setupScene(){
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(state.settings.fov,innerWidth/innerHeight,.05,220);camera.rotation.order='YXZ';
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,state.settings.quality?1.6:1.15));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;$('#game').appendChild(renderer.domElement);
  hemi=new THREE.HemisphereLight(0xffffff,0x53674e,2.0);scene.add(hemi);
  sun=new THREE.DirectionalLight(0xffffff,1.25);sun.position.set(30,55,18);scene.add(sun);
  moonLight=new THREE.DirectionalLight(0x8da6ff,0);moonLight.position.set(-30,40,-15);scene.add(moonLight);
  worldGroup=new THREE.Group();dynamicGroup=new THREE.Group();remoteGroup=new THREE.Group();mobGroup=new THREE.Group();decorGroup=new THREE.Group();scene.add(worldGroup,dynamicGroup,decorGroup,remoteGroup,mobGroup);
  hardpointMesh=new THREE.Mesh(new THREE.CylinderGeometry(6,6,.05,32),new THREE.MeshBasicMaterial({color:0xffdf66,transparent:true,opacity:.36}));hardpointMesh.visible=false;scene.add(hardpointMesh);
  createWeapon();clock=new THREE.Clock();
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
}

function clearGroup(g){while(g.children.length){const o=g.children.pop();if(o.geometry)o.geometry.dispose?.();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats)m.dispose?.();}}}
function color(c){return new THREE.Color(c)}
function addBox(group,b,material=null){const mat=material||new THREE.MeshLambertMaterial({color:color(b.c||'#777')});const m=new THREE.Mesh(new THREE.BoxGeometry(b.w,b.h,b.d),mat);m.position.set(b.x,b.y,b.z);m.userData.box=b;group.add(m);return m}
function addPlane(group,w,h,c,x,y,z,rx=-Math.PI/2){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshLambertMaterial({color:c,side:THREE.DoubleSide}));m.position.set(x,y,z);m.rotation.x=rx;group.add(m);return m}

function pixelTexture(type){
  const key=`px:${type}`;if(textureCache.has(key))return textureCache.get(key);
  const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');
  const palettes={
    grass:['#72a944','#5f9638','#83b852','#4d8330'],dirt:['#8c5d36','#754a2b','#9c6c43','#684028'],stone:['#777','#696969','#8b8b8b','#5d5d5d'],
    wood:['#9a6537','#784821','#ae7947','#68401f'],glass:['#b8edf5','#83cad6','#d3f6fa','#73b6c3'],redstone:['#8f1d1d','#b92c26','#5e1010','#df4034'],lamp:['#d9a937','#f4ce64','#a87b1e','#ffe98e'],lever:['#745f48','#a17c52','#4c3b2e','#c4a070']};
  const p=palettes[type]||palettes.stone;x.fillStyle=p[0];x.fillRect(0,0,32,32);
  for(let i=0;i<90;i++){x.fillStyle=p[1+Math.floor(Math.random()*3)];const s=2+Math.floor(Math.random()*4);x.fillRect(Math.floor(Math.random()*32),Math.floor(Math.random()*32),s,s)}
  const t=new THREE.CanvasTexture(c);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.colorSpace=THREE.SRGBColorSpace;textureCache.set(key,t);return t;
}
function voxelMaterial(type,powered=false){
  const mat=new THREE.MeshLambertMaterial({map:pixelTexture(type),color:powered&&(type==='lamp'||type==='redstone')?0xffffff:0xffffff,transparent:type==='glass',opacity:type==='glass'?.58:1});
  if(powered&&type==='lamp')mat.emissive=new THREE.Color(0xffc54f),mat.emissiveIntensity=1.2;
  if(powered&&type==='redstone')mat.emissive=new THREE.Color(0xaa160f),mat.emissiveIntensity=.65;
  return mat;
}

function buildWorld(id){
  const w=state.config.worlds[id];if(!w)return;
  clearGroup(worldGroup);clearGroup(decorGroup);clearGroup(dynamicGroup);clearGroup(mobGroup);state.dynamicBlocks.clear();state.mobs.clear();
  scene.background=color(w.sky);scene.fog=new THREE.Fog(color(w.fog),58,id==='stadium'?145:125);hemi.intensity=2;sun.intensity=1.25;moonLight.intensity=0;stormRing=null;skySun=skyMoon=stars=null;
  buildGround(w);for(const b of w.boxes)addStyledWorldBox(w,b);buildDecor(w);state.currentBoxes=[...w.boxes];
  $('#voxelHud').classList.toggle('hidden',id!=='voxel');$('#dayNight').classList.toggle('hidden',id!=='voxel');state.buildMode=false;updateBuildHud();
  refreshWorldUI();createWeapon();
}

function buildGround(w){
  if(w.theme==='voxel'){
    const tex=pixelTexture('grass').clone();tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(32,32);tex.needsUpdate=true;
    const g=new THREE.Mesh(new THREE.PlaneGeometry(66,66),new THREE.MeshLambertMaterial({map:tex}));g.rotation.x=-Math.PI/2;g.position.y=-.015;worldGroup.add(g);
    // Water channel; purely scenic and walkable for arena flow.
    const water=new THREE.Mesh(new THREE.PlaneGeometry(60,4),new THREE.MeshPhongMaterial({color:0x3f91d6,transparent:true,opacity:.78,shininess:80}));water.rotation.x=-Math.PI/2;water.rotation.z=.08;water.position.set(0,.025,3);worldGroup.add(water);
  }else if(w.theme==='stadium'){
    addPlane(worldGroup,74,56,0x2f965a,0,-.01,0);for(let i=-6;i<7;i++)addPlane(worldGroup,5.7,56,i%2?0x2b8d52:0x349d5f,i*5.7,.006,0);
  }else addPlane(worldGroup,82,82,w.ground,0,-.01,0);
  if(w.theme==='classic'){
    const grid=new THREE.GridHelper(82,41,0x557448,0x658052);grid.position.y=.01;grid.material.opacity=.16;grid.material.transparent=true;worldGroup.add(grid);
  }
}

function addStyledWorldBox(w,b){
  let m;
  if(w.theme==='voxel'){
    const typ=b.tag==='grass'?'grass':b.tag==='dirt'?'dirt':b.tag==='wood'?'wood':b.tag==='stone'?'stone':b.tag==='voxel'?'dirt':'stone';m=addBox(worldGroup,b,voxelMaterial(typ));
  }else m=addBox(worldGroup,b);
  if(b.h>3&&w.theme==='classic'){
    const trim={...b,y:b.y+b.h/2+.06,h:.12,w:b.w+.04,d:b.d+.04,c:color(b.c).offsetHSL(0,0,.08)};addBox(worldGroup,trim,new THREE.MeshLambertMaterial({color:trim.c}));
  }
  return m;
}

function buildDecor(w){
  if(w.theme==='classic')decorClassic();
  if(w.theme==='voxel')decorVoxel();
  if(w.theme==='stadium')decorStadium();
  if(w.theme==='battle')decorBattle();
  if(w.theme==='clan')decorClan();
}
function decorClassic(){
  if(!state.settings.quality)return;for(let i=0;i<34;i++){const a=i/34*Math.PI*2,r=52+Math.random()*25,h=5+Math.random()*18;addBox(decorGroup,{x:Math.cos(a)*r,y:h/2-1,z:Math.sin(a)*r,w:5+Math.random()*8,h,d:5+Math.random()*8,c:'#95a7b3'})}
}
function decorVoxel(){
  // Block trees.
  for(const [x,z] of [[-27,-8],[-15,26],[15,27],[27,4],[-28,19],[13,-27]]){
    addBox(decorGroup,{x,y:3,z,w:2,h:6,d:2},voxelMaterial('wood'));for(const dx of [-2,0,2])for(const dz of [-2,0,2])if(Math.abs(dx)+Math.abs(dz)<=2)addBox(decorGroup,{x:x+dx,y:7,z:z+dz,w:2,h:2,d:2},new THREE.MeshLambertMaterial({map:pixelTexture('grass'),color:0x4f8f3a}));addBox(decorGroup,{x,y:9,z,w:2,h:2,d:2},new THREE.MeshLambertMaterial({map:pixelTexture('grass'),color:0x579a3c}));
  }
  // Pixel clouds.
  for(const [x,y,z] of [[-18,18,-20],[17,16,6],[2,20,27]]){for(let i=0;i<4;i++)addBox(decorGroup,{x:x+i*2,y,z,w:4,h:2,d:3,c:'#ffffff'},new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.85}))}
  skySun=new THREE.Mesh(new THREE.BoxGeometry(4,4,.6),new THREE.MeshBasicMaterial({color:0xffe45b}));decorGroup.add(skySun);skyMoon=new THREE.Mesh(new THREE.BoxGeometry(3.5,3.5,.6),new THREE.MeshBasicMaterial({color:0xd9e6ff}));decorGroup.add(skyMoon);
  stars=new THREE.Group();for(let i=0;i<90;i++){const s=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,.08),new THREE.MeshBasicMaterial({color:0xffffff}));const a=Math.random()*Math.PI*2,r=65;s.position.set(Math.cos(a)*r,18+Math.random()*38,Math.sin(a)*r);stars.add(s)}decorGroup.add(stars);
}
function decorStadium(){
  // Pitch markings.
  const lineMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.88});
  const line=(w,d,x,z)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),lineMat.clone());m.rotation.x=-Math.PI/2;m.position.set(x,.02,z);decorGroup.add(m)};
  line(72,.16,0,-27);line(72,.16,0,27);line(.16,54,-36,0);line(.16,54,36,0);line(.14,54,0,0);
  const circle=new THREE.Mesh(new THREE.RingGeometry(8,8.16,64),lineMat.clone());circle.rotation.x=-Math.PI/2;circle.position.y=.025;decorGroup.add(circle);
  for(const sx of [-1,1]){line(11,.14,31*sx,-8);line(11,.14,31*sx,8);line(.14,16,25.5*sx,0)}
  // Floodlights and crowd mosaic.
  for(const x of [-36,36])for(const z of [-27,27]){addBox(decorGroup,{x,y:9,z,w:.5,h:18,d:.5,c:'#d1d5db'});const lamps=new THREE.Mesh(new THREE.BoxGeometry(4,.5,2),new THREE.MeshBasicMaterial({color:0xffffdd}));lamps.position.set(x,18,z);decorGroup.add(lamps)}
  if(state.settings.quality)for(let i=0;i<180;i++){const side=i%2?-1:1;const m=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshBasicMaterial({color:new THREE.Color().setHSL(Math.random(),.7,.58)}));m.position.set(-35+Math.random()*70,3.2+Math.random()*4,side*(32+Math.random()*4));decorGroup.add(m)}
  // Football as an environmental prop.
  const ball=new THREE.Mesh(new THREE.SphereGeometry(.55,18,12),new THREE.MeshLambertMaterial({color:0xffffff}));ball.position.set(0,.58,0);decorGroup.add(ball);for(let i=0;i<7;i++){const p=new THREE.Mesh(new THREE.CircleGeometry(.1,6),new THREE.MeshBasicMaterial({color:0x111111,side:THREE.DoubleSide}));p.position.set(Math.sin(i)*.4,.65+Math.cos(i)*.28,Math.cos(i*1.7)*.35);p.lookAt(ball.position);decorGroup.add(p)}
}
function decorBattle(){
  // Saturated low-poly trees, rocks and a translucent storm wall ring.
  for(const [x,z] of [[-30,-7],[-12,25],[9,-29],[31,11],[-29,25],[25,-4],[5,30]]){
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.45,.55,3,7),new THREE.MeshLambertMaterial({color:0x76503a}));trunk.position.set(x,1.5,z);decorGroup.add(trunk);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(2.5,5,7),new THREE.MeshLambertMaterial({color:0x35a85b,flatShading:true}));crown.position.set(x,5,z);decorGroup.add(crown);
  }
  for(const [x,z,s] of [[-14,-8,2],[15,12,2.8],[28,27,2.2],[-31,-28,2.5]]){const r=new THREE.Mesh(new THREE.DodecahedronGeometry(s,0),new THREE.MeshLambertMaterial({color:0x7f8aa4,flatShading:true}));r.position.set(x,s*.45,z);decorGroup.add(r)}
  stormRing=new THREE.Mesh(new THREE.CylinderGeometry(43,43,20,64,1,true),new THREE.MeshBasicMaterial({color:0x7656ff,transparent:true,opacity:.09,side:THREE.DoubleSide}));stormRing.position.y=8;decorGroup.add(stormRing);
}
function decorClan(){
  // Stylized roofs, turrets, flags, gold and elixir-like resource props.
  const roofs=[[-26,-22,'#6f2f25'],[26,22,'#6f2f25']];for(const [x,z,c] of roofs){const r=new THREE.Mesh(new THREE.ConeGeometry(6,3,4),new THREE.MeshLambertMaterial({color:c}));r.position.set(x,6,z);r.rotation.y=Math.PI/4;decorGroup.add(r)}
  const keepRoof=new THREE.Mesh(new THREE.ConeGeometry(7.4,3.4,4),new THREE.MeshLambertMaterial({color:0x4d5f76}));keepRoof.position.set(0,8.4,0);keepRoof.rotation.y=Math.PI/4;decorGroup.add(keepRoof);
  for(const [x,z] of [[-25,0],[25,0],[0,-27],[0,27]]){const base=new THREE.Mesh(new THREE.CylinderGeometry(2.3,2.7,2,8),new THREE.MeshLambertMaterial({color:0x5f4a3a}));base.position.set(x,3,z);decorGroup.add(base);const cannon=new THREE.Mesh(new THREE.CylinderGeometry(.45,.55,3,10),new THREE.MeshLambertMaterial({color:0x2f3339}));cannon.rotation.z=Math.PI/2;cannon.position.set(x,4,z);decorGroup.add(cannon)}
  const gold=new THREE.Mesh(new THREE.SphereGeometry(2.2,16,10),new THREE.MeshLambertMaterial({color:0xffc928}));gold.scale.y=.72;gold.position.set(25,5.2,-22);decorGroup.add(gold);
  const elixir=new THREE.Mesh(new THREE.SphereGeometry(2.2,16,10),new THREE.MeshPhongMaterial({color:0xd253e2,transparent:true,opacity:.82}));elixir.scale.y=.72;elixir.position.set(-25,5.2,22);decorGroup.add(elixir);
  for(const [x,z,c] of [[-9,-18,0xff5b5b],[9,18,0x4dabf7]]){addBox(decorGroup,{x,y:3,z,w:.2,h:6,d:.2,c:'#5b4637'});const flag=new THREE.Mesh(new THREE.PlaneGeometry(2.3,1.25),new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide}));flag.position.set(x+1.15,5,z);flag.rotation.y=Math.PI/2;decorGroup.add(flag)}
}

function createWeapon(){
  if(!camera||!state.config)return;if(weaponGroup)camera.remove(weaponGroup);weaponGroup=new THREE.Group();camera.add(weaponGroup);scene.add(camera);
  const cfg=state.config.classes[state.klass],accent=new THREE.MeshStandardMaterial({color:color(cfg.color||'#ccc'),roughness:.7}),dark=new THREE.MeshStandardMaterial({color:0x22262b,roughness:.75}),skin=new THREE.MeshStandardMaterial({color:0xc88c67,roughness:.9});
  const part=(geo,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);weaponGroup.add(m);return m};const w=cfg.weapon;
  if(state.world==='voxel'&&state.klass==='Runner'){
    // Pixel sword silhouette instead of the arena blade.
    const swordMat=new THREE.MeshStandardMaterial({color:0x6fe4ee,roughness:.45,metalness:.15});
    part(new THREE.BoxGeometry(.10,.10,.85),swordMat,.28,-.24,-.70,-.52,0,-.35);part(new THREE.BoxGeometry(.5,.08,.12),dark,.28,-.28,-.42,-.52,0,-.35);part(new THREE.BoxGeometry(.12,.12,.34),new THREE.MeshStandardMaterial({color:0x7b4e2f}),.28,-.37,-.28,-.52,0,-.35);
  }else if(w==='Combat Blade'){
    part(new THREE.BoxGeometry(.05,.07,.65),accent,.30,-.28,-.65,-.2,0,-.4);part(new THREE.BoxGeometry(.09,.10,.22),dark,.24,-.25,-.34,0,0,-.4);
  }else if(w==='Dual Uzis'){
    for(const s of [-1,1]){part(new THREE.BoxGeometry(.16,.22,.7),dark,.27*s,-.28,-.65,.02,0,0);part(new THREE.BoxGeometry(.18,.07,.38),accent,.27*s,-.20,-.98)}
  }else{
    const len=w==='Sniper Rifle'?1.35:w==='Shotgun'?1.0:w==='LMG'?1.08:.92;part(new THREE.BoxGeometry(.18,.22,len),dark,.35,-.28,-.58-len/3,.03,0,0);part(new THREE.BoxGeometry(.19,.08,len*.54),accent,.35,-.20,-.56-len/2.2);part(new THREE.BoxGeometry(.12,.28,.16),dark,.35,-.42,-.52,.16,0,0);part(new THREE.BoxGeometry(.08,.08,.48),dark,.35,-.17,-.50-len,0,0,0);if(w==='Sniper Rifle'||w==='Assault Rifle'||w==='Semi Auto')part(new THREE.CylinderGeometry(.07,.07,.28,12),dark,.35,-.08,-.76,Math.PI/2,0,0);
  }
  part(new THREE.BoxGeometry(.14,.18,.30),skin,.23,-.43,-.25,.1,0,-.12);muzzle=new THREE.PointLight(0xffc35a,0,3);muzzle.position.set(.35,-.2,-1.75);weaponGroup.add(muzzle);weaponGroup.position.set(.05,-.02,0);updateAmmo(true);updateWeaponVisibility();
}
function updateWeaponVisibility(){if(weaponGroup)weaponGroup.visible=!state.buildMode}

function setupUI(){
  $('#playBtn').onclick=enterGame;$('#quickBtn').onclick=()=>{state.room='PUBLIC';connect(true);enterGame()};
  $('#classBtn').onclick=$('#classBtnSide').onclick=()=>openModal('classModal');$('#hostBtn').onclick=()=>openModal('hostModal');$('#joinBtn').onclick=()=>openModal('joinModal');$('#settingsBtn').onclick=()=>openModal('settingsModal');$('#worldsBtn').onclick=()=>openModal('worldModal');$('#serversBtn').onclick=()=>{openModal('serverModal');refreshServers()};
  $('#inviteBtn').onclick=copyInvite;$('#createRoomBtn').onclick=()=>{state.room=randCode();state.mode=$('#hostMode').value;state.world=$('#hostWorld').value;localStorage.setItem('bf_world',state.world);buildWorld(state.world);connect(true);closeModal('hostModal');copyInvite();refreshAllUI()};
  $('#joinRoomBtn').onclick=()=>{const c=$('#joinCode').value.trim().toUpperCase();if(!c)return;state.room=c;state.world=$('#joinWorld').value;localStorage.setItem('bf_world',state.world);buildWorld(state.world);connect(true);closeModal('joinModal');refreshAllUI();enterGame()};
  $('#refreshServersBtn').onclick=refreshServers;$('#continueBtn').onclick=()=>{closeModal('roundBreak');if(state.playing)renderer.domElement.requestPointerLock()};
  $$('.close').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
  $('#saveSettingsBtn').onclick=()=>{state.name=$('#nameInput').value.trim()||state.name;state.settings.sens=+$('#sensInput').value;state.settings.fov=+$('#fovInput').value;state.settings.bob=$('#bobInput').checked;state.settings.quality=$('#qualityInput').checked;localStorage.setItem('bf_name',state.name);localStorage.setItem('bf_sens',state.settings.sens);localStorage.setItem('bf_fov',state.settings.fov);localStorage.setItem('bf_bob',state.settings.bob?'1':'0');localStorage.setItem('bf_quality',state.settings.quality?'1':'0');applySettings();buildWorld(state.world);connect(true);closeModal('settingsModal');toast('Settings saved')};
  $('#sensInput').oninput=()=>$('#sensVal').textContent=(+$('#sensInput').value).toFixed(2);$('#fovInput').oninput=()=>$('#fovVal').textContent=$('#fovInput').value;
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==renderer.domElement&&state.playing&&!state.chat&&!$('#roundBreak').classList.contains('hidden'))return;if(document.pointerLockElement!==renderer.domElement&&state.playing&&!state.chat)showMenu()});
  document.addEventListener('mousemove',e=>{if(document.pointerLockElement===renderer.domElement&&!state.chat){state.yaw-=e.movementX*.0022*state.settings.sens;state.pitch-=e.movementY*.0022*state.settings.sens;state.pitch=clamp(state.pitch,-1.48,1.48)}});
  addEventListener('keydown',onKeyDown);addEventListener('keyup',e=>state.keys[e.code]=false);
  addEventListener('mousedown',e=>{if(!state.playing||state.chat)return;if(state.buildMode&&state.world==='voxel'){if(e.button===0)mineBlock();if(e.button===2)placeBlock();return}if(e.button===0){state.mouseDown=true;shoot()}if(e.button===2)state.ads=true});
  addEventListener('mouseup',e=>{if(e.button===0)state.mouseDown=false;if(e.button===2)state.ads=false});addEventListener('contextmenu',e=>e.preventDefault());
  $('#chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&state.chat){e.stopPropagation();const t=e.target.value.trim();if(t)wsSend({t:'chat',text:t});e.target.value='';toggleChat(false)}});
}

function buildWorldSelectors(){
  const grid=$('#worldGrid'),quick=$('#worldQuickSelect'),host=$('#hostWorld'),join=$('#joinWorld');grid.innerHTML='';quick.innerHTML='';host.innerHTML='';join.innerHTML='';
  const special={classic:'FAST ARENA',voxel:'MINE · BUILD · MOBS · DAY/NIGHT',stadium:'FOOTBALL STADIUM',battle:'CARTOON BATTLE ISLAND',clan:'3D RAIDER VILLAGE'};
  for(const id of state.config.world_order){const w=state.config.worlds[id],accent=WORLD_ACCENTS[id];
    const b=document.createElement('button');b.className='world-option'+(id===state.world?' active':'');b.innerHTML=`<div class="world-swatch" style="background:linear-gradient(135deg,${w.sky},${w.ground})"></div><h3>${esc(w.name)}</h3><p>${esc(w.description)}</p><span class="special">${special[id]}</span>`;b.onclick=()=>selectWorld(id);grid.appendChild(b);
    const q=document.createElement('button');q.className='world-chip'+(id===state.world?' active':'');q.dataset.world=id;q.innerHTML=`<span class="dot" style="background:${accent}"></span>${esc(w.short)}`;q.onclick=()=>selectWorld(id);quick.appendChild(q);
    for(const sel of [host,join]){const o=document.createElement('option');o.value=id;o.textContent=w.name;if(id===state.world)o.selected=true;sel.appendChild(o)}
  }
}
function selectWorld(id){if(!state.config.worlds[id])return;state.world=id;state.room='PUBLIC';localStorage.setItem('bf_world',id);buildWorld(id);buildWorldSelectors();connect(true);closeModal('worldModal');refreshAllUI();toast(`${state.config.worlds[id].name} selected`)}

function applySettings(){
  $('#nameInput').value=state.name;$('#sensInput').value=state.settings.sens;$('#fovInput').value=state.settings.fov;$('#bobInput').checked=state.settings.bob;$('#qualityInput').checked=state.settings.quality;$('#sensVal').textContent=state.settings.sens.toFixed(2);$('#fovVal').textContent=state.settings.fov;$('#menuName').textContent=state.name.toUpperCase();if(camera){camera.fov=state.settings.fov;camera.updateProjectionMatrix();renderer?.setPixelRatio(Math.min(devicePixelRatio,state.settings.quality?1.6:1.15))}
}
function refreshAllUI(){refreshLoadout();refreshRoomUI();refreshWorldUI()}
function refreshLoadout(){const c=state.config.classes[state.klass];$('#className').textContent=state.klass;const weapon=state.world==='voxel'&&state.klass==='Runner'?'Block Sword':c.weapon;$('#weaponName').textContent=weapon;$('#weaponHud').textContent=weapon;$('#loadoutCard').style.borderRightColor=c.color}
function refreshWorldUI(){const w=state.config.worlds[state.world];if(!w)return;$('#worldLabel').textContent=w.name.toUpperCase();$('#worldHud').textContent=w.short.toUpperCase();document.documentElement.style.setProperty('--accent',WORLD_ACCENTS[state.world]||'#f0b63f');refreshLoadout()}
function refreshRoomUI(){
  $('#roomLabel').textContent=state.room;$('#modeLabel').textContent=state.mode;$('#hudMode').textContent=state.mode;$('#roomHud').textContent=`ROOM ${state.room}`;const u=new URL(location.href);u.searchParams.set('room',state.room);u.searchParams.set('mode',state.mode);u.searchParams.set('world',state.world);history.replaceState(null,'',u);
}
function buildClassGrid(){const g=$('#classGrid');g.innerHTML='';for(const [name,c] of Object.entries(state.config.classes)){const b=document.createElement('button');b.className='class-option'+(name===state.klass?' active':'');b.innerHTML=`<b>${esc(name)}</b><small>${esc(c.weapon)}</small><div class="stats">HP ${c.hp} · SPD ${Number(c.speed).toFixed(2)} · DMG ${c.damage}</div>`;b.onclick=()=>selectClass(name);g.appendChild(b)}}
function selectClass(k){state.klass=k;localStorage.setItem('bf_class',k);state.ammo=state.config.classes[k].mag;state.reloading=false;refreshLoadout();createWeapon();buildClassGrid();wsSend({t:'class',klass:k});closeModal('classModal');toast(`${k} equipped`)}
function openModal(id){$('#'+id).classList.remove('hidden')}function closeModal(id){$('#'+id).classList.add('hidden')}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1700)}
async function copyInvite(){const u=new URL(location.href);u.searchParams.set('room',state.room);u.searchParams.set('mode',state.mode);u.searchParams.set('world',state.world);try{await navigator.clipboard.writeText(u.toString());toast('Invite link copied')}catch{prompt('Copy this invite link:',u.toString())}}
async function refreshServers(){const list=$('#serverList');list.innerHTML='<div class="empty-servers">Loading rooms…</div>';try{const data=await fetch('/api/rooms').then(r=>r.json());if(!data.rooms.length){list.innerHTML='<div class="empty-servers">No active rooms yet. Host one and invite a friend.</div>';return}list.innerHTML='';for(const r of data.rooms){const d=document.createElement('div');d.className='server-row';d.innerHTML=`<b>${esc(r.world_name)}</b><span>${esc(r.mode)}</span><span class="optional">${r.players} player${r.players===1?'':'s'}</span><small class="optional">${fmtTime(r.remaining)}</small><button>JOIN</button>`;d.querySelector('button').onclick=()=>{state.room=r.code;state.world=r.world;state.mode=r.mode;localStorage.setItem('bf_world',state.world);buildWorld(state.world);connect(true);closeModal('serverModal');refreshAllUI();enterGame()};list.appendChild(d)}}catch{list.innerHTML='<div class="empty-servers">Could not load room list.</div>'}}

function connect(force=false){
  if(state.ws&&state.ws.readyState<=1){if(!force)return;try{state.ws.onclose=null;state.ws.close()}catch{}}
  const proto=location.protocol==='https:'?'wss':'ws';const url=`${proto}://${location.host}/ws/${encodeURIComponent(state.room)}?name=${encodeURIComponent(state.name)}&klass=${encodeURIComponent(state.klass)}&mode=${encodeURIComponent(state.mode)}&world=${encodeURIComponent(state.world)}`;
  const ws=new WebSocket(url);state.ws=ws;const opened=performance.now();$('#menuPing').textContent='CONNECTING';
  ws.onopen=()=>{state.connected=true;state.ping=Math.round(performance.now()-opened);$('#menuPing').textContent=`${state.ping} PING`};
  ws.onclose=()=>{state.connected=false;$('#menuPing').textContent='RECONNECTING';if(state.ws===ws)setTimeout(()=>connect(),1200)};ws.onerror=()=>{$('#menuPing').textContent='OFFLINE'};ws.onmessage=e=>handleMessage(JSON.parse(e.data));
}
function wsSend(x){if(state.ws&&state.ws.readyState===1)state.ws.send(JSON.stringify(x))}
function handleMessage(m){
  if(m.t==='welcome'){
    state.id=m.id;state.room=m.room;state.mode=m.mode;if(m.world&&m.world!==state.world){state.world=m.world;buildWorld(state.world);buildWorldSelectors()}state.pos.set(m.player.x,m.player.y,m.player.z);state.hp=m.player.hp;state.alive=true;state.ammo=state.config.classes[state.klass].mag;if(state.world==='voxel')syncBlocks(m.blocks||[]);refreshAllUI();
  }else if(m.t==='snapshot'){
    state.mode=m.mode;state.worldTime=m.world_time||0;renderSnapshot(m.players);renderMobSnapshot(m.mobs||[]);$('#timer').textContent=fmtTime(m.remaining);if(m.mode!=='FFA')$('#teamScore').textContent=`Alpha ${m.team_scores.Alpha} : ${m.team_scores.Bravo} Bravo`;else $('#teamScore').textContent='';updateScoreboard(m.players);if(m.mode==='HARDPOINT')updateHardpoint(m.hardpoint);else hardpointMesh.visible=false;
  }else if(m.t==='kill'){
    feed(`<b>${esc(m.killer)}</b> <span>${esc(m.weapon)}</span> <em>${esc(m.victim)}</em>`);if(m.victim_id===state.id){state.alive=false;state.hp=0;$('#respawn').classList.remove('hidden');$('#hp').textContent='0';$('#hpbar').style.width='0%';setTimeout(()=>wsSend({t:'respawn'}),1370)}
  }else if(m.t==='respawn'&&m.player.id===state.id){state.pos.set(m.player.x,m.player.y,m.player.z);state.vel.set(0,0,0);state.hp=m.player.hp;state.alive=true;state.ammo=state.config.classes[state.klass].mag;$('#respawn').classList.add('hidden');updateHP();updateAmmo(true)
  }else if(m.t==='hit'){if(m.attacker===state.id)hitmarker()}
  else if(m.t==='mob_hit'){if(m.attacker===state.id)hitmarker()}
  else if(m.t==='mob_kill'){feed(`<b>${esc(m.killer)}</b> defeated <em>${esc(m.kind)}</em>`)}
  else if(m.t==='mob_attack'){if(m.victim===state.id){state.hp=m.hp;damageFlash();updateHP()}}
  else if(m.t==='blocks')syncBlocks(m.blocks||[])
  else if(m.t==='error'){toast(m.message||'Server error');showMenu()}
  else if(m.t==='event')feed(`<span>${esc(m.text)}</span>`)
  else if(m.t==='chat')addChat(m.name,m.text)
  else if(m.t==='match_end'){showRoundBreak(m.winners||[])}
}
function showRoundBreak(winners){$('#roundWinner').textContent=winners[0]?`Winner: ${winners[0].name} · ${winners[0].score} pts`:'Round complete';prepareNaturalBreak();document.exitPointerLock();openModal('roundBreak')}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtTime(s){s=Math.max(0,Math.ceil(s));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
function feed(html){const k=$('#killfeed');const d=document.createElement('div');d.className='feed';d.innerHTML=html;k.prepend(d);setTimeout(()=>d.remove(),4500)}
function addChat(n,t){const d=document.createElement('div');d.className='chatline';d.innerHTML=`<b>${esc(n)}</b>: ${esc(t)}`;$('#chatlog').append(d);while($('#chatlog').children.length>7)$('#chatlog').firstChild.remove()}
function hitmarker(){const h=$('#hitmarker');h.classList.add('show');setTimeout(()=>h.classList.remove('show'),85)}
function damageFlash(){$('#damageFlash').style.background='rgba(255,0,0,.24)';setTimeout(()=>$('#damageFlash').style.background='rgba(255,0,0,0)',90)}

function renderSnapshot(players){
  const seen=new Set();for(const p of players){state.players.set(p.id,p);seen.add(p.id);if(p.id===state.id){if(p.hp<state.hp)damageFlash();state.hp=p.hp;state.alive=p.alive;updateHP();continue}let r=state.remote.get(p.id);if(!r){r=createRemote(p);state.remote.set(p.id,r)}r.target.set(p.x,p.y,p.z);r.yaw=p.yaw;r.alive=p.alive;r.group.visible=p.alive}
  for(const [id,r] of state.remote)if(!seen.has(id)){remoteGroup.remove(r.group);state.remote.delete(id)}
}
function createRemote(p){
  const g=new THREE.Group(),c=color(state.config.classes[p.klass]?.color||'#ddd'),bodyMat=new THREE.MeshLambertMaterial({color:c});const body=new THREE.Mesh(new THREE.BoxGeometry(.72,1,.46),bodyMat);body.position.y=1;g.add(body);const head=new THREE.Mesh(new THREE.BoxGeometry(.52,.52,.52),new THREE.MeshLambertMaterial({color:0xc88c67}));head.position.y=1.72;g.add(head);const gun=new THREE.Mesh(new THREE.BoxGeometry(.15,.15,.75),new THREE.MeshLambertMaterial({color:0x222222}));gun.position.set(.38,1.12,-.25);g.add(gun);const name=makeLabel(p.name);name.position.set(0,2.25,0);g.add(name);remoteGroup.add(g);g.position.set(p.x,p.y,p.z);return{group:g,target:new THREE.Vector3(p.x,p.y,p.z),yaw:p.yaw,name}
}
function makeLabel(text){const c=document.createElement('canvas');c.width=256;c.height=64;const x=c.getContext('2d');x.font='bold 26px Inter,Arial';x.textAlign='center';x.fillStyle='rgba(0,0,0,.55)';x.fillRect(0,10,256,40);x.fillStyle='white';x.fillText(text,128,40);const tex=new THREE.CanvasTexture(c);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));s.scale.set(2.5,.63,1);return s}
function renderMobSnapshot(mobs){
  const seen=new Set();for(const m of mobs){seen.add(m.id);let r=state.mobs.get(m.id);if(!r){r=createMob(m);state.mobs.set(m.id,r)}r.target.set(m.x,m.y,m.z);r.group.visible=m.alive}
  for(const [id,r] of state.mobs)if(!seen.has(id)){mobGroup.remove(r.group);state.mobs.delete(id)}
}
function createMob(m){
  const g=new THREE.Group();if(m.kind==='Zombie'){const green=new THREE.MeshLambertMaterial({color:0x669b4f});const shirt=new THREE.MeshLambertMaterial({color:0x4f8e8d});const legs=new THREE.MeshLambertMaterial({color:0x3d4e85});const body=new THREE.Mesh(new THREE.BoxGeometry(.75,.8,.4),shirt);body.position.y=1;g.add(body);const head=new THREE.Mesh(new THREE.BoxGeometry(.55,.55,.55),green);head.position.y=1.68;g.add(head);for(const s of [-1,1]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.25,.65,.28),legs);leg.position.set(.2*s,.35,0);g.add(leg);const arm=new THREE.Mesh(new THREE.BoxGeometry(.22,.22,.75),green);arm.position.set(.48*s,1.16,-.24);g.add(arm)}}else{const slime=new THREE.Mesh(new THREE.BoxGeometry(1.1,.9,1.1),new THREE.MeshLambertMaterial({color:0x62d66b,transparent:true,opacity:.88}));slime.position.y=.48;g.add(slime);for(const s of [-1,1]){const eye=new THREE.Mesh(new THREE.BoxGeometry(.14,.18,.05),new THREE.MeshBasicMaterial({color:0x111111}));eye.position.set(.22*s,.6,-.56);g.add(eye)}}mobGroup.add(g);g.position.set(m.x,m.y,m.z);return{group:g,target:new THREE.Vector3(m.x,m.y,m.z)}
}
function updateScoreboard(players){const rows=[...players].sort((a,b)=>b.score-a.score);$('#scoreRows').innerHTML=rows.map((p,i)=>`<div class="score-row ${p.id===state.id?'me':''}"><span>${i+1}</span><b class="${p.team==='Alpha'?'alpha':p.team==='Bravo'?'bravo':''}">${esc(p.name)}</b><span>${esc(p.klass)}</span><span>${p.kills} K</span><span>${p.deaths} D</span></div>`).join('')}
function updateHardpoint(i){const hp=state.config.worlds[state.world].hardpoints[i]||state.config.worlds[state.world].hardpoints[0];hardpointMesh.position.set(hp[0],.04,hp[2]);hardpointMesh.visible=true;const d=Math.hypot(state.pos.x-hp[0],state.pos.z-hp[2]);$('#hardpoint').classList.toggle('hidden',d>8)}

function syncBlocks(blocks){
  clearGroup(dynamicGroup);state.dynamicBlocks.clear();for(const b of blocks){state.dynamicBlocks.set(b.key,b);const m=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),voxelMaterial(b.type,b.powered));m.position.set(b.x,b.y,b.z);m.userData.blockKey=b.key;m.userData.block=b;dynamicGroup.add(m)}rebuildColliders();
}
function rebuildColliders(){const w=state.config.worlds[state.world];state.currentBoxes=[...w.boxes];for(const b of state.dynamicBlocks.values())state.currentBoxes.push({x:b.x,y:b.y,z:b.z,w:2,h:2,d:2,c:BLOCK_COLORS[b.type]||'#777',tag:b.type,removable:true})}
function blockRay(){raycaster.setFromCamera(new THREE.Vector2(0,0),camera);raycaster.far=7;const hits=raycaster.intersectObjects(dynamicGroup.children,false);return hits[0]||null}
function mineBlock(){const hit=blockRay();if(!hit)return;const key=hit.object.userData.blockKey;if(key)wsSend({t:'block_break',key})}
function placeBlock(){
  const hit=blockRay();let pos;if(hit&&hit.object.userData.block){const b=hit.object.userData.block;const n=hit.face?.normal||new THREE.Vector3(0,1,0);pos=[b.x+Math.round(n.x)*2,b.y+Math.round(n.y)*2,b.z+Math.round(n.z)*2]}else{const d=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);const p=camera.getWorldPosition(new THREE.Vector3()).add(d.multiplyScalar(4));pos=[Math.round(p.x/2)*2,Math.round((p.y-1)/2)*2+1,Math.round(p.z/2)*2]}wsSend({t:'block_place',pos,type:BLOCK_TYPES[state.blockIndex]})
}
function useBlock(){const hit=blockRay();if(hit?.object?.userData?.blockKey)wsSend({t:'block_use',key:hit.object.userData.blockKey})}
function toggleBuildMode(){if(state.world!=='voxel'){toast('Building is available in Voxel Frontier');return}state.buildMode=!state.buildMode;state.mouseDown=false;state.ads=false;updateBuildHud();updateWeaponVisibility();toast(state.buildMode?'Build/mining mode':'Combat mode')}
function cycleBlock(){if(state.world!=='voxel')return;state.blockIndex=(state.blockIndex+1)%BLOCK_TYPES.length;updateBuildHud();toast(`Block: ${BLOCK_TYPES[state.blockIndex]}`)}
function updateBuildHud(){const mode=$('#voxelMode');if(mode)mode.textContent=state.buildMode?'BUILD / MINING MODE':'COMBAT MODE';const bar=$('#blockHotbar');if(!bar)return;bar.innerHTML='';BLOCK_TYPES.forEach((t,i)=>{const d=document.createElement('div');d.className='block-slot'+(i===state.blockIndex?' active':'');d.style.background=BLOCK_COLORS[t];d.title=t;d.textContent=String(i+1);bar.appendChild(d)});$('#crosshair')?.classList.toggle('build-crosshair',state.buildMode)}

function enterGame(){state.playing=true;$('#menu').classList.remove('show');$('#hud').classList.remove('hidden');setGameplayActive(true);renderer.domElement.requestPointerLock()}
function showMenu(){state.playing=false;state.mouseDown=false;state.ads=false;state.buildMode=false;updateBuildHud();updateWeaponVisibility();$('#menu').classList.add('show');$('#hud').classList.add('hidden');setGameplayActive(false)}
function onKeyDown(e){
  if(e.code==='Enter'&&state.playing){e.preventDefault();toggleChat();return}if(state.chat){if(e.code==='Escape')toggleChat(false);return}state.keys[e.code]=true;
  if(e.code==='Tab'){e.preventDefault();$('#scoreboard').classList.remove('hidden')}if(e.code==='KeyR'&&!state.buildMode)reload();if(e.code==='KeyQ')wsSend({t:'melee'});if(e.code==='KeyB')toggleBuildMode();if(e.code==='KeyV')cycleBlock();if(e.code==='KeyE'&&state.buildMode)useBlock();if(e.code==='Escape'&&state.playing)showMenu();
  if(state.world==='voxel'&&state.buildMode&&/^Digit[1-7]$/.test(e.code)){state.blockIndex=Number(e.code.slice(5))-1;updateBuildHud()}
}
addEventListener('keyup',e=>{if(e.code==='Tab')$('#scoreboard').classList.add('hidden')});
function toggleChat(force){const next=force!==undefined?force:!state.chat;state.chat=next;const box=$('#chatbox'),inp=$('#chatInput');box.classList.toggle('chatting',next);if(next){document.exitPointerLock();setTimeout(()=>inp.focus(),0)}else{inp.blur();if(state.playing)renderer.domElement.requestPointerLock()}}

function collidesAt(x,y,z){const r=.38,h=1.78;for(const b of state.currentBoxes){const minx=b.x-b.w/2-r,maxx=b.x+b.w/2+r,minz=b.z-b.d/2-r,maxz=b.z+b.d/2+r,miny=b.y-b.h/2,maxy=b.y+b.h/2;if(x>minx&&x<maxx&&z>minz&&z<maxz&&y+h>miny+.05&&y<maxy-.05)return b}return null}
function groundHeightAt(x,z,currentY){let best=0;for(const b of state.currentBoxes){const top=b.y+b.h/2;if(x>b.x-b.w/2+.2&&x<b.x+b.w/2-.2&&z>b.z-b.d/2+.2&&z<b.z+b.d/2-.2&&top<=currentY+.4&&top>best)best=top}return best}
function physics(dt){
  if(!state.playing||!state.alive||state.chat)return;const cfg=state.config.classes[state.klass],fwd=new THREE.Vector3(-Math.sin(state.yaw),0,-Math.cos(state.yaw)),right=new THREE.Vector3(Math.cos(state.yaw),0,-Math.sin(state.yaw));let wish=new THREE.Vector3();if(state.keys.KeyW)wish.add(fwd);if(state.keys.KeyS)wish.sub(fwd);if(state.keys.KeyD)wish.add(right);if(state.keys.KeyA)wish.sub(right);if(wish.lengthSq())wish.normalize();
  const speedMult=cfg.speed,base=7.35*speedMult,horizontal=Math.hypot(state.vel.x,state.vel.z),shift=state.keys.ShiftLeft||state.keys.ShiftRight;
  if(state.grounded&&shift&&horizontal>4.2&&state.slide<=0){state.slide=.43;state.crouched=true;const boost=Math.min(15.8*speedMult,Math.max(base*1.22,horizontal*1.09));if(horizontal>0){state.vel.x=state.vel.x/horizontal*boost;state.vel.z=state.vel.z/horizontal*boost}}
  if(state.slide>0){state.slide-=dt;state.crouched=true;if(wish.lengthSq()){state.vel.x+=wish.x*4*dt;state.vel.z+=wish.z*4*dt}const drag=Math.pow(.72,dt);state.vel.x*=drag;state.vel.z*=drag}else state.crouched=shift&&state.grounded;
  const accel=state.grounded?34:12,target=base;if(state.slide<=0){if(wish.lengthSq()){state.vel.x+=wish.x*accel*dt;state.vel.z+=wish.z*accel*dt;const s=Math.hypot(state.vel.x,state.vel.z),cap=state.grounded?target*1.25:Math.max(target*1.2,state.speedBoost*target);if(s>cap){state.vel.x*=cap/s;state.vel.z*=cap/s}}else if(state.grounded){const fr=Math.max(0,1-9*dt);state.vel.x*=fr;state.vel.z*=fr}}
  const jump=state.keys.Space;if(jump&&!state.jumpLatch&&state.grounded){const s=Math.hypot(state.vel.x,state.vel.z);state.vel.y=7.4;state.grounded=false;state.jumpLatch=true;if(state.slide>0||state.landGrace>0){const n=Math.max(s,base);state.speedBoost=clamp(n/base*1.035,1,2.15);if(s>0){state.vel.x*=1.035;state.vel.z*=1.035}}state.slide=0}if(!jump)state.jumpLatch=false;if(!state.grounded)state.vel.y-=20.5*dt;state.landGrace=Math.max(0,state.landGrace-dt);
  const nx=state.pos.x+state.vel.x*dt,nz=state.pos.z+state.vel.z*dt;const bx=collidesAt(nx,state.pos.y,state.pos.z);if(!bx)state.pos.x=nx;else{if(cfg.wall_jump&&jump&&!state.grounded&&!state.jumpLatch){state.vel.y=7;state.vel.x*=-.42;state.jumpLatch=true}state.vel.x=0}const bz=collidesAt(state.pos.x,state.pos.y,nz);if(!bz)state.pos.z=nz;else{if(cfg.wall_jump&&jump&&!state.grounded&&!state.jumpLatch){state.vel.y=7;state.vel.z*=-.42;state.jumpLatch=true}state.vel.z=0}
  const prevY=state.pos.y;state.pos.y+=state.vel.y*dt;const gh=groundHeightAt(state.pos.x,state.pos.z,prevY+.2);if(state.pos.y<=gh&&state.vel.y<=0){if(!state.grounded){state.landGrace=.11;const s=Math.hypot(state.vel.x,state.vel.z);state.speedBoost=clamp(s/base,1,2.2)}state.pos.y=gh;state.vel.y=0;state.grounded=true}else state.grounded=false;if(state.pos.y<-4){state.pos.set(0,0,0);state.vel.set(0,0,0)}$('#speed').textContent=Math.round(Math.hypot(state.vel.x,state.vel.z)*10);
}

function shoot(){
  if(!state.playing||!state.alive||state.chat||state.reloading||state.buildMode)return;const cfg=state.config.classes[state.klass],now=performance.now(),delay=60000/cfg.rpm;if(now-state.lastShot<delay)return;if(state.ammo<=0){reload();return}state.lastShot=now;state.ammo--;updateAmmo();muzzle.intensity=10;setTimeout(()=>muzzle.intensity=0,35);weaponGroup.rotation.x=-.045;weaponGroup.position.z=.045;const spread=cfg.spread*(state.ads?.42:1),dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);dir.x+=(Math.random()-.5)*spread;dir.y+=(Math.random()-.5)*spread;dir.z+=(Math.random()-.5)*spread;dir.normalize();const o=camera.getWorldPosition(new THREE.Vector3());wsSend({t:'fire',o:[o.x,o.y,o.z],d:[dir.x,dir.y,dir.z]});state.pitch+=(cfg.weapon==='Sniper Rifle'?.035:cfg.weapon==='LMG'?.014:.009)*(state.ads?.65:1);playShot(cfg.weapon);if(state.ammo===0)setTimeout(reload,130)
}
function reload(){if(state.reloading||state.buildMode)return;const cfg=state.config.classes[state.klass];if(state.ammo>=cfg.mag)return;state.reloading=true;$('#mag').textContent='R';setTimeout(()=>{state.ammo=cfg.mag;state.reloading=false;updateAmmo()},cfg.reload*1000)}
function updateAmmo(force=false){if(!state.config)return;const cfg=state.config.classes[state.klass];if(force&&(!Number.isFinite(state.ammo)||state.ammo>cfg.mag))state.ammo=cfg.mag;$('#mag').textContent=state.reloading?'R':state.ammo;$('#reserve').textContent='∞'}
function updateHP(){const cfg=state.config.classes[state.klass],max=cfg.hp;$('#hp').textContent=Math.max(0,state.hp);$('#hpbar').style.width=`${clamp(state.hp/max*100,0,100)}%`}
function playShot(type){try{const C=window.AudioContext||window.webkitAudioContext;window._ac=window._ac||new C();const ac=window._ac,o=ac.createOscillator(),g=ac.createGain();o.type=type==='Sniper Rifle'?'sawtooth':'square';o.frequency.setValueAtTime(type==='Shotgun'?75:type==='Sniper Rifle'?105:135,ac.currentTime);o.frequency.exponentialRampToValueAtTime(45,ac.currentTime+.07);g.gain.setValueAtTime(.045,ac.currentTime);g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.09);o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+.1)}catch{}}

function updateDayNight(){
  if(state.world!=='voxel')return;const t=state.worldTime,a=t*Math.PI*2,day=Math.max(0,Math.sin(a));const dusk=Math.max(0,Math.sin(a+Math.PI));const skyDay=new THREE.Color(0x7ec8ff),skyNight=new THREE.Color(0x071229);const mix=clamp(day*1.18+.08,.08,1);scene.background=skyNight.clone().lerp(skyDay,mix);scene.fog.color.copy(scene.background);hemi.intensity=.35+1.85*mix;sun.intensity=.08+1.4*day;moonLight.intensity=.7*(1-mix);if(skySun){skySun.position.set(Math.cos(a)*42,10+Math.sin(a)*34,-38);skySun.visible=Math.sin(a)>-.18}if(skyMoon){skyMoon.position.set(Math.cos(a+Math.PI)*42,10+Math.sin(a+Math.PI)*34,-38);skyMoon.visible=Math.sin(a)<.28}if(stars)stars.visible=mix<.45;$('#dayIcon').textContent=mix>.4?'☀':'☾';$('#dayLabel').textContent=mix>.4?'DAY':'NIGHT';
}

let netAcc=0,menuCamT=0,frameCount=0,fpsAcc=0;
function animate(){
  requestAnimationFrame(animate);const dt=Math.min(.033,clock?clock.getDelta():.016);frameCount++;fpsAcc+=dt;if(fpsAcc>1){$('#menuFps').textContent=`${Math.round(frameCount/fpsAcc)} FPS`;frameCount=0;fpsAcc=0}updateDayNight();if(stormRing)stormRing.rotation.y+=dt*.08;
  if(state.playing){physics(dt);camera.position.set(state.pos.x,state.pos.y+(state.crouched?1.18:1.62),state.pos.z);camera.rotation.set(state.pitch,state.yaw,0);const targetFov=state.ads&&!state.buildMode?Math.max(48,state.settings.fov*.68):state.settings.fov;camera.fov=lerp(camera.fov,targetFov,1-Math.pow(.001,dt));camera.updateProjectionMatrix();const sp=Math.hypot(state.vel.x,state.vel.z),bob=state.settings.bob&&state.grounded?Math.sin(performance.now()*.015)*Math.min(.014,sp*.0013):0;const adsX=state.ads&&!state.buildMode?-.32:.05,adsY=state.ads&&!state.buildMode?.02:-.02;if(weaponGroup){weaponGroup.position.x=lerp(weaponGroup.position.x,adsX,dt*12);weaponGroup.position.y=lerp(weaponGroup.position.y,adsY+bob,dt*12);weaponGroup.position.z=lerp(weaponGroup.position.z,0,dt*18);weaponGroup.rotation.x=lerp(weaponGroup.rotation.x,0,dt*16)}$('#crosshair').style.opacity=state.ads&&!state.buildMode?.28:1;netAcc+=dt;if(netAcc>.05){netAcc=0;wsSend({t:'state',x:state.pos.x,y:state.pos.y,z:state.pos.z,yaw:state.yaw,pitch:state.pitch,vx:state.vel.x,vy:state.vel.y,vz:state.vel.z})}if(state.mouseDown)shoot();
  }else{menuCamT+=dt*.13;const radius=state.world==='stadium'?25:16;camera.position.set(Math.sin(menuCamT)*radius,6+Math.sin(menuCamT*.55)*1.2,Math.cos(menuCamT)*radius);camera.lookAt(0,2,0);if(weaponGroup)weaponGroup.position.set(.05,-.02,0)}
  for(const r of state.remote.values()){r.group.position.lerp(r.target,1-Math.pow(.0008,dt));r.group.rotation.y=r.yaw}for(const r of state.mobs.values())r.group.position.lerp(r.target,1-Math.pow(.001,dt));renderer.render(scene,camera);
}

boot().catch(err=>{console.error(err);document.body.insertAdjacentHTML('beforeend',`<div style="position:fixed;inset:20px;z-index:999;background:#200;color:#fff;padding:20px">Blockfront failed to start: ${esc(err.message||err)}</div>`)});
