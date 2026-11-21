import type { Point } from './types.js';
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
/** Camera coordinates are world pixels; drag and zoom anchors are viewport pixels. */
export class Camera {
  x=2256; y=3600; zoom=.85; targetZoom=.85; width=1; height=1;
  yaw=0;
  tilt=1;
  private edgePadding=0;
  private anchor: { screen: Point; world: Point } | null=null;
  constructor(public world=4096) {}
  private get groundSpan() {
    const c=Math.abs(Math.cos(this.yaw)),s=Math.abs(Math.sin(this.yaw)),h=this.height/this.tilt;
    return {x:c*this.width+s*h,y:s*this.width+c*h};
  }
  get minZoom() { const span=this.groundSpan;return Math.max(.28,span.x/this.world,span.y/this.world); }
  get maxZoom() { return Math.max(2.4,this.minZoom); }
  resize(width:number,height:number) {
    this.width=Math.max(1,width);this.height=Math.max(1,height);
    this.zoom=clamp(this.zoom,this.minZoom,this.maxZoom);this.targetZoom=clamp(this.targetZoom,this.minZoom,this.maxZoom);this.anchor=null;this.clamp();
  }
  orient(yaw:number,tilt:number,edgePadding=0) {
    this.yaw=yaw;this.tilt=tilt;this.edgePadding=edgePadding;this.resize(this.width,this.height);
  }
  private screenOffset(x:number,y:number):Point {
    const c=Math.cos(this.yaw),s=Math.sin(this.yaw);
    return {x:(x*c-y/this.tilt*s)/this.zoom,y:(x*s+y/this.tilt*c)/this.zoom};
  }
  screenToWorld(p:Point):Point {
    const offset=this.screenOffset(p.x-this.width/2,p.y-this.height/2);
    return {x:this.x+offset.x,y:this.y+offset.y};
  }
  worldToScreen(p:Point,elevation=0):Point {
    const x=p.x-this.x,y=p.y-this.y,c=Math.cos(this.yaw),s=Math.sin(this.yaw);
    return {x:(x*c+y*s)*this.zoom+this.width/2,
      y:((y*c-x*s)*this.tilt-elevation*Math.sqrt(1-this.tilt**2))*this.zoom+this.height/2};
  }
  get corners() {
    return [{x:0,y:0},{x:this.width,y:0},{x:this.width,y:this.height},{x:0,y:this.height}].map(p=>this.screenToWorld(p));
  }
  stopZoom(){this.targetZoom=this.zoom;this.anchor=null;}
  focus(p:Point) {this.x=p.x;this.y=p.y;this.anchor=null;this.clamp();}
  panScreen(dx:number,dy:number) {
    if(!dx&&!dy)return;
    const offset=this.screenOffset(dx,dy);this.x+=offset.x;this.y+=offset.y;this.anchor=null;this.clamp();
  }
  setZoomAt(value:number,screen:Point,instant=false) {this.setAnchoredZoom(value,screen,this.screenToWorld(screen),instant);}
  setAnchoredZoom(value:number,screen:Point,world:Point,instant=false) {
    if(!Number.isFinite(value)||value<=0)return;
    this.targetZoom=clamp(value,this.minZoom,this.maxZoom);this.anchor={screen:{...screen},world:{...world}};
    if(instant){this.zoom=this.targetZoom;this.positionAnchor();this.anchor=null;}
  }
  zoomBy(factor:number,screen:Point,instant=false) {if(Number.isFinite(factor)&&factor>0)this.setZoomAt(this.targetZoom*factor,screen,instant);}
  private positionAnchor() {
    if(this.anchor){
      const offset=this.screenOffset(this.anchor.screen.x-this.width/2,this.anchor.screen.y-this.height/2);
      this.x=this.anchor.world.x-offset.x;this.y=this.anchor.world.y-offset.y;
    }this.clamp();
  }
  advance(dt:number) {
    const t=1-Math.exp(-18*Math.max(0,Math.min(.1,dt)));
    if(Math.abs(this.targetZoom-this.zoom)<.00005){this.zoom=this.targetZoom;this.positionAnchor();this.anchor=null;return;}
    this.zoom+=(this.targetZoom-this.zoom)*t;this.positionAnchor();
  }
  clamp() {
    const span=this.groundSpan;
    const hx=clamp(span.x/this.zoom/2-this.edgePadding,0,this.world/2);
    const hy=clamp(span.y/this.zoom/2-this.edgePadding,0,this.world/2);
    this.x=clamp(this.x,hx,this.world-hx);this.y=clamp(this.y,hy,this.world-hy);
  }
}
/** Clockwise screen-space compass: E, SE, S, SW, W, NW, N, NE. */
export function directionIndex(angle:number) {return Number.isFinite(angle)?((Math.round(angle/(Math.PI/4))%8)+8)%8:0;}
export function turnToward(current:number,target:number,maxStep:number) {
  const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));return current+clamp(delta,-maxStep,maxStep);
}
export function stableDirection(angle:number,previous:number) {
  const delta=Math.atan2(Math.sin(angle-previous*Math.PI/4),Math.cos(angle-previous*Math.PI/4));
  return Math.abs(delta)>Math.PI/8+Math.PI/40?directionIndex(angle):previous;
}
export function wheelDelta(e:{deltaX:number;deltaY:number;deltaMode:number},pageHeight:number) {
  const multiplier=e.deltaMode===1?16:e.deltaMode===2?pageHeight:1;
  return {x:clamp(e.deltaX*multiplier,-400,400),y:clamp(e.deltaY*multiplier,-400,400)};
}
