import type { SelectionInfo } from './selection-info.js';
import { isMobile,STATS,type Kind,type VisibleUnit } from './types.js';
import { GameSelect } from './dropdown.js';

const element=(id:string)=>document.getElementById(id)!;
interface Actions {attack:()=>void;repair:()=>void;resumeBuild:()=>void;stop:()=>void;all:()=>void;clear:()=>void;dispatch:()=>void;resize:()=>void;idle:()=>void;group:(key:string,save:boolean)=>void;filter:(kind:Kind|'army')=>void}
/** 触屏布局独立管理。生产按钮、小地图和详细读数复用同一 DOM，避免两套状态产生偏差。 */
export class TouchHUD {
  active=false;
  private query=matchMedia('(max-width:800px), (pointer:coarse)');
  private slots:{node:HTMLElement;marker:Comment;slot:HTMLElement}[];
  private saving=false;
  private filterKey='';
  private kindFilter=element('touch-kind') as GameSelect;
  constructor(private app:HTMLElement,actions:Actions){
    this.slots=[
      [document.querySelector<HTMLElement>('.minimap-wrap')!,element('touch-radar')],
      [document.querySelector<HTMLElement>('.production-panel')!,element('touch-production-slot')],
      [document.querySelector<HTMLElement>('.logistics-queue')!,element('touch-queue-slot')],
      [element('unit-details'),element('touch-details')],
    ].map(([node,slot])=>{const marker=document.createComment('desktop-hud-slot');node.before(marker);return {node,slot,marker};});
    for(const [id,action] of [['touch-attack',actions.attack],['touch-repair',actions.repair],['touch-stop',actions.stop],['touch-all',actions.all],['touch-clear',actions.clear],['touch-dispatch',actions.dispatch]] as const)element(id).onclick=action;
    element('touch-idle').onclick=actions.idle;
    element('touch-resume-build').onclick=actions.resumeBuild;
    element('touch-group-save').onclick=()=>{this.saving=!this.saving;element('touch-group-save').setAttribute('aria-pressed',String(this.saving));};
    for(const button of app.querySelectorAll<HTMLButtonElement>('[data-touch-group]'))button.onclick=()=>{
      actions.group(button.dataset.touchGroup!,this.saving);this.saving=false;element('touch-group-save').setAttribute('aria-pressed','false');
    };
    element('touch-filter-toggle').onclick=()=>{const open=element('touch-filters').hidden;element('touch-filters').hidden=!open;element('touch-filter-toggle').setAttribute('aria-expanded',String(open));};
    element('touch-no-workers').onclick=()=>actions.filter('army');
    this.kindFilter.setOptions([['','保留选中兵种…']]);
    this.kindFilter.onchange=()=>{if(this.kindFilter.value)actions.filter(this.kindFilter.value as Kind);this.kindFilter.value='';};
    element('touch-summary').onclick=()=>{
      const open=element('touch-details').hidden;this.showDetails(open);
    };
    element('touch-sheet-close').onclick=actions.dispatch;
    const sync=()=>{
      // 切换桌面与触屏时先收起调度，防止旧的展开状态遮住另一套布局。
      if(!element('touch-sheet').hidden)actions.dispatch();
      this.active=this.query.matches;app.classList.toggle('touch-ui',this.active);
      for(const {node,slot,marker} of this.slots){if(this.active)slot.append(node);else marker.after(node);}
      this.showDetails(false);actions.resize();
    };
    this.query.addEventListener('change',sync);sync();
  }
  showDetails(open:boolean){element('touch-details').hidden=!open;element('touch-summary').setAttribute('aria-expanded',String(open));}
  setDispatch(open:boolean){
    element('touch-sheet').hidden=!open;element('touch-dispatch').setAttribute('aria-expanded',String(open));
    element('touch-dispatch').classList.toggle('active',open);if(open)this.showDetails(false);
  }
  update(selected:VisibleUnit[],details:SelectionInfo|null,canRepair:boolean,queue:number,mode:string|null,idle=0,groups:ReadonlyMap<string,number[]>=new Map()){
    element('touch-idle-count').textContent=String(idle);element('touch-idle').toggleAttribute('disabled',!idle);
    element('touch-group-save').toggleAttribute('disabled',!selected.length);
    for(const button of this.app.querySelectorAll<HTMLButtonElement>('[data-touch-group]')){
      const count=groups.get(button.dataset.touchGroup!)?.length??0;
      button.classList.toggle('occupied',count>0);button.title=`编队 ${button.dataset.touchGroup} · ${count} 个单位`;
    }
    const kinds=[...new Set(selected.map(u=>u.kind))],key=kinds.join(',');
    if(key!==this.filterKey){this.filterKey=key;this.kindFilter.setOptions([['','保留选中兵种…'],...kinds.map(k=>[k,STATS[k].name] as const)]);}
    element('touch-no-workers').toggleAttribute('disabled',!selected.some(u=>u.kind==='worker'));
    const title=mode??details?.title??'单击选择 · 长按框选';
    element('touch-title').textContent=title;
    element('touch-status').textContent=mode?'点击目标 · × 取消':details?.progress?`${details.status} · ${Math.floor(details.progress.value*100)}%`:details?.status??'双击同类 · 三击全部';
    element('touch-health').style.width=`${details?Math.max(0,Math.min(100,details.health/details.maxHealth*100)):0}%`;
    element('touch-summary').classList.toggle('critical',!!details&&details.health/details.maxHealth<.3);
    element('touch-attack').toggleAttribute('disabled',!selected.some(isMobile));
    element('touch-stop').toggleAttribute('disabled',!selected.some(isMobile));
    element('touch-repair').toggleAttribute('disabled',!canRepair);
    element('touch-queue-count').hidden=!queue;element('touch-queue-count').textContent=String(queue);
    element('touch-clear').hidden=!selected.length&&!mode;
  }
}
