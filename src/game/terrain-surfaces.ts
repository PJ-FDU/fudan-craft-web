import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { generatedImage } from './runtime-assets.js';
import type { ResourceLoad } from './resource-loading.js';

export const TERRAIN_LAYERS=['grass','road','rock','sand','moss','water'] as const;
export interface TerrainSurfaces { albedo:DataArrayTexture; detail:DataArrayTexture }

export function loadTerrainSurfaces(progress?:ResourceLoad):Promise<TerrainSurfaces>{
  const load=async (filename:string)=>{
    const image=await generatedImage(`generated/surfaces/${filename}`,progress);
    const size=image.naturalWidth;
    if(!size||image.naturalHeight!==size*TERRAIN_LAYERS.length)throw Error(`地表纹理尺寸错误：${filename}`);
    const canvas=document.createElement('canvas');
    canvas.width=size;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');
    if(!context)throw Error('无法读取地表纹理');
    context.drawImage(image,0,0);
    const data=context.getImageData(0,0,canvas.width,canvas.height).data;
    const texture=new DataArrayTexture(data,size,size,TERRAIN_LAYERS.length);
    texture.wrapS=texture.wrapT=RepeatWrapping;
    texture.magFilter=LinearFilter;texture.minFilter=LinearMipmapLinearFilter;
    texture.generateMipmaps=true;texture.anisotropy=4;texture.needsUpdate=true;
    return texture;
  };
  return Promise.allSettled([load('terrain-albedo.png'),load('terrain-detail.png')]).then(([albedo,detail])=>{
    if(albedo.status==='fulfilled'&&detail.status==='fulfilled'){
      albedo.value.colorSpace=SRGBColorSpace;
      return {albedo:albedo.value,detail:detail.value};
    }
    if(albedo.status==='fulfilled')albedo.value.dispose();
    if(detail.status==='fulfilled')detail.value.dispose();
    throw albedo.status==='rejected'?albedo.reason:detail.status==='rejected'?detail.reason:Error('缺少地表纹理');
  });
}

const layer=(name:typeof TERRAIN_LAYERS[number])=>`${TERRAIN_LAYERS.indexOf(name)}.0`;

// 两种地表材质共用世界坐标扰动，草泥边缘不会随地图大小或镜头缩放变化。
export const terrainRoadUniforms=/* glsl */`
  uniform sampler2D roads;
  float terrainEdgeNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    vec4 n=fract(sin(vec4(dot(i,vec2(127.1,311.7)),
      dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),
      dot(i+vec2(1,1),vec2(127.1,311.7))))*43758.5453);
    return mix(mix(n.x,n.y,f.x),mix(n.z,n.w,f.x),f.y);
  }
  float terrainRoadCoverage(vec2 worldPoint,float detail){
    vec2 bend=vec2(terrainEdgeNoise(worldPoint/92.0),terrainEdgeNoise(worldPoint/92.0+vec2(37,19)))-.5;
    vec2 fringe=vec2(sin(worldPoint.y*.17+sin(worldPoint.x*.11)),
      sin(worldPoint.x*.15+sin(worldPoint.y*.13)));
    vec2 roadUv=(worldPoint+bend*36.0+fringe*4.0)/battleExtent;
    return smoothstep(.10,.80,texture2D(roads,roadUv).r+detail*.10);
  }
`;

export const terrainSurfaceUniforms=/* glsl */`
  uniform highp sampler2DArray terrainAlbedo, terrainDetail;
`;

