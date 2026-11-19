# People from MakeHuman through Blender

(English version of `README.md`; keep the two in step.)

`build_people.py` builds a street's cast from MakeHuman 1.x data (CC0): the
body's shape from targets (sex, age, ancestry, muscle, weight, height), clothes
from the base mesh's helper shells (`helper-tights` → jacket, coat, trousers;
`helper-skirt` → coat tails, skirt; `helper-hair` → hair), shoes, MakeHuman's
163 bones folded into the game's 15, decimation in Blender to a budget (full
~6 thousand triangles, far ~1.4 thousand) and occlusion baked with Cycles into
the vertices. Output: `<character>_<lod>.bin` + `.json` (the skeleton's joints).

## Data

- `base.obj`, `default.mhskel`, `default_weights.mhw` — from
  https://github.com/makehumancommunity/makehuman (`makehuman/data/3dobjs`,
  `makehuman/data/rigs`), CC0.
- targets: `makehuman/data/targets/macrodetails` of the same repository, CC0
  (`git clone --sparse`, `git sparse-checkout set makehuman/data/targets/macrodetails`).

## Running

In Blender (its built-in Python):

```bash
blender -b --python build_people.py -- --mh-files <dir> --mh-data <makehuman/data> --out out --preview
```

or with the `bpy` module (`pip install bpy==4.2.0`, Python 3.11):

```bash
python -I build_people.py --mh-files <dir> --mh-data <makehuman/data> --out out --preview
```

`--preview` renders each character with Cycles into `out/preview/`. `--only man_coat,woman_skirt` builds the chosen ones.

## The MPFB version (real clothes, hair, skins) — on a PC with Blender

`build_people_mpfb.py` builds twelve characters from the MPFB extension and the
**MakeHuman system assets** pack (CC0): skin (young / middle-aged / old, by
ancestry and sex), eyes, eyebrows, eyelashes, a hairstyle, clothes and shoes
chosen by keywords from what is installed (the first matching pattern wins, so
it works with any version of the pack). MPFB fits each item and hides the body
under it; the script evaluates it in the rest pose, turns it into the game's
frame, decimates it (full ~12 thousand triangles, far ~2.2 thousand; eyebrows,
eyelashes and eyes are not decimated), bakes occlusion with Cycles (OptiX on an
RTX card) with the whole character in the scene, and writes:

- `<character>_full.bin/.json`, `<character>_far.bin/.json` — format 2:
  positions, normals, UVs, four of the game's 15 bones with weights, occlusion;
  in the `.json` the joints and the index ranges with their material (texture,
  normal map, colour, roughness, alpha for hair and eyebrows);
- `tex/` — the textures downscaled (skin 2048 / 512, clothes 1024 / 256…),
  shared between characters.

Requirements: Blender 4.2+ (it runs on 5.x), MPFB 2.0.x from
extensions.blender.org, and in MPFB *Apply assets → Load pack* with the system
assets pack.

The script needs `build_people.py` and `mhdata.py` beside it. From a command
line in this folder, with the full path to `blender.exe` standing for `blender`:

```bat
:: what MPFB sees (clothes, hairstyles, skins, eyes)
blender -b --python build_people_mpfb.py -- --list
:: the whole cast + textured previews (out\preview\*.png)
blender -b --python build_people_mpfb.py -- --out out --preview
:: only some, or without a GPU
blender -b --python build_people_mpfb.py -- --out out --only man_suit,woman_african --cpu
```

On an RTX 5090 the whole cast takes a few minutes. Put the `out` folder (the
`.bin` and `.json` files, `tex/`) into the game's people assets — the game
loads the characters from it. If `--list` shows other clothes' names than
`CAST` has (from other packs, say), add them to the characters' patterns.
