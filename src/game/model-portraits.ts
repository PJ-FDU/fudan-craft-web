import { assetPath } from './assets.js';
import type { Kind, Race } from './types.js';

const shared=['worker','base','refinery','lumbermill','tower','oilwell'] as const;
interface Portrait {kind:Kind;race:Race;packed?:boolean}
const group=(race:Race,kinds:readonly Kind[]):Portrait[]=>kinds.map(kind=>({kind,race}));

// Source sheets read in row order. Their order also determines the shipped atlas.
export const PORTRAIT_SHEETS:Readonly<Record<string,readonly Portrait[]>>={
  'industrial-units':group('industrial',['worker','soldier','scout','medic','sniper','tank','artillery','fighter','mech']),
  'industrial-buildings':group('industrial',['base','barracks','factory','airfield','refinery','research','lumbermill','powerplant','tower']),
  'industrial-support':[
    ...group('industrial',['commander','disruptor','oilwell','supplyDepot','infirmary','commandPost']),
    {kind:'escortDepot',race:'relay'},
  ],
  'brood-units':group('brood',['worker','broodling','spitter','behemoth','bioWing','sac','nurturer','infector','binder']),
  'brood-buildings':group('brood',['base','refinery','lumbermill','tower','oilwell','hatchery','nursery','gland','burrow']),
  'stellar-units':group('stellar',['worker','lancer','prism','colossus','starWing','weaver','guide','arbiter']),
  'stellar-buildings':group('stellar',['base','refinery','lumbermill','tower','oilwell','node','resonator','warpHub','phaseSanctum']),
  'relay-units':[
    ...group('relay',['worker','ranger','runner','flak','relayWing','pathfinder','observer','escort']),
    {kind:'assembly',race:'relay',packed:true},
  ],
  'relay-buildings':group('relay',['base','refinery','lumbermill','tower','oilwell','assembly','relayTower','routePost','observatory']),
};

export const PORTRAIT_COLUMNS=8;
export const PORTRAIT_FILE='generated/model-portraits-v2.webp';
export const MODEL_PORTRAITS=Object.values(PORTRAIT_SHEETS).flat();
export const PORTRAIT_ROWS=Math.ceil(MODEL_PORTRAITS.length/PORTRAIT_COLUMNS);

const portraitKey=(kind:Kind,race:Race,packed=false)=>`${race}:${kind}${packed?':packed':''}`;
const byRace=new Map<string,number>();
const byKind=new Map<Kind,number>();
MODEL_PORTRAITS.forEach(({kind,race,packed},cell)=>{
  byRace.set(portraitKey(kind,race,packed),cell);
  if(!packed&&(race==='industrial'||!shared.some(sharedKind=>sharedKind===kind)))byKind.set(kind,cell);
});

export function portraitCell(kind:Kind,race?:Race,packed=false){
  const cell=race?byRace.get(portraitKey(kind,race,packed))??byRace.get(portraitKey(kind,race)):undefined;
  return cell??byKind.get(kind);
}

export const portraitAtlas=assetPath(PORTRAIT_FILE);
