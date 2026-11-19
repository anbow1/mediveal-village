"""
Stage 4 Blender 4.2 medieval village building & fortification kit (CC0 original).
Reuses `MeshBuilder` and Cycles CPU vertex AO baking from `build_house.py` so every building
reads the shared 12-layer KTX2 surface arrays (`UV0` real-world box UVs, `UV1` layer/iron mask,
`COLOR_0` Cycles ground-contact AO + weathering) with ZERO extra embedded textures.

Builds 8 architectural assets (each with lod0, lod1, lod2, and coarse opaque R7 shadow stand-in):
  1. keep_l1        — Lord's timber-and-stone Keep L1 (crenellated tower + great hall + smoke_0)
  2. woodcutter_l1  — Woodcutter's open timber shed, stacked oak logs, chopping block & sawhorse
  3. farm_l1        — Half-timbered peasant barn with thatch roof, hayloft & double doors
  4. windmill_l1    — Post mill on stone trestle with separate rotating `sails` node (8.8 m span)
  5. bakery_l1      — Half-timbered bakeshop with domed stone bread oven & `smoke_0` chimney
  6. watchtower_l1  — 8.6 m battered fieldstone watchtower with timber hoarding & shingle spire
  7. wall_segment   — 2.0 m crenellated stone curtain wall segment with rear timber wall-walk
  8. gate_l1        — 6.4 m arched stone gatehouse with separate `leaf_l` & `leaf_r` oak doors

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_buildings_s4.py
"""

import json
import math
import os
import random
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

RAW_OUT = "/tmp/marchland-src/raw_glb"


def add_pitched_shingle_roof(mb, cx, cy, half_x, half_y, z_eave, z_ridge, layer="shingles", overhang=0.38, thickness=0.16, tint=(0.94, 0.92, 0.89)):
    """Adds a clean pitched two-slope shingle/board roof with bargeboards and ridge cap."""
    span_y = half_y + overhang
    span_x = half_x + overhang
    rise = z_ridge - z_eave
    slope_len = math.hypot(span_y, rise)
    pitch = math.atan2(rise, span_y)
    # Front slope (-Y)
    mb.add_box(
        (cx, cy - span_y * 0.5, z_eave + rise * 0.5 + thickness * 0.4),
        (span_x * 2.0, slope_len, thickness),
        layer,
        rot_euler=(pitch, 0.0, 0.0),
        tint=tint,
        bevel=0.02,
    )
    # Back slope (+Y)
    mb.add_box(
        (cx, cy + span_y * 0.5, z_eave + rise * 0.5 + thickness * 0.4),
        (span_x * 2.0, slope_len, thickness),
        layer,
        rot_euler=(-pitch, 0.0, 0.0),
        tint=tint,
        bevel=0.02,
    )
    # Ridge timber cap
    mb.add_box((cx, cy, z_ridge + thickness * 0.6), (span_x * 2.0 + 0.06, 0.24, 0.18), "beam", tint=(0.82, 0.78, 0.73), bevel=0.02)
    # Gable filler triangles (front/back slopes closed at ends)
    mb.add_box((cx - half_x, cy, z_eave + rise * 0.38), (0.28, half_y * 1.45, rise * 0.78), "plaster", taper_top=(1.0, 0.12), tint=(0.98, 0.96, 0.91))
    mb.add_box((cx + half_x, cy, z_eave + rise * 0.38), (0.28, half_y * 1.45, rise * 0.78), "plaster", taper_top=(1.0, 0.12), tint=(0.98, 0.96, 0.91))


def add_pyramidal_cap(mb, cx, cy, half_w, z_base, z_tip, layer="shingles", tint=(0.90, 0.89, 0.86)):
    """Adds a 4-sided pyramidal medieval spire/tower cap."""
    mb.add_box(
        (cx, cy, (z_base + z_tip) * 0.5),
        (half_w * 2.0, half_w * 2.0, z_tip - z_base),
        layer,
        taper_top=(0.06, 0.06),
        tint=tint,
        bevel=0.02,
    )
    mb.add_cylinder((cx, cy, z_tip - 0.05), (cx, cy, z_tip + 0.55), 0.06, 0.02, 6, "beam", metal=0.9, tint=(0.35, 0.35, 0.37))


