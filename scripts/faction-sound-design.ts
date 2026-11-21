import { ABILITIES } from '../src/game/abilities.js';
import {
  BUILDING_CUES,FACTION_CUES,FACTION_SKILLS,TRANSIT_LOOP,buildingCue,buildingLoop,constructionLoop,
  factionBuildings,factionCue,factionWeapons,fieldLoop,skillCue,weaponCue,
} from '../src/game/faction-sounds.js';
import { RACES,STATS,type BuildingKind,type Kind,type Race } from '../src/game/types.js';

type WriteSound=(name:string,seconds:number,render:(left:Float32Array,right:Float32Array)=>void,peak:number)=>void;
type Signal=(time:number)=>number;
const rate=44100;
const tau=Math.PI*2;
const sine=(cycles:number)=>Math.sin(tau*cycles);
const curve=(t:number,attack:number,decay:number)=>Math.min(1,t/attack)*Math.exp(-t*decay);
const sweep=(t:number,from:number,to:number,time:number)=>to*t+(from-to)*time*(1-Math.exp(-t/time));

function sourceNoise(seed:string,smoothing=0){
  let state=2166136261,value=0;
  for(const c of seed)state=Math.imul(state^c.charCodeAt(0),16777619);
  return ()=>{
    state^=state<<13;state^=state>>>17;state^=state<<5;
    value=smoothing*value+(1-smoothing)*((state>>>0)/2147483648-1);
    return value;
  };
}

function layer(out:[Float32Array,Float32Array],offset:number,length:number,signal:Signal,gain=1,pan=0){
  const start=Math.round(offset*rate),samples=Math.min(Math.round(length*rate),out[0].length-start);
  const l=gain*Math.sqrt((1-pan)/2),r=gain*Math.sqrt((1+pan)/2);
  for(let i=0;i<samples;i++){
    const value=signal(i/rate);
    out[0][start+i]+=value*l;out[1][start+i]+=value*r;
  }
}

const palette:Record<Race,{root:number;steps:number[];beds:number[]}> = {
  industrial:{root:82.4,steps:[1,1.48,1.99],beds:[36,54,72]},
  brood:{root:51.6,steps:[1,1.13,1.72],beds:[31,46,66]},
  stellar:{root:131,steps:[1,1.5,2.02],beds:[65,98,131]},
  relay:{root:99,steps:[1,1.34,1.79],beds:[43,63,83]},
};

function signature(race:Race,id:string,root:number,decay:number,sustain=false):Signal{
  const noise=sourceNoise(id,race==='stellar'?.48:race==='brood'?.86:.66);
  if(race==='industrial')return t=>
    (sine(root*t)*.27+sine(sweep(t,root*6.1,root*3.8,.024))*.23+sine(root*8.37*t)*.09+noise()*.25)
    *(sustain?.66+.34*sine(t*2.2)**2:curve(t,.006,decay));
  if(race==='brood')return t=>
    (sine(root*t+.68*sine(root*.34*t))*.34+sine(root*t*2.32)*.075+noise()*.66)
    *(sustain?.48+.52*sine(t*.83+.08)**2:curve(t,.025,decay));
  if(race==='stellar')return t=>
    (sine(root*t+.12*sine(root*1.7*t))*.34+sine(root*2.006*t)*.23+sine(root*3.49*t)*.12+noise()*.065)
    *(sustain?.70+.3*sine(t*.41)**2:curve(t,.014,decay));
  return t=>
    (sine(root*t+.24*sine(root*.25*t))*.3+sine(root*2.58*t)*.105+noise()*.41)
    *(sustain?.44+.56*sine(t*3.3)**2:curve(t,.009,decay));
}

function field(write:WriteSound,race:Race){
  const name=fieldLoop(race),seconds=18,{beds,root}=palette[race];
  write(name,seconds,(left,right)=>{
    const out:[Float32Array,Float32Array]=[left,right];
    for(const pan of [-.81,.81]){
      const draft=sourceNoise(`${name}${pan}`,race==='relay'?.925:.979);
      const air=sourceNoise(`${name}-air${pan}`,.83);
      layer(out,0,seconds,t=>{
        const wave=.77+.18*sine(t/9+pan*.1)+.05*sine(t/3);
        const harmonics=beds.reduce((value,f,i)=>value+sine(f*t+pan*.017*(i+1)+.04*sine(t/(6+i)))/(i+2),0);
        if(race==='industrial')return harmonics*.29+draft()*wave*.52+air()*(.04+.035*sine(t*5.5)**2);
        if(race==='brood')return harmonics*(.15+.18*sine(t/2.25)**2)+draft()*wave*.71+air()*.09*sine(t/3)**2;
        if(race==='stellar')return harmonics*(.22+.11*sine(t/6)**2)+draft()*.22+sine((root+2)*t)*.036;
        return harmonics*.13+draft()*wave*.92+air()*.15*wave;
      },.80,pan);
    }
    const accents=race==='industrial'?[3.1,7.25,12.3,16.1]:race==='stellar'?[2.2,6.6,10.3,15]:race==='brood'?[2.8,7.3,11.9,14.5]:[3.7,8.2,12.6,16.5];
    accents.forEach((at,i)=>layer(out,at,1.35,signature(race,name+i,root*(i%2?1.17:.88),3.3),.13,i%2?.68:-.49));
  },.42);
}

