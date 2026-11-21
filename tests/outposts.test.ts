import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../src/game/engine.js';
import { distance } from '../src/game/pathfinding.js';
import { isOutpost,outpostAnchor } from '../src/game/outposts.js';

const players=[{name:'A',ai:false},{name:'B',ai:false}];

test('trial AI scouts its forward oil deposit before the assault timer',()=>{
  const engine=new Engine(players,'normal','ring-valley');
  engine.player(1).ai=true;
  engine.state.time=40;
  const scout=engine.state.units.find(unit=>unit.side===1&&unit.kind==='scout')!;
  const anchor=outpostAnchor(engine.base(1)!,engine.extent);
  engine.ai();
  assert.equal(scout.order,'move');
  assert.ok(scout.destination&&distance(scout.destination,anchor)<100);
  assert.equal(new Engine(players,'normal','lost-temple').outpostPilot,false);
});

test('outpost income, oil interruption and owner-only stats survive save and restore',()=>{
  const engine=new Engine(players,'normal','twin-lakes');
  const anchor=outpostAnchor(engine.base(1)!,engine.extent),player=engine.player(1);
  const node=engine.state.nodes.find(n=>n.kind==='oil'&&isOutpost(n)&&distance(n,anchor)<100)!;
  engine.spawn('scout',1,{x:node.x-176,y:node.y});
  engine.updateVision();
  const site=engine.findBuildSpot(1,'refinery',node,engine.visible.get(1));
  assert.ok(site);
  const refinery=engine.spawn('refinery',1,site);
  const well=engine.spawn('oilwell',1,node);
  engine.step();
  assert.ok(player.oil>0);
  assert.deepEqual(player.stats?.events,[{kind:'outpostIncome',x:node.x,y:node.y,time:engine.state.time}]);
  const delivered=player.oil;
  refinery.hp=0;
  engine.step();
  engine.step();
  assert.equal(player.oil,delivered);
  assert.equal(player.stats?.events?.[1]?.kind,'oilStopped');
  assert.equal(player.stats?.events?.[1]?.x,well.x);
  assert.equal(player.stats?.events?.length,2);
  assert.equal(engine.view(2).players[0].stats,undefined);
  assert.deepEqual(Engine.restore(engine.save()).player(1).stats?.events,player.stats?.events);
});
