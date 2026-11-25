"""把实际 Blender 低模渲染与用户指定原画放在同一尺寸下比较。"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
directory = root / "artifacts/blender-sculpt"
reference = Image.open(root / "public/assets/generated/model-portraits-v2.webp").convert("RGBA")
order = json.loads((root / ".cache/sculpt-source/source.json").read_text())["portraits"]
report = json.loads((directory / "render-report.json").read_text())
manifest = json.loads((root / "public/assets/blender-sculpt-v2/manifest.json").read_text())
if report["keys"] != order or report["scriptHash"] != manifest["scriptHash"]:
    raise ValueError("Render the current complete sculpt library before comparing")
if report.get("generatorHashes", {}) != {key: value["scriptHash"] for key, value in manifest.get("generators", {}).items()}:
    raise ValueError("Per-model generator versions changed before comparing")
subjects = [("industrial:mech", "INDUSTRIAL / TITAN"),
            ("brood:behemoth", "BROOD / BEHEMOTH"),
            ("stellar:colossus", "STELLAR / COLOSSUS"),
            ("relay:ranger", "RELAY / RANGER")]
cell, margin, heading = 320, 24, 50
columns, rows = 8, (len(order) + 7) // 8
canvas = Image.new("RGB", (cell * 4 + margin * 2, cell * 2 + heading * 2 + margin * 2), "#18212b")
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
draw.text((margin, 16), "REFERENCE PORTRAIT   /   BLENDER LOW MESH + BAKED PBR", fill="#c2cbd4", font=font)
for col, (key, label) in enumerate(subjects):
    name, index = key.replace(":", "-"), order.index(key)
    x = margin + col * cell
    # 按实际图像尺寸分格，同时兼容原始 224px 图块与缩放后的图集。
    portrait = reference.crop((round(index % columns * reference.width / columns),
                               round(index // columns * reference.height / rows),
                               round((index % columns + 1) * reference.width / columns),
                               round((index // columns + 1) * reference.height / rows)))
    model = Image.open(directory / "portraits" / (name + ".png")).convert("RGBA")
    for row, image in enumerate((portrait, model)):
        bounds = image.getbbox()
        if bounds is None:
            raise ValueError("Empty subject: " + name)
        image = image.crop(bounds)
        scale = (cell - 40) / max(image.size)
        image = image.resize(tuple(max(1, round(size * scale)) for size in image.size),
                             Image.Resampling.LANCZOS)
        y = heading + margin + row * (cell + heading)
        canvas.paste(image, (x + (cell - image.width) // 2, y + (cell - image.height) // 2), image)
    draw.text((x + 12, heading + margin + cell), label, fill="#c2cbd4", font=font)
canvas.save(directory / "reference-comparison.png")
print(directory / "reference-comparison.png")
