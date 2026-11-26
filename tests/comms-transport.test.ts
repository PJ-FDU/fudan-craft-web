import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2PConnection } from '../src/network/p2p-connection.js';

test('P2P delivers team map markers independently of heartbeat and preserves the pinned host boundary',()=>{
  // 不启动信令或真实媒体，只验证已认证通道上的消息分派。
  const connection=Object.create(P2PConnection.prototype) as P2PConnection;
  const output:unknown[]=[],remote={peer:{id:'host'}};
  Object.assign(connection,{role:'guest',hostId:'host',readyState:1,onmessage:(event:MessageEvent)=>output.push(JSON.parse(event.data))});
  const receive=(connection as unknown as {receive:(remote:unknown,text:string,slot:string)=>void}).receive.bind(connection);
  receive(remote,JSON.stringify({type:'ping'}),'control');
  assert.equal(output.length,0,'heartbeat is consumed');
  const marker={type:'map-ping',side:1,name:'A',kind:'support',x:100,y:200};
  receive(remote,JSON.stringify(marker),'control');
  assert.deepEqual(output,[marker],'map marker reaches the UI');
  receive({peer:{id:'other'}},JSON.stringify(marker),'control');
  receive(remote,JSON.stringify(marker),'snapshot');
  assert.equal(output.length,1,'foreign hosts and snapshot channels cannot deliver controls');
  const posted:unknown[]=[];
  Object.assign(connection,{role:'host',worker:{},post:(message:unknown)=>posted.push(message)});
  receive({peer:{id:'guest'},connected:true},JSON.stringify(marker),'control');
  assert.deepEqual(posted,[{type:'message',id:'guest',message:marker}]);
});
