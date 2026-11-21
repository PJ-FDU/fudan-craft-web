import { dark, glass, type Parts } from './model-parts.js';
import { FactionModel, sand, composite, expedition, canvas, circuitry, service, fieldRubber, strut, dish, lens, effort, working, wave } from './faction-model-parts.js';
import type { MobileKind, BuildingKind } from './types.js';

function wheel(p:Parts,s:number){
  p.add('tire',fieldRubber,0,0,0,13,6,13,0,0,Math.PI/2);
  p.add('drum',dark,0,0,0,7.8,5.6,7.8,0,0,Math.PI/2);
  p.add('drum',sand,s*3.2,0,0,7,1.3,7,0,0,Math.PI/2);
  p.add('pin',service,s*4,0,0,3,1.2,3,0,0,Math.PI/2);
  p.add('ring',expedition,s*3.9,0,0,7.2,7.2,1.3,0,Math.PI/2);
  for(let n=0;n<5;n++){
    const a=n*2*Math.PI/5;
    p.add('pin',service,s*4.1,Math.cos(a)*2.45,Math.sin(a)*2.45,.9,.6,.9,0,0,Math.PI/2);
  }
  for(let n=0;n<12;n++){
    const a=n*Math.PI/6;
    for(const side of [-1,1])p.add('box',fieldRubber,side*1.19,Math.cos(a)*6.32,Math.sin(a)*6.32,2.7,.67,1.65,a,side*.32);
  }
}
function cabin(p:Parts,w:number,z:number,open=false){
  p.add('armorHull',expedition,0,3.5,z+5,w,7.5,15,-.09);
  p.add('armorPlate',composite,0,6.7,z+7,w*.96,4.2,12,.16);
  p.add('armorPlate','team',0,8.7,z+7,w*.46,1.15,5.5,.16);
  p.add('panel',dark,0,4.8,z+12.1,w*.65,4.4,1.25,-.1);
  for(const y of [3.8,4.9,6])p.box(service,0,y,z+12.86,w*.60,.46,.4);
  p.add('armorHull',composite,0,1.1,z+11.2,w*1.02,4.5,5.4);
  p.add('panel',expedition,0,.8,z+13.6,w*.59,1.6,1.7);
  for(const s of [-1,1]){
    p.add('bevel',canvas,s*w*.24,5,z-6,6,8,6);
    strut(p,expedition,[s*w*.46,0,z+3],[s*w*.46,17,z],1.6);
    strut(p,expedition,[s*w*.46,17,z],[s*w*.46,16,z-11],1.6);
    strut(p,expedition,[s*w*.46,16,z-11],[s*w*.46,0,z-12],1.6);
    p.add('armorPlate',composite,s*w*.46,4,z+7.5,5,4.5,13,0,s*.14,-s*.22);
    p.add('armorPlate',dark,s*w*.35,5.7,z+12,4,3,2.3,0,s*.14);
    p.box('lamp',s*w*.35,5.9,z+13.1,2.3,1.1,.8);
    if(!open){
      p.add('armorPlate',composite,s*w*.45,6.1,z-6,3.2,8.2,13,0,0,-s*.11);
      p.add('panel',service,s*w*.50,7.6,z-10,1.8,.8,3.4,0,0,-s*.11);
    }
  }
  if(!open){
    p.add('canopy',glass,0,11.7,z-5,w*.97,10.5,17);
    p.add('armorPlate',composite,0,16.8,z-7,w*.94,3.6,15,-.12);
    p.add('panel',expedition,0,11.6,z+2.8,1.12,8,.9,-.36);
    for(const x of [-w*.26,w*.26])p.add('panel',expedition,x,17.8,z-5,1.1,1.8,11,-.12);
  }else{
    strut(p,expedition,[-w*.46,17,z],[w*.46,17,z],1.5);
    strut(p,expedition,[-w*.46,16,z-11],[w*.46,16,z-11],1.5);
  }
}

