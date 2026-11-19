# Marchland — Measurement & Verification Log (`RESULTS.md`)

> Newest entries first (`GUIDE.md` §1, §6). Every measurement includes date, commit, exact method (script, preset, view, alternating before/after runs), Before | After table (pipelines, draw calls / triangles, texture memory, ready / GPU idle, build size), screenshot comparison crops in `games/new-game/results/<date>/`, and the decision + number behind it. Reverted attempts are logged too.

## 2026-11-19 · Stage 4 — 100 × 100 m Vertical Slice at Final Quality & 560 × 560 m Budget Extrapolation (base `c1d160b`, pushed to `main`)

- **Measured how:** Production build (`vite build --base ./`, `21 MB` total, `103` manifest assets / `18.15 MB`) served via `tools/measure/serve.mjs games/new-game/dist 8765`. Headless Chrome (`/usr/bin/google-chrome`, SwiftShader Vulkan WebGPU + ANGLE SwiftShader WebGL2), strictly one browser process at a time:
  1. **`tools/measure/load.mjs --game generic --extra '&q=high|low' --hide-features texture-compression-astc,texture-compression-etc2 --json stage4-load-{high,low}.json`** — verifying BC7 GPU textures, 0 uncompressed uploads, exact pipeline/module/RT counts, and GPU-idle load time.
  2. **Stage 4 full visual, lighting, parity & animation suite (`verify-stage4.mjs`, `960×540`):**
     - WebGPU High (`high-a`, `high-b`, `polish`): 4-preset EV100 calibration (`clearNoon`, `lateAutumn`, `goldenHour`, `overcast`), 4-preset `showcase`, all 10 slice views (`ground_045m`, `eye_170m`, `town`, `rally`, `field`, `enemy`, `close`, `building`, `unit`, `overview`) + dedicated `lake_shore` and `farm_windmill` close-ups, deterministic `step(2.5)` advancing windmill sails / walking villagers / grass gusts / chimney smoke / water ripples, viewport resize (`920×520 ↔ 960×540`), and runtime pipeline tracer (`newPipelines: []`).
     - WebGPU Low (`&q=low`): `showcase`, `town`, `rally`, `ground_045m`, `goldenHour`, and pipeline tracer (`newPipelines: []`).
     - WebGL2 High fallback: `showcase`, `town`, `field`, `cal_clearNoon`, `cal_overcast` parity vs WebGPU High.
     - Phone landscape emulation (`800×380`, DPR 3 → capped 2× = `1600×760`, touch, Low, HUD visible).
  3. **Full 12-spot benchmarks (`?autostart&debug&bench&fast`, WebGPU `--disable-vulkan-surface`)** on High and Low → `stage4-bench-{high,low}.json`.
- **Stage 4 Before (Stage 3) | After (Stage 4 Vertical Slice) table:**

| Metric | Before — Stage 3 High (Low) | After — Stage 4 High (WebGPU) | After — Stage 4 Low (WebGPU) | Notes |
|---|---|---|---|---|
| World content (100 × 100 m slice) | Flat ground, 3 cottages, 4 oaks, 3 soldiers, small pond | **560 m sculpted terrain + 6-layer TSL + 41k R2 grass + enclosed lake + 12 buildings (9 types) + 12 wall segments + 75 batched trees (3 species) + 33 rigged units (2 armies + villagers) + 352 wheat sheaves + 38 lake reeds + smoke** | Same world (`19.3k` R2 grass blades, `160` wheat sheaves, `2`-cascade `1024²` CSM) | Single-height-function `TerrainField` + `GroundWorksMap` shared by terrain, grass, water, buildings, units, and contact shadows |
| Pipelines (total / after load) | `36 / 0` (`36 / 0`) | **`74 / 0`** (`105` shader modules) | **`74 / 0`** (`105` shader modules) | Tracer: **0 new pipelines** across all 12 views, 4 presets, `step(2.5)` & resize |
| Draw calls / frame (12 spots) | `27–75` (`27–62`) | **`179` overview · `257` town · `276` rally** | **`115` overview · `203` town · `218` rally** | Well below `≤ 500` High / `≤ 250` Low budgets (all 75 trees + walls + wheat + reeds + grass GPU-instanced) |
| Triangles / frame (12 spots) | `9.4k–63k` (`9k–50k`) | **`0.37 M` overview · `0.41 M` town · `0.53 M` eye_170m** | **`0.29 M` overview · `0.33 M` town · `0.43 M` eye_170m** | Well below `≤ 1.2 M` High / `≤ 0.6 M` Low ceilings; 87 matte impostors active in `overview` |
| Uploaded texture VRAM | `20.7 MB` (100% BC7) | **`25.2 MB`** (`29` textures: **`24.7 MB` BC7** + `0.3 MB` R32F height + `0.3 MB` RGBA8 groundWorks) | **`25.2 MB`** (`29` textures, **`24.7 MB` BC7**) | **`image uploads: 0, 0.00 s`**; +4.5 MB for 8 new buildings (0 embedded tex!), Pine, Birch, Citizen & terrain maps |
| Render-target VRAM | `125.6 MB` (`45.6 MB`) | **`125.6 MB`** (`34` targets) | **`45.6 MB`** (`32` targets) | Unchanged from Stage 3 (3×2048² High / 2×1024² Low CSM + HDR/MRT/TRAA/bloom + 128² PMREM) |
| Load (ready / GPU idle, SwiftShader) | `4.7 s / 13.5 s` (`5.0 s / 12.9 s`) | **`22.6 s / 28.0 s`** (`assets 1.90 s`, `scene 0.007 s`, `warmup 3.20 s`) | **`7.1 s / 26.4 s`** (`[load] total: 6.22 s`) | 103 binary files (`18.15 MB`) stream in `1.9–3.1 s`; **0 console/page errors** |
| Production build size (`dist/`) | `17 MB` | **`21 MB`** (`18.15 MB` assets + `1.20 MB` JS / `347 KB` gzip) | same | Only `+4 MB` over Stage 3 (well below `80 MB` ceiling) |
| GPU ms per pass (SwiftShader, `ground_045m` / `eye_170m`) | `674.5 ms` (`582.0 ms`) | **`4197.6 ms`** (scene `3421.6`, **shadows `153.6` = 3.7%**, post `613.0`, other `9.4`) | **`3834.2 ms`** (scene `3094.4`, **shadows `106.3` = 2.8%**, post `619.6`, other `13.8`) | R7 coarse shadow stand-ins + batched tree shadows keep shadows < 4% of GPU time; Low shadows **−31%** vs High |

