import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/game/engine.js';
import { ABILITY_IDS, ABILITIES } from '../src/game/abilities.js';
import { effect, motionScale } from '../src/game/ability-engine.js';
import { RACES, STATS, type Side, type Unit } from '../src/game/types.js';
import { ROSTERS, population } from '../src/game/races.js';
import { validCommand } from '../src/game/command-validation.js';
import { HostRoom } from '../src/network/host-room.js';
import { BattleModels } from '../src/game/models-3d.js';
import { DataTexture, Mesh } from 'three';

const tick=(e:Engine,seconds:number)=>{for(let i=0;i<Math.round(seconds*20);i++)e.step(.05);};
function game(){
  const e=new Engine(RACES.map((race,i)=>({name:race,ai:false,team:(i+1) as Side,race})),'normal','lost-temple',1);
  for(const u of e.state.units)if(u.kind==='worker'){u.order='idle';u.path=[];}
  return e;
}
function arena(){
  const e=game();e.state.units=e.state.units.filter(u=>u.kind==='base');
  const at=e.freeSpawn(e.base(1)!);
  const spawn=(kind:Unit['kind'],side:Side,x:number,y=0)=>{
    const unit=e.spawn(kind,side,{x:at.x+x,y:at.y+y});unit.order='hold';unit.cooldown=60;e.updateVision();return unit;
  };
  return {e,at,spawn};
}

test('four rosters enforce unique production, technology and population reservations',()=>{
  const e=game();
  for(const p of e.state.players){
    const roster=ROSTERS[p.race!];
    assert.ok(e.has(p.side,roster.production));
    assert.equal(e.command(p.side,{type:'train',kind:roster.opening[0]}),null);
    assert.ok(population(p,e.state.units).reserved>0);
    assert.equal(e.command(p.side,{type:'research',tech:'tier2'}),null);
  }
  assert.match(e.command(4,{type:'train',kind:'soldier'})!,/种族/);
  assert.match(e.command(2,{type:'build',kind:'node',worker:e.state.units.find(u=>u.side===2&&u.kind==='worker')!.id,point:e.base(2)!})!,/种族/);
  assert.equal(ABILITY_IDS.length,24);
  assert.equal(new Set(Object.values(ABILITIES).map(x=>x.unit)).size,12);
  assert.ok(validCommand({type:'stop',ids:Array.from({length:81},(_,i)=>i+1)},e.extent));
  assert.ok(!validCommand({type:'cast',skill:'constructor',ids:[1]},e.extent));
});

test('casts spend once, retain windup through save, and root protects after removal',()=>{
  const {e,spawn}=arena(),binder=spawn('binder',2,80),medic=spawn('medic',1,-55),target=spawn('soldier',1,20);
  e.player(1).tech.push('IND-02');
  const root={type:'cast',skill:'BIO-05',ids:[binder.id],target:target.id} as const;
  assert.equal(e.command(2,{...root,ids:[...root.ids]}),null);
  assert.equal(binder.ability?.energy,15);
  const restored=Engine.restore(e.save());
  assert.equal(restored.state.units.find(u=>u.id===binder.id)?.ability?.cast?.skill,'BIO-05');
  tick(e,.55);
  assert.equal(motionScale(target),0);
  assert.equal(e.command(1,{type:'cast',ids:[medic.id],skill:'IND-02',target:target.id}),null);
  tick(e,.3);
  assert.equal(effect(target,'root',e.state.time),0);
  assert.equal(effect(target,'rootGuard',e.state.time),1);
  assert.equal(motionScale(target),1);
  binder.ability!.energy=50;binder.ability!.cooldowns['BIO-05']=0;
  assert.match(e.command(2,{...root,ids:[binder.id]})!,/抗性/);
  assert.equal(binder.ability!.energy,50);
});

test('treatment inhibition applies after the rolling base budget and cleanse removes the full group',()=>{
  const {e,spawn}=arena(),target=spawn('tank',1,0),infector=spawn('infector',2,110),medic=spawn('medic',1,-65);
  target.hp=100;e.player(1).tech.push('IND-02');
  assert.equal(e.command(2,{type:'cast',ids:[infector.id],skill:'BIO-03',target:target.id}),null);
  tick(e,.45);
  const heals=[e.skills.heal(target,10),e.skills.heal(target,10),e.skills.heal(target,10)];
  assert.deepEqual(heals,[6,6,0]);
  const statuses=target.ability!.effects;
  statuses.push({...statuses.find(s=>s.group==='healCut')!,source:999,value:.25});
  assert.equal(e.command(1,{type:'cast',ids:[medic.id],skill:'IND-02',target:target.id}),null);
  tick(e,.3);
  assert.equal(effect(target,'healCut',e.state.time),0);
  assert.equal(effect(target,'infection',e.state.time),4);
  assert.equal(e.skills.heal(target,10),0);
  tick(e,.75);assert.equal(e.skills.heal(target,10),10);
});

