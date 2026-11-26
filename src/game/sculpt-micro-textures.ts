/// <reference types="vite/client" />
import { RepeatWrapping, Texture, type MeshStandardMaterial, type TextureLoader } from 'three';
import { assetPath } from './assets.js';
import { runtimeImage,type RuntimeManifest } from './runtime-assets.js';
import type { ResourceLoad } from './resource-loading.js';

interface SculptMicroTextures {
  material:Texture;
  weather:Texture;
}

export interface SculptMicroDetail {
  textures:SculptMicroTextures;
  organic:boolean;
  humanoid?:boolean;
  wear:number;
}

let runtimeMicro:Promise<SculptMicroTextures|undefined>|undefined;
export function loadRuntimeMicroTextures(manifest:RuntimeManifest,load?:ResourceLoad){
  const names=['generated/micro/material-detail.png','generated/micro/weather-detail.png'];
  if(!names.every(name=>manifest.images[name]))return Promise.resolve(undefined);
  const requests=names.map(name=>runtimeImage(manifest.images[name],manifest,load));
  if(!runtimeMicro)runtimeMicro=Promise.all(requests).then(images=>{
    const textures=images.map(image=>{
      const texture=new Texture(image);texture.needsUpdate=true;
      texture.wrapS=texture.wrapT=RepeatWrapping;texture.anisotropy=4;return texture;
    });
    return {material:textures[0],weather:textures[1]};
  }).catch(error=>{runtimeMicro=undefined;console.warn('微表面纹理加载失败，保留烘焙材质。',error);return undefined;});
  return runtimeMicro;
}

export async function loadSculptMicroTextures(loader:TextureLoader):Promise<SculptMicroTextures|undefined> {
  if(typeof document==='undefined')return;
  const files=Object.keys(import.meta.glob('/public/assets/generated/micro/*-detail.png'));
  const names=['material-detail.png','weather-detail.png'];
  if(!names.every(name=>files.includes(`/public/assets/generated/micro/${name}`)))return;
  const results=await Promise.allSettled(names.map(name=>loader.loadAsync(assetPath(`generated/micro/${name}`))));
  const textures=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
  if(textures.length!==names.length){
    for(const texture of textures)texture.dispose();
    console.warn('无法加载微表面贴图，继续使用模型烘焙材质。');
    return;
  }
  for(const texture of textures){
    texture.wrapS=texture.wrapT=RepeatWrapping;
    texture.anisotropy=4;
  }
  return {material:textures[0],weather:textures[1]};
}

const restPoseVaryings=/* glsl */`
  varying vec3 vSculptRestPosition, vSculptRestNormal;
  varying float vSculptRestHeight;
`;

const fragmentDeclarations=/* glsl */`
  ${restPoseVaryings}
  uniform sampler2D sculptDetailMap, sculptWeatherMap;
  uniform float sculptWear;

  vec4 sampleSculptTriplanar(sampler2D map, vec3 p, vec3 weights){
    return texture2D(map,p.zy)*weights.x + texture2D(map,p.xz)*weights.y
      + texture2D(map,p.xy)*weights.z;
  }

  // Convert the filtered height field to a surface gradient in view space.
  vec3 sculptRelief(vec3 p, vec3 geometryNormal, vec3 shadedNormal, float height, float mask){
    vec3 dx=dFdx(p),dy=dFdy(p);
    vec3 tangentX=cross(dy,geometryNormal),tangentY=cross(geometryNormal,dx);
    float det=dot(dx,tangentX);
    vec3 slope=(tangentX*dFdx(height)+tangentY*dFdy(height))*sign(det)/max(abs(det),1e-6);
    slope*=min(1.0,.24/max(length(slope),1e-6));
    return mask>0.0?normalize(shadedNormal-slope*mask):shadedNormal;
  }
`;

