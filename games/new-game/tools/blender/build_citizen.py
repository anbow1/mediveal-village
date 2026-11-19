"""
Builds the rigged animated XIII-XIV c. medieval peasant villager (`citizen`) in Blender 4.2 (CC0 original):
  - 1.72 m human proportions, grounded flat at Z = 0, facing -Y (Blender) / +Z (glTF)
  - Rustic wool knee-length tunic, woven wool hood/coif collar, oiled leather belt + pouch,
    linen hose, turned leather boots, and sculpted face
  - Reuses the 17-bone Armature & baked `idle`, `walk`, `work` clips from `build_unit.py`
  - 512x512 synthesized woven wool/linen/leather PBR atlas + Cycles CPU vertex AO (COLOR_0)
  - Exports lod0 (rigged), lod1, lod2 (texture-free sharing lod0 material), and coarse R7 shadow stand-in.

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_citizen.py
"""

import json
import math
import os
import sys
import numpy as np
from PIL import Image
import bpy
import bmesh

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from build_unit import (  # noqa: E402
    UnitMeshBuilder,
    bake_unit_ao,
    build_armature_and_actions,
    export_glb,
    height_to_normal,
)

RAW_OUT = "/tmp/marchland-src/raw_glb"
TEX_DIR = "/tmp/marchland-src/citizen_tex"


def generate_citizen_textures():
    """Creates 512x512 earthy medieval villager atlas (tunic wool, linen shirt, leather, skin, hood)."""
    os.makedirs(TEX_DIR, exist_ok=True)
    S = 512
    rng = np.random.default_rng(4242)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    weave = (np.sin(xx * 2.0 * np.pi * 110.0) * np.sin(yy * 2.0 * np.pi * 110.0)) * 0.035 + rng.normal(0.0, 0.025, (S, S))

    alb = np.zeros((S, S, 3), dtype=np.float32)
    hmap = np.zeros((S, S), dtype=np.float32)
    orm = np.zeros((S, S, 3), dtype=np.float32)
    orm[:, :, 0] = 1.0
    orm[:, :, 1] = 0.88
    orm[:, :, 2] = 0.0

    # Matches UV_REGIONS from build_unit.py:
    # surcoat (0..0.5, v 0.5..1 -> PIL y 0..256, x 0..256): undyed warm ochre-brown homespun wool tunic
    alb[0:256, 0:256] = np.clip(np.array([0.46, 0.36, 0.25]) + weave[0:256, 0:256, None], 0.05, 0.85)
    hmap[0:256, 0:256] = 0.5 + weave[0:256, 0:256] * 3.0
    # mail region (x 256..512, y 0..256): coarse undyed flax linen sleeves & shirt
    alb[0:256, 256:512] = np.clip(np.array([0.64, 0.58, 0.46]) + weave[0:256, 256:512, None], 0.08, 0.85)
    hmap[0:256, 256:512] = 0.5 + weave[0:256, 256:512] * 2.5
    # steel region (x 0..256, y 256..384): dark sage-moss wool hood/chaperon cap
    alb[256:384, 0:256] = np.clip(np.array([0.24, 0.28, 0.19]) + weave[256:384, 0:256, None], 0.04, 0.75)
    hmap[256:384, 0:256] = 0.5 + weave[256:384, 0:256] * 2.8
    # shield region (x 256..512, y 256..512): dark wool hose / trousers
    alb[256:512, 256:512] = np.clip(np.array([0.22, 0.19, 0.16]) + weave[256:512, 256:512, None], 0.04, 0.70)
    hmap[256:512, 256:512] = 0.5 + weave[256:512, 256:512] * 2.2
    # leather (x 0..128, y 384..512): oiled dark brown leather belt, pouch & boots
    alb[384:512, 0:128] = np.clip(np.array([0.20, 0.13, 0.08]) + weave[384:512, 0:128, None] * 0.7, 0.03, 0.65)
    orm[384:512, 0:128, 1] = 0.62
    # skin (x 128..256, y 384..512): warm weathered skin + darker hair/beard shadow near edges
    alb[384:512, 128:256] = np.clip(np.array([0.66, 0.49, 0.38]) + weave[384:512, 128:256, None] * 0.35, 0.12, 0.85)
    orm[384:512, 128:256, 1] = 0.74

    alb_p = os.path.join(TEX_DIR, "citizen_albedo.png")
    nor_p = os.path.join(TEX_DIR, "citizen_normal.png")
    orm_p = os.path.join(TEX_DIR, "citizen_orm.png")
    Image.fromarray(np.clip(alb * 255, 0, 255).astype(np.uint8)).save(alb_p)
    Image.fromarray(height_to_normal(hmap, 1.8)).save(nor_p)
    Image.fromarray(np.clip(orm * 255, 0, 255).astype(np.uint8)).save(orm_p)
    return alb_p, nor_p, orm_p


