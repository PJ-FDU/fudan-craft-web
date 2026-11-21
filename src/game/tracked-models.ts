import { dark, glass, paint } from './model-parts.js';
import { ceramicArmor, circuitry, federal, service, strut } from './faction-model-parts.js';
import { sides, wheelLayout } from './unit-rig.js';
import type { MobileModel } from './mobile-models.js';
import type { MobileKind } from './types.js';

const track=paint('track',0x727f84,1.13),gun=paint('weapon',0x9baeb7,1.2);

/** 主战坦克、敞开式自行炮、电子战车具有各自的上车体与轴距。 */
export function trackedModel(m:MobileModel,kind:MobileKind){
  const artillery=kind==='artillery',jammer=kind==='disruptor';
  const width=artillery?30:jammer?34:42,length=artillery?66:jammer?49:53;
  m.joint('chassis',[0,0,0],undefined,p=>{
    p.add('bevel',dark,0,7,0,width,9,length);
    for(const s of [-1,1]){
      p.add('bevel',track,s*width/2,7,0,9,12,length+2);
      p.add('panel',federal,s*width/2,13,0,11,2,length+3);
      for(const z of [-length*.31,length*.31]){
        p.add('bevel',service,s*(width*.5+3.2),10,z,2.2,4.3,11);
        p.add('ring',gun,s*(width*.5+4.5),10,z,4.4,4.4,1.1,0,Math.PI/2);
      }
      for(let n=0;n<14;n++){
        const z=-length*.46+n*length*.071;
        p.box(service,s*width/2,1,z,9.5,1.2,2.5);
        p.box(track,s*(width/2+4.6),7,z,.8,8,2.4);
      }
    }
  });
  for(const [i,side] of sides.entries())for(const [j,z] of wheelLayout(kind).entries()){
    const s=i===0?-1:1;
    m.joint(side+'Wheel'+j,[s*width*.5,7,z],'chassis',p=>{
      p.add('drum',track,0,0,0,10,7,10,0,0,Math.PI/2);
      p.add('drum',federal,s*4,0,0,7,1.2,7,0,0,Math.PI/2);
      p.add('pin',service,s*4.8,0,0,2.5,1,2.5,0,0,Math.PI/2);
      p.box(dark,s*5,2,0,.5,2,1);
    });
  }
  m.joint('body',[0,12,0],'chassis',p=>{
    p.add('armorHull',federal,0,1,0,width*.95,6,length*.9);
    if(artillery){
      p.add('bevel',federal,0,5,22,27,11,17);
      p.add('panel',glass,-6,8,29,9,3,1);
      for(const s of [-1,1]){
        p.box(service,s*12,4,-16,2,4,23);
        p.add('panel',federal,s*11,5,-28,7,10,7,-.3);
        strut(p,service,[s*11,2,-22],[s*15,-7,-32],2.5);
        p.add('panel',dark,s*15,-7,-32,10,3,8);
        for(const z of [-17,-10,-3])p.add('drum',gun,s*10,6,z,2,9,2);
        p.add('panel',service,s*12,2,-9,2,6,15,-.18);
      }
    }else if(jammer){
      p.add('bevel',federal,0,9,-3,30,17,32);
      p.add('panel',circuitry,0,18,-3,24,2,24);
      for(const s of [-1,1]){
        p.add('bevel',circuitry,s*16,5,-8,4,9,21);
        strut(p,service,[s*11,14,-15],[s*11,34,-15],1);
        p.add('panel',service,s*16.3,10,-5,1.4,3,13,-.14);
      }
      for(let n=0;n<5;n++)p.box(dark,0,10+n*1.3,13,17,.65,1);
    }else{
      p.add('armorHull',federal,0,4,8,40,9,32,-.08);
      p.add('armorPlate',ceramicArmor,0,5.7,15,31,4.1,19,-.25);
      for(const s of [-1,1])for(const z of [-17,-7,3,13,23]){
        p.add('panel',federal,s*25,1,z,2,7,8.5);
        p.add('pin',service,s*26.2,2,z,1,.8,1,0,0,Math.PI/2);
      }
      p.add('panel',circuitry,0,5,-17,24,2,13);
      for(let n=0;n<6;n++)p.box(service,0,6.3,-22+n*1.8,22,.5,.6);
    }
    p.box('team',0,5,length*.46,width*.44,2.5,1);
    for(const s of [-1,1])p.box('lamp',s*width*.32,3,length*.47,2.4,1.6,1);
  });
  m.joint('turret',[0,jammer?20:artillery?6:10,artillery?-8:-2],'body',p=>{
    p.add('drum',service,0,0,0,jammer?14:22,2,jammer?14:22);
    if(jammer){
      p.add('bevel',circuitry,0,4,0,9,8,9);
    }else if(artillery){
      for(const s of [-1,1]){
        p.add('panel',federal,s*8,4,0,3,11,14);
        p.add('drum',service,s*8,7,1,6,4,6,0,0,Math.PI/2);
      }
      p.add('bevel',gun,0,4,-5,10,8,12);
    }else{
      p.add('armorHull',federal,0,3,0,31,8,28);
      for(const s of [-1,1]){
        p.add('armorHull',ceramicArmor,s*12,3,8,11,8,16,0,s*.28);
        for(const z of [-5,1,7])p.add('panel',federal,s*17,4,z,2,5,5);
        for(const z of [-5,0])p.add('drum',gun,s*15,7,z,2.1,4,2.1,0,0,s*.6);
      }
      p.add('drum',gun,7,8,-5,7,2,7);
      p.add('panel',glass,-5,8,5,5,2,2);
      strut(p,service,[-10,5,-9],[-10,22,-9],.7);
      p.box('team',0,7.3,-7,9,1,7);
    }
  });
  m.joint('barrel',[0,jammer?8:5,3],'turret',p=>{
    if(jammer){
      // 垂直相控阵取代炮管，主识别特征来自电子设备而非坦克炮塔。
      p.add('panel',federal,0,6,0,26,21,3,-.12);
      p.add('panel',circuitry,0,6,2,22,17,1,-.12);
      for(const x of [-8,-4,0,4,8])for(const y of [0,4,8,12]){
        p.add('panel',service,x,y,2.8,2.4,2.4,.4,-.12);
      }
      p.add('panel','team',0,18,0,13,2,2);
      p.add('pin','lamp',0,19,0,1.7,2,1.7);
    }else{
      const length=artillery?47:30,r=artillery?4.2:4.7;
      p.add('bevel',gun,0,0,3,artillery?9:11,8,12);
      p.add('drum',gun,0,0,length*.52,r,length*.88,r,Math.PI/2);
      p.add('bevel',service,0,0,length,artillery?8:6,artillery?5:6,5);
      p.add('drum',dark,0,0,length+2.6,r*.72,.7,r*.72,Math.PI/2);
      for(const z of [length*.3,length*.65])p.add('ring',service,0,0,z,r*1.2,r*1.2,1);
      if(artillery)for(const s of [-1,1]){
        p.add('drum',service,s*4,-2,8,2,22,2,Math.PI/2);
        p.add('drum',gun,s*4,-2,0,3,9,3,Math.PI/2);
        p.box(dark,s*4.1,0,length,1,2,3);
      }
    }
  });
}
