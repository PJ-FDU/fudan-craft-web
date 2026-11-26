import { BUILDING_AUDIO,UNIT_LINES,type Effect,type Loop,type VoiceId } from './audio-catalog.js';
import { ABILITIES } from './abilities.js';
import { buildingCue,buildingLoop,constructionLoop,factionCue,skillCue,TRANSIT_LOOP,weaponCue } from './faction-sounds.js';
import { factionUnitVoice,type FactionAnnouncement,type FactionVoiceAction } from './faction-voice.js';
import { STATS,isCombat,isMobile,sameTeam,type BuildingKind,type LegacyBuildingKind,type Command,type Kind,type LegacyMobileKind,type Point,type Race,type Side,type ViewState } from './types.js';
import { getWorld } from './world.js';
import { covered,needsCoverage } from './races.js';
import { powerFor } from './engine.js';
import { type BuildingSound,type GameAudio } from './game-audio.js';
export * from './game-audio.js';

const raceOf=(view:ViewState,side:Side)=>view.players.find(p=>p.side===side)?.race;

/** Only visible activity contributes positional audio. Queued work alone does not. */
export function buildingSounds(view:ViewState,camera:Point,selected:ReadonlySet<number>=new Set()):BuildingSound[]{
  const working=new Set(view.units.filter(u=>u.activity==='build'||u.activity==='repair').map(u=>u.target));
  const powered=new Map(view.players.map(p=>[p.side,powerFor(p.side,view.units).active]));
  return view.units.flatMap(u=>{
    if(isMobile(u)||u.hp<=0)return [];
    const distance=Math.hypot(u.x-camera.x,u.y-camera.y);
    const level=Math.max(0,1-distance/650)*(selected.has(u.id)?.5:.23);
    if(level<=.015)return [];
    const race=raceOf(view,u.side),kind=u.kind as BuildingKind;
    const automatic=!!u.launched&&u.construction<1&&(!needsCoverage(kind)||covered(u.side,u,view.units));
    const constructing=working.has(u.id)||automatic||!!u.station;
    const producing=u.activity==='produce';
    let loop:Loop|undefined;
    if(u.station?.mode==='mobile')loop=TRANSIT_LOOP;
    else if(constructing)loop=race?constructionLoop(race):'construction';
    else if(u.construction>=1&&(STATS[kind].power<=0||powered.get(u.side))){
      if(race)loop=buildingLoop(race,kind,producing);
      else {
        const profile=BUILDING_AUDIO[kind as LegacyBuildingKind];
        if(profile)loop=producing?profile.production??profile.idle:profile.idle;
      }
    }
    const priority=level*(constructing||producing ? 1.5 : 1);
    return loop?[{priority,sound:{key:String(u.id),loop,level,pan:Math.max(-1,Math.min(1,(u.x-camera.x)/650))}}]:[];
  }).sort((a,b)=>b.priority-a.priority).slice(0,3).map(({sound})=>sound);
}

const WEAPON_SOUND:Partial<Record<Kind,Effect>>={soldier:'rifle',scout:'scout-gun',sniper:'sniper',tank:'tank-cannon',artillery:'artillery-cannon',fighter:'fighter-gun',mech:'mech-gun',tower:'tower-gun'};
export interface AudioEvent {effect?:Effect;voice?:FactionAnnouncement;point?:Point;priority?:number;combat?:true}
const historicDeath=(kind:Kind):Effect=>!isMobile({kind})?'collapse':['tank','scout','fighter','mech','artillery','worker'].includes(kind)?'explosion':'bullet-hit';

