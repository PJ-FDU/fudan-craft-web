import {
  Box3, BufferGeometry, Float32BufferAttribute, Mesh, SRGBColorSpace, Texture, Uint16BufferAttribute, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { ModelGeometry } from './models-3d.js';
import { type SculptMicroDetail } from './sculpt-micro-textures.js';
import { forgetResource,resourceBlob,type ResourceLoad } from './resource-loading.js';
import { runtimeManifest,runtimeImage,runtimeURL,type RuntimeManifest,type RuntimeSurface } from './runtime-assets.js';
import type { RigDefinition } from './unit-rig.js';

interface Template {
  bounds:[number[],number[]];
  rig:RigDefinition['joints'];
  moving:[number,number,number][];
  surface?:string;
}
export interface BlenderManifest {
  version:number;
  generator:string;
  scriptHash?:string;
  templates:Record<string,Template>;
  packs:string[];
  textures:string[];
  surfaces?:Record<string,Record<'albedo'|'normal'|'orm',string>>;
  /** 每个美术包独立追踪生成来源，单车精修不要求重烘焙整个阵容。 */
  generators?:Record<string,{script:string;scriptHash:string;bake:string;blend:string}>;
  legacyTextures?:Record<'albedo'|'normal'|'orm',string>;
  bakedWeather?:string[];
  /** The environment UVs address dedicated PBR tiles in legacyTextures. */
  natureAtlas?:boolean;
}
export interface BlenderSurface {
  albedo:Texture;
  normal:Texture;
  orm:Texture;
  micro?:SculptMicroDetail;
  tintLamps?:boolean;
}
const channels:Record<string,string>={
  color:'_color',surfaceFinish:'_surfacefinish',surfaceTexture:'_surfacetexture',
  surfaceWeathering:'_surfaceweathering',weatherCoord:'_weathercoord',weatherSpan:'_weatherspan',
  skinIndex:'_skinindex',skinWeight:'_skinweight',
};
const channelSizes:Record<string,number>={
  color:3,surfaceFinish:3,surfaceTexture:1,surfaceWeathering:4,weatherCoord:4,weatherSpan:2,
  skinIndex:4,skinWeight:4,
};
const uniformSurfaces=new Set(['rifleman','medic','sniper','commander','ranger','pathfinder','observer']);

/** 资产错误在加载阶段终止，避免对局中静默出现旧模型或失去骨骼。 */
export function restoreBlenderGeometry(geometry:BufferGeometry,key:string,joints:number){
  const position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  if(!position||!uv)throw Error(`Blender 模型缺少 position / uv：${key}`);
  for(const [name,source] of Object.entries(channels)){
    const attribute=geometry.getAttribute(source);
    if(!attribute)continue;
    if(attribute.count!==position.count||attribute.itemSize!==channelSizes[name])
      throw Error(`Blender 顶点属性格式错误：${key}/${name}`);
    geometry.setAttribute(name,name==='skinIndex'?new Uint16BufferAttribute(
      Array.from({length:attribute.count*4},(_,i)=>Math.round(attribute.getComponent(Math.floor(i/4),i%4))),4):attribute);
    geometry.deleteAttribute(source);
  }
  const skin=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight');
  if(joints&&(!skin||!weights))throw Error(`Blender 模型缺少骨骼权重：${key}`);
  for(let i=0;i<position.count;i++){
    if(![position.getX(i),position.getY(i),position.getZ(i),uv.getX(i),uv.getY(i)].every(Number.isFinite))
      throw Error(`Blender 模型包含非法顶点：${key}`);
    if(skin&&weights){
      let total=0;
      for(let c=0;c<4;c++){
        const weight=weights.getComponent(i,c);
        total+=weight;
        if(!Number.isFinite(weight)||weight<0||weight>1.001||skin.getComponent(i,c)<0||skin.getComponent(i,c)>=joints)
          throw Error(`Blender 模型骨骼不匹配：${key}`);
      }
      if(Math.abs(total-1)>.002)throw Error(`Blender 模型权重未归一化：${key}`);
    }
    // Blender glTF 导出会翻转 V；游戏已有的合批图集使用源 UV 约定。
    uv.setY(i,1-uv.getY(i));
  }
  if(geometry.getAttribute('color')){
    for(const name of ['surfaceFinish','surfaceTexture','surfaceWeathering','weatherCoord','weatherSpan'])
      if(!geometry.getAttribute(name))throw Error(`Blender 模型缺少 ${name}：${key}`);
  }
  for(const name of ['color','surfaceFinish','surfaceTexture','surfaceWeathering','weatherCoord','weatherSpan']){
    const attribute=geometry.getAttribute(name);
    if(!attribute)continue;
    for(let i=0;i<attribute.count;i++)for(let c=0;c<attribute.itemSize;c++)
      if(!Number.isFinite(attribute.getComponent(i,c)))throw Error(`Blender 材质属性包含非法值：${key}/${name}`);
  }
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

export class BlenderAssets {
  private geometries=new Map<string,Map<number,ModelGeometry['body']>>();
  constructor(readonly manifest:BlenderManifest,public surface:BlenderSurface|undefined,
    readonly sculptSurfaces:Map<string,BlenderSurface>=new Map()){}

  add(key:string,part:number,slot:number,geometry:BufferGeometry){
    if(slot<0||slot>2||!Number.isInteger(slot))throw Error(`Blender 材质槽错误：${key}`);
    const parts=this.geometries.get(key)??new Map<number,ModelGeometry['body']>();
    const slots=parts.get(part)??[undefined,undefined,undefined];
    if(slots[slot])throw Error(`Blender 模型重复：${key}/${part}/${slot}`);
    const template=this.manifest.templates[key];
    if(slot!==2&&template?.surface&&this.sculptSurfaces.get(template.surface)?.micro){
      const offset=template.moving[part]?.[1]??0;
      const heights=new Float32Array(geometry.getAttribute('position').count).fill(offset);
      geometry.setAttribute('sculptHeightOffset',new Float32BufferAttribute(heights,1));
    }
    slots[slot]=geometry;parts.set(part,slots);this.geometries.set(key,parts);
  }
  model(key:string,rig?:RigDefinition):ModelGeometry{
    const template=this.manifest.templates[key],parts=this.geometries.get(key);
    if(!template||!parts||JSON.stringify(template.rig)!==JSON.stringify(rig?.joints??[]))
      throw Error(`Blender 模型与源码骨骼不匹配：${key}，请重新构建资产`);
    const copy=(part:number):ModelGeometry['body']=>(parts.get(part)??[undefined,undefined,undefined]).map(g=>g?.clone()) as ModelGeometry['body'];
    return {
      bounds:new Box3(new Vector3().fromArray(template.bounds[0]),new Vector3().fromArray(template.bounds[1])),
      body:copy(-1),moving:template.moving.map((at,index)=>({at,parts:copy(index)})),
      surface:template.surface?this.sculptSurfaces.get(template.surface):undefined,
    };
  }
  nature(key:string){
    const geometry=this.geometries.get(key)?.get(-1)?.[0];
    if(!geometry)throw Error(`Blender 环境模型缺失：${key}`);
    return geometry.clone();
  }
  has(key:string){return this.geometries.has(key);}
  validate(keys:readonly string[]=Object.keys(this.manifest.templates),environment=true){
    for(const key of keys){
      const template=this.manifest.templates[key];
      if(!template){
        if(!this.geometries.has(key))throw Error(`Blender 模型缺失：${key}`);
        continue;
      }
      if(!Array.isArray(template.rig))throw Error(`Blender 骨骼定义缺失：${key}，请重新构建资产`);
      const parts=this.geometries.get(key);
      if(!parts?.get(-1)?.some(Boolean)||template.moving.some((_,i)=>!parts.get(i)?.some(Boolean)))
        throw Error(`Blender 模型不完整：${key}`);
      if(template.surface&&!this.sculptSurfaces.has(template.surface))
        throw Error(`Blender 专属纹理缺失：${key}/${template.surface}`);
    }
    if(!environment)return;
    for(const kind of ['pine','oak','birch','bush','stump','rock','rockLarge','ruin','grass','flower','fern'])
      if(!this.geometries.has(`nature:${kind}`))throw Error(`Blender 环境模型不完整：${kind}`);
    for(const kind of ['wood','gold','oil'])for(const state of ['',':empty'])
      if(!this.geometries.has(`resource:${kind}${state}`))throw Error(`Blender 资源模型不完整：${kind}${state}`);
  }
}

const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
type AssetQuality='full'|'compact';
const libraries=new Map<AssetQuality,BlenderAssets>();
const modelPromises=new Map<string,Promise<void>>();
const geometries=new Map<string,Promise<{part:number;slot:number;geometry:BufferGeometry}[]>>();
const surfaces=new Map<string,Promise<BlenderSurface>>();

function library(runtime:RuntimeManifest,quality:AssetQuality){
  let assets=libraries.get(quality);
  if(!assets){
    // 运行时图块按模型登记，骨骼、边界和活动部件仍取自原始清单。
    const manifest={...runtime.sourceManifest,templates:Object.fromEntries(
      Object.entries(runtime.sourceManifest.templates).map(([key,template])=>[key,{...template,surface:key}]))};
    assets=new BlenderAssets(manifest,undefined);
    libraries.set(quality,assets);
  }
  return assets;
}
async function loadSurface(name:string,paths:RuntimeSurface,runtime:RuntimeManifest,quality:AssetQuality,load?:ResourceLoad){
  const selected=quality==='compact'&&paths.compact?paths.compact:paths;
  // 即使复用已解码材质，也把本次所需文件登记到进度中。
  const requests=['albedo','normal','orm'].map(channel=>
    runtimeImage(selected[channel as 'albedo'|'normal'|'orm'],runtime,load));
  const key=`${quality}:${name}`;
  let pending=surfaces.get(key);
  if(!pending){
    pending=Promise.all(requests).then(images=>{
      const textures=images.map(image=>{
        const texture=new Texture(image);texture.needsUpdate=true;texture.anisotropy=4;
        if(paths.uv){texture.repeat.set(paths.uv[0],paths.uv[1]);texture.offset.set(paths.uv[2],paths.uv[3]);}
        return texture;
      });
      textures[0].colorSpace=SRGBColorSpace;
      return {albedo:textures[0],normal:textures[1],orm:textures[2]};
    }).catch(error=>{surfaces.delete(key);throw error;});
    surfaces.set(key,pending);
  }
  return pending;
}

export interface BlenderLoadOptions {keys?:readonly string[];environment?:boolean;quality?:AssetQuality;load?:ResourceLoad}
export async function loadBlenderAssets(options:BlenderLoadOptions={}):Promise<BlenderAssets>{
  const {load,environment=true,quality='full'}=options,runtime=await runtimeManifest(load);
  const assets=library(runtime,quality);
  const keys=options.keys??Object.keys(runtime.models);
  const needed=[...new Set([...keys,...(environment?Object.keys(runtime.models).filter(key=>
    key.startsWith('nature:')||key.startsWith('resource:')):[])])];
  load?.phase('下载模型与材质');
  const environmentPromise=environment?loadSurface('environment',runtime.environment,runtime,quality,load)
    .then(surface=>{assets.surface=surface;}):Promise.resolve();
  const microPromise=import('./sculpt-micro-textures.js').then(module=>module.loadRuntimeMicroTextures(runtime,load));
  await Promise.all([environmentPromise,...needed.map(async key=>{
    const file=runtime.models[key];
    if(!file)throw Error(`运行时模型缺失：${key}`);
    const bytes=resourceBlob(runtimeURL(file),load,runtime.files[file]);
    const material=runtime.surfaces[key]?loadSurface(key,runtime.surfaces[key],runtime,quality,load):undefined;
    const id=`${quality}:${key}`;
    let pending=modelPromises.get(id);
    if(!pending){
      pending=(async()=>{
        const [blob,surface,microTextures]=await Promise.all([bytes,material,microPromise]);
        if(surface){
          const name=runtime.sourceManifest.templates[key].surface!;
          surface.tintLamps=['industrial','stellar','relay'].includes(name);
          if(microTextures)surface.micro={textures:microTextures,organic:name==='brood',
            wear:name==='worker'||runtime.sourceManifest.bakedWeather?.includes(name)?0:
              name==='brood'||surface.tintLamps||name==='mech'?1:.65,humanoid:uniformSurfaces.has(name)};
          assets.sculptSurfaces.set(key,surface);
        }
        let geometry=geometries.get(file);
        if(!geometry){
          geometry=(async()=>{
            const pack=await loader.parseAsync(await blob.arrayBuffer(),'');
            const meshes:Mesh[]=[];
            pack.scene.traverse(object=>{if(object instanceof Mesh)meshes.push(object);});
            try{
              for(const object of meshes){
                const {key:actual,part,slot}=object.userData;
                if(actual!==key||!Number.isInteger(part)||!Number.isInteger(slot)||slot<0||slot>2)
                  throw Error(`Blender 网格元数据错误：${key}`);
                restoreBlenderGeometry(object.geometry,key,assets.manifest.templates[key]?.rig?.length??0);
              }
              const staging=new BlenderAssets(assets.manifest,assets.surface,assets.sculptSurfaces);
              for(const object of meshes)staging.add(key,object.userData.part,object.userData.slot,object.geometry);
              staging.validate([key],false);
              return meshes.map(object=>({part:object.userData.part,slot:object.userData.slot,geometry:object.geometry}));
            }catch(error){for(const object of meshes)object.geometry.dispose();throw error;}
            finally{for(const object of meshes)for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}
          })().catch(error=>{geometries.delete(file);forgetResource(runtimeURL(file));throw error;});
          geometries.set(file,geometry);
        }
        // 战场和图鉴复用同一份已验证几何，只区分贴图分辨率；提交不会留下半包。
        for(const part of await geometry)assets.add(key,part.part,part.slot,part.geometry);
      })().catch(error=>{modelPromises.delete(id);throw error;});
      modelPromises.set(id,pending);
    }
    await pending;
  })]);
  assets.validate(needed,environment);
  return assets;
}
