"""
Stage 6.3 Complete Architectural Distinction Kit (Blender 5.0, CC0 original):
  Authors 17 brand-new bespoke 3D building models (each with lod0, lod1, lod2, shadow)
  using the shared 12-layer 1024^2 KTX2 surface array (`0 MB` extra texture VRAM!) so that
  EVERY SINGLE ONE of the 31 building types in Marchland has its own unmistakable silhouette,
  roofline, and signature working props:

   1. quarry_l1      — Open-cast stepped limestone quarry pit, oak derrick crane & suspended ashlar block
   2. iron_mine_l1   — Craggy ore mound, timbered mine adit tunnel portal, rail track, ore cart & rust spoil heap
   3. sawmill_l1     — Open carpenter's saw-shed, elevated trestle sawbench with steel blade, log deck & plank stacks
   4. forester_l1    — Woodland log cabin with twin fenced sapling nursery beds & young green pines
   5. hunter_l1      — Steep A-frame forest lodge with stag antlers, hide-stretching frame & drying racks
   6. tavern_l1      — Two-storey half-timbered village inn with covered ale-garden porch, tables & tavern sign
   7. brewery_l1     — Stone-and-timber brewhouse with tall louvered malt-kiln oast tower, copper vats & barrel pyramid
   8. pig_farm_l1    — Low thatched sty with enclosed muddy wattle-fenced pig pen, feeding troughs & straw heaps
   9. butcher_l1     — Half-timber butcher shop with striped awning, hanging hams/sausages, cleaver block & smokehouse
  10. vineyard_l1    — Whitewashed vintner's villa with leafy grapevine pergola arbor, purple grape clusters & winepress
  11. winery_l1      — Half-sunken vaulted stone wine cellar, giant oak fermentation tuns on cradles & burgundy casks
  12. tannery_l1     — Leatherworker's yard with 3 circular stone/oak soaking vats, angled hide frames & cured leather
  13. smelter_l1     — Towering stone bloomery blast furnace with glowing hearth, twin giant bellows, ore & charcoal bins
  14. armourer_l1    — Stone-and-oak guildhall with forge chimney, quenching trough & steel armour/helm display rack
  15. fletcher_l1    — Bowyer's timber shop with yew bow racks, arrow barrels & circular straw archery target butt
  16. stable_l1      — Long 3-stall cavalry stable with hayloft dormer, fenced horse paddock corral & water trough
  17. gun_foundry_l1 — Royal cannon foundry hall with domed bronze-melting furnace, timber crane & cast bronze cannon

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_buildings_s6.py
"""

import json
import math
import os
import sys
import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from build_house import (  # noqa: E402
    MeshBuilder,
    clear_scene,
)
from build_buildings_s4 import (  # noqa: E402
    add_oak_door,
    add_pyramidal_cap,
    add_window,
)
from build_buildings_s5 import (  # noqa: E402
    add_banner,
    add_half_timber_360,
    add_lancet_window,
    add_pitched_roof_360,
    export_and_optimize,
)

REPO_ROOT = "/home/antigravity/anbow1/mediveal-village"
GAME_ROOT = os.path.join(REPO_ROOT, "games/new-game")
RAW_OUT = "/tmp/stage5-buildings/raw_glb"
FINAL_OUT = os.path.join(GAME_ROOT, "public/assets/buildings")
PREVIEW_JPG = "/tmp/stage5-buildings/buildings_s6_preview.jpg"

os.makedirs(RAW_OUT, exist_ok=True)
os.makedirs(FINAL_OUT, exist_ok=True)


# ==============================================================================
# 1. QUARRY L1 (Real open-cast stepped stone quarry pit + oak derrick crane!)
# ==============================================================================
def build_quarry_l1(mb, lod):
    """Stepped limestone excavation pit cut into rear cliff, timber jib crane hoisting ashlar block & mason shed."""
    # Sunken quarry floor apron & gravel bed
    mb.add_box((0.0, -0.4, -0.15), (8.6, 7.8, 0.65), "rubble", tint=(0.86, 0.84, 0.79), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 2.0, 1.8), (8.2, 3.8, 3.8), "ashlar")
        mb.add_box((-2.5, -1.5, 1.5), (3.2, 2.6, 2.8), "boards")
        return

    # Rear & East Stepped Limestone Quarry Cliff Benches (+Y and +X) — bright freshly cut ashlar & cleft rock!
    # Bench 1 (lowest cut bench, z: 0..1.45 m)
    mb.add_box((0.2, 1.45, 0.72), (8.2, 3.8, 1.45), "ashlar", tint=(0.95, 0.93, 0.88), bevel=0.03)
    # Bench 2 (middle cut terrace, z: 1.45..2.85 m)
    mb.add_box((0.4, 2.15, 2.15), (7.4, 2.5, 1.45), "ashlar", tint=(0.97, 0.95, 0.90), bevel=0.03)
    # Bench 3 (upper natural rock overburden crest, z: 2.85..4.15 m)
    mb.add_box((0.5, 2.75, 3.45), (6.4, 1.45, 1.35), "rubble", taper_top=(0.88, 0.75), tint=(0.84, 0.82, 0.77), bevel=0.04)
    # Flanking East stepped quarry wall (+X)
    mb.add_box((3.25, -0.15, 1.05), (2.1, 4.8, 2.15), "ashlar", tint=(0.94, 0.92, 0.87), bevel=0.03)
    mb.add_box((3.55, 0.25, 2.45), (1.45, 3.6, 1.25), "rubble", tint=(0.88, 0.85, 0.80), bevel=0.03)

    # Vertical wedge/chisel split channels carved into quarry face
    if lod <= 1:
        for qx in (-2.4, -0.8, 0.8, 2.2):
            mb.add_box((qx, 0.88, 2.12), (0.14, 0.16, 1.38), "beam", tint=(0.32, 0.30, 0.28))
            mb.add_box((qx - 0.3, -0.44, 0.72), (0.14, 0.16, 1.38), "beam", tint=(0.32, 0.30, 0.28))

    # Central Heavy Oak Derrick / Jib Hoist Crane (standing at (0.6, -0.7), swinging toward front yard -Y!)
    cx, cy = 0.65, -0.65
    # Crane timber cross-base sleepers & mast pivot
    mb.add_box((cx, cy, 0.24), (2.2, 0.28, 0.24), "beam", tint=(0.76, 0.70, 0.62))
    mb.add_box((cx, cy, 0.24), (0.28, 2.2, 0.24), "beam", tint=(0.76, 0.70, 0.62))
    mb.add_cylinder((cx, cy, 0.2), (cx, cy, 5.15), 0.22, 0.18, 8, "beam", tint=(0.78, 0.72, 0.64))
    # Rear A-frame stiff-leg braces anchoring mast into quarry bench
    mb.add_beam((cx - 1.35, cy + 1.65, 1.35), (cx, cy, 4.65), 0.16, 0.16, "beam", tint=(0.74, 0.68, 0.60))
    mb.add_beam((cx + 1.35, cy + 1.65, 1.35), (cx, cy, 4.65), 0.16, 0.16, "beam", tint=(0.74, 0.68, 0.60))
    # Angled Jib Boom reaching forward-left over the loading apron (toward (-0.75, -2.55, 4.85))
    tip_x, tip_y, tip_z = -0.65, -2.55, 4.85
    mb.add_beam((cx, cy, 1.35), (tip_x, tip_y, tip_z), 0.18, 0.18, "beam", tint=(0.82, 0.76, 0.68))
    mb.add_beam((cx, cy, 4.85), (tip_x, tip_y, tip_z), 0.11, 0.11, "beam", tint=(0.70, 0.64, 0.56))
    # Hoist cable & suspended freshly-quarried limestone ashlar block hanging in mid-air!
    mb.add_cylinder((tip_x, tip_y, tip_z), (tip_x, tip_y, 2.05), 0.04, 0.04, 6, "beam", tint=(0.35, 0.33, 0.30))
    mb.add_box((tip_x, tip_y, 1.65), (1.15, 0.82, 0.76), "ashlar", tint=(0.98, 0.96, 0.91), bevel=0.02)
    mb.add_box((tip_x, tip_y, 1.65), (1.20, 0.12, 0.80), "beam", metal=0.9, tint=(0.28, 0.28, 0.30))

    # Open-Front Mason's Timber Work Shed on West side (-X, front entrance facing -Y / +Z glTF)
    sx, sy = -2.55, -1.25
    mb.add_box((sx, sy, 0.16), (3.1, 2.8, 0.24), "cobble", tint=(0.88, 0.86, 0.82))
    for px in (sx - 1.35, sx + 1.35):
        for py in (sy - 1.2, sy + 1.2):
            mb.add_box((px, py, 1.45), (0.18, 0.18, 2.6), "beam", tint=(0.76, 0.70, 0.63))
    # Sloped shingle lean-to roof over mason shed
    mb.add_box((sx, sy, 2.95), (3.5, 3.2, 0.18), "shingles", rot_euler=(0.24, 0.0, 0.0), tint=(0.88, 0.85, 0.80), bevel=0.02)

    # Stacked dressed white ashlar stone blocks at front entrance apron (-Y)
    for bx, by, bz, bw, bd, bh in [
        (2.15, -2.55, 0.48, 1.25, 0.85, 0.68),
        (2.15, -2.55, 1.14, 1.10, 0.78, 0.64),
        (0.85, -2.85, 0.44, 1.05, 0.76, 0.62),
        (-2.55, -1.25, 0.56, 1.25, 0.82, 0.68),
    ]:
        mb.add_box((bx, by, bz), (bw, bd, bh), "ashlar", tint=(0.97, 0.95, 0.90), bevel=0.02)


