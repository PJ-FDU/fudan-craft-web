import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankMap, compileCustomWorld, deserializeCustomMap } from '../src/game/custom-maps.js';
import { createMapSnapshot, registerMapSnapshot, validateMapSnapshot, type MapSnapshot } from '../src/game/map-versions.js';
import { getWorld, registerCustomWorld, unregisterCustomWorld } from '../src/game/world.js';
import { Engine } from '../src/game/engine.js';
import { HostRoom, type RoomMessage } from '../src/network/host-room.js';
import { MapSynchronizer } from '../src/network/map-sync.js';
import { DataLink } from '../src/network/data-link.js';
import { FRAME_BYTES } from '../src/network/snapshot-codec.js';
import { cacheMapVersion, cachedMapVersion } from '../src/game/map-version-cache.js';
import { AudioDirector, type GameAudio } from '../src/game/audio.js';

function snapshots() {
  const doc=createBlankMap('版本测试',64);
  const first=createMapSnapshot(doc);
  doc.roads[32*64+32]=255;doc.name='版本测试新版';
  return {first,second:createMapSnapshot(doc)};
}
test('content versions are deterministic, detached, validated and isolated by hash',()=>{
  const {first,second}=snapshots();
  assert.notEqual(first.version.contentHash,second.version.contentHash);
  const reversed=Object.fromEntries(Object.entries(first.document).reverse());
  assert.equal(validateMapSnapshot({version:first.version,document:reversed}).version.contentHash,first.version.contentHash);
  const forged=structuredClone(first);forged.document.name='被篡改';
  assert.throws(()=>validateMapSnapshot(forged),/指纹/);
  const malformed=structuredClone(first);malformed.document.bases[0].x=NaN;
  assert.throws(()=>validateMapSnapshot(malformed),/数据无效/);
  const badSides=structuredClone(first);badSides.document.bases[1].side=4;
  assert.throws(()=>validateMapSnapshot(badSides));
  registerMapSnapshot(first);registerMapSnapshot(second);
  const a=getWorld(first.version.mapId,1,first.version.contentHash),b=getWorld(second.version.mapId,1,second.version.contentHash);
  assert.notEqual(a,b);assert.equal(a.roads[32*64+32],0);assert.equal(b.roads[32*64+32],255);
  const doc=deserializeCustomMap(first.document),frozen=createMapSnapshot(doc);
  doc.bases[0].x+=32;assert.notEqual(frozen.document.bases[0].x,doc.bases[0].x);
});
test('custom battle saves carry exact terrain and restore after draft deletion or update',()=>{
  const {first,second}=snapshots();
  registerCustomWorld(compileCustomWorld(deserializeCustomMap(first.document)));
  const engine=new Engine(undefined,'normal',first.version.mapId),save=engine.save();
  assert.equal(engine.state.mapHash,first.version.contentHash);
  assert.equal(engine.view(1).mapHash,first.version.contentHash);
  assert.equal('customMap' in engine.view(1),false);
  registerCustomWorld(compileCustomWorld(deserializeCustomMap(second.document)));
  unregisterCustomWorld(first.version.mapId);
  const restored=Engine.restore(save);
  assert.equal(restored.world.customName,first.version.name);
  assert.equal(restored.world.roads[32*64+32],0);
  const forged=JSON.parse(save);forged.customMap.document.name='伪造地图';
  assert.throws(()=>Engine.restore(JSON.stringify(forged)),/存档/);
  const missing=JSON.parse(save);delete missing.customMap;
  assert.throws(()=>Engine.restore(JSON.stringify(missing)),/存档/);
});
test('downloaded-map soundscape resolves terrain by locked hash without a local draft',()=>{
  const {first}=snapshots();registerMapSnapshot(first);unregisterCustomWorld(first.version.mapId);
  const engine=new Engine(undefined,'normal',first.version.mapId,1,first.version.contentHash);
  const audio={ready:false,reset(){},buildings(){},scene(){},ambient(){},voice(){},effect(){}};
  const director=new AudioDirector(audio as unknown as GameAudio);
  assert.doesNotThrow(()=>director.tick(engine.view(2),2,{x:1024,y:1024},'battle',1000));
});
test('P2P room freezes a version, serves exact data, resets readiness and gates reconnect',()=>{
  const {first,second}=snapshots(),output:{id:string;message:RoomMessage}[]=[];
  const host=new HostRoom('ROOM:host','host',(id,message)=>output.push({id,message}));
  host.connect('host');host.receive('host',{type:'create',mapId:first.version.mapId,mapSnapshot:first});
  host.connect('guest');host.receive('guest',{type:'join',code:'ROOM:host'});
  const ticket=output.filter(o=>o.id==='guest'&&o.message.type==='lobby').at(-1)!.message;
  const ready=(id:string,s=first)=>host.receive(id,{type:'map-ready',mapId:s.version.mapId,contentHash:s.version.contentHash});
  host.receive('host',{type:'start'});assert.equal(host.engine,null);
  ready('host');host.receive('host',{type:'start'});assert.equal(host.engine,null);
  host.receive('guest',{type:'map-request',mapId:first.version.mapId,contentHash:first.version.contentHash});
  assert.deepEqual(output.at(-1)!.message.snapshot,first);
  host.receive('guest',{type:'select-map',mapId:second.version.mapId,mapSnapshot:second});
  assert.match(String(output.at(-1)!.message.message),/房主/);
  ready('guest');host.receive('host',{type:'select-map',mapId:second.version.mapId,mapSnapshot:second});
  ready('host',second);ready('guest');host.receive('host',{type:'start'});assert.equal(host.engine,null);
  ready('guest',second);host.receive('host',{type:'start'});
  const engine=host.engine as Engine|null;assert.ok(engine);
  assert.equal(engine.state.mapHash,second.version.contentHash);
  registerMapSnapshot(first);assert.equal(engine.world.customName,second.version.name);
  host.disconnect('guest');host.connect('back');
  const offset=output.length;
  host.receive('back',{type:'resume',code:'ROOM:host',token:ticket.token});host.tick();
  assert.equal(output.slice(offset).some(o=>o.id==='back'&&['state','started'].includes(o.message.type)),false);
  assert.equal(engine.state.players[1].ai,true);
  ready('back',second);assert.equal(engine.state.players[1].ai,false);
  assert.ok(output.slice(offset).some(o=>o.id==='back'&&o.message.type==='started'));
});
test('an unchanged map selection keeps ready seats, and a new room can use a different version',()=>{
  const {first,second}=snapshots();
  const a=new HostRoom('a','h',()=>{}),b=new HostRoom('b','h',()=>{});
  for(const [room,snapshot] of [[a,first],[b,second]] as const){
    room.connect('h');room.receive('h',{type:'create',mapId:snapshot.version.mapId,mapSnapshot:snapshot,mode:'coop'});
    room.receive('h',{type:'map-ready',mapId:snapshot.version.mapId,contentHash:snapshot.version.contentHash});
    room.receive('h',{type:'select-map',mapId:snapshot.version.mapId,mapSnapshot:snapshot});
    room.receive('h',{type:'start'});assert.ok(room.engine);
  }
  assert.notEqual(a.engine!.world,b.engine!.world);
});
test('sync rejects old async cache completions, old transfers and forged data before ready',async()=>{
  const {first,second}=snapshots(),sent:Record<string,unknown>[]=[];
  let complete!:(s:MapSnapshot|null)=>void;
  const sync=new MapSynchronizer(m=>sent.push(m),()=>{},v=>v.contentHash===first.version.contentHash?new Promise(resolve=>complete=resolve):Promise.resolve(null),async()=>true);
  sync.select(first.version);sync.select(second.version);await Promise.resolve();
  complete(first);await Promise.resolve();
  assert.equal(sent.some(m=>m.type==='map-ready'),false);
  await sync.receive(first);assert.notEqual(sync.status,'ready');
  const forged=structuredClone(second);forged.document.name='被篡改';
  await sync.receive(forged);assert.equal(sync.status,'error');
  await sync.receive(second);assert.equal(sync.status,'ready');
  assert.deepEqual(sent.filter(m=>m.type==='map-ready').map(m=>m.contentHash),[second.version.contentHash]);
  sync.reset();
});
test('validated cache supports reuse and missing browser persistence still permits play',async()=>{
  const {first}=snapshots();
  const persisted=await cacheMapVersion(first);assert.equal(persisted,false);
  assert.deepEqual(await cachedMapVersion(first.version),first);
  const sent:Record<string,unknown>[]=[];
  const sync=new MapSynchronizer(m=>sent.push(m),()=>{});
  sync.select(first.version);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sync.status,'ready');assert.equal(sent[0].type,'map-ready');sync.reset();
});
class Channel {
  readyState='open';bufferedAmount=0;bufferedAmountLowThreshold=0;binaryType='arraybuffer';
  onmessage:((event:{data:string|ArrayBuffer})=>void)|null=null;
  onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;onbufferedamountlow:(()=>void)|null=null;
  sent:(string|ArrayBuffer)[]=[];
  send(data:string|ArrayBuffer){this.sent.push(data);}
  close(){this.readyState='closed';}
}
test('large maps traverse bounded P2P fragments in order while ordinary oversized commands fail',()=>{
  const {first}=snapshots(),source=new Channel(),destination=new Channel(),received:string[]=[];
  let failures=0;
  const sender=new DataLink(source as unknown as RTCDataChannel,()=>{},()=>failures++);
  const receiver=new DataLink(destination as unknown as RTCDataChannel,text=>received.push(text),()=>failures++);
  const text=JSON.stringify({type:'map-data',snapshot:first});
  assert.ok(text.length>FRAME_BYTES);sender.control(text);sender.control('{"type":"map-ready"}');
  assert.ok(source.sent.length>2);
  for(const frame of source.sent){if(frame instanceof ArrayBuffer)assert.ok(frame.byteLength<=FRAME_BYTES);destination.onmessage!({data:frame});}
  assert.deepEqual(received,[text,'{"type":"map-ready"}']);assert.equal(failures,0);
  sender.control(JSON.stringify({type:'command',padding:'x'.repeat(FRAME_BYTES)}));
  assert.equal(failures,1);receiver.close();
});
