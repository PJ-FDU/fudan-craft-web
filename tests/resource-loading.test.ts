import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResourceLoad,resourceBlob } from '../src/game/resource-loading.js';

test('stream progress reports actual bytes and shares concurrent downloads',async t=>{
  let stream:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(controller){stream=controller;}});
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(body,{headers:{'Content-Length':'6'}}));
  let observe:()=>void;
  const observed=new Promise<void>(resolve=>observe=resolve);
  const load=new ResourceLoad(progress=>{if(progress.loaded===3)observe();});
  const first=resourceBlob('/stream-test',load,6),second=resourceBlob('/stream-test',load,6);
  assert.equal(first,second);
  stream!.enqueue(new Uint8Array([1,2,3]));
  await observed;
  assert.deepEqual({...load.snapshot(),phase:undefined},{
    phase:undefined,loaded:3,total:6,completed:0,count:1,percent:50,
  });
  stream!.enqueue(new Uint8Array([4,5,6]));stream!.close();
  assert.equal((await first).size,6);
  assert.equal(load.snapshot().percent,100);
  assert.equal(load.snapshot().completed,1);
  assert.equal(fetch.mock.callCount(),1);
  const repeated=new ResourceLoad();
  await resourceBlob('/stream-test',repeated);
  assert.equal(repeated.snapshot().completed,1);
  assert.equal(fetch.mock.callCount(),1);
  load.dispose();repeated.dispose();
});

test('failed downloads can retry without retaining rejected promises',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>++calls===1?new Response(null,{status:503}):new Response('ready'));
  const load=new ResourceLoad();
  await assert.rejects(resourceBlob('/retry-test',load),/503/);
  assert.equal(load.snapshot().completed,0);
  assert.equal(await (await resourceBlob('/retry-test',load)).text(),'ready');
  assert.equal(calls,2);
  load.dispose();
});

test('unknown content length stays indeterminate until the stream ends',async t=>{
  let stream:ReadableStreamDefaultController<Uint8Array>;
  const body=new ReadableStream<Uint8Array>({start(controller){stream=controller;}});
  t.mock.method(globalThis,'fetch',async()=>new Response(body));
  let observe:()=>void;
  const observed=new Promise<void>(resolve=>observe=resolve);
  const load=new ResourceLoad(progress=>{if(progress.loaded===2)observe();});
  const pending=resourceBlob('/unknown-size-test',load);
  stream!.enqueue(new Uint8Array([1,2]));await observed;
  assert.equal(load.snapshot().percent,null);
  stream!.close();await pending;
  assert.equal(load.snapshot().percent,100);
  load.dispose();
});
