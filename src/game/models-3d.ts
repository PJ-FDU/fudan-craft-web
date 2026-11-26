import { factionParts, factionProfile } from './faction-models.js';
import {
  Box3, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3,
  type Texture,
} from 'three';
import { bark, baseSlab, dark, glass, lightArmor, mineral, orange, paint, Parts, steel, stone, tread, type Size } from './model-parts.js';
import { ceramicArmor, circuitry, federal, service, strut } from './faction-model-parts.js';
import { mobileModel } from './mobile-models.js';
import { modelSurface, natureSurface, sculptSurface } from './model-surface.js';
import type { BlenderAssets, BlenderSurface } from './blender-assets.js';
import { heightAt } from './terrain-height.js';
import type { WorldData } from './world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { humanoid, UnitRig, type RigDefinition } from './unit-rig.js';
import { buildingSize } from './building-layout.js';
import { COLORS, STATS, isMobile, type BuildingKind, type Kind, type MobileKind, type ResourceKind, type Race, type Side } from './types.js';

export interface ModelGeometry {
  bounds:Box3;
  rig?:RigDefinition;
  body: [BufferGeometry | undefined, BufferGeometry | undefined, BufferGeometry | undefined];
  moving: {parts: ModelGeometry['body']; at: Size}[];
  surface?:BlenderSurface;
}

export interface BattleModel {
  root: Group;
  moving: Group[];
  height: number;
  rig?:UnitRig;
}

const lampMaterial=(color:number,emissive:number,intensity:number)=>
  new MeshStandardMaterial({color,emissive,emissiveIntensity:intensity,roughness:.24});
const factionLampRace={federal:'industrial',organic:'brood',crystal:'stellar',expedition:'relay'} as const;

export class BattleModels {
  readonly solid:MeshStandardMaterial;
  readonly forest:MeshStandardMaterial;
  readonly lamps:Record<Race,MeshStandardMaterial>={
    industrial:lampMaterial(0xd7efff,0x78b6ef,1.8),
    brood:lampMaterial(0xffddad,0xff882e,1.2),
    stellar:lampMaterial(0x489fbb,0x179ac6,1.65),
    relay:lampMaterial(0xffefcb,0xffb75e,1.6),
  };
  readonly preview=new MeshStandardMaterial({transparent:true,opacity:.48,depthWrite:false,roughness:.65});
  readonly teams:MeshStandardMaterial[];
  private models=new Map<string,ModelGeometry>();
  private nodes=new Map<string,ModelGeometry>();
  private sculptPalettes=new Map<BlenderSurface,MeshStandardMaterial[]>();

  constructor(atlas:Texture,private factionDetail?:Texture,private assets?:BlenderAssets,
    private configureSurface?:(material:MeshStandardMaterial)=>void){
    this.solid=assets?.manifest.natureAtlas?natureSurface(atlas,assets):modelSurface(atlas,factionDetail,true,assets?.surface);
    this.forest=natureSurface(atlas,assets);
    this.teams=COLORS.slice(1).map(color=>{
      const material=modelSurface(atlas,factionDetail,true,assets?.manifest.natureAtlas?undefined:assets?.surface);
      material.color.set(color);
      material.emissive.set(color);material.emissiveIntensity=.04;
      return material;
    });
  }

  unit(kind:Kind,side:Side,preview=false,race?:Race,packed=false):BattleModel {
    const custom=factionProfile(kind,race),key=kind+(custom?':'+custom[0]:'')+(packed?':packed':'');
    let model=this.models.get(key);
    if(!model){
      const parts=new Parts(),mobile=isMobile({kind});
      const customRig=factionParts(parts,kind,race,packed);
      const rig=customRig??(mobile?mobileModel(parts,kind as MobileKind):undefined);
      const moving=customRig||mobile?[]:buildingParts(parts,kind as BuildingKind);
      model=this.assets
        ?{...this.assets.model(`${race??'industrial'}:${kind}${packed?':packed':''}`,rig),rig}
        :this.compile(parts,moving,rig);
      this.models.set(key,model);
    }
    const visual=this.instantiate(model,side,preview,race??(custom?factionLampRace[custom[0]]:'industrial'));
    const scale=STATS[kind].size/(STATS[kind].speed?68:142);
    const body=visual.root;
    body.scale.setScalar(scale);
    const size=model.bounds.getSize(new Vector3());
    if(!isMobile({kind})){
      const {width,depth}=buildingSize(kind as BuildingKind),bounds=model.bounds;
      const center=bounds.getCenter(new Vector3());
      body.scale.x=Math.min(scale,(width-3)/size.x);
      body.scale.z=Math.min(scale,(depth-3)/size.z);
      body.position.set(-center.x*body.scale.x,0,-center.z*body.scale.z);
    }else if(!STATS[kind].air&&kind!=='mech'){
      // 泰坦的肩甲/武器可伸出寻路圆；逐轴压缩会把重型胸肩挤成瘦长人形。
      // 它保持 size 定义的等比显示，碰撞半径仍由 STATS 独立管理。
      const diameter=STATS[kind].radius*2;
      body.scale.x=Math.min(scale,(diameter+5)/size.x);
      body.scale.z=Math.min(scale,(diameter+18)/size.z);
      if(!humanoid(kind as MobileKind))body.scale.y=Math.min(scale,.92);
    }
    const root=new Group();
    root.add(body);
    return {...visual,root,height:visual.height*body.scale.y};
  }

