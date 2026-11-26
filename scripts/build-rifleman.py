"""工业联邦 · 重甲突击步兵：独立形体雕塑、高低模投射、2K PBR 与 16 骨双手 IK 契约。

与战地医疗兵、幽影狙击手、工程采集车及战场 HUD 头像保持同一硬朗科幻重甲画风：
- 挺拔稳健的重甲步兵比例，陶瓷白弧面胸甲／双层圆弧肩甲／分节腹甲／全封闭面罩头盔；
- 独立脉冲突击步枪挂载于 rifle 骨骼，运行时由 unit-rig.ts 解析双骨 IK 实现胸前低枪戒备、
  行军自然随动与抵肩平射后坐。
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sculpt_surface_library import CERAMIC, GLASS, LEATHER, NYLON, SEAL, STEEL, bind_surface, sources_for

SURFACE_TEXTURES = {
    "ceramic": CERAMIC, "ceramicHi": CERAMIC, "armorMid": CERAMIC, "armorDark": CERAMIC,
    "undersuit": NYLON, "pouch": NYLON, "rubber": SEAL, "glove": LEATHER,
    "gun": STEEL, "gunDark": STEEL, "steel": STEEL, "visor": GLASS, "lens": GLASS,
}

parser = argparse.ArgumentParser()
parser.add_argument("--template", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--resolution", type=int, default=2048)
parser.add_argument("--device", choices=["CPU", "METAL"], default="METAL")
parser.add_argument("--preview-only", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

KEY = "industrial:soldier"
directory = Path(args.output)
directory.mkdir(parents=True, exist_ok=True)
template = json.loads(Path(args.template).read_text())["templates"][KEY]
joints = template["rig"]
joint_ids = {joint["name"]: index for index, joint in enumerate(joints)}
script_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

scene = bpy.context.scene
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.context.preferences.filepaths.file_preview_type = "NONE"
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.device = "CPU"
if args.device == "METAL":
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    if any(device.type == "METAL" for device in preferences.devices):
        for device in preferences.devices:
            device.use = device.type == "METAL"
        scene.cycles.device = "GPU"
scene.view_settings.view_transform = "AgX"
scene.world.color = (.13, .13, .13)
scene.render.image_settings.file_format = "PNG"
scene.render.bake.margin = max(4, args.resolution // 256)

low_collection = bpy.data.collections.new("01 · GAME LOW / heavy armored rifleman")
high_collection = bpy.data.collections.new("02 · HIGH / beveled ceramic armor + pulse rifle")
scene.collection.children.link(low_collection)
scene.collection.children.link(high_collection)
pieces = []

# 工业联邦重甲配色：与战地医疗兵、工程采集车及 HUD 头像同源，强明度对比确保俯视角轮廓醒目。
PALETTE = {
    "ceramic":   ((.80, .84, .86), .38, .14, "plate"),
    "ceramicHi": ((.86, .89, .90), .34, .12, "plate"),
    "armorMid":  ((.38, .45, .51), .42, .34, "plate"),
    "armorDark": ((.18, .22, .26), .46, .52, "plate"),
    "undersuit": ((.13, .16, .19), .74, .08, "fabric"),
    "rubber":    ((.085, .095, .105), .86, .00, "rubber"),
    "glove":     ((.15, .18, .20), .68, .10, "rubber"),
    "pouch":     ((.24, .28, .31), .66, .12, "fabric"),
    "gun":       ((.21, .25, .28), .36, .78, "metal"),
    "gunDark":   ((.11, .13, .15), .42, .68, "metal"),
    "steel":     ((.48, .53, .56), .26, .88, "metal"),
    "recess":    ((.03, .04, .045), .65, .30, "metal"),
    "visor":     ((.05, .22, .32), .12, .26, "glass"),
    "lens":      ((.06, .32, .42), .12, .22, "glass"),
    "team":      ((.74, .76, .74), .42, .20, "team"),
    "lamp":      ((.42, .84, .88), .22, .05, "lamp"),
}


def log(text):
    print("RIFLEMAN " + text, flush=True)


def select(objects, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def point(p):
    return Vector((p[0], -p[2], p[1]))


def attr(mesh, name, values, size=3):
    kind, field = ("FLOAT_VECTOR", "vector") if size == 3 else ("FLOAT_COLOR", "color")
    mesh.attributes.new(name, kind, "POINT").data.foreach_set(field, values)


def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def material(name):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    color, rough, metal, kind = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["metalness"] = metal
    mat["roughness"] = rough
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough

    coords = nodes.new("ShaderNodeAttribute")
    coords.attribute_name = "_installCoord"
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.2 if kind == "plate" else 7.5 if kind == "fabric" else 4.8
    noise.inputs["Detail"].default_value = 7.0
    noise.inputs["Roughness"].default_value = .62
    links.new(coords.outputs["Vector"], noise.inputs["Vector"])

    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 18.0 if kind == "fabric" else 13.0
    fine.inputs["Detail"].default_value = 5.0
    links.new(coords.outputs["Vector"], fine.inputs["Vector"])

    base = tuple(linear(c) for c in color)
    tint = nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.inputs["A"].default_value = (*tuple(c * (.86 if kind == "plate" else .80) for c in base), 1)
    tint.inputs["B"].default_value = (*tuple(min(1, c * (1.07 if kind == "plate" else 1.12)) for c in base), 1)
    links.new(noise.outputs["Fac"], tint.inputs["Factor"])

    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 8
    ao.inputs["Distance"].default_value = 1.6
    links.new(tint.outputs["Result"], ao.inputs["Color"])

    cavity = nodes.new("ShaderNodeMix")
    cavity.data_type = "RGBA"
    cavity.blend_type = "MULTIPLY"
    cavity.inputs["Factor"].default_value = .45 if kind in ("plate", "metal") else .35
    links.new(tint.outputs["Result"], cavity.inputs["A"])
    links.new(ao.outputs["Color"], cavity.inputs["B"])

    # 装甲边缘微亮磨白与表面轻微做旧（保持洁净工业重甲观感，不显脏污）。
    geom = nodes.new("ShaderNodeNewGeometry")
    edge_ramp = nodes.new("ShaderNodeMapRange")
    edge_ramp.inputs["From Min"].default_value = .52
    edge_ramp.inputs["From Max"].default_value = .64
    links.new(geom.outputs["Pointiness"], edge_ramp.inputs["Value"])

    edge_mix = nodes.new("ShaderNodeMix")
    edge_mix.data_type = "RGBA"
    edge_mix.inputs["B"].default_value = (*tuple(min(1, c * 1.18 + .04) for c in base), 1)
    edge_gain = nodes.new("ShaderNodeMath")
    edge_gain.operation = "MULTIPLY"
    edge_gain.inputs[1].default_value = .36 if kind in ("plate", "metal") else .10
    links.new(edge_ramp.outputs["Result"], edge_gain.inputs[0])
    links.new(edge_gain.outputs[0], edge_mix.inputs["Factor"])
    links.new(cavity.outputs["Result"], edge_mix.inputs["A"])
    links.new(edge_mix.outputs["Result"], bsdf.inputs["Base Color"])

    rmap = nodes.new("ShaderNodeMapRange")
    rmap.inputs["To Min"].default_value = max(.08, rough - .09)
    rmap.inputs["To Max"].default_value = min(.98, rough + .10)
    links.new(noise.outputs["Fac"], rmap.inputs["Value"])
    links.new(rmap.outputs["Result"], bsdf.inputs["Roughness"])

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = (
        .035 if kind == "plate" else .09 if kind == "fabric" else .06 if kind == "rubber"
        else .025 if kind == "metal" else .01
    )
    bump.inputs["Distance"].default_value = .03
    links.new(fine.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    if name in SURFACE_TEXTURES:
        path, quadrant, length, mix, depth = SURFACE_TEXTURES[name]
        bind_surface(mat, coords.outputs["Vector"], (path, quadrant, length * .5, mix * .65, depth * .38))
    emit = nodes.new("ShaderNodeEmission")
    emit.name = "Bake emission"
    target = nodes.new("ShaderNodeTexImage")
    target.name = "Bake target"
    return mat


def skin_object(obj, joint, weights=None):
    n = len(obj.data.vertices)
    if weights is None:
        index = joint_ids[joint]
        attr(obj.data, "_skinIndex", [index, 0, 0, 0] * n, 4)
        attr(obj.data, "_skinWeight", [1.0, 0.0, 0.0, 0.0] * n, 4)
    else:
        idx_arr, w_arr = [], []
        for v in obj.data.vertices:
            # 转回游戏坐标系 (X, Y, Z) = (co.x, co.z, -co.y)
            j0, j1, w0, w1 = weights(v.co.x, v.co.z, -v.co.y)
            idx_arr.extend((joint_ids[j0], joint_ids[j1], 0, 0))
            w_arr.extend((w0, w1, 0.0, 0.0))
        attr(obj.data, "_skinIndex", idx_arr, 4)
        attr(obj.data, "_skinWeight", w_arr, 4)


def finalize(name, vertices, faces, surface, joint, bevel=0, smooth=True, collection=low_collection, weights=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([point(v) for v in vertices], [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", clamp_overlap=True)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(material(surface))
    obj["slot"] = 1 if surface == "team" else 2 if surface == "lamp" else 0
    origin = point(joints[joint_ids[joint]]["origin"])
    obj.data.transform(Matrix.Translation(origin))
    attr(obj.data, "_installCoord", [c for v in obj.data.vertices for c in v.co])
    skin_object(obj, joint, weights)
    return obj


def pair(name, maker, surface, joint="torso", bevel=0, smooth=True, weights=None):
    low_v, low_f = maker(False)
    high_v, high_f = maker(True)
    low = finalize(name, low_v, low_f, surface, joint, bevel, smooth, low_collection, weights)
    high = finalize(name + " / high", high_v, high_f, surface, joint, bevel * 1.1 if bevel else 0,
                    smooth, high_collection, weights)
    pieces.append((low, high))
    return low, high


def box(name, center, size, surface, joint="torso", radius=.08, rotation=(0, 0, 0), weights=None):
    def maker(high):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        if radius > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius, segments=4 if high else 2,
                            affect="EDGES", clamp_overlap=True)
        bmesh.ops.rotate(bm, matrix=Euler(rotation, "XYZ").to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
        verts = [tuple(v.co) for v in bm.verts]
        faces = [tuple(v.index for v in f.verts) for f in bm.faces]
        bm.free()
        return verts, faces
    return pair(name, maker, surface, joint, 0, True, weights)


def cylinder(name, start, end, radius, surface, joint="rifle", bevel=.03, sides=18):
    a, b = Vector(start), Vector(end)
    axis = b - a
    length = axis.length
    quat = Vector((0, 0, 1)).rotation_difference(axis.normalized())

    def maker(high):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides * 2 if high else sides,
                              radius1=radius, radius2=radius, depth=length)
        if bevel > 0:
            cap_edges = [e for e in bm.edges if len(e.link_faces) == 2 and
                         abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < .2]
            bmesh.ops.bevel(bm, geom=cap_edges, offset=bevel, segments=3 if high else 1,
                            affect="EDGES", clamp_overlap=True)
        bmesh.ops.rotate(bm, matrix=quat.to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
        verts = [tuple(v.co) for v in bm.verts]
        faces = [tuple(v.index for v in f.verts) for f in bm.faces]
        bm.free()
        return verts, faces
    return pair(name, maker, surface, joint, 0, True)


def extrusion(name, profile, x_center, width, surface, joint="rifle", radius=.05):
    def maker(high):
        bm = bmesh.new()
        half = width / 2
        left = [bm.verts.new((x_center - half, y, z)) for z, y in profile]
        right = [bm.verts.new((x_center + half, y, z)) for z, y in profile]
        bm.faces.new(left)
        bm.faces.new(list(reversed(right)))
        for i in range(len(profile)):
            j = (i + 1) % len(profile)
            bm.faces.new((left[i], left[j], right[j], right[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if radius > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius, segments=4 if high else 2,
                            affect="EDGES", clamp_overlap=True)
        verts = [tuple(v.co) for v in bm.verts]
        faces = [tuple(v.index for v in f.verts) for f in bm.faces]
        bm.free()
        return verts, faces
    return pair(name, maker, surface, joint, 0, True)


def tube(name, center, profile, surface, joint="rifle"):
    def maker(high):
        count = 40 if high else 20
        verts, faces = [], []
        for z, outer, inner in profile:
            for r in (outer, inner):
                for i in range(count):
                    a = i * math.tau / count
                    verts.append((center[0] + math.cos(a) * r, center[1] + math.sin(a) * r, center[2] + z))
        for k in range(len(profile) - 1):
            for layer in (0, 1):
                for i in range(count):
                    a = k * count * 2 + layer * count + i
                    b = k * count * 2 + layer * count + (i + 1) % count
                    faces.append((a, b, b + count * 2, a + count * 2))
        for k in (0, len(profile) - 1):
            off = k * count * 2
            for i in range(count):
                j = (i + 1) % count
                faces.append((off + i, off + j, off + count + j, off + count + i))
        return verts, faces
    return pair(name, maker, surface, joint, .015, True)


def cable(name, path, radius=.12, surface="rubber", joint="torso"):
    pts = [Vector(p) for p in path]

    def maker(high):
        count = 12 if high else 7
        verts, faces = [], []
        for i, at in enumerate(pts):
            axis = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            cross = axis.cross(Vector((0, 1, 0)) if abs(axis.y) < .9 else Vector((1, 0, 0))).normalized()
            other = axis.cross(cross)
            for j in range(count):
                a = j * math.tau / count
                verts.append(tuple(at + (math.cos(a) * cross + math.sin(a) * other) * radius))
        for i in range(len(pts) - 1):
            for j in range(count):
                a = i * count + j
                b = i * count + (j + 1) % count
                faces.append((a, b, b + count, a + count))
        faces += [tuple(reversed(range(count))), tuple((len(pts) - 1) * count + j for j in range(count))]
        return verts, faces
    return pair(name, maker, surface, joint, 0, True)


def anatomical_loft(name, levels, joint, surface="undersuit", phase=0, wrinkle_amp=.015,
                    shape_fn=None, weights=None):
    """非对称解剖截面放样：levels = [(y, xc, zc, rxp, rxn, rzp, rzn), ...]"""
    def maker(high):
        count = 36 if high else 20
        rows = []
        steps = 3 if high else 1
        for a, b in zip(levels, levels[1:]):
            for step in range(steps):
                t = step / steps
                rows.append(tuple(v + (w - v) * t for v, w in zip(a, b)))
        rows.append(levels[-1])
        verts, faces = [], []
        y0, y1 = rows[0][0], rows[-1][0]
        span = max(1e-4, y1 - y0)
        for y, xc, zc, rxp, rxn, rzp, rzn in rows:
            t = (y - y0) / span
            env = math.sin(max(0.0, min(1.0, t)) * math.pi)
            for i in range(count):
                a = i * math.tau / count
                ca, sa = math.cos(a), math.sin(a)
                rx = rxp if ca >= 0 else rxn
                rz = rzp if sa >= 0 else rzn
                mod = 1.0 if shape_fn is None else shape_fn(a, t, high)
                if wrinkle_amp > 0:
                    w_lo = math.sin(a * 5 + phase + y * 1.4) * .55 + math.cos(a * 8 - y) * .45
                    mod += wrinkle_amp * env * w_lo * (.65 if not high else 1.0)
                    if high:
                        mod += wrinkle_amp * .5 * env * math.sin(a * 4 + y * 4.2 + phase)
                verts.append((xc + ca * rx * mod, y, zc + sa * rz * mod))
        for k in range(len(rows) - 1):
            for i in range(count):
                a, b = k * count + i, k * count + (i + 1) % count
                faces.append((a, b, b + count, a + count))
        c0 = len(verts)
        y, xc, zc, rxp, rxn, rzp, rzn = rows[0]
        verts.append((xc, y - min(rxp, rxn, rzp, rzn) * .12, zc))
        c1 = len(verts)
        y, xc, zc, rxp, rxn, rzp, rzn = rows[-1]
        verts.append((xc, y + min(rxp, rxn, rzp, rzn) * .12, zc))
        top = (len(rows) - 1) * count
        for i in range(count):
            j = (i + 1) % count
            faces.append((c0, j, i))
            faces.append((c1, top + i, top + j))
        return verts, faces
    return pair(name, maker, surface, joint, 0, True, weights)


def curved_shell(name, eval_fn, u_lo, v_lo, u_hi, v_hi, thickness, surface, joint="torso",
                 wrap_u=False, bevel=.04, weights=None):
    """带真实厚度和清晰边缘倒角的曲面装甲壳。"""
    def maker(high):
        nu, nv = (u_hi, v_hi) if high else (u_lo, v_lo)
        u_count = nu if wrap_u else nu + 1
        outer, inner = [], []
        for iv in range(nv + 1):
            v = iv / nv
            for iu in range(u_count):
                u = iu / nu
                pos, nrm = eval_fn(u, v, high)
                p = Vector(pos)
                n = Vector(nrm).normalized()
                outer.append(tuple(p + n * (thickness * .5)))
                inner.append(tuple(p - n * (thickness * .5)))
        verts = outer + inner
        off = len(outer)
        faces = []
        u_steps = nu
        for iv in range(nv):
            for iu in range(u_steps):
                iu2 = (iu + 1) % u_count if wrap_u else iu + 1
                a = iv * u_count + iu
                b = iv * u_count + iu2
                c = (iv + 1) * u_count + iu2
                d = (iv + 1) * u_count + iu
                faces.append((a, b, c, d))
                faces.append((off + d, off + c, off + b, off + a))
        for iu in range(u_steps):
            iu2 = (iu + 1) % u_count if wrap_u else iu + 1
            a, b = iu, iu2
            faces.append((a, off + a, off + b, b))
            a2 = nv * u_count + iu
            b2 = nv * u_count + iu2
            faces.append((a2, b2, off + b2, off + a2))
        if not wrap_u:
            for iv in range(nv):
                a = iv * u_count
                b = (iv + 1) * u_count
                faces.append((a, b, off + b, off + a))
                a2 = iv * u_count + (u_count - 1)
                b2 = (iv + 1) * u_count + (u_count - 1)
                faces.append((a2, off + a2, off + b2, b2))
        return verts, faces
    return pair(name, maker, surface, joint, bevel, True, weights)


def blend_y(low_joint, high_joint, y0, y1):
    def fn(_x, y, _z):
        t = max(0.0, min(1.0, (y - y0) / max(1e-4, y1 - y0)))
        t = t * t * (3.0 - 2.0 * t)
        return (low_joint, high_joint, 1.0 - t, t)
    return fn


def build_armored_boot(side, s, foot):
    """工业联邦重甲战靴：宽稳抓地靴底、斜面陶瓷护趾甲、钢灰踝套、侧方液压稳定连杆。"""
    cx = -s * .32
    y_bot = -1.65

    def boot_maker(high):
        n_ring = 28 if high else 16
        # 脚底到脚踝轮廓：后跟 z=-2.15，鞋尖 z=+4.65
        rings = [
            (y_bot + .04,  0.00, 1.05, 1.80, 1.80, 4.45, 2.05),
            (y_bot + .52,  0.00, 1.08, 1.98, 1.98, 4.72, 2.18),
            (y_bot + 1.05, 0.00, 1.00, 1.92, 1.92, 4.45, 2.10),
            (y_bot + 1.72, 0.00, .72,  1.80, 1.80, 3.60, 1.98),
            (y_bot + 2.38, 0.00, .28,  1.76, 1.76, 2.32, 1.86),
            (y_bot + 3.05, 0.00, .06,  1.84, 1.84, 1.98, 1.88),
        ]
        verts, faces = [], []
        for y, dx, zc, rxp, rxn, zf, zb in rings:
            for i in range(n_ring):
                a = i * math.tau / n_ring
                ca, sa = math.cos(a), math.sin(a)
                rx = rxp if ca >= 0 else rxn
                z_local = sa * (zf - zc) if sa >= 0 else sa * (zb + zc)
                if sa > .35:
                    rx *= 1.0 - .18 * ((sa - .35) / .65) ** 1.4
                verts.append((cx + dx + ca * rx, y, zc + z_local))
        for k in range(len(rings) - 1):
            for i in range(n_ring):
                a = k * n_ring + i
                b = k * n_ring + (i + 1) % n_ring
                faces.append((a, b, b + n_ring, a + n_ring))
        c0 = len(verts)
        verts.append((cx, y_bot, 1.0))
        c1 = len(verts)
        verts.append((cx, y_bot + 3.12, .06))
        top = (len(rings) - 1) * n_ring
        for i in range(n_ring):
            j = (i + 1) % n_ring
            faces.append((c0, j, i))
            faces.append((c1, top + i, top + j))
        return verts, faces

    pair(f"{side} Armored boot core", boot_maker, "armorDark", foot, 0, True)
    # 抓地橡胶厚底（贴合圆润靴楦，无方形外凸角）
    box(f"{side} Boot sole", (cx, y_bot + .24, 1.15), (3.55, .48, 6.35), "rubber", foot, .22)
    # 弧面陶瓷白护趾前甲
    def toe_cap(u, v, high):
        ang = (u - .5) * 2.15
        y = y_bot + .56 + v * 1.42
        rx = 1.92 - .45 * v
        rz = 2.65 - .75 * v
        nx, nz = math.sin(ang), math.cos(ang)
        return (cx + nx * rx, y, 2.05 + nz * rz), (nx, .35, nz)
    curved_shell(f"{side} Ceramic toe guard", toe_cap, 10, 4, 20, 8, .34, "ceramic", foot, bevel=.04)
    # 脚背钢灰护带 + 踝侧稳定液压栓
    box(f"{side} Instep clamp", (cx, y_bot + 1.85, 2.05), (3.55, .72, 1.35), "armorMid", foot, .16, (.36, 0, 0))
    for hs in (-1, 1):
        cylinder(f"{side} Ankle actuator {hs}", (cx + hs * 1.82, y_bot + 1.10, -.55),
                 (cx + hs * 1.82, y_bot + 2.85, -.35), .28, "steel", foot, .04, 12)
    box(f"{side} Heel bumper", (cx, y_bot + 1.12, -1.95), (3.25, 1.35, .85), "armorMid", foot, .18)


def build_trooper():
    """构建工业联邦重甲突击步兵主体（挺拔站姿、完整陶瓷弧面甲、强阵营识别色）。"""
    # 1. 骨盆、裆甲与战术腰带（hips 原点 y=18.15）
    anatomical_loft("Pelvis undersuit", [
        (-2.3, 0.0, -.05, 4.65, 4.65, 3.15, 3.35),
        (-.6,  0.0, -.05, 5.15, 5.15, 3.45, 3.55),
        (1.6,  0.0,  .00, 4.95, 4.95, 3.35, 3.45),
        (3.4,  0.0,  .05, 4.60, 4.60, 3.20, 3.25),
    ], "hips", "undersuit", wrinkle_amp=.010)

    # 陶瓷白前护裆与侧裙甲（与大腿自然留出跨步间隙）
    box("Pelvic codpiece", (0.0, -.15, 3.45), (4.2, 4.1, 1.55), "ceramic", "hips", .32, (.10, 0, 0))
    box("Codpiece center ridge", (0.0, -.35, 4.12), (1.45, 3.1, .55), "armorMid", "hips", .12, (.12, 0, 0))
    box("Rear lumbar guard", (0.0, .65, -3.55), (7.6, 3.5, 1.35), "armorMid", "hips", .28)
    for s in (-1, 1):
        box(f"Hip tasset {s}", (s * 5.25, -.45, .35), (1.35, 4.2, 4.65), "ceramic", "hips", .26, (0, 0, -s * .14))
        box(f"Hip tasset trim {s}", (s * 5.65, -.55, .35), (.55, 2.2, 3.15), "armorMid", "hips", .10, (0, 0, -s * .14))

    # 重型战术腰带 + 扣具 + 腰挂备用弹匣与战术手雷
    anatomical_loft("Utility belt", [
        (1.05, 0.0, .05, 5.45, 5.45, 3.85, 3.90),
        (2.45, 0.0, .05, 5.45, 5.45, 3.85, 3.90),
    ], "hips", "armorDark", wrinkle_amp=0.0)
    box("Belt buckle", (0.0, 1.75, 4.02), (2.45, 1.65, .75), "steel", "hips", .12)
    for s in (-1, 1):
        box(f"Hip mag pouch {s}", (s * 4.55, 1.55, 2.85), (2.25, 3.10, 1.45), "pouch", "hips", .22, (0, s * .42, 0))
        box(f"Hip pouch flap {s}", (s * 4.65, 2.80, 2.95), (2.30, .62, 1.52), "armorDark", "hips", .12, (0, s * .42, 0))
    for gx in (-2.55, -1.25):
        cylinder(f"Belt grenade {gx}", (gx, .85, -4.15), (gx, 2.85, -4.15), .58, "armorMid", "hips", .12, 14)
        cylinder(f"Grenade cap {gx}", (gx, 2.85, -4.15), (gx, 3.25, -4.15), .32, "steel", "hips", .05, 12)
    box("Rear utility kit", (2.05, 1.75, -4.15), (3.4, 2.75, 1.55), "pouch", "hips", .24)

    # 2. 躯干与标志性重甲胸铠（torso 原点 y=21.95）
    def torso_shape(a, t, high):
        sa, ca = math.sin(a), math.cos(a)
        chest = .12 * max(0.0, sa) * math.sin(t * math.pi)
        lats = .10 * abs(ca) * (t ** .7)
        return 1.0 + chest + lats

    anatomical_loft("Torso undersuit", [
        (-.8,  0.0,  .00, 4.55, 4.55, 3.25, 3.30),
        (2.4,  0.0,  .08, 5.15, 5.15, 3.65, 3.60),
        (6.4,  0.0,  .15, 6.25, 6.25, 4.25, 4.05),
        (9.6,  0.0,  .10, 6.55, 6.55, 4.10, 3.95),
        (11.8, 0.0,  .18, 4.45, 4.45, 3.25, 3.20),
        (13.2, 0.0,  .48, 2.55, 2.55, 2.45, 2.35),
    ], "torso", "undersuit", wrinkle_amp=.010, shape_fn=torso_shape)

    # 3 层分节钢灰腹甲
    for idx, (y_ab, rx_ab, rz_ab) in enumerate(((1.1, 4.85, 3.72), (2.35, 5.15, 3.95), (3.60, 5.45, 4.18))):
        def ab_seg(u, v, high, yb=y_ab, rxb=rx_ab, rzb=rz_ab):
            ang = (u - .5) * 1.85
            y = yb + v * 1.05
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * rxb, y, .18 + nz * rzb), (nx, .08, nz)
        curved_shell(f"Abdominal plate {idx}", ab_seg, 10, 3, 20, 6, .48, "armorMid", "torso", bevel=.05)

    # 宽厚雕塑级陶瓷白前胸甲（带斜切胸肌斜面与硬朗机械轮廓）
    def chest_cuirass(u, v, high):
        ang = (u - .5) * 2.15
        y = 4.35 + v * 6.95
        arch = math.sin(v * math.pi * .82)
        rx = 5.45 + 1.45 * arch
        rz = 4.22 + 1.05 * arch
        # 居中 V 形胸脊微凸
        ridge = .38 * math.exp(-((u - .5) * 5.2) ** 2) * (1.0 - .35 * abs(v - .55))
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .35 + nz * (rz + ridge)), (nx, .14 * (v - .42), nz)
    curved_shell("Heavy ceramic cuirass", chest_cuirass, 14, 8, 28, 16, .78, "ceramic", "torso", bevel=.07)

    # 胸前厚实中置装甲板（呼应 HUD 头像里的白色重甲胸板！）+ 左右斜切锁骨散热槽
    box("Sternum armor block", (0.0, 7.65, 5.65), (5.6, 5.15, 1.35), "ceramicHi", "torso", .30, (-.08, 0, 0))
    box("Sternum inner inset", (0.0, 7.55, 6.26), (3.6, 3.20, .38), "armorMid", "torso", .10, (-.08, 0, 0))
    box("Sternum center bar", (0.0, 8.75, 6.38), (2.4, .55, .28), "armorDark", "torso", .05, (-.08, 0, 0))
    for s in (-1, 1):
        box(f"Chest flank plate {s}", (s * 4.35, 7.85, 4.75), (2.95, 4.45, 1.15), "ceramic", "torso", .22,
            (-.06, s * .46, -s * .06))
        box(f"Chest vent {s}", (s * 4.45, 6.15, 5.05), (1.65, .62, .45), "armorDark", "torso", .06, (0, s * .45, 0))
        box(f"Collar strut {s}", (s * 3.85, 11.05, 3.05), (1.35, 1.55, 2.65), "armorMid", "torso", .18, (.32, s * .25, 0))

    # 醒目阵营色胸牌（slot=1，玩家色染色！）
    box("Chest team IFF plate", (-3.95, 8.65, 5.38), (2.25, 1.45, .38), "team", "torso", .08, (-.06, -.44, 0))
    # 胸前战术指示灯
    box("Chest status lamp", (3.85, 9.15, 5.32), (1.05, .36, .24), "lamp", "torso", .04, (-.06, .44, 0))

    # 高耸重甲领圈（稳固托起封闭头盔，强化重甲步兵标志性壮硕肩颈！）
    def gorget(u, v, high):
        ang = (u - .5) * 4.8 + math.pi
        y = 10.65 + v * 2.15
        rx = 4.65 - .35 * v
        rz = 4.05 - .25 * v
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, .15 + nz * rz), (nx, .18, nz)
    curved_shell("Armored collar gorget", gorget, 18, 4, 34, 8, .58, "armorMid", "torso", bevel=.06)

    # 后背重甲壳
    def back_cuirass(u, v, high):
        ang = math.pi + (u - .5) * 1.95
        y = 3.2 + v * 8.2
        rx = 5.4 + 1.15 * math.sin(v * math.pi * .78)
        rz = 3.9 + .55 * math.sin(v * math.pi)
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * rx, y, -.10 + nz * rz), (nx, 0.0, nz)
    curved_shell("Back cuirass", back_cuirass, 10, 6, 20, 12, .65, "armorMid", "torso", bevel=.06)

    # 工业联邦紧凑动力装甲背包：钢灰机匣 + 双侧陶瓷装甲罩 + 金属散热口 + 蓝青能量条 + 左肩通讯天线
    box("Power pack core", (0.0, 6.95, -5.35), (8.2, 8.85, 3.25), "armorMid", "torso", .42)
    box("Power pack upper hood", (0.0, 10.55, -5.05), (7.6, 2.35, 3.05), "ceramic", "torso", .36, (.18, 0, 0))
    for s in (-1, 1):
        box(f"Pack side pod {s}", (s * 4.45, 7.15, -5.65), (2.25, 7.65, 2.65), "ceramic", "torso", .32)
        cylinder(f"Pack exhaust {s}", (s * 2.65, 3.05, -5.75), (s * 2.65, 1.55, -6.25), 1.05, "steel", "torso", .10, 16)
        cylinder(f"Pack exhaust bore {s}", (s * 2.65, 1.85, -6.15), (s * 2.65, 1.48, -6.28), .68, "recess", "torso", .03, 14)
        box(f"Pack rib {s}", (s * 4.95, 7.20, -5.65), (1.35, 1.15, 1.85), "armorDark", "torso", .12)
    box("Pack reactor recess", (0.0, 6.85, -6.98), (2.65, 4.15, .42), "armorDark", "torso", .10)
    box("Pack reactor lamp", (0.0, 6.95, -7.12), (1.45, 2.85, .24), "lamp", "torso", .05)
    cylinder("Comms antenna base", (-3.85, 11.45, -4.65), (-3.95, 12.75, -4.75), .45, "armorDark", "torso", .06, 12)
    cylinder("Comms antenna mast", (-3.95, 12.65, -4.75), (-4.25, 17.65, -5.15), .13, "steel", "torso", .02, 10)

    # 3. 头部：工业联邦重甲全封闭突击头盔（head 原点 y=35.95, z=1.0）
    # 颈部密封圈位于刚性领圈内部，刚性绑定至 torso，使全套重甲步兵 100% 满足刚性骨骼 TLAS 实时光追！
    anatomical_loft("Neck seal", [
        (11.45, 0.0,  .65, 2.38, 2.38, 2.32, 2.25),
        (13.35, 0.0,  .88, 2.25, 2.25, 2.25, 2.20),
    ], "torso", "undersuit", wrinkle_amp=.010)

    def helmet_shape(a, t, high):
        sa = math.sin(a)
        # 前额微突出护目眉檐，两侧微收俐落
        brow = .10 * max(0.0, sa) ** 2 * math.exp(-((t - .62) / .18) ** 2)
        return 1.0 + brow

    anatomical_loft("Heavy trooper helmet", [
        (-1.65, 0.0,  .32, 2.85, 2.85, 3.55, 2.75),
        (-.15,  0.0,  .22, 3.85, 3.85, 4.10, 3.72),
        (1.55,  0.0,  .06, 4.25, 4.25, 4.30, 4.28),
        (3.25,  0.0, -.10, 3.88, 3.88, 3.92, 4.02),
        (4.55,  0.0, -.18, 2.55, 2.55, 2.65, 2.82),
    ], "head", "ceramic", wrinkle_amp=0.0, shape_fn=helmet_shape)

    # 头盔中脊装甲棱 + 饱满弧面阵营色顶冠识别条（清晰突出于头顶弧面，俯视角辨识极佳）
    def helmet_crest(u, v, high):
        w = (u - .5) * 1.65
        ang = -.55 + v * 1.45
        r = 4.42 + .18 * math.sin(v * math.pi)
        return (w, .95 + math.cos(ang) * r * .88, -.05 + math.sin(ang) * r * .92), (0.0, math.cos(ang), math.sin(ang))
    curved_shell("Helmet central crest", helmet_crest, 6, 8, 12, 16, .48, "armorMid", "head", bevel=.06)
    def helmet_team_crest(u, v, high):
        w = (u - .5) * 1.05
        ang = -.42 + v * 1.15
        r = 4.70 + .12 * math.sin(v * math.pi)
        return (w, .95 + math.cos(ang) * r * .88, -.05 + math.sin(ang) * r * .92), (0.0, math.cos(ang), math.sin(ang))
    curved_shell("Helmet team stripe", helmet_team_crest, 4, 8, 10, 14, .20, "team", "head", bevel=.03)

    # 标志性深色宽幅弧面战术护目面罩（与 HUD 头像呼应）
    def visor_shell(u, v, high):
        ang = (u - .5) * 1.82
        y = .25 + v * 1.92
        r = 4.28 + .16 * math.sin(v * math.pi)
        return (math.sin(ang) * r, y, .20 + math.cos(ang) * r), (math.sin(ang), .04, math.cos(ang))
    curved_shell("Ballistic visor", visor_shell, 12, 5, 24, 10, .38, "visor", "head", bevel=.04)

    # 重型眉檐护框 + 呼吸器下颌面甲
    def brow_guard(u, v, high):
        ang = (u - .5) * 1.98
        y = 2.05 + v * .88
        r = 4.45 + .18 * (1.0 - v)
        return (math.sin(ang) * r, y, .22 + math.cos(ang) * r), (math.sin(ang), .25, math.cos(ang))
    curved_shell("Helmet brow visor hood", brow_guard, 12, 4, 24, 8, .42, "ceramicHi", "head", bevel=.05)
    box("Helmet jaw respirator", (0.0, -.85, 3.75), (4.15, 1.85, 1.45), "armorMid", "head", .28, (.16, 0, 0))
    box("Respirator center grille", (0.0, -1.05, 4.42), (2.25, 1.15, .36), "armorDark", "head", .08, (.16, 0, 0))
    for s in (-1, 1):
        box(f"Cheek armor plate {s}", (s * 2.95, -.55, 2.75), (1.75, 1.95, 2.15), "ceramic", "head", .22,
            (0, s * .65, 0))
        cylinder(f"Helmet ear pod {s}", (s * 3.85, .85, -.12), (s * 4.55, .85, -.12), 1.18, "armorMid", "head", .14, 18)
        cylinder(f"Ear pod cap {s}", (s * 4.48, .85, -.12), (s * 4.68, .85, -.12), .68, "armorDark", "head", .06, 14)
    # 左侧头盔战术激光指示灯
    box("Helmet tactical lamp housing", (-3.85, 1.65, 1.35), (1.05, .92, 1.75), "armorDark", "head", .14)
    box("Helmet tactical lamp", (-3.85, 1.65, 2.25), (.68, .52, .22), "lamp", "head", .05)
    box("Visor HUD glint", (-1.65, 1.28, 4.30), (.95, .32, .22), "lamp", "head", .04, (0, -.32, 0))

    # 4. 双腿与双臂（左右对称）
    for side, s in (("L", -1), ("R", 1)):
        thigh, knee, foot = side + "Leg", side + "Knee", side + "Foot"
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"

        # 强壮自然内收力线大腿 + 陶瓷重甲腿甲片
        tx_top, tx_mid, tx_kne = -s * .78, -s * .52, -s * .38
        anatomical_loft(f"{side} Thigh undersuit", [
            (-8.35, tx_kne, .05, 1.85, 1.85, 1.95, 1.82),
            (-6.2,  tx_kne, .12, 2.15, 2.05, 2.25, 2.05),
            (-3.6,  tx_mid, .12, (2.68 if s > 0 else 2.28), (2.28 if s > 0 else 2.68), 2.68, 2.48),
            (-1.2,  tx_top, -.02, (2.82 if s > 0 else 2.42), (2.42 if s > 0 else 2.82), 2.75, 2.72),
            (.55,   tx_top, -.06, 2.55, 2.55, 2.55, 2.58),
        ], thigh, "undersuit", phase=s, wrinkle_amp=.012)

        def thigh_cuisse(u, v, high, cx=tx_mid, ss=s):
            ang = (u - .5) * 2.25 + ss * .32
            y = -6.85 + v * 5.65
            bulge = .24 * math.sin(v * math.pi)
            r = 2.62 + bulge + .18 * v
            nx, nz = math.sin(ang), math.cos(ang)
            return (cx + nx * r, y, .14 + nz * r), (nx, 0.0, nz)
        curved_shell(f"{side} Ceramic thigh cuisse", thigh_cuisse, 10, 5, 20, 10, .58, "ceramic", thigh, bevel=.06)
        box(f"{side} Thigh side plate", (tx_mid + s * 2.68, -3.75, -.15), (.92, 4.15, 2.65), "armorMid", thigh, .18)

        # 小腿基底 + 重甲弧面护膝 + 锥形陶瓷胫甲（greave）
        anatomical_loft(f"{side} Shin undersuit", [
            (-7.35, -s * .32, -.08, 1.52, 1.52, 1.62, 1.56),
            (-5.0,  -s * .34, -.16, 1.78, 1.78, 1.78, 2.05),
            (-2.4,  -s * .38, -.18, 1.98, 1.98, 1.90, 2.26),
            (-.4,   -s * .38,  .00, 1.90, 1.90, 2.02, 1.92),
            (.65,   -s * .38,  .06, 1.86, 1.86, 1.96, 1.84),
        ], knee, "undersuit", phase=-s, wrinkle_amp=.010)

        def knee_cop(u, v, high, cx=-s * .38):
            ang = (u - .5) * 2.05
            y = -1.95 + v * 2.95
            r = 2.18 + .42 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (cx + nx * r, y, .26 + nz * r), (nx, .12 * (v - .5), nz)
        curved_shell(f"{side} Ceramic knee guard", knee_cop, 10, 5, 20, 10, .52, "ceramicHi", knee, bevel=.06)

        def knee_cap_center(u, v, high, cx=-s * .38):
            ang = (u - .5) * 1.15
            y = -1.15 + v * 1.45
            r = 2.68 + .18 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (cx + nx * r, y, .32 + nz * r), (nx, 0.0, nz)
        curved_shell(f"{side} Knee cap plate", knee_cap_center, 8, 4, 16, 8, .26, "armorMid", knee, bevel=.04)

        def shin_greave(u, v, high, cx=-s * .34):
            ang = (u - .5) * 2.35
            y = -7.05 + v * 5.05
            r = 1.96 + .32 * v + .16 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (cx + nx * r, y, .12 + nz * r), (nx, 0.0, nz)
        curved_shell(f"{side} Ceramic shin greave", shin_greave, 12, 6, 22, 12, .56, "ceramic", knee, bevel=.06)
        box(f"{side} Calf armor fin", (-s * .34 + s * 1.95, -4.65, -.85), (.85, 3.65, 1.55), "armorMid", knee, .16)

        # 重甲战靴
        build_armored_boot(side, s, foot)

        # 上臂（arm 长度 7.2，精确对齐 IK 关节！）
        anatomical_loft(f"{side} Upper arm undersuit", [
            (-7.05, 0.0, .00, 1.48, 1.48, 1.52, 1.52),
            (-4.8,  0.0, .04, 1.68, 1.64, 1.74, 1.70),
            (-2.2, -s * .10, .04, 1.96, 1.88, 2.02, 1.96),
            (.4,   -s * .32, .00, 1.82, 1.82, 1.86, 1.86),
        ], arm, "undersuit", phase=s, wrinkle_amp=.010)

        # 标志性工业联邦双层厚圆弧重甲护肩（挂载于 torso 肩部穹顶，举枪/托枪时始终端正稳固绝不翻转露底！）
        sh_x = s * 6.8
        sh_y = 9.5
        def pauldron_main(u, v, high, ss=s, sx=sh_x, sy=sh_y):
            phi = (u - .5) * 2.35
            theta = -.18 + v * 1.58
            r = 3.05 + .22 * math.sin(v * math.pi)
            ox, oy = sx - ss * .45, sy - .50
            return (ox + ss * math.sin(theta) * r, oy + math.cos(theta) * r, math.sin(phi) * r * .96), \
                   (ss * math.sin(theta), math.cos(theta), math.sin(phi) * .72)
        curved_shell(f"{side} Heavy ceramic pauldron", pauldron_main, 12, 6, 24, 12, .68, "ceramic", "torso", bevel=.07)

        # 护肩下沿钢灰装甲裙边
        def pauldron_rim(u, v, high, ss=s, sx=sh_x, sy=sh_y):
            phi = (u - .5) * 2.25
            theta = 1.24 + v * .44
            r = 3.16
            ox, oy = sx - ss * .38, sy - .54
            return (ox + ss * math.sin(theta) * r, oy + math.cos(theta) * r, math.sin(phi) * r * .94), \
                   (ss * math.sin(theta), math.cos(theta), math.sin(phi) * .72)
        curved_shell(f"{side} Pauldron trim rim", pauldron_rim, 12, 3, 22, 6, .48, "armorMid", "torso", bevel=.05)

        # 护肩外侧醒目阵营色识别带（slot=1，双肩皆有，俯视角与特写均极清晰！）
        def pauldron_team(u, v, high, ss=s, sx=sh_x, sy=sh_y):
            phi = (u - .5) * 1.40
            theta = .56 + v * .52
            r = 3.52
            ox, oy = sx - ss * .42, sy - .50
            return (ox + ss * math.sin(theta) * r, oy + math.cos(theta) * r, math.sin(phi) * r * .92), \
                   (ss * math.sin(theta), math.cos(theta), math.sin(phi) * .72)
        curved_shell(f"{side} Pauldron team stripe", pauldron_team, 10, 4, 18, 8, .22, "team", "torso", bevel=.03)

        # 上臂外侧陶瓷护板
        def bicep_plate(u, v, high, ss=s):
            ang = ss * (1.25 + (u - .5) * 1.55)
            y = -5.75 + v * 2.65
            r = 1.78
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * r, y, nz * r), (nx, 0.0, nz)
        curved_shell(f"{side} Bicep guard", bicep_plate, 8, 4, 16, 8, .42, "ceramic", arm, bevel=.04)

        # 前臂基底（elbow 长度 6.2，精确对齐 IK 关节！）+ 重甲臂铠（vambrace）
        anatomical_loft(f"{side} Forearm undersuit", [
            (-5.95, 0.0, .02, 1.15, 1.15, 1.22, 1.18),
            (-3.8,  0.0, .08, 1.38, 1.38, 1.46, 1.40),
            (-1.2,  0.0, .10, 1.56, 1.56, 1.62, 1.56),
            (.55,   0.0, .00, 1.48, 1.48, 1.52, 1.52),
        ], elbow, "undersuit", phase=-s, wrinkle_amp=.010)

        def vambrace(u, v, high):
            ang = (u - .5) * 4.4 + math.pi * .5 * s
            y = -5.45 + v * 4.45
            r = 1.36 + .32 * v
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * r, y, .08 + nz * r), (nx, 0.0, nz)
        curved_shell(f"{side} Ceramic vambrace", vambrace, 12, 5, 22, 10, .48, "ceramic", elbow, bevel=.05)

        def elbow_cop(u, v, high):
            ang = math.pi + (u - .5) * 1.75
            y = -1.45 + v * 2.15
            r = 1.68 + .25 * math.sin(v * math.pi)
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * r, y, nz * r), (nx, 0.0, nz)
        curved_shell(f"{side} Armored elbow cop", elbow_cop, 8, 4, 16, 8, .38, "armorMid", elbow, bevel=.05)
        box(f"{side} Wrist cuff", (0.0, -5.55, .12), (2.85, .82, 2.95), "armorMid", elbow, .16)

        # 战术重甲手套（精确对齐枪握把与托枪护木，同狙击手 IK 坐标系）
        if side == "R":
            box("R Armored gauntlet back", (.92, -1.25, .42), (.78, 1.95, 1.42), "ceramic", hand, .22)
            box("R Gauntlet palm", (.62, -1.30, .45), (.55, 1.75, 1.20), "glove", hand, .18)
            for y in (-1.22, -1.76, -2.26):
                cable(f"R Curled finger {y}", [(.96, y, .60), (.78, y, 1.32), (.14, y, 1.48), (-.66, y, .92)],
                      .19, "glove", hand)
            cable("R Trigger index", [(.92, -.60, .68), (.98, -.46, 1.80), (.52, -.54, 2.85), (.08, -.72, 2.82)],
                  .17, "glove", hand)
            cable("R Grip thumb", [(.72, -.62, -.12), (.30, -.30, -.12), (-.70, -.46, .24)], .23, "glove", hand)
        else:
            box("L Armored gauntlet back", (0.0, -1.05, -.15), (1.85, 1.95, .62), "ceramic", hand, .22)
            box("L Support palm", (0.0, -1.05, .28), (1.68, 1.85, .74), "glove", hand, .22)
            for y in (-1.68, -1.20, -.72, -.24):
                cable(f"L Support finger {y}", [(-.68, y, .42), (-.84, y, .86), (-.42, y, 1.18), (.14, y, 1.12)],
                      .18, "glove", hand)
            cable("L Support thumb", [(.64, -.48, .30), (.82, -.95, .68), (.68, -1.52, .98)], .23, "glove", hand)

    log("TROOPER / heavy ceramic power armor, enclosed visor helmet, twin pauldrons, backpack & gloves")


def build_pulse_rifle():
    """工业联邦重型脉冲突击步枪（绑定于 rifle 骨骼，握把对齐 RHand，护木对齐 rifleSupport）。"""
    start = len(pieces)

    # 1. 厚实工业联邦主枪身机匣 + 白色陶瓷侧护片（与重甲步兵视觉一体化）
    extrusion("Rifle lower receiver", [(-2.6, .15), (-2.3, 1.55), (5.2, 1.55), (5.5, .55),
              (3.8, .10), (.6, .10), (-.2, -.25), (-1.4, -.25)], 0.0, 1.85, "gunDark", radius=.10)
    extrusion("Rifle upper shroud", [(-2.8, 1.45), (-2.4, 2.75), (8.8, 2.65), (9.4, 1.75),
              (8.6, 1.25), (-2.5, 1.35)], 0.0, 2.05, "gun", radius=.12)
    for s in (-1, 1):
        # 陶瓷白重甲侧护板，俯视角下步枪轮廓极其鲜明
        box(f"Rifle ceramic side shroud {s}", (s * 1.06, 2.05, 3.25), (.30, 1.12, 8.85), "ceramic", "rifle", .08)
        box(f"Rifle shroud accent {s}", (s * 1.18, 2.05, 6.25), (.14, .45, 2.85), "armorMid", "rifle", .04)
    # 右侧抛壳窗与拉机柄
    box("Ejection port recess", (.98, 2.05, 1.25), (.18, .65, 2.35), "recess", "rifle", .04)
    box("Bolt carrier", (.92, 2.05, 1.25), (.12, .52, 2.10), "steel", "rifle", .03)
    cylinder("Charging handle", (.85, 2.35, 3.65), (1.75, 2.35, 3.65), .20, "steel", "rifle", .04, 12)

    # 2. 实体抵肩重型枪托（抵住右胸肩窝，结构厚实不单薄）
    extrusion("Heavy buttstock", [(-6.1, -.65), (-6.1, 2.25), (-2.5, 2.35), (-2.5, .45),
              (-4.8, -.45)], 0.0, 1.55, "gunDark", radius=.14)
    box("Stock cheek rest", (0.0, 2.48, -4.35), (1.68, .55, 2.75), "ceramic", "rifle", .14)
    box("Stock rubber buttpad", (0.0, .80, -6.28), (1.62, 3.15, .48), "rubber", "rifle", .14)

    # 3. 握把、护圈、扳机（平移 +2 后正中 RHand 握持点！）
    extrusion("Pistol grip", [(-1.85, .28), (-.45, .15), (-.62, -2.55), (-1.72, -2.95), (-2.22, -2.25)],
              0.0, 1.28, "rubber", radius=.14)
    cable("Trigger guard", [(-.60, -.25, -.05), (-.60, -1.68, .40), (-.60, -1.72, 1.95), (-.60, -.10, 2.25)],
          .14, "gunDark", "rifle")
    cable("Trigger blade", [(0.0, .05, .75), (0.0, -.72, .88), (0.0, -1.02, .66)], .10, "steel", "rifle")

    # 4. 弧形重型脉冲弹匣
    extrusion("Pulse box magazine", [(1.75, .18), (3.85, .18), (4.45, -3.15), (2.45, -3.45)],
              0.0, 1.42, "armorDark", radius=.12)
    box("Magazine floorplate", (0.0, -3.42, 3.45), (1.58, .48, 2.22), "steel", "rifle", .08, (.16, 0, 0))
    for s in (-1, 1):
        for z in (2.4, 3.3):
            box(f"Mag rib {s} {z}", (s * .74, -1.55, z), (.08, 2.35, .18), "gun", "rifle", .03, (.18, 0, 0))

    # 5. 护木与左手托持区（平移 +2 后位于 z=+5.4 ~ +9.4，完美契合 LHand！）
    box("Handguard lower cradle", (0.0, .62, 6.25), (1.92, .95, 6.65), "gunDark", "rifle", .14)
    box("Handguard grip block", (0.0, .18, 4.15), (1.52, .72, 2.85), "rubber", "rifle", .16)
    for z in (4.5, 5.7, 6.9, 8.1):
        for s in (-1, 1):
            box(f"Handguard cooling slot {s} {z}", (s * 1.02, 1.32, z), (.16, .48, .55), "recess", "rifle", .03)
    # 枪管下挂紧凑型战术电筒／导气室
    cylinder("Underbarrel gas block", (0.0, .82, 9.2), (0.0, .82, 11.4), .46, "armorMid", "rifle", .06, 14)

    # 6. 实心通孔重型枪管 + 双腔战术制退器
    cylinder("Barrel collar", (0.0, 1.85, 8.8), (0.0, 1.85, 9.8), .66, "steel", "rifle", .06, 18)
    tube("Heavy pulse barrel", (0.0, 1.85, 0.0), [(9.6, .46, .22), (12.4, .42, .22)], "steel", "rifle")
    tube("Muzzle brake bore", (0.0, 1.85, 0.0), [(12.3, .36, .22), (14.4, .36, .22)], "gunDark", "rifle")
    for y in (1.35, 2.35):
        box(f"Muzzle brake bar {y}", (0.0, y, 13.45), (1.15, .20, 2.15), "gun", "rifle", .04)
    for z in (12.55, 13.45, 14.35):
        for s in (-1, 1):
            box(f"Muzzle port bridge {s} {z}", (s * .55, 1.85, z), (.18, 1.08, .22), "gun", "rifle", .04)
    tube("Muzzle front crown", (0.0, 1.85, 14.4), [(0.0, .58, .23), (.22, .58, .23)], "steel", "rifle")

    # 7. 顶部皮卡汀尼导轨 + 科幻全息瞄具 + 发光弹药计数器（slot=2）
    box("Top rail base", (0.0, 2.86, 2.45), (1.42, .26, 10.6), "gunDark", "rifle", .04)
    for z in np.arange(-2.2, 7.6, .62):
        box(f"Rail tooth {z:.1f}", (0.0, 3.04, float(z)), (1.36, .18, .28), "gun", "rifle", .03)
    # 紧凑科幻全息瞄具
    box("Holo optic base", (0.0, 3.35, 1.45), (1.68, .55, 3.65), "gunDark", "rifle", .08)
    for s in (-1, 1):
        box(f"Holo hood wall {s}", (s * .76, 4.12, 1.45), (.28, 1.25, 3.25), "armorMid", "rifle", .08)
    box("Holo hood roof", (0.0, 4.72, 1.45), (1.76, .28, 3.25), "ceramic", "rifle", .08)
    box("Holo front lens", (0.0, 4.12, 2.72), (1.22, .95, .14), "lens", "rifle", .03)
    box("Holo rear lens", (0.0, 4.12, .18), (1.22, .95, .14), "lens", "rifle", .03)
    # 机匣后上方／侧面发光脉冲弹药指示条
    box("Ammo counter glow", (0.0, 3.12, -1.95), (.92, .42, .45), "lamp", "rifle", .05)
    box("Side laser emitter", (-1.18, 1.38, 7.45), (.38, .48, 1.65), "gunDark", "rifle", .06)
    box("Side laser lens", (-1.18, 1.38, 8.32), (.26, .26, .12), "lamp", "rifle", .03)

    # 对齐握把与 RHand 原点（与 build-sniper-hero.py 一致）
    for low, high in pieces[start:]:
        for obj in (low, high):
            obj.data.transform(Matrix.Translation(point((0, 0, 2.0))))
            a = obj.data.attributes["_installCoord"]
            for v in obj.data.vertices:
                a.data[v.index].vector = v.co

    log("RIFLE / heavy industrial pulse carbine, ceramic shroud, vented muzzle brake & holo optic")


def join(objects, name):
    select(objects)
    bpy.ops.object.join()
    bpy.context.object.name = name
    return bpy.context.object


def image(channel):
    img = bpy.data.images.new("Rifleman bake " + channel, args.resolution, args.resolution, alpha=False)
    img.generated_color = (.5, .5, 1, 1) if channel == "normal" else (1, 1, 1, 1)
    if channel != "albedo":
        img.colorspace_settings.name = "Non-Color"
    return img


def pixels(img):
    data = np.empty(args.resolution ** 2 * 4, dtype=np.float32)
    img.pixels.foreach_get(data)
    return data.reshape(args.resolution, args.resolution, 4)


def bake(low, high, channel, target, projected=True):
    select([high, low] if projected else [low], low)
    saved = []
    for mat in set(low.data.materials) | set(high.data.materials):
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf, output, emit = nodes.get("Principled BSDF"), nodes.get("Material Output"), nodes["Bake emission"]
        saved.append((mat, output.inputs["Surface"].links[0].from_socket))
        nodes["Bake target"].image = target
        nodes.active = nodes["Bake target"]
        for link in list(emit.inputs["Color"].links):
            links.remove(link)
        if channel == "albedo":
            links.new(bsdf.inputs["Base Color"].links[0].from_socket, emit.inputs["Color"])
        elif channel in {"roughness", "metalness"}:
            socket = bsdf.inputs["Roughness" if channel == "roughness" else "Metallic"]
            if socket.is_linked:
                links.new(socket.links[0].from_socket, emit.inputs["Color"])
            else:
                emit.inputs["Color"].default_value = (socket.default_value,) * 3 + (1,)
        links.new(bsdf.outputs[0] if channel in {"normal", "ao"} else emit.outputs[0], output.inputs["Surface"])
    scene.render.bake.use_selected_to_active = projected
    scene.render.bake.use_cage = False
    scene.render.bake.use_clear = True
    try:
        bpy.ops.object.bake(type={"normal": "NORMAL", "ao": "AO"}.get(channel, "EMIT"), normal_space="TANGENT")
        return pixels(target)
    finally:
        for mat, socket in saved:
            mat.node_tree.links.new(socket, mat.node_tree.nodes.get("Material Output").inputs["Surface"])


def coverage(low):
    target = image("coverage")
    select([low])
    saved = []
    margin = scene.render.bake.margin
    scene.render.bake.margin = 0
    scene.render.bake.use_selected_to_active = False
    for mat in set(low.data.materials):
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        output = nodes.get("Material Output")
        saved.append((mat, output.inputs["Surface"].links[0].from_socket))
        emit = nodes["Bake emission"]
        for link in list(emit.inputs["Color"].links):
            links.remove(link)
        emit.inputs["Color"].default_value = (1, 1, 1, 1)
        links.new(emit.outputs[0], output.inputs["Surface"])
        nodes["Bake target"].image = target
        nodes.active = nodes["Bake target"]
    bpy.ops.object.bake(type="EMIT")
    mask = pixels(target)[:, :, 0] > .999
    for mat, socket in saved:
        mat.node_tree.links.new(socket, mat.node_tree.nodes.get("Material Output").inputs["Surface"])
    scene.render.bake.margin = margin
    bpy.data.images.remove(target)
    return mask


def baked_material(images, slot):
    mat = bpy.data.materials.new("GAME PBR / " + str(slot))
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    for channel in ("albedo", "normal", "orm"):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = images[channel]
        if channel == "albedo":
            links.new(texture.outputs[0], bsdf.inputs["Base Color"])
        elif channel == "normal":
            normal = nodes.new("ShaderNodeNormalMap")
            links.new(texture.outputs[0], normal.inputs[1])
            links.new(normal.outputs[0], bsdf.inputs["Normal"])
        else:
            split = nodes.new("ShaderNodeSeparateColor")
            links.new(texture.outputs[0], split.inputs[0])
            links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
            links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
    if slot == 2:
        bsdf.inputs["Emission Color"].default_value = (.10, .42, .48, 1)
        bsdf.inputs["Emission Strength"].default_value = .55
    return mat


def render(objects, name, view=(1.35, -1.8, 1.0), resolution=1024):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(v) for o in objects for v in o.bound_box]
    lo = Vector(tuple(min(v[i] for v in pts) for i in range(3)))
    hi = Vector(tuple(max(v[i] for v in pts) for i in range(3)))
    center = (lo + hi) / 2
    extent = max(hi - lo)
    bpy.ops.object.camera_add(location=center + Vector(view) * extent)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = extent * 1.18
    scene.camera = camera
    lights = []
    for offset, power, color in [((-1, -1.5, 2), 1200, (1, .90, .78)), ((1, .7, 1.6), 950, (.64, .82, 1)),
                                 ((1.8, -.7, .8), 380, (1, .96, .89))]:
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * extent)
        light = bpy.context.object
        light.data.energy = power * extent ** 2 / 10
        light.data.shape = "DISK"
        light.data.size = extent * 1.15
        light.data.color = color
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        lights.append(light)
    scene.render.resolution_x = scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.cycles.samples = 48
    scene.render.filepath = str(directory / (name + ".png"))
    bpy.ops.render.render(write_still=True)
    for obj in [camera, *lights]:
        bpy.data.objects.remove(obj, do_unlink=True)
    scene.cycles.samples = 16


def run():
    started = time.time()
    build_trooper()
    build_pulse_rifle()
    lows = [p[0] for p in pieces]
    highs = [p[1] for p in pieces]
    if args.preview_only:
        for obj in highs:
            obj.hide_render = True
        render(lows, "form-preview")
        return

    # 沿 X 轴分离各组件避免互投射，完成 2K 高低模 PBR 烘焙后再复位。
    for i, (low, high) in enumerate(pieces):
        offset = Vector((i * 100, 0, 0))
        for obj in (low, high):
            attr(obj.data, "_bakeOffset", list(offset) * len(obj.data.vertices))
            obj.data.transform(Matrix.Translation(offset))
        mat = low.data.materials[0].copy()
        mat["slot"] = low["slot"]
        low.data.materials[0] = mat

    low = join(lows, "Rifleman · UV LOW")
    high = join(highs, "Rifleman · HIGH / editable detail")
    select([low])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.20, island_margin=.0002, area_weight=1, scale_to_bounds=True)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=.0015, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")

    targets = {channel: image(channel) for channel in ("albedo", "normal", "ao", "roughness", "metalness")}
    scene.render.bake.cage_extrusion = .22
    scene.render.bake.max_ray_distance = .70
    mask = coverage(low)
    results = {}
    for channel in ("albedo", "normal", "roughness", "metalness"):
        log("BAKE / " + channel)
        results[channel] = bake(low, high, channel, targets[channel])

    normals = results["normal"]
    length = np.linalg.norm(normals[:, :, :3] * 2 - 1, axis=2)
    backfacing = normals[:, :, 2] < .5
    invalid_normal = (length < .05) | (length > 1.25) | backfacing
    invalid_material = (np.max(results["albedo"][:, :, :3], axis=2) < 1e-6) | (results["roughness"][:, :, 0] < .01)
    invalid = invalid_normal | invalid_material
    missed = int(np.count_nonzero(mask & invalid))
    covered = int(np.count_nonzero(mask))
    if covered == 0 or missed / covered > .05:
        raise ValueError(f"Insufficient high-to-low coverage: {missed}/{covered}")

    for obj in (low, high):
        offsets = obj.data.attributes["_bakeOffset"]
        for vertex in obj.data.vertices:
            vertex.co -= offsets.data[vertex.index].vector

    log("BAKE / assembled AO")
    results["ao"] = bake(low, high, "ao", targets["ao"])
    if missed:
        high.hide_render = True
        for channel in results:
            fallback = bake(low, high, channel, targets[channel], False)
            results[channel][invalid] = fallback[invalid]

    normals = results["normal"]
    length = np.linalg.norm(normals[:, :, :3] * 2 - 1, axis=2)
    neutral = (length < .05) | (length > 1.25) | (normals[:, :, 2] < .5)
    neutral_count = int(np.count_nonzero(mask & neutral))
    if neutral_count > missed:
        raise ValueError("Fallback normal quality regressed")
    normals[neutral] = (.5, .5, 1, 1)

    orm = np.ones_like(normals)
    for index, channel in enumerate(("ao", "roughness", "metalness")):
        orm[:, :, index] = results[channel][:, :, 0]

    images = {}
    for channel, data in {"albedo": results["albedo"], "normal": normals, "orm": orm}.items():
        img = targets.get(channel) or image(channel)
        img.pixels.foreach_set(data.ravel())
        img.filepath_raw = str(directory / ("rifleman-" + channel + ".png"))
        img.file_format = "PNG"
        img.save()
        img.pack()
        images[channel] = img

    low_count, high_count = len(low.data.polygons), len(high.data.polygons)
    objects = []
    for slot in range(3):
        if not any(low.data.materials[f.material_index]["slot"] == slot for f in low.data.polygons):
            continue
        obj = low.copy()
        obj.data = low.data.copy()
        low_collection.objects.link(obj)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if obj.data.materials[f.material_index]["slot"] != slot],
                         context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        for name in ("_installCoord", "_bakeOffset"):
            obj.data.attributes.remove(obj.data.attributes[name])
        obj.data.materials.clear()
        obj.data.materials.append(baked_material(images, slot))
        for face in obj.data.polygons:
            face.material_index = 0
        obj.name = f"{KEY}|-1|{slot}"
        for k in list(obj.keys()):
            del obj[k]
        obj["key"] = KEY
        obj["part"] = -1
        obj["slot"] = slot
        objects.append(obj)

    bpy.data.objects.remove(low, do_unlink=True)
    high.hide_render = True
    high.hide_set(True)

    select(objects)
    bpy.ops.export_scene.gltf(
        filepath=str(directory / "rifleman.glb"),
        export_format="GLB",
        use_selection=True,
        export_attributes=True,
        export_extras=True,
        export_materials="NONE",
        export_vertex_color="NONE",
        export_cameras=False,
        export_lights=False,
        export_meshopt_compression_enable=True,
        export_meshopt_extension="EXT_meshopt_compression",
    )

    pts = [v.co for obj in objects for v in obj.data.vertices]
    template["bounds"] = [
        [min(v.x for v in pts), min(v.z for v in pts), min(-v.y for v in pts)],
        [max(v.x for v in pts), max(v.z for v in pts), max(-v.y for v in pts)],
    ]
    template["surface"] = "rifleman"
    report = {
        "key": KEY,
        "generator": "scripts/build-rifleman.py",
        "scriptHash": script_hash,
        "tile": [0, 0],
        "tileSize": args.resolution,
        "lowFaces": low_count,
        "highFaces": high_count,
        "assemblies": len(pieces),
        "template": template,
        "textureSources": sources_for(high.data.materials),
        "rifle": {
            "length": 20.9,
            "barrelAxisY": 1.85,
            "gripForwardOffset": 2.0,
            "joint": "rifle",
            "features": [
                "ceramic side shroud", "open bore", "vented muzzle brake",
                "trigger guard", "curved pulse magazine", "ventilated handguard",
                "solid stock", "holographic optic", "ammo counter glow",
            ],
        },
        "projection": {
            "cageExtrusion": .22,
            "maxRayDistance": .70,
            "uvPixels": covered,
            "missedNormalPixels": int(np.count_nonzero(mask & invalid_normal)),
            "backfacingNormalPixels": int(np.count_nonzero(mask & backfacing)),
            "missedMaterialPixels": int(np.count_nonzero(mask & invalid_material)),
            "missedProjectionPixels": missed,
            "lowSurfaceFallbackPixels": missed,
            "neutralNormalPixels": neutral_count,
        },
    }
    (directory / "rifleman-bake.json").write_text(json.dumps([report], indent=2) + "\n")
    log(f"BAKE READY / low={low_count} high={high_count} coverage={1 - missed / covered:.3%}")

    armature = bpy.data.armatures.new("Rifleman / game bone contract")
    rig = bpy.data.objects.new("Rifleman / EDITABLE RIG", armature)
    scene.collection.objects.link(rig)
    select([rig])
    bpy.ops.object.mode_set(mode="EDIT")
    bones = []
    for joint in joints:
        bone = armature.edit_bones.new(joint["name"])
        bone.head = point(joint["origin"])
        bone.tail = bone.head + Vector((0, 0, 1))
        if joint["parent"] >= 0:
            bone.parent = bones[joint["parent"]]
        bones.append(bone)
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in objects:
        obj.parent = rig
        indices = obj.data.attributes["_skinIndex"]
        weights = obj.data.attributes["_skinWeight"]
        for i, joint in enumerate(joints):
            group = obj.vertex_groups.new(name=joint["name"])
            for vertex in obj.data.vertices:
                w = sum(wt for idx, wt in zip(indices.data[vertex.index].color,
                        weights.data[vertex.index].color) if round(idx) == i)
                if w > 0:
                    group.add([vertex.index], w, "REPLACE")
        modifier = obj.modifiers.new("Game articulation", "ARMATURE")
        modifier.object = rig

    scene["rigContract"] = json.dumps(joints, separators=(",", ":"))
    scene["generator"] = script_hash
    scene["workflow"] = "Purpose-built heavy armored rifleman + pulse carbine / independent 2K UV / high-to-low PBR"
    select(objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(directory / "rifleman.blend"), compress=True)
    render(objects, "front", (1.35, -1.8, 1.0))
    render(objects, "side", (2.1, -0.35, 0.75))
    render(objects, "rear", (-1.35, 1.8, 1.0))
    log(f"COMPLETE / {time.time() - started:.1f}s")


run()