export const terrainColor=/* glsl */`
  vec3 surfacePoint=battleWorldPos;
  vec2 grassUv=surfacePoint.xz/265.0;
  vec2 roadUv=surfacePoint.xz/180.0;
  vec2 sandUv=surfacePoint.xz/155.0;
  vec3 grass=texture(terrainAlbedo,vec3(grassUv,${layer('grass')})).rgb;
  vec3 dirt=texture(terrainAlbedo,vec3(roadUv,${layer('road')})).rgb;
  vec3 sand=texture(terrainAlbedo,vec3(sandUv,${layer('sand')})).rgb;
  vec3 grassDetail=texture(terrainDetail,vec3(grassUv,${layer('grass')})).rgb;
  vec3 roadDetail=texture(terrainDetail,vec3(roadUv,${layer('road')})).rgb;
  vec3 sandDetail=texture(terrainDetail,vec3(sandUv,${layer('sand')})).rgb;

  vec3 surfaceNormal=normalize(battleWorldNormal);
  vec3 weights=pow(abs(surfaceNormal),vec3(5.0));
  weights/=max(dot(weights,vec3(1.0)),.001);
  vec3 rockPoint=surfacePoint/225.0;
  vec3 rockX=vec3(rockPoint.zy,${layer('rock')});
  vec3 rockY=vec3(rockPoint.xz,${layer('rock')});
  vec3 rockZ=vec3(rockPoint.xy,${layer('rock')});
  vec3 rock=texture(terrainAlbedo,rockX).rgb*weights.x
    +texture(terrainAlbedo,rockY).rgb*weights.y+texture(terrainAlbedo,rockZ).rgb*weights.z;
  vec3 rockDetail=texture(terrainDetail,rockX).rgb*weights.x
    +texture(terrainDetail,rockY).rgb*weights.y+texture(terrainDetail,rockZ).rgb*weights.z;

  float coarse=sin(surfacePoint.x*.061+sin(surfacePoint.z*.048))*cos(surfacePoint.z*.054);
  float road=terrainRoadCoverage(surfacePoint.xz,grassDetail.r-.5);
  float slope=1.0-clamp(surfaceNormal.y,0.0,1.0);
  float shore=1.0-smoothstep(-1.55,-.05,surfacePoint.y);
  float cliff=smoothstep(.13,.38,slope)*(1.0-shore*.85);
  float wetness=1.0-smoothstep(-1.67,-.12,surfacePoint.y);
  float canopy=texture2D(groundShade,battleUv).a;
  vec3 mossUv=vec3(surfacePoint.xz/310.0,${layer('moss')});
  vec3 moss=texture(terrainAlbedo,mossUv).rgb;
  vec3 mossDetail=texture(terrainDetail,mossUv).rgb;
  float mossCover=mossDetail.b*max(cliff*.34,(1.0-road)*canopy*.28)*(1.0-shore*.84);

  // Terrain masks and elevation remain in world coordinates across map sizes.
  vec3 field=mix(vec3(.075,.119,.055),grass*.78,.78);
  vec3 trail=mix(vec3(.178,.137,.088),dirt*.82,.72);
  vec3 rocky=mix(rock*.78,vec3(.14,.145,.135),.15);
  vec3 shoreColor=sand*mix(vec3(.79,.75,.61),vec3(.37,.44,.39),wetness);
  vec3 terrainBase=mix(mix(field,trail,road),rocky,cliff);
  terrainBase=mix(mix(terrainBase,moss*.62,mossCover),shoreColor,shore);
  diffuseColor.rgb*=terrainBase*(1.0-canopy*.30)*(1.0+.11*coarse);

  vec2 terrainSurface=mix(mix(grassDetail.rg,roadDetail.rg,road),rockDetail.rg,cliff);
  terrainSurface=mix(mix(terrainSurface,mossDetail.rg,mossCover),sandDetail.rg,shore);
  float terrainHeight=(terrainSurface.x-.5)*mix(7.0,16.0,cliff);
  float terrainRoughness=mix(terrainSurface.y,.57,shore*wetness);
`;

export const terrainNormal=/* glsl */`
  vec3 groundDx=dFdx(-vViewPosition), groundDy=dFdy(-vViewPosition);
  vec3 groundX=cross(groundDy,normal), groundY=cross(normal,groundDx);
  float groundDet=dot(groundDx,groundX);
  vec3 groundSlope=(groundX*dFdx(terrainHeight)+groundY*dFdy(terrainHeight))*sign(groundDet)/max(abs(groundDet),1e-6);
  normal=normalize(normal-groundSlope*min(1.0,.26/max(length(groundSlope),1e-6)));
`;

export const terrainWaterBed=/* glsl */`
  vec3 sediment=texture(terrainAlbedo,vec3(waterPoint/155.0,${layer('sand')})).rgb;
  shallowCol=mix(shallowCol,sediment*vec3(.28,.48,.41),.42);
`;

export const terrainWaterFoam=/* glsl */`
  float foamArt=texture(terrainDetail,vec3(waterPoint/88.0+battleTime*vec2(.018,-.012),${layer('water')})).b;
  foam=foamBand*(.08+smoothstep(.10,.70,foamArt)*.60)*(.64+bubbles*.36);
`;

export const terrainWaterNormal=/* glsl */`
  vec2 waterArtA=texture(terrainDetail,vec3(wavePoint/106.0+battleTime*vec2(.016,-.012),${layer('water')})).rg-.5;
  vec2 waterArtB=texture(terrainDetail,vec3(wavePoint.yx/65.0-battleTime*vec2(.014,.018),${layer('water')})).gr-.5;
  vec2 artSlope=(waterArtA*.24+waterArtB*.14)*smoothstep(.6,8.0,shorelineDepth);
  rippleX=rippleX*.55+artSlope.x;
  rippleZ=rippleZ*.55+artSlope.y;
`;
