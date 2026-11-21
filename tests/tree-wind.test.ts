import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIND_PERIOD,windDisplacement,canopyBend } from '../src/game/tree-wind.js';
import { drawTree } from '../src/game/tree-renderer.js';
import { ATLAS_FRAMES } from '../src/game/atlas-frames.js';

test('wind stays subtle at every phase and moves continuously across the loop boundary',()=>{
  assert.ok(WIND_PERIOD>=10);
  for(let species=0;species<4;species++)for(let i=0;i<2000;i++){
    const t=i*.013,size=143,offset=windDisplacement(t,2200,3500,size,species);
    assert.ok(Math.abs(offset)<=size*.012);
    assert.ok(Math.abs(offset-windDisplacement(t+1/60,2200,3500,size,species))<.03,'a rendered frame must not jump between silhouettes');
  }
  const start=windDisplacement(0,500,600,140,1),end=windDisplacement(WIND_PERIOD,500,600,140,1);
  assert.ok(Math.abs(start-end)<1e-10);
  assert.ok(Math.abs(windDisplacement(WIND_PERIOD-1e-5,500,600,140,1)-windDisplacement(WIND_PERIOD+1e-5,500,600,140,1))<1e-4);
});

test('roots and lower trunk remain stationary while crown bends gradually',()=>{
  for(const wind of [-2,-1,0,1,2]){
    for(const h of [-.1,0,.1,.25])assert.equal(canopyBend(h,wind),0);
    assert.equal(canopyBend(1,wind),wind);
    assert.ok(Math.abs(canopyBend(.5,wind))<=Math.abs(canopyBend(.75,wind)));
  }
  assert.ok(Math.abs(windDisplacement(3,500,500,100,1)-windDisplacement(3,510,500,100,1))<.03,'nearby trees share a breeze');
});

test('wind rendering keeps one source silhouette and leaves the root strip untransformed',()=>{
  const draws:number[][]=[],transforms:number[][]=[];
  const c={save(){},restore(){},translate(){},getTransform(){return {a:1,b:0,c:0,d:1,e:0,f:0};},setTransform(...n:number[]){transforms.push(n);},drawImage(_img:unknown,...n:number[]){draws.push(n);}} as unknown as CanvasRenderingContext2D;
  const images=new Map([['trees',{} as HTMLImageElement]]);
  for(let species=0;species<4;species++){
    const [sx,sy,sw,sh]=ATLAS_FRAMES.trees.frames[species*6];
    for(const time of [0,.2,3,6,11.99,12.01]){
      draws.length=0;transforms.length=0;drawTree(c,images,species,500,500,143,time);
      assert.ok(draws.length<=7);
      for(const [x,y,w,h] of draws){assert.equal(x,sx);assert.equal(w,sw);assert.ok(y>=sy&&y+h<=sy+sh+1e-9);}
      assert.deepEqual(transforms.at(-1),[1,0,0,1,0,0]);
    }
  }
  draws.length=0;transforms.length=0;drawTree(c,images,0,500,500,143,null);assert.equal(draws.length,1);assert.equal(transforms.length,0);
});
