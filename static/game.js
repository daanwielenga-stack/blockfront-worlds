import * as THREE from 'three';
import {initAds, setGameplayActive, prepareNaturalBreak} from './ads.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const randCode=()=>Math.random().toString(36).slice(2,8).toUpperCase();
const WORLD_ACCENTS={classic:'#f4b942',voxel:'#79c64a',stadium:'#36c76c',battle:'#b067ff',clan:'#e5a93a'};
const BLOCK_TYPES=['dirt','stone','wood','glass','redstone','lamp','lever'];
const BLOCK_COLORS={grass:'#6fb24c',dirt:'#8a5a32',stone:'#777777',wood:'#9b6b3f',glass:'#9ed7e5',redstone:'#8f1d1d',lamp:'#d7a632',lever:'#74604b'};
const VOXEL_RENDER_RADIUS=92;
const VOXEL_HORIZON_RADIUS=190;
const VOXEL_HORIZON_STEP=4;
const CLAN_TH_COUNT=17;
const MC_HOTBAR_SIZE=9;

const state={
  config:null,siteConfig:null,ws:null,id:null,connected:false,playing:false,room:'PUBLIC',mode:'FFA',world:localStorage.getItem('bf_world')||'classic',
  name:localStorage.getItem('bf_name')||`Guest_${Math.floor(Math.random()*900+100)}`,
  klass:localStorage.getItem('bf_class')||'Triggerman',weapon:localStorage.getItem('bf_weapon')||'Assault Rifle',
  settings:{sens:+(localStorage.getItem('bf_sens')||1),fov:+(localStorage.getItem('bf_fov')||82),bob:localStorage.getItem('bf_bob')!=='0',quality:localStorage.getItem('bf_quality')!=='0'},
  hp:100,alive:true,ammo:30,reloading:false,lastShot:0,players:new Map(),killfeed:[],keys:{},mouseDown:false,ads:false,
  yaw:0,pitch:0,pos:new THREE.Vector3(0,0,0),vel:new THREE.Vector3(),grounded:true,slide:0,crouched:false,jumpLatch:false,landGrace:0,speedBoost:1,chat:false,
  remote:new Map(),mobs:new Map(),ping:0,currentBoxes:[],dynamicBlocks:new Map(),buildMode:false,blockIndex:0,mcHotbar:0,mcSprint:false,lastWDown:0,stepAt:0,worldTime:0,streamChunk:'',voxelRenderKey:'',voxelHorizonKey:'',clanRenderKey:'',milanProjectiles:[]
};

let scene,camera,renderer,clock,weaponGroup,muzzle,worldGroup,streamGroup,dynamicGroup,remoteGroup,mobGroup,decorGroup,hardpointMesh;
let hemi,sun,moonLight,skySun,skyMoon,stars,stormRing;
let cleanerBots=[];
const raycaster=new THREE.Raycaster();
const textureCache=new Map();

async function boot(){
  [state.config,state.siteConfig]=await Promise.all([
    fetch('/api/config').then(r=>r.json()),
    fetch('/api/site-config').then(r=>r.json()).catch(()=>({ads:{enabled:false}})),
  ]);
  if(!state.config.classes[state.klass]) state.klass='Triggerman';
  if(!state.config.weapons?.[state.weapon]) state.weapon='Assault Rifle';
  if(!state.config.worlds[state.world]) state.world='classic';
  const url=new URL(location.href);
  const qworld=url.searchParams.get('world');if(qworld&&state.config.worlds[qworld])state.world=qworld;
  const qroom=url.searchParams.get('room');const qmode=url.searchParams.get('mode');
  if(qroom)state.room=qroom.toUpperCase();if(qmode)state.mode=qmode.toUpperCase();
  setupScene();setupUI();applySettings();buildClassGrid();buildGunGrid();buildWorldSelectors();buildWorld(state.world);refreshAllUI();
  initAds(state.siteConfig);
  connect();animate();
}

function setupScene(){
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(state.settings.fov,innerWidth/innerHeight,.05,650);camera.rotation.order='YXZ';
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.shadowMap.enabled=state.settings.quality;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setPixelRatio(Math.min(devicePixelRatio,state.settings.quality?1.6:1.15));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;$('#game').appendChild(renderer.domElement);
  hemi=new THREE.HemisphereLight(0xffffff,0x53674e,2.0);scene.add(hemi);
  sun=new THREE.DirectionalLight(0xffffff,1.25);sun.position.set(30,55,18);sun.castShadow=state.settings.quality;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-70;sun.shadow.camera.right=70;sun.shadow.camera.top=70;sun.shadow.camera.bottom=-70;scene.add(sun);
  moonLight=new THREE.DirectionalLight(0x8da6ff,0);moonLight.position.set(-30,40,-15);scene.add(moonLight);
  worldGroup=new THREE.Group();streamGroup=new THREE.Group();dynamicGroup=new THREE.Group();remoteGroup=new THREE.Group();mobGroup=new THREE.Group();decorGroup=new THREE.Group();scene.add(worldGroup,streamGroup,dynamicGroup,decorGroup,remoteGroup,mobGroup);
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
  clearGroup(worldGroup);clearGroup(streamGroup);clearGroup(decorGroup);clearGroup(dynamicGroup);clearGroup(mobGroup);state.dynamicBlocks.clear();state.mobs.clear();state.streamChunk='';state.voxelRenderKey='';state.voxelHorizonKey='';state.clanRenderKey='';
  scene.background=color(w.sky);scene.fog=new THREE.Fog(color(w.fog),id==='voxel'?95:58,id==='voxel'?245:id==='clan'?260:id==='stadium'?145:125);hemi.intensity=2;sun.intensity=1.25;moonLight.intensity=0;stormRing=null;skySun=skyMoon=stars=null;
  buildGround(w);for(const b of w.boxes)addStyledWorldBox(w,b);buildDecor(w);updateStreamingWorld(true);state.currentBoxes=[...w.boxes];
  $('#voxelHud').classList.toggle('hidden',id!=='voxel');$('#dayNight').classList.toggle('hidden',id!=='voxel');state.buildMode=false;if(id==='voxel')state.mcHotbar=0;updateBuildHud();refreshWorldUI();createWeapon();
}

