"""Bake a seamless painted-steel pipe surface for the 2D and 3D renderers."""

from pathlib import Path

import numpy as np
from PIL import Image

SIZE = 192
OUT = Path(__file__).resolve().parents[1] / "public/assets/generated"
rng = np.random.default_rng(184116)
y, x = np.mgrid[0:SIZE, 0:SIZE] / SIZE


def tiled_noise(cells):
    lattice = rng.random((cells, cells))
    u, v = x * cells, y * cells
    col, row = u.astype(int), v.astype(int)
    fx, fy = u - col, v - row
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    top = lattice[row, col] * (1 - fx) + lattice[row, (col + 1) % cells] * fx
    bottom = lattice[(row + 1) % cells, col] * (1 - fx) + lattice[(row + 1) % cells, (col + 1) % cells] * fx
    return top * (1 - fy) + bottom * fy


cloud, grit, pores = tiled_noise(7), tiled_noise(26), rng.random((SIZE, SIZE))
seam = np.exp(-np.minimum(y, 1 - y) * 35)
scrape = np.maximum(0, np.cos((x * 19 + np.sin(y * np.pi * 4) * .06) * 2 * np.pi)) ** 14
scrape *= np.clip((grit - .38) * 2.9, 0, 1)
wear = np.clip((cloud * .58 + grit * .42 + seam * .22 - .56) * 4, 0, 1)
rust = np.clip((cloud * .52 + grit * .22 + seam * .38 - .59) * 3.6, 0, .88)
paint = np.array([103, 111, 103]) + (cloud[..., None] - .5) * 22 + (pores[..., None] - .5) * 7
steel = np.array([151, 153, 141]) + (grit[..., None] - .5) * 37
primer = np.array([110, 75, 52]) + (grit[..., None] - .5) * 30
surface = paint * (1 - wear[..., None]) + steel * wear[..., None]
surface = surface * (1 - rust[..., None]) + primer * rust[..., None] + scrape[..., None] * 21

height = cloud * .20 + grit * .11 + pores * .016 - rust * .19 - seam * .05 - scrape * .035
dx = (np.roll(height, 1, axis=1) - np.roll(height, -1, axis=1)) * 2.1
dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 2.1
normal = np.stack((dx, dy, np.ones_like(dx)), axis=2)
normal /= np.linalg.norm(normal, axis=2, keepdims=True)
roughness = 108 + cloud * 38 + rust * 59 + grit * 25 - scrape * 14


def write(name, data):
    Image.fromarray(np.clip(data, 0, 255).astype(np.uint8)).save(OUT / f"oil-pipe-{name}-v1.webp", lossless=True)


write("paint", surface)
write("normal", (normal * .5 + .5) * 255)
write("roughness", roughness)
