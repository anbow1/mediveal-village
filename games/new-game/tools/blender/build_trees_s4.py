"""
Stage 4 Blender 4.2 realistic nature kit (CC0 original):
  1. Scots Pine (`pine`, ~11.6 m tall): reddish-brown upper / rough lower bark + layered dark
     conifer needle-fan spray cards (512^2 RGBA with 14-pass RGB dilation, outward spherical normals,
     radial crown AO), 3 LODs + coarse opaque R7 shadow + Cycles matte impostor.
  2. Silver Birch (`birch`, ~9.2 m tall): chalk-white lenticel birch bark (512^2) + airy golden-autumn
     serrated birch leaf spray cards (512^2 RGBA with 14-pass RGB dilation), 3 LODs + R7 shadow + impostor.
  3. Forestry lifecycle & shoreline meshes:
       - `stump` (felled oak stump, sunk -0.25 m)
       - `sapling` (young oak sapling, 2.2 m tall)
       - `reeds` (lake shoreline reed & cattail clump, 1.5 m tall)

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_trees_s4.py
"""

import json
import math
import os
import random
import sys
import numpy as np
from PIL import Image, ImageDraw
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

RAW_OUT = "/tmp/marchland-src/raw_glb"
TEX_DIR = "/tmp/marchland-src/tree_tex_s4"


def dilate_rgba(img: Image.Image, passes: int = 14) -> Image.Image:
    """Dilates opaque RGB pixels outward into transparent regions so mipmaps never bleed dark."""
    arr = np.asarray(img.convert("RGBA"), dtype=np.uint8).copy()
    rgb = arr[:, :, :3].astype(np.float32)
    solid = arr[:, :, 3] > 20
    for _ in range(passes):
        padded_s = np.pad(solid, 1, mode="edge")
        padded_c = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode="edge")
        acc = np.zeros_like(rgb)
        cnt = np.zeros(solid.shape, dtype=np.float32)
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            m = padded_s[1 + dy : 1 + dy + solid.shape[0], 1 + dx : 1 + dx + solid.shape[1]]
            c = padded_c[1 + dy : 1 + dy + solid.shape[0], 1 + dx : 1 + dx + solid.shape[1]]
            acc += c * m[:, :, None]
            cnt += m.astype(np.float32)
        fill = (~solid) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill, None]
        solid = solid | fill
    arr[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="RGBA")


def generate_pine_textures():
    """Synthesizes 512x512 Scots Pine reddish-fissured bark & conifer needle-bough spray RGBA."""
    os.makedirs(TEX_DIR, exist_ok=True)
    rng = np.random.default_rng(701)

    # 1. Scots Pine bark (warm sienna-brown flaky vertical plates)
    S = 512
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    ridges = (
        np.sin(xx * 2.0 * np.pi * 14.0 + np.sin(yy * 2.0 * np.pi * 4.0) * 1.4) * 0.5
        + np.sin(xx * 2.0 * np.pi * 29.0 + yy * 2.0 * np.pi * 3.0) * 0.25
        + np.cos(yy * 2.0 * np.pi * 11.0 + np.sin(xx * 2.0 * np.pi * 8.0)) * 0.25
    )
    grain = rng.normal(0.0, 0.06, (S, S)).astype(np.float32)
    h = np.clip(0.52 + ridges * 0.28 + grain, 0.0, 1.0)
    # Warm European Scots Pine reddish-ochre upper bark / darker fissure crevices
    bark_rgb = np.zeros((S, S, 3), dtype=np.float32)
    bark_rgb[:, :, 0] = 0.24 + h * 0.34
    bark_rgb[:, :, 1] = 0.16 + h * 0.20
    bark_rgb[:, :, 2] = 0.11 + h * 0.12
    bark_path = os.path.join(TEX_DIR, "pine_bark.png")
    Image.fromarray(np.clip(bark_rgb * 255, 0, 255).astype(np.uint8)).save(bark_path)

    # 2. Scots Pine conifer needle spray atlas (512x512 RGBA, radiating dark evergreen needle fans)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    py_rng = random.Random(702)
    twig = (88, 62, 42, 255)
    draw.line([(256, 488), (256, 118)], fill=twig, width=8)
    sub_boughs = [
        ((256, 420), (112, 310)),
        ((256, 405), (402, 298)),
        ((256, 325), (96, 198)),
        ((256, 315), (416, 188)),
        ((256, 225), (146, 108)),
        ((256, 220), (366, 104)),
    ]
    for p0, p1 in sub_boughs:
        draw.line([p0, p1], fill=twig, width=5)

    # Rich natural northern European Scots Pine blue-olive evergreen needles (never neon!)
    needle_palette = [
        (38, 64, 34),
        (46, 76, 38),
        (56, 84, 42),
        (32, 54, 30),
        (64, 92, 46),
        (72, 94, 48),
    ]

    def draw_needle_fan(cx, cy, base_ang, count=22, length=62):
        for _ in range(count):
            a = base_ang + py_rng.uniform(-1.35, 1.35)
            L = length * py_rng.uniform(0.55, 1.15)
            col = py_rng.choice(needle_palette)
            col = (
                max(18, min(140, col[0] + py_rng.randint(-6, 6))),
                max(28, min(160, col[1] + py_rng.randint(-6, 6))),
                max(16, min(110, col[2] + py_rng.randint(-5, 5))),
                255,
            )
            draw.line([(cx, cy), (cx + math.cos(a) * L, cy + math.sin(a) * L)], fill=col, width=4)

    for p0, p1 in sub_boughs:
        ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        for frac in (0.28, 0.56, 0.82, 0.98):
            ax = p0[0] + (p1[0] - p0[0]) * frac
            ay = p0[1] + (p1[1] - p0[1]) * frac
            draw_needle_fan(ax, ay, ang, count=24, length=58)
    for yc in (130, 210, 295, 380):
        draw_needle_fan(256, yc, -math.pi * 0.5, count=22, length=56)

    leaf_path = os.path.join(TEX_DIR, "pine_needles.png")
    dilate_rgba(img, 14).save(leaf_path)
    return bark_path, leaf_path


