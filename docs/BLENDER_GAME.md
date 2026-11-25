# Blender 3D 战场

**当前模型库已升级：** 四族单位与建筑现在使用高低模投射、独立 UV 和专属 PBR 纹理，见 [四族模型精修](BLENDER_SCULPT.md)。下文记录首轮 `blender-v1` 基础工程与自然环境；其中全库面数、截图和材质描述属于升级前版本。`assets:blender -- --from-blend` 继续只操作旧工程。

本轮把游戏战场接入实际 Blender 资产库。单位、建筑、树木、草灌、矿床、树桩和油井底座从 GLB 加载；地表、水面、弹道、投影和战争迷雾由 Three.js 的 3D 场景绘制。HUD、血条、操作标记、小地图和历史动画图鉴保留二维信息展示。

**美术状态：尚未达到《星际争霸 2》的商业 AAA 建模水准。** 四族模型结构沿用项目已有的程序化模型，在 Blender 中建立可编辑网格、材质和蒙皮，并导出到实际游戏。树木新增 Blender 原生分叉、根系和折叶。PBR 图集来自 Cycles 程序材质烘焙；这不是全阵容高模雕刻、专属手绘贴图和完整动画制作的替代品。当前产物可作为继续精修的工程基础。

## 交付与源码锚点

| 内容 | 当前文件 |
| --- | --- |
| 可编辑模型 | `artifacts/blender-game/{industrial,brood,stellar,relay,nature}.blend` |
| 56 类材质与烘焙图集 | `artifacts/blender-game/materials.blend` |
| 游戏实际使用的资产 | `public/assets/blender-v1/`，五个 GLB、三张 PNG、一个清单 |
| 原始结构、材质和动画定义 | `src/game/*-models.ts`、`model-parts.ts`、`unit-rig.ts`、`model-surface.ts` |
| 导出源码几何 | `scripts/export-blender-source.ts` |
| Blender 建模、烘焙、编辑工程及导回 | `scripts/build-blender-assets.py` |
| 显式调用 Blender | `scripts/build-blender-assets.mjs` |
| 加载、属性还原及骨骼契约校验 | `src/game/blender-assets.ts` |
| 战场与图鉴共用实例化 | `src/game/models-3d.ts`、`model-gallery.ts`、`battle-scene.ts` |
| 地形与水面几何 | `src/game/battle-terrain.ts` |
| 实际 GLB 检查工具 | `scripts/check-blender-assets.ts` |

`[SSOT-SOURCE]` 默认重建以当前源码为准，重新生成 `.blend` 与游戏资产。这个命令会覆盖本轮生成的工程；人工精修应先保存副本，使用显式的 `--from-blend` 导回路径。

`[SSOT-EDIT]` 从 `.blend` 导回时，网格与顶点权重以编辑工程为准。骨骼名称、顺序、父子关系、静止关节位置和活动部件安装点仍由代码定义。结构性骨骼修改须同时更新源码契约。

`[SSOT-RUNTIME]` 浏览器战场与模型图鉴必须使用同一份 Blender 资产；资源缺失、非法顶点、属性格式错误或骨骼契约不匹配在加载阶段报错。程序化模型编译路径仅供源码构建和现有 Node 检查使用。

## 重建与编辑

要求 Node.js 22+、项目依赖，以及带 Meshopt 导出器的 Blender。本机已用 Blender 5.3.0 完成构建。以下命令重建旧基础库；当前 `check:blender` 验证的是 `blender-sculpt-v2`，完整重建与检查命令见 [四族模型精修](BLENDER_SCULPT.md)。

```sh
npm run assets:blender
npm run build
```

Blender 默认路径为 `/Applications/Blender.app/Contents/MacOS/Blender`，其他安装路径可显式设置 `BLENDER_BIN`。构建使用 `--factory-startup`，不依赖个人启动文件与插件。

在 Blender 打开对应 `.blend`，编辑模型网格，或使用 Weight Paint 编辑已有骨骼权重，然后保存：

```sh
# 导回全部五个模型工程，不覆盖 .blend，不重新烘焙材质图集
npm run assets:blender -- --from-blend

# 只导回一个阵营
npm run assets:blender -- --from-blend --only industrial

```

`--only` 允许 `industrial / brood / stellar / relay / nature`。工程按模型分组摆放；导回会移除预览摆放与骨架修饰器，导出静止源网格，再由游戏建立独立骨架。每顶点最多四个非零骨骼影响，导出前归一化。改变网格旋转或缩放后须先 Apply；新增顶点须保留对应材质属性和有效权重。

`[EDIT-METADATA]` 保留每个网格的 `key / part / slot` 自定义属性。`part=-1` 为主体，其他值是活动部件索引；`slot=0/1/2` 为实体、阵营色和灯光。雕刻或增删拓扑后必须检查 UV 与顶点属性；本轮没有自动生成新的语义 UV 或做旧属性。

`[EDIT-MATERIALS]` `.blend` 内置顶点色、材质参数、打包的颜色/法线图及阵营预览色。编辑预览没有复刻浏览器的全部做旧、战争迷雾和原画图集混合。游戏中的做旧与标识仍由 `model-surface.ts`、`model-weathering.ts` 和现有图集共同控制；直接改 Blender 预览材质不会改写游戏材质代码。

