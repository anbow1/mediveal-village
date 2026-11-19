"""
Builds the realistic XIII-XIV c. half-timbered medieval peasant cottage (`house_l1`) in Blender 4.2:
  - 11 x 11 m plot centered at (0, 0, 0), front door facing -Y (Blender) / +Z (glTF), grounded at Z = 0
  - Box-projected real-world UVs matching Poly Haven surface dimensions (UV0)
  - Layer index (0..11) & forged-iron metal flag encoded in UV1: (layer / 15.0, metalFlag)
  - Real Blender Cycles CPU Ambient Occlusion baked to vertex colour (COLOR_0) combined with subtle weathering
  - Exports 3 LODs (`lod0`, `lod1`, `lod2`), coarse opaque shadow stand-in (`shadow`), and a Cycles-rendered
    512x512 RGBA impostor sprite (`house_l1_impostor.png`) for > 100 m matte distant cards.

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_house.py
"""

import json
import math
import os
import random
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

REPO_ROOT = "/home/antigravity/anbow1/mediveal-village"
META_PATH = "/tmp/marchland-src/surfaces_png/surfaces_meta.json"
RAW_OUT = "/tmp/marchland-src/raw_glb"
IMPOSTOR_PNG = "/tmp/marchland-src/raw_glb/house_l1_impostor.png"
PREVIEW_JPG = "/tmp/marchland-src/raw_glb/house_l1_preview.jpg"

# Layer indices (must match public/assets/surfaces/index.json)
LAYERS = {
    "grass": 0,
    "dirt": 1,
    "cobble": 2,
    "plaster": 3,
    "beam": 4,
    "boards": 5,
    "thatch": 6,
    "shingles": 7,
    "rubble": 8,
    "ashlar": 9,
    "bark": 10,
    "linen": 11,
}

if os.path.exists(META_PATH):
    with open(META_PATH, "r", encoding="utf-8") as f:
        SURFACE_META = {row["id"]: row for row in json.load(f)}
else:
    idx_path = os.path.join(REPO_ROOT, "games/new-game/public/assets/surfaces/index.json")
    with open(idx_path, "r", encoding="utf-8") as f:
        SURFACE_META = {row["id"]: row for row in json.load(f)["layers"]}

TILE_M = {k: float(SURFACE_META[k]["tileSizeM"]) for k in LAYERS}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def hash_noise(x, y, z, seed=13):
    v = math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 19.19) * 43758.5453
    return (v - math.floor(v)) * 2.0 - 1.0


