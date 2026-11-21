import { MAP } from './map.js';
import { DEFAULT_MAP_ID,isMapId,type MapId } from './maps.js';
import { naturalWorld } from './natural-world.js';
import { isClassicMap,makeClassicWorld } from './classic-world.js';
import { RESOURCE_STOCK,resourceWorld } from './resource-world.js';
import { templeWoodland } from './temple-woodland.js';
import { woodlandWorld } from './woodland.js';
import type { Point, ResourceNode, ResourceKind, Side } from './types.js';
export interface Feature extends Point { kind:'pine'|'oak'|'birch'|'bush'|'ruin'|'rock'|'rockLarge'|'water'|'grass'|'flower'|'stump'|'fern'; size:number; cell:number; block:boolean; waterRadii?:Point; outline?:readonly Point[]; river?:boolean }
export interface WorldData {
  readonly id:MapId;
  readonly revision:number;
  readonly land:Uint8Array;
  readonly roads:Uint8Array;
  readonly features:readonly Feature[];
  readonly bases:readonly (Point&{side:Side})[];
  readonly towers:readonly (Point&{side:Side})[];
  readonly resources:readonly Point[];
  readonly deposits?:readonly ResourceNode[];
  readonly treeTiles?:ReadonlyMap<number,readonly number[]>;
  readonly permanentLand?:Uint8Array;
}
const W=MAP.width,T=MAP.tile;
const original=MAP.layers.find(l=>l.name==='InfoLayer')!;
export const LAND=Uint8Array.from(original.data,n=>n?1:0);
// 通行、3D 地面、2D 回退和小地图共用同一份最终路网。
export const ROADS=Uint8Array.from(MAP.layers.find(l=>l.name==='EarthLayer')!.data,n=>n?255:0);
const ponds=new Uint8Array(W*W);
const bases=MAP.initial.filter(u=>u.type===5).map(u=>({x:u.x*T+16,y:u.y*T+16}));
let seed=0xfda2026;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const index=(p:Point)=>Math.floor(p.y/T)*W+Math.floor(p.x/T);
const valid=(x:number,y:number)=>x>1&&y>1&&x<W-2&&y<W-2;
const nearBase=(p:Point,r=320)=>bases.some(b=>Math.hypot(b.x-p.x,b.y-p.y)<r);
export const FEATURES:Feature[]=[];
// Existing impassable forest and rock footprints receive the new painted assets.
for(let y=2;y<W-2;y+=2)for(let x=2;x<W-2;x+=2){const p={x:(x+.5)*T,y:(y+.5)*T};
  if(LAND[y*W+x]&&!nearBase(p,120)&&random()<.64){const k=random(),cell=k<.5?0:k<.75?1:k<.85?2:k<.92?3:5;FEATURES.push({...p,kind:cell===0?'pine':cell===1?'oak':cell===2?'birch':cell===3?'bush':'rockLarge',size:cell<3?94+random()*35:cell===3?64:78,cell,block:false});}
  else if(!LAND[y*W+x]&&random()<.075&&!nearBase(p,190)){const k=random(),cell=k<.6?12:k<.8?13:k<.9?14:15;FEATURES.push({...p,kind:cell===12?'grass':cell===13?'flower':cell===14?'stump':'fern',size:28+random()*20,cell,block:false});}
}
// Hand-placed ponds are terrain obstacles rather than only decoration.
for(const p of [{x:2784,y:2784},{x:1312,y:1696},{x:3040,y:1408},{x:1088,y:3264}]){
  if(nearBase(p,450))continue;FEATURES.push({...p,kind:'water',size:210,cell:7,block:true});const cx=Math.floor(p.x/T),cy=Math.floor(p.y/T);for(let dy=-2;dy<=2;dy++)for(let dx=-3;dx<=3;dx++)if(dx*dx/9+dy*dy/4<=1&&valid(cx+dx,cy+dy))LAND[(cy+dy)*W+cx+dx]=ponds[(cy+dy)*W+cx+dx]=1;
}
for(let i=0;i<80;i++){const x=3+Math.floor(random()*(W-6)),y=3+Math.floor(random()*(W-6)),p={x:(x+.5)*T,y:(y+.5)*T};if(!LAND[y*W+x]&&!nearBase(p,400)&&random()<.5){const ruin=random()<.18;FEATURES.push({...p,kind:ruin?'ruin':'rock',size:ruin?86:42+random()*24,cell:ruin?6:4,block:true});LAND[y*W+x]=1;}}

