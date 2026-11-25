import { covered, maxShield, needsCoverage } from './races.js';
import { STATS,TECHS,RESOURCE_INFO,isMobile,weaponsApplies,type Player,type ViewState,type VisibleUnit,type Tech,type MobileKind } from './types.js';
import { isOutpostMap } from './outposts.js';
import { powerFor } from './engine.js';
import { hasRefinery, oilNodeAt, OIL_PER_SECOND } from './oil.js';
import { BALANCE } from './balance.js';

export interface SelectionInfo {
  title:string;status:string;health:number;maxHealth:number;
  stats:{label:string;value:string}[];
  progress?:{label:string;value:number;status:string};
}

/** All center-panel progress comes from the current authoritative snapshot. */
export function selectionInfo(selected:VisibleUnit[],view:ViewState,player:Player):SelectionInfo|null {
  if(!selected.length)return null;
  const health=selected.reduce((sum,u)=>sum+u.hp,0),maxHealth=selected.reduce((sum,u)=>sum+u.maxHp,0);
  if(selected.length>1){
    const counts=new Map<string,number>();for(const u of selected)counts.set(STATS[u.kind].name,(counts.get(STATS[u.kind].name)??0)+1);
    return {title:`已选择 ${selected.length} 个单位`,status:'点击头像单选 · Shift 点击移出编队',health,maxHealth,stats:[...counts].map(([label,n])=>({label,value:`${n}`}))};
  }
  const u=selected[0],s=STATS[u.kind];
  const status={idle:'等待指令',move:'正在移动',attack:'正在交战',assault:'攻击移动',hold:'原地驻守',gather:u.returning?'返回交付':'正在采集',build:'建造任务',repair:'维修任务'}[u.order];
  const info:SelectionInfo={title:s.name,status:u.waitingForGold?'金矿已枯竭 · 等待指派':isMobile(u)?status:'建筑已就绪',health,maxHealth,stats:[]};
  if(s.damage)info.stats.push({label:'攻击',value:`${Math.round(s.damage*(weaponsApplies(u,player)?1.2:1)*10)/10}`},{label:'射程',value:`${s.range}`});
  if(u.kind==='worker')info.stats.push({label:'载货',value:`${Math.floor(u.cargo)} / ${player.tech.includes('logistics')?150:100}${u.cargoKind?' '+RESOURCE_INFO[u.cargoKind].name:''}`});
  else if(isMobile(u))info.stats.push({label:'移速',value:`${s.speed}`});
  else info.stats.push({label:s.power<0?'供电':'用电',value:`${Math.abs(s.power)}`});
  if(maxShield(u))info.stats.push({label:'原生护盾',value:`${Math.ceil(u.shield??0)} / ${maxShield(u)}`});
  if(u.station)info.status={packing:'收拢中',mobile:'可迁移',deploying:'架设中'}[u.station.mode];
  if(needsCoverage(u.kind)&&!covered(u.side,u,view.units))info.status='失去覆盖 · 队列暂停';
  const building=u.construction<1?u:u.kind==='worker'&&u.order==='build'?view.units.find(b=>b.id===u.target&&b.construction<1):undefined;
  if(building){
    const builders=view.units.filter(w=>w.kind==='worker'&&w.order==='build'&&w.target===building.id);
    const working=builders.filter(w=>w.activity==='build').length;
    info.status=u.id===building.id?'建筑施工中':`正在建造${STATS[building.kind].name}`;
    info.progress={label:`建造${STATS[building.kind].name}`,value:building.construction,status:needsCoverage(building.kind)&&!covered(building.side,building,view.units)?'失去覆盖 · 施工暂停':building.launched?'自动构筑中':working?`施工中 · 还需约 ${Math.ceil((1-building.construction)*STATS[building.kind].build/working)} 秒`:builders.length?'工程车正在就位':'等待工程车续建'};
  }else if(u.order==='repair'||!isMobile(u)&&view.units.some(w=>w.order==='repair'&&w.target===u.id)){
    const target=u.order==='repair'?view.units.find(b=>b.id===u.target):u;
    if(target){
      const assigned=view.units.filter(w=>w.order==='repair'&&w.target===target.id);
      const working=assigned.filter(w=>w.activity==='repair').length;
      info.status=u.order==='repair'?`正在维修${STATS[target.kind].name}`:'建筑维修中';
      const rate=BALANCE.repairHpPerSecond*BALANCE.repairWorkerWeights.slice(0,working).reduce((sum,n)=>sum+n,0);
      info.progress={label:`维修${STATS[target.kind].name}`,value:target.hp/target.maxHp,status:rate?`维修中 · 还需约 ${Math.ceil((target.maxHp-target.hp)/rate)} 秒`:assigned.some(w=>w.path.length)?'工程车正在就位':'维修等待资源或作业位置'};
    }
  }else if(u.kind==='oilwell'){
    const node=oilNodeAt(u,view.nodes),refinery=hasRefinery(u.side,view.units);
    info.status=!node?.amount?'油点已枯竭':refinery?'自动采油中':'需要石油精炼厂';
    info.stats.push({label:'剩余石油',value:String(Math.ceil(node?.amount??0))},
      {label:'产量',value:`${node?.amount&&refinery?OIL_PER_SECOND:0} / 秒`});
    if(node?.amount&&refinery&&view.oilWells&&isOutpostMap(view.mapId)){
      const seconds=Math.ceil(node.amount/OIL_PER_SECOND);
      info.stats.push({label:'预计枯竭',value:`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`});
    }
  }else if(!isMobile(u)){
    const task=player.queue.find(q=>q.producer===u.id);
    if(task){const active=u.kind==='base'||powerFor(player.side,view.units).active;
      info.status=active?task.research?'正在研究':'正在生产':'缺电暂停';
      info.progress={label:(task.research?'研究':'训练')+(task.research?TECHS[task.kind as Tech].name:STATS[task.kind as MobileKind].name),value:1-task.remaining/task.duration,status:active?`剩余 ${Math.ceil(task.remaining)} 秒`:'电力不足 · 进度已暂停'};
    }
  }
  return info;
}
