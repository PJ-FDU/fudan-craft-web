import json
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
directory = root / "artifacts/blender-sculpt"
order = json.loads((root / ".cache/sculpt-source/source.json").read_text())["portraits"]
report = json.loads((directory / "render-report.json").read_text())
manifest = json.loads((root / "public/assets/blender-sculpt-v2/manifest.json").read_text())
if report["keys"] != order or report["scriptHash"] != manifest["scriptHash"]:
    raise ValueError("Render the current complete sculpt library before packing")
if report.get("generatorHashes", {}) != {key: value["scriptHash"] for key, value in manifest.get("generators", {}).items()}:
    raise ValueError("Per-model generator versions changed before packing")
cell = 224
canvas = Image.new("RGB", (cell * 8, cell * ((len(order) + 7) // 8)), "#18212b")
for index, key in enumerate(order):
    image = Image.open(directory / "portraits" / (key.replace(":", "-") + ".png")).convert("RGBA")
    bounds = image.getbbox()
    if bounds is None:
        raise ValueError("Empty model: " + key)
    image = image.crop(bounds)
    image.thumbnail((cell - 26, cell - 26), Image.Resampling.LANCZOS)
    x, y = index % 8 * cell, index // 8 * cell
    canvas.paste(image, (x + (cell - image.width) // 2, y + (cell - image.height) // 2), image)
canvas.save(directory / "model-library.webp", quality=95)
print(directory / "model-library.webp")