type BuildingColor=readonly [root:number,rate:number,pulse:number,air:number];
const buildingColors:Record<BuildingKind,BuildingColor>={
  base:[116,1.0,.35,.07],barracks:[94,1.8,.56,.13],factory:[68,3.3,.7,.16],airfield:[152,4.4,.29,.34],
  refinery:[57,1.4,.44,.26],research:[218,.78,.37,.08],lumbermill:[179,2.45,.5,.41],powerplant:[59,.66,.28,.13],
  tower:[138,1.22,.58,.16],oilwell:[75,.85,.59,.21],supplyDepot:[105,1.57,.62,.17],infirmary:[237,.64,.25,.06],
  commandPost:[181,1.13,.43,.07],hatchery:[62,.91,.43,.17],nursery:[78,.69,.37,.16],gland:[124,1.31,.38,.32],
  burrow:[40,.82,.62,.24],node:[201,.72,.26,.04],resonator:[149,1.73,.43,.11],warpHub:[97,2.12,.48,.19],
  phaseSanctum:[176,.63,.27,.08],assembly:[71,2.64,.65,.32],relayTower:[169,1.16,.51,.28],
  routePost:[111,1.19,.37,.32],observatory:[248,.86,.41,.21],escortDepot:[84,1.98,.5,.25],
};

function facility(write:WriteSound,race:Race,kind:BuildingKind){
  const [base,ticks,pulse,air]=buildingColors[kind];
  const root=base*(race==='brood'?.81:race==='stellar'?1.22:race==='relay'?.94:1);
  for(const active of [false,true]){
    const name=buildingLoop(race,kind,active),length=6;
    write(name,length,(left,right)=>{
      const out:[Float32Array,Float32Array]=[left,right];
      const machine=signature(race,name,root,1,true),wind=sourceNoise(name+'air',.86);
      const speed=ticks*(active?1.58:.75);
      layer(out,0,length,t=>machine(t)*(.46+air*.2)+wind()*air*(.8+.2*sine(t*speed)),1);
      for(let i=0;i<length*speed;i++){
        const at=(i+.3)/speed;
        layer(out,at,Math.min(.7,.71/speed),signature(race,name+i,root*(1.58+.07*(i%4)),active?10:14),pulse*(active?.8:.35),i%2?.21:-.21);
      }
    },active?.38:.28);
  }
  for(const cue of BUILDING_CUES){
    const name=buildingCue(race,kind,cue),collapse=cue==='collapse',finish=cue==='finish';
    const length=collapse?1.38:finish?.82:cue==='place'?.64:.48;
    write(name,length,(left,right)=>{
      const out:[Float32Array,Float32Array]=[left,right];
      const taps=collapse?[0,.12,.26,.41,.72]:finish?[0,.098,.219]:cue==='place'?[0,.12]:[0,.069];
      taps.forEach((time,i)=>layer(out,time,length-time,
        signature(race,name+i,root*(collapse?1.02-i*.15:finish?1.7+i*.4:cue==='select'?2.2+i*.34:.84+i*.19),collapse?5.8:finish?9:17),
        (i===0?.9:.58)*(collapse?1-i*.1:1),i%2?.33:-.19));
      if(collapse){
        const rubble=sourceNoise(name+'rubble',race==='brood'?.94:.89);
        layer(out,.016,1.14,t=>rubble()*curve(t,.03,4.8)+sine(sweep(t,root*.76,30,.19))*curve(t,.01,6),.6);
      }
    },collapse?.7:finish?.51:.47);
  }
}

function construction(write:WriteSound,race:Race,transit=false){
  const name=transit?TRANSIT_LOOP:constructionLoop(race),root=transit?59:palette[race].root;
  write(name,6,(left,right)=>{
    const out:[Float32Array,Float32Array]=[left,right];
    const bed=signature(race,name,root,1,true);
    layer(out,0,6,t=>bed(t)*(transit?.82+.18*sine(t*4):.50),.75);
    const cadence=transit?.39:race==='industrial'?.46:race==='brood'?.83:race==='stellar'?.69:.56;
    for(let i=0;i<6/cadence;i++)layer(out,i*cadence,.34,signature(race,name+i,root*(1.4+i%3*.25),14),transit?.3:.67,i%2?.24:-.24);
  },.37);
}

