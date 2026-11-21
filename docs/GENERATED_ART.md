# Expedition 2 素材生成记录

使用内置 imagegen 图片生成工具，生成后原样复制到 `public/assets/generated/`。单位、建筑与环境保留工具生成的 alpha 通道；地表为不透明材质图。渲染器直接按等分网格采样图集，不需要外部图片服务。

- `units-v2.png`：3×3，9 类单位。
- `buildings-v2.png`：3×3，9 类建筑。
- `nature-v2.png`：4×4，16 类自然与资源物件。
- `terrain-v2.png`：2×2，草地、泥土、岩石、沙地。

下列为实际使用的英文提示词，统一采用手绘 2.5D、俯视正交相机、左上方光源、象牙白 / 石墨金属 / 青绿点缀。

## units

Use case: stylized-concept.
Asset type: production-ready RTS GAME UNIT SPRITE ATLAS, square PNG with actual transparent background.
Create ONE precisely aligned 3 by 3 sprite sheet, nine distinct isolated game units, ONE unit per equal square cell. No drawn grid, no text, no labels. Each cell has generous transparent padding on all four sides; every complete unit fits entirely within its cell, no overlap. Unit bases centered exactly in each cell. Read left to right, top to bottom:
Row 1: compact engineering HARVESTER ROVER with mechanical arms and rear cargo bin; elite armored RIFLE INFANTRY soldier carrying rifle; fast six-wheeled SCOUT BUGGY with light turret.
Row 2: field MEDIC in white armor carrying glowing teal medical pack; cloaked SNIPER with long precision rifle; powerful heavy tracked SIEGE TANK with large cannon.
Row 3: mobile ARTILLERY tracked howitzer with long deployed barrel; aerodynamic twin-engine VTOL FIGHTER aircraft; imposing bipedal HEAVY ASSAULT MECH with two weapon arms.
Style: exquisite richly detailed hand-painted 2.5D real-time-strategy sprites, sophisticated readable silhouettes, sculpted hard-surface forms, realistic stylized materials, fine highlights, strong coherent lighting from upper left. Think polished modern indie RTS concept illustration rendered as usable sprites, not blurry concept sketches and not chunky pixel art. Orthographic three-quarter aerial camera, looking down at 50 degrees, every unit facing toward lower right, identical camera and visual style. Ivory ceramic and dark graphite metal, subtle desaturated jade/teal team accents, warm brass details, tiny amber power lights. Soldiers remain substantial and readable in their cells, vehicles fill a similar cell area. Very subtle contact shadow only under each individual asset. TRANSPARENT background all over, including margins and gaps. No terrain, no pedestal, no scenery, no UI, no watermarks, no typography. High fidelity game art, crisp clean alpha edges. Exactly nine separate units, 3 rows x 3 columns, orderly equal cells.

## buildings

Use case: stylized-concept. Asset type: one production-ready transparent PNG RTS BUILDING SPRITE ATLAS. Precisely aligned 3 columns by 3 rows, exactly nine separate complete structures, ONE building centered per equal square cell; wide transparent gutters and padding; nothing crosses a cell boundary. No labels, no typography, no grid lines.
Read left-to-right top-to-bottom:
Row 1: COMMAND HEADQUARTERS with imposing control tower and satellite array; BARRACKS with armored doors and training courtyard; VEHICLE FACTORY with gantry crane and open heavy machinery bay.
Row 2: AIRCRAFT HANGAR with folded hangar doors and small landing platform; OIL REFINERY with pipes, bronze storage tanks and distillation columns; SCIENCE RESEARCH LAB with luminous jade glass reactor dome and antenna.
Row 3: LUMBER MILL with piles of sawn logs, small sawmill conveyor and storage shed; ADVANCED POWER PLANT with glowing teal reactor coils; COMPACT DEFENSIVE TURRET with armored rotating twin gun.
Art direction: exquisite premium hand-painted 2.5D sci-fi real time strategy game art. NOT pixel art, NOT a UI mockup. Camera is the same orthographic three-quarter aerial view looking down 50 degrees for ALL buildings, front sides face toward bottom right. Consistent upper-left sunlight, extremely clean readable silhouettes, fine sophisticated realistic-stylized metal and concrete textures, ivory ceramic panels, dark graphite structure, muted jade/teal team stripe, bronze details, tiny warm amber lights. Carefully designed appealing architecture with strong function distinction. Each entire building including all protrusions and its small foundation fits INSIDE its equal 1/3-width 1/3-height cell, roughly 76% of cell dimensions. Real alpha transparency surrounding every asset and between all rows and columns. No terrain backgrounds, no extra buildings, no black/white matte, no captions, no watermark. Exactly 9 objects, precisely spaced 3x3 layout.

## nature

