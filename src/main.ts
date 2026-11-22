import { ABILITIES, abilitiesFor, removableAreas, statusLabels, type AbilityId } from './game/abilities.js';
import { ROSTERS, covered, maxShield, needsCoverage, population, researchBuilding, technologyAllowed } from './game/races.js';
import { RACES, RACE_NAMES, type Race, ALL_MOBILE_KINDS } from './game/types.js';
import './style.css';
import './battle-hud.css';
import './map-picker.css';
import './operation-menu.css';
import './settings.css';
import './touch-hud.css';
import './improvements.css';
import { getLanguage,onLanguageChange,t } from './game/locale.js';
import { dropdownMarkup,type GameSelect } from './game/dropdown.js';
import { uiIcon } from './game/icons.js';
import { AudioDirector } from './game/audio.js';
import { audioSettingsMarkup,bindAudioSettings } from './game/audio-settings.js';
import { mapInfo,type MapId } from './game/maps.js';
import { mapPickerMarkup,bindMapPicker } from './game/map-picker.js';
import { OperationMenu } from './game/operation-menu.js';
import { BattleControls } from './game/controls.js';
import { TouchHUD } from './game/touch-hud.js';
import { GROUP_KEYS, groupAction, groupKey, groupShortcut, readGroups, type GroupAction, type GroupKey } from './game/control-groups.js';
import { buildingFacing,nextFacing } from './game/building-layout.js';
import { Engine, complete, requirement, powerFor, snapPoint, validPoint } from './game/engine.js';
import { animationGallery } from './game/animation-gallery.js';
import { selectionInfo } from './game/selection-info.js';
import { Renderer } from './game/renderer.js';
import { spriteMarkup } from './game/art.js';
import { unpackFog } from './game/protocol.js';
import { PAGES_BUILD,SEAT_KEY,parseInvite,displayRoom,inviteURL } from './network/config.js';
import type { GameConnection } from './network/connection.js';
import { sameTeam,type AiStyle } from './game/types.js';
import { isSupplyAlert,MATCH_EVENT_NAMES,type MatchEvent } from './game/match-stats.js';
import { matchReportMarkup,exportMatch } from './game/match-report.js';
import { STATS,TECHS,MOBILE_KINDS,BUILDING_KINDS,RESOURCE_INFO,COLORS,POPULATION,isMobile,isCombat,unitCost,maxHp,type Side,type Kind,type BuildingKind,type Tech,type Player,type Cost,type MobileKind,type Difficulty,type Point,type ViewState,type Command } from './game/types.js';
import { TILE,distance } from './game/pathfinding.js';
import { $,app,audio,dialog,handleHomeKeys,syncSound,syncFullscreen,toast,toggleFullscreen,toggleSound } from './shell.js';
const canvas=$<HTMLCanvasElement>('battle'),mini=$<HTMLCanvasElement>('minimap');
const renderer=new Renderer(canvas,mini,$<HTMLCanvasElement>('battle-3d'));
let hudVisible=true,dispatchExpanded=false,spaceDragged=false;
const titleScreen=$('title-screen'),battleUI=$('battle-ui'),battleHeader=$('battle-header');
let home=true,entryId=0,assetsPromise:Promise<void>|null=null,pendingBattle:(()=>void)|null=null;
let operation:OperationMenu|null=null,operationOpen=false,operationBeforePaused=true;
let engine=new Engine(),view=engine.view(1),side:Side=1,started=false,paused=true,network=false,attackMode=false,rallyMode=false,repairMode=false,showingResult=false;
let waitingForState=false;
type LobbyPlayers={name:string;side:Side;race?:Race;connected?:boolean}[];
let lastLobby:{players:LobbyPlayers;side:Side;mapId:MapId;mode:'ffa'|'coop'}|null=null;
let reconnectTicket:{code:string;token:string}|null=null,reconnectTimer:ReturnType<typeof setTimeout>|null=null,reconnectUntil=0,reconnectAttempt=0;
let reconnectWindow=120_000,connectionPromise:Promise<GameConnection>|null=null;
let socket:GameConnection|null=null,roomCode='',roomHost=false,lastUI=0,accumulator=0,lastFrame=0,lastReady=0;
let galleryCleanup:(()=>void)|null=null;
let beforeDialog=false,dialogPauses=false,renderQueueKey='',renderSelectedKey='',renderDetailsKey='';
const keys=new Set<string>(),groups=new Map<GroupKey,number[]>();
let lastGroupRecall:{key:GroupKey;time:number}|undefined;
let mouseGroupAction:Exclude<GroupAction,'recall'>|undefined;
const trainingShortcuts={q:'soldier',e:'worker',r:'tank'} as const;
const buildingShortcuts={i:'refinery',o:'oilwell',l:'lumbermill'} as const;
const productionShortcuts:Partial<Record<Kind,string>>=Object.fromEntries(
  Object.entries({...trainingShortcuts,...buildingShortcuts}).map(([key,kind])=>[kind,key.toUpperCase()]));
