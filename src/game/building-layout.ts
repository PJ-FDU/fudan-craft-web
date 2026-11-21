import { TILE, WORLD } from './pathfinding.js';
import type { BuildingFacing, BuildingKind, LegacyBuildingKind, Point } from './types.js';

export interface BuildPlacement {
  kind:BuildingKind;
  point:Point;
  facing:BuildingFacing;
}
const facets = {
  base:      ['###','###','###'],
  barracks:  ['.#.','###','###'],
  factory:   ['###','###','###'],
  airfield:  ['###','###','.#.'],
  refinery:  ['.#.','###','.#.'],
  research:  ['.#.','###','.#.'],
  lumbermill:['##.','###','###'],
  powerplant:['.##','###','##.'],
  tower:     ['...','.#.','...'],
  oilwell:   ['...','.#.','...'],
} satisfies Record<LegacyBuildingKind,string[]>;
const special={hatchery:facets.barracks,resonator:facets.barracks,assembly:facets.factory,node:facets.tower,relayTower:facets.tower,supplyDepot:facets.powerplant};
const offsets:Record<LegacyBuildingKind,number> = {
  base:0,barracks:1,factory:0,airfield:2,refinery:1,research:3,lumbermill:2,powerplant:3,tower:0,oilwell:0,
};

export const validFacing=(value:unknown):value is BuildingFacing=>value===0||value===1||value===2||value===3;
export const nextFacing=(facing:BuildingFacing)=>(facing+1)%4 as BuildingFacing;

export function buildingFacing(kind:BuildingKind,point:Point,extent=WORLD):BuildingFacing {
  const x=point.x-extent/2,y=point.y-extent/2;
  const outward=Math.abs(x)>Math.abs(y)?(x>0?1:3):(y>0?0:2);
  return (outward+(offsets[kind as LegacyBuildingKind]??0))%4 as BuildingFacing;
}

function rotateFootprint(p:Point,facing:BuildingFacing):Point {
  switch(facing){
    case 1:return {x:p.y,y:-p.x};
    case 2:return {x:-p.x,y:-p.y};
    case 3:return {x:-p.y,y:p.x};
    default:return p;
  }
}

const footprint=new Map<BuildingKind,Point[][]>(Object.entries({...facets,...special}).map(([kind,rows])=>{
  const cells=rows.flatMap((row,y)=>[...row].flatMap((cell,x)=>cell==='#'?[{x:x-1,y:y-1}]:[]));
  return [kind as BuildingKind,[0,1,2,3].map(i=>cells.map(p=>rotateFootprint(p,i as BuildingFacing)))];
}));

export function buildingTiles(kind:BuildingKind,point:Point,facing:BuildingFacing=buildingFacing(kind,point)) {
  const x=Math.floor(point.x/TILE),y=Math.floor(point.y/TILE);
  return (footprint.get(kind)??footprint.get('research')!)[facing].map(p=>({x:x+p.x,y:y+p.y}));
}

export function buildingSize(kind:BuildingKind) {
  const cells=(footprint.get(kind)??footprint.get('research')!)[0];
  const xs=cells.map(p=>p.x),ys=cells.map(p=>p.y);
  return {width:(Math.max(...xs)-Math.min(...xs)+1)*TILE,depth:(Math.max(...ys)-Math.min(...ys)+1)*TILE};
}
