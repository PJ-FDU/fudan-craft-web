import {
  AmbientLight, Box3, BufferAttribute, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DataTexture,
  DirectionalLight, Group, HemisphereLight, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  OrthographicCamera, PCFShadowMap, PlaneGeometry, Raycaster, RedFormat, RingGeometry, Scene, ShaderChunk, ShaderMaterial, SRGBColorSpace,
  SkinnedMesh, Texture, Vector2, Vector3, WebGLRenderer, type Object3D,
} from 'three';
import { AnimationClock, UnitMotion, deathPose } from './animation.js';
import { atlasCellGLSL, atlasSamplingGLSL, battleAtlas, factionDetailTexture } from './battle-materials.js';
import { battleLighting } from './battle-lighting.js';
import { BattleGI, MAX_BATTLE_LIGHTS, type BattleDynamicLight, type LightingQuality } from './battle-gi.js';
import { buildingFacing,buildingSize,type BuildPlacement } from './building-layout.js';
import { turnToward, type Camera } from './camera.js';
import { oilNodeAt } from './oil.js';
import { placementError } from './engine.js';
import { BattleModels, natureGeometry, type BattleModel } from './models-3d.js';
import type { BlenderAssets } from './blender-assets.js';
import { natureSurface } from './model-surface.js';
import { terrainGeometry, waterGeometry, waterMaskGeometry } from './battle-terrain.js';
import { terrainColor, terrainNormal, terrainSurfaceUniforms, terrainWaterBed, terrainWaterFoam, terrainWaterNormal, type TerrainSurfaces } from './terrain-surfaces.js';
import { heightAt, normalAt } from './terrain-height.js';
import { humanoid,poseRig } from './unit-rig.js';
import { weapon } from './weapons.js';
import { TILE, gridSize, distance } from './pathfinding.js';
import { COLORS, RESOURCE_INFO, STATS, isMobile, type BuildingKind, type MobileKind, type Point, type ResourceNode, type Side, type ViewState } from './types.js';
import { getWorld,type WorldData,type Feature } from './world.js';
import { harvestLand,isTree } from './resource-world.js';

type VisibleUnit = ViewState['units'][number];
interface UnitVisual extends BattleModel {
  unit: VisibleUnit;
  point: Point;
  angle: number;
  altitude: number;
  shadow: Mesh;
  selection:Mesh<BufferGeometry,MeshBasicMaterial>;
  range:Mesh<BufferGeometry,MeshBasicMaterial>;
}
interface NodeVisual extends BattleModel { node: ResourceNode; empty: boolean; selection:Mesh<BufferGeometry,MeshBasicMaterial>; }
interface BattleEffect {root:Group;flare:ShotMesh;particle?:ShotMesh;wreck?:BattleModel}
export type ScenePick = {unit: number} | {node: number};
type ShotMesh = Mesh<BufferGeometry,MeshBasicMaterial>;
interface SceneMaterial {
  wind?:boolean;
  ground?:{roads:DataTexture;shade:Texture};
  water?:boolean;
  hideInFog?:boolean|'solid';
}

const border = 760;
const shadowPlane = new PlaneGeometry(1,1).rotateX(-Math.PI/2);
const selectionRing = new RingGeometry(.8,1,96).rotateX(-Math.PI/2);
const noSelection:ReadonlySet<number>=new Set();
const up = new Vector3(0,1,0);
const sunOffset = new Vector3(-598,1150,-462);
const initialYaw = -.39;
const groundTilt = .62;
const life = {impact:.43,heal:.48,spawn:.85,complete:.85,death:3.2};
const particlePlanes=Array.from({length:4},(_,index)=>{
  const geometry=new PlaneGeometry(1,1);
  const uv=geometry.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,
    (index%2+.035+uv.getX(i)*.93)*.5,(1-Math.floor(index/2)+.035+uv.getY(i)*.93)*.5);
  return geometry;
});
const bufferOutputs='layout(location=1) out vec4 battleNormal; layout(location=2) out vec4 battleSurface;';
// MRT 要求所有活动附件都有输出。透明特效输出 alpha=0，通过混合保留下层材质数据。
const neutralBuffers='battleNormal=vec4(0.0); battleSurface=vec4(0.0);';
// 接触硬化软阴影（PCSS）：基于 WebGL2 硬件 sampler2DShadow 探测近地／高空遮挡器，脚底锐利、高处柔和。
const pcssShadowChunk=ShaderChunk.shadowmap_pars_fragment.replace(
  'float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;',
  `float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
   if ( battleSoftShadow > 0.05 ) {
     float nearHit = 0.0, midHit = 0.0;
     for ( int b = 0; b < 4; b++ ) {
       vec2 bo = vogelDiskSample( b, 4, phi ) * texelSize * 2.6;
       nearHit += 1.0 - texture( shadowMap, vec3( shadowCoord.xy + bo, max( 0.0, shadowCoord.z - 0.0024 ) ) );
       midHit  += 1.0 - texture( shadowMap, vec3( shadowCoord.xy + bo * 1.9, max( 0.0, shadowCoord.z - 0.0115 ) ) );
     }
     float contact = clamp( nearHit * 0.25, 0.0, 1.0 );
     float lofty = clamp( midHit * 0.25, 0.0, 1.0 );
     float penumbra = mix( mix( 0.50, 1.72, lofty ), 0.42, contact * 0.85 );
     vec2 softRadius = radius * mix( 1.0, penumbra, clamp( battleSoftShadow, 0.0, 1.0 ) );
     float acc = 0.0;
     for ( int s = 0; s < 12; s++ ) {
       acc += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( s, 12, phi ) * softRadius, shadowCoord.z ) );
     }
     shadow = acc / 12.0;
   } else`
);

