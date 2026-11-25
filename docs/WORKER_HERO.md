# 工业联邦 · 工程采集车精修

工程采集车现在使用单独的 Blender 高低模工程和 2048px PBR 纹理。游戏图鉴和实际对局加载同一份 `worker.glb`。参考是 `public/assets/generated/model-portraits-v2.webp` 的第一个图块。

[做旧前后对照](../artifacts/worker-hero/battlewear-comparison.png) · [参考与本轮低模对照](../artifacts/worker-hero/reference-comparison.png) · [实际图鉴](../artifacts/worker-hero/game-worker-idle.png) · [采集姿态](../artifacts/worker-hero/game-worker-gather.png) · [实际对局](../artifacts/worker-hero/game-battle.png)

新增 [光栅／电影光追实际对照](../artifacts/worker-hero/cinematic-comparison.png) · [六次反弹光追](../artifacts/worker-hero/cinematic-pathtrace.png) · [当前战场](../artifacts/worker-hero/cinematic-battle-high.png)。首页 → 战术档案 → 种族模型图鉴，勾选「电影光追」；运动中保留光栅画面，暂停动作与镜头后，等待完整 256 次采样和静态降噪完成才显示高清光追。本轮沿用相同模型和做旧纹理，通过 HDR 环境、面积光、软阴影与真实 BVH 路径追踪提升近景光照；战场使用最终贴图法线、实际 albedo／金属度驱动的屏幕空间反弹和反射。[实现、预算与边界](3D_RENDERING.md#图鉴电影光追)。

## 造型与表面

本轮重新制作斜面驾驶舱、四边风挡框、侧窗、轮胎截面、交错胎纹、胎肩、轮毂、弧形挡泥板、双液压臂、油缸、软管、导轨和采集钳。前车体降低，为机械机构留出可见空间。后部补上压力罐、冷却鳍片、检修百叶、拖车环及尾灯。

屋顶警示条纹、车号、检修盖、安装螺栓、脚踏和雨刷具有明确安装位置。涂层、裸金属、橡胶和玻璃各自使用独立的材质参数。新加入生图表面样本、下部积泥、螺栓锈蚀、碰撞掉漆和实体凹陷；微表面通过真实法线投射进入游戏。

`[WORKER-WEATHER-SOURCE]` 生图样本是 `artifacts/worker-hero/weathered-paint-source.jpg`（磨损灰色涂层）和 `battle-grime-source.jpg`（泥尘与油污）。构建裁去下方 12% 的服务标记区域，提取 1536² 的共用遮罩并打包到 Blender 工程。源图 SHA-256 写入烘焙记录；发布和资产校验会重新验证源图，改图后必须重新烘焙。

`[WORKER-WEATHER-PBR]` 生成图先提取露铁、氧化、表面污渍及泥尘遮罩，按 24 游戏世界单位的尺度做三平面投影。相同信号驱动颜色、粗糙度、金属度和受控微凹凸：露铁提高金属度，锈迹与干泥降低金属度并提高粗糙度，油污降低粗糙度。玩家色、警示条纹和各材质底色保留自身定义，不直接整车贴一张生图。高低模分离烘焙时仍使用原安装坐标，泥污不会随临时位移跑到车顶。

`[WORKER-DAMAGE]` 右前挡泥板、右采集臂和右侧装备舱有局部实体凹陷，高低模共享碰撞点和变形方向；各碰撞点的标称深度为挡泥板 0.60、臂侧面 0.32、臂顶面 0.20、侧舱 0.28 游戏世界单位，按椭球距离衰减并叠加。防撞框另有局部折弯。磨损在碰撞位置加强，螺栓与检修盖下方加入短锈流，轮胎和底盘积泥多于驾驶舱。生成图亮暗只用于细小表面变化，不当作真实深度或直接生成大幅位移。

`[WORKER-SOURCE]` 专用造型和材质参数的事实来源是 `scripts/build-worker-hero.py`。骨骼名称、顺序、父子关系和安装位置从 `scripts/export-blender-source.ts` 导出；不在 Blender 中另造一套游戏骨架。

`[WORKER-RIG]` 四个轮组分别使用 `LWheel0/1`、`RWheel0/1`；驾驶舱和固定车体归属 `body`；液压臂和导轨归属 `boom`；伸缩滑块和采集横梁归属 `tool`；两只钳爪归属 `LGrip/RGrip`。骨骼的刚性权重均为 1。

`[WORKER-REACH]` `src/game/unit-rig.ts` 的 `workerToolReach = 18.4` 和 `workerWheelHeight = 8.2` 同时供源码建模和动画使用。`boom` 静止原点为 `(0, 20.4, 7)`，`tool` 静止原点为 `(0, 18.4, 25.4)`。施工时采集头沿导轨增加 `0.7 + (wave + 0.17) × 5` 的前伸行程，配合臂和钳爪转动，给固定防撞框留出空间。轮胎围绕源码轮轴加厚，舱顶降低，地面接触位置随轮轴同步修正。单位是游戏世界坐标，不代表真实毫米。

`[WORKER-UV]` 本车独占 2048 × 2048 纹理，使用凹形轮廓重新排列 UV 岛，岛间距为纹理边长的 0.0015，烘焙 padding 为 8px。有效 UV 像素占整张纹理约 55.11%；UV 覆盖率和高模投射覆盖率是两个不同指标。

`[WORKER-BAKE]` 251 个结构组分别沿 X 分离 150 单位后烘焙颜色、切线法线、粗糙度和金属度，避免不同安装件相互投射。射线参数记录为 extrusion 0.7、最大距离 1.8，不使用自定义 cage。AO 在恢复装配位置后烘焙。超过 5% 的有效像素投射缺损会终止构建；允许范围内的像素显式自投射低模材质修复，记录原始缺损和中性法线回退数。

`[WORKER-PBR]` ORM 的 R/G/B 分别是 AO、粗糙度和金属度。运行时直接使用烘焙材质；三个合批网格分别对应实体、玩家染色和灯光。游戏玩家颜色和工业联邦灯光继续由游戏控制。离线预览采用工作室面积光，风挡反射会比游戏天空环境更亮，应以图鉴截图判断实际游戏效果。

## 当前验证

下表来自 [本车烘焙记录](../artifacts/worker-hero/worker-bake.json) 和 [完整资产校验](../artifacts/worker-hero/verification.json)。

| 项目 | 结果 |
| --- | --- |
| 高模 / UV 低模面数，未统一三角化 | 301,010 / 35,452 |
| 导出游戏三角形 / 顶点 | 66,268 / 66,419 |
| 游戏网格 / 骨骼 | 3 / 10 |
| 独立颜色、法线、ORM 纹理 | 3 × 2048² |
| 有效 UV 像素 | 2,311,439 |
| 高模直接投射覆盖率 | 97.344% |
| 低模表面修复 / 中性法线像素 | 61,398 / 39 |
| Meshopt GLB 大小 | 1,171,660 bytes |
| 本车三张纹理 RGBA8 + mip 显存估算 | 64 MiB |
| 完整库骨骼契约 / 动作姿态检查 | 68 / 1,224 |
| 现有测试，光追渲染更新后 | 181 通过；未修改游戏动作代码 |

构建来源 SHA-256：`8e9e08e10794750a40a3e5f3ee6e17def8aed4f8ec948dbc2d42c0956d1e3e46`。两张生图源文件的 SHA-256 另见烘焙记录中的 `textureSources`。

浏览器实际检查了待机、轮组移动、采集逐帧和赤红染色，并进入工业联邦对局，确认请求了本车 GLB 与三张纹理，无 JavaScript 错误。当前截图与最终资产报告保存在 `artifacts/worker-hero/`。生产构建、静态构建及 Pages 检查通过；加入电影光追后的静态版共 926 份公共素材、293.4 MiB。另对 `dist` 和 `dist-pages` 的本车 GLB、三张纹理与清单逐项验证 SHA-256，均与当前公共素材一致。

本轮运行日志在 `/tmp/fudancraft-worker-weather-{build,verify,browser,build-game,build-pages,check-pages,library-render}.log`。上一轮 181 项现有测试结果保留在 `artifacts/blender-sculpt/worker-tests.log`；本轮通过完整资产及 1,224 个动作姿态检查验证美术和蒙皮变更。

光追更新的完整资产检查另见 [cinematic-assets-verification.json](../artifacts/worker-hero/cinematic-assets-verification.json)，初版 GPU／交互检查见 [cinematic-render-verification.json](../artifacts/worker-hero/cinematic-render-verification.json)。工程车生成器 SHA-256 和其余 77 个模型的生成来源保持原值。早期动态空间降噪的[截图](../artifacts/worker-hero/dynamic-noise-comparison.png)与[报告](../artifacts/worker-hero/dynamic-noise-verification.json)作为历史记录保留。当前改为运动光栅、静态高清光追，不再对运动画面运行路径采样或时序滤波；静态目标为全分辨率 256 次采样，完成后执行小半径材质引导降噪。玻璃仍为不透明反射材质，不能把新增渲染直接等同于完整商业宣传片。

## 编辑与重建

打开 [engineering-worker.blend](../artifacts/worker-hero/engineering-worker.blend)。集合 `01 · GAME LOW / rigid skin` 保存三个游戏网格，集合 `02 · HIGH / machined edges` 保存默认隐藏的高模。低模具有可编辑骨架、顶点组和打包纹理。高模是程序生成的专用硬表面模型，没有宣称为人工逐笔雕刻。

```sh
npm run assets:worker
# 无 Metal 设备时显式使用 CPU
npm run assets:worker -- --device CPU
npm run check:blender -- artifacts/worker-hero/verification.json
python3 scripts/compare-worker-hero.py
npm run build
```

只检查造型、不发布游戏资产：

```sh
npm run assets:worker -- --preview-only
```

`[WORKER-PUBLISH]` 构建先验证当前源码骨骼和烘焙版本，再移除通用工业包里的旧车网格并重排压缩块，增加独立 `worker` 材质页和模型包。其它单位的压缩顶点数据保持原样。原工业 `.blend` 中的旧车根节点及后代也会移除，避免两个工程同时保留一个现役模型。

`[WORKER-PROVENANCE]` 清单的 `generators.worker` 追踪专用生成器、烘焙记录和工程路径。其余 77 个模型保留通用生成器来源。`check:blender` 逐包验证实际生成脚本 SHA-256，不能用更新清单版本代替重新烘焙。

正式 `assets:sculpt` 全库或分族构建之后会重新构建专用采集车；通用 `--only-key` 仍只输出试作。完整预览渲染按清单选择各模型的现役工程，跳过已被替换的旧车。

已有完整预览时，`render-sculpt-library.py --only-key industrial:worker` 可只刷新这辆车的统一布光图块。未刷新的各包必须仍匹配原渲染记录中的生成器版本，否则增量渲染终止；随后运行 `pack-sculpt-library.py` 更新完整图集。

当前重点是提高本车的形体、机械结构、战场磨损和可编辑性。材质结合生图样本与按安装位置控制的程序遮罩；生成样本并非摄影测量的完整 PBR 材质，微法线也不等同于扫描深度。仍沿用源码动作，还没有逐笔手绘磨损、透明驾驶舱、专用 LOD 或逐机械连杆求解。近景精修预算尚未据此保证大量同屏采集车的帧率，也不能将本轮直接等同于《星际争霸 2》宣传片的完整商业美术制作。
