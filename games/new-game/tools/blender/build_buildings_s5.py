"""
Stage 5 Architectural Overhaul & Campaign Landmark Kit (Blender 5.0, CC0 original):
  Zero embedded textures — every building uses `MeshBuilder` + Blender Cycles CPU vertex AO
  from `build_house.py` reading our shared 12-layer 1024^2 KTX2 surface array (`UV0` world-scale
  box UVs, `UV1` layer/iron mask, `COLOR_0` Cycles AO + organic weathering).

Upgrades 5 Stage 4 buildings to 360-degree museum craftsmanship:
  - keep_l1, farm_l1, windmill_l1 (weathered timber gables + louvers + millstones!),
    bakery_l1 (full 360-degree half-timbering + braces + windows!), watchtower_l1

Authors 10 new Stage 5 Village & Campaign buildings (each with lod0, lod1, lod2, shadow):
  1. chapel_l1       — Stone & timber medieval chapel with buttresses, lancet windows & belfry spire
  2. smithy_l1       — Open-timber forge, stone hearth & tall chimney (`smoke_0`), anvil & bellows
  3. barracks_l1     — Military garrison hall with covered arms porch, shield rack & heraldic banners
  4. market_l1       — Open oak-arcade trading hall with shingle roof, stalls & dyed linen awnings
  5. well_l1         — Dressed fieldstone village well with timber windlass & shingle roof hood
  6. storehouse_l1   — Raised half-timber granary/storehouse with gable hoist beam & loading bay
  7. fisher_l1       — Waterside plank fisherman's hut on pilings, thatch roof, net rack & skiff
  8. camp_tent_l1    — Feudal war-camp ridged pavilion tent with scalloped valance & guy stakes
  9. ruin_house      — Broken stone & charred-beam cottage ruin (Mission 4 rebuildable ruins)
  10. fortress_donzon — Monumental 19 m Mission 5 citadel keep with 4 corner turrets, machicolations,
                        stepped ashlar portal, lancet windows & `smoke_0` chimney!

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_buildings_s5.py
"""

import json
import math
import os
import random
import subprocess
import sys
import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from build_house import (  # noqa: E402
    MeshBuilder,
    bake_cycles_vertex_ao,
    clear_scene,
)
from build_buildings_s4 import (  # noqa: E402
    add_oak_door,
    add_pyramidal_cap,
    add_window,
    build_windmill_sails,
)

REPO_ROOT = "/home/antigravity/anbow1/mediveal-village"
GAME_ROOT = os.path.join(REPO_ROOT, "games/new-game")
RAW_OUT = "/tmp/stage5-buildings/raw_glb"
FINAL_OUT = os.path.join(GAME_ROOT, "public/assets/buildings")
OPTIMIZE_SCRIPT = os.path.join(GAME_ROOT, "tools/blender/optimize_glb.mjs")
PREVIEW_JPG = "/tmp/stage5-buildings/buildings_s5_preview.jpg"

os.makedirs(RAW_OUT, exist_ok=True)
os.makedirs(FINAL_OUT, exist_ok=True)


# ==================== SHARED 360-DEGREE ARCHITECTURAL HELPERS ====================
def add_pitched_roof_360(
    mb, cx, cy, half_x, half_y, z_eave, z_ridge,
    roof_layer="shingles", gable_layer="plaster",
    overhang=0.42, thickness=0.18,
    roof_tint=(0.93, 0.91, 0.88), gable_tint=(0.98, 0.96, 0.91),
    lod=0, ridge_axis="x",
):
    """Pitched 2-slope roof with crisp bargeboards, eave rafter tails, gable framing & louvers."""
    if ridge_axis == "x":
        span_y = half_y + overhang
        span_x = half_x + overhang
        rise = z_ridge - z_eave
        slope_len = math.hypot(span_y, rise)
        pitch = math.atan2(rise, span_y)
        # Front (-Y) & Back (+Y) roof slopes
        mb.add_box((cx, cy - span_y * 0.5, z_eave + rise * 0.5 + thickness * 0.35), (span_x * 2.0, slope_len, thickness), roof_layer, rot_euler=(pitch, 0.0, 0.0), tint=roof_tint, bevel=0.02)
        mb.add_box((cx, cy + span_y * 0.5, z_eave + rise * 0.5 + thickness * 0.35), (span_x * 2.0, slope_len, thickness), roof_layer, rot_euler=(-pitch, 0.0, 0.0), tint=roof_tint, bevel=0.02)
        # Ridge timber cap
        mb.add_box((cx, cy, z_ridge + thickness * 0.55), (span_x * 2.0 + 0.08, 0.24, 0.18), "beam", tint=(0.80, 0.76, 0.70), bevel=0.02)
        # Closed gables at -half_x and +half_x using the building's true gable material!
        mb.add_gable_prism(half_x, half_y, z_eave, z_ridge, gable_layer, tint=gable_tint) if (cx == 0.0 and cy == 0.0) else (
            mb.add_box((cx - half_x + 0.14, cy, z_eave + rise * 0.48), (0.30, half_y * 2.02, rise * 0.98), gable_layer, taper_top=(1.0, 0.04), tint=gable_tint),
            mb.add_box((cx + half_x - 0.14, cy, z_eave + rise * 0.48), (0.30, half_y * 2.02, rise * 0.98), gable_layer, taper_top=(1.0, 0.04), tint=gable_tint),
        )
        if lod <= 1:
            # Projecting bargeboards & gable king-post timbering at both gable ends
            for sx in (-1.0, 1.0):
                gx = cx + sx * (half_x + 0.04)
                bx = cx + sx * (span_x - 0.04)
                mb.add_beam((bx, cy - span_y, z_eave - 0.04), (bx, cy, z_ridge + 0.08), 0.10, 0.18, "beam", tint=(0.78, 0.73, 0.67))
                mb.add_beam((bx, cy + span_y, z_eave - 0.04), (bx, cy, z_ridge + 0.08), 0.10, 0.18, "beam", tint=(0.78, 0.73, 0.67))
                # Gable king-post & collar tie
                mb.add_beam((gx, cy, z_eave), (gx, cy, z_ridge - 0.10), 0.15, 0.15, "beam", tint=(0.80, 0.75, 0.69))
                mb.add_beam((gx, cy - half_y * 0.55, z_eave + rise * 0.45), (gx, cy + half_y * 0.55, z_eave + rise * 0.45), 0.13, 0.14, "beam", tint=(0.80, 0.75, 0.69))
                # Small recessed dark attic louver vent
                if lod == 0:
                    mb.add_box((gx + sx * 0.04, cy, z_eave + rise * 0.56), (0.08, 0.44, 0.52), "beam", tint=(0.24, 0.20, 0.17))
            # Projecting oak eave rafter tails (LOD0)
            if lod == 0:
                n_raf = max(4, int(half_x * 2.2))
                for i in range(n_raf):
                    rx = cx - half_x + (i + 0.5) * (half_x * 2.0 / n_raf)
                    for sy in (-1.0, 1.0):
                        mb.add_box((rx, cy + sy * (half_y + overhang * 0.48), z_eave - 0.06), (0.10, overhang * 0.95, 0.11), "beam", tint=(0.76, 0.71, 0.65))
    else:
        # Ridge along Y axis
        span_x = half_x + overhang
        span_y = half_y + overhang
        rise = z_ridge - z_eave
        slope_len = math.hypot(span_x, rise)
        pitch = math.atan2(rise, span_x)
        mb.add_box((cx - span_x * 0.5, cy, z_eave + rise * 0.5 + thickness * 0.35), (slope_len, span_y * 2.0, thickness), roof_layer, rot_euler=(0.0, -pitch, 0.0), tint=roof_tint, bevel=0.02)
        mb.add_box((cx + span_x * 0.5, cy, z_eave + rise * 0.5 + thickness * 0.35), (slope_len, span_y * 2.0, thickness), roof_layer, rot_euler=(0.0, pitch, 0.0), tint=roof_tint, bevel=0.02)
        mb.add_box((cx, cy, z_ridge + thickness * 0.55), (0.24, span_y * 2.0 + 0.08, 0.18), "beam", tint=(0.80, 0.76, 0.70), bevel=0.02)
        for sy in (-1.0, 1.0):
            mb.add_box((cx, cy + sy * (half_y - 0.14), z_eave + rise * 0.48), (half_x * 2.02, 0.30, rise * 0.98), gable_layer, taper_top=(0.04, 1.0), tint=gable_tint)
            if lod <= 1:
                by = cy + sy * (span_y - 0.04)
                gy = cy + sy * (half_y + 0.04)
                mb.add_beam((cx - span_x, by, z_eave - 0.04), (cx, by, z_ridge + 0.08), 0.18, 0.10, "beam", tint=(0.78, 0.73, 0.67))
                mb.add_beam((cx + span_x, by, z_eave - 0.04), (cx, by, z_ridge + 0.08), 0.18, 0.10, "beam", tint=(0.78, 0.73, 0.67))
                mb.add_beam((cx, gy, z_eave), (cx, gy, z_ridge - 0.10), 0.15, 0.15, "beam", tint=(0.80, 0.75, 0.69))
                mb.add_beam((cx - half_x * 0.55, gy, z_eave + rise * 0.45), (cx + half_x * 0.55, gy, z_eave + rise * 0.45), 0.14, 0.13, "beam", tint=(0.80, 0.75, 0.69))


