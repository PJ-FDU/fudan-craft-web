// Read-only evaluation: new in-memory matches, no saves or gameplay files modified.
import { Engine } from '../../src/game/engine.js';
import { STATS,maxHp } from '../../src/game/types.js';
import { distance } from '../../src/game/pathfinding.js';
import { ART } from '../../src/game/art.js';
import { readFileSync,statSync } from 'node:fs';
const game=()=>new Engine([{name:'A',ai:false},{name:'B',ai:false}]);

const timing=game(),shooter=timing.state.units.find(u=>u.side===1&&u.kind==='soldier')!;
timing.state.units=timing.state.units.filter(u=>u.kind==='base'||u.id===shooter.id);
const target=timing.spawn('soldier',2,{x:shooter.x+110,y:shooter.y});timing.updateVision();
const hp=target.hp;timing.step(.05);
const shot=timing.state.shots.find(s=>s.side===1);

const gathering=game();let closest=Infinity,at=0;
for(let i=0;i<900;i++){
  gathering.step(.05);const workers=gathering.state.units.filter(u=>u.side===1&&u.kind==='worker');
  for(let a=0;a<workers.length;a++)for(let b=a+1;b<workers.length;b++){
    const d=distance(workers[a],workers[b]);if(d<closest){closest=d;at=gathering.state.time;}
  }
}

const armor=game();armor.player(2).tech.push('armor');
const enemy=armor.spawn('soldier',2,{x:armor.base(1)!.x+90,y:armor.base(1)!.y+50});armor.updateVision();
const view=armor.view(1),shown=view.units.find(u=>u.id===enemy.id)!,owner=view.players.find(p=>p.side===2)!;

const urls=[...Object.values(ART),...['worker','soldier','scout','medic','sniper','tank','artillery','fighter','mech','trees','building-construction','building-damage','building-production','ground-grass','ground-earth','effects'].map(k=>`/assets/generated/animation-${k}-v4.png`)];
let bytes=0,pixels=0;
for(const url of urls){const path=new URL('../../public'+url,import.meta.url),png=readFileSync(path);bytes+=statSync(path).size;pixels+=png.readUInt32BE(16)*png.readUInt32BE(20);}
console.log(JSON.stringify({
  damageTiming:{simulatedMs:50,damageAlreadyApplied:hp-target.hp,visualShotStillAlive:!!shot,shotLife:shot?.life},
  gathererSpacing:{minimumCenterDistance:closest,radiusSum:STATS.worker.radius*2,time:at},
  enemyArmorHp:{hp:shown.hp,actualMaxHp:maxHp(enemy,armor.player(2)),clientCalculatedMaxHp:maxHp(shown,owner)},
  eagerAssets:{pngCount:urls.length,sourceBytes:bytes,transferMiB:+(bytes/1048576).toFixed(1),rgbaPixelStorageMiB:+(pixels*4/1048576).toFixed(1)}
},null,2));
