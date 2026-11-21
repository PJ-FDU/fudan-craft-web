# 八方向单位素材

最终素材均通过内置 imagegen 生成和编辑，保持 RGBA 透明通道。步兵 / 采集车 / 医疗兵图集另移除了图像烘焙的黑色脚底阴影，由渲染器统一绘制柔和阴影。

使用内置 imagegen 工具，以 `public/assets/generated/units-v2.png` 为造型参考，重新生成了三张 2048×768、8 列×3 行的 RGBA 图集，共九类单位×八个视角。实际渲染按照移动、采集和攻击朝向选择图像；没有在画布平面内旋转单张图来代替视角。

列顺序：东、东南、南、西南、西、西北、北、东北。每格 256×256，透明留白保留完整轮廓。

- `public/assets/generated/directions-support-v3.png`：采集车、步兵、医疗兵。
- `public/assets/generated/directions-vehicles-v3.png`：侦察车、坦克、火炮。
- `public/assets/generated/directions-advanced-v3.png`：狙击手、战机、机甲。

`src/game/art.ts` 定义行映射；`src/game/camera.ts` 提供八方向量化、最短转角与切换滞回；`renderer.ts` 使用朝向缓存和位置插值。原 v2 图集继续用于界面头像。

下列为实际提示词。高级单位图集另经一次背景移除编辑，保留八方向布局与透明边缘。

## directions-support-v3.png

Use case: stylized-concept. Create a NEW production-ready RTS EIGHT-DIRECTION unit sprite atlas based on the supplied appearance reference. The reference image is ONLY the character/vehicle and art-style reference; do NOT preserve its 3x3 layout. Preserve each unit's identity, colors, silhouette, weapons, and materials.
MANDATORY OUTPUT GEOMETRY: wide 8 COLUMNS × 3 ROWS, exactly 24 individually isolated complete sprites. Image aspect ratio 8:3, ideally 3072x1152. All 24 cells are exactly equal squares. Every full sprite fits within the central 76% of its cell, with generous fully transparent gutters. No overlap, no cropping, no text, labels, drawn grid, arrows or UI.
ROW 1: the engineering harvester rover (reference top-left). ROW 2: the armored rifle infantry (reference top-center). ROW 3: the white field medic with green medical pack (reference middle-left).
In EVERY row the eight columns are the SAME unit physically turned in 45-degree steps on the horizontal ground plane, in THIS EXACT ORDER:
1 EAST: facing screen RIGHT, showing right-facing profile.
2 SOUTH EAST: facing diagonally toward screen BOTTOM RIGHT.
3 SOUTH: facing toward screen BOTTOM, frontal view, see its front.
4 SOUTH WEST: facing diagonally toward screen BOTTOM LEFT.
5 WEST: facing screen LEFT, left-facing profile.
6 NORTH WEST: facing diagonally toward screen TOP LEFT, rear three-quarter view.
7 NORTH: facing toward screen TOP, see the unit's BACK.
8 NORTH EAST: facing diagonally toward screen TOP RIGHT, rear three-quarter view.
CRITICAL: these must be eight distinct true 3D yaw viewpoints of a volumetric unit, NOT a flat sprite simply spun in the image plane, NOT eight copies of the same view. Feet and tracks stay on the ground, bodies always upright in the image. Camera stays fixed at orthographic three-quarter elevated RTS angle, about 50 degrees down, with consistent world lighting from upper left. A north-facing soldier shows backpack and back of head; south-facing shows face/front. Vehicles point their nose and weapons in the specified direction. Do not place a hero title or unused rows.
Art: match the supplied exquisitely detailed hand-painted 2.5D sci-fi units, ivory ceramic armor, graphite metal, muted jade/teal details, amber small lights, refined clean silhouettes and realistic stylized textures. Not chunky pixel art. Consistent pose, scale and ground contact anchor throughout each row. Three rows should be vertically aligned identically at exactly thirds of image height. TRUE ALPHA TRANSPARENCY everywhere except the sprites and subtle contact shadows. No scenery or painted backdrop. Exactly 8 columns and 3 rows.

## directions-vehicles-v3.png

Use case: stylized-concept. Create a NEW production-ready RTS EIGHT-DIRECTION unit sprite atlas based on the supplied appearance reference. The reference image is ONLY the character/vehicle and art-style reference; do NOT preserve its 3x3 layout. Preserve each unit's identity, colors, silhouette, weapons, and materials.
MANDATORY OUTPUT GEOMETRY: wide 8 COLUMNS × 3 ROWS, exactly 24 individually isolated complete sprites. Image aspect ratio 8:3, ideally 3072x1152. All 24 cells are exactly equal squares. Every full sprite fits within the central 76% of its cell, with generous fully transparent gutters. No overlap, no cropping, no text, labels, drawn grid, arrows or UI.
ROW 1: the six-wheeled scout buggy (reference top-right). ROW 2: the heavy tracked siege tank (reference middle-right). ROW 3: the tracked long-barrel artillery howitzer (reference bottom-left).
In EVERY row the eight columns are the SAME unit physically turned in 45-degree steps on the horizontal ground plane, in THIS EXACT ORDER:
1 EAST: facing screen RIGHT, showing right-facing profile.
2 SOUTH EAST: facing diagonally toward screen BOTTOM RIGHT.
3 SOUTH: facing toward screen BOTTOM, frontal view, see its front.
4 SOUTH WEST: facing diagonally toward screen BOTTOM LEFT.
5 WEST: facing screen LEFT, left-facing profile.
6 NORTH WEST: facing diagonally toward screen TOP LEFT, rear three-quarter view.
7 NORTH: facing toward screen TOP, see the unit's BACK.
8 NORTH EAST: facing diagonally toward screen TOP RIGHT, rear three-quarter view.
CRITICAL: these must be eight distinct true 3D yaw viewpoints of a volumetric unit, NOT a flat sprite simply spun in the image plane, NOT eight copies of the same view. Feet and tracks stay on the ground, bodies always upright in the image. Camera stays fixed at orthographic three-quarter elevated RTS angle, about 50 degrees down, with consistent world lighting from upper left. A north-facing soldier shows backpack and back of head; south-facing shows face/front. Vehicles point their nose and weapons in the specified direction. Do not place a hero title or unused rows.
Art: match the supplied exquisitely detailed hand-painted 2.5D sci-fi units, ivory ceramic armor, graphite metal, muted jade/teal details, amber small lights, refined clean silhouettes and realistic stylized textures. Not chunky pixel art. Consistent pose, scale and ground contact anchor throughout each row. Three rows should be vertically aligned identically at exactly thirds of image height. TRUE ALPHA TRANSPARENCY everywhere except the sprites and subtle contact shadows. No scenery or painted backdrop. Exactly 8 columns and 3 rows.

