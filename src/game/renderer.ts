import { maxShield } from './races.js';
import { factionProfile, factionPalette, factionGlyphs } from './faction-models.js';
import { FACTION_ATLAS_FILE, FACTION_DETAIL_FILE } from './battle-materials.js';
import { ABILITIES, statusLabels, type AbilityId } from './abilities.js';
import { getWorld } from './world.js';
import { assetPath } from './assets.js';
import { ART,drawCell,drawOilWell } from './art.js';
import { Camera,directionIndex,stableDirection,turnToward } from './camera.js';
import { oilNodeAt, OIL_PIPE_RANGE, OIL_PER_SECOND, visibleOilPipes } from './oil.js';
import { drawOilPipe,OIL_PIPE_PAINT,OIL_PIPE_NORMAL,OIL_PIPE_ROUGHNESS } from './oil-pipe-render.js';
import { isOutpost,isOutpostMap } from './outposts.js';
import { placementError,powerFor } from './engine.js';
import { buildingTiles,buildingSize,type BuildPlacement } from './building-layout.js';
import { STATS, RESOURCE_INFO, COLORS, isMobile, type ViewState, type Point, type Side, type Kind, type BuildingKind,BUILDING_KINDS,MOBILE_KINDS } from './types.js';
import { gridSize,TILE,distance,indexAt } from './pathfinding.js';
import { UnitMotion,deathPose,buildingPose,AnimationClock,animationFile,animationColumn } from './animation.js';
import { drawAtlasSprite } from './atlas-sprite.js';
import { DetailedTerrain } from './terrain-renderer.js';
import { drawTree } from './tree-renderer.js';
import type { BattleScene } from './battle-scene.js';
import type { LightingQuality } from './battle-gi.js';
import { harvestLand,isTree } from './resource-world.js';
import { t } from './locale.js';
import { PerformanceController,type PerformanceMode } from './performance.js';
export class Renderer {
  canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D;mini:HTMLCanvasElement;mctx:CanvasRenderingContext2D;
  private terrain!:DetailedTerrain;private clock=new AnimationClock();
  private world=getWorld();
  private cutTrees='';
  animate=true;
  miniTerrain=document.createElement('canvas');fog=document.createElement('canvas');fctx=this.fog.getContext('2d')!;
  private fogPixels!:ImageData;
  private fogView?:ViewState;
  images=new Map<string,HTMLImageElement>();camera=new Camera(gridSize(this.world.land)*TILE);width=0;height=0;
  private facings=new Map<number,{angle:number;direction:number}>();
  private positions=new Map<number,Point>();
  private lastDraw=0;
  private motion=new UnitMotion();
  private scene:BattleScene|null=null;
  readonly performance=new PerformanceController(matchMedia('(max-width:800px), (pointer:coarse)').matches);
  private preferredLighting:LightingQuality=innerWidth<700?'off':'balanced';
  get performanceMode(){return this.performance.mode;}
  set performanceMode(value:PerformanceMode){
    this.performance.setMode(value);this.applyPerformance();
    try{localStorage.setItem('fudancraft-performance',value);}catch{/* 本次设置仍然生效。 */}
  }
  get performanceStatus(){return `${this.performance.profile.name} · ${this.performance.fps} FPS 上限 · 光照 ${this.scene?.lightingQuality??'off'}`;}
  private applyPerformance(){
    const profile=this.performance.profile,rank=['off','balanced','high'];
    if(this.scene){this.scene.lightingQuality=rank[Math.min(rank.indexOf(this.preferredLighting),rank.indexOf(profile.gi))] as LightingQuality;this.scene.setShadowQuality(profile.shadow,profile.shadowHz);}
    this.resize();
  }
  samplePerformance(gap:number,cost:number,now:number,live:boolean){if(this.performance.sample(gap,cost,now,live))this.applyPerformance();}
  get is3D(){return this.scene!==null;}
  get supportsGI(){return this.scene?.supportsGI??false;}
  get lightingQuality(){return this.preferredLighting;}
  set lightingQuality(value:LightingQuality){
    this.preferredLighting=value;this.applyPerformance();
    try{localStorage.setItem('fudancraft-lighting',value);}catch{/* 隐私模式下设置仍对本次战局生效。 */}
  }
  get zoom(){return this.camera.zoom;}
  set zoom(value:number){this.camera.setZoomAt(value,{x:this.width/2,y:this.height/2},true);}
  selected=new Set<number>();side:Side=1;
  drag:{start:Point;end:Point}|null=null;marker:{p:Point;time:number;attack:boolean}|null=null;
  showHealth=true;showRanges=false;ready=false;hoverNode:number|null=null;selectedNode:number|null=null;
  placement:BuildPlacement|null=null;
  constructor(canvas:HTMLCanvasElement,mini:HTMLCanvasElement,private sceneCanvas:HTMLCanvasElement){
    this.canvas=canvas;this.ctx=canvas.getContext('2d')!;this.mini=mini;this.mctx=mini.getContext('2d')!;
    this.resizeFog();this.miniTerrain.width=256;this.miniTerrain.height=256;
    try{const mode=localStorage.getItem('fudancraft-performance');if(mode==='auto'||mode==='quality'||mode==='power')this.performance.setMode(mode);
      const lighting=localStorage.getItem('fudancraft-lighting');if(lighting==='off'||lighting==='balanced'||lighting==='high')this.preferredLighting=lighting;}catch{/* 使用设备默认值。 */}
    new ResizeObserver(()=>this.resize()).observe(canvas);
    sceneCanvas.addEventListener('webglcontextlost',()=>{
      this.scene=null;sceneCanvas.hidden=true;this.camera.orient(0,1);
      canvas.dispatchEvent(new Event('renderermodechange'));
    });
  }
  async load(){
    const animationArt=Object.fromEntries(MOBILE_KINDS.map(k=>[`animation-${k}`,animationFile(k)]));
    const extras=Object.fromEntries(['trees','building-construction','building-damage','building-production','ground-grass','ground-earth','effects'].map(k=>[k,assetPath(`generated/animation-${k}-v4.png`)]));
    const loadImage=(name:string,url:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>{this.images.set(name,image);resolve(image);};
      image.onerror=()=>reject(Error(`无法加载素材 ${name}`));
      image.src=url;
    });
    await Promise.all(Object.entries({...ART,...animationArt,...extras,'oil-pipe-paint':assetPath(OIL_PIPE_PAINT)}).map(([name,url])=>loadImage(name,url)));
    this.terrain=new DetailedTerrain(this.images,this.world);this.terrain.overview(this.miniTerrain);
    try{
      const context=this.sceneCanvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance'});
      if(context){
        const [{BattleScene},atlas,unitAtlas,factionAtlas,factionDetail,pipeNormal,pipeRoughness]=await Promise.all([
          import('./battle-scene.js'),
          loadImage('battle-materials',assetPath('generated/battle-materials.webp')),
          loadImage('unit-materials',assetPath('generated/unit-materials.webp')),
          loadImage('faction-materials',assetPath(FACTION_ATLAS_FILE)),
          loadImage('faction-detail',assetPath(FACTION_DETAIL_FILE)).catch(()=>undefined),
          loadImage('oil-pipe-normal',assetPath(OIL_PIPE_NORMAL)),
          loadImage('oil-pipe-roughness',assetPath(OIL_PIPE_ROUGHNESS)),
        ]);
        if(!context.isContextLost()){
          this.scene=new BattleScene(this.sceneCanvas,context,atlas,unitAtlas,factionAtlas,
            {paint:this.images.get('oil-pipe-paint')!,normal:pipeNormal,roughness:pipeRoughness},this.world,factionDetail);
          try{
            const saved=localStorage.getItem('fudancraft-lighting');
            if(saved==='off'||saved==='balanced'||saved==='high')this.preferredLighting=saved;
          }catch{/* 不依赖本地存储才能启动战场。 */}
          this.scene.orient(this.camera);
          this.applyPerformance();
          this.sceneCanvas.hidden=false;
        }
      }
    }catch(error){
      console.warn('3D 战场启动失败，已启用 2D 渲染。',error);
    }
    this.ready=true;
  }
  resize(){
    const r=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,this.performance.profile.ratio);
    if(r.width!==this.width||r.height!==this.height){this.width=r.width;this.height=r.height;this.camera.resize(r.width,r.height);}
    if(this.canvas.width!==Math.round(r.width*dpr)||this.canvas.height!==Math.round(r.height*dpr)){this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);}
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  focus(p:Point){this.camera.focus(p);}
  clamp(){this.camera.clamp();}
  screenToWorld(p:Point):Point{return this.camera.screenToWorld(p);}
  pan(dx:number,dy:number){this.camera.panScreen(dx,dy);}
  zoomAt(factor:number,point:Point){this.camera.zoomBy(factor,point);}
  orbit(direction:number){this.scene?.orient(this.camera,(this.camera.yaw+direction*Math.PI/6)%(2*Math.PI));}
  pick(point:Point){return this.scene?.pick(point,this.camera)??null;}
  projectUnit(unit:ViewState['units'][number]){
    const anchor=this.scene?.unitAnchor(unit);
    return anchor?this.camera.worldToScreen(anchor.point,(anchor.top+anchor.ground)*.5):this.camera.worldToScreen(unit);
  }
  reset(){this.scene?.reset();this.selectedNode=null;this.hoverNode=null;this.positions.clear();this.facings.clear();this.motion=new UnitMotion();this.cutTrees='';this.terrain?.overview(this.miniTerrain);}
  skillPreview:{origin:Point;range:number;radius?:number;point:Point|null}|null=null;
  sprite(c:CanvasRenderingContext2D,kind:Kind,x:number,y:number,size=STATS[kind].size,direction?:number,row=0){
    const profile=factionProfile(kind);
    if(profile){
      const [form,role]=profile;c.save();c.translate(x,y);c.fillStyle='#15292a';c.strokeStyle=factionPalette[form];c.lineWidth=2;
      c.beginPath();c.ellipse(0,-size*.13,size*.28,size*.25,0,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle=factionPalette[form];c.font=`${Math.round(size*.35)}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(factionGlyphs[role],0,-size*.11);c.restore();return;
    }
    if(kind==='oilwell'){drawOilWell(c,x,y,size);return;}
    if(direction!==undefined&&isMobile({kind})){
      drawAtlasSprite(c,this.images,`animation-${kind}`,row*8+animationColumn(kind as typeof MOBILE_KINDS[number],direction),x,y+5,size);return;
    }
    const s=STATS[kind],img=this.images.get(s.atlas)!,h=size*img.naturalHeight/img.naturalWidth;
    drawCell(c,img,3,3,s.cell,x-size/2,y-h*.72,size,h);
  }
  private resizeFog(){
    const size=gridSize(this.world.land);
    this.fog.width=this.fog.height=size;
    this.fogPixels=this.fctx.createImageData(size,size);
    this.fogView=undefined;
  }
  setWorld(v:Pick<ViewState,'mapId'|'mapRevision'>){
    if(this.world.id===v.mapId&&this.world.revision===(v.mapRevision??1))return;
    this.world=getWorld(v.mapId,v.mapRevision??1);
    this.camera.world=gridSize(this.world.land)*TILE;
    this.camera.resize(this.camera.width,this.camera.height);
    this.resizeFog();
    if(this.ready){
      this.terrain=new DetailedTerrain(this.images,this.world);
      this.terrain.overview(this.miniTerrain);
      this.scene?.setWorld(this.world);
    }
    this.cutTrees='';
  }
  draw(v:ViewState,now:number){
    this.setWorld(v);this.resize();const dt=this.lastDraw?Math.min(.1,(now-this.lastDraw)/1000):0;this.lastDraw=now;this.camera.advance(dt);this.clamp();const c=this.ctx,w=this.width,h=this.height;if(!this.ready||!w||!h)return;
    const cut=v.nodes.filter(n=>n.tree!==undefined&&n.amount<=0).map(n=>n.id).join(',');
    if(cut!==this.cutTrees){
      this.cutTrees=cut;
      this.terrain.overview(this.miniTerrain,harvestLand(this.world,v.nodes));
    }
    if(this.scene){
      c.clearRect(0,0,w,h);
      this.scene.draw(v,this.camera,this.canvas.width/w,now,dt,this.animate,this.side,this.placement,this.selected,this.hoverNode,this.selectedNode,this.showRanges);
      this.draw3DOverlay(v,now,this.scene);
      this.drawSkillEffects(v,point=>point);
    this.updateFog(v);
      this.drawMini(v);
      return;
    }
    c.fillStyle='#10271d';c.fillRect(0,0,w,h);
    const left=this.camera.x-w/this.zoom/2,top=this.camera.y-h/this.zoom/2,viewport={x:left,y:top,w:w/this.zoom,h:h/this.zoom};
    c.save();c.translate(w/2,h/2);c.scale(this.zoom,this.zoom);c.translate(-this.camera.x,-this.camera.y);c.imageSmoothingEnabled=true;
    this.terrain.draw(c,viewport,this.zoom,this.canvas.width/w);
    const time=this.clock.advance(v.time,dt,!!v.winner),ambient=this.animate?now/1000:0;
    const events=v.events||[];
    const producing=new Set<number>(v.units.filter(u=>u.activity==='produce').map(u=>u.id));for(const p of v.players){const power=powerFor(p.side,v.units);for(const q of p.queue){const producer=v.units.find(u=>u.id===q.producer);if(producer&&(producer.kind==='base'||power.active))producing.add(producer.id);}}

    const inView=(p:Point,margin=170)=>p.x>left-margin&&p.y>top-margin&&p.x<left+w/this.zoom+margin&&p.y<top+h/this.zoom+margin;
    const nature=this.images.get('nature')!;
    const objects:{y:number;draw:()=>void}[]=[];
    const wells=v.units.filter(u=>u.kind==='oilwell');
    const covered=new Set(wells.map(well=>oilNodeAt(well,v.nodes)?.id));
    for(const {well,refinery} of visibleOilPipes(v))if(inView(well,500)||inView(refinery,500))
      drawOilPipe(c,this.images.get('oil-pipe-paint')!,well,refinery,this.world.land);
    for(const f of this.world.features)if(inView(f)&&!(this.world.deposits&&isTree(f))&&!['water','grass','flower','stump','fern'].includes(f.kind))objects.push({y:f.y,draw:()=>{
      const row=['pine','oak','birch','bush'].indexOf(f.kind);
      if(row>=0)drawTree(c,this.images,row,f.x,f.y+5,f.size,this.animate?ambient:null);
      else drawCell(c,nature,4,4,f.cell,f.x-f.size/2,f.y-f.size*.76,f.size);
    }});
    for(const e of events)if(e.type==='death'&&inView(e)){
      const age=time-e.time;if(age<0||age>=3.2)continue;
      objects.push({y:e.y,draw:()=>{const pose=deathPose(age),size=STATS[e.kind].size;c.globalAlpha=pose.alpha;
        if(isMobile(e))this.sprite(c,e.kind,e.x,e.y,size,directionIndex(e.angle),pose.row);
        else if(e.kind==='oilwell')drawOilWell(c,e.x,e.y,size,.4,.3);
        else if(factionProfile(e.kind))this.sprite(c,e.kind,e.x,e.y,size);
        else drawAtlasSprite(c,this.images,'building-damage',BUILDING_KINDS.findIndex(k=>k===e.kind as BuildingKind)*4+3,e.x,e.y+6,size);
        if(age<.6)this.effect(c,0,age/.6,e.x,e.y-12,size*.9);c.globalAlpha=1;
      }});
    }
    for(const node of v.nodes)if(inView(node)&&!covered.has(node.id))objects.push({y:node.y,draw:()=>{
      const f=node.tree===undefined?undefined:this.world.features[node.tree];
      const s=f?.size??(node.kind==='wood'?143:node.kind==='gold'?112:126),info=RESOURCE_INFO[node.kind],hover=this.hoverNode===node.id||this.selectedNode===node.id;
      if(node.amount<=0){c.globalAlpha=.45;drawCell(c,nature,4,4,node.kind==='wood'?14:4,node.x-28,node.y-25,56);c.globalAlpha=1;return;}
      if(node.kind==='wood')drawTree(c,this.images,f?['pine','oak','birch'].indexOf(f.kind):1,node.x,node.y+5,s,this.animate?ambient:null);
      else drawCell(c,nature,4,4,info.cell,node.x-s/2,node.y-s*.75,s);
      if(node.tree===undefined||hover){c.font='9px monospace';c.textAlign='center';c.fillStyle='#09170edc';c.fillRect(node.x-36,node.y+20,72,17);c.fillStyle=info.color;c.fillText(`${info.symbol} ${node.tree===undefined?`${Math.ceil(node.amount/1000)}k`:Math.ceil(node.amount)}`,node.x,node.y+32);}
      if(hover){c.fillStyle='#e5e8d8';c.font='10px sans-serif';c.fillText(t(`${info.name} · ${node.kind==='oil'&&v.oilWells?'建造油井':'右键采集'}`),node.x,node.y-s*.7-7);}
    }});
    const alive=new Set(v.units.map(u=>u.id));this.motion.prune(alive);for(const id of this.facings.keys())if(!alive.has(id))this.facings.delete(id);for(const id of this.positions.keys())if(!alive.has(id))this.positions.delete(id);
    for(const stateUnit of v.units){
      const last=this.positions.get(stateUnit.id);const mix=1-Math.exp(-30*dt);
      const position=last&&distance(last,stateUnit)<160?{x:last.x+(stateUnit.x-last.x)*mix,y:last.y+(stateUnit.y-last.y)*mix}:{x:stateUnit.x,y:stateUnit.y};
      this.positions.set(stateUnit.id,position);const u={...stateUnit,...position};
      if(!inView(u))continue;
      objects.push({y:u.y+(STATS[u.kind].air?1000:0),draw:()=>{
      const s=STATS[u.kind],selected=this.selected.has(u.id),owner=v.players.find(p=>p.side===u.side)!,hp=u.maxHp;
      if(selected){
        if(u.path.length){c.strokeStyle=u.kind==='worker'?'#e2c67b65':'#b3edce55';c.lineWidth=1;c.setLineDash([3,8]);c.beginPath();c.moveTo(u.x,u.y);for(const p of u.path)c.lineTo(p.x,p.y);c.stroke();c.setLineDash([]);}
      }
      c.fillStyle='#0003';c.beginPath();c.ellipse(u.x+6,u.y+8,s.radius*.9,s.radius*.35,0,0,Math.PI*2);c.fill();
      if(u.construction<1){c.strokeStyle='#c6e0bc8c';c.lineWidth=1;c.setLineDash([5,4]);c.strokeRect(u.x-s.radius,u.y-s.radius,s.radius*2,s.radius*2);c.setLineDash([]);}
      let direction:number|undefined;
      if(isMobile(u)){const f=this.facings.get(u.id)||{angle:u.angle,direction:directionIndex(u.angle)};f.angle=turnToward(f.angle,u.angle,dt*(s.air?7:u.kind==='tank'||u.kind==='artillery'?4:10));f.direction=stableDirection(f.angle,f.direction);this.facings.set(u.id,f);direction=f.direction;}
      if(isMobile(u)){
        const pose=this.motion.pose(u,time,dt),air=s.air?Math.sin(ambient*2+u.id)*3-11:0;
        c.save();c.translate(u.x,u.y+5+air);c.scale(1,this.animate?pose.stretch:1);
        this.sprite(c,u.kind,0,-5,s.size,direction,this.animate?pose.row:0);c.restore();
        if(this.animate&&(pose.state==='gather'||pose.state==='build'))this.effect(c,pose.state==='build'?2:3,(time*1.7+u.id*.17)%1,u.x+Math.cos(u.angle)*20,u.y-12+Math.sin(u.angle)*12,33);
      }else{
        const pose=buildingPose(u,hp,producing.has(u.id),this.animate?time:0);
        if(u.kind==='oilwell')drawOilWell(c,u.x,u.y,s.size,this.animate&&u.activity==='produce'?Math.sin(time*2.4)*.18:0,u.construction);
        else if(factionProfile(u.kind))this.sprite(c,u.kind,u.x,u.y,s.size);
        else drawAtlasSprite(c,this.images,pose.atlas,BUILDING_KINDS.findIndex(k=>k===u.kind as BuildingKind)*4+pose.frame,u.x,u.y+6,s.size);
        if(this.animate&&u.construction<1&&v.units.some(w=>w.activity==='build'&&w.target===u.id))this.effect(c,2,(time*1.4+u.id*.21)%1,u.x,u.y-8,s.size*.8);
        if(this.animate&&u.construction===1&&u.hp/hp<.5)this.effect(c,1,(time*1.5+u.id*.17)%1,u.x+13,u.y-s.size*.36,s.size*.7);
        if(producing.has(u.id)){const q=owner.queue.find(q=>q.producer===u.id);if(q){c.fillStyle='#071810';c.fillRect(u.x-29,u.y+35,58,5);c.fillStyle='#8ce2cc';c.fillRect(u.x-29,u.y+36,58*(1-q.remaining/q.duration),3);}}
      }
      c.globalAlpha=1;
      c.fillStyle=COLORS[u.side];c.fillRect(u.x-7,u.y+14,14,2);
      if(u.kind==='worker'&&u.cargo>0){c.fillStyle=RESOURCE_INFO[u.cargoKind||'gold'].color;c.fillRect(u.x-11,u.y+19,22*u.cargo/(owner.tech.includes('logistics')?150:100),3);}
      if(this.showHealth&&(selected||u.hp<hp-1)){const bw=isMobile(u)?30:52,yy=u.y-s.size*(isMobile(u)?.65:.49)-10;c.fillStyle='#09150fcc';c.fillRect(u.x-bw/2-1,yy-1,bw+2,5);c.fillStyle=u.hp/hp>.35?COLORS[u.side]:'#ec8d68';c.fillRect(u.x-bw/2,yy,bw*Math.min(1,u.hp/hp),3);}
      if(u.construction<1){c.fillStyle='#0a160e';c.fillRect(u.x-33,u.y+24,66,5);c.fillStyle='#e2c78e';c.fillRect(u.x-33,u.y+25,66*u.construction,3);c.fillStyle='#e2d6ac';c.font='9px monospace';c.textAlign='center';c.fillText(t(`建造 ${Math.floor(u.construction*100)}%`),u.x,u.y+43);}
      else if(!isMobile(u)){c.fillStyle=u.side===this.side?'#d6e4ca':'#f1aaa2';c.font='9px sans-serif';c.textAlign='center';c.fillText(t(s.name),u.x,u.y+30);}
    }});
    }
    // 2D 也先绘制全部地面标记，再画任何模型，避免圈线越过邻近单位。
    const ring=(p:Point,radius:number,color:string)=>{
      c.strokeStyle=color;c.lineWidth=1.5;c.beginPath();c.ellipse(p.x,p.y+5,radius,radius*.45,0,0,Math.PI*2);c.stroke();
    };
    for(const node of v.nodes)if(node.amount>0&&inView(node)&&(node.id===this.hoverNode||node.id===this.selectedNode))ring(node,node.radius+12,RESOURCE_INFO[node.kind].color);
    for(const unit of v.units)if(this.selected.has(unit.id)&&inView(unit)){
      const stat=STATS[unit.kind],p=this.positions.get(unit.id)??unit;
      const size=isMobile(unit)?null:buildingSize(unit.kind as BuildingKind);
      ring(p,size?Math.hypot(size.width,size.depth)/2+6:Math.max(stat.radius+6,stat.size*.37),COLORS[unit.side]);
      if(this.showRanges&&stat.range)ring(p,stat.range,'#b3edce44');
    }
    objects.sort((a,b)=>a.y-b.y).forEach(o=>o.draw());
    if(this.animate)for(const e of events){const age=time-e.time;if(age<0||!inView(e))continue;
      if(e.type==='impact'&&age<.35)this.effect(c,0,age/.35,e.x,e.y-12,e.kind==='artillery'?100:e.kind==='tank'?67:25);
      if(e.type==='heal'&&age<.4)this.effect(c,3,age/.4,e.x,e.y-12,32);
      if((e.type==='spawn'||e.type==='complete')&&age<.9)this.effect(c,3,age/.9,e.x,e.y-20,STATS[e.kind].size*.8);
    }
    for(const shot of v.shots){
      const duration=shot.duration??.3,t=Math.max(0,Math.min(1,shot.firedAt!==undefined?(time-shot.firedAt)/duration:1-shot.life/duration));
      c.strokeStyle=shot.kind==='medic'?'#9afcb6':shot.kind==='artillery'||shot.kind==='tank'?'#ffd486':shot.side===this.side?'#daffe4':'#ffad92';c.lineWidth=shot.kind==='medic'?2:1.4;
      c.shadowBlur=5;c.shadowColor=c.strokeStyle;
      if(shot.mode==='shell'){
        const x=shot.x+(shot.tx-shot.x)*t,y=shot.y+(shot.ty-shot.y)*t-12-Math.sin(t*Math.PI)*(shot.kind==='artillery'?48:16),back=Math.max(0,t-.045);
        c.beginPath();c.moveTo(shot.x+(shot.tx-shot.x)*back,shot.y+(shot.ty-shot.y)*back-12-Math.sin(back*Math.PI)*(shot.kind==='artillery'?48:16));c.lineTo(x,y);c.stroke();
        c.fillStyle='#fff1b7';c.beginPath();c.arc(x,y,shot.kind==='artillery'?3:2,0,Math.PI*2);c.fill();
      }else{
        c.globalAlpha=1-t;c.beginPath();c.moveTo(shot.x,shot.y-12);c.lineTo(shot.tx,shot.ty-12);c.stroke();c.globalAlpha=1;
      }
      c.shadowBlur=0;
    }
    this.drawSkillEffects(v,point=>point);
    this.updateFog(v);c.drawImage(this.fog,0,0,this.camera.world,this.camera.world);
    if(this.placement){const {kind,point:p}=this.placement;c.globalAlpha=.55;this.sprite(c,kind,p.x,p.y);c.globalAlpha=1;this.drawFootprint(v,p=>p);}
    const player=v.players.find(p=>p.side===this.side);if(player?.rally){const p=player.rally;c.strokeStyle='#adf0c7';c.lineWidth=2;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x,p.y-28);c.lineTo(p.x+19,p.y-22);c.lineTo(p.x,p.y-16);c.stroke();}
    if(this.marker&&now-this.marker.time<900){const t=(now-this.marker.time)/900,p=this.marker.p;c.globalAlpha=1-t;c.strokeStyle=this.marker.attack?'#ff9789':'#c1ffcf';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,8+20*t,0,Math.PI*2);c.stroke();c.globalAlpha=1;}
    c.restore();this.drawDrag();this.drawMini(v);
  }
  private updateFog(v:ViewState){
    if(v.visible===this.fogView?.visible&&v.explored===this.fogView.explored)return;
    this.fogView=v;
    const pixels=this.fogPixels;
    for(let i=0;i<this.world.land.length;i++){
      pixels.data[i*4]=6;pixels.data[i*4+1]=17;pixels.data[i*4+2]=13;pixels.data[i*4+3]=v.visible[i]?0:v.explored[i]?165:248;
    }
    this.fctx.putImageData(pixels,0,0);
  }
  private drawDrag(){
    if(!this.drag||distance(this.drag.start,this.drag.end)<=4)return;
    const c=this.ctx,{start:a,end:b}=this.drag;
    c.strokeStyle='#baffd4';c.fillStyle='#baffd424';c.lineWidth=1;
    c.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
  }
  private drawFootprint(view:ViewState,project:(p:Point)=>Point){
    if(!this.placement)return;
    const c=this.ctx,{kind,point,facing}=this.placement;
    const valid=!placementError(this.side,kind,point,view.units,view.nodes,view.visible,facing,harvestLand(this.world,view.nodes),view.oilWells);
    if(view.oilWells&&kind==='refinery'){
      const outline=(center:Point,radius:number,color:string)=>{
        c.strokeStyle=color;c.lineWidth=2;c.beginPath();
        for(let i=0;i<=64;i++){
          const angle=i/64*2*Math.PI;
          const p=project({x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius});
          if(i===0)c.moveTo(p.x,p.y);else c.lineTo(p.x,p.y);
        }
        c.stroke();
      };
      outline(point,OIL_PIPE_RANGE,valid?'#86dce7bc':'#e88774ad');
      const size=gridSize(this.world.land);
      for(const node of view.nodes){
        if(node.kind==='oil'&&node.amount>0&&view.visible[indexAt(node,size)]&&distance(point,node)<=OIL_PIPE_RANGE)
          outline(node,node.radius+12,'#b2f5ff');
      }
    }
    const cells=buildingTiles(kind,point,facing);
    const occupied=new Set(cells.map(p=>`${p.x},${p.y}`));
    const edges=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
    c.fillStyle=valid?'#a5edca29':'#f68e7839';c.strokeStyle=valid?'#a5edca':'#f68e78';c.lineWidth=1.5;
    for(const cell of cells){
      const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(p=>project({x:(cell.x+p.x)*TILE,y:(cell.y+p.y)*TILE}));
      c.beginPath();c.moveTo(corners[0].x,corners[0].y);
      for(const p of corners.slice(1))c.lineTo(p.x,p.y);
      c.closePath();c.fill();
      c.beginPath();
      edges.forEach((edge,i)=>{
        if(occupied.has(`${cell.x+edge.x},${cell.y+edge.y}`))return;
        const from=corners[i],to=corners[(i+1)%4];
        c.moveTo(from.x,from.y);c.lineTo(to.x,to.y);
      });
      c.stroke();
    }
  }
  private drawSkillEffects(view:ViewState,project:(p:Point)=>Point){
    const c=this.ctx,size=this.world.land.length**.5;
    const visible=(p:Point)=>!!view.visible[Math.floor(p.y/32)*size+Math.floor(p.x/32)];
    const colors:Partial<Record<AbilityId,string>>={'IND-04':'#b5c3a4','BIO-06':'#e992bd','ENE-05':'#91c7ff','RLY-01':'#f9c476','RLY-03':'#ffe59c'};
    const outline=(center:Point,radius:number,color:string,clip=false)=>{
      c.strokeStyle=color;c.beginPath();let drawing=false;
      for(let index=0;index<=64;index++){
        const a=index*Math.PI/32,world={x:center.x+radius*Math.cos(a),y:center.y+radius*Math.sin(a)};
        const p=project(world),show=!clip||visible(world);
        if(show){if(drawing)c.lineTo(p.x,p.y);else c.moveTo(p.x,p.y);}
        drawing=show;
      }
      c.stroke();
    };
    c.save();c.lineWidth=1.7;
    for(const area of view.areas??[]){
      c.setLineDash(area.skill==='ENE-05'?[]:[6,4]);
      outline(area,area.radius,colors[area.skill]??'#beecd0',true);
      if(visible(area)){
        const p=project(area);c.fillStyle=colors[area.skill]??'#beecd0';c.font='11px sans-serif';c.textAlign='center';
        c.fillText(ABILITIES[area.skill].name+' '+Math.ceil(area.until-view.time)+'s',p.x,p.y);
      }
    }
    for(const edge of view.areaEdges??[]){
      c.setLineDash(edge.skill==='ENE-05'?[]:[6,4]);c.strokeStyle=colors[edge.skill]??'#beecd0';
      const a=project(edge.start),b=project(edge.end);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
    }
    for(const u of view.units){
      const cast=u.ability?.cast;
      if(cast)outline(u,STATS[u.kind].radius+7,'#f6e5b4',true);
      const point=cast?.point;
      if(point&&visible(point))outline(point,ABILITIES[cast.skill].radius??16,'#ffd17a',true);
      if(u.ability?.effects.some(s=>s.group==='root'&&s.until>view.time))outline(u,STATS[u.kind].radius+4,'#fa9bc4',true);
    }
    const preview=this.skillPreview;
    if(preview){
      c.setLineDash([5,5]);outline(preview.origin,preview.range,'#abf4c9');
      if(preview.radius&&preview.point)outline(preview.point,preview.radius,'#f9d399');
    }
    c.restore();
  }
  private draw3DOverlay(view:ViewState,now:number,scene:BattleScene){
    const c=this.ctx,zoom=this.zoom;
    const project=(p:Point,y=0)=>this.camera.worldToScreen(p,y);
    this.drawSkillEffects(view,p=>project(p));
    const onScreen=(p:Point)=>p.x>-130&&p.x<this.width+130&&p.y>-130&&p.y<this.height+130;
    const ring=(p:Point,radius:number,color:string,line=1,y=0)=>{
      const center=project(p,y),r=radius*zoom;
      c.strokeStyle=color;c.lineWidth=line;c.beginPath();
      c.ellipse(center.x,center.y,r,r*this.camera.tilt,0,0,Math.PI*2);c.stroke();
    };
    const text=(value:string,p:Point,color:string,bg='#0d1e19d8')=>{
      value=t(value);
      c.font='10px Inter, sans-serif';c.textAlign='center';c.textBaseline='middle';
      const width=c.measureText(value).width+12;
      c.fillStyle=bg;c.fillRect(p.x-width/2,p.y-7,width,14);
      c.fillStyle=color;c.fillText(value,p.x,p.y+.5);
    };
    const bar=(p:Point,width:number,fraction:number,color:string)=>{
      c.fillStyle='#0a1813ed';c.fillRect(p.x-width/2-1,p.y-1,width+2,5);
      c.fillStyle=color;c.fillRect(p.x-width/2,p.y,width*Math.min(1,Math.max(0,fraction)),3);
    };
    const healthBars:{point:Point;width:number;fraction:number;side:Side;selected:boolean}[]=[];
    const player=view.players.find(p=>p.side===this.side);
    const queues=new Map(view.players.flatMap(p=>p.queue.map(q=>[q.producer,q] as const)).reverse());
    const covered=new Set(view.units.filter(u=>u.kind==='oilwell').map(well=>oilNodeAt(well,view.nodes)?.id));
    for(const node of view.nodes){
      if(node.amount<=0||covered.has(node.id))continue;
      const ground=project(node);
      if(!onScreen(ground))continue;
      const info=RESOURCE_INFO[node.kind],hover=node.id===this.hoverNode||node.id===this.selectedNode;
      if(node.tree===undefined||hover)text(`${info.symbol} ${node.tree===undefined?`${Math.ceil(node.amount/1000)}k`:Math.ceil(node.amount)}`,{x:ground.x,y:ground.y+node.radius*zoom*this.camera.tilt+7},info.color);
      if(hover){
        const above=project(node,scene.nodeHeight(node.id));
        text(`${info.name} · ${node.kind==='oil'&&view.oilWells?'建造油井':'右键采集'}`,{x:above.x,y:above.y-11},'#f0f4d9');
      }
    }
    for(const unit of view.units){
      const {point,ground}=scene.unitAnchor(unit), stat=STATS[unit.kind];
      const p=project(point,ground), selected=this.selected.has(unit.id), mobile=isMobile(unit);
      if(!onScreen(p))continue;
      if(selected){
        if(unit.path.length){
          const start=project(point);
          c.strokeStyle=unit.kind==='worker'?'#f0cb7c96':'#c4ffe288';c.lineWidth=1;
          c.setLineDash([4,6]);c.beginPath();c.moveTo(start.x,start.y);
          for(const waypoint of unit.path){const next=project(waypoint);c.lineTo(next.x,next.y);}
          c.stroke();c.setLineDash([]);
        }
      }
      const native=maxShield(unit),effects=unit.ability?.effects.filter(s=>s.until>view.time)??[],temp=effects.find(s=>s.group==='barrier');
      if(this.showHealth&&(selected||unit.hp<unit.maxHp||temp||native&&(unit.shield??0)<native)){
        const anchor=scene.healthAnchor(unit,this.camera);
        const width=(mobile?Math.max(26,Math.min(40,stat.size*.45)):Math.max(40,Math.min(54,stat.size*.29)))*Math.max(.8,Math.min(1.1,zoom));
        healthBars.push({point:{x:anchor.x,y:anchor.y-11},width,fraction:unit.hp/unit.maxHp,side:unit.side,selected});
        if(native)bar({x:anchor.x,y:anchor.y-18},width,(unit.shield??0)/native,'#69c4ed');
        if(temp)bar({x:anchor.x,y:anchor.y-(native?24:18)},width,temp.value/60,'#d6bcff');
      }
      const groups=[...new Set(effects.filter(s=>['root','silence','exposed','healCut','attackDown'].includes(s.group)).map(s=>s.group))];
      if(groups.length&&zoom>.7)text(groups.slice(0,2).map(g=>statusLabels[g]).join(' · '),{x:p.x,y:p.y+15},'#ffd6a1');
      const below=p.y+Math.max(14,stat.size*zoom*(mobile?.20:.25));
      if(!mobile&&unit.construction<1){
        text(`建造 ${Math.floor(unit.construction*100)}%`,{x:p.x,y:below},'#ead6a1');
        bar({x:p.x,y:below+9},56,unit.construction,'#e2c78e');
      }else if(!mobile){
        text(stat.name,{x:p.x,y:below},unit.side===this.side?'#deeee1':'#f2b0a5');
        const item=queues.get(unit.id);
        if(item)bar({x:p.x,y:below+9},54,1-item.remaining/item.duration,'#8ce2cc');
      }else if(unit.kind==='worker'&&unit.cargo>0){
        bar({x:p.x,y:below},18,unit.cargo/(player?.tech.includes('logistics')?150:100),RESOURCE_INFO[unit.cargoKind||'gold'].color);
      }
    }
    // 受伤单位优先占位，密集队形最多上移三行；满血条拥挤时省略，避免漂离所属单位。
    const placed:{x:number;y:number;width:number}[]=[];
    healthBars.sort((a,b)=>Number(a.fraction===1)-Number(b.fraction===1)||Number(b.selected)-Number(a.selected));
    for(const health of healthBars){
      const width=Math.round(health.width),x=Math.round(health.point.x-width/2)+.5;
      let y=Math.round(health.point.y)+.5,lane=0;
      const overlaps=()=>placed.some(p=>x<p.x+p.width+3&&x+width+3>p.x&&Math.abs(y-p.y)<9);
      while(lane<3&&overlaps()){y-=9;lane++;}
      if(overlaps()&&health.fraction>=1)continue;
      placed.push({x,y,width});
      const fraction=Math.max(0,Math.min(1,health.fraction));
      const color=fraction<=.3?'#ef907c':fraction<=.6?'#e4c47d':COLORS[health.side];
      c.lineWidth=1;c.fillStyle='#091611bf';
      c.beginPath();c.roundRect(x,y,width,5,2);c.fill();
      c.strokeStyle=health.selected?COLORS[health.side]+'70':'#d5e8dd30';c.stroke();
      if(fraction>0){
        c.fillStyle=color;c.beginPath();c.roundRect(x+1,y+1,(width-2)*fraction,3,Math.min(1,(width-2)*fraction/2));c.fill();
      }
    }
    this.drawFootprint(view,project);
    if(player?.rally){
      const base=project(player.rally),tip=project(player.rally,39);
      c.strokeStyle='#adf0c7';c.lineWidth=2;c.beginPath();
      c.moveTo(base.x,base.y);c.lineTo(tip.x,tip.y);c.lineTo(tip.x+15*zoom,tip.y+4*zoom);
      c.lineTo(tip.x,tip.y+9*zoom);c.stroke();
    }
    if(this.marker&&now-this.marker.time<900){
      const t=(now-this.marker.time)/900;c.globalAlpha=1-t;
      ring(this.marker.p,8+20*t,this.marker.attack?'#ff9789':'#c1ffcf',2);c.globalAlpha=1;
    }
    this.drawDrag();
  }
  private effect(c:CanvasRenderingContext2D,row:number,phase:number,x:number,y:number,size:number){
    drawAtlasSprite(c,this.images,'effects',row*6+Math.min(5,Math.floor(Math.max(0,phase)*6)),x,y,size);
  }
  drawMini(v:ViewState){const c=this.mctx,w=this.mini.width,h=this.mini.height;c.drawImage(this.miniTerrain,0,0,w,h);c.drawImage(this.fog,0,0,w,h);
    const pilot=v.oilWells&&isOutpostMap(v.mapId);
    for(const node of v.nodes){
      if(node.tree!==undefined)continue;
      const x=node.x/this.camera.world*w,y=node.y/this.camera.world*h;
      c.fillStyle=RESOURCE_INFO[node.kind].color;
      c.beginPath();
      if(pilot&&isOutpost(node)){
        c.moveTo(x,y-4);c.lineTo(x+4,y);c.lineTo(x,y+4);c.lineTo(x-4,y);c.closePath();
        c.fillStyle='#12231e';c.fill();c.strokeStyle=RESOURCE_INFO[node.kind].color;c.lineWidth=1.4;c.stroke();
      }else if(node.amount>0){c.arc(x,y,2,0,Math.PI*2);c.fill();}
    }
    for(const u of v.units){c.fillStyle=COLORS[u.side];const size=u.kind==='base'?5:isMobile(u)?2.2:3;c.fillRect(u.x/this.camera.world*w-size/2,u.y/this.camera.world*h-size/2,size,size);}
    if(pilot&&this.mini.clientWidth){
      const scale=w/this.mini.clientWidth,font=9*scale;
      c.font=`bold ${font}px monospace`;c.textAlign='left';c.lineWidth=2*scale;c.strokeStyle='#081612';c.fillStyle='#d8eef2';
      for(const {well} of visibleOilPipes(v)){
        if(well.side!==this.side||well.activity!=='produce')continue;
        const node=oilNodeAt(well,v.nodes);
        if(!node?.amount)continue;
        const seconds=Math.ceil(node.amount/OIL_PER_SECOND);
        const label=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
        const x=Math.max(2,Math.min(w-c.measureText(label).width-2,well.x/this.camera.world*w+4));
        const y=Math.max(font,well.y/this.camera.world*h-4);
        c.strokeText(label,x,y);c.fillText(label,x,y);
      }
    }
    c.strokeStyle='#e7f6d8b0';c.lineWidth=1;c.beginPath();
    this.camera.corners.forEach((p,i)=>{if(i)c.lineTo(p.x/this.camera.world*w,p.y/this.camera.world*h);else c.moveTo(p.x/this.camera.world*w,p.y/this.camera.world*h);});
    c.closePath();c.stroke();
  }
}
