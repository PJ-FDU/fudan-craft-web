import { Bone, Group, Skeleton } from 'three';
import type { UnitAnimation } from './animation.js';
import type { Size } from './model-parts.js';
import type { MobileKind } from './types.js';

interface Joint {name:string;parent:number;offset:Size;origin:Size}
export class RigDefinition {
  readonly joints:Joint[]=[];
  private indices=new Map<string,number>();

  constructor(readonly animate?:(rig:UnitRig,pose:RigPose)=>void){}

  joint(name:string,offset:Size,parentName?:string) {
    const parent=parentName===undefined?-1:this.index(parentName);
    const at=this.joints[parent]?.origin??[0,0,0];
    const index=this.joints.length;
    this.joints.push({name,parent,offset,origin:[at[0]+offset[0],at[1]+offset[1],at[2]+offset[2]]});
    this.indices.set(name,index);
  }

  index(name:string) {
    const index=this.indices.get(name);
    if(index===undefined)throw new Error(`Unknown rig joint ${name}`);
    return index;
  }
}

export class UnitRig {
  readonly skeleton:Skeleton;
  private bones:Bone[];

  constructor(private definition:RigDefinition,root:Group) {
    this.bones=definition.joints.map(joint=>{
      const bone=new Bone();
      bone.name=joint.name;
      bone.position.set(...joint.offset);
      return bone;
    });
    definition.joints.forEach((joint,i)=>{
      const parent=this.bones[joint.parent]??root;
      parent.add(this.bones[i]);
    });
    root.updateMatrixWorld(true);
    this.skeleton=new Skeleton(this.bones);
  }

  joint(name:string){return this.bones[this.definition.index(name)];}
  pose(pose:RigPose){
    if(!this.definition.animate)return false;
    this.definition.animate(this,pose);return true;
  }
}

export const sides=['L','R'] as const;
export const humanoid=(kind:MobileKind)=>['soldier','sniper','medic','mech','commander','ranger','pathfinder','observer'].includes(kind);
export const legLengths=(mech:boolean)=>mech?[11.5,10.5,2.6] as const:[8.5,8.0,1.65] as const;
export const rigStride=(kind:MobileKind)=>kind==='mech'?34:kind==='sniper'?24:26;
export const wheelLayout=(kind:MobileKind)=>kind==='artillery'?[-25,-13,0,13,25]:kind==='tank'||kind==='disruptor'?[-17,-6,6,17]:[-15,15];

const TAU=Math.PI*2;
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const smooth=(x:number)=>{x=clamp(x,0,1);return x*x*(3-2*x);};

export interface RigPose {
  state:UnitAnimation;
  weight:number;
  travel:number;
  time:number;
  id:number;
  aim:number;
  recoil:number;
  turn:number;
  animate:boolean;
  fall?:number;
  cast?:number;
  active?:boolean;
}

