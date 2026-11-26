import { assignBinding,bindingOwner,bindingName,BINDING_NAMES,supportedBinding,DEFAULT_BINDINGS,defaultPreferences,operationText as text,savePreferences,type Binding,type OperationPreferences,type NoticeKind } from './operation-preferences.js';
import { RACES,RACE_NAMES,STATS,type Race,type BuildingKind } from './types.js';
import { ROSTERS,producerFor } from './races.js';
import { t } from './locale.js';

export function bindOperationSettings(root:HTMLElement,prefs:OperationPreferences,apply:()=>void,race:Race='industrial'){
  const previous=root.querySelector<HTMLElement>('.operation-preferences');
  const previousView=previous?{open:previous.querySelector<HTMLDetailsElement>('.hotkey-settings')?.open,
    query:previous.querySelector<HTMLInputElement>('[data-binding-search]')?.value??'',
    race:previous.querySelector<HTMLSelectElement>('[data-binding-race]')?.value,
    producer:previous.querySelector<HTMLSelectElement>('[data-binding-producer]')?.value}:undefined;
  if(previousView?.race)race=previousView.race as Race;
  const panel=document.createElement('div');panel.className='operation-preferences';
  const toggle=(key:string,zh:string,en:string,checked:boolean)=>`<label class="toggle-label">${text(zh,en)}<input type="checkbox" data-operation="${key}" ${checked?'checked':''}></label>`;
  const labels:Record<string,[string,string]>={continuousBuild:['持续建造（Esc 退出）','Continuous building (Esc to exit)'],reverseZoom:['反向滚轮缩放','Reverse wheel zoom'],edgeScroll:['鼠标边缘滚屏','Scroll at screen edges']};
  const notices:Record<NoticeKind,[string,string]>={attack:['基地受袭','Base under attack'],depleted:['资源枯竭','Resource depleted'],population:['人口不足','Population full'],construction:['施工停滞','Construction stalled']};
  panel.innerHTML=`<h3>${text('操作与镜头','Controls and camera')}</h3>${Object.entries(labels).map(([k,[zh,en]])=>toggle(k,zh,en,prefs[k as 'continuousBuild'])).join('')}
    <label class="toggle-label">${text('平移速度','Pan speed')}<input data-operation="panSpeed" type="range" min="160" max="1600" step="40" value="${prefs.panSpeed}"><output>${prefs.panSpeed}</output></label>
    <label class="toggle-label">${text('缩放灵敏度','Zoom sensitivity')}<input data-operation="zoomSensitivity" type="range" min=".25" max="3" step=".25" value="${prefs.zoomSensitivity}"><output>${prefs.zoomSensitivity}</output></label>
    <h3>${text('通知','Notifications')}</h3>${Object.entries(notices).map(([k,[zh,en]])=>`<div class="notice-settings"><span>${text(zh,en)}</span>${toggle(k+'.sound','声音','Sound',prefs.notices[k as NoticeKind].sound)}${toggle(k+'.visual','视觉','Visual',prefs.notices[k as NoticeKind].visual)}</div>`).join('')}
    <details class="hotkey-settings"><summary>${text('自定义快捷键','Customize hotkeys')}</summary><p>${text('点击按键框，再按新键。Esc 取消；也可从列表选择。设置自动保存。','Click a key field, then press a new key. Esc cancels; you can also choose from the list. Changes save automatically.')}</p>
    <div class="manual-filters"><input type="search" data-binding-search placeholder="${text('搜索操作、单位或按键','Search action, unit or key')}" aria-label="${text('搜索快捷键','Search hotkeys')}">
    <label>${text('种族预览','Faction preview')}<select data-binding-race>${RACES.map(r=>`<option value="${r}" ${r===race?'selected':''}>${t(RACE_NAMES[r])}</option>`).join('')}</select></label>
    <label>${text('生产建筑','Producer')}<select data-binding-producer></select></label></div>
    <p class="room-note">${text('训练槽位按种族及选中生产建筑重新排列；实际派遣以调度面板上的单位与按键为准。预览不改变对局种族。','Training slots follow your faction and selected production buildings. Use the unit labels in Dispatch during battle. This preview does not change your faction.')}</p>
    <div data-binding-groups></div>
    <div class="binding-feedback" role="status" aria-live="polite"></div><div class="binding-conflict" hidden><button class="secondary-button" data-binding-swap>${text('交换这两个操作的按键','Swap these two hotkeys')}</button><button class="secondary-button" data-binding-cancel>${text('取消','Cancel')}</button></div>
    <button class="secondary-button" data-reset-bindings>${text('恢复全部默认快捷键','Reset all hotkeys')}</button>
    <details class="fixed-hotkeys"><summary>${text('固定按键与组合键','Fixed keys and modifiers')}</summary><p>${text('1–0 编队 · Ctrl / Cmd 保存 · Shift 加选 / 追加任务 · 方向键平移 · Space 回基地 / 拖图 · Z / C 旋转视角 · T 旋转建筑 · + / − 缩放 · F 全屏 · V 控制台 · B 调度 · U / Y 技能 · ? 帮助 · Esc 取消','1–0 groups · Ctrl / Cmd save · Shift add selection / append tasks · Arrows pan · Space base / drag · Z / C rotate view · T rotate building · + / − zoom · F fullscreen · V console · B dispatch · U / Y abilities · ? help · Esc cancel')}</p></details></details>
    <p class="room-note">${text('偏好自动保存到本浏览器。Shift 追加任务；触屏可打开「追加任务」。','Preferences save in this browser. Shift appends tasks; touch users can enable Append tasks.')}</p>`;
  root.querySelector('.operation-preferences')?.remove();root.append(panel);
  panel.querySelectorAll<HTMLInputElement>('.notice-settings input').forEach(input=>{
    const [kind,channel]=input.dataset.operation!.split('.') as [NoticeKind,'sound'|'visual'];
    input.setAttribute('aria-label',text(...notices[kind])+' · '+text(channel==='sound'?'声音':'视觉',channel==='sound'?'Sound':'Visual'));
  });
  panel.querySelectorAll<HTMLInputElement>('[data-operation]').forEach(input=>input.onchange=()=>{
    const key=input.dataset.operation!;
    if(key.includes('.')){const [kind,channel]=key.split('.') as [NoticeKind,'sound'|'visual'];prefs.notices[kind][channel]=input.checked;}
    else if(key==='panSpeed'||key==='zoomSensitivity'){prefs[key]=Number(input.value);input.nextElementSibling!.textContent=input.value;}
    else prefs[key as 'continuousBuild'|'reverseZoom'|'edgeScroll']=input.checked;
    savePreferences(prefs);apply();
  });
  const feedback=panel.querySelector<HTMLElement>('.binding-feedback')!,conflict=panel.querySelector<HTMLElement>('.binding-conflict')!;
  const raceSelect=panel.querySelector<HTMLSelectElement>('[data-binding-race]')!,producerSelect=panel.querySelector<HTMLSelectElement>('[data-binding-producer]')!,search=panel.querySelector<HTMLInputElement>('[data-binding-search]')!;
  search.value=previousView?.query??'';
  panel.querySelector<HTMLDetailsElement>('.hotkey-settings')!.open=!!previousView?.open;
  let pending:{action:Binding;key:string}|undefined;
  const cancel=()=>{pending=undefined;conflict.hidden=true;};
  const groups:{name:string;actions:Binding[]}[]=[
    {name:text('选择与战局','Selection and battle'),actions:['army','idle','pause']},
    {name:text('单位指令','Unit commands'),actions:['attack','repair','stop','hold','rally','resume']},
    {name:text('训练槽位','Training slots'),actions:Object.keys(DEFAULT_BINDINGS).filter(k=>k.startsWith('train')) as Binding[]},
    {name:text('资源建筑','Resource buildings'),actions:['refinery','oilwell','lumbermill']},
  ];
  const keys=[...'abcdefghijklmnopqrstuvwxyz',";","'","/",".",",","[","]","\\","`",...Array.from({length:11},(_,i)=>`f${i+2}`)].filter(supportedBinding);
  const filter=()=>{
    const query=search.value.trim().toLowerCase();
    panel.querySelectorAll<HTMLElement>('.binding-row').forEach(row=>row.hidden=!((row.querySelector('label')?.textContent??'')+' '+row.dataset.search+' '+prefs.bindings[row.dataset.action as Binding]).toLowerCase().includes(query));
    panel.querySelectorAll<HTMLElement>('.binding-group').forEach(group=>group.hidden=![...group.querySelectorAll<HTMLElement>('.binding-row')].some(row=>!row.hidden));
    panel.querySelector<HTMLElement>('.binding-empty')!.hidden=![...panel.querySelectorAll<HTMLElement>('.binding-group')].every(group=>group.hidden);
  };
  const refresh=()=>{panel.querySelectorAll<HTMLInputElement>('[data-binding]').forEach(input=>input.value=prefs.bindings[input.dataset.binding as Binding].toUpperCase());
    panel.querySelectorAll<HTMLSelectElement>('[data-key-picker]').forEach(select=>select.value=prefs.bindings[select.dataset.keyPicker as Binding]);
    panel.querySelectorAll<HTMLButtonElement>('[data-reset-binding]').forEach(button=>button.disabled=prefs.bindings[button.dataset.resetBinding as Binding]===DEFAULT_BINDINGS[button.dataset.resetBinding as Binding]);
    filter();
  };
  const save=()=>{cancel();savePreferences(prefs);refresh();apply();};
  const request=(action:Binding,key:string)=>{
    cancel();
    if(!supportedBinding(key)){feedback.textContent=text('此键用于固定操作或不受支持，请选择字母、标点或 F2–F12。','This key is reserved or unsupported. Choose a letter, punctuation or F2–F12.');refresh();return;}
    const owner=bindingOwner(prefs.bindings,action,key);
    if(owner){pending={action,key};conflict.hidden=false;feedback.textContent=`${key.toUpperCase()} · ${bindingName(owner)} → ${bindingName(action)}. `+text(`交换后「${bindingName(owner)}」使用 ${prefs.bindings[action].toUpperCase()}。`,`After swapping, ${bindingName(owner)} uses ${prefs.bindings[action].toUpperCase()}.`);refresh();return;}
    assignBinding(prefs.bindings,action,key);save();feedback.textContent=bindingName(action)+' · '+key.toUpperCase()+' · '+text('已保存','Saved');
  };
  const render=()=>{
    cancel();feedback.textContent='';
    const selectedRace=raceSelect.value as Race,roster=ROSTERS[selectedRace].units;
    const kinds=producerSelect.value?roster.filter(k=>producerFor(k,selectedRace)===producerSelect.value):roster;
    panel.querySelector<HTMLElement>('[data-binding-groups]')!.innerHTML=groups.map(group=>`<section class="binding-group"><h4>${group.name}</h4><div class="binding-grid">${group.actions.map(action=>{
      const kind=action.startsWith('train')?kinds[Number(action.slice(5))-1]:undefined;
      return `<div class="binding-row" data-action="${action}"><label for="hotkey-${action}">${bindingName(action)}<small>${action.startsWith('train')?kind?t(STATS[kind].name)+' · '+t(STATS[producerFor(kind,selectedRace)!].name):text('当前预览无对应单位','No unit in this preview'):text('默认 ','Default ')+DEFAULT_BINDINGS[action].toUpperCase()}</small></label><input id="hotkey-${action}" readonly data-binding="${action}" aria-label="${bindingName(action)}" inputmode="none"><select data-key-picker="${action}" aria-label="${text('选择按键：','Choose key: ')+bindingName(action)}">${keys.map((key,i)=>`<option value="key-${i}">${key.toUpperCase()}</option>`).join('')}</select><button data-reset-binding="${action}" title="${text('恢复此项默认（占用时需交换）','Restore default (swap if occupied)')}" aria-label="${text('重置 ','Reset ')+bindingName(action)}">↺</button></div>`;
    }).join('')}</div></section>`).join('')+`<p class="binding-empty" hidden>${text('没有匹配的快捷键','No matching hotkeys')}</p>`;
    // option 值通过 DOM 写入，避免引号、反斜杠等键名进入 HTML 属性。
    panel.querySelectorAll<HTMLElement>('.binding-row').forEach(row=>{
      const action=row.dataset.action as Binding,kind=action.startsWith('train')?kinds[Number(action.slice(5))-1]:undefined;
      row.dataset.search=BINDING_NAMES[action].join(' ')+' '+(kind?STATS[kind].name+' '+STATS[kind].en:'');
    });
    panel.querySelectorAll<HTMLSelectElement>('[data-key-picker]').forEach(select=>{[...select.options].forEach((option,i)=>option.value=keys[i]);select.onchange=()=>request(select.dataset.keyPicker as Binding,select.value);});
    panel.querySelectorAll<HTMLInputElement>('[data-binding]').forEach(input=>{
      input.onfocus=()=>{cancel();feedback.textContent=bindingName(input.dataset.binding as Binding)+' · '+text('等待按键，Esc 取消','Press a key; Esc cancels');};
      input.onkeydown=e=>{
        if(e.key==='Tab')return;e.preventDefault();e.stopPropagation();
        if(e.key==='Escape'){cancel();input.blur();feedback.textContent=text('已取消，按键未更改','Cancelled; hotkey unchanged');return;}
        if(e.repeat||e.isComposing)return;
        if(e.ctrlKey||e.metaKey||e.altKey||e.shiftKey){feedback.textContent=text('请使用不带修饰键的按键；Shift 用于追加任务。','Use a key without modifiers; Shift appends tasks.');return;}
        request(input.dataset.binding as Binding,e.key.toLowerCase());
      };
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-reset-binding]').forEach(button=>button.onclick=()=>request(button.dataset.resetBinding as Binding,DEFAULT_BINDINGS[button.dataset.resetBinding as Binding]));
    refresh();
  };
  const producers=()=>{
    const selectedRace=raceSelect.value as Race;
    producerSelect.replaceChildren(new Option(text('整套种族阵容','Full faction roster'),''),...[...new Set(ROSTERS[selectedRace].units.map(k=>producerFor(k,selectedRace)!))].map(kind=>new Option(t(STATS[kind as BuildingKind].name),kind)));
    render();
  };
  raceSelect.onchange=producers;producerSelect.onchange=render;search.oninput=filter;
  panel.querySelector<HTMLButtonElement>('[data-binding-swap]')!.onclick=()=>{if(pending){assignBinding(prefs.bindings,pending.action,pending.key,true);save();feedback.textContent=text('两个操作已交换，设置已保存','Hotkeys swapped and saved');}};
  panel.querySelector<HTMLButtonElement>('[data-binding-cancel]')!.onclick=()=>{cancel();feedback.textContent=text('已取消，按键未更改','Cancelled; hotkeys unchanged');};
  panel.querySelector<HTMLButtonElement>('[data-reset-bindings]')!.onclick=()=>{prefs.bindings=defaultPreferences().bindings;save();feedback.textContent=text('全部快捷键已恢复默认','All hotkeys restored');};
  producers();
  if(previousView?.producer&&[...producerSelect.options].some(option=>option.value===previousView.producer)){producerSelect.value=previousView.producer;render();}
}
