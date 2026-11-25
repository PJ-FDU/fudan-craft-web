"""从编辑工程的实际 UV 低模渲染全阵容，按原画图集顺序提供检查图。"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--project", required=True)
parser.add_argument("--device", choices=["CPU", "METAL"], default="CPU")
parser.add_argument("--only-key", default="")
opts = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
project = Path(opts.project)
directory = project / "artifacts/blender-sculpt"
portraits = directory / "portraits"
portraits.mkdir(exist_ok=True)
order = json.loads((project / ".cache/sculpt-source/source.json").read_text())["portraits"]
script_hash = hashlib.sha256((project / "scripts/build-sculpt-assets.py").read_bytes()).hexdigest()
manifest = json.loads((project / "public/assets/blender-sculpt-v2/manifest.json").read_text())
if manifest["scriptHash"] != script_hash:
    raise ValueError("Rebuild sculpt assets before rendering: generator hash changed")
render_report = directory / "render-report.json"
previous_report = json.loads(render_report.read_text()) if opts.only_key else None
if previous_report:
    if opts.only_key not in order or previous_report["keys"] != order or previous_report["scriptHash"] != script_hash:
        raise ValueError("Partial preview requires an existing complete library")
else:
    render_report.unlink(missing_ok=True)
rendered = []
generator_hashes = {}
for pack in manifest["surfaces"]:
    generator = manifest.get("generators", {}).get(pack)
    expected_hash = hashlib.sha256((project / generator["script"]).read_bytes()).hexdigest() if generator else script_hash
    if generator and generator["scriptHash"] != expected_hash:
        raise ValueError("Generator changed: " + pack)
    keys = [key for key in order if manifest["templates"][key]["surface"] == pack and
            (not opts.only_key or key == opts.only_key)]
    if previous_report and not keys and previous_report.get("generatorHashes", {}).get(pack) != expected_hash:
        raise ValueError("An unrendered pack changed: " + pack)
    generator_hashes[pack] = expected_hash
    bake_path = project / generator["bake"] if generator else directory / (pack + "-bake.json")
    blend_path = project / generator["blend"] if generator else directory / (pack + ".blend")
    records = json.loads(bake_path.read_text())
    if any(record["scriptHash"] != expected_hash for record in records):
        raise ValueError("Stale sculpt pack: " + pack)
    if not keys:
        continue
    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
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
    scene.render.resolution_x = scene.render.resolution_y = 448
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    # 编辑工程保留了单模型预览灯光；全阵容必须统一布光，避免位置相关的叠加照明。
    for obj in list(scene.objects):
        if obj.type in {"LIGHT", "CAMERA"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in scene.objects if o.type == "MESH" and "key" in o]
    for obj in meshes:
        obj.hide_render = True
        obj.hide_set(False)
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    scene.camera = camera
    lights = []
    for power, color in ((1500, (1, .85, .68)), (1100, (.45, .74, 1))):
        bpy.ops.object.light_add(type="AREA")
        light = bpy.context.object
        light.data.shape = "DISK"
        light.data.color = color
        lights.append((light, power))
    for key in keys:
        objects = [o for o in meshes if o["key"] == key]
        if not objects:
            raise ValueError("Missing low model: " + key)
        for obj in objects:
            obj.hide_render = False
        bpy.context.view_layer.update()
        points = [o.matrix_world @ Vector(v) for o in objects for v in o.bound_box]
        lower = Vector(tuple(min(v[i] for v in points) for i in range(3)))
        upper = Vector(tuple(max(v[i] for v in points) for i in range(3)))
        center, extent = (lower + upper) * .5, max(upper - lower)
        camera.location = center + Vector((1.35, -1.8, 1.25)) * extent
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.ortho_scale = extent * 1.4
        for (light, power), offset in zip(lights, ((-1, -1.5, 2), (1, .7, 1.5))):
            light.location = center + Vector(offset) * extent
            light.data.energy = power * extent * extent / 10
            light.data.size = extent * 1.3
            light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(portraits / (key.replace(":", "-") + ".png"))
        bpy.ops.render.render(write_still=True)
        rendered.append(key)
        print("SCULPT_PORTRAIT " + key, flush=True)
        for obj in objects:
            obj.hide_render = True
if opts.only_key and rendered != [opts.only_key]:
    raise ValueError("Missing requested partial preview")
if not opts.only_key and (len(rendered) != len(order) or set(rendered) != set(order)):
    raise ValueError("Rendered library does not match the source portrait models")
render_report.write_text(json.dumps({
    "scriptHash": script_hash, "generatorHashes": generator_hashes, "keys": order, "device": opts.device,
    "resolution": [448, 448], "samples": 16, "source": "UV low meshes with baked PBR",
}, indent=2) + "\n")
