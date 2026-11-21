import { MATCH_EVENT_NAMES,newMatchStats } from './match-stats.js';
import type { ViewState } from './types.js';
const text=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const number=(n:number)=>Math.round(n).toLocaleString();
export function matchReportMarkup(view:ViewState){
  const events=view.players.flatMap(p=>(p.stats?.events??[]).map(event=>({name:p.name,event}))).sort((a,b)=>a.event.time-b.event.time);
  const stamp=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const timeline=events.length?`<section class="match-timeline"><h3>关键事件</h3><ol>${events.map(({name,event})=>
    `<li><time>${stamp(event.time)}</time><span>${text(name)}</span><strong>${MATCH_EVENT_NAMES[event.kind]}</strong></li>`).join('')}</ol></section>`:'';
  return `<div class="match-report"><div class="match-scroll"><table><caption>战局实测 · 金 / 木 / 油分别统计</caption><thead><tr><th>指挥官</th><th>采集收入</th><th>资源支出</th><th>退款</th><th>造成伤害</th><th>治疗</th><th>击毁 / 损失价值</th><th>工人闲置秒</th></tr></thead><tbody>${view.players.filter(p=>p.stats).map(p=>{
    const s=p.stats!,cost=(c:{gold:number;wood:number;oil:number})=>`${number(c.gold)} / ${number(c.wood)} / ${number(c.oil)}`;
    return `<tr><th>${text(p.name)}</th><td>${cost(s.income)}</td><td>${cost(s.spent)}</td><td>${cost(s.refunded)}</td><td>${number(s.damage)}</td><td>${number(s.healing)}</td><td>${cost(s.killedValue)}<br>${cost(s.lostValue)}</td><td>${number(s.workerIdleSeconds)}</td></tr>`;
  }).join('')}</tbody></table></div><p class="room-note">价值按兵种基础成本计算；工人闲置秒为所有空闲工人的累计时长。经济与兵力每 30 秒采样，导出保留最近 180 个采样点。历史存档从恢复时刻开始统计。</p>${timeline}</div>`;
}
export function exportMatch(view:ViewState){
  const data={version:1,mapId:view.mapId,mapRevision:view.mapRevision,time:view.time,winner:view.winner,difficulty:view.difficulty,
    players:view.players.filter(p=>p.stats).map(p=>({side:p.side,team:p.team??p.side,name:p.name,kills:p.kills,lost:p.lost,stats:p.stats??newMatchStats(view.time)}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=`fudancraft-${view.mapId}-${Math.floor(view.time)}s.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