export class BattleScene {
  private gl:WebGLRenderer;
  private scene=new Scene();
  private landscape=new Group();
  private landscapeTextures:Texture[]=[];
  private camera=new OrthographicCamera(-1,1,1,-1,1,12000);
  private pointer=new Vector2();
  private raycaster=new Raycaster();
  private models:BattleModels;
  private atlas:Texture;
  private sun=new DirectionalLight(0xffe6c7,3.1);
  private units=new Map<number,UnitVisual>();
  private nodes=new Map<number,NodeVisual>();
  private effects=new Map<number,BattleEffect>();
  private particleTexture?:Texture;
  private motion=new UnitMotion();
  private clock=new AnimationClock();
  private shots=new Group();
  private beams:ShotMesh[]=[];
  private shells:ShotMesh[]=[];
  private shotGeometry=new CylinderGeometry(1,1,1,5);
  private shotCore=new CircleGeometry(1,12);
  private effectRing=new CircleGeometry(1,24,0,Math.PI*2).rotateX(-Math.PI/2);
  private haze={value:new DataTexture(undefined,1,1,RedFormat)};
  private hazeData=new Uint8Array(0);
  private extent={value:0};
  private fogView?:ViewState;
  private ambient={value:0};
  private softShadow={value:0};
  private dynamicLights:BattleDynamicLight[]=Array.from({length:MAX_BATTLE_LIGHTS},()=>({x:0,y:0,z:0,radius:0,r:0,g:0,b:0,intensity:0}));
  private dynamicScores=new Float32Array(MAX_BATTLE_LIGHTS);
  private dynamicLightCount=0;
  private shadowMaterial=new ShaderMaterial({
    transparent:true,depthWrite:false,
    vertexShader:`varying vec2 shadowUv;
      void main(){shadowUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`${bufferOutputs}
      varying vec2 shadowUv;
      void main(){float fog=1.0-smoothstep(.07,.50,length(shadowUv-.5));
        gl_FragColor=vec4(.032,.036,.028,fog*.27);
        ${neutralBuffers}}`,
  });
  private construction?:{kind:BuildingKind;side:Side;model:BattleModel};
  private viewportWidth=0;
  private viewportHeight=0;
  private ratio=0;
  private lastShadow=-Infinity;
  private anchorCorner=new Vector3();
  private anchorMatrix=new Matrix4();
  private skinBounds=new WeakMap<BufferGeometry,Map<number,Box3>>();
  private selectionMaterials=[...COLORS.slice(1),...Object.values(RESOURCE_INFO).map(info=>info.color),'#b3edce'].map(color=>new MeshBasicMaterial({
    color,transparent:true,opacity:.85,depthTest:true,depthWrite:false,
    polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
  }));
  private gi:BattleGI;
  get lightingQuality(){return this.gi.quality;}
  get supportsGI(){return this.gi.supported;}
  set lightingQuality(value:LightingQuality){this.gi.quality=value;this.softShadow.value=this.gi.pcssStrength;}
  private shadowHz=30;
  setShadowQuality(size:number,hz:number){
    size=Math.min(size,this.gl.capabilities.maxTextureSize);this.shadowHz=hz;
    if(this.sun.shadow.mapSize.x===size)return;
    this.sun.shadow.map?.dispose();this.sun.shadow.map=null;
    this.sun.shadow.mapSize.set(size,size);this.gl.shadowMap.needsUpdate=true;this.lastShadow=-Infinity;
  }

  constructor(canvas:HTMLCanvasElement,context:WebGL2RenderingContext,atlasImage:HTMLImageElement,unitAtlas:HTMLImageElement,factionAtlas:HTMLImageElement,private assets:BlenderAssets,private world:WorldData=getWorld(),factionDetail?:HTMLImageElement,private terrainSurfaces?:TerrainSurfaces,particles?:HTMLImageElement) {
    this.gl=new WebGLRenderer({canvas,context,antialias:true,alpha:false,powerPreference:'high-performance'});
    const anisotropy=this.gl.capabilities.getMaxAnisotropy();
    this.atlas=battleAtlas(atlasImage,unitAtlas,factionAtlas,anisotropy);
    if(particles){
      this.particleTexture=new Texture(particles);
      this.particleTexture.colorSpace=SRGBColorSpace;
      this.particleTexture.needsUpdate=true;
    }
    if(!assets.surface)throw Error('战场环境材质尚未加载');
    for(const texture of [assets.surface.albedo,assets.surface.normal,assets.surface.orm])texture.anisotropy=Math.min(8,anisotropy);
    this.models=new BattleModels(this.atlas,factionDetail&&factionDetailTexture(factionDetail,anisotropy),assets,
      material=>this.addHaze(material));
    battleLighting(this.gl,this.scene);
    this.gl.shadowMap.enabled=true;
    this.gl.shadowMap.type=PCFShadowMap;
    this.gl.shadowMap.autoUpdate=false;
    this.sun.castShadow=true;
    const shadowSize=Math.min(this.gl.capabilities.maxTextureSize,innerWidth<700?1024:innerWidth<1200?2048:4096);
    this.sun.shadow.mapSize.set(shadowSize,shadowSize);
    this.sun.shadow.camera.near=30;
    this.sun.shadow.camera.far=3100;
    this.sun.shadow.bias=-.00023;
    this.sun.shadow.normalBias=.55;
    this.sun.shadow.radius=2.6;
    this.scene.background=new Color(0x0a1716);
    this.scene.add(new HemisphereLight(0xc5ddf7,0x77795b,.72),new AmbientLight(0x809c99,.08));
    this.scene.add(this.sun,this.sun.target,this.shots);
    this.resizeHaze();
    this.gi=new BattleGI(this.gl,this.haze,this.extent);
    this.gi.setSunDirection(sunOffset);
    this.lightingQuality=innerWidth<700?'off':'balanced';

    this.scene.add(this.landscape);
    for(const material of [this.models.solid,...Object.values(this.models.lamps),...this.models.teams])this.addHaze(material);
    this.addHaze(this.models.forest,{wind:true});
    for(const material of this.selectionMaterials){
      material.customProgramCacheKey=()=>'battle-selection-ring-v1';
      material.onBeforeCompile=shader=>{
        shader.vertexShader='varying vec2 selectionUv;\n'+shader.vertexShader
          .replace('#include <uv_vertex>','#include <uv_vertex>\nselectionUv=uv*2.0-1.0;');
        shader.fragmentShader='varying vec2 selectionUv;\n'+shader.fragmentShader
          .replace('#include <color_fragment>',`#include <color_fragment>
            // 屏幕导数保持约 1.5px 的描边，建筑尺寸和缩放倍率不再放大线宽。
            float edge=length(selectionUv),pixel=max(fwidth(edge),.0001);
            diffuseColor.a*=(1.0-smoothstep(1.0-pixel,1.0,edge))
              *smoothstep(1.0-2.5*pixel,1.0-1.5*pixel,edge);`);
      };
      this.addHaze(material,{hideInFog:true});
    }

    this.buildLandscape();
  }

  setWorld(world:WorldData,force=false){
    if(!force&&this.world.id===world.id&&this.world.revision===world.revision)return;
    this.reset();
    // 只释放本地图拥有的几何、材质和纹理；全局地面几何与资产图集继续复用。
    const materials=new Set<MeshStandardMaterial>();
    this.landscape.traverse(object=>{
      if(object instanceof Mesh){
        object.geometry.dispose();
        for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
      }
    });
    for(const material of materials)material.dispose();
    for(const texture of this.landscapeTextures)texture.dispose();
    this.landscapeTextures=[];this.landscape.clear();this.world=world;
    this.resizeHaze();this.buildLandscape();this.lastShadow=-Infinity;this.fogView=undefined;this.gi.resetHistory();
  }

  private resizeHaze(){
    const size=gridSize(this.world.land);
    this.extent.value=size*TILE;
    if(this.haze.value.image.width===size)return;
    this.haze.value.dispose();
    this.hazeData=new Uint8Array(this.world.land.length).fill(255);
    const texture=new DataTexture(this.hazeData,size,size,RedFormat);
    texture.magFilter=texture.minFilter=LinearFilter;texture.needsUpdate=true;
    this.haze.value=texture;
  }

  private buildLandscape(){
    this.landscape.add(this.makeTerrain());
    if(this.world.waterMask){
      const maskGeo=waterMaskGeometry(this.world.waterMask,gridSize(this.world.land),this.world.heights);
      if(maskGeo){
        const material=new MeshStandardMaterial({color:0xffffff,roughness:.18,metalness:.1,envMapIntensity:1.15});
        this.addHaze(material,{water:true});
        const mesh=new Mesh(maskGeo,material);
        mesh.receiveShadow=true;
        this.landscape.add(mesh);
      }
    }
    const chunks=new Map<string,Feature[]>();
    for(const feature of this.world.features){
      if(feature.kind==='water'){this.addWater(feature);continue;}
      if(this.world.deposits&&isTree(feature))continue;
      const key=`${Math.floor(feature.x/512)}:${Math.floor(feature.y/512)}`;
      const chunk=chunks.get(key)??[];
      chunk.push(feature);chunks.set(key,chunk);
    }
    const vegetation=natureSurface(this.atlas,this.assets);
    this.addHaze(vegetation,{wind:true});
    for(const chunk of chunks.values()){
      const geometry=natureGeometry(chunk,this.assets,this.world);
      if(geometry){
        const mesh=new Mesh(geometry,vegetation);
        mesh.castShadow=mesh.receiveShadow=true;
        this.landscape.add(mesh);
      }
    }
  }

  private addHaze(material:MeshStandardMaterial|MeshBasicMaterial,options:SceneMaterial={}) {
    const {wind,ground,water,hideInFog}=options;
    const terrainSurfaces=(ground||water)&&this.terrainSurfaces;
    // 组合材质钩子，保留模型 PBR 参数，同时应用战争迷雾。
    const surfaceCompile=material.onBeforeCompile.bind(material),surfaceKey=material.customProgramCacheKey();
    const gbuffer=material instanceof MeshStandardMaterial&&!material.transparent;
    material.customProgramCacheKey=()=>surfaceKey+':gbuffer-v2'+(ground?':ground':water?':water':wind?':vegetation':hideInFog==='solid'?':hidden-solid':hideInFog?':fx':':fog')+(terrainSurfaces?':surface-layers':'');
    material.onBeforeCompile=(shader,renderer)=>{
      surfaceCompile(shader,renderer);
      shader.uniforms.battleFog=this.haze;
      shader.uniforms.battleExtent=this.extent;
      shader.uniforms.battleTime=this.ambient;
      if(gbuffer)shader.uniforms.battleSoftShadow=this.softShadow;
      if(ground&&!terrainSurfaces)shader.uniforms.paintedAtlas={value:this.atlas};
      if(terrainSurfaces){
        shader.uniforms.terrainAlbedo={value:terrainSurfaces.albedo};
        shader.uniforms.terrainDetail={value:terrainSurfaces.detail};
      }
      if(ground){
        shader.uniforms.roads={value:ground.roads};
        shader.uniforms.groundShade={value:ground.shade};
      }
      shader.vertexShader=`varying vec2 battleUv;
        uniform float battleTime, battleExtent;
        ${ground?'varying vec3 battleWorldNormal; varying vec3 battleWorldPos;':''}
        ${water?'attribute float waterDepth; varying float shorelineDepth;':''}
      `+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        ${wind?`vec3 original=(modelMatrix*vec4(position,1.0)).xyz;
          float sway=smoothstep(15.0,90.0,position.y);
          transformed.x += sway*(sin(battleTime*1.4+original.x*.013+original.z*.008)-sin(original.x*.013+original.z*.008))*2.0;
          transformed.z += sway*sin(battleTime*.9)*1.5;`:''}
        ${water?`shorelineDepth=waterDepth;
          vec2 wavePoint=(modelMatrix*vec4(position,1.0)).xz;
          transformed.y+=smoothstep(1.0,24.0,waterDepth)*(
            sin(wavePoint.x*.032+wavePoint.y*.021+battleTime*1.3)*.65
            +sin(wavePoint.x*-.018+wavePoint.y*.045+battleTime*.84)*.35);`:''}
      `).replace('#include <project_vertex>',`
        vec4 battleWorldV=modelMatrix*vec4(transformed,1.0);
        battleUv=battleWorldV.xz/battleExtent;
        ${ground?'battleWorldPos=battleWorldV.xyz; battleWorldNormal=normalize(mat3(modelMatrix)*normal);':''}
        #include <project_vertex>
      `);
      shader.fragmentShader=`${bufferOutputs}
        varying vec2 battleUv;
        uniform sampler2D battleFog;
        uniform float battleTime, battleExtent;
        ${ground?'varying vec3 battleWorldNormal; varying vec3 battleWorldPos;':''}
        ${gbuffer?'uniform float battleSoftShadow;':''}
        ${water?`varying float shorelineDepth;
          float rippleHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
          float rippleNoise(vec2 p){
            vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
            return mix(mix(rippleHash(i),rippleHash(i+vec2(1,0)),f.x),
              mix(rippleHash(i+vec2(0,1)),rippleHash(i+vec2(1,1)),f.x),f.y);
          }`:''}
        ${terrainSurfaces?terrainSurfaceUniforms:ground?atlasSamplingGLSL:''}
        ${ground?`uniform sampler2D roads;
          uniform sampler2D groundShade;`:''}
      `+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        ${ground?(terrainSurfaces?terrainColor:`vec2 fieldUV=battleUv*battleExtent*(17.5/4096.0);
          vec3 grass=paintGround(${atlasCellGLSL('grass')},fieldUV);
          vec3 dirt=paintGround(${atlasCellGLSL('earth')},fieldUV*.77);
          float edge=sin(battleUv.x*425.0+battleUv.y*293.0)*cos(battleUv.y*507.0-battleUv.x*165.0);
          float road=smoothstep(.13,.88,texture2D(roads,battleUv).r+edge*.12+(grass.g-.21)*.47);
          float shade=sin(battleUv.x*57.0+sin(battleUv.y*33.0)*1.55)*cos(battleUv.y*62.0);
          vec3 field=mix(vec3(.075,.119,.055),grass*.76,.77)*(1.0+shade*.24);
          vec3 trail=mix(vec3(.178,.137,.088),dirt*vec3(.72,.89,1.13),.62)*(1.0+shade*.16);
          float slope=1.0-clamp(battleWorldNormal.y,0.0,1.0);
          float shoreBank=1.0-smoothstep(-1.55,-.05,battleWorldPos.y);
          float cliffBlend=smoothstep(.13,.38,slope)*(1.0-shoreBank*.85);
          vec3 cliffTex=paintGround(${atlasCellGLSL('stone')},vec2((battleWorldPos.x+battleWorldPos.z)*(13.0/4096.0),battleWorldPos.y*.022));
          vec3 cliff=mix(vec3(.14,.145,.135),cliffTex*.82,.75)*(1.0+shade*.14);
          float elevationLift=1.0+clamp(battleWorldPos.y/58.0,0.0,1.0)*.14;
          vec3 baseGround=mix(max(field,vec3(.018)),trail,road)*elevationLift;
          float deepBed=1.0-smoothstep(-2.4,-1.1,battleWorldPos.y);
          vec3 wetSand=mix(trail*vec3(.92,.88,.76),vec3(.11,.105,.08),deepBed);
          float wetDarken=1.0-(1.0-smoothstep(-1.65,-.6,battleWorldPos.y))*.28;
          baseGround=mix(baseGround,wetSand*wetDarken,clamp(shoreBank*(.82+edge*.12),0.0,1.0));
          float canopy=texture2D(groundShade,battleUv).a;
          diffuseColor.rgb*=mix(baseGround,cliff,cliffBlend)*(1.0-canopy*.34);`):''}
        ${water?`vec2 waterPoint=battleUv*battleExtent;
          float shoreNoise=rippleNoise(waterPoint*.045+battleTime*vec2(.04,-.03));
          float depthJitter=max(0.0,shorelineDepth+(shoreNoise-.5)*3.2);
          float shallow=1.0-smoothstep(1.0,26.0,depthJitter);
          float midDepth=1.0-smoothstep(16.0,52.0,depthJitter);
          // 岸边扩散涟漪环 + 开放水域双层折射光纹
          float shoreRipple=sin(shorelineDepth*.68-battleTime*2.3+shoreNoise*4.2);
          float rippleRing=smoothstep(.58,.96,shoreRipple)*(1.0-smoothstep(3.0,26.0,shorelineDepth))*smoothstep(.4,2.8,shorelineDepth);
          float r1=rippleNoise(waterPoint*.065+battleTime*vec2(.22,-.17));
          float r2=rippleNoise(waterPoint*.105-battleTime*vec2(.18,.21));
          float r3=rippleNoise(waterPoint*.17+battleTime*vec2(-.12,.14));
          float caustic=smoothstep(.54,.86,r1*.5+r2*.5)*(.28+shallow*.55);
          float shimmer=smoothstep(.64,.92,r2*.45+r3*.55)*.16;
          float foamEdge=4.2+sin(battleTime*1.8+waterPoint.x*.055+waterPoint.y*.035)*1.4+shoreNoise*2.2;
          float foamBand=1.0-smoothstep(.4,foamEdge,shorelineDepth);
          float bubbles=smoothstep(.22,.78,rippleNoise(waterPoint*.16+battleTime*vec2(.12,-.09)));
          float foam=foamBand*(.22+bubbles*.48);
          ${terrainSurfaces?terrainWaterFoam:''}
          vec3 deepCol=vec3(.02,.078,.105);
          vec3 midCol=vec3(.048,.145,.165);
          vec3 shallowCol=vec3(.145,.265,.225);
          ${terrainSurfaces?terrainWaterBed:''}
          diffuseColor.rgb=mix(deepCol,midCol,midDepth);
          diffuseColor.rgb=mix(diffuseColor.rgb,shallowCol,shallow);
          diffuseColor.rgb+=vec3(.09,.15,.14)*caustic+vec3(.14,.18,.17)*shimmer;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.56,.72,.68),rippleRing*.34);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.68,.78,.72),foam);`:''}
      `).replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        ${ground&&terrainSurfaces?'roughnessFactor=terrainRoughness;':''}
      `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        ${ground&&terrainSurfaces?terrainNormal:''}
        ${water?`vec2 wavePoint=battleUv*battleExtent;
          float waveA=wavePoint.x*.026+wavePoint.y*.018+battleTime*1.3;
          float waveB=wavePoint.x*-.022+wavePoint.y*.036+battleTime*.92;
          float waveC=wavePoint.x*.043-wavePoint.y*.032-battleTime*1.1;
          vec2 rippleUv1=wavePoint*.085+battleTime*vec2(.21,-.16);
          vec2 rippleUv2=wavePoint*.165-battleTime*vec2(.15,.19);
          float n1a=rippleNoise(rippleUv1), n1b=rippleNoise(rippleUv1+vec2(23.4,11.7));
          float n2a=rippleNoise(rippleUv2), n2b=rippleNoise(rippleUv2+vec2(17.1,31.3));
          float rippleX=(n1a-.5)*.095+(n2a-.5)*.055;
          float rippleZ=(n1b-.5)*.095+(n2b-.5)*.055;
          ${terrainSurfaces?terrainWaterNormal:''}
          float shoreWave=cos(shorelineDepth*.68-battleTime*2.3)*.045*(1.0-smoothstep(2.0,22.0,shorelineDepth));
          float waveCalm=smoothstep(0.0,9.0,shorelineDepth);
          vec3 waveNormal=normalize(vec3(
            (-cos(waveA)*.032+cos(waveB)*.024-cos(waveC)*.016)*waveCalm+rippleX+shoreWave,
            1.0,
            (-cos(waveA)*.024-cos(waveB)*.038+cos(waveC)*.018)*waveCalm+rippleZ+shoreWave));
          normal=normalize(mat3(viewMatrix)*waveNormal);`:''}
      `).replace('#include <shadowmap_pars_fragment>',gbuffer?pcssShadowChunk:'#include <shadowmap_pars_fragment>').replace('#include <opaque_fragment>',`
        vec2 fogUv=clamp(battleUv,0.0,1.0), kernel=vec2(15.56/battleExtent);
        float battlefieldHaze=texture2D(battleFog,fogUv).r*.56
          +(texture2D(battleFog,fogUv+kernel).r+texture2D(battleFog,fogUv-kernel).r)*.22;
        ${ground?`vec2 outside=max(-battleUv,battleUv-1.0);
          battlefieldHaze=mix(battlefieldHaze,1.0,smoothstep(0.0,.022,max(outside.x,outside.y)));`:''}
        outgoingLight=mix(outgoingLight,vec3(.0028,.0075,.0058),battlefieldHaze*.993);
        ${hideInFog==='solid'?'if(battlefieldHaze>.28) discard;':hideInFog?'diffuseColor.a *= 1.0-smoothstep(.05,.28,battlefieldHaze);':''}
        #include <opaque_fragment>
        ${gbuffer?`
          // 主光照使用的最终贴图法线与 PBR 参数，供间接光和反射读取。
          battleNormal=vec4(normalize(normal),clamp(roughnessFactor,.04,1.0));
          battleSurface=vec4(diffuseColor.rgb,clamp(metalnessFactor,0.0,1.0));`:neutralBuffers}
      `);
    };
  }

  private makeTerrain() {
    const size=gridSize(this.world.land),extent=this.extent.value;
    const roads=new DataTexture(this.world.roads,size,size,RedFormat);
    roads.magFilter=roads.minFilter=LinearFilter;roads.needsUpdate=true;
    const shadows=document.createElement('canvas');
    shadows.width=shadows.height=1024;
    const ctx=shadows.getContext('2d')!;
    ctx.scale(shadows.width/extent,shadows.height/extent);
    for(const feature of this.world.features){
      if(this.world.deposits&&isTree(feature))continue;
      if(!['pine','oak','birch','ruin','rock','rockLarge','bush'].includes(feature.kind))continue;
      const radius=feature.size*.44;
      ctx.save();
      ctx.translate(feature.x+radius*.45,feature.y-radius*.3);
      ctx.rotate(-.45);ctx.scale(1.3,.82);
      const shadow=ctx.createRadialGradient(0,0,0,0,0,radius);
      shadow.addColorStop(0,'#000d');shadow.addColorStop(.5,'#0008');shadow.addColorStop(1,'#0000');
      ctx.fillStyle=shadow;ctx.fillRect(-radius,-radius,radius*2,radius*2);
      ctx.restore();
    }
    const shade=new Texture(shadows);
    shade.flipY=false;shade.needsUpdate=true;
    this.landscapeTextures.push(roads,shade);
    const ground=new MeshStandardMaterial({roughness:1});
    this.addHaze(ground,{ground:{roads,shade}});
    const mesh=new Mesh(terrainGeometry(this.world,border),ground);
    mesh.receiveShadow=true;
    return mesh;
  }

  private addWater(feature:Feature) {
    // 岸边使用地表本身；整片浅色覆盖网格会与起伏地面相交，露出三角形斑块。
    const surface=waterGeometry(feature);
    const material=new MeshStandardMaterial({
      color:0xffffff,roughness:.18,metalness:.1,envMapIntensity:1.15,
    });
    this.addHaze(material,{water:true});
    const mesh=new Mesh(surface,material);
    mesh.position.set(feature.x+(feature.waterRadii?0:16),0,feature.y+(feature.waterRadii?0:16));
    mesh.receiveShadow=true;
    this.landscape.add(mesh);
  }

  orient(view:Camera,yaw=initialYaw) {view.orient(yaw,groundTilt,border);}
  private syncCamera(view:Camera) {
    const halfWidth=view.width/(2*view.zoom),halfHeight=view.height/(2*view.zoom);
    this.camera.left=-halfWidth;this.camera.right=halfWidth;
    this.camera.top=halfHeight;this.camera.bottom=-halfHeight;
    const depth=5600*Math.sqrt(1-view.tilt**2);
    this.camera.position.set(view.x-Math.sin(view.yaw)*depth,5600*view.tilt,view.y+Math.cos(view.yaw)*depth);
    this.camera.lookAt(view.x,0,view.y);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private followSun(view:Camera){
    const bounds=Math.max(365,Math.hypot(view.width,view.height/view.tilt)*.58/view.zoom);
    const step=2*bounds/this.sun.shadow.mapSize.x;
    this.sun.target.position.set(Math.round(view.x/step)*step,0,Math.round(view.y/step)*step);
    this.sun.position.copy(this.sun.target.position).add(sunOffset);
    const camera=this.sun.shadow.camera;
    camera.left=camera.bottom=-bounds;camera.right=camera.top=bounds;
    camera.updateProjectionMatrix();
  }

  private removeUnit(visual:UnitVisual){
    visual.rig?.skeleton.dispose();
    this.scene.remove(visual.root,visual.shadow,visual.selection,visual.range);
  }

  private updateUnits(view:ViewState,camera:Camera,dt:number,time:number,animate:boolean,selected:ReadonlySet<number>,showRanges:boolean) {
    const active=new Set(view.units.map(u=>u.id));
    this.motion.prune(active);
    for(const [id,visual] of this.units)if(!active.has(id)){
      this.removeUnit(visual);
      this.units.delete(id);
    }
    const packed=(unit:ViewState['units'][number])=>unit.station?.mode==='mobile'||unit.station?.mode==='deploying';
    for(const unit of view.units){
      let visual=this.units.get(unit.id);
      if(visual&&(visual.unit.kind!==unit.kind||visual.unit.side!==unit.side||packed(visual.unit)!==packed(unit))){
        this.removeUnit(visual);visual=undefined;
      }
      const stat=STATS[unit.kind];
      if(!visual){
        const object=this.models.unit(unit.kind,unit.side,false,view.players.find(p=>p.side===unit.side)?.race,packed(unit));
        const shadow=new Mesh(shadowPlane,this.shadowMaterial);
        const footprint=isMobile(unit)?stat.size*.89:stat.radius*3.1;
        shadow.scale.set(footprint,1,footprint*.85);
        const selection=new Mesh(selectionRing,this.selectionMaterials[unit.side-1]);
        const footprintSize=isMobile(unit)?null:buildingSize(unit.kind as BuildingKind);
        const radius=footprintSize?Math.hypot(footprintSize.width,footprintSize.depth)/2+6:Math.max(stat.radius+6,stat.size*.37);
        selection.scale.set(radius,1,radius);
        // 地面标记参与深度测试：车身、脚部和其他建筑会真实遮住后侧圆弧。
        selection.renderOrder=2;
        const range=new Mesh(selectionRing,this.selectionMaterials[7]);
        range.scale.set(stat.range,1,stat.range);range.renderOrder=2;
        this.scene.add(object.root,shadow,selection,range);
        visual={...object,unit,shadow,selection,range,point:{x:unit.x,y:unit.y},angle:unit.angle,altitude:0};
        this.units.set(unit.id,visual);
      }
      const snap=distance(visual.point,unit)>=160, mix=snap?1:1-Math.exp(-30*dt);
      visual.point.x+=(unit.x-visual.point.x)*mix;
      visual.point.y+=(unit.y-visual.point.y)*mix;
      visual.unit=unit;
      const heading=visual.angle;
      visual.angle=snap?unit.angle:turnToward(heading,unit.angle,dt*(stat.air?7:stat.size>80?5:12));
      const groundY=heightAt(this.world,visual.point.x,visual.point.y);
      visual.altitude=stat.air?Math.max(groundY,0)+57+(animate?Math.sin(time*2.1+unit.id)*3:0):groundY;
      const root=visual.root;
      root.position.set(visual.point.x,visual.altitude,visual.point.y);
      visual.shadow.position.set(visual.point.x+5+(visual.altitude-groundY)*.3,groundY+.26,visual.point.y-4);
      visual.selection.position.set(visual.point.x,groundY+.45,visual.point.y);
      visual.selection.visible=selected.has(unit.id);
      visual.range.position.copy(visual.selection.position);
      visual.range.visible=selected.has(unit.id)&&showRanges&&stat.range>0;
      const yaw=isMobile(unit)||packed(unit)?Math.PI/2-visual.angle:(unit.facing??buildingFacing(unit.kind as BuildingKind,unit,this.extent.value))*Math.PI/2;
      if(isMobile(unit)&&!stat.air&&!humanoid(unit.kind as MobileKind)&&this.world.heights){
        const [nx,ny,nz]=normalAt(this.world,visual.point.x,visual.point.y);
        const fx=Math.sin(yaw),fz=Math.cos(yaw),rx=fz,rz=-fx;
        const pitch=Math.atan2(nx*fx+nz*fz,ny)*.75;
        const roll=Math.atan2(-(nx*rx+nz*rz),ny)*.75;
        root.rotation.order='YXZ';
        root.rotation.set(pitch,yaw,roll);
      }else{
        root.rotation.order='XYZ';
        root.rotation.set(0,yaw,0);
      }
      root.scale.y=Math.max(.17,unit.construction);
      const action=unit.action;
      const age=action?.fired==null?Infinity:time-action.fired;
      const recoil=animate&&age>=0&&age<.28?Math.exp(-age*13):0;
      if(visual.rig){
        const tracking=this.motion.pose({...unit,...visual.point},time,dt);
        const screen=camera.worldToScreen(visual.point,visual.altitude+visual.height/2);
        if(screen.x>=-190&&screen.x<=camera.width+190&&screen.y>=-190&&screen.y<=camera.height+190){
          let aim=0;
          if(animate&&action&&time>=action.started&&time<action.until){
            const spec=weapon(unit.kind);
            aim=action.fired===null?Math.min(1,(time-action.started)/spec.windup):Math.max(0,1-age/spec.recovery);
          }
          const delta=visual.angle-heading,turn=animate&&!snap?Math.max(-1,Math.min(1,Math.atan2(Math.sin(delta),Math.cos(delta))/Math.max(.025,dt*5))):0;
          const cast=unit.ability?.cast&&time<unit.ability.cast.until?1:
            unit.ability?.recovery?Math.max(0,Math.min(1,(unit.ability.recovery-time)/.3)):0;
          // 种族炮塔保持朝向目标；施法与生产驱动各模型的专用构件。
          if(unit.kind==='tower')aim=Math.PI/2-visual.angle-yaw;
          poseRig(visual.rig,unit.kind as MobileKind,{...tracking,time,id:unit.id,aim,recoil,turn,animate,cast,active:unit.activity==='produce'});
        }
      }else if(visual.moving.length){
        const arm=visual.moving[0];
        arm.rotation.x=recoil*.18;
        if(unit.kind==='oilwell')arm.rotation.z=animate&&unit.activity==='produce'?Math.sin(time*2.4)*.18:0;
        arm.rotation.y=unit.kind==='tower'?Math.PI/2-visual.angle-yaw:animate&&(unit.kind==='research'||unit.kind==='base')?time*.35:0;
      }
    }
  }

  private updateNodes(view:ViewState,hoverNode:number|null,selectedNode:number|null) {
    const active=new Set(view.nodes.map(node=>node.id));
    for(const [id,visual] of this.nodes)if(!active.has(id)){
      this.scene.remove(visual.root,visual.selection);this.nodes.delete(id);
    }
    const covered=new Set(view.units.filter(unit=>unit.kind==='oilwell').map(well=>oilNodeAt(well,view.nodes)?.id));
    for(const node of view.nodes){
      const empty=node.amount<=0;
      let visual=this.nodes.get(node.id);
      if(!visual||visual.empty!==empty||visual.node.kind!==node.kind){
        if(visual)this.scene.remove(visual.root,visual.selection);
        const model=this.models.resource(node.kind,empty,node.tree===undefined?undefined:this.world.features[node.tree]);
        const gy=heightAt(this.world,node.x,node.y);
        model.root.position.set(node.x,gy,node.y);
        model.root.rotation.y=node.id*.51;
        const selection=new Mesh(selectionRing,this.selectionMaterials[4+['gold','wood','oil'].indexOf(node.kind)]);
        const radius=node.radius+12;selection.scale.set(radius,1,radius);
        selection.position.set(node.x,gy+.45,node.y);selection.renderOrder=2;
        this.scene.add(model.root,selection);
        visual={...model,node,empty,selection};this.nodes.set(node.id,visual);
      }
      visual.node=node;
      visual.root.visible=!covered.has(node.id);
      visual.selection.visible=!empty&&(node.id===hoverNode||node.id===selectedNode);
    }
  }

  private shotMesh(pool:ShotMesh[],index:number,geometry:BufferGeometry){
    let mesh=pool[index];
    if(!mesh){
      const material=new MeshBasicMaterial({transparent:true,depthWrite:false});
      this.addHaze(material,{hideInFog:true});
      mesh=new Mesh(geometry,material);
      pool.push(mesh);this.shots.add(mesh);
    }
    mesh.visible=true;
    return mesh;
  }

  private streak(beam:ShotMesh,start:Vector3,end:Vector3,color:number,radius:number,opacity:number) {
    const direction=end.clone().sub(start);
    beam.material.color.setHex(color);beam.material.opacity=opacity;
    beam.position.copy(start).lerp(end,.5);
    beam.scale.set(radius,Math.max(.01,direction.length()),radius);
    beam.quaternion.setFromUnitVectors(up,direction.normalize());
  }

  private updateShots(view:ViewState,time:number,side:Side) {
    let beamIndex=0,shellIndex=0;
    for(const shot of view.shots){
      const duration=shot.duration??.3;
      const t=Math.min(1,Math.max(0,shot.firedAt!==undefined?(time-shot.firedAt)/duration:1-shot.life/duration));
      if(t===1)continue;
      const beam=this.shotMesh(this.beams,beamIndex++,this.shotGeometry);
      const startG=heightAt(this.world,shot.x,shot.y),endG=heightAt(this.world,shot.tx,shot.ty);
      const height=(STATS[shot.kind].air?Math.max(startG,0)+59:startG+(isMobile(shot)?19:40));
      const arc=(f:number)=>new Vector3(
        shot.x+(shot.tx-shot.x)*f,
        height*(1-f)+(endG+5)*f+Math.sin(f*Math.PI)*(shot.kind==='artillery'?85:40),
        shot.y+(shot.ty-shot.y)*f,
      );
      if(shot.mode==='shell'){
        const tip=arc(t);
        this.streak(beam,arc(Math.max(0,t-.09)),tip,0xffbc6b,1.5,.85);
        const core=this.shotMesh(this.shells,shellIndex++,this.shotCore);
        core.material.color.setHex(0xffefb9);
        core.position.copy(tip);core.quaternion.copy(this.camera.quaternion);core.scale.setScalar(3.4);
      }else{
        const color=shot.kind==='medic'?0x8affb5:shot.side===side?0xd4ffe4:0xffa989;
        this.streak(beam,new Vector3(shot.x,height,shot.y),new Vector3(shot.tx,endG+16,shot.ty),color,shot.kind==='medic'?1.2:.7,1-t);
      }
    }
    for(let i=beamIndex;i<this.beams.length;i++)this.beams[i].visible=false;
    for(let i=shellIndex;i<this.shells.length;i++)this.shells[i].visible=false;
  }

  private removeEffect(effect:BattleEffect){
    effect.flare.material.dispose();
    effect.particle?.material.dispose();
    effect.wreck?.rig?.skeleton.dispose();
    this.scene.remove(effect.root);
  }

  private updateEffects(view:ViewState,time:number,animate:boolean) {
    const active=new Set<number>();
    for(const event of view.events||[]){
      if(!(event.type in life))continue;
      const duration=life[event.type as keyof typeof life],age=time-event.time;
      if(age<0||age>=duration||(!animate&&event.type!=='death'))continue;
      active.add(event.id);
      let effect=this.effects.get(event.id);
      if(!effect){
        const root=new Group();
        root.position.set(event.x,heightAt(this.world,event.x,event.y)+1,event.y);
        const wreck=event.type==='death'?this.models.unit(event.kind,event.side,false,view.players.find(p=>p.side===event.side)?.race):undefined;
        if(wreck){
          wreck.root.rotation.y=isMobile(event)?Math.PI/2-event.angle:(event.facing??buildingFacing(event.kind as BuildingKind,event,this.extent.value))*Math.PI/2;
          root.add(wreck.root);
        }
        const color=event.type==='impact'||event.type==='death'?0xffae69:0xa6ffcf;
        const material=new MeshBasicMaterial({color,transparent:true,depthWrite:false});
        this.addHaze(material,{hideInFog:true});
        const flare=new Mesh(this.effectRing,material);
        flare.position.y=1;root.add(flare);
        let particle:ShotMesh|undefined;
        if(this.particleTexture){
          const heavy=event.kind==='artillery'||event.kind==='tank';
          const frame=event.type==='death'?0:event.type==='impact'?heavy?1:2:3;
          const particleMaterial=new MeshBasicMaterial({
            color:frame===3?0xa6ffcf:0xffffff,map:this.particleTexture,transparent:true,depthWrite:false,
          });
          this.addHaze(particleMaterial,{hideInFog:true});
          particle=new Mesh(particlePlanes[frame],particleMaterial);
          particle.renderOrder=2;
          root.add(particle);
        }
        effect={root,flare,particle,wreck};
        this.scene.add(root);this.effects.set(event.id,effect);
      }
      const {flare,particle,wreck}=effect,t=age/(event.type==='death'?.55:duration);
      flare.visible=t<1;
      flare.scale.setScalar((8+Math.min(1,t)*24)*(event.kind==='artillery'?2:1));
      flare.material.opacity=.58*Math.max(0,1-t);
      if(particle){
        const death=event.type==='death',progress=age/(death?duration*.77:duration);
        particle.visible=progress<1;
        particle.position.set(death?progress*14:0,6+progress*(death?32:11),0);
        particle.quaternion.copy(this.camera.quaternion);
        particle.scale.setScalar((13+progress*(death?72:48))*(event.kind==='artillery'?1.55:1));
        particle.material.opacity=(death?.64:.72)*Math.min(1,progress*9)*Math.max(0,1-progress);
      }
      if(wreck){
        const fade=deathPose(age).alpha;
        const fall=Math.min(1,age/.55);
        const collapse=fall*fall*(3-2*fall);
        const model=wreck.root,kind=event.kind as MobileKind;
        if(wreck.rig&&humanoid(kind)){
          poseRig(wreck.rig,kind,{state:'death',weight:0,travel:0,time,id:event.unit,aim:0,recoil:0,turn:0,animate:false,fall:collapse});
          model.rotation.x=collapse*1.39;
          model.position.y=collapse*3-24*(1-fade);
        }else{
          model.rotation.x=collapse*.26;
          model.scale.y=1-collapse*(isMobile(event)?.48:.64);
          model.position.y=-24*(1-fade);
        }
      }
    }
    for(const [id,effect] of this.effects)if(!active.has(id)){
      this.removeEffect(effect);this.effects.delete(id);
    }
  }

  private updatePreview(view:ViewState,side:Side,placement:BuildPlacement|null) {
    if(!placement){
      if(this.construction)this.construction.model.root.visible=false;
      return;
    }
    const {kind,point,facing}=placement;
    if(!this.construction||this.construction.kind!==kind||this.construction.side!==side){
      if(this.construction)this.scene.remove(this.construction.model.root);
      const model=this.models.unit(kind,side,true,view.players.find(p=>p.side===side)?.race);
      this.scene.add(model.root);this.construction={kind,side,model};
    }
    const root=this.construction.model.root;
    root.visible=true;root.position.set(point.x,heightAt(this.world,point.x,point.y)+1,point.y);
    root.rotation.y=facing*Math.PI/2;
    this.models.preview.color.setHex(placementError(side,kind,point,view.units,view.nodes,view.visible,facing,harvestLand(this.world,view.nodes),view.oilWells,false,this.world)?0xff705a:0x83f5bb);
  }

  private addDynamicLight(camera:Camera,x:number,y:number,z:number,radius:number,r:number,g:number,b:number,intensity:number){
    if(intensity<=.02||radius<=1)return;
    // 只收集当前屏幕附近的可见战火／自发光光源，按亮度与屏幕距离择优保留前 32 盏。
    const dx=x-camera.x,dz=z-camera.y;
    const span=Math.max(camera.width,camera.height)/Math.max(.35,camera.zoom)*.85+radius;
    if(dx*dx+dz*dz>span*span)return;
    const score=intensity*radius/(Math.hypot(dx,dz)+120);
    let slot=this.dynamicLightCount;
    if(slot<MAX_BATTLE_LIGHTS){
      this.dynamicLightCount++;
    }else{
      let worst=0;
      for(let i=1;i<MAX_BATTLE_LIGHTS;i++)if(this.dynamicScores[i]<this.dynamicScores[worst])worst=i;
      if(score<=this.dynamicScores[worst])return;
      slot=worst;
    }
    this.dynamicScores[slot]=score;
    const dst=this.dynamicLights[slot];
    dst.x=x;dst.y=y;dst.z=z;dst.radius=radius;dst.r=r;dst.g=g;dst.b=b;dst.intensity=intensity;
  }

  private collectDynamicLights(view:ViewState,camera:Camera,time:number,animate:boolean,side:Side){
    this.dynamicLightCount=0;
    if(this.gi.quality==='off')return;
    // 1) 爆炸、受击、治疗与建造完成的强动态闪光
    for(const event of view.events||[]){
      if(!(event.type in life))continue;
      const duration=life[event.type as keyof typeof life],age=time-event.time;
      if(age<0||age>=duration||(!animate&&event.type!=='death'))continue;
      const fade=Math.max(0,1-age/(event.type==='death'?.65:duration));
      if(fade<=.02)continue;
      const pulse=fade*fade;
      if(event.type==='impact'||event.type==='death'){
        const heavy=event.kind==='artillery'||event.kind==='mech'||event.kind==='behemoth'||event.kind==='colossus'||!isMobile(event);
        this.addDynamicLight(camera,event.x,heavy?28:18,event.y,heavy?210:135,1.0,.52,.18,(heavy?3.4:2.2)*pulse);
      }else{
        this.addDynamicLight(camera,event.x,20,event.y,115,.30,.98,.72,1.65*pulse);
      }
    }
    // 2) 飞行炮弹火球、激光束与医疗光束实时照亮沿途地形与装甲
    for(const shot of view.shots){
      const duration=shot.duration??.3;
      const t=Math.min(1,Math.max(0,shot.firedAt!==undefined?(time-shot.firedAt)/duration:1-shot.life/duration));
      if(t>=1)continue;
      const height=STATS[shot.kind].air?59:isMobile(shot)?19:40;
      if(shot.mode==='shell'){
        const px=shot.x+(shot.tx-shot.x)*t;
        const py=height*(1-t)+8*t+Math.sin(t*Math.PI)*(shot.kind==='artillery'?85:40);
        const pz=shot.y+(shot.ty-shot.y)*t;
        this.addDynamicLight(camera,px,py,pz,shot.kind==='artillery'?155:105,1.0,.68,.28,shot.kind==='artillery'?2.2:1.45);
      }else{
        const fade=1-t;
        const medic=shot.kind==='medic';
        const r=medic?.35:shot.side===side?.48:1.0;
        const g=medic?.98:shot.side===side?.96:.52;
        const b=medic?.76:shot.side===side?.82:.30;
        // 枪口闪光 + 光束落点照亮
        this.addDynamicLight(camera,shot.x,height+4,shot.y,85,r,g,b,(medic?1.2:1.5)*fade);
        this.addDynamicLight(camera,shot.tx,18,shot.ty,95,r,g,b,(medic?1.35:1.65)*fade);
      }
    }
    // 3) 运作中的建筑能量核心、受损火光与高能单位灯槽柔和环境照明
    for(const visual of this.units.values()){
      const u=visual.unit;
      if(!isMobile(u)){
        const damaged=u.hp/u.maxHp<.45,producing=u.activity==='produce',energy=u.kind==='powerplant'||u.kind==='research'||u.kind==='base';
        if(damaged){
          const flicker=.78+.22*Math.sin(time*14+u.id);
          this.addDynamicLight(camera,visual.point.x,visual.height*.6+10,visual.point.y,110,1.0,.42,.15,1.15*flicker);
        }else if(producing||energy){
          const glow=.86+.14*Math.sin(time*3.2+u.id);
          const race=view.players.find(p=>p.side===u.side)?.race;
          const r=race==='stellar'?.42:race==='brood'?.45:.40;
          const g=race==='stellar'?.88:race==='brood'?.95:.92;
          const b=race==='stellar'?1.0:race==='brood'?.35:.95;
          this.addDynamicLight(camera,visual.point.x,visual.height*.7+12,visual.point.y,105,r,g,b,(producing?.68:.44)*glow);
        }
      }else if(u.kind==='mech'||u.kind==='colossus'||u.kind==='prism'){
        this.addDynamicLight(camera,visual.point.x,26,visual.point.y,78,.36,.90,1.0,.52);
      }
    }
    this.gi.setDynamicLights(this.dynamicLights,this.dynamicLightCount);
  }

  draw(view:ViewState,camera:Camera,dpr:number,now:number,dt:number,animate:boolean,side:Side,placement:BuildPlacement|null,selected:ReadonlySet<number>=noSelection,hoverNode:number|null=null,selectedNode:number|null=null,showRanges=false) {
    if(camera.width!==this.viewportWidth||camera.height!==this.viewportHeight||dpr!==this.ratio){
      this.viewportWidth=camera.width;this.viewportHeight=camera.height;this.ratio=dpr;
      this.gl.setPixelRatio(dpr);this.gl.setSize(camera.width,camera.height,false);
    }
    this.syncCamera(camera);
    if(now-this.lastShadow>=1000/this.shadowHz-1){
      this.followSun(camera);
      this.gl.shadowMap.needsUpdate=true;
      this.lastShadow=now;
    }
    if(view.visible!==this.fogView?.visible||view.explored!==this.fogView.explored){
      this.fogView=view;
      let changed=false;
      const hazeData=this.hazeData;
      for(let i=0;i<hazeData.length;i++){
        const value=view.visible[i]?0:view.explored[i]?175:255;
        if(hazeData[i]!==value){hazeData[i]=value;changed=true;}
      }
      if(changed)this.haze.value.needsUpdate=true;
    }
    this.ambient.value=animate?now/1000:0;
    const time=this.clock.advance(view.time,dt,!!view.winner);
    this.updateUnits(view,camera,dt,time,animate,selected,showRanges);
    this.updateNodes(view,hoverNode,selectedNode);
    this.updateEffects(view,time,animate);
    this.updateShots(view,time,side);
    this.updatePreview(view,side,placement);
    this.collectDynamicLights(view,camera,time,animate,side);
    this.gi.render(this.scene,this.camera);
  }

  unitAnchor(unit:VisibleUnit) {
    const visual=this.units.get(unit.id);
    if(visual)return {point:visual.point,ground:visual.altitude,top:visual.altitude+visual.height*Math.max(.17,unit.construction)};
    return {point:unit,ground:STATS[unit.kind].air?57:0,top:STATS[unit.kind].air?75:32};
  }

  healthAnchor(unit:VisibleUnit,view:Camera):Point {
    const visual=this.units.get(unit.id);
    if(!visual)return view.worldToScreen(unit,STATS[unit.kind].air?75:32);
    const anchor=view.worldToScreen(visual.point,visual.altitude);
    const projectBounds=(bounds:Box3,matrix:Matrix4)=>{
      for(let i=0;i<8;i++){
        this.anchorCorner.set(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z);
        this.anchorCorner.applyMatrix4(matrix).project(this.camera);
        anchor.y=Math.min(anchor.y,(1-this.anchorCorner.y)*view.height/2);
      }
    };
    visual.root.traverse(object=>{
      if(!(object instanceof Mesh))return;
      const geometry=object.geometry;
      if(!(object instanceof SkinnedMesh)){
        if(geometry.boundingBox)projectBounds(geometry.boundingBox,object.matrixWorld);
        return;
      }
      // 按骨骼缓存包围盒，只在首次使用共用几何时读取顶点；之后随当前姿态投影。
      // 软连接顶点纳入所有正权重骨骼，其混合位置仍在这些包围盒的凸包内。
      let boxes=this.skinBounds.get(geometry);
      if(!boxes){
        boxes=new Map();
        const {position,skinIndex,skinWeight}=geometry.attributes;
        for(let i=0;i<position.count;i++){
          this.anchorCorner.fromBufferAttribute(position,i);
          for(let j=0;j<4;j++)if(skinWeight.getComponent(i,j)>0){
            const joint=skinIndex.getComponent(i,j);
            let box=boxes.get(joint);
            if(!box){box=new Box3();boxes.set(joint,box);}
            box.expandByPoint(this.anchorCorner);
          }
        }
        this.skinBounds.set(geometry,boxes);
      }
      for(const [joint,box] of boxes){
        this.anchorMatrix.multiplyMatrices(object.matrixWorld,object.bindMatrixInverse)
          .multiply(object.skeleton.bones[joint].matrixWorld).multiply(object.skeleton.boneInverses[joint]).multiply(object.bindMatrix);
        projectBounds(box,this.anchorMatrix);
      }
    });
    return anchor;
  }

  nodeHeight(id:number) {return this.nodes.get(id)?.height??0;}

  reset(){
    for(const visual of this.units.values())this.removeUnit(visual);
    this.units.clear();
    for(const visual of this.nodes.values())this.scene.remove(visual.root,visual.selection);
    this.nodes.clear();
    for(const effect of this.effects.values())this.removeEffect(effect);
    this.effects.clear();
    this.motion=new UnitMotion();
    this.clock=new AnimationClock();
    this.lastShadow=-Infinity;
    this.gi.resetHistory();
  }

  pick(screen:Point,view:Camera):ScenePick|null {
    this.syncCamera(view);
    this.pointer.set(screen.x/view.width*2-1,1-screen.y/view.height*2);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    // Avoid testing meshes far from the cursor, especially on crowded multiplayer maps.
    const roots:Group[]=[];
    const ids=new Map<Object3D,ScenePick>();
    const consider=(root:Group,point:Point,elevation:number,radius:number,id:ScenePick)=>{
      const center=view.worldToScreen(point,elevation);
      if(Math.abs(screen.x-center.x)>radius*view.zoom||Math.abs(screen.y-center.y)>radius*view.zoom)return;
      roots.push(root);ids.set(root,id);
    };
    for(const [id,visual] of this.units)consider(visual.root,visual.point,visual.altitude+visual.height/2,STATS[visual.unit.kind].size*.62,{unit:id});
    for(const [id,visual] of this.nodes)if(!visual.empty&&visual.root.visible)consider(visual.root,visual.node,heightAt(this.world,visual.node.x,visual.node.y)+visual.height/2,70,{node:id});
    for(const hit of this.raycaster.intersectObjects(roots,true)){
      for(let object=hit.object.parent;object;object=object.parent){
        const id=ids.get(object);
        if(id)return id;
      }
    }
    return null;
  }
}