- **4-Preset EV100 Calibration, Tone Floor & Cross-Backend Parity (`960×540`):**
  - **18% Grey Calibration Cube (both WebGPU & WebGL2):** `clearNoon` **`+0.01 stops`** (`[108.0, 104.0, 107.0]`, **0.0 / 255 WebGL2 diff**), `lateAutumn` **`+0.03 stops`**, `goldenHour` **`−0.01 stops`**, `overcast` **`−0.05 stops`** (`[104.9, 102.6, 104.2]`, **0.0 / 255 WebGL2 diff**) — all 4 presets locked within **±0.05 stops**.
  - **Shadow readability & clipping (`13` High views):** Zero clipped highlights (`p99` 137–222, never 255), warm readable undersides (`p05` 15–68 across all views and presets).
  - **High vs Low & WebGL2 Parity:** `town` mean abs diff `3.82 / 255` (High vs Low) and `4.15 / 255` (WebGPU vs WebGL2, mainly live windmill sail / villager animation delta); `cal` WebGL2 diff `0.69–2.04 / 255` (0.0 on grey cube).
  - **Phone landscape (`800×380`, DPR 3 → 2× cap, touch, Low):** `1600×760` backing, `204` draw calls, `332k` tris, crisp legible HUD buttons, zero overlap, **0 console errors**.
- **Extrapolation from Measured 100 × 100 m Slice → Full 560 × 560 m Campaign World (Stage 5–6 Gate):**

| Subsystem | Stage 4 Measured (100 × 100 m Slice) | Full 560 × 560 m Extrapolation | Ceiling (`BRIEF.md` §4 / `NUMBERS.md`) | Scaling Architecture & Headroom |
|---|---|---|---|---|
| Terrain + GroundWorks | `1` call, `157k` tris, `0.6 MB` VRAM | **`1` call, `157k` tris, `1.3 MB` VRAM** | Fixed | Terrain mesh is **already** 560 × 560 m; upgrading `GroundWorksMap` to `512²` adds only `+0.7 MB`, `+0` calls |
| R2 Bézier Grass (3 rings) | `3` calls, `129k` High / `60k` Low tris | **`3` calls, `129k` High / `60k` Low tris** | Fixed | Camera-focus annular rings: **0 scaling cost** from 100 m to 560 m |
| Forests (3 species, 450–600 trees) | `24` calls max (75 trees) | **`24` calls max**, `+30–45k` tris | Fixed calls | Batched per-species multi-LOD `InstancedMesh` + matte impostors (> 100 m) + 3 shadow batches |
| Buildings & Fortifications (31 types, ~75 placed + M5 fortress) | `~45` calls (`12` buildings + `12` instanced walls), `0 MB` extra tex | **`~85–115` calls**, `+140–220k` tris, **`0 MB` extra tex** | Shared 12-layer KTX2 arrays | All 31 building types share the existing `12.0 MB` BC7 surface arrays; walls/towers/houses instanced |
| Animated Army & Citizens (140 soldiers + 40 villagers) | `~85` calls (`33` individual `SkinnedMesh` actors) | **`≤ 28` calls** (GPU-instanced bone-matrix `DataTexture`, `180` people), `+5 MB` VRAM | `≤ 500` High / `≤ 250` Low | **Stage 4 gate finding:** Individual `SkinnedMesh` actors would add `+370` calls at 180 people → Stage 5/6 will batch all unit archetypes into GPU bone-texture `InstancedMesh`es (cutting unit draw calls from `85` → `≤ 28`!) |
| Water, Wheat, Reeds, Props, Smoke, Contact Shadows | `~18` calls, `~40k` tris | **`~24–30` calls, `~65k` tris** | Fixed | All static props/crops/reeds use `InstancedMesh` + `markStaticInstances` |
| **Total Extrapolated Full World** | **`257` High / `203` Low calls · `0.41 M` / `0.33 M` tris · `25.2 MB` BC7** | **`~240–340` High / `~170–230` Low calls · `0.68–0.92 M` / `0.44–0.58 M` tris · `~33–36 MB` BC7 · `~36 MB` `dist/`** | **`≤ 500` / `≤ 250` calls · `≤ 1.2 M` / `≤ 0.6 M` tris · `≤ 120 MB` tex · `≤ 80 MB` build** | **PASS across every single ceiling with generous margin** |

