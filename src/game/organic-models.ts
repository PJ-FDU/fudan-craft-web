import { paint, type Parts, type Size } from './model-parts.js';
import { FactionModel, bone, chitin, shell, lamella, tissue, sacSkin, tendon, horn, wave, effort, working } from './faction-model-parts.js';
import type { MobileKind, BuildingKind } from './types.js';

const cavity=paint('membrane',0x252d26,1,[.69,0,.14],.55);
const vein=paint('membrane',0x665140,1.05,[.57,0,.21],.65);

function plate(p:Parts,x:number,y:number,z:number,w:number,h:number,d:number,ry=0,rz=0){
  const broad=Math.max(w,h,d)>16;
  p.add('scalePlate',chitin,x,y-h*.12,z,w*.91,h*.51,d,0,ry,rz);
  p.add(broad?'scute':'scalePlate',broad?lamella:shell,x,y+h*.10,z-d*.024,w,h*.91,d*.98,0,ry,rz);
}
function gland(p:Parts,x:number,y:number,z:number,w:number,h:number,d:number){
  p.add('dome',sacSkin,x,y,z,w,h,d);
  // 沿椭球面取样血管，弦段嵌入表皮；不再用悬空直杆跨过囊体。
  for(const angle of [-2.6,-.6,.6,2.6]){
    const point=(t:number):Size=>{
      const phi=.28+t*2.35,a=angle+Math.sin(t*5)*.08;
      return [x+Math.sin(phi)*Math.cos(a)*w*.503,y+Math.cos(phi)*h*.503,z+Math.sin(phi)*Math.sin(a)*d*.503];
    };
    for(let i=0;i<7;i++)tendon(p,vein,point(i/7),point((i+1)/7),.42);
  }
}

