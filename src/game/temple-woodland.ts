import { gridSize,indexAt,TILE } from './grid.js';
import { isTree,RESOURCE_STOCK,resourcePoint } from './resource-world.js';
import { insidePolygon,terrainNoise } from './terrain-shapes.js';
import type { Feature,WorldData } from './world.js';
import type { Point } from './types.js';

// Wooded areas from the map markup, expressed as percentages of the map.
export const TEMPLE_GLADES:readonly (readonly [number,number])[][]=[
  [[3,33],[8,20],[18,9],[21,3],[39,1],[45,9],[40,19],[36,29],[27,38],[17,34]],
  [[23,2],[47,1],[77,1],[83,7],[75,23],[70,28],[71,18],[70,8],[48,4],[32,7]],
  [[81,23],[87,9],[91,2],[98,4],[99,37],[90,37],[85,40],[76,38]],
  [[49,20],[63,13],[68,13],[63,24],[57,28],[49,25]],
  [[38,38],[44,34],[45,45],[42,52],[34,55],[32,49]],
  [[50,32],[60,33],[68,33],[67,41],[56,45],[52,43]],
  [[11,44],[19,46],[25,51],[28,58],[22,63],[15,61],[10,52]],
  [[37,60],[45,58],[47,62],[44,66],[38,65],[35,62]],
  [[61,52],[67,50],[68,56],[63,61],[57,63],[56,58]],
  [[3,78],[12,69],[25,64],[27,68],[18,75],[16,81],[18,85],[8,92],[4,97]],
  [[13,96],[19,87],[26,85],[31,77],[34,77],[33,88],[28,94],[29,99],[21,99]],
  [[39,87],[41,77],[46,74],[49,77],[50,85],[46,83],[44,89],[41,91]],
  [[77,62],[86,64],[92,68],[98,65],[99,98],[67,99],[59,92],[60,82],[66,84],[69,77],[68,71]],
];

function distanceToRoute(p:Point,a:Point,b:Point){
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}

export function templeWoodland(source:WorldData,revision:number):WorldData{
  const land=source.land.slice(),roads=source.roads.slice();
  const size=gridSize(land),extent=size*TILE,center={x:extent/2,y:extent/2};
  const features=[...source.features],deposits=[...source.deposits!],treeTiles=new Map(source.treeTiles);
  const minerals=deposits.filter(node=>node.kind!=='wood');
  const noise=terrainNoise(0x74656d70);
  const areas=TEMPLE_GLADES.map(polygon=>polygon.map(([x,y])=>({x:x*extent/100,y:y*extent/100})));
  const occupied=new Uint8Array(land.length);
  const mark=(point:Point,radius:number)=>{
    const c=Math.floor(point.x/TILE),r=Math.floor(point.y/TILE);
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(dx*dx+dy*dy<=radius*radius&&c+dx>=0&&c+dx<size&&r+dy>=0&&r+dy<size)occupied[(r+dy)*size+c+dx]=1;
    }
  };
  for(const feature of features)if(isTree(feature))mark(feature,2);

  const protectedGround=(point:Point)=>minerals.some(n=>Math.hypot(n.x-point.x,n.y-point.y)<236)
    ||source.bases.some(base=>Math.hypot(base.x-point.x,base.y-point.y)<545||distanceToRoute(point,base,center)<230);
  const add=(point:Point,nearBase:boolean)=>{
    const x=Math.floor(point.x/TILE),y=Math.floor(point.y/TILE),at=indexAt(point,size);
    if(x<8||x>=size-8||y<8||y>=size-8||occupied[at]||land[at]||protectedGround(point))return false;
    const grain=noise(x/11,y/11),kind:Feature['kind']=grain>.23?'oak':grain<-.26?'birch':'pine';
    const tree=features.length;
    features.push({...point,kind,cell:kind==='pine'?0:kind==='oak'?1:2,size:Math.round((nearBase?92:132)+grain*32),block:true});
    // Only the tree's newly occupied cells disappear when its stock is exhausted.
    const cells=[at];
    if(!nearBase)for(const neighbor of [at-1,at+1,at-size,at+size])if(!land[neighbor])cells.push(neighbor);
    for(const cell of cells){land[cell]=1;roads[cell]=0;}
    treeTiles.set(tree,cells);mark(point,nearBase?2:3);
    deposits.push({...point,id:deposits.length+1,kind:'wood',amount:RESOURCE_STOCK.tree,max:RESOURCE_STOCK.tree,radius:18,tree});
    return true;
  };

  // Reserve the same amount of extra close timber for each of the four starts.
  for(const base of source.bases){
    const cells:{point:Point;priority:number}[]=[];
    for(let y=-34;y<=34;y+=3)for(let x=-34;x<=34;x+=3){
      const point=resourcePoint({x:base.x+(x+noise(x,y)*1.3)*TILE,y:base.y+(y+noise(y,x+8)*1.3)*TILE},extent);
      const radius=Math.hypot(point.x-base.x,point.y-base.y);
      if(radius>=580&&radius<1160)cells.push({point,priority:radius+noise(x/9+base.side,y/9)*420});
    }
    let planted=0;
    for(const {point} of cells.sort((a,b)=>a.priority-b.priority)){
      if(add(point,true)&&++planted===48)break;
    }
    if(planted!==48)throw Error('Lost Temple: unable to plant an equal starting woodland');
  }

  for(let y=10;y<size-10;y+=6){
    for(let x=10;x<size-10;x+=6){
      const px=x+Math.round(noise(x/6,y/6)*3.1),py=y+Math.round(noise(y/6+9,x/6)*3.1);
      const point={x:(px+.5)*TILE,y:(py+.5)*TILE};
      if(source.bases.some(base=>Math.hypot(base.x-point.x,base.y-point.y)<1170))continue;
      const rim=Math.min(point.x,point.y,extent-point.x,extent-point.y)<extent*.037;
      if((rim||areas.some(area=>insidePolygon(point,area)))
        &&Math.abs((px+noise(4,py/19)*4)%34-16)>1.8
        &&Math.abs((py+noise(px/19,4)*4)%41-20)>1.8)add(point,false);
    }
  }
  return {...source,revision,land,roads,features,deposits,treeTiles};
}
