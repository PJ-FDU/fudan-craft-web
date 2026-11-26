import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TERRAIN_LAYERS } from '../src/game/terrain-surfaces.js';

const size=256;
const directory=resolve('public/assets/generated/surfaces');
const terrain=resolve('public/assets/generated/terrain-v2.png');
const sources=resolve('scripts/material-library/surfaces');
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const luminance=(r:number,g:number,b:number)=>(r*.2126+g*.7152+b*.0722)/255;

const terrainHeader=readFileSync(terrain);
const cellWidth=Math.floor(terrainHeader.readUInt32BE(16)/2);
const cellHeight=Math.floor(terrainHeader.readUInt32BE(20)/2);
const terrainCell=(column:number)=>{
  // Leave two source pixels around the crop to exclude the adjoining atlas tile.
  return `crop=${cellWidth-4}:${cellHeight-4}:${column*cellWidth+2}:2,`;
};

const inputs={
  grass:{path:terrain,crop:terrainCell(0),roughness:.92,relief:1.55},
  road:{path:terrain,crop:terrainCell(1),roughness:.87,relief:1.5},
  rock:{path:join(sources,'layered-rock.png'),crop:'',roughness:.79,relief:2.35},
  sand:{path:join(sources,'wet-sand.png'),crop:'',roughness:.77,relief:1.45},
  moss:{path:join(sources,'moss-lichen.png'),crop:'',roughness:.92,relief:1.65},
} as const;

function readLayer(path:string,crop:string){
  const pixels=execFileSync('ffmpeg',['-v','error','-i',path,'-frames:v','1','-filter_threads','1',
    '-vf',`${crop}scale=${size}:${size}:flags=area`,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  if(pixels.length!==size*size*3)throw Error(`无法读取完整纹理：${path}`);
  return new Float32Array(pixels);
}

function blendEdges(pixels:Float32Array){
  const border=10;
  const blend=(a:number,b:number,weight:number)=>{
    for(let channel=0;channel<3;channel++){
      const first=a*3+channel,last=b*3+channel;
      const change=(pixels[last]-pixels[first])*weight;
      pixels[first]+=change;pixels[last]-=change;
    }
  };
  for(let offset=0;offset<border;offset++){
    const weight=.25*(1+Math.cos(Math.PI*offset/border));
    for(let y=0;y<size;y++)blend(y*size+offset,y*size+size-1-offset,weight);
    for(let x=0;x<size;x++)blend(offset*size+x,(size-1-offset)*size+x,weight);
  }
}

const pixelsPerLayer=size*size;
const albedo=Buffer.alloc(pixelsPerLayer*TERRAIN_LAYERS.length*3);
const detail=Buffer.alloc(albedo.length);
for(const [layer,name] of TERRAIN_LAYERS.entries()){
  if(name==='water'){
    const ripple=readLayer(join(sources,'water-ripple-height.png'),'');
    const foam=readLayer(join(sources,'shore-foam.png'),'');
    blendEdges(ripple);blendEdges(foam);
    const sample=(x:number,y:number)=>{
      const at=((y+size)%size*size+(x+size)%size)*3;
      return luminance(ripple[at],ripple[at+1],ripple[at+2]);
    };
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const index=(y*size+x)*3,at=layer*pixelsPerLayer*3+index;
      detail[at]=Math.round(clamp(.5-(sample(x+1,y)-sample(x-1,y))*1.8)*255);
      detail[at+1]=Math.round(clamp(.5+(sample(x,y+1)-sample(x,y-1))*1.8)*255);
      detail[at+2]=Math.round(luminance(foam[index],foam[index+1],foam[index+2])*255);
    }
    continue;
  }
  const {path,crop,roughness,relief}=inputs[name];
  const pixels=readLayer(path,crop);
  blendEdges(pixels);
  const height=new Float32Array(pixelsPerLayer);
  for(let i=0;i<pixelsPerLayer;i++)height[i]=luminance(pixels[i*3],pixels[i*3+1],pixels[i*3+2]);
  const mean=height.reduce((sum,value)=>sum+value,0)/height.length;
  for(let i=0;i<pixelsPerLayer;i++){
    const index=i*3;
    const at=(layer*pixelsPerLayer+i)*3;
    const r=pixels[index],g=pixels[index+1],b=pixels[index+2];
    albedo[at]=Math.round(r);albedo[at+1]=Math.round(g);albedo[at+2]=Math.round(b);
    detail[at]=Math.round(clamp(.5+(height[i]-mean)*relief)*255);
    detail[at+1]=Math.round(clamp(roughness-(height[i]-mean)*.20)*255);
    detail[at+2]=name==='moss'?Math.round(clamp((Math.max(r,g,b)-Math.min(r,g,b)-10)/53)*255):0;
  }
}

mkdirSync(directory,{recursive:true});
const temp=mkdtempSync(join(directory,'.terrain-'));
try{
  const outputs=[
    {name:'terrain-albedo.png',pixels:albedo},
    {name:'terrain-detail.png',pixels:detail},
  ];
  for(const {name,pixels} of outputs){
    const packed=execFileSync('ffmpeg',['-v','error','-f','rawvideo','-pixel_format','rgb24','-video_size',
      `${size}x${size*TERRAIN_LAYERS.length}`,'-i','pipe:0','-frames:v','1','-threads','1','-c:v','png',
      '-f','image2pipe','pipe:1'],{input:pixels,maxBuffer:2*1024*1024});
    writeFileSync(join(temp,name),packed);
  }
  for(const {name} of outputs)renameSync(join(temp,name),join(directory,name));
}finally{
  rmSync(temp,{recursive:true,force:true});
}
console.log(`已生成地表颜色和高度、粗糙度、苔藓遮罩（${TERRAIN_LAYERS.length} 层，${size}×${size}）`);
