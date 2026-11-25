import { maxShield } from './races.js';
import { FACTION_ATLAS_FILE, FACTION_DETAIL_FILE } from './battle-materials.js';
import { ABILITIES, statusLabels, type AbilityId } from './abilities.js';
import { getWorld, type WorldData } from './world.js';
import { assetPath } from './assets.js';
import { ART } from './art.js';
import { Camera } from './camera.js';
import { oilNodeAt, OIL_PER_SECOND } from './oil.js';
import { heightAt } from './terrain-height.js';
import { isOutpost,isOutpostMap } from './outposts.js';
import { placementError } from './engine.js';
import { buildingTiles,type BuildPlacement } from './building-layout.js';
import { STATS, RESOURCE_INFO, COLORS, isMobile, type ViewState, type Point, type Side,MOBILE_KINDS } from './types.js';
import { gridSize,TILE,distance,indexAt } from './pathfinding.js';
import { animationFile } from './animation.js';
import { DetailedTerrain } from './terrain-renderer.js';
import type { BattleScene } from './battle-scene.js';
import type { BlenderAssets } from './blender-assets.js';
import type { LightingQuality } from './battle-gi.js';
import { harvestLand } from './resource-world.js';
import { t } from './locale.js';
import { PerformanceController,type PerformanceMode } from './performance.js';
export class Renderer {
  canvas:HTMLCanvasElement;ctx:CanvasRenderingContext2D;mini:HTMLCanvasElement;mctx:CanvasRenderingContext2D;
  private terrain!:DetailedTerrain;
  private world=getWorld();
  private cutTrees='';
  animate=true;
  miniTerrain=document.createElement('canvas');fog=document.createElement('canvas');fctx=this.fog.getContext('2d')!;
  private fogPixels!:ImageData;
  private fogView?:ViewState;
  images=new Map<string,HTMLImageElement>();camera=new Camera(gridSize(this.world.land)*TILE);width=0;height=0;
  private lastDraw=0;
  private scene:BattleScene|null=null;
  blenderAssets?:BlenderAssets;
  private contextLost=false;
  readonly performance=new PerformanceController(matchMedia('(max-width:800px), (pointer:coarse)').matches);
  private preferredLighting:LightingQuality=innerWidth<700?'off':'balanced';
  get performanceMode(){return this.performance.mode;}
  set performanceMode(value:PerformanceMode){
    this.performance.setMode(value);this.applyPerformance();
    try{localStorage.setItem('fudancraft-performance',value);}catch{/* 本次设置仍然生效。 */}
  }
  get performanceStatus(){return `${this.performance.profile.name} · ${this.performance.fps} FPS 上限 · 光照 ${this.scene?.lightingQuality??'off'}`;}
  private applyPerformance(){
    const profile=this.performance.profile,rank=['off','balanced','high','cinematic'];
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
      const lighting=localStorage.getItem('fudancraft-lighting');if(lighting==='off'||lighting==='balanced'||lighting==='high'||lighting==='cinematic')this.preferredLighting=lighting;}catch{/* 使用设备默认值。 */}
    new ResizeObserver(()=>this.resize()).observe(canvas);
    sceneCanvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault();this.contextLost=true;
    });
    sceneCanvas.addEventListener('webglcontextrestored',()=>{this.contextLost=false;this.applyPerformance();});
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
    await Promise.all(Object.entries({...ART,...animationArt,...extras}).map(([name,url])=>loadImage(name,url)));
    this.terrain=new DetailedTerrain(this.images,this.world);this.terrain.overview(this.miniTerrain);
    const context=this.sceneCanvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance'});
    if(!context)throw Error('此游戏需要 WebGL 2。请开启浏览器硬件加速后重新载入。');
    const [{BattleScene},atlas,unitAtlas,factionAtlas,factionDetail,blenderAssets]=await Promise.all([
      import('./battle-scene.js'),
      loadImage('battle-materials',assetPath('generated/battle-materials.webp')),
      loadImage('unit-materials',assetPath('generated/unit-materials.webp')),
      loadImage('faction-materials',assetPath(FACTION_ATLAS_FILE)),
      loadImage('faction-detail',assetPath(FACTION_DETAIL_FILE)).catch(()=>undefined),
      this.blenderAssets??import('./blender-assets.js').then(module=>module.loadBlenderAssets()),
    ]);
    if(context.isContextLost())throw Error('3D 图形上下文已中断，请重新载入。');
    this.blenderAssets=blenderAssets;
    this.scene=new BattleScene(this.sceneCanvas,context,atlas,unitAtlas,factionAtlas,blenderAssets,this.world,factionDetail);
    this.scene.orient(this.camera);
    this.applyPerformance();
    this.sceneCanvas.hidden=false;
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
  screenToWorld(p:Point):Point{
    return this.world.heights
      ?this.camera.screenToTerrain(p,(x,z)=>heightAt(this.world,x,z))
      :this.camera.screenToWorld(p);
  }
  get currentWorld(){return this.world;}
  setCustomWorld(world:WorldData){
    this.world=world;
    this.camera.world=gridSize(world.land)*TILE;
    this.camera.resize(this.camera.width,this.camera.height);
    this.resizeFog();
    if(this.ready){
      this.terrain=new DetailedTerrain(this.images,world);
      this.terrain.overview(this.miniTerrain);
      this.scene?.setWorld(world,true);
    }
    this.cutTrees='';
  }
  pan(dx:number,dy:number){this.camera.panScreen(dx,dy);}
  zoomAt(factor:number,point:Point){this.camera.zoomBy(factor,point);}
  orbit(direction:number){this.scene?.orient(this.camera,(this.camera.yaw+direction*Math.PI/6)%(2*Math.PI));}
  pick(point:Point){return this.scene?.pick(point,this.camera)??null;}
  projectUnit(unit:ViewState['units'][number]){
    const anchor=this.scene?.unitAnchor(unit);
    return anchor?this.camera.worldToScreen(anchor.point,(anchor.top+anchor.ground)*.5):this.camera.worldToScreen(unit);
  }
  reset(){this.scene?.reset();this.selectedNode=null;this.hoverNode=null;this.cutTrees='';this.terrain?.overview(this.miniTerrain);}
  skillPreview:{origin:Point;range:number;radius?:number;point:Point|null}|null=null;
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
    if(this.contextLost){
      c.clearRect(0,0,w,h);c.fillStyle='#14202bed';c.fillRect(0,0,w,h);
      c.fillStyle='#f0e5d4';c.font='16px sans-serif';c.textAlign='center';
      c.fillText('3D 图形连接中断，正在等待浏览器恢复…',w/2,h/2);c.textAlign='start';return;
    }
    if(cut!==this.cutTrees){
      this.cutTrees=cut;
      this.terrain.overview(this.miniTerrain,harvestLand(this.world,v.nodes));
    }
    if(!this.scene)throw Error('3D 战场尚未初始化');
    c.clearRect(0,0,w,h);
    this.scene.draw(v,this.camera,this.canvas.width/w,now,dt,this.animate,this.side,this.placement,this.selected,this.hoverNode,this.selectedNode,this.showRanges);
    this.draw3DOverlay(v,now,this.scene);
    this.updateFog(v);this.drawMini(v);
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
    const valid=!placementError(this.side,kind,point,view.units,view.nodes,view.visible,facing,harvestLand(this.world,view.nodes),view.oilWells,false,this.world);
    const cells=buildingTiles(kind,point,facing);
    const occupied=new Set(cells.map(p=>`${p.x},${p.y}`));
    const edges=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
    const projectGround=(p:Point)=>this.camera.worldToScreen(p,heightAt(this.world,p.x,p.y));
    c.fillStyle=valid?'#a5edca29':'#f68e7839';c.strokeStyle=valid?'#a5edca':'#f68e78';c.lineWidth=1.5;
    for(const cell of cells){
      const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(p=>projectGround({x:(cell.x+p.x)*TILE,y:(cell.y+p.y)*TILE}));
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
      for(const well of v.units){
        if(well.kind!=='oilwell'||well.side!==this.side||well.activity!=='produce')continue;
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
