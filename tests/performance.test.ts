import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceController } from '../src/game/performance.js';
test('sustained pressure reduces quality, cooling periods prevent rapid changes, and recovery is slower',()=>{
  const c=new PerformanceController();let now=100;
  const sample=(seconds:number,gap:number)=>{const end=now+seconds*1000;while(now<end){now+=gap;c.sample(gap,5,now,true);}};
  sample(10,40);assert.equal(c.tier,1);
  sample(10,40);assert.equal(c.tier,0);
  sample(10,16.67);assert.equal(c.tier,0);
  sample(15,16.67);assert.equal(c.tier,1);
  c.setMode('quality');sample(30,50);assert.equal(c.profile.name,'精细');
  c.setMode('power');assert.equal(c.fps,30);assert.equal(c.profile.gi,'off');
});
test('pause, background gaps and loading never trigger automatic quality downgrades',()=>{
  const c=new PerformanceController();for(let i=0;i<500;i++)c.sample(100,100,i*100,false);assert.equal(c.tier,2);
  for(let i=0;i<10;i++)c.sample(2000,2000,i*2000,true);assert.equal(c.tier,2);
});