def add_window(mb, cx, cy, cz, yaw_rad=0.0, w=0.92, h=1.02, shutters=True):
    """Adds a recessed medieval timber window with mullion cross and optional oak shutters."""
    ca, sa = math.cos(yaw_rad), math.sin(yaw_rad)

    def xform(lx, ly, lz):
        return (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, cz + lz)

    # Dark recessed interior pane
    mb.add_box(xform(0, -0.02, 0), (w, 0.08, h), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.24, 0.20, 0.18))
    # Frame sill, header, jambs, mullions
    mb.add_box(xform(0, -0.07, -h * 0.5), (w + 0.18, 0.16, 0.09), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.86, 0.81, 0.74))
    mb.add_box(xform(0, -0.06, h * 0.5), (w + 0.16, 0.14, 0.09), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.84, 0.80, 0.74))
    for sx in (-w * 0.5, w * 0.5):
        mb.add_box(xform(sx, -0.05, 0), (0.09, 0.12, h), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.84, 0.80, 0.74))
    mb.add_box(xform(0, -0.04, 0), (0.05, 0.07, h), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.78, 0.74, 0.68))
    mb.add_box(xform(0, -0.04, 0.08), (w, 0.07, 0.05), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.78, 0.74, 0.68))
    if shutters:
        sw = w * 0.46
        for side in (-1.0, 1.0):
            mb.add_box(
                xform(side * (w * 0.5 + sw * 0.5 + 0.03), -0.07, 0),
                (sw, 0.05, h * 0.96),
                "boards",
                rot_euler=(0, 0, yaw_rad),
                tint=(0.92, 0.87, 0.80),
                bevel=0.008,
            )
            mb.add_box(
                xform(side * (w * 0.5 + sw * 0.3), -0.10, 0.22),
                (sw * 0.65, 0.02, 0.045),
                "beam",
                rot_euler=(0, 0, yaw_rad),
                metal=1.0,
                tint=(0.35, 0.35, 0.37),
            )


def add_oak_door(mb, cx, cy, z0, w=1.18, h=2.05, yaw_rad=0.0):
    """Adds a heavy oak plank medieval doorway with forged iron strap hinges and stone step."""
    ca, sa = math.cos(yaw_rad), math.sin(yaw_rad)

    def xform(lx, ly, lz):
        return (cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, z0 + lz)

    mb.add_box(xform(0, -0.02, h * 0.5), (w, 0.12, h), "boards", rot_euler=(0, 0, yaw_rad), tint=(0.82, 0.76, 0.68), bevel=0.01)
    mb.add_box(xform(0, -0.06, h + 0.06), (w + 0.28, 0.20, 0.14), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.84, 0.80, 0.74))
    for sx in (-w * 0.5 - 0.06, w * 0.5 + 0.06):
        mb.add_box(xform(sx, -0.06, h * 0.5), (0.14, 0.18, h + 0.12), "beam", rot_euler=(0, 0, yaw_rad), tint=(0.84, 0.80, 0.74))
    for hz in (0.45, h - 0.45):
        mb.add_box(xform(-w * 0.15, -0.09, hz), (w * 0.68, 0.025, 0.065), "beam", rot_euler=(0, 0, yaw_rad), metal=1.0, tint=(0.32, 0.32, 0.34))
    mb.add_box(xform(w * 0.35, -0.10, h * 0.48), (0.07, 0.07, 0.18), "beam", rot_euler=(0, 0, yaw_rad), metal=1.0, tint=(0.30, 0.30, 0.32))
    mb.add_box(xform(0, -0.42, 0.10), (w + 0.52, 0.78, 0.22), "ashlar", rot_euler=(0, 0, yaw_rad), tint=(0.94, 0.91, 0.86), bevel=0.02)


def export_building(name, build_fn, has_smoke_at=None, extra_children_fn=None):
    """Exports lod0, lod1, lod2, and coarse opaque shadow stand-in for a Stage 4 building."""
    summary = {}
    for lod, suffix in [(0, "lod0"), (1, "lod1"), (2, "lod2"), (3, "shadow")]:
        clear_scene()
        objs = []
        mb = MeshBuilder()
        build_fn(mb, lod)
        main_obj = mb.finalize_object(f"{name}_{suffix}")
        if lod < 3:
            bake_cycles_vertex_ao(main_obj, samples=16 if lod == 0 else 8)
        objs.append(main_obj)

        if extra_children_fn is not None and lod < 3:
            children = extra_children_fn(lod)
            for child_obj in children:
                bake_cycles_vertex_ao(child_obj, samples=12 if lod == 0 else 6)
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

        out_path = os.path.join(RAW_OUT, f"{name}_{suffix}.glb")
        bpy.ops.export_scene.gltf(
            filepath=out_path,
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
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == "MESH")
        summary[suffix] = {"tris": tris, "bytes": os.path.getsize(out_path)}
        print(f"[{name}] {suffix}: {tris} tris -> {out_path} ({os.path.getsize(out_path)//1024} KiB)")
    return summary


