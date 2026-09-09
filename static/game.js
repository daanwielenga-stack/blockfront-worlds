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

const state={
  config:null,siteConfig:null,ws:null,id:null,connected:false,playing:false,room:'PUBLIC',mode:'FFA',world:localStorage.getItem('bf_world')||'classic',
  name:localStorage.getItem('bf_name')||`Guest_${Math.floor(Math.random()*900+100)}`,
  klass:localStorage.getItem('bf_class')||'Triggerman',
  settings:{sens:+(localStorage.getItem('bf_sens')||1),fov:+(localStorage.getItem('bf_fov')||82),bob:localStorage.getItem('bf_bob')!=='0',quality:localStorage.getItem('bf_quality')!=='0'},
  hp:100,alive:true,ammo:30,reloading:false,lastShot:0,players:new Map(),killfeed:[],keys:{},mouseDown:false,ads:false,
  yaw:0,pitch:0,pos:new THREE.Vector3(0,0,0),vel:new THREE.Vector3(),grounded:true,slide:0,crouched:false,jumpLatch:false,landGrace:0,speedBoost:1,chat:false,
  remote:new Map(),mobs:new Map(),ping:0,currentBoxes:[],dynamicBlocks:new Map(),buildMode:false,blockIndex:0,worldTime:0,streamChunk:''
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
  camera=new THREE.PerspectiveCamera(state.settings.fov,innerWidth/innerHeight,.05,420);camera.rotation.order='YXZ';
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
  clearGroup(worldGroup);clearGroup(streamGroup);clearGroup(decorGroup);clearGroup(dynamicGroup);clearGroup(mobGroup);cleanerBots=[];state.dynamicBlocks.clear();state.mobs.clear();state.streamChunk='';
  scene.background=color(w.sky);scene.fog=new THREE.Fog(color(w.fog),id==='clan'?82:58,id==='stadium'?145:id==='clan'?175:125);hemi.intensity=id==='clan'?2.35:2;sun.intensity=id==='clan'?1.7:1.25;sun.color.set(id==='clan'?0xfff2cf:0xffffff);moonLight.intensity=0;stormRing=null;skySun=skyMoon=stars=null;
  buildGround(w);for(const b of w.boxes)addStyledWorldBox(w,b);buildDecor(w);updateStreamingWorld(true);state.currentBoxes=[...w.boxes];
  $('#voxelHud').classList.toggle('hidden',id!=='voxel');$('#dayNight').classList.toggle('hidden',id!=='voxel');state.buildMode=false;updateBuildHud();
  refreshWorldUI();createWeapon();
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
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(190,190),new THREE.MeshToonMaterial({map:clanGrassTexture(),color:0xffffff}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-.02;ground.receiveShadow=true;worldGroup.add(ground);
    // soft decorative dirt border that gives the village a handcrafted mobile-game island feel
    const rim=new THREE.Mesh(new THREE.RingGeometry(65,88,64),new THREE.MeshToonMaterial({color:0x6fa64e,side:THREE.DoubleSide}));rim.rotation.x=-Math.PI/2;rim.position.y=-.01;worldGroup.add(rim);
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
    if(b.tag==='path'){
      const m=new THREE.Mesh(new THREE.PlaneGeometry(b.w,b.d),new THREE.MeshToonMaterial({color:0xd7c39d,transparent:true,opacity:.85,side:THREE.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.set(b.x,.025,b.z);worldGroup.add(m);return m;
    }
    if(b.tag==='clanwall'){renderClanWall(b);return null}
    // All other clan boxes remain collision-only. Their visible forms are custom-built in decorClan(),
    // which makes the world look like a completely separate game rather than reskinned Krunker geometry.
    const ghost=addBox(worldGroup,b,new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));ghost.visible=false;return ghost;
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
  // The rendered village is intentionally a separate stylized scene: bright tiled grass, chunky toy-like geometry,
  // rounded low-poly props, warm shadows and saturated resource colors rather than FPS-map boxes.
  clanTownHall(decorGroup,0,0,1.0);
  clanGoldStorage(decorGroup,-15,-15);clanGoldStorage(decorGroup,15,15);
  clanElixirStorage(decorGroup,-15,15);clanElixirStorage(decorGroup,15,-15);
  for(const [x,z] of [[-28,0],[28,0],[0,-28],[0,28]])clanArcherTower(decorGroup,x,z);
  clanCannon(decorGroup,-30,-8,.4);clanCannon(decorGroup,30,8,3.5);clanCannon(decorGroup,-8,30,2.1);clanCannon(decorGroup,8,-30,-1.0);
  clanMortar(decorGroup,-16,0);clanMortar(decorGroup,16,0);
  clanBarracks(decorGroup,0,-16,0);clanBarracks(decorGroup,0,16,Math.PI/2);
  clanCastle(decorGroup,-8,8);clanCastle(decorGroup,8,-8);
  clanWizardTower(decorGroup,-24,14);clanWizardTower(decorGroup,24,-14);
  clanCamp(decorGroup,-34,12);clanCamp(decorGroup,34,-12);
  clanCollector(decorGroup,-34,-12,false);clanCollector(decorGroup,34,12,true);
  // builder huts outside the walls
  for(const [x,z] of [[-30,-24],[30,24],[30,-24],[-30,24]]){
    clanBox(decorGroup,x,1.25,z,5.6,2.5,5.3,0x9a623d);clanRoof(decorGroup,x,3.45,z,4.1,2.5,0xc84c3d);clanBox(decorGroup,x+1.35,4.0,z-1.05,.55,1.7,.55,0x5d4638);
  }
  // dense decorative forest and shrubs around the playable village, matching the lush edge seen in village views
  const trees=[[-46,-40,1.1],[-40,-48,.9],[-28,-48,1.05],[-12,-48,.9],[7,-48,1.1],[25,-48,.9],[43,-42,1.05],[48,-26,.95],[48,-7,1.1],[48,14,.9],[45,35,1.05],[31,47,.95],[12,48,1.05],[-8,48,.9],[-28,47,1.0],[-44,37,.95],[-48,18,1.1],[-48,-4,.9],[-47,-24,1.0]];
  for(const [x,z,s] of trees)clanTree(decorGroup,x,z,s);
  for(const [x,z,s] of [[-38,4,.9],[-37,28,.75],[38,-31,.85],[38,25,.7],[-24,36,.8],[28,37,.85],[-38,-30,.75],[40,3,.8]])clanBush(decorGroup,x,z,s);
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
function updateStreamingWorld(force=false){if(!state.config)return;const world=state.config.worlds[state.world];if(!world||state.world==='voxel')return;const span=56;const anchor=state.playing?state.pos:camera.position;const cx=Math.floor(anchor.x/span),cz=Math.floor(anchor.z/span);const key=`${state.world}:${cx}:${cz}`;if(!force&&key===state.streamChunk)return;state.streamChunk=key;clearGroup(streamGroup);for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)addStreamChunk(world.theme,cx+dx,cz+dz,span)}

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
  addEventListener('mouseup',e=>{if(e.button===0)state.mouseDown=false;if(e.button===2)state.ads=false});addEventListener('wheel',e=>{if(state.world==='voxel'&&state.buildMode){e.preventDefault();state.blockIndex=(state.blockIndex+(e.deltaY>0?1:-1)+BLOCK_TYPES.length)%BLOCK_TYPES.length;updateBuildHud();}}, {passive:false});addEventListener('contextmenu',e=>e.preventDefault());
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
function toggleBuildMode(){if(state.world!=='voxel'){toast('Building is available in Voxel Frontier');return}state.buildMode=!state.buildMode;state.mouseDown=false;state.ads=false;updateBuildHud();updateWeaponVisibility();toast(state.buildMode?'Voxel tool mode: left click mine, right click place':'Combat mode')}
function cycleBlock(){if(state.world!=='voxel')return;state.blockIndex=(state.blockIndex+1)%BLOCK_TYPES.length;updateBuildHud();toast(`Block: ${BLOCK_TYPES[state.blockIndex]}`)}
function updateBuildHud(){const mode=$('#voxelMode');if(mode)mode.textContent=state.buildMode?'VOXEL TOOLS: MINE / PLACE':'COMBAT MODE';const bar=$('#blockHotbar');if(!bar)return;bar.innerHTML='';BLOCK_TYPES.forEach((t,i)=>{const d=document.createElement('div');d.className='block-slot'+(i===state.blockIndex?' active':'');d.style.background=BLOCK_COLORS[t];d.title=t;d.textContent=String(i+1);bar.appendChild(d)});$('#crosshair')?.classList.toggle('build-crosshair',state.buildMode)}

function enterGame(){state.playing=true;$('#menu').classList.remove('show');$('#hud').classList.remove('hidden');setGameplayActive(true);renderer.domElement.requestPointerLock()}
function showMenu(){state.playing=false;state.mouseDown=false;state.ads=false;state.buildMode=false;updateBuildHud();updateWeaponVisibility();$('#menu').classList.add('show');$('#hud').classList.add('hidden');setGameplayActive(false)}
function onKeyDown(e){
  if(e.code==='Enter'&&state.playing){e.preventDefault();toggleChat();return}if(state.chat){if(e.code==='Escape')toggleChat(false);return}state.keys[e.code]=true;
  if(e.code==='Tab'){e.preventDefault();$('#scoreboard').classList.remove('hidden')}if(e.code==='KeyR'&&!state.buildMode)reload();if(e.code==='KeyQ')wsSend({t:'melee'});if(e.code==='KeyB')toggleBuildMode();if(e.code==='KeyV')cycleBlock();if(e.code==='KeyE'&&state.buildMode)useBlock();if(e.code==='Escape'&&state.playing)showMenu();
  if(state.world==='voxel'&&state.buildMode&&/^Digit[1-7]$/.test(e.code)){state.blockIndex=Number(e.code.slice(5))-1;updateBuildHud()}
}
addEventListener('keyup',e=>{if(e.code==='Tab')$('#scoreboard').classList.add('hidden')});
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
  const r=.38,h=1.78;
  if(state.world==='voxel'){
    for(const b of voxelNearbyBlocks(x,z)){const minx=b.x-1-r,maxx=b.x+1+r,minz=b.z-1-r,maxz=b.z+1+r,miny=b.y-1,maxy=b.y+1;if(x>minx&&x<maxx&&z>minz&&z<maxz&&y+h>miny+.05&&y<maxy-.05)return b}return null;
  }
  for(const b of state.currentBoxes){const minx=b.x-b.w/2-r,maxx=b.x+b.w/2+r,minz=b.z-b.d/2-r,maxz=b.z+b.d/2+r,miny=b.y-b.h/2,maxy=b.y+b.h/2;if(x>minx&&x<maxx&&z>minz&&z<maxz&&y+h>miny+.05&&y<maxy-.05)return b}return null;
}
function groundHeightAt(x,z,currentY){
  if(state.world==='voxel'){
    // Use the player's footprint rather than shrinking every block. The previous +/-.2 inset created
    // invisible cracks exactly at voxel seams, which is why walking or jumping made the player fall through.
    const r=.34;let best=-18;
    for(const b of voxelNearbyBlocks(x,z)){const top=b.y+1;if(x+r>=b.x-1.001&&x-r<=b.x+1.001&&z+r>=b.z-1.001&&z-r<=b.z+1.001&&top<=currentY+.8&&top>best)best=top}
    return best;
  }
  let best=0;for(const b of state.currentBoxes){const top=b.y+b.h/2;if(x>b.x-b.w/2+.2&&x<b.x+b.w/2-.2&&z>b.z-b.d/2+.2&&z<b.z+b.d/2-.2&&top<=currentY+.4&&top>best)best=top}return best;
}
function physics(dt){
  if(!state.playing||!state.alive||state.chat)return;
  if(state.world==='voxel'&&state.dynamicBlocks.size===0)return;const cfg=state.config.classes[state.klass],fwd=new THREE.Vector3(-Math.sin(state.yaw),0,-Math.cos(state.yaw)),right=new THREE.Vector3(Math.cos(state.yaw),0,-Math.sin(state.yaw));let wish=new THREE.Vector3();if(state.keys.KeyW)wish.add(fwd);if(state.keys.KeyS)wish.sub(fwd);if(state.keys.KeyD)wish.add(right);if(state.keys.KeyA)wish.sub(right);if(wish.lengthSq())wish.normalize();
  const speedMult=cfg.speed,base=7.35*speedMult,horizontal=Math.hypot(state.vel.x,state.vel.z),shift=state.keys.ShiftLeft||state.keys.ShiftRight;
  if(state.grounded&&shift&&horizontal>4.2&&state.slide<=0){state.slide=.43;state.crouched=true;const boost=Math.min(15.8*speedMult,Math.max(base*1.22,horizontal*1.09));if(horizontal>0){state.vel.x=state.vel.x/horizontal*boost;state.vel.z=state.vel.z/horizontal*boost}}
  if(state.slide>0){state.slide-=dt;state.crouched=true;if(wish.lengthSq()){state.vel.x+=wish.x*4*dt;state.vel.z+=wish.z*4*dt}const drag=Math.pow(.72,dt);state.vel.x*=drag;state.vel.z*=drag}else state.crouched=shift&&state.grounded;
  const accel=state.grounded?34:12,target=base;if(state.slide<=0){if(wish.lengthSq()){state.vel.x+=wish.x*accel*dt;state.vel.z+=wish.z*accel*dt;const s=Math.hypot(state.vel.x,state.vel.z),cap=state.grounded?target*1.25:Math.max(target*1.2,state.speedBoost*target);if(s>cap){state.vel.x*=cap/s;state.vel.z*=cap/s}}else if(state.grounded){const fr=Math.max(0,1-9*dt);state.vel.x*=fr;state.vel.z*=fr}}
  const jump=state.keys.Space;if(jump&&!state.jumpLatch&&state.grounded){const s=Math.hypot(state.vel.x,state.vel.z);state.vel.y=7.4;state.grounded=false;state.jumpLatch=true;if(state.slide>0||state.landGrace>0){const n=Math.max(s,base);state.speedBoost=clamp(n/base*1.035,1,2.15);if(s>0){state.vel.x*=1.035;state.vel.z*=1.035}}state.slide=0}if(!jump)state.jumpLatch=false;if(!state.grounded)state.vel.y-=20.5*dt;state.landGrace=Math.max(0,state.landGrace-dt);
  const nx=state.pos.x+state.vel.x*dt,nz=state.pos.z+state.vel.z*dt;const bx=collidesAt(nx,state.pos.y,state.pos.z);if(!bx)state.pos.x=nx;else{if(cfg.wall_jump&&jump&&!state.grounded&&!state.jumpLatch){state.vel.y=7;state.vel.x*=-.42;state.jumpLatch=true}state.vel.x=0}const bz=collidesAt(state.pos.x,state.pos.y,nz);if(!bz)state.pos.z=nz;else{if(cfg.wall_jump&&jump&&!state.grounded&&!state.jumpLatch){state.vel.y=7;state.vel.z*=-.42;state.jumpLatch=true}state.vel.z=0}
  const prevY=state.pos.y;state.pos.y+=state.vel.y*dt;const gh=groundHeightAt(state.pos.x,state.pos.z,prevY+.2);if(state.pos.y<=gh&&state.vel.y<=0){if(!state.grounded){state.landGrace=.11;const s=Math.hypot(state.vel.x,state.vel.z);state.speedBoost=clamp(s/base,1,2.2)}state.pos.y=gh;state.vel.y=0;state.grounded=true}else state.grounded=false;if(state.pos.y<(state.world==='voxel'?-24:-8)){const reset=state.config.worlds[state.world].spawns[0]||[0,0,0];state.pos.set(reset[0],reset[1],reset[2]);state.vel.set(0,0,0)}$('#speed').textContent=Math.round(Math.hypot(state.vel.x,state.vel.z)*10);
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
  requestAnimationFrame(animate);const dt=Math.min(.033,clock?clock.getDelta():.016);frameCount++;fpsAcc+=dt;if(fpsAcc>1){$('#menuFps').textContent=`${Math.round(frameCount/fpsAcc)} FPS`;frameCount=0;fpsAcc=0}updateDayNight();updateStreamingWorld();updateCleanerBots(dt);if(stormRing)stormRing.rotation.y+=dt*.08;
  if(state.playing){physics(dt);camera.position.set(state.pos.x,state.pos.y+(state.crouched?1.18:1.62),state.pos.z);camera.rotation.set(state.pitch,state.yaw,0);const targetFov=state.ads&&!state.buildMode?Math.max(48,state.settings.fov*.68):state.settings.fov;camera.fov=lerp(camera.fov,targetFov,1-Math.pow(.001,dt));camera.updateProjectionMatrix();const sp=Math.hypot(state.vel.x,state.vel.z),bob=state.settings.bob&&state.grounded?Math.sin(performance.now()*.015)*Math.min(.014,sp*.0013):0;const adsX=state.ads&&!state.buildMode?-.32:.05,adsY=state.ads&&!state.buildMode?.02:-.02;if(weaponGroup){weaponGroup.position.x=lerp(weaponGroup.position.x,adsX,dt*12);weaponGroup.position.y=lerp(weaponGroup.position.y,adsY+bob,dt*12);weaponGroup.position.z=lerp(weaponGroup.position.z,0,dt*18);weaponGroup.rotation.x=lerp(weaponGroup.rotation.x,0,dt*16)}$('#crosshair').style.opacity=state.ads&&!state.buildMode?.28:1;netAcc+=dt;if(netAcc>.05){netAcc=0;wsSend({t:'state',x:state.pos.x,y:state.pos.y,z:state.pos.z,yaw:state.yaw,pitch:state.pitch,vx:state.vel.x,vy:state.vel.y,vz:state.vel.z})}if(state.mouseDown)shoot();
  }else{menuCamT+=dt*.13;const radius=state.world==='stadium'?25:16;camera.position.set(Math.sin(menuCamT)*radius,6+Math.sin(menuCamT*.55)*1.2,Math.cos(menuCamT)*radius);camera.lookAt(0,2,0);if(weaponGroup)weaponGroup.position.set(.05,-.02,0)}
  for(const r of state.remote.values()){r.group.position.lerp(r.target,1-Math.pow(.0008,dt));r.group.rotation.y=r.yaw}for(const r of state.mobs.values())r.group.position.lerp(r.target,1-Math.pow(.001,dt));for(const g of decorGroup.children){if(g.userData&&g.userData.billboard)g.lookAt(camera.position)}renderer.render(scene,camera);
}

boot().catch(err=>{console.error(err);document.body.insertAdjacentHTML('beforeend',`<div style="position:fixed;inset:20px;z-index:999;background:#200;color:#fff;padding:20px">Blockfront failed to start: ${esc(err.message||err)}</div>`)});
