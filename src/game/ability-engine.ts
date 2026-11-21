import type { Engine } from './engine.js';
import { ABILITIES, isAbility, NEGATIVE, POSITIVE, removableAreas, sustainedAreas, type AbilityId, type AbilityRuntime, type Status, type StatusGroup, type SkillTarget } from './abilities.js';
import { STATS, isCombat, isMobile, maxHp, type Command, type Kind, type Point, type Side, type Unit, type SkillArea } from './types.js';
import { circleFree } from './movement.js';
import { distance, inBounds, TILE } from './pathfinding.js';
import { maxShield } from './races.js';

type Cast=Extract<Command,{type:'cast'}>;
const reactive=new Set<AbilityId>(['IND-02','BIO-02','ENE-04']);
const unitEffects=(u:Unit)=>u.ability?.effects??[];
export const hasEffect=(u:Unit,group:StatusGroup,now:number)=>effect(u,group,now)>0;
export const effect=(u:Unit,group:StatusGroup,now=-Infinity)=>unitEffects(u).reduce((value,s)=>s.group===group&&s.until>now?Math.max(value,s.value):value,0);
export const motionScale=(u:Unit)=>hasEffect(u,'root',0)?0:(1+effect(u,'speedUp'))*(1-(hasEffect(u,'slowGuard',0)?0:effect(u,'slow')));
export const attackScale=(u:Unit,now:number)=>(1+effect(u,'attackUp',now))*(1-effect(u,'attackDown',now));
const runtime=(u:Unit):AbilityRuntime=>u.ability??={energy:0,cooldowns:{},effects:[]};
const timed=(source:Unit,target:Unit,skill:AbilityId,group:StatusGroup,value:number,until:number)=>{
  const effects=runtime(target).effects,old=effects.findIndex(s=>s.group===group&&s.source===source.id&&s.skill===skill);
  const next:Status={group,source:source.id,side:source.side,skill,value,until};
  if(old<0)effects.push(next);else effects[old]=next;
};
const controlGuard=(u:Unit,status:Status,at:number)=>{
  if(status.group!=='root'&&status.group!=='silence')return;
  timed({...u,id:status.source},u,status.skill,status.group==='root'?'rootGuard':'silenceGuard',1,at+3);
};
function clearGroups(u:Unit,groups:readonly StatusGroup[],limit:number,now:number){
  const a=u.ability;if(!a)return;
  const selected=groups.filter(group=>hasEffect(u,group,now)).slice(0,limit);
  const removed=a.effects.filter(s=>selected.includes(s.group)&&s.until>now);
  a.effects=a.effects.filter(s=>!selected.includes(s.group));
  for(const status of removed)controlGuard(u,status,now);
}