test('stellar coverage freezes accepted production without releasing reserved population',()=>{
  const e=game(),p=e.player(3),node=e.state.units.find(u=>u.kind==='node'&&u.side===3)!;
  assert.equal(e.command(3,{type:'train',kind:'lancer'}),null);
  tick(e,1);
  const q=p.queue[0],remaining=q.remaining;
  e.state.units=e.state.units.filter(u=>u!==node);
  tick(e,1);
  assert.equal(q.remaining,remaining);
  assert.equal(population(p,e.state.units).reserved,1);
  assert.match(e.command(3,{type:'train',kind:'lancer'})!,/生产设施/);
  e.spawn('node',3,node);tick(e,1);
  assert.ok(q.remaining<remaining);
});

test('relay assembly retains identity while packing, moving, and deploying',()=>{
  const e=game(),u=e.state.units.find(u=>u.side===4&&u.kind==='assembly')!;
  assert.equal(e.command(4,{type:'train',kind:'ranger',producer:u.id}),null);
  assert.match(e.command(4,{type:'station',id:u.id,action:'pack'})!,/队列/);
  assert.equal(e.command(4,{type:'cancel',index:0}),null);
  const original={x:u.x,y:u.y};
  assert.equal(e.command(4,{type:'station',id:u.id,action:'pack'}),null);tick(e,8.1);
  assert.equal(u.station?.mode,'mobile');
  assert.match(e.command(4,{type:'train',kind:'ranger',producer:u.id})!,/生产设施/);
  const start=e.freeSpawn(u);
  assert.equal(e.command(4,{type:'station',id:u.id,action:'move',point:start}),null);
  tick(e,.75);assert.notDeepEqual({x:u.x,y:u.y},original);
  e.command(4,{type:'station',id:u.id,action:'stop'});
  u.x=original.x;u.y=original.y;e.updateVision();
  assert.equal(e.command(4,{type:'station',id:u.id,action:'deploy',point:original}),null);
  tick(e,8.1);
  assert.equal(u.station,undefined);
  assert.equal(e.command(4,{type:'train',kind:'ranger',producer:u.id}),null);
});

test('P2P lobby choice reaches the authoritative game and reconnect snapshot',()=>{
  const messages:{id:string;message:Record<string,unknown>}[]=[];
  const room=new HostRoom('TEST','owner',(id,message)=>messages.push({id,message}));
  room.connect('owner');room.connect('guest');
  room.receive('owner',{type:'create'});room.receive('guest',{type:'join',code:'TEST'});
  room.receive('owner',{type:'select-race',race:'stellar'});room.receive('guest',{type:'select-race',race:'relay'});
  room.receive('owner',{type:'start'});
  assert.equal(room.engine?.player(1).race,'stellar');
  assert.equal(room.engine?.player(2).race,'relay');
  assert.ok(messages.some(m=>m.id==='guest'&&m.message.type==='state'));
});

test('every included unit and building has finite renderable geometry',()=>{
  const models=new BattleModels(new DataTexture());
  for(const race of RACES){
    const roster=ROSTERS[race];
    for(const kind of new Set(['base',...roster.units,...roster.buildings] as const)){
      const model=models.unit(kind,1,false,race);
      assert.ok(model.height>0&&Number.isFinite(model.height),kind);
      let vertices=0;
      model.root.traverse(obj=>{if(obj instanceof Mesh){
        const positions=obj.geometry.getAttribute('position');vertices+=positions.count;
        assert.ok(positions.array.every(Number.isFinite),kind);
      }});
      assert.ok(vertices>0,kind);
    }
  }
});

test('recon reserves team capacity and dismantling withdraws its vision but keeps exploration',()=>{
  const {e,at,spawn}=arena(),observer=spawn('observer',4,0),enemy=spawn('observer',2,100);
  const partner=spawn('observer',4,-46),third=spawn('observer',4,-92);
  e.player(2).tech.push('RLY-04');
  const point=e.freeSpawn({...at,x:at.x+75,y:at.y});
  const recon=(id:number)=>e.command(4,{type:'cast',skill:'RLY-03',ids:[id],point});
  assert.equal(recon(observer.id),null);
  assert.equal(recon(partner.id),null);
  assert.match(recon(third.id)!,/名额/);
  tick(e,.5);
  const area=e.skills.areas.find(a=>a.source===observer.id)!;
  assert.ok(area);
  assert.equal(e.view(2).areas?.find(a=>a.id===area.id)?.source,0);
  assert.equal(e.command(2,{type:'cast',skill:'RLY-04',ids:[enemy.id],area:area.id}),null);
  tick(e,.55);
  assert.ok(!e.skills.areas.some(a=>a.id===area.id));
  assert.equal(e.state.explored[4][e.indexAt(point)],1);
  assert.equal(recon(third.id),null);
});

test('absorption consumes temporary and native shields in order and suppresses regeneration on a hit',()=>{
  const {e,spawn}=arena(),weaver=spawn('weaver',3,0),target=spawn('lancer',3,65);
  assert.equal(e.command(3,{type:'cast',skill:'ENE-01',ids:[weaver.id],target:target.id}),null);
  tick(e,.35);
  assert.equal(effect(target,'barrier',e.state.time),60);
  e.skillDamage(target,1,80);
  assert.equal(effect(target,'barrier',e.state.time),0);
  assert.equal(target.shield,35);
  assert.equal(target.hp,STATS.lancer.hp);
  tick(e,5.95);assert.equal(target.shield,35);
  tick(e,.25);assert.ok(target.shield!>35);
});