- **Comparison crops & JPEGs (`games/new-game/results/2026-11-19/`):**
  - `stage4-all-4-presets.jpg` (Clear Noon | Late Autumn | Golden Hour | Overcast slice showcase).
  - `stage4-height-sweep.jpg` (Ground `0.45 m` | Eye `1.70 m` | RTS `town 58 m` | `overview 420 m`).
  - `stage4-tactical-features.jpg` (`rally` Gate/Wall/Regiments | `enemy` Cobalt vs Crimson | `lake_shore` Reeds & Reflection | `farm_windmill` Wheat & Windmill).
  - `stage4-high-low-webgl2-diff8.jpg` (WebGPU High | WebGPU Low | WebGL2 High | `|WebGPU−WebGL2| × 8`).
  - Individual JPEGs: `stage4-high-{showcase,golden,overcast,ground-045m,eye-170m,town,rally,field,enemy,lake-shore,farm-windmill,building,unit,overview}.jpg`, `stage4-low-showcase.jpg`, `stage4-webgl2-showcase.jpg`, `stage4-phone-low-hud.jpg`.
  - Raw JSON: `stage4-load-{high,low}.json`, `stage4-bench-{high,low}.json`.
- **Bugs caught & fixed by live screenshot inspection (every single one verified visually via `view_file` after fix):**
  1. **Meshopt-quantized `Int16` overflow squashing instanced trees & walls (`stage4Slice.ts`):** `geo.applyMatrix4()` wrote real-world `0..12 m` coordinates back into normalized `Int16Array` attributes (`KHR_mesh_quantization`), clamping all instanced Oaks, Pines, Birches, and Curtain Walls into `[-1..+1]` m cubes! Fixed with `dequantizeGeometry()` unpacking quantized attributes into `Float32BufferAttribute`s before applying `matrixWorld`.
  2. **Deduplicated LOD1/LOD2 bark material mapped onto Pine & Birch leaf cards (`stage4Slice.ts`):** `gltf-transform dedup()` merged empty placeholder materials on texture-free `lod1`/`lod2` GLBs into `PineBarkPBR`/`BirchBarkPBR`, causing `byName ?? byObject` in `applySharedMaterialsFromLod0()` to assign solid bark textures onto distant Pine/Birch canopies. Swapped priority to `byObject ?? byName` → lush alpha-cutout evergreen pine needles and golden birch leaves across every LOD.
  3. **Instanced golden wheat field missing from farm strips (`stage4Slice.ts`):** `mat.positionNode` referenced raw `attribute('position')` instead of `positionLocal`, bypassing `InstancedMesh` instance matrices and piling all wheat at `(0, 0, 0)`. Switched to `positionLocal.add(...)` + `frustumCulled = false` on all static `InstancedMesh`es + denser 8-stalk golden sheaves → 352 swaying wheat sheaves carpeting all 4 ploughed dark-loam strips.
  4. **Sparse dark-speckled grass, dark Enemy Crimson surcoats, and low-angle lake ripple grid (`grassField.ts`, `lakeWater.ts`, `terrainMesh.ts`, `stage4Slice.ts`, `bench.ts`):** Tightened grass tiles (`3.2 m`, `41k` blades High / `19.3k` Low) with ground-matched olive-gold turf albedo; switched Enemy Crimson TSL team-swap from Rec.709 `luma` (which crushed blue to 7%) to channel-max brightness so Crimson vs Cobalt regiments read cleanly at RTS distance with 0 extra textures; replaced orthogonal lake waves with 5 domain-warped ripples + softened wet-bank roughness (`0.46`) + moved lakeshore trees onto dry bank; moved `enemy` camera clear of pine canopy.
  5. **Unit tests & shared-file integrity:** Added `tests/terrain.test.ts` verifying `TerrainField`, `GroundWorksMap`, `PlaneGeometry` triangle-split height agreement, and exact `+0.45 m` / `+1.70 m` ground-relative camera heights (**7 files, 24/24 Vitest tests passed**; `tsc --noEmit` 0 errors; all 7 `shared-src/` files byte-identical).

## 2026-11-19 · Stage 3 — Light & atmosphere: CSM, unified physical sky/fog/probe/water, contact shadows & 4-preset EV100 calibration (base `091266c`, pushed to `main`)

- **Measured how:** Production build (`vite build --base ./`, `17 MB` total) served via `tools/measure/serve.mjs games/new-game/dist 8765`. Headless Chrome (`/usr/bin/google-chrome`, SwiftShader Vulkan WebGPU + ANGLE SwiftShader WebGL2), strictly one browser process at a time:
  1. **`tools/measure/load.mjs --game generic --hide-features texture-compression-astc,texture-compression-etc2`** on High (`&q=high`) and Low (`&q=low`) — verifying BC7 textures, 0 uncompressed uploads, exact pipeline/module/RT counts, and GPU-idle load time.
  2. **Stage 3 full visual, CSM & calibration suite (`verify-stage3.mjs`, `960×540`):**
     - WebGPU High (3-cascade 2048² CSM `maxFar 320 m`, `fade = true`): 18% grey calibration cube across **all 4 presets** (`clearNoon`, `lateAutumn`, `goldenHour`, `overcast`), showcase across **all 4 presets**, dedicated `sunset_unity` view looking across the organic wet-banked meadow pond into the low golden-hour sun + clouds + sun shafts, `building`, `unit`, `ground_045m`, `eye_170m`, `town` (showing Cascade 0 foreground + Cascade 1 65 m midground farmstead + CalibrationRig simultaneously), and `overview` (height fog clarity at 460 m), plus runtime pipeline tracer across all 4 preset switches, views, viewport resize (`csm.updateFrustums()`), and `step(1.0)`.
     - WebGPU Low (2-cascade 1024² CSM `maxFar 200 m`, `fade = true`): showcase (`lateAutumn`, `goldenHour`, `overcast`), `town`, and pipeline tracer.
     - WebGL2 High fallback: showcase (`lateAutumn`, `goldenHour`) and calibration (`clearNoon`, `overcast`) parity checks vs WebGPU High.
  3. **Full 12-spot benchmarks (`?autostart&debug&bench&fast`, WebGPU `--disable-vulkan-surface`)** on High and Low → `stage3-bench-{high,low}.json`.
