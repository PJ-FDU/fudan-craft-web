import { DataTexture, LinearFilter, LinearMipmapLinearFilter } from 'three';
import { ATLAS_COLUMNS, ATLAS_ROWS, atlasCell, SURFACE, type Surface } from './battle-materials.js';

let atlas:DataTexture|undefined;
/** 独立线性法线图集：不再把颜色贴图中的涂装、高光和阴影当成几何凹凸。 */
export function surfaceNormals(){
  if(atlas)return atlas;
  const cell=128,width=cell*ATLAS_COLUMNS,height=cell*ATLAS_ROWS,data=new Uint8Array(width*height*4);
  const cloth=new Set<Surface>(['cloth','undersuit','scoutCloth','expeditionCanvas']);
  const rough=new Set<Surface>(['concrete','stone','bark','earth','ore']);
  const smooth=new Set<Surface>(['glass','optic','water']);
  const noise=(x:number,y:number)=>Math.sin(x*127.1+y*311.7)*.5+Math.sin(x*269.5-y*183.3)*.25;
  for(const name of Object.keys(SURFACE)){
    const surface=name as Surface,{x:cx,y:cy}=atlasCell(surface);
    const relief=(x:number,y:number)=>{
      if(smooth.has(surface))return 0;
      const u=x/cell,v=y/cell;
      // 单元格边缘留平坦区，与颜色图集内缩 UV / mipmap 一致。
      const border=Math.min(1,Math.max(0,Math.min(x,y,cell-1-x,cell-1-y)-3)/5);
      let h=noise(x,y)*.08;
      if(cloth.has(surface))h+=Math.sin(x*Math.PI*.5)*Math.sin(y*Math.PI*.5)*.45;
      else if(rough.has(surface))h+=noise(x*.16,y*.16)*.4;
      else if(surface==='track'||surface==='tread'||surface==='fieldRubber')h+=Math.pow(Math.max(0,Math.cos((v+u*.25)*Math.PI*16)),6)*1.1;
      else if(surface==='grille'||surface==='exhaust')h-=Math.pow(Math.max(0,Math.cos(v*Math.PI*24)),8)*.8;
      // 微结构由材质语义生成，与生图中的颜色、高光和阴影独立。
      else if(surface==='chitin'){
        const band=v*5+Math.sin(u*Math.PI*6)*.13;
        h+=Math.pow(Math.max(0,Math.cos(band*Math.PI*2)),10)*.7+noise(x*.22,y*.22)*.18;
      }else if(surface==='membrane'){
        h+=Math.sin(x*.46+Math.sin(y*.1)*2)*.22+noise(x*.18,y*.18)*.1;
      }else if(surface==='nutrient'){
        h= Math.sin(u*Math.PI*7)*Math.sin(v*Math.PI*7)*.28+noise(x*.12,y*.12)*.08;
      }else if(surface==='horn'){
        h+=Math.sin(x*.5+Math.sin(y*.055))*.3;
      }else if(surface==='photonicGlass'){
        h=Math.sin((u+v*.65)*Math.PI*9)*.04;
      }else if(surface==='expeditionFrame'||surface==='serviceSteel'){
        h=noise(x*.08,y)*.12+Math.sin(y*1.8)*.09;
      }else if(surface==='astralAlloy'||surface==='circuitry'||surface==='conductor'){
        const trace=surface==='conductor'?Math.hypot(u-.2,v-.3)*6:(u+v*.5)*7;
        h-=Math.pow(Math.max(0,Math.cos(trace*Math.PI*2)),18)*.25;
      }
      else {
        h+=Math.sin(y*2.7)*.035;
        const edge=Math.min(Math.abs(u-.09),Math.abs(u-.91),Math.abs(v-.09),Math.abs(v-.91));
        h-=Math.exp(-edge*edge*18000)*.6;
      }
      return h*border;
    };
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
      const nx=(relief(x-1,y)-relief(x+1,y))*.8,ny=(relief(x,y-1)-relief(x,y+1))*.8;
      const length=Math.hypot(nx,ny,1),offset=((cy*cell+y)*width+cx*cell+x)*4;
      data[offset]=Math.round((nx/length*.5+.5)*255);
      data[offset+1]=Math.round((ny/length*.5+.5)*255);
      data[offset+2]=Math.round((1/length*.5+.5)*255);data[offset+3]=255;
    }
  }
  atlas=new DataTexture(data,width,height);
  atlas.magFilter=LinearFilter;atlas.minFilter=LinearMipmapLinearFilter;
  atlas.generateMipmaps=true;atlas.anisotropy=4;atlas.needsUpdate=true;
  return atlas;
}