  resource(kind:ResourceKind,empty:boolean,forest?:{kind:string;size:number}):BattleModel {
    const key=kind+(forest?forest.kind:'')+(empty?'Empty':'');
    let model=this.nodes.get(key);
    if(!model&&this.assets){
      const geometries=forest
        ?[this.assets.nature(`nature:${empty?'stump':forest.kind}`)]
        :kind==='wood'&&!empty&&!this.assets.manifest.natureAtlas
          ?[['oak',-19,7,.9],['pine',24,14,.72],['birch',8,-20,.73]].map(([tree,x,z,scale])=>
            this.assets!.nature(`nature:${tree}`).scale(Number(scale),Number(scale),Number(scale)).translate(Number(x),0,Number(z)))
          :[this.assets.nature(`resource:${kind}${empty?':empty':''}`)];
      const geometry=geometries.length===1?geometries[0]:mergeGeometries(geometries)!;
      if(geometries.length>1)for(const part of geometries)part.dispose();
      geometry.computeBoundingBox();geometry.computeBoundingSphere();
      model={body:[geometry,undefined,undefined],moving:[],bounds:geometry.boundingBox!.clone()};
      this.nodes.set(key,model);
    }
    if(!model){
      const p=new Parts();
      if(empty&&forest){
        p.add('drum',bark,0,4,0,16,8,16);
      }else if(empty&&kind==='wood'){
        p.add('facet',stone,1,2,0,47,11,37);
        p.add('drum',bark,-6,5,5,15,10,15);
      }else if(forest){
        tree(p,forest.kind,0,0,0,88,0);
      }else if(kind==='wood'){
        tree(p,'oak',-19,0,7,90,0);
        tree(p,'pine',24,0,14,72,1);
        tree(p,'birch',8,0,-20,73,2);
        p.add('drum',bark,15,8,29,10,32,10,Math.PI/2,0,.24);
      }else if(kind==='gold'){
        goldDeposit(p,empty);
      }else{
        oilDeposit(p,empty);
      }
      model=this.compile(p,[]);this.nodes.set(key,model);
    }
    const visual=this.instantiate(model,1);
    if(forest){
      visual.root.scale.setScalar(forest.size/100);visual.height*=forest.size/100;
      visual.root.traverse(object=>{if(object instanceof Mesh&&object.material===this.solid)object.material=this.forest;});
    }
    return visual;
  }

  /** Blender 构建直接读取源码几何，不经过实例缩放和动画姿态。 */
  source(kind:Kind,race?:Race,packed=false):ModelGeometry {
    const parts=new Parts(),mobile=isMobile({kind});
    const customRig=factionParts(parts,kind,race,packed);
    const rig=customRig??(mobile?mobileModel(parts,kind as MobileKind):undefined);
    return this.compile(parts,customRig||mobile?[]:buildingParts(parts,kind as BuildingKind),rig);
  }

  private compile(parts:Parts,moving:{parts:Parts;at:Size}[],rig?:RigDefinition):ModelGeometry {
    const bake=(p:Parts,groundOffset=0):ModelGeometry['body']=>[
      p.geometry('solid',groundOffset),p.geometry('team',groundOffset),p.geometry('lamp'),
    ];
    const body=bake(parts);
    const bounds=new Box3();
    for(const geo of body)if(geo?.boundingBox)bounds.union(geo.boundingBox);
    const articulated=moving.map(part=>{
      const pieces=bake(part.parts,part.at[1]);
      const offset=new Vector3(...part.at);
      for(const geo of pieces)if(geo?.boundingBox)bounds.union(geo.boundingBox.clone().translate(offset));
      return {parts:pieces,at:part.at};
    });
    return {body,moving:articulated,bounds,rig};
  }

  private instantiate(model:ModelGeometry,side:Side,preview=false,race:Race='industrial'):BattleModel {
    let surfaces:MeshStandardMaterial[]|undefined;
    if(model.surface){
      const surface=model.surface;
      surfaces=this.sculptPalettes.get(surface);
      if(!surfaces){
        surfaces=[sculptSurface(surface),...COLORS.slice(1).map(color=>{
          const material=sculptSurface(surface);material.color.set(color);
          return material;
        })];
        const light=this.lamps[race];
        surfaces.push(new MeshStandardMaterial({
          map:surface.albedo,emissiveMap:surface.albedo,roughness:.24,
          color:surface.tintLamps?light.color:0xffffff,
          emissive:surface.tintLamps?light.emissive:0xffffff,
          emissiveIntensity:light.emissiveIntensity*(surface.tintLamps?1.55:1.15),
        }));
        for(const material of surfaces)this.configureSurface?.(material);
        this.sculptPalettes.set(model.surface,surfaces);
      }
    }
    const palette=[surfaces?.[0]??this.solid,surfaces?.[side]??this.teams[side-1],surfaces?.at(-1)??this.lamps[race]];
    const addMeshes=(result:Group,geometries:ModelGeometry['body'],rig?:UnitRig)=>{
      geometries.forEach((g,i)=>{
        if(!g)return;
        const material=preview?this.preview:palette[i];
        const mesh=rig?new SkinnedMesh(g,material):new Mesh(g,material);
        if(mesh instanceof SkinnedMesh&&rig){
          mesh.bind(rig.skeleton,new Matrix4());
          const bounds=g.boundingSphere!.clone();
          // Conservative bounds cover posed limbs and keep picking/culling independent of frame history.
          bounds.radius=bounds.radius*1.45+8;
          mesh.boundingSphere=bounds;
        }
        mesh.castShadow=!preview&&i===0;
        mesh.receiveShadow=!preview&&i!==2;
        result.add(mesh);
      });
    };
    const root=new Group();
    const rig=model.rig?new UnitRig(model.rig,root):undefined;
    addMeshes(root,model.body,rig);
    const moving=model.moving.map(part=>{
      const child=new Group();
      addMeshes(child,part.parts);
      child.position.set(...part.at);
      root.add(child);
      return child;
    });
    return {root,moving,height:model.bounds.max.y,rig};
  }

