"""Pack generated faction albedo and bake tangent normals and relative roughness."""
from pathlib import Path
from math import sqrt
from contextlib import ExitStack

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "docs/faction-materials/sources-v2"
OUTPUT = ROOT / "public/assets/generated"
CELL = 256

V4 = SOURCES.parent / "sources-v4"
SHEETS = {
    "brood": V4 / "brood.png", "stellar": V4 / "stellar.png", "titan": V4 / "titan.png",
    "stellar-v2": SOURCES / "stellar.png", "relay": SOURCES / "relay.png",
    "industrial": SOURCES / "industrial.png", "accents": SOURCES.parent / "accent-study.png",
}
# Source sheet, quadrant, relief, roughness response. The first four columns
# keep the faction material order, with accents and Titan surfaces on the right.
ROWS = (
    (("brood", 0, 9, 1.45), ("brood", 1, 8, 1.3), ("brood", 2, 8, 1.4), ("brood", 3, 8, 1.1),
     ("brood", 0, 11, 1.45), ("titan", 0, 8, 1.4)),
    (("stellar", 0, 7, 1.2), ("stellar", 3, 6, 1.0), ("stellar", 2, 6, 1.2), ("stellar-v2", 3, 6, 1.15),
     ("stellar", 1, 4, .84), ("titan", 1, 6, 1.1)),
    (("relay", 0, 7, 1.4), ("relay", 1, 6, 1), ("relay", 2, 13, .8), ("relay", 3, 11, 1.1),
     ("accents", 3, 9, 1.3), ("titan", 2, 9, .85)),
    (("industrial", 0, 7, 1.4), ("industrial", 1, 7, 1.1), ("industrial", 2, 5, .9), ("industrial", 3, 6, 1.1),
     ("accents", 0, 7, 1.15), ("titan", 3, 7, 1.35)),
)


def detail_map(tile, strength, abrasion):
    # Local luminance detail approximates surface micro-relief. Remove broad
    # lighting and color variation before deriving slope and roughness.
    gray = tile.convert("L")
    close = gray.filter(ImageFilter.GaussianBlur(.85)).load()
    wide = gray.filter(ImageFilter.GaussianBlur(5)).load()
    heights = [[(close[x, y] - wide[x, y]) / 255 for x in range(CELL)] for y in range(CELL)]
    packed = Image.new("RGB", tile.size)
    pixels = packed.load()
    for y in range(CELL):
        previous, following = heights[max(0, y - 1)], heights[min(CELL - 1, y + 1)]
        for x in range(CELL):
            edge = min(1, min(x, y, CELL - 1 - x, CELL - 1 - y) / 7)
            dx = heights[y][max(0, x - 1)] - heights[y][min(CELL - 1, x + 1)]
            dy = following[x] - previous[x]  # V points up, image rows point down.
            nx, ny = dx * strength * edge, dy * strength * edge
            length = sqrt(1 + nx * nx + ny * ny)
            roughness = max(-.45, min(.45, heights[y][x] * abrasion * 2.6))
            pixels[x, y] = (
                round(127.5 * (1 + nx / length)) // 2 * 2,
                round(127.5 * (1 + ny / length)) // 2 * 2,
                round(255 * (.5 + roughness)) // 4 * 4 + 2,
            )
    return packed


def swatch(image, quadrant, inset=.018):
    width, height = image.size
    border = round(min(width, height) * inset)
    x, y = (quadrant % 2) * (width // 2), (quadrant // 2) * (height // 2)
    crop = image.crop((x + border, y + border, x + width // 2 - border, y + height // 2 - border))
    return crop.convert("RGB").resize((CELL, CELL), Image.Resampling.LANCZOS)


def main():
    size = (CELL * len(ROWS[0]), CELL * len(ROWS))
    albedo, packed = Image.new("RGB", size), Image.new("RGB", size)
    with ExitStack() as stack:
        images = {name: stack.enter_context(Image.open(path)) for name, path in SHEETS.items()}
        for row, materials in enumerate(ROWS):
            for col, (name, quadrant, strength, abrasion) in enumerate(materials):
                # A tighter crop gives the outer carapace larger, distinct scutes.
                tile = swatch(images[name], quadrant, .074 if (row, col) == (0, 4) else .018)
                origin = (col * CELL, row * CELL)
                albedo.paste(tile, origin)
                packed.paste(detail_map(tile, strength, abrasion), origin)
    albedo.save(OUTPUT / "faction-materials-v4.webp", quality=93, method=6)
    packed.save(OUTPUT / "faction-detail-v4.webp", lossless=True, method=6)


if __name__ == "__main__":
    main()
