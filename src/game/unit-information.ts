import { ABILITIES,abilitiesFor } from './abilities.js';
import { STATS,TECHS,ALL_MOBILE_KINDS,type Kind,type MobileKind,type Race } from './types.js';
import { ROSTERS,producerFor,prerequisitesFor,populationWeight,supplyProvided,groundOnly,maxShield,needsCoverage,coverageRadius,researchBuilding,technologyAllowed } from './races.js';
import { t } from './locale.js';
import { operationText as text } from './operation-preferences.js';
import { BALANCE } from './balance.js';

export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export interface InformationFact{label:string;value:string;compact?:boolean}
/** 静态档案只描述基础数值；战场当前生命、升级与进度仍由权威快照显示。 */
export function unitInformation(kind:Kind,race?:Race){
  const s=STATS[kind],mobile=s.speed>0,producer=producerFor(kind,race),prerequisites=prerequisitesFor(kind,race);
  const facts:InformationFact[]=[];
  const add=(zh:string,en:string,value:string|number,compact=false)=>facts.push({label:text(zh,en),value:String(value),compact});
  if(mobile){
    add('生产建筑','Produced at',producer?t(STATS[producer].name):text('无','None'),true);
    add('人口占用','Population',populationWeight(kind as MobileKind,race),true);
    add('移动方式','Movement',s.air?text('空中','Air'):text('地面','Ground'));
  }else{
    add('建造方式','Construction',text('工程采集车','Harvester'));
    if(s.power&&(!race||race==='industrial'))add(s.power<0?'供电':'用电',s.power<0?'Power supplied':'Power used',Math.abs(s.power),true);
    const roster=race?ROSTERS[race].units:ALL_MOBILE_KINDS;
    const products=roster.filter(k=>producerFor(k,race)===kind);
    if(products.length)add('生产单位','Produces',products.map(k=>t(STATS[k].name)).join(' / '));
    const techs=(Object.keys(TECHS) as (keyof typeof TECHS)[]).filter(tech=>technologyAllowed({race},tech)&&researchBuilding({race},tech)===kind);
    if(techs.length)add('可研究','Research',techs.map(tech=>t(TECHS[tech].name)).join(' / '));
  }
  const supply=supplyProvided(kind,race);
  if(supply)add('人口容量','Supply provided',`+${supply}`+text('（完成后，上限 120）',' (when complete, cap 120)'),true);
  const required=[prerequisites.tier2?t(TECHS.tier2.name):'',prerequisites.building?t(STATS[prerequisites.building].name):'',prerequisites.tech?t(TECHS[prerequisites.tech].name):''].filter(Boolean);
  add('前置条件','Prerequisites',required.length?required.join(' + '):text('无额外条件','No additional requirements'),true);
  if(s.damage){
    add('攻击目标','Targets',groundOnly(kind)?text('仅地面','Ground only'):text('地面与空中','Ground and air'),true);
    add('基础攻击 / 射程','Base damage / range',`${s.damage} / ${s.range}`,true);
    add('攻击间隔','Attack interval',`${s.cooldown} ${text('秒','s')}`);
    if(s.splash)add('范围伤害半径','Splash radius',s.splash);
  }else if(mobile)add('普通攻击','Basic attack',text('无','None'));
  if(kind==='medic')add('治疗量 / 射程','Healing / range',`${BALANCE.medicHeal} / ${s.range}`,true);
  if(mobile)add('基础移速','Base speed',s.speed);
  if(maxShield({kind}))add('原生护盾','Native shield',maxShield({kind}));
  if(needsCoverage(kind))add('运作条件','Operation',text(`须在能量节点 ${coverageRadius} 范围内，失去覆盖暂停生产与施工`,`Requires an energy node within ${coverageRadius}; production and construction pause without coverage`),true);
  if(kind==='disruptor'&&race)add('工厂模块','Factory module',text('支援模块，改装期间无法生产','Support module; unavailable during refit'),true);
  if(race&&['tank','artillery','mech'].includes(kind))add('工厂模块','Factory module',text('装甲模块，改装期间无法生产','Armor module; unavailable during refit'),true);
  if(kind==='assembly')add('运作条件','Operation',text('部署后生产，收拢 / 迁移期间不可生产','Production requires deployment; packing and moving disable production'),true);
  if(kind==='oilwell')add('放置条件','Placement',text('须建于油点上','Must be placed on an oil deposit'),true);
  const skills=mobile&&race?abilitiesFor(kind as MobileKind).map(id=>{
    const a=ABILITIES[id];
    return {name:t(a.name),summary:t(a.summary),requirement:a.research?t(a.research.name)+' · '+t(TECHS[a.research.tier].name)+' · '+t(STATS[a.research.building].name):text('初始可用','Available initially')};
  }):[];
  const description=kind==='base'&&race==='brood'?text('接收全部资源，研究主指挥科技；采集车由孵化巢生产。被摧毁即出局。','Receives all resources and researches command technologies; harvesters are produced at the hatchery. Destruction eliminates you.'):t(s.description);
  return {description,facts,skills};
}
export function informationMarkup(kind:Kind,race?:Race,skills=true,compact=false){
  const info=unitInformation(kind,race);
  return `<dl class="information-facts">${info.facts.filter(f=>!compact||f.compact).map(f=>`<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}</dl>${skills&&info.skills.length?`<div class="information-skills">${info.skills.map(a=>`<p><strong>${escapeHtml(a.name)}</strong> · ${escapeHtml(a.summary)}<small>${escapeHtml(a.requirement)}</small></p>`).join('')}</div>`:''}`;
}
