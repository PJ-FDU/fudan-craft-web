import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import sharp from 'sharp';
import { Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { extractPackedModel } from './packed-models.mjs';

const project=resolve(import.meta.dirname,'..');
const source=resolve(project,'public/assets/blender-sculpt-v2');
const output=resolve(project,'public/assets/runtime');
await mkdir(output,{recursive:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await readFile(resolve(source,'manifest.json'));
const manifest=JSON.parse(manifestBytes);
const scriptHash=digest(Buffer.concat([
  await readFile(import.meta.filename),await readFile(resolve(import.meta.dirname,'packed-models.mjs')),
]));
let previous;
try{previous=JSON.parse(await readFile(resolve(output,'manifest.json'),'utf8'));}catch{}
const sourceFiles=[...new Set([...manifest.packs,...manifest.textures])];
const inputs=new Map(await Promise.all(sourceFiles.map(async file=>[file,await readFile(resolve(source,file))])));
const sourceHash=digest(Buffer.concat([manifestBytes,Buffer.from(scriptHash),
  ...[...inputs].map(([file,bytes])=>Buffer.from(`${file}:${digest(bytes)}`))]));
// 源文件或导出规则变化才重新生成，避免每次 dev/build 重压缩数百张贴图。
if(previous?.sourceHash===sourceHash&&
  (await Promise.all(Object.entries(previous.sharedInputs??{}).map(async([file,hash])=>
    digest(await readFile(resolve(project,'public/assets',file)))===hash))).every(Boolean)&&
  (await Promise.all(Object.keys(previous.files).map(file=>stat(resolve(output,file)).catch(()=>null)))).every(Boolean)){
  console.log(`Runtime assets unchanged: ${Object.keys(previous.models).length} models`);
  process.exit(0);
}
const files={},models={},surfaces={},images={};
const publish=async(stem,extension,bytes)=>{
  const file=`${stem}-${digest(bytes).slice(0,16)}.${extension}`;
  await writeFile(resolve(output,file),bytes);
  files[file]=bytes.length;
  return file;
};
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const bounds=new Map();
for(const file of manifest.packs){
  const bytes=inputs.get(file);
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const keys=new Set();
  gltf.scene.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const key=object.userData.key;
    assert.equal(typeof key,'string');
    keys.add(key);
    // 用导出 GLB 的实际 UV 定位图块，而不是依赖未发布的烘焙中间文件。
    const uv=object.geometry.getAttribute('uv'),box=bounds.get(key)??[Infinity,Infinity,-Infinity,-Infinity];
    assert.ok(uv);
    for(let i=0;i<uv.count;i++){
      const u=uv.getX(i),v=1-uv.getY(i);
      assert.ok(Number.isFinite(u)&&Number.isFinite(v));
      box[0]=Math.min(box[0],u);box[1]=Math.min(box[1],v);
      box[2]=Math.max(box[2],u);box[3]=Math.max(box[3],v);
    }
    bounds.set(key,box);
    object.geometry.dispose();
    for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();
  });
  for(const key of keys){
    assert.ok(!models[key],`Duplicate model: ${key}`);
    models[key]=await publish(key.replaceAll(':','-'),'glb',extractPackedModel(bytes,key));
  }
}

function cropUV(box,width,height){
  for(const size of [256,512,1024,2048,4096]){
    if(width%size||height%size)continue;
    const x=Math.floor((box[0]*width+.01)/size)*size;
    const y=Math.floor((box[1]*height+.01)/size)*size;
    if(x>=0&&y>=0&&box[2]*width<=x+size+.1&&box[3]*height<=y+size+.1)
      return {left:x,top:height-y-size,width:size,height:size,uv:[width/size,height/size,-x/size,-y/size]};
  }
  throw Error(`Model UV does not fit an independent atlas tile: ${box}`);
}
async function surface(name,paths,box){
  const {width,height}=await sharp(inputs.get(paths.albedo)).metadata();
  const crop=box?cropUV(box,width,height):undefined;
  const result={};
  for(const channel of ['albedo','normal','orm']){
    const bytes=inputs.get(paths[channel]);
    const metadata=await sharp(bytes).metadata();
    assert.deepEqual([metadata.width,metadata.height],[width,height],`${name}/${channel} dimensions`);
    let image=sharp(bytes);
    if(crop)image=image.extract({left:crop.left,top:crop.top,width:crop.width,height:crop.height});
    // 保留图鉴的原始细节分辨率；战场看远景时按设备配置使用较小的派生纹理。
    const full=await image.clone().webp(channel==='albedo'?{quality:92,effort:5}:{lossless:true,effort:5}).toBuffer();
    result[channel]=await publish(`${name.replaceAll(':','-')}-${channel}`,'webp',full);
    if((crop?.width??width)>1024||(crop?.height??height)>1024){
      const compact=await image.clone().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true})
        .webp(channel==='albedo'?{quality:90,effort:5}:{lossless:true,effort:5}).toBuffer();
      result.compact??={};
      result.compact[channel]=await publish(`${name.replaceAll(':','-')}-${channel}-compact`,'webp',compact);
    }
  }
  if(crop)result.uv=crop.uv;
  return result;
}
for(const [key,template] of Object.entries(manifest.templates)){
  assert.ok(models[key],`Missing model: ${key}`);
  surfaces[key]=await surface(key,manifest.surfaces[template.surface],bounds.get(key));
}
const environment=await surface('environment',manifest.legacyTextures);
// 共享图集、动画和地表也经过统一入口，带内容指纹且不再请求旧的大型 PNG。
const generated=resolve(project,'public/assets/generated');
const shared=['battle-materials.webp','unit-materials.webp','faction-materials-v4.webp','faction-detail-v4.webp',
  'units-v2.png','buildings-v2.png','nature-v2.png','terrain-v2.png',
  ...['worker','soldier','scout','medic','sniper','tank','artillery','fighter','mech',
    'trees','building-construction','building-damage','building-production','ground-grass','ground-earth','effects']
    .map(name=>`animation-${name}-v4.png`),
  'micro/material-detail.png','micro/weather-detail.png',
  'surfaces/terrain-albedo.png','surfaces/terrain-detail.png','surfaces/battle-particles.png'];
