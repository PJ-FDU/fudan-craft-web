import type { Engine } from './engine.js';
import { ABILITIES, abilitiesFor, NEGATIVE, removableAreas, type AbilityId, type SkillTarget } from './abilities.js';
import { effect } from './ability-engine.js';
import { ROSTERS, covered, maxShield, needsCoverage, population, technologyAllowed } from './races.js';
import { STATS, TECHS, isCombat, isMobile, maxHp, type BuildingKind, type MobileKind, type Player, type Tech, type Unit } from './types.js';
import { distance } from './pathfinding.js';
import { AI_LEVELS } from './ai.js';
import { AI_STYLES, rememberEnemies, strategicTarget } from './ai-strategy.js';

const projects:Record<NonNullable<Player['race']>,BuildingKind[]>={
  industrial:['infirmary','factory','research','commandPost','airfield'],
  brood:['nursery','gland','burrow'],
  stellar:['warpHub','phaseSanctum'],
  relay:['routePost','observatory','escortDepot'],
};
export function runFactionAI(e:Engine,p:Player,base:Unit){
  const now=e.state.time,side=p.side,roster=ROSTERS[p.race!],vis=e.visible.get(side)!;
  const own=e.state.units.filter(u=>u.side===side&&u.hp>0),workers=own.filter(u=>u.kind==='worker');
  const army=own.filter(isCombat),enemies=e.state.units.filter(u=>u.hp>0&&!e.allied(u.side,side)&&vis[e.indexAt(u)]);
  const plan=rememberEnemies(e.state.aiPlans??={},p,enemies,vis,now),style=AI_STYLES[plan.style],level=AI_LEVELS[e.state.difficulty];
  const command=(cmd:Parameters<Engine['command']>[1])=>e.command(side,cmd)===null;
  const queued=(kind:string)=>p.queue.filter(q=>q.kind===kind).length;
  for(const [i,worker] of workers.entries())if(worker.order==='idle'){
    const kind=i%3===1?'wood':'gold',node=e.nearestNode(worker,kind,worker,undefined,n=>!!vis[e.indexAt(n)]);
    if(node)command({type:'gather',ids:[worker.id],node:node.id});
  }
  const has=(kind:string)=>own.some(u=>u.kind===kind);
  const build=(kind:BuildingKind)=>{
    const worker=workers.find(u=>u.order!=='build'&&u.order!=='repair');if(!worker)return false;
    const anchors=needsCoverage(kind)?own.filter(u=>u.kind==='node'&&u.construction>=1):[base];
    for(const anchor of anchors){
      const at=e.findBuildSpot(side,kind,anchor,vis);
      if(at&&(!needsCoverage(kind)||covered(side,at,own))&&command({type:'build',kind,point:at,worker:worker.id}))return true;
    }
    return false;
  };
  const pop=population(p,own);
  if(pop.capacity<120&&pop.capacity-pop.used-pop.reserved<5){
    if(roster.supply==='sac'){if(!queued('sac'))command({type:'train',kind:'sac'});}
    else if(!own.some(u=>u.kind===roster.supply&&u.construction<1))build(roster.supply as BuildingKind);
  }
  if(!has(roster.production))build(roster.production);
  if(workers.length+queued('worker')<Math.max(7,level.workers+style.workers)&&queued('worker')<2)command({type:'train',kind:'worker'});
  if(!has('lumbermill')&&now>24)build('lumbermill');
  if(p.race==='industrial'&&!own.some(u=>u.kind==='powerplant'&&u.construction<1)){
    const supply=own.filter(u=>u.construction>=1).reduce((sum,u)=>sum-STATS[u.kind].power,0);
    if(supply<12)build('powerplant');
  }
  if(now>45&&!has('refinery')){
    const local=e.state.nodes.find(n=>n.kind==='oil'&&n.startSide===side&&vis[e.indexAt(n)]);
    const at=local&&e.findBuildSpot(side,'refinery',local,vis);
    const worker=workers.find(u=>u.order!=='build'&&u.order!=='repair');
    if(at&&worker)command({type:'build',kind:'refinery',point:at,worker:worker.id});
    else build('refinery');
  }
  if(now>45&&has('refinery')&&!has('oilwell')&&e.state.oilWells){
    const oil=e.state.nodes.find(n=>n.kind==='oil'&&n.startSide===side&&n.amount>0&&vis[e.indexAt(n)]);
    const worker=workers.find(u=>u.order!=='build'&&u.order!=='repair');
    if(oil&&worker)command({type:'build',kind:'oilwell',point:oil,worker:worker.id});
  }
  if(now>30&&!p.tech.includes('tier2')&&!queued('tier2'))command({type:'research',tech:'tier2'});
  if(now>115&&p.tech.includes('tier2')&&!p.tech.includes('tier3')&&!queued('tier3'))command({type:'research',tech:'tier3'});
  for(const building of projects[p.race!])if(!has(building)&&build(building))break;
  if(p.tech.includes('tier2')&&p.race==='industrial'){
    const factories=own.filter(u=>u.kind==='factory'&&u.construction>=1);
    if(factories.length===1&&factories[0].factoryModule==='armor'&&!own.some(u=>u.kind==='factory'&&u.construction<1))build('factory');
    if(factories.length>1&&!factories.some(u=>u.factoryModule==='support'))command({type:'factory-module',id:factories.at(-1)!.id,module:'support'});
  }
  if(now>60)for(const tech of Object.keys(TECHS) as Tech[]){
    if(technologyAllowed(p,tech)&&!p.tech.includes(tech)&&!queued(tech)&&TECHS[tech].requires&&p.tech.includes(TECHS[tech].requires!)&&
      (TECHS[tech].building===undefined||has(TECHS[tech].building!))&&command({type:'research',tech}))break;
  }
  if(p.race==='relay'&&p.tech.includes('tier2')&&army.length>=8){
    const stations=own.filter(u=>u.kind==='assembly');
    if(stations.length<2&&now>85&&p.credits>=900&&p.wood>=350)build('assembly');
    const forward=stations.at(1),scoutGoal=plan.target;
    if(forward&&scoutGoal&&forward.construction>=1&&!enemies.some(u=>distance(u,forward)<320)){
      const d=distance(forward,scoutGoal),ahead=d>480?{x:forward.x+(scoutGoal.x-forward.x)*200/d,y:forward.y+(scoutGoal.y-forward.y)*200/d}:undefined;
      if(forward.station?.mode==='mobile'){
        if(distance(forward,base)>360&&!forward.path.length)command({type:'station',id:forward.id,action:'deploy',point:forward});
        else if(!forward.path.length&&ahead&&vis[e.indexAt(ahead)])command({type:'station',id:forward.id,action:'move',point:ahead});
      }else if(!forward.station&&distance(forward,base)<240&&ahead&&vis[e.indexAt(ahead)]&&!p.queue.some(q=>q.producer===forward.id)){
        command({type:'station',id:forward.id,action:'pack'});
      }
    }
  }
  if(p.queue.filter(q=>!q.research).length<5){
    const support=roster.units.filter(k=>abilitiesFor(k).length&&!own.some(u=>u.kind===k)&&!queued(k));
    const frontline:MobileKind[]=[...roster.opening];
    if(army.length>5)frontline.reverse();
    for(const kind of [...(army.length>=4?support:[]),...frontline])if(command({type:'train',kind}))break;
  }
  const allied=e.state.units.filter(u=>u.hp>0&&e.allied(u.side,side)&&isCombat(u));
  for(const caster of army)if(caster.ability&&!caster.ability.cast&&caster.ability.energy>=25){
    const nearbyEnemies=enemies.filter(u=>isCombat(u)&&distance(caster,u)<310);
    const nearAllies=allied.filter(u=>distance(caster,u)<255);
    const hurt=nearAllies.filter(u=>u.hp/maxHp(u,e.player(u.side))<.78).sort((a,b)=>a.hp/maxHp(a,e.player(a.side))-b.hp/maxHp(b,e.player(b.side)));
    const top=nearbyEnemies.sort((a,b)=>STATS[b.kind].damage-STATS[a.kind].damage)[0];
    const debuffed=nearAllies.find(u=>NEGATIVE.some(g=>effect(u,g,now)>0));
    const center=top??caster;
    const options:Partial<Record<AbilityId,SkillTarget|false>>={
      'IND-02':debuffed?{target:debuffed.id}:false,'BIO-02':debuffed?{target:debuffed.id}:false,'ENE-04':debuffed?{target:debuffed.id}:false,
      'IND-03':nearbyEnemies.length>=2&&nearAllies.length>=3?{}:false,
      'IND-04':nearbyEnemies.length>=3?{point:caster}:false,
      'IND-05':top?{target:top.id}:false,'IND-06':nearbyEnemies.length>=3?{point:center}:false,
      'BIO-01':hurt.length?{target:hurt[0].id}:false,'BIO-03':top&&!effect(top,'infection',now)?{target:top.id}:false,
      'BIO-04':top&&effect(top,'infection',now)>0?{target:top.id}:false,'BIO-05':top?{target:top.id}:false,
      'BIO-06':nearbyEnemies.length>=2?{point:center}:false,
      'ENE-01':hurt.length?{target:hurt[0].id}:false,'RLY-01':nearbyEnemies.length>=2?{point:caster}:false,
      'RLY-03':nearbyEnemies.length?{point:caster}:false,'RLY-05':nearbyEnemies.some(u=>STATS[u.kind].splash)?{}:false,
      'RLY-06':top?{target:top.id}:false,
    };
    const woundedShield=nearAllies.find(u=>maxShield(u)-(u.shield??0)>=30);
    if(woundedShield)options['ENE-02']={target:woundedShield.id};
    const slow=nearAllies.find(u=>effect(u,'slow',now)>0);if(slow)options['RLY-02']={target:slow.id};
    const boosted=nearbyEnemies.find(u=>['barrier','regen','attackUp','splashGuard'].some(g=>effect(u,g as 'barrier'|'regen'|'attackUp'|'splashGuard',now)>0));
    if(boosted)options['ENE-06']={target:boosted.id};
    const area=e.skills.visibleAreas(side).find(a=>!e.allied(a.side,side)&&removableAreas.includes(a.skill));
    if(area)options['RLY-04']={area:area.id};
    const retreat=hurt.find(u=>u.side===side&&!STATS[u.kind].air);
    if(retreat&&top){
      const d=distance(retreat,top);
      if(d>0)options['ENE-03']={target:retreat.id,point:{x:retreat.x+(retreat.x-top.x)*115/d,y:retreat.y+(retreat.y-top.y)*115/d}};
    }
    if(top&&nearbyEnemies.length>=3){
      const d=distance(caster,top);
      if(d>100)options['ENE-05']={point:{x:(caster.x+top.x)/2,y:(caster.y+top.y)/2}};
    }
    for(const id of abilitiesFor(caster.kind as MobileKind).reverse()){
      const target=options[id];
      if(target&&caster.ability.energy>=ABILITIES[id].energy&&command({type:'cast',ids:[caster.id],skill:id,...target}))break;
    }
  }
  const threat=enemies.find(u=>distance(u,base)<525);
  if(threat&&army.length){command({type:'order',ids:army.filter(u=>!u.ability?.cast).map(u=>u.id),point:threat,assault:true});return;}
  const front=army.find(u=>STATS[u.kind].damage>0),scout=army.find(u=>u.kind===roster.opening[1]);
  if(now>35&&scout?.order==='idle'){
    const spot=e.world.bases.find(b=>!e.allied(b.side,side));if(spot)command({type:'order',ids:[scout.id],point:spot,assault:true});
  }
  if(front&&army.length>=Math.max(5,level.attackSize+style.attackSize)&&now>=Math.max(level.attackAfter*style.attackDelay,plan.nextAttack)){
    const goal=strategicTarget(plan,front,e.world.bases.filter(b=>!e.allied(b.side,side)));
    if(goal)plan.target=goal;
    if(goal&&command({type:'order',ids:army.filter(u=>!u.ability?.cast).map(u=>u.id),point:goal,assault:true}))plan.nextAttack=now+20;
  }
}