def add_half_timber_360(mb, cx, cy, half_x, half_y, z0, z1, lod, bays_x=3, bays_y=2, skip_sides=()):
    """Wraps all four walls in genuine projecting medieval oak posts, wall-plates & diagonal wind-braces."""
    if lod >= 2:
        return
    h = z1 - z0
    zm = (z0 + z1) * 0.5
    tint = (0.80, 0.75, 0.69)

    # Front (-Y) and Back (+Y) walls
    for side, sy in [("front", -1.0), ("back", 1.0)]:
        if side in skip_sides:
            continue
        wy = cy + sy * (half_y + 0.04)
        mb.add_box((cx, wy, z0 + 0.08), (half_x * 2.0 + 0.22, 0.18, 0.18), "beam", tint=tint)
        mb.add_box((cx, wy, z1 - 0.06), (half_x * 2.0 + 0.22, 0.18, 0.18), "beam", tint=tint)
        if lod == 0:
            mb.add_box((cx, wy, z0 + h * 0.44), (half_x * 2.0 + 0.16, 0.14, 0.13), "beam", tint=tint)
        for i in range(bays_x + 1):
            px = cx - half_x + i * (half_x * 2.0 / bays_x)
            mb.add_box((px, wy, zm), (0.18, 0.18, h + 0.04), "beam", tint=tint)
        # Corner diagonal wind-braces
        dx = half_x * 2.0 / bays_x
        mb.add_beam((cx - half_x, wy, z0 + 0.15), (cx - half_x + dx * 0.88, wy, z1 - 0.10), 0.13, 0.13, "beam", tint=tint)
        mb.add_beam((cx + half_x, wy, z0 + 0.15), (cx + half_x - dx * 0.88, wy, z1 - 0.10), 0.13, 0.13, "beam", tint=tint)

    # West (-X) and East (+X) walls
    for side, sx in [("west", -1.0), ("east", 1.0)]:
        if side in skip_sides:
            continue
        wx = cx + sx * (half_x + 0.04)
        mb.add_box((wx, cy, z0 + 0.08), (0.18, half_y * 2.0 + 0.22, 0.18), "beam", tint=tint)
        mb.add_box((wx, cy, z1 - 0.06), (0.18, half_y * 2.0 + 0.22, 0.18), "beam", tint=tint)
        if lod == 0:
            mb.add_box((wx, cy, z0 + h * 0.44), (0.14, half_y * 2.0 + 0.16, 0.13), "beam", tint=tint)
        for i in range(bays_y + 1):
            py = cy - half_y + i * (half_y * 2.0 / bays_y)
            mb.add_box((wx, py, zm), (0.18, 0.18, h + 0.04), "beam", tint=tint)
        dy = half_y * 2.0 / bays_y
        mb.add_beam((wx, cy - half_y, z0 + 0.15), (wx, cy - half_y + dy * 0.88, z1 - 0.10), 0.13, 0.13, "beam", tint=tint)
        mb.add_beam((wx, cy + half_y, z0 + 0.15), (wx, cy + half_y - dy * 0.88, z1 - 0.10), 0.13, 0.13, "beam", tint=tint)


def add_lancet_window(mb, cx, cy, cz, yaw_rad=0.0, w=0.62, h=1.45):
    """Adds a recessed medieval stone Gothic lancet window with dressed ashlar surround."""
    ca, sa = math.cos(yaw_rad), math.sin(yaw_rad)
    def xf(lx, ly, lz):
        return (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, cz + lz)
    # Dark interior recess
    mb.add_box(xf(0, -0.02, 0), (w, 0.14, h), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.18, 0.16, 0.15))
    # Ashlar sill, jambs, and pointed arch hood
    mb.add_box(xf(0, -0.08, -h * 0.5 - 0.06), (w + 0.34, 0.24, 0.14), "ashlar", rot_euler=(0, 0, yaw_rad), tint=(0.96, 0.93, 0.88))
    for sx in (-w * 0.5 - 0.10, w * 0.5 + 0.10):
        mb.add_box(xf(sx, -0.06, 0), (0.18, 0.20, h + 0.10), "ashlar", rot_euler=(0, 0, yaw_rad), tint=(0.95, 0.92, 0.87))
    mb.add_box(xf(0, -0.07, h * 0.5 + 0.14), (w + 0.36, 0.22, 0.30), "ashlar", rot_euler=(0, 0, yaw_rad), taper_top=(0.22, 1.0), tint=(0.96, 0.93, 0.88))


def add_banner(mb, cx, cy, z_top, yaw_rad=0.0, length=2.2, width=0.88, tint=(0.15, 0.28, 0.56)):
    """Adds a hanging Marchland cloth banner on an iron wall bracket."""
    ca, sa = math.cos(yaw_rad), math.sin(yaw_rad)
    def xf(lx, ly, lz):
        return (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, z_top + lz)
    mb.add_box(xf(0, -0.22, 0.0), (width + 0.18, 0.06, 0.06), "beam", rot_euler=(0, 0, yaw_rad), metal=0.9, tint=(0.30, 0.30, 0.32))
    mb.add_box(xf(0, -0.24, -length * 0.5), (width, 0.04, length), "linen", rot_euler=(0, 0, yaw_rad), tint=tint)
    # Warm ochre heraldic border stripe
    mb.add_box(xf(0, -0.25, -length * 0.72), (width + 0.01, 0.05, 0.16), "linen", rot_euler=(0, 0, yaw_rad), tint=(0.86, 0.74, 0.44))


def export_and_optimize(name, build_fn, has_smoke_at=None, extra_children_fn=None):
    """Exports lod0, lod1, lod2, shadow, runs Cycles AO, and Meshopt-optimizes into public/assets/buildings."""
    summary = {}
    env = {**os.environ, "KTX2_TOOLS": "/tmp/ktx2-tools/node_modules"}
    for lod, suffix in [(0, "lod0"), (1, "lod1"), (2, "lod2"), (3, "shadow")]:
        clear_scene()
        objs = []
        mb = MeshBuilder()
        build_fn(mb, lod)
        main_obj = mb.finalize_object(f"{name}_{suffix}")
        if lod < 3:
            bake_cycles_vertex_ao(main_obj, samples=14 if lod == 0 else 8)
        objs.append(main_obj)

        if extra_children_fn is not None and lod < 3:
            for child_obj in extra_children_fn(lod):
                bake_cycles_vertex_ao(child_obj, samples=10 if lod == 0 else 6)
                child_obj.parent = main_obj
                objs.append(child_obj)

        if has_smoke_at is not None and lod == 0:
            smoke = bpy.data.objects.new("smoke_0", None)
            smoke.location = has_smoke_at
            bpy.context.collection.objects.link(smoke)
            smoke.parent = main_obj
            objs.append(smoke)

        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = main_obj

        raw_path = os.path.join(RAW_OUT, f"{name}_{suffix}.glb")
        bpy.ops.export_scene.gltf(
            filepath=raw_path,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=False,
            export_texcoords=True,
            export_normals=True,
            export_attributes=True,
            export_vertex_color="ACTIVE" if lod < 3 else "NONE",
            export_materials="EXPORT",
            export_draco_mesh_compression_enable=False,
        )
        final_path = os.path.join(FINAL_OUT, f"{name}_{suffix}.glb")
        subprocess.run(["node", OPTIMIZE_SCRIPT, raw_path, final_path], check=True, env=env)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")
        summary[suffix] = {"tris": tris, "kb": round(os.path.getsize(final_path) / 1024.0, 1)}
        print(f"  [{name}] {suffix}: {tris} tris -> {summary[suffix]['kb']} KiB")
    return summary


# ==============================================================================
# UPGRADED STAGE 4 BUILDINGS (360-DEGREE CRAFTSMANSHIP!)
# ==============================================================================

