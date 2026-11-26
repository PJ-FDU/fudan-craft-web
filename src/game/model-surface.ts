import { MeshStandardMaterial, ShaderChunk, Vector2, type Texture } from 'three';
import { ATLAS_COLUMNS, atlasCell, type Surface } from './battle-materials.js';
import { surfaceNormals } from './surface-normals.js';
import type { BlenderAssets, BlenderSurface } from './blender-assets.js';
import { configureSculptMicroDetail } from './sculpt-micro-textures.js';
import {
  weatherColor, weatherFragmentDeclarations, weatherMetalness, weatherRelief, weatherRoughness,
  weatherVertex, weatherVertexDeclarations,
} from './model-weathering.js';

type Finish = readonly [roughness:number,metalness:number,relief:number];
const coated:Finish=[.48,.32,.35],metal:Finish=[.3,.78,.2];
const fabric:Finish=[.94,0,.65],rubber:Finish=[.86,.02,.8],glass:Finish=[.16,.42,.03];
const finishes:Partial<Record<Surface,Finish>>={
  armor:coated,helmet:coated,chest:coated,guard:coated,deck:coated,
  wing:[.36,.48,.22],mechPlate:coated,medicPanel:coated,insignia:coated,hazard:coated,
  roof:metal,piston:[.24,.85,.12],weapon:[.4,.66,.3],exhaust:[.55,.7,.6],
  grille:[.64,.6,.8],wall:[.64,.2,.6],
  glass,optic:glass,water:[.22,.2,.05],
  tread:rubber,track:rubber,cloth:fabric,undersuit:fabric,scoutCloth:fabric,
  ore:[.4,.65,.5],
  chitin:[.5,.02,.5],membrane:[.83,0,.42],nutrient:[.3,0,.18],horn:[.67,0,.32],
  ceramic:[.39,.25,.44],stellarConductor:[.36,.63,.33],astralAlloy:[.4,.54,.39],conductor:[.29,.64,.4],
  expeditionPlate:[.53,.23,.51],expeditionFrame:[.36,.65,.4],expeditionCanvas:fabric,fieldRubber:rubber,
  federalPlate:[.45,.31,.5],circuitry:[.41,.52,.43],medicalComposite:[.34,.08,.32],serviceSteel:[.29,.73,.38],
  chitinLamella:[.43,.02,.56],photonicGlass:[.19,.18,.23],expeditionLaminate:[.56,.13,.51],armorCeramic:[.36,.13,.44],
  titanArmor:[.46,.23,.52],titanSteel:[.37,.66,.42],titanSeal:[.77,.02,.48],titanTrim:[.48,.36,.4],
};
const matte:Finish=[.95,0,.8];
export const surfaceFinish=(surface:Surface):Finish=>finishes[surface]??matte;

/** 独立 UV 烘焙材质直接读美术颜色，避免旧图集与顶点染色重复覆盖。 */
export function sculptSurface(surface:BlenderSurface){
  const material=new MeshStandardMaterial({
    map:surface.albedo,normalMap:surface.normal,normalScale:new Vector2(1,1),
    roughnessMap:surface.orm,metalnessMap:surface.orm,aoMap:surface.orm,
    roughness:1,metalness:1,aoMapIntensity:1,envMapIntensity:.8,
  });
  if(surface.micro)configureSculptMicroDetail(material,surface.micro);
  return material;
}

export function natureSurface(atlas:Texture,assets:BlenderAssets|undefined,weathered=false){
  if(!assets?.manifest.natureAtlas||!assets.surface)return modelSurface(atlas,undefined,weathered,assets?.surface);
  const material=sculptSurface(assets.surface);
  material.vertexColors=true;
  return material;
}

const factionStart=atlasCell('chitin').x;
const factionUV=Number(factionStart/ATLAS_COLUMNS).toFixed(6);

