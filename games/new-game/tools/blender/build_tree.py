"""
Builds the realistic European Oak (`oak`, ~9.5 m tall) in Blender 4.2:
  - Flared buttress roots (sunk -0.18 m below ground so it never floats on slopes)
  - Gnarled curving trunk + primary boughs + secondary limbs using Poly Haven CC0 `jolcham_oak_bark_01`
  - Lush lobed oak-leaf twig spray cards (512x512 RGBA with RGB edge dilation so mipmaps never bleed dark)
  - Outward-bent spherical canopy normals + radial crown AO in COLOR_0 (0.38 core -> 1.0 sunlit rim)
  - Exports 3 LODs (`lod0`, `lod1`, `lod2`), coarse opaque `shadow` stand-in (R7), and a Cycles-rendered
    512x512 RGBA matte impostor (`oak_impostor.png`) for > 100 m distant trees.

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_tree.py
"""

import json
import math
import os
import random
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

RAW_OUT = "/tmp/marchland-src/raw_glb"
TEX_DIR = "/tmp/marchland-src/tree_tex"
SURF_DIR = "/tmp/marchland-src/surfaces_png"
IMPOSTOR_PNG = "/tmp/marchland-src/raw_glb/oak_impostor.png"
PREVIEW_JPG = "/tmp/marchland-src/raw_glb/oak_preview.jpg"