function clanGrassTexture(){
  const key='clan:grass';if(textureCache.has(key))return textureCache.get(key);
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
  x.fillStyle='#83c85d';x.fillRect(0,0,256,256);
  const cells=16,sz=256/cells;
  for(let iy=0;iy<cells;iy++)for(let ix=0;ix<cells;ix++){
    const v=(ix*19+iy*31)%5; x.fillStyle=['#82c85d','#87cc62','#7fc258','#8bd066','#79bb54'][v];
    x.fillRect(ix*sz,iy*sz,sz,sz);
  }
  for(let i=0;i<380;i++){x.fillStyle=i%3===0?'rgba(255,255,210,.13)':'rgba(32,104,35,.10)';const px=Math.random()*256,py=Math.random()*256,s=1+Math.random()*2;x.fillRect(px,py,s,s)}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(10,10);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.colorSpace=THREE.SRGBColorSpace;textureCache.set(key,t);return t;
}
function buildGround(w){
  if(w.theme==='voxel'){
    const water=new THREE.Mesh(new THREE.PlaneGeometry(24,4),new THREE.MeshPhongMaterial({color:0x3f91d6,transparent:true,opacity:.78,shininess:80}));
    water.rotation.x=-Math.PI/2;water.rotation.z=.08;water.position.set(0,.025,3);worldGroup.add(water);
  }else if(w.theme==='stadium'){
    addPlane(worldGroup,140,140,0x2f965a,0,-.01,0);
    for(let i=-12;i<13;i++)addPlane(worldGroup,5.7,140,i%2?0x2b8d52:0x349d5f,i*5.7,.006,0);
  }else if(w.theme==='clan'){
    // Nearby Town Hall villages provide their own grass patches; villages are scattered in two dimensions.
  }else{
    addPlane(worldGroup,180,180,w.ground,0,-.01,0);
  }
  if(w.theme==='classic'){
    const grid=new THREE.GridHelper(180,90,0x557448,0x658052);grid.position.y=.01;grid.material.opacity=.12;grid.material.transparent=true;worldGroup.add(grid);
  }
}
function clanMaterial(c,transparent=false,opacity=1){return new THREE.MeshToonMaterial({color:c,transparent,opacity})}
function clanMesh(group,geo,mat,x,y,z,rx=0,ry=0,rz=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=state.settings.quality;m.receiveShadow=state.settings.quality;group.add(m);return m}
function clanBox(group,x,y,z,w,h,d,c){return clanMesh(group,new THREE.BoxGeometry(w,h,d),clanMaterial(c),x,y,z)}
function clanCylinder(group,x,y,z,rt,rb,h,c,segments=10,rx=0,ry=0,rz=0){return clanMesh(group,new THREE.CylinderGeometry(rt,rb,h,segments),clanMaterial(c),x,y,z,rx,ry,rz)}
function clanRoof(group,x,y,z,r,h,c){return clanMesh(group,new THREE.ConeGeometry(r,h,4),clanMaterial(c),x,y,z,0,Math.PI/4,0)}
function renderClanWall(b){
  const horizontal=b.w>=b.d;const length=horizontal?b.w:b.d;const n=Math.max(1,Math.round(length/2));
  for(let i=0;i<n;i++){
    const offset=-length/2+1+i*2;const x=b.x+(horizontal?offset:0),z=b.z+(horizontal?0:offset);
    clanBox(worldGroup,x,.82,z,1.72,1.45,1.72,0xc49a58);
    clanBox(worldGroup,x,1.58,z,1.45,.36,1.45,0xe1bd73);
    // dark mortar seam gives the walls their chunky toy-like segmentation
    if(i<n-1)clanBox(worldGroup,x+(horizontal?.94:0),.78,z+(horizontal?0:.94),horizontal?.12:1.42,1.18,horizontal?1.42:.12,0x8f7048);
  }
}
function addStyledWorldBox(w,b){
  if(w.theme==='clan'){
    // All Clash progression boxes are collision-only. Nearby TH villages are rendered
    // separately by updateClanProgressionRender(), so we never draw all 17 bases at once.
    return null;
  }
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
function makeTextPanel(text,bg='#d4a31f',fg='#2f281e'){
  const c=document.createElement('canvas');c.width=256;c.height=96;const x=c.getContext('2d');x.fillStyle=bg;x.fillRect(0,0,c.width,c.height);x.fillStyle=fg;x.font='bold 42px Arial';x.textAlign='center';x.textBaseline='middle';x.fillText(text,128,48);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:t});
}
function createWalleCleaner(){
  const g=new THREE.Group();
  const yellow=new THREE.MeshStandardMaterial({color:0xc99b26,roughness:.78,metalness:.18});
  const dark=new THREE.MeshStandardMaterial({color:0x272727,roughness:.88,metalness:.08});
  const metal=new THREE.MeshStandardMaterial({color:0x8b8d86,roughness:.63,metalness:.48});
  const rust=new THREE.MeshStandardMaterial({color:0x6f4a2b,roughness:.92});
  const body=clanMesh(g,new THREE.BoxGeometry(2.6,2.25,2.0),yellow,0,1.75,0);body.castShadow=true;
  // front identity panel drawn procedurally; no external copyrighted asset file is bundled
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(1.75,.63),makeTextPanel('WALL·E','#b88b1f','#241d16'));panel.position.set(0,1.72,-1.012);g.add(panel);
  const robotName=makeLabel('Robotje van Bomhof');robotName.position.set(0,5.25,0);robotName.scale.set(4.6,1.15,1);g.add(robotName);
  // tracked drive units
  const treadGeo=new THREE.BoxGeometry(.7,1.25,2.45);
  for(const s of [-1,1]){
    const tread=new THREE.Mesh(treadGeo,dark);tread.position.set(s*1.58,1.0,0);tread.rotation.z=s*.08;g.add(tread);
    for(let i=-2;i<=2;i++){const groove=new THREE.Mesh(new THREE.BoxGeometry(.75,.09,.34),metal);groove.position.set(s*1.59,1.0,-i*.48);groove.rotation.z=s*.08;g.add(groove)}
    const wheel1=clanCylinder(g,s*1.61,1.0,-.65,.34,.34,.74,0x645c4d,12,0,0,Math.PI/2);
    const wheel2=clanCylinder(g,s*1.61,1.0,.65,.34,.34,.74,0x645c4d,12,0,0,Math.PI/2);
  }
  // articulated neck and binocular eyes
  clanBox(g,0,3.08,0,.38,1.1,.42,0x9b6b33);
  const head=new THREE.Group();head.position.set(0,3.72,-.12);g.add(head);g.userData.head=head;
  for(const s of [-1,1]){
    const eyeShell=new THREE.Mesh(new THREE.CylinderGeometry(.45,.49,.82,16),metal);eyeShell.rotation.x=Math.PI/2;eyeShell.position.set(s*.48,0,0);head.add(eyeShell);
    const lens=new THREE.Mesh(new THREE.CircleGeometry(.27,18),new THREE.MeshPhongMaterial({color:0x151317,emissive:0x16121b,shininess:90}));lens.position.set(s*.48,0,-.421);head.add(lens);
    const glint=new THREE.Mesh(new THREE.CircleGeometry(.07,12),new THREE.MeshBasicMaterial({color:0xb9d2f3}));glint.position.set(s*.41,.09,-.428);head.add(glint);
  }
  // arm + permanent vacuum nozzle
  clanCylinder(g,-1.58,2.15,-.15,.18,.22,1.15,0x8c693d,10,0,0,-.65);
  clanBox(g,-2.05,1.72,-.38,.55,.34,.55,0x8b8d86);
  const hoseMat=new THREE.LineBasicMaterial({color:0x252525});const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(-1.4,2.0,-.2),new THREE.Vector3(-2.0,1.2,-.7),new THREE.Vector3(-1.65,.42,-1.45)]);const hose=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)),hoseMat);g.add(hose);
  const nozzle=clanBox(g,-1.65,.22,-1.62,1.15,.26,.72,0x363636);g.userData.nozzle=nozzle;
  // animated vacuum debris particles
  const particles=[];for(let i=0;i<10;i++){const q=clanBox(g,0,0,0,.10+.05*Math.random(),.10+.05*Math.random(),.10+.05*Math.random(),i%3===0?0xc9aa68:0x626262);q.userData.phase=Math.random();particles.push(q)}g.userData.vacuumParticles=particles;
  g.scale.setScalar(.82);g.position.set(-10,0,16);decorGroup.add(g);
  cleanerBots.push({group:g,path:[[-10,16],[12,16],[20,3],[8,-16],[-14,-18],[-23,-3]],index:1,speed:2.2,head});
  return g;
}
function updateCleanerBots(dt){
  if(state.world!=='classic')return;
  const now=performance.now()*.001;
  for(const bot of cleanerBots){
    const g=bot.group,target=bot.path[bot.index];const dx=target[0]-g.position.x,dz=target[1]-g.position.z,dist=Math.hypot(dx,dz);
    if(dist<1){bot.index=(bot.index+1)%bot.path.length;continue}
    const step=Math.min(dist,bot.speed*dt);g.position.x+=dx/dist*step;g.position.z+=dz/dist*step;g.rotation.y=Math.atan2(-dx,-dz);
    bot.head.rotation.z=Math.sin(now*1.8)*.08;bot.head.rotation.y=Math.sin(now*.9)*.18;
    for(let i=0;i<g.userData.vacuumParticles.length;i++){
      const q=g.userData.vacuumParticles[i];let ph=(q.userData.phase+dt*.55)%1;q.userData.phase=ph;
      const angle=i*2.3;const radius=1.3*(1-ph)+.08;q.position.set(-1.65+Math.sin(angle)*radius,.16+.14*Math.sin(ph*Math.PI),-1.62-Math.cos(angle)*radius-.35*(1-ph));q.scale.setScalar(Math.max(.18,1-ph));
    }
  }
}
function decorClassic(){
  if(state.settings.quality)for(let i=0;i<34;i++){const a=i/34*Math.PI*2,r=52+Math.random()*25,h=5+Math.random()*18;addBox(decorGroup,{x:Math.cos(a)*r,y:h/2-1,z:Math.sin(a)*r,w:5+Math.random()*8,h,d:5+Math.random()*8,c:'#95a7b3'})}
  createWalleCleaner();
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
function clanTownHall(group,x,z,scale=1){
  clanBox(group,x,1.25*scale,z,9*scale,2.5*scale,8*scale,0xa85a35);
  clanBox(group,x,2.7*scale,z,7.8*scale,.65*scale,6.8*scale,0xd57a3c);
  clanRoof(group,x,4.65*scale,z,5.5*scale,3.1*scale,0xe48335);
  clanRoof(group,x,6.15*scale,z,3.6*scale,2.4*scale,0xf0a148);
  clanBox(group,x,2.0*scale,z-4.04*scale,2.15*scale,2.7*scale,.18*scale,0x584130);
  clanBox(group,x,3.18*scale,z-4.14*scale,2.9*scale,.26*scale,.12*scale,0xf2cf79);
  // chimney and tiny flag
  clanBox(group,x+2.8*scale,5.8*scale,z+1.5*scale,.65*scale,2.5*scale,.65*scale,0x6c4a38);
  clanBox(group,x-2.7*scale,7.0*scale,z,.12*scale,2.2*scale,.12*scale,0x5b4637);
  const flag=clanMesh(group,new THREE.PlaneGeometry(1.5*scale,.8*scale),clanMaterial(0xe64844),x-1.95*scale,7.45*scale,z,0,Math.PI/2,0);flag.castShadow=false;
}
function clanGoldStorage(group,x,z){
  clanCylinder(group,x,.85,z,2.4,2.65,1.5,0x6e7477,10);clanCylinder(group,x,1.55,z,2.15,2.35,.55,0xc68c2d,10);
  for(let i=0;i<15;i++){const a=i*2.399,r=.35+(i%4)*.32;clanCylinder(group,x+Math.cos(a)*r,2.0+(i%3)*.13,z+Math.sin(a)*r,.24,.28,.18,0xf4c52f,10,Math.PI/2,0,0)}
  addIconBillboard(group,x,5.2,z,0xffd13a);
}
function clanElixirStorage(group,x,z){
  clanCylinder(group,x,.55,z,2.55,2.75,1.0,0x6c6e72,12);
  const orb=clanMesh(group,new THREE.SphereGeometry(2.05,20,14),new THREE.MeshPhongMaterial({color:0xd84ce5,transparent:true,opacity:.88,shininess:100}),x,2.25,z);orb.castShadow=false;
  for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){clanBox(group,x+Math.cos(a)*2.05,2.45,z+Math.sin(a)*2.05,.22,3.4,.22,0xa48c6e)}
  clanCylinder(group,x,4.0,z,2.25,2.25,.35,0xc4a878,12);addIconBillboard(group,x,5.7,z,0xdc53e8);
}
function clanArcherTower(group,x,z){
  for(const [dx,dz] of [[-1,-1],[1,-1],[-1,1],[1,1]])clanCylinder(group,x+dx*1.25,2.5,z+dz*1.25,.18,.27,5.0,0x735138,7);
  clanBox(group,x,5.0,z,4.2,.55,4.2,0x9b7048);clanCylinder(group,x,5.95,z,1.65,1.95,1.5,0x8c6745,8);
  // small archer silhouette with pink hair and bow, reinforcing the unmistakable tower identity
  clanCylinder(group,x,7.0,z,.28,.30,.75,0xd98bb4,10);clanBox(group,x,6.52,z,.55,.75,.38,0x4f9961);
  const bow=clanMesh(group,new THREE.TorusGeometry(.55,.055,6,18,Math.PI),clanMaterial(0x704629),x+.48,6.55,z-.15,0,Math.PI/2,.35);bow.castShadow=false;
}
function clanCannon(group,x,z,rot=0){
  clanCylinder(group,x,.58,z,1.75,2.1,1.0,0x806245,10);for(const s of [-1,1])clanCylinder(group,x+Math.cos(rot+Math.PI/2)*s*1.25,.9,z+Math.sin(rot+Math.PI/2)*s*1.25,.62,.62,.40,0x463c34,12,Math.PI/2,rot,0);
  const barrel=clanCylinder(group,x,1.55,z,.42,.65,3.2,0x333538,12,Math.PI/2,0,rot+Math.PI/2);barrel.position.x+=Math.sin(rot)*.7;barrel.position.z+=Math.cos(rot)*.7;
}
function clanMortar(group,x,z){
  clanCylinder(group,x,.45,z,2.0,2.35,.75,0x736553,10);clanCylinder(group,x,1.45,z,.72,.95,2.7,0x343638,12,-.55,0,.18);clanCylinder(group,x+.2,.95,z-.55,.85,.85,.38,0xa37a43,10,Math.PI/2,0,0);
}
function clanWizardTower(group,x,z){
  clanCylinder(group,x,1.6,z,1.9,2.4,3.2,0x6c6267,10);clanCylinder(group,x,3.45,z,1.8,1.95,.75,0x765188,10);
  const crystal=clanMesh(group,new THREE.OctahedronGeometry(.85,0),new THREE.MeshPhongMaterial({color:0xc44bff,emissive:0x5f1488,emissiveIntensity:.8,shininess:90}),x,4.55,z);crystal.castShadow=false;
}
function clanBarracks(group,x,z,rot=0){
  clanBox(group,x,1.45,z,6.2,2.9,5.4,0x9c6745);const roof=clanRoof(group,x,3.9,z,4.5,2.4,0xb94438);roof.rotation.y=Math.PI/4+rot;
  clanBox(group,x,1.45,z-2.75,1.6,2.0,.12,0x3e3028);
  for(const s of [-1,1]){const spear=clanCylinder(group,x+s*.65,4.7,z,.06,.06,2.2,0xd9c28d,6,0,0,s*.55);spear.castShadow=false}
}
function clanCastle(group,x,z){
  clanBox(group,x,1.8,z,6.2,3.6,6.2,0x777f87);clanBox(group,x,3.7,z,5.5,.65,5.5,0xb7bdc0);
  for(const dx of [-2.25,0,2.25])for(const dz of [-2.25,2.25])clanBox(group,x+dx,4.35,z+dz,.75,.85,.75,0xd2d3cd);
  clanRoof(group,x,5.15,z,3.1,2.0,0xb23e37);clanBox(group,x,2.0,z-3.15,1.8,2.6,.15,0x31363b);
}
function clanCollector(group,x,z,purple=false){
  clanCylinder(group,x,.55,z,2.1,2.45,1.0,0x6e6458,10);clanBox(group,x,1.5,z,3.0,1.1,3.0,purple?0x9b4eb0:0xb6823c);
  for(const s of [-1,1])clanCylinder(group,x+s*1.55,2.05,z,.22,.28,2.3,purple?0xc45adc:0xd3a741,9,0,0,s*.35);
  const cap=clanCylinder(group,x,2.55,z,1.25,1.55,.55,purple?0xdb58e7:0xf0be3a,10);cap.castShadow=false;
}
function clanCamp(group,x,z){
  const dirt=clanMesh(group,new THREE.CircleGeometry(3.4,20),clanMaterial(0xb58c5c),x,.025,z,-Math.PI/2,0,0);dirt.receiveShadow=true;
  for(const [dx,dz,c] of [[-1.7,-.8,0xf0d2aa],[1.5,.7,0xc99155]]){const tent=clanRoof(group,x+dx,1.55,z+dz,1.75,2.3,c);tent.scale.z=.75}
  const fire=clanMesh(group,new THREE.ConeGeometry(.35,.75,8),new THREE.MeshBasicMaterial({color:0xff8130}),x,.7,z-.4);fire.castShadow=false;
  for(let i=0;i<5;i++){const a=i/5*Math.PI*2;clanBox(group,x+Math.cos(a)*.7,.15,z-.4+Math.sin(a)*.7,.35,.28,.35,0x6c5e4c)}
}
function clanBush(group,x,z,s=1){const base=clanMesh(group,new THREE.DodecahedronGeometry(1.1*s,0),clanMaterial(0x4d9e49),x,.8*s,z);base.scale.y=.8;for(const dx of [-.55,.55]){const q=clanMesh(group,new THREE.DodecahedronGeometry(.72*s,0),clanMaterial(0x5bab4f),x+dx*s,1.0*s,z+.15*s);q.scale.y=.9}}
function clanTree(group,x,z,s=1){clanCylinder(group,x,1.45*s,z,.35*s,.48*s,2.9*s,0x7a5132,7);const a=clanMesh(group,new THREE.DodecahedronGeometry(1.75*s,0),clanMaterial(0x4e9f48),x,3.45*s,z);a.scale.y=.82;const b=clanMesh(group,new THREE.DodecahedronGeometry(1.25*s,0),clanMaterial(0x65b75b),x+.7*s,3.65*s,z-.25*s);b.scale.y=.85}
function decorClan(){
  // The visible progression is streamed around the player; keep the permanent decor group empty.
}

