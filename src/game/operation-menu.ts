import { RACES, RACE_NAMES, isRace, type Race } from './types.js';
import { MAPS,isMapId,mapInfo,supportsPlayers,type MapId } from './maps.js';
import { drawMapPreview } from './map-picker.js';
import { gridSize } from './grid.js';
import { getWorld } from './world.js';
import { STARTING_RESOURCES } from './resource-world.js';
import type { Difficulty,AiStyle } from './types.js';
import { AI_STYLES } from './ai-strategy.js';
import { dropdownMarkup,GameSelect } from './dropdown.js';
import { uiIcon } from './icons.js';

const SCALES=[
  {count:2,name:'1 对 1',detail:'你与一位 AI 指挥官交锋',en:'DUEL'},
  {count:3,name:'三方混战',detail:'两位 AI，三支军团争夺战场',en:'THREE ARMIES'},
  {count:4,name:'四方混战',detail:'三位 AI，完整的多方角逐',en:'FOUR ARMIES'},
] as const;
const DIFFICULTIES=[
  {id:'easy',name:'休闲',en:'EXPLORER',description:'从容建立你的补给线。',detail:'对手的进攻节奏较慢，适合熟悉采集、建设与兵种协同。'},
  {id:'normal',name:'标准',en:'COMMANDER',description:'发展与交锋之间的平衡。',detail:'在稳定的经济与军事压力下，规划你的扩张和第一波进攻。'},
  {id:'hard',name:'挑战',en:'VETERAN',description:'每一次决策，都关乎生存。',detail:'对手更早施加进攻压力，需要更紧凑的建设与作战节奏。'},
] as const;
type Options={
  mapId:MapId;
  canLoad:boolean;
  fromBattle:boolean;
  onBack:()=>void;
  onLoad:()=>void;
  onDeploy:(count:number,difficulty:Difficulty,mapId:MapId,style:AiStyle,race:Race,opponent:Race)=>void;
};

