"""
Generates the reference sheets used by rules/games-ts-threejs.md.

All artwork here is generated from plain numbers and shapes, so it is safe to
ship inside a repo. Re-run from the repo root (PowerShell or bash):

    python references/_generate_references.py

Needs: numpy, matplotlib, pillow. Fonts come from matplotlib's bundled DejaVu,
so the sheets look the same on Windows, macOS and Linux.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Circle, Rectangle
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent

BG = "#14161a"
FG = "#e8eaed"
MUTED = "#9aa0a6"
ACCENT = "#5ac8fa"
GRID = "#2a2e35"
CARD = "#1b1e23"

plt.rcParams.update({
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
    "text.color": FG, "axes.labelcolor": FG, "axes.edgecolor": MUTED,
    "xtick.color": MUTED, "ytick.color": MUTED, "grid.color": GRID,
    "font.size": 9,
})


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    # matplotlib ships DejaVu Sans, so this works on every OS. The old version
    # looked in /usr/share/fonts only and fell back to a tiny bitmap font on Windows.
    props = font_manager.FontProperties(family="DejaVu Sans",
                                        weight="bold" if bold else "normal")
    path = font_manager.findfont(props, fallback_to_default=True)
    return ImageFont.truetype(path, size)


# ------------------------------------------------------------- colour helpers
def srgb_to_linear(c8: int) -> float:
    c = c8 / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb8(v: float) -> int:
    v = min(max(v, 0.0), 1.0)
    s = 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    return int(round(s * 255))


def hex_from_linear(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{linear_to_srgb8(c):02x}" for c in rgb)


def luminance_of_hex(hexc: str) -> float:
    r, g, b = (srgb_to_linear(int(hexc[i:i + 2], 16)) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b          # Rec.709 weights


# ---------------------------------------------------------------- 1. PBR sheet
# Metal base colour = specular reflectance F0 (linear). Values from
# Hoffman, "Physics and Math of Shading", SIGGRAPH 2015 course (also RTR4 tab. 9.2).
F0_IRON = (0.562, 0.565, 0.578)
F0_ALUMINIUM = (0.913, 0.922, 0.924)
F0_COPPER = (0.955, 0.638, 0.538)
F0_BRASS = (0.910, 0.778, 0.423)

# Non-metal albedo range (linear luminance). Floor ~ rubber / soot / charcoal,
# ceiling ~ fresh snow. Equivalent sRGB greys: #282828 .. #f4f4f4.
DIELECTRIC_MIN_LUM = 0.021
DIELECTRIC_MAX_LUM = 0.92
METAL_MIN_LUM = 0.45     # no real metal reflects less than ~45 % at normal incidence

# kind: "d" dielectric, "m" metal, "t" transmissive (swatch shows tint only)
MATERIALS = [
    # name, base colour, roughness, kind, note, extra (Physical-material params)
    ("Asphalt, dry",          "#3a3a3c", 0.92, "d", "city roads (fresh)", "worn lanes up to #5a5a5c"),
    ("Asphalt, wet",          "#2a2b2e", 0.35, "d", "after rain", "clearcoat 1, ccRough 0.05, SSR"),
    ("Concrete, weathered",   "#8f8b85", 0.88, "d", "kerbs, buildings", "detail normal up close"),
    ("Runway concrete",       "#a09d96", 0.85, "d", "airbase", "tyre marks as decals"),
    ("Road paint, white",     "#d6d6d0", 0.60, "d", "lane markings", "never pure white"),
    ("Brick, red",            "#8a4b3a", 0.80, "d", "city walls", "height map + POM"),
    ("Window glass",          "#e6ebeb", 0.02, "t", "buildings", "transmission 1, IOR 1.52"),
    ("Car paint, generic",    "#6e2a24", 0.40, "d", "wrecked cars", "clearcoat 1, ccRough 0.03"),
    ("Dry soil",              "#6b5a47", 0.95, "d", "forest floor, ruts", "triplanar on slopes"),
    ("Mud, wet",              "#3e3328", 0.40, "d", "tank tracks", "wet = darker + smoother"),
    ("Sand",                  "#c2b280", 0.90, "d", "desert maps", "brownout colour source"),
    ("Grass, dry",            "#6d7343", 0.90, "d", "open ground", "macro variation map"),
    ("Grass, fresh",          "#4a6030", 0.85, "d", "meadows", "translucency from back"),
    ("Pine foliage",          "#3c4a2e", 0.85, "d", "alpha-clip + A2C", "thin translucency"),
    ("Tree bark",             "#4a3b30", 0.93, "d", "trunks", "high normal detail"),
    ("Rock, granite",         "#7a7672", 0.85, "d", "outcrops, ridges", "triplanar, no stretch"),
    ("Snow, fresh",           "#f0f4f8", 0.60, "d", "winter maps", "watch exposure blow-out"),
    ("Water, river (tint)",   "#3e5a4c", 0.02, "t", "river, spray", "IOR 1.33, attenuation 1.5 m"),
    ("Steel, polished",       hex_from_linear(F0_IRON), 0.12, "m", "bolt faces, mirrors", "F0 iron (Hoffman)"),
    ("Steel, worn edge",      hex_from_linear(F0_IRON), 0.35, "m", "edge-wear mask only", "under paint / phosphate"),
    ("Aluminium, brushed",    hex_from_linear(F0_ALUMINIUM), 0.28, "m", "airframe panels", "anisotropy 0.6"),
    ("Brass case",            hex_from_linear(F0_BRASS), 0.25, "m", "ejected shells", "F0 brass (Hoffman)"),
    ("Copper",                hex_from_linear(F0_COPPER), 0.30, "m", "wiring, tracer tips", "F0 copper (Hoffman)"),
    ("Parkerised finish", "#3c3c3e", 0.62, "d", "rifle receivers", "phosphate = non-metal"),
    ("Aircraft grey, matte",  "#6a6d71", 0.58, "d", "stealth-style paint", "panel-line AO"),
    ("Blue-grey camo",        "#7b8898", 0.62, "d", "air-superiority", "exhaust soot mask"),
    ("NATO green",            "#4b5340", 0.76, "d", "armour paint", "dust + mud masks"),
    ("Khaki green",           "#5c5b3e", 0.80, "d", "armour paint, east", "dust + mud masks"),
    ("Uniform fabric",        "#5a5e48", 0.90, "d", "soldiers", "sheen 0.4, sheenRough 0.8"),
    ("Rubber, track pad",     "#2b2b2d", 0.90, "d", "tank tracks", "almost no specular"),
    ("Tyre rubber, worn",     "#2c2c2e", 0.86, "d", "wheels", "dust in the cavity"),
    ("Canopy (acrylic)",      "#dfe6ea", 0.05, "t", "jet / heli canopy", "trans 0.95, IOR 1.49, 12 mm"),
    ("Soot / burn mark",      "#2b2b2c", 0.97, "d", "decals after a hit", "floor of the range"),
    ("Rust, fresh",           "#7a4326", 0.88, "d", "edge wear", "rust is non-metal"),
]


def _check_materials() -> None:
    """Fail loudly if a swatch breaks the physical range it claims to follow."""
    for name, hexc, rough, kind, *_ in MATERIALS:
        lum = luminance_of_hex(hexc)
        if not 0.0 <= rough <= 1.0:
            raise ValueError(f"{name}: roughness {rough} outside 0..1")
        if kind == "d" and not DIELECTRIC_MIN_LUM <= lum <= DIELECTRIC_MAX_LUM:
            raise ValueError(f"{name}: luminance {lum:.3f} outside "
                             f"{DIELECTRIC_MIN_LUM}..{DIELECTRIC_MAX_LUM}")
        if kind == "m" and lum < METAL_MIN_LUM:
            raise ValueError(f"{name}: metal luminance {lum:.3f} < {METAL_MIN_LUM}")


def pbr_sheet() -> None:
    _check_materials()
    cols = 5
    rows = math.ceil(len(MATERIALS) / cols)
    cw, ch, pad, header = 312, 160, 28, 118
    W, H = cols * cw + pad * 2, rows * ch + pad * 2 + header
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((pad, 24), "PBR MATERIAL REFERENCE", font=_font(26, True), fill=FG)
    d.text((pad, 62), "Base colour is sRGB. Non-metals: linear luminance 0.021-0.92 "
                      "(about #282828 to #f4f4f4). Metals: base colour = F0, never darker than ~#b4b4b4.",
           font=_font(14), fill=MUTED)
    d.text((pad, 84), "metal 1 only for bare metal. Paint, phosphate, rust and rubber are metal 0. "
                      "ORM texture: R = AO, G = roughness, B = metalness (glTF / three.js).",
           font=_font(14), fill=MUTED)

    kind_label = {"d": "metal 0", "m": "metal 1", "t": "metal 0 · transmissive"}
    for i, (name, hexc, rough, kind, note, extra) in enumerate(MATERIALS):
        cx = pad + (i % cols) * cw
        cy = pad + header + (i // cols) * ch
        d.rectangle([cx + 6, cy + 6, cx + cw - 12, cy + ch - 12], fill=CARD)
        d.rectangle([cx + 16, cy + 16, cx + 116, cy + 116], fill=hexc, outline=GRID)
        g = int(255 * (1.0 - rough))                      # gloss hint: brighter = smoother
        for k in range(90):
            v = int(g * (1.0 - k / 89.0) ** 2)
            d.line([(cx + 20 + k, cy + 100), (cx + 20 + k, cy + 112)], fill=(v, v, v))
        tx = cx + 128
        d.text((tx, cy + 16), name, font=_font(14, True), fill=FG)
        d.text((tx, cy + 38), f"{hexc.upper()}  L {luminance_of_hex(hexc):.3f}",
               font=_font(13), fill=ACCENT)
        d.text((tx, cy + 58), f"rough {rough:.2f}", font=_font(13), fill=FG)
        d.text((tx, cy + 76), kind_label[kind], font=_font(13), fill=FG)
        d.text((tx, cy + 97), note, font=_font(12), fill=MUTED)
        d.text((cx + 16, cy + 124), extra, font=_font(12), fill="#c9b27a")

    img.save(OUT / "pbr-material-reference.png")


# ------------------------------------------------------------- 2. scale sheet
VEHICLES = [
    # name, length, width, height, colour, width note
    ("Infantry soldier", 0.45, 0.60, 1.83, "#c0c4c8", "L = depth with kit"),
    ("Light utility 4x4", 4.60, 2.16, 1.83, "#8a8f78", ""),
    ("M1-class MBT (gun fwd)", 9.83, 3.66, 2.44, "#5f6a50", ""),
    ("T-90-class MBT (gun fwd)", 9.63, 3.78, 2.22, "#6d6b4a", ""),
    ("AH-64-class attack heli", 17.73, 5.23, 3.87, "#4e5a4a", "W = stub wings, rotor Ø 14.63 m"),
    ("Mi-28-class attack heli", 17.01, 4.88, 3.82, "#5a5a48", "W = stub wings, rotor Ø 17.20 m"),
    ("F-35-class fighter", 15.70, 10.70, 4.33, "#70757a", "W = wingspan"),
    ("Su-35-class fighter", 21.90, 15.30, 5.90, "#7b8898", "W = wingspan"),
]

# Typical European values, for grey-boxing the city map. Local codes vary.
CITY_SCALE = [
    ("Door opening", "2.10 × 0.90 m"),
    ("Storey, floor to floor", "3.0 m (shops 4.0 m)"),
    ("Stair riser / tread", "0.17 / 0.28 m"),
    ("Window sill height", "0.90 m"),
    ("Kerb height", "0.15 m"),
    ("Traffic lane", "3.5 m"),
    ("Pavement", "2.0-3.0 m"),
    ("Parked car gap", "~0.8 m"),
]


def scale_sheet() -> None:
    fig = plt.figure(figsize=(13, 8.2), dpi=150)
    gs = fig.add_gridspec(1, 2, width_ratios=[3.3, 1], wspace=0.05)
    ax = fig.add_subplot(gs[0, 0])
    y = 0.0
    for name, length, width, height, col, wnote in VEHICLES:
        ax.add_patch(Rectangle((0, y), length, height, facecolor=col,
                               edgecolor=FG, linewidth=0.8, alpha=0.92))
        ax.text(-0.35, y + height / 2, name, ha="right", va="center", fontsize=10, color=FG)
        label = f"L {length:.2f} m   W {width:.2f} m   H {height:.2f} m"
        if wnote:
            label += f"\n{wnote}"
        ax.text(length + 0.3, y + height / 2, label, ha="left", va="center",
                fontsize=8.5, color=MUTED)
        y += height + 1.6
    for m in range(0, 24, 2):
        ax.axvline(m, color=GRID, linewidth=0.6, zorder=0)
    ax.set_xlim(-7.5, 33)
    ax.set_ylim(-1, y)
    ax.set_xticks(range(0, 24, 2))
    ax.set_xlabel("metres")
    ax.set_yticks([])
    ax.set_aspect("equal")
    ax.set_title("SCALE REFERENCE — side profile bounding boxes, drawn to one scale, 1 grid = 2 m",
                 loc="left", fontsize=13, color=FG, pad=14)
    ax.spines[["top", "right", "left"]].set_visible(False)

    ax2 = fig.add_subplot(gs[0, 1])
    ax2.axis("off")
    ax2.set_xlim(0, 1); ax2.set_ylim(0, 1)
    ax2.text(0, 0.97, "CITY SCALE (grey-box)", fontsize=11, color=FG, weight="bold")
    for i, (k, v) in enumerate(CITY_SCALE):
        yy = 0.90 - i * 0.075
        ax2.text(0, yy, k, fontsize=9, color=FG)
        ax2.text(0, yy - 0.03, v, fontsize=9, color=ACCENT)
    ax2.text(0, 0.22, "Player eye height:\nstand 1.70 · crouch 1.15 · prone 0.45 m",
             fontsize=8.5, color=MUTED)
    ax2.text(0, 0.10, "If it looks wrong, check this sheet\nbefore rescaling anything.",
             fontsize=8.5, color=MUTED)
    fig.savefig(OUT / "scale-reference.png", bbox_inches="tight")
    plt.close(fig)


# --------------------------------------------------------- 3. lighting sheet
# Exposure: EV100 from illuminance with an incident-meter constant C = 250:
#   EV100 = log2(E * 100 / C)
# Pre-exposure from Lagarde & de Rousiers, "Moving Frostbite to PBR" (2014):
#   exposure = 1 / (1.2 * 2^EV100)
LIGHT_LEVELS = [
    # scene, illuminance lx (sun + sky on the ground), sun K, sky K, note
    ("Clear noon sun", 100000, 5500, 10000, "sun elev 60-75 deg"),
    ("Hazy midday", 40000, 5500, 7000, "soft shadow edges"),
    ("Overcast day", 8000, None, 7000, "sky is the key light"),
    ("Golden hour", 12000, 3200, 9000, "long shadows, warm rim"),
    ("Sunset / blue hour", 400, 2000, 12000, "cold ambient, warm horizon"),
    ("Civil twilight", 10, None, 14000, "headlights start to read"),
    ("Full moon, clear", 0.25, 4100, 4100, "moon 4100 K, render slightly blue"),
    ("Overcast night", 0.002, None, 4000, "almost black, use NV / thermal"),
]

# Point and spot lights are in candela in three.js (not lux). Tuned by hand as
# starting points; the old sheet listed these two in lux, which was the wrong unit.
POINT_LIGHTS = [
    ("Muzzle flash, rifle (peak)", "~60 000 cd", "2400 K", "1-2 frames, no shadow"),
    ("Burning wreck", "~12 000 cd", "1900 K", "flicker 4-9 Hz, casts shadow"),
    ("Weapon light", "~1000 lm, ~15 000 cd", "6000 K", "spot, 10 deg hotspot"),
    ("Interior bulb", "1000 lm ≈ 80 cd", "2700 K", "use a light probe too"),
]


def ev100_from_lux(lux: float) -> float:
    return math.log2(lux * 100.0 / 250.0)


def exposure_from_ev100(ev100: float) -> float:
    return 1.0 / (1.2 * 2.0 ** ev100)


def lighting_sheet() -> None:
    fig = plt.figure(figsize=(14, 9.2), dpi=150)
    gs = fig.add_gridspec(2, 3, height_ratios=[1.05, 1], hspace=0.45, wspace=0.32)

    ax = fig.add_subplot(gs[0, :])
    names = [n for n, *_ in LIGHT_LEVELS]
    lux = [l for _, l, *_ in LIGHT_LEVELS]
    ax.barh(names, lux, color=ACCENT, alpha=0.75, height=0.55)
    ax.set_xscale("log")
    ax.set_xlabel("illuminance on the ground (lux, log scale) — sets the sun DirectionalLight")
    ax.invert_yaxis()
    ax.grid(axis="x", linewidth=0.5)
    for i, (n, l, sun_k, sky_k, note) in enumerate(LIGHT_LEVELS):
        ev = ev100_from_lux(l)
        sun = f"key {sun_k} K" if sun_k else "no direct key"
        ax.text(l * 1.4, i, f"{l:,.3g} lx · EV100 {ev:+.1f} · exposure {exposure_from_ev100(ev):.2e}"
                            f" · {sun} / sky {sky_k} K · {note}",
                va="center", fontsize=7.5, color=MUTED)
    ax.set_xlim(1e-3, 1e13)
    ax.set_title("LIGHTING REFERENCE — target these before touching any post effect",
                 loc="left", fontsize=14, color=FG, pad=12)

    ax2 = fig.add_subplot(gs[1, 0])
    x = np.linspace(0, 6, 400)
    a, b, c, d_, e = 2.51, 0.03, 2.43, 0.59, 0.14          # Narkowicz ACES fit
    aces = np.clip((x * (a * x + b)) / (x * (c * x + d_) + e), 0, 1)
    ax2.plot(x, aces, color=ACCENT, lw=2, label="ACES filmic (default)")
    ax2.plot(x, x / (1 + x), color="#f0a35e", lw=1.4, ls="--", label="Reinhard (flat, avoid)")
    ax2.plot(x, np.clip(x, 0, 1), color=MUTED, lw=1, ls=":", label="clamp (banding)")
    ax2.set_xlabel("scene linear radiance (after exposure)")
    ax2.set_ylabel("display value")
    ax2.legend(fontsize=7.5, facecolor=CARD, edgecolor=GRID, labelcolor=FG, loc="lower right")
    ax2.grid(linewidth=0.5)
    ax2.set_title("Tone mapping — A/B against AgX on fire and sky", loc="left", color=FG, fontsize=10)

    ax4 = fig.add_subplot(gs[1, 1])
    ax4.axis("off"); ax4.set_xlim(0, 1); ax4.set_ylim(0, 1)
    ax4.set_title("Local lights — candela, not lux", loc="left", color=FG, fontsize=10)
    for i, (n, inten, k, note) in enumerate(POINT_LIGHTS):
        yy = 0.92 - i * 0.22
        ax4.text(0, yy, n, fontsize=9, color=FG)
        ax4.text(0, yy - 0.075, f"{inten} · {k}", fontsize=8.5, color=ACCENT)
        ax4.text(0, yy - 0.14, note, fontsize=8, color=MUTED)
    ax4.text(0, -0.08, "Exposure = 1 / (1.2 · 2^EV100). Multiply every light by it\n"
                       "before render (pre-exposure). FP16 buffers overflow otherwise.",
             fontsize=7.5, color=MUTED)

    ax3 = fig.add_subplot(gs[1, 2])
    for i, v in enumerate(np.linspace(0, 1, 11)):
        ax3.add_patch(Rectangle((i, 1.1), 1, 1, facecolor=(v, v, v)))
        ax3.text(i + 0.5, 0.95, f"{int(round(v * 100))}", ha="center", va="top", fontsize=7, color=MUTED)
    prim = [("#ff0000", "R"), ("#00ff00", "G"), ("#0000ff", "B"), ("#00ffff", "C"),
            ("#ff00ff", "M"), ("#ffff00", "Y"), ("#808080", "mid"), ("#bfbfbf", "75%"),
            ("#1a1a1a", "shdw"), ("#f2f2f2", "hi"), ("#000000", "0")]
    for i, (hx, lab) in enumerate(prim):
        ax3.add_patch(Rectangle((i, -0.3), 1, 1, facecolor=hx))
        ax3.text(i + 0.5, -0.45, lab, ha="center", va="top", fontsize=7, color=MUTED)
    ax3.set_xlim(0, 11); ax3.set_ylim(-1.2, 2.4); ax3.axis("off")
    ax3.set_title("Calibration strip — screenshot it, check gamma", loc="left", color=FG, fontsize=10)

    fig.savefig(OUT / "lighting-reference.png", bbox_inches="tight")
    plt.close(fig)


# -------------------------------------------------------- 4. ballistics sheet
# Point-mass model with the standard G7 drag table. For game feel only.
# The old sheet used a constant-Cd formula with G1-style scaling on G7 BC
# values, which made drag ~2.8x too strong (5.56 took 1.4 s to 500 m).
AIR_DENSITY_KGM3 = 1.225           # ISA sea level
SPEED_OF_SOUND_MS = 340.3          # ISA 15 C
GRAVITY_MS2 = 9.81
LB_PER_IN2_TO_KG_PER_M2 = 703.07

# Standard G7 drag function, Mach -> Cd (public table used by JBM and others).
G7_MACH = [0.0, 0.5, 0.7, 0.8, 0.85, 0.9, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05,
           1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0,
           3.5, 4.0, 5.0]
G7_CD = [0.1198, 0.1194, 0.1202, 0.1242, 0.1306, 0.1464, 0.1660, 0.2054, 0.2993,
         0.3803, 0.4015, 0.4043, 0.4014, 0.3884, 0.3732, 0.3580, 0.3440, 0.3315,
         0.3117, 0.2980, 0.2864, 0.2752, 0.2643, 0.2533, 0.2424, 0.2170, 0.1950,
         0.1618]

ROUNDS = [
    # name, muzzle m/s, drag model, drag parameter, zero m, sight height m, colour
    # "g7": parameter is the G7 BC in lb/in^2 (public ammunition data)
    # "loss": parameter is velocity lost per km, m/s (tuned by hand for long-rod rounds)
    ("5.56 mm rifle", 920.0, "g7", 0.151, 300, 0.065, "#5ac8fa"),
    ("7.62 mm rifle", 838.0, "g7", 0.200, 300, 0.065, "#7ee08a"),
    ("Magnum sniper", 880.0, "g7", 0.310, 300, 0.065, "#f0a35e"),
    ("Heavy MG 12.7", 890.0, "g7", 0.330, 300, 0.080, "#e06c75"),
    ("Tank APFSDS", 1600.0, "loss", 65.0, 1000, 0.0, "#c678dd"),
]


def _decel_ms2(v: float, model: str, param: float, v0: float) -> float:
    if model == "g7":
        cd = float(np.interp(v / SPEED_OF_SOUND_MS, G7_MACH, G7_CD))
        bc_si = param * LB_PER_IN2_TO_KG_PER_M2
        return AIR_DENSITY_KGM3 * v * v * cd * math.pi / (8.0 * bc_si)
    # a = k v^2  ->  v(x) = v0 exp(-k x); pick k so v(1000 m) = v0 - loss
    k = math.log(v0 / (v0 - param)) / 1000.0
    return k * v * v


def _fly(v0: float, model: str, param: float, angle_rad: float,
         max_range_m: float, dt: float = 2e-4) -> tuple[np.ndarray, ...]:
    x = y = t = 0.0
    vx, vy = v0 * math.cos(angle_rad), v0 * math.sin(angle_rad)
    xs, ys, ts, vs = [0.0], [0.0], [0.0], [v0]
    while x < max_range_m and t < 12.0:
        v = math.hypot(vx, vy)
        a = _decel_ms2(v, model, param, v0)
        vx -= a * vx / v * dt
        vy -= (a * vy / v + GRAVITY_MS2) * dt
        x += vx * dt; y += vy * dt; t += dt
        xs.append(x); ys.append(y); ts.append(t); vs.append(v)
    return np.array(xs), np.array(ys), np.array(ts), np.array(vs)


def trajectory(v0: float, model: str, param: float, zero_m: float,
               sight_m: float, max_range_m: float) -> tuple[np.ndarray, ...]:
    """Returns range m, height above line of sight m, time s, speed m/s."""
    lo, hi = 0.0, 0.03
    for _ in range(40):                                  # bisection on the bore angle
        mid = 0.5 * (lo + hi)
        xs, ys, *_ = _fly(v0, model, param, mid, zero_m + 1)
        if np.interp(zero_m, xs, ys) < sight_m:
            lo = mid
        else:
            hi = mid
    xs, ys, ts, vs = _fly(v0, model, param, 0.5 * (lo + hi), max_range_m)
    return xs, ys - sight_m, ts, vs


def ballistics_sheet() -> None:
    fig = plt.figure(figsize=(14, 9.6), dpi=150)
    gs = fig.add_gridspec(2, 2, hspace=0.38, wspace=0.2)
    ax_drop, ax_mil = fig.add_subplot(gs[0, 0]), fig.add_subplot(gs[0, 1])
    ax_tof, ax_tab = fig.add_subplot(gs[1, 0]), fig.add_subplot(gs[1, 1])
    table = []
    for name, v0, model, param, zero, sight, col in ROUNDS:
        max_r = 3000 if model == "loss" else 1200
        xs, dy, ts, vs = trajectory(v0, model, param, zero, sight, max_r)
        lbl = f"{name} ({v0:.0f} m/s, zero {zero} m)"
        mask = xs >= 50                                  # closer than 50 m the sight offset dominates
        mil = -dy[mask] / xs[mask] * 1000.0              # + = hold high
        if model == "g7":
            ax_drop.plot(xs, dy * 100, color=col, lw=1.8, label=lbl)
            ax_mil.plot(xs[mask], mil, color=col, lw=1.8, label=name)
        ax_tof.plot(xs, ts, color=col, lw=1.8, label=name)
        ranges = (100, 300, 500, 800) if model == "g7" else (500, 1000, 2000, 3000)
        cells = []
        for r in ranges:
            m = -np.interp(r, xs, dy) / r * 1000.0 + 0.0          # + 0.0 avoids "-0.0"
            m = 0.0 if abs(m) < 0.05 else m
            cells.append(f"{r} m: {m:+.1f} mil {np.interp(r, xs, ts):.2f} s "
                         f"{np.interp(r, xs, vs):.0f} m/s")
        table.append((name, cells, col))

    ax_drop.axhline(0, color=MUTED, lw=0.8)
    ax_drop.set(xlabel="range (m)", ylabel="height vs line of sight (cm)", xlim=(0, 1000), ylim=(-900, 60))
    ax_drop.grid(linewidth=0.5)
    ax_drop.legend(fontsize=7.5, facecolor=CARD, edgecolor=GRID, labelcolor=FG, loc="lower left")
    ax_drop.set_title("Drop vs line of sight (sight 6.5-8 cm over bore)", loc="left", color=FG)

    ax_mil.axhline(0, color=MUTED, lw=0.8)
    ax_mil.set(xlabel="range (m)", ylabel="holdover (mil, + = hold high)", xlim=(0, 1000), ylim=(-2, 12))
    ax_mil.grid(linewidth=0.5)
    ax_mil.legend(fontsize=7.5, facecolor=CARD, edgecolor=GRID, labelcolor=FG, loc="upper left")
    ax_mil.set_title("Holdover in mil — what the mil-dot reticle uses", loc="left", color=FG)

    ax_tof.set(xlabel="range (m)", ylabel="time of flight (s)", xlim=(0, 2000), ylim=(0, 4))
    ax_tof.grid(linewidth=0.5)
    ax_tof.legend(fontsize=7.5, facecolor=CARD, edgecolor=GRID, labelcolor=FG, loc="upper left")
    ax_tof.set_title("Time of flight — drives lead on moving targets", loc="left", color=FG)

    ax_tab.axis("off"); ax_tab.set_xlim(0, 1); ax_tab.set_ylim(0, 1)
    ax_tab.set_title("Holdover · time · speed at range", loc="left", color=FG)
    for i, (name, cells, col) in enumerate(table):
        yy = 0.97 - i * 0.2
        ax_tab.text(0, yy, name, fontsize=9, color=col, weight="bold", va="top")
        for j, c in enumerate(cells):
            ax_tab.text(0.02 + (j % 2) * 0.5, yy - 0.055 - (j // 2) * 0.055, c,
                        fontsize=7.8, color=FG, va="top")

    fig.suptitle("PROJECTILE FEEL REFERENCE — G7 point-mass model, sea level, no wind. For gameplay tuning only",
                 x=0.012, ha="left", fontsize=13, color=FG)
    fig.savefig(OUT / "ballistics-reference.png", bbox_inches="tight")
    plt.close(fig)


# ------------------------------------------------------------- 5. HUD layout
CENTRE_ZONE_DIAMETER = 16 * 0.30        # circle, 30 % of screen WIDTH


def _label(ax: plt.Axes, x: float, y: float, text: str, col: str) -> None:
    ax.text(x, y, text, fontsize=8, color=col)


def hud_sheet() -> None:
    fig, axes = plt.subplots(2, 2, figsize=(13, 8.2), dpi=150)
    titles = ["FPS — safe zones", "Jet — HUD zones (collimated, in world)",
              "Tank — gunner zones", "Heli — zones"]
    for ax, title in zip(axes.ravel(), titles):
        ax.add_patch(Rectangle((0, 0), 16, 9, facecolor="#0d0f12", edgecolor=MUTED))
        ax.add_patch(Rectangle((0.8, 0.45), 14.4, 8.1, fill=False, edgecolor="#f0a35e", ls="--", lw=1))
        ax.text(0.9, 8.15, "title-safe 90%", fontsize=7, color="#f0a35e")
        ax.add_patch(Circle((8, 4.5), CENTRE_ZONE_DIAMETER / 2, fill=False, edgecolor="#3a3f47", ls=":"))
        ax.text(8, 7.05, "centre zone Ø 30% of width — symbols only, no text",
                ha="center", fontsize=7, color=MUTED)
        ax.set_xlim(-0.4, 16.4); ax.set_ylim(-0.4, 9.4)
        ax.set_aspect("equal"); ax.axis("off")
        ax.set_title(title, loc="left", color=FG, fontsize=11)

    a = axes[0, 0]
    a.plot([8], [4.5], marker="+", ms=14, color=ACCENT, mew=1.4)
    _label(a, 1.1, 1.1, "ammo / mag\nfire mode", FG)
    _label(a, 1.1, 7.6, "objective", FG)
    _label(a, 12.6, 1.1, "health · armour\nmed kits", FG)
    _label(a, 13.2, 7.6, "compass", FG)
    _label(a, 6.3, 0.8, "grenade type / count", FG)
    _label(a, 10.6, 2.2, "ADS: centre empty", MUTED)

    b = axes[0, 1]
    green = "#7ee08a"
    for dy in (-1.2, 1.2):                                   # pitch ladder bars
        b.plot([6.6, 7.5], [4.5 + dy] * 2, color=green, lw=1); b.plot([8.5, 9.4], [4.5 + dy] * 2, color=green, lw=1)
    b.add_patch(Circle((8.5, 4.2), 0.18, fill=False, edgecolor=green, lw=1.2))
    b.plot([8.1, 8.32], [4.2, 4.2], color=green, lw=1.2); b.plot([8.68, 8.9], [4.2, 4.2], color=green, lw=1.2)
    b.plot([8.5, 11.4], [4.2, 2.6], color=GRID, lw=0.6)
    _label(b, 11.5, 2.4, "flight-path marker\n(true velocity)", green)
    _label(b, 1.1, 4.5, "speed ladder\nMach", green)
    _label(b, 12.7, 4.5, "altitude ladder\nradar alt · VSI", green)
    _label(b, 6.7, 7.9, "heading tape", green)
    _label(b, 1.1, 1.1, "G · AoA", green)
    _label(b, 12.8, 1.1, "fuel · stores\nweapon mode", green)
    _label(b, 6.9, 1.1, "radar / RWR", green)

    c = axes[1, 0]
    orange = "#f0a35e"
    c.plot([8], [4.5], marker="^", ms=9, color=orange, mfc="none", mew=1.2)
    c.plot([9.0], [4.5], marker="|", ms=10, color=orange, mew=1.2)
    c.plot([9.0, 11.2], [4.5, 5.6], color=GRID, lw=0.6)
    _label(c, 11.3, 5.6, "reticle + lead mark", orange)
    _label(c, 1.1, 7.2, "turret vs hull\nindicator", orange)
    _label(c, 12.2, 7.2, "range · ammo\nreload timer", orange)
    _label(c, 1.1, 1.1, "minimap +\nturret cone", orange)
    _label(c, 11.5, 1.1, "hull damage\nby module", orange)

    d = axes[1, 1]
    purple = "#c678dd"
    d.add_patch(Circle((8, 4.5), 0.9, fill=False, edgecolor=purple, lw=0.8))
    d.add_patch(Circle((8.45, 4.8), 0.14, facecolor=purple, edgecolor=purple))
    d.plot([8.45, 11.2], [4.8, 5.8], color=GRID, lw=0.6)
    _label(d, 11.3, 5.8, "velocity-vector ball\n(hover drift)", purple)
    _label(d, 1.1, 4.5, "torque %\nrotor RPM\ncollective", purple)
    _label(d, 13.0, 4.5, "radar alt\nVSI\nairspeed", purple)
    _label(d, 6.2, 7.9, "heading · sensor state", purple)
    _label(d, 1.1, 6.3, "warnings\n(shape + voice)", purple)
    _label(d, 6.4, 1.1, "weapon + rounds left", purple)

    fig.suptitle("HUD LAYOUT REFERENCE — 16:9 zones, no text in the outer 5%. "
                 "On 21:9 / 32:9 anchor the HUD to the centred 16:9 area",
                 x=0.012, ha="left", fontsize=12.5, color=FG)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(OUT / "hud-layout-reference.png")
    plt.close(fig)


# ---------------------------------------------------- 6. performance budget
FRAME_HARD_MS = 16.6
FRAME_TARGET_MS = 14.0      # keeps ~2.6 ms for GC, streaming and driver spikes

GPU_PASSES = [   # tuned by hand as starting points — measure and replace
    ("Shadow maps (CSM)", 2.2, "#5ac8fa"), ("Opaque geometry", 3.8, "#7ee08a"),
    ("AO + SSR", 1.6, "#f0a35e"), ("Sky, atmosphere, fog", 0.8, "#56b6c2"),
    ("Transparent + particles", 1.8, "#e06c75"), ("TAA, bloom, tone map, sharpen", 1.2, "#c678dd"),
    ("Game-specific slot", 2.0, "#d19a66"), ("HUD", 0.3, "#9aa0a6"),
]
CPU_WORK = [
    ("Physics (60 Hz step)", 2.0), ("AI + game logic", 2.5),
    ("Render submit + culling", 3.5), ("Audio + streaming", 0.8),
]
GAME_SLOT = [
    ("FPS", "scope second view at ≤ ½ res"), ("Jet", "volumetric clouds"),
    ("Tank", "gunner sight + thermal view"), ("Heli", "sensor view, MFDs, downwash"),
]
CEILINGS = [   # High / Low
    ("Draw calls", "2500", "1500"), ("Triangles (M)", "12", "4"),
    ("Unique materials", "120", "80"), ("Shadow-casting lights", "4", "2"),
    ("Texture memory (GB)", "8", "2.5"), ("Active rigid bodies", "250", "250"),
]


def _budget_bars(ax: plt.Axes, items: list[tuple[str, float, str]], title: str) -> None:
    names = [n for n, *_ in items]
    ms = [m for _, m, *_ in items]
    ax.barh(names, ms, color=[c for *_, c in items], alpha=0.85, height=0.55)
    ax.invert_yaxis()
    ax.axvline(FRAME_TARGET_MS, color="#f0a35e", ls="--", lw=1.1)
    ax.axvline(FRAME_HARD_MS, color="#e06c75", ls="--", lw=1.1)
    for i, v in enumerate(ms):
        ax.text(v + 0.15, i, f"{v} ms", va="center", fontsize=8, color=MUTED)
    ax.set_xlim(0, 19)
    ax.grid(axis="x", linewidth=0.5)
    ax.set_title(f"{title} — total {sum(ms):.1f} ms", loc="left", color=FG, fontsize=10)


def perf_sheet() -> None:
    fig = plt.figure(figsize=(14, 7.4), dpi=150)
    gs = fig.add_gridspec(2, 2, width_ratios=[1.5, 1], height_ratios=[1.35, 1], hspace=0.5, wspace=0.35)

    # GPU passes stack up; the CPU runs in parallel, so it gets its own chart.
    ax_gpu = fig.add_subplot(gs[0, 0])
    _budget_bars(ax_gpu, GPU_PASSES, "GPU per frame, 1440p, High")
    ax_gpu.text(FRAME_TARGET_MS - 0.1, 7.45, "target 14 ms", color="#f0a35e", fontsize=7.5, ha="right")
    ax_gpu.text(FRAME_HARD_MS + 0.1, 7.45, "60 fps = 16.6", color="#e06c75", fontsize=7.5)

    ax_cpu = fig.add_subplot(gs[1, 0])
    _budget_bars(ax_cpu, [(n, m, "#56b6c2") for n, m in CPU_WORK], "CPU main thread (runs in parallel with GPU)")
    ax_cpu.set_xlabel("milliseconds per frame")

    ax_t = fig.add_subplot(gs[:, 1])
    ax_t.axis("off"); ax_t.set_xlim(0, 1); ax_t.set_ylim(0, 1.05)
    ax_t.text(0, 1.0, "HARD CEILINGS", fontsize=12, color=FG, weight="bold")
    ax_t.text(0.62, 1.0, "High", fontsize=10, color=MUTED); ax_t.text(0.82, 1.0, "Low", fontsize=10, color=MUTED)
    for i, (k, hi, lo) in enumerate(CEILINGS):
        y = 0.92 - i * 0.075
        ax_t.text(0.0, y, k, fontsize=9.5, color=FG)
        ax_t.text(0.62, y, hi, fontsize=9.5, color=ACCENT, weight="bold")
        ax_t.text(0.82, y, lo, fontsize=9.5, color=ACCENT, weight="bold")
        ax_t.plot([0.0, 0.98], [y - 0.025, y - 0.025], color=GRID, lw=0.8)
    ax_t.text(0, 0.40, "GAME-SPECIFIC SLOT (2.0 ms)", fontsize=10, color=FG, weight="bold")
    for i, (g, what) in enumerate(GAME_SLOT):
        ax_t.text(0.0, 0.33 - i * 0.06, g, fontsize=9, color=ACCENT)
        ax_t.text(0.14, 0.33 - i * 0.06, what, fontsize=9, color=FG)
    ax_t.text(0, 0.02, "Go over any of these and the fix is content, not a new setting.\n"
                       "Physics count is the same on both presets: gameplay must not change.",
              fontsize=8, color=MUTED)

    fig.suptitle("PERFORMANCE REFERENCE — measure before you optimise (starting budgets, tuned by hand)",
                 x=0.012, ha="left", fontsize=13, color=FG)
    fig.savefig(OUT / "performance-budget-reference.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    pbr_sheet()
    scale_sheet()
    lighting_sheet()
    ballistics_sheet()
    hud_sheet()
    perf_sheet()
    print("done")