# ==============================================================================
# 2. IRON MINE L1 (Real timbered mine adit tunnel + rail track + ore cart + rust spoil!)
# ==============================================================================
def build_iron_mine_l1(mb, lod):
    """Dark iron-bearing rock mound with deep timbered tunnel adit facing front (-Y), rail tracks & ore cart."""
    # Craggy iron-rich rock base pad
    mb.add_box((0.0, 0.0, -0.15), (8.8, 8.2, 0.65), "rubble", tint=(0.56, 0.48, 0.44), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 1.2, 2.1), (7.6, 5.2, 4.2), "rubble", taper_top=(0.75, 0.72))
        return

    # Iron-stained Mountain/Hillside Mound at rear (+Y) into which the mine shaft is driven
    mb.add_box((0.0, 1.35, 1.85), (7.8, 5.2, 3.7), "rubble", taper_top=(0.78, 0.72), tint=(0.58, 0.49, 0.44), bevel=0.05)
    mb.add_box((-0.6, 1.75, 3.65), (5.4, 3.6, 1.85), "rubble", taper_top=(0.62, 0.58), tint=(0.52, 0.44, 0.40), bevel=0.05)
    # Rust-red iron-ore vein strata cutting across the rock face
    mb.add_box((1.65, 0.45, 2.25), (3.4, 2.8, 0.85), "rubble", rot_euler=(0.15, -0.22, 0.1), tint=(0.72, 0.36, 0.24), bevel=0.03)

    # Prominent Timbered Mine Adit / Tunnel Portal facing Front (-Y / +Z glTF)!
    # Pitch-black recessed underground mine tunnel mouth (at x = -0.35, y = -1.25)
    tx, ty = -0.35, -1.22
    mb.add_box((tx, ty + 0.55, 1.32), (2.15, 1.65, 2.35), "beam", tint=(0.10, 0.09, 0.09))
    # Heavy mine-timber portal sets (3 stepped oak collars + lagging boards)
    for iy, sy_off in enumerate([0.0, -0.48, -0.95]):
        py = ty + sy_off
        h = 2.45 - iy * 0.06
        w = 2.35 - iy * 0.06
        for sx in (-w * 0.5, w * 0.5):
            mb.add_box((tx + sx, py, h * 0.5 + 0.12), (0.28, 0.28, h), "beam", rot_euler=(0.0, -sx * 0.04, 0.0), tint=(0.74, 0.66, 0.56), bevel=0.015)
        mb.add_box((tx, py, h + 0.18), (w + 0.48, 0.30, 0.28), "beam", tint=(0.78, 0.70, 0.60), bevel=0.015)
    # Timber lagging roof over the adit portal
    mb.add_box((tx, ty - 0.52, 2.74), (2.65, 1.35, 0.18), "boards", rot_euler=(0.15, 0.0, 0.0), tint=(0.72, 0.65, 0.56))

    # Wooden Mine Rail Track emerging from tunnel portal out to front yard (y: -0.8 .. -3.85)
    for ry in (-1.1, -1.6, -2.1, -2.6, -3.1, -3.6):
        mb.add_box((tx, ry, 0.20), (1.38, 0.18, 0.10), "beam", tint=(0.64, 0.58, 0.50))
    for rx_off in (-0.44, 0.44):
        mb.add_box((tx + rx_off, -2.35, 0.28), (0.10, 3.15, 0.12), "beam", metal=0.85, tint=(0.42, 0.40, 0.38))

    # Wheeled Iron-Bound Ore Cart on the rails heaped with rust-red iron ore!
    cy = -2.85
    mb.add_box((tx, cy, 0.72), (1.12, 1.48, 0.68), "boards", taper_top=(1.12, 1.08), tint=(0.68, 0.58, 0.48), bevel=0.015)
    mb.add_box((tx, cy, 0.72), (1.16, 0.14, 0.70), "beam", metal=0.92, tint=(0.28, 0.28, 0.30))
    # Heap of rich rust-red iron ore inside the cart
    mb.add_box((tx, cy, 1.12), (0.98, 1.28, 0.38), "rubble", taper_top=(0.55, 0.55), tint=(0.78, 0.35, 0.22), bevel=0.04)
    if lod <= 1:
        for wx_o in (-0.52, 0.52):
            for wy_o in (-0.45, 0.45):
                mb.add_cylinder((tx + wx_o - 0.06, cy + wy_o, 0.36), (tx + wx_o + 0.06, cy + wy_o, 0.36), 0.22, 0.22, 8, "beam", metal=0.9, tint=(0.30, 0.30, 0.32))

    # Upper Pithead Timber Headframe / Ventilation Shaft Winch on top of mound (+X, +Y)
    hx, hy = 1.65, 1.45
    mb.add_box((hx, hy, 3.65), (1.75, 1.75, 0.45), "beam", tint=(0.74, 0.67, 0.58))
    for sx in (-0.72, 0.72):
        mb.add_beam((hx + sx, hy - 0.75, 3.65), (hx + sx * 0.3, hy, 5.75), 0.16, 0.16, "beam", tint=(0.78, 0.71, 0.62))
        mb.add_beam((hx + sx, hy + 0.75, 3.65), (hx + sx * 0.3, hy, 5.75), 0.16, 0.16, "beam", tint=(0.78, 0.71, 0.62))
    mb.add_cylinder((hx - 0.7, hy, 5.55), (hx + 0.7, hy, 5.55), 0.24, 0.24, 8, "beam", tint=(0.70, 0.63, 0.54))

    # Rust-Red Iron Ore Spoil Heap & Miner's Timber Sorting Bunk on East apron (+X, -Y)
    mb.add_box((2.45, -1.85, 0.62), (2.35, 2.15, 0.95), "rubble", taper_top=(0.48, 0.48), tint=(0.76, 0.34, 0.21), bevel=0.05)
    mb.add_box((2.55, -0.55, 1.05), (1.65, 1.45, 0.75), "rubble", taper_top=(0.52, 0.52), tint=(0.68, 0.32, 0.22), bevel=0.04)


