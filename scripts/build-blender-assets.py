"""源码 → 可编辑 Blender 场景 → Meshopt GLB / Cycles PBR 图集。

调用由 build-blender-assets.mjs 负责；不依赖用户的 Blender 启动文件或插件。
"""
import argparse
import array
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--only", default="")
    parser.add_argument("--from-blend", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


args = arguments()
source = Path(args.source)
output = Path(args.output)
project = Path(args.project)
output.mkdir(parents=True, exist_ok=True)
editable = project / "artifacts/blender-game"
editable.mkdir(parents=True, exist_ok=True)
doc = json.loads((source / "source.json").read_text())
if args.from_blend and (output / "manifest.json").exists():
    previous = json.loads((output / "manifest.json").read_text())
    for key, template in doc["templates"].items():
        if key in previous["templates"]:
            template["bounds"] = previous["templates"][key]["bounds"]
binary = b"" if args.from_blend else (source / "geometry.bin").read_bytes()
bpy.context.preferences.filepaths.save_version = 0
bpy.context.preferences.filepaths.file_preview_type = "NONE"
scene = bpy.context.scene


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        if not mesh.users:
            bpy.data.meshes.remove(mesh)


def values(description):
    start = description["offset"]
    result = array.array("f")
    result.frombytes(binary[start:start + description["count"] * description["size"] * 4])
    return result


def attribute(mesh, name, size, data):
    kind, field = {1: ("FLOAT", "value"), 2: ("FLOAT2", "vector"),
                   3: ("FLOAT_VECTOR", "vector"), 4: ("FLOAT_COLOR", "color")}[size]
    attr = mesh.attributes.new(name="_" + name, type=kind, domain="POINT")
    attr.data.foreach_set(field, data)


def import_mesh(item):
    attrs = item["attributes"]
    positions = values(attrs["position"])
    count = attrs["position"]["count"]
    mesh = bpy.data.meshes.new(item["key"])
    # Three Y-up 转为 Blender Z-up；GLTF 导出会恢复 Y-up。
    mesh.from_pydata([(positions[i], -positions[i + 2], positions[i + 1])
                      for i in range(0, len(positions), 3)], [],
                     [(i, i + 1, i + 2) for i in range(0, count, 3)])
    uv = mesh.uv_layers.new(name="Atlas")
    uv.data.foreach_set("uv", values(attrs["uv"]))
    if "normal" in attrs:
        normals = values(attrs["normal"])
        mesh.normals_split_custom_set_from_vertices(
            [(normals[i], -normals[i + 2], normals[i + 1]) for i in range(0, len(normals), 3)])
        for face in mesh.polygons:
            face.use_smooth = True
    for name, description in attrs.items():
        if name not in ("position", "normal", "uv"):
            attribute(mesh, name, description["size"], values(description))
    obj = bpy.data.objects.new(f'{item["key"]}|{item["part"]}|{item["slot"]}', mesh)
    scene.collection.objects.link(obj)
    obj["key"] = item["key"]
    obj["part"] = item["part"]
    obj["slot"] = item["slot"]
    return obj


def export(pack):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in scene.objects:
        if obj.type == "MESH" and "key" in obj:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output / f"{pack}.glb"), export_format="GLB",
        use_selection=True,
        export_attributes=True, export_extras=True, export_materials="NONE",
        export_vertex_color="NONE", export_cameras=False, export_lights=False,
        export_meshopt_compression_enable=True,
        export_meshopt_extension="EXT_meshopt_compression",
    )


def blender_point(point):
    return Vector((point[0], -point[2], point[1]))