const CLAN_TH_THEMES=[
  null,
  {body:0x8d5b36,roof:0xe79535,trim:0x5f412d,wall:0x6b4b32,accent:0xf2c56f,dark:0x3d3028},
  {body:0x9d8b72,roof:0xe78f31,trim:0x6d5f50,wall:0x7f766b,accent:0xe8c071,dark:0x4b433c},
  {body:0x9e8d75,roof:0xe58c2f,trim:0x6f5f4d,wall:0x8e8a82,accent:0xf0c36d,dark:0x4a4239},
  {body:0x99836b,roof:0xdc8429,trim:0x55504c,wall:0x55585d,accent:0xe2b75f,dark:0x37393d},
  {body:0x89796b,roof:0xd98628,trim:0xc49a49,wall:0xc99a35,accent:0xf5d66f,dark:0x4d4237},
  {body:0x786b59,roof:0xd98628,trim:0xcba443,wall:0xc44ad1,accent:0xf4cf5e,dark:0x433a34},
  {body:0x55504d,roof:0xb66b28,trim:0xc79c37,wall:0x6d347b,accent:0xd7b857,dark:0x292727},
  {body:0x4d4b4c,roof:0xa45f26,trim:0xc59d45,wall:0x292b30,accent:0xf1bf55,dark:0x1b1d20},
  {body:0x44474c,roof:0x5a4b40,trim:0xd0a044,wall:0x333136,accent:0xf0b04a,dark:0x18191b},
  {body:0x29282a,roof:0x3a2520,trim:0xe06b2d,wall:0x332426,accent:0xff7b2f,dark:0x111113,glow:0xff4b16},
  {body:0xe4ded1,roof:0xc6b69a,trim:0xd6a23b,wall:0x4b3d39,accent:0xf18a39,dark:0x272421,glow:0xff6d2a},
  {body:0x263e62,roof:0x1970a9,trim:0xe0b34a,wall:0x2b5385,accent:0x5ad9ff,dark:0x121c2c,glow:0x44dfff},
  {body:0x274c51,roof:0x1b8a91,trim:0x6e4d87,wall:0x5ba8b4,accent:0xa6eff5,dark:0x1d2730,glow:0x72e4ff},
  {body:0x545048,roof:0x25805e,trim:0xd8b249,wall:0x3d8067,accent:0x75da7c,dark:0x282d28,glow:0x66ff82},
  {body:0x40364f,roof:0x5e2b81,trim:0x2fb7a9,wall:0x61429a,accent:0xf082ff,dark:0x211a2b,glow:0xb64cff},
  {body:0xd6d0c3,roof:0x9c3f35,trim:0xe1b54b,wall:0xa6423b,accent:0xf0d16e,dark:0x39312d,glow:0xffbf43},
  {body:0x172639,roof:0x20364e,trim:0xd7a83d,wall:0x26374e,accent:0xf2ba47,dark:0x0c121b,glow:0xff8b28},
];
function clanTheme(th){return CLAN_TH_THEMES[clamp(th,1,17)]}
function clanGlowMaterial(c,intensity=.8){return new THREE.MeshPhongMaterial({color:c,emissive:c,emissiveIntensity:intensity,shininess:75})}
function clanTownHallLevel(group,x,z,th){
  const t=clanTheme(th),s=.72+Math.min(th,12)*.025;
  clanBox(group,x,1.3*s,z,8.6*s,2.6*s,7.8*s,t.body);
  clanBox(group,x,2.65*s,z,7.5*s,.55*s,6.8*s,t.trim);
  if(th<=2){clanRoof(group,x,4.1*s,z,5.6*s,2.5*s,t.roof)}
  else{
    clanRoof(group,x,4.25*s,z,5.45*s,2.25*s,t.roof);
    clanBox(group,x,4.45*s,z,4.9*s,.65*s,4.6*s,t.body);
    clanRoof(group,x,5.75*s,z,3.55*s,1.9*s,t.roof);
  }
  // entrance and trim
  clanBox(group,x,1.7*s,z-3.96*s,2.0*s,2.45*s,.18*s,t.dark);
  clanBox(group,x,3.0*s,z-4.08*s,2.8*s,.24*s,.14*s,t.accent);
  if(th>=6){for(const sx of [-1,1])clanCylinder(group,x+sx*3.15*s,2.0*s,z,.20*s,.26*s,3.6*s,t.accent,8)}
  if(th>=7&&th<=9){
    // medieval rooftop battlements
    clanBox(group,x,6.15*s,z,4.4*s,.45*s,4.4*s,t.dark);
    for(const dx of [-1.75,0,1.75])for(const dz of [-1.75,1.75])clanBox(group,x+dx*s,6.55*s,z+dz*s,.55*s,.8*s,.55*s,t.trim);
  }
  if(th===10||th===11){
    const lava=new THREE.Mesh(new THREE.RingGeometry(4.4*s,5.0*s,36),clanGlowMaterial(t.glow,.7));lava.rotation.x=-Math.PI/2;lava.position.set(x,.07,z);group.add(lava);
    const core=clanMesh(group,new THREE.CylinderGeometry(.85*s,.95*s,.55*s,14),clanGlowMaterial(t.glow,1.1),x,6.65*s,z);core.castShadow=false;
  }
  if(th===12){
    const coil=clanMesh(group,new THREE.TorusGeometry(1.05*s,.16*s,8,22),clanGlowMaterial(t.glow,1.0),x,6.55*s,z,Math.PI/2,0,0);coil.castShadow=false;
    for(const sx of [-1,1])clanCylinder(group,x+sx*2.2*s,4.7*s,z,.10*s,.10*s,2.4*s,t.accent,8);
  }
  if(th===13){
    const ice=clanMesh(group,new THREE.OctahedronGeometry(1.2*s,0),clanGlowMaterial(t.glow,.65),x,6.55*s,z);ice.scale.y=.7;ice.castShadow=false;
  }
  if(th===14){
    const pool=clanMesh(group,new THREE.CylinderGeometry(2.2*s,2.2*s,.18*s,24),new THREE.MeshPhongMaterial({color:0x56c978,transparent:true,opacity:.85,shininess:90}),x,6.35*s,z);pool.castShadow=false;
    for(const sx of [-1,1])clanBush(group,x+sx*3.0*s,z+1.5*s,.55*s);
  }
  if(th===15){
    for(const sx of [-1,1]){const crystal=clanMesh(group,new THREE.OctahedronGeometry(.72*s,0),clanGlowMaterial(t.glow,.9),x+sx*2.7*s,5.45*s,z);crystal.castShadow=false}
  }
  if(th===16){
    const orb=clanMesh(group,new THREE.IcosahedronGeometry(1.15*s,1),new THREE.MeshStandardMaterial({color:0xb9b0a2,roughness:.75,metalness:.1}),x,6.65*s,z);orb.castShadow=true;
    clanMesh(group,new THREE.TorusGeometry(1.38*s,.18*s,8,24),clanMaterial(t.accent),x,6.62*s,z,Math.PI/2,0,0);
  }
  if(th===17){
    // dark justice / inferno-artillery crown
    clanCylinder(group,x,6.4*s,z,1.25*s,1.55*s,.75*s,t.dark,10);
    for(let i=0;i<4;i++){const a=i*Math.PI/2;const barrel=clanCylinder(group,x+Math.sin(a)*.6*s,7.1*s,z+Math.cos(a)*.6*s,.16*s,.26*s,1.7*s,t.accent,9,-.8,0,a);barrel.castShadow=false}
    const core=clanMesh(group,new THREE.SphereGeometry(.48*s,12,9),clanGlowMaterial(t.glow,1.15),x,7.25*s,z);core.castShadow=false;
  }
  const label=makeLabel(`Town Hall ${th}`);label.position.set(x,8.4*s,z+5.6*s);label.scale.set(3.7,.92,1);group.add(label);
}
function clanWallPieceLevel(group,x,z,th){
  if(th<2)return;const t=clanTheme(th);let base;
  if(th===2){base=clanMesh(group,new THREE.DodecahedronGeometry(.82,0),clanMaterial(0x87827a),x,.72,z);base.scale.set(1.05,.9,1.05)}
  else if(th===3){clanBox(group,x,.78,z,1.65,1.42,1.65,0x99958d)}
  else if(th===4){clanBox(group,x,.9,z,1.62,1.72,1.62,0x44484e)}
  else if(th===5){clanBox(group,x,.9,z,1.62,1.72,1.62,0xc99c36);clanBox(group,x,1.78,z,1.3,.22,1.3,0xf0cf6b)}
  else if(th===6||th===7){const q=clanMesh(group,new THREE.OctahedronGeometry(.95,0),clanMaterial(th===6?0xc34fca:0x6d347b),x,1.0,z);q.scale.y=1.35}
  else if(th===8){clanBox(group,x,.95,z,1.75,1.8,1.75,0x22252a);const skull=clanMesh(group,new THREE.SphereGeometry(.30,10,8),clanMaterial(0xd0c8b6),x,1.85,z);skull.scale.y=.8}
  else if(th<=11){clanBox(group,x,.95,z,1.72,1.8,1.72,t.wall);const strip=clanBox(group,x,1.82,z,1.22,.18,1.22,t.glow||0xff6b2d);strip.material=clanGlowMaterial(t.glow||0xff6b2d,.75)}
  else{clanBox(group,x,.95,z,1.72,1.8,1.72,t.wall);clanBox(group,x,1.86,z,1.32,.22,1.32,t.accent);if(th>=15){const spike=clanMesh(group,new THREE.ConeGeometry(.38,.9,4),clanGlowMaterial(t.glow||t.accent,.35),x,2.35,z);spike.rotation.y=Math.PI/4}}
}
function clanWallRingLevel(group,cx,cz,th){
  if(th<2)return;const half=Math.min(14+th*.45,21),step=2.05,gate=5.4;
  for(let o=-half;o<=half+.01;o+=step){
    if(Math.abs(o)>gate){clanWallPieceLevel(group,cx+o,cz-half,th);clanWallPieceLevel(group,cx+o,cz+half,th)}
    clanWallPieceLevel(group,cx-half,cz+o,th);clanWallPieceLevel(group,cx+half,cz+o,th);
  }
}
function clanDefenseModel(group,type,x,z,th){
  const t=clanTheme(th),metal=t.dark,accent=t.accent,glow=t.glow||accent;
  if(type==='cannon'){clanCylinder(group,x,.55,z,1.35,1.65,.9,t.trim,9);clanCylinder(group,x,1.45,z,.32,.50,2.7,metal,10,Math.PI/2,0,.18)}
  else if(type==='archer'||type==='multiarcher'){for(const sx of [-1,1])for(const sz of [-1,1])clanCylinder(group,x+sx*.9,2.2,z+sz*.9,.12,.18,4.3,t.trim,6);clanBox(group,x,4.35,z,3.2,.45,3.2,t.wall);const n=type==='multiarcher'?3:1;for(let i=0;i<n;i++){const bow=clanMesh(group,new THREE.TorusGeometry(.42,.05,5,16,Math.PI),clanMaterial(accent),x+(i-(n-1)/2)*.55,5.25,z-.15,0,Math.PI/2,.2);bow.castShadow=false}}
  else if(type==='mortar'){clanCylinder(group,x,.45,z,1.6,1.9,.75,t.trim,10);clanCylinder(group,x,1.35,z,.58,.82,2.35,metal,12,-.55,0,.12)}
  else if(type==='air'){clanCylinder(group,x,.45,z,1.3,1.55,.7,t.trim,10);for(let i=0;i<4;i++){const a=i*Math.PI/2;clanMesh(group,new THREE.ConeGeometry(.25,1.6,6),clanMaterial(accent),x+Math.cos(a)*.55,1.65,z+Math.sin(a)*.55,0,0,-.1)}}
  else if(type==='wizard'||type==='spell'){clanCylinder(group,x,1.55,z,1.45,1.9,3.1,t.wall,9);const orb=clanMesh(group,new THREE.OctahedronGeometry(type==='spell'?.9:.7,0),clanGlowMaterial(glow,.9),x,3.9,z);orb.castShadow=false}
  else if(type==='sweeper'){clanCylinder(group,x,.55,z,1.25,1.45,.85,t.trim,9);const fan=clanMesh(group,new THREE.CylinderGeometry(.65,.65,.35,12),clanMaterial(metal),x,1.65,z-.35,Math.PI/2,0,0);for(let i=0;i<4;i++){const blade=clanBox(group,x,1.65,z-.58,1.45,.18,.15,accent);blade.rotation.z=i*Math.PI/2}}
  else if(type==='tesla'){clanBox(group,x,.55,z,2.0,.8,2.0,t.trim);clanCylinder(group,x,2.0,z,.10,.14,2.8,metal,8);for(let i=0;i<3;i++){const ring=clanMesh(group,new THREE.TorusGeometry(.62-i*.10,.08,7,18),clanGlowMaterial(glow,.65),x,2.3+i*.45,z,Math.PI/2,0,0);ring.castShadow=false}}
  else if(type==='bomb'){clanCylinder(group,x,.8,z,1.45,1.75,1.5,t.trim,10);const bomb=clanMesh(group,new THREE.SphereGeometry(.78,12,9),clanMaterial(metal),x,2.25,z);clanCylinder(group,x+.35,3.0,z,.08,.10,.9,accent,6,0,0,.45)}
  else if(type==='xbow'){clanCylinder(group,x,.5,z,1.45,1.65,.8,t.trim,10);clanBox(group,x,1.65,z,.35,.35,2.8,metal);for(const sx of [-1,1]){const arm=clanBox(group,x+sx*.75,2.0,z,1.3,.16,.18,accent);arm.rotation.z=sx*.38}}
  else if(type==='inferno'){clanCylinder(group,x,1.35,z,1.25,1.55,2.7,metal,10);const flame=clanMesh(group,new THREE.ConeGeometry(.62,1.5,8),clanGlowMaterial(glow,1.2),x,3.45,z);flame.castShadow=false}
  else if(type==='eagle'){clanBox(group,x,.65,z,3.3,1.1,3.3,t.trim);clanCylinder(group,x,1.65,z,.35,.55,1.9,metal,8);for(const sx of [-1,1]){const wing=clanBox(group,x+sx*1.05,2.55,z,1.9,.20,.8,accent);wing.rotation.z=sx*.35}clanMesh(group,new THREE.ConeGeometry(.32,1.1,5),clanMaterial(accent),x,2.7,z-1.0,Math.PI/2,0,0)}
  else if(type==='giga'){clanCylinder(group,x,.7,z,1.5,1.75,1.1,t.trim,10);const coil=clanMesh(group,new THREE.TorusGeometry(.8,.13,7,20),clanGlowMaterial(glow,1),x,2.1,z,Math.PI/2,0,0);coil.castShadow=false}
  else if(type==='scatter'){clanCylinder(group,x,.6,z,1.55,1.8,1.0,t.trim,10);for(const sx of [-1,1]){const barrel=clanCylinder(group,x+sx*.45,2.1,z,.28,.42,2.25,metal,9,Math.PI/2,0,.15);barrel.rotation.z=sx*.08}}
  else if(type==='builder'){clanBox(group,x,1.0,z,3.2,2.0,3.0,t.body);clanRoof(group,x,2.65,z,2.35,1.55,t.roof);const hammer=clanBox(group,x+1.2,3.3,z,.25,2.1,.25,accent);hammer.rotation.z=.55}
  else if(type==='monolith'){clanMesh(group,new THREE.CylinderGeometry(.8,1.45,4.7,4),clanGlowMaterial(glow,.55),x,2.35,z,0,Math.PI/4,0);clanMesh(group,new THREE.OctahedronGeometry(.62,0),clanGlowMaterial(glow,1.0),x,5.0,z)}
  else if(type==='ricochet'){clanCylinder(group,x,.6,z,1.6,1.9,1.0,t.trim,10);for(const sx of [-1,1])clanCylinder(group,x+sx*.42,1.85,z,.28,.48,2.5,metal,10,Math.PI/2,0,.1)}
  else if(type==='firespitter'){clanCylinder(group,x,.65,z,1.65,1.95,1.1,t.trim,10);for(const sx of [-1,1]){const mouth=clanMesh(group,new THREE.ConeGeometry(.48,2.2,8),clanGlowMaterial(glow,.65),x+sx*.5,2.0,z-.25,-1.05,0,0);mouth.castShadow=false}}
  else if(type==='multigear'){clanCylinder(group,x,.7,z,1.65,1.9,1.1,t.trim,10);clanBox(group,x,2.15,z,2.4,.45,2.4,accent);clanCylinder(group,x,3.0,z,.26,.42,2.2,metal,10,Math.PI/2,0,.2);for(const sx of [-1,1])clanMesh(group,new THREE.TorusGeometry(.38,.06,5,16,Math.PI),clanMaterial(accent),x+sx*.75,3.15,z-.2,0,Math.PI/2,.2)}
}
function clanDefenseSet(th){
  if(th===1)return ['cannon'];if(th===2)return ['cannon','archer'];if(th===3)return ['cannon','archer','mortar'];if(th===4)return ['cannon','archer','mortar','air'];
  if(th===5)return ['archer','mortar','air','wizard'];if(th===6)return ['mortar','air','wizard','sweeper'];if(th===7)return ['wizard','sweeper','tesla','archer'];if(th===8)return ['tesla','bomb','wizard','mortar'];
  if(th===9)return ['xbow','tesla','wizard','mortar'];if(th===10)return ['inferno','xbow','bomb','wizard'];if(th===11)return ['eagle','inferno','xbow','wizard'];if(th===12)return ['giga','inferno','xbow','tesla'];
  if(th===13)return ['scatter','inferno','xbow','wizard'];if(th===14)return ['builder','scatter','inferno','eagle'];if(th===15)return ['monolith','spell','scatter','inferno'];if(th===16)return ['multiarcher','ricochet','monolith','scatter'];
  return ['firespitter','multigear','multiarcher','ricochet'];
}
function renderClanVillage(group,th,cx,cz){
  const patch=new THREE.Mesh(new THREE.PlaneGeometry(82,82),new THREE.MeshToonMaterial({map:clanGrassTexture(),color:0xffffff}));
  patch.rotation.x=-Math.PI/2;patch.position.set(cx,-.025,cz);patch.receiveShadow=state.settings.quality;group.add(patch);
  // Local village paths only: no straight road linking all Town Halls.
  const pathMat=new THREE.MeshToonMaterial({color:0xd8c59d,side:THREE.DoubleSide});
  for(const [px,pz,w,h] of [[0,18,8,30],[0,-18,8,30],[18,0,30,8],[-18,0,30,8]]){
    const path=new THREE.Mesh(new THREE.PlaneGeometry(w,h),pathMat);path.rotation.x=-Math.PI/2;path.position.set(cx+px,.005,cz+pz);group.add(path);
  }
  clanWallRingLevel(group,cx,cz,th);clanTownHallLevel(group,cx,cz,th);
  const types=clanDefenseSet(th),pos=[[-13,-9],[13,9],[-13,9],[13,-9],[0,-15],[0,15]];
  types.forEach((type,i)=>clanDefenseModel(group,type,cx+pos[i][0],cz+pos[i][1],th));
  if(th>=5){clanGoldStorage(group,cx-8,cz+10);clanElixirStorage(group,cx+8,cz+10)}
  if(th>=8)clanCamp(group,cx-23,cz+6);
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2,rr=30+((i*7+th*3)%8);clanTree(group,cx+Math.cos(a)*rr,cz+Math.sin(a)*rr,.65+((i+th)%4)*.08)}
  const sign=makeLabel(`TH ${th}  •  ${th<9?'Early Village':th<12?'Medieval / Fire Era':th===12?'Electric Era':th===13?'Ice Era':th===14?'Jungle Era':th===15?'Magic Era':th===16?'Nature Era':'Justice Era'}`);
  sign.position.set(cx,3.1,cz+28);sign.scale.set(5.2,1.05,1);group.add(sign);
}
function clanVillageLayout(){
  const layout=state.config?.worlds?.clan?.town_hall_layout||[];
  return layout.map(v=>({th:Number(v.th),x:Number(v.x),z:Number(v.z)}));
}
function updateClanProgressionRender(force=false){
  if(state.world!=='clan')return;
  const anchor=state.playing?state.pos:camera.position;
  const layout=clanVillageLayout();if(!layout.length)return;
  const ranked=[...layout].sort((a,b)=>{
    const da=(anchor.x-a.x)**2+(anchor.z-a.z)**2;
    const db=(anchor.x-b.x)**2+(anchor.z-b.z)**2;
    return da-db;
  });
  const visible=ranked.slice(0,4);
  const key=visible.map(v=>v.th).join(',');if(!force&&key===state.clanRenderKey)return;
  state.clanRenderKey=key;clearGroup(streamGroup);
  for(const v of visible)renderClanVillage(streamGroup,v.th,v.x,v.z);
}

