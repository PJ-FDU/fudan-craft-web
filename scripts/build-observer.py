"""远行中继 · 前沿观测员（Forward Observer）：2K PBR 褶皱战术披肩斗篷 + 棱角光学兜帽 + 光电桅杆 + 发光雷达板 + 100% 刚性光追。

彻底推翻旧版“充气蘑菇壳斗篷 + 鹅卵石小头 + 细棍腿 + 横举平板”问题：
- 重做有真实垂坠折痕、肩线骨架与前胸 V 形开襟的荒漠战术披肩与多层后披风（透出下方深橄榄侦察背心）；
- 重做带棱角帽檐与褶皱的荒漠兜帽，内嵌双目青蓝发光微光光学护目镜、测距探头与防尘呼吸器；
- 背面升级为带支架管线的伸缩式光电侦察云台桅杆（多镜头 + 顶置迷你雷达罩）；
- 双手自然在胸前协同操作发光战术雷达平板（tactical-radar-screen.png），告别僵直平举。
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hero_humanoid_kit import HeroBuilder, parse_hero_args

PALETTE = {
    "cloakSand":   ((.64, .56, .42), .86, .02, "fabric", {"tex": "canvas", "scale": .22, "albedo_amp": .24, "bump_strength": .16}),
    "cloakTrim":   ((.44, .37, .27), .86, .02, "fabric", {"tex": "canvas", "scale": .24, "albedo_amp": .22, "bump_strength": .15}),
    "rigOlive":    ((.24, .29, .22), .80, .04, "fabric", {"tex": "ripstop", "scale": .34, "albedo_amp": .20, "bump_strength": .12}),
    "trouser":     ((.28, .26, .21), .82, .03, "fabric", {"tex": "ripstop", "scale": .30, "albedo_amp": .18, "bump_strength": .11}),
    "leather":     ((.22, .16, .11), .50, .05, "rubber"),
    "rubber":      ((.095, .095, .09), .86, .00, "rubber"),
    "glove":       ((.17, .16, .14), .68, .05, "rubber"),
    "armorTan":    ((.56, .50, .40), .44, .22, "plate", {"tex": "ceramic", "scale": .18, "albedo_amp": .14, "bump_strength": .042}),
    "metalDark":   ((.16, .19, .22), .42, .64, "metal", {"tex": "gunmetal", "scale": .24, "albedo_amp": .16, "bump_strength": .045}),
    "steel":       ((.54, .59, .62), .26, .88, "metal", {"tex": "gunmetal", "scale": .26, "albedo_amp": .14, "bump_strength": .032}),
    "recess":      ((.03, .04, .045), .68, .30, "metal"),
    "visor":       ((.05, .26, .36), .10, .24, "glass"),
    "team":        ((.74, .76, .74), .42, .20, "team"),
    "lamp":        ((.26, .92, .96), .18, .05, "lamp"),
    "radarScreen": ((.10, .42, .48), .14, .05, "lamp", {"mode": "uv_direct", "tex": "radar"}),
}


def build_observer(b: HeroBuilder):
    # 1) 稳健下肢（彻底解决旧版细棍腿头重脚轻）：加粗侦察工装裤、立体护膝、腿侧装备盒与野战靴
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        leg, knee, foot = side + "Leg", side + "Knee", side + "Foot"
        b.build_field_boot(side, s, foot, upper="leather", sole="rubber", trim="armorTan", scale=.98, tall_cuff=True)

        b.anatomical_loft(f"{side} Shin recon trouser", [
            (-7.8, -s * .18,  .06, 1.78, 1.78, 1.90, 1.88),
            (-5.0, -s * .14, -.08, 1.98, 1.98, 2.04, 2.22),
            (-2.4, -s * .08, -.10, 2.15, 2.15, 2.15, 2.32),
            ( .15, -s * .04,  .00, 2.12, 2.12, 2.18, 2.12),
        ], knee, "trouser", phase=i * 1.5, wrinkle_amp=.028)

        b.anatomical_loft(f"{side} Shin gaiter", [
            (-7.35, -s * .18, .06, 1.98, 1.98, 2.08, 2.06),
            (-5.75, -s * .15, .02, 2.12, 2.12, 2.20, 2.24),
            (-4.25, -s * .12, -.02, 2.18, 2.18, 2.24, 2.30),
        ], knee, "cloakTrim", phase=i, wrinkle_amp=.016)
        b.anatomical_loft(f"{side} Shin clamp strap", [
            (-4.65, -s * .13, -.01, 2.24, 2.24, 2.30, 2.34),
            (-4.22, -s * .12, -.02, 2.26, 2.26, 2.32, 2.36),
        ], knee, "leather", phase=0, wrinkle_amp=0)

        def knee_pad(u, v, high, side_s=s):
            ang = (u - .5) * 2.18
            y = -1.25 + v * 2.48
            bulge = math.sin(v * math.pi)
            rx = 1.95 + .24 * bulge
            rz = 2.02 + .52 * bulge
            nx, nz = math.sin(ang), math.cos(ang)
            return (-side_s * .06 + nx * rx, y, .68 + nz * rz), (nx, (v - .5) * .3, nz)

        b.curved_shell(f"{side} Recon knee pad", knee_pad, 10, 5, 20, 10, .36, "metalDark", knee, bevel=.04)
        b.box(f"{side} Knee shell highlight", (-s * .06, -.05, 2.85), (1.75, .75, .30), "armorTan", knee, .06)

        b.anatomical_loft(f"{side} Thigh recon trouser", [
            (-8.5, -s * .04,  .00, 2.15, 2.15, 2.24, 2.18),
            (-5.4, -s * .04,  .12, 2.46, 2.42, 2.62, 2.48),
            (-2.2,  s * .04,  .10, 2.72, 2.58, 2.90, 2.72),
            ( .50,  s * .10,  .02, 2.70, 2.52, 2.82, 2.68),
        ], leg, "trouser", phase=i * 1.8, wrinkle_amp=.026)

        if i == 0:
            b.box("L Battery data case", (-2.95, -3.55, .45), (1.05, 2.75, 2.25), "metalDark", leg, .14)
            b.box("L Data case led", (-3.48, -2.85, .85), (.16, .36, .62), "lamp", leg, .03)
        else:
            b.box("R Compact holster", (2.88, -3.45, .55), (1.05, 2.95, 2.05), "leather", leg, .16)
            b.box("R Holster grip", (2.92, -2.05, .35), (.92, 1.35, 1.25), "metalDark", leg, .10, (-.25, 0, 0))

    # 2) 骨盆与观测员战术腰带
    b.anatomical_loft("Pelvis trouser", [
        (-2.5, 0.0, -.04, 5.05, 5.05, 3.82, 3.75),
        ( .5,  0.0,  .02, 5.38, 5.38, 4.08, 3.95),
        ( 3.2, 0.0,  .05, 5.28, 5.28, 4.00, 3.88),
        ( 4.3, 0.0,  .04, 5.05, 5.05, 3.82, 3.72),
    ], "hips", "trouser", phase=.2, wrinkle_amp=.018)
    b.anatomical_loft("Observer utility belt", [
        (.90, 0.0, .06, 5.65, 5.65, 4.35, 4.25),
        (2.45, 0.0, .06, 5.65, 5.65, 4.35, 4.25),
    ], "hips", "leather", phase=0, wrinkle_amp=0)
    b.box("Observer belt buckle", (0.0, 1.68, 4.48), (2.25, 1.48, .44), "steel", "hips", .08)
    for s in (-1, 1):
        b.box(f"Hip lens pouch {s}", (s * 4.85, 1.65, 2.85), (1.85, 2.25, 1.45), "rigOlive", "hips", .14, (0, s * .42, 0))

    # 3) 躯干：侦察战术背心 + 挂胸望远镜 + 真实褶皱分段式荒漠战术披肩与后披风（绝非充气蘑菇！）
    b.anatomical_loft("Observer torso undersuit", [
        ( -.5, 0.0,  .04, 5.05, 5.05, 3.85, 3.72),
        ( 2.8, 0.0,  .08, 5.38, 5.38, 4.02, 3.88),
        ( 6.6, 0.0,  .15, 6.25, 6.25, 4.55, 4.30),
        (10.0, 0.0,  .08, 6.55, 6.55, 4.60, 4.35),
        (12.2, 0.0, -.04, 5.35, 5.35, 3.75, 3.58),
        (13.8, 0.0, -.05, 2.95, 2.95, 2.90, 2.85),
    ], "torso", "rigOlive", phase=.5, wrinkle_amp=.020)

    # 胸口战术侦察挂具（从披肩 V 字前开襟中自然露出，打破单调大块米色）
    b.box("Recon chest panel", (0.0, 6.45, 4.45), (7.65, 5.85, 1.25), "rigOlive", "torso", .22)
    b.box("Chest team patch", (-2.65, 7.65, 5.08), (1.95, 1.15, .28), "team", "torso", .05)
    # 胸挂双筒光学望远镜（极具观测员辨识度的细节！）
    for s in (-1, 1):
        b.cylinder(f"Chest bino barrel {s}", (s * .85, 5.65, 4.85), (s * .85, 4.35, 6.15), .62, "metalDark", "torso", .06, 16)
        b.cylinder(f"Chest bino lens {s}", (s * .85, 4.42, 6.08), (s * .85, 4.25, 6.25), .48, "lamp", "torso", .03, 14)
    b.box("Chest bino bridge", (0.0, 5.15, 5.45), (1.75, .58, .72), "armorTan", "torso", .06, (.75, 0, 0))
    for k, x in enumerate((-2.35, 0.0, 2.35)):
        b.box(f"Chest sensor pouch {k}", (x, 3.45, 5.05), (1.85, 2.15, 1.15), "cloakTrim", "torso", .12)

    # 核心革新①：带硬朗肩线、自然折痕与前胸 V 形开襟的战术披肩（mantle）
    def tactical_mantle(u, v, high):
        # u: 0..1 从前左开襟绕经左肩、背部、右肩到前右开襟（跳过正中前胸 V 口）
        # 角度 ang: 前方为 0，+pi/2 为右，pi 为后，-pi/2 为左
        # 从左前 (+0.48 rad) 逆向绕一圈到右前 (+2*pi - 0.48 rad)
        gap = 0.50 + (1.0 - v) * 0.24  # 下摆前开襟略宽，露出战术胸挂与望远镜
        ang = gap + u * (math.tau - 2.0 * gap)
        # v: 0 = 披肩垂边(腰胸上方 y=6.2), 1 = 领口(y=12.6)
        # 肩部贴合、向下呈自然垂坠裙摆褶皱，而不是圆鼓鼓的充气球！
        drape_drop = (1.0 - v)
        # 7 道真实布料垂坠折痕（上窄下深），肩部留足余量彻底杜绝躯干穿模
        pleats = (math.sin(ang * 7.0 + .4) * .40 + math.cos(ang * 11.0 - .8) * .16) * (drape_drop ** 1.2)
        base_rx = 4.95 + 4.45 * (drape_drop ** .60)
        base_rz = 4.15 + 2.05 * (drape_drop ** .78)
        y = 12.75 - drape_drop * 5.85 + math.sin(ang * 5.0) * .30 * drape_drop
        y -= max(0.0, -math.cos(ang)) * 1.45 * drape_drop
        nx, nz = math.sin(ang), math.cos(ang)
        px = nx * (base_rx + pleats)
        pz = -.10 + nz * (base_rz + pleats * .75)
        return (px, y, pz), (nx, .38 * v, nz)

    b.curved_shell("Tactical draped mantle", tactical_mantle, 28, 10, 56, 20, .38, "cloakSand", "torso", bevel=.04)

    # 披肩前襟搭扣与双肩轻质战术护肩片（压出清晰的肩线骨架）
    b.box("Mantle clasp strap", (0.0, 10.75, 4.92), (4.15, .62, .38), "leather", "torso", .08)
    b.box("Mantle clasp buckle", (0.0, 10.75, 5.12), (1.05, .82, .26), "steel", "torso", .05)
    for s in (-1, 1):
        b.box(f"Mantle shoulder plate {s}", (s * 6.85, 11.45, .05), (3.15, .68, 4.25), "armorTan", "torso", .16, (0, 0, -s * .38))
        b.box(f"Mantle shoulder team {s}", (s * 8.15, 10.55, .05), (.38, 1.15, 2.35), "team", "torso", .06, (0, 0, -s * .38))

    # 核心革新②：后背多层飘逸侦察斗篷（自然风褶，从双肩后缘垂至膝后，100% 刚性挂于 torso）
    def rear_recon_cape(u, v, high):
        # u: 0..1 左肩到右肩；v: 0=底边(y=-6.5), 1=肩顶(y=12.0)
        ang = math.pi + (u - .5) * 1.85
        drop = 1.0 - v
        wave = (math.sin((u - .5) * math.pi * 5.0) * .58 + math.cos(u * math.pi * 8.0) * .22) * (drop ** 1.15)
        rx = 5.85 + drop * 2.85
        rz = 4.35 + drop * 3.85 + wave
        y = 12.15 - drop * 18.2 + math.cos((u - .5) * math.pi * 3.0) * .45 * drop
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, -.35 + nz * rz), (nx, -.06, nz)

    b.curved_shell("Rear draped recon cape", rear_recon_cape, 22, 12, 44, 24, .34, "cloakSand", "torso", bevel=.04)
    # 斗篷底边深色耐磨滚边视觉条
    def cape_hem_trim(u, v, high):
        ang = math.pi + (u - .5) * 1.85
        drop = 1.0 - v * .08
        wave = (math.sin((u - .5) * math.pi * 5.0) * .58 + math.cos(u * math.pi * 8.0) * .22) * (drop ** 1.15)
        rx = 5.85 + drop * 2.85 + .06
        rz = 4.35 + drop * 3.85 + wave + .06
        y = 12.15 - drop * 18.2 + math.cos((u - .5) * math.pi * 3.0) * .45 * drop
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, -.35 + nz * rz), (nx, -.06, nz)

    b.curved_shell("Cape hem dark trim", cape_hem_trim, 22, 3, 44, 6, .40, "cloakTrim", "torso", bevel=.03)

    # 核心革新③：工程感十足的肩背式光电侦察云台桅杆（替换旧版铁棍+黑盒）
    b.box("Sensor pack housing", (0.0, 6.85, -5.85), (6.85, 8.25, 3.25), "metalDark", "torso", .28)
    b.box("Sensor pack armor lid", (0.0, 8.15, -7.45), (5.45, 4.85, .58), "armorTan", "torso", .14)
    for k in range(3):
        b.box(f"Sensor vent fin {k}", (0.0, 4.25 + k * .65, -7.52), (4.25, .28, .35), "recess", "torso", .03)
    b.box("Sensor pack status led", (2.15, 10.15, -7.52), (1.15, .36, .20), "lamp", "torso", .04)

    # 左侧加固升降桅杆 + 盘绕信号电缆 + 多镜头光电云台
    mx, mz = -3.85, -6.15
    b.box("Mast base bracket", (mx, 10.65, mz), (1.85, 2.25, 1.85), "armorTan", "torso", .16)
    b.cylinder("Mast lower tube", (mx, 11.45, mz), (mx, 16.45, mz), .46, "metalDark", "torso", .05, 16)
    b.cylinder("Mast collar ring", (mx, 16.15, mz), (mx, 16.85, mz), .62, "steel", "torso", .06, 16)
    b.cylinder("Mast upper tube", (mx, 16.65, mz), (mx, 21.85, mz), .32, "steel", "torso", .04, 14)
    # 螺旋绕杆电缆
    coil = [(mx + math.cos(t * 2.2) * .56, 12.0 + t * .92, mz + math.sin(t * 2.2) * .56) for t in range(10)]
    b.cable("Mast signal cable", coil, .11, "rubber", "torso")

    # 光电云台头部（U形支架 + 装甲外壳 + 主光学大镜头 + 侧测距仪 + 顶迷你雷达罩）
    b.box("Gimbal yoke base", (mx, 22.15, mz), (3.45, .52, 1.65), "metalDark", "torso", .08)
    for s in (-1, 1):
        b.box(f"Gimbal yoke arm {s}", (mx + s * 1.65, 23.35, mz), (.42, 2.25, 1.25), "metalDark", "torso", .06)
    b.box("Optronic turret body", (mx, 23.55, mz + .35), (2.75, 2.35, 3.15), "metalDark", "torso", .22)
    b.box("Optronic turret shroud", (mx, 24.45, mz + .55), (2.95, .75, 3.45), "armorTan", "torso", .12)
    b.cylinder("Primary optic barrel", (mx - .45, 23.55, mz + 1.55), (mx - .45, 23.55, mz + 2.45), .78, "steel", "torso", .06, 18)
    b.cylinder("Primary optic lens", (mx - .45, 23.55, mz + 2.32), (mx - .45, 23.55, mz + 2.52), .62, "lamp", "torso", .03, 16)
    b.cylinder("Laser rangefinder", (mx + .82, 23.75, mz + 1.55), (mx + .82, 23.75, mz + 2.28), .36, "metalDark", "torso", .04, 14)
    b.cylinder("Laser rangefinder lens", (mx + .82, 23.75, mz + 2.22), (mx + .82, 23.75, mz + 2.36), .24, "lamp", "torso", .02, 12)
    b.cylinder("Mini radar dome", (mx, 24.85, mz + .25), (mx, 25.55, mz + .25), .85, "armorTan", "torso", .18, 16)

    # 4) 头部：带棱角褶皱的战术侦察兜帽 + 双目发光光电面镜 + 呼吸器（告别鹅卵石小头！）
    b.anatomical_loft("Neck gaiter", [
        (12.2, 0.0, -.05, 2.35, 2.35, 2.35, 2.35),
        (14.1, 0.0,  .05, 2.15, 2.15, 2.20, 2.15),
    ], "torso", "rigOlive", phase=.3, wrinkle_amp=.015)

    # 内层战术暗色侦察面罩与双目青蓝光学目镜
    b.anatomical_loft("Recon inner cowl", [
        (-1.65, 0.0, .15, 3.10, 3.10, 3.45, 3.40),
        ( .25,  0.0, .20, 3.45, 3.45, 3.85, 3.70),
        ( 2.15, 0.0, .10, 3.48, 3.48, 3.85, 3.78),
        ( 3.65, 0.0, -.05, 3.05, 3.05, 3.35, 3.35),
    ], "head", "metalDark", phase=0, wrinkle_amp=.010)
    b.box("Recon respirator jaw", (0.0, -.95, 3.62), (3.45, 1.85, 1.45), "metalDark", "head", .24, (-.14, 0, 0))
    b.box("Respirator grill", (0.0, -1.05, 4.35), (1.95, .95, .32), "steel", "head", .05)
    # 立体全景战术目镜 + 左眼增强光学瞄准圆筒
    def recon_visor(u, v, high):
        ang = (u - .5) * 1.95
        y = .45 + v * 1.65
        rx = 3.55
        rz = 3.92
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .35 + nz * rz), (nx, .05, nz)

    b.curved_shell("Recon tactical visor", recon_visor, 12, 4, 24, 8, .24, "visor", "head", bevel=.03)
    b.cylinder("Optic eye zoom pod", (-1.55, 1.25, 3.95), (-1.55, 1.25, 4.88), .66, "metalDark", "head", .06, 16)
    b.cylinder("Optic eye glow lens", (-1.55, 1.25, 4.82), (-1.55, 1.25, 4.98), .48, "lamp", "head", .03, 14)
    b.box("Right eye HUD strip", (1.35, 1.25, 4.32), (1.65, .48, .24), "lamp", "head", .04, (0, .20, 0))

    # 外层完全封闭顶部的棱角荒漠兜帽（侧面与后脑带自然折痕，额顶完全封合、前方留深邃遮光脸窗）
    def recon_hood(u, v, high):
        # 底部绕到脸颊前缘 (±2.25 rad)，上半部 (v>0.45) 平滑闭合至整圈覆盖额顶，彻底杜绝额顶三角缝！
        span = 4.50 + max(0.0, (v - .42) / .58) * (math.tau - 4.50)
        ang = (u - .5) * span
        world_ang = math.pi + ang
        crown = math.cos(v * math.pi * .5)
        arch = math.sin(min(1.0, .28 + v * .72) * math.pi)
        fold = math.sin(u * math.pi * 6.0 + v * 2.2) * .18 * arch
        rx = .18 + (4.25 * (crown ** .55) + .45 * arch) + fold
        rz = .55 + (4.45 * (crown ** .50) + .65 * arch) + (.95 * arch if abs(ang) > 1.35 else .25 * arch)
        y = -1.65 + 6.75 * math.sin(v * math.pi * .5)
        nx, nz = math.sin(world_ang), math.cos(world_ang)
        ny = .15 + .85 * (v ** 1.4)
        return (nx * rx, y, .08 + nz * rz), (nx * crown + .001, ny, nz * crown)

    b.curved_shell("Angular desert hood", recon_hood, 24, 12, 48, 24, .38, "cloakSand", "head", bevel=.04)
    # 额顶闭合兜帽内衬冠（与外层折褶兜帽及前檐无缝闭合，彻底消除额顶缝隙）
    b.anatomical_loft("Hood forehead crown", [
        (2.45, 0.0,  .35, 3.85, 3.85, 4.35, 3.85),
        (3.55, 0.0,  .30, 3.65, 3.65, 4.25, 3.75),
        (4.55, 0.0,  .05, 2.75, 2.75, 3.35, 3.15),
        (5.12, 0.0, -.15, 1.35, 1.35, 1.85, 1.85),
    ], "head", "cloakSand", phase=.5, wrinkle_amp=.012)
    # 顶部折叠遮光尖檐（从额顶平滑前探，遮住光学目镜上方）
    def hood_brow_peak(u, v, high):
        ang = (u - .5) * 2.15
        r = 3.15 + v * 2.35
        y = 3.45 - v * .95 + (1.0 - abs(u - .5) * 2.0) * .42
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * r, y, .35 + nz * r), (nx * .22, .95, nz * .22)

    b.curved_shell("Hood brow peak", hood_brow_peak, 14, 5, 28, 10, .34, "cloakSand", "head", bevel=.04)
    b.box("Hood crown crest seam", (0.0, 5.18, -.15), (.78, .42, 5.15), "cloakTrim", "head", .14, (-.12, 0, 0))

    # 5) 双臂：紧凑防风袖管 + 护腕 + 手套
    for i, side in enumerate(("L", "R")):
        s = -1 if i == 0 else 1
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"
        b.anatomical_loft(f"{side} Upper sleeve", [
            (-6.8, 0.0, 0.0, 1.56, 1.56, 1.66, 1.64),
            (-4.0, 0.0, 0.0, 1.80, 1.78, 1.90, 1.86),
            (-1.2, 0.0, 0.0, 2.00, 1.94, 2.05, 2.00),
            ( .5,  0.0, 0.0, 1.88, 1.82, 1.92, 1.88),
        ], arm, "rigOlive", phase=i * 1.4, wrinkle_amp=.022)

        b.anatomical_loft(f"{side} Forearm sleeve", [
            (-5.85, 0.0, .04, 1.38, 1.38, 1.44, 1.42),
            (-3.20, 0.0, .06, 1.60, 1.60, 1.68, 1.64),
            ( -.35, 0.0, .04, 1.76, 1.76, 1.82, 1.78),
        ], elbow, "rigOlive", phase=i * 1.7, wrinkle_amp=.020)

        b.box(f"{side} Wrist telemetry cuff", (s * .35, -3.55, .75), (2.45, 3.25, 1.65), "armorTan", elbow, .16)
        b.box(f"{side} Elbow guard", (0.0, -.45, -1.62), (2.05, 1.58, .68), "metalDark", elbow, .14)
        b.build_gloved_hand(side, s, hand, glove="glove", armor="armorTan", dark="leather",
                            pose="palm" if i == 0 else "grip", scale=.92)

    # 6) 左手（LHand）：加固荒漠野战战术雷达平板（带发光 tactical-radar-screen.png）
    b.box("Recon slate body", (.35, .55, 3.05), (6.55, .74, 8.25), "armorTan", "LHand", .18, (.22, 0, 0))
    b.box("Recon slate inner frame", (.35, .86, 3.00), (5.85, .28, 7.45), "metalDark", "LHand", .08, (.22, 0, 0))
    b.decal_panel("Recon radar screen", (.35, 1.02, 2.96), 5.35, 6.85, .08, "radarScreen", "LHand",
                  (-math.pi / 2 + .22, 0, 0), slot_override=2)
    for sx in (-3.05, 3.05):
        for sz in (-3.75, 3.75):
            b.box(f"Recon slate bumper {sx:.0f} {sz:.0f}",
                  (.35 + sx, .55 - sz * math.sin(.22), 3.05 + sz * math.cos(.22)),
                  (.85, .88, .98), "rubber", "LHand", .14, (.22, 0, 0))
    b.cylinder("Recon slate antenna",
               (3.45, .55 - 3.95 * math.sin(.22), 3.05 + 3.95 * math.cos(.22)),
               (3.45, .55 - 5.95 * math.sin(.22), 3.05 + 5.95 * math.cos(.22)), .14, "steel", "LHand", .03, 10)

    # 7) 右手（RHand）：紧凑型激光目标指示器／侦察测距仪（比旧版积木小手枪更契合观测员职能）
    b.extrusion("Designator grip", [
        (-.85, .35), (.85, .35), (.25, -2.45), (-1.20, -2.35),
    ], 0.0, 1.18, "glove", "RHand", .10)
    b.box("Designator body", (0.0, 1.55, 1.85), (1.75, 1.65, 5.45), "metalDark", "RHand", .16)
    b.box("Designator tan cowl", (0.0, 2.25, 2.05), (1.88, .75, 4.45), "armorTan", "RHand", .10)
    b.cylinder("Designator emitter barrel", (0.0, 1.65, 4.45), (0.0, 1.65, 5.75), .48, "steel", "RHand", .05, 16)
    b.cylinder("Designator laser lens", (0.0, 1.65, 5.65), (0.0, 1.65, 5.85), .36, "lamp", "RHand", .03, 14)
    b.box("Designator top sight", (0.0, 2.75, 1.45), (.78, .55, 2.25), "metalDark", "RHand", .06)

    b.extra_report["equipment"] = {
        "leftHand": "Expeditionary Tactical Radar Slate",
        "rightHand": "Laser Target Designator",
        "back": "Telescopic Multi-Lens Optronic Mast",
        "features": ["pleated open-front desert mantle", "angular optical hood", "draped rigid rear cape"],
    }


def main():
    args = parse_hero_args()
    builder = HeroBuilder(
        key="relay:observer",
        surface_name="observer",
        script_path=Path(__file__),
        palette=PALETTE,
        args=args,
        label="OBSERVER",
        workflow="Expeditionary Front forward observer / pleated desert cloak / optronic mast / radar slate / 2K PBR / rigid RT",
    )
    build_observer(builder)
    builder.bake_and_export()


if __name__ == "__main__":
    main()
