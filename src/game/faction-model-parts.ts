import { Euler, Quaternion, Vector3, type Bone } from 'three';
import { Parts, paint, steel, dark, type Finish, type Size } from './model-parts.js';
import { RigDefinition, type RigPose } from './unit-rig.js';

export type FactionShape='organic'|'crystal'|'expedition'|'federal';
// 有机甲壳、软组织与水晶使用独立的顶点材质参数，仍与金属合批。
// 纹理强度独立于种族底色；保留远景识别度，近景显示生图细节。
export const chitin=paint('chitin',0x93927b,1.20,[.46,.02,.55],.82);
export const shell=paint('chitin',0xc1b593,1.19,[.48,.02,.52],.84);
export const tissue=paint('membrane',0xae7169,1.14,[.53,0,.46],.76);
export const bone=paint('horn',0xd4c199,1.17,[.54,0,.45],.83);
export const sacSkin=paint('nutrient',0xd0a478,1.13,[.41,0,.52],.86);
export const stellarArmor=paint('ceramic',0x90b7c6,1.18,undefined,.86);
export const astral=paint('astralAlloy',0x7188aa,1.16,undefined,.87);
export const stellarTrim=paint('stellarConductor',0xd2b484,1.15,undefined,.87);
export const gold=paint('conductor',0xe2b870,1.18,undefined,.82);
export const sand=paint('expeditionPlate',0xe6c598,1.2,undefined,.88);
export const expedition=paint('expeditionFrame',0x8d9d98,1.27,undefined,.83);
export const canvas=paint('expeditionCanvas',0xc4b48d,1.14,undefined,.84);
export const fieldRubber=paint('fieldRubber',0x81918e,1.1,undefined,.84);
export const federal=paint('federalPlate',0x7892a2,1.2,undefined,.87);
export const circuitry=paint('circuitry',0x92acbc,1.21,undefined,.84);
export const medical=paint('medicalComposite',0xe8eee4,1.25,undefined,.8);
export const service=paint('serviceSteel',0xb7c2c5,1.15,undefined,.72);
export const lamella=paint('chitinLamella',0xb9a991,1.21,undefined,.87);
export const photonic=paint('photonicGlass',0x6bdaef,1.22,[.24,.12,.32],.9);
export const composite=paint('expeditionLaminate',0xd0b485,1.15,undefined,.86);
export const ceramicArmor=paint('armorCeramic',0xb4c8cf,1.17,undefined,.87);

type Motion=(bone:Bone,pose:RigPose)=>void;
type Draw=(p:Parts)=>void;

/** 每个活动构件绑定骨骼，而非新增 Mesh；每种模型最多三次材质绘制。 */
export class FactionModel {
  readonly rig:RigDefinition;
  private motions:{name:string;motion:Motion}[]=[];
  constructor(readonly parts:Parts){
    this.rig=new RigDefinition((rig,pose)=>{
      for(const {name,motion} of this.motions){
        const bone=rig.joint(name),definition=this.rig.joints[this.rig.index(name)];
        bone.position.set(...definition.offset);bone.rotation.set(0,0,0);bone.scale.setScalar(1);
        if(pose.animate||pose.fall)motion(bone,pose);
      }
    });
  }
  joint(name:string,at:Size,draw:Draw,parent='root',motion?:Motion){
    this.rig.joint(name,at,name==='root'?undefined:parent);
    this.at(name,draw);
    if(motion)this.motions.push({name,motion});
  }
  at(name:string,draw:Draw){
    const i=this.rig.index(name),parts=new Parts();
    draw(parts);this.parts.bind(parts,this.rig.joints[i].origin,i);
  }
}

/** 两端点定义连杆/筋腱，避免各兵种重复手算欧拉角。 */
export function strut(p:Parts,finish:Finish,a:Size,b:Size,width:number,depth=width){
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz);
  p.add('pin',finish,(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,width,length,depth,
    Math.atan2(dz,dy),0,-Math.atan2(dx,Math.hypot(dy,dz)));
}

/** 上粗下细的肢节；关节软组织由调用方单独画，避免骨棒拼接感。 */
export function tendon(p:Parts,finish:Finish,a:Size,b:Size,width:number,depth=width){
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz);
  p.add('limb',finish,(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,width,length,depth,
    Math.atan2(dz,dy),0,-Math.atan2(dx,Math.hypot(dy,dz)));
}

/** 弯角以根部和生长方向定位；原型底面在 y=-.5，不能把肢节端点当作角的中心。 */
export function horn(p:Parts,finish:Finish,root:Size,direction:Size,length:number,width:number,depth=width,roll=0){
  const axis=new Vector3(...direction);
  if(axis.lengthSq()===0||length<=0||width<=0||depth<=0)throw new Error('Horn requires a direction and positive dimensions');
  const rotation=new Quaternion().setFromUnitVectors(new Vector3(0,1,0),axis.normalize());
  rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),roll));
  const center=new Vector3(0,length/2,0).applyQuaternion(rotation).add(new Vector3(...root));
  const euler=new Euler().setFromQuaternion(rotation);
  p.add('horn',finish,center.x,center.y,center.z,width,length,depth,euler.x,euler.y,euler.z);
}

export function lens(p:Parts,x:number,y:number,z:number,r:number){
  p.add('drum',dark,x,y,z,r,2.5,r,Math.PI/2);
  p.add('drum','lamp',x,y,z+1.4,r*.62,.6,r*.62,Math.PI/2);
}
export function dish(p:Parts,size:number,finish:Finish=expedition){
  p.add('drum',steel,0,-3,0,3,7,3);
  p.add('dome',finish,0,0,0,size,size*.27,size,-.55);
  p.add('ring',gold,0,1,0,size,size,2,Math.PI/2-.55);
  strut(p,steel,[0,0,0],[0,7,4],1.1);
  p.add('dome','lamp',0,7,4,2,2,2);
}
export function cross(p:Parts,x:number,y:number,z:number,size:number,finish:Finish='lamp'){
  p.box(finish,x,y,z,size,size*.25,1);
  p.box(finish,x,y,z,size*.25,size,1.1);
}
export const wave=(pose:RigPose,rate=2)=>Math.sin(pose.time*rate+pose.id*.71);
export const effort=(pose:RigPose)=>Math.max(pose.aim,pose.cast??0);
export const working=(pose:RigPose)=>pose.state==='gather'||pose.state==='build'||!!pose.active;