def build_bakery_l1_v2(mb, lod):
    """360-degree half-timbered medieval bakery with domed stone bread oven, wood stack & awnings."""
    mb.add_box((0.0, 0.0, 0.08), (7.6, 5.2, 1.10), "rubble", tint=(0.91, 0.88, 0.84), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.6, 0.0, 2.1), (6.0, 4.6, 3.2), "plaster")
        mb.add_box((-0.6, 0.0, 4.6), (6.4, 5.0, 2.2), "shingles", taper_top=(1.0, 0.15))
        mb.add_box((3.0, 0.2, 1.8), (2.2, 2.4, 3.0), "rubble")
        return

    mb.add_box((-0.7, 0.0, 1.82), (5.6, 4.5, 2.55), "plaster", tint=(0.99, 0.96, 0.90), bevel=0.02)
    add_half_timber_360(mb, -0.7, 0.0, 2.80, 2.25, 0.58, 3.08, lod, bays_x=3, bays_y=2)
    add_pitched_roof_360(mb, -0.7, 0.0, 2.84, 2.28, 3.05, 5.22, "shingles", "plaster", overhang=0.42, thickness=0.17, lod=lod)

    if lod <= 1:
        add_oak_door(mb, -2.0, -2.26, 0.58, w=1.08, h=1.98)
        add_window(mb, 0.65, -2.28, 1.95, w=1.18, h=0.95, shutters=(lod == 0))
        # Back (+Y) and West (-X) windows so bakery looks detailed from all 360 degrees!
        add_window(mb, -1.65, 2.28, 1.95, yaw_rad=math.pi, w=0.92, h=0.95, shutters=(lod == 0))
        add_window(mb, 0.65, 2.28, 1.95, yaw_rad=math.pi, w=0.92, h=0.95, shutters=(lod == 0))
        add_window(mb, -3.52, 0.0, 1.95, yaw_rad=-math.pi * 0.5, w=0.88, h=0.92, shutters=(lod == 0))
        # Bread stall counter & slanted shingle awning
        mb.add_box((0.65, -2.75, 0.95), (1.92, 0.76, 0.12), "boards", tint=(0.90, 0.84, 0.74), bevel=0.015)
        for lx in (-0.82, 0.82):
            mb.add_beam((0.65 + lx, -3.02, 0.0), (0.65 + lx, -3.02, 2.38), 0.11, 0.11, "beam")
        mb.add_box((0.65, -2.78, 2.52), (2.25, 1.18, 0.10), "shingles", rot_euler=(0.24, 0.0, 0.0), tint=(0.90, 0.88, 0.84))

    # Projecting domed fieldstone bread oven & baking chimney (+2.75, 0.2)
    mb.add_box((2.75, 0.2, 0.95), (2.15, 2.45, 1.90), "rubble", tint=(0.90, 0.87, 0.82), bevel=0.04)
    mb.add_box((2.75, 0.2, 1.92), (2.26, 2.56, 0.18), "ashlar", tint=(0.95, 0.92, 0.87))
    mb.add_cylinder((2.85, 0.2, 1.95), (2.85, 0.2, 2.78), 1.04, 0.78, 12 if lod == 0 else 8, "rubble", tint=(0.88, 0.84, 0.79))
    mb.add_cylinder((2.85, 0.2, 2.75), (2.85, 0.2, 3.25), 0.78, 0.34, 10 if lod == 0 else 6, "rubble", tint=(0.86, 0.82, 0.77))
    mb.add_box((2.45, 0.2, 3.45), (0.98, 1.02, 5.55), "rubble", taper_top=(0.74, 0.74), tint=(0.84, 0.80, 0.76), bevel=0.03)
    mb.add_box((2.45, 0.2, 6.24), (0.88, 0.92, 0.22), "ashlar", tint=(0.92, 0.88, 0.84))

    if lod == 0:
        # Stacked flour sacks & chopped oven firewood rack along west wall
        for sx, sy in [(2.15, -2.55), (2.68, -2.42)]:
            mb.add_box((sx, sy, 0.38), (0.50, 0.42, 0.68), "linen", taper_top=(0.76, 0.76), tint=(0.95, 0.90, 0.78), bevel=0.07)
        for row in range(3):
            for col in range(3 - row // 2):
                mb.add_cylinder((-3.88, -1.2 + col * 0.30, 0.16 + row * 0.20), (-3.88, -0.3 + col * 0.30, 0.16 + row * 0.20), 0.09, 0.08, 6, "bark", tint=(0.84, 0.78, 0.70))


def build_windmill_body_v2(mb, lod):
    """Authentic European wooden post mill with timber-board gables (NO bare plaster triangle!), louvers & millstones."""
    mb.add_box((0.0, 0.0, 0.45), (4.8, 4.8, 1.95), "rubble", taper_top=(0.82, 0.82), tint=(0.92, 0.89, 0.85), bevel=0.04)
    if lod == 3:
        mb.add_box((0.0, 0.0, 4.8), (3.6, 4.2, 6.8), "boards")
        return

    mb.add_cylinder((0.0, 0.0, 1.2), (0.0, 0.0, 4.4), 0.44, 0.38, 8, "beam", tint=(0.80, 0.75, 0.68))
    for sx in (-1.68, 1.68):
        for sy in (-1.68, 1.68):
            mb.add_beam((sx, sy, 1.28), (0.0, 0.0, 3.88), 0.22, 0.22, "beam", tint=(0.80, 0.75, 0.68))

    # Elevated weathered timber mill-house
    mb.add_box((0.0, 0.15, 5.75), (3.75, 4.35, 4.85), "boards", tint=(0.89, 0.84, 0.76), bevel=0.03)
    add_half_timber_360(mb, 0.0, 0.15, 1.88, 2.18, 3.35, 8.15, lod, bays_x=2, bays_y=2)

    if lod <= 1:
        mb.add_beam((0.0, 2.25, 3.85), (0.0, 5.35, 0.42), 0.17, 0.17, "beam", tint=(0.80, 0.75, 0.68))
        for side_x in (-0.54, 0.54):
            mb.add_beam((side_x, 2.35, 3.75), (side_x, 4.55, 0.0), 0.10, 0.14, "beam", tint=(0.80, 0.75, 0.68))
        add_oak_door(mb, 0.0, 2.34, 3.45, w=0.98, h=1.88, yaw_rad=math.pi)
        if lod == 0:
            for step in range(9):
                t = (step + 0.5) / 9.0
                mb.add_box((0.0, 2.35 + t * 2.2, 3.75 * (1 - t)), (1.08, 0.24, 0.07), "boards", tint=(0.88, 0.83, 0.75))
            add_window(mb, 1.92, 0.15, 6.15, yaw_rad=math.pi * 0.5, w=0.76, h=0.86, shutters=True)
            add_window(mb, -1.92, 0.15, 6.15, yaw_rad=-math.pi * 0.5, w=0.76, h=0.86, shutters=True)
            # Carved stone millstone leaning against stone base + grain sacks!
            mb.add_cylinder((2.45, -1.10, 0.62), (2.22, -0.92, 0.68), 0.62, 0.62, 14, "ashlar", tint=(0.94, 0.91, 0.86))
            for sx, sy in [(-2.25, -1.45), (-2.65, -1.10)]:
                mb.add_box((sx, sy, 0.36), (0.52, 0.44, 0.68), "linen", taper_top=(0.75, 0.75), tint=(0.94, 0.88, 0.76), bevel=0.07)

    # Steep shingled cap roof with WEATHERED TIMBER-BOARD GABLES (fixes Stage 4 plaster triangle!)
    add_pitched_roof_360(mb, 0.0, 0.15, 1.94, 2.24, 8.10, 10.75, "shingles", "boards", overhang=0.38, thickness=0.17, gable_tint=(0.87, 0.82, 0.74), lod=lod)
    mb.add_cylinder((0.0, -1.75, 6.95), (0.0, -2.55, 6.95), 0.28, 0.24, 10, "beam", tint=(0.78, 0.73, 0.66))


def build_farm_l1_v2(mb, lod):
    """360-degree half-timbered medieval barn with hayloft hoist, thatch roof & wooden trough."""
    mb.add_box((0.0, 0.0, 0.08), (8.2, 5.6, 1.10), "rubble", tint=(0.91, 0.88, 0.83), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.0, 1.8), (7.8, 5.2, 2.6), "plaster")
        mb.add_box((0.0, 0.0, 4.3), (8.4, 5.8, 2.6), "thatch", taper_top=(1.0, 0.12))
        return

    mb.add_box((0.0, 0.0, 1.95), (7.8, 5.2, 2.65), "plaster", tint=(0.99, 0.96, 0.91), bevel=0.02)
    add_half_timber_360(mb, 0.0, 0.0, 3.90, 2.60, 0.62, 3.26, lod, bays_x=4, bays_y=2)
    mb.add_gable_prism(3.9, 2.6, 3.25, 5.45, "boards", tint=(0.88, 0.83, 0.75))
    mb.add_thatch_roof(4.35, 3.15, 3.02, 5.58, thickness=0.38, x_segs=10 if lod == 0 else 5, detail=(lod == 0))

    if lod <= 1:
        add_oak_door(mb, -0.78, -2.62, 0.62, w=1.42, h=2.36)
        add_oak_door(mb, 0.78, -2.62, 0.62, w=1.42, h=2.36)
        add_window(mb, -2.85, -2.64, 2.1, w=0.86, h=0.86, shutters=(lod == 0))
        add_window(mb, 2.85, -2.64, 2.1, w=0.86, h=0.86, shutters=(lod == 0))
        add_window(mb, -2.0, 2.64, 2.1, yaw_rad=math.pi, w=0.88, h=0.86, shutters=(lod == 0))
        add_window(mb, 2.0, 2.64, 2.1, yaw_rad=math.pi, w=0.88, h=0.86, shutters=(lod == 0))
        # Gable hayloft hoist beam on west side
        mb.add_beam((-3.6, 0.0, 4.75), (-4.75, 0.0, 4.75), 0.14, 0.16, "beam", tint=(0.80, 0.75, 0.68))
        mb.add_box((-3.94, 0.0, 4.05), (0.14, 1.05, 1.15), "boards", tint=(0.82, 0.76, 0.68))
    if lod == 0:
        for sx, sy, sz in [(2.6, -3.15, 0.36), (3.15, -3.05, 0.36), (2.88, -3.12, 0.86)]:
            mb.add_box((sx, sy, sz), (0.54, 0.44, 0.68), "linen", taper_top=(0.75, 0.75), tint=(0.94, 0.88, 0.74), bevel=0.08)
        # Wooden watering trough on west yard
        mb.add_box((-4.55, -1.65, 0.38), (0.68, 1.85, 0.56), "boards", tint=(0.82, 0.77, 0.68), bevel=0.02)


