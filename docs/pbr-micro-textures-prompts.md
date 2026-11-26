# 3D 单位微表面 PBR 纹理生图提示词清单

本清单用于为游戏内全部 78 个 `sculptSurface` 精雕 3D 单位与建筑生成**无缝可平铺（Seamless Tileable）的高频微表面材质纹理**。

> **为什么只需要这 4 张中性灰微表面图？**
> - 游戏模型已有独立烘焙的固有色、阴影与涂装（如工程车上的 `EW-04` 与警示条）；
> - 生成**中性灰（#808080 基准）、无方向光阴影、高频细密肌理**的无缝图后，程序会自动把它们转为 **微表面法线贴图（Detail Normal）+ 微粗糙度扰动 + 极轻微明暗肌理**，按模型现有的 ORM 通道自动分流贴到金属/烤漆/哑光/甲壳上（自动跳过玻璃与镜面），完全不破坏原涂装且能显著消除“平滑塑料感”。

---

## 通用生图参数建议
- **尺寸比例**：`1:1`（推荐 `1024×1024`）
- **格式**：PNG
- **存放目录**：生成后统一放入 `public/assets/generated/micro/` 并按下方指定文件名保存。

---

## 1. 烤漆装甲钢微表面纹理（主力载具与建筑外壳）
- **保存路径**：`public/assets/generated/micro/micro-painted-armor.png`
- **用途**：工业联邦 / 远行者同盟载具烤漆装甲、机甲外甲、建筑金属外墙（中等粗糙度烤漆面）

### Prompt
```text
Seamless tileable 1024x1024 PBR micro-detail surface texture of military rolled painted steel armor plate, flat orthographic top-down close-up view, neutral mid-grey base tone (#808080) with subtle high-frequency micro-detail: fine powder-coated orange-peel paint grain, subtle cast steel micro-pitting, ultra-fine hairline surface scratches, faint micro-wear speckles, completely uniform diffuse ambient lighting with zero directional shadows, zero gradients, zero vignettes, no large panels, no rivets, no text, no logos, strictly seamless repeating edges on all four sides, photorealistic game engine detail height/albedo map.
```

---

## 2. 拉丝枪钢 / 锻造金属微表面纹理（炮管、骨架、机械结构）
- **保存路径**：`public/assets/generated/micro/micro-brushed-metal.png`
- **用途**：高金属度部位（炮管、液压杆、机械骨架、履带金属件、建筑钢顶）

### Prompt
```text
Seamless tileable 1024x1024 PBR micro-detail surface texture of brushed gunmetal and machined forged steel, flat orthographic top-down close-up view, neutral mid-grey base tone (#808080) with crisp fine horizontal brushed metal streaks, subtle CNC machining micro-grooves, tiny scuff marks and faint metallic grain variation, completely flat even diffuse lighting with zero specular hotspots, zero directional shadows, zero gradients, no bolts, no seams, no text, strictly seamless repeating edges on all four sides, photorealistic game engine detail map.
```

---

## 3. 哑光橡胶 / 战术织物 / 混凝土微表面纹理（非金属哑光面）
- **保存路径**：`public/assets/generated/micro/micro-matte-rough.png`
- **用途**：轮胎橡胶、履带胶块、士兵战术服、建筑混凝土地基等高粗糙度非金属表面

### Prompt
```text
Seamless tileable 1024x1024 PBR micro-detail surface texture of heavy industrial matte rubber and rough weathered composite surface, flat orthographic top-down close-up view, neutral mid-grey base tone (#808080) with uniform dense fine-grained micro-pebble stippling, subtle porous matte grit, faint micro-abrasion and dusty pores, completely flat even diffuse lighting with zero directional shadows, zero dark corners, zero gradients, no large cracks, no patterns or text, strictly seamless repeating edges on all four sides, photorealistic game engine detail map.
```

---

## 4. 生物甲壳 / 精细釉面微表面纹理（生群 & 星能议会）
- **保存路径**：`public/assets/generated/micro/micro-organic-chitin.png`
- **用途**：生群共生体甲壳/几丁质外骨骼的细密角质纹与微孔（也用于生物建筑外壳）