# ==================== 1. KEEP L1 ====================
def build_keep_l1(mb, lod):
    # Sunk stone foundation skirt (-0.55..0.95 m) handles subtle terrain slopes cleanly
    mb.add_box((0.0, 0.0, 0.20), (11.8, 9.6, 1.50), "rubble", taper_top=(0.98, 0.98), tint=(0.92, 0.90, 0.87), bevel=0.03)
    if lod == 3:
        mb.add_box((-2.8, -0.4, 4.6), (4.6, 4.6, 8.2), "rubble")
        mb.add_box((2.1, 0.0, 3.3), (6.4, 7.4, 5.2), "plaster")
        mb.add_box((2.1, 0.0, 6.8), (6.8, 7.8, 2.6), "shingles", taper_top=(1.0, 0.15))
        return

    # Stone Keep Tower on west side (-3.1, -0.2)
    tx, ty = -3.1, -0.2
    mb.add_box((tx, ty, 4.4), (4.7, 4.7, 7.6), "rubble", taper_top=(0.93, 0.93), tint=(0.93, 0.91, 0.88), bevel=0.04)
    # Dressed ashlar corner quoins & parapet belt
    if lod <= 1:
        for sx in (-1, 1):
            for sy in (-1, 1):
                for iz in range(0, 7):
                    z = 1.15 + iz * 0.95
                    mb.add_box((tx + sx * 2.26, ty + sy * 2.26, z), (0.48, 0.48, 0.42), "ashlar", tint=(0.98, 0.95, 0.90), bevel=0.015)
    # Crenellated fighting battlement & cantilevered hoarding
    mb.add_box((tx, ty, 8.32), (5.05, 5.05, 0.34), "ashlar", tint=(0.95, 0.92, 0.88), bevel=0.02)
    for sx in (-2.25, -0.75, 0.75, 2.25):
        for sy in (-2.25, 2.25):
            mb.add_box((tx + sx, ty + sy, 8.88), (0.82, 0.44, 0.86), "ashlar", tint=(0.94, 0.91, 0.87), bevel=0.015)
    for sy in (-0.75, 0.75):
        for sx in (-2.25, 2.25):
            mb.add_box((tx + sx, ty + sy, 8.88), (0.44, 0.82, 0.86), "ashlar", tint=(0.94, 0.91, 0.87), bevel=0.015)
    # Steep inner shingle turret roof + tall lord's banner pole
    add_pyramidal_cap(mb, tx, ty, 2.05, 8.65, 11.4, "shingles", tint=(0.88, 0.86, 0.84))
    if lod == 0:
        mb.add_cylinder((tx + 1.9, ty - 1.9, 8.6), (tx + 1.9, ty - 1.9, 12.6), 0.06, 0.04, 6, "beam", tint=(0.84, 0.80, 0.74))
        mb.add_box((tx + 2.65, ty - 1.9, 11.95), (1.45, 0.05, 0.76), "linen", tint=(0.18, 0.32, 0.62))

    # Adjoining Two-Storey Half-Timbered Great Hall on east side (+2.2, 0.1)
    hx, hy = 2.2, 0.1
    mb.add_box((hx, hy, 2.2), (6.2, 7.6, 2.7), "rubble", tint=(0.90, 0.88, 0.85), bevel=0.02)
    mb.add_box((hx, hy, 4.55), (6.5, 7.9, 2.15), "plaster", tint=(1.0, 0.98, 0.93), bevel=0.02)
    # Jetty timber beam framing on hall upper floor
    if lod <= 1:
        for z in (3.5, 5.55):
            mb.add_box((hx, hy - 3.96, z), (6.65, 0.22, 0.20), "beam", tint=(0.82, 0.78, 0.73))
            mb.add_box((hx, hy + 3.96, z), (6.65, 0.22, 0.20), "beam", tint=(0.82, 0.78, 0.73))
            mb.add_box((hx + 3.26, hy, z), (0.22, 8.05, 0.20), "beam", tint=(0.82, 0.78, 0.73))
        for px in (-2.9, -1.0, 1.0, 2.9):
            mb.add_box((hx + px, hy - 3.96, 4.52), (0.20, 0.22, 2.18), "beam", tint=(0.82, 0.78, 0.73))
            mb.add_box((hx + px, hy + 3.96, 4.52), (0.20, 0.22, 2.18), "beam", tint=(0.82, 0.78, 0.73))
        # Diagonal oak St Andrew braces
        mb.add_beam((hx - 2.9, hy - 3.97, 3.55), (hx - 1.0, hy - 3.97, 5.50), 0.14, 0.14, "beam")
        mb.add_beam((hx + 2.9, hy - 3.97, 3.55), (hx + 1.0, hy - 3.97, 5.50), 0.14, 0.14, "beam")

    # Great Hall steep shingle roof
    add_pitched_shingle_roof(mb, hx, hy, 3.32, 4.02, 5.55, 8.65, "shingles", overhang=0.45, thickness=0.20)
    # Stone chimney on north-east wall
    mb.add_box((hx + 3.45, hy + 1.2, 4.8), (1.15, 1.45, 8.2), "rubble", taper_top=(0.76, 0.78), tint=(0.88, 0.85, 0.81), bevel=0.03)
    mb.add_box((hx + 3.45, hy + 1.2, 9.0), (0.98, 1.24, 0.24), "ashlar", tint=(0.94, 0.90, 0.85))

    # Front grand studded oak entry door & windows
    if lod <= 1:
        add_oak_door(mb, hx - 0.1, hy - 3.82, 0.92, w=1.55, h=2.32)
        add_window(mb, hx - 1.9, hy - 3.96, 4.55, shutters=(lod == 0))
        add_window(mb, hx + 1.9, hy - 3.96, 4.55, shutters=(lod == 0))
        add_window(mb, tx, ty - 2.28, 5.65, w=0.62, h=1.18, shutters=False)
        # Front courtyard wooden stairs up to keep plinth
        for i in range(4):
            mb.add_box((hx - 0.1, hy - 4.75 - i * 0.34, 0.82 - i * 0.22), (2.4, 0.42, 0.22), "ashlar", tint=(0.93, 0.90, 0.85))
    # Flanking timber palisade wings (LOD0)
    if lod == 0:
        for side_x in (-6.1, 5.8):
            for k in range(5):
                py = -4.2 + k * 0.42
                mb.add_cylinder((side_x, py, -0.35), (side_x, py, 2.25 + (k % 2) * 0.14), 0.14, 0.08, 6, "bark", tint=(0.84, 0.79, 0.72))


