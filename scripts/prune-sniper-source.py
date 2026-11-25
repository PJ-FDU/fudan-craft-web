"""通用工业工程移除独立精修工程接管的旧狙击手。"""
import argparse
import sys
from pathlib import Path

import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--project", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
path = Path(args.project) / "artifacts/blender-sculpt/industrial.blend"
if path.exists():
    bpy.ops.wm.open_mainfile(filepath=str(path))
    root = next((obj for obj in bpy.context.scene.objects
                 if obj.type == "EMPTY" and obj.get("key") == "industrial:sniper"), None)
    if root:
        objects = [*root.children_recursive, root]
        if any(obj.get("key") not in (None, "industrial:sniper") for obj in objects):
            raise ValueError("Sniper hierarchy contains another model")
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.context.scene["sniperSource"] = "artifacts/sniper-hero/ghost-sniper.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
        print(f"SNIPER SOURCE / removed {len(objects)} superseded objects", flush=True)