### Prompt
```text
Seamless tileable 1024x1024 PBR micro-detail surface texture of alien insectoid chitin carapace and organic keratin shell, flat orthographic top-down close-up view, neutral mid-grey base tone (#808080) with fine dense organic micro-ridges, subtle fibrous growth striations, tiny biological pores and micro-dimples, completely flat even diffuse lighting with zero directional shadows, zero color tint, zero gradients, no large scales or eyes, strictly seamless repeating edges on all four sides, photorealistic game engine detail map.
```

---

## 5. 工业油污、铁锈与泥渍无缝叠加图（战地做旧层）
- **保存路径**：`public/assets/generated/micro/weather-grime-rust.png`
- **用途**：按模型 AO 缝隙与车体高度自动混合，在机械接缝、底座、底盘和金属边缘叠加真实的油泥污渍、铁锈斑点与雨水流痕（自动避开玻璃与生物组织）

### Prompt
```text
Seamless tileable 1024x1024 PBR weathering overlay texture of industrial oil grime, dark engine grease smudges, warm reddish-brown rust patches, and subtle dried mud stains on a clean flat pure white (#FFFFFF) background, flat orthographic top-down view, organic sparse distribution (roughly 35% weathered stains and 65% clean white negative space so it layers naturally without muddying the whole surface), fine realistic rust speckles and subtle oil streaks, completely flat even diffuse lighting with zero directional shadows, zero gradients, no text, no logos, strictly seamless repeating edges on all four sides, photorealistic game engine multiply weathering map.
```

---

## 6. 漆面剥落、裂纹与装甲划伤无缝叠加图（磨损与战损层）
- **保存路径**：`public/assets/generated/micro/weather-cracks-chips.png`
- **用途**：给装甲和混凝土建筑叠加少量固定的掉漆、应力裂纹与划痕。生群甲壳可复用裂纹形状来表现浅裂和旧伤，并保留甲壳原有的非金属反光。

### Prompt
```text
Seamless tileable 1024x1024 PBR surface damage and wear overlay texture of fine armor stress cracks, chipped paint flakes, sharp metallic scratches, and subtle concrete hairline fractures on a clean flat pure white (#FFFFFF) background, flat orthographic top-down view, dark charcoal and exposed raw gunmetal scratches with crisp thin jagged cracks and tiny chipped edges, sparse natural clustering (roughly 25% dark cracks and scratches, 75% clean white negative space), completely flat even diffuse lighting with zero directional shadows, zero gradients, no text, no bullet holes, strictly seamless repeating edges on all four sides, photorealistic game engine multiply/detail wear map.
```

---

## 7. 人形单位斜纹织物
- **保存路径**：`public/assets/generated/micro/micro-woven-cloth.png`
- **用途**：制服、背带和布包的灰度高度纹理，兼顾细密织纹与手绘排线。

### Prompt
```text
Use case: stylized-concept. An original tileable, opaque monochrome PBR height-and-grain texture for the worn woven uniforms of hand-painted strategy-game infantry. Square 1024x1024, flat orthographic, fine irregular ink crosshatching over sturdy canvas twill, a few raised frayed threads, tiny scuffs and flecks in the weave, understated tactile charcoal pencil hatching, visibly distinct from pebbled rubber. Medium-neutral gray (#808080) average, small dark and light grain, entirely even ambient light. Consistent texture scale edge-to-edge. Truly repeating on opposite edges. Fill the whole image with a swatch, with no visible garment, silhouette, borders, folds, dramatic shadows, print, symbols, lettering, large tears, or specular highlights.
```

---

## 交付与接入步骤
1. 上述 7 段 Prompt 已分别用于内置生图工具。输出原图为 `1254×1254`，交付版统一缩放为 `1024×1024`；
2. 将 7 张图保存到 `public/assets/generated/micro/`：
   - `micro-painted-armor.png`（烤漆装甲微表面）
   - `micro-brushed-metal.png`（拉丝金属微表面）
   - `micro-matte-rough.png`（哑光橡胶/织物/混凝土微表面）
   - `micro-organic-chitin.png`（生物甲壳微表面）
   - `weather-grime-rust.png`（油污与铁锈做旧叠加层）
   - `weather-cracks-chips.png`（掉漆、划痕与裂纹叠加层）
   - `micro-woven-cloth.png`（人形制服和背带的织纹）
