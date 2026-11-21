import { STATS, type MobileKind, type Unit } from './types.js';
import { assetPath } from './assets.js';

export type UnitAnimation = 'idle' | 'move' | 'attack' | 'gather' | 'build' | 'death';
export const UNIT_GRID = {columns:8, rows:10} as const;
export const EVENT_LIFETIME = 4;

export const stride=(kind:Unit['kind'])=>kind==='soldier'?62:kind==='worker'?56:kind==='tank'?48:64;
export function unitPose(u: Unit, time: number, travel=u.travel): {state:UnitAnimation;row:number} {
  // The simulation owns the windup/fire phase; canceled attacks cannot create phantom muzzle flashes.
  if(u.action&&time>=u.action.started&&time<u.action.until)return {state:'attack',row:u.action.fired===null||time<u.action.fired?6:7};
  const state=u.activity==='repair'?'build':u.activity??(u.path.length?'move':'idle');
  const phase=time+u.id*.137;
  if(state==='gather'||state==='build')return {state,row:6+Math.floor(phase*2.6)%2};
  if(state==='move')return {state,row:2+Math.floor((travel??time*STATS[u.kind].speed)/stride(u.kind)*4)%4};
  return {state:'idle',row:Math.floor(phase*1.6)%2};
}

/** Distance-driven poses follow the same interpolated positions that the player sees. */
export class UnitMotion {
  private tracks=new Map<number,{x:number;y:number;travel:number;weight:number}>();
  prune(alive:Set<number>){for(const id of this.tracks.keys())if(!alive.has(id))this.tracks.delete(id);}
  pose(u:Unit,time:number,dt:number){
    const prior=this.tracks.get(u.id),delta=prior?Math.hypot(u.x-prior.x,u.y-prior.y):0;
    const moving=u.activity==='move',travel=prior&&delta<160?prior.travel+(moving?delta:0):u.travel??0;
    const weight=(prior?.weight??0)+((moving?1:0)-(prior?.weight??0))*(1-Math.exp(-dt/(moving?.075:.065)));
    this.tracks.set(u.id,{x:u.x,y:u.y,travel,weight});
    let pose=unitPose(u,time,travel);
    if(!moving&&pose.state==='idle'&&weight>.22)pose={state:'move',row:(Math.floor(travel/stride(u.kind)*2)%2)*2+2};
    const rhythm=Math.sin(travel/stride(u.kind)*Math.PI*4),core=u.kind==='soldier'||u.kind==='worker'||u.kind==='tank';
    let stretch=core?1+rhythm*weight*(u.kind==='soldier'?.008:.003):1;
    if(core&&u.action?.fired!==null&&u.action?.fired!==undefined){const age=time-u.action.fired;if(age>=0&&age<.3)stretch-=Math.sin(Math.min(1,age/.3)*Math.PI)*(u.kind==='tank'?.014:.006);}
    return {...pose,stretch,travel,weight};
  }
}

export function deathPose(age:number) {
  return {row:age<.28?8:9,alpha:Math.max(0,Math.min(1,(3.2-age)/1.2))};
}

export function buildingPose(u:Unit,hp:number,producing:boolean,time:number) {
  if(u.construction<1)return {atlas:'building-construction',frame:Math.min(2,Math.floor(u.construction*4))};
  const ratio=u.hp/hp;
  if(ratio<.8)return {atlas:'building-damage',frame:ratio<.25?3:ratio<.5?2:1};
  if(producing)return {atlas:'building-production',frame:Math.floor((time+u.id*.13)*5)%4};
  return {atlas:'building-damage',frame:0};
}

/** Catch up across network snapshots, freeze during pause, finish a final death after victory. */
export class AnimationClock {
  time=0;private snapshot=-1;private elapsed=0;
  advance(time:number,dt:number,ended:boolean) {
    if(time!==this.snapshot){this.snapshot=time;this.elapsed=0;this.time=time;}
    else{this.elapsed+=dt;this.time=time+Math.min(this.elapsed,ended?3.3:.12);}
    return this.time;
  }
}

export const animationFile=(kind:string)=>assetPath(`generated/animation-${kind}-v4.png`);
// The generated tank atlas runs counterclockwise from west; other atlases run east clockwise.
export const animationColumn=(kind:MobileKind,direction:number)=>kind==='tank'?(12-direction)%8:direction;