export function organicUnit(m:FactionModel,kind:MobileKind){
  const heavy=kind==='behemoth',supply=kind==='sac',air=kind==='bioWing',binder=kind==='binder';
  const spitter=kind==='spitter',nurturer=kind==='nurturer',infector=kind==='infector';
  const y=heavy?21:binder?18:spitter?15:air?15:kind==='worker'?9:10;
  const width=heavy?30:supply?15:binder?12:kind==='worker'?20:17;
  const rear=supply?30:heavy?26:nurturer?24:infector?19:15;
  m.joint('root',[0,y,0],p=>{
    p.add('carapace',tissue,0,-1,0,width,11,29);
    const count=heavy?4:3;
    for(let i=0;i<count;i++)plate(p,0,heavy?4+i*1.4:2,10-i*7,width+2-i*1.4,heavy?16:9,13);
    for(const s of [-1,1]){
      tendon(p,tissue,[s*width*.3,-2,11],[s*width*.3,-3,-13],3);
      p.add('carapace','team',s*width*.32,4,7,2.5,1.8,6,0,0,s*.4);
      for(let i=0;i<3;i++){
        const z=7-i*8,x=s*width*(.44-i*.027);
        tendon(p,chitin,[x,heavy?6:3,z-2],[x*.7,-4,z+3],heavy?3.2:1.65);
        if(heavy||binder){
          horn(p,chitin,[x,heavy?6:3,z-2],[s*.65,1,-.7],heavy?12:7,heavy?6:3.4,3.8);
          horn(p,bone,[x*.95,heavy?6:3,z-2],[s*.5,1,-.7],heavy?8:5,heavy?3.8:2.1,2.7);
        }
      }
    }
  },undefined,(b,s)=>{
    b.position.y+=wave(s,2.3)*.18+Math.abs(Math.sin(s.travel*.15))*s.weight*.55;
    b.rotation.x=effort(s)*.08+(s.fall??0)*.8;
  });
  m.joint('abdomen',[0,-1,-17],p=>{
    if(supply||infector||nurturer){
      gland(p,0,1,-3,rear, supply?24:17,rear*1.25);
      for(const s of [-1,1])for(let i=0;i<3;i++){
        plate(p,s*rear*.38,-2,8-i*rear*.3,7,8,13,-s*.2,s*.45);
      }
    }else for(let i=0;i<3;i++)plate(p,0,1-i*.6,3-i*6,rear-i*3,heavy?13:8,12);
    if(binder)for(const s of [-1,1]){
      tendon(p,chitin,[s*4,0,-12],[s*4,-3,-20],4);
      p.add('drum',tissue,s*4,-3,-20,2,3,2,Math.PI/2);
    }
    if(air)horn(p,chitin,[0,0,-9],[0,-.18,-1],22,9);
  },'root',(b,s)=>{
    b.scale.set(1+wave(s,2)*.014,1+wave(s,2)*.021,1);
    b.rotation.y=wave(s,2.4)*.025;
  });
  if(spitter)m.at('root',p=>{
    tendon(p,chitin,[0,0,10],[0,11,19],12,10);
    gland(p,0,5,17,12,14,12);
  });
  m.joint('head',[0,spitter?12:heavy?0:1,spitter?21:16],p=>{
    plate(p,0,0,0,heavy?29:spitter?12:13,heavy?12:7,heavy?22:14);
    p.add('carapace',cavity,0,-1.7,heavy?10:7,heavy?15:7,1.8,1.5);
    for(const s of [-1,1]){
      p.add('carapace',cavity,s*(heavy?9:4.5),1,heavy?8:5,heavy?3:2,2,2);
      p.add('jointBall','lamp',s*(heavy?9:4.6),1,heavy?9:6,heavy?1.1:.65,.65,.6);
      p.add('scalePlate',chitin,s*(heavy?8:3.5),heavy?-3:-2.3,heavy?3:4,heavy?9:4,heavy?7:4,heavy?9:6);
      horn(p,bone,[s*(heavy?10:4),heavy?-3:-2,heavy?7:5],[s*.23,-.28,1],heavy?17:8,heavy?8:3);
      horn(p,chitin,[s*(heavy?9:4),heavy?3:1.5,heavy?2:0],[s*.7,1,-.5],heavy?10:5,heavy?6:2.3,heavy?5:2.3);
    }
    if(spitter){
      p.add('carapace',chitin,0,-1,9,8,7,16);
      p.add('dome',cavity,0,-1,16,5,4,1);
      for(const s of [-1,1])horn(p,bone,[s*3,-1,14],[s*.15,.2,1],6,2.5);
    }
    if(heavy){
      p.add('scute',lamella,0,4.8,5,24,8,17,.16);
      horn(p,chitin,[0,6,6],[0,1,.8],20,12,11);
      for(const s of [-1,1]){
        horn(p,bone,[s*12,-3,12],[s*.4,.12,1],22,6.3);
        p.add('scute',shell,s*12,1.4,6,11,5,16,0,s*.23,s*.31);
        tendon(p,tissue,[s*9,-3,3],[s*12,-3,12],3.5);
      }
    }
  },'root',(b,s)=>{b.rotation.x=-effort(s)*.16+s.recoil*.18;b.position.z-=s.recoil*1.5;});

  if(air){
    for(const s of [-1,1])m.joint('wing'+s,[s*7,5,0],p=>{
      p.add('membrane',tissue,s*19,0,-4,38,.75,31,0,0,s<0?Math.PI:0);
      tendon(p,chitin,[0,0,11.5],[s*19,.6,.34],3);
      tendon(p,chitin,[s*19,.6,.34],[s*38,0,-10.8],1.8);
      for(const x of [14,24,34]){
        const t=x/38,z=-15.5*(1-t*.74)-t*10.85-4+Math.abs(Math.sin(t*Math.PI*3))*4.96;
        tendon(p,bone,[s*12,.35,3],[s*x,.1,z],.9);
        tendon(p,vein,[s*x*.79,.12,z*.62],[s*x+.8*s,.12,z-2],.42);
      }
      p.add('carapace','team',s*7,.5,6,6,1.5,3);
    },'root',(b,pose)=>{b.rotation.z=s*(.06+wave(pose,8)*.23);b.rotation.x=pose.weight*.1;});
  }else{
    const legs=heavy?2:3;
    for(const s of [-1,1])for(let i=0;i<legs;i++){
      const z=heavy?10-i*25:10-i*11,reach=heavy?16:binder?20:supply?12:13;
      const knee:Size=[s*reach,-(heavy?4:3),i===0?5:-4];
      const tip:Size=[s*(heavy?2:4),-(y-5),i===0?5:-3];
      const name='leg'+s+':'+i;
      m.joint(name,[s*width*.35,-1,z],p=>{
        p.add('jointBall',tissue,0,0,0,heavy?8:4,heavy?7:4,heavy?9:4);
        tendon(p,chitin,[0,0,0],knee,heavy?12:5,heavy?10:4);
        plate(p,knee[0]*.4,-1,knee[2]*.4,heavy?11:5,heavy?8:4,heavy?13:8,0,-s*.25);
        p.add('jointBall',tissue,...knee,heavy?6:3,heavy?6:3,heavy?6:3);
      },'root',(b,s0)=>{
        const phase=s0.travel*(heavy?.11:.19)+i*Math.PI*.8+(s>0?Math.PI:0);
        b.rotation.y=Math.sin(phase)*s0.weight*.18;
        b.rotation.z=s*Math.max(0,Math.cos(phase))*s0.weight*.16;
      });
      m.joint(name+'tip',knee,p=>{
        tendon(p,chitin,[0,0,0],tip,heavy?8:3.3,heavy?7:3);
        if(heavy){
          tendon(p,tissue,[-s*1.8,-1,.6],[tip[0]-s*1.3,tip[1],tip[2]-1],2.8);
          p.add('scute',lamella,tip[0]*.66,tip[1]*.6+1,tip[2]*.42+2,7,12,6,-.2,0,s*.23);
        }
        p.add('scalePlate',chitin,tip[0],tip[1]+.6,tip[2]+1,heavy?9:3.4,heavy?4:2.3,heavy?11:6);
        for(const dx of heavy?[-2,2]:[0])horn(p,bone,[tip[0]+dx,tip[1]+.6,tip[2]+2],[0,-.1,1],heavy?5:3,heavy?2.5:1.7,2);
      },name,(b,s0)=>{b.rotation.x=Math.sin(s0.travel*.19+i*2+s)*s0.weight*.12;});
    }
  }
  if(kind==='broodling'||binder||kind==='worker'){
    for(const s of [-1,1])m.joint('claw'+s,[s*8,-1,10],p=>{
      if(kind==='worker'){
        const wrist:Size=[s*3,-1,8];
        tendon(p,chitin,[0,0,0],wrist,6);
        p.add('jointBall',chitin,...wrist,3.4,3.4,3.4);
        horn(p,bone,wrist,[-s*.5,-.22,1],9,5);
      }else{
        const wrist:Size=[s*6,2,10];
        tendon(p,chitin,[0,0,0],wrist,5);
        p.add('jointBall',chitin,...wrist,4,4,4);
        // 根部、腕节和整根刃爪同骨绑定，采集/攻击时不会各自漂移。
        horn(p,bone,wrist,[-s*.24,-.35,1],binder?19:17,binder?6:7,5);
      }
    },'root',(b,s0)=>{b.rotation.x=-effort(s0)*.4+s0.recoil*.5;b.rotation.y=s*(working(s0)?wave(s0,7)*.17:effort(s0)*.2);});
  }
  if(nurturer||infector)for(const s of [-1,1])m.joint('gland'+s,[s*6,4,-8],p=>{
    const h=infector?(s>0?9:6):8;
    // 腺体附着在宽阔肌肉基座上；低伏的背部器官避免细杆托球的玩具轮廓。
    p.add('carapace',tissue,s*3,2,-4,13,10,15,0,s*.2);
    tendon(p,chitin,[0,0,0],[s*5,h*.6,-7],8,7);
    if(infector){
      gland(p,s*6,h,-7,s>0?14:10,s>0?16:12,15);
      for(let i=0;i<3;i++)plate(p,s*(5+i*.6),1+i*.7,1-i*6,10,7,9,0,-s*.4);
    }else for(let i=0;i<4;i++){
      p.add('carapace',shell,s*(3+i),h-i*1.8,-4-i*3,10,3.2,13,0,s*.25,-s*.5);
      p.add('scalePlate',sacSkin,s*(3+i),h-i*1.8-1.5,-4-i*3,6,2,10);
    }
  },'root',(b,s0)=>{b.rotation.z=s*(wave(s0,2)*.035+effort(s0)*.16);});
}

