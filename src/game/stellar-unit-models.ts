import type { Parts } from './model-parts.js';
import type { MobileKind } from './types.js';
import { FactionModel, astral, stellarTrim, stellarArmor, photonic, strut, wave, effort, working } from './faction-model-parts.js';
import { energyRing, focusEmitter, reactor } from './stellar-model-parts.js';

function hull(p:Parts,width:number,length:number){
  p.add('armorHull',astral,0,-2,0,width,9,length);
  p.add('armorPlate',stellarArmor,0,1,1,width*.93,5,length*.91);
  for(const s of [-1,1]){
    p.add('armorPlate','team',s*width*.3,3,1,width*.18,1.4,length*.4);
    strut(p,stellarTrim,[s*width*.37,2.4,-length*.28],[s*width*.31,3,length*.32],.9);
    p.add('armorPlate',astral,s*width*.36,0,-length*.24,width*.2,4,length*.18);
  }
}

export function stellarUnit(m:FactionModel,kind:MobileKind){
  const worker=kind==='worker',heavy=kind==='colossus',air=kind==='starWing';
  const guide=kind==='guide',arbiter=kind==='arbiter',weaver=kind==='weaver';
  const lancer=kind==='lancer',prism=kind==='prism';
  const width=heavy?33:worker?20:arbiter?25:air?23:18;
  const length=air?43:prism?33:worker?24:heavy?35:27;
  m.joint('root',[0,heavy?28:worker?13:18,0],p=>{
    hull(p,width,length);
    reactor(p,[0,worker?3:air?4:heavy?7:6,air?-7:-3],heavy?13:worker?7:8,worker?10:air?14:heavy?21:18);
    if(!heavy){
      energyRing(p,[0,-6,0],worker?17:20,false,6);
      p.add('octagon',photonic,0,-6,0,8,3,8);
    }
    if(heavy){
      for(const s of [-1,1]){
        p.add('armorHull',stellarArmor,s*13,3,-5,13,12,27,0,s*.14,-s*.18);
        for(const z of [-13,-5,3]){
          p.add('armorPlate',stellarArmor,s*14,9,z,9,3,7,0,s*.14);
          p.add('panel',stellarTrim,s*14,10,z,5,.8,1,0,s*.14);
        }
      }
    }
    if(worker){
      p.add('armorHull',astral,0,-1,11,13,6,12);
      p.add('armorPlate',stellarArmor,0,1,13,11,4,9);
      p.add('drum',stellarTrim,0,1,17,6,1,6,Math.PI/2);
      p.add('drum','lamp',0,1,17.6,3,.5,3,Math.PI/2);
      for(const s of [-1,1])p.add('armorHull',stellarArmor,s*9,-1,-8,8,8,13,0,-s*.22);
    }
  },undefined,(b,s)=>{
    b.position.y+=wave(s,2.4)*(heavy?.2:worker?.45:.7);
    b.rotation.x=s.weight*(heavy?.025:.07)-effort(s)*.05;
    b.rotation.z=-s.turn*.12+(s.fall??0)*.8;
  });

  if(worker){
    for(const s of [-1,1])m.joint('tool'+s,[s*8,-2,8],p=>{
      strut(p,astral,[0,0,0],[s*6,-2,9],3.2);
      p.add('armorPlate',stellarArmor,s*3,0,4,7,4,12,0,s*.5);
      p.add('jointBall',stellarTrim,s*6,-2,9,4,4,4);
      strut(p,stellarArmor,[s*6,-2,9],[s*2,-4,15],2.4);
      p.add('shard',photonic,s*2,-4,16,2.8,7,2.8,1.15,0,-s*.2);
    },'root',(b,s0)=>{
      b.rotation.y=s*(working(s0)?wave(s0,6)*.2:effort(s0)*.12);
      b.rotation.x=working(s0)?-.1+wave(s0,6)*.08:0;
    });
    return;
  }

  if(heavy){
    for(const s of [-1,1])for(const fore of [-1,1]){
      const knee:[number,number,number]=[s*12,-7,fore*7];
      const name='leg'+s+':'+fore;
      m.joint(name,[s*12,-3,fore*11],p=>{
        p.add('jointBall',stellarTrim,0,0,0,7,7,7);
        strut(p,astral,[0,0,0],knee,6);
        p.add('armorHull',stellarArmor,s*6,-3,fore*3,13,7,12,0,-s*fore*.4,s*.3);
        strut(p,stellarTrim,[0,2,1],[s*11,-4,fore*7],1.1);
        p.add('jointBall',astral,...knee,8,8,8);
      },'root',(b,pose)=>{
        const phase=pose.travel*.12+(s===fore?0:Math.PI);
        b.rotation.x=Math.sin(phase)*pose.weight*.1;
        b.rotation.z=s*Math.max(0,Math.cos(phase))*pose.weight*.08;
      });
      m.joint(name+'foot',knee,p=>{
        strut(p,astral,[0,0,0],[s*4,-15,fore*3],4);
        p.add('armorHull',stellarArmor,s*2,-6,fore*1.5,7,15,8,0,0,s*.23);
        strut(p,stellarTrim,[s*1,-1,3],[s*3,-12,fore*3+3],1);
        p.add('armorPlate',stellarArmor,s*4,-15,fore*4,10,4,14);
        p.add('armorPlate',astral,s*4,-16,fore*4,11,2,15);
      },name,(b,s0)=>{b.rotation.x=-Math.sin(s0.travel*.12+(s===fore?0:Math.PI))*s0.weight*.08;});
    }
    m.joint('emitter',[0,10,5],p=>{
      p.add('octagon',stellarTrim,0,-3,0,21,3,21);
      focusEmitter(p,22,32);
      p.add('armorPlate','team',0,6,4,11,1.5,9);
    },'root',(b,s)=>{b.position.z-=s.recoil*3;b.rotation.x=-effort(s)*.08;});
    return;
  }

  if(air){
    for(const s of [-1,1])m.joint('wing'+s,[s*9,0,-4],p=>{
      p.add('airfoil',astral,s*17,-1,-4,39,5,30,0,0,s<0?Math.PI:0);
      p.add('airfoil',stellarArmor,s*16,1,-2,35,3,26,0,0,s<0?Math.PI:0);
      for(let i=0;i<3;i++){
        p.add('armorPlate',stellarArmor,s*(9+i*8),2-i*.35,-3-i*3,9,2,16-i*3,0,-s*.35);
        strut(p,stellarTrim,[s*(5+i*8),3-i*.35,2-i*3],[s*(11+i*8),2.6-i*.35,-10-i*2],.85);
      }
      p.add('armorPlate','team',s*29,1,-10,8,1.5,9,0,-s*.4);
      p.add('armorHull',astral,s*10,-2,-13,10,8,23);
      p.add('armorPlate',stellarArmor,s*10,2,-15,9,4,19);
      for(const dz of [-22,-17,-12])p.add('panel',stellarTrim,s*10,4,dz,6,.65,1);
      p.add('ring',stellarTrim,s*10,-2,-24,7,7,2);
      p.add('drum','lamp',s*10,-2,-24,4,1,4,Math.PI/2);
      focusWingGun(p,s);
    },'root',(b,s0)=>{b.rotation.z=s*(wave(s0,2)*.018+effort(s0)*.06);});
    m.at('root',p=>{
      p.add('armorHull',stellarArmor,0,0,19,12,7,23);
      p.add('canopy',photonic,0,5,10,9,5,17);
      p.add('armorPlate',stellarTrim,0,2,27,2,2,12);
    });
    return;
  }

  if(lancer||prism){
    for(const s of [-1,1])m.joint('outrigger'+s,[s*11,0,-3],p=>{
      p.add('armorHull',astral,0,-1,0,9,9,30);
      p.add('armorPlate',stellarArmor,0,2,0,8,6,28,0,0,-s*.12);
      p.add('armorPlate','team',0,5,-5,4,1.2,9);
      if(lancer){
        strut(p,stellarTrim,[0,3,-1],[0,2,16],1.2);
        p.add('armorHull',astral,0,0,16,6,6,13);
        p.add('shard',photonic,0,0,28,5,26,5,Math.PI/2);
        p.add('ring',stellarTrim,0,0,19,7,7,1.6);
        for(const side of [-1,1])p.add('armorPlate',stellarArmor,side*2.8,0,22,2.6,4,16,0,-side*.1);
      }else for(const z of [-11,-4,3])p.add('armorPlate',stellarTrim,0,4.9,z,5,1.2,2);
    },'root',(b,s0)=>{b.position.z+=lancer?effort(s0)*2-s0.recoil*2:0;b.position.y+=wave(s0,2)*.2;});
    if(prism)m.joint('emitter',[0,5,5],p=>focusEmitter(p,17,34),'root',(b,s)=>{b.position.z-=s.recoil*3.5;});
    return;
  }

  // 支援三职分别使用双面盾、纵向星盘与四叶相位阵列。
  const count=arbiter?4:2;
  for(let i=0;i<count;i++){
    const a=arbiter?Math.PI/4+i*Math.PI/2:(i?1:-1)*Math.PI/2;
    const x=Math.sin(a),z=Math.cos(a),r=arbiter?18:weaver?15:11;
    m.joint('vane'+i,[x*r,0,z*r],p=>{
      const h=weaver?30:guide?22:19,w=weaver?13:guide?6:10;
      strut(p,stellarTrim,[-x*4,-3,-z*4],[0,2,0],2);
      p.add('armorHull',astral,0,3,0,w+2,h+2,8,0,a,-x*.12);
      for(let n=0;n<3;n++)for(const side of [-1,1]){
        p.add('armorPlate',stellarArmor,x*side*2.6,-h*.27+n*h*.3,z*side*2.6,w,h*.32,6,0,a,-x*.12);
      }
      p.add('armorPlate','team',x*2,3,z*2,w*.3,h*.6,3,0,a,-x*.12);
      strut(p,stellarTrim,[x*3,-h*.28,z*3],[x*3,h*.43,z*3],.85);
      p.add('shard',photonic,0,h*.44,0,w*.36,8,4,0,a);
    },'root',(b,s)=>{
      b.position.x+=x*effort(s)*(weaver?4:2);
      b.position.z+=z*effort(s)*2;
      b.rotation.z=x*(wave(s,2)*.025+effort(s)*.1);
    });
  }
  m.joint('halo',[0,guide?19:arbiter?17:4,guide?-5:-3],p=>{
    energyRing(p,[0,0,0],guide?28:arbiter?35:20,guide||arbiter,guide?6:8);
    if(guide){
      p.add('shard',stellarTrim,0,0,0,2,25,2,0,0,.38);
      p.add('jointBall','lamp',0,0,0,3,3,3);
    }
    if(arbiter)energyRing(p,[0,0,-2],24,true,4);
  },'root',(b,s)=>{
    b.rotation.y=wave(s,1.2)*(guide?.14:.08);
    if(!weaver)b.rotation.z=s.time*(guide?.16:-.1)+effort(s)*.2;
  });
}

function focusWingGun(p:Parts,s:number){
  p.add('armorHull',astral,s*5,-2,8,5,5,20);
  p.add('armorPlate',stellarArmor,s*5,0,10,4,3,17);
  p.add('drum',stellarTrim,s*5,-2,18,3.4,1,3.4,Math.PI/2);
  p.add('drum','lamp',s*5,-2,18.6,1.8,.5,1.8,Math.PI/2);
}
