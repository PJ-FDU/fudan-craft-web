"""工业联邦 · 战术指挥官（Tactical Commander）：2K PBR 毛呢军大衣 + 立体面部目镜 + 全息战术雷达板 + 100% 刚性光追蒙皮。

重点解决旧版短板：
- 大檐帽下完整雕出鼻梁、颧骨、下颌线、下巴、双耳与右侧发光单目战术 HUD 目镜（彻底告别“无面暗球”）；
- 精纺毛呢双排扣军大衣配金色肩章、武装斜挎带与分片刚性联动衣摆（行走时自然随腿摆动、全程支持 WebGPU 实时光追）；
- 左手曲肘自然托举发光全息雷达战术板（使用 tactical-radar-screen.png 贴图），右手握持精雕联邦制式脉冲手枪。
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hero_humanoid_kit import HeroBuilder, parse_hero_args

PALETTE = {
    "coatNavy":    ((.17, .23, .30), .78, .04, "fabric", {"tex": "wool", "scale": .22, "albedo_amp": .20, "bump_strength": .13}),
    "coatDark":    ((.10, .14, .19), .80, .04, "fabric", {"tex": "wool", "scale": .22, "albedo_amp": .18, "bump_strength": .12}),
    "trouser":     ((.11, .13, .16), .76, .04, "fabric", {"tex": "ripstop", "scale": .32, "albedo_amp": .16, "bump_strength": .10}),
    "leather":     ((.12, .10, .09), .34, .08, "rubber"),
    "rubber":      ((.07, .075, .08), .84, .00, "rubber"),
    "glove":       ((.11, .12, .13), .54, .06, "rubber"),
    "gold":        ((.84, .67, .28), .24, .88, "metal", {"tex": "gunmetal", "scale": .26, "albedo_amp": .12, "bump_strength": .025}),
    "skin":        ((.77, .60, .48), .58, .00, "fabric"),
    "hair":        ((.14, .12, .11), .72, .00, "fabric"),
    "armorDark":   ((.15, .18, .22), .42, .56, "metal", {"tex": "gunmetal", "scale": .22, "albedo_amp": .14, "bump_strength": .040}),
    "gun":         ((.23, .27, .31), .34, .80, "metal", {"tex": "gunmetal", "scale": .26, "albedo_amp": .15, "bump_strength": .038}),
    "steel":       ((.56, .62, .66), .24, .88, "metal", {"tex": "gunmetal", "scale": .26, "albedo_amp": .12, "bump_strength": .030}),
    "visor":       ((.05, .24, .34), .10, .25, "glass"),
    "capVisor":    ((.05, .06, .07), .14, .10, "glass"),
    "team":        ((.74, .76, .74), .42, .20, "team"),
    "lamp":        ((.28, .90, .96), .18, .05, "lamp"),
    "radarScreen": ((.10, .40, .46), .14, .05, "lamp", {"mode": "uv_direct", "tex": "radar"}),
}


def build_commander(b: HeroBuilder):
    # 1) 双腿：精良军靴、笔挺军裤、以及分片刚性联动的大衣前摆（随迈步自然前掀）
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        leg, knee, foot = side + "Leg", side + "Knee", side + "Foot"
        b.build_field_boot(side, s, foot, upper="leather", sole="rubber", trim="armorDark", scale=.98, tall_cuff=True)

        # 小腿高帮马靴筒 + 笔挺军裤衔接
        b.anatomical_loft(f"{side} Boot shaft", [
            (-7.8, -s * .20, .05, 1.65, 1.65, 1.78, 1.72),
            (-5.0, -s * .16, .02, 1.78, 1.78, 1.88, 1.82),
            (-2.6, -s * .10, .02, 1.92, 1.92, 2.02, 1.96),
        ], knee, "leather", phase=i, wrinkle_amp=.010)
        b.box(f"{side} Boot cuff strap", (-s * .12, -2.95, .04), (3.85, .48, 4.02), "armorDark", knee, .10)
        b.box(f"{side} Boot buckle", (s * 1.88, -2.95, .55), (.28, .62, .52), "gold", knee, .04)

        b.anatomical_loft(f"{side} Trouser knee", [
            (-2.8, -s * .10, .02, 2.02, 2.02, 2.12, 2.08),
            ( .15, -s * .05, .04, 2.08, 2.08, 2.18, 2.10),
        ], knee, "trouser", phase=i * 1.4, wrinkle_amp=.022)

        b.anatomical_loft(f"{side} Trouser thigh", [
            (-8.5, -s * .05,  .02, 2.12, 2.12, 2.22, 2.14),
            (-5.4, -s * .04,  .10, 2.38, 2.34, 2.52, 2.42),
            (-2.2,  s * .04,  .08, 2.58, 2.45, 2.75, 2.60),
            ( .50,  s * .10,  .02, 2.58, 2.42, 2.68, 2.58),
        ], leg, "trouser", phase=i * 1.7, wrinkle_amp=.022)

        # 大衣左右前片下摆（绑定于各自大腿骨骼：100% 刚性光追兼自然迈步摆动，绝无硬钟筒感）
        def coat_front_flap(u, v, high, side_s=s):
            # v: 0=下摆底(膝下 y=-10.2), 1=腰带下方(y=0.2)
            # u: 0=前中开衩边缘, 1=身侧外缘
            y = -10.2 + v * 10.4
            flare = (1.0 - v) * 1.35
            fold = math.sin(u * math.pi * 2.5) * .26 * (1.0 - v * .65)
            # 相对大腿原点 (s*4.1, 0, 0) 的局部展开角：从前内侧绕到外侧
            ang = (.08 + u * 1.55) * side_s
            rx = (3.05 + flare)
            rz = (3.45 + flare * .92)
            # 让前开衩贴近中线 (-s*3.45 指向身体中心 x=0)
            cx = -side_s * 1.15 * (1.0 - u * .65)
            px = cx + math.sin(ang) * rx + side_s * (1.0 - u) * .35
            pz = .35 + math.cos(ang) * rz + fold
            nx = math.sin(ang)
            nz = math.cos(ang)
            return (px, y, pz), (nx, -.06, nz)

        b.curved_shell(f"{side} Greatcoat front skirt", coat_front_flap, 12, 8, 24, 16, .34, "coatNavy", leg, bevel=.04)

    # 2) 骨盆、武装皮带、后片燕尾开衩大衣下摆与腰间枪套
    b.anatomical_loft("Pelvis core", [
        (-2.5, 0.0, -.04, 4.95, 4.95, 3.72, 3.65),
        ( .5,  0.0,  .02, 5.25, 5.25, 3.95, 3.85),
        ( 3.2, 0.0,  .05, 5.18, 5.18, 3.88, 3.78),
        ( 4.4, 0.0,  .04, 4.95, 4.95, 3.72, 3.62),
    ], "hips", "coatNavy", phase=.3, wrinkle_amp=.018)

    # 大衣后片开衩燕尾下摆（绑定 hips，带自然垂褶波浪）
    def coat_rear_skirt(u, v, high):
        # u: 0..1 从左后绕到右后；v: 0=下摆底(y=-10.6), 1=腰线(y=0.6)
        ang = math.pi + (u - .5) * 2.25
        y = -10.6 + v * 11.2
        flare = (1.0 - v) * 2.15
        pleat = (math.cos((u - .5) * math.pi * 6.0) * .32 + math.sin(u * math.pi * 4.0) * .18) * (1.0 - v * .7)
        rx = 5.45 + flare * .88
        rz = 4.05 + flare * 1.08 + pleat
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, -.15 + nz * rz), (nx, -.08, nz)

    b.curved_shell("Greatcoat rear skirt", coat_rear_skirt, 18, 8, 36, 16, .36, "coatNavy", "hips", bevel=.04)
    # 后腰风衣束带与金扣
    b.box("Rear waist belt strap", (0.0, 1.75, -4.18), (5.65, .92, .45), "coatDark", "hips", .10)
    for s in (-1, 1):
        b.cylinder(f"Rear belt button {s}", (s * 2.35, 1.75, -4.35), (s * 2.35, 1.75, -4.52), .26, "gold", "hips", .04, 12)

    # 军官厚武装皮带 + 金色方扣 + 右侧皮质枪套
    b.anatomical_loft("Officer leather belt", [
        (.95, 0.0, .06, 5.48, 5.48, 4.22, 4.12),
        (2.45, 0.0, .06, 5.48, 5.48, 4.22, 4.12),
    ], "hips", "leather", phase=0, wrinkle_amp=0)
    b.box("Officer belt buckle", (0.0, 1.70, 4.35), (2.25, 1.55, .42), "gold", "hips", .08)
    b.box("Belt buckle keeper", (0.0, 1.70, 4.48), (1.35, .85, .28), "coatDark", "hips", .05)
    b.box("Sidearm holster", (5.55, -.25, .65), (1.15, 3.25, 2.05), "leather", "hips", .16, (.15, 0, -.08))
    b.box("Holster snap", (6.08, .55, .95), (.20, .55, .55), "gold", "hips", .04)

    # 3) 躯干：挺括宽肩毛呢双排扣军大衣、大翻领、金线肩章、武装斜挎带与勋略章
    b.anatomical_loft("Officer greatcoat torso", [
        ( -.5, 0.0,  .04, 5.05, 5.05, 3.82, 3.72),
        ( 2.8, 0.0,  .08, 5.32, 5.32, 3.98, 3.85),
        ( 6.5, 0.0,  .15, 6.22, 6.22, 4.48, 4.25),
        (10.0, 0.0,  .10, 6.68, 6.68, 4.55, 4.28),
        (12.2, 0.0, -.02, 5.45, 5.45, 3.68, 3.52),
        (13.8, 0.0, -.05, 2.92, 2.92, 2.85, 2.80),
    ], "torso", "coatNavy", phase=.5, wrinkle_amp=.016)

    # 双排扣前襟叠片与立领内衬
    b.box("Coat front overlap", (.35, 5.65, 4.28), (6.55, 9.85, .58), "coatNavy", "torso", .16)
    b.box("High inner shirt", (0.0, 11.45, 3.25), (3.45, 2.65, 1.35), "coatDark", "torso", .16)
    b.box("Neck tie accent", (0.0, 10.65, 3.95), (.78, 2.45, .28), "gold", "torso", .05)

    # 宽阔立领与双侧翻领（带深色镶边）
    def officer_collar(u, v, high):
        ang = (u - .5) * 4.25
        y = 11.15 + v * 2.15
        rx = 3.85 + .45 * v
        rz = 3.55 + .35 * v
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, -.15 + nz * rz), (nx, .12, nz)

    b.curved_shell("Greatcoat high collar", officer_collar, 16, 4, 32, 8, .38, "coatNavy", "torso", bevel=.04)
    for s in (-1, 1):
        b.box(f"Coat lapel {s}", (s * 2.65, 9.45, 4.42), (2.15, 4.25, .44), "coatDark", "torso", .10, (.12, s * .14, -s * .32))
        b.box(f"Lapel gold pin {s}", (s * 2.55, 10.55, 4.68), (.52, .38, .14), "gold", "torso", .04, (.12, 0, -s * .32))
        # 两列 × 4 枚精车金纽扣
        for y in (2.35, 4.45, 6.55, 8.55):
            b.cylinder(f"Coat button {s} {y:.1f}", (s * 1.95, y, 4.48), (s * 1.95, y, 4.78), .34, "gold", "torso", .05, 14)

    # 指挥官左胸勋略章 + 阵营识别带
    b.box("Command ribbon bar", (-3.95, 8.95, 4.45), (2.05, .88, .28), "gold", "torso", .05, (0, -.18, 0))
    b.box("Chest team insignia", (-3.95, 7.85, 4.48), (2.15, .95, .30), "team", "torso", .05, (0, -.18, 0))

    # 武装皮质斜挎带（Sam Browne 指挥官经典元素，紧贴胸衣表面）
    b.cable("Sam Browne front strap", [
        (4.35, 11.45, 2.55), (2.45, 8.45, 4.55), (.15, 5.15, 4.58), (-2.55, 1.75, 4.38), (-4.35, -.55, 3.55),
    ], .28, "leather", "torso")
    b.cable("Sam Browne rear strap", [
        (4.35, 11.65, 2.35), (4.45, 12.05, -1.65), (2.25, 8.25, -4.48), (-1.45, 3.45, -4.32), (-4.45, -.65, -3.45),
    ], .34, "leather", "torso")

    # 结构感垫肩 + 华丽金边军官肩章 + 通讯挂麦
    for s in (-1, 1):
        b.box(f"Shoulder pad base {s}", (s * 6.05, 11.45, .05), (3.45, 1.35, 4.45), "coatNavy", "torso", .32, (0, 0, -s * .14))
        b.box(f"Gold epaulette plate {s}", (s * 5.85, 12.18, .08), (3.25, .44, 2.25), "gold", "torso", .08, (0, 0, -s * .16))
        b.box(f"Epaulette inner cloth {s}", (s * 5.75, 12.34, .08), (2.55, .24, 1.55), "coatDark", "torso", .04, (0, 0, -s * .16))
        for k in range(3):
            b.box(f"Rank bar {s} {k}", (s * (5.25 + k * .52), 12.46, .08), (.22, .16, 1.25), "gold", "torso", .03, (0, 0, -s * .16))
        b.box(f"Shoulder team flash {s}", (s * 7.25, 10.65, .05), (.38, 1.25, 2.35), "team", "torso", .06)

    # 后背紧凑军官通讯电台包（增加背面剪影层次）
    b.box("Command comm pack", (0.0, 6.95, -4.95), (5.45, 6.25, 2.15), "armorDark", "torso", .22)
    b.box("Comm pack trim", (0.0, 8.65, -6.02), (4.25, 1.35, .36), "coatNavy", "torso", .08)
    b.box("Comm status glow", (1.65, 9.15, -6.08), (.95, .38, .18), "lamp", "torso", .03)
    b.cylinder("Comm whip antenna", (-2.15, 9.85, -5.25), (-2.45, 16.45, -6.05), .12, "steel", "torso", .02, 10)

    # 4) 头部：立体雕刻人脸轮廓 + 通讯单目全息镜 + 经典联邦高冠大檐帽
    b.anatomical_loft("Officer neck", [
        (12.2, 0.0, -.05, 2.15, 2.15, 2.18, 2.18),
        (14.3, 0.0,  .10, 1.98, 1.98, 2.02, 2.02),
    ], "torso", "skin", phase=0, wrinkle_amp=0)

    def head_shape(a, t, high):
        # 雕出清晰的下颌收窄、颧骨微凸与眉弓立体轮廓（彻底告别圆球脸）
        ca, sa = math.cos(a), math.sin(a)
        mod = 1.0
        if sa > 0.25 and t < 0.30:  # 下巴前倾收尖
            mod += .10 * (1.0 - t / .30) * sa
        if abs(ca) > 0.55 and 0.35 < t < 0.62:  # 颧骨
            mod += .06 * abs(ca)
        if sa > 0.55 and 0.58 < t < 0.72:  # 眉弓
            mod += .07 * sa
        return mod

    b.anatomical_loft("Officer sculpted head", [
        (-2.15, 0.0,  .55, 1.55, 1.55, 1.95, 1.45),  # 下巴
        (-1.15, 0.0,  .35, 2.38, 2.38, 2.75, 2.45),  # 下颌线
        ( .25,  0.0,  .22, 2.82, 2.82, 3.12, 2.95),  # 颧骨／口鼻区
        ( 1.55, 0.0,  .15, 2.92, 2.92, 3.22, 3.18),  # 眉骨／眼眶
        ( 2.95, 0.0, -.05, 2.98, 2.98, 3.12, 3.22),  # 前额／颅骨
        ( 4.05, 0.0, -.15, 2.45, 2.45, 2.55, 2.65),
    ], "head", "skin", phase=0, wrinkle_amp=0, shape_fn=head_shape)

    # 立体五官结构（鼻梁、眉弓、双耳、精剪短发鬓角）
    b.box("Nose bridge", (0.0, .48, 3.22), (.72, 1.38, .85), "skin", "head", .22, (-.20, 0, 0))
    b.box("Brow ridge", (0.0, 1.52, 3.12), (3.45, .58, .68), "skin", "head", .18)
    b.box("Jawline chin", (0.0, -1.68, 2.35), (1.75, .82, .95), "skin", "head", .26)
    for s in (-1, 1):
        b.box(f"Ear {s}", (s * 2.95, .38, -.15), (.55, 1.45, .95), "skin", "head", .20)
        b.box(f"Hair temple {s}", (s * 2.85, 1.65, -.55), (.65, 2.25, 2.55), "hair", "head", .18)
    b.box("Hair back", (0.0, 1.35, -2.85), (4.65, 2.65, 1.25), "hair", "head", .32)

    # 科幻联邦战术通讯耳机 + 右眼青蓝全息单目镜（提升面容可读性与科幻军事辨识度）
    b.cylinder("Tactical earpiece", (3.15, .55, -.15), (3.65, .55, -.15), .72, "armorDark", "head", .08, 14)
    b.cable("Comms boom mic", [(3.35, .15, .35), (3.15, -.75, 1.95), (1.35, -.95, 3.35)], .12, "armorDark", "head")
    b.box("Tactical monocle frame", (1.28, 1.05, 3.28), (1.95, .82, .38), "armorDark", "head", .08, (0, .18, 0))
    b.box("Tactical monocle lens", (1.28, 1.05, 3.46), (1.58, .62, .14), "lamp", "head", .03, (0, .18, 0))
    b.box("Left eye shade", (-1.18, 1.05, 3.12), (1.45, .52, .32), "visor", "head", .06, (0, -.16, 0))

    # 高冠军官大檐帽（帽檐略抬高，清晰露出立体鼻梁与青蓝战术单目镜）
    b.anatomical_loft("Officer cap band", [
        (2.45, 0.0, -.05, 3.28, 3.28, 3.58, 3.55),
        (3.65, 0.0, -.02, 3.42, 3.42, 3.72, 3.68),
    ], "head", "coatDark", phase=0, wrinkle_amp=0)
    b.anatomical_loft("Officer cap crown", [
        (3.55, 0.0,  .05, 3.55, 3.55, 3.85, 3.80),
        (4.65, 0.0,  .28, 4.45, 4.45, 4.82, 4.55),
        (5.45, 0.0,  .38, 4.65, 4.65, 5.05, 4.65),
        (5.78, 0.0,  .35, 4.15, 4.15, 4.52, 4.15),
    ], "head", "coatNavy", phase=0, wrinkle_amp=.006)
    b.anatomical_loft("Cap gold piping", [
        (2.65, 0.0, .06, 3.42, 3.42, 3.75, 3.68),
        (3.02, 0.0, .06, 3.45, 3.45, 3.78, 3.70),
    ], "head", "gold", phase=0, wrinkle_amp=0)
    # 帽徽（双翼金星）
    b.box("Cap emblem crest", (0.0, 4.45, 4.65), (1.95, 1.15, .42), "gold", "head", .10, (-.16, 0, 0))
    b.box("Cap emblem center", (0.0, 4.45, 4.88), (.72, .72, .22), "lamp", "head", .06, (-.16, 0, 0))

    # 弧形亮黑大檐帽檐（略短略翘，保留面部与单目镜高可读性）
    def cap_brim(u, v, high):
        ang = (u - .5) * 2.05
        r = 3.52 + v * 1.98
        y = 2.88 - v * .52
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * r, y, .18 + nz * r), (nx * .18, .96, nz * .18)

    b.curved_shell("Cap glossy visor brim", cap_brim, 14, 5, 28, 10, .24, "capVisor", "head", bevel=.03)

    # 5) 双臂：剪裁利落的大衣袖管 + 金线袖口 + 战术皮手套
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"
        b.anatomical_loft(f"{side} Coat upper sleeve", [
            (-7.0, 0.0, 0.0, 1.56, 1.56, 1.66, 1.64),
            (-4.0, 0.0, 0.0, 1.78, 1.76, 1.88, 1.85),
            (-1.0, 0.0, 0.0, 1.98, 1.92, 2.04, 2.00),
            ( .5,  0.0, 0.0, 1.88, 1.82, 1.92, 1.88),
        ], arm, "coatNavy", phase=i * 1.4, wrinkle_amp=.022)

        b.anatomical_loft(f"{side} Coat forearm sleeve", [
            (-5.85, 0.0, .04, 1.42, 1.42, 1.48, 1.46),
            (-3.20, 0.0, .06, 1.58, 1.58, 1.66, 1.62),
            ( -.35, 0.0, .04, 1.72, 1.72, 1.78, 1.76),
        ], elbow, "coatNavy", phase=i * 1.8, wrinkle_amp=.020)

        # 军官翻折袖口与金线杠
        b.anatomical_loft(f"{side} Officer cuff", [
            (-5.72, 0.0, .04, 1.62, 1.62, 1.68, 1.66),
            (-4.25, 0.0, .04, 1.66, 1.66, 1.72, 1.70),
        ], elbow, "coatDark", phase=0, wrinkle_amp=0)
        b.anatomical_loft(f"{side} Cuff gold braid", [
            (-4.42, 0.0, .04, 1.72, 1.72, 1.78, 1.76),
            (-4.12, 0.0, .04, 1.72, 1.72, 1.78, 1.76),
        ], elbow, "gold", phase=0, wrinkle_amp=0)

        b.build_gloved_hand(side, s, hand, glove="glove", armor="armorDark", dark="leather",
                            pose="palm" if i == 0 else "grip", scale=.92)

    # 6) 左手（LHand）：全息战术雷达指挥板（使用 tactical-radar-screen.png 发光雷达画面）
    # 局部坐标系中 +Z 朝前，+Y 朝上，平板斜朝指挥官视线与玩家镜头清晰展示雷达界面
    b.box("Tactical slate chassis", (.45, .55, 3.15), (6.45, .68, 8.25), "armorDark", "LHand", .16, (.25, 0, 0))
    b.box("Tactical slate bezel", (.45, .86, 3.10), (5.85, .24, 7.55), "steel", "LHand", .08, (.25, 0, 0))
    # 发光战术雷达屏（面向 +Y 上方，绕 X 旋 -90°+0.25 使其正面朝上）
    b.decal_panel("Tactical radar display", (.45, .98, 3.06), 5.35, 6.85, .08, "radarScreen", "LHand",
                  (-math.pi / 2 + .25, 0, 0), slot_override=2)
    for sx in (-2.95, 2.95):
        for sz in (-3.65, 3.65):
            # 绕 X 轴正旋 +0.25 时 (0, 0, sz) 映射为 (0, -sz*sin(0.25), sz*cos(0.25))
            b.box(f"Slate bumper {sx:.0f} {sz:.0f}",
                  (.45 + sx, .55 - sz * math.sin(.25), 3.15 + sz * math.cos(.25)),
                  (.78, .82, .95), "rubber", "LHand", .12, (.25, 0, 0))
    b.box("Slate side antenna", (3.55, .55 - 4.45 * math.sin(.25), 3.15 + 4.45 * math.cos(.25)),
          (.26, .26, 1.65), "steel", "LHand", .04, (.25, 0, 0))

    # 7) 右手（RHand）：联邦军官制式重型脉冲手枪（细节饱满，告别旧版迷你方块）
    b.extrusion("Pistol grip", [
        (-.85, .35), (.85, .35), (.25, -2.55), (-1.25, -2.45),
    ], 0.0, 1.18, "glove", "RHand", .10)
    b.extrusion("Pistol frame", [
        (-1.25, 1.35), (5.65, 1.35), (5.95, .65), (5.55, .25), (-1.15, .25),
    ], 0.0, 1.28, "armorDark", "RHand", .08)
    b.extrusion("Pistol slide", [
        (-1.45, 2.45), (5.85, 2.45), (6.05, 1.65), (5.85, 1.25), (-1.45, 1.25),
    ], 0.0, 1.34, "gun", "RHand", .08)
    b.box("Pistol ejection port", (.58, 1.95, 1.45), (.22, .52, 1.65), "steel", "RHand", .03)
    b.tube("Pistol barrel bore", (0.0, 1.78, 5.75), [(0.0, .38, .18), (.95, .36, .18)], "steel", "RHand")
    b.box("Pistol under laser", (0.0, .62, 4.35), (.85, .58, 1.85), "armorDark", "RHand", .06)
    b.box("Pistol laser dot", (0.0, .62, 5.32), (.32, .32, .12), "lamp", "RHand", .03)
    b.box("Pistol front sight", (0.0, 2.58, 5.35), (.26, .28, .48), "lamp", "RHand", .03)
    b.box("Pistol rear sight", (0.0, 2.58, -.95), (.78, .28, .35), "steel", "RHand", .03)
    b.cable("Pistol trigger guard", [(0.0, .35, .65), (0.0, -.75, .85), (0.0, -.75, 2.15), (0.0, .35, 2.35)],
            .10, "armorDark", "RHand")

    b.extra_report["equipment"] = {
        "leftHand": "Holographic Tactical Command Slate (radar UI)",
        "rightHand": "Federation Officer Pulse Sidearm",
        "features": ["sculpted face + HUD monocle", "peaked officer cap", "articulated rigid wool greatcoat skirts"],
    }


def main():
    args = parse_hero_args()
    builder = HeroBuilder(
        key="industrial:commander",
        surface_name="commander",
        script_path=Path(__file__),
        palette=PALETTE,
        args=args,
        label="COMMANDER",
        workflow="Industrial Federation tactical commander / melton wool greatcoat / glowing radar slate / 2K PBR / rigid RT",
    )
    build_commander(builder)
    builder.bake_and_export()


if __name__ == "__main__":
    main()