def build_keep_l1_v2(mb, lod):
    """360-degree Lord's Keep L1 with buttressed stone tower, half-timber Great Hall, banners & lancets."""
    mb.add_box((0.0, 0.0, 0.20), (11.8, 9.6, 1.55), "rubble", taper_top=(0.98, 0.98), tint=(0.92, 0.90, 0.87), bevel=0.03)
    if lod == 3:
        mb.add_box((-2.8, -0.4, 4.6), (4.6, 4.6, 8.2), "rubble")
        mb.add_box((2.1, 0.0, 3.3), (6.4, 7.4, 5.2), "plaster")
        mb.add_box((2.1, 0.0, 6.8), (6.8, 7.8, 2.6), "shingles", taper_top=(1.0, 0.15))
        return

    tx, ty = -3.1, -0.2
    mb.add_box((tx, ty, 4.4), (4.7, 4.7, 7.6), "rubble", taper_top=(0.93, 0.93), tint=(0.93, 0.91, 0.88), bevel=0.04)
    if lod <= 1:
        for sx in (-1, 1):
            for sy in (-1, 1):
                for iz in range(7):
                    z = 1.15 + iz * 0.95
                    mb.add_box((tx + sx * 2.26, ty + sy * 2.26, z), (0.48, 0.48, 0.42), "ashlar", tint=(0.98, 0.95, 0.90), bevel=0.015)
        add_lancet_window(mb, tx, ty - 2.30, 5.65)
        add_lancet_window(mb, tx - 2.30, ty, 5.65, yaw_rad=-math.pi * 0.5)
        add_lancet_window(mb, tx, ty + 2.30, 5.65, yaw_rad=math.pi)
    mb.add_box((tx, ty, 8.32), (5.08, 5.08, 0.34), "ashlar", tint=(0.95, 0.92, 0.88), bevel=0.02)
    for sx in (-2.25, -0.75, 0.75, 2.25):
        for sy in (-2.25, 2.25):
            mb.add_box((tx + sx, ty + sy, 8.88), (0.82, 0.44, 0.86), "ashlar", tint=(0.94, 0.91, 0.87), bevel=0.015)
    for sy in (-0.75, 0.75):
        for sx in (-2.25, 2.25):
            mb.add_box((tx + sx, ty + sy, 8.88), (0.44, 0.82, 0.86), "ashlar", tint=(0.94, 0.91, 0.87), bevel=0.015)
    add_pyramidal_cap(mb, tx, ty, 2.08, 8.65, 11.55, "shingles", tint=(0.88, 0.86, 0.84))
    if lod == 0:
        mb.add_cylinder((tx + 1.9, ty - 1.9, 8.6), (tx + 1.9, ty - 1.9, 12.8), 0.06, 0.04, 6, "beam", tint=(0.84, 0.80, 0.74))
        mb.add_box((tx + 2.68, ty - 1.9, 12.1), (1.52, 0.05, 0.78), "linen", tint=(0.15, 0.28, 0.56))
        add_banner(mb, tx - 0.1, ty - 2.36, 7.65, length=2.4)

    # Adjoining Two-Storey Half-Timbered Great Hall (+2.2, 0.1) — full 360 framing!
    hx, hy = 2.2, 0.1
    mb.add_box((hx, hy, 2.2), (6.2, 7.6, 2.7), "rubble", tint=(0.90, 0.88, 0.85), bevel=0.02)
    mb.add_box((hx, hy, 4.55), (6.5, 7.9, 2.15), "plaster", tint=(1.0, 0.98, 0.93), bevel=0.02)
    add_half_timber_360(mb, hx, hy, 3.25, 3.95, 3.48, 5.62, lod, bays_x=3, bays_y=3, skip_sides=("west",))
    add_pitched_roof_360(mb, hx, hy, 3.30, 4.00, 5.55, 8.75, "shingles", "plaster", overhang=0.46, thickness=0.20, lod=lod)
    mb.add_box((hx + 3.45, hy + 1.2, 4.8), (1.15, 1.45, 8.3), "rubble", taper_top=(0.76, 0.78), tint=(0.88, 0.85, 0.81), bevel=0.03)
    mb.add_box((hx + 3.45, hy + 1.2, 9.05), (0.98, 1.24, 0.24), "ashlar", tint=(0.94, 0.90, 0.85))

    if lod <= 1:
        add_oak_door(mb, hx - 0.1, hy - 3.82, 0.92, w=1.55, h=2.32)
        add_window(mb, hx - 1.9, hy - 3.98, 4.55, shutters=(lod == 0))
        add_window(mb, hx + 1.9, hy - 3.98, 4.55, shutters=(lod == 0))
        add_window(mb, hx - 1.4, hy + 3.98, 4.55, yaw_rad=math.pi, shutters=(lod == 0))
        add_window(mb, hx + 1.4, hy + 3.98, 4.55, yaw_rad=math.pi, shutters=(lod == 0))
        add_window(mb, hx + 3.28, hy - 1.6, 4.55, yaw_rad=math.pi * 0.5, shutters=(lod == 0))
        for i in range(4):
            mb.add_box((hx - 0.1, hy - 4.75 - i * 0.34, 0.82 - i * 0.22), (2.4, 0.42, 0.22), "ashlar", tint=(0.93, 0.90, 0.85))


def build_watchtower_l1_v2(mb, lod):
    """Battered stone watchtower with arrow-slits on all 4 walls, ashlar quoins & cantilevered hoarding."""
    mb.add_box((0.0, 0.0, 3.15), (4.35, 4.35, 7.4), "rubble", taper_top=(0.86, 0.86), tint=(0.92, 0.89, 0.85), bevel=0.04)
    if lod == 3:
        mb.add_box((0.0, 0.0, 7.6), (4.6, 4.6, 2.2), "boards")
        mb.add_box((0.0, 0.0, 9.6), (4.6, 4.6, 2.0), "shingles", taper_top=(0.1, 0.1))
        return

    if lod <= 1:
        for sx in (-1, 1):
            for sy in (-1, 1):
                for iz in range(6):
                    z = 0.6 + iz * 1.05
                    w_off = 2.08 - iz * 0.05
                    mb.add_box((sx * w_off, sy * w_off, z), (0.44, 0.44, 0.46), "ashlar", tint=(0.97, 0.94, 0.89), bevel=0.015)
        add_oak_door(mb, 0.0, -2.14, 0.10, w=1.05, h=1.95)
        # Recessed arrow slits on all 4 faces
        for yaw, ox, oy in [(0, 0, -2.02), (math.pi, 0, 2.02), (math.pi * 0.5, 2.02, 0), (-math.pi * 0.5, -2.02, 0)]:
            add_lancet_window(mb, ox, oy, 4.45, yaw_rad=yaw, w=0.26, h=1.22)
    mb.add_box((0.0, 0.0, 6.85), (4.15, 4.15, 0.28), "ashlar", tint=(0.95, 0.92, 0.87), bevel=0.02)
    mb.add_box((0.0, 0.0, 7.82), (4.68, 4.68, 1.72), "boards", tint=(0.87, 0.82, 0.74), bevel=0.02)
    add_half_timber_360(mb, 0.0, 0.0, 2.34, 2.34, 6.96, 8.66, lod, bays_x=2, bays_y=2)
    if lod <= 1:
        for side in (-1.5, -0.5, 0.5, 1.5):
            for s in (-1, 1):
                mb.add_box((side, s * 2.05, 6.72), (0.18, 0.68, 0.22), "beam", tint=(0.80, 0.75, 0.69))
                mb.add_box((s * 2.05, side, 6.72), (0.68, 0.18, 0.22), "beam", tint=(0.80, 0.75, 0.69))
        for s in (-1, 1):
            mb.add_box((0.0, s * 2.38, 8.20), (3.5, 0.12, 0.42), "beam", tint=(0.22, 0.19, 0.17))
            mb.add_box((s * 2.38, 0.0, 8.20), (0.12, 3.5, 0.42), "beam", tint=(0.22, 0.19, 0.17))
    add_pyramidal_cap(mb, 0.0, 0.0, 2.65, 8.65, 11.15, "shingles", tint=(0.89, 0.87, 0.84))


# ==============================================================================
# 10 NEW STAGE 5 VILLAGE & CAMPAIGN BUILDINGS
# ==============================================================================

# 1. CHAPEL L1
def build_chapel_l1(mb, lod):
    mb.add_box((0.0, 0.0, 0.15), (6.8, 11.2, 1.35), "rubble", tint=(0.91, 0.89, 0.85), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.0, 2.8), (6.0, 10.2, 4.4), "rubble")
        mb.add_box((0.0, 0.0, 6.4), (6.6, 10.8, 3.2), "shingles", taper_top=(0.15, 1.0))
        mb.add_box((0.0, -3.5, 10.2), (2.2, 2.2, 4.4), "boards", taper_top=(0.2, 0.2))
        return

    # Stone Nave + stepped apse at north (+Y) end
    mb.add_box((0.0, -0.4, 2.75), (6.0, 9.6, 4.10), "rubble", tint=(0.93, 0.90, 0.86), bevel=0.03)
    mb.add_box((0.0, 4.9, 2.35), (4.4, 2.4, 3.35), "rubble", taper_top=(0.94, 0.94), tint=(0.92, 0.89, 0.85), bevel=0.03)
    add_pitched_roof_360(mb, 0.0, -0.4, 3.05, 4.85, 4.75, 8.25, "shingles", "rubble", overhang=0.42, thickness=0.18, gable_tint=(0.93, 0.90, 0.86), lod=lod, ridge_axis="y")
    add_pyramidal_cap(mb, 0.0, 4.9, 2.35, 4.00, 6.25, "shingles", tint=(0.90, 0.88, 0.85))

    # Dressed ashlar wall buttresses & Gothic lancet windows
    if lod <= 1:
        for sy in (-3.6, -1.2, 1.2, 3.6):
            for sx in (-3.15, 3.15):
                mb.add_box((sx, sy, 2.15), (0.62, 0.56, 3.85), "ashlar", taper_top=(0.68, 0.85), tint=(0.96, 0.93, 0.88), bevel=0.02)
        for sy in (-2.4, 0.0, 2.4):
            add_lancet_window(mb, -3.02, sy, 2.75, yaw_rad=-math.pi * 0.5)
            add_lancet_window(mb, 3.02, sy, 2.75, yaw_rad=math.pi * 0.5)
        add_lancet_window(mb, 0.0, -5.22, 5.85, w=0.72, h=1.55)
        add_oak_door(mb, 0.0, -5.22, 0.78, w=1.42, h=2.45)
        for i in range(3):
            mb.add_box((0.0, -5.95 - i * 0.34, 0.68 - i * 0.22), (2.25, 0.42, 0.22), "ashlar", tint=(0.95, 0.92, 0.87))

    # Timber Bell-cote / Belfry Spire straddling south roof ridge
    mb.add_box((0.0, -3.2, 8.45), (2.15, 2.15, 2.25), "boards", tint=(0.86, 0.81, 0.74), bevel=0.02)
    if lod <= 1:
        for sx in (-0.95, 0.95):
            for sy in (-0.95, 0.95):
                mb.add_beam((sx, -3.2 + sy, 7.3), (sx, -3.2 + sy, 10.65), 0.16, 0.16, "beam", tint=(0.78, 0.73, 0.67))
        # Cast bronze chapel bell suspended inside open belfry
        mb.add_cylinder((0.0, -3.2, 9.75), (0.0, -3.2, 10.35), 0.34, 0.16, 10, "beam", metal=0.85, tint=(0.56, 0.44, 0.24))
    add_pyramidal_cap(mb, 0.0, -3.2, 1.38, 10.55, 14.20, "shingles", tint=(0.88, 0.86, 0.84))
    # Forged iron finial cross at apex
    mb.add_box((0.0, -3.2, 14.55), (0.08, 0.08, 0.95), "beam", metal=0.9, tint=(0.30, 0.30, 0.33))
    mb.add_box((0.0, -3.2, 14.72), (0.52, 0.08, 0.08), "beam", metal=0.9, tint=(0.30, 0.30, 0.33))


