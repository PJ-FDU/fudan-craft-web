import { armor, dark, orange, paint, Parts, steel, type Size } from './model-parts.js';
import { RigDefinition, humanoid, legLengths, sides, wheelLayout, workerToolReach, workerWheelHeight } from './unit-rig.js';
import type { MobileKind } from './types.js';
import { humanoidModel } from './humanoid-models.js';
import { trackedModel } from './tracked-models.js';
import { ceramicArmor, circuitry, federal, service, strut } from './faction-model-parts.js';

const guard=paint('guard',0xe4e9df,1.34);
const deck=paint('federalPlate',0xd6d8c9,1.27),rubber=paint('track',0xc3c5c1,1.15);
const vent=paint('grille',0xc3d9d5,1.22),alloy=paint('federalPlate',0xd5e4e3,1.31);
const mechSteel=paint('federalPlate',0xaac3c4,1.29),hydraulic=paint('serviceSteel',0xd3cdc0,1.21);
const visor=paint('optic',0xc0e8ee,1.36);
const weaponHousing=paint('weapon',0xcdd7d3,1.28),hazard=paint('hazard',0xf4e4bd,1.18),exhaust=paint('exhaust',0xd8cabe,1.24);
const titanShell=paint('titanArmor',0x8e9c94,1.24,undefined,.86);
const titanFrame=paint('titanSteel',0x8197a5,1.12,undefined,.87);
const titanSeal=paint('titanSeal',0x879293,1.07,undefined,.86);
const titanTrim=paint('titanTrim',0xc3b79c,1.18,undefined,.88);

type Decorate=(parts:Parts)=>void;

export class MobileModel {
  readonly rig=new RigDefinition();
  constructor(private parts:Parts){}
  joint(name:string,at:Size,parent?:string,draw?:Decorate){
    this.rig.joint(name,at,parent);
    if(draw)this.at(name,draw);
  }
  at(name:string,draw:Decorate,sleeve=false){
    const index=this.rig.index(name),joint=this.rig.joints[index],parts=new Parts();
    draw(parts);
    this.parts.bind(parts,joint.origin,index,sleeve&&joint.parent>=0?joint.parent:undefined);
  }
}