def preview_material(pack, slot):
    """编辑用材质读取与游戏相同的顶点色、PBR 参数和烘焙图集。"""
    name = f"Game preview {pack} {slot}"
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if slot == 2:
        lamp = {"industrial": (.24, .6, 1, 1), "brood": (1, .25, .07, 1),
                "stellar": (.04, .6, .85, 1), "relay": (1, .55, .12, 1)}
        color = lamp.get(pack, (.5, .8, .4, 1))
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = 1.6
        return mat
    tint = nodes.new("ShaderNodeAttribute")
    tint.attribute_name = "_color"
    finish = nodes.new("ShaderNodeAttribute")
    finish.attribute_name = "_surfaceFinish"
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(finish.outputs["Vector"], separate.inputs[0])
    links.new(separate.outputs["X"], bsdf.inputs["Roughness"])
    links.new(separate.outputs["Y"], bsdf.inputs["Metallic"])
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.image = bpy.data.images.load(str(output / "albedo.png"), check_existing=True)
    albedo.image.pack()
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = .34
    links.new(tint.outputs["Color"], multiply.inputs[1])
    links.new(albedo.outputs["Color"], multiply.inputs[2])
    links.new(multiply.outputs[0], bsdf.inputs["Base Color"])
    if slot == 1:
        team = nodes.new("ShaderNodeMixRGB")
        team.blend_type = "MULTIPLY"
        team.inputs[0].default_value = 1
        team.inputs[2].default_value = (.24, .58, .68, 1)
        links.new(multiply.outputs[0], team.inputs[1])
        links.new(team.outputs[0], bsdf.inputs["Base Color"])
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(output / "normal.png"), check_existing=True)
    texture.image.colorspace_settings.name = "Non-Color"
    texture.image.pack()
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = .5
    links.new(texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def save_editable(pack):
    """导出运行时网格之后才添加艺术预览骨架，保留代码拥有的骨骼顺序。"""
    groups = {}
    for obj in list(scene.objects):
        if obj.type == "MESH" and "key" in obj:
            groups.setdefault(obj["key"], []).append(obj)
            obj.data.materials.append(preview_material(pack, obj["slot"]))
    for index, (key, objects) in enumerate(groups.items()):
        template = doc["templates"].get(key, {})
        joints = template.get("rig", [])
        root = bpy.data.objects.new(f"Model {key}", None)
        scene.collection.objects.link(root)
        root.location = ((index % 5) * 210, (index // 5) * 210, 0)
        root["key"] = key
        if joints:
            armature = bpy.data.armatures.new(f"Rig {key}")
            rig = bpy.data.objects.new(f"Rig {key}", armature)
            scene.collection.objects.link(rig)
            rig.parent = root
            rig.show_in_front = True
            rig["rigContract"] = json.dumps(joints, separators=(",", ":"))
            bpy.ops.object.select_all(action="DESELECT")
            rig.select_set(True)
            bpy.context.view_layer.objects.active = rig
            bpy.ops.object.mode_set(mode="EDIT")
            bones = []
            for i, joint in enumerate(joints):
                bone = armature.edit_bones.new(joint["name"])
                bone.head = blender_point(joint["origin"])
                children = [j for j in joints if j["parent"] == i]
                tail = blender_point(children[0]["origin"]) if children else bone.head + Vector((0, 0, 4))
                bone.tail = tail if (tail - bone.head).length > .001 else bone.head + Vector((0, 0, 4))
                if joint["parent"] >= 0:
                    bone.parent = bones[joint["parent"]]
                bones.append(bone)
            bpy.ops.object.mode_set(mode="OBJECT")
            for obj in objects:
                obj.parent = rig
                indices = obj.data.attributes.get("_skinIndex")
                weights = obj.data.attributes.get("_skinWeight")
                if not indices or not weights:
                    raise ValueError(f"Missing skin weights: {obj.name}")
                buckets = defaultdict(list)
                for vertex in range(len(obj.data.vertices)):
                    # 合并同一顶点的重复 joint 槽，再批量写权重，避免逐顶点 Blender 操作。
                    influences = defaultdict(float)
                    for joint_id, weight in zip(indices.data[vertex].color, weights.data[vertex].color):
                        if weight > 0:
                            influences[int(round(joint_id))] += weight
                    for joint_id, weight in influences.items():
                        buckets[(joint_id, weight)].append(vertex)
                vertex_groups = [obj.vertex_groups.new(name=j["name"]) for j in joints]
                for (joint_id, weight), vertices in buckets.items():
                    vertex_groups[joint_id].add(vertices, weight, "REPLACE")
                modifier = obj.modifiers.new("Editable game skin", "ARMATURE")
                modifier.object = rig
        else:
            for obj in objects:
                obj.parent = root
                if obj["part"] >= 0:
                    obj.location = blender_point(template["moving"][obj["part"]])
    bpy.ops.object.select_all(action="DESELECT")
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.shading.type = "MATERIAL"
                area.spaces.active.clip_end = 10000
    scene["editing"] = "Edit meshes / weights, keep key / part / slot; export with npm run assets:blender -- --from-blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(editable / f"{pack}.blend"), compress=True)


def restore_editable(pack):
    """显式从 .blend 导出修订；不回写工程、不烘焙预览摆放或骨骼姿态。"""
    global scene
    bpy.ops.wm.open_mainfile(filepath=str(editable / f"{pack}.blend"))
    scene = bpy.context.scene
    for obj in list(scene.objects):
        if obj.type == "ARMATURE":
            key = obj.parent["key"]
            joints = doc["templates"][key]["rig"]
            if json.loads(obj.get("rigContract", "null")) != joints:
                raise ValueError(f"Rig contract changed: {key}; rebuild from source")
            for joint in joints:
                bone = obj.data.bones.get(joint["name"])
                parent = joints[joint["parent"]]["name"] if joint["parent"] >= 0 else None
                if not bone or (bone.head_local - blender_point(joint["origin"])).length > .001 or (
                    bone.parent.name if bone.parent else None) != parent:
                    raise ValueError(f"Rest joint changed: {key}/{joint['name']}; update source rig first")
        if obj.type != "MESH" or "key" not in obj:
            continue
        joints = doc["templates"].get(obj["key"], {}).get("rig", [])
        if joints:
            indices, weights = [], []
            group_names = {i: group.name for i, group in enumerate(obj.vertex_groups)}
            joint_ids = {j["name"]: i for i, j in enumerate(joints)}
            for vertex in obj.data.vertices:
                influences = [(joint_ids[group_names[g.group]], g.weight) for g in vertex.groups
                              if group_names[g.group] in joint_ids and g.weight > 0]
                influences.sort(key=lambda pair: -pair[1])
                if not influences or len(influences) > 4:
                    raise ValueError(f"Expected 1–4 bone influences: {obj.name}/{vertex.index}")
                total = sum(weight for _, weight in influences)
                influences += [(0, 0)] * (4 - len(influences))
                indices.extend(joint_id for joint_id, _ in influences)
                weights.extend(weight / total for _, weight in influences)
            for name in ("_skinIndex", "_skinWeight"):
                old = obj.data.attributes.get(name)
                if old:
                    obj.data.attributes.remove(old)
            attribute(obj.data, "skinIndex", 4, indices)
            attribute(obj.data, "skinWeight", 4, weights)
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        obj.parent = None
        obj.location = (0, 0, 0)
        if any(abs(v) > .001 for v in obj.rotation_euler) or any(abs(v - 1) > .001 for v in obj.scale):
            raise ValueError(f"Apply mesh rotation / scale before export: {obj.name}")
    bpy.context.view_layer.update()
    for key, template in doc["templates"].items():
        objects = [obj for obj in scene.objects if obj.type == "MESH" and obj.get("key") == key]
        if not objects:
            continue
        points = []
        for obj in objects:
            offset = template["moving"][obj["part"]] if obj["part"] >= 0 else (0, 0, 0)
            points.extend((p[0] + offset[0], p[2] + offset[1], -p[1] + offset[2]) for p in obj.bound_box)
        template["bounds"] = [[min(p[i] for p in points) for i in range(3)],
                              [max(p[i] for p in points) for i in range(3)]]


# 树木由 Blender 原生网格建立：真实分叉、根系、逐簇叶片，无 billboard。
def native_nature(kind, surface_by_name):
    rng = random.Random(741 + sum(ord(c) for c in kind))
    verts, faces, surfaces, tints = [], [], [], []

    def triangle(points, surface, tint):
        start = len(verts)
        verts.extend(points)
        faces.append((start, start + 1, start + 2))
        surfaces.extend([surface] * 3)
        tints.extend([tint] * 3)

    def branch(a, b, radius, end_radius, surface="bark", tint=(.38, .24, .13), sides=7):
        a, b = Vector(a), Vector(b)
        direction = (b - a).normalized()
        tangent = direction.cross(Vector((0, 0, 1)))
        if tangent.length < .01:
            tangent = direction.cross(Vector((0, 1, 0)))
        tangent.normalize()
        bitangent = direction.cross(tangent).normalized()
        rings = []
        for point, r in [(a, radius), (b, end_radius)]:
            rings.append([point + (tangent * math.cos(i * math.tau / sides) +
                                  bitangent * math.sin(i * math.tau / sides)) * r
                          for i in range(sides)])
        for i in range(sides):
            j = (i + 1) % sides
            triangle((rings[0][i], rings[0][j], rings[1][j]), surface, tint)
            triangle((rings[0][i], rings[1][j], rings[1][i]), surface, tint)
            triangle((b, rings[1][i], rings[1][j]), surface, tint)

    def leaves(center, radius, number, needle=False):
        # 三维折叶簇提供体积、背面和投影，顶视与低角度均有真实轮廓。
        cx, cy, cz = center
        for _ in range(number):
            angle = rng.random() * math.tau
            distance = radius * math.sqrt(rng.random())
            z = cz + rng.uniform(-radius * .36, radius * .52)
            c = Vector((cx + math.cos(angle) * distance, cy + math.sin(angle) * distance, z))
            direction = Vector((math.cos(angle), math.sin(angle), rng.uniform(-.35, .45)))
            side = Vector((-direction.y, direction.x, .12))
            length = rng.uniform(4, 8) if needle else rng.uniform(4, 7)
            width = length * (.5 if needle else .72)
            surface = "pine" if needle else "leaf"
            tint = ((.27, .42, .19) if needle else (.42, .55, .22))
            tint = tuple(c * rng.uniform(.78, 1.23) for c in tint)
            tip, root = c + direction * length, c - direction * length * .6
            crease = c + Vector((0, 0, 1.5))
            for p in [(root, c + side * width, crease), (c + side * width, tip, crease),
                      (tip, c - side * width, crease), (c - side * width, root, crease)]:
                triangle(p, surface, tint)
                triangle(tuple(reversed(p)), surface, tint)

    bark_surface = "stone" if kind == "birch" else "bark"
    bark_tint = (.79, .77, .68) if kind == "birch" else (.44, .30, .16)
    if kind in ("pine", "oak", "birch"):
        height = 102 if kind == "pine" else 87
        branch((0, 0, 0), (2, -1, height), 5, .7, bark_surface, bark_tint, 9)
        for i in range(6):
            angle = i * math.tau / 6
            branch((0, 0, 7), (math.cos(angle) * 14, math.sin(angle) * 14, .6),
                   2.7, .4, bark_surface, bark_tint)
        tiers = 5 if kind == "pine" else 3
        for tier in range(tiers):
            z = 30 + tier * (13 if kind == "pine" else 17)
            radius = 30 - tier * 4 if kind == "pine" else 25 - tier * 3
            for arm in range(4):
                angle = arm * math.tau / 4 + tier * 1.1
                end = (math.cos(angle) * radius, math.sin(angle) * radius, z + (3 if kind == "pine" else 12))
                branch((1, 0, z), end, 1.7, .3, bark_surface, bark_tint)
                leaves(end, 12 if kind == "pine" else 16, 8 if kind == "pine" else 11, kind == "pine")
        leaves((1, 0, height - 7), 10, 10, kind == "pine")
    elif kind == "bush":
        for i in range(5):
            angle = i * math.tau / 5
            end = (math.cos(angle) * 16, math.sin(angle) * 16, 17 + rng.random() * 14)
            branch((0, 0, 0), end, 1.7, .4)
            leaves(end, 15, 12)
    else:
        return None
    mesh = bpy.data.meshes.new(f"Blender botanical {kind}")
    mesh.from_pydata(verts, [], faces)
    uv = mesh.uv_layers.new(name="Atlas")
    coords, colors, finishes, weather, spans, local = [], [], [], [], [], []
    for i, vertex in enumerate(verts):
        spec = surface_by_name[surfaces[i]]
        u, v = ((.03, .03), (.97, .03), (.5, .97))[i % 3]
        coords.extend(((spec["cell"]["x"] + u) / doc["columns"],
                       (spec["cell"]["y"] + v) / doc["rows"]))
        colors.extend(tints[i])
        finishes.extend(spec["finish"])
        weather.extend(spec["weather"])
        spans.extend((12, 18))
        local.extend((u, v, vertex[2], (i // 3 * .618) % 1))
    uv.data.foreach_set("uv", coords)
    for name, size, data in [
        ("color", 3, colors), ("surfaceFinish", 3, finishes),
        ("surfaceTexture", 1, [1] * len(verts)), ("surfaceWeathering", 4, weather),
        ("weatherCoord", 4, local), ("weatherSpan", 2, spans),
    ]:
        attribute(mesh, name, size, data)
    obj = bpy.data.objects.new(f"nature:{kind}|-1|0", mesh)
    scene.collection.objects.link(obj)
    obj["key"], obj["part"], obj["slot"] = f"nature:{kind}", -1, 0
    return obj


def bake_atlas():
    clear()
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 8
    scene.cycles.device = "CPU"
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True
    size = 256
    images = {
        "albedo": bpy.data.images.new("Blender albedo", doc["columns"] * size, doc["rows"] * size),
        "normal": bpy.data.images.new("Blender tangent normal", doc["columns"] * size, doc["rows"] * size),
        "orm": bpy.data.images.new("Blender roughness metal height", doc["columns"] * size, doc["rows"] * size),
    }
    images["normal"].colorspace_settings.name = "Non-Color"
    images["orm"].colorspace_settings.name = "Non-Color"
    materials, vertices, polygons = [], [], []
    for spec in doc["surfaces"]:
        name = spec["name"]
        x, y = spec["cell"]["x"], spec["cell"]["y"]
        start = len(vertices)
        vertices.extend([(x, y, 0), (x + 1, y, 0), (x + 1, y + 1, 0), (x, y + 1, 0)])
        polygons.append((start, start + 1, start + 2, start + 3))
        mat = bpy.data.materials.new("PBR " + name)
        mat.use_nodes = True
        n, l = mat.node_tree.nodes, mat.node_tree.links
        n.clear()
        output_node = n.new("ShaderNodeOutputMaterial")
        bsdf = n.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = spec["finish"][0]
        bsdf.inputs["Metallic"].default_value = spec["finish"][1]
        l.new(bsdf.outputs["BSDF"], output_node.inputs["Surface"])
        uv = n.new("ShaderNodeTexCoord")
        mapping = n.new("ShaderNodeVectorMath")
        mapping.operation = "MULTIPLY"
        mapping.inputs[1].default_value = (doc["columns"], doc["rows"], 1)
        l.new(uv.outputs["UV"], mapping.inputs[0])
        noise = n.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 48 if spec["finish"][1] > .3 else 19
        noise.inputs["Detail"].default_value = 3
        noise.inputs["Roughness"].default_value = .7
        l.new(mapping.outputs[0], noise.inputs["Vector"])
        grain = n.new("ShaderNodeTexNoise")
        grain.inputs["Scale"].default_value = 180
        grain.inputs["Detail"].default_value = 2
        l.new(mapping.outputs[0], grain.inputs["Vector"])
        wave = n.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "X" if name not in ("cloth", "bark", "expeditionCanvas") else "DIAGONAL"
        wave.inputs["Scale"].default_value = 37 if spec["finish"][1] > .3 else 12
        wave.inputs["Distortion"].default_value = 1.8 if "chitin" in name.lower() else .2
        l.new(mapping.outputs[0], wave.inputs["Vector"])
        height = n.new("ShaderNodeMixRGB")
        height.blend_type = "MULTIPLY"
        height.inputs[0].default_value = .34
        l.new(noise.outputs["Fac"], height.inputs[1])
        l.new(wave.outputs["Fac"], height.inputs[2])
        bump = n.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .36
        bump.inputs["Distance"].default_value = .012 if spec["finish"][1] > .3 else .024
        l.new(height.outputs[0], bump.inputs["Height"])
        l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        # 中性色保留源顶点的阵营色；贴图承载细节而非额外网格。
        color = n.new("ShaderNodeValToRGB")
        color.color_ramp.elements[0].position = .12
        color.color_ramp.elements[0].color = (.30, .34, .36, 1)
        color.color_ramp.elements[1].position = .86
        color.color_ramp.elements[1].color = (.78, .80, .78, 1)
        l.new(noise.outputs["Fac"], color.inputs[0])
        l.new(color.outputs[0], bsdf.inputs["Base Color"])
        emission = n.new("ShaderNodeEmission")
        l.new(color.outputs[0], emission.inputs["Color"])
        combine = n.new("ShaderNodeCombineColor")
        combine.mode = "RGB"
        combine.inputs["Red"].default_value = 1
        roughness = n.new("ShaderNodeMapRange")
        roughness.inputs["To Min"].default_value = max(.06, spec["finish"][0] - .12)
        roughness.inputs["To Max"].default_value = min(1, spec["finish"][0] + .12)
        l.new(grain.outputs["Fac"], roughness.inputs["Value"])
        l.new(roughness.outputs[0], combine.inputs["Green"])
        combine.inputs["Blue"].default_value = spec["finish"][1]
        target = n.new("ShaderNodeTexImage")
        n.active = target
        materials.append((mat, target, output_node, bsdf, emission, combine))
    mesh = bpy.data.meshes.new("56 PBR tiles")
    mesh.from_pydata(vertices, [], polygons)
    uv = mesh.uv_layers.new(name="Atlas")
    uv.data.foreach_set("uv", [c for v in vertices for c in (v[0] / doc["columns"], v[1] / doc["rows"])])
    obj = bpy.data.objects.new("Cycles atlas bake", mesh)
    scene.collection.objects.link(obj)
    for index, (mat, *_) in enumerate(materials):
        obj.data.materials.append(mat)
        mesh.polygons[index].material_index = index
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for channel in ("albedo", "normal", "orm"):
        for mat, target, out, bsdf, emission, combine in materials:
            target.image = images[channel]
            mat.node_tree.nodes.active = target
            links = mat.node_tree.links
            if channel == "normal":
                links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
            else:
                if channel == "orm":
                    links.new(combine.outputs[0], emission.inputs["Color"])
                links.new(emission.outputs[0], out.inputs["Surface"])
        bpy.ops.object.bake(type="NORMAL" if channel == "normal" else "EMIT", normal_space="TANGENT")
        images[channel].filepath_raw = str(output / f"{channel}.png")
        images[channel].file_format = "PNG"
        images[channel].save()
        print(f"BLENDER_BAKE {channel}", flush=True)
    for image in images.values():
        image.pack()
    for mat, _, out, bsdf, _, _ in materials:
        mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bpy.ops.wm.save_as_mainfile(filepath=str(editable / "materials.blend"), compress=True)


packs = ["industrial", "brood", "stellar", "relay", "nature"]
if args.only:
    if args.only not in packs:
        raise ValueError(f"Unknown asset pack: {args.only}")
    packs = [args.only]
if not args.only and not args.from_blend:
    bake_atlas()
for pack in packs:
    if args.from_blend:
        restore_editable(pack)
        export(pack)
        print(f"BLENDER_EDITED_PACK {pack}", flush=True)
        continue
    clear()
    for item in doc["meshes"]:
        if item["pack"] != pack:
            continue
        if pack == "nature" and item["key"] in ("nature:pine", "nature:oak", "nature:birch", "nature:bush"):
            continue
        import_mesh(item)
    if pack == "nature":
        for kind in ("pine", "oak", "birch", "bush"):
            native_nature(kind, {s["name"]: s for s in doc["surfaces"]})
    export(pack)
    save_editable(pack)
    print(f"BLENDER_PACK {pack}", flush=True)
(output / "manifest.json").write_text(json.dumps({
    "version": 1, "generator": bpy.app.version_string, "templates": doc["templates"],
    "packs": [f"{pack}.glb" for pack in ["industrial", "brood", "stellar", "relay", "nature"]],
    "textures": ["albedo.png", "normal.png", "orm.png"],
}, separators=(",", ":")))