# ==================== 2. WOODCUTTER'S LODGE L1 ====================
def build_woodcutter_l1(mb, lod):
    rng = random.Random(402)
    mb.add_box((0.0, 0.0, -0.05), (6.4, 4.6, 0.72), "rubble", tint=(0.88, 0.85, 0.80), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.4, 1.5), (5.8, 3.6, 2.8), "boards")
        return

    # Open-front timber frame lean-to shed
    posts = [(-2.6, -1.3, 2.35), (0.0, -1.3, 2.35), (2.6, -1.3, 2.35), (-2.6, 1.7, 3.15), (0.0, 1.7, 3.15), (2.6, 1.7, 3.15)]
    for px, py, pz in posts:
        mb.add_beam((px, py, -0.3), (px, py, pz), 0.19, 0.19, "beam", tint=(0.82, 0.77, 0.70))
    # Back & west plank enclosure walls
    mb.add_box((0.0, 1.72, 1.65), (5.4, 0.14, 2.85), "boards", tint=(0.86, 0.81, 0.74))
    mb.add_box((-2.62, 0.2, 1.45), (0.14, 3.1, 2.45), "boards", tint=(0.86, 0.81, 0.74))
    # Sloped rough timber-plank lean-to roof
    mb.add_box((0.0, 0.2, 2.85), (6.2, 4.1, 0.18), "boards", rot_euler=(-0.26, 0.0, 0.0), tint=(0.84, 0.79, 0.72), bevel=0.02)
    if lod <= 1:
        mb.add_beam((-2.6, -1.3, 2.35), (2.6, -1.3, 2.35), 0.16, 0.16, "beam")
        mb.add_beam((-2.6, 1.7, 3.15), (2.6, 1.7, 3.15), 0.16, 0.16, "beam")
        # Stacked felled oak trunks tucked inside the shed
        for row in range(3):
            cols = 4 - row
            for col in range(cols):
                ly = 0.25 + (col + row * 0.5) * 0.34
                lz = 0.52 + row * 0.28
                mb.add_cylinder((-2.2, ly, lz), (1.35, ly, lz), 0.16, 0.15, 7, "bark", tint=(0.86, 0.81, 0.73))
    if lod == 0:
        # Chopping block in front yard + forged iron axe head + sawhorse
        mb.add_cylinder((1.8, -2.05, -0.1), (1.8, -2.05, 0.76), 0.34, 0.31, 10, "bark", tint=(0.88, 0.82, 0.74))
        mb.add_beam((1.82, -2.05, 0.78), (2.25, -2.18, 1.32), 0.05, 0.05, "boards", tint=(0.90, 0.84, 0.74))
        mb.add_box((1.80, -2.05, 0.84), (0.20, 0.04, 0.16), "beam", rot_euler=(0.0, 0.45, 0.2), metal=1.0, tint=(0.45, 0.45, 0.48))
        # Sawhorse trestle & log
        for sx in (-1.6, -0.5):
            mb.add_beam((sx, -2.4, -0.05), (sx, -1.9, 0.82), 0.09, 0.09, "beam")
            mb.add_beam((sx, -1.6, -0.05), (sx, -2.1, 0.82), 0.09, 0.09, "beam")
        mb.add_cylinder((-2.1, -2.0, 0.86), (0.1, -2.0, 0.86), 0.14, 0.13, 7, "bark", tint=(0.85, 0.80, 0.72))
        for _ in range(5):
            lx = rng.uniform(0.3, 1.2)
            ly = rng.uniform(-2.6, -1.7)
            mb.add_cylinder((lx, ly, 0.08), (lx + 0.55, ly + rng.uniform(-0.15, 0.15), 0.08), 0.07, 0.06, 6, "boards", tint=(0.94, 0.86, 0.72))


