# Marchland — Asset Manifest (Updated Stage 4)

> **Rules (`GUIDE.md` §1, §2, §3 & `docs/ASSETS.md`):**
> - Every third-party asset must be **CC0** or **CC BY 4.0**, with a matching attribution row in `CREDITS.md` before entering the repo. Never use NC, Sketchfab Standard, or ripped game/mod assets.
> - **Sourcing path adopted (Path B — Clean-Room CC0 + Original Blender 4.2 Authoring):** All 12 ground/architecture/nature PBR scans and photogrammetry barrel come from Poly Haven (**CC0 1.0**); all 9 medieval buildings/fortifications, 3 tree species + forestry props, and both rigged animated units (`swordsman` + `citizen`) are authored via reproducible Blender Python scripts (`games/new-game/tools/blender/*.py`, CC0 original).
> - All GLB assets use **Meshopt + quantization**, **3 LODs + matte impostor (> 100 m)**, **coarse opaque shadow stand-in (R7)** on layer 1, and **KTX2** UASTC+RDO textures (`bc7-rgba-unorm[-srgb]` on WebGPU, 4.0× VRAM savings vs RGBA8, **0 uncompressed image uploads**).

## 0. Stage 2 + Stage 4 Delivered & Verified Assets (`public/assets/manifest.json` — 103 files, 18.15 MB)

