"""
Builds the realistic XIII-XIV c. medieval foot swordsman (`swordsman`) in Blender 4.2:
  - 1.80 m athletic human proportions, grounded flat at Z = 0, facing -Y (Blender) / +Z (glTF)
  - Grounded combat stance (left foot forward, curved heater shield guarding left flank, arming sword ready)
  - Authentic XIII-XIV c. equipment (docs/BLENDER.md §A1):
      * Riveted steel kettle helm (kapalin) with wide beveled brim & crown bands
      * Sculpted weathered face & neck inside chainmail coif
      * Knee-length chainmail hauberk (sleeves + flared split mail skirt)
      * Belted Marchland heraldic surcoat (deep cobalt + invented cream/ochre chevron, NO real coats of arms)
      * Thick oiled leather belt, forged brass buckle, hip scabbard, turned leather boots & gloves
      * Curved triangular heater shield (invented Marchland heraldry, iron rim + rivets, oak plank back)
      * Oakeshott XII arming sword (fullered steel blade, crossguard, leather grip, wheel pommel)
  - Synthesizes photographic PBR atlas (1024^2 Albedo, 1024^2 OpenGL Normal, 512^2 ORM) composited from
    Poly Haven CC0 `rough_linen` and `oak_wood_planks` plus procedural interlocking chainmail, hammered steel,
    and oiled leather grain.
  - Real Blender Cycles CPU Ambient Occlusion baked to COLOR_0 (vertex colours)
  - Real 19-bone Armature + baked actions (`idle`, `walk`, `attack` at 30 fps) on LOD0
  - Exports 3 LODs (`lod0` <= 2500 tris, `lod1`, `lod2`) + coarse opaque `shadow` stand-in + preview JPG.

Run with:
  /tmp/blender-venv/bin/python games/new-game/tools/blender/build_unit.py
"""

import json
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

RAW_OUT = "/tmp/marchland-src/raw_glb"
TEX_DIR = "/tmp/marchland-src/unit_tex"
SURF_DIR = "/tmp/marchland-src/surfaces_png"
PREVIEW_JPG = "/tmp/marchland-src/raw_glb/swordsman_preview.jpg"

# Atlas UV regions (normalized [u0, v0, u1, v1] where v=0 is bottom in Blender UV, v=1 is top)
# Image space y=0 is top -> PIL y = (1 - v) * H
UV_REGIONS = {
    "surcoat": (0.00, 0.50, 0.50, 1.00),   # Top-left: cobalt linen surcoat with invented cream/gold chevron
    "mail": (0.50, 0.50, 1.00, 1.00),      # Top-right: interlocking steel chainmail rings
    "steel": (0.00, 0.25, 0.50, 0.50),     # Mid-left: hammered forged steel + helmet rivets + sword blade
    "shield": (0.50, 0.00, 1.00, 0.50),    # Bottom-right: Marchland heater shield front (left half) & oak back (right half)
    "leather": (0.00, 0.00, 0.25, 0.25),   # Bottom-left: oiled dark brown leather + brass buckle accent
    "skin": (0.25, 0.00, 0.50, 0.25),      # Bottom-mid-left: weathered medieval face + eyes/brow/stubble
}


def height_to_normal(height_2d: np.ndarray, strength: float = 2.4) -> np.ndarray:
    """Converts [0..1] float heightfield to OpenGL tangent-space normal map (uint8 RGB, +Y up)."""
    gy, gx = np.gradient(height_2d)
    nx = -gx * strength
    ny = gy * strength  # OpenGL +Y points up (decreasing PIL row index)
    nz = np.ones_like(height_2d)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    rgb = np.stack([(nx * inv) * 0.5 + 0.5, (ny * inv) * 0.5 + 0.5, (nz * inv) * 0.5 + 0.5], axis=-1)
    return np.clip(rgb * 255.0, 0, 255).astype(np.uint8)