# ==================== 3. FARM L1 ====================
def build_farm_l1(mb, lod):
    mb.add_box((0.0, 0.0, 0.08), (8.2, 5.6, 1.10), "rubble", tint=(0.91, 0.88, 0.83), bevel=0.03)
    if lod == 3:
        mb.add_box((0.0, 0.0, 1.8), (7.8, 5.2, 2.6), "plaster")
        mb.add_box((0.0, 0.0, 4.3), (8.4, 5.8, 2.6), "thatch", taper_top=(1.0, 0.12))
        return

    mb.add_box((0.0, 0.0, 1.95), (7.8, 5.2, 2.65), "plaster", tint=(0.99, 0.96, 0.91), bevel=0.02)
    mb.add_gable_prism(3.9, 2.6, 3.25, 5.45, "boards", tint=(0.88, 0.83, 0.75))
    mb.add_thatch_roof(4.35, 3.15, 3.02, 5.58, thickness=0.38, x_segs=10 if lod == 0 else 5, detail=(lod == 0))
    if lod <= 1:
        for x in (-3.92, -1.8, 1.8, 3.92):
            mb.add_box((x, -2.62, 1.95), (0.19, 0.18, 2.75), "beam", tint=(0.82, 0.77, 0.71))
            mb.add_box((x, 2.62, 1.95), (0.19, 0.18, 2.75), "beam", tint=(0.82, 0.77, 0.71))
        mb.add_box((0.0, -2.62, 3.22), (8.0, 0.20, 0.18), "beam", tint=(0.82, 0.77, 0.71))
        # Wide double barn doors (slightly ajar look via recessed dark center seam)
        add_oak_door(mb, -0.78, -2.60, 0.62, w=1.42, h=2.36)
        add_oak_door(mb, 0.78, -2.60, 0.62, w=1.42, h=2.36)
        add_window(mb, -2.85, -2.62, 2.1, w=0.85, h=0.85, shutters=(lod == 0))
        add_window(mb, 2.85, -2.62, 2.1, w=0.85, h=0.85, shutters=(lod == 0))
    if lod == 0:
        # Grain sacks stacked beside barn porch
        for sx, sy, sz in [(2.6, -3.15, 0.36), (3.15, -3.05, 0.36), (2.88, -3.12, 0.86)]:
            mb.add_box((sx, sy, sz), (0.54, 0.44, 0.68), "linen", taper_top=(0.75, 0.75), tint=(0.94, 0.88, 0.74), bevel=0.08)


# ==================== 4. WINDMILL L1 (with rotating `sails` child!) ====================
def build_windmill_body(mb, lod):
    # Stepped octagonal/square fieldstone trestle plinth (sunk -0.5 m)
    mb.add_box((0.0, 0.0, 0.45), (4.8, 4.8, 1.90), "rubble", taper_top=(0.82, 0.82), tint=(0.92, 0.89, 0.85), bevel=0.04)
    if lod == 3:
        mb.add_box((0.0, 0.0, 4.8), (3.6, 4.2, 6.8), "boards")
        return

    # Heavy oak pivot post & 4 diagonal trestle quarter-bars
    mb.add_cylinder((0.0, 0.0, 1.2), (0.0, 0.0, 4.4), 0.42, 0.36, 8, "beam", tint=(0.82, 0.77, 0.70))
    for sx in (-1.65, 1.65):
        for sy in (-1.65, 1.65):
            mb.add_beam((sx, sy, 1.30), (0.0, 0.0, 3.85), 0.22, 0.22, "beam", tint=(0.80, 0.75, 0.68))

    # Elevated timber post-mill house (3.3..8.3 m)
    mb.add_box((0.0, 0.15, 5.75), (3.75, 4.35, 4.85), "boards", tint=(0.89, 0.84, 0.76), bevel=0.03)
    if lod <= 1:
        for sx in (-1.88, 1.88):
            for sy in (-2.02, 2.32):
                mb.add_box((sx, sy, 5.75), (0.20, 0.20, 4.95), "beam", tint=(0.80, 0.75, 0.68))
        mb.add_box((0.0, 0.15, 3.40), (4.0, 4.6, 0.22), "beam", tint=(0.78, 0.74, 0.68))
        # Rear timber ladder & tail-pole turning beam
        mb.add_beam((0.0, 2.25, 3.85), (0.0, 5.25, 0.45), 0.16, 0.16, "beam", tint=(0.82, 0.77, 0.70))
        for side_x in (-0.52, 0.52):
            mb.add_beam((side_x, 2.35, 3.75), (side_x, 4.55, 0.0), 0.10, 0.14, "beam", tint=(0.82, 0.77, 0.70))
        if lod == 0:
            for step in range(9):
                t = (step + 0.5) / 9.0
                mb.add_box((0.0, 2.35 + t * 2.2, 3.75 * (1 - t)), (1.05, 0.24, 0.07), "boards", tint=(0.88, 0.83, 0.75))
            add_window(mb, 1.90, 0.2, 6.2, yaw_rad=math.pi * 0.5, w=0.72, h=0.82, shutters=False)
            add_window(mb, -1.90, 0.2, 6.2, yaw_rad=-math.pi * 0.5, w=0.72, h=0.82, shutters=False)

    # Steep shingled cap roof (8.15..10.95 m) + front windshaft hub housing
    add_pitched_shingle_roof(mb, 0.0, 0.15, 1.95, 2.25, 8.10, 10.65, "shingles", overhang=0.35, thickness=0.16)
    mb.add_cylinder((0.0, -1.75, 6.95), (0.0, -2.55, 6.95), 0.28, 0.24, 10, "beam", tint=(0.78, 0.73, 0.66))