function seeded01(a,b,c=0){const v=Math.sin(a*127.1+b*311.7+c*74.7)*43758.5453;return v-Math.floor(v)}
function addIconBillboard(group,x,y,z,fill){const wrap=new THREE.Group();const bubble=new THREE.Mesh(new THREE.PlaneGeometry(2.4,2.4),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));bubble.position.y=.2;wrap.add(bubble);const icon=new THREE.Mesh(new THREE.CircleGeometry(.55,18),new THREE.MeshBasicMaterial({color:fill,side:THREE.DoubleSide}));icon.position.set(0,.2,.01);wrap.add(icon);wrap.position.set(x,y,z);wrap.userData.billboard=true;wrap.lookAt(camera.position);group.add(wrap);return wrap}
function addStreamChunk(theme,cx,cz,span){
  const x0=cx*span+span/2,z0=cz*span+span/2,g=new THREE.Group();
  const patchMat=theme==='clan'?new THREE.MeshToonMaterial({map:clanGrassTexture(),color:0xffffff}):new THREE.MeshLambertMaterial({color:theme==='stadium'?0x2d9159:theme==='battle'?0x66bf62:0x6f9159});
  const patch=new THREE.Mesh(new THREE.PlaneGeometry(span,span),patchMat);patch.rotation.x=-Math.PI/2;patch.position.set(x0,-.03,z0);patch.receiveShadow=state.settings.quality;g.add(patch);
  const r=seeded01(cx,cz);
  if(theme==='classic'){
    for(let i=0;i<3;i++){const ox=(seeded01(cx,cz,i)-.5)*(span-10),oz=(seeded01(cz,cx,i)-.5)*(span-10);const b=new THREE.Mesh(new THREE.BoxGeometry(8,6+seeded01(cx,cz,i+9)*8,8),new THREE.MeshLambertMaterial({color:0x6d747c}));b.position.set(x0+ox,b.geometry.parameters.height/2-1,z0+oz);g.add(b)}
  }else if(theme==='stadium'){
    const line=new THREE.Mesh(new THREE.RingGeometry(10.5,10.8,48),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));line.rotation.x=-Math.PI/2;line.position.set(x0,.02,z0);g.add(line);for(const sx of [-1,1]){const goal=new THREE.Mesh(new THREE.BoxGeometry(4,.3,9),new THREE.MeshLambertMaterial({color:0xf5f8fc}));goal.position.set(x0+sx*(span*.34),1.5,z0);g.add(goal)}
  }else if(theme==='battle'){
    for(let i=0;i<4;i++){const ox=(seeded01(cx,cz,i)-.5)*(span-8),oz=(seeded01(cz,cx,i+4)-.5)*(span-8);const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.35,.45,2.8,6),new THREE.MeshLambertMaterial({color:0x76503a}));trunk.position.set(x0+ox,1.4,z0+oz);g.add(trunk);const crown=new THREE.Mesh(new THREE.ConeGeometry(2.2,4.5,7),new THREE.MeshLambertMaterial({color:0x34a85a,flatShading:true}));crown.position.set(x0+ox,4.4,z0+oz);g.add(crown)}
  }else if(theme==='clan'){
    // streamed chunks feel like neighbouring home-village clearings rather than repeated FPS buildings
    const ox=(seeded01(cx,cz,1)-.5)*16,oz=(seeded01(cz,cx,2)-.5)*16;
    if(r>.62)clanArcherTower(g,x0+ox,z0+oz);else if(r>.34)clanCollector(g,x0+ox,z0+oz,r>.49);else clanCamp(g,x0+ox,z0+oz);
    for(let i=0;i<5;i++){const a=seeded01(cx,cz,i+10)*Math.PI*2,rr=15+seeded01(cz,cx,i+20)*10;clanTree(g,x0+Math.cos(a)*rr,z0+Math.sin(a)*rr,.7+seeded01(cx,cz,i+30)*.35)}
  }
  streamGroup.add(g);
}
function updateStreamingWorld(force=false){if(!state.config)return;const world=state.config.worlds[state.world];if(!world||state.world==='voxel')return;if(world.theme==='clan'){updateClanProgressionRender(force);return}const span=56;const anchor=state.playing?state.pos:camera.position;const cx=Math.floor(anchor.x/span),cz=Math.floor(anchor.z/span);const key=`${state.world}:${cx}:${cz}`;if(!force&&key===state.streamChunk)return;state.streamChunk=key;clearGroup(streamGroup);for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)addStreamChunk(world.theme,cx+dx,cz+dz,span)}