Use case: stylized-concept. Asset type: ONE premium hand-painted RTS ENVIRONMENT SPRITE ATLAS with genuine alpha transparency. A precisely aligned FOUR columns by FOUR rows layout, sixteen distinct isolated objects. ONE object centered in each equal rectangular cell, all complete and generously padded so no object crosses its cell boundary. No visible grid. No words, numbers, labels, UI, border or watermark.
Exact row-major order, left to right:
Row 1: tall lush dark-green PINE TREE; broad rounded OAK TREE with mossy roots; delicate silver BIRCH TREE; richly layered GREEN BUSH.
Row 2: small GREY ROCK cluster; large moss-covered BOULDER; weathered RUIN COLUMN with climbing plants; small tranquil TURQUOISE POND with complete organic grassy shore edge, shallow pebbles and subtle water ripples.
Row 3: GOLD ORE DEPOSIT with chunky warm metallic gold crystals embedded in charcoal rock; harvestable WOOD GROVE, three compact trees and felled logs as ONE resource cluster; BLACK OIL SEEP with tiny bronze survey pump, dark oily pool and stones as ONE resource cluster; rough LOG PILE.
Row 4: scattered WILD GRASS tuft; small yellow WHITE WILDFLOWER clump; old TREE STUMP with moss; lush FERN with tiny mushrooms.
Art direction: exquisite cohesive high-detail hand-painted 2.5D strategy-game assets, overhead orthographic three-quarter camera looking down about 50 degrees, clean readable silhouettes, beautifully rendered natural materials, upper-left soft sunlight, deep muted emerald greens, warm moss, grey slate, subtle gold and teal accents. Match refined realistic-stylized sci-fi RTS art, not chunky pixel art and not photorealistic isolated product photography. No large terrain base squares or pedestals; only the tiny natural contact soil under each object. All gaps and margins MUST be fully transparent, not painted scenery. Each object centered in its exact cell. Pond fits fully inside cell including complete shore border. Exactly 16 objects in 4x4 order.

## terrain

Use case: stylized-concept. Asset type: ONE production RTS TERRAIN TEXTURE ATLAS, exactly 2 columns by 2 rows, filled edge-to-edge, no labels, no borders, no objects.
Four perfectly square quadrants with exact midline boundaries:
top left: rich desaturated emerald meadow grass ground with fine short grass and moss, subtle organic color variation;
top right: warm brown packed dirt footpath soil with fine scattered gravel;
bottom left: muted grey slate rocky ground with cracks and lichen;
bottom right: dry beige sand and fine pebbles.
Each quadrant is a flat top-down seamless repeatable material texture. NO trees, no plants above ground, no structures, no shadows from objects, no isometric perspective, no horizon. Beautiful premium hand-painted realistic-stylized strategy game terrain, fine detail that works under tiny game units, soft diffuse overhead daylight, sophisticated subdued natural palette, consistent scale. The grass is deep muted green, NOT bright neon. Dirt is earthy ochre brown, not black. Avoid dramatic clumps, focal elements, perspective, gradients to edges, vignette, grid lines or writing. Each texture fills its own exact 50% width / 50% height quadrant without any gaps. Square image.

## Three.js 战场材质

`public/assets/generated/battle-materials.webp` 是用内置 imagegen 生成的原创 4×4 手绘材质图集。模型 UV 和地表着色器共享格子布局，分别采样装甲、建筑、植被、岩石、资源与地表。图集使用 WebP 编码，运行时约 442 KiB。

```text
Use case: stylized-concept
Asset type: ORIGINAL hand-painted UV texture atlas for FudanCraft, an isometric industrial RTS. Production game asset, strictly a flat image of material swatches, no 3D objects or perspective.
Composition: Square edge-to-edge image, an EXACT 4 columns × 4 rows regular grid, all 16 cells precisely same width and height, boundaries at exactly 25%, 50%, 75%. Touching cells with zero spacing. No text, annotation, borders, frames, watermark, shapes that span cells, no transparency.
Each cell fills its entire rectangle with surface detail. Paint with strong, broad shapes that remain legible at 40 pixels, brushwork, restrained chipped edges, hand brushed tonal variation and cool dark recesses. A premium turn-of-the-century painterly strategy-game aesthetic with stylized believable industrial materials. Original design, no existing game assets. Colors somewhat desaturated with deep shadows, warm highlights, never blown-out white. Bake enough local contrast to read at a distance; broad panels rather than monotonous fine noise. Each cell acts as a flat 2D material, completely front-on.
Exact grid reading left to right, top to bottom:
Row 1: (1) weathered pale greige painted armor panels with a broad diagonal division, dark recesses, patches and scratches; (2) charcoal teal painted industrial alloy wall with two inset vent regions and vertical recessed seams; (3) dark graphite rubber tank treads with repeated diagonal treads and dusty edges; (4) desaturated bluish smoked glass with broad asymmetrical diagonal blue reflections.
Row 2: (1) sandy oxide concrete foundation with chamfer-worn slab joints and grime; (2) desaturated verdigris teal technology roof plates with two broad flat panels, indented cooling vents, rivets, weathered rims; (3) warm gray-green eroded stratified rock with gentle moss touches, no loose objects; (4) weathered pale gray neutral painted military accent plate with dark seams, border scuffs, grungy edge, no colored stripes (team color is tinted in software).
Row 3: (1) dark jade pine canopy, hand-painted dense layered overlapping short pine sprays and fine clusters, only texture; (2) oak leaves and masses of thick foliage, moss greens with bursts of warm olive, no transparent gaps; (3) deeply grooved reddish brown bark shaded in ochre and deep umber wood grain; (4) warm amber mineral ore with irregular veins, gold facets and ochre crystals along fine faults.
Row 4: (1) hand-painted green ground of uneven grass and soft moss, painted patches of sage and mint, dye-dark crevices, top-down natural scatter, occasional small stones; (2) top-down warmth of packed rocky ochre-brown dirt path with subtle pebbles and rocks, earth and dark runoff marks; (3) navy teal shallow lake water with a few broad green-blue ripples and foam accents, no objects; (4) weathered neutral taupe cloth with worn stitching lines and slight weave.
Ensure no gaps, labels, or grid borders. The result must fit exact UV quadrants.
```

