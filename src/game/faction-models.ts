import { Parts } from './model-parts.js';
import { isMobile, type BuildingKind, type MobileKind, type Kind, type Race } from './types.js';
import { factionUnit } from './faction-unit-models.js';
import { factionBuilding } from './faction-building-models.js';

type Shape='organic'|'crystal'|'expedition'|'federal';
type Role='support'|'sensor'|'control'|'transport'|'line'|'heavy'|'air'|'supply'|'facility';
const profiles:Partial<Record<Kind,[Shape,Role,number]>>={
  commander:['federal','support',0],disruptor:['federal','control',1],
  nurturer:['organic','support',0],infector:['organic','sensor',1],binder:['organic','control',2],
  broodling:['organic','line',1],spitter:['organic','line',2],behemoth:['organic','heavy',2],bioWing:['organic','air',3],sac:['organic','supply',0],
  weaver:['crystal','support',0],guide:['crystal','sensor',1],arbiter:['crystal','control',2],
  lancer:['crystal','line',0],prism:['crystal','line',2],colossus:['crystal','heavy',3],starWing:['crystal','air',1],
  pathfinder:['expedition','support',0],observer:['expedition','sensor',1],escort:['expedition','control',2],
  ranger:['expedition','line',0],runner:['expedition','line',1],flak:['expedition','heavy',2],relayWing:['expedition','air',3],
  supplyDepot:['federal','supply',0],infirmary:['federal','facility',0],commandPost:['federal','facility',1],
  hatchery:['organic','facility',2],nursery:['organic','facility',0],gland:['organic','facility',1],burrow:['organic','facility',3],
  node:['crystal','supply',0],resonator:['crystal','facility',0],warpHub:['crystal','facility',1],phaseSanctum:['crystal','facility',2],
  assembly:['expedition','transport',3],relayTower:['expedition','supply',0],routePost:['expedition','facility',0],
  observatory:['expedition','facility',1],escortDepot:['expedition','facility',2],
};
const sharedRaces={industrial:'federal',brood:'organic',stellar:'crystal',relay:'expedition'} as const;
const shared:Kind[]=['worker','base','tower','oilwell','refinery','lumbermill'];

export function factionProfile(kind:Kind,race?:Race){
  if(profiles[kind])return profiles[kind];
  if(!race||race==='industrial'||!shared.includes(kind))return undefined;
  const role=kind==='worker'?'transport':kind==='tower'?'control':'facility';
  return [sharedRaces[race],role,shared.indexOf(kind)] as const;
}
export const factionPalette:Record<Shape,string>={federal:'#77b38b',organic:'#d88ebc',crystal:'#8fcff2',expedition:'#edbc72'};
export const factionGlyphs:Record<Role,string>={support:'✚',sensor:'◈',control:'⌁',transport:'▱',line:'◆',heavy:'⬢',air:'▲',supply:'▥',facility:'▦'};

export function factionParts(p:Parts,kind:Kind,race?:Race,packed=false) {
  const profile=factionProfile(kind,race);if(!profile)return;
  const shape=profile[0];
  if(kind==='assembly'&&packed)return factionUnit(p,kind,shape,true);
  return isMobile({kind})?factionUnit(p,kind as MobileKind,shape):factionBuilding(p,kind as BuildingKind,shape);
}
