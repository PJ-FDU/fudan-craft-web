import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/game/engine.js';
import { Movement,circleFree,segmentFree,groundPath } from '../src/game/movement.js';
import { UnitMotion,unitPose } from '../src/game/animation.js';
import { SIZE,TILE,findPath,nearestFree,distance } from '../src/game/pathfinding.js';
import { STATS,type Unit,type Point } from '../src/game/types.js';
const ticks=(e:Engine,n:number)=>{for(let i=0;i<n;i++)e.step(.05);};
function field(){
  const e=new Engine([{name:'A',ai:false},{name:'B',ai:false}]);
  e.state.units=e.state.units.filter(u=>u.kind==='base');
  const center=e.extent/2-96;
  return {e,at:nearestFree({x:center,y:center},e.blockers())!};
}

test('rifle windup, instantaneous trace, damage and death occur in simulation order',()=>{
  const {e,at}=field(),a=e.spawn('soldier',1,at),b=e.spawn('soldier',2,{x:at.x+100,y:at.y});b.hp=9;b.cooldown=100;e.updateVision();
  e.step();assert.equal(b.hp,9);assert.equal(e.state.shots.length,0);assert.equal(a.action?.fired,null);assert.equal(unitPose(a,e.state.time).row,6);
  ticks(e,2);assert.equal(b.hp,9);e.step();assert.ok(!e.state.units.includes(b));assert.equal(e.state.shots[0].mode,'beam');assert.equal(unitPose(a,e.state.time).row,7);
  const sequence=e.view(1).events.map(e=>e.type);assert.ok(sequence.indexOf('attack')<sequence.indexOf('fire'));assert.ok(sequence.indexOf('fire')<sequence.indexOf('damage'));assert.ok(sequence.indexOf('damage')<sequence.indexOf('death'));
  ticks(e,20);assert.equal(e.player(1).kills,1);
});
test('tank shells apply no damage before arrival, survive shooter death, and exclude friendlies',()=>{
  const {e,at}=field(),tank=e.spawn('tank',1,at),a=e.spawn('soldier',2,{x:at.x+160,y:at.y}),b=e.spawn('soldier',2,{x:at.x+190,y:at.y}),ally=e.spawn('soldier',1,{x:at.x+160,y:at.y+35});
  for(const u of [a,b,ally]){u.cooldown=100;u.order='hold';}e.updateVision();ticks(e,6);
  const shot=e.state.shots.find(s=>s.mode==='shell')!;assert.ok(shot);assert.equal(a.hp,STATS.soldier.hp);assert.equal(b.hp,STATS.soldier.hp);assert.equal(tank.action?.fired,e.state.time);
  tank.hp=0;const fireAt=shot.firedAt!,duration=shot.duration!;
  while(e.state.time+.05<fireAt+duration-1e-6){e.step();assert.equal(a.hp,STATS.soldier.hp);}
  e.step();assert.equal(a.hp,STATS.soldier.hp-STATS.tank.damage);assert.ok(b.hp>a.hp&&b.hp<STATS.soldier.hp);assert.equal(ally.hp,STATS.soldier.hp);assert.ok(e.state.events.some(e=>e.type==='impact'));
});
test('a move command interrupts windup without firing a phantom shot',()=>{
  const {e,at}=field(),a=e.spawn('tank',1,at),b=e.spawn('soldier',2,{x:at.x+160,y:at.y});b.cooldown=100;e.updateVision();e.step();
  assert.equal(e.command(1,{type:'order',ids:[a.id],point:{x:at.x-150,y:at.y}}),null);assert.equal(e.state.windups.length,0);assert.equal(a.action,undefined);
  ticks(e,15);assert.equal(b.hp,STATS.soldier.hp);assert.ok(!e.state.events.some(e=>e.type==='fire'&&e.unit===a.id));assert.notEqual(unitPose(a,e.state.time).state,'attack');
});
test('vehicles turn before moving or firing and a destroyed winding unit never launches',()=>{
  const {e,at}=field(),tank=e.spawn('tank',1,at),target=e.spawn('soldier',2,{x:at.x-150,y:at.y});target.cooldown=100;target.order='hold';e.updateVision();
  e.step();assert.equal(tank.action,undefined);assert.ok(Math.abs(tank.angle)>0);ticks(e,30);assert.ok(e.state.events.some(v=>v.unit===tank.id&&v.type==='fire'));
  const other=field(),u=other.e.spawn('worker',1,other.at);u.order='move';u.destination={x:u.x-120,y:u.y};u.path=[u.destination];const x=u.x;new Movement([u],other.e.blockers()).move(u,.05);assert.equal(u.x,x);assert.ok(Math.abs(u.angle)>0);
  const dead=field(),a=dead.e.spawn('tank',1,dead.at),b=dead.e.spawn('soldier',2,{x:dead.at.x+150,y:dead.at.y});b.cooldown=100;dead.e.updateVision();dead.e.step();a.hp=0;ticks(dead.e,20);assert.ok(!dead.e.state.events.some(v=>v.unit===a.id&&v.type==='fire'));
});
test('fog-safe public maximum HP stays correct without revealing enemy technology or shot payloads',()=>{
  const {e,at}=field();e.player(2).tech.push('armor');const a=e.spawn('soldier',2,at);a.hp-=20;e.spawn('soldier',1,{x:at.x+100,y:at.y});e.updateVision();ticks(e,5);
  const view=e.view(1),seen=view.units.find(u=>u.id===a.id)!;assert.equal(seen.maxHp,STATS.soldier.hp*1.25);assert.deepEqual(view.players[1].tech,[]);
  for(const s of view.shots)for(const key of ['damage','splash','target','source'])assert.ok(!(key in s));
});
test('windups and flying shells round-trip in v2 saves; malformed new fields are rejected',()=>{
  const {e,at}=field();e.spawn('tank',1,at);const target=e.spawn('soldier',2,{x:at.x+180,y:at.y});target.cooldown=100;e.updateVision();e.step();
  const restored=Engine.restore(e.save());assert.deepEqual(restored.state,e.state);ticks(e,5);ticks(restored,5);assert.deepEqual(restored.state,e.state);
  const flying=Engine.restore(e.save());ticks(e,20);ticks(flying,20);assert.deepEqual(flying.state,e.state);
  const bad=JSON.parse(e.save());bad.units[0].velocity={x:null,y:Infinity};assert.throws(()=>Engine.restore(JSON.stringify(bad)));
  for(const [key,value] of [['navigationProgress',-1],['navigationStalled',-1],['navigationRetries',-1],['yieldPoint',{x:-1,y:0}],['travel',-1]]){const invalid=JSON.parse(e.save());invalid.units[0][key as string]=value;assert.throws(()=>Engine.restore(JSON.stringify(invalid)));}
  const old=JSON.parse(e.save());delete old.windups;assert.doesNotThrow(()=>Engine.restore(JSON.stringify(old)));
});
test('step poses follow distance rather than wall time; stops settle with a fixed ground contact',()=>{
  const {e,at}=field(),u=e.spawn('soldier',1,at);u.activity='move';u.travel=20;
  assert.equal(unitPose(u,1).row,unitPose(u,20).row);
  const motion=new UnitMotion();motion.pose(u,0,.05);u.x+=10;const moving=motion.pose(u,.05,.05);assert.equal(moving.state,'move');
  u.activity='idle';for(let n=0;n<20;n++)motion.pose(u,.1+n*.05,.05);assert.equal(motion.pose(u,2,.05).state,'idle');
});
test('twenty infantry pass a one-cell choke without overlapping or walking through walls',()=>{
  const blocked=new Uint8Array(SIZE*SIZE).fill(1);
  for(let y=10;y<=22;y++)for(let x=8;x<=15;x++)blocked[y*SIZE+x]=0;
  for(let x=16;x<=31;x++)blocked[16*SIZE+x]=0;
  for(let y=10;y<=22;y++)for(let x=32;x<=42;x++)blocked[y*SIZE+x]=0;
  const {e}=field(),units:Unit[]=[],goals=new Map<number,{x:number;y:number}>();
  for(let i=0;i<20;i++){
    const start={x:(10+i%4+.5)*TILE,y:(12+Math.floor(i/4)+.5)*TILE},goal={x:(34+i%4*2+.5)*TILE,y:(11+Math.floor(i/4)*2+.5)*TILE};
    const u=e.spawn('soldier',1,start);u.order='move';u.destination=goal;u.path=findPath(u,goal,blocked);units.push(u);goals.set(u.id,goal);
  }
  for(let n=0;n<1600;n++){
    const movement=new Movement(units,blocked);movement.separate();for(const u of units){movement.move(u,.05);if(!u.path.length)u.order='idle';}
    for(let i=0;i<units.length;i++){assert.ok(circleFree(units[i],14,blocked));for(let j=i+1;j<units.length;j++)assert.ok(distance(units[i],units[j])>=27.9);}
    if(units.every(u=>distance(u,goals.get(u.id)!)<4))break;
  }
  assert.equal(units.filter(u=>distance(u,goals.get(u.id)!)<4).length,20);
});
test('twenty workers share resource and delivery space without stacking and keep delivering',()=>{
  const {e}=field(),node=e.state.nodes.find(n=>n.kind==='gold'&&distance(n,e.base(1)!)<500)!;
  const workers=Array.from({length:20},()=>e.spawn('worker',1,e.freeSpawn(node)));e.updateVision();assert.equal(e.command(1,{type:'gather',ids:workers.map(u=>u.id),node:node.id}),null);
  const delivered=new Set<number>();let minimum=Infinity;
  for(let n=0;n<2400;n++){
    const before=workers.map(u=>u.cargo);e.step();
    workers.forEach((u,i)=>{if(before[i]>0&&u.cargo===0)delivered.add(u.id);for(let j=i+1;j<workers.length;j++)minimum=Math.min(minimum,distance(u,workers[j]));});
  }
  assert.ok(minimum>=27.9,`minimum worker separation: ${minimum}`);assert.ok(e.player(1).harvested>2000);assert.equal(delivered.size,20);
});

