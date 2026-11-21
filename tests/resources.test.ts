import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/game/engine.js';
import { MAPS } from '../src/game/maps.js';
import { getWorld,initialNodes,latestMapRevision,openingMapRevision } from '../src/game/world.js';
import { RESOURCE_STOCK,STARTING_RESOURCES,harvestLand,isTree } from '../src/game/resource-world.js';
import { STATS,type ResourceNode } from '../src/game/types.js';
import { linkedRefinery } from '../src/game/oil.js';
import { distance } from '../src/game/pathfinding.js';
import { circleFree,groundPath } from '../src/game/movement.js';
import { STARTER_TREE_COUNT } from '../src/game/woodland.js';

const players=(count:number)=>Array.from({length:count},()=>({name:'P',ai:false}));
const tick=(e:Engine,seconds:number)=>{for(let i=0;i<seconds*20;i++)e.step(.05);};
const routeLength=(e:Engine,side:number,node:ResourceNode)=>{
  const worker=e.state.units.find(u=>u.kind==='worker'&&u.side===side)!;
  const path=groundPath(worker,node,e.blockers());
  assert.ok(path.length&&distance(path.at(-1)!,node)<100,`${e.world.id}: inaccessible ${node.kind} ${node.id}`);
  return path.reduce((sum,p,i)=>sum+distance(i?path[i-1]:worker,p),0);
};

for(const {id,maxPlayers} of MAPS)test(`${id}: finite stocks, real forests and five-minute starting income are fair`,()=>{
  const e=new Engine(players(maxPlayers),'normal',id),nodes=e.state.nodes;
  assert.equal(e.world.revision,latestMapRevision(id));
  assert.equal(nodes.filter(n=>n.tree!==undefined).length,e.world.features.filter(isTree).length);
  assert.ok(nodes.filter(n=>n.kind==='wood').every(n=>n.tree!==undefined&&n.max===RESOURCE_STOCK.tree));
  assert.equal(new Set(nodes.map(n=>n.id)).size,nodes.length);
  for(const p of e.state.players){
    assert.deepEqual([p.credits,p.wood,p.oil],[STARTING_RESOURCES.gold,STARTING_RESOURCES.wood,STARTING_RESOURCES.oil]);
    const stock=nodes.filter(n=>n.startSide===p.side);
    assert.equal(stock.find(n=>n.kind==='gold')!.max,10000);
    assert.equal(stock.find(n=>n.kind==='oil')!.max,2600);
    assert.equal(stock.filter(n=>n.kind==='wood').reduce((sum,n)=>sum+n.max,0),STARTER_TREE_COUNT*RESOURCE_STOCK.tree);
    const base=e.base(p.side)!;
    const nearby=nodes.filter(n=>!n.startSide&&distance(n,base)>=1000&&distance(n,base)<1600);
    assert.equal(nearby.filter(n=>n.kind==='gold'&&n.max===4500).length,1,`${id}: side ${p.side} lacks forward gold`);
    assert.equal(nearby.filter(n=>n.kind==='oil'&&n.max===1500).length,1,`${id}: side ${p.side} lacks forward oil`);
    assert.match(e.command(p.side,{type:'train',kind:'tank'})!,/工厂/);
    for(const n of nodes.filter(n=>n.kind!=='wood'))routeLength(e,p.side,n);
  }
  for(const n of nodes.filter(n=>n.startSide===undefined&&n.kind!=='wood')){
    assert.ok(!nodes.some(other=>other.kind!==n.kind&&other.kind!=='wood'&&distance(n,other)<150));
  }
  tick(e,300);
  for(const key of ['credits','wood'] as const){
    const baseline=key==='credits'?1500:600,earned=e.state.players.map(p=>p[key]-baseline);
    assert.ok(Math.min(...earned)>2000,`${id}: ${key} stalled`);
    assert.ok((Math.max(...earned)-Math.min(...earned))/Math.max(...earned)<.08,`${id}: unfair ${key}: ${earned}`);
  }
  assert.ok(nodes.some(n=>n.tree!==undefined&&n.amount===0));
  const restored=Engine.restore(e.save());
  assert.deepEqual(restored.state,e.state);
  assert.deepEqual(restored.blockers(),e.blockers());
  assert.deepEqual(getWorld(id).land,e.world.land);
});

