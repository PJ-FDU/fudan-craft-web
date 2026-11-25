"""幽影狙击手：独立形体、高低模、2K PBR 和源码骨骼。

尺寸是游戏世界单位；步枪采用精密栓动步枪的外形比例，不是武器制造图。
布料轮廓、硬表面倒角和枪口孔洞均进入实际游戏网格。
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

parser = argparse.ArgumentParser()
parser.add_argument("--project", required=True)
parser.add_argument("--source", required=True)
parser.add_argument("--resolution", type=int, default=2048)
parser.add_argument("--device", choices=["CPU", "METAL"], default="METAL")
parser.add_argument("--preview-only", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
root = Path(args.project)
directory = root / "artifacts/sniper-hero"
directory.mkdir(parents=True, exist_ok=True)
template = json.loads((Path(args.source) / "source.json").read_text())["templates"]["industrial:sniper"]
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
    if not any(device.type == "METAL" for device in preferences.devices):
        raise ValueError("Metal GPU is unavailable")
    for device in preferences.devices:
        device.use = device.type == "METAL"
    scene.cycles.device = "GPU"
scene.view_settings.view_transform = "AgX"
scene.world.color = (.13, .13, .13)
scene.render.image_settings.file_format = "PNG"
scene.render.bake.margin = max(4, args.resolution // 256)
low_collection = bpy.data.collections.new("01 · GAME LOW / skinned recon operator")
high_collection = bpy.data.collections.new("02 · HIGH / cloth folds + machined edges")
scene.collection.children.link(low_collection)
scene.collection.children.link(high_collection)
pieces = []

# 色彩是涂层本色；光照来自运行时，织物、玻璃与金属各有独立响应。
PALETTE = {
    "cloth": ((.34, .38, .26), .87, 0),
    "cloak": ((.43, .45, .31), .91, 0),
    "webbing": ((.26, .28, .20), .92, 0),
    "tan": ((.50, .45, .32), .82, 0),
    "armor": ((.22, .26, .23), .61, .12),
    "rubber": ((.09, .105, .085), .89, 0),
    "glove": ((.18, .20, .16), .86, 0),
    "gun": ((.19, .225, .22), .43, .72),
    "chassis": ((.36, .37, .29), .57, .10),
    "steel": ((.36, .40, .41), .30, .86),
    "recess": ((.025, .035, .033), .65, .30),
    "optic": ((.08, .12, .14), .35, .64),
    "lens": ((.045, .18, .24), .15, .25),
    "goggle": ((.10, .19, .20), .20, .14),
    "thread": ((.56, .54, .40), .9, 0),
    "team": ((.70, .72, .65), .68, .05),
    "lamp": ((.36, .68, .69), .35, .05),
}


def log(text):
    print("SNIPER " + text, flush=True)


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
    color, rough, metal = PALETTE[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat["metalness"] = metal
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    coords = nodes.new("ShaderNodeAttribute")
    coords.attribute_name = "_installCoord"
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = .55
    noise.inputs["Detail"].default_value = 3
    links.new(coords.outputs["Vector"], noise.inputs[0])
    ramp = nodes.new("ShaderNodeValToRGB")
    a, b = ramp.color_ramp.elements
    a.position, b.position = .20, .80
    a.color = tuple(linear(v * .82) for v in color) + (1,)
    b.color = tuple(linear(min(1, v * 1.11)) for v in color) + (1,)
    links.new(noise.outputs["Fac"], ramp.inputs[0])
    base = ramp.outputs[0]
    if name in {"cloth", "cloak"}:
        # 柔和分层的军用丛林迷彩（避免生硬色块），叠加折痕加深与轻微下摆野战积灰。
        camo = nodes.new("ShaderNodeTexNoise")
        camo.inputs["Scale"].default_value = .36
        camo.inputs["Detail"].default_value = 4
        camo.inputs["Roughness"].default_value = .68
        links.new(coords.outputs["Vector"], camo.inputs[0])
        colors = nodes.new("ShaderNodeValToRGB")
        colors.color_ramp.interpolation = "LINEAR"
        for item, position, rgb in zip(
                [*colors.color_ramp.elements, colors.color_ramp.elements.new(.54),
                 colors.color_ramp.elements.new(.74)],
                [.26, .42, .54, .74],
                [(.16, .19, .13), (.27, .31, .21), (.38, .39, .27), (.21, .24, .16)]):
            item.position = position
            item.color = tuple(linear(v) for v in rgb) + (1,)
        links.new(camo.outputs["Fac"], colors.inputs[0])
        base = colors.outputs[0]
        geom = nodes.new("ShaderNodeNewGeometry")
        crease = nodes.new("ShaderNodeMapRange")
        crease.inputs["From Min"].default_value = .44
        crease.inputs["From Max"].default_value = .498
        crease.inputs["To Min"].default_value = .45
        crease.inputs["To Max"].default_value = 0.0
        links.new(geom.outputs["Pointiness"], crease.inputs["Value"])
        shaded = nodes.new("ShaderNodeMixRGB")
        links.new(crease.outputs[0], shaded.inputs[0])
        links.new(base, shaded.inputs[1])
        shaded.inputs[2].default_value = tuple(linear(v) for v in (.09, .11, .07)) + (1,)
        base = shaded.outputs[0]
        sep = nodes.new("ShaderNodeSeparateXYZ")
        links.new(coords.outputs["Vector"], sep.inputs[0])
        grime = nodes.new("ShaderNodeMapRange")
        grime.inputs["From Min"].default_value = 0.0
        grime.inputs["From Max"].default_value = 11.0
        grime.inputs["To Min"].default_value = .25
        grime.inputs["To Max"].default_value = 0.0
        links.new(sep.outputs["Z"], grime.inputs["Value"])
        dirty = nodes.new("ShaderNodeMixRGB")
        links.new(grime.outputs[0], dirty.inputs[0])
        links.new(base, dirty.inputs[1])
        dirty.inputs[2].default_value = tuple(linear(v) for v in (.24, .21, .16)) + (1,)
        base = dirty.outputs[0]
    if name in {"gun", "chassis", "steel", "optic", "armor"}:
        geom = nodes.new("ShaderNodeNewGeometry")
        edges = nodes.new("ShaderNodeValToRGB")
        edges.color_ramp.elements[0].position = .51
        edges.color_ramp.elements[1].position = .56
        links.new(geom.outputs["Pointiness"], edges.inputs[0])
        wear = nodes.new("ShaderNodeMixRGB")
        links.new(edges.outputs[0], wear.inputs[0])
        links.new(base, wear.inputs[1])
        wear.inputs[2].default_value = tuple(linear(v) for v in (.48, .49, .44)) + (1,)
        base = wear.outputs[0]
    links.new(base, bsdf.inputs["Base Color"])
    micro = nodes.new("ShaderNodeTexNoise")
    micro.inputs["Scale"].default_value = 38 if name in {"cloth", "cloak", "webbing"} else 68
    micro.inputs["Detail"].default_value = 2
    links.new(coords.outputs["Vector"], micro.inputs[0])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0 if name in {"lens", "goggle", "lamp"} else .16
    bump.inputs["Distance"].default_value = .018 if metal < .5 else .007
    if name in {"cloth", "cloak", "webbing", "tan"}:
        weave = nodes.new("ShaderNodeTexWave")
        weave.wave_type = "BANDS"
        weave.bands_direction = "DIAGONAL"
        weave.inputs["Scale"].default_value = 44
        weave.inputs["Distortion"].default_value = 1.2
        links.new(coords.outputs["Vector"], weave.inputs[0])
        links.new(weave.outputs["Fac"], bump.inputs["Height"])
    else:
        links.new(micro.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs[0], bsdf.inputs["Normal"])
    variation = nodes.new("ShaderNodeMapRange")
    links.new(micro.outputs["Fac"], variation.inputs["Value"])
    variation.inputs["To Min"].default_value = max(.08, rough - .035)
    variation.inputs["To Max"].default_value = min(1, rough + .035)
    links.new(variation.outputs[0], bsdf.inputs["Roughness"])
    nodes.new("ShaderNodeEmission").name = "Bake emission"
    nodes.new("ShaderNodeTexImage").name = "Bake target"
    return mat


def mesh_object(name, vertices, faces, surface, joint, high, bevel=0, smooth=False):
    # 建模参数相对于源码关节；安装坐标随离线爆炸烘焙保持不变。
    origin = Vector(joints[joint_ids[joint]]["origin"])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([point(origin + Vector(p)) for p in vertices], [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name + (" · HIGH" if high else " · LOW"), mesh)
    (high_collection if high else low_collection).objects.link(obj)
    select([obj])
    if bevel:
        modifier = obj.modifiers.new("Controlled edge radius", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4 if high else 1
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = .35
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for face in obj.data.polygons:
        face.use_smooth = True
    if not smooth:
        modifier = obj.modifiers.new("Machined face normals", "WEIGHTED_NORMAL")
        modifier.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    mesh = obj.data
    attr(mesh, "_installCoord", [c for v in mesh.vertices for c in v.co])
    if not high:
        attr(mesh, "_skinIndex", [joint_ids[joint], 0, 0, 0] * len(mesh.vertices), 4)
        attr(mesh, "_skinWeight", [1, 0, 0, 0] * len(mesh.vertices), 4)
    mesh.materials.append(material(surface))
    obj["joint"], obj["surface"] = joint, surface
    obj["slot"] = 1 if surface == "team" else 2 if surface == "lamp" else 0
    return obj


def pair(name, maker, surface="cloth", joint="torso", bevel=.06, smooth=False):
    result = [mesh_object(name, *maker(high), surface, joint, high, bevel, smooth) for high in (False, True)]
    pieces.append(result)
    return result


def box(name, center, size, surface="cloth", joint="torso", radius=.06, rotation=(0, 0, 0)):
    transform = Euler(rotation).to_matrix()
    vertices = [tuple(Vector(center) + transform @ Vector((a*size[0]/2, b*size[1]/2, c*size[2]/2)))
                for a, b, c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                                (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)]
    return pair(name, lambda high: (vertices, faces), surface, joint, radius)


def extrusion(name, profile, x, width, surface="gun", joint="rifle", radius=.045):
    count = len(profile)
    vertices = [(at, y, z) for at in (x-width/2, x+width/2) for z, y in profile]
    faces = [tuple(reversed(range(count))), tuple(count+i for i in range(count))]
    faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    return pair(name, lambda high: (vertices, faces), surface, joint, radius)


def cylinder(name, start, end, radius, surface="gun", joint="rifle", bevel=.03, sides=20):
    start, end = Vector(start), Vector(end)
    axis = (end-start).normalized()
    cross = axis.cross(Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))).normalized()
    other = axis.cross(cross)
    def maker(high):
        count = sides*2 if high else sides
        vertices = [tuple(at + (math.cos(i*math.tau/count)*cross + math.sin(i*math.tau/count)*other)*radius)
                    for at in (start,end) for i in range(count)]
        faces = [tuple(reversed(range(count))), tuple(count+i for i in range(count))]
        faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
        return vertices, faces
    return pair(name, maker, surface, joint, bevel, True)


def tube(name, center, profile, surface="gun", joint="rifle"):
    """profile = (轴向 z、外径半径、内径半径)；端口与内壁都是真实表面。"""
    def maker(high):
        count = 48 if high else 24
        vertices, faces = [], []
        for z, outer, inner in profile:
            for radius in (outer,inner):
                for i in range(count):
                    angle = i*math.tau/count
                    vertices.append((center[0]+math.cos(angle)*radius,
                                     center[1]+math.sin(angle)*radius,center[2]+z))
        for k in range(len(profile)-1):
            for layer in (0,1):
                for i in range(count):
                    a = k*count*2+layer*count+i
                    b = k*count*2+layer*count+(i+1)%count
                    faces.append((a,b,b+count*2,a+count*2))
        for k in (0,len(profile)-1):
            offset = k*count*2
            for i in range(count):
                j = (i+1)%count
                faces.append((offset+i,offset+j,offset+count+j,offset+count+i))
        return vertices, faces
    return pair(name, maker, surface, joint, .015, True)


def cable(name, path, radius=.06, surface="webbing", joint="torso"):
    points = [Vector(p) for p in path]
    def maker(high):
        count = 10 if high else 6
        vertices, faces = [], []
        for i, at in enumerate(points):
            axis = (points[min(i+1,len(points)-1)]-points[max(i-1,0)]).normalized()
            cross = axis.cross(Vector((0,1,0)) if abs(axis.y)<.9 else Vector((1,0,0))).normalized()
            other = axis.cross(cross)
            for j in range(count):
                vertices.append(tuple(at+(math.cos(j*math.tau/count)*cross+math.sin(j*math.tau/count)*other)*radius))
        for i in range(len(points)-1):
            for j in range(count):
                a, b = i*count+j, i*count+(j+1)%count
                faces.append((a,b,b+count,a+count))
        faces += [tuple(reversed(range(count))), tuple((len(points)-1)*count+j for j in range(count))]
        return vertices, faces
    return pair(name, maker, surface, joint, 0, True)


def cloth(name, levels, joint, surface="cloth", phase=0):
    """各高度的椭圆截面 + 局部折痕，腿、袖子与兜帽保持圆润轮廓。"""
    def maker(high):
        count = 40 if high else 20
        vertices, faces = [], []
        rows = []
        for a,b in zip(levels,levels[1:]):
            for step in range(3 if high else 1):
                t = step/(3 if high else 1)
                rows.append(tuple(v+(w-v)*t for v,w in zip(a,b)))
        rows.append(levels[-1])
        for k, (y, rx, rz, zc) in enumerate(rows):
            for i in range(count):
                a = i*math.tau/count
                # 低模保留轮廓褶皱，高模补充斜向堆积折痕供切线法线投射。
                wrinkle = 1 + .035*math.sin(a*6+phase+y*1.5) + .025*math.cos(a*9-y)
                if high:
                    wrinkle += .035*math.sin(a*4+y*5+phase)*(.35+.65*min(1,abs(y)/4))
                vertices.append((math.cos(a)*rx*wrinkle,y+.10*math.sin(a*2+y+phase),
                                 zc+math.sin(a)*rz*wrinkle))
        for k in range(len(rows)-1):
            for i in range(count):
                a,b=k*count+i,k*count+(i+1)%count
                faces.append((a,b,b+count,a+count))
        faces += [tuple(reversed(range(count))), tuple((len(rows)-1)*count+i for i in range(count))]
        return vertices, faces
    return pair(name, maker, surface, joint, 0, True)


def cloak(name, side, joint="torso"):
    def maker(high):
        columns, rows = (32,36) if high else (16,18)
        vertices, faces = [], []
        for layer in (-1,1):
            for j in range(rows+1):
                t=j/rows
                for i in range(columns+1):
                    u=i/columns
                    # 肩部窄、下摆展开；下沿不接近脚跟，给步态留下间距。
                    x=side*(.15+u*(5.0+t*1.0))
                    y=10.5-t*23.2+.35*math.sin(u*math.pi*3)*t*t
                    bend=min(1,t/.24);bend=bend*bend*(3-2*bend)
                    z=-4.9-2.25*bend-t*.4-.5*math.cos(u*math.pi*5+.2+t*.7)*(.3+t*.7)
                    vertices.append((x,y,z+layer*.075))
        plane=(columns+1)*(rows+1)
        for layer in range(2):
            for j in range(rows):
                for i in range(columns):
                    a=layer*plane+j*(columns+1)+i
                    faces.append((a,a+1,a+columns+2,a+columns+1))
        for j in range(rows):
            for i in (0,columns):
                a=j*(columns+1)+i;b=a+columns+1
                faces.append((a,b,b+plane,a+plane))
        for j in (0,rows):
            for i in range(columns):
                a=j*(columns+1)+i
                faces.append((a,a+plane,a+plane+1,a+1))
        return vertices, faces
    result=pair(name,maker,"cloak",joint,0,True)
    # [SNIPER-CAPE] 顶点在相邻两段之间连续混合，不能整块刚性绑定躯干。
    low=result[0]
    for vertex in low.data.vertices:
        y=vertex.co.z-joints[joint_ids[joint]]["origin"][1]
        along=max(0,min(3,(10.4-y)/7))
        first=min(2,int(along));fraction=along-first
        prefix="L" if side<0 else "R"
        low.data.attributes["_skinIndex"].data[vertex.index].color=(
            joint_ids[prefix+"Cape"+str(first)],joint_ids[prefix+"Cape"+str(first+1)],0,0)
        low.data.attributes["_skinWeight"].data[vertex.index].color=(1-fraction,fraction,0,0)
    return result


def carrier(name, levels, surface="armor"):
    """随胸腔收腰的弧形薄壳；横截面厚度与宽度分别控制。"""
    def maker(high):
        count=24 if high else 12
        vertices,faces=[],[]
        for layer in (0,1):
            for y,width,z in levels:
                for i in range(count+1):
                    u=-1+2*i/count
                    vertices.append((u*width,y,z-.65*u*u-layer*.48))
        plane=(count+1)*len(levels)
        for layer in range(2):
            for row in range(len(levels)-1):
                for i in range(count):
                    a=layer*plane+row*(count+1)+i
                    faces.append((a,a+1,a+count+2,a+count+1))
        for row in range(len(levels)-1):
            for i in (0,count):
                a=row*(count+1)+i;b=a+count+1
                faces.append((a,b,b+plane,a+plane))
        for row in (0,len(levels)-1):
            for i in range(count):
                a=row*(count+1)+i
                faces.append((a,a+plane,a+plane+1,a+1))
        return vertices,faces
    return pair(name,maker,surface,"torso",.055,True)


def anatomical_loft(name, levels, joint, surface="cloth", phase=0, wrinkle_amp=.032, shape_fn=None):
    """非对称解剖截面放样：levels = [(y, xc, zc, rxp, rxn, rzp, rzn), ...]"""
    def maker(high):
        count = 40 if high else 20
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
                        mod += wrinkle_amp * .55 * env * math.sin(a * 4 + y * 4.5 + phase)
                verts.append((xc + ca * rx * mod, y, zc + sa * rz * mod))
        for k in range(len(rows) - 1):
            for i in range(count):
                a, b = k * count + i, k * count + (i + 1) % count
                faces.append((a, b, b + count, a + count))
        c0 = len(verts); y, xc, zc, rxp, rxn, rzp, rzn = rows[0]
        verts.append((xc, y - min(rxp, rxn, rzp, rzn) * .12, zc))
        for i in range(count):
            faces.append((c0, (i + 1) % count, i))
        c1 = len(verts); y, xc, zc, rxp, rxn, rzp, rzn = rows[-1]
        verts.append((xc, y + min(rxp, rxn, rzp, rzn) * .12, zc))
        base = (len(rows) - 1) * count
        for i in range(count):
            faces.append((c1, base + i, base + (i + 1) % count))
        return verts, faces
    return pair(name, maker, surface, joint, 0, True)


def curved_shell(name, eval_fn, u_lo, v_lo, u_hi, v_hi, thickness, surface, joint, wrap_u=False):
    """贴合解剖曲面的双面带厚度护甲/披肩/护具薄壳。"""
    def maker(high):
        nu, nv = (u_hi, v_hi) if high else (u_lo, v_lo)
        u_cnt = nu if wrap_u else (nu + 1)
        grid = [[eval_fn(i / nu, j / nv, high) for i in range(u_cnt)] for j in range(nv + 1)]
        verts, faces = [], []
        half = thickness * .5
        for layer in (1.0, -1.0):
            for j in range(nv + 1):
                for i in range(u_cnt):
                    p, n = grid[j][i]
                    nv_v = Vector(n)
                    nv_v = nv_v.normalized() if nv_v.length > 1e-6 else Vector((0, 0, 1))
                    verts.append((p[0] + nv_v.x * half * layer,
                                  p[1] + nv_v.y * half * layer,
                                  p[2] + nv_v.z * half * layer))
        plane = u_cnt * (nv + 1)
        for j in range(nv):
            for i in range(nu):
                ni = (i + 1) % u_cnt
                a0, a1 = j * u_cnt + i, j * u_cnt + ni
                a2, a3 = (j + 1) * u_cnt + ni, (j + 1) * u_cnt + i
                faces.append((a0, a1, a2, a3))
                faces.append((plane + a0, plane + a3, plane + a2, plane + a1))
        for i in range(nu):
            ni = (i + 1) % u_cnt
            faces.append((i, plane + i, plane + ni, ni))
            b0, b1 = nv * u_cnt + i, nv * u_cnt + ni
            faces.append((b0, b1, plane + b1, plane + b0))
        if not wrap_u:
            for j in range(nv):
                a = j * u_cnt
                faces.append((a, a + u_cnt, plane + a + u_cnt, plane + a))
                b = j * u_cnt + nu
                faces.append((b, plane + b, plane + b + u_cnt, b + u_cnt))
        return verts, faces
    return pair(name, maker, surface, joint, 0, True)


def build_sniper_boot(side, s, foot_joint):
    """雕塑解剖级战术军靴（替代方块靴）：收腰足弓、杏仁鞋头、锯齿橡胶底与交叉鞋带。"""
    bx = -s * .35  # 与自然内收小腿力线对齐；Foot 关节原点在 y=1.65，地面在 y=-1.65
    z_sections = [
        (-2.05, 1.32, -1.24, 1.35),
        (-1.35, 1.62, -1.30, 1.48),
        (-.08,  1.46, -1.16, .95),
        (1.25,  1.66, -1.28, .32),
        (2.75,  1.62, -1.30, -.08),
        (3.90,  1.24, -1.20, -.38),
        (4.55,  .68,  -1.02, -.68),
    ]
    def upper_maker(high):
        around = 32 if high else 18
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
                verts.append((bx + px, py, z))
        for r in range(len(rows) - 1):
            for c in range(around):
                a, b = r * around + c, r * around + (c + 1) % around
                faces.append((a, a + around, b + around, b))
        cb = len(verts); z0, _, lo0, hi0 = rows[0]; verts.append((bx, (lo0 + hi0) * .5, z0 - .30))
        for c in range(around):
            faces.append((cb, c, (c + 1) % around))
        cf = len(verts); z1, _, lo1, hi1 = rows[-1]; verts.append((bx, (lo1 + hi1) * .5, z1 + .26))
        base = (len(rows) - 1) * around
        for c in range(around):
            faces.append((cf, base + (c + 1) % around, base + c))
        return verts, faces
    pair("Sculpted combat boot", upper_maker, "glove", foot_joint, 0, True)

    sole_sections = [
        (-2.12, 1.42, -1.65, -1.12), (-1.25, 1.72, -1.65, -1.12), (.00, 1.44, -1.52, -1.10),
        (1.25,  1.78, -1.65, -1.12), (2.90,  1.72, -1.65, -1.12), (4.05, 1.30, -1.56, -1.08),
        (4.68,  .74,  -1.42, -.98),
    ]
    def sole_maker(high):
        around = 28 if high else 16
        verts, faces = [], []
        for z, hw, ylo, yhi in sole_sections:
            yc, hy = (ylo + yhi) * .5, (yhi - ylo) * .5
            for c in range(around):
                ang = c * math.tau / around
                ca, sa = math.cos(ang), math.sin(ang)
                verts.append((bx + math.copysign(abs(ca) ** .65, ca) * hw,
                              yc + math.copysign(abs(sa) ** .55, sa) * hy, z))
        for r in range(len(sole_sections) - 1):
            for c in range(around):
                a, b = r * around + c, r * around + (c + 1) % around
                faces.append((a, a + around, b + around, b))
        cb = len(verts); verts.append((bx, -1.38, -2.24))
        for c in range(around):
            faces.append((cb, c, (c + 1) % around))
        cf = len(verts); verts.append((bx, -1.20, 4.80))
        base = (len(sole_sections) - 1) * around
        for c in range(around):
            faces.append((cf, base + (c + 1) % around, base + c))
        return verts, faces
    pair("Sculpted boot sole", sole_maker, "rubber", foot_joint, 0, True)

    anatomical_loft("Boot ankle collar", [
        (.35,  bx, -.12, 1.58, 1.58, 1.66, 1.60),
        (1.55, bx, -.08, 1.54, 1.54, 1.60, 1.54),
        (2.85, bx, -.10, 1.66, 1.66, 1.68, 1.76),
    ], foot_joint, "glove", phase=s, wrinkle_amp=.020)
    for y_l, z_l in ((.48, .85), (.24, 1.38), (.04, 1.92)):
        cable("Boot lace", [(bx - .82, y_l, z_l), (bx, y_l + .15, z_l + .34), (bx + .82, y_l, z_l)],
              .065, "thread", foot_joint)


def build_operator():
    # 自然骨盆与倒三角运动躯干轮廓（桥接髋部，消除直筒方块感）
    anatomical_loft("Pelvis / field trousers", [
        (-2.5, 0.0, -.15, 3.6, 3.6, 2.4, 2.9),
        (-.8,  0.0, -.10, 4.9, 4.9, 3.1, 3.5),
        (1.0,  0.0, .00,  4.9, 4.9, 3.2, 3.3),
        (2.4,  0.0, .05,  4.4, 4.4, 2.9, 2.9),
    ], "hips", "cloth", wrinkle_amp=.025)
    cloth("Load belt / elliptical", [(.92, 4.85, 3.30, .08), (1.50, 4.98, 3.38, .08),
          (2.07, 4.78, 3.22, .08)], "hips", "webbing")
    box("Belt buckle", (0, 1.5, 3.55), (1.5, .82, .30), "steel", "hips", .06)

    def torso_shape(a, t, high):
        sa, ca = math.sin(a), math.cos(a)
        chest = .07 * max(0.0, sa) * math.exp(-((t - .62) / .24) ** 2)
        spine = -.05 * max(0.0, -sa) * math.exp(-ca * ca * 14.0) * math.sin(t * math.pi)
        return 1.0 + chest + spine
    anatomical_loft("Torso / tailored combat shirt", [
        (-.8,  0.0, .05, 4.1, 4.1, 2.7, 2.6),
        (2.0,  0.0, .12, 4.3, 4.3, 2.9, 2.8),
        (4.8,  0.0, .25, 4.9, 4.9, 3.3, 3.0),
        (7.8,  0.0, .28, 5.4, 5.4, 3.5, 3.2),
        (10.0, 0.0, .15, 5.1, 5.1, 3.1, 3.0),
        (11.6, 0.0, .20, 3.3, 3.3, 2.4, 2.3),
        (12.8, 0.0, .55, 2.15, 2.15, 2.05, 2.0),
    ], "torso", "cloth", wrinkle_amp=.024, shape_fn=torso_shape)

    # 环肩垂坠侦察披肩/围领（平滑垂落双肩，前襟略收不与肩带扣具穿插）
    def cowl_mantle(u, v, high):
        ang = u * math.tau
        flare = (1.0 - v) ** .95
        front_dip = .85 * max(0.0, math.cos(ang)) ** 2
        back_dip = 2.6 * max(0.0, -math.cos(ang)) ** 1.5
        y = 9.0 + v * 3.7 - (front_dip + back_dip) * flare
        rx = 2.95 + flare * 3.75
        rz = 2.75 + flare * 2.15
        pleat = (.20 * math.sin(ang * 6.0) + (.08 if high else 0.0) * math.sin(ang * 14.0)) * flare
        nx, nz = math.sin(ang), math.cos(ang)
        return (nx * (rx + pleat), y, .10 + nz * (rz + pleat)), (nx, .42 * v, nz)
    curved_shell("Recon shoulder mantle", cowl_mantle, 24, 6, 44, 12, .24, "cloak", "torso", wrap_u=True)

    cloth("Wrapped reconnaissance scarf", [(10.3, 4.3, 2.9, -.1), (11.0, 4.0, 3.1, -.15),
          (11.7, 3.5, 2.8, -.1), (12.3, 2.6, 2.3, -.05)], "torso", "cloak", .7)
    carrier("Plate carrier / curved tapered shell", [(2.5, 3.0, 3.35), (4.0, 3.7, 3.65),
            (7.2, 4.25, 3.82), (9.4, 3.5, 3.45), (10.1, 2.7, 3.22)])
    carrier("Carrier lower webbing", [(2.2, 3.0, 3.38), (2.85, 3.15, 3.46)], "webbing")
    for x in (-2.5, 0, 2.5):
        z = 4.15 - .25 * (x / 2.5) ** 2
        rotation = (0, x * .055, 0)
        box("Ammunition pouch", (x, 3.0, z), (2.1, 2.8, 1.2), "tan", radius=.25, rotation=rotation)
        box("Pouch lid", (x, 4.15, z + .18), (2.15, .58, 1.28), "webbing", radius=.14, rotation=rotation)
        box("Pouch pull tab", (x, 3.6, z + .65), (.42, .82, .18), "thread", radius=.05, rotation=rotation)
    for s in (-1, 1):
        box("Shoulder harness", (s * 3.15, 8.2, 3.35), (.85, 2.8, .35), "webbing", radius=.08,
            rotation=(.12, 0, s * .10))
        box("Harness buckle", (s * 3.15, 7.6, 3.58), (1.02, .76, .22), "steel", radius=.04)
        cloak("Split reconnaissance cape", s)
    for y in (6.0, 7.1, 8.2):
        for x in (-2.0, 0, 2.0):
            box("MOLLE channel", (x, y, 3.94 - .65 * (x / 4.25) ** 2), (1.65, .28, .18), "webbing", radius=.035)
    box("IFF / chest patch", (-1.85, 9.45, 3.38), (1.85, .75, .16), "team", radius=.03)
    cloth("Low profile backpack / tapered", [(.1, 2.5, .85, -4.3), (1.2, 3.0, 1.15, -4.5),
          (5.2, 3.5, 1.35, -4.65), (8.8, 3.2, 1.2, -4.4), (10.0, 2.5, .85, -4.1)], "torso", "tan")
    for x in (-2.2, 2.2):
        cable("Pack compression strap", [(x, .8, -5.1), (x, 3, -5.85), (x, 7, -5.8), (x, 9.4, -4.85)],
              .16, "webbing")
    cable("Radio lead", [(-4.1, 9.0, -2.8), (-4.8, 10.2, -3.1), (-4.9, 11.5, -1.2), (-4.2, 12.0, 1.2)],
          .10, "rubber")
    box("Radio / pack side", (-4.4, 7.5, -5.1), (1.5, 4.0, 1.7), "armor", radius=.15)
    cylinder("Radio whip", (-4.4, 9.3, -5.2), (-4.65, 15.0, -5.4), .07, "rubber", "torso", .01, 8)
    # 封闭穹顶式侦察兜帽（顶部完全圆润无皱孔，面窗自然敞开露出风镜与面罩）
    cloth("Balaclava", [(-3.2, 2.2, 1.95, .2), (-1.4, 2.7, 2.45, .4), (1.4, 2.75, 2.45, .2),
          (3.1, 2.0, 1.9, -.1), (3.55, .6, .7, -.1)], "head", "webbing")
    def hood_shape(a, t, high):
        sa = math.sin(a)
        # 前额微前伸成深邃帽檐；中部面窗处内敛让出护目镜，后脑微收尖成战术兜帽轮廓
        brow = .24 * max(0.0, sa) ** 2 * math.exp(-((t - .68) / .18) ** 2)
        face_cut = -.32 * max(0.0, sa) ** 2 * math.exp(-((t - .34) / .24) ** 2)
        tail = .15 * max(0.0, -sa) ** 2 * math.exp(-((t - .52) / .24) ** 2)
        return 1.0 + brow + face_cut + tail
    anatomical_loft("Open hood / thick stitched rim", [
        (-2.5,  0.0, -.45, 3.75, 3.75, 2.20, 4.10),
        (-.2,   0.0, -.35, 3.95, 3.95, 2.15, 4.35),
        (2.2,   0.0, -.15, 3.85, 3.85, 3.75, 4.15),
        (3.6,   0.0, -.22, 3.15, 3.15, 3.35, 3.50),
        (4.55,  0.0, -.35, 1.65, 1.65, 1.85, 2.05),
    ], "head", "cloak", wrinkle_amp=.028, shape_fn=hood_shape)
    box("Goggle frame", (0, 1.0, 2.43), (5.3, 1.55, .75), "rubber", "head", .30)
    for s in (-1, 1):
        box("Ballistic goggle lens", (s * 1.20, 1.0, 2.89), (2.05, 1.07, .25), "goggle", "head", .22,
            rotation=(0, s * .10, 0))
        cylinder("Headset ear cup", (s * 2.70, .2, .1), (s * 3.12, .2, .1), .95, "armor", "head", .1, 16)
    cable("Mic boom", [(-2.8, -.2, .7), (-2.8, -1.1, 2.3), (-1.8, -1.35, 3.0)], .09, "rubber", "head")
    box("Face respirator", (0, -1.2, 2.6), (3.2, 1.6, .60), "glove", "head", .25)
    for x in (-.8, 0, .8):
        box("Mask seam", (x, -1.4, 2.94), (.06, .94, .05), "thread", "head", .015)
    box("IFF / nape", (-2.2, -2.3, -2.25), (1.2, .8, .15), "team", "head", .035)
    for side, s in (("L", -1), ("R", 1)):
        thigh, knee, foot = side + "Leg", side + "Knee", side + "Foot"
        arm, elbow, hand = side + "Arm", side + "Elbow", side + "Hand"
        # 自然内倾力线大腿（股四头肌前凸、外侧丰满、膝部收细；X偏移不影响矢状面步态旋转）
        tx_top, tx_mid, tx_kne = -s * .95, -s * .62, -s * .45
        anatomical_loft("Thigh / articulated cloth", [
            (-8.3, tx_kne, .06,  1.72, 1.72, 1.82, 1.68),
            (-6.5, tx_kne, .14,  1.92, 1.86, 2.04, 1.82),
            (-4.0, tx_mid, .14,  (2.38 if s > 0 else 2.05), (2.05 if s > 0 else 2.38), 2.44, 2.20),
            (-1.5, tx_top, -.02, (2.56 if s > 0 else 2.18), (2.18 if s > 0 else 2.56), 2.58, 2.56),
            (.5,   tx_top, -.08, 2.32, 2.32, 2.38, 2.45),
        ], thigh, "cloth", phase=s, wrinkle_amp=.034)
        # 小腿：胫前嵴与后侧腓肠肌曲线，向下优雅收细至靴筒
        anatomical_loft("Shin / boot gaiter", [
            (-7.3, -s * .35, -.10, 1.38, 1.38, 1.44, 1.40),
            (-5.2, -s * .38, -.20, 1.56, 1.56, 1.55, 1.84),
            (-2.6, -s * .45, -.24, 1.78, 1.78, 1.68, 2.16),
            (-.5,  -s * .45, -.02, 1.72, 1.72, 1.82, 1.78),
            (.6,   -s * .45, .06,  1.70, 1.70, 1.80, 1.70),
        ], knee, "cloth", phase=-s, wrinkle_amp=.030)
        # 曲面贴合护膝（替代平面方块）
        def sniper_knee_pad(u, v, high, cx=-s * .45):
            ang = (u - .5) * 1.85
            y = -1.8 + v * 2.55
            bulge = math.sin(v * math.pi) * .36
            r = 1.85 + bulge
            nx, nz = math.sin(ang), math.cos(ang)
            return (cx + nx * r, y, .18 + nz * r), (nx, 0.0, nz)
        curved_shell("Articulated knee pad", sniper_knee_pad, 10, 5, 18, 10, .38, "armor", knee)
        def sniper_knee_insert(u, v, high, cx=-s * .45):
            ang = (u - .5) * 1.15
            y = -1.25 + v * 1.35
            r = 2.15 + math.sin(v * math.pi) * .20
            nx, nz = math.sin(ang), math.cos(ang)
            return (cx + nx * r, y, .20 + nz * r), (nx, 0.0, nz)
        curved_shell("Knee pad insert", sniper_knee_insert, 8, 4, 14, 8, .18, "rubber", knee)
        # 贴合大腿外侧的弧形战术腿挂包
        box("Thigh utility pouch", (tx_mid + s * 2.25, -3.5, .0), (1.05, 3.6, 2.65), "tan", thigh, .28)
        for y in (-2.2, -4.7):
            anatomical_loft("Thigh pouch strap", [
                (y - .26, tx_mid, .08, 2.48, 2.48, 2.52, 2.35),
                (y + .26, tx_mid, .08, 2.48, 2.48, 2.52, 2.35),
            ], thigh, "webbing", wrinkle_amp=0.0)
        # 真正雕塑级解剖军靴（告别乐高砖头鞋！）
        build_sniper_boot(side, s, foot)
        # 手臂保持精确关节长度（7.6 / 6.5）以保障双手 IK 精确握持步枪！
        anatomical_loft("Upper sleeve", [
            (-7.5, 0.0, .00, 1.38, 1.38, 1.42, 1.42),
            (-5.4, 0.0, .04, 1.48, 1.48, 1.54, 1.50),
            (-2.6, 0.0, .06, 1.72, 1.68, 1.78, 1.74),
            (-.5,  -s * .15, .02, 1.88, 1.76, 1.92, 1.86),
            (.9,   -s * .35, .00, 1.50, 1.50, 1.55, 1.55),
        ], arm, "cloth", phase=s, wrinkle_amp=.028)
        # 贴合三角肌的弧形轻护肩（左右完全对称内收，绝不外飘）
        def sniper_shoulder(u, v, high, ss=s):
            phi = (u - .5) * 1.90
            theta = -.28 + v * 1.48
            r = 1.96
            ox, oy = -ss * .48, -.42
            return (ox + ss * math.sin(theta) * r, oy + math.cos(theta) * r, math.sin(phi) * r * .90), \
                   (ss * math.sin(theta), math.cos(theta), math.sin(phi) * .7)
        curved_shell("Shoulder reinforcement", sniper_shoulder, 10, 5, 18, 10, .34, "armor", arm)
        if side == "R":
            box("IFF / sleeve", (1.92, -.7, 0), (.15, 1.45, 1.70), "team", arm, .03)
        anatomical_loft("Forearm / rolled cuff", [
            (-6.25, 0.0, .02, 1.02, 1.02, 1.08, 1.04),
            (-4.2,  0.0, .08, 1.24, 1.24, 1.32, 1.26),
            (-1.5,  0.0, .12, 1.44, 1.44, 1.50, 1.44),
            (.55,   0.0, .00, 1.36, 1.36, 1.40, 1.40),
        ], elbow, "cloth", phase=-s, wrinkle_amp=.024)
        def sniper_elbow_pad(u, v, high):
            ang = math.pi + (u - .5) * 1.65
            y = -1.45 + v * 1.95
            r = 1.48 + math.sin(v * math.pi) * .22
            nx, nz = math.sin(ang), math.cos(ang)
            return (nx * r, y, nz * r), (nx, 0.0, nz)
        curved_shell("Elbow reinforcement", sniper_elbow_pad, 8, 4, 16, 8, .28, "armor", elbow)
        anatomical_loft("Wrist cuff", [
            (-6.15, 0.0, .06, 1.18, 1.18, 1.24, 1.20),
            (-5.55, 0.0, .08, 1.24, 1.24, 1.30, 1.26),
        ], elbow, "webbing", wrinkle_amp=0.0)
        if side == "R":
            box("Grip palm / outside grip", (.82, -1.35, .38), (.65, 1.85, 1.22), "glove", hand, .22)
            for y in (-1.25, -1.78, -2.25):
                cable("Grip curled finger", [(.94, y, .55), (.75, y, 1.25), (.15, y, 1.38), (-.64, y, .85)],
                      .17, "glove", hand)
            cable("Trigger index", [(.90, -.62, .65), (.95, -.48, 1.75), (.5, -.55, 2.83), (.06, -.72, 2.78)],
                  .16, "glove", hand)
            cable("Grip thumb", [(.70, -.65, -.14), (.30, -.32, -.15), (-.70, -.48, .20)], .22, "glove", hand)
        else:
            box("Support palm / upward", (0, -1.05, .25), (1.55, 1.75, .70), "glove", hand, .22)
            for y in (-1.65, -1.18, -.71, -.24):
                cable("Support curled finger", [(-.65, y, .4), (-.80, y, .82), (-.42, y, 1.12), (.1, y, 1.08)],
                      .16, "glove", hand)
            cable("Support thumb", [(.60, -.50, .27), (.78, -.95, .65), (.65, -1.5, .94)], .22, "glove", hand)
    log("OPERATOR / anatomical legs, sculpted boots, shoulder mantle, contoured armor, hood and gloves")


def build_rifle():
    start = len(pieces)
    # [SNIPER-RIFLE-SCALE] 镜身 8.8、枪管轴 y=1.65；握把安装位置对齐 rifle。
    extrusion("Chassis / receiver bedding",[(-3.0,.35),(-2.7,1.55),(3.6,1.55),(4.1,.8),
              (3.4,.25),(.8,.25),(.15,-.2),(-1.2,-.2)],0,1.65,"chassis")
    cylinder("Receiver / bolt housing",(0,1.65,-2.8),(0,1.65,3.5),.68)
    # 枪机侧面的窗口由四条实体边框和内凹枪机组成，避免把孔洞仅画成黑色。
    box("Ejection port / recessed bolt",(.64,1.73,1.0),(.10,.61,2.5),"steel","rifle",.04)
    for y in (1.25,2.17):
        box("Ejection port frame",(.73,y,1.0),(.22,.17,2.7),"gun","rifle",.04)
    for z in (-.35,2.35):
        box("Ejection port end",(.73,1.72,z),(.22,.95,.22),"gun","rifle",.04)
    cylinder("Bolt rear shroud",(0,1.65,-3.3),(0,1.65,-2.6),.59,"optic")
    cable("Bolt handle",[(.55,1.55,-1.8),(1.0,1.45,-2.0),(1.5,.68,-2.2)],.14,"steel","rifle")
    cylinder("Bolt knob",(1.48,.60,-2.2),(1.65,.40,-2.3),.31,"optic",bevel=.09,sides=16)
    box("Safety lever",(.78,2.0,-2.15),(.16,.20,.72),"steel","rifle",.03)
    # 骨架枪托、可调托腮板、橡胶肩垫和可见安装件。
    cylinder("Stock folding hinge",(-1.0,.9,-3.2),(1.0,.9,-3.2),.42,"gun")
    extrusion("Stock / skeleton upper",[(-5.9,.7),(-5.9,1.7),(-3.4,1.45),(-3.4,.90)],0,1.25,"chassis")
    extrusion("Stock / lower strut",[(-5.8,-.8),(-5.45,-1.1),(-3.4,.55),(-3.4,.95)],0,.72,"chassis")
    box("Stock cheek riser",(0,2.0,-4.65),(1.6,.70,2.35),"rubber","rifle",.19)
    box("Butt plate",(0,.32,-5.98),(1.55,3.30,.45),"chassis","rifle",.15)
    box("Recoil shoulder pad",(0,.32,-6.33),(1.55,3.30,.45),"rubber","rifle",.16)
    for y in (-.75,0,.75):
        box("Shoulder pad groove",(0,y,-6.59),(1.22,.10,.035),"recess","rifle",.015)
    for z in (-5.2,-4.1):
        cylinder("Cheek riser post",(0,1.1,z),(0,1.8,z),.12,"steel")
    extrusion("Pistol grip",[(-1.8,.30),(-.45,.15),(-.60,-2.6),(-1.7,-3.0),(-2.2,-2.3)],
              0,1.20,"rubber",radius=.13)
    for y in (-1.2,-1.7,-2.2):
        box("Grip traction",(0,y,-1.96),(1.08,.11,.10),"glove","rifle",.03)
    cable("Open trigger guard",[(-.58,-.25,.0),(-.58,-1.65,.4),(-.58,-1.72,1.9),
          (-.58,-.10,2.25)],.13,"gun","rifle")
    cable("Trigger blade",[(0,.05,.7),(0,-.7,.85),(0,-1.0,.64)],.09,"steel","rifle")
    extrusion("Detachable box magazine",[(1.6,.22),(3.4,.22),(3.1,-2.8),(1.35,-2.55)],
              0,1.23,"gun",radius=.12)
    for s in (-1,1):
        for z in (1.8,2.6):
            box("Magazine pressed rib",(s*.64,-1.4,z),(.08,1.95,.12),"optic","rifle",.03)
    # 独立护木骨架；侧边孔隙和上下空间可以看到内部枪管。
    box("Handguard top rail",(0,2.03,7.65),(1.80,.28,9.0),"chassis","rifle",.07)
    box("Handguard lower spine",(0,.36,7.65),(1.80,.28,9.0),"chassis","rifle",.07)
    for s in (-1,1):
        for y in (.59,1.80):
            box("Handguard side longitudinal",(s*.88,y,7.65),(.19,.25,9.0),"chassis","rifle",.05)
        for z in (3.5,5.0,6.5,8.0,9.5,11.5):
            box("Handguard ventilation bridge",(s*.88,1.18,z),(.19,1.1,.48),"chassis","rifle",.07)
        box("Handguard grip insert",(s*1.01,1.0,5.3),(.13,.70,2.3),"rubber","rifle",.10)
    cylinder("Barrel / chamber shoulder",(0,1.65,3.4),(0,1.65,5.4),.48,"steel")
    tube("Free floating match barrel",(0,1.65,0),[(5.3,.38,.16),(12.0,.32,.16),(19.8,.27,.16)],"gun")
    tube("Muzzle crown",(0,1.65,0),[(19.8,.30,.16),(20.1,.30,.16)],"steel")
    # 两侧制退器开口：中间内管和分离的上下、侧边框保留真实负空间。
    tube("Muzzle brake / bore",(0,1.65,0),[(20.0,.24,.16),(21.9,.24,.16)],"optic")
    for y in (1.20,2.10):
        box("Muzzle brake top bottom",(0,y,21.0),(.86,.14,2.0),"gun","rifle",.03)
    for z in (20.15,20.95,21.85):
        for s in (-1,1):
            box("Muzzle brake port bridge",(s*.42,1.65,z),(.14,.92,.16),"gun","rifle",.03)
    tube("Brake front crown",(0,1.65,21.9),[(0,.48,.17),(.15,.48,.17)],"steel")
    # 瞄准镜足够细长，物镜与目镜分别扩径；镜片放在遮光罩内部。
    for z in np.arange(-2.4,11.8,.45):
        box("Picatinny rail tooth",(0,2.36,float(z)),(1.52,.22,.25),"gun","rifle",.03)
    for z in (-1.2,3.3):
        box("Scope mount foot",(0,2.64,z),(1.50,.28,.75),"optic","rifle",.04)
        box("Scope mount riser",(0,3.03,z),(.45,.70,.62),"gun","rifle",.04)
        tube("Scope ring",(0,3.70,z),[(-.27,.65,.44),(.27,.65,.44)],"gun")
        for s in (-1,1):
            cylinder("Ring clamp screw",(s*.57,3.70,z),(s*.76,3.70,z),.13,"steel",sides=12)
    tube("Scope / optical body",(0,3.70,0),
         [(-4.2,.57,.42),(-2.8,.57,.42),(-2.5,.43,.32),(3.1,.43,.32),
          (4.0,.76,.63),(4.6,.76,.63)],"optic")
    cylinder("Objective glass",(0,3.70,4.30),(0,3.70,4.35),.61,"lens",bevel=.015,sides=32)
    cylinder("Eyepiece glass",(0,3.70,-4.06),(0,3.70,-4.11),.40,"lens",bevel=.01,sides=24)
    for z in (-3.1,-2.85):
        tube("Focus knurl ring",(0,3.70,z),[(0,.60,.43),(.12,.60,.43)],"gun")
    cylinder("Elevation turret",(0,4.02,.7),(0,4.70,.7),.45,"optic")
    cylinder("Windage turret",(.34,3.70,.7),(1.0,3.70,.7),.40,"optic")
    for y in (4.45,4.62):
        cylinder("Turret grip band",(0,y,.7),(0,y+.08,.7),.48,"gun",sides=24)
    # 收拢两脚架在护木侧面，步枪携行时不垂下两根装饰杆。
    for s in (-1,1):
        cylinder("Bipod hinge",(s*.79,.50,10.8),(s*1.21,.50,10.8),.33,"steel")
        cylinder("Folded bipod leg",(s*1.16,.46,10.6),(s*1.22,.42,6.5),.18,"gun")
        cylinder("Bipod extension",(s*1.22,.42,6.5),(s*1.24,.42,5.4),.12,"steel")
        box("Bipod rubber foot",(s*1.24,.40,5.25),(.65,.45,.58),"rubber","rifle",.10)
    for x,y,z in ((.85,1,-3.2),(.90,1.0,3.5),(.90,1.0,11.4),(.83,1.4,-5.7)):
        cylinder("Flush hex fastener",(x-.04,y,z),(x+.07,y,z),.14,"steel",sides=6)
    box("Receiver serial plaque",(-.86,.95,-.35),(.06,.36,1.5),"steel","rifle",.02)
    for z in (-.8,-.5,-.2,.1):
        box("Serial engraving",(-.905,.95,z),(.015,.19,.05),"recess","rifle",.01)
    # 握把在掌心前侧；枪托的肩垫随瞄准姿态抵住上胸，不能穿过背包。
    for low, high in pieces[start:]:
        for obj in (low, high):
            obj.data.transform(Matrix.Translation(point((0,0,2))))
            attribute = obj.data.attributes["_installCoord"]
            for vertex in obj.data.vertices:
                attribute.data[vertex.index].vector = vertex.co
    log("RIFLE / chassis, bolt, trigger, magazine, floating barrel, vented brake and optical scope")


def join(objects, name):
    select(objects)
    bpy.ops.object.join()
    bpy.context.object.name = name
    return bpy.context.object


def image(channel):
    img = bpy.data.images.new("Sniper bake " + channel,args.resolution,args.resolution,alpha=False)
    img.generated_color = (.5,.5,1,1) if channel=="normal" else (1,1,1,1)
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
        elif channel in {"roughness","metalness"}:
            socket=bsdf.inputs["Roughness" if channel=="roughness" else "Metallic"]
            if socket.is_linked:
                links.new(socket.links[0].from_socket,emit.inputs["Color"])
            else:
                emit.inputs["Color"].default_value=(socket.default_value,)*3+(1,)
        links.new(bsdf.outputs[0] if channel in {"normal","ao"} else emit.outputs[0],output.inputs["Surface"])
    scene.render.bake.use_selected_to_active=projected
    scene.render.bake.use_cage=False
    scene.render.bake.use_clear=True
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
        for link in list(emit.inputs["Color"].links):links.remove(link)
        emit.inputs["Color"].default_value=(1,1,1,1)
        links.new(emit.outputs[0],output.inputs["Surface"])
        nodes["Bake target"].image=target;nodes.active=nodes["Bake target"]
    bpy.ops.object.bake(type="EMIT")
    mask=pixels(target)[:,:,0]>.999
    for mat,socket in saved:
        mat.node_tree.links.new(socket,mat.node_tree.nodes.get("Material Output").inputs["Surface"])
    scene.render.bake.margin=margin
    bpy.data.images.remove(target)
    return mask


def baked_material(images,slot):
    mat=bpy.data.materials.new("GAME PBR / "+str(slot));mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    bsdf=nodes.get("Principled BSDF")
    for channel in ("albedo","normal","orm"):
        texture=nodes.new("ShaderNodeTexImage");texture.image=images[channel]
        if channel=="albedo":
            links.new(texture.outputs[0],bsdf.inputs["Base Color"])
        elif channel=="normal":
            normal=nodes.new("ShaderNodeNormalMap")
            links.new(texture.outputs[0],normal.inputs[1]);links.new(normal.outputs[0],bsdf.inputs["Normal"])
        else:
            split=nodes.new("ShaderNodeSeparateColor")
            links.new(texture.outputs[0],split.inputs[0])
            links.new(split.outputs["Green"],bsdf.inputs["Roughness"])
            links.new(split.outputs["Blue"],bsdf.inputs["Metallic"])
    if slot==2:
        bsdf.inputs["Emission Color"].default_value=(.05,.20,.20,1)
        bsdf.inputs["Emission Strength"].default_value=.4
    return mat


def render(objects,name,view=(1.35,-1.8,1.0),resolution=1200):
    bpy.context.view_layer.update()
    points=[o.matrix_world@Vector(v) for o in objects for v in o.bound_box]
    lo=Vector(tuple(min(v[i] for v in points) for i in range(3)))
    hi=Vector(tuple(max(v[i] for v in points) for i in range(3)))
    center=(lo+hi)/2;extent=max(hi-lo)
    bpy.ops.object.camera_add(location=center+Vector(view)*extent)
    camera=bpy.context.object
    camera.rotation_euler=(center-camera.location).to_track_quat("-Z","Y").to_euler()
    camera.data.type="ORTHO";camera.data.ortho_scale=extent*1.20
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
    for obj in [camera,*lights]:bpy.data.objects.remove(obj,do_unlink=True)
    scene.cycles.samples=16


def run():
    started=time.time()
    build_operator()
    build_rifle()
    lows=[p[0] for p in pieces];highs=[p[1] for p in pieces]
    if args.preview_only:
        for obj in highs:obj.hide_render=True
        render(lows,"form-preview")
        return
    # 每个安装组沿 X 分离，避免兜帽、披风和枪械互相误投射。
    for i,(low,high) in enumerate(pieces):
        offset=Vector((i*100,0,0))
        for obj in (low,high):
            attr(obj.data,"_bakeOffset",list(offset)*len(obj.data.vertices))
            obj.data.transform(Matrix.Translation(offset))
        mat=low.data.materials[0].copy();mat["slot"]=low["slot"];low.data.materials[0]=mat
    low=join(lows,"Sniper · UV LOW")
    high=join(highs,"Sniper · HIGH / editable detail")
    select([low]);bpy.ops.object.mode_set(mode="EDIT");bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.20,island_margin=.0002,area_weight=1,scale_to_bounds=True)
    bpy.ops.uv.pack_islands(rotate=True,scale=True,margin_method="FRACTION",margin=.0015,shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    targets={channel:image(channel) for channel in ("albedo","normal","ao","roughness","metalness")}
    scene.render.bake.cage_extrusion=.20
    scene.render.bake.max_ray_distance=.65
    mask=coverage(low);results={}
    for channel in ("albedo","normal","roughness","metalness"):
        log("BAKE / "+channel);results[channel]=bake(low,high,channel,targets[channel])
    normals=results["normal"]
    length=np.linalg.norm(normals[:,:,:3]*2-1,axis=2)
    backfacing=normals[:,:,2]<.5
    invalid_normal=(length<.05)|(length>1.25)|backfacing
    invalid_material=(np.max(results["albedo"][:,:,:3],axis=2)<1e-6)|(results["roughness"][:,:,0]<.01)
    invalid=invalid_normal|invalid_material
    missed=int(np.count_nonzero(mask&invalid));covered=int(np.count_nonzero(mask))
    if covered==0 or missed/covered>.05:
        raise ValueError(f"Insufficient high-to-low coverage: {missed}/{covered}")
    for obj in (low,high):
        offsets=obj.data.attributes["_bakeOffset"]
        for vertex in obj.data.vertices:vertex.co-=offsets.data[vertex.index].vector
    log("BAKE / assembled AO")
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
    if neutral_count>missed:raise ValueError("Fallback normal quality regressed")
    normals[neutral]=(.5,.5,1,1)
    orm=np.ones_like(normals)
    for index,channel in enumerate(("ao","roughness","metalness")):orm[:,:,index]=results[channel][:,:,0]
    images={}
    for channel,data in {"albedo":results["albedo"],"normal":normals,"orm":orm}.items():
        img=targets.get(channel) or image(channel);img.pixels.foreach_set(data.ravel())
        img.filepath_raw=str(directory/("sniper-"+channel+".png"));img.file_format="PNG"
        img.save();img.pack();images[channel]=img
    low_count,high_count=len(low.data.polygons),len(high.data.polygons)
    objects=[]
    for slot in range(3):
        # 没有发光件时不导出空网格；玩家色仍有独立材质槽。
        if not any(low.data.materials[f.material_index]["slot"]==slot for f in low.data.polygons):continue
        obj=low.copy();obj.data=low.data.copy();low_collection.objects.link(obj)
        bm=bmesh.new();bm.from_mesh(obj.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if obj.data.materials[f.material_index]["slot"]!=slot],context="FACES")
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context="VERTS")
        bm.to_mesh(obj.data);bm.free()
        for name in ("_installCoord","_bakeOffset"):obj.data.attributes.remove(obj.data.attributes[name])
        obj.data.materials.clear();obj.data.materials.append(baked_material(images,slot))
        for face in obj.data.polygons:face.material_index=0
        obj.name=f"industrial:sniper|-1|{slot}"
        for key in list(obj.keys()):del obj[key]
        obj["key"]="industrial:sniper";obj["part"]=-1;obj["slot"]=slot;objects.append(obj)
    bpy.data.objects.remove(low,do_unlink=True);high.hide_render=True;high.hide_set(True)
    select(objects)
    bpy.ops.export_scene.gltf(filepath=str(directory/"sniper.glb"),export_format="GLB",use_selection=True,
                             export_attributes=True,export_extras=True,export_materials="NONE",
                             export_vertex_color="NONE",export_cameras=False,export_lights=False,
                             export_meshopt_compression_enable=True,export_meshopt_extension="EXT_meshopt_compression")
    points=[v.co for obj in objects for v in obj.data.vertices]
    template["bounds"]=[[min(v.x for v in points),min(v.z for v in points),min(-v.y for v in points)],
                        [max(v.x for v in points),max(v.z for v in points),max(-v.y for v in points)]]
    template["surface"]="sniper"
    report={"key":"industrial:sniper","generator":"scripts/build-sniper-hero.py","scriptHash":script_hash,
            "tile":[0,0],"tileSize":args.resolution,"lowFaces":low_count,"highFaces":high_count,
            "assemblies":len(pieces),"template":template,
            "rifle":{"length":28.6575,"scopeLength":8.8,"barrelAxisY":1.65,"gripForwardOffset":2,
                      "joint":"rifle",
                     "features":["open bore","vented brake","bolt handle","trigger guard","box magazine",
                                 "ventilated handguard","folded bipod","adjustable stock","recessed lenses"]},
            "projection":{"cageExtrusion":.20,"maxRayDistance":.65,"uvPixels":covered,
                          "missedNormalPixels":int(np.count_nonzero(mask&invalid_normal)),
                          "backfacingNormalPixels":int(np.count_nonzero(mask&backfacing)),
                          "missedMaterialPixels":int(np.count_nonzero(mask&invalid_material)),
                          "missedProjectionPixels":missed,"lowSurfaceFallbackPixels":missed,
                          "neutralNormalPixels":neutral_count}}
    (directory/"sniper-bake.json").write_text(json.dumps([report],indent=2)+"\n")
    log(f"BAKE READY / low={low_count} high={high_count} coverage={1-missed/covered:.3%}")
    # 保存完整可编辑骨架，运行时 GLB 由源码骨架应用同一权重。
    armature=bpy.data.armatures.new("Sniper / game bone contract")
    rig=bpy.data.objects.new("Sniper / EDITABLE RIG",armature)
    scene.collection.objects.link(rig);select([rig]);bpy.ops.object.mode_set(mode="EDIT")
    bones=[]
    for joint in joints:
        bone=armature.edit_bones.new(joint["name"]);bone.head=point(joint["origin"])
        bone.tail=bone.head+Vector((0,0,1))
        if joint["parent"]>=0:bone.parent=bones[joint["parent"]]
        bones.append(bone)
    bpy.ops.object.mode_set(mode="OBJECT")
    for obj in objects:
        obj.parent=rig
        indices=obj.data.attributes["_skinIndex"];weights=obj.data.attributes["_skinWeight"]
        for i,joint in enumerate(joints):
            group=obj.vertex_groups.new(name=joint["name"])
            for vertex in obj.data.vertices:
                weight=sum(w for index,w in zip(indices.data[vertex.index].color,
                           weights.data[vertex.index].color) if round(index)==i)
                if weight>0:group.add([vertex.index],weight,"REPLACE")
        modifier=obj.modifiers.new("Game articulation / blended cape","ARMATURE");modifier.object=rig
    scene["rigContract"]=json.dumps(joints,separators=(",",":"));scene["generator"]=script_hash
    scene["workflow"]="Purpose-built operator + precision rifle / independent UV / high-to-low PBR"
    select(objects)
    bpy.ops.wm.save_as_mainfile(filepath=str(directory/"ghost-sniper.blend"),compress=True)
    render(objects,"sniper-bind-front")
    render(objects,"sniper-bind-rear",(-1.35,1.8,1.0))
    log(f"COMPLETE / {time.time()-started:.1f}s")


run()
