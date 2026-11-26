import {
  Box3, Color, DirectionalLight, Group, HemisphereLight, Matrix4, Mesh, MeshStandardMaterial,
  OrthographicCamera, PCFShadowMap, PlaneGeometry, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { battleAtlas, factionDetailTexture } from './battle-materials.js';
import { battleLighting } from './battle-lighting.js';
import { cinematicEnvironment } from './cinematic-lighting.js';
import type { CinematicTracer } from './cinematic-tracer.js';
import { BattleModels, type BattleModel } from './models-3d.js';
import type { BlenderAssets } from './blender-assets.js';
import { poseRig } from './unit-rig.js';
import { ROSTERS } from './races.js';
import { RACES, RACE_NAMES, STATS, type Kind, type MobileKind, type Race, type Side } from './types.js';
import { dropdownMarkup,type Choice,type GameSelect } from './dropdown.js';
import { ResourceLoad,resourceProgressMarkup,updateResourceProgress } from './resource-loading.js';

/** 与战场共用几何、材质和骨骼，避免预览与实际单位产生两份事实来源。 */
export function modelGallery(root:HTMLElement,images:Map<string,HTMLImageElement>,assets:BlenderAssets,
  ensureModel?:(key:string,load:ResourceLoad)=>Promise<BlenderAssets>){
  const terrain=images.get('battle-materials'),units=images.get('unit-materials'),factions=images.get('faction-materials');
  if(!terrain||!units||!factions){
    root.textContent='当前设备未启用 3D 渲染，无法显示模型图鉴。';return ()=>{};
  }
  root.innerHTML=`
    <p class="dialog-description">拖动旋转、滚轮缩放。查看四个种族的部队、建筑与动作。</p>
    <div class="settings-row model-filters">
      <div class="field">种族${dropdownMarkup('model-race','种族',RACES.map(r=>[r,RACE_NAMES[r]]))}</div>
      <div class="field">分类${dropdownMarkup('model-category','分类',[['units','部队'],['buildings','建筑']])}</div>
      <div class="field model-object-field">对象${dropdownMarkup('model-kind','对象')}</div>
    </div>
    <div id="model-load-status" class="model-load-status" role="status" aria-live="polite" hidden></div>
    <div class="animation-stage model-stage"><canvas id="model-preview" aria-label="三维模型预览，可拖动旋转" tabindex="0"></canvas></div>
    <div class="model-lighting-row">
      <label class="toggle-label">高清实时光追<input type="checkbox" id="model-cinema"></label>
      <label class="toggle-label">实时降噪<input type="checkbox" id="model-denoise" checked disabled></label>
      <span class="room-note" id="model-lighting-status" role="status">实时光栅预览 · 勾选后开启高清实时光追</span>
    </div>
    <div class="settings-row model-filters">
      <div class="field">动作${dropdownMarkup('model-state','动作')}</div>
      <div class="field">玩家颜色${dropdownMarkup('model-team','玩家颜色',[['1','翡翠绿'],['2','赤红'],['3','天蓝'],['4','金黄']])}</div>
      <label class="toggle-label" id="model-packed-label" hidden>装配站收拢形态<input type="checkbox" id="model-packed"></label>
    </div>
    <p class="room-note" id="model-caption"></p>
    <div class="dialog-actions">
      <button class="secondary-button" id="model-play">暂停动作</button>
      <button class="secondary-button" id="model-step">下一帧</button>
      <button class="secondary-button" id="model-rotate" aria-pressed="false">自动旋转</button>
      <button class="secondary-button" id="model-reset">重置视角</button>
    </div>`;
  const get=<T extends HTMLElement>(id:string)=>root.querySelector<T>('#'+id)!;
  const race=get<GameSelect>('model-race'),category=get<GameSelect>('model-category');
  const kind=get<GameSelect>('model-kind'),state=get<GameSelect>('model-state'),team=get<GameSelect>('model-team');
  const packed=get<HTMLInputElement>('model-packed'),canvas=get<HTMLCanvasElement>('model-preview');
  let gl:WebGLRenderer;
  try{gl=new WebGLRenderer({canvas,antialias:true});}catch{
    root.textContent='当前设备无法创建 3D 预览，请关闭其他图形页面后重试。';return ()=>{};
  }
  gl.setPixelRatio(Math.min(devicePixelRatio,2));
  gl.shadowMap.enabled=true;gl.shadowMap.type=PCFShadowMap;
  const scene=new Scene();scene.background=new Color(0x151d24);
  const environment=battleLighting(gl,scene);
  const cinematicSky=cinematicEnvironment();scene.environment=cinematicSky;scene.environmentIntensity=.85;
  gl.toneMappingExposure=1.05;
  const anisotropy=gl.capabilities.getMaxAnisotropy(),detail=images.get('faction-detail');
  const atlas=battleAtlas(terrain,units,factions,anisotropy);
  const models=new BattleModels(atlas,detail&&factionDetailTexture(detail,anisotropy),assets);
  const camera=new OrthographicCamera(-70,70,55,-55,.1,1000);
  const controls=new OrbitControls(camera,canvas);
  controls.enablePan=false;controls.minZoom=.5;controls.maxZoom=3;
  controls.minPolarAngle=.2;controls.maxPolarAngle=Math.PI*.48;controls.autoRotateSpeed=1.4;
  const light=new DirectionalLight(0xffead1,3);
  light.position.set(-70,190,88);light.castShadow=true;
  light.shadow.mapSize.set(1024,1024);
  Object.assign(light.shadow.camera,{near:1,far:400});
  light.shadow.normalBias=.17;
  light.shadow.radius=4;
  const rim=new DirectionalLight(0xa0caff,1.45);
  rim.position.set(65,66,-110);
  scene.add(new HemisphereLight(0xd4e8ff,0x888578,1.15),light,rim);
  const floor=new Mesh(new PlaneGeometry(1600,1600),new MeshStandardMaterial({color:0x1b2831,roughness:.88}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.8;floor.receiveShadow=true;scene.add(floor);
  const holder=new Group();scene.add(holder);
  const cameraOffset=new Vector3(110,75,150),frameCenter=new Vector3(),frameSize=new Vector3();
  let model:BattleModel|undefined,playing=true,interacting=false,elapsed=0,last=0,request=0,span=100;
  controls.addEventListener('start',()=>{interacting=true;});
  controls.addEventListener('end',()=>{interacting=false;});
  let cinema:CinematicTracer|undefined,disposed=false,cinemaVersion=0,lastCinemaPose='';
  let selectionVersion=0,selectionLoad:ResourceLoad|undefined,loadingModel=false;
  const cinemaToggle=get<HTMLInputElement>('model-cinema'),lightingStatus=get('model-lighting-status');
  const denoiseToggle=get<HTMLInputElement>('model-denoise');
  denoiseToggle.onchange=()=>{if(cinema)cinema.denoise=denoiseToggle.checked;};
  const stopCinema=()=>{
    cinemaVersion++;cinema?.dispose();cinema=undefined;
    denoiseToggle.disabled=true;
    root.querySelector('#model-pathtrace')?.remove();
  };
  const startCinema=(forceWebGL=false)=>{
    stopCinema();
    const version=cinemaVersion;
    lightingStatus.textContent=forceWebGL?'切换到 WebGL 2 光追…':'初始化 GPU 光追…';
    void import('./cinematic-tracer.js').then(async({CinematicTracer})=>{
      if(disposed||version!==cinemaVersion)return;
      const overlay=document.createElement('canvas');overlay.id='model-pathtrace';overlay.hidden=true;
      overlay.setAttribute('aria-label','GPU 路径追踪模型预览');canvas.parentElement!.append(overlay);
      const pending=new CinematicTracer(overlay,lightingStatus,{forceWebGL});
      pending.denoise=denoiseToggle.checked;
      cinema=pending;
      await pending.init();
      if(disposed||version!==cinemaVersion){pending.dispose();return;}
      pending.capture(scene,span);
      denoiseToggle.disabled=false;
    }).catch(error=>{
      if(disposed||version!==cinemaVersion)return;
      if(!forceWebGL&&cinema?.backendId==='webgpu-bvh'){
        console.warn('WebGPU 光追捕获失败，切换到 WebGL 2 光追后备',error);
        startCinema(true);return;
      }
      stopCinema();cinemaToggle.checked=false;
      lightingStatus.textContent='此设备暂不能运行电影光追，已恢复实时预览。';
      console.warn('电影光追初始化失败',error);
    });
  };
  cinemaToggle.onchange=()=>{
    if(!cinemaToggle.checked){stopCinema();lightingStatus.textContent='实时光栅预览 · 勾选后开启高清实时光追';return;}
    startCinema(false);
  };
  const raceKind=()=>race.value as Race,unitKind=()=>kind.value as Kind;
  function resize(){
    const rect=canvas.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);
    gl.setPixelRatio(Math.min(devicePixelRatio,2));
    gl.setSize(width,height,false);
    const aspect=width/height,viewHeight=Math.max(36,1.35*Math.max(frameSize.y,frameSize.x/aspect));
    camera.left=-viewHeight*aspect/2;camera.right=-camera.left;camera.top=viewHeight/2;camera.bottom=-camera.top;
    camera.updateProjectionMatrix();
  }
  function reset(){
    camera.zoom=1;camera.position.copy(frameCenter).add(cameraOffset);controls.target.copy(frameCenter);
    controls.update();resize();
  }
  async function choose(){
    const version=++selectionVersion,key=`${raceKind()}:${unitKind()}${packed.checked?':packed':''}`;
    const status=get('model-load-status'),stage=canvas.parentElement!;
    selectionLoad?.dispose();
    status.hidden=false;status.innerHTML=resourceProgressMarkup();
    loadingModel=true;stage.setAttribute('aria-busy','true');
    const load=selectionLoad=new ResourceLoad(progress=>{
      if(!disposed&&version===selectionVersion)updateResourceProgress(status,progress);
    });
    try{
      if(ensureModel)await ensureModel(key,load);
      if(disposed||version!==selectionVersion)return;
      load.phase('准备模型预览');
    model?.rig?.skeleton.dispose();holder.clear();
    model=models.unit(unitKind(),Number(team.value) as Side,false,raceKind(),packed.checked);
    const states:Choice[]=packed.checked?[['idle','待机'],['move','移动']]:
      category.value==='buildings'?[['idle','待机'],['produce','生产']]:
      [['idle','待机'],['move','移动'],['attack','攻击'],['cast','施法'],['gather','采集 / 施工']];
    state.setOptions(states,state.value);
    holder.position.set(0,0,0);holder.add(model.root);holder.updateMatrixWorld(true);
    const bounds=new Box3().setFromObject(model.root),size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3());
    holder.position.set(-center.x,0,-center.z);
    holder.updateMatrixWorld(true);
    // 按默认视角下实际网格的投影取景，活动部件也计入画面边界。
    camera.position.copy(cameraOffset);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const viewBounds=new Box3(),meshToView=new Matrix4(),vertex=new Vector3();
    model.root.traverse(object=>{
      if(!(object instanceof Mesh))return;
      meshToView.multiplyMatrices(camera.matrixWorldInverse,object.matrixWorld);
      const count=object.geometry.getAttribute('position').count;
      for(let i=0;i<count;i++)viewBounds.expandByPoint(object.getVertexPosition(i,vertex).applyMatrix4(meshToView));
    });
    viewBounds.getCenter(frameCenter).applyMatrix4(camera.matrixWorld);
    viewBounds.getSize(frameSize);
    span=Math.max(size.y*1.46,Math.hypot(size.x,size.z)*1.02,36);
    const shadowSpan=Math.max(26,size.length()*.8);
    Object.assign(light.shadow.camera,{left:-shadowSpan,right:shadowSpan,top:shadowSpan,bottom:-shadowSpan});
    light.shadow.camera.updateProjectionMatrix();
    get('model-packed-label').hidden=unitKind()!=='assembly';
    get('model-caption').textContent=`${RACE_NAMES[raceKind()]} · ${STATS[unitKind()].name} / ${STATS[unitKind()].en} · ${STATS[unitKind()].description}`;
    canvas.dataset.kind=unitKind();canvas.dataset.race=raceKind();elapsed=0;reset();
    cinema?.capture(scene,span);
      status.hidden=true;
    }catch(error){
      if(disposed||version!==selectionVersion)return;
      status.textContent=(error as Error).message;
      const retry=document.createElement('button');retry.className='secondary-button';retry.textContent='重新加载';
      retry.onclick=()=>void choose();status.append(retry);
      model?.rig?.skeleton.dispose();model=undefined;holder.clear();
    }finally{
      load.dispose();
      if(version===selectionVersion){selectionLoad=undefined;loadingModel=false;stage.setAttribute('aria-busy','false');}
    }
  }
  function options(){
    const roster=ROSTERS[raceKind()],building=category.value==='buildings';
    const kinds:readonly Kind[]=building?['base',...roster.buildings]:roster.units;
    kind.setOptions(kinds.map(k=>[k,STATS[k].name]));
    state.setOptions([]);packed.checked=false;void choose();
  }
  race.onchange=options;category.onchange=options;
  kind.onchange=()=>{packed.checked=false;void choose();};team.onchange=()=>void choose();packed.onchange=()=>void choose();
  const play=get<HTMLButtonElement>('model-play');
  play.onclick=()=>{playing=!playing;play.textContent=playing?'暂停动作':'播放动作';};
  get('model-step').onclick=()=>{playing=false;play.textContent='播放动作';elapsed+=1/12;};
  get('model-reset').onclick=reset;
  get('model-rotate').onclick=()=>{
    controls.autoRotate=!controls.autoRotate;get('model-rotate').setAttribute('aria-pressed',String(controls.autoRotate));
  };
  const observer=new ResizeObserver(resize);observer.observe(canvas);
  function tick(now:number){
    if(loadingModel){last=now;request=requestAnimationFrame(tick);return;}
    // 跨屏移动或浏览器缩放可能只改变 DPR，不触发 ResizeObserver。
    if(gl.getPixelRatio()!==Math.min(devicePixelRatio,2))resize();
    const dt=last?Math.min((now-last)/1000,.05):0;last=now;if(playing)elapsed+=dt;
    const action=state.value,cycle=elapsed%1.5,moving=action==='move';
    if(model?.rig)poseRig(model.rig,unitKind() as MobileKind,{
      state:action==='produce'||action==='cast'?'idle':action as 'idle'|'move'|'attack'|'gather',
      time:elapsed,id:1,weight:moving?1:0,travel:moving?elapsed*40:0,
      aim:action==='attack'?.8:0,recoil:action==='attack'&&cycle<.3?Math.exp(-cycle*13):0,
      cast:action==='cast'?(Math.sin(elapsed*3)+1)/2:0,active:action==='produce',turn:0,animate:true,
    });
    if(model?.moving.length){
      const arm=model.moving[0];
      if(unitKind()==='oilwell')arm.rotation.z=action==='produce'?Math.sin(elapsed*2.4)*.18:0;
      else arm.rotation.y=elapsed*.25;
    }
    canvas.dataset.time=elapsed.toFixed(3);
    controls.update(dt);gl.render(scene,camera);
    const cinemaPose=`${elapsed}:${state.value}`;
    const poseChanging=playing||cinemaPose!==lastCinemaPose;
    try{cinema?.render(camera,poseChanging||interacting||controls.autoRotate,now,poseChanging);}catch(error){
      if(cinema?.backendId==='webgpu-bvh'){
        console.warn('WebGPU 光追渲染失败，切换到 WebGL 2 光追后备',error);
        startCinema(true);
      }else{
        stopCinema();cinemaToggle.checked=false;lightingStatus.textContent='光追已恢复为实时预览，请重新开启重试。';
        console.warn('电影光追渲染失败',error);
      }
    }
    lastCinemaPose=cinemaPose;
    request=requestAnimationFrame(tick);
  }
  options();request=requestAnimationFrame(tick);
  return ()=>{
    disposed=true;selectionVersion++;selectionLoad?.dispose();stopCinema();cancelAnimationFrame(request);observer.disconnect();controls.dispose();model?.rig?.skeleton.dispose();
    models.dispose();atlas.dispose();environment.dispose();cinematicSky.dispose();light.shadow.dispose();
    floor.geometry.dispose();floor.material.dispose();gl.dispose();gl.forceContextLoss();
  };
}