test('TS legacy haul keeps both gold workers delivering through ten minutes',()=>{
  const e=new Engine(players(2),'normal','terenas-stand',1);
  tick(e,300);const halfway=e.state.players.map(p=>p.credits);
  tick(e,300);
  const incomes=e.state.players.map((p,i)=>p.credits-halfway[i]);
  assert.ok(Math.min(...incomes)>=5400,`${incomes}`);
  assert.ok(Math.abs(incomes[0]-incomes[1])<=400,`${incomes}`);
});

test('cut trees open shared ground, do not erase rock/water, and do not change another match',()=>{
  const e=new Engine(players(2),'normal','terenas-stand'),other=new Engine(players(2),'normal','terenas-stand');
  const original=other.land(),wood=e.state.nodes.filter(n=>n.tree!==undefined);
  for(const n of wood)n.amount=0;
  const cut=e.land();
  assert.ok([...cut].some((value,i)=>!value&&original[i]));
  for(let i=0;i<cut.length;i++)if(e.world.permanentLand![i])assert.equal(cut[i],1);
  assert.deepEqual(other.land(),original);
  assert.deepEqual(e.world.land,original);
  // 同一份砍伐状态在服务器与客户端预览得到相同的掩码。
  assert.deepEqual(harvestLand(e.world,e.state.nodes),cut);
  const next=e.state.nodes.find(n=>n.tree!==undefined)!;
  next.amount=1;
  assert.equal(e.land()[e.indexAt(next)],1);
});

test('a forest interior click starts at a reachable edge; partial cargo continues and last wood is delivered',()=>{
  const e=new Engine(players(2),'normal','ring-valley');
  e.command(1,{type:'stop',ids:e.state.units.filter(u=>u.side===1).map(u=>u.id)});
  const worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!;
  const forest=e.state.nodes.filter(n=>n.startSide===1&&n.kind==='wood');
  const blocked=e.blockers();
  const deepest=forest.find(n=>!Array.from({length:16},(_,i)=>{
    const a=i/16*Math.PI*2;
    return circleFree({x:n.x+Math.cos(a)*41,y:n.y+Math.sin(a)*41},STATS.worker.radius,blocked);
  }).some(Boolean))!;
  assert.ok(deepest);
  e.visible.get(1)!.fill(1);
  assert.equal(e.command(1,{type:'gather',ids:[worker.id],node:deepest.id}),null);
  assert.notEqual(worker.resource,deepest.id);
  tick(e,160);
  assert.ok(e.player(1).wood>600);
  assert.ok(forest.filter(n=>n.amount===0).length>=2);
  // 只剩一份不足整仓的木材，也必须送回，而不是消失或负数。
  e.command(1,{type:'stop',ids:[worker.id]});
  for(const n of e.state.nodes)if(n.kind==='wood')n.amount=0;
  const last=forest[0];last.amount=13;worker.cargo=0;worker.cargoKind=null;worker.returning=false;
  const before=e.player(1).wood;
  assert.equal(e.command(1,{type:'gather',ids:[worker.id],node:last.id}),null);
  tick(e,60);
  assert.equal(last.amount,0);
  assert.equal(e.player(1).wood-before,13);
  assert.equal(worker.cargo,0);
});