3. 源图更新后，运行 `node scripts/build-micro-textures.mjs` 重新生成两张游戏用贴图。`sculptSurface` 从高度计算法线扰动，并用同一组遮罩控制颜色和粗糙度。污渍与铁锈优先聚集在模型凹缝和底部，裂纹与划伤会在单位或建筑首次出现时显示，玻璃与发光件保持原有材质效果。

## 工业联邦木材加工厂顺纹木材

`public/assets/generated/micro/mill-wood-grain.png` 是屋面木板、山墙和原木外侧的顺纹源图。原木切面的年轮按各根原木的圆心生成。工业联邦模型重新烘焙后，`scripts/finish-lumbermill-wood.ts` 将木纹写入加工厂原有的 PBR 图块。

```text
Use case: stylized-concept. Generate one original square seamless wood material swatch for a stylized hand-painted 3D sawmill in a muted weathered strategy game. Orthographic flat surface, full-bleed 1:1 1024×1024. Grey-neutral height source around medium gray. Long uninterrupted timber fibers run exactly vertically, with dark ink-like ragged growth streaks, a few elongated knots, subtle narrow rough saw marks and pores. Medium-scale broad visible grain readable on a small game-model roof, plus fine fibers; natural irregular rhythm. Soft uniform illumination: no cast shadows, perspective, vignette, visible plank seams, boards outlined as shapes, cut cross sections, graphics, lettering, logos, or frame. Left repeats with right and top repeats with bottom.
```

## 地表、资源和机械表面的 13 张源图

