import { ATLAS_FRAMES } from './atlas-frames.js';

/** Draw a measured frame with a stable contact point; generated sheets have uneven gutters. */
export function drawAtlasSprite(c:CanvasRenderingContext2D,images:Map<string,HTMLImageElement>,name:string,cell:number,x:number,y:number,size:number){
  const img=images.get(name)!,meta=ATLAS_FRAMES[name],f=meta.frames[cell];
  const scale=size/(meta.width/meta.columns);
  c.drawImage(img,f[0],f[1],f[2],f[3],x-f[4]*scale,y-f[5]*scale,f[2]*scale,f[3]*scale);
}
