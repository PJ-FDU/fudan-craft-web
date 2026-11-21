import type { Kind } from './types.js';
export interface Weapon {windup:number;recovery:number;speed:number;trace:number}
export function weapon(kind:Kind):Weapon{
  if(kind==='tank')return {windup:.24,recovery:.32,speed:520,trace:.16};
  if(kind==='artillery')return {windup:.36,recovery:.4,speed:420,trace:.16};
  if(kind==='sniper')return {windup:.24,recovery:.2,speed:0,trace:.12};
  if(kind==='medic')return {windup:.16,recovery:.24,speed:0,trace:.24};
  return {windup:kind==='soldier'?.12:.1,recovery:.2,speed:0,trace:.12};
}
