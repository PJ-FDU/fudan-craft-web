import { STATS, TECHS, type BuildingKind, type Kind, type MobileKind, type Player, type Race, type Unit } from './types.js';

const civil = ['refinery','lumbermill','tower','oilwell'] as const;
interface Roster {
  production:BuildingKind;
  supply:BuildingKind|MobileKind;
  buildings:readonly BuildingKind[];
  units:readonly MobileKind[];
  opening:[MobileKind,MobileKind];
}
export const ROSTERS:Record<Race,Roster> = {
  industrial:{production:'barracks',supply:'supplyDepot',buildings:[...civil,'powerplant','barracks','factory','airfield','research','supplyDepot','infirmary','commandPost'],units:['worker','soldier','scout','medic','sniper','tank','artillery','fighter','mech','commander','disruptor'],opening:['soldier','scout']},
  brood:{production:'hatchery',supply:'sac',buildings:[...civil,'hatchery','nursery','gland','burrow'],units:['worker','broodling','spitter','behemoth','bioWing','sac','nurturer','infector','binder'],opening:['broodling','spitter']},
  stellar:{production:'resonator',supply:'node',buildings:[...civil,'node','resonator','warpHub','phaseSanctum'],units:['worker','lancer','prism','colossus','starWing','weaver','guide','arbiter'],opening:['lancer','prism']},
  relay:{production:'assembly',supply:'relayTower',buildings:[...civil,'assembly','relayTower','routePost','observatory','escortDepot'],units:['worker','ranger','runner','flak','relayWing','pathfinder','observer','escort'],opening:['ranger','runner']},
};
const stage2 = new Set<Kind>(['commander','disruptor','gland','burrow','infector','binder','behemoth','bioWing','warpHub','phaseSanctum','guide','arbiter','colossus','starWing','observatory','escortDepot','observer','escort','flak','relayWing']);
export const producerFor=(kind:Kind,race?:Race)=>kind==='worker'&&race==='brood'?'hatchery':STATS[kind].producer;
/** 展示与规则校验共用前置条件，避免图鉴沿用旧科技树。 */
export function prerequisitesFor(kind:Kind,race?:Race){
  let building=race?(kind==='medic'?'infirmary':kind==='disruptor'?undefined:STATS[kind].requires):STATS[kind].requires;
  if(race&&race!=='industrial'&&building&&['barracks','powerplant'].includes(building))building=undefined;
  const tech= race&&['artillery','mech'].includes(kind)?'advancedArms':race&&kind==='fighter'?'aviationSystems':STATS[kind].tech;
  return {building,tech,tier2:!!race&&stage2.has(kind)};
}
const shieldSizes:Partial<Record<Kind,number>>={lancer:55,prism:85,colossus:160,starWing:90,weaver:65,guide:75,arbiter:110};
export const maxShield=(u:Pick<Unit,'kind'>)=>shieldSizes[u.kind]??0;
export const coverageRadius=384;
const stellarFacilities=new Set<Kind>(['resonator','warpHub','phaseSanctum']);
export const needsCoverage=(kind:Kind)=>stellarFacilities.has(kind);
export const covered=(side:Unit['side'],at:{x:number;y:number},units:Unit[])=>
  units.some(u=>u.side===side&&u.kind==='node'&&u.hp>0&&u.construction>=1&&Math.hypot(u.x-at.x,u.y-at.y)<=coverageRadius);

export function raceRequirement(kind:Kind, player:Player, units:Unit[]):string|null {
  if(!player.race)return null;
  const roster=ROSTERS[player.race];
  if(![...roster.units,...roster.buildings].includes(kind)&&kind!=='base')return '该种族无法建造或训练此项';
  const {building:requires,tech,tier2}=prerequisitesFor(kind,player.race);
  if(tier2&&!player.tech.includes('tier2'))return '需要 T2 支援分化';
  if(requires&&
     !units.some(u=>u.kind===requires&&u.side===player.side&&u.hp>0&&u.construction>=1))return '需要'+STATS[requires].name;
  if(kind==='artillery'||kind==='mech')return player.tech.includes('advancedArms')?null:'需要先进工程';
  if(kind==='fighter')return player.tech.includes('aviationSystems')?null:'需要航空技术';
  return tech&&!player.tech.includes(tech)?'需要对应科技':null;
}

export function producersFor(kind:MobileKind,player:Player,units:Unit[]){
  const producer=producerFor(kind,player.race);
  return units.filter(u=>u.side===player.side&&u.kind===producer&&u.hp>0&&u.construction>=1&&
    !u.station&&!(u.refitUntil!==undefined)&&
    (kind!=='disruptor'||u.factoryModule==='support')&&
    (!player.race||!['tank','artillery','mech'].includes(kind)||u.factoryModule!=='support')&&
    (!needsCoverage(u.kind)||covered(u.side,u,units)));
}
const weights:Partial<Record<MobileKind,number>>={sac:0,medic:2,commander:3,disruptor:3,nurturer:2,infector:3,binder:3,weaver:3,guide:3,arbiter:4,pathfinder:2,observer:3,escort:3,tank:4,artillery:4,mech:6,fighter:3,behemoth:5,bioWing:3,colossus:5,starWing:3,relayWing:3,flak:3,prism:2,runner:2,spitter:2,scout:2,sniper:2};
export const populationWeight=(kind:MobileKind,race?:Race)=>race?weights[kind]??1:1;
export const supplyProvided=(kind:Kind,race?:Race)=>race?(kind==='base'?20:kind===ROSTERS[race].supply?8:0):0;
export function population(player:Player,units:Unit[]){
  const count=(kind:MobileKind)=>populationWeight(kind,player.race);
  const own=units.filter(u=>u.side===player.side&&u.hp>0);
  const capacity=player.race?Math.min(120,own.reduce((total,u)=>total+(u.construction>=1?supplyProvided(u.kind,player.race):0),0)):80;
  return {capacity,used:own.reduce((total,u)=>total+(STATS[u.kind].speed?count(u.kind as MobileKind):0),0),
    reserved:player.queue.reduce((total,q)=>total+(q.research?0:count(q.kind as MobileKind)),0),weight:count};
}
export const groundOnly=(kind:Kind)=>kind==='tank'||kind==='artillery'||kind==='broodling'||kind==='behemoth'||kind==='colossus';

export function technologyAllowed(player:Pick<Player,'race'>,tech:import('./types.js').Tech){
  if(!player.race)return ['weapons','armor','logistics','advanced','aviation'].includes(tech);
  if(['tier2','tier3'].includes(tech))return true;
  if(['weapons','armor','logistics','advancedArms','aviationSystems'].includes(tech))return player.race==='industrial';
  const prefixes:Record<Race,string>={industrial:'IND',brood:'BIO',stellar:'ENE',relay:'RLY'};
  return tech.startsWith(prefixes[player.race]+'-');
}
export function researchBuilding(player:Pick<Player,'race'>,tech:import('./types.js').Tech):BuildingKind{
  return player.race?TECHS[tech].building??'research':'research';
}
