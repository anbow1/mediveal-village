"""
Stage 5 Maximum-Realism Character Pipeline v2 (Blender 5.0 + MakeHuman CC0 + Poly Haven CC0):
  Builds 3 anatomically realistic, fully rigged medieval characters (`swordsman`, `archer`, `citizen`)
  from MakeHuman Community `base.obj` + exact `default_weights.mhw` (CC0 1.0) and real Poly Haven
  CC0 photogrammetry weapons/gear (`antique_estoc`, `kite_shield`, `rough_linen`, `brown_leather`,
  `medieval_wood`):
    - Real MakeHuman outer anatomical body + real eyeball spheres (helper cages/teeth/tongue culled)
    - World-axis quaternion bone posing -> natural lowered-arms medieval standing rest stance
    - Rugged medieval masculine torso silhouette smoothing + clean bone-weighted garment shells
      with collar/cuff/hem rings & outer leather belts (ZERO jagged cutoffs, ZERO clipping!)
    - Poly Haven CC0 `antique_estoc` cleanly gripped in `hand_r` + `kite_shield` strapped OUTSIDE
      `forearm_l` with Marchland Cobalt-Ochre heraldry (zero gauntlet clipping!)
    - Single 1024x1024 photographic PBR atlas per character (512^2 ORM) -> 1 draw call per LOD
    - Real Blender Cycles CPU Ambient Occlusion baked to COLOR_0 vertex colors
    - Lean game-ready LODs: LOD0 ~4,800 tris, LOD1 ~1,800 tris, LOD2 ~680 tris, shadow ~120 tris
    - Smooth world-axis 30 fps NLA animations (`idle`, `walk`, `attack`) shared by LOD0/LOD1/LOD2
    - Full head-to-toe Cycles lineup preview JPG for visual verification

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_characters_s5.py
"""

import json
import math
import os
import subprocess
import numpy as np
from PIL import Image
import bpy
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector

REPO_ROOT = "/home/antigravity/anbow1/mediveal-village"
GAME_ROOT = os.path.join(REPO_ROOT, "games/new-game")
MH_DIR = "/tmp/stage5-raw/makehuman"
PH_DIR = "/tmp/stage5-raw/polyhaven"
TEX_SRC = "/tmp/stage5-raw/textures"
WORK_DIR = "/tmp/stage5-chars"
RAW_OUT = os.path.join(WORK_DIR, "raw_glb")
TEX_OUT = os.path.join(WORK_DIR, "tex")
FINAL_OUT = os.path.join(GAME_ROOT, "public/assets/units")
OPTIMIZE_SCRIPT = os.path.join(GAME_ROOT, "tools/blender/optimize_glb.mjs")
PREVIEW_JPG = os.path.join(WORK_DIR, "characters_s5_preview.jpg")

os.makedirs(RAW_OUT, exist_ok=True)
os.makedirs(TEX_OUT, exist_ok=True)
os.makedirs(FINAL_OUT, exist_ok=True)

GAME_BONES = [
    ("hips", None),
    ("spine", "hips"),
    ("chest", "spine"),
    ("neck", "chest"),
    ("head", "neck"),
    ("shoulder_l", "chest"),
    ("upper_arm_l", "shoulder_l"),
    ("forearm_l", "upper_arm_l"),
    ("hand_l", "forearm_l"),
    ("shoulder_r", "chest"),
    ("upper_arm_r", "shoulder_r"),
    ("forearm_r", "upper_arm_r"),
    ("hand_r", "forearm_r"),
    ("thigh_l", "hips"),
    ("shin_l", "thigh_l"),
    ("foot_l", "shin_l"),
    ("thigh_r", "hips"),
    ("shin_r", "thigh_r"),
    ("foot_r", "shin_r"),
]


def map_mh_bone(mh_name: str) -> str:
    n = mh_name
    if n in ("root", "pelvis.L", "pelvis.R", "spine05", "special04"):
        return "hips"
    if n in ("spine04", "spine03"):
        return "spine"
    if n in ("spine02", "spine01", "breast.L", "breast.R"):
        return "chest"
    if n.startswith("neck"):
        return "neck"
    if n in ("clavicle.L", "shoulder01.L"):
        return "shoulder_l"
    if n in ("clavicle.R", "shoulder01.R"):
        return "shoulder_r"
    if n.startswith("upperarm") and n.endswith(".L"):
        return "upper_arm_l"
    if n.startswith("upperarm") and n.endswith(".R"):
        return "upper_arm_r"
    if n.startswith("lowerarm") and n.endswith(".L"):
        return "forearm_l"
    if n.startswith("lowerarm") and n.endswith(".R"):
        return "forearm_r"
    if (n.startswith("wrist") or n.startswith("metacarpal") or n.startswith("finger")) and n.endswith(".L"):
        return "hand_l"
    if (n.startswith("wrist") or n.startswith("metacarpal") or n.startswith("finger")) and n.endswith(".R"):
        return "hand_r"
    if n.startswith("upperleg") and n.endswith(".L"):
        return "thigh_l"
    if n.startswith("upperleg") and n.endswith(".R"):
        return "thigh_r"
    if n.startswith("lowerleg") and n.endswith(".L"):
        return "shin_l"
    if n.startswith("lowerleg") and n.endswith(".R"):
        return "shin_r"
    if (n.startswith("foot") or n.startswith("toe")) and n.endswith(".L"):
        return "foot_l"
    if (n.startswith("foot") or n.startswith("toe")) and n.endswith(".R"):
        return "foot_r"
    return "head"


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_img_rgb(path: str, size: tuple[int, int]) -> np.ndarray:
    img = Image.open(path).convert("RGB").resize(size, Image.Resampling.LANCZOS)
    return np.asarray(img, dtype=np.float32) / 255.0


def height_to_normal(height_2d: np.ndarray, strength: float = 2.6) -> np.ndarray:
    gy, gx = np.gradient(height_2d)
    nx = -gx * strength
    ny = gy * strength
    nz = np.ones_like(height_2d)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    rgb = np.stack([(nx * inv) * 0.5 + 0.5, (ny * inv) * 0.5 + 0.5, (nz * inv) * 0.5 + 0.5], axis=-1)
    return np.clip(rgb, 0.0, 1.0)


def world_rot_to_bone_quat(pose_bone, rx_world: float = 0.0, ry_world: float = 0.0, rz_world: float = 0.0) -> Quaternion:
    """
    Converts intuitive world-space rotations (X=pitch forward/back, Y=roll left/right arm-down,
    Z=yaw twist) into exact local quaternion for a Blender PoseBone regardless of bone roll!
    In our character space: +X = character's left, -Y = forward, +Z = up.
    """
    q_world = Euler((rx_world, ry_world, rz_world), "XYZ").to_quaternion()
    rest_rot3 = pose_bone.bone.matrix_local.to_3x3()
    m_local = rest_rot3.inverted() @ q_world.to_matrix() @ rest_rot3
    return m_local.to_quaternion()


