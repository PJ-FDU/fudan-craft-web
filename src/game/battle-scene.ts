import {
  AmbientLight, Box3, BufferAttribute, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DataTexture,
  DirectionalLight, Group, HemisphereLight, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  OrthographicCamera, PCFShadowMap, PlaneGeometry, Raycaster, RedFormat, RingGeometry, Scene, ShaderMaterial,
  ShapeUtils, SkinnedMesh, Texture, Vector2, Vector3, WebGLRenderer, type Object3D,
} from 'three';
import { AnimationClock, UnitMotion, deathPose } from './animation.js';
import { atlasCellGLSL, atlasSamplingGLSL, battleAtlas, factionDetailTexture } from './battle-materials.js';
import { battleLighting } from './battle-lighting.js';
import { BattleGI, type LightingQuality } from './battle-gi.js';
import { buildingFacing,buildingSize,type BuildPlacement } from './building-layout.js';
import { turnToward, type Camera } from './camera.js';
import { oilNodeAt, visibleOilPipes } from './oil.js';
import { oilPipeMaterials,oilPipeModel,type OilPipeTextures } from './oil-pipe-model.js';
import { placementError } from './engine.js';
import { BattleModels, natureGeometry, type BattleModel } from './models-3d.js';
import { humanoid,poseRig } from './unit-rig.js';
import { weapon } from './weapons.js';
import { TILE, gridSize, distance } from './pathfinding.js';
import { COLORS, RESOURCE_INFO, STATS, isMobile, type BuildingKind, type MobileKind, type Point, type ResourceNode, type Side, type ViewState } from './types.js';
import { getWorld,type WorldData,type Feature } from './world.js';
import { waterContour } from './terrain-shapes.js';
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
  activityLamp?: Mesh<BufferGeometry,MeshBasicMaterial>;
}
interface NodeVisual extends BattleModel { node: ResourceNode; empty: boolean; selection:Mesh<BufferGeometry,MeshBasicMaterial>; }
interface BattleEffect {root:Group;flare:ShotMesh;wreck?:BattleModel}
export type ScenePick = {unit: number} | {node: number};
type ShotMesh = Mesh<BufferGeometry,MeshBasicMaterial>;
interface SceneMaterial {
  wind?:boolean;
  ground?:{roads:DataTexture;shade:Texture};
  water?:boolean;
  hideInFog?:boolean|'solid';
}

