import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Engine,placementError } from '../src/game/engine.js';
import { MAPS,DEFAULT_MAP_ID,supportsPlayers } from '../src/game/maps.js';
import { getWorld,initialNodes,latestMapRevision,openingMapRevision } from '../src/game/world.js';
import { buildingFacing,buildingTiles } from '../src/game/building-layout.js';
import { circleFree,groundPath } from '../src/game/movement.js';
import { distance,indexAt,gridSize,TILE } from '../src/game/pathfinding.js';
import { STATS,isMobile,type Side } from '../src/game/types.js';
import { insidePolygon,waterContour } from '../src/game/terrain-shapes.js';
import { HOME_TREE_COUNT,STARTER_TREE_COUNT } from '../src/game/woodland.js';

const players=(count:number)=>Array.from({length:count},(_,i)=>({name:`P${i}`,ai:false}));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tick=(engine:Engine,seconds:number)=>{for(let i=0;i<seconds*20;i++)engine.step(.05);};

test('map catalog preserves the released temple layout and starting economy',()=>{
  assert.equal(MAPS.length,8);
  const world=getWorld(DEFAULT_MAP_ID,1),engine=new Engine(players(4),'normal',DEFAULT_MAP_ID,1);
  assert.equal(hash([...world.land]),'e573df772689c04742c3fa28bd830e7cc6c59de20f49bb37129eaeadbe6ad67a');
  assert.equal(hash([...world.roads]),'ca08e1c57184918dc6bbfc785783423254350bba5fb67f3b3f9b94668bfa7a30');
  assert.equal(hash(world.features),'841f3a6a372317d97583bf2dbbd906710a10d2b8b0377f7f7a37ec8871567935');
  assert.equal(hash(initialNodes(world)),'847682fa8f0d78b5eccc0173e47ee6e2349ec8a08a5640ddc1899a81237595a4');
  assert.equal(hash(engine.state.units),'319ebd2a343fd8d5f18fa1a7426501016b0094723f114bdc1dc0da12dfaef1c7');
});

test('all deterministic masks have connected playable ground and accessible resource deposits',()=>{
  const hashes=new Set<string>();
  for(const {id} of MAPS){
    const world=getWorld(id),land=world.land,size=gridSize(land);hashes.add(hash([...land]));
    assert.equal(getWorld(id),world);
    // 经典图包含外围海湾与密林；保留足够主陆地，通达性在下方逐格验证。
    const free=[...land].filter(n=>!n).length;assert.ok(free/land.length>.45,id);
    const visited=new Set<number>(),queue=[indexAt(world.bases[0],size)];
    visited.add(queue[0]);
    for(let n=0;n<queue.length;n++){
      const at=queue[n],x=at%size,y=Math.floor(at/size);
      for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const nx=x+dx,ny=y+dy,next=ny*size+nx;
        if(nx<0||ny<0||nx>=size||ny>=size||land[next]||visited.has(next))continue;
        visited.add(next);queue.push(next);
      }
    }
    // 原图允许少量装饰围出的空格；新图所有可行走地面必须连成一片。
    if(id!==DEFAULT_MAP_ID)assert.equal(visited.size,free,id);
    for(const p of [...world.bases,...initialNodes(world).filter(n=>n.kind!=='wood')])assert.ok(visited.has(indexAt(p,size)),`${id}: ${JSON.stringify(p)}`);
  }
  assert.equal(hashes.size,MAPS.length);
});

test('expanded maps quadruple battlefield area and lengthen every starting scout route',()=>{
  for(const {id,maxPlayers} of MAPS){
    const previous=new Engine(players(maxPlayers),'normal',id,openingMapRevision(id)+1);
    const expanded=new Engine(players(maxPlayers),'normal',id);
    assert.equal(expanded.size,512,id);
    assert.equal(expanded.world.land.length,4*previous.world.land.length,id);
    const travel=(engine:Engine)=>{
      const scouts=engine.state.units.filter(u=>u.kind==='scout'),blocked=engine.blockers();
      return scouts.flatMap((scout,i)=>scouts.slice(i+1).map(enemy=>{
        const route=groundPath(scout,enemy,blocked);
        assert.ok(route.length&&distance(route.at(-1)!,enemy)<32,`${id}: ${scout.side} → ${enemy.side}`);
        return route.reduce((length,point,j)=>length+distance(j?route[j-1]:scout,point),0);
      }));
    };
    const oldRoutes=travel(previous);
    travel(expanded).forEach((length,i)=>assert.ok(length>=1.75*oldRoutes[i],`${id}: route ${i+1}`));
  }
});