  /** 图鉴拥有独立模型缓存，关闭后释放共享几何与材质；实例骨骼由调用方释放。 */
  dispose(){
    for(const model of [...this.models.values(),...this.nodes.values()]){
      for(const geometry of [...model.body,...model.moving.flatMap(m=>m.parts)])geometry?.dispose();
    }
    for(const material of [this.solid,this.forest,this.preview,...Object.values(this.lamps),...this.teams])material.dispose();
    for(const palette of this.sculptPalettes.values())for(const material of palette)material.dispose();
    this.sculptPalettes.clear();
    this.factionDetail?.dispose();
    this.models.clear();this.nodes.clear();
  }
}

const armor=paint('federalPlate',0xc3d5df,1.2,undefined,.87);

function buildingParts(p:Parts,kind:BuildingKind):{parts:Parts;at:Size}[] {
  if(kind==='oilwell'){
    p.add('bevel',baseSlab,0,4,0,69,8,61);
    p.add('bevel',dark,0,10,0,58,8,51);
    p.box(federal,15,20,0,21,19,27);
    p.box('team',16,24,13,15,5,2);
    p.box(steel,-5,29,0,13,37,15);
    p.add('box',steel,-17,19,0,6,26,6,0,0,-.42);
    p.add('drum',dark,-24,18,0,7,22,7);
    for(const z of [-5,5]){
      strut(p,service,[-12,12,z],[-5,44,z],1.35);
      strut(p,service,[-5,44,z],[2,12,z],1.35);
    }
    p.add('panel',circuitry,16,20,13.7,12,9,1);
    const arm=new Parts();
    arm.add('bevel',armor,-1,0,0,58,7,11,0,0,-.13);
    arm.add('bevel',steel,-28,-5,0,17,21,15);
    arm.box(paint('hazard',0xe6d9c8),25,1,0,12,9,13);
    return [{parts:arm,at:[-5,48,0]}];
  }
  const large=kind==='base',tower=kind==='tower';
  const width=tower?57:large?94:kind==='barracks'?83:90,depth=tower?57:kind==='barracks'?86:82;
  const grille=paint('grille',0xd0e5e0,1.2),hazard=paint('hazard',0xe6d9c8);
  const rounded=large||tower;
  if(kind!=='powerplant'&&kind!=='refinery'&&kind!=='research'){
    p.add(rounded?'octagon':'bevel',baseSlab,0,3,0,width+9,6,depth+10);
    p.add(rounded?'octagon':'bevel',dark,0,8,0,width,8,depth);
    p.box('team',0,11,depth*.47,width*.53,3,2);
  }
  if(tower){
    p.add('drum',federal,0,22,0,38,26,38);
    p.add('drum',armor,0,32,0,44,13,44);
    p.add('ring',service,0,17,0,40,40,2.7,Math.PI/2);
    for(let n=0;n<8;n++){
      const a=n*Math.PI/4,x=Math.sin(a),z=Math.cos(a);
      p.add('panel',steel,x*19,22,z*19,6,18,3,0,a);
      p.add('pin',steel,x*21,39,z*21,2,1,2);
    }
    const barrel=new Parts();
    barrel.add('armorHull',federal,0,6,0,30,15,27);
    barrel.add('armorPlate',ceramicArmor,0,12,3,25,5,22);
    barrel.box('team',0,13,0,23,5,17);
    for(const x of [-7,7]){
      barrel.add('drum',dark,x,7,15,5,33,5,Math.PI/2);
      barrel.add('drum',steel,x,7,30,7,5,7,Math.PI/2);
      barrel.add('drum',dark,x,7,32.7,4,.5,4,Math.PI/2);
      barrel.add('ring',service,x,7,18,6.5,6.5,2.5);
    }
    barrel.add('panel',dark,0,15,5,9,5,8);
    barrel.box('lamp',0,15,9.1,5,2,.7);
    return [{parts:barrel,at:[0,40,0]}];
  }
  if(kind==='research'){
    p.add('octagon',baseSlab,0,4,0,76,8,76);
    p.add('octagon',federal,0,22,0,65,33,65);
    p.add('octagon','team',0,38,0,60,7,60);
    p.add('dome',glass,0,43,0,58,37,58);
    p.add('ring',steel,0,43,0,59,59,12,Math.PI/2);
    for(let n=0;n<8;n++){
      const a=n*Math.PI/4;
      p.add('panel',steel,Math.sin(a)*27,44,Math.cos(a)*27,2,15,3,0,a);
      strut(p,service,[Math.sin(a)*25,53,Math.cos(a)*25],[Math.sin(a)*11,60,Math.cos(a)*11],1.45);
    }
    for(const [x,z] of [[0,-31],[31,0],[0,31],[-31,0]]){
      p.add('armorHull',ceramicArmor,x,14,z,13,18,13);
      p.box('lamp',x,24,z,8,2,8);
    }
    const dish=new Parts();
    dish.add('drum',steel,0,5,0,5,12,5);
    dish.add('drum',lightArmor,0,13,0,30,5,30,.85);
    dish.add('facet','lamp',0,15,4,6,6,6);
    return [{parts:dish,at:[0,55,0]}];
  }
  if(kind==='powerplant'||kind==='refinery'){
    const pipeYaw=kind==='powerplant'?.43:0;
    p.add('bevel',baseSlab,0,2,0,49,4,19,0,pipeYaw);
    p.add('drum',steel,0,15,kind==='powerplant'?0:-3,8,43,8,0,pipeYaw,-Math.PI/2);
    for(const x of [-22,22]){
      const z=kind==='powerplant'?-x*.46:-3;
      p.add('octagon',baseSlab,x,4,z,46,8,46);
      p.add('drum',kind==='powerplant'?federal:service,x,25,z,37,30,37);
      for(const y of [15,34])p.add('drum',dark,x,y,z,39,4.5,39);
      p.add('drum',kind==='powerplant'?glass:armor,x,43,z,30,14,30);
      p.add('drum',steel,x,50,z,30,4,30);
      p.add('drum',kind==='powerplant'?'lamp':orange,x,53,z,17,3,17);
      p.box('team',x,27,z+19,19,5,3);
      p.add('drum',dark,x,24,z+29,8,24,8,Math.PI/2);
      p.add('ring',steel,x,24,z+39,12,12,7);
      for(let n=0;n<8;n++){
        const a=n*Math.PI/4;
        p.add('pin',steel,x+Math.cos(a)*17,37,z+Math.sin(a)*17,2.1,1.3,2.1);
      }
      for(const dx of [-5,5])p.box(steel,x+dx,28,z-19,1,38,1);
      for(let y=11;y<=45;y+=5)p.box(steel,x,y,z-19.5,10,.9,1);
      // 支架、阀轮与回流弯管提供真实遮挡，间接光可在这些结构间反弹。
      p.add('elbow',steel,x+13,17,z+16,13,13,13,0,Math.PI/2);
      p.add('drum',dark,x+18,13,z+16,4,13,4);
      p.add('ring',orange,x,24,z+39.5,8,8,2);
      for(const a of [0,Math.PI/2])p.add('box',steel,x,24,z+40,7,.8,.8,0,0,a);
      for(const dx of [-12,12])p.add('panel',federal,x+dx,10,z+5,4,12,14);
      if(kind==='powerplant'){
        for(const y of [40,46])p.add('ring',service,x,y,z,32,32,2.4,Math.PI/2);
        for(const dx of [-13,13])strut(p,circuitry,[x+dx,35,z+9],[x+dx,48,z+8],2.15);
      }else{
        p.add('drum',service,x+13,26,z-10,5,30,5);
        p.add('elbow',service,x+11,41,z-10,7,7,7,0,0,x>0?Math.PI/2:0);
      }
    }
    p.add('bevel',baseSlab,0,4,30,34,8,23);
    p.add('bevel',grille,0,18,30,29,15,15);
    p.box('lamp',0,19,38,15,3,2);
    p.add('drum',baseSlab,-37,4,-29,17,8,17);
    p.add('drum',steel,-37,32,-29,10,58,10);
    p.add('drum',orange,-37,62,-29,13,4,13);
    p.add('ring',steel,-37,58,-29,13,13,4,Math.PI/2);
    for(const x of [-10,0,10])p.box(steel,x,26,30,1,1,13);
    return [];
  }
  const hangar=kind==='airfield'||kind==='factory'||kind==='barracks',h=large?42:kind==='airfield'?24:34;
  const opening=kind==='factory'?56:kind==='airfield'?50:hangar?38:25;
  p.add(large?'octagon':'armorHull',federal,0,15+h/2,-5,width*.96,h,depth*.87);
  if(kind==='barracks'||kind==='lumbermill'){
    p.add('gable',kind==='lumbermill'?paint('bark',0xc9bcab):armor,0,h+20,-5,width*1.01,21,depth*.98);
    p.box(steel,0,h+31,-5,7,3,depth*.98);
  }else{
    p.add(large?'octagon':'armorHull',ceramicArmor,0,18+h,-8,width,10,depth*.9);
    p.add('bevel',large?lightArmor:steel,0,25+h,-13,width*.76,7,depth*.63);
  }
  p.box(glass,0,h-4,depth*.39,width*.66,8,3);
  for(const x of [-width*.38,width*.38]){
    p.add('armorHull',ceramicArmor,x,kind==='airfield'?23:31,14,width*.23,kind==='airfield'?23:34,depth*.73,0,0,x<0?.064:-.064);
    p.add('box','team',x,h+15,15,10,1.4,34);
    p.box('team',x,h+1,depth*.55,13,6,4);
    p.box('lamp',x,21,depth*.56,8,2,3);
    p.add('panel',service,x,kind==='airfield'?17:25,depth*.48,9,kind==='airfield'?7:12,2.6,-.1);
  }
  p.add('bevel',baseSlab,0,10,depth*.53,opening+7,7,23);
  p.box(kind==='factory'?tread:dark,0,23,depth*.405,opening,23,5);
  p.box(steel,0,35,depth*.46,opening+4,4,8);
  for(const x of [-opening*.45,opening*.45])p.box(armor,x,22,depth*.46,3,23,4);
  if(hangar)for(let y=14;y<34;y+=3.4)p.box(steel,0,y,depth*.44,opening-4,.65,.8);
  // 墙面结构缝、侧窗与屋顶设备让建筑在旋转镜头时仍有可读的层次。
  for(const side of [-1,1]){
    // 附件随墙面的收分贴合，后侧开窗避开前方承重装甲；主楼使用已有正面玻璃。
    const wallX=(y:number,offset:number)=>side*(width*.96*(.5-.1*(y-15)/h)+offset);
    const tilt=side*Math.atan(width*.096/h);
    for(const z of large?[]:[-29,-20]){
      p.add('panel',dark,wallX(24,.4),24,z,1.5,17,6.5,0,0,tilt);
      p.add('panel',glass,wallX(27,1.2),27,z,1,6,5,0,0,tilt);
      p.add('box',steel,wallX(27,1.75),27,z,.7,6,.8,0,0,tilt);
      p.add('pin',steel,wallX(17,1),17,z,1.6,1,1.6,0,0,Math.PI/2+tilt);
    }
    if(kind!=='barracks'&&kind!=='lumbermill'){
      const y=h+25;
      for(const z of [-22,-12,-2])p.box(steel,side*width*.36,h+26,z,1,7,1);
      p.box(steel,side*width*.36,h+29.5,-12,1,1,21);
      p.add('panel',dark,side*width*.26,y+4,-22,14,6,16);
      p.add('drum',steel,side*width*.26,y+7.3,-22,10,1,10);
      p.add('drum',grille,side*width*.26,y+8,-22,8,.7,8);
      for(let n=0;n<6;n++)p.add('box',steel,side*width*.26,y+8.5,-22,1,.6,9,0,n*Math.PI/6);
      p.add('ring',steel,side*width*.26,y+8.4,-22,10.5,10.5,1.4,Math.PI/2);
      p.add('elbow',steel,side*width*.26,y+3,-11,8,8,8,Math.PI/2,0,side<0?Math.PI:0);
      for(const x of [-4,4])p.box(steel,side*width*.26+x,y+1,-10,1,3,7);
    }
  }
  for(const x of [-opening*.4,opening*.4]){
    p.add('pin',dark,x,11,depth*.61,2.8,4,2.8);
    p.add('pin',hazard,x,14,depth*.61,2.8,2,2.8);
  }
  for(const side of [-1,1]){
    const x=side*width*.39;
    p.box(grille,x,h+9,-15,10,9,20);
    p.box(hazard,x,8,depth*.51,11,2.5,4);
    if(!large){
      const back=-5-depth*.435;
      p.add('panel',dark,side*width*.29,h*.55+15,back+.8,15,18,3);
      for(let y=0;y<6;y++)p.add('box',steel,side*width*.29,h*.55+8+y*2.4,back-1,13,.7,1,Math.PI/8);
      p.add('drum',steel,side*width*.38,20,back+1,2,22,2);
      p.add('elbow',steel,side*width*.38,31,back+1,5,5,5,0,0,side<0?Math.PI/2:0);
    }
  }
  if(large)for(const x of [-7,0,7])p.box(glass,x,25,depth*.46,4,13,3);
  if(kind==='airfield'){
    p.add('bevel',dark,0,5,53,60,8,40);
    p.box('team',-24,9,54,2,1,36);
    p.box('team',24,9,54,2,1,36);
    for(const z of [42,55,68])p.box(lightArmor,0,9,z,3,1,7);
  }else if(kind==='lumbermill'){
    for(const x of [-25,-13,0,13,25])p.add('drum',bark,x,15,38,9,34,9,Math.PI/2);
  }else if(kind==='factory'){
    for(const x of [-25,25]){
      p.add('drum',dark,x,h+38,-23,14,38,14);
      p.add('drum',steel,x,h+57,-23,18,5,18);
      p.add('drum',tread,x,h+60,-23,12,2,12);
      for(const y of [h+28,h+47])p.add('ring',service,x,y,-23,15.8,15.8,2.5,Math.PI/2);
      p.add('armorPlate',federal,x,h+38,-23,24,5.2,21);
      strut(p,service,[x,h+25,-4],[x,h+44,-21],2.3);
    }
    p.add('armorHull',federal,0,37,36,61,6,12,-.06);
    for(const x of [-20,-10,0,10,20])p.add('panel',ceramicArmor,x,37.5,41.4,7.8,1.1,1.1);
    p.add('bevel','team',0,h+31,11,24,6,15);
    p.add('bevel',hazard,0,11,depth*.61,43,2.5,6);
  }else if(kind==='barracks'){
    p.add('bevel',dark,0,h+34,4,23,5,35);
    for(const z of [-5,6,17])p.box(lightArmor,0,h+37,z,17,2,2.5);
    p.box('team',0,h+26,depth*.43,17,7,3);
    for(const x of [-18,18])p.add('panel',circuitry,x,h+12,depth*.42,9,6,2);
  }else if(large){
    const antenna=new Parts();
    antenna.add('drum',steel,0,14,0,4,28,4);
    antenna.add('drum',lightArmor,0,25,1,28,6,28,.74);
    antenna.add('facet','lamp',0,29,6,10,8,10);
    strut(antenna,service,[0,13,0],[13,26,3],1.6);
    strut(antenna,service,[0,13,0],[-13,26,3],1.6);
    p.add('octagon',steel,0,h+29,-13,45,13,34);
    p.add('octagon','team',0,h+36,-13,32,5,28);
    return [{parts:antenna,at:[0,h+36,-13]}];
  }else{
    p.add('bevel','team',0,h+25,-17,31,10,24);
    p.box(dark,0,h+31,-17,22,3,16);
    for(const x of [-8,0,8])p.box(steel,x,h+33,-17,2,2,14);
  }
  return [];
}

