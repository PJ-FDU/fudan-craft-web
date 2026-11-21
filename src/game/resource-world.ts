import { OUTPOST_STOCK,outpostAnchor } from './outposts.js';
import type { Feature,WorldData } from './world.js';
import type { Point,ResourceNode } from './types.js';
import { insidePolygon,terrainNoise,waterContour } from './terrain-shapes.js';
import { SIZE,TILE,WORLD,gridSize,indexAt } from './grid.js';

// 格线上的点向地图中心吸附；普通 floor 会让一对镜像矿点同时向右下偏 16。
export const resourcePoint=(p:Point,extent=WORLD)=>{
  const center=extent/2;
  const axis=(n:number)=>n===center?n:n<center?(Math.floor(n/TILE)+.5)*TILE:(Math.ceil(n/TILE)-.5)*TILE;
  return {x:axis(p.x),y:axis(p.y)};
};
export const STARTING_RESOURCES={gold:1500,wood:600,oil:0} as const;
const ORIGINAL_TREE_STOCK=150;
export const RESOURCE_STOCK={mainGold:10000,mainOil:2600,expansionGold:6000,expansionOil:1800,contestedGold:9000,tree:300} as const;
export const isTree=(f:Feature)=>f.kind==='pine'||f.kind==='oak'||f.kind==='birch';
const isRock=(f:Feature)=>f.kind==='rock'||f.kind==='rockLarge'||f.kind==='ruin';

/** 矿藏按种类独立布点；成对锚点是镜像坐标，不再叠加全局方向偏移。 */
function minerals(world:WorldData):{gold:Point[];oil:Point[];center?:Point}{
  const points=(p:number[][])=>p.map(([x,y])=>({x,y}));
  switch(world.id){
    case 'echo-isles':return {gold:points([[800,2912],[3296,2912]]),oil:points([[1184,2048],[2912,2048]]),center:{x:2048,y:1712}};
    case 'twisted-meadows':return {gold:points([[1840,752],[2256,3344],[656,2064],[3440,2032]]),
      oil:points([[1408,1856],[2688,2240],[1648,2576],[2448,1520]]),center:{x:2048,y:2048}};
    case 'turtle-rock':return {gold:points([[2048,1344],[2048,2752],[1408,2336],[2688,1760]]),
      oil:points([[1728,2048],[2368,2048]])};
    case 'terenas-stand':return {gold:points([[1088,3040],[3008,1056]]),
      oil:points([[1568,2192],[2528,1904]]),center:{x:2048,y:2048}};
    case 'twin-lakes':return {gold:points([[928,1744],[3168,2352],[928,2352],[3168,1744]]),
      oil:points([[1216,2048],[2880,2048],[1600,3520],[2496,576]]),center:{x:2048,y:2048}};
    case 'shattered-highlands':return {gold:points([[1408,1056],[2688,3040],[1056,2688],[3040,1408]]),
      oil:points([[1856,1696],[2240,2400],[864,2048],[3232,2048]]),center:{x:2048,y:2048}};
    case 'lost-temple':{
      // 原神庙四个基地不是镜像角点；扩张区按各自基地的局部坐标校准距离。
      const offset=(forward:number,lateral:number)=>world.bases.map(b=>{
        const d=Math.hypot(2048-b.x,2048-b.y),x=(2048-b.x)/d,y=(2048-b.y)/d;
        return {x:b.x+x*forward-y*lateral,y:b.y+y*forward+x*lateral};
      });
      return {gold:offset(864,128),oil:offset(1184,-160),center:{x:2048,y:2048}};
    }
    default:return {gold:points([[1408,1056],[2688,3040],[1056,2688],[3040,1408]]),
      oil:points([[1600,1536],[2496,2560],[1536,2496],[2560,1600]]),center:{x:2048,y:2048}};
  }
}