test('released Lost Temple woodland keeps its additive layout intact',()=>{
  const previous=getWorld(DEFAULT_MAP_ID,5),world=getWorld(DEFAULT_MAP_ID,6);
  const oldNodes=initialNodes(previous),nodes=initialNodes(world);
  assert.deepEqual(nodes.slice(0,oldNodes.length),oldNodes);
  assert.ok(nodes.length<=4096);
  const added=nodes.slice(oldNodes.length);
  assert.ok(added.length>1000);
  const engine=new Engine(players(4),'normal',DEFAULT_MAP_ID,6);
  for(const node of engine.state.nodes)if(node.kind==='wood'&&node.startSide)node.amount=0;
  const blocked=engine.blockers();
  for(const base of world.bases){
    const nearby=added.filter(node=>distance(base,node)<1170);
    assert.equal(nearby.length,48);
    for(const node of nearby)assert.ok(node.tree!==undefined&&world.treeTiles?.has(node.tree));
    const worker=engine.state.units.find(unit=>unit.side===base.side&&unit.kind==='worker')!;
    assert.ok(nearby.some(node=>{
      const route=groundPath(worker,node,blocked);
      return !!route.length&&distance(route.at(-1)!,node)<96;
    }),`side ${base.side} can reach the new trees after clearing the first grove`);
  }
  for(const corner of [{x:0,y:0},{x:0,y:16384},{x:16384,y:0},{x:16384,y:16384}]){
    assert.ok(added.some(node=>distance(node,corner)<1300));
  }
});

test('all new woodland revisions provide natural, replenished home forests with reachable outer timber',()=>{
  for(const {id,maxPlayers} of MAPS){
    const world=getWorld(id),previous=getWorld(id,latestMapRevision(id)-1);
    const nodes=initialNodes(world);
    assert.ok(nodes.length<=4096,`${id}: save limit`);
    assert.deepEqual(nodes.filter(n=>n.kind!=='wood'),initialNodes(previous).filter(n=>n.kind!=='wood'));
    const engine=new Engine(players(maxPlayers),'normal',id);
    for(const n of engine.state.nodes)if(n.kind==='wood'&&n.startSide)n.amount=0;
    const blocked=engine.blockers();
    for(const base of world.bases){
      const home=nodes.filter(n=>n.kind==='wood'&&distance(base,n)<1400);
      assert.equal(home.length,HOME_TREE_COUNT,`${id}: home ${base.side}`);
      assert.equal(home.filter(n=>n.startSide===base.side).length,STARTER_TREE_COUNT);
      assert.ok(home.reduce((sum,n)=>sum+n.max,0)>=48000);
      assert.ok(new Set(home.map(n=>n.x)).size>home.length*.9,`${id}: aligned columns`);
      assert.ok(new Set(home.map(n=>n.y)).size>home.length*.9,`${id}: aligned rows`);
      assert.ok(home.every(n=>n.tree!==undefined&&world.treeTiles?.has(n.tree)));
      const worker=engine.state.units.find(u=>u.side===base.side&&u.kind==='worker')!;
      assert.ok(home.filter(n=>!n.startSide).some(node=>{
        const route=groundPath(worker,node,blocked);
        return route.length&&distance(route.at(-1)!,node)<96;
      }),`${id}: outer forest inaccessible after harvesting the first grove`);
    }
  }
});

for(const {id,maxPlayers} of MAPS)test(`${id}: supported players spawn clear, routes reach enemies and resources`,()=>{
  for(const count of [2,3,4].filter(n=>n<=maxPlayers)){
    const engine=new Engine(players(count),'normal',id),blocked=engine.blockers();
    for(const p of engine.state.players){
      const own=engine.state.units.filter(u=>u.side===p.side),scout=own.find(u=>u.kind==='scout')!;
      assert.equal(own.filter(u=>u.kind==='worker').length,3);
      for(const u of own){
        if(isMobile(u))assert.ok(circleFree(u,STATS[u.kind].radius,blocked),`${id}: ${u.kind} spawn`);
        else for(const cell of buildingTiles(u.kind as 'base',u,u.facing??buildingFacing(u.kind as 'base',u,engine.extent)))assert.equal(engine.world.land[cell.y*engine.size+cell.x],0);
      }
      const enemy=engine.state.units.find(u=>u.side===(p.side===count?1:p.side+1)&&u.kind==='scout')!;
      const route=groundPath(scout,enemy,blocked);
      assert.ok(route.length&&distance(route.at(-1)!,enemy)<32,`${id}: side ${p.side} cannot reach enemy`);
      for(const kind of ['gold','wood','oil'] as const){
        const node=engine.nearestNode(scout,kind,scout,p.side)!;
        assert.ok(distance(node,engine.base(p.side)!)<600);
        if(id!==DEFAULT_MAP_ID)assert.ok(engine.visible.get(p.side)![engine.indexAt(node)],`${id}: ${kind} hidden at start`);
        const path=groundPath(scout,node,blocked);
        assert.ok(path.length&&distance(path.at(-1)!,node)<100,`${id}: ${kind} unreachable`);
      }
    }
  }
});

