"""生群共生体有机生物雕塑生成器（Blender 高低模成对生成）。

覆盖全部 18 个生群模型（9 生物单位 + 9 有机建筑）：
- 单位：brood:behemoth, brood:worker, brood:broodling, brood:spitter,
        brood:bioWing, brood:sac, brood:nurturer, brood:infector, brood:binder
- 建筑：brood:base, brood:hatchery, brood:refinery, brood:gland,
        brood:lumbermill, brood:tower, brood:oilwell, brood:nursery, brood:burrow

核心美术突破：
1. 重叠瓦片式厚甲壳（中央背脊、后掠锯齿檐口、侧向生长肋纹、Pointiness 骨色磨损高光）；
2. 真正弯曲肌肉节肢腿与三趾巨爪/锐利虫爪（彻底取代直筒棍腿与扁平圆盘脚）；
3. 饱满半透明感琥珀腺体/虫卵/生物烟囱，表面紧贴 3D 立体分支血管；
4. 紧抓大地的血红筋腱菌毯根须建筑基座，与严格遵守游戏骨骼契约的平滑权重蒙皮。
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


BROOD_KEYS = {
    "brood:worker", "brood:broodling", "brood:spitter", "brood:behemoth",
    "brood:bioWing", "brood:sac", "brood:nurturer", "brood:infector", "brood:binder",
    "brood:base", "brood:refinery", "brood:lumbermill", "brood:tower",
    "brood:oilwell", "brood:hatchery", "brood:nursery", "brood:gland", "brood:burrow",
}

BROOD_MATERIALS = {
    # (sRGB base, ridge_hi, crevice_lo, roughness, metalness, kind)
    "chitinDark":    ((.31, .16, .085), (.56, .35, .18), (.09, .035, .018), .44, .06, "chitin"),
    "chitinLight":   ((.43, .23, .115), (.69, .47, .26), (.13, .055, .022), .40, .08, "chitin"),
    "chitinBelly":   ((.21, .10, .055), (.38, .20, .11), (.06, .025, .014), .42, .04, "chitin"),
    "flesh":         ((.42, .085, .068), (.66, .21, .16), (.12, .022, .018), .34, .00, "flesh"),
    "fleshDark":     ((.11, .028, .025), (.22, .06, .055), (.028, .007, .007), .26, .00, "flesh"),
    "vein":          ((.28, .042, .032), (.48, .095, .075), (.08, .014, .011), .28, .00, "flesh"),
    "bioSac":        ((.90, .37, .042), (1.00, .64, .13), (.34, .065, .018), .24, .02, "sac"),
    "bioSacDeep":    ((.78, .21, .042), (.96, .46, .11), (.26, .042, .016), .26, .02, "sac"),
    "bone":          ((.68, .55, .35),  (.90, .79, .57), (.24, .14, .07), .42, .02, "bone"),
    "wingMembrane":  ((.46, .095, .070), (.72, .24, .17), (.16, .032, .022), .44, .00, "flesh"),
    "team":          ((.68, .68, .68),  (.86, .86, .86), (.34, .34, .34), .42, .12, "team"),
    "lamp":          ((.95, .58, .14),  (1.00, .82, .35), (.60, .24, .05), .20, .05, "lamp"),
}


def _point(v):
    return Vector((v[0], -v[2], v[1]))


def _srgb(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def _smoothstep(a, b, x):
    if b == a:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def _bezier(pts, t):
    """通用 De Casteljau 贝塞尔曲线求值（支持 2/3/4 控制点）。"""
    cur = [Vector(p) for p in pts]
    while len(cur) > 1:
        cur = [cur[i].lerp(cur[i + 1], t) for i in range(len(cur) - 1)]
    return cur[0]


def _attr(mesh, name, size, data, domain="POINT"):
    kind, field = {1: ("FLOAT", "value"), 3: ("FLOAT_VECTOR", "vector"),
                   4: ("FLOAT_COLOR", "color")}[size]
    attr = mesh.attributes.get(name) or mesh.attributes.new(name=name, type=kind, domain=domain)
    attr.data.foreach_set(field, data)


def _select(objects, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def brood_material(name, slot=0):
    key = f"brood_bio:{name}:{slot}"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    rgb, hi_rgb, lo_rgb, rough, metal, kind = BROOD_MATERIALS[name]
    mat = bpy.data.materials.new(key)
    mat["slot"] = slot
    mat["surface"] = name
    mat["roughness"] = rough
    mat["metalness"] = metal
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = metal

    coord = nodes.new("ShaderNodeAttribute")
    coord.attribute_name = "_sculptCoord"

    # 有机大尺度色斑与斑驳肌理
    mottle = nodes.new("ShaderNodeTexNoise")
    mottle.inputs["Scale"].default_value = .11 if kind in {"chitin", "sac"} else .18
    mottle.inputs["Detail"].default_value = 6
    mottle.inputs["Roughness"].default_value = .68
    links.new(coord.outputs["Vector"], mottle.inputs["Vector"])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.name = "Baked base color"
    a, b = ramp.color_ramp.elements
    a.position, b.position = .18, .82
    a.color = tuple(_srgb(c * .78) for c in rgb) + (1,)
    b.color = tuple(_srgb(min(1.0, c * 1.18)) for c in rgb) + (1,)
    links.new(mottle.outputs["Fac"], ramp.inputs[0])
    color_out = ramp.outputs["Color"]

    # Pointiness 驱动生物凸脊磨损亮边 + 深邃甲壳/肌肉沟槽压暗（高度还原原画手绘体积感！）
    if kind != "lamp":
        geom = nodes.new("ShaderNodeNewGeometry")
        ridge = nodes.new("ShaderNodeMapRange")
        ridge.inputs["From Min"].default_value = .503
        ridge.inputs["From Max"].default_value = .562
        ridge.inputs["To Min"].default_value = 0.0
        ridge.inputs["To Max"].default_value = .78 if kind in {"chitin", "sac", "bone"} else .62
        links.new(geom.outputs["Pointiness"], ridge.inputs["Value"])
        hi_mix = nodes.new("ShaderNodeMixRGB")
        links.new(ridge.outputs[0], hi_mix.inputs[0])
        links.new(color_out, hi_mix.inputs[1])
        hi_mix.inputs[2].default_value = tuple(_srgb(c) for c in hi_rgb) + (1,)
        color_out = hi_mix.outputs[0]

        crevice = nodes.new("ShaderNodeMapRange")
        crevice.inputs["From Min"].default_value = .435
        crevice.inputs["From Max"].default_value = .497
        crevice.inputs["To Min"].default_value = .78 if kind in {"chitin", "flesh"} else .62
        crevice.inputs["To Max"].default_value = 0.0
        links.new(geom.outputs["Pointiness"], crevice.inputs["Value"])
        lo_mix = nodes.new("ShaderNodeMixRGB")
        links.new(crevice.outputs[0], lo_mix.inputs[0])
        links.new(color_out, lo_mix.inputs[1])
        lo_mix.inputs[2].default_value = tuple(_srgb(c) for c in lo_rgb) + (1,)
        color_out = lo_mix.outputs[0]

    # 生物专属程序纹理 + 法线微雕刻
    micro = nodes.new("ShaderNodeTexNoise")
    micro.inputs["Scale"].default_value = 1.6 if kind == "chitin" else 2.2
    micro.inputs["Detail"].default_value = 5
    micro.inputs["Roughness"].default_value = .72
    links.new(coord.outputs["Vector"], micro.inputs["Vector"])

    bump = nodes.new("ShaderNodeBump")
    if kind == "chitin":
        # 生长波纹 + 微细细胞纹（柔和自然，不再出现硬网状泥块）
        bands = nodes.new("ShaderNodeTexWave")
        bands.wave_type = "BANDS"
        bands.bands_direction = "Z"
        bands.inputs["Scale"].default_value = .55
        bands.inputs["Distortion"].default_value = 4.5
        bands.inputs["Detail"].default_value = 4
        links.new(coord.outputs["Vector"], bands.inputs["Vector"])
        mix_h = nodes.new("ShaderNodeMixRGB")
        mix_h.blend_type = "MULTIPLY"
        mix_h.inputs[0].default_value = .55
        links.new(bands.outputs["Fac"], mix_h.inputs[1])
        links.new(micro.outputs["Fac"], mix_h.inputs[2])
        links.new(mix_h.outputs[0], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .42
        bump.inputs["Distance"].default_value = .14
        # 轻微在颜色上叠加生长波纹明暗
        band_col = nodes.new("ShaderNodeMixRGB")
        band_col.blend_type = "MULTIPLY"
        band_col.inputs[0].default_value = .16
        links.new(color_out, band_col.inputs[1])
        links.new(bands.outputs["Color"], band_col.inputs[2])
        color_out = band_col.outputs[0]
    elif kind == "flesh":
        sinew = nodes.new("ShaderNodeTexWave")
        sinew.wave_type = "BANDS"
        sinew.bands_direction = "Y"
        sinew.inputs["Scale"].default_value = 1.15
        sinew.inputs["Distortion"].default_value = 6.2
        sinew.inputs["Detail"].default_value = 4
        links.new(coord.outputs["Vector"], sinew.inputs["Vector"])
        links.new(sinew.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .45
        bump.inputs["Distance"].default_value = .12
        sinew_col = nodes.new("ShaderNodeMixRGB")
        sinew_col.blend_type = "MULTIPLY"
        sinew_col.inputs[0].default_value = .22
        links.new(color_out, sinew_col.inputs[1])
        links.new(sinew.outputs["Color"], sinew_col.inputs[2])
        color_out = sinew_col.outputs[0]
    elif kind == "sac":
        cells = nodes.new("ShaderNodeTexVoronoi")
        cells.feature = "DISTANCE_TO_EDGE"
        cells.inputs["Scale"].default_value = .32
        links.new(coord.outputs["Vector"], cells.inputs["Vector"])
        # 半透明感发光琥珀血管网格
        vein_ramp = nodes.new("ShaderNodeValToRGB")
        e0, e1 = vein_ramp.color_ramp.elements
        e0.position, e0.color = .03, tuple(_srgb(c) for c in lo_rgb) + (1,)
        e1.position, e1.color = .20, tuple(_srgb(c) for c in hi_rgb) + (1,)
        links.new(cells.outputs["Distance"], vein_ramp.inputs[0])
        sac_mix = nodes.new("ShaderNodeMixRGB")
        sac_mix.inputs[0].default_value = .38
        links.new(color_out, sac_mix.inputs[1])
        links.new(vein_ramp.outputs["Color"], sac_mix.inputs[2])
        color_out = sac_mix.outputs[0]
        links.new(cells.outputs["Distance"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .30
        bump.inputs["Distance"].default_value = .09
    elif kind == "bone":
        flute = nodes.new("ShaderNodeTexWave")
        flute.wave_type = "BANDS"
        flute.bands_direction = "X"
        flute.inputs["Scale"].default_value = 1.6
        flute.inputs["Distortion"].default_value = 2.5
        links.new(coord.outputs["Vector"], flute.inputs["Vector"])
        links.new(flute.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .28
        bump.inputs["Distance"].default_value = .08
    else:
        links.new(micro.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .18 if kind != "lamp" else 0.0
        bump.inputs["Distance"].default_value = .05

    rough_map = nodes.new("ShaderNodeMapRange")
    rough_map.name = "Baked roughness"
    rough_map.inputs["To Min"].default_value = max(.14, rough - .09)
    rough_map.inputs["To Max"].default_value = min(.92, rough + .11)
    links.new(micro.outputs["Fac"], rough_map.inputs["Value"])
    links.new(rough_map.outputs[0], bsdf.inputs["Roughness"])

    links.new(color_out, bsdf.inputs["Base Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    emission = nodes.new("ShaderNodeEmission")
    emission.name = "Bake emission"
    links.new(color_out, emission.inputs["Color"])
    target = nodes.new("ShaderNodeTexImage")
    target.name = "Bake target"
    return mat


class BroodSculptor:
    """面向 18 个生群单位与建筑的高低模成对有机生物雕塑器。"""

    def __init__(self, key, rig, scene):
        self.key = key
        self.rig = rig
        self.scene = scene
        self.jids = {j["name"]: i for i, j in enumerate(rig)}
        self.orig = {j["name"]: Vector(j["origin"]) for j in rig}
        self.pairs = []

    def _finish_mesh(self, name, verts_game, faces, mat_name, slot, skin_fn, high):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([_point(v) for v in verts_game], [], faces)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(name + ("_H" if high else "_L"), mesh)
        self.scene.collection.objects.link(obj)
        for poly in mesh.polygons:
            poly.use_smooth = True

        coords, indices, weights = [], [], []
        for v in mesh.vertices:
            gx, gy, gz = v.co.x, v.co.z, -v.co.y
            coords.extend((gx, gy, gz))
            if not high:
                idx, w = skin_fn(gx, gy, gz)
                s = sum(w)
                if s <= 0:
                    idx, w = (0, 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
                else:
                    w = tuple(c / s for c in w)
                indices.extend(idx)
                weights.extend(w)

        _attr(mesh, "_sculptCoord", 3, coords)
        if not high:
            _attr(mesh, "_skinIndex", 4, indices)
            _attr(mesh, "_skinWeight", 4, weights)
        mesh.materials.append(brood_material(mat_name, slot))
        obj["slot"] = slot
        obj["part"] = -1
        return obj

    def rigid(self, joint_name):
        jid = self.jids[joint_name]
        return lambda gx, gy, gz: ((jid, 0, 0, 0), (1.0, 0.0, 0.0, 0.0))

    def blend_axis(self, j0, j1, axis, v0, v1):
        i0, i1 = self.jids[j0], self.jids[j1]
        def fn(gx, gy, gz):
            val = (gx, gy, gz)[axis]
            t = _smoothstep(v0, v1, val)
            if t <= .001:
                return (i0, 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
            if t >= .999:
                return (i1, 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
            return (i0, i1, 0, 0), (1.0 - t, t, 0.0, 0.0)
        return fn

    def add_pair(self, name, maker, mat_name, skin_fn, slot=0):
        if isinstance(skin_fn, str):
            skin_fn = self.rigid(skin_fn)
        low = self._finish_mesh(name, *maker(False), mat_name, slot, skin_fn, False)
        high = self._finish_mesh(name, *maker(True), mat_name, slot, skin_fn, True)
        self.pairs.append((low, high, slot))
        return low, high

    # ---------------- 核心有机生物雕塑原语 ----------------

    def organic_tube(self, name, ctrl_pts, r_fn, mat_name, skin_fn, slot=0,
                     steps_lo=10, steps_hi=26, sides_lo=12, sides_hi=24,
                     profile_fn=None, cap_start=True, cap_end=True):
        """沿 3D 贝塞尔曲线雕塑有机肢节/角/獠牙/菌毯根须/血管。
        r_fn(t) -> float 或 (rx, ry)；profile_fn(ang, t, high) -> radius_multiplier
        """
        def maker(high):
            steps = steps_hi if high else steps_lo
            sides = sides_hi if high else sides_lo
            centers = [_bezier(ctrl_pts, k / steps) for k in range(steps + 1)]
            verts, faces = [], []
            prev_bx = None
            for k, p in enumerate(centers):
                t = k / steps
                tang = centers[min(k + 1, steps)] - centers[max(k - 1, 0)]
                tang = Vector((0, 1, 0)) if tang.length < 1e-6 else tang.normalized()
                if prev_bx is None:
                    ref = Vector((0, 1, 0)) if abs(tang.y) < .88 else Vector((1, 0, 0))
                    bx = tang.cross(ref).normalized()
                else:
                    bx = prev_bx - tang * prev_bx.dot(tang)
                    if bx.length < 1e-5:
                        ref = Vector((0, 1, 0)) if abs(tang.y) < .88 else Vector((1, 0, 0))
                        bx = tang.cross(ref)
                    bx.normalize()
                by = tang.cross(bx).normalized()
                prev_bx = bx
                rr = r_fn(t)
                rx, ry = rr if isinstance(rr, tuple) else (rr, rr)
                for c in range(sides):
                    ang = c * math.tau / sides
                    m = 1.0 if profile_fn is None else profile_fn(ang, t, high)
                    v = p + bx * (math.cos(ang) * rx * m) + by * (math.sin(ang) * ry * m)
                    verts.append((v.x, v.y, v.z))
            for k in range(steps):
                for c in range(sides):
                    a, b = k * sides + c, k * sides + (c + 1) % sides
                    faces.append((a, b, b + sides, a + sides))
            if cap_start:
                tang0 = (centers[1] - centers[0]).normalized() if (centers[1] - centers[0]).length > 1e-6 else Vector((0, 1, 0))
                rr0 = r_fn(0.0); r0 = rr0[0] if isinstance(rr0, tuple) else rr0
                c0 = len(verts); p0 = centers[0] - tang0 * (r0 * .22)
                verts.append((p0.x, p0.y, p0.z))
                for c in range(sides):
                    faces.append((c0, (c + 1) % sides, c))
            if cap_end:
                tang1 = (centers[-1] - centers[-2]).normalized() if (centers[-1] - centers[-2]).length > 1e-6 else Vector((0, 1, 0))
                rr1 = r_fn(1.0); r1 = rr1[0] if isinstance(rr1, tuple) else rr1
                c1 = len(verts); p1 = centers[-1] + tang1 * (r1 * .22)
                verts.append((p1.x, p1.y, p1.z))
                base = steps * sides
                for c in range(sides):
                    faces.append((c1, base + c, base + (c + 1) % sides))
            return verts, faces
        return self.add_pair(name, maker, mat_name, skin_fn, slot)

    def carapace_plate(self, name, center, size, rot, mat_name, skin_fn, slot=0,
                       keel=.34, sweep=.28, ribs=4, overhang=.22):
        """重叠瓦片式有机厚甲壳（中央背脊棱、后掠锯齿檐口、侧向肋骨沟槽、下表面贴合收拢）。"""
        R = Euler(rot, "XYZ").to_matrix()
        C = Vector(center)
        w, h, d = size
        def maker(high):
            nu, nv = (28, 18) if high else (14, 9)
            verts, faces = [], []
            # 使用闭合经纬扁球变形为厚实拱形覆瓦甲壳（底面贴肉微凹，顶面隆脊分肋）
            for row in range(nv + 1):
                theta = .02 + (math.pi - .04) * row / nv
                # u_z: -1(后缘) .. +1(前缘)
                uz = math.cos(theta)
                rad = math.sin(theta)
                for col in range(nu):
                    ang = col * math.tau / nu
                    ux = math.cos(ang) * rad
                    uy = math.sin(ang) * rad
                    # 前窄后宽并向两侧后掠成覆瓦状盾形
                    x_s = ux * (.82 + .26 * (1.0 - uz) * .5)
                    z_s = uz - sweep * (x_s * x_s) + (.14 * max(0.0, uy) if uz < 0 else 0.0)
                    if uy >= 0:
                        # 中央脊棱（锋利且有机起伏）
                        ridge = keel * math.exp(-(x_s * x_s) * 14.0) * math.sqrt(max(0.0, 1.0 - uz * uz))
                        # 后缘翘檐（令每片甲壳像真实穿山甲/巨兽般层层叠压！）
                        lip = overhang * math.exp(-((uz + .72) / .24) ** 2) * (1.0 - .35 * x_s * x_s)
                        # 侧向斜掠生长肋纹与甲壳沟槽
                        rib_coord = uz * 1.15 - abs(x_s) * .68
                        rib_wave = math.cos(rib_coord * math.pi * ribs)
                        rib_relief = (.075 if high else .030) * rib_wave * math.sqrt(max(0.0, 1.0 - x_s * x_s))
                        # 细微生物颗粒与粗糙坑洼（高模投射至法线）
                        micro = (.022 if high else 0.0) * (math.sin(x_s * 31.0 + uz * 19.0) * math.cos(uz * 27.0))
                        y_s = uy * (.76 + ridge) + lip + rib_relief + micro
                    else:
                        y_s = uy * .26
                    p = C + R @ Vector((x_s * w * .5, y_s * h * .55, z_s * d * .5))
                    verts.append((p.x, p.y, p.z))
            for r in range(nv):
                for c in range(nu):
                    a, b = r * nu + c, r * nu + (c + 1) % nu
                    faces.append((a, a + nu, b + nu, b))
            c0 = len(verts); p0 = C + R @ Vector((0, 0, d * .5))
            verts.append((p0.x, p0.y, p0.z))
            for c in range(nu):
                faces.append((c0, c, (c + 1) % nu))
            c1 = len(verts); p1 = C + R @ Vector((0, h * overhang * .18, -d * .5))
            verts.append((p1.x, p1.y, p1.z))
            base = nv * nu
            for c in range(nu):
                faces.append((c1, base + (c + 1) % nu, base + c))
            return verts, faces
        return self.add_pair(name, maker, mat_name, skin_fn, slot)

    def flesh_mass(self, name, center, radii, rot, mat_name, skin_fn, slot=0, bulge=.14):
        """肌肉饱满、带筋腱起伏的有机肉体团块（腹腔、肩臀肌群、喉囊基座）。"""
        R = Euler(rot, "XYZ").to_matrix()
        C = Vector(center)
        rx, ry, rz = radii
        def maker(high):
            nu, nv = (26, 16) if high else (14, 9)
            verts, faces = [], []
            for j in range(1, nv):
                th = math.pi * j / nv
                st, ct = math.sin(th), math.cos(th)
                for i in range(nu):
                    ph = math.tau * i / nu
                    sinew = 1.0 + bulge * (.55 if not high else 1.0) * math.sin(ph * 5.0 + th * 3.0) * st
                    if high:
                        sinew += .04 * math.cos(ph * 11.0 - th * 7.0) * st
                    p = C + R @ Vector((rx * st * math.cos(ph) * sinew,
                                        ry * ct * sinew,
                                        rz * st * math.sin(ph) * sinew))
                    verts.append((p.x, p.y, p.z))
            top = len(verts); pt = C + R @ Vector((0, ry, 0)); verts.append((pt.x, pt.y, pt.z))
            bot = len(verts); pb = C + R @ Vector((0, -ry, 0)); verts.append((pb.x, pb.y, pb.z))
            for i in range(nu):
                ni = (i + 1) % nu
                faces.append((top, i, ni))
                base = (nv - 2) * nu
                faces.append((bot, base + ni, base + i))
            for j in range(nv - 2):
                for i in range(nu):
                    a, b = j * nu + i, j * nu + (i + 1) % nu
                    faces.append((a, a + nu, b + nu, b))
            return verts, faces
        return self.add_pair(name, maker, mat_name, skin_fn, slot)

    def curved_horn(self, name, ctrl_pts, r_base, r_tip, mat_name, skin_fn, slot=0,
                    blade=0.0, flutes=7, collar=True):
        """弯曲骨角、獠牙、刃爪：带外扩肉质角根、纵向角质凹槽、可选内刃扁截面。"""
        def r_fn(t):
            base = r_base * ((1.0 - t) ** .82) + r_tip * t
            if collar:
                base *= 1.0 + .22 * math.exp(-((t / .12) ** 2))
            if blade > 0:
                return (base * (1.0 - blade * .48), base * (1.0 + blade * .28))
            return base
        def prof(ang, t, high):
            fl = (0.045 if high else 0.018) * math.sin(ang * flutes + t * 3.5) * (1.0 - t * .5)
            ring = -(0.025 if high else 0.008) * (max(0.0, math.cos(t * 28.0)) ** 6) * (1.0 - t)
            return 1.0 + fl + ring
        return self.organic_tube(name, ctrl_pts, r_fn, mat_name, skin_fn, slot,
                                 steps_lo=9, steps_hi=22, sides_lo=10, sides_hi=20, profile_fn=prof)

    def bio_sac(self, name, center, radii, skin_fn, mat_name="bioSac", rot=(0, 0, 0),
                veins=5, pear=.22, open_top=False):
        """饱满发光琥珀生物腺体/卵囊/烟囱，自动贴附 3D 立体分支血管！"""
        R = Euler(rot, "XYZ").to_matrix()
        C = Vector(center)
        rx, ry, rz = radii
        def sac_pt(u, v, high):
            # v: 0(底) -> 1(顶)
            th = math.pi * (1.0 - v * (.88 if open_top else 1.0))
            st, ct = math.sin(th), math.cos(th)
            # 梨形/卵形下腹饱满、顶部略收（或烟囱口外翻）
            belly = 1.0 + pear * math.sin(v * math.pi) * (1.0 - v * .65)
            if open_top and v > .82:
                belly += .22 * ((v - .82) / .18) ** 2
            lobe = 1.0 + (.045 if high else .020) * math.sin(u * math.tau * 4.0 + v * 3.0) * st
            x = rx * st * math.cos(u * math.tau) * belly * lobe
            y = ry * ct
            z = rz * st * math.sin(u * math.tau) * belly * lobe
            return C + R @ Vector((x, y, z))

        def maker(high):
            nu, nv = (28, 18) if high else (14, 10)
            verts, faces = [], []
            for j in range(1, nv):
                v = j / nv
                for i in range(nu):
                    p = sac_pt(i / nu, v, high)
                    verts.append((p.x, p.y, p.z))
            bot = len(verts); pb = C + R @ Vector((0, -ry, 0)); verts.append((pb.x, pb.y, pb.z))
            for i in range(nu):
                faces.append((bot, (i + 1) % nu, i))
            for j in range(nv - 2):
                for i in range(nu):
                    a, b = j * nu + i, j * nu + (i + 1) % nu
                    faces.append((a, b, b + nu, a + nu))
            base = (nv - 2) * nu
            if open_top:
                # 烟囱顶部向内翻折形成深腔开口
                rim_center = C + R @ Vector((0, ry * .58, 0))
                inner_start = len(verts)
                for i in range(nu):
                    p_outer = Vector(verts[base + i])
                    p_in = p_outer.lerp(C + R @ Vector((0, ry * .86, 0)), .38)
                    verts.append((p_in.x, p_in.y, p_in.z))
                for i in range(nu):
                    ni = (i + 1) % nu
                    faces.append((base + i, base + ni, inner_start + ni, inner_start + i))
                c_in = len(verts); verts.append((rim_center.x, rim_center.y, rim_center.z))
                for i in range(nu):
                    faces.append((c_in, inner_start + i, inner_start + (i + 1) % nu))
            else:
                top = len(verts); pt = C + R @ Vector((0, ry, 0)); verts.append((pt.x, pt.y, pt.z))
                for i in range(nu):
                    faces.append((top, base + i, base + (i + 1) % nu))
            return verts, faces

        self.add_pair(name, maker, mat_name, skin_fn)
        # 仅沿囊体下半腰际包覆粗壮肉质根脉（不再在发光囊顶扎出细红点！）
        if veins > 0:
            v_r = max(.45, min(rx, ry, rz) * .065)
            for vi in range(veins):
                u0 = vi / veins + .07
                pts = []
                for k in range(5):
                    vv = .08 + k * .10
                    uu = u0 + .045 * math.sin(vv * 8.0 + vi * 1.7)
                    p = sac_pt(uu, vv, False)
                    dir_out = (p - C)
                    if dir_out.length > 1e-4:
                        p = p + dir_out.normalized() * (v_r * .55)
                    pts.append(p)
                self.organic_tube(f"{name}_RootVein{vi}", pts, lambda t, r=v_r: r * (1.25 - .90 * t),
                                  "vein", skin_fn, steps_lo=5, steps_hi=10, sides_lo=6, sides_hi=10)

    def arthropod_leg(self, prefix, hip_j, tip_j, s, heavy=False, ground_y=0.0):
        """弯曲肌肉节肢腿 + 紧贴曲面护甲片 + 真实三趾巨爪或锐利虫爪（彻底告别直棍与圆盘脚！）。"""
        p_hip = self.orig[hip_j]
        p_kne = self.orig[tip_j]
        # 饱满血红肌肉髋肩球（巨兽髋肩强壮如原画，自然过渡至甲壳股节）
        flesh_r = 6.2 if heavy else 2.5
        self.flesh_mass(f"{prefix}HipMuscle", p_hip + Vector((s * (1.5 if heavy else .5), .5, 0)),
                        (flesh_r * 1.15, flesh_r * .95, flesh_r * 1.12), (0, 0, 0), "flesh", hip_j)
        mid_fem = p_hip.lerp(p_kne, .48) + Vector((s * (2.6 if heavy else 1.4), 5.0 if heavy else 3.0, 0))
        r_fem = 4.5 if heavy else 1.78
        self.organic_tube(
            f"{prefix}Femur", [p_hip, mid_fem, p_kne],
            lambda t, r=r_fem: r * (1.16 - .30 * t + .20 * math.sin(t * math.pi)),
            "chitinDark", hip_j, steps_lo=8, steps_hi=18, sides_lo=10, sides_hi=20,
            profile_fn=lambda a, t, hi: 1.0 + (.14 if math.sin(a) > 0 else -.06) + (.045 if hi else .018) * math.cos(a * 6)
        )
        # 紧贴股节背脊的流线护甲片（不再像独立面包鼓包！）
        fem_dir = (p_kne - p_hip)
        yaw = math.atan2(fem_dir.x, fem_dir.z)
        self.carapace_plate(f"{prefix}FemurPlate", mid_fem + Vector((0, r_fem * .20, 0)),
                            (r_fem * 2.35, r_fem * 1.15, fem_dir.length * .82),
                            (-.12, yaw, -s * .32), "chitinLight", hip_j, keel=.24, ribs=3, overhang=.15)
        # 膝关节血红肌腱球 + 向后外掠出的锐利膝刺
        kn_r = 3.8 if heavy else 1.60
        self.flesh_mass(f"{prefix}KneeJoint", p_kne, (kn_r, kn_r, kn_r * 1.05), (0, 0, 0), "flesh", tip_j)
        self.curved_horn(f"{prefix}KneeSpur", [
            p_kne + Vector((s * kn_r * .3, kn_r * .2, 0)),
            p_kne + Vector((s * kn_r * 1.1, kn_r * 1.1, -1.0)),
            p_kne + Vector((s * kn_r * 1.4, kn_r * 2.0, -2.6)),
        ], 1.55 if heavy else .75, .18, "bone", tip_j, collar=False)

        # 胫节（tibia）：自然外弓向下延伸至地面，外侧流线贴合护胫甲
        foot_at = Vector((p_kne.x + s * (2.5 if heavy else 4.2), ground_y + (2.0 if heavy else .6),
                          p_kne.z + (3.8 if p_kne.z > 0 else -2.5)))
        mid_tib = p_kne.lerp(foot_at, .45) + Vector((s * (3.2 if heavy else 2.2), 1.8 if heavy else 1.2, 0))
        r_tib = 3.6 if heavy else 1.38
        self.organic_tube(
            f"{prefix}Tibia", [p_kne, mid_tib, foot_at],
            lambda t, r=r_tib: r * (1.08 - .32 * t + .20 * math.sin(t * math.pi)),
            "chitinDark", tip_j, steps_lo=8, steps_hi=18, sides_lo=10, sides_hi=20,
            profile_fn=lambda a, t, hi: 1.0 + (.12 * max(0.0, math.cos(a)) if s > 0 else .12 * max(0.0, -math.cos(a))) + (.04 if hi else .015) * math.cos(a * 6)
        )
        # 巨兽专属紧贴外侧护胫甲（轻虫已由胫节轮廓直接雕塑，避免小鼓包）
        if heavy:
            self.carapace_plate(f"{prefix}TibiaGuard", mid_tib + Vector((s * r_tib * .22, 0, .6)),
                                (r_tib * 1.65, (p_kne.y - ground_y) * .62, r_tib * 1.85),
                                (-.12, s * .35, s * .18), "chitinLight", tip_j, keel=.24, ribs=3, overhang=.14)

        # 真实有机爪足（巨兽三趾巨爪紧抓大地，轻虫锐利弯钩虫爪）
        if heavy:
            ankle = Vector((foot_at.x, ground_y + 2.2, foot_at.z))
            self.flesh_mass(f"{prefix}PawPad", ankle + Vector((0, -.7, 0)), (4.2, 2.0, 4.4), (0, 0, 0), "flesh", tip_j)
            self.carapace_plate(f"{prefix}FootPlate", ankle + Vector((0, 1.1, .4)), (8.2, 4.2, 8.6),
                                (.18, s * .15, 0), "chitinLight", tip_j, keel=.24, ribs=2)
            for ci, (ang_off, c_len, c_rad) in enumerate(((-.58, 6.2, 1.65), (0.0, 7.6, 2.05), (.58, 6.2, 1.65))):
                fwd_dir = Vector((math.sin(ang_off + s * .22), 0, math.cos(ang_off + s * .22)))
                p0 = ankle + fwd_dir * 2.2 + Vector((0, .5, 0))
                p1 = ankle + fwd_dir * (2.2 + c_len * .55) + Vector((0, 1.2, 0))
                p2 = ankle + fwd_dir * (2.2 + c_len) + Vector((0, -1.95, 0))
                self.curved_horn(f"{prefix}Talon{ci}", [p0, p1, p2], c_rad, .26, "bone", tip_j, blade=.25)
        else:
            out_dir = Vector((s * .55, 0, .55 if p_kne.z > 0 else -.35)).normalized()
            p0 = foot_at + Vector((0, 1.2, 0))
            p1 = foot_at + out_dir * 2.6 + Vector((0, .9, 0))
            p2 = foot_at + out_dir * 4.8 + Vector((0, -.55, 0))
            self.curved_horn(f"{prefix}ClawTip", [p0, p1, p2], 1.28, .14, "bone", tip_j, blade=.35)
            self.curved_horn(f"{prefix}DewClaw", [
                foot_at + Vector((0, 1.8, 0)),
                foot_at - out_dir * 1.5 + Vector((0, 1.4, 0)),
                foot_at - out_dir * 2.6 + Vector((0, .2, 0)),
            ], .72, .12, "bone", tip_j, collar=False)

    def creep_foundation(self, radius, lobes=9, tall=1.0):
        """生群建筑标志性波浪形有机菌毯基座（高细分柔和波浪边缘，彻底消除八边形红盘！）。"""
        def creep_maker(high):
            nu, nv = (48, 12) if high else (28, 7)
            verts, faces = [], []
            for j in range(1, nv + 1):
                v = j / nv  # 0(中心顶) -> 1(外缘着地)
                for i in range(nu):
                    ang = i * math.tau / nu
                    wave = 1.0 + .12 * math.sin(ang * lobes + .4) + .05 * math.cos(ang * (lobes * 2 - 1))
                    r = radius * .92 * v * wave
                    # 柔和丘状起伏并平滑落至地面 y=0.2，外缘自然圆润无折角
                    y = (5.4 * tall) * (1.0 - v * v) * (1.0 + (.10 if high else .05) * math.sin(ang * lobes * 2 + v * 6.0))
                    if j == nv:
                        y = .15
                    verts.append((math.sin(ang) * r, y, math.cos(ang) * r))
            top = len(verts); verts.append((0, 5.6 * tall, 0))
            bot = len(verts); verts.append((0, 0.0, 0))
            for i in range(nu):
                ni = (i + 1) % nu
                faces.append((top, i, ni))
            for j in range(nv - 1):
                for i in range(nu):
                    a, b = j * nu + i, j * nu + (i + 1) % nu
                    faces.append((a, a + nu, b + nu, b))
            base = (nv - 1) * nu
            for i in range(nu):
                ni = (i + 1) % nu
                faces.append((bot, base + ni, base + i))
            return verts, faces
        self.add_pair("CreepBed", creep_maker, "flesh", "root")

        for i in range(lobes):
            ang = i * math.tau / lobes + .14 * math.sin(i * 2.3)
            dx, dz = math.sin(ang), math.cos(ang)
            reach = radius * (.90 + .14 * math.sin(i * 1.9))
            p0 = Vector((dx * radius * .34, 9.2 * tall, dz * radius * .34))
            p1 = Vector((dx * reach * .72, 4.6 * tall, dz * reach * .72))
            p2 = Vector((dx * reach * 1.06, .7, dz * reach * 1.06))
            self.organic_tube(f"CreepRoot{i}", [p0, p1, p2],
                              lambda t, sc=radius: (sc * .11) * (1.15 - .80 * t),
                              "flesh", "root", steps_lo=7, steps_hi=14, sides_lo=8, sides_hi=14)
            self.carapace_plate(f"RootPlate{i}", (dx * reach * .72, 3.2 * tall, dz * reach * .72),
                                (radius * .22, 4.4 * tall, radius * .32),
                                (.22, ang, 0), "chitinDark", "root", keel=.28, ribs=2)
            self.curved_horn(f"RootSpur{i}", [
                (dx * reach * .88, 2.0, dz * reach * .88),
                (dx * reach * 1.05, 2.3, dz * reach * 1.05),
                (dx * reach * 1.18, .4, dz * reach * 1.18),
            ], max(1.3, radius * .050), .20, "bone", "root", collar=False)

    # ---------------- 9 个生群生物单位专属雕塑 ----------------

    def build_behemoth(self):
        """生群 · 破壳巨兽（对标原画旗舰！）：五层深棱厚甲壳、血红肌肉肩胯、巨型上翘犀角与四根弯獠牙、三趾巨爪。"""
        ry = self.orig["root"].y  # 21
        # 饱满肌肉躯干内腔与下腹筋腱
        self.flesh_mass("CoreBody", (0, ry - 1.2, -1.5), (14.5, 9.2, 18.5), (0, 0, 0), "flesh", "root", bulge=.16)
        self.flesh_mass("AbdomenFlesh", (0, ry - 2.0, -18.5), (12.0, 7.6, 11.5), (.12, 0, 0), "flesh", "abdomen", bulge=.15)

        # 五层层叠厚实拱形背甲（高耸中央脊骨 + 后掠锯齿檐口）
        plates = [
            (0, ry + 7.2, 10.5, 28.0, 14.5, 14.5, .14, "chitinLight", "root"),
            (0, ry + 8.8,  2.0, 32.0, 16.5, 16.0, .06, "chitinDark", "root"),
            (0, ry + 8.6, -7.2, 30.0, 15.8, 15.5, -.05, "chitinLight", "root"),
            (0, ry + 6.5, -16.0, 26.0, 13.5, 14.0, -.18, "chitinDark", "abdomen"),
            (0, ry + 3.2, -23.5, 19.5, 10.5, 12.0, -.32, "chitinLight", "abdomen"),
        ]
        for idx, (px, py, pz, pw, ph, pd, rx, mat, jn) in enumerate(plates):
            self.carapace_plate(f"DorsalPlate{idx}", (px, py, pz), (pw, ph, pd), (rx, 0, 0),
                                mat, jn, keel=.42, sweep=.34, ribs=5, overhang=.28)

        # 两侧外伸弯钩骨刺与背侧阵营生物棱脊
        for s in (-1, 1):
            self.carapace_plate(f"TeamCrest{s}", (s * 10.8, ry + 8.2, 5.5), (4.6, 3.6, 9.5),
                                (.10, s * .15, -s * .42), "team", "root", slot=1, keel=.25, ribs=2)
            for si, (sz, sx, slen, sr) in enumerate(((6.5, 13.8, 13.5, 2.8), (-2.5, 14.5, 15.0, 3.1), (-11.5, 13.2, 12.5, 2.5))):
                self.curved_horn(f"BackSpine{s}_{si}", [
                    (s * sx, ry + 4.8, sz),
                    (s * (sx + 4.8), ry + 11.2, sz - 3.2),
                    (s * (sx + 7.2), ry + 17.5 + (1 if si == 1 else 0), sz - 7.8),
                ], sr, .28, "bone", "root", blade=.22)

        # 头部：厚重装甲眉盾 + 巨大上翘弧形犀角 + 四根下弯獠牙/大颚 + 发光琥珀复眼
        hy, hz = self.orig["head"].y, self.orig["head"].z  # 21, 16
        self.flesh_mass("HeadMuscle", (0, hy - 1.2, hz + 3.0), (11.8, 7.2, 10.8), (.08, 0, 0), "flesh", "head")
        self.carapace_plate("HeadShield", (0, hy + 3.8, hz + 4.2), (27.5, 13.5, 21.0), (.24, 0, 0),
                            "chitinLight", "head", keel=.46, sweep=.32, ribs=4, overhang=.24)
        self.flesh_mass("MouthCavity", (0, hy - 2.6, hz + 10.8), (6.5, 2.8, 3.2), (0, 0, 0), "fleshDark", "head")
        # 标志性中央上翘巨型犀角
        self.curved_horn("MainRhinoHorn", [
            (0, hy + 5.2, hz + 7.5),
            (0, hy + 11.8, hz + 15.5),
            (0, hy + 21.5, hz + 20.5),
        ], 4.8, .38, "bone", "head", blade=.18, flutes=9)
        for s in (-1, 1):
            # 侧颊甲壳与发光眼
            self.carapace_plate(f"CheekPlate{s}", (s * 10.8, hy + .2, hz + 6.5), (10.5, 6.2, 14.5),
                                (.12, s * .30, -s * .35), "chitinDark", "head", keel=.28, ribs=2)
            self.flesh_mass(f"EyeSocket{s}", (s * 8.6, hy + 1.8, hz + 9.2), (2.2, 1.6, 1.8), (0, 0, 0), "fleshDark", "head")
            self.flesh_mass(f"EyeGlow{s}", (s * 8.9, hy + 1.8, hz + 10.2), (1.1, .85, .85), (0, 0, 0), "lamp", "head", slot=2)
            # 外侧大型弧形镰刀獠牙（前弯微内扣）
            self.curved_horn(f"OuterTusk{s}", [
                (s * 11.2, hy - 2.5, hz + 8.8),
                (s * 14.8, hy - 3.8, hz + 20.2),
                (s * 10.5, hy - 2.2, hz + 31.8),
            ], 3.3, .28, "bone", "head", blade=.32)
            # 内侧下弯破甲大颚
            self.curved_horn(f"InnerMandible{s}", [
                (s * 6.8, hy - 3.5, hz + 9.5),
                (s * 6.2, hy - 7.2, hz + 18.0),
                (s * 3.8, hy - 10.2, hz + 24.5),
            ], 2.5, .24, "bone", "head", blade=.30)

        # 四条粗壮拱形巨兽肢腿 + 三趾巨爪
        for s in (-1, 1):
            for i in range(2):
                self.arthropod_leg(f"BehLeg{s}_{i}", f"leg{s}:{i}", f"leg{s}:{i}tip", s, heavy=True)

    def _build_insect_body(self, w, h, d, plates_n=4, spine_scale=0.0, tail_plates=3,
                           abdomen_sac=None, dorsal_glands=None, spitter_neck=False, claws=None):
        """通用节肢生群生物骨架构造（worker / broodling / spitter / sac / nurturer / infector / binder）。"""
        ry = self.orig["root"].y
        self.flesh_mass("ThoraxFlesh", (0, ry - .8, 0), (w * .52, h * .55, d * .52), (0, 0, 0), "flesh", "root", bulge=.15)
        for i in range(plates_n):
            t = i / max(1, plates_n - 1)
            pz = 10.0 - t * 20.0
            pw = w * (1.08 - .14 * abs(t - .35))
            self.carapace_plate(f"TorsoPlate{i}", (0, ry + h * (.35 + .08 * math.sin(t * math.pi)), pz),
                                (pw, h * .82, 11.5), (.08 - t * .18, 0, 0),
                                "chitinLight" if i % 2 == 0 else "chitinDark", "root",
                                keel=.36, sweep=.30, ribs=4, overhang=.24)
            if spine_scale > 0 and i < plates_n - 1:
                for s in (-1, 1):
                    self.curved_horn(f"TorsoSpine{s}_{i}", [
                        (s * pw * .38, ry + h * .24, pz),
                        (s * pw * .52, ry + h * .55 + 3.2 * spine_scale, pz - 3.8),
                        (s * pw * .58, ry + h * .82 + 6.2 * spine_scale, pz - 8.5),
                    ], 2.0 * spine_scale, .22, "bone", "root", blade=.25, collar=False)

        for s in (-1, 1):
            self.carapace_plate(f"TeamMark{s}", (s * w * .34, ry + h * .46, 5.5), (3.4, 2.4, 6.8),
                                (.08, s * .15, -s * .38), "team", "root", slot=1, keel=.22, ribs=2)

        # 腹部：发光大囊体 OR 多节弯弧尾甲
        ay, az = self.orig["abdomen"].y, self.orig["abdomen"].z
        if abdomen_sac is not None:
            sx, sy, sz, sac_mat = abdomen_sac
            self.bio_sac("AbdomenSac", (0, ay + sy * .18, az - sz * .22), (sx, sy, sz), "abdomen",
                         mat_name=sac_mat, rot=(-.22, 0, 0), veins=7, pear=.18)
            for s in (-1, 1):
                for ci in range(3):
                    self.carapace_plate(f"SacCradle{s}_{ci}", (s * sx * .78, ay - 1.5, az + 6.5 - ci * sz * .52),
                                        (6.8, 7.5, 11.5), (.05, -s * .22, s * .55), "chitinDark", "abdomen", ribs=3)
        else:
            self.flesh_mass("AbdomenFlesh", (0, ay - 1.0, az - 4.0), (w * .38, h * .42, 9.5), (-.12, 0, 0), "flesh", "abdomen")
            for i in range(tail_plates):
                pw = w * (.82 - i * .16)
                self.carapace_plate(f"TailPlate{i}", (0, ay + h * .20 - i * 1.0, az + 3.0 - i * 6.5),
                                    (pw, h * .68, 10.5), (-.16 - i * .10, 0, 0),
                                    "chitinDark" if i % 2 else "chitinLight", "abdomen", keel=.34, ribs=3)

        # 可选背部成对腺体（nurturer / infector）
        if dorsal_glands == "infector":
            for s in (-1, 1):
                gx, gy, gz = self.orig[f"gland{s}"]
                big = 1.15 if s > 0 else .88
                self.flesh_mass(f"GlandBase{s}", (gx + s * 2.5, gy - 1.0, gz - 2.5), (6.5, 4.8, 7.5), (0, s * .2, 0), "flesh", f"gland{s}")
                self.bio_sac(f"SporeSac{s}", (gx + s * 4.5, gy + 5.8 * big, gz - 5.2),
                             (7.2 * big, 8.8 * big, 7.8 * big), f"gland{s}", mat_name="bioSac",
                             rot=(-.28, 0, -s * .24), veins=6, pear=.25)
                for ci in range(3):
                    self.carapace_plate(f"GlandRib{s}_{ci}", (gx + s * (4.5 + ci * .6), gy + 1.0 + ci * 1.2, gz + 1.5 - ci * 5.2),
                                        (8.5, 5.8, 7.5), (0, s * .15, -s * .45), "chitinDark", f"gland{s}", ribs=2)
        elif dorsal_glands == "nurturer":
            for s in (-1, 1):
                gx, gy, gz = self.orig[f"gland{s}"]
                self.flesh_mass(f"NurtBase{s}", (gx + s * 2.5, gy - .8, gz - 2.0), (6.5, 5.0, 8.2), (0, s * .2, 0), "flesh", f"gland{s}")
                self.bio_sac(f"NurtPod{s}", (gx + s * 4.2, gy + 4.8, gz - 4.5),
                             (6.8, 7.6, 8.2), f"gland{s}", mat_name="bioSacDeep",
                             rot=(-.18, 0, -s * .28), veins=6, pear=.18)
                for ci in range(3):
                    self.carapace_plate(f"NurtRib{s}_{ci}", (gx + s * (5.2 + ci * .5), gy + 5.8 - ci * 1.4, gz + .5 - ci * 4.5),
                                        (9.2, 4.2, 8.2), (0, s * .22, -s * .52), "chitinLight", f"gland{s}", ribs=2)

        # 吐酸虫抬升颈囊（spitter）
        if spitter_neck:
            self.organic_tube("SpitterNeck", [(0, ry, 8.5), (0, ry + 6.5, 14.5), (0, ry + 11.5, 19.5)],
                              lambda t: 5.5 - 1.2 * t, "flesh", "root", steps_lo=7, steps_hi=16)
            self.bio_sac("BileThroatSac", (0, ry + 6.8, 16.5), (6.8, 7.6, 6.8), "root",
                         mat_name="bioSac", rot=(.22, 0, 0), veins=5, pear=.20)

        # 头部雕塑（含眉甲、复眼与弯獠牙）
        hx, hy, hz = self.orig["head"]
        self.flesh_mass("HeadFlesh", (hx, hy - .8, hz + 1.5), (5.8, 3.8, 6.4), (0, 0, 0), "flesh", "head")
        self.carapace_plate("HeadCap", (hx, hy + 1.8, hz + 1.8), (13.8, 7.2, 14.5), (.18, 0, 0),
                            "chitinLight", "head", keel=.36, ribs=3)
        self.flesh_mass("MouthHole", (hx, hy - 1.4, hz + 7.2), (3.4, 1.5, 1.8), (0, 0, 0), "fleshDark", "head")
        if spitter_neck:
            self.organic_tube("AcidSnout", [(hx, hy - .5, hz + 4.0), (hx, hy - .8, hz + 14.5)],
                              lambda t: 3.8 * (1.0 - .25 * t), "chitinDark", "head")
            self.flesh_mass("AcidMaw", (hx, hy - .8, hz + 15.2), (2.6, 2.2, 1.4), (0, 0, 0), "fleshDark", "head")
            for s in (-1, 1):
                self.curved_horn(f"SnoutFang{s}", [
                    (s * 2.8, hy - .8, hz + 12.5), (s * 3.4, hy + .2, hz + 16.2), (s * 2.5, hy + 1.2, hz + 19.2)
                ], 1.25, .16, "bone", "head", collar=False)
        for s in (-1, 1):
            self.flesh_mass(f"EyeSock{s}", (s * 4.6, hy + .9, hz + 5.2), (1.3, 1.0, 1.1), (0, 0, 0), "fleshDark", "head")
            self.flesh_mass(f"EyeLamp{s}", (s * 4.8, hy + .9, hz + 5.9), (.72, .58, .58), (0, 0, 0), "lamp", "head", slot=2)
            self.curved_horn(f"Mandible{s}", [
                (s * 4.2, hy - 1.8, hz + 5.2),
                (s * 5.8, hy - 2.8, hz + 10.2),
                (s * 3.4, hy - 3.6, hz + 14.2),
            ], 1.65, .18, "bone", "head", blade=.28)
            self.curved_horn(f"BrowHorn{s}", [
                (s * 4.2, hy + 1.8, hz + .5),
                (s * 6.5, hy + 4.2, hz - 1.5),
                (s * 7.8, hy + 6.5, hz - 3.8),
            ], 1.35, .16, "chitinDark", "head", collar=False)

        # 6 条弯曲节肢腿与锐利虫爪
        for s in (-1, 1):
            for i in range(3):
                self.arthropod_leg(f"Leg{s}_{i}", f"leg{s}:{i}", f"leg{s}:{i}tip", s, heavy=False)

        # 可选前镰刀螯爪（worker / broodling / binder）
        if claws is not None:
            c_len, c_rad = claws
            for s in (-1, 1):
                cj = f"claw{s}"
                co = self.orig[cj]
                wrist = co + Vector((s * (3.2 if c_len < 12 else 5.8), 1.2, 8.8))
                self.organic_tube(f"ClawArm{s}", [co, co.lerp(wrist, .5) + Vector((s * 2.0, 1.8, 0)), wrist],
                                  lambda t: 2.6 - .5 * t, "chitinDark", cj)
                self.flesh_mass(f"ClawWrist{s}", wrist, (2.2, 2.0, 2.2), (0, 0, 0), "flesh", cj)
                self.curved_horn(f"ScytheBlade{s}", [
                    wrist,
                    wrist + Vector((s * 1.8, -1.0, c_len * .55)),
                    wrist + Vector((-s * 3.5, -5.8, c_len)),
                ], c_rad, .22, "bone", cj, blade=.55)

    def build_biowing(self):
        """生群 · 生物飞翼：肌肉流线虫体、卷曲骨刺毒尾、真实蝙蝠骨翼指架与扇贝状血红翼膜。"""
        ry = self.orig["root"].y  # 15
        self.flesh_mass("WingBody", (0, ry, 0), (8.2, 5.2, 15.5), (0, 0, 0), "flesh", "root")
        for i in range(3):
            self.carapace_plate(f"WingPlate{i}", (0, ry + 3.2 - i * .4, 8.5 - i * 7.5),
                                (16.5 - i * 1.5, 7.2, 11.5), (.08 - i * .10, 0, 0),
                                "chitinLight" if i % 2 == 0 else "chitinDark", "root", keel=.38, ribs=4)
        # 优雅卷曲长尾 + 尾针
        ay, az = self.orig["abdomen"].y, self.orig["abdomen"].z
        self.curved_horn("CurledTail", [
            (0, ay, az + 2.0), (0, ay - 2.2, az - 10.5), (0, ay - 4.8, az - 21.5), (0, ay - 1.2, az - 28.5)
        ], 4.2, .35, "chitinDark", "abdomen", blade=.18)
        for ti in range(3):
            self.carapace_plate(f"TailRing{ti}", (0, ay + 1.0 - ti * 1.2, az - 3.5 - ti * 6.0),
                                (10.5 - ti * 2.2, 5.2 - ti * .6, 7.2), (-.22, 0, 0), "chitinLight", "abdomen", ribs=2)
        # 凶悍飞龙头部
        hx, hy, hz = self.orig["head"]
        self.flesh_mass("WingHeadFlesh", (hx, hy - .5, hz + 1.5), (5.5, 3.6, 6.2), (0, 0, 0), "flesh", "head")
        self.carapace_plate("WingHeadCrest", (hx, hy + 2.2, hz + 1.8), (13.2, 7.0, 14.8), (.20, 0, 0),
                            "chitinLight", "head", keel=.42, ribs=3)
        for s in (-1, 1):
            self.flesh_mass(f"WingEye{s}", (s * 4.2, hy + .8, hz + 6.2), (.75, .60, .60), (0, 0, 0), "lamp", "head", slot=2)
            self.curved_horn(f"WingFang{s}", [
                (s * 3.8, hy - 1.6, hz + 5.5), (s * 4.8, hy - 2.5, hz + 10.8), (s * 2.8, hy - 3.2, hz + 14.5)
            ], 1.5, .16, "bone", "head", blade=.30)
            self.curved_horn(f"WingCrestHorn{s}", [
                (s * 3.8, hy + 2.2, hz), (s * 6.2, hy + 4.8, hz - 3.5), (s * 7.5, hy + 6.8, hz - 7.8)
            ], 1.4, .18, "bone", "head", collar=False)

        # 双翼：弯曲肌肉翼臂 + 前缘钩爪 + 4 根放射指骨 + 扇贝弧形皮质翼膜！
        for s in (-1, 1):
            wj = f"wing{s}"
            wo = self.orig[wj]  # (±7, 20, 0)
            elbow = wo + Vector((s * 14.0, 2.2, 9.5))
            wrist = wo + Vector((s * 26.5, 3.2, 4.5))
            tip0 = wo + Vector((s * 42.5, .8, -8.5))
            self.organic_tube(f"WingLeadBone{s}", [wo + Vector((0, -.5, 8.0)), elbow, wrist, tip0],
                              lambda t: 2.4 * (1.0 - .75 * t), "chitinDark", wj, steps_lo=10, steps_hi=22)
            self.carapace_plate(f"WingTeam{s}", wo + Vector((s * 7.5, 1.5, 6.2)), (7.2, 2.4, 4.2),
                                (0, s * .25, -s * .12), "team", wj, slot=1, keel=.2, ribs=2)
            # 翼腕前伸骨爪
            self.curved_horn(f"WingThumb{s}", [
                wrist, wrist + Vector((s * 2.5, 1.2, 5.5)), wrist + Vector((s * 1.2, -.5, 9.2))
            ], 1.15, .15, "bone", wj, collar=False)
            # 3 根放射状弯曲翼指骨
            finger_tips = [
                wo + Vector((s * 36.0, -.4, -15.5)),
                wo + Vector((s * 24.0, -.8, -19.0)),
                wo + Vector((s * 12.5, -1.0, -18.5)),
            ]
            for fi, ftip in enumerate(finger_tips):
                mid_f = wrist.lerp(ftip, .5) + Vector((0, 1.2, 0))
                self.organic_tube(f"WingFinger{s}_{fi}", [wrist, mid_f, ftip],
                                  lambda t: 1.05 * (1.0 - .75 * t), "bone", wj, steps_lo=6, steps_hi=12, sides_lo=6, sides_hi=10)
            # 扇贝状拱形翼膜（薄而光滑的双面曲面，边缘在指尖之间优雅内凹！）
            def wing_membrane_maker(high, ss=s, orig=wo):
                nu, nv = (28, 14) if high else (14, 7)
                verts, faces = [], []
                half_t = .36
                for layer in (1.0, -1.0):
                    for j in range(nv + 1):
                        v = j / nv  # 0(前缘骨) -> 1(后缘扇贝)
                        for i in range(nu + 1):
                            u = i / nu  # 0(翼根) -> 1(翼尖)
                            # 前缘曲线：翼根 -> 腕 -> 翼尖
                            lead = _bezier([orig + Vector((0, -.5, 8.0)),
                                            orig + Vector((ss * 20.0, 2.8, 8.5)),
                                            orig + Vector((ss * 41.5, .8, -8.2))], u)
                            # 后缘扇贝曲线：在指骨间优雅拱凹！
                            scallop = 4.6 * abs(math.sin(u * math.pi * 3.0)) ** .85
                            trail = orig + Vector((ss * (2.5 + u * 38.5), -1.2 + u * 1.4, -19.5 + u * 10.5 + scallop))
                            p = lead.lerp(trail, v)
                            # 翼膜中部受气流鼓起
                            camber = math.sin(v * math.pi) * (2.2 * (1.0 - u * .6))
                            ripple = (.22 if high else .08) * math.sin(u * math.pi * 12.0) * math.sin(v * math.pi)
                            verts.append((p.x, p.y + camber + ripple + layer * half_t, p.z))
                plane = (nu + 1) * (nv + 1)
                for j in range(nv):
                    for i in range(nu):
                        a = j * (nu + 1) + i
                        faces.append((a, a + 1, a + nu + 2, a + nu + 1))
                        b = plane + a
                        faces.append((b, b + nu + 1, b + nu + 2, b + 1))
                for i in range(nu):
                    faces.append((i, plane + i, plane + i + 1, i + 1))
                    b = nv * (nu + 1) + i
                    faces.append((b, b + 1, plane + b + 1, plane + b))
                for j in range(nv):
                    a = j * (nu + 1)
                    faces.append((a, a + nu + 1, plane + a + nu + 1, plane + a))
                    b = j * (nu + 1) + nu
                    faces.append((b, plane + b, plane + b + nu + 1, b + nu + 1))
                return verts, faces
            self.add_pair(f"WingMembrane{s}", wing_membrane_maker, "wingMembrane", wj)

    # ---------------- 9 个生群有机建筑专属雕塑 ----------------

    def _build_hive_dome(self, r, height, base_like=False, burrow=False, sacs_flank=False):
        """生群核心穹顶建筑家族（base / hatchery / burrow / lumbermill / refinery / gland 共用有机穹顶核）。"""
        self.creep_foundation(r, lobes=10 if base_like else 8, tall=1.15 if base_like else .95)
        # 肌肉内丘（绑定 shell 随呼吸起伏）
        self.flesh_mass("HiveCoreFlesh", (0, 5.0 + height * .36, -4.0),
                        (r * .74, height * .48, r * .72), (0, 0, 0), "flesh", "shell", bulge=.16)
        # 多层层叠深棱厚甲壳穹顶
        tiers = 5 if base_like else 4
        for i in range(tiers):
            t = i / max(1, tiers - 1)
            pz = r * .42 - t * r * .88
            pw = r * (1.46 - .22 * abs(t - .35))
            ph = height * ((.78 if burrow else 1.05) + .16 * math.sin(t * math.pi))
            self.carapace_plate(f"HiveRoofPlate{i}", (0, 5.0 + height * (.34 + .18 * (1.0 - t)), pz),
                                (pw, ph, r * .58), (.16 - t * .30, 0, 0),
                                "chitinLight" if i % 2 == 0 else "chitinDark", "shell",
                                keel=.40, sweep=.34, ribs=5, overhang=.26)
            # 仅在中后部优雅向后掠出弧形甲壳背刺（彻底告别对称竖直白栅栏！）
            if i in (1, 3) or (base_like and i == 4):
                horn_h = (13.5 if i == 4 else 9.5 if base_like else 6.2)
                for s in (-1, 1):
                    self.curved_horn(f"RoofRidgeHorn{s}_{i}", [
                        (s * pw * .34, 5.0 + height * .46, pz - 1.0),
                        (s * pw * .46, 5.0 + height * .64 + horn_h * .6, pz - 6.5),
                        (s * pw * .52, 5.0 + height * .74 + horn_h, pz - 13.5),
                    ], 3.4 if base_like else 2.2, .30, "chitinDark", "shell", collar=False)

        # 前部拱形血红肉唇入口大口 + 两对大獠牙
        ez = r * .68
        self.flesh_mass("EntranceLip", (0, 10.5, ez), (15.5, 9.8, 6.2), (0, 0, 0), "flesh", "shell")
        self.flesh_mass("EntranceCavity", (0, 9.8, ez + 3.2), (10.8, 6.8, 3.2), (0, 0, 0), "fleshDark", "shell")
        for s in (-1, 1):
            self.curved_horn(f"GateArchHorn{s}", [
                (s * 12.5, 7.5, ez + 1.0),
                (s * 10.2, 18.5, ez + 4.0),
                (s * 4.5, 25.5 if base_like else 21.0, ez + 5.5),
            ], 4.2 if base_like else 3.2, .35, "chitinDark", "shell")
            self.curved_horn(f"GateFang{s}", [
                (s * 9.5, 13.5, ez + 3.0),
                (s * 7.8, 15.5, ez + 8.5),
                (s * 5.2, 14.5, ez + 13.8),
            ], 2.4, .22, "bone", "shell", blade=.25)
            # 醒目阵营色生物徽甲
            self.carapace_plate(f"HiveTeam{s}", (s * r * .36, 5.0 + height * .66, 8.5),
                                (6.8, 4.2, 12.5), (.12, s * .18, -s * .35), "team", "shell", slot=1, keel=.22, ribs=2)

        # 基地与孵化巢两侧嵌入发光琥珀卵囊群 + 护肋甲壳
        if sacs_flank:
            for s in (-1, 1):
                for ci in range(3):
                    sz = 14.0 - ci * 16.5
                    self.bio_sac(f"FlankSac{s}_{ci}", (s * (r - 9.5), 10.5 + ci * 1.4, sz),
                                 (7.5, 8.2 + ci * 1.1, 8.8), "root", mat_name="bioSac",
                                 rot=(0, 0, -s * .28), veins=5, pear=.22)
                    self.carapace_plate(f"FlankRib{s}_{ci}", (s * (r - 6.8), 14.2 + ci * 1.2, sz - 2.2),
                                        (12.5, 6.8, 15.5), (.08, s * .22, -s * .55), "chitinDark", "root", ribs=3)
            if base_like:
                self.carapace_plate("BaseCrownCap", (0, 39.5, -18.5), (30.0, 17.5, 32.0), (-.14, 0, 0),
                                    "chitinLight", "shell", keel=.46, ribs=4)
                for s in (-1, 1):
                    self.curved_horn(f"BaseGrandHorn{s}", [
                        (s * 14.5, 28.0, -21.0), (s * 19.5, 42.0, -25.5), (s * 22.0, 56.0, -29.0)
                    ], 5.2, .45, "bone", "shell")

    def build_chimney_building(self, is_gland=False):
        """生群 · 精炼腺体 / 进化腺腔：有机穹顶基座 + 三座形态各异的饱满发光琥珀生物烟囱！"""
        self._build_hive_dome(36.0, 23.0, base_like=False, burrow=False, sacs_flank=False)
        heights = [25.0, 39.0, 30.0] if not is_gland else [28.0, 42.0, 33.0]
        for i in range(3):
            gj = f"gland{i}"
            go = self.orig[gj]
            h = heights[i]
            tilt_x = (i - 1) * .09
            tilt_z = (.08 if i == 1 else -.06)
            # 粗壮肌肉底座连结穹顶
            self.organic_tube(f"ChimneyStalk{i}", [
                go + Vector((0, -3.5, 0)),
                go + Vector(((i - 1) * 1.2, h * .45, 0)),
                go + Vector(((i - 1) * 1.6, h * .92, 0)),
            ], lambda t: 7.5 - 1.4 * t, "flesh", gj, steps_lo=7, steps_hi=16)
            # 饱满梨形发光琥珀烟囱囊体（顶部翻边开口！）
            self.bio_sac(f"ChimneySac{i}", go + Vector(((i - 1) * 1.0, h * .48, 0)),
                         (9.2 if is_gland else 8.4, h * .44, 8.8 if is_gland else 8.2), gj,
                         mat_name="bioSac", rot=(tilt_z, 0, tilt_x), veins=6, pear=.28, open_top=True)
            # 环抱烟囱的甲壳护肋与顶部开口厚唇环
            for s in (-1, 1):
                self.curved_horn(f"ChimneyRib{i}_{s}", [
                    go + Vector((s * 8.5, -2.5, 0)),
                    go + Vector((s * 9.5, h * .42, 0)),
                    go + Vector((s * 5.8 + (i - 1), h * .95, 0)),
                ], 2.8, .95, "chitinDark", gj, collar=False)
            self.carapace_plate(f"ChimneyRim{i}", go + Vector(((i - 1) * 1.4, h * .95, 0)),
                                (13.8, 5.2, 13.2), (0, 0, 0), "chitinLight", gj, keel=.15, ribs=3)
            self.flesh_mass(f"ChimneyBore{i}", go + Vector(((i - 1) * 1.4, h * 1.01, 0)),
                            (4.2, 1.2, 3.8), (0, 0, 0), "fleshDark", gj)

    def build_tower_or_well(self, is_tower):
        """生群 · 孢子尖塔 / 生物油井：八根张扬肌肉根柱 + 环抱甲壳肋环与肌肉节结 + 装甲炮首 / 螺旋骨钻！"""
        self.creep_foundation(21.5, lobes=8, tall=1.15)
        # 粗壮肌肉脊柱茎干（带明显横向肌节鼓包起伏，而非光溜直筒！）
        self.organic_tube("SpireSpine", [(0, 4.0, 0), (0, 20.0, -1.8), (0, 35.5, -2.5)],
                          lambda t: (11.5 - 3.4 * t) * (1.0 + .12 * math.sin(t * math.pi * 6.0)),
                          "flesh", "root", steps_lo=12, steps_hi=26, sides_lo=14, sides_hi=26)
        # 4 层环抱全周的弯曲甲壳护肋（前/侧/后均清晰可见层叠装甲与肌肉节结！）
        for ri in range(4):
            y = 10.5 + ri * 6.5
            rw = 23.0 - ri * 2.2
            self.carapace_plate(f"StalkBackPlate{ri}", (0, y, -3.5), (rw, 5.6, rw * .82),
                                (-.12, 0, 0), "chitinLight" if ri % 2 == 0 else "chitinDark", "root", keel=.28, ribs=4)
            for s in (-1, 1):
                self.carapace_plate(f"StalkSideRib{ri}_{s}", (s * (rw * .42), y - .5, .8),
                                    (rw * .42, 4.8, rw * .58), (.10, s * .65, -s * .48),
                                    "chitinDark" if ri % 2 == 0 else "chitinLight", "root", keel=.22, ribs=2)
                self.flesh_mass(f"StalkMuscleNode{ri}_{s}", (s * (rw * .38), y + 2.4, 2.2),
                                (3.6 - ri * .3, 2.8, 3.6 - ri * .3), (0, 0, 0), "flesh", "root")
        for s in (-1, 1):
            self.organic_tube(f"SpireButtress{s}", [
                (s * 17.5, 2.2, -1.5), (s * 12.2, 17.5, -2.5), (s * 6.8, 34.0, -2.2)
            ], lambda t: 3.4 * (1.0 - .45 * t), "chitinDark", "root")

        co = self.orig["crown"]  # (0, 36, -2)
        self.carapace_plate("CrownHood", co + Vector((0, 2.2, .8)), (25.5, 13.5, 24.5), (.18, 0, 0),
                            "chitinLight", "crown", keel=.42, ribs=4)
        self.carapace_plate("CrownTeam", co + Vector((0, 7.2, -3.5)), (7.8, 3.2, 8.8), (-.12, 0, 0),
                            "team", "crown", slot=1, keel=.20, ribs=2)
        if is_tower:
            # 生物炮首：鼓胀发光喉囊 + 层叠护甲吻部 + 肉质厚唇炮口 + 两侧弯獠牙
            self.bio_sac("CannonThroat", co + Vector((0, -2.8, 7.5)), (7.2, 6.2, 8.5), "crown",
                         mat_name="bioSac", rot=(.18, 0, 0), veins=4)
            self.organic_tube("CannonBarrel", [
                co + Vector((0, .8, 3.0)), co + Vector((0, 1.5, 12.0)), co + Vector((0, .6, 20.5))
            ], lambda t: 6.4 * (1.0 - .18 * t + .14 * math.sin(t * math.pi)), "chitinDark", "crown")
            self.carapace_plate("CannonSnoutCap", co + Vector((0, 4.2, 11.5)), (14.2, 7.5, 16.5), (.20, 0, 0),
                                "chitinLight", "crown", keel=.36, ribs=3)
            self.flesh_mass("CannonLip", co + Vector((0, .6, 20.2)), (5.4, 4.8, 2.6), (0, 0, 0), "flesh", "crown")
            self.flesh_mass("CannonMuzzle", co + Vector((0, .6, 21.8)), (3.8, 3.2, 1.6), (0, 0, 0), "fleshDark", "crown")
            self.flesh_mass("CannonCoreLamp", co + Vector((0, .6, 22.8)), (1.7, 1.4, 1.1), (0, 0, 0), "lamp", "crown", slot=2)
            for s in (-1, 1):
                self.curved_horn(f"TowerHorn{s}", [
                    co + Vector((s * 9.5, 2.0, 4.0)), co + Vector((s * 12.8, 4.2, 12.5)), co + Vector((s * 10.0, 3.2, 19.5))
                ], 2.5, .26, "bone", "crown", blade=.25)
        else:
            # 油井高耸螺旋骨角钻尖 + 环绕血红抽取肌腱
            self.curved_horn("WellDrillSpire", [
                co + Vector((0, 2.5, 0)), co + Vector((0, 15.0, -2.2)), co + Vector((0, 27.5, -5.8))
            ], 7.8, .55, "bone", "crown", flutes=9)
            for s in (-1, 1):
                self.organic_tube(f"WellTendon{s}", [
                    co + Vector((s * 6.0, 0, 1.5)), co + Vector((s * 11.5, -13.0, 5.5)), co + Vector((s * 14.5, -27.0, 7.5))
                ], lambda t: 3.0 - .6 * t, "flesh", "crown")

    def build_nursery(self):
        """生群 · 孵化池：血红火山口状菌毯盆地 + 8 片外倾护壁甲壳 + 6 枚发光脉络琥珀虫卵。"""
        self.creep_foundation(36.0, lobes=9, tall=.85)
        self.flesh_mass("PoolBasin", (0, 5.2, 0), (28.5, 3.8, 26.5), (0, 0, 0), "fleshDark", "root", bulge=.10)
        for i in range(8):
            ang = i * math.tau / 8.0
            dx, dz = math.sin(ang), math.cos(ang)
            self.carapace_plate(f"CraterWall{i}", (dx * 25.5, 7.2, dz * 23.5),
                                (18.5, 10.5, 13.5), (.28, ang, 0),
                                "chitinLight" if i % 2 == 0 else "chitinDark", "root", keel=.32, ribs=3)
        eo = self.orig["eggs"]  # (0, 8, 0)
        egg_specs = [
            (-11.5, -6.5, 8.2, 11.2, (.18, .1, -.22)),
            (8.5,  -9.5, 9.5, 13.8, (-.14, .2, .18)),
            (1.5,  10.5, 7.5, 10.2, (.22, 0, .12)),
            (-13.5, 10.5, 6.2, 8.2, (.15, -.2, -.28)),
            (15.5,  6.2, 6.8, 9.2, (-.12, .1, .26)),
            (-1.5,  -.8, 7.2, 10.6, (.06, 0, -.08)),
        ]
        for idx, (ex, ez, er, eh, erot) in enumerate(egg_specs):
            self.bio_sac(f"BroodEgg{idx}", eo + Vector((ex, eh * .42, ez)), (er * .82, eh * .62, er * .86),
                         "eggs", mat_name="bioSac", rot=erot, veins=5, pear=.20)
            for s in (-1, 1):
                self.carapace_plate(f"EggCup{idx}_{s}", eo + Vector((ex + s * er * .48, 1.2, ez)),
                                    (er * .85, 5.2, er * 1.15), (.12, 0, -s * .55), "chitinDark", "eggs", ribs=2)
        self.carapace_plate("NurseryTeam", eo + Vector((0, .8, 24.0)), (11.5, 3.6, 5.8), (.22, 0, 0),
                            "team", "eggs", slot=1, keel=.22, ribs=2)

    def build_lumbermill(self):
        """生群 · 咬木虫巢：有机穹顶 + 一对可动巨型锯齿碎木大颚（jaw-1 / jaw1）。"""
        self._build_hive_dome(36.0, 31.0, base_like=False, burrow=False, sacs_flank=False)
        for s in (-1, 1):
            jj = f"jaw{s}"
            jo = self.orig[jj]  # (±12, 11, 24)
            self.carapace_plate(f"JawBlade{s}", jo + Vector((s * 1.5, 0, 5.5)), (11.5, 8.5, 22.5),
                                (.06, -s * .18, s * .25), "chitinLight", jj, keel=.38, ribs=4)
            self.curved_horn(f"JawTip{s}", [
                jo + Vector((0, 0, 10.0)), jo + Vector((-s * 2.5, 1.2, 18.5)), jo + Vector((-s * 8.5, 1.8, 23.5))
            ], 3.4, .28, "bone", jj, blade=.45)
            for ti in range(4):
                self.curved_horn(f"JawTooth{s}_{ti}", [
                    jo + Vector((-s * 3.5, .8, 10.5 - ti * 4.8)),
                    jo + Vector((-s * 7.8, 1.8, 10.5 - ti * 4.8)),
                    jo + Vector((-s * 10.8, 2.8, 11.2 - ti * 4.8)),
                ], 1.65, .18, "bone", jj, collar=False)

    def build(self):
        k = self.key
        if k == "brood:behemoth":
            self.build_behemoth()
        elif k == "brood:worker":
            self._build_insect_body(20.0, 10.0, 27.0, plates_n=4, spine_scale=0.0, claws=(10.5, 2.2))
        elif k == "brood:broodling":
            self._build_insect_body(17.5, 9.5, 28.0, plates_n=4, spine_scale=.68, claws=(17.5, 2.8))
        elif k == "brood:spitter":
            self._build_insect_body(17.5, 10.5, 27.0, plates_n=4, spine_scale=.42, spitter_neck=True)
        elif k == "brood:bioWing":
            self.build_biowing()
        elif k == "brood:sac":
            self._build_insect_body(16.0, 9.5, 25.0, plates_n=3, abdomen_sac=(15.5, 13.0, 18.5, "bioSac"))
        elif k == "brood:nurturer":
            self._build_insect_body(17.5, 10.0, 26.0, plates_n=3, abdomen_sac=(12.2, 9.2, 14.5, "bioSacDeep"), dorsal_glands="nurturer")
        elif k == "brood:infector":
            self._build_insect_body(17.5, 10.0, 26.0, plates_n=3, abdomen_sac=(10.2, 8.6, 12.2, "bioSac"), dorsal_glands="infector")
        elif k == "brood:binder":
            self._build_insect_body(14.0, 10.5, 28.0, plates_n=4, spine_scale=.85, claws=(19.5, 2.6))
        elif k == "brood:base":
            self._build_hive_dome(49.0, 43.0, base_like=True, sacs_flank=True)
        elif k == "brood:hatchery":
            self._build_hive_dome(36.0, 31.0, base_like=False, sacs_flank=True)
        elif k == "brood:burrow":
            self._build_hive_dome(36.0, 19.0, base_like=False, burrow=True)
            for s in (-1, 1):
                self.curved_horn(f"BurrowTusk{s}", [
                    (s * 24.0, 3.5, 5.0), (s * 17.5, 9.5, 18.0), (s * 8.5, 15.5, 29.0)
                ], 4.2, .32, "bone", "shell")
        elif k == "brood:refinery":
            self.build_chimney_building(is_gland=False)
        elif k == "brood:gland":
            self.build_chimney_building(is_gland=True)
        elif k == "brood:lumbermill":
            self.build_lumbermill()
        elif k == "brood:tower":
            self.build_tower_or_well(is_tower=True)
        elif k == "brood:oilwell":
            self.build_tower_or_well(is_tower=False)
        elif k == "brood:nursery":
            self.build_nursery()
        else:
            raise ValueError("Unsupported Brood key: " + k)
        return self.pairs