const border = 760;
const groundPlane = new PlaneGeometry(1,1).rotateX(-Math.PI/2);
const shadowPlane = new PlaneGeometry(1,1).rotateX(-Math.PI/2);
const selectionRing = new RingGeometry(.8,1,96).rotateX(-Math.PI/2);
const noSelection:ReadonlySet<number>=new Set();
const up = new Vector3(0,1,0);
const sunOffset = new Vector3(-598,1150,-462);
const initialYaw = -.39;
const groundTilt = .62;
const life = {impact:.43,heal:.48,spawn:.85,complete:.85,death:3.2};

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
  private pipes=new Map<string,Group>();
  private pipeMaterials:ReturnType<typeof oilPipeMaterials>;
  private effects=new Map<number,BattleEffect>();
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
  private shadowMaterial=new ShaderMaterial({
    transparent:true,depthWrite:false,
    vertexShader:`varying vec2 shadowUv;
      void main(){shadowUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec2 shadowUv;
      void main(){float fog=1.0-smoothstep(.07,.50,length(shadowUv-.5));
        gl_FragColor=vec4(.032,.036,.028,fog*.27);}`,
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
  set lightingQuality(value:LightingQuality){this.gi.quality=value;}
  private shadowHz=30;
  setShadowQuality(size:number,hz:number){
    size=Math.min(size,this.gl.capabilities.maxTextureSize);this.shadowHz=hz;
    if(this.sun.shadow.mapSize.x===size)return;
    this.sun.shadow.map?.dispose();this.sun.shadow.map=null;
    this.sun.shadow.mapSize.set(size,size);this.gl.shadowMap.needsUpdate=true;this.lastShadow=-Infinity;
  }

  constructor(canvas:HTMLCanvasElement,context:WebGL2RenderingContext,atlasImage:HTMLImageElement,unitAtlas:HTMLImageElement,factionAtlas:HTMLImageElement,pipeTextures:OilPipeTextures,private world:WorldData=getWorld(),factionDetail?:HTMLImageElement) {
    this.gl=new WebGLRenderer({canvas,context,antialias:true,alpha:false,powerPreference:'high-performance'});
    const anisotropy=this.gl.capabilities.getMaxAnisotropy();
    this.pipeMaterials=oilPipeMaterials(pipeTextures,anisotropy);
    this.atlas=battleAtlas(atlasImage,unitAtlas,factionAtlas,anisotropy);
    this.models=new BattleModels(this.atlas,factionDetail&&factionDetailTexture(factionDetail,anisotropy));
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
    this.gi.quality=innerWidth<700?'off':'balanced';

    this.scene.add(this.landscape);
    for(const material of [this.models.solid,...Object.values(this.models.lamps),...this.models.teams])this.addHaze(material);
    this.addHaze(this.models.forest,{wind:true});
    for(const material of Object.values(this.pipeMaterials))this.addHaze(material,{hideInFog:'solid'});
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

  setWorld(world:WorldData){
    if(this.world.id===world.id&&this.world.revision===world.revision)return;
    this.reset();
    // 只释放本地图拥有的几何、材质和纹理；全局地面几何与资产图集继续复用。
    const materials=new Set<MeshStandardMaterial>();
    this.landscape.traverse(object=>{
      if(object instanceof Mesh){
        if(object.geometry!==groundPlane)object.geometry.dispose();
        for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);
      }
    });
    for(const material of materials)material.dispose();
    for(const texture of this.landscapeTextures)texture.dispose();
    this.landscapeTextures=[];this.landscape.clear();this.world=world;
    this.resizeHaze();this.buildLandscape();this.lastShadow=-Infinity;this.fogView=undefined;
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
    const chunks=new Map<string,Feature[]>();
    for(const feature of this.world.features){
      if(feature.kind==='water'){this.addWater(feature);continue;}
      if(this.world.deposits&&isTree(feature))continue;
      const key=`${Math.floor(feature.x/512)}:${Math.floor(feature.y/512)}`;
      const chunk=chunks.get(key)??[];
      chunk.push(feature);chunks.set(key,chunk);
    }
    const vegetation=new MeshStandardMaterial({map:this.atlas,vertexColors:true,roughness:1});
    this.addHaze(vegetation,{wind:true});
    for(const chunk of chunks.values()){
      const geometry=natureGeometry(chunk);
      if(geometry){
        const mesh=new Mesh(geometry,vegetation);
        mesh.castShadow=mesh.receiveShadow=true;
        this.landscape.add(mesh);
      }
    }
  }

  private addHaze(material:MeshStandardMaterial|MeshBasicMaterial,options:SceneMaterial={}) {
    const {wind,ground,water,hideInFog}=options;
    // 组合材质钩子，保留模型 PBR 参数，同时应用战争迷雾。
    const surfaceCompile=material.onBeforeCompile.bind(material),surfaceKey=material.customProgramCacheKey();
    material.customProgramCacheKey=()=>surfaceKey+(ground?':ground':water?':water':wind?':vegetation':hideInFog==='solid'?':hidden-solid':hideInFog?':fx':':fog');
    material.onBeforeCompile=(shader,renderer)=>{
      surfaceCompile(shader,renderer);
      shader.uniforms.battleFog=this.haze;
      shader.uniforms.battleExtent=this.extent;
      shader.uniforms.battleTime=this.ambient;
      if(ground||water)shader.uniforms.paintedAtlas={value:this.atlas};
      if(ground){
        shader.uniforms.roads={value:ground.roads};
        shader.uniforms.groundShade={value:ground.shade};
      }
      shader.vertexShader=`varying vec2 battleUv;
        uniform float battleTime, battleExtent;
      `+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        ${wind?`vec3 original=(modelMatrix*vec4(position,1.0)).xyz;
          float sway=smoothstep(15.0,90.0,position.y);
          transformed.x += sway*(sin(battleTime*1.4+original.x*.013+original.z*.008)-sin(original.x*.013+original.z*.008))*2.0;
          transformed.z += sway*sin(battleTime*.9)*1.5;`:''}
      `).replace('#include <project_vertex>',`
        battleUv=(modelMatrix*vec4(transformed,1.0)).xz/battleExtent;
        #include <project_vertex>
      `);
      shader.fragmentShader=`varying vec2 battleUv;
        uniform sampler2D battleFog;
        uniform float battleTime, battleExtent;
        ${ground||water?atlasSamplingGLSL:''}
        ${ground?`uniform sampler2D roads;
          uniform sampler2D groundShade;`:''}
      `+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        ${ground?`vec2 fieldUV=battleUv*battleExtent*(17.5/4096.0);
          vec3 grass=paintGround(${atlasCellGLSL('grass')},fieldUV);
          vec3 dirt=paintGround(${atlasCellGLSL('earth')},fieldUV*.77);
          float edge=sin(battleUv.x*425.0+battleUv.y*293.0)*cos(battleUv.y*507.0-battleUv.x*165.0);
          float road=smoothstep(.13,.88,texture2D(roads,battleUv).r+edge*.12+(grass.g-.21)*.47);
          float shade=sin(battleUv.x*57.0+sin(battleUv.y*33.0)*1.55)*cos(battleUv.y*62.0);
          vec3 field=mix(vec3(.075,.119,.055),grass*.76,.77)*(1.0+shade*.24);
          vec3 trail=mix(vec3(.178,.137,.088),dirt*vec3(.72,.89,1.13),.62)*(1.0+shade*.16);
          float canopy=texture2D(groundShade,battleUv).a;
          diffuseColor.rgb*=mix(max(field,vec3(.018)),trail,road)*(1.0-canopy*.34);`:''}
        ${water?`vec2 ripples=battleUv*battleExtent*(27.0/4096.0)+battleTime*vec2(.007,-.008);
          diffuseColor.rgb*=vec3(.09,.18,.21)+paintGround(${atlasCellGLSL('water')},ripples)*1.5;`:''}
      `).replace('#include <opaque_fragment>',`
        vec2 fogUv=clamp(battleUv,0.0,1.0), kernel=vec2(15.56/battleExtent);
        float battlefieldHaze=texture2D(battleFog,fogUv).r*.56
          +(texture2D(battleFog,fogUv+kernel).r+texture2D(battleFog,fogUv-kernel).r)*.22;
        ${ground?`vec2 outside=max(-battleUv,battleUv-1.0);
          battlefieldHaze=mix(battlefieldHaze,1.0,smoothstep(0.0,.022,max(outside.x,outside.y)));`:''}
        outgoingLight=mix(outgoingLight,vec3(.0028,.0075,.0058),battlefieldHaze*.993);
        ${hideInFog==='solid'?'if(battlefieldHaze>.28) discard;':hideInFog?'diffuseColor.a *= 1.0-smoothstep(.05,.28,battlefieldHaze);':''}
        #include <opaque_fragment>
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
    const mesh=new Mesh(groundPlane,ground);
    mesh.scale.set(extent+border*2,1,extent+border*2);
    mesh.position.set(extent/2,0,extent/2);
    mesh.receiveShadow=true;
    return mesh;
  }

  private addWater(feature:Feature) {
    const rings=feature.outline
      ?[{radius:1.045,color:0x6b7555,height:.6},{radius:1,color:0x779d90,height:1},{radius:.965,color:0x74949a,height:1.6}]
      :[{radius:1.08,color:0x605c46,height:.6},{radius:1,color:0x92bdaa,height:1.0},{radius:.91,color:0xa4c9c6,height:1.6}];
    for(const ring of rings){
      const positions=[0,ring.height,0],indices:number[]=[];
      const contour=waterContour(feature,ring.radius);
      for(let i=0;i<contour.length;i++){
        positions.push(contour[i].x,ring.height,contour[i].y);
        indices.push(0,(i+1)%contour.length+1,i+1);
      }
      // 弯河的岸线是凹多边形，中心扇形会把河湾内的陆地误画成水。
      if(feature.river){
        indices.length=0;
        for(const [a,b,c] of ShapeUtils.triangulateShape(contour.map(p=>new Vector2(p.x,p.y)),[]))
          indices.push(a+1,c+1,b+1);
      }
      const surface=new BufferGeometry();
      surface.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
      if(feature.outline&&ring.radius<=1){
        const colors=[.43,.58,.62];
        for(let i=0;i<contour.length;i++)colors.push(.86,1,.92);
        surface.setAttribute('color',new BufferAttribute(new Float32Array(colors),3));
      }
      surface.setIndex(indices);
      surface.computeVertexNormals();
      const material=new MeshStandardMaterial({color:ring.color,roughness:.46,vertexColors:!!feature.outline&&ring.radius<=1});
      this.addHaze(material,{water:ring.radius<=1});
      const mesh=new Mesh(surface,material);
      mesh.position.set(feature.x+(feature.waterRadii?0:16),0,feature.y+(feature.waterRadii?0:16));
      mesh.receiveShadow=true;
      this.landscape.add(mesh);
    }
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
    visual.activityLamp?.material.dispose();
    this.scene.remove(visual.root,visual.shadow,visual.selection,visual.range, ...(visual.activityLamp?[visual.activityLamp]:[]));
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
        if(!isMobile(unit)){
          const material=new MeshBasicMaterial({transparent:true,depthWrite:false});
          this.addHaze(material,{hideInFog:true});
          const activityLamp=new Mesh(this.shotCore,material);
          this.scene.add(activityLamp);
          visual.activityLamp=activityLamp;
        }
      }
      const snap=distance(visual.point,unit)>=160, mix=snap?1:1-Math.exp(-30*dt);
      visual.point.x+=(unit.x-visual.point.x)*mix;
      visual.point.y+=(unit.y-visual.point.y)*mix;
      visual.unit=unit;
      const heading=visual.angle;
      visual.angle=snap?unit.angle:turnToward(heading,unit.angle,dt*(stat.air?7:stat.size>80?5:12));
      visual.altitude=stat.air?57+(animate?Math.sin(time*2.1+unit.id)*3:0):0;
      const root=visual.root;
      root.position.set(visual.point.x,visual.altitude,visual.point.y);
      visual.shadow.position.set(visual.point.x+5+visual.altitude*.3,.26,visual.point.y-4);
      visual.selection.position.set(visual.point.x,.4,visual.point.y);
      visual.selection.visible=selected.has(unit.id);
      visual.range.position.copy(visual.selection.position);
      visual.range.visible=selected.has(unit.id)&&showRanges&&stat.range>0;
      const yaw=isMobile(unit)||packed(unit)?Math.PI/2-visual.angle:(unit.facing??buildingFacing(unit.kind as BuildingKind,unit,this.extent.value))*Math.PI/2;
      root.rotation.set(0,yaw,0);
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
      const lamp=visual.activityLamp;
      if(lamp){
        const damaged=unit.hp/unit.maxHp<.5,building=unit.construction<1,producing=unit.activity==='produce';
        lamp.visible=animate&&(damaged||building||producing);
        if(lamp.visible){
          const beat=(Math.sin(time*(damaged?9:5)+unit.id)+1)/2;
          lamp.position.set(visual.point.x+stat.radius*.28,visual.height*Math.max(.17,unit.construction)+2,visual.point.y+stat.radius*.24);
          lamp.quaternion.copy(this.camera.quaternion);
          lamp.scale.setScalar(3+beat*3);
          lamp.material.color.setHex(damaged?0xff6e32:building?0xffc877:0xafffdc);
          lamp.material.opacity=.42+beat*.51;
        }
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
        model.root.position.set(node.x,0,node.y);
        model.root.rotation.y=node.id*.51;
        const selection=new Mesh(selectionRing,this.selectionMaterials[4+['gold','wood','oil'].indexOf(node.kind)]);
        const radius=node.radius+12;selection.scale.set(radius,1,radius);
        selection.position.set(node.x,.4,node.y);selection.renderOrder=2;
        this.scene.add(model.root,selection);
        visual={...model,node,empty,selection};this.nodes.set(node.id,visual);
      }
      visual.node=node;
      visual.root.visible=!covered.has(node.id);
      visual.selection.visible=!empty&&(node.id===hoverNode||node.id===selectedNode);
    }
  }

  private updatePipes(view:ViewState){
    const visible=new Set<string>();
    for(const {well,refinery} of visibleOilPipes(view)){
      const key=`${well.id}:${refinery.id}`;
      visible.add(key);
      if(this.pipes.has(key))continue;
      const pipe=oilPipeModel(well,refinery,this.pipeMaterials,this.world.land);
      this.pipes.set(key,pipe);this.scene.add(pipe);
    }
    for(const [key,pipe] of this.pipes)if(!visible.has(key)){
      this.removePipe(pipe);this.pipes.delete(key);
    }
  }

  private removePipe(pipe:Group){
    for(const part of pipe.children)if(part instanceof Mesh)part.geometry.dispose();
    this.scene.remove(pipe);
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
      const height=STATS[shot.kind].air?59:isMobile(shot)?19:40;
      const arc=(f:number)=>new Vector3(
        shot.x+(shot.tx-shot.x)*f,
        height*(1-f)+5*f+Math.sin(f*Math.PI)*(shot.kind==='artillery'?85:40),
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
        this.streak(beam,new Vector3(shot.x,height,shot.y),new Vector3(shot.tx,16,shot.ty),color,shot.kind==='medic'?1.2:.7,1-t);
      }
    }
    for(let i=beamIndex;i<this.beams.length;i++)this.beams[i].visible=false;
    for(let i=shellIndex;i<this.shells.length;i++)this.shells[i].visible=false;
  }

  private removeEffect(effect:BattleEffect){
    effect.flare.material.dispose();
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
        root.position.set(event.x,1,event.y);
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
        effect={root,flare,wreck};
        this.scene.add(root);this.effects.set(event.id,effect);
      }
      const {flare,wreck}=effect,t=age/(event.type==='death'?.55:duration);
      flare.visible=t<1;
      flare.scale.setScalar((8+Math.min(1,t)*24)*(event.kind==='artillery'?2:1));
      flare.material.opacity=.58*Math.max(0,1-t);
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
    root.visible=true;root.position.set(point.x,1,point.y);
    root.rotation.y=facing*Math.PI/2;
    this.models.preview.color.setHex(placementError(side,kind,point,view.units,view.nodes,view.visible,facing,harvestLand(this.world,view.nodes),view.oilWells)?0xff705a:0x83f5bb);
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
    this.updatePipes(view);
    this.updateEffects(view,time,animate);
    this.updateShots(view,time,side);
    this.updatePreview(view,side,placement);
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
    for(const pipe of this.pipes.values())this.removePipe(pipe);
    this.pipes.clear();
    for(const visual of this.units.values())this.removeUnit(visual);
    this.units.clear();
    for(const visual of this.nodes.values())this.scene.remove(visual.root,visual.selection);
    this.nodes.clear();
    for(const effect of this.effects.values())this.removeEffect(effect);
    this.effects.clear();
    this.motion=new UnitMotion();
    this.clock=new AnimationClock();
    this.lastShadow=-Infinity;
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
    for(const [id,visual] of this.nodes)if(!visual.empty&&visual.root.visible)consider(visual.root,visual.node,visual.height/2,70,{node:id});
    for(const hit of this.raycaster.intersectObjects(roots,true)){
      for(let object=hit.object.parent;object;object=object.parent){
        const id=ids.get(object);
        if(id)return id;
      }
    }
    return null;
  }
}
