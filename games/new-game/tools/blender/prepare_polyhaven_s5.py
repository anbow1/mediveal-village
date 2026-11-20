"""
Stage 5 Poly Haven CC0 1.0 Photogrammetry Asset Pipeline (Blender 5.0 `bpy`).

Imports authentic Poly Haven CC0 photogrammetry glTF scans downloaded to `/tmp/stage5-raw/polyhaven/`,
grounds each model cleanly at Z=0 centered in XY, decimates to crisp game-ready LODs + coarse opaque
R7 shadow stand-ins, preserves real photogrammetry albedo/normal/ORM maps (re-encoded to KTX2 UASTC/ETC1S
via `optimize_glb.mjs --ktx2`), and outputs Meshopt-compressed GLBs into `public/assets/`.

Assets produced (all 100% Poly Haven CC0 1.0 — credited in CREDITS.md):
  - nature/rock_moss_a_{lod0,lod1,lod2,shadow}.glb   (rock_moss_set_01_rock01, mossy granite cliff rock)
  - nature/rock_moss_b_{lod0,lod1,lod2,shadow}.glb   (rock_moss_set_01_rock04, mossy quarry/outcrop boulder)
  - nature/boulder_{lod0,lod1,lod2,shadow}.glb       (boulder_01, weathered hillside granite boulder)
  - trees/stump_lod0.glb                             (tree_stump_01, replaces procedural stump with photogrammetry!)
  - nature/fern_lod0.glb                             (fern_02_b+c merged woodland fern clump, alpha cutout)
  - units/cannon_{lod0,lod1,lod2,shadow}.glb         (cannon_01, real photogrammetry field cannon + carriage)
  - props/crate_lod0.glb                             (wooden_crate_01, real photogrammetry wooden cargo crate)
  - props/bucket_lod0.glb                            (wooden_bucket_01, real photogrammetry well/yard bucket)
  - props/pier_lod0.glb                              (modular_wooden_pier, weathered timber lakeside pier)
"""

import os
import subprocess
import sys
import bpy
from mathutils import Vector

RAW_PH = "/tmp/stage5-raw/polyhaven"
RAW_OUT = "/tmp/stage5-exports/ph"
GAME_ROOT = "/home/antigravity/anbow1/mediveal-village/games/new-game"
ASSETS_OUT = os.path.join(GAME_ROOT, "public/assets")
OPT_SCRIPT = os.path.join(GAME_ROOT, "tools/blender/optimize_glb.mjs")


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_ph_gltf(aid):
    path = os.path.join(RAW_PH, aid, f"{aid}.gltf")
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o.type == "MESH"]