# 2. SMITHY L1 (with `smoke_0`)
def build_smithy_l1(mb, lod):
    mb.add_box((0.0, 0.0, 0.02), (7.6, 5.8, 0.95), "rubble", tint=(0.88, 0.85, 0.81), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.6, 0.3, 2.0), (6.4, 4.6, 3.0), "boards")
        mb.add_box((2.4, 0.4, 3.4), (1.8, 2.0, 6.2), "rubble")
        return

    # Half-enclosed stone & timber workshop bay (-X/rear) + open-front forge awning
    mb.add_box((-1.55, 0.65, 1.75), (3.85, 3.65, 2.65), "rubble", tint=(0.89, 0.86, 0.82), bevel=0.03)
    mb.add_box((-1.55, 0.65, 3.45), (4.0, 3.8, 0.95), "plaster", tint=(0.94, 0.91, 0.85))
    add_half_timber_360(mb, -1.55, 0.65, 2.0, 1.9, 2.95, 3.92, lod, bays_x=2, bays_y=2)
    # Heavy oak support posts for open east forge porch
    for px, py in [(0.45, -2.25), (3.15, -2.25), (3.15, 2.15), (-3.35, -2.25)]:
        mb.add_beam((px, py, 0.1), (px, py, 3.15), 0.22, 0.22, "beam", tint=(0.76, 0.71, 0.65))
    # Steep broad shingle roof covering both shop & open forge hearth
    add_pitched_roof_360(mb, -0.1, 0.0, 3.55, 2.65, 3.10, 5.65, "shingles", "boards", overhang=0.45, thickness=0.18, gable_tint=(0.84, 0.79, 0.72), lod=lod)

    # Massive stone forge hearth, charcoal bed & towering blackened chimney (`smoke_0` at (2.15, 1.35, 6.85))
    mb.add_box((2.15, 1.35, 0.72), (1.95, 1.85, 1.45), "rubble", tint=(0.82, 0.79, 0.75), bevel=0.03)
    mb.add_box((2.15, 1.15, 1.50), (1.25, 0.95, 0.16), "beam", tint=(0.24, 0.13, 0.09))  # glowing dark coals
    mb.add_box((2.15, 1.35, 4.15), (1.42, 1.35, 5.45), "rubble", taper_top=(0.68, 0.68), tint=(0.78, 0.75, 0.72), bevel=0.03)
    mb.add_box((2.15, 1.35, 6.82), (1.08, 1.04, 0.22), "ashlar", tint=(0.88, 0.85, 0.81))

    if lod <= 1:
        add_oak_door(mb, -1.65, -1.18, 0.48, w=1.08, h=2.02)
        add_window(mb, -3.52, 0.65, 2.15, yaw_rad=-math.pi * 0.5, w=0.92, h=0.88, shutters=(lod == 0))
        # Iron anvil seated on heavy oak stump in front forge yard!
        mb.add_cylinder((1.45, -1.15, 0.05), (1.45, -1.15, 0.76), 0.34, 0.30, 10, "bark", tint=(0.82, 0.76, 0.68))
        mb.add_box((1.45, -1.15, 0.88), (0.34, 0.24, 0.22), "beam", metal=0.95, tint=(0.30, 0.30, 0.33))
        mb.add_box((1.45, -1.15, 1.04), (0.82, 0.26, 0.16), "beam", taper_top=(0.88, 1.0), metal=0.95, tint=(0.36, 0.36, 0.39))
        # Quenching barrel beside anvil
        mb.add_cylinder((2.55, -1.25, 0.08), (2.55, -1.25, 0.92), 0.36, 0.33, 10, "boards", tint=(0.80, 0.74, 0.65))
    if lod == 0:
        # Leather-and-oak forge bellows & standing weapon rack
        mb.add_box((1.05, 1.35, 1.15), (0.95, 0.65, 0.45), "boards", rot_euler=(0.0, 0.18, 0.0), tint=(0.82, 0.76, 0.68))
        mb.add_box((-0.15, -2.15, 0.82), (1.35, 0.32, 1.25), "beam", tint=(0.80, 0.74, 0.66))
        for wx in (-0.55, -0.25, 0.05, 0.35):
            mb.add_box((wx, -2.15, 0.95), (0.06, 0.04, 1.25), "beam", metal=0.95, tint=(0.50, 0.50, 0.52))


# 3. BARRACKS L1
def build_barracks_l1(mb, lod):
    mb.add_box((0.0, 0.0, 0.12), (11.6, 6.8, 1.18), "rubble", tint=(0.91, 0.88, 0.84), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.2, 2.6), (11.0, 5.8, 4.2), "plaster")
        mb.add_box((0.0, 0.2, 5.8), (11.6, 6.4, 2.8), "shingles", taper_top=(1.0, 0.15))
        return

    # Ground stone floor + jettied half-timbered upper soldier dormitory
    mb.add_box((0.0, 0.35, 1.75), (10.6, 5.4, 2.35), "rubble", tint=(0.91, 0.88, 0.84), bevel=0.03)
    mb.add_box((0.0, 0.20, 3.85), (11.0, 6.0, 1.95), "plaster", tint=(0.98, 0.95, 0.89), bevel=0.02)
    add_half_timber_360(mb, 0.0, 0.20, 5.50, 3.00, 2.88, 4.82, lod, bays_x=5, bays_y=2)
    add_pitched_roof_360(mb, 0.0, 0.20, 5.56, 3.06, 4.78, 7.65, "shingles", "plaster", overhang=0.45, thickness=0.18, lod=lod)

    # Covered front military porch supported by 5 stout oak posts
    if lod <= 1:
        for px in (-4.8, -2.4, 0.0, 2.4, 4.8):
            mb.add_beam((px, -3.55, 0.0), (px, -3.55, 2.82), 0.20, 0.20, "beam", tint=(0.78, 0.73, 0.67))
        mb.add_box((0.0, -3.15, 2.95), (10.4, 1.55, 0.14), "shingles", rot_euler=(0.24, 0.0, 0.0), tint=(0.90, 0.88, 0.84))
        add_oak_door(mb, -1.8, -2.36, 0.65, w=1.45, h=2.18)
        add_oak_door(mb, 1.8, -2.36, 0.65, w=1.45, h=2.18)
        for wx in (-3.8, -1.3, 1.3, 3.8):
            add_window(mb, wx, -2.82, 3.88, w=0.92, h=0.92, shutters=(lod == 0))
            add_window(mb, wx, 3.22, 3.88, yaw_rad=math.pi, w=0.92, h=0.92, shutters=(lod == 0))
    if lod == 0:
        # Twin hanging Marchland garrison banners + standing archery butt target beside entrance
        add_banner(mb, -4.6, -2.88, 4.55, length=2.1)
        add_banner(mb, 4.6, -2.88, 4.55, length=2.1)
        # Round straw archery target on timber easel
        mb.add_beam((5.95, -2.2, 0.0), (5.95, -1.8, 1.65), 0.08, 0.08, "beam")
        mb.add_beam((5.55, -2.2, 0.0), (5.95, -1.8, 1.65), 0.08, 0.08, "beam")
        mb.add_beam((6.35, -2.2, 0.0), (5.95, -1.8, 1.65), 0.08, 0.08, "beam")
        mb.add_cylinder((5.95, -2.18, 1.15), (5.95, -1.92, 1.15), 0.56, 0.56, 12, "thatch", tint=(0.96, 0.90, 0.72))