function createWeapon(){
  if(!camera||!state.config)return;if(weaponGroup)camera.remove(weaponGroup);weaponGroup=new THREE.Group();camera.add(weaponGroup);scene.add(camera);
  const cfg=weaponCfg(),accent=new THREE.MeshStandardMaterial({color:color(cfg.color||'#ccc'),roughness:.62,metalness:.08}),dark=new THREE.MeshStandardMaterial({color:0x22262b,roughness:.72,metalness:.12}),skin=new THREE.MeshStandardMaterial({color:0xc88c67,roughness:.9});
  const part=(geo,mat,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);weaponGroup.add(m);return m};
  if(state.world==='voxel'&&state.mcHotbar===8){
    const swordMat=new THREE.MeshStandardMaterial({color:0x6fe4ee,roughness:.4,metalness:.16});part(new THREE.BoxGeometry(.16,.16,1.30),swordMat,.34,-.34,-1.05,-.52,0,-.35);part(new THREE.BoxGeometry(.72,.12,.16),dark,.34,-.42,-.64,-.52,0,-.35);part(new THREE.BoxGeometry(.16,.16,.50),new THREE.MeshStandardMaterial({color:0x7b4e2f}),.34,-.56,-.42,-.52,0,-.35);
  }else{
    const w=state.weapon,len=w==='Sniper Rifle'?1.55:w==='Shotgun'?1.10:w==='Machine Gun'?1.25:w==='Milan Gun'?1.02:1.02;
    part(new THREE.BoxGeometry(w==='Machine Gun'?.23:.18,.23,len),dark,.35,-.28,-.60-len/3,.03,0,0);part(new THREE.BoxGeometry(.20,.09,len*.55),accent,.35,-.19,-.62-len/2.2);part(new THREE.BoxGeometry(.12,.31,.18),dark,.35,-.43,-.52,.16,0,0);part(new THREE.BoxGeometry(.09,.09,w==='Milan Gun'?.25:.52),dark,.35,-.17,-.54-len);
    if(w==='Sniper Rifle')part(new THREE.CylinderGeometry(.09,.09,.38,14),dark,.35,-.07,-.82,Math.PI/2);
    if(w==='Machine Gun'){part(new THREE.BoxGeometry(.24,.42,.30),accent,.35,-.42,-.86,.05);part(new THREE.BoxGeometry(.07,.07,.80),dark,.35,-.18,-1.60)}
    if(w==='Shotgun')part(new THREE.BoxGeometry(.22,.16,.52),new THREE.MeshStandardMaterial({color:0x7a4e2e,roughness:.9}),.35,-.27,-.72);
    if(w==='Milan Gun'){const cyan=new THREE.MeshStandardMaterial({color:0x67d7ff,emissive:0x174c59,emissiveIntensity:.65,roughness:.35});for(const sx of [-1,1])part(new THREE.SphereGeometry(.13,12,10),cyan,.35+sx*.15,-.16,-1.38);const c=document.createElement('canvas');c.width=128;c.height=64;const x=c.getContext('2d');x.fillStyle='#111820';x.fillRect(0,0,128,64);x.font='900 44px Arial';x.textAlign='center';x.fillStyle='#7ee8ff';x.fillText('6 7',64,48);const tex=new THREE.CanvasTexture(c);const badge=new THREE.Mesh(new THREE.PlaneGeometry(.55,.28),new THREE.MeshBasicMaterial({map:tex,transparent:true}));badge.position.set(.46,-.18,-.82);badge.rotation.y=-.18;weaponGroup.add(badge)}
  }
  part(new THREE.BoxGeometry(.14,.18,.30),skin,.23,-.43,-.25,.1,0,-.12);muzzle=new THREE.PointLight(0xffc35a,0,3);muzzle.position.set(.35,-.2,-1.85);weaponGroup.add(muzzle);weaponGroup.position.set(.05,-.02,0);updateAmmo(true);updateWeaponVisibility();
}
function updateWeaponVisibility(){if(!weaponGroup)return;weaponGroup.visible=!(state.world==='voxel'&&state.mcHotbar>=1&&state.mcHotbar<=7)}
function weaponCfg(){return state.config.weapons?.[state.weapon]||{damage:27,rpm:650,mag:30,reload:1.35,spread:.006,range:85,color:'#f2c14e'}}


function setupUI(){
  $('#playBtn').onclick=enterGame;$('#quickBtn').onclick=()=>{state.room='PUBLIC';connect(true);enterGame()};
  $('#classBtn').onclick=$('#classBtnSide').onclick=()=>openModal('classModal');$('#gunBtn').onclick=$('#gunBtnSide').onclick=()=>openModal('gunModal');$('#hostBtn').onclick=()=>openModal('hostModal');$('#joinBtn').onclick=()=>openModal('joinModal');$('#settingsBtn').onclick=()=>openModal('settingsModal');$('#worldsBtn').onclick=()=>openModal('worldModal');$('#serversBtn').onclick=()=>{openModal('serverModal');refreshServers()};
  $('#inviteBtn').onclick=copyInvite;$('#createRoomBtn').onclick=()=>{state.room=randCode();state.mode=$('#hostMode').value;state.world=$('#hostWorld').value;localStorage.setItem('bf_world',state.world);buildWorld(state.world);connect(true);closeModal('hostModal');copyInvite();refreshAllUI()};
  $('#joinRoomBtn').onclick=()=>{const c=$('#joinCode').value.trim().toUpperCase();if(!c)return;state.room=c;state.world=$('#joinWorld').value;localStorage.setItem('bf_world',state.world);buildWorld(state.world);connect(true);closeModal('joinModal');refreshAllUI();enterGame()};
  $('#refreshServersBtn').onclick=refreshServers;$('#continueBtn').onclick=()=>{closeModal('roundBreak');if(state.playing)renderer.domElement.requestPointerLock()};$$('.close').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
  $('#saveSettingsBtn').onclick=()=>{state.name=$('#nameInput').value.trim()||state.name;state.settings.sens=+$('#sensInput').value;state.settings.fov=+$('#fovInput').value;state.settings.bob=$('#bobInput').checked;state.settings.quality=$('#qualityInput').checked;localStorage.setItem('bf_name',state.name);localStorage.setItem('bf_sens',state.settings.sens);localStorage.setItem('bf_fov',state.settings.fov);localStorage.setItem('bf_bob',state.settings.bob?'1':'0');localStorage.setItem('bf_quality',state.settings.quality?'1':'0');applySettings();buildWorld(state.world);connect(true);closeModal('settingsModal');toast('Settings saved')};
  $('#sensInput').oninput=()=>$('#sensVal').textContent=(+$('#sensInput').value).toFixed(2);$('#fovInput').oninput=()=>$('#fovVal').textContent=$('#fovInput').value;
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==renderer.domElement&&state.playing&&!state.chat&&!$('#roundBreak').classList.contains('hidden'))return;if(document.pointerLockElement!==renderer.domElement&&state.playing&&!state.chat)showMenu()});
  document.addEventListener('mousemove',e=>{if(document.pointerLockElement===renderer.domElement&&!state.chat){state.yaw-=e.movementX*.0022*state.settings.sens;state.pitch-=e.movementY*.0022*state.settings.sens;state.pitch=clamp(state.pitch,-1.48,1.48)}});
  addEventListener('keydown',onKeyDown);addEventListener('keyup',e=>{state.keys[e.code]=false;if(e.code==='Tab')$('#scoreboard').classList.add('hidden');if(state.world==='voxel'&&e.code==='KeyW')state.mcSprint=false});
  addEventListener('mousedown',e=>{if(!state.playing||state.chat)return;if(state.world==='voxel'){if(e.button===0){if(state.mcHotbar===0){state.mouseDown=true;shoot()}else if(state.mcHotbar===8){wsSend({t:'melee'});playSwordSound()}else{mineBlock();playBlockSound('mine')}}if(e.button===2){if(state.mcHotbar===0)state.ads=true;else if(state.mcHotbar>=1&&state.mcHotbar<=7){const hit=blockRay();if(hit?.block?.type==='lever')useBlock();else placeBlock();playBlockSound('place')}}return}if(e.button===0){state.mouseDown=true;shoot()}if(e.button===2)state.ads=true});
  addEventListener('mouseup',e=>{if(e.button===0)state.mouseDown=false;if(e.button===2)state.ads=false});addEventListener('wheel',e=>{if(state.world==='voxel'){e.preventDefault();setMinecraftHotbar((state.mcHotbar+(e.deltaY>0?1:-1)+MC_HOTBAR_SIZE)%MC_HOTBAR_SIZE)}},{passive:false});addEventListener('contextmenu',e=>e.preventDefault());
  $('#chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&state.chat){e.stopPropagation();const t=e.target.value.trim();if(t)wsSend({t:'chat',text:t});e.target.value='';toggleChat(false)}});
}

