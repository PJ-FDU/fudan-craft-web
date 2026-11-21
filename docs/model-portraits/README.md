# 二维单位与建筑图标

78 个图标基于现有游戏模型绘制，覆盖工业联邦 24 个、生群 18 个、星能 17 个、远行者 19 个。远行者包含装配站的收拢形态。

- [图标预览](preview.jpg)
- [档案与生产面板实机截图](in-game.jpg)
- [透明 WebP 图集](../../public/assets/generated/model-portraits-v2.webp)
- [9 张内置 ImageGen 源图](sources/)

档案、生产与建造卡、选中头像和生产队列共用同一张图集。源图以 `scripts/bake-model-portraits.ts` 从 3D 模型渲染的轮廓、材质和视角作为参考。`src/game/model-portraits.ts` 规定每张源图的对象顺序。

安装 Pillow 和仓库的 Node 依赖后，运行 `python3 scripts/build-model-portraits.py` 重新打包。脚本以源图透明通道定位完整轮廓，将每个图标裁入带透明边距的 224 × 224 格子。

## ImageGen 提示词

### 工业联邦与护航营地

每张图的提示词由通用提示和对应源图的补充描述组成。

通用提示

```text
Use case: stylized-concept. Create a premium, hand-finished 2D painted isometric game icon atlas based on Image 1, an exact grid-order, silhouette, and color reference of original RTS models. Match one whole, distinct subject to each occupied reference cell. Preserve its proportions, major components, viewpoint and subtype, and enhance it with believable construction, clean edge highlights, weathered materials, readable lit/dark grouping, fine small-scale details and a warm upper-left key with cool rim light. The simplified modeling in the reference is a shape guide; reinterpret the surface quality with realistic illustrated detail. Precisely 3x3 equal square cells in the same row and column order. Each centered full object must stay at least 9% inside its cell. Transparent alpha cutouts with generous clear space, no ground shadows, no base unless integral to reference, no scenery, no type or labels, no borders, no color blocks and no checkerboard.
```

#### industrial-units

```text
Industrial Federation precision equipment in blue-grey and muted slate steel with restrained olive green unit markings. Top row: four-wheel harvest truck with two amber clamshell gripper arms and a blue cab; full-body faceless white-blue armored rifleman with horizontal dark visor; compact four-wheel scout buggy with low forward turret, pale blue body and olive panels. Middle row: full-body white-armored medic with small red medical markings and compact medical gear; full-body hooded olive-dark sniper with a long precision weapon and draped cloak; tracked heavy main battle tank with bulging two-sided turret armor and a long central barrel. Bottom row: tracked elevated artillery carrier with open tall support cradle and one long cannon; pale slate flying VTOL with a blue cockpit, swept pale gray wings, two big green-gray outboard engines and two rear stabilizers; hulking Titan bipedal blue-grey and olive steel mech, broad shoulders, inset visor head, right forearm barrel, armored left forearm and slab feet. Retain all nine unique occupants and source ordering.
```

#### industrial-buildings

```text
Industrial Federation installations, blue-gray steel and concrete, oxidized dark machinery, green unit accents. Top row: wide heavy command center with a roof antenna and frontal entry; low gabled barracks with green detailing; angular large vehicle factory with two tall dorsal exhaust stacks and vehicle bay door. Middle row: flat aircraft hangar with runway apron; paired round refinery tank units connected by industrial pipe; laboratory with capped large cool glass dome and antenna. Bottom row: gabled lumbermill with stacked raw logs; paired slightly offset power generators topped with energized housings; small round armored turret tower with twin forward barrels. Use the actual orientation, architectural volumes and mounting platforms in the reference.
```

#### industrial-support

```text
The first six pieces wear industrial blue-grey steel with restrained green accents. The seventh is the ochre and canvas Expedition shelter in the source. Top row: full-body compact dark-coated tactical commander with cap, gold shoulders and handheld small blue tablet; armored tracked electronic jammer vehicle with upright rectangular electronic array; isolated oil pumpjack mounted to a low foundation. Middle row: low cluster of blue-gray cargo containers and a few service drums; off-white medical facility with two small red medical symbols and central entrance; squat blue-grey command post with front vestibule and a large roof antenna array. Bottom row: left cell only, the desert canvas escort depot with sand-colored field shelter, cargo boxes and slim antenna. Center and right cells remain completely empty.
```

