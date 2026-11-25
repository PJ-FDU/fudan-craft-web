import { BufferGeometry, Float32BufferAttribute, PlaneGeometry, ShapeUtils, Vector2 } from 'three';
import { distanceToCurve, insidePolygon, terrainNoise, waterContour } from './terrain-shapes.js';
import { gridSize, TILE } from './pathfinding.js';
import { heightAt } from './terrain-height.js';
import type { Feature, WorldData } from './world.js';
import type { Point } from './types.js';

/** 支持真 3D 高度场（高地平台、斜坡、陡崖与水下凹陷）；无高度场的旧版地图退回平地。 */
export function terrainGeometry(world:WorldData,border:number){
  const size=gridSize(world.land),extent=size*TILE,segments=Math.min(320,size*2+32);
  const geometry=new PlaneGeometry(extent+border*2,extent+border*2,segments,segments)
    .rotateX(-Math.PI/2).translate(extent/2,0,extent/2);
  const positions=geometry.getAttribute('position');
  if(world.heights){
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),z=positions.getZ(i);
      const clampedX=Math.max(0,Math.min(extent,x)),clampedZ=Math.max(0,Math.min(extent,z));
      const outside=Math.max(0,Math.max(-x,x-extent,-z,z-extent));
      const baseH=heightAt(world,clampedX,clampedZ);
      const skirt=outside>0?Math.max(0,1-outside/border):1;
      positions.setY(i,baseH*skirt);
    }
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    return geometry;
  }
  const noise=terrainNoise(731);
  const waters=world.features.filter(f=>f.kind==='water').map(feature=>{
    const contour=waterContour(feature),x=feature.x+(feature.waterRadii?0:16),y=feature.y+(feature.waterRadii?0:16);
    return {x,y,contour,closed:[...contour,contour[0]],
      minX:Math.min(...contour.map(p=>p.x)),maxX:Math.max(...contour.map(p=>p.x)),
      minY:Math.min(...contour.map(p=>p.y)),maxY:Math.max(...contour.map(p=>p.y))};
  });
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i);
    let height=0;
    for(const water of waters){
      const p={x:x-water.x,y:z-water.y};
      if(p.x<water.minX||p.x>water.maxX||p.y<water.minY||p.y>water.maxY||!insidePolygon(p,water.contour))continue;
      const depth=distanceToCurve(p,water.closed);
      height=-Math.min(20,depth*.38);
    }
    const cx=Math.floor(x/TILE),cz=Math.floor(z/TILE);
    if(height===0&&cx>1&&cz>1&&cx<size-2&&cz<size-2){
      let interior=true;
      for(let dy=-1;dy<=1&&interior;dy++)for(let dx=-1;dx<=1;dx++)
        if(!world.land[(cz+dy)*size+cx+dx]){interior=false;break;}
      if(interior)height=Math.max(0,noise(x/93,z/93))*9;
    }
    positions.setY(i,height);
  }
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

/** 凹岸线统一三角化后细分，岸距控制浪高与泡沫，避免河湾被中心扇形填平。 */
export function waterGeometry(feature:Feature){
  const contour=waterContour(feature),closed=[...contour,contour[0]];
  const positions:number[]=[],depths:number[]=[];
  const depthCache=new Map<string,number>();
  const vertex=(p:Point)=>{
    const key=`${p.x.toFixed(4)},${p.y.toFixed(4)}`;
    let depth=depthCache.get(key);
    if(depth===undefined){depth=distanceToCurve(p,closed);depthCache.set(key,depth);}
    positions.push(p.x,1.35,p.y);depths.push(depth);
  };
  const middle=(a:Point,b:Point)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  function triangle(a:Point,b:Point,c:Point,level:number){
    if(!level){vertex(a);vertex(c);vertex(b);return;}
    const ab=middle(a,b),bc=middle(b,c),ca=middle(c,a);
    triangle(a,ab,ca,level-1);triangle(ab,b,bc,level-1);
    triangle(ca,bc,c,level-1);triangle(ab,bc,ca,level-1);
  }
  for(const [a,b,c] of ShapeUtils.triangulateShape(contour.map(p=>new Vector2(p.x,p.y)),[])){
    const points=[contour[a],contour[b],contour[c]];
    const span=Math.max(...points.map((p,i)=>Math.hypot(p.x-points[(i+1)%3].x,p.y-points[(i+1)%3].y)));
    triangle(...points as [Point,Point,Point],Math.min(4,Math.max(1,Math.ceil(Math.log2(span/65)))));
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('waterDepth',new Float32BufferAttribute(depths,1));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return geometry;
}

/** 根据格网水体掩码生成任意形状的自由水面（供 3D 地图编辑器与自定义地图使用）。 */
export function waterMaskGeometry(waterMask:Uint8Array,size:number):BufferGeometry|null {
  const positions:number[]=[],depths:number[]=[];
  const isWet=(x:number,y:number)=>x>=0&&y>=0&&x<size&&y<size&&waterMask[y*size+x]>0;
  const shoreDepth=(vx:number,vz:number)=>{
    let best=48;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      if(!isWet(vx+dx,vz+dy))best=Math.min(best,Math.hypot(dx,dy)*TILE);
    }
    return best;
  };
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    if(!waterMask[y*size+x])continue;
    const x0=x*TILE,x1=(x+1)*TILE,z0=y*TILE,z1=(y+1)*TILE;
    const d00=shoreDepth(x,y),d10=shoreDepth(x+1,y),d01=shoreDepth(x,y+1),d11=shoreDepth(x+1,y+1);
    // 朝上法线绕序：a(x0,z0) -> c(x0,z1) -> b(x1,z0)
    positions.push(x0,1.35,z0, x0,1.35,z1, x1,1.35,z0);
    depths.push(d00,d01,d10);
    positions.push(x1,1.35,z0, x0,1.35,z1, x1,1.35,z1);
    depths.push(d10,d01,d11);
  }
  if(!positions.length)return null;
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('waterDepth',new Float32BufferAttribute(depths,1));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return geometry;
}
