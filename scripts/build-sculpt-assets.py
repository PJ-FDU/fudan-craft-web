"""按源码部件语义精修：独立 UV、真实高低模投射、四族专属 PBR。

高模与低模分别保存，运行时不装载雕刻高模。不是把旧图标投到平面上。
"""
import argparse
import array
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
import sculpt_humanoids
import sculpt_brood


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--project", required=True)
selection = parser.add_mutually_exclusive_group()
selection.add_argument("--only-key", default="")
selection.add_argument("--only", choices=["industrial", "brood", "stellar", "relay"], default="")
parser.add_argument("--tile-size", type=int, default=512)
parser.add_argument("--device", choices=["CPU", "METAL"], default="CPU")
opts = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
script_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
project, source = Path(opts.project), Path(opts.source)
doc = json.loads((source / "source.json").read_text())
binary = (source / "geometry.bin").read_bytes()
out = project / ("artifacts/sculpt-test" if opts.only_key else "public/assets/blender-sculpt-v2")
editable = project / "artifacts/blender-sculpt"
out.mkdir(parents=True, exist_ok=True)
editable.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
bpy.context.preferences.filepaths.save_version = 0
bpy.context.preferences.filepaths.file_preview_type = "NONE"
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
if opts.device == "METAL":
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.get_devices()
    if not any(device.type == "METAL" for device in preferences.devices):
        raise ValueError("Metal GPU is unavailable")
    for device in preferences.devices:
        device.use = device.type == "METAL"
    scene.cycles.device = "GPU"
scene.cycles.samples = 8
scene.render.bake.margin = 2
scene.render.bake.use_clear = True
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = .5
scene.render.bake.max_ray_distance = 2
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
scene.world.color = (.15, .15, .15)

# sRGB 色板与图标一致；颜色不再依赖旧的重复图集相乘。
PALETTE = {
    "federalPlate": (.36, .46, .52), "armorCeramic": (.68, .75, .77),
    "armor": (.60, .68, .71), "guard": (.62, .68, .65), "deck": (.39, .47, .48),
    "titanArmor": (.34, .42, .43), "titanSteel": (.24, .32, .37),
    "titanSeal": (.12, .15, .14), "titanTrim": (.49, .48, .34),
    "medicalComposite": (.82, .85, .78), "helmet": (.69, .74, .74),
    "serviceSteel": (.30, .35, .35), "roof": (.26, .32, .34),
    "weapon": (.19, .24, .24), "grille": (.12, .17, .17),
    "wall": (.34, .41, .43), "concrete": (.30, .33, .30),
    "circuitry": (.23, .32, .36), "piston": (.39, .43, .42),
    "exhaust": (.21, .24, .23), "tread": (.10, .12, .105),
    "track": (.11, .135, .12), "undersuit": (.13, .17, .17),
    "scoutCloth": (.24, .29, .16), "cloth": (.24, .28, .24),
    "glass": (.08, .23, .29), "optic": (.05, .18, .23),
    "chitin": (.40, .235, .12), "chitinLamella": (.48, .29, .155),
    "membrane": (.37, .075, .052), "nutrient": (.83, .32, .047),
    "horn": (.76, .63, .40), "ceramic": (.055, .185, .235),
    "astralAlloy": (.115, .235, .30), "stellarConductor": (.54, .38, .17),
    "photonicGlass": (.05, .55, .67), "conductor": (.53, .38, .17),
    "expeditionPlate": (.52, .39, .235), "expeditionFrame": (.235, .27, .235),
    "expeditionCanvas": (.58, .46, .29), "expeditionLaminate": (.50, .40, .25),
    "fieldRubber": (.13, .145, .115), "hazard": (.70, .43, .10),
    "insignia": (.28, .40, .19),
}
FABRIC = {"cloth", "undersuit", "scoutCloth", "expeditionCanvas"}
ORGANIC = {"chitin", "chitinLamella", "membrane", "nutrient", "horn"}
ROUND = {"dome", "carapace", "scute", "scalePlate", "jointBall"}
BOX = {"box", "bevel", "panel"}
SPEC = {s["name"]: s for s in doc["surfaces"]}
MAX_PROJECTION_FALLBACK = .05


def log(message):
    print("SCULPT " + message, flush=True)


