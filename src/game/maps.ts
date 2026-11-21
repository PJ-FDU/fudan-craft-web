// ID 写入存档与联机协议；显示名称可以调整，已发布的 ID 保持稳定。
export const MAPS = [
  {id:'lost-temple',name:'失落神庙',en:'LOST TEMPLE',maxPlayers:4,tag:'林地 · 均衡交锋',description:'经典林间战场。沿宽阔主路推进，在中心资源区建立前哨。'},
  {id:'ring-valley',name:'环形山谷',en:'RING VALLEY',maxPlayers:4,tag:'环路 · 迂回包抄',description:'四条林间通道汇入中央空地。外环便于绕行，守住路口才能稳住补给。'},
  {id:'shattered-highlands',name:'碎石高地',en:'SHATTERED HIGHLANDS',maxPlayers:4,tag:'岩地 · 三路争夺',description:'两道断裂岩脊分隔战场。三条宽隘口连接东西两侧，适合分兵牵制。'},
  {id:'twin-lakes',name:'双湖边境',en:'TWIN LAKES',maxPlayers:4,tag:'湖区 · 中路争夺',description:'南北双湖围出中央走廊。正面争夺资源，也可以沿东西湖岸绕后。'},
  {id:'echo-isles',name:'回音岛',en:'ECHO ISLES',maxPlayers:2,tag:'EI · 海岛双人战',description:'左右基地隔着中央密林相望。沿南北岔路交锋，争夺海岸扩张区与中央补给。'},
  {id:'twisted-meadows',name:'扭曲草地',en:'TWISTED MEADOWS',maxPlayers:4,tag:'TM · 曲径与扩张',description:'四角基地通过蜿蜒林道汇入中央草地。溪湾分隔外围资源区，多条岔路便于绕后与扩张。'},
  {id:'turtle-rock',name:'海龟岩',en:'TURTLE ROCK',maxPlayers:4,tag:'TR · 环道与近点',description:'中央林地被环形通路包围，海湾深入岛岸。出生位成对相邻，近点压制与远点迂回各有节奏。'},
  {id:'terenas-stand',name:'泰瑞纳斯看台',en:'TERENAS STAND',maxPlayers:2,tag:'TS · 河湾双人战',description:'西北与东南基地沿林间大道相连。两道曲折河湾围出中央交锋区，控制通道后再向侧翼扩张。'},
] as const;
export type MapId = typeof MAPS[number]['id'];
export const DEFAULT_MAP_ID:MapId='lost-temple';
export function isMapId(value:unknown):value is MapId {return MAPS.some(map=>map.id===value);}
export function mapInfo(id:MapId){return MAPS.find(map=>map.id===id)!;}
export function supportsPlayers(id:MapId,count:number){return Number.isInteger(count)&&count>=2&&count<=mapInfo(id).maxPlayers;}