export class SkillEngine {
  constructor(private game:Engine){}
  get areas(){return this.game.state.areas??[];}
  private get now(){return this.game.state.time;}
  private canSee(side:Side,point:Point){return !!this.game.visible.get(side)?.[this.game.indexAt(point)];}
  private unitsIn(at:Point,radius:number){
    return this.game.state.units.filter(u=>u.hp>0&&distance(u,at)<=radius);
  }
  private landPoint(point:Point){
    const extent=this.game.extent;
    return Number.isFinite(point?.x)&&Number.isFinite(point?.y)&&point.x>=0&&point.y>=0&&point.x<extent&&point.y<extent;
  }
  private actualTarget(side:Side,command:SkillTarget){
    return this.game.state.units.find(u=>u.id===command.target&&u.hp>0&&this.canSee(side,u));
  }
  private areaFor(side:Side,command:SkillTarget){
    return this.areas.find(a=>a.id===command.area&&a.until>this.now&&!this.game.allied(a.side,side)&&this.canSee(side,a));
  }
  private overlaps(point:Point,radius:number,except?:number){
    return this.game.state.units.some(u=>u.id!==except&&u.hp>0&&!STATS[u.kind].air&&distance(u,point)<radius+STATS[u.kind].radius);
  }
  private fieldPlacement(side:Side,point:Point,radius:number){
    const game=this.game,size=game.size,ground=game.blockers();
    for(let y=Math.floor((point.y-radius)/TILE);y<=Math.floor((point.y+radius)/TILE);y++){
      for(let x=Math.floor((point.x-radius)/TILE);x<=Math.floor((point.x+radius)/TILE);x++){
        const dx=Math.max(x*TILE-point.x,point.x-(x+1)*TILE,0),dy=Math.max(y*TILE-point.y,point.y-(y+1)*TILE,0);
        if(Math.hypot(dx,dy)>=radius)continue;
        if(!inBounds(x,y,size)||ground[y*size+x]||!game.visible.get(side)?.[y*size+x])return false;
      }
    }
    return !this.overlaps(point,radius)&&!game.state.units.some(u=>u.hp>0&&!isMobile(u)&&distance(u,point)<STATS[u.kind].radius+radius+32)
      &&!game.state.nodes.some(n=>n.amount>0&&distance(n,point)<n.radius+radius+26);
  }
  private targetError(caster:Unit,id:AbilityId,cmd:SkillTarget,releasing=false):string|null{
    const {target:mode,range,radius,air}=ABILITIES[id],side=caster.side,now=this.now;
    if(mode==='self')return null;
    if(mode==='point'||mode==='area'){
      const area=mode==='area'?this.areaFor(side,cmd):undefined;
      const point=mode==='area'?area:cmd.point;
      if(!point||!this.landPoint(point)||!this.canSee(side,point)||area&&!removableAreas.includes(area.skill))return '目标不可用';
      if(distance(caster,point)>range)return '射程不足';
      if(id==='ENE-05'&&!this.fieldPlacement(side,point,radius!))return '落点不可用';
      if(id==='RLY-03'&&this.game.land()[this.game.indexAt(point)])return '落点不可用';
      return null;
    }
    const unit=this.actualTarget(side,cmd);
    if(!unit||!isCombat(unit)||STATS[unit.kind].air&&!air)return '目标不可用';
    if((mode==='enemy')===this.game.allied(side,unit.side))return '目标阵营不适用';
    if(distance(caster,unit)-STATS[unit.kind].radius>range)return '射程不足';
    if(reactive.has(id)&&!NEGATIVE.some(group=>hasEffect(unit,group,now)))return '没有可净化的负面状态';
    if(id==='BIO-01'&&unit.hp>=maxHp(unit,this.game.player(unit.side)))return '目标生命值已满';
    if(id==='BIO-05'&&(hasEffect(unit,'root',now)||hasEffect(unit,'rootGuard',now)))return '目标已有定身或定身抗性';
    if(id==='ENE-01'&&unitEffects(unit).some(s=>s.group==='barrier'&&s.until-now>=1&&s.value>=60))return '已有足量临时护盾';
    if(id==='ENE-02'&&(!maxShield(unit)||(unit.shield??0)>=maxShield(unit)))return '目标没有受损原生护盾';
    if(id==='RLY-02'&&(hasEffect(unit,'slowGuard',now)||!hasEffect(unit,'slow',now)))return '目标没有可解除的减速';
    if(id==='RLY-06'&&STATS[unit.kind].damage<=0)return '目标无普通攻击';
    if(mode==='blink'){
      const p=cmd.point,r=STATS[unit.kind].radius;
      if(unit.side!==side||hasEffect(unit,'root',now))return '目标无法折跃';
      if(!p||!this.landPoint(p)||!this.canSee(side,p)||distance(p,unit)>200||
        !circleFree(p,r,this.game.blockers())||this.overlaps(p,r,unit.id))return '落点不可用';
    }
    if(!releasing&&sustainedAreas.includes(id)&&this.areaLimit(caster,id))return '区域名额已满';
    return null;
  }
  private areaLimit(caster:Unit,id:AbilityId){
    const active=this.areas.filter(a=>a.skill===id&&a.until>this.now);
    if(active.some(a=>a.source===caster.id))return true;
    if(id==='IND-04'||id==='BIO-06')return false;
    const ally=(side:Side)=>this.game.allied(caster.side,side);
    const pending=this.game.state.units.filter(u=>u.hp>0&&ally(u.side)&&u.ability?.cast?.skill===id);
    return active.filter(a=>ally(a.side)).length+pending.length>=2;
  }
  cast(side:Side,cmd:Cast):string|null {
    if(!isAbility(cmd.skill))return '未知技能';
    const skill=ABILITIES[cmd.skill],now=this.now,player=this.game.player(side);
    if(skill.target==='auto')return '使用自动治疗开关';
    if(skill.research&&!player.tech.includes(cmd.skill))return '技能尚未解锁';
    const candidates=this.game.state.units.filter(u=>u.hp>0&&u.side===side&&cmd.ids.includes(u.id)&&u.kind===skill.unit&&u.ability);
    const hint=this.actualTarget(side,cmd)??this.areaFor(side,cmd)??cmd.point;
    candidates.sort((a,b)=>(hint?distance(a,hint)-distance(b,hint):0)||b.ability!.energy-a.ability!.energy||a.id-b.id);
    let first:string|undefined;
    for(const unit of candidates){
      const a=unit.ability!;
      const error=a.cast||a.recovery&&a.recovery>now?'正在施法':hasEffect(unit,'silence',now)?'自身被沉默':
        (a.cooldowns[cmd.skill]??0)>now?'技能冷却中':a.energy+1e-7<skill.energy?'能量不足':
        (skill.target==='point'&&sustainedAreas.includes(cmd.skill)&&this.areaLimit(unit,cmd.skill))?'区域名额已满':this.targetError(unit,cmd.skill,cmd);
      if(error){first??=error;continue;}
      this.game.clearWindup(unit);
      a.energy=Math.max(0,a.energy-skill.energy);a.cooldowns[cmd.skill]=now+skill.cooldown;
      a.cast={skill:cmd.skill,until:now+skill.windup,target:cmd.target,point:cmd.point&&{...cmd.point},area:cmd.area};
      return null;
    }
    return first??'未选择可施法单位';
  }
  interrupt(unit:Unit,text:string){
    if(!unit.ability?.cast)return;
    delete unit.ability.cast;
    unit.ability.feedback={text,until:this.now+2};
  }
  private startArea(unit:Unit,id:AbilityId,point:Point){
    const s=this.game.state,skill=ABILITIES[id];
    (s.areas??=[]).push({id:s.nextId++,skill:id,source:unit.id,side:unit.side,...point,radius:skill.radius!,until:s.time+skill.duration!});
    if(id==='RLY-03')this.game.updateVision();
  }
  private endArea(id:number){
    const area=this.areas.find(a=>a.id===id);
    this.game.state.areas=this.areas.filter(a=>a.id!==id);
    for(const u of this.game.state.units)if(u.ability)u.ability.effects=u.ability.effects.filter(s=>s.source!==id);
    if(area?.skill==='RLY-03')this.game.updateVision();
  }
  private apply(caster:Unit,id:AbilityId,target:SkillTarget){
    const skill=ABILITIES[id],now=this.now,player=this.game.player(caster.side);
    const u=this.actualTarget(caster.side,target);
    const add=(unit:Unit,group:StatusGroup,value:number)=>timed(caster,unit,id,group,value,now+(skill.duration??0));
    if(sustainedAreas.includes(id)){this.startArea(caster,id,target.point!);return;}
    switch(id){
      case 'IND-02':case 'ENE-04':case 'BIO-02':clearGroups(u!,NEGATIVE,id==='BIO-02'?2:1,now);break;
      case 'IND-03':case 'RLY-05':
        for(const v of this.unitsIn(caster,skill.radius!))if(isCombat(v)&&!STATS[v.kind].air&&this.game.allied(v.side,caster.side))
          add(v,id==='IND-03'?'attackUp':'splashGuard',id==='IND-03'?.2:.25);
        break;
      case 'IND-05':add(u!,'exposed',.15);break;
      case 'IND-06':
        for(const v of this.unitsIn(target.point!,skill.radius!))if(isCombat(v)&&!STATS[v.kind].air&&!this.game.allied(v.side,caster.side)){
          if(!hasEffect(v,'silence',now)&&!hasEffect(v,'silenceGuard',now)){
            add(v,'silence',1);this.interrupt(v,'施法被沉默打断');
          }
          if((v.shield??0)>0){v.shield=Math.max(0,v.shield!-40);v.shieldHit=now;}
        }break;
      case 'BIO-01':add(u!,'regen',10);break;
      case 'BIO-03':add(u!,'infection',4);add(u!,'healCut',.4);break;
      case 'BIO-04':
        if(unitEffects(u!).some(s=>s.group==='infection'&&s.until>now&&this.game.allied(s.side as Side,player.side)))add(u!,'exposed',.2);
        break;
      case 'BIO-05':add(u!,'root',1);if(u!.ability?.cast?.skill==='ENE-03'&&u!.ability.cast.target===u!.id)delete u!.ability.cast;
        break;
      case 'ENE-01':clearGroups(u!,['barrier'],1,now);add(u!,'barrier',60);break;
      case 'ENE-02':u!.shield=Math.min(maxShield(u!),(u!.shield??0)+45);break;
      case 'ENE-03':this.game.relocate(u!,target.point!);break;
      case 'ENE-06':clearGroups(u!,POSITIVE,1,now);if(u!.ability)u!.ability.energy=Math.max(0,u!.ability.energy-25);break;
      case 'RLY-02':clearGroups(u!,['slow'],1,now);add(u!,'slowGuard',1);break;
      case 'RLY-04':this.endArea(target.area!);break;
      case 'RLY-06':add(u!,'attackDown',.2);break;
    }
  }
  tick(dt:number){
    const now=this.now,units=this.game.state.units;
    const hadRecon=this.areas.some(a=>a.skill==='RLY-03'&&a.until<=now);
    if(this.game.state.areas)this.game.state.areas=this.areas.filter(a=>a.until>now);
    if(hadRecon)this.game.updateVision();
    for(const u of units){
      if(u.hp<=0)continue;
      const shield=maxShield(u);
      if(shield&&(u.shield??0)<shield&&now-(u.shieldHit??0)>6)u.shield=Math.min(shield,(u.shield??0)+shield*.04*dt);
      const a=u.ability;if(!a)continue;
      if(ABILITIES_FOR.has(u.kind))a.energy=Math.min(100,a.energy+.8*dt);
      const activeDelta=(s:Status)=>Math.max(0,Math.min(dt,s.until-(now-dt)));
      const regen=a.effects.filter(s=>s.group==='regen').reduce((best,s)=>Math.max(best,s.value*activeDelta(s)),0);
      const infection=a.effects.filter(s=>s.group==='infection'&&activeDelta(s)>0).sort((a,b)=>b.value-a.value||b.until-a.until||a.source-b.source)[0];
      if(infection)this.game.skillDamage(u,infection.side as Side,infection.value*activeDelta(infection));
      if(u.hp>0&&regen)this.heal(u,regen,false);
      const expired=a.effects.filter(s=>s.until<=now);
      a.effects=a.effects.filter(s=>s.until>now);
      for(const status of expired)controlGuard(u,status,status.until);
      if(a.healing)a.healing=a.healing.filter(h=>h.until>now);
    }
    for(const caster of units){
      const a=caster.ability,cast=a?.cast;
      if(!a||!cast||caster.hp<=0)continue;
      if(hasEffect(caster,'silence',now)){this.interrupt(caster,'施法被沉默打断');continue;}
      if(cast.until>now)continue;
      delete a.cast;a.recovery=now+.2;
      const error=this.targetError(caster,cast.skill,cast,true);
      a.feedback={text:error?'施法失败 · '+error:ABILITIES[cast.skill].name+'已释放',until:now+2};
      if(!error){
        this.game.skillReleased(caster,cast.skill);
        this.apply(caster,cast.skill,cast);
      }
    }
    this.refreshZones(dt);
  }
  private refreshZones(dt:number){
    const now=this.now;
    for(const u of this.game.state.units)if(u.ability)u.ability.effects=u.ability.effects.filter(s=>!['speedUp','slow','rangedGuard'].includes(s.group));
    for(const a of this.areas){
      const spec:Partial<Record<AbilityId,[StatusGroup,number,boolean]>>={'IND-04':['rangedGuard',.2,true],'BIO-06':['slow',.35,false],'RLY-01':['speedUp',.2,true]};
      const config=spec[a.skill];if(!config)continue;
      for(const u of this.unitsIn(a,a.radius)){
        if(STATS[u.kind].air||this.game.allied(a.side,u.side)!==config[2]||
          (a.skill==='BIO-06'?!isMobile(u)||hasEffect(u,'slowGuard',now):!isCombat(u)))continue;
        timed({...u,id:a.id,side:a.side},u,a.skill,config[0],config[1],Math.min(a.until,now+Math.max(dt,.2)));
      }
    }
  }
  heal(target:Unit,base:number,direct=true){
    if(target.hp<=0||base<=0)return 0;
    const now=this.now,ratio=1-effect(target,'healCut',now);
    const hp=maxHp(target,this.game.player(target.side));
    const a=direct?runtime(target):undefined;
    const history=(a?.healing??[]).filter(h=>h.until>now);
    const available=direct?Math.max(0,20-history.reduce((total,h)=>total+h.amount,0)):Infinity;
    const actual=Math.min(hp-target.hp,Math.min(available,base)*ratio);
    if(actual>0){
      if(a)a.healing=[...history,{amount:actual/ratio,until:now+1}];
      target.hp+=actual;
    }
    return actual;
  }
  absorb(u:Unit,amount:number,splash=false,ranged=false){
    if(amount<=0)return 0;
    const now=this.now,reduction=Math.max(splash?effect(u,'splashGuard',now):0,ranged?effect(u,'rangedGuard',now):0);
    amount*= (1+effect(u,'exposed',now))*(1-reduction);
    if(maxShield(u))u.shieldHit=now;
    const barrier=unitEffects(u).find(s=>s.group==='barrier'&&s.until>now);
    if(barrier){const absorbed=Math.min(barrier.value,amount);barrier.value-=absorbed;amount-=absorbed;
      if(barrier.value<=1e-7)u.ability!.effects=u.ability!.effects.filter(s=>s!==barrier);}
    const shield=Math.min(u.shield??0,amount);
    if(shield>0)u.shield=u.shield!-shield;
    return amount-shield;
  }
  visibleEdges(side:Side){
    const edges:{skill:AbilityId;start:Point;end:Point}[]=[];
    for(const area of this.areas){
      if(area.until<=this.now||this.canSee(side,area))continue;
      let previous:Point|undefined;
      for(let i=0;i<=64;i++){
        const angle=i*Math.PI/32,point={x:area.x+Math.cos(angle)*area.radius,y:area.y+Math.sin(angle)*area.radius};
        const visible=this.landPoint(point)&&this.canSee(side,point);
        if(visible&&previous){
          const middle={x:(point.x+previous.x)/2,y:(point.y+previous.y)/2};
          if(this.canSee(side,middle))edges.push({skill:area.skill,start:previous,end:point});
        }
        previous=visible?point:undefined;
      }
    }
    return edges;
  }
  visibleAreas(side:Side):SkillArea[]{
    return this.areas.filter(a=>a.until>this.now&&this.canSee(side,a)).map(a=>({...a,source:this.game.allied(side,a.side)?a.source:0}));
  }
}
const ABILITIES_FOR=new Set<Kind>(Object.values(ABILITIES).map(a=>a.unit));
