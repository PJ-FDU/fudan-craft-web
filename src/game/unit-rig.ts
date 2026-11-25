import { Bone, Euler, Group, Quaternion, Skeleton, Vector3 } from 'three';
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
export const legLengths=(mech:boolean)=>mech?[14.0,12.8,3.0] as const:[8.5,8.0,1.65] as const;
export const rigStride=(kind:MobileKind)=>kind==='mech'?38:kind==='sniper'?24:26;
export const wheelLayout=(kind:MobileKind)=>kind==='artillery'?[-25,-13,0,13,25]:kind==='tank'||kind==='disruptor'?[-17,-6,6,17]:[-15,15];
/** 采集头位于臂端；建模和动画共用静止行程，施工时沿导轨前伸。 */
export const workerToolReach=18.4;
export const workerWheelHeight=8.2;

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
  const mech=kind==='mech',medic=kind==='medic',sniper=kind==='sniper',soldier=kind==='soldier';
  const commander=kind==='commander',ranger=kind==='ranger',pathfinder=kind==='pathfinder',observer=kind==='observer';
  const twoHanded=soldier||medic||ranger||pathfinder;
  const upright=twoHanded||commander||observer||mech;
  const [thigh,shin,ankle]=legLengths(mech),height=thigh+shin+ankle;
  const weight=pose.animate?pose.weight:0;
  const phase=pose.travel/rigStride(kind)+(pose.id%5)*.037;
  const cycle=phase*TAU;
  const aim=pose.animate?pose.aim:0,recoil=pose.animate?pose.recoil:0;
  const fall=pose.fall??0;
  const breath=pose.animate?Math.sin(pose.time*(mech?2.7:4.3)+pose.id)*.37:0;
  const hip=rig.joint('hips'),torso=rig.joint('torso'),head=rig.joint('head');
  hip.position.y=height-weight*(mech?2.45:2.15-.34*Math.cos(cycle*2))-aim*(upright?.42:.8)-fall*2.5;
  hip.rotation.y=Math.sin(cycle)*weight*(commander?.09:mech?.08:.11);
  // 狙击手将重心略移向自身右侧；负 Z 旋转表示上身向 +X 倾斜。
  const sniperLean=sniper&&pose.animate?(.07+aim*.06)*(1-clamp(fall,0,1)):0;
  const pitch=upright
    ? (pose.animate?(commander||mech?.015:.025)+weight*(commander||mech?.045:.065)+aim*(commander||mech?.03:.045)-recoil*.045:0)
    : weight*(sniper?.055:.11)+aim*(sniper?.075:.13)-recoil*(sniper?.055:.11);
  const torsoYaw=twoHanded
    ? -hip.rotation.y*1.4+(pose.animate?(.08*(1-aim)+aim*.22)*(1-clamp(fall,0,1)):0)
    : commander||observer
      ? -hip.rotation.y*1.2+(pose.animate?(-.06*(1-aim)+aim*.16)*(1-clamp(fall,0,1)):0)
      : mech
        ? -hip.rotation.y*1.1+(pose.animate?aim*.18*(1-clamp(fall,0,1)):0)
        : -hip.rotation.y*1.6+(sniper?aim*.12:0);
  torso.rotation.set(pitch+fall*.2,
    torsoYaw,
    Math.sin(cycle)*weight*(sniper?.035:upright?.042:.09)-sniperLean);
  const headScan=Math.sin(pose.time*1.4+pose.id)*.11*(pose.animate?1-weight-aim*(1-weight):0);
  head.rotation.set(-torso.rotation.x*.72+breath*.06+((commander||observer)&&pose.animate?.09*(1-aim):0),
    twoHanded
      ? headScan-(pose.animate?(aim*.20+.06*(1-aim))*(1-clamp(fall,0,1)):0)
      : commander||observer
        ? headScan*.7+(pose.animate?(.16*(1-aim)-aim*.14)*(1-clamp(fall,0,1)):0)
        : headScan,0);
  for(const [i,side] of sides.entries()){
    const t=(phase+i*.5)%1,stance=.55,planted=t<stance;
    const swing=clamp((t-stance)/(1-stance),0,1);
    const along=planted?1-2*(t/stance):-1+2*smooth(swing);
    const lift=planted?0:Math.sin(swing*Math.PI);
    const reach=mech?11.2:8.4,stepHeight=mech?5.2:3.6;
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
    const counter=Math.sin(cycle+i*Math.PI)*weight*(mech?.16:.21)*(1-aim);
    if(mech){
      // 泰坦机甲：左臂重盾前护、右臂四管机炮稳健平端，攻击时防盾微前顶、炮臂水平稳定发射带后坐。
      arm.rotation.set((i===0?-.32-aim*.26:-.48-aim*.44)+counter+recoil*(i===1?.18:.04)+fall*.40,
        sign*(.08+aim*(i===0?.24:-.08)),sign*.12+fall*sign*.50);
      elbow.rotation.x=(i===0?-.72-aim*.18:-.92-aim*.12)+recoil*(i===1?.14:0)+breath*.04;
      hand.rotation.x=-arm.rotation.x-elbow.rotation.x-torso.rotation.x+(i===1?-.02+recoil*.06:0);
      hand.position.z=i===1?-recoil*2.4:0;
    }else{
      arm.rotation.set((i===0?-.42:-.74)-aim*.34+counter+recoil*.16+fall*.44,sign*.11,sign*.17+fall*sign*.58);
      elbow.rotation.x=(i===0?-.66:-.77)-aim*.19+recoil*.19+breath*.055;
      hand.rotation.x=-arm.rotation.x-elbow.rotation.x-torso.rotation.x+(sniper?-.06:medic?.08:.03)+recoil*.16;
      hand.position.z=i===1?-recoil*.82:0;
    }
  }
  if(sniper){
    sniperGrip(rig,weight,aim,recoil,breath,fall);
    sniperCape(rig,pose,weight,fall);
  }else if(soldier){
    riflemanGrip(rig,weight,cycle,aim,recoil,breath,fall);
  }else if(medic){
    medicGrip(rig,weight,cycle,aim,recoil,breath,fall);
  }else if(commander){
    commanderPose(rig,weight,cycle,aim,recoil,breath,fall);
  }else if(ranger){
    rangerGrip(rig,weight,cycle,aim,recoil,breath,fall);
  }else if(pathfinder){
    pathfinderGrip(rig,weight,cycle,aim,recoil,breath,fall);
  }else if(observer){
    observerPose(rig,weight,cycle,aim,recoil,breath,fall);
  }
}

