import { ROSTERS } from './races.js';
import { RACES,type Race } from './types.js';

/** 预载完整科技树与收拢形态，确保对局中新造兵种不触发下载或缺模。 */
export function battleModelKeys(races:readonly Race[]){
  return [...new Set(races)].flatMap(race=>{
    const roster=ROSTERS[race];
    return ['base',...roster.units,...roster.buildings,...(race==='relay'?['assembly:packed']:[])]
      .map(kind=>`${race}:${kind}`);
  });
}
export function localBattleRaces(count:number,race:Race,opponent:Race):Race[]{
  return Array.from({length:count},(_,i)=>i===0?race:i===1?opponent:RACES[(RACES.indexOf(opponent)+i-1)%RACES.length]);
}