# 4. MARKET L1
def build_market_l1(mb, lod):
    # Stepped cobbled/ashlar market floor plinth
    mb.add_box((0.0, 0.0, 0.06), (9.6, 6.8, 0.85), "cobble", tint=(0.92, 0.89, 0.84), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.0, 3.4), (9.2, 6.4, 3.4), "shingles", taper_top=(0.92, 0.25))
        return

    # Open 8-post medieval oak market arcade with arched timber knee-braces
    post_xs = (-4.2, -1.4, 1.4, 4.2)
    post_ys = (-2.6, 2.6)
    for px in post_xs:
        for py in post_ys:
            mb.add_box((px, py, 0.56), (0.48, 0.48, 0.42), "ashlar", tint=(0.95, 0.92, 0.87))
            mb.add_beam((px, py, 0.72), (px, py, 3.25), 0.24, 0.24, "beam", tint=(0.78, 0.73, 0.67))
            if lod <= 1:
                mb.add_beam((px, py, 2.45), (px + (0.65 if px < 4.0 else -0.65), py, 3.18), 0.12, 0.12, "beam")
    # Heavy perimeter wall plates & tie beams
    for py in post_ys:
        mb.add_box((0.0, py, 3.24), (8.8, 0.26, 0.24), "beam", tint=(0.78, 0.73, 0.67))
    for px in post_xs:
        mb.add_box((px, 0.0, 3.24), (0.24, 5.5, 0.24), "beam", tint=(0.78, 0.73, 0.67))

    add_pitched_roof_360(mb, 0.0, 0.0, 4.45, 2.75, 3.22, 5.85, "shingles", "boards", overhang=0.52, thickness=0.18, gable_tint=(0.86, 0.81, 0.73), lod=lod)

    # Interior wooden merchant stalls, colorful dyed linen awnings & goods
    if lod <= 1:
        for sx, awning_tint in [(-2.6, (0.68, 0.26, 0.18)), (0.0, (0.18, 0.30, 0.54)), (2.6, (0.76, 0.62, 0.26))]:
            mb.add_box((sx, 0.45, 0.96), (2.15, 1.15, 0.12), "boards", tint=(0.90, 0.84, 0.74), bevel=0.015)
            mb.add_box((sx, 0.45, 0.62), (2.02, 1.02, 0.58), "boards", tint=(0.84, 0.78, 0.69))
            # Slanted merchant cloth canopy inside stall
            mb.add_box((sx, 0.35, 2.38), (2.18, 1.48, 0.06), "linen", rot_euler=(0.26, 0.0, 0.0), tint=awning_tint)
            if lod == 0:
                mb.add_box((sx - 0.55, 0.35, 1.24), (0.48, 0.42, 0.42), "boards", tint=(0.88, 0.80, 0.68))
                mb.add_box((sx + 0.48, 0.42, 1.32), (0.46, 0.40, 0.58), "linen", taper_top=(0.72, 0.72), tint=(0.94, 0.88, 0.75), bevel=0.06)


# 5. WELL L1
def build_well_l1(mb, lod):
    # Octagonal cobble apron + circular stone wellhead wall
    mb.add_cylinder((0.0, 0.0, -0.35), (0.0, 0.0, 0.14), 1.95, 1.88, 8, "cobble", tint=(0.92, 0.89, 0.84))
    mb.add_cylinder((0.0, 0.0, 0.10), (0.0, 0.0, 1.02), 1.08, 1.04, 12 if lod < 2 else 8, "rubble", tint=(0.93, 0.90, 0.86))
    mb.add_cylinder((0.0, 0.0, 0.98), (0.0, 0.0, 1.14), 1.16, 1.16, 12 if lod < 2 else 8, "ashlar", tint=(0.97, 0.94, 0.89))
    # Dark interior well water surface
    mb.add_cylinder((0.0, 0.0, 0.72), (0.0, 0.0, 0.82), 0.76, 0.76, 10, "beam", tint=(0.14, 0.17, 0.20))
    if lod == 3:
        mb.add_box((0.0, 0.0, 2.5), (2.2, 2.2, 1.5), "shingles", taper_top=(0.2, 0.2))
        return
    # Timber support posts, horizontal windlass axle, crank handle, rope & bucket
    for sx in (-1.04, 1.04):
        mb.add_beam((sx, 0.0, 0.85), (sx, 0.0, 2.42), 0.16, 0.16, "beam", tint=(0.80, 0.75, 0.68))
    mb.add_cylinder((-1.05, 0.0, 1.68), (1.05, 0.0, 1.68), 0.10, 0.10, 8, "beam", tint=(0.84, 0.78, 0.70))
    if lod == 0:
        mb.add_cylinder((0.0, 0.0, 1.12), (0.0, 0.0, 1.66), 0.025, 0.025, 6, "thatch", tint=(0.86, 0.78, 0.62))
        mb.add_cylinder((0.0, 0.0, 1.04), (0.0, 0.0, 1.38), 0.18, 0.22, 8, "boards", tint=(0.82, 0.76, 0.68))
        mb.add_box((1.22, 0.0, 1.68), (0.28, 0.05, 0.05), "beam", metal=0.9, tint=(0.30, 0.30, 0.32))
    add_pitched_roof_360(mb, 0.0, 0.0, 1.24, 1.15, 2.38, 3.42, "shingles", "boards", overhang=0.28, thickness=0.13, gable_tint=(0.86, 0.80, 0.72), lod=lod)


# 6. STOREHOUSE L1
def build_storehouse_l1(mb, lod):
    mb.add_box((0.0, 0.0, 0.18), (9.4, 6.2, 1.30), "rubble", tint=(0.90, 0.87, 0.83), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.0, 2.3), (8.8, 5.6, 3.4), "boards")
        mb.add_box((0.0, 0.0, 5.2), (9.4, 6.2, 2.6), "shingles", taper_top=(1.0, 0.15))
        return

    # Heavy plank-and-timber vaulted medieval warehouse
    mb.add_box((0.0, 0.0, 2.25), (8.8, 5.6, 3.05), "boards", tint=(0.87, 0.82, 0.74), bevel=0.02)
    add_half_timber_360(mb, 0.0, 0.0, 4.40, 2.80, 0.78, 3.76, lod, bays_x=4, bays_y=2)
    add_pitched_roof_360(mb, 0.0, 0.0, 4.46, 2.86, 3.74, 6.45, "shingles", "boards", overhang=0.45, thickness=0.18, gable_tint=(0.86, 0.80, 0.72), lod=lod)

    if lod <= 1:
        # Wide cargo double doors + wooden loading ramp
        add_oak_door(mb, -0.78, -2.82, 0.82, w=1.42, h=2.36)
        add_oak_door(mb, 0.78, -2.82, 0.82, w=1.42, h=2.36)
        mb.add_box((0.0, -3.55, 0.42), (3.4, 1.65, 0.32), "boards", rot_euler=(-0.22, 0.0, 0.0), tint=(0.86, 0.81, 0.73))
        # Overhanging front gable crane hoist beam
        mb.add_beam((4.1, 0.0, 5.55), (5.45, 0.0, 5.55), 0.18, 0.18, "beam", tint=(0.78, 0.73, 0.67))
        mb.add_beam((4.35, 0.0, 4.25), (5.15, 0.0, 5.50), 0.14, 0.14, "beam", tint=(0.78, 0.73, 0.67))
        if lod == 0:
            # Trade barrels & stacked crates beside loading dock
            for bx, by in [(-2.65, -3.25), (-3.45, -3.15), (2.75, -3.22)]:
                mb.add_cylinder((bx, by, 0.05), (bx, by, 0.96), 0.36, 0.34, 10, "boards", tint=(0.84, 0.78, 0.69))
            mb.add_box((3.55, -3.25, 0.42), (0.85, 0.75, 0.75), "boards", tint=(0.88, 0.82, 0.72), bevel=0.02)


# 7. FISHER'S HUT L1
def build_fisher_l1(mb, lod):
    # Timber decking platform raised on stout riverside oak pilings (sunk -1.4 m into water/mud!)
    for px in (-2.6, 0.0, 2.6):
        for py in (-2.6, 0.0, 2.2):
            mb.add_cylinder((px, py, -1.45), (px, py, 0.58), 0.16, 0.15, 7, "bark", tint=(0.74, 0.68, 0.60))
    mb.add_box((0.0, -0.25, 0.58), (6.0, 5.6, 0.18), "boards", tint=(0.84, 0.79, 0.71), bevel=0.02)
    if lod == 3:
        mb.add_box((0.0, 0.4, 2.0), (4.6, 3.6, 2.6), "boards")
        mb.add_box((0.0, 0.4, 4.0), (5.2, 4.2, 1.8), "thatch", taper_top=(1.0, 0.15))
        return

    # Weathered timber-plank cabin + thick thatch roof
    mb.add_box((0.0, 0.55, 1.82), (4.5, 3.4, 2.35), "boards", tint=(0.86, 0.81, 0.73), bevel=0.02)
    add_half_timber_360(mb, 0.0, 0.55, 2.26, 1.72, 0.68, 2.98, lod, bays_x=2, bays_y=2)
    mb.add_box((-2.22, 0.55, 3.55), (0.18, 2.55, 1.25), "boards", taper_top=(1.0, 0.10), tint=(0.85, 0.80, 0.72))
    mb.add_box((2.22, 0.55, 3.55), (0.18, 2.55, 1.25), "boards", taper_top=(1.0, 0.10), tint=(0.85, 0.80, 0.72))
    add_pitched_roof_360(mb, 0.0, 0.55, 2.35, 1.80, 2.92, 4.65, "thatch", "boards", overhang=0.45, thickness=0.28, roof_tint=(0.94, 0.89, 0.76), gable_tint=(0.85, 0.80, 0.72), lod=lod)

    if lod <= 1:
        add_oak_door(mb, -0.55, -1.16, 0.68, w=0.98, h=1.88)
        add_window(mb, 1.15, -1.18, 1.88, w=0.78, h=0.82, shutters=(lod == 0))
        # Drying fish-net wooden frame on front deck
        mb.add_beam((1.65, -2.55, 0.66), (1.65, -2.55, 2.32), 0.09, 0.09, "beam")
        mb.add_beam((2.75, -2.15, 0.66), (2.75, -2.15, 2.32), 0.09, 0.09, "beam")
        mb.add_beam((1.65, -2.55, 2.25), (2.75, -2.15, 2.25), 0.08, 0.08, "beam")
        mb.add_box((2.20, -2.35, 1.52), (1.15, 0.04, 1.35), "linen", rot_euler=(0.0, 0.0, 0.34), tint=(0.76, 0.72, 0.62))
        if lod == 0:
            # Small weathered wooden fishing rowboat resting beside deck
            mb.add_box((-2.85, -3.55, 0.12), (1.15, 3.15, 0.52), "boards", taper_top=(1.18, 1.15), tint=(0.82, 0.76, 0.68), bevel=0.08)
            mb.add_cylinder((-2.2, -2.4, 0.68), (-1.4, -1.25, 2.35), 0.04, 0.035, 6, "boards", tint=(0.88, 0.82, 0.72))


