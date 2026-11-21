import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/game/engine.js';
import { mapInfo } from '../src/game/maps.js';
import { unpackFog } from '../src/game/protocol.js';
import { HostRoom,RECONNECT_MS,type RoomMessage } from '../src/network/host-room.js';
import { parseInvite,preferTcpRelays } from '../src/network/config.js';
import { encodeState,decodeState,fragmentState,StateAssembler,FRAME_BYTES,MAX_COMPRESSED_BYTES } from '../src/network/snapshot-codec.js';
import { DataLink } from '../src/network/data-link.js';

type Output={id:string;message:RoomMessage};
function room(mode='ffa'){
  const output:Output[]=[],code='AABBCCDDEEFF:host-123';
  const host=new HostRoom(code,'host-123',(id,message)=>output.push({id,message}));
  host.connect('host-123');host.receive('host-123',{type:'create',name:'房主',mode});
  const join=(id:string)=>{
    host.connect(id);host.receive(id,{type:'join',code,name:id});
    return (output.filter(o=>o.id===id&&o.message.type==='lobby').at(-1)??output.at(-1))!.message;
  };
  return {host,output,code,join};
}
test('Pages invites preserve the pinned host and reject incomplete or malformed identifiers',()=>{
  const code='aabbccddeeff:Case_Sensitive-host';
  assert.equal(parseInvite(code)?.code,'AABBCCDDEEFF:Case_Sensitive-host');
  assert.equal(parseInvite(`https://example.github.io/game/#room=${encodeURIComponent(code)}`)?.hostId,'Case_Sensitive-host');
  for(const invalid of ['AABBCCDDEEFF','AABBCC:host','AABBCCDDEEFF:host:guest','javascript:evil',null])assert.equal(parseInvite(invalid),null);
});
test('TCP relay selection preserves STUN, credentials and configuration, and retains UDP when TCP is unavailable',()=>{
  const config:RTCConfiguration={bundlePolicy:'max-bundle',iceServers:[
    {urls:['stun:example.test:3478','turn:example.test:3478?transport=udp','turn:example.test:80?transport=tcp'],username:'short-lived-user',credential:'short-lived-password'},
    {urls:'turn:udp-only.test:3478'},
    {urls:'turns:secure.test:443'},
  ]};
  const selected=preferTcpRelays(config);
  assert.equal(selected.bundlePolicy,'max-bundle');
  assert.deepEqual(selected.iceServers,[
    {...config.iceServers![0],urls:['stun:example.test:3478','turn:example.test:80?transport=tcp']},
    {...config.iceServers![2],urls:['turns:secure.test:443']},
  ]);
  assert.equal((config.iceServers![0].urls as string[]).length,3,'input is not mutated');
  const udp:RTCConfiguration={iceServers:[{urls:'turn:udp-only.test:3478'}]};
  assert.equal(preferTcpRelays(udp),udp);
  assert.equal(preferTcpRelays({}).iceServers,undefined);
});
test('browser authority: host permissions, filtered views, commands, takeover and token resume',()=>{
  const {host,join,output,code}=room(),ticket=join('guest');
  host.receive('guest',{type:'start'});assert.equal(host.engine===null,true);
  host.receive('guest',{type:'select-map',mapId:'echo-isles'});assert.equal(output.at(-1)?.message.type,'error');
  host.receive('host-123',{type:'start'});assert.ok(host.engine);
  const guestState=output.filter(o=>o.id==='guest'&&o.message.type==='state').at(-1)!.message.state as ReturnType<Engine['view']>;
  assert.equal(guestState.players.find(p=>p.side===1)?.credits,0);
  assert.ok(!guestState.units.some(u=>u.side===1));
  const enemy=host.engine.state.units.find(u=>u.side===1&&u.kind==='worker')!;
  const before={...enemy};
  host.receive('guest',{type:'command',command:{type:'order',ids:[enemy.id],point:{x:100,y:100}}});
  assert.equal(enemy.order,before.order);
  host.receive('guest',{type:'command',command:{type:'order',ids:[enemy.id],point:{x:Infinity,y:100}}});
  assert.equal(enemy.order,before.order);
  host.receive('guest',{type:'command',command:{type:'train',kind:'worker'}});
  assert.ok(host.engine.state.players.find(p=>p.side===2)!.queue.length);
  host.tick();assert.equal(host.engine.state.time,.05);
  const now=Date.now();host.disconnect('guest',false,now);
  assert.equal(host.engine.state.players.find(p=>p.side===2)?.ai,true);
  host.connect('guest-new',now+100);
  host.receive('guest-new',{type:'resume',code,token:'invalid'},now+100);assert.equal(output.at(-1)?.message.type,'resume-error');
  host.receive('guest-new',{type:'resume',code,token:ticket.token},now+100);
  assert.equal(host.engine.state.players.find(p=>p.side===2)?.ai,false);
  assert.ok(output.some(o=>o.id==='guest-new'&&o.message.type==='started'&&o.message.resumed===true));
  host.connect('guest-again',now+200);
  host.receive('guest-again',{type:'resume',code,token:ticket.token},now+200);
  assert.ok(output.some(o=>o.id==='guest-new'&&o.message.type==='replaced'));
  host.disconnect('guest-again',false,now+300);
  host.tick(now+RECONNECT_MS+301);host.connect('expired');
  host.receive('expired',{type:'resume',code,token:ticket.token},now+RECONNECT_MS+302);
  assert.equal(output.at(-1)?.message.type,'resume-error');
});
test('co-op map capacity, reserved slots, rematch and host token immunity',()=>{
  const {host,join,output,code}=room('coop');
  host.receive('host-123',{type:'select-map',mapId:'twisted-meadows'});
  const ticket=join('friend');
  join('overflow');assert.equal(output.at(-1)?.message.type,'error');
  host.disconnect('friend');
  host.receive('host-123',{type:'start'});assert.equal(host.engine===null,true);
  host.connect('friend-back');host.receive('friend-back',{type:'resume',code,token:ticket.token});
  const hostToken=output.find(o=>o.id==='host-123'&&o.message.type==='lobby')!.message.token;
  host.connect('thief');host.receive('thief',{type:'resume',code,token:hostToken});assert.equal(output.at(-1)?.message.type,'resume-error');
  host.receive('host-123',{type:'start'});assert.ok(host.engine);
  const players=host.engine.state.players;
  assert.equal(players.length,mapInfo('twisted-meadows').maxPlayers);
  assert.equal(players[0].team,players[1].team);assert.equal(players[2].ai,true);assert.notEqual(players[1].team,players[2].team);
  host.receive('host-123',{type:'rematch'});assert.ok(host.engine);
  host.engine.state.winner=1;
  host.receive('friend-back',{type:'rematch'});assert.ok(host.engine);
  host.receive('host-123',{type:'rematch'});assert.equal(host.engine===null,true);
  host.receive('host-123',{type:'start'});assert.equal(host.engine?.state.time,0);
  assert.equal(output.filter(o=>o.message.type==='started').at(-1)?.message.epoch,2);
});
test('real Engine snapshots compress, fragment and reconstruct fog and units without loss',async()=>{
  const engine=new Engine([{name:'a',ai:false},{name:'b',ai:false}]),view=engine.view(2);
  const encoded=await encodeState(view),frames=fragmentState(encoded,1),assembler=new StateAssembler();
  assert.ok(frames.every(frame=>frame.byteLength<=FRAME_BYTES));
  let complete:ReturnType<StateAssembler['push']>=null;
  for(const frame of frames)complete=assembler.push(frame);
  assert.ok(complete);
  const restored=JSON.parse(await decodeState(complete.bytes)).state;
  assert.deepEqual(restored.units,JSON.parse(JSON.stringify(view.units)));
  assert.deepEqual(unpackFog(Uint8Array.from(atob(restored.visible),(c:string)=>c.charCodeAt(0))),Array.from(view.visible));
  assert.equal(assembler.push(frames[0]),null);
  const bad=frames[0].slice(0);new DataView(bad).setUint32(12,MAX_COMPRESSED_BYTES+1);
  assert.throws(()=>new StateAssembler().push(bad));
  await assert.rejects(decodeState(new Uint8Array([1,2,3])));
  const large=crypto.getRandomValues(new Uint8Array(40_000)),parts=fragmentState(large,2),joined=new StateAssembler();
  assert.ok(parts.length>1);
  for(const part of parts.slice().reverse())complete=joined.push(part);
  assert.deepEqual(complete?.bytes,large);
  const lost=new StateAssembler(),old=fragmentState(large,3),fresh=fragmentState(large,4);
  assert.equal(lost.push(old[0]),null);
  for(const part of fresh.slice().reverse())complete=lost.push(part);
  assert.deepEqual(complete?.bytes,large);
  assert.equal(lost.push(old[1]),null);
  assert.equal(JSON.parse(await decodeState(await encodeState(view,7))).epoch,7);
});

