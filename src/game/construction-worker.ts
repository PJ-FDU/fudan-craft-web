import { isMobile, type Side, type Unit } from './types.js';

export const availableForConstruction=(unit:Unit)=>
  unit.kind==='worker'&&unit.hp>0&&unit.order!=='build'&&unit.order!=='repair'&&!unit.tasks?.length;

export function constructionWorker<T extends Unit>(units:readonly T[],side:Side,selected:ReadonlySet<number>):T|undefined{
  // 自动选中的施工车辆会保留选择状态，必须先排除忙碌车辆，再考虑选择偏好。
  const workers=units.filter(unit=>unit.side===side&&availableForConstruction(unit));
  return workers.find(unit=>selected.has(unit.id))
    ??workers.find(unit=>unit.order==='idle')
    ??workers.find(unit=>unit.order==='gather')
    ??workers[0];
}

export const unfinishedConstruction=(unit:Unit)=>
  !isMobile(unit)&&unit.hp>0&&unit.construction<1&&!unit.launched;

export function resumeConstruction<T extends Unit>(units:readonly T[],side:Side,selected:ReadonlySet<number>){
  // 只接手无人施工的建筑；星能已启动的自动构筑不需要再派车。
  const staffed=new Set(units.filter(unit=>unit.side===side&&unit.hp>0&&unit.kind==='worker').flatMap(unit=>[
    ...(unit.order==='build'?[unit.target]:[]),...(unit.tasks??[]).filter(t=>t.type==='resume-build').map(t=>'target'in t?t.target:null)]));
  const buildings=units.filter(unit=>unit.side===side&&unfinishedConstruction(unit)&&!staffed.has(unit.id));
  let building=buildings.find(unit=>selected.has(unit.id));
  let worker:T|undefined;
  if(building){
    const target=building;
    worker=constructionWorker([...units].sort((a,b)=>Math.hypot(a.x-target.x,a.y-target.y)-Math.hypot(b.x-target.x,b.y-target.y)),side,selected);
  }else{
    worker=units.find(unit=>unit.side===side&&selected.has(unit.id)&&availableForConstruction(unit));
    if(worker){
      const origin=worker;
      building=buildings.sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y))[0];
    }
  }
  return worker&&building?{worker,building}:undefined;
}