function shadeMicroSurface(organic:boolean,humanoid:boolean){
  return /* glsl */`
    vec3 surfaceORM=texture2D(roughnessMap,vRoughnessMapUv).rgb;
    // Low-roughness glass and polished optics keep their original shading.
    float wearMask=smoothstep(.28,.40,surfaceORM.g);
    vec3 weights=pow(abs(normalize(vSculptRestNormal)),vec3(5.0));
    weights/=max(dot(weights,vec3(1.0)),1e-6);
    vec4 grain=sampleSculptTriplanar(sculptDetailMap,vSculptRestPosition*.16,weights);
    float bareMetal=smoothstep(.45,.75,surfaceORM.b);
    float matte=smoothstep(.65,.88,surfaceORM.g)*(1.0-bareMetal);
    // Scratches use a tighter pattern than the grime and aged runoff.
    vec3 stains=sampleSculptTriplanar(sculptWeatherMap,vSculptRestPosition*.031,weights).rgb;
    vec2 chipsAndWeave=sampleSculptTriplanar(sculptWeatherMap,vSculptRestPosition*.075+vec3(.17,.39,.61),weights).ba;
    float chipPattern=chipsAndWeave.x;
    float microHeight=${organic?'grain.a':'mix(mix(grain.r,grain.g,bareMetal),grain.b,matte)'}-.5;
    float fabric=0.0;
    ${humanoid?`
      // Rough, non-metallic uniform panels take the weave. Exposed skin has a lower baked roughness.
      float bakedValue=dot(sampledDiffuseColor.rgb,vec3(.2126,.7152,.0722));
      fabric=smoothstep(.64,.78,surfaceORM.g)*(1.0-smoothstep(.10,.23,surfaceORM.b))*smoothstep(.009,.024,bakedValue);
      wearMask*=max(fabric,smoothstep(.025,.13,surfaceORM.b));
      microHeight=mix(microHeight,(chipsAndWeave.y-.5)*1.8,fabric);
    `:''}
    float cavity=1.0-surfaceORM.r;
    float baseDirt=1.0-smoothstep(4.0,28.0,vSculptRestHeight);
    float exposedEdge=smoothstep(.10,.36,length(normal-nonPerturbedNormal));
    float dirt=stains.r*(.09+.40*cavity+.19*baseDirt)*sculptWear;
    float rustable=${organic?'0.0':humanoid?'smoothstep(.40,.68,surfaceORM.b)':'smoothstep(.05,.23,surfaceORM.b)*(1.0-.8*matte)'};
    float rust=min(.86,smoothstep(.04,.72,stains.g)*(.28+.43*cavity+.20*baseDirt+.11*exposedEdge)*rustable*sculptWear);
    float chips=chipPattern*(.08+.31*exposedEdge+.10*cavity)*(1.0-.75*max(fabric,matte))*sculptWear;
    float ink=smoothstep(.08,.26,chipPattern)*(1.0-smoothstep(.27,.63,chipPattern))
      *(.22+.31*exposedEdge+.11*cavity)*(1.0-.77*fabric)*sculptWear;
    float steelUndercoat=${organic?'0.0':'smoothstep(.04,.22,surfaceORM.b)*(1.0-smoothstep(.64,.83,surfaceORM.g))'};
    float exposedSteel=chips*steelUndercoat;
    float cleanMetal=${organic?'0.0':'bareMetal*(1.0-rust)*(1.0-dirt*.65)'};

    diffuseColor.rgb*=1.0+microHeight*(.19+.17*cleanMetal+.43*fabric)*wearMask;
    diffuseColor.rgb*=1.0-(dirt*.72+ink*.76)*wearMask;
    vec3 rustColor=mix(vec3(.12,.030,.012),vec3(.39,.123,.034),smoothstep(.22,.92,stains.g));
    diffuseColor.rgb=mix(diffuseColor.rgb,rustColor,rust*wearMask);
    vec3 chippedColor=mix(diffuseColor.rgb*.52,vec3(.31,.34,.38),steelUndercoat);
    diffuseColor.rgb=mix(diffuseColor.rgb,chippedColor,chips*wearMask);
    roughnessFactor=clamp(roughnessFactor+wearMask*(microHeight*(.20+.11*cleanMetal)+dirt*.23+rust*.43
      +chips*.14-exposedSteel*.23-cleanMetal*.13),0.0,1.0);
    metalnessFactor=mix(metalnessFactor,.96,(exposedSteel*.78+cleanMetal*.58)*wearMask);
    metalnessFactor*=1.0-wearMask*(rust*.88+dirt*.25);

    float reliefHeight=microHeight*(.18+.25*fabric)-chipPattern*.14*sculptWear*(1.0-fabric*.75)+rust*.15;
    normal=sculptRelief(-vViewPosition,nonPerturbedNormal,normal,reliefHeight,wearMask);
  `;
}

export function configureSculptMicroDetail(material:MeshStandardMaterial,detail:SculptMicroDetail){
  material.customProgramCacheKey=()=>`sculpt-micro-pbr-v2:${detail.organic?'organic':detail.humanoid?'humanoid':'mineral'}`;
  material.onBeforeCompile=shader=>{
    shader.uniforms.sculptDetailMap={value:detail.textures.material};
    shader.uniforms.sculptWeatherMap={value:detail.textures.weather};
    shader.uniforms.sculptWear={value:detail.wear};
    shader.vertexShader=`attribute float sculptHeightOffset;\n${restPoseVaryings}`+shader.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      // Use bind-pose coordinates so even skinned surfaces carry the same marks in motion.
      vSculptRestPosition=position;
      vSculptRestNormal=normal;
      vSculptRestHeight=position.y+sculptHeightOffset;
    `);
    shader.fragmentShader=fragmentDeclarations+shader.fragmentShader.replace('#include <normal_fragment_maps>',`
      #include <normal_fragment_maps>
      ${shadeMicroSurface(detail.organic,detail.humanoid??false)}
    `);
  };
}
