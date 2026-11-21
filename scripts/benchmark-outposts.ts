import { Engine } from '../src/game/engine.js';
import type { MatchEventKind } from '../src/game/match-stats.js';
import { isOutpostMap } from '../src/game/outposts.js';
import { isMapId,type MapId } from '../src/game/maps.js';
import type { AiStyle } from '../src/game/types.js';

const limit=Number(process.argv[2]??720);
if(!Number.isInteger(limit)||limit<60||limit>3600)throw Error('Simulation limit must be 60–3600 seconds');
const maps:MapId[]=process.argv[3]?[]:['twin-lakes','ring-valley'];
const map=process.argv[3];
if(map){
  if(!isMapId(map)||!isOutpostMap(map))throw Error('Choose twin-lakes or ring-valley');
  maps.push(map);
}
const step=.05;
const measured=['outpostIncome','outpostFight','firstTank'] as const satisfies readonly MatchEventKind[];
for(const mapId of maps)for(const mirror of [false,true])for(const pilot of [false,true]){
  const styles:AiStyle[]=mirror?['balanced','economic']:['economic','balanced'];
  const engine=new Engine(styles.map(aiStyle=>({name:aiStyle,ai:true,aiStyle})),'normal',mapId);
  engine.outpostPilot=pilot;
  for(let tick=0;tick<limit/step&&!engine.state.winner;tick++)engine.step(step);
  const round=(time:number)=>Math.round(time*10)/10;
  const players=engine.state.players.map(player=>({
    side:player.side,style:player.aiStyle,
    ...Object.fromEntries(measured.map(kind=>{
      const event=player.stats?.events?.find(entry=>entry.kind===kind);
      return [kind,event?round(event.time):null];
    })),
  }));
  console.log(JSON.stringify({map:mapId,mirror,pilot,duration:round(engine.state.time),winner:engine.state.winner,players}));
}