# 8. CAMP TENT L1 (Medieval Feudal War Pavilion)
def build_camp_tent_l1(mb, lod):
    # Ground canvas footprint & timber stakes
    if lod == 3:
        mb.add_box((0.0, 0.0, 1.6), (4.2, 5.2, 3.2), "linen", taper_top=(0.15, 0.78))
        return

    # Lower tent canvas walls (slightly battered outward)
    mb.add_box((0.0, 0.0, 0.92), (4.15, 5.25, 1.88), "linen", taper_top=(0.94, 0.96), tint=(0.88, 0.83, 0.73), bevel=0.04)
    # Steeply pitched crimson-and-cream heraldic medieval war pavilion roof!
    # Left & right canvas roof slopes + triangular ridge ends
    rise = 2.05
    half_x, half_y = 2.02, 2.60
    slope_len = math.hypot(half_x + 0.18, rise)
    pitch = math.atan2(rise, half_x + 0.18)
    mb.add_box((-half_x * 0.5 - 0.05, 0.0, 1.85 + rise * 0.5), (slope_len, half_y * 2.0 + 0.22, 0.10), "linen", rot_euler=(0.0, -pitch, 0.0), tint=(0.56, 0.16, 0.15), bevel=0.02)
    mb.add_box((half_x * 0.5 + 0.05, 0.0, 1.85 + rise * 0.5), (slope_len, half_y * 2.0 + 0.22, 0.10), "linen", rot_euler=(0.0, pitch, 0.0), tint=(0.56, 0.16, 0.15), bevel=0.02)
    for sy in (-half_y + 0.08, half_y - 0.08):
        mb.add_box((0.0, sy, 1.85 + rise * 0.42), (half_x * 1.84, 0.12, rise * 0.84), "linen", taper_top=(0.08, 1.0), tint=(0.86, 0.80, 0.68))

    # Scalloped eave valance band + dark open tent flap entrance (-Y)
    mb.add_box((0.0, 0.0, 1.82), (4.28, 5.42, 0.24), "linen", tint=(0.84, 0.72, 0.42))
    mb.add_box((0.0, -2.58, 0.98), (1.35, 0.18, 1.85), "beam", tint=(0.16, 0.13, 0.11))

    # Tall oak ridgepoles with forged iron finials & pennant
    for sy in (-half_y, half_y):
        mb.add_cylinder((0.0, sy, -0.1), (0.0, sy, 4.48), 0.075, 0.055, 8, "beam", tint=(0.80, 0.74, 0.66))
        mb.add_box((0.0, sy, 4.55), (0.14, 0.14, 0.22), "beam", metal=0.9, tint=(0.68, 0.54, 0.24))
    if lod <= 1:
        mb.add_box((0.55, -half_y, 4.30), (1.05, 0.04, 0.36), "linen", tint=(0.62, 0.16, 0.15))
        # Guy ropes & wooden ground pegs
        for sx in (-1.0, 1.0):
            for sy in (-2.2, 0.0, 2.2):
                mb.add_beam((sx * 2.05, sy, 1.82), (sx * 2.85, sy, 0.0), 0.025, 0.025, "thatch", tint=(0.84, 0.78, 0.64))
                mb.add_cylinder((sx * 2.85, sy, -0.10), (sx * 2.85, sy, 0.26), 0.04, 0.03, 6, "beam")


# 9. RUIN HOUSE (Mission 4 Rebuildable Burned Cottage Ruin!)
def build_ruin_house(mb, lod):
    rng = random.Random(904)
    # Cracked stone cottage foundation
    mb.add_box((0.0, 0.0, 0.02), (6.4, 4.8, 0.92), "rubble", tint=(0.76, 0.73, 0.69), bevel=0.04)
    if lod == 3:
        mb.add_box((-1.2, 0.8, 1.4), (3.4, 2.8, 2.4), "rubble")
        return

    # Jagged broken half-standing fieldstone corner walls (missing sections & burnt edge)
    mb.add_box((-2.85, 0.65, 1.55), (0.55, 3.25, 2.45), "rubble", taper_top=(0.85, 0.76), tint=(0.74, 0.70, 0.66), bevel=0.04)
    mb.add_box((-1.35, 2.15, 1.75), (3.45, 0.55, 2.85), "rubble", taper_top=(0.82, 0.90), tint=(0.72, 0.69, 0.65), bevel=0.04)
    mb.add_box((2.75, -0.95, 1.05), (0.55, 2.15, 1.45), "rubble", taper_top=(0.85, 0.65), tint=(0.75, 0.72, 0.68), bevel=0.04)
    mb.add_box((-1.65, -2.10, 0.95), (2.45, 0.52, 1.25), "rubble", taper_top=(0.78, 0.90), tint=(0.75, 0.72, 0.68), bevel=0.04)

    # Tall solitary fire-blackened fieldstone chimney surviving at north-west corner
    mb.add_box((-2.55, 1.85, 2.45), (1.18, 1.18, 4.55), "rubble", taper_top=(0.74, 0.74), tint=(0.66, 0.63, 0.60), bevel=0.04)

    # Charred fallen oak roof beams & collapsed shingle debris
    if lod <= 1:
        mb.add_beam((-2.75, 2.05, 3.05), (1.15, -0.35, 0.45), 0.18, 0.18, "beam", tint=(0.32, 0.28, 0.25))
        mb.add_beam((-2.65, -0.45, 2.55), (1.85, 1.45, 0.48), 0.17, 0.17, "beam", tint=(0.30, 0.26, 0.24))
        mb.add_beam((-0.55, 2.05, 2.75), (2.55, -1.25, 0.52), 0.16, 0.16, "beam", tint=(0.34, 0.30, 0.26))
        mb.add_box((0.25, 0.25, 0.52), (2.65, 1.85, 0.32), "shingles", rot_euler=(0.24, -0.18, 0.35), tint=(0.56, 0.52, 0.48))
        # Scattered stone rubble piles
        for _ in range(10 if lod == 0 else 5):
            rx = rng.uniform(-2.6, 2.8)
            ry = rng.uniform(-2.0, 1.8)
            rs = rng.uniform(0.32, 0.78)
            mb.add_box((rx, ry, 0.36 + rs * 0.2), (rs, rs * 0.85, rs * 0.62), "rubble", rot_euler=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 3.14)), tint=(0.74, 0.71, 0.67), bevel=0.05)