- **Stage 3 Before (Stage 2) | After (Stage 3) table:**

| Metric | Before — Stage 2 High (Low) | After — Stage 3 High (WebGPU) | After — Stage 3 Low (WebGPU) | Notes |
|---|---|---|---|---|
| Shadow system | 1 fixed ortho frustum (`±42 m`) | **3-cascade CSM (`2048²`, `320 m`, `fade`)** | **2-cascade CSM (`1024²`, `200 m`, `fade`)** | Practical-log splits (`27 / 96 / 320 m` High, `46 / 200 m` Low); R7 layer-1 stand-ins preserved across all cascades |
| Pipelines (total / after load) | `34 / 0` (`34 / 0`) | **`36 / 0`** (55 shader modules) | **`36 / 0`** (55 shader modules) | +2 (`GroundContactShadows`, `MarchlandCalmWaterMaterial`); tracer: **0 new** across 4 presets, views & resize |
| Draw calls / frame | `29–43` (`29–43`) | **`27–75`** (`74` showcase, `52` overview) | **`27–62`** (`59` showcase, `36` overview) | Multi-cascade shadow draws + 1 contact-shadow batch + 1 meadow pond + 2 Cascade-1 farmstead actors |
| Triangles / frame | `43 849 → 15 381 → 8 713` | **`63 159` close → `19 568` town → `9 359` overview** | **`50k → 18.5k → 9k`** | Live LOD0→1→2→impostor cuts tris by **−85%** |
| Uploaded texture VRAM | `20.7 MB` (100% BC7) | **`20.7 MB`** (15 textures, **100% BC7**) | **`20.7 MB`** (15 textures, **100% BC7**) | **`image uploads: 0, 0.00 s`** (procedural clouds, height fog, water ripples & contact shadows add 0 textures) |
| Render-target VRAM | `61.6 MB` (`37.6 MB`) | **`125.6 MB`** (34 targets) | **`45.6 MB`** (32 targets) | +64 MB High (3×2048² CSM) / +8 MB Low (2×1024² CSM); single persistent 128² PMREM target reused in-place |
| Load (ready / GPU idle, SwiftShader) | `5.1 s / 14.0 s` (`10.5 s / 15.5 s`) | **`4.7 s / 13.5 s`** (`[load] total: 3.40 s`) | **`5.0 s / 12.9 s`** (`[load] total: 4.17 s`) | Both High and Low GPU-idle faster than Stage 2; **0 console/page errors** |
| Production build size (`dist/`) | `17 MB` | **`17 MB`** (`1.17 MB` JS / `334 KB` gzip) | same | Unchanged disk footprint (well below 80 MB ceiling) |
| GPU ms per pass (SwiftShader, `ground_045m`) | `699.0 ms` (`697.3 ms`) | **`674.5 ms`** (scene `476.4`, **shadows `33.2`**, post `164.9`) | **`582.0 ms`** (scene `411.8`, **shadows `10.5`**, post `159.7`) | Low 2-cascade 1024² CSM shadows are **−68% cheaper** than High; total frame faster than Stage 2 |

- **4-Preset 18% Grey Calibration Cube & Shadow Underside Verification (`960×540`, Frostbite EV100 ±0.15 stop target):**

| Preset (Lux / Elev / Kelvin) | Anchor EV100 | 18% Cube Top sRGB | Exposure Δ vs Ref | Plaster Top sRGB | Showcase `dark 5%` RGB (Undersides) | Sky Zenith / Hue Check |
|---|---|---|---|---|---|---|
| **Clear Noon** (`100 klx + 22 klx`, `65°`, `5500 K`) | `15.46` | `[108.0, 104.0, 107.0]` | **`+0.01 stops`** | `[194.0, 190.0, 189.0]` | `[16.7, 12.4, 11.6]` (`p05 = 21.2`) | Crisp cerulean sky + clouds |
| **Late Autumn** (`45 klx + 11 klx`, `30°`, `4400 K`) | `13.71` | `[115.9, 103.0, 104.0]` | **`+0.03 stops`** | `[199.0, 188.0, 185.0]` | `[34.5, 29.3, 25.8]` (`p05 = 37.1`) | Warm autumn haze + long CSM |
| **Golden Hour** (`12 klx + 4.5 klx`, `12°`, `3200 K`) | `11.45` | `[119.0, 100.0, 104.7]` | **`−0.01 stops`** | `[199.0, 183.0, 184.0]` | `[56.0, 41.5, 36.3]` (`p05 = 53.1`) | Unified amber sun/fog/pond/shafts |
| **Overcast** (`2 klx + 8.5 klx`, `48°`, `6100 K`) | `11.96` | `[105.2, 102.8, 104.4]` | **`−0.04 stops`** | `[185.8, 183.1, 181.6]` | `[51.9, 43.9, 41.2]` (`p05 = 52.6`) | Bright neutral cloud deck, 0 purple cast |

  - **WebGL2 fallback parity (`960×540`):** **Exact `0.0 / 255` diff** on 18% grey cube top and lime plaster at both `clearNoon` and `overcast`; showcase mean abs pixel diff `3.00 / 255` WebGPU vs WebGL2 (`2.56 / 255` High vs Low — sky, fog, ground, and static cottage pitch-black in `|diff|×8`, with differences confined to animated swordsman walk & water ripple phase).
