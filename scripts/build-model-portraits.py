"""Pack transparent painted unit art into the atlas used by the archives and HUD."""

import json
from pathlib import Path
import subprocess

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "docs/model-portraits/sources"
TILE = 224
PADDING = 14
CELL_GRID = 3


def portrait_catalog():
    # The runtime and packer resolve the same cell order from the TS catalog.
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", """
import { PORTRAIT_SHEETS, PORTRAIT_COLUMNS, PORTRAIT_ROWS, PORTRAIT_FILE } from './src/game/model-portraits.ts';
console.log(JSON.stringify({sheets:PORTRAIT_SHEETS, columns:PORTRAIT_COLUMNS, rows:PORTRAIT_ROWS, file:PORTRAIT_FILE}));
"""], cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout)


def fitted_crop(source, position, name):
    x, y = position % CELL_GRID, position // CELL_GRID
    w, h = source.size
    left, top = round(x*w/CELL_GRID), round(y*h/CELL_GRID)
    right, bottom = round((x+1)*w/CELL_GRID), round((y+1)*h/CELL_GRID)
    cell = source.crop((left, top, right, bottom))
    extent = cell.getchannel("A").point(lambda alpha: 255 if alpha >= 32 else 0).getbbox()
    if extent is None or min(extent[2]-extent[0], extent[3]-extent[1]) < 20:
        raise ValueError(f"Missing illustrated subject in {name}, cell {position+1}")
    if extent[0] < 2 or extent[1] < 2 or extent[2] > cell.width-2 or extent[3] > cell.height-2:
        raise ValueError(f"Artwork reaches an adjacent cell in {name}, cell {position+1}")
    # Retain the original soft alpha edges inside a small margin around the subject.
    crop = cell.crop((extent[0]-2, extent[1]-2, extent[2]+2, extent[3]+2))
    scale = (TILE-2*PADDING) / max(crop.size)
    return crop.resize((round(crop.width*scale), round(crop.height*scale)), Image.Resampling.LANCZOS)


def main():
    catalog = portrait_catalog()
    columns, rows = catalog["columns"], catalog["rows"]
    packed = Image.new("RGBA", (columns*TILE, rows*TILE))
    index = 0
    for name, portraits in catalog["sheets"].items():
        with Image.open(SOURCES / f"{name}.png") as artwork:
            if "A" not in artwork.getbands():
                raise ValueError(f"{name} requires transparent source art")
            for position in range(len(portraits)):
                icon = fitted_crop(artwork, position, name)
                x = index % columns*TILE + (TILE-icon.width)//2
                y = index // columns*TILE + (TILE-icon.height)//2
                packed.alpha_composite(icon, (x, y))
                index += 1
    output = ROOT / "public/assets" / catalog["file"]
    packed.save(output, quality=92, method=6, alpha_quality=100)
    print(f"{index} portraits · {packed.width} × {packed.height} · {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
