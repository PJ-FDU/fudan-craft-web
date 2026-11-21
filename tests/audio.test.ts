import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { AudioDirector,AudioEvents,GameAudio,DEFAULT_AUDIO,buildingSounds,parseAudioSettings } from '../src/game/audio.js';
import { EFFECTS,LOOPS,VOICES,EN_VOICES,audioPath } from '../src/game/audio-catalog.js';
import { FACTION_EFFECTS,FACTION_LOOPS,buildingLoop,skillCue,weaponCue } from '../src/game/faction-sounds.js';
import { FACTION_VOICES,factionUnitVoice } from '../src/game/faction-voice.js';
import { ROSTERS } from '../src/game/races.js';
import { RACES,STATS } from '../src/game/types.js';
import { Engine } from '../src/game/engine.js';
import { nearestFree } from '../src/game/pathfinding.js';

function field(){
  const engine=new Engine([{name:'A',ai:false},{name:'B',ai:false}]);
  engine.state.units=engine.state.units.filter(u=>u.kind==='base');
  const point=nearestFree({x:2000,y:2000})!;
  return {engine,point,events:new AudioEvents()};
}
test('sound files cover every cue and both recorded languages',()=>{
  for(const name of [...EFFECTS,...LOOPS,...Object.keys(VOICES) as (keyof typeof VOICES)[]]){
    const path=`public${audioPath(name)}`;
    assert.ok(existsSync(path),path);assert.ok(readFileSync(path).length>2000,path);
  }
  assert.deepEqual(Object.keys(EN_VOICES).sort(),Object.keys(VOICES).sort());
  for(const id of Object.keys(EN_VOICES) as (keyof typeof VOICES)[]){
    const path=`public${audioPath(id,'en')}`;
    assert.ok(existsSync(path),path);assert.ok(readFileSync(path).length>2000,path);
  }
});
test('each faction roster has dedicated responses and its complete audio bank ships',()=>{
  for(const race of RACES){
    for(const kind of ROSTERS[race].units){
      for(const action of ['select','move'] as const)assert.ok(factionUnitVoice(race,kind,action),`${race}/${kind}/${action}`);
      if(STATS[kind].damage>0)assert.ok(factionUnitVoice(race,kind,'attack'),`${race}/${kind}/attack`);
    }
    for(const action of ['gather','repair','build'] as const)assert.ok(factionUnitVoice(race,'worker',action),`${race}/${action}`);
  }
  const cues=[...FACTION_EFFECTS,...FACTION_LOOPS,...FACTION_VOICES.keys()];
  const paths=[...cues.map(cue=>audioPath(cue)),...[...FACTION_VOICES.keys()].map(cue=>audioPath(cue,'en'))];
  assert.equal(new Set(paths).size,paths.length);
  for(const path of paths){
    assert.match(path,/\/factions-v1\//);
    assert.ok(readFileSync(`public${path}`).length>1000,path);
  }
});
test('opponent attacks sound like the source faction at launch and impact, once through fog',()=>{
  const engine=new Engine([{name:'A',ai:false,race:'industrial'},{name:'B',ai:false,race:'stellar'}]);
  engine.state.units=engine.state.units.filter(u=>u.kind==='base');
  const point=nearestFree({x:2000,y:2000})!;
  const attacker=engine.spawn('lancer',2,point),target=engine.spawn('soldier',1,{x:point.x+90,y:point.y});
  target.cooldown=100;target.order='hold';engine.updateVision();
  const events=new AudioEvents();events.reset(engine.view(1),1);
  const shot=weaponCue('stellar','lancer','fire'),hit=weaponCue('stellar','lancer','impact');
  let fired=false,impacted=false;
  for(let i=0;i<30&&!impacted;i++){
    engine.step();const view=engine.view(1),sounds=events.collect(view,1);
    fired ||= sounds.some(event=>event.effect===shot&&event.combat);
    impacted ||= sounds.some(event=>event.effect===hit);
    events.collect({...view,events:view.events.filter(event=>event.unit!==attacker.id)},1);
    assert.deepEqual(events.collect(view,1),[]);
  }
  assert.ok(fired&&impacted);
});
test('shared structures use their owner’s sound and production follows actual activity',()=>{
  const engine=new Engine([{name:'A',ai:false,race:'relay'},{name:'B',ai:false,race:'brood'}]);
  const base=engine.base(1)!,other=engine.base(2)!;
  const view=engine.view(1);
  const visibleBase=(side:1|2)=>engine.view(side).units.find(unit=>unit.kind==='base'&&unit.side===side)!;
  assert.equal(buildingSounds({...view,units:[visibleBase(1)]},base)[0]?.loop,buildingLoop('relay','base',false));
  assert.equal(buildingSounds({...view,units:[visibleBase(2)]},other)[0]?.loop,buildingLoop('brood','base',false));
  const assembly=engine.state.units.find(u=>u.side===1&&u.kind==='assembly')!;
  assert.equal(engine.command(1,{type:'train',kind:'ranger',producer:assembly.id}),null);
  assert.equal(buildingSounds(engine.view(1),assembly)[0]?.loop,buildingLoop('relay','assembly',false));
  engine.step();
  assert.equal(buildingSounds(engine.view(1),assembly)[0]?.loop,buildingLoop('relay','assembly',true));
  assert.ok(buildingSounds(engine.view(1),{x:base.x,y:base.y-80}).some(sound=>sound.loop===buildingLoop('relay','assembly',true)));
  const worker=engine.state.units.find(u=>u.side===1&&u.kind==='worker')!;
  const played:string[]=[];
  const director=new AudioDirector({effect:(id:string)=>played.push(id),voice:(id:string)=>played.push(id)} as unknown as GameAudio);
  director.command({type:'gather',ids:[worker.id],node:1},engine.view(1),1);
  assert.deepEqual(played,['faction-relay-order','faction-relay-unit-worker-gather']);
});
test('interrupted skills stay silent and released skill events survive a save',()=>{
  const engine=new Engine([{name:'A',ai:false,race:'brood'},{name:'B',ai:false,race:'industrial'}]);
  const point=engine.freeSpawn(engine.base(1)!);
  const binder=engine.spawn('binder',1,point),target=engine.spawn('soldier',2,{x:point.x+50,y:point.y});
  target.cooldown=100;target.order='hold';engine.updateVision();
  const events=new AudioEvents();events.reset(engine.view(1),1);
  const cast={type:'cast' as const,skill:'BIO-05' as const,target:target.id,ids:[binder.id]};
  const sound=skillCue('brood',cast.skill);
  assert.equal(engine.command(1,cast),null);
  engine.step(.05);
  assert.ok(!events.collect(engine.view(1),1).some(event=>event.effect===sound));
  engine.command(1,{type:'stop',ids:[binder.id]});
  for(let i=0;i<12;i++)engine.step(.05);
  assert.ok(!events.collect(engine.view(1),1).some(event=>event.effect===sound));
  binder.ability!.energy=50;binder.ability!.cooldowns[cast.skill]=0;
  assert.equal(engine.command(1,cast),null);
  for(let i=0;i<12;i++)engine.step(.05);
  assert.equal(events.collect(engine.view(1),1).filter(event=>event.effect===sound).length,1);
  assert.equal(Engine.restore(engine.save()).state.events.find(event=>event.type==='cast')?.skill,cast.skill);
});
test('gathering and repairs use the worker; stopping and holding only play confirmation sounds',()=>{
  const {engine,point}=field();
  const soldier=engine.spawn('soldier',1,point),worker=engine.spawn('worker',1,{x:point.x+80,y:point.y});
  const enemy=engine.spawn('soldier',2,{x:point.x+130,y:point.y});
  const base=engine.base(1)!;base.hp-=10;
  engine.updateVision();
  const played:string[]=[];
  const director=new AudioDirector({
    effect:(id:string)=>played.push(id),voice:(id:string)=>played.push(id),
  } as unknown as GameAudio);
  const view=engine.view(1),ids=[soldier.id,worker.id];
  director.command({type:'gather',ids,node:1},view,1);
  director.command({type:'repair',ids,target:base.id},view,1);
  director.command({type:'order',ids,target:base.id,point:base},view,1);
  director.command({type:'hold',ids},view,1);
  director.command({type:'stop',ids},view,1);
  director.command({type:'order',ids,target:enemy.id,point:enemy},view,1);
  assert.deepEqual(played,[
    'order','unit-worker-gather','build-start','unit-worker-repair','build-start','unit-worker-repair',
    'ui-confirm','ui-confirm','order','unit-soldier-attack',
  ]);
});
test('audio settings tolerate corrupt storage and constrain channel levels',()=>{
  assert.deepEqual(parseAudioSettings('{bad'),DEFAULT_AUDIO);
  assert.deepEqual(parseAudioSettings('null'),DEFAULT_AUDIO);
  const settings=parseAudioSettings('{"music":5,"voice":-1,"ambient":"loud","master":null,"enabled":false,"subtitles":false}');
  assert.equal(settings.music,1);assert.equal(settings.voice,0);assert.equal(settings.ambient,DEFAULT_AUDIO.ambient);
  assert.equal(settings.master,DEFAULT_AUDIO.master);assert.equal(settings.enabled,false);assert.equal(settings.subtitles,false);
});
test('quick mute and unmute cancels a voice that is still loading',async()=>{
  const originalFetch=globalThis.fetch,originalContext=globalThis.AudioContext;
  let starts=0,resolveVoice!:(response:Response)=>void;
  const parameter=()=>({value:1,cancelAndHoldAtTime(){},linearRampToValueAtTime(){}});
  const gain=()=>({gain:parameter(),connect(){},disconnect(){}});
  class TestContext{
    state='running';currentTime=0;destination={};
    async resume(){}
    createGain(){return gain();}
    createDynamicsCompressor(){return {threshold:parameter(),knee:parameter(),ratio:parameter(),attack:parameter(),release:parameter(),connect(){}};}
    async decodeAudioData(){return {duration:1} as AudioBuffer;}
    createBufferSource(){return {buffer:null,loop:false,playbackRate:parameter(),onended:null,connect(){},disconnect(){},start(){starts++;},stop(){}};}
  }
  globalThis.AudioContext=TestContext as unknown as typeof AudioContext;
  globalThis.fetch=(async input=>String(input).includes('unit-soldier-select')
    ?new Promise<Response>(resolve=>{resolveVoice=resolve;})
    :new Response(new ArrayBuffer(8))) as typeof fetch;
  const captions:string[]=[];
  try{
    const audio=new GameAudio((_speaker,text)=>captions.push(text),()=>{});
    await audio.unlock();audio.voice('unit-soldier-select');
    audio.set('enabled',false);audio.set('enabled',true);
    resolveVoice(new Response(new ArrayBuffer(8)));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(starts,0);assert.ok(!captions.includes(VOICES['unit-soldier-select']));
  }finally{globalThis.fetch=originalFetch;globalThis.AudioContext=originalContext;}
});
test('cancelled weapon windups produce no sound; firing is consumed once per visible event',()=>{
  const {engine,point,events}=field();
  const tank=engine.spawn('tank',1,point),target=engine.spawn('soldier',2,{x:point.x+150,y:point.y});
  target.cooldown=100;target.order='hold';engine.updateVision();events.reset(engine.view(1),1);
  engine.step();assert.ok(!events.collect(engine.view(1),1).some(e=>e.effect==='tank-cannon'));
  engine.command(1,{type:'order',ids:[tank.id],point:{x:point.x-100,y:point.y}});
  for(let i=0;i<12;i++){engine.step();assert.ok(!events.collect(engine.view(1),1).some(e=>e.effect==='tank-cannon'));}
  engine.command(1,{type:'order',ids:[tank.id],point:target,target:target.id});
  let fires=0;
  for(let i=0;i<80;i++){
    engine.step();const view=engine.view(1);fires+=events.collect(view,1).filter(e=>e.effect==='tank-cannon').length;
    assert.deepEqual(events.collect(view,1),[]);
  }
  assert.ok(fires>0);
});
test('shell impact sound waits for authoritative arrival instead of playing at launch',()=>{
  const {engine,point,events}=field();
  engine.spawn('tank',1,point);const target=engine.spawn('soldier',2,{x:point.x+180,y:point.y});
  target.cooldown=100;target.order='hold';engine.updateVision();events.reset(engine.view(1),1);
  let fired=false,hit=false;
  for(let i=0;i<24;i++){
    const hp=target.hp;engine.step();const cues=events.collect(engine.view(1),1);
    if(cues.some(e=>e.effect==='tank-cannon')){assert.equal(target.hp,hp);fired=true;}
    if(cues.some(e=>e.effect==='shell-hit')){assert.ok(fired);assert.ok(target.hp<hp);hit=true;break;}
    if(!hit)assert.ok(!cues.some(e=>e.effect==='shell-hit'));
  }
  assert.ok(hit);
});
test('fog-hidden enemy fire never reaches the sound director',()=>{
  const {engine,events}=field();
  const base=engine.base(2)!;
  engine.state.events=[{id:1,unit:base.id,kind:'tank',side:2,x:base.x,y:base.y,angle:0,time:0,type:'fire',audience:6}];
  const view=engine.view(1);assert.equal(view.events.length,0);
  events.reset({...view,events:[]},1);assert.deepEqual(events.collect(view,1),[]);
});
test('loaded snapshots and returning from pause discard retained and stale events',()=>{
  const {engine,events}=field(),base=engine.base(1)!;
  engine.state.events=[{id:1,unit:base.id,kind:'soldier',side:1,x:base.x,y:base.y,angle:0,time:0,type:'fire',audience:2}];
  events.reset(engine.view(1),1);assert.deepEqual(events.collect(engine.view(1),1),[]);
  engine.state.events.push({...engine.state.events[0],id:2});engine.state.time=2;
  assert.deepEqual(events.collect(engine.view(1),1),[]);
  events.reset(engine.view(1),1);engine.state.events.push({...engine.state.events[0],id:3,time:2});
  assert.deepEqual(events.collect(engine.view(1),1).map(e=>e.effect),['rifle']);
});
test('construction, technology, healing and low-power alerts follow player state',()=>{
  const engine=new Engine([{name:'A',ai:false},{name:'B',ai:false}]),events=new AudioEvents();
  const base=engine.base(1)!,building=engine.spawn('lumbermill',1,{x:base.x+230,y:base.y});
  building.construction=.5;events.reset(engine.view(1),1);
  building.construction=1;
  engine.state.events=[{id:1,unit:building.id,kind:'lumbermill',side:1,x:building.x,y:building.y,angle:0,time:0,type:'complete',audience:2}];
  engine.player(1).tech.push('weapons');
  engine.state.units=engine.state.units.filter(u=>u.kind!=='powerplant');engine.spawn('factory',1,{x:base.x+360,y:base.y});
  engine.state.events.push({...engine.state.events[0],id:2,type:'heal'});
  const cues=events.collect(engine.view(1),1);
  for(const voice of ['complete','research','lowPower'])assert.ok(cues.some(e=>e.voice===voice));
  assert.ok(cues.some(e=>e.effect==='heal'));assert.deepEqual(events.collect(engine.view(1),1),[]);
});
