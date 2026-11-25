"""工程采集车专用硬表面工程：形体 → 高低模 → 独立 2K PBR → 游戏资产。

坐标和刚性蒙皮使用 export-blender-source.ts 导出的游戏骨骼。造型参数以本文件为准。
不修改通用雕刻生成器；其它 77 个资产继续保留各自的构建来源。
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
from mathutils import Matrix, Vector


parser = argparse.ArgumentParser()
parser.add_argument("--project", required=True)
parser.add_argument("--source", required=True)
parser.add_argument("--resolution", type=int, default=2048)
parser.add_argument("--device", choices=["CPU", "METAL"], default="METAL")
parser.add_argument("--preview-only", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
root = Path(args.project)
directory = root / "artifacts/worker-hero"
directory.mkdir(parents=True, exist_ok=True)
source = json.loads((Path(args.source) / "source.json").read_text())
template = source["templates"]["industrial:worker"]
joints = template["rig"]
joint_ids = {joint["name"]: index for index, joint in enumerate(joints)}
wheel_y = joints[joint_ids["LWheel0"]]["origin"][1]
script_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
scene = bpy.context.scene
bpy.context.preferences.filepaths.save_version = 0
bpy.context.preferences.filepaths.file_preview_type = "NONE"
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.device = "CPU"
if args.device == "METAL":
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    if not any(device.type == "METAL" for device in preferences.devices):
        raise ValueError("Metal GPU is unavailable")
    for device in preferences.devices:
        device.use = device.type == "METAL"
    scene.cycles.device = "GPU"
scene.view_settings.view_transform = "AgX"
scene.world.color = (.16, .16, .16)
scene.render.image_settings.file_format = "PNG"
scene.render.bake.margin = max(4, args.resolution // 256)
scene.render.bake.use_clear = True
low_collection = bpy.data.collections.new("01 · GAME LOW / rigid skin")
high_collection = bpy.data.collections.new("02 · HIGH / machined edges")
scene.collection.children.link(low_collection)
scene.collection.children.link(high_collection)
pieces = []
texture_sources = {}
damage_sites = {
    # 世界坐标中的接触点；高低模共同变形，不能用法线贴图伪造轮廓破损。
    "R / fender 15": [((20.1, 17.2, 20.2), (3.3, 2.7, 3.6), (0, .86, .51), .60)],
    "Forged loader arm": [((9.1, 22.0, 18.3), (1.9, 2.4, 4.0), (1, 0, 0), .32),
                          ((7.4, 22.2, 17.0), (2.4, 1.4, 4.2), (0, 1, 0), .20)],
    "Side equipment pod": [((17.65, 18.5, 5.0), (1.5, 2.5, 2.6), (1, 0, 0), .28)],
}


def log(text):
    print("WORKER " + text, flush=True)


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
    item = mesh.attributes.new(name, kind, "POINT")
    item.data.foreach_set(field, values)


def linear(value):
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


# 涂层、橡胶和裸金属分别定义，不靠全车噪声统一“做旧”。
PALETTE = {
    "ivory": ((.61, .68, .70), .53, .06),
    "edge": ((.76, .79, .76), .48, .06),
    "blue": ((.30, .39, .42), .57, .06),
    "frame": ((.14, .18, .19), .56, .65),
    "black": ((.052, .072, .071), .66, .28),
    "rubber": ((.078, .087, .076), .83, .01),
    "tread": ((.115, .125, .108), .79, .01),
    "steel": ((.33, .39, .40), .34, .82),
    "chrome": ((.57, .64, .66), .22, .92),
    "yellow": ((.80, .47, .095), .54, .04),
    "hazard": ((.80, .47, .095), .54, .04),
    "bronze": ((.49, .30, .145), .43, .76),
    "glass": ((.045, .22, .29), .23, .15),
    "glassline": ((.18, .38, .43), .18, .30),
    "team": ((.72, .72, .72), .46, .12),
    "lamp": ((.88, .91, .82), .21, .08),
    "red": ((.55, .10, .055), .35, .08),
}


def generated_masks():
    """生图只提供表面样本；同源遮罩驱动颜色、粗糙度、金属度及微凹凸。"""
    images = {}
    for kind, filename in (("paint", "weathered-paint-source.jpg"), ("grime", "battle-grime-source.jpg")):
        path = directory / filename
        if not path.is_file():
            raise ValueError("Missing authored texture source: " + str(path))
        texture_sources[kind] = {"file": str(path.relative_to(root)),
                                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        raw = bpy.data.images.load(str(path), check_existing=True)
        raw.colorspace_settings.name = "Non-Color"
        width, height = raw.size
        data = np.empty(width * height * 4, dtype=np.float32)
        raw.pixels.foreach_get(data)
        # 原图下沿含生成服务标记，裁去下方 12%，它不能进入游戏材质。
        rgb = data.reshape(height, width, 4)[round(height * .12):, :, :3].copy()
        gray = rgb @ np.array([.2126, .7152, .0722], dtype=np.float32)
        if kind == "paint":
            rust = np.clip((rgb[:, :, 0] - np.maximum(rgb[:, :, 1], rgb[:, :, 2]) - .025) * 9, 0, 1)
            chips = np.clip((.56 - gray) * 5.5, 0, 1) * (1 - rust * .65)
            stain = np.clip((.82 - gray) * 2.5, 0, .85)
            channels = (chips, rust, stain, np.clip(gray, 0, 1))
        else:
            earth = np.clip((rgb[:, :, 0] - rgb[:, :, 2] - .012) * 5 + gray * .6, 0, 1)
            oil = np.clip((.19 - gray) * 5, 0, 1)
            channels = (earth, oil, np.clip(gray * 3, 0, 1), np.clip(gray * 2, 0, 1))
        rgba = np.stack(channels, axis=2).astype(np.float32)
        img = bpy.data.images.new("AUTHORED " + kind + " / packed weather masks",
                                  rgb.shape[1], rgb.shape[0], alpha=True)
        img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(rgba.ravel())
        img.scale(1536, 1536)
        img.filepath_raw = str(directory / (kind + "-weather-masks.png"))
        img.file_format = "PNG"
        img.save()
        img.pack()
        images[kind] = img
        bpy.data.images.remove(raw)
    log("TEXTURES / generated paint + earth masks, shared PBR signals")
    return images


weather_images = generated_masks()


def material(name):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    color, roughness, metalness = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["metalness"] = metalness
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = metalness
    coordinate = nodes.new("ShaderNodeAttribute")
    coordinate.attribute_name = "_partCoord"
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.7
    noise.inputs["Detail"].default_value = 3
    links.new(coordinate.outputs["Vector"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    a, b = ramp.color_ramp.elements
    a.position, b.position = .17, .84
    a.color = tuple(linear(v * .94) for v in color) + (1,)
    b.color = tuple(linear(min(1, v * 1.045)) for v in color) + (1,)
    links.new(noise.outputs["Fac"], ramp.inputs[0])
    base = ramp.outputs["Color"]
    geometry = nodes.new("ShaderNodeNewGeometry")
    wear = nodes.new("ShaderNodeValToRGB")
    wear.color_ramp.elements[0].position = .503
    wear.color_ramp.elements[1].position = .529
    links.new(geometry.outputs["Pointiness"], wear.inputs[0])
    chips = nodes.new("ShaderNodeTexNoise")
    chips.inputs["Scale"].default_value = 38
    chips.inputs["Detail"].default_value = 2
    links.new(coordinate.outputs["Vector"], chips.inputs[0])
    if name == "glass":
        # 深色下沿和浅色上沿属于玻璃自身；反射仍由实际灯光产生。
        split = nodes.new("ShaderNodeSeparateXYZ")
        links.new(coordinate.outputs["Vector"], split.inputs[0])
        gradient = nodes.new("ShaderNodeValToRGB")
        gradient.color_ramp.elements[0].color = (.004, .021, .032, 1)
        gradient.color_ramp.elements[1].color = (.018, .085, .12, 1)
        links.new(split.outputs["Z"], gradient.inputs[0])
        base = gradient.outputs[0]
    if name == "hazard":
        split = nodes.new("ShaderNodeSeparateXYZ")
        links.new(coordinate.outputs[0], split.inputs[0])
        diagonal = nodes.new("ShaderNodeMath")
        diagonal.operation = "MULTIPLY_ADD"
        links.new(split.outputs["X"], diagonal.inputs[0])
        diagonal.inputs[1].default_value = 1.7
        links.new(split.outputs["Y"], diagonal.inputs[2])
        frequency = nodes.new("ShaderNodeMath")
        frequency.operation = "MULTIPLY"
        frequency.inputs[1].default_value = 20
        links.new(diagonal.outputs[0], frequency.inputs[0])
        wave = nodes.new("ShaderNodeMath")
        wave.operation = "SINE"
        links.new(frequency.outputs[0], wave.inputs[0])
        threshold = nodes.new("ShaderNodeMath")
        threshold.operation = "GREATER_THAN"
        threshold.inputs[1].default_value = -.1
        links.new(wave.outputs[0], threshold.inputs[0])
        paint = nodes.new("ShaderNodeMixRGB")
        links.new(threshold.outputs[0], paint.inputs[0])
        paint.inputs[1].default_value = (.012, .017, .018, 1)
        links.new(base, paint.inputs[2])
        base = paint.outputs[0]
    micro = nodes.new("ShaderNodeTexNoise")
    micro.inputs["Scale"].default_value = 180 if name != "rubber" else 95
    micro.inputs["Detail"].default_value = 2
    links.new(coordinate.outputs[0], micro.inputs[0])
    rough = nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value = roughness - (0 if name=="glass" else .035)
    rough.inputs["To Max"].default_value = roughness + (0 if name=="glass" else .035)
    links.new(micro.outputs["Fac"], rough.inputs["Value"])
    rough_signal, metal_signal = rough.outputs[0], metalness

    def math_node(operation, *values, clamp=False):
        node = nodes.new("ShaderNodeMath")
        node.operation = operation
        node.use_clamp = clamp
        for socket, value in zip(node.inputs, values):
            if isinstance(value, (float, int)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    def mix_color(factor, original, value):
        node = nodes.new("ShaderNodeMixRGB")
        links.new(factor, node.inputs[0])
        for socket, item in zip(node.inputs[1:], (original, value)):
            if isinstance(item, tuple):
                socket.default_value = tuple(linear(v) for v in item[:3]) + (1,)
            else:
                links.new(item, socket)
        return node.outputs[0]

    def mix_scalar(factor, original, value):
        return math_node("ADD", math_node("MULTIPLY", original, math_node("SUBTRACT", 1, factor)),
                         math_node("MULTIPLY", factor, value))

    surface = nodes.new("ShaderNodeAttribute")
    surface.attribute_name = "_surfaceCoord"
    weather = nodes.new("ShaderNodeAttribute")
    weather.attribute_name = "_weather"
    location = nodes.new("ShaderNodeSeparateXYZ")
    links.new(weather.outputs["Vector"], location.inputs[0])
    installed = nodes.new("ShaderNodeAttribute")
    installed.attribute_name = "_installCoord"
    installation = nodes.new("ShaderNodeSeparateXYZ")
    links.new(installed.outputs["Vector"], installation.inputs[0])

    def sample(kind):
        node = nodes.new("ShaderNodeTexImage")
        node.image = weather_images[kind]
        node.projection = "BOX"
        node.projection_blend = .22
        node.extension = "REPEAT"
        links.new(surface.outputs["Vector"], node.inputs["Vector"])
        split = nodes.new("ShaderNodeSeparateColor")
        links.new(node.outputs["Color"], split.inputs[0])
        return split.outputs

    paint, grime = sample("paint"), sample("grime")
    painted = name in {"ivory", "edge", "blue", "yellow", "hazard", "team"}
    bare = name in {"steel", "frame", "bronze"}
    protected = name in {"lamp", "glassline", "red"}
    chips_signal, rust_signal = 0, 0
    if painted or bare:
        # 曲率、真实碰撞部位与生图掉漆样本共同限制磨损，保留大块可读涂层。
        edge = math_node("MULTIPLY", math_node("MULTIPLY", wear.outputs["Color"], chips.outputs["Fac"]),
                         .85 if painted else .25)
        impact = math_node("MULTIPLY", location.outputs["Y"],
                          math_node("MULTIPLY_ADD", chips.outputs["Fac"], 1.1, .55) if painted else .6)
        chips_signal = math_node("ADD", paint["Red"], math_node("ADD", edge, impact), clamp=True)
        chips_signal = math_node("MULTIPLY", chips_signal, .86 if painted else .30, clamp=True)
        base = mix_color(math_node("MULTIPLY", paint["Blue"], .24), base, (.23, .27, .27))
        base = mix_color(chips_signal, base, (.23, .27, .28))
        metal_signal = mix_scalar(chips_signal, metal_signal, .87)
        rough_signal = mix_scalar(chips_signal, rough_signal, .36)
        streaks = nodes.new("ShaderNodeTexNoise")
        stretch = nodes.new("ShaderNodeVectorMath")
        stretch.operation = "MULTIPLY"
        stretch.inputs[1].default_value = (38, 38, 1.8)
        links.new(surface.outputs["Vector"], stretch.inputs[0])
        links.new(stretch.outputs["Vector"], streaks.inputs["Vector"])
        streaks.inputs["Scale"].default_value = 1
        streaks.inputs["Detail"].default_value = 2
        drip = math_node("MULTIPLY", location.outputs["Z"],
                         math_node("MULTIPLY_ADD", streaks.outputs["Fac"], .6, .4))
        if name in {"ivory", "blue", "edge"}:
            # 按实际检修螺栓位置逐像素计算锈流，避免少量顶点把细锈流插值成整面渐变。
            x, z, height = installation.outputs["X"], installation.outputs["Y"], installation.outputs["Z"]
            side_band = math_node("SUBTRACT", 1, math_node("MULTIPLY",
                                  math_node("ABSOLUTE", math_node("SUBTRACT", math_node("ABSOLUTE", x), 18)), 1.1),
                                  clamp=True)
            below = math_node("SUBTRACT", 19, height)
            fall = math_node("MULTIPLY", math_node("GREATER_THAN", below, 0),
                             math_node("LESS_THAN", below, 5))
            fall = math_node("MULTIPLY", fall, math_node("EXPONENT", math_node("MULTIPLY", below, -.40)))
            for anchor in (-7.0, 3.4):
                distance = math_node("ADD", z, anchor)
                strand = math_node("EXPONENT", math_node("MULTIPLY",
                                   math_node("MULTIPLY", distance, distance), -5.5))
                stripe = math_node("MULTIPLY", side_band, math_node("MULTIPLY", fall, strand))
                drip = math_node("MAXIMUM", drip, math_node("MULTIPLY", stripe, .76))
            roof_height = math_node("MULTIPLY", math_node("GREATER_THAN", height, 30.4),
                                    math_node("LESS_THAN", height, 32.8))
            dx = math_node("SUBTRACT", math_node("ABSOLUTE", x), 11.4)
            for anchor in (-15, -2.5):
                dz = math_node("ADD", z, anchor)
                radius = math_node("ADD", math_node("MULTIPLY", dx, dx), math_node("MULTIPLY", dz, dz))
                stain = math_node("MULTIPLY", roof_height,
                                  math_node("EXPONENT", math_node("MULTIPLY", radius, -1.7)))
                drip = math_node("MAXIMUM", drip, math_node("MULTIPLY", stain, .48))
        # 黄铜不产生铁锈；螺栓、接缝及受伤边缘允许局部氧化。
        abrasion_rust = math_node("MULTIPLY", location.outputs["Y"],
                                 math_node("MULTIPLY", grime["Red"], .32))
        rust_signal = math_node("ADD", paint["Green"], math_node("ADD", abrasion_rust,
                                math_node("ADD", drip, math_node("MULTIPLY", edge, .24))), clamp=True)
        if name == "bronze":
            rust_signal = math_node("MULTIPLY", rust_signal, .10)
        base = mix_color(rust_signal, base, (.37, .17, .070))
        metal_signal = mix_scalar(rust_signal, metal_signal, .01)
        rough_signal = mix_scalar(rust_signal, rough_signal, .88)
    dust_strength = .10 if protected else .22 if name == "glass" else .72
    ground = location.outputs["X"]
    dust = math_node("MULTIPLY", ground, math_node("MULTIPLY_ADD", grime["Red"], .75, .25))
    dust = math_node("MULTIPLY", dust, dust_strength, clamp=True)
    base = mix_color(dust, base, (.30, .255, .175))
    rough_signal = mix_scalar(dust, rough_signal, .91)
    metal_signal = mix_scalar(dust, metal_signal, .015)
    if name in {"frame", "black", "steel", "chrome", "bronze", "rubber", "tread"}:
        oil = math_node("MULTIPLY", ground, grime["Green"])
        oil = math_node("MULTIPLY", oil, .21 if name in {"rubber", "tread"} else .34)
        base = mix_color(oil, base, (.040, .035, .026))
        rough_signal = mix_scalar(oil, rough_signal, .29)
    links.new(base, bsdf.inputs["Base Color"])
    links.new(rough_signal, bsdf.inputs["Roughness"])
    if not isinstance(metal_signal, (float, int)):
        links.new(metal_signal, bsdf.inputs["Metallic"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0 if name=="glass" else .035 if name=="chrome" else .13
    bump.inputs["Distance"].default_value = .025 if name not in {"rubber", "tread"} else .075
    # 生成纹理只贡献受控微浮雕，不把色彩亮暗直接当作大幅几何位移。
    relief = math_node("MULTIPLY_ADD", paint["Blue"], -.35, .35)
    if name in {"rubber", "tread", "black"}:
        relief = math_node("MULTIPLY", grime["Blue"], ground)
    links.new(math_node("ADD", math_node("MULTIPLY", micro.outputs["Fac"], .35), relief), bump.inputs["Height"])
    links.new(bump.outputs[0], bsdf.inputs["Normal"])
    emit = nodes.new("ShaderNodeEmission")
    emit.name = "Bake emission"
    target = nodes.new("ShaderNodeTexImage")
    target.name = "Bake target"
    return mat


def mesh_object(name, vertices, faces, surface, joint, high, bevel=0, smooth=False):
    if "Wheel" in joint:
        origin = joints[joint_ids[joint]]["origin"]
        # 胎体、胎纹及轮毂整体围绕源码轮轴放大，避免大胎沉入地面或悬挂脱离。
        vertices = [(origin[0]+(x-origin[0])*1.03, wheel_y+(y-7)*1.12,
                     origin[2]+(z-origin[2])*1.12) for x,y,z in vertices]
    elif joint == "boom":
        vertices = [(x,y+2,z) for x,y,z in vertices]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([point(p) for p in vertices], [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name + (" · HIGH" if high else " · LOW"), mesh)
    (high_collection if high else low_collection).objects.link(obj)
    select([obj])
    if bevel:
        modifier = obj.modifiers.new("Machined radius", "BEVEL")
        modifier.width = bevel
        modifier.segments = 5 if high else 1
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = .25
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    sites = damage_sites.get(name, [])
    if sites:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=4 if high else 2, use_grid_fill=True)
        for vertex in bm.verts:
            for center, radius, normal, depth in sites:
                at, size, direction = point(center), Vector((radius[0], radius[2], radius[1])), point(normal)
                q = Vector(tuple((vertex.co[i] - at[i]) / size[i] for i in range(3)))
                weight = math.exp(-q.length_squared * 2.7)
                vertex.co -= direction * (depth * weight)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
    for face in obj.data.polygons:
        face.use_smooth = True
    if not smooth:
        modifier = obj.modifiers.new("Face area normals", "WEIGHTED_NORMAL")
        modifier.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    mesh = obj.data
    positions = [vertex.co for vertex in mesh.vertices]
    lower = Vector(tuple(min(v[i] for v in positions) for i in range(3)))
    upper = Vector(tuple(max(v[i] for v in positions) for i in range(3)))
    span = upper - lower
    attr(mesh, "_partCoord", [c for v in positions for c in
                            ((v[i] - lower[i]) / max(.01, span[i]) for i in range(3))])
    # 使用未分离的安装坐标；临时移动烘焙部件不改变积泥高度或纹理尺度。
    salt = int(hashlib.sha256(name.encode()).hexdigest()[:6], 16)
    shift = Vector(((salt % 97) * .137, (salt % 71) * .119, (salt % 59) * .151))
    attr(mesh, "_surfaceCoord", [c for v in positions for c in v / 24 + shift])
    attr(mesh, "_installCoord", [c for v in positions for c in v])
    weather_values = []
    for v in positions:
        dust = max(0, min(1, (20 - v.z) / 17))
        if surface in {"rubber", "tread"}:
            dust = max(.58, dust)
        if surface == "glass":
            dust = max(0, .8 - (v.z - lower.z) / max(.01, span.z) * 3.5)
        impact = max([0] + [math.exp(-sum(((v[i] - point(at)[i]) /
                          (r[0], r[2], r[1])[i]) ** 2 for i in range(3)) * 1.8)
                          for at, r, direction, depth in sites])
        # 检修螺栓下方的短锈流；不是全车竖条纹。
        rust = 0
        if name in {"Access hatch", "Side equipment pod"}:
            for z in (-7.0, 3.4):
                dy = 19.0 - v.z
                if 0 <= dy <= 4:
                    rust = max(rust, .45 * math.exp(-(((-v.y - z) / .65) ** 2) - dy * .45))
        if "fastener" in name.lower() or "bolt" in name.lower() or "lug nuts" in name:
            rust = max(rust, .20)
        weather_values.extend((dust, impact, rust))
    attr(mesh, "_weather", weather_values)
    if not high:
        joint_id = joint_ids[joint]
        attr(mesh, "_skinIndex", [joint_id, 0, 0, 0] * len(positions), 4)
        attr(mesh, "_skinWeight", [1, 0, 0, 0] * len(positions), 4)
    mesh.materials.append(material(surface))
    obj["joint"], obj["surface"] = joint, surface
    obj["slot"] = 1 if surface == "team" else 2 if surface == "lamp" else 0
    return obj


def pair(name, maker, surface="ivory", joint="body", bevel=.12, smooth=False):
    result = []
    for high in (False, True):
        vertices, faces = maker(high)
        result.append(mesh_object(name, vertices, faces, surface, joint, high, bevel, smooth))
    pieces.append(result)
    return result


def box(name, center, size, surface="ivory", joint="body", radius=.12, rotation=(0, 0, 0)):
    x, y, z = size
    from mathutils import Euler
    transform = Euler(rotation, "XYZ").to_matrix()
    vertices = [tuple(Vector(center) + transform @ Vector((a*x/2, b*y/2, c*z/2)))
                for a, b, c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                                (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]
    return pair(name, lambda high: (vertices, faces), surface, joint, radius)


def extrusion(name, profile, center_x, width, surface="ivory", joint="body", radius=.12):
    # profile 的每一点是 (前后 z, 高度 y)，用于舱体、臂板和侧窗。
    count = len(profile)
    vertices = [(x, y, z) for x in (center_x-width/2, center_x+width/2) for z, y in profile]
    faces = [tuple(reversed(range(count))), tuple(count+i for i in range(count))]
    faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    return pair(name, lambda high: (vertices, faces), surface, joint, radius)


def cylinder(name, start, end, radius, surface="steel", joint="body", bevel=.08, sides=24):
    start, end = Vector(start), Vector(end)
    axis = (end - start).normalized()
    cross = axis.cross(Vector((0, 1, 0)) if abs(axis.y) < .9 else Vector((1, 0, 0))).normalized()
    other = axis.cross(cross)
    def maker(high):
        count = sides * 2 if high else sides
        vertices = [tuple(at + (math.cos(i*math.tau/count)*cross +
                               math.sin(i*math.tau/count)*other)*radius)
                    for at in (start,end) for i in range(count)]
        faces = [tuple(reversed(range(count))),tuple(count+i for i in range(count))]
        faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
        return vertices, faces
    return pair(name, maker, surface, joint, bevel)


def ring(name, center, major, minor, surface="steel", joint="body", axis="x", arc=math.tau):
    def maker(high):
        count, tube = (64, 12) if high else (32, 6)
        vertices, faces = [], []
        for i in range(count+1):
            angle = i * arc / count
            for j in range(tube):
                radial = major + minor*math.cos(j*math.tau/tube)
                axial = minor*math.sin(j*math.tau/tube)
                local = (axial,math.cos(angle)*radial,math.sin(angle)*radial) if axis=="x" else (
                    math.cos(angle)*radial,math.sin(angle)*radial,axial)
                vertices.append(tuple(Vector(center)+Vector(local)))
        for i in range(count):
            for j in range(tube):
                a, b = i*tube+j, i*tube+(j+1)%tube
                faces.append((a,b,b+tube,a+tube))
        faces += [tuple(reversed(range(tube))),tuple(count*tube+j for j in range(tube))]
        return vertices, faces
    return pair(name, maker, surface, joint, 0, True)


def cable(name, path, radius=.18, surface="black", joint="body"):
    points = [Vector(p) for p in path]
    def maker(high):
        count = 12 if high else 6
        vertices, faces = [], []
        for i, at in enumerate(points):
            axis = (points[min(len(points)-1,i+1)] - points[max(0,i-1)]).normalized()
            cross = axis.cross(Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))).normalized()
            other = axis.cross(cross)
            for j in range(count):
                vertices.append(tuple(at+(cross*math.cos(j*math.tau/count)+other*math.sin(j*math.tau/count))*radius))
        for i in range(len(points)-1):
            for j in range(count):
                a,b=i*count+j,i*count+(j+1)%count
                faces.append((a,b,b+count,a+count))
        faces += [tuple(reversed(range(count))),tuple((len(points)-1)*count+j for j in range(count))]
        return vertices, faces
    return pair(name,maker,surface,joint,0,True)


def bolts(name, locations, radius=.29, joint="body", axis="y", surface="steel"):
    # 一组螺栓作为一个投射部件，避免为每个螺钉生成单独烘焙材质。
    def maker(high):
        vertices, faces = [], []
        sides = 12 if high else 6
        for center in locations:
            offset = len(vertices)
            for depth in (0,.24):
                for i in range(sides):
                    u,v=math.cos(i*math.tau/sides)*radius,math.sin(i*math.tau/sides)*radius
                    p = (depth,u,v) if axis=="x" else (u,v,depth) if axis=="z" else (u,depth,v)
                    vertices.append(tuple(Vector(center)+Vector(p)))
            faces += [tuple(offset+i for i in reversed(range(sides))),
                      tuple(offset+sides+i for i in range(sides))]
            faces += [(offset+i,offset+(i+1)%sides,offset+(i+1)%sides+sides,offset+i+sides)
                      for i in range(sides)]
        return vertices, faces
    return pair(name,maker,surface,joint,.025)


def tire(side, z, joint):
    x = side * 16.64
    profile = [(-4.2,3.45),(-4.35,4.1),(-4.1,5.8),(-3.5,6.85),(-2.4,7.25),
               (0,7.35),(2.4,7.25),(3.5,6.85),(4.1,5.8),(4.35,4.1),(4.2,3.45)]
    def maker(high):
        count = 128 if high else 64
        vertices, faces = [], []
        for axial, radius in profile:
            for i in range(count):
                a=i*math.tau/count
                vertices.append((x+axial,7+math.cos(a)*radius,z+math.sin(a)*radius))
        for row in range(len(profile)-1):
            for i in range(count):
                a,b=row*count+i,row*count+(i+1)%count
                faces.append((a,b,b+count,a+count))
        for i in range(count):
            a,b=i,(i+1)%count
            c,d=(len(profile)-1)*count+i,(len(profile)-1)*count+(i+1)%count
            faces.append((b,a,c,d))
        return vertices, faces
    pair(joint+" / rounded carcass",maker,"rubber",joint,0,True)
    # 32 排交错横向花纹块；肩部胎纹和中央沟槽均保留实体轮廓。
    def tread_maker(high):
        vertices,faces=[],[]
        for i in range(32):
            for column in (-1,0,1):
                a=(i+(column%2)*.26)*math.tau/32
                radius = 7.35 - abs(column)*.36
                c=Vector((x+column*2.55,7+math.cos(a)*radius,z+math.sin(a)*radius))
                axial=Vector((1,0,0)); radial=Vector((0,math.cos(a),math.sin(a)))
                tangent=Vector((0,-math.sin(a),math.cos(a)))
                offset=len(vertices)
                for u,v,w in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                              (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
                    vertices.append(tuple(c+axial*(u*1.14+w*.19*column)+radial*(v*.29)+tangent*(w*.54)))
                faces.extend(tuple(offset+j for j in f) for f in
                             [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)])
        return vertices,faces
    pair(joint+" / staggered tread",tread_maker,"tread",joint,.08)
    outside=x+side*4.2
    for radius in (4.55,5.6):
        ring(joint+" / molded sidewall ridge",(outside-side*.12,7,z),radius,.07,"rubber",joint)
    def sidewall_maker(high):
        vertices,faces=[],[]
        for i in range(24):
            a=i*math.tau/24
            radial=Vector((0,math.cos(a),math.sin(a)))
            tangent=Vector((0,-math.sin(a),math.cos(a)))
            center=Vector((outside-side*.34,7,z))+radial*5.94
            offset=len(vertices)
            for u,v,w in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                          (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:
                vertices.append(tuple(center+Vector((u*.055,0,0))+radial*v*.41+tangent*w*.09))
            faces.extend(tuple(offset+j for j in f) for f in
                         [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)])
        return vertices,faces
    pair(joint+" / shoulder mold ribs",sidewall_maker,"tread",joint,.025)
    cylinder(joint+" / rim", (outside-side*.6,7,z),(outside+side*.25,7,z),3.90,"frame",joint,.12,40)
    ring(joint+" / bead", (outside+side*.26,7,z),3.88,.19,"steel",joint)
    cylinder(joint+" / dished wheel", (outside+side*.30,7,z),(outside+side*.55,7,z),3.35,"blue",joint,.1,32)
    cylinder(joint+" / hub", (outside+side*.48,7,z),(outside+side*1.06,7,z),1.87,"edge",joint,.16,24)
    ring(joint+" / hub gasket",(outside+side*.62,7,z),2.03,.10,"black",joint)
    bolts(joint+" / lug nuts",[(outside+side*.72,7+math.cos(i*math.tau/8)*2.66,
                              z+math.sin(i*math.tau/8)*2.66) for i in range(8)],.31,joint,"x")
    # 金属轮毂的减重孔采用实际深色嵌件，而非平面颜色点。
    for i in range(8):
        a=(i+.5)*math.tau/8
        cylinder(joint+" / vent %02d"%i,(outside+side*.53,7+math.cos(a)*2.92,z+math.sin(a)*2.92),
                 (outside+side*.60,7+math.cos(a)*2.92,z+math.sin(a)*2.92),.27,"black",joint,0,12)


def fender(side, z):
    def maker(high):
        count=48 if high else 20
        vertices,faces=[],[]
        for x in (side*16.64-5.1,side*16.64+5.1):
            for radius in (9.20,10.0):
                for i in range(count+1):
                    a=-1.16+2.32*i/count
                    vertices.append((x,wheel_y+math.cos(a)*radius,z+math.sin(a)*radius))
        n=count+1
        for i in range(count):
            for a,b in ((0,n),(n,3*n),(3*n,2*n),(2*n,0)):
                faces.append((a+i,a+i+1,b+i+1,b+i))
        faces += [(0,n,3*n,2*n),(count,n+count,3*n+count,2*n+count)]
        return vertices,faces
    pair(("L" if side<0 else "R")+f" / fender {z}",maker,"ivory","body",.10)
    box("Fender split end",(side*16.64,wheel_y+5.0,z+9),(10.3,1.3,1.1),"edge",radius=.15)
    bolts("Fender mounting bolts",[(side*16.64+u,wheel_y+9.45,z+v) for u in (-3.9,3.9) for v in (-2.1,2.1)],
          radius=.25)


def text(name, value, location, size, rotation=(math.pi/2,0,0), surface="edge", joint="body"):
    # 字体转为实体并进入同一套 UV/烘焙；不依赖浏览器字体或运行时文字贴片。
    result=[]
    for high in (False,True):
        curve=bpy.data.curves.new(name,"FONT")
        curve.body=value;curve.size=size;curve.align_x="CENTER"
        curve.extrude=.008;curve.resolution_u=2
        obj=bpy.data.objects.new(name,curve)
        (high_collection if high else low_collection).objects.link(obj)
        obj.location=point(location);obj.rotation_euler=rotation
        select([obj]);bpy.ops.object.convert(target="MESH")
        obj=bpy.context.object
        obj.data.transform(obj.matrix_world);obj.matrix_world=Matrix.Identity(4)
        obj.data.materials.append(material(surface))
        values=[v.co for v in obj.data.vertices]
        attr(obj.data,"_partCoord",[c for v in values for c in v],3)
        attr(obj.data,"_surfaceCoord",[c for v in values for c in v / 24],3)
        attr(obj.data,"_installCoord",[c for v in values for c in v],3)
        attr(obj.data,"_weather",[0,0,0]*len(values),3)
        if not high:
            attr(obj.data,"_skinIndex",[joint_ids[joint],0,0,0]*len(values),4)
            attr(obj.data,"_skinWeight",[1,0,0,0]*len(values),4)
        obj["slot"]=0;obj["joint"]=joint;obj["surface"]=surface
        result.append(obj)
    pieces.append(result)


def build():
    log("FORM / chassis, cabin, articulated loader, four pneumatic wheels")
    box("Main ladder frame",(0,7.8,0),(27,5,43),"frame","chassis",.55)
    box("Lower sump",(0,4.2,-1),(19,3.0,28),"black","chassis",.35)
    for z in (-15,15):
        cylinder("Axle / differential",(-16.3,wheel_y,z),(16.3,wheel_y,z),1.35,"steel","chassis",.08)
        cylinder("Differential casing",(0,wheel_y,z-2),(0,wheel_y,z+2),2.7,"frame","chassis",.18)
    for side in (-1,1):
        for z in (-15,15):
            tire(side,z,("L" if side<0 else "R")+"Wheel"+("0" if z<0 else "1"))
            fender(side,z)
            cylinder("Suspension strut",(side*11.3,8.0,z),(side*13.1,12.5,z-2),.66,"chrome","chassis",.04)
        box("Side step",(side*15,7,-1),(6.0,1.1,15),"frame","chassis",.15)
        for z in (-6,-3,0,3,6):
            box("Anti-slip step",(side*15,7.65,z),(5.4,.17,.7),"steel","chassis",.035)
    extrusion("Load bearing monocoque",[(-22,10),(-22,17.2),(-16,20),(2,20),(6,16),
              (12,12.5),(23,12.5),(23,10)],0,30,"blue",radius=.5)
    box("Central hydraulic service deck",(0,16.5,10),(8.5,1.6,12),"frame",radius=.25)
    for z in (7.0,9.1,11.2,13.3):
        box("Service deck cooling louvre",(0,17.4,z),(6.8,.4,.68),"steel",radius=.07)
    bolts("Service deck captive fasteners",[(x,17.4,z) for x in (-3.7,3.7) for z in (5.5,14.5)],.26)
    extrusion("Cab / structural shell",[(-18,20.5),(-18,28.0),(-14,30.3),(-2.8,30.3),
              (6.3,21.2)],0,25,"ivory",radius=.3)
    # 独立斜面风挡，较厚密封胶条和四边白色框架。
    # 风挡与降低后的舱体前面保持同一斜率，密封条整体略向外偏移。
    slope=-math.pi/4
    center=Vector((0,25.8,1.95))
    from mathutils import Euler
    transform=Euler((slope,0,0)).to_matrix()
    def wind_at(x,y,z=.25):
        return tuple(center+transform@Vector((x,y,z)))
    box("Windshield gasket",wind_at(0,0,0),(23.6,9.9,.44),"black",radius=.18,rotation=(slope,0,0))
    box("Windshield glass",wind_at(0,0,.27),(21.4,8.1,.20),"glass",radius=.10,rotation=(slope,0,0))
    for x in (-11.3,11.3):
        box("A pillar",wind_at(x,0,.45),(1.35,10.15,.8),"edge",radius=.15,rotation=(slope,0,0))
    for y in (-4.8,4.8):
        box("Windshield cross member",wind_at(0,y,.45),(24.6,1.15,.8),"edge",radius=.13,rotation=(slope,0,0))
    # 驾驶舱里保留仪表板和两席；侧窗为不透明实时玻璃，避免引入排序问题。
    box("Roof / overhang",(0,31.45,-8.7),(26.2,1.6,18.2),"edge",radius=.35)
    box("Roof sunken panel",(0,32.36,-8.6),(21.8,.22,13.9),"hazard",radius=.12)
    bolts("Roof latches",[(x,32.46,z) for x in (-11.4,11.4) for z in (-15,-2.5)],.36)
    for side in (-1,1):
        side_profile=[(-14.9,23),(-14.9,28.8),(-4.25,28.8),(2.05,23)]
        extrusion("Side window seal",side_profile,side*12.54,.30,"black",radius=.13)
        extrusion("Side glass",[(-13.9,24),(-13.9,27.8),(-4.9,27.8),(.32,24)],
                  side*12.74,.16,"glass",radius=.09)
        box("Window rear mullion",(side*12.96,25.9,-10),(0.42,5.4,.72),"edge",radius=.09)
        extrusion("Side equipment pod",[(-11,13.5),(-11,18.9),(-8,21),(5,21),(9,17),(9,13.5)],
                  side*15.55,4.2,"ivory",radius=.24)
        extrusion("Access hatch",[(-7.8,14.6),(-7.8,18.7),(-5.6,19.6),(3.5,19.6),(5.9,17.3),
                  (5.9,14.6)],side*17.8,.22,"blue",radius=.12)
        box("Side hatch catch",(side*18.02,18.4,-5.2),(.32,.55,2.2),"steel",radius=.045)
        for z in (-1.7,.35,2.4):
            box("Team diagonal",(side*18.04,16.9,z),(.21,3.4,.95),"team",radius=.025,rotation=(.28,0,0))
        bolts("Side hatch fasteners",[(side*18.04,y,z) for y in (15.1,19.0) for z in (-7.0,3.4)],
              .24,axis="x")
        if side == 1:
            text("Side / fleet designation","EW 04",(18.05,19.55,-2.7),.79,
                 rotation=(math.pi/2,0,math.pi/2),surface="frame")
        box("Rear cabin intake",(side*12.9,25.9,-16.35),(.3,4.7,2.6),"black",radius=.08)
        for y in (24.2,25.2,26.2,27.2):
            box("Cabin intake louvre",(side*13.1,y,-16.35),(.4,.30,2.3),"steel",radius=.04)
        cable("Side grab rail",[(side*13.9,21,-14),(side*14.6,22,-14),(side*14.6,27.5,-14),
              (side*13.9,28.5,-14)],.22,"steel")
        box("Rear canister bracket",(side*14.1,19,-21.0),(6.9,1.4,3.9),"frame",radius=.12)
        cylinder("Bronze pressure canister",(side*14.1,19.6,-22.9),(side*14.1,19.6,-18.5),
                 3.0,"bronze",bevel=.22,sides=32)
        for z in (-22.2,-19.4):
            ring("Canister steel band",(side*14.1,19.6,z),3.03,.19,"steel",axis="z")
        cylinder("Pressure canister cap",(side*14.1,19.6,-23.2),(side*14.1,19.6,-22.85),
                 2.24,"frame",bevel=.1)
        cable("Rear pressure hose",[(side*12.6,20.7,-21),(side*10.8,21.3,-22),
              (side*9.5,18.9,-23),(side*9.6,17.5,-21)],.22)
    box("Rear engine vent bed",(0,22.2,-19.8),(15,1.0,5.4),"black",radius=.16)
    for x in range(-6,7,2):
        box("Engine cooling fin",(x,22.85,-19.8),(.64,.55,4.8),"steel",radius=.055)
    box("Rear cabin access gasket",(0,25.6,-18.22),(20.4,6.2,.35),"black",radius=.12)
    box("Rear cabin service hatch",(0,25.6,-18.45),(19.4,5.2,.35),"blue",radius=.14)
    box("Rear hatch vent recess",(0,26.4,-18.69),(14.0,3.2,.18),"black",radius=.08)
    for y in (25.3,26.05,26.8,27.55):
        box("Rear hatch louvre",(0,y,-18.84),(13.2,.34,.26),"steel",radius=.05)
    for x in (-8.1,8.1):
        box("Rear hatch hinge",(x,25.0,-18.80),(1.05,2.5,.38),"steel",radius=.08)
    bolts("Rear hatch screws",[(x,y,-18.75) for x in (-8.3,8.3) for y in (23.6,27.8)],
          .24,axis="z")
    box("Rear towing bumper",(0,7.8,-24.0),(28,3.2,2.6),"frame",radius=.30)
    for side in (-1,1):
        ring("Rear tow loop",(side*8.7,8,-25.7),1.0,.27,"steel",axis="z")
        box("Rear brake light",(side*11.7,13.0,-23.7),(2.6,1.1,.5),"red",radius=.14)
    # 固定防撞框架与可活动采集头分开，灯位在液压臂下方。
    box("Front grille recess",(0,9.8,23.3),(22.6,6.5,1.8),"black",radius=.26)
    for y in (7.4,8.8,10.2,11.6):
        box("Front grille slat",(0,y,24.43),(20,.58,.48),"steel",radius=.07)
    cable("Continuous front bull bar",[(-12.6,6.4,24.9),(-13.7,7.2,24.9),(-13.7,13.7,24.9),
          (-12.6,14.7,24.9),(-9.7,14.6,24.6),(-6.8,14.3,24.45),(-4.8,14.7,24.9),
          (12.6,14.7,24.9),(13.7,13.7,24.9),(13.7,7.2,24.9),
          (12.6,6.4,24.9),(-12.6,6.4,24.9)],.59,"steel")
    box("Front lamp deck",(0,15.35,22.9),(26.8,3.3,3.1),"blue",radius=.35)
    for side in (-1,1):
        box("Headlamp bezel",(side*10.3,15.4,24.7),(4.9,3.0,.82),"black",radius=.22)
        box("Headlamp inset",(side*10.3,15.4,25.19),(3.75,2.02,.23),"lamp",radius=.15)
        for x in (-.85,0,.85):
            box("Headlamp lens bar",(side*10.3+x,15.4,25.34),(.06,1.8,.06),"edge",radius=.015)
        # 臂的静止转轴与游戏 boom 原点一致，所有臂板、油缸和管线刚性归属于 boom。
        cylinder("Loader fixed bearing",(side*4.7,20.4,7),(side*9.2,20.4,7),
                 2.75,"frame",bevel=.14,sides=32)
        ring("Loader fixed bearing collar",(side*9.24,20.4,7),2.12,.22,"bronze")
        extrusion("Forged loader arm",[(4.9,17),(5.7,21.5),(9.6,22),(21.1,19.9),
                  (25.4,18.0),(25.4,15.4),(21.6,16),(9.3,18.8),(7.4,16.5)],
                  side*7,4.2,"yellow","boom",.29)
        extrusion("Loader arm inset",[(8.0,19.9),(9.6,20.8),(21,18.8),(22.6,17.4),
                  (20.4,17.5),(10,19.5)],side*9.15,.18,"bronze","boom",.07)
        cylinder("Loader pivot pin",(side*8.75,18.4,7),(side*9.42,18.4,7),1.43,"steel","boom",.13,32)
        cylinder("Loader pin cap",(side*9.38,18.4,7),(side*9.64,18.4,7),.81,"bronze","boom",.065,24)
        cylinder("Hydraulic barrel",(side*10,15.5,9.4),(side*10,17.3,17.1),
                 .89,"frame","boom",.10,24)
        cylinder("Hydraulic polished rod",(side*10,17.1,16.7),(side*10,18.2,22.1),
                 .49,"chrome","boom",.04,24)
        cylinder("Hydraulic rod eye",(side*9.15,18.4,22.1),(side*10.80,18.4,22.1),
                 .88,"steel","boom",.08)
        cable("Loader hydraulic hose",[(side*9.1,18.8,7.4),(side*10.9,19.0,8.6),
              (side*11.4,18.7,11.0),(side*11.15,17.6,13.5),(side*10.7,16.9,14.1)],
              .18,"black","boom")
        bolts("Loader maintenance caps",[(side*8.82,18.4,z) for z in (9.5,20.5)],.28,"boom","x")
        box("Tool telescoping guide",(side*7,15.3,25.3),(2.7,1.3,5.2),"frame","boom",.13)
        box("Tool telescoping runner",(side*7,17.3,25.9),(1.7,.6,3.9),"chrome","tool",.08)
    box("Tool / cross beam",(0,17.4,27.4),(18.6,3.5,4.3),"frame","tool",.26)
    box("Tool / cutting lip",(0,15.35,29.5),(18.5,.7,1.8),"steel","tool",.14)
    for side in (-1,1):
        grip="LGrip" if side<0 else "RGrip"
        extrusion("Gripping tine",[(30.2,17.5),(33.4,16.1),(34.6,13.2),(33.9,12.4),
                  (32,14.1),(30.2,14.3)],side*6,2.8,"steel",grip,.19)
        cylinder("Tool knuckle",(side*4.7,18.4,25.4),(side*7.3,18.4,25.4),
                 1.30,"bronze","tool",.1,24)
    box("Front serial plaque",(0,13.2,25.58),(9.7,1.55,.25),"frame",radius=.06)
    text("Serial / EW-04","EW-04",(0,12.66,25.76),1.05,surface="edge")
    # 单条偏心雨刷与折弯臂，避免对称装饰遮住玻璃。
    w1=wind_at(-6,-3,.46);w2=wind_at(-1,-1.5,.52);w3=wind_at(5,-2.2,.52)
    cylinder("Wiper arm",w1,w2,.11,"black",bevel=.015,sides=8)
    cylinder("Wiper blade",w2,w3,.16,"black",bevel=.025,sides=8)
    box("Roof beacon base",(8.9,32.7,-12),(2.2,.45,2.2),"frame",radius=.1)
    cylinder("Amber work beacon",(8.9,32.9,-12),(8.9,34,-12),.77,"yellow",bevel=.13,sides=20)
    cable("Short whip antenna",[(-9.4,32.4,-14),(-9.6,34.9,-14.2),(-10.0,37.4,-14.7)],
          .09,"black")
    log(f"FORM READY / {len(pieces)} semantic assemblies")


def join(objects, name):
    select(objects)
    bpy.ops.object.join()
    obj=bpy.context.object
    obj.name=name
    return obj


def image(channel):
    value=(.5,.5,1,1) if channel=="normal" else (1,1,1,1)
    img=bpy.data.images.new("Worker bake "+channel,args.resolution,args.resolution,alpha=False)
    img.generated_color=value
    if channel!="albedo":
        img.colorspace_settings.name="Non-Color"
    return img


def pixels(img):
    data=np.empty(args.resolution**2*4,dtype=np.float32)
    img.pixels.foreach_get(data)
    return data.reshape(args.resolution,args.resolution,4)


def bake(low,high,channel,target,projected=True):
    select([high,low] if projected else [low],low)
    saved=[]
    for mat in set(low.data.materials)|set(high.data.materials):
        nodes,links=mat.node_tree.nodes,mat.node_tree.links
        bsdf,output,emit=nodes.get("Principled BSDF"),nodes.get("Material Output"),nodes["Bake emission"]
        saved.append((mat,output.inputs["Surface"].links[0].from_socket))
        nodes["Bake target"].image=target;nodes.active=nodes["Bake target"]
        for link in list(emit.inputs["Color"].links):
            links.remove(link)
        if channel=="albedo":
            links.new(bsdf.inputs["Base Color"].links[0].from_socket,emit.inputs["Color"])
        elif channel in {"roughness", "metalness"}:
            socket = bsdf.inputs["Roughness" if channel == "roughness" else "Metallic"]
            if socket.is_linked:
                links.new(socket.links[0].from_socket, emit.inputs["Color"])
            else:
                emit.inputs["Color"].default_value = (socket.default_value,)*3+(1,)
        else:
            emit.inputs["Color"].default_value=(mat["metalness"],)*3+(1,)
        links.new(bsdf.outputs[0] if channel in {"normal","ao"} else emit.outputs[0],output.inputs["Surface"])
    scene.render.bake.use_selected_to_active=projected
    scene.render.bake.use_cage=False
    try:
        bpy.ops.object.bake(type={"normal":"NORMAL","ao":"AO"}.get(channel,"EMIT"),normal_space="TANGENT")
        return pixels(target)
    finally:
        for mat,socket in saved:
            mat.node_tree.links.new(socket,mat.node_tree.nodes.get("Material Output").inputs["Surface"])


def coverage(low):
    target=image("coverage")
    select([low])
    saved=[]
    margin=scene.render.bake.margin
    scene.render.bake.margin=0
    scene.render.bake.use_selected_to_active=False
    for mat in set(low.data.materials):
        nodes,links=mat.node_tree.nodes,mat.node_tree.links
        output=nodes.get("Material Output")
        saved.append((mat,output.inputs["Surface"].links[0].from_socket))
        emit=nodes["Bake emission"]
        for link in list(emit.inputs["Color"].links):
            links.remove(link)
        emit.inputs["Color"].default_value=(1,1,1,1)
        links.new(emit.outputs[0],output.inputs["Surface"])
        nodes["Bake target"].image=target;nodes.active=nodes["Bake target"]
    bpy.ops.object.bake(type="EMIT")
    data=pixels(target)[:,:,0]>.999
    for mat,socket in saved:
        mat.node_tree.links.new(socket,mat.node_tree.nodes.get("Material Output").inputs["Surface"])
    scene.render.bake.margin=margin
    bpy.data.images.remove(target)
    return data


def baked_material(images,slot):
    mat=bpy.data.materials.new("GAME PBR / "+str(slot));mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    bsdf=nodes.get("Principled BSDF")
    for channel in ("albedo","normal","orm"):
        texture=nodes.new("ShaderNodeTexImage");texture.image=images[channel]
        if channel=="albedo":
            socket=texture.outputs[0]
            if slot==1:
                tint=nodes.new("ShaderNodeMixRGB");tint.blend_type="MULTIPLY"
                tint.inputs[0].default_value=1;tint.inputs[2].default_value=(.17,.35,.09,1)
                links.new(socket,tint.inputs[1]);socket=tint.outputs[0]
            links.new(socket,bsdf.inputs["Base Color"])
        elif channel=="normal":
            normal=nodes.new("ShaderNodeNormalMap")
            links.new(texture.outputs[0],normal.inputs[1]);links.new(normal.outputs[0],bsdf.inputs["Normal"])
        else:
            split=nodes.new("ShaderNodeSeparateColor")
            links.new(texture.outputs[0],split.inputs[0])
            links.new(split.outputs["Green"],bsdf.inputs["Roughness"])
            links.new(split.outputs["Blue"],bsdf.inputs["Metallic"])
            multiply=nodes.new("ShaderNodeMixRGB");multiply.blend_type="MULTIPLY"
            multiply.inputs[0].default_value=.55
            links.new(bsdf.inputs["Base Color"].links[0].from_socket,multiply.inputs[1])
            links.new(split.outputs["Red"],multiply.inputs[2]);links.new(multiply.outputs[0],bsdf.inputs["Base Color"])
    if slot==2:
        bsdf.inputs["Emission Color"].default_value=(.15,.5,.8,1)
        bsdf.inputs["Emission Strength"].default_value=1.8
    return mat


def render(objects,name,view=(1.35,-1.8,1.25),resolution=1200):
    bpy.context.view_layer.update()
    points=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
    lo=Vector(tuple(min(v[i] for v in points) for i in range(3)))
    hi=Vector(tuple(max(v[i] for v in points) for i in range(3)))
    center=(lo+hi)/2
    extent=max(hi-lo)
    # 不以细天线确定视觉主体中心，避免大块留白。
    center.z-=1.5
    bpy.ops.object.camera_add(location=center+Vector(view)*extent)
    camera=bpy.context.object
    camera.rotation_euler=(center-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.type="ORTHO";camera.data.ortho_scale=extent*1.25
    scene.camera=camera
    lights=[]
    for offset,power,color in [((-1,-1.5,2),1200,(1,.89,.75)),((1,.7,1.6),950,(.64,.81,1)),
                              ((1.8,-.7,.8),350,(1,.95,.87))]:
        bpy.ops.object.light_add(type="AREA",location=center+Vector(offset)*extent)
        light=bpy.context.object
        light.data.energy=power*extent**2/10;light.data.shape="DISK";light.data.size=extent*1.15
        light.data.color=color;light.rotation_euler=(center-light.location).to_track_quat("-Z","Y").to_euler()
        lights.append(light)
    scene.render.resolution_x=scene.render.resolution_y=resolution
    scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.cycles.samples=48
    scene.render.filepath=str(directory/(name+".png"))
    bpy.ops.render.render(write_still=True)
    for obj in [camera,*lights]:
        bpy.data.objects.remove(obj,do_unlink=True)
    scene.cycles.samples=16


def run():
    started=time.time()
    build()
    lows=[pair[0] for pair in pieces];highs=[pair[1] for pair in pieces]
    if args.preview_only:
        for obj in highs:obj.hide_render=True
        render(lows,"form-preview")
        return
    # 每个结构单独分离后投射，轮胎、螺栓组保留内部接触。
    for i,(low,high) in enumerate(pieces):
        offset=Vector((i*150,0,0))
        for obj in (low,high):
            attr(obj.data,"_bakeOffset",list(offset)*len(obj.data.vertices))
            obj.data.transform(Matrix.Translation(offset))
        mat=low.data.materials[0].copy()
        mat["slot"]=low["slot"]
        low.data.materials[0]=mat
    low=join(lows,"Worker · UV LOW")
    high=join(highs,"Worker · HIGH / editable surface")
    select([low]);bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.25,island_margin=.0002,area_weight=1,scale_to_bounds=True)
    bpy.ops.uv.pack_islands(rotate=True,scale=True,margin_method="FRACTION",margin=.0015,
                           shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    targets={channel:image(channel) for channel in ("albedo","normal","ao","roughness","metalness")}
    scene.render.bake.cage_extrusion=.7
    scene.render.bake.max_ray_distance=1.8
    mask=coverage(low)
    results={}
    for channel in ("albedo","normal","roughness","metalness"):
        log("BAKE / "+channel)
        results[channel]=bake(low,high,channel,targets[channel])
    normals=results["normal"]
    length=np.linalg.norm(normals[:,:,:3]*2-1,axis=2)
    backfacing_normal = normals[:,:,2]<.5
    invalid_normal=(length<.05)|(length>1.25)|backfacing_normal
    invalid_material=(np.max(results["albedo"][:,:,:3],axis=2)<1e-6)|(results["roughness"][:,:,0]<.01)
    invalid=invalid_normal|invalid_material
    missed=int(np.count_nonzero(mask&invalid))
    covered=int(np.count_nonzero(mask))
    if covered==0 or missed/covered>.05:
        raise ValueError(f"Insufficient high-to-low coverage: {missed}/{covered}")
    for obj in (low,high):
        offsets=obj.data.attributes["_bakeOffset"]
        for vertex in obj.data.vertices:
            vertex.co-=offsets.data[vertex.index].vector
    log("BAKE / assembled ambient occlusion")
    results["ao"]=bake(low,high,"ao",targets["ao"])
    if missed:
        high.hide_render=True
        for channel in results:
            fallback=bake(low,high,channel,targets[channel],False)
            results[channel][invalid]=fallback[invalid]
    normals=results["normal"]
    length=np.linalg.norm(normals[:,:,:3]*2-1,axis=2)
    neutral=(length<.05)|(length>1.25)|(normals[:,:,2]<.5)
    neutral_count=int(np.count_nonzero(mask&neutral))
    if neutral_count>missed:
        raise ValueError("Fallback normal quality regressed")
    normals[neutral]=(.5,.5,1,1)
    orm=np.ones_like(normals)
    orm[:,:,0]=results["ao"][:,:,0]
    orm[:,:,1]=results["roughness"][:,:,0]
    orm[:,:,2]=results["metalness"][:,:,0]
    images={}
    for channel,data in {"albedo":results["albedo"],"normal":normals,"orm":orm}.items():
        img=targets.get(channel) or image(channel)
        img.pixels.foreach_set(data.ravel())
        img.filepath_raw=str(directory/("worker-"+channel+".png"));img.file_format="PNG"
        img.save();img.pack();images[channel]=img
    low_count,high_count=len(low.data.polygons),len(high.data.polygons)
    objects=[]
    for slot in range(3):
        obj=low.copy();obj.data=low.data.copy();low_collection.objects.link(obj)
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if obj.data.materials[f.material_index]["slot"]!=slot],context="FACES")
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context="VERTS")
        bm.to_mesh(obj.data);bm.free()
        for name in ("_partCoord","_surfaceCoord","_installCoord","_weather","_bakeOffset"):
            obj.data.attributes.remove(obj.data.attributes[name])
        obj.data.materials.clear();obj.data.materials.append(baked_material(images,slot))
        for face in obj.data.polygons:face.material_index=0
        obj.name=f"industrial:worker|-1|{slot}"
        for key in list(obj.keys()):del obj[key]
        obj["key"]="industrial:worker";obj["part"]=-1;obj["slot"]=slot
        objects.append(obj)
    bpy.data.objects.remove(low,do_unlink=True)
    high.hide_render=True;high.hide_set(True)
    select(objects)
    bpy.ops.export_scene.gltf(filepath=str(directory/"worker.glb"),export_format="GLB",use_selection=True,
                             export_attributes=True,export_extras=True,export_materials="NONE",
                             export_vertex_color="NONE",export_cameras=False,export_lights=False,
                             export_meshopt_compression_enable=True,export_meshopt_extension="EXT_meshopt_compression")
    points=[v.co for obj in objects for v in obj.data.vertices]
    bounds=[[min(v.x for v in points),min(v.z for v in points),min(-v.y for v in points)],
            [max(v.x for v in points),max(v.z for v in points),max(-v.y for v in points)]]
    template["bounds"]=bounds;template["surface"]="worker"
    report={
        "key":"industrial:worker","generator":"scripts/build-worker-hero.py","scriptHash":script_hash,
        "tile":[0,0],"tileSize":args.resolution,"lowFaces":low_count,"highFaces":high_count,
        "assemblies":len(pieces),"template":template,
        "textureSources": texture_sources,
        "weathering": {"mapping": "24 world units / triplanar image masks",
                       "sourceCropBottom": .12, "maskResolution": 1536,
                       "damageSites": damage_sites, "bentFrontBullBar": True,
                       "sharedSignals": ["albedo", "roughness", "metalness", "microNormal"]},
        "projection":{"cageExtrusion":.7,"maxRayDistance":1.8,"uvPixels":covered,
                      "missedNormalPixels":int(np.count_nonzero(mask&invalid_normal)),
                      "backfacingNormalPixels":int(np.count_nonzero(mask&backfacing_normal)),
                      "missedMaterialPixels":int(np.count_nonzero(mask&invalid_material)),
                      "missedProjectionPixels":missed,"lowSurfaceFallbackPixels":missed,
                      "neutralNormalPixels":neutral_count},
    }
    (directory/"worker-bake.json").write_text(json.dumps([report],indent=2)+"\n")
    log(f"BAKE READY / low={low_count} high={high_count} coverage={1-missed/covered:.3%}")
    render(objects,"worker-front")
    render(objects,"worker-rear",(-1.35,1.8,1.25))
    render(objects,"worker-game-scale",resolution=256)
    # 高模和低模分属集合；游戏只加载三个合批低模。
    armature_data=bpy.data.armatures.new("Worker / game bone contract")
    rig=bpy.data.objects.new("Worker / EDITABLE RIG",armature_data)
    scene.collection.objects.link(rig);select([rig]);bpy.ops.object.mode_set(mode="EDIT")
    bones=[]
    for joint in joints:
        bone=armature_data.edit_bones.new(joint["name"]);bone.head=point(joint["origin"])
        bone.tail=bone.head+Vector((0,0,2))
        if joint["parent"]>=0:bone.parent=bones[joint["parent"]]
        bones.append(bone)
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in objects:
        obj.parent=rig
        indices=obj.data.attributes["_skinIndex"]
        for i,joint in enumerate(joints):
            group=obj.vertex_groups.new(name=joint["name"])
            vertices=[v.index for v in obj.data.vertices if round(indices.data[v.index].color[0])==i]
            if vertices:group.add(vertices,1,"REPLACE")
        modifier=obj.modifiers.new("Rigid game articulation","ARMATURE");modifier.object=rig
    scene["rigContract"]=json.dumps(joints,separators=(",",":"))
    scene["generator"]=script_hash
    scene["reference"]="public/assets/generated/model-portraits-v2.webp / industrial:worker"
    scene["workflow"]="Purpose-built hard surface / independent UV / actual high-to-low PBR"
    select(objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(directory/"engineering-worker.blend"),compress=True)
    log(f"COMPLETE / {time.time()-started:.1f}s")


run()