function titan(model:MobileModel){
  const [thigh,shin,ankle]=legLengths(true);
  model.joint('hips',[0,thigh+shin+ankle,0],undefined,p=>{
    p.add('armorHull',titanFrame,0,1,0,27,10,17);
    p.add('armorPlate',ceramicArmor,0,.1,7,19,5,8,-.29);
    p.box('team',0,2.4,8.2,7,2.5,.8);
    for(const s of [-1,1]){
      p.add('drum',service,s*12,.5,-1,8,4.2,8,0,0,Math.PI/2);
      p.add('armorPlate',titanShell,s*11,-2,5,10,7,7,-.18,0,-s*.18);
    }
  });
  model.joint('torso',[0,6.2,0],'hips',p=>{
    p.add('armorHull',titanFrame,0,7,1,39,20,25,-.09);
    p.add('armorPlate',titanShell,0,10,11,35,9,14,-.38);
    p.add('armorHull',dark,0,4.3,11,23,7,9,-.1);
    p.add('panel',circuitry,0,4.5,14.1,14,4,1.7);
    p.box('lamp',0,5.4,15,8,.75,.7);
    p.add('armorPlate','team',0,10.7,13.6,11,1.3,4.8,-.46);
    p.add('armorHull',circuitry,0,8,-9,25,14,10);
    for(const s of [-1,1]){
      p.add('armorPlate',federal,s*12,2.8,10,11,5.4,10,-.24,s*.24);
      p.add('armorPlate',titanTrim,s*11,13.2,12,9,2.8,9,-.38,s*.17);
      p.add('armorHull',titanShell,s*8,13,-1,6,8,15,0,0,-s*.13);
      p.add('drum',service,s*11.9,8,-11.7,5.2,16,5.2,.12);
      p.add('duct',exhaust,s*11.9,15,-12.5,5.9,4.2,5.9,.12);
      p.add('drum',dark,s*11.9,14.3,-12.4,4.4,.65,4.4,.12);
      strut(p,hydraulic,[s*13,3.5,-10],[s*8,2.4,-15],1.6);
      for(const y of [5,7.2,9.4])p.box(vent,s*5.5,y,-14.1,7.2,1.05,.75);
    }
  });
  model.at('torso',p=>p.add('sleeve',titanSeal,0,0,0,15,7,12),true);
  model.joint('head',[0,18.2,4.6],'torso',p=>{
    p.add('armorHull',titanFrame,0,.5,0,10.5,7,9);
    p.add('armorPlate',titanShell,0,3,.4,10,3.1,8,-.1);
    p.add('canopy',visor,0,.1,4,8,2.4,3.8,-.1);
    p.box('lamp',0,.45,5.8,5.4,.61,.6);
    for(const s of [-1,1]){
      p.add('armorPlate',titanTrim,s*4.5,-.35,1.7,2.8,5,7,0,s*.18);
      p.add('pin',service,s*5.3,1,-1.4,2.2,1,2.2,0,0,Math.PI/2);
    }
  });
  for(const [i,side] of sides.entries()){
    const s=i===0?-1:1;
    // 横向站距与承重装甲挺拔化；腿段长度继续共用 IK 契约。
    model.joint(side+'Leg',[s*9.6,0,0],'hips',p=>{
      p.add('armorHull',titanFrame,0,-thigh*.44,0,12.4,thigh*.88,11);
      p.add('armorPlate',titanShell,0,-thigh*.42,5,10.8,thigh*.75,4.4,-.08);
      strut(p,service,[s*5,-1.4,-2],[s*5,-thigh*.8,-2],2.5);
    });
    model.joint(side+'Knee',[0,-thigh,0],side+'Leg',p=>{
      p.add('drum',service,0,-.6,0,8,11,8,0,0,Math.PI/2);
      p.add('armorHull',titanFrame,0,-shin*.46,.9,11,shin*.94,10.7,-.06);
      p.add('armorPlate',titanShell,0,-shin*.4,5.5,10.3,shin*.82,4.8,-.05);
      p.add('armorPlate','team',0,-2.2,5.45,5.1,3.2,1.85);
      strut(p,hydraulic,[s*3.3,0,-1.2],[s*3.4,-shin*.83,-2.55],1.9);
    });
    model.at(side+'Knee',p=>p.add('sleeve',titanSeal,0,0,0,6.9,5.7,7.1),true);
    model.joint(side+'Foot',[0,-shin,0],side+'Knee',p=>{
      p.add('armorHull',federal,0,-ankle*.34,3.6,13.8,ankle*1.12,18);
      p.add('armorPlate',rubber,0,-ankle*.83,3.4,13.5,ankle*.34,18);
      for(const toe of [-1,1])p.add('armorPlate',titanShell,toe*3.25,-.95,8,5.7,2.7,8.3,-.13);
    });
    model.joint(side+'Arm',[s*17.5,12.4,0],'torso',p=>{
      p.add('drum',service,0,-.6,0,9,11,9,0,0,Math.PI/2);
      p.add('armorHull',titanFrame,s*1.8,1,-.6,16.8,10.2,16,0,s*.12,-s*.16);
      p.add('armorPlate',titanShell,s*1.8,4.7,.3,17.4,5.1,15.6,0,s*.15,-s*.16);
      p.add('armorPlate',i===1?'team':titanTrim,s*8,.6,.3,3.8,7.2,11,0,0,-s*.16);
      p.add('armorHull',titanFrame,0,-5.4,0,9,10.8,9);
      p.add('armorHull',weaponHousing,s*1.8,3,-7,12,7,11,-.15);
      for(const dx of [-3,0,3]){
        p.add('drum',dark,s*1.8+dx,3,-1.4,2.5,.6,2.5,Math.PI/2);
        p.add('drum',hazard,s*1.8+dx,3,-1,1.3,.7,1.3,Math.PI/2);
      }
    });
    model.joint(side+'Elbow',[0,-10.2,0],side+'Arm',p=>{
      p.add('drum',service,0,.05,0,5.2,7.6,5.2,0,0,Math.PI/2);
      p.add('armorHull',titanShell,0,-4,1,8.2,7.5,8);
      strut(p,hydraulic,[s*3.8,-1,0],[s*3.6,-6.6,1],1.35);
      if(i===0){
        p.add('armorHull',titanFrame,-3,-3,4,14,16,7,-.12);
        p.add('armorPlate',titanShell,-3,-3,7,13,15,4,-.12);
        p.add('armorPlate','team',-3,-2,9,7,6,1);
        for(const x of [-7,1])p.add('panel',service,x,-3,8.8,1,10,.8,-.12);
      }
    });
    model.at(side+'Elbow',p=>p.add('sleeve',titanSeal,0,0,0,6.2,4.9,6.1),true);
    model.joint(side+'Hand',[0,-8.5,0],side+'Elbow',p=>{
      p.add('armorHull',dark,0,0,1,6.4,5.5,6.5);
      if(i===0){
        p.add('armorPlate',federal,0,.7,3.3,7.3,3.3,4.8);
        for(const x of [-2.2,0,2.2])p.box(service,x,-.8,4.7,1.2,2.6,2.4);
        return;
      }
      p.add('armorHull',weaponHousing,0,1.8,6,11.5,9,18);
      p.add('armorPlate',titanShell,0,5.2,5.6,10,4,14);
      p.add('drum',weaponHousing,0,1.7,16,7,19,7,Math.PI/2);
      p.add('duct',service,0,1.7,25,8.8,5,8.8,Math.PI/2);
      p.add('drum',dark,0,1.7,23.6,6.8,.7,6.8,Math.PI/2);
      p.add('armorHull',titanFrame,5,0,3,6,8,11);
      for(const x of [-4.5,4.5]){
        strut(p,service,[x,1.8,6],[x,1.8,22],1.7);
        p.box('lamp',x,3.5,9,.65,.65,3.2);
      }
    });
  }
}

