import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../src/game/engine.js';
import {STATS,RACES,type BuildingKind} from '../src/game/types.js';
import {validCommand} from '../src/game/command-validation.js';
import {bindingError,defaultPreferences,parsePreferences,productionBindings} from '../src/game/operation-preferences.js';
import {OperationNotices} from '../src/game/operation-notices.js';
import {indexAt} from '../src/game/pathfinding.js';

function field(){
  const e=new Engine([{name:'A',ai:false},{name:'B',ai:false}],'normal','lost-temple',1);
  const workers=e.state.units.filter(u=>u.side===1&&u.kind==='worker');
  e.command(1,{type:'stop',ids:workers.map(u=>u.id)});
  return {e,w:workers[0],p:e.player(1)};
}
function build(e:Engine,w:number,kind:BuildingKind,append=false){
  const at=e.findBuildSpot(1,kind,e.base(1)!)!;assert.ok(at);
  assert.equal(e.command(1,{type:'build',worker:w,kind,point:at,append}),null);
  return e.state.units.at(-1)!;
}
function tick(e:Engine,seconds:number){for(let i=0;i<seconds*20;i++)e.step(.05);}

test('two reserved buildings finish in order and resume the original harvest, including after restore',()=>{
  const {e,w}=field(),n=e.nearestNode(w,'gold')!;
  assert.equal(e.command(1,{type:'gather',ids:[w.id],node:n.id}),null);
  const first=build(e,w.id,'powerplant'),second=build(e,w.id,'powerplant',true);
  assert.equal(w.resumeResource,n.id);assert.equal(second.reservedBuild,true);assert.equal(w.target,first.id);
  const copy=Engine.restore(e.save()),cw=copy.state.units.find(u=>u.id===w.id)!;
  tick(copy,90);
  assert.equal(copy.state.units.find(u=>u.id===first.id)!.construction,1);
  assert.equal(copy.state.units.find(u=>u.id===second.id)!.construction,1);
  assert.equal(cw.order,'gather');assert.equal(cw.resource,n.id);assert.equal(cw.tasks,undefined);
});
test('cancel, stop and builder death release reserved costs exactly once; rejected commands retain tasks',()=>{
  for(const action of ['cancel','stop','death']){
    const {e,w,p}=field();build(e,w.id,'powerplant');const before=p.credits,second=build(e,w.id,'powerplant',true);
    assert.equal(e.command(1,{type:'gather',ids:[w.id],node:999999}),'资源点不在当前视野内或已枯竭');
    assert.equal(w.tasks?.length,1);
    if(action==='cancel'){
      assert.equal(e.command(1,{type:'cancel-task',id:w.id,index:0}),null);
      assert.ok(e.command(1,{type:'cancel-task',id:w.id,index:0}));
    }else if(action==='stop')e.command(1,{type:'stop',ids:[w.id]});
    else{w.hp=0;tick(e,.05);}
    assert.equal(p.credits,before);assert.ok(!e.state.units.some(u=>u.id===second.id));
    if(action==='stop'){tick(e,2);assert.equal(w.order,'idle');assert.equal(w.resumeResource,undefined);}
  }
});
test('queued movement, repair and gathering advance and are bounded at the command and save boundary',()=>{
  const {e,w}=field(),base=e.base(1)!;base.hp-=10;
  e.command(1,{type:'order',ids:[w.id],point:{x:w.x+32,y:w.y}});
  assert.equal(e.command(1,{type:'repair',ids:[w.id],target:base.id,append:true}),null);
  const node=e.nearestNode(w,'gold')!;
  e.command(1,{type:'gather',ids:[w.id],node:node.id,append:true});
  tick(e,50);assert.equal(base.hp,STATS.base.hp);assert.equal(w.order,'gather');
  for(let i=0;i<16;i++)assert.equal(e.command(1,{type:'order',ids:[w.id],point:w,append:true}),null);
  assert.match(e.command(1,{type:'order',ids:[w.id],point:w,append:true})!,/已满/);
  const snapshot=JSON.parse(e.save());snapshot.units.find((u:{id:number})=>u.id===w.id).tasks.push({type:'order',point:w});
  assert.throws(()=>Engine.restore(JSON.stringify(snapshot)));
  assert.equal(validCommand({type:'order',ids:[w.id],point:w,append:'yes'},e.extent),false);
  assert.equal(validCommand({type:'cancel-task',id:w.id,index:16},e.extent),false);
  assert.equal(validCommand({type:'assign-idle',resource:'oil'},e.extent),false);
});
test('a destroyed queued target is skipped and old saves remain compatible',()=>{
  const {e,w}=field();const first=build(e,w.id,'powerplant'),second=build(e,w.id,'powerplant',true);
  second.hp=0;tick(e,60);assert.equal(first.construction,1);assert.equal(w.tasks,undefined);
  const old=JSON.parse(e.save());for(const u of old.units){delete u.tasks;delete u.reservedBuild;delete u.resumeResource;}
  assert.ok(Engine.restore(JSON.stringify(old)));
});
test('hold starts appended work and reserved save records reject missing, duplicate or foreign owners',()=>{
  const {e,w}=field();
  e.command(1,{type:'hold',ids:[w.id]});
  assert.equal(e.command(1,{type:'order',ids:[w.id],point:{x:w.x+64,y:w.y},append:true}),null);
  assert.equal(w.order,'move');
  e.command(1,{type:'stop',ids:[w.id]});build(e,w.id,'powerplant');const second=build(e,w.id,'powerplant',true);
  const saved=e.save();assert.ok(Engine.restore(saved));
  for(const mutate of [
    (v:any)=>v.units.find((u:any)=>u.id===w.id).tasks=[],
    (v:any)=>v.units.find((u:any)=>u.id===w.id).tasks.push({type:'resume-build',target:second.id}),
    (v:any)=>v.units.find((u:any)=>u.id===second.id).side=2,
    (v:any)=>v.units[0]=null,
  ]){
    const snapshot=JSON.parse(saved);mutate(snapshot);assert.throws(()=>Engine.restore(JSON.stringify(snapshot)));
  }
});
test('depleted queued resources are skipped and subsequent movement completes',()=>{
  const {e,w}=field();
  build(e,w.id,'powerplant');const node=e.nearestNode(w,'gold')!;
  e.command(1,{type:'gather',ids:[w.id],node:node.id,append:true});
  e.command(1,{type:'order',ids:[w.id],point:{x:w.x+32,y:w.y},append:true});
  node.amount=0;tick(e,90);
  assert.equal(w.tasks,undefined);assert.equal(w.order,'idle');
});
test('automatic resource assignment uses only idle workers and visible resources',()=>{
  const {e,w}=field();e.command(1,{type:'order',ids:[w.id],point:{x:w.x+160,y:w.y}});
  assert.equal(e.command(1,{type:'assign-idle',resource:'gold'}),null);assert.equal(w.order,'move');
  for(const worker of e.state.units.filter(u=>u.side===1&&u.kind==='worker'&&u.id!==w.id)){
    assert.equal(worker.order,'gather');const node=e.state.nodes.find(n=>n.id===worker.resource)!;
    assert.ok(e.visible.get(1)![indexAt(node,e.size)]);assert.equal(node.kind,'gold');
  }
});
test('race and selected production building share valid training labels; preferences reject collisions and corrupt values',()=>{
  for(const race of RACES){
    const e=new Engine([{name:'A',ai:false,race},{name:'B',ai:false,race}]);
    const p=e.player(1),producer=e.state.units.find(u=>u.side===1&&u.kind!=='base'&&u.kind===({industrial:'barracks',brood:'hatchery',stellar:'resonator',relay:'assembly'} as const)[race])!;
    const mapping=productionBindings(p,e.state.units,new Set([producer.id]),defaultPreferences());
    assert.ok(Object.keys(mapping).some(k=>STATS[k as keyof typeof STATS].producer===producer.kind));
    assert.equal(mapping.tank,undefined);
    const worker=e.state.units.find(u=>u.side===1&&u.kind==='worker')!;
    assert.deepEqual(productionBindings(p,e.state.units,new Set([worker.id]),defaultPreferences()),productionBindings(p,e.state.units,new Set(),defaultPreferences()));
  }
  const prefs=defaultPreferences();assert.ok(bindingError(prefs.bindings,'idle','q'));assert.ok(bindingError(prefs.bindings,'idle','1'));
  assert.equal(bindingError(prefs.bindings,'idle','f4'),null);
  prefs.bindings.idle='f4';prefs.panSpeed=960;prefs.notices.attack.sound=false;
  assert.deepEqual(parsePreferences(prefs),prefs);
  assert.equal(parsePreferences({panSpeed:Infinity,zoomSensitivity:100,health:'yes'}).panSpeed,560);
});
test('construction and resource notices honor delay, visibility, channels and cooldowns',()=>{
  const {e,w}=field(),b=build(e,w.id,'powerplant');e.command(1,{type:'stop',ids:[w.id]});
  const notices=new OperationNotices(),prefs=defaultPreferences(),sounds:string[]=[];
  const notify=(kind:string)=>sounds.push(kind);
  notices.tick(e.view(1),1,prefs,notify);tick(e,9);notices.tick(e.view(1),1,prefs,notify);
  assert.equal(notices.notices[0]?.kind,'construction');assert.deepEqual(sounds,['construction']);
  notices.tick(e.view(1),1,prefs,notify);assert.equal(sounds.length,1);
  prefs.notices.depleted.sound=false;
  const view=e.view(1),node=view.nodes.find(n=>view.visible[indexAt(n,e.size)]&&n.amount>0)!;
  notices.tick(view,1,prefs,notify);node.amount=0;notices.tick(view,1,prefs,notify);
  assert.ok(notices.notices.some(n=>n.kind==='depleted'));assert.equal(sounds.length,1);
  assert.equal(b.construction,.01);
});