test('dense home woodland is harvested inward from the edge until every remaining tree is cleared',()=>{
  for(const {id,maxPlayers} of MAPS){
    const e=new Engine(players(maxPlayers),'normal',id),base=e.base(1)!;
    for(const p of e.state.players)e.command(p.side,{type:'stop',ids:e.state.units.filter(u=>u.side===p.side).map(u=>u.id)});
    const worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!;
    const forest=e.state.nodes.filter(n=>n.kind==='wood'&&!n.startSide&&distance(n,base)<1400);
    // 先砍完前排林；用少量存量验证完整的寻路、换树和交货流程。
    for(const n of e.state.nodes)if(n.kind==='wood')n.amount=forest.includes(n)?1:0;
    const blocked=e.blockers();
    const interior=forest.find(n=>!Array.from({length:16},(_,i)=>{
      const a=i/16*Math.PI*2;
      return circleFree({x:n.x+Math.cos(a)*41,y:n.y+Math.sin(a)*41},STATS.worker.radius,blocked);
    }).some(Boolean));
    assert.ok(interior,`${id}: no dense forest interior`);
    e.visible.get(1)!.fill(1);
    assert.equal(e.command(1,{type:'gather',ids:[worker.id],node:interior.id}),null);
    assert.notEqual(worker.resource,interior.id,`${id}: interior click did not redirect to an edge`);
    const before=e.player(1).wood;
    tick(e,180);
    assert.ok(forest.every(n=>n.amount===0),`${id}: inward harvesting left ${forest.filter(n=>n.amount>0).length} trees`);
    assert.equal(e.player(1).wood-before,forest.length,`${id}: final timber was not delivered`);
    assert.equal(worker.cargo,0);
  }
});

test('expanded forest saves reject tampered node identity and preserve every released revision',()=>{
  const e=new Engine(players(2),'normal','twisted-meadows'),raw=JSON.parse(e.save());
  assert.ok(raw.nodes.length>100);
  for(const patch of [(s:any)=>s.nodes.pop(),(s:any)=>s.nodes[20].tree=9999,(s:any)=>s.nodes[0].x+=32,(s:any)=>s.nodes[0].max=20000]){
    const bad=structuredClone(raw);patch(bad);assert.throws(()=>Engine.restore(JSON.stringify(bad)));
  }
  for(const {id} of MAPS)for(let revision=1;revision<latestMapRevision(id);revision++){
    const old=new Engine(players(2),'normal',id,revision),restored=Engine.restore(old.save());
    assert.equal(restored.world.revision,revision);assert.deepEqual(restored.state,old.state);
    const nodes=initialNodes(old.world);
    if(old.world.deposits)assert.ok(nodes.filter(n=>n.kind==='wood').every(n=>n.max===(revision>=openingMapRevision(id)?300:150)));
    else assert.ok(nodes.length<=100);
  }
});

test('mirrored public deposits have equal stocks and ground haul differences stay below fifteen percent',()=>{
  for(const {id,maxPlayers} of MAPS.filter(m=>m.id!=='lost-temple')){
    const e=new Engine(players(maxPlayers),'normal',id);
    const publicNodes=e.state.nodes.filter(n=>n.kind!=='wood'&&!n.startSide);
    for(const n of publicNodes){
      const mirror=publicNodes.find(p=>p.kind===n.kind&&p.x===e.extent-n.x&&p.y===(id==='echo-isles'?n.y:e.extent-n.y));
      if(!mirror||mirror===n)continue;
      assert.equal(mirror.max,n.max);
      const closest=(node:ResourceNode)=>[...e.world.bases].sort((a,b)=>distance(a,node)-distance(b,node))[0];
      const a=routeLength(e,closest(n).side,n),b=routeLength(e,closest(mirror).side,mirror);
      assert.ok(Math.abs(a-b)/Math.max(a,b)<.15,`${id}: ${n.kind} ${n.id}/${mirror.id} haul ${a}/${b}`);
    }
  }
});

test('new ground production avoids the enclosed pocket behind a northern temple factory',()=>{
  const e=new Engine(players(2),'normal','lost-temple',openingMapRevision('lost-temple')),factory=e.spawn('factory',2,{x:1680,y:144});
  e.spawn('lumbermill',2,{x:1936,y:208});
  e.spawn('refinery',2,{x:1936,y:368});
  e.spawn('powerplant',2,{x:2064,y:272});
  const at=e.freeSpawn(factory,'artillery'),worker=e.spawn('artillery',2,at);
  assert.ok(circleFree(at,STATS.artillery.radius,e.blockers()));
  const mine=e.state.nodes.find(n=>n.startSide===2&&n.kind==='gold')!;
  const path=groundPath(worker,mine,e.blockers());
  assert.ok(path.length&&distance(path.at(-1)!,mine)<100);
});

