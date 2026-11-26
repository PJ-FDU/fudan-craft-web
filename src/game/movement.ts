import { TILE,gridSize,distance,findPath } from './pathfinding.js';
import { STATS,isMobile,type Point,type Unit,type Side } from './types.js';

export function circleFree(p:Point,radius:number,blocked:Uint8Array){
  const size=gridSize(blocked),world=size*TILE;
  if(p.x<radius||p.y<radius||p.x>world-radius||p.y>world-radius)return false;
  for(let y=Math.max(0,Math.floor((p.y-radius)/TILE));y<=Math.min(size-1,Math.floor((p.y+radius)/TILE));y++)
    for(let x=Math.max(0,Math.floor((p.x-radius)/TILE));x<=Math.min(size-1,Math.floor((p.x+radius)/TILE));x++)if(blocked[y*size+x]){
      const dx=p.x-Math.max(x*TILE,Math.min((x+1)*TILE,p.x)),dy=p.y-Math.max(y*TILE,Math.min((y+1)*TILE,p.y));
      if(dx*dx+dy*dy<radius*radius-.001)return false;
    }
  return true;
}
export function segmentFree(a:Point,b:Point,radius:number,blocked:Uint8Array){
  const n=Math.max(1,Math.ceil(distance(a,b)/6));
  for(let i=1;i<=n;i++)if(!circleFree({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n},radius,blocked))return false;
  return true;
}
const CELL=80;
const key=(p:Point)=>`${Math.floor(p.x/CELL)},${Math.floor(p.y/CELL)}`;
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
export function landingNear(goal:Point,radius:number,blocked:Uint8Array,available:(p:Point)=>boolean,maxRing=8):Point|undefined {
  const free=(p:Point)=>circleFree(p,radius,blocked)&&available(p);
  if(free(goal))return goal;
  const cx=Math.floor(goal.x/TILE),cy=Math.floor(goal.y/TILE);
  for(let ring=0;ring<=maxRing;ring++){
    let best:Point|undefined,closest=Infinity;
    for(let dy=-ring;dy<=ring;dy++)for(let dx=-ring;dx<=ring;dx++){
      if(Math.abs(dx)!==ring&&Math.abs(dy)!==ring)continue;
      const point={x:(cx+dx+.5)*TILE,y:(cy+dy+.5)*TILE},d=distance(point,goal);
      if(d<closest&&free(point)){best=point;closest=d;}
    }
    if(best)return best;
  }
}

