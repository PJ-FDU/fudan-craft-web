"""工业联邦 · 泰坦机甲（Titan Walker）：2K PBR 重装二足突击机甲 + 四管旋转重炮 + 重盾铁拳 + 100% 刚性光追蒙皮。

重点解决旧版短板：
- 拉长下肢与液压关节比例、收紧横向臃肿宽度，从旧版“方箱矮胖机”升级为挺拔威武的重工业二足突击机甲；
- 放大突出重装甲驾驶舱蓝青全景目镜与双肩 6 联战术导弹巢（刚性挂于躯干肩架，行军开火零翻转）；
- 右臂彻底重做为四管旋转重型机炮（多孔冷却护筒、供弹弹鼓、液压复进筒、发光散热槽与炮口制退器）；
- 左臂重做为带 45° 黑黄警示斜纹的倾斜重装突击盾＋三指机械重拳，全机 100% 刚性单骨蒙皮支持 WebGPU 实时光追。
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hero_humanoid_kit import HeroBuilder, parse_hero_args

PALETTE = {
    "armorOlive": ((.42, .48, .46), .40, .38, "plate", {"tex": "ceramic", "scale": .09, "albedo_amp": .18, "bump_strength": .052}),
    "armorSlate": ((.32, .40, .46), .42, .46, "plate", {"tex": "ceramic", "scale": .09, "albedo_amp": .18, "bump_strength": .052}),
    "ceramicHi":  ((.78, .82, .83), .36, .16, "plate", {"tex": "ceramic", "scale": .10, "albedo_amp": .14, "bump_strength": .038}),
    "armorTrim":  ((.62, .57, .44), .42, .26, "plate", {"tex": "ceramic", "scale": .11, "albedo_amp": .16, "bump_strength": .044}),
    "frameDark":  ((.16, .20, .24), .46, .66, "metal", {"tex": "gunmetal", "scale": .12, "albedo_amp": .18, "bump_strength": .052}),
    "gun":        ((.20, .24, .28), .36, .82, "metal", {"tex": "gunmetal", "scale": .14, "albedo_amp": .18, "bump_strength": .046}),
    "steel":      ((.58, .64, .68), .24, .90, "metal", {"tex": "gunmetal", "scale": .14, "albedo_amp": .14, "bump_strength": .032}),
    "exhaust":    ((.38, .33, .29), .50, .74, "metal", {"tex": "gunmetal", "scale": .14, "albedo_amp": .20, "bump_strength": .055}),
    "rubber":     ((.085, .095, .10), .86, .00, "rubber"),
    "recess":     ((.03, .04, .045), .68, .30, "metal"),
    "visor":      ((.05, .32, .44), .08, .22, "glass"),
    "team":       ((.74, .76, .74), .42, .20, "team"),
    "lamp":       ((.28, .92, .98), .16, .05, "lamp"),
    "amberLamp":  ((.98, .72, .22), .18, .05, "lamp"),
    "hazard":     ((.84, .60, .14), .42, .16, "plate", {"mode": "uv_direct", "tex": "hazard", "repeat": True, "scale": 1.0}),
}


def build_mech(b: HeroBuilder):
    # 腿部与躯干关节位置直接对应 mobile-models.ts (legLengths(true) = [14.0, 12.8, 3.0])
    thigh, shin, ankle = 14.0, 12.8, 3.0

    # 1) 双腿：重型液压二足腿、三趾稳定机械足、铬钢液压杆、斜角护胫甲与警示条
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        leg, knee, foot = side + "Leg", side + "Knee", side + "Foot"

        # 机械足（宽稳橡胶抓地底 + 两只重型前装甲趾 + 后稳固踵趾 + 踝关节双球座）
        b.box(f"{side} Foot chassis", (0.0, -ankle * .45, 2.65), (10.8, 2.35, 13.6), "frameDark", foot, .42)
        b.box(f"{side} Foot rubber pad", (0.0, -ankle * .88, 2.65), (10.4, .72, 13.8), "rubber", foot, .22)
        for toe_s in (-1, 1):
            b.box(f"{side} Front toe {toe_s}", (toe_s * 3.15, -ankle * .42, 8.85), (4.65, 2.25, 6.85),
                  "armorOlive", foot, .34, (-.16, 0, 0))
            b.box(f"{side} Toe claw {toe_s}", (toe_s * 3.15, -ankle * .72, 11.95), (3.85, 1.05, 1.65),
                  "steel", foot, .18)
        b.box(f"{side} Rear heel spur", (0.0, -ankle * .48, -5.25), (6.45, 2.05, 4.65), "armorSlate", foot, .30, (.18, 0, 0))
        b.box(f"{side} Ankle bridge", (0.0, .65, .65), (8.25, 2.85, 7.45), "frameDark", foot, .30)
        b.cylinder(f"{side} Ankle axle", (-5.4, .25, 0.0), (5.4, .25, 0.0), 1.85, "steel", foot, .18, 18)

        # 小腿机械骨架 + 重型斜角护胫甲 + 双后置铬钢液压缸 + 队色块
        b.box(f"{side} Shin inner frame", (0.0, -shin * .48, .25), (7.85, shin * .88, 8.25), "frameDark", knee, .38)
        b.box(f"{side} Shin front greave", (0.0, -shin * .46, 4.85), (9.65, shin * .78, 3.85),
              "armorOlive", knee, .42, (-.06, 0, 0))
        b.box(f"{side} Shin ceramic crest", (0.0, -shin * .22, 6.75), (6.45, 4.45, 1.25), "ceramicHi", knee, .24)
        b.box(f"{side} Shin team badge", (0.0, -shin * .58, 6.85), (5.25, 2.85, .62), "team", knee, .10)
        b.decal_panel(f"{side} Shin hazard trim", (0.0, -shin * .82, 6.75), 6.25, 1.15, .10, "hazard", knee, (-.06, 0, 0))
        for hs in (-1, 1):
            b.cylinder(f"{side} Shin piston outer {hs}", (hs * 3.65, -1.8, -3.25), (hs * 3.65, -shin * .56, -3.65),
                       1.15, "armorSlate", knee, .12, 16)
            b.cylinder(f"{side} Shin piston rod {hs}", (hs * 3.65, -shin * .52, -3.65), (hs * 3.65, -shin * .95, -3.15),
                       .72, "steel", knee, .08, 14)

        # 膝盖重型铰链转鼓 + 棱角装甲护膝盖
        b.cylinder(f"{side} Knee drum", (-5.6, -.2, 0.0), (5.6, -.2, 0.0), 3.45, "steel", knee, .24, 20)
        b.box(f"{side} Knee armored cowl", (0.0, .65, 5.25), (8.25, 5.15, 2.65), "armorSlate", knee, .35, (.18, 0, 0))
        b.box(f"{side} Knee top visor trim", (0.0, 2.85, 5.85), (5.65, 1.15, 1.25), "armorTrim", knee, .18)

        # 大腿机械骨架 + 重型斜装甲护板 + 侧面动力线缆与液压杆
        b.box(f"{side} Thigh frame", (0.0, -thigh * .46, 0.0), (9.25, thigh * .86, 9.25), "frameDark", leg, .42)
        b.box(f"{side} Thigh front plate", (0.0, -thigh * .42, 4.95), (10.45, thigh * .74, 3.65),
              "armorOlive", leg, .44, (-.09, 0, 0))
        b.box(f"{side} Thigh side armor", (s * 5.35, -thigh * .42, .45), (2.25, thigh * .66, 7.65),
              "armorSlate", leg, .32)
        b.cylinder(f"{side} Thigh hydraulic", (s * 4.85, -1.65, -3.65), (s * 4.85, -thigh * .84, -3.25),
                   1.25, "steel", leg, .12, 16)
        b.cable(f"{side} Thigh power hose", [
            (s * 3.8, -1.2, -4.8), (s * 4.6, -thigh * .45, -5.6), (s * 3.8, -thigh * .88, -4.6),
        ], .62, "rubber", leg)

    # 2) 骨盆底盘与重型装甲裙板
    b.box("Pelvis heavy chassis", (0.0, 1.2, 0.0), (21.5, 9.2, 15.8), "frameDark", "hips", .55)
    b.box("Pelvis front codpiece", (0.0, .4, 7.85), (14.2, 7.2, 5.2), "ceramicHi", "hips", .45, (-.22, 0, 0))
    b.box("Pelvis team plate", (0.0, 2.8, 10.25), (7.4, 2.2, .72), "team", "hips", .12)
    b.decal_panel("Pelvis hazard plate", (0.0, -1.85, 9.95), 9.2, 1.65, .10, "hazard", "hips", (-.22, 0, 0))
    for s in (-1, 1):
        b.cylinder(f"Hip axle drum {s}", (s * 8.2, .2, 0.0), (s * 12.6, .2, 0.0), 3.65, "steel", "hips", .25, 20)
        b.box(f"Hip side skirt {s}", (s * 10.6, -1.2, 4.25), (6.45, 7.25, 7.85), "armorOlive", "hips", .38, (-.12, 0, -s * .16))

    # 腰部重型回转轴承环
    b.cylinder("Waist turret ring", (0.0, 4.4, 0.0), (0.0, 7.4, 0.0), 7.65, "frameDark", "torso", .32, 24)
    b.cylinder("Waist brass bearing", (0.0, 5.2, 0.0), (0.0, 6.4, 0.0), 8.15, "steel", "torso", .18, 24)

    # 3) 躯干：重工业倾斜复合装甲驾驶舱、胸前格栅灯带、双烟囱反应堆与肩部导弹巢
    b.box("Torso core hull", (0.0, 8.5, .8), (28.5, 17.5, 21.8), "armorSlate", "torso", .75, (-.06, 0, 0))
    # 标志性倾斜重装甲胸甲（带明确层次与工业陶瓷白高光面）
    b.box("Chest glacis main", (0.0, 10.8, 10.6), (26.5, 8.6, 10.2), "armorOlive", "torso", .65, (-.32, 0, 0))
    b.box("Chest lower intake hood", (0.0, 4.6, 11.2), (18.8, 6.2, 6.8), "frameDark", "torso", .45, (-.10, 0, 0))
    # 胸口散热百叶格栅 + 发光核心状态条
    b.box("Chest grill frame", (0.0, 5.6, 14.8), (12.6, 3.8, 1.35), "frameDark", "torso", .18)
    for gx in (-4.8, -3.2, -1.6, 0.0, 1.6, 3.2, 4.8):
        b.box(f"Chest grill bar {gx:.1f}", (gx, 5.6, 15.55), (.65, 2.85, .45), "steel", "torso", .05)
    b.box("Chest core lamp", (0.0, 3.2, 14.85), (7.8, .92, .65), "lamp", "torso", .08)
    b.box("Chest upper team stripe", (0.0, 13.8, 13.45), (10.5, 1.65, 3.65), "team", "torso", .16, (-.38, 0, 0))

    for s in (-1, 1):
        b.box(f"Chest side cheek {s}", (s * 11.4, 5.2, 10.2), (8.4, 6.8, 7.6), "ceramicHi", "torso", .42, (-.20, s * .22, 0))
        b.box(f"Chest brow bumper {s}", (s * 9.8, 13.6, 12.2), (6.6, 2.4, 5.8), "armorTrim", "torso", .28, (-.32, s * .15, 0))
        b.box(f"Chest headlight {s}", (s * 10.6, 8.4, 14.45), (2.25, 1.25, .68), "amberLamp", "torso", .08, (0, s * .18, 0))
        b.box(f"Shoulder collar guard {s}", (s * 8.4, 15.8, -.2), (5.2, 6.8, 14.8), "armorOlive", "torso", .40, (0, 0, -s * .14))

    # 背面核聚变反应堆箱 + 双高耸重工业排烟筒 + 散热片
    b.box("Reactor housing", (0.0, 9.2, -10.2), (22.5, 13.6, 9.2), "frameDark", "torso", .55)
    b.box("Reactor ceramic lid", (0.0, 10.4, -14.8), (15.2, 8.8, 1.45), "ceramicHi", "torso", .28)
    for gy in (7.4, 9.8, 12.2):
        b.box(f"Reactor vent {gy:.1f}", (0.0, gy, -15.65), (11.5, 1.05, .65), "recess", "torso", .08)
    b.box("Reactor glow core", (0.0, 4.6, -14.95), (8.2, 1.45, .75), "lamp", "torso", .10)
    for s in (-1, 1):
        b.cylinder(f"Exhaust stack {s}", (s * 10.6, 3.2, -11.4), (s * 11.2, 17.5, -13.2), 2.55, "exhaust", "torso", .22, 20)
        b.tube(f"Exhaust crown {s}", (s * 11.2, 17.4, -13.2), [(0.0, 2.95, 2.05), (3.4, 3.15, 2.15)], "frameDark", "torso")
        b.cylinder(f"Reactor brace {s}", (s * 11.2, 4.2, -9.8), (s * 7.2, 3.2, -14.8), .85, "steel", "torso", .08, 12)

    # 刚性挂于 torso 两侧的巨型重装甲肩甲 + 6 联战术火箭巢（彻底杜绝抬臂翻转！）
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        sx, sy = s * 17.5, 12.4
        b.box(f"{side} Titan pauldron main", (sx + s * 1.4, sy + 2.6, -.2), (14.8, 8.6, 15.2),
              "armorSlate", "torso", .65, (0, s * .10, -s * .16))
        b.box(f"{side} Titan pauldron top plate", (sx + s * 1.6, sy + 6.4, .4), (15.4, 3.8, 14.8),
              "armorOlive", "torso", .52, (0, s * .12, -s * .16))
        b.box(f"{side} Pauldron side shield", (sx + s * 8.2, sy + 1.8, .2), (2.8, 7.6, 11.4),
              "team" if i == 1 else "ceramicHi", "torso", .32, (0, 0, -s * .16))
        b.decal_panel(f"{side} Pauldron hazard", (sx + s * 1.6, sy + 5.2, 7.85), 11.2, 1.85, .12,
                      "hazard", "torso", (0, s * .12, -s * .16))
        # 肩顶高置 6 联战术导弹巢（稳坐肩甲顶坪无穿模，6 枚橙光弹头清晰朝前威慑！）
        b.box(f"{side} Missile pod pylon", (sx + s * 1.2, sy + 7.9, -3.2), (9.6, 1.8, 7.6), "frameDark", "torso", .22)
        b.box(f"{side} Missile pod body", (sx + s * 1.2, sy + 11.2, -3.4), (10.4, 5.6, 8.6),
              "frameDark", "torso", .36, (-.08, 0, 0))
        b.box(f"{side} Missile pod lid", (sx + s * 1.2, sy + 14.1, -3.4), (10.8, .9, 8.8),
              "armorTrim", "torso", .20, (-.08, 0, 0))
        for row_y in (sy + 10.0, sy + 12.4):
            for dx in (-2.9, 0.0, 2.9):
                b.cylinder(f"{side} Missile tube {dx:.0f} {row_y:.0f}",
                           (sx + s * 1.2 + dx, row_y, .6), (sx + s * 1.2 + dx, row_y, 1.4),
                           1.12, "recess", "torso", .06, 14)
                b.cylinder(f"{side} Missile tip {dx:.0f} {row_y:.0f}",
                           (sx + s * 1.2 + dx, row_y, .9), (sx + s * 1.2 + dx, row_y, 1.85),
                           .74, "amberLamp", "torso", .12, 12)

    # 4) 头部驾驶舱：放大突出、更具压迫感的装甲头舱与发光全景蓝光目镜（解决旧版头舱偏小缩肩里）
    b.box("Head turret base", (0.0, -.8, -.2), (11.6, 4.6, 10.6), "frameDark", "head", .38)
    b.box("Head main armored shell", (0.0, 1.6, .2), (12.4, 7.2, 11.4), "armorSlate", "head", .52)
    b.box("Head ceramic brow cap", (0.0, 5.2, .8), (11.8, 3.2, 10.6), "ceramicHi", "head", .44, (-.12, 0, 0))
    b.box("Head visor hood", (0.0, 3.5, 5.6), (10.8, 1.45, 3.6), "armorOlive", "head", .24, (.18, 0, 0))
    # 宽阔醒目驾驶舱全景蓝光目镜
    b.box("Head visor glass", (0.0, 1.5, 5.65), (9.4, 2.85, 2.45), "visor", "head", .28, (-.08, 0, 0))
    b.box("Head optical glow bar", (0.0, 1.55, 6.95), (7.6, 1.15, .42), "lamp", "head", .08)
    for s in (-1, 1):
        b.box(f"Head cheek guard {s}", (s * 5.65, .6, 2.4), (2.6, 5.8, 7.6), "armorTrim", "head", .28, (0, s * .18, 0))
        b.cylinder(f"Head sensor ear {s}", (s * 6.2, 2.2, -1.2), (s * 7.6, 2.2, -1.2), 1.65, "steel", "head", .16, 16)
    b.cylinder("Head comms antenna L", (-5.4, 5.6, -2.6), (-6.2, 12.6, -4.2), .22, "steel", "head", .03, 10)
    b.cylinder("Head comms antenna R", (5.4, 5.6, -2.6), (5.8, 9.8, -3.4), .18, "steel", "head", .03, 10)

    # 5) 双臂：机械上臂骨架 + 左臂重装突击防盾与三指机械铁拳 + 右臂四管旋转重型机炮
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"

        b.cylinder(f"{side} Shoulder axle", (-s * 3.8, -.4, 0.0), (s * 3.8, -.4, 0.0), 3.65, "steel", arm, .24, 20)
        b.box(f"{side} Upper arm frame", (0.0, -5.2, 0.0), (7.6, 10.2, 7.8), "frameDark", arm, .38)
        b.box(f"{side} Upper arm plate", (s * 2.4, -5.2, .8), (4.6, 8.2, 8.6), "armorOlive", arm, .34)
        b.cylinder(f"{side} Arm piston", (s * 3.4, -1.4, -2.6), (s * 3.4, -9.2, -2.2), .85, "steel", arm, .08, 12)

        b.cylinder(f"{side} Elbow axle", (-4.2, 0.0, 0.0), (4.2, 0.0, 0.0), 2.55, "steel", elbow, .20, 18)
        b.box(f"{side} Forearm housing", (0.0, -4.4, .8), (7.8, 8.4, 8.2), "armorSlate", elbow, .38)

        if i == 0:
            # 左臂：重装斜面突击防盾（带黑黄警示斜纹＋阵营徽章＋厚钢加固肋）+ 三指机械重拳
            b.box("Shield backing frame", (-3.8, -3.4, 4.4), (13.6, 17.8, 3.6), "frameDark", elbow, .42, (-.12, 0, 0))
            b.box("Shield ceramic face", (-3.8, -3.4, 6.8), (12.8, 16.6, 2.4), "armorOlive", elbow, .45, (-.12, 0, 0))
            b.box("Shield upper plate", (-3.8, 2.4, 8.1), (11.6, 4.8, 1.4), "ceramicHi", elbow, .28, (-.12, 0, 0))
            b.box("Shield team emblem", (-3.8, -3.0, 8.25), (6.6, 5.4, .75), "team", elbow, .14, (-.12, 0, 0))
            b.decal_panel("Shield hazard bottom", (-3.8, -9.4, 8.2), 10.6, 2.15, .12, "hazard", elbow, (-.12, 0, 0))
            for sx in (-8.4, .8):
                b.box(f"Shield reinforcement rib {sx:.1f}", (sx, -3.4, 8.0), (1.35, 13.8, .95),
                      "steel", elbow, .14, (-.12, 0, 0))

            # 三指机械重拳（LHand）
            b.box("Mech fist palm", (0.0, .2, 1.4), (6.8, 5.6, 6.8), "frameDark", hand, .34)
            b.box("Mech fist knuckle guard", (0.0, 1.2, 4.6), (7.4, 3.4, 2.8), "ceramicHi", hand, .26)
            for fx in (-2.3, 0.0, 2.3):
                b.box(f"Mech finger {fx:.1f}", (fx, -1.6, 5.4), (1.65, 3.85, 2.45), "steel", hand, .16, (.25, 0, 0))
            b.box("Mech thumb", (3.6, .6, 3.6), (2.25, 2.65, 3.85), "steel", hand, .18, (0, .35, 0))
        else:
            # 右手（RHand）：四管重型旋转突击机炮（告别旧版单根素圆筒！）
            b.box("Autocannon receiver", (0.0, 1.6, 6.2), (10.6, 8.8, 16.5), "gun", hand, .48)
            b.box("Autocannon ceramic shroud", (0.0, 5.4, 6.4), (9.6, 3.4, 13.6), "armorOlive", hand, .42)
            b.decal_panel("Autocannon hazard band", (0.0, 7.15, 7.2), 6.8, 1.85, .12, "hazard", hand, (-math.pi / 2, 0, 0))

            # 侧面大型弹链供弹弹鼓 + 供弹导槽
            b.cylinder("Ammo drum body", (6.8, .4, 3.2), (10.6, .4, 3.2), 4.65, "armorSlate", hand, .36, 20)
            b.cylinder("Ammo drum hub", (10.4, .4, 3.2), (11.2, .4, 3.2), 2.15, "steel", hand, .14, 16)
            b.box("Ammo feed chute", (5.4, .8, 3.2), (3.4, 4.2, 5.8), "frameDark", hand, .22)
            b.box("Ammo indicator glow", (0.0, 6.4, -.4), (3.8, .92, .72), "lamp", hand, .08)

            # 四根平行旋转重机炮管（带真实中空炮膛 + 两道散热稳固夹环 + 重型制退口）
            b.cylinder("Rotary hub base", (0.0, 1.6, 13.8), (0.0, 1.6, 16.2), 3.65, "frameDark", hand, .24, 20)
            for k in range(4):
                ang = k * math.tau / 4.0 + math.pi / 4.0
                bx = math.cos(ang) * 1.85
                by = 1.6 + math.sin(ang) * 1.85
                b.tube(f"Rotary barrel {k}", (bx, by, 15.8), [(0.0, .92, .42), (12.8, .86, .42)], "steel", hand)
                b.tube(f"Barrel muzzle tip {k}", (bx, by, 28.4), [(0.0, 1.05, .44), (1.35, 1.05, .44)], "gun", hand)
            for z_ring in (20.2, 25.8):
                b.cylinder(f"Barrel clamp ring {z_ring:.1f}", (0.0, 1.6, z_ring - .75), (0.0, 1.6, z_ring + .75),
                           3.35, "frameDark", hand, .14, 20)

            # 两侧液压复进缓冲杆 + 散热发光能量条
            for s_bar in (-1, 1):
                b.cylinder(f"Cannon recoil strut {s_bar}", (s_bar * 4.4, 1.6, 6.2), (s_bar * 4.4, 1.6, 21.8),
                           .88, "steel", hand, .08, 14)
                b.box(f"Cannon cooling glow {s_bar}", (s_bar * 5.2, 2.8, 9.6), (.48, .92, 5.8), "lamp", hand, .08)
            # 顶部火控激光测距盒
            b.box("Cannon targeting pod", (-3.2, 6.8, 10.6), (2.4, 2.2, 5.2), "frameDark", hand, .18)
            b.cylinder("Targeting pod lens", (-3.2, 6.8, 13.1), (-3.2, 6.8, 13.6), .72, "lamp", hand, .04, 14)

    b.extra_report["equipment"] = {
        "leftArm": "Angled Ballistic Assault Shield + Articulated 3-Finger Mech Fist",
        "rightArm": "Quad-Barrel Rotary Heavy Autocannon + Side Ammo Drum",
        "shoulders": "Dual 6-Tube Tactical Missile Pods",
        "proportions": {"thigh": thigh, "shin": shin, "ankle": ankle},
    }


def main():
    args = parse_hero_args()
    builder = HeroBuilder(
        key="industrial:mech",
        surface_name="mech",
        script_path=Path(__file__),
        palette=PALETTE,
        args=args,
        label="TITAN",
        workflow="Industrial Federation Titan heavy walker / rotary quad autocannon / ballistic shield / 2K PBR / rigid RT",
    )
    build_mech(builder)
    builder.bake_and_export(cage_extrusion=.42, max_ray_distance=1.25)


if __name__ == "__main__":
    main()