- **Comparison crops & JPEGs (`games/new-game/results/2026-11-19/`):**
  - `stage3-all-4-presets.jpg` (Clear Noon | Late Autumn | Golden Hour | Overcast showcase side-by-side).
  - `stage3-calibration-4-presets.jpg` (18% grey calibration cube & steel probe sphere across all 4 presets).
  - `stage3-before-after-strip.jpg` (Stage 2 vs Stage 3 Showcase & Golden Hour comparison).
  - `stage3-high-low-webgl2-diff8.jpg` (WebGPU High | WebGPU Low | WebGL2 High | `|WebGPU−WebGL2| × 8`).
  - `stage3-high-sunset-unity.jpg` (Golden Hour looking across wet-banked meadow pond into sun, shafts, horizon haze, and reflected sky).
  - `stage3-high-{showcase,noon,golden,overcast,building,unit,ground-045m,eye-170m,town,overview}.jpg`, `stage3-low-showcase.jpg`, `stage3-webgl2-showcase.jpg`.
  - Raw JSON: `stage3-load-{high,low}.json`, `stage3-bench-{high,low}.json`.
- **Issues caught & fixed during live Stage 3 visual inspection (all verified after fix):**
  1. **Overcast +0.20 stop exposure drift & harsh clear-noon shadow crush:** First live pass measured `overcast` top at `+0.20 stops` (cloudy PMREM upper dome was brighter than clear sky) and `clearNoon` showcase `dark 5%` at `[11.9, 9.0, 8.4]`. Tuned `overcast` `hemiShare = 0.22`, raised `clearNoon` `skyIlluminanceLux` to `22 000 lx` (`NUMBERS.md` clear sky range) with richer warm soil ground bounce (`groundBounceFactor = 0.28`, PMREM bounce `× 0.31/0.26/0.18`), locking all 4 presets to **±0.04 stops** and lifting `clearNoon` `dark 5%` to `[16.7, 12.4, 11.6]`.
  2. **Geometric oval corner pond → organic wet-banked meadow pond (`sky.ts`, `surfaces.ts`, `stage2Assets.ts`):** First placement at `(-1.6, 8.6)` sat cropped as a soft blurry grey oval in the bottom-left of `showcase`. Relocated uncropped into the west meadow `(-9.4, 0.02, -0.4)`, added matching harmonic contour warping + crisp wet-silt shore band, darkened olive-peat water body, and boosted multi-wave animated wind ripples + Fresnel sky/cloud reflection.
  3. **Distant cottage impostor 1.2 m float (`stage2Assets.ts`):** `impostorBottomSinkM` was still hardcoded to `0.35` instead of reading `tpl.impostorBottomSinkM` and matching `build_house.py`'s `ortho_scale = 11.4` ground margin (`3.25 m`). Fixed and visually verified flush on the ground in all 4 calibration backgrounds.
  4. **PMREM nadir `normalize(0)` guard (`sky.ts`):** Replaced `normalize(vec3(dir.x, 0, dir.z))` with NaN-free `dot(dir.xz, uSunDir.xz)` so the straight-down cubemap pole never generates NaN artifacts in mip chains.
  5. **GTAO reversed-depth safety:** Confirmed `docs/graphics-playbook.md` §11 r186 reversed-depth GTAO dark-face bug; implemented single-draw-call warm-earth `ContactShadowBatch` (`polygonOffsetFactor: 2` positive for reversed depth) + Cycles vertex AO + physical PMREM ground bounce so wall footings, barrels, oak root flares, and boots stay grounded in both harsh sun and diffuse overcast with zero dark-face regression.
  6. **Unit tests:** Expanded `tests/lightingMath.test.ts` with CSM split monotonicity, height-fog Taylor continuity & 460 m overview thinning (>4× clearer than ground haze), and overcast directional-fill checks (**6 files, 20/20 passed**; all 7 `shared-src/` files verified byte-identical).

## 2026-11-19 · Stage 2 — Asset pipeline, Blender 4.2 hero assets, KTX2/Meshopt & live verification (`091266c`)

- **Measured how:** Production build (`vite build --base ./`, `17 MB` total, `basis_transcoder` bundled once via `import.meta.url`) served via `tools/measure/serve.mjs games/new-game/dist 8765`. Headless Chrome (`/usr/bin/google-chrome`, SwiftShader Vulkan WebGPU + ANGLE SwiftShader WebGL2), strictly one browser process at a time:
  1. **Single-texture PNG vs KTX2 benchmark** (`1024×1024 clay_plaster`, alternating `png → uastc → etc1s → png` via `tools/measure/load.mjs --hide-features texture-compression-astc,texture-compression-etc2`).
  2. **`tools/measure/load.mjs --game generic`** on High (`&q=high`) and Low (`&q=low`) with `--hide-features texture-compression-astc,texture-compression-etc2` (verifying BC7 GPU textures and 0 uncompressed image uploads).
  3. **`tools/measure/shots.mjs --game generic`** (`960×540`) across WebGPU High (10 views: `showcase`, `building`, `unit`, `ground_045m`, `eye_170m`, `town`, `overview`, `golden_showcase`, `overcast_showcase`, `calibration_noon`), WebGPU Low (`showcase`, `building`, `unit`), and WebGL2 High fallback (`showcase`, `building`, `unit`, `calibration_noon`).
  4. **Runtime pipeline tracer, LOD/impostor transitions, animation & controls** (`verify-stage2.mjs`): GPU pipeline tracer across all 4 lighting presets, 8 camera spots (`lod0 → lod1 → lod2 → impostor`), `step(1.0)` skeletal animation advance, `Space` active pause, `F3` stats overlay; Phone landscape emulation (`800×380`, DPR 3 → 2× cap, touch, Low); full 12-spot benchmarks (`?autostart&debug&bench&fast`, High & Low).
