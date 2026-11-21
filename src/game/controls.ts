import type { Renderer } from './renderer.js';
import type { Point } from './types.js';
import { wheelDelta } from './camera.js';
interface PointerState { start:Point; last:Point; button:number; touch:boolean; panning:boolean; boxing:boolean }
export const TOUCH_GESTURES={holdMs:420,tapMs:330,tapDistance:28,dragDistance:7} as const;
interface Options {
  blocked:()=>boolean;
  spaceHeld:()=>boolean;
  spaceDragged:()=>void;
  canBoxSelect:()=>boolean;
  click:(point:Point,button:number,shift:boolean,screen:Point,touch?:boolean)=>void;
  tapUnit?:(point:Point,screen:Point)=>number|null;
  multiTap?:(point:Point,screen:Point,count:2|3)=>void;
  selectBox:(start:Point,end:Point,shift:boolean)=>void;
  hover:(world:Point,screen:Point)=>void;
}
/** Pointer capture, explicit drag thresholds, and shared mouse/touch camera math. */
export class BattleControls {
  trackpad=false;
  private pointers=new Map<number,Point>();
  private primary:PointerState|null=null;
  private pinch:{distance:number;zoom:number;anchor:Point}|null=null;
  private suppressTap=false;
  private holdTimer:ReturnType<typeof setTimeout>|null=null;
  private lastTap:{unit:number;screen:Point;at:number;count:number}|null=null;
  constructor(private canvas:HTMLCanvasElement,private renderer:Renderer,private options:Options) {
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>this.down(e));
    canvas.addEventListener('pointermove',e=>this.move(e));
    canvas.addEventListener('pointerup',e=>this.up(e));
    canvas.addEventListener('pointercancel',()=>this.clear());
    canvas.addEventListener('lostpointercapture',e=>{if(this.pointers.has(e.pointerId))this.clear();});
    canvas.addEventListener('dblclick',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>this.wheel(e),{passive:false});
    window.addEventListener('blur',()=>this.clear());
  }
  private point(e:PointerEvent|WheelEvent):Point {const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
  private down(e:PointerEvent) {
    if(this.options.blocked())return;e.preventDefault();this.canvas.focus({preventScroll:true});
    const screen=this.point(e);this.renderer.camera.stopZoom();
    this.pointers.set(e.pointerId,screen);this.canvas.setPointerCapture(e.pointerId);
    this.cancelHold();
    if(this.pointers.size>=2){const[a,b]=[...this.pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};this.pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:this.renderer.zoom,anchor:this.renderer.screenToWorld(center)};this.primary=null;this.renderer.drag=null;this.lastTap=null;this.suppressTap=true;this.canvas.classList.remove('box-selecting');this.canvas.classList.add('camera-grabbing');return;}
    this.suppressTap=false;this.primary={start:screen,last:screen,button:e.button,touch:e.pointerType==='touch',panning:e.button===1||(e.button===0&&this.options.spaceHeld()),boxing:false};
    if(this.primary.touch&&this.options.canBoxSelect()){
      const primary=this.primary;
      this.holdTimer=setTimeout(()=>{
        this.holdTimer=null;if(this.primary!==primary||primary.panning||this.options.blocked()||!this.options.canBoxSelect())return;
        primary.boxing=true;this.lastTap=null;this.renderer.drag={start:primary.start,end:primary.last};this.canvas.classList.add('box-selecting');
        globalThis.navigator?.vibrate?.(12);
      },TOUCH_GESTURES.holdMs);
    }
    if(this.primary.panning){this.canvas.classList.add('camera-grabbing');if(this.options.spaceHeld())this.options.spaceDragged();}
    else if(e.button===0&&e.pointerType!=='touch'&&this.options.canBoxSelect())this.renderer.drag={start:screen,end:screen};
  }
  private move(e:PointerEvent) {
    const screen=this.point(e);if(this.pointers.has(e.pointerId))this.pointers.set(e.pointerId,screen);
    if(this.pinch&&this.pointers.size>=2){e.preventDefault();const[a,b]=[...this.pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));this.renderer.camera.setAnchoredZoom(this.pinch.zoom*distance/this.pinch.distance,center,this.pinch.anchor,true);return;}
    const p=this.primary;
    if(!p){this.options.hover(this.renderer.screenToWorld(screen),screen);return;}
    const moved=Math.hypot(screen.x-p.start.x,screen.y-p.start.y)>(p.touch?TOUCH_GESTURES.dragDistance:5);
    if(moved&&!p.boxing&&(p.touch||p.button===1||p.button===2||this.options.spaceHeld())){this.cancelHold();this.lastTap=null;p.panning=true;this.renderer.drag=null;this.canvas.classList.add('camera-grabbing');if(this.options.spaceHeld())this.options.spaceDragged();}
    if(p.panning)this.renderer.pan(p.last.x-screen.x,p.last.y-screen.y);
    else if(this.renderer.drag)this.renderer.drag.end=screen;
    p.last=screen;
  }
  private up(e:PointerEvent) {
    const p=this.primary,screen=this.point(e);this.cancelHold();this.pointers.delete(e.pointerId);this.renderer.drag=null;this.canvas.classList.remove('box-selecting');
    if(!this.pointers.size){this.pinch=null;this.canvas.classList.remove('camera-grabbing');}
    // A pinch never becomes a selection or a move order when the fingers lift.
    if(this.suppressTap){if(!this.pointers.size){this.suppressTap=false;this.primary=null;}return;}
    this.primary=null;if(!p||p.panning||this.options.blocked())return;
    const world=this.renderer.screenToWorld(screen),moved=Math.hypot(screen.x-p.start.x,screen.y-p.start.y)>5;
    if(p.boxing){if(moved&&this.options.canBoxSelect())this.options.selectBox(p.start,screen,e.shiftKey);return;}
    if(p.button===0&&moved&&!p.touch&&this.options.canBoxSelect())this.options.selectBox(p.start,screen,e.shiftKey);
    else{
      const unit=p.touch&&this.options.canBoxSelect()?this.options.tapUnit?.(world,screen):null;
      if(unit!=null){
        const at=Number.isFinite(e.timeStamp)?e.timeStamp:performance.now(),prior=this.lastTap;
        const count=prior&&prior.unit===unit&&at-prior.at<=TOUCH_GESTURES.tapMs&&Math.hypot(screen.x-prior.screen.x,screen.y-prior.screen.y)<=TOUCH_GESTURES.tapDistance?prior.count+1:1;
        this.lastTap=count>=3?null:{unit,screen,at,count};
        if(count===2||count===3){this.options.multiTap?.(world,screen,count);return;}
      }else this.lastTap=null;
      this.options.click(world,p.button,e.shiftKey,screen,p.touch);
    }
  }
  private wheel(e:WheelEvent) {
    if(this.options.blocked())return;e.preventDefault();if(this.primary||this.pinch)return;
    const d=wheelDelta(e,this.renderer.height),point=this.point(e);
    if(!e.ctrlKey&&(this.trackpad||e.shiftKey||e.altKey||Math.abs(d.x)>Math.abs(d.y)*1.2)){
      this.renderer.pan(e.shiftKey?(d.x||d.y):d.x,e.shiftKey?0:d.y);return;
    }
    this.renderer.zoomAt(Math.exp(-d.y*(e.ctrlKey?.006:.0019)),point);
  }
  private cancelHold(){if(this.holdTimer!==null)clearTimeout(this.holdTimer);this.holdTimer=null;}
  clear() {this.cancelHold();this.lastTap=null;this.pointers.clear();this.primary=null;this.pinch=null;this.suppressTap=false;this.renderer.drag=null;this.canvas.classList.remove('camera-grabbing','camera-grab','box-selecting');}
}
