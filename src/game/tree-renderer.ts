import { ATLAS_FRAMES } from './atlas-frames.js';
import { drawAtlasSprite } from './atlas-sprite.js';
import { canopyBend,windDisplacement } from './tree-wind.js';

/** Bend one stable tree silhouette continuously, without swapping shapes or ghosted crossfades. */
export function drawTree(c:CanvasRenderingContext2D,images:Map<string,HTMLImageElement>,species:number,x:number,y:number,size:number,time:number|null){
  const cell=species*6;
  if(time===null){drawAtlasSprite(c,images,'trees',cell,x,y,size);return;}
  const meta=ATLAS_FRAMES.trees,[sx,sy,sw,sh,ax,ay]=meta.frames[cell],image=images.get('trees')!;
  const scale=size/(meta.width/meta.columns),wind=windDisplacement(time,x,y,size,species);
  c.save();c.translate(x,y);const base=c.getTransform();
  // Each strip is sheared between its exact end offsets, keeping adjoining branches connected.
  const bands=size*Math.hypot(base.a,base.b)<65?3:6;
  for(let band=0;band<=bands;band++){
    const top=band===bands?ay*.75:ay*.75*band/bands;
    const bottom=band===bands?sh:ay*.75*(band+1)/bands;
    if(bottom<=top)continue;
    const y0=(top-ay)*scale,y1=(bottom-ay)*scale;
    const dx0=canopyBend(1-top/ay,wind),dx1=canopyBend(1-bottom/ay,wind);
    const shear=(dx1-dx0)/(y1-y0),offset=dx0-shear*y0;
    c.setTransform(base.a,base.b,base.a*shear+base.c,base.b*shear+base.d,base.a*offset+base.e,base.b*offset+base.f);
    // Tiny source overlap prevents subpixel seams; it never reaches an adjacent atlas cell.
    const start=Math.max(0,top-.35),end=Math.min(sh,bottom+.35);
    c.drawImage(image,sx,sy+start,sw,end-start,-ax*scale,(start-ay)*scale,sw*scale,(end-start)*scale);
  }
  c.restore();
}
