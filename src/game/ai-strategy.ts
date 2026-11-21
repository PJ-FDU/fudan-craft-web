import { gridSize,indexAt,distance } from './pathfinding.js';
import { isMobile,type AIPlan,type AiStyle,type Player,type Unit,type Point,type Side } from './types.js';
export const AI_STYLES:Record<AiStyle,{name:string;workers:number;attackDelay:number;attackSize:number;expandAfter:number;research:('weapons'|'armor'|'logistics'|'advanced'|'aviation')[]}> = {
  balanced:{name:'均衡推进',workers:0,attackDelay:1,attackSize:0,expandAfter:100,research:['weapons','logistics','armor','advanced','aviation']},
  rush:{name:'快攻压制',workers:-2,attackDelay:.65,attackSize:-2,expandAfter:180,research:['weapons','advanced','armor','logistics','aviation']},
  economic:{name:'经济扩张',workers:4,attackDelay:1.4,attackSize:2,expandAfter:55,research:['logistics','weapons','armor','advanced','aviation']},
  defensive:{name:'稳守反击',workers:2,attackDelay:1.65,attackSize:3,expandAfter:130,research:['armor','weapons','logistics','advanced','aviation']},
};
/** 只用本轮已见敌军刷新记忆。曾经看到的位置可供计划使用，不能追踪迷雾中的移动。 */
export function rememberEnemies(plans:Partial<Record<Side,AIPlan>>,player:Player,enemies:Unit[],visible:ArrayLike<number>,time:number){
  const size=gridSize(visible);
  const style=player.aiStyle??'balanced',plan=plans[player.side]??={style,contacts:[],nextAttack:0,lastPlan:0};
  plan.style=style;
  const contacts=new Map(plan.contacts.filter(c=>time-c.seen< (isMobile(c)?45:120)
    &&(!visible[indexAt(c,size)]||enemies.some(u=>u.id===c.id&&distance(u,c)<64))).map(c=>[c.id,c]));
  for(const u of enemies)contacts.set(u.id,{id:u.id,kind:u.kind,side:u.side,x:u.x,y:u.y,hp:u.hp,seen:time});
  plan.contacts=[...contacts.values()].sort((a,b)=>Number(b.kind==='base')-Number(a.kind==='base')||b.seen-a.seen).slice(0,128);
  return plan;
}
export function strategicTarget(plan:AIPlan,home:Point,starts?:readonly (Point&{side:Side})[]):Point|undefined{
  if(starts){
    const supplies=plan.contacts.filter(c=>['oilwell','refinery','lumbermill'].includes(c.kind)&&
      starts.some(start=>start.side===c.side&&distance(c,start)>850));
    if(supplies.length)return supplies.sort((a,b)=>distance(a,home)-distance(b,home)||a.hp-b.hp)[0];
  }
  const bases=plan.contacts.filter(c=>c.kind==='base');
  return bases.sort((a,b)=>{
    const score=(p:Point)=>distance(p,home)+plan.contacts.filter(c=>['tower','tank','artillery','mech'].includes(c.kind)&&distance(c,p)<450).length*(plan.style==='rush'?80:180);
    return score(a)-score(b);
  })[0];
}