test('opposing friendly units back up and pass through a single-cell corridor',()=>{
  const blocked=new Uint8Array(SIZE*SIZE).fill(1);
  for(let y=13;y<=19;y++)for(let x=10;x<=15;x++)blocked[y*SIZE+x]=0;
  for(let x=16;x<=30;x++)blocked[16*SIZE+x]=0;
  for(let y=13;y<=19;y++)for(let x=31;x<=37;x++)blocked[y*SIZE+x]=0;
  const point=(x:number,y=16)=>({x:(x+.5)*TILE,y:(y+.5)*TILE});
  const {e}=field(),soldier=e.spawn('soldier',1,point(17)),tank=e.spawn('tank',1,point(29));
  const units=[soldier,tank],goals=[point(35),point(12)];
  units.forEach((u,i)=>{u.order='move';u.destination=goals[i];u.path=findPath(u,goals[i],blocked);});
  let yielded=false;
  for(let i=0;i<1200&&units.some(u=>u.path.length);i++){
    const movement=new Movement(units,blocked);
    for(const u of units){u.velocity={x:0,y:0};movement.move(u,.05);}
    yielded||=tank.yieldTo===soldier.id;
    assert.ok(distance(soldier,tank)>=28.49);
    assert.ok(units.every(u=>circleFree(u,STATS[u.kind].radius,blocked)));
  }
  assert.ok(yielded);
  units.forEach((u,i)=>assert.ok(distance(u,goals[i])<1));
});