/** Only consume authoritative, currently visible events. IDs survive temporary changes in fog. */
export class AudioEvents {
  private seen=new Map<number,number>();
  private construction=new Set<number>();
  private tech=new Set<string>();
  private powered=true;
  reset(view:ViewState,side:Side){
    this.seen=new Map(view.events.map(e=>[e.id,e.time]));
    this.construction=new Set(view.units.filter(u=>u.side===side&&u.construction<1).map(u=>u.id));
    this.tech=new Set(view.players.find(p=>p.side===side)?.tech??[]);
    this.powered=powerFor(side,view.units).active;
  }
  collect(view:ViewState,side:Side):AudioEvent[]{
    const result:AudioEvent[]=[],cutoff=view.time-.8;
    for(const [id,time] of this.seen)if(time<cutoff)this.seen.delete(id);
    for(const event of view.events){
      if(this.seen.has(event.id)||event.time<cutoff)continue;
      this.seen.set(event.id,event.time);
      const {type,kind}=event,point={x:event.x,y:event.y},own=event.side===side,race=raceOf(view,event.side);
      if(type==='fire'){
        const shot=race&&STATS[kind].damage>0?weaponCue(race,kind,'fire'):WEAPON_SOUND[kind];
        if(shot)result.push({effect:shot,point,combat:true});
      }
      if(type==='impact')result.push({effect:race&&STATS[kind].damage>0?weaponCue(race,kind,'impact'):kind==='tank'||kind==='artillery'?'shell-hit':'bullet-hit',point});
      if(type==='cast'&&event.skill&&race)result.push({effect:skillCue(race,event.skill),point});
      if(type==='heal')result.push({effect:race?factionCue(race,'heal'):'heal',point});
      if(type==='death'){
        result.push({effect:race?(isMobile(event)?factionCue(race,'loss'):buildingCue(race,kind as BuildingKind,'collapse')):historicDeath(kind),point});
        if(own)result.push({voice:'unitLost',priority:2});
      }
      if(type==='damage'&&own&&kind==='base')result.push({effect:race?factionCue(race,'alarm'):'alarm',voice:'baseAttack',priority:4});
      if(type==='spawn'&&own)result.push({voice:'ready',priority:2});
      if(type==='complete'&&!isMobile(event)){
        if(race)result.push({effect:buildingCue(race,kind as BuildingKind,'finish'),point});
        if(own&&this.construction.delete(event.unit))result.push({effect:race?undefined:'complete',voice:'complete',priority:2});
      }
    }
    const player=view.players.find(p=>p.side===side);
    if(player?.tech.some(t=>!this.tech.has(t)))result.push({effect:player.race?factionCue(player.race,'research'):'research',voice:'research',priority:2});
    this.tech=new Set(player?.tech??[]);
    this.construction=new Set(view.units.filter(u=>u.side===side&&u.construction<1).map(u=>u.id));
    const powered=powerFor(side,view.units).active;
    if(this.powered&&!powered)result.push({voice:'lowPower',priority:3});
    this.powered=powered;
    return result;
  }
}