# ==============================================================================
# 3. SAWMILL L1 (Open timber saw-shed, elevated trestle sawbench, log deck & planks)
# ==============================================================================
def build_sawmill_l1(mb, lod):
    """Open-sided carpenter's sawmill shed with frame-saw trestle, steel sawblade, log deck & golden plank stacks."""
    mb.add_box((0.0, 0.0, 0.08), (8.4, 7.2, 0.85), "cobble", tint=(0.89, 0.86, 0.82), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.5, 0.3, 2.2), (6.8, 4.8, 3.6), "boards")
        return

    # Open 6-post Heavy Oak Saw-Shed (centered at (-0.4, 0.35), roof ridge along X)
    cx, cy = -0.45, 0.35
    hx, hy = 3.25, 2.15
    for px in (cx - hx, cx, cx + hx):
        for py in (cy - hy, cy + hy):
            mb.add_box((px, py, 1.75), (0.24, 0.24, 2.95), "beam", tint=(0.78, 0.72, 0.65), bevel=0.015)
    # Rear board windbreak wall (+Y)
    mb.add_box((cx, cy + hy - 0.08, 1.72), (hx * 2.0, 0.18, 2.85), "boards", tint=(0.82, 0.76, 0.68))
    add_pitched_roof_360(mb, cx, cy, hx + 0.1, hy + 0.1, 3.18, 5.15, "boards", "boards", overhang=0.45, roof_tint=(0.84, 0.76, 0.66), gable_tint=(0.82, 0.74, 0.64), lod=lod)

    # Central Elevated Trestle Saw-Bench & Vertical Steel Frame-Saw under the roof!
    mb.add_box((cx, cy - 0.15, 1.22), (4.6, 0.95, 0.18), "beam", tint=(0.76, 0.70, 0.62))
    for tx_o in (-1.8, 0.0, 1.8):
        mb.add_box((cx + tx_o, cy - 0.15, 0.75), (0.22, 1.05, 0.85), "beam", tint=(0.74, 0.68, 0.60))
    # Big half-sawn oak log lying on the sawbench
    mb.add_cylinder((cx - 2.1, cy - 0.15, 1.62), (cx + 1.9, cy - 0.15, 1.62), 0.36, 0.34, 10, "bark", tint=(0.72, 0.64, 0.54))
    # Vertical reciprocating frame-saw & gleaming steel blade cutting the log
    mb.add_box((cx + 0.15, cy - 0.15, 2.05), (0.14, 1.25, 1.65), "beam", tint=(0.84, 0.78, 0.68))
    mb.add_box((cx + 0.15, cy - 0.15, 2.05), (0.04, 0.28, 1.55), "beam", metal=0.95, tint=(0.88, 0.90, 0.94))

    # Front-West Log Deck (-X, -Y): pyramid of raw bark logs waiting to be sawn
    for lx, ly, lz in [
        (-2.35, -2.55, 0.58),
        (-2.35, -2.02, 0.58),
        (-2.35, -1.50, 0.58),
        (-2.35, -2.28, 1.02),
        (-2.35, -1.75, 1.02),
    ]:
        mb.add_cylinder((lx - 1.25, ly, lz), (lx + 1.25, ly, lz), 0.26, 0.25, 8, "bark", tint=(0.70, 0.62, 0.52))

    # Front-East Stack of Freshly Sawn Golden Planks (+X, -Y)
    for iz in range(4):
        mb.add_box((2.35, -2.25, 0.45 + iz * 0.24), (2.45, 1.35, 0.18), "boards", tint=(0.98, 0.88, 0.70), bevel=0.01)


# ==============================================================================
# 4. FORESTER L1 (Woodland log cabin + fenced green sapling nursery beds!)
# ==============================================================================
def build_forester_l1(mb, lod):
    """Rustic log forester's cabin with mossy thatch roof and twin fenced tree-sapling nursery beds."""
    mb.add_box((0.0, 0.0, 0.06), (7.6, 6.8, 0.75), "cobble", tint=(0.86, 0.84, 0.79), bevel=0.03)
    if lod == 3:
        mb.add_box((-1.1, 0.6, 1.9), (4.6, 4.0, 2.8), "bark")
        mb.add_box((-1.1, 0.6, 3.8), (5.0, 4.4, 2.0), "thatch", taper_top=(1.0, 0.15))
        return

    # Log Cabin Body on West side (-X, +Y, front door facing -Y)
    cx, cy = -1.15, 0.65
    hx, hy = 2.15, 1.85
    mb.add_box((cx, cy, 1.65), (hx * 2.0, hy * 2.0, 2.55), "bark", tint=(0.78, 0.70, 0.60), bevel=0.03)
    if lod <= 1:
        # Interlocking horizontal log tiers at corners
        for iz in range(5):
            z = 0.65 + iz * 0.48
            mb.add_box((cx, cy - hy - 0.04, z), (hx * 2.0 + 0.28, 0.18, 0.22), "bark", tint=(0.76, 0.68, 0.58))
            mb.add_box((cx, cy + hy + 0.04, z), (hx * 2.0 + 0.28, 0.18, 0.22), "bark", tint=(0.76, 0.68, 0.58))
        add_oak_door(mb, cx, cy - hy - 0.04, 0.35, w=0.98, h=1.88)
        add_window(mb, cx + 1.1, cy - hy - 0.04, 1.55, w=0.58, h=0.68)

    # Moss-tinted Woodland Thatch Roof
    add_pitched_roof_360(mb, cx, cy, hx + 0.1, hy + 0.1, 2.88, 4.75, "thatch", "bark", overhang=0.42, roof_tint=(0.76, 0.82, 0.64), gable_tint=(0.74, 0.66, 0.56), lod=lod)

    # Twin Fenced Tree-Sapling Nursery Beds on East & Front yard (+X and -Y)
    for bx, by in [(2.15, 0.55), (1.65, -2.05)]:
        mb.add_box((bx, by, 0.38), (2.25, 1.85, 0.26), "dirt", tint=(0.55, 0.44, 0.34), bevel=0.02)
        mb.add_box((bx, by, 0.44), (2.42, 2.02, 0.22), "beam", tint=(0.74, 0.68, 0.58))
        # Rows of vibrant green young tree saplings growing in the nursery beds!
        for sx_o in (-0.65, 0.0, 0.65):
            for sy_o in (-0.45, 0.45):
                px, py = bx + sx_o, by + sy_o
                mb.add_cylinder((px, py, 0.48), (px, py, 0.92), 0.05, 0.04, 5, "bark")
                mb.add_cylinder((px, py, 0.78), (px, py, 1.58), 0.32, 0.03, 6, "grass", tint=(0.42, 0.78, 0.36))


# ==============================================================================
# 5. HUNTER L1 (Steep A-frame hunting lodge, stag antlers & hide-drying rack!)
# ==============================================================================
def build_hunter_l1(mb, lod):
    """Steep-roofed forest hunter's lodge with stag antlers over door, hide-stretching frame & game rack."""
    mb.add_box((0.0, 0.0, 0.06), (7.4, 6.6, 0.75), "cobble", tint=(0.86, 0.83, 0.78), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.6, 0.4, 2.2), (4.8, 4.2, 3.8), "shingles", taper_top=(1.0, 0.12))
        return

    # Steep Gabled Hunting Lodge (ridge along Y so front gable faces -Y / +Z glTF!)
    cx, cy = -0.65, 0.35
    hx, hy = 2.25, 2.15
    mb.add_box((cx, cy, 1.35), (hx * 2.0, hy * 2.0, 1.95), "boards", tint=(0.74, 0.65, 0.55), bevel=0.02)
    add_pitched_roof_360(mb, cx, cy, hx + 0.15, hy + 0.15, 2.22, 4.95, "shingles", "boards", overhang=0.48, roof_tint=(0.68, 0.58, 0.48), gable_tint=(0.74, 0.65, 0.55), lod=lod, ridge_axis="y")

    if lod <= 1:
        add_oak_door(mb, cx, cy - hy - 0.04, 0.35, w=1.02, h=1.92)
        # Trophy Stag Antlers mounted prominently on the front gable above the door!
        ay = cy - hy - 0.14
        mb.add_box((cx, ay, 3.25), (0.34, 0.18, 0.38), "ashlar", tint=(0.96, 0.94, 0.88))
        for side in (-1.0, 1.0):
            mb.add_beam((cx, ay - 0.05, 3.35), (cx + side * 0.95, ay - 0.25, 3.95), 0.07, 0.05, "ashlar", tint=(0.94, 0.90, 0.82))
            mb.add_beam((cx + side * 0.45, ay - 0.15, 3.62), (cx + side * 0.55, ay - 0.32, 4.12), 0.05, 0.04, "ashlar", tint=(0.94, 0.90, 0.82))
            mb.add_beam((cx + side * 0.72, ay - 0.20, 3.78), (cx + side * 1.08, ay - 0.35, 4.22), 0.05, 0.04, "ashlar", tint=(0.94, 0.90, 0.82))

    # East Yard Timber Hide-Stretching Frame (+X) with taut tan pelts
    rx, ry = 2.35, -0.35
    mb.add_beam((rx - 0.95, ry, 0.25), (rx - 0.75, ry + 0.35, 2.55), 0.14, 0.14, "beam")
    mb.add_beam((rx + 0.95, ry, 0.25), (rx + 0.75, ry + 0.35, 2.55), 0.14, 0.14, "beam")
    mb.add_beam((rx - 0.95, ry + 0.38, 2.45), (rx + 0.95, ry + 0.38, 2.45), 0.12, 0.12, "beam")
    mb.add_box((rx, ry + 0.18, 1.42), (1.38, 0.08, 1.65), "linen", rot_euler=(-0.15, 0.0, 0.0), tint=(0.82, 0.62, 0.42))


