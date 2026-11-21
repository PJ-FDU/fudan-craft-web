import { ALL_MOBILE_KINDS,isMobile,unitCost,type Cost,type MobileKind,type Player,type Unit,type Point } from './types.js';

export interface EconomySample {time:number;gold:number;wood:number;oil:number;army:number;workers:number}
export const MATCH_EVENT_KINDS = ['outpostIncome','outpostFight','firstTank','oilStopped','supplyRaid','mainGoldLow','mainOilLow'] as const;
export type MatchEventKind = typeof MATCH_EVENT_KINDS[number];
export interface MatchEvent extends Point {kind:MatchEventKind;time:number}

export const MATCH_EVENT_NAMES:Record<MatchEventKind,string>={
  outpostIncome:'前哨首次入账',outpostFight:'前哨首次交战',firstTank:'首辆坦克出场',
  oilStopped:'油井断供',supplyRaid:'补给线遭袭',mainGoldLow:'主金矿即将枯竭',mainOilLow:'主油点即将枯竭',
};
export const isSupplyAlert=(event:MatchEvent)=>event.kind==='oilStopped'||event.kind==='supplyRaid'||event.kind==='mainGoldLow'||event.kind==='mainOilLow';

export interface MatchStats {
  since:number;income:Cost;spent:Cost;refunded:Cost;killedValue:Cost;lostValue:Cost;
  damage:number;healing:number;workerIdleSeconds:number;bounty:number;
  trained:Partial<Record<MobileKind,number>>;series:EconomySample[];events?:MatchEvent[];
}
const zero=():Cost=>({gold:0,wood:0,oil:0});
export const newMatchStats=(since=0):MatchStats=>({since,income:zero(),spent:zero(),refunded:zero(),killedValue:zero(),lostValue:zero(),damage:0,healing:0,workerIdleSeconds:0,bounty:0,trained:{},series:[]});
export function recordMatchEvent(player:Player,kind:MatchEventKind,point:Point,time:number){
  const stats=player.stats??=newMatchStats(time),events=stats.events??=[];
  const recurring=kind==='supplyRaid'||kind==='oilStopped';
  if(events.some(event=>event.kind===kind&&(!recurring||time-event.time<25)))return;
  events.push({kind,time,x:point.x,y:point.y});
  if(events.length>64){
    const removable=events.findIndex(event=>event.kind==='supplyRaid'||event.kind==='oilStopped');
    events.splice(removable,1);
  }
}
export function addCost(target:Cost,cost:Cost,factor=1){target.gold+=cost.gold*factor;target.wood+=cost.wood*factor;target.oil+=cost.oil*factor;}
export function recordEconomy(p:Player,units:Unit[],time:number,dt:number){
  const stats=p.stats??=newMatchStats(time),own=units.filter(u=>u.side===p.side&&u.hp>0);
  stats.workerIdleSeconds+=own.filter(u=>u.kind==='worker'&&u.order==='idle').length*dt;
  if(!stats.series.length||time-stats.series.at(-1)!.time>=30-1e-6){
    stats.series.push({time,gold:p.credits,wood:p.wood,oil:p.oil,army:own.filter(u=>isMobile(u)&&u.kind!=='worker').length,workers:own.filter(u=>u.kind==='worker').length});
    if(stats.series.length>180)stats.series.shift();
  }
}
export function recordKill(attacker:Player,victim:Player,unit:Unit){
  const cost=unitCost(unit.kind);
  addCost((attacker.stats??=newMatchStats()).killedValue,cost);
  addCost((victim.stats??=newMatchStats()).lostValue,cost);
}
/** 历史存档允许缺少统计；新字段严格校验，不能把无效统计带入导出和联机。 */
export function validMatchStats(value:unknown,time:number,extent=Infinity):value is MatchStats{
  if(!value||typeof value!=='object')return false;
  const s=value as MatchStats,n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  const cost=(c:Cost)=>!!c&&[c.gold,c.wood,c.oil].every(n);
  return n(s.since)&&s.since<=time&&[s.income,s.spent,s.refunded,s.killedValue,s.lostValue].every(cost)
    &&[s.damage,s.healing,s.workerIdleSeconds,s.bounty].every(n)
    &&!!s.trained&&Object.entries(s.trained).every(([kind,count])=>ALL_MOBILE_KINDS.includes(kind as MobileKind)&&n(count)&&Number.isInteger(count))
    &&(s.events===undefined||Array.isArray(s.events)&&s.events.length<=64&&s.events.every((event,i)=>
      event&&MATCH_EVENT_KINDS.includes(event.kind)&&n(event.x)&&event.x<extent&&n(event.y)&&event.y<extent&&
      n(event.time)&&event.time<=time&&(i===0||event.time>=s.events![i-1].time)))
    &&Array.isArray(s.series)&&s.series.length<=180&&s.series.every((p,i)=>p&&[p.time,p.gold,p.wood,p.oil,p.army,p.workers].every(n)&&p.time<=time&&(i===0||p.time>=s.series[i-1].time));
}
