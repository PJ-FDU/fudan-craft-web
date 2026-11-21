import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Engine } from '../src/game/engine.js';
import { STATS,isMobile,unitCost,type AiStyle,type MobileKind } from '../src/game/types.js';
import { nearestFree } from '../src/game/pathfinding.js';

const output=resolve(process.argv[2]||'docs/benchmarks'),seconds=Number(process.argv[3]||1200);
if(!Number.isFinite(seconds)||seconds<60||seconds>3600)throw Error('Benchmark duration must be 60–3600 seconds');
const results:unknown[]=[],lines=['# FudanCraft 可重复平衡基准','','固定步长 0.05 秒；标准难度；AI 与玩家共用命令、资源、视野规则。源码无随机战斗掷骰。镜像交换策略 / 兵种的出生边，保留地图影响。少量确定性样本用于回归，不代表玩家胜率。',''];
function summarize(e:Engine,label:string,mode:string){
  const armies=e.state.players.filter(p=>e.state.units.some(u=>u.side===p.side&&isMobile(u)));
  const combatWinner=mode==='combat'&&armies.length===1?armies[0].side:null;
  const players=e.state.players.map(p=>({side:p.side,team:p.team,style:p.aiStyle,kills:p.kills,lost:p.lost,stats:p.stats,
    surviving:e.state.units.filter(u=>u.side===p.side).reduce((counts,u)=>({...counts,[u.kind]:(counts[u.kind]??0)+1}),{} as Record<string,number>)}));
  results.push({label,mode,mapId:e.state.mapId,mapRevision:e.state.mapRevision,time:e.state.time,winner:e.state.winner,combatWinner,players});
  lines.push(`## ${label}`,``,`- 地图：${e.state.mapId} / revision ${e.state.mapRevision}`,`- 模拟时间：${e.state.time.toFixed(1)} 秒；${mode==='combat'?'存活兵团':'胜者阵营'}：${e.state.winner??combatWinner??'到时未决'}`,
    '', '| 阵营 | 策略 | 击毁 / 损失 | 伤害 | 金 / 木 / 油收入 | 工人闲置秒 |','| --- | --- | --- | --- | --- | --- |',
    ...players.map(p=>`| ${p.side} | ${p.style??'固定兵种'} | ${p.kills} / ${p.lost} | ${Math.round(p.stats!.damage)} | ${Math.round(p.stats!.income.gold)} / ${Math.round(p.stats!.income.wood)} / ${Math.round(p.stats!.income.oil)} | ${Math.round(p.stats!.workerIdleSeconds)} |`),'');
}
function simulate(e:Engine,duration:number){for(let i=0;i<duration*20&&!e.state.winner;i++)e.step(.05);}
for(const [a,b] of [['rush','balanced'],['economic','defensive']] as [AiStyle,AiStyle][]){
  for(const mirror of [false,true]){
    const styles=mirror?[b,a]:[a,b],label=`${a} vs ${b} · ${mirror?'交换出生边':'原出生边'}`;
    console.log(`Running ${label}`);
    const e=new Engine(styles.map(style=>({name:style,ai:true,aiStyle:style})),'normal','twin-lakes');
    simulate(e,seconds);summarize(e,label,'economy');
  }
}
const compositions:[MobileKind[],MobileKind[]][]=[
  [Array(8).fill('soldier'),Array(2).fill('tank')],
  [Array(6).fill('soldier'),Array(3).fill('sniper')],
  [['tank','tank','soldier','soldier','medic'],['tank','tank','soldier','soldier','soldier']],
];
for(const [index,armies] of compositions.entries())for(const mirror of [false,true]){
  const e=new Engine([{name:'A',ai:false},{name:'B',ai:false}],'normal','lost-temple',1);e.state.units=e.state.units.filter(u=>u.kind==='base');e.state.nodes=[];
  const at=nearestFree({x:2000,y:2000})!,sets=mirror?[armies[1],armies[0]]:armies;
  for(const [i,kinds] of sets.entries())for(const kind of kinds)e.spawn(kind,(i+1) as 1|2,e.freeSpawn({x:at.x+(i?110:-110),y:at.y},kind));
  e.updateVision();for(const p of e.state.players)e.command(p.side,{type:'order',ids:e.state.units.filter(u=>u.side===p.side&&isMobile(u)).map(u=>u.id),point:at,assault:true});
  for(let n=0;n<180*20;n++){e.step(.05);if(e.state.players.some(p=>!e.state.units.some(u=>u.side===p.side&&isMobile(u))))break;}
  const label=`兵种 ${index+1} · ${mirror?'交换阵营':'原阵营'}`;summarize(e,label,'combat');
  lines.push(`部署：${sets.map(kinds=>kinds.join(', ')).join(' vs ')}。总成本（金 / 木 / 油）：${sets.map(kinds=>{
    const costs=kinds.map(unitCost);return ['gold','wood','oil'].map(k=>costs.reduce((n,c)=>n+c[k as keyof typeof c],0)).join(' / ');
  }).join(' vs ')}。`,'');
}
console.log('Running cooperative 2 vs 2 full match');
const coop=new Engine([
  {name:'合作 A',ai:true,team:1,aiStyle:'rush'},{name:'合作 B',ai:true,team:1,aiStyle:'economic'},
  {name:'AI C',ai:true,team:3,aiStyle:'balanced'},{name:'AI D',ai:true,team:3,aiStyle:'defensive'},
] as const,'normal','lost-temple');
simulate(coop,Math.min(3600,seconds*1.5));summarize(coop,'合作 2 vs 2（AI 代行人类决策）','coop');
await mkdir(output,{recursive:true});
await writeFile(resolve(output,'balance.json'),JSON.stringify({version:1,step:.05,difficulty:'normal',limit:seconds,stats:STATS,results},null,2));
await writeFile(resolve(output,'balance.md'),lines.join('\n'));
console.log(`Saved ${resolve(output,'balance.json')} and ${resolve(output,'balance.md')}`);