function fighter(model:MobileModel){
  model.joint('body',[0,4,0],undefined,p=>{
    p.add('armorHull',alloy,0,3,0,29,13,51,-.08);
    p.add('nose',alloy,0,1,25,24,25,12,Math.PI/2);
    p.add('bevel',vent,0,-2,17,15,5,17);
    p.add('canopy',visor,0,10.5,11,16,7,22);
    p.add('armorHull',ceramicArmor,0,7,-8,16,9,19);
    p.box('lamp',0,1.7,37,4,1.45,1.75);
    for(const x of [-1,1]){
      p.add('airfoil',alloy,x*22,2,-1,35,3.8,22,0,0,x>0?0:Math.PI);
      p.add('box','team',x*29,4,-5,12,1,11,0,x*.48);
      p.add('bevel',vent,x*32,3,-12,13,10,24);
      p.add('box',alloy,x*11,10,-18,4,14,13,0,x*.14,-x*.34);
      p.add('bevel',weaponHousing,x*21,0,9,5,4,21);
      p.box('lamp',x*37,3,-3,1.65,1.35,2.6);
      p.add('panel',weaponHousing,x*7.1,11,10,1,1.4,18);
      p.add('panel',steel,x*23,4.3,1,20,.6,1,0,x*.48);
      p.add('airfoil',federal,x*22,1.1,3.8,22,2.1,13,0,x*.16,x>0?0:Math.PI);
      p.add('drum',exhaust,x*32,3,1,7,2,7,Math.PI/2);
      p.add('drum',dark,x*32,3,2.2,5,1,5,Math.PI/2);
      p.add('ring',steel,x*32,3,2.5,7.8,7.8,4);
      for(let n=0;n<8;n++){
        const a=n*Math.PI/4;
        p.add('box',hydraulic,x*32+Math.cos(a)*1.8,3+Math.sin(a)*1.8,2.8,2,.5,.5,0,0,a+.5);
      }
      p.add('nose',steel,x*21,0,21,4.6,6,4.6,Math.PI/2);
      for(const z of [-17,-13,-9])p.box(steel,x*32,8.2,z,9,.7,1);
    }
  });
  for(const [i,side] of sides.entries()){
    const x=i===0?-1:1;
    model.joint(side+'Flap',[x*26,2,-12],'body',p=>p.add('bevel',alloy,0,0,-4,17,2.2,9,0,x*.37));
    model.joint(side+'Nozzle',[x*32,3,-23],'body',p=>{
      p.add('drum',exhaust,0,0,-1.7,10,5.6,10,Math.PI/2);
      p.add('ring',steel,0,0,-4.2,10,10,6);
      p.add('drum','lamp',0,0,-3.8,6.4,1.2,6.4,Math.PI/2);
      for(let n=0;n<10;n++){
        const a=n*Math.PI/5;
        p.add('panel',steel,Math.cos(a)*4.6,Math.sin(a)*4.6,-2.8,2.1,1,4,0,0,a+Math.PI/2);
      }
    });
  }
}

