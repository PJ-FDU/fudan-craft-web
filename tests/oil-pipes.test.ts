import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3,MeshStandardMaterial } from 'three';
import { oilPipeLayout,OIL_PIPE_HEIGHT,OIL_PIPE_RADIUS } from '../src/game/oil.js';
import { oilPipeModel } from '../src/game/oil-pipe-model.js';
import { gridSize,indexAt,TILE } from '../src/game/grid.js';
import { MAPS } from '../src/game/maps.js';
import { getWorld } from '../src/game/world.js';
import { Engine } from '../src/game/engine.js';

test('pipelines bend on open ground and route around terrain without crossing blocked cells',()=>{
  const size=32,land=new Uint8Array(size*size);
  for(let y=7;y<25;y++)land[y*size+16]=1;
  const well={x:10.5*TILE,y:16.5*TILE},refinery={x:22.5*TILE,y:16.5*TILE};
  const layout=oilPipeLayout(well,refinery,land);
  assert.ok(layout.sections.length);
  assert.ok(layout.points.some(p=>Math.abs(p.y-well.y)>200),'route must pass a wall end');
  for(const {a,b,length} of layout.sections)for(let i=0;i<=Math.ceil(length/4);i++){
    const t=i/Math.ceil(length/4),p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    assert.equal(land[indexAt(p,size)],0);
  }
  const open=oilPipeLayout(well,refinery,new Uint8Array(size*size));
  assert.ok(open.points.some(p=>Math.abs(p.y-well.y)>20),'open routes still have deliberate elbows');
  assert.equal(oilPipeLayout(well,refinery,land),layout,'stationary pipes reuse the cached route');
  assert.deepEqual(oilPipeLayout(well,well,land),{points:[],sections:[]});
});

test('starting wells on every map have low pipelines to valid refinery sites',()=>{
  const material=new MeshStandardMaterial(),materials={paint:material,steel:material,seal:material,saddle:material,footing:material,valve:material};
  assert.ok(OIL_PIPE_HEIGHT+OIL_PIPE_RADIUS<=2);
  for(const {id,maxPlayers} of MAPS){
    const engine=new Engine(Array.from({length:maxPlayers},()=>({name:'P',ai:false})),'normal',id);
    const world=getWorld(id),size=gridSize(world.land);
    for(const base of world.bases){
      const well=world.deposits!.find(n=>n.kind==='oil'&&n.startSide===base.side)!;
      const refinery=engine.findBuildSpot(base.side,'refinery',well,engine.visible.get(base.side))!;
      assert.ok(refinery);
      const layout=oilPipeLayout(well,refinery,world.land);
      assert.ok(layout.sections.length,`${id}: home ${base.side}`);
      for(const {a,b,length} of layout.sections)for(let i=0;i<=Math.ceil(length/4);i++){
        const t=i/Math.ceil(length/4);
        assert.equal(world.land[indexAt({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},size)],0,`${id}: pipe crosses terrain`);
      }
      const model=oilPipeModel(well,refinery,materials,world.land);
      assert.ok(new Box3().setFromObject(model).max.y<=4.2,'valves and joints remain close to the ground');
      for(const part of model.children)(part as import('three').Mesh).geometry.dispose();
    }
  }
  material.dispose();
});