// 通用双骨解析手臂 IK：将肩-肘-腕链条精确解算到 torso 局部目标点与目标腕朝向。
const armDown=new Vector3(0,-1,0);
const supportRotation=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
const armReach=new Vector3(),elbowDirection=new Vector3(),elbowPoint=new Vector3(),forearmDirection=new Vector3();
const armRotation=new Quaternion(),forearmRotation=new Quaternion(),handRotation=new Quaternion();
function solveArmIK(
  rig:UnitRig,side:'L'|'R',target:Vector3,wristOrientation:Quaternion,
  elbowOut=.40,elbowBack=-.20,applySupport=false,
){
  const arm=rig.joint(side+'Arm'),elbow=rig.joint(side+'Elbow'),hand=rig.joint(side+'Hand');
  const upper=-elbow.position.y,lower=-hand.position.y;
  armReach.copy(target).sub(arm.position);
  const distance=clamp(armReach.length(),Math.abs(upper-lower)+.01,upper+lower-.005);
  armReach.normalize();
  const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
  const outward=side==='R'?1:-1;
  elbowDirection.set(outward*elbowOut,-1,elbowBack);
  elbowDirection.addScaledVector(armReach,-elbowDirection.dot(armReach)).normalize();
  elbowPoint.copy(armReach).multiplyScalar(along)
    .addScaledVector(elbowDirection,Math.sqrt(Math.max(0,upper*upper-along*along)));
  armRotation.setFromUnitVectors(armDown,forearmDirection.copy(elbowPoint).normalize());
  forearmDirection.copy(target).sub(arm.position).sub(elbowPoint).normalize();
  forearmRotation.setFromUnitVectors(armDown,forearmDirection);
  arm.quaternion.copy(armRotation);
  elbow.quaternion.copy(armRotation).invert().multiply(forearmRotation);
  hand.position.z=0;
  handRotation.copy(wristOrientation);
  if(applySupport)handRotation.multiply(supportRotation);
  hand.quaternion.copy(forearmRotation).invert().multiply(handRotation);
}