- **Single-texture PNG vs KTX2 benchmark (1024×1024 `clay_plaster`, alternating runs on WebGPU BC7):**

| Format | Disk Size | PSNR vs PNG | GPU Format | Texture VRAM | Image Uploads | Pipelines | Ready / GPU Idle |
|---|---|---|---|---|---|---|---|
| **PNG (run 1 / run 2)** | `821.4 KiB` | ∞ (ref) | `rgba8unorm-srgb` | **5.3 MB** | `1 (10 ms)` | `22` | `2.6 s / 4.2 s` · `2.7 s / 4.3 s` |
| **KTX2 UASTC + RDO 1** | `411.4 KiB` (−50%) | **47.09 dB** | `bc7-rgba-unorm-srgb` | **1.3 MB (4.0× less)** | **`0 (0 ms)`** | `21` (−1 mipgen) | `2.5 s / 4.4 s` |
| **KTX2 ETC1S q200** | `93.0 KiB` (−89%) | **41.11 dB** | `bc7-rgba-unorm-srgb` | **1.3 MB (4.0× less)** | **`0 (0 ms)`** | `21` | `2.6 s / 4.2 s` |

  - **Decision:** Keep KTX2 UASTC+RDO across all 12 shared 512² surface array layers (**12.0 MB BC7 vs 48.0 MB RGBA8 = 4.0× GPU VRAM reduction**, 15.49 MB PNG → 9.48 MB KTX2 on disk, **0 uncompressed uploads**) and inside all embedded model textures + matte impostors.

- **Stage 2 Before (Stage 1) | After (Stage 2) table:**

| Metric | Before — Stage 1 High (Low) | After — Stage 2 High (WebGPU) | After — Stage 2 Low (WebGPU) | Notes |
|---|---|---|---|---|
| Pipelines (total / after load) | `20 / 0` (`20 / 0`) | **`34 / 0`** (51 shader modules) | **`34 / 0`** (51 shader modules) | Tracer: **0 new** across 4 presets & 8 spots/LODs |
| Draw calls / frame | `22–24` (`22–24`) | **`29–43`** (`43` showcase/building, `37` unit) | **`29–43`** | `info.render.drawCalls` (shadow + scene + post) |
| Triangles / frame | `3 298` (`0.003 M`) | **`43 849` close → `15 381` town → `8 713` overview** | same | Live LOD0→1→2→impostor cuts tris by **−80%** |
| Uploaded texture VRAM | `0 MB` (`0 MB`) | **`20.7 MB`** (15 textures, **100% BC7**) | **`20.7 MB`** (15 textures, **100% BC7**) | `image uploads: 0, 0.00 s`; 3× `512²×12` arrays = 12.0 MB |
| Render-target VRAM | `57.9 MB` (`33.9 MB`) | **`61.6 MB`** (30 targets) | **`37.6 MB`** (30 targets) | +3.7 MB for persistent 128² PMREM sky probe |
| Load (ready / GPU idle, SwiftShader) | `3.4 s / 4.6 s` (`3.3 s / 4.5 s`) | **`5.1 s / 14.0 s`** (`[load] total: 4.28 s`) | **`10.5 s / 15.5 s`** (`[load] total: 9.98 s`) | 54 binary assets (15.07 MB) streamed with real byte progress; **0 console errors** |
| Production build size (`dist/`) | `940 KB` | **`17 MB`** (`15.07 MB` assets + `1.15 MB` JS + `585 KB` basis once) | same | Well under 80 MB ceiling; `basis_transcoder` bundled once |
| GPU ms per pass (SwiftShader, `ground_045m`) | `534.7 ms` (`518.7 ms`) | **`699.0 ms`** (scene `463.6`, **shadows `8.4`**, post `227.0`) | **`697.3 ms`** (scene `464.8`, **shadows `3.7`**, post `228.8`) | Coarse opaque R7 shadow stand-ins cut Low shadows to `3.7 ms` (−56% vs High) |