function buildWorldSelectors(){
  const grid=$('#worldGrid'),quick=$('#worldQuickSelect'),host=$('#hostWorld'),join=$('#joinWorld');grid.innerHTML='';quick.innerHTML='';host.innerHTML='';join.innerHTML='';
  const special={classic:'OPEN ARENA',voxel:'INFINITE · MINE · BUILD · DIG',stadium:'FOOTBALL WORLD',battle:'BATTLE ISLAND',clan:'CLASH OF CLANS MODE'};
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
function refreshLoadout(){const c=state.config.classes[state.klass];$('#className').textContent=state.klass;$('#weaponName').textContent=state.weapon;$('#weaponHud').textContent=state.world==='voxel'&&state.mcHotbar===8?'Block Sword':state.weapon;$('#loadoutCard').style.borderRightColor=(state.config.weapons?.[state.weapon]?.color||c.color)}
function refreshWorldUI(){const w=state.config.worlds[state.world];if(!w)return;$('#worldLabel').textContent=w.name.toUpperCase();$('#worldHud').textContent=w.short.toUpperCase();document.documentElement.style.setProperty('--accent',WORLD_ACCENTS[state.world]||'#f0b63f');refreshLoadout()}
function refreshRoomUI(){
  $('#roomLabel').textContent=state.room;$('#modeLabel').textContent=state.mode;$('#hudMode').textContent=state.mode;$('#roomHud').textContent=`ROOM ${state.room}`;const u=new URL(location.href);u.searchParams.set('room',state.room);u.searchParams.set('mode',state.mode);u.searchParams.set('world',state.world);history.replaceState(null,'',u);
}
function buildClassGrid(){const g=$('#classGrid');g.innerHTML='';for(const [name,c] of Object.entries(state.config.classes)){const b=document.createElement('button');b.className='class-option'+(name===state.klass?' active':'');b.innerHTML=`<b>${esc(name)}</b><small>Movement class</small><div class="stats">HP ${c.hp} · SPD ${Number(c.speed).toFixed(2)} · ${c.wall_jump?'WALL JUMP':'STANDARD MOVEMENT'}</div>`;b.onclick=()=>selectClass(name);g.appendChild(b)}}
function buildGunGrid(){const g=$('#gunGrid');if(!g)return;g.innerHTML='';const traits={'Assault Rifle':'Balanced automatic rifle','Sniper Rifle':'Extreme range · one-shot potential','Shotgun':'Seven pellets · strongest up close','Machine Gun':'Large 60-round magazine · sustained fire','Milan Gun':'Shoots tennis-ball-sized 6s and 7s · zero damage'};for(const [name,c] of Object.entries(state.config.weapons||{})){const b=document.createElement('button');b.className='gun-option'+(c.nonlethal?' nonlethal':'')+(name===state.weapon?' active':'');b.innerHTML=`<b>${esc(name)}</b><small>${c.nonlethal?'NON-LETHAL':`DMG ${c.damage} · ${c.rpm} RPM`}</small><div class="stats">MAG ${c.mag} · RANGE ${c.range} · RELOAD ${Number(c.reload).toFixed(2)}s</div><div class="trait">${traits[name]||''}</div>`;b.onclick=()=>selectWeapon(name);g.appendChild(b)}}
function selectWeapon(name){if(!state.config.weapons?.[name])return;state.weapon=name;localStorage.setItem('bf_weapon',name);state.ammo=weaponCfg().mag;state.reloading=false;state.mcHotbar=0;state.buildMode=false;createWeapon();refreshLoadout();buildGunGrid();updateBuildHud();wsSend({t:'weapon',weapon:name});closeModal('gunModal');toast(`${name} equipped`)}

function selectClass(k){state.klass=k;localStorage.setItem('bf_class',k);state.ammo=weaponCfg().mag;state.reloading=false;refreshLoadout();createWeapon();buildClassGrid();wsSend({t:'class',klass:k});closeModal('classModal');toast(`${k} equipped`)}
function openModal(id){$('#'+id).classList.remove('hidden')}function closeModal(id){$('#'+id).classList.add('hidden')}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1700)}
async function copyInvite(){const u=new URL(location.href);u.searchParams.set('room',state.room);u.searchParams.set('mode',state.mode);u.searchParams.set('world',state.world);try{await navigator.clipboard.writeText(u.toString());toast('Invite link copied')}catch{prompt('Copy this invite link:',u.toString())}}
async function refreshServers(){const list=$('#serverList');list.innerHTML='<div class="empty-servers">Loading rooms…</div>';try{const data=await fetch('/api/rooms').then(r=>r.json());if(!data.rooms.length){list.innerHTML='<div class="empty-servers">No active rooms yet. Host one and invite a friend.</div>';return}list.innerHTML='';for(const r of data.rooms){const d=document.createElement('div');d.className='server-row';d.innerHTML=`<b>${esc(r.world_name)}</b><span>${esc(r.mode)}</span><span class="optional">${r.players} player${r.players===1?'':'s'}</span><small class="optional">${fmtTime(r.remaining)}</small><button>JOIN</button>`;d.querySelector('button').onclick=()=>{state.room=r.code;state.world=r.world;state.mode=r.mode;localStorage.setItem('bf_world',state.world);buildWorld(state.world);connect(true);closeModal('serverModal');refreshAllUI();enterGame()};list.appendChild(d)}}catch{list.innerHTML='<div class="empty-servers">Could not load room list.</div>'}}

function connect(force=false){
  if(state.ws&&state.ws.readyState<=1){if(!force)return;try{state.ws.onclose=null;state.ws.close()}catch{}}
  const proto=location.protocol==='https:'?'wss':'ws';const url=`${proto}://${location.host}/ws/${encodeURIComponent(state.room)}?name=${encodeURIComponent(state.name)}&klass=${encodeURIComponent(state.klass)}&mode=${encodeURIComponent(state.mode)}&world=${encodeURIComponent(state.world)}&weapon=${encodeURIComponent(state.weapon)}`;
  const ws=new WebSocket(url);state.ws=ws;const opened=performance.now();$('#menuPing').textContent='CONNECTING';
  ws.onopen=()=>{state.connected=true;state.ping=Math.round(performance.now()-opened);$('#menuPing').textContent=`${state.ping} PING`};
  ws.onclose=()=>{state.connected=false;$('#menuPing').textContent='RECONNECTING';if(state.ws===ws)setTimeout(()=>connect(),1200)};ws.onerror=()=>{$('#menuPing').textContent='OFFLINE'};ws.onmessage=e=>handleMessage(JSON.parse(e.data));
}
function wsSend(x){if(state.ws&&state.ws.readyState===1)state.ws.send(JSON.stringify(x))}
function handleMessage(m){
  if(m.t==='welcome'){
    state.id=m.id;state.room=m.room;state.mode=m.mode;if(m.player?.weapon&&state.config.weapons?.[m.player.weapon]){state.weapon=m.player.weapon;localStorage.setItem('bf_weapon',state.weapon)}if(m.world&&m.world!==state.world){state.world=m.world;buildWorld(state.world);buildWorldSelectors()}state.pos.set(m.player.x,m.player.y,m.player.z);state.hp=m.player.hp;state.alive=true;state.ammo=weaponCfg().mag;if(state.world==='voxel')syncBlocks(m.blocks||[]);refreshAllUI();
  }else if(m.t==='snapshot'){
    state.mode=m.mode;state.worldTime=m.world_time||0;renderSnapshot(m.players);renderMobSnapshot(m.mobs||[]);$('#timer').textContent=fmtTime(m.remaining);if(m.mode!=='FFA')$('#teamScore').textContent=`Alpha ${m.team_scores.Alpha} : ${m.team_scores.Bravo} Bravo`;else $('#teamScore').textContent='';updateScoreboard(m.players);if(m.mode==='HARDPOINT')updateHardpoint(m.hardpoint);else hardpointMesh.visible=false;
  }else if(m.t==='kill'){
    feed(`<b>${esc(m.killer)}</b> <span>${esc(m.weapon)}</span> <em>${esc(m.victim)}</em>`);if(m.victim_id===state.id){state.alive=false;state.hp=0;$('#respawn').classList.remove('hidden');$('#hp').textContent='0';$('#hpbar').style.width='0%';setTimeout(()=>wsSend({t:'respawn'}),1370)}
  }else if(m.t==='respawn'&&m.player.id===state.id){state.pos.set(m.player.x,m.player.y,m.player.z);state.vel.set(0,0,0);state.hp=m.player.hp;state.alive=true;state.ammo=weaponCfg().mag;$('#respawn').classList.add('hidden');updateHP();updateAmmo(true)
  }else if(m.t==='weapon'){if(state.config.weapons?.[m.weapon]){state.weapon=m.weapon;localStorage.setItem('bf_weapon',state.weapon);state.ammo=weaponCfg().mag;createWeapon();refreshLoadout();buildGunGrid()}}else if(m.t==='milan'){spawnMilanProjectile(m)}else if(m.t==='hit'){if(m.attacker===state.id)hitmarker()}
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
function hitmarker(){const h=$('#hitmarker');h.classList.add('show');playHitSound();setTimeout(()=>h.classList.remove('show'),85)}
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

function syncBlocks(blocks){state.dynamicBlocks.clear();for(const b of blocks)state.dynamicBlocks.set(b.key,b);rebuildVoxelRender(true);rebuildColliders()}
function voxelBlockExposed(b){
  const n=[[2,0,0],[-2,0,0],[0,2,0],[0,-2,0],[0,0,2],[0,0,-2]];
  for(const [dx,dy,dz] of n)if(!state.dynamicBlocks.has(`${b.x+dx}:${b.y+dy}:${b.z+dz}`))return true;return false;
}
function rebuildVoxelRender(force=false){
  if(state.world!=='voxel')return;const anchor=state.playing?state.pos:camera.position,rx=Math.floor(anchor.x/20),rz=Math.floor(anchor.z/20),key=`${rx}:${rz}:${state.dynamicBlocks.size}`;if(!force&&key===state.voxelRenderKey)return;state.voxelRenderKey=key;clearGroup(dynamicGroup);
  const groups=new Map();for(const b of state.dynamicBlocks.values()){
    if(Math.abs(b.x-anchor.x)>VOXEL_RENDER_RADIUS||Math.abs(b.z-anchor.z)>VOXEL_RENDER_RADIUS||Math.abs(b.y-(state.playing?state.pos.y:8))>42)continue;
    if(!voxelBlockExposed(b)&&!['redstone','lamp','lever','glass'].includes(b.type))continue;
    const gk=`${b.type}:${b.powered?1:0}`;if(!groups.has(gk))groups.set(gk,{type:b.type,powered:!!b.powered,blocks:[]});groups.get(gk).blocks.push(b)
  }
  const matrix=new THREE.Matrix4();for(const group of groups.values()){
    const {type,powered,blocks}=group,mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(2,2,2),voxelMaterial(type,powered),blocks.length);mesh.userData.blockKeys=[];mesh.frustumCulled=true;
    for(let i=0;i<blocks.length;i++){const b=blocks[i];matrix.makeTranslation(b.x,b.y,b.z);mesh.setMatrixAt(i,matrix);mesh.userData.blockKeys[i]=b.key}mesh.instanceMatrix.needsUpdate=true;dynamicGroup.add(mesh)
  }
}
function voxelSurfaceHeight(x,z){const n=Math.sin((x+11)*.11)+Math.cos((z-7)*.10)+.7*Math.sin((x+z)*.045)+.35*Math.cos((x-z)*.06);const layers=clamp(Math.round(4+n*1.3),2,7);return 1+(layers-1)*2}
function rebuildVoxelHorizon(force=false){
  if(state.world!=='voxel')return;const anchor=state.playing?state.pos:camera.position,cx=Math.floor(anchor.x/32),cz=Math.floor(anchor.z/32),key=`${cx}:${cz}:${state.dynamicBlocks.size}`;if(!force&&key===state.voxelHorizonKey)return;state.voxelHorizonKey=key;clearGroup(streamGroup);
  const realColumns=new Set();for(const b of state.dynamicBlocks.values())realColumns.add(`${b.x}:${b.z}`);
  const positions=[];const startX=Math.floor((anchor.x-VOXEL_HORIZON_RADIUS)/VOXEL_HORIZON_STEP)*VOXEL_HORIZON_STEP,endX=anchor.x+VOXEL_HORIZON_RADIUS,startZ=Math.floor((anchor.z-VOXEL_HORIZON_RADIUS)/VOXEL_HORIZON_STEP)*VOXEL_HORIZON_STEP,endZ=anchor.z+VOXEL_HORIZON_RADIUS;
  for(let x=startX;x<=endX;x+=VOXEL_HORIZON_STEP)for(let z=startZ;z<=endZ;z+=VOXEL_HORIZON_STEP){const dx=x-anchor.x,dz=z-anchor.z;if(dx*dx+dz*dz>VOXEL_HORIZON_RADIUS*VOXEL_HORIZON_RADIUS)continue;let hasReal=false;for(const ox of [0,2])for(const oz of [0,2])if(realColumns.has(`${x+ox}:${z+oz}`))hasReal=true;if(hasReal)continue;positions.push([x,voxelSurfaceHeight(x,z),z])}
  const geo=new THREE.BoxGeometry(VOXEL_HORIZON_STEP,2,VOXEL_HORIZON_STEP),mat=voxelMaterial('grass'),mesh=new THREE.InstancedMesh(geo,mat,positions.length),matrix=new THREE.Matrix4();mesh.frustumCulled=true;for(let i=0;i<positions.length;i++){const [x,y,z]=positions[i];matrix.makeTranslation(x,y,z);mesh.setMatrixAt(i,matrix)}mesh.instanceMatrix.needsUpdate=true;streamGroup.add(mesh);
}


