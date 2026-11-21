// 中文是现有界面的源文案；英文只作用于显示层，地图 ID、存档和模拟数据保持稳定。
export const ENGLISH:Record<string,string>=Object.fromEntries(`
P2P 静态版 · 房主创建房间后复制邀请链接。房主需保持页面打开；离开或刷新会结束房间。|P2P edition: create a room and copy its invite link. Keep the host page open; leaving or reloading ends the room.
P2P 自由对战 · 复制邀请链接，发送给其他指挥官加入。|P2P free for all: copy the invite link and share it with other commanders.
房主需保持页面打开；离开或刷新会结束房间。|Keep the host page open; leaving or reloading ends the room.
房主离开会结束整个房间。|Leaving as host ends the entire room.
复制邀请链接|Copy invite link
邀请链接|Invite link
邀请链接已复制|Invite link copied
请选中邀请链接手动复制|Select the invite link and copy it manually
粘贴邀请链接或完整房间标识|Paste an invite link or full room identifier
请粘贴完整的 P2P 邀请链接或房间标识|Paste a complete P2P invite link or room identifier
P2P 战役由房主持续模拟|P2P simulation continues on the host
P2P 战役由房主维护，不支持本地存档|P2P battles are hosted in the browser and cannot be saved locally
P2P 对战|P2P battle
P2P 房主 · 等待连接|P2P host · Waiting for peers
P2P 连接中 · 正在恢复|P2P connecting · Recovering
P2P 连接中断 · 正在恢复|P2P disconnected · Recovering
P2P 直连|Direct P2P
TURN 中继|TURN relay
房主已离开，房间结束|The host left; the room has ended
房主页面已关闭，房间结束|The host page closed; the room has ended
无法连接邀请中的房主。请确认房主页面仍然打开。|Cannot reach the invited host. Make sure the host page is still open.
房主模拟已停止，请重新创建房间|Host simulation stopped. Create a new room.
房主连接正在恢复，请稍后重试|The host connection is recovering. Try again shortly.
性能模式|Performance mode
自动调节|Automatic
优先画质|Quality
省电模式|Power saving
轻量|Light
流畅|Smooth
精细|Fine
FPS 上限|FPS cap
光照|Lighting
AI 策略|AI strategy
均衡推进|Balanced advance
快攻压制|Early pressure
经济扩张|Economic expansion
稳守反击|Defend and counter
空闲|Idle
保存|Save
筛选|Filter
保留选中兵种…|Keep selected type…
移出工人|Remove workers
选择并定位空闲采集车|Select and locate an idle harvester
点击保存，再点击编队编号|Tap Save, then a group number
召回编队|Recall group
编队|Group
已保存|saved
个单位|units
没有空闲采集车|No idle harvesters
为空，请先选择部队并保存|is empty. Select units and save first
房间模式|Room mode
自由对战|Free for all
朋友合作对抗 AI|Friends vs AI
合作对抗 AI|Co-op vs AI
支持 2–4 人自由对战，或 1–2 位朋友合作对抗 AI。两人合作请选择四人地图；共享视野，资源与指挥权独立。|Play free for all with 2–4 commanders or team up with 1–2 friends against AI. Two friends need a four-player map. Sight is shared; resources and command remain independent.
朋友合作 · 人类同队，共享视野，对抗 AI 军团。|Co-op: human commanders share a team and sight against AI armies.
自由对战 · 邀请同一服务器上的指挥官，输入房间码加入战局。|Free for all: invite commanders on this server to join with your room code.
等待重连|Reconnecting
等待指挥官加入或重连|Waiting for commanders to join or reconnect
两人合作需要四人地图|Two friends need a four-player map
位指挥官|commanders
同房间再战|Rematch in this room
查看战局统计|Match statistics
战局统计|Match statistics
导出战局数据|Export match data
指挥官|Commander
采集收入|Harvest income
资源支出|Resources spent
退款|Refunds
造成伤害|Damage dealt
治疗|Healing
击毁 / 损失价值|Destroyed / lost value
工人闲置秒|Worker idle seconds
战局实测 · 金 / 木 / 油分别统计|Measured match data · Gold / Wood / Oil
价值按兵种基础成本计算；工人闲置秒为所有空闲工人的累计时长。经济与兵力每 30 秒采样，导出保留最近 180 个采样点。历史存档从恢复时刻开始统计。|Values use base unit costs; idle time adds all idle workers. Economy and army are sampled every 30 seconds; exports retain 180 samples. Old saves start tracking when restored.
敌方基地已被摧毁，团队战役目标达成。|Enemy bases destroyed. Your team has completed its mission.
己方队伍已失去指挥基地，可继续观察战局。|Your team has lost its command bases. You can continue observing.
战役结束后由当前房主返回作战室，选择地图并开始下一局。|After the battle ends, the host can return this room to the lobby, choose a map and start again.
连接中断 · 正在恢复席位|Disconnected · Recovering your seat
画面暂停更新 · 正在重连|Updates paused · Reconnecting
已恢复原席位|Your seat has been restored
重连席位已过期，请创建或加入新的房间|Your reconnect seat expired. Create or join a new room.
重连已超时|Reconnect timed out
重连已超时，可返回主菜单创建新战役|Reconnect timed out. Return home to start a new battle.
席位已在另一个连接恢复|Your seat was restored in another connection
房间已超时关闭|This room expired
战役结束后才能再战|The battle must end before a rematch
只有房主可以发起再战|Only the host can request a rematch
请等待离线指挥官重连或席位超时|Wait for disconnected commanders to reconnect or their seats to expire
秒内可重连|seconds to reconnect
远征纪元|The Expedition
触屏战术指令|Touch tactical controls
快捷指令|Quick commands
单击选择 · 长按框选|Tap to select · Hold to box select
双击同类 · 三击全部|Double tap: type · Triple tap: all
取消选择或指令|Cancel selection or command
点击目标 · × 取消|Tap a target · × to cancel
点击己方建筑维修|Tap a friendly building to repair
点击目标攻击移动|Tap a target to attack move
点击设置集结点|Tap to set a rally point
点击受损的己方建筑进行维修 · × / Esc 取消|Tap a damaged friendly building to repair · × / Esc to cancel
工人维修建筑 (J)|Worker building repair (J)
建筑维修指令已下达|Building repair ordered
只能维修己方已完工建筑|Only completed friendly buildings can be repaired
建筑生命值已满|Building health is full
维修任务|Repair assignment
正在维修|Repairing
建筑维修中|Building under repair
维修等待资源或作业位置|Repair waiting for resources or a work position
维修中 · 还需约|Repairing · about
维修中|Repairing
维修|Repair
辆维修中|repairing
全军|Army
调度|Dispatch
采集金矿、木材与原油并运回基地，也能建造和维修建筑。|Harvest gold, wood and oil, return them to base, construct and repair buildings.
每次治疗 10 生命，支援受伤的友方地面作战单位，无法攻击。|Restore 10 HP per treatment to wounded friendly ground combat units. Cannot attack.
超远射程与范围轰击，爆炸边缘伤害递减，无法攻击空中目标。|Long-range area bombardment with reduced damage at the blast edge. Cannot attack aircraft.
自动攻击范围内的地面与空中敌人，需要部队配合防守。|Automatically attack ground and air enemies in range. Needs supporting troops for defense.
触屏操作|Touch controls
单击己方单位选择；选中后点击空地移动、敌军攻击、资源采集。选中工人后点击受损建筑维修或未完工建筑续建。|Tap friendly units to select. With units selected, tap ground to move, enemies to attack, or resources to gather. Selected workers repair damaged buildings or resume construction when tapped.
双击单位选择当前视野同类，三击选择己方全部移动单位（含工人）。长按 420 毫秒后拖出选择框；直接单指拖动平移，双指平移和缩放战场。|Double tap a unit to select its type in view; triple tap to select all friendly mobile units, including workers. Hold for 420 ms, then drag to box select. Drag immediately to pan; use two fingers to pan and zoom the battlefield.
底部「调度」打开生产、建造和科技；点击选中摘要查看详细数值，× 取消选择或指令。|Dispatch opens production, construction and research. Tap the selection summary for detailed stats; × cancels selection or commands.
选中工人后右键受损的己方建筑维修；也可选中受损建筑点击「维修」，或按 J 后点击建筑。维修按恢复生命消耗资源，完成后恢复采集。|Select workers and right-click a damaged friendly building to repair. You can also select the building and press Repair, or press J then click a building. Repair costs resources per HP restored; workers resume gathering on completion.
继续|Resume
部署|Deploy
输入 6 位房间码|Enter a six-character room code
战役设置与地图选择|Operation settings and map selection
FudanCraft 重制版：在失落神庙中集结部队、探索迷雾，指挥属于你的即时战略战役。|FudanCraft remastered: assemble your army in the Lost Temple, explore the fog and command your own real-time strategy expedition.
在迷雾之外，建立你的秩序。|Build your order beyond the fog.
你的下一场远征，从这里开始。|Your next expedition starts here.
制定作战计划，踏入未知之地。|Plan your operation. Enter the unknown.
调整你的视听与操作偏好。|Adjust your audio, visuals and controls.
暂时撤退，重整旗鼓。|Regroup for the next operation.
战场属于你。|The battlefield is yours.
与指挥官并肩交锋|Fight alongside other commanders
邀请同一服务器上的指挥官，输入房间码加入战局。|Invite commanders on the same server to join with your room code.
创建房间或输入 6 位房间码，支持 2–4 人实时对战。局域网玩家通过同一台服务器地址访问游戏。|Create a room or enter a six-character code for 2–4 player battles. LAN players connect to the same server address.
从容建立你的补给线。|Build your supply lines at your own pace.
发展与交锋之间的平衡。|Balance expansion with combat.
每一次决策，都关乎生存。|Every decision counts.
对手的进攻节奏较慢，适合熟悉采集、建设与兵种协同。|A slower opponent gives you time to learn harvesting, construction and combined arms.
在稳定的经济与军事压力下，规划你的扩张和第一波进攻。|Plan your expansion and opening attack under steady economic and military pressure.
对手更早施加进攻压力，需要更紧凑的建设与作战节奏。|Earlier enemy attacks demand efficient construction and decisive tactics.
你与一位 AI 指挥官交锋|Face one AI commander
两位 AI，三支军团争夺战场|Two AI commanders. Three armies contest the field.
三位 AI，完整的多方角逐|Three AI commanders in a four-way battle
1 对 1|1 vs 1
三方混战|Three-way battle
四方混战|Four-way battle
2–4 人混战|2–4 player battle
2 人交锋|Two-player battle
2–4 人|2–4 players
2 人|2 players
限 2 人|Two players only
；两人地图在此规模下不可用。|; two-player maps are unavailable at this scale.
人战役选择| player battle: selected
已为|For
张地图，| maps,
张地图 ·| maps ·
支军团。| armies.
支军团 ·| armies ·
位指挥官已就绪 ·| commanders ready ·
位指挥官| commanders
休闲|Explorer
标准|Commander
挑战|Veteran
交锋规模|Battle size
AI 难度|AI difficulty
初始补给|Starting supplies
战役设置|Operation settings
战场地图|Battlefield
选择战场|Choose battlefield
战场尺寸|Map size
支持规模|Supported players
支持|Supports
当前部署|Deployment
战役部署步骤|Deployment steps
开始部署|Deploy
下一步|Next
下一帧|Next frame
单人战役|Single player
多人联机|Multiplayer
继续远征|Continue expedition
新的战役|New operation
新建战役|New operation
再来一局|Play again
暂无本地存档|No local save
暂无生产任务|No production tasks
存档无法读取|Save unavailable
可开始新的战役。|Start a new operation.
本地战役已保存 ·|Local operation saved ·
读取上次存档|Load last save
读取存档|Load save
已恢复上次战役|Previous operation restored
已读档|Save loaded
已保存 ·|saved ·
战役已保存到当前浏览器|Operation saved in this browser
存档失败，浏览器存储不可用|Could not save: browser storage is unavailable
当前浏览器还没有存档|This browser has no saved operation
当前存档无法读取；扩展版使用独立 v2 存档|Cannot read this save; the expansion uses separate v2 saves
存档格式无效或地图不受支持|Invalid save format or unsupported map
开始战役后可以保存|Start an operation before saving
自动存档已更新 ·|Autosave updated ·
自动存档：单机战役每 30 秒保存一次。存档保留在本浏览器。|Single-player operations autosave every 30 seconds in this browser.
光照选项随本浏览器保存，在进入战场后生效；不支持的设备自动使用基础渲染。单机战役每 30 秒自动存档，返回主菜单时也会保存。|Lighting preferences are saved in this browser and applied on deployment. Unsupported devices use basic lighting. Single-player operations save every 30 seconds and on return to the main menu.
联机战役由服务器维护，不支持本地存档|Multiplayer battles are hosted by the server and cannot be saved locally
单机战局在菜单打开时暂停，关闭菜单后恢复。|Single-player battles pause while this menu is open and resume when it closes.
联机战役持续进行，打开菜单不会暂停其他玩家。|Multiplayer battles continue while menus are open.
联机战役正在进行。离开后将由 AI 接管你的部队。|This multiplayer battle is running. AI will take over your army when you leave.
保存并返回主菜单|Save and return to main menu
离开并返回主菜单|Leave and return to main menu
离开战役并返回主菜单|Leave battle and return to main menu
返回主菜单|Main menu
返回战场|Return to battle
查看战场|View battlefield
保存战局|Save operation
继续战役|Resume battle
继续指挥|Resume command
返回|Back
菜单|Menu
游戏设置|Settings
游戏主菜单|Main menu
主菜单|Main menu
首页|Home
战术档案|Field archives
远征部队档案|Expedition units
战术地图|Tactical map
战术控制台|Tactical console
战局工具|Battle tools
战局菜单|Battle menu
战局控制|Battle controls
战局时间|Battle time
作战用时|Elapsed time
作战指挥|Battle command
远征指挥系统|Expedition command
远征前线|Expedition front
当前作战目标|Mission objective
建立补给线，发展科技，集结远征军。|Establish supply lines, develop technology and assemble your army.
保护采集线，让每一份资源都产生价值。|Protect your supply lines. Make every resource count.
所有敌方基地已被摧毁，战役目标达成。|All enemy bases destroyed. Mission complete.
己方指挥基地已被摧毁。调整兵种搭配，准备下一场战役。|Your command center was destroyed. Refine your army composition for the next battle.
摧毁敌方基地|Destroy enemy bases
等待指挥官部署|Awaiting deployment
战役进行中 · 保护己方基地|Operation in progress · Protect your base
指挥权限已移交。祝你好运，指挥官。|Command transferred. Good luck, commander.
战役已开始，等待你的指令|Operation started. Awaiting orders.
采集车已就绪 · 资源需要运回基地|Harvesters ready · Return resources to base
所有系统运行正常|All systems operational
本地系统就绪|Local system ready
本场战役已结束|This battle has ended
对局已结束|Battle ended
指挥中心已被摧毁|Command center destroyed
先开始战役，接管你的部队|Start an operation to command your army
先选择作战部队|Select your combat units first
先在指挥中心训练工程采集车|Train a harvester at the command center first
战局已暂停，按 P 继续|Battle paused. Press P to resume.
战局已暂停|Battle paused
暂停 / 恢复战役|Pause / resume battle
暂停 / 继续|Pause / resume
暂停战役|Pause battle
暂停|Pause
已暂停|Paused
已结束|Ended
作战中|In battle
待部署|Awaiting deployment
暂停动画|Pause animation
播放动画|Play animation
动画图鉴|Animation gallery
远征动画图鉴|Expedition animation gallery
动画素材正在加载，请稍候|Loading animations. Please wait.
查看八个朝向的动作、建筑各阶段与林间风动。暂停后可逐帧查看。|Inspect eight facing directions, building stages and forest motion. Pause to step through frames.
图鉴分类|Gallery category
部队动作|Unit actions
基地建筑|Base buildings
林间风动|Forest motion
地表细节|Ground detail
序列帧动画预览|Animation preview
对象|Subject
同一树形连续轻摆 · 12 秒微风周期 · 树根与下部树干固定|Continuous tree sway · 12-second breeze cycle · Roots and lower trunks stay fixed
高分辨率微观纹理 · 战场按缩放级别分块绘制，最高 4 像素 / 世界像素|High-resolution terrain detail · Tiled by zoom level, up to 4 pixels per world pixel
个朝向 · 每朝向| directions · Each direction:
帧待机| idle frames
帧移动| move frames
帧阵亡| death frames
帧生产动画| production frames
个建造阶段| construction stages
级建筑损毁| damage stages
帧| frames
待机|Idle
移动|Move
攻击|Attack
治疗|Heal
阵亡|Death
作业|Work
施工进度|Construction progress
损毁程度|Damage level
生产循环|Production cycle
松树|Pine
橡树|Oak
白桦|Birch
灌木|Shrub
泥土|Earth
草地|Grass
东北|NE
东南|SE
西北|NW
西南|SW
东|E
南|S
西|W
北|N
工程采集车|Harvester
突击步兵|Rifleman
侦察战车|Scout Buggy
战地医疗兵|Field Medic
幽影狙击手|Ghost Sniper
攻城坦克|Siege Tank
远程火炮|Howitzer
猎隼战机|Falcon VTOL
泰坦机甲|Titan Walker
指挥中心|Command Center
步兵营|Barracks
战车工厂|Vehicle Works
航空机库|Airfield
石油精炼厂|Refinery
科技研究中心|Research Lab
木材加工厂|Lumber Mill
聚能电站|Power Plant
哨戒炮塔|Sentinel
侦察车|Scout
采集车|Harvester
工程车|Harvester
医疗兵|Medic
狙击手|Sniper
步兵|Infantry
坦克|Tank
机库|Airfield
研究中心|Research lab
电站|Power plant
精炼厂|Refinery
采集金矿、木材与原油并运回基地，也能建造建筑。|Harvest gold, wood and oil, return them to base and construct buildings.
可靠的基础火力，低成本部署，适合保护采集线。|Affordable basic firepower, ideal for protecting supply lines.
高机动、广视野，适合探索和切断补给。|Fast movement and wide vision for scouting and disrupting supply lines.
自动治疗附近受伤的友方地面单位，无法攻击。|Automatically heals nearby injured allied ground units. Cannot attack.
远距离精确射击，对步兵额外伤害。|Long-range precision fire with bonus damage against infantry.
重装甲与范围火力，适合正面推进。|Heavy armor and area firepower for frontline advances.
超远射程与大范围轰击，无法攻击空中目标。|Extreme range and wide bombardment. Cannot attack air targets.
无视地形的空中单位，高机动持续打击。|A fast aircraft that ignores terrain and delivers sustained attacks.
高生命值的重型突击单位，解锁于先进工程。|A durable heavy assault unit unlocked by Advanced Engineering.
训练采集车，接收全部资源。被摧毁即出局。|Trains harvesters and accepts all resources. Lose it and you are eliminated.
生产突击步兵，搭配研究中心解锁医疗兵与狙击手。|Trains riflemen. A research lab unlocks medics and sniper technology.
生产侦察车、坦克、火炮与重型机甲。|Produces scouts, tanks, artillery and heavy walkers.
研究航空技术后生产猎隼战机。|Produces Falcon VTOLs after Aviation research.
解锁原油开采，兼作采集车交付资源的补给点。|Unlocks oil harvesting and serves as a resource drop-off point.
研发火力、装甲、物流、先进工程与航空技术。|Researches weapons, armor, logistics, engineering and aviation.
提高伐木效率 50%，同时作为前线资源交付点。|Improves wood harvesting by 50% and provides a forward resource drop-off point.
提供 60 电力，低电力时军事生产与研究暂停。|Provides 60 power. Military production and research pause when power is insufficient.
自动攻击范围内的地面与空中敌人。|Automatically attacks ground and air enemies within range.
精密武器|Precision Weapons
复合装甲|Composite Armor
智能物流|Smart Logistics
先进工程|Advanced Engineering
航空技术|Aviation
全军伤害 +20%，解锁幽影狙击手。|All units gain 20% damage. Unlocks Ghost Snipers.
所有作战单位最大生命值与当前生命值 +25%。|All combat units gain 25% maximum and current health.
采集效率 +50%，货仓容量由 100 提升至 150。|Harvesting efficiency +50%. Cargo capacity increases from 100 to 150.
解锁远程火炮与泰坦机甲。|Unlocks Howitzers and Titan Walkers.
解锁航空机库中的猎隼战机。|Unlocks Falcon VTOLs at the airfield.
从采集到机械化远征|From harvesting to mechanized warfare
一辆采集车到一支机械化远征军。不同兵种需要对应的生产建筑与科技。|Build a mechanized expedition from a single harvester. Each unit needs its production building and technology.
金矿和木材驱动早期建设；精炼厂解锁石油。生产建筑决定兵种，研究中心决定技术。所有前置建筑必须建造完成。|Gold and wood fund early construction; refineries unlock oil. Production buildings unlock units and research labs unlock technology. Required buildings must be complete.
留意电力上限：电力不足时，军事生产和研究暂停；指挥中心仍可生产采集车。建造额外电站可以恢复供电。|Watch your power supply: insufficient power pauses military production and research. The command center can still train harvesters. Build more power plants to restore supply.
建立补给|Establish supplies
基础军事|Basic military
机械化|Mechanization
先进科技|Advanced technology
支援升级|Support upgrades
原油采集|Oil harvesting
伐木 +50%，可就近交付全部资源|Wood harvesting +50%; accepts all resources nearby
采集效率 +50%，货仓|Harvesting +50%; cargo
全部作战单位生命值 +25%|All combat units: health +25%
查看科技发展路线|View technology roadmap
资源采集并运回后才可使用。先建立补给，再推进战线。|Resources become available after delivery. Establish supplies before advancing.
失落神庙|Lost Temple
环形山谷|Ring Valley
碎石高地|Shattered Highlands
双湖边境|Twin Lakes
回音岛|Echo Isles
扭曲草地|Twisted Meadows
海龟岩|Turtle Rock
泰瑞纳斯看台|Terenas Stand
林地 · 均衡交锋|Woodland · Balanced battle
环路 · 迂回包抄|Ring roads · Flanking routes
岩地 · 三路争夺|Highlands · Three fronts
湖区 · 中路争夺|Lakes · Central corridor
EI · 海岛双人战|EI · Island duel
TM · 曲径与扩张|TM · Winding paths and expansion
TR · 环道与近点|TR · Ring roads and close spawns
TS · 河湾双人战|TS · River duel
经典林间战场。沿宽阔主路推进，在中心资源区建立前哨。|Advance along broad forest roads and establish an outpost at the central resources.
四条林间通道汇入中央空地。外环便于绕行，守住路口才能稳住补给。|Four forest paths converge on a central clearing. Use the outer ring to flank and hold junctions to secure supplies.
两道断裂岩脊分隔战场。三条宽隘口连接东西两侧，适合分兵牵制。|Two broken ridges divide the battlefield. Three broad passes connect east and west, rewarding split attacks.
南北双湖围出中央走廊。正面争夺资源，也可以沿东西湖岸绕后。|Two lakes frame a central corridor. Contest resources head-on or flank along either shore.
左右基地隔着中央密林相望。沿南北岔路交锋，争夺海岸扩张区与中央补给。|Bases face each other across dense forest. Fight along northern and southern routes for coastal expansions and central supplies.
四角基地通过蜿蜒林道汇入中央草地。溪湾分隔外围资源区，多条岔路便于绕后与扩张。|Winding forest roads connect four corner bases to the central meadow. Streams divide outer resources; branching paths enable flanking and expansion.
中央林地被环形通路包围，海湾深入岛岸。出生位成对相邻，近点压制与远点迂回各有节奏。|Ring roads surround the central forest while bays cut into the island. Paired spawns support close pressure and distant flanking.
西北与东南基地沿林间大道相连。两道曲折河湾围出中央交锋区，控制通道后再向侧翼扩张。|A forest road connects northwest and southeast bases. Two winding rivers frame the center; control the crossings before expanding.
含 4 张魔兽经典布局|Includes 4 classic Warcraft layouts
地形、资源与出生位置预览| terrain, resources and spawn preview
出生点|Spawn
油井|Oil well
水域|Water
资源与电力|Resources and power
资源采集|Harvest resources
精炼补给|Refine supplies
科技研发|Research technology
金矿|Gold
木材|Wood
石油|Oil
原油|Oil
库存| stock
资源运回基地后计入库存|Added to stock after delivery to base
建设精炼厂后可开采|Harvestable after building a refinery
采集并运回后计入|Added after harvesting and delivery
电力供给与消耗|Power supply and demand
电力供给|Power supply
电力|Power
供电充足|Power sufficient
电力不足：军事生产与研究暂停|Low power: military production and research paused
缺电：军事生产与研究暂停|Low power: military production and research paused
电力不足 · 进度已暂停|Low power · Progress paused
供电|Supply
用电|Demand
消耗|Demand
充足|Sufficient
不足|Insufficient
缺电暂停|Low power
部队选择、单位信息与建造进度|Selection, unit information and construction progress
所选单位信息|Selected unit information
选中单位列表|Selected units
单位识别图|Unit identification
定位选中单位|Focus selected unit
部队指挥|Unit command
尚未选择单位|No unit selected
选择部队或建筑|Select a unit or building
选择部队、建筑或资源|Select a unit, building or resource
已选中|Selected
已选择|Selected
个单位等待指令 · F3 选择空闲采集车| units ready · F3 selects idle harvesters
个单位| units
点击头像单选 · Shift 点击移出编队|Click a portrait to select · Shift-click to remove
点击单选，Shift 移出|Click to select; Shift removes
等待指令|Awaiting orders
正在移动|Moving
正在交战|Engaging
正在采集|Harvesting
采集中|Harvesting
返回交付|Returning cargo
建造任务|Construction task
建筑已就绪|Building ready
建筑施工中|Under construction
正在建造|Constructing
建造中|Constructing
施工中 · 还需约|Construction · About
工程车正在就位|Harvester approaching
等待工程车续建|Waiting for a harvester
正在研究|Researching
正在生产|Producing
研究排队中|Research queued
已完成|Complete
已就绪|Ready
建造指令已下达| construction ordered
已指派采集|Harvesting assigned:
生产集结点已设置|Rally point set
生产建筑可以并行工作|Production buildings work in parallel
生产 / 研究队列|Production / research queue
生产 / 研究|Production / research
点击取消 · 全额退款|Click to cancel · Full refund
点击全额退款|Click for a full refund
生产队列已满|Production queue full
作战人口|Army population
击毁 / 损失|Kills / losses
击毁单位|Units destroyed
部队损失|Units lost
生命|Health
射程|Range
移速|Speed
载货|Cargo
剩余|Remaining
辆采集中 ·| harvesting ·
辆建造中 · 已交付| constructing · Delivered
资源剩余|Resources remaining
资源点|Resource node
采集 / 建造|Harvest / build
采集 / 施工|Harvest / build
资源需要运回基地|Return resources to base
右键采集|Right-click to harvest
作战与基地指令|Army and base commands
战场概览|Battlefield overview
基地调度|Base management
调度分类|Management category
基地建设|Base construction
生产|Produce
建造|Build
科技|Technology
调度|Manage
展开 / 收起调度面板|Expand / collapse management panel
展开调度面板|Expand management panel
收起调度面板|Collapse management panel
展开|Expand
收起|Collapse
点击训练 ·|Train ·
点击选择建造位置|Choose construction site
点击开始研究|Start research
训练|Train
研究|Research
资源不足：需要足够的金矿、木材和石油|Insufficient gold, wood or oil
建造资源不足|Insufficient construction resources
研究资源不足|Insufficient research resources
资源不足|Insufficient resources
已达到 80 人口上限|Population limit reached (80)
建筑上限为 35 座|Building limit reached (35)
每位指挥官仅有一个指挥中心|Each commander can have only one command center
需要当前视野内的空地|Requires visible open ground
需要靠近己方建筑|Must be near an allied building
该位置有地形阻挡|Terrain blocks this site
不能在资源点上建造|Cannot build on a resource node
与现有建筑距离过近|Too close to another building
工程采集车无法抵达该地点|The harvester cannot reach this site
需要选择己方工程采集车|Select an allied harvester
请先选择工程采集车|Select a harvester first
需要先建造石油精炼厂|Build a refinery first
资源点不在当前视野内或已枯竭|Resource node is unseen or depleted
该科技已完成或正在研究|Technology is already complete or being researched
需要科技研究中心|Requires a research lab
需要先研究|Research required:
需要研究|Research required:
需要|Requires
前置：|Required:
队列已满|Queue full
无效兵种|Invalid unit type
无效坐标|Invalid coordinates
无效建筑朝向|Invalid building facing
无效建筑|Invalid building
无效指令|Invalid command
无效科技|Invalid technology
无效队列|Invalid queue
无效消息|Invalid message
全军|Army
部队|Units
全选|Select all
选择全部作战部队|Select all combat units
选择空闲采集车|Select idle harvesters
左键点选 / 拖动框选|Click to select / Drag to box-select
左键点选 · 拖动框选 · Shift 多选|Click to select · Drag to box-select · Shift for multiple
左键选择和框选部队|Left-click to select or box-select units
左键选择|Left-click to select
左键点选|Left-click to select
点选 / 拖动框选|Select / box-select
加选 / 取消单位|Add / remove units
移动 / 指定攻击|Move / attack target
右键移动、攻击或采集|Right-click to move, attack or harvest
右键移动或攻击|Right-click to move or attack
右键采集 / 行动|Right-click to harvest / act
左键|Left-click
右键|Right-click
拖动框选|Drag to box-select
攻击移动至目标|Attack-move to destination
攻击移动|Attack-move
进攻|Attack
原地驻守|Hold position
原地防守|Hold position
驻守当前位置|Hold position
驻守|Hold
停止当前指令|Stop current order
停止|Stop
训练步兵 / 采集车 / 坦克|Train infantry / harvester / tank
移动战场视野|Pan battlefield
轻按回基地，按住 + 左键拖图|Tap to focus base; hold + drag to pan
滚轮 / 捏合|Wheel / pinch
以指针为中心缩放|Zoom around pointer
旋转 3D 视角|Rotate 3D view
旋转待放置的建筑|Rotate building preview
旋转建筑|Rotate building
向左旋转视角|Rotate view left
向右旋转视角|Rotate view right
保存编队|Save control group
召回编队|Recall control group
编队|Group
设置生产集结点|Set rally point
一键全屏 / 退出|Toggle fullscreen
隐藏 / 显示控制台|Toggle console
隐藏控制台|Hide console
显示控制台|Show console
控制台|Console
面板|Console
中键 / 右键拖动|Middle / right-drag
平移战场|Pan battlefield
方向键平移|Arrow keys to pan
方向键平移 · 中键 / 右键拖动 · 滚轮缩放|Arrows to pan · Middle / right-drag · Wheel to zoom
滚轮缩放|Wheel to zoom
取消指令 / 取消选择|Cancel order / clear selection
绿色可建造 / 红色不可建造 · Esc 取消|Green: valid / Red: blocked · Esc to cancel
点击战场：攻击移动 · Esc 取消|Click battlefield to attack-move · Esc to cancel
点击战场：设置基地集结点 · Esc 取消|Click battlefield to set rally point · Esc to cancel
放置|Place
Esc 取消|Esc to cancel
操作指南|Field manual
指挥官操作指南|Commander's field manual
收到，指挥官|Understood, commander
探索地图、训练部队、保护基地。使用不同兵种协同作战，摧毁敌方基地取得胜利。|Explore, train units and protect your base. Combine unit types and destroy enemy bases to win.
在「基地建设」中选择建筑，再在绿色空地放置；工程采集车自动前往建造。右键金矿或树木开始采集。先在油点附近建造精炼厂，再在油点建油井。双击同一兵种可选中当前视野内的该类部队。滚轮围绕指针缩放，Shift + 滚轮横移，Alt + 滚轮平移。触屏单指拖图，双指平移与缩放；可在菜单中开启触控板模式。小地图支持点击与拖动。选中部队后左键点击空地也可移动，兼容原版操作。|Choose a building in Construction and place it on green ground; a harvester will build it. Right-click gold or trees to harvest. Build a refinery near an oil deposit, then place a well on the deposit. Double-click a unit to select its visible type. Wheel zooms around the pointer; Shift + wheel pans horizontally, Alt + wheel pans. On touchscreens, drag with one finger or pan and zoom with two. Enable trackpad mode in Settings. Click or drag the minimap to navigate. Selected units also move when you left-click open ground.
联机对战由服务器持续模拟|Multiplayer simulation continues on the server
联机战役持续运行|Multiplayer battle running
联机战役开始|Multiplayer battle started
联机战役|Multiplayer battle
联机对战|Multiplayer
联机|Online
联合作战网络已接入|Joint operations network connected
实时连接中|Connected live
联机连接已断开。可以从战局菜单新建单机战役。|Multiplayer disconnected. Start a single-player operation from the battle menu.
联机连接已断开|Multiplayer disconnected
连接已断开，战场画面停止更新|Disconnected. Battlefield updates stopped.
连接已断开，请返回单机战役|Disconnected. Return to single player.
房间连接已断开，请重新加入|Room disconnected. Please rejoin.
无法连接联机服务器|Cannot connect to multiplayer server
连接超时|Connection timed out
请先离开当前房间|Leave your current room first
服务器房间已满|Server room limit reached
房间不存在、已开始或所选地图人数已满|Room not found, already started or full
只有房主可以选择地图|Only the host can choose the map
战役开始后不能更换地图|Cannot change the map after deployment
最多支持| supports up to
请选择人数足够的地图|Choose a map with enough player slots
至少需要两位指挥官|At least two commanders are required
所选地图不支持当前人数|This map does not support the current player count
房间等待超时，请重新创建|Room timed out. Please create a new one.
指令过于频繁|Too many commands
未知战场|Unknown battlefield
已离线，AI 接管其部队| disconnected. AI has taken over their army
请输入正确的 6 位房间码|Enter a valid six-character room code
等待至少一位对手加入|Waiting for at least one opponent
可以开始战役|Ready to start
等待房主开始战役…|Waiting for the host to start...
当前联机战役|Current multiplayer battle
作战室已建立|Operations room created
加入作战房间|Join operations room
加入已有房间|Join existing room
创建房间|Create room
开始联机战役|Start multiplayer battle
复制房间码|Copy room code
房间码已复制|Room code copied
离开房间|Leave room
由房主选择|Selected by host
房间码：|Room code:
房间|Room
房主|Host
指挥官代号|Commander callsign
指挥官|Commander
（你）|(you)
赤焰军团|Crimson Legion
赤焰|Crimson
苍穹|Sky
金砂|Goldsand
军团|Legion
己方|Ally
敌方|Enemy
未探索|Unexplored
完整科技链|Full technology tree
金矿库存|Gold stock
声音与通讯|Audio and communications
总音量|Master volume
背景音乐|Music
战斗与界面|Combat and UI
环境声|Ambient sound
部队与指挥语音|Unit and command voices
开启游戏声音|Enable game audio
显示通讯字幕|Show communication subtitles
试听阵营|Preview faction
工业联邦|Industrial Federation
生群共生体|Brood Symbiosis
星能议会|Stellar Council
远行者同盟|Relay Alliance
试听部队通讯|Preview unit voice
首次点击后开始播放。语音播报时音乐自动降低；切换到后台会暂停声音。偏好自动保存。|Audio starts after your first interaction. Music ducks during voice lines; audio pauses in the background. Preferences save automatically.
请先开启声音并调高总音量、语音音量|Enable audio and turn up master and voice volume first
音频暂时无法加载，请检查网络后重新开启声音。|Audio could not load. Check your connection and enable audio again.
开启声音|Enable audio
关闭声音|Mute audio
开启音效|Enable sound effects
声音|Audio
音效|Sound
开|On
关|Off
部队通讯|Unit comms
指挥链路|Command link
播放部队与环境动画|Animate units and environment
显示单位生命值|Show unit health
显示选中单位攻击范围|Show selected unit attack range
触控板模式：双指平移 / 捏合缩放|Trackpad mode: two-finger pan / pinch zoom
间接光照|Indirect lighting
基础 · 最省性能|Basic · Best performance
均衡 · 动态反弹光|Balanced · Dynamic bounce light
精细 · 更清晰的反弹光|High · Detailed bounce light
精细档需要更多显卡性能；设置自动保存|High quality requires more GPU power; preferences save automatically
当前设备不支持浮点渲染，使用基础光照|This device uses basic lighting because floating-point rendering is unavailable
当前使用 2D 战场|Using 2D battlefield
3D 渲染已中断，已切换至 2D 战场|3D rendering interrupted; switched to 2D
3D 战场启动失败，已启用 2D 渲染。|3D initialization failed; using 2D rendering.
Three.js 3D 战场已就绪|3D battlefield ready
无法加载素材|Could not load asset
正在准备战场|Preparing battlefield
载入地形与远征部队，请稍候…|Loading terrain and expedition units...
战场加载未完成|Battlefield loading incomplete
重新加载|Retry
实时战场|Live battlefield
战场：|Battlefield:
全屏|Fullscreen
进入全屏|Enter fullscreen
退出全屏|Exit fullscreen
切换全屏|Toggle fullscreen
退出沉浸模式|Exit immersive mode
当前预览限制浏览器全屏，已进入沉浸模式；V 可隐藏控制台|Fullscreen is unavailable here. Immersive mode enabled; V hides the console.
浏览器未允许系统全屏，已切换沉浸模式|Fullscreen denied; immersive mode enabled
确认|Confirm
选择|Select
进入|Enter
退出|Exit
关闭|Close
缩小|Zoom out
放大|Zoom in
返回基地|Focus base
轻按空格|Tap Space
轻按空格返回基地|Tap Space to focus base
点击小地图切换视野|Click the minimap to move the camera
显示|Show
隐藏|Hide
定位|Focus
秒|s
格| tiles
语言与语音|Language and voices
游戏语言|Game language
界面和语音同时切换，自动保存。|Interface and voices switch together. Your preference is saved.
切换为英文|Switch to English
切换为中文|Switch to Chinese
资源总量|Total resources
剩余资源|Remaining resources
资源已枯竭|Resource depleted
指南|Guide
补给提示|Supply alerts
关键事件|Key events
前哨首次入账|First outpost delivery
前哨首次交战|First outpost fight
首辆坦克出场|First tank deployed
油井断供|Oil supply interrupted
补给线遭袭|Supply line under attack
主金矿即将枯竭|Main gold mine running low
主油点即将枯竭|Main oil deposit running low
预计枯竭|Estimated time to depletion
点击定位|Click to center
部队编队|Control groups
保存选中单位到编队|Save selected units to a group
追加|Append
加选|Add to selection
选择编队编号|Choose a group
鼠标编队：先点击「保存」「追加」或「加选」，再点击编队编号。也可点击编号召回，双击定位。|Mouse controls: click Save, Append or Add to selection, then a group number. Click a number to recall or double-click to center.
请选择要编队的单位|Select units to save to a group
向编队追加单位|Add selected units to a group
召回编队，连按两次定位|Recall a group, press twice to center
将编队加选到当前选择|Add a group to the current selection
点击召回，双击定位|Click to recall, double-click to center
点击保存|Click to save
为空，请先选择部队并保存|is empty. Select units and save the group.
已保存|saved
建造精炼厂 / 油井 / 木材加工厂|Build refinery / oil well / lumber mill
缩放战场|Zoom the battlefield
轮选空闲采集车|Cycle idle harvesters
点击「保存」再点 1–3 保存编队，点击编号召回，连点两次定位。|Tap Save and a number from 1 to 3 to save a group. Tap the number to recall it or tap twice to center.
油井|Oil Well
石油 · 支撑装甲与航空生产|Oil · Funds armored and aircraft production
采集金矿和木材，也能建造和维修建筑。|Harvests gold and wood and builds and repairs structures.
连接附近油井并处理石油，也接收金矿。|Processes oil from nearby wells and accepts gold deliveries.
提高伐木效率 50%，接收金矿和木材。|Increases harvesting speed for wood by 50% and accepts gold and wood.
建于精炼厂覆盖的油点上，通过管道自动输油。|Place on an oil deposit within refinery range to deliver oil by pipeline.
建造油井|Build an oil well
在油点上建造油井|Build an oil well on the deposit
点击精炼厂覆盖内的油点建井 · Esc 取消|Click an oil deposit within refinery range · Esc to cancel
油井必须建在有储量的油点上|Build an oil well on a deposit with oil remaining
油点附近需要已完工的己方石油精炼厂|A completed refinery of your own must be near the oil deposit
请在油点上建造油井|Build an oil well on the oil deposit
此战局使用采集车采油|This match uses harvesters for oil
油井通过管道输油|Wells deliver oil by pipeline
采集车采油|Harvesters extract oil
管道输油中|Delivering oil by pipeline
等待连接精炼厂|Waiting for a refinery connection
油点已枯竭|Oil deposit depleted
剩余石油|Oil remaining
产量|Output
采矿中|Mining
排队中|Queued
金矿枯竭待指派|waiting for a new mine
金矿已枯竭 · 等待指派|Gold mine depleted · Waiting for orders
金矿和木材驱动早期建设，石油支撑机械化。|Gold and wood fund early construction, while oil enables mechanized forces.
伐木 +50%，可就近交付木材和金矿|Wood harvesting +50%; accepts wood and gold nearby
战斗|Combat
种族模型图鉴|Faction model gallery
拖动旋转、滚轮缩放。查看四个种族的部队、建筑与动作。|Drag to orbit, scroll to zoom. Explore units, structures and animations from all four factions.
三维模型预览，可拖动旋转|3D model preview, drag to orbit
当前设备未启用 3D 渲染，无法显示模型图鉴。|3D rendering is unavailable on this device.
当前设备无法创建 3D 预览，请关闭其他图形页面后重试。|Unable to create a 3D preview. Close other graphics pages and try again.
正在加载三维模型…|Loading 3D models…
模型加载失败，请关闭图鉴后重试。|Models could not be loaded. Close the gallery and try again.
装配站收拢形态|Packed assembly station
暂停动作|Pause animation
播放动作|Play animation
自动旋转|Auto rotate
重置视角|Reset view
玩家颜色|Player color
翡翠绿|Jade
赤红|Coral
天蓝|Blue
金黄|Gold
采集 / 施工|Gather / Build
分类|Category
动作|Animation
战术指挥官|Tactical Commander
电子干扰车|Signal Jammer
育生者|Nurturer
感染者|Infector
缚地兽|Binder
护盾织者|Shield Weaver
折跃引导者|Warp Guide
相位仲裁者|Phase Arbiter
路线工兵|Pathfinder
前沿观测员|Forward Observer
护航指挥车|Escort Vehicle
迅爪|Rushclaw
滴酸兽|Spitter
破壳巨兽|Behemoth
掠翅|Rakewing
供给囊体|Supply Sac
晶锋卫士|Crystal Lancer
棱镜炮|Prism Cannon
相位巨构|Phase Colossus
辉梭|Light Shuttle
线列步兵|Line Ranger
侧翼轻车|Flank Runner
护空车|Flak Carrier
巡航翼|Roaming Wing
补给站|Supply Depot
战地医务所|Field Infirmary
指挥所|Command Post
孵化巢|Hatchery
育生池|Nurture Pool
感染腺巢|Spore Gland
缚地巢|Binding Nest
能量节点|Energy Node
共鸣工坊|Resonance Works
折跃枢纽|Warp Hub
相位圣所|Phase Sanctum
装配站|Assembly Station
固定补给塔|Supply Mast
路线站|Route Post
观测所|Observatory
护航调度所|Escort Depot
核心支援单位。|Core support unit.
常规作战单位。|Standard combat unit.
种族生产、供给或科技设施。|Faction production, supply or research facility.
T2 支援分化|T2 Support Specialization
T3 高级干扰|T3 Advanced Disruption
在主指挥建筑研究，解锁第二阶段兵种与科技。|Research at your command center to unlock tier-two units and technologies.
在主指挥建筑研究，解锁高阶支援科技。|Research at your command center to unlock advanced support technologies.
战地治疗|Field Healing
自动治疗附近地面伤员，每次最多 10 生命。|Automatically heal nearby wounded ground allies for up to 10 HP per treatment.
应急净化|Emergency Cleanse
医疗协议|Medical Protocol
移除优先级最高的一组负面状态。|Remove the highest-priority group of negative effects.
集中火力|Focused Fire
范围内地面友军获得 +20% 普攻速度。|Ground allies in range gain 20% basic attack speed.
掩护烟幕|Covering Smoke
掩护战术|Cover Tactics
烟幕中的地面友军获得 20% 单体远程普攻减伤。|Ground allies in the smoke take 20% less damage from single-target ranged basic attacks.
弱点标定|Weakness Mark
标定敌方地面单位，目标承伤 +15%。|Mark an enemy ground unit to increase damage taken by 15%.
电磁封锁|Electromagnetic Lockdown
电磁协议|Electromagnetic Protocol
沉默范围内地面敌军 2 秒，并削减最多 40 原生护盾。|Silence ground enemies in range for 2 seconds and remove up to 40 native shield points.
再生注入|Regenerative Infusion
逐秒治疗地面友军，6 秒最多恢复 60 生命。|Heal a ground ally over 6 seconds for up to 60 HP.
代谢净化|Metabolic Cleanse
适应代谢|Adaptive Metabolism
移除最多两组负面状态。|Remove up to two groups of negative effects.
感染孢子|Infectious Spores
地面敌军每秒受 4 伤害，生命回复降低 40%。|Ground enemies take 4 damage per second and receive 40% less healing.
感染催化|Infection Catalyst
酸蚀进化|Corrosive Evolution
己队感染仍在时使目标承伤 +20%。|Increase damage taken by 20% while your team's infection remains active.
地脉缠绕|Root Bind
定身地面敌人 1.5 秒。|Root a ground enemy for 1.5 seconds.
黏液沼泽|Slime Marsh
沼泽腺体|Marsh Glands
地面敌军停留在区域时移速降低 35%。|Ground enemies in the area move 35% slower.
相位屏障|Phase Barrier
授予 60 点临时盾。|Grant 60 temporary shield points.
共鸣充能|Resonant Charge
共鸣技术|Resonance Technology
补充至多 45 点原生盾。|Restore up to 45 native shield points.
紧急折跃|Emergency Warp
将己方地面作战单位折跃至 200 距离内的可见空地。|Warp a friendly ground combat unit to visible open ground within 200 units.
相位净化|Phase Cleanse
相位稳定|Phase Stabilization
移除友军一组负面状态，支持空军。|Remove one group of negative effects from an ally, including aircraft.
相位力场|Phase Force Field
短时阻挡双方地面通行。|Briefly block ground movement for both sides.
解构脉冲|Disruption Pulse
解构研究|Disruption Research
驱散一组增益，并消除至多 25 个人能量。|Dispel one group of buffs and remove up to 25 personal energy.
路标引导|Route Guidance
区域内友方地面部队移速 +20%。|Friendly ground units in the area gain 20% movement speed.
清障指引|Clear Path
障碍识别|Obstacle Recognition
清除地面友军减速并免疫减速 2 秒。|Remove slows from a ground ally and grant slow immunity for 2 seconds.
前沿观测|Forward Observation
以落点为圆心向同队提供地面视野。|Reveal ground around the target point to your team.
信标拆解|Beacon Dismantling
区域识别|Area Recognition
提前结束敌方烟幕、沼泽、路标或观测。|End an enemy smoke, marsh, route marker or observation area early.
疏散警戒|Evacuation Guard
范围内地面友军获得 25% 范围伤害减免。|Ground allies in range take 25% less area damage.
火力压制|Suppressive Fire
护航干扰|Escort Disruption
使目标后续普攻频率降低 20%。|Reduce the target's basic attack rate by 20%.
攻速提升|Attack Speed Boost
路标提速|Route Speed Boost
减速|Slowed
易伤|Vulnerable
治疗抑制|Healing Reduction
感染|Infected
再生|Regeneration
定身抗性|Root Resistance
沉默抗性|Silence Resistance
减速免疫|Slow Immunity
定身|Rooted
沉默|Silenced
临时护盾|Temporary Shield
烟幕掩护|Smoke Cover
原生护盾|Native Shield
原生盾|Native shield
临时盾|Temporary shield
能量不足|Not enough energy
能量|Energy
冷却|Cooldown
自动治疗|Auto heal
正在施法|Casting
施法取消|Cast cancelled
施法被沉默打断|Cast interrupted by silence
施法失败 ·|Cast failed ·
施法|Cast
已释放|cast
技能与设施指令|Abilities and facility commands
目标不可用|Target unavailable
落点不可用|Destination unavailable
目标阵营不适用|Invalid target faction
没有可净化的负面状态|No negative effects to cleanse
目标生命值已满|Target is at full health
目标已有定身或定身抗性|Target is already rooted or resistant to roots
已有足量临时护盾|Target already has enough temporary shielding
目标没有受损原生护盾|Target's native shield is not damaged
目标没有可解除的减速|Target has no slow to remove
目标无普通攻击|Target has no basic attack
目标无法折跃|Target cannot warp
区域名额已满|Area limit reached
未知技能|Unknown ability
使用自动治疗开关|Use the auto-heal toggle
技能尚未解锁|Ability not unlocked
自身被沉默|Caster is silenced
技能冷却中|Ability is on cooldown
未选择可施法单位|No eligible caster selected
收拢装配站|Pack assembly station
移动装配站|Move assembly station
架设装配站|Deploy assembly station
选择装配站目标位置|Choose an assembly station destination
选择装配站移动目的地|Choose where to move the assembly station
选择装配站架设位置|Choose where to deploy the assembly station
收拢中|Packing
可迁移|Mobile
架设中|Deploying
失去覆盖 · 队列暂停|Outside coverage · Queue paused
失去覆盖 · 施工暂停|Outside coverage · Construction paused
自动构筑中|Constructing automatically
需要己方已完工装配站|Requires a completed friendly assembly station
装配站必须展开且队列为空才能收拢|Deploy the assembly station and empty its queue before packing
需要已收拢的装配站和有效落点|Requires a packed assembly station and a valid destination
装配站距离架设落点过远|Deployment point is too far from the assembly station
装配站无法抵达|Assembly station cannot reach the destination
装配站上限为 3 座|Assembly station limit: 3
换装装甲模块|Install armor module
换装支援模块|Install support module
换装中|Refitting
工厂正在换装或已装备该模块|Factory is refitting or already has this module
取消施工|Cancel construction
找不到可取消的施工|No construction to cancel
该种族无法建造或训练此项|This faction cannot build or train this
该种族无法研究此项|This faction cannot research this
需要 T2 支援分化|Requires T2 Support Specialization
需要对应科技|Requires the corresponding technology
需要能量节点覆盖|Requires energy node coverage
需要可用的|Requires an available
生产设施|production facility
没有可用的生产建筑|No available production facility
需要至少两个有效队伍|Requires at least two valid teams
出兵通道不可用|Unit exit is unavailable
此战局使用传统规则|This match uses classic rules
人口容量不足（|Not enough population capacity (
供给囊体已达 16 个|Supply sac limit: 16
请选择可见的敌方区域|Select a visible enemy area
选择要拆解的区域|Select an area to dismantle
请选择可用的单位目标|Select an eligible unit target
选择可见的折跃落点 · × / Esc 取消|Choose a visible warp destination · × / Esc to cancel
经济与生产|Economy and production
主指挥建筑与|Your command center and
分别处理种族队列。供给来源为|handle faction queues separately. Supply comes from
在主指挥建筑研究升级，建造种族科技设施，再研究对应技能。|Upgrade your command center, build faction research facilities, then research their abilities.
继续升级后可研究高阶技能或招募后期单位。|Further upgrades unlock advanced abilities and late-game units.
科技路线|Technology tree
提升突击步兵与幽影狙击手的普通攻击。|Improve basic attacks for Riflemen and Ghost Snipers.
提升工业装甲车辆的生命值。|Increase industrial armored vehicle health.
金矿和木材驱动早期建设，石油支撑机械化。生产建筑决定兵种，研究中心决定技术。所有前置建筑必须建造完成。|Gold and wood fund early construction; oil supports mechanization. Production facilities determine your units, and research labs determine your technologies. All prerequisite structures must be complete.
建立补给|Establish supplies
基础军事|Basic military
机械化|Mechanization
先进科技|Advanced technology
支援升级|Support upgrades
人口容量|Population capacity
预留|Reserved
已交付|Delivered
辆建造中|constructing
辆金矿枯竭待指派|waiting for a new gold assignment
辆|units
你的种族|Your faction
AI 种族|AI faction
种族|Faction
建筑|Structures
均衡|Balanced
静音|Muted
简体中文|Simplified Chinese
游戏加载失败，请刷新页面重试。|Could not load the game. Reload the page to try again.
正在加载游戏…|Loading game…
油井 · 施工与抽油动画|Oil Well · Construction and pumping animation
施工|Construction
解锁|Unlock
未知战场或地形版本|Unknown battlefield or terrain revision
连接已关闭|Connection closed
联机战役正在进行。|A multiplayer battle is in progress.
离开后将由 AI 接管你的部队。|AI will take control of your units when you leave.
无效控制消息|Invalid control message
无效快照消息|Invalid snapshot message
未知对战模式|Unknown battle mode
只能在战役开始前选择有效种族|Choose a valid faction before the battle starts
加入房间超时|Joining the room timed out
Metered 浏览器公钥未配置|Metered browser publishable key is not configured
请使用支持 WebRTC 和压缩流的新版浏览器|Use a recent browser with WebRTC and compression stream support
指令超过大小限制|Command exceeds the size limit
连接失败|Connection failed
主动离开|Left voluntarily
房主已离开|Host left
信令连接已关闭|Signaling connection closed
连接异常：|Connection error:
连接超时，请检查 Metered 权限与网络|Connection timed out. Check Metered permissions and your network.
房主标识未分配|Host identifier has not been assigned
模拟已停止|Simulation stopped
房主不可达|Host is unreachable
房主连接中断|Host connection interrupted
P2P 连接需要 Pages 构建|P2P connections require a Pages build
战场快照超过大小限制|Battlefield snapshot exceeds the size limit
战场快照无效|Invalid battlefield snapshot
快照片段无效|Invalid snapshot chunk
建房请求过多，请稍后重试|Too many room requests. Try again later.
取消目标选择|Cancel target selection
取消|Cancel
保留选中兵种|Keep selected unit type
`.trim().split('\n').map(line=>line.split('|')));