## directions-advanced-v3.png

Use case: stylized-concept. Create a NEW production-ready RTS EIGHT-DIRECTION unit sprite atlas based on the supplied appearance reference. The reference image is ONLY the character/vehicle and art-style reference; do NOT preserve its 3x3 layout. Preserve each unit's identity, colors, silhouette, weapons, and materials.
MANDATORY OUTPUT GEOMETRY: wide 8 COLUMNS × 3 ROWS, exactly 24 individually isolated complete sprites. Image aspect ratio 8:3, ideally 3072x1152. All 24 cells are exactly equal squares. Every full sprite fits within the central 76% of its cell, with generous fully transparent gutters. No overlap, no cropping, no text, labels, drawn grid, arrows or UI.
ROW 1: the cloaked sniper with long rifle (reference middle-center). ROW 2: the twin-rotor VTOL fighter (reference bottom-center). ROW 3: the large bipedal heavy assault mech (reference bottom-right).
In EVERY row the eight columns are the SAME unit physically turned in 45-degree steps on the horizontal ground plane, in THIS EXACT ORDER:
1 EAST: facing screen RIGHT, showing right-facing profile.
2 SOUTH EAST: facing diagonally toward screen BOTTOM RIGHT.
3 SOUTH: facing toward screen BOTTOM, frontal view, see its front.
4 SOUTH WEST: facing diagonally toward screen BOTTOM LEFT.
5 WEST: facing screen LEFT, left-facing profile.
6 NORTH WEST: facing diagonally toward screen TOP LEFT, rear three-quarter view.
7 NORTH: facing toward screen TOP, see the unit's BACK.
8 NORTH EAST: facing diagonally toward screen TOP RIGHT, rear three-quarter view.
CRITICAL: these must be eight distinct true 3D yaw viewpoints of a volumetric unit, NOT a flat sprite simply spun in the image plane, NOT eight copies of the same view. Feet and tracks stay on the ground, bodies always upright in the image. Camera stays fixed at orthographic three-quarter elevated RTS angle, about 50 degrees down, with consistent world lighting from upper left. A north-facing soldier shows backpack and back of head; south-facing shows face/front. Vehicles point their nose and weapons in the specified direction. Do not place a hero title or unused rows.
Art: match the supplied exquisitely detailed hand-painted 2.5D sci-fi units, ivory ceramic armor, graphite metal, muted jade/teal details, amber small lights, refined clean silhouettes and realistic stylized textures. Not chunky pixel art. Consistent pose, scale and ground contact anchor throughout each row. Three rows should be vertically aligned identically at exactly thirds of image height. TRUE ALPHA TRANSPARENCY everywhere except the sprites and subtle contact shadows. No scenery or painted backdrop. Exactly 8 columns and 3 rows.

## 支援单位脚底阴影清理

Use case: precise-object-edit. Production game sprite sheet cleanup. EDIT ONLY the opaque black oval ground shadows beneath the 24 sprites in this 2048x768 RGBA atlas: remove every painted ground/contact shadow, black ellipse and black pedestal completely to true zero-alpha transparency. Keep the actual wheels, boots, bodies, backpacks, armor, weapons and all sprite pixels intact. Preserve every sprite's exact location, facing, silhouette, scale, color and detail. Preserve exact 8 equal columns by 3 rows and the same 2048x768 canvas size. Background stays fully transparent. Do not regenerate or redesign characters, do not add any shadows, do not move or crop anything. The game renderer will supply its own subtle procedural shadows, so no image-baked shadow may remain beneath any sprite. Keep dark parts belonging to boots and wheels; only remove painted shadows outside their silhouettes.

## 高级单位透明背景修正

Use case: background-extraction. EDIT the supplied eight-direction sprite sheet: remove ONLY the white background to genuine full alpha transparency (RGBA), including all white space between sprites and every outer margin. This is a production game sprite atlas. Keep every one of the 24 sprites unchanged: identical pixel placement, scale, orientation, appearance, 8 columns by 3 rows, exact 2048x768 canvas, identical object silhouettes and fine details. Preserve sniper cloak ivory cloth and aircraft ivory metal, do not mistake those for background. Preserve subtle semitransparent contact shadows, but no white matte or halo. Do not add, remove, move, crop, rearrange, redraw or rotate any sprite. The resulting image must have truly zero-alpha empty gaps; a white-painted or checkerboard-painted background is unacceptable.