export function expeditionUnit(m:FactionModel,kind:MobileKind|'assembly',packed:boolean){
  const air=kind==='relayWing',flak=kind==='flak',escort=kind==='escort',worker=kind==='worker';
  const w=packed?37:flak||escort?28:24,l=packed?66:flak||escort?63:worker?39:43;
  m.joint('root',[0,0,0],p=>{
    for(const s of [-1,1])p.box(expedition,s*w*.32,8,0,3,4,l);
    p.add('panel',dark,0,10,0,w,2,l);
    if(!air)for(const z of [-l*.32,l*.32])strut(p,service,[-w*.55,6.5,z],[w*.55,6.5,z],2);
  });
  m.joint('body',[0,11,0],p=>{
    if(air){
      p.add('armorHull',composite,0,5,0,23,14,48);
      p.add('canopy',glass,0,9,12,15,8,21);
      p.add('panel','team',0,11,-9,9,1,8);
      p.add('airfoil',sand,0,6,-22,18,2.3,19,0,-Math.PI/2);
      strut(p,expedition,[0,7,-14],[0,12,-28],1.8);
    }else if(packed){
      cabin(p,26,20);
      p.add('armorHull',expedition,0,11,-12,35,21,34);
      p.add('scute',canvas,0,22,-12,33,12,36);
      for(const s of [-1,1]){
        p.box(expedition,s*14,15,-12,2,25,36);
        strut(p,service,[s*14,26,-28],[s*14,26,6],2);
        for(const z of [-25,-12,1])strut(p,expedition,[s*15,5,z],[s*15,24,z],1.3);
      }
      p.box('team',0,25,-12,12,1,12);
    }else if(escort){
      cabin(p,w,19);
      p.add('armorHull',composite,0,11,-14,28,21,32);
      p.add('scute',canvas,0,19.5,-14,28,11,33);
      for(const s of [-1,1]){
        for(const z of [-25,-15,-5])p.add('panel',expedition,s*13.5,11,z,1,22,1.2);
        p.add('panel','team',s*14,15,-13,1,4,12);
      }
      p.add('panel',expedition,0,23,-14,28,2,34);
      p.add('bevel',circuitry,0,26,-18,10,5,9);
      strut(p,service,[-8,22,-24],[-8,42,-24],.8);
    }else if(flak){
      cabin(p,w,19);
      p.add('panel',expedition,0,2,-13,w,2,34);
      for(const s of [-1,1]){
        p.add('bevel',canvas,s*11,5,-24,6,7,10);
        strut(p,expedition,[s*13,2,-26],[s*13,9,-26],1.3);
        strut(p,expedition,[s*13,9,-26],[s*13,9,-4],1.3);
      }
    }else{
      cabin(p,worker?21:24,worker?-2:3,true);
      if(!worker){
        p.add('bevel',canvas,0,5,-18,16,7,8);
        p.add('drum',fieldRubber,0,9,-21,12,4,12,Math.PI/2);
        p.add('drum',sand,0,9,-23.3,7,1,7,Math.PI/2);
      }
    }
    if(!air)for(const s of [-1,1])for(const z of [-l*.32,l*.32]){
      p.add('panel',sand,s*w*.52,1,z,7,2,16);
      p.add('panel',expedition,s*w*.52,2.1,z-1,5,.5,10);
    }
  },'root',(b,s)=>{b.rotation.x=Math.sin(s.travel*.25)*s.weight*.025+s.recoil*.03;b.rotation.z=-s.turn*.06;});
  if(air){
    for(const s of [-1,1])m.joint('wing'+s,[s*8,4,-1],p=>{
      p.add('airfoil',canvas,s*20,0,-2,40,1.5,20,0,0,s<0?Math.PI:0);
      strut(p,expedition,[0,0,5],[s*37,0,-5],1.3);
      strut(p,expedition,[s*10,-6,-11],[s*31,0,-9],1);
      strut(p,expedition,[s*9,.9,3],[s*9,.9,-9],.72);
      strut(p,expedition,[s*29,.6,-2],[s*29,.6,-10],.72);
      p.add('bevel',expedition,s*23,0,-6,7,6,19);
      p.add('drum','lamp',s*23,0,-16,3.5,1,3.5,Math.PI/2);
      p.add('panel','team',s*25,1,-4,9,.7,8);
      p.add('panel',sand,s*10,7,-24,2,14,12,0,0,-s*.2);
    },'body',(b,s0)=>{b.rotation.z=-s0.turn*.2;});
    return;
  }
  const zs=packed||flak||escort?[-l*.34,-l*.05,l*.34]:[-l*.32,l*.32];
  for(const s of [-1,1])for(const [i,z] of zs.entries()){
    m.joint('wheel'+s+i,[s*w*.56,6.5,z],p=>wheel(p,s),'root',
      (b,s0)=>{b.rotation.x=s0.travel/6.5;b.position.y+=Math.sin(s0.travel*.2+i)*s0.weight*.35;});
  }
  if(packed)return;
  if(escort){
    m.joint('dish',[0,39,-14],p=>dish(p,15,sand),'root',(b,s)=>{b.rotation.y=s.time*.5;});
  }else if(worker){
    m.joint('loader',[0,4,9],p=>{
      for(const s of [-1,1]){
        strut(p,sand,[s*7,0,0],[s*7,2,18],3.3);
        strut(p,service,[s*7,-2,1],[s*7,0,13],1.8);
      }
      p.add('bevel',expedition,0,-1,20,21,7,9,-.3);
      for(const x of [-8,-4,0,4,8])p.box(service,x,-4,24,2,2,4);
    },'body',(b,s)=>{b.rotation.x=working(s)?.2+wave(s,6)*.15:-.1;});
  }else{
    m.joint('turret',[0,flak?6:18,flak?-15:-6],p=>{
      p.add('drum',expedition,0,0,0,flak?19:7,3,flak?19:7);
      if(flak)for(const s of [-1,1]){
        p.add('armorHull',composite,s*9,5,-1,5.5,12,18,.13,0,s*.14);
        p.add('armorPlate',expedition,s*12,3,-1,4.5,7,11,.13,0,s*.14);
        p.add('pin',service,s*13.3,5,-1,3,1.9,3,0,0,Math.PI/2);
      }
      else strut(p,expedition,[0,-6,0],[0,3,0],2);
      p.box('team',0,3,-4,flak?9:4,1,5);
    },'body',(b,s)=>{b.rotation.y=s.turn*.3;});
    m.joint('barrel',[0,5,3],p=>{
      for(const x of flak?[-5,5]:[0]){
        p.add('bevel',expedition,x,0,1,flak?4:3,4,10);
        p.add('drum',service,x,0,flak?14:8,flak?2.6:1.6,flak?28:16,flak?2.6:1.6,Math.PI/2);
        p.add('ring',dark,x,0,flak?28:16,flak?3.5:2.4,flak?3.5:2.4,1);
        p.add('drum',dark,x,0,flak?28.5:16.5,flak?2.3:1.4,.4,flak?2.3:1.4,Math.PI/2);
      }
      if(flak)lens(p,0,3,3,3);
    },'turret',(b,s)=>{b.position.z-=s.recoil*2;b.rotation.x=flak?-.4-effort(s)*.28:0;});
  }
}

