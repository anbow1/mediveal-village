#!/usr/bin/env python3
"""
Fetches verified CC0 photographic PBR surface scans and medieval props from Poly Haven API,
resizes surface maps to clean power-of-two PNGs ready for KTX2 encoding & single-texture
PNG-vs-KTX2 benchmarking, and writes attribution metadata for CREDITS.md.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path
from PIL import Image

UA = "marchland-asset-pipeline/1.0 (+https://github.com/anbow1/mediveal-village)"
SRC_DIR = Path("/tmp/marchland-src/polyhaven")
OUT_SURFACES_PNG = Path("/tmp/marchland-src/surfaces_png")
OUT_PROPS_RAW = Path("/tmp/marchland-src/props")
REPO_GAME = Path("/home/antigravity/anbow1/mediveal-village/games/new-game")

# Ordered layer table matching src/render/surfaces.ts (12 layers -> 3 CompressedArrayTextures)
SURFACES = [
    ("grass",    "forrest_ground_01",     2.0),
    ("dirt",     "brown_mud_03",          1.3),
    ("cobble",   "cobblestone_02",        1.8),
    ("plaster",  "clay_plaster",          2.0),
    ("beam",     "dark_wood",             2.0),
    ("boards",   "oak_wood_planks",       1.2),
    ("thatch",   "reed_roof_04",          2.5),
    ("shingles", "roof_slates_02",        3.0),
    ("rubble",   "medieval_blocks_03",    2.0),
    ("ashlar",   "castle_brick_02_white", 2.5),
    ("bark",     "jolcham_oak_bark_01",   1.5),
    ("linen",    "rough_linen",           0.27),
]

PROPS = [
    ("wine_barrel", "wine_barrel_01"),
]

def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))

def download_file(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    dest.write_bytes(data)
    return dest

def pick_1k_url(map_entry: dict) -> tuple[str, str]:
    res = map_entry.get("1k") or map_entry.get("2k")
    if "png" in res:
        return res["png"]["url"], ".png"
    if "jpg" in res:
        return res["jpg"]["url"], ".jpg"
    raise RuntimeError(f"No png/jpg in {res.keys()}")

def main() -> None:
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    OUT_SURFACES_PNG.mkdir(parents=True, exist_ok=True)
    OUT_PROPS_RAW.mkdir(parents=True, exist_ok=True)

    credits_rows = []
    manifest_surfaces = []

    for idx, (layer_name, ph_id, fallback_size_m) in enumerate(SURFACES):
        print(f"[{idx:02d}] Fetching surface '{layer_name}' ({ph_id})...")
        info = fetch_json(f"https://api.polyhaven.com/info/{ph_id}")
        files = fetch_json(f"https://api.polyhaven.com/files/{ph_id}")

        dims = info.get("dimensions")
        size_m = round(float(dims[0]) / 1000.0, 3) if dims and len(dims) >= 1 else fallback_size_m
        authors = ", ".join(info.get("authors", {}).keys()) or "Poly Haven"
        credits_rows.append({
            "kind": "Surface PBR scan",
            "local": f"surfaces/{layer_name} (layer {idx})",
            "title": info.get("name", ph_id),
            "author": authors,
            "url": f"https://polyhaven.com/a/{ph_id}",
            "licence": "CC0 1.0",
            "notes": f"512px array layer, real size {size_m:.2f} m",
        })

        for map_key, suffix in [("Diffuse", "albedo"), ("nor_gl", "normal"), ("arm", "orm")]:
            url, ext = pick_1k_url(files[map_key])
            raw_path = download_file(url, SRC_DIR / ph_id / f"{suffix}_1k{ext}")
            im = Image.open(raw_path).convert("RGB")
            # Keep one 1024px copy of plaster for the Stage 2 single-texture PNG-vs-KTX2 benchmark
            if layer_name == "plaster":
                im1024 = im.resize((1024, 1024), Image.Resampling.LANCZOS)
                im1024.save(OUT_SURFACES_PNG / f"{layer_name}_{suffix}_1024.png", optimize=True)
            # Standard 512px tile for the 3 GPU CompressedArrayTextures (albedo, normal, orm)
            im512 = im.resize((512, 512), Image.Resampling.LANCZOS)
            im512.save(OUT_SURFACES_PNG / f"{layer_name}_{suffix}.png", optimize=True)

        manifest_surfaces.append({
            "index": idx,
            "id": layer_name,
            "sourceId": ph_id,
            "tileSizeM": size_m,
            "authors": authors,
        })

    # Download real CC0 Poly Haven glTF prop(s) with all sidecar bin & textures
    for prop_name, ph_id in PROPS:
        print(f"[PROP] Fetching '{prop_name}' ({ph_id})...")
        info = fetch_json(f"https://api.polyhaven.com/info/{ph_id}")
        files = fetch_json(f"https://api.polyhaven.com/files/{ph_id}")
        authors = ", ".join(info.get("authors", {}).keys()) or "Poly Haven"
        gltf_entry = files["gltf"]["1k"]["gltf"]
        prop_dir = OUT_PROPS_RAW / prop_name
        prop_dir.mkdir(parents=True, exist_ok=True)
        download_file(gltf_entry["url"], prop_dir / f"{ph_id}_1k.gltf")
        for rel_path, inc in gltf_entry.get("include", {}).items():
            download_file(inc["url"], prop_dir / rel_path)
        credits_rows.append({
            "kind": "3D Prop (photogrammetry)",
            "local": f"models/barrel_*.glb",
            "title": info.get("name", ph_id),
            "author": authors,
            "url": f"https://polyhaven.com/a/{ph_id}",
            "licence": "CC0 1.0",
            "notes": "Prepared via Blender 4.2 (Cycles vertex AO, 3 LODs + shadow stand-in, KTX2, Meshopt)",
        })

    # Write surfaces metadata JSON for encode script & TypeScript manifest
    (OUT_SURFACES_PNG / "surfaces_meta.json").write_text(json.dumps(manifest_surfaces, indent=2), encoding="utf-8")

    # Write CREDITS.md
    credits_lines = [
        "# Marchland — Third-Party Asset Credits & Licences (`CREDITS.md`)",
        "",
        "Every third-party texture, scan, and model used in `games/new-game/` is strictly **CC0 1.0** or **CC BY 4.0**.",
        "Original Blender-built architecture, vegetation, character meshes, and code are authored for Marchland.",
        "",
        "| Category | Local Asset | Source Title | Author(s) | Source URL | Licence | Notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in credits_rows:
        credits_lines.append(
            f"| {r['kind']} | `{r['local']}` | {r['title']} | {r['author']} | {r['url']} | {r['licence']} | {r['notes']} |"
        )
    credits_lines.append("")
    (REPO_GAME / "CREDITS.md").write_text("\n".join(credits_lines), encoding="utf-8")
    print(f"Wrote {REPO_GAME / 'CREDITS.md'} and {len(manifest_surfaces)} surface sets.")

if __name__ == "__main__":
    main()