/** 只管理两级菜单的候选配置；真正开局仍由 main.ts 提交给 Engine。 */
export class OperationMenu{
  private stage:'settings'|'maps'='settings';
  private count=2;
  private difficulty:Difficulty='normal';
  private aiStyle:AiStyle='balanced';
  private race:Race='industrial';
  private opponent:Race='brood';
  private mapId:MapId;
  private mapNotice='';
  constructor(private root:HTMLElement,private options:Options){
    this.mapId=options.mapId;
    root.onclick=e=>{
      const button=(e.target as Element).closest<HTMLButtonElement>('button');
      if(!button||button.disabled)return;
      if(button.id==='operation-back'||button.id==='operation-settings-step')this.back();
      if(button.id==='choose-operation-map'){this.stage='maps';this.render();}
      if(button.id==='load-setup')options.onLoad();
      if(button.id==='deploy'&&supportsPlayers(this.mapId,this.count))options.onDeploy(this.count,this.difficulty,this.mapId,this.aiStyle,this.race,this.opponent);
    };
    root.onchange=e=>{
      const input=e.target;
      if(input instanceof GameSelect){
        if(input.id==='operation-race'&&isRace(input.value))this.race=input.value;
        if(input.id==='operation-opponent'&&isRace(input.value))this.opponent=input.value;
        if(input.id==='operation-ai-style'&&Object.hasOwn(AI_STYLES,input.value))this.aiStyle=input.value as AiStyle;
        this.updateSummary();return;
      }
      if(!(input instanceof HTMLInputElement))return;
      if(input.name==='operation-players'){
        const count=Number(input.value);if(!SCALES.some(scale=>scale.count===count))return;
        this.count=count;
        // 人数是用户先做出的选择；切换人数时保留它，并换成兼容地图。
        if(!supportsPlayers(this.mapId,count)){
          this.mapId=MAPS.find(map=>supportsPlayers(map.id,count))!.id;
          this.mapNotice=`已为 ${count} 人战役选择${mapInfo(this.mapId).name}；两人地图在此规模下不可用。`;
        }else this.mapNotice='';
        this.updateSummary();
      }
      if(input.name==='operation-difficulty'){
        const difficulty=DIFFICULTIES.find(item=>item.id===input.value);if(!difficulty)return;
        this.difficulty=difficulty.id;this.updateDifficulty();this.updateSummary();
      }
      if(input.name==='operation-map'&&isMapId(input.value)&&supportsPlayers(input.value,this.count)){
        this.mapId=input.value;this.mapNotice='';this.renderMapDetails();this.updateSummary();
      }
    };
    this.render();
  }
  handleKey(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();this.back();return;}
    if(event.key==='Enter'&&!(event.target instanceof HTMLButtonElement)){
      event.preventDefault();this.root.querySelector<HTMLButtonElement>(this.stage==='settings'?'#choose-operation-map':'#deploy')?.click();
    }
  }
  private back(){
    if(this.stage==='maps'){this.stage='settings';this.render();}
    else this.options.onBack();
  }
  private render(){
    const maps=this.stage==='maps';
    this.root.innerHTML=`
      <div class="operation-breadcrumb"><button id="operation-back" class="operation-back">← <span>${maps?'战役设置':this.options.fromBattle?'返回战场':'返回主菜单'}</span></button><nav aria-label="战役部署步骤"><button id="operation-settings-step" ${!maps?'disabled aria-current="step"':''}>01 <span>战役设置</span></button><i></i><span ${maps?'aria-current="step"':''}>02 <span>选择战场</span></span></nav></div>
      <div class="operation-stage ${maps?'operation-maps':'operation-settings'}" tabindex="-1">
        ${maps?this.mapMarkup():this.settingsMarkup()}
      </div>
      <footer class="operation-footer"><span class="operation-keyhint"><kbd>ESC</kbd> 返回 <i>·</i> <kbd>ENTER</kbd> ${maps?'部署':'下一步'}</span>${!maps?`<button id="load-setup" class="operation-load" ${!this.options.canLoad?'disabled':''}>${uiIcon('arrow-up-right')} 读取上次存档</button>`:''}<span id="operation-summary"></span><button id="${maps?'deploy':'choose-operation-map'}" class="operation-continue">${maps?'开始部署':'选择战场'} <span>→</span></button></footer>`;
    this.root.scrollTop=0;this.updateSummary();
    if(maps)this.renderMapDetails();else this.updateDifficulty();
    this.root.querySelector<HTMLElement>('.operation-stage')?.focus({preventScroll:true});
  }
  private settingsMarkup(){
    return `<div class="operation-config">
      <p class="operation-eyebrow">SINGLE PLAYER / NEW OPERATION</p><h2>新的战役</h2><p class="operation-intro">制定作战计划，踏入未知之地。</p>
      <fieldset class="operation-scale"><legend>交锋规模 <small>ARMIES</small></legend>${SCALES.map(scale=>`<label class="operation-scale-option"><input type="radio" name="operation-players" value="${scale.count}" ${this.count===scale.count?'checked':''}/><span class="operation-option-mark" aria-hidden="true"></span><span class="operation-scale-copy"><strong>${scale.name}</strong><small>${scale.detail}</small></span><span class="operation-scale-en">${scale.en}</span></label>`).join('')}</fieldset>
      <fieldset class="operation-difficulty"><legend>AI 难度 <small>DIFFICULTY</small></legend><div>${DIFFICULTIES.map(item=>`<label><input type="radio" name="operation-difficulty" value="${item.id}" ${this.difficulty===item.id?'checked':''}/><strong>${item.name}</strong><small>${item.en}</small></label>`).join('')}</div></fieldset>
      <div class="operation-style"><span>你的种族</span>${dropdownMarkup('operation-race','你的种族',RACES.map(race=>[race,RACE_NAMES[race]]),this.race)}</div>
      <div class="operation-style"><span>AI 种族</span>${dropdownMarkup('operation-opponent','AI 种族',RACES.map(race=>[race,RACE_NAMES[race]]),this.opponent)}</div>
      <div class="operation-style"><span>AI 策略</span>${dropdownMarkup('operation-ai-style','AI 策略',Object.entries(AI_STYLES).map(([id,style])=>[id,style.name]),this.aiStyle)}</div>
      <p class="operation-supply">初始补给 <span>金矿 ${STARTING_RESOURCES.gold.toLocaleString('en-US')} · 木材 ${STARTING_RESOURCES.wood} · 石油 ${STARTING_RESOURCES.oil}</span></p>
    </div><aside class="operation-briefing" aria-live="polite"><span class="operation-briefing-rule"></span><p id="operation-difficulty-en"></p><h3 id="operation-difficulty-description"></h3><p id="operation-difficulty-detail"></p></aside>`;
  }
  private mapMarkup(){
    return `<div class="operation-map-list"><p class="operation-eyebrow">CHOOSE YOUR BATTLEFIELD</p><h2>选择战场</h2><p class="operation-intro">${MAPS.length} 张地图，${this.count} 支军团。</p>
      <fieldset class="operation-map-options"><legend class="visually-hidden">战场地图</legend>${MAPS.map((map,index)=>`<label class="operation-map-option"><input type="radio" name="operation-map" value="${map.id}" ${this.mapId===map.id?'checked':''} ${!supportsPlayers(map.id,this.count)?'disabled':''}/><span class="operation-map-index">${String(index+1).padStart(2,'0')}</span><span class="operation-map-copy"><strong>${map.name}</strong><small>${map.en}</small></span><span class="operation-map-capacity">${supportsPlayers(map.id,this.count)?map.maxPlayers===2?'2 人':'2–4 人':'限 2 人'}</span></label>`).join('')}</fieldset>
    </div><div id="operation-map-details" class="operation-map-details" aria-live="polite"></div>`;
  }
  private renderMapDetails(){
    const size=gridSize(getWorld(this.mapId).land);
    const map=mapInfo(this.mapId),index=MAPS.findIndex(item=>item.id===map.id)+1;
    this.root.querySelector('#operation-map-details')!.innerHTML=`
      <div class="operation-cartography"><div class="operation-chart-top"><span>TACTICAL OVERVIEW</span><span>N ↑</span></div><div class="operation-preview-wrap"><canvas id="operation-map-preview" width="768" height="768" aria-label="${map.name}地形、资源与出生位置预览"></canvas></div><div class="operation-chart-legend"><span><i class="spawn"></i>出生点</span><span><i class="gold"></i>金矿</span><span><i class="oil"></i>油井</span><span><i class="water"></i>水域</span></div></div>
      <div class="operation-map-info"><p class="operation-eyebrow">SECTOR ${String(index).padStart(2,'0')} / ${map.en}</p><h3>${map.name}</h3><p class="operation-map-tag">${map.tag}</p><p class="operation-map-description">${map.description}</p><dl><div><dt>战场尺寸</dt><dd>${size} × ${size} 格</dd></div><div><dt>支持规模</dt><dd>${map.maxPlayers===2?'2 人交锋':'2–4 人混战'}</dd></div><div><dt>当前部署</dt><dd>${this.count} 支军团 · ${DIFFICULTIES.find(item=>item.id===this.difficulty)!.name}</dd></div></dl><p class="operation-map-note">${this.mapNotice||'资源采集并运回后才可使用。先建立补给，再推进战线。'}</p></div>`;
    drawMapPreview(this.root.querySelector<HTMLCanvasElement>('#operation-map-preview')!,this.mapId);
  }
  private updateDifficulty(){
    const item=DIFFICULTIES.find(item=>item.id===this.difficulty)!;
    this.root.querySelector('#operation-difficulty-en')!.textContent=`${item.en} / ${item.name}`;
    this.root.querySelector('#operation-difficulty-description')!.textContent=item.description;
    this.root.querySelector('#operation-difficulty-detail')!.textContent=item.detail;
  }
  private updateSummary(){
    const scale=SCALES.find(item=>item.count===this.count)!,difficulty=DIFFICULTIES.find(item=>item.id===this.difficulty)!;
    this.root.querySelector('#operation-summary')!.textContent=`${RACE_NAMES[this.race]} · ${scale.name} · ${difficulty.name} · ${AI_STYLES[this.aiStyle].name}${this.stage==='maps'?' · '+mapInfo(this.mapId).name:''}`;
  }
  destroy(){this.root.onclick=null;this.root.onchange=null;this.root.replaceChildren();}
}