### 生群、星能和远行者

每张图的提示词由通用提示和对应源图的补充描述组成。

通用提示

```text
Use case: stylized-concept. Create a production-quality 2D game-inventory portrait atlas of the supplied original RTS models. Image 1 is a shape, palette, and exact grid-order reference. Redraw each occupied position as a distinct premium hand-finished painted isometric game icon. Match the object identity, overall silhouette, proportions, major components, three-quarter viewpoint, and faction accent color of its own reference cell. Add credible construction, surface wear, hand-painted rim highlights, detailed materials, and clean readable high-contrast edges. Use a soft warm upper-left key and cool edge light. Each full object should read immediately at 32px. Render exactly a 3 by 3 array at the same equal square cell positions, their center points at 1/6, 1/2, 5/6 of width and height. Leave any empty reference cell empty. Keep all the visible parts at least 9% inside their cell borders with generous transparent space around silhouettes. Fully isolated alpha cutouts, real transparency, no backdrop, no shadows on ground, no supporting platforms unless integral to the existing model, no perspective background, no frames, no borders, no typography, no labels, no graphic marks or borders. Do not print a checkerboard. The reference is simplified geometry, not a fidelity target. Keep subject poses and proportions, paint high quality textures and fine structural details.
```

#### brood-units

```text
Rust-brown chitin, amber nutrient sacs, maroon tendons, ivory keratin. Order left to right, top to bottom: small four-legged claw harvester, light long-clawed broodling, raised-throat spitter; large four-legged horned behemoth, organic flying winged creature, low walking round amber supply sac; spined nurturer with curved back plates, bulbous twin-sac infector, wiry long-limbed binder.
```

#### brood-buildings

```text
Ancient organic alien colony, dark brown keratin and blood-warm tissue with amber chambers. Use each building's specific arrangement in the source, preserving the proportions between its shell, horns and sacs. Order: command core, refinery with three sacs on top, living lumbermill; tall defense growth with forward upper structure, narrower extraction growth, layered hatchery; low nursery with a ring of embryos, stalked gland building, low spiny burrow.
```

#### stellar-units

```text
Deep petrol-blue ceramic armor, slate blue alloy, slender brass inlays, blue-cyan crystal power, keep all primary surfaces blue and no white primary armor panels. Order: utility harvester with two forward manipulators, long twin prongs of lancer, forward focus housing prism; articulated four-legged colossus, swept star-wing flying ship, weaver support craft; guide sensor, arbiter energy controller, transparent empty ninth cell.
```

#### stellar-buildings

```text
Deep petrol-blue armor, slate blue secondary alloy, small warm brass inlays, sharply readable blue-cyan crystal, no white primary armor panels. Order: command center, twin chamber refinery, horizontal lumbermill; gun tower, narrow extraction post, crystal supply node; resonator worksite, large split ring warp portal, phase sanctum. Keep ring halos part of the reference where visible with thin restrained glow.
```

#### relay-units

```text
Weathered muted desert brass, canvas khaki, charcoal frames, muted green badges. Order: utility loader vehicle with forward implement, full-body line ranger infantry with long coat and field kit, four-wheel flank runner with open frame; six-wheel flak carrier with paired mounts, swept roaming wing flying craft, full-body pathfinder combat engineer with back tool frame; full-body observation infantry with hood/sensors, six-wheel escort communications van, folded assembly transport truck.
```

#### relay-buildings

```text
Practical desert expedition engineering in khaki canvas, subdued bronze fittings and olive-grey metal. Preserve open negative space and readable structural silhouettes. Order: front-line command base, paired refinery tanks with tent, wheeled lumbermill shelter; armed tower with elevated mount, pump and support framework, deployed gantry assembly station; tall signal relay mast with dish, route post shelter, tripod radar observatory.
```
