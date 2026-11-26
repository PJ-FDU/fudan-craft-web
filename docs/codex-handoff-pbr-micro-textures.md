# Codex 交接文档：3D 单位微表面 PBR 材质与做旧纹理接入

## 1. 背景与明确目标
- **用户诉求**：使用内置生图工具生成**无缝可平铺的材料表面纹理与战地做旧纹理**，叠加到现有 3D 单位与建筑模型上，用「简单几何建模 + 高质量 PBR 贴图纹理」提升真实感。
- **出厂磨损**：单位与建筑从首次出现就带有固定的使用痕迹，磨损随模型一起运动。油污集中在接缝与底部，掉漆和划痕零星分布在易磨损的边缘，生群甲壳有少量浅裂纹和旧伤痕。颜色、粗糙度与法线应表现同一处磨损。磨损强度与血量及受击状态无关。
- **明确不要做的事**：**不要**使用 `DecalGeometry` 在模型表面投影编号/徽标/贴纸（之前尝试过，会遮挡/重叠模型本身已烘焙的涂装细节如工程车 `EW-04` 与警示条，且容易贴到玻璃上，已彻底撤回清理）。
- **核心方向**：在现有精雕材质 `sculptSurface` 的片元着色器中叠加**高频微表面 Detail 贴图（法线 + 粗糙度 + 轻微肌理）**与**战地做旧层（油污、铁锈、掉漆、裂纹）**，按模型现有的 ORM 通道自动分流，**自动屏蔽玻璃与镜面**。

---

