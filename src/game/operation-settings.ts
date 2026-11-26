import { bindingError,DEFAULT_BINDINGS,defaultPreferences,operationText as text,savePreferences,type Binding,type OperationPreferences,type NoticeKind } from './operation-preferences.js';

export function bindOperationSettings(root:HTMLElement,prefs:OperationPreferences,apply:()=>void){
  const panel=document.createElement('div');panel.className='operation-settings';
  const toggle=(key:string,zh:string,en:string,checked:boolean)=>`<label class="toggle-label">${text(zh,en)}<input type="checkbox" data-operation="${key}" ${checked?'checked':''}></label>`;
  const labels:Record<string,[string,string]>={continuousBuild:['持续建造（Esc 退出）','Continuous building (Esc to exit)'],reverseZoom:['反向滚轮缩放','Reverse wheel zoom'],edgeScroll:['鼠标边缘滚屏','Scroll at screen edges']};
  const names:Record<string,[string,string]>={army:['全军','Army'],idle:['空闲采集车','Idle harvester'],pause:['暂停','Pause'],attack:['攻击移动','Attack move'],repair:['维修','Repair'],stop:['停止','Stop'],hold:['驻守','Hold'],rally:['集结点','Rally'],resume:['继续施工','Resume construction'],refinery:['精炼厂','Refinery'],oilwell:['油井','Oil well'],lumbermill:['木材厂','Lumber mill']};
  const notices:Record<NoticeKind,[string,string]>={attack:['基地受袭','Base under attack'],depleted:['资源枯竭','Resource depleted'],population:['人口不足','Population full'],construction:['施工停滞','Construction stalled']};
  panel.innerHTML=`<h3>${text('操作与镜头','Controls and camera')}</h3>${Object.entries(labels).map(([k,[zh,en]])=>toggle(k,zh,en,prefs[k as 'continuousBuild'])).join('')}
    <label class="toggle-label">${text('平移速度','Pan speed')}<input data-operation="panSpeed" type="range" min="160" max="1600" step="40" value="${prefs.panSpeed}"><output>${prefs.panSpeed}</output></label>
    <label class="toggle-label">${text('缩放灵敏度','Zoom sensitivity')}<input data-operation="zoomSensitivity" type="range" min=".25" max="3" step=".25" value="${prefs.zoomSensitivity}"><output>${prefs.zoomSensitivity}</output></label>
    <h3>${text('通知','Notifications')}</h3>${Object.entries(notices).map(([k,[zh,en]])=>`<div class="notice-settings"><span>${text(zh,en)}</span>${toggle(k+'.sound','声音','Sound',prefs.notices[k as NoticeKind].sound)}${toggle(k+'.visual','视觉','Visual',prefs.notices[k as NoticeKind].visual)}</div>`).join('')}
    <details><summary>${text('自定义快捷键','Customize hotkeys')}</summary><p>${text('点击输入框后按新键；数字编队、镜头和界面按键保留。','Focus a field and press a key. Group, camera and interface keys are reserved.')}</p>
    <div class="binding-grid">${Object.keys(DEFAULT_BINDINGS).map(k=>`<label>${names[k]?text(...names[k]):text('训练槽位 ','Training slot ')+k.slice(5)}<input readonly data-binding="${k}" aria-label="${names[k]?text(...names[k]):text('训练槽位 ','Training slot ')+k.slice(5)}"></label>`).join('')}</div>
    <p role="status" class="binding-feedback"></p><button class="secondary-button" data-reset-bindings>${text('恢复默认快捷键','Reset hotkeys')}</button></details>
    <p class="room-note">${text('偏好自动保存到本浏览器。Shift 追加任务；触屏可打开「追加任务」。','Preferences save in this browser. Shift appends tasks; touch users can enable Append tasks.')}</p>`;
  root.querySelector('.operation-settings')?.remove();root.append(panel);
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
  const refresh=()=>panel.querySelectorAll<HTMLInputElement>('[data-binding]').forEach(input=>input.value=prefs.bindings[input.dataset.binding as Binding].toUpperCase());
  refresh();
  panel.querySelectorAll<HTMLInputElement>('[data-binding]').forEach(input=>input.onkeydown=e=>{
    if(e.key==='Tab')return;e.preventDefault();e.stopPropagation();
    const action=input.dataset.binding as Binding,key=e.key.toLowerCase(),error=e.ctrlKey||e.metaKey||e.altKey?text('使用不带修饰键的按键','Use a key without modifiers'):bindingError(prefs.bindings,action,key);
    panel.querySelector('.binding-feedback')!.textContent=error??text('快捷键已保存','Hotkey saved');
    if(!error){prefs.bindings[action]=key;savePreferences(prefs);refresh();apply();}
  });
  panel.querySelector<HTMLButtonElement>('[data-reset-bindings]')!.onclick=()=>{prefs.bindings=defaultPreferences().bindings;savePreferences(prefs);refresh();apply();};
}
