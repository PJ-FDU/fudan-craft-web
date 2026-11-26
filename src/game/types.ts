import { ABILITIES, ABILITY_IDS, type AbilityId, type AbilityRuntime } from './abilities.js';
import type { MapId } from './maps.js';
import type { MatchStats } from './match-stats.js';
export type Side = 1 | 2 | 3 | 4;
export const LEGACY_MOBILE_KINDS = ['worker', 'soldier', 'scout', 'medic', 'sniper', 'tank', 'artillery', 'fighter', 'mech'] as const;
export type LegacyMobileKind = typeof LEGACY_MOBILE_KINDS[number];
export const ALL_MOBILE_KINDS = [...LEGACY_MOBILE_KINDS,
  'commander','disruptor','nurturer','infector','binder','weaver','guide','arbiter','pathfinder','observer','escort',
  'broodling','spitter','behemoth','bioWing','sac','lancer','prism','colossus','starWing','ranger','runner','flak','relayWing',
] as const;
export type MobileKind = typeof ALL_MOBILE_KINDS[number];
export const MOBILE_KINDS=LEGACY_MOBILE_KINDS;
export const LEGACY_BUILDING_KINDS = ['base', 'barracks', 'factory', 'airfield', 'refinery', 'research', 'lumbermill', 'powerplant', 'tower', 'oilwell'] as const;
export type LegacyBuildingKind = typeof LEGACY_BUILDING_KINDS[number];
export const ALL_BUILDING_KINDS = [...LEGACY_BUILDING_KINDS,
  'supplyDepot','infirmary','commandPost','hatchery','nursery','gland','burrow',
  'node','resonator','warpHub','phaseSanctum','assembly','relayTower','routePost','observatory','escortDepot',
] as const;
export const RACES = ['industrial','brood','stellar','relay'] as const;
export type Race = typeof RACES[number];
export const RACE_NAMES:Record<Race,string> = {industrial:'工业联邦',brood:'生群共生体',stellar:'星能议会',relay:'远行者同盟'};
export const isRace=(value:unknown):value is Race=>RACES.some(race=>value===race);
export type BuildingKind = typeof ALL_BUILDING_KINDS[number];
export const BUILDING_KINDS=LEGACY_BUILDING_KINDS;
export type BuildingFacing = 0 | 1 | 2 | 3;
export type Kind = MobileKind | BuildingKind;
export type ResourceKind = 'gold' | 'wood' | 'oil';
export type LegacyTech = 'weapons' | 'armor' | 'logistics' | 'advanced' | 'aviation';
export type Tech = LegacyTech | 'tier2' | 'tier3' | 'advancedArms' | 'aviationSystems' | AbilityId;
export type Difficulty = 'easy' | 'normal' | 'hard';
export type AiStyle = 'balanced' | 'rush' | 'economic' | 'defensive';
export interface AIContact extends Point {id:number;kind:Kind;side:Side;seen:number;hp:number}
export interface AIPlan {style:AiStyle;contacts:AIContact[];target?:Point;nextAttack:number;lastPlan:number}
export interface Point { x: number; y: number }
export interface Cost { gold: number; wood: number; oil: number }
export interface ResourceNode extends Point { id: number; kind: ResourceKind; amount: number; max: number; radius: number; tree?:number; startSide?:Side }
export interface Unit extends Point {
  id: number; side: Side; kind: Kind; hp: number; angle: number;
  path: Point[]; target: number | null; cooldown: number; repath: number;
  order: 'idle' | 'move' | 'attack' | 'assault' | 'hold' | 'gather' | 'build' | 'repair'; destination?: Point;
  resource: number | null; cargo: number; cargoKind: ResourceKind | null; returning: boolean;
  construction: number; builder: number | null;
  resumeResource?:number;
  waitingForGold?:true;
  cargoNode?:number;
  facing?: BuildingFacing;
  travel?:number;velocity?:Point;blockedFor?:number;navigationProgress?:number;yieldPoint?:Point;yieldTo?:number;yieldOrigin?:Point;
  action?:{started:number;fired:number|null;until:number};
  service?:{kind:'node'|'depot'|'build';target:number;point:Point;waiting:boolean};
  ability?:AbilityRuntime;
  shield?:number;
  shieldHit?:number;
  station?:{mode:'packing'|'mobile'|'deploying';until?:number;point?:Point};
  launched?:true;
  factoryModule?:'armor'|'support';
  refitUntil?:number;
  activity?: 'idle' | 'move' | 'attack' | 'gather' | 'build' | 'repair' | 'produce';
}
export interface VisualEvent extends Point {
  id: number; unit: number; kind: Kind; side: Side; angle: number; time: number;
  type: 'attack' | 'fire' | 'impact' | 'cast' | 'heal' | 'damage' | 'death' | 'spawn' | 'complete';
  audience: number;
  skill?: AbilityId;
  facing?: BuildingFacing;
}
export interface QueueItem { kind: MobileKind | Tech; remaining: number; duration: number; producer: number; research: boolean }
export interface Player { race?:Race; side: Side; team?:Side; aiStyle?:AiStyle; stats?:MatchStats; name: string; credits: number; wood: number; oil: number; tech: Tech[]; queue: QueueItem[]; rally: Point | null; kills: number; lost: number; ai: boolean; harvested: number }
export interface Shot extends Point { tx:number;ty:number;kind:Kind;side:Side;life:number;duration?:number;firedAt?:number;source?:number;target?:number;damage?:number;splash?:number;mode?:'beam'|'shell'; }
export type VisibleShot=Omit<Shot,'damage'|'splash'|'source'|'target'>;
export interface Windup {source:number;target:number;fireAt:number;healing:boolean}
export type VisibleUnit=Unit&{maxHp:number};
export interface SkillArea extends Point {id:number;skill:AbilityId;source:number;side:Side;radius:number;until:number}
export interface GameState { areas?:SkillArea[]; version: 2; oilWells?:true; mapId:MapId; mapRevision:number; time: number; units: Unit[]; nodes: ResourceNode[]; players: Player[]; nextId: number; shots: Shot[]; windups:Windup[]; events: VisualEvent[]; nextEventId: number; winner: Side | null; difficulty: Difficulty; aiTimer: number; explored: Record<number, number[]>;aiPlans?:Partial<Record<Side,AIPlan>> }
export interface ViewState { areas?:SkillArea[];areaEdges?:{skill:AbilityId;start:Point;end:Point}[]; oilWells?:true; mapId:MapId; mapRevision:number; time: number; units: VisibleUnit[]; nodes: ResourceNode[]; players: Player[]; shots: VisibleShot[]; events: Omit<VisualEvent,'audience'>[]; winner: Side | null; explored: number[]; visible: ArrayLike<number>; difficulty: Difficulty }
export type Command =
  | { type: 'train'; kind: MobileKind; producer?:number }
  | { type: 'cast'; ids:number[]; skill:AbilityId; target?:number; point?:Point; area?:number }
  | { type: 'station'; id:number; action:'pack'|'move'|'deploy'|'stop'; point?:Point }
  | { type: 'medic-auto'; ids:number[]; enabled:boolean }
  | { type: 'cancel-build'; id:number }
  | { type: 'factory-module'; id:number; module:'armor'|'support' }
  | { type: 'build'; kind: BuildingKind; point: Point; worker: number; facing?: BuildingFacing }
  | { type: 'research'; tech: Tech }
  | { type: 'gather'; ids: number[]; node: number }
  | { type: 'repair'; ids: number[]; target: number }
  | { type: 'cancel'; index: number }
  | { type: 'order'; ids: number[]; point: Point; target?: number; assault?: boolean }
  | { type: 'stop' | 'hold'; ids: number[] }
  | { type: 'rally'; point: Point };