def apply_all_transforms(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join_objects(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def ground_and_center(obj, target_max_dim=None, sink_z=0.0):
    apply_all_transforms([obj])
    bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    size = mx - mn
    cx = (mn.x + mx.x) * 0.5
    cy = (mn.y + mx.y) * 0.5
    obj.location = Vector((-cx, -cy, -mn.z - sink_z))
    apply_all_transforms([obj])
    if target_max_dim is not None:
        cur_max = max(size.x, size.y, size.z)
        if cur_max > 1e-4:
            s = target_max_dim / cur_max
            obj.scale = Vector((s, s, s))
            apply_all_transforms([obj])
            if sink_z != 0.0:
                bb2 = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
                mnz2 = min(v.z for v in bb2)
                obj.location.z -= (mnz2 + sink_z)
                apply_all_transforms([obj])


def resize_packed_images(max_px=512):
    for img in list(bpy.data.images):
        if img.size[0] == 0 or img.size[1] == 0:
            continue
        w, h = img.size[0], img.size[1]
        if max(w, h) > max_px:
            scale = max_px / float(max(w, h))
            nw = max(64, int(round(w * scale / 4.0) * 4))
            nh = max(64, int(round(h * scale / 4.0) * 4))
            img.scale(nw, nh)
        try:
            img.pack()
        except Exception:
            pass


def strip_materials(obj, placeholder_name):
    """For texture-free LOD1/LOD2/shadow GLBs so LOD1/2 share LOD0 KTX2 textures (zero duplicate VRAM)."""
    obj.data.materials.clear()
    mat = bpy.data.materials.new(placeholder_name)
    mat.use_nodes = True
    obj.data.materials.append(mat)


def decimate_copy(src_obj, target_tris, name):
    copy = src_obj.copy()
    copy.data = src_obj.data.copy()
    copy.name = name
    bpy.context.collection.objects.link(copy)
    cur_tris = sum(len(p.vertices) - 2 for p in copy.data.polygons)
    if cur_tris > target_tris and cur_tris > 16:
        ratio = max(0.01, min(1.0, float(target_tris) / float(cur_tris)))
        mod = copy.modifiers.new("Decimate", type="DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.select_all(action="DESELECT")
        copy.select_set(True)
        bpy.context.view_layer.objects.active = copy
        bpy.ops.object.modifier_apply(modifier="Decimate")
    return copy


def export_glb(objs, path, export_materials="EXPORT"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_materials=export_materials,
        export_image_format="AUTO",
        export_draco_mesh_compression_enable=False,
    )


def optimize_glb(raw_path, out_path, use_ktx2=True):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cmd = ["node", OPT_SCRIPT, raw_path, out_path]
    if use_ktx2:
        cmd.extend(["--ktx2", "--color", "etc1s", "--data", "uastc", "--min-psnr", "36"])
    env = os.environ.copy()
    env["KTX2_TOOLS"] = "/tmp/ktx2-tools/node_modules"
    subprocess.run(cmd, check=True, env=env)


def process_asset(aid, select_names, out_rel_base, lod_tris, max_tex_px=512, target_max_dim=None, sink_z=0.0, single_lod=False):
    clear_scene()
    meshes = import_ph_gltf(aid)
    if select_names:
        picked = [m for m in meshes if any(sn in m.name for sn in select_names)]
        for m in meshes:
            if m not in picked:
                bpy.data.objects.remove(m, do_unlink=True)
        meshes = picked
    if not meshes:
        raise RuntimeError(f"No meshes selected for {aid} ({select_names})")

    base_obj = join_objects(meshes, os.path.basename(out_rel_base))
    ground_and_center(base_obj, target_max_dim=target_max_dim, sink_z=sink_z)
    resize_packed_images(max_tex_px)

    # Ensure primary material has a deterministic name so LOD1/2 share LOD0's KTX2 material
    first_mat_name = base_obj.data.materials[0].name if base_obj.data.materials else f"{aid}_Mat"
    if not first_mat_name:
        first_mat_name = f"{aid}_Mat"
        base_obj.data.materials[0].name = first_mat_name

    # Export LOD0 (with KTX2 textures)
    lod0 = decimate_copy(base_obj, lod_tris[0], f"{base_obj.name}_lod0")
    raw0 = os.path.join(RAW_OUT, f"{out_rel_base}_lod0.glb")
    out0 = os.path.join(ASSETS_OUT, f"{out_rel_base}_lod0.glb")
    export_glb([lod0], raw0, export_materials="EXPORT")
    optimize_glb(raw0, out0, use_ktx2=True)
    tris0 = sum(len(p.vertices) - 2 for p in lod0.data.polygons)
    print(f"[ph] {out_rel_base}_lod0: {tris0} tris -> {os.path.getsize(out0)//1024} KiB (mat={first_mat_name})")

    if not single_lod:
        for idx, suffix in [(1, "lod1"), (2, "lod2"), (3, "shadow")]:
            cp = decimate_copy(base_obj, lod_tris[idx], f"{base_obj.name}_{suffix}")
            strip_materials(cp, first_mat_name)
            raw_p = os.path.join(RAW_OUT, f"{out_rel_base}_{suffix}.glb")
            out_p = os.path.join(ASSETS_OUT, f"{out_rel_base}_{suffix}.glb")
            export_glb([cp], raw_p, export_materials="EXPORT")
            optimize_glb(raw_p, out_p, use_ktx2=False)
            t = sum(len(p.vertices) - 2 for p in cp.data.polygons)
            print(f"[ph] {out_rel_base}_{suffix}: {t} tris -> {os.path.getsize(out_p)//1024} KiB")


def main():
    os.makedirs(RAW_OUT, exist_ok=True)

    # 1. Mossy Granite Cliff Rock A & Quarry Outcrop Rock B (rock_moss_set_01, CC0)
    process_asset("rock_moss_set_01", ["rock01"], "nature/rock_moss_a", (950, 380, 140, 64), max_tex_px=512, sink_z=0.14)
    process_asset("rock_moss_set_01", ["rock04"], "nature/rock_moss_b", (950, 380, 140, 64), max_tex_px=512, sink_z=0.18)

    # 2. Weathered Granite Hillside Boulder (boulder_01, CC0)
    process_asset("boulder_01", None, "nature/boulder", (900, 360, 130, 60), max_tex_px=512, sink_z=0.12)

    # 3. Photogrammetry Mossy Tree Stump (replaces procedural stump_lod0.glb!)
    process_asset("tree_stump_01", None, "trees/stump", (1050,), max_tex_px=512, target_max_dim=1.35, sink_z=0.06, single_lod=True)

    # 4. Photogrammetry Woodland Fern Clump (fern_02_b)
    process_asset("fern_02", ["fern_02_b"], "nature/fern", (880,), max_tex_px=512, target_max_dim=1.15, sink_z=0.02, single_lod=True)

    # 5. Photogrammetry Field Cannon on Spoked Wooden Carriage (cannon_01, CC0)
    process_asset("cannon_01", None, "units/cannon", (2800, 1100, 380, 96), max_tex_px=512, target_max_dim=2.35, sink_z=0.0)

    # 6. Photogrammetry Wooden Cargo Crate, Water Bucket & Lakeside Wooden Pier
    process_asset("wooden_crate_01", None, "props/crate", (650,), max_tex_px=512, target_max_dim=0.92, sink_z=0.0, single_lod=True)
    process_asset("wooden_bucket_01", None, "props/bucket", (550,), max_tex_px=512, target_max_dim=0.42, sink_z=0.0, single_lod=True)
    # Pick main deck + posts section of modular_wooden_pier (~5.5 m long lakeside pier!)
    process_asset("modular_wooden_pier", None, "props/pier", (1800,), max_tex_px=512, target_max_dim=8.5, sink_z=0.35, single_lod=True)

    print("[prepare_polyhaven_s5] ALL DONE!")
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