function vehicle(model:MobileModel,kind:MobileKind){
  const tracked=kind==='tank'||kind==='artillery',artillery=kind==='artillery',worker=kind==='worker';
  const width=tracked?37:worker?32:27,length=tracked?50:worker?44:39;
  model.joint('chassis',[0,0,0],undefined,p=>{
    p.add('bevel',weaponHousing,0,7,0,width,10,length);
    for(const s of [-1,1])if(tracked){
      p.add('bevel',rubber,s*width/2,7,0,10,12,length+3);
      p.add('bevel',mechSteel,s*width/2,13.2,0,11.8,2.7,length+4);
      for(let n=0;n<12;n++){
        const z=-length*.46+n*length*.084;
        p.box(hydraulic,s*width/2,1.15,z,10.3,1.6,2.6);
        p.box(rubber,s*(width/2+5.1),6.8,z,.75,8.2,2.5);
      }
      for(const z of [-1,1])for(const angle of [-.65,0,.65]){
        p.add('box',rubber,s*width/2,7+Math.sin(angle)*5,z*(length*.48+Math.cos(angle)*2),10,2.6,1.9,z*(Math.PI/2-angle));
      }
    }
  });
  model.joint('body',[0,12,0],'chassis',p=>{
    p.add('armorHull',artillery?mechSteel:deck,0,3,2,width*.94,11,length*.82);
    p.add('bevel',vent,0,5,-length*.29,width*.56,5,11.5);
    p.add('bevel',worker?hazard:guard,0,3,length*.45,width*.72,5,5.5);
    p.box('team',0,5,length*.46,width*.58,3,2);
    for(const s of [-1,1]){
      p.add('bevel',alloy,s*width*.34,2.65,length*.15,6.2,6.0,19);
      p.box('lamp',s*width*.34,2.4,length*.48,3.3,2.5,2.0);
      p.box(exhaust,s*width*.34,3,-length*.44,4.5,3,5.5);
    }
    if(worker||kind==='scout'){
      p.add('canopy',visor,0,9,-7,18,8,17);
      p.add('bevel',deck,0,13,-10,20,2.5,13);
      p.box(worker?hazard:'team',0,14.2,-11,10,1.1,11.5);
      for(const x of [-8.1,0,8.1])p.add('panel',deck,x,9,1.2,.85,7,1);
      for(const s of [-1,1]){
        strut(p,service,[s*8.8,7,1],[s*8.8,13,-3],1.2);
        strut(p,service,[s*8.8,13,-3],[s*8.8,13,-13],1.2);
      }
    }
    // 百叶、检修盖与牵引点采用实体几何，近看仍有轮廓和接触阴影。
    for(let n=0;n<7;n++)p.box(steel,0,7.7,-length*.29-4.3+n*1.4,width*.48,.55,.55);
    for(const s of [-1,1]){
      p.add('panel',deck,s*width*.35,8,-3,6.6,1.6,11);
      p.add('ring',hydraulic,s*width*.27,-.8,length*.47,3.5,3.5,2.5);
      for(const z of [-5,1])p.add('pin',steel,s*width*.35,9,z,1.1,.5,1.1);
      p.add('duct',exhaust,s*width*.34,4,-length*.49,3.3,4,3.3,Math.PI/2);
      p.add('ring',steel,s*width*.34,4,-length*.53,3.8,3.8,1.8);
      if(tracked){
        // 分段侧裙露出履带下沿，侧面增加可见悬挂与装甲厚度。
        for(const z of [-16,-7,2,11,20]){
          p.add('panel',deck,s*(width*.5+3.2),.4,z,1.4,5.8,7.7);
          p.add('pin',hydraulic,s*(width*.5+4),1.7,z,1,.6,1,0,0,Math.PI/2);
        }
        p.add('panel',weaponHousing,s*width*.29,3,-length*.42,7,5,5);
        p.add('ring',hydraulic,s*width*.29,6,-length*.42,3.3,3.3,1,Math.PI/2);
      }
    }
  });
  for(const [i,side] of sides.entries())for(const [wheel,z] of wheelLayout(kind).entries()){
    const x=i===0?-1:1,d=tracked?9.5:14.2;
    model.joint(side+'Wheel'+wheel,[x*width*.52,worker?workerWheelHeight:7,z],'chassis',p=>{
      p.add('drum',rubber,0,0,0,d,tracked?5.3:7.1,d,0,0,Math.PI/2);
      p.add('drum',tracked?mechSteel:steel,x*3.1,0,0,d*.67,1.65,d*.67,0,0,Math.PI/2);
      p.add('drum',hydraulic,x*4.2,0,0,d*.34,1.3,d*.34,0,0,Math.PI/2);
      p.box(guard,x*4.2,0,d*.17,1.35,1.7,2.3);
      for(let n=0;n<6;n++){
        const a=n*Math.PI/3;
        p.add('pin',steel,x*4.9,Math.cos(a)*d*.23,Math.sin(a)*d*.23,1.1,.55,1.1,0,0,Math.PI/2);
      }
      if(!tracked)for(let n=0;n<12;n++){
        const a=n*Math.PI/6;
        p.add('box',rubber,0,Math.cos(a)*d*.48,Math.sin(a)*d*.48,7.4,1.4,2,a);
      }
    });
  }
  if(worker){
    model.joint('boom',[0,8.4,7],'body',p=>{
      p.add('bevel',hazard,0,2,7,16,5.5,17,-.11);
      for(const x of [-6,6]){
        p.add('box',orange,x,3,8,4.8,5.0,17,-.19);
        p.add('drum',hydraulic,x,-.45,8,3.2,17,3.2,Math.PI/2);
        for(const z of [4,12])p.add('ring',service,x,-.45,z,3.6,3.6,1.3);
      }
    });
    model.joint('tool',[0,-2,workerToolReach],'boom',p=>{
      p.add('bevel',weaponHousing,0,0,2.7,16,7.2,8.2);
      p.box('lamp',0,1,6,4.5,1.4,1.0);
    });
    model.joint('LGrip',[-6,0,5],'tool',p=>p.add('box',steel,-.4,-.4,2.4,3.35,3.9,6.5,.23,0,-.1));
    model.joint('RGrip',[6,0,5],'tool',p=>p.add('box',steel,.4,-.4,2.4,3.35,3.9,6.5,.23,0,.1));
    return;
  }
  model.joint('turret',[0,tracked?6.6:8,tracked?-2:7],'body',p=>{
    const w=tracked?24:13;
    p.add('octagon',steel,0,0,0,w,2.7,w);
    p.add('bevel',artillery?mechSteel:deck,0,3.8,0,w,tracked?8.3:7.3,tracked?23:14);
    for(const sign of [-1,1])if(tracked)p.add('bevel',guard,sign*10,3.1,2.5,5.9,5.4,13,.06,sign*.21,sign*.13);
    p.box('team',0,7.9,-5,tracked?12:8,1.3,8.3);
    p.box(vent,0,7.9,-8,tracked?9:5,1.5,4.8);
    if(tracked)p.add('octagon',weaponHousing,6.4,8.3,-1.7,6.3,1.8,6.3);
    if(tracked)p.add('drum',dark,-7,11,-6,1,8,1,0,0,.18);
    if(tracked){
      p.add('ring',hydraulic,6.4,9.3,-1.7,5,5,1,Math.PI/2);
      p.add('panel',weaponHousing,-4,9.6,3,6,2.6,4);
      p.add('panel',visor,-4,9.8,5,4,1.4,.7);
      for(const x of [-1,1]){
        for(const z of [-6,0,6])p.add('panel',guard,x*12,4.5,z,2.2,4.8,5);
        for(const z of [-5,4])p.add('drum',exhaust,x*11.5,6,z,2.3,4.8,2.3,0,0,x*.7);
        p.add('panel',guard,x*7,4,-12,9,6,3);
        for(const z of [-7,-3])p.add('panel',hydraulic,x*12.8,4.5,z,1,1,3);
      }
    }
  });
  model.joint('barrel',[0,5,3],'turret',p=>{
    const l=artillery?36:tracked?28:17,r=artillery?7.1:tracked?5.5:3.7;
    p.add('bevel',hydraulic,0,0,4,r*1.5,r*1.35,10);
    p.add('drum',weaponHousing,0,0,l*.55,r,l*.83,r,Math.PI/2);
    p.add('drum',steel,0,0,l*.93,r*1.42,r*.9,r*1.42,Math.PI/2);
    p.add('drum',dark,0,0,l*.93+r*.48,r*.77,.85,r*.77,Math.PI/2);
    if(tracked){
      for(const z of [l*.4,l*.65])p.add('ring',hydraulic,0,0,z,r*1.13,r*1.13,1.6);
      for(const s of [-1,1])p.box(exhaust,s*r*.69,0,l*.93,r*.12,r*.45,r*.5);
    }
  });
}

export function mobileModel(parts:Parts,kind:MobileKind){
  const model=new MobileModel(parts);
  if(kind==='mech')titan(model);
  else if(humanoid(kind))humanoidModel(model,kind);
  else if(kind==='tank'||kind==='artillery'||kind==='disruptor')trackedModel(model,kind);
  else if(kind==='fighter')fighter(model);
  else vehicle(model,kind);
  return model.rig;
}