## 2. 项目渲染架构关键事实（已核实）
1. **所有单位与建筑均走 `sculptSurface`**：
   - `public/assets/blender-sculpt-v2/manifest.json` 中全部 **78 个单位和建筑模板**均带有 `surface` 字段，运行时全部走 [src/game/model-surface.ts](file:///Users/panjian/fudan-craft-web/src/game/model-surface.ts) 的 `sculptSurface(surface)`。
   - 旧版 56 格材质图集 `modelSurface`（[src/game/battle-materials.ts](file:///Users/panjian/fudan-craft-web/src/game/battle-materials.ts)）目前仅用于地面与无 Blender 资产时的回退，**修改旧图集在当前游戏中几乎不可见**。
2. **材质实例化与着色器钩子链路**：
   - `BattleModels.instantiate`（[src/game/models-3d.ts](file:///Users/panjian/fudan-craft-web/src/game/models-3d.ts#L170-L185)）为每个 `BlenderSurface` 创建材质组（基础色 + 4 阵营染色），并调用 `this.configureSurface?.(material)`。
   - `BattleScene`（[src/game/battle-scene.ts](file:///Users/panjian/fudan-craft-web/src/game/battle-scene.ts#L154-L155)）将 `configureSurface` 绑定到 `this.addHaze(material)`（[src/game/battle-scene.ts](file:///Users/panjian/fudan-craft-web/src/game/battle-scene.ts#L257-L359)）。
   - **关键约束**：`addHaze` 会包装 `material.onBeforeCompile` 并扩展 `material.customProgramCacheKey`，且在 `#include <opaque_fragment>` 末尾向 G-buffer 写入 `battleNormal` 和 `battleSurface` 供 `BattleGI`（间接光与反射）使用。
   - 因此在 `sculptSurface` 内添加 `onBeforeCompile` 时：
     1. 必须设置唯一的 `material.customProgramCacheKey`（如 `sculpt-micro-pbr-v1:${kind}`），以便 `addHaze` 正确拼接缓存键；
     2. 微表面对 `diffuseColor`、`roughnessFactor`、`normal` 的修改必须在 `#include <opaque_fragment>` 之前完成，这样间接光/反射与战争迷雾都会自动生效。
3. **Node 单元测试约束**：
   - `tests/model-weathering.test.ts` 在无 DOM 的 Node 环境运行，且断言所有可移动单位的 Mesh 数量 `<= 3`。
   - **不要**给单位新增子 Mesh；纹理加载必须做 `typeof document !== 'undefined'` 保护，无 DOM 时安全跳过。

---

## 3. 输入贴图清单
已按 [生图提示词](pbr-micro-textures-prompts.md) 使用内置生图工具生成 7 张源图。交付的 `1024×1024` PNG 位于 `public/assets/generated/micro/`，游戏加载该目录中的两张 `512×512` 打包图。

| 文件名 | 类型 | 用途 |
|---|---|---|
| `micro-painted-armor.png` | 中性灰微表面 | 烤漆装甲钢（橘皮漆面、铸钢微孔、细微划痕） |
| `micro-brushed-metal.png` | 中性灰微表面 | 拉丝枪钢 / 锻造金属（炮管、骨架、机械结构） |
| `micro-matte-rough.png` | 中性灰微表面 | 哑光橡胶 / 织物 / 粗糙复合材料（轮胎、履带、士兵服、地基） |
| `micro-organic-chitin.png` | 中性灰微表面 | 生物甲壳 / 角质纹（生群共生体 `brood` 外壳） |
| `weather-grime-rust.png` | 白底做旧叠加 | 工业油污、红褐铁锈斑点、干泥渍 |
| `weather-cracks-chips.png` | 白底做旧叠加 | 漆面剥落、应力裂纹、装甲划伤 |
| `micro-woven-cloth.png` | 中性灰微表面 | 人形单位制服、背带和布包的斜纹织物与手绘排线 |

---

## 4. 建议实现步骤

### 步骤 1：贴图预处理脚本（`scripts/build-micro-textures.mjs`）
系统已安装 `node`（v22）与 `/opt/homebrew/bin/ffmpeg`（无 Python PIL/numpy），可用 Node + `ffmpeg` 编写一次性预处理脚本：
1. 读取 `public/assets/generated/micro/` 下的基础源图及人形织物；
2. 对输入图交叉混合边缘，使平铺接缝自然过渡。对微表面高度图做**均值归一化到 0.5（中性灰）**；
3. 运行 `node scripts/build-micro-textures.mjs`，生成两个 `512×512` PNG。`material-detail.png` 的 RGBA 分别存放漆面、拉丝金属、哑光和甲壳高度。`weather-detail.png` 的 RGB 分别存放污渍、铁锈和裂纹掉漆遮罩，Alpha 存放人形织物高度；
4. 着色器从三平面采样后的高度求表面梯度，叠加到已烘焙的法线上。两张输出图都存在时才加载，生成后重新启动开发服务器或重建应用。

### 步骤 2：在 `src/game/model-surface.ts` 升级 `sculptSurface`
1. 在 `src/game/blender-assets.ts` 加载时为 `BlenderSurface` 配置共享贴图和材质参数。生群使用甲壳高度，已有独立烘焙做旧的工程车仅增加微表面细节；
   - 七种人形单位使用织物参数，在高粗糙度、低金属度的制服部位叠加织纹，铁锈集中于金属装备；
2. 在顶点着色器中传递静止姿态的模型空间坐标与法线（`vMicroPos = position`, `vMicroNormal = normal`），或使用高频平铺 UV（推荐 **Object-space Triplanar 投影**，避免不同模型 UV 密度不一致导致有的车纹理太大、有的太小；注意蒙皮模型取的是绑定姿态 `position`/`normal`，动画时纹理严丝合缝跟着骨骼走，不会滑动！）。
3. 在片元着色器中基于模型现有的 `orm` 贴图（`R=AO, G=Roughness, B=Metalness`）做物理分流：
   - **玻璃 / 镜面屏蔽**：`smoothstep(0.28, 0.40, ormSample.g)` 从低粗糙度玻璃和镜面平滑过渡到可做旧的表面。独立发光槽沿用原材质；
   - **微表面分流**：
     - 高金属度（`smoothstep(0.45, 0.75, ormSample.b)`）→ `micro-brushed-metal`；
     - 高粗糙度非金属（`smoothstep(0.68, 0.88, ormSample.g) * (1.0 - ormSample.b)`）→ `micro-matte-rough`（`brood` 阵营走 `micro-organic-chitin`）；
     - 其余半哑光漆面 → `micro-painted-armor`；
   - **油污与铁锈叠加**（`weather-grime-rust`）：
     - 权重由 `cavity = 1.0 - ormSample.r`（AO 凹缝）+ 底盘低高度权重 + `nonGlass` 共同控制，用乘法/混合叠加到 `diffuseColor.rgb`，同时轻微抬高 `roughnessFactor`（锈迹和油泥比光面漆更粗糙），降低局部 `metalnessFactor`；
     - `brood` 生物阵营关闭铁锈层。
   - **裂纹与划伤叠加**（`weather-cracks-chips`）：
     - 克制叠加（如 `0.25 ~ 0.45` 强度）到装甲与建筑表面，配合派生法线产生清晰的微凹凸感；
     - 划痕露底金属处可略微降低粗糙度、提高金属度，增强高光边缘真实感。
     - 生群将裂纹遮罩用作甲壳浅裂和旧伤，保留甲壳原色与非金属反光。
   - **法线融合**：在 `#include <normal_fragment_maps>` 之后将微表面法线扰动叠加到 `normal`（强度控制在 `0.18 ~ 0.35`，避免俯视角噪点闪烁）。

### 步骤 3：验证与检查
1. 运行测试与完整构建：
   ```bash
   npm test && npm run build
   ```
2. 打开浏览器进入游戏「模型图鉴」（Model Gallery）：
   - 重点拉近检查 **工业联邦工程车（`worker`）**、**坦克（`tank`）**、**机甲（`mech`）**、**基地（`base`）** 和 **生群单位（`brood`）**：
     - 确认挡风玻璃、侧窗、发光灯条**完全干净，无污渍/划痕/杂纹**；
     - 确认工程车原有 `EW-04` 与车顶警示条**清晰保留**；
     - 确认出生时已有磨损，动作切换与血量变化时磨损位置和强度保持一致；
     - 确认烤漆装甲、炮管金属、轮胎橡胶呈现出明显不同的微表面质感，缝隙与底部有自然的油污/铁锈层次，且远景缩放无明显摩尔纹或闪烁。

---

## 5. 本次对话中已完成并保留的其他改动（供参考）
当前工作区已包含以下已通过测试和构建的改动，请保留勿覆盖：
- `src/game/terrain-height.ts`、`src/game/battle-terrain.ts`、`src/game/battle-scene.ts`：3D 水体改为基于高度场自然裁剪的凹陷水面（`WATER_SURFACE_Y = -1.5`），消除方块锯齿，新增岸边湿沙过渡与水面涟漪/波光；
- `src/game/custom-maps.ts`、`src/game/map-editor.ts`：地图编辑器新增 5 档尺寸规格（64～192）居中裁切/扩展、斜坡保留草地、新增 4 种 3D 装饰笔刷（灌木/野花/草蕨/树桩）、自然岸坡水体与橡皮擦还原；
- `src/game/camera.ts`：新增 `freeOverview` 开关，允许地图编辑器缩小至俯瞰整张地图全景；
- `tests/custom-maps.test.ts`：补充凹陷水面与地图尺寸缩放单测。
