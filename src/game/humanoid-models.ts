import { dark, glass, paint, type Parts } from './model-parts.js';
import { canvas, ceramicArmor, circuitry, composite, cross, expedition, federal, fieldRubber, gold, medical, sand, service, strut } from './faction-model-parts.js';
import { legLengths, sides } from './unit-rig.js';
import type { MobileModel } from './mobile-models.js';
import type { MobileKind } from './types.js';

const undersuit=paint('undersuit',0x677379,1.16);
const recon=paint('scoutCloth',0x7d8260,1.16);
const coat=paint('scoutCloth',0x66798c,1.18);
// 皮肤只承受轻微污渍；借用色板 UV 不代表它是会生锈的装甲。
const skin=paint('insignia',0xb49b7d,1,[.85,0,.05],.1,[.2,0,.1,0]);
const red=paint('medicalComposite',0xb34836,1.1);
const weapon=paint('weapon',0x889599,1.2);

/** 共用步态关节契约，兵种的衣着、负重与武器独立建形。 */
export function humanoidModel(m:MobileModel,kind:MobileKind){
  const soldier=kind==='soldier',medic=kind==='medic',sniper=kind==='sniper';
  const commander=kind==='commander',engineer=kind==='pathfinder',observer=kind==='observer';
  const relay=engineer||observer||kind==='ranger',cloaked=sniper||observer;
  const soft=commander?coat:relay?canvas:sniper?recon:undersuit;
  const shell=medic?medical:relay?composite:ceramicArmor;
  const width=soldier?17:medic?12.5:commander?14:engineer?15:12;
  const shoulders=width/2+1,legWidth=soldier?4.7:engineer?4.3:3.7;
  const [thigh,shin,ankle]=legLengths(false);
  m.joint('hips',[0,thigh+shin+ankle,0],undefined,p=>{
    p.add('bevel',soft,0,0,0,10,5,7);
    p.add('panel',dark,0,1,0,11,1.4,8);
    p.box(service,0,1,4.1,2,1.6,.6);
    for(const s of [-1,1]){
      p.add('bevel',engineer?expedition:soft,s*5.8,0,0,3,4,4);
      p.add('box',shell,s*5.8,.3,2,1.5,1,.5);
    }
  });
  m.joint('torso',[0,3.8,0],'hips',p=>{
    p.add('bevel',soft,0,5,0,width,12,7.5);
    if(soldier){
      for(const s of [-1,1])p.add('armorHull',shell,s*4.3,7,2,8.5,9,8,0,s*.08);
      p.add('panel',shell,0,8,6,6,6,1.4);
      p.add('panel','team',-5,8,6.5,2.5,2,.7);
      p.add('panel',shell,0,2,4.6,11,3,2);
      p.add('bevel',circuitry,0,7,-5,11,12,5);
      for(const s of [-1,1]){
        p.add('bevel',weapon,s*5,2,6,3.2,4.5,2.6);
        p.add('panel',service,s*5,7,6.2,.6,7,.5);
      }
    }else if(medic){
      p.add('panel',medical,0,7,3.2,12,8,3);
      cross(p,0,8,4.85,4.5,red);
      p.add('bevel',medical,0,6,-5,10,12,5);
      for(const s of [-1,1]){
        p.add('drum',medical,s*5.8,6,-6,3.8,12,3.8);
        p.add('drum',red,s*5.8,8,-6,4,2,4);
        strut(p,service,[s*6,1,-6],[s*6,11,-6],.7);
      }
    }else if(commander){
      // 长外套分成两侧衣摆，独立于膝关节，保留行走空间。
      for(const s of [-1,1]){
        p.add('panel',coat,s*4.4,-3,-2,6.4,16,7,0,0,-s*.09);
        p.add('panel',gold,s*7.6,11,0,4,1.5,6);
        p.add('panel',coat,s*4,10,3,3,6,2,0,0,s*.35);
      }
      p.add('panel',dark,0,12,-.7,10,4,6);
      for(const y of [2,5,8])p.add('pin',gold,1,y,4.1,.8,.6,.8,Math.PI/2);
      p.add('panel','team',-4,8,4.2,3,2,.6);
    }else if(cloaked){
      p.add('carapace',soft,0,10,-1,width+6,6,12);
      // 后披风收拢于肩部、向下展开；不再使用胸甲换色充当侦察兵。
      p.add('panel',soft,0,-1,-5,width+5,24,1.2,-.12);
      for(const s of [-1,1]){
        p.add('panel',soft,s*(width*.5),1,-3,4,21,2,0,0,-s*.13);
        p.add('panel',canvas,s*width*.36,4,-5.8,1.25,14,.7,-.12,0,-s*.17);
      }
      p.add('bevel',canvas,0,5,-7,8,11,4);
      if(observer){
        strut(p,service,[-4,7,-8],[-4,24,-8],.9);
        p.add('bevel',circuitry,-4,24,-8,8,4,4);
        p.add('dome',glass,-4,24,-5.8,3,2.8,1);
      }
    }else{
      for(const s of [-1,1]){
        p.add('panel',expedition,s*4.4,6,4,1.5,11,1);
        p.add('bevel',canvas,s*4,2,4.6,4,4,2.6);
      }
      p.add('bevel',canvas,0,6,-6,12,14,7);
      if(engineer){
        for(const s of [-1,1])p.add('drum',service,s*4,8,-10,3.5,14,3.5);
        strut(p,service,[7,-1,-4],[7,13,-4],1.5);
        p.add('panel',sand,7,13,-4,5,3,1.5);
        p.add('panel',dark,0,3,4.5,6,6,1);
      }else{
        p.add('drum',recon,0,14,-6,5,14,5,0,0,Math.PI/2);
        for(const s of [-1,1])p.add('panel',expedition,s*4,14,-6,1,6,6);
      }
    }
    if(relay){
      p.add('panel',sand,0,10,3.9,6,1.2,1.5);
      for(const s of [-1,1])p.add('panel',expedition,s*3.8,6,4.4,1.05,7.5,.65,0,0,s*.24);
    }
    if(!commander)p.add('panel','team',-width*.37,8,4.7,2.2,3,.65);
  });
  m.at('torso',p=>p.add('sleeve',soft,0,0,0,9,5,7),true);
  m.joint('head',[0,14,1],'torso',p=>{
    if(soldier){
      p.add('dome',shell,0,1,0,10,8,10);
      p.add('bevel',shell,0,-1,1,9,4,9);
      p.add('panel',glass,0,1,4.7,7,2,1.1);
      p.add('panel',weapon,0,-1.7,5,5,2,1.3);
      for(const s of [-1,1])p.add('panel',federal,s*3.5,1,4,2.5,2.6,2,0,s*.42);
    }else if(cloaked){
      p.add('carapace',soft,0,1,-.5,11,11,11);
      p.add('carapace',dark,0,.2,4.1,7,6,2.2);
      p.add('panel',observer?glass:skin,0,.8,5,5,1.5,.8);
      p.add('carapace',soft,0,-2,4.4,8,3,3);
      if(observer)p.add('drum','lamp',-2,1,5.7,1.8,1.5,1.8,Math.PI/2);
    }else{
      p.add('dome',skin,0,0,0,7.5,8,7.5);
      p.add('carapace',medic?medical:commander?coat:sand,0,2,-.3,9,5,9);
      if(commander){
        p.add('panel',coat,0,3.4,0,10,2,9);
        p.add('panel',dark,0,1.8,4,8,.8,4);
        p.add('panel',gold,0,2,4,3,.65,.6);
      }else if(engineer){
        p.add('panel',sand,0,1,1,11,1,10);
        p.add('panel',glass,0,-.2,4,7,3,1);
        p.add('panel',sand,0,4,0,1.5,1,7);
      }else if(medic){
        cross(p,0,3,3.8,3,red);
        p.add('drum',medical,-4,0,0,3,1.5,3,0,0,Math.PI/2);
      }else p.add('panel',sand,0,2,4,8,1,4);
    }
    p.add('panel','lamp',-2,.6,4.9,soldier?1.6:.7,.45,.3);
  });
  for(const [i,side] of sides.entries()){
    const s=i===0?-1:1;
    m.joint(side+'Leg',[s*4.1,0,0],'hips',p=>{
      p.add('bevel',soft,0,-thigh*.48,0,legWidth,thigh,legWidth);
      if(soldier||medic)p.add('panel',shell,0,-3,2,legWidth,5,1.7);
      if(engineer)p.add('panel',expedition,s*2,-3,0,1,5,3);
    });
    m.joint(side+'Knee',[0,-thigh,0],side+'Leg',p=>{
      p.add('bevel',soft,0,-shin*.44,0,legWidth*.87,shin*.95,legWidth*.9);
      p.add('carapace',soldier?shell:fieldRubber,0,-.5,1.6,legWidth,3,2);
      if(soldier)p.add('panel',shell,0,-4,2,3.8,5,1.4);
    });
    m.at(side+'Knee',p=>p.add('sleeve',soft,0,0,0,3,3.3,3),true);
    m.joint(side+'Foot',[0,-shin,0],side+'Knee',p=>{
      p.add('bevel',fieldRubber,0,-ankle*.38,1.7,legWidth*1.1,ankle*1.1,6.5);
      p.box(dark,0,-ankle*.87,1.6,legWidth*1.1,.5,6.8);
      p.add('panel',shell,0,-ankle*.35,3.65,legWidth*.92,1.2,2.3,-.2);
    });
    m.joint(side+'Arm',[s*shoulders,9.5,0],'torso',p=>{
      p.add('bevel',soft,0,-3,0,3.5,7,4);
      if(soldier||medic||engineer)p.add('armorHull',shell,s*.5,.5,0,soldier?6:4.5,soldier?6:4,6);
      if(soldier||medic||engineer){
        p.add('panel',dark,s*(soldier?1.55:1.22),-1.3,.15,soldier?4.1:3.5,1.1,5.1,0,0,-s*.18);
        p.add('panel',shell,s*(soldier?1.65:1.32),-1.9,.25,soldier?4.1:3.4,1,5.2,0,0,-s*.18);
      }
      if(i===1)p.add('panel','team',s*2.7,0,0,.6,2.7,3);
    });
    m.joint(side+'Elbow',[0,-6.5,0],side+'Arm',p=>{
      p.add('bevel',soldier?shell:soft,0,-2.6,.4,soldier?4.4:3.2,5.3,3.6);
      if(relay||soldier)p.add('panel',shell,0,-3.1,2.2,soldier?3.3:2.7,3.15,.8);
    });
    m.at(side+'Elbow',p=>p.add('sleeve',soft,0,0,0,3,3,3),true);
    m.joint(side+'Hand',[0,-5.4,0],side+'Elbow',p=>{
      p.add('bevel',fieldRubber,0,0,.7,2.7,3,2.7);
      if(i===0){
        if(commander||observer){
          p.add('panel',circuitry,0,1,3,6,.8,8);
          p.add('panel',glass,0,1.5,3,4.5,.3,6);
        }
        return;
      }
      handEquipment(p,kind);
    });
  }
}

