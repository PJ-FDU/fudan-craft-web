import { AUDIO_CHANNELS,type AudioChannel,type GameAudio } from './audio.js';
import { getLanguage,setLanguage } from './locale.js';
import { RACES,RACE_NAMES,isRace } from './types.js';
import { dropdownMarkup,type GameSelect } from './dropdown.js';
const LABELS:Record<AudioChannel,string>={master:'总音量',music:'背景音乐',effects:'战斗与界面',ambient:'环境声',voice:'部队与指挥语音'};
export function audioSettingsMarkup(audio:GameAudio){
  return `<fieldset class="audio-settings"><legend>语言与语音 <small>LANGUAGE</small></legend>
    <div class="toggle-label select-setting"><span>游戏语言</span>${dropdownMarkup('game-language','游戏语言',[['zh','简体中文'],['en','English']],getLanguage())}</div>
    <p class="room-note">界面和语音同时切换，自动保存。</p></fieldset>
    <fieldset class="audio-settings"><legend>声音与通讯 <small>AUDIO MIX</small></legend>
    <label class="toggle-label">开启游戏声音<input id="audio-enabled" type="checkbox" ${audio.settings.enabled?'checked':''}></label>
    ${AUDIO_CHANNELS.map(key=>`<label class="audio-slider" for="audio-${key}"><span>${LABELS[key]}</span><input id="audio-${key}" type="range" min="0" max="100" step="1" value="${Math.round(audio.settings[key]*100)}"><output for="audio-${key}">${Math.round(audio.settings[key]*100)}%</output></label>`).join('')}
    <label class="toggle-label">显示通讯字幕<input id="audio-subtitles" type="checkbox" ${audio.settings.subtitles?'checked':''}></label>
    <div class="toggle-label select-setting"><span>试听阵营</span>${dropdownMarkup('audio-preview-race','试听阵营',RACES.map(race=>[race,RACE_NAMES[race]]))}</div>
    <button id="audio-preview" type="button" class="secondary-button">试听部队通讯 <span>▷</span></button>
    <p class="room-note">首次点击后开始播放。语音播报时音乐自动降低；切换到后台会暂停声音。偏好自动保存。</p>
  </fieldset>`;
}
export function bindAudioSettings(root:HTMLElement,audio:GameAudio,onChange:()=>void){
  const language=root.querySelector<GameSelect>('#game-language')!;
  language.onchange=()=>setLanguage(language.value==='en'?'en':'zh');
  root.querySelector<HTMLInputElement>('#audio-enabled')!.onchange=e=>{audio.set('enabled',(e.target as HTMLInputElement).checked);void audio.unlock();onChange();};
  for(const key of AUDIO_CHANNELS){
    const input=root.querySelector<HTMLInputElement>(`#audio-${key}`)!;
    input.oninput=()=>{audio.set(key,Number(input.value)/100);input.parentElement!.querySelector('output')!.textContent=`${input.value}%`;onChange();};
  }
  root.querySelector<HTMLInputElement>('#audio-subtitles')!.onchange=e=>audio.set('subtitles',(e.target as HTMLInputElement).checked);
  const preview=root.querySelector<HTMLButtonElement>('#audio-preview')!;
  const previewRace=root.querySelector<GameSelect>('#audio-preview-race')!;
  preview.onclick=()=>{
    if(!audio.settings.enabled||!audio.settings.master||!audio.settings.voice){
      preview.textContent='请先开启声音并调高总音量、语音音量';return;
    }
    const race=previewRace.value;
    if(isRace(race))void audio.unlock().then(()=>audio.preview(race));
  };
}
