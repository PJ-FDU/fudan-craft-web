# 四族模型精修与独立纹理

参考是 `public/assets/generated/model-portraits-v2.webp` 的 78 个单位与建筑图标。战场和模型图鉴使用同一套 `public/assets/blender-sculpt-v2/` 资产。

工程采集车已经进入专用单车精修：斜面驾驶舱、四轮胎纹、轮毂、双液压臂、伸缩导轨和独立 2K PBR。战场材质结合生图样本、同源 PBR 磨损遮罩、螺栓锈流和低位积泥，并加入局部实体凹陷，见 [工程采集车精修与重建](WORKER_HERO.md) 与 [做旧前后对照](../artifacts/worker-hero/battlewear-comparison.png)。幽影狙击手也由独立工程接管，补出布料与装备结构、精密步枪及双手握持，见 [狙击手精修](SNIPER_HERO.md)。其它 76 个模型继续使用下述通用流程。

这轮在 Blender 中按源码的语义部件建立高模与低模，重新制作每个模型的 UV，并实际执行高低模切线法线、AO、颜色、粗糙度和金属度投射。高模采用解析形变、曲面细化和材质微雕刻，不是人工逐笔雕刻；通用模型的颜色来自按部件定义的专属程序材质，专用工程采集车另加入生图表面样本。它是一轮可继续编辑的美术精修，不能据此宣称已经达到《星际争霸 2》的商业制作水准。

## 造型与材质

| 阵营 | 造型调整 | 表面制作 |
| --- | --- | --- |
| 工业联邦 | 更饱满的装甲上沿、实体倒角、宽装甲安装铆钉、泰坦胸甲格栅与螺栓、医护兵封闭头盔 | 蓝灰涂层、装甲刻线、边缘局部掉漆、独立医疗标记 |
| 生群 | 四边形甲壳曲面、背脊、成长沟槽、翘起边缘、弯曲角质、肌肉肢节 | 棕色角质、红色组织、琥珀囊体、分叉裂纹及角质纹理 |
| 星能 | 倒角护甲、细化结构、保留水晶棱面与镂空环 | 深青蓝陶瓷、蓝色合金、黄铜镶边、青蓝能量 |
| 远行者 | 衣物腰身、圆形肢体截面、实体褶皱、巡线步兵围领和外套下摆、肩甲、手套指节、收窄鞋楦，保留装配站两种形态 | 沙色涂层、帆布织纹、炭灰框架、橄榄色标记 |

`[FORM-BEFORE-DETAIL]` 有蒙皮的人体布料部件使用闭合环形截面，低模和高模共享腰身、肢体体积与主要褶皱，高模再补细褶。巡线步兵的外套下摆绑定 hips，围领绑定 head，肩甲、手套和鞋面分别绑定已有的手臂、手掌与足部关节。靴子沿脚尖收窄，后侧鞋帮升高。细节必须有正确的轮廓和骨骼归属，不能只靠增加面数与噪声。

`[UV-UNIQUE]` 每个模型拥有自己的 UV 区域。四族分别合并为纹理页，以减少材质切换；没有让不同模型共用同一块表面 UV。通用模型默认占 512 × 512 像素，UV 岛留边并烘焙 2px padding。工程采集车独占 2048² 纹理页，使用 8px padding，具体参数见专项说明。

`[BAKE-SEPARATION]` 颜色、切线法线、粗糙度与金属度烘焙时，部件沿 X 轴临时分离 400 单位，避免相邻装甲互相投射。投射 cage 按最大部件尺寸的 7.5% 扩展，最少 1 单位；最大射线距离为 cage 的两倍加 2。AO 在还原后的完整装配模型上按最近高模表面烘焙。导出前恢复安装位置。

`[PROJECTION-COVERAGE]` 先对低模自烘焙白色 UV 遮罩，再检查有效区域的高模投射。零颜色、零粗糙度、非法法线和朝向低模内部的法线均计为缺损；每模型至少 95% 的有效 UV 像素必须直接来自高模，否则构建终止。其余像素显式用同部件低模的真实材质、微表面法线与 AO 修复，并补齐 padding；极小退化尖端使用几何法线。逐模型记录保留原始缺损、低模回退与几何法线回退像素数。多采样平均造成的法线长度缩短不视为投射失败。

`[PBR-DIRECT]` 新模型直接读取独立颜色、法线和 ORM 纹理。ORM 的 R/G/B 分别是实际烘焙 AO、粗糙度、金属度。模型不再叠乘旧颜色图集、旧顶点底色或旧做旧条纹。阵营色面仍由游戏染色，灯光仍由阵营材质控制。

`[LOW-RUNTIME]` 只有低模进入 GLB。高模留在 `.blend` 工程中。低模仍按实体、阵营色与灯光合批；安装铆钉没有各自的运行时 Mesh。

`[RIG-SOURCE]` 骨骼名称、顺序、父子关系、静止位置、蒙皮绑定及活动部件安装点来自当前源码。Blender 工程保留可编辑骨架与顶点组；运行时对完整骨骼契约进行校验。