// [SNIPER-GRIP] 枪械骨骼决定两个接触点；腕骨的方向分别适配握把和托枪掌心。
// 左腕在握把前方 6.2 单位，掌心托住护木；右手独占后方握把与扳机。
const sniperSupport=new Vector3(-.6,-.55,6.2);
const sniperEye=new Vector3(1.2,1,2.89);
const sniperEyeRelief=new Vector3(0,3.7,-3.06);
const sniperWrist=new Vector3(),supportWrist=new Vector3();
const eyeTarget=new Vector3(),eyeOffset=new Vector3();
const rifleRotation=new Quaternion(),headRotation=new Quaternion();
const sniperParentRotation=new Quaternion(),sniperParentInverse=new Quaternion();
const sniperPitch=new Euler();
function sniperGrip(rig:UnitRig,weight:number,aim:number,recoil:number,breath:number,fall:number){
  const torso=rig.joint('torso'),head=rig.joint('head'),rifle=rig.joint('rifle'),raise=smooth(aim/.65);
  head.position.set(0,14,1);
  sniperWrist.set(1.3,7.2-weight*.45+breath*.10,6.55-recoil*.65);
  rifleRotation.setFromEuler(sniperPitch.set((.28+weight*.06)*(1-raise)-recoil*.045+fall*.7,-.30,0));
  if(fall>.05){
    // 倒地后仍让武器跟随握持手，避免新骨骼停在站立的射击位置。
    for(const side of sides)rig.joint(side+'Arm').updateMatrixWorld(true);
    rifle.position.copy(rig.joint('RHand').getWorldPosition(sniperWrist));
    rig.joint('torso').worldToLocal(rifle.position);
    rifle.quaternion.copy(rig.joint('torso').getWorldQuaternion(handRotation)).invert()
      .multiply(rig.joint('RHand').getWorldQuaternion(rifleRotation));
    return;
  }
  // [SNIPER-NECK] 身体可以侧倾，头与枪仍在角色坐标系保持直立，抵消父骨骼的滚转。
  sniperParentRotation.copy(rig.joint('hips').quaternion).multiply(torso.quaternion);
  sniperParentInverse.copy(sniperParentRotation).invert();
  headRotation.setFromEuler(sniperPitch.set(-breath*.025*(1-raise),-.30*raise,0));
  head.quaternion.copy(sniperParentInverse).multiply(headRotation);
  head.position.set(.5*raise,14-.65*raise,1+.05*raise);
  rifleRotation.premultiply(sniperParentInverse);
  // 头颈只做小幅贴腮动作；从固定眼位求枪位，避免把头横移去凑镜轴。
  eyeOffset.copy(sniperEye).applyQuaternion(head.quaternion).add(head.position);
  eyeTarget.copy(sniperEyeRelief).applyQuaternion(rifleRotation);
  sniperWrist.lerp(eyeOffset.sub(eyeTarget),raise);
  rifle.position.copy(sniperWrist);rifle.quaternion.copy(rifleRotation);
  supportWrist.copy(sniperSupport).applyQuaternion(rifleRotation).add(sniperWrist);
  solveArmIK(rig,'R',sniperWrist,rifleRotation,.35,-.12,false);
  solveArmIK(rig,'L',supportWrist,rifleRotation,.35,-.12,true);
}