# ==============================================================================
# 6. TAVERN L1 (Two-storey half-timbered village inn + covered ale garden & sign!)
# ==============================================================================
def build_tavern_l1(mb, lod):
    """Jettied two-storey half-timbered medieval inn with covered front beer-garden terrace, tables & sign."""
    mb.add_box((0.0, 0.0, 0.08), (9.2, 8.2, 0.95), "cobble", tint=(0.90, 0.88, 0.84), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.8, 2.8), (7.6, 5.2, 4.8), "plaster")
        mb.add_box((0.0, 0.8, 6.2), (8.0, 5.6, 2.6), "shingles", taper_top=(1.0, 0.12))
        return

    # Ground floor stone-and-timber hall (centered at (0.0, 0.85))
    cx, cy = 0.0, 0.85
    mb.add_box((cx, cy, 1.55), (7.2, 4.8, 2.25), "rubble", tint=(0.90, 0.87, 0.82), bevel=0.03)
    # Jettied (overhanging) Upper Half-Timbered Storey (z: 2.65..4.95 m)
    mb.add_box((cx, cy, 3.80), (7.6, 5.2, 2.30), "plaster", tint=(0.98, 0.94, 0.86), bevel=0.02)
    add_half_timber_360(mb, cx, cy, 3.8, 2.6, 2.65, 4.95, lod, bays_x=4, bays_y=2)
    add_pitched_roof_360(mb, cx, cy, 3.85, 2.65, 4.92, 7.35, "shingles", "plaster", overhang=0.46, roof_tint=(0.78, 0.44, 0.32), gable_tint=(0.98, 0.94, 0.86), lod=lod)

    # Hearth chimney on East roof slope (`smoke_0` at (2.6, 1.6, 7.65))
    mb.add_box((2.6, 1.6, 5.45), (0.92, 0.92, 4.35), "rubble", tint=(0.84, 0.80, 0.76), bevel=0.02)

    # Covered Front Ale-Garden Porch & Trestle Drinking Tables (-Y front entrance!)
    mb.add_box((0.0, -2.55, 2.55), (7.4, 2.15, 0.16), "shingles", rot_euler=(0.25, 0.0, 0.0), tint=(0.80, 0.46, 0.34), bevel=0.02)
    for px in (-3.3, -1.2, 1.2, 3.3):
        mb.add_box((px, -3.45, 1.38), (0.18, 0.18, 2.15), "beam", tint=(0.76, 0.70, 0.62))
    if lod <= 1:
        add_oak_door(mb, 0.0, -1.58, 0.45, w=1.22, h=2.05)
        for wx in (-2.2, 2.2):
            add_window(mb, wx, -1.58, 1.55, w=0.72, h=0.82)
            add_window(mb, wx, -1.78, 3.75, w=0.72, h=0.85)
        # Hanging Golden Tavern Signboard projecting from front jetty beam
        mb.add_box((1.45, -2.35, 3.85), (0.12, 1.25, 0.10), "beam", metal=0.9, tint=(0.28, 0.28, 0.30))
        mb.add_box((1.45, -2.75, 3.32), (0.10, 0.82, 0.78), "boards", tint=(0.96, 0.78, 0.32), bevel=0.015)
        # Outdoor oak trestle tables & benches on front cobble terrace
        for tx_o in (-2.25, 2.25):
            mb.add_box((tx_o, -2.65, 0.88), (1.65, 0.72, 0.12), "boards", tint=(0.82, 0.74, 0.64))
            mb.add_box((tx_o, -3.15, 0.65), (1.65, 0.28, 0.10), "boards", tint=(0.78, 0.70, 0.60))


# ==============================================================================
# 7. BREWERY L1 (Brewhouse with tall square malt-kiln oast tower & barrel pyramid!)
# ==============================================================================
def build_brewery_l1(mb, lod):
    """Medieval brewhouse featuring a tall square malt-kiln oast tower, copper mash tun & oak ale barrels."""
    mb.add_box((0.0, 0.0, 0.08), (8.2, 7.4, 0.90), "cobble", tint=(0.89, 0.86, 0.82), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.9, 0.4, 2.1), (5.2, 4.4, 3.4), "rubble")
        mb.add_box((2.1, 0.8, 3.8), (2.6, 2.6, 6.8), "rubble")
        return

    # Main Brewhouse Hall (-X)
    cx, cy = -0.95, 0.45
    mb.add_box((cx, cy, 1.85), (5.2, 4.4, 2.85), "plaster", tint=(0.95, 0.91, 0.84), bevel=0.02)
    add_half_timber_360(mb, cx, cy, 2.6, 2.2, 0.45, 3.25, lod, bays_x=3, bays_y=2)
    add_pitched_roof_360(mb, cx, cy, 2.65, 2.25, 3.22, 5.25, "shingles", "plaster", overhang=0.40, roof_tint=(0.72, 0.56, 0.44), gable_tint=(0.95, 0.91, 0.84), lod=lod)

    # Signature Tall Square Stone Malt-Kiln / Oast Tower on East flank (+X) rising to 8.2 m!
    kx, ky = 2.15, 0.75
    mb.add_box((kx, ky, 2.85), (2.65, 2.65, 4.95), "rubble", taper_top=(0.90, 0.90), tint=(0.86, 0.82, 0.77), bevel=0.03)
    add_pyramidal_cap(mb, kx, ky, 1.38, 5.25, 7.65, "shingles", tint=(0.68, 0.46, 0.34))
    # Louvered steam cowl vent atop the oast kiln (`smoke_0` at (2.15, 0.75, 8.15))
    mb.add_box((kx, ky, 7.82), (0.68, 0.68, 0.65), "beam", tint=(0.78, 0.72, 0.64))

    # Front Open Copper/Oak Mash-Tun Vat & Pyramid of Ale Barrels (-Y)
    if lod <= 1:
        add_oak_door(mb, cx - 0.4, cy - 2.24, 0.42, w=1.08, h=1.95)
        # Round banded mash tun vat on front-east patio
        mb.add_cylinder((2.05, -1.95, 0.42), (2.05, -1.95, 1.75), 0.92, 0.86, 12, "boards", tint=(0.82, 0.62, 0.42))
        mb.add_cylinder((2.05, -1.95, 1.45), (2.05, -1.95, 1.58), 0.94, 0.94, 12, "beam", metal=0.9, tint=(0.32, 0.32, 0.35))
        # Stacked oak beer casks by front entrance
        for bx_o in (-2.4, -1.45, -0.5):
            mb.add_cylinder((bx_o, -2.55, 0.72), (bx_o, -1.75, 0.72), 0.38, 0.38, 10, "boards", tint=(0.76, 0.58, 0.38))


# ==============================================================================
# 8. PIG FARM L1 (Low thatched sty + muddy wattle-fenced pig pen & troughs!)
# ==============================================================================
def build_pig_farm_l1(mb, lod):
    """Low thatched timber pigsty opening into a broad muddy wattle-fenced pig yard with troughs & straw."""
    mb.add_box((0.0, 0.0, 0.04), (8.6, 8.0, 0.70), "dirt", tint=(0.58, 0.46, 0.35), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 1.7, 1.6), (6.4, 3.2, 2.6), "thatch", taper_top=(1.0, 0.15))
        return

    # Low Thatched Pigsty Shelter across Rear (+Y)
    cx, cy = 0.0, 1.75
    hx, hy = 3.15, 1.55
    mb.add_box((cx, cy, 1.25), (hx * 2.0, hy * 2.0, 1.75), "boards", tint=(0.76, 0.68, 0.58), bevel=0.02)
    add_pitched_roof_360(mb, cx, cy, hx + 0.15, hy + 0.15, 2.05, 3.75, "thatch", "boards", overhang=0.45, roof_tint=(0.92, 0.84, 0.62), gable_tint=(0.76, 0.68, 0.58), lod=lod)

    # Enclosed Muddy Wattle-Fenced Pig Pen across the entire Front Yard (-Y: y from 0.1 to -3.35)
    mb.add_box((0.0, -1.65, 0.42), (6.4, 3.35, 0.12), "dirt", tint=(0.48, 0.36, 0.26))
    # Wattle fence rails & oak posts around the front pen
    for px in (-3.2, -1.6, 0.0, 1.6, 3.2):
        mb.add_box((px, -3.35, 0.82), (0.16, 0.16, 0.95), "beam", tint=(0.72, 0.64, 0.54))
    for py in (-2.2, -1.0):
        for sx in (-3.2, 3.2):
            mb.add_box((sx, py, 0.82), (0.16, 0.16, 0.95), "beam", tint=(0.72, 0.64, 0.54))
    mb.add_box((-1.6, -3.35, 0.78), (3.1, 0.12, 0.68), "thatch", tint=(0.74, 0.64, 0.48))
    mb.add_box((2.4, -3.35, 0.78), (1.5, 0.12, 0.68), "thatch", tint=(0.74, 0.64, 0.48))
    for sx in (-3.2, 3.2):
        mb.add_box((sx, -1.75, 0.78), (0.12, 3.15, 0.68), "thatch", tint=(0.74, 0.64, 0.48))

    # Feeding troughs & golden straw heap inside the pen
    if lod <= 1:
        mb.add_box((-1.45, -1.85, 0.58), (2.15, 0.52, 0.34), "beam", tint=(0.76, 0.68, 0.56))
        mb.add_box((1.75, -1.45, 0.66), (1.65, 1.45, 0.52), "thatch", taper_top=(0.55, 0.55), tint=(0.98, 0.88, 0.55), bevel=0.04)


