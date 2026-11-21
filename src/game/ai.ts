import { runFactionAI } from './faction-ai.js';
import type { Engine } from './engine.js';
import { powerFor,requirement } from './engine.js';
import { STATS,TECHS,isCombat,isMobile,maxHp,unitCost,type Unit,type Kind,type MobileKind,type BuildingKind,type Tech,type Cost,type Point } from './types.js';
import { linkedRefinery, oilNodeAt, OIL_PIPE_RANGE } from './oil.js';
import { isOutpost,outpostAnchor,OUTPOST_SCOUT_TIME,OUTPOST_OIL_RESERVE } from './outposts.js';
import { distance } from './pathfinding.js';
import { AI_STYLES,rememberEnemies,strategicTarget } from './ai-strategy.js';
import { openingMapRevision } from './world.js';

export const AI_LEVELS = {
  easy:{workers:10,attackAfter:150,attackSize:11,retreat:.2,guards:3,tactics:false},
  normal:{workers:12,attackAfter:100,attackSize:9,retreat:.28,guards:2,tactics:true},
  hard:{workers:14,attackAfter:65,attackSize:7,retreat:.35,guards:2,tactics:true},
} as const;
const ready=(u:Unit)=>u.hp>0&&u.construction>=1;
const canPay=(p:{credits:number;wood:number;oil:number},cost:Cost)=>p.credits+1e-6>=cost.gold&&p.wood+1e-6>=cost.wood&&p.oil+1e-6>=cost.oil;
const strength=(u:Unit)=>STATS[u.kind].damage/STATS[u.kind].cooldown*Math.sqrt(u.hp/STATS[u.kind].hp)+(u.kind==='medic'?5:0);
const center=(units:Unit[],fallback:Point)=>units.length?{x:units.reduce((s,u)=>s+u.x,0)/units.length,y:units.reduce((s,u)=>s+u.y,0)/units.length}:fallback;

