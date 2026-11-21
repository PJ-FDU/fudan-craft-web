import type { LegacyBuildingKind,LegacyMobileKind } from './types.js';
import { assetPath } from './assets.js';
import { FACTION_AUDIO_DIR,type FactionEffect,type FactionLoop } from './faction-sounds.js';
import { FACTION_VOICES,type FactionVoiceId } from './faction-voice.js';

// 音频名称、台词和生成脚本共用此清单，避免素材与触发逻辑各维护一份。
export const EFFECTS = [
  'ui-hover','ui-click','ui-confirm','ui-error','order','build-start','complete','research',
  'rifle','scout-gun','sniper','tank-cannon','artillery-cannon','fighter-gun','mech-gun','tower-gun',
  'bullet-hit','shell-hit','explosion','collapse','heal','alarm','victory','defeat','bird',
  'select-base','select-barracks','select-factory','select-airfield','select-refinery',
  'select-research','select-lumbermill','select-powerplant','select-tower','select-gold','select-wood','select-oil',
] as const;
export type Effect = typeof EFFECTS[number]|FactionEffect;
export const BUILDING_LOOPS=['base-idle','base-production','barracks-idle','barracks-production',
  'factory-idle','factory-production','airfield-idle','airfield-production','refinery-idle',
  'research-idle','research-production','lumbermill-idle','powerplant-idle','tower-idle','construction'] as const;
export const LOOPS = ['menu','exploration','combat','wind','water','machinery',...BUILDING_LOOPS] as const;
export type Loop = typeof LOOPS[number]|FactionLoop;
export const BUILDING_AUDIO:Record<LegacyBuildingKind,{idle:Loop;production?:Loop}>={
  base:{idle:'base-idle',production:'base-production'},
  barracks:{idle:'barracks-idle',production:'barracks-production'},
  factory:{idle:'factory-idle',production:'factory-production'},
  airfield:{idle:'airfield-idle',production:'airfield-production'},
  refinery:{idle:'refinery-idle'},research:{idle:'research-idle',production:'research-production'},
  oilwell:{idle:'machinery'},lumbermill:{idle:'lumbermill-idle'},powerplant:{idle:'powerplant-idle'},tower:{idle:'tower-idle'},
};
export const UNIT_LINES:Record<LegacyMobileKind,{select:string;move:string;attack:string}> = {
  worker:{select:'工程组，听着呢。',move:'行，我过去。',attack:'收到，马上到。'},
  soldier:{select:'小队在这儿。',move:'跟上。',attack:'开火！'},
  scout:{select:'侦察组，随时出发。',move:'我先探探路。',attack:'目标锁定。'},
  medic:{select:'医疗组到。',move:'撑住，我过来。',attack:'给我掩护，我来救人。'},
  sniper:{select:'幽影就位。',move:'悄悄过去。',attack:'看见目标了。'},
  tank:{select:'车组就位。',move:'挂挡，推进。',attack:'主炮，开火！'},
  artillery:{select:'炮组就位。',move:'换阵地。',attack:'炮击！'},
  fighter:{select:'猎隼，等你指示。',move:'转入航线。',attack:'准备俯冲。'},
  mech:{select:'泰坦驾驶员，听令。',move:'大步向前。',attack:'重火力，开火！'},
};
export const ANNOUNCER = {
  start:'指挥链路已建立。',
  ready:'单位就绪。',
  training:'开始训练。',
  building:'开始施工。',
  complete:'建筑完成。',
  research:'研发完成。',
  researching:'开始研究。',
  baseAttack:'基地遭到攻击！',
  lowPower:'电力不足。',
  unitLost:'单位损失。',
  victory:'战役胜利。',
  defeat:'基地失守。',
} as const;
const EN_UNIT_LINES:Record<LegacyMobileKind,{select:string;move:string;attack:string}>={
  worker:{select:'Engineering, go ahead.',move:'Yep, I’m on my way.',attack:'Copy. I’ll be right there.'},
  soldier:{select:'Squad’s here.',move:'On me.',attack:'Open fire!'},
  scout:{select:'Scout, ready to roll.',move:'I’ll take point.',attack:'Target locked.'},
  medic:{select:'Medical team ready.',move:'Hang on, I’m coming.',attack:'Cover me. I’ll get them.'},
  sniper:{select:'Ghost ready.',move:'Moving. Keep it quiet.',attack:'I have eyes on the target.'},
  tank:{select:'Crew ready.',move:'In gear. Moving.',attack:'Main gun, fire!'},
  artillery:{select:'Gun crew ready.',move:'New firing position.',attack:'Fire!'},
  fighter:{select:'Falcon, standing by.',move:'Changing course.',attack:'Going in!'},
  mech:{select:'Titan pilot, standing by.',move:'Moving up.',attack:'Heavy guns, fire!'},
};
const CHINESE_ALTERNATES:Record<LegacyMobileKind,{select:string;move:string}>={
  worker:{select:'这儿是工程组。',move:'好，这就来。'},
  soldier:{select:'等你下令。',move:'走，跟紧。'},
  scout:{select:'侦察组，听得到。',move:'我去前面看看。'},
  medic:{select:'医疗组在。',move:'让我过去。'},
  sniper:{select:'我在听。',move:'我换个位置。'},
  tank:{select:'车长在。',move:'慢一点，往前。'},
  artillery:{select:'炮组报到。',move:'收炮，走。'},
  fighter:{select:'猎隼，收到。',move:'正在转向。'},
  mech:{select:'泰坦驾驶员在。',move:'这就过去。'},
};
const ENGLISH_ALTERNATES:Record<LegacyMobileKind,{select:string;move:string}>={
  worker:{select:'Engineering here.',move:'Sure, I’ll head over.'},
  soldier:{select:'Waiting on you.',move:'Stay with me.'},
  scout:{select:'Scout here.',move:'I’ll check up ahead.'},
  medic:{select:'Medic here.',move:'Make a little room.'},
  sniper:{select:'I’m listening.',move:'Changing position.'},
  tank:{select:'Commander here.',move:'Easy forward.'},
  artillery:{select:'Gun crew standing by.',move:'Pack it up. Let’s move.'},
  fighter:{select:'Falcon, reading you.',move:'Turning now.'},
  mech:{select:'Titan pilot here.',move:'I’m moving in.'},
};
const EN_ANNOUNCER:Record<keyof typeof ANNOUNCER,string>={
  start:'Command link established.',ready:'Unit ready.',training:'Training started.',
  building:'Construction started.',complete:'Building complete.',research:'Research complete.',
  researching:'Research started.',baseAttack:'Base under attack!',lowPower:'Low power.',
  unitLost:'Unit lost.',victory:'Victory.',defeat:'Base lost.',
};
export type UnitVoiceAction='select'|'move'|'attack';
type ClassicVoiceId = `unit-${LegacyMobileKind}-${UnitVoiceAction|'select-alt'|'move-alt'}`
  | `unit-worker-${'gather'|'repair'}` | `command-${keyof typeof ANNOUNCER}`;
