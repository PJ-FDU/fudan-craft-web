import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Engine } from '../src/game/engine.js';
import { unitPose,buildingPose,deathPose,AnimationClock } from '../src/game/animation.js';
import { terrainLOD,fitTerrainLOD,TERRAIN_BUDGET,TERRAIN_CHUNK,ByteLRU } from '../src/game/terrain-detail.js';
import { STATS,type VisualEvent } from '../src/game/types.js';
import { ATLAS_FRAMES } from '../src/game/atlas-frames.js';
import { nearestFree } from '../src/game/pathfinding.js';

function game(){return new Engine([{name:'A',ai:false},{name:'B',ai:false}]);}
const ticks=(e:Engine,n:number)=>{for(let i=0;i<n;i++)e.step(.05);};

test('walk, idle and work use different authored rows; an attack order alone never fires',()=>{
  const e=game(),u=e.state.units.find(u=>u.kind==='soldier')!;
  u.activity='idle';u.order='attack';assert.equal(unitPose(u,5).state,'idle');
  u.activity='move';const frames=new Set(Array.from({length:80},(_,i)=>unitPose(u,0,i*2).row));assert.deepEqual([...frames].sort(),[2,3,4,5]);
  u.activity='gather';assert.ok([6,7].includes(unitPose(u,1).row));
  u.action={started:4,fired:null,until:4.5};assert.equal(unitPose(u,4.05).row,6);u.action.fired=4.15;assert.equal(unitPose(u,4.2).row,7);assert.equal(unitPose(u,5).state,'gather');
});
test('building construction and damage take precedence over production',()=>{
  const u=game().base(1)!;u.construction=.01;assert.deepEqual(buildingPose(u,1600,true,1),{atlas:'building-construction',frame:0});
  u.construction=.6;assert.equal(buildingPose(u,1600,true,1).frame,2);u.construction=1;u.hp=300;
  assert.deepEqual(buildingPose(u,1600,true,1),{atlas:'building-damage',frame:3});u.hp=1600;
  const frames=new Set(Array.from({length:40},(_,i)=>buildingPose(u,1600,true,i*.05).frame));assert.equal(frames.size,4);
});
test('death frames finish and fade, while interpolation is bounded during pause and victory',()=>{
  assert.equal(deathPose(.1).row,8);assert.equal(deathPose(.5).row,9);assert.equal(deathPose(4).alpha,0);
  const c=new AnimationClock();c.advance(10,0,false);for(let i=0;i<100;i++)c.advance(10,.05,false);assert.ok(c.time<=10.12);
  c.advance(11,.05,false);assert.equal(c.time,11);for(let i=0;i<100;i++)c.advance(11,.05,true);assert.equal(c.time,14.3);
});
test('fatal combat emits a single retained death after the target leaves the simulation',()=>{
  const e=game(),point=nearestFree({x:2000,y:2000})!;
  e.state.units=e.state.units.filter(u=>u.kind==='base');
  const shooter=e.spawn('soldier',1,point);
  const victim=e.spawn('soldier',2,{x:shooter.x+100,y:shooter.y});victim.hp=1;victim.cooldown=100;e.updateVision();ticks(e,5);
  assert.ok(!e.state.units.some(u=>u.id===victim.id));
  const events=e.view(1).events;assert.equal(events.filter(e=>e.unit===victim.id&&e.type==='death').length,1);assert.ok(events.some(e=>e.unit===shooter.id&&e.type==='attack'));
  ticks(e,10);assert.equal(e.view(1).events.filter(e=>e.unit===victim.id&&e.type==='death').length,1);
  ticks(e,90);assert.ok(!e.view(1).events.some(e=>e.unit===victim.id));
});
test('events cannot reveal off-screen enemy deaths, even after moving vision there',()=>{
  const e=game(),enemy=e.state.units.find(u=>u.side===2&&u.kind==='soldier')!;enemy.hp=0;e.step();
  assert.ok(e.view(2).events.some(v=>v.unit===enemy.id));assert.ok(!e.view(1).events.some(v=>v.unit===enemy.id));
  const scout=e.state.units.find(u=>u.side===1&&u.kind==='scout')!;scout.x=enemy.x;scout.y=enemy.y;e.updateVision();
  assert.ok(!e.view(1).events.some(v=>v.unit===enemy.id),'historical events only go to observers present when they occurred');
});
test('worker activity reflects actual work, and production emits deployment events',()=>{
  const e=game(),w=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,n=e.nearestNode(w,'gold')!;
  w.x=n.x+n.radius+10;w.y=n.y;w.path=[];w.returning=false;w.resource=n.id;w.order='gather';e.step();assert.equal(w.activity,'gather');
  e.command(1,{type:'train',kind:'worker'});e.step();assert.equal(e.base(1)!.activity,'produce');ticks(e,STATS.worker.build*20);
  assert.ok(e.view(1).events.some(e=>e.type==='spawn'&&e.kind==='worker'));assert.ok(e.view(1).events.some(e=>e.type==='complete'&&e.kind==='base'));
});
test('v2 saves migrate missing animation data and reject malformed event payloads',()=>{
  const e=game(),old=JSON.parse(e.save());delete old.events;delete old.nextEventId;
  const restored=Engine.restore(JSON.stringify(old));assert.deepEqual(restored.state.events,[]);assert.equal(restored.state.nextEventId,1);restored.step();
  const invalid=JSON.parse(e.save());invalid.events=[{id:1,type:'death',x:NaN}];assert.throws(()=>Engine.restore(JSON.stringify(invalid)));
});
test('detail increases with zoom/DPR and terrain cache stays bounded under repeated panning',()=>{
  assert.equal(terrainLOD(.5,1),1);assert.equal(terrainLOD(1,2),2);assert.equal(terrainLOD(2.4,2),4);
  const chunks=32*19,lod=fitTerrainLOD(.94,2,chunks);assert.ok(chunks*((TERRAIN_CHUNK+2)*lod)**2*4<TERRAIN_BUDGET,'a large display must not continually evict its own visible tiles');
  const cache=new ByteLRU<number>(12);cache.set('a',1,4);cache.set('b',2,4);cache.set('c',3,4);cache.get('a');cache.set('d',4,4);
  assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a'),1);
  for(let i=0;i<1000;i++)cache.set(String(i),i,4);assert.equal(cache.bytes,12);cache.set('huge',2,20);assert.equal(cache.bytes,12);
});

test('every generated action has a non-empty calibrated source frame inside the actual PNG',()=>{
  let total=0;
  for(const [name,meta] of Object.entries(ATLAS_FRAMES)){
    const file=name.startsWith('animation-')?name:`animation-${name}`;
    const png=readFileSync(new URL(`../public/assets/generated/${file}-v4.png`,import.meta.url));
    assert.equal(png.readUInt32BE(16),meta.width);assert.equal(png.readUInt32BE(20),meta.height);
    assert.equal(meta.frames.length,meta.columns*meta.rows);
    for(const [x,y,w,h,ax,ay] of meta.frames){assert.ok(w>0&&h>0&&x>=0&&y>=0&&x+w<=meta.width&&y+h<=meta.height);assert.ok(ax>=-3&&ax<=w+3&&ay>=0&&ay<=h);}
    total+=meta.frames.length;
  }
  assert.equal(total,876);
  const soldier=ATLAS_FRAMES['animation-soldier'];
  assert.notEqual(soldier.frames[8][1],soldier.height/10,'authored sheets need measured gutters rather than equal-height slices');
});