def select(objects, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active or objects[0]


def attribute(mesh, name, size, data, domain="POINT"):
    kind, field = {1: ("FLOAT", "value"), 3: ("FLOAT_VECTOR", "vector"),
                   4: ("FLOAT_COLOR", "color")}[size]
    attr = mesh.attributes.get(name) or mesh.attributes.new(name=name, type=kind, domain=domain)
    attr.data.foreach_set(field, data)


def source_values(description):
    result = array.array("f")
    start = description["offset"]
    result.frombytes(binary[start:start + description["count"] * description["size"] * 4])
    return result


def point(v):
    return Vector((v[0], -v[2], v[1]))


def rotation_of(p):
    # Three 的 XYZ 欧拉角对应 Rx·Ry·Rz，不能直接套 Blender 的欧拉应用顺序。
    x, y, z = p["rotation"]
    return Matrix.Rotation(x, 4, "X") @ Matrix.Rotation(y, 4, "Y") @ Matrix.Rotation(z, 4, "Z")


def srgb(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def finish_of(p, slot):
    finish = p["finish"]
    if slot == 1:
        return "team", (.67, .67, .67), (.46, .28, 1)
    if slot == 2:
        return "lamp", (.8, .8, .8), (.22, .05, 1)
    surface = finish.get("surface", "insignia") if isinstance(finish, dict) else "insignia"
    color = PALETTE.get(surface, (.35, .42, .42))
    tint = finish.get("tint", 0xffffff) if isinstance(finish, dict) else finish
    # 医疗标记、军官衣服与同材质的异色零件保留语义，避免色板吞掉红十字。
    channels = [(tint >> shift & 255) / 255 for shift in (16, 8, 0)]
    if surface == "insignia" and isinstance(finish, dict) and finish.get("texture") == .1:
        color = (.57, .43, .30)
    elif channels[0] > channels[1] * 1.65 and surface in {"medicalComposite", "insignia"}:
        color = (.61, .105, .065)
    elif surface == "scoutCloth" and channels[2] > channels[0] * 1.2:
        color = (.17, .21, .23)
    elif surface == "membrane" and max(channels) < .2:
        color = (.075, .038, .025)
    else:
        peak = max(channels)
        color = tuple(c * (.83 + .17 * channels[i] / max(.01, peak)) for i, c in enumerate(color))
    params = finish.get("finish", SPEC.get(surface, {}).get("finish", [.6, .2, 1])) if isinstance(finish, dict) else [.5, .2, 1]
    return surface, color, params


def material(p, slot, seed):
    surface, color, params = finish_of(p, slot)
    panel = p["shape"] in BOX | {"armorHull", "armorPlate"} and min(p["size"]) > 2
    cache_key = f'{surface}:{color}:{params}:{p["shape"]}:{seed % 7}:{slot}:{panel}'
    if cache_key in bpy.data.materials:
        return bpy.data.materials[cache_key]
    mat = bpy.data.materials.new(cache_key)
    mat["slot"] = slot
    mat["surface"] = surface
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    mat["roughness"], mat["metalness"] = params[:2]
    bsdf.inputs["Metallic"].default_value = params[1]
    coord = nodes.new("ShaderNodeAttribute")
    coord.attribute_name = "_sculptCoord"
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 5.3
    noise.inputs["Detail"].default_value = 4
    noise.inputs["Roughness"].default_value = .72
    links.new(coord.outputs["Vector"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.name = "Baked base color"
    variation = .025 * ((seed % 7) - 3)
    a, b = ramp.color_ramp.elements
    a.position, b.position = .12, .88
    a.color = tuple(srgb(c * ((.73 if surface in ORGANIC else .88) + variation)) for c in color) + (1,)
    b.color = tuple(srgb(min(1, c * ((1.19 if surface in ORGANIC else 1.08) + variation))) for c in color) + (1,)
    links.new(noise.outputs["Fac"], ramp.inputs[0])
    color_output = ramp.outputs["Color"]
    micro = nodes.new("ShaderNodeTexNoise")
    micro.inputs["Scale"].default_value = 130 if surface not in ORGANIC else 52
    micro.inputs["Detail"].default_value = 3
    links.new(coord.outputs["Vector"], micro.inputs["Vector"])
    rough = nodes.new("ShaderNodeMapRange")
    rough.name = "Baked roughness"
    rough.inputs["To Min"].default_value = max(.12, params[0] - .095)
    rough.inputs["To Max"].default_value = min(.96, params[0] + .10)
    links.new(micro.outputs["Fac"], rough.inputs["Value"])
    links.new(rough.outputs[0], bsdf.inputs["Roughness"])
    height = micro.outputs["Fac"]
    bump_distance = .055
    if surface in ORGANIC:
        growth = nodes.new("ShaderNodeTexWave")
        growth.wave_type = "BANDS"
        growth.bands_direction = "Z" if surface in {"chitin", "chitinLamella"} else "Y"
        growth.inputs["Scale"].default_value = 17 if surface != "membrane" else 28
        growth.inputs["Distortion"].default_value = 4.3
        growth.inputs["Detail Scale"].default_value = 1.6
        links.new(coord.outputs["Vector"], growth.inputs["Vector"])
        cracks = nodes.new("ShaderNodeTexVoronoi")
        cracks.feature = "DISTANCE_TO_EDGE"
        cracks.inputs["Scale"].default_value = 7
        links.new(coord.outputs["Vector"], cracks.inputs["Vector"])
        mix = nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = .68
        links.new(growth.outputs["Color"], mix.inputs[1])
        links.new(cracks.outputs["Distance"], mix.inputs[2])
        height = mix.outputs[0]
        bump_distance = .16 if surface != "nutrient" else .035
        # 甲壳裂缝与组织筋纹的颜色来自同一处雕刻信号，保持结构一致。
        tone = nodes.new("ShaderNodeMixRGB")
        tone.blend_type = "MULTIPLY"
        tone.inputs[0].default_value = .22
        links.new(color_output, tone.inputs[1])
        links.new(growth.outputs["Color"], tone.inputs[2])
        color_output = tone.outputs[0]
        if surface in {"chitin", "chitinLamella", "nutrient"}:
            fracture = nodes.new("ShaderNodeValToRGB")
            fracture.color_ramp.elements.remove(fracture.color_ramp.elements[1])
            first = fracture.color_ramp.elements[0]
            first.position, first.color = .004, (.022, .007, .002, 1)
            for position, gain in ((.020, .77), (.035, 1.38), (.075, 1)):
                element = fracture.color_ramp.elements.new(position)
                element.color = tuple(srgb(min(1, c * gain)) for c in color) + (1,)
            links.new(cracks.outputs["Distance"], fracture.inputs[0])
            painted = nodes.new("ShaderNodeMixRGB")
            painted.inputs[0].default_value = .64 if surface != "nutrient" else .48
            links.new(color_output, painted.inputs[1])
            links.new(fracture.outputs[0], painted.inputs[2])
            color_output = painted.outputs[0]
    elif surface in FABRIC:
        weave = nodes.new("ShaderNodeTexWave")
        weave.bands_direction = "DIAGONAL"
        weave.inputs["Scale"].default_value = 125
        weave.inputs["Distortion"].default_value = .4
        links.new(coord.outputs["Vector"], weave.inputs["Vector"])
        height = weave.outputs["Color"]
        bump_distance = .043
    elif surface not in {"team", "lamp", "glass", "optic", "photonicGlass", "tread", "track", "fieldRubber"}:
        geometry = nodes.new("ShaderNodeNewGeometry")
        edge = nodes.new("ShaderNodeMapRange")
        edge.inputs["From Min"].default_value = .49
        edge.inputs["From Max"].default_value = .55
        edge.inputs["To Min"].default_value = 0
        edge.inputs["To Max"].default_value = .8
        links.new(geometry.outputs["Pointiness"], edge.inputs["Value"])
        fleck = nodes.new("ShaderNodeMath")
        fleck.operation = "GREATER_THAN"
        fleck.inputs[1].default_value = .49
        links.new(micro.outputs["Fac"], fleck.inputs[0])
        chipped = nodes.new("ShaderNodeMath")
        chipped.operation = "MULTIPLY"
        links.new(edge.outputs[0], chipped.inputs[0])
        links.new(fleck.outputs[0], chipped.inputs[1])
        worn = nodes.new("ShaderNodeMixRGB")
        links.new(chipped.outputs[0], worn.inputs[0])
        links.new(color_output, worn.inputs[1])
        worn.inputs[2].default_value = tuple(srgb(min(.8, c * 1.4 + .08)) for c in color) + (1,)
        color_output = worn.outputs[0]
        if panel:
            uv = nodes.new("ShaderNodeAttribute")
            uv.attribute_name = "_detailUV"
            separate = nodes.new("ShaderNodeSeparateXYZ")
            links.new(uv.outputs["Vector"], separate.inputs[0])
            axes = []
            for axis in ("X", "Y"):
                center = nodes.new("ShaderNodeMath")
                center.operation = "SUBTRACT"
                links.new(separate.outputs[axis], center.inputs[0])
                center.inputs[1].default_value = .5
                absolute = nodes.new("ShaderNodeMath")
                absolute.operation = "ABSOLUTE"
                links.new(center.outputs[0], absolute.inputs[0])
                axes.append(absolute.outputs[0])
            radius = nodes.new("ShaderNodeMath")
            radius.operation = "MAXIMUM"
            for index, socket in enumerate(axes):
                links.new(socket, radius.inputs[index])
            def border(at, width):
                distance = nodes.new("ShaderNodeMath")
                distance.operation = "SUBTRACT"
                links.new(radius.outputs[0], distance.inputs[0])
                distance.inputs[1].default_value = at
                magnitude = nodes.new("ShaderNodeMath")
                magnitude.operation = "ABSOLUTE"
                links.new(distance.outputs[0], magnitude.inputs[0])
                line = nodes.new("ShaderNodeMath")
                line.operation = "LESS_THAN"
                links.new(magnitude.outputs[0], line.inputs[0])
                line.inputs[1].default_value = width
                return line.outputs[0]
            mask = border(.36, .018)
            highlight = nodes.new("ShaderNodeMixRGB")
            links.new(border(.398, .013), highlight.inputs[0])
            links.new(color_output, highlight.inputs[1])
            highlight.inputs[2].default_value = tuple(srgb(min(.9, c * 1.35 + .10)) for c in color) + (1,)
            engraving = nodes.new("ShaderNodeMixRGB")
            links.new(mask, engraving.inputs[0])
            links.new(highlight.outputs[0], engraving.inputs[1])
            engraving.inputs[2].default_value = (.008, .012, .014, 1)
            color_output = engraving.outputs[0]
            recess = nodes.new("ShaderNodeMath")
            recess.operation = "SUBTRACT"
            recess.inputs[0].default_value = 1
            links.new(mask, recess.inputs[1])
            height = recess.outputs[0]
            bump_distance = .28
    links.new(color_output, bsdf.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .32
    bump.inputs["Distance"].default_value = bump_distance
    links.new(height, bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    emission = nodes.new("ShaderNodeEmission")
    emission.name = "Bake emission"
    links.new(color_output, emission.inputs["Color"])
    target = nodes.new("ShaderNodeTexImage")
    target.name = "Bake target"
    return mat


def round_mesh(shape, high, surface):
    around, steps = (64, 32) if high else (20, 12)
    verts, faces = [], []
    # 四边形经纬拓扑：高模可继续雕刻，低模保留完整甲壳弧面。
    for row in range(steps + 1):
        theta = .001 + (math.pi - .002) * row / steps
        z, radius = math.cos(theta) * .5, math.sin(theta) * .5
        for col in range(around):
            angle = col * math.tau / around
            x, y = math.cos(angle) * radius, math.sin(angle) * radius
            if shape in {"carapace", "scute", "scalePlate"}:
                x *= .86 + .24 * (z + .5)
                if y < 0:
                    y *= .30
                elif shape == "scute":
                    keel = math.exp(-x * x * 58) * math.sqrt(max(0, 1 - 4 * z * z))
                    y = y * .86 + keel * y * .52
                if surface in {"chitin", "chitinLamella"} and y > 0:
                    # 成长沟槽随甲壳弯曲，从中脊向两侧展开；不是加密原网格。
                    track = z + abs(x) * .46
                    groove = max(0, math.cos(track * 54 + math.sin(x * 14) * .4)) ** 12
                    y -= groove * (.007 if high else .002)
                    y += math.exp(-((z - .31) / .045) ** 2) * .030
                    seam = z + .12 - abs(x) * .72
                    y -= math.exp(-(seam / .016) ** 2) * (.025 if high else .006)
                    z += y * .09
            verts.append(point((x, y, z)))
    for row in range(steps):
        for col in range(around):
            a = row * around + col
            b = row * around + (col + 1) % around
            faces.append((a, a + around, b + around, b))
    faces += [tuple(reversed(range(around))), tuple(steps * around + i for i in range(around))]
    mesh = bpy.data.meshes.new(f"{shape} {'sculpt' if high else 'cage'}")
    mesh.from_pydata(verts, [], faces)
    return mesh


def horn_mesh(high):
    around, steps = (40, 36) if high else (16, 10)
    verts, faces = [], []
    for row in range(steps + 1):
        t = row / steps
        radius = .01 + .28 * (1 - t) ** .82
        for col in range(around):
            angle = math.tau * col / around
            flute = 1 + (.035 if high else .012) * math.sin(angle * 9 + t * 6)
            ring = 1 - (.026 if high else .006) * max(0, math.cos(t * 92)) ** 8
            verts.append(point((math.cos(angle) * radius * flute * ring, t - .5,
                                math.sin(angle) * radius * flute * ring + t * t * .58)))
    for row in range(steps):
        for col in range(around):
            a = row * around + col
            b = row * around + (col + 1) % around
            faces.append((a, a + around, b + around, b))
    faces += [tuple(range(around)), tuple(reversed([steps * around + i for i in range(around)]))]
    mesh = bpy.data.meshes.new("Keratin sculpt" if high else "Keratin cage")
    mesh.from_pydata(verts, [], faces)
    return mesh


def tendon_mesh(high):
    around, steps = (32, 20) if high else (12, 5)
    verts, faces = [], []
    for row in range(steps + 1):
        t = row / steps
        radius = (.45 - .22 * t) * (1 + .15 * math.sin(t * math.pi))
        for col in range(around):
            angle = col * math.tau / around
            strand = 1 + (.036 if high else .012) * math.cos(angle * 8 + math.sin(t * 5))
            verts.append(point((math.cos(angle) * radius * strand, t - .5,
                                math.sin(angle) * radius * strand + .065 * math.sin(t * math.pi))))
    for row in range(steps):
        for col in range(around):
            a, b = row * around + col, row * around + (col + 1) % around
            faces.append((a, a + around, b + around, b))
    faces += [tuple(range(around)), tuple(reversed([steps * around + i for i in range(around)]))]
    mesh = bpy.data.meshes.new("Sculpted tendon" if high else "Tendon cage")
    mesh.from_pydata(verts, [], faces)
    return mesh


def garment_mesh(p, high):
    """人体衣物用闭合环形截面，保留腰身、肢体体积和真正的布料褶皱。"""
    around, steps = (40, 30) if high else (20, 12)
    joint = p.get("_jointName", "")
    limb = joint.endswith(("Arm", "Elbow", "Leg", "Knee"))
    torso = joint == "torso" and abs(p["position"][0]) < 1
    bag = torso and p["position"][2] < -3
    exponent = 1 if limb else .55 if torso else .48
    verts, faces = [], []
    for row in range(steps + 1):
        t = row / steps
        y = t - .5
        if limb:
            profile = .76 + .26 * math.sin(t * math.pi) + .05 * t
        elif torso and not bag:
            profile = .83 + .19 * t + .07 * math.sin(t * math.pi)
        else:
            profile = .82 + .18 * math.sin(t * math.pi)
        for col in range(around):
            angle = col * math.tau / around
            a, b = math.cos(angle), math.sin(angle)
            # 高低模共享大褶皱，高模再增加细褶，避免改变主要衣物轮廓。
            fold = (.018 * math.sin(t * 23 + angle * 3) +
                    .010 * math.sin(t * 37 - angle * 2)) * math.sin(t * math.pi)
            if high:
                fold += .007 * math.sin(t * 89 + angle * 5) * math.sin(t * math.pi)
            radius = .5 * (profile + fold)
            x = math.copysign(abs(a) ** exponent, a) * radius
            z = math.copysign(abs(b) ** exponent, b) * radius
            # 腰部侧缝和衣袋边沿有实体凹线，而不是统一噪声。
            seam = math.exp(-math.sin(angle) ** 2 * 180) * (.004 if high else .002)
            x *= 1 - seam
            verts.append(point((x, y, z)))
    for row in range(steps):
        for col in range(around):
            a, b = row * around + col, row * around + (col + 1) % around
            faces.append((a, a + around, b + around, b))
    faces += [tuple(range(around)), tuple(reversed([steps * around + i for i in range(around)]))]
    mesh = bpy.data.meshes.new("Tailored garment sculpt" if high else "Tailored garment cage")
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def boot_mesh():
    """鞋楦沿脚尖收窄，鞋帮在后侧升高，避免把靴子画成扁长方块。"""
    verts, faces = [], []
    sections = [(-.5, .37, .5), (-.35, .49, .5), (-.08, .49, .34),
                (.16, .46, .04), (.36, .40, -.04), (.5, .25, -.13)]
    for z, width, top in sections:
        for x, y in [(-width, -.40), (-width + .09, -.5), (width - .09, -.5),
                     (width, -.40), (width, top - .09), (width - .09, top),
                     (-width + .09, top), (-width, top - .09)]:
            verts.append(point((x, y, z)))
    for row in range(len(sections) - 1):
        for col in range(8):
            a, b = row * 8 + col, row * 8 + (col + 1) % 8
            faces.append((a, b, b + 8, a + 8))
    faces += [tuple(reversed(range(8))), tuple((len(sections) - 1) * 8 + i for i in range(8))]
    mesh = bpy.data.meshes.new("Shaped boot last")
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def source_mesh(p, positions):
    start, end = p["start"] * 3, (p["start"] + p["count"]) * 3
    rotation = rotation_of(p)
    transform = Matrix.Translation(Vector(p["position"])) @ rotation @ Matrix.Diagonal(Vector((*p["size"], 1)))
    inverse = transform.inverted()
    verts = [point(inverse @ Vector(positions[i:i + 3])) for i in range(start, end, 3)]
    mesh = bpy.data.meshes.new(p["shape"])
    mesh.from_pydata(verts, [], [(i, i + 1, i + 2) for i in range(0, len(verts), 3)])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bmesh.ops.dissolve_limit(bm, angle_limit=.0001, verts=list(bm.verts), edges=list(bm.edges))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    if p["shape"] in {"armorHull", "armorPlate"}:
        # 肩甲与车体上沿更饱满，靠实体圆角过渡，避免几层八边形帽子的轮廓。
        for vertex in mesh.vertices:
            y = vertex.co.z
            if y > .15:
                t = min(1, (y - .15) / .35)
                vertex.co.x *= 1 + t * (.26 if p["shape"] == "armorHull" else .12)
                vertex.co.y *= 1 + t * .10
    return mesh


def primitive(p, positions, high, slot, seed):
    shape = p["shape"]
    surface, _, _ = finish_of(p, slot)
    tailored = surface in FABRIC and p.get("skin") and shape in BOX | {"sleeve"}
    glove = surface == "fieldRubber" and p.get("_jointName", "").endswith("Hand")
    boot = surface == "fieldRubber" and shape == "bevel" and p.get("_jointName", "").endswith("Foot")
    if boot:
        mesh = boot_mesh()
    elif tailored or glove:
        mesh = garment_mesh(p, high)
    elif shape in ROUND:
        mesh = round_mesh(shape, high, surface)
    elif shape == "horn" and surface in ORGANIC:
        mesh = horn_mesh(high)
    elif shape == "limb" and surface in ORGANIC:
        mesh = tendon_mesh(high)
    elif shape in BOX:
        mesh = bpy.data.meshes.new("Plate topology")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        if high and surface in FABRIC:
            bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=9, use_grid_fill=True)
        bm.to_mesh(mesh)
        bm.free()
    else:
        mesh = source_mesh(p, positions)
    obj = bpy.data.objects.new(f"{shape}:{seed}", mesh)
    scene.collection.objects.link(obj)
    # 转换到实际尺寸后做倒角，装甲厚度不受非均匀缩放挤压。
    rotation = rotation_of(p).to_3x3()
    conversion = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
    rot = conversion @ rotation @ conversion.inverted()
    size = p["size"]
    scale = Matrix.Diagonal(Vector((size[0], size[2], size[1])))
    if surface in FABRIC and shape in BOX and not tailored:
        for vertex in mesh.vertices:
            x, z, y = vertex.co.x, -vertex.co.y, vertex.co.z
            if abs(z) > .45:
                fold = math.sin(x * 17 + y * 2) * .026 + math.sin(y * 8 + x * 4) * .012
                vertex.co.y -= fold
    mesh.transform(scale.to_4x4())
    select([obj])
    if not (tailored or glove) and (shape in BOX or shape in {"armorHull", "armorPlate", "canopy", "octagon", "gable", "airfoil"}):
        bevel = obj.modifiers.new("Machined edge radius", "BEVEL")
        bevel.width = min(size) * (.055 if shape == "box" else .07 if shape in BOX else .055)
        bevel.segments = 6 if high else 3
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = .35
        bevel.use_clamp_overlap = True
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    mesh = obj.data
    # 普通圆柱保持真实轮廓；细纤维和生长纹理来自高模材质法线。
    for face in mesh.polygons:
        face.use_smooth = shape not in {"shard", "facet", "crown"}
    if shape not in ROUND and shape != "horn" and surface not in FABRIC and shape not in {"shard", "facet"}:
        normal = obj.modifiers.new("Area weighted normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
        normal.weight = 50
        bpy.ops.object.modifier_apply(modifier=normal.name)
    mesh = obj.data
    # 在宽装甲的安装面增加实际铆钉，远景法线与近景轮廓共用。
    if shape in {"armorHull", "armorPlate", "bevel"} and min(size) > 6 and max(size) / min(size) < 5 and surface not in FABRIC | ORGANIC:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        sides = 16 if high else 8
        for x in (-.23, .23):
            for z in (-.22, .22):
                center = Vector((x * size[0], -z * size[2], .5 * size[1]))
                radius, depth = min(size) * .021, min(size) * .024
                rings = []
                for level in (0, depth):
                    rings.append([bm.verts.new(center + Vector((math.cos(i * math.tau / sides) * radius,
                                                               math.sin(i * math.tau / sides) * radius, level)))
                                  for i in range(sides)])
                for i in range(sides):
                    j = (i + 1) % sides
                    bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
                bm.faces.new(rings[1])
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(mesh)
        bm.free()
    coords, detail_uv, indices, weights = [], [], [], []
    inverse_scale = scale.inverted()
    for vertex in mesh.vertices:
        local = inverse_scale @ vertex.co
        coords.extend((local.x, local.z, -local.y))
        if not high and p.get("skin"):
            joint, parent = p["skin"]["joint"], p["skin"].get("parent")
            blend = 0 if parent is None else min(1, max(0, .5 + local.z * .94))
            indices.extend((joint, parent if parent is not None else joint, 0, 0))
            weights.extend((1 - blend, blend, 0, 0))
    attribute(mesh, "_sculptCoord", 3, coords)
    # 按面投影刻线坐标，避免倒角共享顶点的法线把平面纹理扭曲成云纹。
    for face in mesh.polygons:
        normal = face.normal
        for index in face.loop_indices:
            local = inverse_scale @ mesh.vertices[mesh.loops[index].vertex_index].co
            if abs(normal.z) > max(abs(normal.x), abs(normal.y)):
                detail_uv.extend((local.x + .5, -local.y + .5, 0))
            elif abs(normal.y) > abs(normal.x):
                detail_uv.extend((local.x + .5, local.z + .5, 0))
            else:
                detail_uv.extend((-local.y + .5, local.z + .5, 0))
    attribute(mesh, "_detailUV", 3, detail_uv, domain="CORNER")
    if indices:
        attribute(mesh, "_skinIndex", 4, indices)
        attribute(mesh, "_skinWeight", 4, weights)
    mesh.transform(rot.to_4x4())
    mesh.transform(Matrix.Translation(point(p["position"])))
    mesh.materials.append(material(p, slot, seed))
    obj["slot"], obj["part"] = slot, p["_part"]
    return obj


def join(objects, name):
    select(objects)
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def image(name, neutral=(0, 0, 0, 1)):
    img = bpy.data.images.new(name, opts.tile_size, opts.tile_size, alpha=False)
    img.generated_color = neutral
    if "albedo" not in name:
        img.colorspace_settings.name = "Non-Color"
    return img


def pixels(img):
    data = np.empty(opts.tile_size * opts.tile_size * 4, dtype=np.float32)
    img.pixels.foreach_get(data)
    return data.reshape(opts.tile_size, opts.tile_size, 4)


def uv_coverage(low):
    """低模自投射白色遮罩，区分 UV 空白与真正漏投的法线像素。"""
    target = image("UV coverage")
    select([low])
    saved = []
    margin = scene.render.bake.margin
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.use_cage = False
    scene.render.bake.margin = 0
    try:
        for mat in set(low.data.materials):
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            output = nodes.get("Material Output")
            original = output.inputs["Surface"].links[0].from_socket
            emit = nodes.new("ShaderNodeEmission")
            emit.inputs["Color"].default_value = (1, 1, 1, 1)
            links.new(emit.outputs[0], output.inputs["Surface"])
            nodes["Bake target"].image = target
            nodes.active = nodes["Bake target"]
            saved.append((mat, original, emit))
        bpy.ops.object.bake(type="EMIT")
        return pixels(target)[:, :, 0] > .999
    finally:
        for mat, original, emit in saved:
            mat.node_tree.links.new(original, mat.node_tree.nodes.get("Material Output").inputs["Surface"])
            mat.node_tree.nodes.remove(emit)
        scene.render.bake.margin = margin
        scene.render.bake.use_selected_to_active = True
        bpy.data.images.remove(target)


def bake(low, high, channel, target, projected=True):
    select([high, low] if projected else [low], low)
    for mat in set(low.data.materials) | set(high.data.materials):
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes["Bake target"].image = target
        nodes.active = nodes["Bake target"]
        bsdf, output, emit = nodes.get("Principled BSDF"), nodes.get("Material Output"), nodes["Bake emission"]
        if channel == "albedo":
            links.new(bsdf.inputs["Base Color"].links[0].from_socket, emit.inputs["Color"])
            links.new(emit.outputs[0], output.inputs["Surface"])
        elif channel == "roughness":
            links.new(nodes["Baked roughness"].outputs[0], emit.inputs["Color"])
            links.new(emit.outputs[0], output.inputs["Surface"])
        elif channel == "metalness":
            emit.inputs["Color"].default_value = (mat["metalness"],) * 3 + (1,)
            for link in list(emit.inputs["Color"].links):
                links.remove(link)
            links.new(emit.outputs[0], output.inputs["Surface"])
        else:
            links.new(bsdf.outputs[0], output.inputs["Surface"])
    bake_type = {"normal": "NORMAL", "ao": "AO"}.get(channel, "EMIT")
    scene.render.bake.use_selected_to_active = projected
    scene.render.bake.use_cage = projected and channel != "ao"
    try:
        bpy.ops.object.bake(type=bake_type, normal_space="TANGENT")
    finally:
        scene.render.bake.use_selected_to_active = True
    return pixels(target)


def split_runtime(low, key, parts):
    """按源码活动部件与三种材质拆回；每单位仍只有三类合批网格。"""
    result = []
    for part, slot, material_indices in parts:
        obj = low.copy()
        obj.data = low.data.copy()
        scene.collection.objects.link(obj)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        remove = [f for f in bm.faces if f.material_index not in material_indices]
        bmesh.ops.delete(bm, geom=remove, context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        if part >= 0:
            offset = point(doc["templates"][key]["moving"][part])
            obj.data.transform(Matrix.Translation(-offset))
            obj.location = offset
        # 烘焙坐标只属于美术工程；运行时不需要它。
        for name in ("_sculptCoord", "_detailUV", "_bakeOffset"):
            attr = obj.data.attributes.get(name)
            if attr:
                obj.data.attributes.remove(attr)
        obj["key"], obj["part"], obj["slot"] = key, part, slot
        obj.name = f"{key}|{part}|{slot}"
        result.append(obj)
    bpy.data.objects.remove(low, do_unlink=True)
    return result


def model(key):
    begin = time.time()
    low_pieces, high_pieces = [], []
    lookup = []
    material_offset = 0
    largest_part = 0
    custom_cage = None
    if key in sculpt_humanoids.HUMANOID_KEYS or key in sculpt_brood.BROOD_KEYS:
        builder = (sculpt_humanoids.HumanoidSculptor if key in sculpt_humanoids.HUMANOID_KEYS
                   else sculpt_brood.BroodSculptor)(key, doc["templates"][key]["rig"], scene)
        slot_groups = {}
        for low, high, slot in builder.build():
            offset = Vector((material_offset * 400, 0, 0))
            for obj in (low, high):
                attribute(obj.data, "_bakeOffset", 3, list(offset) * len(obj.data.vertices))
                obj.data.transform(Matrix.Translation(offset))
            mat = low.data.materials[0].copy()
            low.data.materials[0] = mat
            low_pieces.append(low)
            high_pieces.append(high)
            slot_groups.setdefault(slot, set()).add(material_offset)
            material_offset += 1
        for slot, indices in sorted(slot_groups.items()):
            lookup.append((-1, slot, indices))
        if key in sculpt_humanoids.HUMANOID_KEYS:
            custom_cage = .35
        elif key in {"brood:base", "brood:hatchery", "brood:refinery", "brood:gland", "brood:lumbermill", "brood:nursery", "brood:burrow"}:
            custom_cage = 1.65
        else:
            custom_cage = .88
    else:
        for item in [m for m in doc["meshes"] if m["key"] == key]:
            positions = source_values(item["attributes"]["position"])
            pieces = []
            if not item["primitives"]:
                raise ValueError("Missing semantic primitives: " + key)
            specs = list(item["primitives"])
            if key == "industrial:mech" and item["part"] == -1 and item["slot"] == 0:
                joints = doc["templates"][key]["rig"]
                torso = next(i for i, joint in enumerate(joints) if joint["name"] == "torso")
                origin = Vector(joints[torso]["origin"])
                center = origin + Vector((0, 12.63, 17.7))
                turn = Matrix.Rotation(-.38, 3, "X")
                # 胸甲前面的检修格栅与固定螺栓，随 torso 骨骼运动。
                details = [("bevel", "weapon", (0, 0, .25), (13, 3.5, .75))]
                details += [("bevel", "serviceSteel", (x, 0, .73), (.65, 2.4, .45))
                            for x in (-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8)]
                details += [("jointBall", "titanTrim", (x, y, .65), (.7, .7, .5))
                            for x in (-5.9, 5.9) for y in (-1.25, 1.25)]
                for shape, surface, offset, size in details:
                    specs.append({"shape": shape, "finish": {"surface": surface, "tint": 0xffffff, "gain": 1, "texture": 1},
                                  "position": list(center + turn @ Vector(offset)), "size": size,
                                  "rotation": (-.38, 0, 0), "skin": {"joint": torso}, "start": 0, "count": 0})
            for seed, spec in enumerate(specs):
                p = dict(spec, _part=item["part"])
                if p.get("skin"):
                    p["_jointName"] = doc["templates"][key]["rig"][p["skin"]["joint"]]["name"]
                largest_part = max(largest_part, *p["size"])
                if item["part"] >= 0:
                    at = doc["templates"][key]["moving"][item["part"]]
                    p["position"] = [value + at[i] for i, value in enumerate(p["position"])]
                low = primitive(p, positions, False, item["slot"], seed)
                high = primitive(p, positions, True, item["slot"], seed)
                # 分离投射：相邻装甲不会互相投到 UV 上，完成后恢复原装配位置。
                offset = Vector((material_offset * 400, 0, 0))
                for obj in (low, high):
                    attribute(obj.data, "_bakeOffset", 3, list(offset) * len(obj.data.vertices))
                    obj.data.transform(Matrix.Translation(offset))
                # 为每个安装部件建立独立材质引用，合并时不会丢失活动部件标签。
                mat = low.data.materials[0].copy()
                low.data.materials[0] = mat
                low_pieces.append(low)
                high_pieces.append(high)
                pieces.append(material_offset)
                material_offset += 1
            lookup.append((item["part"], item["slot"], set(pieces)))
    low, high = join(low_pieces, "UV cage " + key), join(high_pieces, "Sculpt high " + key)
    select([low])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.4, island_margin=.002, area_weight=1, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    targets = {c: image(f"{key} {c}", (.5, .5, 1, 1) if c == "normal" else (1, 1, 1, 1))
               for c in ("albedo", "normal", "ao", "roughness", "metalness")}
    # 粗低模的曲面弦与高模背脊可相差数个世界单位，固定 0.5 的 cage 会漏投。
    # 部件已相隔 400 单位；按最大部件尺度扩展 cage，仍只投射自身高模。
    cage = custom_cage if custom_cage is not None else max(1, largest_part * .075)
    scene.render.bake.cage_extrusion = cage
    scene.render.bake.max_ray_distance = cage * 2.5 + .8 if custom_cage is not None else cage * 2 + 2
    coverage = uv_coverage(low)
    log(f"BAKE {key} low={len(low.data.polygons)} high={len(high.data.polygons)}")
    color = bake(low, high, "albedo", targets["albedo"])
    normal = bake(low, high, "normal", targets["normal"])
    valid_pixels = int(np.count_nonzero(coverage))
    if valid_pixels == 0:
        raise ValueError("Empty UV coverage: " + key)
    lengths = np.linalg.norm(normal[:, :, :3] * 2 - 1, axis=2)
    # 多采样可缩短平均法线；零向量、超长向量和朝向低模内部的法线才判为缺损。
    backfacing_normals = normal[:, :, 2] < .5
    invalid_normals = (lengths > 1.25) | (lengths < .05) | backfacing_normals
    rough = bake(low, high, "roughness", targets["roughness"])
    metal = bake(low, high, "metalness", targets["metalness"])
    # 所有材质颜色均为正值、粗糙度至少为 0.12；零值只能来自投射缺损。
    invalid_material = (np.max(color[:, :, :3], axis=2) < 1e-6) | (rough[:, :, 0] < .01)
    invalid_projection = invalid_normals | invalid_material
    missing = coverage & invalid_projection
    missed_pixels = int(np.count_nonzero(missing))
    missed_fraction = missed_pixels / valid_pixels
    if missed_fraction > MAX_PROJECTION_FALLBACK:
        raise ValueError(f"High-to-low surface projection missed {missed_fraction:.2%}: {key}")
    for obj in (low, high):
        offsets = obj.data.attributes["_bakeOffset"]
        for vertex in obj.data.vertices:
            vertex.co -= offsets.data[vertex.index].vector
    ao = bake(low, high, "ao", targets["ao"])
    if missed_pixels:
        # 曲面轮廓附近允许最多 5% 的显式低模回退；超过限制则终止资产构建。
        # 不让漏投的黑色 albedo / 零粗糙度 / 非法 normal 进入最终纹理。
        high.hide_render = True
        for channel, data in (("albedo", color), ("normal", normal), ("roughness", rough),
                              ("metalness", metal), ("ao", ao)):
            fallback = bake(low, high, channel, targets[channel], projected=False)
            # 同时补齐这些像素周围的无效 padding，避免线性采样出现黑边。
            data[invalid_projection] = fallback[invalid_projection]
    repaired_lengths = np.linalg.norm(normal[:, :, :3] * 2 - 1, axis=2)
    neutral = (repaired_lengths > 1.25) | (repaired_lengths < .05) | (normal[:, :, 2] < .5)
    neutral_pixels = int(np.count_nonzero(coverage & neutral))
    if neutral_pixels > missed_pixels:
        raise ValueError("Low-surface fallback introduced invalid normals: " + key)
    # 极小退化尖端直接使用低模几何法线；颜色与 PBR 仍来自刚才的低模材质烘焙。
    normal[neutral] = (.5, .5, 1, 1)
    orm = np.ones_like(color)
    orm[:, :, 0], orm[:, :, 1], orm[:, :, 2] = ao[:, :, 0], rough[:, :, 0], metal[:, :, 0]
    # 空白像素只影响 UV padding；有效岛的投射缺损另在清单中统计。
    low_count, high_count = len(low.data.polygons), len(high.data.polygons)
    runtime = split_runtime(low, key, lookup)
    for target in targets.values():
        bpy.data.images.remove(target)
    high.hide_render = True
    high.hide_set(True)
    log(f"DONE {key} {time.time() - begin:.1f}s")
    return runtime, high, {"albedo": color, "normal": normal, "orm": orm}, {
        "key": key, "lowFaces": low_count, "highFaces": high_count,
        "scriptHash": script_hash,
        "tileSize": opts.tile_size, "bake": ["EMIT", "NORMAL_TANGENT_SELECTED_TO_ACTIVE", "AO", "ROUGHNESS", "METALNESS"],
        "projection": {"cageExtrusion": cage, "maxRayDistance": cage * 2 + 2,
                       "uvPixels": valid_pixels,
                       "missedNormalPixels": int(np.count_nonzero(coverage & invalid_normals)),
                       "backfacingNormalPixels": int(np.count_nonzero(coverage & backfacing_normals)),
                       "missedMaterialPixels": int(np.count_nonzero(coverage & invalid_material)),
                       "missedProjectionPixels": missed_pixels,
                       "lowSurfaceFallbackPixels": missed_pixels, "neutralNormalPixels": neutral_pixels},
    }


def preview_material(images, slot, pack):
    mat = bpy.data.materials.new(f"Baked game PBR {pack} {slot}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for channel in ("albedo", "normal", "orm"):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = images[channel]
        if channel == "albedo":
            if slot == 1:
                team = nodes.new("ShaderNodeMixRGB")
                team.blend_type = "MULTIPLY"
                team.inputs[0].default_value = 1
                team.inputs[2].default_value = (.17, .35, .09, 1)
                links.new(tex.outputs[0], team.inputs[1])
                links.new(team.outputs[0], bsdf.inputs["Base Color"])
            else:
                links.new(tex.outputs[0], bsdf.inputs["Base Color"])
        elif channel == "normal":
            normal = nodes.new("ShaderNodeNormalMap")
            links.new(tex.outputs[0], normal.inputs["Color"])
            links.new(normal.outputs[0], bsdf.inputs["Normal"])
        else:
            separate = nodes.new("ShaderNodeSeparateColor")
            links.new(tex.outputs[0], separate.inputs[0])
            links.new(separate.outputs["Green"], bsdf.inputs["Roughness"])
            links.new(separate.outputs["Blue"], bsdf.inputs["Metallic"])
    if slot == 2:
        color = {"industrial": (.15, .5, .8, 1), "brood": (.8, .3, .025, 1),
                 "stellar": (.025, .65, .8, 1), "relay": (.8, .48, .08, 1)}[pack]
        bsdf.inputs["Base Color"].default_value = color
        for link in list(bsdf.inputs["Base Color"].links):
            links.remove(link)
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = 1.8
    return mat


def render_preview(objects, key):
    select(objects)
    bpy.context.view_layer.update()
    all_points = [obj.matrix_world @ Vector(v) for obj in objects for v in obj.bound_box]
    lower = Vector(tuple(min(v[i] for v in all_points) for i in range(3)))
    upper = Vector(tuple(max(v[i] for v in all_points) for i in range(3)))
    center, extent = (lower + upper) * .5, max(upper - lower)
    bpy.ops.object.camera_add(location=center + Vector((1.35, -1.8, 1.25)) * extent)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = extent * 1.38
    scene.camera = camera
    lights = []
    for offset, power, color in [((-1, -1.5, 2), 1500, (1, .85, .68)),
                                  ((1, .7, 1.5), 1100, (.45, .74, 1))]:
        bpy.ops.object.light_add(type="AREA", location=center + Vector(offset) * extent)
        light = bpy.context.object
        light.data.energy = power * extent * extent / 10
        light.data.shape = "DISK"
        light.data.size = extent * 1.3
        light.data.color = color
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        lights.append(light)
    scene.render.resolution_x = scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.cycles.samples = 24
    scene.render.filepath = str(editable / (key.replace(":", "-") + ".png"))
    bpy.ops.render.render(write_still=True)
    scene.cycles.samples = 8
    for obj in [camera, *lights]:
        bpy.data.objects.remove(obj, do_unlink=True)


def armature(root, objects, key):
    joints = doc["templates"][key]["rig"]
    if not joints:
        return
    data = bpy.data.armatures.new("Rig " + key)
    rig = bpy.data.objects.new("Rig " + key, data)
    scene.collection.objects.link(rig)
    rig.parent = root
    rig.show_in_front = True
    rig["rigContract"] = root["rigContract"]
    select([rig])
    bpy.ops.object.mode_set(mode="EDIT")
    bones = []
    for index, joint in enumerate(joints):
        bone = data.edit_bones.new(joint["name"])
        bone.head = point(joint["origin"])
        children = [j for j in joints if j["parent"] == index]
        bone.tail = point(children[0]["origin"]) if children else bone.head + Vector((0, 0, 3))
        if (bone.tail - bone.head).length < .001:
            bone.tail = bone.head + Vector((0, 0, 3))
        if joint["parent"] >= 0:
            bone.parent = bones[joint["parent"]]
        bones.append(bone)
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in objects:
        obj.parent = rig
        ids, weights = obj.data.attributes["_skinIndex"], obj.data.attributes["_skinWeight"]
        groups = [obj.vertex_groups.new(name=j["name"]) for j in joints]
        buckets = {}
        for vertex in obj.data.vertices:
            influences = {}
            for joint, weight in zip(ids.data[vertex.index].color, weights.data[vertex.index].color):
                if weight > 0:
                    index = round(joint)
                    influences[index] = influences.get(index, 0) + weight
            for index, weight in influences.items():
                buckets.setdefault((index, weight), []).append(vertex.index)
        for (index, weight), vertices in buckets.items():
            groups[index].add(vertices, weight, "REPLACE")
        modifier = obj.modifiers.new("Editable game skin", "ARMATURE")
        modifier.object = rig


def pack(name, keys):
    # 隐藏高模也要释放；仅删除选中对象会让前一阵营的雕刻网格留在内存里。
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for block in list(collection):
            if not block.users:
                collection.remove(block)
    columns = min(len(keys), 6, math.ceil(math.sqrt(len(keys) * 1.4)))
    rows = math.ceil(len(keys) / columns)
    atlases = {channel: np.ones((rows * opts.tile_size, columns * opts.tile_size, 4), dtype=np.float32)
               for channel in ("albedo", "normal", "orm")}
    atlases["normal"][:, :, :3] = (.5, .5, 1)
    runtime, highs, reports = [], [], []
    for index, key in enumerate(keys):
        objects, high, tiles, report = model(key)
        x, y = index % columns, index // columns
        for channel, tile in tiles.items():
            atlases[channel][y * opts.tile_size:(y + 1) * opts.tile_size,
                             x * opts.tile_size:(x + 1) * opts.tile_size] = tile
        for obj in objects:
            uv = obj.data.uv_layers.active
            for item in uv.data:
                item.uv = ((x + item.uv.x) / columns, (y + item.uv.y) / rows)
        runtime.extend(objects)
        highs.append(high)
        report["tile"] = [x, y]
        reports.append(report)
        doc["templates"][key]["surface"] = name
        # 更新真实美术包围盒，保留代码独立拥有的碰撞体和关节定义。
        points = []
        for obj in objects:
            offset = doc["templates"][key]["moving"][obj["part"]] if obj["part"] >= 0 else (0, 0, 0)
            points.extend((v[0] + offset[0], v[2] + offset[1], -v[1] + offset[2]) for v in obj.bound_box)
        doc["templates"][key]["bounds"] = [[min(v[i] for v in points) for i in range(3)],
                                          [max(v[i] for v in points) for i in range(3)]]
        for obj in objects:
            obj.hide_set(True)
            obj.hide_render = True
    images = {}
    for channel, data in atlases.items():
        img = bpy.data.images.new(f"{name} dedicated {channel}", columns * opts.tile_size, rows * opts.tile_size, alpha=False)
        if channel != "albedo":
            img.colorspace_settings.name = "Non-Color"
        img.pixels.foreach_set(data.ravel())
        img.filepath_raw = str(out / f"{name}-{channel}.png")
        img.file_format = "PNG"
        img.save()
        img.pack()
        images[channel] = img
    mats = [preview_material(images, slot, name) for slot in range(3)]
    for obj in runtime:
        obj.data.materials.clear()
        obj.data.materials.append(mats[obj["slot"]])
        for face in obj.data.polygons:
            face.material_index = 0
        obj.hide_set(False)
        obj.hide_render = False
    select(runtime)
    bpy.ops.export_scene.gltf(
        filepath=str(out / f"{name}.glb"), export_format="GLB", use_selection=True,
        export_attributes=True, export_extras=True, export_materials="NONE",
        export_vertex_color="NONE", export_cameras=False, export_lights=False,
        export_meshopt_compression_enable=True, export_meshopt_extension="EXT_meshopt_compression",
    )
    featured = {"industrial": "mech", "brood": "behemoth", "stellar": "colossus", "relay": "ranger"}
    target = opts.only_key or f'{name}:{featured[name]}'
    for obj in runtime:
        obj.hide_render = obj["key"] != target
    render_preview([obj for obj in runtime if obj["key"] == target], target)
    for index, key in enumerate(keys):
        root = bpy.data.objects.new("Model " + key, None)
        scene.collection.objects.link(root)
        root.location = ((index % 5) * 210, (index // 5) * 210, 0)
        root["key"] = key
        root["rigContract"] = json.dumps(doc["templates"][key]["rig"], separators=(",", ":"))
        for obj in [o for o in runtime if o["key"] == key] + [highs[index]]:
            obj.parent = root
            obj.hide_render = obj in highs
        armature(root, [o for o in runtime if o["key"] == key], key)
    scene["workflow"] = "High sculpt + independent UV cage + Cycles selected-to-active tangent normal / AO / material bake"
    scene["reference"] = "public/assets/generated/model-portraits-v2.webp"
    bpy.ops.wm.save_as_mainfile(filepath=str(editable / (name + ("-test" if opts.only_key else "") + ".blend")), compress=True)
    for img in images.values():
        bpy.data.images.remove(img)
    for mesh in list(bpy.data.meshes):
        if not mesh.users:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if not mat.users:
            bpy.data.materials.remove(mat)
    suffix = "-test" if opts.only_key else ""
    (editable / f"{name}{suffix}-bake.json").write_text(json.dumps(reports, indent=2) + "\n")
    return {"albedo": f"{name}-albedo.png", "normal": f"{name}-normal.png", "orm": f"{name}-orm.png"}


surfaces = {}
previous = None
if opts.only:
    previous = json.loads((out / "manifest.json").read_text())
    for key, template in previous["templates"].items():
        if not key.startswith(opts.only + ":"):
            if template["rig"] != doc["templates"][key]["rig"]:
                raise ValueError("Unbuilt pack rig changed: " + key)
            doc["templates"][key] = template
    surfaces.update(previous["surfaces"])
for name in ("industrial", "brood", "stellar", "relay"):
    if opts.only and name != opts.only:
        continue
    keys = [key for key in doc["portraits"] if key.startswith(name + ":") and (not opts.only_key or key == opts.only_key)]
    if keys:
        surfaces[name] = pack(name, keys)
if not opts.only_key:
    legacy = json.loads((project / "public/assets/blender-v1/manifest.json").read_text())
    textures = [f"../blender-v1/{c}.png" for c in ("albedo", "normal", "orm")]
    manifest = {
        "version": 2, "generator": "Blender semantic sculpt / Cycles high-to-low dedicated PBR",
        "reference": "generated/model-portraits-v2.webp", "templates": doc["templates"],
        "scriptHash": script_hash,
        "packs": [f"{name}.glb" for name in surfaces] + ["../blender-v1/nature.glb"],
        "textures": textures + [p for surface in surfaces.values() for p in surface.values()],
        "surfaces": surfaces, "legacyTextures": dict(zip(("albedo", "normal", "orm"), textures)),
    }
    missing = set(legacy["templates"]) - set(k for k in doc["templates"] if "surface" in doc["templates"][k])
    if missing:
        raise ValueError("Missing portrait sculpt models: " + str(missing))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
log("COMPLETE")