## 文件与重建

| 内容 | 路径 |
| --- | --- |
| 高模、UV 低模、打包纹理、编辑骨架 | `artifacts/blender-sculpt/{industrial,brood,stellar,relay}.blend` |
| 专用工程采集车工程 | `artifacts/worker-hero/engineering-worker.blend` |
| 游戏资产与材质清单 | `public/assets/blender-sculpt-v2/` |
| 每模型高低模面数与烘焙方式 | `artifacts/blender-sculpt/*-bake.json` |
| 实际 GLB、姿态与纹理检查 | `artifacts/blender-sculpt/verification.json` |
| 全阵容渲染模型列表、版本与采样参数 | `artifacts/blender-sculpt/render-report.json` |
| 原始语义部件与顶点范围 | `src/game/model-parts.ts` → `scripts/export-blender-source.ts` |
| 建模、UV、投射与导出 | `scripts/build-sculpt-assets.py` |
| 显式 Blender 调用 | `scripts/build-sculpt-assets.mjs` |
| 加载与直接 PBR 材质 | `src/game/blender-assets.ts`、`model-surface.ts`、`models-3d.ts` |

```sh
npm run assets:sculpt
# 只重建一个阵营；其余已验证资产和骨骼契约从现有清单保留
npm run assets:sculpt -- --only industrial
# 有 Metal GPU 的 Mac 可显式选择 GPU；无可用设备时会终止
npm run assets:sculpt -- --only relay --device METAL
npm run check:blender -- artifacts/blender-sculpt/verification.json
npm run build
```

`[VERIFY-EXPORTED]` `check:blender` 直接读取导出的 GLB，检查全部模型及活动部件、顶点合法性、骨骼契约、六类动作姿态和实际 UV。每个模型的 UV 必须落在自身的纹理图块内，烘焙记录中的图块不得重复；投射记录必须满足 95% 覆盖下限，回退数必须与原始缺损数对应。清单同时报告运行时三角形、高低模面数、最差模型回退比例及纹理显存估算。清单的 `generators` 逐包追踪脚本来源，烘焙记录 SHA-256 必须与其对应的当前生成脚本一致。

`[REBUILD-OVERWRITE]` 重建以源码和脚本为准，会覆盖本轮生成的四个 `.blend` 和游戏资产。人工编辑前应另存工程。旧的 `assets:blender -- --from-blend` 只适用于 `blender-v1`，不能用于新雕刻工程；当前没有把人工修改的高模自动重烘焙回游戏的命令。

打开 `.blend` 后，每个 `Model <阵营>:<对象>` 根节点对应一个完整模型。`Sculpt high …` 是默认隐藏的高模，`Rig …` 是有骨骼单位的编辑骨架；根节点或骨架下的 `<模型>|<活动部件>|<材质槽>` 是已烘焙低模，材质槽 0/1/2 分别对应实体、玩家颜色和灯光。高模显示前可先隐藏同一模型的低模，避免两套表面重叠。纹理已打包进工程。

单模型试作不会覆盖正式游戏库，可显式提高纹理分辨率：

```sh
npm run assets:sculpt -- --only-key industrial:mech --tile-size 1024
```

试作 GLB 和贴图输出到 `artifacts/sculpt-test/`，工程名与烘焙记录带 `-test` 后缀。正式通用库使用默认 512px 图块，专用工程采集车与狙击手使用 2K。通用流程默认使用 CPU，`--device METAL` 显式启用 Mac GPU；两个专用命令默认 Metal，可显式传 CPU。自然环境沿用 `blender-v1/nature.glb` 和原环境材质图集。正式全库/分族命令结束后会重建两个专用模型。

## 预览与限制

Blender 渲染预览：[泰坦](../artifacts/blender-sculpt/industrial-mech.png) · [巨兽](../artifacts/blender-sculpt/brood-behemoth.png) · [星能巨像](../artifacts/blender-sculpt/stellar-colossus.png) · [远行者步兵](../artifacts/blender-sculpt/relay-ranger.png)。这些图由实际低模和烘焙纹理渲染，使用独立预览灯光；实际游戏效果应以图鉴和对局截图为准。

2026-11-23 当前验证使用通用生成脚本 SHA-256 `1e501668fc82b62df08b1c0b7f02bc2279aecfd9fcb2afb3b2a531a5d7e598f5`、专用车 SHA-256 `8e9e08e10794750a40a3e5f3ee6e17def8aed4f8ec948dbc2d42c0956d1e3e46` 和狙击手 SHA-256 `d2a955fc71b9d63af19a36a358f20446e0616e6276ac2d3ff0d89959e0b520a0`，完整数据见 [最新资产校验报告](../artifacts/sniper-hero/verification.json)。专用车还会逐项校验两张生图源文件的 SHA-256。

