import {
  Box3, BufferGeometry, Mesh, SRGBColorSpace, TextureLoader, Uint16BufferAttribute, Vector3, type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetPath } from './assets.js';
import type { ModelGeometry } from './models-3d.js';
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
}
export interface BlenderSurface {
  albedo:Texture;
  normal:Texture;
  orm:Texture;
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
  constructor(readonly manifest:BlenderManifest,readonly surface:BlenderSurface,
    readonly sculptSurfaces:ReadonlyMap<string,BlenderSurface>=new Map()){}

  add(key:string,part:number,slot:number,geometry:BufferGeometry){
    if(slot<0||slot>2||!Number.isInteger(slot))throw Error(`Blender 材质槽错误：${key}`);
    const parts=this.geometries.get(key)??new Map<number,ModelGeometry['body']>();
    const slots=parts.get(part)??[undefined,undefined,undefined];
    if(slots[slot])throw Error(`Blender 模型重复：${key}/${part}/${slot}`);
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
  validate(){
    for(const [key,template] of Object.entries(this.manifest.templates)){
      if(!Array.isArray(template.rig))throw Error(`Blender 骨骼定义缺失：${key}，请重新构建资产`);
      const parts=this.geometries.get(key);
      if(!parts?.get(-1)?.some(Boolean)||template.moving.some((_,i)=>!parts.get(i)?.some(Boolean)))
        throw Error(`Blender 模型不完整：${key}`);
      if(template.surface&&!this.sculptSurfaces.has(template.surface))
        throw Error(`Blender 专属纹理缺失：${key}/${template.surface}`);
    }
    for(const kind of ['pine','oak','birch','bush','stump','rock','rockLarge','ruin','grass','flower','fern'])
      if(!this.geometries.has(`nature:${kind}`))throw Error(`Blender 环境模型不完整：${kind}`);
  }
}

export async function loadBlenderAssets():Promise<BlenderAssets>{
  const root=assetPath('blender-sculpt-v2/');
  const response=await fetch(root+'manifest.json');
  if(!response.ok)throw Error(`无法加载 Blender 资产清单 (${response.status})`);
  const manifest=await response.json() as BlenderManifest;
  if(manifest.version!==2||!manifest.templates||!manifest.surfaces||!manifest.legacyTextures||
    !Array.isArray(manifest.packs))throw Error('Blender 资产清单版本不受支持');
  const textureLoader=new TextureLoader(),loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loadSurface=async(paths:Record<'albedo'|'normal'|'orm',string>):Promise<BlenderSurface>=>{
    const [albedo,normal,orm]=await Promise.all(
      [paths.albedo,paths.normal,paths.orm].map(path=>textureLoader.loadAsync(root+path)));
    albedo.colorSpace=SRGBColorSpace;
    for(const texture of [albedo,normal,orm])texture.anisotropy=4;
    return {albedo,normal,orm};
  };
  const [surface,sculpt,packs]=await Promise.all([
    loadSurface(manifest.legacyTextures),
    Promise.all(Object.entries(manifest.surfaces).map(async([name,paths])=>[name,await loadSurface(paths)] as const)),
    Promise.all(manifest.packs.map(path=>loader.loadAsync(root+path))),
  ]);
  const assets=new BlenderAssets(manifest,surface,new Map(sculpt));
  for(const pack of packs)if('scene' in pack)pack.scene.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const {key,part,slot}=object.userData;
    if(typeof key!=='string'||!Number.isInteger(part)||!Number.isInteger(slot))throw Error('Blender 网格缺少模型元数据');
    assets.add(key,part,slot,restoreBlenderGeometry(object.geometry,key,manifest.templates[key]?.rig?.length??0));
    for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();
  });
  assets.validate();
  return assets;
}