def generate_oak_leaf_atlas():
    """Creates a lush 512x512 RGBA oak twig spray texture with lobed oak leaves and RGB edge dilation."""
    os.makedirs(TEX_DIR, exist_ok=True)
    S = 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rng = random.Random(2026)

    # Central woody twig & side shoots
    twig_col = (74, 58, 42, 255)
    draw.line([(256, 488), (252, 280), (260, 108)], fill=twig_col, width=7)
    branches = [
        ((254, 410), (140, 320)),
        ((254, 395), (372, 305)),
        ((253, 305), (118, 200)),
        ((255, 290), (394, 192)),
        ((257, 200), (168, 108)),
        ((258, 195), (348, 102)),
    ]
    for p0, p1 in branches:
        draw.line([p0, p1], fill=twig_col, width=4)

    def draw_oak_leaf(cx, cy, length, width, angle_rad, base_rgb):
        """Draws a characteristic lobed European oak leaf (Quercus robur) with central midrib."""
        pts = []
        steps = 28
        ca, sa = math.cos(angle_rad), math.sin(angle_rad)
        for i in range(steps):
            t = i / steps
            # Parameter around leaf perimeter: 0..0.5 right side, 0.5..1.0 left side
            if t <= 0.5:
                u = t * 2.0  # 0 (stem) -> 1 (tip)
                side = 1.0
            else:
                u = (1.0 - t) * 2.0
                side = -1.0
            # Authentic sinusoidal oak lobes (4 pairs of rounded lobes)
            env = math.sin(math.pi * (u ** 0.78))
            lobe = 0.72 + 0.34 * math.sin(u * math.pi * 7.0) ** 2
            lx = u * length
            ly = side * width * env * lobe * (0.45 + 0.55 * u)
            px = cx + lx * ca - ly * sa
            py = cy + lx * sa + ly * ca
            pts.append((px, py))
        draw.polygon(pts, fill=(*base_rgb, 255))
        # Subtle brighter central vein
        vein_rgb = (min(255, base_rgb[0] + 18), min(255, base_rgb[1] + 22), min(255, base_rgb[2] + 8), 255)
        draw.line([(cx, cy), (cx + length * 0.85 * ca, cy + length * 0.85 * sa)], fill=vein_rgb, width=2)

    # Natural sunlit European late-summer / early-autumn oak greens (earthy, never neon, never muddy black!)
    palette = [
        (76, 102, 46),
        (88, 114, 52),
        (102, 124, 54),
        (68, 92, 42),
        (114, 126, 56),
        (134, 126, 58),  # warm early-autumn sunlit oak tips
    ]

    # Place 38 overlapping lobed oak leaves radiating cleanly from the twig skeleton
    leaf_anchors = []
    for p0, p1 in branches:
        for frac in (0.35, 0.65, 0.92):
            ax = p0[0] + (p1[0] - p0[0]) * frac
            ay = p0[1] + (p1[1] - p0[1]) * frac
            base_ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
            for d_ang in (-0.85, 0.0, 0.85):
                leaf_anchors.append((ax, ay, base_ang + d_ang + rng.uniform(-0.22, 0.22)))
    # Tip cluster at top of main shoot
    for d_ang in (-1.0, -0.45, 0.0, 0.45, 1.0):
        leaf_anchors.append((258 + rng.uniform(-12, 12), 118 + rng.uniform(-14, 14), -math.pi * 0.5 + d_ang))
    # Mid-stem filler leaves
    for y_c in (240, 340, 420):
        for side in (-1.0, 1.0):
            leaf_anchors.append((254 + side * 14, y_c, (-math.pi * 0.5) + side * rng.uniform(0.65, 1.25)))

    rng.shuffle(leaf_anchors)
    for ax, ay, ang in leaf_anchors:
        col = rng.choice(palette)
        col = (
            max(20, min(180, col[0] + rng.randint(-8, 8))),
            max(28, min(185, col[1] + rng.randint(-8, 8))),
            max(16, min(120, col[2] + rng.randint(-6, 6))),
        )
        draw_oak_leaf(ax, ay, rng.uniform(62, 92), rng.uniform(28, 42), ang, col)

    # Dilate RGB colors into transparent pixels (12 passes) so mipmaps NEVER bleed dark edges!
    arr = np.asarray(img, dtype=np.uint8).copy()
    rgb = arr[:, :, :3].astype(np.float32)
    alpha = arr[:, :, 3]
    mask = alpha > 16
    for _ in range(14):
        if np.all(mask):
            break
        # Simple 4-neighbor average into uncovered pixels
        sum_rgb = np.zeros_like(rgb)
        cnt = np.zeros((S, S), dtype=np.float32)
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            shifted_m = np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
            shifted_c = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            sum_rgb += shifted_c * shifted_m[:, :, None]
            cnt += shifted_m.astype(np.float32)
        fill = (~mask) & (cnt > 0)
        rgb[fill] = sum_rgb[fill] / cnt[fill, None]
        mask = mask | fill

    # Crisp alpha with slight soft edge anti-aliasing for coverage-preserving mip alpha
    out = np.zeros((S, S, 4), dtype=np.uint8)
    out[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    out[:, :, 3] = alpha
    leaf_path = f"{TEX_DIR}/oak_leaves.png"
    Image.fromarray(out, mode="RGBA").save(leaf_path)
    return leaf_path


def add_branch_tube(bm, uv_layer, col_layer, points, radii, segs, root_flare=False):
    """Lofts an organic tapering branch along `points` with flared roots and cylindrical bark UVs."""
    rings = []
    v_coord = 0.0
    for idx, (pt, rad) in enumerate(zip(points, radii)):
        p = Vector(pt)
        if idx == 0:
            tan = (Vector(points[1]) - p).normalized()
        elif idx == len(points) - 1:
            tan = (p - Vector(points[idx - 1])).normalized()
        else:
            tan = (Vector(points[idx + 1]) - Vector(points[idx - 1])).normalized()
            v_coord += (p - Vector(points[idx - 1])).length * 0.65
        if idx == 1:
            v_coord += (p - Vector(points[0])).length * 0.65

        up = Vector((1.0, 0.0, 0.0)) if abs(tan.x) < 0.85 else Vector((0.0, 1.0, 0.0))
        bx = tan.cross(up).normalized()
        by = bx.cross(tan).normalized()

        ring = []
        for s in range(segs):
            ang = (s / segs) * math.tau
            r_mod = rad
            if root_flare and idx <= 1:
                flare_t = 1.0 - idx * 0.55
                r_mod *= 1.0 + flare_t * (0.28 + 0.30 * max(0.0, math.cos(ang * 5.0)))
            pos = p + bx * (math.cos(ang) * r_mod) + by * (math.sin(ang) * r_mod)
            ring.append((bm.verts.new(pos), s / segs, v_coord))
        rings.append(ring)

    faces = []
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        ao0 = max(0.54, min(1.0, 0.58 + 0.42 * (i / max(1, len(rings) - 1))))
        ao1 = max(0.54, min(1.0, 0.58 + 0.42 * ((i + 1) / max(1, len(rings) - 1))))
        for s in range(segs):
            sn = (s + 1) % segs
            f = bm.faces.new([r0[s][0], r0[sn][0], r1[sn][0], r1[s][0]])
            f.smooth = True
            u0 = s / segs
            u1 = (s + 1) / segs
            uvs = [(u0, r0[s][2]), (u1, r0[sn][2]), (u1, r1[sn][2]), (u0, r1[s][2])]
            aos = [ao0, ao0, ao1, ao1]
            for lp, uv_val, ao_v in zip(f.loops, uvs, aos):
                lp[uv_layer].uv = uv_val
                lp[col_layer] = (ao_v, ao_v, ao_v, 1.0)
            faces.append(f)
    return faces


def build_oak_lod(lod: int, leaf_path: str):
    """Builds trunk/boughs + folded leaf spray cards (or coarse opaque shadow hull for lod=3)."""
    rng = random.Random(77)

    # Trunk spine (sunk -0.20 m into ground, rises gently curving to crown fork at 3.8 m)
    trunk_pts = [
        (0.00, 0.00, -0.20),
        (0.02, -0.01, 0.65),
        (0.08, 0.04, 1.65),
        (0.04, 0.08, 2.75),
        (-0.02, 0.04, 3.85),
    ]
    trunk_rads = [0.52, 0.38, 0.33, 0.29, 0.24]

    # 5 primary gnarled oak boughs radiating out into a wide 8.5 m umbrella crown
    bough_specs = [
        (0.15, 2.8, 3.4, 7.6),
        (1.38, 2.6, 3.8, 8.2),
        (2.58, 2.9, 3.5, 7.4),
        (3.85, 2.7, 3.9, 8.4),
        (5.15, 3.0, 3.3, 7.2),
    ]

    # ---------------- SHADOW STAND-IN (lod=3: coarse opaque trunk + irregular crown hull, R7) ----------------
    if lod == 3:
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        col = bm.loops.layers.float_color.new("Color")
        add_branch_tube(bm, uv, col, trunk_pts, trunk_rads, 6, root_flare=False)
        # Faceted irregular canopy mass (opaque shadow caster, ~96 tris total!)
        crown_spheres = [
            (Vector((0.0, 0.0, 6.6)), 3.1, 2.2),
            (Vector((1.8, 0.8, 5.7)), 2.2, 1.6),
            (Vector((-1.9, -0.9, 5.8)), 2.2, 1.6),
            (Vector((-0.8, 1.9, 5.9)), 2.0, 1.5),
            (Vector((1.2, -1.7, 5.6)), 2.0, 1.5),
        ]
        for center, r_xy, r_z in crown_spheres:
            ret = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            for v in ret["verts"]:
                v.co = Vector((v.co.x * r_xy + center.x, v.co.y * r_xy + center.y, v.co.z * r_z + center.z))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new("oak_shadow")
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("oak_shadow", mesh)
        bpy.context.collection.objects.link(obj)
        m = bpy.data.materials.new("ShadowMat")
        m.use_nodes = True
        obj.data.materials.append(m)
        return [obj]

    # ---------------- 1. TRUNK & BOUGHS MESH (Poly Haven jolcham_oak_bark_01) ----------------
    bm_wood = bmesh.new()
    uv_w = bm_wood.loops.layers.uv.new("UVMap")
    col_w = bm_wood.loops.layers.float_color.new("Color")

    t_segs = 10 if lod == 0 else (7 if lod == 1 else 5)
    b_segs = 7 if lod == 0 else (5 if lod == 1 else 4)
    add_branch_tube(bm_wood, uv_w, col_w, trunk_pts, trunk_rads, t_segs, root_flare=(lod < 2))

    # Central leader limb reaching high rounded crown dome (~8.9 m)
    leader_pts = [(-0.02, 0.04, 3.65), (-0.10, -0.08, 5.35), (0.04, 0.05, 7.15), (0.08, -0.04, 8.75)]
    add_branch_tube(bm_wood, uv_w, col_w, leader_pts, [0.22, 0.16, 0.10, 0.04], b_segs)

    canopy_anchors = [
        Vector(leader_pts[-1]),
        Vector(leader_pts[-2]),
        Vector((-0.85, 0.65, 8.55)),
        Vector((0.90, -0.55, 8.45)),
        Vector((0.15, 0.95, 8.20)),
        Vector((-0.25, -0.90, 8.25)),
    ]

    for az, z_start, reach, z_top in bough_specs:
        dx, dy = math.cos(az), math.sin(az)
        p0 = Vector((0.0, 0.0, z_start))
        p1 = Vector((dx * reach * 0.42, dy * reach * 0.42, z_start + (z_top - z_start) * 0.42))
        p2 = Vector((dx * reach * 0.80, dy * reach * 0.80, z_start + (z_top - z_start) * 0.78))
        p3 = Vector((dx * reach * 1.05, dy * reach * 1.05, z_top))
        add_branch_tube(bm_wood, uv_w, col_w, [p0, p1, p2, p3], [0.20, 0.15, 0.10, 0.04], b_segs)
        canopy_anchors.extend([p1, p2, p3])

        # Secondary forks off each primary bough (LOD0 & LOD1)
        if lod < 2:
            for side in (-1.0, 1.0):
                sub_az = az + side * rng.uniform(0.45, 0.72)
                sdx, sdy = math.cos(sub_az), math.sin(sub_az)
                sp0 = p1.lerp(p2, rng.uniform(0.25, 0.75))
                sp1 = sp0 + Vector((sdx * 1.15, sdy * 1.15, rng.uniform(0.55, 1.05)))
                sp2 = sp1 + Vector((sdx * 0.85, sdy * 0.85, rng.uniform(0.35, 0.85)))
                add_branch_tube(bm_wood, uv_w, col_w, [sp0, sp1, sp2], [0.10, 0.065, 0.03], max(4, b_segs - 2))
                canopy_anchors.extend([sp1, sp2])

    bmesh.ops.recalc_face_normals(bm_wood, faces=bm_wood.faces)
    mesh_wood = bpy.data.meshes.new(f"oak_trunk_lod{lod}")
    bm_wood.to_mesh(mesh_wood)
    bm_wood.free()

    # Convert wood Color to BYTE_COLOR active for glTF export
    w_vals = [tuple(c.color) for c in mesh_wood.color_attributes["Color"].data]
    mesh_wood.color_attributes.remove(mesh_wood.color_attributes["Color"])
    w_col = mesh_wood.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for i, c in enumerate(w_vals):
        w_col.data[i].color = c
    mesh_wood.color_attributes.active_color_index = 0
    mesh_wood.color_attributes.render_color_index = 0

    obj_wood = bpy.data.objects.new(f"oak_trunk_lod{lod}", mesh_wood)
    bpy.context.collection.objects.link(obj_wood)

    # Bark PBR material: full Poly Haven textures on LOD0; lightweight named placeholder on LOD1/LOD2 (shared at runtime)
    mat_bark = bpy.data.materials.new("OakBarkPBR")
    mat_bark.use_nodes = True
    nt = mat_bark.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vcol_w = nt.nodes.new("ShaderNodeVertexColor")
    vcol_w.layer_name = "Color"
    if lod == 0:
        tex_b_alb = nt.nodes.new("ShaderNodeTexImage")
        tex_b_alb.image = bpy.data.images.load(f"{SURF_DIR}/bark_albedo.png", check_existing=True)
        tex_b_alb.image.colorspace_settings.name = "sRGB"
        tex_b_nor = nt.nodes.new("ShaderNodeTexImage")
        tex_b_nor.image = bpy.data.images.load(f"{SURF_DIR}/bark_normal.png", check_existing=True)
        tex_b_nor.image.colorspace_settings.name = "Non-Color"
        mul_w = nt.nodes.new("ShaderNodeMix")
        mul_w.data_type = "RGBA"
        mul_w.blend_type = "MULTIPLY"
        mul_w.inputs[0].default_value = 1.0
        nt.links.new(tex_b_alb.outputs["Color"], mul_w.inputs[6])
        nt.links.new(vcol_w.outputs["Color"], mul_w.inputs[7])
        nt.links.new(mul_w.outputs[2], bsdf.inputs["Base Color"])
        nmap_w = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex_b_nor.outputs["Color"], nmap_w.inputs["Color"])
        nt.links.new(nmap_w.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        nt.links.new(vcol_w.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.90
    obj_wood.data.materials.append(mat_bark)

    # ---------------- 2. LAYERED OAK LEAF SPRAY CARDS (OUTWARD CANOPY NORMALS + RADIAL AO) ----------------
    bm_leaf = bmesh.new()
    uv_l = bm_leaf.loops.layers.uv.new("UVMap")
    col_l = bm_leaf.loops.layers.float_color.new("Color")

    crown_center = Vector((0.0, 0.0, 6.45))
    crown_radius = 4.35
    clusters_per_anchor = 7 if lod == 0 else (4 if lod == 1 else 2)
    card_scale = 1.55 if lod == 0 else (1.95 if lod == 1 else 2.55)

    for anchor in canopy_anchors:
        for _ in range(clusters_per_anchor):
            off = Vector((rng.uniform(-1.35, 1.35), rng.uniform(-1.35, 1.35), rng.uniform(-0.80, 1.10)))
            pos = anchor + off
            # Keep foliage above lower boughs (Z >= 3.45 m)
            pos.z = max(3.45, pos.z)
            # Radial crown distance determines baked AO (0.56 dappled core -> 1.0 sunlit outer rim!)
            rel = pos - crown_center
            radial_t = min(1.0, (Vector((rel.x / crown_radius, rel.y / crown_radius, rel.z / (crown_radius * 0.72)))).length)
            height_t = max(0.0, min(1.0, (pos.z - 3.4) / 6.2))
            ao = max(0.56, min(1.0, 0.56 + 0.28 * radial_t + 0.20 * height_t))
            # Subtle warm sunlit highlight on upper outer leaves
            warm_r = 1.0 + 0.08 * height_t * radial_t
            warm_g = 1.0 + 0.05 * height_t
            warm_b = 1.0 - 0.05 * height_t * radial_t

            # Two crossed gently curved cards per leaf cluster (4 tris per card -> 8 tris per cluster)
            size = card_scale * rng.uniform(0.78, 1.24)
            base_yaw = rng.uniform(0.0, math.tau)
            for cross_idx in range(2 if lod < 2 else 1):
                rot = Euler(
                    (
                        rng.uniform(-0.75, 0.75),
                        rng.uniform(-0.75, 0.75),
                        base_yaw + cross_idx * (math.pi * 0.5 + rng.uniform(-0.2, 0.2)),
                    ),
                    "XYZ",
                ).to_matrix()
                # Slightly cupped 2-quad folded leaf spray so it catches light from multiple angles
                hs = size * 0.5
                bend = size * 0.14
                local_pts = [
                    Vector((-hs, 0.0, -hs)),
                    Vector((0.0, bend, -hs)),
                    Vector((hs, 0.0, -hs)),
                    Vector((-hs, 0.0, hs)),
                    Vector((0.0, bend, hs)),
                    Vector((hs, 0.0, hs)),
                ]
                vs = [bm_leaf.verts.new(pos + rot @ lp) for lp in local_pts]
                f1 = bm_leaf.faces.new([vs[0], vs[1], vs[4], vs[3]])
                f2 = bm_leaf.faces.new([vs[1], vs[2], vs[5], vs[4]])
                uvs_1 = [(0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (0.0, 1.0)]
                uvs_2 = [(0.5, 0.0), (1.0, 0.0), (1.0, 1.0), (0.5, 1.0)]
                for f_card, f_uvs in ((f1, uvs_1), (f2, uvs_2)):
                    f_card.smooth = True
                    for lp, uvv in zip(f_card.loops, f_uvs):
                        lp[uv_l].uv = uvv
                        lp[col_l] = (min(1.0, ao * warm_r), min(1.0, ao * warm_g), min(1.0, ao * warm_b), 1.0)

    mesh_leaf = bpy.data.meshes.new(f"oak_canopy_lod{lod}")
    bm_leaf.to_mesh(mesh_leaf)
    bm_leaf.free()

    # Convert leaf Color to BYTE_COLOR active
    l_vals = [tuple(c.color) for c in mesh_leaf.color_attributes["Color"].data]
    mesh_leaf.color_attributes.remove(mesh_leaf.color_attributes["Color"])
    l_col = mesh_leaf.color_attributes.new("Color", "BYTE_COLOR", "CORNER")
    for i, c in enumerate(l_vals):
        l_col.data[i].color = c
    mesh_leaf.color_attributes.active_color_index = 0
    mesh_leaf.color_attributes.render_color_index = 0

    # Bend canopy vertex normals radially outward from crown center (smooth volumetric sunlight across foliage!)
    custom_normals = []
    for poly in mesh_leaf.polygons:
        for li in poly.loop_indices:
            vi = mesh_leaf.loops[li].vertex_index
            vpos = mesh_leaf.vertices[vi].co
            out_n = (vpos - crown_center)
            out_n.z *= 1.15
            if out_n.length < 1e-4:
                out_n = Vector((0.0, 0.0, 1.0))
            else:
                out_n.normalize()
            custom_normals.append(out_n)
    mesh_leaf.normals_split_custom_set(custom_normals)

    obj_leaf = bpy.data.objects.new(f"oak_canopy_lod{lod}", mesh_leaf)
    bpy.context.collection.objects.link(obj_leaf)

    mat_leaf = bpy.data.materials.new("OakLeavesCutout")
    mat_leaf.use_nodes = True
    mat_leaf.blend_method = "CLIP"
    mat_leaf.alpha_threshold = 0.45
    mat_leaf.use_backface_culling = False
    nt = mat_leaf.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vcol_l = nt.nodes.new("ShaderNodeVertexColor")
    vcol_l.layer_name = "Color"
    if lod == 0:
        tex_l = nt.nodes.new("ShaderNodeTexImage")
        tex_l.image = bpy.data.images.load(leaf_path, check_existing=True)
        tex_l.image.colorspace_settings.name = "sRGB"
        mul_l = nt.nodes.new("ShaderNodeMix")
        mul_l.data_type = "RGBA"
        mul_l.blend_type = "MULTIPLY"
        mul_l.inputs[0].default_value = 1.0
        nt.links.new(tex_l.outputs["Color"], mul_l.inputs[6])
        nt.links.new(vcol_l.outputs["Color"], mul_l.inputs[7])
        nt.links.new(mul_l.outputs[2], bsdf.inputs["Base Color"])
        nt.links.new(tex_l.outputs["Alpha"], bsdf.inputs["Alpha"])
    else:
        nt.links.new(vcol_l.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.74
    obj_leaf.data.materials.append(mat_leaf)

    return [obj_wood, obj_leaf]


def render_tree_impostor_and_preview(obj_leaf):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.transparent_max_bounces = 32

    # Temporarily add 42% sunlit leaf translucency + subtle ambient bounce in Cycles so impostor matches real-time brightness
    mat_leaf = obj_leaf.data.materials[0]
    nt = mat_leaf.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    out_node = nt.nodes["Material Output"]
    base_col_sock = bsdf.inputs["Base Color"].links[0].from_socket
    alpha_sock = bsdf.inputs["Alpha"].links[0].from_socket

    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(base_col_sock, trans.inputs["Color"])
    mix_s = nt.nodes.new("ShaderNodeMixShader")
    mix_s.inputs["Fac"].default_value = 0.42
    nt.links.new(bsdf.outputs["BSDF"], mix_s.inputs[1])
    nt.links.new(trans.outputs["BSDF"], mix_s.inputs[2])

    # Small emission lift (0.14) simulates multi-scattered green canopy glow inside deep foliage
    emis = nt.nodes.new("ShaderNodeEmission")
    emis.inputs["Strength"].default_value = 0.16
    nt.links.new(base_col_sock, emis.inputs["Color"])
    add_s = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(mix_s.outputs["Shader"], add_s.inputs[0])
    nt.links.new(emis.outputs["Emission"], add_s.inputs[1])

    # Apply alpha cutout cleanly outside the translucent mix
    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    alpha_mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(alpha_sock, alpha_mix.inputs["Fac"])
    nt.links.new(transp.outputs["BSDF"], alpha_mix.inputs[1])
    nt.links.new(add_s.outputs["Shader"], alpha_mix.inputs[2])
    nt.links.new(alpha_mix.outputs["Shader"], out_node.inputs["Surface"])

    world = bpy.data.worlds.new("TreeWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.48, 0.58, 0.74, 1.0)
    bg.inputs["Strength"].default_value = 1.25

    sun_d = bpy.data.lights.new("TreeSun", type="SUN")
    sun_d.energy = 4.0
    sun_d.color = (1.0, 0.94, 0.84)
    sun_o = bpy.data.objects.new("TreeSun", sun_d)
    sun_dir = (Vector((0.0, 0.0, 5.0)) - Vector((10.0, -14.0, 14.0))).normalized()
    sun_o.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(sun_o)

    cam_d = bpy.data.cameras.new("TreeCam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 11.8
    cam_o = bpy.data.objects.new("TreeCam", cam_d)
    cam_o.location = Vector((0.0, -18.0, 5.4))
    cam_o.rotation_euler = (Vector((0.0, 0.0, 5.4)) - cam_o.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam_o)
    scene.camera = cam_o

    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.filepath = IMPOSTOR_PNG
    bpy.ops.render.render(write_still=True)

    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.filepath = PREVIEW_JPG
    bpy.ops.render.render(write_still=True)

    # Restore clean Principled BSDF link before glTF export
    nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])
    nt.nodes.remove(alpha_mix)
    nt.nodes.remove(transp)
    nt.nodes.remove(add_s)
    nt.nodes.remove(emis)
    nt.nodes.remove(mix_s)
    nt.nodes.remove(trans)

    bpy.data.objects.remove(sun_o, do_unlink=True)
    bpy.data.objects.remove(cam_o, do_unlink=True)


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
    leaf_path = generate_oak_leaf_atlas()
    summary = {}
    for lod, suffix in [(0, "lod0"), (1, "lod1"), (2, "lod2"), (3, "shadow")]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        objs = build_oak_lod(lod, leaf_path)
        if lod == 0:
            render_tree_impostor_and_preview(objs[1])
        out_path = os.path.join(RAW_OUT, f"oak_{suffix}.glb")
        export_glb(objs, out_path)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
        verts = sum(len(o.data.vertices) for o in objs)
        summary[suffix] = {"tris": tris, "verts": verts, "bytes": os.path.getsize(out_path)}
        print(f"[oak] {suffix}: {tris} tris, {verts} verts -> {out_path} ({os.path.getsize(out_path)//1024} KiB)")

    print("[oak] DONE:", json.dumps(summary, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