# ==============================================================================
# 9. BUTCHER L1 (Half-timber shop with crimson-striped awning, hanging hams & block!)
# ==============================================================================
def build_butcher_l1(mb, lod):
    """Town butcher's shop with red-and-white market awning, meat-hanging rack, cleaver block & smokehouse."""
    mb.add_box((0.0, 0.0, 0.08), (7.6, 6.8, 0.85), "cobble", tint=(0.90, 0.88, 0.84), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.6, 0.5, 2.1), (5.2, 4.2, 3.4), "plaster")
        return

    # Main Half-Timbered Butcher Hall (-X, +Y)
    cx, cy = -0.55, 0.55
    hx, hy = 2.45, 1.95
    mb.add_box((cx, cy, 1.75), (hx * 2.0, hy * 2.0, 2.65), "plaster", tint=(0.98, 0.95, 0.90), bevel=0.02)
    add_half_timber_360(mb, cx, cy, hx, hy, 0.42, 3.05, lod, bays_x=3, bays_y=2)
    add_pitched_roof_360(mb, cx, cy, hx + 0.1, hy + 0.1, 3.02, 4.95, "shingles", "plaster", overhang=0.38, roof_tint=(0.76, 0.36, 0.28), gable_tint=(0.98, 0.95, 0.90), lod=lod)

    # Brick/Stone Smokehouse turret on East side (+X) with chimney (`smoke_0` at (2.45, 0.85, 5.25))
    mb.add_box((2.45, 0.85, 2.35), (1.65, 1.65, 3.95), "rubble", taper_top=(0.82, 0.82), tint=(0.78, 0.52, 0.44), bevel=0.02)

    # Crimson Linen Butcher's Front Awning, Open Counter, Hanging Hams & Chopping Block (-Y)
    mb.add_box((cx, -1.95, 2.35), (4.6, 1.45, 0.12), "linen", rot_euler=(0.28, 0.0, 0.0), tint=(0.76, 0.18, 0.18))
    mb.add_box((cx + 0.85, -1.55, 0.95), (2.25, 0.65, 0.85), "boards", tint=(0.84, 0.76, 0.66))
    if lod <= 1:
        add_oak_door(mb, cx - 1.25, cy - hy - 0.04, 0.42, w=0.98, h=1.88)
        # Hanging cured hams & sausage links under the front awning
        for hx_o in (-0.1, 0.55, 1.2, 1.85):
            mb.add_cylinder((cx + hx_o, -1.75, 1.45), (cx + hx_o, -1.75, 2.08), 0.18, 0.10, 7, "linen", tint=(0.72, 0.26, 0.22))
        # Heavy round oak butcher's chopping block in front yard
        mb.add_cylinder((2.15, -1.75, 0.42), (2.15, -1.75, 1.28), 0.52, 0.50, 10, "beam", tint=(0.82, 0.72, 0.60))


# ==============================================================================
# 10. VINEYARD L1 (Sunlit vintner's villa + leafy grapevine pergola arbor & press!)
# ==============================================================================
def build_vineyard_l1(mb, lod):
    """Whitewashed vintner's villa with terracotta roof, leafy green grapevine pergola arbor & wooden winepress."""
    mb.add_box((0.0, 0.0, 0.08), (8.6, 7.2, 0.85), "cobble", tint=(0.94, 0.91, 0.86), bevel=0.03)
    if lod == 3:
        mb.add_box((-1.1, 0.4, 2.1), (4.8, 4.2, 3.4), "plaster")
        return

    # Whitewashed Vintner's Villa (-X) with warm Mediterranean terracotta-tinted shingle roof
    cx, cy = -1.15, 0.35
    hx, hy = 2.25, 1.95
    mb.add_box((cx, cy, 1.82), (hx * 2.0, hy * 2.0, 2.75), "plaster", tint=(1.0, 0.97, 0.91), bevel=0.02)
    add_half_timber_360(mb, cx, cy, hx, hy, 0.42, 3.15, lod, bays_x=2, bays_y=2)
    add_pitched_roof_360(mb, cx, cy, hx + 0.12, hy + 0.12, 3.12, 4.85, "shingles", "plaster", overhang=0.44, roof_tint=(0.86, 0.48, 0.32), gable_tint=(1.0, 0.97, 0.91), lod=lod)

    # Signature Oak Grapevine Pergola Arbor on East & Front terrace (+X, -Y) draped in lush green vines & purple grapes!
    ax, ay = 2.15, 0.15
    for px in (ax - 1.35, ax + 1.35):
        for py in (ay - 1.85, ay, ay + 1.85):
            mb.add_box((px, py, 1.45), (0.16, 0.16, 2.25), "beam", tint=(0.76, 0.68, 0.58))
    # Overhead pergola trellis beams & vibrant green grapevine canopy
    mb.add_box((ax, ay, 2.62), (3.1, 4.1, 0.14), "beam", tint=(0.74, 0.66, 0.56))
    mb.add_box((ax, ay, 2.78), (2.95, 3.95, 0.32), "grass", tint=(0.38, 0.76, 0.28), bevel=0.04)
    if lod <= 1:
        add_oak_door(mb, cx, cy - hy - 0.04, 0.42, w=1.02, h=1.92)
        # Hanging purple grape clusters under the pergola trellis!
        for gx_o in (-0.85, 0.0, 0.85):
            for gy_o in (-1.2, 0.0, 1.2):
                mb.add_cylinder((ax + gx_o, ay + gy_o, 2.18), (ax + gx_o, ay + gy_o, 2.62), 0.08, 0.22, 6, "linen", tint=(0.44, 0.18, 0.52))
        # Outdoor wooden screw winepress on front terrace
        mb.add_cylinder((ax, -2.35, 0.42), (ax, -2.35, 1.35), 0.72, 0.72, 10, "boards", tint=(0.72, 0.42, 0.44))
        mb.add_cylinder((ax, -2.35, 1.35), (ax, -2.35, 2.35), 0.10, 0.10, 6, "beam")


# ==============================================================================
# 11. WINERY L1 (Vaulted stone wine cellar house, giant oak fermentation tuns & casks!)
# ==============================================================================
def build_winery_l1(mb, lod):
    """Stone wine-cellar hall with broad arched cellar portal, twin giant oak fermentation tuns & wine casks."""
    mb.add_box((0.0, 0.0, 0.08), (8.4, 7.6, 0.90), "cobble", tint=(0.90, 0.88, 0.84), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.6, 0.4, 2.2), (5.8, 4.8, 3.6), "ashlar")
        return

    # Solid Dressed-Ashlar Stone Cellar Hall (ridge along Y so vaulted gable portal faces front -Y!)
    cx, cy = -0.65, 0.45
    hx, hy = 2.65, 2.35
    mb.add_box((cx, cy, 1.85), (hx * 2.0, hy * 2.0, 2.85), "ashlar", tint=(0.92, 0.89, 0.84), bevel=0.03)
    add_pitched_roof_360(mb, cx, cy, hx + 0.12, hy + 0.12, 3.22, 5.35, "shingles", "ashlar", overhang=0.42, roof_tint=(0.64, 0.28, 0.30), gable_tint=(0.92, 0.89, 0.84), lod=lod, ridge_axis="y")

    # Twin Giant Horizontal Oak Fermentation Tuns (Casks) on East covered cradle bay (+X)
    for ty_o in (-0.85, 1.35):
        mb.add_box((2.65, ty_o, 0.65), (1.65, 1.55, 0.45), "beam", tint=(0.72, 0.64, 0.54))
        mb.add_cylinder((2.65, ty_o - 0.85, 1.55), (2.65, ty_o + 0.85, 1.55), 0.82, 0.82, 12, "boards", tint=(0.68, 0.34, 0.32))

    if lod <= 1:
        # Wide vaulted cellar double door on front (-Y)
        add_oak_door(mb, cx, cy - hy - 0.04, 0.42, w=1.55, h=2.15)
        # Rows of burgundy-stained wine barrels flanking front entrance
        for bx_o in (-2.2, -1.3, 0.8, 1.7):
            mb.add_cylinder((bx_o, -2.55, 0.72), (bx_o, -1.75, 0.72), 0.36, 0.36, 10, "boards", tint=(0.62, 0.22, 0.26))