test('oil production requires an in-range own refinery and reroutes after it is lost',()=>{
  const e=new Engine(players(2)),p=e.player(1);
  const oil=e.state.nodes.find(n=>n.startSide===1&&n.kind==='oil')!;
  const worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!;
  const build={type:'build',kind:'oilwell',point:oil,worker:worker.id} as const;
  assert.match(e.command(1,build)!,/精炼厂/);
  const remote=e.spawn('refinery',1,{x:oil.x+480,y:oil.y});
  const first=e.spawn('refinery',1,e.findBuildSpot(1,'refinery',oil,e.visible.get(1))!);
  const fallback=e.spawn('refinery',1,e.findBuildSpot(1,'refinery',oil,e.visible.get(1))!);
  assert.equal(linkedRefinery(1,oil,e.state.units)?.id,first.id);
  first.construction=.5;fallback.construction=.5;
  assert.match(e.command(1,build)!,/精炼厂/);
  first.construction=1;
  assert.equal(e.command(1,build),null);
  assert.match(e.command(1,build)!,/现有建筑/);
  tick(e,1);
  assert.equal(p.oil,0,'unfinished oil wells produce nothing');
  tick(e,20);
  assert.ok(p.oil>=80);
  const well=e.state.units.find(u=>u.side===1&&u.kind==='oilwell')!;
  assert.deepEqual(e.view(1).oilPipes,[{well:well.id,refinery:first.id}]);
  assert.deepEqual(e.view(2).oilPipes,[],'the pipeline cannot expose an unseen enemy well');
  assert.equal(Engine.restore(e.save()).state.oilWells,true);
  assert.ok(remote.hp>0);
  const delivered=p.oil;
  first.hp=0;
  tick(e,1);
  assert.equal(p.oil,delivered,'unfinished and out-of-range refineries cannot receive oil');
  fallback.construction=1;
  oil.amount=2;
  tick(e,1);
  assert.ok(Math.abs(p.oil-delivered-2)<1e-6);
  assert.equal(oil.amount,0);
  assert.deepEqual(e.view(1).oilPipes,[{well:well.id,refinery:fallback.id}]);
});

test('wood skips the refinery and gold chooses the shorter drive around a wall',()=>{
  const e=new Engine(players(2),'normal','lost-temple',1);
  const map=new Uint8Array(e.size**2);
  for(let y=18;y<=39;y++)map[y*e.size+21]=1;
  e.land=()=>map.slice();
  const base=e.base(1)!;
  e.state.units=e.state.units.filter(u=>u.kind==='base');
  Object.assign(base,{x:368,y:976});
  const refinery=e.spawn('refinery',1,{x:464,y:976});
  const mill=e.spawn('lumbermill',1,{x:816,y:976});
  const node={id:1,kind:'gold',amount:10,max:10,radius:25,x:624,y:848} as const;
  e.state.nodes=[{...node}];
  const worker=e.spawn('worker',1,{x:656,y:976});
  e.updateVision();
  for(const cargoKind of ['wood','gold'] as const){
    Object.assign(worker,{order:'gather',resource:node.id,cargo:100,cargoKind,returning:true,repath:0});
    e.step();
    assert.ok(distance(worker,mill)<distance(worker,refinery));
    assert.equal(worker.service?.target,cargoKind==='wood'?base.id:refinery.id);
    assert.equal(e.command(1,{type:'stop',ids:[worker.id]}),null);
  }
});

test('workers deliver the last gold before waiting for a new nearby discovered mine',()=>{
  const e=new Engine(players(2));
  const worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!;
  e.command(1,{type:'stop',ids:e.state.units.filter(u=>u.kind==='worker'&&u.side===1).map(u=>u.id)});
  const mine=e.state.nodes.find(n=>n.kind==='gold'&&n.startSide===1)!;
  mine.amount=7;
  assert.equal(e.command(1,{type:'gather',ids:[worker.id],node:mine.id}),null);
  tick(e,40);
  assert.equal(mine.amount,0);
  assert.equal(e.player(1).stats?.income.gold,7);
  assert.equal(worker.cargo,0);
  assert.equal(worker.order,'idle');
  assert.equal(worker.waitingForGold,true);
  assert.ok(distance(worker,e.base(1)!)<STATS.base.radius+65);
});