export function organicBuilding(m:FactionModel,kind:BuildingKind){
  const base=kind==='base',tower=kind==='tower',well=kind==='oilwell',pool=kind==='nursery';
  const burrow=kind==='burrow',chimneys=kind==='gland'||kind==='refinery';
  const r=tower||well?21:base?49:36;
  m.joint('root',[0,0,0],p=>{
    p.add('carapace',tissue,0,2,0,r*1.8,8,r*1.75);
    for(let i=0;i<9;i++){
      const a=i*Math.PI*2/9,x=Math.sin(a),z=Math.cos(a),reach=r*(.83+(i%3)*.06);
      tendon(p,chitin,[x*reach,1.7,z*reach],[x*r*.38,10,z*r*.4],6,5);
      tendon(p,vein,[x*reach,1.5,z*reach],[x*(reach+4),.9,z*(reach+4)],2.2);
      plate(p,x*reach*.8,2,z*reach*.8,5+i%3,4,12,-a,.12);
    }
  });
  if(pool){
    m.at('root',p=>{
      p.add('carapace',cavity,0,5,0,58,5,53);
      for(let i=0;i<7;i++){
        const a=i*Math.PI*2/7;
        plate(p,Math.sin(a)*25,5,Math.cos(a)*23,19,10,13,-a,.1);
      }
    });
    m.joint('eggs',[0,8,0],p=>{
      for(const [x,z,h] of [[-11,-6,16],[8,-10,20],[2,11,13],[-13,12,9],[17,7,10]]){
        gland(p,x,h*.4,z,h*.65,h,h*.75);
        for(const s of [-1,1])p.add('carapace',chitin,x+s*h*.23,0,z,h*.4,6,h*.9);
      }
      p.add('carapace','team',0,-1,24,9,2,3);
    },'root',(b,s)=>{b.scale.y=1+wave(s,1.6)*.012;});
    return;
  }
  if(tower||well){
    m.at('root',p=>{
      tendon(p,tissue,[0,6,0],[0,35,-3],20,17);
      for(const s of [-1,1]){
        tendon(p,chitin,[s*15,3,-5],[s*5,34,-3],7);
        for(let i=0;i<3;i++)plate(p,s*7,13+i*7,-5,12,8,13,0,-s*.2);
      }
    });
    m.joint('crown',[0,36,-2],p=>{
      plate(p,0,0,0,23,12,21);
      p.add('carapace','team',0,5,-4,7,2,8);
      if(tower){
        gland(p,0,-2,9,12,10,15);
        p.add('carapace',chitin,0,1,15,13,9,18);
        p.add('dome',cavity,0,1,23,8,5,1);
        p.add('dome','lamp',0,1,23.6,1.5,1,1);
      }else{
        horn(p,chitin,[0,3,0],[0,1,-.3],23,15,13);
        for(const s of [-1,1])tendon(p,tissue,[s*5,0,0],[s*13,-26,7],5);
      }
    },'root',(b,s)=>{b.rotation.y=tower?s.aim:0;b.position.z-=s.recoil*2;b.scale.y=1+wave(s,2.4)*.012;});
    return;
  }
  const height=base?43:burrow?18:chimneys?23:31;
  m.joint('shell',[0,5,0],p=>{
    p.add('carapace',tissue,0,height*.25,-6,r*1.5,height*.9,r*1.48);
    for(let i=0;i<4;i++){
      const z=20-i*14,w=r*(1.44-i*.1);
      plate(p,0,height*.23+(3-i)*1.3,z,w,height*(burrow?.7:1),23);
      for(const s of [-1,1]){
        tendon(p,chitin,[s*w*.48,0,z+2],[s*w*.36,height*.58,z-2],5);
        horn(p,shell,[s*w*.36,height*.58,z-2],[s*.3,1,-.4],base?12:7,6);
        p.add('scalePlate',bone,s*w*.39,height*.47,z+4,7,height*.33,11,0,s*.19,-s*.46);
      }
    }
    // 入口从前部凹入，外缘由暗色唇褶与承重肋包住。
    p.add('carapace',tissue,0,5,r*.64,30,18,11);
    p.add('carapace',cavity,0,4.7,r*.76,21,12,3.2);
    for(const s of [-1,1]){
      horn(p,chitin,[s*11,4,r*.67],[-s*.35,1,.25],21,9);
      horn(p,bone,[s*8,9,r*.78],[-s*.3,.35,1],11,4.4,5);
      tendon(p,tissue,[s*15,3,r*.73],[s*8,9,r*.78],3.1);
      p.add('carapace','team',s*r*.35,height*.57,10,3,2,9,0,0,s*.3);
    }
  },'root',(b,s)=>{b.scale.y=1+wave(s,1.6)*.008;});
  if(chimneys){
    for(const [i,x] of [-18,1,19].entries())m.joint('gland'+i,[x,18,-10+(i%2)*13],p=>{
      const h=[24,38,29][i];
      tendon(p,tissue,[0,0,0],[i-1,h,0],14,12);
      gland(p,0,h*.45,0,17,h*.75,16);
      for(const s of [-1,1])tendon(p,chitin,[s*8,-3,0],[s*4,h-1,0],4);
      p.add('carapace',chitin,i-1,h,0,14,6,13);
      p.add('dome',cavity,i-1,h+2.7,0,8,.8,7);
    },'root',(b,s)=>{b.scale.y=1+wave(s,2+i*.2)*(s.active?.022:.009);});
  }else if(base||kind==='hatchery'){
    m.at('root',p=>{
      for(const s of [-1,1]){
        for(let i=0;i<3;i++){
          gland(p,s*(r-11),9+i,14-i*17,14,14+i*3,18);
          plate(p,s*(r-8),12+i,10-i*17,13,8,18,0,-s*.5);
        }
        tendon(p,chitin,[s*r*.78,5,7],[s*r*.52,height*.74,-8],7.4,6);
        p.add('scute',lamella,s*r*.62,height*.35,-3,19,height*.54,20,.13,s*.5,-s*.48);
      }
      if(base){
        plate(p,0,36,-20,28,16,33);
      }
    });
    // 背部角根嵌入同骨甲壳，随 shell 一起呼吸；不能借根骨骼上的附近装甲支撑。
    m.at('shell',p=>{
      for(const s of [-1,1]){
        horn(p,chitin,[s*14,height*.48,-23],[s*.22,1,-.25],base?25:15,11,12);
        if(base)horn(p,shell,[s*18,height*.53,-9],[s*.6,1,-.32],24,9);
      }
    });
  }else if(burrow){
    m.at('shell',p=>{
      for(const s of [-1,1]){
        tendon(p,chitin,[s*26,2,4],[s*11,7,26],6,8);
        horn(p,bone,[s*11,7,26],[-s*.6,1,.37],21,8);
      }
    });
  }else if(kind==='lumbermill'){
    for(const s of [-1,1])m.joint('jaw'+s,[s*12,11,24],p=>{
      plate(p,0,0,0,12,9,25,0,s*.3);
      for(let i=0;i<4;i++)horn(p,bone,[-s*3,.8,8-i*5],[-s,.5,0],9,3);
    },'root',(b,s0)=>{b.rotation.y=s*(s0.active?wave(s0,5)*.13:0);});
  }
}