test('concurrent worlds keep independent blockers and use map-specific placement checks',()=>{
  const a=new Engine(players(2),'normal','lost-temple'),before=a.blockers();
  const b=new Engine(players(2),'normal','twin-lakes');
  b.state.players.forEach(p=>p.oil=100);
  assert.notDeepEqual(a.world.land,b.world.land);
  assert.deepEqual(a.blockers(),before);
  const lake=b.world.features.find(f=>f.kind==='water')!;
  assert.match(placementError(1,'factory',lake,b.state.units,b.state.nodes,undefined,undefined,b.world.land)!,/地形/);
  // 空地建造点若恰好是神庙中的森林，也必须按当前地图接受。
  let accepted=false;
  for(const side of [1,2] as Side[]){
    const base=b.base(side)!;
    for(let y=-10;y<=10&&!accepted;y++)for(let x=-10;x<=10&&!accepted;x++){
      const at={x:base.x+x*32,y:base.y+y*32};
      if(!placementError(side,'factory',at,b.state.units,b.state.nodes,b.visible.get(side),undefined,b.world.land)
        &&placementError(side,'factory',at,b.state.units,b.state.nodes,b.visible.get(side),undefined,a.world.land)==='该位置有地形阻挡'){
        const worker=b.state.units.find(u=>u.side===side&&u.kind==='worker')!;
        assert.equal(b.command(side,{type:'build',kind:'factory',point:at,worker:worker.id}),null);accepted=true;
      }
    }
  }
  assert.ok(accepted);assert.deepEqual(a.blockers(),before);
});

test('saves keep map identity and old v2 saves migrate only to the temple',()=>{
  for(const {id} of MAPS){
    const engine=new Engine(players(2),'normal',id);tick(engine,2);
    const restored=Engine.restore(engine.save());
    assert.equal(restored.view(1).mapId,id);
    assert.deepEqual(restored.state,engine.state);assert.deepEqual(restored.blockers(),engine.blockers());
  }
  const old=JSON.parse(new Engine(players(2),'normal',DEFAULT_MAP_ID,1).save());delete old.mapId;
  assert.equal(Engine.restore(JSON.stringify(old)).world.id,DEFAULT_MAP_ID);
  for(const mapId of ['missing','',null,42]){
    assert.throws(()=>Engine.restore(JSON.stringify({...old,mapId})));
  }
});

for(const {id,maxPlayers} of MAPS.slice(1))test(`${id}: all factions harvest and construct; AI expands and attacks`,()=>{
  const engine=new Engine(players(maxPlayers),'hard',id);
  for(const p of engine.state.players){
    // 本用例验证建造运输；油料启动门槛单独由资源回归验证。
    p.oil=100;p.wood=800;
    const worker=engine.state.units.find(u=>u.side===p.side&&u.kind==='worker')!;
    const point=engine.findBuildSpot(p.side,'factory',engine.base(p.side)!,engine.visible.get(p.side));
    assert.ok(point);assert.equal(engine.command(p.side,{type:'build',kind:'factory',point,worker:worker.id}),null);
  }
  tick(engine,45);
  for(const p of engine.state.players){
    assert.ok(p.harvested>=200,`${id}: side ${p.side} income stalled`);
    assert.ok(engine.has(p.side,'factory'),`${id}: side ${p.side} construction stalled`);
  }
  engine.player(2).ai=true;
  let assaulted=false;
  // 新局从零油料起步，最多给五分钟发展；实际完成科技和进攻后立即结束。
  for(let i=0;i<300*20;i++){
    for(const p of engine.state.players)engine.base(p.side)!.hp=STATS.base.hp;
    engine.step(.05);
    if(engine.state.units.some(u=>u.side===2&&u.order==='assault'))assaulted=true;
    if(assaulted&&engine.has(2,'research')&&engine.player(2).tech.includes('weapons'))break;
  }
  assert.ok(engine.has(2,'research'));assert.ok(engine.player(2).tech.includes('weapons'));
  assert.ok(assaulted,`${id}: AI did not attack`);
});