function walkRig(rig:UnitRig,kind:MobileKind,pose:RigPose) {
  const mech=kind==='mech',medic=kind==='medic',sniper=kind==='sniper';
  const [thigh,shin,ankle]=legLengths(mech),height=thigh+shin+ankle;
  const weight=pose.animate?pose.weight:0;
  const phase=pose.travel/rigStride(kind)+(pose.id%5)*.037;
  const cycle=phase*TAU;
  const aim=pose.animate?pose.aim:0,recoil=pose.animate?pose.recoil:0;
  const fall=pose.fall??0;
  const breath=pose.animate?Math.sin(pose.time*(mech?2.7:4.3)+pose.id)*.37:0;
  const hip=rig.joint('hips'),torso=rig.joint('torso'),head=rig.joint('head');
  hip.position.y=height-weight*(2.15-.34*Math.cos(cycle*2))-aim*.8-fall*2.5;
  hip.rotation.y=Math.sin(cycle)*weight*.11;
  torso.rotation.set(weight*.11+aim*.13-recoil*.11+fall*.2,-hip.rotation.y*1.6,Math.sin(cycle)*weight*.09);
  head.rotation.set(-torso.rotation.x*.72+breath*.06,Math.sin(pose.time*1.4+pose.id)*.11*(pose.animate?1-weight-aim*(1-weight):0),0);
  for(const [i,side] of sides.entries()){
    const t=(phase+i*.5)%1,stance=.55,planted=t<stance;
    const swing=clamp((t-stance)/(1-stance),0,1);
    const along=planted?1-2*(t/stance):-1+2*smooth(swing);
    const lift=planted?0:Math.sin(swing*Math.PI);
    const reach=mech?9.7:8.4,stepHeight=mech?4.8:3.6;
    const z=along*reach*weight+(i===0?-.65:.65)+fall*(i===0?-4.2:3.1);
    const down=hip.position.y-ankle-lift*stepHeight*weight;
    // Solve the sagittal knee chain against the planted or swinging ankle target.
    const length=clamp(Math.hypot(down,z),Math.abs(thigh-shin)+.01,thigh+shin-.005);
    const knee=Math.acos(clamp((length*length-thigh*thigh-shin*shin)/(2*thigh*shin),-1,1));
    const upper=Math.atan2(-z,down)-Math.atan2(shin*Math.sin(knee),thigh+shin*Math.cos(knee));
    rig.joint(side+'Leg').rotation.x=upper;
    rig.joint(side+'Knee').rotation.x=knee;
    rig.joint(side+'Foot').rotation.x=-upper-knee+lift*weight*.15;

    const arm=rig.joint(side+'Arm'),elbow=rig.joint(side+'Elbow'),hand=rig.joint(side+'Hand');
    const sign=i===0?-1:1;
    const counter=Math.sin(cycle+i*Math.PI)*weight*(mech?.18:.21)*(1-aim);
    arm.rotation.set((i===0?-.42:-.74)-aim*.34+counter+recoil*.16+fall*.44,sign*.11,sign*.17+fall*sign*.58);
    elbow.rotation.x=(i===0?-.66:-.77)-aim*.19+recoil*.19+breath*.055;
    hand.rotation.x=-arm.rotation.x-elbow.rotation.x-torso.rotation.x+(sniper?-.06:medic?.08:.03)+recoil*.16;
    hand.position.z=i===1?-recoil*(mech?2.0:.82):0;
  }
}

function mechanicalRig(rig:UnitRig,kind:MobileKind,pose:RigPose) {
  const speed=pose.animate?pose.weight:0,recoil=pose.animate?pose.recoil:0;
  const rhythm=Math.sin(pose.travel*.24)*speed;
  if(kind==='fighter'){
    for(const [i,side] of sides.entries()){
      const sign=i===0?-1:1;
      rig.joint(side+'Flap').rotation.x=speed*.14-recoil*.14+pose.turn*sign*.21;
      rig.joint(side+'Nozzle').rotation.x=speed*.16+pose.aim*.18;
    }
    rig.joint('body').rotation.z=clamp(-pose.turn*.74,-.33,.33);
    rig.joint('body').rotation.x=speed*.075-pose.aim*.12+rhythm*.025;
    return;
  }
  const tracked=kind==='tank'||kind==='artillery'||kind==='disruptor';
  for(const side of sides)for(const [i] of wheelLayout(kind).entries()){
    const wheel=rig.joint(side+'Wheel'+i);
    wheel.rotation.x=pose.animate?pose.travel/(tracked?4.9:6.7):0;
    wheel.position.y=7+Math.sin(pose.travel*.26+i*1.22)*speed*(tracked?.33:.62);
  }
  const body=rig.joint('body');
  body.rotation.x=rhythm*.025+recoil*.025;
  body.rotation.z=pose.turn*speed*.065;
  if(kind==='worker'){
    const working=pose.animate&&(pose.state==='gather'||pose.state==='build');
    const wave=working?Math.sin(pose.time*8+pose.id)*.17:0;
    rig.joint('boom').rotation.x=working?.22+wave:-.16-rhythm*.065;
    rig.joint('tool').rotation.x=working?-.43-wave*1.5:.13;
    rig.joint('tool').position.z=16+(working?(wave+.17)*5:0);
    const grip=working?.13+wave*.72:0;
    rig.joint('LGrip').rotation.y=grip;
    rig.joint('RGrip').rotation.y=-grip;
    return;
  }
  const turret=rig.joint('turret'),barrel=rig.joint('barrel');
  turret.rotation.y=pose.turn*(.12+pose.aim*.34);
  barrel.rotation.x=-(kind==='artillery'?.17+pose.aim*.24:pose.aim*.075)+recoil*.09;
  barrel.position.z=3-recoil*(tracked?4.2:1.8);
}

export function poseRig(rig:UnitRig,kind:MobileKind,pose:RigPose) {
  if(rig.pose(pose))return;
  if(humanoid(kind))walkRig(rig,kind,{...pose,aim:Math.max(pose.aim,pose.cast??0)});
  else mechanicalRig(rig,kind,pose);
}