// 在装饰生成后只移除障碍：随机资产保持稳定，旧存档中的空地不会变成墙。
const beforeClearing=LAND.slice(),center={x:W*T/2,y:W*T/2};
const baseClearingRadius=384,centralClearingRadius=256,approachHalfWidth=96;
function distanceToApproach(p:Point,base:Point){
  const dx=base.x-center.x,dy=base.y-center.y;
  const t=Math.max(0,Math.min(1,((p.x-center.x)*dx+(p.y-center.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p.x-center.x-t*dx,p.y-center.y-t*dy);
}
function clearCell(x:number,y:number,road=false){
  const i=y*W+x;
  // 保留地图边界与池塘，不能出现视觉上是水、实际却能穿过的路段。
  if(!valid(x,y)||ponds[i])return;
  LAND[i]=0;if(road)ROADS[i]=255;
}
for(let y=2;y<W-2;y++)for(let x=2;x<W-2;x++){
  const p={x:(x+.5)*T,y:(y+.5)*T};
  const road=Math.hypot(p.x-center.x,p.y-center.y)<centralClearingRadius
    ||bases.some(b=>distanceToApproach(p,b)<approachHalfWidth);
  if(road||nearBase(p,baseClearingRadius))clearCell(x,y,road);
}
// 单次快照识别一格窄口，向两侧各拓一格；不递归侵蚀整片森林。
const chokeSnapshot=LAND.slice();
for(let y=2;y<W-2;y++)for(let x=2;x<W-2;x++){
  const i=y*W+x;if(chokeSnapshot[i])continue;
  if(chokeSnapshot[i-1]&&chokeSnapshot[i+1]){clearCell(x-1,y);clearCell(x+1,y);}
  if(chokeSnapshot[i-W]&&chokeSnapshot[i+W]){clearCell(x,y-1);clearCell(x,y+1);}
}
// 清出的区域同步移除树木与大岩石，地表草丛和水面继续保留。
for(let i=FEATURES.length-1;i>=0;i--){
  const f=FEATURES[i],cell=index(f);
  if(beforeClearing[cell]&&!LAND[cell]&&['pine','oak','birch','bush','ruin','rock','rockLarge'].includes(f.kind))FEATURES.splice(i,1);
}

// 每张地图独立缓存，房间之间只读共享，绝不通过切换全局 LAND 改变战局。
const temple:WorldData={
  id:DEFAULT_MAP_ID,revision:1,land:LAND,roads:ROADS,features:FEATURES,
  bases:MAP.initial.filter(u=>u.type===5).map(u=>({x:u.x*T+16,y:u.y*T+16,side:u.camp as Side})),
  towers:MAP.initial.filter(u=>u.type===6).map(u=>({x:u.x*T+16,y:u.y*T+16,side:u.camp as Side})),
  resources:[{x:2048,y:2048},{x:1600,y:2240},{x:2496,y:1888}],
};
const resourceMapRevision=(id:MapId)=>id===DEFAULT_MAP_ID||isClassicMap(id)?2:3;
export const openingMapRevision=(id:MapId)=>resourceMapRevision(id)+1;
const extendedMapRevision=(id:MapId)=>openingMapRevision(id)+1;
const largeMapRevision=(id:MapId)=>extendedMapRevision(id)+1;
const previousMapRevision=(id:MapId)=>largeMapRevision(id)+(id===DEFAULT_MAP_ID?1:0);
const woodlandMapRevision=(id:MapId)=>previousMapRevision(id)+1;
export const latestMapRevision=(id:MapId)=>woodlandMapRevision(id)+1;
export const validMapRevision=(id:MapId,value:unknown)=>Number.isInteger(value)&&Number(value)>=1&&Number(value)<=latestMapRevision(id);
const worlds=new Map<string,WorldData>([[`${DEFAULT_MAP_ID}:1`,temple]]);
export function getWorld(id:MapId=DEFAULT_MAP_ID,revision=latestMapRevision(id)):WorldData {
  if(!isMapId(id)||!validMapRevision(id,revision))throw Error('未知战场或地形版本');
  const key=`${id}:${revision}`;
  let world=worlds.get(key);
  if(!world){
    if(revision===latestMapRevision(id))world=woodlandWorld(getWorld(id,largeMapRevision(id)),revision,true);
    else if(revision===woodlandMapRevision(id))world=woodlandWorld(getWorld(id,largeMapRevision(id)),revision);
    else if(id===DEFAULT_MAP_ID&&revision>largeMapRevision(id))world=templeWoodland(getWorld(id,largeMapRevision(id)),revision);
    else if(revision===largeMapRevision(id))world=resourceWorld(getWorld(id,resourceMapRevision(id)-1),revision,4);
    else if(revision===extendedMapRevision(id))world=resourceWorld(getWorld(id,resourceMapRevision(id)-1),revision,2);
    else if(revision===openingMapRevision(id)){
      const previous=getWorld(id,revision-1);
      const deposits=previous.deposits!.map(node=>node.tree===undefined?node:{...node,amount:RESOURCE_STOCK.tree,max:RESOURCE_STOCK.tree});
      world={...previous,revision,deposits};
    }else if(revision===resourceMapRevision(id))world=resourceWorld(getWorld(id,revision-1),revision);
    else if(isClassicMap(id))world=makeClassicWorld(id,initialNodes);
    else {
      const original=revision===1?makeWorld(id):getWorld(id,1);
      world=revision===1?original:naturalWorld(original,initialNodes(original));
    }
    worlds.set(key,world);
  }
  return world;
}

function makeWorld(id:MapId):WorldData {
  const land=new Uint8Array(W*W),roads=new Uint8Array(W*W),features:Feature[]=[];
  const starts=[{x:688,y:3408},{x:3408,y:688},{x:688,y:688},{x:3408,y:3408}]
    .map((p,i)=>({...p,side:(i+1) as Side}));
  const lakes=id==='twin-lakes'?[{x:2048,y:1248},{x:2048,y:2848}]:[];
  let state=id==='ring-valley'?0x20261101:id==='shattered-highlands'?0x20261102:0x20261103;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let y=0;y<W;y++)for(let x=0;x<W;x++){
    const p={x:(x+.5)*T,y:(y+.5)*T},dx=p.x-2048,dy=p.y-2048,r=Math.hypot(dx,dy),i=y*W+x;
    if(!valid(x,y)){land[i]=1;continue;}
    const water=lakes.some(l=>((p.x-l.x)/864)**2+((p.y-l.y)/443)**2<=1);
    let obstacle=false,road=false;
    if(id==='ring-valley'){
      const spoke=starts.some(b=>distanceToApproach(p,b)<164);
      obstacle=r>610&&r<1060&&!spoke;
      obstacle ||= r>1700&&(Math.abs(dx)<420||Math.abs(dy)<420);
      road=(r>1120&&r<1376)||r<410||spoke;
    }else if(id==='shattered-highlands'){
      const pass=[864,2048,3232].some(at=>Math.abs(p.y-at)<224);
      const ridge=[1440,2656].some(at=>Math.abs(p.x-at)<205+42*Math.cos(p.y/175));
      obstacle=ridge&&!pass&&p.y>320&&p.y<3776;
      obstacle ||= Math.abs(dx)<420&&Math.abs(dy)>1550;
      road=pass||Math.abs(dx)<160||Math.abs(p.x-864)<105||Math.abs(p.x-3232)<105;
    }else{
      obstacle=water||(Math.abs(dx)>1650&&Math.abs(dy)<640);
      road=Math.abs(dy)<175||Math.abs(p.x-960)<120||Math.abs(p.x-3136)<120;
    }
    // 基地扩建区不放装饰障碍；边缘林带提供边界感但不封住侧翼。
    obstacle ||= Math.min(p.x,p.y,W*T-p.x,W*T-p.y)<205;
    if(starts.some(b=>Math.hypot(p.x-b.x,p.y-b.y)<480))obstacle=false;
    land[i]=obstacle?1:0;roads[i]=road&&!obstacle?255:0;
    if(water)continue;
    if(obstacle&&x%2===0&&y%2===0){
      const rock=id==='shattered-highlands',k=rand();
      features.push({...p,kind:rock?'rockLarge':k<.7?'pine':'oak',cell:rock?5:k<.7?0:1,size:rock?100+rand()*35:105+rand()*26,block:false});
    }else if(!obstacle&&!road&&x%3===0&&y%3===0&&rand()<.22){
      features.push({...p,kind:'grass',cell:12,size:30+rand()*15,block:false});
    }
  }
  for(const lake of lakes)features.push({...lake,kind:'water',cell:7,size:1600,block:true,waterRadii:{x:800,y:410}});
  const towers=starts.flatMap(b=>{
    const length=Math.hypot(2048-b.x,2048-b.y),ix=(2048-b.x)/length,iy=(2048-b.y)/length;
    return [-1,1].map(sign=>({x:b.x+ix*180-iy*sign*310,y:b.y+iy*180+ix*sign*310,side:b.side}));
  });
  return {id,revision:1,land,roads,features,bases:starts,towers,resources:id==='twin-lakes'
    ?[{x:2048,y:2048},{x:928,y:2048},{x:3168,y:2048}]
    :[{x:2048,y:2048},{x:1888,y:1696},{x:2208,y:2400}]};
}

function freeNear(p:Point,reserved:Set<number>,land:Uint8Array):Point{
  const cx=Math.floor(p.x/T),cy=Math.floor(p.y/T);for(let r=0;r<20;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(r&&Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;const x=cx+dx,y=cy+dy;if(valid(x,y)&&!land[y*W+x]&&!reserved.has(y*W+x)){reserved.add(y*W+x);return{x:(x+.5)*T,y:(y+.5)*T};}}throw Error('Resource placement failed');
}
export function initialNodes(world:WorldData=temple):ResourceNode[]{if(world.deposits)return world.deposits.map(n=>({...n}));const nodes:ResourceNode[]=[],reserved=new Set<number>();let id=1;
  for(const b of world.bases){
    const inward={x:(2048-b.x)/Math.hypot(2048-b.x,2048-b.y),y:(2048-b.y)/Math.hypot(2048-b.x,2048-b.y)};
    // 新图的三种资源分散在基地前方，给后续加工厂和采集车留下独立进出空间。
    const offsets=world.id===DEFAULT_MAP_ID
      ?[{kind:'gold' as const,dx:230,dy:0},{kind:'wood' as const,dx:220,dy:180},{kind:'oil' as const,dx:360,dy:-130}]
      :[{kind:'gold' as const,dx:330,dy:-220},{kind:'wood' as const,dx:300,dy:220},{kind:'oil' as const,dx:450,dy:0}];
    for(const o of offsets){const p=freeNear({x:b.x+inward.x*o.dx-inward.y*o.dy,y:b.y+inward.y*o.dx+inward.x*o.dy},reserved,world.land);const amount=o.kind==='gold'?24000:o.kind==='wood'?20000:18000;nodes.push({...p,id:id++,kind:o.kind,amount,max:amount,radius:o.kind==='wood'?38:33});}
  }
  for(const p of world.resources)for(const [i,kind]of(['gold','wood','oil'] as ResourceKind[]).entries()){const at=freeNear({x:p.x+i*110,y:p.y-i*80},reserved,world.land);nodes.push({...at,id:id++,kind,amount:30000,max:30000,radius:35});}
  return nodes;
}