test('a move order settles by an occupied landing without moving a unit on hold',()=>{
  const {e,at}=field(),blocked=e.blockers();
  const points=Array.from({length:16},(_,i)=>({x:at.x+Math.cos(i*Math.PI/8)*120,y:at.y+Math.sin(i*Math.PI/8)*120}));
  const goal=points.find(p=>segmentFree(at,p,14,blocked))!;
  assert.ok(goal);
  const mover=e.spawn('soldier',1,at);
  assert.equal(e.command(1,{type:'order',ids:[mover.id],point:goal}),null);
  const guard=e.spawn('soldier',1,goal);
  assert.equal(e.command(1,{type:'hold',ids:[guard.id]}),null);
  ticks(e,180);
  assert.equal(mover.order,'idle');
  assert.ok(distance(mover,goal)>28&&distance(mover,goal)<66);
  assert.equal(distance(guard,goal),0);
  assert.equal(mover.destination,undefined);
});

test('followers make room when two friendly columns meet in a choke',()=>{
  const blocked=new Uint8Array(SIZE*SIZE).fill(1);
  for(let y=13;y<=19;y++)for(let x=7;x<=41;x++)
    if(x<16||x>=30||y===16)blocked[y*SIZE+x]=0;
  const point=(x:number)=>({x:(x+.5)*TILE,y:16.5*TILE});
  const {e}=field(),units=[e.spawn('soldier',1,point(18)),e.spawn('soldier',1,point(16)),e.spawn('tank',1,point(27)),e.spawn('tank',1,point(29))];
  const goals=[34,37,11,9].map(point);
  units.forEach((u,i)=>{u.order='move';u.destination=goals[i];u.path=findPath(u,goals[i],blocked);});
  for(let i=0;i<1400&&units.some(u=>u.path.length);i++){
    const movement=new Movement(units,blocked);
    for(const u of units){u.velocity={x:0,y:0};movement.move(u,.05);if(!u.path.length)u.order='idle';}
    for(const [i,u] of units.entries()){
      assert.ok(circleFree(u,STATS[u.kind].radius,blocked));
      for(const other of units.slice(i+1))assert.ok(distance(u,other)>=28.49);
    }
  }
  units.forEach((u,i)=>assert.ok(distance(u,goals[i])<45));
});
test('allied commanders share a narrow lane while ownership remains independent',()=>{
  const blocked=new Uint8Array(SIZE*SIZE).fill(1);
  for(let y=13;y<=19;y++)for(let x=10;x<=37;x++)if(x<16||x>30||y===16)blocked[y*SIZE+x]=0;
  const e=new Engine([{name:'A',ai:false,team:1},{name:'B',ai:false,team:1},{name:'C',ai:false,team:3}]);
  const p=(x:number)=>({x:(x+.5)*TILE,y:16.5*TILE}),units=[e.spawn('soldier',1,p(17)),e.spawn('tank',2,p(29))],goals=[p(35),p(12)];
  units.forEach((u,i)=>{u.order='move';u.destination=goals[i];u.path=findPath(u,goals[i],blocked);});
  for(let i=0;i<1200&&units.some(u=>u.path.length);i++){
    const movement=new Movement(units,blocked,(a,b)=>e.allied(a,b));for(const u of units)movement.move(u,.05);
    assert.ok(distance(units[0],units[1])>=28.49);
  }
  units.forEach((u,i)=>assert.ok(distance(u,goals[i])<1));
});
test('eighty mixed vehicles and infantry cross a shared corridor and reach separated landings',()=>{
  const blocked=new Uint8Array(SIZE*SIZE).fill(1);
  for(let y=8;y<=31;y++)for(let x=5;x<=65;x++)if(x<27||x>40||y>=17&&y<=22)blocked[y*SIZE+x]=0;
  const {e}=field(),units:Unit[]=[],goals:{x:number;y:number}[]=[];
  const kinds=['soldier','tank','scout','mech'] as const;
  for(let i=0;i<80;i++){
    const goal={x:(45+i%10*2+.5)*TILE,y:(10+Math.floor(i/10)*2+.5)*TILE},u=e.spawn(kinds[i%4],1,{x:(7+i%10*2+.5)*TILE,y:(10+Math.floor(i/10)*2+.5)*TILE});
    u.order='move';u.destination=goal;u.path=findPath(u,goal,blocked);units.push(u);goals.push(goal);
  }
  for(let n=0;n<1800&&units.some(u=>u.path.length);n++){
    const movement=new Movement(units,blocked);for(const u of units){movement.move(u,.05);if(!u.path.length)u.order='idle';}
    if(n%20===0)for(const [i,u] of units.entries()){
      assert.ok(circleFree(u,STATS[u.kind].radius,blocked));
      for(const v of units.slice(i+1))assert.ok(distance(u,v)>=STATS[u.kind].radius+STATS[v.kind].radius+.45);
    }
  }
  assert.equal(units.filter((u,i)=>distance(u,goals[i])<45).length,80,JSON.stringify(units.flatMap((u,i)=>distance(u,goals[i])<45?[]:[{id:u.id,kind:u.kind,x:Math.round(u.x),y:Math.round(u.y),gap:Math.round(distance(u,goals[i])),blocked:u.blockedFor,next:u.path[0],length:u.path.length}])));
});

