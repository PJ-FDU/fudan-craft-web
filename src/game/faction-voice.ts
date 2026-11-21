import type { MobileKind,Race } from './types.js';

export type FactionVoiceAction='select'|'move'|'attack'|'cast'|'gather'|'repair'|'build';
export type FactionAnnouncement='start'|'ready'|'complete'|'research'|'baseAttack'|'lowPower'|'unitLost'|'victory'|'defeat';
export type FactionVoiceId=`faction-${Race}-unit-${MobileKind|'assembly'}-${FactionVoiceAction}`|`faction-${Race}-command-${FactionAnnouncement}`;
type Line=readonly [zh:string,en:string];
type UnitLineSet={select:Line;move:Line;attack?:Line;cast?:Line;gather?:Line;repair?:Line;build?:Line};
type Characters=Partial<Record<MobileKind|'assembly',UnitLineSet>>;
const fighter=(select:Line,move:Line,attack:Line):UnitLineSet=>({select,move,attack});
const support=(select:Line,move:Line,cast:Line):UnitLineSet=>({select,move,cast});
const worker=(select:Line,move:Line,gather:Line,repair:Line,build:Line):UnitLineSet=>({select,move,gather,repair,build});

const characters:Record<Race,Characters>={
  industrial:{
    worker:worker(['工程车，液压正常。','Engineering here. Hydraulics good.'],['好，车过去了。','Okay, rolling over.'],['夹具张开，开始装料。','Opening the claws. Loading up.'],['我带工具过去。','I’ll bring the tools over.'],['地基交给我。','I’ll lay the foundation.']),
    soldier:fighter(['联邦突击组，待命。','Federation assault squad, standing by.'],['压低身子，跟上。','Stay low and follow me.'],['突击组，火力压制！','Assault squad, suppressing fire!']),
    scout:fighter(['侦察车上线，前路还空着。','Scout online. Road ahead looks open.'],['我抄近路。','I know a shortcut.'],['轻炮锁住了。','Light gun locked on.']),
    medic:support(['战地医疗，听得见。','Field medic, reading you.'],['让出一条救护线。','Make a lane for medical.'],['伤员交给我。','I’ve got the wounded.']),
    sniper:fighter(['幽影报告，保持安静。','Ghost checking in. Keep it quiet.'],['换个射界。','Changing my sightline.'],['准星稳了。','Sight picture steady.']),
    tank:fighter(['攻城车组，炮闩锁定。','Siege crew. Breech locked.'],['低挡，稳住炮塔。','Low gear. Hold the turret steady.'],['重炮准备，发射！','Main gun ready. Fire!']),
    artillery:fighter(['炮组，请报方位。','Gun crew. Give us a bearing.'],['收起支架，换阵地。','Raise the braces. New position.'],['标尺就位，齐射！','Elevation set. Volley out!']),
    fighter:fighter(['猎隼报到，推力稳定。','Falcon reporting. Thrust is stable.'],['转向指定空域。','Turning into the assigned sector.'],['猎隼进入攻击航线。','Falcon on the attack run.']),
    mech:fighter(['泰坦驾驶舱，系统全绿。','Titan cockpit. All systems green.'],['稳定器解锁，迈步。','Stabilizers off. Stepping out.'],['给重型火炮让条路。','Clear a lane for the heavy gun.']),
    commander:support(['联邦指挥官，接入战术网。','Federation command on the tactical net.'],['指挥组，随我转移。','Command element, move with me.'],['战术指令，全组执行。','All elements, execute the directive.']),
    disruptor:support(['频谱组，阵列可用。','Spectrum crew. Array is ready.'],['阵列收拢，换个位置。','Fold the array. We’re moving.'],['切入目标频道。','Cutting into their channel.']),
  },
  brood:{
    worker:worker(['工巢听见了。','The worker nest hears.'],['沿着气味爬行。','Follow the scent.'],['将养分带回巢穴。','Carry the nutrients home.'],['让裂口重新长合。','Let the breach grow shut.'],['从这里扎下根须。','Put down roots here.']),
    broodling:fighter(['迅爪在等。','Rushclaw waits.'],['贴着地面过去。','Low to the ground.'],['利爪撕开它。','Claws tear it open.']),
    spitter:fighter(['酸囊已经鼓起。','The acid sac is full.'],['拖着酸迹前进。','Moving on the acid trail.'],['溶掉外壳。','Dissolve the shell.']),
    behemoth:fighter(['巨壳已经醒来。','The great shell awakens.'],['地面会让开。','The ground will yield.'],['用整个身躯撞碎它。','Break it with our weight.']),
    bioWing:fighter(['翅膜迎风。','Wings in the wind.'],['沿上升气流滑行。','Glide on the rising air.'],['俯冲，掠过它的背。','Dive across its back.']),
    sac:{select:['囊体饱满，巢脉通畅。','Sacs full. The hive feeds.'],move:['护着囊体前行。','Moving with the sacs protected.']},
    nurturer:support(['育生者，温养巢脉。','The nurturer tends the brood.'],['循伤口的气味过去。','Drawn to the scent of wounds.'],['将养分送入伤口。','Feed the wound. Knit it closed.']),
    infector:support(['孢囊已成熟。','The spores are ripe.'],['让风把我们带近。','Let the wind bring us near.'],['孢子，找它的裂缝。','Spores, seek its cracks.']),
    binder:support(['缚索在骨刺下生长。','Tethers grow beneath the spines.'],['根须拔起，往前。','Uproot. Forward.'],['把它锁在地面。','Bind it to the ground.']),
  },
  stellar:{
    worker:worker(['构装采集端已同步。','Construct harvester synchronized.'],['重算牵引路径。','Recalculating the traction path.'],['将矿料纳入晶格。','Feeding ore into the lattice.'],['重新校准结构。','Realigning the structure.'],['蓝图已写入光场。','Blueprint written into the light field.']),
    lancer:fighter(['晶锋谐振稳定。','Crystal lances in resonance.'],['向坐标列阵。','Forming at the coordinates.'],['双锋同相。','Lances, in phase.']),
    prism:fighter(['棱镜聚焦组件在线。','Prism focus assembly online.'],['转移光路。','Redirecting the beam path.'],['折射收束，释放。','Refraction aligned. Release.']),
    colossus:fighter(['巨构各节点已对齐。','Colossus nodes aligned.'],['重建行走相位。','Rebuilding the walking phase.'],['相位脉冲，最大振幅。','Phase pulse. Full amplitude.']),
    starWing:fighter(['辉梭光帆展开。','Light shuttle. Sails deployed.'],['沿星轨切入。','Intercepting along the star track.'],['辉束指向目标。','Directing the light burst.']),
    weaver:support(['织者已接入护盾网。','Weaver linked to the shield mesh.'],['沿最弱的节点移动。','Moving to the weakest node.'],['重织这层护盾。','Reweaving the shield layer.']),
    guide:support(['引导信标已校准。','Guide beacon calibrated.'],['测量新的折跃矢量。','Measuring the new warp vector.'],['目标相位，已捕获。','Target phase acquired.']),
    arbiter:support(['仲裁节点在线。','Arbiter node online.'],['迁移仲裁坐标。','Relocating the judgment node.'],['重置局部相位。','Resetting the local phase.']),
  },
  relay:{
    worker:worker(['工程车在，扳手都齐了。','Work truck here. Tools are aboard.'],['挑条平整路过去。','I’ll find a smooth way over.'],['先把货装稳。','Let’s get that load strapped down.'],['把车停稳，我来修。','Hold it steady. I’ll fix it.'],['我去打桩架支腿。','I’ll stake it out and set the legs.']),
    ranger:fighter(['远行者线列队，听着呢。','Line rangers. We hear you.'],['跟我走外侧。','Take the outside with me.'],['线列队，瞄准前面。','Rangers, sights forward.']),
    runner:fighter(['侧翼车，轮胎刚换过。','Flank runner. Fresh tires fitted.'],['我走外圈，绕过去。','I’ll swing around the outside.'],['边走边压住他们。','Keep them down as we roll.']),
    flak:fighter(['护空车，炮架已松开。','Flak carrier. Mounts unlocked.'],['换个开阔位置。','Taking a clearer position.'],['双联炮，短点射。','Twin mounts. Short bursts.']),
    relayWing:fighter(['巡航翼，风向合适。','Roaming wing. Wind is with us.'],['贴着地形飞过去。','Following the terrain in.'],['对准了，掠过去。','Lined up. Making a pass.']),
    pathfinder:support(['路线工兵，地钉备齐。','Pathfinder. Route stakes ready.'],['我先探一下能不能过。','I’ll check if we can get through.'],['把这条路标出来。','Mark this route out.']),
    observer:support(['前沿观测，通讯清楚。','Forward observer. Signal is clear.'],['我去找个视野好的点。','I’ll find a better vantage point.'],['传回新的方位。','Relaying the new bearing.']),
    escort:support(['护航车，车队频道正常。','Escort. Convoy channel is clear.'],['车队跟上，别拉开。','Convoy, close up and follow.'],['把车队护起来。','Put a screen around the convoy.']),
    assembly:{select:['装配车已经收拢。','Assembly rig folded for transit.'],move:['支腿锁好，上路。','Legs latched. Moving the rig.'],build:['找平，马上展开。','Leveling up for deployment.']},
  },
};
const commands:Record<Race,Record<FactionAnnouncement,Line>>={
  industrial:{
    start:['联邦指挥链路在线。','Federation command link online.'],ready:['新单位已编入作战序列。','New unit assigned to the roster.'],
    complete:['设施验收通过。','Facility cleared for service.'],research:['联邦工程升级完成。','Federation upgrade complete.'],
    baseAttack:['指挥中心遇袭，立即应对！','Command center under attack. Respond now!'],lowPower:['母线超载，电力不足。','Grid overloaded. Power is low.'],
    unitLost:['一个呼号离线。','We’ve lost a call sign.'],victory:['区域已控制，联邦任务完成。','Sector secured. Federation mission complete.'],defeat:['指挥链路中断，剩余单位撤离。','Command link severed. Remaining units, withdraw.'],
  },
  brood:{
    start:['巢心苏醒，群体听令。','The hive wakes. The brood listens.'],ready:['又一道心跳加入巢群。','Another heartbeat joins the brood.'],
    complete:['新的巢器已经长成。','A new hive organ has matured.'],research:['新的性状已传入巢脉。','A new trait flows through the hive.'],
    baseAttack:['有东西在撕扯巢心！','Something is tearing at the hive heart!'],lowPower:['巢脉缺少滋养。','The hive is starved of nourishment.'],
    unitLost:['一道巢脉静了。','A voice in the hive falls silent.'],victory:['巢群吞没了这片领地。','The brood has consumed this ground.'],defeat:['巢心沉寂，群体散去。','The hive falls silent. The brood scatters.'],
  },
  stellar:{
    start:['星能议会，同步完成。','Stellar council. Synchronization complete.'],ready:['新构装已接入共振网络。','New construct linked to the resonance network.'],
    complete:['设施晶核已稳定。','Facility core stabilized.'],research:['共鸣参数已更新。','Resonance parameters updated.'],
    baseAttack:['主晶核受击，立即稳住！','Primary core taking fire. Stabilize it now!'],lowPower:['能量网络正在失谐。','The power network is losing coherence.'],
    unitLost:['一个相位信号消失。','A phase signal has vanished.'],victory:['共鸣覆盖成立，议会已控制区域。','Resonance established. The council holds this sector.'],defeat:['主晶核失谐，链接断开。','Primary core out of phase. Link lost.'],
  },
  relay:{
    start:['各车报到，远行队已连通。','All vehicles check in. The convoy is linked.'],ready:['新的呼号加入车队。','A new call sign joins the convoy.'],
    complete:['支点搭好了，可以用了。','The outpost is up and ready.'],research:['新设备方案传到各车。','New kit plans are on the convoy net.'],
    baseAttack:['营地遇袭，能回来的都回来！','Camp under attack. All available units, turn back!'],lowPower:['营地的供能撑不住了。','Camp power is running low.'],
    unitLost:['有同伴掉队了。','We’ve lost someone from the convoy.'],victory:['路打通了，远行队继续走。','The route is open. The convoy moves on.'],defeat:['营地失守，车队分头撤离。','Camp is lost. Convoy, break off and withdraw.'],
  },
};
const rows=Object.entries(characters) as [Race,Characters][];
export const FACTION_VOICES=new Map<FactionVoiceId,Line>();
for(const [race,units] of rows){
  for(const [kind,actions] of Object.entries(units)){
    for(const [action,line] of Object.entries(actions)){
      FACTION_VOICES.set(`faction-${race}-unit-${kind as MobileKind}-${action as FactionVoiceAction}`,line);
    }
  }
  for(const [key,line] of Object.entries(commands[race])){
    FACTION_VOICES.set(`faction-${race}-command-${key as FactionAnnouncement}`,line);
  }
}
export function factionUnitVoice(race:Race,kind:MobileKind|'assembly',action:FactionVoiceAction){
  const id=`faction-${race}-unit-${kind}-${action}` as const;
  return FACTION_VOICES.has(id)?id:undefined;
}
