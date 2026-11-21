import { Parts, baseSlab, dark, glass } from './model-parts.js';
import { organicBuilding } from './organic-models.js';
import { expeditionBuilding } from './expedition-models.js';
import { stellarBuilding } from './stellar-building-models.js';
import type { BuildingKind } from './types.js';
import {
  FactionModel, federal, medical, circuitry, ceramicArmor,
  service, strut, cross, wave, type FactionShape,
} from './faction-model-parts.js';

function federalBuilding(m:FactionModel,kind:BuildingKind){
  m.joint('root',[0,0,0],p=>{
    p.add('bevel',baseSlab,0,3,0,77,6,72);
    for(const x of [-32,32])for(const z of [-28,28]){
      p.add('bevel',federal,x,6,z,12,6,12);p.box('lamp',x,9,z,2,1,3);
    }
    if(kind==='supplyDepot'){
      for(const [x,y,z] of [[-19,13,-17],[10,13,-17],[-19,13,13],[10,13,13],[-19,29,-17],[10,29,-17]]){
        p.add('bevel',federal,x,y,z,24,15,26);
        for(const dx of [-8,-4,0,4,8])p.box(service,x+dx,y,z+13.2,1,12,.6);
        p.add('panel',dark,x,y+7.7,z,23,1,24);
        p.box('team',x,y+2,z+13.7,9,2,.5);
        for(const s of [-1,1])p.add('panel',service,x+s*10.8,y,z,1.8,15.5,27);
      }
      for(const z of [-19,-5,9,23])p.add('drum',service,30,13,z,8,16,8);
    }else{
      const med=kind==='infirmary',body=med?medical:federal;
      p.add('bevel',dark,0,9,-4,61,9,47);
      p.add('armorHull',body,0,22,-4,58,25,44);
      p.add('panel',service,0,35,-4,62,3,48);
      for(const s of [-1,1])for(const z of [-19,-4,11])p.add('panel',body,s*29,21,z,3,27,5);
      p.add('armorHull',med?body:ceramicArmor,0,16,24,29,24,19);
      p.add('panel',dark,0,15,34,19,19,1);
      p.add('panel',glass,0,20,34.6,16,4,.5);
      p.add('panel','team',0,30,34,16,3,1);
      if(med){
        cross(p,0,34,21,10,0xb54a3e);
        for(const x of [-22,22]){
          p.add('drum',service,x,20,24,6,23,6);
          p.add('panel',medical,x,34,7,9,2,12);
          p.add('panel',glass,x,32,7,6,.7,9);
          strut(p,service,[x,12,24],[x,10,31],1.5);
        }
        p.box(0xb54a3e,0,37,-6,18,1,5);p.box(0xb54a3e,0,37,-6,5,1,18);
      }else{
        p.add('bevel',circuitry,0,40,-7,25,9,23);
        for(const s of [-1,1])strut(p,service,[s*23,35,-18],[s*23,57,-18],1.2);
        for(const x of [-21,21]){
          p.add('bevel',federal,x,38,7,12,7,19);
          for(const z of [1,6,11])p.add('panel',service,x,41.5,z,9,.8,1.6);
        }
      }
    }
  });
  if(kind==='commandPost'){
    m.joint('array',[0,47,-7],p=>{
      p.add('panel',federal,0,9,0,35,23,4,-.16);
      p.add('panel',circuitry,0,9,2.6,31,19,1,-.16);
      for(const x of [-12,-6,0,6,12])for(const y of [3,9,15])p.add('panel',service,x,y,3.6,4,4,.6,-.16);
      p.add('pin','lamp',0,23,0,2,3,2);
    },'root',(b,s)=>{b.rotation.y=wave(s,.3)*.24;});
  }
}

export function factionBuilding(parts:Parts,kind:BuildingKind,shape:FactionShape){
  const m=new FactionModel(parts);
  if(shape==='organic')organicBuilding(m,kind);
  else if(shape==='crystal')stellarBuilding(m,kind);
  else if(shape==='expedition')expeditionBuilding(m,kind);
  else federalBuilding(m,kind);
  return m.rig;
}
