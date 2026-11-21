import type { Parts } from './model-parts.js';
import type { BuildingKind } from './types.js';
import { FactionModel, astral, stellarTrim, stellarArmor, photonic, strut, wave } from './faction-model-parts.js';
import { energyRing, focusEmitter, reactor } from './stellar-model-parts.js';

function pier(p:Parts,x:number,z:number,height:number,angle:number,width=13){
  const at=(offset:number)=>[x+Math.sin(angle)*offset,z+Math.cos(angle)*offset] as const;
  p.add('armorHull',astral,x,10+height*.4,z,width+3,height,width+4,0,angle);
  // 陶瓷外壳覆盖框架，前后留出金属边缘；饰条沿柱体自身朝向定位。
  const [shellX,shellZ]=at(1.7),[faceX,faceZ]=at(width*.5+2.2);
  p.add('armorHull',stellarArmor,shellX,12+height*.4,shellZ,width+1.5,height*.93,width+2,0,angle);
  p.add('armorPlate',stellarTrim,faceX,12+height*.4,faceZ,1.4,height*.71,1,0,angle);
  for(let i=0;i<3;i++){
    p.add('armorPlate',stellarArmor,faceX,12+i*height*.23,faceZ,width*.92,2.3,2,0,angle);
  }
  p.add('armorPlate','team',faceX,14+height*.6,faceZ+.1,width*.4,5,1.5,0,angle);
}

