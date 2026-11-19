# Marchland — Measurement & Verification Log (`RESULTS.md`)

> Newest entries first (`GUIDE.md` §1, §6). Every measurement includes date, commit, exact method (script, preset, view, alternating before/after runs), Before | After table (pipelines, draw calls / triangles, texture memory, ready / GPU idle, build size), screenshot comparison crops in `games/new-game/results/<date>/`, and the decision + number behind it. Reverted attempts are logged too.

## 2026-11-19 · Stage 2 — Asset pipeline, Blender 4.2 hero assets, KTX2/Meshopt & live verification (working tree)

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