// 突击步兵双手战术持枪：待机/行军时挺拔胸前低枪戒备，攻击时抵肩平射并带干脆后坐。
const rifleSupport=new Vector3(-.35,-.45,5.35);
const rifleReadyPos=new Vector3(),rifleAimPos=new Vector3();
const rifleReadyRot=new Quaternion(),rifleAimRot=new Quaternion();
function riflemanGrip(rig:UnitRig,weight:number,cycle:number,aim:number,recoil:number,breath:number,fall:number){
  const torso=rig.joint('torso'),rifle=rig.joint('rifle'),raise=smooth(aim/.65);
  if(fall>.05){
    for(const side of sides)rig.joint(side+'Arm').updateMatrixWorld(true);
    rifle.position.copy(rig.joint('RHand').getWorldPosition(sniperWrist));
    torso.worldToLocal(rifle.position);
    rifle.quaternion.copy(torso.getWorldQuaternion(handRotation)).invert()
      .multiply(rig.joint('RHand').getWorldQuaternion(rifleRotation));
    return;
  }
  const strideBob=Math.sin(cycle*2)*weight*.24;
  const strideSway=Math.sin(cycle)*weight*.22;
  // 待机／行军：胸前低枪戒备（枪口斜向前左下方），挺拔重甲步兵剪影。
  rifleReadyPos.set(3.25+strideSway,4.85-weight*.32+breath*.14+strideBob,4.75);
  rifleReadyRot.setFromEuler(sniperPitch.set(.18+weight*.05,-.72+Math.sin(cycle)*weight*.04,-.16));
  // 攻击瞄准：右手抵肩托枪，左手稳握护木，枪口平直对准前方目标。
  rifleAimPos.set(3.05,8.05+breath*.06-recoil*.14,5.35-recoil*.85);
  rifleAimRot.setFromEuler(sniperPitch.set(-.03-recoil*.07,-.24,0));
  sniperWrist.copy(rifleReadyPos).lerp(rifleAimPos,raise);
  rifleRotation.copy(rifleReadyRot).slerp(rifleAimRot,raise);
  rifle.position.copy(sniperWrist);
  rifle.quaternion.copy(rifleRotation);
  supportWrist.copy(rifleSupport).applyQuaternion(rifleRotation).add(sniperWrist);
  solveArmIK(rig,'R',sniperWrist,rifleRotation,.42,-.22,false);
  solveArmIK(rig,'L',supportWrist,rifleRotation,.42,-.22,true);
}

// 战地医疗兵双手持握纳米修复光束器：待命斜抱胸前，治疗施放时双臂稳推聚焦。
const medicSupport=new Vector3(-.30,-.35,4.65);
function medicGrip(rig:UnitRig,weight:number,cycle:number,aim:number,recoil:number,breath:number,fall:number){
  const torso=rig.joint('torso'),rifle=rig.joint('rifle'),raise=smooth(aim/.65);
  if(fall>.05){
    for(const side of sides)rig.joint(side+'Arm').updateMatrixWorld(true);
    rifle.position.copy(rig.joint('RHand').getWorldPosition(sniperWrist));
    torso.worldToLocal(rifle.position);
    rifle.quaternion.copy(torso.getWorldQuaternion(handRotation)).invert()
      .multiply(rig.joint('RHand').getWorldQuaternion(rifleRotation));
    return;
  }
  const strideBob=Math.sin(cycle*2)*weight*.22;
  const strideSway=Math.sin(cycle)*weight*.20;
  rifleReadyPos.set(2.95+strideSway,4.75-weight*.28+breath*.14+strideBob,4.85);
  rifleReadyRot.setFromEuler(sniperPitch.set(.16+weight*.04,-.64+Math.sin(cycle)*weight*.04,-.12));
  rifleAimPos.set(2.80,7.55+breath*.06-recoil*.08,5.75-recoil*.42);
  rifleAimRot.setFromEuler(sniperPitch.set(-.02-recoil*.04,-.20,0));
  sniperWrist.copy(rifleReadyPos).lerp(rifleAimPos,raise);
  rifleRotation.copy(rifleReadyRot).slerp(rifleAimRot,raise);
  rifle.position.copy(sniperWrist);
  rifle.quaternion.copy(rifleRotation);
  supportWrist.copy(medicSupport).applyQuaternion(rifleRotation).add(sniperWrist);
  solveArmIK(rig,'R',sniperWrist,rifleRotation,.40,-.22,false);
  solveArmIK(rig,'L',supportWrist,rifleRotation,.40,-.22,true);
}