const LOCAL_SAVE_KEY='fudancraft-save-v2';
let buildKind:BuildingKind|null=null,buildWorker=0,productionTab:'units'|'buildings'|'tech'='units',productionKey='';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time=(n:number)=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
const soundscape=new AudioDirector(audio);
const touchHUD=new TouchHUD(app,{
  attack:()=>{$('attack-move').click();},repair:beginRepair,stop:()=>command({type:'stop',ids:[...renderer.selected]}),
  all:selectAll,clear:()=>{setMode(null);renderer.selected.clear();renderer.selectedNode=null;touchHUD.showDetails(false);updateUI(true);},
  dispatch:()=>{if(!dispatchExpanded&&renderer.selected.size){const selected=view.units.filter(u=>renderer.selected.has(u.id));productionTab=selected.some(u=>u.kind==='worker')?'buildings':selected.some(u=>u.kind==='research')?'tech':'units';renderProduction(view.players.find(p=>p.side===side)!,true);}setDispatch(!dispatchExpanded);},
  resize:()=>renderer.resize(),
  idle:selectIdleWorker,group:(key,save)=>{const number=groupKey(key);if(number)controlGroup(number,save?'save':'recall');},filter:filterSelection,
});
function readLocalBattle(raw:string){
  const saved=JSON.parse(raw);
  if(!saved||!Object.hasOwn(saved,'controlGroups'))return {engine:Engine.restore(raw),groups:readGroups(undefined)};
  const {controlGroups,...battle}=saved;
  return {engine:Engine.restore(JSON.stringify(battle)),groups:readGroups(controlGroups)};
}
function storeLocalBattle(){
  localStorage.setItem(LOCAL_SAVE_KEY,JSON.stringify({...engine.state,controlGroups:Object.fromEntries(groups)}));
}
function refreshHomeSave(){
  const button=$<HTMLButtonElement>('continue-game');
  button.disabled=true;$('continue-detail').textContent='暂无本地存档';$('home-save-status').textContent='你的下一场远征，从这里开始。';
  try{
    const raw=localStorage.getItem(LOCAL_SAVE_KEY);if(!raw)return;
    // 与正式读档共用校验，损坏的存档不能点亮「继续远征」。
    const saved=readLocalBattle(raw).engine.state;
    button.disabled=false;$('continue-detail').textContent=`${mapInfo(saved.mapId).name} · ${time(saved.time)}`;
    $('home-save-status').textContent=`本地战役已保存 · ${time(saved.time)}`;
  }catch{$('continue-detail').textContent='存档无法读取';$('home-save-status').textContent='可开始新的战役。';}
}
function ensureBattleAssets(){
  // 标题页不加载整套图集和 Three.js 场景；并发入口复用同一次加载。
  if(!assetsPromise)assetsPromise=renderer.load().then(()=>{
    updateRendererMode();renderer.resize();renderer.zoom=Math.max(.85,Math.min(1.5,renderer.height/840));
  }).catch(error=>{assetsPromise=null;throw error;});
  return assetsPromise;
}
function enterBattle(){
  home=false;app.classList.remove('home-screen');titleScreen.hidden=true;titleScreen.inert=true;
  battleUI.inert=false;battleHeader.inert=false;$('battle-loading').hidden=true;pendingBattle=null;
  renderer.resize();keys.clear();controls.clear();lastRender=-Infinity;
  queueFrame();
}
async function prepareBattle(action:()=>void){
  closeOperation(false);
  const id=++entryId;pendingBattle=action;closeDialog();paused=true;keys.clear();controls.clear();
  titleScreen.inert=true;battleUI.inert=true;battleHeader.inert=true;
  $('battle-loading').hidden=false;$('battle-loading-title').textContent='正在准备战场';
  $('battle-loading-note').textContent='载入地形与远征部队，请稍候…';$('battle-loading-spinner').hidden=false;$('retry-battle').hidden=true;
  $('cancel-battle').focus({preventScroll:true});
  try{await ensureBattleAssets();if(id!==entryId)return;enterBattle();action();}
  catch(error){
    if(id!==entryId)return;
    $('battle-loading-title').textContent='战场加载未完成';$('battle-loading-note').textContent=(error as Error).message;
    $('battle-loading-spinner').hidden=true;$('retry-battle').hidden=false;
  }
}
function returnHome(){
  closeOperation(false);
  ++entryId;
  if(started&&!network)saveGame();
  if(roomCode||socket)leaveNetwork();
  started=false;paused=true;home=true;pendingBattle=null;waitingForState=false;
  soundscape.reset(view,side,false);audio.scene('menu');
  closeDialog();paused=true;keys.clear();controls.clear();setMode(null);hideCommandTooltip();renderer.selected.clear();renderer.selectedNode=null;clearGroups();
  app.classList.add('home-screen');titleScreen.hidden=false;titleScreen.inert=false;
  battleUI.inert=true;battleHeader.inert=true;$('battle-loading').hidden=true;$('pause-overlay').hidden=true;
  setDispatch(false);if(!hudVisible)toggleHud();refreshHomeSave();
  $( $<HTMLButtonElement>('continue-game').disabled?'start':'continue-game').focus({preventScroll:true});
}
$('cancel-battle').onclick=returnHome;
$('retry-battle').onclick=()=>{if(pendingBattle)void prepareBattle(pendingBattle);};
function focusBase(){renderer.setWorld(view);const b=view.units.find(u=>u.side===side&&u.kind==='base');if(b)renderer.focus({x:b.x,y:b.y-(renderer.is3D?32:80)});}
let skillMode:{id:AbilityId;ids:number[];target?:number}|null=null;
let stationMode:{id:number;action:'move'|'deploy'}|null=null;
const skillPanel=document.createElement('section');
skillPanel.className='skill-panel';skillPanel.hidden=true;skillPanel.setAttribute('aria-label','技能与设施指令');app.append(skillPanel);
let skillRenderKey='';
function setMode(mode:'attack'|'rally'|'repair'|null){skillMode=null;stationMode=null;renderer.skillPreview=null;if(!started||home||operationOpen)skillPanel.hidden=true;attackMode=mode==='attack';rallyMode=mode==='rally';repairMode=mode==='repair';buildKind=null;renderer.placement=null;$('command-hint').hidden=!mode;$('rotate-building').hidden=true;$('command-message').textContent=repairMode?'点击受损的己方建筑进行维修 · × / Esc 取消':attackMode?'点击战场：攻击移动 · Esc 取消':'点击战场：设置基地集结点 · Esc 取消';$('attack-move').classList.toggle('active',attackMode);$('repair').classList.toggle('active',repairMode);$('touch-attack').classList.toggle('active',attackMode);$('touch-repair').classList.toggle('active',repairMode);canvas.style.cursor=mode?'crosshair':'default';}
function beginRepair(){
  if(!readyForCommand())return;
  if(repairMode){setMode(null);return;}
  const selected=view.units.filter(u=>renderer.selected.has(u.id)&&u.side===side),building=selected.find(u=>!isMobile(u)&&complete(u)&&u.hp<u.maxHp);
  if(building){
    const worker=view.units.filter(u=>u.side===side&&u.kind==='worker'&&u.order!=='build').sort((a,b)=>distance(a,building)-distance(b,building))[0];
    if(!worker){toast('请先选择工程采集车',true);return;}
    if(command({type:'repair',ids:[worker.id],target:building.id}))toast('建筑维修指令已下达');
    return;
  }
  if(!selected.some(u=>u.kind==='worker')){toast('请先选择工程采集车',true);return;}
  setMode('repair');if(touchHUD.active)setDispatch(false);updateUI(true);
}
function rotateBuilding(){
  if(renderer.placement)renderer.placement.facing=nextFacing(renderer.placement.facing);
}
$('rotate-building').onclick=rotateBuilding;
function beginBuilding(kind:BuildingKind){
  if(!readyForCommand())return;const player=view.players.find(p=>p.side===side)!,why=requirement(kind,player,view.units);if(why){toast(why,true);return;}
  const workers=view.units.filter(u=>u.side===side&&u.kind==='worker');const worker=workers.find(u=>renderer.selected.has(u.id))||workers.find(u=>u.order!=='build')||workers[0];
  if(!worker){toast('先在指挥中心训练工程采集车',true);return;}
  if(dispatchExpanded&&touchHUD.active)setDispatch(false);
  setMode(null);buildKind=kind;buildWorker=worker.id;renderer.selected=new Set([worker.id]);
  const point=snapPoint(renderer.camera);renderer.placement={kind,point,facing:buildingFacing(kind,point,renderer.camera.world)};
  $('command-hint').hidden=false;$('rotate-building').hidden=false;
  $('command-message').textContent=kind==='oilwell'?'点击精炼厂覆盖内的油点建井 · Esc 取消':`放置${STATS[kind].name} · 绿色可建造 / 红色不可建造 · Esc 取消`;canvas.style.cursor='crosshair';updateUI(true);
}
function readyForCommand(){if(home||operationOpen||!$('battle-loading').hidden||!started){toast('先开始战役，接管你的部队');return false;}if(paused&&!network){toast('战局已暂停，按 P 继续');return false;}if(view.winner){toast('本场战役已结束');return false;}return true;}
function command(c:Command):boolean{if(!readyForCommand())return false;if(network){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'command',command:c}));else{toast('连接已断开，请返回单机战役',true);return false;}}else{const err=engine.command(side,c);if(err){toast(err,true);return false;}view=engine.view(side);}renderer.selectedNode=null;soundscape.command(c,view,side);updateUI(true);return true;}
function togglePause(){if(network){toast(PAGES_BUILD?'P2P 战役由房主持续模拟':'联机对战由服务器持续模拟');return;}if(!started||view.winner)return;paused=!paused;$('pause-overlay').hidden=!paused;updateUI(true);}
function selectAll(){if(!started)return;renderer.selected=new Set(view.units.filter(u=>u.side===side&&isCombat(u)).map(u=>u.id));setMode(null);soundscape.select(view,side,renderer.selected);updateUI(true);}
function selectIdleWorker(fallback=false){
  const workers=view.units.filter(u=>u.side===side&&u.kind==='worker'&&u.order==='idle').sort((a,b)=>a.id-b.id),current=workers.findIndex(u=>renderer.selected.has(u.id));
  const worker=workers[(current+1)%workers.length]??(fallback?view.units.find(u=>u.side===side&&u.kind==='worker'):undefined);if(!worker){toast('没有空闲采集车');return;}
  renderer.selected=new Set([worker.id]);renderer.selectedNode=null;setMode(null);renderer.focus(worker);updateUI(true);
}
const groupButtons=GROUP_KEYS.map(key=>{
  const button=document.createElement('button');
  button.type='button';button.dataset.group=key;button.setAttribute('aria-pressed','false');
  const label=document.createElement('kbd');label.textContent=key;
  const count=document.createElement('span');count.setAttribute('aria-hidden','true');
  button.append(label,count);
  button.onclick=e=>{
    const modifier=e.ctrlKey||e.metaKey;
    const action=modifier||e.shiftKey?groupAction(modifier,e.shiftKey):mouseGroupAction??'recall';
    setMouseGroupAction(undefined);
    controlGroup(key,action);
  };
  $('control-groups').append(button);
  return {key,button,count};
});
const groupActions=document.createElement('div');
groupActions.className='control-group-actions';
const groupActionButtons=(['save','append','add'] as const).map(action=>{
  const button=document.createElement('button');
  button.type='button';
  button.dataset.groupAction=action;
  button.textContent={save:'保存',append:'追加',add:'加选'}[action];
  button.title={save:'保存选中单位到编队',append:'向编队追加单位',add:'将编队加选到当前选择'}[action];
  button.setAttribute('aria-pressed','false');
  button.onclick=()=>setMouseGroupAction(mouseGroupAction===action?undefined:action);
  groupActions.append(button);
  return {action,button};
});
$('control-groups').append(groupActions);
function setMouseGroupAction(action:typeof mouseGroupAction){
  mouseGroupAction=action;
  for(const entry of groupActionButtons)entry.button.setAttribute('aria-pressed',String(entry.action===action));
  const label=$('control-groups').querySelector('span')!;
  label.textContent=action?'选择编队编号':'编队';
}
function clearGroups(){
  setMouseGroupAction(undefined);
  groups.clear();
  lastGroupRecall=undefined;
}
function controlGroup(key:GroupKey,action:GroupAction){
  if(!started||view.winner)return;
  const existing=groups.get(key)??[];
  if(action==='save'||action==='append'){
    const own=new Set(view.units.filter(unit=>unit.side===side&&unit.hp>0).map(unit=>unit.id));
    const selected=[...renderer.selected].filter(id=>own.has(id));
    if(!selected.length){toast('请选择要编队的单位');return;}
    const ids=action==='append'?[...new Set([...existing,...selected])]:selected;
    groups.set(key,ids);lastGroupRecall=undefined;
    toast(`编队 ${key} 已保存 · ${ids.length} 个单位`);
  }else{
    const units=view.units.filter(unit=>unit.side===side&&unit.hp>0&&existing.includes(unit.id));
    if(!units.length){toast(`编队 ${key} 为空，请先选择部队并保存`);return;}
    const now=performance.now();
    const focus=action==='recall'&&lastGroupRecall?.key===key&&now-lastGroupRecall.time<=400&&
      units.length===renderer.selected.size&&units.every(unit=>renderer.selected.has(unit.id));
    lastGroupRecall=action==='recall'&&!focus?{key,time:now}:undefined;
    if(action==='recall')renderer.selected.clear();
    for(const unit of units)renderer.selected.add(unit.id);
    renderer.selectedNode=null;setMode(null);
    if(focus)renderer.focus({x:units.reduce((sum,unit)=>sum+unit.x,0)/units.length,y:units.reduce((sum,unit)=>sum+unit.y,0)/units.length});
    soundscape.select(view,side,renderer.selected);
  }
  updateUI(true);
}
function updateGroupButtons(ownIds:ReadonlySet<number>){
  if(!renderer.selected.size&&(mouseGroupAction==='save'||mouseGroupAction==='append'))setMouseGroupAction(undefined);
  for(const {action,button} of groupActionButtons)button.disabled=action!=='add'&&!renderer.selected.size;
  for(const [key,ids] of groups){
    const current=ids.filter(id=>ownIds.has(id));
    if(current.length)groups.set(key,current);else groups.delete(key);
  }
  for(const {key,button,count} of groupButtons){
    const ids=groups.get(key)??[],active=ids.length>0&&ids.length===renderer.selected.size&&ids.every(id=>renderer.selected.has(id));
    const title=`编队 ${key} · ${ids.length} 个单位`;
    if(count.textContent!==(ids.length?String(ids.length):''))count.textContent=ids.length?String(ids.length):'';
    button.classList.toggle('occupied',ids.length>0);
    if(button.getAttribute('aria-pressed')!==String(active))button.setAttribute('aria-pressed',String(active));
    const tooltip=ids.length?title+' · 点击召回，双击定位':title+' · Ctrl / Cmd + 点击保存';
    if(button.dataset.tooltip!==tooltip){button.dataset.tooltip=tooltip;button.title=tooltip;button.setAttribute('aria-label',title);}
  }
}
function filterSelection(kind:Kind|'army'){
  renderer.selected=new Set(view.units.filter(u=>u.side===side&&renderer.selected.has(u.id)&&(kind==='army'?isMobile(u)&&u.kind!=='worker':u.kind===kind)).map(u=>u.id));
  renderer.selectedNode=null;setMode(null);updateUI(true);
}
function showDialog(title:string,content:string,tag='COMMAND CENTER',pause=true){
  if(!dialog.open){beforeDialog=paused;dialogPauses=pause&&!network&&started&&!view.winner;if(dialogPauses)paused=true;}
  galleryCleanup?.();galleryCleanup=null;
  dialog.classList.toggle('animation-dialog',tag==='LIVING BATTLEFIELD');
  dialog.classList.toggle('map-dialog',tag==='NEW OPERATION'||tag.startsWith('ROOM / '));
  $('dialog-title').textContent=title;$('dialog-tag').textContent=tag;$('dialog-content').innerHTML=content;if(!dialog.open)dialog.showModal();
}
function closeDialog(){galleryCleanup?.();galleryCleanup=null;dialog.close();app.append($('audio-caption'));if(dialogPauses)paused=beforeDialog;dialogPauses=false;if(operationOpen)$('operation-back').focus({preventScroll:true});else if(home)$($<HTMLButtonElement>('continue-game').disabled?'start':'continue-game').focus({preventScroll:true});else canvas.focus({preventScroll:true});}
$('cancel-command').onclick=()=>{setMode(null);updateUI(true);};
$('close-dialog').onclick=closeDialog;dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();const m=e as MouseEvent;if(m.clientX<r.left||m.clientX>r.right||m.clientY<r.top||m.clientY>r.bottom)closeDialog();}});
function startLocal(count:number,difficulty:Difficulty,mapId:MapId,aiStyle:AiStyle,race:Race,opponent:Race){
  if(roomCode)leaveNetwork();engine=new Engine(Array.from({length:count},(_,i)=>({name:i===0?'指挥官':`${['','赤焰','苍穹','金砂'][i]}军团`,ai:i!==0,aiStyle,race:i===0?race:i===1?opponent:RACES[(RACES.indexOf(opponent)+i-1)%RACES.length]})),difficulty,mapId);
  side=1;renderer.side=side;view=engine.view(side);renderer.reset();renderer.selected.clear();clearGroups();started=true;paused=false;network=false;showingResult=false;lastReady=0;lastAutosave=0;accumulator=0;
  soundscape.reset(view,side);
  $('pause-overlay').hidden=true;$('game-mode').textContent=`${RACE_NAMES[race]} · ${count-1} AI`;$('connection').textContent='本地系统就绪';$('objective-state').textContent='战役进行中 · 保护己方基地';$('system-state').textContent='战役已开始，等待你的指令';setMode(null);closeDialog();paused=false;focusBase();updateUI(true);toast('指挥权限已移交。祝你好运，指挥官。');
}
function setupBattle(){
  if(operationOpen)return;
  closeDialog();refreshHomeSave();operationBeforePaused=paused;paused=true;operationOpen=true;
  keys.clear();controls.clear();setMode(null);hideCommandTooltip();app.classList.add('operation-open');
  titleScreen.hidden=false;titleScreen.inert=false;battleUI.inert=true;battleHeader.inert=true;
  $('operation-content').hidden=false;
  operation=new OperationMenu($('operation-content'),{
    mapId:view.mapId,canLoad:!$<HTMLButtonElement>('continue-game').disabled,fromBattle:!home,
    onBack:closeOperation,onLoad:loadGame,
    onDeploy:(count,difficulty,mapId,style,race,opponent)=>void prepareBattle(()=>startLocal(count,difficulty,mapId,style,race,opponent)),
  });
}
function closeOperation(focus=true){
  if(!operationOpen)return;
  operation?.destroy();operation=null;operationOpen=false;$('operation-content').hidden=true;
  app.classList.remove('operation-open');titleScreen.hidden=!home;titleScreen.inert=!home;
  battleUI.inert=home;battleHeader.inert=home;paused=operationBeforePaused;keys.clear();controls.clear();lastRender=-Infinity;
  if(focus)(home?$('start'):canvas).focus({preventScroll:true});
}
function saveGame(){if(network){toast(PAGES_BUILD?'P2P 战役由房主维护，不支持本地存档':'联机战役由服务器维护，不支持本地存档');return;}if(!started){toast('开始战役后可以保存');return;}try{storeLocalBattle();toast('战役已保存到当前浏览器');}catch{toast('存档失败，浏览器存储不可用',true);}}
function loadGame(){
  try{
    const raw=localStorage.getItem(LOCAL_SAVE_KEY);if(!raw){toast('当前浏览器还没有存档',true);return;}
    const loaded=readLocalBattle(raw);
    void prepareBattle(()=>{
      if(roomCode||socket)leaveNetwork();engine=loaded.engine;side=1;renderer.side=1;view=engine.view(1);renderer.reset();
      network=false;started=true;paused=false;showingResult=false;renderer.selected.clear();clearGroups();
      for(const [key,ids] of loaded.groups)groups.set(key,ids);
      lastAutosave=engine.state.time;accumulator=0;
      soundscape.reset(view,side,false);
      $('pause-overlay').hidden=true;$('game-mode').textContent='单人战役 · 已读档';$('objective-state').textContent='战役进行中 · 保护己方基地';
      $('connection').textContent='本地系统就绪';closeDialog();paused=false;setMode(null);focusBase();updateUI(true);toast('已恢复上次战役');
    });
  }catch{toast('当前存档无法读取；扩展版使用独立 v2 存档',true);refreshHomeSave();}
}
const lightingChoices=[['off','基础 · 最省性能'],['balanced','均衡 · 动态反弹光'],['high','精细 · 更清晰的反弹光']] as const;
function menu(){showDialog('战局控制',`<p class="dialog-description">${network?'联机战役持续进行，打开菜单不会暂停其他玩家。':'单机战局在菜单打开时暂停，关闭菜单后恢复。'}</p><div class="dialog-actions"><button id="menu-resume" class="primary-button">返回战场 <span>${uiIcon('arrow-up-right')}</span></button><button id="new-battle" class="secondary-button">新建战役</button><button id="menu-multiplayer" class="secondary-button">多人联机</button></div><div class="dialog-actions"><button id="menu-codex" class="secondary-button">战术档案</button><button id="menu-help" class="secondary-button">操作指南</button><button id="menu-animation" class="secondary-button">动画图鉴</button></div><div class="dialog-actions"><button id="save" class="secondary-button" ${network?'disabled':''}>保存战局</button><button id="load" class="secondary-button">读取存档</button></div><label class="toggle-label">播放部队与环境动画<input id="animation-toggle" type="checkbox" ${renderer.animate?'checked':''}></label><label class="toggle-label">显示单位生命值<input id="health-toggle" type="checkbox" ${renderer.showHealth?'checked':''}></label><label class="toggle-label">显示选中单位攻击范围<input id="range-toggle" type="checkbox" ${renderer.showRanges?'checked':''}></label>${audioSettingsMarkup(audio)}<label class="toggle-label">触控板模式：双指平移 / 捏合缩放<input id="trackpad-toggle" type="checkbox" ${controls.trackpad?'checked':''}/></label><p class="room-note">自动存档：单机战役每 30 秒保存一次。存档保留在本浏览器。</p>`);
  addModelGalleryButton($('menu-animation').parentElement!);
  bindPerformanceSettings();
  const report=document.createElement('button');report.id='menu-stats';report.className='secondary-button';report.textContent='查看战局统计';report.onclick=()=>{showDialog('战局统计',matchReportMarkup(view)+'<button id="export-match" class="secondary-button">导出战局数据</button>');$('export-match').onclick=()=>exportMatch(view);};$('dialog-content').append(report);
  bindAudioSettings($('dialog-content'),audio,syncSound);
  if(renderer.is3D){
    const label=document.createElement('div');label.className='toggle-label select-setting';
    label.innerHTML=`<span>间接光照</span>${dropdownMarkup('lighting-quality','间接光照',lightingChoices)}`;
    $('dialog-content').insertBefore(label,$('animation-toggle').parentElement);
    const select=$<GameSelect>('lighting-quality');
    select.value=renderer.lightingQuality;select.disabled=!renderer.supportsGI;
    select.title=renderer.supportsGI?'精细档需要更多显卡性能；设置自动保存':'当前设备不支持浮点渲染，使用基础光照';
    select.onchange=()=>{
      const value=select.value;
      if(value==='off'||value==='balanced'||value==='high')renderer.lightingQuality=value;
    };
  }
  const homeButton=document.createElement('button');homeButton.id='menu-home';homeButton.className='secondary-button';homeButton.textContent=network?'离开战役并返回主菜单':'保存并返回主菜单';homeButton.onclick=returnHome;
  $('dialog-content').append(homeButton);
  $('menu-animation').onclick=()=>{if(!renderer.ready){toast('动画素材正在加载，请稍候');return;}showDialog('远征动画图鉴','', 'LIVING BATTLEFIELD');galleryCleanup=animationGallery($('dialog-content'),renderer.images);};$<HTMLInputElement>('animation-toggle').onchange=e=>renderer.animate=(e.target as HTMLInputElement).checked;
  $('menu-resume').onclick=closeDialog;$('new-battle').onclick=setupBattle;$('save').onclick=saveGame;$('load').onclick=loadGame;$('menu-multiplayer').onclick=multiplayer;$('menu-codex').onclick=codex;$('menu-help').onclick=help;$<HTMLInputElement>('trackpad-toggle').onchange=e=>controls.trackpad=(e.target as HTMLInputElement).checked;
  $<HTMLInputElement>('health-toggle').onchange=e=>renderer.showHealth=(e.target as HTMLInputElement).checked;$<HTMLInputElement>('range-toggle').onchange=e=>renderer.showRanges=(e.target as HTMLInputElement).checked;
}
function help(){
  const touch=`<h3>触屏操作</h3><p class="room-note">单击己方单位选择；选中后点击空地移动、敌军攻击、资源采集。选中工人后点击受损建筑维修或未完工建筑续建。</p><p class="room-note">双击单位选择当前视野同类，三击选择己方全部移动单位（含工人）。长按 420 毫秒后拖出选择框；直接单指拖动平移，双指平移和缩放战场。</p><p class="room-note">点击「保存」再点 1–3 保存编队，点击编号召回，连点两次定位。底部「调度」打开生产、建造和科技；点击选中摘要查看详细数值，× 取消选择或指令。</p>`;
  const groupMouseHelp='<p class="room-note">鼠标编队：先点击「保存」「追加」或「加选」，再点击编队编号。也可点击编号召回，双击定位。</p>';
  const desktop=`<div class="control-list"><span><kbd>左键</kbd> 点选 / 拖动框选</span><span><kbd>Shift</kbd> 加选 / 取消单位</span><span><kbd>右键</kbd> 移动 / 指定攻击</span><span><kbd>A</kbd> 攻击移动至目标</span><span><kbd>J</kbd> 维修</span><span><kbd>H</kbd> 驻守当前位置</span><span><kbd>X</kbd> 停止当前指令</span><span><kbd>Q E R</kbd> 训练步兵 / 采集车 / 坦克</span><span><kbd>F2</kbd> 选择全部作战部队</span><span><kbd>F3</kbd> 轮选空闲采集车</span><span><kbd>↑ ↓ ← →</kbd> 移动战场视野</span><span><kbd>Space</kbd> 轻按回基地，按住 + 左键拖图</span><span><kbd>滚轮 / 捏合</kbd> 以指针为中心缩放</span><span><kbd>Z / C</kbd> 旋转 3D 视角</span><span><kbd>T</kbd> 旋转待放置的建筑</span><span><kbd>P</kbd> 暂停 / 恢复战役</span><span><kbd>Ctrl / Cmd + 1–0</kbd> 保存编队</span><span><kbd>Ctrl / Cmd + Shift + 1–0</kbd> 向编队追加单位</span><span><kbd>1–0</kbd> 召回编队，连按两次定位</span><span><kbd>Shift + 1–0</kbd> 将编队加选到当前选择</span><span><kbd>I / O / L</kbd> 建造精炼厂 / 油井 / 木材加工厂</span><span><kbd>+ / −</kbd> 缩放战场</span><span><kbd>G</kbd> 设置生产集结点</span><span><kbd>F</kbd> 一键全屏 / 退出</span><span><kbd>V</kbd> 隐藏 / 显示控制台</span><span><kbd>B</kbd> 展开 / 收起调度面板</span><span><kbd>中键 / 右键拖动</kbd> 平移战场</span><span><kbd>Esc</kbd> 取消指令 / 取消选择</span></div>`;
  showDialog('指挥官操作指南',`<p class="dialog-description">探索地图、训练部队、保护基地。使用不同兵种协同作战，摧毁敌方基地取得胜利。</p>${touchHUD.active?touch:desktop+groupMouseHelp+touch}<p class="room-note">选中工人后右键受损的己方建筑维修；也可选中受损建筑点击「维修」，或按 J 后点击建筑。维修按恢复生命消耗资源，完成后恢复采集。</p><div class="dialog-actions"><button id="help-ok" class="primary-button">收到，指挥官 <span>${uiIcon('check')}</span></button></div>`,'FIELD MANUAL');$('help-ok').onclick=closeDialog;
}
function codex(){showDialog('远征部队档案',`<p class="dialog-description">一辆采集车到一支机械化远征军。不同兵种需要对应的生产建筑与科技。</p><div class="dialog-actions" id="codex-models"></div><div class="codex-grid">${ALL_MOBILE_KINDS.map(k=>{const st=STATS[k];return `<div class="codex-card">${spriteMarkup(k)}<div><strong>${st.name} <small>${st.en}</small></strong><p>${st.description}</p><small>HP ${st.hp} · ATK ${st.damage} · ${costMarkup(unitCost(k))}</small><p>${st.producer?STATS[st.producer].name:''}${st.tech?' → '+TECHS[st.tech].name:''}</p></div></div>`;}).join('')}</div><div class="dialog-actions"><button id="open-tree" class="primary-button">查看科技发展路线 <span>${uiIcon('arrow-up-right')}</span></button></div>`,'EXPEDITION FIELD MANUAL');$('open-tree').onclick=techTree;addModelGalleryButton($('codex-models'));}
function addModelGalleryButton(parent:HTMLElement){
  const button=document.createElement('button');button.className='secondary-button';button.textContent='种族模型图鉴';
  parent.append(button);
  button.onclick=async()=>{
    showDialog('种族模型图鉴','<p id="model-loading" class="room-note">正在加载三维模型…</p>','LIVING BATTLEFIELD');
    const loading=$('model-loading');
    try{
      await ensureBattleAssets();
      const {modelGallery}=await import('./game/model-gallery.js');
      if(dialog.open&&loading.isConnected)galleryCleanup=modelGallery($('dialog-content'),renderer.images);
    }catch{
      if(loading.isConnected)loading.textContent='模型加载失败，请关闭图鉴后重试。';
    }
  };
}
function techTree(){
  const race=view.players.find(p=>p.side===side)?.race;
  if(race){
    const roster=ROSTERS[race];
    const stages=[{title:'经济与生产',line:`主指挥建筑与${STATS[roster.production].name}分别处理种族队列。供给来源为${STATS[roster.supply].name}。`},
      {title:'T2 支援分化',line:'在主指挥建筑研究升级，建造种族科技设施，再研究对应技能。'},
      {title:'T3 高级干扰',line:'继续升级后可研究高阶技能或招募后期单位。'}];
    const technologies=(Object.keys(TECHS) as Tech[]).filter(k=>technologyAllowed(view.players.find(p=>p.side===side)!,k)&&k.includes('-'));
    showDialog(RACE_NAMES[race]+'科技路线',`<div class="tech-road">${stages.map(stage=>`<div><b>${stage.title}</b><p>${stage.line}</p></div>`).join('')}${technologies.map(k=>`<div><b>${TECHS[k].name}</b><p>${STATS[TECHS[k].building!].name} · ${TECHS[k].description}</p></div>`).join('')}</div>`,'TECHNOLOGY ROADMAP');
    return;
  }
  showDialog('从采集到机械化远征',`<p class="dialog-description">金矿和木材驱动早期建设，石油支撑机械化。生产建筑决定兵种，研究中心决定技术。所有前置建筑必须建造完成。</p><div class="tech-road"><div><b>01 / 建立补给</b><p>指挥中心 → 工程采集车 → 金矿 / 木材</p><p>木材加工厂：伐木 +50%，可就近交付木材和金矿</p></div><div><b>02 / 基础军事</b><p>聚能电站 → 步兵营 → 突击步兵</p><p>步兵营 → 石油精炼厂 → ${view.oilWells?'油井通过管道输油':'采集车采油'}</p></div><div><b>03 / 机械化</b><p>步兵营 → 战车工厂 → 侦察战车 / 攻城坦克</p><p>科技研究中心 → 战地医疗兵 / 精密武器 → 幽影狙击手</p></div><div><b>04 / 先进科技</b><p>精密武器 + 战车工厂 → 先进工程 → 远程火炮 / 泰坦机甲</p><p>战车工厂 → 航空机库；精密武器 + 机库 → 航空技术 → 猎隼战机</p></div><div><b>05 / 支援升级</b><p>智能物流：采集效率 +50%，货仓 100 → 150</p><p>复合装甲：全部作战单位生命值 +25%</p></div></div><p class="room-note">留意电力上限：电力不足时，军事生产和研究暂停；指挥中心仍可生产采集车。建造额外电站可以恢复供电。</p>`,'TECHNOLOGY ROADMAP');}
