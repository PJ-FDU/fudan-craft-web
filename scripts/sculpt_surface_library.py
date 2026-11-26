"""Shared image sources for the sculpt bake, keyed by the authored surface."""

import hashlib
from functools import lru_cache
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = "scripts/material-library"
GENERATED = "public/assets/generated/micro"
FACTION = "docs/faction-materials"
LEGACY_ATLAS = "public/assets/generated/battle-materials.webp"
TERRAIN_ATLAS = "public/assets/generated/terrain-v2.png"

# (project file, quadrant in reading order or None, tile length, color mix, relief)
CONCRETE = (f"{LIBRARY}/surfaces/cast-concrete.png", None, 34, .48, .20)
ROCK = (f"{LIBRARY}/surfaces/layered-rock.png", None, 43, .42, .24)
WOOD = (f"{GENERATED}/mill-wood-grain.png", None, 50, .53, .13)
STEEL = (f"{LIBRARY}/brushed-gunmetal-wear.png", None, 23, .15, .09)
COATED = (f"{GENERATED}/micro-painted-armor.png", None, 26, .15, .09)
CERAMIC = (f"{LIBRARY}/ceramic-armor-grain.png", None, 25, .16, .08)
TREAD = (f"{LIBRARY}/surfaces/rubber-tread.png", None, 16, .37, .18)
TRACK = (f"{LIBRARY}/surfaces/cast-track-steel.png", None, 28, .27, .17)
SEAL = (f"{LIBRARY}/surfaces/ribbed-seal.png", None, 15, .26, .14)
EXHAUST = (f"{LIBRARY}/surfaces/heat-oxidized.png", None, 27, .34, .11)
ROOF = (f"{LIBRARY}/surfaces/pressed-roof.png", None, 42, .26, .105)
LEATHER = (f"{LIBRARY}/surfaces/worn-leather.png", None, 19, .20, .08)
CANVAS = (f"{LIBRARY}/desert-canvas-weave.png", None, 24, .24, .12)
NYLON = (f"{LIBRARY}/tactical-nylon-ripstop.png", None, 16, .18, .10)
GLASS = (f"{LIBRARY}/surfaces/optical-coating.png", None, 44, .12, 0)
BARK = (f"{LIBRARY}/surfaces/furrowed-bark.png", None, 28, .43, .21)
BIRCH = (f"{LIBRARY}/surfaces/birch-bark.png", None, 31, .58, .10)
MOSS = (f"{LIBRARY}/surfaces/moss-lichen.png", None, 38, .18, .10)

STELLAR = [(f"{FACTION}/sources-v4/stellar.png", i, length, strength, relief)
           for i, (length, strength, relief) in enumerate(((27, .22, .09), (32, .28, .045),
                                                             (24, .20, .105), (22, .23, .105)))]
BROOD = [(f"{FACTION}/sources-v4/brood.png", i, length, strength, relief)
         for i, (length, strength, relief) in enumerate(((23, .23, .18), (19, .23, .11),
                                                           (20, .22, .09), (24, .22, .11)))]
RELAY = [(f"{FACTION}/sources-v2/relay.png", i, 25, .18, .10) for i in range(4)]
INDUSTRIAL = [(f"{FACTION}/sources-v2/industrial.png", i, 25, .18, .08) for i in range(4)]
TITAN = [(f"{FACTION}/sources-v4/titan.png", i, 22, .18, .11) for i in range(4)]

RECIPES = {
    "wall": COATED, "concrete": CONCRETE, "stone": ROCK, "bark": WOOD,
    "roof": ROOF, "deck": COATED, "wing": COATED, "piston": STEEL,
    "weapon": STEEL, "grille": INDUSTRIAL[1], "exhaust": EXHAUST,
    "glass": GLASS, "optic": GLASS,
    "tread": TREAD, "track": TRACK, "fieldRubber": SEAL,
    "cloth": CANVAS, "scoutCloth": CANVAS, "undersuit": NYLON,
    "pine": (LEGACY_ATLAS, (0, 2, 4, 4), 27, .38, .13),
    "leaf": (LEGACY_ATLAS, (1, 2, 4, 4), 19, .37, .14),
    "grass": (TERRAIN_ATLAS, 0, 19, .37, .11),
    "earth": (TERRAIN_ATLAS, 1, 24, .42, .11),
    "ore": (f"{LIBRARY}/surfaces/gold-vein.png", None, 12, .34, .09),
    "water": (f"{LIBRARY}/surfaces/oil-film.png", None, 46, .11, .02),
    "armor": COATED, "helmet": CERAMIC, "chest": COATED, "guard": COATED,
    "mechPlate": COATED, "medicPanel": CERAMIC, "hazard": COATED, "insignia": COATED,
    "chitin": BROOD[0], "chitinLamella": BROOD[0], "membrane": BROOD[1],
    "nutrient": BROOD[2], "horn": BROOD[3],
    "ceramic": STELLAR[0], "photonicGlass": STELLAR[1], "astralAlloy": STELLAR[2],
    "stellarConductor": STELLAR[3], "conductor": STELLAR[3],
    "expeditionPlate": RELAY[0], "expeditionFrame": RELAY[1], "expeditionCanvas": CANVAS,
    "expeditionLaminate": (f"{FACTION}/accent-study.png", 3, 20, .24, .11),
    "federalPlate": INDUSTRIAL[0], "circuitry": INDUSTRIAL[1],
    "medicalComposite": INDUSTRIAL[2], "serviceSteel": INDUSTRIAL[3], "armorCeramic": CERAMIC,
    "titanArmor": TITAN[0], "titanSteel": TITAN[1], "titanSeal": SEAL, "titanTrim": TITAN[3],
}