## 几何与渲染规则

- `[AXIS]` 源码坐标为 Three.js Y-up；Blender 工程转换为 `(x,-z,y)`。glTF 导出恢复 Y-up，加载时恢复原图集的 V 方向。
- `[SKIN]` GLB 保留自定义 `_skinIndex / _skinWeight`，加载器还原整数索引。清单保存完整有序关节定义，避免“关节数量相同但顺序不同”的错绑。
- `[BATCH]` 单位继续按实体、阵营色、灯光合批，不为螺栓、履带片或每片叶子创建独立运行时对象。模型实例拥有各自骨架。
- `[GROUND]` 行走地面保持 Y=0；水下盆地降低，封闭障碍内部允许起伏。地面细分最多 320 段；单位碰撞、建筑占地和寻路继续使用现有地图规则。
- `[WATER]` 凹岸线通过统一三角化与细分生成网格；岸距控制浪高和泡沫，法线波纹参与环境反射与主光照。岸边直接使用地表，避免覆盖网格与起伏地面相交。粗糙度为 0.36、环境反射强度为 0.8，微波纹使用非周期噪声。没有逐帧镜面反射相机或完整流体模拟。
- `[TEXTURE]` Cycles 烘焙 14×4 格、每格 256px 的颜色、切线法线和 ORM 图集，总尺寸 3584×1024。ORM 的 R 为固定环境遮蔽 1，G 为粗糙度，B 为金属度；当前游戏读取 G，金属度仍以源材质参数为准。
- `[WEBGL]` WebGL 2 为硬性要求。不可用时显示启动错误；上下文丢失时显示恢复提示并等待浏览器恢复。战场不再切换为二维模型绘制。

## 验证与预算

[GLB 检查报告](../artifacts/blender-game/verification.json)记录实际库中的模型数量、几何量、文件大小及动画姿态检查。几何统计覆盖全库，不等于单帧可见几何。

本轮检查覆盖 78 个模型变体、243 个材质网格、1,893,300 个解码顶点、631,100 个三角形。68 个带骨架模型覆盖待机、移动、攻击、采集、施工、倒地六种状态的三个相位，共 1,224 个姿态；另逐模型验证非法关节名称被拒绝。矿床、树林、油井底座与耗尽形态均经实际资产实例化检查。

五包 GLB 与三张 PNG 总体积约 69 MiB。冷启动进入战场会加载整库；尚未实现按阵营延迟加载或多级 LOD，因此大军团及低性能设备仍需单独测量。已有自动性能模式可以调整分辨率、阴影与间接光照。旧版 GPU 测量不可作为此次 Blender 资产的帧率证据。

2026-11-23 最终验证：

- `npm run assets:blender`：六个 `.blend` 工程与实际资产构建成功。
- `npm run assets:blender -- --from-blend`：五个编辑工程导回成功，随后 GLB 检查全部通过。
- `npm test`：181/181 通过，82.3 秒。
- `npm run build`、`npm run build:pages`：TypeScript、服务器及静态产物构建通过。仍有既有大型 JavaScript 分块提示。
- `node scripts/check-pages-build.mjs`：905 份公共素材原样进入 Pages 产物，总体积 161.6 MiB，子路径与 WebRTC Worker 检查通过。
- 实际图鉴检查四族、攻击动作、阵营色和装配站两种形态；实际双湖对局检查采集车交回资源、精炼厂放置与建造。浏览器错误记录为空，控制台仅有开发服务器连接信息。
- 八张当前版本地图检查地形有限顶点、水面三角形朝向与三角形总面积对应完整凹岸线；详细统计在检查报告的 `terrainChecks`。

实机截图：[双湖基地](../artifacts/blender-game/twin-lakes-base.png) · [湖岸水面](../artifacts/blender-game/twin-lakes-water.png) · [建造预览](../artifacts/blender-game/construction-preview.png) · [联邦泰坦](../artifacts/blender-game/industrial-titan.png) · [生群单位](../artifacts/blender-game/brood-unit.png) · [生群建筑](../artifacts/blender-game/brood-base.png) · [星能单位](../artifacts/blender-game/stellar-unit.png) · [攻击与赤红阵营色](../artifacts/blender-game/stellar-attack-red.png) · [远行者单位](../artifacts/blender-game/relay-unit.png) · [装配站展开](../artifacts/blender-game/relay-assembly.png) · [收拢](../artifacts/blender-game/relay-assembly-packed.png)。

截图从实际游戏 UI 获取，不代表与《星际争霸 2》同条件对比。没有把历史测量或浏览器动画回调频率当作当前游戏的 GPU 性能数据。

## 品质目标仍需完成的美术工作

达到目标仍需要每族统一的专业造型审定、重点单位与建筑的高模雕刻、独立 UV/纹理制作、高低模法线和 AO 烘焙、动作与特效精修、地图关卡美术，以及面向大军团的 LOD 和性能验收。本轮没有使用或复制《星际争霸 2》的模型与贴图，也没有以增加多边形数量宣称达到同等美术品质。
