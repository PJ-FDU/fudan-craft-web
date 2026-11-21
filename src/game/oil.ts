import { distance,findPath,gridSize,indexAt,nearestFree,TILE } from './pathfinding.js';
import type { Point, ResourceNode, Side, Unit, ViewState } from './types.js';

export const OIL_PIPE_RANGE = 14 * TILE;
export const OIL_PER_SECOND = 14;

export const OIL_PIPE_HEIGHT=-1.6;
export const OIL_PIPE_RADIUS=2.8;
export interface OilPipeSection {a:Point;b:Point;length:number;angle:number}
export interface OilPipeLayout {points:Point[];sections:OilPipeSection[]}
const layouts=new WeakMap<Uint8Array,Map<string,OilPipeLayout>>();

/** 管线贴地半埋，拐点从地图通行格寻路；2D / 3D 共用同一条折线路径。 */
export function oilPipeLayout(well:Point,refinery:Point,land?:Uint8Array):OilPipeLayout{
  const key=`${well.x}:${well.y}:${refinery.x}:${refinery.y}`;
  let cache=land&&layouts.get(land);
  const cached=cache?.get(key);if(cached)return cached;
  const length=distance(well,refinery);
  if(length<1)return {points:[],sections:[]};
  const dx=(refinery.x-well.x)/length,dy=(refinery.y-well.y)/length;
  const start=Math.min(27,length*.22),end=length-Math.min(34,length*.25);
  const inset=(along:number,lateral=0)=>({x:well.x+dx*along-dy*lateral,y:well.y+dy*along+dx*lateral});
  const bend=Math.min(56,(end-start)*.18);
  const anchors=[inset(start),inset(start+(end-start)*.32,bend),inset(start+(end-start)*.7,bend),inset(end)];
  const points:Point[]=[];
  const clear=(a:Point,b:Point)=>{
    if(!land)return true;
    const size=gridSize(land),steps=Math.ceil(distance(a,b)/4);
    for(let i=0;i<=steps;i++){
      const t=steps?i/steps:0,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
      for(const [ox,oy] of [[0,0],[-4,0],[4,0],[0,-4],[0,4]]){
        const p={x:x+ox,y:y+oy};
        if(p.x<0||p.y<0||p.x>=size*TILE||p.y>=size*TILE||land[indexAt(p,size)])return false;
      }
    }
    return true;
  };
  for(let i=0;i<anchors.length-1;i++){
    const a=points.at(-1)??(land?nearestFree(anchors[i],land):anchors[i]);
    const b=land?nearestFree(anchors[i+1],land):anchors[i+1];
    if(!a||!b)return {points:[],sections:[]};
    const path=clear(a,b)?[a,b]:[a,...findPath(a,b,land)];
    if(distance(path.at(-1)!,b)>TILE)return {points:[],sections:[]};
    if(!points.length)points.push(a);
    // 只简化可直达的小段，避免把绕岸线、树林的拐点重新拉成直线。
    for(let j=0;j<path.length-1;){
      let next=Math.min(path.length-1,j+8);
      while(next>j+1&&!clear(path[j],path[next]))next--;
      points.push(path[next]);j=next;
    }
  }
  const sections:OilPipeSection[]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],span=distance(a,b);
    if(span<.01)continue;
    const count=Math.ceil(span/62);
    for(let j=0;j<count;j++){
      const point=(t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
      sections.push({a:point(j/count),b:point((j+1)/count),length:span/count,angle:Math.atan2(b.y-a.y,b.x-a.x)});
    }
  }
  const layout={points,sections};
  if(land){
    if(!cache){cache=new Map();layouts.set(land,cache);}
    if(cache.size>=256)cache.clear();
    cache.set(key,layout);
  }
  return layout;
}

export function oilNodeAt(point: Point, nodes: readonly ResourceNode[]) {
  return nodes.find(node => node.kind === 'oil' &&
    Math.floor(node.x / TILE) === Math.floor(point.x / TILE) &&
    Math.floor(node.y / TILE) === Math.floor(point.y / TILE));
}

export function linkedRefinery(side: Side, at: Point, units: readonly Unit[]) {
  let nearest: Unit | undefined;
  let best = OIL_PIPE_RANGE;
  for (const unit of units) {
    if (unit.kind !== 'refinery' || unit.side !== side || unit.hp <= 0 || unit.construction < 1) continue;
    const length = distance(unit, at);
    if (length <= best && (!nearest || length < best || unit.id < nearest.id)) {
      nearest = unit;
      best = length;
    }
  }
  return nearest;
}

export function visibleOilPipes(view: ViewState) {
  if (!view.oilPipes?.length) return [];
  const units = new Map(view.units.map(unit => [unit.id, unit]));
  return view.oilPipes.flatMap(pipe => {
    const well = units.get(pipe.well), refinery = units.get(pipe.refinery);
    return well && refinery ? [{ well, refinery }] : [];
  });
}
