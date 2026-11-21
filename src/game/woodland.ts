import { gridSize,indexAt,TILE } from './grid.js';
import { harvestLand,isTree,RESOURCE_STOCK } from './resource-world.js';
import { distanceToCurve,insidePolygon,terrainNoise,waterContour } from './terrain-shapes.js';
import { TEMPLE_GLADES } from './temple-woodland.js';
import type { Point,ResourceNode,Side } from './types.js';
import type { Feature,WorldData } from './world.js';

export const STARTER_TREE_COUNT=48;
export const HOME_TREE_COUNT=160;
const HOME_RADIUS=1400;

/** 新版林地使用固定随机种子；出生林按同一局部形状镜像，保持补给公平。 */
export function woodlandWorld(source:WorldData,revision:number,dense=false):WorldData{
  const size=gridSize(source.land),extent=size*TILE,center={x:extent/2,y:extent/2};
  const nearHome=(p:Point)=>source.bases.some(b=>Math.hypot(p.x-b.x,p.y-b.y)<HOME_RADIUS);
  const removed=new Set(source.deposits!.filter(n=>n.tree!==undefined&&nearHome(n)).map(n=>n.tree!));
  const land=harvestLand(source,source.deposits!.map(n=>removed.has(n.tree!)?{...n,amount:0}:n));
  const roads=source.roads.slice(),permanentLand=source.permanentLand!.slice();
  const features:Feature[]=[],deposits:ResourceNode[]=[],treeTiles=new Map<number,readonly number[]>();
  const occupied=new Uint8Array(land.length);
  const minerals=source.deposits!.filter(n=>n.kind!=='wood');
  const waters=source.features.filter(f=>f.kind==='water').map(f=>({f,outline:waterContour(f,1.045)}));
  const wet=(p:Point)=>waters.some(({f,outline})=>insidePolygon({x:p.x-f.x,y:p.y-f.y},outline));
  let seed=[...source.id].reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619),2166136261)>>>0;
  const noise=terrainNoise(seed);
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const append=(feature:Feature,cells:readonly number[],side?:Side)=>{
    const tree=features.length;
    features.push(feature);treeTiles.set(tree,cells);
    for(const at of cells){land[at]=1;roads[at]=0;}
    occupied[indexAt(feature,size)]=1;
    deposits.push({x:feature.x,y:feature.y,id:deposits.length+1,kind:'wood',amount:RESOURCE_STOCK.tree,max:RESOURCE_STOCK.tree,radius:18,tree,...(side?{startSide:side}:{})});
  };
  for(const node of minerals)deposits.push({...node,id:deposits.length+1});
  const originalNodes=new Map(source.deposits!.filter(n=>n.tree!==undefined).map(n=>[n.tree!,n]));
  for(const [i,f] of source.features.entries()){
    if(!isTree(f)){features.push(f);continue;}
    if(removed.has(i))continue;
    const cells=source.treeTiles!.get(i)!;
    // 在权威占地内部抖动树干；碰撞和可采集节点仍与画面使用相同坐标。
    const p={x:f.x+(random()-.5)*42,y:f.y+(random()-.5)*42};
    const point=cells.includes(indexAt(p,size))&&!wet(p)?p:f;
    append({...f,...point},cells,originalNodes.get(i)?.startSide);
  }
  const protectedGround=(p:Point,home:boolean)=>{
    if(wet(p)||minerals.some(n=>Math.hypot(n.x-p.x,n.y-p.y)<180))return true;
    if(!home&&nearHome(p))return true;
    return source.bases.some(b=>Math.hypot(b.x-p.x,b.y-p.y)<320
      ||(!home&&distanceToCurve(p,[b,center])<220));
  };
  // 105 是旧林带中的人工小路；新版可长成密林，真正的干道继续保留。
  const protectedRoad=(at:number)=>roads[at]>=80&&!(dense&&roads[at]===105);
  const add=(p:Point,home:boolean,side?:Side)=>{
    const x=Math.floor(p.x/TILE),y=Math.floor(p.y/TILE),at=y*size+x;
    if(x<8||y<8||x>=size-8||y>=size-8||(dense?permanentLand[at]:land[at])||occupied[at]||protectedGround(p,home)||(!home&&protectedRoad(at)))return false;
    if(!home&&!dense)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(occupied[at+dy*size+dx])return false;
    const grain=noise(p.x/190,p.y/190),kind:Feature['kind']=grain>.25?'oak':grain<-.25?'birch':'pine';
    // 密林允许树干相邻或共用旧树占地，从可达林缘逐层砍入，不预留林内通道。
    const cells=[at];
    if(!home&&!dense)for(const next of [at-1,at+1,at-size,at+size])if(!land[next]&&!permanentLand[next]&&roads[next]<80)cells.push(next);
    append({...p,kind,cell:kind==='pine'?0:kind==='oak'?1:2,size:Math.round((home?72:114)+random()*25),block:true},cells,side);
    return true;
  };

  for(const base of source.bases){
    const sx=base.x<center.x?1:-1,sy=base.y<center.y?1:-1;
    // 三个相连林簇组成不规则弧带，最近一簇保留内凹边缘和不同纵深。
    let planted=0,localSeed=0x686f6d65;
    const local=()=>{localSeed=(Math.imul(localSeed,1664525)+1013904223)>>>0;return localSeed/4294967296;};
    for(let attempt=0;attempt<18000&&planted<HOME_TREE_COUNT;attempt++){
      const first=planted<STARTER_TREE_COUNT;
      const angle=local()*Math.PI*2,radius=Math.sqrt(local());
      const lobe=first?0:1+Math.floor(local()*3);
      const [cx,cy,rx,ry]=lobe===0?[0,448,148,100]:dense
        ?lobe===1?[-190,648,205,176]:lobe===2?[200,700,214,182]:[0,884,290,170]
        :lobe===1?[-310,740,310,250]:lobe===2?[320,790,310,270]:[0,1070,430,210];
      const ripple=1+.16*Math.sin(angle*3)+.09*Math.cos(angle*5);
      const dx=cx+Math.cos(angle)*rx*radius*ripple,dy=cy+Math.sin(angle)*ry*radius*ripple;
      const p={x:base.x+sx*dx,y:base.y+sy*dy};
      const distance=Math.hypot(dx,dy);
      if(distance>=HOME_RADIUS||distance<344||(!first&&distance<580))continue;
      if(add(p,true,first?base.side:undefined))planted++;
    }
    if(planted!==HOME_TREE_COUNT)throw Error(`${source.id}: unable to plant starting woodland for side ${base.side}`);
  }

  const areas=TEMPLE_GLADES.map(polygon=>polygon.map(([x,y])=>({x:x*extent/100,y:y*extent/100})));
  const anchors=dense?deposits.filter(n=>n.kind==='wood'&&!nearHome(n)&&random()<.18):[];
  // 沿已有树群聚集补植，少量自然散落；旧版本仍使用原采样，存档地形不变。
  const budget=Math.min(1400,3800-deposits.length);
  let planted=0;
  for(let attempt=0;attempt<80000&&planted<budget;attempt++){
    const anchor=anchors.length&&random()<.88?anchors[Math.floor(random()*anchors.length)]:undefined;
    const angle=anchor?random()*Math.PI*2:0,radius=anchor?Math.sqrt(random())*150:0;
    const ripple=1+.18*Math.sin(angle*3)+.12*Math.cos(angle*5);
    const p=anchor?{x:anchor.x+Math.cos(angle)*radius*ripple,y:anchor.y+Math.sin(angle)*radius*ripple}
      :{x:(8+random()*(size-16))*TILE,y:(8+random()*(size-16))*TILE};
    const density=noise(p.x/950,p.y/950);
    const rim=Math.min(p.x,p.y,extent-p.x,extent-p.y)<580;
    const glade=source.id==='lost-temple'&&areas.some(area=>insidePolygon(p,area));
    if(!anchor&&(!(rim||glade||density>.3)||density<-.52))continue;
    if(add(p,false))planted++;
  }
  // 把林冠围出的小空穴纳入永久地形，避免单位或建筑生成在孤立格中。
  const reached=new Uint8Array(land.length),queue=[indexAt(source.bases[0],size)];reached[queue[0]]=1;
  for(let i=0;i<queue.length;i++){
    const at=queue[i],x=at%size,y=Math.floor(at/size);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy,next=ny*size+nx;
      if(nx<0||ny<0||nx>=size||ny>=size||land[next]||reached[next])continue;
      reached[next]=1;queue.push(next);
    }
  }
  for(const p of [...source.bases,...minerals])if(!reached[indexAt(p,size)])throw Error(`${source.id}: woodland blocks a base or deposit`);
  for(let i=0;i<land.length;i++)if(!land[i]&&!reached[i]){land[i]=permanentLand[i]=1;roads[i]=0;}
  return {...source,revision,land,roads,permanentLand,features,deposits,treeTiles};
}