| Category | Asset | Source & Licence | LODs / Nodes / Animations | Disk Size (GLB + KTX2) | Textures / VRAM Notes | Build Script |
|---|---|---|---|---|---|---|
| Shared surface arrays | **12 PBR Surfaces** (`grass`, `dirt`, `cobble`, `plaster`, `beam`, `boards`, `thatch`, `shingles`, `rubble`, `ashlar`, `bark`, `linen`) | Poly Haven (CC0 1.0, see `CREDITS.md`) | Shared across terrain & all 9 buildings | **9.48 MB** (36 KTX2 UASTC+RDO) | 3 × `CompressedArrayTexture` (`512×512×12` BC7 = 12.0 MB VRAM vs 48 MB RGBA8) | `tools/assets/fetch_polyhaven.py`, `encode_surfaces.mjs` |
| Building (Stage 2) | **Half-Timbered Cottage L1** (`buildings/house_l1_*.glb`, `house_l1_impostor.ktx2`) | Original Blender (CC0) | `lod0..2`, `shadow`, `smoke_0`, impostor | `254 / 97 / 28 / 5.0 KiB` + `160 KiB` imp | 0 embedded textures (shared surface arrays + `UV1` layer/iron + Cycles AO) | `tools/blender/build_house.py` |
| Building (Stage 4) | **Lord's Keep L1** (`buildings/keep_l1_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow`, `smoke_0` | `108 / 95 / 37 / 4.8 KiB` | 0 embedded textures (shared surface arrays + Cycles AO) | `tools/blender/build_buildings_s4.py` |
| Building (Stage 4) | **Woodcutter's Lodge L1** (`buildings/woodcutter_l1_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow` | `38 / 24 / 16 / 3.8 KiB` | 0 embedded textures (shared surface arrays + chopping block + axe) | `tools/blender/build_buildings_s4.py` |
| Building (Stage 4) | **Farm Barn L1** (`buildings/farm_l1_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow` | `74 / 23 / 7.7 / 4.2 KiB` | 0 embedded textures (+ instanced golden wheat strips in `stage4Slice.ts`) | `tools/blender/build_buildings_s4.py` |
| Building (Stage 4) | **Post Windmill L1** (`buildings/windmill_l1_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow`, rotating `sails` child | `77 / 70 / 31 / 4.1 KiB` | 0 embedded textures (linen sails spin around windshaft pivot on 60 Hz clock) | `tools/blender/build_buildings_s4.py` |
| Building (Stage 4) | **Bakery L1** (`buildings/bakery_l1_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow`, domed oven + `smoke_0` | `37 / 29 / 16 / 4.5 KiB` | 0 embedded textures (bread stall, awning, stone oven + chimney smoke) | `tools/blender/build_buildings_s4.py` |
| Fortification (Stage 4) | **Watchtower L1** (`buildings/watchtower_l1_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow` (8.6 m parapet) | `55 / 55 / 9.6 / 4.4 KiB` | 0 embedded textures (coursed rubble/ashlar + timber fighting gallery) | `tools/blender/build_buildings_s4.py` |
| Fortification (Stage 4) | **Curtain Wall Segment** (`buildings/wall_segment_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow` (2.0 m crenellated) | `11 / 11 / 7.2 / 4.0 KiB` | 0 embedded textures (GPU-instanced static wall + R7 shadow batch) | `tools/blender/build_buildings_s4.py` |
| Fortification (Stage 4) | **Stone Gatehouse L1** (`buildings/gate_l1_*.glb`) | Original Blender (CC0) | `lod0..2`, `shadow`, hinged `leaf_l` & `leaf_r` | `37 / 33 / 13 / 6.4 KiB` | 0 embedded textures (6.4 m stone arch + raised portcullis + twin oak doors) | `tools/blender/build_buildings_s4.py` |
| Tree species 1 (Stage 2) | **European Oak** (`trees/oak_*.glb`, `oak_impostor.ktx2`) | Original Blender + Poly Haven `bark` (CC0) | `lod0..2`, `shadow`, backlit matte impostor | `808 / 32 / 11 / 5.5 KiB` + `152 KiB` imp | Flared roots, outward normals, batched multi-LOD `InstancedMesh` | `tools/blender/build_tree.py` |
| Tree species 2 (Stage 4) | **Scots Pine** (`trees/pine_*.glb`, `pine_impostor.ktx2`) | Original Blender (CC0) | `lod0..2`, `shadow`, backlit matte impostor | `386 / 29 / 12 / 3.3 KiB` + `126 KiB` imp | Sienna bark + evergreen needle spray cards; LOD1/2 share LOD0 KTX2 mats | `tools/blender/build_trees_s4.py` |
| Tree species 3 (Stage 4) | **Silver Birch** (`trees/birch_*.glb`, `birch_impostor.ktx2`) | Original Blender (CC0) | `lod0..2`, `shadow`, backlit matte impostor | `336 / 29 / 12 / 3.3 KiB` + `136 KiB` imp | Chalk-white lenticel bark + early-autumn gold serrated leaves; LOD1/2 shared | `tools/blender/build_trees_s4.py` |
| Forestry & shore (Stage 4) | **Stump**, **Sapling**, **Lake Reeds** (`trees/{stump,sapling,reeds}_lod0.glb`) | Original Blender (CC0) | Instanced `lod0` (`markStaticInstances`) | `230 / 287 / 5.2 KiB` | Woodcutter clearing stumps/saplings + shoreline reeds & cattails | `tools/blender/build_trees_s4.py` |
| Animated unit (Stage 2) | **Foot Swordsman** (`units/swordsman_*.glb`) | Original Blender (CC0) | Rigged `skins: 1`, `idle`/`walk`/`attack`, `lod0..2`, `shadow` | `1.41 MB / 47 / 39 / 2.8 KiB` | 1024² KTX2 atlas; Marchland Cobalt + zero-texture TSL Enemy Crimson swap | `tools/blender/build_unit.py` |
| Animated unit (Stage 4) | **Medieval Villager** (`units/citizen_*.glb`) | Original Blender (CC0) | Rigged `skins: 1`, `idle`/`walk`/`attack`, `lod0..2`, `shadow` | `585 / 15 / 10 / 2.8 KiB` | 512² KTX2 wool/linen/leather atlas + Cycles AO; walks village lanes on 60 Hz clock | `tools/blender/build_citizen.py` |
| Yard prop (Stage 2) | **Oak Wine Barrel** (`props/barrel_*.glb`) | Poly Haven `wine_barrel_01` (CC0 1.0) | `lod0..2`, `shadow` | `2.51 MB / 33 / 26 / 2.2 KiB` | Photogrammetry oak staves + iron hoops, grounded Z=0, Cycles AO | `tools/blender/prepare_prop.py` |

---

## 1. Planned Full-Campaign Surface & Asset Roadmap (Stages 3–8)

### 1.1 Scanned Ground Materials (8 materials, packed into 3 `CompressedArrayTexture`s)

| Category | What | Source | Licence | Tris LOD0/1/2 | Textures | Script |
|---|---|---|---|---|---|---|
| Ground scan | `meadow` (aerial + close-up grass meadow) | Poly Haven (`grass_path_2` / `aerial_grass_rock`) | CC0 1.0 | Terrain mesh (shared) | 1024² Color sRGB, Normal OpenGL, ORM (KTX2 UASTC/ETC1S array) | `tools/assets/pack_surfaces.mjs` + `ktx2_glb.mjs` |
| Ground scan | `dry_grass` (sun-dried autumn turf) | Poly Haven (`dry_ground_01` / `forrest_ground_01`) | CC0 1.0 | Terrain mesh | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Ground scan | `pasture` (open village grazing meadow) | Poly Haven (`brown_mud_leaves_01` / `grass_medium_01`) | CC0 1.0 | Terrain mesh | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Ground scan | `dirt` (packed village earth & wheel ruts) | Poly Haven (`brown_mud_dry`) | CC0 1.0 | Terrain mesh | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Ground scan | `mud` (wet lake shore silt & pig pen mud) | Poly Haven (`mud_cracked_dry_03` / `brown_mud_02`) | CC0 1.0 | Terrain mesh | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Ground scan | `forest_floor` (pine needles & leaf litter) | Poly Haven (`forest_leaves_02`) | CC0 1.0 | Terrain mesh | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Ground scan | `farm_soil` (ploughed agricultural furrows) | Poly Haven (`plowed_soil` / `gravelly_sand`) | CC0 1.0 | Terrain mesh | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Ground scan | `rock` (hillside granite/limestone & scree) | Poly Haven (`rock_face_03`) | CC0 1.0 | Terrain mesh + outcrops | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |

## 2. Scanned Architecture & Nature Surfaces (10 materials, same 3 `DataArrayTexture`s)

| Category | What | Source | Licence | Tris LOD0/1/2 | Textures | Script |
|---|---|---|---|---|---|---|
| Arch scan | `plaster` (aged lime-clay wattle infill) | Poly Haven (`rough_plaster_broken`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Arch scan | `beam` (dark hewn structural oak timber) | Poly Haven (`dark_wood` / `bark_brown_02`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Arch scan | `boards` (weathered sawn planks & eaves) | Poly Haven (`weathered_planks`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Arch scan | `thatch` (thick reed/straw cottage roof) | Poly Haven (`thatch_roof_angled`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Arch scan | `shingles` (uneven split wooden roof shingles) | Poly Haven (`wooden_shingles`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Arch scan | `tiles` (clay roof tiles & ridge caps) | Poly Haven (`roof_07`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Arch scan | `rubble` (coursed fieldstone masonry) | Poly Haven (`castle_wall_slates` / `stone_wall`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Arch scan | `ashlar` (dressed stone quoins & battlements) | Poly Haven (`castle_brick_02_red` / `stone_tile_wall`) | CC0 1.0 | Applied via triplanar | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Nature scan | `bark` (rough oak/pine trunk & stacked logs) | Poly Haven (`bark_willow` / `pine_bark`) | CC0 1.0 | Trees & logs | 1024² Color, Normal, ORM (in array) | `tools/assets/pack_surfaces.mjs` |
| Nature scan | `leaves` (foliage card spray alpha + translucency) | Poly Haven / procedural spray atlas (5–15 cm leaves) | CC0 1.0 | Tree canopies | 1024² Color+Alpha (coverage mips), Normal, ORM (KTX2) | `tools/assets/bake_atlases.mjs` |

## 3. Trees, Vegetation & Geology (≥ 3 Tree Species)

| Category | What | Source | Licence | Tris LOD0/1/2 | Textures | Script |
|---|---|---|---|---|---|---|
| Tree species 1 | **European Oak** (*Quercus robur*) — broadleaf canopy | Poly Haven (`tree_oak_01` / custom trunk + spray cards) | CC0 1.0 | 2 400 / 900 / 280 + 4-tri matte impostor | `bark` array + Oak leaf spray atlas 1024² KTX2 | `tools/assets/build_trees.mjs` + `shadow_mesh.mjs` |
| Tree species 2 | **Scots Pine** (*Pinus sylvestris*) — conifer needle boughs | Poly Haven (`pine_tree` / custom trunk + bough cards) | CC0 1.0 | 2 000 / 750 / 240 + 4-tri matte impostor | `bark` array + Pine needle spray atlas 1024² KTX2 | `tools/assets/build_trees.mjs` + `shadow_mesh.mjs` |
| Tree species 3 | **Silver Birch** (*Betula pendula*) — white bark, autumn-gold crown | Poly Haven (`birch_tree` / custom trunk + spray cards) | CC0 1.0 | 1 800 / 680 / 220 + 4-tri matte impostor | Birch bark 512² + Birch leaf spray atlas 1024² KTX2 | `tools/assets/build_trees.mjs` + `shadow_mesh.mjs` |
| Forestry lifecycle | **Felled Stump** & **Growing Sapling** (woodcutter / forester) | Original project geometry | CC0 (original) | 180 / 80 / 24 | `bark` array + `leaves` atlas | `tools/assets/build_trees.mjs` |
| Understory & crops | **Forest Shrubs**, **Lake Reeds**, **Wheat Strips**, **Vineyard Trellis & Vines** | Original project geometry (instanced) | CC0 (original) | 120–320 / 60 / 16 | Procedural/KTX2 alpha spray atlas 512² | `tools/assets/build_vegetation.mjs` |
| Geology | **Stone Outcrop**, **Iron Ore Outcrop**, **Loose Boulders** (3 variants) | Poly Haven (`boulder_01`, `namaqualand_boulder_02`) / displaced rock | CC0 1.0 | 1 200 / 450 / 140 | `rock` array + vertex-colour AO + ore vein mask | `tools/assets/shadow_mesh.mjs` |

## 4. Building Module Kit & All 31 Buildings + Fortifications

All modular buildings share the **Marchland Building Module Kit** (`plaster`, `beam`, `boards`, `thatch`, `shingles`, `tiles`, `rubble`, `ashlar`, `team` named surface materials; zero per-building texture bloat; vertex-colour AO; `smoke_*` empties; `cutY` shader construction slicing; coarse opaque shadow stand-ins via `tools/assets/shadow_mesh.mjs`).

| Category | What | Source | Licence | Tris LOD0/1/2 | Textures | Script |
|---|---|---|---|---|---|---|
| Building kit | **Half-Timbered Modular Kit** (stone footings, beamed plaster walls, 50–58° thatch/shingle/tile roofs with plank eaves, shuttered windows, doors, chimneys, yards) | Original project kit (`docs/BLENDER.md` Variant D) | CC0 (original) | Module parts 100–900 each | Shared 3 `DataArrayTexture` surface array (0 unique textures) | `tools/blender/kit.py`, `parts.py`, `build.py` (or procedural GLB builder) |
| Housing & town | **House** (L1–3), **Storehouse** (L1–3), **Market** (L1–3), **Tavern** (L1–3), **Chapel** (L1–3), **Well** (L1–3) | Original kit (Path A: `house_1..3.glb` + new kit builds for remaining 5) | CC0 (original) | 2 500–8 100 / 1 200 / 350 | Shared surface array + `team` mask | `tools/blender/buildings.py` + `shadow_mesh.mjs` |
| Extraction & wood | **Woodcutter's Lodge**, **Sawmill**, **Forester's Hut**, **Hunter's Lodge**, **Quarry**, **Iron Mine** (each L1–3) | Original kit (Path A: `woodcutter`, `quarry`, `ironMine` GLBs + kit builds for `sawmill`, `forester`, `hunter`) | CC0 (original) | 1 700–3 400 / 900 / 280 | Shared surface array | `tools/blender/buildings.py` + `shadow_mesh.mjs` |
| Food & wine | **Farm**, **Fisher's Hut**, **Windmill** (rotating `sails`), **Bakery**, **Brewery**, **Pig Farm**, **Butcher**, **Vineyard**, **Winery** (each L1–3) | Original kit (Path A: 8 existing GLBs + kit build for `brewery`) | CC0 (original) | 750–8 900 / 1 100 / 320 | Shared surface array | `tools/blender/buildings.py` + `shadow_mesh.mjs` |
| Craft & military | **Tannery**, **Smelter**, **Smithy** (L1 kit; L2–3: "Medieval Blacksmith" Daniel Andersson if Path A, else kit), **Armourer**, **Fletcher**, **Stable**, **Barracks**, **Gun Foundry** (each L1–3) | Original kit (+ Daniel Andersson Sketchfab CC BY 4.0 for Smithy L2–3 in Path A) | CC0 / CC BY 4.0 | 950–11 991 / 1 500 / 420 | Shared surface array + `team` mask | `tools/blender/buildings.py` + `convert.py` + `shadow_mesh.mjs` |
| Keep & Fortress | **Keep** (L1–3: "Buckstone Castle" Peter Leban or modular L1 palisade hall / L2 stone keep / L3 castle), **Campaign M5 Fortress Donżon** (central keep only — cut out from castle mesh or original kit donżon; outer `124 × 112 m` / 8-tower & inner `84 × 70 m` / 4-tower rings are destructible gameplay walls & towers per 19.11 `docs/ASSETS.md`) | Peter Leban (Sketchfab) / Uğur Yakışık (Sketchfab) / original kit | CC BY 4.0 / CC0 | Keep: 21 790 / 6 000 / 1 800 · Fortress donżon: ≤ 30 000 / 9 000 / 2 500 | Shared surface array + `team` banner | `tools/blender/keep.py` + `shadow_mesh.mjs` |
| Fortifications | **Wall** (2 m crenellated segment), **Gate** (6 m arch + `leaf_l`/`leaf_r`), **Watchtower** (L1–3, 8.6 m parapet), **Enemy Camp Tents**, **Burned Ruins** | "Tower and Castle Walls" LucasPresoto (Sketchfab) / original kit | CC BY 4.0 / CC0 | Wall: 204 / 96 / 32 · Gate: 2 600 / 900 / 250 · Tower: 6 600 / 2 000 / 600 | Shared surface array + `team` cloth | `tools/blender/walls.py` + `shadow_mesh.mjs` |

## 5. Soldiers, Townspeople, Animals & Siege Engines

| Category | What | Source | Licence | Tris LOD0/1/2 | Textures | Script |
|---|---|---|---|---|---|---|
| Infantry (6 types) | **Militia**, **Pikeman**, **Archer**, **Swordsman**, **Halberdier**, **Crossbowman** (with baked weapons & shields) | Path A: Sketchfab CC BY 4.0 models (`docs/ASSETS.md` — ChamberSu1996, Leonardo Carvalho, by__Rx, Thost) + user-supplied baked Mixamo clips · Path B: MPFB MakeHuman (`build_people_mpfb.py`) + Quaternius CC0 clips | CC BY 4.0 / CC0 (Path A Mixamo: user-supplied only, never redistributed as pack) | 1 680–3 550 / 950 / 320 | Vertex linear colour + `aSurface` (metal/rough/team) + shared RGBA-float bone-matrix `DataTexture` | `tools/assets/people/build_people_mpfb.py` / `tools/blender/rigged.py` |
| Cavalry (2 types) | **Warhorse** (rigged: idle, walk, gallop, graze, fall) + **Light & Heavy Rider** (seated + caparison + surcoat) | Path A: MAXDESIGN-3D Horse (Sketchfab CC BY 4.0) + Paladin J Nordstrom (user-supplied Mixamo) · Path B: Quaternius CC0 Animated Horse + MPFB rider | CC BY 4.0 / CC0 | Horse: 2 999 / 1 100 / 360 · Rider: 3 199 / 1 000 / 320 | Vertex colour + `aSurface` + bone-matrix `DataTexture` | `tools/blender/baked.py`, `horsefall.py`, `rigged.py --seated` |
| Artillery (2 types) | **Field Cannon** (gun + carriage + 3 crew/gun) & **Mortar** (heavy siege mortar + 5 crew) | Path A: Lyskilde / ViktorKom (Sketchfab CC BY 4.0) · Path B: original project geometry | CC BY 4.0 / CC0 | Cannon: 1 494 / 600 / 180 · Mortar: 1 185 / 500 / 160 | Vertex colour + `beam`/`iron` surface | `tools/assets/shadow_mesh.mjs` |
| Townspeople (8 variants) | **4 Townsmen** + **3 Townswomen** (11 work clips: walk, idle, boxwalk, boxidle, pickup, putdown, digging, fishing, chop, swing, harvest) + **Blacksmith** | Path A: Leonardo Carvalho, ChamberSu1996, cattleya, celestin.bitternose (Sketchfab CC BY 4.0) · Path B: MPFB MakeHuman + Quaternius CC0 clips | CC BY 4.0 / CC0 | 1 244–1 647 / 600 / 220 (Smith: 2 994) | Vertex colour + per-person `cloth` tint palette + shared bone-matrix `DataTexture` | `tools/assets/people/build_people_mpfb.py` / `tools/blender/rigged.py` |
| Livestock & carts | **Pig** (pig farm pen), **Handcart** (L2 carrier), **Wagon** (L3 carrier) | Path A: iRahulRajput, 3dAssetsForGames, NoodlePoodle (Sketchfab CC BY 4.0) · Path B: Quaternius / Poly Haven CC0 | CC BY 4.0 / CC0 | Pig: 320 / 140 / 60 · Handcart: 522 / 220 / 80 · Wagon: 1 200 / 480 / 160 | Vertex colour / shared `boards`+`beam` surface | `tools/assets/shadow_mesh.mjs` |

## 6. Carried Goods, Yard Props & Audio

| Category | What | Source | Licence | Tris LOD0/1/2 | Textures | Script |
|---|---|---|---|---|---|---|
| Carried goods | **Lumber, Stone, Sack, Barrel, Crate, Bread, Meat, Arrows** (8 goods) | KayKit Medieval Hexagon Pack & Restaurant Bits (GitHub) | CC0 1.0 | 92–400 / 60 / — (culled > 80 m) | Vertex linear colour (0 extra textures) | `tools/assets/ktx2_glb.mjs` (if GLB) / JSON prop loader |
| Extra village props | **Fish basket, Grape basket, Iron ingots, Ore heap, Wheat sheaf, Wattle fence (2 m)** | Poly Haven / KayKit / original project geometry | CC0 1.0 | 120–450 / 80 / — (culled > 80 m) | Vertex colour / shared surface array | `tools/assets/shadow_mesh.mjs` |
| Combat audio | **18 Combat Impact Sounds** (sword clashes, armour hits, blows, falls, breaking stone — mono MP3, ~116 KB) | Kenney "Impact Sounds" (`kenney.nl`) | CC0 1.0 | N/A | 18 mono MP3s (≤ 44.1 kHz) | Direct Web Audio decode |
| Ambient & cue audio | **Wind, Forest Birds, Bow/Crossbow Release, Cannon/Mortar Blast, Horn, Build/Chop Hammer, UI Feedback** | Procedural Web Audio synthesis (zero external assets) | CC0 (original) | N/A | Pre-baked short `AudioBuffer`s at load (0 per-frame nodes) | `src/ui/sound.ts` |

## 7. Explicitly Rejected / Prohibited Assets
- Any **CC BY-NC**, **CC BY-ND**, **Sketchfab Standard**, or unverified licence asset (e.g., `"Medieval Civilian 3"` Sketchfab Standard, re-uploaded Mixamo assets claiming CC BY, Total War mod rips — per `docs/ASSETS.md`).
- Any real historical national/order coats of arms, flags, or commercial brands (`GUIDE.md` §1, `docs/BLENDER.md` §0).
- Raw Mixamo FBX archives in git (only baked runtime assets if Path A is chosen by the user).