export interface Stat { name: string; en: string; description: string; hp: number; damage: number; range: number; speed: number; cooldown: number; vision: number; cost: number; wood: number; oil: number; build: number; radius: number; size: number; producer?: BuildingKind; requires?: BuildingKind; tech?: Tech; power: number; air?: boolean; splash?: number; atlas: 'units' | 'buildings'; cell: number }
const unit = (name: string, en: string, cell: number, description: string, values: Partial<Stat>): Stat => ({name,en,cell,description,hp:100,damage:0,range:120,speed:100,cooldown:1,vision:8,cost:200,wood:0,oil:0,build:6,radius:14,size:62,power:0,atlas:'units',...values});
const building = (name: string,en: string,cell: number,description: string,values: Partial<Stat>): Stat => ({...unit(name,en,cell,description,{}),atlas:'buildings',hp:700,range:0,speed:0,vision:10,cost:600,wood:300,build:14,radius:38,size:132,power:10,requires:'base',...values});
const special = (name:string,en:string,producer:BuildingKind,values:Partial<Stat>={}) =>
  unit(name,en,3,'核心支援单位。',{hp:145,cost:230,wood:90,oil:35,build:12,producer,...values});
const line = (name:string,en:string,producer:BuildingKind,values:Partial<Stat>={}) =>
  unit(name,en,1,'常规作战单位。',{hp:115,damage:12,range:160,cooldown:.8,cost:150,wood:35,build:7,producer,...values});
