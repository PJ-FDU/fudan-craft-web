"""从实际参考图和低模渲染生成单车对照，可在每次重建后重复运行。"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
directory = root / "artifacts/worker-hero"
source = json.loads((root / ".cache/sculpt-source/source.json").read_text())
reference = Image.open(root / "public/assets/generated/model-portraits-v2.webp").convert("RGBA")
rows = (len(source["portraits"]) + 7) // 8
reference = reference.crop((0, 0, round(reference.width / 8), round(reference.height / rows)))
model = Image.open(directory / "worker-front.png").convert("RGBA")
canvas = Image.new("RGB", (1440, 860), "#17212a")
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 17)
draw.text((40, 30), "INDUSTRIAL FEDERATION  /  ENGINEERING HARVESTER", font=font, fill="#d7d9cb")
for col, image in enumerate((reference, model)):
    image = image.crop(image.getbbox())
    scale = min(620/image.width, 640/image.height)
    image = image.resize((round(image.width*scale), round(image.height*scale)), Image.Resampling.LANCZOS)
    canvas.paste(image, (col * 720 + (720-image.width)//2, 118 + (640-image.height)//2), image)
draw.text((46, 94), "REFERENCE PORTRAIT", font=small, fill="#d1b476")
draw.text((766, 94), "ACTUAL LOW MESH + BAKED PBR", font=small, fill="#d1b476")
record = json.loads((directory / "worker-bake.json").read_text())[0]
draw.text((46, 802), "Four wheels / sloped cab / twin hydraulic arms", font=small, fill="#a9b8bf")
draw.text((766, 802), f'{record["tileSize"]}px PBR / 3 runtime meshes / editable Blender rig',
          font=small, fill="#a9b8bf")
canvas.save(directory / "reference-comparison.png")
print(directory / "reference-comparison.png")

# 保留上一版实际渲染，按同一镜头展示材质与实体破损的变化。
before_path = directory / "worker-before-weathering.png"
if before_path.is_file():
    canvas = Image.new("RGB", (1600, 960), "#17212a")
    draw = ImageDraw.Draw(canvas)
    draw.text((40, 28), "ENGINEERING HARVESTER  /  BATTLEFIELD WEATHERING", font=font, fill="#d7d9cb")
    for col, path in enumerate((before_path, directory / "worker-front.png")):
        image = Image.open(path).convert("RGBA")
        image = image.crop(image.getbbox())
        image.thumbnail((740, 748), Image.Resampling.LANCZOS)
        canvas.paste(image, (col * 800 + (800-image.width)//2, 125 + (748-image.height)//2), image)
    draw.text((40, 90), "BEFORE  /  CLEAN PROCEDURAL MATERIAL", font=small, fill="#a9b8bf")
    draw.text((840, 90), "AFTER  /  GENERATED TEXTURES + LOCAL DAMAGE", font=small, fill="#d1b476")
    draw.text((40, 898), "Same camera and lighting. Actual low meshes and baked game PBR in both views.",
              font=small, fill="#a9b8bf")
    draw.text((840, 898), "Paint chips / rust / muddy tires / dented fender / scraped arm",
              font=small, fill="#a9b8bf")
    canvas.save(directory / "battlewear-comparison.png")
    print(directory / "battlewear-comparison.png")