function rebuildColliders(){const w=state.config.worlds[state.world];state.currentBoxes=[...w.boxes]}
function blockRay(){raycaster.setFromCamera(new THREE.Vector2(0,0),camera);raycaster.far=9;const hits=raycaster.intersectObjects(dynamicGroup.children,false);if(!hits.length)return null;const hit=hits[0],keys=hit.object.userData.blockKeys||[],key=keys[hit.instanceId];if(!key)return null;hit.block=state.dynamicBlocks.get(key);hit.blockKey=key;return hit}
function mineBlock(){const hit=blockRay();if(hit?.blockKey)wsSend({t:'block_break',key:hit.blockKey})}
function placeBlock(){const hit=blockRay();if(!hit?.block)return;const b=hit.block,n=hit.face?.normal||new THREE.Vector3(0,1,0),pos=[b.x+Math.round(n.x)*2,b.y+Math.round(n.y)*2,b.z+Math.round(n.z)*2];wsSend({t:'block_place',pos,type:BLOCK_TYPES[state.blockIndex]})}
function useBlock(){const hit=blockRay();if(hit?.blockKey)wsSend({t:'block_use',key:hit.blockKey})}
function toggleBuildMode(){if(state.world!=='voxel'){toast('Voxel tools are only available in Voxel Frontier');return}setMinecraftHotbar(state.mcHotbar===0?1:0)}
function cycleBlock(){if(state.world==='voxel')setMinecraftHotbar((state.mcHotbar+1)%MC_HOTBAR_SIZE)}
function updateBuildHud(){const mode=$('#voxelMode');if(mode){if(state.mcHotbar===0)mode.textContent=`GUN: ${state.weapon.toUpperCase()}`;else if(state.mcHotbar===8)mode.textContent='DIAMOND SWORD';else mode.textContent=`BLOCK: ${BLOCK_TYPES[state.mcHotbar-1].toUpperCase()}`;if($('#weaponHud'))$('#weaponHud').textContent=state.mcHotbar===8?'Block Sword':state.mcHotbar===0?state.weapon:BLOCK_TYPES[state.mcHotbar-1]}const bar=$('#blockHotbar');if(!bar)return;bar.innerHTML='';for(let slot=0;slot<9;slot++){const d=document.createElement('div');d.className='block-slot'+(slot===state.mcHotbar?' active':'');if(slot===0){d.style.background=state.config?.weapons?.[state.weapon]?.color||'#f2c14e';d.textContent='1';d.title=state.weapon}else if(slot===8){d.style.background='#65d9e5';d.textContent='9';d.title='Block Sword'}else{const t=BLOCK_TYPES[slot-1];d.style.background=BLOCK_COLORS[t];d.textContent=String(slot+1);d.title=t}bar.appendChild(d)}$('#crosshair')?.classList.toggle('build-crosshair',state.buildMode)}
function setMinecraftHotbar(slot){if(state.world!=='voxel')return;state.mcHotbar=((slot%MC_HOTBAR_SIZE)+MC_HOTBAR_SIZE)%MC_HOTBAR_SIZE;state.buildMode=state.mcHotbar>=1&&state.mcHotbar<=7;if(state.buildMode)state.blockIndex=state.mcHotbar-1;state.mouseDown=false;state.ads=false;updateBuildHud();createWeapon();refreshLoadout()}
function dropSelectedItem(){if(state.world!=='voxel')return;const col=state.mcHotbar===0?(state.config.weapons?.[state.weapon]?.color||'#ddd'):state.mcHotbar===8?'#65d9e5':BLOCK_COLORS[BLOCK_TYPES[state.mcHotbar-1]],d=new THREE.Mesh(new THREE.BoxGeometry(.32,.32,.32),new THREE.MeshLambertMaterial({color:col})),f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);d.position.copy(camera.position).add(f.clone().multiplyScalar(.8));scene.add(d);const start=performance.now(),v=f.multiplyScalar(3.4);v.y=2.2;const tick=()=>{const dt=.016;d.position.addScaledVector(v,dt);v.y-=9.8*dt;d.rotation.x+=.08;d.rotation.y+=.11;if(performance.now()-start<900)requestAnimationFrame(tick);else{scene.remove(d);d.geometry.dispose();d.material.dispose()}};tick();playDropSound();toast('Dropped item')}


function enterGame(){state.playing=true;$('#menu').classList.remove('show');$('#hud').classList.remove('hidden');setGameplayActive(true);renderer.domElement.requestPointerLock()}
function showMenu(){state.playing=false;state.mouseDown=false;state.ads=false;state.buildMode=false;updateBuildHud();updateWeaponVisibility();$('#menu').classList.add('show');$('#hud').classList.add('hidden');setGameplayActive(false)}
function onKeyDown(e){if(state.world==='voxel'&&e.code==='KeyT'&&state.playing){e.preventDefault();toggleChat();return}if(e.code==='Enter'&&state.playing){e.preventDefault();toggleChat();return}if(state.chat){if(e.code==='Escape')toggleChat(false);return}if(state.world==='voxel'&&e.code==='KeyW'&&!e.repeat){const now=performance.now();if(now-state.lastWDown<280)state.mcSprint=true;state.lastWDown=now}state.keys[e.code]=true;if(e.code==='Tab'){e.preventDefault();$('#scoreboard').classList.remove('hidden')}if(e.code==='KeyR'&&!(state.world==='voxel'&&state.mcHotbar!==0))reload();if(state.world!=='voxel'&&e.code==='KeyQ')wsSend({t:'melee'});if(state.world==='voxel'&&e.code==='KeyQ'){dropSelectedItem();return}if(state.world==='voxel'&&e.code==='KeyE'){showMenu();openModal('gunModal');return}if(e.code==='Escape'&&state.playing)showMenu();if(state.world==='voxel'&&/^Digit[1-9]$/.test(e.code))setMinecraftHotbar(Number(e.code.slice(5))-1)}
function toggleChat(force){const next=force!==undefined?force:!state.chat;state.chat=next;const box=$('#chatbox'),inp=$('#chatInput');box.classList.toggle('chatting',next);if(next){document.exitPointerLock();setTimeout(()=>inp.focus(),0)}else{inp.blur();if(state.playing)renderer.domElement.requestPointerLock()}}

function voxelNearbyBlocks(x,z){
  const out=[],gx=Math.round(x/2)*2,gz=Math.round(z/2)*2;
  for(const dx of [-2,0,2])for(const dz of [-2,0,2]){
    const bx=gx+dx,bz=gz+dz;
    for(let by=-15;by<=31;by+=2){const b=state.dynamicBlocks.get(`${bx}:${by}:${bz}`);if(b)out.push(b)}
  }
  return out;
}
function collidesAt(x,y,z){
  const r=state.world==='voxel'?.58:.38,h=state.world==='voxel'?(state.crouched?3.25:3.6):1.78;
  if(state.world==='voxel'){
    for(const b of voxelNearbyBlocks(x,z)){const minx=b.x-1-r,maxx=b.x+1+r,minz=b.z-1-r,maxz=b.z+1+r,miny=b.y-1,maxy=b.y+1;if(x>minx&&x<maxx&&z>minz&&z<maxz&&y+h>miny+.05&&y<maxy-.05)return b}return null;
  }
  for(const b of state.currentBoxes){const minx=b.x-b.w/2-r,maxx=b.x+b.w/2+r,minz=b.z-b.d/2-r,maxz=b.z+b.d/2+r,miny=b.y-b.h/2,maxy=b.y+b.h/2;if(x>minx&&x<maxx&&z>minz&&z<maxz&&y+h>miny+.05&&y<maxy-.05)return b}return null;
}
function groundHeightAt(x,z,currentY){
  if(state.world==='voxel'){
    // Use the player's footprint rather than shrinking every block. The previous +/-.2 inset created
    // invisible cracks exactly at voxel seams, which is why walking or jumping made the player fall through.
    const r=.58;let best=-18;
    for(const b of voxelNearbyBlocks(x,z)){const top=b.y+1;if(x+r>=b.x-1.001&&x-r<=b.x+1.001&&z+r>=b.z-1.001&&z-r<=b.z+1.001&&top<=currentY+.8&&top>best)best=top}
    return best;
  }
  let best=0;for(const b of state.currentBoxes){const top=b.y+b.h/2;if(x>b.x-b.w/2+.2&&x<b.x+b.w/2-.2&&z>b.z-b.d/2+.2&&z<b.z+b.d/2-.2&&top<=currentY+.4&&top>best)best=top}return best;
}
function physics(dt){if(!state.playing||!state.alive||state.chat)return;if(state.world==='voxel'&&state.dynamicBlocks.size===0)return;const cfg=state.config.classes[state.klass],fwd=new THREE.Vector3(-Math.sin(state.yaw),0,-Math.cos(state.yaw)),right=new THREE.Vector3(Math.cos(state.yaw),0,-Math.sin(state.yaw));let wish=new THREE.Vector3();if(state.keys.KeyW)wish.add(fwd);if(state.keys.KeyS)wish.sub(fwd);if(state.keys.KeyD)wish.add(right);if(state.keys.KeyA)wish.sub(right);if(wish.lengthSq())wish.normalize();if(state.world==='voxel'){const sneak=!!(state.keys.ShiftLeft||state.keys.ShiftRight),sprint=!!(state.keys.ControlLeft||state.keys.ControlRight||state.mcSprint)&&!!state.keys.KeyW&&!sneak;state.crouched=sneak;state.slide=0;const target=sneak?2.60:sprint?11.22:8.63,accel=state.grounded?38:10;if(wish.lengthSq()){state.vel.x+=wish.x*accel*dt;state.vel.z+=wish.z*accel*dt;const hs=Math.hypot(state.vel.x,state.vel.z);if(hs>target){state.vel.x*=target/hs;state.vel.z*=target/hs}}else if(state.grounded){const fr=Math.max(0,1-12*dt);state.vel.x*=fr;state.vel.z*=fr}const jump=state.keys.Space;if(jump&&!state.jumpLatch&&state.grounded&&!sneak){state.vel.y=10.15;state.grounded=false;state.jumpLatch=true;playJumpSound()}if(!jump)state.jumpLatch=false;if(!state.grounded)state.vel.y-=20.5*dt;let nx=state.pos.x+state.vel.x*dt,nz=state.pos.z+state.vel.z*dt;if(sneak&&state.grounded){if(groundHeightAt(nx,state.pos.z,state.pos.y+.25)<state.pos.y-1)nx=state.pos.x;if(groundHeightAt(state.pos.x,nz,state.pos.y+.25)<state.pos.y-1)nz=state.pos.z}if(!collidesAt(nx,state.pos.y,state.pos.z))state.pos.x=nx;else state.vel.x=0;if(!collidesAt(state.pos.x,state.pos.y,nz))state.pos.z=nz;else state.vel.z=0;const wasGrounded=state.grounded,prevY=state.pos.y;state.pos.y+=state.vel.y*dt;const gh=groundHeightAt(state.pos.x,state.pos.z,prevY+.35);if(state.pos.y<=gh&&state.vel.y<=0){state.pos.y=gh;state.vel.y=0;state.grounded=true;if(!wasGrounded)playLandSound()}else state.grounded=false;if(state.grounded&&wish.lengthSq()&&performance.now()-state.stepAt>(sprint?250:sneak?520:360)){state.stepAt=performance.now();playStepSound()}}else{const speedMult=cfg.speed,base=7.35*speedMult,horizontal=Math.hypot(state.vel.x,state.vel.z),shift=state.keys.ShiftLeft||state.keys.ShiftRight;if(state.grounded&&shift&&horizontal>4.2&&state.slide<=0){state.slide=.43;state.crouched=true;const boost=Math.min(15.8*speedMult,Math.max(base*1.22,horizontal*1.09));if(horizontal>0){state.vel.x=state.vel.x/horizontal*boost;state.vel.z=state.vel.z/horizontal*boost}}if(state.slide>0){state.slide-=dt;state.crouched=true;if(wish.lengthSq()){state.vel.x+=wish.x*4*dt;state.vel.z+=wish.z*4*dt}const drag=Math.pow(.72,dt);state.vel.x*=drag;state.vel.z*=drag}else state.crouched=shift&&state.grounded;const accel=state.grounded?34:12,target=base;if(state.slide<=0){if(wish.lengthSq()){state.vel.x+=wish.x*accel*dt;state.vel.z+=wish.z*accel*dt;const hs=Math.hypot(state.vel.x,state.vel.z),cap=state.grounded?target*1.25:Math.max(target*1.2,state.speedBoost*target);if(hs>cap){state.vel.x*=cap/hs;state.vel.z*=cap/hs}}else if(state.grounded){const fr=Math.max(0,1-9*dt);state.vel.x*=fr;state.vel.z*=fr}}const jump=state.keys.Space;if(jump&&!state.jumpLatch&&state.grounded){const hs=Math.hypot(state.vel.x,state.vel.z);state.vel.y=9.4;state.grounded=false;state.jumpLatch=true;playJumpSound();if(state.slide>0||state.landGrace>0){const n=Math.max(hs,base);state.speedBoost=clamp(n/base*1.035,1,2.15);if(hs>0){state.vel.x*=1.035;state.vel.z*=1.035}}state.slide=0}if(!jump)state.jumpLatch=false;if(!state.grounded)state.vel.y-=20.5*dt;state.landGrace=Math.max(0,state.landGrace-dt);const nx=state.pos.x+state.vel.x*dt,nz=state.pos.z+state.vel.z*dt;const bx=collidesAt(nx,state.pos.y,state.pos.z);if(!bx)state.pos.x=nx;else{if(cfg.wall_jump&&jump&&!state.grounded&&!state.jumpLatch){state.vel.y=8.8;state.vel.x*=-.42;state.jumpLatch=true}state.vel.x=0}const bz=collidesAt(state.pos.x,state.pos.y,nz);if(!bz)state.pos.z=nz;else{if(cfg.wall_jump&&jump&&!state.grounded&&!state.jumpLatch){state.vel.y=8.8;state.vel.z*=-.42;state.jumpLatch=true}state.vel.z=0}const wasGrounded=state.grounded,prevY=state.pos.y;state.pos.y+=state.vel.y*dt;const gh=groundHeightAt(state.pos.x,state.pos.z,prevY+.3);if(state.pos.y<=gh&&state.vel.y<=0){if(!state.grounded){state.landGrace=.11;const hs=Math.hypot(state.vel.x,state.vel.z);state.speedBoost=clamp(hs/base,1,2.2)}state.pos.y=gh;state.vel.y=0;state.grounded=true;if(!wasGrounded)playLandSound()}else state.grounded=false}if(state.pos.y<(state.world==='voxel'?-24:-8)){const reset=state.config.worlds[state.world].spawns[0]||[0,0,0];state.pos.set(reset[0],reset[1],reset[2]);state.vel.set(0,0,0)}$('#speed').textContent=Math.round(Math.hypot(state.vel.x,state.vel.z)*10)}

