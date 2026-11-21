import type { MapId } from './maps.js';
import type { Point,ResourceNode,Side } from './types.js';
import type { Feature,WorldData } from './world.js';
import { naturalWorld,type NaturalLayout } from './natural-world.js';
import { terrainCurve } from './terrain-shapes.js';

export type ClassicMapId='echo-isles'|'twisted-meadows'|'turtle-rock'|'terenas-stand';
export function isClassicMap(id:MapId):id is ClassicMapId{
  return ['echo-isles','twisted-meadows','turtle-rock','terenas-stand'].includes(id);
}
const path=(points:number[][])=>terrainCurve(points.map(([x,y])=>({x,y})));
const mirror=(points:Point[])=>points.map(p=>({x:4096-p.x,y:4096-p.y}));
const water=(x:number,y:number,rx:number,ry:number,phase=0,rotation=0):Feature=>{
  const outline=Array.from({length:96},(_,i)=>{
    const a=i/96*Math.PI*2,r=1+.075*Math.sin(a*3+phase)+.035*Math.cos(a*7-phase);
    const dx=Math.cos(a)*rx*r,dy=Math.sin(a)*ry*r;
    return {x:dx*Math.cos(rotation)-dy*Math.sin(rotation),y:dx*Math.sin(rotation)+dy*Math.cos(rotation)};
  });
  return {x,y,kind:'water',cell:7,size:Math.max(rx,ry)*2,block:true,waterRadii:{x:rx,y:ry},outline};
};

/** 河道是连续岸线，碰撞与渲染共用轮廓；不能用装饰水面覆盖可走的道路。 */
function river(points:number[][],halfWidth:number):Feature{
  const coarse=path(points),course=coarse.flatMap((p,i)=>i
    ?[{x:(coarse[i-1].x+p.x)/2,y:(coarse[i-1].y+p.y)/2},p]:[p]);
  const origin=course[Math.floor(course.length/2)];
  const banks=course.map((p,i)=>{
    const a=course[Math.max(0,i-1)],b=course[Math.min(course.length-1,i+1)];
    const length=Math.hypot(b.x-a.x,b.y-a.y),t=i/(course.length-1);
    const requested=halfWidth*(1+.1*Math.sin(t*12)+.04*Math.cos(t*25));
    const ax=p.x-a.x,ay=p.y-a.y,bx=b.x-p.x,by=b.y-p.y,cross=Math.abs(ax*by-ay*bx);
    const radius=cross>1e-6?Math.hypot(ax,ay)*Math.hypot(bx,by)*length/(2*cross):Infinity;
    // 内岸偏移必须小于转弯半径，防止急弯自交后把河湾内陆地三角化成水。
    const w=Math.min(requested,radius*.55);
    return {p,nx:-(b.y-a.y)/length*w,ny:(b.x-a.x)/length*w};
  });
  const cap=(bank:typeof banks[number],sign:number)=>Array.from({length:11},(_,i)=>{
    const a=(i+1)*Math.PI/12,c=Math.cos(a),s=Math.sin(a);
    return {x:bank.p.x+sign*(bank.nx*c+bank.ny*s)-origin.x,
      y:bank.p.y+sign*(-bank.nx*s+bank.ny*c)-origin.y};
  });
  const outline=[...banks.map(({p,nx,ny})=>({x:p.x+nx-origin.x,y:p.y+ny-origin.y})),
    ...cap(banks.at(-1)!,1),
    ...[...banks].reverse().map(({p,nx,ny})=>({x:p.x-nx-origin.x,y:p.y-ny-origin.y})),
    ...cap(banks[0],-1)];
  const rx=Math.max(...outline.map(p=>Math.abs(p.x))),ry=Math.max(...outline.map(p=>Math.abs(p.y)));
  return {...water(origin.x,origin.y,rx,ry),outline,river:true};
}