class MeshBuilder:
    """Accumulates tagged geometry with per-face surface layer, metal flag, tint RGB, and real-world box UVs."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv0_layer = self.bm.loops.layers.uv.new("UVMap")
        self.uv1_layer = self.bm.loops.layers.uv.new("UVLayer")
        self.tint_layer = self.bm.loops.layers.float_color.new("Tint")
        self.face_meta = {}  # face -> (layer_id, metal_flag, tint_rgb, uv_rot_deg, uv_scale)

    def _tag_faces(self, faces, layer_name, tint=(1.0, 1.0, 1.0), metal=0.0, uv_rot=0.0, uv_scale=1.0):
        lid = LAYERS[layer_name]
        for f in faces:
            self.face_meta[f] = (lid, metal, tint, uv_rot, uv_scale)

    def add_box(
        self,
        center,
        size,
        layer_name,
        rot_euler=(0.0, 0.0, 0.0),
        tint=(1.0, 1.0, 1.0),
        metal=0.0,
        bevel=0.0,
        wobble=0.0,
        uv_rot=0.0,
        uv_scale=1.0,
        taper_top=(1.0, 1.0),
        seed=1,
    ):
        sx, sy, sz = size
        prev_faces = set(self.bm.faces)
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = ret["verts"]
        for v in verts:
            px, py, pz = v.co.x * sx, v.co.y * sy, v.co.z * sz
            if pz > 0.0:
                px *= taper_top[0]
                py *= taper_top[1]
            v.co = Vector((px, py, pz))

        if bevel > 0.0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(
                self.bm,
                geom=edges,
                offset=bevel,
                segments=1,
                affect="EDGES",
                clamp_overlap=True,
            )

        rot_m = Euler(rot_euler, "XYZ").to_matrix().to_4x4()
        trans_m = Matrix.Translation(Vector(center))
        xform = trans_m @ rot_m

        new_faces = [f for f in self.bm.faces if f not in prev_faces]
        all_verts = list({v for f in new_faces for v in f.verts})

        for v in all_verts:
            p = xform @ v.co
            if wobble > 0.0:
                p.x += hash_noise(p.x, p.y, p.z, seed) * wobble
                p.y += hash_noise(p.y, p.z, p.x, seed + 7) * wobble
                p.z += hash_noise(p.z, p.x, p.y, seed + 17) * wobble * 0.5
            v.co = p

        self._tag_faces(new_faces, layer_name, tint=tint, metal=metal, uv_rot=uv_rot, uv_scale=uv_scale)
        return new_faces

    def add_beam(self, p0, p1, width, thickness, layer_name="beam", tint=(0.96, 0.94, 0.91), wobble=0.008, seed=3):
        v0, v1 = Vector(p0), Vector(p1)
        delta = v1 - v0
        length = delta.length
        if length < 1e-4:
            return
        mid = (v0 + v1) * 0.5
        axis = delta.normalized()
        up = Vector((0.0, 0.0, 1.0))
        if abs(axis.dot(up)) > 0.98:
            up = Vector((0.0, 1.0, 0.0))
        side = axis.cross(up).normalized()
        ortho = side.cross(axis).normalized()
        rot_mat = Matrix((axis, side, ortho)).transposed().to_4x4()

        prev_faces = set(self.bm.faces)
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = ret["verts"]
        for v in verts:
            v.co = Vector((v.co.x * length, v.co.y * width, v.co.z * thickness))
        # Subtle bevel on beams catches specular edge highlights
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(self.bm, geom=edges, offset=min(width, thickness) * 0.08, segments=1, affect="EDGES", clamp_overlap=True)
        new_faces = [f for f in self.bm.faces if f not in prev_faces]
        all_verts = list({v for f in new_faces for v in f.verts})
        xform = Matrix.Translation(mid) @ rot_mat
        for v in all_verts:
            p = xform @ v.co
            if wobble > 0.0:
                p.x += hash_noise(p.x, p.y, p.z, seed) * wobble
                p.y += hash_noise(p.y, p.z, p.x, seed + 5) * wobble
            v.co = p
        self._tag_faces(new_faces, layer_name, tint=tint, uv_rot=0.0, uv_scale=1.0)

    def add_cylinder(
        self,
        p0,
        p1,
        r0,
        r1,
        segments,
        layer_name,
        tint=(1.0, 1.0, 1.0),
        metal=0.0,
        cap_ends=True,
    ):
        v0, v1 = Vector(p0), Vector(p1)
        delta = v1 - v0
        length = delta.length
        if length < 1e-4:
            return
        mid = (v0 + v1) * 0.5
        axis = delta.normalized()
        rot_q = Vector((0.0, 0.0, 1.0)).rotation_difference(axis)
        xform = Matrix.Translation(mid) @ rot_q.to_matrix().to_4x4()
        ret = bmesh.ops.create_cone(
            self.bm,
            cap_ends=cap_ends,
            cap_tris=False,
            segments=segments,
            radius1=r0,
            radius2=r1,
            depth=length,
        )
        verts = ret["verts"]
        for v in verts:
            v.co = xform @ v.co
        new_faces = list({f for v in verts for f in v.link_faces})
        self._tag_faces(new_faces, layer_name, tint=tint, metal=metal)

    def add_gable_prism(self, x_half, y_half, z_base, z_ridge, layer_name="plaster", tint=(1.0, 0.98, 0.93)):
        """Triangular gable prism spanning X: [-x_half, +x_half], Y: [-y_half, +y_half], Z: z_base -> z_ridge."""
        pts = [
            (-x_half, -y_half, z_base),
            (x_half, -y_half, z_base),
            (x_half, y_half, z_base),
            (-x_half, y_half, z_base),
            (-x_half, 0.0, z_ridge),
            (x_half, 0.0, z_ridge),
        ]
        vs = [self.bm.verts.new(p) for p in pts]
        quad_indices = [
            (0, 1, 5, 4),  # front slope
            (2, 3, 4, 5),  # back slope
            (3, 0, 4),     # west gable (-X)
            (1, 2, 5),     # east gable (+X)
            (3, 2, 1, 0),  # bottom
        ]
        faces = []
        for idxs in quad_indices:
            faces.append(self.bm.faces.new([vs[i] for i in idxs]))
        self._tag_faces(faces, layer_name, tint=tint)
        return faces

    def add_thatch_roof(
        self,
        x_half,
        y_eave,
        z_eave,
        z_ridge,
        thickness=0.40,
        x_segs=12,
        sag_m=0.055,
        eave_curl=0.10,
        detail=True,
    ):
        """
        Builds a thick, organic overhanging reed-thatch roof with:
          - gently sagged ridge line
          - rounded overhanging eaves
          - layered overhang skirt & thick rounded ridge cap
          - organic hand-laid surface variation
        """
        # Cross-section loop in YZ plane (closed profile around roof blanket, 12 points for detail / 6 for coarse)
        slope_vec = Vector((0.0, -y_eave, z_eave - z_ridge)).normalized()
        # Outward normal on front (-Y) slope
        n_front = Vector((0.0, -(z_ridge - z_eave), y_eave)).normalized()
        n_back = Vector((0.0, (z_ridge - z_eave), y_eave)).normalized()

        def make_ring(t_x):
            x = -x_half + 2.0 * x_half * t_x
            # Authentic gentle medieval ridge sag (deepest in middle, anchored at gables)
            sag = -sag_m * math.sin(math.pi * t_x)
            # Slight organic undulation along the eaves
            wave_f = 0.025 * math.sin(t_x * math.pi * 5.0 + 0.4) if detail else 0.0
            wave_b = 0.025 * math.cos(t_x * math.pi * 4.5 + 1.1) if detail else 0.0

            # Outer top profile (front eave -> mid -> ridge -> mid -> back eave)
            # Inner soffit profile (returns underneath)
            r_top = Vector((x, 0.0, z_ridge + thickness * 0.92 + sag))
            r_in = Vector((x, 0.0, z_ridge - 0.04 + sag * 0.8))

            # Front slope (-Y)
            f_eave_in = Vector((x, -y_eave + 0.06, z_eave - 0.02 + wave_f))
            f_eave_lip = Vector((x, -y_eave - eave_curl * 0.45, z_eave + thickness * 0.36 + wave_f))
            f_eave_top = Vector((x, -y_eave + 0.04, z_eave + thickness * 0.88 + wave_f))
            f_mid_top = Vector((x, -y_eave * 0.52, (z_eave + z_ridge) * 0.5 + thickness * 0.96 + sag * 0.6 + wave_f * 0.5))

            # Back slope (+Y)
            b_mid_top = Vector((x, y_eave * 0.52, (z_eave + z_ridge) * 0.5 + thickness * 0.96 + sag * 0.6 + wave_b * 0.5))
            b_eave_top = Vector((x, y_eave - 0.04, z_eave + thickness * 0.88 + wave_b))
            b_eave_lip = Vector((x, y_eave + eave_curl * 0.45, z_eave + thickness * 0.36 + wave_b))
            b_eave_in = Vector((x, y_eave - 0.06, z_eave - 0.02 + wave_b))

            if detail:
                f_upper_top = Vector((x, -y_eave * 0.16, z_ridge - (z_ridge - z_eave) * 0.15 + thickness * 0.98 + sag * 0.95))
                b_upper_top = Vector((x, y_eave * 0.16, z_ridge - (z_ridge - z_eave) * 0.15 + thickness * 0.98 + sag * 0.95))
                pts = [
                    f_eave_in,
                    f_eave_lip,
                    f_eave_top,
                    f_mid_top,
                    f_upper_top,
                    r_top,
                    b_upper_top,
                    b_mid_top,
                    b_eave_top,
                    b_eave_lip,
                    b_eave_in,
                    r_in,
                ]
            else:
                pts = [f_eave_in, f_eave_top, r_top, b_eave_top, b_eave_in, r_in]

            return [self.bm.verts.new(p) for p in pts]

        rings = [make_ring(i / x_segs) for i in range(x_segs + 1)]
        faces = []
        n_pts = len(rings[0])
        for i in range(x_segs):
            r0, r1 = rings[i], rings[i + 1]
            for j in range(n_pts):
                jn = (j + 1) % n_pts
                faces.append(self.bm.faces.new([r0[j], r1[j], r1[jn], r0[jn]]))

        # Cap west (-X) and east (+X) gable overhang ends cleanly
        faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        faces.append(self.bm.faces.new(rings[-1]))

        self._tag_faces(faces, "thatch", tint=(0.97, 0.95, 0.90), uv_scale=1.0)

        # Ridge cap roll (thick bundled reed roll crowning the crest)
        if detail:
            cap_segs = max(6, x_segs)
            cap_rings = []
            for i in range(cap_segs + 1):
                t = i / cap_segs
                x = -(x_half + 0.04) + 2.0 * (x_half + 0.04) * t
                sag = -sag_m * math.sin(math.pi * t)
                cz = z_ridge + thickness * 0.94 + sag
                ring = []
                for k in range(8):
                    ang = (k / 8.0) * math.tau
                    ry = math.cos(ang) * 0.25
                    rz = math.sin(ang) * 0.16
                    ring.append(self.bm.verts.new((x, ry, cz + rz)))
                cap_rings.append(ring)
            cap_faces = []
            for i in range(cap_segs):
                for k in range(8):
                    kn = (k + 1) % 8
                    cap_faces.append(self.bm.faces.new([cap_rings[i][k], cap_rings[i + 1][k], cap_rings[i + 1][kn], cap_rings[i][kn]]))
            cap_faces.append(self.bm.faces.new(list(reversed(cap_rings[0]))))
            cap_faces.append(self.bm.faces.new(cap_rings[-1]))
            self._tag_faces(cap_faces, "thatch", tint=(0.86, 0.83, 0.77))

            # Lashed oak ridge poles & crossed rider pegs (authentic Central European thatch detail)
            for side_s in (-1.0, 1.0):
                self.add_beam(
                    (-x_half + 0.15, side_s * 0.30, z_ridge + thickness * 0.78),
                    (x_half - 0.15, side_s * 0.30, z_ridge + thickness * 0.78),
                    0.065,
                    0.065,
                    layer_name="bark",
                    tint=(0.78, 0.74, 0.68),
                    wobble=0.006,
                )
            num_riders = 8
            for i in range(num_riders):
                t = (i + 0.5) / num_riders
                rx = -(x_half - 0.35) + 2.0 * (x_half - 0.35) * t
                sag = -sag_m * math.sin(math.pi * t)
                rz = z_ridge + thickness * 0.96 + sag
                self.add_beam(
                    (rx - 0.03, -0.44, rz - 0.28),
                    (rx - 0.03, 0.14, rz + 0.26),
                    0.055,
                    0.055,
                    layer_name="beam",
                    tint=(0.80, 0.76, 0.70),
                    wobble=0.004,
                )
                self.add_beam(
                    (rx + 0.03, 0.44, rz - 0.28),
                    (rx + 0.03, -0.14, rz + 0.26),
                    0.055,
                    0.055,
                    layer_name="beam",
                    tint=(0.80, 0.76, 0.70),
                    wobble=0.004,
                )

    def finalize_object(self, name):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)

        # Assign box-projected UVs (UV0), (layer/15, metal) (UV1), and per-loop Tint
        for f in self.bm.faces:
            lid, metal, tint, uv_rot, uv_scale = self.face_meta.get(f, (LAYERS["plaster"], 0.0, (1.0, 1.0, 1.0), 0.0, 1.0))
            # Find tile size by layer id
            layer_name = next((k for k, v in LAYERS.items() if v == lid), "plaster")
            tile = max(0.25, TILE_M[layer_name] * uv_scale)
            n = f.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            cos_r = math.cos(math.radians(uv_rot))
            sin_r = math.sin(math.radians(uv_rot))

            for loop in f.loops:
                p = loop.vert.co
                if az >= ax and az >= ay:
                    u, v = p.x / tile, p.y / tile
                elif ax >= ay:
                    u, v = p.y / tile, p.z / tile
                else:
                    u, v = p.x / tile, p.z / tile
                if uv_rot != 0.0:
                    ru = u * cos_r - v * sin_r
                    rv = u * sin_r + v * cos_r
                    u, v = ru, rv
                loop[self.uv0_layer].uv = (u, v)
                loop[self.uv1_layer].uv = (lid / 15.0, metal)

                # Subtle grounded dampness / moss near ground level (Z < 0.50 m) and chimney soot at top (Z > 5.7 m)
                tr, tg, tb = tint
                if p.z < 0.50 and lid in (LAYERS["rubble"], LAYERS["ashlar"], LAYERS["plaster"], LAYERS["beam"]):
                    ground_t = max(0.0, min(1.0, p.z / 0.50))
                    damp = 0.76 + 0.24 * ground_t
                    tr *= damp * 0.96
                    tg *= damp * 1.01
                    tb *= damp * 0.90
                if p.z > 5.65 and lid in (LAYERS["ashlar"], LAYERS["rubble"]):
                    soot_t = max(0.0, min(1.0, (p.z - 5.65) / 0.65))
                    soot = 1.0 - 0.45 * soot_t
                    tr *= soot
                    tg *= soot
                    tb *= soot
                loop[self.tint_layer] = (tr, tg, tb, 1.0)

        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()

        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj


def build_window(mb, cx, cy, cz, normal_dir, width=0.82, height=0.92, shutter_open_l=125, shutter_open_r=140, detail=True):
    """Recessed medieval mullioned window with oak frame, dark leaded glass, stone sill, and hinged plank shutters."""
    # normal_dir: 'front' (-Y), 'back' (+Y), 'west' (-X), 'east' (+X)
    rot_z = {"front": 0.0, "east": math.pi * 0.5, "back": math.pi, "west": -math.pi * 0.5}[normal_dir]
    rot_m = Matrix.Rotation(rot_z, 4, "Z")

    def to_world(lx, ly, lz):
        v = rot_m @ Vector((lx, ly, lz))
        return (cx + v.x, cy + v.y, cz + v.z)

    # Outer timber frame (sill, head, 2 jambs)
    frame_d = 0.16
    beam_w = 0.095
    # Projecting sill
    mb.add_box(to_world(0.0, -0.05, -height * 0.5 - 0.045), (width + 0.18, frame_d + 0.09, 0.09), "beam", rot_euler=(0, 0, rot_z), tint=(0.82, 0.78, 0.73), bevel=0.01)
    # Head lintel
    mb.add_box(to_world(0.0, -0.02, height * 0.5 + 0.05), (width + 0.16, frame_d + 0.04, 0.10), "beam", rot_euler=(0, 0, rot_z), tint=(0.84, 0.80, 0.75), bevel=0.01)
    # Left & right jambs
    for sx in (-1.0, 1.0):
        mb.add_box(to_world(sx * (width * 0.5 + beam_w * 0.4), -0.01, 0.0), (beam_w, frame_d, height + 0.04), "beam", rot_euler=(0, 0, rot_z), tint=(0.85, 0.81, 0.76))

    # Recessed dark smoky leaded glazing pane (deep behind beams so shadow rim reads crisp)
    mb.add_box(to_world(0.0, 0.045, 0.0), (width - 0.02, 0.03, height - 0.02), "shingles", rot_euler=(0, 0, rot_z), tint=(0.13, 0.15, 0.18), metal=0.25)

    # Cross mullions
    mb.add_box(to_world(0.0, 0.01, 0.0), (0.05, 0.06, height - 0.02), "beam", rot_euler=(0, 0, rot_z), tint=(0.88, 0.84, 0.78))
    mb.add_box(to_world(0.0, 0.01, 0.05), (width - 0.02, 0.06, 0.05), "beam", rot_euler=(0, 0, rot_z), tint=(0.88, 0.84, 0.78))

    if not detail:
        return

    # Hinged wooden plank shutters swung open beside the window
    sh_w = width * 0.50
    for side, open_deg in ((-1.0, shutter_open_l), (1.0, shutter_open_r)):
        hinge_x = side * (width * 0.5 + 0.04)
        hinge_y = -0.08
        ang = rot_z + side * math.radians(open_deg)
        # Offset shutter center along its swung angle
        local_ang = side * math.radians(open_deg)
        dx = -side * math.cos(local_ang) * (sh_w * 0.5)
        dy = -math.sin(abs(local_ang)) * (sh_w * 0.5)
        # Keep shutter outside the wall (-Y is outward)
        # Swing outward from closed (-side toward center) to open (away from window):
        # Closed direction from hinge: (-side, 0). Rotated outward by open_deg:
        open_rad = math.radians(open_deg)
        dir_x = -side * math.cos(open_rad)
        dir_y = -math.sin(open_rad)
        sh_cx = hinge_x + dir_x * (sh_w * 0.5)
        sh_cy = hinge_y + dir_y * (sh_w * 0.5)
        sh_rot_z = rot_z + math.atan2(dir_y, dir_x)
        mb.add_box(
            to_world(sh_cx, sh_cy, 0.0),
            (sh_w, 0.04, height - 0.02),
            "boards",
            rot_euler=(0.0, 0.0, sh_rot_z),
            tint=(0.88, 0.83, 0.76),
            bevel=0.005,
        )
        # Forged iron strap hinges on shutter
        for hz in (-height * 0.30, height * 0.30):
            mb.add_box(
                to_world(hinge_x + dir_x * (sh_w * 0.32), hinge_y + dir_y * (sh_w * 0.32), hz),
                (sh_w * 0.62, 0.052, 0.042),
                "beam",
                rot_euler=(0.0, 0.0, sh_rot_z),
                tint=(0.18, 0.18, 0.20),
                metal=1.0,
            )


def build_house_lod(lod: int):
    """Builds lod0 (full detail), lod1 (mid), lod2 (coarse), or shadow (lod=3)."""
    mb = MeshBuilder()

    # Core building envelope (fits cleanly inside 11 x 11 m plot)
    half_x = 3.10  # 6.20 m wide
    half_y = 2.20  # 4.40 m deep
    z_plinth = 0.64
    z_eave = 2.86
    z_ridge = 5.44  # steep ~50 deg pitch with overhanging thatch

    # ---------------- SHADOW STAND-IN (coarse closed opaque hull, R7) ----------------
    if lod == 3:
        mb.add_box((0.0, 0.0, z_eave * 0.5), (half_x * 2.0 + 0.12, half_y * 2.0 + 0.12, z_eave + 0.12), "plaster")
        mb.add_gable_prism(half_x + 0.04, half_y + 0.04, z_eave - 0.05, z_ridge)
        mb.add_thatch_roof(
            x_half=half_x + 0.44,
            y_eave=half_y + 0.56,
            z_eave=z_eave - 0.44,
            z_ridge=z_ridge,
            thickness=0.38,
            x_segs=2,
            sag_m=0.0,
            eave_curl=0.0,
            detail=False,
        )
        # Chimney mass
        mb.add_box((half_x + 0.34, 0.15, 3.05), (0.76, 1.05, 6.10), "ashlar", taper_top=(0.74, 0.72))
        return mb.finalize_object("house_l1_shadow")

    # ---------------- 1. STONE RUBBLE PLINTH & DOORSTEP ----------------
    mb.add_box(
        (0.0, 0.0, (z_plinth - 0.12) * 0.5),
        (half_x * 2.0 + 0.26, half_y * 2.0 + 0.26, z_plinth + 0.12),
        "rubble",
        tint=(0.95, 0.94, 0.92),
        taper_top=(0.98, 0.975),
        bevel=0.03 if lod < 2 else 0.0,
        wobble=0.018 if lod == 0 else 0.0,
        seed=11,
    )
    # Cut stone water-table cap ledge on top of rubble foundation
    if lod < 2:
        mb.add_box(
            (0.0, 0.0, z_plinth + 0.03),
            (half_x * 2.0 + 0.20, half_y * 2.0 + 0.20, 0.07),
            "ashlar",
            tint=(0.92, 0.90, 0.87),
            bevel=0.015,
        )

    # ---------------- 2. RECESSED LIME-PLASTER WALLS & GABLES ----------------
    wall_inset = 0.042
    wx = half_x - wall_inset
    wy = half_y - wall_inset
    mb.add_box(
        (0.0, 0.0, (z_plinth + z_eave) * 0.5),
        (wx * 2.0, wy * 2.0, z_eave - z_plinth + 0.04),
        "plaster",
        tint=(0.99, 0.96, 0.90),
    )
    mb.add_gable_prism(wx, wy, z_eave - 0.02, z_ridge, layer_name="plaster", tint=(0.98, 0.95, 0.89))

    # ---------------- 3. HALF-TIMBER OAK FRAME (PROTRUDING 4 CM FROM PLASTER) ----------------
    bt = 0.165  # timber width
    bd = 0.15   # timber depth protruding proudly outside plaster
    rng = random.Random(42)

    def beam_tint():
        v = rng.uniform(0.84, 0.98)
        return (v, v * 0.96, v * 0.91)

    # Horizontal sill, mid-rail, and wall-plate beams on all 4 facades
    z_sill = z_plinth + 0.11
    z_mid = 1.76
    z_plate = z_eave - 0.08
    for zb in (z_sill, z_mid, z_plate):
        if lod == 2 and zb == z_mid:
            continue
        # Front (-Y) and Back (+Y)
        for sy in (-1.0, 1.0):
            mb.add_beam((-half_x - 0.04, sy * half_y, zb), (half_x + 0.04, sy * half_y, zb), bt, bd, tint=beam_tint(), wobble=0.008 if lod == 0 else 0.0)
        # West (-X) and East (+X)
        for sx in (-1.0, 1.0):
            mb.add_beam((sx * half_x, -half_y - 0.04, zb), (sx * half_x, half_y + 0.04, zb), bt, bd, tint=beam_tint(), wobble=0.008 if lod == 0 else 0.0)

    # Corner posts + intermediate vertical studs
    post_xs = [-half_x, -1.35, 0.55, half_x]  # frames door around x = -0.40 and flanking windows
    for px in post_xs:
        for sy in (-1.0, 1.0):
            is_corner = abs(abs(px) - half_x) < 0.01
            pw = 0.20 if is_corner else 0.15
            mb.add_beam((px, sy * half_y, z_plinth), (px, sy * half_y, z_eave + 0.04), pw, pw, tint=beam_tint(), wobble=0.009 if lod == 0 else 0.0)

    # Side gable intermediate studs
    if lod < 2:
        for py in (-0.80, 0.80):
            for sx in (-1.0, 1.0):
                mb.add_beam((sx * half_x, py, z_plinth), (sx * half_x, py, z_eave), 0.15, 0.15, tint=beam_tint(), wobble=0.007 if lod == 0 else 0.0)

    # Diagonal corner wind-braces (signature half-timber visual identity!)
    if lod < 2:
        # Front & Back corner braces
        for sy in (-1.0, 1.0):
            mb.add_beam((-half_x + 0.04, sy * half_y, z_mid), (-half_x + 0.86, sy * half_y, z_plate), 0.125, 0.125, tint=beam_tint())
            mb.add_beam((half_x - 0.04, sy * half_y, z_mid), (half_x - 0.86, sy * half_y, z_plate), 0.125, 0.125, tint=beam_tint())
            mb.add_beam((-half_x + 0.04, sy * half_y, z_sill + 0.05), (-half_x + 0.72, sy * half_y, z_mid), 0.12, 0.12, tint=beam_tint())
            mb.add_beam((half_x - 0.04, sy * half_y, z_sill + 0.05), (half_x - 0.72, sy * half_y, z_mid), 0.12, 0.12, tint=beam_tint())

        # Gable roof trusses (tie beam, collar tie, king post, diagonal gable struts)
        z_collar = (z_eave + z_ridge) * 0.54
        y_collar = half_y * (1.0 - (z_collar - z_eave) / (z_ridge - z_eave))
        for sx in (-1.0, 1.0):
            gx = sx * half_x
            # Collar tie
            mb.add_beam((gx, -y_collar, z_collar), (gx, y_collar, z_collar), 0.14, 0.14, tint=beam_tint())
            # King post
            mb.add_beam((gx, 0.0, z_plate), (gx, 0.0, z_ridge - 0.05), 0.15, 0.15, tint=beam_tint())
            # Queen posts
            for sy in (-0.95, 0.95):
                mb.add_beam((gx, sy, z_plate), (gx, sy, z_collar), 0.13, 0.13, tint=beam_tint())
            # Gable diagonal braces
            mb.add_beam((gx, -half_y + 0.12, z_plate), (gx, -y_collar * 0.72, z_collar), 0.12, 0.12, tint=beam_tint())
            mb.add_beam((gx, half_y - 0.12, z_plate), (gx, y_collar * 0.72, z_collar), 0.12, 0.12, tint=beam_tint())
            mb.add_beam((gx, 0.0, z_collar + 0.05), (gx, -y_collar * 0.55, z_ridge - 0.72), 0.11, 0.11, tint=beam_tint())
            mb.add_beam((gx, 0.0, z_collar + 0.05), (gx, y_collar * 0.55, z_ridge - 0.72), 0.11, 0.11, tint=beam_tint())

    # Exposed rafter tails & carved gable bargeboards under overhanging thatch
    roof_xh = half_x + 0.46
    roof_ye = half_y + 0.60
    roof_ze = z_eave - 0.48
    if lod == 0:
        for i in range(9):
            rx = -half_x + 0.25 + i * ((half_x * 2.0 - 0.50) / 8.0)
            for sy in (-1.0, 1.0):
                mb.add_beam(
                    (rx, sy * (half_y - 0.05), z_eave + 0.04),
                    (rx, sy * (roof_ye - 0.08), roof_ze + 0.04),
                    0.10,
                    0.11,
                    tint=beam_tint(),
                )
        # Gable bargeboards crossing slightly at ridge finial!
        for sx in (-1.0, 1.0):
            bx = sx * (roof_xh - 0.06)
            mb.add_beam((bx, -roof_ye + 0.08, roof_ze + 0.06), (bx, 0.22, z_ridge + 0.48), 0.10, 0.16, tint=(0.78, 0.74, 0.68))
            mb.add_beam((bx, roof_ye - 0.08, roof_ze + 0.06), (bx, -0.22, z_ridge + 0.48), 0.10, 0.16, tint=(0.78, 0.74, 0.68))

    # ---------------- 4. THICK OVERHANGING REED-THATCH ROOF ----------------
    mb.add_thatch_roof(
        x_half=roof_xh,
        y_eave=roof_ye,
        z_eave=roof_ze,
        z_ridge=z_ridge,
        thickness=0.42,
        x_segs=12 if lod == 0 else (6 if lod == 1 else 3),
        sag_m=0.055 if lod < 2 else 0.02,
        eave_curl=0.11 if lod < 2 else 0.04,
        detail=(lod == 0),
    )

    # ---------------- 5. RECESSED PLANK DOOR, PORCH HOOD & STONE STEP ----------------
    door_x = -0.40
    door_w = 1.04
    door_h = 1.98
    door_y = -half_y
    door_base_z = 0.18

    # Cut stone doorstep (buried cleanly into ground)
    mb.add_box((door_x, door_y - 0.36, 0.08), (1.38, 0.74, 0.22), "ashlar", tint=(0.92, 0.90, 0.86), bevel=0.02 if lod == 0 else 0.0)

    # Door surround frame (heavy chamfered jambs + thick lintel)
    mb.add_box((door_x - door_w * 0.5 - 0.07, door_y - 0.04, door_base_z + door_h * 0.5), (0.14, 0.20, door_h + 0.08), "beam", tint=(0.82, 0.78, 0.72), bevel=0.012 if lod == 0 else 0.0)
    mb.add_box((door_x + door_w * 0.5 + 0.07, door_y - 0.04, door_base_z + door_h * 0.5), (0.14, 0.20, door_h + 0.08), "beam", tint=(0.82, 0.78, 0.72), bevel=0.012 if lod == 0 else 0.0)
    mb.add_box((door_x, door_y - 0.05, door_base_z + door_h + 0.07), (door_w + 0.36, 0.22, 0.16), "beam", tint=(0.80, 0.76, 0.70), bevel=0.012 if lod == 0 else 0.0)

    # Recessed vertical oak planks + battens + wrought-iron strap hinges
    if lod == 0:
        planks = 6
        pw = (door_w - 0.02) / planks
        for i in range(planks):
            px = door_x - (door_w - 0.02) * 0.5 + (i + 0.5) * pw
            mb.add_box(
                (px, door_y + 0.02, door_base_z + door_h * 0.5),
                (pw - 0.008, 0.06, door_h - 0.02),
                "boards",
                tint=(rng.uniform(0.84, 0.94), rng.uniform(0.79, 0.88), rng.uniform(0.72, 0.81)),
                bevel=0.005,
            )
        # Horizontal door ledges
        for lz in (door_base_z + 0.36, door_base_z + door_h - 0.36):
            mb.add_box((door_x, door_y - 0.022, lz), (door_w - 0.06, 0.036, 0.11), "boards", tint=(0.80, 0.75, 0.68))
        # Forged iron strap hinges & ring handle (metallic!)
        for hz in (door_base_z + 0.38, door_base_z + door_h - 0.38):
            mb.add_box((door_x - 0.16, door_y - 0.044, hz), (0.64, 0.018, 0.055), "beam", tint=(0.18, 0.18, 0.20), metal=1.0)
        mb.add_box((door_x + 0.34, door_y - 0.052, door_base_z + 0.96), (0.07, 0.04, 0.16), "beam", tint=(0.20, 0.20, 0.22), metal=1.0)
    else:
        mb.add_box((door_x, door_y + 0.01, door_base_z + door_h * 0.5), (door_w, 0.07, door_h), "boards", tint=(0.85, 0.80, 0.74))

    # Projecting thatched door porch canopy on curved oak brackets
    if lod < 2:
        porch_y_out = door_y - 0.78
        porch_z_top = door_base_z + door_h + 0.56
        porch_z_eave = door_base_z + door_h + 0.10
        # Curved corbel brackets
        for sx in (-1.0, 1.0):
            bx = door_x + sx * (door_w * 0.5 + 0.14)
            mb.add_beam((bx, door_y - 0.02, porch_z_eave - 0.42), (bx, porch_y_out + 0.12, porch_z_eave + 0.05), 0.11, 0.11, tint=(0.80, 0.76, 0.70))
            mb.add_beam((bx, door_y - 0.02, porch_z_eave + 0.06), (bx, porch_y_out + 0.05, porch_z_eave + 0.06), 0.10, 0.10, tint=(0.80, 0.76, 0.70))
        # Sloped canopy roof slab (thick weathered boards / shingles)
        tilt = math.atan2(porch_z_top - porch_z_eave, 0.84)
        mb.add_box(
            (door_x, (door_y + porch_y_out) * 0.5, (porch_z_top + porch_z_eave) * 0.5),
            (door_w + 0.68, 0.98, 0.14),
            "shingles",
            rot_euler=(tilt, 0.0, 0.0),
            tint=(0.90, 0.88, 0.84),
            bevel=0.015 if lod == 0 else 0.0,
        )

    # ---------------- 6. RECESSED MULLIONED WINDOWS WITH SHUTTERS ----------------
    if lod < 2:
        # Front left & right windows flanking the door (shutters swung cleanly open)
        build_window(mb, -2.18, -half_y, 1.66, "front", width=0.78, height=0.88, shutter_open_l=158, shutter_open_r=152, detail=(lod == 0))
        build_window(mb, 1.82, -half_y, 1.66, "front", width=0.84, height=0.90, shutter_open_l=148, shutter_open_r=162, detail=(lod == 0))
        # Back window
        build_window(mb, 0.25, half_y, 1.68, "back", width=0.82, height=0.86, shutter_open_l=132, shutter_open_r=130, detail=(lod == 0))
        # West gable ground window + upper loft hatch
        build_window(mb, -half_x, 0.0, 1.68, "west", width=0.76, height=0.84, shutter_open_l=125, shutter_open_r=140, detail=(lod == 0))
        if lod == 0:
            # Gable attic hayloft shuttered hatch
            build_window(mb, -half_x, 0.0, 3.68, "west", width=0.68, height=0.78, shutter_open_l=155, shutter_open_r=142, detail=True)

    # ---------------- 7. BATTERED MASONRY CHIMNEY (EAST GABLE +X) ----------------
    chim_y = 0.18
    # Lower hearth buttress (rubble stone)
    mb.add_box(
        (half_x + 0.42, chim_y, 1.25),
        (1.06, 1.56, 2.70),
        "rubble",
        tint=(0.93, 0.91, 0.88),
        taper_top=(0.82, 0.78),
        bevel=0.03 if lod == 0 else 0.0,
        wobble=0.015 if lod == 0 else 0.0,
        seed=77,
    )
    # Stone shoulder cap
    mb.add_box((half_x + 0.36, chim_y, 2.66), (0.94, 1.28, 0.16), "ashlar", tint=(0.90, 0.88, 0.85), taper_top=(0.88, 0.86))
    # Upper chimney shaft (ashlar cut stone)
    mb.add_box(
        (half_x + 0.30, chim_y, 4.38),
        (0.78, 0.96, 3.40),
        "ashlar",
        tint=(0.92, 0.90, 0.87),
        taper_top=(0.86, 0.86),
        bevel=0.02 if lod == 0 else 0.0,
    )
    # Corbelled stone crown & dark flue opening
    mb.add_box((half_x + 0.30, chim_y, 6.12), (0.82, 0.96, 0.18), "ashlar", tint=(0.68, 0.66, 0.64), bevel=0.02 if lod == 0 else 0.0)
    mb.add_box((half_x + 0.30, chim_y, 6.23), (0.48, 0.58, 0.06), "rubble", tint=(0.14, 0.14, 0.14))

    # ---------------- 8. LIVED-IN PEASANT YARD DETAILS (LOD0 & LOD1) ----------------
    if lod == 0:
        # Oak bench under front-right window
        bx, by = 1.82, -half_y - 0.52
        mb.add_box((bx, by, 0.45), (1.38, 0.36, 0.07), "boards", tint=(0.88, 0.83, 0.76), bevel=0.01)
        for lx in (-0.52, 0.52):
            mb.add_box((bx + lx, by, 0.22), (0.09, 0.30, 0.44), "beam", tint=(0.80, 0.76, 0.70))
        mb.add_box((bx, by, 0.18), (1.02, 0.06, 0.07), "beam", tint=(0.78, 0.74, 0.68))

        # Lean-to firewood shed against west (-X) gable wall
        wx0 = -half_x - 0.92
        for wy_p in (-1.65, -0.35):
            mb.add_beam((wx0, wy_p, -0.05), (wx0, wy_p, 1.48), 0.11, 0.11, layer_name="bark", tint=(0.84, 0.80, 0.74))
        mb.add_beam((wx0, -1.72, 1.46), (wx0, -0.28, 1.46), 0.10, 0.10, layer_name="beam", tint=(0.82, 0.78, 0.72))
        mb.add_box(
            (-half_x - 0.46, -1.00, 1.66),
            (1.16, 1.56, 0.08),
            "boards",
            rot_euler=(0.0, -0.34, 0.0),
            tint=(0.86, 0.82, 0.76),
            bevel=0.01,
        )
        # Stacked split oak firewood logs tucked inside the lean-to
        for row in range(4):
            cols = 5 - (row % 2)
            for col in range(cols):
                ly = -1.48 + (col + 0.5 * (row % 2)) * 0.22 + rng.uniform(-0.015, 0.015)
                lz = 0.11 + row * 0.18
                rad = rng.uniform(0.075, 0.098)
                mb.add_cylinder(
                    (-half_x - 0.78, ly, lz),
                    (-half_x - 0.16, ly, lz),
                    rad,
                    rad * rng.uniform(0.92, 1.05),
                    7,
                    "bark",
                    tint=(rng.uniform(0.76, 0.94), rng.uniform(0.72, 0.88), rng.uniform(0.65, 0.80)),
                )

        # Low rustic wooden fence flanking the front-east garden corner (fits cleanly in 11 x 11 m plot)
        fence_posts = [
            (2.85, -half_y - 1.55),
            (3.75, -half_y - 1.55),
            (4.55, -half_y - 1.55),
            (4.55, -half_y - 0.55),
            (4.55, -half_y + 0.55),
        ]
        for px, py in fence_posts:
            tilt_x = rng.uniform(-0.04, 0.04)
            tilt_y = rng.uniform(-0.04, 0.04)
            mb.add_cylinder((px, py, -0.08), (px + tilt_x, py + tilt_y, rng.uniform(0.92, 1.04)), 0.065, 0.052, 6, "bark", tint=(0.82, 0.78, 0.72))
        for i in range(len(fence_posts) - 1):
            p0, p1 = fence_posts[i], fence_posts[i + 1]
            for rz in (0.36, 0.74):
                mb.add_beam((p0[0], p0[1], rz), (p1[0], p1[1], rz), 0.055, 0.085, layer_name="boards", tint=(0.84, 0.79, 0.73), wobble=0.006)

    obj = mb.finalize_object(f"house_l1_lod{lod}")
    return obj


def bake_cycles_vertex_ao(obj, samples=24):
    """Bakes true Blender Cycles CPU Ambient Occlusion into vertex colours combined with weathering Tint."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.cycles.diffuse_bounces = 1

    # Add temporary ground catch plane so the house base receives real ground-contact AO shadow!
    bpy.ops.mesh.primitive_plane_add(size=24.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    ground.name = "_TempAoGround"

    mat = bpy.data.materials.new("AoBakeMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        bsdf.inputs["Roughness"].default_value = 1.0
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    ground.data.materials.append(mat)

    mesh = obj.data
    # Snapshot Tint values BEFORE creating/removing any color attributes (avoids Blender RNA reallocation bugs)
    tint_vals = [tuple(c.color) for c in mesh.color_attributes["Tint"].data]

    ao_attr = mesh.color_attributes.new(name="AO_Bake", type="FLOAT_COLOR", domain="CORNER")
    mesh.color_attributes.active_color = ao_attr

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type="AO")

    ao_vals = [c.color[0] for c in mesh.color_attributes["AO_Bake"].data]

    # Remove temporary attributes first, then create 'Color' as the sole color attribute (index 0)
    mesh.color_attributes.remove(mesh.color_attributes["Tint"])
    mesh.color_attributes.remove(mesh.color_attributes["AO_Bake"])

    final_attr = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for i, (t, a) in enumerate(zip(tint_vals, ao_vals)):
        ao_val = max(0.36, min(1.0, a ** 0.80))
        final_attr.data[i].color = (
            min(1.0, t[0] * ao_val),
            min(1.0, t[1] * ao_val),
            min(1.0, t[2] * ao_val),
            1.0,
        )
    mesh.color_attributes.active_color_index = 0
    mesh.color_attributes.render_color_index = 0
    mesh.uv_layers.active_index = 0

    bpy.data.objects.remove(ground, do_unlink=True)

    # Wire VertexColor into MarchlandSurface so Blender 4.2 glTF exporter always writes COLOR_0 cleanly
    obj.data.materials.clear()
    surf_mat = bpy.data.materials.new("MarchlandSurface")
    surf_mat.use_nodes = True
    nt = surf_mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vcol = nt.nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.append(surf_mat)


def render_impostor_and_preview(obj):
    """Renders a 512x512 transparent Cycles impostor sprite & 768x768 textured preview using Poly Haven maps."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False

    copy_mesh = obj.data.copy()
    copy_obj = bpy.data.objects.new("_ImpostorCopy", copy_mesh)
    bpy.context.collection.objects.link(copy_obj)

    copy_obj.data.materials.clear()
    surf_dir = "/tmp/marchland-src/surfaces_png"
    id_to_name = {v: k for k, v in LAYERS.items()}
    mat_slots = {}
    for lid in sorted(id_to_name.keys()):
        sname = id_to_name[lid]
        m = bpy.data.materials.new(f"Imp_{sname}")
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]

        uv_node = nt.nodes.new("ShaderNodeUVMap")
        uv_node.uv_map = "UVMap"

        tex_img = nt.nodes.new("ShaderNodeTexImage")
        tex_img.image = bpy.data.images.load(f"{surf_dir}/{sname}_albedo.png", check_existing=True)
        tex_img.image.colorspace_settings.name = "sRGB"
        nt.links.new(uv_node.outputs["UV"], tex_img.inputs["Vector"])

        tex_nor = nt.nodes.new("ShaderNodeTexImage")
        tex_nor.image = bpy.data.images.load(f"{surf_dir}/{sname}_normal.png", check_existing=True)
        tex_nor.image.colorspace_settings.name = "Non-Color"
        nt.links.new(uv_node.outputs["UV"], tex_nor.inputs["Vector"])
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = 0.85
        nt.links.new(tex_nor.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

        vcol = nt.nodes.new("ShaderNodeAttribute")
        vcol.attribute_name = "Color"

        mix_mul = nt.nodes.new("ShaderNodeMix")
        mix_mul.data_type = "RGBA"
        mix_mul.blend_type = "MULTIPLY"
        mix_mul.inputs[0].default_value = 1.0
        nt.links.new(tex_img.outputs["Color"], mix_mul.inputs[6])
        nt.links.new(vcol.outputs["Color"], mix_mul.inputs[7])
        nt.links.new(mix_mul.outputs[2], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.88
        copy_obj.data.materials.append(m)
        mat_slots[lid] = len(copy_obj.data.materials) - 1

    uv1 = copy_mesh.uv_layers["UVLayer"].data
    for poly in copy_mesh.polygons:
        u = uv1[poly.loop_start].uv[0]
        lid = max(0, min(11, int(round(u * 15.0))))
        poly.material_index = mat_slots[lid]

    obj.hide_render = True

    world = bpy.data.worlds.new("ImpWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.48, 0.58, 0.74, 1.0)
    bg.inputs["Strength"].default_value = 1.15

    # Warm autumn sunlight shining FROM front-right-high (+X, -Y, +Z) onto the cottage facade!
    sun_data = bpy.data.lights.new("ImpSun", type="SUN")
    sun_data.energy = 3.8
    sun_data.color = (1.0, 0.94, 0.84)
    sun_obj = bpy.data.objects.new("ImpSun", sun_data)
    sun_dir = (Vector((0.0, 0.0, 2.0)) - Vector((10.0, -14.0, 12.0))).normalized()
    sun_obj.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(sun_obj)

    cam_data = bpy.data.cameras.new("ImpCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 11.4
    cam_obj = bpy.data.objects.new("ImpCam", cam_data)
    cam_obj.location = Vector((12.0, -16.0, 9.2))
    direction = Vector((0.3, -0.2, 2.55)) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

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

    obj.hide_render = False
    bpy.data.objects.remove(copy_obj, do_unlink=True)
    bpy.data.objects.remove(sun_obj, do_unlink=True)
    bpy.data.objects.remove(cam_obj, do_unlink=True)


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
    import sys

    os.makedirs(RAW_OUT, exist_ok=True)
    summary = {}
    for lod, suffix in [(0, "lod0"), (1, "lod1"), (2, "lod2"), (3, "shadow")]:
        clear_scene()
        obj = build_house_lod(lod)
        if lod < 3:
            bake_cycles_vertex_ao(obj, samples=20 if lod == 0 else 12)
        else:
            obj.data.materials.clear()
            m = bpy.data.materials.new("ShadowMat")
            m.use_nodes = True
            obj.data.materials.append(m)

        objs = [obj]
        if lod == 0:
            smoke = bpy.data.objects.new("smoke_0", None)
            smoke.location = (3.40, 0.18, 6.26)
            bpy.context.collection.objects.link(smoke)
            objs.append(smoke)
            if "--skip-render" not in sys.argv and os.path.isdir("/tmp/marchland-src/surfaces_png"):
                render_impostor_and_preview(obj)

        out_path = os.path.join(RAW_OUT, f"house_l1_{suffix}.glb")
        export_glb(objs, out_path)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        summary[suffix] = {"tris": tris, "verts": len(obj.data.vertices), "bytes": os.path.getsize(out_path)}
        print(f"[house_l1] {suffix}: {tris} tris, {len(obj.data.vertices)} verts -> {out_path} ({os.path.getsize(out_path)//1024} KiB)")

    print("[house_l1] DONE:", json.dumps(summary, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