- **Exposure calibration & cross-backend parity (960×540):**
  - **18% Grey Calibration Cube (`clearNoon`, `EV100 = 15.41`, WITH live 128² PMREM sky probe `environmentIntensity = 0.55`, `hemiShare = 0.52`):**
    - WebGPU High Noon: top `sRGB [107.5, 102.0, 103.7]`, front `[60.0, 57.0, 59.0]`, lime plaster top `[194.0, 189.0, 187.0]` (matches Stage 1 `107` / `194` within 0.5 sRGB!).
    - WebGL2 High Noon: top `sRGB [107.5, 102.0, 103.7]`, front `[60.0, 57.0, 59.0]`, lime plaster top `[194.0, 189.0, 187.0]` (**0.0 / 255 diff on calibration surfaces!**).
  - **WebGPU High vs Low (`showcase`):** mean abs pixel diff = **`0.39 / 255`** (p99 `4.0 / 255`); **`building`**: **`0.49 / 255`**.
  - **WebGPU High vs WebGL2 High (`showcase`):** mean abs pixel diff = **`0.52 / 255`** (p99 `6.0 / 255`; only animated swordsmen differ in `|diff|×8`, static cottage/oaks/barrels/ground pitch-black!).
  - **Phone emulation (`800×380`, DPR 3 → 2× cap, touch, Low):** `canvas` backing `1600×760` (`effectiveDpr = 2.0`), 4 touch HUD buttons visible (`⟲`, `⟳`, `Pause`, `Menu`), `overflowX = false`, **0 console errors**.
- **Comparison crops & JPEGs (`games/new-game/results/2026-11-19/`):**
  - `stage2-high-low-webgl2-diff8.jpg` (WebGPU High | WebGPU Low | WebGL2 High | `|WebGPU−WebGL2| × 8`).
  - `stage2-lighting-presets.jpg` (Late Autumn 30° | Golden Hour 12° | Overcast 8 klx).
  - `stage2-high-{showcase,building,unit,ground-045m,eye-170m,town,overview,golden,overcast,calibration-noon}.jpg`, `stage2-low-showcase.jpg`, `stage2-webgl2-showcase.jpg`, `stage2-phone-low-hud.jpg`.
  - Raw JSON: `stage2-bench-{high,low}.json`.
- **Bugs caught & fixed by live screenshot inspection (every one verified after fix):**
  1. **Stripped UVs on texture-free & LOD1/LOD2 GLBs (`optimize_glb.mjs`):** `gltf-transform prune()` default `keepAttributes: false` stripped `TEXCOORD_0`/`TEXCOORD_1` from `house_l1_{lod0..2}.glb` (turning the whole cottage into flat metallic iron because `1 - uv1.y = 1.0`!) and stripped `TEXCOORD_0` from `lod1`/`lod2` of `swordsman`, `oak`, and `barrel`. Fixed via `prune({ keepAttributes: true, keepLeaves: true })`, re-exported `house_l1`, rebuilt `lod1`/`lod2` preserving `TEXCOORD_0` + `COLOR_0` + `smoke_0`.
  2. **Upside-down & floating KTX2 distant impostors (`stage2Assets.ts`):** KTX2 uploads with `flipY = false` in Three.js WebGPU, rendering distant cottage & oak billboard quads inverted. Fixed by flipping `PlaneGeometry` V-coordinates (`1 - v`) and adding per-template `impostorBottomSinkM` (`2.05 m` house, `0.35 m` oak).
  3. **Placeholder Stage 1 cubes photobombing close-up portraits & cold yard earth:** Removed Stage 1 placeholder `LandmarkPosts`, warmed packed village dirt (`brown_mud_03`) slightly (`× [1.26, 1.14, 0.96]`), and added explicit `.wasm`/`.glb`/`.ktx2` MIME types in `android/.../MainActivity.kt` for Android WebView compatibility.
  4. **Unit & manifest tests:** Added `tests/lod.test.ts` and `tests/manifest.test.ts` (`17/17` Vitest tests green; `shared-src/` byte-identical).

## 2026-11-19 · Stage 1 — Skeleton, physical renderer, post chain & measurement baseline (base `55c1398`, working tree)

- **Measured how:** Production build (`vite build --base ./`, `940 KB` total) served via `tools/measure/serve.mjs games/new-game/dist 4173`. Headless Chromium (`/usr/bin/chromium`, SwiftShader Vulkan WebGPU + ANGLE SwiftShader WebGL2), strictly one browser process at a time:
  1. `tools/measure/load.mjs --game generic` on High (`&q=high`) and Low (`&q=low`).
  2. `tools/measure/shots.mjs --game generic` (800×450, 8 settle frames) across WebGPU High (ACES & AgX across 4 lighting presets + 4 fixed map/eye views), WebGPU Low (ACES), and WebGL2 High (ACES).
  3. End-to-end verification (`verify-stage1.mjs`): GPU pipeline tracer across all 4 lighting presets, all 9 fixed views, pause menu (`Esc`), active pause (`Space`), and F3 stats overlay; full 9-view benchmark (`?autostart&debug&bench&fast`, WebGPU `--disable-vulkan-surface`) on High and Low; phone emulation (`800×380`, `deviceScaleFactor: 3`, touch, Low).
- **Stage 1 baseline table (Before = no code / Stage 0 → After = Stage 1 skeleton):**

| Metric | Before (Stage 0) | After — High (WebGPU) | After — Low (WebGPU) | Notes |
|---|---|---|---|---|
| Pipelines (total / after load) | — | **20 / 0** (33 shader modules) | **20 / 0** (33 shader modules) | Tracer: **0 new** across 4 presets & 9 spots |
| Draw calls / frame | — | **22–24** (all 9 spots) | **22–24** (all 9 spots) | `info.render.drawCalls` (shadow + scene + post) |
| Triangles / frame | — | **3 298** (`0.003 M`) | **3 298** (`0.003 M`) | Calibration slab, 18% cube, 5 swatches, 20 instanced markers |
| Texture memory (uploaded / targets) | — | **0 MB / 57.9 MB** (27 targets) | **0 MB / 33.9 MB** (27 targets) | 2048² High vs 1024² Low shadow map + HDR/MRT/TRAA/bloom |
| Load (ready / GPU idle, SwiftShader) | — | **3.4 s / 4.6 s** | **3.3 s / 4.5 s** | `[load] total`: 2.23 s High, 2.05 s Low; 0 console errors |
| Production build size (`dist/`) | — | **940 KB** (`263.8 KB` JS gzip) | same | Single bundle (`three@0.186.0` WebGPU/TSL) |
| GPU ms per pass (SwiftShader, `enemy`–`eye_170m`) | — | **534.7 ms** (scene 266.3, shadows 11.1, post 257.3) | **518.7 ms** (scene 261.2, shadows 7.5, post 250.0) | Software GPU ranks runs only; 1024² shadows −32% vs High |

