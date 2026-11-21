import { validPoint } from './engine.js';
import { validFacing } from './building-layout.js';
import { isAbility } from './abilities.js';
import { ALL_MOBILE_KINDS,ALL_BUILDING_KINDS,TECHS,type Command } from './types.js';

const id=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
const orders=(ids:unknown):ids is number[]=>Array.isArray(ids)&&ids.length<=140&&ids.every(id);
/** 服务端和浏览器房主共用边界校验，Engine 负责资源、归属及战争迷雾。 */
export function validCommand(x:unknown,extent:number):x is Command {
  if(!x||typeof x!=='object')return false;
  const c=x as Command,point=(p:unknown)=>validPoint(p,extent);
  if(c.type==='train')return ALL_MOBILE_KINDS.includes(c.kind)&&(c.producer===undefined||id(c.producer));
  if(c.type==='research')return Object.hasOwn(TECHS,c.tech);
  if(c.type==='cancel')return Number.isInteger(c.index)&&c.index>=0&&c.index<24;
  if(c.type==='cancel-build')return id(c.id);
  if(c.type==='factory-module')return id(c.id)&&(c.module==='armor'||c.module==='support');
  if(c.type==='station')return id(c.id)&&(c.action==='pack'||c.action==='stop'||(c.action==='move'||c.action==='deploy')&&point(c.point));
  if(c.type==='cast')return orders(c.ids)&&isAbility(c.skill)&&(c.target===undefined||id(c.target))&&(c.area===undefined||id(c.area))&&(c.point===undefined||point(c.point));
  if(c.type==='medic-auto')return orders(c.ids)&&typeof c.enabled==='boolean';
  if(c.type==='rally')return point(c.point);
  if(c.type==='build')return ALL_BUILDING_KINDS.includes(c.kind)&&c.kind!=='base'&&point(c.point)&&id(c.worker)&&(c.facing===undefined||validFacing(c.facing));
  if(!['order','stop','hold','gather','repair'].includes(c.type)||!('ids'in c)||!orders(c.ids))return false;
  if(c.type==='repair')return id(c.target);
  if(c.type==='gather')return id(c.node);
  return c.type!=='order'||(point(c.point)&&(c.target===undefined||id(c.target))&&(c.assault===undefined||typeof c.assault==='boolean'));
}