## 单位部件材质和骨骼

`public/assets/generated/unit-materials.webp` 由内置 imagegen 生成。16 个材质格覆盖头盔、胸甲、织物、履带、炮管和机械关节。Three.js 将战场和单位图集装入同一张 GPU 纹理。九类移动单位共享各自的网格，每个实例使用独立的骨骼；护甲板随所属关节刚性变换，膝、肘和腰部织物采用两骨骼混合权重。

```text
Use case: stylized-concept
Asset type: production 2D UV detail texture atlas for FudanCraft's original isometric far-future industrial RTS miniatures. Square EXACT 4 by 4 regular grid, edges at 25%, 50%, 75%. Sixteen full-bleed flat material swatches, zero gutters or overlap, no writing, no diagram or perspective. The entire image is material art, never a scene or rendered object.
Art direction: hand-painted early-2000s-style strategy-game material art with carefully shaded edges and strong medium-scale forms. Cool graphite and patina, weathered warm ivory with muted teal-gray recesses. Brush strokes, bevel highlights, quiet wear, crisp but restrained deliberate details. Keep the center of each cell readable at a distance. Material color varies naturally, no vignette across the full atlas.
Grid row-major left to right:
Row 1: (1) ivory combat helmet shell surface, sweeping narrow dark slate insets and scuffed curved seam, no actual helmet silhouette; (2) layered desaturated ivory chest armor surface, overlapping trapezoid metal plates with recessed perimeter and two fine screws; (3) pale scratched shin and shoulder guard shell surface with a restrained inset beveled ridge and edge wear; (4) dark desaturated olive synthetic undersuit material, diagonal quilted panels with reinforced ribbed seams.
Row 2: (1) worn warm ivory scout vehicle deck plating with broad recessed seam and tiny recessed bolts; (2) black-brown metal wheel or tank tread surface with repeated large grippy bars and dusty rims; (3) oxidized teal industrial engine grille with large stepped slats, dark recesses and edge bolts; (4) pale gray swept aircraft wing skin with diagonal panel lines, tiny rigid fasteners and warm edge scratches.
Row 3: (1) graphite green large mech armored panel with exposed facet edges, weathered olive-gray paint and a small diagonal band of midtone exposed alloy; (2) machined bronze and graphite hydraulic cylinder material, narrow lengthwise metal ridges, rubbed polished facets, copper oil residue; (3) muted ivory enamel service equipment with warm rust-red painted stripe and a worn cream surround, no symbols; (4) dark weathered green-gray tightly woven reconnaissance canvas with one broad stitch line.
Row 4: (1) polished deep desaturated blue glass optical coating with soft asymmetric turquoise highlights, no circles; (2) brushed dark charcoal firearm-like fictional sci-fi equipment housing material with broad lengthwise grooves and steel at the edges; (3) two broad diagonally painted ochre industrial hazard stripes across gray heavily worn plating, no text; (4) graphite exhaust shielding with oxidized bronze heat gradients and engine vents.
Every cell edge aligns exactly with the 4×4 grid and is completely filled. No logos, letters, arrows, frames, leaders, symbols or grids inside or outside the work. Original surface designs.
```

## 远征主菜单场景

主菜单封面是为本项目生成的 1368 × 768 JPEG，存放在 `public/assets/generated/title-expedition.jpg`。开发和生产页面优先从同源加载 WebP，视口不超过 900 CSS 像素时使用 880 × 495 的轻量版本。JPEG 作为兼容来源。

原始提示词：

```text
Cinematic key art for an original military science fiction strategy game, wide establishing shot, massive weathered expedition combat mech and an armoured commander in the right foreground standing on moss covered ancient jungle ruins, a tracked battle tank on the right midground, monumental abandoned stone temple arches and distant military outpost silhouettes in the background, early morning warm sunlight shafts through dense atmospheric mist, deep forest green, charcoal, muted bronze and ivory colour palette, photorealistic physically based rendering, intricate scratched metal and stone surfaces, epic scale, filmic contrast, sophisticated AAA game promotional artwork, subjects occupy the right two thirds, left third is calm dark atmospheric negative space for a game title and main menu, 35mm lens, subtle film grain, no text, no logos, no UI, no borders, no collage
```