function feet(p:Parts,w:number,d:number){
  for(const s of [-1,1])for(const z of [-d*.4,d*.4]){
    strut(p,expedition,[s*w*.33,7,z],[s*w*.49,1,z],2.5);
    p.add('panel',service,s*w*.49,1,z,9,1.5,8);
  }
}
function shelter(p:Parts,x:number,z:number,w:number,h:number,d:number){
  // 双坡帆布与外露支架，底部留空，不复用联邦的封闭建筑盒体。
  for(const s of [-1,1]){
    p.add('scute',canvas,x+s*w*.25,h-3,z,w*.56,3.8,d,0,0,-s*.24);
    strut(p,expedition,[x+s*w*.49,h-5,z-d*.49],[x+s*w*.49,h-5,z+d*.49],1.25);
    for(const i of [-2,-1,0,1,2]){
      const beamZ=z+i*d*.235;
      strut(p,i%2?canvas:expedition,[x,h,beamZ],[x+s*w*.49,h-6,beamZ],i%2?.7:1.27);
    }
    for(const end of [-1,1]){
      strut(p,expedition,[x+s*w*.46,3,z+end*d*.43],[x+s*w*.46,h-6,z+end*d*.43],1.5);
      strut(p,canvas,[x+s*w*.46,h-7,z+end*d*.43],[x+s*w*.67,1,z+end*d*.58],.65);
    }
    p.add('panel',canvas,x+s*w*.47,h*.48,z,1,h*.65,d*.95);
  }
  p.add('panel',canvas,x,h*.48,z-d*.48,w*.91,h*.65,1);
  strut(p,expedition,[x,h,z-d*.48],[x,h,z+d*.48],1.4);
  p.add('panel',expedition,x,h-5,z+d*.485,w*.87,1.35,1.4);
  p.add('panel','team',x,h-1,z+d*.25,w*.25,.8,7);
}
function cargo(p:Parts,x:number,y:number,z:number,w=14,d=16){
  p.add('bevel',canvas,x,y,z,w,9,d);
  for(const s of [-1,1]){
    p.add('panel',expedition,x+s*w*.27,y,z,1,10,d+.5);
    p.add('panel',sand,x+s*w*.27,y,z+d*.51,2,2,.65);
  }
}

