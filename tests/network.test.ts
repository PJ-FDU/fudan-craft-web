import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { packFog,unpackFog } from '../src/game/protocol.js';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/game/engine.js';
import { latestMapRevision } from '../src/game/world.js';
const port=3128;
interface Message {type:string;[key:string]:any}
class Peer {
  ws:WebSocket;messages:Message[]=[];
  constructor(options?:WebSocket.ClientOptions){this.ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,options);this.ws.on('message',data=>this.messages.push(JSON.parse(data.toString())));}
  async open(){await new Promise<void>((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject);});return this;}
  send(m:unknown){this.ws.send(JSON.stringify(m));}
  async next(type:string,predicate=(m:Message)=>true):Promise<Message>{const start=Date.now();while(Date.now()-start<5000){const i=this.messages.findIndex(m=>m.type===type&&predicate(m));if(i>=0)return this.messages.splice(i,1)[0];await new Promise(r=>setTimeout(r,20));}throw Error(`Timeout waiting for ${type}`);}
}
test('fog bit packing round-trips without loss',()=>{const source=Array.from({length:16384},(_,i)=>i%7===0?1:0);const packed=packFog(source);assert.equal(packed.length,2048);assert.deepEqual(unpackFog(packed),source);});
test('WebSocket rooms: host authority, join, hidden state, validated orders and AI takeover',async()=>{
  const store=await mkdtemp(join(tmpdir(),'fudancraft-network-'));
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),NODE_ENV:'development',ROOM_STORE_DIR:store},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',data=>stderr+=data.toString());
  const peers:Peer[]=[];
  try{
    await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Server startup timed out')),10000);child.stdout.on('data',data=>{if(data.toString().includes('FudanCraft →')){clearTimeout(t);resolve();}});child.once('exit',code=>{clearTimeout(t);reject(Error(`Server exited: ${code}: ${stderr}`));});});
    const health=await fetch(`http://127.0.0.1:${port}/api/health`);assert.equal(health.status,200);
    const a=await new Peer().open();peers.push(a);a.send({type:'create',name:'Alpha'});const room=await a.next('lobby');assert.match(room.code,/^[A-F0-9]{6}$/);assert.equal(room.host,true);
    assert.equal(room.mapId,'lost-temple');
    a.send({type:'start'});assert.match((await a.next('error')).message,/至少/);
    const b=await new Peer().open();peers.push(b);b.send({type:'join',name:'Beta',code:room.code});const joined=await b.next('lobby');assert.equal(joined.side,2);assert.equal(joined.host,false);assert.equal(joined.players.length,2);
    b.send({type:'select-map',mapId:'twin-lakes'});assert.match((await b.next('error')).message,/房主/);
    a.send({type:'select-map',mapId:'unknown'});assert.match((await a.next('error')).message,/未知/);
    b.send({type:'start'});a.send({type:'start'});await a.next('started');await b.next('started');
    const av=(await a.next('state')).state,bv=(await b.next('state')).state;assert.ok(av.units.every((u:any)=>u.side===1));assert.ok(bv.units.every((u:any)=>u.side===2));assert.equal(typeof av.visible,'string');assert.equal(unpackFog(Buffer.from(av.visible,'base64')).length,512**2);assert.equal(av.players[1].credits,0);
    const rally={x:9248,y:13600};
    a.send({type:'command',command:{type:'rally',point:rally}});
    await a.next('state',m=>m.state.players[0].rally?.x===rally.x&&m.state.players[0].rally?.y===rally.y);
    const enemy=bv.units.find((u:any)=>u.kind==='soldier');a.send({type:'command',command:{type:'order',ids:[enemy.id],point:{x:2400,y:3400}}});
    const untouched=(await b.next('state')).state.units.find((u:any)=>u.id===enemy.id);assert.equal(untouched.order,'idle');
    a.send({type:'command',command:{type:'train',kind:'worker'}});a.send({type:'command',command:{type:'train',kind:'not-a-unit'}});a.send({type:'command',command:{type:'order',ids:[1],point:{x:null,y:12}}});
    const withQueue=await a.next('state',m=>m.state.players[0].queue.length===1);assert.equal(withQueue.state.players[0].queue[0].kind,'worker');assert.ok(withQueue.state.players[0].credits<3600);
    const opponentWorker=bv.units.find((u:any)=>u.kind==='worker');
    a.send({type:'command',command:{type:'build',kind:'factory',worker:opponentWorker.id,point:{x:2400,y:3600}}});
    assert.match((await a.next('error')).message,/己方/);
    a.send({type:'command',command:{type:'research',tech:'advanced'}});assert.match((await a.next('error')).message,/研究/);
    const ownWorker=av.units.find((u:any)=>u.kind==='worker'),node=av.nodes.find((n:any)=>n.kind==='wood');
    a.send({type:'command',command:{type:'repair',ids:[ownWorker.id],target:av.units.find((u:any)=>u.kind==='base').id}});
    assert.match((await a.next('error')).message,/生命值已满/);
    a.send({type:'command',command:{type:'repair',ids:[ownWorker.id],target:bv.units.find((u:any)=>u.kind==='base').id}});
    assert.match((await a.next('error')).message,/己方/);
    a.send({type:'command',command:{type:'gather',ids:[ownWorker.id],node:node.id}});
    // 点击密林内部会改为采集可抵达的林缘；网络回传应确认有效木材任务。
    await a.next('state',m=>m.state.units.some((u:any)=>u.id===ownWorker.id&&u.order==='gather'
      &&m.state.nodes.some((n:any)=>n.id===u.resource&&n.kind==='wood')));
    const queuedPoint={x:ownWorker.x+128,y:ownWorker.y};
    a.send({type:'command',command:{type:'order',ids:[ownWorker.id],point:queuedPoint,append:true}});
    const queued=await a.next('state',m=>m.state.units.some((u:any)=>u.id===ownWorker.id&&u.tasks?.length===1));
    assert.deepEqual(queued.state.units.find((u:any)=>u.id===ownWorker.id).tasks[0].point,queuedPoint);
    b.send({type:'command',command:{type:'cancel-task',id:ownWorker.id,index:0}});
    assert.match((await b.next('error')).message,/无效队列/);
    a.send({type:'command',command:{type:'cancel-task',id:ownWorker.id,index:0}});
    await a.next('state',m=>m.state.units.some((u:any)=>u.id===ownWorker.id&&!u.tasks?.length));
    a.send({type:'command',command:{type:'order',ids:[ownWorker.id],point:queuedPoint,append:true}});
    await a.next('state',m=>m.state.units.some((u:any)=>u.id===ownWorker.id&&u.tasks?.length===1));
    a.send({type:'command',command:{type:'stop',ids:[ownWorker.id]}});
    await a.next('state',m=>m.state.units.some((u:any)=>u.id===ownWorker.id&&u.order==='idle'&&!u.tasks?.length));
    assert.equal(av.players[1].wood,0);assert.equal(av.players[1].oil,0);assert.deepEqual(av.players[1].tech,[]);
    const c=await new Peer().open();peers.push(c);c.send({type:'join',code:room.code,name:'Late'});assert.match((await c.next('error')).message,/已开始/);
    c.send({type:'create',mapId:'unknown'});assert.match((await c.next('error')).message,/未知/);
    c.send({type:'create',name:'Other host',mapId:'ring-valley'});const other=await c.next('lobby');assert.equal(other.mapId,'ring-valley');
    const d=await new Peer().open();peers.push(d);d.send({type:'join',name:'Other guest',code:other.code});assert.equal((await d.next('lobby')).mapId,'ring-valley');
    for(const mapId of ['shattered-highlands','twin-lakes','echo-isles','twisted-meadows','turtle-rock','terenas-stand']){
      c.send({type:'select-map',mapId});
      assert.equal((await c.next('lobby',m=>m.mapId===mapId)).mapId,mapId);
      assert.equal((await d.next('lobby',m=>m.mapId===mapId)).mapId,mapId);
    }
    const e=await new Peer().open();peers.push(e);
    e.send({type:'join',code:other.code,name:'Third'});assert.match((await e.next('error')).message,/人数已满/);
    c.send({type:'select-map',mapId:'twisted-meadows'});await c.next('lobby',m=>m.mapId==='twisted-meadows');
    e.send({type:'join',code:other.code,name:'Third'});assert.equal((await e.next('lobby')).players.length,3);
    c.send({type:'select-map',mapId:'echo-isles'});assert.match((await c.next('error')).message,/最多支持 2/);
    assert.equal((await c.next('lobby',m=>m.players.length===3)).mapId,'twisted-meadows');
    e.send({type:'leave'});await e.next('left');await c.next('lobby',m=>m.players.length===2);
    c.send({type:'select-map',mapId:'terenas-stand'});await c.next('lobby',m=>m.mapId==='terenas-stand');
    c.send({type:'start'});assert.equal((await c.next('started')).mapId,'terenas-stand');
    assert.equal((await d.next('started')).mapId,'terenas-stand');
    const currentMap=(await c.next('state')).state;
    assert.equal(currentMap.mapId,'terenas-stand');assert.equal(currentMap.mapRevision,latestMapRevision('terenas-stand'));
    assert.ok(currentMap.nodes.some((n:any)=>n.tree!==undefined&&n.max===300));
    assert.equal(currentMap.players[0].oil,0);
    assert.equal((await d.next('state')).state.mapId,'terenas-stand');
    assert.equal((await a.next('state')).state.mapId,'lost-temple');
    c.send({type:'select-map',mapId:'lost-temple'});assert.match((await c.next('error')).message,/开始后/);
    // 房主离开后，剩余席位不连续；开局应重新编号而不能生成无效团队。
    e.send({type:'create',name:'Departing host'});const gap=await e.next('lobby',m=>m.code!==other.code&&m.players[0]?.name==='Departing host');
    const f=await new Peer().open();peers.push(f);f.send({type:'join',name:'New host',code:gap.code});await f.next('lobby');
    e.send({type:'leave'});await e.next('left');await f.next('lobby',m=>m.host&&m.players.length===1);
    e.send({type:'join',name:'Returning guest',code:gap.code});await e.next('lobby');
    f.send({type:'start'});await f.next('started');const gapState=(await f.next('state')).state;
    assert.deepEqual(gapState.players.map((p:any)=>p.team),[1,2]);
    b.ws.close();const notice=await a.next('notice');assert.match(notice.message,/AI/);await a.next('state',m=>m.state.players[1].ai===true);
  } finally {for(const p of peers)p.ws.terminate();child.kill('SIGTERM');await new Promise<void>(resolve=>{child.once('exit',()=>resolve());setTimeout(resolve,1000);});await rm(store,{recursive:true,force:true});}
});
test('public WebSocket admission limits connections and room creation while preserving joins and compression',async()=>{
  const store=await mkdtemp(join(tmpdir(),'fudancraft-admission-'));
  const origin='https://play.example.com';
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{
    ...process.env,PORT:String(port),ROOM_STORE_DIR:store,WS_ALLOWED_ORIGINS:origin,
    WS_TRUSTED_PROXIES:'127.0.0.1',WS_MAX_PER_IP:'2',WS_MAX_CONNECTIONS:'3',
    WS_ROOM_CREATES_PER_MINUTE:'1',WS_UNSEATED_TIMEOUT_MS:'2000',
  },stdio:['ignore','pipe','pipe']});
  const sockets:WebSocket[]=[];
  function options(address:string,requestOrigin=origin):WebSocket.ClientOptions{
    return {origin:requestOrigin,headers:{'X-Real-IP':address}};
  }
  async function open(address:string){
    const peer=new Peer(options(address));sockets.push(peer.ws);
    return peer.open();
  }
  async function denied(address:string,status:number,requestOrigin=origin){
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,options(address,requestOrigin));sockets.push(ws);
    await assert.rejects(new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);}),new RegExp(`Unexpected server response: ${status}`));
  }
  const closed=(ws:WebSocket)=>new Promise<number>(resolve=>ws.once('close',resolve));
  try{
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);
      child.stdout.on('data',data=>{if(data.toString().includes('FudanCraft →')){clearTimeout(timer);resolve();}});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Startup failed'));});
    });
    await denied('192.0.2.1',403,'https://another.example.com');
    const host=await open('192.0.2.1');
    host.send({type:'create'});
    const room=await host.next('lobby');
    const sharedAddress=await open('192.0.2.1');
    const idleClosed=closed(sharedAddress.ws);
    sharedAddress.send({type:'create'});
    assert.match((await sharedAddress.next('error')).message,/建房请求/);
    await denied('192.0.2.1',429);
    const guest=await open('192.0.2.2');
    guest.send({type:'join',code:room.code});
    await guest.next('lobby');
    await denied('192.0.2.3',503);
    assert.equal(guest.ws.extensions,'permessage-deflate');
    host.send({type:'start'});
    await guest.next('started');
    assert.ok((await guest.next('state')).state.units.length>0);
    assert.equal(await idleClosed,1006);
    const newcomer=await open('192.0.2.3');
    newcomer.send({type:'create'});
    assert.notEqual((await newcomer.next('lobby')).code,room.code);
    assert.equal(host.ws.readyState,WebSocket.OPEN);
  }finally{
    for(const ws of sockets)ws.terminate();
    const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    child.kill('SIGTERM');
    await stopped;
    await rm(store,{recursive:true,force:true});
  }
});
test('offline reservations expire and cannot be reclaimed with an old token',async()=>{
  const store=await mkdtemp(join(tmpdir(),'fudancraft-expiry-'));
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),ROOM_STORE_DIR:store,ROOM_RECONNECT_MS:'600'},stdio:['ignore','pipe','pipe']});
  const peers:Peer[]=[];
  try{
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child.stdout.on('data',data=>{if(data.toString().includes('FudanCraft →')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Startup failed'));});});
    const a=await new Peer().open(),b=await new Peer().open();peers.push(a,b);
    a.send({type:'create',name:'Host'});const room=await a.next('lobby');b.send({type:'join',name:'Guest',code:room.code});const guest=await b.next('lobby');
    b.ws.close();await a.next('lobby',m=>m.players.length===1);
    const c=await new Peer().open();peers.push(c);c.send({type:'resume',code:room.code,token:guest.token});await c.next('resume-error');
    c.send({type:'join',code:room.code,name:'Replacement'});assert.equal((await c.next('lobby')).players.length,2);
    a.ws.close();c.ws.close();await new Promise(resolve=>setTimeout(resolve,2000));
    const health=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json() as {rooms:number};assert.equal(health.rooms,0);
  }finally{for(const p of peers)p.ws.terminate();const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGTERM');await stopped;await rm(store,{recursive:true,force:true});}
});
test('co-op seats resume securely across restart and rematch retains the room',async()=>{
  const store=await mkdtemp(join(tmpdir(),'fudancraft-resume-')),peers:Peer[]=[];
  let child:ReturnType<typeof spawn>|undefined;
  async function boot(){
    child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),ROOM_STORE_DIR:store},stdio:['ignore','pipe','pipe']});
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);child!.stdout!.on('data',data=>{if(data.toString().includes('FudanCraft →')){clearTimeout(timer);resolve();}});child!.once('exit',()=>{clearTimeout(timer);reject(Error('Startup failed'));});});
  }
  async function shutdown(){if(child){const stopped=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));child.kill('SIGTERM');await stopped;child=undefined;}}
  async function peer(){const p=await new Peer().open();peers.push(p);return p;}
  try{
    await boot();
    const a=await peer();a.send({type:'create',mode:'coop',name:'Friend A'});const room=await a.next('lobby');
    const b=await peer();b.send({type:'join',code:room.code,name:'Friend B'});const guest=await b.next('lobby');assert.notEqual(guest.token,room.token);
    a.send({type:'start'});await a.next('started');await b.next('started');
    const state=(await a.next('state')).state;
    assert.equal(state.players.length,4);assert.deepEqual(state.players.map((p:any)=>p.team),[1,1,3,3]);
    assert.deepEqual(state.players.map((p:any)=>p.ai),[false,false,true,true]);
    assert.ok(state.units.some((u:any)=>u.side===2));assert.equal(state.players[1].stats,undefined);
    a.send({type:'rematch'});assert.match((await a.next('error')).message,/结束/);
    b.ws.close();await a.next('state',m=>m.state.players[1].ai);
    const wrong=await peer();wrong.send({type:'resume',code:room.code,token:'invalid'});await wrong.next('resume-error');
    const resumed=await peer();resumed.send({type:'resume',code:room.code,token:guest.token});
    assert.equal((await resumed.next('started')).side,2);
    const recovered=(await resumed.next('state')).state;assert.equal(recovered.players[1].ai,false);assert.ok(recovered.time>=state.time);
    await shutdown();
    // 以合法的结束战局快照覆盖测试房间，验证关服恢复和再战权限。
    const path=join(store,`${room.code}.json`),snapshot=JSON.parse(await readFile(path,'utf8'));
    const match=Engine.restore(snapshot.save);match.state.units=match.state.units.filter(u=>u.side<3);match.step(.05);
    assert.equal(match.state.winner,1);snapshot.save=match.save();await writeFile(path,JSON.stringify(snapshot));
    await boot();
    const host=await peer();host.send({type:'resume',code:room.code,token:room.token});await host.next('started');assert.equal((await host.next('state')).state.winner,1);
    const friend=await peer();friend.send({type:'resume',code:room.code,token:guest.token});await friend.next('started');
    friend.send({type:'rematch'});assert.match((await friend.next('error')).message,/房主/);
    host.send({type:'rematch'});const lobby=await host.next('lobby',m=>!m.started);assert.equal(lobby.code,room.code);assert.equal(lobby.mode,'coop');
    host.send({type:'start'});await host.next('started');const fresh=(await host.next('state',m=>m.state.winner===null)).state;assert.ok(fresh.time<1);
    friend.send({type:'leave'});await friend.next('left');
    const revoked=await peer();revoked.send({type:'resume',code:room.code,token:guest.token});await revoked.next('resume-error');
  }finally{for(const p of peers)p.ws.terminate();await shutdown();await rm(store,{recursive:true,force:true});}
});
