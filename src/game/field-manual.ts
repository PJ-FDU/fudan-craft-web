import { RACES,RACE_NAMES,STATS,TECHS,type Race,type Kind,type MobileKind } from './types.js';
import { ROSTERS,producerFor,prerequisitesFor } from './races.js';
import { ABILITIES,abilitiesFor } from './abilities.js';
import { spriteMarkup } from './art.js';
import { t } from './locale.js';
import { operationText as text } from './operation-preferences.js';
import { escapeHtml as esc,informationMarkup,unitInformation } from './unit-information.js';
import { dropdownMarkup,type GameSelect } from './dropdown.js';

let filterRace:string='industrial',category='all',query='';
export function fieldManualMarkup(race?:Race){
  if(race)filterRace=race;
  return `<p class="dialog-description">${text('按种族查阅单位与建筑。数值为基础值；当前升级、状态和进度请查看战场选中面板。','Browse units and buildings by faction. Values are base stats; inspect battlefield selections for current upgrades, status and progress.')}</p><div class="manual-filters"><input type="search" data-manual-search aria-label="${text('搜索单位与建筑','Search units and buildings')}" placeholder="${text('搜索名称、用途、技能或前置条件','Search name, role, skill or prerequisite')}"><div class="manual-filter">${text('种族','Faction')}${dropdownMarkup('manual-race',text('种族','Faction'),[['all',text('全部种族','All factions')],...RACES.map(r=>[r,t(RACE_NAMES[r])] as const)],filterRace)}</div><div class="manual-filter">${text('类别','Category')}${dropdownMarkup('manual-category',text('类别','Category'),[['all',text('全部','All')],['units',text('单位','Units')],['buildings',text('建筑','Buildings')],['support',text('技能支援','Ability support')]],category)}</div></div><p data-manual-count role="status"></p><div id="codex-models" class="dialog-actions"></div><div class="field-manual-list"></div>`;
}
export function bindFieldManual(root:HTMLElement){
  const race=root.querySelector<GameSelect>('#manual-race')!,type=root.querySelector<GameSelect>('#manual-category')!,search=root.querySelector<HTMLInputElement>('[data-manual-search]')!;
  race.value=filterRace;type.value=category;search.value=query;
  const render=()=>{
    filterRace=race.value;category=type.value;query=search.value;
    const entries=RACES.filter(r=>filterRace==='all'||r===filterRace).flatMap(r=>{
      const roster=ROSTERS[r];
      return [...roster.units,'base',...roster.buildings].map(kind=>({kind:kind as Kind,race:r}));
    }).filter(({kind,race})=>{
      const mobile=STATS[kind].speed>0;
      if(category==='units'&&!mobile||category==='buildings'&&mobile||category==='support'&&(!mobile||!abilitiesFor(kind as MobileKind).length))return false;
      const info=unitInformation(kind,race);
      const requirements=prerequisitesFor(kind,race),producer=producerFor(kind,race);
      const source=[producer?STATS[producer].name:'',requirements.building?STATS[requirements.building].name:'',requirements.tech?TECHS[requirements.tech].name:'',requirements.tier2?TECHS.tier2.name:'',
        ...(mobile?abilitiesFor(kind as MobileKind).map(id=>JSON.stringify(ABILITIES[id])):[])].join(' ');
      return `${STATS[kind].name} ${STATS[kind].en} ${STATS[kind].description} ${source} ${info.description} ${JSON.stringify(info.facts)} ${JSON.stringify(info.skills)}`.toLowerCase().includes(query.trim().toLowerCase());
    });
    root.querySelector<HTMLElement>('[data-manual-count]')!.textContent=text(`${entries.length} 项档案`,`${entries.length} entries`);
    root.querySelector<HTMLElement>('.field-manual-list')!.innerHTML=entries.length?entries.map(({kind,race})=>{
      const s=STATS[kind];
      return `<article class="manual-entry" data-manual-kind="${kind}"><div class="manual-entry-heading">${spriteMarkup(kind,race)}<div><small>${t(RACE_NAMES[race])} · ${s.speed?text('单位','Unit'):text('建筑','Building')}</small><h3>${t(s.name)} <span>${s.en}</span></h3><p>${esc(unitInformation(kind,race).description)}</p></div></div><div class="manual-base-stats"><span>${text('基础生命','Base HP')} <b>${s.hp}</b></span><span>${text('金币 / 木材 / 石油','Gold / Wood / Oil')} <b>${s.cost} / ${s.wood} / ${s.oil}</b></span><span>${text('训练 / 建造','Train / build')} <b>${s.build} ${text('秒','s')}</b></span></div><details><summary>${text('生产、条件与技能','Production, requirements and abilities')}</summary>${informationMarkup(kind,race)}</details></article>`;
    }).join(''):`<p class="manual-empty">${text('没有匹配的档案，试试其他关键词或筛选条件。','No matching entries. Try another keyword or filter.')}</p>`;
  };
  race.onchange=render;type.onchange=render;search.oninput=render;render();
}
