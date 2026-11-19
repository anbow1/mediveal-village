"""
Prepares the Poly Haven CC0 photogrammetry prop `wine_barrel_01` into 3 LODs + coarse shadow stand-in
with grounded pivot (Z = 0), authentic medieval cask height (~0.88 m), and Cycles-baked vertex AO.

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/prepare_prop.py
"""

import json
import os
import sys
import bpy
import bmesh
from mathutils import Vector

SRC_GLTF = "/tmp/marchland-src/props/wine_barrel/wine_barrel_01_1k.gltf"
RAW_OUT = "/tmp/marchland-src/raw_glb"


def import_and_normalize():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC_GLTF)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = "barrel"

    # Apply existing transforms, ground to Z = 0, center XY, and normalize height to 0.88 m
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bbox = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    min_x = min(v.x for v in bbox)
    max_x = max(v.x for v in bbox)
    min_y = min(v.y for v in bbox)
    max_y = max(v.y for v in bbox)
    min_z = min(v.z for v in bbox)
    max_z = max(v.z for v in bbox)
    height = max(0.001, max_z - min_z)
    scale = 0.88 / height
    cx = (min_x + max_x) * 0.5
    cy = (min_y + max_y) * 0.5

    for v in obj.data.vertices:
        v.co.x = (v.co.x - cx) * scale
        v.co.y = (v.co.y - cy) * scale
        v.co.z = (v.co.z - min_z) * scale
    obj.data.update()
    return obj


def bake_prop_ao(obj, samples=16):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False

    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object

    # Preserve original materials during AO bake
    orig_mats = list(obj.data.materials)
    mat_w = bpy.data.materials.new("AoW")
    mat_w.use_nodes = True
    ground.data.materials.append(mat_w)
    obj.data.materials.clear()
    obj.data.materials.append(mat_w)

    mesh = obj.data
    ao_attr = mesh.color_attributes.new("AO_Raw", "FLOAT_COLOR", "CORNER")
    mesh.color_attributes.active_color = ao_attr

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type="AO")

    ao_vals = [c.color[0] for c in mesh.color_attributes["AO_Raw"].data]
    mesh.color_attributes.remove(mesh.color_attributes["AO_Raw"])
    final_attr = mesh.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for i, a in enumerate(ao_vals):
        v = max(0.45, min(1.0, a ** 0.70))
        final_attr.data[i].color = (v, v, v, 1.0)
    mesh.color_attributes.active_color_index = 0
    mesh.color_attributes.render_color_index = 0

    bpy.data.objects.remove(ground, do_unlink=True)
    obj.data.materials.clear()
    for m in orig_mats:
        if m and m.use_nodes:
            nt = m.node_tree
            bsdf = nt.nodes.get("Principled BSDF")
            if bsdf and bsdf.inputs["Base Color"].is_linked:
                src_sock = bsdf.inputs["Base Color"].links[0].from_socket
                vcol = nt.nodes.new("ShaderNodeVertexColor")
                vcol.layer_name = "Color"
                mul = nt.nodes.new("ShaderNodeMix")
                mul.data_type = "RGBA"
                mul.blend_type = "MULTIPLY"
                mul.inputs[0].default_value = 1.0
                nt.links.new(src_sock, mul.inputs[6])
                nt.links.new(vcol.outputs["Color"], mul.inputs[7])
                nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
        obj.data.materials.append(m)


def export_glb(objs, out_path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_attributes=True,
        export_vertex_color="ACTIVE",
        export_materials="EXPORT",
        export_draco_mesh_compression_enable=False,
    )


def main():
    os.makedirs(RAW_OUT, exist_ok=True)
    summary = {}
    for lod, suffix, ratio in [(0, "lod0", 0.35), (1, "lod1", 0.14), (2, "lod2", 0.055)]:
        obj = import_and_normalize()
        obj.name = f"barrel_{suffix}"
        if ratio < 1.0:
            dec = obj.modifiers.new("Decimate", "DECIMATE")
            dec.ratio = ratio
            dec.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=dec.name)
        bake_prop_ao(obj, samples=16 if lod == 0 else 10)
        if lod > 0:
            mat_ph = bpy.data.materials.new("BarrelPBR")
            mat_ph.use_nodes = True
            nt = mat_ph.node_tree
            bsdf = nt.nodes["Principled BSDF"]
            vcol = nt.nodes.new("ShaderNodeVertexColor")
            vcol.layer_name = "Color"
            nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
            obj.data.materials.clear()
            obj.data.materials.append(mat_ph)
        out_path = os.path.join(RAW_OUT, f"barrel_{suffix}.glb")
        export_glb([obj], out_path)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        summary[suffix] = {"tris": tris, "verts": len(obj.data.vertices), "bytes": os.path.getsize(out_path)}
        print(f"[barrel] {suffix}: {tris} tris -> {out_path} ({os.path.getsize(out_path)//1024} KiB)")

    # Coarse opaque shadow stand-in (8-sided barrel silhouette, ~32 tris, R7)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.28, radius2=0.28, depth=0.88)
    for v in bm.verts:
        v.co.z += 0.44
    mesh = bpy.data.meshes.new("barrel_shadow")
    bm.to_mesh(mesh)
    bm.free()
    s_obj = bpy.data.objects.new("barrel_shadow", mesh)
    bpy.context.collection.objects.link(s_obj)
    m = bpy.data.materials.new("ShadowMat")
    m.use_nodes = True
    s_obj.data.materials.append(m)
    out_sh = os.path.join(RAW_OUT, "barrel_shadow.glb")
    export_glb([s_obj], out_sh)
    tris = sum(len(p.vertices) - 2 for p in s_obj.data.polygons)
    summary["shadow"] = {"tris": tris, "verts": len(s_obj.data.vertices), "bytes": os.path.getsize(out_sh)}
    print(f"[barrel] shadow: {tris} tris -> {out_sh}")
    print("[barrel] DONE:", json.dumps(summary, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
