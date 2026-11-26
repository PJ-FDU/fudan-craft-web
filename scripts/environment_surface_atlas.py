"""Bake the shared PBR tiles used by botanical meshes and resource deposits."""

import math
import struct
import subprocess
import zlib
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
SURFACES = "scripts/material-library/surfaces"
LIBRARY = "scripts/material-library"
MICRO = "public/assets/generated/micro"
PAINTED = "public/assets/generated/battle-materials.webp"
TERRAIN = "public/assets/generated/terrain-v2.png"
TILE = 256
GUTTER = 8
INNER = TILE - 2 * GUTTER
COLUMNS, ROWS = 6, 4

# Each entry states color source, roughness, metallic response, and height strength.
# A crop is (column, row from top, columns, rows).
MATERIALS = {
    "pine": (PAINTED, (0, 2, 4, 4), .87, 0, 2.4),
    "leaf": (PAINTED, (1, 2, 4, 4), .84, 0, 2.1),
    "grass": (TERRAIN, (0, 0, 2, 2), .89, 0, 2.4),
    "flower": (None, None, .78, 0, 0),
    "bark": (f"{SURFACES}/furrowed-bark.png", None, .87, 0, 6),
    "birch": (f"{SURFACES}/birch-bark.png", None, .78, 0, 3),
    "end": (f"{MICRO}/mill-wood-grain.png", None, .82, 0, 4),
    "timber": (f"{MICRO}/mill-wood-grain.png", None, .86, 0, 5),
    "rock": (f"{SURFACES}/layered-rock.png", None, .83, 0, 4),
    "mossRock": (f"{SURFACES}/layered-rock.png", None, .89, 0, 5),
    "ruin": (f"{SURFACES}/cast-concrete.png", None, .86, 0, 3),
    "earth": (TERRAIN, (1, 0, 2, 2), .95, 0, 3),
    "ore": (f"{SURFACES}/gold-vein.png", None, .31, .72, 4),
    "spentOre": (f"{SURFACES}/gold-vein.png", None, .64, .34, 4),
    "oilRock": (f"{SURFACES}/layered-rock.png", None, .79, .01, 5),
    "oil": (f"{SURFACES}/oil-film.png", None, .12, .19, .22),
    "tar": (f"{SURFACES}/dry-tar.png", None, .90, 0, 5),
    "hotSteel": (f"{SURFACES}/heat-oxidized.png", None, .63, .48, 2),
    "steel": (f"{LIBRARY}/brushed-gunmetal-wear.png", None, .42, .76, 2.2),
    "glass": (PAINTED, (3, 0, 4, 4), .17, .12, .1),
    "hazard": (f"{LIBRARY}/decal-hazard-stripe.png", None, .56, .13, .3),
    "wall": (PAINTED, (1, 0, 4, 4), .63, .12, 2.1),
    "accent": (None, None, .49, .32, 0),
}
CELLS = {name: (i % COLUMNS, i // COLUMNS) for i, name in enumerate(MATERIALS)}
FILES = {channel: f"nature-{channel}.png" for channel in ("albedo", "normal", "orm")}


def atlas_uv(name, u, v):
    x, y = CELLS[name]
    span = INNER - 1
    return ((x * TILE + GUTTER + .5 + np.clip(u, 0, 1) * span) / (COLUMNS * TILE),
            (y * TILE + GUTTER + .5 + np.clip(v, 0, 1) * span) / (ROWS * TILE))


def extract(path, crop):
    if path is None:
        return np.ones((INNER, INNER, 3), dtype=np.float32)
    filters = []
    if crop:
        x, y, columns, rows = crop
        filters.append(f"crop=iw/{columns}-4:ih/{rows}-4:iw/{columns}*{x}+2:ih/{rows}*{y}+2")
    filters.append(f"scale={INNER}:{INNER}:flags=area")
    data = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(ROOT / path), "-frames:v", "1", "-filter_threads", "1",
        "-vf", ",".join(filters), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ])
    return np.frombuffer(data, dtype=np.uint8).reshape(INNER, INNER, 3).astype(np.float32) / 255


def rgb(values):
    return np.asarray(values, dtype=np.float32)