test('every current map spawn can build an oil well and deliver through a refinery',()=>{
  for(const {id,maxPlayers} of MAPS){
    const engine=new Engine(players(maxPlayers),'normal',id);
    for(const p of engine.state.players){
      const node=engine.state.nodes.find(n=>n.kind==='oil'&&n.startSide===p.side)!;
      const at=engine.findBuildSpot(p.side,'refinery',node,engine.visible.get(p.side));
      assert.ok(at,`${id}: side ${p.side} lacks a refinery site`);
      engine.spawn('refinery',p.side,at);
      engine.updateVision();
      const worker=engine.state.units.find(u=>u.side===p.side&&u.kind==='worker')!;
      assert.match(engine.command(p.side,{type:'gather',ids:[worker.id],node:node.id})!,/油井/);
      assert.equal(engine.command(p.side,{type:'build',kind:'oilwell',point:node,worker:worker.id}),null);
    }
    tick(engine,45);
    for(const p of engine.state.players)assert.ok(p.oil>=80,`${id}: side ${p.side} oil delivery stalled`);
  }
});

test('terrain revisions preserve existing saves and resource positions',()=>{
  for(const {id} of MAPS.slice(1,4)){
    const previous=new Engine(players(4),'normal',id,1),raw=JSON.parse(previous.save());
    delete raw.mapRevision;
    const restored=Engine.restore(JSON.stringify(raw)),current=new Engine(players(4),'normal',id,2);
    assert.equal(restored.world.revision,1);assert.equal(restored.view(1).mapRevision,1);
    assert.equal(current.world.revision,2);assert.equal(current.view(1).mapRevision,2);
    assert.deepEqual(restored.blockers(),previous.blockers());
    assert.deepEqual(current.state.nodes,previous.state.nodes);
    assert.deepEqual(current.state.units,previous.state.units);
    assert.notDeepEqual(current.world.land,previous.world.land);
    assert.throws(()=>Engine.restore(JSON.stringify({...raw,mapRevision:latestMapRevision(id)+1})));
    assert.throws(()=>getWorld(id,0));
  }
});

test('irregular shores and rivers share their footprint with pathfinding and never carry roads',()=>{
  assert.equal(getWorld('twin-lakes').features.filter(f=>f.kind==='water').length,2);
  for(const {id} of MAPS){
    if(id===DEFAULT_MAP_ID)continue;
    const world=getWorld(id),size=gridSize(world.land);
    for(const lake of world.features.filter(f=>f.kind==='water')){
    assert.ok(lake.outline&&lake.outline.length>=64);
    const coast=waterContour(lake,1.045);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const p={x:(x+.5)*TILE-lake.x,y:(y+.5)*TILE-lake.y};
      if(!insidePolygon(p,coast))continue;
      assert.equal(world.land[y*size+x],1);assert.equal(world.roads[y*size+x],0);
    }
    }
  }
});

test('classic maps preserve their distinct starting topology and enforce player capacity',()=>{
  for(const {id,maxPlayers} of MAPS){
    assert.equal(getWorld(id).bases.length,maxPlayers);
    assert.equal(supportsPlayers(id,maxPlayers),true);
    assert.equal(supportsPlayers(id,1),false);assert.equal(supportsPlayers(id,5),false);
    if(maxPlayers===2){
      assert.throws(()=>new Engine(players(3),'normal',id),/支持/);
      const raw=JSON.parse(new Engine(players(3)).save());raw.mapId=id;
      assert.throws(()=>Engine.restore(JSON.stringify(raw)),/存档/);
    }
  }
  const legacyBases=(id:typeof MAPS[number]['id'])=>getWorld(id,openingMapRevision(id)).bases;
  const ei=legacyBases('echo-isles'),tr=legacyBases('turtle-rock'),ts=legacyBases('terenas-stand');
  assert.equal(ei[0].y,ei[1].y);assert.ok(ei.every(b=>b.y<1500));
  assert.ok(distance(tr[0],tr[2])<1300);assert.ok(distance(tr[0],tr[1])>2800);
  assert.ok(ts[0].x<1500&&ts[0].y<1500&&ts[1].x>2600&&ts[1].y>2600);
  // 四类公共资源都能从主陆地抵达；没有采集车永远无法进入的岛矿。
  for(const {id} of MAPS.slice(4)){
    const engine=new Engine(players(2),'normal',id),scout=engine.state.units.find(u=>u.side===1&&u.kind==='scout')!;
    for(const node of engine.state.nodes.filter(n=>n.kind!=='wood'&&n.startSide===undefined)){
      const route=groundPath(scout,node,engine.blockers());
      assert.ok(route.length&&distance(route.at(-1)!,node)<100,`${id}: public ${node.id} unreachable`);
    }
    assert.equal(getWorld(id).revision,latestMapRevision(id));
    assert.throws(()=>getWorld(id,latestMapRevision(id)+1),/版本/);
  }
});
