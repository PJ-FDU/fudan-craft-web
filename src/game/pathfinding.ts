import { LAND } from './world.js';
import type { Point } from './types.js';
import { TILE,gridSize,inBounds } from './grid.js';
export { SIZE,TILE,WORLD,gridSize,indexAt,inBounds } from './grid.js';
export const terrain = LAND;
export const distance = (a: Point,b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
export function walkable(p: Point, blocked = terrain) { const size=gridSize(blocked),x=Math.floor(p.x/TILE),y=Math.floor(p.y/TILE);return inBounds(x,y,size) && !blocked[y*size+x]; }
export function nearestFree(p: Point, blocked = terrain): Point | null {
  const size=gridSize(blocked);
  const x=Math.max(0,Math.min(size-1,Math.floor(p.x/TILE))),y=Math.max(0,Math.min(size-1,Math.floor(p.y/TILE)));
  for(let r=0;r<size;r++) for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++) {
    if(r && Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
    if(inBounds(x+dx,y+dy,size) && !blocked[(y+dy)*size+x+dx])return{x:(x+dx+.5)*TILE,y:(y+dy+.5)*TILE};
  }
  return null;
}
class Heap {
  a: { i:number; f:number }[]=[];
  push(i:number,f:number) { const item={i,f};let n=this.a.length;this.a.push(item);while(n>0){const p=(n-1)>>1;if(this.a[p].f<=f)break;this.a[n]=this.a[p];n=p;}this.a[n]=item; }
  pop() {const top=this.a[0],v=this.a.pop()!;if(this.a.length){let n=0;while(n*2+1<this.a.length){let c=n*2+1;if(c+1<this.a.length && this.a[c+1].f<this.a[c].f)c++;if(this.a[c].f>=v.f)break;this.a[n]=this.a[c];n=c;}this.a[n]=v;}return top;}
}
// Octile A*, with a binary heap and no diagonal corner cutting.
export function findPath(start: Point, end: Point, blocked = terrain, options:{traffic?:ReadonlyMap<number,number>;closest?:boolean;canTraverse?:(a:Point,b:Point)=>boolean;maxVisited?:number}={}): Point[] {
  const size=gridSize(blocked);
  const goal=nearestFree(end,blocked);if(!goal)return[];
  const sx=Math.floor(start.x/TILE),sy=Math.floor(start.y/TILE),gx=Math.floor(goal.x/TILE),gy=Math.floor(goal.y/TILE);
  if(!inBounds(sx,sy,size))return[];
  const si=sy*size+sx,gi=gy*size+gx;
  if(si===gi)return[goal];
  const g=new Float32Array(size*size).fill(Infinity),prev=new Int32Array(size*size).fill(-1),closed=new Uint8Array(size*size),heap=new Heap();
  const h=(x:number,y:number)=>Math.max(Math.abs(gx-x),Math.abs(gy-y))+.41421356*Math.min(Math.abs(gx-x),Math.abs(gy-y));
  const unpack=(goalIndex:number)=>{
    const result:Point[]=[];
    for(let k=goalIndex;k!==si;k=prev[k])result.push({x:(k%size+.5)*TILE,y:(Math.floor(k/size)+.5)*TILE});
    return result.reverse();
  };
  let closest=si,remaining=Infinity,visited=0;
  g[si]=0;heap.push(si,h(sx,sy));
  while(heap.a.length){const {i}=heap.pop();if(closed[i])continue;if(i===gi)return unpack(gi);
    closed[i]=1;const x=i%size,y=Math.floor(i/size);
    if(options.closest){
      const d=((x+.5)*TILE-end.x)**2+((y+.5)*TILE-end.y)**2;
      if(d<remaining||(d===remaining&&g[i]<g[closest])){remaining=d;closest=i;}
    }
    if(++visited>=(options.maxVisited??Infinity))break;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(!inBounds(nx,ny,size))continue;const ni=ny*size+nx;
      if(blocked[ni]||closed[ni]||(dx&&dy&&(blocked[y*size+nx]||blocked[ny*size+x])))continue;
      if(options.canTraverse&&!options.canTraverse(i===si?start:{x:(x+.5)*TILE,y:(y+.5)*TILE},{x:(nx+.5)*TILE,y:(ny+.5)*TILE}))continue;
      const ng=g[i]+(dx&&dy?Math.SQRT2:1)+(options.traffic?.get(ni)??0);if(ng<g[ni]){g[ni]=ng;prev[ni]=i;heap.push(ni,ng+h(nx,ny));}
    }
  }
  return options.closest?unpack(closest):[];
}