def build_citizen_geometry(mb, detail=True):
    segs = 10 if detail else 7
    # Legs & turned leather boots (grounded cleanly at Z=0)
    for side, bn_u, bn_l, bn_f in [(-1, "thigh_l", "shin_l", "foot_l"), (1, "thigh_r", "shin_r", "foot_r")]:
        x = side * 0.11
        mb.add_limb((x, 0.0, 0.86), (x, -0.01, 0.46), 0.095, 0.072, segs, "shield", bn_u, rings=3)
        mb.add_limb((x, -0.01, 0.46), (x, 0.01, 0.08), 0.070, 0.056, segs, "leather", bn_l, rings=3)
        mb.add_box_part((x, -0.04, 0.045), (0.10, 0.22, 0.09), (0, 0, 0), "leather", bn_f)

    # Knee-length belted wool tunic + flared skirt
    mb.add_limb((0.0, 0.0, 0.56), (0.0, 0.0, 0.94), 0.24, 0.18, segs + 2, "surcoat", "hips", rings=3, oval=(1.18, 0.92))
    mb.add_limb((0.0, 0.0, 0.94), (0.0, 0.0, 1.38), 0.18, 0.21, segs + 2, "surcoat", "chest", rings=4, oval=(1.22, 0.88))
    # Leather belt & hip pouch
    mb.add_limb((0.0, 0.0, 0.90), (0.0, 0.0, 0.97), 0.195, 0.195, segs + 2, "leather", "spine", rings=2, oval=(1.20, 0.94))
    if detail:
        mb.add_box_part((0.18, -0.08, 0.88), (0.11, 0.09, 0.14), (0, 0, 0.2), "leather", "hips")

    # Wool hood collar & medieval soft cap
    mb.add_limb((0.0, 0.0, 1.34), (0.0, 0.0, 1.44), 0.22, 0.11, segs, "steel", "chest", rings=2, oval=(1.22, 0.98))
    mb.add_limb((0.0, 0.0, 1.42), (0.0, 0.0, 1.52), 0.068, 0.064, segs, "skin", "neck", rings=2)
    # Head + soft wool medieval cap
    mb.add_limb((0.0, -0.01, 1.50), (0.0, -0.01, 1.66), 0.086, 0.092, segs, "skin", "head", rings=3, oval=(0.94, 1.08))
    mb.add_limb((0.0, 0.01, 1.61), (0.0, 0.02, 1.73), 0.105, 0.045, segs, "steel", "head", rings=3, oval=(1.02, 1.12))

    # Arms (linen shirt sleeves + weathered hands)
    for side, bu, bf, bh in [(-1, "upper_arm_l", "forearm_l", "hand_l"), (1, "upper_arm_r", "forearm_r", "hand_r")]:
        x0 = side * 0.25
        mb.add_limb((x0, 0.0, 1.34), (side * 0.30, -0.03, 1.04), 0.065, 0.055, segs, "mail", bu, rings=3)
        mb.add_limb((side * 0.30, -0.03, 1.04), (side * 0.28, -0.10, 0.78), 0.052, 0.042, segs, "mail", bf, rings=3)
        mb.add_limb((side * 0.28, -0.10, 0.78), (side * 0.28, -0.12, 0.69), 0.042, 0.034, 6, "skin", bh, rings=2)