function tree(p:Parts,kind:string,x:number,y:number,z:number,size:number,seed:number) {
  const s=size/100,phase=seed*2.4;
  const pine=kind==='pine',birch=kind==='birch';
  const trunk=birch?paint('stone',0xe0d8cb):bark;
  p.add('cone',trunk,x,y+31*s,z,(pine?11:13)*s,62*s,10*s,0,phase,.06);
  if(pine){
    const greens=[0xb9c6ab,0xd4ddb0,0xdce8ba,0xe7eebd];
    for(let tier=0;tier<4;tier++){
      const a=phase+tier*.86,w=(66-tier*13)*s,h=(49-tier*3)*s;
      p.add('spruce',paint('pine',greens[tier],1.65),x+Math.sin(a)*2*s,y+(51+tier*15)*s,z+Math.cos(a)*2*s,w,h,w*.82,.035,a,.05*Math.sin(a));
    }
  }else{
    const colors=birch?[0xbcc49c,0xe1dfab,0xf4e3ac]:[0xaac69b,0xc6daae,0xd5e4b0];
    for(let n=0;n<3;n++){
      const a=phase+n*2.1;
      p.add('cone',trunk,x+Math.sin(a)*8*s,y+39*s,z+Math.cos(a)*8*s,7*s,28*s,6*s,.7,a,0);
    }
    for(let n=0;n<6;n++){
      const high=n>=4,a=phase+n*1.57,r=(high?8:18+2*Math.sin(a))*s,w=(high?45:40)*s;
      p.add('crown',paint('leaf',colors[n%3],1.4),x+Math.cos(a)*r,y+(high?78+(n-4)*7:55+n*3)*s,z+Math.sin(a)*r,w,(birch?45:38)*s,w,.27,a,.16);
    }
  }
}