export type VoiceId=ClassicVoiceId|FactionVoiceId;

function voiceCatalog(
  units:typeof UNIT_LINES, alternates:typeof CHINESE_ALTERNATES, commands:typeof EN_ANNOUNCER,
  worker:{gather:string;repair:string},
):Record<ClassicVoiceId,string>{
  return Object.fromEntries([
    ...Object.entries(units).flatMap(([kind,lines])=>Object.entries(lines).map(([action,text])=>[`unit-${kind}-${action}`,text])),
    ...Object.entries(alternates).flatMap(([kind,lines])=>Object.entries(lines).map(([action,text])=>[`unit-${kind}-${action}-alt`,text])),
    ...Object.entries(worker).map(([action,text])=>[`unit-worker-${action}`,text]),
    ...Object.entries(commands).map(([key,text])=>[`command-${key}`,text]),
  ]) as Record<ClassicVoiceId,string>;
}
export const VOICES=voiceCatalog(UNIT_LINES,CHINESE_ALTERNATES,ANNOUNCER,{gather:'行，我去采集。',repair:'我去修，交给我。'});
export const EN_VOICES=voiceCatalog(EN_UNIT_LINES,ENGLISH_ALTERNATES,EN_ANNOUNCER,{gather:'Yep, I’ll gather it.',repair:'I’ll get it fixed.'});
export function voiceText(id:VoiceId,language:'zh'|'en'){
  const line=FACTION_VOICES.get(id as FactionVoiceId);
  return line?line[language==='en'?1:0]:(language==='en'?EN_VOICES:VOICES)[id as ClassicVoiceId];
}
export function audioPath(name:Effect|Loop|VoiceId,language:'zh'|'en'='zh'){
  const factionVoice=FACTION_VOICES.has(name as FactionVoiceId);
  const prefix=language==='en'&&(Object.hasOwn(VOICES,name)||factionVoice)?'en-':'';
  const factionDirectory=`audio/${FACTION_AUDIO_DIR}`;
  const directory=factionVoice?`${factionDirectory}/voice-qwen3-v1`:name.startsWith('faction-')?factionDirectory:'audio';
  return assetPath(`${directory}/${prefix}${name}.mp3`);
}
