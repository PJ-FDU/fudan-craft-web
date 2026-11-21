import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/game/engine.js';
import { selectionInfo } from '../src/game/selection-info.js';
import { STATS } from '../src/game/types.js';

function game(){const e=new Engine([{name:'A',ai:false},{name:'B',ai:false}]);e.player(1).oil=100;return e;}
test('center information follows construction when either the building or its worker is selected',()=>{
  const e=game(),worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!,site=e.findBuildSpot(1,'factory',e.base(1)!,e.visible.get(1))!;
  assert.equal(e.command(1,{type:'build',kind:'factory',point:site,worker:worker.id}),null);
  const building=e.state.units.find(u=>u.side===1&&u.kind==='factory')!;
  function selected(id:number){const v=e.view(1);return selectionInfo(v.units.filter(u=>u.id===id),v,e.player(1))!;}
  assert.equal(selected(building.id).progress?.value,building.construction);
  assert.equal(selected(worker.id).progress?.label,'建造战车工厂');
  assert.match(selected(worker.id).progress!.status,/就位/);
  for(let i=0;i<600&&building.construction<.3;i++)e.step();
  assert.ok(building.construction>=.3);assert.equal(selected(worker.id).progress?.value,selected(building.id).progress?.value);
  e.command(1,{type:'stop',ids:[worker.id]});assert.match(selected(building.id).progress!.status,/等待工程车/);
});
test('selected producer shows its own active task and power shortage without borrowing another queue',()=>{
  const e=game(),base=e.base(1)!,barracks=e.state.units.find(u=>u.side===1&&u.kind==='barracks')!;
  e.command(1,{type:'train',kind:'worker'});e.command(1,{type:'train',kind:'soldier'});e.step();
  const power=e.state.units.find(u=>u.side===1&&u.kind==='powerplant')!;power.construction=.5;e.spawn('factory',1,e.findBuildSpot(1,'factory',base)!);
  let v=e.view(1);const factoryInfo=selectionInfo(v.units.filter(u=>u.id===barracks.id),v,e.player(1))!;
  assert.equal(factoryInfo.progress?.label,'训练突击步兵');assert.match(factoryInfo.progress!.status,/电力不足/);
  const before=factoryInfo.progress!.value;for(let i=0;i<10;i++)e.step();v=e.view(1);
  assert.equal(selectionInfo(v.units.filter(u=>u.id===barracks.id),v,e.player(1))!.progress!.value,before);
  assert.match(selectionInfo(v.units.filter(u=>u.id===base.id),v,e.player(1))!.progress!.status,/剩余/);
});
test('selection totals use authoritative upgraded maximum HP and clear when nothing is selected',()=>{
  const e=game();e.player(1).tech.push('armor');const u=e.spawn('tank',1,e.freeSpawn(e.base(1)!));u.hp-=20;
  const v=e.view(1),selected=v.units.filter(v=>v.id===u.id),info=selectionInfo(selected,v,e.player(1))!;
  assert.equal(info.maxHealth,STATS.tank.hp*1.25);assert.equal(info.health,info.maxHealth-20);
  assert.equal(selectionInfo([],v,e.player(1)),null);
  const group=v.units.filter(u=>u.side===1&&u.kind==='soldier');assert.equal(selectionInfo(group,v,e.player(1))!.stats[0].value,'2');
});