const facility = (name:string,en:string,cell=5,values:Partial<Stat>={}) =>
  building(name,en,cell,'种族生产、供给或科技设施。',{cost:330,wood:160,build:15,hp:720,power:0,...values});
export const STATS: Record<Kind, Stat> = {
  worker:unit('工程采集车','HARVESTER',0,'采集金矿和木材，也能建造和维修建筑。',{hp:120,speed:112,cost:110,build:6,producer:'base',size:63}),
  soldier:unit('突击步兵','RIFLEMAN',1,'可靠的基础火力，低成本部署，适合保护采集线。',{hp:105,damage:10,range:150,cooldown:.7,cost:160,wood:30,build:7,producer:'barracks',size:53}),
  scout:unit('侦察战车','SCOUT BUGGY',2,'高机动、广视野，适合探索和切断补给。',{hp:160,damage:10,range:165,speed:170,cooldown:.75,vision:13,cost:240,wood:60,oil:20,build:8,producer:'factory',size:72}),
  medic:unit('战地医疗兵','FIELD MEDIC',3,'每次治疗 10 生命，支援受伤的友方地面作战单位，无法攻击。',{hp:85,range:170,cooldown:1,cost:200,wood:70,oil:20,build:9,producer:'barracks',requires:'research',size:53}),
  sniper:unit('幽影狙击手','GHOST SNIPER',4,'远距离精确射击，对步兵额外伤害。',{hp:80,damage:38,range:310,speed:88,cooldown:2.1,cost:280,wood:80,oil:20,build:10,producer:'barracks',tech:'weapons',size:57}),
  tank:unit('攻城坦克','SIEGE TANK',5,'重装甲与范围火力，适合正面推进。',{hp:420,damage:38,range:220,speed:76,cooldown:1.6,cost:600,wood:180,oil:100,build:13,producer:'factory',size:86,splash:58}),
  artillery:unit('远程火炮','HOWITZER',6,'超远射程与范围轰击，爆炸边缘伤害递减，无法攻击空中目标。',{hp:190,damage:58,range:440,speed:56,cooldown:3.4,cost:750,wood:240,oil:150,build:17,producer:'factory',tech:'advanced',size:90,splash:88}),
  fighter:unit('猎隼战机','FALCON VTOL',7,'无视地形的空中单位，高机动持续打击。',{hp:210,damage:18,range:225,speed:190,cooldown:.95,vision:12,cost:750,wood:200,oil:200,build:16,producer:'airfield',tech:'aviation',air:true,size:88}),
  mech:unit('泰坦机甲','TITAN WALKER',8,'高生命值的重型突击单位，解锁于先进工程。',{hp:650,damage:40,range:240,speed:68,cooldown:1.4,cost:1050,wood:320,oil:240,build:22,producer:'factory',tech:'advanced',size:94}),
  base:building('指挥中心','COMMAND CENTER',0,'训练采集车，接收全部资源。被摧毁即出局。',{hp:2000,cost:2000,wood:1000,oil:400,radius:54,size:182,power:-20,requires:undefined,vision:15}),
  barracks:building('步兵营','BARRACKS',1,'生产突击步兵，搭配研究中心解锁医疗兵与狙击手。',{hp:900,cost:500,wood:240,requires:'powerplant',size:144}),
  factory:building('战车工厂','VEHICLE WORKS',2,'生产侦察车、坦克、火炮与重型机甲。',{hp:1100,cost:800,wood:360,oil:80,build:24,requires:'barracks',power:20,size:158}),
  airfield:building('航空机库','AIRFIELD',3,'研究航空技术后生产猎隼战机。',{hp:1000,cost:1000,wood:450,oil:150,build:26,requires:'factory',power:25,radius:46,size:174}),
  refinery:building('石油精炼厂','REFINERY',4,'解锁油井并精炼石油，也接收金矿。',{hp:850,cost:550,wood:280,build:18,requires:'barracks',power:15,size:144}),
  research:building('科技研究中心','RESEARCH LAB',5,'研发火力、装甲、物流、先进工程与航空技术。',{hp:800,cost:700,wood:340,oil:50,build:24,requires:'barracks',power:15,size:146}),
  lumbermill:building('木材加工厂','LUMBER MILL',6,'提高伐木效率 50%，接收金矿和木材。',{hp:750,cost:350,wood:180,power:5,size:138}),
  powerplant:building('聚能电站','POWER PLANT',7,'提供 60 电力，低电力时军事生产与研究暂停。',{hp:800,cost:300,wood:150,power:-60,size:127}),
  oilwell:building('油井','OIL WELL',9,'建于油点上自动采油，需先建成石油精炼厂。',{hp:550,cost:120,wood:50,build:6,requires:'refinery',power:5,radius:35,size:88}),
  tower:building('哨戒炮塔','SENTINEL',8,'自动攻击范围内的地面与空中敌人，需要部队配合防守。',{hp:650,damage:18,range:285,cooldown:1,cost:400,wood:200,oil:40,build:18,power:10,radius:25,size:94,requires:'barracks'}),
  commander:special('战术指挥官','TACTICAL COMMANDER','barracks',{hp:165,requires:'commandPost',speed:86}),
  disruptor:special('电子干扰车','SIGNAL JAMMER','factory',{hp:200,speed:88,cell:2,size:74}),
  nurturer:special('育生者','NURTURER','hatchery',{requires:'nursery',hp:130,speed:102}),
  infector:special('感染者','INFECTOR','hatchery',{requires:'gland',hp:155,speed:94}),
  binder:special('缚地兽','BINDER','hatchery',{requires:'burrow',hp:215,speed:88,size:74}),
  weaver:special('护盾织者','SHIELD WEAVER','resonator',{hp:105,speed:95}),
  guide:special('折跃引导者','WARP GUIDE','warpHub',{hp:135,speed:101}),
  arbiter:special('相位仲裁者','PHASE ARBITER','phaseSanctum',{hp:170,speed:82,size:80}),
  pathfinder:special('路线工兵','PATHFINDER','assembly',{requires:'routePost',speed:116}),
  observer:special('前沿观测员','FORWARD OBSERVER','assembly',{requires:'observatory',vision:11,speed:105}),
  escort:special('护航指挥车','ESCORT VEHICLE','assembly',{requires:'escortDepot',hp:220,speed:98,size:74,cell:2}),
  broodling:line('迅爪','RUSHCLAW','hatchery',{range:36,speed:158,hp:108,cost:115,wood:25}),
  spitter:line('滴酸兽','SPITTER','hatchery',{speed:102,range:204,hp:135,damage:17,wood:55,build:9}),
  behemoth:line('破壳巨兽','BEHEMOTH','hatchery',{requires:'burrow',hp:490,damage:38,range:64,splash:48,speed:70,cooldown:1.7,cost:570,wood:160,oil:100,size:86,radius:23,build:17}),
  bioWing:line('掠翅','RAKEWING','hatchery',{requires:'gland',air:true,hp:160,damage:16,range:200,speed:178,cost:430,wood:130,oil:110,size:82,build:14}),
  sac:line('供给囊体','SUPPLY SAC','hatchery',{hp:125,damage:0,range:0,vision:4,speed:64,cost:95,wood:55,build:10}),
  lancer:line('晶锋卫士','CRYSTAL LANCER','resonator',{hp:100,damage:17,range:156,cost:200,wood:55,speed:108}),
  prism:line('棱镜炮','PRISM CANNON','resonator',{hp:140,damage:23,range:225,cost:290,wood:80,oil:25,build:9,speed:91}),
  colossus:line('相位巨构','PHASE COLOSSUS','phaseSanctum',{hp:290,damage:43,range:310,splash:63,cooldown:2.15,cost:680,wood:220,oil:130,build:21,size:89,radius:23,speed:73}),
  starWing:line('辉梭','LIGHT SHUTTLE','warpHub',{air:true,hp:145,damage:22,range:224,speed:180,cost:520,wood:155,oil:140,size:82,build:16}),
  ranger:line('线列步兵','LINE RANGER','assembly',{range:172,speed:117}),
  runner:line('侧翼轻车','FLANK RUNNER','assembly',{hp:175,speed:162,damage:11,range:160,cost:220,wood:61,oil:15,cell:2,size:71}),
  flak:line('护空车','FLAK CARRIER','assembly',{requires:'escortDepot',hp:270,damage:25,range:248,speed:92,cost:400,wood:130,oil:65,build:12,cell:2,size:76}),
  relayWing:line('巡航翼','ROAMING WING','assembly',{requires:'observatory',air:true,hp:165,damage:19,range:208,speed:205,cost:490,wood:145,oil:130,size:83,build:15}),
  supplyDepot:facility('补给站','SUPPLY DEPOT',7,{cost:140,wood:90,build:10}),
  infirmary:facility('战地医务所','FIELD INFIRMARY',5,{requires:'barracks'}),
  commandPost:facility('指挥所','COMMAND POST',5,{requires:'barracks'}),
  hatchery:facility('孵化巢','HATCHERY',1,{hp:900}),
  nursery:facility('育生池','NURTURE POOL'),
  gland:facility('感染腺巢','SPORE GLAND'),
  burrow:facility('缚地巢','BINDING NEST'),
  node:facility('能量节点','ENERGY NODE',7,{cost:165,wood:100,build:10,hp:510}),
  resonator:facility('共鸣工坊','RESONANCE WORKS',1,{hp:850}),
  warpHub:facility('折跃枢纽','WARP HUB',3),
  phaseSanctum:facility('相位圣所','PHASE SANCTUM',5),
  assembly:facility('装配站','ASSEMBLY STATION',2,{hp:1050,cost:420,wood:210,description:'部署后生产远行者作战单位，可收拢成车辆转移。'}),
  relayTower:facility('固定补给塔','SUPPLY MAST',7,{hp:540,cost:135,wood:95,build:10,description:'提高远行者同盟的人口上限。'}),
  routePost:facility('路线站','ROUTE POST',1,{description:'解锁路线工兵，可研究障碍识别。'}),
  observatory:facility('观测所','OBSERVATORY',5,{description:'解锁前沿观测员和巡航翼，可研究区域识别。'}),
  escortDepot:facility('护航调度所','ESCORT DEPOT',5,{description:'解锁护航指挥车和护空车，可研究护航干扰。'}),

};
export interface Technology {name:string;description:string;cost:Cost;duration:number;requires?:Tech;building?:BuildingKind}
export const TECHS = {
  weapons:{name:'精密武器',description:'全军伤害 +20%，解锁幽影狙击手。',cost:{gold:450,wood:250,oil:80},duration:24},
  armor:{name:'复合装甲',description:'所有作战单位最大生命值与当前生命值 +25%。',cost:{gold:500,wood:300,oil:100},duration:28},
  logistics:{name:'智能物流',description:'采集效率 +50%，货仓容量由 100 提升至 150。',cost:{gold:350,wood:250,oil:40},duration:22},
  advanced:{name:'先进工程',description:'解锁远程火炮与泰坦机甲。',cost:{gold:850,wood:400,oil:200},duration:34,requires:'weapons',building:'factory'},
  aviation:{name:'航空技术',description:'解锁航空机库中的猎隼战机。',cost:{gold:650,wood:350,oil:220},duration:32,requires:'weapons',building:'airfield'},
  tier2:{name:'T2 支援分化',description:'在主指挥建筑研究，解锁第二阶段兵种与科技。',cost:{gold:330,wood:155,oil:0},duration:25,building:'base'},
  tier3:{name:'T3 高级干扰',description:'在主指挥建筑研究，解锁高阶支援科技。',cost:{gold:510,wood:225,oil:105},duration:38,requires:'tier2',building:'base'},
  advancedArms:{name:'先进工程',description:'解锁远程火炮与泰坦机甲。',cost:{gold:850,wood:400,oil:200},duration:34,requires:'tier3',building:'factory'},
  aviationSystems:{name:'航空技术',description:'解锁航空机库中的猎隼战机。',cost:{gold:650,wood:350,oil:220},duration:32,requires:'tier2',building:'airfield'},
} as Record<Tech,Technology>;
for(const id of ABILITY_IDS){
  const unlock=ABILITIES[id].research;
  if(unlock)TECHS[id]={name:unlock.name,description:'解锁'+ABILITIES[id].name,building:unlock.building,requires:unlock.tier,
    cost:unlock.tier==='tier3'?{gold:350,wood:180,oil:95}:{gold:210,wood:95,oil:0},duration:unlock.tier==='tier3'?30:19};
}
export const RESOURCE_INFO:Record<ResourceKind,{name:string;symbol:string;color:string;cell:number}>={gold:{name:'金矿',symbol:'◈',color:'#e5c67e',cell:8},wood:{name:'木材',symbol:'♣',color:'#a4c691',cell:9},oil:{name:'石油',symbol:'◉',color:'#a1bed3',cell:10}};
export const INCOME = 0;
export const POPULATION = 80;
export const isMobile = (u: Pick<Unit,'kind'>) => STATS[u.kind].speed > 0;
export const isCombat = (u: Pick<Unit,'kind'>) => isMobile(u) && u.kind !== 'worker' && u.kind !== 'sac';
export const teamOf=(side:Side,players:Pick<Player,'side'|'team'>[])=>players.find(p=>p.side===side)?.team??side;
export const sameTeam=(a:Side,b:Side,players:Pick<Player,'side'|'team'>[])=>teamOf(a,players)===teamOf(b,players);
export const COLORS = ['','#7ce8c2','#f17d77','#8eafff','#e8c875'];
export const unitCost=(kind:Kind):Cost=>({gold:STATS[kind].cost,wood:STATS[kind].wood,oil:STATS[kind].oil});
export const armorApplies=(u:Pick<Unit,'kind'>,p:Player)=>isCombat(u)&&(!p.race||['scout','tank','artillery','mech','disruptor'].includes(u.kind));
export const weaponsApplies=(u:Pick<Unit,'kind'>,p:Player)=>p.tech.includes('weapons')&&(!p.race||['soldier','sniper'].includes(u.kind));
export const maxHp=(u:Unit,p:Player)=>STATS[u.kind].hp*(armorApplies(u,p)&&p.tech.includes('armor')?1.25:1);
