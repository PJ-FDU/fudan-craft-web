import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, powerFor, placementError } from '../src/game/engine.js';
import { buildingTiles } from '../src/game/building-layout.js';
import { findPath,terrain,nearestFree,distance,indexAt,SIZE,TILE,walkable } from '../src/game/pathfinding.js';
import { FEATURES } from '../src/game/world.js';
import { STATS,TECHS,isMobile,isCombat,maxHp, type BuildingKind } from '../src/game/types.js';
import { BALANCE } from '../src/game/balance.js';
const tick=(e:Engine,seconds:number)=>{for(let i=0;i<Math.round(seconds*20);i++)e.step(.05);};
function game(){const e=new Engine(undefined,'normal','lost-temple',1);e.state.players.forEach(p=>p.ai=false);return e;}
function stopWorkers(e:Engine){e.command(1,{type:'stop',ids:e.state.units.filter(u=>u.side===1&&u.kind==='worker').map(u=>u.id)});}
function add(e:Engine,kind:BuildingKind){const at=e.findBuildSpot(1,kind,e.base(1)!)!;assert.ok(at);return e.spawn(kind,1,at);}

test('four factions initialize with workers, production buildings and finite resource nodes',()=>{
  const e=new Engine(Array.from({length:4},(_,i)=>({name:`p${i}`,ai:false})),'normal','lost-temple',1);assert.equal(terrain.length,16384);assert.equal(e.state.units.filter(u=>u.kind==='base').length,4);
  for(const p of e.state.players){assert.equal(e.state.units.filter(u=>u.side===p.side&&u.kind==='worker').length,3);assert.equal(p.credits,3600);assert.equal(p.wood,1600);assert.equal(p.oil,400);assert.ok(powerFor(p.side,e.state.units).active);}
  assert.equal(e.state.nodes.length,21);assert.ok(FEATURES.some(f=>f.kind==='water'&&f.block));assert.ok(FEATURES.some(f=>f.kind==='rock'&&f.block));
});
test('income requires workers and delivery; no passive money is generated',()=>{
  const e=game();stopWorkers(e);const p=e.state.players[0],before=p.credits;tick(e,30);assert.equal(p.credits,before);assert.equal(p.harvested,0);
  const worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,node=e.nearestNode(worker,'gold')!;
  assert.equal(e.command(1,{type:'gather',ids:[worker.id],node:node.id}),null);const amount=node.amount;tick(e,4);assert.equal(p.credits,before,'cargo has not reached base yet');tick(e,26);assert.ok(p.credits>before);assert.ok(p.harvested>0);assert.ok(node.amount<amount);
});
test('wood is delivered separately and oil requires a completed refinery',()=>{
  const e=game();stopWorkers(e);const w=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,oil=e.nearestNode(w,'oil')!,wood=e.nearestNode(w,'wood')!;const p=e.state.players[0];
  assert.match(e.command(1,{type:'gather',ids:[w.id],node:oil.id})!,/精炼/);
  e.command(1,{type:'gather',ids:[w.id],node:wood.id});tick(e,30);assert.ok(p.wood>1600);assert.equal(p.oil,400);
  add(e,'refinery');e.updateVision();assert.equal(e.command(1,{type:'gather',ids:[w.id],node:oil.id}),null);tick(e,45);assert.ok(p.oil>400);
});
test('resource depletion never creates negative stock and workers can deliver the last cargo',()=>{
  const e=game();stopWorkers(e);const w=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,n=e.nearestNode(w,'gold')!;n.amount=13;e.command(1,{type:'gather',ids:[w.id],node:n.id});tick(e,30);assert.equal(n.amount,0);assert.ok(e.state.players[0].harvested>=13);assert.ok(e.state.nodes.every(n=>n.amount>=0));
});
test('production consumes all three resources, is FIFO per producer and refunds once',()=>{
  const e=game();stopWorkers(e);const p=e.state.players[0];e.command(1,{type:'train',kind:'soldier'});e.command(1,{type:'train',kind:'soldier'});assert.equal(p.credits,3600-STATS.soldier.cost*2);assert.equal(p.wood,1600-STATS.soldier.wood*2);
  assert.equal(e.command(1,{type:'cancel',index:1}),null);assert.equal(p.credits,3600-STATS.soldier.cost);assert.equal(p.wood,1600-STATS.soldier.wood);assert.ok(e.command(1,{type:'cancel',index:1}));
  const n=e.state.units.length;tick(e,STATS.soldier.build);assert.equal(e.state.units.length,n+1);assert.equal(p.queue.length,0);
  add(e,'factory');const before=[p.credits,p.wood,p.oil];e.command(1,{type:'train',kind:'tank'});assert.deepEqual([p.credits,p.wood,p.oil],before.map((v,i)=>v-[STATS.tank.cost,STATS.tank.wood,STATS.tank.oil][i]));
});
test('different production buildings work concurrently; shortages pause military production',()=>{
  const e=game();stopWorkers(e);e.command(1,{type:'train',kind:'worker'});e.command(1,{type:'train',kind:'soldier'});tick(e,1);const p=e.state.players[0];assert.ok(Math.abs(p.queue[0].remaining-(STATS.worker.build-1))<1e-6);assert.ok(Math.abs(p.queue[1].remaining-(STATS.soldier.build-1))<1e-6);
  e.state.units=e.state.units.filter(u=>u.side!==1||u.kind!=='powerplant');add(e,'factory');assert.equal(powerFor(1,e.state.units).active,false);const soldier=p.queue.find(q=>q.kind==='soldier')!,remaining=soldier.remaining;tick(e,1);assert.equal(soldier.remaining,remaining);assert.ok(p.queue.find(q=>q.kind==='worker')!.remaining<STATS.worker.build-1);
});
test('production prerequisites and technology gates are enforced',()=>{
  const e=game();assert.match(e.command(1,{type:'train',kind:'tank'})!,/工厂/);assert.match(e.command(1,{type:'train',kind:'medic'})!,/研究/);assert.match(e.command(1,{type:'train',kind:'sniper'})!,/精密武器/);assert.match(e.command(1,{type:'train',kind:'fighter'})!,/机库/);
  add(e,'research');assert.equal(e.command(1,{type:'train',kind:'medic'}),null);assert.match(e.command(1,{type:'research',tech:'advanced'})!,/精密/);
});
test('engineering vehicle builds over time, spends resources and unlocks factory production',()=>{
  const e=game();stopWorkers(e);const p=e.state.players[0],w=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,site=e.findBuildSpot(1,'factory',e.base(1)!,e.visible.get(1))!;
  assert.ok(site);assert.equal(e.command(1,{type:'build',kind:'factory',point:site,worker:w.id}),null);const b=e.state.units.find(u=>u.side===1&&u.kind==='factory')!;assert.ok(b.construction<1);assert.equal(p.credits,3600-STATS.factory.cost);assert.match(e.command(1,{type:'train',kind:'tank'})!,/工厂/);tick(e,STATS.factory.build+20);assert.equal(b.construction,1);assert.equal(w.service,undefined);assert.equal(e.command(1,{type:'train',kind:'tank'}),null);
});
test('building validation rejects overlap, water, fog and hostile builders without spending',()=>{
  const e=game(),p=e.state.players[0],w=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,enemy=e.state.units.find(u=>u.side===2&&u.kind==='worker')!,credits=p.credits;
  assert.ok(e.command(1,{type:'build',kind:'factory',point:e.base(1)!,worker:w.id}));const pond=FEATURES.find(f=>f.kind==='water')!;assert.ok(placementError(1,'factory',pond,e.state.units,e.state.nodes));
  const site=e.findBuildSpot(1,'factory',e.base(1)!)!;assert.ok(e.command(1,{type:'build',kind:'factory',point:site,worker:enemy.id}));assert.ok(e.command(1,{type:'build',kind:'factory',point:{x:2400,y:2000},worker:w.id}));assert.equal(p.credits,credits);
});
test('research queues complete, cannot be duplicated, and apply real weapon and armor upgrades',()=>{
  const e=game();stopWorkers(e);add(e,'research');const p=e.state.players[0];assert.equal(e.command(1,{type:'research',tech:'weapons'}),null);assert.ok(e.command(1,{type:'research',tech:'weapons'}));tick(e,TECHS.weapons.duration);assert.ok(p.tech.includes('weapons'));assert.equal(e.command(1,{type:'train',kind:'sniper'}),null);
  const soldier=e.state.units.find(u=>u.side===1&&u.kind==='soldier')!;assert.equal(e.command(1,{type:'research',tech:'armor'}),null);tick(e,TECHS.armor.duration);assert.equal(soldier.hp,STATS.soldier.hp*1.25);assert.equal(maxHp(soldier,p),soldier.hp);
  p.credits=10000;p.wood=10000;p.oil=10000;add(e,'factory');add(e,'powerplant');assert.equal(e.command(1,{type:'research',tech:'advanced'}),null);tick(e,TECHS.advanced.duration);assert.equal(e.command(1,{type:'train',kind:'mech'}),null);assert.equal(e.command(1,{type:'train',kind:'artillery'}),null);
});
test('destroyed producers refund their queued work exactly once',()=>{
  const e=game();stopWorkers(e);e.command(1,{type:'train',kind:'soldier'});const p=e.state.players[0];e.state.units=e.state.units.filter(u=>u.side!==1||u.kind!=='barracks');tick(e,.1);assert.equal(p.credits,3600);assert.equal(p.wood,1600);assert.equal(p.queue.length,0);tick(e,.1);assert.equal(p.credits,3600);
});
test('population cap includes queued units and prevents negative resources',()=>{
  const e=game(),p=e.state.players[0];p.credits=0;assert.ok(e.command(1,{type:'train',kind:'worker'}));p.credits=100000;while(e.state.units.filter(u=>u.side===1&&isMobile(u)).length<80)e.spawn('soldier',1,e.freeSpawn(e.base(1)!));assert.ok(e.command(1,{type:'train',kind:'worker'}));assert.equal(p.queue.length,0);
});
test('A* respects terrain and refuses diagonal corner cutting; opposite bases are reachable',()=>{
  const blocked=new Uint8Array(SIZE*SIZE);blocked[1]=1;blocked[SIZE]=1;assert.deepEqual(findPath({x:16,y:16},{x:48,y:48},blocked),[]);
  const e=game(),a=e.state.units.find(u=>u.side===1&&u.kind==='soldier')!,b=e.state.units.find(u=>u.side===2&&u.kind==='soldier')!,path=findPath(a,b,e.blockers());assert.ok(path.length);for(let i=0;i<path.length;i++){assert.ok(walkable(path[i],e.blockers()));if(i)assert.ok(distance(path[i-1],path[i])<=TILE*Math.SQRT2+.01);}
});
test('only owned units obey orders and formations reserve different destination cells',()=>{
  const e=game(),own=e.state.units.filter(u=>u.side===1&&isCombat(u)),enemy=e.state.units.find(u=>u.side===2&&u.kind==='soldier')!;e.command(1,{type:'order',ids:[...own.map(u=>u.id),enemy.id],point:nearestFree({x:2400,y:3400})!});assert.equal(enemy.order,'idle');assert.equal(new Set(own.map(u=>indexAt(u.destination!))).size,own.length);
});
test('building rotation changes the occupied tiles and persists through v2 saves',()=>{
  const e=game(),base=e.base(1)!,worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!;
  const kind='powerplant',visible=e.visible.get(1),blocked=e.blockers();
  const candidates=[];
  for(let y=-12;y<=12;y++)for(let x=-12;x<=12;x++)candidates.push({x:(Math.floor(base.x/TILE)+x+.5)*TILE,y:(Math.floor(base.y/TILE)+y+.5)*TILE});
  const point=candidates.find(p=>!placementError(1,kind,p,e.state.units,e.state.nodes,visible,0)&&!placementError(1,kind,p,e.state.units,e.state.nodes,visible,1)&&findPath(worker,p,blocked).length)!;
  assert.ok(point);
  const cells=(facing:0|1)=>new Set(buildingTiles(kind,point,facing).map(p=>p.y*SIZE+p.x));
  const original=cells(0),rotated=cells(1);
  assert.notDeepEqual(original,rotated);
  assert.match(e.command(1,{type:'build',kind,point,worker:worker.id,facing:7 as 0})!,/朝向/);
  assert.equal(e.command(1,{type:'build',kind,point,worker:worker.id,facing:1}),null);
  const after=e.blockers();
  for(const i of rotated)assert.equal(after[i],1);
  for(const i of original)if(!rotated.has(i))assert.equal(after[i],blocked[i]);
  const restored=Engine.restore(e.save()),built=restored.state.units.find(u=>u.x===point.x&&u.y===point.y)!;
  assert.equal(built.facing,1);
  assert.deepEqual(restored.blockers(),after);
});
function battlefield(){const e=game();e.state.units=e.state.units.filter(u=>u.kind==='base');const at=nearestFree({x:2000,y:2000})!;return {e,at};}
test('damage destroys at zero HP and applies a kill reward only once',()=>{
  const {e,at}=battlefield(),a=e.spawn('soldier',1,at),b=e.spawn('soldier',2,{x:at.x+40,y:at.y});b.hp=STATS.soldier.damage;e.updateVision();const before=e.state.players[0].credits;e.step();assert.ok(e.state.units.includes(b),'windup has not hit yet');tick(e,.2);assert.ok(!e.state.units.includes(b));assert.equal(e.state.players[0].credits,before+STATS.soldier.cost*.2);tick(e,1);assert.equal(e.state.players[0].kills,1);assert.ok(e.state.units.includes(a));
});
test('tank and artillery splash exclude friendly units; artillery cannot shoot aircraft',()=>{
  const {e,at}=battlefield(),tank=e.spawn('tank',1,at),a=e.spawn('soldier',2,{x:at.x+90,y:at.y}),b=e.spawn('soldier',2,{x:at.x+120,y:at.y}),friend=e.spawn('soldier',1,{x:at.x+100,y:at.y+50});for(const u of [a,b,friend]){u.cooldown=10;u.order='hold';}e.updateVision();e.step();assert.equal(a.hp,STATS.soldier.hp,'shell has not been fired');tick(e,.5);assert.ok(a.hp<STATS.soldier.hp);assert.ok(b.hp>a.hp&&b.hp<STATS.soldier.hp,'splash damage falls off with distance');assert.equal(friend.hp,STATS.soldier.hp);assert.equal(tank.hp,STATS.tank.hp);
  const c=battlefield(),art=c.e.spawn('artillery',1,c.at),air=c.e.spawn('fighter',2,{x:c.at.x+100,y:c.at.y});air.cooldown=10;c.e.updateVision();c.e.step();assert.equal(air.hp,STATS.fighter.hp);assert.equal(art.target,null);
});
test('medics heal damaged friendly ground units without damaging enemies',()=>{
  const {e,at}=battlefield(),medic=e.spawn('medic',1,at),friend=e.spawn('soldier',1,{x:at.x+50,y:at.y});friend.hp=40;e.updateVision();e.step();assert.equal(friend.hp,40,'healing has a windup');tick(e,.2);assert.equal(friend.hp,40+BALANCE.medicHeal);assert.ok(medic.cooldown>0);
});
test('fog hides enemy economy and units, but remembers explored terrain',()=>{
  const e=game(),foe=e.state.units.find(u=>u.side===2&&isCombat(u))!,scout=e.state.units.find(u=>u.side===1&&u.kind==='scout')!;assert.ok(!e.view(1).units.some(u=>u.id===foe.id));scout.x=foe.x;scout.y=foe.y;e.updateVision();assert.ok(e.view(1).units.some(u=>u.id===foe.id));const i=indexAt(foe);scout.x=100;scout.y=100;e.updateVision();assert.equal(e.view(1).explored[i],1);assert.equal(e.view(1).visible[i],0);assert.equal(e.view(1).players[1].oil,0);assert.deepEqual(e.view(1).players[1].tech,[]);
});
test('v2 saves round-trip construction, cargo, technologies and queues; malformed saves are rejected',()=>{
  const e=game();e.command(1,{type:'train',kind:'worker'});tick(e,2);assert.deepEqual(Engine.restore(e.save()).state,e.state);assert.throws(()=>Engine.restore('{}'));const broken=JSON.parse(e.save());broken.players[0].oil=-1;assert.throws(()=>Engine.restore(JSON.stringify(broken)));const old=JSON.parse(e.save());old.version=1;assert.throws(()=>Engine.restore(JSON.stringify(old)));
});
test('AI gathers, expands production, researches and launches an assault with finite resources',()=>{
  const e=new Engine(undefined,'hard'),protectedBase=e.base(1)!;let assaulted=false;for(let n=0;n<360*20;n++){protectedBase.hp=STATS.base.hp;e.step();if(e.state.units.some(u=>u.side===2&&u.order==='assault'))assaulted=true;}const p=e.state.players[1];assert.ok(p.harvested>1000);assert.ok(e.has(2,'factory'));assert.ok(e.has(2,'research'));assert.ok(p.tech.includes('weapons'));assert.ok(assaulted);assert.ok(p.credits>=0&&p.wood>=0&&p.oil>=0);
});
test('base elimination declares a winner and freezes the finished simulation',()=>{
  const e=game();e.state.units=e.state.units.filter(u=>u.side!==2||u.kind!=='base');e.step();assert.equal(e.state.winner,1);const t=e.state.time;tick(e,1);assert.equal(e.state.time,t);
});
test('logistics and lumbermill upgrades increase actual gathering rate and capacity',()=>{
  const a=game(),b=game();for(const e of [a,b])stopWorkers(e);
  b.state.players[0].tech.push('logistics');add(b,'lumbermill');
  const setup=(e:Engine)=>{const w=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,n=e.nearestNode(w,'wood')!;w.x=n.x+40;w.y=n.y;e.updateVision();e.command(1,{type:'gather',ids:[w.id],node:n.id});return w;};
  const wa=setup(a),wb=setup(b);tick(a,3);tick(b,3);assert.ok(Math.abs(wa.cargo-60)<.001);assert.ok(Math.abs(wb.cargo-135)<.001);assert.equal(wb.returning,false);
});
test('AI economy and technology can carry an entire battle through to victory',()=>{
  const e=new Engine([{name:'A',ai:true},{name:'B',ai:true}],'hard');for(let n=0;n<20*1800&&!e.state.winner;n++)e.step();assert.ok(e.state.winner);assert.ok(e.state.players.every(p=>p.credits>=0&&p.wood>=0&&p.oil>=0));assert.ok(e.state.players.some(p=>p.tech.includes('advanced')));assert.ok(e.state.units.every(u=>Number.isFinite(u.x)&&Number.isFinite(u.y)&&u.hp>0));
});
