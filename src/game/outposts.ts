import type { MapId } from './maps.js';
import type { Point, ResourceNode } from './types.js';

export const OUTPOST_STOCK = {gold:4500,oil:1500} as const;
export const OUTPOST_FIGHT_RANGE = 360;
export const OUTPOST_SCOUT_TIME = 35;
export const OUTPOST_OIL_RESERVE = 1200;

export function isOutpostMap(mapId:MapId) {
  return mapId==='twin-lakes'||mapId==='ring-valley';
}

export function isOutpost(node:ResourceNode) {
  return node.startSide===undefined&&(node.kind==='gold'||node.kind==='oil')&&node.max===OUTPOST_STOCK[node.kind];
}

export function outpostAnchor(base:Point,extent:number,kind:'gold'|'oil'='oil'):Point {
  const x=extent/2-base.x,y=extent/2-base.y,length=Math.hypot(x,y)||1;
  const offset=kind==='oil'?1480:1120;
  return {x:base.x+x/length*offset,y:base.y+y/length*offset};
}