def generate_swordsman_textures():
    """Creates 1024x1024 albedo, 1024x1024 OpenGL normal, and 512x512 ORM (R=AO, G=Rough, B=Metal)."""
    os.makedirs(TEX_DIR, exist_ok=True)
    S = 1024
    rng = np.random.default_rng(1337)

    # Load real Poly Haven CC0 scans for fabric & wood
    linen_alb = np.asarray(Image.open(f"{SURF_DIR}/linen_albedo.png").convert("RGB").resize((512, 512)), dtype=np.float32) / 255.0
    linen_nor = np.asarray(Image.open(f"{SURF_DIR}/linen_normal.png").convert("RGB").resize((512, 512)), dtype=np.float32) / 255.0
    linen_orm = np.asarray(Image.open(f"{SURF_DIR}/linen_orm.png").convert("RGB").resize((512, 512)), dtype=np.float32) / 255.0

    oak_alb = np.asarray(Image.open(f"{SURF_DIR}/boards_albedo.png").convert("RGB").resize((256, 512)), dtype=np.float32) / 255.0
    oak_nor = np.asarray(Image.open(f"{SURF_DIR}/boards_normal.png").convert("RGB").resize((256, 512)), dtype=np.float32) / 255.0
    oak_orm = np.asarray(Image.open(f"{SURF_DIR}/boards_orm.png").convert("RGB").resize((256, 512)), dtype=np.float32) / 255.0

    alb = np.zeros((S, S, 3), dtype=np.float32)
    nor = np.zeros((S, S, 3), dtype=np.float32)
    nor[:, :, 0] = 0.5
    nor[:, :, 1] = 0.5
    nor[:, :, 2] = 1.0
    orm = np.zeros((S, S, 3), dtype=np.float32)
    orm[:, :, 0] = 1.0  # AO
    orm[:, :, 1] = 0.85  # Roughness
    orm[:, :, 2] = 0.0  # Metalness

    # ---- 1. SURCOAT (PIL y: 0..512, x: 0..512) -> UV u: 0..0.5, v: 0.5..1.0 ----
    # Real rough_linen weave dyed rich Marchland medieval cobalt wool/linen + invented warm cream/gold chevron
    yy, xx = np.mgrid[0:512, 0:512].astype(np.float32) / 512.0
    # Subtle woven variation from Poly Haven linen luminance
    linen_lum = 0.299 * linen_alb[:, :, 0] + 0.587 * linen_alb[:, :, 1] + 0.114 * linen_alb[:, :, 2]
    linen_mod = np.clip(0.76 + (linen_lum - np.mean(linen_lum)) * 1.45, 0.58, 1.15)[:, :, None]

    cobalt = np.array([0.13, 0.24, 0.44], dtype=np.float32)  # saturated yet historically dyed woad blue
    ochre = np.array([0.82, 0.71, 0.45], dtype=np.float32)   # invented Marchland warm wheat/cream chevron
    dark_trim = np.array([0.09, 0.14, 0.25], dtype=np.float32)

    # Front chest chevron & hem border (u=0.5 is center front of cylindrical wrap)
    dx_c = np.abs(xx - 0.50)
    # Inverted V chevron across upper chest (PIL y: 0.16..0.44)
    chev_y = 0.22 + dx_c * 0.72
    in_chev = (np.abs(yy - chev_y) < 0.048) & (dx_c < 0.34)
    in_chev_edge = (np.abs(yy - chev_y) >= 0.048) & (np.abs(yy - chev_y) < 0.060) & (dx_c < 0.35)
    # Lower decorative hem stripe (PIL y: 0.86..0.91)
    in_hem = (yy > 0.86) & (yy < 0.91)
    # Subtle muddy dust gradient right near bottom skirt edge (PIL y > 0.82)
    mud_t = np.clip((yy - 0.80) / 0.20, 0.0, 1.0)[:, :, None]
    mud_col = np.array([0.24, 0.20, 0.15], dtype=np.float32)

    surcoat_col = np.broadcast_to(cobalt, (512, 512, 3)).copy()
    surcoat_col[in_chev] = ochre
    surcoat_col[in_chev_edge] = dark_trim
    surcoat_col[in_hem] = ochre * 0.88
    # Cloth drape folds vertical shading
    folds = 0.91 + 0.09 * np.sin(xx * math.tau * 9.0 + np.sin(yy * 7.0) * 0.6)
    surcoat_col = surcoat_col * linen_mod * folds[:, :, None]
    surcoat_col = surcoat_col * (1.0 - mud_t * 0.36) + mud_col * (mud_t * 0.36)

    alb[0:512, 0:512] = np.clip(surcoat_col, 0.03, 0.88)
    nor[0:512, 0:512] = linen_nor
    orm[0:512, 0:512, 0] = np.clip(linen_orm[:, :, 0] * folds, 0.55, 1.0)
    orm[0:512, 0:512, 1] = np.clip(0.84 + (linen_orm[:, :, 1] - 0.8) * 0.3, 0.78, 0.96)
    orm[0:512, 0:512, 2] = 0.0

    # ---- 2. CHAINMAIL (PIL y: 0..512, x: 512..1024) -> UV u: 0.5..1.0, v: 0.5..1.0 ----
    # High-frequency alternating European 4-in-1 riveted iron ring pattern
    my, mx = np.mgrid[0:512, 0:512].astype(np.float32)
    # Alternating tilted ring rows
    ring_px = 14.0
    row_id = np.floor(my / (ring_px * 0.55))
    shift = (row_id % 2) * (ring_px * 0.5)
    rx = ((mx + shift) % ring_px) / ring_px - 0.5
    ry = ((my % (ring_px * 0.55)) / (ring_px * 0.55)) - 0.5
    tilt = np.where((row_id % 2) < 0.5, 0.32, -0.32)
    u_r = rx + ry * tilt
    v_r = ry * 0.78
    dist = np.sqrt(u_r * u_r + v_r * v_r)
    # Ring torus cross-section centered at radius 0.34, tube half-width 0.14
    ring_h = np.clip(1.0 - ((dist - 0.34) / 0.145) ** 2, 0.0, 1.0)
    # Second offset layer of interlocking vertical rings
    rx2 = ((mx + ring_px * 0.5) % ring_px) / ring_px - 0.5
    ry2 = (((my + ring_px * 0.275) % (ring_px * 0.55)) / (ring_px * 0.55)) - 0.5
    dist2 = np.sqrt(rx2 * rx2 + (ry2 * 0.82) ** 2)
    ring_h2 = np.clip(1.0 - ((dist2 - 0.34) / 0.14) ** 2, 0.0, 1.0) * 0.82
    mail_h = np.maximum(ring_h, ring_h2)
    # Add subtle oil/patina variation across rings
    patina = rng.normal(0.0, 0.035, (512, 512)).astype(np.float32)
    patina = np.asarray(Image.fromarray(np.clip((patina + 0.5) * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)), dtype=np.float32) / 255.0 - 0.5

    # Iron F0 (~0.56..0.64 on ring crests, dark shadowed iron 0.14 in gaps)
    mail_val = 0.16 + 0.46 * (mail_h ** 0.7) + patina * 0.4
    alb[0:512, 512:1024, 0] = np.clip(mail_val * 0.96, 0.06, 0.72)
    alb[0:512, 512:1024, 1] = np.clip(mail_val * 0.98, 0.06, 0.74)
    alb[0:512, 512:1024, 2] = np.clip(mail_val * 1.02, 0.07, 0.78)
    nor[0:512, 512:1024] = height_to_normal(mail_h, strength=4.2).astype(np.float32) / 255.0
    orm[0:512, 512:1024, 0] = np.clip(0.32 + 0.68 * mail_h, 0.25, 1.0)
    orm[0:512, 512:1024, 1] = np.clip(0.56 - 0.22 * mail_h + patina * 0.3, 0.28, 0.68)
    orm[0:512, 512:1024, 2] = np.clip(0.35 + 0.58 * (mail_h > 0.15).astype(np.float32), 0.35, 0.94)

    # ---- 3. HAMMERED STEEL & HELM RIVETS (PIL y: 512..768, x: 0..512) -> UV u: 0..0.5, v: 0.25..0.50 ----
    sy, sx = np.mgrid[0:256, 0:512].astype(np.float32)
    # Brushed anvil marks + subtle hammer dimples
    dimples = (
        np.sin(sx * 0.16 + np.cos(sy * 0.14) * 1.8) * np.cos(sy * 0.19 - sx * 0.09) * 0.08
        + np.sin(sx * 0.55) * 0.025
    )
    # Fine horizontal brush scratches
    brush = rng.normal(0.0, 0.025, (256, 512)).astype(np.float32)
    brush = np.asarray(Image.fromarray(np.clip((brush + 0.5) * 255, 0, 255).astype(np.uint8)).resize((128, 256)).resize((512, 256)), dtype=np.float32) / 255.0 - 0.5
    steel_h = 0.5 + dimples + brush * 0.8

    # Rivet band along bottom border (y=210..246) & vertical reinforcement strip (y=10..42)
    rivet_h = np.zeros_like(steel_h)
    for ry_c in (28.0, 228.0):
        for rx_c in np.linspace(16.0, 496.0, 16):
            d2 = ((sx - rx_c) ** 2 + (sy - ry_c) ** 2) / (7.5 ** 2)
            rivet_h = np.maximum(rivet_h, np.clip(1.0 - d2, 0.0, 1.0) * 0.85)
    steel_h_full = steel_h + rivet_h

    # Iron/steel linear F0 ~0.58..0.68 -> in sRGB ~0.78..0.85, keep slightly worn forged iron sRGB ~0.64..0.78
    base_st = 0.68 + dimples * 0.35 + brush * 0.4 + rivet_h * 0.08
    alb[512:768, 0:512, 0] = np.clip(base_st * 0.97, 0.42, 0.86)
    alb[512:768, 0:512, 1] = np.clip(base_st * 0.98, 0.43, 0.87)
    alb[512:768, 0:512, 2] = np.clip(base_st * 1.02, 0.45, 0.90)
    nor[512:768, 0:512] = height_to_normal(steel_h_full, strength=3.0).astype(np.float32) / 255.0
    orm[512:768, 0:512, 0] = np.clip(0.95 - rivet_h * 0.18, 0.72, 1.0)
    orm[512:768, 0:512, 1] = np.clip(0.32 - dimples * 0.25 + brush * 0.4, 0.22, 0.46)
    orm[512:768, 0:512, 2] = 0.92

    # ---- 4. HEATER SHIELD FRONT + OAK BACK (PIL y: 512..1024, x: 512..1024) -> UV u: 0.5..1.0, v: 0.0..0.5 ----
    # Left half (x: 512..768): Painted Marchland heraldry on linen-gessoed wood with iron rim & subtle scratches
    sh_img = Image.new("RGB", (256, 512), (34, 62, 114))
    draw = ImageDraw.Draw(sh_img)
    # Warm cream/gold border inside iron rim
    draw.rectangle([14, 14, 241, 497], outline=(206, 178, 112), width=10)
    # Invented Marchland twin chevrons + center lozenge (strictly fictional, zero real coats of arms)
    draw.polygon([(22, 275), (128, 145), (234, 275), (234, 330), (128, 200), (22, 330)], fill=(214, 185, 118))
    draw.polygon([(46, 372), (128, 272), (210, 372), (210, 412), (128, 312), (46, 412)], fill=(214, 185, 118))
    draw.polygon([(128, 52), (160, 96), (128, 140), (96, 96)], fill=(214, 185, 118))
    # Dark hammered iron rim around outer edge (width 12 px)
    draw.rectangle([0, 0, 255, 511], outline=(112, 115, 122), width=12)
    # Rivet dots around iron rim
    for rx in range(20, 240, 28):
        draw.ellipse([rx - 3, 3, rx + 3, 9], fill=(158, 162, 170))
    for ry in range(28, 490, 36):
        draw.ellipse([3, ry - 3, 9, ry + 3], fill=(158, 162, 170))
        draw.ellipse([246, ry - 3, 252, ry + 3], fill=(158, 162, 170))
    # Subtle diagonal combat nicks revealing raw wood beneath paint
    for x0, y0, x1, y1 in [(56, 188, 118, 212), (154, 112, 198, 140), (74, 345, 138, 362)]:
        draw.line([(x0, y0), (x1, y1)], fill=(125, 102, 74), width=2)

    sh_front = np.asarray(sh_img, dtype=np.float32) / 255.0
    # Modulate painted wood subtly with linen gesso grain
    sh_front *= np.clip(0.86 + (linen_lum[:, :256] - 0.5) * 0.45, 0.72, 1.08)[:, :, None]
    is_rim = np.zeros((512, 256), dtype=np.float32)
    is_rim[:12, :] = 1.0
    is_rim[-12:, :] = 1.0
    is_rim[:, :12] = 1.0
    is_rim[:, -12:] = 1.0

    alb[512:1024, 512:768] = np.clip(sh_front, 0.04, 0.88)
    nor[512:1024, 512:768] = linen_nor[:, :256] * 0.7 + oak_nor * 0.3
    orm[512:1024, 512:768, 0] = 0.94
    orm[512:1024, 512:768, 1] = 0.62 * (1.0 - is_rim) + 0.36 * is_rim
    orm[512:1024, 512:768, 2] = 0.88 * is_rim

    # Right half (x: 768..1024): Shield back — authentic Poly Haven oak planks + dark leather grip straps
    sh_back = oak_alb * 0.78
    # Horizontal leather grip straps across back
    sh_back[180:220, :] = np.array([0.22, 0.14, 0.09], dtype=np.float32)
    sh_back[310:345, :] = np.array([0.22, 0.14, 0.09], dtype=np.float32)
    alb[512:1024, 768:1024] = np.clip(sh_back, 0.04, 0.75)
    nor[512:1024, 768:1024] = oak_nor
    orm[512:1024, 768:1024] = oak_orm

    # ---- 5. OILED LEATHER & BRASS ACCENTS (PIL y: 768..1024, x: 0..256) -> UV u: 0..0.25, v: 0..0.25 ----
    ly, lx = np.mgrid[0:256, 0:256].astype(np.float32)
    grain = np.sin(lx * 0.45 + np.sin(ly * 0.35) * 2.0) * np.cos(ly * 0.52) * 0.06 + rng.normal(0.0, 0.03, (256, 256))
    l_col = np.zeros((256, 256, 3), dtype=np.float32)
    l_col[:, :, 0] = 0.25 + grain
    l_col[:, :, 1] = 0.16 + grain * 0.7
    l_col[:, :, 2] = 0.10 + grain * 0.4
    # Top strip (y < 42) is warm aged brass/bronze for belt buckle & scabbard chape
    brass_mask = (ly < 42).astype(np.float32)
    l_col[ly < 42] = np.array([0.74, 0.58, 0.28], dtype=np.float32)
    alb[768:1024, 0:256] = np.clip(l_col, 0.04, 0.85)
    nor[768:1024, 0:256] = height_to_normal(grain * 2.0 + 0.5, strength=2.6).astype(np.float32) / 255.0
    orm[768:1024, 0:256, 0] = 0.95
    orm[768:1024, 0:256, 1] = 0.64 * (1.0 - brass_mask) + 0.30 * brass_mask
    orm[768:1024, 0:256, 2] = 0.90 * brass_mask

    # ---- 6. WEATHERED MEDIEVAL FACE / SKIN (PIL y: 768..1024, x: 256..512) -> UV u: 0.25..0.50, v: 0..0.25 ----
    # Note: Cylindrical 360-deg wrap puts the front +-45 deg face arc cleanly at x = 96..160 (center 128).
    # Blender v=0 (chin) -> PIL bottom (y=255), Blender v=1 (forehead) -> PIL top (y=0).
    face = Image.new("RGB", (256, 256), (196, 150, 122))
    fdraw = ImageDraw.Draw(face)
    # Subtle warm sunlit cheekbones & nose ridge
    fdraw.ellipse([96, 88, 160, 174], fill=(208, 162, 134))
    fdraw.ellipse([94, 118, 118, 152], fill=(192, 138, 112))
    fdraw.ellipse([138, 118, 162, 152], fill=(192, 138, 112))
    # Subtle eye-socket shading (gives strong natural brow depth)
    fdraw.ellipse([104, 96, 124, 122], fill=(166, 122, 98))
    fdraw.ellipse([132, 96, 152, 122], fill=(166, 122, 98))
    # Trimmed dark brown medieval beard & moustache along lower jaw/chin
    fdraw.rectangle([24, 194, 232, 255], fill=(78, 54, 38))
    fdraw.ellipse([92, 176, 164, 224], fill=(86, 60, 44))
    # Moustache curving cleanly around mouth
    fdraw.polygon([(108, 174), (128, 162), (148, 174), (144, 180), (128, 171), (112, 180)], fill=(76, 52, 36))
    # Nose bridge & nostrils
    fdraw.line([(128, 102), (128, 152)], fill=(220, 176, 148), width=5)
    fdraw.line([(122, 154), (134, 154)], fill=(150, 108, 84), width=4)
    # Focused natural brows & realistically spaced eyes inside front face arc (x=106..121 and 135..150)
    fdraw.line([(104, 94), (123, 98)], fill=(62, 42, 30), width=4)
    fdraw.line([(133, 98), (152, 94)], fill=(62, 42, 30), width=4)
    fdraw.ellipse([107, 104, 121, 115], fill=(222, 214, 206))
    fdraw.ellipse([135, 104, 149, 115], fill=(222, 214, 206))
    fdraw.ellipse([111, 105, 118, 114], fill=(42, 48, 58))
    fdraw.ellipse([138, 105, 145, 114], fill=(42, 48, 58))
    # Subtle lower lip visible between moustache & beard
    fdraw.line([(118, 178), (138, 178)], fill=(154, 102, 86), width=4)
    face = face.filter(ImageFilter.GaussianBlur(0.8))
    face_arr = np.asarray(face, dtype=np.float32) / 255.0
    skin_noise = rng.normal(0.0, 0.012, (256, 256, 1)).astype(np.float32)
    alb[768:1024, 256:512] = np.clip(face_arr + skin_noise, 0.05, 0.88)
    orm[768:1024, 256:512, 0] = 0.96
    orm[768:1024, 256:512, 1] = 0.64
    orm[768:1024, 256:512, 2] = 0.0

    alb_path = f"{TEX_DIR}/swordsman_albedo.png"
    nor_path = f"{TEX_DIR}/swordsman_normal.png"
    orm_path = f"{TEX_DIR}/swordsman_orm.png"

    Image.fromarray(np.clip(alb * 255.0, 0, 255).astype(np.uint8)).save(alb_path)
    Image.fromarray(np.clip(nor * 255.0, 0, 255).astype(np.uint8)).save(nor_path)
    Image.fromarray(np.clip(orm * 255.0, 0, 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS).save(orm_path)
    return alb_path, nor_path, orm_path


class UnitMeshBuilder:
    """Builds smooth anatomical + armoured parts with explicit atlas UV regions and bone weight tags."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv_layer = self.bm.loops.layers.uv.new("UVMap")
        self.deform_layer = self.bm.verts.layers.deform.new()
        self.bone_names = []
        self.bone_index = {}

    def bone_id(self, name: str) -> int:
        if name not in self.bone_index:
            self.bone_index[name] = len(self.bone_names)
            self.bone_names.append(name)
        return self.bone_index[name]

    def _map_uv(self, region: str, u: float, v: float, sub_u=(0.0, 1.0), sub_v=(0.0, 1.0)):
        u0, v0, u1, v1 = UV_REGIONS[region]
        # Inset 0.5% to guarantee zero atlas bleed across region boundaries
        pad = 0.005
        ru0 = u0 + pad + (u1 - u0 - 2 * pad) * sub_u[0]
        ru1 = u0 + pad + (u1 - u0 - 2 * pad) * sub_u[1]
        rv0 = v0 + pad + (v1 - v0 - 2 * pad) * sub_v[0]
        rv1 = v0 + pad + (v1 - v0 - 2 * pad) * sub_v[1]
        return (ru0 + (ru1 - ru0) * max(0.0, min(1.0, u)), rv0 + (rv1 - rv0) * max(0.0, min(1.0, v)))

    def add_loft(
        self,
        rings_pts,
        region: str,
        bone_weights,
        closed_caps=(True, True),
        smooth=True,
        sub_u=(0.0, 1.0),
        sub_v=(0.0, 1.0),
    ):
        """
        Lofts a sequence of N rings (each having M 3D points) into a smooth tubular/anatomical mesh.
        bone_weights: list of dicts {bone_name: weight} of length len(rings_pts) (or single dict for all).
        """
        n_rings = len(rings_pts)
        m_segs = len(rings_pts[0])
        bm_rings = []
        for r_idx, pts in enumerate(rings_pts):
            bw = bone_weights[r_idx] if isinstance(bone_weights, list) else bone_weights
            ring_verts = []
            for p in pts:
                v = self.bm.verts.new(p)
                for bname, w in bw.items():
                    v[self.deform_layer][self.bone_id(bname)] = w
                ring_verts.append(v)
            bm_rings.append(ring_verts)

        faces = []
        for r in range(n_rings - 1):
            v_lo = r / max(1, n_rings - 1)
            v_hi = (r + 1) / max(1, n_rings - 1)
            r0, r1 = bm_rings[r], bm_rings[r + 1]
            for s in range(m_segs):
                sn = (s + 1) % m_segs
                u_lo = s / m_segs
                u_hi = (s + 1) / m_segs
                f = self.bm.faces.new([r0[s], r0[sn], r1[sn], r1[s]])
                f.smooth = smooth
                uvs = [
                    self._map_uv(region, u_lo, v_lo, sub_u, sub_v),
                    self._map_uv(region, u_hi, v_lo, sub_u, sub_v),
                    self._map_uv(region, u_hi, v_hi, sub_u, sub_v),
                    self._map_uv(region, u_lo, v_hi, sub_u, sub_v),
                ]
                for loop, uv_val in zip(f.loops, uvs):
                    loop[self.uv_layer].uv = uv_val
                faces.append(f)

        if closed_caps[0]:
            f = self.bm.faces.new(list(reversed(bm_rings[0])))
            f.smooth = False
            for idx, loop in enumerate(f.loops):
                ang = (idx / m_segs) * math.tau
                loop[self.uv_layer].uv = self._map_uv(region, 0.5 + 0.4 * math.cos(ang), 0.5 + 0.4 * math.sin(ang), sub_u, sub_v)
            faces.append(f)
        if closed_caps[1]:
            f = self.bm.faces.new(bm_rings[-1])
            f.smooth = False
            for idx, loop in enumerate(f.loops):
                ang = (idx / m_segs) * math.tau
                loop[self.uv_layer].uv = self._map_uv(region, 0.5 + 0.4 * math.cos(ang), 0.5 + 0.4 * math.sin(ang), sub_u, sub_v)
            faces.append(f)
        return faces

    def add_limb(self, p0, p1, r0, r1, segs, region, bone_a, bone_b=None, rings=4, smooth=True, sub_u=(0.0, 1.0), sub_v=(0.0, 1.0), oval=(1.0, 1.0)):
        v0, v1 = Vector(p0), Vector(p1)
        axis = (v1 - v0).normalized()
        up = Vector((0.0, -1.0, 0.0)) if abs(axis.y) < 0.9 else Vector((1.0, 0.0, 0.0))
        side_x = axis.cross(up).normalized()
        side_y = side_x.cross(axis).normalized()

        ring_pts = []
        weights = []
        for i in range(rings + 1):
            t = i / rings
            c = v0.lerp(v1, t)
            # Subtle organic muscle swell at mid-limb
            bulge = 1.0 + 0.07 * math.sin(math.pi * t)
            r = (r0 * (1.0 - t) + r1 * t) * bulge
            pts = []
            for s in range(segs):
                ang = (s / segs) * math.tau
                pt = c + side_x * (math.cos(ang) * r * oval[0]) + side_y * (math.sin(ang) * r * oval[1])
                pts.append(pt)
            ring_pts.append(pts)
            if bone_b and bone_b != bone_a:
                weights.append({bone_a: 1.0 - t, bone_b: t})
            else:
                weights.append({bone_a: 1.0})
        return self.add_loft(ring_pts, region, weights, closed_caps=(True, True), smooth=smooth, sub_u=sub_u, sub_v=sub_v)

    def add_box_part(self, center, size, rot_euler, region, bone_name, sub_u=(0.0, 1.0), sub_v=(0.0, 1.0), bevel=0.0):
        prev = set(self.bm.faces)
        ret = bmesh.ops.create_cube(self.bm, size=1.0)
        sx, sy, sz = size
        for v in ret["verts"]:
            v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
        if bevel > 0.0:
            edges = list({e for v in ret["verts"] for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect="EDGES", clamp_overlap=True)
        new_faces = [f for f in self.bm.faces if f not in prev]
        all_verts = list({v for f in new_faces for v in f.verts})
        xform = Matrix.Translation(Vector(center)) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
        bid = self.bone_id(bone_name)
        for v in all_verts:
            v.co = xform @ v.co
            v[self.deform_layer][bid] = 1.0
        for f in new_faces:
            f.smooth = False
            for idx, loop in enumerate(f.loops):
                u = 0.0 if idx in (0, 3) else 1.0
                v_c = 0.0 if idx in (0, 1) else 1.0
                loop[self.uv_layer].uv = self._map_uv(region, u, v_c, sub_u, sub_v)
        return new_faces

    def add_heater_shield(self, hand_pos, rot_euler, bone_name, segs_x=8, segs_y=8):
        """
        Authentic XIII-XIV c. curved triangular heater shield (0.52 m wide x 0.72 m tall, 2.8 cm thick).
        Front face maps cleanly to UV_REGIONS['shield'] left half (heraldry), back maps to oak planks.
        """
        W = 0.52
        H = 0.74
        T = 0.026
        curve_r = 0.55  # cylindrical wrap around forearm

        def shield_half_width(ty):
            # ty = 0 (bottom point) .. 1 (flat slightly arched top)
            if ty >= 0.62:
                return 0.5 * W
            # Smooth medieval heater curve tapering to pointed base
            s = ty / 0.62
            return 0.5 * W * (0.04 + 0.96 * (s ** 0.56))

        xform = Matrix.Translation(Vector(hand_pos)) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
        bid = self.bone_id(bone_name)

        front_grid = []
        back_grid = []
        for iy in range(segs_y + 1):
            ty = iy / segs_y
            hw = shield_half_width(ty)
            z_local = (ty - 0.54) * H
            # Slight top arch
            z_arch = 0.018 * math.sin(ty * math.pi)
            f_row = []
            b_row = []
            for ix in range(segs_x + 1):
                tx = ix / segs_x
                lx = (tx - 0.5) * 2.0 * hw
                # Cylindrical bend backward (+Y is toward body, -Y is outward front)
                ang = lx / curve_r
                cx = math.sin(ang) * curve_r
                cy = (1.0 - math.cos(ang)) * curve_r
                pf = xform @ Vector((cx, cy - T * 0.5, z_local + z_arch))
                pb = xform @ Vector((cx, cy + T * 0.5, z_local + z_arch))
                vf = self.bm.verts.new(pf)
                vb = self.bm.verts.new(pb)
                vf[self.deform_layer][bid] = 1.0
                vb[self.deform_layer][bid] = 1.0
                f_row.append((vf, tx, ty))
                b_row.append((vb, tx, ty))
            front_grid.append(f_row)
            back_grid.append(b_row)

        # Front heraldic faces (facing -Y outward -> CCW looking from -Y)
        for iy in range(segs_y):
            for ix in range(segs_x):
                v00, u00, t00 = front_grid[iy][ix]
                v10, u10, t10 = front_grid[iy][ix + 1]
                v11, u11, t11 = front_grid[iy + 1][ix + 1]
                v01, u01, t01 = front_grid[iy + 1][ix]
                f = self.bm.faces.new([v00, v10, v11, v01])
                f.smooth = True
                for lp, uu, vv in zip(f.loops, [u00, u10, u11, u01], [t00, t10, t11, t01]):
                    lp[self.uv_layer].uv = self._map_uv("shield", uu, vv, sub_u=(0.0, 0.49), sub_v=(0.0, 1.0))

        # Back oak plank faces (facing +Y inward)
        for iy in range(segs_y):
            for ix in range(segs_x):
                v00, u00, t00 = back_grid[iy][ix]
                v10, u10, t10 = back_grid[iy][ix + 1]
                v11, u11, t11 = back_grid[iy + 1][ix + 1]
                v01, u01, t01 = back_grid[iy + 1][ix]
                f = self.bm.faces.new([v00, v01, v11, v10])
                f.smooth = True
                for lp, uu, vv in zip(f.loops, [u00, u01, u11, u10], [t00, t01, t11, t10]):
                    lp[self.uv_layer].uv = self._map_uv("shield", uu, vv, sub_u=(0.51, 1.0), sub_v=(0.0, 1.0))

        # Stitched iron rim edge around perimeter
        perim_f = (
            [front_grid[0][ix][0] for ix in range(segs_x)]
            + [front_grid[iy][segs_x][0] for iy in range(segs_y)]
            + [front_grid[segs_y][ix][0] for ix in range(segs_x, 0, -1)]
            + [front_grid[iy][0][0] for iy in range(segs_y, 0, -1)]
        )
        perim_b = (
            [back_grid[0][ix][0] for ix in range(segs_x)]
            + [back_grid[iy][segs_x][0] for iy in range(segs_y)]
            + [back_grid[segs_y][ix][0] for ix in range(segs_x, 0, -1)]
            + [back_grid[iy][0][0] for iy in range(segs_y, 0, -1)]
        )
        n_p = len(perim_f)
        for i in range(n_p):
            j = (i + 1) % n_p
            f = self.bm.faces.new([perim_f[i], perim_b[i], perim_b[j], perim_f[j]])
            f.smooth = False
            for lp in f.loops:
                lp[self.uv_layer].uv = self._map_uv("steel", 0.5, 0.5)

    def add_arming_sword(self, grip_pos, rot_euler, bone_name):
        """Authentic XIII-XIV c. Oakeshott Type XII arming sword (1.02 m total, diamond-section fullered blade)."""
        xform = Matrix.Translation(Vector(grip_pos)) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
        bid = self.bone_id(bone_name)

        def xf(pt):
            return xform @ Vector(pt)

        # Corded leather grip (z = -0.07..+0.07)
        self.add_limb(xf((0, 0, -0.075)), xf((0, 0, 0.075)), 0.017, 0.019, 8, "leather", bone_name, rings=2, oval=(0.82, 1.15), sub_v=(0.0, 0.72))

        # Bevelled steel wheel pommel (z = -0.105)
        pom_rings = []
        for iz, (z_l, rx, ry) in enumerate([(-0.132, 0.012, 0.008), (-0.118, 0.030, 0.018), (-0.102, 0.032, 0.020), (-0.084, 0.026, 0.016), (-0.075, 0.015, 0.012)]):
            ring = []
            for s in range(8):
                ang = (s / 8.0) * math.tau
                ring.append(xf((math.cos(ang) * rx, math.sin(ang) * ry, z_l)))
            pom_rings.append(ring)
        self.add_loft(pom_rings, "steel", {bone_name: 1.0}, smooth=True)

        # Straight tapered steel crossguard (width 0.19 m along X at z = 0.082)
        cg_rings = []
        for x_l, ry, rz in [(-0.095, 0.010, 0.010), (-0.045, 0.012, 0.012), (0.0, 0.016, 0.015), (0.045, 0.012, 0.012), (0.095, 0.010, 0.010)]:
            pts = [
                xf((x_l, -ry, 0.082 - rz)),
                xf((x_l, ry, 0.082 - rz)),
                xf((x_l, ry, 0.082 + rz)),
                xf((x_l, -ry, 0.082 + rz)),
            ]
            cg_rings.append(pts)
        self.add_loft(cg_rings, "steel", {bone_name: 1.0}, smooth=False)

        # Tapered double-edged diamond/fuller steel blade (z = 0.090 -> 0.920)
        blade_rings = []
        for z_l, hw, th in [
            (0.092, 0.026, 0.0085),
            (0.320, 0.023, 0.0075),
            (0.580, 0.019, 0.0062),
            (0.790, 0.014, 0.0048),
            (0.885, 0.007, 0.0030),
            (0.925, 0.001, 0.0010),
        ]:
            # 6-point cross-section (sharp edges on +-X, fuller ridge on +-Y)
            pts = [
                xf((hw, 0.0, z_l)),
                xf((hw * 0.35, th, z_l)),
                xf((-hw * 0.35, th, z_l)),
                xf((-hw, 0.0, z_l)),
                xf((-hw * 0.35, -th, z_l)),
                xf((hw * 0.35, -th, z_l)),
            ]
            blade_rings.append(pts)
        self.add_loft(blade_rings, "steel", {bone_name: 1.0}, smooth=False, sub_v=(0.25, 0.78))


def build_swordsman_geometry(mb: UnitMeshBuilder, detail=True):
    """Sculpts the entire XIII-XIV c. foot swordsman in a grounded combat stance (height 1.80 m, Z=0 flat)."""
    seg = 12 if detail else 8
    limb_seg = 10 if detail else 6

    # Key joint landmarks (grounded combat stance: left foot forward -Y, right foot braced back +Y)
    l_hip = Vector((-0.105, -0.02, 0.92))
    l_knee = Vector((-0.125, -0.10, 0.50))
    l_ankle = Vector((-0.125, -0.08, 0.10))

    r_hip = Vector((0.105, 0.02, 0.92))
    r_knee = Vector((0.145, 0.07, 0.49))
    r_ankle = Vector((0.155, 0.14, 0.10))

    l_sh = Vector((-0.220, -0.03, 1.41))
    l_elb = Vector((-0.315, -0.16, 1.15))
    l_hand = Vector((-0.275, -0.34, 1.11))

    r_sh = Vector((0.220, 0.02, 1.41))
    r_elb = Vector((0.335, -0.05, 1.16))
    r_hand = Vector((0.375, -0.28, 1.09))

    # ---------------- 1. CONTOURED TURNED LEATHER BOOTS, KNEE CUPS & CHAUSES ----------------
    mb.add_limb(l_hip, l_knee, 0.095, 0.068, limb_seg, "mail", "thigh_l", "shin_l", rings=3, oval=(0.95, 1.05))
    mb.add_limb(r_hip, r_knee, 0.095, 0.068, limb_seg, "mail", "thigh_r", "shin_r", rings=3, oval=(0.95, 1.05))

    # Smooth domed leather knee guards (poleyns) — organic rounded cup instead of blocky cube!
    for knee, yaw_k, bname in [(l_knee, 0.05, "shin_l"), (r_knee, -0.22, "shin_r")]:
        fwd = Vector((-math.sin(yaw_k), -math.cos(yaw_k), 0.0))
        side = Vector((math.cos(yaw_k), -math.sin(yaw_k), 0.0))
        cup_rings = []
        for dz, rx, dy_out in [(-0.058, 0.036, 0.052), (-0.022, 0.052, 0.074), (0.022, 0.052, 0.074), (0.058, 0.034, 0.050)]:
            ring = []
            for s in range(8):
                ang = (s / 8.0) * math.tau
                pt = knee + Vector((0, 0, dz)) + side * (math.cos(ang) * rx) + fwd * (dy_out + math.sin(ang) * 0.018)
                ring.append(pt)
            cup_rings.append(ring)
        mb.add_loft(cup_rings, "leather", {bname: 1.0}, smooth=True, sub_v=(0.0, 0.72))

    # Anatomically contoured cuffed leather boots (folded cuff -> sculpted calf -> tapered ankle!)
    for knee, ankle, b_shin, b_foot in [(l_knee, l_ankle, "shin_l", "foot_l"), (r_knee, r_ankle, "shin_r", "foot_r")]:
        axis = (ankle - knee).normalized()
        side_x = axis.cross(Vector((0.0, -1.0, 0.0))).normalized()
        side_y = side_x.cross(axis).normalized()
        boot_shaft_rings = []
        boot_shaft_w = []
        for t, r_x, r_y in [
            (0.06, 0.074, 0.078),  # folded leather boot cuff top
            (0.16, 0.078, 0.082),  # cuff rim lip
            (0.22, 0.065, 0.068),  # tuck under cuff
            (0.42, 0.068, 0.076),  # anatomical calf curve
            (0.75, 0.052, 0.056),  # lower shin taper
            (1.00, 0.048, 0.052),  # ankle
        ]:
            c = knee.lerp(ankle, t)
            pts = [c + side_x * (math.cos((s / limb_seg) * math.tau) * r_x) + side_y * (math.sin((s / limb_seg) * math.tau) * r_y) for s in range(limb_seg)]
            boot_shaft_rings.append(pts)
            boot_shaft_w.append({b_shin: 1.0 - t * 0.5, b_foot: t * 0.5})
        mb.add_loft(boot_shaft_rings, "leather", boot_shaft_w, smooth=True, sub_v=(0.0, 0.72))

    # Grounded boot soles & toes planted flat at Z = 0.00
    for ankle, yaw, bname in [(l_ankle, 0.08, "foot_l"), (r_ankle, -0.32, "foot_r")]:
        fwd = Vector((-math.sin(yaw), -math.cos(yaw), 0.0))
        side = Vector((math.cos(yaw), -math.sin(yaw), 0.0))
        boot_rings = []
        for dist_f, hw, top_z in [(-0.06, 0.044, 0.10), (0.01, 0.050, 0.115), (0.10, 0.052, 0.075), (0.19, 0.036, 0.042), (0.22, 0.016, 0.018)]:
            c_xy = Vector((ankle.x, ankle.y, 0.0)) + fwd * dist_f
            pts = [
                c_xy - side * hw + Vector((0, 0, 0.0)),
                c_xy + side * hw + Vector((0, 0, 0.0)),
                c_xy + side * (hw * 0.85) + Vector((0, 0, top_z * 0.75)),
                c_xy + Vector((0, 0, top_z)),
                c_xy - side * (hw * 0.85) + Vector((0, 0, top_z * 0.75)),
            ]
            boot_rings.append(pts)
        mb.add_loft(boot_rings, "leather", {bname: 1.0}, smooth=True, sub_v=(0.0, 0.72))

    # ---------------- 2. CHAINMAIL HAUBERK SKIRT (VISIBLE BELOW SURCOAT) ----------------
    mail_skirt_rings = []
    mail_skirt_w = []
    for z_l, rx, ry, bw in [
        (0.64, 0.255, 0.195, {"hips": 0.4, "thigh_l": 0.3, "thigh_r": 0.3}),
        (0.76, 0.225, 0.175, {"hips": 0.7, "thigh_l": 0.15, "thigh_r": 0.15}),
        (0.90, 0.195, 0.150, {"hips": 1.0}),
    ]:
        ring = []
        for s in range(seg):
            ang = (s / seg) * math.tau - math.pi * 0.5
            fl = 1.0 + 0.03 * math.cos(ang * 4.0)
            ring.append(Vector((math.cos(ang) * rx * fl, math.sin(ang) * ry * fl, z_l)))
        mail_skirt_rings.append(ring)
        mail_skirt_w.append(bw)
    mb.add_loft(mail_skirt_rings, "mail", mail_skirt_w, closed_caps=(False, True), smooth=True)

    # ---------------- 3. BELTED HERALDIC SURCOAT (TORSO + DRAPED SKIRT) ----------------
    surcoat_profiles = [
        (0.72, 0.250, 0.195, -0.01, {"hips": 0.5, "thigh_l": 0.25, "thigh_r": 0.25}),
        (0.84, 0.220, 0.170, -0.01, {"hips": 0.85, "spine": 0.15}),
        (0.97, 0.178, 0.136, 0.00, {"hips": 0.35, "spine": 0.65}),
        (1.10, 0.205, 0.152, -0.01, {"spine": 0.6, "chest": 0.4}),
        (1.25, 0.232, 0.165, -0.015, {"chest": 1.0}),
        (1.38, 0.238, 0.150, -0.01, {"chest": 1.0}),
        (1.47, 0.155, 0.114, -0.01, {"chest": 0.7, "neck": 0.3}),
    ]
    sc_rings = []
    sc_w = []
    for z_l, rx, ry, y_off, bw in surcoat_profiles:
        ring = []
        for s in range(seg):
            ang = (s / seg) * math.tau + math.pi * 0.5
            fold = 1.0 + (0.04 if z_l < 0.94 else 0.012) * math.sin(ang * 5.0)
            ring.append(Vector((math.cos(ang) * rx * fold, math.sin(ang) * ry * fold + y_off, z_l)))
        sc_rings.append(ring)
        sc_w.append(bw)
    mb.add_loft(sc_rings, "surcoat", sc_w, closed_caps=(False, True), smooth=True)

    # ---------------- 4. LEATHER SWORD BELT, BRASS BUCKLE & HIP SCABBARD ----------------
    belt_rings = []
    for z_l, r_sc in [(0.945, 1.06), (0.975, 1.08), (1.005, 1.06)]:
        ring = []
        for s in range(seg):
            ang = (s / seg) * math.tau
            ring.append(Vector((math.cos(ang) * 0.184 * r_sc, math.sin(ang) * 0.144 * r_sc, z_l)))
        belt_rings.append(ring)
    mb.add_loft(belt_rings, "leather", {"hips": 0.5, "spine": 0.5}, smooth=True, sub_v=(0.0, 0.72))
    mb.add_box_part((0.0, -0.158, 0.975), (0.072, 0.024, 0.068), (0.0, 0.0, 0.0), "leather", "hips", sub_v=(0.86, 0.98), bevel=0.005 if detail else 0.0)
    mb.add_box_part((0.045, -0.165, 0.85), (0.042, 0.015, 0.20), (-0.12, 0.0, 0.08), "leather", "hips", sub_v=(0.0, 0.72))
    scab_top = Vector((-0.19, -0.02, 0.94))
    scab_tip = Vector((-0.24, 0.34, 0.34))
    mb.add_limb(scab_top, scab_tip, 0.028, 0.016, 6, "leather", "hips", rings=2, oval=(0.65, 1.25), sub_v=(0.0, 0.72))
    mb.add_limb(scab_tip.lerp(scab_top, 0.14), scab_tip, 0.018, 0.012, 6, "leather", "hips", rings=1, oval=(0.7, 1.25), sub_v=(0.86, 0.98))

    # ---------------- 5. SMOOTH ROUNDED ANATOMICAL MAIL SHOULDERS & ARMS ----------------
    for sx, sh, bname in [(-1.0, l_sh, "upper_arm_l"), (1.0, r_sh, "upper_arm_r")]:
        # Smooth organic deltoid dome curving into upper torso & arm (zero blocky flat cylinder tops!)
        cap_rings = []
        for dz, r_x, r_y, shift_x in [
            (-0.075, 0.072, 0.070, sx * 0.018),
            (-0.020, 0.088, 0.082, sx * 0.010),
            (0.032, 0.078, 0.074, -sx * 0.010),
            (0.066, 0.052, 0.050, -sx * 0.032),
            (0.082, 0.018, 0.018, -sx * 0.048),
        ]:
            ring = []
            for s in range(limb_seg):
                ang = (s / limb_seg) * math.tau
                ring.append(sh + Vector((math.cos(ang) * r_x + shift_x, math.sin(ang) * r_y, dz)))
            cap_rings.append(ring)
        mb.add_loft(cap_rings, "mail", {"chest": 0.45, bname: 0.55}, closed_caps=(False, True), smooth=True)

    mb.add_limb(l_sh, l_elb, 0.065, 0.055, limb_seg, "mail", "upper_arm_l", "forearm_l", rings=3)
    mb.add_limb(l_elb, l_hand, 0.053, 0.043, limb_seg, "mail", "forearm_l", "hand_l", rings=3)
    mb.add_limb(r_sh, r_elb, 0.065, 0.055, limb_seg, "mail", "upper_arm_r", "forearm_r", rings=3)
    mb.add_limb(r_elb, r_hand, 0.053, 0.043, limb_seg, "mail", "forearm_r", "hand_r", rings=3)

    # Smooth rounded chainmail elbow joints so bent arms bridge organically without a seam
    for elb_pos, b_up, b_lo in [(l_elb, "upper_arm_l", "forearm_l"), (r_elb, "upper_arm_r", "forearm_r")]:
        e_rings = []
        for dz, rad in [(-0.042, 0.036), (-0.015, 0.056), (0.015, 0.056), (0.042, 0.036)]:
            e_rings.append([elb_pos + Vector((math.cos((s / 8) * math.tau) * rad, math.sin((s / 8) * math.tau) * rad, dz)) for s in range(8)])
        mb.add_loft(e_rings, "mail", {b_up: 0.5, b_lo: 0.5}, closed_caps=(True, True), smooth=True)

    # Leather gauntlets clasping shield strap & sword hilt
    mb.add_box_part(l_hand, (0.072, 0.088, 0.070), (0.1, 0.2, 0.3), "leather", "hand_l", sub_v=(0.0, 0.72), bevel=0.018 if detail else 0.0)
    mb.add_box_part(r_hand, (0.072, 0.088, 0.070), (0.2, -0.1, -0.2), "leather", "hand_r", sub_v=(0.0, 0.72), bevel=0.018 if detail else 0.0)

    # ---------------- 6. MAIL COIF, SCULPTED HEAD/FACE & LIFTED RIVETED KETTLE HELM ----------------
    coif_rings = []
    for z_l, rx, ry in [(1.41, 0.165, 0.145), (1.48, 0.110, 0.104), (1.55, 0.088, 0.092), (1.62, 0.096, 0.104), (1.68, 0.094, 0.100)]:
        ring = []
        for s in range(seg):
            ang = (s / seg) * math.tau
            # Slight forward recess on face opening so face sits cleanly proud of the mail coif
            y_c = math.sin(ang) * ry + (0.014 if (z_l >= 1.54 and math.sin(ang) < -0.2) else -0.004)
            ring.append(Vector((math.cos(ang) * rx, y_c, z_l)))
        coif_rings.append(ring)
    mb.add_loft(coif_rings, "mail", {"neck": 0.45, "head": 0.55}, smooth=True)

    # Sculpted human head/face emerging cleanly from mail coif opening (u=0.5 faces -Y front!)
    face_rings = []
    for z_l, rx, ry, y_shift in [
        (1.535, 0.058, 0.076, -0.026),  # bearded chin
        (1.575, 0.075, 0.088, -0.032),  # mouth / jaw
        (1.618, 0.082, 0.094, -0.036),  # nose / cheekbones
        (1.656, 0.084, 0.092, -0.030),  # eyes / brow (clearly visible below kettle helm!)
        (1.696, 0.078, 0.086, -0.020),  # forehead (under helm rim)
    ]:
        ring = []
        for s in range(seg):
            ang = (s / seg) * math.tau + math.pi * 0.5
            nose_bump = 0.015 if (abs(z_l - 1.618) < 0.01 and abs(s - seg * 0.5) < 1.1) else 0.0
            ring.append(Vector((math.cos(ang) * rx, math.sin(ang) * ry + y_shift - nose_bump, z_l)))
        face_rings.append(ring)
    mb.add_loft(face_rings, "skin", {"head": 1.0}, smooth=True)

    # Riveted Steel Kettle Helm (`kapalin`) seated cleanly above brow (z = 1.695 -> 1.835 m)
    helm_c = Vector((0.0, -0.012, 1.698))
    helm_tilt = Matrix.Rotation(math.radians(-2.0), 4, "X")
    h_seg = 16 if detail else 10
    helm_profile = [
        (0.118, -0.012),
        (0.194, -0.036),
        (0.198, -0.024),
        (0.116, 0.012),
        (0.112, 0.052),
        (0.102, 0.096),
        (0.072, 0.130),
        (0.024, 0.146),
    ]
    helm_rings = []
    for rad, hz in helm_profile:
        ring = []
        for s in range(h_seg):
            ang = (s / h_seg) * math.tau
            local = Vector((math.cos(ang) * rad * 0.94, math.sin(ang) * rad * 1.08, hz))
            ring.append(helm_c + (helm_tilt @ local))
        helm_rings.append(ring)
    mb.add_loft(helm_rings, "steel", {"head": 1.0}, closed_caps=(False, True), smooth=True)

    if detail:
        comb_pts = []
        for t in np.linspace(-0.85, 0.85, 7):
            ang = t * math.pi * 0.48
            py = math.sin(ang) * 0.114 * 1.09
            pz = 0.024 + math.cos(ang) * 0.128
            ring = [
                helm_c + (helm_tilt @ Vector((-0.012, py, pz))),
                helm_c + (helm_tilt @ Vector((0.012, py, pz))),
                helm_c + (helm_tilt @ Vector((0.008, py, pz + 0.014))),
                helm_c + (helm_tilt @ Vector((-0.008, py, pz + 0.014))),
            ]
            comb_pts.append(ring)
        mb.add_loft(comb_pts, "steel", {"head": 1.0}, smooth=False, sub_v=(0.82, 0.96))

    # ---------------- 7. CURVED HEATER SHIELD (LEFT FOREARM — BALANCED SO CHEST CHEVRON SHOWS!) ----------------
    shield_pos = l_hand + Vector((-0.11, -0.06, -0.06))
    shield_rot = (math.radians(6.0), math.radians(-8.0), math.radians(-42.0))
    mb.add_heater_shield(shield_pos, shield_rot, "forearm_l", segs_x=8 if detail else 4, segs_y=8 if detail else 4)

    # ---------------- 8. XIII-XIV c. ARMING SWORD (HEROIC FORWARD-RIGHT DIAGONAL GUARD!) ----------------
    # Blade points boldly forward (-Y), slightly right (+X) and upward (+Z) so silhouette pops from every angle!
    sword_rot = (math.radians(52.0), math.radians(22.0), math.radians(16.0))
    mb.add_arming_sword(r_hand, sword_rot, "hand_r")


def build_armature_and_actions(mesh_obj, bone_names):
    """Creates a clean hierarchical humanoid armature and bakes looping `idle`, `walk`, `attack` actions."""
    arm_data = bpy.data.armatures.new("SwordsmanRig")
    arm_obj = bpy.data.objects.new("SwordsmanArmature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    # Bone specs: name -> (head, tail, parent)
    specs = {
        "hips": ((0.0, 0.0, 0.92), (0.0, 0.0, 1.02), None),
        "spine": ((0.0, 0.0, 1.02), (0.0, -0.01, 1.22), "hips"),
        "chest": ((0.0, -0.01, 1.22), (0.0, -0.01, 1.48), "spine"),
        "neck": ((0.0, -0.01, 1.48), (0.0, -0.015, 1.56), "chest"),
        "head": ((0.0, -0.015, 1.56), (0.0, -0.02, 1.78), "neck"),
        "upper_arm_l": ((-0.220, -0.03, 1.41), (-0.315, -0.16, 1.15), "chest"),
        "forearm_l": ((-0.315, -0.16, 1.15), (-0.275, -0.34, 1.11), "upper_arm_l"),
        "hand_l": ((-0.275, -0.34, 1.11), (-0.24, -0.42, 1.10), "forearm_l"),
        "upper_arm_r": ((0.220, 0.02, 1.41), (0.335, -0.05, 1.16), "chest"),
        "forearm_r": ((0.335, -0.05, 1.16), (0.375, -0.28, 1.09), "upper_arm_r"),
        "hand_r": ((0.375, -0.28, 1.09), (0.41, -0.37, 1.07), "forearm_r"),
        "thigh_l": ((-0.105, -0.02, 0.92), (-0.125, -0.10, 0.50), "hips"),
        "shin_l": ((-0.125, -0.10, 0.50), (-0.125, -0.08, 0.10), "thigh_l"),
        "foot_l": ((-0.125, -0.08, 0.10), (-0.13, -0.24, 0.02), "shin_l"),
        "thigh_r": ((0.105, 0.02, 0.92), (0.145, 0.07, 0.49), "hips"),
        "shin_r": ((0.145, 0.07, 0.49), (0.155, 0.14, 0.10), "thigh_r"),
        "foot_r": ((0.155, 0.14, 0.10), (0.20, -0.01, 0.02), "shin_r"),
    }
    eb = {}
    for bname, (h, t, parent) in specs.items():
        b = arm_data.edit_bones.new(bname)
        b.head = Vector(h)
        b.tail = Vector(t)
        if parent:
            b.parent = eb[parent]
        eb[bname] = b
    bpy.ops.object.mode_set(mode="OBJECT")

    # Create matching vertex groups on mesh_obj in exact bone_names order
    for bname in bone_names:
        mesh_obj.vertex_groups.new(name=bname)
    mesh_obj.parent = arm_obj
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj

    # Bake 3 named NLA actions: idle (60f), walk (30f), attack (36f) at 30 fps
    bpy.context.scene.render.fps = 30
    arm_obj.animation_data_create()

    def make_action(act_name, frames, pose_fn):
        act = bpy.data.actions.new(act_name)
        arm_obj.animation_data.action = act
        for pb in arm_obj.pose.bones:
            pb.rotation_mode = "XYZ"
            pb.location = (0.0, 0.0, 0.0)
            pb.rotation_euler = (0.0, 0.0, 0.0)
        for f in range(frames + 1):
            t = f / frames
            for pb in arm_obj.pose.bones:
                pb.location = (0.0, 0.0, 0.0)
                pb.rotation_euler = (0.0, 0.0, 0.0)
            pose_fn(arm_obj.pose.bones, t)
            for pb in arm_obj.pose.bones:
                pb.keyframe_insert(data_path="rotation_euler", frame=f)
                if pb.name == "hips":
                    pb.keyframe_insert(data_path="location", frame=f)
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = act_name
        track.strips.new(act_name, 0, act)
        arm_obj.animation_data.action = None

    def idle_pose(pb, t):
        br = math.sin(t * math.tau)
        pb["chest"].rotation_euler = (0.025 * br, 0.0, 0.02 * math.sin(t * math.tau * 0.5))
        pb["head"].rotation_euler = (-0.015 * br, 0.0, 0.05 * math.sin(t * math.tau))
        pb["upper_arm_r"].rotation_euler = (0.03 * br, 0.0, 0.0)
        pb["upper_arm_l"].rotation_euler = (-0.02 * br, 0.0, 0.0)

    def walk_pose(pb, t):
        s = math.sin(t * math.tau)
        c = math.cos(t * math.tau)
        pb["hips"].location = (0.0, 0.0, 0.022 * abs(c))
        pb["hips"].rotation_euler = (0.0, 0.0, 0.06 * s)
        pb["thigh_l"].rotation_euler = (0.42 * s, 0.0, 0.0)
        pb["shin_l"].rotation_euler = (max(0.0, -0.55 * c), 0.0, 0.0)
        pb["thigh_r"].rotation_euler = (-0.42 * s, 0.0, 0.0)
        pb["shin_r"].rotation_euler = (max(0.0, 0.55 * c), 0.0, 0.0)
        pb["upper_arm_r"].rotation_euler = (-0.28 * s, 0.0, 0.0)
        pb["upper_arm_l"].rotation_euler = (0.14 * s, 0.0, 0.0)
        pb["chest"].rotation_euler = (0.05, 0.0, -0.08 * s)

    def attack_pose(pb, t):
        # Windup 0..0.35 -> strike 0.35..0.55 -> recover 0.55..1.0
        if t < 0.35:
            k = math.sin((t / 0.35) * math.pi * 0.5)
            pb["chest"].rotation_euler = (-0.12 * k, 0.0, -0.35 * k)
            pb["upper_arm_r"].rotation_euler = (-1.15 * k, 0.0, -0.35 * k)
            pb["forearm_r"].rotation_euler = (-0.35 * k, 0.0, 0.0)
        elif t < 0.55:
            k = (t - 0.35) / 0.20
            pb["chest"].rotation_euler = (-0.12 + 0.34 * k, 0.0, -0.35 + 0.78 * k)
            pb["upper_arm_r"].rotation_euler = (-1.15 + 1.85 * k, 0.0, -0.35 + 0.55 * k)
            pb["forearm_r"].rotation_euler = (-0.35 + 0.35 * k, 0.0, 0.0)
        else:
            k = 1.0 - (t - 0.55) / 0.45
            pb["chest"].rotation_euler = (0.22 * k, 0.0, 0.43 * k)
            pb["upper_arm_r"].rotation_euler = (0.70 * k, 0.0, 0.20 * k)
        pb["upper_arm_l"].rotation_euler = (0.12 * math.sin(t * math.pi), 0.0, 0.15 * math.sin(t * math.pi))

    make_action("idle", 60, idle_pose)
    make_action("walk", 30, walk_pose)
    make_action("attack", 36, attack_pose)

    # Reset pose to crisp combat rest stance
    for pb in arm_obj.pose.bones:
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)
    return arm_obj


def bake_unit_ao(obj, samples=24):
    """Bakes Blender Cycles CPU Ambient Occlusion into COLOR_0 vertex colour."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2

    bpy.ops.mesh.primitive_plane_add(size=8.0, location=(0.0, 0.0, 0.0))
    ground = bpy.context.active_object
    mat = bpy.data.materials.new("UnitAoMat")
    mat.use_nodes = True
    ground.data.materials.append(mat)
    obj.data.materials.clear()
    obj.data.materials.append(mat)

    mesh = obj.data
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
        v = max(0.42, min(1.0, a ** 0.72))
        final_attr.data[i].color = (v, v, v, 1.0)
    mesh.color_attributes.active_color_index = 0
    mesh.color_attributes.render_color_index = 0
    bpy.data.objects.remove(ground, do_unlink=True)


def attach_pbr_material(obj, alb_path, nor_path, orm_path):
    mat = bpy.data.materials.new("SwordsmanPBR")
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = nodes["Principled BSDF"]

    tex_alb = nodes.new("ShaderNodeTexImage")
    tex_alb.image = bpy.data.images.load(alb_path, check_existing=True)
    tex_alb.image.colorspace_settings.name = "sRGB"

    tex_nor = nodes.new("ShaderNodeTexImage")
    tex_nor.image = bpy.data.images.load(nor_path, check_existing=True)
    tex_nor.image.colorspace_settings.name = "Non-Color"

    tex_orm = nodes.new("ShaderNodeTexImage")
    tex_orm.image = bpy.data.images.load(orm_path, check_existing=True)
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


def render_preview(obj):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24

    world = bpy.data.worlds.new("UnitWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.45, 0.56, 0.72, 1.0)
    bg.inputs["Strength"].default_value = 1.25

    sun_d = bpy.data.lights.new("UnitSun", type="SUN")
    sun_d.energy = 3.8
    sun_d.color = (1.0, 0.94, 0.84)
    sun_o = bpy.data.objects.new("UnitSun", sun_d)
    sun_dir = (Vector((0.0, 0.0, 1.0)) - Vector((6.0, -9.0, 8.0))).normalized()
    sun_o.rotation_euler = sun_dir.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(sun_o)

    cam_d = bpy.data.cameras.new("UnitCam")
    cam_d.lens = 55
    cam_o = bpy.data.objects.new("UnitCam", cam_d)
    cam_o.location = Vector((-1.15, -2.75, 1.48))
    cam_o.rotation_euler = (Vector((0.0, 0.0, 0.96)) - cam_o.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam_o)
    scene.camera = cam_o

    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.filepath = PREVIEW_JPG
    bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(sun_o, do_unlink=True)
    bpy.data.objects.remove(cam_o, do_unlink=True)


def export_glb(objs, out_path, animations=False):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=not animations,
        export_texcoords=True,
        export_normals=True,
        export_attributes=True,
        export_vertex_color="ACTIVE",
        export_skins=animations,
        export_animations=animations,
        export_materials="EXPORT",
        export_draco_mesh_compression_enable=False,
    )


def main():
    import sys

    os.makedirs(RAW_OUT, exist_ok=True)
    alb_path, nor_path, orm_path = generate_swordsman_textures()
    summary = {}

    for lod, suffix in [(0, "lod0"), (1, "lod1"), (2, "lod2"), (3, "shadow")]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        mb = UnitMeshBuilder()

        if lod == 3:
            # Coarse opaque shadow stand-in (~110 tris, closed capsule silhouette + shield + sword)
            mb.add_limb((0.0, 0.0, 0.02), (0.0, 0.0, 1.78), 0.22, 0.16, 6, "surcoat", "hips", rings=3)
            mb.add_box_part((-0.26, -0.34, 1.12), (0.48, 0.06, 0.70), (0.1, -0.15, -0.5), "shield", "forearm_l")
            mb.add_box_part((0.40, -0.52, 1.25), (0.06, 0.80, 0.06), (0.4, 0.0, -0.3), "steel", "hand_r")
            bmesh.ops.recalc_face_normals(mb.bm, faces=mb.bm.faces)
            mesh = bpy.data.meshes.new("swordsman_shadow")
            mb.bm.to_mesh(mesh)
            mb.bm.free()
            obj = bpy.data.objects.new("swordsman_shadow", mesh)
            bpy.context.collection.objects.link(obj)
            m = bpy.data.materials.new("ShadowMat")
            m.use_nodes = True
            obj.data.materials.append(m)
            out_path = os.path.join(RAW_OUT, "swordsman_shadow.glb")
            export_glb([obj], out_path, animations=False)
            tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
            summary[suffix] = {"tris": tris, "verts": len(obj.data.vertices), "bytes": os.path.getsize(out_path)}
            print(f"[swordsman] {suffix}: {tris} tris -> {out_path}")
            continue

        build_swordsman_geometry(mb, detail=(lod == 0))
        bmesh.ops.recalc_face_normals(mb.bm, faces=mb.bm.faces)
        mesh = bpy.data.meshes.new(f"swordsman_{suffix}")
        mb.bm.to_mesh(mesh)
        bone_names = list(mb.bone_names)
        mb.bm.free()

        obj = bpy.data.objects.new(f"swordsman_{suffix}", mesh)
        bpy.context.collection.objects.link(obj)

        # Decimate smoothly for LOD1 and LOD2 while preserving silhouette & UVs
        if lod in (1, 2):
            bpy.context.view_layer.objects.active = obj
            dec = obj.modifiers.new("Decimate", "DECIMATE")
            dec.ratio = 0.50 if lod == 1 else 0.24
            dec.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=dec.name)

        bake_unit_ao(obj, samples=22 if lod == 0 else 12)

        # Attach full 17-bone Armature + baked actions + PBR textures on LOD0; LOD1/LOD2 share LOD0's KTX2 material at runtime
        if lod == 0:
            attach_pbr_material(obj, alb_path, nor_path, orm_path)
            render_preview(obj)
            arm_obj = build_armature_and_actions(obj, bone_names)
            export_objs = [arm_obj, obj]
            export_glb(export_objs, os.path.join(RAW_OUT, f"swordsman_{suffix}.glb"), animations=True)
        else:
            mat_ph = bpy.data.materials.new("SwordsmanPBR")
            mat_ph.use_nodes = True
            nt = mat_ph.node_tree
            bsdf = nt.nodes["Principled BSDF"]
            vcol = nt.nodes.new("ShaderNodeVertexColor")
            vcol.layer_name = "Color"
            nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
            obj.data.materials.clear()
            obj.data.materials.append(mat_ph)
            export_glb([obj], os.path.join(RAW_OUT, f"swordsman_{suffix}.glb"), animations=False)

        out_path = os.path.join(RAW_OUT, f"swordsman_{suffix}.glb")
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        summary[suffix] = {"tris": tris, "verts": len(obj.data.vertices), "bytes": os.path.getsize(out_path)}
        print(f"[swordsman] {suffix}: {tris} tris, {len(obj.data.vertices)} verts -> {out_path} ({os.path.getsize(out_path)//1024} KiB)")

    print("[swordsman] DONE:", json.dumps(summary, indent=2))
    sys.stdout.flush()
    os._exit(0)


if __name__ == "__main__":
    main()