class Channel {
  readyState='open';bufferedAmount=0;bufferedAmountLowThreshold=0;binaryType='arraybuffer';
  onmessage:((event:{data:string|ArrayBuffer})=>void)|null=null;
  onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;onbufferedamountlow:(()=>void)|null=null;
  sent:(string|ArrayBuffer)[]=[];
  send(data:string|ArrayBuffer){this.sent.push(data);}
  close(){this.readyState='closed';}
}
test('independent data channels keep controls responsive, coalesce snapshots and bound queues',async()=>{
  const channel=new Channel(),received:string[]=[],failures:string[]=[];
  const sender=new DataLink(channel as unknown as RTCDataChannel,()=>{},()=>failures.push('send'));
  const updates=new Channel(),incomingUpdates=new Channel();
  const snapshots=new DataLink(updates as unknown as RTCDataChannel,()=>{},()=>failures.push('snapshots'),'snapshot');
  const receiving=new Channel(),times:number[]=[],acks:number[]=[];
  const waiting=new Map<number,()=>void>();
  const waitForState=(time:number)=>{
    if(times.includes(time))return Promise.resolve();
    return new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(`state ${time} was not delivered`)),5000);
      waiting.set(time,()=>{clearTimeout(timer);waiting.delete(time);resolve();});
    });
  };
  const receiver=new DataLink(receiving as unknown as RTCDataChannel,text=>received.push(JSON.parse(text).type),()=>failures.push('receive'));
  const snapshotReceiver=new DataLink(incomingUpdates as unknown as RTCDataChannel,text=>{
    const message=JSON.parse(text);received.push(message.type);times.push(message.state.time);
    waiting.get(message.state.time)?.();
  },()=>failures.push('receive snapshot'),'snapshot',sequence=>acks.push(sequence));
  const engine=new Engine([{name:'a',ai:false},{name:'b',ai:false}]);
  updates.bufferedAmount=32*1024;
  snapshots.snapshot(await encodeState(engine.view(1)));
  engine.step(.05);snapshots.snapshot(await encodeState(engine.view(1)));
  sender.control(JSON.stringify({type:'started'}));
  assert.equal(channel.sent.length,1);
  updates.bufferedAmount=0;updates.onbufferedamountlow?.();
  for(const data of channel.sent)receiving.onmessage?.({data});
  for(const data of updates.sent)incomingUpdates.onmessage?.({data});
  receiving.onmessage?.({data:JSON.stringify({type:'lobby'})});
  await waitForState(.05);
  assert.deepEqual(received,['started','lobby','state']);
  assert.deepEqual(times,[.05]);
  assert.deepEqual(acks,[1]);
  assert.deepEqual(failures,[]);
  const sent=updates.sent.length;
  snapshots.snapshot(await encodeState({...engine.view(1),time:1}));
  snapshots.snapshot(await encodeState({...engine.view(1),time:1.5}));
  snapshots.ack(99);
  assert.equal(updates.sent.length,sent,'no overlap or stale ACK may release the next snapshot');
  snapshots.ack(acks[0]);
  for(const data of updates.sent.slice(sent))incomingUpdates.onmessage?.({data});
  await waitForState(1.5);
  assert.equal(times.at(-1),1.5,'ACK releases only the latest waiting state');
  snapshots.ack(acks.at(-1)!);
  const newer=await encodeState({...engine.view(1),time:2});
  for(const data of fragmentState(newer,20))incomingUpdates.onmessage?.({data});
  const latest=await encodeState({...engine.view(1),time:3});
  for(const data of fragmentState(latest,21))incomingUpdates.onmessage?.({data});
  await waitForState(3);
  assert.equal(times.at(-1),3);
  channel.bufferedAmount=64*1024;
  for(let i=0;i<33;i++)sender.control(JSON.stringify({type:'command'}));
  assert.deepEqual(failures,['send']);
  sender.close();receiver.close();snapshots.close();snapshotReceiver.close();
});
test('a new match clears waiting snapshots without overlapping an unacknowledged old frame',()=>{
  const channel=new Channel(),link=new DataLink(channel as unknown as RTCDataChannel,()=>{},()=>assert.fail('transport failed'),'snapshot');
  const bytes=new Uint8Array(40_000);
  link.snapshot(bytes);const count=channel.sent.length;
  link.snapshot(new Uint8Array([2]));link.resetSnapshots();link.ack(1);
  assert.equal(channel.sent.length,count);
  link.snapshot(new Uint8Array([3]));
  const frame=channel.sent.at(-1) as ArrayBuffer;
  assert.equal(new DataView(frame).getUint32(4),2);
  assert.equal(new Uint8Array(frame).at(-1),3);
  link.close();
});