function goldDeposit(p:Parts,empty:boolean){
  const quarryBed=paint('earth',0x7a6e57,.92,[.95,0,.85]);
  const darkSlate=paint('stone',0x6c665b,.92,[.9,.02,.85]);
  const warmRock=paint('stone',0xa99674,.98,[.86,.04,.78]);
  const goldDeep=paint('ore',0xf0b83d,1.5,[.26,.88,.48]);
  const goldRich=paint('ore',0xffda6e,1.62,[.2,.92,.36]);
  const goldGleam=paint('ore',0xfff3be,1.78,[.14,.96,.22]);
  const timber=paint('bark',0x8c6b4c,.95,[.92,0,.75]);
  const iron=paint('serviceSteel',0x99a4a0,.95,[.38,.76,.35]);

  if(empty){
    // Irregular hollowed-out quarry scar with fractured rock walls (no circular base)
    p.add('rockMound',quarryBed,-4,2,2,72,5,54,0,.45,0);
    p.add('rockMound',quarryBed,18,1.8,-10,42,4,36,0,2.1,0);
    p.add('oilPool',paint('earth',0x4d473d,.88,[.96,0,.9]),-2,3.4,1,46,1.6,34,0,.6,0);
    for(const [x,z,w,h,d,ry] of [
      [-26,-11,26,15,20,.45],[22,-16,25,13,18,1.25],[-18,19,21,11,16,2.2],
      [25,10,20,10,16,-.7],[-4,-25,27,13,17,.2],
    ])p.add('facet',darkSlate,x,h*.42,z,w,h,d,.12,ry,.08);
    for(const [x,z,s,ry] of [[-11,7,9,.5],[12,-5,8,1.8],[-4,-10,7,2.4],[14,9,6,.9]])
      p.add('facet',warmRock,x,s*.35,z,s*1.2,s*.7,s,0,ry,0);
    p.add('pin',timber,-14,4.5,14,3.4,24,3.4,1.35,.55,1.2);
    p.add('pin',timber,-7,4,18,3,18,3,1.45,-.35,1.35);
    const spent=paint('ore',0x867650,.82,[.72,.22,.65]);
    p.add('shard',spent,-3,7,-2,6,9,6,.2,.7,-.3);
    p.add('facet',spent,7,5.5,4,6,5,5,0,1.2,0);
    return;
  }

  // Asymmetric multi-lobed geological rock ridge & talus slope (zero circular/oval discs)
  p.add('rockMound',quarryBed,-8,3.2,4,86,8,64,0,.38,0);
  p.add('rockMound',quarryBed,20,2.6,-12,56,7,48,0,2.05,0);
  p.add('rockMound',darkSlate,-10,7.5,-3,66,15,48,0,.55,0);
  p.add('rockMound',warmRock,12,8.5,6,52,14,40,0,1.85,0);

  // Asymmetric rocky escarpment: heavier cliff wall on NW, open rocky talus on SE
  for(const [x,z,w,h,d,ry] of [
    [-34,-12,28,18,22,.5],[-14,-27,32,20,22,.18],[12,-28,27,16,20,1.65],
    [33,-14,26,15,20,1.1],[-31,14,22,12,18,2.2],[28,16,20,11,17,-.7],
  ])p.add('facet',darkSlate,x,h*.42,z,w,h,d,.1,ry,.06);

  // Diagonal geological ore vein: main hero crystal cluster + asymmetric seam outcrops
  p.add('facet',warmRock,-2,15,-3,34,20,28,.15,.8,-.1);
  p.add('shard',goldRich,-1,30,-2,22,48,22,.08,.4,-.1);
  p.add('shard',goldGleam,-9,27,5,15,38,15,.22,1.5,.24);
  p.add('shard',goldDeep,9,25,-8,17,35,17,-.2,2.4,-.26);
  p.add('shard',goldGleam,2,35,-6,10,24,10,-.14,.9,.12);
  p.add('facet',goldRich,-4,19,8,14,12,13,.3,.5,.2);

  for(const [x,y,z,scale,ry,tilt] of [
    [-24,14,6,1.08,.45,.34],
    [22,13,-14,1.02,-.75,-.32],
    [-13,14,-19,1.04,2.5,.28],
    [18,11,12,.88,1.85,-.26],
  ]){
    p.add('facet',warmRock,x,y-4,z,26*scale,18*scale,22*scale,.12,ry,0);
    p.add('shard',goldDeep,x+2,y+9*scale,z+1,16*scale,30*scale,16*scale,tilt*.7,ry,tilt);
    p.add('shard',goldRich,x-4,y+7*scale,z+4,11*scale,22*scale,11*scale,-tilt*.5,ry+1.1,-tilt*.8);
    p.add('shard',goldGleam,x+5,y+5*scale,z-3,8*scale,15*scale,8*scale,tilt*.4,ry+2.1,tilt*.6);
    p.add('facet',goldRich,x-2,y+2,z-5,10*scale,8*scale,9*scale,0,ry,0);
  }

  // Natural ore scree & loose nuggets spilling down the open rocky slope
  for(const [x,z,s,ry] of [
    [-33,19,7.5,.6],[-10,27,8.5,1.4],[10,25,7,2.2],[34,3,6.5,.3],[-29,-22,7.5,1.9],[4,-29,7,2.8],[25,21,5.5,1.1],
  ]){
    p.add('facet',goldDeep,x,s*.46,z,s*1.25,s*.82,s,0,ry,.2);
    p.add('shard',goldGleam,x+1,s*.82,z,s*.65,s*1.15,s*.65,.2,ry+.7,-.25);
  }

  // Timber pit-props bracing the cut face & loaded ore crate tucked into the alcove
  p.add('pin',timber,-29,11,-4,3.4,24,3.4,.12,.2,.32);
  p.add('pin',timber,-19,12,-14,3.4,24,3.4,-.18,.4,.22);
  p.add('pin',timber,-24,20,-9,3.2,17,3.2,1.52,-.78,0);
  p.add('bevel',timber,16,6.5,24,13,9,10,0,.38,0);
  p.add('box',iron,16,6.5,24,13.4,1.8,10.4,0,.38,0);
  p.add('facet',goldGleam,15,11.5,23,7,5,6,.2,.9,.1);
  p.add('facet',goldRich,18,11,25,6,4.5,5.5,-.1,1.6,.2);
}

