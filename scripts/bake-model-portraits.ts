import { Box3, DirectionalLight, HemisphereLight, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { assetPath } from '../src/game/assets.js';
import { battleAtlas, factionDetailTexture, FACTION_ATLAS_FILE, FACTION_DETAIL_FILE } from '../src/game/battle-materials.js';
import { battleLighting } from '../src/game/battle-lighting.js';
import { BattleModels } from '../src/game/models-3d.js';
import { MODEL_PORTRAITS, PORTRAIT_COLUMNS, PORTRAIT_ROWS } from '../src/game/model-portraits.js';
import { poseRig } from '../src/game/unit-rig.js';
import type { MobileKind } from '../src/game/types.js';

const cellSize=160, renderSize=320, margin=12;

async function imageFor(file:string){
  const image=new Image();
  image.src=assetPath(file);
  await image.decode();
  return image;
}

function alphaBounds({data,width,height}:ImageData){
  let left=width,right=-1,top=height,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(data[(y*width+x)*4+3]<16)continue;
    left=Math.min(left,x);right=Math.max(right,x);
    top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  return {left,top,width:right-left+1,height:bottom-top+1};
}

/** Run from the Vite dev server in a WebGL2 browser. Returns the transparent atlas. */
export async function bakeModelPortraits():Promise<Blob>{
  const [terrain,units,factions,detail]=await Promise.all([
    'generated/battle-materials.webp','generated/unit-materials.webp',FACTION_ATLAS_FILE,FACTION_DETAIL_FILE,
  ].map(imageFor));
  const renderer=new WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(renderSize,renderSize,false);
  const scene=new Scene();
  const environment=battleLighting(renderer,scene);
  const anisotropy=renderer.capabilities.getMaxAnisotropy();
  const atlas=battleAtlas(terrain,units,factions,anisotropy);
  const models=new BattleModels(atlas,factionDetailTexture(detail,anisotropy));
  const key=new DirectionalLight(0xffe4c4,3.7),rim=new DirectionalLight(0xa3dcff,2.7);
  key.position.set(-65,130,145);
  rim.position.set(105,65,-80);
  scene.add(key,rim,new HemisphereLight(0xc6e6ff,0xa1886b,1.08));
  const camera=new OrthographicCamera(-1,1,1,-1,.1,1500);
  const direction=new Vector3(1.1,.92,1.7).normalize();
  const size=new Vector3(),center=new Vector3();
  const sheet=document.createElement('canvas'),frame=document.createElement('canvas');
  sheet.width=PORTRAIT_COLUMNS*cellSize;sheet.height=PORTRAIT_ROWS*cellSize;
  frame.width=frame.height=renderSize;
  const out=sheet.getContext('2d')!,scratch=frame.getContext('2d',{willReadFrequently:true})!;
  out.imageSmoothingQuality='high';
  try{
    for(const [index,{kind,race,packed}] of MODEL_PORTRAITS.entries()){
      const model=models.unit(kind,1,false,race,packed);
      try{
        if(model.rig)poseRig(model.rig,kind as MobileKind,{
          state:'idle',time:.72,id:1,weight:0,travel:0,aim:0,recoil:0,turn:0,animate:true,
        });
        scene.add(model.root);model.root.updateMatrixWorld(true);
        const bounds=new Box3().setFromObject(model.root,true);
        bounds.getSize(size);bounds.getCenter(center);
        const half=Math.max(8,size.length()*.57);
        Object.assign(camera,{left:-half,right:half,top:half,bottom:-half});
        camera.position.copy(center).addScaledVector(direction,250);
        camera.lookAt(center);camera.updateProjectionMatrix();
        renderer.render(scene,camera);
        scratch.clearRect(0,0,renderSize,renderSize);
        scratch.drawImage(renderer.domElement,0,0);
        const crop=alphaBounds(scratch.getImageData(0,0,renderSize,renderSize));
        if(crop.width<=0||crop.height<=0)throw new Error(`Empty portrait for ${race}/${kind}`);
        const scale=(cellSize-margin*2)/Math.max(crop.width,crop.height);
        const width=crop.width*scale,height=crop.height*scale;
        const x=index%PORTRAIT_COLUMNS*cellSize+(cellSize-width)/2;
        const y=Math.floor(index/PORTRAIT_COLUMNS)*cellSize+(cellSize-height)/2;
        out.drawImage(frame,crop.left,crop.top,crop.width,crop.height,x,y,width,height);
      }finally{
        model.root.removeFromParent();model.rig?.skeleton.dispose();
      }
    }
    return await new Promise((resolve,reject)=>sheet.toBlob(blob=>{
      if(blob?.type==='image/webp')resolve(blob);
      else reject(new Error('WebP portrait export is unavailable'));
    },'image/webp',.92));
  }finally{
    models.dispose();atlas.dispose();environment.dispose();renderer.dispose();renderer.forceContextLoss();
  }
}