function handEquipment(p:Parts,kind:MobileKind){
  if(kind==='medic'){
    p.add('bevel',medical,0,1.8,3,4,4,9);
    p.add('drum',glass,0,3,3,2.5,5,2.5,Math.PI/2);
    for(const x of [-1.2,1.2])p.add('pin',service,x,1,9,.8,5,.8,Math.PI/2);
    p.add('panel','lamp',0,2,7,2,1,.7);
  }else if(kind==='pathfinder'){
    p.add('bevel',sand,0,1.5,3,4,4,8);
    p.add('drum',service,0,1.5,9,2,7,2,Math.PI/2);
    p.add('horn',service,0,1.5,13,3,4,3,Math.PI/2);
  }else{
    const sniper=kind==='sniper',sidearm=kind==='commander'||kind==='observer';
    const length=sniper?24:sidearm?6:kind==='ranger'?12:14;
    p.add('bevel',weapon,0,1.5,2,sidearm?2:3.6,sidearm?2:3.8,length*.63);
    p.add('drum',weapon,0,1.7,length*.62,sidearm?1:1.7,length*.68,sidearm?1:1.7,Math.PI/2);
    p.add('drum',dark,0,1.7,length*.96,2.4,2,2.4,Math.PI/2);
    if(!sidearm){
      p.add('panel',expedition,0,-.6,2,2,4,3);
      p.add('panel',dark,0,3.7,2,2,.8,6);
    }
    if(sniper){
      p.add('drum',weapon,0,4.8,3,2.6,8,2.6,Math.PI/2);
      p.add('drum',glass,0,4.8,7.1,2.2,.5,2.2,Math.PI/2);
      for(const s of [-1,1])strut(p,service,[0,0,14],[s*2,-3,17],.6);
    }
  }
}
