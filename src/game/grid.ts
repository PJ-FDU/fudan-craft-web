import { MAP } from './map.js';
import type { Point } from './types.js';

export const TILE=MAP.tile;
export const SIZE=MAP.width;
export const WORLD=SIZE*TILE;
export const gridSize=(mask:{length:number})=>Math.sqrt(mask.length);
export const indexAt=(p:Point,size:number=SIZE)=>Math.floor(p.y/TILE)*size+Math.floor(p.x/TILE);
export const inBounds=(x:number,y:number,size:number=SIZE)=>x>=0&&y>=0&&x<size&&y<size;
