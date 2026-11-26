import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createBlankMap } from '../src/game/custom-maps.js';
import { createMapSnapshot, type MapSnapshot } from '../src/game/map-versions.js';

const port=3190;
type Message={type:string;[key:string]:any};
class Peer {
  ws:WebSocket;
  messages:Message[]=[];
  constructor(){this.ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);this.ws.on('message',raw=>this.messages.push(JSON.parse(raw.toString())));}
  async open(){await new Promise<void>((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject);});return this;}
  send(m:unknown){this.ws.send(JSON.stringify(m));}
  ready(snapshot:MapSnapshot){this.send({type:'map-ready',mapId:snapshot.version.mapId,contentHash:snapshot.version.contentHash});}
  async next(type:string,predicate=(m:Message)=>true):Promise<Message>{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){
      const index=this.messages.findIndex(m=>m.type===type&&predicate(m));
      if(index>=0)return this.messages.splice(index,1)[0];
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw Error(`Timeout waiting for ${type}`);
  }
}
async function startServer(store:string){
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),NODE_ENV:'production',ROOM_STORE_DIR:store},stdio:['ignore','pipe','pipe']});
  let log='';child.stderr!.on('data',data=>log+=data.toString());
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(`Server startup timeout: ${log}`)),10000);
    child.stdout!.on('data',data=>{if(data.toString().includes('FudanCraft →')){clearTimeout(timer);resolve();}});
    child.once('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${log}`));});
  });
  return child;
}
async function stopServer(child:ChildProcess){
  if(child.exitCode!==null)return;
  await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGTERM');});
}
test('WebSocket custom rooms lock content, sync large maps, isolate versions and restore frozen snapshots',async()=>{
  const store=await mkdtemp(join(tmpdir(),'fudancraft-map-network-')),peers:Peer[]=[];
  let child=await startServer(store);
  const doc=createBlankMap('服务器地图版本',96),first=createMapSnapshot(doc);
  doc.roads[48*96+48]=255;doc.name='服务器地图新版';const second=createMapSnapshot(doc);
  const peer=async()=>{const p=await new Peer().open();peers.push(p);return p;};
  try{
    const a=await peer(),b=await peer();
    a.send({type:'create',name:'A',mapId:first.version.mapId,mapSnapshot:first});
    const room=await a.next('lobby');assert.deepEqual(room.mapVersion,first.version);
    assert.equal(room.players[0].mapReady,false);
    b.send({type:'join',name:'B',code:room.code});const joined=await b.next('lobby');
    a.ready(first);a.send({type:'start'});assert.match((await a.next('error')).message,/同步/);
    b.send({type:'map-request',mapId:first.version.mapId,contentHash:first.version.contentHash});
    assert.deepEqual((await b.next('map-data')).snapshot,first);
    b.ready(first);await b.next('lobby',m=>m.players.every((p:any)=>p.mapReady));
    const c=await peer();
    c.send({type:'create',mode:'coop',mapId:second.version.mapId,mapSnapshot:second});
    const other=await c.next('lobby');c.ready(second);c.send({type:'start'});await c.next('started');
    assert.equal((await c.next('state')).state.mapHash,second.version.contentHash);
    b.send({type:'select-map',mapId:second.version.mapId,mapSnapshot:second});
    assert.match((await b.next('error')).message,/房主/);
    a.send({type:'select-map',mapId:second.version.mapId,mapSnapshot:second});
    await a.next('lobby',m=>m.mapVersion.contentHash===second.version.contentHash);
    a.ready(second);b.ready(first);a.send({type:'start'});
    assert.match((await a.next('error')).message,/同步/);
    b.ready(second);await b.next('lobby',m=>m.mapVersion.contentHash===second.version.contentHash&&m.players.every((p:any)=>p.mapReady));
    a.send({type:'start'});await a.next('started');await b.next('started');
    const state=(await a.next('state')).state;assert.equal(state.mapHash,second.version.contentHash);assert.equal(state.customMap,undefined);
    b.ws.close();await a.next('lobby',m=>m.players.some((p:any)=>!p.connected));
    const back=await peer();back.send({type:'resume',code:room.code,token:joined.token});
    await back.next('lobby');
    assert.equal(back.messages.some(m=>m.type==='started'||m.type==='state'),false);
    back.ready(first);back.send({type:'map-request',mapId:second.version.mapId,contentHash:second.version.contentHash});
    assert.deepEqual((await back.next('map-data')).snapshot,second);
    back.ready(second);await back.next('started');
    await stopServer(child);
    const saved=JSON.parse(await readFile(join(store,`${room.code}.json`),'utf8'));
    assert.deepEqual(saved.mapSnapshot,second);assert.equal(JSON.parse(saved.save).mapHash,second.version.contentHash);
    child=await startServer(store);
    const restored=await peer();restored.send({type:'resume',code:room.code,token:joined.token});
    const restoredLobby=await restored.next('lobby');assert.deepEqual(restoredLobby.mapVersion,second.version);
    assert.equal(restoredLobby.players.find((p:any)=>p.side===2).mapReady,false);
    restored.send({type:'map-request',mapId:second.version.mapId,contentHash:second.version.contentHash});
    assert.deepEqual((await restored.next('map-data')).snapshot,second);
    restored.ready(second);await restored.next('started');
    assert.equal((await restored.next('state')).state.mapHash,second.version.contentHash);
    const forged=structuredClone(first);forged.document.name='伪造数据';
    const invalid=await peer();invalid.send({type:'create',mapId:first.version.mapId,mapSnapshot:forged});
    assert.match((await invalid.next('error')).message,/指纹/);
    invalid.send({type:'command',padding:'x'.repeat(17000)});
    assert.equal((await invalid.next('error')).message,'无效消息');
    assert.notEqual(other.code,room.code);
  }finally{
    for(const p of peers)p.ws.terminate();
    await stopServer(child);await rm(store,{recursive:true,force:true});
  }
});
