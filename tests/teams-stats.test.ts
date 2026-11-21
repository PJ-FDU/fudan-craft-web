import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/game/engine.js';
import { nearestFree,indexAt } from '../src/game/pathfinding.js';
import { STATS,sameTeam } from '../src/game/types.js';
import { rememberEnemies,AI_STYLES } from '../src/game/ai-strategy.js';
const tick=(e:Engine,n:number)=>{for(let i=0;i<n;i++)e.step();};
const coop=()=>new Engine([{name:'A',ai:false,team:1},{name:'B',ai:false,team:1},{name:'C',ai:false,team:3},{name:'D',ai:false,team:3}]);

test('cooperative allies share sight while commands and banks remain owned',()=>{
  const e=coop(),v=e.view(1),ally=e.state.units.find(u=>u.side===2&&u.kind==='worker')!;
  assert.ok(v.visible[e.indexAt(e.base(2)!)]);
  assert.ok(v.units.some(u=>u.id===ally.id));
  assert.equal(v.players[1].credits,0);assert.equal(v.players[1].stats,undefined);
  const before={order:ally.order,path:ally.path};
  e.command(1,{type:'stop',ids:[ally.id]});
  assert.deepEqual({order:ally.order,path:ally.path},before);
  assert.ok(!v.units.some(u=>u.side===3));
  assert.ok(sameTeam(1,2,v.players));assert.ok(!sameTeam(1,3,v.players));
});
test('ally targets and splash never deal friendly damage',()=>{
  const e=coop();e.state.units=e.state.units.filter(u=>u.kind==='base');
  const at=nearestFree({x:2000,y:2000})!,tank=e.spawn('tank',1,at);
  const ally=e.spawn('soldier',2,{x:at.x+150,y:at.y+30}),enemy=e.spawn('soldier',3,{x:at.x+150,y:at.y});
  ally.order=enemy.order='hold';ally.cooldown=enemy.cooldown=100;e.updateVision();
  e.command(1,{type:'order',ids:[tank.id],point:ally,target:ally.id});
  assert.notEqual(tank.target,ally.id);e.command(1,{type:'hold',ids:[tank.id]});tick(e,30);
  assert.equal(ally.hp,STATS.soldier.hp);assert.ok(enemy.hp<STATS.soldier.hp);
});
test('medics heal allied units against the patient armor cap',()=>{
  const e=coop();e.state.units=e.state.units.filter(u=>u.kind==='base');e.player(2).tech.push('armor');
  const at=nearestFree({x:2000,y:2000})!,medic=e.spawn('medic',1,at),patient=e.spawn('soldier',2,{x:at.x+80,y:at.y});
  patient.hp=125;patient.cooldown=100;patient.order='hold';e.updateVision();tick(e,12);
  assert.equal(patient.hp,STATS.soldier.hp*1.25);
  assert.ok(e.player(1).stats!.healing>0);assert.equal(medic.side,1);
});
test('a team can continue after one base falls and wins after both enemy bases fall',()=>{
  const e=coop();e.base(1)!.hp=0;e.step();assert.equal(e.state.winner,null);
  e.base(3)!.hp=e.base(4)!.hp=0;e.step();
  assert.ok(e.state.winner&&sameTeam(e.state.winner,2,e.state.players));
  assert.ok(e.view(2).players.every(p=>!!p.stats));
  const restored=Engine.restore(e.save());assert.deepEqual(restored.state,e.state);
});
test('match statistics measure spending, refunds, actual damage and kill value',()=>{
  const e=new Engine([{name:'A',ai:false},{name:'B',ai:false}]);
  e.command(1,{type:'train',kind:'worker'});e.command(1,{type:'cancel',index:0});
  assert.equal(e.player(1).stats!.spent.gold,110);assert.equal(e.player(1).stats!.refunded.gold,110);
  e.state.units=e.state.units.filter(u=>u.kind==='base');
  const at=nearestFree({x:2000,y:2000})!,a=e.spawn('soldier',1,at),b=e.spawn('soldier',2,{x:at.x+100,y:at.y});
  b.hp=9;b.cooldown=100;b.order='hold';e.updateVision();tick(e,10);
  assert.equal(e.player(1).stats!.damage,9);
  assert.equal(e.player(1).stats!.killedValue.gold,STATS.soldier.cost);
  assert.equal(e.player(2).stats!.lostValue.gold,STATS.soldier.cost);
  assert.ok(e.player(1).stats!.series.length);assert.ok(a.hp>0);
});
test('old v2 saves start new statistics at restore time and reject invalid team or statistics',()=>{
  const e=new Engine();e.state.time=30;const old=JSON.parse(e.save());
  delete old.aiPlans;for(const p of old.players){delete p.team;delete p.stats;}
  const restored=Engine.restore(JSON.stringify(old));assert.equal(restored.player(1).stats!.since,30);
  const invalid=JSON.parse(e.save());invalid.players[0].stats.damage=-1;assert.throws(()=>Engine.restore(JSON.stringify(invalid)));
  invalid.players[0].stats.damage=0;invalid.players[0].team=4;assert.throws(()=>Engine.restore(JSON.stringify(invalid)));
});
test('AI remembers last observed positions, expires stale contacts and never tracks hidden movement',()=>{
  const e=new Engine(),p=e.player(1),at=nearestFree({x:2000,y:2000})!,enemy=e.spawn('tank',2,at);
  const vis=new Uint8Array(16384);vis[indexAt(enemy)]=1;const plans={};
  const plan=rememberEnemies(plans,p,[enemy],vis,10),seen={...plan.contacts[0]};
  enemy.x+=500;rememberEnemies(plans,p,[],new Uint8Array(16384),20);
  assert.deepEqual(plan.contacts[0],seen);
  rememberEnemies(plans,p,[],new Uint8Array(16384),60);assert.equal(plan.contacts.length,0);
  const fresh=rememberEnemies(plans,p,[enemy],new Uint8Array(16384),70);vis.fill(1);
  rememberEnemies(plans,p,[],vis,71);assert.equal(fresh.contacts.length,0);
  assert.ok(AI_STYLES.rush.attackDelay<AI_STYLES.defensive.attackDelay);
  assert.ok(AI_STYLES.economic.workers>AI_STYLES.rush.workers);
});
