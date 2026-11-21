import { Parts } from './model-parts.js';
import { mobileModel } from './mobile-models.js';
import { humanoid } from './unit-rig.js';
import { organicUnit } from './organic-models.js';
import { expeditionUnit } from './expedition-models.js';
import { stellarUnit } from './stellar-unit-models.js';
import type { MobileKind } from './types.js';
import { FactionModel, type FactionShape } from './faction-model-parts.js';

export function factionUnit(parts:Parts,kind:MobileKind|'assembly',shape:FactionShape,packed=false){
  if(kind!=='assembly'&&(humanoid(kind)||kind==='disruptor'))return mobileModel(parts,kind);
  const m=new FactionModel(parts);
  if(shape==='organic')organicUnit(m,kind as MobileKind);
  else if(shape==='crystal')stellarUnit(m,kind as MobileKind);
  else expeditionUnit(m,kind,packed);
  return m.rig;
}
