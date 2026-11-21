# 四族模型材质

## 共用表面做旧

战场与模型图鉴共用 `model-weathering.ts`：金属有局部锈蚀、油污、掉漆与零星弹痕；星能合金有氧化色，陶瓷与复合材料露出暗色底层，甲壳、织物与橡胶有擦伤与积灰。阵营色板同样使用这层磨损，保留玩家颜色。磨损固定在部件静止表面，骨骼动画不改变纹理落点。

[四族单位与基地实机截图](weathering-preview.jpg) · [失落神庙实战视角](weathering-battle.jpg)。图鉴图片仅裁切、缩放与拼接，使用实际生产模型、相同玩家颜色与图鉴光照。材质参数、合批与验证规则见 [3D 渲染说明](../3D_RENDERING.md#材质与光照)。

## v4 星能、生群与泰坦材质

两张 1536 × 1024 的图集供 3D 战场和模型图鉴共用。星能采用深蓝灰陶瓷、拉丝合金、蓝青晶体和暖金导轨。生群更新甲壳、纤维膜、营养囊和角质，泰坦拥有独立的装甲、钢制骨架、柔性接头与磨损饰板纹理。

- [图鉴实机预览](in-game-v4.jpg) · [战术档案图标实机截图](codex-v4.jpg)
- 内置 ImageGen 源图 [星能](sources-v4/stellar.png) · [生群](sources-v4/brood.png) · [泰坦](sources-v4/titan.png)
- [基础色图集](../../public/assets/generated/faction-materials-v4.webp) · [法线与粗糙度图集](../../public/assets/generated/faction-detail-v4.webp)
- [61 个透明模型图标](../../public/assets/generated/model-portraits-v1.webp)

安装 Pillow 后运行 `python3 scripts/build-faction-materials.py` 可重建材质图集。本节的图标是 v4 随附的模型直出版本。当前安装使用[二维绘制图标](../model-portraits/README.md)。

### v4 生图提示词

### stellar

```text
Use case: stylized-concept. Generate exactly one square production base-color texture sheet for an original high-fidelity sci-fi RTS. Exact 2 by 2 grid of four equal square edge-to-edge material swatches, boundaries exactly at 50%. Every cell flat macro orthographic perpendicular scan with even ambient illumination, no perspective, props, frame, margins, labels, letters, logos, horizon, vignettes, broad shadows, or baked glow. Physically plausible granular detail across the entire cell, local finish variation, useful texture in very small game thumbnails. The entire faction's signature is midnight petrol-blue, titanium teal slate and icy turquoise, with restricted aged pale brass inlays. Avoid bright white panels and avoid gray monochrome. Top left: satin dark petrol-blue ceramic armor with narrowly interrupted diagonal etched seams, edge scuffs exposing subdued blue-gray substrate, tiny tool marks. Top right: richly colored blue-teal crystal slices with delicate thin mineral fractures in translucent layered aquamarine, no bright white portions, moderate depth and cyan details. Bottom left: brushed midnight slate alloy, fine grain and dark teal oxide, tiny offset oblique etching, subtle scuffs, medium cool value. Bottom right: quiet aged champagne-brass conductive metal, dark blue-gray oxidation in narrow engraved tracks, caramel brown patina and faint directional micro-scratches, high-end aerospace work.
```

### brood

```text
Use case: stylized-concept. Generate exactly one square production base-color texture sheet for an original high-fidelity sci-fi RTS. Exact 2 by 2 grid of four equal square edge-to-edge material swatches, boundaries exactly at 50%. Every cell flat macro orthographic perpendicular scan with even ambient illumination, no perspective, props, frame, margins, labels, letters, logos, horizon, vignettes, broad shadows, or baked glow. Physically plausible granular detail across the entire cell, local finish variation, useful texture in very small game thumbnails. Biological armored alien colony, grounded deep brown and desaturated olive, with warmer active tissue. Top left: coarse overlapping dark burnt umber and olive keratin scutes, insect growth ridges, chipped ledges, fine dense pores, value variation retained in shade. Top right: muted burgundy fibrous tendons and living membrane, tissue strands of different scales with subtle branching vessels, matte wet-looking grain without highlights. Bottom left: dark amber ochre pleated resilient sac skin, amber micro-nodules and irregular near-translucent cells, soft dense granularity, no spheres. Bottom right: aged honey-beige horn with directional grown fibers, darkened weathering toward grooves, hairline fractures and fine edge wear. Sharp intricate textures with moderately restrained luminosity.
```

### titan

```text
Use case: stylized-concept. Generate exactly one square production base-color texture sheet for an original high-fidelity sci-fi RTS. Exact 2 by 2 grid of four equal square edge-to-edge material swatches, boundaries exactly at 50%. Every cell flat macro orthographic perpendicular scan with even ambient illumination, no perspective, props, frame, margins, labels, letters, logos, horizon, vignettes, broad shadows, or baked glow. Physically plausible granular detail across the entire cell, local finish variation, useful texture in very small game thumbnails. Titan heavy industrial exoskeleton, useful mechanically credible materials. Top left: weathered dark gunmetal grey-green ceramic-coated armor, hammered micrograin, occasional diagonal slate ceramic panels separated by fine shallow bevel lines, small battered edges exposing cold pale steel, tiny abrasion clusters. Top right: brushed cool blue-graphite hardened steel, fine machining marks, localized burnishing and scuffs, tiny silver rubbed zones, restrained finish. Bottom left: dark desaturated olive-black ribbed elastomer fiber seal and hydraulic coupling boot material with fine dust and diagonal fiber reinforcement, subtle inlaid seams. Bottom right: warm-gray titanium ceramic armor accent bands with chipped brass-ochre primer and less than ten percent warm pigment, subtle interrupted etching. Keep all quadrants evenly lit without large chunks of pure black or white.
```

## v3 细节材质

v3 使用两张 1280 × 1024 的图集，每行的最右侧是对应种族的细节材质，分别用于工业联邦的陶瓷装甲、生群的多层背甲、星能的光导晶体，以及远行者的复合装甲和驾驶舱外壳。

- [v3 图鉴实机预览](in-game-v3.jpg)
- [内置 ImageGen 原始素材](accent-study.png)
- [基础色图集](../../public/assets/generated/faction-materials-v3.webp)
- [切线法线及粗糙度图集](../../public/assets/generated/faction-detail-v3.webp)

细节图的 R、G 是切线空间法线的 X、Y，B 是相对粗糙度。法线由贴图去除低频明暗后的局部细节估算，金属度沿用模型的材质参数。

实际渲染检验覆盖模型图鉴与单人战场。78 个模型组合的 UV 均落在各自材质格内，四族的 20 种图集材质均有模型使用。

### v3 生图提示词

```text
Use case: stylized-concept. Create one square source atlas for original realistic sci-fi RTS PBR assets. Exactly four edge-to-edge equal square swatches in a 2 by 2 grid, meet at 50 percent on both axes. Flat orthographic perpendicular macro material scans with diffuse even lighting for use as albedo. No frames, separators, type, logos, perspective, broad shadows, vignettes, props, or material spheres. The texture detail must cover the entire quadrant. All repeatable patterns have uniform detail across the whole quadrant, plausible physical material construction, fine micro detail and low contrast for easier tinting. Top left: cool pale graphite grey and titanium-white aerospace ceramic plate, very fine uneven pebbled coating with clusters of shallow chips and subtly exposed metal streaks, a few shallow interrupted diagonal scribe lines, premium advanced engineered armor. Top right: dark warm muted umber insect chitin, repeating overlapping angular lamellae with copper highlights and fine dense pore clusters, scale grain across individual scutes, warm olive tan neutral colors with subtle terracotta. Bottom left: pale silvery ice-blue technical photonic glass, layered faint hairline pale turquoise conductive veins below the surface, clear fracture laminations, subtle frost at edges of those fractures, no direct glow or beams. Bottom right: warm weathered ochre and pale olive composite laminate, fine dense twill carbon weave under worn matte paint, sparse chips revealing charcoal fibers and a hint of dusty brush abrasion, low contrast and carefully finished. Four believable large-scale samples ready to UV map on modeled unit and structure geometry.
```

## v2 原始素材

v2 使用内置 ImageGen 生成四张 1254 × 1254 的 2 × 2 材质源图。v3 沿用这些底材，增加四种用于装甲与核心的表面。

- [实际游戏模型图鉴预览](in-game-v2.jpg)
- [基础色图集](../../public/assets/generated/faction-materials-v2.webp)
- [法线与粗糙度细节图集](../../public/assets/generated/faction-detail-v2.webp)

| 图集索引 | 种族 | 源图 | 象限材质，按左上、右上、左下、右下排列 |
| --- | --- | --- | --- |
| 32–35 | 生群共生体 | [有机](sources-v2/organic.png) | 甲壳、纤维膜、营养囊、角质 |
| 36–39 | 星能议会 | [星能](sources-v2/stellar.png) | 陶瓷、晶体、蚀刻合金、导体 |
| 40–43 | 远行者同盟 | [远行](sources-v2/relay.png) | 涂装装甲、拉丝框架、帆布、橡胶 |
| 44–47 | 工业联邦 | [工业](sources-v2/industrial.png) | 联邦装甲、电路、医疗复合板、维护钢材 |

v1 的原始资产和截图记录在 [源图目录](sources/) 与 [旧预览](preview.jpg)。

## 生图提示词

### organic

```text
Use case: stylized-concept. Generate a square high fidelity production base-color texture atlas for a realistic sci-fi RTS with Unreal Engine 5 inspired materials. One exact 2 by 2 grid of four equal square, separate, edge-to-edge material samples with boundaries at 50% of width and height. Each quadrant is a flat orthographic front-on macro scan of a homogeneous surface, no perspective or objects, no margins, no gutters, no borders, no labels, no typography, no watermark drawn into the texture. Lighting completely even and diffuse, no shadows, no glossy highlights, no ambient occlusion or vignette baked into the albedo. Use realistic medium-scale surface variation and restrained local wear that reads when seen from above. Make every quadrant neutral-to-light in value so shader tinting remains visible. Top left: overlapping irregular pale olive and warm bone insect carapace scutes, abrasion and tiny pits. Top right: desaturated oxblood and clay semi-organic fibrous membrane with branching fine vascular threads. Bottom left: ochre and muted amber granular sac skin with dense tiny nodules and soft organic mottling. Bottom right: pale ivory and gray-brown keratin with fine directional striations and subtle layered wear.
```

### stellar

```text
Use case: stylized-concept. Generate a square high fidelity production base-color texture atlas for a realistic sci-fi RTS with Unreal Engine 5 inspired materials. One exact 2 by 2 grid of four equal square, separate, edge-to-edge material samples with boundaries at 50% of width and height. Each quadrant is a flat orthographic front-on macro scan of a homogeneous surface, no perspective or objects, no margins, no gutters, no borders, no labels, no typography, no watermark drawn into the texture. Lighting completely even and diffuse, no shadows, no glossy highlights, no ambient occlusion or vignette baked into the albedo. Use realistic medium-scale surface variation and restrained local wear that reads when seen from above. Make every quadrant neutral-to-light in value so shader tinting remains visible. Top left: opal ivory technical ceramic panels, delicate machining marks and infrequent shallow seams. Top right: pale ice-blue mineral crystal cross-section with thin fracture lines and subtle angular internal mineral zones, restrained contrast. Bottom left: desaturated titanium-blue astral alloy with restrained angular etched circuitry and faint brushing. Bottom right: muted pale champagne alloy with narrow conductive traces and light directional scuffing.
```

### relay

```text
Use case: stylized-concept. Generate a square high fidelity production base-color texture atlas for a realistic sci-fi RTS with Unreal Engine 5 inspired materials. One exact 2 by 2 grid of four equal square, separate, edge-to-edge material samples with boundaries at 50% of width and height. Each quadrant is a flat orthographic front-on macro scan of a homogeneous surface, no perspective or objects, no margins, no gutters, no borders, no labels, no typography, no watermark drawn into the texture. Lighting completely even and diffuse, no shadows, no glossy highlights, no ambient occlusion or vignette baked into the albedo. Use realistic medium-scale surface variation and restrained local wear that reads when seen from above. Make every quadrant neutral-to-light in value so shader tinting remains visible. Top left: weathered warm sand painted expedition armor, large understated panel seams, restrained scuffing and minor chipped primer. Top right: pale desaturated sage-gray brushed structural alloy, fine extrusion marks and subtle field abrasions. Bottom left: light desert khaki densely woven technical canvas with subtle ripstop grid and thread variation, as a flat raster sample. Bottom right: weathered gray graphite hard rubber with evenly spaced thick diagonal embossed tread bars and fine abrasion.
```

### industrial

```text
Use case: stylized-concept. Generate a square high fidelity production base-color texture atlas for a realistic sci-fi RTS with Unreal Engine 5 inspired materials. One exact 2 by 2 grid of four equal square, separate, edge-to-edge material samples with boundaries at 50% of width and height. Each quadrant is a flat orthographic front-on macro scan of a homogeneous surface, no perspective or objects, no margins, no gutters, no borders, no labels, no typography, no watermark drawn into the texture. Lighting completely even and diffuse, no shadows, no glossy highlights, no ambient occlusion or vignette baked into the albedo. Use realistic medium-scale surface variation and restrained local wear that reads when seen from above. Make every quadrant neutral-to-light in value so shader tinting remains visible. Top left: desaturated light slate steel-blue aerospace armor plating, muted layered panel seams and chipped paint. Top right: light muted steel-blue micro-etched circuit substrate with thin cool silver pathways and small pads, no luminous elements. Bottom left: off-white segmented medical-grade composite plating with subtle micro-grain and minimal red paint flecks. Bottom right: light gray brushed service steel with machining bands, sparse faint grease marks and abrasion.
```
