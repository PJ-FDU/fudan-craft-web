import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera,directionIndex,stableDirection,turnToward,wheelDelta } from '../src/game/camera.js';
import { BattleControls,TOUCH_GESTURES } from '../src/game/controls.js';
import { DIRECTION_ROWS,DIRECTION_ATLASES } from '../src/game/art.js';
import { MOBILE_KINDS } from '../src/game/types.js';
import type { Renderer } from '../src/game/renderer.js';
const near=(a:number,b:number,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} ≠ ${b}`);
const pointNear=(a:{x:number;y:number},b:{x:number;y:number})=>{near(a.x,b.x);near(a.y,b.y);};
function camera(){const c=new Camera();c.resize(1000,700);c.focus({x:2000,y:2000});return c;}
test('pointer-anchored smooth zoom keeps the same world point under the cursor throughout',()=>{
  const c=camera(),p={x:725,y:210},world=c.screenToWorld(p);c.zoomBy(1.8,p);
  for(let n=0;n<180;n++){c.advance(1/60);pointNear(c.screenToWorld(p),world);}near(c.zoom,c.targetZoom);
});
test('world to screen is the inverse of screen to world after zoom, pan and resize',()=>{
  const c=camera();c.setZoomAt(1.7,{x:500,y:350},true);c.panScreen(137,-59);c.resize(800,600);const p={x:79,y:218};pointNear(c.worldToScreen(c.screenToWorld(p)),p);
});
test('camera clamping never exposes outside-map rectangles at any supported viewport size',()=>{
  for(const [w,h]of [[390,844],[876,943],[1920,1080],[5000,3000]]){const c=camera();c.resize(w,h);c.setZoomAt(.01,{x:w/2,y:h/2},true);c.focus({x:-1000,y:1e8});const a=c.screenToWorld({x:0,y:0}),b=c.screenToWorld({x:w,y:h});assert.ok(a.x>=-.001&&a.y>=-.001&&b.x<=4096.001&&b.y<=4096.001);}
});
test('pinch zoom preserves its world anchor while the gesture center moves',()=>{
  const c=camera(),world=c.screenToWorld({x:250,y:300});c.setAnchoredZoom(1.6,{x:310,y:370},world,true);pointNear(c.screenToWorld({x:310,y:370}),world);
});
test('rotated 3D camera keeps ground picking and zoom anchored, and projects altitude vertically',()=>{
  const c=camera(),screen={x:727,y:218};
  for(const yaw of [-.39,Math.PI/2,Math.PI,Math.PI*1.7]){
    c.orient(yaw,.62,760);
    const point=c.screenToWorld(screen);
    pointNear(c.worldToScreen(point),screen);
    c.setZoomAt(1.45,screen,true);
    pointNear(c.screenToWorld(screen),point);
    const raised=c.worldToScreen(point,57);
    near(raised.x,screen.x);
    near(screen.y-raised.y,57*Math.sqrt(1-.62**2)*c.zoom);
  }
});
test('3D camera keeps its center on the map while showing a border near a spawn',()=>{
  const c=camera();c.orient(-.39,.62,760);
  c.focus({x:2260,y:3796});pointNear(c,{x:2260,y:3796});
  c.focus({x:-500,y:5000});
  assert.ok(c.x>=0&&c.y<=4096);
  for(const p of c.corners)assert.ok(p.x>=-760.001&&p.y<=4856.001);
});
test('wheel units normalize pixels, lines and pages and ignore excessive deltas',()=>{
  assert.deepEqual(wheelDelta({deltaX:2,deltaY:3,deltaMode:1},700),{x:32,y:48});assert.deepEqual(wheelDelta({deltaX:0,deltaY:1,deltaMode:2},700),{x:0,y:400});assert.deepEqual(wheelDelta({deltaX:1,deltaY:-12,deltaMode:0},700),{x:1,y:-12});
});
test('all nine mobile units map to an eight-direction row and valid generated atlas',()=>{
  assert.equal(MOBILE_KINDS.length,9);const rows=new Set<string>();for(const kind of MOBILE_KINDS){const meta=DIRECTION_ROWS[kind];assert.ok(DIRECTION_ATLASES[meta.atlas]);assert.ok(meta.row>=0&&meta.row<3);rows.add(meta.atlas+meta.row);}assert.equal(rows.size,9);
});
test('all eight compass angles select distinct frames with correct negative-angle wrapping',()=>{
  for(let i=0;i<8;i++)assert.equal(directionIndex(i*Math.PI/4),i);assert.equal(directionIndex(-Math.PI/4),7);assert.equal(directionIndex(2*Math.PI),0);assert.equal(directionIndex(NaN),0);
});
test('turning uses the shortest arc and orientation hysteresis prevents boundary flickering',()=>{
  const rad=Math.PI/180;near(turnToward(179*rad,-179*rad,10*rad),181*rad);assert.equal(stableDirection(23*rad,0),0);assert.equal(stableDirection(26*rad,0),0);assert.equal(stableDirection(31*rad,0),1);assert.equal(stableDirection(24*rad,1),1);
});
function controlsHarness(){
  const listeners=new Map<string,(event:any)=>void>(),c=camera();let clicks=0,boxes=0,space=false,consumed=0;const taps:number[]=[];
  const canvas={addEventListener:(name:string,fn:(e:any)=>void)=>listeners.set(name,fn),getBoundingClientRect:()=>({left:0,top:0}),focus(){},setPointerCapture(){},classList:{add(){},remove(){}}};
  const renderer={camera:c,width:1000,height:700,drag:null as unknown,screenToWorld:(p:{x:number;y:number})=>c.screenToWorld(p),pan:(x:number,y:number)=>c.panScreen(x,y),zoomAt:(f:number,p:{x:number;y:number})=>c.zoomBy(f,p),get zoom(){return c.zoom;}};
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:{addEventListener(){}},configurable:true});
  const controller=new BattleControls(canvas as unknown as HTMLCanvasElement,renderer as unknown as Renderer,{blocked:()=>false,spaceHeld:()=>space,spaceDragged:()=>consumed++,canBoxSelect:()=>true,click:()=>clicks++,tapUnit:()=>7,multiTap:(_p,_s,count)=>taps.push(count),selectBox:()=>boxes++,hover(){}});
  if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');
  const fire=(name:string,x:number,y:number,extra:Record<string,unknown>={})=>listeners.get(name)!({clientX:x,clientY:y,pointerId:1,button:0,pointerType:'mouse',shiftKey:false,ctrlKey:false,altKey:false,preventDefault(){},...extra});
  return {camera:c,renderer,controller,fire,taps,setSpace:(v:boolean)=>space=v,get clicks(){return clicks;},get boxes(){return boxes;},get consumed(){return consumed;}};
}
test('right-button dragging pans without accidentally issuing a move order',()=>{
  const h=controlsHarness(),x=h.camera.x;h.fire('pointerdown',400,300,{button:2});h.fire('pointermove',520,350,{button:2});h.fire('pointerup',520,350,{button:2});near(h.camera.x,x-120/h.camera.zoom);assert.equal(h.clicks,0);assert.equal(h.boxes,0);
});
test('right-button clicking still issues exactly one command',()=>{
  const h=controlsHarness(),x=h.camera.x;h.fire('pointerdown',400,300,{button:2});h.fire('pointerup',401,301,{button:2});assert.equal(h.clicks,1);near(h.camera.x,x);
});
test('left dragging box-selects while space plus left dragging pans without selection',()=>{
  const h=controlsHarness();h.fire('pointerdown',200,200);h.fire('pointermove',400,400);h.fire('pointerup',400,400);assert.equal(h.boxes,1);assert.equal(h.clicks,0);
  h.setSpace(true);const x=h.camera.x;h.fire('pointerdown',400,300);h.fire('pointermove',500,300);h.fire('pointerup',500,300);assert.ok(h.camera.x<x);assert.ok(h.consumed);assert.equal(h.boxes,1);assert.equal(h.clicks,0);
});
test('touch panning and pinching do not emit stray orders when either finger lifts',()=>{
  const h=controlsHarness();h.fire('pointerdown',200,200,{pointerType:'touch'});h.fire('pointermove',230,220,{pointerType:'touch'});h.fire('pointerup',230,220,{pointerType:'touch'});assert.equal(h.clicks,0);
  h.fire('pointerdown',200,200,{pointerType:'touch',pointerId:1});h.fire('pointerdown',300,200,{pointerType:'touch',pointerId:2});const zoom=h.camera.zoom;h.fire('pointermove',400,200,{pointerType:'touch',pointerId:2});assert.ok(h.camera.zoom>zoom);h.fire('pointerup',400,200,{pointerType:'touch',pointerId:2});h.fire('pointerup',200,200,{pointerType:'touch',pointerId:1});assert.equal(h.clicks,0);assert.equal(h.boxes,0);
});
test('pointer cancellation clears selection and prevents subsequent accidental orders',()=>{
  const h=controlsHarness();h.fire('pointerdown',200,200);h.fire('pointermove',250,250);assert.ok(h.renderer.drag);h.fire('pointercancel',250,250);assert.equal(h.renderer.drag,null);h.fire('pointerup',250,250);assert.equal(h.boxes,0);assert.equal(h.clicks,0);
});
test('touch double and triple taps select groups without issuing extra single-tap commands',()=>{
  const h=controlsHarness();
  for(const timeStamp of [100,240,380]){h.fire('pointerdown',200,200,{pointerType:'touch'});h.fire('pointerup',200,200,{pointerType:'touch',timeStamp});}
  assert.equal(h.clicks,1);assert.deepEqual(h.taps,[2,3]);
  h.fire('pointerdown',200,200,{pointerType:'touch'});h.fire('pointerup',200,200,{pointerType:'touch',timeStamp:1100});assert.equal(h.clicks,2);
});
test('touch long press draws a selection box and never pans or issues a move',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=controlsHarness(),x=h.camera.x;
  h.fire('pointerdown',200,200,{pointerType:'touch'});t.mock.timers.tick(TOUCH_GESTURES.holdMs);assert.ok(h.renderer.drag);
  h.fire('pointermove',400,400,{pointerType:'touch'});h.fire('pointerup',400,400,{pointerType:'touch'});
  assert.equal(h.boxes,1);assert.equal(h.clicks,0);near(h.camera.x,x);
});
test('a second finger cancels an armed touch selection and cannot leave a delayed box',t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=controlsHarness();
  h.fire('pointerdown',200,200,{pointerType:'touch'});t.mock.timers.tick(TOUCH_GESTURES.holdMs);
  h.fire('pointerdown',300,200,{pointerType:'touch',pointerId:2});assert.equal(h.renderer.drag,null);
  h.fire('pointerup',300,200,{pointerType:'touch',pointerId:2});h.fire('pointerup',200,200,{pointerType:'touch'});
  t.mock.timers.tick(1000);assert.equal(h.boxes,0);assert.equal(h.clicks,0);assert.equal(h.renderer.drag,null);
});