以下英文提示词已用于内置生图工具。归档版统一为 1024×1024，位于 [作者源图库](../scripts/material-library/surfaces/)。使用部位、派生通道和导入状态见 [全量材质方案](MATERIAL_TEXTURE_PLAN.md#源图与通道清单)。

### `cast-concrete.png`

```text
Single original square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. True orthographic flat scan, even diffuse light, full bleed, no borders, text, objects, cast shadows, directional light or vignetting. Readable painterly medium-scale structures supported by fine surface texture. The left/right and top/bottom edges tile. 1:1. Weathered warm gray poured industrial concrete, ochre-gray undertones, a spread of irregular air pinholes and small aggregate, restrained dry chipped specks and soft brushed tone, no whole panels or straight slab seams.
```

### `layered-rock.png`

```text
Single original square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. True orthographic flat scan, even diffuse light, full bleed, no borders, text, objects, cast shadows, directional light or vignetting. Readable painterly medium-scale structures supported by fine surface texture. The left/right and top/bottom edges tile. 1:1. Cool desaturated slate rock cliff surface with distinct irregular roughly horizontal slanted geological beds, darker recessed medium-scale growth fractures, fine crystalline stone texture, a few warm beige mineral streaks, no loose rocks or moss.
```

### `wet-sand.png`

```text
Single original square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. True orthographic flat scan, even diffuse light, full bleed, no borders, text, objects, cast shadows, directional light or vignetting. Readable painterly medium-scale structures supported by fine surface texture. The left/right and top/bottom edges tile. 1:1. Wet muted sandy loam and fine pebbles, viewed directly from above, short overlapping natural shallow sediment ripples, brown-gray and muted tan, fine matte grain and gentle blotches, no river or water in frame.
```

### `moss-lichen.png`

```text
Single original square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. True orthographic flat scan, even diffuse light, full bleed, no borders, text, objects, cast shadows, directional light or vignetting. Readable painterly medium-scale structures supported by fine surface texture. The left/right and top/bottom edges tile. 1:1. Muted olive sage moss and rust-ochre lichen coverage mask reference on pale neutral gray: irregular sparse flat patches and semitransparent soft organic fringes occupying about 40 percent of the area, some brighter fine growth, well-separated patch silhouettes. It is a flat scanned decal source, no larger pieces or ground scene.
```

### `furrowed-bark.png`

```text
Single original square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. True orthographic flat scan, even diffuse light, full bleed, no borders, text, objects, cast shadows, directional light or vignetting. Readable painterly medium-scale structures supported by fine surface texture. The left/right and top/bottom edges tile. 1:1. Muted warm gray-umber pine and oak trunk bark sample, long vertical furrows, angular small ridges and overlapping scales, coherent directional lines and sensible medium-scale separation, no end grain, no whole tree, no leaves and no large knots.
```

### `birch-bark.png`

```text
Single original square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. True orthographic flat scan, even diffuse light, full bleed, no borders, text, objects, cast shadows, directional light or vignetting. Readable painterly medium-scale structures supported by fine surface texture. The left/right and top/bottom edges tile. 1:1. Pale chalk-gray white-birch bark, fine charcoal horizontal lenticels, occasional shallow peeling edges and muted gray-beige tones, unmistakable horizontal interrupted painted marks over uniform light bark, no trunk scene or end grain.
```

### `gold-vein.png`

```text
Original single square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. Orthographic flat scan, full bleed, uniform soft illumination, no cast shadows, text, objects, vignette or border. Unmistakable painterly medium-scale forms and restrained microdetail. Edge continuity in both directions. 1:1. Fractured dark charcoal-brown slate with sparse pale warm ochre metallic ore veins following jagged mineral fractures. Embedded flat flakes and striations, about 25 percent ore and 75 percent muted rock, no discrete jewels, no big gemstone props, no emissive glow. Gold color is a usable vein mask.
```

### `oil-film.png`

```text
Original single square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. Orthographic flat scan, full bleed, uniform soft illumination, no cast shadows, text, objects, vignette or border. Unmistakable painterly medium-scale forms and restrained microdetail. Edge continuity in both directions. 1:1. Flat almost-black wet petroleum film, quiet near-black blue-gray and subdued violet-green iridescent eddies, quiet viscosity strokes and fine suspended amber particles, no reflection of shapes, no mirror highlights. It should read as dark thick oil.
```

### `dry-tar.png`

```text
Original single square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. Orthographic flat scan, full bleed, uniform soft illumination, no cast shadows, text, objects, vignette or border. Unmistakable painterly medium-scale forms and restrained microdetail. Edge continuity in both directions. 1:1. Dry cracked industrial tar residue on dark matte mud. Mottled pitch-black and warm charcoal cracked crust, many irregular scale sizes and fractured edges, very little color, tactile coarse detail, no reflective shine or puddles.
```

### `rubber-tread.png`

```text
Original single square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. Orthographic flat scan, full bleed, uniform soft illumination, no cast shadows, text, objects, vignette or border. Unmistakable painterly medium-scale forms and restrained microdetail. Edge continuity in both directions. 1:1. Worn matte graphite elastomer surface for industrial vehicle tires and conveyor contact pads. Fine black pebbled rubber, repeating broken diagonal molded grooves and worn faces, sparse dirt in recesses, strong medium-scale groove separations, no complete wheel or vehicle.
```

### `cast-track-steel.png`

```text
Original single square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. Orthographic flat scan, full bleed, uniform soft illumination, no cast shadows, text, objects, vignette or border. Unmistakable painterly medium-scale forms and restrained microdetail. Edge continuity in both directions. 1:1. Cast graphite steel track-shoe contact surface, directional polished bands on rough cast steel grain, subtle blue-gray graphite with some warm burnish, tiny edge scuffs and machining abrasion, continuous surface with no linked objects or hardware.
```

### `ribbed-seal.png`

```text
Original single square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. Orthographic flat scan, full bleed, uniform soft illumination, no cast shadows, text, objects, vignette or border. Unmistakable painterly medium-scale forms and restrained microdetail. Edge continuity in both directions. 1:1. Flexible graphite reinforced industrial rubber bellows surface; repeated parallel medium-scale ribs and seam lines with subtle embedded fiber weave, slightly dusty recesses, dark gray-brown matte rubber, no actual cylindrical piece.
```

### `heat-oxidized.png`

```text
Original single square seamless repeating PBR material swatch for a muted, hand-painted top-down strategy game. Orthographic flat scan, full bleed, uniform soft illumination, no cast shadows, text, objects, vignette or border. Unmistakable painterly medium-scale forms and restrained microdetail. Edge continuity in both directions. 1:1. Blue-gray graphite exhaust steel with thin desaturated muted bronze and plum oxide zones, dark dull soot in loose elongated patches, small streaked scuffs and rough oxidized grain. It is a fairly dark flat material, no actual machinery, no exaggerated rainbow saturation.
```

## 屋面、皮革、光学、水面和战场特效

以下六张新增源图也使用内置 ImageGen，归档到 [作者源图库](../scripts/material-library/surfaces/)。水波和泡沫压入地表细节图的水体层。透明特效归档留存 RGBA，运行版缩放为 512×512 并清理近透明边缘色。

### `pressed-roof.png`

```text
Original game material source, square full-bleed tileable orthographic scan, flat diffuse light, no directional shadows or specular lighting, no perspective, no logos or writing. Original hand-painted strategy game textures with broad brushwork, natural wear and legible mid-scale shapes. Seamless repeating opposite edges. Weathered corrugated pressed metal roofing, repeated parallel vertical raised standing seams running continuously, broad desaturated charcoal blue-grey steel and restrained burnt orange oxidation along intermittent ridges, muted primer showing through at occasional scrapes. Clear broad shape and restrained grain, no fasteners or curved architectural objects.
```

### `worn-leather.png`

```text
Original game material source, square full-bleed tileable orthographic scan, flat diffuse light, no directional shadows or specular lighting, no perspective, no logos or writing. Original hand-painted strategy game textures with broad brushwork, natural wear and legible mid-scale shapes. Seamless repeating opposite edges. Brown-gray pebbled upholstery and tactical equipment leather, matte irregular compact grain, subtle flexible tangential wrinkles, age creasing and sporadic polished tiny areas. Warm brown umber with broad variations, few short creases, no stitching, straps, belts, garment or boundary.
```

### `water-ripple-height.png`

```text
Square seamless grayscale height input for shallow game lake ripples, strictly top-down, edge to edge flat texture. Soft overlapping wind-driven irregular tiny elongated ripples oriented diagonally and cross ripples, medium gray baseline, modest contrast, no overt directional light, shoreline, bubbles, reflections, reflections of skies, typography, border, or recognizable objects. Gray normal-height source.
```

### `shore-foam.png`

```text
Square tileable grayscale foam coverage mask for still lake wet edge. Black water, irregular thin gray-to-white foam filaments and scattered sparse clusters of small holes and soft beads, airy and thin with large black negative space. Flat overhead and entirely edge-to-edge. Organic interwoven broken crooked filaments with no overall comparable large shapes or thick wave crests. No ground, color, coastline outline, objects, borders or writing.
```

### `battle-particles.png`

```text
Square original transparent game FX sprite atlas. Exact 2×2 quadrants on true transparent background, one centered distinct hand-painted example occupying interior 70 percent of each quadrant with clear padding all around. Upper left warm grey curled dispersing smoke puff. Upper right muted warm brown gritty dust plume. Lower left thin bright ochre ember sparks radiating around a central transparent spot. Lower right chalk-white subtle paint-edged circular pressure wave with empty center. Painterly slightly scratchy RTS artwork, effects and transparency only, no text, dividers, squares, opaque background, characters or scenery.
```

### `optical-coating.png`

```text
Original game material source, square full-bleed tileable orthographic scan, flat diffuse light, no directional shadows or specular lighting, no perspective, no logos or writing. Original hand-painted strategy game textures with broad brushwork, natural wear and legible mid-scale shapes. Seamless repeating opposite edges. A faint smoky petrol-blue and aqua interference coating on technical optical glass, no mirror reflections. Muted cool nearly clear charcoal blue, delicate tonal striations, faint mottling in thin coatings, center clean. No lens shape, round frames, concentric rings, caustic flashes, machined hardware, or text. Used as subtle masked tint.
```