const clearanceMasks=new WeakMap<Uint8Array,Map<number,Uint8Array>>();
export function groundPath(unit:Unit,goal:Point,blocked:Uint8Array,others:Unit[]=[],closest=false,avoidParked=false):Point[]{
  const radius=STATS[unit.kind].radius;
  if(!others.length&&segmentFree(unit,goal,radius,blocked))return [{x:goal.x,y:goal.y}];
  // A unit occupying a choke increases its cost, but the passage stays available to the queue behind it.
  const traffic=new Map<number,number>(),size=gridSize(blocked);
  let routeLand=blocked;
  // 大型单位不能按单个空格寻路：格心还必须留出实际碰撞半径。
  if(radius>TILE/2){
    const masks=clearanceMasks.get(blocked)??new Map<number,Uint8Array>();
    clearanceMasks.set(blocked,masks);
    const cached=masks.get(radius);
    if(cached)routeLand=cached;
    else{
      routeLand=blocked.slice();
      for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!blocked[y*size+x]
        &&!circleFree({x:(x+.5)*TILE,y:(y+.5)*TILE},radius,blocked))routeLand[y*size+x]=1;
      masks.set(radius,routeLand);
    }
  }
  const clearanceLand=routeLand;
  if(unit.kind==='worker'&&unit.tasks!==undefined&&(unit.order==='build'||unit.order==='repair')&&others.some(u=>u.hp>0&&!u.path.length)){
    routeLand=routeLand.slice();
    // 施工绕路时将停靠单位的实际占地作为障碍，避免软拥挤代价仍把路径排进无法穿过的间隙。
    for(const other of others)if(other.id!==unit.id&&other.hp>0&&isMobile(other)&&!STATS[other.kind].air&&!other.path.length){
      const r=radius+STATS[other.kind].radius+4;
      for(let y=Math.max(0,Math.floor((other.y-r)/TILE));y<=Math.min(size-1,Math.floor((other.y+r)/TILE));y++)
        for(let x=Math.max(0,Math.floor((other.x-r)/TILE));x<=Math.min(size-1,Math.floor((other.x+r)/TILE));x++){
          if(x===Math.floor(unit.x/TILE)&&y===Math.floor(unit.y/TILE))continue;
          if(Math.hypot((x+.5)*TILE-other.x,(y+.5)*TILE-other.y)<r)routeLand[y*size+x]=1;
        }
    }
  }
  for(const other of others)if(other.id!==unit.id&&other.hp>0&&isMobile(other)&&!STATS[other.kind].air&&distance(unit,other)<196){
    const r=radius+STATS[other.kind].radius+8;
    for(let y=Math.max(0,Math.floor((other.y-r)/TILE));y<=Math.min(size-1,Math.floor((other.y+r)/TILE));y++)
      for(let x=Math.max(0,Math.floor((other.x-r)/TILE));x<=Math.min(size-1,Math.floor((other.x+r)/TILE));x++){
        const d=Math.hypot((x+.5)*TILE-other.x,(y+.5)*TILE-other.y),key=y*size+x;
        if(d<r)traffic.set(key,Math.max(traffic.get(key)??0,(other.path.length?1.75:3.5)*(1-d/r)));
      }
  }
  const parked=avoidParked?others.filter(other=>other.id!==unit.id&&other.hp>0&&isMobile(other)&&!STATS[other.kind].air&&!other.path.length):[];
  // 逐段检查停靠单位的圆形占地，保留格子之间仍足够宽的空隙。
  const canTraverse=parked.length?(a:Point,b:Point)=>{
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    return parked.every(other=>{
      const t=length?Math.max(0,Math.min(1,((other.x-a.x)*dx+(other.y-a.y)*dy)/length)):0;
      return Math.hypot(a.x+dx*t-other.x,a.y+dy*t-other.y)>=radius+STATS[other.kind].radius+.5;
    });
  }:undefined;
  // 堵满唯一通路时仍保留原路等待，避免误判任务不可达。
  let path=findPath(unit,goal,routeLand,{traffic,closest:closest||!!canTraverse,canTraverse,maxVisited:canTraverse?1024:undefined});
  if(canTraverse&&!path.length&&distance(unit,goal)<128)return [{x:unit.x,y:unit.y}];
  if(canTraverse&&(!path.length||distance(path.at(-1)!,goal)>128))path=findPath(unit,goal,clearanceLand,{traffic,closest});
  const first=path[0];
  if(first&&!segmentFree(unit,first,radius,blocked)){
    const center={x:(Math.floor(unit.x/TILE)+.5)*TILE,y:(Math.floor(unit.y/TILE)+.5)*TILE};
    if(!segmentFree(unit,center,radius,blocked))return [];
    path.unshift(center);
  }
  const last=path.at(-1);
  if(last&&distance(last,goal)>.7&&segmentFree(last,goal,radius,blocked)&&(!canTraverse||canTraverse(last,goal)))path.push({x:goal.x,y:goal.y});
  return path;
}