# ==============================================================================
# 12. TANNERY L1 (Workshop with 3 circular stone/oak soaking vats & hide racks!)
# ==============================================================================
def build_tannery_l1(mb, lod):
    """Leatherworker's workshop with 3 circular bark-liquor soaking vats in the front yard & angled hide racks."""
    mb.add_box((0.0, 0.0, 0.08), (8.2, 7.6, 0.85), "cobble", tint=(0.86, 0.83, 0.78), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 1.3, 2.0), (6.2, 3.8, 3.2), "boards")
        return

    # Timber & Stone Tannery Shed across Rear (+Y)
    cx, cy = 0.0, 1.35
    hx, hy = 3.05, 1.85
    mb.add_box((cx, cy, 1.72), (hx * 2.0, hy * 2.0, 2.55), "boards", tint=(0.76, 0.66, 0.54), bevel=0.02)
    add_half_timber_360(mb, cx, cy, hx, hy, 0.42, 2.98, lod, bays_x=3, bays_y=2)
    add_pitched_roof_360(mb, cx, cy, hx + 0.1, hy + 0.1, 2.95, 4.75, "shingles", "boards", overhang=0.40, roof_tint=(0.66, 0.54, 0.42), gable_tint=(0.76, 0.66, 0.54), lod=lod)

    # Three Signature Circular Stone & Oak Tanning/Lime Vats in the Front Yard (-Y)!
    for vx, tint_liq in [(-2.15, (0.82, 0.78, 0.68)), (0.0, (0.64, 0.42, 0.24)), (2.15, (0.52, 0.32, 0.18))]:
        vy = -1.75
        mb.add_cylinder((vx, vy, 0.42), (vx, vy, 1.25), 0.92, 0.88, 12, "boards", tint=(0.72, 0.62, 0.50))
        mb.add_cylinder((vx, vy, 0.45), (vx, vy, 1.18), 0.78, 0.78, 12, "linen", tint=tint_liq)

    if lod <= 1:
        add_oak_door(mb, 0.0, cy - hy - 0.04, 0.42, w=1.05, h=1.92)
        # Angled leather-drying easel frames on West & East edges
        for sx in (-3.25, 3.25):
            mb.add_box((sx, -1.45, 1.35), (0.14, 1.85, 1.65), "linen", rot_euler=(0.0, sx * 0.08, 0.0), tint=(0.78, 0.56, 0.36))


# ==============================================================================
# 13. SMELTER L1 (Towering stone bloomery blast furnace, glowing hearth & twin bellows!)
# ==============================================================================
def build_smelter_l1(mb, lod):
    """Stone bloomery & blast furnace stack (7.6 m tall, `smoke_0`) with glowing hearth, twin bellows & ore bins."""
    mb.add_box((0.0, 0.0, 0.08), (8.4, 7.6, 0.90), "cobble", tint=(0.78, 0.75, 0.72), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.8, 0.5, 3.6), (3.8, 3.8, 6.8), "rubble", taper_top=(0.62, 0.62))
        return

    # Monumental Tapered Stone Blast Furnace Stack (-X, +Y, rising to 7.45 m, `smoke_0` at (-0.85, 0.55, 7.65))
    fx, fy = -0.85, 0.55
    mb.add_box((fx, fy, 2.25), (3.85, 3.85, 3.75), "rubble", taper_top=(0.78, 0.78), tint=(0.76, 0.72, 0.68), bevel=0.04)
    mb.add_box((fx, fy, 5.65), (2.85, 2.85, 3.25), "rubble", taper_top=(0.68, 0.68), tint=(0.68, 0.64, 0.60), bevel=0.03)
    # Iron reinforcing bands around the blast furnace shaft
    for bz in (2.2, 3.6, 5.2, 6.6):
        w = 3.6 - (bz - 2.0) * 0.34
        mb.add_box((fx, fy, bz), (w, w, 0.16), "beam", metal=0.92, tint=(0.28, 0.28, 0.30))
    # Glowing orange-amber tapping hearth arch on front (-Y) of the furnace!
    mb.add_box((fx, fy - 1.82, 1.25), (1.35, 0.35, 1.45), "ashlar", tint=(0.55, 0.52, 0.48))
    mb.add_box((fx, fy - 1.72, 1.15), (0.88, 0.28, 1.05), "linen", tint=(1.0, 0.48, 0.14))

    # Open Timber Casting Canopy & Twin Giant Leather Bellows on East side (+X)
    mb.add_box((1.95, 0.55, 3.35), (3.45, 4.15, 0.18), "shingles", rot_euler=(0.0, 0.22, 0.0), tint=(0.62, 0.58, 0.54))
    for px in (1.1, 3.35):
        for py in (-1.2, 2.3):
            mb.add_box((px, py, 1.75), (0.20, 0.20, 2.85), "beam", tint=(0.72, 0.66, 0.58))
    if lod <= 1:
        for by_o in (-0.1, 1.2):
            mb.add_box((1.95, by_o, 1.15), (1.85, 0.92, 0.65), "linen", taper_top=(0.45, 0.85), tint=(0.68, 0.50, 0.34), bevel=0.02)

    # Front Yard Bins: Black Charcoal Heap (-X, -Y) & Rust-Red Iron Ore Bin (+X, -Y)
    mb.add_box((-2.35, -2.25, 0.68), (2.15, 1.75, 0.72), "rubble", taper_top=(0.52, 0.52), tint=(0.20, 0.19, 0.19), bevel=0.04)
    mb.add_box((2.15, -2.25, 0.68), (2.15, 1.75, 0.72), "rubble", taper_top=(0.52, 0.52), tint=(0.76, 0.34, 0.22), bevel=0.04)


# ==============================================================================
# 14. ARMOURER L1 (Stone-and-oak guildhall, forge chimney & gleaming steel armour rack!)
# ==============================================================================
def build_armourer_l1(mb, lod):
    """Fortified stone-and-timber armourer's workshop with blue heraldic awning & steel plate/mail display stands."""
    mb.add_box((0.0, 0.0, 0.08), (8.4, 7.6, 0.90), "cobble", tint=(0.90, 0.88, 0.85), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.5, 0.6, 2.3), (5.8, 4.4, 3.8), "ashlar")
        return

    # Dressed Stone & Timber Guildhall Body (centered at (-0.45, 0.65))
    cx, cy = -0.45, 0.65
    hx, hy = 2.75, 2.15
    mb.add_box((cx, cy, 1.95), (hx * 2.0, hy * 2.0, 3.05), "ashlar", tint=(0.92, 0.90, 0.86), bevel=0.03)
    add_pitched_roof_360(mb, cx, cy, hx + 0.12, hy + 0.12, 3.42, 5.65, "shingles", "ashlar", overhang=0.42, roof_tint=(0.48, 0.52, 0.58), gable_tint=(0.92, 0.90, 0.86), lod=lod)

    # Tall Stepped Stone Forge Chimney on East wall (`smoke_0` at (2.65, 0.65, 6.85))
    mb.add_box((2.65, 0.65, 3.55), (1.35, 1.45, 6.25), "rubble", taper_top=(0.72, 0.72), tint=(0.82, 0.79, 0.75), bevel=0.03)

    # Royal Cobalt-Blue Front Canopy & Gleaming Steel Armour Display Stands (-Y front yard!)
    mb.add_box((cx, -2.05, 2.55), (5.2, 1.55, 0.12), "linen", rot_euler=(0.25, 0.0, 0.0), tint=(0.20, 0.36, 0.68))
    if lod <= 1:
        add_oak_door(mb, cx - 1.1, cy - hy - 0.04, 0.42, w=1.12, h=2.02)
        # 3 Steel Armour Mannequin Stands (cuirass + pauldrons + helm with metal=0.95!)
        for ax_o in (0.2, 1.15, 2.1):
            px, py = cx + ax_o, -2.15
            mb.add_cylinder((px, py, 0.42), (px, py, 1.75), 0.08, 0.08, 6, "beam")
            mb.add_box((px, py, 1.32), (0.58, 0.36, 0.68), "beam", metal=0.95, tint=(0.86, 0.90, 0.96), bevel=0.02)
            mb.add_box((px, py, 1.85), (0.32, 0.34, 0.34), "beam", metal=0.95, tint=(0.90, 0.93, 0.98), bevel=0.02)
        # Heavy steel-horned anvil on front-west cobble apron
        mb.add_box((-2.45, -2.25, 0.72), (0.85, 0.42, 0.58), "beam", metal=0.95, tint=(0.45, 0.48, 0.52))