def build_windmill_sails(lod):
    """Builds the rotating `sails` child mesh centered cleanly on the windshaft pivot (0, -2.52, 6.95)."""
    mb = MeshBuilder()
    # Central iron-bound wooden poll-end hub
    mb.add_box((0.0, 0.0, 0.0), (0.44, 0.44, 0.44), "beam", tint=(0.75, 0.70, 0.64), bevel=0.03)
    mb.add_box((0.0, -0.05, 0.0), (0.50, 0.12, 0.50), "beam", metal=1.0, tint=(0.32, 0.32, 0.35))
    # 4 arms radiating in XZ plane (Blender Y is forward toward viewer; sails spin around local Y!)
    for idx in range(4):
        ang = idx * (math.pi * 0.5) + 0.35
        ca, sa = math.cos(ang), math.sin(ang)
        # Main oak whip/stock (4.35 m long)
        p1 = (ca * 4.35, 0.0, sa * 4.35)
        mb.add_beam((0.0, 0.0, 0.0), p1, 0.13, 0.16, "beam", tint=(0.82, 0.77, 0.70), wobble=0.0)
        # Linen sailcloth panel offset slightly to trailing side of stock (1.05..4.25 m)
        sx, sz = -sa, ca  # perpendicular in XZ
        cx = ca * 2.68 + sx * 0.48
        cz = sa * 2.68 + sz * 0.48
        mb.add_box(
            (cx, -0.04, cz),
            (3.22, 0.045, 0.92),
            "linen",
            rot_euler=(0.14, -ang, 0.0),
            tint=(0.95, 0.91, 0.82),
        )
        # Lattice cross-bars on LOD0/1
        if lod <= 1:
            for r in (1.2, 1.95, 2.7, 3.45, 4.15):
                b0 = (ca * r - sx * 0.10, -0.02, sa * r - sz * 0.10)
                b1 = (ca * r + sx * 0.98, -0.06, sa * r + sz * 0.98)
                mb.add_beam(b0, b1, 0.055, 0.055, "boards", tint=(0.86, 0.81, 0.73), wobble=0.0)
    sails_obj = mb.finalize_object("sails")
    sails_obj.location = Vector((0.0, -2.52, 6.95))
    return [sails_obj]


# ==================== 5. BAKERY L1 (with domed oven & `smoke_0`) ====================
def build_bakery_l1(mb, lod):
    mb.add_box((0.0, 0.0, 0.08), (7.6, 5.2, 1.05), "rubble", tint=(0.91, 0.88, 0.84), bevel=0.03)
    if lod == 3:
        mb.add_box((-0.6, 0.0, 2.1), (6.0, 4.6, 3.2), "plaster")
        mb.add_box((-0.6, 0.0, 4.6), (6.4, 5.0, 2.2), "shingles", taper_top=(1.0, 0.15))
        mb.add_box((3.0, 0.2, 1.8), (2.2, 2.4, 3.0), "rubble")
        return

    # Main half-timbered bakeshop body
    mb.add_box((-0.7, 0.0, 1.82), (5.6, 4.5, 2.55), "plaster", tint=(0.99, 0.96, 0.90), bevel=0.02)
    add_pitched_shingle_roof(mb, -0.7, 0.0, 2.86, 2.30, 3.05, 5.15, "shingles", overhang=0.38, thickness=0.16)
    if lod <= 1:
        for x in (-3.52, -1.65, 0.25, 2.12):
            mb.add_box((x, -2.26, 1.82), (0.17, 0.17, 2.60), "beam", tint=(0.82, 0.77, 0.71))
        mb.add_box((-0.7, -2.26, 3.04), (5.8, 0.18, 0.18), "beam")
        add_oak_door(mb, -2.0, -2.24, 0.58, w=1.08, h=1.98)
        add_window(mb, 0.65, -2.26, 1.95, w=1.18, h=0.95, shutters=(lod == 0))
        # Bread stall counter & wooden awning in front of bakery window
        mb.add_box((0.65, -2.72, 0.95), (1.85, 0.72, 0.12), "boards", tint=(0.90, 0.84, 0.74), bevel=0.015)
        for lx in (-0.75, 0.75):
            mb.add_beam((0.65 + lx, -2.98, 0.0), (0.65 + lx, -2.98, 2.38), 0.10, 0.10, "beam")
        mb.add_box((0.65, -2.75, 2.50), (2.15, 1.15, 0.09), "boards", rot_euler=(0.24, 0.0, 0.0), tint=(0.88, 0.82, 0.74))

    # Projecting domed fieldstone bread oven & tall baking chimney on east side (+2.75, 0.2)
    mb.add_box((2.75, 0.2, 0.95), (2.15, 2.45, 1.90), "rubble", tint=(0.90, 0.87, 0.82), bevel=0.04)
    # Domed beehive oven vault (layered tapered stone cylinders)
    mb.add_cylinder((2.85, 0.2, 1.85), (2.85, 0.2, 2.75), 1.05, 0.78, 12 if lod == 0 else 8, "rubble", tint=(0.88, 0.84, 0.79))
    mb.add_cylinder((2.85, 0.2, 2.72), (2.85, 0.2, 3.22), 0.78, 0.34, 10 if lod == 0 else 6, "rubble", tint=(0.86, 0.82, 0.77))
    # Tall chimney rising cleanly to smoke_0 at (2.45, 0.2, 6.25)
    mb.add_box((2.45, 0.2, 3.4), (0.98, 1.02, 5.5), "rubble", taper_top=(0.74, 0.74), tint=(0.84, 0.80, 0.76), bevel=0.03)
    mb.add_box((2.45, 0.2, 6.18), (0.86, 0.90, 0.20), "ashlar", tint=(0.92, 0.88, 0.84))
    if lod == 0:
        # Stacked flour sacks beside bread stall
        for sx, sy in [(2.15, -2.55), (2.68, -2.42)]:
            mb.add_box((sx, sy, 0.38), (0.50, 0.42, 0.68), "linen", taper_top=(0.76, 0.76), tint=(0.95, 0.90, 0.78), bevel=0.07)


