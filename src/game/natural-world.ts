import type { Point,ResourceNode } from './types.js';
import type { Feature,WorldData } from './world.js';
import { terrainNoise,terrainCurve,distanceToCurve,insidePolygon,waterContour } from './terrain-shapes.js';

const SIZE=128,TILE=32,CENTER=2048;
const curve=(points:number[][])=>terrainCurve(points.map(([x,y])=>({x,y})));
type Grove=readonly [number,number,number,number];
export interface NaturalLayout {
  seed:number;
  paths:Point[][];
  groves:readonly Grove[];
  waters?:readonly Feature[];
  wetland?:boolean;
}

/** 保留战术拓扑，用手工走势 + 多尺度边缘替换几何色块。 */
export function naturalWorld(layout:WorldData,nodes:ResourceNode[],authored?:NaturalLayout):WorldData{
  const {id,bases}=layout,highland=id==='shattered-highlands',wetland=authored?.wetland??id==='twin-lakes';
  const seed=authored?.seed??(highland?0x67212:wetland?0x89435:0x36127),noise=terrainNoise(seed);
  let state=seed;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const land=new Uint8Array(SIZE*SIZE),roads=new Uint8Array(SIZE*SIZE),water=new Uint8Array(SIZE*SIZE);
  const features:Feature[]=[],shorelines:{feature:Feature;points:Point[]}[]=[];
  const detail=(p:Point)=>noise(p.x/320,p.y/320)*.7+noise(p.x/100+40,p.y/100)*.3;

  if(authored){
    for(const feature of authored.waters??[]){
      features.push(feature);shorelines.push({feature,points:waterContour(feature,1.045)});
    }
  }else if(wetland){
    for(const [cx,cy,rx,ry,rotation,phase] of [[1910,1210,860,390,-.14,.5],[2200,2860,825,425,.17,2.2]]){
      const outline=Array.from({length:96},(_,i)=>{
        const a=i/96*Math.PI*2,r=1+.12*Math.sin(a*3+phase)+.065*Math.cos(a*5-phase)+.028*Math.sin(a*9+phase);
        const x=Math.cos(a)*rx*r,y=Math.sin(a)*ry*r;
        return{x:x*Math.cos(rotation)-y*Math.sin(rotation),y:x*Math.sin(rotation)+y*Math.cos(rotation)};
      });
      const feature:Feature={x:cx,y:cy,kind:'water',cell:7,size:rx*2.5,block:true,waterRadii:{x:rx,y:ry},outline};
      features.push(feature);shorelines.push({feature,points:waterContour(feature,1.045)});
    }
  }

  const roadsCurves:Point[][]=[];
  let groves:readonly Grove[];
  const ridges=highland?[
    curve([[1320,250],[1540,800],[1330,1470],[1560,2160],[1390,2910],[1490,3790]]),
    curve([[2810,280],[2550,900],[2750,1480],[2490,2230],[2720,2910],[2580,3790]]),
  ]:[];
  if(authored){
    roadsCurves.push(...authored.paths);groves=authored.groves;
  }else if(wetland){
    roadsCurves.push(
      curve([[580,2130],[1250,1990],[2020,2130],[2740,1980],[3480,2110]]),
      curve([[688,688],[785,1180],[690,1870],[850,2540],[688,3408]]),
      curve([[3408,688],[3260,1360],[3400,2048],[3300,2720],[3408,3408]]),
    );
    groves=[[1910,510,590,245],[1450,1650,330,215],[2840,1470,265,340],[1390,2600,260,380],[2510,3480,490,270],[470,2020,300,570],[3650,2180,300,540]];
  }else if(highland){
    roadsCurves.push(
      curve([[620,850],[1250,950],[2030,770],[2760,975],[3490,845]]),
      curve([[540,2140],[1270,1980],[1960,2110],[2750,1940],[3530,2100]]),
      curve([[670,3290],[1430,3150],[2110,3340],[2810,3160],[3460,3300]]),
      curve([[800,680],[965,1390],[830,2210],[915,2870],[740,3450]]),
      curve([[3330,650],[3190,1460],[3330,2300],[3160,2780],[3360,3470]]),
      curve([[2030,700],[2150,1420],[1970,2140],[2160,2760],[2110,3390]]),
    );
    groves=[[600,1540,250,320],[1050,2530,270,330],[3200,1590,285,320],[3570,2520,245,290],[2030,410,300,245],[2000,3660,375,240]];
  }else{
    roadsCurves.push(
      curve([[688,3408],[1160,2980],[1440,2460],[2048,2048]]),
      curve([[3408,688],[2970,1160],[2560,1590],[2048,2048]]),
      curve([[688,688],[1240,1060],[1530,1610],[2048,2048]]),
      curve([[3408,3408],[2900,3030],[2650,2500],[2048,2048]]),
    );
    const loop=Array.from({length:65},(_,i)=>{
      const a=i/64*Math.PI*2,r=1240+85*Math.sin(a*3+.8)+45*Math.cos(a*5);
      return {x:CENTER+Math.cos(a)*r,y:CENTER+Math.sin(a)*r};
    });
    roadsCurves.push(loop);
    groves=[[1910,410,450,280],[2200,3660,480,280],[400,1920,300,440],[3710,2130,300,480],[1170,640,185,230],[3290,1430,210,265],[870,2610,180,220],[2740,3320,210,180]];
  }

  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const i=y*SIZE+x,p={x:(x+.5)*TILE,y:(y+.5)*TILE};
    if(x<2||y<2||x>=SIZE-2||y>=SIZE-2){land[i]=1;continue;}
    if(shorelines.some(({feature,points})=>insidePolygon({x:p.x-feature.x,y:p.y-feature.y},points))){
      land[i]=water[i]=1;continue;
    }
    const n=detail(p),broad=noise(p.x/680+21,p.y/680-9);
    const route=Math.min(...roadsCurves.map(path=>distanceToCurve(p,path)));
    const clearing=bases.some(b=>Math.hypot(p.x-b.x,p.y-b.y)<480)
      ||nodes.some(node=>Math.hypot(p.x-node.x,p.y-node.y)<112);
    const edge=Math.min(p.x,p.y,4096-p.x,4096-p.y);
    let obstacle=edge<182+broad*105+n*70;
    if(highland)obstacle ||= Math.min(...ridges.map(path=>distanceToCurve(p,path)))<160+n*105;
    else if(!wetland&&!authored){
      const a=Math.atan2(p.y-CENTER,p.x-CENTER),r=Math.hypot(p.x-CENTER,p.y-CENTER);
      obstacle ||= r>640+60*Math.sin(a*4+.7)+n*100&&r<975+70*Math.sin(a*3)+n*145;
    }
    const groveScale=wetland?.78:1;
    obstacle ||= groves.some(([cx,cy,rx,ry])=>((p.x-cx)/(rx*groveScale))**2+((p.y-cy)/(ry*groveScale))**2<1+n*.7);
    // 通路保护宽度独立于路面贴图；弯道附近不让噪声挤出单格窄口。
    land[i]=obstacle&&!clearing&&route>158?1:0;
    if(!land[i]){
      const width=80+noise(p.x/430-12,p.y/430+8)*27;
      const shoulder=Math.max(0,Math.min(1,(width+52+n*19-route)/55));
      // 路肩渐隐、路中央残留草斑；岩群脚下也有少量风化裸土。
      const trail=shoulder*(.83+noise(p.x/95,p.y/95)*.14);
      const weathered=highland?Math.max(0,n+.06)*.23:0;
      roads[i]=Math.round(Math.max(trail,weathered)*255);
    }
  }

  // 填掉噪声围出的微小孤岛，禁止出现可见空地却永远抵达不了的格子。
  const reached=new Uint8Array(land.length),queue=[Math.floor(bases[0].y/TILE)*SIZE+Math.floor(bases[0].x/TILE)];
  reached[queue[0]]=1;
  for(let k=0;k<queue.length;k++){
    const i=queue[k],x=i%SIZE,y=Math.floor(i/SIZE);
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
      const nx=x+dx,ny=y+dy,at=ny*SIZE+nx;
      if(nx<0||ny<0||nx>=SIZE||ny>=SIZE||land[at]||reached[at])continue;
      reached[at]=1;queue.push(at);
    }
  }
  const isolated=land.reduce((count,value,i)=>count+Number(!value&&!reached[i]),0);
  if(authored){
    // 海岸和溪湾外允许装饰小岛，但所有出生区、资源区必须接入主陆地。
    for(const p of [...bases,...nodes])if(!reached[Math.floor(p.y/TILE)*SIZE+Math.floor(p.x/TILE)])
      throw Error(`${id}: unreachable start or resource (${p.x}, ${p.y})`);
  }else if(isolated>64)throw Error(`${id}: disconnected terrain (${isolated} cells)`);
  for(let i=0;i<land.length;i++)if(!land[i]&&!reached[i]){land[i]=1;roads[i]=0;}

  const cellAt=(p:Point)=>Math.floor(p.y/TILE)*SIZE+Math.floor(p.x/TILE);
  for(let y=2;y<SIZE-2;y+=2)for(let x=2;x<SIZE-2;x+=2){
    // 抖动位置、尺寸和树种，消除棋盘排布；林缘用矮灌木与小树过渡。
    const p={x:(x+.5)*TILE+(random()-.5)*44,y:(y+.5)*TILE+(random()-.5)*44},i=cellAt(p);
    if(water[i])continue;
    const n=detail(p),k=random();
    if(land[i]){
      const enclosed=[-1,1,-SIZE,SIZE].filter(delta=>land[i+delta]).length;
      if(k>(enclosed<3?.83:.95))continue;
      const rock=highland?(noise(p.x/410,p.y/410+13)>.05||k<.48):k<.07;
      const kind:Feature['kind']=rock?(k<.26?'rock':'rockLarge'):enclosed<3&&k<.28?'bush'
        :wetland?(k<.24?'pine':k<.62?'oak':'birch'):(k<.58?'pine':k<.85?'oak':'birch');
      const cell=kind==='pine'?0:kind==='oak'?1:kind==='birch'?2:kind==='bush'?3:kind==='rock'?4:5;
      const size=rock?52+random()*91:(enclosed<3?64:83)+random()*58;
      features.push({...p,kind,cell,size,block:false});
    }else if(roads[i]<125&&k<.13+Math.max(0,n)*.3){
      const kind:Feature['kind']=k<.018?'stump':wetland&&k<.07?'fern':k<.035?'flower':'grass';
      features.push({...p,kind,cell:kind==='grass'?12:kind==='flower'?13:kind==='stump'?14:15,size:20+random()*25,block:false});
    }
  }
  // 湖岸点缀在阻挡岸带上，不侵入可行走的湖边通道。
  for(const {feature} of shorelines)for(let i=0;i<feature.outline!.length;i+=3){
    const edge=feature.outline![i],p={x:feature.x+edge.x*1.035,y:feature.y+edge.y*1.035};
    if(!land[cellAt(p)]||random()<.25)continue;
    const rock=random()<.4;
    features.push({...p,kind:rock?'rock':'bush',cell:rock?4:3,size:rock?24+random()*27:29+random()*24,block:false});
  }
  return {...layout,revision:authored?layout.revision:2,land,roads,features};
}