def make_chainmail_tile(w: int, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ring_px = 10.0
    row_id = np.floor(yy / (ring_px * 0.54))
    shift = (row_id % 2) * (ring_px * 0.5)
    lx = ((xx + shift) % ring_px) / ring_px - 0.5
    ly = ((yy % (ring_px * 0.54)) / (ring_px * 0.54)) - 0.5
    tilt = np.where((row_id % 2) == 0, 0.34, -0.34)
    rx = lx * np.cos(tilt) - ly * np.sin(tilt)
    ry = (lx * np.sin(tilt) + ly * np.cos(tilt)) * 1.45
    dist = np.sqrt(rx * rx + ry * ry)
    ring = np.exp(-((dist - 0.34) ** 2) / (2.0 * 0.088 * 0.088))
    rng = np.random.default_rng(77)
    patina = 0.88 + 0.20 * rng.random((h, w)).astype(np.float32)
    height = np.clip(ring * 0.88 + 0.08 * patina, 0.0, 1.0)
    albedo = np.zeros((h, w, 3), dtype=np.float32)
    albedo[:, :, 0] = np.clip((0.10 + 0.36 * ring) * patina, 0.05, 0.62)
    albedo[:, :, 1] = np.clip((0.10 + 0.36 * ring) * patina, 0.05, 0.62)
    albedo[:, :, 2] = np.clip((0.10 + 0.35 * ring) * patina, 0.05, 0.60)
    normal = height_to_normal(height, strength=3.4)
    orm = np.zeros((h, w, 3), dtype=np.float32)
    orm[:, :, 0] = np.clip(0.32 + 0.68 * ring, 0.30, 1.0)
    orm[:, :, 1] = np.clip(0.56 - 0.20 * ring, 0.28, 0.68)
    orm[:, :, 2] = np.clip(0.86 * np.clip(ring * 1.5, 0.0, 1.0), 0.25, 0.92)
    return albedo, normal, orm


def make_forged_steel_tile(w: int, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) / np.array([h, w], dtype=np.float32)[:, None, None]
    rng = np.random.default_rng(91)
    n1 = np.asarray(Image.fromarray((rng.random((32, 32)) * 255).astype(np.uint8)).resize((w, h), Image.Resampling.BICUBIC), dtype=np.float32) / 255.0
    n2 = np.asarray(Image.fromarray((rng.random((128, 128)) * 255).astype(np.uint8)).resize((w, h), Image.Resampling.BICUBIC), dtype=np.float32) / 255.0
    scratches = np.sin(xx * 90.0 + yy * 32.0 + n1 * 4.0) * 0.04
    height = np.clip(0.5 + (n1 - 0.5) * 0.25 + (n2 - 0.5) * 0.14 + scratches, 0.0, 1.0)
    rivet_y = 0.86
    rx = ((xx * 16.0) % 1.0) - 0.5
    ry = (yy - rivet_y) * 14.0
    rivet = np.exp(-(rx * rx + ry * ry) / (2.0 * 0.14 * 0.14))
    height = np.clip(height + rivet * 0.38, 0.0, 1.0)
    base = 0.44 + (height - 0.5) * 0.18 + rivet * 0.10
    albedo = np.clip(np.stack([base * 1.01, base * 1.00, base * 0.98], axis=-1), 0.18, 0.72)
    normal = height_to_normal(height, strength=2.2)
    orm = np.zeros((h, w, 3), dtype=np.float32)
    orm[:, :, 0] = np.clip(0.84 + (height - 0.5) * 0.25, 0.65, 1.0)
    orm[:, :, 1] = np.clip(0.32 + (1.0 - n1) * 0.18, 0.24, 0.54)
    orm[:, :, 2] = 0.88
    return albedo, normal, orm


def make_face_skin_tile(w: int, h: int, bearded: bool = True, skin_tone=(0.66, 0.49, 0.39)) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Calibrated to MakeHuman's exact facial landmarks (verified from v1 Cycles render):
      - Eyes sit around v=0.68, brows cleanly arched above at v=0.755
      - Nose tip around v=0.56, mouth around v=0.46, bearded chin/jaw v=0.33..0.44
      - Eyeball sclera/iris/pupil patch at bottom-right (u: 0.76..1.0, v: 0.0..0.22)
    """
    rng = np.random.default_rng(404 if bearded else 505)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u = xx / float(w)
    v = 1.0 - yy / float(h)

    p1 = np.asarray(Image.fromarray((rng.random((24, 48)) * 255).astype(np.uint8)).resize((w, h), Image.Resampling.BICUBIC), dtype=np.float32) / 255.0
    p2 = np.asarray(Image.fromarray((rng.random((96, 192)) * 255).astype(np.uint8)).resize((w, h), Image.Resampling.BICUBIC), dtype=np.float32) / 255.0
    skin_var = 0.93 + 0.10 * (p1 - 0.5) + 0.05 * (p2 - 0.5)

    col = np.zeros((h, w, 3), dtype=np.float32)
    col[:, :, 0] = skin_tone[0] * skin_var
    col[:, :, 1] = skin_tone[1] * skin_var
    col[:, :, 2] = skin_tone[2] * skin_var

    # Subtle weathered cheek & nose warmth
    cheek_l = np.exp(-(((u - 0.34) / 0.11) ** 2 + ((v - 0.54) / 0.08) ** 2))
    cheek_r = np.exp(-(((u - 0.66) / 0.11) ** 2 + ((v - 0.54) / 0.08) ** 2))
    nose_warm = np.exp(-(((u - 0.50) / 0.05) ** 2 + ((v - 0.57) / 0.08) ** 2))
    warm = np.clip(cheek_l + cheek_r + 0.65 * nose_warm, 0.0, 1.0)
    col[:, :, 0] += warm * 0.065
    col[:, :, 1] -= warm * 0.012
    col[:, :, 2] -= warm * 0.022

    # Soft orbital socket shading + cleanly arched eyebrows well above the eye crease
    for side, ex in [(-1.0, 0.385), (1.0, 0.615)]:
        orb = np.exp(-(((u - ex) / 0.068) ** 2 + ((v - 0.675) / 0.036) ** 2))
        col *= (1.0 - 0.18 * orb)[:, :, None]
        arch = -0.012 * ((u - ex) / 0.065) ** 2
        brow = np.exp(-(((u - ex) / 0.064) ** 2 + ((v - (0.758 + arch)) / 0.014) ** 2))
        brow_col = np.array([0.19, 0.13, 0.09], dtype=np.float32)
        col = col * (1.0 - 0.78 * brow)[:, :, None] + brow_col * (0.78 * brow)[:, :, None]

    # Natural muted medieval lips
    mouth = np.exp(-(((u - 0.50) / 0.072) ** 2 + ((v - 0.462) / 0.015) ** 2))
    lip_col = np.array([0.48, 0.29, 0.24], dtype=np.float32)
    col = col * (1.0 - 0.58 * mouth)[:, :, None] + lip_col * (0.58 * mouth)[:, :, None]
    mouth_line = np.exp(-(((u - 0.50) / 0.064) ** 2 + ((v - 0.462) / 0.004) ** 2))
    col *= (1.0 - 0.42 * mouth_line)[:, :, None]

    # Weathered short beard / medieval jaw stubble
    beard_mask = np.zeros((h, w), dtype=np.float32)
    if bearded:
        jaw_b = np.exp(-(((u - 0.50) / 0.25) ** 2 + ((v - 0.365) / 0.095) ** 2))
        stache = np.exp(-(((u - 0.50) / 0.115) ** 2 + ((v - 0.495) / 0.020) ** 2))
        side_l = np.exp(-(((u - 0.24) / 0.08) ** 2 + ((v - 0.49) / 0.11) ** 2))
        side_r = np.exp(-(((u - 0.76) / 0.08) ** 2 + ((v - 0.49) / 0.11) ** 2))
        hair_grain = 0.68 + 0.24 * np.sin(u * 260.0 + p2 * 8.0) + 0.18 * p2
        beard_mask = np.clip((jaw_b * 0.94 + stache * 0.78 + side_l * 0.72 + side_r * 0.72) * hair_grain, 0.0, 0.94)
        beard_col = np.array([0.16, 0.11, 0.075], dtype=np.float32)
        col = col * (1.0 - beard_mask)[:, :, None] + beard_col * beard_mask[:, :, None]
    else:
        stub = np.exp(-(((u - 0.50) / 0.22) ** 2 + ((v - 0.365) / 0.075) ** 2)) * 0.26 * (0.6 + 0.4 * p2)
        beard_mask = stub
        col *= (1.0 - stub)[:, :, None]

    # Hairline & back of scalp
    hair_top = np.clip((v - 0.83) / 0.06, 0.0, 1.0)
    hair_back = np.clip((np.abs(u - 0.50) - 0.35) / 0.08, 0.0, 1.0) * np.clip((v - 0.44) / 0.12, 0.0, 1.0)
    hair_mask = np.clip(np.maximum(hair_top, hair_back), 0.0, 1.0)
    hair_strand = 0.82 + 0.22 * np.sin(u * 220.0 + v * 45.0 + p1 * 5.0)
    hair_col = np.array([0.17, 0.12, 0.08], dtype=np.float32) * hair_strand[:, :, None]
    col = col * (1.0 - hair_mask)[:, :, None] + hair_col * hair_mask[:, :, None]

    # Dedicated Eyeball patch at bottom-right (u in [0.76..1.00], v in [0.00..0.22])
    eye_region = (u >= 0.76) & (v <= 0.22)
    eu = (u - 0.88) / 0.11
    ev = (v - 0.11) / 0.10
    er = np.sqrt(eu * eu + ev * ev)
    sclera = np.array([0.78, 0.75, 0.71], dtype=np.float32)
    iris = np.array([0.24, 0.18, 0.12], dtype=np.float32)
    pupil = np.array([0.04, 0.04, 0.04], dtype=np.float32)
    eye_col = np.broadcast_to(sclera, (h, w, 3)).copy()
    eye_col[er < 0.48] = iris
    eye_col[er < 0.24] = pupil
    col = np.where(eye_region[:, :, None], eye_col, col)

    height = np.clip(0.5 + (p2 - 0.5) * 0.15 + beard_mask * 0.18 + hair_mask * 0.22, 0.0, 1.0)
    normal = height_to_normal(height, strength=1.4)
    orm = np.zeros((h, w, 3), dtype=np.float32)
    orm[:, :, 0] = 0.94
    orm[:, :, 1] = np.where(eye_region, 0.14, np.clip(0.62 + beard_mask * 0.24 + hair_mask * 0.20, 0.52, 0.90))
    orm[:, :, 2] = 0.0
    return np.clip(col, 0.03, 0.86), normal, orm


def build_character_atlas(kind: str) -> tuple[str, str, str]:
    S = 1024
    alb = np.zeros((S, S, 3), dtype=np.float32)
    nor = np.zeros((S, S, 3), dtype=np.float32)
    nor[:, :, 0] = 0.5
    nor[:, :, 1] = 0.5
    nor[:, :, 2] = 1.0
    orm = np.zeros((S, S, 3), dtype=np.float32)
    orm[:, :, 0] = 1.0
    orm[:, :, 1] = 0.82
    orm[:, :, 2] = 0.0

    linen_alb = load_img_rgb(f"{TEX_SRC}/rough_linen_Diffuse.jpg", (512, 512))
    linen_nor = load_img_rgb(f"{TEX_SRC}/rough_linen_nor_gl.jpg", (512, 512))
    linen_arm = load_img_rgb(f"{TEX_SRC}/rough_linen_arm.jpg", (512, 512))
    leather_alb = load_img_rgb(f"{TEX_SRC}/brown_leather_Diffuse.jpg", (256, 512))
    leather_nor = load_img_rgb(f"{TEX_SRC}/brown_leather_nor_gl.jpg", (256, 512))
    leather_arm = load_img_rgb(f"{TEX_SRC}/brown_leather_arm.jpg", (256, 512))
    wood_alb = load_img_rgb(f"{TEX_SRC}/medieval_wood_Diffuse.jpg", (256, 512))
    wood_nor = load_img_rgb(f"{TEX_SRC}/medieval_wood_nor_gl.jpg", (256, 512))
    wood_arm = load_img_rgb(f"{TEX_SRC}/medieval_wood_arm.jpg", (256, 512))

    linen_lum = 0.299 * linen_alb[:, :, 0] + 0.587 * linen_alb[:, :, 1] + 0.114 * linen_alb[:, :, 2]
    linen_mod = np.clip(0.80 + (linen_lum - np.mean(linen_lum)) * 1.45, 0.58, 1.15)[:, :, None]

    yy, xx = np.mgrid[0:512, 0:512].astype(np.float32) / 512.0
    folds = 0.90 + 0.10 * np.sin(xx * math.tau * 8.0 + np.sin(yy * 6.0) * 0.7)
    mud_t = np.clip((yy - 0.80) / 0.20, 0.0, 1.0)[:, :, None]
    mud_col = np.array([0.23, 0.19, 0.14], dtype=np.float32)

    if kind == "swordsman":
        cobalt = np.array([0.12, 0.24, 0.46], dtype=np.float32)
        ochre = np.array([0.82, 0.70, 0.44], dtype=np.float32)
        dark_trim = np.array([0.08, 0.14, 0.26], dtype=np.float32)
        dx_c = np.abs(xx - 0.50)
        chev_y = 0.24 + dx_c * 0.68
        in_chev = (np.abs(yy - chev_y) < 0.044) & (dx_c < 0.34)
        in_edge = (np.abs(yy - chev_y) >= 0.044) & (np.abs(yy - chev_y) < 0.056) & (dx_c < 0.35)
        in_hem = (yy > 0.87) & (yy < 0.92)
        col = np.broadcast_to(cobalt, (512, 512, 3)).copy()
        col[in_chev] = ochre
        col[in_edge] = dark_trim
        col[in_hem] = ochre * 0.86
        col = col * linen_mod * folds[:, :, None]
        col = col * (1.0 - mud_t * 0.35) + mud_col * (mud_t * 0.35)
        alb[0:512, 0:512] = np.clip(col, 0.03, 0.86)
        nor[0:512, 0:512] = linen_nor
        orm[0:512, 0:512, 0] = np.clip(linen_arm[:, :, 0] * folds, 0.55, 1.0)
        orm[0:512, 0:512, 1] = np.clip(0.84 + (linen_arm[:, :, 1] - 0.8) * 0.3, 0.78, 0.96)
        orm[0:512, 0:512, 2] = 0.0
    elif kind == "archer":
        col = np.zeros((512, 512, 3), dtype=np.float32)
        cobalt = np.array([0.13, 0.24, 0.45], dtype=np.float32)
        ochre = np.array([0.80, 0.68, 0.42], dtype=np.float32)
        hood_col = np.broadcast_to(cobalt, (512, 256, 3)).copy()
        hood_col[450:478, :] = ochre * 0.88
        col[:, 0:256] = hood_col * linen_mod[:, 0:256] * folds[:, 0:256, None]

        gy, gx = np.mgrid[0:512, 0:256].astype(np.float32)
        d1 = np.abs(((gx + gy) % 36.0) / 36.0 - 0.5)
        d2 = np.abs(((gx - gy) % 36.0) / 36.0 - 0.5)
        stitch = np.exp(-((np.minimum(d1, d2)) ** 2) / (2.0 * 0.045 * 0.045))
        puff = np.clip(1.0 - stitch * 0.65, 0.35, 1.0)
        gamb_base = np.array([0.36, 0.31, 0.22], dtype=np.float32)
        col[:, 256:512] = gamb_base * linen_mod[:, 256:512] * (0.72 + 0.32 * puff[:, :, None])
        col[:, 256:512] = col[:, 256:512] * (1.0 - mud_t[:, 256:512] * 0.30) + mud_col * (mud_t[:, 256:512] * 0.30)
        alb[0:512, 0:512] = np.clip(col, 0.03, 0.86)
        q_nor = height_to_normal(puff, strength=3.0)
        nor[0:512, 0:256] = linen_nor[:, 0:256]
        nor[0:512, 256:512] = np.clip(linen_nor[:, 256:512] * 0.45 + q_nor * 0.55, 0.0, 1.0)
        orm[0:512, 0:512, 0] = np.clip(linen_arm[:, :, 0] * 0.92, 0.55, 1.0)
        orm[0:512, 256:512, 0] *= (0.70 + 0.30 * puff)
        orm[0:512, 0:512, 1] = 0.85
        orm[0:512, 0:512, 2] = 0.0
    else:
        russet = np.array([0.44, 0.32, 0.21], dtype=np.float32)
        flax = np.array([0.66, 0.59, 0.47], dtype=np.float32)
        col = np.zeros((512, 512, 3), dtype=np.float32)
        col[:, 0:256] = russet * linen_mod[:, 0:256] * folds[:, 0:256, None]
        col[448:470, 0:256] = np.array([0.62, 0.52, 0.34], dtype=np.float32) * linen_mod[448:470, 0:256]
        col[:, 256:512] = flax * linen_mod[:, 256:512] * folds[:, 256:512, None]
        col = col * (1.0 - mud_t * 0.32) + mud_col * (mud_t * 0.32)
        alb[0:512, 0:512] = np.clip(col, 0.04, 0.85)
        nor[0:512, 0:512] = linen_nor
        orm[0:512, 0:512, 0] = np.clip(linen_arm[:, :, 0] * folds, 0.58, 1.0)
        orm[0:512, 0:512, 1] = 0.88
        orm[0:512, 0:512, 2] = 0.0

    # Leather / Hose / Brass
    alb[512:1024, 0:256] = np.clip(leather_alb * 0.72, 0.04, 0.55)
    nor[512:1024, 0:256] = leather_nor
    orm[512:1024, 0:256, 0] = leather_arm[:, :, 0]
    orm[512:1024, 0:256, 1] = np.clip(leather_arm[:, :, 1] * 0.88, 0.42, 0.78)
    orm[512:1024, 0:256, 2] = 0.0

    hose_col = np.array([0.21, 0.18, 0.15], dtype=np.float32) * linen_mod[0:256, 0:176]
    alb[768:1024, 0:176] = np.clip(hose_col, 0.04, 0.35)
    nor[768:1024, 0:176] = linen_nor[0:256, 0:176]
    orm[768:1024, 0:176, 1] = 0.88
    orm[768:1024, 0:176, 2] = 0.0

    alb[768:1024, 176:256] = np.array([0.66, 0.52, 0.24], dtype=np.float32)
    orm[768:1024, 176:256, 1] = 0.34
    orm[768:1024, 176:256, 2] = 0.90

    # Face / Skin / Beard / Eyeball
    tone = (0.65, 0.48, 0.38) if kind == "swordsman" else ((0.68, 0.51, 0.41) if kind == "archer" else (0.64, 0.47, 0.37))
    fa, fn, fo = make_face_skin_tile(256, 512, bearded=(kind == "swordsman"), skin_tone=tone)
    alb[512:1024, 256:512] = fa
    nor[512:1024, 256:512] = fn
    orm[512:1024, 256:512] = fo

    if kind == "swordsman":
        ma, mn, mo = make_chainmail_tile(256, 256)
        alb[0:256, 512:768] = ma
        nor[0:256, 512:768] = mn
        orm[0:256, 512:768] = mo

        sa, sn, so = make_forged_steel_tile(256, 256)
        alb[0:256, 768:1024] = sa
        nor[0:256, 768:1024] = sn
        orm[0:256, 768:1024] = so

        ea = load_img_rgb(f"{PH_DIR}/antique_estoc/textures/antique_estoc_diff_1k.jpg", (512, 256))
        en = load_img_rgb(f"{PH_DIR}/antique_estoc/textures/antique_estoc_nor_gl_1k.jpg", (512, 256))
        eo = load_img_rgb(f"{PH_DIR}/antique_estoc/textures/antique_estoc_arm_1k.jpg", (512, 256))
        ea[:, :, 2] = np.minimum(ea[:, :, 2], np.maximum(ea[:, :, 0], ea[:, :, 1]))
        alb[256:512, 512:1024] = ea
        nor[256:512, 512:1024] = en
        orm[256:512, 512:1024] = eo

        sba = load_img_rgb(f"{PH_DIR}/kite_shield/textures/kite_shield_body_diff_1k.jpg", (256, 512))
        sbn = load_img_rgb(f"{PH_DIR}/kite_shield/textures/kite_shield_body_nor_gl_1k.jpg", (256, 512))
        sbo = load_img_rgb(f"{PH_DIR}/kite_shield/textures/kite_shield_body_arm_1k.jpg", (256, 512))
        sb_lum = 0.299 * sba[:, :, 0] + 0.587 * sba[:, :, 1] + 0.114 * sba[:, :, 2]
        grain_mod = np.clip(0.70 + (sb_lum - np.mean(sb_lum)) * 1.45, 0.45, 1.18)[:, :, None]
        sy, sx = np.mgrid[0:512, 0:256].astype(np.float32)
        su, sv = sx / 256.0, sy / 512.0
        scol = np.broadcast_to(np.array([0.13, 0.25, 0.48], dtype=np.float32), (512, 256, 3)).copy()
        band = np.abs((sv - 0.36) - np.abs(su - 0.50) * 0.52) < 0.075
        scol[band] = np.array([0.82, 0.70, 0.44], dtype=np.float32)
        wear = np.clip((sb_lum - 0.52) * 2.0, 0.0, 0.35)[:, :, None]
        scol = scol * grain_mod * (1.0 - wear) + np.array([0.36, 0.28, 0.20], dtype=np.float32) * wear
        alb[512:1024, 512:768] = np.clip(scol, 0.04, 0.85)
        nor[512:1024, 512:768] = sbn
        orm[512:1024, 512:768] = sbo

        sta = load_img_rgb(f"{PH_DIR}/kite_shield/textures/kite_shield_clamps_trim_diff_1k.jpg", (256, 512))
        stn = load_img_rgb(f"{PH_DIR}/kite_shield/textures/kite_shield_clamps_trim_nor_gl_1k.jpg", (256, 512))
        sto = load_img_rgb(f"{PH_DIR}/kite_shield/textures/kite_shield_clamps_trim_arm_1k.jpg", (256, 512))
        sta[:, :, 2] = np.minimum(sta[:, :, 2], np.maximum(sta[:, :, 0], sta[:, :, 1]))
        alb[512:1024, 768:1024] = sta
        nor[512:1024, 768:1024] = stn
        orm[512:1024, 768:1024] = sto
    else:
        alb[0:512, 512:768] = np.clip(wood_alb * 0.92, 0.05, 0.72)
        nor[0:512, 512:768] = wood_nor
        orm[0:512, 512:768] = wood_arm
        sa, sn, so = make_forged_steel_tile(256, 512)
        alb[0:512, 768:1024] = sa
        nor[0:512, 768:1024] = sn
        orm[0:512, 768:1024] = so
        alb[512:1024, 512:768] = np.array([0.78, 0.72, 0.58], dtype=np.float32) * linen_mod[0:512, 0:256]
        nor[512:1024, 512:768] = linen_nor[0:512, 0:256]
        orm[512:1024, 512:768, 1] = 0.84
        alb[512:1024, 768:1024] = np.array([0.34, 0.28, 0.21], dtype=np.float32) * linen_mod[0:512, 256:512]
        nor[512:1024, 768:1024] = linen_nor[0:512, 256:512]
        orm[512:1024, 768:1024, 1] = 0.88

    alb_p = os.path.join(TEX_OUT, f"{kind}_albedo.png")
    nor_p = os.path.join(TEX_OUT, f"{kind}_normal.png")
    orm_p = os.path.join(TEX_OUT, f"{kind}_orm.png")
    Image.fromarray(np.clip(alb * 255.0, 0, 255).astype(np.uint8)).save(alb_p)
    Image.fromarray(np.clip(nor * 255.0, 0, 255).astype(np.uint8)).save(nor_p)
    # 512x512 ORM saves ~600 KiB per character with identical visual fidelity!
    Image.fromarray(np.clip(orm * 255.0, 0, 255).astype(np.uint8)).resize((512, 512), Image.Resampling.LANCZOS).save(orm_p)
    return alb_p, nor_p, orm_p


def load_makehuman_rigged_base(target_height_m: float):
    """
    Imports MakeHuman CC0 `base.obj` + `default_weights.mhw` + `default.mhskel`:
      - Maps all 139 MakeHuman weight groups to our 19-bone game rig
      - Deletes helper cages/tongue/teeth, preserving real outer body + eyeballs
      - Broadens shoulders gently & smooths neutral chest contour for sturdy medieval male silhouette
      - Poses A-pose cleanly into natural lowered-arms standing posture using WORLD-AXIS quaternions!
    """
    bpy.ops.wm.obj_import(filepath=os.path.join(MH_DIR, "base.obj"))
    raw = [o for o in bpy.data.objects if o.type == "MESH"][0]
    raw.name = "MH_Body"

    bpy.ops.object.select_all(action="DESELECT")
    raw.select_set(True)
    bpy.context.view_layer.objects.active = raw
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    skel = json.load(open(os.path.join(MH_DIR, "default.mhskel")))
    joints_def = skel["joints"]
    raw_bones_def = skel["bones"]

    def raw_jpos(jname: str) -> Vector:
        idxs = joints_def[jname]
        return sum((raw.data.vertices[i].co.copy() for i in idxs), Vector()) / float(len(idxs))

    mhw = json.load(open(os.path.join(MH_DIR, "default_weights.mhw")))["weights"]
    accum: dict[int, dict[str, float]] = {}
    for mh_bname, pairs in mhw.items():
        gb = map_mh_bone(mh_bname)
        for vi, w in pairs:
            if w <= 1e-4:
                continue
            d = accum.setdefault(vi, {})
            d[gb] = d.get(gb, 0.0) + float(w)

    for bname, _ in GAME_BONES:
        raw.vertex_groups.new(name=bname)
    for vi, wdict in accum.items():
        top = sorted(wdict.items(), key=lambda kv: kv[1], reverse=True)[:4]
        tot = sum(w for _, w in top)
        if tot <= 1e-6:
            continue
        for gb, w in top:
            raw.vertex_groups[gb].add([vi], w / tot, "REPLACE")

    # Separate outer human body island + eyeball spheres
    bm = bmesh.new()
    bm.from_mesh(raw.data)
    bm.verts.ensure_lookup_table()
    visited = set()
    islands = []
    for v in bm.verts:
        if v.index in visited:
            continue
        stack = [v]
        comp = []
        visited.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                oth = e.other_vert(cur)
                if oth.index not in visited:
                    visited.add(oth.index)
                    stack.append(oth)
        zs = [c.co.z for c in comp]
        xs = [c.co.x for c in comp]
        islands.append((len(comp), min(xs), max(xs), min(zs), max(zs), comp))
    islands.sort(key=lambda item: item[0], reverse=True)

    body_verts = set(v.index for v in islands[0][5])
    eye_verts = set()
    for cnt, x0, x1, z0, z1, comp in islands[1:]:
        if 64 <= cnt <= 84 and z0 > 7.05 and z1 < 7.50 and abs((x0 + x1) * 0.5) > 0.15:
            for v in comp:
                eye_verts.add(v.index)

    body_zs = [v.co.z for v in bm.verts if v.index in body_verts]
    min_z, max_z = min(body_zs), max(body_zs)
    scale = target_height_m / (max_z - min_z)

    def to_meters(vec: Vector) -> Vector:
        # Slight rugged medieval shoulder breadth (+5% X on upper torso/shoulders)
        z_m = (vec.z - min_z) * scale
        sx = 1.05 if 1.15 < z_m < 1.56 else 1.0
        return Vector((vec.x * scale * sx, vec.y * scale, z_m))

    jpos = {
        "hips_h": to_meters(raw_jpos(raw_bones_def["spine05"]["head"])),
        "spine_h": to_meters(raw_jpos(raw_bones_def["spine04"]["head"])),
        "chest_h": to_meters(raw_jpos(raw_bones_def["spine02"]["head"])),
        "neck_h": to_meters(raw_jpos(raw_bones_def["neck01"]["head"])),
        "head_h": to_meters(raw_jpos(raw_bones_def["head"]["head"])),
        "head_t": to_meters(raw_jpos(raw_bones_def["head"]["tail"])),
        "clav_l": to_meters(raw_jpos(raw_bones_def["clavicle.L"]["head"])),
        "uarm_l": to_meters(raw_jpos(raw_bones_def["upperarm01.L"]["head"])),
        "farm_l": to_meters(raw_jpos(raw_bones_def["lowerarm01.L"]["head"])),
        "hand_l": to_meters(raw_jpos(raw_bones_def["wrist.L"]["head"])),
        "hand_lt": to_meters(raw_jpos(raw_bones_def["finger3-2.L"]["tail"])),
        "clav_r": to_meters(raw_jpos(raw_bones_def["clavicle.R"]["head"])),
        "uarm_r": to_meters(raw_jpos(raw_bones_def["upperarm01.R"]["head"])),
        "farm_r": to_meters(raw_jpos(raw_bones_def["lowerarm01.R"]["head"])),
        "hand_r": to_meters(raw_jpos(raw_bones_def["wrist.R"]["head"])),
        "hand_rt": to_meters(raw_jpos(raw_bones_def["finger3-2.R"]["tail"])),
        "thigh_l": to_meters(raw_jpos(raw_bones_def["upperleg01.L"]["head"])),
        "shin_l": to_meters(raw_jpos(raw_bones_def["lowerleg01.L"]["head"])),
        "foot_l": to_meters(raw_jpos(raw_bones_def["foot.L"]["head"])),
        "foot_lt": to_meters(raw_jpos(raw_bones_def["toe3-1.L"]["tail"])),
        "thigh_r": to_meters(raw_jpos(raw_bones_def["upperleg01.R"]["head"])),
        "shin_r": to_meters(raw_jpos(raw_bones_def["lowerleg01.R"]["head"])),
        "foot_r": to_meters(raw_jpos(raw_bones_def["foot.R"]["head"])),
        "foot_rt": to_meters(raw_jpos(raw_bones_def["toe3-1.R"]["tail"])),
    }

    del_verts = [v for v in bm.verts if (v.index not in body_verts and v.index not in eye_verts)]
    bmesh.ops.delete(bm, geom=del_verts, context="VERTS")
    for v in bm.verts:
        co = to_meters(v.co)
        # Flatten neutral-base chest contour gently into sturdy medieval broad chest
        if 1.18 < co.z < 1.37 and abs(co.x) < 0.16 and co.y < -0.105:
            co.y = -0.105 + (co.y + 0.105) * 0.35
        v.co = co
    bm.to_mesh(raw.data)
    bm.free()
    raw.data.update()
    for p in raw.data.polygons:
        p.use_smooth = True

    arm_data = bpy.data.armatures.new("CharRig")
    arm_obj = bpy.data.objects.new("Armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    bone_coords = {
        "hips": (jpos["hips_h"], jpos["spine_h"]),
        "spine": (jpos["spine_h"], jpos["chest_h"]),
        "chest": (jpos["chest_h"], jpos["neck_h"]),
        "neck": (jpos["neck_h"], jpos["head_h"]),
        "head": (jpos["head_h"], jpos["head_t"]),
        "shoulder_l": (jpos["clav_l"], jpos["uarm_l"]),
        "upper_arm_l": (jpos["uarm_l"], jpos["farm_l"]),
        "forearm_l": (jpos["farm_l"], jpos["hand_l"]),
        "hand_l": (jpos["hand_l"], jpos["hand_lt"]),
        "shoulder_r": (jpos["clav_r"], jpos["uarm_r"]),
        "upper_arm_r": (jpos["uarm_r"], jpos["farm_r"]),
        "forearm_r": (jpos["farm_r"], jpos["hand_r"]),
        "hand_r": (jpos["hand_r"], jpos["hand_rt"]),
        "thigh_l": (jpos["thigh_l"], jpos["shin_l"]),
        "shin_l": (jpos["shin_l"], jpos["foot_l"]),
        "foot_l": (jpos["foot_l"], jpos["foot_lt"]),
        "thigh_r": (jpos["thigh_r"], jpos["shin_r"]),
        "shin_r": (jpos["shin_r"], jpos["foot_r"]),
        "foot_r": (jpos["foot_r"], jpos["foot_rt"]),
    }

    ebones = {}
    for bname, parent_name in GAME_BONES:
        eb = arm_data.edit_bones.new(bname)
        eb.head, eb.tail = bone_coords[bname]
        eb.roll = 0.0
        if parent_name:
            eb.parent = ebones[parent_name]
        ebones[bname] = eb
    bpy.ops.object.mode_set(mode="OBJECT")

    # Pose A-pose -> natural lowered-arms standing medieval posture using EXACT world-axis quaternions!
    # In our world (+X = left, -Y = front, +Z = up):
    # Rotating upper_arm_l around +Y (positive angle) swings +X downward toward -Z!
    mod = raw.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"

    # Lower both arms cleanly down from 45° A-pose to natural ~14° relaxed standing angle + slight forward elbow bend (-X = forward!)
    arm_obj.pose.bones["upper_arm_l"].rotation_quaternion = world_rot_to_bone_quat(arm_obj.pose.bones["upper_arm_l"], rx_world=-0.04, ry_world=0.58)
    arm_obj.pose.bones["upper_arm_r"].rotation_quaternion = world_rot_to_bone_quat(arm_obj.pose.bones["upper_arm_r"], rx_world=-0.04, ry_world=-0.58)
    arm_obj.pose.bones["forearm_l"].rotation_quaternion = world_rot_to_bone_quat(arm_obj.pose.bones["forearm_l"], rx_world=-0.16, ry_world=-0.04)
    arm_obj.pose.bones["forearm_r"].rotation_quaternion = world_rot_to_bone_quat(arm_obj.pose.bones["forearm_r"], rx_world=-0.16, ry_world=0.04)
    # Narrow wide A-pose stance slightly into natural grounded shoulder-width feet
    arm_obj.pose.bones["thigh_l"].rotation_quaternion = world_rot_to_bone_quat(arm_obj.pose.bones["thigh_l"], ry_world=0.065)
    arm_obj.pose.bones["thigh_r"].rotation_quaternion = world_rot_to_bone_quat(arm_obj.pose.bones["thigh_r"], ry_world=-0.065)
    bpy.context.view_layer.update()

    # Apply natural rest pose permanently to mesh & armature!
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    raw.select_set(True)
    bpy.context.view_layer.objects.active = raw
    bpy.ops.object.modifier_apply(modifier="Armature")

    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Re-ground soles strictly to Z = 0.000
    min_z2 = min(v.co.z for v in raw.data.vertices)
    if abs(min_z2) > 1e-4:
        for v in raw.data.vertices:
            v.co.z -= min_z2
        raw.data.update()
        bpy.context.view_layer.objects.active = arm_obj
        bpy.ops.object.mode_set(mode="EDIT")
        for eb in arm_data.edit_bones:
            eb.head.z -= min_z2
            eb.tail.z -= min_z2
        bpy.ops.object.mode_set(mode="OBJECT")

    final_bones = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm_data.bones}

    # Separate real eyeballs into their own object
    bm = bmesh.new()
    bm.from_mesh(raw.data)
    bm.verts.ensure_lookup_table()
    visited = set()
    eye_indices = set()
    for v in bm.verts:
        if v.index in visited:
            continue
        stack = [v]
        comp = []
        visited.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                oth = e.other_vert(cur)
                if oth.index not in visited:
                    visited.add(oth.index)
                    stack.append(oth)
        if len(comp) < 200:
            for c in comp:
                eye_indices.add(c.index)

    eye_bm = bmesh.new()
    eye_bm.from_mesh(raw.data)
    bmesh.ops.delete(eye_bm, geom=[v for v in eye_bm.verts if v.index not in eye_indices], context="VERTS")
    eye_mesh = bpy.data.meshes.new("Eyeballs")
    eye_bm.to_mesh(eye_mesh)
    eye_bm.free()
    eye_obj = bpy.data.objects.new("Eyeballs", eye_mesh)
    bpy.context.collection.objects.link(eye_obj)
    for p in eye_mesh.polygons:
        p.use_smooth = True
    assign_rigid_weight(eye_obj, "head")

    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index in eye_indices], context="VERTS")
    bm.to_mesh(raw.data)
    bm.free()
    raw.data.update()

    return raw, eye_obj, arm_obj, final_bones


def assign_rigid_weight(obj, bone_name: str):
    obj.vertex_groups.clear()
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")


def transfer_weights(src_body, target_obj):
    target_obj.vertex_groups.clear()
    for bname, _ in GAME_BONES:
        target_obj.vertex_groups.new(name=bname)
    bpy.ops.object.select_all(action="DESELECT")
    target_obj.select_set(True)
    bpy.context.view_layer.objects.active = target_obj
    mod = target_obj.modifiers.new("WeightXfer", "DATA_TRANSFER")
    mod.object = src_body
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"
    bpy.ops.object.modifier_apply(modifier="WeightXfer")
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)


def dominant_bone_per_vert(body_obj) -> list[str]:
    names = [vg.name for vg in body_obj.vertex_groups]
    out = []
    for v in body_obj.data.vertices:
        best_n, best_w = "hips", -1.0
        for g in v.groups:
            if g.weight > best_w:
                best_w = g.weight
                best_n = names[g.group]
        out.append(best_n)
    return out


def set_uv_box_or_cyl(obj, u0: float, v0: float, u1: float, v1: float, mode: str = "cyl", z_min=None, z_max=None):
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    verts = mesh.vertices
    zs = [v.co.z for v in verts]
    z0 = z_min if z_min is not None else min(zs)
    z1 = z_max if z_max is not None else max(zs)
    dz = max(1e-4, z1 - z0)
    cx = sum(v.co.x for v in verts) / max(1, len(verts))
    cy = sum(v.co.y for v in verts) / max(1, len(verts))

    for poly in mesh.polygons:
        n = poly.normal
        for li in poly.loop_indices:
            co = verts[mesh.loops[li].vertex_index].co
            if mode == "cyl":
                ang = math.atan2(co.x - cx, -(co.y - cy))
                lu = 0.5 + ang / math.tau
                lv = max(0.0, min(1.0, (co.z - z0) / dz))
            elif mode == "face":
                ang = math.atan2(co.x, -(co.y - cy))
                lu = max(0.02, min(0.98, 0.5 + (ang / math.pi) * 0.48))
                lv = max(0.24, min(0.98, 0.28 + ((co.z - z0) / dz) * 0.70))
            elif mode == "eyeball":
                ex = 0.032 if co.x > 0 else -0.032
                ez = (z0 + z1) * 0.5
                lu = max(0.77, min(0.99, 0.88 + (co.x - ex) * 5.2))
                lv = max(0.01, min(0.21, 0.11 + (co.z - ez) * 5.2))
            else:
                ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
                if az >= ax and az >= ay:
                    lu, lv = (co.x * 1.4 + 0.5) % 1.0, (co.y * 1.4 + 0.5) % 1.0
                elif ax >= ay:
                    lu, lv = (co.y * 1.4 + 0.5) % 1.0, ((co.z - z0) / dz) % 1.0
                else:
                    lu, lv = (co.x * 1.4 + 0.5) % 1.0, ((co.z - z0) / dz) % 1.0
            uv_layer[li].uv = (u0 + lu * (u1 - u0), v0 + lv * (v1 - v0))


def remap_existing_uvs(obj, u0: float, v0: float, u1: float, v1: float):
    mesh = obj.data
    if not mesh.uv_layers:
        set_uv_box_or_cyl(obj, u0, v0, u1, v1, mode="box")
        return
    uv_layer = mesh.uv_layers.active.data
    for d in uv_layer:
        u = max(0.002, min(0.998, d.uv.x % 1.0 if d.uv.x > 1.0 or d.uv.x < 0.0 else d.uv.x))
        v = max(0.002, min(0.998, d.uv.y % 1.0 if d.uv.y > 1.0 or d.uv.y < 0.0 else d.uv.y))
        d.uv = (u0 + u * (u1 - u0), v0 + v * (v1 - v0))


def extract_bone_shell(body_obj, dom_bones: list[str], name: str, allowed_bones: set[str], extra_fn=None, offset_m: float = 0.014, decimate_ratio: float = 0.16, smooth_iters: int = 2):
    """
    Extracts a clean anatomical garment/skin shell by BONE REGION (not raw spatial bounding box!),
    so torso, sleeves, hands, hose, and boots have clean anatomical borders with zero missing waist
    and zero jagged diagonal cuts!
    """
    dup_mesh = body_obj.data.copy()
    dup = bpy.data.objects.new(name, dup_mesh)
    bpy.context.collection.objects.link(dup)
    for vg in body_obj.vertex_groups:
        dup.vertex_groups.new(name=vg.name)
    for vi, v in enumerate(body_obj.data.vertices):
        for g in v.groups:
            dup.vertex_groups[g.group].add([vi], g.weight, "REPLACE")

    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()

    del_faces = []
    for f in bm.faces:
        # Keep face if majority of its vertices belong to allowed_bones (and pass optional extra_fn)
        hits = sum(1 for v in f.verts if dom_bones[v.index] in allowed_bones)
        ok = hits >= (len(f.verts) + 1) // 2
        if ok and extra_fn is not None:
            ok = extra_fn(f.calc_center_median())
        if not ok:
            del_faces.append(f)
    bmesh.ops.delete(bm, geom=del_faces, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.normal_update()

    # Optional Laplacian smooth on cloth shells removes anatomical skin creases so wool/linen drapes cleanly!
    if smooth_iters > 0 and bm.verts:
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.45, use_axis_x=True, use_axis_y=True, use_axis_z=False)
        if smooth_iters > 1:
            bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.35, use_axis_x=True, use_axis_y=True, use_axis_z=False)
        bm.normal_update()

    for v in bm.verts:
        if v.normal.length > 1e-5:
            v.co += v.normal * offset_m

    bm.to_mesh(dup.data)
    bm.free()
    dup.data.update()

    bpy.ops.object.select_all(action="DESELECT")
    dup.select_set(True)
    bpy.context.view_layer.objects.active = dup
    if decimate_ratio < 0.99 and len(dup.data.polygons) > 60:
        dec = dup.modifiers.new("Dec", "DECIMATE")
        dec.ratio = decimate_ratio
        bpy.ops.object.modifier_apply(modifier="Dec")
    for p in dup.data.polygons:
        p.use_smooth = True
    return dup


def make_lathe_mesh(name: str, profile: list[tuple[float, float]], segs: int = 20, center=(0.0, 0.0, 0.0), scale_xy=(1.0, 1.0), pleat_n=0, pleat_amp=0.0):
    bm = bmesh.new()
    rings = []
    for ri, (rad, z) in enumerate(profile):
        ring = []
        for s in range(segs):
            a = (s / segs) * math.tau
            p_mul = 1.0 + (pleat_amp * math.sin(a * pleat_n) * (ri / max(1, len(profile) - 1))) if pleat_n > 0 else 1.0
            x = center[0] + math.cos(a) * rad * scale_xy[0] * p_mul
            y = center[1] + math.sin(a) * rad * scale_xy[1] * p_mul
            ring.append(bm.verts.new((x, y, center[2] + z)))
        rings.append(ring)
    for ri in range(len(rings) - 1):
        r0, r1 = rings[ri], rings[ri + 1]
        for s in range(segs):
            s1 = (s + 1) % segs
            bm.faces.new((r0[s], r0[s1], r1[s1], r1[s]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


def add_cylinder_part(name: str, p0: Vector, p1: Vector, r0: float, r1: float, segs: int = 10):
    bm = bmesh.new()
    axis = p1 - p0
    z_dir = axis.normalized()
    up = Vector((0, 0, 1)) if abs(z_dir.z) < 0.92 else Vector((1, 0, 0))
    x_dir = up.cross(z_dir).normalized()
    y_dir = z_dir.cross(x_dir).normalized()
    ring0, ring1 = [], []
    for s in range(segs):
        a = (s / segs) * math.tau
        d = x_dir * math.cos(a) + y_dir * math.sin(a)
        ring0.append(bm.verts.new(p0 + d * r0))
        ring1.append(bm.verts.new(p1 + d * r1))
    for s in range(segs):
        s1 = (s + 1) % segs
        bm.faces.new((ring0[s], ring0[s1], ring1[s1], ring1[s]))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


def add_box_part(name: str, center, size, rot_euler=(0.0, 0.0, 0.0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    mat = Matrix.Translation(center) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.transform(bm, matrix=mat, verts=bm.verts)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def import_polyhaven_gear(gltf_rel: str, target_tris: int):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PH_DIR, gltf_rel))
    added = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in added if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [x for x in added if x.type != "MESH"]:
        bpy.data.objects.remove(o, do_unlink=True)
    total_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    ratio = min(1.0, max(0.05, target_tris / max(1, total_tris)))
    if ratio < 0.98:
        for o in meshes:
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            dec = o.modifiers.new("Dec", "DECIMATE")
            dec.ratio = ratio
            bpy.ops.object.modifier_apply(modifier="Dec")
            for p in o.data.polygons:
                p.use_smooth = True
    return meshes


def add_waist_belt_clean(waist_z: float, torso_obj, u0=0.0, v0=0.25, u1=0.25, v1=0.50):
    """Computes exact torso waist radius (excluding lowered arms!) so belt fits snugly outside cloth."""
    waist_vs = [v.co for v in torso_obj.data.vertices if abs(v.co.z - waist_z) < 0.08 and abs(v.co.x) < 0.21]
    max_x = min(0.215, max((abs(v.x) for v in waist_vs), default=0.165) + 0.018)
    max_y = min(0.180, max((abs(v.y) for v in waist_vs), default=0.125) + 0.018)
    cy = sum(v.y for v in waist_vs) / max(1, len(waist_vs))
    belt = make_lathe_mesh(
        "WaistBelt",
        [(1.0, -0.036), (1.03, 0.0), (1.0, 0.036)],
        segs=20, center=(0.0, cy, waist_z), scale_xy=(max_x, max_y),
    )
    set_uv_box_or_cyl(belt, u0, v0, u1, v1, mode="cyl")
    assign_rigid_weight(belt, "spine")
    return belt, max_x, max_y, cy


def make_smooth_footwear(body, dom_bones, bones, tall_boots: bool = True):
    """Builds authentic rounded-toe stitched leather medieval boots/turnshoes (ZERO bare-toe bumps!)."""
    parts = []
    for side, foot_b, shin_b in [("L", "foot_l", "shin_l"), ("R", "foot_r", "shin_r")]:
        # Convex hull of MakeHuman foot vertices -> clean rounded medieval leather shoe/boot foot!
        f_verts = [v.co.copy() for i, v in enumerate(body.data.vertices) if dom_bones[i] == foot_b or v.co.z < 0.13 and (v.co.x > 0 if side == "L" else v.co.x < 0)]
        bm = bmesh.new()
        for co in f_verts:
            bm.verts.new(co)
        bmesh.ops.convex_hull(bm, input=bm.verts)
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * 0.010
            if v.co.z < 0.002:
                v.co.z = 0.0
        m = bpy.data.meshes.new(f"BootFoot_{side}")
        bm.to_mesh(m)
        bm.free()
        fo = bpy.data.objects.new(f"BootFoot_{side}", m)
        bpy.context.collection.objects.link(fo)
        for p in fo.data.polygons:
            p.use_smooth = True
        set_uv_box_or_cyl(fo, 0.00, 0.25, 0.25, 0.50, mode="cyl")
        assign_rigid_weight(fo, foot_b)
        parts.append(fo)

        if tall_boots:
            # Fitted cuffed leather riding-boot shaft over MakeHuman calf (`shin_l/r`)
            shaft = extract_bone_shell(body, dom_bones, f"BootShaft_{side}", {shin_b}, offset_m=0.015, decimate_ratio=0.16, smooth_iters=3)
            set_uv_box_or_cyl(shaft, 0.00, 0.25, 0.25, 0.50, mode="cyl")
            parts.append(shaft)
    return parts


def build_swordsman_parts(body, dom_bones, eyeballs, bones):
    parts = []
    neck_z = bones["neck"][0].z
    head_c = (bones["head"][0] + bones["head"][1]) * 0.5
    head_top = max(v.co.z for v in body.data.vertices)
    waist_z = bones["spine"][0].z + 0.02
    knee_z = bones["shin_l"][0].z

    # 1. Real MakeHuman face/head + eyeballs
    head_skin = extract_bone_shell(body, dom_bones, "FaceSkin", {"head", "neck"}, offset_m=0.0, decimate_ratio=0.24, smooth_iters=0)
    set_uv_box_or_cyl(head_skin, 0.25, 0.00, 0.50, 0.50, mode="face", z_min=neck_z - 0.02, z_max=head_top)
    parts.append(head_skin)
    set_uv_box_or_cyl(eyeballs, 0.25, 0.00, 0.50, 0.50, mode="eyeball")
    parts.append(eyeballs)

    # 2. Forged riveted steel kettle helm (`kapalin`) seated deeply & cleanly over skull/brow
    helm = make_lathe_mesh(
        "KettleHelm",
        [(0.200, -0.028), (0.168, -0.006), (0.128, 0.012), (0.126, 0.062), (0.114, 0.112), (0.080, 0.150), (0.026, 0.172), (0.004, 0.178)],
        segs=22, center=(0.0, head_c.y - 0.018, head_top - 0.138), scale_xy=(0.98, 1.12),
    )
    set_uv_box_or_cyl(helm, 0.75, 0.75, 1.00, 1.00, mode="cyl")
    assign_rigid_weight(helm, "head")
    parts.append(helm)

    # 3. Chainmail coif framing jaw & upper shoulders cleanly
    coif = make_lathe_mesh(
        "ChainmailCoif",
        [(0.208, -0.065), (0.162, -0.012), (0.106, 0.045), (0.100, 0.105), (0.110, 0.162)],
        segs=18, center=(0.0, head_c.y + 0.014, neck_z - 0.03), scale_xy=(1.04, 0.96),
    )
    bm = bmesh.new()
    bm.from_mesh(coif.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < head_c.y - 0.020 and f.calc_center_median().z > neck_z + 0.052], context="FACES")
    bm.to_mesh(coif.data)
    bm.free()
    coif.data.update()
    set_uv_box_or_cyl(coif, 0.50, 0.75, 0.75, 1.00, mode="cyl")
    transfer_weights(body, coif)
    parts.append(coif)

    # 4. Full chainmail sleeves (upper_arm + forearm) + mail skirt hem
    mail_arms = extract_bone_shell(body, dom_bones, "MailSleeves", {"shoulder_l", "shoulder_r", "upper_arm_l", "forearm_l", "upper_arm_r", "forearm_r"}, offset_m=0.014, decimate_ratio=0.14, smooth_iters=2)
    set_uv_box_or_cyl(mail_arms, 0.50, 0.75, 0.75, 1.00, mode="box")
    parts.append(mail_arms)

    mail_skirt = make_lathe_mesh(
        "MailSkirt",
        [(0.238, 0.0), (0.220, 0.15), (0.195, 0.30)],
        segs=18, center=(0.0, -0.005, knee_z + 0.06), scale_xy=(1.06, 0.86), pleat_n=10, pleat_amp=0.025,
    )
    set_uv_box_or_cyl(mail_skirt, 0.50, 0.75, 0.75, 1.00, mode="cyl")
    transfer_weights(body, mail_skirt)
    parts.append(mail_skirt)

    # 5. Belted Marchland Cobalt-Ochre Surcoat (clean torso shell + smooth pleated skirt)
    surcoat_top = extract_bone_shell(body, dom_bones, "SurcoatTorso", {"hips", "spine", "chest", "shoulder_l", "shoulder_r"}, offset_m=0.022, decimate_ratio=0.18, smooth_iters=3)
    set_uv_box_or_cyl(surcoat_top, 0.00, 0.56, 0.50, 1.00, mode="cyl", z_min=bones["hips"][0].z - 0.08, z_max=neck_z)
    parts.append(surcoat_top)

    skirt_z0 = knee_z + 0.16
    skirt_h = (waist_z + 0.02) - skirt_z0
    surcoat_skirt = make_lathe_mesh(
        "SurcoatSkirt",
        [(0.258, 0.0), (0.242, skirt_h * 0.36), (0.216, skirt_h * 0.74), (0.192, skirt_h)],
        segs=20, center=(0.0, -0.008, skirt_z0), scale_xy=(1.06, 0.88), pleat_n=9, pleat_amp=0.04,
    )
    set_uv_box_or_cyl(surcoat_skirt, 0.00, 0.50, 0.50, 0.72, mode="cyl")
    transfer_weights(body, surcoat_skirt)
    parts.append(surcoat_skirt)

    # 6. Steel pauldrons + vambraces + armored gauntlets
    for side, s_sign, uarm_b, farm_b, hand_b in [
        ("L", 1.0, "upper_arm_l", "forearm_l", "hand_l"),
        ("R", -1.0, "upper_arm_r", "forearm_r", "hand_r"),
    ]:
        sh_p = bones[uarm_b][0]
        el_p = bones[farm_b][0]
        h_p = bones[hand_b][0]
        for li, (dz, rad) in enumerate([(0.022, 0.090), (-0.035, 0.080)]):
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=rad)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().x * s_sign < -0.015 or f.calc_center_median().z < -0.035], context="FACES")
            m = bpy.data.meshes.new(f"Pauldron_{side}_{li}")
            bm.to_mesh(m)
            bm.free()
            po = bpy.data.objects.new(f"Pauldron_{side}_{li}", m)
            bpy.context.collection.objects.link(po)
            po.location = (sh_p.x + s_sign * 0.015, sh_p.y, sh_p.z + dz)
            po.scale = (0.88, 1.08, 0.92)
            bpy.ops.object.select_all(action="DESELECT")
            po.select_set(True)
            bpy.context.view_layer.objects.active = po
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            for p in po.data.polygons:
                p.use_smooth = True
            set_uv_box_or_cyl(po, 0.75, 0.75, 1.00, 1.00, mode="box")
            assign_rigid_weight(po, uarm_b)
            parts.append(po)

        vamb = add_cylinder_part(f"Vambrace_{side}", el_p.lerp(h_p, 0.12), h_p, 0.056, 0.044, segs=10)
        set_uv_box_or_cyl(vamb, 0.75, 0.75, 1.00, 1.00, mode="cyl")
        assign_rigid_weight(vamb, farm_b)
        parts.append(vamb)

        gaunt = extract_bone_shell(body, dom_bones, f"Gauntlet_{side}", {hand_b}, offset_m=0.008, decimate_ratio=0.16, smooth_iters=1)
        set_uv_box_or_cyl(gaunt, 0.00, 0.25, 0.25, 0.50, mode="box")
        parts.append(gaunt)

    # 7. Clean outer leather sword-belt + forged brass buckle + hip scabbard
    belt, bx, by, bcy = add_waist_belt_clean(waist_z, surcoat_top)
    parts.append(belt)
    buckle = add_box_part("BrassBuckle", (0.0, bcy - by - 0.008, waist_z), (0.075, 0.025, 0.082))
    set_uv_box_or_cyl(buckle, 0.175, 0.01, 0.245, 0.24, mode="box")
    assign_rigid_weight(buckle, "spine")
    parts.append(buckle)

    scab = add_cylinder_part("Scabbard", Vector((bx + 0.01, 0.02, waist_z - 0.02)), Vector((bx + 0.06, 0.24, knee_z - 0.06)), 0.025, 0.016, segs=8)
    set_uv_box_or_cyl(scab, 0.00, 0.25, 0.25, 0.50, mode="cyl")
    assign_rigid_weight(scab, "hips")
    parts.append(scab)

    # 8. Wool hose & smooth rounded-toe leather boots
    hose = extract_bone_shell(body, dom_bones, "WoolHose", {"thigh_l", "thigh_r"}, offset_m=0.010, decimate_ratio=0.14, smooth_iters=2)
    set_uv_box_or_cyl(hose, 0.005, 0.005, 0.165, 0.24, mode="cyl")
    parts.append(hose)
    parts.extend(make_smooth_footwear(body, dom_bones, bones, tall_boots=True))

    # 9. REAL Poly Haven CC0 Photogrammetry `antique_estoc` held forward & upward at combat ready in `hand_r`!
    estoc_meshes = import_polyhaven_gear("antique_estoc/antique_estoc.gltf", target_tris=520)
    hand_r_p = bones["hand_r"][0].lerp(bones["hand_r"][1], 0.45)
    for eo in estoc_meshes:
        s = 0.74
        # +X rotation tilts +Z blade forward toward -Y (so +55° X points blade boldly forward & up!)
        rot = Euler((math.radians(58.0), math.radians(-14.0), math.radians(-10.0)), "XYZ").to_matrix().to_4x4()
        mat = Matrix.Translation(hand_r_p + Vector((-0.02, -0.04, 0.01))) @ rot @ Matrix.Scale(s, 4)
        eo.data.transform(mat)
        eo.data.update()
        remap_existing_uvs(eo, 0.50, 0.50, 1.00, 0.75)
        assign_rigid_weight(eo, "hand_r")
        parts.append(eo)

    # 10. REAL Poly Haven CC0 Photogrammetry `kite_shield` strapped cleanly outside `forearm_l`
    shield_meshes = import_polyhaven_gear("kite_shield/kite_shield.gltf", target_tris=560)
    farm_l_mid = bones["forearm_l"][0].lerp(bones["forearm_l"][1], 0.48)
    for so in shield_meshes:
        s = 0.65
        rot = Euler((math.radians(4.0), math.radians(-6.0), math.radians(65.0)), "XYZ").to_matrix().to_4x4()
        mat = Matrix.Translation(farm_l_mid + Vector((0.115, -0.055, -0.04))) @ rot @ Matrix.Scale(s, 4)
        so.data.transform(mat)
        so.data.update()
        if "body" in so.name.lower():
            remap_existing_uvs(so, 0.50, 0.00, 0.75, 0.50)
        else:
            remap_existing_uvs(so, 0.75, 0.00, 1.00, 0.50)
        assign_rigid_weight(so, "forearm_l")
        parts.append(so)

    return parts


def build_archer_parts(body, dom_bones, eyeballs, bones):
    parts = []
    neck_z = bones["neck"][0].z
    head_c = (bones["head"][0] + bones["head"][1]) * 0.5
    head_top = max(v.co.z for v in body.data.vertices)
    waist_z = bones["spine"][0].z + 0.02
    knee_z = bones["shin_l"][0].z
    hand_l_p = bones["hand_l"][0].lerp(bones["hand_l"][1], 0.5)

    # 1. Real MakeHuman face/head + bare hands + eyeballs
    head_skin = extract_bone_shell(body, dom_bones, "FaceSkin", {"head", "neck"}, offset_m=0.0, decimate_ratio=0.24, smooth_iters=0)
    set_uv_box_or_cyl(head_skin, 0.25, 0.00, 0.50, 0.50, mode="face", z_min=neck_z - 0.02, z_max=head_top)
    parts.append(head_skin)
    set_uv_box_or_cyl(eyeballs, 0.25, 0.00, 0.50, 0.50, mode="eyeball")
    parts.append(eyeballs)

    hands = extract_bone_shell(body, dom_bones, "HandsSkin", {"hand_l", "hand_r"}, offset_m=0.002, decimate_ratio=0.16, smooth_iters=0)
    set_uv_box_or_cyl(hands, 0.27, 0.03, 0.44, 0.24, mode="box")
    parts.append(hands)

    # 2. Draped Marchland Cobalt wool chaperon hood pulled cleanly forward over forehead & brow
    hood = make_lathe_mesh(
        "ChaperonHood",
        [(0.255, -0.155), (0.200, -0.068), (0.125, 0.018), (0.124, 0.105), (0.132, 0.195), (0.114, 0.248), (0.032, 0.274)],
        segs=18, center=(0.0, head_c.y - 0.008, neck_z - 0.01), scale_xy=(1.06, 1.12), pleat_n=8, pleat_amp=0.025,
    )
    bm = bmesh.new()
    bm.from_mesh(hood.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < head_c.y - 0.038 and f.calc_center_median().z > neck_z + 0.042 and f.calc_center_median().z < head_top - 0.055], context="FACES")
    bm.to_mesh(hood.data)
    bm.free()
    hood.data.update()
    set_uv_box_or_cyl(hood, 0.00, 0.50, 0.25, 1.00, mode="cyl")
    transfer_weights(body, hood)
    parts.append(hood)

    tail = add_cylinder_part("HoodLiripipe", Vector((0.0, head_c.y + 0.11, head_top - 0.03)), Vector((0.05, head_c.y + 0.22, neck_z - 0.10)), 0.030, 0.012, segs=7)
    set_uv_box_or_cyl(tail, 0.00, 0.50, 0.25, 1.00, mode="cyl")
    assign_rigid_weight(tail, "head")
    parts.append(tail)

    # 3. FULL diamond-quilted padded gambeson + pleated skirt
    gamb_top = extract_bone_shell(
        body, dom_bones, "GambesonUpper",
        {"hips", "spine", "chest", "shoulder_l", "shoulder_r", "upper_arm_l", "forearm_l", "upper_arm_r", "forearm_r"},
        offset_m=0.018, decimate_ratio=0.18, smooth_iters=3,
    )
    set_uv_box_or_cyl(gamb_top, 0.255, 0.50, 0.495, 1.00, mode="cyl")
    parts.append(gamb_top)

    skirt_z0 = knee_z + 0.18
    skirt_h = (waist_z + 0.03) - skirt_z0
    gamb_skirt = make_lathe_mesh(
        "GambesonSkirt",
        [(0.240, 0.0), (0.222, skirt_h * 0.45), (0.194, skirt_h)],
        segs=18, center=(0.0, -0.008, skirt_z0), scale_xy=(1.05, 0.88), pleat_n=8, pleat_amp=0.03,
    )
    set_uv_box_or_cyl(gamb_skirt, 0.255, 0.50, 0.495, 0.72, mode="cyl")
    transfer_weights(body, gamb_skirt)
    parts.append(gamb_skirt)

    # 4. Snug outer leather belt (arms excluded from radius!), brass buckle, archery bracer, quiver & arrows
    belt, bx, by, bcy = add_waist_belt_clean(waist_z, gamb_top)
    parts.append(belt)
    buckle = add_box_part("ArcherBuckle", (0.0, bcy - by - 0.006, waist_z), (0.068, 0.022, 0.072))
    set_uv_box_or_cyl(buckle, 0.175, 0.01, 0.245, 0.24, mode="box")
    assign_rigid_weight(buckle, "spine")
    parts.append(buckle)

    bracer = add_cylinder_part("ArcheryBracer", bones["forearm_l"][0].lerp(bones["hand_l"][0], 0.28), bones["hand_l"][0], 0.052, 0.044, segs=10)
    set_uv_box_or_cyl(bracer, 0.00, 0.25, 0.25, 0.50, mode="cyl")
    assign_rigid_weight(bracer, "forearm_l")
    parts.append(bracer)

    q_bot = Vector((-0.07, 0.17, waist_z - 0.05))
    q_top = Vector((0.11, 0.18, neck_z - 0.05))
    quiver = add_cylinder_part("Quiver", q_bot, q_top, 0.048, 0.062, segs=10)
    set_uv_box_or_cyl(quiver, 0.00, 0.25, 0.25, 0.50, mode="cyl")
    assign_rigid_weight(quiver, "chest")
    parts.append(quiver)

    q_dir = (q_top - q_bot).normalized()
    for ai in range(6):
        ang = (ai / 6.0) * math.tau
        off = Vector((math.cos(ang) * 0.026, math.sin(ang) * 0.020, 0.0))
        shaft = add_cylinder_part(f"ArrowShaft_{ai}", q_top + off - q_dir * 0.05, q_top + off + q_dir * 0.17, 0.005, 0.005, segs=5)
        set_uv_box_or_cyl(shaft, 0.50, 0.50, 0.75, 1.00, mode="cyl")
        assign_rigid_weight(shaft, "chest")
        parts.append(shaft)
        fletch = add_cylinder_part(f"ArrowFletch_{ai}", q_top + off + q_dir * 0.09, q_top + off + q_dir * 0.16, 0.016, 0.008, segs=4)
        set_uv_box_or_cyl(fletch, 0.50, 0.00, 0.75, 0.50, mode="box")
        assign_rigid_weight(fletch, "chest")
        parts.append(fletch)

    # 5. Wool hose & smooth rounded-toe leather boots
    hose = extract_bone_shell(body, dom_bones, "WoolHose", {"thigh_l", "thigh_r"}, offset_m=0.009, decimate_ratio=0.14, smooth_iters=2)
    set_uv_box_or_cyl(hose, 0.005, 0.005, 0.165, 0.24, mode="cyl")
    parts.append(hose)
    parts.extend(make_smooth_footwear(body, dom_bones, bones, tall_boots=True))

    # 6. 1.56 m Curved English Yew Warbow + bowstring held vertically in `hand_l`!
    bow_pts = []
    n_seg = 12
    for i in range(n_seg + 1):
        t = (i / n_seg) * 2.0 - 1.0
        bz = t * 0.76
        by = -0.05 + (t * t) * 0.21
        bow_pts.append(hand_l_p + Vector((0.02, by, bz)))
    bm = bmesh.new()
    rings = []
    for i, pt in enumerate(bow_pts):
        t = abs((i / n_seg) * 2.0 - 1.0)
        rad = 0.019 * (1.0 - 0.45 * t)
        ring = [bm.verts.new(pt + Vector((math.cos(s / 7 * math.tau) * rad * 0.85, math.sin(s / 7 * math.tau) * rad * 1.15, 0.0))) for s in range(7)]
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(7):
            s1 = (s + 1) % 7
            bm.faces.new((rings[i][s], rings[i][s1], rings[i + 1][s1], rings[i + 1][s]))
    bow_m = bpy.data.meshes.new("YewWarbow")
    bm.to_mesh(bow_m)
    bm.free()
    bow_obj = bpy.data.objects.new("YewWarbow", bow_m)
    bpy.context.collection.objects.link(bow_obj)
    for p in bow_m.polygons:
        p.use_smooth = True
    set_uv_box_or_cyl(bow_obj, 0.50, 0.50, 0.75, 1.00, mode="cyl")
    assign_rigid_weight(bow_obj, "hand_l")
    parts.append(bow_obj)

    bstring = add_cylinder_part("BowString", bow_pts[0], bow_pts[-1], 0.0035, 0.0035, segs=5)
    set_uv_box_or_cyl(bstring, 0.50, 0.00, 0.75, 0.50, mode="cyl")
    assign_rigid_weight(bstring, "hand_l")
    parts.append(bstring)

    return parts


def build_citizen_parts(body, dom_bones, eyeballs, bones):
    parts = []
    neck_z = bones["neck"][0].z
    head_c = (bones["head"][0] + bones["head"][1]) * 0.5
    head_top = max(v.co.z for v in body.data.vertices)
    waist_z = bones["spine"][0].z + 0.02
    knee_z = bones["shin_l"][0].z

    # 1. Real MakeHuman face/head + bare hands + eyeballs
    head_skin = extract_bone_shell(body, dom_bones, "FaceSkin", {"head", "neck"}, offset_m=0.0, decimate_ratio=0.24, smooth_iters=0)
    set_uv_box_or_cyl(head_skin, 0.25, 0.00, 0.50, 0.50, mode="face", z_min=neck_z - 0.02, z_max=head_top)
    parts.append(head_skin)
    set_uv_box_or_cyl(eyeballs, 0.25, 0.00, 0.50, 0.50, mode="eyeball")
    parts.append(eyeballs)

    hands = extract_bone_shell(body, dom_bones, "HandsSkin", {"hand_l", "hand_r"}, offset_m=0.002, decimate_ratio=0.16, smooth_iters=0)
    set_uv_box_or_cyl(hands, 0.27, 0.03, 0.44, 0.24, mode="box")
    parts.append(hands)

    # 2. Rustic medieval peasant wool cap seated snugly over forehead & crown
    cap = make_lathe_mesh(
        "PeasantCap",
        [(0.128, -0.016), (0.125, 0.028), (0.114, 0.075), (0.080, 0.112), (0.018, 0.126)],
        segs=18, center=(0.0, head_c.y - 0.010, head_top - 0.116), scale_xy=(0.98, 1.12),
    )
    set_uv_box_or_cyl(cap, 0.75, 0.00, 1.00, 0.50, mode="cyl")
    assign_rigid_weight(cap, "head")
    parts.append(cap)

    # 3. Full seamless unbleached linen sleeves including shoulder overlap (ZERO shoulder gaps!)
    sleeves = extract_bone_shell(body, dom_bones, "LinenSleeves", {"shoulder_l", "shoulder_r", "upper_arm_l", "forearm_l", "upper_arm_r", "forearm_r"}, offset_m=0.014, decimate_ratio=0.15, smooth_iters=2)
    set_uv_box_or_cyl(sleeves, 0.255, 0.50, 0.495, 1.00, mode="box")
    parts.append(sleeves)

    collar = make_lathe_mesh("TunicCollar", [(0.115, -0.02), (0.105, 0.02), (0.095, 0.045)], segs=16, center=(0.0, head_c.y + 0.012, neck_z - 0.02), scale_xy=(1.12, 1.05))
    set_uv_box_or_cyl(collar, 0.255, 0.50, 0.495, 1.00, mode="cyl")
    assign_rigid_weight(collar, "chest")
    parts.append(collar)

    tunic_top = extract_bone_shell(body, dom_bones, "WoolTunicTorso", {"hips", "spine", "chest", "shoulder_l", "shoulder_r"}, offset_m=0.021, decimate_ratio=0.18, smooth_iters=4)
    set_uv_box_or_cyl(tunic_top, 0.005, 0.50, 0.245, 1.00, mode="cyl")
    parts.append(tunic_top)

    skirt_z0 = knee_z + 0.18
    skirt_h = (waist_z + 0.03) - skirt_z0
    tunic_skirt = make_lathe_mesh(
        "WoolTunicSkirt",
        [(0.236, 0.0), (0.218, skirt_h * 0.45), (0.192, skirt_h)],
        segs=18, center=(0.0, -0.008, skirt_z0), scale_xy=(1.05, 0.88), pleat_n=8, pleat_amp=0.032,
    )
    set_uv_box_or_cyl(tunic_skirt, 0.005, 0.50, 0.245, 0.72, mode="cyl")
    transfer_weights(body, tunic_skirt)
    parts.append(tunic_skirt)

    # 4. Snug outer leather belt + side tool/coin pouch
    belt, bx, by, bcy = add_waist_belt_clean(waist_z, tunic_top)
    parts.append(belt)
    pouch = add_box_part("BeltPouch", (bx + 0.01, -0.04, waist_z - 0.085), (0.072, 0.092, 0.125), (0.08, 0.0, 0.15))
    set_uv_box_or_cyl(pouch, 0.00, 0.25, 0.25, 0.50, mode="box")
    assign_rigid_weight(pouch, "hips")
    parts.append(pouch)

    # 5. Wool hose & smooth rounded-toe medieval leather turnshoes
    hose = extract_bone_shell(body, dom_bones, "WoolHose", {"thigh_l", "thigh_r", "shin_l", "shin_r"}, offset_m=0.009, decimate_ratio=0.14, smooth_iters=2)
    set_uv_box_or_cyl(hose, 0.005, 0.005, 0.165, 0.24, mode="cyl")
    parts.append(hose)
    parts.extend(make_smooth_footwear(body, dom_bones, bones, tall_boots=False))

    return parts


def bake_vertex_ao(obj, samples: int = 16):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2

    bpy.ops.mesh.primitive_plane_add(size=6.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    mat = bpy.data.materials.new("AoBakeMat")
    mat.use_nodes = True
    ground.data.materials.append(mat)
    obj.data.materials.clear()
    obj.data.materials.append(mat)

    mesh = obj.data
    while mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])
    ao_attr = mesh.color_attributes.new(name="AO_Raw", type="FLOAT_COLOR", domain="CORNER")
    mesh.color_attributes.active_color = ao_attr

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type="AO")

    ao_vals = [c.color[0] for c in mesh.color_attributes["AO_Raw"].data]
    mesh.color_attributes.remove(mesh.color_attributes["AO_Raw"])
    final_attr = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for i, a in enumerate(ao_vals):
        v = max(0.46, min(1.0, a ** 0.68))
        final_attr.data[i].color = (v, v, v, 1.0)
    mesh.color_attributes.active_color_index = 0
    mesh.color_attributes.render_color_index = 0
    bpy.data.objects.remove(ground, do_unlink=True)


def attach_character_pbr(obj, kind: str, alb_p: str, nor_p: str, orm_p: str):
    mat = bpy.data.materials.new(f"{kind.capitalize()}PBR")
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes["Principled BSDF"]

    tex_alb = nodes.new("ShaderNodeTexImage")
    tex_alb.image = bpy.data.images.load(alb_p, check_existing=True)
    tex_alb.image.colorspace_settings.name = "sRGB"

    tex_nor = nodes.new("ShaderNodeTexImage")
    tex_nor.image = bpy.data.images.load(nor_p, check_existing=True)
    tex_nor.image.colorspace_settings.name = "Non-Color"

    tex_orm = nodes.new("ShaderNodeTexImage")
    tex_orm.image = bpy.data.images.load(orm_p, check_existing=True)
    tex_orm.image.colorspace_settings.name = "Non-Color"

    sep = nodes.new("ShaderNodeSeparateColor")
    links.new(tex_orm.outputs["Color"], sep.inputs["Color"])
    links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

    vcol = nodes.new("ShaderNodeVertexColor")
    vcol.layer_name = "Color"
    mul = nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    links.new(tex_alb.outputs["Color"], mul.inputs[6])
    links.new(vcol.outputs["Color"], mul.inputs[7])
    links.new(mul.outputs[2], bsdf.inputs["Base Color"])

    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 1.0
    links.new(tex_nor.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    obj.data.materials.clear()
    obj.data.materials.append(mat)


def add_character_animations(arm_obj, kind: str):
    """
    Creates smooth 30 fps looping `idle`, `walk`, and `attack` NLA strips using WORLD-AXIS
    quaternions so limbs always swing forward/back/up anatomically with zero axis-roll surprises!
    World axes: +X = pitch forward (limb swings toward -Y front), +Y = roll down/out, +Z = yaw left.
    """
    bpy.context.scene.render.fps = 30
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "QUATERNION"

    arm_obj.animation_data_create()

    def set_rot(pb, bname: str, rx: float = 0.0, ry: float = 0.0, rz: float = 0.0):
        pb[bname].rotation_quaternion = world_rot_to_bone_quat(pb[bname], rx, ry, rz)

    def make_action(act_name: str, frames: int, pose_fn):
        act = bpy.data.actions.new(act_name)
        arm_obj.animation_data.action = act
        step = 3
        sample_frames = list(range(0, frames, step)) + [frames]
        for f in sample_frames:
            t = (f % frames) / float(frames)
            for pb in arm_obj.pose.bones:
                pb.location = (0.0, 0.0, 0.0)
                pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
            pose_fn(arm_obj.pose.bones, t)
            for pb in arm_obj.pose.bones:
                if abs(pb.rotation_quaternion.w - 1.0) > 1e-4 or pb.rotation_quaternion.x**2 + pb.rotation_quaternion.y**2 + pb.rotation_quaternion.z**2 > 1e-6:
                    pb.keyframe_insert(data_path="rotation_quaternion", frame=f)
                if any(abs(v) > 1e-4 for v in pb.location):
                    pb.keyframe_insert(data_path="location", frame=f)
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = act_name
        track.strips.new(act_name, 0, act)
        arm_obj.animation_data.action = None

    def idle_pose(pb, t):
        br = math.sin(t * math.tau)
        sw = math.sin(t * math.tau * 0.5)
        set_rot(pb, "chest", rx=-0.025 * br, rz=0.03 * sw)
        set_rot(pb, "head", rx=0.015 * br, rz=0.06 * sw)
        if kind == "swordsman":
            # Alert grounded combat guard: shield lifted forward (-X), sword ready forward at right hip (-X)
            set_rot(pb, "upper_arm_l", rx=-0.28 - 0.03 * br, ry=-0.10)
            set_rot(pb, "forearm_l", rx=-0.46, rz=-0.16)
            set_rot(pb, "upper_arm_r", rx=-0.24 + 0.03 * br, ry=0.08)
            set_rot(pb, "forearm_r", rx=-0.42, rz=0.08)
        elif kind == "archer":
            # Ready warbow stance: bow held forward-left (-X), right hand poised forward near bowstring (-X)
            set_rot(pb, "upper_arm_l", rx=-0.46 - 0.03 * br, ry=-0.08)
            set_rot(pb, "forearm_l", rx=-0.26)
            set_rot(pb, "upper_arm_r", rx=-0.20 + 0.03 * br, ry=0.06)
            set_rot(pb, "forearm_r", rx=-0.42, rz=0.14)
        else:
            # Relaxed villager breathing
            set_rot(pb, "upper_arm_l", rx=-0.06 - 0.02 * br)
            set_rot(pb, "forearm_l", rx=-0.12)
            set_rot(pb, "upper_arm_r", rx=-0.06 + 0.02 * br)
            set_rot(pb, "forearm_r", rx=-0.12)

    def walk_pose(pb, t):
        s = math.sin(t * math.tau)
        c = math.cos(t * math.tau)
        pb["hips"].location = (0.0, 0.0, 0.024 * abs(c))
        set_rot(pb, "hips", rz=0.06 * s)
        # Right-hand rule: -rx swings downward limb FORWARD (-Y), +rx bends shin/knee BACKWARD (+Y)!
        set_rot(pb, "thigh_l", rx=-0.44 * s)
        set_rot(pb, "shin_l", rx=max(0.0, 0.58 * c))
        set_rot(pb, "thigh_r", rx=0.44 * s)
        set_rot(pb, "shin_r", rx=max(0.0, -0.58 * c))
        set_rot(pb, "chest", rx=0.06, rz=-0.08 * s)
        if kind == "swordsman":
            set_rot(pb, "upper_arm_l", rx=-0.26 + 0.14 * s, ry=-0.10)
            set_rot(pb, "forearm_l", rx=-0.44, rz=-0.16)
            set_rot(pb, "upper_arm_r", rx=-0.20 - 0.30 * s, ry=0.08)
            set_rot(pb, "forearm_r", rx=-0.34)
        elif kind == "archer":
            set_rot(pb, "upper_arm_l", rx=-0.40 + 0.18 * s, ry=-0.08)
            set_rot(pb, "forearm_l", rx=-0.24)
            set_rot(pb, "upper_arm_r", rx=-0.08 - 0.34 * s)
            set_rot(pb, "forearm_r", rx=-0.26)
        else:
            set_rot(pb, "upper_arm_l", rx=0.34 * s)
            set_rot(pb, "forearm_l", rx=-0.20)
            set_rot(pb, "upper_arm_r", rx=-0.34 * s)
            set_rot(pb, "forearm_r", rx=-0.20)

    def attack_pose(pb, t):
        if kind == "archer":
            if t < 0.48:
                k = math.sin((t / 0.48) * math.pi * 0.5)
            elif t < 0.72:
                k = 1.0
            else:
                k = max(0.0, 1.0 - (t - 0.72) / 0.28)
            set_rot(pb, "chest", rz=-0.52 * k)
            set_rot(pb, "head", rz=0.46 * k)
            set_rot(pb, "upper_arm_l", rx=-1.18 * k - 0.38 * (1 - k), ry=-0.15 * k)
            set_rot(pb, "forearm_l", rx=-0.12 * (1 - k))
            set_rot(pb, "upper_arm_r", rx=-0.95 * k - 0.18 * (1 - k), ry=0.55 * k)
            set_rot(pb, "forearm_r", rx=-1.20 * k, rz=0.55 * k)
        else:
            if t < 0.36:
                k = math.sin((t / 0.36) * math.pi * 0.5)
                set_rot(pb, "chest", rx=-0.10 * k, rz=-0.36 * k)
                set_rot(pb, "upper_arm_r", rx=-1.65 * k, ry=0.25 * k)
                set_rot(pb, "forearm_r", rx=-0.55 * k)
            elif t < 0.58:
                k = (t - 0.36) / 0.22
                set_rot(pb, "chest", rx=-0.10 + 0.28 * k, rz=-0.36 + 0.80 * k)
                set_rot(pb, "upper_arm_r", rx=-1.65 + 2.05 * k, ry=0.25 - 0.35 * k)
                set_rot(pb, "forearm_r", rx=-0.55 + 0.30 * k)
            else:
                k = 1.0 - (t - 0.58) / 0.42
                set_rot(pb, "chest", rx=0.18 * k, rz=0.44 * k)
                set_rot(pb, "upper_arm_r", rx=0.40 * k, ry=-0.10 * k)
                set_rot(pb, "forearm_r", rx=-0.25 * k)
            if kind == "swordsman":
                set_rot(pb, "upper_arm_l", rx=-0.34, ry=-0.12)
                set_rot(pb, "forearm_l", rx=-0.52, rz=-0.22)

    make_action("idle", 60, idle_pose)
    make_action("walk", 30, walk_pose)
    make_action("attack", 36, attack_pose)

    for pb in arm_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    bpy.ops.object.mode_set(mode="OBJECT")


def build_and_export_character(kind: str):
    print(f"\n=== Building Stage 5 MakeHuman character v2: {kind} ===")
    clear_scene()
    alb_p, nor_p, orm_p = build_character_atlas(kind)

    target_h = 1.79 if kind == "swordsman" else (1.77 if kind == "archer" else 1.73)
    body, eyeballs, arm_obj, bones = load_makehuman_rigged_base(target_h)
    dom_bones = dominant_bone_per_vert(body)

    if kind == "swordsman":
        parts = build_swordsman_parts(body, dom_bones, eyeballs, bones)
    elif kind == "archer":
        parts = build_archer_parts(body, dom_bones, eyeballs, bones)
    else:
        parts = build_citizen_parts(body, dom_bones, eyeballs, bones)

    bpy.data.objects.remove(body, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    char_obj = bpy.context.active_object
    char_obj.name = f"{kind}_mesh"

    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)

    bake_vertex_ao(char_obj, samples=16)
    attach_character_pbr(char_obj, kind, alb_p, nor_p, orm_p)

    char_obj.parent = arm_obj
    mod = char_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    add_character_animations(arm_obj, kind)

    tri0 = sum(len(p.vertices) - 2 for p in char_obj.data.polygons)
    print(f"  [{kind}] LOD0 unified mesh: {tri0} tris, {len(arm_obj.data.bones)} bones")

    def export_glb(objs, path, export_anims=True, embed_tex=True):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_apply=False,
            export_yup=True,
            export_texcoords=True,
            export_normals=True,
            export_vertex_color="MATERIAL",
            export_materials="EXPORT" if embed_tex else "PLACEHOLDER",
            export_animations=export_anims,
            export_skins=export_anims,
            export_nla_strips=export_anims,
            export_bake_animation=export_anims,
            export_optimize_animation_size=True,
        )

    raw_lod0 = os.path.join(RAW_OUT, f"{kind}_lod0.glb")
    export_glb([arm_obj, char_obj], raw_lod0, export_anims=True, embed_tex=True)

    for lod_name, target_t in [("lod1", 1850), ("lod2", 680)]:
        dup_m = char_obj.data.copy()
        dup = bpy.data.objects.new(f"{kind}_{lod_name}", dup_m)
        bpy.context.collection.objects.link(dup)
        for vg in char_obj.vertex_groups:
            dup.vertex_groups.new(name=vg.name)
        for vi, v in enumerate(char_obj.data.vertices):
            for g in v.groups:
                dup.vertex_groups[g.group].add([vi], g.weight, "REPLACE")
        bpy.ops.object.select_all(action="DESELECT")
        dup.select_set(True)
        bpy.context.view_layer.objects.active = dup
        dec = dup.modifiers.new("Dec", "DECIMATE")
        dec.ratio = min(0.95, max(0.08, target_t / max(1, tri0)))
        bpy.ops.object.modifier_apply(modifier="Dec")
        bpy.ops.object.vertex_group_limit_total(limit=4)
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        dup.parent = arm_obj
        amod = dup.modifiers.new("Armature", "ARMATURE")
        amod.object = arm_obj
        tris_l = sum(len(p.vertices) - 2 for p in dup.data.polygons)
        print(f"  [{kind}] {lod_name.upper()}: {tris_l} tris")
        export_glb([arm_obj, dup], os.path.join(RAW_OUT, f"{kind}_{lod_name}.glb"), export_anims=True, embed_tex=False)
        bpy.data.objects.remove(dup, do_unlink=True)

    sh_m = char_obj.data.copy()
    sh = bpy.data.objects.new(f"{kind}_shadow", sh_m)
    bpy.context.collection.objects.link(sh)
    sh.data.materials.clear()
    bpy.ops.object.select_all(action="DESELECT")
    sh.select_set(True)
    bpy.context.view_layer.objects.active = sh
    dec = sh.modifiers.new("Dec", "DECIMATE")
    dec.ratio = min(0.20, 120.0 / max(1, tri0))
    bpy.ops.object.modifier_apply(modifier="Dec")
    print(f"  [{kind}] SHADOW: {sum(len(p.vertices) - 2 for p in sh.data.polygons)} tris")
    export_glb([sh], os.path.join(RAW_OUT, f"{kind}_shadow.glb"), export_anims=False, embed_tex=False)

    env = {**os.environ, "KTX2_TOOLS": "/tmp/ktx2-tools/node_modules"}
    subprocess.run(
        ["node", OPTIMIZE_SCRIPT, raw_lod0, os.path.join(FINAL_OUT, f"{kind}_lod0.glb"), "--ktx2", "--color", "auto", "--data", "auto"],
        check=True, env=env,
    )
    for suf in ("lod1", "lod2", "shadow"):
        subprocess.run(
            ["node", OPTIMIZE_SCRIPT, os.path.join(RAW_OUT, f"{kind}_{suf}.glb"), os.path.join(FINAL_OUT, f"{kind}_{suf}.glb")],
            check=True, env=env,
        )


def render_character_lineup_preview():
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 28
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1350
    scene.render.resolution_y = 760
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 92

    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.48, 0.58, 0.72, 1.0)
    bg.inputs["Strength"].default_value = 0.95

    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, 0.0))
    gnd = bpy.context.active_object
    gm = bpy.data.materials.new("GroundMat")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.28, 0.25, 0.20, 1.0)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.88
    gnd.data.materials.append(gm)

    placements = [
        ("swordsman", -0.95, 0.0, math.radians(-18.0)),
        ("archer", 0.0, 0.08, math.radians(12.0)),
        ("citizen", 0.95, 0.0, math.radians(16.0)),
    ]
    for kind, px, py, yaw in placements:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(RAW_OUT, f"{kind}_lod0.glb"))
        added = [o for o in bpy.data.objects if o not in before]
        for r in [o for o in added if o.parent is None]:
            r.location = (px, py, 0.0)
            r.rotation_euler = (0.0, 0.0, yaw)
        for o in added:
            if o.type == "ARMATURE" and o.animation_data and o.animation_data.nla_tracks:
                for tr in o.animation_data.nla_tracks:
                    tr.mute = (tr.name != "idle")
    scene.frame_set(15)

    sun_d = bpy.data.lights.new("Sun", type="SUN")
    sun_d.energy = 4.2
    sun_d.color = (1.0, 0.94, 0.84)
    sun_o = bpy.data.objects.new("Sun", sun_d)
    bpy.context.collection.objects.link(sun_o)
    sun_o.rotation_euler = (math.radians(52), math.radians(14), math.radians(-38))

    cam_d = bpy.data.cameras.new("Cam")
    cam_d.lens = 42.0
    cam_o = bpy.data.objects.new("Cam", cam_d)
    bpy.context.collection.objects.link(cam_o)
    scene.camera = cam_o
    cam_o.location = (0.0, -4.35, 1.08)
    direction = Vector((0.0, 0.0, 0.94)) - cam_o.location
    cam_o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = PREVIEW_JPG
    bpy.ops.render.render(write_still=True)
    print(f"Saved Cycles character showcase v2: {PREVIEW_JPG}")


if __name__ == "__main__":
    for archetype in ("swordsman", "archer", "citizen"):
        build_and_export_character(archetype)
    render_character_lineup_preview()
    print("\nALL 3 STAGE 5 CHARACTERS v2 BUILT & OPTIMIZED SUCCESSFULLY!")