# ==================== 6. WATCHTOWER L1 ====================
def build_watchtower_l1(mb, lod):
    # Battered stone tower shaft (sunk -0.55 m .. 6.8 m)
    mb.add_box((0.0, 0.0, 3.15), (4.35, 4.35, 7.4), "rubble", taper_top=(0.86, 0.86), tint=(0.92, 0.89, 0.85), bevel=0.04)
    if lod == 3:
        mb.add_box((0.0, 0.0, 7.6), (4.6, 4.6, 2.2), "boards")
        mb.add_box((0.0, 0.0, 9.6), (4.6, 4.6, 2.0), "shingles", taper_top=(0.1, 0.1))
        return

    # Dressed ashlar quoins on tower corners
    if lod <= 1:
        for sx in (-1, 1):
            for sy in (-1, 1):
                for iz in range(6):
                    z = 0.6 + iz * 1.05
                    w_off = 2.08 - iz * 0.05
                    mb.add_box((sx * w_off, sy * w_off, z), (0.44, 0.44, 0.46), "ashlar", tint=(0.97, 0.94, 0.89), bevel=0.015)
        add_oak_door(mb, 0.0, -2.14, 0.10, w=1.05, h=1.95)
    # Stone string-course + timber corbels + cantilevered wooden fighting hoarding (6.8..8.6 m)
    mb.add_box((0.0, 0.0, 6.85), (4.15, 4.15, 0.28), "ashlar", tint=(0.95, 0.92, 0.87), bevel=0.02)
    mb.add_box((0.0, 0.0, 7.82), (4.65, 4.65, 1.72), "boards", tint=(0.87, 0.82, 0.74), bevel=0.02)
    if lod <= 1:
        for side in (-1.5, -0.5, 0.5, 1.5):
            for s in (-1, 1):
                mb.add_box((side, s * 2.05, 6.72), (0.18, 0.65, 0.22), "beam", tint=(0.80, 0.75, 0.69))
                mb.add_box((s * 2.05, side, 6.72), (0.65, 0.18, 0.22), "beam", tint=(0.80, 0.75, 0.69))
        # Open defensive shuttered embrasures around top fighting deck
        for s in (-1, 1):
            mb.add_box((0.0, s * 2.35, 8.20), (3.6, 0.12, 0.42), "beam", tint=(0.24, 0.20, 0.18))
            mb.add_box((s * 2.35, 0.0, 8.20), (0.12, 3.6, 0.42), "beam", tint=(0.24, 0.20, 0.18))
    # Pyramidal shingle cap roof (8.65..10.95 m)
    add_pyramidal_cap(mb, 0.0, 0.0, 2.62, 8.65, 10.95, "shingles", tint=(0.89, 0.87, 0.84))


# ==================== 7. CURTAIN WALL SEGMENT (2.0 m wide) ====================
def build_wall_segment(mb, lod):
    # Sunk -0.65 m so sloped walls never show air gaps
    mb.add_box((0.0, 0.0, 1.45), (2.06, 1.38, 4.20), "rubble", taper_top=(1.0, 0.88), tint=(0.92, 0.90, 0.86), bevel=0.02)
    if lod == 3:
        mb.add_box((0.0, -0.45, 4.05), (2.06, 0.45, 1.05), "ashlar")
        return
    # Ashlar coping + front stone parapet merlons + timber wall-walk on rear (+Y)
    mb.add_box((0.0, 0.0, 3.62), (2.08, 1.34, 0.20), "ashlar", tint=(0.96, 0.93, 0.88), bevel=0.015)
    mb.add_box((0.0, -0.48, 4.18), (1.16, 0.40, 0.94), "ashlar", tint=(0.95, 0.92, 0.87), bevel=0.02)
    if lod <= 1:
        mb.add_box((0.0, 0.42, 3.45), (2.04, 0.88, 0.14), "boards", tint=(0.86, 0.81, 0.74))
        mb.add_box((0.0, 0.80, 3.92), (2.04, 0.10, 0.12), "beam", tint=(0.82, 0.77, 0.70))
        mb.add_beam((-0.85, 0.78, 3.42), (-0.85, 0.78, 4.05), 0.10, 0.10, "beam")
        mb.add_beam((0.85, 0.78, 3.42), (0.85, 0.78, 4.05), 0.10, 0.10, "beam")


