"""工业联邦 · 战地医疗兵（Field Medic）：2K PBR 陶瓷医疗重甲 + 16 骨双手光束器 IK + 100% 刚性光追蒙皮。

与新版重甲突击步兵同源工业联邦陶瓷动力甲体系，强化医疗兵专属视觉识别：
- 纯净白瓷重甲配深岩灰机械内构、急诊红工业喷涂饰带与胸/额贴合式医疗喷码徽章（取代凸起积木十字）；
- 背面双联加压生物凝胶维生罐＋金属保护架＋管线＋肩侧诊断信标；
- 独立双手纳米修复光束器（rifle 骨骼），由 unit-rig.ts 解析双骨 IK 实现胸前低持待命与前推聚焦治疗。
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
from mathutils import Matrix

from hero_humanoid_kit import HeroBuilder, parse_hero_args, point

PALETTE = {
    "ceramicWhite": ((.88, .90, .91), .34, .12, "plate", {"tex": "ceramic", "scale": .16, "albedo_amp": .12, "bump_strength": .032}),
    "ceramicOff":   ((.75, .79, .82), .38, .15, "plate", {"tex": "ceramic", "scale": .16, "albedo_amp": .14, "bump_strength": .038}),
    "medicRed":     ((.76, .16, .13), .36, .14, "plate", {"tex": "ceramic", "scale": .18, "albedo_amp": .12, "bump_strength": .032}),
    "armorSlate":   ((.31, .37, .43), .44, .36, "plate", {"tex": "ceramic", "scale": .18, "albedo_amp": .14, "bump_strength": .040}),
    "armorDark":    ((.16, .20, .24), .46, .52, "metal", {"tex": "gunmetal", "scale": .20, "albedo_amp": .14, "bump_strength": .045}),
    "undersuit":    ((.13, .16, .19), .78, .06, "fabric", {"tex": "ripstop", "scale": .32, "albedo_amp": .20, "bump_strength": .11}),
    "rubber":       ((.085, .095, .105), .86, .00, "rubber"),
    "glove":        ((.15, .18, .21), .70, .08, "rubber"),
    "pouch":        ((.24, .29, .33), .72, .08, "fabric", {"tex": "ripstop", "scale": .36, "albedo_amp": .18, "bump_strength": .10}),
    "steel":        ((.58, .64, .68), .24, .88, "metal", {"tex": "gunmetal", "scale": .24, "albedo_amp": .14, "bump_strength": .032}),
    "recess":       ((.03, .04, .05), .65, .30, "metal"),
    "visor":        ((.05, .26, .37), .10, .24, "glass"),
    "lens":         ((.08, .38, .48), .10, .22, "glass"),
    "team":         ((.74, .76, .74), .42, .20, "team"),
    "lamp":         ((.26, .88, .92), .18, .05, "lamp"),
    "medicEmblem":  ((.88, .90, .91), .36, .10, "plate", {"mode": "uv_direct", "tex": "medic", "alpha_over_base": True}),
}


def build_medic(b: HeroBuilder):
    # 1) 双腿：与重甲突击步兵同源的战靴、防弹尼龙裤管、白瓷弧面腿甲、立体护膝与急救腿包
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        leg, knee, foot = side + "Leg", side + "Knee", side + "Foot"
        b.build_industrial_boot(side, s, foot, shell="ceramicWhite", dark="armorDark",
                                mid="armorSlate", rubber="rubber", steel="steel", scale=.95)

        b.anatomical_loft(f"{side} Shin undersuit", [
            (-7.8, -s * .20,  .05, 1.85, 1.85, 1.92, 1.95),
            (-5.4, -s * .16, -.10, 2.02, 2.02, 2.05, 2.28),
            (-2.6, -s * .10, -.12, 2.18, 2.18, 2.15, 2.38),
            ( .15, -s * .05,  .00, 2.14, 2.14, 2.18, 2.14),
        ], knee, "undersuit", phase=i * 1.4, wrinkle_amp=.018)

        def shin_guard(u, v, high, side_s=s):
            ang = (u - .5) * 2.45
            y = -7.05 + v * 6.05
            rx = 2.05 + .22 * math.sin(v * math.pi)
            rz = 2.05 + .25 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (-side_s * .12 + nx * rx, y, .20 + nz * rz), (nx, 0, nz)

        b.curved_shell(f"{side} Ceramic shin greave", shin_guard, 12, 6, 24, 12, .34, "ceramicWhite", knee, bevel=.04)
        b.box(f"{side} Shin slate trim", (-s * .12, -4.25, 2.45), (1.35, 4.45, .28), "armorSlate", knee, .06)
        b.box(f"{side} Shin medic stripe", (s * 1.92, -3.65, .75), (.28, 3.15, .58), "medicRed", knee, .05)
        b.box(f"{side} Calf armor plate", (-s * .12, -3.95, -2.25), (2.75, 4.35, .62), "ceramicOff", knee, .14)

        def knee_cap(u, v, high, side_s=s):
            ang = (u - .5) * 2.15
            y = -1.25 + v * 2.45
            bulge = math.sin(v * math.pi)
            rx = 1.95 + .25 * bulge
            rz = 2.05 + .55 * bulge
            nx, nz = math.sin(ang), math.cos(ang)
            return (-side_s * .06 + nx * rx, y, .72 + nz * rz), (nx, (v - .5) * .35, nz)

        b.curved_shell(f"{side} Knee cap", knee_cap, 10, 5, 20, 10, .38, "ceramicWhite", knee, bevel=.05)
        b.box(f"{side} Knee top hinge", (-s * .06, 1.05, 1.55), (2.85, .52, 1.45), "armorSlate", knee, .10)
        b.box(f"{side} Knee guard rim", (-s * .06, -.05, 2.95), (1.75, .72, .32), "armorDark", knee, .06)

        b.anatomical_loft(f"{side} Thigh undersuit", [
            (-8.5, -s * .05,  .00, 2.15, 2.15, 2.22, 2.15),
            (-5.8, -s * .04,  .14, 2.48, 2.42, 2.65, 2.48),
            (-2.6,  s * .04,  .12, 2.75, 2.55, 2.95, 2.72),
            ( .50,  s * .12,  .02, 2.75, 2.48, 2.88, 2.72),
        ], leg, "undersuit", phase=i * 1.9 + .5, wrinkle_amp=.020)

        def thigh_plate(u, v, high, side_s=s):
            ang = (u - .5) * 2.35
            y = -7.25 + v * 6.55
            rx = 2.38 + .42 * v
            rz = 2.48 + .46 * v
            nx, nz = math.sin(ang), math.cos(ang)
            return (side_s * .08 + nx * rx, y, .32 + nz * rz), (nx, 0, nz)

        b.curved_shell(f"{side} Ceramic thigh cuisse", thigh_plate, 12, 6, 24, 12, .34, "ceramicWhite", leg, bevel=.04)
        b.box(f"{side} Thigh side rail", (s * 2.78, -3.75, .15), (.44, 5.15, 1.38), "armorSlate", leg, .10)
        # 左侧战地急救盒、右侧生物针剂挂袋
        if i == 0:
            b.box("L Trauma kit box", (-3.15, -3.45, .55), (.92, 2.55, 2.15), "ceramicOff", leg, .12)
            b.box("L Trauma red stripe", (-3.58, -3.45, .55), (.16, .62, 1.85), "medicRed", leg, .04)
        else:
            b.box("R Injector pouch", (3.12, -3.35, .55), (.88, 2.35, 2.05), "pouch", leg, .12)
            b.box("R Pouch flap", (3.35, -2.55, .65), (.55, .85, 1.85), "armorDark", leg, .08)

    # 2) 骨盆与医务战术腰带
    b.anatomical_loft("Pelvis undersuit", [
        (-2.6, 0.0, -.05, 5.10, 5.10, 3.85, 3.75),
        ( .2,  0.0,  .02, 5.45, 5.45, 4.15, 4.00),
        ( 2.8, 0.0,  .06, 5.40, 5.40, 4.02, 3.92),
        ( 4.3, 0.0,  .04, 5.15, 5.15, 3.85, 3.75),
    ], "hips", "undersuit", phase=.2, wrinkle_amp=.016)
    b.box("Codpiece upper", (0.0, .65, 3.85), (4.05, 2.35, 1.25), "ceramicWhite", "hips", .20, (.10, 0, 0))
    b.box("Codpiece lower", (0.0, -1.25, 3.15), (3.15, 2.15, 1.35), "ceramicOff", "hips", .20, (-.25, 0, 0))
    b.box("Rear pelvis armor", (0.0, .55, -3.72), (6.85, 3.25, 1.15), "ceramicOff", "hips", .20)
    b.anatomical_loft("Tactical belt", [
        ( .85, 0.0, .06, 5.65, 5.65, 4.40, 4.25),
        (2.40, 0.0, .06, 5.65, 5.65, 4.40, 4.25),
    ], "hips", "armorDark", phase=0, wrinkle_amp=0)
    b.box("Belt buckle", (0.0, 1.65, 4.52), (2.45, 1.48, .52), "steel", "hips", .10)
    for s in (-1, 1):
        b.box(f"Hip tasset {s}", (s * 5.65, .25, .15), (1.05, 3.35, 3.65), "ceramicWhite", "hips", .16, (0, 0, -s * .14))
        b.box(f"Hip medical pouch {s}", (s * 4.55, 1.75, 3.15), (1.95, 2.05, 1.25), "pouch", "hips", .12, (0, s * .35, 0))
        b.box(f"Hip pouch clasp {s}", (s * 4.55, 1.85, 3.78), (.65, .75, .22), "medicRed", "hips", .04, (0, s * .35, 0))

    # 3) 躯干：流线陶瓷医疗胸甲 + 贴合式胸口医疗徽章贴花 + 分节腹甲 + 颈部领环
    b.anatomical_loft("Torso core", [
        ( -.5, 0.0,  .04, 5.05, 5.05, 3.85, 3.75),
        ( 2.8, 0.0,  .08, 5.38, 5.38, 4.02, 3.88),
        ( 6.6, 0.0,  .15, 6.45, 6.45, 4.65, 4.35),
        (10.2, 0.0,  .08, 6.85, 6.85, 4.78, 4.42),
        (12.2, 0.0, -.05, 5.45, 5.45, 3.85, 3.65),
        (13.8, 0.0, -.05, 3.05, 3.05, 3.00, 2.95),
    ], "torso", "undersuit", phase=.7, wrinkle_amp=.015)

    for k, (y, w, h, z) in enumerate(((1.15, 8.2, 1.55, 3.92), (2.75, 8.9, 1.55, 4.18), (4.35, 9.6, 1.55, 4.45))):
        b.box(f"Abdominal armor {k}", (0.0, y, z), (w, h, 1.22), "ceramicOff" if k == 1 else "ceramicWhite", "torso", .22)
        b.box(f"Abdominal groove {k}", (0.0, y - .72, z + .15), (w - .9, .24, 1.15), "armorDark", "torso", .04)

    def chest_cuirass(u, v, high):
        ang = (u - .5) * 2.28
        y = 5.15 + v * 6.55
        rx = 6.30 + .55 * math.sin(v * math.pi)
        rz = 4.55 + .82 * math.sin(v * math.pi * .85)
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .40 + nz * rz), (nx, .14 * (v - .5), nz)

    b.curved_shell("Chest white cuirass", chest_cuirass, 16, 8, 32, 16, .52, "ceramicWhite", "torso", bevel=.05)

    # 胸骨贴合式八角医疗徽章（位于弧面胸甲外侧，完整清晰无穿模）
    b.box("Sternum emblem housing", (0.0, 8.35, 5.95), (4.65, 4.35, .52), "ceramicOff", "torso", .16, (-.06, 0, 0))
    b.decal_panel("Chest medical emblem", (0.0, 8.35, 6.26), 3.75, 3.75, .08, "medicEmblem", "torso", (-.06, 0, 0))

    # 锁骨防护环与急诊红饰条
    def collar_guard(u, v, high):
        ang = (u - .5) * 3.8
        y = 11.15 + v * 1.65
        rx = 4.65 - .35 * v
        rz = 4.25 - .30 * v
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .15 + nz * rz), (nx, .22, nz)

    b.curved_shell("Armor gorget collar", collar_guard, 16, 4, 32, 8, .48, "ceramicWhite", "torso", bevel=.05)
    b.box("Collar red accent", (0.0, 11.45, 4.55), (4.25, .48, .35), "medicRed", "torso", .06)
    b.box("Chest team patch", (-4.85, 9.65, 4.42), (1.75, 1.25, .42), "team", "torso", .08, (0, -.42, 0))
    for s in (-1, 1):
        b.box(f"Shoulder strap brace {s}", (s * 3.65, 11.65, .75), (1.75, 1.35, 6.25), "armorSlate", "torso", .16, (.14, 0, -s * .14))
        b.box(f"Shoulder red tab {s}", (s * 3.65, 11.75, 3.65), (1.25, .55, .48), "medicRed", "torso", .06)

    # 4) 刚性躯干挂载圆弧医疗重肩甲（白瓷＋急诊红识别带＋队色标，播放动画零翻转）
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        sx, sy = s * 6.4, 9.5

        def pauldron_shell(u, v, high, side_s=s, ox=sx, oy=sy):
            phi = (u - .5) * 2.55
            theta = v * 1.42
            rx, ry, rz = 3.25, 3.45, 3.68
            lx = side_s * (math.sin(theta) * rx + .32)
            ly = math.cos(theta) * ry - .88
            lz = math.sin(phi) * math.sin(theta + .28) * rz
            return (ox + lx, oy + ly, lz), (side_s * math.sin(theta + .2), math.cos(theta), math.sin(phi) * .72)

        b.curved_shell(f"{side} Medic pauldron", pauldron_shell, 14, 8, 28, 16, .48, "ceramicWhite", "torso", bevel=.05)
        b.box(f"{side} Pauldron rim", (sx + s * 2.38, sy - 1.55, 0.0), (2.45, .68, 4.95), "armorSlate", "torso", .14, (0, 0, -s * .32))
        b.box(f"{side} Pauldron medic band", (sx + s * 3.12, sy - .28, 0.0), (.40, .82, 4.45), "medicRed", "torso", .08, (0, 0, -s * .20))
        b.box(f"{side} Pauldron team flash", (sx + s * 3.05, sy - 1.05, 0.0), (.42, .85, 3.15), "team", "torso", .08, (0, 0, -s * .26))

    # 5) 标志性双联生物凝胶维生背包 + 保护架 + 软管 + 诊断信标
    b.box("Medpack chassis", (0.0, 6.85, -5.45), (8.25, 9.65, 3.25), "ceramicOff", "torso", .32)
    b.box("Medpack spine frame", (0.0, 6.95, -7.05), (3.15, 8.85, 1.15), "armorSlate", "torso", .18)
    b.box("Medpack top manifold", (0.0, 11.45, -5.65), (7.25, 1.65, 2.85), "armorDark", "torso", .20)
    b.box("Medpack status light", (0.0, 10.65, -7.65), (1.85, .58, .35), "lamp", "torso", .06)

    for s in (-1, 1):
        cx = s * 3.85
        # 钢制上下罐盖 + 发光青蓝生物凝胶罐芯 + 白瓷/急诊红箍环
        b.cylinder(f"Bio canister core {s}", (cx, 3.05, -6.45), (cx, 10.35, -6.45), 1.52, "lamp", "torso", .08, 20)
        b.cylinder(f"Bio canister top cap {s}", (cx, 9.85, -6.45), (cx, 11.05, -6.45), 1.68, "steel", "torso", .10, 20)
        b.cylinder(f"Bio canister bot cap {s}", (cx, 2.25, -6.45), (cx, 3.45, -6.45), 1.68, "steel", "torso", .10, 20)
        b.cylinder(f"Bio canister ring mid {s}", (cx, 6.25, -6.45), (cx, 7.15, -6.45), 1.74, "ceramicWhite", "torso", .08, 20)
        b.cylinder(f"Bio canister red band {s}", (cx, 8.15, -6.45), (cx, 8.95, -6.45), 1.75, "medicRed", "torso", .08, 20)
        # 侧面保护金属栏杆
        b.cable(f"Canister guard bar {s}", [
            (cx + s * .8, 2.8, -7.8), (cx + s * 1.45, 4.5, -8.15),
            (cx + s * 1.45, 8.8, -8.15), (cx + s * .8, 10.5, -7.8),
        ], .20, "armorDark", "torso")
        # 背包接入胸甲两侧的维生柔性软管
        b.cable(f"Bio feed hose {s}", [
            (cx, 10.85, -5.95), (cx + s * .35, 12.15, -4.45),
            (s * 3.65, 11.75, -2.15), (s * 3.45, 10.65, -.15),
        ], .28, "rubber", "torso")

    # 左肩后方紧凑型战地诊断光学信标
    b.cylinder("Triage mast stem", (-4.35, 11.2, -5.65), (-4.35, 14.95, -5.65), .24, "steel", "torso", .03, 12)
    b.box("Triage beacon pod", (-4.35, 15.15, -5.45), (1.35, 1.05, 1.45), "ceramicWhite", "torso", .14)
    b.box("Triage beacon lens", (-4.35, 15.15, -4.70), (.85, .62, .22), "lamp", "torso", .05)

    # 6) 头部：流线白瓷医疗战盔 + 额头医疗徽章 + 蓝青全景目镜 + 呼吸面罩
    b.anatomical_loft("Neck undersuit", [
        (12.2, 0.0, -.05, 2.35, 2.35, 2.35, 2.35),
        (14.1, 0.0,  .05, 2.15, 2.15, 2.20, 2.15),
    ], "torso", "undersuit", phase=.4, wrinkle_amp=.01)

    b.anatomical_loft("Helmet dome", [
        (-1.85, 0.0,  .05, 3.65, 3.65, 4.10, 4.05),
        ( -.10, 0.0,  .15, 4.18, 4.18, 4.68, 4.50),
        ( 1.85, 0.0,  .08, 4.24, 4.24, 4.78, 4.65),
        ( 3.55, 0.0, -.12, 3.72, 3.72, 4.25, 4.28),
        ( 4.65, 0.0, -.30, 2.48, 2.48, 2.95, 3.05),
        ( 5.05, 0.0, -.35, 1.20, 1.20, 1.45, 1.50),
    ], "head", "ceramicWhite", phase=0, wrinkle_amp=0)

    b.box("Helmet crown ridge", (0.0, 4.55, -.15), (1.65, .75, 5.25), "ceramicOff", "head", .22, (-.08, 0, 0))
    b.box("Helmet brow peak", (0.0, 2.55, 3.85), (5.85, .68, 1.85), "ceramicWhite", "head", .18, (.14, 0, 0))
    # 额头贴合式医疗微标（紧贴额盔弧面，边缘不悬空）
    b.box("Helmet emblem backing", (0.0, 3.12, 4.18), (1.65, 1.55, .36), "ceramicOff", "head", .12, (-.36, 0, 0))
    b.decal_panel("Helmet medic emblem", (0.0, 3.18, 4.38), 1.38, 1.38, .06, "medicEmblem", "head", (-.36, 0, 0))

    def helmet_visor(u, v, high):
        ang = (u - .5) * 2.10
        y = .15 + v * 2.15
        rx = 4.28 - .12 * v
        rz = 4.68 - .10 * v
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .32 + nz * rz), (nx, .06, nz)

    b.curved_shell("Helmet tactical visor", helmet_visor, 14, 6, 28, 12, .26, "visor", "head", bevel=.03)
    b.box("Helmet chin guard", (0.0, -1.25, 3.65), (4.65, 1.85, 2.25), "ceramicOff", "head", .26, (-.14, 0, 0))
    b.box("Helmet respirator grill", (0.0, -1.35, 4.78), (2.45, 1.15, .42), "armorSlate", "head", .08)
    b.box("Helmet sensor eye", (2.65, 1.35, 4.32), (.92, .68, .55), "armorDark", "head", .08, (0, .35, 0))
    b.box("Helmet sensor lens", (2.82, 1.35, 4.55), (.42, .42, .16), "lamp", "head", .04, (0, .35, 0))
    for s in (-1, 1):
        b.box(f"Helmet cheek plate {s}", (s * 3.72, -.75, 1.85), (1.05, 2.15, 2.95), "armorSlate", "head", .18, (0, s * .25, 0))
        b.cylinder(f"Helmet ear comms {s}", (s * 3.92, .72, -.22), (s * 4.65, .72, -.22), 1.05, "armorSlate", "head", .10, 16)
    b.cylinder("Helmet side antenna", (-4.52, .85, -.45), (-4.72, 4.35, -.95), .12, "steel", "head", .02, 10)

    # 7) 双臂与医疗护臂
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"
        b.anatomical_loft(f"{side} Upper arm", [
            (-7.0, 0.0, 0.0, 1.62, 1.62, 1.72, 1.70),
            (-4.2, 0.0, 0.0, 1.88, 1.85, 2.02, 1.98),
            (-1.2, 0.0, 0.0, 2.10, 2.02, 2.15, 2.10),
            ( .5,  0.0, 0.0, 1.95, 1.90, 2.00, 1.95),
        ], arm, "undersuit", phase=i * 1.3, wrinkle_amp=.018)
        b.box(f"{side} Bicep armor", (s * 1.48, -3.75, .05), (1.18, 3.65, 2.75), "ceramicOff", arm, .18)

        b.anatomical_loft(f"{side} Forearm", [
            (-5.95, 0.0, .05, 1.35, 1.35, 1.42, 1.40),
            (-3.40, 0.0, .06, 1.62, 1.62, 1.72, 1.68),
            ( -.40, 0.0, .04, 1.80, 1.80, 1.86, 1.84),
        ], elbow, "undersuit", phase=i * 1.7, wrinkle_amp=.014)

        def gauntlet(u, v, high, side_s=s):
            ang = (u - .5) * 2.55
            y = -5.55 + v * 4.65
            r = 1.56 + .25 * v
            nx, nz = math.sin(ang), math.cos(ang)
            return (side_s * .16 + nx * r, y, .12 + nz * r), (nx, 0, nz)

        b.curved_shell(f"{side} Ceramic gauntlet", gauntlet, 10, 5, 20, 10, .30, "ceramicWhite", elbow, bevel=.04)
        b.box(f"{side} Elbow cop", (0.0, -.45, -1.65), (2.25, 1.75, .75), "armorSlate", elbow, .16)
        b.box(f"{side} Forearm red cuff", (0.0, -4.95, 0.0), (3.15, .55, 3.15), "medicRed", elbow, .10)
        b.build_gloved_hand(side, s, hand, glove="glove", armor="ceramicWhite", dark="armorDark",
                            pose="palm" if i == 0 else "grip", scale=.95)

    # 8) 独立双手纳米修复光束器（挂在 rifle 骨骼，对齐握把原点）
    start = len(b.pieces)
    # 主枪身机匣（白瓷＋岩灰流线外壳，一眼区别于实弹突击步枪）
    b.extrusion("Emitter lower body", [
        (-4.8, 1.95), (6.5, 1.95), (7.6, 1.05), (7.2, .15), (-3.8, .15), (-5.0, .85),
    ], 0.0, 2.05, "armorSlate", "rifle", .10)
    b.extrusion("Emitter ceramic cowl", [
        (-4.2, 2.95), (5.8, 2.95), (6.6, 2.25), (6.4, 1.55), (-4.4, 1.55),
    ], 0.0, 2.25, "ceramicWhite", "rifle", .12)
    for s in (-1, 1):
        b.box(f"Emitter red accent {s}", (s * 1.15, 2.25, 2.65), (.18, .48, 4.65), "medicRed", "rifle", .04)
        b.box(f"Emitter cooling rib {s}", (s * 1.08, 1.05, 3.85), (.20, .85, 3.45), "armorDark", "rifle", .05)

    # 后托与人体工学握把（对齐右手）
    b.extrusion("Emitter stock", [
        (-5.6, 2.15), (-4.2, 2.15), (-4.0, .35), (-5.6, -.35),
    ], 0.0, 1.48, "armorDark", "rifle", .10)
    b.box("Emitter buttpad", (0.0, .90, -5.75), (1.52, 2.55, .42), "rubber", "rifle", .12)
    b.extrusion("Emitter pistol grip", [
        (-2.65, .25), (-1.15, .25), (-1.85, -2.55), (-3.25, -2.45),
    ], 0.0, 1.38, "glove", "rifle", .12)
    b.cable("Emitter trigger guard", [(0.0, .15, -1.2), (0.0, -1.25, -.95), (0.0, -1.25, .65), (0.0, .15, .85)],
            .12, "armorDark", "rifle")

    # 前托握把（对齐左手 medicSupport）
    b.box("Emitter foregrip cradle", (0.0, -.05, 4.35), (1.75, .82, 3.65), "rubber", "rifle", .16)

    # 标志性顶部透明生物凝胶能量瓶＋双不锈钢保护弓
    b.cylinder("Ampoule core glow", (0.0, 3.72, -.85), (0.0, 3.72, 4.45), .92, "lamp", "rifle", .08, 20)
    b.cylinder("Ampoule rear cap", (0.0, 3.72, -1.35), (0.0, 3.72, -.55), 1.08, "steel", "rifle", .08, 20)
    b.cylinder("Ampoule front cap", (0.0, 3.72, 4.15), (0.0, 3.72, 4.95), 1.08, "steel", "rifle", .08, 20)
    for s in (-1, 1):
        b.cable(f"Ampoule roll cage {s}", [
            (s * .95, 2.85, -1.1), (s * 1.15, 4.25, -.5),
            (s * 1.15, 4.25, 4.2), (s * .95, 2.85, 4.8),
        ], .13, "steel", "rifle")

    # 前部纳米光束双聚焦电极爪 + 中央发光发射环
    b.cylinder("Emitter nozzle collar", (0.0, 1.55, 6.85), (0.0, 1.55, 8.25), 1.05, "steel", "rifle", .08, 18)
    b.tube("Emitter lens ring", (0.0, 1.55, 8.15), [(0.0, .92, .45), (.75, .82, .42)], "lamp", "rifle")
    for s in (-1, 1):
        b.extrusion(f"Focus prong {s}", [
            (7.4, 1.95), (11.2, 1.72), (11.2, 1.38), (7.4, 1.15),
        ], s * 1.05, .34, "steel", "rifle", .05)
        b.box(f"Prong tip emitter {s}", (s * 1.05, 1.55, 11.15), (.44, .44, .65), "lamp", "rifle", .06)
    b.box("Top focus guide", (0.0, 2.55, 9.25), (.38, .32, 2.65), "ceramicWhite", "rifle", .05)
    b.box("Rear telemetry strip", (0.0, 3.10, -3.55), (1.05, .36, .45), "lamp", "rifle", .04)

    # 对齐握把与 RHand 原点
    for low, high in b.pieces[start:]:
        for obj in (low, high):
            obj.data.transform(Matrix.Translation(point((0, 0, 2.0))))
            a = obj.data.attributes["_installCoord"]
            for v in obj.data.vertices:
                a.data[v.index].vector = v.co

    b.extra_report["equipment"] = {
        "name": "Nano-Bio Field Applicator",
        "joint": "rifle",
        "gripForwardOffset": 2.0,
        "features": ["ceramic cowl", "glowing bio-gel ampoule", "dual focus prongs", "chest & brow stencil decals"],
    }


def main():
    args = parse_hero_args()
    builder = HeroBuilder(
        key="industrial:medic",
        surface_name="medic",
        script_path=Path(__file__),
        palette=PALETTE,
        args=args,
        label="MEDIC",
        workflow="Industrial Federation heavy ceramic field medic + nano-bio beam emitter / 2K PBR / 100% rigid RT",
    )
    build_medic(builder)
    builder.bake_and_export()


if __name__ == "__main__":
    main()
