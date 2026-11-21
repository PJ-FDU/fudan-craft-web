import { VOICES,audioPath,voiceText,type Effect,type Loop,type VoiceId } from './audio-catalog.js';
import { fieldLoop,factionCue } from './faction-sounds.js';
import { factionUnitVoice } from './faction-voice.js';
import { ROSTERS } from './races.js';
import type { Race } from './types.js';

export const AUDIO_STORAGE_KEY='fudancraft-audio-v1';
export const AUDIO_CHANNELS=['master','music','effects','ambient','voice'] as const;
export type AudioChannel=typeof AUDIO_CHANNELS[number];
export interface AudioSettings extends Record<AudioChannel,number>{enabled:boolean;subtitles:boolean}
export const DEFAULT_AUDIO:AudioSettings={enabled:true,subtitles:true,master:.7,music:.42,effects:.72,ambient:.35,voice:.85};
export function parseAudioSettings(raw:string|null):AudioSettings{
  const settings={...DEFAULT_AUDIO};
  try{
    const value:unknown=JSON.parse(raw||'null');
    if(!value||typeof value!=='object')return settings;
    const data=value as Record<string,unknown>;
    for(const key of AUDIO_CHANNELS){const n=data[key];if(typeof n==='number'&&Number.isFinite(n))settings[key]=Math.max(0,Math.min(1,n));}
    for(const key of ['enabled','subtitles'] as const)if(typeof data[key]==='boolean')settings[key]=data[key];
  }catch{/* 损坏或旧版设置使用默认值，不阻断游戏启动。 */}
  return settings;
}
type Bus=Exclude<AudioChannel,'master'>;
type Mode='menu'|'quiet'|'exploration'|'combat'|'victory'|'defeat';
interface SoundSource {source:AudioBufferSourceNode;gain:GainNode;pan?:StereoPannerNode;channel:Bus;loop?:Loop;level:number}
interface VoiceRequest {id:VoiceId;priority:number;expires:number;generation:number}
export interface BuildingSound {key:string;loop:Loop;level:number;pan:number}
export class GameAudio {
  readonly settings:AudioSettings;
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private buses=new Map<Bus,GainNode>();
  private buffers=new Map<string,Promise<AudioBuffer|null>>();
  private failedUntil=new Map<string,number>();
  private sources=new Set<SoundSource>();
  private loops=new Map<Loop,SoundSource>();
  private pendingLoops=new Set<Loop>();
  private voiceQueue:VoiceRequest[]=[];
  private useAlternate=new Set<VoiceId>();
  private currentVoice:{source:SoundSource;priority:number}|null=null;
  private cooldowns=new Map<string,number>();
  private generation=0;
  private voiceGeneration=0;
  private mode:Mode='quiet';
  private hidden=false;
  private unlocked=false;
  private pumping=false;
  private ducked=false;
  private lastWarning=false;
  private water=0;
  private faction?:Race;
  private language:'zh'|'en'='zh';
  private buildingMix:BuildingSound[]=[];
  private buildingSources=new Map<string,SoundSource>();
  private pendingBuildings=new Set<string>();
  constructor(private caption:(speaker:string,text:string)=>void,private warning:(text:string)=>void){
    let raw=null;try{raw=localStorage.getItem(AUDIO_STORAGE_KEY);}catch{/* 存储不可用时仍可播放。 */}
    this.settings=parseAudioSettings(raw);
  }
  get ready(){return this.context?.state==='running'&&this.unlocked&&!this.hidden;}
  setLanguage(language:'zh'|'en'){if(language===this.language)return;this.language=language;this.clearVoice();this.useAlternate.clear();this.cooldowns.clear();}
  set<K extends keyof AudioSettings>(key:K,value:AudioSettings[K]){
    if(typeof value==='number')value=Math.max(0,Math.min(1,value)) as AudioSettings[K];
    this.settings[key]=value;
    try{localStorage.setItem(AUDIO_STORAGE_KEY,JSON.stringify(this.settings));}catch{/* 无存储也支持当前会话设置。 */}
    if(!this.settings.enabled||this.settings.voice===0||this.settings.master===0)this.clearVoice();
    if(!this.settings.enabled||this.settings.master===0){this.generation++;this.stopEffects();}
    if(!this.settings.subtitles)this.caption('','');
    this.applyVolumes();
    if(this.settings.enabled&&this.ready)this.ensureLoops();
  }
  async unlock(){
    if(!this.settings.enabled||this.hidden||this.ready)return;
    try{
      if(!this.context){
        this.context=new AudioContext();
        this.master=this.context.createGain();
        // 总线压缩器约束多人交火的瞬时峰值；各音轨仍保留动态。
        const limiter=this.context.createDynamicsCompressor();
        limiter.threshold.value=-8;limiter.knee.value=8;limiter.ratio.value=8;limiter.attack.value=.003;limiter.release.value=.18;
        this.master.connect(limiter);limiter.connect(this.context.destination);
        for(const bus of ['music','effects','ambient','voice'] as const){const gain=this.context.createGain();gain.connect(this.master);this.buses.set(bus,gain);}
        this.applyVolumes();
      }
      await this.context.resume();this.unlocked=true;
      this.ensureLoops();
      // 首次交互只预热常用声音；其他录音按需解码，首页不加载战场图集。
      for(const key of ['ui-click','ui-hover','ui-confirm'] as const)void this.load(key);
    }catch{this.warn();}
  }
  private warn(){if(!this.lastWarning){this.lastWarning=true;this.warning('音频暂时无法加载，请检查网络后重新开启声音。');}}
  private load(name:Effect|Loop|VoiceId){
    const path=audioPath(name,this.language)+(Object.hasOwn(VOICES,name)?'?v=qwen3':'');
    if(performance.now()<(this.failedUntil.get(path)??0))return Promise.resolve(null);
    let pending=this.buffers.get(path);
    if(!pending){
      pending=fetch(path).then(response=>{if(!response.ok)throw Error(`Audio ${response.status}`);return response.arrayBuffer();})
        .then(data=>this.context!.decodeAudioData(data)).catch(()=>{this.buffers.delete(path);this.failedUntil.set(path,performance.now()+15000);this.warn();return null;});
      this.buffers.set(path,pending);
    }
    return pending;
  }
  private ramp(gain:GainNode,value:number,seconds=.18){
    const now=this.context!.currentTime;
    gain.gain.cancelAndHoldAtTime(now);gain.gain.linearRampToValueAtTime(value,now+seconds);
  }
  private applyVolumes(){
    if(!this.context||!this.master)return;
    this.ramp(this.master,this.settings.enabled&&!this.hidden?this.settings.master:0,.08);
    for(const [name,gain] of this.buses)this.ramp(gain,this.settings[name]*(name==='music'&&this.ducked?.4:1));
  }
  private create(buffer:AudioBuffer,channel:Bus,level:number,pan=0,loop?:Loop,rate=1){
    const context=this.context!,source=context.createBufferSource(),gain=context.createGain();
    source.buffer=buffer;source.loop=!!loop;source.playbackRate.value=rate;gain.gain.value=loop?0:level;source.connect(gain);
    const stereo=channel==='effects'||channel==='ambient'?context.createStereoPanner():undefined;
    if(stereo){stereo.pan.value=pan;gain.connect(stereo);stereo.connect(this.buses.get(channel)!);}else gain.connect(this.buses.get(channel)!);
    const item:SoundSource={source,gain,pan:stereo,channel,loop,level};this.sources.add(item);
    source.onended=()=>{
      this.sources.delete(item);source.disconnect();gain.disconnect();stereo?.disconnect();
      if(this.currentVoice?.source===item){this.currentVoice=null;this.caption('','');this.ducked=false;this.applyVolumes();void this.pumpVoice();}
    };
    // 三段配乐长度/BPM相同，共用时间原点，探索与战斗切换保持节拍连续。
    source.start(0,loop&&channel==='music'?context.currentTime%buffer.duration:0);
    return item;
  }
  effect(name:Effect,level=1,pan=0,cooldown=.06){
    this.oneShot(name,'effects',level,pan,cooldown);
  }
  ambient(name:Effect,level=1,pan=0,cooldown=.06){
    this.oneShot(name,'ambient',level,pan,cooldown);
  }
  private oneShot(name:Effect,bus:'effects'|'ambient',level:number,pan:number,cooldown:number){
    if(!this.ready||!this.settings.enabled||!this.settings.master||!this.settings[bus])return;
    const now=performance.now(),key=`${bus}:${name}`;
    if(now-(this.cooldowns.get(key)??-Infinity)<cooldown*1000)return;
    this.cooldowns.set(key,now);
    const generation=this.generation;
    void this.load(name).then(buffer=>{
      if(!buffer||generation!==this.generation||!this.ready||!this.settings.enabled||!this.settings.master||!this.settings[bus]||performance.now()-now>650)return;
      // 不让大规模战斗产生无限并发音源。
      const effects=[...this.sources].filter(s=>s.channel===bus&&!s.loop);
      if(effects.length>=(bus==='effects'?24:3))this.stop(effects[0]);
      this.create(buffer,bus,Math.max(0,Math.min(1,level)),Math.max(-1,Math.min(1,pan)),undefined,
        ['ui-hover','ui-click','ui-confirm','ui-error','alarm','victory','defeat'].includes(name)?1:.96+Math.random()*.08);
    });
  }
  voice(id:VoiceId,priority=1,cooldown=4,group:string=id){
    if(!this.ready||!this.settings.enabled||!this.settings.master||!this.settings.voice)return;
    const now=performance.now();
    // 普通回应共用节流，忙时直接丢弃，快速连点不会积压成一串废话。
    if(priority===1&&(this.currentVoice||this.pumping||this.voiceQueue.length||now-(this.cooldowns.get('routine')??-Infinity)<5000))return;
    if(now-(this.cooldowns.get(`voice:${group}`)??-Infinity)<cooldown*1000)return;
    this.cooldowns.set(`voice:${group}`,now);
    if(priority===1)this.cooldowns.set('routine',now);
    if(this.currentVoice&&priority>this.currentVoice.priority){const old=this.currentVoice.source;this.currentVoice=null;this.stop(old);this.caption('','');}
    // 紧急播报淘汰排队中的低优先级台词，最多保留三条。
    if(priority>=3)this.voiceQueue=this.voiceQueue.filter(v=>v.priority>=priority);
    this.voiceQueue.push({id,priority,expires:now+3500,generation:this.voiceGeneration});
    this.voiceQueue.sort((a,b)=>b.priority-a.priority);this.voiceQueue=this.voiceQueue.slice(0,3);
    void this.pumpVoice();
  }
  private async pumpVoice(){
    if(this.pumping||this.currentVoice)return;
    this.pumping=true;
    try{
      while(this.voiceQueue.length&&!this.currentVoice){
        const request=this.voiceQueue.shift()!;
        const alternate=`${request.id}-alt` as VoiceId;
        const rotates=Object.hasOwn(VOICES,alternate);
        const id=rotates&&this.useAlternate.has(request.id)?alternate:request.id;
        const buffer=await this.load(id);
        if(!buffer||request.generation!==this.voiceGeneration||request.expires<performance.now()||!this.ready||!this.settings.enabled||!this.settings.voice||!this.settings.master)continue;
        // 加载过程中可能插入更高优先级播报。
        if(this.voiceQueue.some(v=>v.priority>request.priority))continue;
        const source=this.create(buffer,'voice',1);
        if(rotates){
          if(id===alternate)this.useAlternate.delete(request.id);
          else this.useAlternate.add(request.id);
        }
        this.currentVoice={source,priority:request.priority};this.ducked=true;this.applyVolumes();
        if(this.settings.subtitles)this.caption(
          request.id.startsWith('command-')||request.id.includes('-command-')?(this.language==='en'?'COMMAND LINK':'指挥链路'):(this.language==='en'?'UNIT COMMS':'部队通讯'),
          voiceText(id,this.language));
      }
    }finally{this.pumping=false;}
  }
  private stop(item:SoundSource){this.sources.delete(item);try{item.source.stop();}catch{/* 已结束的音源无需再次停止。 */}}
  private stopEffects(){for(const s of this.sources)if(s.channel==='effects'||s.channel==='ambient'&&!s.loop)this.stop(s);}
  private clearVoice(){
    this.voiceGeneration++;this.voiceQueue=[];if(this.currentVoice){const item=this.currentVoice.source;this.currentVoice=null;this.stop(item);}
    this.caption('','');this.ducked=false;this.applyVolumes();
  }
  reset(){this.generation++;this.stopEffects();this.clearVoice();this.cooldowns.clear();this.buildings([]);}
  buildings(mix:BuildingSound[]){
    this.buildingMix=mix;
    const desired=new Set(mix.map(s=>`${s.key}:${s.loop}`));
    for(const [key,source] of this.buildingSources)if(!desired.has(key)){
      this.ramp(source.gain,0,.2);source.source.stop(this.context!.currentTime+.22);this.buildingSources.delete(key);
    }
    if(!this.ready||!this.settings.enabled||!this.settings.master||!this.settings.ambient)return;
    for(const sound of mix){
      const key=`${sound.key}:${sound.loop}`,source=this.buildingSources.get(key);
      if(source){this.ramp(source.gain,sound.level,.3);source.pan?.pan.setTargetAtTime(sound.pan,this.context!.currentTime,.15);continue;}
      if(this.pendingBuildings.has(key))continue;
      this.pendingBuildings.add(key);
      const generation=this.generation;
      void this.load(sound.loop).then(buffer=>{
        this.pendingBuildings.delete(key);
        const current=this.buildingMix.find(s=>`${s.key}:${s.loop}`===key);
        if(!buffer||!current||generation!==this.generation||!this.ready||!this.settings.enabled)return;
        const item=this.create(buffer,'ambient',0,current.pan,sound.loop);
        this.buildingSources.set(key,item);this.ramp(item.gain,current.level,.3);
      });
    }
  }
  visibility(hidden:boolean){
    this.hidden=hidden;this.applyVolumes();
    if(hidden){this.reset();void this.context?.suspend();}
    else if(this.unlocked&&this.settings.enabled)void this.context?.resume().then(()=>this.ensureLoops()).catch(()=>{});
  }
  scene(mode:Mode,water=0,race?:Race){
    this.mode=mode;this.water=water;
    if(mode!=='quiet'&&race!==this.faction){
      if(this.faction){
        const previous=fieldLoop(this.faction),source=this.loops.get(previous);
        if(source){this.ramp(source.gain,0,.65);source.source.stop(this.context!.currentTime+.7);this.loops.delete(previous);}
      }
      this.faction=race;
    }
    if(this.ready&&this.settings.enabled)this.ensureLoops();
    this.mixLoops();
  }
  private ensureLoops(){
    const names:Loop[]=this.mode==='menu'?['menu']:['exploration','combat','wind','water'];
    if(this.mode==='quiet')return;
    if(this.faction&&this.mode!=='menu')names.push(fieldLoop(this.faction));
    for(const name of names){
      if(this.loops.has(name)||this.pendingLoops.has(name))continue;
      this.pendingLoops.add(name);
      void this.load(name).then(buffer=>{
        this.pendingLoops.delete(name);
        if(!buffer||!this.ready||name.startsWith('faction-')&&(!this.faction||name!==fieldLoop(this.faction)))return;
        const item=this.create(buffer,['menu','exploration','combat'].includes(name)?'music':'ambient',0,0,name);
        this.loops.set(name,item);this.mixLoops();
      });
    }
  }
  private mixLoops(){
    if(!this.context)return;
    const levels:Partial<Record<Loop,number>>={
      menu:this.mode==='menu'?1:0,
      exploration:this.mode==='exploration'?1:this.mode==='combat'?.2:['victory','defeat'].includes(this.mode)?.5:this.mode==='quiet'?.16:0,
      combat:this.mode==='combat'?.92:0,
      wind:['exploration','combat'].includes(this.mode)?(this.faction ? .4 : 1):0,
      water:['exploration','combat'].includes(this.mode)?this.water:0,
    };
    if(this.faction)levels[fieldLoop(this.faction)]=this.mode==='exploration'?.95:this.mode==='combat'?.58:0;
    for(const [name,item] of this.loops)if(item.level!==(levels[name]??0)){item.level=levels[name]??0;this.ramp(item.gain,item.level,1.4);}
  }
  preview(race:Race='industrial'){
    this.effect(factionCue(race,'order'),.65);
    const id=factionUnitVoice(race,ROSTERS[race].opening[0],'select');
    if(id)this.voice(id,2,0);
  }
}