for(const path of shared){
  const bytes=await readFile(resolve(generated,path)).catch(error=>{
    if(error.code==='ENOENT'&&(path.startsWith('micro/')||path.startsWith('surfaces/')))return null;
    throw error;
  });
  if(!bytes)continue;
  const lossless=path.includes('detail')||path.endsWith('-normal.png');
  const optimized=await sharp(bytes).webp(lossless?{lossless:true,effort:5}:{quality:92,effort:5}).toBuffer();
  images[`generated/${path}`]=await publish(basename(path).replace(/\.\w+$/,''),'webp',optimized);
  inputs.set(`generated/${path}`,bytes);
}
for(const name of ['grass','earth']){
  const bytes=inputs.get(`generated/animation-ground-${name}-v4.png`);
  images[`generated/minimap-${name}`]=await publish(`minimap-${name}`,'webp',
    await sharp(bytes).resize(256,256).webp({quality:90}).toBuffer());
}
// 包含共享图集指纹；它们变化时也必须失效缓存。
const sharedInputs=Object.fromEntries([...inputs].filter(([file])=>file.startsWith('generated/')).map(([file,bytes])=>[file,digest(bytes)]));
const runtime={version:1,sourceHash,sharedInputs,sourceManifest:manifest,models,surfaces,environment,images,files};
await writeFile(resolve(output,'manifest.json.tmp'),JSON.stringify(runtime));
await rename(resolve(output,'manifest.json.tmp'),resolve(output,'manifest.json'));
const sourceSize=sourceFiles.reduce((sum,file)=>sum+inputs.get(file).length,0);
console.log(JSON.stringify({models:Object.keys(models).length,sourceMiB:sourceSize/1048576,
  runtimeMiB:Object.values(files).reduce((sum,bytes)=>sum+bytes,0)/1048576},null,2));
