import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/game/engine.js';
import { BALANCE } from '../src/game/balance.js';
import { STATS,maxHp,type Unit } from '../src/game/types.js';
import { distance } from '../src/game/pathfinding.js';
import { selectionInfo } from '../src/game/selection-info.js';
import { openingMapRevision } from '../src/game/world.js';
const tick=(e:Engine,seconds:number)=>{for(let n=0;n<seconds*20;n++)e.step();};
function game(){return new Engine([{name:'A',ai:false},{name:'B',ai:false}],'hard','lost-temple',1);}
function worker(e:Engine){return e.state.units.find(u=>u.side===1&&u.kind==='worker')!;}
function repairField(){
  const e=game(),base=e.base(1)!;
  e.state.units=e.state.units.filter(u=>u.kind==='base');
  const workers=Array.from({length:4},()=>e.spawn('worker',1,e.freeSpawn(base)));
  base.hp=700;e.updateVision();return {e,base,workers,p:e.player(1)};
}

test('a longer opening delays the first AI engagement and keeps rush scouting earlier',()=>{
  const mapId='lost-temple',revision=openingMapRevision(mapId);
  const opening=(mapRevision:number,aiStyle:'balanced'|'rush')=>{
    const e=new Engine([{name:'A',ai:true,aiStyle},{name:'B',ai:true,aiStyle}],'normal',mapId,mapRevision);
    const scout=e.state.units.find(u=>u.side===2&&u.kind==='scout')!;
    let departure=0;
    for(let i=0;i<120*20;i++){
      e.step(.05);
      if(!departure&&scout.order==='move')departure=e.state.time;
      if(e.state.players.some(p=>p.stats!.damage>0))return {departure,damage:e.state.time};
    }
    assert.fail('AI should eventually engage');
  };
  const previous=opening(revision-1,'balanced'),current=opening(revision,'balanced'),rush=opening(revision,'rush');
  assert.ok(current.departure>=previous.departure+25);
  assert.ok(current.damage>=previous.damage+20);
  assert.ok(rush.departure>previous.departure&&rush.departure<current.departure);
});