def image_source(path, quadrant):
    original = bpy.data.images.load(str(ROOT / path), check_existing=True)
    if quadrant is None:
        return original
    name = f"Surface source {path} quarter {quadrant}"
    cached = bpy.data.images.get(name)
    if cached:
        return cached
    width, height = original.size
    channels = 4
    rgba = np.empty(width * height * channels, dtype=np.float32)
    original.pixels.foreach_get(rgba)
    col, row, cols, rows = quadrant if isinstance(quadrant, tuple) else (quadrant % 2, quadrant // 2, 2, 2)
    cell_width, cell_height = width // cols, height // rows
    x, y = col * cell_width, (rows - 1 - row) * cell_height
    material = rgba.reshape(height, width, channels)[y + 2:y + cell_height - 2, x + 2:x + cell_width - 2].copy()
    cropped = bpy.data.images.new(name, width=material.shape[1], height=material.shape[0], alpha=False)
    cropped.colorspace_settings.name = original.colorspace_settings.name
    cropped.pixels.foreach_set(material.ravel())
    cropped.pack()
    return cropped


@lru_cache(maxsize=None)
def source_hash(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def sources_for(materials):
    paths = {mat.get("authoredSurfaceSource") for mat in materials}
    return {path: {"file": path, "sha256": source_hash(path)} for path in sorted(paths - {None})}


def bind_surface(mat, coordinates, recipe, dimensions=(1, 1, 1), use_box=True):
    """Layer authored albedo, height and roughness over the sculpture's existing signals."""
    path, quadrant, length, color_mix, distance = recipe
    mat["authoredSurfaceSource"] = path
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    uv = nodes.new("ShaderNodeVectorMath")
    uv.operation = "MULTIPLY"
    uv.inputs[1].default_value = tuple(value / length for value in dimensions)
    links.new(coordinates, uv.inputs[0])

    texture = nodes.new("ShaderNodeTexImage")
    texture.label = "Authored surface image"
    texture.image = image_source(path, quadrant)
    if use_box:
        texture.projection = "BOX"
        texture.projection_blend = .22
    links.new(uv.outputs["Vector"], texture.inputs["Vector"])

    base = bsdf.inputs["Base Color"]
    tone = nodes.new("ShaderNodeMixRGB")
    tone.inputs[0].default_value = color_mix
    links.new(base.links[0].from_socket, tone.inputs[1])
    links.new(texture.outputs["Color"], tone.inputs[2])
    links.new(tone.outputs[0], base)

    if distance:
        normal = bsdf.inputs["Normal"]
        relief = nodes.new("ShaderNodeBump")
        relief.inputs["Strength"].default_value = .55
        relief.inputs["Distance"].default_value = distance
        links.new(texture.outputs["Color"], relief.inputs["Height"])
        if normal.is_linked:
            links.new(normal.links[0].from_socket, relief.inputs["Normal"])
        links.new(relief.outputs["Normal"], normal)

        roughness = bsdf.inputs["Roughness"]
        center = mat["roughness"]
        texture_roughness = nodes.new("ShaderNodeMapRange")
        texture_roughness.inputs["From Min"].default_value = .09
        texture_roughness.inputs["From Max"].default_value = .62
        texture_roughness.inputs["To Min"].default_value = min(.96, center + .075)
        texture_roughness.inputs["To Max"].default_value = max(.08, center - .065)
        links.new(texture.outputs["Color"], texture_roughness.inputs["Value"])
        links.new(texture_roughness.outputs["Result"], roughness)
