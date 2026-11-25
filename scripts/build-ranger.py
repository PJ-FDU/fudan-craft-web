"""远行中继 · 线列步兵（Line Ranger）：2K PBR 荒漠防沙风衣 + 战术胸挂 + 16 骨双手卡宾枪 IK + 100% 刚性光追蒙皮。

重点解决旧版短板：
- 升级 16 骨独立步枪骨骼与双手 IK（rangerGrip），告别单手垂拎方块枪与空摆手臂；
- 清晰拉开荒漠帽、深色琥珀防沙护目镜、深橄榄围巾呼吸面罩、防弹尼龙胸挂弹匣与粗斜纹荒漠风衣的层次与对比度；
- 四片刚性联动风衣下摆（前摆随腿、后摆随胯）兼顾自然奔跑动态与 100% 实时光追兼容性。
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
from mathutils import Matrix

from hero_humanoid_kit import HeroBuilder, parse_hero_args, point

PALETTE = {
    "coatSand":   ((.66, .57, .43), .84, .02, "fabric", {"tex": "canvas", "scale": .24, "albedo_amp": .24, "bump_strength": .15}),
    "coatDark":   ((.45, .38, .28), .86, .02, "fabric", {"tex": "canvas", "scale": .24, "albedo_amp": .22, "bump_strength": .14}),
    "vestOlive":  ((.25, .30, .22), .80, .04, "fabric", {"tex": "ripstop", "scale": .34, "albedo_amp": .20, "bump_strength": .12}),
    "scarfDark":  ((.20, .23, .19), .86, .02, "fabric", {"tex": "canvas", "scale": .32, "albedo_amp": .20, "bump_strength": .13}),
    "trouser":    ((.31, .28, .22), .82, .03, "fabric", {"tex": "ripstop", "scale": .30, "albedo_amp": .18, "bump_strength": .11}),
    "leather":    ((.24, .17, .12), .52, .05, "rubber"),
    "rubber":     ((.10, .095, .09), .86, .00, "rubber"),
    "glove":      ((.18, .16, .14), .68, .05, "rubber"),
    "armorTan":   ((.56, .50, .39), .44, .22, "plate", {"tex": "ceramic", "scale": .18, "albedo_amp": .15, "bump_strength": .045}),
    "gun":        ((.19, .22, .24), .38, .78, "metal", {"tex": "gunmetal", "scale": .24, "albedo_amp": .16, "bump_strength": .045}),
    "gunDark":    ((.10, .12, .14), .44, .68, "metal", {"tex": "gunmetal", "scale": .24, "albedo_amp": .14, "bump_strength": .042}),
    "steel":      ((.48, .52, .55), .28, .86, "metal", {"tex": "gunmetal", "scale": .24, "albedo_amp": .14, "bump_strength": .032}),
    "recess":     ((.03, .035, .04), .68, .28, "metal"),
    "visorAmber": ((.55, .30, .06), .12, .22, "glass"),
    "lens":       ((.07, .36, .46), .10, .22, "glass"),
    "bedroll":    ((.28, .36, .26), .85, .02, "fabric", {"tex": "canvas", "scale": .28, "albedo_amp": .20, "bump_strength": .13}),
    "team":       ((.74, .76, .74), .42, .20, "team"),
    "lamp":       ((.36, .88, .92), .18, .05, "lamp"),
}


def build_ranger(b: HeroBuilder):
    # 1) 双腿：防沙野战靴、护膝战术裤与刚性联动风衣前片
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        leg, knee, foot = side + "Leg", side + "Knee", side + "Foot"
        b.build_field_boot(side, s, foot, upper="leather", sole="rubber", trim="armorTan", scale=.97, tall_cuff=True)

        b.anatomical_loft(f"{side} Shin gaiter", [
            (-7.8, -s * .18,  .06, 1.72, 1.72, 1.84, 1.84),
            (-5.0, -s * .14, -.08, 1.92, 1.92, 1.98, 2.15),
            (-2.4, -s * .08, -.10, 2.08, 2.08, 2.08, 2.24),
            ( .15, -s * .04,  .00, 2.06, 2.06, 2.12, 2.08),
        ], knee, "trouser", phase=i * 1.4, wrinkle_amp=.028)

        # 贴合圆润小腿的防沙绑腿与硬壳护膝
        b.anatomical_loft(f"{side} Boot gaiter wrap", [
            (-7.35, -s * .18, .06, 1.92, 1.92, 2.02, 2.00),
            (-5.85, -s * .15, .02, 2.06, 2.06, 2.14, 2.18),
            (-4.45, -s * .12, -.02, 2.12, 2.12, 2.18, 2.24),
        ], knee, "coatDark", phase=i, wrinkle_amp=.016)
        b.anatomical_loft(f"{side} Gaiter strap", [
            (-4.85, -s * .13, -.01, 2.18, 2.18, 2.24, 2.28),
            (-4.42, -s * .12, -.02, 2.20, 2.20, 2.26, 2.30),
        ], knee, "leather", phase=0, wrinkle_amp=0)

        def knee_pad(u, v, high, side_s=s):
            ang = (u - .5) * 2.15
            y = -1.25 + v * 2.45
            bulge = math.sin(v * math.pi)
            rx = 1.88 + .22 * bulge
            rz = 1.98 + .48 * bulge
            nx, nz = math.sin(ang), math.cos(ang)
            return (-side_s * .06 + nx * rx, y, .65 + nz * rz), (nx, (v - .5) * .3, nz)

        b.curved_shell(f"{side} Desert knee pad", knee_pad, 10, 5, 20, 10, .34, "gunDark", knee, bevel=.04)
        b.box(f"{side} Knee strap", (-s * .06, -.05, -1.65), (3.85, .82, .95), "leather", knee, .10)

        b.anatomical_loft(f"{side} Thigh trouser", [
            (-8.5, -s * .04,  .00, 2.08, 2.08, 2.18, 2.12),
            (-5.4, -s * .04,  .12, 2.38, 2.34, 2.55, 2.42),
            (-2.2,  s * .04,  .10, 2.62, 2.48, 2.82, 2.62),
            ( .50,  s * .10,  .02, 2.62, 2.44, 2.75, 2.60),
        ], leg, "trouser", phase=i * 1.8, wrinkle_amp=.026)

        # 大腿外侧轻便弹匣/水壶挂袋
        b.box(f"{side} Thigh utility pouch", (s * 2.72, -3.55, .35), (.88, 2.45, 2.15), "vestOlive", leg, .14)
        b.box(f"{side} Thigh pouch strap", (s * 2.75, -3.55, .45), (.98, .48, 2.25), "leather", leg, .06)

        # 荒漠长风衣左右前摆（带真实褶皱与底部防沙磨损边缘，绑定各自大腿实现自然奔跑摆动）
        def duster_front_flap(u, v, high, side_s=s):
            y = -9.6 + v * 9.8
            flare = (1.0 - v) * 1.45
            fold = (math.sin(u * math.pi * 3.0) * .28 + math.cos(v * math.pi * 2.0) * .10) * (1.0 - v * .6)
            ang = (.16 + u * 1.50) * side_s
            rx = 3.10 + flare
            rz = 3.45 + flare * .90
            cx = -side_s * 1.05 * (1.0 - u * .65)
            px = cx + math.sin(ang) * rx
            pz = .30 + math.cos(ang) * rz + fold
            return (px, y, pz), (math.sin(ang), -.06, math.cos(ang))

        b.curved_shell(f"{side} Duster front flap", duster_front_flap, 12, 8, 24, 16, .32, "coatSand", leg, bevel=.04)

    # 2) 骨盆、皮带与后片开衩荒漠风衣下摆
    b.anatomical_loft("Pelvis trouser", [
        (-2.5, 0.0, -.04, 4.95, 4.95, 3.72, 3.65),
        ( .5,  0.0,  .02, 5.28, 5.28, 3.98, 3.85),
        ( 3.2, 0.0,  .05, 5.20, 5.20, 3.92, 3.78),
        ( 4.3, 0.0,  .04, 5.00, 5.00, 3.76, 3.65),
    ], "hips", "trouser", phase=.2, wrinkle_amp=.020)

    def duster_rear_tail(u, v, high):
        ang = math.pi + (u - .5) * 2.35
        y = -10.2 + v * 10.8
        flare = (1.0 - v) * 2.25
        pleat = math.cos((u - .5) * math.pi * 5.0) * .36 * (1.0 - v * .65)
        rx = 5.45 + flare * .92
        rz = 4.02 + flare * 1.12 + pleat
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, -.12 + nz * rz), (nx, -.08, nz)

    b.curved_shell("Duster rear tail", duster_rear_tail, 18, 8, 36, 16, .34, "coatSand", "hips", bevel=.04)

    b.anatomical_loft("Ranger utility belt", [
        (.90, 0.0, .06, 5.55, 5.55, 4.28, 4.18),
        (2.45, 0.0, .06, 5.55, 5.55, 4.28, 4.18),
    ], "hips", "leather", phase=0, wrinkle_amp=0)
    b.box("Belt steel buckle", (0.0, 1.68, 4.42), (2.25, 1.48, .45), "steel", "hips", .08)
    for s in (-1, 1):
        b.box(f"Hip ammo pouch {s}", (s * 4.75, 1.65, 2.95), (1.85, 2.15, 1.35), "vestOlive", "hips", .14, (0, s * .42, 0))
    b.box("Rear canteen pouch", (3.65, 1.25, -4.15), (2.05, 2.45, 1.45), "coatDark", "hips", .18)

    # 3) 躯干：荒漠帆布风衣上半身 + 深橄榄防弹胸挂 + 清晰弹匣包 + 围巾领巾
    b.anatomical_loft("Ranger coat torso", [
        ( -.5, 0.0,  .04, 5.05, 5.05, 3.85, 3.72),
        ( 2.8, 0.0,  .08, 5.38, 5.38, 4.02, 3.88),
        ( 6.6, 0.0,  .15, 6.28, 6.28, 4.55, 4.32),
        (10.0, 0.0,  .08, 6.62, 6.62, 4.62, 4.35),
        (12.2, 0.0, -.04, 5.35, 5.35, 3.75, 3.58),
        (13.8, 0.0, -.05, 2.95, 2.95, 2.92, 2.88),
    ], "torso", "coatSand", phase=.6, wrinkle_amp=.022)

    # 深橄榄防弹胸挂背心（拉开与土黄风衣的明度对比）
    b.box("Chest rig carrier", (0.0, 7.15, 4.35), (8.95, 6.65, 1.35), "vestOlive", "torso", .26)
    b.box("Chest upper admin panel", (0.0, 9.65, 4.88), (6.45, 1.85, .62), "vestOlive", "torso", .12)
    b.box("Chest team patch", (-3.15, 9.75, 5.18), (2.25, 1.15, .28), "team", "torso", .05)
    b.box("Chest comms radio", (3.55, 9.35, 4.95), (1.45, 2.45, 1.05), "gunDark", "torso", .12)
    b.box("Radio status led", (3.55, 10.25, 5.48), (.45, .25, .14), "lamp", "torso", .03)
    b.cylinder("Radio mini whip", (3.95, 10.55, 4.95), (4.25, 13.85, 4.55), .09, "steel", "torso", .02, 8)

    # 三联清晰卡宾枪弹匣袋（带皮扣盖与卡其织带）
    for k, x in enumerate((-2.55, 0.0, 2.55)):
        b.box(f"Chest mag pouch {k}", (x, 5.45, 5.25), (2.15, 3.35, 1.35), "coatDark", "torso", .14)
        b.box(f"Mag pouch flap {k}", (x, 6.65, 5.45), (2.22, 1.25, 1.48), "vestOlive", "torso", .12)
        b.box(f"Mag pouch pull tab {k}", (x, 5.85, 6.18), (.48, .75, .20), "leather", "torso", .04)

    # 胸挂肩带与皮革斜挎弹带
    for s in (-1, 1):
        b.box(f"Chest rig strap {s}", (s * 3.85, 11.45, .55), (1.75, 1.25, 6.45), "vestOlive", "torso", .16, (.14, 0, -s * .14))
        b.box(f"Strap buckle {s}", (s * 3.85, 10.85, 3.65), (1.45, .65, .42), "gunDark", "torso", .06)

    # 护肩短披肩＋硬朗荒漠肩甲（解决旧版严重溜肩问题，刚性挂于 torso）
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        sx, sy = s * 6.3, 9.5

        def desert_shoulder_pad(u, v, high, side_s=s, ox=sx, oy=sy):
            phi = (u - .5) * 2.40
            theta = v * 1.32
            rx, ry, rz = 2.85, 2.98, 3.25
            lx = side_s * (math.sin(theta) * rx + .22)
            ly = math.cos(theta) * ry - .68
            lz = math.sin(phi) * math.sin(theta + .28) * rz
            return (ox + lx, oy + ly, lz), (side_s * math.sin(theta + .2), math.cos(theta), math.sin(phi) * .7)

        b.curved_shell(f"{side} Ranger shoulder guard", desert_shoulder_pad, 12, 6, 24, 12, .38, "armorTan", "torso", bevel=.04)
        b.box(f"{side} Shoulder trim strap", (sx + s * 2.15, sy - 1.15, 0.0), (1.75, .58, 4.25), "leather", "torso", .10, (0, 0, -s * .28))
        b.box(f"{side} Shoulder team patch", (sx + s * 2.68, sy - .35, 0.0), (.36, 1.05, 2.35), "team", "torso", .06, (0, 0, -s * .20))

    # 深橄榄色绕颈防沙围巾（与浅沙风衣形成强明暗分界，勾勒硬朗肩颈线条）
    def neck_shemagh(u, v, high):
        ang = u * math.tau
        y = 11.15 + v * 2.65
        fold = math.sin(ang * 5.0 + v * 3.0) * .28
        rx = 4.35 - .75 * v + fold
        rz = 4.05 - .65 * v + fold * .8
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .15 + nz * rz), (nx, .18, nz)

    b.curved_shell("Desert neck shemagh", neck_shemagh, 20, 6, 40, 12, .45, "scarfDark", "torso", wrap_u=True, bevel=.04)

    # 远征帆布行军背包 + 顶置橄榄防潮睡袋卷 + 皮革绑带 + 长距通信天线
    b.box("Expedition rucksack", (0.0, 6.65, -5.85), (8.45, 9.25, 4.25), "coatDark", "torso", .42)
    b.box("Rucksack top flap", (0.0, 10.65, -5.85), (8.65, 2.25, 4.55), "coatSand", "torso", .32)
    b.box("Rucksack side pocket L", (-4.45, 5.45, -5.85), (1.65, 4.85, 2.85), "vestOlive", "torso", .22)
    b.box("Rucksack side pocket R", (4.45, 5.45, -5.85), (1.65, 4.85, 2.85), "vestOlive", "torso", .22)
    b.cylinder("Top bedroll cylinder", (-4.85, 12.65, -5.95), (4.85, 12.65, -5.95), 1.85, "bedroll", "torso", .24, 20)
    for s in (-1, 1):
        b.box(f"Rucksack cinch strap {s}", (s * 2.45, 8.25, -7.85), (.78, 7.65, .38), "leather", "torso", .08)
        b.cylinder(f"Bedroll strap {s}", (s * 2.45, 12.65, -5.95), (s * 2.85, 12.65, -5.95), 1.96, "leather", "torso", .05, 18)
    b.cylinder("Pack whip antenna", (-3.55, 11.45, -6.65), (-3.95, 18.85, -7.85), .12, "steel", "torso", .02, 10)

    # 4) 头部：深色呼吸防沙面罩 + 醒目琥珀防沙护目镜 + 远征野战帽 + 战术耳机
    b.anatomical_loft("Head core mask", [
        (-1.85, 0.0,  .15, 2.95, 2.95, 3.35, 3.25),
        ( -.15, 0.0,  .22, 3.35, 3.35, 3.72, 3.55),
        ( 1.55, 0.0,  .12, 3.42, 3.42, 3.78, 3.68),
        ( 3.15, 0.0, -.05, 3.25, 3.25, 3.55, 3.55),
        ( 4.15, 0.0, -.12, 2.35, 2.35, 2.65, 2.68),
    ], "head", "scarfDark", phase=.2, wrinkle_amp=.015)

    # 立体呼吸滤毒半面罩（清晰层次，不和脸糊在一起）
    b.box("Respirator muzzle", (0.0, -.85, 3.55), (3.45, 2.05, 1.55), "gunDark", "head", .26, (-.16, 0, 0))
    for s in (-1, 1):
        b.cylinder(f"Filter pod {s}", (s * 1.45, -.95, 3.85), (s * 1.85, -1.05, 4.45), .78, "armorTan", "head", .08, 14)

    # 醒目深框琥珀色防沙护目镜（强轮廓对比！）
    b.box("Goggle frame chassis", (0.0, 1.15, 3.65), (5.55, 1.65, 1.35), "gunDark", "head", .22)
    b.box("Goggle amber lens L", (-1.35, 1.15, 4.22), (2.15, 1.18, .34), "visorAmber", "head", .08, (0, -.18, 0))
    b.box("Goggle amber lens R", (1.35, 1.15, 4.22), (2.15, 1.18, .34), "visorAmber", "head", .08, (0, .18, 0))
    b.box("Goggle nose bridge", (0.0, 1.15, 4.35), (.55, .95, .36), "gunDark", "head", .06)
    b.anatomical_loft("Goggle elastic band", [
        (.65, 0.0, -.05, 3.58, 3.58, 3.88, 3.88),
        (1.65, 0.0, -.05, 3.58, 3.58, 3.88, 3.88),
    ], "head", "rubber", phase=0, wrinkle_amp=0)

    # 远征硬挺野战巡逻帽（帽檐微抬，清晰露出琥珀色防沙护目镜）
    b.anatomical_loft("Patrol cap crown", [
        (2.45, 0.0, -.02, 3.62, 3.62, 3.98, 3.92),
        (3.85, 0.0,  .06, 3.82, 3.82, 4.18, 4.08),
        (4.85, 0.0,  .08, 3.55, 3.55, 3.92, 3.82),
        (5.25, 0.0,  .06, 2.65, 2.65, 2.95, 2.90),
    ], "head", "coatSand", phase=.4, wrinkle_amp=.010)
    b.anatomical_loft("Cap olive band", [
        (2.65, 0.0, .02, 3.75, 3.75, 4.10, 4.05),
        (3.25, 0.0, .02, 3.78, 3.78, 4.14, 4.08),
    ], "head", "vestOlive", phase=0, wrinkle_amp=0)

    def desert_cap_brim(u, v, high):
        ang = (u - .5) * 2.25
        r = 3.72 + v * 2.25
        y = 2.72 - v * .32
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * r, y, .18 + nz * r), (nx * .12, .99, nz * .12)

    b.curved_shell("Patrol cap wide brim", desert_cap_brim, 14, 5, 28, 10, .24, "coatDark", "head", bevel=.03)

    # 战术通讯头戴耳机（深色耳罩清晰衬托荒漠帽）
    for s in (-1, 1):
        b.cylinder(f"Comms ear cup {s}", (s * 3.45, .85, -.25), (s * 4.25, .85, -.25), 1.02, "gunDark", "head", .12, 16)
    b.cable("Headset headband", [
        (-3.95, 1.35, -.25), (-3.85, 4.05, -.25), (-2.25, 5.45, -.25),
        (0.0, 5.75, -.25), (2.25, 5.45, -.25), (3.85, 4.05, -.25), (3.95, 1.35, -.25),
    ], .24, "gunDark", "head")

    # 5) 双臂：有褶皱层次的帆布风衣袖 + 护肘 + 荒漠硬壳护腕 + 战术手套
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"
        b.anatomical_loft(f"{side} Duster upper sleeve", [
            (-7.0, 0.0, 0.0, 1.62, 1.62, 1.72, 1.70),
            (-4.2, 0.0, 0.0, 1.88, 1.86, 1.98, 1.94),
            (-1.2, 0.0, 0.0, 2.08, 2.02, 2.12, 2.08),
            ( .5,  0.0, 0.0, 1.94, 1.88, 1.98, 1.94),
        ], arm, "coatSand", phase=i * 1.5, wrinkle_amp=.028)

        b.anatomical_loft(f"{side} Duster forearm sleeve", [
            (-5.95, 0.0, .04, 1.42, 1.42, 1.48, 1.46),
            (-3.20, 0.0, .06, 1.66, 1.66, 1.74, 1.70),
            ( -.35, 0.0, .04, 1.82, 1.82, 1.88, 1.85),
        ], elbow, "coatSand", phase=i * 1.9, wrinkle_amp=.024)

        b.box(f"{side} Forearm bracer", (s * .45, -3.45, .85), (2.65, 3.65, 1.85), "armorTan", elbow, .18)
        b.box(f"{side} Bracer strap", (0.0, -4.45, .05), (3.25, .48, 3.25), "leather", elbow, .08)
        b.box(f"{side} Elbow pad", (0.0, -.45, -1.68), (2.15, 1.68, .72), "gunDark", elbow, .16)
        b.build_gloved_hand(side, s, hand, glove="glove", armor="armorTan", dark="leather",
                            pose="palm" if i == 0 else "grip", scale=.94)

    # 6) 独立荒漠远征战术卡宾枪（挂于 rifle 骨骼，对齐双手 IK）
    start = len(b.pieces)
    b.extrusion("Carbine upper receiver", [
        (-2.5, 2.68), (8.4, 2.68), (8.9, 2.15), (8.4, 1.28), (-2.6, 1.28),
    ], 0.0, 1.62, "gun", "rifle", .08)
    b.extrusion("Carbine lower receiver", [
        (-2.3, 1.38), (4.6, 1.38), (4.8, .32), (-1.4, .32), (-2.4, .85),
    ], 0.0, 1.52, "gunDark", "rifle", .08)
    # 荒漠烤漆护木罩 + 散热槽（远行中继特色配色）
    for s in (-1, 1):
        b.box(f"Carbine tan handguard {s}", (s * .92, 1.65, 6.25), (.28, 1.38, 6.15), "armorTan", "rifle", .08)
        for z in (4.2, 5.5, 6.8, 8.1):
            b.box(f"Handguard vent {s} {z:.1f}", (s * 1.04, 1.65, z), (.14, .42, .62), "recess", "rifle", .03)
    b.box("Carbine lower foregrip", (0.0, .62, 5.45), (1.58, .78, 5.25), "gunDark", "rifle", .14)
    b.box("Carbine angled foregrip", (0.0, .15, 4.45), (1.28, .68, 2.45), "rubber", "rifle", .14)

    # 可伸缩轻量化战术骨架枪托
    b.cylinder("Stock buffer tube", (0.0, 1.98, -2.45), (0.0, 1.98, -6.35), .46, "gunDark", "rifle", .04, 14)
    b.extrusion("Carbine buttstock", [
        (-6.75, 2.45), (-3.45, 2.45), (-3.85, 1.45), (-6.35, .15), (-6.75, .15),
    ], 0.0, 1.32, "armorTan", "rifle", .10)
    b.box("Stock recoil pad", (0.0, 1.25, -6.92), (1.36, 2.55, .40), "rubber", "rifle", .10)

    # 握把、护圈、微弯橄榄弹匣
    b.extrusion("Carbine grip", [
        (-2.55, .42), (-1.15, .42), (-1.92, -2.55), (-3.25, -2.42),
    ], 0.0, 1.24, "glove", "rifle", .12)
    b.cable("Carbine trigger guard", [(0.0, .35, -1.2), (0.0, -1.05, -.95), (0.0, -1.05, .65), (0.0, .35, .85)],
            .10, "gunDark", "rifle")
    b.extrusion("Carbine magazine", [
        (1.65, .35), (3.85, .35), (4.45, -3.45), (2.25, -3.55),
    ], 0.0, 1.28, "vestOlive", "rifle", .10)
    b.box("Carbine mag base", (0.0, -3.58, 3.42), (1.42, .42, 2.25), "gunDark", "rifle", .06, (.14, 0, 0))

    # 枪管与三室制退器
    b.tube("Carbine barrel", (0.0, 1.92, 0.0), [(8.8, .38, .18), (12.6, .34, .18)], "steel", "rifle")
    b.cylinder("Carbine muzzle brake", (0.0, 1.92, 12.45), (0.0, 1.92, 14.35), .48, "gunDark", "rifle", .06, 16)
    b.tube("Carbine muzzle bore", (0.0, 1.92, 14.25), [(0.0, .48, .20), (.28, .48, .20)], "steel", "rifle")

    # 顶部皮卡汀尼导轨 + 紧凑荒漠红点反射瞄具
    b.box("Carbine top rail", (0.0, 2.82, 2.85), (1.18, .24, 10.6), "gunDark", "rifle", .04)
    for z in np.arange(-1.8, 7.8, .70):
        b.box(f"Rail slot {z:.1f}", (0.0, 2.98, float(z)), (1.12, .16, .28), "gun", "rifle", .03)
    b.box("Optic riser", (0.0, 3.25, 1.45), (1.32, .52, 2.65), "gunDark", "rifle", .06)
    b.cylinder("Optic tube", (0.0, 3.88, -.35), (0.0, 3.88, 3.35), .72, "armorTan", "rifle", .08, 18)
    b.cylinder("Optic front lens", (0.0, 3.88, 3.25), (0.0, 3.88, 3.45), .58, "lens", "rifle", .03, 16)
    b.box("Optic dot glow", (0.0, 3.88, -.38), (.34, .34, .12), "lamp", "rifle", .03)
    b.box("Charging handle", (.88, 2.25, .65), (.65, .28, .45), "steel", "rifle", .04)

    # 对齐握把与 RHand 原点
    for low, high in b.pieces[start:]:
        for obj in (low, high):
            obj.data.transform(Matrix.Translation(point((0, 0, 2.0))))
            a = obj.data.attributes["_installCoord"]
            for v in obj.data.vertices:
                a.data[v.index].vector = v.co

    b.extra_report["equipment"] = {
        "name": "Expeditionary Desert Carbine",
        "joint": "rifle",
        "gripForwardOffset": 2.0,
        "features": ["tan handguard", "olive curved mag", "reflex tube optic", "split rigid duster coat", "amber goggles"],
    }


def main():
    args = parse_hero_args()
    builder = HeroBuilder(
        key="relay:ranger",
        surface_name="ranger",
        script_path=Path(__file__),
        palette=PALETTE,
        args=args,
        label="RANGER",
        workflow="Expeditionary Front line ranger / desert duster & carbine / 16-bone 2H IK / 2K PBR / rigid RT",
    )
    build_ranger(builder)
    builder.bake_and_export()


if __name__ == "__main__":
    main()