export function expeditionBuilding(m:FactionModel,kind:BuildingKind){
  const base=kind==='base',mast=kind==='relayTower',tower=kind==='tower',well=kind==='oilwell';
  const w=base?94:mast||tower||well?32:76,d=base?87:mast||tower||well?33:69;
  m.joint('root',[0,0,0],p=>{
    feet(p,w,d);
    if(mast||tower||well){
      p.add('panel',expedition,0,5,0,25,3,26);
      cargo(p,-6,10,-4,10,13);
      for(const x of [-10,10])p.add('panel',sand,x,3,7,3,2,12);
    }else if(base){
      p.add('panel',expedition,-15,7,-3,44,3,67);
      shelter(p,-14,-5,42,37,61);
      p.add('bevel',sand,25,18,-17,22,27,29);
      p.add('panel',glass,25,22,-1,14,6,1);
      shelter(p,22,23,29,26,27);
      for(const s of [-1,1])for(const z of [-24,19])p.add('drum',fieldRubber,-14+s*23,7,z,12,5,12,0,0,Math.PI/2);
      cargo(p,-20,8,34);cargo(p,-2,8,35,12,13);
      strut(p,expedition,[26,31,-17],[26,55,-17],1.7);
    }else if(kind==='assembly'){
      p.add('armorHull',expedition,0,5,0,61,5,59);
      for(const s of [-1,1]){
        for(const z of [-24,24]){
          strut(p,expedition,[s*26,6,z],[s*26,39,z],2.5);
          strut(p,service,[s*26,13,z],[s*17,34,z],1.45);
          p.add('armorHull',composite,s*26,11,z,7,9,8);
        }
        strut(p,expedition,[s*26,39,-24],[s*26,39,24],3);
        for(const z of [-22,0,22])p.add('drum',fieldRubber,s*31,7,z,12,5,12,0,0,Math.PI/2);
        cargo(p,s*19,13,-22,11,13);
      }
      shelter(p,0,-15,54,44,26);
      p.add('armorPlate',composite,0,41,22,54,4,8);
      for(const x of [-18,18])p.box(service,x,8,4,2,1,41);
      p.add('armorPlate',composite,0,5,34,40,2,17,.25);
      for(const x of [-16,16])p.add('panel','lamp',x,6.3,32,1.5,.6,4,.25);
    }else if(kind==='routePost'){
      shelter(p,-8,-4,49,31,40);
      cargo(p,23,8,-20);cargo(p,23,8,-2);
      p.add('panel',expedition,0,12,12,25,2,13);
      for(const x of [-10,10])strut(p,expedition,[x,2,12],[x,12,12],1.2);
      p.add('panel',sand,0,13.3,12,19,.5,10);
      strut(p,expedition,[-29,2,15],[-29,40,15],1.1);
      p.add('panel','team',-23,35,15,12,8,.7);
    }else if(kind==='observatory'){
      for(const x of [-1,1])strut(p,expedition,[x*24,2,13],[0,32,-5],3);
      strut(p,expedition,[0,2,-28],[0,32,-5],3);
      cargo(p,-22,9,21,20,18);
      p.add('panel',glass,-22,14,22,12,1,9,.2);
      shelter(p,22,-10,23,24,28);
    }else if(kind==='escortDepot'){
      shelter(p,-7,-3,56,34,55);
      for(const [x,z] of [[-22,-17],[-6,-17],[11,-17],[-22,3],[-6,3]])cargo(p,x,8,z);
      cargo(p,-14,18,-17,17,16);
      p.add('drum',fieldRubber,26,8,18,14,5,14,0,0,Math.PI/2);
      strut(p,expedition,[26,0,-20],[26,46,-20],1.3);
    }else if(kind==='refinery'){
      p.add('panel',expedition,0,6,0,57,3,53);
      for(const x of [-15,15]){
        p.add('drum',service,x,16,-3,17,39,17,Math.PI/2);
        for(const z of [-17,12])p.add('ring',expedition,x,16,z,18,18,2);
        strut(p,service,[x,16,19],[x,7,27],2.3);
      }
      cargo(p,-17,10,28,19,12);
      shelter(p,0,-22,51,33,16);
    }else if(kind==='lumbermill'){
      shelter(p,-14,-8,33,31,45);
      for(const s of [-1,1])p.box(expedition,13+s*12,8,4,2,8,51);
      for(const z of [-15,-4,7,18])p.add('drum',service,13,11,z,4,27,4,0,0,Math.PI/2);
      p.add('drum',service,13,20,-8,17,2,17,0,0,Math.PI/2);
      p.add('carapace',sand,13,23,-8,4,13,21);
    }
  });
  if(mast){
    m.at('root',p=>{
      for(const s of [-1,1]){
        strut(p,expedition,[s*9,5,0],[s*3,57,0],2);
        strut(p,canvas,[s*3,48,0],[s*17,1,12],.65);
      }
      for(let i=0;i<4;i++){
        const y=12+i*10,a=8-i;
        strut(p,service,[-a,y,0],[a-1,y+10,0],1);
        strut(p,service,[a,y,0],[-a+1,y+10,0],1);
        strut(p,expedition,[-a,y,1],[a,y,1],1.1);
      }
      p.add('panel','team',0,27,2,8,8,.7);
    });
    m.joint('dish',[0,58,0],p=>dish(p,23,sand),'root',(b,s)=>{b.rotation.y=s.time*.35;});
  }else if(tower){
    m.at('root',p=>{for(const x of [-9,9])strut(p,expedition,[x,5,0],[x,25,0],2);});
    m.joint('turret',[0,27,0],p=>{
      p.add('panel',sand,0,1,0,23,3,19);
      for(const x of [-6,6]){
        p.add('bevel',expedition,x,5,0,4,6,12);
        p.add('drum',service,x,5,16,2,26,2,Math.PI/2);
      }
      p.box('team',0,3,-5,8,1,7);lens(p,0,5,5,3);
    },'root',(b,s)=>{b.rotation.y=s.aim;b.position.z-=s.recoil*2;});
  }else if(well){
    m.at('root',p=>{for(const x of [-6,6])strut(p,expedition,[x,5,-6],[x,29,-4],2);});
    m.joint('pump',[0,29,-4],p=>{
      p.add('panel',sand,0,0,0,7,4,29);
      p.add('panel',expedition,0,-3,13,7,9,7);
      strut(p,service,[0,-3,13],[0,-25,13],1.7);
    },'root',(b,s)=>{b.rotation.x=s.active?wave(s,2.4)*.2:0;});
  }else if(base||kind==='observatory'||kind==='escortDepot'){
    m.joint('dish',base?[26,55,-17]:kind==='observatory'?[0,34,-5]:[26,46,-20],
      p=>dish(p,kind==='observatory'?36:17,sand),'root',(b,s)=>{b.rotation.y=s.time*(s.active?.6:.2);});
  }else if(kind==='assembly'){
    m.joint('gantry',[0,37,-18],p=>{
      p.box(service,0,0,0,52,2,3);strut(p,service,[0,0,0],[0,-16,0],1.5);
      p.add('bevel',expedition,0,-16,0,7,5,7);
    },'root',(b,s)=>{b.position.z+=s.active?(wave(s,1.5)+1)*17:0;});
  }
}