export class AudioDirector {
  baseAttackSound=true;
  private events=new AudioEvents();
  private active=false;
  private combatUntil=0;
  private nextAmbient=0;
  private ambientAlternate=false;
  private pendingStart=false;
  private winner:Side|null=null;
  private nextEnvironment=0;
  private water=0;
  private buildingMix:BuildingSound[]=[];
  constructor(readonly audio:GameAudio){}
  reset(view:ViewState,side:Side,announce=true){
    this.audio.reset();this.events.reset(view,side);this.active=false;this.combatUntil=0;
    this.pendingStart=announce;this.winner=view.winner;this.nextEnvironment=0;this.nextAmbient=0;this.buildingMix=[];
    this.water=0;this.ambientAlternate=false;
  }
  private announce(race:Race|undefined,line:FactionAnnouncement,priority:number,cooldown:number){
    const id=race?`faction-${race}-command-${line}` as const:`command-${line}` as const;
    this.audio.voice(id,priority,cooldown);
  }
  private response(race:Race|undefined,kind:Kind,action:FactionVoiceAction,group:'selection'|'orders'){
    let id:VoiceId|undefined;
    if(race)id=factionUnitVoice(race,kind as Parameters<typeof factionUnitVoice>[1],action);
    else if(action!=='cast'&&action!=='build'){
      if(action==='gather'||action==='repair')id=`unit-worker-${action}`;
      else id=`unit-${(Object.hasOwn(UNIT_LINES,kind)?kind:'scout') as LegacyMobileKind}-${action}`;
    }
    if(id)this.audio.voice(id,1,5,group);
  }
  tick(view:ViewState,side:Side,camera:Point,mode:'menu'|'quiet'|'battle',now:number,selected:ReadonlySet<number>=new Set()){
    if(mode!=='battle'){
      if(this.active)this.audio.reset();
      this.active=false;this.events.reset(view,side);this.audio.buildings([]);this.audio.scene(mode);return;
    }
    const race=raceOf(view,side);
    if(!this.active){this.events.reset(view,side);this.active=true;}
    if(this.pendingStart&&this.audio.ready){this.pendingStart=false;this.announce(race,'start',3,0);}
    for(const event of this.events.collect(view,side)){
      if(event.voice==='baseAttack'&&!this.baseAttackSound)continue;
      const distance=event.point?Math.hypot(event.point.x-camera.x,event.point.y-camera.y):0;
      const attenuation=Math.max(0,1-distance/1150),alarm=event.voice==='baseAttack';
      if(event.effect&&(!event.point||attenuation>.04))this.audio.effect(
        event.effect,alarm?.48:attenuation*.78,event.point?(event.point.x-camera.x)/700:0,
        alarm?12:event.effect.endsWith('heal')?.55:.06);
      if(event.combat&&distance<1200)this.combatUntil=now+7000;
      if(event.voice)this.announce(race,event.voice,event.priority??2,alarm?14:event.voice==='unitLost'?12:6);
    }
    if(view.winner&&view.winner!==this.winner){
      this.winner=view.winner;
      const result=sameTeam(view.winner,side,view.players)?'victory':'defeat';
      this.audio.effect(race?factionCue(race,result):result,.7);this.announce(race,result,5,0);
    }
    if(now>=this.nextEnvironment){
      this.nextEnvironment=now+750;
      const water=getWorld(view.mapId,view.mapRevision,view.mapHash).features.filter(f=>f.kind==='water');
      this.water=Math.max(0,...water.map(f=>1-Math.hypot(f.x-camera.x,f.y-camera.y)/800))*.7;
      this.buildingMix=buildingSounds(view,camera,selected);
    }
    const combat=now<this.combatUntil;
    this.audio.buildings(view.winner?[]:this.buildingMix);
    this.audio.scene(view.winner?(sameTeam(view.winner,side,view.players)?'victory':'defeat'):combat?'combat':'exploration',this.water,race);
    if(!combat&&!view.winner&&now>=this.nextAmbient){
      this.nextAmbient=now+11000+Math.random()*9000;
      this.audio.ambient(race?factionCue(race,this.ambientAlternate?'call':'chirp'):'bird',race ? .32 : .4,Math.random()*1.4-.7,8);
      this.ambientAlternate=!this.ambientAlternate;
    }
  }
  select(view:ViewState,side:Side,ids:Iterable<number>){
    const selected=new Set(ids),unit=view.units.find(u=>u.side===side&&selected.has(u.id));
    if(!unit)return;
    const race=raceOf(view,side),mobile=isMobile(unit)||unit.station?.mode==='mobile';
    const effect:Effect=mobile?(race?factionCue(race,'order'):'ui-confirm'):race?buildingCue(race,unit.kind as BuildingKind,'select'):
      unit.kind==='oilwell'?'select-oil':Object.hasOwn(BUILDING_AUDIO,unit.kind)?`select-${unit.kind as Exclude<LegacyBuildingKind,'oilwell'>}`:'ui-confirm';
    this.audio.effect(effect,.38);
    if(mobile)this.response(race,unit.kind,'select','selection');
  }
  resource(kind:'gold'|'wood'|'oil'){this.audio.effect(`select-${kind}`,.4);}
  command(command:Command,view:ViewState,side:Side){
    const race=raceOf(view,side);
    const confirm=(effect:Effect)=>this.audio.effect(effect,.42);
    const order=race?factionCue(race,'order'):'order';
    const construct=(kind:BuildingKind)=>race?buildingCue(race,kind,'place'):'build-start';
    if(command.type==='stop'||command.type==='hold'){confirm(race?order:'ui-confirm');return;}
    if(command.type==='build'){
      confirm(construct(command.kind));this.response(race,'worker','build','orders');return;
    }
    if(command.type==='resume-build'){
      const target=view.units.find(u=>u.id===command.target);
      confirm(construct((target?.kind??'base') as BuildingKind));this.response(race,'worker','build','orders');return;
    }
    if(command.type==='station'){
      confirm(command.action==='deploy'||command.action==='pack'?construct('assembly'):order);
      if(command.action==='deploy'||command.action==='move')this.response(race,'assembly',command.action==='deploy'?'build':'move','orders');
      return;
    }
    if(command.type==='cast'){
      confirm(order);this.response(race,ABILITIES[command.skill].unit,'cast','orders');return;
    }
    const units='ids' in command?view.units.filter(u=>u.side===side&&command.ids.includes(u.id)&&isMobile(u)):[];
    const worker=units.find(unit=>unit.kind==='worker');
    if(command.type==='gather'||command.type==='repair'){
      const target=command.type==='repair'?view.units.find(u=>u.id===command.target&&!isMobile(u)):undefined;
      confirm(command.type==='repair'?construct((target?.kind??'base') as BuildingKind):order);
      if(worker)this.response(race,'worker',command.type,'orders');
      return;
    }
    if(command.type!=='order'){confirm(order);return;}
    const target=view.units.find(unit=>unit.id===command.target);
    if(worker&&target?.side===side&&!isMobile(target)){
      if(target.construction<1){confirm(construct(target.kind as BuildingKind));this.response(race,'worker','build','orders');return;}
      if(target.hp<target.maxHp||worker.order==='repair'&&worker.target===target.id){
        confirm(construct(target.kind as BuildingKind));this.response(race,'worker','repair','orders');return;
      }
    }
    confirm(order);
    const attack=command.assault||target&&!sameTeam(target.side,side,view.players);
    const combat=attack?units.find(isCombat):undefined;
    const unit=combat??units[0];
    if(unit){
      const action=combat&&(STATS[unit.kind].damage>0||!race)?'attack':'move';
      this.response(race,unit.kind,action,'orders');
    }
  }
}