# ==============================================================================
# 15. FLETCHER L1 (Bowyer's timber shop, yew bow racks & circular archery target butt!)
# ==============================================================================
def build_fletcher_l1(mb, lod):
    """Bowyer & fletcher's timber workshop with yew bow-stave racks, arrow casks & straw archery target butt."""
    mb.add_box((0.0, 0.0, 0.06), (7.8, 7.0, 0.80), "cobble", tint=(0.89, 0.86, 0.82), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.9, 0.6, 2.0), (4.8, 3.8, 3.2), "boards")
        return

    # Timber Bowyer's Workshop on West side (-X, +Y)
    cx, cy = -0.95, 0.65
    hx, hy = 2.25, 1.85
    mb.add_box((cx, cy, 1.72), (hx * 2.0, hy * 2.0, 2.55), "plaster", tint=(0.96, 0.93, 0.86), bevel=0.02)
    add_half_timber_360(mb, cx, cy, hx, hy, 0.42, 2.98, lod, bays_x=2, bays_y=2)
    add_pitched_roof_360(mb, cx, cy, hx + 0.12, hy + 0.12, 2.95, 4.75, "thatch", "plaster", overhang=0.42, roof_tint=(0.86, 0.78, 0.58), gable_tint=(0.96, 0.93, 0.86), lod=lod)

    # Signature Straw Archery Target Butt on East Range (+X) with concentric Red/Blue/Gold target face!
    tx, ty = 2.35, 0.85
    mb.add_beam((tx - 0.65, ty + 0.45, 0.35), (tx, ty + 0.05, 2.25), 0.12, 0.12, "beam")
    mb.add_beam((tx + 0.65, ty + 0.45, 0.35), (tx, ty + 0.05, 2.25), 0.12, 0.12, "beam")
    # Outer straw target disc, blue ring, and crimson bullseye facing front (-Y)!
    mb.add_cylinder((tx, ty - 0.12, 1.45), (tx, ty + 0.14, 1.45), 0.92, 0.92, 12, "thatch", tint=(0.96, 0.88, 0.62))
    mb.add_cylinder((tx, ty - 0.16, 1.45), (tx, ty - 0.11, 1.45), 0.62, 0.62, 12, "linen", tint=(0.20, 0.38, 0.72))
    mb.add_cylinder((tx, ty - 0.19, 1.45), (tx, ty - 0.15, 1.45), 0.32, 0.32, 10, "linen", tint=(0.82, 0.18, 0.18))

    if lod <= 1:
        add_oak_door(mb, cx, cy - hy - 0.04, 0.42, w=0.98, h=1.88)
        # Front yew bow-stave rack & barrel of fletched arrows
        mb.add_box((cx + 1.35, -1.75, 1.15), (1.45, 0.45, 1.35), "beam", tint=(0.82, 0.64, 0.42))
        mb.add_cylinder((2.35, -2.15, 0.42), (2.35, -2.15, 1.15), 0.36, 0.34, 8, "boards")


# ==============================================================================
# 16. STABLE L1 (Long 3-stall cavalry stable barn, hayloft dormer & fenced paddock!)
# ==============================================================================
def build_stable_l1(mb, lod):
    """Long 3-bay timber cavalry stable with projecting upper hayloft dormer, fenced horse corral & trough."""
    mb.add_box((0.0, 0.0, 0.08), (9.8, 8.6, 0.85), "dirt", tint=(0.68, 0.58, 0.46), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 1.3, 2.2), (8.2, 4.2, 3.8), "boards")
        return

    # Long 3-Stall Timber Stable Barn across Rear (+Y)
    cx, cy = 0.0, 1.35
    hx, hy = 3.95, 2.05
    mb.add_box((cx, cy, 1.85), (hx * 2.0, hy * 2.0, 2.85), "boards", tint=(0.78, 0.68, 0.56), bevel=0.02)
    add_half_timber_360(mb, cx, cy, hx, hy, 0.42, 3.25, lod, bays_x=4, bays_y=2)
    add_pitched_roof_360(mb, cx, cy, hx + 0.15, hy + 0.15, 3.22, 5.45, "shingles", "boards", overhang=0.45, roof_tint=(0.74, 0.58, 0.44), gable_tint=(0.78, 0.68, 0.56), lod=lod)

    # Projecting Central Hayloft Loading Dormer & Hoist Beam on Front Roof Slope (-Y)
    mb.add_box((0.0, cy - 1.35, 4.35), (2.15, 1.85, 1.65), "boards", tint=(0.82, 0.72, 0.60))
    mb.add_box((0.0, cy - 1.35, 5.32), (2.45, 2.15, 0.16), "shingles", tint=(0.74, 0.58, 0.44))
    mb.add_box((0.0, cy - 2.35, 5.05), (0.18, 0.95, 0.18), "beam", tint=(0.76, 0.70, 0.62))

    # Fenced Horse Paddock / Corral across Front Yard (-Y: y from -0.8 to -3.8)
    for px in (-3.8, -1.9, 0.0, 1.9, 3.8):
        mb.add_box((px, -3.75, 0.92), (0.18, 0.18, 1.15), "beam", tint=(0.76, 0.68, 0.58))
    for py in (-2.3, -1.0):
        for sx in (-3.8, 3.8):
            mb.add_box((sx, py, 0.92), (0.18, 0.18, 1.15), "beam", tint=(0.76, 0.68, 0.58))
    for z_rail in (0.72, 1.18):
        mb.add_box((-1.9, -3.75, z_rail), (3.8, 0.10, 0.12), "beam", tint=(0.80, 0.72, 0.62))
        mb.add_box((2.85, -3.75, z_rail), (1.9, 0.10, 0.12), "beam", tint=(0.80, 0.72, 0.62))
        for sx in (-3.8, 3.8):
            mb.add_box((sx, -2.25, z_rail), (0.10, 3.0, 0.12), "beam", tint=(0.80, 0.72, 0.62))

    if lod <= 1:
        # 3 Stall Doors along front wall + Golden Hay Bales & Water Trough
        for dx in (-2.35, 0.0, 2.35):
            add_oak_door(mb, dx, cy - hy - 0.04, 0.42, w=1.18, h=1.98)
        mb.add_box((-2.55, -2.25, 0.65), (2.15, 0.68, 0.48), "beam", tint=(0.70, 0.62, 0.52))
        mb.add_box((2.45, -2.15, 0.72), (1.55, 1.25, 0.68), "thatch", tint=(0.98, 0.88, 0.54), bevel=0.03)


