export type PerformanceMode='auto'|'quality'|'power';
export const RENDER_PROFILES=[
  {name:'轻量',ratio:.75,shadow:512,shadowHz:10,gi:'off'},
  {name:'流畅',ratio:1,shadow:1024,shadowHz:15,gi:'off'},
  {name:'均衡',ratio:1.5,shadow:2048,shadowHz:20,gi:'balanced'},
  {name:'精细',ratio:2,shadow:4096,shadowHz:30,gi:'high'},
] as const;
/** 以完整动画帧间隔检测 CPU / GPU 压力，冷却与升档迟滞避免来回切档。 */
export class PerformanceController {
  mode:PerformanceMode='auto';
  tier:number;
  private start=0;private frames=0;private elapsed=0;private render=0;private changed=0;
  constructor(mobile=false){this.tier=mobile?1:2;}
  get profile(){return RENDER_PROFILES[this.mode==='quality'?3:this.mode==='power'?0:this.tier];}
  get fps(){return this.mode==='power'?30:60;}
  setMode(mode:PerformanceMode){this.mode=mode;this.reset();this.changed=0;}
  reset(){this.start=0;this.frames=0;this.elapsed=0;this.render=0;}
  sample(gap:number,render:number,now:number,live:boolean){
    if(!live||this.mode!=='auto'||gap<=0||gap>1000){this.reset();return false;}
    if(!this.start)this.start=now;
    this.frames++;this.elapsed+=gap;this.render+=render;
    if(now-this.start<3000||this.frames<30)return false;
    const average=this.elapsed/this.frames,cost=this.render/this.frames;
    this.reset();
    if((average>25||cost>18)&&this.tier>0&&now-this.changed>=6000){this.tier--;this.changed=now;return true;}
    if(average<18.5&&cost<12&&this.tier<3&&now-this.changed>=20000){this.tier++;this.changed=now;return true;}
    return false;
  }
}