export function modelSurface(atlas:Texture,factionDetail?:Texture,weathered=true,blender?:BlenderSurface){
  if(blender)factionDetail=undefined;
  const material=new MeshStandardMaterial({
    map:atlas,normalMap:blender?.normal??surfaceNormals(),normalScale:new Vector2(blender?1:.7,blender?1:.7),
    vertexColors:true,roughness:1,metalness:1,envMapIntensity:.8,
  });
  material.customProgramCacheKey=()=>`battle-pbr-v7${blender?'-blender':''}${factionDetail?'-detail':''}${weathered?'-weathered':''}`;
  material.onBeforeCompile=shader=>{
    if(factionDetail)shader.uniforms.factionDetail={value:factionDetail};
    if(blender){shader.uniforms.blenderAlbedo={value:blender.albedo};shader.uniforms.blenderORM={value:blender.orm};}
    shader.vertexShader=`${weathered?weatherVertexDeclarations:''}
      attribute vec3 surfaceFinish;
      varying vec3 vSurfaceFinish;
      attribute float surfaceTexture;
      varying float vSurfaceTexture;
    `+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vSurfaceFinish=surfaceFinish;
      vSurfaceTexture=surfaceTexture;
      ${weathered?weatherVertex:''}
    `);
    shader.fragmentShader=`${weathered?weatherFragmentDeclarations:''}
      varying vec3 vSurfaceFinish;
      varying float vSurfaceTexture;
      ${factionDetail?'uniform sampler2D factionDetail;':''}
      ${blender?'uniform sampler2D blenderAlbedo,blenderORM;':''}
    `+shader.fragmentShader
      .replace('#include <map_fragment>',ShaderChunk.map_fragment.replace(
        'diffuseColor *= sampledDiffuseColor;',
        `diffuseColor *= mix(vec4(1.0),sampledDiffuseColor,vSurfaceTexture);
        ${blender?'diffuseColor.rgb *= mix(vec3(1.0),texture2D(blenderAlbedo,vMapUv).rgb*1.85,.34*vSurfaceTexture);':''}`))
      .replace('#include <color_fragment>','#include <color_fragment>'+(weathered?weatherColor:''))
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        float wear=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
        roughnessFactor=clamp(vSurfaceFinish.x+(wear-.35)*.12,.12,1.0);
        ${blender?'roughnessFactor=mix(roughnessFactor,texture2D(blenderORM,vMapUv).g,.42);':''}
        ${factionDetail?`
        bool useFactionDetail=vMapUv.x>${factionUV};
        vec3 surfaceDetail=vec3(.5);
        if(useFactionDetail){
          vec2 detailUv=vec2((vMapUv.x*${ATLAS_COLUMNS}.0-${factionStart}.0)/${ATLAS_COLUMNS-factionStart}.0,vMapUv.y);
          surfaceDetail=texture2D(factionDetail,detailUv).rgb;
          roughnessFactor=clamp(vSurfaceFinish.x+(surfaceDetail.b-.5)*.5,.12,1.0);
        }`:''}
        ${weathered?weatherRoughness:''}
      `)
      .replace('#include <metalnessmap_fragment>',`#include <metalnessmap_fragment>
        metalnessFactor=vSurfaceFinish.y;
        ${weathered?weatherMetalness:''}
      `)
      .replace('#include <normal_fragment_maps>',
        ShaderChunk.normal_fragment_maps
          .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', factionDetail?`
            vec3 mapN;
            if(useFactionDetail){
              vec2 slope=surfaceDetail.rg*2.0-1.0;
              mapN=vec3(slope,sqrt(max(.001,1.0-dot(slope,slope))));
            }else{
              mapN=texture2D(normalMap,vNormalMapUv).xyz*2.0-1.0;
            }`:'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;')
          .replace('mapN.xy *= normalScale;',`mapN.xy*=normalScale*vSurfaceFinish.z${factionDetail?'*(useFactionDetail?1.65:1.0)':''};`)+
          (weathered?weatherRelief:''));
  };
  return material;
}
