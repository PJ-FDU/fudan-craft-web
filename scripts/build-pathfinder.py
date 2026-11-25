"""远行中继 · 路线工兵（Pathfinder）：2K PBR 野战工程外骨骼 + 双气罐管线背包 + 16 骨双手工程焊枪/勘探仪 IK + 100% 刚性光追。

重点解决旧版短板：
- 彻底去除“光滑圆蛋头盔与圆角塑料玩具甲”，改为棱角硬朗的野战工程安全盔（带防护滚杠格栅、侧置工程强光探照灯与降噪耳罩）；
- 增加 45° 黑黄工业警示斜纹贴花、铆接护胸散热栅、双联压力焊接气罐、编织软管与路线地钉挂载架；
- 升级 16 骨独立工程作业具（双手等离子焊枪／路线测绘仪）+ 双手解析 IK（pathfinderGrip）。
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mathutils import Matrix

from hero_humanoid_kit import HeroBuilder, parse_hero_args, point

PALETTE = {
    "armorSand":  ((.67, .55, .36), .40, .20, "plate", {"tex": "ceramic", "scale": .16, "albedo_amp": .15, "bump_strength": .045}),
    "armorOchre": ((.52, .42, .27), .44, .24, "plate", {"tex": "ceramic", "scale": .18, "albedo_amp": .16, "bump_strength": .050}),
    "suitOlive":  ((.25, .28, .22), .80, .05, "fabric", {"tex": "ripstop", "scale": .32, "albedo_amp": .20, "bump_strength": .12}),
    "pouchCanvas":((.44, .38, .28), .84, .03, "fabric", {"tex": "canvas", "scale": .26, "albedo_amp": .20, "bump_strength": .14}),
    "metalDark":  ((.17, .20, .23), .42, .68, "metal", {"tex": "gunmetal", "scale": .22, "albedo_amp": .16, "bump_strength": .048}),
    "steel":      ((.52, .57, .60), .28, .86, "metal", {"tex": "gunmetal", "scale": .24, "albedo_amp": .14, "bump_strength": .034}),
    "tankSlate":  ((.26, .33, .39), .36, .58, "metal", {"tex": "gunmetal", "scale": .22, "albedo_amp": .16, "bump_strength": .040}),
    "rubber":     ((.09, .095, .095), .86, .00, "rubber"),
    "glove":      ((.20, .17, .14), .66, .06, "rubber"),
    "recess":     ((.03, .035, .04), .68, .28, "metal"),
    "visorAmber": ((.58, .32, .06), .12, .24, "glass"),
    "team":       ((.74, .76, .74), .42, .20, "team"),
    "lamp":       ((.96, .84, .38), .18, .05, "lamp"),
    "plasmaLamp": ((.28, .92, .98), .16, .05, "lamp"),
    "hazard":     ((.82, .58, .14), .42, .16, "plate", {"mode": "uv_direct", "tex": "hazard", "repeat": True, "scale": 1.0}),
}


def build_pathfinder(b: HeroBuilder):
    # 1) 重型工兵双腿：钢头重型工兵靴、防撕裂作业裤、外骨骼侧连杆、护膝与护胫甲
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        leg, knee, foot = side + "Leg", side + "Knee", side + "Foot"
        b.build_industrial_boot(side, s, foot, shell="armorSand", dark="metalDark",
                                mid="armorOchre", rubber="rubber", steel="steel", scale=1.00)

        b.anatomical_loft(f"{side} Shin work pant", [
            (-7.8, -s * .20,  .06, 1.88, 1.88, 1.98, 1.96),
            (-5.2, -s * .16, -.10, 2.08, 2.08, 2.12, 2.30),
            (-2.6, -s * .10, -.12, 2.24, 2.24, 2.22, 2.40),
            ( .15, -s * .05,  .00, 2.20, 2.20, 2.24, 2.18),
        ], knee, "suitOlive", phase=i * 1.4, wrinkle_amp=.022)

        def shin_armor(u, v, high, side_s=s):
            ang = (u - .5) * 2.35
            y = -6.95 + v * 5.85
            rx = 2.12 + .22 * math.sin(v * math.pi)
            rz = 2.12 + .25 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (-side_s * .12 + nx * rx, y, .22 + nz * rz), (nx, 0, nz)

        b.curved_shell(f"{side} Exo shin plate", shin_armor, 12, 6, 24, 12, .36, "armorSand", knee, bevel=.04)
        # 外部工兵外骨骼支撑液压杆
        b.cylinder(f"{side} Shin exo strut", (s * 2.35, -6.85, -.15), (s * 2.42, -.35, -.15), .28, "steel", knee, .04, 12)
        b.box(f"{side} Shin clamp upper", (s * 2.35, -1.65, -.15), (.68, .92, 1.25), "metalDark", knee, .08)
        b.box(f"{side} Shin clamp lower", (s * 2.35, -5.85, -.15), (.68, .92, 1.25), "metalDark", knee, .08)

        # 厚重铆接工程护膝
        b.box(f"{side} Heavy kneecap", (-s * .06, -.05, 2.35), (3.45, 2.45, 1.35), "metalDark", knee, .22)
        b.box(f"{side} Kneecap bumper", (-s * .06, -.05, 3.05), (2.45, 1.45, .36), "armorOchre", knee, .08)

        b.anatomical_loft(f"{side} Thigh work pant", [
            (-8.5, -s * .05,  .00, 2.22, 2.22, 2.28, 2.22),
            (-5.4, -s * .04,  .14, 2.55, 2.48, 2.72, 2.54),
            (-2.2,  s * .04,  .12, 2.82, 2.62, 3.00, 2.78),
            ( .50,  s * .12,  .02, 2.82, 2.55, 2.94, 2.76),
        ], leg, "suitOlive", phase=i * 1.8, wrinkle_amp=.022)

        b.cylinder(f"{side} Thigh exo strut", (s * 2.88, -7.85, -.12), (s * 3.05, -.85, -.12), .30, "steel", leg, .04, 12)
        b.box(f"{side} Thigh armor plate", (s * .08, -3.85, 2.68), (3.65, 4.95, .75), "armorSand", leg, .16)
        b.box(f"{side} Thigh tool pouch", (s * 3.25, -3.65, .65), (1.15, 2.85, 2.35), "pouchCanvas", leg, .16)
        b.box(f"{side} Tool pouch clasp", (s * 3.78, -3.15, .65), (.24, .75, 1.45), "metalDark", leg, .05)

    # 2) 骨盆与重型工兵工具腰带
    b.anatomical_loft("Pelvis suit", [
        (-2.6, 0.0, -.05, 5.25, 5.25, 3.95, 3.85),
        ( .2,  0.0,  .02, 5.60, 5.60, 4.25, 4.10),
        ( 2.8, 0.0,  .06, 5.52, 5.52, 4.12, 4.02),
        ( 4.3, 0.0,  .04, 5.30, 5.30, 3.95, 3.85),
    ], "hips", "suitOlive", phase=.2, wrinkle_amp=.016)
    b.box("Pelvis guard plate", (0.0, .45, 4.02), (4.35, 2.65, 1.25), "armorOchre", "hips", .20)
    b.anatomical_loft("Heavy tool belt", [
        (.85, 0.0, .06, 5.85, 5.85, 4.52, 4.38),
        (2.55, 0.0, .06, 5.85, 5.85, 4.52, 4.38),
    ], "hips", "metalDark", phase=0, wrinkle_amp=0)
    b.box("Belt heavy buckle", (0.0, 1.72, 4.65), (2.65, 1.55, .52), "steel", "hips", .10)
    for s in (-1, 1):
        b.box(f"Hip hardware box {s}", (s * 5.25, 1.45, 2.85), (2.15, 2.45, 1.55), "pouchCanvas", "hips", .14, (0, s * .38, 0))
        b.box(f"Hip carabiner ring {s}", (s * 5.85, .55, -.45), (.85, 1.45, 1.15), "steel", "hips", .10)

    # 3) 躯干：棱角硬朗的工程胸甲 + 黑黄警示斜纹贴花 + 散热进气栅 + 重型肩部护甲
    b.anatomical_loft("Pathfinder torso suit", [
        ( -.5, 0.0,  .04, 5.22, 5.22, 3.95, 3.85),
        ( 2.8, 0.0,  .08, 5.60, 5.60, 4.18, 4.02),
        ( 6.6, 0.0,  .15, 6.72, 6.72, 4.85, 4.52),
        (10.2, 0.0,  .08, 7.12, 7.12, 4.95, 4.60),
        (12.2, 0.0, -.05, 5.65, 5.65, 3.95, 3.75),
        (13.8, 0.0, -.05, 3.15, 3.15, 3.10, 3.05),
    ], "torso", "suitOlive", phase=.6, wrinkle_amp=.015)

    # 多切面工程防护胸甲（告别旧版光溜圆板！）
    b.box("Chest heavy chassis", (0.0, 7.65, 4.45), (10.85, 7.25, 2.25), "armorSand", "torso", .32, (-.06, 0, 0))
    b.box("Chest upper beveled brow", (0.0, 10.65, 4.75), (9.45, 2.05, 1.85), "armorOchre", "torso", .24, (.24, 0, 0))
    b.box("Chest lower abs plate", (0.0, 2.95, 4.35), (8.65, 2.85, 1.35), "armorOchre", "torso", .22)
    # 胸口黑黄工业警示条带贴花（极强工程兵视觉特征）
    b.decal_panel("Chest hazard band", (0.0, 9.55, 5.72), 6.25, .92, .08, "hazard", "torso", (-.06, 0, 0))
    # 胸前工业散热格栅 + 左右便携零件盒 + 阵营色块
    b.box("Chest vent housing", (0.0, 6.15, 5.65), (4.25, 3.45, .72), "metalDark", "torso", .12)
    for k in range(4):
        b.box(f"Chest vent louver {k}", (0.0, 4.95 + k * .78, 6.02), (3.45, .32, .26), "steel", "torso", .03)
    for s in (-1, 1):
        b.box(f"Chest utility pouch {s}", (s * 4.25, 4.85, 5.35), (2.05, 2.65, 1.35), "pouchCanvas", "torso", .14)
        b.box(f"Chest exo shoulder latch {s}", (s * 3.85, 11.75, 1.15), (1.95, 1.55, 6.45), "metalDark", "torso", .18, (.12, 0, -s * .14))
        b.cylinder(f"Chest shoulder bolt {s}", (s * 3.85, 11.25, 4.15), (s * 3.85, 11.25, 4.65), .42, "steel", "torso", .05, 12)
    b.box("Chest team insignia", (-4.35, 8.25, 5.55), (1.95, 1.25, .38), "team", "torso", .06)

    # 护颈防撞翻领框架（保护头盔免受工地落石冲击）
    b.box("Roll cage neck back", (0.0, 12.65, -3.55), (7.85, 2.45, 1.35), "armorOchre", "torso", .22)
    b.cable("Neck roll bar", [
        (-4.35, 11.85, -3.45), (-4.35, 14.35, -3.65), (-2.45, 15.25, -3.75),
        (2.45, 15.25, -3.75), (4.35, 14.35, -3.65), (4.35, 11.85, -3.45),
    ], .32, "metalDark", "torso")

    # 刚性挂于 torso 的斜角工程重肩甲（带警示边与队色）
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        sx, sy = s * 6.8, 9.5
        b.box(f"{side} Exo pauldron top", (sx + s * 1.45, sy + 1.55, 0.0), (4.65, 1.55, 5.45), "armorSand", "torso", .28, (0, 0, -s * .32))
        b.box(f"{side} Exo pauldron skirt", (sx + s * 2.85, sy - .45, 0.0), (1.35, 3.25, 4.95), "armorOchre", "torso", .20, (0, 0, -s * .18))
        b.box(f"{side} Pauldron team plate", (sx + s * 3.45, sy - .45, 0.0), (.36, 1.35, 2.85), "team", "torso", .06, (0, 0, -s * .18))
        b.box(f"{side} Pauldron bumper", (sx + s * 2.15, sy + 2.32, 0.0), (2.25, .42, 4.45), "metalDark", "torso", .08, (0, 0, -s * .32))

    # 标志性野战工兵背包：双联加压焊接气罐 + 中央电池组 + 管线 + 右侧路线地钉挂架！
    b.box("Eng pack frame", (0.0, 6.85, -5.65), (8.65, 9.45, 3.25), "metalDark", "torso", .28)
    b.box("Eng battery cell", (0.0, 6.95, -7.25), (3.45, 6.25, 1.65), "armorOchre", "torso", .18)
    b.decal_panel("Eng pack hazard", (0.0, 8.85, -8.12), 3.05, .85, .08, "hazard", "torso", (0, math.pi, 0))
    b.box("Eng power status", (0.0, 5.15, -8.12), (1.65, .48, .22), "plasmaLamp", "torso", .04)

    for s in (-1, 1):
        cx = s * 3.45
        b.cylinder(f"Gas tank body {s}", (cx, 2.65, -7.45), (cx, 10.65, -7.45), 1.55, "tankSlate", "torso", .24, 20)
        b.cylinder(f"Gas tank valve {s}", (cx, 10.65, -7.45), (cx, 11.75, -7.45), .58, "steel", "torso", .06, 14)
        for y in (4.55, 8.45):
            b.cylinder(f"Gas tank strap {s} {y:.1f}", (cx, y - .32, -7.45), (cx, y + .32, -7.45), 1.68, "armorSand", "torso", .06, 18)
        b.cable(f"Fuel feed hose {s}", [
            (cx, 11.45, -7.45), (cx + s * .35, 12.25, -5.25),
            (s * 3.75, 11.45, -2.55), (s * 3.55, 9.85, -.55),
        ], .26, "rubber", "torso")

    # 背包右侧三根折叠路线标定地钉（呼应路线工兵特色设定）
    for k, dz in enumerate((-4.65, -5.55, -6.45)):
        b.cylinder(f"Route stake {k}", (5.05, 3.25, dz), (5.05, 13.65, dz), .24, "steel", "torso", .04, 10)
        b.box(f"Route stake cap {k}", (5.05, 13.65, dz), (.62, .72, .62), "lamp", "torso", .08)

    # 4) 头部：棱角硬朗的工业安全工程盔 + 护目滚杠格栅 + 侧置强光头灯（绝非圆蛋头盔！）
    b.anatomical_loft("Neck seal", [
        (12.2, 0.0, -.05, 2.45, 2.45, 2.45, 2.45),
        (14.1, 0.0,  .05, 2.25, 2.25, 2.30, 2.25),
    ], "torso", "suitOlive", phase=.4, wrinkle_amp=.01)

    b.anatomical_loft("Engineer helmet core", [
        (-1.85, 0.0,  .05, 3.72, 3.72, 4.18, 4.12),
        ( -.05, 0.0,  .12, 4.22, 4.22, 4.72, 4.55),
        ( 1.95, 0.0,  .05, 4.32, 4.32, 4.82, 4.68),
        ( 3.65, 0.0, -.12, 3.78, 3.78, 4.32, 4.32),
        ( 4.68, 0.0, -.25, 2.55, 2.55, 3.05, 3.12),
    ], "head", "armorSand", phase=0, wrinkle_amp=0)

    # 硬朗工地安全盔宽大遮阳檐 + 顶置加固脊 + 棱角侧护耳
    b.box("Helmet top reinforcement rib", (0.0, 4.55, -.15), (1.95, .95, 6.25), "metalDark", "head", .18, (-.06, 0, 0))
    b.box("Helmet wide peak", (0.0, 2.85, 4.35), (7.65, .78, 2.85), "armorOchre", "head", .18, (.12, 0, 0))

    # 宽阔防飞溅琥珀护目面罩 + 双横钢防护格栅杠
    def eng_visor(u, v, high):
        ang = (u - .5) * 2.15
        y = .05 + v * 2.35
        rx = 4.02
        rz = 4.52
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .35 + nz * rz), (nx, .06, nz)

    b.curved_shell("Welding amber visor", eng_visor, 14, 6, 28, 12, .26, "visorAmber", "head", bevel=.03)
    for gy in (.55, 1.55):
        b.cable(f"Visor guard bar {gy:.1f}", [
            (-3.95, gy, 2.15), (-2.85, gy, 4.35), (0.0, gy, 5.15), (2.85, gy, 4.35), (3.95, gy, 2.15),
        ], .13, "metalDark", "head")

    b.box("Helmet heavy chin guard", (0.0, -1.35, 3.75), (5.05, 1.85, 2.35), "metalDark", "head", .24, (-.12, 0, 0))
    b.box("Helmet mouth filter", (0.0, -1.45, 4.88), (2.75, 1.05, .45), "steel", "head", .08)
    for s in (-1, 1):
        b.cylinder(f"Helmet ear pro {s}", (s * 4.05, .75, -.25), (s * 4.95, .75, -.25), 1.25, "metalDark", "head", .14, 16)
    # 右侧标志性工兵强光探照灯（高亮度暖黄 LED）
    b.box("Headlamp mount", (4.55, 2.35, 1.15), (1.35, 1.35, 2.35), "armorOchre", "head", .14)
    b.cylinder("Headlamp bezel", (4.65, 2.35, 2.05), (4.65, 2.35, 2.75), .62, "steel", "head", .06, 16)
    b.cylinder("Headlamp LED", (4.65, 2.35, 2.68), (4.65, 2.35, 2.84), .48, "lamp", "head", .03, 14)

    # 5) 双臂：重型加固工兵臂与厚护手
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"
        b.anatomical_loft(f"{side} Upper arm", [
            (-7.0, 0.0, 0.0, 1.68, 1.68, 1.78, 1.76),
            (-4.2, 0.0, 0.0, 1.95, 1.92, 2.08, 2.04),
            (-1.2, 0.0, 0.0, 2.18, 2.10, 2.22, 2.18),
            ( .5,  0.0, 0.0, 2.02, 1.96, 2.06, 2.02),
        ], arm, "suitOlive", phase=i * 1.4, wrinkle_amp=.020)
        b.box(f"{side} Bicep guard", (s * 1.55, -3.75, .05), (1.22, 3.55, 2.85), "armorOchre", arm, .18)

        b.anatomical_loft(f"{side} Forearm", [
            (-5.95, 0.0, .05, 1.44, 1.44, 1.50, 1.48),
            (-3.40, 0.0, .06, 1.72, 1.72, 1.80, 1.76),
            ( -.40, 0.0, .04, 1.88, 1.88, 1.94, 1.92),
        ], elbow, "suitOlive", phase=i * 1.8, wrinkle_amp=.016)
        b.box(f"{side} Heavy gauntlet", (s * .28, -3.25, .45), (3.35, 4.65, 3.25), "armorSand", elbow, .24)
        b.box(f"{side} Elbow bumper", (0.0, -.45, -1.78), (2.45, 1.85, .82), "metalDark", elbow, .16)
        b.build_gloved_hand(side, s, hand, glove="glove", armor="armorOchre", dark="metalDark",
                            pose="palm" if i == 0 else "grip", scale=.98)

    # 6) 独立 16 骨双手工程等离子焊枪／路线勘探仪（挂于 rifle 骨骼）
    start = len(b.pieces)
    b.box("Tool main housing", (0.0, 1.55, 1.85), (2.55, 2.45, 9.25), "metalDark", "rifle", .20)
    b.box("Tool sand shroud", (0.0, 2.55, 2.65), (2.78, 1.05, 7.45), "armorSand", "rifle", .16)
    # 侧面黑黄警示斜纹贴片
    for s in (-1, 1):
        b.decal_panel(f"Tool hazard side {s}", (s * 1.32, 1.55, 2.65), 4.65, .95, .08, "hazard", "rifle",
                      (0, s * math.pi / 2, 0))
    # 后部电池块与人体工学主握把
    b.box("Tool rear battery", (0.0, 1.35, -3.65), (2.15, 2.15, 2.45), "armorOchre", "rifle", .18)
    b.extrusion("Tool main grip", [
        (-2.55, .45), (-1.05, .45), (-1.75, -2.55), (-3.15, -2.42),
    ], 0.0, 1.42, "glove", "rifle", .12)
    b.cable("Tool trigger guard", [(0.0, .35, -1.1), (0.0, -1.25, -.85), (0.0, -1.25, .75), (0.0, .35, .95)],
            .12, "metalDark", "rifle")

    # 前部左手辅助 D 形工程把手（对齐左手 pathfinderSupport）
    b.box("Tool foregrip bar", (0.0, -.25, 4.45), (1.85, .82, 3.25), "rubber", "rifle", .16)
    b.cable("Tool top carry handle", [
        (0.0, 2.95, -.85), (0.0, 4.25, -.35), (0.0, 4.25, 4.65), (0.0, 2.95, 5.15),
    ], .22, "steel", "rifle")

    # 侧面外挂迷你能量/焊剂罐
    b.cylinder("Tool side fuel cell", (1.68, 1.45, .85), (1.68, 1.45, 5.45), .65, "tankSlate", "rifle", .10, 16)
    b.cylinder("Tool fuel gauge", (1.68, 2.15, 1.65), (1.68, 2.45, 1.65), .32, "lamp", "rifle", .04, 12)

    # 重型防溅隔离罩 + 等离子电弧喷嘴
    b.cylinder("Tool nozzle collar", (0.0, 1.55, 6.45), (0.0, 1.55, 8.65), 1.15, "steel", "rifle", .10, 18)
    b.tube("Tool heat bell", (0.0, 1.55, 8.45), [(0.0, 1.15, .62), (2.25, 1.55, .95)], "metalDark", "rifle")
    b.cylinder("Tool plasma core", (0.0, 1.55, 8.65), (0.0, 1.55, 10.95), .48, "plasmaLamp", "rifle", .06, 16)
    for k in range(3):
        ang = k * math.tau / 3.0 + math.pi / 6.0
        px, py = math.cos(ang) * 1.15, 1.55 + math.sin(ang) * 1.15
        b.cylinder(f"Tool arc prong {k}", (px, py, 9.85), (px * .75, 1.55 + math.sin(ang) * .85, 11.85),
                   .18, "steel", "rifle", .03, 10)

    # 对齐握把与 RHand 原点
    for low, high in b.pieces[start:]:
        for obj in (low, high):
            obj.data.transform(Matrix.Translation(point((0, 0, 2.0))))
            a = obj.data.attributes["_installCoord"]
            for v in obj.data.vertices:
                a.data[v.index].vector = v.co

    b.extra_report["equipment"] = {
        "name": "Field Plasma Torch & Route Survey Tool",
        "joint": "rifle",
        "gripForwardOffset": 2.0,
        "features": ["hazard stripe exo-armor", "dual gas canisters + route stakes", "visor roll-bar helmet + LED headlamp"],
    }


def main():
    args = parse_hero_args()
    builder = HeroBuilder(
        key="relay:pathfinder",
        surface_name="pathfinder",
        script_path=Path(__file__),
        palette=PALETTE,
        args=args,
        label="PATHFINDER",
        workflow="Expeditionary Front field pathfinder / rugged exo-suit & plasma survey tool / 16-bone 2H IK / 2K PBR / rigid RT",
    )
    build_pathfinder(builder)
    builder.bake_and_export()


if __name__ == "__main__":
    main()