function classicLayout(id:ClassicMapId):{starts:number[][];resources:number[][];terrain:NaturalLayout}{
  if(id==='echo-isles'){
    return {
      starts:[[752,1008],[3344,1008]],
      resources:[[2048,1712],[800,2912],[3296,2912]],
      terrain:{
        seed:0xe12026,wetland:true,
        paths:[
          path([[752,1008],[1290,1110],[1560,750],[2070,670],[2650,820],[2860,1170],[3344,1008]]),
          path([[752,1008],[950,1600],[1440,2010],[2050,2090],[2660,1920],[3120,1590],[3344,1008]]),
          path([[480,2270],[1060,2310],[1450,2770],[1990,3020],[2660,2790],[3140,2300],[3610,2230]]),
          path([[2050,680],[1870,1190],[2048,1712],[2200,2230],[1990,3020],[2090,3460]]),
          path([[780,1700],[500,2040],[720,2650],[800,2912]]),
          path([[3316,1700],[3596,2040],[3376,2650],[3296,2912]]),
        ],
        groves:[[580,800,510,590],[3516,800,510,590],[2020,1440,610,620],
          [1090,2900,580,390],[3070,2890,580,390],[2090,2650,320,540],
          [1540,350,260,220],[2610,330,310,240],[1180,1850,250,230],[2880,1820,250,230]],
        waters:[water(-140,1900,440,1810,.2),water(4236,1900,440,1810,2.1),
          water(2048,4100,2130,500,1.2),water(2048,-210,2130,410,.7),
          water(330,3610,480,500,2.2),water(3766,3610,480,500,.4)],
      },
    };
  }
  if(id==='twisted-meadows'){
    const approach=path([[1008,880],[1150,1420],[900,1720],[1400,2000],[2048,2048]]);
    const upper=path([[1008,880],[1740,920],[2140,1380],[2850,1610],[3184,1216]]);
    const lower=path([[880,3088],[1170,2580],[1610,2870],[1950,3340],[2650,3110],[3088,3216]]);
    return {
      starts:[[1008,880],[3088,3216],[880,3088],[3216,1008]],
      resources:[[2048,2048],[1840,752],[2256,3344],[656,2064],[3440,2032]],
      terrain:{
        seed:0x7a2026,
        paths:[approach,mirror(approach),path([[880,3088],[1390,2780],[1630,2300],[2048,2048]]),
          path([[3216,1008],[2780,1310],[2490,1790],[2048,2048]]),upper,mirror(upper),lower,mirror(lower)],
        groves:[[1490,1420,460,390],[2660,1510,450,370],[1450,2610,430,400],[2650,2660,480,370],
          [2048,450,560,270],[2048,3646,560,270],[460,2048,250,570],[3646,2048,250,570],
          [2048,1900,250,230],[610,680,280,340],[3486,3416,280,340],[660,3480,330,290],[3436,616,330,290]],
        waters:[
          river([[1190,180],[940,430],[660,520],[490,940],[650,1440]],115),
          river([[2906,3916],[3156,3666],[3436,3576],[3606,3156],[3446,2656]],115),
          river([[180,2906],[430,3156],[520,3436],[940,3606],[1440,3446]],115),
          river([[3916,1190],[3666,940],[3576,660],[3156,490],[2656,650]],115),
          water(260,260,225,200),water(3836,3836,225,200,1),water(260,3836,225,200,2),water(3836,260,225,200,3),
        ],
      },
    };
  }
  if(id==='turtle-rock'){
    const outer=path([[624,1552],[670,2310],[1040,2940],[1720,3450],[2832,3344],[3480,2820],[3472,2544]]);
    const inner=path([[1264,752],[1880,970],[2570,980],[3090,1430],[3040,2040],[3472,2544]]);
    return {
      // 两组近点分列西北、东南；1v1 默认远点，四方仍有经典近点压力。
      starts:[[1264,752],[2832,3344],[624,1552],[3472,2544]],
      resources:[[2048,1344],[1408,2336],[2688,1760],[2048,2784]],
      terrain:{
        seed:0x7b2026,wetland:true,
        paths:[outer,mirror(outer),inner,mirror(inner),
          path([[624,1552],[1110,1720],[1480,1430],[2048,1344],[2688,1760],[2890,2300],[3472,2544]]),
          path([[1264,752],[1450,1250],[1160,1920],[1408,2336],[2048,2784],[2710,2750],[2832,3344]])],
        groves:[[2050,2048,650,700],[1430,650,600,360],[2666,3446,600,360],
          [540,1740,370,590],[3556,2356,370,590],[3080,1030,450,380],[1016,3066,450,380],
          [2390,520,420,280],[1706,3576,420,280],[560,2820,280,340],[3536,1276,280,340]],
        waters:[water(-120,2048,390,2300),water(4216,2048,390,2300,1),
          water(2048,-160,2350,370,2),water(2048,4256,2350,370,3),
          river([[100,530],[540,390],[790,300]],95),river([[3996,3566],[3556,3706],[3306,3796]],95),
          river([[3400,200],[3550,620],[3780,1220]],100),river([[696,3896],[546,3476],[316,2876]],100)],
      },
    };
  }
  return {
    starts:[[864,1120],[3232,2976]],
    resources:[[2048,2048],[1088,3040],[3008,1056]],
    terrain:{
      seed:0x752026,wetland:true,
      paths:[
        path([[864,1120],[1350,1390],[1290,2010],[2048,2048],[2720,2230],[2800,2720],[3232,2976]]),
        path([[864,1120],[1330,660],[2200,590],[2800,1050],[3210,1670],[3020,2180],[3232,2976]]),
        path([[864,1120],[1070,1900],[760,2640],[1088,3040],[1990,3490],[2780,3420],[3232,2976]]),
        path([[1088,3040],[1610,2790],[1770,2310],[2048,2048],[2440,1800],[2660,1400],[3008,1056]]),
      ],
      groves:[[580,1070,420,690],[3516,3026,420,690],[1530,520,430,340],[2566,3576,430,340],
        [2210,1120,320,470],[1886,2976,320,470],[370,2740,280,380],[3726,1356,280,380],
        [2870,1850,350,370],[1226,2246,350,370]],
      waters:[
        river([[1570,1760],[1640,1420],[2050,1550],[2500,1470],[2600,1110],[2410,890]],75),
        river([[2526,2336],[2456,2676],[2046,2546],[1596,2626],[1496,2986],[1686,3206]],75),
        river([[60,1720],[370,1880],[680,1920],[890,1820]],105),
        river([[4036,2376],[3726,2216],[3416,2176],[3206,2276]],105),
        water(3010,60,320,440,1,.25),water(1086,4036,320,440,2,.25),
      ],
    },
  };
}

export function makeClassicWorld(id:ClassicMapId,nodesFor:(world:WorldData)=>ResourceNode[]):WorldData{
  const {starts,resources,terrain}=classicLayout(id);
  const bases=starts.map(([x,y],i)=>({x,y,side:(i+1) as Side}));
  const towers=bases.flatMap(b=>{
    const length=Math.hypot(2048-b.x,2048-b.y),ix=(2048-b.x)/length,iy=(2048-b.y)/length;
    return [-1,1].map(sign=>({x:b.x+ix*180-iy*sign*310,y:b.y+iy*180+ix*sign*310,side:b.side}));
  });
  const layout:WorldData={id,revision:1,land:new Uint8Array(128*128),roads:new Uint8Array(128*128),
    features:[],bases,towers,resources:resources.map(([x,y])=>({x,y}))};
  return naturalWorld(layout,nodesFor(layout),terrain);
}
