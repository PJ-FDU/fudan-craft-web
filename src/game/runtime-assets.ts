import { assetPath } from './assets.js';
import { forgetResource,resourceBlob,resourceImage,type ResourceLoad } from './resource-loading.js';
import type { BlenderManifest } from './blender-assets.js';

export interface RuntimeSurface {
  albedo:string;normal:string;orm:string;
  compact?:Record<'albedo'|'normal'|'orm',string>;
  uv?:[number,number,number,number];
}
export interface RuntimeManifest {
  version:1;
  sourceManifest:BlenderManifest;
  models:Record<string,string>;
  surfaces:Record<string,RuntimeSurface>;
  environment:RuntimeSurface;
  images:Record<string,string>;
  files:Record<string,number>;
}
const root=assetPath('runtime/');
let manifestPromise:Promise<RuntimeManifest>|undefined;
export function runtimeManifest(load?:ResourceLoad){
  const bytes=resourceBlob(root+'manifest.json',load);
  if(!manifestPromise)manifestPromise=bytes.then(async blob=>{
    const manifest=JSON.parse(await blob.text()) as RuntimeManifest;
    if(manifest.version!==1||!manifest.models||!manifest.files||!manifest.sourceManifest?.templates)
      throw Error('运行时资源清单不受支持，请重新构建资源');
    return manifest;
  }).catch(error=>{manifestPromise=undefined;forgetResource(root+'manifest.json');throw error;});
  return manifestPromise;
}
export const runtimeURL=(file:string)=>root+file;
export function runtimeImage(file:string,manifest:RuntimeManifest,load?:ResourceLoad){
  return resourceImage(root+file,load,manifest.files[file]);
}
export async function generatedImage(path:string,load?:ResourceLoad){
  const manifest=await runtimeManifest(load),file=manifest.images[path];
  if(!file)throw Error(`运行时图集缺失：${path}`);
  return runtimeImage(file,manifest,load);
}