function shoot(){if(!state.playing||!state.alive||state.chat||state.reloading||(state.world==='voxel'&&state.mcHotbar!==0))return;const cfg=weaponCfg(),now=performance.now(),delay=60000/cfg.rpm;if(now-state.lastShot<delay)return;if(state.ammo<=0){reload();return}state.lastShot=now;state.ammo--;updateAmmo();muzzle.intensity=cfg.nonlethal?6:10;setTimeout(()=>muzzle.intensity=0,35);weaponGroup.rotation.x=cfg.nonlethal?-.015:-.045;weaponGroup.position.z=.045;const spread=cfg.spread*(state.ads?.42:1),dir=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);dir.x+=(Math.random()-.5)*spread;dir.y+=(Math.random()-.5)*spread;dir.z+=(Math.random()-.5)*spread;dir.normalize();const o=camera.getWorldPosition(new THREE.Vector3());wsSend({t:'fire',o:[o.x,o.y,o.z],d:[dir.x,dir.y,dir.z]});state.pitch+=(state.weapon==='Sniper Rifle'?.035:state.weapon==='Machine Gun'?.014:state.weapon==='Milan Gun'?.003:.009)*(state.ads?.65:1);playShot(state.weapon);if(state.ammo===0)setTimeout(reload,130)}
function reload(){if(state.reloading||(state.world==='voxel'&&state.mcHotbar!==0))return;const cfg=weaponCfg();if(state.ammo>=cfg.mag)return;state.reloading=true;$('#mag').textContent='R';playReloadSound(false);setTimeout(()=>{state.ammo=cfg.mag;state.reloading=false;updateAmmo();playReloadSound(true)},cfg.reload*1000)}
function updateAmmo(force=false){if(!state.config)return;const cfg=weaponCfg();if(force&&(!Number.isFinite(state.ammo)||state.ammo>cfg.mag))state.ammo=cfg.mag;$('#mag').textContent=state.reloading?'R':state.ammo;$('#reserve').textContent='∞'}
function updateHP(){const cfg=state.config.classes[state.klass],max=cfg.hp;$('#hp').textContent=Math.max(0,state.hp);$('#hpbar').style.width=`${clamp(state.hp/max*100,0,100)}%`}
function audioCtx(){try{const C=window.AudioContext||window.webkitAudioContext;window._ac=window._ac||new C();if(window._ac.state==='suspended')window._ac.resume();return window._ac}catch{return null}}
function tone(freq,dur=.08,type='square',gain=.035,endFreq=null){const ac=audioCtx();if(!ac)return;const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(freq,ac.currentTime);if(endFreq)o.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),ac.currentTime+dur);g.gain.setValueAtTime(gain,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+dur);o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+dur+.01)}
function noiseBurst(dur=.06,gain=.035,lowpass=1800){const ac=audioCtx();if(!ac)return;const n=Math.max(1,Math.floor(ac.sampleRate*dur)),buf=ac.createBuffer(1,n,ac.sampleRate),data=buf.getChannelData(0);for(let i=0;i<n;i++)data[i]=(Math.random()*2-1)*(1-i/n);const src=ac.createBufferSource(),filter=ac.createBiquadFilter(),g=ac.createGain();filter.type='lowpass';filter.frequency.value=lowpass;g.gain.setValueAtTime(gain,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+dur);src.buffer=buf;src.connect(filter).connect(g).connect(ac.destination);src.start()}
function playReloadSound(done){tone(done?720:260,.055,'triangle',.025,done?520:180);if(done)setTimeout(()=>tone(980,.04,'square',.018,740),40)}
function playHitSound(){tone(1150,.035,'sine',.025,820)}
function playJumpSound(){tone(165,.055,'sine',.013,220)}
function playLandSound(){noiseBurst(.045,.018,520)}
function playStepSound(){noiseBurst(.026,.010,state.world==='voxel'?650:900)}
function playBlockSound(kind){noiseBurst(kind==='mine'?.055:.035,kind==='mine'?.025:.018,kind==='mine'?520:820);tone(kind==='mine'?105:185,.04,'triangle',.012,kind==='mine'?72:130)}
function playSwordSound(){noiseBurst(.05,.025,2600);tone(330,.06,'sawtooth',.018,145)}
function playDropSound(){tone(220,.06,'triangle',.018,120)}
function digitSprite(digit){const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.font='900 100px Arial';x.textAlign='center';x.textBaseline='middle';x.lineWidth=10;x.strokeStyle='#10222b';x.strokeText(digit,64,67);x.fillStyle=digit==='6'?'#7ee8ff':'#ffd667';x.fillText(digit,64,67);const tex=new THREE.CanvasTexture(c),sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:true}));sp.scale.set(.26,.26,.26);return sp}
function spawnMilanProjectile(m){const sp=digitSprite(m.digit==='7'?'7':'6'),o=m.o||[0,0,0],d=m.d||[0,0,-1];sp.position.set(o[0],o[1],o[2]);scene.add(sp);state.milanProjectiles.push({obj:sp,vel:new THREE.Vector3(d[0],d[1],d[2]).multiplyScalar(24),life:1.8,spin:(Math.random()-.5)*4})}
function updateMilanProjectiles(dt){for(let i=state.milanProjectiles.length-1;i>=0;i--){const p=state.milanProjectiles[i];p.life-=dt;p.obj.position.addScaledVector(p.vel,dt);p.obj.material.rotation+=p.spin*dt;if(p.life<=0){scene.remove(p.obj);p.obj.material.map?.dispose();p.obj.material.dispose();state.milanProjectiles.splice(i,1)}}}

function playShot(type){if(type==='Sniper Rifle'){noiseBurst(.13,.09,3300);tone(120,.15,'sawtooth',.055,42)}else if(type==='Shotgun'){noiseBurst(.16,.11,1500);tone(72,.12,'square',.055,34)}else if(type==='Machine Gun'){noiseBurst(.055,.055,2600);tone(145,.055,'square',.027,68)}else if(type==='Milan Gun'){tone(670,.08,'sine',.045,930);setTimeout(()=>tone(Math.random()<.5?600:700,.10,'triangle',.035,420),35)}else{noiseBurst(.065,.06,2400);tone(135,.07,'square',.032,55)}}

function updateDayNight(){
  if(state.world!=='voxel')return;const t=state.worldTime,a=t*Math.PI*2,day=Math.max(0,Math.sin(a));const dusk=Math.max(0,Math.sin(a+Math.PI));const skyDay=new THREE.Color(0x7ec8ff),skyNight=new THREE.Color(0x071229);const mix=clamp(day*1.18+.08,.08,1);scene.background=skyNight.clone().lerp(skyDay,mix);scene.fog.color.copy(scene.background);hemi.intensity=.35+1.85*mix;sun.intensity=.08+1.4*day;moonLight.intensity=.7*(1-mix);if(skySun){skySun.position.set(Math.cos(a)*42,10+Math.sin(a)*34,-38);skySun.visible=Math.sin(a)>-.18}if(skyMoon){skyMoon.position.set(Math.cos(a+Math.PI)*42,10+Math.sin(a+Math.PI)*34,-38);skyMoon.visible=Math.sin(a)<.28}if(stars)stars.visible=mix<.45;$('#dayIcon').textContent=mix>.4?'☀':'☾';$('#dayLabel').textContent=mix>.4?'DAY':'NIGHT';
}

let netAcc=0,menuCamT=0,frameCount=0,fpsAcc=0;
function animate(){
  requestAnimationFrame(animate);const dt=Math.min(.033,clock?clock.getDelta():.016);frameCount++;fpsAcc+=dt;if(fpsAcc>1){$('#menuFps').textContent=`${Math.round(frameCount/fpsAcc)} FPS`;frameCount=0;fpsAcc=0}updateDayNight();updateStreamingWorld();rebuildVoxelRender();rebuildVoxelHorizon();updateCleanerBots(dt);updateMilanProjectiles(dt);if(stormRing)stormRing.rotation.y+=dt*.08;
  if(state.playing){physics(dt);camera.position.set(state.pos.x,state.pos.y+(state.world==='voxel'?(state.crouched?2.90:3.24):(state.crouched?1.18:1.62)),state.pos.z);camera.rotation.set(state.pitch,state.yaw,0);const targetFov=state.ads&&!state.buildMode?Math.max(48,state.settings.fov*.68):state.settings.fov;camera.fov=lerp(camera.fov,targetFov,1-Math.pow(.001,dt));camera.updateProjectionMatrix();const sp=Math.hypot(state.vel.x,state.vel.z),bob=state.settings.bob&&state.grounded?Math.sin(performance.now()*.015)*Math.min(.014,sp*.0013):0;const adsX=state.ads&&!state.buildMode?-.32:.05,adsY=state.ads&&!state.buildMode?.02:-.02;if(weaponGroup){weaponGroup.position.x=lerp(weaponGroup.position.x,adsX,dt*12);weaponGroup.position.y=lerp(weaponGroup.position.y,adsY+bob,dt*12);weaponGroup.position.z=lerp(weaponGroup.position.z,0,dt*18);weaponGroup.rotation.x=lerp(weaponGroup.rotation.x,0,dt*16)}$('#crosshair').style.opacity=state.ads&&!state.buildMode?.28:1;netAcc+=dt;if(netAcc>.05){netAcc=0;wsSend({t:'state',x:state.pos.x,y:state.pos.y,z:state.pos.z,yaw:state.yaw,pitch:state.pitch,vx:state.vel.x,vy:state.vel.y,vz:state.vel.z})}if(state.mouseDown)shoot();
  }else{menuCamT+=dt*.13;const radius=state.world==='stadium'?25:16;camera.position.set(Math.sin(menuCamT)*radius,6+Math.sin(menuCamT*.55)*1.2,Math.cos(menuCamT)*radius);camera.lookAt(0,2,0);if(weaponGroup)weaponGroup.position.set(.05,-.02,0)}
  for(const r of state.remote.values()){r.group.position.lerp(r.target,1-Math.pow(.0008,dt));r.group.rotation.y=r.yaw}for(const r of state.mobs.values())r.group.position.lerp(r.target,1-Math.pow(.001,dt));for(const g of decorGroup.children){if(g.userData&&g.userData.billboard)g.lookAt(camera.position)}renderer.render(scene,camera);
}

boot().catch(err=>{console.error(err);document.body.insertAdjacentHTML('beforeend',`<div style="position:fixed;inset:20px;z-index:999;background:#200;color:#fff;padding:20px">Blockfront failed to start: ${esc(err.message||err)}</div>`)});
