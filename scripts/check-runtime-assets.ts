import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile,stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { Mesh,Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BlenderAssets,restoreBlenderGeometry } from '../src/game/blender-assets.js';
import type { RuntimeManifest } from '../src/game/runtime-assets.js';
import { battleModelKeys } from '../src/game/model-resources.js';
import { RACES } from '../src/game/types.js';

const source=resolve('public/assets/blender-sculpt-v2'),root=resolve('public/assets/runtime');
const runtime=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8')) as RuntimeManifest;
const manifest=runtime.sourceManifest;
const surface=()=>({albedo:new Texture(),normal:new Texture(),orm:new Texture()});
const assets=new BlenderAssets({...manifest,templates:Object.fromEntries(Object.entries(manifest.templates)
  .map(([key,template])=>[key,{...template,surface:key}]))},surface(),
  new Map(Object.keys(runtime.surfaces).map(key=>[key,surface()])));
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const original=new Map<string,Mesh[]>();
const parse=async(path:string)=>{
  const bytes=await readFile(path);
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
};
for(const file of manifest.packs){
  const pack=await parse(resolve(source,file));
  pack.scene.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const key=object.userData.key,list=original.get(key)??[];
    restoreBlenderGeometry(object.geometry,key,manifest.templates[key]?.rig.length??0);
    list.push(object);original.set(key,list);
  });
}
let meshes=0;
for(const [key,file] of Object.entries(runtime.models)){
  const pack=await parse(resolve(root,file));
  const expected=original.get(key)!;
  let count=0;
  pack.scene.traverse(object=>{
    if(!(object instanceof Mesh))return;
    assert.equal(object.userData.key,key);
    const before=expected.find(item=>item.userData.part===object.userData.part&&item.userData.slot===object.userData.slot);
    assert.ok(before,key);
    restoreBlenderGeometry(object.geometry,key,manifest.templates[key]?.rig.length??0);
    for(const [name,attribute] of Object.entries(before.geometry.attributes)){
      const actual=object.geometry.getAttribute(name);
      assert.ok(actual,`${key}/${name}`);
      assert.deepEqual(actual.array,attribute.array,`${key}/${name}: export changed source geometry`);
    }
    assert.deepEqual(object.geometry.index?.array,before.geometry.index?.array,key);
    assets.add(key,object.userData.part,object.userData.slot,object.geometry);
    count++;meshes++;
  });
  assert.equal(count,expected.length,key);
}
assets.validate();
for(const key of battleModelKeys(RACES))assert.ok(runtime.models[key],`Technology tree model missing: ${key}`);
// 法线与 ORM 的高清版本逐像素验证无损，裁剪位置与实际 UV 变换一并核对。
for(const [key,surface] of Object.entries(runtime.surfaces)){
  const paths=manifest.surfaces![manifest.templates[key].surface!];
  for(const channel of ['normal','orm'] as const){
    const png=resolve(source,paths[channel]),metadata=await sharp(png).metadata();
    const [sx,sy,ox,oy]=surface.uv!;
    const width=Math.round(metadata.width!/sx),height=Math.round(metadata.height!/sy);
    const left=Math.round(-ox*width),bottom=Math.round(-oy*height),top=metadata.height!-bottom-height;
    const expected=await sharp(png).extract({left,top,width,height}).ensureAlpha().raw().toBuffer();
    const actual=await sharp(resolve(root,surface[channel])).ensureAlpha().raw().toBuffer();
    assert.ok(expected.equals(actual),`${key}/${channel}: data texture is not lossless`);
  }
  for(const file of Object.values(surface.compact??{})){
    const metadata=await sharp(resolve(root,file)).metadata();
    assert.ok(metadata.width!<=1024&&metadata.height!<=1024,file);
  }
}
for(const [file,size] of Object.entries(runtime.files)){
  const bytes=await readFile(resolve(root,file));
  assert.equal(bytes.length,size,file);
  assert.ok(file.includes(createHash('sha256').update(bytes).digest('hex').slice(0,16)),file);
}
const bytesFor=(keys:string[],compact:boolean,environment:boolean)=>{
  const files=new Set<string>();
  for(const key of keys){
    files.add(runtime.models[key]);
    const surface=runtime.surfaces[key];
    if(surface)for(const channel of ['albedo','normal','orm'] as const)
      files.add((compact&&surface.compact?surface.compact:surface)[channel]);
  }
  if(environment)for(const channel of ['albedo','normal','orm'] as const)
    files.add((compact&&runtime.environment.compact?runtime.environment.compact:runtime.environment)[channel]);
  for(const path of ['generated/battle-materials.webp','generated/unit-materials.webp',
    'generated/faction-materials-v4.webp','generated/faction-detail-v4.webp',
    'generated/micro/material-detail.png','generated/micro/weather-detail.png',
    ...(environment?['generated/minimap-grass','generated/minimap-earth',
      'generated/surfaces/terrain-albedo.png','generated/surfaces/terrain-detail.png','generated/surfaces/battle-particles.png']:[])])
    if(runtime.images[path])files.add(runtime.images[path]);
  return [...files].reduce((sum,file)=>sum+runtime.files[file],0)/1048576;
};
const nature=Object.keys(runtime.models).filter(key=>/^(nature|resource):/.test(key));
const sourceMiB=(await Promise.all([...new Set([...manifest.packs,...manifest.textures])].map(async file=>
  (await stat(resolve(source,file))).size))).reduce((a,b)=>a+b,0)/1048576;
console.log(JSON.stringify({models:Object.keys(runtime.models).length,meshes,sourceMiB,
  firstGalleryMiB:bytesFor(['industrial:worker'],false,false),
  defaultBattleMiB:bytesFor([...battleModelKeys(['industrial','brood']),...nature],true,true),
  fourRaceBattleMiB:bytesFor([...battleModelKeys(RACES),...nature],true,true)},null,2));