// 战术指挥官：左臂曲肘于胸前自然托阅全息战术雷达板，右手待命低戒备、发令／攻击时干脆平举瞄射。
const cmdLeftPos=new Vector3(),cmdRightPos=new Vector3();
const cmdLeftRot=new Quaternion(),cmdRightRot=new Quaternion();
function commanderPose(rig:UnitRig,weight:number,cycle:number,aim:number,recoil:number,breath:number,fall:number){
  if(fall>.05)return;
  const raise=smooth(aim/.65);
  const bob=Math.sin(cycle*2)*weight*.18;
  const sway=Math.sin(cycle)*weight*.32;
  // 左手：曲肘自然托住全息战术板，略向胸前与指挥官视线内倾，告别僵硬横举。
  cmdLeftPos.set(-3.15+sway*.25,6.15+raise*1.05+breath*.12+bob,5.15+raise*.65);
  cmdLeftRot.setFromEuler(sniperPitch.set(-.36-raise*.10,.42-raise*.12,.14));
  // 右手：待机微曲握持配枪于右胯前戒备位；行军自然微摆；攻击／发令时平举瞄准前方。
  rifleReadyPos.set(5.35,2.35-weight*.15+breath*.10+bob,3.45+sway*1.65);
  rifleReadyRot.setFromEuler(sniperPitch.set(.52-weight*.12+sway*.18,-.18,-.10));
  rifleAimPos.set(4.55,8.25+breath*.05,8.45-recoil*.75);
  rifleAimRot.setFromEuler(sniperPitch.set(-.04-recoil*.09,-.12,0));
  cmdRightPos.copy(rifleReadyPos).lerp(rifleAimPos,raise);
  cmdRightRot.copy(rifleReadyRot).slerp(rifleAimRot,raise);
  solveArmIK(rig,'L',cmdLeftPos,cmdLeftRot,.55,-.35,false);
  solveArmIK(rig,'R',cmdRightPos,cmdRightRot,.36,-.24,false);
}

// 远行中继 · 线列步兵双手卡宾枪 IK：轻快低戒备持枪与干脆抵肩瞄射。
const rangerSupport=new Vector3(-.30,-.40,5.05);
function rangerGrip(rig:UnitRig,weight:number,cycle:number,aim:number,recoil:number,breath:number,fall:number){
  const torso=rig.joint('torso'),rifle=rig.joint('rifle'),raise=smooth(aim/.65);
  if(fall>.05){
    for(const side of sides)rig.joint(side+'Arm').updateMatrixWorld(true);
    rifle.position.copy(rig.joint('RHand').getWorldPosition(sniperWrist));
    torso.worldToLocal(rifle.position);
    rifle.quaternion.copy(torso.getWorldQuaternion(handRotation)).invert()
      .multiply(rig.joint('RHand').getWorldQuaternion(rifleRotation));
    return;
  }
  const strideBob=Math.sin(cycle*2)*weight*.24;
  const strideSway=Math.sin(cycle)*weight*.24;
  rifleReadyPos.set(3.05+strideSway,4.95-weight*.30+breath*.14+strideBob,4.85);
  rifleReadyRot.setFromEuler(sniperPitch.set(.16+weight*.05,-.68+Math.sin(cycle)*weight*.05,-.14));
  rifleAimPos.set(2.85,7.95+breath*.06-recoil*.12,5.45-recoil*.82);
  rifleAimRot.setFromEuler(sniperPitch.set(-.03-recoil*.07,-.22,0));
  sniperWrist.copy(rifleReadyPos).lerp(rifleAimPos,raise);
  rifleRotation.copy(rifleReadyRot).slerp(rifleAimRot,raise);
  rifle.position.copy(sniperWrist);
  rifle.quaternion.copy(rifleRotation);
  supportWrist.copy(rangerSupport).applyQuaternion(rifleRotation).add(sniperWrist);
  solveArmIK(rig,'R',sniperWrist,rifleRotation,.40,-.22,false);
  solveArmIK(rig,'L',supportWrist,rifleRotation,.40,-.22,true);
}