| 验证项 | 当前结果 |
| --- | --- |
| 完整阵容 / 独立 UV 图块 | 78 / 78 |
| 雕刻高模面数 / UV 低模面数 | 5,680,871 / 1,196,696 |
| 导出库网格 / 顶点 / 三角形，含沿用自然环境 | 242 / 1,760,849 / 2,255,379 |
| 骨骼契约 / 动作姿态 | 68 / 1,224 |
| 已检查实际 UV 的顶点 | 1,732,349 |
| 高模直接投射的有效 UV 覆盖率，按像素加权 | 99.27% |
| 最差模型高模直接投射覆盖率 | 生群地穴 `brood:burrow`：95.12% |
| 低模表面修复 / 几何法线回退像素 | 136,937 / 965 |
| 全部 21 张纹理上传的 RGBA8 + mip 显存估算 | 528 MiB |

库的三角形数按每个模型各一份统计，不是实际对局每帧的三角形数。528 MiB 只包含所列纹理，不含实例、阴影、环境光和后处理缓冲；未使用阵营的纹理可能尚未上传，但初次加载仍请求整个模型库。

本轮 `check:blender`、生产游戏构建、静态版构建及 Pages 发布检查均通过。Pages 检查记录 930 份公共素材、304.8 MiB，并验证子路径与 WebRTC Worker；两个构建目录中的狙击手素材逐项匹配当前源素材 SHA-256。181 项现有测试通过，完整库完成 1,224 个姿态检查，狙击手另检查 216 组双手握持、左掌方向与瞄准眼位，以及披风混合权重、独立位移和停用动画时的确定性。临时运行日志位于 `/tmp/fudancraft-sniper-*`，最终资产报告与预览保存在工作区。

实际图鉴截图：[工业泰坦](../artifacts/blender-sculpt/game-gallery-industrial.png) · [生群巨兽](../artifacts/blender-sculpt/game-gallery-brood.png) · [星能巨构](../artifacts/blender-sculpt/game-gallery-stellar.png) · [远行者步兵](../artifacts/blender-sculpt/game-gallery-relay.png) · [赤红攻击姿态](../artifacts/blender-sculpt/game-gallery-relay-attack.png) · [基地](../artifacts/blender-sculpt/game-gallery-base.png) · [装配站展开](../artifacts/blender-sculpt/game-gallery-assembly-unpacked.png) · [装配站收拢](../artifacts/blender-sculpt/game-gallery-assembly-packed.png)。

浏览器验证了染色、模型切换及攻击逐帧播放：暂停时动画时间由 0.083 增加至 0.167 秒，约推进 1/12 秒，保持 `attack` 和玩家颜色 2。新增衣物、手套和靴子在这次姿态下保持绑定。八张图鉴截图均保存为实际 1440 × 1100 PNG，步骤与无 JavaScript 错误的检查结果见 `artifacts/blender-sculpt/browser-gallery-final.log`。

[实际对局截图](../artifacts/blender-sculpt/game-battle.png)来自独立桌面浏览器，尺寸 1440 × 1100；战场使用 `battle-3d` 画布，加载四族 GLB 与 12 张新 PBR 纹理，无 JavaScript 错误。完整步骤和资源列表见 `artifacts/blender-sculpt/browser-battle-final.log`。图鉴截图使用游戏同一套模型和材质，未用离线渲染代替对局画面。

按原图顺序渲染全部 78 个模型，并生成 [全阵容预览](../artifacts/blender-sculpt/model-library.webp) 和 [参考对照](../artifacts/blender-sculpt/reference-comparison.png)：

```sh
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --threads 4 --python-exit-code 1 \
  --python scripts/render-sculpt-library.py -- --project "$PWD" --device METAL
python3 scripts/pack-sculpt-library.py
python3 scripts/compare-sculpt-reference.py
```

`[PREVIEW-CURRENT]` 全阵容渲染先校验资产和逐族烘焙记录的生成脚本版本，移除工程中遗留的预览灯光和相机，再用统一的 448px、16 采样布光渲染。全部模型完成后才写入渲染记录；合图与参考对照要求记录中的模型顺序和版本匹配当前游戏资产。

最新全阵容预览已经包含专用工程采集车与狙击手。渲染按清单的现役工程选择模型；合图同时验证每个包的生成器版本。实际动作与光追截图见 [工程车](WORKER_HERO.md) 和 [狙击手](SNIPER_HERO.md)，上文其它单位的浏览器截图沿用上一轮。

与指定参考图相比，当前人物比例、装备层次、甲壳与肌肉结构仍有明显差距，通用模型的表面也缺少逐模型绘制的标识和磨损。工程采集车已经加入生图辅助的战场磨损，但还不能等同于宣传片级美术。当前仍沿用代码动画，没有重新制作完整的专业动作集；玻璃和能量囊仍使用不透明 PBR 表面。尚未增加 LOD 或按阵营延迟加载。高模细节、纹理分辨率和全阵容质量都需要用实际镜头距离和帧率来验收，多边形数量本身不代表品质。
