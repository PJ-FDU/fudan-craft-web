import { ROSTERS,producerFor } from './races.js';
import { MOBILE_KINDS, isMobile, type Kind, type Player, type Unit } from './types.js';
import { getLanguage } from './locale.js';

export const operationText=(zh:string,en:string)=>getLanguage()==='en'?en:zh;
export const DEFAULT_BINDINGS={army:'f2',idle:'f3',pause:'p',attack:'a',repair:'j',stop:'x',hold:'h',rally:'g',resume:'n',
  train1:'q',train2:'e',train3:'r',train4:'d',train5:'s',train6:'w',train7:'k',train8:'m',train9:';',train10:"'",train11:'/',
  refinery:'i',oilwell:'o',lumbermill:'l'} as const;
export type Binding=keyof typeof DEFAULT_BINDINGS;
export type NoticeKind='attack'|'depleted'|'population'|'construction';
export interface OperationPreferences {
  animation:boolean;health:boolean;buildingNames:boolean;ranges:boolean;trackpad:boolean;continuousBuild:boolean;
  panSpeed:number;zoomSensitivity:number;reverseZoom:boolean;edgeScroll:boolean;
  bindings:Record<Binding,string>;notices:Record<NoticeKind,{sound:boolean;visual:boolean}>;
}
export const defaultPreferences=():OperationPreferences=>({animation:true,health:true,buildingNames:false,ranges:false,trackpad:false,continuousBuild:false,
  panSpeed:560,zoomSensitivity:1,reverseZoom:false,edgeScroll:false,bindings:{...DEFAULT_BINDINGS},
  notices:{attack:{sound:true,visual:true},depleted:{sound:true,visual:true},population:{sound:true,visual:true},construction:{sound:true,visual:true}}});
const KEY='fudancraft-operations-v1';
const reserved=new Set(['escape',' ','arrowup','arrowdown','arrowleft','arrowright','f','v','b','z','c','t','u','y','?','+','=','-','−',...Array.from({length:10},(_,i)=>String(i))]);
export const BINDING_NAMES:Record<Binding,[string,string]>={
  army:['选择全军','Select army'],idle:['轮选空闲采集车','Cycle idle harvesters'],pause:['暂停 / 继续','Pause / resume'],attack:['攻击移动','Attack move'],repair:['维修','Repair'],stop:['停止','Stop'],hold:['驻守','Hold'],rally:['设置集结点','Set rally point'],resume:['继续施工','Resume construction'],
  train1:['训练槽位 1','Training slot 1'],train2:['训练槽位 2','Training slot 2'],train3:['训练槽位 3','Training slot 3'],train4:['训练槽位 4','Training slot 4'],train5:['训练槽位 5','Training slot 5'],train6:['训练槽位 6','Training slot 6'],train7:['训练槽位 7','Training slot 7'],train8:['训练槽位 8','Training slot 8'],train9:['训练槽位 9','Training slot 9'],train10:['训练槽位 10','Training slot 10'],train11:['训练槽位 11','Training slot 11'],
  refinery:['建造精炼厂','Build refinery'],oilwell:['建造油井','Build oil well'],lumbermill:['建造木材厂','Build lumber mill'],
};
export const bindingName=(action:Binding)=>operationText(...BINDING_NAMES[action]);
export const supportedBinding=(key:string)=>!reserved.has(key)&&(/^[a-z;,'.\/\[\]\\`]$/.test(key)||/^f([2-9]|1[0-2])$/.test(key));
export const bindingOwner=(bindings:Record<Binding,string>,action:Binding,key:string)=>
  (Object.keys(bindings) as Binding[]).find(other=>other!==action&&bindings[other]===key);
/** 显式交换两个动作；始终保持一键一动作，存储解析无需容忍冲突。 */
export function assignBinding(bindings:Record<Binding,string>,action:Binding,key:string,swap=false){
  if(!supportedBinding(key))return false;
  const owner=bindingOwner(bindings,action,key);
  if(owner&&!swap)return false;
  if(owner)bindings[owner]=bindings[action];
  bindings[action]=key;return true;
}
export function bindingError(bindings:Record<Binding,string>,action:Binding,key:string){
  if(!supportedBinding(key))return operationText('此按键保留或不受支持','Reserved or unsupported key');
  const owner=bindingOwner(bindings,action,key);
  return owner?operationText('按键已被其他操作使用：','Key already assigned: ')+bindingName(owner):null;
}
export function parsePreferences(raw:unknown):OperationPreferences{
  const result=defaultPreferences();if(!raw||typeof raw!=='object')return result;
  const value=raw as Partial<OperationPreferences>;
  for(const k of ['animation','health','buildingNames','ranges','trackpad','continuousBuild','reverseZoom','edgeScroll'] as const)if(typeof value[k]==='boolean')result[k]=value[k];
  if(Number.isFinite(value.panSpeed)&&value.panSpeed!>=160&&value.panSpeed!<=1600)result.panSpeed=value.panSpeed!;
  if(Number.isFinite(value.zoomSensitivity)&&value.zoomSensitivity!>=.25&&value.zoomSensitivity!<=3)result.zoomSensitivity=value.zoomSensitivity!;
  if(value.bindings&&typeof value.bindings==='object'){
    const candidate={...result.bindings,...Object.fromEntries(Object.keys(DEFAULT_BINDINGS).map(k=>[k,value.bindings?.[k as Binding]??result.bindings[k as Binding]]))};
    if(Object.entries(candidate).every(([action,key])=>typeof key==='string'&&!bindingError(candidate,action as Binding,key)))result.bindings=candidate;
  }
  for(const k of Object.keys(result.notices) as NoticeKind[])for(const channel of ['sound','visual'] as const)
    if(typeof value.notices?.[k]?.[channel]==='boolean')result.notices[k][channel]=value.notices[k][channel];
  return result;
}
export function readPreferences(){try{return parsePreferences(JSON.parse(localStorage.getItem(KEY)??'null'));}catch{return defaultPreferences();}}
export function savePreferences(value:OperationPreferences){try{localStorage.setItem(KEY,JSON.stringify(value));}catch{/* 无存储权限时仍保留会话设置。 */}}
/** 快捷键标签和键盘派遣必须使用相同的种族、生产建筑上下文。 */
export function productionBindings(player:Player,units:readonly Unit[],selected:ReadonlySet<number>,prefs:OperationPreferences):Partial<Record<Kind,string>>{
  const roster=player.race?ROSTERS[player.race].units:MOBILE_KINDS;
  const buildings=units.filter(u=>u.side===player.side&&!isMobile(u)&&selected.has(u.id)&&u.construction>=1&&!u.station);
  const kinds=buildings.length?roster.filter(kind=>buildings.some(b=>b.kind===producerFor(kind,player.race))):roster;
  return Object.fromEntries([...kinds.slice(0,11).map((kind,i)=>[kind,prefs.bindings[`train${i+1}` as Binding].toUpperCase()]),
    ...(['refinery','oilwell','lumbermill'] as const).map(kind=>[kind,prefs.bindings[kind].toUpperCase()])]);
}