# 10. FORTRESS DONZON (Monumental 19 m Mission 5 Citadel Keep — with `smoke_0`!)
def build_fortress_donzon(mb, lod):
    """Monumental Mission 5 Citadel Keep: battered plinth, 4 flanking corner turrets, crenellations & hall."""
    # Deep battered stone talus foundation (sunk -1.2 m so it seats rock-solid on the 7 m fortress plateau!)
    mb.add_box((0.0, 0.0, 0.90), (16.8, 13.6, 4.20), "rubble", taper_top=(0.90, 0.90), tint=(0.88, 0.86, 0.83), bevel=0.05)
    if lod == 3:
        mb.add_box((0.0, 0.0, 6.8), (14.4, 11.4, 12.2), "rubble")
        mb.add_box((0.0, 0.0, 14.2), (14.6, 11.6, 3.8), "shingles", taper_top=(1.0, 0.15))
        for sx in (-7.2, 7.2):
            for sy in (-5.8, 5.8):
                mb.add_box((sx, sy, 8.8), (4.2, 4.2, 16.5), "rubble")
        return

    # Main Citadel Keep Body (z: 2.8 .. 12.8 m)
    mb.add_box((0.0, 0.0, 7.75), (14.4, 11.2, 10.0), "rubble", taper_top=(0.96, 0.96), tint=(0.91, 0.89, 0.86), bevel=0.04)
    # Stone string-courses & crowning ashlar machicolated parapet belt (z = 12.75 m)
    mb.add_box((0.0, 0.0, 7.65), (14.75, 11.55, 0.36), "ashlar", tint=(0.95, 0.92, 0.88))
    mb.add_box((0.0, 0.0, 12.80), (15.10, 11.90, 0.44), "ashlar", tint=(0.96, 0.93, 0.89), bevel=0.02)

    # Crenellated curtain merlons around keep roof perimeter
    for mx in (-4.8, -2.4, 0.0, 2.4, 4.8):
        for sy in (-5.72, 5.72):
            mb.add_box((mx, sy, 13.48), (1.35, 0.48, 1.05), "ashlar", tint=(0.95, 0.92, 0.88), bevel=0.02)
    for my in (-3.2, -1.0, 1.0, 3.2):
        for sx in (-7.32, 7.32):
            mb.add_box((sx, my, 13.48), (0.48, 1.25, 1.05), "ashlar", tint=(0.95, 0.92, 0.88), bevel=0.02)

    # Central steep pitched shingle Great Hall roof rising from behind parapet (13.0 .. 17.6 m)
    add_pitched_roof_360(mb, 0.0, 0.0, 6.2, 4.6, 13.05, 17.45, "shingles", "rubble", overhang=0.36, thickness=0.22, gable_tint=(0.91, 0.89, 0.85), lod=lod)

    # Four Commanding Corner Flanking Turrets (rising to 18.8 m!)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            tx, ty = sx * 7.25, sy * 5.65
            mb.add_box((tx, ty, 7.25), (4.45, 4.45, 15.2), "rubble", taper_top=(0.91, 0.91), tint=(0.90, 0.88, 0.85), bevel=0.04)
            # Ashlar turret cornice & crenellated crown (z = 14.85 m)
            mb.add_box((tx, ty, 14.88), (4.65, 4.65, 0.36), "ashlar", tint=(0.96, 0.93, 0.89))
            for cx_o in (-1.85, 0.0, 1.85):
                for cy_o in (-1.85, 1.85):
                    mb.add_box((tx + cx_o, ty + cy_o, 15.52), (0.95, 0.44, 0.96), "ashlar", tint=(0.95, 0.92, 0.88), bevel=0.015)
            for cy_o in (0.0,):
                for cx_o in (-1.85, 1.85):
                    mb.add_box((tx + cx_o, ty + cy_o, 15.52), (0.44, 0.95, 0.96), "ashlar", tint=(0.95, 0.92, 0.88), bevel=0.015)
            add_pyramidal_cap(mb, tx, ty, 2.10, 15.45, 19.15, "shingles", tint=(0.86, 0.84, 0.82))
            if lod <= 1:
                # Corner ashlar quoins on outer turret faces
                for iz in range(8):
                    z = 2.4 + iz * 1.55
                    mb.add_box((tx + sx * 2.12, ty + sy * 2.12, z), (0.56, 0.56, 0.52), "ashlar", tint=(0.97, 0.94, 0.89))
                # High turret lancet embrasures
                add_lancet_window(mb, tx, ty + sy * 2.14, 11.4, yaw_rad=(0.0 if sy < 0 else math.pi), w=0.38, h=1.45)
                add_lancet_window(mb, tx + sx * 2.14, ty, 11.4, yaw_rad=(-math.pi * 0.5 if sx < 0 else math.pi * 0.5), w=0.38, h=1.45)

    # Grand Stepped Ashlar Forebuilding & Iron-Bound Portal on south (-Y) facade
    mb.add_box((0.0, -6.35, 3.65), (4.65, 2.35, 5.85), "rubble", tint=(0.92, 0.90, 0.86), bevel=0.03)
    mb.add_box((0.0, -6.35, 6.68), (4.92, 2.55, 0.28), "ashlar", tint=(0.96, 0.93, 0.88))
    if lod <= 1:
        add_oak_door(mb, 0.0, -7.52, 2.15, w=2.15, h=3.25)
        for i in range(8):
            mb.add_box((0.0, -7.85 - i * 0.36, 2.02 - i * 0.26), (3.15, 0.44, 0.26), "ashlar", tint=(0.94, 0.91, 0.86))
        # Monumental twin Gothic Great Hall lancets on both south & north facades
        for wx in (-3.2, 0.0, 3.2):
            add_lancet_window(mb, wx, -5.58, 9.85, w=0.82, h=2.15)
            add_lancet_window(mb, wx, 5.58, 9.85, yaw_rad=math.pi, w=0.82, h=2.15)
        for wy in (-2.0, 2.0):
            add_lancet_window(mb, -7.18, wy, 9.85, yaw_rad=-math.pi * 0.5, w=0.78, h=2.05)
            add_lancet_window(mb, 7.18, wy, 9.85, yaw_rad=math.pi * 0.5, w=0.78, h=2.05)

    # Massive Citadel Hearth Chimney on north-east flank (`smoke_0` at (4.4, 6.1, 16.5))
    mb.add_box((4.4, 5.95, 8.2), (1.85, 1.55, 16.0), "rubble", taper_top=(0.76, 0.78), tint=(0.86, 0.83, 0.79), bevel=0.03)
    mb.add_box((4.4, 5.95, 16.25), (1.55, 1.35, 0.28), "ashlar", tint=(0.94, 0.91, 0.86))

    if lod == 0:
        # Twin soaring crimson enemy citadel banners flanking grand portal + rooftop standard
        add_banner(mb, -4.6, -5.66, 12.2, length=3.6, width=1.15, tint=(0.56, 0.14, 0.13))
        add_banner(mb, 4.6, -5.66, 12.2, length=3.6, width=1.15, tint=(0.56, 0.14, 0.13))
        mb.add_cylinder((0.0, 0.0, 17.4), (0.0, 0.0, 21.6), 0.09, 0.06, 8, "beam", tint=(0.82, 0.77, 0.70))
        mb.add_box((1.15, 0.0, 20.65), (2.25, 0.06, 1.08), "linen", tint=(0.58, 0.14, 0.13))


def render_buildings_preview():
    """Renders a Cycles daylight showcase of key Stage 5 upgraded & new buildings for visual inspection."""
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 810
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92

    world = bpy.data.worlds.new("BldWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.48, 0.62, 0.80, 1.0)
    bg.inputs["Strength"].default_value = 0.90

    bpy.ops.mesh.primitive_plane_add(size=140.0, location=(0.0, 0.0, 0.0))
    gnd = bpy.context.active_object
    gm = bpy.data.materials.new("GroundMat")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.24, 0.28, 0.16, 1.0)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    gnd.data.materials.append(gm)

    # Neutral Cycles shader reading COLOR_0 vertex AO + warm architectural tint so geometry/silhouette/detail read crystal-clear
    mat = bpy.data.materials.new("PreviewBldMat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.84
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    mix.inputs[6].default_value = (0.74, 0.69, 0.60, 1.0)
    nt.links.new(vcol.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])

    lineup = [
        ("fortress_donzon", 0.0, 18.0, math.radians(16.0)),
        ("chapel_l1", -16.5, 6.0, math.radians(-22.0)),
        ("windmill_l1", -8.0, -5.0, math.radians(-30.0)),
        ("bakery_l1", 1.5, -5.5, math.radians(150.0)),  # show upgraded BACK wall of bakery too!
        ("smithy_l1", 11.5, -4.0, math.radians(24.0)),
        ("barracks_l1", 17.5, 9.0, math.radians(32.0)),
        ("market_l1", -16.0, -9.0, math.radians(-18.0)),
        ("well_l1", -5.5, -13.0, math.radians(0.0)),
        ("camp_tent_l1", 6.0, -13.5, math.radians(18.0)),
        ("ruin_house", 16.5, -13.0, math.radians(-25.0)),
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
    sun_o.rotation_euler = (math.radians(48), math.radians(12), math.radians(-42))

    cam_d = bpy.data.cameras.new("Cam")
    cam_d.lens = 36.0
    cam_o = bpy.data.objects.new("Cam", cam_d)
    bpy.context.collection.objects.link(cam_o)
    scene.camera = cam_o
    cam_o.location = (-2.0, -34.0, 17.5)
    direction = Vector((0.0, 2.0, 3.8)) - cam_o.location
    cam_o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = PREVIEW_JPG
    bpy.ops.render.render(write_still=True)
    print(f"Saved Cycles Stage 5 buildings showcase: {PREVIEW_JPG}")


def main():
    summary = {}
    # Upgraded Stage 4 buildings (360-degree overhaul)
    summary["bakery_l1"] = export_and_optimize("bakery_l1", build_bakery_l1_v2, has_smoke_at=(2.45, 0.2, 6.38))
    summary["windmill_l1"] = export_and_optimize("windmill_l1", build_windmill_body_v2, extra_children_fn=build_windmill_sails)
    summary["farm_l1"] = export_and_optimize("farm_l1", build_farm_l1_v2)
    summary["keep_l1"] = export_and_optimize("keep_l1", build_keep_l1_v2, has_smoke_at=(5.65, 1.3, 9.30))
    summary["watchtower_l1"] = export_and_optimize("watchtower_l1", build_watchtower_l1_v2)

    # 10 Brand-new Stage 5 Village & Campaign Buildings
    summary["chapel_l1"] = export_and_optimize("chapel_l1", build_chapel_l1)
    summary["smithy_l1"] = export_and_optimize("smithy_l1", build_smithy_l1, has_smoke_at=(2.15, 1.35, 6.96))
    summary["barracks_l1"] = export_and_optimize("barracks_l1", build_barracks_l1)
    summary["market_l1"] = export_and_optimize("market_l1", build_market_l1)
    summary["well_l1"] = export_and_optimize("well_l1", build_well_l1)
    summary["storehouse_l1"] = export_and_optimize("storehouse_l1", build_storehouse_l1)
    summary["fisher_l1"] = export_and_optimize("fisher_l1", build_fisher_l1)
    summary["camp_tent_l1"] = export_and_optimize("camp_tent_l1", build_camp_tent_l1)
    summary["ruin_house"] = export_and_optimize("ruin_house", build_ruin_house)
    summary["fortress_donzon"] = export_and_optimize("fortress_donzon", build_fortress_donzon, has_smoke_at=(4.4, 5.95, 16.45))

    render_buildings_preview()
    print("[build_buildings_s5] ALL 15 BUILDINGS DONE:\n", json.dumps(summary, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
