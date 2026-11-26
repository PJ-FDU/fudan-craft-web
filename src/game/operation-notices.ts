import { covered,needsCoverage } from './races.js';
import { isMobile,type Point,type Side,type ViewState } from './types.js';
import { indexAt,gridSize } from './grid.js';
import { operationText as text,type NoticeKind,type OperationPreferences } from './operation-preferences.js';

export interface OperationNotice extends Point {kind:NoticeKind;label:string;time:number;key:string}
/** 只从玩家可见快照检测事件，按类型节流，施工须持续停滞才提示。 */
export class OperationNotices {
  notices:OperationNotice[]=[];
  private cooldown=new Map<NoticeKind,number>();
  private progress=new Map<number,{value:number;since:number}>();
  private resources=new Map<number,number>();
  private eventId=0;
  private time=-1;
  reset(){this.notices=[];this.cooldown.clear();this.progress.clear();this.resources.clear();this.eventId=0;this.time=-1;}
  emit(kind:NoticeKind,label:string,point:Point,time:number,key:string,prefs:OperationPreferences,sound:(kind:NoticeKind)=>void){
    if(time-(this.cooldown.get(kind)??-Infinity)<12)return;
    this.cooldown.set(kind,time);
    if(prefs.notices[kind].visual){this.notices=this.notices.filter(n=>n.key!==key);this.notices.push({...point,kind,label,time,key});this.notices=this.notices.slice(-5);}
    if(prefs.notices[kind].sound)sound(kind);
  }
  tick(view:ViewState,side:Side,prefs:OperationPreferences,sound:(kind:NoticeKind)=>void){
    if(view.time<this.time)this.reset();
    const first=this.time<0;this.time=view.time;
    this.notices=this.notices.filter(n=>view.time-n.time<35);
    for(const event of view.events){
      if(!first&&event.id>this.eventId&&event.side===side&&event.kind==='base'&&event.type==='damage')
        this.emit('attack',text('基地正在遭受攻击','Base under attack'),event,view.time,'attack',prefs,sound);
      this.eventId=Math.max(this.eventId,event.id);
    }
    const seen=new Set<number>();
    for(const u of view.units.filter(u=>u.side===side&&!isMobile(u)&&u.construction<1&&!u.reservedBuild)){
      seen.add(u.id);const before=this.progress.get(u.id);
      if(!before||u.construction>before.value+1e-6){this.progress.set(u.id,{value:u.construction,since:view.time});continue;}
      if(view.time-before.since<8)continue;
      const worker=view.units.find(w=>w.side===side&&w.order==='build'&&w.target===u.id);
      const label=needsCoverage(u.kind)&&!covered(side,u,view.units)?text('施工暂停：失去能量覆盖','Construction paused: no energy coverage'):
        !worker&&!u.launched?text('未完工建筑：无人施工','Unfinished building: no builder'):
        worker&&(worker.blockedFor??0)>3?text('施工暂停：采集车无法抵达','Construction paused: builder cannot reach site'):
        text('施工进度已停滞','Construction has stalled');
      this.emit('construction',label,u,view.time,'build-'+u.id,prefs,sound);
    }
    for(const id of this.progress.keys())if(!seen.has(id))this.progress.delete(id);
    const visible=new Set<number>();
    for(const n of view.nodes){
      const cell=indexAt(n,gridSize(view.visible));
      if(!view.visible[cell])continue;
      visible.add(n.id);
      if(n.amount<=0&&(this.resources.get(n.id)??0)>0)
        this.emit('depleted',text('资源点已枯竭，请重新分配采集车','Resource depleted; reassign harvesters'),n,view.time,'resource-'+n.id,prefs,sound);
      this.resources.set(n.id,n.amount);
    }
    for(const id of this.resources.keys())if(!visible.has(id))this.resources.delete(id);
  }
}