export function stellarBuilding(m:FactionModel,kind:BuildingKind){
  const base=kind==='base',node=kind==='node',tower=kind==='tower',well=kind==='oilwell';
  const r=base?44:node||tower||well?18:34;
  m.joint('root',[0,0,0],p=>{
    p.add('octagon',astral,0,3,0,r*1.93,6,r*1.93);
    p.add('octagon',stellarArmor,0,6,0,r*1.77,3,r*1.77);
    p.add('octagon',astral,0,8,0,r*1.48,3,r*1.48);
    energyRing(p,[0,10,0],r*1.34,false,8);
    for(let i=0;i<8;i++){
      const a=Math.PI/8+i*Math.PI/4,x=Math.sin(a),z=Math.cos(a);
      p.add('armorPlate',stellarArmor,x*r*.78,7,z*r*.78,r*.34,4,r*.3,0,a);
      strut(p,stellarTrim,[x*r*.48,10,z*r*.48],[x*r*.79,9,z*r*.79],r*.034);
      p.add('armorPlate',astral,x*r*.87,3,z*r*.87,r*.2,3,r*.13,0,a);
    }
  });

  if(kind==='warpHub'){
    m.at('root',p=>{
      for(const s of [-1,1]){
        p.add('armorHull',astral,s*24,13,-5,20,21,35,0,-s*.12);
        p.add('armorPlate',stellarArmor,s*24,16,5,16,15,26,0,-s*.12);
        for(const z of [-14,-6,2])p.add('armorPlate',stellarTrim,s*24,24,z,9,1.5,2);
      }
      p.add('armorPlate',astral,0,9,20,34,4,28);
      for(const z of [13,19,25])p.add('panel',stellarTrim,0,11.2,z,24,.6,1);
    });
    m.joint('gate',[0,42,-6],p=>{
      for(const s of [-1,1]){
        const turn=s<0?0:Math.PI;
        p.add('arch',astral,s*1.7,0,-3.5,70,77,15,0,-s*.12,turn);
        p.add('arch',stellarArmor,s*1.7,0,.9,66,73,12,0,-s*.12,turn);
        p.add('arch',stellarTrim,s*.8,0,4.5,59,66,4,0,-s*.1,turn);
        p.add('archConduit','lamp',s*.72,0,5.1,58,65,2,0,-s*.1,turn);
        p.add('armorHull',astral,s*24,-18,-1,15,29,25,.13,0,-s*.43);
        p.add('armorPlate',stellarArmor,s*25,-12,6,12,23,7,.22,0,-s*.46);
        p.add('armorPlate','team',s*28,-6,8.4,5.5,9,3,0,0,-s*.24);
        for(let i=0;i<4;i++){
          const a=(i+1)*.47,x=s*Math.sin(a)*29,y=Math.cos(a)*32;
          p.add('armorPlate',stellarArmor,x,y,5,10,7,5,0,0,-s*a);
          p.add('panel',stellarTrim,x,y,7.7,5,1.3,.8,0,0,-s*a);
        }
      }
      p.add('armorHull',astral,0,32,0,17,11,17);
      p.add('armorPlate',stellarArmor,0,34,4,14,9,11);
      p.add('shard',photonic,0,33,9,6,10,4);
    },'root');
    m.joint('seed',[0,42,-6],p=>{
      reactor(p,[0,0,0],11,24);
      energyRing(p,[0,-13,0],20,false,6);
    },'root',(b,s)=>{b.rotation.y=s.time*.3;b.position.y+=wave(s,1.8)*.7;});
    return;
  }

  if(tower){
    m.at('root',p=>{
      p.add('octagon',astral,0,18,0,19,19,19);
      for(const s of [-1,1])pier(p,s*10,-2,22,0,8);
      p.add('octagon',stellarTrim,0,30,0,21,3,21);
    });
    m.joint('emitter',[0,35,0],p=>{
      focusEmitter(p,18,27);
      p.add('armorHull',stellarArmor,0,1,-7,19,11,14);
      reactor(p,[0,3,-8],7,13);
      p.add('armorPlate','team',0,6,3,9,1.5,7);
    },'root',(b,s)=>{b.rotation.y=s.aim;b.position.z-=s.recoil*1.8;});
    return;
  }

  if(node){
    m.at('root',p=>{
      p.add('octagon',astral,0,16,0,16,12,16);
      for(let i=0;i<3;i++){
        const a=i*Math.PI*2/3;
        pier(p,Math.sin(a)*12,Math.cos(a)*12,31,a,7);
      }
    });
    m.joint('core',[0,34,0],p=>{
      reactor(p,[0,0,0],12,28);
      energyRing(p,[0,-10,0],22,false,6);
    },'root',(b,s)=>{b.position.y+=wave(s,1.6)*.55;b.rotation.y=s.time*.12;});
    return;
  }

  if(well||kind==='refinery'){
    m.at('root',p=>{
      if(well){
        p.add('octagon',astral,0,15,0,14,13,14);
        for(const s of [-1,1]){
          pier(p,s*11,0,26,0,8);
          strut(p,stellarTrim,[s*11,15,1],[s*5,27,1],2);
        }
      }else{
        p.add('armorHull',astral,0,17,-4,57,17,32);
        p.add('armorPlate',stellarArmor,0,24,-4,55,6,30);
        for(const s of [-1,1]){
          p.add('octagon',astral,s*17,24,-5,20,23,20);
          reactor(p,[s*17,36,-5],13,29);
          energyRing(p,[s*17,25,-5],23,false,6);
          p.add('armorHull',stellarArmor,s*18,16,16,19,16,21);
          for(const z of [10,16,22])p.add('panel',stellarTrim,s*18,24,z,12,1,1.2);
        }
      }
    });
    m.joint('core',[0,well?32:19,well?0:13],p=>{
      reactor(p,[0,0,0],well?11:9,well?28:17);
      energyRing(p,[0,0,0],well?23:17,false,6);
    },'root',(b,s)=>{b.rotation.y=s.time*(s.active?.5:.12);});
    return;
  }

  if(kind==='lumbermill'){
    m.at('root',p=>{
      p.add('armorHull',astral,0,16,-9,54,20,29);
      p.add('armorPlate',stellarArmor,0,26,-10,49,5,27);
      for(const x of [-19,0,19]){
        p.add('armorHull',astral,x,13,17,15,10,30);
        for(const s of [-1,1])p.add('armorPlate',stellarArmor,x+s*6,16,17,4,7,29);
        for(const z of [5,12,19,26])p.add('panel',stellarTrim,x,17,z,9,1,2);
        p.add('shard',photonic,x,21,7,7,11,7);
      }
      for(const s of [-1,1])pier(p,s*26,-12,22,0,9);
    });
    m.joint('cutter',[0,27,10],p=>{
      p.add('armorHull',astral,0,0,0,54,6,8);
      p.add('armorPlate',stellarArmor,0,2,0,52,3,7);
      for(const x of [-19,0,19]){
        p.add('armorHull',stellarTrim,x,-3,0,8,7,6);
        p.add('panel','lamp',x,-6,0,6,1,2);
      }
    },'root',(b,s)=>{b.position.z+=s.active?wave(s,2.2)*5:0;});
    return;
  }

  if(base){
    m.at('root',p=>{
      p.add('octagon',astral,0,20,-3,51,25,49);
      p.add('octagon',stellarArmor,0,30,-3,48,9,45);
      p.add('octagon',stellarTrim,0,35,-3,43,2,40);
      for(const s of [-1,1])for(const z of [-23,18]){
        pier(p,s*27,z,z<0?49:33,-s*.2,15);
        strut(p,stellarTrim,[s*27,29,z],[s*14,36,z*.5],2);
      }
      p.add('armorHull',astral,0,16,24,28,20,23);
      p.add('armorPlate',stellarArmor,0,26,25,31,5,24);
      p.add('armorPlate',astral,0,14,35,17,12,2);
      for(const s of [-1,1])p.add('panel',stellarTrim,s*9,15,36,1.5,12,1.2);
      p.add('armorPlate','team',0,25,36,15,3,1.5);
      for(const z of [37,40,43])p.add('armorPlate',stellarArmor,0,7-(z-37)*.5,z,24,3,6);
    });
    m.joint('core',[0,51,-3],p=>reactor(p,[0,0,0],20,35),'root',(b,s)=>{b.position.y+=wave(s,1.5)*.5;});
    m.joint('halo',[0,44,-3],p=>energyRing(p,[0,0,0],51,false,10),'root',(b,s)=>{b.rotation.y=s.time*.09;});
    return;
  }

  if(kind==='resonator'){
    m.at('root',p=>{
      p.add('armorHull',astral,0,17,-15,47,17,26);
      p.add('armorPlate',stellarArmor,0,24,-15,44,6,25);
      for(const s of [-1,1]){
        pier(p,s*24,-2,38,-s*.17,13);
        strut(p,astral,[s*24,38,-2],[s*14,45,-3],5);
        p.add('armorPlate',stellarArmor,s*16,44,-3,17,5,14,0,0,-s*.24);
        p.add('armorPlate',stellarTrim,s*15,43,4,10,2,2);
      }
      p.add('octagon',astral,0,14,9,32,7,32);
      energyRing(p,[0,18,9],31,false,8);
      for(const x of [-7,7])p.add('panel',stellarTrim,x,11,28,2,1,13);
    });
    m.joint('assembly',[0,28,8],p=>{
      reactor(p,[0,0,0],12,19);
      energyRing(p,[0,0,0],24,true,6);
    },'root',(b,s)=>{b.rotation.y=s.time*(s.active?.65:.12);b.position.y+=wave(s,2)*.5;});
    return;
  }

  // 相位圣所：三座承力塔围合球形星盘，留下穿透建筑的负空间。
  m.at('root',p=>{
    for(let i=0;i<3;i++){
      const a=Math.PI+i*Math.PI*2/3,x=Math.sin(a),z=Math.cos(a);
      pier(p,x*26,z*26,57,a,14);
      strut(p,astral,[x*25,55,z*25],[x*13,64,z*13],5);
      strut(p,stellarTrim,[x*25,57,z*25],[x*13,66,z*13],1.8);
      p.add('armorHull',stellarArmor,x*19,61,z*19,10,7,19,0,a);
    }
    p.add('octagon',astral,0,16,0,26,13,26);
    energyRing(p,[0,23,0],28,false,6);
  });
  m.joint('core',[0,43,0],p=>reactor(p,[0,0,0],15,29),'root',(b,s)=>{b.rotation.y=s.time*.16;});
  m.joint('halo',[0,44,0],p=>energyRing(p,[0,0,0],42,true,10),'root',(b,s)=>{
    b.rotation.y=s.time*(s.active?.35:.08);b.rotation.z=.28;
  });
  m.joint('orbit',[0,44,0],p=>energyRing(p,[0,0,0],33,false,8),'root',(b,s)=>{
    b.rotation.z=-.4;b.rotation.y=-s.time*.17;
  });
}