function oilDeposit(p:Parts,empty:boolean){
  const basalt=paint('stone',0x525856,.9,[.88,.04,.85]);
  const shale=paint('stone',0x353b3a,.88,[.82,.06,.8]);
  const crude=paint('water',0x101518,.82,[.06,.34,.08]);
  const slickCyan=paint('water',0x264854,1.12,[.08,.58,.12]);
  const slickViolet=paint('water',0x42304d,.98,[.09,.54,.12]);
  const casingSteel=paint('serviceSteel',0x9aa6a2,1,[.34,.78,.35]);
  const rustPipe=paint('exhaust',0x7a6555,.95,[.56,.66,.55]);
  const hazardBand=paint('hazard',0xf0bc4a,1.25,[.42,.24,.3]);

  // Irregular multi-lobed oil-stained shale & basalt terrain apron (no oval/cylinder disc)
  p.add('rockMound',basalt,-6,2.2,2,88,5,64,0,.35,0);
  p.add('rockMound',basalt,22,1.8,-8,54,4.5,42,0,1.95,0);
  p.add('oilPool',shale,-4,3.4,2,74,2.6,52,0,.28,0);
  p.add('oilPool',shale,20,3,-6,40,2.2,30,0,1.8,0);

  // Asymmetric fractured basalt ledges: tall jagged ridge on NW/NE, low broken shelves on S/E
  for(const [x,z,w,h,d,ry,rx] of [
    [-36,-10,27,19,21,.45,.15],[-24,-24,28,17,19,-1.05,.12],[-2,-27,26,15,18,.25,.14],
    [22,-24,25,16,19,2.5,-.1],[37,-8,26,18,21,1.7,.12],[32,14,22,12,17,.9,-.1],
    [-31,15,21,13,18,1.25,-.12],[-11,26,23,10,16,2.1,.08],[14,23,19,9,15,-.55,.06],
  ])p.add('facet',empty?basalt:h>14?basalt:shale,x,h*(empty?.34:.42),z,w,empty?h*.72:h,d,rx,ry,.06);

  if(empty){
    // Dry matte cracked irregular tar fissure & rusted capped casing stub
    p.add('oilPool',paint('earth',0x2a2d2d,.85,[.94,.02,.88]),-4,4.4,2,58,1.5,40,0,.3,0);
    p.add('oilPool',paint('earth',0x2a2d2d,.85,[.94,.02,.88]),18,4.2,-6,30,1.4,22,0,1.85,0);
    p.add('facet',shale,-10,5.8,5,14,5,11,.1,.7,0);
    p.add('facet',shale,14,5.4,-6,12,4.5,10,0,1.9,.1);
    p.add('octagon',shale,-12,6.2,-13,15,4,15);
    p.add('drum',rustPipe,-12,10.5,-13,9,8,9,.12,0,.18);
    p.add('drum',dark,-12,14.5,-13,10.5,2,10.5,.12,0,.18);
    return;
  }

  // Irregular multi-lobed glossy crude oil seep + satellite oil puddle leaking through rock crack
  p.add('oilPool',crude,-5,4.9,2,62,1.9,44,0,.25,0);
  p.add('oilPool',crude,19,4.7,-6,34,1.7,24,0,1.85,0);
  p.add('oilPool',crude,6,4.6,18,22,1.5,15,0,-.7,0);
  // Subtle iridescent oil-slick sheen patches following the irregular contour
  p.add('oilPool',slickCyan,-7,5.88,3,38,.32,24,0,.42,0);
  p.add('oilPool',slickViolet,16,5.68,-6,22,.28,15,0,1.9,0);
  p.add('oilPool',crude,-1,5.94,1,20,.3,14,0,.1,0);

  // Bubbling crude domes & organic ripple rings
  for(const [x,z,w,h] of [[7,4,10.5,5],[-14,7,8.5,4.2],[19,-5,7.5,3.8],[-3,-7,9,4.4]])
    p.add('dome',crude,x,5.7,z,w,h,w);
  p.add('ring',slickCyan,7,5.95,4,15,15,3,Math.PI/2,0,0);
  p.add('ring',slickCyan,-14,5.95,7,11.5,11.5,2.4,Math.PI/2,0,0);

  // Industrial survey wellhead anchored on the NW basalt ledge overlooking the main fissure
  p.add('octagon',shale,-14,6.8,-13,18,5,18);
  p.add('ring',casingSteel,-14,9.6,-13,14,14,4.5,Math.PI/2,0,0);
  p.add('drum',casingSteel,-14,13.2,-13,11,7,11);
  p.add('drum',hazardBand,-14,16.4,-13,11.6,2.8,11.6);
  p.add('drum',rustPipe,-14,21.2,-13,7.5,8,7.5);
  p.add('ring',casingSteel,-14,24.7,-13,10,10,3.2,Math.PI/2,0,0);
  p.add('elbow',rustPipe,-10.5,26.7,-13,9,9,9,0,0,0);
  p.add('drum',dark,-6.5,26.7,-13,4.2,5.5,4.2,0,0,Math.PI/2);
  p.add('pin',casingSteel,-7.5,13.7,-13,2.2,6,2.2,0,0,Math.PI/2);
  p.add('ring',orange,-4.8,13.7,-13,6.5,6.5,2.2,0,Math.PI/2,0);
  p.add('drum',glass,-14,18.7,-7.5,3.8,1.2,3.8,Math.PI/2,0,0);
}