test('large ground units take the wide forest passage instead of entering a one-cell lane',()=>{
  const blocked=new Uint8Array(SIZE*SIZE).fill(1);
  for(let y=8;y<30;y++)for(let x=5;x<65;x++)if(x<25||x>40||y===15||y>=22&&y<=25)blocked[y*SIZE+x]=0;
  const point=(x:number,y:number)=>({x:(x+.5)*TILE,y:(y+.5)*TILE});
  const {e}=field(),unit=e.spawn('behemoth',1,point(10,15)),goal=point(55,15);
  unit.order='move';unit.destination=goal;unit.path=groundPath(unit,goal,blocked);
  assert.ok(unit.path.length);
  let previous:Point=unit;
  for(const waypoint of unit.path){assert.ok(segmentFree(previous,waypoint,STATS.behemoth.radius,blocked));previous=waypoint;}
  for(let n=0;n<1600&&unit.path.length;n++){
    new Movement([unit],blocked).move(unit,.05);
    assert.ok(circleFree(unit,STATS.behemoth.radius,blocked));
  }
  assert.ok(distance(unit,goal)<1);
});

test('a moving unit routes around a parked crowd without disturbing hold orders',()=>{
  const blocked=new Uint8Array(SIZE*SIZE),point=(x:number,y:number)=>({x:(x+.5)*TILE,y:(y+.5)*TILE});
  const {e}=field(),unit=e.spawn('soldier',1,point(10,15)),goal=point(35,15),units=[unit];
  unit.order='move';unit.destination=goal;unit.path=groundPath(unit,goal,blocked);
  for(let y=10;y<=20;y++)for(let x=16;x<=18;x++){const parked=e.spawn('soldier',1,point(x,y));parked.order='hold';units.push(parked);}
  const parked=units.slice(1).map(u=>({x:u.x,y:u.y}));
  for(let n=0;n<1600&&unit.path.length;n++){
    new Movement(units,blocked).move(unit,.05);
    for(const other of units.slice(1))assert.ok(distance(unit,other)>=28.49);
  }
  assert.ok(distance(unit,goal)<1);
  units.slice(1).forEach((u,i)=>{assert.equal(u.order,'hold');assert.deepEqual({x:u.x,y:u.y},parked[i]);});
});

test('sixty-four tightly packed units settle near enclosed landings without overlap or endless oscillation',()=>{
  const blocked=new Uint8Array(SIZE*SIZE),point=(x:number,y:number)=>({x:(x+.5)*TILE,y:(y+.5)*TILE});
  const {e}=field(),units:Unit[]=[];
  for(let i=0;i<64;i++){
    const u=e.spawn(i%2?'tank':'soldier',1,point(8+i%8,10+Math.floor(i/8)));
    u.order='move';u.destination=point(40+i%8,10+Math.floor(i/8));u.path=groundPath(u,u.destination,blocked);units.push(u);
  }
  for(let n=0;n<1600&&units.some(u=>u.path.length);n++){
    const movement=new Movement(units,blocked);
    for(const u of units){movement.move(u,.05);if(!u.path.length)u.order='idle';}
    if(n%20===0)for(const [i,u] of units.entries())for(const v of units.slice(i+1))
      assert.ok(distance(u,v)>=STATS[u.kind].radius+STATS[v.kind].radius+.45);
  }
  assert.ok(units.every(u=>!u.path.length&&u.order==='idle'));
  assert.ok(units.every(u=>u.x>1200&&u.x<1650&&u.y>240&&u.y<700));
});
