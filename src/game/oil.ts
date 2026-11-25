import { TILE } from './pathfinding.js';
import type { Point, ResourceNode, Side, Unit } from './types.js';

export const OIL_PER_SECOND = 14;

export function oilNodeAt(point: Point, nodes: readonly ResourceNode[]) {
  return nodes.find(node => node.kind === 'oil' &&
    Math.floor(node.x / TILE) === Math.floor(point.x / TILE) &&
    Math.floor(node.y / TILE) === Math.floor(point.y / TILE));
}

export function hasRefinery(side: Side, units: readonly Unit[]) {
  return units.some(unit => unit.kind === 'refinery' && unit.side === side && unit.hp > 0 && unit.construction >= 1);
}