# ==================== 8. GATE L1 (with twin `leaf_l` & `leaf_r` doors!) ====================
def build_gate_body(mb, lod):
    # Flanking heavy stone gate-piers (leave 3.6 m central road arch open!)
    for sx in (-2.55, 2.55):
        mb.add_box((sx, 0.0, 2.55), (1.75, 3.10, 6.35), "rubble", taper_top=(0.94, 0.95), tint=(0.92, 0.89, 0.85), bevel=0.04)
        if lod <= 1:
            mb.add_box((sx, 0.0, 5.82), (1.92, 3.25, 0.26), "ashlar", tint=(0.96, 0.93, 0.88), bevel=0.02)
            for sy in (-1.35, 1.35):
                mb.add_box((sx, sy, 6.35), (1.45, 0.44, 0.84), "ashlar", tint=(0.95, 0.92, 0.87), bevel=0.02)
    # Stone arch bridge lintel spanning x: [-1.75..+1.75], z: 3.45..5.65 m
    mb.add_box((0.0, 0.0, 4.55), (3.75, 2.85, 2.20), "rubble", tint=(0.92, 0.89, 0.85), bevel=0.03)
    if lod <= 1:
        # Dressed ashlar arch voussoir blocks & portcullis groove
        for sx in (-1.58, 1.58):
            mb.add_box((sx, -1.44, 1.85), (0.32, 0.26, 3.45), "ashlar", tint=(0.97, 0.94, 0.89), bevel=0.015)
        mb.add_box((0.0, -1.44, 3.55), (3.65, 0.28, 0.42), "ashlar", tint=(0.97, 0.94, 0.89), bevel=0.02)
        mb.add_box((0.0, 0.0, 5.75), (3.75, 2.98, 0.24), "ashlar", tint=(0.95, 0.92, 0.87))
        for mx in (-1.1, 0.0, 1.1):
            mb.add_box((mx, -1.25, 6.28), (0.76, 0.42, 0.82), "ashlar", tint=(0.95, 0.92, 0.87), bevel=0.02)
        # Raised iron-tipped wooden portcullis teeth peeking under the arch
        if lod == 0:
            for px in (-1.3, -0.65, 0.0, 0.65, 1.3):
                mb.add_box((px, -1.05, 3.30), (0.10, 0.10, 0.65), "beam", metal=0.8, tint=(0.38, 0.36, 0.36))


def build_gate_leaves(lod):
    """Builds separate `leaf_l` and `leaf_r` heavy oak-plank gate doors pivoted cleanly at jambs."""
    out = []
    for name, hinge_x, sign in [("leaf_l", -1.68, 1.0), ("leaf_r", 1.68, -1.0)]:
        mb = MeshBuilder()
        w = 1.66
        cx = sign * (w * 0.5)
        mb.add_box((cx, 0.0, 1.70), (w, 0.18, 3.40), "boards", tint=(0.82, 0.76, 0.68), bevel=0.015)
        if lod <= 1:
            for hz in (0.65, 1.70, 2.75):
                mb.add_box((cx, -0.10, hz), (w * 0.86, 0.04, 0.12), "beam", metal=1.0, tint=(0.30, 0.30, 0.32))
                mb.add_box((cx, 0.10, hz), (w * 0.88, 0.08, 0.16), "beam", tint=(0.78, 0.74, 0.68))
        leaf = mb.finalize_object(name)
        leaf.location = Vector((hinge_x, -0.45, 0.0))
        out.append(leaf)
    return out


def main():
    os.makedirs(RAW_OUT, exist_ok=True)
    all_stats = {}
    all_stats["keep_l1"] = export_building("keep_l1", build_keep_l1, has_smoke_at=(5.65, 1.3, 9.25))
    all_stats["woodcutter_l1"] = export_building("woodcutter_l1", build_woodcutter_l1)
    all_stats["farm_l1"] = export_building("farm_l1", build_farm_l1)
    all_stats["windmill_l1"] = export_building("windmill_l1", build_windmill_body, extra_children_fn=build_windmill_sails)
    all_stats["bakery_l1"] = export_building("bakery_l1", build_bakery_l1, has_smoke_at=(2.45, 0.2, 6.32))
    all_stats["watchtower_l1"] = export_building("watchtower_l1", build_watchtower_l1)
    all_stats["wall_segment"] = export_building("wall_segment", build_wall_segment)
    all_stats["gate_l1"] = export_building("gate_l1", build_gate_body, extra_children_fn=build_gate_leaves)

    print("[build_buildings_s4] ALL DONE:", json.dumps(all_stats, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