/** Sequential swept-disc steering: an accepted move cannot tunnel through another ground unit. */
export class Movement {
  private buckets=new Map<string,Set<Unit>>();
  private byId=new Map<number,Unit>();
  private readonly world:number;
  constructor(readonly units:Unit[],readonly blocked:Uint8Array,private allied:(a:Side,b:Side)=>boolean=(a,b)=>a===b){
    this.world=gridSize(blocked)*TILE;
    for(const u of units)if(isMobile(u)&&u.hp>0){
      this.byId.set(u.id,u);
      // Construction and old saves can leave a unit inside a newly occupied cell.
      if(!STATS[u.kind].air&&!circleFree(u,STATS[u.kind].radius,blocked)){
        const cx=Math.floor(u.x/TILE),cy=Math.floor(u.y/TILE);let free:Point|undefined;
        for(let r=1;r<8&&!free;r++){
          const candidates:Point[]=[];
          for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(Math.abs(dx)===r||Math.abs(dy)===r){
            const p={x:(cx+dx+.5)*TILE,y:(cy+dy+.5)*TILE};
            if(circleFree(p,STATS[u.kind].radius,blocked)&&units.every(v=>v.id===u.id||!isMobile(v)||!!STATS[v.kind].air!==!!STATS[u.kind].air||distance(p,v)>=STATS[v.kind].radius+STATS[u.kind].radius+.5))candidates.push(p);
          }
          candidates.sort((a,b)=>distance(a,u)-distance(b,u));free=candidates[0];
        }
        if(free){u.x=free.x;u.y=free.y;u.repath=0;u.blockedFor=1.3;u.navigationProgress=undefined;}
      }
      this.add(u);
    }
  }
  private add(u:Unit){const k=key(u),bucket=this.buckets.get(k)??new Set<Unit>();bucket.add(u);this.buckets.set(k,bucket);}
  private relocate(u:Unit,p:Point){this.buckets.get(key(u))?.delete(u);u.x=p.x;u.y=p.y;this.add(u);}
  private neighbors(u:Unit,r=100){
    const list:Unit[]=[],cx=Math.floor(u.x/CELL),cy=Math.floor(u.y/CELL),n=Math.ceil(r/CELL);
    for(let y=-n;y<=n;y++)for(let x=-n;x<=n;x++)for(const other of this.buckets.get(`${cx+x},${cy+y}`)??[])if(other.id!==u.id&&!!STATS[other.kind].air===!!STATS[u.kind].air&&other.hp>0)list.push(other);
    return list;
  }
  private clear(u:Unit,p:Point,others:Unit[]){
    const radius=STATS[u.kind].radius;if(p.x<radius||p.y<radius||p.x>this.world-radius||p.y>this.world-radius)return false;
    if(!STATS[u.kind].air&&!segmentFree(u,p,STATS[u.kind].radius,this.blocked))return false;
    const vx=p.x-u.x,vy=p.y-u.y,length=vx*vx+vy*vy;
    for(const other of others){
      const r=STATS[u.kind].radius+STATS[other.kind].radius+.5,start=distance(u,other),end=distance(p,other);
      if(start<r-.01){if(end<=start+.001)return false;continue;}
      const t=length?Math.max(0,Math.min(1,((other.x-u.x)*vx+(other.y-u.y)*vy)/length)):0;
      if(Math.hypot(u.x+vx*t-other.x,u.y+vy*t-other.y)<r)return false;
    }
    return true;
  }
  private stepTo(u:Unit,point:Point,dt:number,reverse=false){
    const dx=point.x-u.x,dy=point.y-u.y,moved=Math.hypot(dx,dy);
    const heading=Math.atan2(dy,dx)+(reverse?Math.PI:0);
    const rate=u.kind==='tank'?4:u.kind==='worker'?7:12;
    this.relocate(u,point);
    u.velocity={x:dx/dt,y:dy/dt};u.travel=(u.travel??0)+moved;u.activity=moved>.01?'move':'idle';
    u.angle=wrap(u.angle+Math.max(-rate*dt,Math.min(rate*dt,wrap(heading-u.angle))));
  }
  private yieldToTraffic(u:Unit,others:Unit[],goal:Point,dt:number){
    if(STATS[u.kind].air)return false;
    const heading=Math.atan2(goal.y-u.y,goal.x-u.x);
    const reaches=(other:Unit)=>STATS[u.kind].radius+STATS[other.kind].radius;
    const direction=(other:Unit)=>Math.atan2(other.path[0].y-other.y,other.path[0].x-other.x);
    const destinationAngle=(unit:Unit)=>{
      const end=unit.destination??unit.path.at(-1)!;
      return Math.atan2(end.y-unit.y,end.x-unit.x);
    };
    const activeLeader=(id:number|undefined)=>{
      const other=id===undefined?undefined:this.byId.get(id);
      return other&&other!==u&&other.hp>0&&this.allied(other.side,u.side)&&other.yieldTo===undefined&&other.path.length&&!other.action?other:undefined;
    };
    const directlyAhead=(other:Unit)=>{
      const dx=other.x-u.x,dy=other.y-u.y;
      return distance(u,other)<reaches(other)+13&&dx*Math.cos(heading)+dy*Math.sin(heading)>0
        &&Math.abs(dx*Math.sin(heading)-dy*Math.cos(heading))<reaches(other)*.74;
    };
    let lead=activeLeader(u.yieldTo);
    if(lead){
      const a=direction(lead);
      // A turn out of the traffic lane is also enough to resume, even if the other unit hasn't passed.
      const next=u.path.find(point=>distance(u,point)>25)??goal;
      const fraction=Math.min(1,48/Math.max(1,distance(u,next)));
      const exit={x:u.x+(next.x-u.x)*fraction,y:u.y+(next.y-u.y)*fraction};
      const clearExit=distance(exit,lead)>distance(u,lead)+8&&this.clear(u,exit,others);
      if(clearExit||(u.x-lead.x)*Math.cos(a)+(u.y-lead.y)*Math.sin(a)<-reaches(lead))lead=undefined;
    }
    if(!lead&&u.yieldTo!==undefined){delete u.yieldTo;delete u.yieldPoint;}
    if(!lead&&(u.blockedFor??0)>=.32){
      // Followers make room for a reversing ally, so two columns can also clear a narrow lane.
      for(const other of others){
        if(!this.allied(other.side,u.side)||!directlyAhead(other))continue;
        lead=activeLeader(other.yieldTo);
        if(lead)break;
        if(other.id<u.id&&activeLeader(other.id)&&Math.abs(wrap(direction(other)-heading))>2.2
          &&Math.abs(wrap(destinationAngle(other)-destinationAngle(u)))>2.25){lead=other;break;}
      }
    }
    if(!lead)return false;
    u.yieldTo=lead.id;
    const step=STATS[u.kind].speed*dt;
    const ahead=u.path.find(point=>distance(u,point)>20)??goal;
    const toward=Math.atan2(u.y-ahead.y,u.x-ahead.x);
    if(!u.yieldPoint){
      for(const angle of [toward+Math.PI/2,toward-Math.PI/2,toward+Math.PI/3,toward-Math.PI/3]){
        const point={x:u.x+Math.cos(angle)*42,y:u.y+Math.sin(angle)*42};
        if(this.clear(u,point,others)){u.yieldPoint=point;break;}
      }
    }
    if(u.yieldPoint){
      const d=distance(u,u.yieldPoint);
      if(d>.7){
        const fraction=Math.min(1,step/d),point={x:u.x+(u.yieldPoint.x-u.x)*fraction,y:u.y+(u.yieldPoint.y-u.y)*fraction};
        if(this.clear(u,point,others))this.stepTo(u,point,dt);
        else delete u.yieldPoint;
      }
      return true;
    }
    for(const angle of [toward,Math.round(toward/(Math.PI/2))*(Math.PI/2),toward+.30,toward-.30,direction(lead)]){
      const retreat={x:u.x+Math.cos(angle)*step,y:u.y+Math.sin(angle)*step};
      if(this.clear(u,retreat,others)){this.stepTo(u,retreat,dt,true);break;}
    }
    return true;
  }
  move(u:Unit,dt:number){
    if(u.yieldPoint&&u.order==='idle'&&!u.action){if(distance(u,u.yieldPoint)<1){delete u.yieldPoint;u.path=[];}else u.path=[u.yieldPoint];}
    while(u.path.length&&distance(u,u.path[0])<.7){u.path.shift();delete u.navigationProgress;u.navigationStalled=0;u.navigationRetries=0;}
    if(!u.path.length){
      u.velocity={x:0,y:0};
      if(u.yieldTo!==undefined){delete u.yieldTo;delete u.yieldPoint;}
      return;
    }
    const others=this.neighbors(u);
    // 记录当前路点的最佳距离，往返抖动不能被当作持续前进。
    const remaining=distance(u,u.path[0]);
    if(u.navigationProgress===undefined||remaining<u.navigationProgress-1){
      u.navigationProgress=remaining;u.navigationStalled=0;
    }else u.navigationStalled=(u.navigationStalled??0)+dt;
    const plain=(u.order==='move'||u.order==='assault')&&!u.target;
    const noProgress=plain&&(u.navigationStalled??0)>1.5&&u.yieldTo===undefined;
    const stalled=(u.blockedFor??0)>.55&&Math.floor((u.blockedFor??0)*2)!==Math.floor(((u.blockedFor??0)-dt)*2);
    const haul=u.kind==='worker'&&(!segmentFree(u,u.path[0],STATS[u.kind].radius,this.blocked)
      ||(u.blockedFor??0)>.55&&u.repath<=0);
    if(!STATS[u.kind].air&&(!plain&&stalled||haul||noProgress)){
      const end=u.path.at(-1)!;
      if(noProgress){
        u.navigationRetries=(u.navigationRetries??0)+1;
        // 目标周围封满后，连续绕行仍无进展便在附近空位停靠，不能无限往返。
        if(u.navigationRetries>=5&&distance(u,end)<128&&circleFree(u,STATS[u.kind].radius,this.blocked)){
          u.destination={x:u.x,y:u.y};u.path=[];u.velocity={x:0,y:0};delete u.navigationProgress;u.navigationStalled=0;u.navigationRetries=0;
          return;
        }
      }
      const goal=distance(u,end)<64&&(u.order==='move'||u.order==='assault')&&!u.target&&((u.blockedFor??0)>1.35||(u.navigationStalled??0)>1.35)
        ?this.clearLanding(u,end,others):end;
      const detour=groundPath(u,goal,this.blocked,plain?this.units:others,false,plain);
      if(detour.length){
        u.path=detour;delete u.navigationProgress;u.navigationStalled=0;
        const landing=plain?detour.at(-1)!:goal;
        if(goal!==end||plain&&distance(landing,end)>.7){u.destination=landing;u.blockedFor=0;}
      }
      if(u.kind==='worker')u.repath=.8;
    }
    // Skip visible grid corners; keep the same static-obstacle checks as actual movement.
    for(let n=Math.min(u.path.length-1,4);n>0;n--)if(distance(u,u.path[n])<128&&this.clear(u,u.path[n],others)){u.path.splice(0,n);delete u.navigationProgress;u.navigationStalled=0;break;}
    const goal=u.path[0],d=distance(u,goal),step=Math.min(d,STATS[u.kind].speed*dt),desired=Math.atan2(goal.y-u.y,goal.x-u.x);
    if(this.yieldToTraffic(u,others,goal,dt))return;
    // 移动队形绕过停靠单位，避免先到者被后续单位反复推散。
    if(!plain&&(u.blockedFor??0)>.35)for(const other of others){
      if(!this.allied(other.side,u.side)||other.order!=='idle'||other.action||other.path.length||other.yieldPoint||distance(u,other)>STATS[u.kind].radius+STATS[other.kind].radius+22)continue;
      const dx=other.x-u.x,dy=other.y-u.y,radius=STATS[u.kind].radius+STATS[other.kind].radius;
      const toward=dx*Math.cos(desired)+dy*Math.sin(desired);
      if(toward<=0||Math.abs(dx*Math.sin(desired)-dy*Math.cos(desired))>radius*.72)continue;
      const bypass=[desired+.92,desired-.92].some(a=>this.clear(u,{x:u.x+Math.cos(a)*40,y:u.y+Math.sin(a)*40},others));
      if(bypass)continue;
      const near=this.neighbors(other);
      for(const a of [desired+Math.PI/2,desired-Math.PI/2,desired+Math.PI*.25,desired-Math.PI*.25,desired]){
        const p={x:other.x+Math.cos(a)*40,y:other.y+Math.sin(a)*40};
        // 到达后最多离开首次停靠点 42 单位；后续车辆应绕行，不能连续推散队形。
        const origin=other.yieldOrigin??other;
        if(distance(p,origin)<=42&&this.clear(other,p,near)){other.yieldOrigin??={x:other.x,y:other.y};other.yieldPoint=p;other.navigationProgress=distance(other,p);break;}
      }
    }
    let best:Point|undefined,bestScore=-Infinity,bestAngle=0;
    const angles=[0,.35,-.35,.7,-.7,1.05,-1.05,1.5,-1.5,2.1,-2.1,Math.PI];
    for(const fraction of [1,.5])for(const angle of angles){
      if(Math.abs(angle)>1.6&&(u.blockedFor??0)<.6)continue;
      const a=desired+angle,p={x:u.x+Math.cos(a)*step*fraction,y:u.y+Math.sin(a)*step*fraction};
      if(!this.clear(u,p,others))continue;
      let penalty=0;
      for(const other of others){
        const r=STATS[u.kind].radius+STATS[other.kind].radius+9,ov=other.velocity??{x:0,y:0};
        const future=Math.hypot(p.x+Math.cos(a)*15-other.x-ov.x*.12,p.y+Math.sin(a)*15-other.y-ov.y*.12);
        if(future<r)penalty+=(r-future)*.18;
      }
      const progress=d-distance(p,goal),score=progress-penalty-Math.abs(angle)*.14+(angle>0?.035:0);
      if(score>bestScore){bestScore=score;best=p;bestAngle=angle;}
    }
    if(best&&(bestScore>0||(u.blockedFor??0)>.6)){
      const dx=best.x-u.x,dy=best.y-u.y,heading=Math.atan2(dy,dx),rate=u.kind==='tank'?4:u.kind==='worker'?7:12;
      // Turn for an unobstructed departure; steering around traffic must keep making progress.
      if((u.kind==='tank'||u.kind==='worker')&&Math.abs(bestAngle)<.1&&Math.abs(wrap(heading-u.angle))>.75){u.angle=wrap(u.angle+Math.max(-rate*dt,Math.min(rate*dt,wrap(heading-u.angle))));u.velocity={x:0,y:0};u.blockedFor=(u.blockedFor??0)+dt;return;}
      this.stepTo(u,best,dt);
      const remaining=distance(u,goal);
      if(remaining<d-.09){u.blockedFor=Math.max(0,(u.blockedFor??0)-dt*2);}
      else u.blockedFor=(u.blockedFor??0)+dt;
      if(distance(u,goal)<.7){u.path.shift();delete u.navigationProgress;u.navigationStalled=0;u.navigationRetries=0;}
    }else{u.velocity={x:0,y:0};u.blockedFor=(u.blockedFor??0)+dt;}
  }
  private clearLanding(u:Unit,goal:Point,others:Unit[]){
    const radius=STATS[u.kind].radius;
    const blocker=others.some(other=>!other.path.length&&!other.yieldPoint&&distance(goal,other)<radius+STATS[other.kind].radius+.5);
    if(!blocker)return goal;
    // 就近停靠点必须能从当前侧直接抵达，避免反复选择驻守单位背后的空位。
    return landingNear(goal,radius,this.blocked,p=>this.clear(u,p,others)&&others.every(other=>{
      const gap=radius+STATS[other.kind].radius+5;
      return distance(p,other)>=gap&&(!other.path.length||distance(p,other.path.at(-1)!)>=gap);
    }),2)??goal;
  }
  /** Repair overlapping old saves or cramped spawns; normal accepted moves never introduce overlap. */
  separate(){
    for(let pass=0;pass<8;pass++){
      let moved=false;
      for(const u of this.units)if(isMobile(u)&&u.hp>0)for(const other of this.neighbors(u))if(other.id>u.id){
        const r=STATS[u.kind].radius+STATS[other.kind].radius+.5,d=distance(u,other);if(d>=r-.02)continue;
        const a=d>.001?Math.atan2(other.y-u.y,other.x-u.x):(u.id*2.399+other.id),amount=(r-d)/2+.02,dx=Math.cos(a)*amount,dy=Math.sin(a)*amount;
        const aPos={x:u.x-dx,y:u.y-dy},bPos={x:other.x+dx,y:other.y+dy};
        const free=(p:Point,v:Unit)=>STATS[v.kind].air||circleFree(p,STATS[v.kind].radius,this.blocked);
        if(!u.ability?.effects.some(s=>s.group==='root')&&free(aPos,u)){this.relocate(u,aPos);moved=true;}
        if(!other.ability?.effects.some(s=>s.group==='root')&&free(bPos,other)){this.relocate(other,bPos);moved=true;}
      }
      if(!moved)break;
    }
  }
}
