import { ABILITIES, abilitiesFor, isAbility, statusLabels, sustainedAreas, type AbilityId } from './abilities.js';
import { createMapSnapshot, registerMapSnapshot, validateMapSnapshot } from './map-versions.js';
import { deserializeCustomMap, isCustomMapId } from './custom-maps.js';
import { SkillEngine, attackScale, hasEffect, motionScale } from './ability-engine.js';
import { ROSTERS, covered, groundOnly, maxShield, needsCoverage, population, producersFor, raceRequirement, technologyAllowed, researchBuilding } from './races.js';
import { availableForConstruction, unfinishedConstruction } from './construction-worker.js';
import { getWorld,initialNodes,validMapRevision,type WorldData } from './world.js';
import { DEFAULT_MAP_ID,isMapId,mapInfo,supportsPlayers,type MapId } from './maps.js';
import { Movement,circleFree,groundPath,landingNear } from './movement.js';
import { buildingFacing,buildingTiles,validFacing } from './building-layout.js';
import { harvestLand,STARTING_RESOURCES,resourcePoint } from './resource-world.js';
import { weapon } from './weapons.js';
import { hasRefinery, oilNodeAt, OIL_PER_SECOND } from './oil.js';
import { isFlatForBuilding } from './terrain-height.js';
import { isOutpost,isOutpostMap,OUTPOST_FIGHT_RANGE } from './outposts.js';
import { BALANCE } from './balance.js';
import { runAI } from './ai.js';
import { newMatchStats,addCost,recordEconomy,recordKill,recordMatchEvent,validMatchStats } from './match-stats.js';
import { sameTeam,teamOf,isRace,type Race,type AiStyle } from './types.js';
import { findPath, terrain, nearestFree, distance, indexAt, gridSize, TILE, WORLD, inBounds } from './pathfinding.js';
import { STATS, TECHS, ALL_MOBILE_KINDS, ALL_BUILDING_KINDS, LEGACY_MOBILE_KINDS, LEGACY_BUILDING_KINDS, isMobile, isCombat, armorApplies, weaponsApplies, unitCost, maxHp, type Side, type Kind, type MobileKind, type BuildingFacing, type BuildingKind, type Tech, type Unit, type Point, type Player, type Cost, type ResourceNode, type Difficulty, type GameState, type ViewState, type Command, type VisualEvent, type Shot } from './types.js';
const clampPoint = (p: Point,extent:number): Point => ({x: Math.max(16, Math.min(extent - 16, p.x)), y: Math.max(16, Math.min(extent - 16, p.y))});
export const snapPoint = (p: Point): Point => ({x: (Math.floor(p.x / TILE) + .5) * TILE, y: (Math.floor(p.y / TILE) + .5) * TILE});
export const complete = (u: Unit) => u.construction >= 1;
export function powerFor(side: Side, units: Unit[]) {
  let used = 0, capacity = 0;
  for (const u of units) if (u.side === side && !isMobile(u) && complete(u)) {
    if (STATS[u.kind].power > 0) used += STATS[u.kind].power; else capacity -= STATS[u.kind].power;
  }
  return {used, capacity, active: used <= capacity};
}
export function requirement(kind: Kind, p: Player, units: Unit[]): string | null {
  if(p.race){
    const reason=raceRequirement(kind,p,units);
    if(reason)return reason;
    if(isMobile({kind})&&!producersFor(kind as MobileKind,p,units).length)return '需要可用的'+STATS[kind].name+'生产设施';
    return null;
  }
  const s = STATS[kind], has = (k: Kind) => units.some(u => u.side === p.side && u.kind === k && complete(u));
  if (s.requires && !has(s.requires)) return `需要${STATS[s.requires].name}`;
  if (s.producer && !has(s.producer)) return `需要${STATS[s.producer].name}`;
  if (s.tech && !p.tech.includes(s.tech)) return `需要研究${TECHS[s.tech].name}`;
  return null;
}
export function placementError(side: Side, kind: BuildingKind, at: Point, units: Unit[], nodes: ResourceNode[], visible?: ArrayLike<number>,facing?:BuildingFacing,land=terrain,oilWells=false,remote=false,world?:Pick<WorldData,'land'|'heights'|'ramps'|'cliffs'>): string | null {
  if (kind === 'base') return '每位指挥官仅有一个指挥中心';
  const size=gridSize(land);
  const oil=kind==='oilwell'?oilNodeAt(at,nodes):undefined;
  if(kind==='oilwell'){
    if(!oilWells)return '此战局使用采集车采油';
    if(!oil||oil.amount<=0)return '油井必须建在有储量的油点上';
    if(!hasRefinery(side,units))return '需要先建造已完工的石油精炼厂';
  }
  const cells=buildingTiles(kind,at,facing??buildingFacing(kind,at,size*TILE));
  for(const {x,y} of cells){
    if (!inBounds(x,y,size) || land[y*size+x]) return '该位置有地形阻挡';
    if (visible && !visible[y*size+x]) return '需要当前视野内的空地';
  }
  if (world && !isFlatForBuilding(world, cells)) return '需要平整地面，不能在斜坡或悬崖上建造';
  // 基地扩建也要留出通道，避免新建筑重新把集结区挤成单列小巷。
  if (units.some(u => !isMobile(u) && distance(u, at) < STATS[u.kind].radius + STATS[kind].radius + 48)) return '与现有建筑距离过近';
  if(nodes.some(n=>n!==oil&&n.amount>0&&distance(n,at)<STATS[kind].radius+
    Math.max(n.radius+24,oilWells&&n.kind==='oil'?STATS.oilwell.radius+48:0)))return '不能在资源点上建造';
  if(kind==='oilwell')return null;
  // An explored oil field can anchor a new outpost once a scout and builder reach it.
  if(oilWells&&kind==='refinery'&&nodes.some(n=>n.kind==='oil'&&n.amount>0&&
    (!visible||visible[indexAt(n,size)])&&distance(n,at)<=448))return null;
  if (remote||['node','relayTower'].includes(kind))return null;
  if (!units.some(u => u.side === side && !isMobile(u) && complete(u) && distance(u, at) < 800)) return '需要靠近己方建筑';
  return null;
}
const afford = (p: Player, c: Cost) => p.credits + 1e-6 >= c.gold && p.wood + 1e-6 >= c.wood && p.oil + 1e-6 >= c.oil;
function spend(p: Player, c: Cost, factor = 1) { p.credits -= c.gold * factor; p.wood -= c.wood * factor; p.oil -= c.oil * factor;const stats=p.stats??=newMatchStats();addCost(factor>=0?stats.spent:stats.refunded,c,Math.abs(factor)); }
export class Engine {
  state: GameState;
  readonly world:WorldData;
  readonly size:number;
  readonly extent:number;
  readonly outposts:readonly ResourceNode[];
  outpostPilot:boolean;
  private readonly openSky:Uint8Array;
  visible = new Map<Side, Uint8Array>();
  private movement!:Movement;
  readonly skills=new SkillEngine(this);
  constructor(players:{name:string;ai:boolean;team?:Side;aiStyle?:AiStyle;race?:Race}[] = [{name:'指挥官',ai:false},{name:'赤焰军团',ai:true}], difficulty: Difficulty = 'normal',mapId:MapId|string=DEFAULT_MAP_ID,mapRevision?:number,mapHash?:string) {
    this.world=getWorld(mapId,mapRevision,mapHash);
    const customMap=this.world.customDocument?registerMapSnapshot(createMapSnapshot(deserializeCustomMap(this.world.customDocument))):undefined;
    if(customMap)this.world=getWorld(mapId,1,customMap.version.contentHash);
    this.size=gridSize(this.world.land);
    this.extent=this.size*TILE;
    this.outposts=isMapId(mapId)&&isOutpostMap(mapId)?this.world.deposits?.filter(isOutpost)??[]:[];
    this.outpostPilot=this.outposts.length>0;
    this.openSky=new Uint8Array(this.world.land.length);
    if(isMapId(mapId)){
      if(!supportsPlayers(mapId,players.length))throw Error(`${mapInfo(mapId).name}支持 ${mapInfo(mapId).maxPlayers===2?'2':'2–4'} 位指挥官`);
    }else if(players.length<2||players.length>this.world.bases.length){
      throw Error(`自定义地图支持 2–${this.world.bases.length} 位指挥官`);
    }
    const bank=this.world.deposits?STARTING_RESOURCES:{gold:3600,wood:1600,oil:400};
    this.state = {version:2,...(customMap?{customMap,mapHash:customMap.version.contentHash}:{}),...(this.world.deposits?{oilWells:true as const}:{}),mapId:mapId as MapId,mapRevision:this.world.revision,time:0,units:[],nodes:initialNodes(this.world),players:players.map((p,i)=>({...p,side:(i+1) as Side,team:p.team??(i+1) as Side,stats:newMatchStats(),credits:bank.gold,wood:bank.wood,oil:bank.oil,tech:[],queue:[],rally:null,kills:0,lost:0,harvested:0})),nextId:1,shots:[],windups:[],events:[],nextEventId:1,winner:null,difficulty,aiTimer:2,explored:{},aiPlans:{}};
    if(new Set(this.state.players.map(p=>p.team)).size<2||this.state.players.some(p=>!this.state.players.some(q=>q.side===p.team)))throw Error('需要至少两个有效队伍');
    for (const p of this.state.players) {
      this.state.explored[p.side] = Array(this.world.land.length).fill(0);
      const source = this.world.bases.find(b=>b.side===p.side)!;
      const b = this.spawn('base', p.side, {x:source.x,y:source.y});
      const sx=b.x<this.extent/2?1:-1,sy=b.y<this.extent/2?1:-1;
      const roster=p.race?ROSTERS[p.race]:undefined;
      const utility=p.race==='stellar'?'node':p.race==='relay'?'relayTower':p.race==='brood'?null:'powerplant';
      if(utility)this.spawn(utility,p.side,this.world.deposits?resourcePoint({x:b.x-sx*160,y:b.y},this.extent):this.findBuildSpot(p.side,utility,b)!);
      const production=roster?.production??'barracks';
      this.spawn(production,p.side,this.world.deposits?resourcePoint({x:b.x,y:b.y-sy*160},this.extent):this.findBuildSpot(p.side,production,b)!);
      const [front,scout]=roster?.opening??['soldier','scout'];
      const towers=this.world.towers.filter(t=>t.side===p.side).slice(0,2);
      for(const t of towers){
        const at=nearestFree(t,this.blockers());
        if(at&&!this.state.units.some(u=>!isMobile(u)&&distance(u,at)<STATS[u.kind].radius+45))this.spawn('tower',p.side,at);
      }
      if(this.world.deposits){
        for(let i=0;i<3;i++)this.spawn('worker',p.side,resourcePoint({x:b.x+sx*128,y:b.y+sy*(i-1)*64},this.extent));
        for(let i=0;i<2;i++)this.spawn(front,p.side,resourcePoint({x:b.x+sx*(64+i*64),y:b.y-sy*128},this.extent));
        this.spawn(scout,p.side,resourcePoint({x:b.x+sx*192,y:b.y-sy*128},this.extent));
      }else{
        for(let i=0;i<3;i++)this.spawn('worker',p.side,this.freeSpawn(b,'worker'));
        for(let i=0;i<2;i++)this.spawn(front,p.side,this.freeSpawn(b,front));
        this.spawn(scout,p.side,this.freeSpawn(b,scout));
      }
    }
    this.updateVision();
    for(const p of this.state.players){const workers=this.state.units.filter(u=>u.side===p.side&&u.kind==='worker');workers.forEach((u,i)=>{const n=this.nearestNode(u,i===1?'wood':'gold',u,this.world.deposits?p.side:undefined);if(n)this.command(p.side,{type:'gather',ids:[u.id],node:n.id});});}
  }
  private stationError(u:Unit,point:Point){
    const visible=this.visible.get(u.side),kind='assembly';
    const error=placementError(u.side,kind,point,this.state.units.filter(v=>v.id!==u.id),this.state.nodes,visible,undefined,this.land(),this.state.oilWells,true,this.world);
    if(error)return '落点不可用';
    const facing=buildingFacing(kind,point,this.extent),ground=this.blockers();
    const footprint=buildingTiles(kind,point,facing);
    if(footprint.some(tile=>ground[tile.y*this.size+tile.x]||this.state.units.some(v=>v.id!==u.id&&v.hp>0&&!STATS[v.kind].air&&
      Math.hypot(Math.max(Math.abs(v.x-(tile.x+.5)*TILE)-TILE/2,0),Math.max(Math.abs(v.y-(tile.y+.5)*TILE)-TILE/2,0))<STATS[v.kind].radius)))return '落点不可用';
    const exits=[{x:point.x+80,y:point.y},{x:point.x-80,y:point.y},{x:point.x,y:point.y+80},{x:point.x,y:point.y-80}];
    return exits.some(exit=>validPoint(exit,this.extent)&&visible?.[this.indexAt(exit)]&&circleFree(exit,STATS.ranger.radius,ground))?null:'出兵通道不可用';
  }
  private stationOrder(player:Player,cmd:Extract<Command,{type:'station'}>){
    const u=this.state.units.find(u=>u.id===cmd.id&&u.side===player.side&&u.kind==='assembly'&&u.hp>0&&complete(u));
    if(player.race!=='relay'||!u)return '需要己方已完工装配站';
    if(cmd.action==='pack'){
      if(u.station||player.queue.some(q=>q.producer===u.id))return '装配站必须展开且队列为空才能收拢';
      u.station={mode:'packing',until:this.state.time+8};return null;
    }
    if(cmd.action==='stop'){
      if(u.station?.mode==='packing')delete u.station;
      else if(u.station)u.station={mode:'mobile'};
      u.path=[];return null;
    }
    if(u.station?.mode!=='mobile'||!validPoint(cmd.point,this.extent))return '需要已收拢的装配站和有效落点';
    const at=snapPoint(cmd.point);
    if(cmd.action==='deploy'){
      if(distance(u,at)>64)return '装配站距离架设落点过远';
      const error=this.stationError(u,at);if(error)return error;
      u.path=[];u.station={mode:'deploying',until:this.state.time+8,point:at};return null;
    }
    const path=groundPath(u,at,this.blockers(),[],true);
    if(!path.length)return '装配站无法抵达';
    u.path=path;return null;
  }
  private stepStation(u:Unit,dt:number,blocked:Uint8Array){
    const station=u.station;if(!station)return;
    if(station.mode==='packing'&&station.until!<=this.state.time){u.station={mode:'mobile'};return;}
    if(station.mode==='deploying'&&station.until!<=this.state.time){
      const at=station.point!;
      if(this.stationError(u,at)){u.station={mode:'mobile'};return;}
      u.x=at.x;u.y=at.y;u.facing=buildingFacing('assembly',at,this.extent);delete u.station;this.emit('complete',u);return;
    }
    if(station.mode!=='mobile'||!u.path.length)return;
    const next=u.path[0],d=distance(u,next),step=Math.min(d,64*dt);
    if(d<1e-6){u.path.shift();return;}
    const point={x:u.x+(next.x-u.x)*step/d,y:u.y+(next.y-u.y)*step/d};
    if(!circleFree(point,18,blocked)||this.state.units.some(v=>v.id!==u.id&&v.hp>0&&
      (isMobile(v)||v.station?.mode==='mobile'||v.station?.mode==='deploying')&&!STATS[v.kind].air&&distance(v,point)<STATS[v.kind].radius+18))return;
    u.angle=Math.atan2(next.y-u.y,next.x-u.x);u.x=point.x;u.y=point.y;u.activity='move';
    if(step>=d)u.path.shift();
  }
  indexAt(point:Point){return indexAt(point,this.size);}
  base(side: Side) { return this.state.units.find(u => u.side === side && u.kind === 'base'); }
  player(side: Side) { return this.state.players.find(p => p.side === side)!; }
  allied(a:Side,b:Side){return sameTeam(a,b,this.state.players);}
  has(side: Side, kind: Kind) { return this.state.units.some(u => u.side === side && u.kind === kind && complete(u)); }
  spawn(kind: Kind, side: Side, at: Point) {
    const u: Unit = {...at,id:this.state.nextId++,side,kind,hp:STATS[kind].hp,angle:0,path:[],target:null,cooldown:0,repath:0,order:'idle',resource:null,cargo:0,cargoKind:null,returning:false,construction:1,builder:null};
    if(armorApplies(u,this.player(side))&&this.player(side).tech.includes('armor'))u.hp*=1.25;
    if(this.player(side).race&&isMobile(u)&&abilitiesFor(kind as MobileKind).length)u.ability={energy:50,cooldowns:{},effects:[]};
    if(maxShield(u))u.shield=maxShield(u);
    if(this.player(side).race&&kind==='factory')u.factoryModule='armor';
    this.state.units.push(u); return u;
  }
  skillReleased(caster:Unit,skill:AbilityId){this.emit('cast',caster,skill);}
  private emit(type: VisualEvent['type'], u: Pick<Unit,'id'|'kind'|'side'|'x'|'y'|'angle'|'facing'>,skill?:AbilityId) {
    let audience = 1 << u.side;
    for (const p of this.state.players) if (this.visible.get(p.side)?.[this.indexAt(u)]) audience |= 1 << p.side;
    if(type==='attack'||type==='damage')this.state.events=this.state.events.filter(e=>e.unit!==u.id||e.type!==type);
    this.state.events.push({id:this.state.nextEventId++,unit:u.id,kind:u.kind,side:u.side,x:u.x,y:u.y,angle:u.angle,time:this.state.time,type,audience,...(u.facing!==undefined?{facing:u.facing}:{}),...(skill?{skill}:{})});
    // Bound both network snapshots and long-running saves during large battles.
    if(this.state.events.length>512)this.state.events.splice(0,this.state.events.length-512);
  }
  blockers() {
    const b=this.land();
    for(const u of this.state.units)if(!isMobile(u)&&u.station?.mode!=='mobile'&&u.station?.mode!=='deploying')
      for(const {x,y} of buildingTiles(u.kind as BuildingKind,u,u.facing??buildingFacing(u.kind as BuildingKind,u,this.extent)))if(inBounds(x,y,this.size))b[y*this.size+x]=1;
    for(const area of this.skills.areas)if(area.skill==='ENE-05'&&area.until>this.state.time){
      for(let y=Math.floor((area.y-area.radius)/TILE);y<=Math.floor((area.y+area.radius)/TILE);y++)for(let x=Math.floor((area.x-area.radius)/TILE);x<=Math.floor((area.x+area.radius)/TILE);x++){
        const dx=Math.max(x*TILE-area.x,area.x-(x+1)*TILE,0),dy=Math.max(y*TILE-area.y,area.y-(y+1)*TILE,0);
        if(inBounds(x,y,this.size)&&Math.hypot(dx,dy)<area.radius)b[y*this.size+x]=1;
      }
    }
    for(const n of this.state.nodes)if(n.amount>0)b[this.indexAt(n)]=1;
    return b;
  }
  land(){return harvestLand(this.world,this.state.nodes);}
  freeSpawn(near: Point,kind:MobileKind='worker') {
    const stats=STATS[kind],b=stats.air?this.openSky:this.blockers();
    const side='side'in near?near.side as Side:undefined;
    const mine=!stats.air&&side?this.world.deposits?.find(n=>n.startSide===side&&n.kind==='gold'):undefined;
    const start=mine?nearestFree(mine,b):null;
    let reachable:Uint8Array|undefined;
    const reachesMine=(point:Point)=>{
      if(!start)return true;
      const destination=this.indexAt(point);
      if(reachable)return !!reachable[destination];
      // 普通落点只需一条短路径。遇到封闭空穴时，再计算连通区供剩余候选点共用。
      if(findPath(start,point,b).length)return true;
      reachable=new Uint8Array(b.length);const queue=[this.indexAt(start)];reachable[queue[0]]=1;
      for(let k=0;k<queue.length;k++){
        const at=queue[k],x=at%this.size,y=Math.floor(at/this.size);
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=x+dx,ny=y+dy,next=ny*this.size+nx;
          if(!inBounds(nx,ny,this.size)||b[next]||reachable[next])continue;
          reachable[next]=1;queue.push(next);
        }
      }
      return !!reachable[destination];
    };
    const available=(point:Point)=>this.state.units.every(u=>!isMobile(u)||!!STATS[u.kind].air!==!!stats.air||distance(u,point)>=STATS[u.kind].radius+stats.radius+1)&&reachesMine(point);
    const goal=this.world.deposits?{x:near.x+(near.x<this.extent/2?100:-100),y:near.y+(near.y<this.extent/2?80:-80)}:{x:near.x+100,y:near.y-80};
    // 生产建筑背后的封闭空穴不是出生点；单位必须接入主矿所在的地面通路。
    const landing=landingNear(goal,stats.radius,b,available,16);if(landing)return landing;
    let closest:Point|undefined,best=Infinity;
    for(let i=0;i<b.length;i++)if(!b[i]){
      const point={x:(i%this.size+.5)*TILE,y:(Math.floor(i/this.size)+.5)*TILE},d=distance(point,goal);
      if(d<best&&circleFree(point,stats.radius,b)&&available(point)){closest=point;best=d;}
    }
    return closest??near;
  }
  findBuildSpot(side: Side, kind: BuildingKind, near: Point, visible?: ArrayLike<number>): Point | null {
    const land=this.land();
    if(kind==='oilwell'){
      const at=snapPoint(near);
      return placementError(side,kind,at,this.state.units,this.state.nodes,visible,undefined,land,this.state.oilWells,false,this.world)?null:at;
    }
    for(let r=4;r<18;r++)for(let n=0;n<24;n++){
      const a=n/24*Math.PI*2,at=snapPoint({x:near.x+Math.cos(a)*r*TILE,y:near.y+Math.sin(a)*r*TILE});
      // Starting layouts keep the full apron around their buildings.
      if(!visible&&kind!=='tower'&&buildingTiles('base',at,0).some(({x,y})=>!inBounds(x,y,this.size)||land[y*this.size+x]))continue;
      if(kind==='refinery'&&this.state.oilWells&&oilNodeAt(near,this.state.nodes)&&distance(near,at)>448)continue;
      if(!placementError(side,kind,at,this.state.units,this.state.nodes,visible,undefined,land,this.state.oilWells,false,this.world))return at;
    }
    return null;
  }
  route(u: Unit, goal: Point, blocked = this.blockers()) {
    const destination=clampPoint(goal,this.extent),plain=(u.order==='move'||u.order==='assault')&&!u.target;
    u.path=STATS[u.kind].air?[destination]:groundPath(u,destination,blocked,[],plain);
    u.destination=plain?(u.path.at(-1)??destination):destination;
    u.navigationProgress=u.path.length?distance(u,u.path[0]):undefined;delete u.navigationStalled;delete u.navigationRetries;u.repath=.8;
  }
  clearWindup(u:Unit){
    this.state.windups=this.state.windups.filter(a=>a.source!==u.id);
    delete u.action;delete u.yieldPoint;delete u.yieldTo;delete u.yieldOrigin;
  }
  relocate(u:Unit,p:Point){
    this.cancelAction(u);u.x=p.x;u.y=p.y;u.path=[];u.order='idle';u.target=null;u.destination=undefined;
    if(u.ability)u.ability.recovery=Math.max(u.ability.recovery??0,this.state.time+.2);
  }
  private cancelAction(u:Unit){this.skills.interrupt(u,'施法取消');delete u.waitingForGold;this.state.windups=this.state.windups.filter(a=>a.source!==u.id);delete u.action;delete u.yieldPoint;delete u.yieldTo;delete u.yieldOrigin;}
  private servicePoint(u:Unit,kind:'node'|'depot'|'build',target:Point&{id:number},reach:number,blocked:Uint8Array,estimate=false){
    const radius=STATS[u.kind].radius,reserved=estimate?[]:this.state.units.filter(v=>v.id!==u.id&&v.hp>0&&v.service).map(v=>({point:v.service!.point,radius:STATS[v.kind].radius}));
    const available=(p:Point)=>circleFree(p,radius,blocked)&&reserved.every(v=>distance(v.point,p)>=v.radius+radius+4);
    const old=u.service?.kind===kind&&u.service.target===target.id?u.service:undefined;
    if(old&&!old.waiting&&(u.blockedFor??0)<2.5&&available(old.point))return old;
    if(!old&&distance(u,target)<reach-2&&available(u))return u.service={kind,target:target.id,point:{x:u.x,y:u.y},waiting:false};
    const ring=reach-7;
    for(let layer=0;layer<(estimate?1:5);layer++){
      if(layer>0&&old?.waiting&&available(old.point))return old;
      const r=ring+layer*(radius*2+10),count=Math.max(16,Math.floor(Math.PI*2*r/(radius*2+8))),points:Point[]=[];
      for(let n=0;n<count;n++){const angle=n/count*Math.PI*2;const point={x:target.x+Math.cos(angle)*r,y:target.y+Math.sin(angle)*r};if(available(point))points.push(point);}
      points.sort((a,b)=>distance(a,u)-distance(b,u));
      const point=points.find(p=>{
        if(old&&(u.blockedFor??0)>=2.5&&distance(old.point,p)<4)return false;
        const last=groundPath(u,p,blocked).at(-1);
        return last&&distance(last,p)<1;
      });
      if(point){
        u.blockedFor=0;
        return u.service={kind,target:target.id,point,waiting:layer>0};
      }
    }
    delete u.service;return undefined;
  }
  private approach(u:Unit,kind:'node'|'depot'|'build',target:Point&{id:number},reach:number,blocked:Uint8Array){
    const place=this.servicePoint(u,kind,target,reach,blocked);
    if(!place){u.path=[];return false;}
    if(!place.waiting&&distance(u,target)<reach-2&&circleFree(u,STATS[u.kind].radius,blocked)){
      place.point={x:u.x,y:u.y};u.path=[];return true;
    }
    if(distance(u,place.point)<3){u.path=[];return !place.waiting&&distance(u,target)<reach;}
    if(!u.destination||distance(u.destination,place.point)>3||(!u.path.length&&u.repath<=0))this.route(u,place.point,blocked);
    return false;
  }
  nearestNode(u: Unit, kind: ResourceNode['kind'],near:Point=u,startSide?:Side,eligible?:(node:ResourceNode)=>boolean) {
    const candidates=this.state.nodes.filter(n=>n.kind===kind&&n.amount>0&&(startSide===undefined||n.startSide===startSide)&&(!eligible||eligible(n))).sort((a,b)=>distance(a,near)-distance(b,near));
    if(!this.world.deposits&&!eligible)return candidates[0];
    const blocked=this.blockers(),radius=STATS[u.kind].radius;
    const reserved=kind==='gold'&&eligible?[]:this.state.units.filter(v=>v.id!==u.id&&v.service&&!v.service.waiting);
    // 从可抵达的林缘选择下一棵树，不能给工人分配被整片森林包住的树干。
    return candidates.find(n=>{
      const reach=n.radius+23;
      for(let i=0;i<16;i++){
        const a=i/16*Math.PI*2,point={x:n.x+Math.cos(a)*reach,y:n.y+Math.sin(a)*reach};
        if(!circleFree(point,radius,blocked)||reserved.some(v=>distance(v.service!.point,point)<STATS[v.kind].radius+radius+4))continue;
        const last=groundPath(u,point,blocked).at(-1);
        if(last&&distance(last,point)<1)return true;
      }
      return false;
    });
  }
  command(side: Side, cmd: Command): string | null {
    const p=this.player(side);if(!p||this.state.winner)return '对局已结束';if(!this.base(side))return '指挥中心已被摧毁';
    if(cmd.type==='order'){
      const target=this.state.units.find(u=>u.id===cmd.target&&u.side===side&&!isMobile(u));
      const workers=this.state.units.filter(u=>u.side===side&&u.kind==='worker'&&cmd.ids.includes(u.id));
      if(target&&workers.length){
        if(!complete(target))return this.command(side,{type:'resume-build',worker:workers[0].id,target:target.id,append:cmd.append});
        if(target.hp<maxHp(target,p))return this.command(side,{type:'repair',ids:workers.map(u=>u.id),target:target.id,append:cmd.append});
      }
    }
    if(cmd.type==='assign-idle'){
      const nodes=this.state.nodes.filter(n=>n.kind===cmd.resource&&n.amount>0&&this.visible.get(side)?.[this.indexAt(n)]);
      const blocked=this.blockers();
      for(const u of this.state.units.filter(u=>u.side===side&&u.kind==='worker'&&u.order==='idle'&&!u.tasks?.length)){
        const node=[...nodes].sort((a,b)=>distance(u,a)+this.state.units.filter(v=>v.resource===a.id).length*96-distance(u,b)-this.state.units.filter(v=>v.resource===b.id).length*96)
          .find(n=>this.servicePoint({...u,service:undefined},'node',n,n.radius+30,blocked));
        if(node)this.command(side,{type:'gather',ids:[u.id],node:node.id});
      }
      return null;
    }
    if(cmd.type==='cancel-task'){
      const u=this.state.units.find(u=>u.side===side&&u.id===cmd.id);
      if(!u?.tasks||!Number.isInteger(cmd.index)||cmd.index<0||cmd.index>=u.tasks.length)return '无效队列';
      const [task]=u.tasks.splice(cmd.index,1);this.releaseTask(u,task);return null;
    }
    if((cmd.type==='order'||cmd.type==='gather'||cmd.type==='repair'||cmd.type==='resume-build')&&cmd.append){
      const units=this.state.units.filter(u=>u.side===side&&isMobile(u)&&(cmd.type==='resume-build'?u.id===cmd.worker:cmd.ids.includes(u.id)));
      if(!units.length)return '无效指令';
      if(units.some(u=>(u.tasks?.length??0)>=16))return '任务队列已满';
      if(cmd.type==='order'&&!validPoint(cmd.point,this.extent))return '无效坐标';
      if(cmd.type==='gather'&&!this.state.nodes.some(n=>n.id===cmd.node&&n.amount>0&&this.visible.get(side)?.[this.indexAt(n)]&&(n.kind!=='oil'||!this.state.oilWells&&this.has(side,'refinery'))))return '资源点不在当前视野内或已枯竭';
      if((cmd.type==='repair'||cmd.type==='resume-build')&&!this.state.units.some(u=>u.id===cmd.target&&u.side===side&&!isMobile(u)&&(cmd.type==='repair'?complete(u):unfinishedConstruction(u))))return '无效施工目标';
      if(cmd.type!=='order'&&units.some(u=>u.kind!=='worker'))return '请先选择工程采集车';
      for(const u of units){
        const task=cmd.type==='order'?{type:cmd.type,point:{x:cmd.point.x,y:cmd.point.y},target:cmd.target,assault:cmd.assault}:cmd.type==='gather'?{type:cmd.type,node:cmd.node}:{type:cmd.type,target:cmd.target};
        (u.tasks??=[]).push(task);if(u.order==='idle'||u.order==='hold')this.nextTask(u);
      }
      return null;
    }
    if(cmd.type==='cast')return p.race?this.skills.cast(side,cmd):'此战局使用传统规则';
    if(cmd.type==='medic-auto'){
      if(!p.race)return '此战局使用传统规则';
      for(const u of this.state.units)if(u.side===side&&u.kind==='medic'&&u.ability&&cmd.ids.includes(u.id))u.ability.auto=cmd.enabled;
      return null;
    }
    if(cmd.type==='station')return this.stationOrder(p,cmd);
    if(cmd.type==='factory-module'){
      const u=this.state.units.find(u=>u.id===cmd.id&&u.side===side&&u.kind==='factory'&&u.hp>0&&complete(u));
      if(p.race!=='industrial'||!u||!p.tech.includes('tier2'))return '需要己方 T2 战车工厂';
      if(u.refitUntil!==undefined||u.factoryModule===cmd.module)return '工厂正在换装或已装备该模块';
      const cost={gold:150,wood:70,oil:25};if(!afford(p,cost))return '资源不足';
      spend(p,cost);u.factoryModule=cmd.module;u.refitUntil=this.state.time+9;return null;
    }
    if(cmd.type==='cancel-build'){
      const u=this.state.units.find(u=>u.id===cmd.id&&u.side===side&&!isMobile(u)&&!complete(u));
      if(!u)return '找不到可取消的施工';
      spend(p,unitCost(u.kind),-1);this.state.units=this.state.units.filter(v=>v.id!==u.id);return null;
    }
    if(cmd.type==='train'){
      if(!ALL_MOBILE_KINDS.includes(cmd.kind)||!p.race&&!LEGACY_MOBILE_KINDS.some(k=>k===cmd.kind))return '无效兵种';const reason=requirement(cmd.kind,p,this.state.units);if(reason)return reason;
      if(p.queue.length>=24)return '生产队列已满';
      const pop=population(p,this.state.units),weight=pop.weight(cmd.kind);
      if(weight&&pop.used+pop.reserved+weight>pop.capacity)return `人口容量不足（${pop.capacity}）`;
      if(cmd.kind==='sac'&&this.state.units.filter(u=>u.side===side&&u.kind==='sac').length+p.queue.filter(q=>!q.research&&q.kind==='sac').length>=16)return '供给囊体已达 16 个';
      if(!afford(p,unitCost(cmd.kind)))return '资源不足：需要足够的金矿、木材和石油';
      const producers=producersFor(cmd.kind,p,this.state.units).filter(u=>cmd.producer===undefined||cmd.producer===u.id);
      const producer=producers.sort((a,b)=>p.queue.filter(q=>q.producer===a.id).length-p.queue.filter(q=>q.producer===b.id).length)[0];
      if(!producer)return '没有可用的生产建筑';
      spend(p,unitCost(cmd.kind));p.queue.push({kind:cmd.kind,remaining:STATS[cmd.kind].build,duration:STATS[cmd.kind].build,producer:producer.id,research:false});return null;
    }
    if(cmd.type==='research'){
      if(!Object.hasOwn(TECHS,cmd.tech))return '无效科技';const t=TECHS[cmd.tech];
      if(!technologyAllowed(p,cmd.tech))return '该种族无法研究此项';
      const labKind=researchBuilding(p,cmd.tech);
      const lab=this.state.units.filter(u=>u.side===side&&u.kind===labKind&&u.hp>0&&complete(u)&&(!needsCoverage(u.kind)||covered(side,u,this.state.units)))
        .sort((a,b)=>p.queue.filter(q=>q.producer===a.id).length-p.queue.filter(q=>q.producer===b.id).length)[0];
      if(!lab)return '需要可用的'+STATS[labKind].name;if(p.tech.includes(cmd.tech)||p.queue.some(q=>q.research&&q.kind===cmd.tech))return '该科技已完成或正在研究';
      if(t.requires&&!p.tech.includes(t.requires))return `需要先研究${TECHS[t.requires].name}`;
      if(t.building&&!this.has(side,t.building))return `需要${STATS[t.building].name}`;
      if(p.queue.length>=24)return '队列已满';if(!afford(p,t.cost))return '研究资源不足';
      spend(p,t.cost);p.queue.push({kind:cmd.tech,remaining:t.duration,duration:t.duration,producer:lab.id,research:true});return null;
    }
    if(cmd.type==='cancel'){
      if(!Number.isInteger(cmd.index)||cmd.index<0||cmd.index>=p.queue.length)return '无效队列';const[q]=p.queue.splice(cmd.index,1);spend(p,q.research?TECHS[q.kind as Tech].cost:unitCost(q.kind as MobileKind),-1);return null;
    }
    if(cmd.type==='build'){
      if(!ALL_BUILDING_KINDS.includes(cmd.kind)||!p.race&&!LEGACY_BUILDING_KINDS.some(k=>k===cmd.kind))return '无效建筑';const worker=this.state.units.find(u=>u.id===cmd.worker&&u.side===side&&u.kind==='worker');if(!worker)return '需要选择己方工程采集车';
      if(!validPoint(cmd.point,this.extent))return '无效坐标';const why=requirement(cmd.kind,p,this.state.units);if(why)return why;
      if(cmd.facing!==undefined&&!validFacing(cmd.facing))return '无效建筑朝向';
      const at=snapPoint(cmd.point),facing=cmd.facing??buildingFacing(cmd.kind,at,this.extent),error=placementError(side,cmd.kind,at,this.state.units,this.state.nodes,this.visible.get(side),facing,this.land(),this.state.oilWells,false,this.world);if(error)return error;
      // 模拟端也保护现有施工，防止连续点击或联机旧快照重复派遣同一辆车。
      if(!cmd.append&&!availableForConstruction(worker))return '工程采集车正在建造或维修，请选择其他车辆';
      if(cmd.append&&(worker.tasks?.length??0)>=16)return '任务队列已满';
      if(needsCoverage(cmd.kind)&&!covered(side,at,this.state.units))return '需要能量节点覆盖';
      if(!afford(p,unitCost(cmd.kind)))return '建造资源不足';
      const blocked=this.blockers();
      const reachable=cmd.kind==='oilwell'
        ?this.servicePoint({...worker,service:undefined},'build',{...at,id:0},STATS.oilwell.radius+65,blocked)
        :findPath(worker,at,blocked).length;
      if(!reachable)return '工程采集车无法抵达该地点';
      spend(p,unitCost(cmd.kind));const building=this.spawn(cmd.kind,side,at);building.facing=facing;building.construction=.01;building.hp=STATS[cmd.kind].hp*.01;building.builder=worker.id;
      if(cmd.append){building.reservedBuild=true;(worker.tasks??=[]).push({type:'resume-build',target:building.id});if(worker.order==='idle'||worker.order==='hold')this.nextTask(worker);return null;}
      this.clearTasks(worker);
      this.cancelAction(worker);worker.resumeResource=worker.order==='gather'?worker.resource??undefined:worker.resumeResource;delete worker.service;worker.blockedFor=0;worker.navigationProgress=undefined;
      worker.order='build';worker.target=building.id;worker.resource=null;worker.returning=false;this.route(worker,at);return null;
    }
    if(cmd.type==='resume-build'){
      const worker=this.state.units.find(u=>u.id===cmd.worker&&u.side===side&&availableForConstruction(u));
      if(!worker)return '没有可用的工程采集车，请等待完工或手动停止当前任务';
      const building=this.state.units.find(u=>u.id===cmd.target&&u.side===side&&unfinishedConstruction(u));
      if(!building)return '没有可继续施工的己方建筑';
      if(building.reservedBuild&&building.builder!==worker.id)return '该建筑已有工程采集车施工';
      if(this.state.units.some(u=>u.side===side&&u.hp>0&&u.kind==='worker'&&u.order==='build'&&u.target===building.id))return '该建筑已有工程采集车施工';
      // 续建使用原建筑和原进度，不重复扣除建造费用；先检查实际施工位置是否可达。
      const blocked=this.blockers(),place=this.servicePoint({...worker,service:undefined},'build',building,STATS[building.kind].radius+65,blocked);
      if(!place)return '工程采集车无法抵达该地点';
      worker.tasks=worker.tasks?.filter(t=>t.type!=='resume-build'||t.target!==building.id);this.clearTasks(worker);
      this.cancelAction(worker);worker.resumeResource=worker.order==='gather'?worker.resource??undefined:worker.resumeResource;delete worker.service;delete building.reservedBuild;
      worker.blockedFor=0;worker.navigationProgress=undefined;worker.order='build';worker.target=building.id;
      worker.resource=null;worker.returning=false;building.builder=worker.id;this.route(worker,place.point,blocked);return null;
    }
    if(cmd.type==='rally'){if(!validPoint(cmd.point,this.extent))return '无效坐标';p.rally=clampPoint(cmd.point,this.extent);return null;}
    const units=this.state.units.filter(u=>u.side===side&&cmd.ids.includes(u.id)&&isMobile(u));
    if(cmd.type==='repair'){
      const building=this.state.units.find(u=>u.id===cmd.target&&u.hp>0);
      if(!building||building.side!==side||isMobile(building)||!complete(building))return '只能维修己方已完工建筑';
      if(building.hp>=maxHp(building,p)-1e-6)return '建筑生命值已满';
      const workers=units.filter(u=>u.kind==='worker');if(!workers.length)return '请先选择工程采集车';
      const blocked=this.blockers();
      for(const u of workers){this.clearTasks(u);this.cancelAction(u);u.resumeResource=u.order==='gather'?u.resource??undefined:u.resumeResource;delete u.service;u.order='repair';u.target=building.id;u.resource=null;u.path=[];u.repath=0;u.blockedFor=0;u.navigationProgress=undefined;this.route(u,building,blocked);}
      return null;
    }
    if(cmd.type==='gather'){
      const node=this.state.nodes.find(n=>n.id===cmd.node&&n.amount>0);if(!node||!this.visible.get(side)?.[this.indexAt(node)])return '资源点不在当前视野内或已枯竭';
      if(node.kind==='oil'&&this.state.oilWells)return '请在油点上建造油井';
      if(node.kind==='oil'&&!this.has(side,'refinery'))return '需要先建造石油精炼厂';
      const workers=units.filter(u=>u.kind==='worker');if(!workers.length)return '请先选择工程采集车';
      const b=this.blockers();for(const u of workers){
        const target=node.tree===undefined?node:this.nearestNode(u,'wood',node);
        if(!target)continue;
        this.clearTasks(u);
        this.cancelAction(u);delete u.resumeResource;delete u.service;u.blockedFor=0;u.navigationProgress=undefined;u.order='gather';u.resource=target.id;u.target=null;u.returning=u.cargo>0;u.path=[];u.repath=0;if(!u.returning)this.route(u,target,b);
      }return null;
    }
    if(cmd.type==='stop'||cmd.type==='hold'){for(const u of units){this.clearTasks(u);this.cancelAction(u);delete u.resumeResource;delete u.service;u.velocity={x:0,y:0};u.path=[];u.target=null;u.destination=undefined;u.resource=null;u.order=cmd.type==='hold'?'hold':'idle';}return null;}
    if(cmd.type!=='order'||!validPoint(cmd.point,this.extent))return '无效指令';
    const target=this.state.units.find(u=>u.id===cmd.target&&this.visible.get(side)?.[this.indexAt(u)]);
    // 右键建筑与显式维修按钮走同一条权威命令；混编部队只让工程车参与维修。
    if(target?.side===side&&!isMobile(target)&&complete(target)&&target.hp<maxHp(target,p)&&units.some(u=>u.kind==='worker'))
      return this.command(side,{type:'repair',ids:units.filter(u=>u.kind==='worker').map(u=>u.id),target:target.id,append:cmd.append});
    const blocked=this.blockers(),cols=Math.ceil(Math.sqrt(units.length)),remaining=new Set(units);
    const reserved=this.state.units.filter(u=>u.hp>0&&isMobile(u)&&!remaining.has(u)&&(u.side===side||this.visible.get(side)?.[this.indexAt(u)]))
      .map(u=>({point:u.destination&&u.path.length&&u.side===side?u.destination:u,air:!!STATS[u.kind].air,radius:STATS[u.kind].radius}));
    // 步兵使用紧凑队形；混编时按最大的模型留位，碰撞半径仍由移动层约束。
    const spacing=Math.max(40,...units.map(u=>Math.max(STATS[u.kind].radius*2+8,Math.min(60,STATS[u.kind].size*.65))));
    const offset=(n:number)=>units.length>1?{x:(n%cols-(cols-1)/2)*spacing,y:(Math.floor(n/cols)-(Math.ceil(units.length/cols)-1)/2)*spacing}:{x:0,y:0};
    for(let n=0;n<units.length;n++){
      const delta=offset(n),hint=clampPoint({x:cmd.point.x+delta.x,y:cmd.point.y+delta.y},this.extent);
      let u:Unit|undefined,best=Infinity;
      for(const candidate of remaining){const d=distance(candidate,hint);if(d<best){best=d;u=candidate;}}
      if(!u)break;
      remaining.delete(u);
      this.clearTasks(u);
      this.cancelAction(u);delete u.resumeResource;delete u.service;u.blockedFor=0;u.navigationProgress=undefined;
      if(u.kind==='worker'&&target?.side===side&&!complete(target)){target.builder=u.id;u.order='build';u.target=target.id;u.resource=null;this.route(u,target,blocked);continue;}
      const enemy=target&&!this.allied(target.side,side)&&u.kind!=='worker'&&u.kind!=='medic'?target:undefined;
      u.target=enemy?.id??null;u.resource=null;u.order=enemy?'attack':cmd.assault&&isCombat(u)?'assault':'move';
      if(enemy){this.route(u,enemy,blocked);continue;}
      const radius=STATS[u.kind].radius,air=!!STATS[u.kind].air;
      const available=(point:Point)=>reserved.every(slot=>slot.air!==air||distance(slot.point,point)>=slot.radius+radius+6);
      const goal=landingNear(hint,radius,air?this.openSky:blocked,available)??hint;
      this.route(u,goal,blocked);
      if(u.destination)reserved.push({point:u.destination,air,radius});
    }
    return null;
  }
  private releaseTask(u:Unit,task:NonNullable<Unit['tasks']>[number]){
    if(task.type!=='resume-build')return;
    const building=this.state.units.find(b=>b.id===task.target&&b.side===u.side&&b.reservedBuild&&b.builder===u.id);
    if(building){spend(this.player(u.side),unitCost(building.kind),-1);this.state.units=this.state.units.filter(b=>b!==building);}
  }
  private clearTasks(u:Unit){for(const task of u.tasks??[])this.releaseTask(u,task);delete u.tasks;}
  private nextTask(u:Unit){
    const resume=u.resumeResource;
    while(u.tasks?.length){
      const task=u.tasks.shift()!,pending=u.tasks;delete u.tasks;
      const cmd:Command=task.type==='resume-build'?{...task,worker:u.id}:{...task,ids:[u.id]};
      const error=this.command(u.side,cmd);u.tasks=pending;u.resumeResource=resume;
      if(!error)return;
      this.releaseTask(u,task);
    }
    delete u.tasks;
    if(u.kind==='worker'&&resume!==undefined){
      const node=this.state.nodes.find(n=>n.id===resume&&n.amount>0);
      delete u.resumeResource;
      if(node){u.order='gather';u.resource=node.id;u.returning=u.cargo>0;u.target=null;u.path=[];delete u.service;u.repath=0;}
    }
  }
  updateVision(explore=true) {
    for(const p of this.state.players){const vis=new Uint8Array(this.world.land.length),explored=this.state.explored[p.side];
      for(const u of this.state.units)if(u.hp>0&&this.allied(u.side,p.side)){const x=Math.floor(u.x/TILE),y=Math.floor(u.y/TILE),r=complete(u)?STATS[u.kind].vision:4;
        for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(dx*dx+dy*dy<=r*r&&inBounds(x+dx,y+dy,this.size)){const i=(y+dy)*this.size+x+dx;vis[i]=1;if(explore)explored[i]=1;}}
      for(const a of this.skills.areas)if(a.skill==='RLY-03'&&a.until>this.state.time&&this.allied(a.side,p.side)){
        const x=Math.floor(a.x/TILE),y=Math.floor(a.y/TILE),r=a.radius/TILE;
        for(let dy=-Math.floor(r);dy<=r;dy++)for(let dx=-Math.floor(r);dx<=r;dx++)if(dx*dx+dy*dy<=r*r&&inBounds(x+dx,y+dy,this.size)){
          const cell=(y+dy)*this.size+x+dx;vis[cell]=1;if(explore)explored[cell]=1;
        }
      }
      this.visible.set(p.side,vis);
    }
    if(explore)for(const p of this.state.players)for(const ally of this.state.players)if(p!==ally&&this.allied(p.side,ally.side))
      for(let i=0;i<this.world.land.length;i++)if(this.state.explored[ally.side][i])this.state.explored[p.side][i]=1;
  }
  private acceptsCargo(depot:Unit,u:Unit){
    return depot.side===u.side&&depot.hp>0&&complete(depot)&&(
      depot.kind==='base'||depot.kind==='lumbermill'||depot.kind==='refinery'&&u.cargoKind!=='wood');
  }
  private deliveryDepot(u:Unit,blocked:Uint8Array){
    const depots=this.state.units.filter(b=>this.acceptsCargo(b,u)).sort((a,b)=>distance(a,u)-distance(b,u));
    if(u.service?.kind==='depot'){
      const current=depots.find(depot=>depot.id===u.service?.target);
      if(current)return current;
      delete u.service;u.path=[];u.repath=0;
    }
    if(u.repath>0)return;
    let best=Infinity,selected:Unit|undefined;
    for(const depot of depots){
      const reach=STATS[depot.kind].radius+65;
      if(distance(u,depot)-reach>best)continue;
      const probe={...u,service:undefined};
      const place=this.servicePoint(probe,'depot',depot,reach,blocked,true);
      if(!place)continue;
      const path=groundPath(u,place.point,blocked);
      let length=0,from:Point=u;
      for(const point of path){length+=distance(from,point);from=point;}
      if(distance(from,place.point)>1)continue;
      if(length<best){best=length;selected=depot;}
    }
    if(!selected)u.repath=1;
    return selected;
  }
  private nextGoldNode(u:Unit,depleted:ResourceNode){
    const explored=this.state.explored[u.side];
    return this.nearestNode(u,'gold',depleted,undefined,n=>distance(n,depleted)<=1200&&!!explored[this.indexAt(n)]);
  }
  private harvest(u: Unit, dt: number, blocked: Uint8Array) {
    const p=this.player(u.side);let node=this.state.nodes.find(n=>n.id===u.resource);
    const capacity=p.tech.includes('logistics')?150:100;
    if(node?.tree!==undefined&&u.service?.waiting&&!u.returning&&u.repath<=0){
      const next=this.nearestNode(u,'wood',node);
      if(next&&next.id!==node.id){node=next;u.resource=node.id;u.path=[];delete u.service;}
    }
    if(!node||node.amount<=0){
      if(!u.returning&&node?.tree!==undefined&&u.cargo<capacity){
        // 余货接着砍下一棵，避免每棵树都多跑一次半仓运输。
        const next=this.nearestNode(u,'wood');
        if(next){node=next;u.resource=node.id;u.path=[];u.repath=0;delete u.service;}
        else if(u.cargo>0)u.returning=true;
      }else if(u.cargo>0)u.returning=true;
      if(!node||node.amount<=0){
        if(!u.returning){
          const depleted=node;
          node=depleted?.kind==='gold'?this.nextGoldNode(u,depleted):depleted?this.nearestNode(u,depleted.kind):undefined;
          if(node){u.resource=node.id;u.path=[];delete u.service;}
          else if(depleted?.kind==='gold'){u.returning=true;u.repath=0;delete u.service;}
          else{u.order='idle';u.resource=null;u.path=[];delete u.service;return;}
        }
      }
    }
    if(u.returning){
      const depot=this.deliveryDepot(u,blocked);
      if(!depot){u.path=[];return;}
      if(this.approach(u,'depot',depot,STATS[depot.kind].radius+65,blocked)){
        if(u.cargoKind==='gold')p.credits+=u.cargo;else if(u.cargoKind==='wood')p.wood+=u.cargo;else if(u.cargoKind==='oil')p.oil+=u.cargo;
        if(u.cargoKind)(p.stats??=newMatchStats(this.state.time)).income[u.cargoKind]+=u.cargo;
        if(this.outposts.length&&this.state.oilWells&&u.cargoKind==='gold'&&u.cargo>0){
          const source=this.outposts.find(outpost=>outpost.id===u.cargoNode);
          if(source)recordMatchEvent(p,'outpostIncome',source,this.state.time);
        }
        delete u.cargoNode;
        p.harvested+=u.cargo;u.cargo=0;u.cargoKind=null;u.returning=false;u.path=[];u.repath=0;delete u.service;
        if(node?.kind==='gold'&&node.amount<=0){
          const next=this.nextGoldNode(u,node);
          u.resource=next?.id??null;
          if(!next){u.order='idle';u.waitingForGold=true;}
        }
      }
      return;
    }
    if(!node)return;
    if(node.kind==='oil'&&(this.state.oilWells||!this.has(u.side,'refinery'))){u.path=[];u.order='idle';delete u.service;return;}
    if(this.approach(u,'node',node,node.radius+30,blocked)){
      u.path=[];
      const rate=20*(p.tech.includes('logistics')?1.5:1)*(node.kind==='wood'&&this.has(u.side,'lumbermill')?1.5:1);
      const amount=Math.min(rate*dt,capacity-u.cargo,node.amount);if(amount>0)u.activity='gather';u.cargo+=amount;node.amount=Math.max(0,node.amount-amount);u.cargoKind=node.kind;
      if(this.outposts.length&&this.state.oilWells&&node.kind==='gold'&&amount>0){
        u.cargoNode=node.id;
        if(node.startSide===u.side&&node.amount<=800)recordMatchEvent(p,'mainGoldLow',node,this.state.time);
      }
      u.angle=Math.atan2(node.y-u.y,node.x-u.x);
      if(u.cargo>=capacity-1e-6||node.amount<=0){u.returning=u.cargo>=capacity-1e-6||node.tree===undefined;u.path=[];u.repath=0;delete u.service;}
    }
  }
  private move(u: Unit, dt: number) {
    const scale=motionScale(u);if(scale===0)return;
    this.movement.move(u,dt*scale);
    if(u.order==='move'&&!u.path.length){
      u.order='idle';u.destination=undefined;u.navigationProgress=undefined;u.blockedFor=0;
    }
  }
  private production(dt: number) {
    for(const p of this.state.players){if(!this.base(p.side))continue;const seen=new Set<number>(),power=powerFor(p.side,this.state.units);
      for(const q of [...p.queue]){
        const producer=this.state.units.find(u=>u.id===q.producer&&u.side===p.side&&complete(u));
        if(!producer){p.queue.splice(p.queue.indexOf(q),1);spend(p,q.research?TECHS[q.kind as Tech].cost:unitCost(q.kind as MobileKind),-1);continue;}
        if(seen.has(q.producer))continue;seen.add(q.producer);
        if((!p.race||p.race==='industrial')&&producer.kind!=='base'&&!power.active||producer.station||producer.refitUntil!==undefined||
          needsCoverage(producer.kind)&&!covered(p.side,producer,this.state.units))continue;
        producer.activity='produce';q.remaining=Math.max(0,q.remaining-dt);if(q.remaining>1e-6)continue;
        p.queue.splice(p.queue.indexOf(q),1);
        if(q.research){this.emit('complete',producer);const tech=q.kind as Tech;p.tech.push(tech);if(tech==='armor')for(const u of this.state.units)if(u.side===p.side&&armorApplies(u,p))u.hp*=1.25;
        }else{
          const kind=q.kind as MobileKind,u=this.spawn(kind,p.side,this.freeSpawn(producer,kind));const stats=p.stats??=newMatchStats(this.state.time);stats.trained[kind]=(stats.trained[kind]??0)+1;this.emit('spawn',u);this.emit('complete',producer);
          if(kind==='tank'&&this.outposts.length&&this.state.oilWells)recordMatchEvent(p,'firstTank',u,this.state.time);
          if(u.kind==='worker'){const workers=this.state.units.filter(u=>u.side===p.side&&u.kind==='worker'),kind=!this.state.oilWells&&workers.length%3===0&&this.has(p.side,'refinery')?'oil':workers.length%2===0?'wood':'gold';const node=this.nearestNode(u,kind);if(node)this.command(p.side,{type:'gather',ids:[u.id],node:node.id});}
          else if(p.rally)this.command(p.side,{type:'order',ids:[u.id],point:p.rally,assault:true});
        }
      }
    }
  }
  private advanceBuilding(building:Unit,dt:number){
    const stat=STATS[building.kind],amount=Math.min(1-building.construction,dt/stat.build);
    building.construction+=amount;building.hp=Math.min(stat.hp,building.hp+amount*stat.hp);
    if(building.construction<1-1e-6)return false;
    building.construction=1;building.builder=null;delete building.launched;this.emit('complete',building);return true;
  }
  private beginAttack(u:Unit,target:Unit,healing=false){
    if(u.action||this.state.windups.some(a=>a.source===u.id))return;
    const spec=weapon(u.kind);u.cooldown=STATS[u.kind].cooldown/(healing?1:attackScale(u,this.state.time));u.activity='attack';u.path=[];delete u.yieldPoint;u.velocity={x:0,y:0};
    u.action={started:this.state.time,fired:null,until:this.state.time+spec.windup+spec.recovery};
    this.state.windups.push({source:u.id,target:target.id,fireAt:this.state.time+spec.windup,healing});this.emit('attack',u);
  }
  private aim(u:Unit,target:Point,dt:number){
    const goal=Math.atan2(target.y-u.y,target.x-u.x),delta=Math.atan2(Math.sin(goal-u.angle),Math.cos(goal-u.angle)),rate=u.kind==='tank'?2.8:u.kind==='artillery'?2.4:STATS[u.kind].air?6:9;
    u.angle+=Math.max(-rate*dt,Math.min(rate*dt,delta));u.angle=Math.atan2(Math.sin(u.angle),Math.cos(u.angle));
    return Math.abs(Math.atan2(Math.sin(goal-u.angle),Math.cos(goal-u.angle)))<.12;
  }
  private hit(v:Unit,shot:Shot,factor=1){
    if(v.hp<=0)return;
    const owner=this.player(shot.side),multiplier=shot.kind==='sniper'&&['soldier','medic','sniper'].includes(v.kind)?1.5:1;
    const amount=this.skills.absorb(v,(shot.damage??0)*multiplier*factor,!!shot.splash,!shot.splash&&STATS[shot.kind].range>80);
    this.applyDamage(v,owner,amount);
  }
  skillDamage(v:Unit,side:Side,amount:number){
    this.applyDamage(v,this.player(side),this.skills.absorb(v,amount));
  }
  private applyDamage(v:Unit,owner:Player,amount:number){
    (owner.stats??=newMatchStats(this.state.time)).damage+=Math.min(v.hp,amount);v.hp-=amount;this.emit('damage',v);
    if(amount>0&&this.outposts.length&&this.state.oilWells){
      const defender=this.player(v.side),time=this.state.time;
      const outpost=this.outposts.find(node=>distance(node,v)<=OUTPOST_FIGHT_RANGE);
      if(outpost){
        if(this.visible.get(owner.side)?.[this.indexAt(v)])recordMatchEvent(owner,'outpostFight',outpost,time);
        recordMatchEvent(defender,'outpostFight',outpost,time);
      }
      if(v.kind==='refinery'||v.kind==='oilwell'||v.kind==='lumbermill'||v.kind==='worker'&&v.order==='gather')
        recordMatchEvent(defender,'supplyRaid',v,time);
    }
    if(v.hp<=0){owner.kills++;this.player(v.side).lost++;const bounty=STATS[v.kind].cost*.2;owner.credits+=bounty;owner.stats.bounty+=bounty;recordKill(owner,this.player(v.side),v);}
  }
  private impact(shot:Shot){
    this.emit('impact',{id:shot.source??1,kind:shot.kind,side:shot.side,x:shot.tx,y:shot.ty,angle:Math.atan2(shot.ty-shot.y,shot.tx-shot.x)});
    for(const v of this.state.units){
      if(v.hp<=0||this.allied(v.side,shot.side)||(groundOnly(shot.kind)&&STATS[v.kind].air))continue;
      const d=distance(v,{x:shot.tx,y:shot.ty});
      if(shot.splash?d<shot.splash:v.id===shot.target)this.hit(v,shot,shot.splash?Math.max(BALANCE.splashMinimum,1-d/shot.splash*(1-BALANCE.splashMinimum)):1);
    }
  }
  private advanceShots(dt:number){
    const keep:Shot[]=[];
    for(const shot of this.state.shots){
      shot.life=shot.firedAt!==undefined&&shot.duration!==undefined?shot.duration-(this.state.time-shot.firedAt):shot.life-dt;
      if(shot.life<=1e-6){if(shot.mode==='shell')this.impact(shot);}else keep.push(shot);
    }
    this.state.shots=keep;
  }
  private releaseAttacks(dt:number){
    const byId=new Map(this.state.units.map(u=>[u.id,u])),ready:{u:Unit;target:Unit;healing:boolean}[]=[],waiting:GameState['windups']=[];
    for(const attack of this.state.windups){
      const u=byId.get(attack.source),target=byId.get(attack.target);
      if(!u||u.hp<=0||!u.action)continue;
      const valid=target&&target.hp>0&&(attack.healing?this.allied(target.side,u.side):!this.allied(target.side,u.side)&&this.visible.get(u.side)?.[this.indexAt(target)])&&distance(u,target)-STATS[target.kind].radius<=STATS[u.kind].range;
      if(!valid){delete u.action;u.cooldown=Math.min(u.cooldown,.15);continue;}
      const aimed=this.aim(u,target,dt);
      if(attack.fireAt>this.state.time+1e-6||!aimed){if(!aimed)u.action.until=this.state.time+weapon(u.kind).recovery+.15;waiting.push(attack);continue;}
      ready.push({u,target,healing:attack.healing});
    }
    this.state.windups=waiting;
    for(const {u,target,healing} of ready){
      const spec=weapon(u.kind);u.angle=Math.atan2(target.y-u.y,target.x-u.x);u.action!.fired=this.state.time;u.action!.until=this.state.time+spec.recovery;this.emit('fire',u);
      const barrel=Math.min(STATS[u.kind].size*.32,distance(u,target)*.6),muzzle={x:u.x+Math.cos(u.angle)*barrel,y:u.y+Math.sin(u.angle)*barrel};
      const duration=spec.speed?Math.max(.12,distance(muzzle,target)/spec.speed):spec.trace;
      const shot:Shot={...muzzle,tx:target.x,ty:target.y,kind:u.kind,side:u.side,life:duration,duration,firedAt:this.state.time,source:u.id,target:target.id,mode:spec.speed?'shell':'beam',damage:STATS[u.kind].damage*(weaponsApplies(u,this.player(u.side))?1.2:1),splash:STATS[u.kind].splash};
      this.state.shots.push(shot);
      if(healing){const owner=this.player(u.side);const restored=owner.race?this.skills.heal(target,BALANCE.medicHeal):Math.min(maxHp(target,this.player(target.side))-target.hp,BALANCE.medicHeal);if(!owner.race)target.hp+=restored;(this.player(u.side).stats??=newMatchStats(this.state.time)).healing+=restored;this.emit('heal',target);}
      else if(!spec.speed)this.impact(shot);
    }
  }
  step(dt=1/20) {
    if(this.state.winner||!Number.isFinite(dt)||dt<=0)return;dt=Math.min(dt,.25);const s=this.state;s.time+=dt;s.events=s.events.filter(e=>s.time-e.time<4);
    const operatingWells=this.outposts.length&&s.oilWells?s.units.filter(u=>u.kind==='oilwell'&&u.activity==='produce'):[];
    for(const u of s.units){u.activity='idle';u.velocity={x:0,y:0};if(u.action?.fired!==null&&u.action&&s.time>=u.action.until)delete u.action;}
    this.skills.tick(dt);
    this.advanceShots(dt);this.releaseAttacks(dt);
    for(const well of operatingWells){
      const node=oilNodeAt(well,s.nodes);
      if(node&&node.amount>0&&(well.hp<=0||!hasRefinery(well.side,s.units)))
        recordMatchEvent(this.player(well.side),'oilStopped',well,s.time);
    }
    for(const u of s.units)if(u.refitUntil!==undefined&&u.refitUntil<=s.time)delete u.refitUntil;
    this.production(dt);
    if(s.oilWells)for(const well of s.units){
      if(well.kind!=='oilwell'||well.hp<=0||!complete(well)||!this.base(well.side))continue;
      const node=oilNodeAt(well,s.nodes);
      if(!node||node.amount<=0||!hasRefinery(well.side,s.units))continue;
      const amount=Math.min(node.amount,OIL_PER_SECOND*dt),player=this.player(well.side);
      well.activity='produce';node.amount-=amount;player.oil+=amount;player.harvested+=amount;
      (player.stats??=newMatchStats(s.time)).income.oil+=amount;
      if(this.outposts.length){
        if(isOutpost(node))recordMatchEvent(player,'outpostIncome',node,s.time);
        if(node.startSide===well.side&&node.amount<=OIL_PER_SECOND*35)recordMatchEvent(player,'mainOilLow',node,s.time);
      }
    }
    const byId=new Map(s.units.map(u=>[u.id,u])),blocked=this.blockers();
    this.movement=new Movement(s.units,blocked,(a,b)=>this.allied(a,b));this.movement.separate();
    const buckets=new Map<string,Unit[]>();for(const u of s.units){const key=`${Math.floor(u.x/320)},${Math.floor(u.y/320)}`,a=buckets.get(key)||[];a.push(u);buckets.set(key,a);}
    const nearby=(p:Point,range=320)=>{const list:Unit[]=[],x=Math.floor(p.x/320),y=Math.floor(p.y/320),r=Math.ceil(range/320);for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)list.push(...buckets.get(`${x+dx},${y+dy}`)||[]);return list;};
    for(const u of s.units)if(u.launched&&u.hp>0&&!complete(u)&&(!needsCoverage(u.kind)||covered(u.side,u,s.units)))this.advanceBuilding(u,dt);
    const repairSlots=new Map<number,number>();
    for(const u of s.units){if(u.hp<=0||!complete(u))continue;const stats=STATS[u.kind],owner=this.player(u.side);u.cooldown=Math.max(0,u.cooldown-dt);u.repath=Math.max(0,u.repath-dt);
      if(u.station){this.stepStation(u,dt,blocked);continue;}
      if(u.ability?.cast||(u.ability?.recovery??0)>s.time)continue;
      if(u.kind==='worker'){
        if(u.order==='gather'){
          const returning=u.returning;this.harvest(u,dt,blocked);
          // 采集任务在一轮交付后让出队列，避免无限采集阻塞后续工作。
          if(returning&&!u.returning&&u.tasks?.length){u.resumeResource=u.resource??u.resumeResource;u.order='idle';u.path=[];this.nextTask(u);}
        }
        if(u.order==='build'){
          const building=u.target?byId.get(u.target):undefined;
          if(!building||building.hp<=0||complete(building)){u.order='idle';u.target=null;u.path=[];delete u.service;}
          else if((!needsCoverage(building.kind)||covered(u.side,building,s.units))&&this.approach(u,'build',building,STATS[building.kind].radius+65,blocked)){u.path=[];u.activity='build';u.angle=Math.atan2(building.y-u.y,building.x-u.x);if(owner.race==='stellar'){
            building.launched=true;building.builder=null;u.order='idle';u.target=null;delete u.service;
          }else if(this.advanceBuilding(building,dt)){u.order='idle';u.target=null;delete u.service;}}

        }
        if(u.order==='repair'){
          const building=u.target?byId.get(u.target):undefined;
          if(!building||building.hp<=0||building.side!==u.side||isMobile(building)||!complete(building)||building.hp>=maxHp(building,owner)-1e-6){
            u.order='idle';u.resource=null;u.target=null;u.path=[];u.repath=0;delete u.service;
          }else if((!needsCoverage(building.kind)||covered(u.side,building,s.units))&&this.approach(u,'build',building,STATS[building.kind].radius+65,blocked)){
            u.path=[];u.angle=Math.atan2(building.y-u.y,building.x-u.x);
            const slot=repairSlots.get(building.id)??0;repairSlots.set(building.id,slot+1);
            const proposed=Math.min(maxHp(building,owner)-building.hp,dt*BALANCE.repairHpPerSecond*(BALANCE.repairWorkerWeights[slot]??0));
            const cost=unitCost(building.kind),fraction=proposed/maxHp(building,owner)*BALANCE.repairCostFraction;
            const available=Math.min(1,...([['credits','gold'],['wood','wood'],['oil','oil']] as const).map(([bank,key])=>cost[key]*fraction>0?Math.max(0,owner[bank])/(cost[key]*fraction):1));
            if(proposed>0&&available>0){spend(owner,cost,fraction*available);building.hp=Math.min(maxHp(building,owner),building.hp+proposed*available);u.activity='repair';if(u.cooldown<=0){this.emit('heal',building);u.cooldown=.8;}}
          }
        }
        this.move(u,dt);if(u.order==='idle')this.nextTask(u);continue;
      }
      let attacking=false;
      if(u.kind==='medic'&&u.order!=='move'&&u.cooldown<=0&&u.ability?.auto!==false&&(!owner.race||!u.target)){
        const pending=owner.race?new Set(this.state.windups.filter(a=>a.healing).map(a=>a.target)):null;
        const patient=nearby(u).filter(v=>this.allied(v.side,u.side)&&v.id!==u.id&&isCombat(v)&&!STATS[v.kind].air&&v.hp>0&&v.hp<maxHp(v,this.player(v.side))&&(owner.race?distance(v,u)-STATS[v.kind].radius:distance(v,u))<stats.range).sort((a,b)=>Number(pending?.has(a.id)??false)-Number(pending?.has(b.id)??false)||a.hp/maxHp(a,this.player(a.side))-b.hp/maxHp(b,this.player(b.side))||distance(a,u)-distance(b,u)||a.id-b.id)[0];
        if(patient){attacking=true;if(this.aim(u,patient,dt))this.beginAttack(u,patient,true);}
      }
      if(stats.damage>0){
        const mayHit=(other:Unit)=>!(STATS[other.kind].air&&groundOnly(u.kind));
        let target=u.target?byId.get(u.target):undefined;
        if(u.target&&!target)u.target=null;
        if(target&&(target.hp<=0||this.allied(target.side,u.side)||!mayHit(target)||!this.visible.get(u.side)?.[this.indexAt(target)])){u.target=null;target=undefined;}
        if(!target&&u.order!=='move'){
          let min=stats.range+((u.order==='assault'||u.order==='idle')&&isMobile(u)?96:0);
          for(const other of nearby(u,min))if(!this.allied(other.side,u.side)&&other.hp>0&&mayHit(other)&&this.visible.get(u.side)?.[this.indexAt(other)]){const d=distance(u,other)-STATS[other.kind].radius;if(d<min){target=other;min=d;}}
          if(target)u.target=target.id;
        }
        if(target){const d=distance(u,target)-STATS[target.kind].radius;
          if(d<=stats.range){attacking=true;const aimed=u.action?.fired===null||this.aim(u,target,dt);
            if(u.cooldown<=0&&aimed)this.beginAttack(u,target);
          }else if(isMobile(u)&&u.order!=='hold'&&u.repath<=0)this.route(u,target,blocked);
        }
      }
      if(u.action?.fired===null)attacking=true;
      if(!attacking&&isMobile(u)&&u.order!=='hold'){
        if(!u.target&&u.order==='assault'&&!u.path.length&&u.destination&&distance(u,u.destination)>24&&u.repath<=0)this.route(u,u.destination,blocked);
        this.move(u,dt);if(!u.path.length&&!u.target&&u.order==='attack')u.order='idle';
      }
    }
    for(const u of s.units){
      if(u.hp<=0){this.clearTasks(u);this.emit('death',u);}
      else if(isMobile(u)&&(u.order==='idle'||u.order==='assault'&&!u.path.length&&!u.target))this.nextTask(u);
    }
    s.units=s.units.filter(u=>u.hp>0);s.windups=s.windups.filter(a=>s.units.some(u=>u.id===a.source));
    const alive=s.players.filter(p=>this.base(p.side));if(alive.length&&new Set(alive.map(p=>teamOf(p.side,s.players))).size===1)s.winner=alive[0].side;
    for(const p of s.players)recordEconomy(p,s.units,s.time,dt);
    if(Math.floor(s.time*5)!==Math.floor((s.time-dt)*5))this.updateVision();
    s.aiTimer-=dt;if(s.aiTimer<=0){s.aiTimer=2;this.ai();}
  }
  ai() {
    runAI(this);
  }
  view(side: Side): ViewState {
    const vis=this.visible.get(side)||new Uint8Array(this.world.land.length),explored=this.state.explored[side];
    const revealed=this.state.units.filter(u=>this.allied(u.side,side)||vis[this.indexAt(u)]);
    return {
      ...(this.state.mapHash?{mapHash:this.state.mapHash}:{}),...(this.state.oilWells?{oilWells:true as const}:{}),mapId:this.world.id as MapId,mapRevision:this.world.revision,time:this.state.time,
      events:this.state.events.filter(e=>(e.audience&(1<<side))!==0&&(this.allied(e.side,side)||vis[this.indexAt(e)])).map(({audience,...e})=>e),
      units:revealed.map(u=>({...u,navigationStalled:u.side===side?u.navigationStalled:undefined,navigationRetries:u.side===side?u.navigationRetries:undefined,tasks:u.side===side?u.tasks:undefined,resumeResource:u.side===side?u.resumeResource:undefined,ability:u.ability&&(u.side===side?u.ability:{
        energy:0,cooldowns:{},effects:u.ability.effects.map(({source,...status})=>({...status,source:0})),
        cast:u.ability.cast?{skill:u.ability.cast.skill,until:u.ability.cast.until,
          point:u.ability.cast.point&&vis[this.indexAt(u.ability.cast.point)]?u.ability.cast.point:undefined}:undefined,
      }),station:u.station&&u.side!==side?{mode:u.station.mode}:u.station,maxHp:maxHp(u,this.player(u.side)),service:u.side===side?u.service:undefined,waitingForGold:u.side===side?u.waitingForGold:undefined,cargoNode:undefined,yieldOrigin:u.side===side?u.yieldOrigin:undefined,yieldPoint:u.side===side?u.yieldPoint:undefined,yieldTo:u.side===side?u.yieldTo:undefined,navigationProgress:u.side===side?u.navigationProgress:undefined,destination:u.side===side?u.destination:undefined,path:u.side===side?u.path:[],resource:u.side===side?u.resource:null,cargo:u.side===side?u.cargo:0})),
      nodes:this.state.nodes.filter(n=>explored[this.indexAt(n)]),
      areas:this.skills.visibleAreas(side),areaEdges:this.skills.visibleEdges(side),
      // 战局结束前只发送本人的经济统计，盟友关系不授予银行和指令权限。
      players:this.state.players.map(p=>({...p,stats:p.side===side||this.state.winner?p.stats:undefined,credits:p.side===side?p.credits:0,wood:p.side===side?p.wood:0,oil:p.side===side?p.oil:0,tech:p.side===side?p.tech:[],queue:p.side===side?p.queue:[],rally:p.side===side?p.rally:null,harvested:p.side===side?p.harvested:0})),
      shots:this.state.shots.filter(q=>vis[this.indexAt(q)]||(q.mode==='shell'&&vis[this.indexAt({x:q.x+(q.tx-q.x)*(1-q.life/(q.duration??.3)),y:q.y+(q.ty-q.y)*(1-q.life/(q.duration??.3))})])).map(({damage,splash,source,target,...q})=>q),
      winner:this.state.winner,explored,visible:vis,difficulty:this.state.difficulty,
    };
  }
  save() { return JSON.stringify(this.state); }
  static restore(json: string) {
    const state:unknown=JSON.parse(json);
    if(!validSave(state))throw Error('存档格式无效或地图不受支持');
    // 旧版 v2 存档没有地图字段，始终还原到原始神庙布局。
    state.mapId??=DEFAULT_MAP_ID;
    state.mapRevision??=1;
    const engine=new Engine(state.players,state.difficulty,state.mapId,state.mapRevision,state.mapHash);
    state.events??=[];state.nextEventId??=1;state.windups??=[];state.aiPlans??={};for(const p of state.players){p.team??=p.side;p.stats??=newMatchStats(state.time);}engine.state=state;engine.updateVision(false);return engine;
  }
}
export function validPoint(p: unknown,extent=WORLD): p is Point {return !!p&&typeof p==='object'&&'x'in p&&'y'in p&&typeof p.x==='number'&&typeof p.y==='number'&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<extent&&p.y<extent;}
function validSave(s: unknown): s is GameState {
  if(!s||typeof s!=='object')return false;const v=s as GameState;
  if(v.oilWells!==undefined&&v.oilWells!==true)return false;
  if(isCustomMapId(v.mapId)){
    try{
      const snapshot=validateMapSnapshot(v.customMap);
      if(snapshot.version.mapId!==v.mapId||snapshot.version.contentHash!==v.mapHash||v.mapRevision!==1)return false;
      registerMapSnapshot(snapshot);
    }catch{return false;}
  }else{
    if(v.mapId!==undefined&&!isMapId(v.mapId)||v.customMap!==undefined||v.mapHash!==undefined)return false;
    if(v.mapRevision!==undefined&&!validMapRevision(v.mapId??DEFAULT_MAP_ID,v.mapRevision))return false;
  }
  if(v.version!==2||!Number.isFinite(v.time)||v.time<0||!Number.isInteger(v.nextId)||!['easy','normal','hard'].includes(v.difficulty)||!Number.isFinite(v.aiTimer)||!Array.isArray(v.players)||v.players.length<2||v.players.length>4||!Array.isArray(v.units)||v.units.length>(v.players.some(p=>p.race)?720:500)||!Array.isArray(v.nodes)||v.nodes.length>4096||!Array.isArray(v.shots)||v.shots.length>2000||!v.explored)return false;
  if(isMapId(v.mapId??DEFAULT_MAP_ID)&&!supportsPlayers(v.mapId??DEFAULT_MAP_ID,v.players.length))return false;
  const world=getWorld(v.mapId??DEFAULT_MAP_ID,v.mapRevision??1,v.mapHash);
  if(v.players.length>world.bases.length)return false;
  const extent=gridSize(world.land)*TILE;
  const point=(p:unknown)=>validPoint(p,extent);
  if(v.nextEventId!==undefined&&(!Number.isSafeInteger(v.nextEventId)||v.nextEventId<1))return false;
  const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
  const number=(n:unknown,min:number,max:number)=>finite(n)&&Number(n)>=min&&Number(n)<=max;
  const entityId=(n:unknown)=>Number.isSafeInteger(n)&&number(n,1,v.nextId-1);
  if(v.areas!==undefined&&(!Array.isArray(v.areas)||v.areas.length>240||new Set(v.areas.map(a=>a?.id)).size!==v.areas.length||
    !v.areas.every(a=>a&&point(a)&&entityId(a.id)&&entityId(a.source)&&v.players.some(p=>p.side===a.side)&&
      sustainedAreas.includes(a.skill)&&a.radius===ABILITIES[a.skill].radius&&number(a.until,0,v.time+6))))return false;
  for(const u of v.units){
    if(!u)return false;
    if(u.reservedBuild!==undefined&&(u.reservedBuild!==true||isMobile(u)||u.construction!==.01))return false;
    if(u.tasks!==undefined&&(!isMobile(u)||!Array.isArray(u.tasks)||u.tasks.length>16||u.tasks.some(t=>!t||
      (t.type==='order'?(!point(t.point)||t.target!==undefined&&!entityId(t.target)||t.assault!==undefined&&typeof t.assault!=='boolean'):
      t.type==='gather'?(u.kind!=='worker'||!entityId(t.node)):
      t.type==='repair'||t.type==='resume-build'?(u.kind!=='worker'||!entityId(t.target)):true))))return false;
    if(!u||u.shield!==undefined&&!number(u.shield,0,maxShield(u))||u.shieldHit!==undefined&&!number(u.shieldHit,0,v.time))return false;
    if(u.station&&(u.kind!=='assembly'||!['packing','mobile','deploying'].includes(u.station.mode)||
      u.station.mode!=='mobile'&&!number(u.station.until,0,v.time+8)||u.station.mode==='deploying'&&!point(u.station.point)))return false;
    if(u.factoryModule!==undefined&&(u.kind!=='factory'||!['armor','support'].includes(u.factoryModule)))return false;
    if(u.refitUntil!==undefined&&(u.kind!=='factory'||!number(u.refitUntil,0,v.time+9)))return false;
    if(u.launched!==undefined&&u.launched!==true)return false;
    const a=u.ability;if(a===undefined)continue;
    if(!a||!number(a.energy,0,100)||a.auto!==undefined&&typeof a.auto!=='boolean'||!a.cooldowns||typeof a.cooldowns!=='object'||Array.isArray(a.cooldowns)||
      Object.entries(a.cooldowns).some(([id,at])=>!isAbility(id)||!number(at,0,v.time+30))||!Array.isArray(a.effects)||a.effects.length>720||
      a.effects.some(s=>!s||!Object.hasOwn(statusLabels,s.group)||!entityId(s.source)||!v.players.some(p=>p.side===s.side)||
        !isAbility(s.skill)||!number(s.value,0,60)||!number(s.until,0,v.time+6.1)))return false;
    if(a.cast&&(!isAbility(a.cast.skill)||ABILITIES[a.cast.skill].unit!==u.kind||!number(a.cast.until,0,v.time+1)||
      a.cast.target!==undefined&&!entityId(a.cast.target)||a.cast.point!==undefined&&!point(a.cast.point)||a.cast.area!==undefined&&!entityId(a.cast.area)))return false;
    if(a.recovery!==undefined&&!number(a.recovery,0,v.time+.25))return false;
    if(a.healing!==undefined&&(!Array.isArray(a.healing)||a.healing.length>140||a.healing.some(h=>!h||!number(h.amount,0,20)||!number(h.until,0,v.time+1))))return false;
    if(a.feedback!==undefined&&(!a.feedback||typeof a.feedback.text!=='string'||a.feedback.text.length>80||!number(a.feedback.until,0,v.time+2)))return false;
  }

  if(v.units.some(u=>u.yieldOrigin!==undefined&&!point(u.yieldOrigin)||u.navigationStalled!==undefined&&(!finite(u.navigationStalled)||u.navigationStalled<0)||u.navigationRetries!==undefined&&(!Number.isSafeInteger(u.navigationRetries)||u.navigationRetries<0)))return false;
  if(v.windups!==undefined&&(!Array.isArray(v.windups)||v.windups.length>560||new Set(v.windups.map(a=>a.source)).size!==v.windups.length||!v.windups.every(a=>a&&Number.isSafeInteger(a.source)&&a.source>0&&a.source<v.nextId&&Number.isSafeInteger(a.target)&&a.target>0&&a.target<v.nextId&&finite(a.fireAt)&&a.fireAt>=0&&a.fireAt<=v.time+2&&typeof a.healing==='boolean')))return false;
  if(!v.units.every(u=>(u.navigationProgress===undefined||finite(u.navigationProgress)&&u.navigationProgress>=0)&&(u.yieldPoint===undefined||point(u.yieldPoint))&&(u.travel===undefined||finite(u.travel)&&u.travel>=0&&u.travel<=1e12)&&(u.blockedFor===undefined||finite(u.blockedFor)&&u.blockedFor>=0)&&(u.velocity===undefined||u.velocity&&finite(u.velocity.x)&&finite(u.velocity.y)&&Math.abs(u.velocity.x)<=1000&&Math.abs(u.velocity.y)<=1000)&&(u.service===undefined||u.service&&['node','depot','build'].includes(u.service.kind)&&Number.isSafeInteger(u.service.target)&&u.service.target>0&&point(u.service.point)&&typeof u.service.waiting==='boolean')&&(u.action===undefined||u.action&&finite(u.action.started)&&u.action.started>=0&&u.action.started<=v.time&&finite(u.action.until)&&u.action.until>=u.action.started&&u.action.until<=v.time+5&&(u.action.fired===null||finite(u.action.fired)&&u.action.fired>=u.action.started&&u.action.fired<=v.time))))return false;
  if(v.events!==undefined&&(!Array.isArray(v.events)||v.events.length>512||!v.events.every(e=>point(e)&&Number.isSafeInteger(e.id)&&e.id>0&&e.id<(v.nextEventId??1)&&Number.isSafeInteger(e.unit)&&e.unit>0&&Object.hasOwn(STATS,e.kind)&&[1,2,3,4].includes(e.side)&&Number.isFinite(e.angle)&&Number.isFinite(e.time)&&e.time>=0&&e.time<=v.time&&Number.isInteger(e.audience)&&e.audience>=0&&e.audience<=30&&(['attack','fire','impact','heal','damage','death','spawn','complete'].includes(e.type)&&e.skill===undefined||e.type==='cast'&&isAbility(e.skill)&&ABILITIES[e.skill].unit===e.kind))))return false;
  if(!v.units.every(u=>(u.waitingForGold===undefined||u.waitingForGold===true&&u.kind==='worker')&&(u.resumeResource===undefined||u.kind==='worker'&&Number.isSafeInteger(u.resumeResource)&&u.resumeResource>0)&&(u.yieldTo===undefined||Number.isSafeInteger(u.yieldTo)&&u.yieldTo>0&&u.yieldTo<v.nextId&&u.yieldTo!==u.id)&&(u.facing===undefined||ALL_BUILDING_KINDS.includes(u.kind as BuildingKind)&&validFacing(u.facing))&&(u.activity===undefined||['idle','move','attack','gather','build','repair','produce'].includes(u.activity))))return false;
  if(v.events?.some(e=>e.facing!==undefined&&(!validFacing(e.facing)||isMobile(e))))return false;
  const sides=new Set(v.players.map(p=>p.side));if(sides.size!==v.players.length)return false;
  if(v.players.some(p=>p.race!==undefined&&!isRace(p.race)||p.team!==undefined&&!sides.has(p.team)||p.aiStyle!==undefined&&!['balanced','rush','economic','defensive'].includes(p.aiStyle)||p.stats!==undefined&&!validMatchStats(p.stats,v.time,extent)))return false;
  if(new Set(v.players.map(p=>p.team??p.side)).size<2)return false;
  if(v.aiPlans!==undefined&&(!v.aiPlans||typeof v.aiPlans!=='object'||Object.entries(v.aiPlans).some(([side,plan])=>!sides.has(Number(side) as Side)||!plan||!['balanced','rush','economic','defensive'].includes(plan.style)||!finite(plan.nextAttack)||plan.nextAttack<0||!finite(plan.lastPlan)||plan.lastPlan<0||plan.lastPlan>v.time||(plan.target!==undefined&&!point(plan.target))||!Array.isArray(plan.contacts)||plan.contacts.length>128||!plan.contacts.every(c=>point(c)&&Number.isSafeInteger(c.id)&&c.id>0&&Object.hasOwn(STATS,c.kind)&&sides.has(c.side)&&finite(c.seen)&&c.seen>=0&&c.seen<=v.time&&finite(c.hp)&&c.hp>0))))return false;
  if(v.players.some(p=>p.side>world.bases.length))return false;
  if(!v.players.every(p=>[1,2,3,4].includes(p.side)&&typeof p.name==='string'&&[p.credits,p.wood,p.oil,p.harvested,p.kills,p.lost].every(n=>Number.isFinite(n)&&n>=0)&&Array.isArray(p.tech)&&p.tech.every(t=>Object.hasOwn(TECHS,t))&&Array.isArray(p.queue)&&p.queue.length<=24&&p.queue.every(q=>q&&typeof q.research==='boolean'&&(q.research?Object.hasOwn(TECHS,q.kind):ALL_MOBILE_KINDS.includes(q.kind as MobileKind))&&Number.isFinite(q.remaining)&&q.remaining>=0&&Number.isFinite(q.duration)&&q.duration>0&&Number.isInteger(q.producer))&&typeof p.ai==='boolean'&&(p.rally===null||point(p.rally))&&Array.isArray(v.explored[p.side])&&v.explored[p.side].length===world.land.length&&v.explored[p.side].every(n=>n===0||n===1)))return false;
  const ids=new Set<number>();for(const u of v.units){if(!point(u)||!Object.hasOwn(STATS,u.kind)||!sides.has(u.side)||!Number.isInteger(u.id)||u.id<=0||ids.has(u.id)||u.id>=v.nextId||!Number.isFinite(u.hp)||u.hp<=0||u.hp>maxHp(u,v.players.find(p=>p.side===u.side)!)+1||!Number.isFinite(u.angle)||!Number.isFinite(u.cooldown)||!Number.isFinite(u.repath)||!Number.isFinite(u.cargo)||u.cargo<0||u.cargo>150.001||!Number.isFinite(u.construction)||u.construction<=0||u.construction>1||!Array.isArray(u.path)||u.path.length>world.land.length||!u.path.every(point)||!['idle','move','attack','assault','hold','gather','build','repair'].includes(u.order)||(u.order==='repair'&&u.kind!=='worker')||(u.destination!==undefined&&!point(u.destination))||(u.cargoKind!==null&&!['gold','wood','oil'].includes(u.cargoKind))||typeof u.returning!=='boolean'||(u.target!==null&&!Number.isInteger(u.target))||(u.resource!==null&&!Number.isInteger(u.resource))||(u.builder!==null&&!Number.isInteger(u.builder)))return false;ids.add(u.id);}
  // 已扣费的占位建筑必须恰好属于一个同阵营工人的待执行任务，防止读档后无法取消或重复退款。
  for(const building of v.units.filter(u=>u.reservedBuild)){
    const owners=v.units.filter(u=>u.tasks?.some(t=>t.type==='resume-build'&&t.target===building.id));
    if(owners.length!==1||owners[0].kind!=='worker'||owners[0].side!==building.side||owners[0].id!==building.builder||
      owners[0].tasks!.filter(t=>t.type==='resume-build'&&t.target===building.id).length!==1)return false;
  }
  if(!v.nodes.every(n=>point(n)&&Number.isInteger(n.id)&&['gold','wood','oil'].includes(n.kind)&&Number.isFinite(n.amount)&&n.amount>=0&&Number.isFinite(n.max)&&n.max>=n.amount&&Number.isFinite(n.radius)&&n.radius>0))return false;
  if(new Set(v.nodes.map(n=>n.id)).size!==v.nodes.length)return false;
  if(v.units.some(u=>u.cargoNode!==undefined&&(u.kind!=='worker'||u.cargoKind!=='gold'||!v.nodes.some(n=>n.id===u.cargoNode&&n.kind==='gold'))))return false;
  const wells=v.units.filter(u=>u.kind==='oilwell').map(u=>oilNodeAt(u,v.nodes)?.id);
  if(wells.length&&(!v.oilWells||wells.includes(undefined)||new Set(wells).size!==wells.length))return false;
  if(world.deposits){
    // 保存的可变字段只有 amount；树干 ID、占地和矿藏坐标必须与地图定义逐项匹配。
    if(v.nodes.length!==world.deposits.length)return false;
    for(let i=0;i<v.nodes.length;i++){
      const n=v.nodes[i],expected=world.deposits[i];
      if(['id','kind','x','y','max','radius','tree','startSide'].some(key=>n[key as keyof ResourceNode]!==expected[key as keyof ResourceNode]))return false;
    }
  }else if(v.nodes.length>100||v.nodes.some(n=>n.tree!==undefined||n.startSide!==undefined))return false;
  return (v.winner===null||sides.has(v.winner))&&v.shots.every(q=>point(q)&&point({x:q.tx,y:q.ty})&&finite(q.life)&&q.life>0&&Object.hasOwn(STATS,q.kind)&&sides.has(q.side)&&(q.mode===undefined||['beam','shell'].includes(q.mode))&&(q.duration===undefined||finite(q.duration)&&q.duration>0&&q.duration<=5)&&(q.firedAt===undefined||finite(q.firedAt)&&q.firedAt>=0&&q.firedAt<=v.time)&&(q.damage===undefined||finite(q.damage)&&q.damage>=0&&q.damage<=10000)&&(q.splash===undefined||finite(q.splash)&&q.splash>=0&&q.splash<=1000)&&(q.source===undefined||Number.isSafeInteger(q.source)&&q.source>0&&q.source<v.nextId)&&(q.target===undefined||Number.isSafeInteger(q.target)&&q.target>0&&q.target<v.nextId));
}
