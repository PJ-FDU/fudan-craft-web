"""独立人形/双足英雄资产共享雕刻与 Cycles 2K PBR 烘焙底座。

设计原则：
- 接入 scripts/material-library/ 无缝平光微底纹与战术贴花，通过 Triplanar(Box) / _decalUV 参与 Cycles 高低模烘焙；
- 强制 100% 单骨刚性蒙皮（单顶点权重 1.0），确保在图鉴播放动画时全程兼容 WebGPU 高清实时光追；
- 统一 2K 烘焙覆盖率校验（>=95%）、Meshopt GLB 导出、独立 .blend 可编辑工程与三视图预览渲染。
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

ROOT = Path(__file__).resolve().parent.parent
MATERIAL_DIR = ROOT / "scripts" / "material-library"

MATERIAL_FILES = {
    "ceramic":  "ceramic-armor-grain.png",
    "ripstop":  "tactical-nylon-ripstop.png",
    "canvas":   "desert-canvas-weave.png",
    "wool":     "wool-coat-weave.png",
    "gunmetal": "brushed-gunmetal-wear.png",
    "radar":    "tactical-radar-screen.png",
    "medic":    "decal-medic-emblem.png",
    "hazard":   "decal-hazard-stripe.png",
}


def parse_hero_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--resolution", type=int, default=2048)
    parser.add_argument("--device", choices=["CPU", "METAL"], default="METAL")
    parser.add_argument("--preview-only", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


def linear(v: float) -> float:
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def point(p) -> Vector:
    """游戏坐标系 (X 右, Y 上, Z 前) -> Blender 坐标系 (X 右, Y 后(-Z), Z 上(Y))。"""
    return Vector((p[0], -p[2], p[1]))


def attr(mesh, name: str, values, size: int = 3):
    kind, field = ("FLOAT_VECTOR", "vector") if size == 3 else ("FLOAT_COLOR", "color")
    mesh.attributes.new(name, kind, "POINT").data.foreach_set(field, values)


def select(objects, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


class HeroBuilder:
    def __init__(self, key: str, surface_name: str, script_path: Path, palette: dict,
                 args, label: str = "HERO", workflow: str = ""):
        self.key = key
        self.surface_name = surface_name
        self.script_path = Path(script_path).resolve()
        self.script_rel = str(self.script_path.relative_to(ROOT))
        self.script_hash = hashlib.sha256(self.script_path.read_bytes()).hexdigest()
        self.palette = palette
        self.args = args
        self.label = label
        self.workflow = workflow or f"Purpose-built {surface_name} / independent 2K UV / high-to-low PBR"
        self.directory = Path(args.output)
        self.directory.mkdir(parents=True, exist_ok=True)

        self.template = json.loads(Path(args.template).read_text())["templates"][key]
        self.joints = self.template["rig"]
        self.joint_ids = {joint["name"]: index for index, joint in enumerate(self.joints)}
        self.pieces = []
        self.loaded_textures = {}
        self.texture_sources = {}
        self.extra_report = {}

        scene = bpy.context.scene
        self.scene = scene
        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        for mat in list(bpy.data.materials):
            bpy.data.materials.remove(mat, do_unlink=True)
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

        self.low_collection = bpy.data.collections.new(f"01 · GAME LOW / {surface_name}")
        self.high_collection = bpy.data.collections.new(f"02 · HIGH / {surface_name}")
        scene.collection.children.link(self.low_collection)
        scene.collection.children.link(self.high_collection)

    def log(self, text: str):
        print(f"{self.label} {text}", flush=True)

    def load_library_texture(self, tex_key: str):
        if tex_key in self.loaded_textures:
            return self.loaded_textures[tex_key]
        filename = MATERIAL_FILES[tex_key]
        path = MATERIAL_DIR / filename
        if not path.exists():
            raise FileNotFoundError(f"Missing material library texture: {path}")
        img = bpy.data.images.load(str(path), check_existing=True)
        img.colorspace_settings.name = "sRGB"
        self.loaded_textures[tex_key] = img
        self.texture_sources[tex_key] = {
            "file": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
        return img

    def material(self, name: str):
        if name in bpy.data.materials:
            return bpy.data.materials[name]
        spec = self.palette[name]
        color, rough, metal, kind = spec[:4]
        tex_cfg = spec[4] if len(spec) > 4 else None

        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat["metalness"] = metal
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = nodes.get("Principled BSDF")
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough

        # 特殊材质：2D 平面战术雷达屏幕或纯 UV 贴花面（直接用 _decalUV 映射）
        if tex_cfg and tex_cfg.get("mode") == "uv_direct":
            img = self.load_library_texture(tex_cfg["tex"])
            uv_attr = nodes.new("ShaderNodeAttribute")
            uv_attr.attribute_name = "_decalUV"
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            tex.extension = "EXTEND" if tex_cfg.get("repeat") else "CLIP"
            if tex_cfg.get("repeat"):
                tex.extension = "REPEAT"
                mp = nodes.new("ShaderNodeMapping")
                sc = tex_cfg.get("scale", 1.0)
                mp.inputs["Scale"].default_value = (sc, sc, 1.0)
                links.new(uv_attr.outputs["Vector"], mp.inputs["Vector"])
                links.new(mp.outputs["Vector"], tex.inputs["Vector"])
            else:
                links.new(uv_attr.outputs["Vector"], tex.inputs["Vector"])

            if tex_cfg.get("alpha_over_base"):
                base = tuple(linear(c) for c in color)
                mix_ov = nodes.new("ShaderNodeMix")
                mix_ov.data_type = "RGBA"
                mix_ov.inputs["A"].default_value = (*base, 1.0)
                links.new(tex.outputs["Alpha"], mix_ov.inputs["Factor"])
                links.new(tex.outputs["Color"], mix_ov.inputs["B"])
                links.new(mix_ov.outputs["Result"], bsdf.inputs["Base Color"])
            else:
                links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

            emit = nodes.new("ShaderNodeEmission")
            emit.name = "Bake emission"
            target = nodes.new("ShaderNodeTexImage")
            target.name = "Bake target"
            return mat

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

        color_socket = tint.outputs["Result"]
        bump_socket = fine.outputs["Fac"]
        rough_driver = noise.outputs["Fac"]

        # 接入共享无缝平光微底纹（Box/Triplanar 投射，零 UV 接缝、零假光影）
        if tex_cfg and tex_cfg.get("tex"):
            img = self.load_library_texture(tex_cfg["tex"])
            mapping = nodes.new("ShaderNodeMapping")
            sc = tex_cfg.get("scale", 0.16)
            mapping.inputs["Scale"].default_value = (sc, sc, sc)
            links.new(coords.outputs["Vector"], mapping.inputs["Vector"])

            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            tex.projection = "BOX"
            tex.projection_blend = 0.24
            links.new(mapping.outputs["Vector"], tex.inputs["Vector"])

            # 用底纹明度均值归一化后以 Soft Light / Multiply 叠加，既保留完整阵营色相又注入真实织纹/刮痕细节
            tex_bw = nodes.new("ShaderNodeRGBToBW")
            links.new(tex.outputs["Color"], tex_bw.inputs["Color"])

            # 把底纹纹理做温和的明暗对比叠加到基色
            tex_contrast = nodes.new("ShaderNodeMapRange")
            tex_contrast.inputs["From Min"].default_value = tex_cfg.get("from_min", 0.15)
            tex_contrast.inputs["From Max"].default_value = tex_cfg.get("from_max", 0.85)
            tex_contrast.inputs["To Min"].default_value = 1.0 - tex_cfg.get("albedo_amp", 0.18)
            tex_contrast.inputs["To Max"].default_value = 1.0 + tex_cfg.get("albedo_amp", 0.14)
            links.new(tex_bw.outputs["Val"], tex_contrast.inputs["Value"])

            tex_mul = nodes.new("ShaderNodeMix")
            tex_mul.data_type = "RGBA"
            tex_mul.blend_type = "MULTIPLY"
            tex_mul.inputs["Factor"].default_value = tex_cfg.get("mix", 0.85)
            links.new(color_socket, tex_mul.inputs["A"])
            links.new(tex_contrast.outputs["Result"], tex_mul.inputs["B"])
            color_socket = tex_mul.outputs["Result"]

            # 将底纹微高度与高频程序噪声融合后驱动法线微凹凸与粗糙度变化
            bump_mix = nodes.new("ShaderNodeMath")
            bump_mix.operation = "ADD"
            tex_bump_scale = nodes.new("ShaderNodeMath")
            tex_bump_scale.operation = "MULTIPLY"
            tex_bump_scale.inputs[1].default_value = tex_cfg.get("bump_weight", 0.78)
            links.new(tex_bw.outputs["Val"], tex_bump_scale.inputs[0])
            fine_scale = nodes.new("ShaderNodeMath")
            fine_scale.operation = "MULTIPLY"
            fine_scale.inputs[1].default_value = 1.0 - tex_cfg.get("bump_weight", 0.78)
            links.new(fine.outputs["Fac"], fine_scale.inputs[0])
            links.new(tex_bump_scale.outputs[0], bump_mix.inputs[0])
            links.new(fine_scale.outputs[0], bump_mix.inputs[1])
            bump_socket = bump_mix.outputs[0]

            rough_mix = nodes.new("ShaderNodeMix")
            rough_mix.data_type = "FLOAT"
            rough_mix.inputs["Factor"].default_value = 0.45
            links.new(noise.outputs["Fac"], rough_mix.inputs["A"])
            links.new(tex_bw.outputs["Val"], rough_mix.inputs["B"])
            rough_driver = rough_mix.outputs["Result"]

        ao = nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 8
        ao.inputs["Distance"].default_value = 1.6
        links.new(color_socket, ao.inputs["Color"])

        cavity = nodes.new("ShaderNodeMix")
        cavity.data_type = "RGBA"
        cavity.blend_type = "MULTIPLY"
        cavity.inputs["Factor"].default_value = .45 if kind in ("plate", "metal") else .36
        links.new(color_socket, cavity.inputs["A"])
        links.new(ao.outputs["Color"], cavity.inputs["B"])

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
        edge_gain.inputs[1].default_value = .36 if kind in ("plate", "metal") else .12
        links.new(edge_ramp.outputs["Result"], edge_gain.inputs[0])
        links.new(edge_gain.outputs[0], edge_mix.inputs["Factor"])
        links.new(cavity.outputs["Result"], edge_mix.inputs["A"])
        links.new(edge_mix.outputs["Result"], bsdf.inputs["Base Color"])

        rmap = nodes.new("ShaderNodeMapRange")
        rmap.inputs["To Min"].default_value = max(.08, rough - .09)
        rmap.inputs["To Max"].default_value = min(.98, rough + .10)
        links.new(rough_driver, rmap.inputs["Value"])
        links.new(rmap.outputs["Result"], bsdf.inputs["Roughness"])

        bump = nodes.new("ShaderNodeBump")
        default_bump = (
            .040 if kind == "plate" else .135 if kind == "fabric" else .065 if kind == "rubber"
            else .042 if kind == "metal" else .012
        )
        bump.inputs["Strength"].default_value = tex_cfg.get("bump_strength", default_bump) if tex_cfg else default_bump
        bump.inputs["Distance"].default_value = .035
        links.new(bump_socket, bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

        emit = nodes.new("ShaderNodeEmission")
        emit.name = "Bake emission"
        target = nodes.new("ShaderNodeTexImage")
        target.name = "Bake target"
        return mat

    def skin_rigid(self, obj, joint: str):
        n = len(obj.data.vertices)
        index = self.joint_ids[joint]
        attr(obj.data, "_skinIndex", [index, 0, 0, 0] * n, 4)
        attr(obj.data, "_skinWeight", [1.0, 0.0, 0.0, 0.0] * n, 4)

    def finalize(self, name, vertices, faces, surface, joint, bevel=0, smooth=True,
                 collection=None, decal_uvs=None, slot_override=None):
        collection = collection or self.low_collection
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([point(v) for v in vertices], [], faces)
        mesh.update()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if bevel > 0 and decal_uvs is None:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", clamp_overlap=True)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        for poly in mesh.polygons:
            poly.use_smooth = smooth
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        obj.data.materials.append(self.material(surface))
        if slot_override is not None:
            obj["slot"] = slot_override
        else:
            kind = self.palette[surface][3]
            obj["slot"] = 1 if kind == "team" else 2 if kind == "lamp" else 0
        origin = point(self.joints[self.joint_ids[joint]]["origin"])
        obj.data.transform(Matrix.Translation(origin))
        attr(obj.data, "_installCoord", [c for v in obj.data.vertices for c in v.co])
        if decal_uvs is not None:
            attr(obj.data, "_decalUV", [c for uv in decal_uvs for c in (uv[0], uv[1], 0.0)], 3)
        self.skin_rigid(obj, joint)
        return obj

    def pair(self, name, maker, surface, joint="torso", bevel=0, smooth=True, slot_override=None):
        res_lo = maker(False)
        res_hi = maker(True)
        if len(res_lo) == 3:
            low_v, low_f, low_uv = res_lo
            high_v, high_f, high_uv = res_hi
        else:
            low_v, low_f = res_lo
            high_v, high_f = res_hi
            low_uv = high_uv = None
        low = self.finalize(name, low_v, low_f, surface, joint, bevel, smooth,
                            self.low_collection, low_uv, slot_override)
        high = self.finalize(name + " / high", high_v, high_f, surface, joint,
                             bevel * 1.1 if bevel else 0, smooth, self.high_collection, high_uv, slot_override)
        self.pieces.append((low, high))
        return low, high

    def box(self, name, center, size, surface, joint="torso", radius=.08, rotation=(0, 0, 0), slot_override=None):
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
        return self.pair(name, maker, surface, joint, 0, True, slot_override)

    def decal_panel(self, name, center, width, height, thickness, surface, joint="torso",
                    rotation=(0, 0, 0), slot_override=None):
        """正交贴花/雷达屏幕薄板，+Z 局部面精确映射 _decalUV；repeat 材质按真实纵横比平铺避免拉伸。"""
        spec = self.palette[surface]
        tex_cfg = spec[4] if len(spec) > 4 else None
        is_repeat = bool(tex_cfg and tex_cfg.get("repeat"))
        unit = min(width, height) if is_repeat else 1.0
        u_max = (width / unit) * .35 if is_repeat else 1.0
        v_max = (height / unit) * .35 if is_repeat else 1.0

        def maker(high):
            nx, ny = (6, 6) if high else (2, 2)
            rot = Euler(rotation, "XYZ").to_matrix()
            ctr = Vector(center)
            verts, uvs = [], []
            for layer_z in (thickness * 0.5, -thickness * 0.5):
                for iy in range(ny + 1):
                    v = iy / ny
                    y = (v - 0.5) * height
                    for ix in range(nx + 1):
                        u = ix / nx
                        x = (u - 0.5) * width
                        p = rot @ Vector((x, y, layer_z)) + ctr
                        verts.append(tuple(p))
                        uvs.append((u * u_max, v * v_max))
            stride = nx + 1
            off = (nx + 1) * (ny + 1)
            faces = []
            for iy in range(ny):
                for ix in range(nx):
                    a = iy * stride + ix
                    b = a + 1
                    c = b + stride
                    d = a + stride
                    faces.append((a, b, c, d))
                    faces.append((off + d, off + c, off + b, off + a))
            for ix in range(nx):
                a, b = ix, ix + 1
                faces.append((a, off + a, off + b, b))
                a2, b2 = ny * stride + ix, ny * stride + ix + 1
                faces.append((a2, b2, off + b2, off + a2))
            for iy in range(ny):
                a, b = iy * stride, (iy + 1) * stride
                faces.append((a, b, off + b, off + a))
                a2, b2 = iy * stride + nx, (iy + 1) * stride + nx
                faces.append((a2, off + a2, off + b2, b2))
            return verts, faces, uvs
        return self.pair(name, maker, surface, joint, 0, False, slot_override)

    def curved_decal(self, name, eval_fn, u_lo, v_lo, u_hi, v_hi, thickness, surface, joint="torso",
                     slot_override=None):
        """贴合弧面装甲的曲面贴花薄片，(u, v) 直接作为 _decalUV。"""
        def maker(high):
            nu, nv = (u_hi, v_hi) if high else (u_lo, v_lo)
            outer, inner, uvs = [], [], []
            for iv in range(nv + 1):
                v = iv / nv
                for iu in range(nu + 1):
                    u = iu / nu
                    pos, nrm = eval_fn(u, v, high)
                    p = Vector(pos)
                    n = Vector(nrm).normalized()
                    outer.append(tuple(p + n * (thickness * .5)))
                    inner.append(tuple(p - n * (thickness * .5)))
                    uvs.append((u, v))
            verts = outer + inner
            uvs = uvs + uvs
            off = len(outer)
            stride = nu + 1
            faces = []
            for iv in range(nv):
                for iu in range(nu):
                    a = iv * stride + iu
                    b = a + 1
                    c = b + stride
                    d = a + stride
                    faces.append((a, b, c, d))
                    faces.append((off + d, off + c, off + b, off + a))
            for iu in range(nu):
                a, b = iu, iu + 1
                faces.append((a, off + a, off + b, b))
                a2, b2 = nv * stride + iu, nv * stride + iu + 1
                faces.append((a2, b2, off + b2, off + a2))
            for iv in range(nv):
                a, b = iv * stride, (iv + 1) * stride
                faces.append((a, b, off + b, off + a))
                a2, b2 = iv * stride + nu, (iv + 1) * stride + nu
                faces.append((a2, off + a2, off + b2, b2))
            return verts, faces, uvs
        return self.pair(name, maker, surface, joint, 0, True, slot_override)

    def cylinder(self, name, start, end, radius, surface, joint="torso", bevel=.03, sides=18, r2=None):
        r2 = radius if r2 is None else r2
        a, b = Vector(start), Vector(end)
        axis = b - a
        length = axis.length
        quat = Vector((0, 0, 1)).rotation_difference(axis.normalized())

        def maker(high):
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides * 2 if high else sides,
                                  radius1=radius, radius2=r2, depth=length)
            if bevel > 0:
                cap_edges = [e for e in bm.edges if len(e.link_faces) == 2 and
                             abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < .25]
                bmesh.ops.bevel(bm, geom=cap_edges, offset=bevel, segments=3 if high else 1,
                                affect="EDGES", clamp_overlap=True)
            bmesh.ops.rotate(bm, matrix=quat.to_matrix(), verts=bm.verts)
            bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
            verts = [tuple(v.co) for v in bm.verts]
            faces = [tuple(v.index for v in f.verts) for f in bm.faces]
            bm.free()
            return verts, faces
        return self.pair(name, maker, surface, joint, 0, True)

    def extrusion(self, name, profile, x_center, width, surface, joint="torso", radius=.05):
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
        return self.pair(name, maker, surface, joint, 0, True)

    def tube(self, name, center, profile, surface, joint="torso"):
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
        return self.pair(name, maker, surface, joint, .015, True)

    def cable(self, name, path, radius=.12, surface="rubber", joint="torso"):
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
        return self.pair(name, maker, surface, joint, 0, True)

    def anatomical_loft(self, name, levels, joint, surface="undersuit", phase=0, wrinkle_amp=.015, shape_fn=None):
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
        return self.pair(name, maker, surface, joint, 0, True)

    def curved_shell(self, name, eval_fn, u_lo, v_lo, u_hi, v_hi, thickness, surface, joint="torso",
                     wrap_u=False, bevel=.04, slot_override=None):
        """带真实厚度和清晰边缘倒角的曲面装甲或布料披肩壳体。"""
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
        return self.pair(name, maker, surface, joint, bevel, True, slot_override)

    def build_industrial_boot(self, side, s, foot, shell="ceramic", dark="armorDark",
                              mid="armorMid", rubber="rubber", steel="steel", scale=1.0):
        """工业联邦重甲战靴（与突击步兵同源底盘）。"""
        cx = -s * .32 * scale
        y_bot = -1.65

        def boot_maker(high):
            n_ring = 28 if high else 16
            rings = [
                (y_bot + .04,  0.00, 1.05, 1.78 * scale, 1.78 * scale, 4.42 * scale, 2.02 * scale),
                (y_bot + .52,  0.00, 1.08, 1.94 * scale, 1.94 * scale, 4.68 * scale, 2.15 * scale),
                (y_bot + 1.05, 0.00, 1.00, 1.88 * scale, 1.88 * scale, 4.40 * scale, 2.08 * scale),
                (y_bot + 1.72, 0.00, .72,  1.76 * scale, 1.76 * scale, 3.55 * scale, 1.94 * scale),
                (y_bot + 2.38, 0.00, .28,  1.72 * scale, 1.72 * scale, 2.28 * scale, 1.82 * scale),
                (y_bot + 3.05, 0.00, .06,  1.80 * scale, 1.80 * scale, 1.94 * scale, 1.84 * scale),
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

        self.pair(f"{side} Armored boot core", boot_maker, dark, foot, 0, True)
        self.box(f"{side} Boot sole", (cx, y_bot + .24, 1.15 * scale), (3.45 * scale, .48, 6.25 * scale), rubber, foot, .22)

        def toe_cap(u, v, high):
            ang = (u - .5) * 2.15
            y = y_bot + .56 + v * 1.40
            rx = (1.88 - .44 * v) * scale
            rz = (2.60 - .74 * v) * scale
            nx, nz = math.sin(ang), math.cos(ang)
            return (cx + nx * rx, y, 2.02 * scale + nz * rz), (nx, .35, nz)

        self.curved_shell(f"{side} Ceramic toe guard", toe_cap, 10, 4, 20, 8, .32, shell, foot, bevel=.04)
        self.box(f"{side} Instep clamp", (cx, y_bot + 1.85, 2.02 * scale), (3.45 * scale, .70, 1.32 * scale), mid, foot, .16, (.36, 0, 0))
        for hs in (-1, 1):
            self.cylinder(f"{side} Ankle actuator {hs}", (cx + hs * 1.78 * scale, y_bot + 1.10, -.55),
                          (cx + hs * 1.78 * scale, y_bot + 2.85, -.35), .26, steel, foot, .04, 12)
        self.box(f"{side} Heel bumper", (cx, y_bot + 1.12, -1.92 * scale), (3.18 * scale, 1.32, .82), mid, foot, .18)

    def build_field_boot(self, side, s, foot, upper="leather", sole="rubber", trim="darkMetal",
                         scale=1.0, tall_cuff=True):
        """军靴／荒漠野战高帮战靴（供指挥官与远行中继三人组）。"""
        cx = -s * .28 * scale
        y_bot = -1.65

        def boot_maker(high):
            n_ring = 28 if high else 16
            rings = [
                (y_bot + .04, 0.0, 1.00, 1.56 * scale, 1.56 * scale, 4.18 * scale, 1.92 * scale),
                (y_bot + .48, 0.0, 1.02, 1.70 * scale, 1.70 * scale, 4.40 * scale, 2.02 * scale),
                (y_bot + 1.02, 0.0, .92, 1.66 * scale, 1.66 * scale, 4.12 * scale, 1.94 * scale),
                (y_bot + 1.68, 0.0, .62, 1.56 * scale, 1.56 * scale, 3.22 * scale, 1.80 * scale),
                (y_bot + 2.38, 0.0, .22, 1.54 * scale, 1.54 * scale, 2.05 * scale, 1.68 * scale),
                (y_bot + (3.25 if tall_cuff else 2.85), 0.0, .06, 1.62 * scale, 1.62 * scale, 1.78 * scale, 1.72 * scale),
            ]
            verts, faces = [], []
            for y, dx, zc, rxp, rxn, zf, zb in rings:
                for i in range(n_ring):
                    a = i * math.tau / n_ring
                    ca, sa = math.cos(a), math.sin(a)
                    rx = rxp if ca >= 0 else rxn
                    z_local = sa * (zf - zc) if sa >= 0 else sa * (zb + zc)
                    if sa > .35:
                        rx *= 1.0 - .20 * ((sa - .35) / .65) ** 1.4
                    verts.append((cx + dx + ca * rx, y, zc + z_local))
            for k in range(len(rings) - 1):
                for i in range(n_ring):
                    a = k * n_ring + i
                    b = k * n_ring + (i + 1) % n_ring
                    faces.append((a, b, b + n_ring, a + n_ring))
            c0 = len(verts)
            verts.append((cx, y_bot, .95))
            c1 = len(verts)
            verts.append((cx, y_bot + (3.30 if tall_cuff else 2.90), .06))
            top = (len(rings) - 1) * n_ring
            for i in range(n_ring):
                j = (i + 1) % n_ring
                faces.append((c0, j, i))
                faces.append((c1, top + i, top + j))
            return verts, faces

        self.pair(f"{side} Field boot", boot_maker, upper, foot, 0, True)
        self.box(f"{side} Boot sole", (cx, y_bot + .22, 1.08 * scale), (3.12 * scale, .44, 5.95 * scale), sole, foot, .20)
        self.box(f"{side} Boot heel cap", (cx, y_bot + .88, -1.78 * scale), (2.82 * scale, 1.05, .72), sole, foot, .15)
        self.box(f"{side} Boot ankle strap", (cx, y_bot + 2.48, .28), (3.26 * scale, .52, 3.55 * scale), trim, foot, .12)

    def build_gloved_hand(self, side, s, hand, glove="glove", armor="ceramic", dark="armorDark",
                          pose="grip", scale=1.0):
        """立体战术手套手掌与分指（pose: 'grip' 握把 / 'palm' 托举 / 'open' 自然微曲）。"""
        self.box(f"{side} Palm", (0.0, -.52 * scale, .42 * scale),
                 (1.62 * scale, 2.02 * scale, 1.72 * scale), glove, hand, .28)
        self.box(f"{side} Knuckle plate", (s * .76 * scale, -.62 * scale, .58 * scale),
                 (.38 * scale, 1.38 * scale, 1.48 * scale), armor, hand, .10)
        if pose == "grip":
            # 紧凑握持状态（抓握枪柄/工具柄）
            self.box(f"{side} Fingers curl", (-s * .35 * scale, -.88 * scale, 1.28 * scale),
                     (1.52 * scale, 1.56 * scale, 1.02 * scale), glove, hand, .22)
            self.box(f"{side} Thumb", (-s * .76 * scale, .10 * scale, 1.05 * scale),
                     (.78 * scale, .78 * scale, 1.48 * scale), glove, hand, .18, (.12, -s * .35, 0))
        elif pose == "palm":
            # 微展托持状态（托平板/托护木）
            self.box(f"{side} Fingers cup", (-s * .10 * scale, -1.32 * scale, 1.12 * scale),
                     (1.60 * scale, 1.15 * scale, 1.45 * scale), glove, hand, .22, (-.25, 0, 0))
            self.box(f"{side} Thumb", (-s * .85 * scale, -.22 * scale, 1.18 * scale),
                     (.72 * scale, .72 * scale, 1.38 * scale), glove, hand, .16, (.08, -s * .45, 0))
        else:
            # 自然微曲下垂
            self.box(f"{side} Fingers relaxed", (0.0, -1.65 * scale, .62 * scale),
                     (1.45 * scale, 1.35 * scale, 1.18 * scale), glove, hand, .24, (.18, 0, 0))
            self.box(f"{side} Thumb", (-s * .72 * scale, -.65 * scale, 1.18 * scale),
                     (.68 * scale, .95 * scale, .78 * scale), glove, hand, .16, (.25, -s * .25, 0))
        self.box(f"{side} Wrist ring", (0.0, .42 * scale, .12 * scale),
                 (2.05 * scale, .72 * scale, 2.02 * scale), dark, hand, .16)

    def _join(self, objects, name):
        select(objects)
        bpy.ops.object.join()
        bpy.context.object.name = name
        return bpy.context.object

    def _image(self, channel):
        img = bpy.data.images.new(f"{self.surface_name} bake {channel}",
                                  self.args.resolution, self.args.resolution, alpha=False)
        img.generated_color = (.5, .5, 1, 1) if channel == "normal" else (1, 1, 1, 1)
        if channel != "albedo":
            img.colorspace_settings.name = "Non-Color"
        return img

    def _pixels(self, img):
        res = self.args.resolution
        data = np.empty(res * res * 4, dtype=np.float32)
        img.pixels.foreach_get(data)
        return data.reshape(res, res, 4)

    def _bake(self, low, high, channel, target, projected=True):
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
                sock = bsdf.inputs["Base Color"]
                if sock.is_linked:
                    links.new(sock.links[0].from_socket, emit.inputs["Color"])
                else:
                    emit.inputs["Color"].default_value = sock.default_value
            elif channel in {"roughness", "metalness"}:
                socket = bsdf.inputs["Roughness" if channel == "roughness" else "Metallic"]
                if socket.is_linked:
                    links.new(socket.links[0].from_socket, emit.inputs["Color"])
                else:
                    emit.inputs["Color"].default_value = (socket.default_value,) * 3 + (1,)
            links.new(bsdf.outputs[0] if channel in {"normal", "ao"} else emit.outputs[0], output.inputs["Surface"])
        self.scene.render.bake.use_selected_to_active = projected
        self.scene.render.bake.use_cage = False
        self.scene.render.bake.use_clear = True
        try:
            bpy.ops.object.bake(type={"normal": "NORMAL", "ao": "AO"}.get(channel, "EMIT"), normal_space="TANGENT")
            return self._pixels(target)
        finally:
            for mat, socket in saved:
                mat.node_tree.links.new(socket, mat.node_tree.nodes.get("Material Output").inputs["Surface"])

    def _coverage(self, low):
        target = self._image("coverage")
        select([low])
        saved = []
        margin = self.scene.render.bake.margin
        self.scene.render.bake.margin = 0
        self.scene.render.bake.use_selected_to_active = False
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
        mask = self._pixels(target)[:, :, 0] > .999
        for mat, socket in saved:
            mat.node_tree.links.new(socket, mat.node_tree.nodes.get("Material Output").inputs["Surface"])
        self.scene.render.bake.margin = margin
        bpy.data.images.remove(target)
        return mask

    def _baked_material(self, images, slot):
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
            # 发光屏/指示灯保留烘焙色相与高亮
            links.new(nodes["Image Texture"].outputs[0], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = .72
        return mat

    def render(self, objects, name, view=(1.35, -1.8, 1.0), resolution=1024):
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
        self.scene.camera = camera
        lights = []
        for offset, power, color in [((-1, -1.5, 2), 1200, (1, .90, .78)),
                                     ((1, .7, 1.6), 950, (.64, .82, 1)),
                                     ((1.8, -.7, .8), 380, (1, .96, .89))]:
            bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * extent)
            light = bpy.context.object
            light.data.energy = power * extent ** 2 / 10
            light.data.shape = "DISK"
            light.data.size = extent * 1.15
            light.data.color = color
            light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
            lights.append(light)
        self.scene.render.resolution_x = self.scene.render.resolution_y = resolution
        self.scene.render.resolution_percentage = 100
        self.scene.render.film_transparent = True
        self.scene.cycles.samples = 48
        self.scene.render.filepath = str(self.directory / (name + ".png"))
        bpy.ops.render.render(write_still=True)
        for obj in [camera, *lights]:
            bpy.data.objects.remove(obj, do_unlink=True)
        self.scene.cycles.samples = 16

    def bake_and_export(self, cage_extrusion: float = .22, max_ray_distance: float = .70):
        started = time.time()
        lows = [p[0] for p in self.pieces]
        highs = [p[1] for p in self.pieces]
        if self.args.preview_only:
            for obj in highs:
                obj.hide_render = True
            self.render(lows, "form-preview")
            return

        # 沿 X 轴分离各零件避免互投射，完成 2K 高低模 PBR 烘焙后再复位。
        for i, (low, high) in enumerate(self.pieces):
            offset = Vector((i * 120, 0, 0))
            for obj in (low, high):
                attr(obj.data, "_bakeOffset", list(offset) * len(obj.data.vertices))
                obj.data.transform(Matrix.Translation(offset))
            mat = low.data.materials[0].copy()
            mat["slot"] = low["slot"]
            low.data.materials[0] = mat

        low = self._join(lows, f"{self.surface_name} · UV LOW")
        high = self._join(highs, f"{self.surface_name} · HIGH / editable detail")
        select([low])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.20, island_margin=.0002, area_weight=1, scale_to_bounds=True)
        bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=.0015, shape_method="CONCAVE")
        bpy.ops.object.mode_set(mode="OBJECT")

        targets = {ch: self._image(ch) for ch in ("albedo", "normal", "ao", "roughness", "metalness")}
        self.scene.render.bake.cage_extrusion = cage_extrusion
        self.scene.render.bake.max_ray_distance = max_ray_distance
        mask = self._coverage(low)
        results = {}
        for ch in ("albedo", "normal", "roughness", "metalness"):
            self.log("BAKE / " + ch)
            results[ch] = self._bake(low, high, ch, targets[ch])

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

        self.log("BAKE / assembled AO")
        results["ao"] = self._bake(low, high, "ao", targets["ao"])
        if missed:
            high.hide_render = True
            for ch in results:
                fallback = self._bake(low, high, ch, targets[ch], False)
                results[ch][invalid] = fallback[invalid]

        normals = results["normal"]
        length = np.linalg.norm(normals[:, :, :3] * 2 - 1, axis=2)
        neutral = (length < .05) | (length > 1.25) | (normals[:, :, 2] < .5)
        neutral_count = int(np.count_nonzero(mask & neutral))
        if neutral_count > missed:
            raise ValueError("Fallback normal quality regressed")
        normals[neutral] = (.5, .5, 1, 1)

        orm = np.ones_like(normals)
        for index, ch in enumerate(("ao", "roughness", "metalness")):
            orm[:, :, index] = results[ch][:, :, 0]

        images = {}
        for ch, data in {"albedo": results["albedo"], "normal": normals, "orm": orm}.items():
            img = targets.get(ch) or self._image(ch)
            img.pixels.foreach_set(data.ravel())
            img.filepath_raw = str(self.directory / f"{self.surface_name}-{ch}.png")
            img.file_format = "PNG"
            img.save()
            img.pack()
            images[ch] = img

        low_count, high_count = len(low.data.polygons), len(high.data.polygons)
        objects = []
        for slot in range(3):
            if not any(low.data.materials[f.material_index]["slot"] == slot for f in low.data.polygons):
                continue
            obj = low.copy()
            obj.data = low.data.copy()
            self.low_collection.objects.link(obj)
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if obj.data.materials[f.material_index]["slot"] != slot],
                             context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
            bm.to_mesh(obj.data)
            bm.free()
            for attr_name in ("_installCoord", "_bakeOffset", "_decalUV"):
                if attr_name in obj.data.attributes:
                    obj.data.attributes.remove(obj.data.attributes[attr_name])
            obj.data.materials.clear()
            obj.data.materials.append(self._baked_material(images, slot))
            for face in obj.data.polygons:
                face.material_index = 0
            obj.name = f"{self.key}|-1|{slot}"
            for k in list(obj.keys()):
                del obj[k]
            obj["key"] = self.key
            obj["part"] = -1
            obj["slot"] = slot
            objects.append(obj)

        bpy.data.objects.remove(low, do_unlink=True)
        high.hide_render = True
        high.hide_set(True)

        select(objects)
        bpy.ops.export_scene.gltf(
            filepath=str(self.directory / f"{self.surface_name}.glb"),
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
        self.template["bounds"] = [
            [min(v.x for v in pts), min(v.z for v in pts), min(-v.y for v in pts)],
            [max(v.x for v in pts), max(v.z for v in pts), max(-v.y for v in pts)],
        ]
        self.template["surface"] = self.surface_name
        report = {
            "key": self.key,
            "generator": self.script_rel,
            "scriptHash": self.script_hash,
            "tile": [0, 0],
            "tileSize": self.args.resolution,
            "lowFaces": low_count,
            "highFaces": high_count,
            "assemblies": len(self.pieces),
            "template": self.template,
            "projection": {
                "cageExtrusion": cage_extrusion,
                "maxRayDistance": max_ray_distance,
                "uvPixels": covered,
                "missedNormalPixels": int(np.count_nonzero(mask & invalid_normal)),
                "backfacingNormalPixels": int(np.count_nonzero(mask & backfacing)),
                "missedMaterialPixels": int(np.count_nonzero(mask & invalid_material)),
                "missedProjectionPixels": missed,
                "lowSurfaceFallbackPixels": missed,
                "neutralNormalPixels": neutral_count,
            },
        }
        if self.texture_sources:
            report["textureSources"] = self.texture_sources
        report.update(self.extra_report)
        (self.directory / f"{self.surface_name}-bake.json").write_text(json.dumps([report], indent=2) + "\n")
        self.log(f"BAKE READY / low={low_count} high={high_count} coverage={1 - missed / covered:.3%}")

        armature = bpy.data.armatures.new(f"{self.surface_name} / game bone contract")
        rig = bpy.data.objects.new(f"{self.surface_name} / EDITABLE RIG", armature)
        self.scene.collection.objects.link(rig)
        select([rig])
        bpy.ops.object.mode_set(mode="EDIT")
        bones = []
        for joint in self.joints:
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
            for i, joint in enumerate(self.joints):
                group = obj.vertex_groups.new(name=joint["name"])
                for vertex in obj.data.vertices:
                    w = sum(wt for idx, wt in zip(indices.data[vertex.index].color,
                            weights.data[vertex.index].color) if round(idx) == i)
                    if w > 0:
                        group.add([vertex.index], w, "REPLACE")
            modifier = obj.modifiers.new("Game articulation", "ARMATURE")
            modifier.object = rig

        self.scene["rigContract"] = json.dumps(self.joints, separators=(",", ":"))
        self.scene["generator"] = self.script_hash
        self.scene["workflow"] = self.workflow
        select(objects)
        bpy.ops.wm.save_as_mainfile(filepath=str(self.directory / f"{self.surface_name}.blend"), compress=True)
        self.render(objects, "front", (1.35, -1.8, 1.0))
        self.render(objects, "side", (2.1, -0.35, 0.75))
        self.render(objects, "rear", (-1.35, 1.8, 1.0))
        self.log(f"COMPLETE / {time.time() - started:.1f}s")