def attach_citizen_mat(obj, alb_p, nor_p, orm_p):
    mat = bpy.data.materials.new("CitizenPBR")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    t_alb = nt.nodes.new("ShaderNodeTexImage")
    t_alb.image = bpy.data.images.load(alb_p, check_existing=True)
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    nt.links.new(t_alb.outputs["Color"], mix.inputs["A"])
    nt.links.new(vcol.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

    t_nor = nt.nodes.new("ShaderNodeTexImage")
    t_nor.image = bpy.data.images.load(nor_p, check_existing=True)
    t_nor.image.colorspace_settings.name = "Non-Color"
    n_node = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(t_nor.outputs["Color"], n_node.inputs["Color"])
    nt.links.new(n_node.outputs["Normal"], bsdf.inputs["Normal"])

    t_orm = nt.nodes.new("ShaderNodeTexImage")
    t_orm.image = bpy.data.images.load(orm_p, check_existing=True)
    t_orm.image.colorspace_settings.name = "Non-Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t_orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    obj.data.materials.clear()
    obj.data.materials.append(mat)


def main():
    os.makedirs(RAW_OUT, exist_ok=True)
    alb_p, nor_p, orm_p = generate_citizen_textures()
    summary = {}
    for lod, suffix in [(0, "lod0"), (1, "lod1"), (2, "lod2"), (3, "shadow")]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        mb = UnitMeshBuilder()
        if lod == 3:
            mb.add_limb((0.0, 0.0, 0.02), (0.0, 0.0, 1.70), 0.21, 0.14, 6, "surcoat", "hips", rings=3)
            bmesh.ops.recalc_face_normals(mb.bm, faces=mb.bm.faces)
            mesh = bpy.data.meshes.new("citizen_shadow")
            mb.bm.to_mesh(mesh)
            mb.bm.free()
            obj = bpy.data.objects.new("citizen_shadow", mesh)
            bpy.context.collection.objects.link(obj)
            m = bpy.data.materials.new("ShadowMat")
            m.use_nodes = True
            obj.data.materials.append(m)
            out_p = os.path.join(RAW_OUT, "citizen_shadow.glb")
            export_glb([obj], out_p, animations=False)
            summary[suffix] = {"tris": sum(len(p.vertices) - 2 for p in obj.data.polygons), "bytes": os.path.getsize(out_p)}
            continue

        build_citizen_geometry(mb, detail=(lod == 0))
        bmesh.ops.recalc_face_normals(mb.bm, faces=mb.bm.faces)
        mesh = bpy.data.meshes.new(f"citizen_{suffix}")
        mb.bm.to_mesh(mesh)
        bone_names = list(mb.bone_names)
        mb.bm.free()
        obj = bpy.data.objects.new(f"citizen_{suffix}", mesh)
        bpy.context.collection.objects.link(obj)

        if lod in (1, 2):
            bpy.context.view_layer.objects.active = obj
            dec = obj.modifiers.new("Decimate", "DECIMATE")
            dec.ratio = 0.50 if lod == 1 else 0.26
            dec.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=dec.name)

        bake_unit_ao(obj, samples=16 if lod == 0 else 8)
        out_p = os.path.join(RAW_OUT, f"citizen_{suffix}.glb")
        if lod == 0:
            attach_citizen_mat(obj, alb_p, nor_p, orm_p)
            arm_obj = build_armature_and_actions(obj, bone_names)
            export_glb([arm_obj, obj], out_p, animations=True)
        else:
            mat_ph = bpy.data.materials.new("CitizenPBR")
            mat_ph.use_nodes = True
            nt = mat_ph.node_tree
            bsdf = nt.nodes["Principled BSDF"]
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Color"
            nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
            obj.data.materials.clear()
            obj.data.materials.append(mat_ph)
            export_glb([obj], out_p, animations=False)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        summary[suffix] = {"tris": tris, "bytes": os.path.getsize(out_p)}
        print(f"[citizen] {suffix}: {tris} tris -> {out_p} ({os.path.getsize(out_p)//1024} KiB)")

    print("[citizen] DONE:", json.dumps(summary, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
