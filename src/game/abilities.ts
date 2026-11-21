import type { BuildingKind, MobileKind, Point } from './types.js';

export type AbilityId = `${'IND'|'BIO'|'ENE'|'RLY'}-0${1|2|3|4|5|6}`;
export type TargetMode='auto'|'self'|'ally'|'enemy'|'point'|'blink'|'area';
export type StatusGroup='attackUp'|'attackDown'|'speedUp'|'slow'|'exposed'|'healCut'|'infection'|'regen'|'root'|'silence'|'barrier'|'rangedGuard'|'splashGuard'|'rootGuard'|'silenceGuard'|'slowGuard';
export interface SkillTarget {target?:number;point?:Point;area?:number}
export interface Status { group:StatusGroup; source:number; side:number; skill:AbilityId; value:number; until:number }
export interface AbilityRuntime {
  energy:number;
  cooldowns:Partial<Record<AbilityId,number>>;
  cast?:SkillTarget&{skill:AbilityId;until:number};
  recovery?:number;
  feedback?:{text:string;until:number};
  effects:Status[];
  healing?:{amount:number;until:number}[];
  auto?:boolean;
}
export interface Ability {
  name:string; unit:MobileKind; target:TargetMode; range:number; energy:number; cooldown:number; windup:number;
  radius?:number; duration?:number; air?:boolean; research?:{name:string;building:BuildingKind;tier:'tier2'|'tier3'};
  summary:string;
}
export const ABILITIES:Record<AbilityId,Ability> = {
  'IND-01':{name:'战地治疗',unit:'medic',target:'auto',range:170,energy:0,cooldown:1,windup:.16,summary:'自动治疗附近地面伤员，每次最多 10 生命。'},
  'IND-02':{name:'应急净化',unit:'medic',target:'ally',range:240,energy:25,cooldown:12,windup:.25,research:{name:'医疗协议',building:'infirmary',tier:'tier2'},summary:'移除优先级最高的一组负面状态。'},
  'IND-03':{name:'集中火力',unit:'commander',target:'self',range:0,radius:220,energy:40,cooldown:20,windup:.35,duration:6,summary:'范围内地面友军获得 +20% 普攻速度。'},
  'IND-04':{name:'掩护烟幕',unit:'commander',target:'point',range:300,radius:140,energy:40,cooldown:24,windup:.4,duration:5,research:{name:'掩护战术',building:'commandPost',tier:'tier2'},summary:'烟幕中的地面友军获得 20% 单体远程普攻减伤。'},
  'IND-05':{name:'弱点标定',unit:'disruptor',target:'enemy',range:300,energy:30,cooldown:14,windup:.35,duration:5,summary:'标定敌方地面单位，目标承伤 +15%。'},
  'IND-06':{name:'电磁封锁',unit:'disruptor',target:'point',range:300,radius:120,energy:50,cooldown:26,windup:.6,duration:2,research:{name:'电磁协议',building:'commandPost',tier:'tier3'},summary:'沉默范围内地面敌军 2 秒，并削减最多 40 原生护盾。'},
  'BIO-01':{name:'再生注入',unit:'nurturer',target:'ally',range:220,energy:30,cooldown:10,windup:.3,duration:6,summary:'逐秒治疗地面友军，6 秒最多恢复 60 生命。'},
  'BIO-02':{name:'代谢净化',unit:'nurturer',target:'ally',range:220,energy:35,cooldown:16,windup:.4,research:{name:'适应代谢',building:'nursery',tier:'tier2'},summary:'移除最多两组负面状态。'},
  'BIO-03':{name:'感染孢子',unit:'infector',target:'enemy',range:280,energy:35,cooldown:14,windup:.4,duration:6,summary:'地面敌军每秒受 4 伤害，生命回复降低 40%。'},
  'BIO-04':{name:'感染催化',unit:'infector',target:'enemy',range:250,energy:30,cooldown:16,windup:.35,duration:5,research:{name:'酸蚀进化',building:'gland',tier:'tier2'},summary:'己队感染仍在时使目标承伤 +20%。'},
  'BIO-05':{name:'地脉缠绕',unit:'binder',target:'enemy',range:240,energy:35,cooldown:18,windup:.5,duration:1.5,summary:'定身地面敌人 1.5 秒。'},
  'BIO-06':{name:'黏液沼泽',unit:'binder',target:'point',range:280,radius:150,energy:45,cooldown:24,windup:.5,duration:6,research:{name:'沼泽腺体',building:'burrow',tier:'tier2'},summary:'地面敌军停留在区域时移速降低 35%。'},
  'ENE-01':{name:'相位屏障',unit:'weaver',target:'ally',range:240,energy:35,cooldown:12,windup:.3,duration:6,air:true,summary:'授予 60 点临时盾。'},
  'ENE-02':{name:'共鸣充能',unit:'weaver',target:'ally',range:220,energy:30,cooldown:14,windup:.4,air:true,research:{name:'共鸣技术',building:'resonator',tier:'tier2'},summary:'补充至多 45 点原生盾。'},
  'ENE-03':{name:'紧急折跃',unit:'guide',target:'blink',range:220,energy:40,cooldown:22,windup:.4,research:undefined,summary:'将己方地面作战单位折跃至 200 距离内的可见空地。'},
  'ENE-04':{name:'相位净化',unit:'guide',target:'ally',range:240,energy:30,cooldown:14,windup:.3,air:true,research:{name:'相位稳定',building:'warpHub',tier:'tier2'},summary:'移除友军一组负面状态，支持空军。'},
  'ENE-05':{name:'相位力场',unit:'arbiter',target:'point',range:280,radius:48,energy:50,cooldown:24,windup:.6,duration:4,summary:'短时阻挡双方地面通行。'},
  'ENE-06':{name:'解构脉冲',unit:'arbiter',target:'enemy',range:280,energy:45,cooldown:20,windup:.45,air:true,research:{name:'解构研究',building:'phaseSanctum',tier:'tier3'},summary:'驱散一组增益，并消除至多 25 个人能量。'},
  'RLY-01':{name:'路标引导',unit:'pathfinder',target:'point',range:240,radius:128,energy:30,cooldown:16,windup:.35,duration:6,summary:'区域内友方地面部队移速 +20%。'},
  'RLY-02':{name:'清障指引',unit:'pathfinder',target:'ally',range:230,energy:30,cooldown:15,windup:.25,duration:2,research:{name:'障碍识别',building:'routePost',tier:'tier2'},summary:'清除地面友军减速并免疫减速 2 秒。'},
  'RLY-03':{name:'前沿观测',unit:'observer',target:'point',range:280,radius:160,energy:35,cooldown:22,windup:.45,duration:6,summary:'以落点为圆心向同队提供地面视野。'},
  'RLY-04':{name:'信标拆解',unit:'observer',target:'area',range:260,energy:40,cooldown:20,windup:.5,research:{name:'区域识别',building:'observatory',tier:'tier2'},summary:'提前结束敌方烟幕、沼泽、路标或观测。'},
  'RLY-05':{name:'疏散警戒',unit:'escort',target:'self',range:0,radius:175,energy:35,cooldown:18,windup:.35,duration:4,summary:'范围内地面友军获得 25% 范围伤害减免。'},
  'RLY-06':{name:'火力压制',unit:'escort',target:'enemy',range:270,energy:40,cooldown:20,windup:.45,duration:5,air:true,research:{name:'护航干扰',building:'escortDepot',tier:'tier3'},summary:'使目标后续普攻频率降低 20%。'},
};
export const ABILITY_IDS=Object.keys(ABILITIES) as AbilityId[];
export const isAbility=(value:unknown):value is AbilityId=>typeof value==='string'&&Object.hasOwn(ABILITIES,value);
export const abilitiesFor=(kind:MobileKind)=>ABILITY_IDS.filter(id=>ABILITIES[id].unit===kind);
export const removableAreas:readonly AbilityId[]=['IND-04','BIO-06','RLY-01','RLY-03'];
export const sustainedAreas:readonly AbilityId[]=[...removableAreas,'ENE-05'];
export const NEGATIVE:readonly StatusGroup[]=['root','silence','healCut','exposed','infection','attackDown','slow'];
export const POSITIVE:readonly StatusGroup[]=['barrier','splashGuard','attackUp','regen'];
export const statusLabels:Record<StatusGroup,string>={attackUp:'攻速提升',attackDown:'火力压制',speedUp:'路标提速',slow:'减速',exposed:'易伤',healCut:'治疗抑制',infection:'感染',regen:'再生',root:'定身',silence:'沉默',barrier:'临时护盾',rangedGuard:'烟幕掩护',splashGuard:'疏散警戒',rootGuard:'定身抗性',silenceGuard:'沉默抗性',slowGuard:'减速免疫'};