/** 不读取隐藏敌军、敌方银行或科技。难度只改变决策阈值，所有下单仍经过 Engine.command。 */
export function runAI(e:Engine){
  const longerOpening=e.world.revision>=openingMapRevision(e.world.id);
  for(const p of e.state.players){
    const base=e.base(p.side);if(!p.ai||!base)continue;
    if(p.race){runFactionAI(e,p,base);continue;}
    const level=AI_LEVELS[e.state.difficulty],own=e.state.units.filter(u=>u.side===p.side&&u.hp>0),workers=own.filter(u=>u.kind==='worker');
    const army=own.filter(isCombat),fighters=army.filter(u=>u.kind!=='medic'),vis=e.visible.get(p.side)!;
    const enemies=e.state.units.filter(u=>!e.allied(u.side,p.side)&&u.hp>0&&vis[e.indexAt(u)]);
    const plan=rememberEnemies(e.state.aiPlans??={},p,enemies,vis,e.state.time),style=AI_STYLES[plan.style];
    const workerGoal=Math.max(6,level.workers+style.workers),attackSize=Math.max(5,level.attackSize+style.attackSize);
    const scoutAfter=longerOpening?55*style.attackDelay:25;
    const attackAfter=(level.attackAfter+(longerOpening?25:0))*style.attackDelay;
    const threats=enemies.filter(u=>STATS[u.kind].damage>0);
    const depots=own.filter(u=>ready(u)&&['base','refinery','lumbermill'].includes(u.kind));
    const homeThreats=threats.filter(u=>depots.some(d=>distance(u,d)<650)||workers.some(w=>distance(u,w)<280));
    const underAttack=homeThreats.length>0;
    const pilot=e.outpostPilot&&e.state.oilWells;
    const forward=pilot?outpostAnchor(base,e.extent):undefined;
    const forwardGold=pilot?outpostAnchor(base,e.extent,'gold'):undefined;
    const front=forward&&e.state.nodes.find(n=>n.kind==='oil'&&isOutpost(n)&&distance(n,forward)<180&&vis[e.indexAt(n)]);
    const mine=forwardGold&&e.state.nodes.find(n=>n.kind==='gold'&&isOutpost(n)&&distance(n,forwardGold)<180&&vis[e.indexAt(n)]);
    const frontRefinery=forward&&own.find(u=>u.kind==='refinery'&&distance(u,forward)<=OIL_PIPE_RANGE);
    const frontWell=front&&own.find(u=>u.kind==='oilwell'&&e.indexAt(u)===e.indexAt(front));
    const mainOil=pilot?e.state.nodes.find(n=>n.kind==='oil'&&n.startSide===p.side&&vis[e.indexAt(n)]):undefined;
    const has=(kind:Kind)=>own.some(u=>u.kind===kind&&ready(u));
    const count=(kind:Kind)=>own.filter(u=>u.kind===kind).length+p.queue.filter(q=>q.kind===kind).length;
    const move=(units:Unit[],point:Point,assault=false)=>{if(units.length)e.command(p.side,{type:'order',ids:units.map(u=>u.id),point,assault});};
    const safeDepot=(u:Unit)=>depots.filter(d=>!threats.some(t=>distance(t,d)<300)).sort((a,b)=>distance(a,u)-distance(b,u))[0]??base;
    const gather=(u:Unit,kind:'gold'|'wood'|'oil')=>{
      const nodes=e.state.nodes.filter(n=>n.kind===kind&&n.amount>0&&vis[e.indexAt(n)]&&!threats.some(t=>distance(t,n)<360)).sort((a,b)=>distance(a,u)-distance(b,u));
      for(const candidate of nodes.slice(0,4)){
        const node=e.nearestNode(u,kind,candidate);
        if(node&&vis[e.indexAt(node)]&&!threats.some(t=>distance(t,node)<360)&&!e.command(p.side,{type:'gather',ids:[u.id],node:node.id}))return true;
      }
      return false;
    };

    // 采集车先脱离火力，再恢复经济；运回现有货物后才重新分配资源。
    for(const u of workers){
      if(threats.some(t=>distance(t,u)<STATS[t.kind].range+70)&&u.order!=='move'){move([u],safeDepot(u));continue;}
      if(u.order==='build'||u.order==='repair'||u.order==='move')continue;
      const legacyOil=!e.state.oilWells&&has('refinery');
      const quotas={gold:Math.ceil(workers.length*.45),wood:Math.ceil(workers.length*.35),oil:legacyOil?Math.max(2,Math.floor(workers.length*.2)):0};
      if(p.wood<200)quotas.wood+=2;
      if(has('factory')&&p.oil<120)quotas.oil+=2;
      const assigned=(kind:string)=>workers.filter(w=>w.id!==u.id&&w.order==='gather'&&e.state.nodes.find(n=>n.id===w.resource)?.kind===kind).length;
      const kinds=(['gold','wood','oil'] as const).filter(k=>k!=='oil'||legacyOil).sort((a,b)=>(quotas[b]-assigned(b))-(quotas[a]-assigned(a)));
      const current=e.state.nodes.find(n=>n.id===u.resource);
      if(u.order==='idle'||u.order==='gather'&&u.cargo===0&&!u.returning&&current&&quotas[current.kind]-assigned(current.kind)<-1)
        for(const kind of kinds)if(gather(u,kind))break;
    }
    if(mine&&mine.amount>0&&frontRefinery&&ready(frontRefinery)&&!threats.some(t=>distance(t,mine)<420)){
      const assigned=workers.filter(u=>u.resource===mine.id&&u.order==='gather').length;
      if(assigned<2){
        const worker=workers.filter(u=>!u.cargo&&(u.order==='idle'||u.order==='gather')&&u.resource!==mine.id)
          .sort((a,b)=>distance(a,mine)-distance(b,mine))[0];
        if(worker)e.command(p.side,{type:'gather',ids:[worker.id],node:mine.id});
      }
    }
    if(count('worker')<workerGoal&&!p.queue.some(q=>q.kind==='worker')&&(!underAttack||workers.length<5))e.command(p.side,{type:'train',kind:'worker'});

    const damaged=own.filter(u=>!isMobile(u)&&ready(u)&&u.hp<maxHp(u,p)*.85)
      .sort((a,b)=>(a.kind==='base'?-2:a.kind==='powerplant'&&!powerFor(p.side,own).active?-1:0)-(b.kind==='base'?-2:b.kind==='powerplant'?-1:0)||a.hp/maxHp(a,p)-b.hp/maxHp(b,p));
    const damagedBuilding=damaged[0];
    if(damagedBuilding){
      const needed=underAttack?Math.min(3,workers.length-2):1;
      const assigned=workers.filter(u=>u.order==='repair'&&u.target===damagedBuilding.id).length;
      const available=workers.filter(u=>u.order==='idle'||u.order==='gather').sort((a,b)=>distance(a,damagedBuilding)-distance(b,damagedBuilding));
      const chosen=available.slice(0,Math.max(0,needed-assigned));
      if(chosen.length)e.command(p.side,{type:'repair',ids:chosen.map(u=>u.id),target:damagedBuilding.id});
    }
    const abandoned=own.find(u=>!isMobile(u)&&u.construction<1&&!workers.some(w=>w.order==='build'&&w.target===u.id));
    const builder=workers.filter(u=>u.order==='idle'||u.order==='gather').sort((a,b)=>Number(a.cargo>0)-Number(b.cargo>0))[0];
    if(abandoned&&builder)e.command(p.side,{type:'order',ids:[builder.id],point:abandoned,target:abandoned.id});

    const power=powerFor(p.side,own),plans:BuildingKind[]=[];
    const pendingPower=own.filter(u=>!ready(u)&&STATS[u.kind].power<0).reduce((sum,u)=>sum-STATS[u.kind].power,0);
    if(power.capacity+pendingPower-power.used<25)plans.push('powerplant');
    if(!count('barracks'))plans.push('barracks');
    if(!count('lumbermill'))plans.push('lumbermill');
    let oilField:Point|undefined;
    const forwardDue=!!forward&&has('factory')&&workers.length>=6&&(p.oil<600||
      (mainOil?.amount??Infinity)<=OUTPOST_OIL_RESERVE||plan.style==='economic'&&e.state.time>=100);
    const canAdvanceOil=forwardDue&&front&&front.amount>0&&!threats.some(t=>distance(t,front)<460);
    if(e.state.oilWells){
      const wells=own.filter(u=>u.kind==='oilwell');
      const supplied=wells.some(well=>(oilNodeAt(well,e.state.nodes)?.amount??0)>0&&linkedRefinery(p.side,well,own));
      if(canAdvanceOil&&!frontWell&&front){
        if(linkedRefinery(p.side,front,own)&&!e.state.units.some(u=>u.kind==='oilwell'&&e.indexAt(u)===e.indexAt(front))){
          oilField=front;
          plans.push('oilwell');
        }else if(!frontRefinery){
          oilField=front;
          plans.push('refinery');
        }
      }
      if(!oilField&&!supplied&&p.oil<600){
        const fields=e.state.nodes.filter(n=>n.kind==='oil'&&n.amount>0&&vis[e.indexAt(n)]&&
          !threats.some(t=>distance(t,n)<360)).sort((a,b)=>distance(a,base)-distance(b,base));
        oilField=fields.find(n=>linkedRefinery(p.side,n,own)&&!e.state.units.some(u=>u.kind==='oilwell'&&e.indexAt(u)===e.indexAt(n)));
        if(oilField)plans.push('oilwell');
        else{
          oilField=fields.find(n=>!own.some(u=>u.kind==='refinery'&&distance(u,n)<=OIL_PIPE_RANGE));
          if(oilField)plans.push('refinery');
        }
      }
    }else if(!count('refinery'))plans.push('refinery');
    for(const kind of ['factory','research'] as const)if(!count(kind))plans.push(kind);
    if(e.state.time>180&&fighters.length>=12&&count('barracks')<2)plans.push('barracks');
    if(e.state.time>240&&has('research')&&has('factory')&&!count('airfield')&&p.oil>240)plans.push('airfield');
    if((underAttack||plan.style==='defensive'&&e.state.time>90)&&count('tower')<(plan.style==='defensive'?3:2)&&has('refinery'))plans.splice(1,0,'tower');
    let buildNear:Point=base;
    // 长距离运输会拖垮收入；在已探索的安全矿区逐步延伸交付点。
    if(e.state.time>=style.expandAfter&&workers.length>=10&&!underAttack&&!plans.length){
      const remote=e.state.nodes.filter(n=>n.kind==='gold'&&n.amount>1500&&vis[e.indexAt(n)]&&depots.every(d=>distance(d,n)>550)&&!threats.some(t=>distance(t,n)<500)).sort((a,b)=>distance(a,base)-distance(b,base))[0];
      if(remote&&count('lumbermill')<3){plans.push('lumbermill');buildNear=remote;}
    }
    const nextBuilding=plans.find(kind=>!requirement(kind,p,own));
    if(builder&&!workers.some(u=>u.order==='build')&&nextBuilding&&canPay(p,unitCost(nextBuilding))){
      const near=nextBuilding==='tower'?homeThreats[0]??base:nextBuilding==='refinery'||nextBuilding==='oilwell'
        ?oilField??e.state.nodes.find(n=>n.kind==='oil'&&vis[e.indexAt(n)]&&distance(n,base)<900)??base
        :buildNear;
      const site=e.findBuildSpot(p.side,nextBuilding,near,vis);
      if(site)for(const worker of workers.filter(u=>u.order==='idle'||u.order==='gather').sort((a,b)=>distance(a,site)-distance(b,site)))
        if(!e.command(p.side,{type:'build',kind:nextBuilding,point:site,worker:worker.id}))break;
    }
    const researchable=style.research.filter(tech=>{
      const rule=TECHS[tech];return !p.tech.includes(tech)&&!p.queue.some(q=>q.kind===tech)&&(!rule.requires||p.tech.includes(rule.requires))&&(!rule.building||has(rule.building));
    });
    if(has('research')&&!p.queue.some(q=>q.research)&&!underAttack)
      for(const tech of researchable)if(!e.command(p.side,{type:'research',tech}))break;

    const air=plan.contacts.filter(u=>STATS[u.kind].air).length,infantry=plan.contacts.filter(u=>['soldier','sniper','medic'].includes(u.kind)).length;
    const defenses=plan.contacts.filter(u=>!isMobile(u)&&STATS[u.kind].damage>0).length;
    const candidates:MobileKind[]=[];
    if(count('medic')<Math.floor(fighters.length/7)&&has('research'))candidates.push('medic');
    if(air>0&&p.tech.includes('aviation'))candidates.push('fighter');
    const needSiege=level.tactics&&defenses>0&&p.tech.includes('advanced')&&has('factory')&&
      count('artillery')===0&&plan.contacts.some(u=>u.kind==='base');
    if(needSiege)candidates.unshift('artillery');
    else if(defenses>0&&p.tech.includes('advanced')&&count('artillery')<Math.max(2,Math.floor(fighters.length/6)))candidates.push('artillery');
    if(infantry>=3&&count('sniper')<Math.ceil(fighters.length/4))candidates.push('sniper');
    if(p.tech.includes('advanced')&&count('mech')<Math.ceil(fighters.length/6))candidates.push('mech');
    if(air===0&&count('tank')<Math.ceil(fighters.length/3))candidates.push('tank');
    if(p.tech.includes('advanced')&&count('artillery')<Math.ceil(fighters.length/8))candidates.push('artillery');
    if(p.tech.includes('aviation')&&count('fighter')<Math.ceil(fighters.length/5))candidates.push('fighter');
    candidates.push('soldier');
    const reserve=!underAttack&&fighters.length>=5?(nextBuilding?unitCost(nextBuilding):has('research')&&!p.queue.some(q=>q.research)&&researchable[0]?TECHS[researchable[0]].cost:null):null;
    const used=new Set<Kind>();
    for(const kind of candidates){
      if(requirement(kind,p,own))continue;
      const producer=STATS[kind].producer!;if(used.has(producer))continue;
      if(p.queue.filter(q=>!q.research&&STATS[q.kind as MobileKind].producer===producer).length>=2)continue;
      const cost=unitCost(kind);
      const budget=needSiege&&!underAttack&&kind!=='artillery'?unitCost('artillery'):reserve;
      if(budget&&!canPay(p,{gold:cost.gold+budget.gold,wood:cost.wood+budget.wood,oil:cost.oil+budget.oil}))continue;
      if(!e.command(p.side,{type:'train',kind}))used.add(producer);
    }

    const wounded=new Set<number>();
    for(const u of army)if(u.kind!=='medic'&&u.hp/maxHp(u,p)<level.retreat&&threats.some(t=>distance(t,u)<420)){
      wounded.add(u.id);if(u.order!=='move')move([u],safeDepot(u));
    }
    const scouting=forward&&!frontRefinery&&!underAttack&&e.state.time>=OUTPOST_SCOUT_TIME*style.attackDelay
      ?fighters.find(u=>u.kind==='scout'&&(u.order==='idle'||u.order==='move'&&u.destination&&distance(u.destination,forward)<180))
      :undefined;
    if(scouting&&!front&&scouting.order==='idle')move([scouting],forward!);
    const protectedSite=forward&&((frontRefinery&&!ready(frontRefinery))||(frontWell&&!ready(frontWell))||oilField&&distance(oilField,forward)<180)
      ?oilField??frontRefinery??frontWell
      :undefined;
    const escort=protectedSite&&!underAttack?fighters.filter(u=>u.kind==='soldier'&&!wounded.has(u.id)&&u.order!=='attack')
      .sort((a,b)=>distance(a,protectedSite)-distance(b,protectedSite)).slice(0,2):[];
    if(protectedSite){
      const needsOrders=escort.filter(u=>distance(u,protectedSite)>240&&(!u.destination||distance(u.destination,protectedSite)>200||!u.path.length));
      move(needsOrders,protectedSite,true);
    }
    const available=fighters.filter(u=>!wounded.has(u.id)&&u.order!=='move');
    if(underAttack){
      const threat=homeThreats.sort((a,b)=>distance(a,base)-distance(b,base))[0];
      move(available.filter(u=>u.order!=='attack'||distance(u,threat)>350),threat,true);
    }else{
      const guards=available.filter(u=>u.kind==='soldier').sort((a,b)=>distance(a,base)-distance(b,base)).slice(0,level.guards);
      for(const u of guards)if(u.order==='idle'&&distance(u,base)>400)move([u],base,true);
      const offensive=available.filter(u=>!guards.includes(u)&&!escort.includes(u)&&u!==scouting);
      // 出生区是公开地图锚点；先侦察，再向已经探索过的敌方据点集结推进。
      const locations=e.world.bases.filter(b=>e.state.players.some(p=>p.side===b.side)&&!e.allied(b.side,p.side)&&(!vis[e.indexAt(b)]||enemies.some(u=>u.kind==='base'&&distance(u,b)<100))).sort((a,b)=>distance(a,base)-distance(b,base));
      const unexploredBase=locations.find(b=>!e.state.explored[p.side][e.indexAt(b)]);
      const enemyForward=pilot&&unexploredBase?outpostAnchor(unexploredBase,e.extent):undefined;
      const unexplored=enemyForward&&!e.state.explored[p.side][e.indexAt(enemyForward)]?enemyForward:unexploredBase;
      const scout=offensive.find(u=>u.kind==='scout'&&u.order==='idle');
      if(unexplored&&scout&&e.state.time>scoutAfter)move([scout],unexplored);
      if(e.state.time-plan.lastPlan>=12||!plan.target){plan.target=strategicTarget(plan,base,pilot?e.world.bases:undefined)??locations.find(b=>e.state.explored[p.side][e.indexAt(b)]);plan.lastPlan=e.state.time;}
      const target=plan.target,readyToAdvance=(u:Unit)=>u.order==='idle'||u.order==='hold'||u.order==='assault'&&!u.path.length&&!u.target;
      if(e.state.time>attackAfter&&e.state.time>=plan.nextAttack&&available.length>=attackSize&&target){
        const grouped=offensive.filter(readyToAdvance);
        if(grouped.length>=3){move(grouped,target,true);plan.nextAttack=e.state.time+12;}
      }else if(e.state.time>attackAfter&&unexplored&&offensive.length>=attackSize){
        move(offensive.filter(readyToAdvance),unexplored,true);
      }
      const front=offensive.filter(u=>distance(u,base)>700),position=center(front,base);
      const localEnemy=threats.filter(u=>distance(u,position)<480);
      if(level.tactics&&front.length>=3&&localEnemy.reduce((s,u)=>s+strength(u),0)>front.reduce((s,u)=>s+strength(u),0)*1.7)move(front,safeDepot(front[0]));
    }
    // 支援跟随前线，狙击手和火炮拉开距离；集中火力优先处理近身火力与医疗兵。
    for(const medic of army.filter(u=>u.kind==='medic'&&u.order==='idle')){
      const patients=fighters.filter(u=>u.hp<maxHp(u,p)*.9),group=patients.length?patients:available;
      const point=center(group,base);if(distance(medic,point)>140)move([medic],point,true);
    }
    if(level.tactics)for(const u of available){
      const targets=enemies.filter(t=>distance(t,u)-STATS[t.kind].radius<STATS[u.kind].range&&!(STATS[t.kind].air&&(u.kind==='tank'||u.kind==='artillery')));
      if(!targets.length)continue;
      const danger=targets.find(t=>isMobile(t)&&STATS[t.kind].damage>0&&distance(t,u)<110);
      if(danger&&(u.kind==='sniper'||u.kind==='artillery')){
        const d=Math.max(1,distance(u,danger));move([u],{x:Math.max(16,Math.min(4080,u.x+(u.x-danger.x)/d*120)),y:Math.max(16,Math.min(4080,u.y+(u.y-danger.y)/d*120))});continue;
      }
      const target=targets.sort((a,b)=>((b.kind==='medic'?35:0)+STATS[b.kind].damage/STATS[b.kind].cooldown-b.hp*.015)-((a.kind==='medic'?35:0)+STATS[a.kind].damage/STATS[a.kind].cooldown-a.hp*.015))[0];
      if(u.target!==target.id)e.command(p.side,{type:'order',ids:[u.id],point:target,target:target.id});
    }
  }
}