def generate_birch_textures():
    """Synthesizes 512x512 Silver Birch white-lenticel bark & golden-autumn birch leaf spray RGBA."""
    os.makedirs(TEX_DIR, exist_ok=True)
    rng = np.random.default_rng(801)
    S = 512

    # 1. Silver Birch chalk-white bark with dark charcoal horizontal lenticels & fissured base
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    base = np.full((S, S, 3), [0.80, 0.78, 0.74], dtype=np.float32)
    base += rng.normal(0.0, 0.025, (S, S, 1)).astype(np.float32)
    # Horizontal dark grey-brown lenticel streaks
    py_rng = random.Random(802)
    img_b = Image.fromarray(np.clip(base * 255, 0, 255).astype(np.uint8))
    db = ImageDraw.Draw(img_b)
    for _ in range(180):
        y = py_rng.randint(0, S - 1)
        x = py_rng.randint(0, S - 1)
        w = py_rng.randint(14, 72)
        h = py_rng.randint(2, 5)
        shade = py_rng.randint(32, 74)
        db.ellipse([x - w // 2, y - h // 2, x + w // 2, y + h // 2], fill=(shade + 8, shade + 4, shade))
    for _ in range(18):
        y = py_rng.randint(0, S - 1)
        x = py_rng.randint(0, S - 1)
        w = py_rng.randint(36, 98)
        h = py_rng.randint(10, 24)
        db.polygon([(x - w // 2, y), (x, y - h // 2), (x + w // 2, y), (x, y + h // 2)], fill=(48, 44, 40))
    bark_path = os.path.join(TEX_DIR, "birch_bark.png")
    img_b.save(bark_path)

    # 2. Silver Birch airy early-autumn golden/yellow-green serrated diamond leaf spray
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    twig = (92, 78, 64, 255)
    draw.line([(256, 488), (252, 108)], fill=twig, width=5)
    twigs = [
        ((255, 420), (132, 315)),
        ((255, 400), (382, 300)),
        ((254, 315), (108, 198)),
        ((254, 305), (402, 188)),
        ((253, 210), (156, 105)),
        ((253, 200), (358, 98)),
    ]
    for p0, p1 in twigs:
        draw.line([p0, p1], fill=twig, width=3)

    birch_palette = [
        (168, 146, 52),  # warm autumn birch gold
        (182, 156, 56),  # bright sunlit gold
        (146, 138, 50),  # olive-gold transition
        (118, 128, 48),  # pale birch green
        (158, 124, 44),  # amber leaf tip
    ]

    def draw_birch_leaf(cx, cy, L, W, ang, col):
        ca, sa = math.cos(ang), math.sin(ang)
        pts = [
            (cx, cy),
            (cx + L * 0.35 * ca - W * 0.55 * sa, cy + L * 0.35 * sa + W * 0.55 * ca),
            (cx + L * ca, cy + L * sa),
            (cx + L * 0.35 * ca + W * 0.55 * sa, cy + L * 0.35 * sa - W * 0.55 * ca),
        ]
        draw.polygon(pts, fill=(*col, 255))

    for p0, p1 in twigs:
        ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        for frac in (0.25, 0.50, 0.75, 0.95):
            ax = p0[0] + (p1[0] - p0[0]) * frac
            ay = p0[1] + (p1[1] - p0[1]) * frac
            for da in (-0.95, -0.35, 0.35, 0.95):
                c = py_rng.choice(birch_palette)
                draw_birch_leaf(ax, ay, py_rng.uniform(44, 68), py_rng.uniform(26, 40), ang + da + py_rng.uniform(-0.2, 0.2), c)
    for yc in (122, 195, 275, 360):
        for side in (-1, 1):
            c = py_rng.choice(birch_palette)
            draw_birch_leaf(254 + side * 8, yc, py_rng.uniform(46, 64), py_rng.uniform(26, 38), -math.pi * 0.5 + side * 0.75, c)

    leaf_path = os.path.join(TEX_DIR, "birch_leaves.png")
    dilate_rgba(img, 14).save(leaf_path)
    return bark_path, leaf_path


def make_pbr_mat(name, image_path, alpha_cutout=False, roughness=0.88):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(image_path, check_existing=True)
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs["A"])
    nt.links.new(vcol.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    if alpha_cutout:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.blend_method = "CLIP" if hasattr(mat, "blend_method") else "OPAQUE"
    return mat


def add_tapered_limb(bm, uv_layer, col_layer, pts, radii, segs=7):
    """Sweeps a tapered cylindrical trunk/branch tube along 3D polyline `pts`."""
    rings = []
    v_acc = 0.0
    for idx, (p, r) in enumerate(zip(pts, radii)):
        p = Vector(p)
        if idx > 0:
            v_acc += (p - Vector(pts[idx - 1])).length
        if idx == 0:
            tang = (Vector(pts[1]) - p).normalized()
        elif idx == len(pts) - 1:
            tang = (p - Vector(pts[idx - 1])).normalized()
        else:
            tang = (Vector(pts[idx + 1]) - Vector(pts[idx - 1])).normalized()
        up = Vector((1, 0, 0)) if abs(tang.x) < 0.8 else Vector((0, 1, 0))
        u_ax = tang.cross(up).normalized()
        v_ax = tang.cross(u_ax).normalized()
        ring = []
        for s in range(segs):
            a = 2.0 * math.pi * s / segs
            co = p + (u_ax * math.cos(a) + v_ax * math.sin(a)) * r
            ring.append(bm.verts.new(co))
        rings.append((ring, v_acc))

    for i in range(len(rings) - 1):
        r0, v0 = rings[i]
        r1, v1 = rings[i + 1]
        ao0 = 0.58 if i == 0 else min(1.0, 0.68 + 0.32 * (i / max(1, len(rings) - 1)))
        ao1 = min(1.0, 0.68 + 0.32 * ((i + 1) / max(1, len(rings) - 1)))
        for s in range(segs):
            sn = (s + 1) % segs
            f = bm.faces.new([r0[s], r0[sn], r1[sn], r1[s]])
            f.smooth = True
            u0 = s / segs
            u1 = (s + 1) / segs
            for lp, (uv_c, ao_v) in zip(f.loops, [((u0, v0 * 0.45), ao0), ((u1, v0 * 0.45), ao0), ((u1, v1 * 0.45), ao1), ((u0, v1 * 0.45), ao1)]):
                lp[uv_layer].uv = uv_c
                lp[col_layer] = (ao_v, ao_v, ao_v, 1.0)


def add_foliage_cluster(bm, uv_layer, col_layer, center, radius, cards_per_cluster, crown_center, crown_rad, rng):
    """Adds crossed slightly bent organic foliage spray cards with outward radial crown AO."""
    c = Vector(center)
    for k in range(cards_per_cluster):
        yaw = (k / cards_per_cluster) * math.pi + rng.uniform(-0.35, 0.35)
        pitch = rng.uniform(-0.48, 0.52)
        roll = rng.uniform(-0.35, 0.35)
        rot = Euler((pitch, roll, yaw), "XYZ").to_matrix()
        w = radius * rng.uniform(0.92, 1.24)
        h = radius * rng.uniform(0.92, 1.24)
        jitter = Vector((rng.uniform(-0.22, 0.22), rng.uniform(-0.22, 0.22), rng.uniform(-0.16, 0.16))) * radius
        pos = c + jitter
        # 2x2 slightly domed quad (4 tris) bends card softly so silhouettes never look flat
        grid = []
        for iy, vy in enumerate((-0.5, 0.0, 0.5)):
            row = []
            for ix, vx in enumerate((-0.5, 0.0, 0.5)):
                dome = (1.0 - (vx * vx + vy * vy) * 2.2) * radius * 0.16
                local = Vector((vx * w, dome, vy * h))
                world_p = pos + rot @ local
                row.append((bm.verts.new(world_p), (ix * 0.5, iy * 0.5), world_p))
            grid.append(row)
        for iy in range(2):
            for ix in range(2):
                a, b, d, e = grid[iy][ix], grid[iy][ix + 1], grid[iy + 1][ix + 1], grid[iy + 1][ix]
                f = bm.faces.new([a[0], b[0], d[0], e[0]])
                f.smooth = True
                for lp, item in zip(f.loops, [a, b, d, e]):
                    lp[uv_layer].uv = item[1]
                    rel = (item[2] - crown_center).length / max(0.5, crown_rad)
                    top_lift = max(0.0, (item[2].z - crown_center.z) / max(0.5, crown_rad)) * 0.22
                    ao = max(0.42, min(1.0, 0.44 + 0.52 * min(1.0, rel) + top_lift))
                    lp[col_layer] = (ao, ao, ao, 1.0)


def apply_spherical_normals(obj, crown_center):
    """Bends canopy vertex normals outward from crown center for soft organic sunlit volume."""
    mesh = obj.data
    custom_norms = []
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            v = mesh.vertices[mesh.loops[li].vertex_index]
            d = (v.co - crown_center)
            d.z += 0.65
            if d.length < 1e-4:
                d = Vector((0, 0, 1))
            else:
                d.normalize()
            custom_norms.append(tuple(d))
    mesh.normals_split_custom_set(custom_norms)


def render_tree_impostor(canopy_obj, out_png, ortho_scale=12.4, cam_z=5.8):
    """Renders a 512x512 Cycles translucent backlit matte impostor PNG for >100 m trees (zero black self-shadows)."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False

    # Temporarily wire translucent + subtle multi-scatter emission on canopy material for bright sunlit impostor
    mat = canopy_obj.data.materials[0]
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    out_node = nt.nodes["Material Output"]
    base_col_sock = bsdf.inputs["Base Color"].links[0].from_socket
    alpha_sock = bsdf.inputs["Alpha"].links[0].from_socket

    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(base_col_sock, trans.inputs["Color"])
    mix_s = nt.nodes.new("ShaderNodeMixShader")
    mix_s.inputs["Fac"].default_value = 0.45
    nt.links.new(bsdf.outputs["BSDF"], mix_s.inputs[1])
    nt.links.new(trans.outputs["BSDF"], mix_s.inputs[2])

    emis = nt.nodes.new("ShaderNodeEmission")
    emis.inputs["Strength"].default_value = 0.18
    nt.links.new(base_col_sock, emis.inputs["Color"])
    add_s = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(mix_s.outputs["Shader"], add_s.inputs[0])
    nt.links.new(emis.outputs["Emission"], add_s.inputs[1])

    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    alpha_mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(alpha_sock, alpha_mix.inputs["Fac"])
    nt.links.new(transp.outputs["BSDF"], alpha_mix.inputs[1])
    nt.links.new(add_s.outputs["Shader"], alpha_mix.inputs[2])
    nt.links.new(alpha_mix.outputs["Shader"], out_node.inputs["Surface"])

    world = bpy.data.worlds.new("ImpostorWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.50, 0.60, 0.74, 1.0)
    bg.inputs["Strength"].default_value = 1.4

    sun_d = bpy.data.lights.new("ImpSun", type="SUN")
    sun_d.energy = 4.0
    sun_d.color = (1.0, 0.94, 0.84)
    sun_o = bpy.data.objects.new("ImpSun", sun_d)
    sun_dir = (Vector((0, 0, cam_z)) - Vector((10, -14, 14))).normalized()
    sun_o.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(sun_o)

    cam_d = bpy.data.cameras.new("ImpCam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = ortho_scale
    cam_o = bpy.data.objects.new("ImpCam", cam_d)
    cam_o.location = Vector((0.0, -20.0, cam_z))
    cam_o.rotation_euler = (Vector((0.0, 0.0, cam_z)) - cam_o.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam_o)
    scene.camera = cam_o

    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.filepath = out_png
    bpy.ops.render.render(write_still=True)

    # Restore clean Principled BSDF link before glTF export
    nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])
    for node in (alpha_mix, transp, add_s, emis, mix_s, trans):
        nt.nodes.remove(node)

    bpy.data.objects.remove(sun_o, do_unlink=True)
    bpy.data.objects.remove(cam_o, do_unlink=True)


def make_placeholder_mat(name):
    """Texture-free named placeholder material for LOD1/LOD2 (shares LOD0 KTX2 textures at runtime)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Color"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


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


def build_species(species, bark_path, leaf_path, lod):
    rng = random.Random(901 if species == "pine" else 902)
    bm_trunk = bmesh.new()
    uv_t = bm_trunk.loops.layers.uv.new("UVMap")
    col_t = bm_trunk.loops.layers.color.new("Color")

    bm_canopy = bmesh.new()
    uv_c = bm_canopy.loops.layers.uv.new("UVMap")
    col_c = bm_canopy.loops.layers.color.new("Color")

    if lod == 3:
        # Coarse opaque R7 shadow stand-in (trunk cylinder + crown hull)
        h_top = 11.4 if species == "pine" else 9.0
        r_crown = 2.75 if species == "pine" else 2.85
        c_z = 8.1 if species == "pine" else 6.1
        bmesh.ops.create_cone(bm_trunk, cap_ends=True, segments=6, radius1=0.34, radius2=0.14, depth=h_top * 0.72, matrix=Matrix.Translation((0, 0, h_top * 0.34)))
        bmesh.ops.create_icosphere(bm_trunk, subdivisions=1, radius=r_crown, matrix=Matrix.Translation((0, 0, c_z)) @ Matrix.Diagonal((1.0, 1.0, 1.15 if species == "pine" else 1.22, 1.0)))
        mesh = bpy.data.meshes.new(f"{species}_shadow")
        bm_trunk.to_mesh(mesh)
        bm_trunk.free()
        bm_canopy.free()
        obj = bpy.data.objects.new(f"{species}_shadow", mesh)
        bpy.context.collection.objects.link(obj)
        return [obj]

    segs = 8 if lod == 0 else (6 if lod == 1 else 5)
    if species == "pine":
        # Scots Pine: tall straight tapering trunk with rich layered irregular pine crown
        pts = [(0.0, 0.0, -0.35), (0.04, -0.02, 1.6), (-0.05, 0.04, 4.2), (0.06, 0.02, 7.0), (0.02, -0.04, 9.6), (0.0, 0.0, 11.2)]
        rads = [0.36, 0.27, 0.22, 0.17, 0.10, 0.04]
        add_tapered_limb(bm_trunk, uv_t, col_t, pts, rads, segs=segs)
        if lod == 0:
            for k in range(4):
                a = k * math.pi * 0.5 + 0.35
                add_tapered_limb(bm_trunk, uv_t, col_t, [(0, 0, 0.55), (math.cos(a) * 0.58, math.sin(a) * 0.58, -0.35)], [0.16, 0.08], segs=5)
        crown_center = Vector((0.0, 0.0, 8.5))
        crown_rad = 3.4
        clusters = []
        tiers = [
            (5.5, 2.35, 6, 2.25),
            (6.8, 2.65, 7, 2.35),
            (8.2, 2.35, 7, 2.25),
            (9.6, 1.65, 5, 2.05),
            (10.8, 0.75, 3, 1.85),
            (11.4, 0.15, 1, 1.75),
        ]
        for tz, tr, count, crad in tiers:
            for k in range(count):
                a = (k / max(1, count)) * 2.0 * math.pi + tz * 0.7 + rng.uniform(-0.22, 0.22)
                ex = math.cos(a) * tr * rng.uniform(0.75, 1.08)
                ey = math.sin(a) * tr * rng.uniform(0.75, 1.08)
                ez = tz + rng.uniform(-0.22, 0.28)
                if lod <= 1 and tr > 1.0:
                    add_tapered_limb(bm_trunk, uv_t, col_t, [(0, 0, tz - 0.35), (ex * 0.55, ey * 0.55, tz + 0.05), (ex * 0.9, ey * 0.9, ez)], [0.09, 0.06, 0.03], segs=5)
                clusters.append(((ex, ey, ez), crad))
                if tr > 1.5 and k % 2 == 0:
                    # Inner bough filler prevents gaps between trunk and outer pine pads
                    clusters.append(((ex * 0.48, ey * 0.48, ez + 0.12), crad * 0.85))
        cards = 3 if lod == 0 else (2 if lod == 1 else 1)
        for pos, rad in clusters:
            add_foliage_cluster(bm_canopy, uv_c, col_c, pos, rad, cards, crown_center, crown_rad, rng)
    else:
        # Silver Birch: slender white-barked trunk with full airy golden-autumn crown
        pts = [(0.0, 0.0, -0.32), (0.06, 0.03, 1.5), (-0.08, 0.09, 3.6), (0.04, 0.05, 5.8), (-0.06, -0.02, 7.8), (0.0, 0.0, 9.1)]
        rads = [0.24, 0.18, 0.14, 0.10, 0.06, 0.025]
        add_tapered_limb(bm_trunk, uv_t, col_t, pts, rads, segs=segs)
        crown_center = Vector((0.0, 0.0, 6.2))
        crown_rad = 3.2
        clusters = []
        tiers = [
            (3.7, 1.85, 6, 2.05),
            (5.0, 2.35, 7, 2.15),
            (6.4, 2.15, 7, 2.05),
            (7.7, 1.45, 5, 1.85),
            (8.8, 0.55, 3, 1.65),
            (9.3, 0.12, 1, 1.55),
        ]
        for tz, tr, count, crad in tiers:
            for k in range(count):
                a = (k / max(1, count)) * 2.0 * math.pi + tz * 0.9 + rng.uniform(-0.24, 0.24)
                ex = math.cos(a) * tr * rng.uniform(0.75, 1.08)
                ey = math.sin(a) * tr * rng.uniform(0.75, 1.08)
                ez = tz + rng.uniform(-0.18, 0.26)
                if lod <= 1 and tr > 0.9:
                    add_tapered_limb(bm_trunk, uv_t, col_t, [(0, 0, tz - 0.65), (ex * 0.55, ey * 0.55, tz - 0.1), (ex * 0.9, ey * 0.9, ez)], [0.065, 0.042, 0.02], segs=5)
                clusters.append(((ex, ey, ez), crad))
                if tr > 1.3 and k % 2 == 0:
                    clusters.append(((ex * 0.45, ey * 0.45, ez + 0.1), crad * 0.85))
        cards = 3 if lod == 0 else (2 if lod == 1 else 1)
        for pos, rad in clusters:
            add_foliage_cluster(bm_canopy, uv_c, col_c, pos, rad, cards, crown_center, crown_rad, rng)

    m_trunk = bpy.data.meshes.new(f"{species}_trunk")
    bm_trunk.to_mesh(m_trunk)
    bm_trunk.free()
    o_trunk = bpy.data.objects.new(f"{species}_trunk", m_trunk)
    bpy.context.collection.objects.link(o_trunk)
    trunk_mat_name = f"{species.capitalize()}BarkPBR"
    o_trunk.data.materials.append(
        make_pbr_mat(trunk_mat_name, bark_path, alpha_cutout=False, roughness=0.90) if lod == 0 else make_placeholder_mat(trunk_mat_name)
    )

    m_canopy = bpy.data.meshes.new(f"{species}_canopy")
    bm_canopy.to_mesh(m_canopy)
    bm_canopy.free()
    o_canopy = bpy.data.objects.new(f"{species}_canopy", m_canopy)
    bpy.context.collection.objects.link(o_canopy)
    apply_spherical_normals(o_canopy, crown_center)
    canopy_mat_name = f"{species.capitalize()}LeavesCutout"
    o_canopy.data.materials.append(
        make_pbr_mat(canopy_mat_name, leaf_path, alpha_cutout=True, roughness=0.78) if lod == 0 else make_placeholder_mat(canopy_mat_name)
    )

    return [o_trunk, o_canopy]


def build_stump_and_sapling_and_reeds(pine_bark, birch_leaf):
    """Exports felled stump, growing sapling, and shoreline lake reed clump GLBs."""
    # 1. Felled Oak Stump (0.52 m tall, flared roots sunk -0.25 m, lighter fresh cut top)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    col = bm.loops.layers.color.new("Color")
    add_tapered_limb(bm, uv, col, [(0, 0, -0.25), (0, 0, 0.15), (0.02, -0.01, 0.52)], [0.46, 0.34, 0.28], segs=9)
    # Cut top disc
    top_vs = [bm.verts.new((0.02 + math.cos(2 * math.pi * i / 9) * 0.28, -0.01 + math.sin(2 * math.pi * i / 9) * 0.28, 0.52)) for i in range(9)]
    f = bm.faces.new(top_vs)
    for lp in f.loops:
        lp[uv].uv = (0.5, 0.5)
        lp[col] = (0.98, 0.90, 0.72, 1.0)
    mesh = bpy.data.meshes.new("stump_lod0")
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new("stump_lod0", mesh)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(make_pbr_mat("StumpBarkPBR", pine_bark, False, 0.92))
    export_glb([o], os.path.join(RAW_OUT, "stump_lod0.glb"))
    print("[stump] exported")

    # 2. Growing Sapling (2.2 m tall slender young tree)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(905)
    bm_t = bmesh.new()
    uv_t = bm_t.loops.layers.uv.new("UVMap")
    col_t = bm_t.loops.layers.color.new("Color")
    add_tapered_limb(bm_t, uv_t, col_t, [(0, 0, -0.2), (0.03, 0, 1.1), (-0.02, 0.02, 2.05)], [0.06, 0.04, 0.015], segs=6)
    mt = bpy.data.meshes.new("sapling_trunk")
    bm_t.to_mesh(mt)
    bm_t.free()
    ot = bpy.data.objects.new("sapling_trunk", mt)
    bpy.context.collection.objects.link(ot)
    ot.data.materials.append(make_pbr_mat("SaplingBarkPBR", pine_bark, False, 0.90))

    bm_c = bmesh.new()
    uv_c = bm_c.loops.layers.uv.new("UVMap")
    col_c = bm_c.loops.layers.color.new("Color")
    for p in [(0.0, 0.0, 1.55), (0.28, 0.2, 1.85), (-0.26, -0.18, 1.75), (0.0, 0.0, 2.15)]:
        add_foliage_cluster(bm_c, uv_c, col_c, p, 0.65, 2, Vector((0, 0, 1.8)), 0.9, rng)
    mc = bpy.data.meshes.new("sapling_canopy")
    bm_c.to_mesh(mc)
    bm_c.free()
    oc = bpy.data.objects.new("sapling_canopy", mc)
    bpy.context.collection.objects.link(oc)
    apply_spherical_normals(oc, Vector((0, 0, 1.8)))
    oc.data.materials.append(make_pbr_mat("SaplingLeavesCutout", birch_leaf, True, 0.78))
    export_glb([ot, oc], os.path.join(RAW_OUT, "sapling_lod0.glb"))
    print("[sapling] exported")

    # 3. Lake Shoreline Reed & Cattail Clump (vertex-colored stalks + dark brown cattail heads, 0 extra textures!)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(908)
    bm_r = bmesh.new()
    uv_r = bm_r.loops.layers.uv.new("UVMap")
    col_r = bm_r.loops.layers.color.new("Color")
    for i in range(18):
        ang = rng.uniform(0, 2 * math.pi)
        rad = rng.uniform(0.04, 0.58)
        bx, by = math.cos(ang) * rad, math.sin(ang) * rad
        h = rng.uniform(0.95, 1.58)
        lean_x = math.cos(ang) * rng.uniform(0.08, 0.34)
        lean_y = math.sin(ang) * rng.uniform(0.08, 0.34)
        # Two-segment tapering reed blade (quad strip)
        w0 = 0.036
        nx, ny = -math.sin(ang), math.cos(ang)
        v0 = bm_r.verts.new((bx - nx * w0, by - ny * w0, -0.18))
        v1 = bm_r.verts.new((bx + nx * w0, by + ny * w0, -0.18))
        v2 = bm_r.verts.new((bx + lean_x * 0.45 + nx * w0 * 0.7, by + lean_y * 0.45 + ny * w0 * 0.7, h * 0.55))
        v3 = bm_r.verts.new((bx + lean_x * 0.45 - nx * w0 * 0.7, by + lean_y * 0.45 - ny * w0 * 0.7, h * 0.55))
        v4 = bm_r.verts.new((bx + lean_x, by + lean_y, h))
        tone = rng.uniform(0.82, 1.08)
        c_bot = (0.14 * tone, 0.19 * tone, 0.08 * tone, 1.0)
        c_mid = (0.28 * tone, 0.34 * tone, 0.14 * tone, 1.0)
        c_tip = (0.48 * tone, 0.44 * tone, 0.22 * tone, 1.0)
        f1 = bm_r.faces.new([v0, v1, v2, v3])
        for lp, c in zip(f1.loops, [c_bot, c_bot, c_mid, c_mid]):
            lp[uv_r].uv = (0.5, 0.5)
            lp[col_r] = c
        f2 = bm_r.faces.new([v3, v2, v4])
        for lp, c in zip(f2.loops, [c_mid, c_mid, c_tip]):
            lp[uv_r].uv = (0.5, 0.5)
            lp[col_r] = c
        # Cattail cigar head on every 5th stalk
        if i % 5 == 0:
            ct = bmesh.ops.create_cone(
                bm_r, cap_ends=True, segments=5, radius1=0.036, radius2=0.032, depth=0.18,
                matrix=Matrix.Translation((bx + lean_x * 0.86, by + lean_y * 0.86, h * 0.86)),
            )
            for v in ct["verts"]:
                for f in v.link_faces:
                    for lp in f.loops:
                        lp[uv_r].uv = (0.5, 0.5)
                        lp[col_r] = (0.16, 0.10, 0.06, 1.0)
    mr = bpy.data.meshes.new("reeds_lod0")
    bm_r.to_mesh(mr)
    bm_r.free()
    or_obj = bpy.data.objects.new("reeds_lod0", mr)
    bpy.context.collection.objects.link(or_obj)
    mat_r = bpy.data.materials.new("LakeReedsMat")
    mat_r.use_nodes = True
    nt = mat_r.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.86
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Color"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    or_obj.data.materials.append(mat_r)
    export_glb([or_obj], os.path.join(RAW_OUT, "reeds_lod0.glb"))
    print("[reeds] exported")


def main():
    os.makedirs(RAW_OUT, exist_ok=True)
    pine_bark, pine_leaf = generate_pine_textures()
    birch_bark, birch_leaf = generate_birch_textures()

    for species, bp, lp, oscale, cz in [
        ("pine", pine_bark, pine_leaf, 13.0, 6.1),
        ("birch", birch_bark, birch_leaf, 11.2, 4.9),
    ]:
        for lod, suffix in [(0, "lod0"), (1, "lod1"), (2, "lod2"), (3, "shadow")]:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            objs = build_species(species, bp, lp, lod)
            if lod == 0:
                render_tree_impostor(objs[1], os.path.join(RAW_OUT, f"{species}_impostor.png"), ortho_scale=oscale, cam_z=cz)
            out_path = os.path.join(RAW_OUT, f"{species}_{suffix}.glb")
            export_glb(objs, out_path)
            tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
            print(f"[{species}] {suffix}: {tris} tris -> {out_path} ({os.path.getsize(out_path)//1024} KiB)")

    build_stump_and_sapling_and_reeds(pine_bark, birch_leaf)
    print("[build_trees_s4] ALL DONE")
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