// 远行中继 · 路线工兵双手等离子焊枪／路线测绘仪 IK：斜抱行进与前倾双手作业。
const pathfinderSupport=new Vector3(-.30,-.42,4.75);
function pathfinderGrip(rig:UnitRig,weight:number,cycle:number,aim:number,recoil:number,breath:number,fall:number){
  const torso=rig.joint('torso'),rifle=rig.joint('rifle'),raise=smooth(aim/.65);
  if(fall>.05){
    for(const side of sides)rig.joint(side+'Arm').updateMatrixWorld(true);
    rifle.position.copy(rig.joint('RHand').getWorldPosition(sniperWrist));
    torso.worldToLocal(rifle.position);
    rifle.quaternion.copy(torso.getWorldQuaternion(handRotation)).invert()
      .multiply(rig.joint('RHand').getWorldQuaternion(rifleRotation));
    return;
  }
  const strideBob=Math.sin(cycle*2)*weight*.22;
  const strideSway=Math.sin(cycle)*weight*.20;
  rifleReadyPos.set(3.15+strideSway,4.65-weight*.28+breath*.14+strideBob,5.05);
  rifleReadyRot.setFromEuler(sniperPitch.set(.22+weight*.04,-.62+Math.sin(cycle)*weight*.04,-.10));
  rifleAimPos.set(2.85,6.95+breath*.05-recoil*.06,6.15-recoil*.35);
  rifleAimRot.setFromEuler(sniperPitch.set(.05-recoil*.03,-.18,0));
  sniperWrist.copy(rifleReadyPos).lerp(rifleAimPos,raise);
  rifleRotation.copy(rifleReadyRot).slerp(rifleAimRot,raise);
  rifle.position.copy(sniperWrist);
  rifle.quaternion.copy(rifleRotation);
  supportWrist.copy(pathfinderSupport).applyQuaternion(rifleRotation).add(sniperWrist);
  solveArmIK(rig,'R',sniperWrist,rifleRotation,.44,-.22,false);
  solveArmIK(rig,'L',supportWrist,rifleRotation,.44,-.22,true);
}

// 远行中继 · 前沿观测员：双手胸前协同操作发光雷达板，发令／照射目标时右手抬举激光目标指示器。
function observerPose(rig:UnitRig,weight:number,cycle:number,aim:number,recoil:number,breath:number,fall:number){
  if(fall>.05)return;
  const raise=smooth(aim/.65);
  const bob=Math.sin(cycle*2)*weight*.18;
  const sway=Math.sin(cycle)*weight*.24;
  cmdLeftPos.set(-2.95+sway*.20,6.05+raise*.95+breath*.12+bob,5.25+raise*.55);
  cmdLeftRot.setFromEuler(sniperPitch.set(-.34-raise*.08,.44-raise*.10,.12));
  rifleReadyPos.set(2.85+sway*.45,5.05-weight*.45+breath*.10+bob,5.45-weight*.45);
  rifleReadyRot.setFromEuler(sniperPitch.set(.18+weight*.20,-.42,.08));
  rifleAimPos.set(4.35,8.15+breath*.05,8.25-recoil*.45);
  rifleAimRot.setFromEuler(sniperPitch.set(-.03-recoil*.05,-.14,0));
  cmdRightPos.copy(rifleReadyPos).lerp(rifleAimPos,raise);
  cmdRightRot.copy(rifleReadyRot).slerp(rifleAimRot,raise);
  solveArmIK(rig,'L',cmdLeftPos,cmdLeftRot,.52,-.32,false);
  solveArmIK(rig,'R',cmdRightPos,cmdRightRot,.42,-.24,false);
}

function sniperCape(rig:UnitRig,pose:RigPose,weight:number,fall:number){
  // [SNIPER-CAPE] 两侧四段骨骼逐级滞后；同一时间可重放，不依赖累计帧状态。
  for(const [i,side] of sides.entries())for(let segment=0;segment<4;segment++){
    const lag=segment*.65+i*.5,phase=pose.time*3.6+pose.id*.31-lag;
    const flutter=pose.animate?Math.sin(phase)*(.026+weight*.065):0;
    const wind=pose.animate?Math.sin(pose.time*1.7-lag)*.022:0;
    rig.joint(side+'Cape'+segment).rotation.set(
      (pose.animate?.035+weight*.13:0)+flutter+fall*.15,
      wind+(pose.animate?pose.turn*.10*(segment+1)/4:0),
      (i===0?-1:1)*flutter*.23+wind*.55,
    );
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
    wheel.position.y=(kind==='worker'?workerWheelHeight:7)+Math.sin(pose.travel*.26+i*1.22)*speed*(tracked?.33:.62);
  }
  const body=rig.joint('body');
  body.rotation.x=rhythm*.025+recoil*.025;
  body.rotation.z=pose.turn*speed*.065;
  if(kind==='worker'){
    const working=pose.animate&&(pose.state==='gather'||pose.state==='build');
    const wave=working?Math.sin(pose.time*8+pose.id)*.17:0;
    rig.joint('boom').rotation.x=working?.22+wave:-.16-rhythm*.065;
    rig.joint('tool').rotation.x=working?-.43-wave*1.5:.13;
    rig.joint('tool').position.z=workerToolReach+(working?.7+(wave+.17)*5:0);
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