# ==============================================================================
# 17. GUN FOUNDRY L1 (Royal cannon foundry hall, domed furnace & cast bronze cannon!)
# ==============================================================================
def build_gun_foundry_l1(mb, lod):
    """Monumental stone cannon foundry with domed bronze-melting furnace, gantry crane & cast bronze cannon."""
    mb.add_box((0.0, 0.0, 0.10), (10.4, 9.4, 0.95), "cobble", tint=(0.84, 0.82, 0.78), bevel=0.03)
    if lod == 3:
        mb.add_box((-1.1, 0.8, 2.6), (6.8, 5.2, 4.4), "ashlar")
        mb.add_box((2.8, 1.0, 3.8), (3.4, 3.4, 7.2), "rubble")
        return

    # Heavy Dressed-Stone Royal Foundry Hall (-X, +Y)
    cx, cy = -1.15, 0.85
    hx, hy = 3.25, 2.45
    mb.add_box((cx, cy, 2.25), (hx * 2.0, hy * 2.0, 3.65), "ashlar", tint=(0.88, 0.85, 0.81), bevel=0.03)
    add_pitched_roof_360(mb, cx, cy, hx + 0.15, hy + 0.15, 4.02, 6.45, "shingles", "ashlar", overhang=0.45, roof_tint=(0.46, 0.44, 0.44), gable_tint=(0.88, 0.85, 0.81), lod=lod)

    # Massive Circular Domed Reverberatory Bronze-Melting Furnace & Tall Chimney on East Flank (+X, `smoke_0` at (2.85, 0.95, 8.35))
    fx, fy = 2.85, 0.95
    mb.add_cylinder((fx, fy, 0.45), (fx, fy, 3.85), 1.85, 1.65, 12, "rubble", tint=(0.76, 0.56, 0.46))
    mb.add_cylinder((fx, fy, 3.85), (fx, fy, 8.25), 0.95, 0.68, 10, "rubble", tint=(0.68, 0.50, 0.42))
    # Glowing bronze casting tap hole on front of furnace
    mb.add_box((fx, fy - 1.72, 1.25), (0.85, 0.32, 0.95), "linen", tint=(1.0, 0.55, 0.16))

    # Front Yard Timber Gantry Crane & Freshly Cast Gleaming Bronze Cannon Barrel (-Y)!
    gx, gy = 0.45, -2.55
    for sx in (-1.65, 1.65):
        mb.add_beam((gx + sx, gy - 0.85, 0.45), (gx + sx, gy, 3.85), 0.20, 0.20, "beam")
        mb.add_beam((gx + sx, gy + 0.85, 0.45), (gx + sx, gy, 3.85), 0.20, 0.20, "beam")
    mb.add_box((gx, gy, 3.92), (3.85, 0.28, 0.28), "beam", tint=(0.78, 0.72, 0.64))
    # Gleaming cast-bronze siege cannon barrel resting on oak cradle blocks under the gantry!
    mb.add_cylinder((gx - 1.45, gy, 1.45), (gx + 1.45, gy, 1.62), 0.42, 0.28, 12, "beam", metal=0.95, tint=(0.85, 0.66, 0.34))
    mb.add_box((gx - 0.8, gy, 0.85), (0.45, 0.95, 0.72), "beam")
    mb.add_box((gx + 0.8, gy, 0.85), (0.45, 0.95, 0.72), "beam")

    if lod <= 1:
        # Wide arched foundry double portal on front wall (-Y) + pyramid of iron cannonballs
        add_oak_door(mb, cx, cy - hy - 0.04, 0.45, w=1.85, h=2.55)
        for bx_o in (-3.2, -2.7, -2.95):
            bz_o = 0.92 if bx_o == -2.95 else 0.62
            mb.add_box((bx_o, -2.45, bz_o), (0.42, 0.42, 0.42), "beam", metal=0.95, tint=(0.30, 0.32, 0.35), bevel=0.12)


def render_buildings_s6_preview():
    """Renders a 17-building Cycles daylight contact-sheet showcase of all new Stage 6.3 distinct models."""
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 18
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92

    world = bpy.data.worlds.new("BldWorldS6")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.48, 0.62, 0.80, 1.0)
    bg.inputs["Strength"].default_value = 0.95

    bpy.ops.mesh.primitive_plane_add(size=180.0, location=(0.0, 0.0, 0.0))
    gnd = bpy.context.active_object
    gm = bpy.data.materials.new("GroundMatS6")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.24, 0.30, 0.16, 1.0)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    gnd.data.materials.append(gm)

    mat = bpy.data.materials.new("PreviewBldMatS6")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.80
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])

    lineup = [
        # Front row (closest to camera: Quarry, Iron Mine, Sawmill, Smelter, Gun Foundry, Vineyard)
        ("quarry_l1", -20.0, -12.0, math.radians(-14.0)),
        ("iron_mine_l1", -12.0, -12.0, math.radians(-8.0)),
        ("sawmill_l1", -4.0, -12.0, math.radians(6.0)),
        ("smelter_l1", 4.0, -12.0, math.radians(12.0)),
        ("gun_foundry_l1", 12.5, -12.0, math.radians(16.0)),
        ("vineyard_l1", 21.0, -12.0, math.radians(20.0)),
        # Middle row (Tavern, Brewery, Pig Farm, Butcher, Winery, Tannery)
        ("tavern_l1", -20.0, 0.0, math.radians(-16.0)),
        ("brewery_l1", -12.0, 0.0, math.radians(-10.0)),
        ("pig_farm_l1", -4.0, 0.0, math.radians(0.0)),
        ("butcher_l1", 4.0, 0.0, math.radians(10.0)),
        ("winery_l1", 12.0, 0.0, math.radians(14.0)),
        ("tannery_l1", 20.0, 0.0, math.radians(18.0)),
        # Back row (Forester, Hunter, Armourer, Fletcher, Stable)
        ("forester_l1", -16.0, 12.0, math.radians(-12.0)),
        ("hunter_l1", -8.0, 12.0, math.radians(-6.0)),
        ("armourer_l1", 0.0, 12.0, math.radians(4.0)),
        ("fletcher_l1", 8.0, 12.0, math.radians(12.0)),
        ("stable_l1", 17.0, 12.0, math.radians(16.0)),
    ]
    for name, px, py, yaw in lineup:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(RAW_OUT, f"{name}_lod0.glb"))
        added = [o for o in bpy.data.objects if o not in before]
        for o in added:
            if o.parent is None:
                o.location = (px, py, 0.0)
                o.rotation_euler = (0.0, 0.0, yaw)
            if o.type == "MESH":
                o.data.materials.clear()
                o.data.materials.append(mat)

    sun_d = bpy.data.lights.new("Sun", type="SUN")
    sun_d.energy = 4.6
    sun_d.color = (1.0, 0.94, 0.84)
    sun_o = bpy.data.objects.new("Sun", sun_d)
    bpy.context.collection.objects.link(sun_o)
    sun_o.rotation_euler = (math.radians(48), math.radians(12), math.radians(-38))

    cam_d = bpy.data.cameras.new("Cam")
    cam_d.lens = 30.0
    cam_o = bpy.data.objects.new("Cam", cam_d)
    bpy.context.collection.objects.link(cam_o)
    scene.camera = cam_o
    cam_o.location = (0.0, -34.0, 21.0)
    direction = Vector((0.0, -1.5, 1.8)) - cam_o.location
    cam_o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = PREVIEW_JPG
    bpy.ops.render.render(write_still=True)
    print(f"Saved Cycles Stage 6.3 buildings showcase: {PREVIEW_JPG}")


def main():
    summary = {}
    summary["quarry_l1"] = export_and_optimize("quarry_l1", build_quarry_l1)
    summary["iron_mine_l1"] = export_and_optimize("iron_mine_l1", build_iron_mine_l1)
    summary["sawmill_l1"] = export_and_optimize("sawmill_l1", build_sawmill_l1)
    summary["forester_l1"] = export_and_optimize("forester_l1", build_forester_l1)
    summary["hunter_l1"] = export_and_optimize("hunter_l1", build_hunter_l1)
    summary["tavern_l1"] = export_and_optimize("tavern_l1", build_tavern_l1, has_smoke_at=(2.6, 1.6, 7.65))
    summary["brewery_l1"] = export_and_optimize("brewery_l1", build_brewery_l1, has_smoke_at=(2.15, 0.75, 8.15))
    summary["pig_farm_l1"] = export_and_optimize("pig_farm_l1", build_pig_farm_l1)
    summary["butcher_l1"] = export_and_optimize("butcher_l1", build_butcher_l1, has_smoke_at=(2.45, 0.85, 5.25))
    summary["vineyard_l1"] = export_and_optimize("vineyard_l1", build_vineyard_l1)
    summary["winery_l1"] = export_and_optimize("winery_l1", build_winery_l1)
    summary["tannery_l1"] = export_and_optimize("tannery_l1", build_tannery_l1)
    summary["smelter_l1"] = export_and_optimize("smelter_l1", build_smelter_l1, has_smoke_at=(-0.85, 0.55, 7.65))
    summary["armourer_l1"] = export_and_optimize("armourer_l1", build_armourer_l1, has_smoke_at=(2.65, 0.65, 6.85))
    summary["fletcher_l1"] = export_and_optimize("fletcher_l1", build_fletcher_l1)
    summary["stable_l1"] = export_and_optimize("stable_l1", build_stable_l1)
    summary["gun_foundry_l1"] = export_and_optimize("gun_foundry_l1", build_gun_foundry_l1, has_smoke_at=(2.85, 0.95, 8.35))

    render_buildings_s6_preview()
    print("[build_buildings_s6] ALL 17 NEW BUILDINGS DONE:\n", json.dumps(summary, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
