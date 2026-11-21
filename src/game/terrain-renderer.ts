import { getWorld,type WorldData } from './world.js';
import { drawCell } from './art.js';
import { TILE,gridSize } from './pathfinding.js';
import { ByteLRU,TERRAIN_BUDGET,TERRAIN_CHUNK,fitTerrainLOD } from './terrain-detail.js';
import { traceWater } from './terrain-shapes.js';

export class DetailedTerrain {
  private cache=new ByteLRU<HTMLCanvasElement>(TERRAIN_BUDGET);
  private dirtMask=document.createElement('canvas');
  private fallback=document.createElement('canvas');
  private readonly size:number;
  private readonly extent:number;
  private grass:CanvasPattern;private earth:CanvasPattern;
  constructor(private images:Map<string,HTMLImageElement>,private world:WorldData=getWorld()){
    this.size=gridSize(world.land);this.extent=this.size*TILE;
    const probe=document.createElement('canvas').getContext('2d')!;
    this.grass=probe.createPattern(images.get('ground-grass')!,'repeat')!;
    this.earth=probe.createPattern(images.get('ground-earth')!,'repeat')!;
    // Keep four source texels per world pixel, including when zooming in.
    this.grass.setTransform(new DOMMatrix().scale(.25));this.earth.setTransform(new DOMMatrix().scale(.25));
    this.dirtMask.width=this.size;this.dirtMask.height=this.size;const c=this.dirtMask.getContext('2d')!,p=c.createImageData(this.size,this.size);
    for(let i=0;i<world.roads.length;i++)if(world.roads[i]){p.data[i*4]=255;p.data[i*4+1]=255;p.data[i*4+2]=255;p.data[i*4+3]=world.roads[i];}
    c.putImageData(p,0,0);
    this.fallback.width=this.fallback.height=512;this.overview(this.fallback);
  }
  private chunk(cx:number,cy:number,lod:number,build=true):HTMLCanvasElement|undefined{
    const key=`${cx}:${cy}:${lod}`,cached=this.cache.get(key);if(cached)return cached;
    if(!build)return;
    const size=TERRAIN_CHUNK+2,x=cx*TERRAIN_CHUNK-1,y=cy*TERRAIN_CHUNK-1,out=document.createElement('canvas');out.width=out.height=size*lod;
    const c=out.getContext('2d')!;c.scale(lod,lod);c.translate(-x,-y);c.fillStyle=this.grass;c.fillRect(x,y,size,size);
    const dirt=document.createElement('canvas');dirt.width=dirt.height=out.width;const d=dirt.getContext('2d')!;
    d.scale(lod,lod);d.translate(-x,-y);d.fillStyle=this.earth;d.fillRect(x,y,size,size);d.globalCompositeOperation='destination-in';
    d.drawImage(this.dirtMask,0,0,this.extent,this.extent);c.globalAlpha=.9;c.drawImage(dirt,x,y,size,size);c.globalAlpha=1;
    const nature=this.images.get('nature')!;
    for(const f of this.world.features)if(['water','grass','flower','stump','fern'].includes(f.kind)&&Math.abs(f.x-x-size/2)<size/2+f.size&&Math.abs(f.y-y-size/2)<size/2+f.size){
      if(f.waterRadii){
        c.fillStyle='#76785b';traceWater(c,f,f.outline?1.045:1.08);c.fill();
        const depth=c.createRadialGradient(f.x,f.y,30,f.x,f.y,Math.max(f.waterRadii.x,f.waterRadii.y));
        depth.addColorStop(0,'#325b64');depth.addColorStop(1,'#709c91');
        c.fillStyle=depth;traceWater(c,f);c.fill();continue;
      }
      if(f.kind==='water'){c.fillStyle='#ad9e714d';c.beginPath();c.ellipse(f.x,f.y,f.size*.6,f.size*.32,0,0,Math.PI*2);c.fill();}
      drawCell(c,nature,4,4,f.cell,f.x-f.size/2,f.y-f.size/2,f.size);
    }
    this.cache.set(key,out,out.width*out.height*4);return out;
  }
  draw(c:CanvasRenderingContext2D,rect:{x:number;y:number;w:number;h:number},zoom:number,dpr:number){
    const size=TERRAIN_CHUNK,x0=Math.max(0,Math.floor(rect.x/size)),y0=Math.max(0,Math.floor(rect.y/size));
    const x1=Math.min(this.extent/size,Math.ceil((rect.x+rect.w)/size)),y1=Math.min(this.extent/size,Math.ceil((rect.y+rect.h)/size));
    const lod=fitTerrainLOD(zoom,dpr,(x1-x0)*(y1-y0)),missing:{x:number;y:number}[]=[];
    c.drawImage(this.fallback,0,0,this.extent,this.extent);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      let tile=this.chunk(x,y,lod,false);
      if(!tile){missing.push({x,y});for(const other of [1,2,4])if(other!==lod){tile=this.chunk(x,y,other,false);if(tile)break;}}
      if(tile)c.drawImage(tile,x*size-1,y*size-1,size+2,size+2);
    }
    // Generate detail incrementally; crossing a zoom threshold must not block input/animation.
    const center={x:(x0+x1)/2,y:(y0+y1)/2},start=performance.now();
    missing.sort((a,b)=>(a.x-center.x)**2+(a.y-center.y)**2-(b.x-center.x)**2-(b.y-center.y)**2);
    for(const {x,y} of missing.slice(0,4)){
      const tile=this.chunk(x,y,lod)!;c.drawImage(tile,x*size-1,y*size-1,size+2,size+2);
      if(performance.now()-start>5)break;
    }
  }
  overview(canvas:HTMLCanvasElement,land=this.world.land){
    const c=canvas.getContext('2d')!;c.save();c.scale(canvas.width/this.extent,canvas.height/this.extent);c.fillStyle=this.grass;c.fillRect(0,0,this.extent,this.extent);
    const tint=document.createElement('canvas');tint.width=tint.height=this.size;const d=tint.getContext('2d')!;d.fillStyle='#a09061';d.fillRect(0,0,this.size,this.size);d.globalCompositeOperation='destination-in';d.drawImage(this.dirtMask,0,0);c.drawImage(tint,0,0,this.extent,this.extent);
    // 小地图直接呈现碰撞掩码，岩脊和大湖同样可见。
    c.fillStyle=this.world.id==='shattered-highlands'?'#5b6055':'#163c29';
    for(let i=0;i<land.length;i++)if(land[i])c.fillRect(i%this.size*TILE,Math.floor(i/this.size)*TILE,TILE,TILE);
    for(const f of this.world.features)if(f.kind==='water'){
      c.fillStyle='#58878a';traceWater(c,f);c.fill();
    }
    c.restore();
  }
}