def painted_tile(name, pixels, moss):
    height = pixels @ rgb((.2126, .7152, .0722))
    if name in ("timber", "end"):
        shade = .73 + (height - .5) * 1.06
        if name == "end":
            y, x = np.indices(height.shape) / (INNER / 2) - 1
            radius = np.hypot(x + .11, y - .08)
            angle = np.arctan2(y, x)
            rings = .5 + .5 * np.cos(radius * 47 + np.sin(angle * 4) * .32 + np.sin(radius * 7) * 1.8)
            boundary = np.clip((np.hypot(x, y) - .83) * 5, 0, 1)
            height = .6 * height + .4 * rings
            shade += (rings - .5) * .17 - boundary * .25
        pixels = shade[..., None] * rgb((.99, .74, .48))
    elif name == "mossRock":
        coverage = np.clip((moss[..., 1] - moss[..., 2]) * 2.4, 0, .75)
        pixels = pixels * (1 - coverage[..., None]) + moss * coverage[..., None]
        height += coverage * .08
    elif name == "ore":
        # Keep the thin, authored mineral veins readable on faceted geometry at battle zoom.
        vein = np.clip((pixels[..., 0] - pixels[..., 2] - .055) * 3.4, .12, .82)
        leaf = (.72 + .28 * height[..., None]) * rgb((.99, .66, .23))
        pixels = pixels * (1 - vein[..., None]) + leaf * vein[..., None]
    elif name in ("spentOre", "oilRock"):
        pixels = pixels * (.75 if name == "spentOre" else .55) + .08
    return pixels, height


def png(path, pixels):
    height, width, _ = pixels.shape

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    scanlines = b"".join(b"\0" + row.tobytes() for row in pixels)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" +
                     chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) +
                     chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b""))


def bake_environment(output):
    maps = {channel: np.zeros((ROWS * TILE, COLUMNS * TILE, 3), dtype=np.uint8) for channel in FILES}
    moss = extract(f"{SURFACES}/moss-lichen.png", None)
    for name, (source, crop, roughness, metalness, relief) in MATERIALS.items():
        color, height = painted_tile(name, extract(source, crop), moss)
        dy, dx = np.gradient(height)
        normals = np.stack((-dx * relief, dy * relief, np.ones_like(height)), axis=-1)
        normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
        rough_map = np.clip(roughness - (height - height.mean()) * .28, .06, .98)
        metal_map = np.full_like(height, metalness)
        if name == "ore":
            gleam = np.clip((color[..., 0] - color[..., 2] - .12) * 2, 0, 1)
            metal_map *= .26 + .74 * gleam
            rough_map += (1 - gleam) * .33
        x, y = CELLS[name]
        row, column = (ROWS - y - 1) * TILE, x * TILE
        for channel, data in (("albedo", color), ("normal", normals * .5 + .5),
                              ("orm", np.stack((np.ones_like(height), rough_map, metal_map), axis=-1))):
            gutter = np.pad(data, ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode="edge")
            maps[channel][row:row + TILE, column:column + TILE] = np.round(np.clip(gutter, 0, 1) * 255)
    for channel, path in FILES.items():
        png(output / path, maps[channel])


def imported_material(key, surface, center, normal, seed):
    if surface == "stone":
        if key.startswith("resource:oil"):
            return "oilRock"
        if key == "nature:birch" or (key == "resource:wood" and center.z > 13):
            return "birch"
        return "mossRock" if key == "nature:ruin" or key == "nature:rockLarge" and seed > .45 else "rock"
    if surface == "bark":
        if key.startswith("resource:gold"):
            return "timber"
        near_log = key == "resource:wood" and center.y < -15 and center.z < 16
        log_axis = (-math.sin(.24), -math.cos(.24), 0)
        end = abs(sum(n * axis for n, axis in zip(normal, log_axis))) if near_log else abs(normal.z)
        return "end" if end > .7 else "bark"
    if surface == "ore":
        return "spentOre" if key.endswith(":empty") else "ore"
    if surface == "insignia":
        return "flower" if key == "nature:flower" else "accent"
    if surface == "earth" and key == "resource:oil:empty":
        return "tar"
    renamed = {"concrete": "ruin", "water": "oil", "serviceSteel": "steel", "exhaust": "hotSteel"}
    return renamed.get(surface, surface)


def tint(name, color):
    if name in ("flower", "accent"):
        return [min(1, value) for value in color]
    strength = .42 if name in ("oilRock", "rock", "mossRock", "pine", "leaf", "bark", "earth") else .22
    return [1 - strength + strength * math.sqrt(max(0, min(1, value))) for value in color]
