"""程序化解剖级人形角色雕塑生成器（Blender 高低模成对生成）。

覆盖五个阵营人形单位：
- relay:ranger       （远行者 · 线列步兵）
- relay:pathfinder   （远行者 · 探路工程兵）
- relay:observer     （远行者 · 侦察观察员）
- industrial:medic   （工业联邦 · 战地医疗兵）
- industrial:commander（工业联邦 · 战地指挥官）

严格遵循游戏源码骨骼契约（15 骨骼名称/顺序/原点）、材质槽（0=实体/1=阵营色/2=灯光）
及高低模分离投射烘焙规范。所有坐标在游戏坐标系 (X右, Y上, Z前) 中定义，通过 point() 转入 Blender。
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


HUMANOID_KEYS = {
    "relay:ranger",
    "relay:pathfinder",
    "relay:observer",
    "industrial:medic",
    "industrial:commander",
}

# 精细区分材质的 sRGB 基色、粗糙度、金属度与微表面类型
HUMANOID_MATERIALS = {
    # 远行者织物 / 装备（拉高色相与明度对比，避免一团素色）
    "sandCoat":      ((.58, .45, .28), .87, .00, "fabric"),
    "sandCoatDark":  ((.42, .32, .20), .89, .00, "fabric"),
    "sandPants":     ((.45, .36, .24), .89, .00, "fabric"),
    "sandScarf":     ((.68, .58, .41), .91, .00, "fabric"),
    "sandHat":       ((.54, .42, .26), .86, .00, "fabric"),
    "sandArmor":     ((.54, .43, .28), .54, .18, "plate"),
    "sandArmorDark": ((.36, .29, .20), .58, .22, "plate"),
    "oliveCloth":    ((.25, .31, .19), .89, .00, "fabric"),
    "olivePouch":    ((.31, .34, .21), .85, .00, "fabric"),
    "leatherDark":   ((.16, .12, .085), .58, .04, "leather"),
    "leatherMid":    ((.28, .20, .12), .56, .04, "leather"),
    "bootSuede":     ((.30, .23, .15), .76, .00, "leather"),
    "bootRubber":    ((.085, .095, .08), .85, .00, "rubber"),
    "bootLeather":   ((.11, .12, .13), .42, .08, "leather"),
    "webbingDark":   ((.17, .18, .15), .88, .00, "fabric"),
    "cloakSand":     ((.60, .49, .33), .90, .00, "fabric"),
    # 工业联邦：医疗兵 / 指挥官
    "medicCeramic":  ((.82, .86, .84), .38, .12, "plate"),
    "medicGrey":     ((.48, .54, .57), .44, .26, "plate"),
    "medicRed":      ((.70, .11, .07), .40, .10, "plate"),
    "undersuit":     ((.14, .17, .20), .70, .10, "fabric"),
    "coatNavy":      ((.18, .23, .29), .83, .00, "fabric"),
    "coatTrim":      ((.12, .15, .20), .76, .04, "fabric"),
    "shirtLight":    ((.72, .75, .76), .82, .00, "fabric"),
    "officerPants":  ((.15, .19, .24), .84, .00, "fabric"),
    "goldTrim":      ((.74, .57, .20), .28, .86, "metal"),
    # 通用人物细节与武器
    "skin":          ((.68, .50, .38), .62, .00, "skin"),
    "gunmetal":      ((.19, .22, .24), .36, .80, "metal"),
    "steel":         ((.44, .48, .50), .28, .88, "metal"),
    "darkMetal":     ((.11, .13, .14), .42, .70, "metal"),
    "visor":         ((.05, .21, .29), .14, .28, "glass"),
    "visorAmber":    ((.09, .14, .16), .16, .24, "glass"),
    "screenGlow":    ((.09, .62, .72), .16, .12, "glass"),
    "team":          ((.67, .67, .67), .46, .28, "team"),
    "lamp":          ((.80, .80, .80), .22, .05, "lamp"),
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


def humanoid_material(name, slot=0):
    key = f"hum2:{name}:{slot}"
    if key in bpy.data.materials:
        return bpy.data.materials[key]
    rgb, rough, metal, kind = HUMANOID_MATERIALS[name]
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
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Vector"], sep.inputs["Vector"])

    # 大尺度材质明暗纹理（避免大面片塑料光溜感）
    macro = nodes.new("ShaderNodeTexNoise")
    macro.inputs["Scale"].default_value = .18 if kind in {"fabric", "leather"} else .26
    macro.inputs["Detail"].default_value = 5
    macro.inputs["Roughness"].default_value = .68
    links.new(coord.outputs["Vector"], macro.inputs["Vector"])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.name = "Baked base color"
    a, b = ramp.color_ramp.elements
    a.position, b.position = .16, .84
    spread_lo = .80 if kind in {"fabric", "leather"} else .88
    spread_hi = 1.15 if kind in {"fabric", "leather"} else 1.09
    a.color = tuple(_srgb(c * spread_lo) for c in rgb) + (1,)
    b.color = tuple(_srgb(min(1.0, c * spread_hi)) for c in rgb) + (1,)
    links.new(macro.outputs["Fac"], ramp.inputs[0])
    color_out = ramp.outputs["Color"]

    # 强化几何曲率亮边与折痕压暗，让每一处衣褶、护甲棱边、口袋盖极具层次
    if kind not in {"skin", "glass", "lamp"}:
        geom = nodes.new("ShaderNodeNewGeometry")
        edge_hi = nodes.new("ShaderNodeMapRange")
        edge_hi.inputs["From Min"].default_value = .504
        edge_hi.inputs["From Max"].default_value = .565
        edge_hi.inputs["To Min"].default_value = 0.0
        edge_hi.inputs["To Max"].default_value = .65 if kind in {"plate", "metal"} else .38
        links.new(geom.outputs["Pointiness"], edge_hi.inputs["Value"])
        hi_mix = nodes.new("ShaderNodeMixRGB")
        links.new(edge_hi.outputs[0], hi_mix.inputs[0])
        links.new(color_out, hi_mix.inputs[1])
        hi_gain = 1.45 if kind in {"plate", "metal"} else 1.28
        hi_mix.inputs[2].default_value = tuple(_srgb(min(.97, c * hi_gain + .045)) for c in rgb) + (1,)
        color_out = hi_mix.outputs[0]

        cavity = nodes.new("ShaderNodeMapRange")
        cavity.inputs["From Min"].default_value = .43
        cavity.inputs["From Max"].default_value = .496
        cavity.inputs["To Min"].default_value = .52 if kind in {"fabric", "leather"} else .40
        cavity.inputs["To Max"].default_value = 0.0
        links.new(geom.outputs["Pointiness"], cavity.inputs["Value"])
        cav_mix = nodes.new("ShaderNodeMixRGB")
        links.new(cavity.outputs[0], cav_mix.inputs[0])
        links.new(color_out, cav_mix.inputs[1])
        cav_mix.inputs[2].default_value = tuple(_srgb(c * .34) for c in rgb) + (1,)
        color_out = cav_mix.outputs[0]

    # 下摆/靴面自然野战尘土渐变
    if kind in {"fabric", "leather", "rubber", "plate"} and name not in {"medicCeramic", "medicRed", "goldTrim", "shirtLight"}:
        dust_band = nodes.new("ShaderNodeMapRange")
        dust_band.inputs["From Min"].default_value = 0.0
        dust_band.inputs["From Max"].default_value = 10.5
        dust_band.inputs["To Min"].default_value = .28 if kind != "plate" else .16
        dust_band.inputs["To Max"].default_value = 0.0
        links.new(sep.outputs["Y"], dust_band.inputs["Value"])
        dust_mix = nodes.new("ShaderNodeMixRGB")
        links.new(dust_band.outputs[0], dust_mix.inputs[0])
        links.new(color_out, dust_mix.inputs[1])
        dust_mix.inputs[2].default_value = (_srgb(.28), _srgb(.23), _srgb(.17), 1)
        color_out = dust_mix.outputs[0]

    micro = nodes.new("ShaderNodeTexNoise")
    micro.inputs["Scale"].default_value = 5.5 if kind in {"fabric", "leather"} else 8.5
    micro.inputs["Detail"].default_value = 5
    links.new(coord.outputs["Vector"], micro.inputs["Vector"])

    rough_map = nodes.new("ShaderNodeMapRange")
    rough_map.name = "Baked roughness"
    rough_map.inputs["To Min"].default_value = max(.10, rough - .08)
    rough_map.inputs["To Max"].default_value = min(.97, rough + .09)
    links.new(micro.outputs["Fac"], rough_map.inputs["Value"])
    links.new(rough_map.outputs[0], bsdf.inputs["Roughness"])

    bump = nodes.new("ShaderNodeBump")
    if kind == "fabric":
        weave = nodes.new("ShaderNodeTexWave")
        weave.wave_type = "BANDS"
        weave.bands_direction = "DIAGONAL"
        weave.inputs["Scale"].default_value = 16.0
        weave.inputs["Distortion"].default_value = 1.4
        links.new(coord.outputs["Vector"], weave.inputs["Vector"])
        links.new(weave.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .32
        bump.inputs["Distance"].default_value = .045
    elif kind == "leather":
        links.new(micro.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .25
        bump.inputs["Distance"].default_value = .035
    elif kind in {"glass", "lamp", "skin"}:
        links.new(micro.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .03 if kind == "skin" else 0.0
        bump.inputs["Distance"].default_value = .012
    else:
        links.new(micro.outputs["Fac"], bump.inputs["Height"])
        bump.inputs["Strength"].default_value = .20
        bump.inputs["Distance"].default_value = .028

    links.new(color_out, bsdf.inputs["Base Color"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    emission = nodes.new("ShaderNodeEmission")
    emission.name = "Bake emission"
    links.new(color_out, emission.inputs["Color"])
    target = nodes.new("ShaderNodeTexImage")
    target.name = "Bake target"
    return mat


class HumanoidSculptor:
    """面向单个 15 骨骼人形角色的高低模成对雕塑构建器。"""

    def __init__(self, key, rig, scene):
        self.key = key
        self.rig = rig
        self.scene = scene
        self.jids = {j["name"]: i for i, j in enumerate(rig)}
        self.orig = {j["name"]: Vector(j["origin"]) for j in rig}
        self.pairs = []

    def _finish_mesh(self, name, verts_game, faces, mat_name, slot, skin_fn, high,
                     bevel=0.0, smooth=True, weighted=False):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([_point(v) for v in verts_game], [], faces)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()

        obj = bpy.data.objects.new(name + ("_H" if high else "_L"), mesh)
        self.scene.collection.objects.link(obj)
        _select([obj])
        if bevel > 0:
            mod = obj.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 4 if high else 2
            mod.limit_method = "ANGLE"
            mod.angle_limit = .42
            mod.use_clamp_overlap = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
        mesh = obj.data
        for poly in mesh.polygons:
            poly.use_smooth = smooth
        if weighted:
            mod = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            mod.keep_sharp = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
            mesh = obj.data

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
        mesh.materials.append(humanoid_material(mat_name, slot))
        obj["slot"] = slot
        obj["part"] = -1
        return obj

    def rigid(self, joint_name):
        jid = self.jids[joint_name]
        return lambda gx, gy, gz: ((jid, 0, 0, 0), (1.0, 0.0, 0.0, 0.0))

    def blend_y(self, j_lo, j_hi, y_lo, y_hi):
        i0, i1 = self.jids[j_lo], self.jids[j_hi]
        def fn(gx, gy, gz):
            t = _smoothstep(y_lo, y_hi, gy)
            if t <= .001:
                return (i0, 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
            if t >= .999:
                return (i1, 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
            return (i0, i1, 0, 0), (1.0 - t, t, 0.0, 0.0)
        return fn

    def add_pair(self, name, maker, mat_name, skin_fn, slot=0, bevel=0.0, smooth=True, weighted=False):
        if isinstance(skin_fn, str):
            skin_fn = self.rigid(skin_fn)
        low = self._finish_mesh(name, *maker(False), mat_name, slot, skin_fn, False, bevel, smooth, weighted)
        high = self._finish_mesh(name, *maker(True), mat_name, slot, skin_fn, True, bevel, smooth, weighted)
        self.pairs.append((low, high, slot))
        return low, high

    # ---------------- 通用雕塑原语 ----------------

    def loft_y(self, name, stations, mat_name, skin_fn, slot=0,
               around_lo=18, around_hi=36, sub_hi=2,
               shape_fn=None, fold_amp=0.0, fold_phase=0.0, cap_lo=True, cap_hi=True):
        """沿 Y 轴放样非对称解剖截面：stations = [(y, xc, zc, rxp, rxn, rzp, rzn), ...]"""
        def maker(high):
            around = around_hi if high else around_lo
            rows = []
            if high and sub_hi > 1:
                for a, b in zip(stations, stations[1:]):
                    for k in range(sub_hi):
                        t = k / sub_hi
                        rows.append(tuple(u + (v - u) * t for u, v in zip(a, b)))
                rows.append(stations[-1])
            else:
                rows = list(stations)
            verts, faces = [], []
            n_rows = len(rows)
            y0, y1 = rows[0][0], rows[-1][0]
            span = max(1e-4, y1 - y0)
            for y, xc, zc, rxp, rxn, rzp, rzn in rows:
                t = (y - y0) / span
                env = math.sin(max(0.0, min(1.0, t)) * math.pi)
                for c in range(around):
                    ang = c * math.tau / around
                    ca, sa = math.cos(ang), math.sin(ang)
                    rx = rxp if ca >= 0 else rxn
                    rz = rzp if sa >= 0 else rzn
                    mod = 1.0 if shape_fn is None else shape_fn(ang, t, high)
                    if fold_amp > 0:
                        f_lo = math.sin(t * 17.0 + ang * 3.0 + fold_phase) * .55 + math.cos(t * 11.0 - ang * 2.0) * .45
                        mod += fold_amp * env * f_lo * (.65 if not high else 1.0)
                        if high:
                            mod += fold_amp * .60 * env * math.sin(t * 43.0 + ang * 5.0 + fold_phase)
                    verts.append((xc + ca * rx * mod, y, zc + sa * rz * mod))
            for r in range(n_rows - 1):
                for c in range(around):
                    a = r * around + c
                    b = r * around + (c + 1) % around
                    faces.append((a, b, b + around, a + around))
            if cap_lo:
                y, xc, zc, rxp, rxn, rzp, rzn = rows[0]
                c0 = len(verts)
                verts.append((xc, y - min(rxp, rxn, rzp, rzn) * .12, zc))
                for c in range(around):
                    faces.append((c0, (c + 1) % around, c))
            if cap_hi:
                y, xc, zc, rxp, rxn, rzp, rzn = rows[-1]
                base = (n_rows - 1) * around
                c1 = len(verts)
                verts.append((xc, y + min(rxp, rxn, rzp, rzn) * .12, zc))
                for c in range(around):
                    faces.append((c1, base + c, base + (c + 1) % around))
            return verts, faces
        return self.add_pair(name, maker, mat_name, skin_fn, slot, smooth=True)

    def shell_grid(self, name, eval_fn, u_lo, v_lo, u_hi, v_hi, thickness, mat_name, skin_fn,
                   slot=0, wrap_u=False):
        """双面带厚度的自由曲面薄壳；支持 wrap_u=True 生成无缝环形曲面（帽檐/领口/披肩）。"""
        def maker(high):
            nu, nv = (u_hi, v_hi) if high else (u_lo, v_lo)
            u_count = nu if wrap_u else (nu + 1)
            grid = [[eval_fn(i / nu, j / nv, high) for i in range(u_count)] for j in range(nv + 1)]
            verts, faces = [], []
            half = thickness * .5
            for layer in (1.0, -1.0):
                for j in range(nv + 1):
                    for i in range(u_count):
                        p, n = grid[j][i]
                        nv_vec = Vector(n)
                        if nv_vec.length > 1e-6:
                            nv_vec.normalize()
                        else:
                            nv_vec = Vector((0, 0, 1))
                        verts.append((p[0] + nv_vec.x * half * layer,
                                      p[1] + nv_vec.y * half * layer,
                                      p[2] + nv_vec.z * half * layer))
            plane = u_count * (nv + 1)
            for j in range(nv):
                for i in range(nu):
                    ni = (i + 1) % u_count
                    a0 = j * u_count + i
                    a1 = j * u_count + ni
                    a2 = (j + 1) * u_count + ni
                    a3 = (j + 1) * u_count + i
                    faces.append((a0, a1, a2, a3))
                    faces.append((plane + a0, plane + a3, plane + a2, plane + a1))
            # v=0 和 v=nv 封边
            for i in range(nu):
                ni = (i + 1) % u_count
                faces.append((i, plane + i, plane + ni, ni))
                b0 = nv * u_count + i
                b1 = nv * u_count + ni
                faces.append((b0, b1, plane + b1, plane + b0))
            if not wrap_u:
                for j in range(nv):
                    a = j * u_count
                    faces.append((a, a + u_count, plane + a + u_count, plane + a))
                    b = j * u_count + nu
                    faces.append((b, plane + b, plane + b + u_count, b + u_count))
            return verts, faces
        return self.add_pair(name, maker, mat_name, skin_fn, slot, smooth=True)

    def tube_path(self, name, pts, radii, mat_name, skin_fn, slot=0, sides_lo=10, sides_hi=20):
        vectors = [Vector(p) for p in pts]
        if isinstance(radii, (int, float)):
            radii = [float(radii)] * len(vectors)
        def maker(high):
            sides = sides_hi if high else sides_lo
            verts, faces = [], []
            n = len(vectors)
            prev_x = None
            for i, p in enumerate(vectors):
                tang = (vectors[min(i + 1, n - 1)] - vectors[max(i - 1, 0)])
                tang = Vector((0, 1, 0)) if tang.length < 1e-6 else tang.normalized()
                if prev_x is None:
                    ref = Vector((0, 1, 0)) if abs(tang.y) < .9 else Vector((1, 0, 0))
                    bx = tang.cross(ref).normalized()
                else:
                    bx = prev_x - tang * prev_x.dot(tang)
                    if bx.length < 1e-5:
                        ref = Vector((0, 1, 0)) if abs(tang.y) < .9 else Vector((1, 0, 0))
                        bx = tang.cross(ref)
                    bx.normalize()
                by = tang.cross(bx).normalized()
                prev_x = bx
                r = radii[i]
                for c in range(sides):
                    a = c * math.tau / sides
                    v = p + (bx * math.cos(a) + by * math.sin(a)) * r
                    verts.append((v.x, v.y, v.z))
            for i in range(n - 1):
                for c in range(sides):
                    a = i * sides + c
                    b = i * sides + (c + 1) % sides
                    faces.append((a, b, b + sides, a + sides))
            c0 = len(verts); verts.append(tuple(vectors[0]))
            for c in range(sides):
                faces.append((c0, (c + 1) % sides, c))
            c1 = len(verts); verts.append(tuple(vectors[-1]))
            base = (n - 1) * sides
            for c in range(sides):
                faces.append((c1, base + c, base + (c + 1) % sides))
            return verts, faces
        return self.add_pair(name, maker, mat_name, skin_fn, slot, smooth=True)

    def box(self, name, center, size, mat_name, skin_fn, slot=0, rot=(0, 0, 0), bevel=.14):
        R = Euler(rot, "XYZ").to_matrix()
        c = Vector(center)
        sx, sy, sz = size[0] * .5, size[1] * .5, size[2] * .5
        corners = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                   (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
        verts = [tuple(c + R @ Vector((a * sx, b * sy, d * sz))) for a, b, d in corners]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]
        return self.add_pair(name, lambda high: (verts, faces), mat_name, skin_fn, slot,
                             bevel=min(bevel, min(size) * .28), smooth=True, weighted=True)

    def sphere(self, name, center, radii, mat_name, skin_fn, slot=0, u_lo=14, v_lo=10, u_hi=28, v_hi=18):
        cx, cy, cz = center
        rx, ry, rz = radii
        def maker(high):
            nu, nv = (u_hi, v_hi) if high else (u_lo, v_lo)
            verts, faces = [], []
            for j in range(1, nv):
                th = math.pi * j / nv
                st, ct = math.sin(th), math.cos(th)
                for i in range(nu):
                    ph = math.tau * i / nu
                    verts.append((cx + rx * st * math.cos(ph), cy + ry * ct, cz + rz * st * math.sin(ph)))
            top = len(verts); verts.append((cx, cy + ry, cz))
            bot = len(verts); verts.append((cx, cy - ry, cz))
            for i in range(nu):
                ni = (i + 1) % nu
                faces.append((top, i, ni))
                base = (nv - 2) * nu
                faces.append((bot, base + ni, base + i))
            for j in range(nv - 2):
                for i in range(nu):
                    a = j * nu + i
                    b = j * nu + (i + 1) % nu
                    faces.append((a, a + nu, b + nu, b))
            return verts, faces
        return self.add_pair(name, maker, mat_name, skin_fn, slot, smooth=True)

    # ---------------- 真实解剖级公共部件（连续无缝放样） ----------------

    def add_anatomical_boot(self, side, style="tactical"):
        s = -1 if side == "L" else 1
        foot, knee = side + "Foot", side + "Knee"
        fx = self.orig[foot].x - s * .38
        sole_mat = "bootRubber"
        upper_mat = "bootLeather" if style == "officer" else "medicCeramic" if style == "medic" else "bootSuede"
        cuff_mat = "medicGrey" if style == "medic" else upper_mat

        if style == "medic":
            z_sections = [
                (-2.20, 1.45, .45, 3.00), (-1.50, 1.85, .38, 3.25),
                (-.20,  1.72, .46, 2.75), (1.25,  1.86, .40, 2.05),
                (2.85,  1.86, .38, 1.62), (4.10,  1.50, .48, 1.30),
                (4.78,  .88,  .68, 1.00),
            ]
        elif style == "officer":
            z_sections = [
                (-2.05, 1.30, .42, 3.30), (-1.35, 1.60, .36, 3.35),
                (-.05,  1.45, .52, 2.70), (1.35,  1.62, .38, 1.92),
                (2.90,  1.55, .36, 1.45), (4.05,  1.16, .44, 1.12),
                (4.72,  .60,  .62, .85),
            ]
        else:
            z_sections = [
                (-2.10, 1.38, .44, 3.15), (-1.40, 1.70, .38, 3.25),
                (-.10,  1.55, .50, 2.65), (1.30,  1.74, .40, 1.95),
                (2.85,  1.70, .38, 1.52), (4.00,  1.30, .46, 1.22),
                (4.65,  .72,  .66, .92),
            ]

        def boot_maker(high):
            around = 28 if high else 16
            rows = []
            if high:
                for a, b in zip(z_sections, z_sections[1:]):
                    for k in range(2):
                        t = k / 2.0
                        rows.append(tuple(u + (v - u) * t for u, v in zip(a, b)))
                rows.append(z_sections[-1])
            else:
                rows = list(z_sections)
            verts, faces = [], []
            for z, hw, ylo, yhi in rows:
                yc, hy = (ylo + yhi) * .5, (yhi - ylo) * .5
                for c in range(around):
                    ang = c * math.tau / around
                    ca, sa = math.cos(ang), math.sin(ang)
                    px = math.copysign(abs(ca) ** .78, ca) * hw * (1.05 if ca * s > 0 else 1.0)
                    py = yc + (math.copysign(abs(sa) ** .65, sa) if sa < 0 else math.copysign(abs(sa) ** .95, sa)) * hy
                    verts.append((fx + px, py, z))
            for r in range(len(rows) - 1):
                for c in range(around):
                    a, b = r * around + c, r * around + (c + 1) % around
                    faces.append((a, a + around, b + around, b))
            cb = len(verts); z0, _, lo0, hi0 = rows[0]; verts.append((fx, (lo0 + hi0) * .5, z0 - .32))
            for c in range(around):
                faces.append((cb, c, (c + 1) % around))
            cf = len(verts); z1, _, lo1, hi1 = rows[-1]; verts.append((fx, (lo1 + hi1) * .5, z1 + .28))
            base = (len(rows) - 1) * around
            for c in range(around):
                faces.append((cf, base + (c + 1) % around, base + c))
            return verts, faces
        self.add_pair(f"{side}BootUpper", boot_maker, upper_mat, self.blend_y(foot, knee, 2.0, 3.6))

        sole_sections = [
            (-2.15, 1.48, 0.0, .54), (-1.25, 1.80, 0.0, .54), (.00, 1.50, .12, .56),
            (1.30,  1.86, 0.0, .54), (3.00,  1.80, 0.0, .54), (4.15, 1.36, .08, .58),
            (4.78,  .76,  .22, .68),
        ]
        def sole_maker(high):
            around = 24 if high else 14
            verts, faces = [], []
            for z, hw, ylo, yhi in sole_sections:
                yc, hy = (ylo + yhi) * .5, (yhi - ylo) * .5
                for c in range(around):
                    ang = c * math.tau / around
                    ca, sa = math.cos(ang), math.sin(ang)
                    verts.append((fx + math.copysign(abs(ca) ** .65, ca) * hw,
                                  yc + math.copysign(abs(sa) ** .55, sa) * hy, z))
            for r in range(len(sole_sections) - 1):
                for c in range(around):
                    a, b = r * around + c, r * around + (c + 1) % around
                    faces.append((a, a + around, b + around, b))
            cb = len(verts); verts.append((fx, .28, -2.28))
            for c in range(around):
                faces.append((cb, c, (c + 1) % around))
            cf = len(verts); verts.append((fx, .45, 4.90))
            base = (len(sole_sections) - 1) * around
            for c in range(around):
                faces.append((cf, base + (c + 1) % around, base + c))
            return verts, faces
        self.add_pair(f"{side}BootSole", sole_maker, sole_mat, foot)

        cuff_top = 8.4 if style == "officer" else 6.0 if style == "medic" else 5.6
        self.loft_y(f"{side}BootCuff", [
            (2.2, fx, -.15, 1.60, 1.60, 1.70, 1.64),
            (3.5, fx, -.10, 1.54, 1.54, 1.62, 1.56),
            (cuff_top * .68, fx, -.15, 1.68, 1.68, 1.72, 1.85),
            (cuff_top, fx, -.10, 1.84, 1.84, 1.82, 1.96),
        ], cuff_mat, self.blend_y(foot, knee, 2.2, 4.2),
            around_lo=16, around_hi=28, fold_amp=.028 if style != "medic" else .008)
        if style == "tactical":
            for y_l, z_l in ((2.15, 1.35), (2.55, 1.15), (2.95, 1.00)):
                self.tube_path(f"{side}Lace{y_l}", [
                    (fx - .85, y_l, z_l), (fx, y_l + .14, z_l + .32), (fx + .85, y_l, z_l)
                ], .10, "leatherDark", foot, sides_lo=6, sides_hi=10)

    def add_anatomical_legs(self, pants_mat, armor_mat=None, boot_style="tactical",
                            bulk=1.0, kneepad_mat="leatherDark"):
        """连续无缝整腿放样（髋→大腿→膝→小腿肚→踝）+ 骨盆桥接 + 雕塑靴子。"""
        pelvis_stations = [
            (15.6, 0.0, -.15, 3.8 * bulk, 3.8 * bulk, 2.5 * bulk, 3.1 * bulk),
            (17.2, 0.0, -.10, 5.2 * bulk, 5.2 * bulk, 3.3 * bulk, 3.8 * bulk),
            (19.0, 0.0, .00,  5.3 * bulk, 5.3 * bulk, 3.5 * bulk, 3.6 * bulk),
            (20.6, 0.0, .05,  4.8 * bulk, 4.8 * bulk, 3.2 * bulk, 3.1 * bulk),
            (22.2, 0.0, .05,  4.5 * bulk, 4.5 * bulk, 3.0 * bulk, 2.9 * bulk),
        ]
        self.loft_y("Pelvis", pelvis_stations, pants_mat, self.blend_y("hips", "torso", 19.8, 22.0),
                    around_lo=20, around_hi=36, fold_amp=.024 if boot_style != "medic" else .006)

        for side in ("L", "R"):
            s = -1 if side == "L" else 1
            leg, knee, foot = side + "Leg", side + "Knee", side + "Foot"
            lx = self.orig[leg].x
            cx_top, cx_mid, cx_kne, cx_ank = lx - s * 1.15, lx - s * .78, lx - s * .52, lx - s * .38

            # 单段连续整腿网格：彻底消除膝部接缝折痕！
            leg_stations = [
                (2.6,  cx_ank, -.10, 1.46 * bulk, 1.46 * bulk, 1.54 * bulk, 1.50 * bulk),
                (4.8,  cx_ank, -.22, 1.66 * bulk, 1.66 * bulk, 1.65 * bulk, 1.98 * bulk),
                (7.2,  cx_kne, -.28, 1.92 * bulk, 1.92 * bulk, 1.78 * bulk, 2.36 * bulk),
                (9.6,  cx_kne, .04,  1.88 * bulk, 1.88 * bulk, 1.98 * bulk, 1.90 * bulk),
                (11.6, cx_kne, .16,  2.14 * bulk, 2.04 * bulk, 2.30 * bulk, 2.05 * bulk),
                (14.3, cx_mid, .12,  (2.58 if s > 0 else 2.25) * bulk, (2.25 if s > 0 else 2.58) * bulk, 2.68 * bulk, 2.45 * bulk),
                (16.8, cx_top, -.05, (2.78 if s > 0 else 2.38) * bulk, (2.38 if s > 0 else 2.78) * bulk, 2.85 * bulk, 2.85 * bulk),
                (18.6, cx_top, -.10, 2.52 * bulk, 2.52 * bulk, 2.58 * bulk, 2.68 * bulk),
            ]
            def full_leg_skin(gx, gy, gz, l=leg, k=knee, f=foot):
                if gy >= 16.4:
                    t = _smoothstep(16.4, 18.7, gy)
                    return (self.jids[l], self.jids["hips"], 0, 0), (1.0 - t * .52, t * .52, 0.0, 0.0)
                if gy >= 11.4:
                    return (self.jids[l], 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
                if gy >= 8.0:
                    t = _smoothstep(8.0, 11.4, gy)
                    return (self.jids[k], self.jids[l], 0, 0), (1.0 - t, t, 0.0, 0.0)
                if gy >= 3.8:
                    return (self.jids[k], 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
                t = _smoothstep(2.2, 3.8, gy)
                return (self.jids[f], self.jids[k], 0, 0), (1.0 - t, t, 0.0, 0.0)

            self.loft_y(f"{side}FullLeg", leg_stations, pants_mat, full_leg_skin,
                        around_lo=16, around_hi=32, fold_amp=.036 if boot_style != "medic" else .008, fold_phase=s)

            if kneepad_mat:
                def knee_eval(u, v, high, cx=cx_kne, b=bulk):
                    ang = (u - .5) * 1.90
                    y = 8.4 + v * 2.90
                    bulge = math.sin(v * math.pi) * .42 + (.10 if high else 0.0) * math.cos((v - .5) * 6.0)
                    r = 2.02 * b + bulge
                    nx, nz = math.sin(ang), math.cos(ang)
                    return (cx + nx * r, y, .20 + nz * r), (nx, 0.0, nz)
                self.shell_grid(f"{side}KneePad", knee_eval, 8, 5, 16, 10, .46, kneepad_mat, knee)

            if armor_mat:
                def greave_eval(u, v, high, cx=cx_kne, b=bulk):
                    ang = (u - .5) * 2.20
                    y = 3.8 + v * 4.8
                    rad = (1.72 + .34 * math.sin(v * math.pi * .85)) * b
                    nx, nz = math.sin(ang), math.cos(ang)
                    return (cx + nx * rad, y, .05 + nz * rad), (nx, 0.0, nz)
                self.shell_grid(f"{side}Greave", greave_eval, 10, 6, 18, 12, .50, armor_mat, knee)

            self.add_anatomical_boot(side, boot_style)

    def add_anatomical_torso(self, shirt_mat, width_scale=1.0, depth_scale=1.0, fold_amp=.025):
        ws, ds = width_scale, depth_scale
        stations = [
            (20.4, 0.0, .05, 4.4 * ws, 4.4 * ws, 3.0 * ds, 2.9 * ds),
            (23.0, 0.0, .10, 4.6 * ws, 4.6 * ws, 3.2 * ds, 3.0 * ds),
            (26.2, 0.0, .25, 5.4 * ws, 5.4 * ws, 3.8 * ds, 3.3 * ds),
            (29.8, 0.0, .30, 6.4 * ws, 6.4 * ws, 4.1 * ds, 3.6 * ds),
            (32.2, 0.0, .15, 6.1 * ws, 6.1 * ws, 3.6 * ds, 3.4 * ds),
            (33.8, 0.0, .25, 3.6 * ws, 3.6 * ws, 2.6 * ds, 2.5 * ds),
            (35.0, 0.0, .55, 2.3 * ws, 2.3 * ws, 2.2 * ds, 2.1 * ds),
        ]
        def torso_shape(ang, t, high):
            sa, ca = math.sin(ang), math.cos(ang)
            chest = .065 * max(0.0, sa) * math.exp(-((t - .62) / .24) ** 2)
            spine = -.05 * max(0.0, -sa) * math.exp(-ca * ca * 14.0) * math.sin(t * math.pi)
            return 1.0 + chest + spine
        self.loft_y("TorsoCore", stations, shirt_mat, self.blend_y("hips", "torso", 20.2, 22.8),
                    around_lo=22, around_hi=40, shape_fn=torso_shape, fold_amp=fold_amp)

    def add_belt(self, belt_mat="leatherDark", buckle_mat="steel", width_scale=1.0, pouches=True, pouch_mat="olivePouch"):
        ws = width_scale
        self.loft_y("WaistBelt", [
            (18.6, 0.0, .08, 5.35 * ws, 5.35 * ws, 3.65 * ws, 3.65 * ws),
            (19.6, 0.0, .08, 5.42 * ws, 5.42 * ws, 3.72 * ws, 3.72 * ws),
            (20.5, 0.0, .08, 5.20 * ws, 5.20 * ws, 3.60 * ws, 3.55 * ws),
        ], belt_mat, "hips", around_lo=22, around_hi=36)
        self.box("BeltBuckle", (0.0, 19.55, 3.82 * ws), (2.0, 1.35, .55), buckle_mat, "hips", bevel=.14)
        if pouches:
            for s in (-1, 1):
                self.box(f"HipPouch{s}", (s * 5.25 * ws, 18.8, .6), (1.75, 2.8, 2.6),
                         pouch_mat, "hips", rot=(0, s * .15, -s * .08), bevel=.28)
                self.box(f"HipPouchFlap{s}", (s * 5.38 * ws, 20.0, .6), (1.85, .65, 2.7),
                         belt_mat, "hips", rot=(0, s * .15, -s * .08), bevel=.16)

    def add_anatomical_arms(self, sleeve_mat, glove_mat="leatherDark", armor_mat=None,
                            bulk=1.0, pauldron_mat=None, cuff_trim_mat=None, team_on_right=True):
        """单段连续整臂放样（三角肌→上臂→肘→前臂→腕）彻底消除肘部折痕；护肩左右完全对称贴合。"""
        for side in ("L", "R"):
            s = -1 if side == "L" else 1
            arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"
            ax = self.orig[arm].x
            ay, ey, hy = self.orig[arm].y, self.orig[elbow].y, self.orig[hand].y
            inward = max(0.0, abs(ax) - 6.75) * .65
            x_sh = ax - s * (inward + .65)
            x_el = ax - s * (inward * .55 + .22)
            x_wr = ax - s * (inward * .35)

            arm_stations = [
                (hy + .15, x_wr, .24, 1.06 * bulk, 1.06 * bulk, 1.18 * bulk, 1.14 * bulk),
                (hy + 1.9, x_wr, .18, 1.28 * bulk, 1.28 * bulk, 1.38 * bulk, 1.34 * bulk),
                (ey - 1.5, x_el, .10, 1.50 * bulk, 1.50 * bulk, 1.60 * bulk, 1.54 * bulk),
                (ey + .15, x_el, .02, 1.46 * bulk, 1.46 * bulk, 1.54 * bulk, 1.52 * bulk),
                (ey + 2.4, x_el, .08, 1.68 * bulk, 1.64 * bulk, 1.76 * bulk, 1.70 * bulk),
                (ay - 1.4, x_sh, .05, 1.92 * bulk, 1.82 * bulk, 2.02 * bulk, 1.95 * bulk),
                (ay + .55, x_sh - s * .35, .00, 1.96 * bulk, 1.75 * bulk, 1.98 * bulk, 1.94 * bulk),
                (ay + 1.55, x_sh - s * .75, .00, 1.45 * bulk, 1.45 * bulk, 1.50 * bulk, 1.50 * bulk),
            ]
            def full_arm_skin(gx, gy, gz, a=arm, e=elbow, h=hand):
                if gy >= ay - .4:
                    t = _smoothstep(ay - .4, ay + 1.5, gy)
                    return (self.jids[a], self.jids["torso"], 0, 0), (1.0 - t * .52, t * .52, 0.0, 0.0)
                if gy >= ey + 1.3:
                    return (self.jids[a], 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
                if gy >= ey - 1.3:
                    t = _smoothstep(ey - 1.3, ey + 1.3, gy)
                    return (self.jids[e], self.jids[a], 0, 0), (1.0 - t, t, 0.0, 0.0)
                if gy >= hy + 1.2:
                    return (self.jids[e], 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
                t = _smoothstep(hy, hy + 1.2, gy)
                return (self.jids[h], self.jids[e], 0, 0), (1.0 - t, t, 0.0, 0.0)

            self.loft_y(f"{side}FullArm", arm_stations, sleeve_mat, full_arm_skin,
                        around_lo=16, around_hi=28, fold_amp=.032 if armor_mat is None else .008, fold_phase=s * 1.4)

            # 左右完全对称、贴合三角肌弧线的肩甲（修正外飘缺陷！）
            if pauldron_mat:
                def pauldron_eval(u, v, high, cx=x_sh, sy=ay, ss=s, b=bulk):
                    phi = (u - .5) * 2.10      # 前后弧度
                    theta = -.30 + v * 1.65    # 从锁骨端平滑越过肩顶包向三角肌外侧
                    r = 2.28 * b + (.08 if high else 0.0) * math.sin(v * math.pi * 4)
                    # 球心位于肩关节内下侧，左右镜像严格对称
                    ox = cx - ss * .35
                    oy = sy - .45
                    px = ox + ss * math.sin(theta) * r * 1.02
                    py = oy + math.cos(theta) * r * .98
                    pz = math.sin(phi) * r * .96
                    return (px, py, pz), (ss * math.sin(theta), math.cos(theta), math.sin(phi) * .7)
                self.shell_grid(f"{side}Pauldron", pauldron_eval, 10, 6, 18, 12, .52, pauldron_mat, arm)
                if team_on_right and side == "R":
                    self.box("RightArmTeamPatch", (x_sh + s * 2.15 * bulk, ay - .55, .0),
                             (.35, 1.75, 2.0), "team", arm, slot=1, bevel=.05)
            elif team_on_right and side == "R":
                self.box("RightSleeveTeamPatch", (x_sh + s * 1.88 * bulk, ay - 1.5, .0),
                         (.30, 1.75, 2.0), "team", arm, slot=1, bevel=.05)

            if armor_mat:
                def bracer_eval(u, v, high, cx=x_wr, y0=hy + .8, y1=ey - 1.2, b=bulk):
                    ang = (u - .5) * 2.5
                    y = y0 + (y1 - y0) * v
                    r = (1.28 + .26 * v) * b
                    nx, nz = math.sin(ang), math.cos(ang)
                    return (cx + nx * r, y, .15 + nz * r), (nx, 0.0, nz)
                self.shell_grid(f"{side}Bracer", bracer_eval, 8, 5, 16, 10, .38, armor_mat, elbow)

            if cuff_trim_mat:
                self.loft_y(f"{side}CuffBand", [
                    (hy + .55, x_wr, .22, 1.22 * bulk, 1.22 * bulk, 1.32 * bulk, 1.28 * bulk),
                    (hy + 1.35, x_wr, .20, 1.32 * bulk, 1.32 * bulk, 1.42 * bulk, 1.38 * bulk),
                ], cuff_trim_mat, elbow, around_lo=14, around_hi=24)

            self.loft_y(f"{side}Palm", [
                (hy - 1.45, x_wr, .65, 1.02, 1.02, 1.12, .92),
                (hy - .55,  x_wr, .55, 1.14, 1.14, 1.22, 1.02),
                (hy + .45,  x_wr, .28, 1.00, 1.00, 1.08, 1.00),
            ], glove_mat, hand, around_lo=12, around_hi=22)
            for fi, df in enumerate((-.65, -.22, .22, .65)):
                self.tube_path(f"{side}Finger{fi}", [
                    (x_wr + df * .82, hy - 1.05, 1.22),
                    (x_wr + df * .78, hy - 1.72, 1.56),
                    (x_wr + df * .72, hy - 1.82, .85),
                ], .24, glove_mat, hand, sides_lo=6, sides_hi=10)
            self.tube_path(f"{side}Thumb", [
                (x_wr - s * .92, hy - .50, .82),
                (x_wr - s * 1.08, hy - 1.05, 1.52),
                (x_wr - s * .55, hy - 1.35, 1.70),
            ], .27, glove_mat, hand, sides_lo=6, sides_hi=10)

    def add_anatomical_head(self, skin_mat="skin", covered_mat=None):
        hy, hz = self.orig["head"].y, self.orig["head"].z
        neck_mat = covered_mat or skin_mat
        self.loft_y("Neck", [
            (hy - 2.35, 0.0, hz - .45, 2.02, 2.02, 1.98, 1.92),
            (hy - 1.20, 0.0, hz - .25, 1.76, 1.76, 1.80, 1.72),
            (hy - .10,  0.0, hz - .10, 1.80, 1.80, 1.88, 1.78),
        ], neck_mat, self.blend_y("torso", "head", hy - 2.2, hy - .6), around_lo=14, around_hi=24)

        head_st = [
            (hy - 1.35, 0.0, hz + .40, 1.55, 1.55, 1.85, 1.25),
            (hy - .45,  0.0, hz + .25, 2.35, 2.35, 2.75, 2.05),
            (hy + .75,  0.0, hz + .15, 2.78, 2.78, 3.05, 2.75),
            (hy + 2.05, 0.0, hz + .05, 2.85, 2.85, 3.08, 3.10),
            (hy + 3.25, 0.0, hz - .10, 2.55, 2.55, 2.70, 2.95),
            (hy + 4.10, 0.0, hz - .15, 1.65, 1.65, 1.80, 1.95),
        ]
        def head_shape(ang, t, high):
            sa, ca = math.sin(ang), math.cos(ang)
            nose = .095 * max(0.0, sa) ** 5 * math.exp(-((t - .46) / .13) ** 2)
            eye_dip = -.055 * max(0.0, sa) ** 3 * math.exp(-((abs(ca) - .42) / .16) ** 2) * math.exp(-((t - .62) / .10) ** 2)
            return 1.0 + nose + eye_dip
        self.loft_y("HeadSculpt", head_st, covered_mat or skin_mat, "head",
                    around_lo=18, around_hi=34, shape_fn=head_shape)

    def add_carbine(self, joint="RHand", length=14.5, stock=True, compact=False):
        o = self.orig[joint]
        x, y, z = o.x, o.y - .35, o.z + 1.2
        rec_len = length * .52
        self.box("WeaponReceiver", (x, y + 1.35, z + rec_len * .35), (1.55, 2.15, rec_len), "gunmetal", joint, bevel=.16)
        self.box("WeaponHandguard", (x, y + 1.35, z + rec_len * .95), (1.38, 1.72, length * .34), "darkMetal", joint, bevel=.18)
        self.box("WeaponTopRail", (x, y + 2.52, z + rec_len * .55), (1.05, .36, length * .58), "darkMetal", joint, bevel=.06)
        self.tube_path("WeaponBarrel", [
            (x, y + 1.50, z + rec_len * .75), (x, y + 1.50, z + length * .98),
        ], [.40, .34], "steel", joint, sides_lo=10, sides_hi=18)
        self.tube_path("WeaponMuzzle", [
            (x, y + 1.50, z + length * .94), (x, y + 1.50, z + length * 1.08),
        ], [.56, .52], "darkMetal", joint, sides_lo=10, sides_hi=18)
        self.box("WeaponMag", (x, y - .85, z + rec_len * .62), (1.05, 3.4, 1.75),
                 "olivePouch" if not compact else "darkMetal", joint, rot=(.22, 0, 0), bevel=.16)
        self.box("WeaponGrip", (x, y - .55, z + .55), (1.10, 2.5, 1.35), "bootRubber", joint, rot=(-.26, 0, 0), bevel=.18)
        self.box("WeaponOptic", (x, y + 3.25, z + rec_len * .38), (1.18, 1.20, 2.45), "darkMetal", joint, bevel=.18)
        self.sphere("OpticLens", (x, y + 3.25, z + rec_len * .38 + 1.15), (.42, .42, .18), "visor", joint)
        if stock:
            self.box("WeaponStock", (x, y + 1.10, z - 2.35), (1.15, 2.45, 3.9), "darkMetal", joint, bevel=.20)

    def add_pistol(self, joint="RHand"):
        o = self.orig[joint]
        x, y, z = o.x, o.y - .45, o.z + 1.25
        self.box("PistolSlide", (x, y + 1.10, z + 2.3), (1.05, 1.45, 5.4), "gunmetal", joint, bevel=.14)
        self.box("PistolGrip", (x, y - .45, z + .4), (.95, 2.3, 1.3), "leatherDark", joint, rot=(-.24, 0, 0), bevel=.16)
        self.tube_path("PistolBarrel", [(x, y + 1.25, z + 4.8), (x, y + 1.25, z + 5.7)], .30, "steel", joint)

    def add_datapad(self, joint="LHand"):
        o = self.orig[joint]
        x, y, z = o.x, o.y - .65, o.z + 2.6
        self.box("DatapadFrame", (x, y + .6, z + 1.2), (5.2, .58, 6.8), "darkMetal", joint, rot=(.28, 0, 0), bevel=.16)
        self.box("DatapadScreen", (x, y + .88, z + 1.2), (4.2, .18, 5.6), "screenGlow", joint, rot=(.28, 0, 0), bevel=.04)
        self.box("DatapadLED", (x - 1.6, y + .92, z + 3.8), (.7, .16, .35), "lamp", joint, slot=2, rot=(.28, 0, 0), bevel=.03)

    # ---------------- 五个阵营人形专属精修造型 ----------------

    def build_relay_ranger(self):
        """远行者 · 线列步兵：完全对照原画——巡逻野战帽+耳机+颈巾+战术胸挂+飘逸开叉长风衣+橄榄绿睡袋背包。"""
        self.add_anatomical_legs("sandPants", boot_style="tactical", bulk=.98, kneepad_mat="leatherDark")
        self.add_anatomical_torso("sandCoat", width_scale=.98, depth_scale=.98, fold_amp=.032)
        self.add_belt("leatherDark", "steel", width_scale=1.0, pouches=True, pouch_mat="olivePouch")

        # 飘逸开叉沙漠风衣下摆 + 深色翻领线条
        for side, s in (("L", -1), ("R", 1)):
            leg = side + "Leg"
            def coat_side(u, v, high, ss=s):
                ang = ss * (.34 + u * 2.58)
                y = 8.4 + v * 12.8
                flare = (1.0 - v) ** 1.15
                rx = 5.35 + flare * 2.45
                rz = 3.85 + flare * 2.25
                pleat = (.44 * math.sin(u * math.pi * 5.0 + ss) +
                         (.18 if high else 0.0) * math.sin(u * math.pi * 11.0)) * (1.0 - v * .72)
                r_mod = 1.0 + pleat / 6.0
                nx, nz = math.sin(ang), math.cos(ang)
                return (nx * rx * r_mod, y, nz * rz * r_mod - .15), (nx, -.12 * flare, nz)
            self.shell_grid(f"{side}DusterSkirt", coat_side, 12, 8, 22, 16, .52, "sandCoat",
                            self.blend_y(leg, "hips", 12.5, 19.5))

        # 环颈厚褶沙漠围巾（位于锁骨与下颌之间，绝不遮挡面部与风镜！）
        self.loft_y("ShemaghScarf", [
            (30.9, 0.0, .65, 5.1, 5.1, 4.1, 3.6),
            (32.1, 0.0, .60, 4.7, 4.7, 3.9, 3.4),
            (33.3, 0.0, .55, 3.9, 3.9, 3.5, 3.2),
            (34.3, 0.0, .55, 3.2, 3.2, 3.0, 2.8),
        ], "sandScarf", self.blend_y("torso", "head", 32.0, 34.2), around_lo=20, around_hi=36, fold_amp=.058)

        # 紧贴胸廓的战术背心与多联弹匣包（消除上缘翘边！）
        def rig_eval(u, v, high):
            ang = (u - .5) * 1.85
            y = 22.6 + v * 7.6
            rx = 5.20 + .65 * math.sin(v * math.pi * .8)
            rz = 3.95 + .30 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * rx, y, .20 + nz * rz), (nx, 0.0, nz)
        self.shell_grid("ChestRig", rig_eval, 10, 6, 18, 12, .48, "olivePouch", "torso")
        for x in (-2.4, 0.0, 2.4):
            z = 4.45 - .09 * x * x
            self.box(f"MagPouch{x}", (x, 24.8, z), (1.98, 3.25, 1.32), "sandCoatDark", "torso",
                     rot=(0, x * .10, 0), bevel=.24)
            self.box(f"MagFlap{x}", (x, 26.20, z + .15), (2.04, .62, 1.40), "leatherDark", "torso",
                     rot=(0, x * .10, 0), bevel=.14)
        # 左侧对讲机包 + 清晰深棕皮革肩带
        self.box("ChestRadioPouch", (-3.1, 28.4, 4.15), (1.75, 2.45, 1.15), "oliveCloth", "torso",
                 rot=(0, -.25, 0), bevel=.20)
        for s in (-1, 1):
            self.tube_path(f"ChestStrap{s}", [
                (s * 3.1, 29.2, 3.85), (s * 3.8, 32.2, 2.2), (s * 3.8, 32.6, -1.8), (s * 3.2, 29.0, -3.7)
            ], .52, "leatherDark", "torso", sides_lo=8, sides_hi=14)
            # 风衣缝线肩袢（取代外飘肩甲）
            self.box(f"CoatEpaulette{s}", (s * 5.2, 32.15, .15), (2.8, .38, 1.6), "sandCoatDark", "torso",
                     rot=(0, 0, -s * .20), bevel=.08)
        self.box("ChestTeamPatch", (2.5, 28.6, 4.28), (1.95, 1.10, .28), "team", "torso", slot=1, rot=(0, .24, 0), bevel=.05)

        # 远行者背包 + 橄榄绿卷起睡袋 + 深棕皮捆绑带
        self.loft_y("ExpeditionPack", [
            (22.2, 0.0, -5.8, 4.4, 4.4, 2.2, 2.6),
            (25.2, 0.0, -6.2, 4.8, 4.8, 2.5, 2.9),
            (29.8, 0.0, -6.0, 4.6, 4.6, 2.3, 2.7),
            (32.4, 0.0, -5.5, 3.8, 3.8, 1.9, 2.1),
        ], "sandPants", "torso", around_lo=16, around_hi=28, fold_amp=.030)
        self.tube_path("Bedroll", [(-5.4, 33.5, -5.8), (0.0, 33.7, -6.0), (5.4, 33.5, -5.8)],
                       [1.92, 2.15, 1.92], "oliveCloth", "torso", sides_lo=14, sides_hi=26)
        for sx in (-3.2, 3.2):
            self.tube_path(f"PackStrap{sx}", [
                (sx, 23.0, -8.5), (sx, 31.8, -8.3), (sx, 35.6, -6.0), (sx, 31.8, -3.9)
            ], .34, "leatherDark", "torso")

        # 头部：清晰露出脸庞 + 弧形风镜 + 帅气野战巡逻帽（仅前檐弯曲伸出，无接缝无草帽圆盘）+ 通讯耳机
        self.add_anatomical_head("skin")
        hy, hz = self.orig["head"].y, self.orig["head"].z
        # 紧贴下颌的护颈布巾边缘（不盖鼻眼，让风镜清晰露出）
        self.loft_y("LowerFaceWrap", [
            (hy - 1.55, 0.0, hz + .35, 2.45, 2.45, 2.48, 2.18),
            (hy - .65,  0.0, hz + .40, 2.72, 2.72, 2.76, 2.42),
        ], "sandScarf", "head", around_lo=16, around_hi=28, fold_amp=.040)
        # 弧形野战风镜（清晰可见！）
        def goggle_eval(u, v, high):
            ang = (u - .5) * 1.52
            y = hy + .62 + v * 1.18
            r = 3.24
            return (math.sin(ang) * r, y, hz + .18 + math.cos(ang) * r), (math.sin(ang), 0.0, math.cos(ang))
        self.shell_grid("RangerGoggles", goggle_eval, 10, 4, 18, 8, .32, "visor", "head")
        self.box("GoggleLamp", (-1.4, hy + 1.22, hz + 3.24), (.58, .32, .22), "lamp", "head", slot=2, bevel=.04)
        # 紧凑野战巡逻帽冠 + 无缝前倾弧形帽舌
        self.loft_y("PatrolCapCrown", [
            (hy + 1.85, 0.0, hz - .02, 3.18, 3.18, 3.38, 3.30),
            (hy + 3.05, 0.0, hz - .05, 3.12, 3.12, 3.32, 3.22),
            (hy + 4.10, 0.0, hz - .10, 2.55, 2.55, 2.72, 2.68),
        ], "sandHat", "head", around_lo=20, around_hi=36, fold_amp=.024)
        def cap_bill(u, v, high):
            ang = (u - .5) * 2.15
            r = 3.05 + v * 2.05 * math.cos(ang * .58)
            drop = -.68 * v * v - .16 * v
            return (math.sin(ang) * r, hy + 2.05 + drop, hz + .12 + math.cos(ang) * r), (0.0, 1.0, .20)
        self.shell_grid("PatrolCapBill", cap_bill, 12, 4, 24, 8, .34, "sandHat", "head")
        # 环头战术耳机 + 清晰跨顶头箍（高于帽顶，绝不穿模！）+ 话筒杆 + 背包鞭状天线
        for s in (-1, 1):
            self.sphere(f"EarCup{s}", (s * 3.18, hy + .75, hz - .12), (.75, 1.15, 1.15), "darkMetal", "head")
        self.tube_path("HeadsetBand", [
            (-3.28, hy + 1.4, hz - .12), (-3.15, hy + 3.4, hz - .12), (-2.1, hy + 4.55, hz - .12),
            (0.0, hy + 4.78, hz - .12), (2.1, hy + 4.55, hz - .12), (3.15, hy + 3.4, hz - .12),
            (3.28, hy + 1.4, hz - .12),
        ], .24, "darkMetal", "head")
        self.tube_path("HeadsetBoom", [(-3.1, hy + .2, hz + .4), (-2.5, hy - .4, hz + 2.3), (-1.1, hy - .5, hz + 3.0)],
                       .14, "bootRubber", "head")
        self.tube_path("RadioWhip", [(-3.6, 32.0, -5.4), (-4.0, 41.2, -5.8)], [.18, .08], "bootRubber", "torso")

        self.add_anatomical_arms("sandCoat", glove_mat="leatherDark", bulk=.95, pauldron_mat=None,
                                 cuff_trim_mat="sandCoatDark")
        self.add_carbine("RHand", length=14.2, stock=True)

    def build_industrial_medic(self):
        """工业联邦 · 战地医疗兵：流线白陶瓷外骨骼、完整红十字胸甲、对称弧面护肩、双冷疗罐背包。"""
        self.add_anatomical_legs("undersuit", armor_mat="medicCeramic", boot_style="medic", bulk=1.04,
                                 kneepad_mat="medicGrey")
        for side, s in (("L", -1), ("R", 1)):
            lx = self.orig[side + "Leg"].x - s * .78
            def thigh_plate(u, v, high, cx=lx, ss=s):
                ang = (u - .5) * 2.1 + ss * .35
                y = 11.2 + v * 5.8
                r = 2.68 + .15 * math.sin(v * math.pi)
                nx, nz = math.sin(ang), math.cos(ang)
                return (cx + nx * r, y, .12 + nz * r), (nx, 0.0, nz)
            self.shell_grid(f"{side}ThighPlate", thigh_plate, 8, 5, 16, 10, .48, "medicCeramic", side + "Leg")

        self.add_anatomical_torso("undersuit", width_scale=1.02, depth_scale=1.02, fold_amp=.008)
        self.add_belt("medicGrey", "steel", width_scale=1.04, pouches=True, pouch_mat="medicCeramic")

        # 流线型白色医疗胸甲 + 腹甲分段 + 醒目无遮挡红十字
        def cuirass_front(u, v, high):
            ang = (u - .5) * 2.15
            y = 24.0 + v * 8.6
            rx = 5.3 + 1.45 * math.sin(v * math.pi * .78)
            rz = 4.0 + .82 * math.sin(v * math.pi * .85)
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * rx, y, .28 + nz * rz), (nx, .12 * (v - .5), nz)
        self.shell_grid("MedicCuirassFront", cuirass_front, 12, 8, 24, 16, .66, "medicCeramic", "torso")
        def ab_plate(u, v, high):
            ang = (u - .5) * 1.75
            y = 20.8 + v * 3.3
            r = 4.65 + .35 * v
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * r, y, .15 + nz * (r * .78)), (nx, 0.0, nz)
        self.shell_grid("MedicAbPlate", ab_plate, 10, 4, 18, 8, .50, "medicGrey", "torso")
        def cuirass_back(u, v, high):
            ang = math.pi + (u - .5) * 1.95
            y = 23.0 + v * 9.2
            rx = 5.2 + 1.15 * math.sin(v * math.pi * .78)
            rz = 3.8 + .55 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * rx, y, -.10 + nz * rz), (nx, 0.0, nz)
        self.shell_grid("MedicCuirassBack", cuirass_back, 10, 6, 20, 12, .62, "medicGrey", "torso")
        self.loft_y("CollarRing", [
            (32.2, 0.0, .25, 4.5, 4.5, 3.9, 3.8),
            (33.3, 0.0, .35, 3.8, 3.8, 3.5, 3.4),
        ], "medicGrey", "torso", around_lo=18, around_hi=32)
        # 红十字清晰浮于胸甲正前方（竖条略微前移 0.05，彻底消除共面交叉黑块！）
        self.box("ChestCrossH", (0.0, 28.4, 5.42), (4.2, 1.32, .54), "medicRed", "torso", bevel=.08)
        self.box("ChestCrossV", (0.0, 28.4, 5.46), (1.32, 4.2, .56), "medicRed", "torso", bevel=.08)
        self.box("MedicTeamBadge", (-3.8, 30.2, 4.65), (1.8, 1.1, .35), "team", "torso", slot=1, rot=(0, -.32, 0), bevel=.06)

        self.box("MedicPackChassis", (0.0, 27.6, -5.0), (8.4, 9.8, 3.2), "medicGrey", "torso", bevel=.45)
        for s in (-1, 1):
            self.loft_y(f"MedCanister{s}", [
                (22.2, s * 4.7, -6.2, 1.55, 1.55, 1.55, 1.55),
                (23.2, s * 4.7, -6.2, 1.98, 1.98, 1.98, 1.98),
                (31.8, s * 4.7, -6.2, 1.98, 1.98, 1.98, 1.98),
                (33.1, s * 4.7, -6.2, 1.35, 1.35, 1.35, 1.35),
            ], "medicCeramic", "torso", around_lo=16, around_hi=28)
            self.loft_y(f"MedBand{s}", [
                (28.8, s * 4.7, -6.2, 2.12, 2.12, 2.12, 2.12),
                (30.4, s * 4.7, -6.2, 2.12, 2.12, 2.12, 2.12),
            ], "medicRed", "torso", around_lo=16, around_hi=28)
            self.tube_path(f"MedHose{s}", [
                (s * 4.7, 33.0, -6.2), (s * 4.2, 34.4, -4.5), (s * 2.8, 33.4, -2.5)
            ], .38, "bootRubber", "torso")

        hy, hz = self.orig["head"].y, self.orig["head"].z
        self.loft_y("MedicNeckSeal", [
            (hy - 2.3, 0.0, hz - .3, 2.35, 2.35, 2.30, 2.25),
            (hy - .5,  0.0, hz - .1, 2.25, 2.25, 2.25, 2.20),
        ], "undersuit", self.blend_y("torso", "head", hy - 2.2, hy - .6), around_lo=16, around_hi=28)
        self.loft_y("MedicHelmet", [
            (hy - 1.55, 0.0, hz + .35, 2.55, 2.55, 3.25, 2.40),
            (hy - .20,  0.0, hz + .20, 3.65, 3.65, 3.85, 3.50),
            (hy + 1.45, 0.0, hz + .05, 4.05, 4.05, 4.10, 4.10),
            (hy + 3.15, 0.0, hz - .10, 3.70, 3.70, 3.75, 3.90),
            (hy + 4.35, 0.0, hz - .15, 2.45, 2.45, 2.55, 2.75),
        ], "medicCeramic", "head", around_lo=22, around_hi=40)
        def visor_eval(u, v, high):
            ang = (u - .5) * 1.75
            y = hy + .35 + v * 1.95
            r = 4.08 + .15 * math.sin(v * math.pi)
            return (math.sin(ang) * r, y, hz + .15 + math.cos(ang) * r), (math.sin(ang), 0.0, math.cos(ang))
        self.shell_grid("MedicVisor", visor_eval, 12, 5, 22, 10, .38, "visor", "head")
        self.box("HelmetCrossH", (0.0, hy + 3.08, hz + 4.06), (2.25, .70, .40), "medicRed", "head", rot=(-.30, 0, 0), bevel=.06)
        self.box("HelmetCrossV", (0.0, hy + 3.08, hz + 4.10), (.70, 2.25, .42), "medicRed", "head", rot=(-.30, 0, 0), bevel=.06)
        self.box("HelmetChinGuard", (0.0, hy - .70, hz + 3.65), (3.4, 1.55, 1.15), "medicGrey", "head", bevel=.25)
        for s in (-1, 1):
            self.sphere(f"HelmetPod{s}", (s * 4.05, hy + .9, hz - .1), (.75, 1.25, 1.25), "medicGrey", "head")
        self.box("MedicVisorLamp", (-1.8, hy + 1.45, hz + 3.95), (.85, .42, .28), "lamp", "head", slot=2, bevel=.04)

        self.add_anatomical_arms("undersuit", glove_mat="medicGrey", armor_mat="medicCeramic",
                                 bulk=1.04, pauldron_mat="medicCeramic")

        o = self.orig["RHand"]
        x, y, z = o.x, o.y - .35, o.z + 1.2
        self.box("MedGunBody", (x, y + 1.45, z + 3.4), (2.5, 2.75, 7.6), "medicCeramic", "RHand", bevel=.35)
        self.tube_path("MedGunTank", [(x, y + 2.85, z + 1.6), (x, y + 2.85, z + 5.8)], 1.02, "screenGlow", "RHand")
        for dx in (-.75, .75):
            self.tube_path(f"MedProng{dx}", [(x + dx, y + 1.35, z + 7.0), (x + dx, y + 1.35, z + 10.2)],
                           [.36, .24], "steel", "RHand")
        self.box("MedGunGrip", (x, y - .5, z + .5), (1.15, 2.4, 1.4), "bootRubber", "RHand", rot=(-.22, 0, 0), bevel=.18)
        self.box("MedGunLamp", (x, y + 2.0, z + 7.2), (1.4, .65, .45), "lamp", "RHand", slot=2, bevel=.06)

    def build_industrial_commander(self):
        """工业联邦 · 战地指挥官：挺括双排扣长军大衣、饱满金色肩章、锐利大檐帽、高筒马靴、全息战术板。"""
        self.add_anatomical_legs("officerPants", boot_style="officer", bulk=.96, kneepad_mat=None)
        self.add_anatomical_torso("coatNavy", width_scale=1.00, depth_scale=.98, fold_amp=.022)
        self.add_belt("bootLeather", "goldTrim", width_scale=1.0, pouches=False)

        # 剪裁合体的双排扣长军大衣下摆（与腰部无缝收合，左右对称垂坠）
        for side, s in (("L", -1), ("R", 1)):
            leg = side + "Leg"
            def greatcoat(u, v, high, ss=s):
                ang = ss * (.20 + u * 2.90)
                y = 7.4 + v * 13.8
                flare = (1.0 - v) ** 1.05
                rx = 5.15 + flare * 2.45
                rz = 3.72 + flare * 2.20
                pleat = (.36 * math.sin(u * math.pi * 4.0 + ss * .5) +
                         (.14 if high else 0.0) * math.sin(u * math.pi * 10.0)) * (1.0 - v * .75)
                r_mod = 1.0 + pleat / 6.0
                nx, nz = math.sin(ang), math.cos(ang)
                return (nx * rx * r_mod, y, nz * rz * r_mod), (nx, -.10 * flare, nz)
            self.shell_grid(f"{side}GreatcoatSkirt", greatcoat, 12, 8, 22, 16, .48, "coatNavy",
                            self.blend_y(leg, "hips", 11.5, 19.8))

        # 挺括立领 + 内衬白衬衫领 + 贴胸剪裁翻领 + 清晰可见的金色大肩章与袖章
        def collar_eval(u, v, high):
            ang = math.pi + (u - .5) * 4.7
            y = 32.0 + v * 2.65
            r = 3.20 + v * .35
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * r, y, .20 + nz * r), (nx, .15, nz)
        self.shell_grid("OfficerCollar", collar_eval, 14, 4, 24, 8, .42, "coatTrim", "torso")
        # 贴合前胸的 V 形双翻领（曲面贴胸，绝不悬空！）
        for s in (-1, 1):
            def lapel_eval(u, v, high, ss=s):
                y = 26.8 + v * 5.2
                # 从胸中向下收窄、向上朝肩部展开的典雅军官翻领
                ang = ss * (.12 + v * .34 + u * (.24 + .18 * v))
                rx = 5.55 + .75 * v
                rz = 4.18 + .25 * math.sin(v * math.pi)
                nx, nz = math.sin(ang), math.cos(ang)
                return (nx * rx, y, .32 + nz * rz), (nx, 0.0, nz)
            self.shell_grid(f"CoatLapel{s}", lapel_eval, 6, 6, 12, 12, .32, "coatTrim", "torso")
            for y_btn in (22.2, 24.5, 26.8):
                self.sphere(f"BrassBtn{s}_{y_btn}", (s * 1.45, y_btn, 4.35), (.38, .38, .22), "goldTrim", "torso")
            # 高位浮雕金色军官肩章（清晰架于肩峰之上，不再陷入肩肉！）
            self.box(f"EpauletteBase{s}", (s * 5.35, 32.85, .15), (3.85, .52, 2.55), "coatTrim", "torso",
                     rot=(0, 0, -s * .22), bevel=.10)
            self.box(f"EpauletteGold{s}", (s * 5.45, 33.18, .15), (3.65, .36, 2.35), "goldTrim", "torso",
                     rot=(0, 0, -s * .22), bevel=.08)
        self.box("OfficerTeamBadge", (-3.2, 28.4, 4.45), (2.2, 1.25, .28), "team", "torso", slot=1, rot=(0, -.18, 0), bevel=.04)

        # 头部：自然面部雕塑 + 挺括经典军官大檐帽（干练帽檐 + 金色帽带/徽章）
        self.add_anatomical_head("skin")
        hy, hz = self.orig["head"].y, self.orig["head"].z
        self.loft_y("OfficerCapCrown", [
            (hy + 2.05, 0.0, hz + .05, 3.10, 3.10, 3.30, 3.20),
            (hy + 3.05, 0.0, hz + .15, 3.40, 3.40, 3.60, 3.35),
            (hy + 4.15, 0.0, hz + .32, 3.85, 3.85, 4.02, 3.58),
            (hy + 4.80, 0.0, hz + .18, 2.75, 2.75, 2.95, 2.75),
        ], "coatNavy", "head", around_lo=22, around_hi=36)
        self.loft_y("OfficerCapBand", [
            (hy + 2.05, 0.0, hz + .05, 3.22, 3.22, 3.42, 3.32),
            (hy + 2.82, 0.0, hz + .10, 3.28, 3.28, 3.48, 3.35),
        ], "coatTrim", "head", around_lo=20, around_hi=32)
        self.loft_y("OfficerCapGoldCord", [
            (hy + 2.15, 0.0, hz + .12, 3.26, 3.26, 3.48, 3.32),
            (hy + 2.40, 0.0, hz + .12, 3.26, 3.26, 3.48, 3.32),
        ], "goldTrim", "head", around_lo=20, around_hi=32)
        def visor_peak(u, v, high):
            ang = (u - .5) * 1.80
            r = 3.12 + v * 1.75 * math.cos(ang * .68)
            drop = -.82 * v * v
            return (math.sin(ang) * r, hy + 2.08 + drop, hz + .16 + math.cos(ang) * r), (0.0, 1.0, .28)
        self.shell_grid("OfficerCapPeak", visor_peak, 12, 4, 22, 8, .28, "bootLeather", "head")
        self.sphere("CapEmblem", (0.0, hy + 3.22, hz + 3.65), (.88, .68, .32), "goldTrim", "head")
        # 通讯耳麦指示灯移至左耳侧（不破坏帽檐）
        self.sphere("OfficerEarpiece", (-3.0, hy + .75, hz + .15), (.48, .68, .68), "darkMetal", "head")
        self.sphere("OfficerCommsLED", (-3.32, hy + .75, hz + .45), (.24, .24, .24), "lamp", "head", slot=2)

        self.add_anatomical_arms("coatNavy", glove_mat="bootLeather", bulk=.94,
                                 pauldron_mat=None, cuff_trim_mat="goldTrim")
        self.add_datapad("LHand")
        self.add_pistol("RHand")

    def build_relay_pathfinder(self):
        """远行者 · 探路工程兵：层次丰富的沙漠工业防爆外骨骼、对称重甲护肩、双气罐照明背包、等离子焊枪。"""
        self.add_anatomical_legs("sandPants", armor_mat="sandArmor", boot_style="tactical", bulk=1.08,
                                 kneepad_mat="darkMetal")
        self.add_anatomical_torso("sandPants", width_scale=1.08, depth_scale=1.06, fold_amp=.016)
        self.add_belt("leatherDark", "steel", width_scale=1.08, pouches=True, pouch_mat="sandArmorDark")

        # 分层工业胸甲 + 散热肋条 + 胸挂工具包 + 仪表发光芯
        def vest_front(u, v, high):
            ang = (u - .5) * 2.15
            y = 22.8 + v * 9.4
            rx = 5.8 + 1.45 * math.sin(v * math.pi * .8)
            rz = 4.3 + .75 * math.sin(v * math.pi * .85)
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * rx, y, .25 + nz * rz), (nx, 0.0, nz)
        self.shell_grid("EngChestArmor", vest_front, 12, 7, 22, 14, .72, "sandArmor", "torso")
        self.box("EngChestCore", (0.0, 26.8, 5.25), (4.6, 4.2, .95), "darkMetal", "torso", bevel=.22)
        for dy in (-1.0, 0.0, 1.0):
            self.box(f"EngVentRib{dy}", (0.0, 26.8 + dy, 5.75), (3.4, .36, .32), "sandArmorDark", "torso", bevel=.06)
        for s in (-1, 1):
            self.tube_path(f"EngChestStrap{s}", [
                (s * 3.4, 27.6, 5.15), (s * 3.8, 31.2, 4.45), (s * 4.2, 33.1, 1.8), (s * 4.0, 32.8, -2.5), (s * 3.5, 29.5, -4.6)
            ], .48, "leatherDark", "torso", sides_lo=8, sides_hi=14)
            self.box(f"EngChestPouch{s}", (s * 3.6, 24.4, 4.55), (2.2, 2.7, 1.35), "olivePouch", "torso",
                     rot=(0, s * .28, 0), bevel=.24)
        self.box("EngTeamBadge", (-3.8, 30.0, 4.88), (2.0, 1.2, .32), "team", "torso", slot=1, rot=(0, -.30, 0), bevel=.05)

        self.box("EngPackFrame", (0.0, 27.6, -5.4), (9.2, 10.6, 3.6), "sandArmorDark", "torso", bevel=.45)
        for s in (-1, 1):
            self.loft_y(f"EngTank{s}", [
                (21.8, s * 3.5, -8.2, 1.45, 1.45, 1.45, 1.45),
                (22.8, s * 3.5, -8.2, 1.88, 1.88, 1.88, 1.88),
                (32.5, s * 3.5, -8.2, 1.88, 1.88, 1.88, 1.88),
                (33.8, s * 3.5, -8.2, 1.20, 1.20, 1.20, 1.20),
            ], "steel", "torso", around_lo=14, around_hi=26)
            self.loft_y(f"EngTankBand{s}", [
                (29.0, s * 3.5, -8.2, 2.02, 2.02, 2.02, 2.02),
                (30.4, s * 3.5, -8.2, 2.02, 2.02, 2.02, 2.02),
            ], "sandArmor", "torso", around_lo=14, around_hi=24)
        self.tube_path("WorkLampArm", [(5.2, 26.5, -4.6), (6.2, 33.8, -3.5), (5.6, 35.6, -1.5)],
                       .52, "darkMetal", "torso")
        self.box("WorkLampHead", (5.6, 36.0, -.4), (2.8, 2.0, 1.9), "sandArmor", "torso", bevel=.24)
        self.box("WorkLampLens", (5.6, 36.0, .62), (2.0, 1.2, .35), "lamp", "torso", slot=2, bevel=.05)

        hy, hz = self.orig["head"].y, self.orig["head"].z
        self.loft_y("EngNeckSeal", [
            (hy - 2.3, 0.0, hz - .2, 2.5, 2.5, 2.4, 2.3),
            (hy - .5,  0.0, hz - .1, 2.35, 2.35, 2.35, 2.3),
        ], "webbingDark", self.blend_y("torso", "head", hy - 2.2, hy - .6))
        self.loft_y("EngHelmet", [
            (hy - 1.55, 0.0, hz + .35, 2.85, 2.85, 3.45, 2.65),
            (hy - .10,  0.0, hz + .20, 3.95, 3.95, 4.15, 3.75),
            (hy + 1.65, 0.0, hz + .05, 4.25, 4.25, 4.35, 4.25),
            (hy + 3.30, 0.0, hz - .10, 3.75, 3.75, 3.85, 3.95),
            (hy + 4.45, 0.0, hz - .15, 2.40, 2.40, 2.55, 2.75),
        ], "sandArmor", "head", around_lo=22, around_hi=38)
        self.box("EngHelmetCrest", (0.0, hy + 4.25, hz + .15), (1.35, 1.25, 6.4), "darkMetal", "head", bevel=.22)
        def eng_brow(u, v, high):
            ang = (u - .5) * 2.10
            r = 4.20 + v * 1.15 * math.cos(ang * .55)
            return (math.sin(ang) * r, hy + 2.40 - .25 * v, hz + .15 + math.cos(ang) * r), (0.0, 1.0, .25)
        self.shell_grid("EngHelmetBrow", eng_brow, 12, 3, 20, 6, .35, "sandArmorDark", "head")
        def eng_visor(u, v, high):
            ang = (u - .5) * 1.90
            y = hy + .15 + v * 2.15
            r = 4.32 + .12 * math.sin(v * math.pi)
            return (math.sin(ang) * r, y, hz + .10 + math.cos(ang) * r), (math.sin(ang), 0.0, math.cos(ang))
        self.shell_grid("EngVisor", eng_visor, 12, 5, 22, 10, .40, "visorAmber", "head")
        for s in (-1, 1):
            self.sphere(f"EngEarPod{s}", (s * 4.25, hy + 1.1, hz - .1), (.72, 1.25, 1.25), "darkMetal", "head")

        self.add_anatomical_arms("sandPants", glove_mat="leatherDark", armor_mat="sandArmor",
                                 bulk=1.08, pauldron_mat="sandArmor")

        o = self.orig["RHand"]
        x, y, z = o.x, o.y - .35, o.z + 1.2
        self.box("TorchBody", (x, y + 1.45, z + 3.0), (2.4, 2.65, 6.6), "sandArmor", "RHand", bevel=.30)
        self.tube_path("TorchTank", [(x, y + .25, z + 4.2), (x, y + .25, z + 8.0)], .78, "sandArmorDark", "RHand")
        self.tube_path("TorchBarrel", [(x, y + 1.55, z + 6.0), (x, y + 1.55, z + 11.4)], [.84, .64], "steel", "RHand")
        self.tube_path("TorchNozzle", [(x, y + 1.55, z + 11.2), (x, y + 1.55, z + 13.8)], [.70, 1.38], "darkMetal", "RHand")
        self.box("TorchGrip", (x, y - .5, z + .5), (1.15, 2.35, 1.4), "bootRubber", "RHand", rot=(-.22, 0, 0), bevel=.16)

    def build_relay_observer(self):
        """远行者 · 侦察观察员：完整封顶深垂兜帽、连体飘逸沙漠斗篷披肩、肩载双目光学桅杆、数据板。"""
        self.add_anatomical_legs("sandPants", boot_style="tactical", bulk=.92, kneepad_mat="leatherDark")
        self.add_anatomical_torso("sandPants", width_scale=.92, depth_scale=.92, fold_amp=.026)
        self.add_belt("leatherDark", "steel", width_scale=.94, pouches=True, pouch_mat="olivePouch")

        # 无缝环肩沙漠斗篷披肩（肩部自然拱起完全包覆双肩，前胸优雅 V 摆，无穿模！）
        def poncho_mantle(u, v, high):
            ang = u * math.tau
            flare = (1.0 - v) ** .90
            front_v = 2.4 * max(0.0, math.cos(ang)) ** 2
            back_ext = 6.0 * max(0.0, -math.cos(ang)) ** 1.4
            y = 24.6 + v * 9.4 - (front_v + back_ext) * flare
            shoulder_arch = math.sin(v * math.pi * .85) * 2.15
            rx = 3.85 + flare * 5.65 + shoulder_arch
            rz = 3.45 + flare * 3.05 + shoulder_arch * .45
            pleat = (.42 * math.sin(ang * 7.0) +
                     (.16 if high else 0.0) * math.sin(ang * 15.0)) * flare
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * (rx + pleat), y, nz * (rz + pleat) - .18), (nx, .38 * v, nz)
        self.shell_grid("ObserverPoncho", poncho_mantle, 28, 9, 48, 18, .44, "cloakSand", "torso", wrap_u=True)

        # 下垂长披风后摆
        def rear_cape(u, v, high):
            x = (u - .5) * (9.8 + (1.0 - v) * 3.8)
            y = 9.5 + v * 22.0
            curve = -4.2 - 1.8 * (1.0 - v) ** .8 - .45 * (u - .5) ** 2 * 4.0
            wave = (.55 * math.sin(u * math.pi * 4.0) +
                    (.18 if high else 0.0) * math.sin(u * math.pi * 10.0)) * (1.0 - v * .65)
            return (x, y, curve + wave), (0.0, 0.0, -1.0)
        self.shell_grid("ObserverCape", rear_cape, 14, 10, 26, 20, .40, "cloakSand",
                        self.blend_y("hips", "torso", 16.0, 26.0))
        self.box("ObsTeamPatch", (-2.6, 28.4, 5.85), (1.9, 1.1, .28), "team", "torso", slot=1, rot=(.18, -.25, 0), bevel=.04)

        self.loft_y("ObsPack", [
            (23.0, 0.0, -5.2, 3.6, 3.6, 1.9, 2.2),
            (27.5, 0.0, -5.5, 4.0, 4.0, 2.2, 2.5),
            (31.5, 0.0, -5.0, 3.4, 3.4, 1.8, 2.0),
        ], "olivePouch", "torso", around_lo=14, around_hi=26, fold_amp=.025)
        self.tube_path("OpticMast", [(-3.9, 28.5, -6.4), (-3.9, 45.2, -6.4)], [.58, .42], "steel", "torso")
        self.box("OpticPod", (-3.9, 45.8, -6.2), (6.4, 3.6, 3.8), "darkMetal", "torso", bevel=.38)
        self.tube_path("OpticLensHood", [(-3.9, 45.8, -4.4), (-3.9, 45.8, -3.5)], [1.55, 1.45], "steel", "torso")
        self.sphere("OpticMainLens", (-3.9, 45.8, -3.95), (1.28, 1.28, .55), "screenGlow", "torso")
        self.sphere("OpticSensorLamp", (-1.8, 46.2, -4.25), (.48, .48, .35), "lamp", "torso", slot=2)

        # 头部：完整封闭穹顶深垂侦察兜帽（前檐平滑一体前伸，无额头接缝！）+ 暗色面罩 + 发光侦察目镜
        hy, hz = self.orig["head"].y, self.orig["head"].z
        self.add_anatomical_head(covered_mat="webbingDark")
        def hood_shape(ang, t, high):
            sa = math.sin(ang)
            # 眉梢处兜帽自然前伸成遮阳檐，脸窗下方内敛环抱面罩
            brow = .18 * max(0.0, sa) ** 2 * math.exp(-((t - .62) / .18) ** 2)
            # 脑后自然微微收尖的经典侦察兜帽轮廓
            tail = .12 * max(0.0, -sa) ** 2 * math.exp(-((t - .55) / .24) ** 2)
            return 1.0 + brow + tail
        self.loft_y("ObserverHoodCrown", [
            (hy - 2.1, 0.0, hz - .45, 3.95, 3.95, 2.40, 4.35),
            (hy + .20, 0.0, hz - .35, 4.28, 4.28, 2.55, 4.65),
            (hy + 2.40, 0.0, hz - .10, 4.18, 4.18, 4.25, 4.45),
            (hy + 3.95, 0.0, hz - .20, 3.30, 3.30, 3.65, 3.70),
            (hy + 4.85, 0.0, hz - .40, 1.65, 1.65, 1.95, 2.15),
        ], "cloakSand", "head", around_lo=22, around_hi=38, shape_fn=hood_shape, fold_amp=.034)

        def obs_visor(u, v, high):
            ang = (u - .5) * 1.45
            y = hy + .45 + v * 1.65
            r = 3.22
            return (math.sin(ang) * r, y, hz + .35 + math.cos(ang) * r), (math.sin(ang), 0.0, math.cos(ang))
        self.shell_grid("ObsVisor", obs_visor, 10, 4, 18, 8, .32, "visor", "head")
        self.sphere("ObsOpticEye", (-1.35, hy + 1.25, hz + 3.65), (.68, .68, .45), "lamp", "head", slot=2)

        self.add_anatomical_arms("sandPants", glove_mat="leatherDark", bulk=.90, pauldron_mat=None)
        self.add_datapad("LHand")
        self.add_pistol("RHand")

    def build(self):
        dispatch = {
            "relay:ranger": self.build_relay_ranger,
            "industrial:medic": self.build_industrial_medic,
            "industrial:commander": self.build_industrial_commander,
            "relay:pathfinder": self.build_relay_pathfinder,
            "relay:observer": self.build_relay_observer,
        }
        dispatch[self.key]()
        return self.pairs
