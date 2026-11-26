import { ROSTERS } from './races.js';
import { MOBILE_KINDS, STATS, isMobile, type Kind, type Player, type Unit } from './types.js';
import { getLanguage } from './locale.js';

export const operationText=(zh:string,en:string)=>getLanguage()==='en'?en:zh;
export const DEFAULT_BINDINGS={army:'f2',idle:'f3',pause:'p',attack:'a',repair:'j',stop:'x',hold:'h',rally:'g',resume:'n',
  train1:'q',train2:'e',train3:'r',train4:'d',train5:'s',train6:'w',train7:'k',train8:'m',train9:';',train10:"'",train11:'/',
  refinery:'i',oilwell:'o',lumbermill:'l'} as const;
export type Binding=keyof typeof DEFAULT_BINDINGS;
export type NoticeKind='attack'|'depleted'|'population'|'construction';
export interface OperationPreferences {
  animation:boolean;health:boolean;ranges:boolean;trackpad:boolean;continuousBuild:boolean;
  panSpeed:number;zoomSensitivity:number;reverseZoom:boolean;edgeScroll:boolean;
  bindings:Record<Binding,string>;notices:Record<NoticeKind,{sound:boolean;visual:boolean}>;
}
export const defaultPreferences=():OperationPreferences=>({animation:true,health:true,ranges:false,trackpad:false,continuousBuild:false,
  panSpeed:560,zoomSensitivity:1,reverseZoom:false,edgeScroll:false,bindings:{...DEFAULT_BINDINGS},
  notices:{attack:{sound:true,visual:true},depleted:{sound:true,visual:true},population:{sound:true,visual:true},construction:{sound:true,visual:true}}});
const KEY='fudancraft-operations-v1';
const reserved=new Set(['escape',' ','arrowup','arrowdown','arrowleft','arrowright','f','v','b','z','c','t','u','y','?','+','=','-','−',...Array.from({length:10},(_,i)=>String(i))]);
export function bindingError(bindings:Record<Binding,string>,action:Binding,key:string){
  if(!key||reserved.has(key)||!(/^.$/.test(key)||/^f([2-9]|1[0-2])$/.test(key)))return operationText('此按键保留或不受支持','Reserved or unsupported key');
  return Object.entries(bindings).some(([other,value])=>other!==action&&value===key)?operationText('按键已被其他操作使用','Key already assigned'):null;
}
export function parsePreferences(raw:unknown):OperationPreferences{
  const result=defaultPreferences();if(!raw||typeof raw!=='object')return result;
  const value=raw as Partial<OperationPreferences>;
  for(const k of ['animation','health','ranges','trackpad','continuousBuild','reverseZoom','edgeScroll'] as const)if(typeof value[k]==='boolean')result[k]=value[k];
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
  const kinds=buildings.length?roster.filter(kind=>buildings.some(b=>b.kind===(kind==='worker'&&player.race==='brood'?'hatchery':STATS[kind].producer))):roster;
  return Object.fromEntries([...kinds.slice(0,11).map((kind,i)=>[kind,prefs.bindings[`train${i+1}` as Binding].toUpperCase()]),
    ...(['refinery','oilwell','lumbermill'] as const).map(kind=>[kind,prefs.bindings[kind].toUpperCase()])]);
}