function expandTerrain(original:WorldData,scale:number):WorldData{
  const size=SIZE*scale,extent=size*TILE,land=new Uint8Array(size*size),roads=new Uint8Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const source=Math.floor(y/scale)*SIZE+Math.floor(x/scale),at=y*size+x;
    land[at]=original.land[source];roads[at]=original.roads[source];
  }
  const project=(p:Point)=>({x:p.x*scale,y:p.y*scale});
  const bases=original.bases.map(b=>({...b,...resourcePoint(project(b),extent)}));
  const towers=original.towers.map(t=>{
    const base=original.bases.find(b=>b.side===t.side)!,expanded=bases.find(b=>b.side===t.side)!;
    return {...t,x:expanded.x+t.x-base.x,y:expanded.y+t.y-base.y};
  });
  const features=original.features.map(f=>({
    ...f,...project(f),
    size:['water','rock','rockLarge','ruin'].includes(f.kind)?f.size*scale:f.size,
    ...(f.waterRadii?{waterRadii:project(f.waterRadii)}:scale>2&&f.kind==='water'?{waterRadii:project({x:105,y:73})}:{}),
    ...(f.outline?{outline:f.outline.map(project)}:{}),
  }));
  const occupied=new Set(features.filter(isTree).map(f=>indexAt(f,size)));
  if(scale===2)for(const [i,f] of features.slice().entries())if(isTree(f)){
    const extra={...f,...resourcePoint({x:f.x+(i%2?1:-1)*TILE,y:f.y+(i%4<2?1:-1)*TILE},extent)};
    const at=indexAt(extra,size);
    if(extra.x>=TILE&&extra.y>=TILE&&extra.x<extent-TILE&&extra.y<extent-TILE&&land[at]&&!occupied.has(at)){
      features.push(extra);occupied.add(at);
    }
  }
  return {...original,land,roads,features,bases,towers,resources:original.resources.map(project)};
}

/** 在原林带里重建林团和曲折林道，保留干道、岩脊和岸线。 */
function woodlandFeatures(source:WorldData,land:Uint8Array,roads:Uint8Array,water:Uint8Array):Feature[]{
  const size=gridSize(land),woods=new Uint8Array(land.length),stone=new Uint8Array(land.length),trails=new Uint8Array(land.length);
  const seed=[...source.id].reduce((hash,letter)=>Math.imul(hash^letter.charCodeAt(0),16777619),2166136261);
  const noise=terrainNoise(seed);
  const stamp=(p:Point,r:number,visit:(at:number)=>void)=>{
    for(let y=Math.max(8,Math.floor((p.y-r)/TILE));y<Math.min(size-8,Math.ceil((p.y+r)/TILE));y++)
      for(let x=Math.max(8,Math.floor((p.x-r)/TILE));x<Math.min(size-8,Math.ceil((p.x+r)/TILE));x++)
        if(((x+.5)*TILE-p.x)**2+((y+.5)*TILE-p.y)**2<=r*r)visit(y*size+x);
  };
  for(const f of source.features)if(isRock(f))stamp(f,f.size*.45,at=>{stone[at]=1;});
  for(const f of source.features)if(isTree(f))stamp(f,256,at=>{
    if(land[at]&&!water[at]&&!stone[at])woods[at]=1;
  });
  for(let y=8;y<size-8;y++)for(let x=8;x<size-8;x++){
    const at=y*size+x;if(!woods[at])continue;
    land[at]=0;
    const east=x+noise(.7,y/22)*6,north=y+noise(x/22,7.4)*6;
    if(Math.abs(east%26-13)<2.2||Math.abs(north%31-15.5)<2.2){trails[at]=1;roads[at]=105;}
  }
  const features=source.features.filter(f=>!isTree(f));
  for(let y=10;y<size-10;y+=4)for(let x=10;x<size-10;x+=4){
    const tx=x+Math.round(noise(x/4,y/4)),ty=y+Math.round(noise(y/4+12,x/4)),at=ty*size+tx;
    const density=noise(x/24,y/24);
    if(!woods[at]||trails[at]||density<-.48)continue;
    const p={x:(tx+.5)*TILE,y:(ty+.5)*TILE};
    const kind=density>.24?'oak':noise(x/8+6,y/8)>.2?'birch':'pine';
    features.push({...p,kind,cell:kind==='pine'?0:kind==='oak'?1:2,size:98+Math.round(density*35),block:true});
    stamp(p,52+density*16,cell=>{if(woods[cell]&&!trails[cell])land[cell]=1;});
  }
  return features;
}