function settings(){
  showDialog('游戏设置',`<p class="dialog-description">调整你的视听与操作偏好。</p>${audioSettingsMarkup(audio)}<label class="toggle-label">播放部队与环境动画<input id="setting-animation" type="checkbox" ${renderer.animate?'checked':''}></label><label class="toggle-label">显示单位生命值<input id="setting-health" type="checkbox" ${renderer.showHealth?'checked':''}></label><label class="toggle-label">显示选中单位攻击范围<input id="setting-ranges" type="checkbox" ${renderer.showRanges?'checked':''}></label><label class="toggle-label">触控板模式：双指平移 / 捏合缩放<input id="setting-trackpad" type="checkbox" ${controls.trackpad?'checked':''}></label><div class="toggle-label select-setting"><span>间接光照</span>${dropdownMarkup('setting-lighting','间接光照',lightingChoices)}</div><p class="room-note">光照选项随本浏览器保存，在进入战场后生效；不支持的设备自动使用基础渲染。单机战役每 30 秒自动存档，返回主菜单时也会保存。</p><div class="dialog-actions"><button id="settings-ok" class="primary-button">返回主菜单 <span>${uiIcon('arrow-up-right')}</span></button></div>`,'GAME SETTINGS',false);
  bindAudioSettings($('dialog-content'),audio,syncSound);
  bindPerformanceSettings();
  $<HTMLInputElement>('setting-animation').onchange=e=>renderer.animate=(e.target as HTMLInputElement).checked;
  $<HTMLInputElement>('setting-health').onchange=e=>renderer.showHealth=(e.target as HTMLInputElement).checked;
  $<HTMLInputElement>('setting-ranges').onchange=e=>renderer.showRanges=(e.target as HTMLInputElement).checked;
  $<HTMLInputElement>('setting-trackpad').onchange=e=>controls.trackpad=(e.target as HTMLInputElement).checked;
  const select=$<GameSelect>('setting-lighting');select.value=renderer.ready?renderer.lightingQuality:matchMedia('(max-width:580px)').matches?'off':'balanced';
  try{const saved=localStorage.getItem('fudancraft-lighting');if(saved==='off'||saved==='balanced'||saved==='high')select.value=saved;}catch{/* 无本地存储时使用设备默认值。 */}
  select.onchange=()=>{const value=select.value;if(value==='off'||value==='balanced'||value==='high')renderer.lightingQuality=value;};
  $('settings-ok').onclick=closeDialog;
}
function bindPerformanceSettings(){
  const label=document.createElement('div');label.className='toggle-label select-setting';
  label.innerHTML=`<span>性能模式</span>${dropdownMarkup('performance-mode','性能模式',[['auto','自动调节'],['quality','优先画质'],['power','省电模式']])}`;
  const status=document.createElement('p');status.id='performance-status';status.className='room-note';status.textContent=renderer.performanceStatus;
  $('dialog-content').append(label,status);const select=$<GameSelect>('performance-mode');select.value=renderer.performanceMode;
  select.onchange=()=>{const value=select.value;if(value==='auto'||value==='quality'||value==='power')renderer.performanceMode=value;status.textContent=renderer.performanceStatus;};
}
function clearReconnect(){
  reconnectTicket=null;reconnectUntil=0;reconnectAttempt=0;if(reconnectTimer)clearTimeout(reconnectTimer);reconnectTimer=null;
  try{sessionStorage.removeItem(SEAT_KEY);}catch{/* 本次连接仍可正常使用。 */}
}
function retryNetwork(){
  if(!reconnectTicket||reconnectTimer)return;
  if(!reconnectUntil)reconnectUntil=Date.now()+reconnectWindow;
  if(Date.now()>=reconnectUntil){clearReconnect();$('connection').textContent='重连已超时';toast('重连已超时，可返回主菜单创建新战役',true);return;}
  $('connection').textContent='连接中断 · 正在恢复席位';
  const delay=Math.min(5000,500*2**Math.min(reconnectAttempt++,4))*(.8+.4*Math.random());
  reconnectTimer=setTimeout(async()=>{
    reconnectTimer=null;const ticket=reconnectTicket;if(!ticket)return;
    if(Date.now()>=reconnectUntil){retryNetwork();return;}
    try{const ws=await connect();if(reconnectTicket===ticket)ws.send(JSON.stringify({type:'resume',...ticket}));}
    catch{retryNetwork();}
  },Math.min(delay,reconnectUntil-Date.now()));
}
function connect(){
  if(socket?.readyState===WebSocket.OPEN)return Promise.resolve(socket);
  if(connectionPromise)return connectionPromise;
  const fog=new Map<'visible'|'explored',{encoded:string;cells:number[]}>();
  const decodeFog=(kind:'visible'|'explored',encoded:string)=>{
    const previous=fog.get(kind);
    if(previous?.encoded===encoded)return previous.cells;
    const cells=unpackFog(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
    fog.set(kind,{encoded,cells});
    return cells;
  };
  const pending=(async()=>{
    const ws:GameConnection=PAGES_BUILD?new (await import('./network/p2p-connection.js')).P2PConnection({
      key:import.meta.env.VITE_METERED_PUBLISHABLE_KEY,relayOnly:import.meta.env.VITE_P2P_RELAY_ONLY==='true',
    }):new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
    socket=ws;
    return new Promise<GameConnection>((resolve,reject)=>{const timeout=setTimeout(()=>{ws.close();reject(Error('连接超时'));},8000);ws.onopen=()=>{clearTimeout(timeout);resolve(ws);};ws.onerror=()=>{clearTimeout(timeout);reject(Error('无法连接联机服务器'));};ws.onmessage=e=>{if(socket!==ws)return;let m;try{m=JSON.parse(e.data);}catch{return;}if(m.type==='error'){toast(m.message,true);const button=$('join-room') as HTMLButtonElement|null;if(button)button.disabled=false;const create=$('create-room') as HTMLButtonElement|null;if(create)create.disabled=false;}
      else if(m.type==='resume-error'){clearReconnect();leaveNetwork();toast(m.message,true);if(!home)returnHome();else multiplayer();}
      else if(m.type==='lobby'){
        roomCode=m.code;roomHost=m.host;reconnectTicket=PAGES_BUILD&&m.host?null:{code:m.code,token:m.token};reconnectUntil=0;reconnectAttempt=0;
        if(Number.isSafeInteger(m.reconnectMs)&&m.reconnectMs>0)reconnectWindow=m.reconnectMs;
        try{if(reconnectTicket)sessionStorage.setItem(SEAT_KEY,JSON.stringify(reconnectTicket));else sessionStorage.removeItem(SEAT_KEY);}catch{/* 隐私模式可在当前页面恢复。 */}
        lastLobby={players:m.players,side:m.side,mapId:m.mapId,mode:m.mode};
        if(!m.started){network=false;started=false;paused=true;showingResult=false;roomLobby(m.players,m.side,m.mapId,m.mode);}
      }
      else if(m.type==='started'){const recovering=m.resumed&&!home;network=true;side=m.side;renderer.side=side;waitingForState=!recovering;paused=false;showingResult=false;if(!recovering){started=false;renderer.selected.clear();clearGroups();}$('pause-overlay').hidden=true;$('game-mode').textContent=`${m.mode==='coop'?'合作对抗 AI':PAGES_BUILD?'P2P 对战':'联机对战'} · ${displayRoom(m.code)}`;$('connection').textContent='实时连接中';$('objective-state').textContent='联合作战网络已接入';if(recovering){closeDialog();toast('已恢复原席位');}else void prepareBattle(()=>{closeDialog();paused=false;focusBase();updateUI(true);toast(m.resumed?'已恢复原席位':'联机战役开始');});}
      else if(m.type==='state'&&network){const newSession=waitingForState;if(waitingForState){renderer.reset();started=true;waitingForState=false;lastReady=0;}const first=network&&view.players.find(p=>p.side===side)?.ai!==false;view={...m.state,visible:typeof m.state.visible==='string'?decodeFog('visible',m.state.visible):m.state.visible,explored:typeof m.state.explored==='string'?decodeFog('explored',m.state.explored):m.state.explored};if(newSession)soundscape.reset(view,side);if(first||!lastReady){focusBase();lastReady=1;}updateUI();}
      else if(m.type==='transport'){$('connection').textContent=m.message;}
      else if(m.type==='notice')toast(m.message);
    };ws.onclose=e=>{clearTimeout(timeout);reject(Error('连接已关闭'));if(socket!==ws)return;socket=null;if(e.code===4001){clearReconnect();toast('席位已在另一个连接恢复',true);return;}if(PAGES_BUILD&&e.code===4004){clearReconnect();returnHome();toast('房主已离开，房间结束',true);return;}if(reconnectTicket){$('system-state').textContent='画面暂停更新 · 正在重连';retryNetwork();}else if(PAGES_BUILD&&roomCode){toast('房主页面已关闭，房间结束',true);returnHome();}};});
  })();
  const shared=pending.finally(()=>{if(connectionPromise===shared)connectionPromise=null;});
  connectionPromise=shared;
  return shared;
}
function leaveNetwork(){clearReconnect();if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'leave'}));const old=socket;socket=null;old?.close();roomCode='';lastLobby=null;network=false;lastReady=0;}
function multiplayer(){if(roomCode&&!network&&lastLobby){roomLobby(lastLobby.players,lastLobby.side,lastLobby.mapId,lastLobby.mode);return;}if(network){showDialog('当前联机战役',`<p class="dialog-description">房间 ${escape(displayRoom(roomCode))} · 联机战役正在进行。${PAGES_BUILD&&roomHost?'房主离开会结束整个房间。':'离开后将由 AI 接管你的部队。'}</p><div class="dialog-actions"><button id="return-online" class="primary-button">返回战场</button><button id="leave-online" class="secondary-button">离开并返回主菜单</button></div>`);$('return-online').onclick=closeDialog;$('leave-online').onclick=returnHome;return;}
  showDialog('与指挥官并肩交锋',`<p class="dialog-description">支持 2–4 人自由对战，或 1–2 位朋友合作对抗 AI。两人合作请选择四人地图；共享视野，资源与指挥权独立。</p>${PAGES_BUILD?'<p class="room-note">P2P 静态版 · 房主创建房间后复制邀请链接。房主需保持页面打开；离开或刷新会结束房间。</p>':''}<label class="field">指挥官代号<input id="player-name" maxlength="16" value="${t('指挥官')}" autocomplete="nickname"/></label><div class="field">房间模式${dropdownMarkup('room-mode','房间模式',[['ffa','自由对战'],['coop','朋友合作对抗 AI']])}</div><div class="dialog-actions"><button id="create-room" class="primary-button">创建房间 <span>${uiIcon('plus')}</span></button></div><label class="field">加入已有房间<input id="room-input" maxlength="${PAGES_BUILD?2048:6}" placeholder="${PAGES_BUILD?'粘贴邀请链接或完整房间标识':'输入 6 位房间码'}" ${PAGES_BUILD?'':'style="text-transform:uppercase;font-family:var(--mono);letter-spacing:3px"'}/></label><div class="dialog-actions"><button id="join-room" class="secondary-button">加入作战房间 <span>${uiIcon('arrow-up-right')}</span></button></div>`,'MULTIPLAYER NETWORK');
  if(PAGES_BUILD){const invite=parseInvite(location.href);if(invite)$<HTMLInputElement>('room-input').value=invite.code;}
  async function act(join:boolean){const name=$<HTMLInputElement>('player-name').value,input=$<HTMLInputElement>('room-input').value.trim(),code=PAGES_BUILD?parseInvite(input)?.code??'':input.toUpperCase(),mode=$<GameSelect>('room-mode').value;if(join&&!(PAGES_BUILD?parseInvite(code):/^[A-F0-9]{6}$/.test(code))){toast(PAGES_BUILD?'请粘贴完整的 P2P 邀请链接或房间标识':'请输入正确的 6 位房间码',true);return;}const button=$<HTMLButtonElement>(join?'join-room':'create-room');button.disabled=true;try{const ws=await connect();ws.send(JSON.stringify({type:join?'join':'create',name,code,mode}));}catch(e){toast((e as Error).message,true);button.disabled=false;}}
  $('create-room').onclick=()=>void act(false);$('join-room').onclick=()=>void act(true);
}
function roomLobby(players:LobbyPlayers,ownSide:Side,mapId:MapId,mode:'ffa'|'coop'='ffa'){
  const ready=players.every(p=>p.connected!==false)&&(mode==='coop'||players.length>=2),max=mode==='coop'?Math.min(2,mapInfo(mapId).maxPlayers-1):mapInfo(mapId).maxPlayers;
  const hostSide=(PAGES_BUILD?players[0]:players.find(p=>p.connected!==false))?.side;
  const description=mode==='coop'?'朋友合作 · 人类同队，共享视野，对抗 AI 军团。':PAGES_BUILD?'P2P 自由对战 · 复制邀请链接，发送给其他指挥官加入。':'自由对战 · 邀请同一服务器上的指挥官，输入房间码加入战局。';
  lastLobby={players,side:ownSide,mapId,mode};
  showDialog('作战室已建立',`
    <p class="dialog-description">${description}</p>
    <div class="room-code"><strong>${escape(displayRoom(roomCode))}</strong><button id="copy-code">${PAGES_BUILD?'复制邀请链接':'复制房间码'} ${uiIcon('arrow-up-right')}</button></div>
    ${PAGES_BUILD?`<label class="field">邀请链接<input id="room-invite" readonly value="${escape(inviteURL(roomCode))}"/></label><p class="room-note">房主需保持页面打开；离开或刷新会结束房间。</p>`:''}
    ${players.map(p=>`<div class="room-member"><i style="background:${COLORS[p.side]}"></i><span><span data-i18n-ignore>${escape(p.name)}</span>${p.side===ownSide?'（你）':''} · ${RACE_NAMES[p.race??'industrial']}</span><small>${p.connected===false?'等待重连':p.side===hostSide?'房主':'已就绪'}</small></div>`).join('')}
    <div class="field">你的种族${dropdownMarkup('room-race','你的种族',RACES.map(race=>[race,RACE_NAMES[race]]),players.find(p=>p.side===ownSide)?.race??'industrial')}</div>
    ${mapPickerMarkup(mapId,!roomHost,players.length+(mode==='coop'?1:0))}
    <p class="room-note">${players.length} / ${max} 位指挥官 · ${ready?'可以开始战役':'等待指挥官加入或重连'}${mode==='coop'?' · 两人合作需要四人地图':''}</p>
    <div class="dialog-actions">${roomHost?`<button id="launch-room" class="primary-button" ${!ready?'disabled':''}>开始联机战役 <span>${uiIcon('arrow-up-right')}</span></button>`:'<span class="room-note">等待房主开始战役…</span>'}<button id="leave-room" class="secondary-button">离开房间</button></div>
  `,'ROOM / '+displayRoom(roomCode));
  const raceSelect=$<GameSelect>('room-race');raceSelect.onchange=()=>socket?.send(JSON.stringify({type:'select-race',race:raceSelect.value}));
  bindMapPicker($('dialog-content'),id=>socket?.send(JSON.stringify({type:'select-map',mapId:id})));
  $('copy-code').onclick=()=>{void navigator.clipboard.writeText(PAGES_BUILD?inviteURL(roomCode):roomCode).then(()=>toast(PAGES_BUILD?'邀请链接已复制':'房间码已复制')).catch(()=>toast(PAGES_BUILD?'请选中邀请链接手动复制':`房间码：${roomCode}`));};if(roomHost)$('launch-room').onclick=()=>socket?.send(JSON.stringify({type:'start'}));$('leave-room').onclick=()=>{leaveNetwork();closeDialog();};
}
function result(){if(showingResult)return;showingResult=true;const won=view.winner!==null&&sameTeam(view.winner,side,view.players),p=view.players.find(p=>p.side===side)!;showDialog(won?'战场属于你。':'暂时撤退，重整旗鼓。',`<p class="dialog-description">${won?'敌方基地已被摧毁，团队战役目标达成。':'己方队伍已失去指挥基地，可继续观察战局。'}</p><div class="result-stats"><div><small>作战用时</small><strong>${time(view.time)}</strong></div><div><small>击毁单位</small><strong>${p.kills}</strong></div><div><small>部队损失</small><strong>${p.lost}</strong></div></div>${matchReportMarkup(view)}<div class="dialog-actions"><button id="play-again" class="primary-button" ${network&&(!roomHost||!view.winner)?'disabled':''}>${network?'同房间再战':'再来一局'} <span>${uiIcon('arrow-up-right')}</span></button><button id="export-match" class="secondary-button">导出战局数据</button><button id="inspect" class="secondary-button">查看战场</button></div>${network?'<p class="room-note">战役结束后由当前房主返回作战室，选择地图并开始下一局。</p>':''}`,won?'MISSION COMPLETE':'MISSION ENDED',false);$('play-again').onclick=()=>{if(network)socket?.send(JSON.stringify({type:'rematch'}));else setupBattle();};$('export-match').onclick=()=>exportMatch(view);$('inspect').onclick=closeDialog;}
function canAfford(c:Cost,p:Player){return p.credits>=c.gold&&p.wood>=c.wood&&p.oil>=c.oil;}
function costMarkup(c:Cost,p?:Player){return `<span class="cost-gold${p&&p.credits<c.gold?' missing':''}">◈ ${c.gold.toLocaleString()}</span>${c.wood?` <span class="cost-wood${p&&p.wood<c.wood?' missing':''}">♣ ${c.wood}</span>`:''}${c.oil?` <span class="cost-oil${p&&p.oil<c.oil?' missing':''}">◉ ${c.oil}</span>`:''}`;}
function hideCommandTooltip(){$('command-tooltip').hidden=true;document.querySelector('[aria-describedby="command-tooltip"]')?.removeAttribute('aria-describedby');}
function showCommandTooltip(button:HTMLButtonElement){
  const player=view.players.find(p=>p.side===side);if(!player)return;
  const kind=(button.dataset.train||button.dataset.build) as Kind|undefined,tech=button.dataset.research as Tech|undefined;
  if(!kind&&!tech)return;
  const info=kind?STATS[kind]:TECHS[tech!],cost=kind?unitCost(kind):TECHS[tech!].cost;
  hideCommandTooltip();button.setAttribute('aria-describedby','command-tooltip');
  $('command-tooltip').innerHTML=`<div class="tooltip-heading"><strong>${info.name}</strong>${kind&&productionShortcuts[kind]?`<kbd>${productionShortcuts[kind]}</kbd>`:''}</div><p>${player.race&&tech==='weapons'?'提升突击步兵与幽影狙击手的普通攻击。':player.race&&tech==='armor'?'提升工业装甲车辆的生命值。':info.description}</p><div class="tooltip-cost">${costMarkup(cost,player)}<span>◷ ${kind?STATS[kind].build:TECHS[tech!].duration} 秒</span></div><div class="tooltip-status ${button.classList.contains('locked')||button.classList.contains('unaffordable')?'unavailable':''}">${escape(button.dataset.reason||'')}</div>`;
  $('command-tooltip').hidden=false;
}
function renderProduction(player:Player,force=false){
  // 只在资源跨过费用门槛时重绘按钮，采集中的每次数值变化不会打断悬停。
  const affordability=[...MOBILE_KINDS,...BUILDING_KINDS].map(k=>Number(canAfford(unitCost(k),player))).join('')+Object.values(TECHS).map(t=>Number(canAfford(t.cost,player))).join('');
  const key=productionTab+'|'+Boolean(view.oilWells)+'|'+player.tech.join(',')+'|'+view.units.filter(u=>u.side===side&&!isMobile(u)).map(u=>u.kind+complete(u)+(u.station?.mode??'')+(u.factoryModule??'')+(u.refitUntil??'')).join(',')+'|'+player.queue.filter(q=>q.research).map(q=>q.kind).join(',')+'|'+affordability;
  if(!force&&key===productionKey)return;productionKey=key;
  hideCommandTooltip();$('production-content').setAttribute('aria-labelledby','tab-'+productionTab);
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===productionTab);b.setAttribute('aria-selected',String(b.dataset.tab===productionTab));});
  if(productionTab==='tech'){
    $('production-content').innerHTML=`<div class="production-grid research-grid">${(Object.entries(TECHS) as [Tech,typeof TECHS[Tech]][]).filter(([k])=>technologyAllowed(player,k)).map(([k,t])=>{
      const labKind=researchBuilding(player,k);
      const done=player.tech.includes(k),queued=player.queue.some(q=>q.research&&q.kind===k),lab=view.units.some(u=>u.side===side&&u.kind===labKind&&complete(u)&&(!needsCoverage(u.kind)||covered(side,u,view.units)));
      const reason=!lab?'需要可用的'+STATS[labKind].name:t.requires&&!player.tech.includes(t.requires)?'前置：'+TECHS[t.requires].name:t.building&&!view.units.some(u=>u.side===side&&u.kind===t.building&&complete(u))?'需要'+STATS[t.building].name:null;
      const affordable=canAfford(t.cost,player),status=done?'已完成':queued?'研究排队中':reason||(!affordable?'资源不足':'点击开始研究');
      return `<button class="dispatch-card research-card ${done?'completed':''} ${queued?'queued':''} ${reason?'locked':''} ${!affordable&&!done?'unaffordable':''}" data-research="${k}" data-reason="${escape(status)}" ${done||queued?'disabled':''} aria-label="${t.name} · ${escape(status)}"><span class="research-symbol">${uiIcon(done?'check':queued?'clock':k==='weapons'?'attack':k==='armor'?'shield':k==='logistics'?'logistics':k==='advanced'?'gear':'star')}</span><span class="dispatch-info"><strong>${t.name}</strong><small>${escape(status)}</small></span><span class="dispatch-cost">${costMarkup(t.cost,player)}</span>${reason&&!done&&!queued?`<span class="lock-mark" aria-hidden="true">${uiIcon('lock')}</span>`:''}</button>`;
    }).join('')}</div><button class="tech-guide" id="technology-guide">完整科技链 <span>${uiIcon('arrow-up-right')}</span></button>`;$('technology-guide').onclick=techTree;
  }else{
    const roster=player.race?ROSTERS[player.race]:undefined;
    const kinds:Kind[]=productionTab==='units'?[...(roster?.units??MOBILE_KINDS)]:(roster?.buildings??BUILDING_KINDS).filter(k=>k!=='base'&&(k!=='oilwell'||view.oilWells));
    $('production-content').innerHTML=`<div class="production-grid ${productionTab==='buildings'?'building-grid':''}">${kinds.map(k=>{
      const st=STATS[k],reason=requirement(k,player,view.units),cost=unitCost(k),affordable=canAfford(cost,player),shortcut=productionShortcuts[k];
      const status=reason||(!affordable?'资源不足':productionTab==='units'?`点击训练 · ${st.producer?STATS[st.producer].name:''}`:'点击选择建造位置');
      return `<button class="dispatch-card ${reason?'locked':''} ${!affordable?'unaffordable':''}" ${productionTab==='units'?`data-train="${k}"`:`data-build="${k}"`} data-reason="${escape(status)}" aria-label="${st.name} · ${escape(status)}">${spriteMarkup(k,player.race)}<span class="dispatch-info"><strong>${st.name}</strong><small>${escape(status)} · ${st.build} 秒</small></span><span class="dispatch-cost">${costMarkup(cost,player)}</span>${shortcut?`<kbd class="command-key">${shortcut}</kbd>`:''}${reason?`<span class="lock-mark" aria-hidden="true">${uiIcon('lock')}</span>`:''}</button>`;
    }).join('')}</div>`;
  }
}
let visibleSupplyAlerts:MatchEvent[]=[];
let supplyAlertKey='';
$('field-alerts').onclick=e=>{
  const index=e.target instanceof HTMLElement?e.target.closest<HTMLButtonElement>('[data-alert]')?.dataset.alert:undefined;
  const alert=index===undefined?undefined:visibleSupplyAlerts[Number(index)];
  if(alert)renderer.focus(alert);
};
function renderSupplyAlerts(player:Player){
  visibleSupplyAlerts=view.winner?[]:(player.stats?.events??[]).filter(event=>isSupplyAlert(event)&&view.time-event.time<=50).slice(-3).reverse();
  const key=JSON.stringify(visibleSupplyAlerts);
  if(key===supplyAlertKey)return;
  supplyAlertKey=key;
  $('field-alerts').hidden=visibleSupplyAlerts.length===0;
  $('field-alerts').innerHTML=visibleSupplyAlerts.map((event,i)=>
    `<button type="button" data-alert="${i}" title="点击定位"><span aria-hidden="true">⌖</span>${MATCH_EVENT_NAMES[event.kind]}</button>`).join('');
}
function updateUI(force=false){const now=performance.now();if(!force&&now-lastUI<160)return;lastUI=now;const player=view.players.find(p=>p.side===side);if(!player)return;
  renderSupplyAlerts(player);
  $('sector-map').textContent=$('radar-map').textContent=mapInfo(view.mapId).name;
  const isPaused=paused&&started&&!network&&!view.winner,clockState=view.winner?'已结束':!started?'待部署':isPaused?'已暂停':network?'联机':'作战中';
  $('pause').setAttribute('aria-label',isPaused?'继续战役':'暂停');
  $('pause').setAttribute('aria-pressed',String(isPaused));$('pause').toggleAttribute('disabled',!started||network||!!view.winner);
  $('pause').title=network?'联机战役持续运行':isPaused?'继续战役 (P)':'暂停战役 (P)';
  $('pause-icon').innerHTML=uiIcon(isPaused?'play':'pause');$('pause-label').textContent=isPaused?'继续':'暂停';
  $('battle-clock').classList.toggle('paused',isPaused);$('battle-clock').classList.toggle('standby',!started||!!view.winner);$('clock-state').textContent=clockState;
  const own=view.units.filter(u=>u.side===side),power=powerFor(side,own),workers=own.filter(u=>u.kind==='worker');
  for(const [id,stat,value,label] of [['credits','gold-stat',player.credits,'金矿'],['wood','wood-stat',player.wood,'木材'],['oil','oil-stat',player.oil,'石油']] as const){
    const stock=Math.floor(value).toLocaleString();$(id).textContent=stock;$(id).classList.toggle('large-stock',stock.length>7);
    $(stat).setAttribute('aria-label',`${label}库存 ${stock}`);$(stat).title=`${label}库存 ${stock} · 采集并运回后计入`;
  }
  $('power-stat').hidden=!!player.race&&player.race!=='industrial';
  $('power').innerHTML=`${power.capacity} <em>/ ${power.used}</em>`;$('power-state').textContent=power.active?'充足':'不足';$('power-state').classList.toggle('shortage',!power.active);
  // 负载条反映实际耗电占供电的比例；缺电只改变显示，不参与模拟。
  $('power-stat').classList.toggle('shortage',!power.active);$('power-stat').title=`电力供给 ${power.capacity} / 消耗 ${power.used} · ${power.active?'供电充足':'缺电：军事生产与研究暂停'}`;
  $('power-stat').setAttribute('aria-label',$('power-stat').title);$('power-load').style.width=`${Math.min(100,power.capacity?power.used/power.capacity*100:power.used?100:0)}%`;
  $('worker-count').innerHTML=`${workers.length} <em>${workers.filter(u=>u.order==='gather').length} 采集中</em>`;$('economy-status').textContent=!power.active?'电力不足：军事生产与研究暂停':`${workers.filter(u=>u.order==='gather').length} 辆采集中 · ${workers.filter(u=>u.order==='build').length} 辆建造中 · ${workers.filter(u=>u.order==='repair').length} 辆维修中 · 已交付 ${Math.floor(player.harvested).toLocaleString()}`;
  const pop=population(player,own);
  $('population').textContent=String(pop.used);
  $('population-capacity').textContent=` / ${pop.capacity}${pop.reserved?`（预留 ${pop.reserved}）`:''}`;$('time').textContent=time(view.time);$('kills').innerHTML=`${player.kills} <em>/</em> ${player.lost}`;$('zoom').textContent=`${Math.round(renderer.zoom*100)}%`;$('coordinates').textContent=`SECTOR ${Math.floor(renderer.camera.x/TILE)} · ${Math.floor(renderer.camera.y/TILE)}`;
  $('mission-steps').innerHTML=`<span class="${player.harvested?'done':''}">01 资源采集 ${player.harvested?'✓':''}</span><span class="${own.some(u=>u.kind===(view.oilWells?'oilwell':'refinery')&&complete(u))?'done':''}">02 精炼补给</span><span class="${player.tech.length?'done':''}">03 科技研发 ${player.tech.length?'✓':''}</span>`;
  const waitingForGold=workers.filter(u=>u.waitingForGold).length;
  if(waitingForGold)$('economy-status').textContent+=` · ${waitingForGold} 辆金矿枯竭待指派`;
  const ownIds=new Set(own.map(u=>u.id));for(const id of renderer.selected)if(!ownIds.has(id))renderer.selected.delete(id);
  const selected=own.filter(u=>renderer.selected.has(u.id));
  if(selected.length)renderer.selectedNode=null;
  updateSkills(selected,player);
  const node=view.nodes.find(n=>n.id===renderer.selectedNode&&n.amount>0);
  if(!node)renderer.selectedNode=null;
  $('selection-count').textContent=node?'资源点':selected.length?`已选中 ${selected.length} 个单位`:'尚未选择单位';
  const key=selected.map(u=>`${u.id}:${Math.ceil(u.hp)}:${Math.floor(u.cargo)}:${u.station?.mode??''}`).join(',')+`:${node?.id??''}`;
  if(force||key!==renderSelectedKey){renderSelectedKey=key;
    const portrait=(u:ViewState['units'][number])=>spriteMarkup(u.kind,view.players.find(p=>p.side===u.side)?.race,
      u.station?.mode==='mobile'||u.station?.mode==='deploying');
    $('selected-units').hidden=selected.length<2;
    $('selected-units').innerHTML=selected.slice(0,15).map(u=>`<button class="selected-portrait" data-focus="${u.id}" title="${STATS[u.kind].name} · HP ${Math.ceil(u.hp)} / ${maxHp(u,player)} · 点击单选，Shift 移出">${portrait(u)}<span class="hp"><i style="width:${Math.min(100,u.hp/maxHp(u,player)*100)}%"></i></span></button>`).join('')+(selected.length>15?`<span class="selection-more">+${selected.length-15}</span>`:'');
    const primary=selected[0];$('unit-portrait').classList.toggle('empty',!primary&&!node);
    $('unit-portrait').innerHTML=node?`<span class="resource-portrait" style="color:${RESOURCE_INFO[node.kind].color}">${RESOURCE_INFO[node.kind].symbol}</span><span class="portrait-caption">${RESOURCE_INFO[node.kind].name}</span>`:primary?`${portrait(primary)}<span class="portrait-caption">${selected.length>1?`编队 · ${selected.length}`:STATS[primary.kind].en}</span>`:'<span class="portrait-reticle" aria-hidden="true">⌖</span><span class="portrait-caption">等待指令</span>';
  }
  const u=selected[0];$('selection-info').textContent=selected.length===1?`${STATS[u.kind].name} · ${u.kind==='worker'?(u.order==='gather'?(u.returning?'返回交付':'正在采集')+' · 载货 '+Math.floor(u.cargo):u.order==='build'?'建造中':u.order==='repair'?'维修中':'等待指令'):'HP '+Math.ceil(u.hp)+' / '+maxHp(u,player)}`:selected.length?`${selected.length} 个单位等待指令 · F3 选择空闲采集车`:'保护采集线，让每一份资源都产生价值。';
  const nodeAction=node?.kind==='oil'&&view.oilWells?'在油点上建造油井':'右键采集';
  const mining=node?.kind==='gold'?workers.filter(w=>w.resource===node.id&&w.order==='gather'&&!w.returning):[];
  const extracting=mining.filter(w=>w.activity==='gather').length;
  const queued=mining.filter(w=>w.service?.waiting).length;
  if(node)$('selection-info').textContent=`${RESOURCE_INFO[node.kind].name} · ${nodeAction}`;
  const details=selectionInfo(selected,view,player);
  // 触屏没有键盘和头像栏，多选提示跟随当前操作方式。
  if(touchHUD.active&&details&&selected.length>1)details.status='双击同类 · 三击全部';
  const detailsKey=JSON.stringify(node?{node,nodeAction,extracting,queued}:details);
  if(force||detailsKey!==renderDetailsKey){renderDetailsKey=detailsKey;
    $('unit-details').innerHTML=node?`<div class="unit-detail-title"><strong>${RESOURCE_INFO[node.kind].name}</strong><span>${nodeAction}</span></div><div class="unit-health"><span>剩余资源 ${Math.ceil(node.amount)} / ${Math.ceil(node.max)}</span><i style="width:${Math.max(0,Math.min(100,node.amount/node.max*100))}%"></i></div><div class="unit-stat-list"><span>资源总量<b>${Math.ceil(node.max)}</b></span>${node.kind==='gold'?`<span>采矿中<b>${extracting} 辆</b></span><span>排队中<b>${queued} 辆</b></span>`:''}</div>`:details?`<div class="unit-detail-title"><strong>${details.title}</strong><span>${details.status}</span></div><div class="unit-health ${details.health/details.maxHealth<.3?'critical':''}"><span>生命 ${Math.ceil(details.health)} / ${Math.ceil(details.maxHealth)}</span><i style="width:${Math.max(0,Math.min(100,details.health/details.maxHealth*100))}%"></i></div><div class="unit-stat-list">${details.stats.map(s=>`<span>${s.label}<b>${s.value}</b></span>`).join('')}</div>${details.progress?`<div class="selection-progress"><div><span>${details.progress.label}</span><b>${Math.floor(details.progress.value*100)}%</b></div><div class="selection-progress-track" role="progressbar" aria-label="${details.progress.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(details.progress.value*100)}"><i style="width:${Math.max(0,Math.min(100,details.progress.value*100))}%"></i></div><small>${details.progress.status}</small></div>`:''}`:'<div class="selection-placeholder">选择部队、建筑或资源<small>左键点选 / 拖动框选<br/>右键移动、攻击或采集</small></div>';
  }
  $('focus-selection').toggleAttribute('disabled',!selected.length&&!node);
  for(const id of ['attack-move','hold','stop'])$(id).toggleAttribute('disabled',!selected.some(isMobile));
  const canRepair=selected.some(u=>u.kind==='worker')||workers.length>0&&selected.some(u=>!isMobile(u)&&complete(u)&&u.hp<u.maxHp);
  $('repair').toggleAttribute('disabled',!canRepair);
  updateGroupButtons(ownIds);
  touchHUD.update(selected,node?{title:RESOURCE_INFO[node.kind].name,status:`剩余资源 ${Math.ceil(node.amount)} / ${node.max}`,health:node.amount,maxHealth:node.max,stats:[]}:details,canRepair,player.queue.length,skillMode?ABILITIES[skillMode.id].name:stationMode?'选择装配站目标位置':repairMode?'点击己方建筑维修':attackMode?'点击目标攻击移动':rallyMode?'点击设置集结点':buildKind?`放置${STATS[buildKind].name}`:null,workers.filter(u=>u.order==='idle').length,groups);
  $('queue-count').textContent=String(player.queue.length).padStart(2,'0');const qkey=player.queue.map(q=>q.kind+':'+Math.ceil(q.remaining*3)).join(',');
  if(force||qkey!==renderQueueKey){renderQueueKey=qkey;$('queue').innerHTML=player.queue.length?player.queue.map((q,i)=>`<button class="queue-item" data-cancel="${i}" title="${q.research?TECHS[q.kind as Tech].name:STATS[q.kind as MobileKind].name} · ${Math.ceil(q.remaining)} 秒 · 点击全额退款"><i class="queue-progress" style="width:${(1-q.remaining/q.duration)*100}%"></i>${q.research?`<b class="queue-tech">${uiIcon('gear')}</b>`:spriteMarkup(q.kind as MobileKind,player.race)}<span>${Math.ceil(q.remaining)}s</span></button>`).join(''):'<span class="empty-queue">生产建筑可以并行工作 <i>—</i></span>';}
  renderProduction(player,force);
  if(started&&(view.winner||!view.units.some(u=>u.kind==='base'&&sameTeam(u.side,side,view.players))))result();
}
// Interface actions
$('start').onclick=setupBattle;$('multiplayer').onclick=multiplayer;$('nav-battle').onclick=()=>{if(dialog.open)closeDialog();canvas.focus();};$('nav-codex').onclick=codex;$('help').onclick=help;$('menu').onclick=menu;$('pause').onclick=togglePause;$('resume').onclick=togglePause;$('sound').onclick=toggleSound;$('focus').onclick=focusBase;$('select-all').onclick=selectAll;
$('attack-move').onclick=()=>{if(!renderer.selected.size){toast('先选择作战部队');return;}setMode(attackMode?null:'attack');};$('hold').onclick=()=>command({type:'hold',ids:[...renderer.selected]});$('stop').onclick=()=>command({type:'stop',ids:[...renderer.selected]});
$('repair').onclick=beginRepair;
function setDispatch(expanded:boolean){dispatchExpanded=expanded;hideCommandTooltip();app.classList.toggle('production-expanded',expanded);touchHUD.setDispatch(expanded);$('expand-production').innerHTML=expanded?'收起 <kbd>B</kbd>':'展开 <kbd>B</kbd>';$('expand-production').setAttribute('aria-expanded',String(expanded));$('dispatch-toggle').classList.toggle('active',expanded);$('dispatch-toggle').setAttribute('aria-expanded',String(expanded));$('dispatch-toggle').setAttribute('aria-label',expanded?'收起调度面板':'展开调度面板');}
function toggleHud(){hudVisible=!hudVisible;app.classList.toggle('hud-hidden',!hudVisible);$('toggle-hud').setAttribute('aria-pressed',String(hudVisible));$('toggle-hud').setAttribute('aria-label',hudVisible?'隐藏控制台':'显示控制台');$('toggle-hud').title=`${hudVisible?'隐藏':'显示'}控制台 (V)`;$('hud-label').textContent=hudVisible?'面板':'显示';if(!hudVisible)setDispatch(false);}
app.addEventListener('gamefullscreenchange',()=>renderer.resize());
$('fullscreen').onclick=()=>void toggleFullscreen();$('toggle-hud').onclick=toggleHud;$('expand-production').onclick=()=>setDispatch(!dispatchExpanded);$('dispatch-toggle').onclick=()=>{if(!hudVisible)toggleHud();setDispatch(!dispatchExpanded);};
function changeZoom(factor:number){renderer.zoomAt(factor,{x:renderer.width/2,y:renderer.height/2});}
$('zoom-in').onclick=()=>changeZoom(1.18);$('zoom-out').onclick=()=>changeZoom(1/1.18);
$('orbit-left').onclick=()=>renderer.orbit(-1);$('orbit-right').onclick=()=>renderer.orbit(1);
function updateRendererMode(){
  $('orbit-left').hidden=$('orbit-right').hidden=!renderer.is3D;
  $('system-state').textContent=renderer.is3D?'Three.js 3D 战场已就绪':'当前使用 2D 战场';
}
canvas.addEventListener('renderermodechange',()=>{
  updateRendererMode();toast('3D 渲染已中断，已切换至 2D 战场');
});
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.onclick=()=>{productionTab=b.dataset.tab as typeof productionTab;renderProduction(view.players.find(p=>p.side===side)!,true);});
$('production-content').onclick=e=>{const b=(e.target as Element).closest<HTMLButtonElement>('button');if(!b)return;if(b.dataset.train)command({type:'train',kind:b.dataset.train as MobileKind});if(b.dataset.build)beginBuilding(b.dataset.build as BuildingKind);if(b.dataset.research)command({type:'research',tech:b.dataset.research as Tech});};
$('production-content').onpointerover=e=>{const b=(e.target as Element).closest<HTMLButtonElement>('.dispatch-card');if(b&&e.pointerType!=='touch'&&!b.contains(e.relatedTarget as Node|null))showCommandTooltip(b);};
$('production-content').onpointerleave=hideCommandTooltip;
$('production-content').addEventListener('focusin',e=>{const b=(e.target as Element).closest<HTMLButtonElement>('.dispatch-card');if(b)showCommandTooltip(b);});
$('production-content').addEventListener('focusout',hideCommandTooltip);
$('queue').onclick=e=>{const b=(e.target as Element).closest<HTMLButtonElement>('[data-cancel]');if(b)command({type:'cancel',index:Number(b.dataset.cancel)});};
$('selected-units').onclick=e=>{const b=(e.target as Element).closest<HTMLButtonElement>('[data-focus]');if(b){const id=Number(b.dataset.focus);if(e.shiftKey)renderer.selected.delete(id);else renderer.selected=new Set([id]);setMode(null);soundscape.select(view,side,renderer.selected);updateUI(true);}};
$('focus-selection').onclick=()=>{const u=view.units.find(u=>renderer.selected.has(u.id))??view.nodes.find(n=>n.id===renderer.selectedNode);if(u)renderer.focus(u);};
// Unit selection is distinct from camera gestures; a drag never issues an order.
function nodeAt(point:Point,pick:ReturnType<Renderer['pick']>){
  if(pick&&'node' in pick)return view.nodes.find(n=>n.id===pick.node&&n.amount>0);
  if(!pick)return view.nodes.find(n=>n.amount>0&&distance(n,point)<n.radius+20);
}
function unitAt(point:Point,pick:ReturnType<Renderer['pick']>,filter:(unit:ViewState['units'][number])=>boolean=()=>true,screen=renderer.camera.worldToScreen(point)){
  if(pick&&'unit' in pick){const exact=view.units.find(u=>u.id===pick.unit&&filter(u));if(exact)return exact;}
  if(touchHUD.active){
    const nearby=view.units.filter(filter).map(u=>({u,d:distance(renderer.projectUnit(u),screen)})).filter(({u,d})=>d<(isMobile(u)?24:30)).sort((a,b)=>a.d-b.d);
    if(nearby.length)return nearby[0].u;
  }
  if(!pick)return [...view.units].reverse().find(u=>filter(u)&&distance(u,point)<STATS[u.kind].radius+10);
}
function issueAt(point:Point,pick:ReturnType<Renderer['pick']>){
  const selected=view.units.filter(u=>renderer.selected.has(u.id)),node=nodeAt(point,pick);
  if(node&&selected.some(u=>u.kind==='worker')){
    if(node.kind==='oil'&&view.oilWells){
      beginBuilding('oilwell');
      if(renderer.placement?.kind==='oilwell')renderer.placement.point=snapPoint(node);
      return;
    }
    if(command({type:'gather',ids:selected.map(u=>u.id),node:node.id})){
      renderer.marker={p:node,time:performance.now(),attack:false};toast(`已指派采集${RESOURCE_INFO[node.kind].name}`);
    }
    return;
  }
  const target=unitAt(point,pick,u=>!sameTeam(u.side,side,view.players)||u.side===side&&(u.construction<1||!isMobile(u)&&u.hp<u.maxHp)),destination=target??point;
  if(!validPoint(destination,renderer.camera.world))return;
  if(command({type:'order',ids:[...renderer.selected],point:{x:destination.x,y:destination.y},target:target?.id,assault:attackMode})){
    renderer.marker={p:destination,time:performance.now(),attack:!!target&&!sameTeam(target.side,side,view.players)||attackMode};setMode(null);
  }
}
const controls=new BattleControls(canvas,renderer,{
  blocked:()=>home||operationOpen||dialog.open||!$('battle-loading').hidden,
  spaceHeld:()=>keys.has(' '),
  spaceDragged:()=>{spaceDragged=true;},
  canBoxSelect:()=>!attackMode&&!rallyMode&&!repairMode&&!buildKind,
  tapUnit:(p,screen)=>unitAt(p,renderer.pick(screen),u=>u.side===side&&isMobile(u),screen)?.id??null,
  multiTap:(p,screen,count)=>{
    if(!started||view.winner)return;
    if(count===2)selectSameKind(p,screen);
    else{renderer.selected=new Set(view.units.filter(u=>u.side===side&&isMobile(u)).map(u=>u.id));renderer.selectedNode=null;setMode(null);soundscape.select(view,side,renderer.selected);updateUI(true);}
  },
  hover:(point,screen)=>{
    if(renderer.skillPreview)renderer.skillPreview.point=point;
    renderer.hoverNode=buildKind?null:nodeAt(point,renderer.pick(screen))?.id??null;
    if(renderer.placement){
      const oil=buildKind==='oilwell'?nodeAt(point,renderer.pick(screen)):undefined;
      renderer.placement.point=snapPoint(oil?.kind==='oil'?oil:point);
    }
  },
  selectBox:(a,b,shift)=>{
    if(!started||view.winner)return;
    renderer.selectedNode=null;
    if(!shift)renderer.selected.clear();
    for(const unit of view.units){
      if(unit.side!==side||!isMobile(unit))continue;
      const p=renderer.projectUnit(unit);
      if(p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y))renderer.selected.add(unit.id);
    }
    soundscape.select(view,side,renderer.selected);updateUI(true);
  },
  click:(p,button,shift,screen,touch)=>{
    if(!started||view.winner)return;
    if(button===2&&buildKind){setMode(null);return;}
    if(button===0&&buildKind){if(!validPoint(p,renderer.camera.world))return;
      const oil=buildKind==='oilwell'?nodeAt(p,renderer.pick(screen)):undefined;
      if(command({type:'build',kind:buildKind,point:oil?.kind==='oil'?oil:p,worker:buildWorker,facing:renderer.placement?.facing})){toast(STATS[buildKind].name+'建造指令已下达');setMode(null);}return;}
    const pick=renderer.pick(screen);
    if(skillMode||stationMode){
      if(button===2){setMode(null);return;}
      if(button!==0)return;
      if(stationMode){
        if(command({type:'station',...stationMode,point:p}))setMode(null);
        return;
      }
      const mode=skillMode!,spec=ABILITIES[mode.id];
      if(spec.target==='area'){
        const matches=(view.areas??[]).filter(a=>!sameTeam(a.side,side,view.players)&&removableAreas.includes(a.skill)&&Math.hypot(a.x-p.x,a.y-p.y)<=a.radius)
          .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)||a.id-b.id);
        if(!matches.length){toast('请选择可见的敌方区域',true);return;}
        if(matches.length===1){if(command({type:'cast',skill:mode.id,ids:mode.ids,area:matches[0].id}))setMode(null);return;}
        showDialog('选择要拆解的区域',matches.map(a=>`<button class="secondary-button" data-area="${a.id}">${ABILITIES[a.skill].name} · ${(a.until-view.time).toFixed(1)} 秒</button>`).join(''));
        $('dialog-content').querySelectorAll<HTMLButtonElement>('[data-area]').forEach(b=>b.onclick=()=>{closeDialog();if(command({type:'cast',skill:mode.id,ids:mode.ids,area:Number(b.dataset.area)}))setMode(null);});
        return;
      }
      const needsUnit=spec.target==='ally'||spec.target==='enemy'||spec.target==='blink'&&mode.target===undefined;
      const u=needsUnit?unitAt(p,pick,x=>spec.target==='enemy'?!sameTeam(x.side,side,view.players):spec.target==='blink'?x.side===side:sameTeam(x.side,side,view.players),screen):undefined;
      if(needsUnit&&!u){toast('请选择可用的单位目标',true);return;}
      if(spec.target==='blink'&&!mode.target){
        mode.target=u!.id;if(renderer.skillPreview){renderer.skillPreview.origin=u!;renderer.skillPreview.range=200;renderer.skillPreview.radius=STATS[u!.kind].radius;}
        $('command-message').textContent='选择可见的折跃落点 · × / Esc 取消';return;
      }
      if(command({type:'cast',skill:mode.id,ids:mode.ids,target:u?.id??mode.target,point:needsUnit?undefined:p}))setMode(null);
      return;
    }
    if(repairMode){
      const target=unitAt(p,pick,u=>u.side===side&&!isMobile(u),screen);
      if(target&&command({type:'repair',ids:[...renderer.selected],target:target.id})){toast('建筑维修指令已下达');setMode(null);}
      else if(!target)toast('只能维修己方已完工建筑',true);
      return;
    }
    if((button===2&&(rallyMode||!renderer.selected.size))||(button===0&&rallyMode)){
      if(validPoint(p,renderer.camera.world)&&command({type:'rally',point:p})){toast('生产集结点已设置');setMode(null);}
      return;
    }
    if(button===2){issueAt(p,pick);return;}
    if(button!==0)return;
    if(attackMode){issueAt(p,pick);return;}
    const u=unitAt(p,pick,()=>true,screen);
    const node=nodeAt(p,pick);
    if(touch&&u?.side===side&&!isMobile(u)&&(u.construction<1||u.hp<u.maxHp)&&view.units.some(w=>renderer.selected.has(w.id)&&w.kind==='worker')){issueAt(p,pick);return;}
    if(u?.side===side){renderer.selectedNode=null;if(!shift)renderer.selected.clear();if(shift&&renderer.selected.has(u.id))renderer.selected.delete(u.id);else renderer.selected.add(u.id);soundscape.select(view,side,renderer.selected);}
    else if(node&&!view.units.some(w=>renderer.selected.has(w.id)&&w.kind==='worker')){renderer.selected.clear();renderer.selectedNode=node.id;soundscape.resource(node.kind);}
    else if(renderer.selected.size)issueAt(p,pick);
    else{renderer.selected.clear();renderer.selectedNode=null;}
    updateUI(true);
  },
});
function selectSameKind(point:Point,screen:Point){
  const unit=unitAt(point,renderer.pick(screen),u=>u.side===side,screen);
  if(!unit||!isMobile(unit))return;
  renderer.selected=new Set(view.units.filter(other=>{
    if(other.side!==side||other.kind!==unit.kind)return false;
    const p=renderer.projectUnit(other);
    return p.x>=0&&p.x<=renderer.width&&p.y>=0&&p.y<=renderer.height;
  }).map(u=>u.id));
  renderer.selectedNode=null;soundscape.select(view,side,renderer.selected);updateUI(true);
}
let lastWasTouch=false;
canvas.addEventListener('pointerdown',e=>{lastWasTouch=e.pointerType==='touch';});
canvas.ondblclick=e=>{
  e.preventDefault();if(lastWasTouch||!started||view.winner||buildKind||attackMode||rallyMode||repairMode)return;
  const bounds=canvas.getBoundingClientRect(),screen={x:e.clientX-bounds.left,y:e.clientY-bounds.top};
  selectSameKind(renderer.screenToWorld(screen),screen);
};
let miniDragging=false;function miniFocus(e:PointerEvent){const r=mini.getBoundingClientRect();renderer.focus({x:(e.clientX-r.left)/r.width*renderer.camera.world,y:(e.clientY-r.top)/r.height*renderer.camera.world});}
mini.onpointerdown=e=>{miniDragging=true;mini.setPointerCapture(e.pointerId);miniFocus(e);};mini.onpointermove=e=>{if(miniDragging)miniFocus(e);};mini.onpointerup=()=>miniDragging=false;mini.onpointercancel=()=>miniDragging=false;
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!home&&!operationOpen&&!dialog.open&&!attackMode&&!rallyMode&&!repairMode&&!buildKind&&!skillMode&&!stationMode&&!dispatchExpanded)renderer.selectedNode=null;
  if(!dialog.open&&!$('battle-loading').hidden){if(e.key==='Escape'){e.preventDefault();returnHome();}return;}
  if(operationOpen){
    if(dialog.open||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key.toLowerCase()==='f'){e.preventDefault();void toggleFullscreen();return;}
    if(e.key==='?'){e.preventDefault();help();return;}
    operation?.handleKey(e);return;
  }
  if(home){handleHomeKeys(e);return;}
  if(dialog.open||e.isComposing||e.target instanceof HTMLElement&&e.target.closest('input, game-select, textarea, [contenteditable]'))return;
  // 页面缩放拦截也会取消 Ctrl/Cmd + 0 的默认操作，战场仍需收到这条编队指令。
  const group=started&&!view.winner?groupShortcut(e):undefined;
  if(group){
    setMouseGroupAction(undefined);
    e.preventDefault();
    if(!e.repeat)controlGroup(group.key,group.action);
    return;
  }
  if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
  const k=e.key.toLowerCase();
  if(k===' '&&e.target instanceof HTMLButtonElement)return;
  if(['arrowup','arrowdown','arrowleft','arrowright',' ','f2','f3','p','q','e','r','a','h','x','g','f','v','b','z','c','t','j','i','o','l','+','=','-','−'].includes(k))e.preventDefault();
  keys.add(k);
  if(e.repeat)return;
  if(k==='t'&&buildKind){rotateBuilding();return;}
  if(k==='?'){help();return;}
  if(k==='u'||k==='y'){const button=skillPanel.querySelectorAll<HTMLButtonElement>('button[data-skill]')[k==='u'?0:1];if(button){e.preventDefault();button.click();}return;}
  if(k==='escape'){
    if(mouseGroupAction){setMouseGroupAction(undefined);return;}
    if(app.classList.contains('theater-mode')){app.classList.remove('theater-mode');syncFullscreen();}
    else if(attackMode||rallyMode||repairMode||buildKind||skillMode||stationMode)setMode(null);
    else if(dispatchExpanded)setDispatch(false);
    else{renderer.selected.clear();updateUI(true);}
    return;
  }
  if(k==='p'){togglePause();return;}
  if(k===' '){spaceDragged=false;canvas.classList.add('camera-grab');return;}
  if(k==='f'){void toggleFullscreen();return;}
  if(k==='z'||k==='c'){renderer.orbit(k==='z'?-1:1);return;}
  if(k==='+'||k==='='){changeZoom(1.18);return;}
  if(k==='-'||k==='−'){changeZoom(1/1.18);return;}
  if(k==='v'){toggleHud();return;}
  if(k==='b'){if(!hudVisible)toggleHud();setDispatch(!dispatchExpanded);return;}
  if(k==='f2'){selectAll();return;}
  if(k==='f3'){if(started)selectIdleWorker(true);return;}
  if(!started)return;
  if(k==='q'||k==='e'||k==='r')command({type:'train',kind:trainingShortcuts[k]});
  else if(k==='i'||k==='o'||k==='l'){
    if(k==='o'&&!view.oilWells){toast('此战局使用采集车采油');return;}
    beginBuilding(buildingShortcuts[k]);
  }
  else if(k==='a'){if(renderer.selected.size)setMode('attack');else toast('先选择作战部队');}
  else if(k==='j')beginRepair();
  else if(k==='g')setMode('rally');
  else if(k==='h'||k==='x')command({type:k==='h'?'hold':'stop',ids:[...renderer.selected]});
});
window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());if(e.key===' '){canvas.classList.remove('camera-grab');if(!spaceDragged&&document.activeElement===canvas&&!dialog.open)focusBase();spaceDragged=false;}});window.addEventListener('blur',()=>{keys.clear();controls.clear();});
document.addEventListener('visibilitychange',()=>{soundscape.reset(view,side,false);if(document.hidden&&!network&&started&&!view.winner&&!paused){paused=true;$('pause-overlay').hidden=false;keys.clear();updateUI(true);}});
window.addEventListener('beforeunload',()=>{if(started&&!network)try{storeLocalBattle();}catch{/* Browser storage can be disabled. */}});
let lastAutosave=0,lastRender=-Infinity;
let lastRenderCost=0,frameRequest=0;
function queueFrame(){if(!frameRequest)frameRequest=requestAnimationFrame(frame);}
function frame(now:number){
  frameRequest=0;
  if(home){lastFrame=0;return;}
  const gap=lastFrame?now-lastFrame:0,delta=Math.min(.1,gap/1000);lastFrame=now;
  if(operationOpen||!renderer.ready||!$('battle-loading').hidden||document.hidden){
    soundscape.tick(view,side,renderer.camera,operationOpen?'menu':'quiet',now);
    renderer.performance.reset();queueFrame();return;
  }
  if(!dialog.open){const speed=560*delta;renderer.pan((Number(keys.has('arrowright'))-Number(keys.has('arrowleft')))*speed,(Number(keys.has('arrowdown'))-Number(keys.has('arrowup')))*speed);}
  if(started&&!network&&!paused&&!view.winner){
    accumulator+=delta;
    let steps=0;
    while(accumulator>=.05&&steps<5){engine.step(.05);accumulator-=.05;steps++;}
    if(steps){
      view=engine.view(side);
      if(view.time-lastAutosave>=30){lastAutosave=view.time;try{storeLocalBattle();$('system-state').textContent=`自动存档已更新 · ${time(view.time)}`;}catch{/* Manual save reports storage errors. */}}
    }
  }
  soundscape.tick(view,side,renderer.camera,started&&!(paused&&!network)&&(!network||socket?.readyState===WebSocket.OPEN)?'battle':'quiet',now,renderer.selected);
  const live=started&&!view.winner&&(network||!paused);
  renderer.samplePerformance(gap,lastRenderCost,now,live&&!dialog.open);
  const interval=1000/(live?renderer.performance.fps:24);
  if(!document.hidden&&now-lastRender>=interval-.9){
    lastRender=now-lastRender>interval*2?now:lastRender+interval;
    const drawStart=performance.now();renderer.draw(view,now);lastRenderCost=performance.now()-drawStart;
    updateUI();
  }
  queueFrame();
}
$('continue-game').onclick=loadGame;$('home-codex').onclick=codex;$('home-settings').onclick=settings;
$('home-help').onclick=help;
window.addEventListener('storage',e=>{if(home&&e.key===LOCAL_SAVE_KEY)refreshHomeSave();});
function syncLanguage(){
  hideCommandTooltip();
  const select=document.querySelector<GameSelect>('#game-language');if(select)select.value=getLanguage();
  productionKey=renderDetailsKey=renderSelectedKey=renderQueueKey='';updateUI(true);refreshHomeSave();
}
onLanguageChange(syncLanguage);syncLanguage();
syncSound();
try{const saved=JSON.parse(sessionStorage.getItem(SEAT_KEY)||'null');if(saved&&(PAGES_BUILD?parseInvite(saved.code):/^[A-F0-9]{6}$/.test(saved.code))&&/^[a-f0-9]{64}$/.test(saved.token)){reconnectTicket=saved;roomCode=saved.code;retryNetwork();}}catch{/* 无效席位记录不影响本地游戏。 */}
if(PAGES_BUILD&&parseInvite(location.href)&&!reconnectTicket)multiplayer();

