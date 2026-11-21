import type { Parts, Size } from './model-parts.js';
import { astral, stellarTrim, photonic, stellarArmor, strut } from './faction-model-parts.js';

/** 能量环由承力环、分段瓷甲与嵌入导体组成；亮部只占接点，保留结构层次。 */
export function energyRing(p:Parts,at:Size,diameter:number,vertical=false,segments=8){
  const [x,y,z]=at,r=diameter*.43;
  p.add('ring',astral,x,y,z,diameter,diameter,3,vertical?0:Math.PI/2);
  p.add('ring',stellarTrim,x,y+(vertical?0:.55),z+(vertical?.55:0),diameter*.88,diameter*.88,1.2,vertical?0:Math.PI/2);
  for(let i=0;i<segments;i++){
    const a=i*Math.PI*2/segments,s=Math.sin(a),c=Math.cos(a);
    const px=x+s*r,py=y+(vertical?c*r:1),pz=z+(vertical?1:c*r);
    p.add('armorPlate',stellarArmor,px,py,pz,diameter*.16,vertical?diameter*.1:2.4,vertical?3:diameter*.1,0,vertical?0:a,vertical?-a:0);
    p.add('panel','lamp',px,py+(vertical?0:1.3),pz+(vertical?1.8:0),diameter*.065,vertical?.8:.5,vertical?.5:.8,0,vertical?0:a,vertical?-a:0);
  }
}

/** 晶核收在陶瓷叉架内；深色凹槽、金属夹具与小面积发光分别提供可读边界。 */
export function reactor(p:Parts,at:Size,width:number,height:number){
  const [x,y,z]=at;
  p.add('shard',photonic,x,y,z,width,height,width*.8,0,.3);
  p.add('octagon',astral,x,y-height*.38,z,width*1.2,3,width);
  p.add('octagon',stellarTrim,x,y-height*.31,z,width*1.03,1,width*.86);
  for(const s of [-1,1]){
    p.add('armorHull',astral,x+s*width*.52,y-1,z,width*.35,height*.78,width*.75,0,0,-s*.12);
    p.add('armorPlate',stellarArmor,x+s*width*.56,y,z+width*.15,width*.3,height*.7,width*.65,0,0,-s*.12);
    strut(p,stellarTrim,[x+s*width*.38,y-height*.29,z+width*.36],[x+s*width*.45,y+height*.23,z+width*.27],.8);
  }
  p.add('shard','lamp',x,y,z+width*.37,width*.12,height*.57,width*.1,0,.3);
}

/** 前向聚焦器：封闭炮尾、分离导轨、透镜和短光芯，避免整根水晶代替武器。 */
export function focusEmitter(p:Parts,width:number,length:number){
  p.add('armorHull',astral,0,0,length*.25,width,9,length*.75);
  p.add('armorPlate',stellarArmor,0,4,length*.19,width*.82,3.5,length*.57);
  for(const s of [-1,1]){
    p.add('armorHull',stellarArmor,s*width*.45,0,length*.55,width*.28,7,length*.85,0,-s*.07);
    strut(p,stellarTrim,[s*width*.33,3,length*.22],[s*width*.33,2,length*.88],.9);
    for(const z of [.36,.56,.76])p.add('panel',astral,s*width*.46,3.5,length*z,width*.22,.65,1.3,0,-s*.07);
  }
  p.add('drum',astral,0,0,length*.74,width*.66,4,width*.66,Math.PI/2);
  p.add('ring',stellarTrim,0,0,length*.84,width*.61,width*.61,1.6);
  p.add('drum',photonic,0,0,length*.86,width*.43,1.3,width*.43,Math.PI/2);
  p.add('drum','lamp',0,0,length*.895,width*.19,.7,width*.19,Math.PI/2);
}