type Attack=[shots:number,number,number];
const attackColors:Partial<Record<Kind,Attack>>={
  soldier:[2,162,.067],scout:[3,199,.052],sniper:[1,213,0],tank:[1,53,0],artillery:[1,43,0],
  fighter:[4,257,.046],mech:[3,78,.10],tower:[2,107,.083],
  broodling:[1,183,0],spitter:[1,122,0],behemoth:[1,40,0],bioWing:[2,154,.113],
  lancer:[2,277,.071],prism:[1,156,0],colossus:[1,70,0],starWing:[3,322,.07],
  ranger:[2,212,.060],runner:[3,178,.056],flak:[2,77,.145],relayWing:[4,136,.053],
};
function weapons(write:WriteSound,race:Race,kind:Kind){
  const [count,root,gap]=attackColors[kind]??[1,115,.1];
  const heavy=STATS[kind].damage>=25;
  const name=weaponCue(race,kind,'fire');
  const length=(count-1)*gap+(heavy?.83:.49);
  write(name,length,(left,right)=>{
    const out:[Float32Array,Float32Array]=[left,right];
    for(let i=0;i<count;i++){
      const breath=sourceNoise(name+i,race==='brood'?.91:race==='stellar'?.62:.76);
      const signal=signature(race,name+i,root,heavy?7:14);
      const dur=heavy?.81:.46;
      layer(out,i*gap,dur,t=>{
        const follower=race==='brood'
          ? (breath()*Math.sin(Math.PI*Math.min(1,t/.15))**2+sine(sweep(t,root*2.6,root,.084))*.58)*curve(t,.013,heavy?7:12)
          : race==='stellar'
            ? (sine(sweep(t,root*4.9,root*1.5,.074)+.4*sine(t*root))* .73+breath()*.13)*curve(t,.007,heavy?5.4:10)
            : (breath()*1.2+sine(sweep(t,root*1.85,root*.62,.073))*.6)*curve(t,.003,heavy?6.2:16);
        return signal(t)*.57+follower;
      },i===0?1:.88,i%2?.08:-.08);
    }
    if(kind==='spitter'){
      const hiss=sourceNoise(name+'acid',.63);
      layer(out,.1,.36,t=>hiss()*curve(t,.054,9),.68,.18);
    }
  },heavy?.83:.73);
  const hit=weaponCue(race,kind,'impact');
  write(hit,heavy?.76:.33,(left,right)=>{
    const out:[Float32Array,Float32Array]=[left,right];
    const debris=sourceNoise(hit,race==='brood'?.89:.73);
    const fall=signature(race,hit,root*.69,heavy?9:20);
    layer(out,0,heavy?.76:.33,t=>fall(t)*.48+debris()*curve(t,.003,heavy?9:19),.86);
    if(heavy)layer(out,.04,.62,t=>sine(sweep(t,81,34,.12))*curve(t,.02,8),.57);
  },heavy?.62:.46);
}

function factionEffects(write:WriteSound,race:Race){
  const {root,steps}=palette[race];
  for(const cue of FACTION_CUES){
    const name=factionCue(race,cue);
    const environmental=cue==='chirp'||cue==='call';
    const length=environmental?cue==='chirp'?.84:1.33:cue==='loss'?1.45:cue==='research'||cue==='victory'||cue==='defeat'?1.64:cue==='alarm'?1.02:.63;
    write(name,length,(left,right)=>{
      const out:[Float32Array,Float32Array]=[left,right];
      const notes=cue==='defeat'?[2,1,0]:cue==='alarm'?[2,0,2]:cue==='loss'?[1,0]:cue==='victory'||cue==='research'?[0,1,2,2]:cue==='heal'?[1,0,2]:[0,1];
      notes.forEach((note,i)=>{
        const at=i*(cue==='chirp'?.13:cue==='call'?.24:cue==='alarm'?.25:.15);
        const tune=root*steps[note]*(environmental?cue==='chirp'?3.6:1.25:cue==='loss'?.68:2.0);
        layer(out,at,length-at,signature(race,name+i,tune,environmental?7:cue==='loss'?4.4:10),i? .60:.82,i%2?.2:-.2);
      });
    },environmental?.48:cue==='loss'||cue==='alarm'?.67:.55);
  }
}

export function renderFactionSounds(write:WriteSound){
  for(const race of RACES){
    field(write,race);
    construction(write,race);
    factionEffects(write,race);
    for(const kind of factionBuildings(race))facility(write,race,kind);
    for(const kind of factionWeapons(race))weapons(write,race,kind);
  }
  construction(write,'relay',true);
  for(const {id,race} of FACTION_SKILLS){
    const name=skillCue(race,id),skill=ABILITIES[id],variant=Number(id.slice(-2));
    const accent=palette[race].root*(1.55+variant*.24);
    const wide=skill.target==='point'||skill.target==='area';
    const length=wide?1.35:1.04;
    write(name,length,(left,right)=>{
      const out:[Float32Array,Float32Array]=[left,right];
      const swell=signature(race,name+'start',accent*.86,4);
      layer(out,0,length,t=>swell(t)*Math.min(1,t*6),.54,-.20);
      layer(out,.16,length-.16,signature(race,name,accent*(variant%2?1.52:1.27),5.8),1,.14);
      if(wide)layer(out,.34,.8,signature(race,name+'spread',accent*.66,3.2),.46,-.41);
    },.62);
  }
}
