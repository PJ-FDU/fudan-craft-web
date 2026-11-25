"""使用 Blender 内置 bpy + numpy 刷新人形总览图（humanoid-comparison.png）与全库 78 模型联系表（model-library.png）。"""
import json
from pathlib import Path

import bpy
import numpy as np

root = Path(__file__).resolve().parent.parent
directory = root / "artifacts/blender-sculpt"
portraits_dir = directory / "portraits"
order = json.loads((root / ".cache/sculpt-source/source.json").read_text())["portraits"]


def load_rgba(path: Path) -> np.ndarray:
    img = bpy.data.images.load(str(path), check_existing=False)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return np.flipud(buf.reshape(h, w, 4))


def resize_rgba(arr: np.ndarray, new_h: int, new_w: int) -> np.ndarray:
    h, w = arr.shape[:2]
    ys = np.clip((np.arange(new_h) + 0.5) * (h / new_h) - 0.5, 0, h - 1)
    xs = np.clip((np.arange(new_w) + 0.5) * (w / new_w) - 0.5, 0, w - 1)
    y0 = np.floor(ys).astype(np.int32)
    x0 = np.floor(xs).astype(np.int32)
    y1 = np.minimum(y0 + 1, h - 1)
    x1 = np.minimum(x0 + 1, w - 1)
    wy = (ys - y0)[:, None, None]
    wx = (xs - x0)[None, :, None]
    top = arr[y0][:, x0] * (1.0 - wx) + arr[y0][:, x1] * wx
    bot = arr[y1][:, x0] * (1.0 - wx) + arr[y1][:, x1] * wx
    return top * (1.0 - wy) + bot * wy


def save_rgba(path: Path, rgba: np.ndarray):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(path.name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(np.flipud(np.clip(rgba, 0.0, 1.0)).astype(np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def composite_cell(canvas: np.ndarray, src: np.ndarray, x0: int, y0: int, cell: int, pad: int = 20):
    alpha = src[:, :, 3]
    ys, xs = np.where(alpha > 0.03)
    if len(ys) == 0:
        return
    cropped = src[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ch, cw = cropped.shape[:2]
    scale = (cell - pad * 2) / max(ch, cw)
    nh, nw = max(1, round(ch * scale)), max(1, round(cw * scale))
    fitted = resize_rgba(cropped, nh, nw)
    ox = x0 + (cell - nw) // 2
    oy = y0 + (cell - nh) // 2
    a = fitted[:, :, 3:4]
    dst = canvas[oy:oy + nh, ox:ox + nw, :3]
    canvas[oy:oy + nh, ox:ox + nw, :3] = fitted[:, :, :3] * a + dst * (1.0 - a)


# 1) 全 8 个人形 / 双足单位 4x2 高清汇总图
humanoids = [
    "industrial:soldier", "industrial:medic", "industrial:commander", "industrial:sniper",
    "relay:ranger", "relay:observer", "relay:pathfinder", "industrial:mech",
]
cell = 384
bg = np.array([0.094, 0.129, 0.169, 1.0], dtype=np.float32)
sheet = np.broadcast_to(bg, (cell * 2, cell * 4, 4)).copy()
for idx, key in enumerate(humanoids):
    p = portraits_dir / (key.replace(":", "-") + ".png")
    composite_cell(sheet, load_rgba(p), (idx % 4) * cell, (idx // 4) * cell, cell, pad=22)
save_rgba(directory / "humanoid-comparison.png", sheet)

# 2) 全库 78 模型联系表
cols = 8
rows = (len(order) + cols - 1) // cols
cell_lib = 224
lib = np.broadcast_to(bg, (cell_lib * rows, cell_lib * cols, 4)).copy()
for idx, key in enumerate(order):
    p = portraits_dir / (key.replace(":", "-") + ".png")
    composite_cell(lib, load_rgba(p), (idx % cols) * cell_lib, (idx // cols) * cell_lib, cell_lib, pad=14)
save_rgba(directory / "model-library.png", lib)
print("SHOWCASE PACKED:", directory / "humanoid-comparison.png", directory / "model-library.png")