- **18 % Grey Calibration Cube Exposure (horizontal top face under `100 000 lx` Clear Noon, `EV100 = 15.41`, `preExposure = 1.918e-5`):**
  - Theoretical pre-exposed Lambertian horizontal radiance: `L_pre = (0.18 / π) · (100 000 · sin 65° + 18 000) · preExposure = 0.1194` (Frostbite EV100 → ACES linear `~0.122`).
  - **WebGPU High ACES (noon):** top `sRGB [107, 100, 97]` (`lin [0.147, 0.127, 0.120]`), front `sRGB [57, 52, 51]`, lime plaster top `sRGB [194, 188, 182]` (unclipped).
  - **WebGPU High AgX (noon):** top `sRGB [115, 109, 107]` (`lin [0.171, 0.153, 0.147]`), front `sRGB [77, 72, 71]`, lime plaster top `sRGB [172, 167, 163]`.
  - **WebGPU Low ACES (noon):** top `sRGB [107, 100, 97]` (mean abs pixel diff vs High = **`0.30 / 255`**).
  - **WebGL2 High ACES (noon):** top `sRGB [107, 100, 97]` (mean abs pixel diff vs WebGPU High = **`0.11 / 255`**; 0 console errors).
  - **Preset invariance (ACES top face):** Late Autumn (`45 000 lx`, `30°`) `sRGB [114, 98, 92]`; Golden Hour (`12 000 lx`, `10°`) `sRGB [114, 96, 97]` (lit front `[133, 99, 82]`); Overcast (`8 000 lx` sky) `sRGB [96, 96, 102]` (0 bloom halo).
- **Phone emulation (`800×380`, DPR 3, touch, Low):** `canvas` backing `1600×760` (`effectiveDpr = 2.0`), 4 touch HUD buttons visible, `overflowX = false`, 0 console errors.
- **Comparison crops & JPEGs (`games/new-game/results/2026-11-19/`):**
  - `stage1-aces-vs-agx-noon-diff8.jpg`, `stage1-aces-vs-agx-golden-diff8.jpg` (ACES | AgX | `|diff| × 8`; mean abs diff 14.39 noon / 14.13 golden).
  - `stage1-high-low-webgl2-diff8.jpg` (WebGPU High | WebGPU Low | WebGL2 High | `|WebGPU−WebGL2| × 8`).
  - `stage1-high-aces-{noon,autumn,golden,overcast}.jpg`, `stage1-high-agx-noon.jpg`, `stage1-low-aces-noon.jpg`, `stage1-webgl2-aces-noon.jpg`, `stage1-high-{town,overview,ground-045m,eye-170m}.jpg`.
  - Raw JSON: `stage1-load-{high,low}.json`, `stage1-bench-{high,low}.json`.
- **Decisions & fixes caught by measurement:**
  1. **Tone mapper decision (`ACES` kept as default, `?tm=agx` retained):** ACES delivers stronger sunlit-plaster/shadow contrast (`194` vs `172` sRGB on plaster, warmer golden-hour depth) while matching `NUMBERS.md`; AgX lifts deep shadows (`77` vs `57` on oblique noon front) and will be re-evaluated in Stage 4/8 with real textures and fire.
  2. **Fixed r186 `info.render.calls` → `info.render.drawCalls`:** `WebGPURenderer` r186's `info.render.calls` is cumulative across app lifetime; switching to `info.render.drawCalls` corrected benchmark/F3 counts from growing (`378 → 2970`) to exact per-frame (`22–24`).
  3. **Eliminated 404 favicon error, Low shadow acne, and overcast sky bloom bleed:** Added inline data-URI favicon (`index.html`), scaled `shadow.normalBias` (`0.065` at 1024² vs `0.032` at 2048²), raised `bloomThreshold` (`1.85` High / `2.1` Low), and toned overcast sky gain (`1.55–1.65×`).

## 2026-11-18 · Stage 0 — Brief, target look & asset manifest (commit pending)

- **Measured:** None (Stage 0 is design & specification only — no code written yet per `GUIDE.md` §3).
- **Artifacts created:** `games/new-game/BRIEF.md`, `games/new-game/target-look/README.md`, `games/new-game/ASSETS.md`, `games/new-game/RESULTS.md`.
- **Environment check (VM baseline):** Node `v24.22.3`, npm `11.21.2`, Python `3.11.2`, Chromium `/usr/bin/chromium` & `/usr/bin/google-chrome` available; `blender`, `toktx`/`ktx`, `gltf-transform` not preinstalled globally.
- **Decision:** Stop at Stage 0 gate for user approval of brief, budgets, asset sourcing path (Path A user-supplied `marchland-assets` vs Path B clean-room CC0/CC BY downloads), and target-look photographs before writing any code in Stage 1.