function showTargetHint(message:string){
  $('command-hint').hidden=false;$('command-message').textContent=message+' · × / Esc 取消';canvas.style.cursor='crosshair';
}
function updateSkills(selected:ViewState['units'],player:Player){
  const ids=player.race?[...new Set(selected.flatMap(u=>isMobile(u)?abilitiesFor(u.kind as MobileKind):[]))]:[];
  const facility=player.race?selected.find(u=>u.kind==='assembly'||u.kind==='factory'||!isMobile(u)&&!complete(u)):undefined;
  const single=selected.length===1?selected[0]:undefined,now=view.time;
  const effects=single?.ability?.effects.filter(s=>s.until>now)??[];
  const status=[...new Set(effects.map(s=>s.group))].map(g=>`${statusLabels[g]} ${Math.max(...effects.filter(s=>s.group===g).map(s=>s.until-now)).toFixed(1)}s`);
  const shield=single&&maxShield(single)?`原生盾 ${Math.ceil(single.shield??0)}/${maxShield(single)}`:'';
  const barrier=effects.find(s=>s.group==='barrier');
  if(barrier)status.push(`临时盾 ${Math.ceil(barrier.value)}`);
  const energy=single?.ability&&ids.length?`能量 ${Math.floor(single.ability.energy)}/100`:'';
  const actions=ids.map(id=>{
    const spec=ABILITIES[id],casters=selected.filter(u=>u.kind===spec.unit&&u.ability);
    if(id==='IND-01')return `<button type="button" data-medic="${casters.some(u=>u.ability?.auto===false)?'on':'off'}">自动治疗 ${casters.some(u=>u.ability?.auto===false)?'关':'开'}</button>`;
    const locked=spec.research&&!player.tech.includes(id),reason=locked?spec.research!.name:casters.every(u=>u.ability?.effects.some(e=>e.group==='silence'&&e.until>now))?'沉默':
      casters.every(u=>u.ability!.energy<spec.energy)?'能量不足':'';
    const ready=casters.filter(u=>u.ability!.energy>=spec.energy&&(u.ability!.cooldowns[id]??0)<=now&&!u.ability!.cast&&(u.ability!.recovery??0)<=now&&!u.ability!.effects.some(e=>e.group==='silence'&&e.until>now)).length;
    const wait=Math.max(0,Math.min(...casters.map(u=>(u.ability!.cooldowns[id]??0)-now)));
    const detail=`${spec.summary} · ${spec.energy} 能量 · ${spec.cooldown}s 冷却 · 射程 ${spec.range}`;
    return `<button type="button" data-skill="${id}" title="${escape(detail)}" aria-label="${spec.name}，${escape(detail)}" ${locked?'aria-disabled="true"':''}><b>${spec.name}</b><small>${reason||(!ready&&wait?Math.ceil(wait)+'s 冷却':`${spec.energy}◇ · ${ready}/${casters.length}`)}</small></button>`;
  });
  if(facility&&!complete(facility))actions.push(`<button data-cancel-build="${facility.id}">取消施工</button>`);
  if(facility?.kind==='assembly'&&complete(facility)){
    const mode=facility.station?.mode;
    if(!mode)actions.push(`<button data-station="pack" data-unit="${facility.id}">收拢装配站</button>`);
    if(mode==='mobile')actions.push(`<button data-station="move" data-unit="${facility.id}">移动装配站</button>`,`<button data-station="deploy" data-unit="${facility.id}">架设装配站</button>`);
    if(mode)actions.push(`<button data-station="stop" data-unit="${facility.id}">停止 ${facility.station?.until?Math.ceil(Math.max(0,facility.station.until-now))+'s':''}</button>`);
  }
  if(facility?.kind==='factory'&&complete(facility)&&player.tech.includes('tier2')){
    actions.push(`<button data-module="${facility.factoryModule==='support'?'armor':'support'}" data-unit="${facility.id}" ${facility.refitUntil?'disabled':''}>${facility.refitUntil?'换装中 '+Math.ceil(facility.refitUntil-now)+'s':facility.factoryModule==='support'?'换装装甲模块':'换装支援模块'}</button>`);
  }
  const feedback=selected.find(u=>u.ability?.feedback&&u.ability.feedback.until>now)?.ability?.feedback?.text;
  const caption=[energy,shield,feedback,...status].filter(Boolean).join(' · ');
  const html=(caption?`<output>${caption}</output>`:'')+actions.join('');
  skillPanel.hidden=!html||!started||paused&&!network;
  if(html!==skillRenderKey){skillRenderKey=html;skillPanel.innerHTML=html;}
}
skillPanel.onclick=event=>{
  const b=(event.target as Element).closest('button');if(!b)return;
  const ids=[...renderer.selected];
  if(b.dataset.medic){command({type:'medic-auto',ids,enabled:b.dataset.medic==='on'});return;}
  if(b.dataset.cancelBuild){command({type:'cancel-build',id:Number(b.dataset.cancelBuild)});return;}
  if(b.dataset.module){command({type:'factory-module',id:Number(b.dataset.unit),module:b.dataset.module as 'armor'|'support'});return;}
  if(b.dataset.station){
    const id=Number(b.dataset.unit),action=b.dataset.station as 'pack'|'move'|'deploy'|'stop';
    if(action==='pack'||action==='stop')command({type:'station',id,action});
    else{setMode(null);stationMode={id,action};showTargetHint(action==='move'?'选择装配站移动目的地':'选择装配站架设位置');}
    return;
  }
  const id=b.dataset.skill as AbilityId|undefined;if(!id)return;
  const spec=ABILITIES[id];
  if(b.getAttribute('aria-disabled')==='true'){toast('需要研究'+spec.research!.name,true);return;}
  if(skillMode?.id===id){setMode(null);return;}
  if(spec.target==='self'){command({type:'cast',ids,skill:id});return;}
  setMode(null);skillMode={id,ids};
  const origin=view.units.find(u=>ids.includes(u.id)&&u.kind===spec.unit);
  if(origin)renderer.skillPreview={origin,range:spec.range,radius:spec.radius,point:null};
  showTargetHint(spec.name+' · '+spec.summary);
};