/** 共享 WorldData 永远不写入局内状态。 */
export function resourceWorld(original:WorldData,revision:number,scale=1):WorldData{
  const source=scale===1?original:expandTerrain(original,scale);
  const land=source.land.slice(),roads=source.roads.slice();
  const size=gridSize(land),extent=size*TILE,center=extent/2;
  const index=(p:Point)=>indexAt(p,size);
  let features=[...source.features];
  const waters=features.filter(f=>f.kind==='water').map(f=>{
    const contour=waterContour(f,f.outline?1.045:1.08);
    return {f,contour,rx:Math.max(...contour.map(p=>Math.abs(p.x))),ry:Math.max(...contour.map(p=>Math.abs(p.y)))};
  });
  const wet=(p:Point)=>waters.some(({f,contour,rx,ry})=>{
    const x=p.x-f.x,y=p.y-f.y;return Math.abs(x)<=rx&&Math.abs(y)<=ry&&insidePolygon({x,y},contour);
  });
  const water=new Uint8Array(land.length);
  // 放大后的岸线仍以多边形为准，去除重采样后可能露出的临水格。
  if(scale>1)for(let y=0;y<size;y++)for(let x=0;x<size;x++)
    if(wet({x:(x+.5)*TILE,y:(y+.5)*TILE})){land[y*size+x]=water[y*size+x]=1;roads[y*size+x]=0;}
  if(scale>2)features=woodlandFeatures(source,land,roads,water);
  const deposits:ResourceNode[]=[],treeTiles=new Map<number,readonly number[]>();
  const clear=(at:Point,r:number)=>{
    for(let y=Math.max(2,Math.floor((at.y-r)/TILE));y<Math.min(size-2,Math.ceil((at.y+r)/TILE));y++)
      for(let x=Math.max(2,Math.floor((at.x-r)/TILE));x<Math.min(size-2,Math.ceil((at.x+r)/TILE));x++){
        const p={x:(x+.5)*TILE,y:(y+.5)*TILE};
        if(Math.hypot(p.x-at.x,p.y-at.y)<=r&&!wet(p))land[y*size+x]=0;
      }
    features=features.filter(f=>f.kind==='water'||!['pine','oak','birch','rock','rockLarge','bush','ruin'].includes(f.kind)
      ||Math.hypot(f.x-at.x,f.y-at.y)>r);
  };
  const add=(kind:'gold'|'oil',point:Point,amount:number,startSide?:ResourceNode['startSide'],radius=startSide===undefined?104*scale:104)=>{
    const at=resourcePoint(point,extent);
    if(wet(at))throw Error(`${original.id}: mineral anchor is in water (${at.x},${at.y})`);
    clear(at,radius);
    deposits.push({...at,id:deposits.length+1,kind,amount,max:amount,radius:33,...(startSide?{startSide}:{})});
  };
  for(const b of [...source.bases].sort((a,b)=>a.side-b.side)){
    const sx=b.x<center?1:-1,sy=b.y<center?1:-1;
    add('gold',{x:b.x+sx*352,y:b.y},RESOURCE_STOCK.mainGold,b.side);
    add('oil',{x:b.x+sx*320,y:b.y+sy*288},RESOURCE_STOCK.mainOil,b.side);
  }
  const layout=minerals(original);
  const project=(p:Point)=>({x:p.x*scale,y:p.y*scale});
  for(const p of layout.gold)add('gold',project(p),RESOURCE_STOCK.expansionGold);
  for(const p of layout.oil)add('oil',project(p),RESOURCE_STOCK.expansionOil);
  if(layout.center)add('gold',project(layout.center),RESOURCE_STOCK.contestedGold);

  // 前哨矿点落在基地可向外扩建的范围，远处原有扩张矿和争夺矿继续分开布点。
  if(scale>2)for(const b of source.bases){
    add('gold',outpostAnchor(b,extent,'gold'),OUTPOST_STOCK.gold,undefined,144);
    add('oil',outpostAnchor(b,extent),OUTPOST_STOCK.oil,undefined,144);
  }

  // 每方一片同尺寸的近基地林，前排可采后逐层向内推进。
  const starterTrees:{feature:Feature;side:ResourceNode['startSide']}[]=[];
  for(const b of source.bases){
    const sx=b.x<center?1:-1,sy=b.y<center?1:-1;
    const forestCenter={x:b.x,y:b.y+sy*432};clear(forestCenter,150);
    for(let row=0;row<6;row++)for(let column=0;column<4;column++){
      const p=resourcePoint({x:b.x+sx*(column-1.5)*32,y:b.y+sy*(352+row*32)},extent);
      if(wet(p))throw Error(`${original.id}: starting forest is in water`);
      const kind=column%3===0?'pine':column%3===1?'oak':'birch';
      starterTrees.push({feature:{...p,kind,cell:kind==='pine'?0:kind==='oak'?1:2,size:66,block:true},side:b.side});
    }
  }
  // 河岸的旧装饰偶有树冠伸入水面；移除水中树干，不能生成不可采集的假树。
  features=features.filter(f=>!isTree(f)||!wet(f));
  features.push(...starterTrees.map(t=>t.feature));
  const trees=features.flatMap((f,i)=>isTree(f)?[{f,i}]:[]);
  const rocks=features.filter(isRock);
  const cells=new Map<number,number[]>(trees.map(t=>[t.i,[]]));
  // 原有林带的格子归最近的真实树木所有；水、岩石、边界始终是永久障碍。
  const owner=new Int32Array(land.length).fill(-1),nearest=new Float64Array(land.length).fill(72**2);
  for(const {f,i} of trees){
    const cx=Math.floor(f.x/TILE),cy=Math.floor(f.y/TILE);
    for(let y=Math.max(2,cy-3);y<=Math.min(size-3,cy+3);y++)
      for(let x=Math.max(2,cx-3);x<=Math.min(size-3,cx+3);x++){
        const at=y*size+x,d=(f.x-(x+.5)*TILE)**2+(f.y-(y+.5)*TILE)**2;
        if(land[at]&&d<nearest[at]){nearest[at]=d;owner[at]=i;}
      }
  }
  for(let y=2;y<size-2;y++)for(let x=2;x<size-2;x++){
    const at=y*size+x,tree=owner[at];if(tree<0)continue;
    const p={x:(x+.5)*TILE,y:(y+.5)*TILE};
    if(wet(p)||rocks.some(f=>Math.hypot(f.x-p.x,f.y-p.y)<f.size*.45))continue;
    cells.get(tree)!.push(at);
  }
  const permanentLand=land.slice();
  for(const footprint of cells.values())for(const at of footprint)permanentLand[at]=0;
  const treeStock=scale===1?ORIGINAL_TREE_STOCK:RESOURCE_STOCK.tree;
  for(const {f,i} of trees){
    const at=index(f);
    if(wet(f))throw Error(`${original.id}: tree in water`);
    // 树干格必须阻挡；同格重叠树只在全部耗尽后才开放。
    land[at]=1;roads[at]=0;
    const footprint=cells.get(i)!;if(!footprint.includes(at))footprint.push(at);
    treeTiles.set(i,footprint);
    const side=starterTrees.find(t=>t.feature===f)?.side;
    deposits.push({x:f.x,y:f.y,id:deposits.length+1,kind:'wood',amount:treeStock,max:treeStock,radius:18,tree:i,...(side?{startSide:side}:{})});
  }
  // 资源清障与树干格可能围出微小空穴；它们不能成为单位生成或建筑落点。
  const reached=new Uint8Array(land.length),queue=[index(source.bases[0])];reached[queue[0]]=1;
  for(let k=0;k<queue.length;k++){
    const at=queue[k],x=at%size,y=Math.floor(at/size);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy,next=ny*size+nx;
      if(nx<0||ny<0||nx>=size||ny>=size||land[next]||reached[next])continue;
      reached[next]=1;queue.push(next);
    }
  }
  for(const p of [...source.bases,...deposits.filter(n=>n.kind!=='wood')])
    if(!reached[index(p)])throw Error(`${original.id}: disconnected mineral or base (${p.x},${p.y})`);
  for(let i=0;i<land.length;i++)if(!land[i]&&!reached[i]){land[i]=permanentLand[i]=1;roads[i]=0;}
  return {...source,revision,land,roads,features,deposits,treeTiles,permanentLand};
}

/** 服务器、建造预览和小地图共用这份砍伐后地形；重叠树的占地取并集。 */
export function harvestLand(world:WorldData,nodes:readonly ResourceNode[]):Uint8Array{
  const land=world.land.slice();
  if(!world.treeTiles)return land;
  for(const n of nodes)if(n.tree!==undefined&&n.amount<=0)
    for(const at of world.treeTiles.get(n.tree)??[])if(!world.permanentLand?.[at])land[at]=0;
  for(const n of nodes)if(n.tree!==undefined&&n.amount>0)
    for(const at of world.treeTiles.get(n.tree)??[])land[at]=1;
  return land;
}
