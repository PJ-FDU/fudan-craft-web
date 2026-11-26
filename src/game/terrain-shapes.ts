import type { Point } from './types.js';
import type { Feature } from './world.js';

/** 仅平滑地表显示遮罩，不修改道路、碰撞或地图版本；固定一格半径避免大地图过度模糊。 */
export function smoothRoadMask(roads:Uint8Array,size:number):Uint8Array {
  const horizontal=new Float32Array(roads.length),result=new Uint8Array(roads.length);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const row=y*size;
    horizontal[row+x]=(roads[row+Math.max(0,x-1)]+roads[row+x]*2+roads[row+Math.min(size-1,x+1)])/4;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)
    result[y*size+x]=Math.round((horizontal[Math.max(0,y-1)*size+x]+horizontal[y*size+x]*2+horizontal[Math.min(size-1,y+1)*size+x])/4);
  return result;
}

// 坐标噪声不消耗装饰随机序列：增减一棵树不会改变道路、湖岸或碰撞。
export function terrainNoise(seed:number){
  const hash=(x:number,y:number)=>{
    let h=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967295*2-1;
  };
  return (x:number,y:number)=>{
    const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
    const u=tx*tx*(3-2*tx),v=ty*ty*(3-2*ty);
    const a=hash(ix,iy)*(1-u)+hash(ix+1,iy)*u;
    const b=hash(ix,iy+1)*(1-u)+hash(ix+1,iy+1)*u;
    return a*(1-v)+b*v;
  };
}

/** 用少量手工锚点描述地形走向，再插值成连续曲线。 */
export function terrainCurve(points:Point[]):Point[]{
  const result:Point[]=[];
  for(let i=0;i<points.length-1;i++){
    const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)];
    for(let j=0;j<8;j++){
      const t=j/8,t2=t*t,t3=t2*t;
      const value=(key:'x'|'y')=>.5*(2*b[key]+(-a[key]+c[key])*t+(2*a[key]-5*b[key]+4*c[key]-d[key])*t2+(-a[key]+3*b[key]-3*c[key]+d[key])*t3);
      result.push({x:value('x'),y:value('y')});
    }
  }
  result.push(points.at(-1)!);return result;
}

export function distanceToCurve(p:Point,points:readonly Point[]):number{
  let best=Infinity;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
    const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
    best=Math.min(best,(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2);
  }
  return Math.sqrt(best);
}

export function insidePolygon(p:Point,points:readonly Point[]):boolean{
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}

// 同一条湖岸轮廓供碰撞栅格化、3D 水面、2D 和地图预览使用。
export function waterContour(feature:Feature,scale=1):Point[]{
  if(feature.outline)return feature.outline.map(p=>({x:p.x*scale,y:p.y*scale}));
  return Array.from({length:24},(_,i)=>{
    const a=i*Math.PI/12,r=(feature.waterRadii?1:1+.075*Math.sin(a*5)+.038*Math.cos(a*7))*scale;
    return {x:Math.cos(a)*(feature.waterRadii?.x??105)*r,y:Math.sin(a)*(feature.waterRadii?.y??73)*r};
  });
}
export function traceWater(c:CanvasRenderingContext2D,feature:Feature,scale=1){
  c.beginPath();
  if(feature.outline){
    feature.outline.forEach((p,i)=>{
      const x=feature.x+p.x*scale,y=feature.y+p.y*scale;
      if(i)c.lineTo(x,y);else c.moveTo(x,y);
    });
    c.closePath();
  }else c.ellipse(feature.x+(feature.waterRadii?0:16),feature.y+(feature.waterRadii?0:16),(feature.waterRadii?.x??105)*scale,(feature.waterRadii?.y??73)*scale,0,0,Math.PI*2);
}