export function natureGeometry(features:{x:number;y:number;kind:string;size:number}[],assets?:BlenderAssets,world?:Pick<WorldData,'land'|'heights'>) {
  if(assets){
    const parts=features.filter(f=>f.kind!=='water').map(f=>{
      const scale=f.size/100*(isTreeKind(f.kind)?.88:1),angle=(f.x+f.y)*.024;
      const gy=world?heightAt(world,f.x,f.y):0;
      return assets.nature(`nature:${f.kind}`).scale(scale,scale,scale).rotateY(angle).translate(f.x,gy,f.y);
    });
    if(!parts.length)return;
    const geometry=mergeGeometries(parts)!;
    for(const part of parts)part.dispose();
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    return geometry;
  }
  const p=new Parts();
  features.forEach((f,i)=>{
    const {x,y:z,size,kind}=f,s=size/100,a=(x+z)*.024;
    if(kind==='pine'||kind==='oak'||kind==='birch')tree(p,kind,x,0,z,size*.88,i);
    else if(kind==='ruin'){
      p.add('bevel',baseSlab,x,5,z,size*.85,10,size*.79,0,a);
      for(const [dx,dz,h] of [[-.27,-.24,.76],[.27,-.24,.43],[-.27,.19,.36],[.25,.19,.58]]){
        p.add('bevel',stone,x+dx*size,h*size/2,z+dz*size,16*s,h*size,16*s,.04,a);
        p.add('bevel',baseSlab,x+dx*size,h*size,z+dz*size,19*s,5*s,19*s,0,a);
      }
    }else if(kind.startsWith('rock')){
      p.add('facet',stone,x,10*s,z,size,51*s,size*.82,.5,a,.4);
      p.add('facet',stone,x+size*.27,6*s,z-size*.1,size*.53,25*s,size*.45,.4,a,.2);
    }else if(kind==='bush'){
      p.add('crown',paint('leaf',0xa7cba0),x-8,10*s,z,size*.56,37*s,size*.56,0,a,0);
      p.add('crown',paint('leaf',0xc4ca9a),x+7,12*s,z+5,size*.54,43*s,size*.56,.1,a,0);
    }else if(kind==='stump'){
      p.add('drum',bark,x,4,z,size*.35,8,size*.35,0,a,.08);
    }else if(kind!=='water'){
      for(let n=0;n<3;n++)p.add('cone',kind==='flower'&&n===1?0xe7ca77:paint('grass',0xc5dbac),x+(n-1)*4,4+n,z+n*2,4,9+n*2,4,0,a,(n-1)*.42);
    }
  });
  return p.geometry('solid');
}
const isTreeKind=(kind:string)=>kind==='pine'||kind==='oak'||kind==='birch';