test('repair spends only for actual HP, supports multiple workers and clamps stacked throughput',()=>{
  const {e,base,workers,p}=repairField(),before={gold:p.credits,wood:p.wood,oil:p.oil},hp=base.hp;
  assert.equal(e.command(1,{type:'repair',ids:workers.map(u=>u.id),target:base.id}),null);
  for(let n=0;n<500;n++){
    const prior=base.hp;e.step();assert.ok(base.hp-prior<=48*.05+1e-6);
    assert.ok(p.credits>=0&&p.wood>=0&&p.oil>=0);
  }
  assert.ok(base.hp>hp+200,'engineers reached their work positions');
  const fraction=(base.hp-hp)/STATS.base.hp*BALANCE.repairCostFraction;
  for(const [bank,key] of [['credits','gold'],['wood','wood'],['oil','oil']] as const){
    const cost=key==='gold'?STATS.base.cost:STATS.base[key];
    assert.ok(Math.abs((before[key]-p[bank])-cost*fraction)<1e-6);
  }
  const v=e.view(1),info=selectionInfo(v.units.filter(u=>u.id===base.id),v,p)!;
  assert.equal(info.progress?.label,'维修指挥中心');assert.ok(v.events.some(event=>event.type==='heal'&&event.unit===base.id));
});
test('repairs pause on resource shortage, use fractional remainder and resume after funding',()=>{
  const {e,base,workers,p}=repairField();p.oil=0;const hp=base.hp;
  e.command(1,{type:'repair',ids:[workers[0].id],target:base.id});tick(e,20);assert.equal(base.hp,hp);
  p.oil=.1;tick(e,3);assert.ok(Math.abs(base.hp-hp-1)<1e-6);assert.ok(p.oil>=-1e-9&&p.oil<1e-9);
  p.oil=50;tick(e,3);assert.ok(base.hp>hp+20);
});
test('context orders repair friendly buildings and restore gathering with cargo intact',()=>{
  const e=game(),u=worker(e),base=e.base(1)!,node=e.nearestNode(u,'gold')!;
  e.command(1,{type:'gather',ids:[u.id],node:node.id});u.cargo=40;u.cargoKind='gold';base.hp-=30;
  assert.equal(e.command(1,{type:'order',ids:[u.id],point:base,target:base.id}),null);
  assert.equal(u.order,'repair');assert.equal(u.resumeResource,node.id);assert.equal(u.cargo,40);
  tick(e,15);assert.equal(base.hp,maxHp(base,e.player(1)));assert.equal(u.order,'gather');assert.equal(u.resource,node.id);assert.equal(u.resumeResource,undefined);
});
test('repair rejects hostile, mobile and unfinished targets and cannot create free HP after death',()=>{
  const e=game(),u=worker(e),base=e.base(1)!,enemy=e.base(2)!;
  const soldier=e.state.units.find(u=>u.side===1&&u.kind==='soldier')!;
  assert.match(e.command(1,{type:'repair',ids:[u.id],target:enemy.id})!,/己方/);
  assert.match(e.command(1,{type:'repair',ids:[u.id],target:soldier.id})!,/建筑/);
  assert.match(e.command(1,{type:'repair',ids:[u.id],target:base.id})!,/已满/);
  base.hp-=200;
  assert.match(e.command(1,{type:'repair',ids:[soldier.id],target:base.id})!,/工程/);
  const building=e.state.units.find(u=>u.side===1&&u.kind==='barracks')!;building.construction=.5;
  assert.match(e.command(1,{type:'repair',ids:[u.id],target:building.id})!,/完工/);
  e.command(1,{type:'repair',ids:[u.id],target:base.id});e.state.units=e.state.units.filter(u=>u.id!==base.id);
  const gold=e.player(1).credits;e.step();assert.equal(e.player(1).credits,gold);assert.notEqual(u.order,'repair');
});
test('active repairs survive saving while malformed repair fields are rejected',()=>{
  const e=game(),u=worker(e),base=e.base(1)!;base.hp-=300;e.command(1,{type:'repair',ids:[u.id],target:base.id});tick(e,2);
  const restored=Engine.restore(e.save());assert.deepEqual(restored.state,e.state);
  tick(e,3);tick(restored,3);assert.deepEqual(restored.state,e.state);
  const bad=JSON.parse(e.save());bad.units.find((v:Unit)=>v.id===u.id).resumeResource=-1;assert.throws(()=>Engine.restore(JSON.stringify(bad)));
});
test('AI repairs its damaged base, reassigns workers and defends before the opening attack timer',()=>{
  const e=game(),p=e.player(1),base=e.base(1)!;p.ai=true;base.hp-=700;e.state.time=10;
  e.ai();assert.ok(e.state.units.some(u=>u.side===1&&u.order==='repair'&&u.target===base.id));
  const foe=e.spawn('soldier',2,{x:base.x+320,y:base.y});e.updateVision();e.ai();
  assert.ok(e.state.units.some(u=>u.side===1&&u.kind==='soldier'&&['attack','assault'].includes(u.order)));
  assert.ok(foe.hp>0);
});
test('AI withdraws wounded units and buys counters to visible static defenses',()=>{
  const e=game(),base=e.base(1)!,p=e.player(1);p.ai=true;p.credits=p.wood=p.oil=10000;
  const wounded=e.state.units.find(u=>u.side===1&&u.kind==='soldier')!;wounded.x=base.x+500;wounded.y=base.y;wounded.hp=10;
  e.spawn('soldier',2,{x:wounded.x+70,y:wounded.y});e.updateVision();e.ai();assert.equal(wounded.order,'move');assert.ok(wounded.destination&&distance(wounded.destination,base)<150);
  e.state.units=e.state.units.filter(u=>u.side===1||u.kind==='base');
  for(const kind of ['factory','research','powerplant'] as const)e.spawn(kind,1,e.findBuildSpot(1,kind,base)!);
  p.tech.push('weapons','advanced');p.queue=[];
  const scout=e.state.units.find(u=>u.side===1&&u.kind==='scout')!;scout.x=base.x-700;scout.y=base.y-700;
  e.spawn('tower',2,{x:scout.x-200,y:scout.y});e.updateVision();e.ai();
  assert.ok(p.queue.some(q=>q.kind==='artillery'),'counter siege is queued');
});
test('hidden enemy composition does not change AI purchases or commands',()=>{
  const a=game(),b=Engine.restore(a.save());a.player(1).ai=b.player(1).ai=true;
  for(const u of b.state.units)if(u.side===2&&u.kind==='soldier'){u.kind='fighter';u.hp=STATS.fighter.hp;}
  a.ai();b.ai();
  assert.deepEqual(a.player(1),b.player(1));
  assert.deepEqual(a.state.units.filter(u=>u.side===1),b.state.units.filter(u=>u.side===1));
});
