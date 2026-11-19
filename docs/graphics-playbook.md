> **Note for a model reading this in the kit:** file paths below point at the
> reference implementation (`field-line/`, `castaway-lagoon/`, `anbow1/tanks`),
> which is not in your folder. The techniques, numbers and traps stand on their
> own; build your own versions to `rules/graphics-quality.md`.

# Graphics playbook — real-time outdoor worlds in three.js (WebGPU + TSL)

Everything the games in this repository do to look good and still run on a
phone, written so another project (or another coding agent) can repeat it step by
step. It is a record of what was built, measured and fixed here, including the
traps that cost the most time.

- **Field Line** (`field-line/`): military FPS — shooting range, city block, pine
  forest ridge.
- **Castaway Lagoon** (`castaway-lagoon/`): tropical bay with a jungle, a beach,
  a survival outpost, weather and time of day.
- **Tanks** (`tanks/`): tank combat on fields, lakes and a village.
- **Contrail** (`contrail/`): jet fighters over 100 km of terrain under a
  physical sky with volumetric clouds.
- **Ridgeline** (`ridgeline/`): an attack helicopter over 20 km of ridges, with
  a cockpit, weapons and a ground force.
- **Paris** (`paris/`): not a game — ten seconds of a boulevard at golden hour,
  rendered frame by frame to a video (§6z3).

All use **three.js r186**, `WebGPURenderer` (falls back to WebGL2 by itself),
**TSL** node materials, strict TypeScript, Vite. They began fully procedural
(no texture or model files, builds of ~1.2 MB). Since then the surfaces a
player's eye rests on took photographed textures (§6o, CC0) and the vehicles,
weapons and people took downloaded or Blender-built models (§6q, §6q2; CC BY
and CC0, credited in `shared/*/CREDITS.md`), so a build is now 20–65 MB; terrain,
vegetation, water, sky and effects are still generated. All of it ships offline
in an APK.

> File references are relative to the repository root. "Lagoon" = `castaway-lagoon/src`,
> "FL" = `field-line/src`.

---

## 0. How to use this document (agent workflow)

Work in this order; each stage has a **Do**, a **Check**, and the **Traps** that
bit us. Do not move on while a Check fails.

1. **Renderer, units, post chain** (§1). Nothing else looks right until exposure
   and colour are right.
2. **Procedural texture pipeline** (§2), then **terrain** (§3).
3. **Sky, sun, environment probe, shadows** (§4).
4. **Vegetation** (§5), **rocks and props** (§6).
5. **Water and shoreline** (§7), if the world has any.
6. **Mobile budget and stutter-proofing** (§8). Do this *continuously*, not at the
   end: the two biggest regressions here (stuck shader compile on phones, hitches
   while walking) came from features that looked fine on desktop.
7. **Verification** (§9) after every feature: tests, a headless screenshot, the
   pipeline tracer, draw calls and triangles.
8. For **flight and vehicle simulators** (kilometres per minute, 100 km views):
   map-scale terrain, baked mountain shadows, GPU forests, sky and clouds (§12);
   cockpits, displays and the HUD (§13); controls and the flight computer
   (§14) — the controls decide whether anyone can fly it.

### 0b. A new game from scratch

The order above is the order to build in. What to have **before the first
feature**, because every later claim leans on it:

1. **The debug contract** the scripts in `tools/measure/` drive (their README):
   `?autostart` skips the menu, `&q=high|low` picks the preset without touching
   stored settings, `window.__ready = true` once the first frames are drawn,
   `window.__debug.place({x, y, z, yaw, pitch})` and `window.__debug.spot(name)`
   put the camera at a view, and loading prints one `[load] <stage>: <seconds>`
   line per stage and a total. With these a new game needs no adapter:
   `--game generic`.
2. **Fixed benchmark views** (`app/bench.ts`, §9.2) and the F3 overlay.
3. **The shared files, copied one to one** from a reference game, never
   rewritten: `render/warmup.ts`, `render/instancing.ts`, `render/perf.ts`,
   `render/benchRecorder.ts`, `render/webgpuCompat.ts`, `core/noise.ts`; later, as
   the game needs them, `render/instanceStream.ts`, `render/impostor.ts`,
   `render/grassField.ts`, `render/rippleField.ts`, `render/ocean.ts`.
4. **A loading budget from day one** (§8.4): run `tools/measure/load.mjs` after
   every feature that adds a material, an instanced mesh, a canvas texture or a
   second camera, and write the pipeline count in the commit.
5. **Assets through the scripts, not by hand**: models through
   `paris/tools/vehicles/prepare_*.py` (§6q2: scale, axes, parts, occlusion,
   texture size, marks painted out), people through `paris/tools/people`, motion
   through `tools/mocap`. A licence line in `CREDITS.md` goes in with the file.
6. **The APK from the first playable** (`android/`, `.github/workflows/android.yml`):
   the phone is where the numbers are real. The workflow publishes main's APKs
   on a rolling release only; a workflow artifact per run filled the Actions
   storage quota after ~120 builds and failed the build at the upload step.

`docs/model-kit/` packs these rules, the briefs and the tools for handing to a
model; `node docs/model-kit/new-test.mjs` lays out a fresh project folder for one
(`--new <name>` for a game the user only describes). The plans built on this
playbook: `docs/new-game-AAA/NEW-GAME-AAA.md` (in Polish: `docs/nowa-gra-AAA/NOWA-GRA-AAA.md`;
each folder is a complete starter to copy: a new game, stage by stage, with the rules of
what brings realism and what must come first: compressed textures, levels of
detail, few shader variants) and `docs/przebudowa-gier-aaa.md` (the same rules
applied to the five games here).

General rules that held up:

- **One height function** for logic and rendering (terrain mesh, collision,
  vegetation placement, water depth). If they disagree you get floating trees and
  water under sand.
- **Physical units everywhere** (metres, seconds, lux, cd/m², kelvin) and
  constants with units in their names (`amplitudeM`, `dryTimeS`).
- **Comment the why**, credit the source of every technique (paper, sheet, repo).
- **Measure, don't guess**: every claim about cost comes from `drawCalls`,
  `triangles`, pipeline counts or timings logged by the scripts in §9.
- **Screenshots are not enough for anything that moves**: take frames seconds apart.

---

## 1. Renderer, light units and the post chain

**Files:** Lagoon `render/stage.ts`, `render/lighting.ts`, `render/exposure.ts`,
`render/colour.ts`; FL `render/stage.ts`, `render/lighting.ts`.

### Do

1. `new WebGPURenderer({ antialias: false })`, `await renderer.init()`. One code
   path; it falls back to WebGL2 when WebGPU is missing (Android WebView often).
2. **HDR scene pass**: `pass(scene, camera, { type: HalfFloatType })` with an MRT
   `{ output, velocity }` (velocity for TRAA).
3. **Post chain** (in `RenderPipeline`, HDR until the very end):
   scene → **TRAA** (every preset; it was High only until phones moved to 2×) → **screen-space sun shafts** → **bloom** →
   **grade** (saturation, vignette) → exposure → ACES tone map → sRGB (the output
   transform, once) → **CAS-style sharpen** (wins back what TAA softens).
4. **Sun shafts** = radial light scattering (GPU Gems 3 ch. 13): march from each
   pixel toward the sun's screen position, but sample **only sky pixels** (depth
   at far plane), so leaves and buildings cut the beams. Strength scales with a
   low sun and clear sky; zero samples on the Low preset.
5. **Physical light**: author the sun and sky in **lux** from a lighting sheet;
   colours from **kelvin**. Multiply every light, emissive and sky value by a
   **pre-exposure** factor derived from the preset's anchor EV100 (Lagarde & de
   Rousiers 2014) so the sun's glint never overflows FP16.
6. **Auto exposure**: reduce the HDR pass to a small luminance grid on the GPU,
   read it back **asynchronously** every 6th frame, histogram on the CPU, keep the
   50th–95th percentile band, adapt bright→dark slowly (~2 s) and dark→bright fast
   (~0.5 s), clamp EV per preset.
7. **Interiors** (FL `render/interior.ts`): a baked "sky visibility" factor per
   building volume scales the sky ambient via the AO channel (indirect only), so
   rooms are darker than the street while sun through windows stays full.

### Check

- A grey card in noon sun meters near the preset's EV; sunset and night look like
  themselves, not like a darkened noon.
- No banding in the sky, no NaN/black pixels at the sun's glint.

### Traps

- Tone-map **once**. Doing sRGB in a material and again in output washes out.
- Each GPU→CPU readback is a sync point on mobile: throttle it (every 6th frame).
- TRAA needs the velocity MRT; objects moved by `positionNode` get velocity
  from three automatically, but custom `vertexNode` materials do not.

---

## 2. Procedural textures (no image files)

**Files:** Lagoon `render/textureSet.ts`, `render/patterns.ts`,
`render/foliagePatterns.ts`, `render/textures.ts`; FL `render/textures.ts`,
`render/patterns.ts`, `render/plantPatterns.ts`.

### Do

1. A **texel sampler** is `(u, v, out) => void` over `[0,1)²` that writes base
   colour (sRGB), height, AO, roughness, metalness and alpha. Everything must tile:
   use periodic noise (`tileNoise`, `tileFbm`) and periodic Worley (wrap cell
   indices modulo the grid).
2. `makeTextureSet(size, sampler, normalStrength, alphaCoverage)` bakes three maps:
   **base colour** (sRGB), **normal** (from the height, Sobel, OpenGL convention,
   linear) and **ORM** (R AO, G roughness, B metalness, linear, `NoColorSpace`).
3. **Alpha cards** (leaves, needles, grass): bake with **coverage-preserving
   mips** (scale alpha per mip so the fraction above the alpha test stays the same)
   or foliage thins to nothing at distance. Give transparent texels the leaf's
   colour, not black, so filtering never draws a dark halo.
4. **Texture arrays for splat terrain**: stack same-size sets into three
   `DataArrayTexture`s (colour, normal, ORM) and sample with
   `texture(arr, uv).depth(int(layer))`. Four layers cost 3 bindings, not 12.
5. Useful samplers written here: sand with ripples and shell fragments, tropical
   grass, leaf litter, coast rock, moss, pine bark, palm bark, jungle bark, palm
   frond, fern frond, grass tuft, broadleaf cluster (ovate leaves with veins and a
   serrated edge), banana leaf, pine needle spray (see §5), surf-foam lace (§7.5).

### Traps

- **16 sampled textures per shader stage** is the WebGPU default and the limit
  on most phone GPUs (SwiftShader allows 32, so headless tests will not catch
  it). A terrain with 4 layers × 3 maps + noise + shadow cascades + environment
  hit 19: on phones the pipeline never compiled ("stuck at compiling shaders") and
  on desktop WebGPU the ground vanished. Count every `texture()` in a material.
- Needle cards made of 1–2-texel strands alias into moiré stripes at range.
  Draw **tufts** (a rounded mass around each twig) instead of strands.

---

## 3. Terrain

**Files:** Lagoon `game/terrain.ts`, `render/ground.ts`; FL `maps/*.ts`,
`maps/terrain.ts`, `render/ground.ts`.

### Do

1. **Height function first** (pure, no three.js): layered fbm, ridged noise,
   explicit landforms (a bay, a channel, islets, a ridge with a saddle), a
   thermal-erosion pass so slopes settle at a talus angle. Logic, collision and
   rendering all call it.
2. **Mesh**: a dense near grid over the play area (1.25–2 m cells) plus a coarse
   far ring out to the fog, with a skirt to hide the seam.
3. **Per-vertex splat weights** (grass, soil/sand, rock, track/litter) from slope,
   a patch noise field, distance to tracks, and **canopy cover**.
4. **Height-blended splat**: lift each weight by that layer's height (texture AO or
   height channel), subtract `max − 0.2`, renormalise: sand fills between stones,
   rock pokes through turf, instead of a mushy linear fade.
5. **Triplanar rock** (sample three projections weighted by `|normal|⁴`) so cliffs
   never smear.
6. **Detail layer** within ~10 m (a high-frequency copy of the dominant texture)
   and **macro variation** (two low-frequency noise lookups at ~200 m) to kill the
   tiling grid at every distance.
7. **Canopy shade and litter** (FL `ground.ts` `canopyAt`, Lagoon `treeShade`):
   sum a Gaussian per tree crown over each vertex; push the splat toward needle
   litter/soil under crowns and multiply the AO (indirect light only — the sun has
   real shadows) down to ~0.55. Grass under a pine stand looks wrong without it.
8. Dirt paths as a splat weight from polylines; wet band / puddles from a wetness
   uniform (rain) and the shoreline model (§7.6).

### Traps

- Put ~10 textures max in the terrain material (see §2 traps).
- The far ring needs every vertex attribute the material reads (we added a
  constant `shade` attribute, or the shader fails on that mesh).

---
## 4. Sky, sun, environment and shadows

**Files:** Lagoon `render/sky.ts`, `render/lighting.ts`; FL `render/lighting.ts`.

### Do

1. **One analytic sky function** (Lagoon): horizon→zenith gradient calibrated to
   the sky illuminance in lux, a Mie glow and warm horizon band toward the sun,
   sun and moon discs, stars, and a wind-driven cloud deck with weather-driven
   coverage. The **same function** draws the dome, lights the environment probe,
   reflects in the water and colours the fog, so horizon, haze and reflections
   always agree. (FL uses Preetham, scaled once per preset — `calibrateSky` — so
   the dome delivers the sheet's sky illuminance.)
2. **Environment probe**: render a small probe scene (the sky dome, plus a ground
   hemisphere lit by sun and sky with a mean ground albedo ≈ 0.2 — the **ground
   bounce** that lifts shaded walls, trunks and soldiers) into a PMREM. Re-bake
   only when the sun moved, the EV changed, clouds or night changed.
3. **Cascaded shadows** (`CSMShadowNode`): split to the real play distance (e.g.
   450 m High / 220 m Low), not the default; 4 cascades High, 2 Low; 2048/1024 px
   (FL) or 4096/1024 (Lagoon); `fade = true`.
4. **Height fog**, integrated along the view ray:
   `τ = ρ₀ · d · (e^(−f·h₀) − e^(−f·h₁)) / (f · (h₁ − h₀))`, coloured by the sky.

### Traps

- **Re-bake PMREM into the same render target**
  (`pmrem.fromScene(scene, 0, near, far, { size, renderTarget })`). A new target
  per bake changes `scene.environment`'s texture object, and every material that
  reads it rebuilds its shader: a hitch on every re-bake.
- **Never toggle `light.castShadow` at runtime** (e.g. "no shadows at night").
  The light set is part of every material's cache key: the whole scene recompiles.
  Fade the intensity instead.
- The probe's sky dome must sit inside the PMREM camera's far plane (we scaled the
  dome to 50) or the probe is black.

---

## 5. Vegetation

**Files:** FL `render/foliage.ts`, `render/undergrowth.ts`, `render/instanceStream.ts`,
`render/meshkit.ts`, `render/plantPatterns.ts`, `render/materials.ts`;
Lagoon `render/palms.ts`, `render/jungle.ts`, `render/undergrowth.ts`,
`render/foliageMaterials.ts`, `render/meshkit.ts`.

### 5.1 Geometry kit (`meshkit.ts`)

- `card(w, h)` — an upright quad, base at y = 0.
- `foldedStrip(spine, sides, halfWidths, foldRad, bendFrom, bendK)` — a strip along
  a spine whose two halves fold down about it: palm fronds, fern fronds, banana
  leaves. Normals bent toward `vertex − bendFrom` so a crown shades as a volume.
- `tube(points, radii, radial, vTileM)` — trunks, stems, vines, ropes.
- `merge(parts)` — strips non-standard attributes and merges.
- `rand(a, b)` — deterministic hash for per-part variation.

### 5.2 Plants built here

| Plant | Construction |
|---|---|
| Pine (FL) | whorls of branch cards from 30 % up the trunk, drooping more lower down; **two cards per branch** (flat + rolled ~70° about the branch) so the crown has volume from the side; a crossed leader on top; normals from the crown axis; a light version (4 whorls × 5 big cards) for distance |
| Coconut palm (Lagoon) | curved leaning tube trunk; folded two-rank fronds arching out and down; two dead fronds; nuts |
| Rainforest tree (Lagoon) | buttressed trunk, limbs, leaf-cluster cards on an ellipsoid shell with outward normals; a cheaper version carpets far hills |
| Broadleaf shrub | 14 leaf-spray cards over a dome, normals from the dome centre |
| Fern / bracken | 8–10 folded fronds radiating and arching |
| Grass tuft | 3 crossed cards, normals mostly up (reads as a lawn, not dark cards) |
| Banana, vines, sprouts (Lagoon) | tube stem + folded leaves; rope tube + leaf cards; 5 tilted cards |

### 5.3 Materials

1. **Alpha-clipped, double-sided** cards, `alphaTest = 0.5`.
2. **Thin translucency** (`MeshSSSNodeMaterial`): the term is added inside the
   direct-light loop and multiplied by the *shadowed* light, so only sunlit
   leaves glow from behind — the golden-hour look. Thickness colour = albedo ×
   (1.1, 1.2, 0.6); distortion 0.25, power 2.5, scale 2.2, attenuation 0.6.
   **Off on the Low preset** (a second light evaluation per leaf pixel with heavy
   overdraw).
3. **Wind**: bake a `sway` attribute per vertex (bend weight ∝ height², plus a
   flutter weight); in `positionNode` (which runs after instancing, so
   `positionLocal` is world space) push along the wind with a slow gust and add a
   faster flutter across it. One wind uniform drives every plant (and in FL also
   the bullets' drift).
4. **Per-instance tint** with `InstancedMesh.setColorAt` (three multiplies the
   material colour by `instanceColor`): crowns a little yellower, bluer or darker
   per tree; grass drier or lusher by a noise patch.
5. World-space UVs for bark on a unit cylinder scaled per tree
   (`uv.y = positionWorld.y / 1.1 m`), or one tile stretches over 20 m of trunk.

### 5.4 Placement

- Trees on a jittered grid thinned by a stand-density field; clear around tracks,
  buildings and rocks; fewer on steep rock.
- Undergrowth by **rejection sampling** against a coarse (4 m) grid of the splat
  weights: grass where the ground is grass, bracken in clumps (`fbm` mask) on the
  forest floor and its edge, nothing on rock or tracks, nothing inside building,
  wall, prop or trunk footprints (binned 16 m grid of oriented boxes).
- Keep plants out of "mown" rectangles (firing lanes, yards) and away from the
  shelter, paths and interactables.

### 5.5 Distance handling (critical for phones)

1. **Two levels of detail for trees**: full crowns within `nearCrownM`
   (110 m High / 60 m Low), light crowns beyond.
2. **Streamed instancing** (`FL render/instanceStream.ts`): **one `InstancedMesh`
   per plant kind**, fixed capacity, refilled from the grid cells around the
   camera whenever the camera enters another cell. Selection is measured from the
   camera **cell centre** with one cell diagonal of margin; the capacity is the
   largest refill any cell (including empty ones) can need, computed at build.
   Far LOD = the complement (`outside: true`) of the near set.
3. **Sink-fade**: small plants sink into the ground over the last ~15 m of their
   draw distance (`positionNode` subtracts `smoothstep(from, to, dist) × depth`),
   so they never pop.
4. **Shadows only from the near ring**: a streamed mesh has no per-chunk culling,
   so every far crown would be drawn into every sun cascade. Near crowns and
   near trunks cast; far ones do not; the baked canopy AO keeps the ground under
   them dark.

Measured on the forest map (SwiftShader, 640×360): 516 → ~130 draw calls,
3.99 M → 3.1 M triangles on High; 87 draw calls / 1.7 M on Low.

5. **Impostors beyond `impostorM`** (`render/impostor.ts`, shared by all three
   games): at load each species is rendered from 8 directions round its vertical
   axis into one atlas, **unlit albedo + alpha and object-space normals through
   one MRT** (`mrt({ albedo: vec4(diffuseColor.rgb, 1), normal: normalWorld·0.5+0.5 })`,
   render-target textures named like the MRT outputs), each species in a row,
   each view in a column, framed by an orthographic camera fitted to the
   species' bounding box (`target.viewport/scissor` per frame, autoClear off).
   At run time **all far trees of all species are one instanced draw**: an
   `InstancedBufferGeometry` quad whose corners are an attribute; the vertex
   node builds the billboard in world space facing the camera horizontally,
   takes the camera's angle round the tree **in the tree's own frame**
   (atan2 − yaw), and passes the UVs of the two nearest baked views plus the
   blend between them, so walking round a tree turns it smoothly. The fragment
   blends both views, turns the baked normal by the instance yaw and lights it
   like any surface (sun, sky, shadows, fog). Refilled on the stream grid.
   **Orientation:** render-target textures are addressed from the **top** on
   both backends (three flips WebGL's to match), so the frame's bottom — the
   trunk — is at the larger v: `row = (species + 1 − corner.y) / speciesCount`.
   Getting it backwards stood every tree past 200 m on its crown for weeks;
   check a forced close-up of the impostors alone, not a forest at a distance.
6. **Dithered hand-over**: over a band `[impostorM − fadeM, impostorM]` the
   meshes keep a pixel where an interleaved-gradient-noise threshold is above the
   fade and the impostor where it is below (`ditherOutBeyond` gives opaque bark
   an alphaTest for this): the two cover every pixel exactly once, and TRAA hides
   the pattern. Both sides use the **same per-pixel horizontal distance**; a
   per-instance distance on one side and per-pixel on the other leaves holes.
7. **Ring streams**: the far mesh LOD is `outside: true, maxM: impostorM`, a
   ring, so meshes stop where the impostors take over. In Tanks, where every
   tree was a full mesh at any range and every one of them fell into three
   shadow cascades, the near set is refilled per 32 m cell (felled trees stay
   meshes wherever they lie, and leave the impostor list).
8. **Hit proxies**: bullets, shells and the knife never test render geometry in
   these games — they test the logic's own colliders (Field Line: a box per
   trunk; Tanks: hulls knock trees through a 16 m spatial hash, shells ignore
   them), which is the cheap "invisible proxy" the high-end pipelines add
   separately. Impostors therefore need no collision of their own.

### 5.6 Grass from real blades (`render/grassField.ts`, shared by all four games)

Grass cards (a few crossed quads per tuft) read as paper on a phone at any
distance under 10 m, and every tuft is its own instance. The shared field
draws **individual Bezier blades**, generated entirely in the vertex stage:

1. **One tile, R2 order.** A 4 m tile holds N blades (700 High / 300 Low in
   the FPS games) in R2 low-discrepancy order (Roberts 2018), so *any prefix*
   of the list is an evenly spread subset. Each blade is jittered within its
   spacing and a two-sine clump field modulates presence and height, so the
   tile never shows rows.
2. **Three rings, three draws.** Tiles are instanced round the camera in rings
   out to 30 %, 65 % and 100 % of the radius (40 m / 24 m). Each ring has its
   own geometry (4, 3, 2 segments per blade) and a `drawRange` of the list
   prefix it can ever need (100 % → 45 % → 20 %). Inside the ring a blade's
   rank is compared with a keep fraction that falls smoothly with distance,
   and blades near the cut shrink over the last 15 % of ranks — no pop. Kept
   blades widen by `1/sqrt(keep)` (never below ~1 px), so coverage holds.
3. **Exact ground height.** The terrain's height grid goes up as an R32F
   `DataTexture` read with `textureLoad`, and the vertex splits each cell into
   the same two triangles the terrain mesh uses (`split: 'bc' | 'ad'`), so no
   blade floats or sinks on a slope. Bilinear sampling is visibly wrong here.
4. **Density map.** An RGBA8 grid per game — meadow, beach grass, sedge, shade
   — decides presence, kind (height, lean, colour) and darkening under trees.
   It is zero in water, on roads, under buildings and wherever the logic says
   the ground is mown or blocked; the game bakes it once at load.
5. **Shape and light.** Width tapers to the tip, the Bezier control point
   leans by kind and by a travelling wind gust (`uWind`, `uTime`); the shading
   normal is 60 % straight up and 40 % the blade's own face normal, so a field
   lights like ground with texture instead of flickering blade by blade, and
   colour darkens toward the root (`mix(0.6, 1, sqrt(t))`) — that dark base
   is what sells depth from above. Blades are two-sided.
6. **Trampling.** A 128² × 0.3 m map, re-centred on the player in whole
   texels, stores a push direction and strength per cell;
   `stamp(x, z, r, dirX, dirZ, strength)` is called for the feet each frame
   (bigger when prone), for hulls in Tanks and with a 4 m radius for
   explosions; cells decay back exponentially over a few seconds.
6b. **Wind from a point** (`blow`): a rotor's downwash or a blast lays the
   blades outward over a disc and sets them thrashing (A channel of the
   trampling map, decaying in 0.35 s). Held, not accumulated: call it every
   frame while it blows. Ridgeline drives it from the rotor (§12.6).
6c. **Functions instead of grids**: the ground height and the density may be
   TSL functions of the root (`GrassGroundNode`, `GrassSurfaceNode`), and the
   density function may return the ground's colour for the blades to take.
7. **Per-game scale.** `widthScale`/`heightScale` and the colours are options:
   Tanks views the ground from 3–10 m up, so its blades are 3.2× wider, 1.3×
   taller and brighter (thin blades at that range alias into stripes darker
   than the terrain under them), and `leanScale: 1.9`: upright blades seen
   from a turret project as parallel vertical strokes, a meadow of corduroy.
8. **Bare patches fade in, the grass thins first.** A worn patch whose soil
   weight steps in over a narrow band, with fine noise on the rim, reads as a
   stain; widen the band, keep the noise low, and let the blade density fall
   off slightly before the soil shows. Dry topsoil is grey-brown, not rust.
9. **Mown ground is a lawn of short blades**, not bare texture (a texture
   alone tiles visibly down a firing range): a second kind 5–10 cm tall.

Cost measured with the bench (§9.2): about +0.5 M triangles and 3 draws in
Field Line; in Tanks +0.1–0.4 M.

### Traps

- **`NodeMaterial.copy()` never calls `Material.copy()`** (r186), so `clone()` loses
  `alphaTest`: cloned foliage draws every card as a solid quad. Restore it
  (`cloneMaterial` in FL `render/materials.ts`).
- **`alphaToCoverage` without MSAA** disables the alpha-test discard in three:
  cards draw solid. The renderer uses TRAA, not MSAA, so leave it off.
- **Every `InstancedMesh` gets its own shader build** (three keys instanced meshes
  by `uuid`). Hundreds of per-chunk meshes = a shader build each time a new chunk
  first comes into view = a hitch every few steps on a phone, plus a draw call per
  chunk per cascade. Use one mesh per kind (§5.5.2).
- **Pre-compiling an empty instanced mesh** (`count = 0`) left its pipeline
  never ready: the plants drew in the shadow pass but never in the main pass.
  Fill streams at the spawn point before the warm-up frame (§8.3).

---

## 6. Rocks and props

**Files:** Lagoon `render/rocks.ts`, `render/props.ts`; FL `render/props.ts`,
`render/materials.ts` (`boulder`).

- **Boulders**: an icosphere (detail 5) pushed out by two layers of fbm on the
  unit direction, one or two flat facets, flattened where it sits in the ground,
  **welded** (`mergeVertices`) before `computeVertexNormals` so it shades smoothly.
- **Triplanar** rock colour and ORM (`triplanarTexture`), **moss on upward faces**
  (`smoothstep` on `normalWorld.y` broken up by a blotch texture), **bump** from
  the height (`bumpMap`), darker and glossier when wet; in the lagoon an always-wet
  surf zone and algae below the waterline.
- Props: share materials through a cache (`shared(key, make)`); build hidden
  "gallery" copies of anything that can appear later (ammo box, food, flare) so
  the warm-up compiles them (§8.3).

---
## 6b. First-person rendering (FL)

- **Viewmodel in the world scene, scaled down about the eye** (`VM_SCALE`): the
  picture is identical but the gun sits inside the player's capsule, never pokes
  through walls, receives the sun's cascades (step under a roof → it falls into
  shadow) and takes the interior ambient factor.
- **Real optics**: the red dot is drawn on the sight's rear glass where the eye ray
  is within the dot's angle of the optic axis (collimated: parallax behaves like a
  real one). The scope renders a second camera into its own target, shown on the
  ocular with a first-focal-plane reticle, a shadow ring and an exit-pupil
  penalty when the eye leaves the axis. Render the scope only after the main view
  has compiled once (the sun cascades bind to the first camera that renders).
- **Arms** (Lagoon `render/arms.ts`): articulated hands on two-bone IK from fixed
  shoulders, so hands never float.
- Static world boxes merged per material with world-space UVs (continuous brick
  across pieces); breakable glass instanced one per pane.

---

## 6c. Hard-surface props and characters (FL cars, weapons, soldiers)

Boxes read as toys at any distance; what reads as "real" is the silhouette, the
edges that catch light and the small parts people expect.

- **Cars as lofts** (`render/carModel.ts`): rounded sections every ~10 cm from
  bumper to tail (eased between a handful of key stations: half width at sill
  and shoulder for tumblehome, sill and waist heights, corner radius), the sill
  lifted into a **wheel-arch tunnel** over each axle (a narrow floor fills it
  between the wheels). The greenhouse is a second loft that narrows to the roof
  and rises along the windscreen rake. **Sort every quad into a part by where it
  sits** (paint, glass, black trim: seals, B-pillar, door shut lines, sills) and
  put a ring exactly on every boundary: shut lines and window edges become real,
  crisp mesh edges. Lamps, grille, intakes and plates are **patches laid on the
  skin** (march in from the end until the section contains (x, y), bisect, lift a
  few mm), so they wrap round the nose flush; boxes stuck on stand off it. Lathed
  tyres (rounded sidewall) and a five-spoke rim. ~10 k vertices per car; two
  body variants by a hash of the parking place; one InstancedMesh per part.
- **Weapons** (`render/weaponModels.ts`): side profiles as `ExtrudeGeometry` with
  a 1–4 mm **bevel** (every edge gets a highlight), trigger guards as shapes with
  holes, turned parts as lathes (barrel steps, muzzle device, scope bells),
  rail teeth every 10 mm, a slotted handguard, and holes (ports, slots, flutes,
  serrations, knurling) as a near-black "cavity" part — it reads as depth.
- **Characters** (`render/actors.ts`): rigid segments (pelvis, torso, head, upper
  arm, forearm, hand, thigh, shin, boot, rifle), one InstancedMesh each, both
  sides in the same mesh (two instances per soldier). Pose per frame: stance sets
  hips and spine to the hitbox layout; the rifle butt sits in the shoulder pocket
  along the aim; **two-bone IK** brings the hands to the grips (elbows out) and
  the feet to a stride (knees forward); the torso is **bladed ~35°** so the
  support hand reaches the handguard. One material for all kit: per-vertex colour
  plus a kind (hard / plain fabric / camouflage) that sets roughness, sheen and a
  procedural four-colour camouflage in segment space.
- Never mirror an instance with a negative-determinant matrix: instanced draws
  pick the front face per mesh, not per instance, so the mirrored copies render
  inside out. Build paired segments symmetric instead.

---

## 6d. A city at night, and rooms behind the windows (FL)

- **Street lamps** (`render/cityLights.ts`): physical units throughout (lamp
  ~2500 cd with a cut-off profile, lens ~9000 cd/m², EV 1.5). The few lamps
  nearest the camera are real `SpotLight`s (they light characters and draw the
  highlights on wet asphalt); every other lamp lights the ground through a
  half-float irradiance map baked once at load (0.5 m texels). The shader
  subtracts the near lamps' share with the bake's own formula, so no surface is
  lit twice. Everything night-only sits behind `If(uniform)`: switching day and
  night never recompiles (mind the variable trap in §11).
- **Interior mapping** (`render/roomInteriors.ts`, van Dongen 2008): for a pixel
  of clear pane the view ray carries on into a room one bay wide, one storey
  high and a few metres deep; the nearest of the three planes it is heading for
  gives wall, floor or ceiling. Add one piece of furniture (a rectangle in front
  of the back wall), curtains just inside the glass, a ceiling light (Lambert +
  inverse square + bounce) lit in a hashed share of rooms at night, and daylight
  through the window by day (~5 % of the outside light, falling off inwards).
  The pane mask is the façade texture's own roughness (clear glass is the
  glossiest texel), so blinds and frames stay as drawn. Past ~60 m fade to the
  room's mean or sub-pixel rooms sparkle. Needs a per-vertex tile size (bay ×
  storey in metres) to turn UVs into metres.

## 6e. A city by day: architecture, street and wear (FL)

What made the city read as a model, found by a screenshot tour of every kind
of place (street, façade close up, junction, car park, roof view), and the fix
for each:

- **Scale of the wall texture.** A façade texture covers one bay × one storey,
  so a brick sampler written for a metre tile drew bricks 0.8 × 0.25 m. Count
  the real units per tile instead (`brick(…, 13, 38)`: a course is 65 mm of
  brick and 10 mm of mortar, ~38 to a 3 m storey) and give such tiles 1024 px.
- **Windows cut by corners.** World-anchored UVs put a window's edge wherever
  the corner happened to fall. Fit a whole number of bays per face (the bay
  stretched to fit) and start u at the face's corner; make each building whole
  storeys tall plus a parapet zone (`fitStoreys`).
- **Relief, as geometry** (`render/facadeTrim.ts`): plinth, string course over
  the shops, cornice (frieze, bed moulding, corona overhanging 0.32 m: the
  shadow line under it is what the eye reads), parapet above the roof with a
  coping, stone sills and hoods at every upper window, roof plant (stair
  housing, AC units, vents, chimneys). Bands on two faces fill the corners and
  stop against them on the other two, so no faces overlap and fight.
- **Shops on the ground storey** (`render/shopfront.ts`, in the façade shader):
  glazing on a stall riser, transom, a painted fascia with "lettering" (strokes
  on a 3 × 5 grid per character: reads as a name, says nothing), roller
  shutters; awnings as geometry. Shops keep their lights on by day.
- **Glass.** A near-white albedo at low opacity reads as frosted plastic in
  sun. Glass albedo is ~0; let alpha follow Schlick (≈15 % face-on, most of it
  grazing) so the room shows face-on and the sky at an angle. Tilt each pane a
  fraction of a degree (hash per pane) so a wall of windows does not mirror one
  grey.
- **The road** (`render/cityRoad.ts`): darker, smoother wheel paths per lane;
  patched rectangles with a sealed seam; bitumen-filled cracks; oil in the
  parking lane; manholes and kerb gullies — all in world metres, so nothing
  repeats with the texture. Markings: zebra and stop line at each approach,
  paint worn through in patches.
- **Overhead and at the corners** (`render/streetFurniture.ts`): span wires
  from wall to wall with pendant lamps, signals on each approach, one lens lit
  at real LED luminance (~9000 cd/m², visible at noon).
- **Haze.** A clear day over a city is ~15 km visibility (β = 3.9 / V ≈
  2.6e-4 /m); at 6e-5 the far blocks had the contrast of near ones.
- **Windows set back in the wall** (`render/facadeReveal.ts`): frame and glass
  sit ~13 cm behind the face. Per pixel of the opening, follow the view ray to
  the glass plane (`f + (v·right, v.y) / (−v·n) · depth / tileSize`); sample
  frame and glass there, and where it lands outside the opening the ray hit the
  reveal: draw the wall's own texture with the jamb's or head's normal. Trace
  the sun the same way back from the glass to the face for the head's and the
  jamb's shadow. Sample with `.grad(dFdx(uv()), dFdy(uv()))` so the jump at the
  edge does not throw the mip level. Without it, windows read as printed on.
- **Car colours like a car park**: mostly white, black, greys and silver, then
  blues and reds (repeat entries to weight them). A row of every-colour cars
  reads as toys; one colour everywhere reads as a bug (it was: §11).

## 6g. Ground and plants up close (FL forest, found by a screenshot tour)

- **Litter, not weave.** Two anisotropic noises crossed at 90° read as knitted
  carpet; one stretched noise reads as brushed metal. Scatter short straight
  fibres per cell in random directions (each texel checks its 3 × 3 cells) for
  dead grass, fallen needles, straw.
- **Reed beds** are stems of uneven height with arching leaves and plumes on
  cards of different heights in a fan; equal cards with a meadow-tuft texture
  read as blocks of hedge in the water.
- **Leaves at the lens.** Dither leaf cards out within ~0.85 m of the camera
  (screen-space hash against a distance ramp, TRAA smooths it); the shadow
  pass sees them from the light, so shadows keep every leaf.
- **The far ring wears what the map wears.** Hills beyond a forest map need a
  canopy material (dark crowns in colour and bump, clearings); on the meadow
  splat they read as grey domes in the haze.
- **Litter on the floor**: cones, twigs, a fallen branch now and then, streamed
  round the camera; without them a forest floor reads as bare earth.
- **Cap cut and fill** where a road is pulled to a grade: a smooth target
  surface far below the local ground carves a trench along the whole road.
- **Turf the same way** (lagoon `patterns.ts` `tropicalGrass`): blades in
  random directions over dark soil, straw in dry patches, sand where bare.
  And **no turf under a canopy**: move the grass weight to leaf litter where
  the baked crown shade is deep.
- **A conifer floor is a mat, not earth** (FL `patterns.ts` `needleLitter`):
  needles cover nearly all of it in layers drawn top-down (fresh rust ones,
  sparse, over browns over dark rotted ones; stop at the first layer that
  covers a texel), twigs and egg-shaped cones with a scale lattice. Nothing
  a metre across in the tile: moss patches repeated with the 2.5 m tile and
  read as a lattice of green blots from ten metres on — anything that large
  belongs in a world-space mask, not the tile. Clods with a few needles
  read as bare tan dirt from standing height. Preview a sampler by dumping it
  to PPM in a throwaway vitest before building.

## 6f. Explosions in layers, and debris that stays (FL)

Learned from a study of *hood-warfare* (a three.js FPS): one effect per layer.
Flash core and a light that dies as `k^1.6` with flicker over ~0.4 s; fireball
billows whose colour follows a cooling ramp (white-yellow → orange → dull red,
brightness ∝ heat^2.2); a dust-and-smoke cloud following 30–150 ms later, lit
orange from inside while young (`emissive ∝ glow`), rising and thinning; a
dust ring thrown flat along the ground; solid chunks on ballistic arcs that
bounce, settle and stay (`render/debris.ts`); embers; a scorch decal with a
ragged, streaked edge. Billow sprites are not discs: two octaves of noise push
the edge in and out, and a rounded view-space normal lets the sun shade the
puff (`render/particles.ts`). Put ground debris on the real surface under it
(pavement, kerb, roof), not the terrain height.

## 6k. A trodden beach (lagoon `render/footprints.ts`, `render/wrack.ts`)

From the beach in *Tidewater* (an AI-made three.js fishing game): sand reads as
a real beach when it is not clean.

- **Footprints** as lit decals, not darkening: a dark layer is lost in the wind
  ripples' own contrast. Each print is a small quad on the ground (normal from
  the terrain, turned to the heading) whose shape is a signed distance in the
  shader — bare foot (heel, arch, ball, five toes, mirrored for the right), a
  tiger's pug (lobed pad, four toes), a boar's cloven hoof with dewclaws. Inside:
  flat disturbed sand without ripples, a little darker; walls: the normal tilted
  toward the middle from the outline's gradient (central differences, 2 mm);
  outside: a pushed-up rim tilted out. A standard material (receives shadows), so
  the sun and the palms shade the dents like the beach. Wet sand: sharper edge,
  darker, glossier, gone in 30 s (the swash); dry: soft, four minutes. One per
  step, alternately either side of the track; animals leave theirs too.
- **The wrack line**: seaweed (flattened lumpy blobs), shells, bleached twigs,
  coconut husks in uneven heaps along the top of the swash (bisect the shore
  distance along rays from the lagoon's middle), never a tidy row.
- **Dune grass in tufts**: lone blades at low density look like hairs stuck in
  the sand; switch on single density cells at half density instead (a tuft per
  cell), a metre or more apart.

## 6j. A machine that reads as used, not a clean model (Ridgeline Warden, both flight games)

From the STRIX helicopter scene (an AI-made three.js demo): its realism is the
number of parts and the grime between them, not any single material. What
changed the Warden from a toy to a machine, in order of effect:

- **Real albedo.** Military greens are ~#434A35 (linear ~0.055), not black-green:
  darker paint swallows every seam, panel and stain. Check the paint against a
  reference before adding detail; satin (roughness ~0.7) not dead matte, so the
  sky's sheen shows the shape.
- **Grime where the airflow and the rags do not reach**: the baked per-vertex AO
  (`aoBake.ts`) darkens the albedo itself (×0.6 warm grey in cavities), not only
  the indirect light.
- **The wash**: a soft band ~3 cm either side of every seam and access-panel
  edge (`panelPattern().wash`). The 3 mm seam is under a pixel at ten metres;
  the band shows the panel layout. Uneven (noise ×0.75…1.1).
- **Wash-down streaks** on the sides (noise stretched vertically, horizontal
  coordinate z on the sides and x fore and aft), **warmer, darker undersides**
  (oil mist, exhaust film, dust), **soot behind side exhausts** on the upper
  sides only (`sootPatch`).
- **Parts**: sensor housings with several coated windows (near-black glass,
  gold specular), missiles with seeker domes, bands, wings and fins, a rocket
  pod's honeycomb of tubes (a shader on the end cap), flattened exhaust ducts
  turning out, antennas, wire cutters, position lights, an IR jammer, flare
  dispensers, steps, rounded tyres with hub caps and bolts. Each is cheap; their
  number is what reads.
- **Shape**: noses and avionics bays are boxes with rounded edges, not
  ellipsoids (flat crown and belly, near-vertical sides in the loft stations).
- **Contact occlusion** (`contactShadow.ts`): a soft ellipse under the parked or
  low aircraft multiplies the terrain's and grass's `aoNode` (sky light only),
  fading over the first 7 m of climb. It is the dark core under the craft that
  pins it to the ground.

## 6i. Headlight beams in the air (lagoon `render/lightBeams.ts`)

Also from *Halcyon* (its landing lights in the haze). A beam is light scattered
toward the eye along the view ray, so integrate exactly that:
`L = ∫ σ(y)·p(θ)·I(ω)/r²·e^(−σt) dt`.

- **Proxy**: one cone mesh per vehicle, back faces only, no depth test, additive.
  The back face is the far end of the ray's path through the cone; the scene
  depth (a copy in the buffer's own format, §11) cuts it where something solid
  is in front, so the beam stops at the ground and never draws over the bonnet.
- **Lamp**: a low beam, not a round spot: ±24° wide, a sharp flat top just above
  the axis, softer below, aimed ~4° down. Candela from the light's own setting.
- **Phase**: two-lobe Henyey–Greenstein (0.8 × g 0.7 + 0.2 × g −0.3): bright
  halos looking into the lamps, and from the driver's seat the beams still show.
- **σ**: the stage's fog + 0.0018 /m of humid floor + 0.02 × rain, falling with
  height like the fog. In physical units nothing fades by time of day: a few
  nits vanish at noon and make a bright fan at night.
- 14 samples bunched toward the camera (`t ∝ u²`; from the driver's seat the
  near metres are brightest), jittered with interleaved gradient noise per
  pixel and frame; TRAA averages it. Off = scale the proxy to nothing (no
  fragments, no recompile).

## 6m. Side by side with reference scenes: what still separated us (round 3)

Three clips compared shot for shot with our own: a tropical-island shooter
(sand, deck, shallow lagoon), a three.js river valley at dawn and in rain
("Sakura River"), and a browser city seen from the rooftops. What they had
that we lacked, and the fix:

- **Clear shallows, not a white ring.** Our lagoon's shore wore a solid white
  band. A debug build with the water's foam multiplied by 0 proved it was all
  foam: every breaker, however small, laid a full roller and trail. Scale
  whitewater by the breaker's amplitude (none under ~2.5 cm, full from 10 cm;
  a ripple spills with a glassy lip), lighten the trail, keep the waterline a
  thin broken lace. *Isolate a suspect term with a throwaway ×0 build before
  tuning it.*
- **Hillsides grown over.** Bare rock from 37° and a canopy paint that skipped
  steep ground made the bay's hills brown scree between trees. Inland,
  vegetation holds to ~60°; rock only on true cliffs. Past ~20–45 m from the
  eye, paint the floor between modelled trunks as understory (in a jungle it
  is hidden by shrubs); keep that paint off the floor near the eye.
- **Mist that lies on the water.** A dawn that thickens the whole air only
  greys the picture. Add a second exponential layer ~2 m thick at the water
  level (same analytic ray integral as the haze), broken into drifting
  patches by noise, and keep the hills clear above it. Confine a lake's mist by
  the *ray's* point nearest the lake centre, not the fragment's, so a view
  across the water to the far bank's trees picks it up (FL `lighting.ts`).
- **A skyline to the horizon.** A city map that ends at its closing façades
  reads as a film set. One instanced draw of ~200 boxes from 260 m to 1.5 km,
  taller toward one quarter, in a curtain-wall shader (tinted pane per bay ×
  storey, each tilted a fraction of a degree so the wall reflects many skies,
  mullions, spandrels) or stone with punched windows, lit windows at night, no
  shadows; the scene haze sets them back (FL `render/skyline.ts`). Lit
  windows at a kilometre are a room's light, a few cd/m² pre-exposed: at
  60 the towers turned to white blocks at night. Average the window grid by
  its pixel footprint (`fwidth` of the cell coordinate) or lit windows under
  a pixel flicker as static.

## 6n. Detail density: what the reference's close-ups had (round 3, second pass)

The island shooter's close-ups (jeep, skiff, deck, table, jetty, bushes) are
not better *shaped* than ours; they are *fuller*. Every object carries the
evidence of use and the small parts a real one has. The checklist we worked
through, in the order it paid:

1. **Wear on every machine** (lagoon `render/wear.ts`, one function for all
   painted vehicles, in the model's own frame so nothing slides as it moves):
   rust blooming from the lowest edges, paint chipped to primer and a few
   flakes of bright metal, rain-run streaks down the sides. Options set what
   blooms low: rust on steel, grey-green scum on an aluminium hull.
2. **Contact shadow inside the model**: the per-vertex AO bake (§12.5) on the
   jeep and the skiff, once at load (~0.4 s for 100 k vertices). A material is
   wired only if *every* mesh using it is baked: give a vehicle its own
   instance of a shared prop surface (`vehicleMaterial()` in
   `propMaterials.ts`) instead of the camp's.
3. **Boards are not boxes.** Ease the arrises (a rounded box with one bevel
   segment, ~7 mm): a hard box edge catches no light, and a deck or tabletop
   reads as one slab. Then nail heads where boards cross what holds them,
   each board a few millimetres proud or shy and turned a few hundredths of a
   radian, every fifth board a different stock. Bleach a jetty's boards
   almost grey with dark checks in the grain.
4. **The tide's mark.** Piles standing in the sea are wet, black-green up to
   a ragged high-water line and ringed with barnacles and dried salt where
   the waves break (`pileMaterial()`, by world height). That band says "jetty"
   more than any wood texture.
5. **How it is held together.** Rope lashings where beams sit on posts and
   where stringers meet piles, rope rails sagging from pile to pile, battens
   and stretchers under a table and a shelf of boards between its legs.
6. **What a used vehicle carries.** A skiff: rolled gunwale rail, spray rail
   on the chine, ribs and floorboards, a fuel tank piped to the outboard, oars,
   a coil of line. A jeep: a crate strapped down, a kit bag, a second can,
   canvas seats. Each is a few rounded boxes and tubes.
7. **Leaves each their own.** A cluster texture whose leaves share one shape
   and one ladder of bright veins reads as clip art up close. Give each leaf a
   curved midrib, one half wider than the other, a waved margin, faint
   *sunken* veins sweeping toward the tip, mottling, and an age: a few
   yellowing, browned at the margin and tip, holed by insects (lagoon
   `broadleafCluster()`).
8. **No two buildings alike.** One façade texture over a whole city is the
   tell. A per-building seed attribute picks the wall tint, the frame colour
   and louvred shutters on a share of the upper storeys (FL `materials.ts`
   `buildingVariety()`, `worldMesh.ts` `facadeSeed`).

Check each with a close-up screenshot from where the player stands, not from
a flattering distance: details that do not survive 2 m do not count.

## 6o. Scanned textures (lagoon `render/photoTextures.ts`, FL `render/photoTextures.ts`)

Noise does not make bark's plates, sand's grains, a brick's chipped arris or a
dirt track's stones. A photograph does. Free, CC0, measured scans:
**Poly Haven** (`api.polyhaven.com/files/<id>` lists the files; downloads from
`dl.polyhaven.org`, give a `User-Agent` or get 403) and **ambientCG**. Credit
them anyway in `assets/photo/LICENSE.md`.

- **Prepare offline** to 512 px (ground, walls) or 1024 (bark colour): colour,
  normal or height, and Poly Haven's `arm` map, which is already our ORM layout
  (AO, roughness, metalness). Record the scan's real size (`dimensions_mm`).
- **Decode, do not just load** where the set must look like a generated one:
  `fetch` → `createImageBitmap` → `OffscreenCanvas` → `getImageData`, rows
  flipped (an image's first row is v = 1; a normal map read upside down
  inverts its green). The lagoon packs the pixels into `DataTexture`s
  (`textureSetFromPixels`), so the ground's array textures take them
  unchanged; FL reads them through a `TexelSampler` (`photoSampler()`), so
  `makeTextureSet` derives the normals from the scan's height like any
  pattern.
- **Load before the first material** asks for one, in the view's `create()`
  before anything is constructed: a constructor that builds a boat or a jeep
  builds its materials too ("requested before loadPhotoTextures() finished").
- **Real size, whole repeats**: one tile = the scan's metres (`PHOTO_SIZE_M`),
  and where a tile is fixed (a façade bay × storey) a whole number of photos
  per tile, so it still tiles. **Match the colour** where the scan's albedo is
  not the look's (`photoSampler(id, u, v, 0x8f8b85)` scales its mean to the
  palette, keeping its detail).
- **Boards**: cut single planks from the photograph and give each a quarter of
  the texture, turned to run along U (normal `(nx, ny) → (−ny, −nx)`), then
  pick a quarter per board in the UVs: every board its own stock.
- **Budget**: a 512 px set is ~4 MB of GPU memory (three RGBA maps with mips); the four FL sets add
  ~0.8 MB of JPEG to the APK. Array textures keep the ground shader inside
  16 bindings.
- **Cloth as detail** (lagoon `propMaterials.ts` `fabricMaterial`): a tarp's
  stains, fading and seams are its own, one UV square over the whole sheet; the
  weave is a photograph (Poly Haven's Rough Linen, a tight plain weave) tiled
  at its real 27 cm on a second scale of the same UVs (`repeats = size_m /
  0.27`). Pack it as one detail map — albedo luminance over its mean × 0.5
  (linear) in R, roughness in G — so the material multiplies its colour by
  `1 + (2R − 1)·k`, and blend the two normal maps whiteout-style
  (`(n1.xy + n2.xy, n1.z·n2.z)`). A sine weave reads as a printed grid up close.

## 6p. A red dot that behaves like one (FL pistol, lagoon AK; `render/optics.ts`)

A reflex sight is collimated: the dot sits at infinity, so it stays on the
target while the eye moves behind the window, and it is only visible through
the glass. Draw the window as a transparent plane whose shader lights the dot
where the **view ray is parallel to the sight's axis** (angle between
`positionViewDirection` and the axis < radius), not a dot glued to the glass.
Update the axis every frame from the optic's world quaternion (after the
viewmodel's matrices); size the dot by angle (~2 MOA) with a floor of one
pixel's angle (`fov / height`), or it vanishes at phone resolution. Aiming puts
the eye on that axis (`sightY`, the dot's height over the bore), so
ADS looks through the window, not over the irons.

## 6l. A light on the weapon, and a bodycam lens (FL `render/weaponLight.ts`, `render/bodycam.ts`)

After the bodycam shooter "Block 17" (an AI-made browser game): indoors and at
night the weapon light *is* the picture — a hot spot, a soft spill, hard
shadows from the muzzle, the beam hanging in the dust.

- **Physical units.** A ~1000 lm tactical light puts ~22 000 cd in its hot spot
  (`SpotLight` intensity × pre-exposure, cone 0.36 rad, penumbra 0.78); FL uses a
  ~700 lm class, 15 000 cd, so a wall a metre away is not burnt white before
  the eye adapts. At noon
  it barely shows; at night it carries the frame; nothing to tune per preset.
- **Never add, remove or re-shadow a light at run time**: every material's
  lighting changes and recompiles (seconds of hitch). Create it before the
  shader pre-compile, toggle only its intensity; off, shrink its shadow
  camera's far plane to a few centimetres so its shadow pass draws nothing.
- **The beam near the eye.** The lagoon headlight integrator (§6i) for one round
  lamp; but the lamp is half a metre in front of the camera, and as a point
  source there I/r² whites out the middle of the view. Start the march ~0.7 m
  out, fade the beam in over its first 1.5 m (it is centimetres wide at the
  reflector), floor r² at ~0.36, and weight the back lobe low: from behind the
  lamp the eye sees forward scatter. Keep the spill at a few per cent of the
  hot spot, or it hangs as a glowing bank.
- **Bodycam lens** (a setting, not the default): render wider (88° vertical),
  then resample with a barrel term (`q · 0.8 · (1 + 0.34 r²)`, aspect-corrected),
  lateral colour growing with r², black outside the frame and an oval
  housing shroud, sensor grain multiplicative plus a floor scaled by
  1 / exposure (read noise is fixed on the sensor), a flatter colour.

## 6q. Photoscanned models (lagoon and FL `render/scanModels.ts`)

Poly Haven publishes CC0 scanned rocks, stumps, trunks and plants as glTF
(`api.polyhaven.com/files/<id>` → `gltf` → `1k`, files on `dl.polyhaven.org`).
They are 12–100 k triangles; a phone wants ~1–2.5 k per instance.

- **Simplify across UV seams.** A scan's UV atlas is hundreds of small islands:
  every island edge is an attribute seam, and a seam-respecting simplifier
  stalls (66 k → 54 k). meshoptimizer's `simplifyWithAttributes` with the
  `Permissive` flag collapses across seams where the UV and normal error stays
  small (weights ~2 on UV, ~0.3 on normals, error 0.05): 66 k → 1.6 k with the
  texture still on the right lumps. The scan's normal map carries what the
  triangles lost. Keep meshes already under the target whole (a fern's
  leaflets do not survive a cut).
- **Check the cut against the original** side by side before it goes in (a
  three.js page loading both, rendered headless): it caught a flipped V.
- **Normalise for placement**: rocks to a horizontal half-extent of 1 with the
  base at y = 0 (a placement then scales them in metres and buries a quarter of
  their height), plants and logs kept in metres. A compact `mesh.bin`
  (positions, normals, UVs, u16 indices) needs no loader in the game.
- **Grade a scan to its setting**: an ochre sandstone among pines read as
  golden lumps; half the saturation at 80 % gain made it granite.
- **Budget**: 1024 colour and normal, 512 ORM for anything the player walks up
  to, 512 for stones; ~0.5–0.8 MB of JPEG each. Count instances × triangles:
  2600 scanned ferns would be millions, so scans go where the player spends
  time (round the camp) and cards stay on the hills.

## 6q2. Downloaded vehicle models, step by step (`paris/tools/vehicles`, `shared/vehicles`)

Every downloaded vehicle so far (Tanks lorries, the Warden and Bulat, the
Wraith and Talon, the lagoon cutter and skiff, the lagoon jeep) went in by the
same ten steps. The scripts' own options are in `paris/tools/vehicles/README.md`.

1. **Licence first.** Only CC BY or CC0 (Sketchfab: *Downloadable*, *CC
   Attribution* / *CC0*; Poly Haven). NC, ND or "editorial" licences are
   reported to the user, not used. Sketchfab needs a login, so the user
   downloads the glTF zip and uploads it.
2. **Unpack as untrusted data.** Each zip into its own new, empty directory in
   the scratchpad; scripts live elsewhere and get paths as arguments; any Python
   that reads the files runs with `-I`. Read `license.txt`: title, author, URL,
   licence go into the credits in step 7.
3. **Read the glTF before Blender.** Nodes, meshes, materials, triangles per
   primitive and position bounds (a 30-line JSON dump): the units (cm models
   are ~100× too big), which axis is up and which is forward, whether wheels,
   rotors, the gun or control surfaces are separate parts or baked into one
   mesh, glass materials, and helpers (a material-less icosphere made the Mi-28
   twice its height in the bounds).
4. **Paint out real markings.** Look at every base-colour atlas (whole, then
   crops) for stars, roundels, numbers, maker's badges and lettering, number
   plates, trade-dress grilles. `scrub_marks.py --circle x,y,r --rect
   x0,y0,x1,y1` refills each region from the paint round it (slow variation from
   the blurred surroundings, grain from a clean patch: `--grain-from dx,dy` or
   `--grain-patch`); `--bright` replaces only stencil texels lighter than the
   paint. Crop before and after to check. Geometry that is itself a badge
   (a raised logo, a brand grille) is reshaped or dropped in step 5 (`--drop`).
5. **Prepare in headless Blender** with the script for the kind: `prepare_vehicle.py`
   (cars: wheels and lamps split out, three LODs), `prepare_truck.py` (one `body`:
   scenery, boats, anything the game does not take apart), `prepare_tank.py`,
   `prepare_heli.py` (rotors, gun, eyes, stores), `prepare_jet.py` (surfaces,
   gear, nozzles, eye). All do the same core: import, flatten the hierarchy
   (keeping each part's ancestor `path` for `--drop`), scale to the real
   `--length` in metres, Y up, front toward −Z, standing on y = 0 and centred;
   split loose pieces and turn inward-facing ones out; join; decimate to the
   triangle budget (`--triangles`, ~12–25 k for a vehicle the player is near);
   keep only the maps the game reads; downscale textures (`--tex 1024`); cast
   occlusion by rays into the second colour set (`color_1`, the shader's
   `aoNode`); write `<out>.glb` (uncompressed: Draco is not available here) and
   `<out>.json` (size, box, triangles, mean albedo). `--forward=-x` needs the
   `=` (argparse takes a bare `-x` for an option).
6. **Check the preview** (`--preview`: side and top renders): heading, scale,
   nothing missing, nothing extra. Fix the flags and rerun rather than patching
   in the game.
7. **Ship the asset and its credit.** `shared/vehicles/<kind>_<name>/<kind>_<name>.{glb,json}`;
   a row in `shared/vehicles/CREDITS.md` and a credit line (title, author, URL,
   licence, what was changed: "markings painted out, decimated, re-lit").
8. **Wire it into the game** in one loader module per model
   (`render/<name>Model.ts`): `GLTFLoader` on `new URL('../../../shared/vehicles/…', import.meta.url)`
   (Vite needs `server.fs.allow: ['..']`); a failed load logs and keeps the
   procedural model as the fallback. Materials are rebuilt as
   `MeshStandardNodeMaterial`: colour from the map, the normal map, roughness
   and metalness set per material by what it is (paint, rubber, bare metal),
   `aoNode` from `color_1`, glass transparent without depth writes. The
   geometry is moved into the logic's frame (ground or waterline at the logic's
   reference point), and the logic's numbers are matched to the model, never
   the other way round: length, beam, wheelbase, track, wheel radius, seat and
   eye height in `config.ts`. Parts the game moves (wheels, steering, rotors,
   surfaces, the gun) stay separate nodes driven as before; colliders and
   masks (the water cap in a hull) come from the model's own vertices.
9. **Verify by render** in the game itself (headless Chromium with
   SwiftShader, one heavy render at a time, no edits to files the dev server is
   serving): from outside and from the seat, at noon and at night if it has
   lamps. Look for scale against the player, floating or sunk wheels, gaps,
   z-fighting, the inside seen from the seat (clip the cockpit tub if the model
   has a crude interior), and count draw calls and triangles. `tsc` and the
   tests pass.
10. **Commit, push the branch, put it on `main`** (which builds the APK) and
    check the build.

Traps: a part posed turned in the file (the Mi-28's gun) is straightened about
its own long axis, not by resetting the armature (that broke the scale);
lamp glass near the nose pollutes an eye found from "glass" (keep to the
canopy: front half, |x| < 0.8 m); a 4096 texture blurred whole takes gigabytes
(scrub in windows round each marking).

**Weapons** take the same steps with `prepare_gun.py` instead of the vehicle scripts:

- Moving parts come three ways, and one gun can need two: bones of a rig (`--parts magazine=magazine_02`,
  the AK), objects of their own (`--parts "slide=Gun_Slide"`, the AR-15 and the pistol), or loose pieces in
  a box when the seller left them inside another object (`--part "magazine:x0,y0,z0,x1,y1,z1@Magazine"`,
  the pistol's magazine was in the trigger's node). Render a side view coloured by part before trusting
  the names: the pistol's "Magazine" node was its trigger.
- Read the sights from the model's own vertices (the highest point on the centre line every few mm; the
  scope's rim at its eyepiece; the holographic window's middle) and shift the file so its sight line sits
  where the game's procedural weapon has it. The game then aims it with no other change. The AK's leaf
  notch and post gave a 377 mm sight radius against the real 378 mm: a check that the scale is right.
- Marks on guns are stamped, so they are in the **normal map** (logos, "MADE IN …", serials), often not in
  the colour. Fill them flat (`--no-grain`), or straight across (`--interp x`) where the surface curves;
  borrowed grain brings the neighbour's edges with it.
- Budget per weapon ~20 k triangles and ≤ 6 MB: the AR-15 came at 62 k with two 2048 sets (10.7 MB) and
  went in at 18 k + 1.5 k per part with 1024 sets (5.8 MB).
- The viewmodel takes everything from the weapon: muzzle, both grips, magazine rest, suppressor. Numbers
  fixed in the viewmodel for the procedural guns were the first thing to move.

## 6r. HDRI environments (FL `render/hdri.ts`)

A photographed environment puts real facades, trees and clouds into car paint
and windows, and a real ground into the bounce light, where a procedural probe
had a gradient over a flat grey.

- **Prepare offline**: average the 1k `.hdr` down to 512 × 256 (the probe is
  blurred anyway; ~0.5 MB each), find the sun (the brightest texel far above
  the sky's 99th percentile) and **cut the disc out** (clamp to a few times the
  sky's bright end): the directional light carries the sun, and a second sun
  in the probe double-lights everything. Record the sun's column and the sky's
  horizontal irradiance (upper hemisphere, cos-weighted, sun removed).
- **Turn it** about the vertical so its sun stands under the scene's
  (three's equirect u = atan2(z, x) / 2π + 0.5); no turn under cloud or at night.
- **Scale it by one gain** to the preset's calibrated sky illuminance. Not per
  channel: matching a blue sky's irradiance to a white target turned the grey
  street orange, and every car's paint and rims with it.
- **Keep the visible sky procedural** where the sun moves or fog must match it:
  the HDRI's horizon (another city, another forest) would not be ours.
- One HDRI per setting and preset (street and woodland × noon, overcast,
  golden, night); never one with a roof overhead (a covered plaza put a
  ceiling into every reflection).

## 6s. Bodies that bend, moving as people move (FL `render/skinning.ts`, `render/mocap.ts`)

The rigid-segment soldiers (§6c, §6h) read as dolls at the joints however good
the kit, and procedural gaits as robots. Two changes, both phone-friendly:

- **Instanced skinning.** Every segment becomes a bone; the body is one mesh in
  a bind pose (standing, straight limbs, arms in an A), and a vertex near a
  joint takes both bones, half at the joint fading over a few centimetres
  either side (knee, elbow, wrist, hips, neck, the shoulder caps going with the
  arms, a boot's shaft with the shin). Bone matrices (world × inverse bind) sit
  in a float texture, one row per man, four texels per bone, read in the vertex
  stage by `instanceIndex` with `textureLoad` (works on the WebGL2 backend
  too); the material's `positionNode` returns the skinned position and assigns
  `normalLocal`. The whole squad stays one draw — three's SkinnedMesh would be
  a draw per man and per shadow cascade. The existing posing code needs only
  its `place()` to write bone matrices instead of instance matrices.
- **Motion capture.** The CMU database (free for commercial use; credit it) in
  the cgspeed BVH conversion, which adds a T-pose as frame 0 of every file.
  Bake offline (three's BVHLoader in node): retarget every clip onto one
  skeleton by world rotations relative to the T-pose
  (`target = source · sourceT⁻¹ · targetT`), resample at 30 fps, store 16-bit
  quaternions (5–15 kB a clip). Cut gait cycles where the leg and arm poses at
  the ends match best, strip the forward travel (record it as the clip's
  speed), cross-fade the seam and start every cycle at the same moment (left
  foot furthest ahead) so walk and run blend at one phase. Draw stick figures
  of the baked clips before anything goes in the game.
- **Apply rotations, not positions**: each body part is turned from the bind
  pose by its bone's rotation from the T-pose (a half turn about Y between the
  capture's +Z facing and the game's −Z), on the body's own limb lengths; drop
  the hips so the planted foot meets the ground. Advance the phase by ground
  speed over the stride (no foot slide); stopping, walk on to the next moment
  both feet are planted apart and hold it — a stance, not a frozen mid-step.
  Arms keep their IK to the rifle and the head its aim; only the dead fall
  entirely as captured.
- **The lagoon's guerrillas share it** (`render/guerrillas.ts`, same rig and
  segment frames). Their deaths used to tip away from the shot; the captured
  fall goes backwards, so the pose is turned about the feet toward where the
  round went — at most a quarter turn, eased in over the first 0.45 s, as a
  hit spins a man — instead of snapping the body round at the moment of death.
  Kneeling still stays built by hand. Tanks' infantry is seen through a
  gunner's sight at hundreds of metres, where a gait reads the same either way:
  not worth a second rig there.

## 6t. Hands from a real body (lagoon `render/handMesh.ts`, `render/arms.ts`; FL `render/handMesh.ts`)

The first-person hands are on screen every frame, closer than anything else,
and capsule fingers on a ball palm read as a doll's hand however they are
posed. A real hand comes cheaply from MakeHuman: its base mesh, default
skeleton (three phalanges a finger, metacarpals, a thumb) and skin weights
are CC0 (`makehumancommunity/makehuman`, `data/3dobjs/base.obj`,
`data/rigs/default.mhskel`, `default_weights.mhw`; the mesh is in decimetres).

- **Bake offline**: joint positions are the centroids of the `joints` vertex
  lists; select the forearm and hand by the weights of their bones; move them
  into the viewmodel's hand frame (wrist at the origin, fingers along the
  knuckles' direction, the palm on the side the rest pose's fingers curl
  toward); stretch the forearm to the game's length; one Catmull–Clark step
  (a hand is seen at 20 cm); four weights per vertex; region masks from the
  weights (bare skin in a fingerless glove = the middle and distal phalanges;
  nails = the outer half of a distal phalanx's back; forearm); a tattoo UV
  round the forearm. Quantise (normals i8, weights and masks u8): ~300 kB.
- **Pose with rest rotations at identity**: every bone unrotated in the hand
  frame, so a finger curls about `normalize(boneDir × palmDown)` and the
  thumb opposes about its metacarpal's axis. Check the signs in a quick
  stand-alone page before the game (fist, grip, open hand). The left hand is
  the right mirrored at load (x negated, winding turned); its fixed-axis turns
  (spread, opposition) change sign, the computed axes come out right.
- **One skin, two parents**: three's skinning only needs each bone's world
  matrix, so the forearm bone can live under the forearm group (oriented to
  the elbow, rolled with the back of the hand) and the hand bones under the
  wrist target, with bind inverses passed explicitly. The wrist then bends
  as one skin.
- **Skin and gloves in one material**: the masks pick tan skin (not orange —
  an even, saturated tan reads as a dummy), its mottling, the forearm's hair
  and veins in the tattoo texture, nails paler and glossier, leather with a
  darker cut edge. Noise for pores and grain uses the rest position
  (`positionGeometry`), not the skinned one, or it swims as the fingers move.
- **A hand that never lets go** (FL's gloves): pose it once and skin it on
  the CPU into plain geometry.

## 6u. Guns cut from their outlines, worn on their edges (lagoon/FL `render/gunkit.ts`)

- **Outlines, not boxes**: each part from its real side profile (stock,
  grip, receiver, magazine, levers) or cross-section along the barrel
  (handguards), corners filleted (`filleted`), extruded with a 2–3 step bevel
  whose offset keeps the outline the outer edge.
- **Smooth bevels, hard faces**: `toCreasedNormals(g, 36°)` after the
  extrusion — the bevel becomes a rounded edge that carries a line of light,
  the faces stay flat.
- **`edge` per vertex** from the extrusion: 0 on caps and sides, 1 at 45° on
  the bevel. The finish wears through there, broken up by noise: phosphate to
  grey steel (metalness up, roughness down), anodising to aluminium, varnish
  to pale wood, polymer scuffed paler. Flat, unworn colours were what read
  as "simplified" at arm's length.
- Every mesh using these materials needs the attribute (fill zeros), or the
  node falls back with a warning per draw.
- **Count the vertices**: an outline's fillets times the bevel's rings
  multiply. A 62-tooth rail of filleted, two-step blocks was 60k vertices,
  and FL's carbine went from 7.6k to 102k. Fillet only real corners (a
  point on an arc turns < 20°: none), 3 curve segments per fillet, square
  small blocks with one bevel step. That brought the guns to 4–26k.
- **Coarse for the world**: `coarseParts(() => buildRifle())` cuts the same
  gun without fillets or bevels for the soldiers' copies (7k). And never
  `push(...array)` a merged gun: past ~100k elements the spread overflows the
  call stack. Copy into one typed array instead.

## 6v. Cumulus over the street: march them (FL `render/volumeClouds.ts`)

Two cheaper tries failed before the march. SkyMesh's clouds (noise lit by
their own density) are soft smears. A 2.5-D layer, its thickness taken as a
dome and lit through the slope, read as grey plastic: no billow had a sunlit
side and a shaded one, no rim glowed, and its cirrus combed the whole sky into
brush strokes. Ridgeline's and Contrail's march (§6s) runs on the same
hardware, so FL now uses it too:

- **Same field, same light**: Perlin-Worley shape carved by Worley billows,
  eroded by a warped Worley fbm; Wrenninge's octaves, dual-lobe phase,
  Beer–powder, sky light from above, ground bounce, the entry face's lobe
  lighting. It is baked at load (about a second, yielding).
- **In the post chain, before TRAA**: half resolution (a quarter on Low) in
  an `rtt`, composited over the sky where the scene lies beyond the slab's
  entry. Then `convertToTexture`, because TRAA and the shafts re-sample it.
- **Ignore the scene's depth in the march**: nothing on the ground reaches
  1.4 km. A coarse texel straddling a roof edge would cut a clear halo into
  the sky.
- **Haze by fading opacity**, not toward a fixed colour: far clouds dissolve
  into whatever the dome is behind them, toward the sun or away.
- **Shadows on the city**: `receivedShadowNode` on every sun-shadowed
  material, with 2–3 shape samples along the sun ray through the slab and a
  floor of 0.12. Set it after the world is built, before the shaders
  compile.
- Ridgeline's flat lighting had its own cause: the light march sampled only
  the coarse shape, so every billow was lit alike. Fold shading from the
  detail erosion, plus each lobe lit by the face the ray entered, fixed it.
  Detail samples inside the light march lost the device on a software GPU.
- **Towers, not slabs**: multiplying the shape by a height profile and then
  thresholding at 1 − coverage cut every cloud off at about a third of the
  layer. Raise the threshold with height instead: `thr = 1 − coverage ·
  dome(h)`, with dome falling from 1 above the base to 0 at the type's top.
  Clouds narrow as they climb, and only the densest columns reach the top.
  Normalise `(raw − thr) / max(1 − thr, 0.25)`: the floor keeps the crowns
  from turning into plaster shells.
- **Light each billow by its face**: take the entry normal from the full
  density, detail included, over ~90 m. Once per ray this is affordable. At
  40 m the clouds read as rough stone, and from the shape alone as smooth
  plaster. A thick cloud's sunlit face is nearly a white diffuser, but the
  octaves' forward phases give a third of that from the side, so add a gain
  (1.8) on the sun term.
- **Tune in a lab**: a page with only the clouds over a gradient sky, 12
  jitter frames averaged, takes 20 s per view in a software GPU. The game
  takes 15–25 minutes to load there.

## 6x. Scratched canopy glass (Contrail/Ridgeline `render/canopyScratches.ts`)

From the seat, a canopy shows its wear the way a car's paint does: hairline
scratches glint in arcs round the sun, and looking toward the sun they all
light up at once. A scratch is a thin cylinder. Light along −L leaves it on a
cone about its axis T, so the eye at V sees it where T·(V + L) = 0. Bake the
scratches once (coverage, plus direction as a coverage-weighted double angle
so the mips average sensibly). Lay them on the pane in a frame from a fixed
axis. Draw the glints as a second, additive mesh on the glass's geometry,
after it: raising the glass's opacity under each scratch drew dark lines on a
tinted pane. Weight them heavily toward the sun (forward scattering), at a
fraction of the sun's colour and intensity, with the sun's visibility through
the cloud field sampled four times a second. At a few thousand per square
metre they look like a used canopy. At seven thousand they read as hail.

## 6x2. The sun through the lens (Contrail/Ridgeline `render/lensFlare.ts`)

A camera turned to the sun shows three things: a diffraction starburst (one
spike per straight blade edge, fine rays from dust), ghosts (aperture-shaped
images of the sun along the line through the frame's centre, each a
different size and coating tint), and a wide ring ghost. Draw them in post,
after TRAA (it smears pixel-wide spikes) and before tone mapping. Hold each
spike's half-width to about a pixel at every distance (perpendicular distance
r·sin(N·θ/2)/(N/2)), or it aliases far out and blurs close in. Turn the
blades off the horizontal, or one spike lies along the horizon like a seam.
Give each ghost a slightly different size per colour channel; the fringe
sells it. Physically the ghosts are faint, around 0.1–0.5 % of the sun's
illuminance spread over the ghost, so they show against a dark cockpit and
vanish against bright sky. That is correct; do not crank them to show over
the sky. The key is visibility. Read the scene's HDR frame over 13 taps
inside the sun's disc and divide by the disc's known luminance (the sky's
clamp × transmittance, computed on the CPU). Do it in a 1 × 1 `rtt`, so it
runs once a frame, not once a pixel. A canopy bow, ridge or cloud over the
sun then removes the flare by itself, and a thin cloud dims it. Inside that
1 × 1 target `screenSize` is 1 × 1, so the aspect must be a uniform.

## 6z. A street people use, and walls that break (FL `render/streetProps.ts`, `render/breaches.ts`)

Against a three.js city demo (statue on its plinth, kiosk with an awning,
planters, café parasols, roadworks, a tower block with rocket holes through
whole storeys), FL's city had façades, cars, lamps and trees but empty
pavements and an empty plaza, and walls that shrugged off grenades.

- **Street furniture as instanced kinds**: newsstand, planter with a clipped
  hedge (the street tree's leaf cards squashed into a block), bollards, bus
  shelters, road barriers and cones, hydrants, café sets, a memorial. Each is
  a few parts coloured per vertex, one draw per kind and material, with a
  collider from the map builder. Place them with a clearance check against
  the props already there (no shelter in a tree pit). Put the eye-catcher
  (the memorial) where the spawn view looks.
- **Breaches without touching collision**: the façade box stays solid. Its
  shader reads a uniform array of holes (centre, radius, wall normal) and
  discards the wall inside each one through `maskNode`. The outline is noise
  on the in-plane distance, taken only for the nearest hole (two noise reads,
  not two per hole). Round it the broken core is darker than the face, then
  soot.
- **Fill the hole with geometry**: a solid box's other faces are culled from
  inside, so a bare hole shows the sky through the house. Behind each hole
  build a cavity: the room as a box drawn BackSide, shaded darker toward the
  back and the ceiling, slabs across it at the storey lines with rebar, and
  rubble on each floor. Outside, a mound and lumps on the pavement, fewer and
  wider-spread the higher the hole. A ring of 10 recycles the oldest.
- Broken surfaces in sun read paper-white: rubble and the rim must be darker
  than the wall they came from.

## 6z2. A town on a third of the map (Tanks `world/cityPlan.ts`, `world/cityBuildings.ts`, `render/cityMaterial.ts`, `render/cityGround.ts`)

About 520 buildings, 860 lamps and 500 trees on 0.9 km². They fit the
budget because the town is data first, and the shaders draw what geometry
cannot afford.

- **Plan as plain data.** The street grid, the block kinds, the lots, the lamps and
  the trees are a three.js-free module with tests. The tests cover coverage, that
  no house corner sits on a pavement, that nothing is built on the lake shore,
  that frontages are whole even bays, and that lamps stand on pavements. The
  terrain shader, the geometry, the grass, the forest mask, the minimap and
  the AI routes all read the same numbers. Level the terrain under the town
  before the lakes are carved, so the shore keeps its banks.
- **Perimeter blocks as rows**. The north and south rows run the full width,
  and their end houses are the corner houses. Only those get windows on their
  gables; every other gable is a blank party wall, as real ones are. Make
  frontages and corner depths a whole even number of bays: the shader then
  centres windows with `fract(u / bay)`, and no window is cut at a corner.
- **Windows in the facade shader, not in geometry**. Each vertex carries a
  building index. A float texture (3 texels per building) holds the centre,
  yaw, floor level, storey heights, bay and window scheme. The fragment shader
  rotates `positionWorld` and `normalWorld` into the building's frame and draws
  the following:
  - openings with a lintel shadow in the reveal, frames, mullions and transoms;
  - sills, curtains, shop fronts with fascias and doors;
  - prefab panel joints, and arched church windows with belfry openings.
  Trims (cornices, parapets, gables, balconies) carry a negative index, so
  they keep the wall's surface but get no windows. Fade to the
  wall-plus-glass average between 0.18 and 0.55 m per pixel. Fading from
  0.05 m blanked windows on a house 40 m away. Tint the render per building
  with pastel limewash colours, and keep flaking low: the village's patches
  read as blood spots on a town front.
- **Paving analytic from the grid**. The heightfield's 2 m texels could not
  hold a kerb. Instead, the terrain shader works out the nearest grid lines,
  street or avenue widths, and block activity (one texel per block) to draw:
  asphalt with wheel tracks and patches, centre lines, zebras just outside
  each junction, 50 cm slabs, a granite kerb with a tilted face, and setts on
  the square. All of it fades before it aliases. Where paving covers the
  ground fully, the photo layers are skipped.
- **Lamp light without lights**. The lamps sit on a lattice, so the shader
  finds the four nearest on each of the two nearest streets. For each it adds
  E = I·cos^1.6θ/d² (a wide street optic) and emits ρ·E/π as an emissive term.
  It uses the same skip rule as the CPU placement: no lamp within a crossing
  street plus 3 m.
- **Night needs display ceilings**. With the night preset's exposure, a
  physical 39 lx pool was 20 000× the scene and bloomed the street white.
  Cap the pre-exposed lamp intensity (here 340 cd·exposure, pavement peaking
  at ~0.6). Cap lit rooms at ~1.2 and LED lenses at ~12. Keep the physical
  value and the named cap separate in config.
- **A spatial grid for colliders** (32 m cells, a DDA walk for segments) once
  there are more than a few hundred. Shells, lines of sight, tank pushes, AI
  probes (test the distance to the box, not a circle round it: a 30 m house's
  circle covered the street), infantry and the drone's roof floor all use it.
- **Driving the AI through the town.** Snap goals onto a street and route
  Manhattan-style: along the current street to the cross street nearest the
  goal, then turn. Spawn tanks only on streets or in parks, never in a
  courtyard.
- Merge per material in 256 m chunks: a few dozen draws, and the cascades only
  draw nearby chunks. Instance the lamps (two draws); a tank folds one over.

## 6z3. A street filmed: ten seconds of Paris (`paris/`)

The playbook put to a test from scratch: a Haussmann boulevard at golden hour
with traffic, walkers, café terraces, cyclists and pigeons, rendered frame by
frame to a 1080p video. What carried over unchanged: physical light (lux,
kelvin, pre-exposure, the Preetham sky calibrated to the sheet, one HDRI gain),
the TSL facade and ground shaders drawn from the world position, the instanced
skinning and the CMU captures (§6s), Field Line's lofted cars (§6c), TRAA. What
was new, or had to be found:

- **Facades as geometry where light shows it.** Window openings cut into the
  wall with 24 cm reveals, continuous balconies on corbels, string courses and
  a cornice with modillions, mansards with dormers and chimney pots. A low sun
  draws every one of these as a shadow line; a shader-only window (§6z2) is
  fine across a town, not along a street seen from 3 m. About 50 triangles a
  window. The rest (ashlar joints, soot streaks, panes, rooms, railings) stays
  in the shaders, and railings are a `maskNode`, so their shadow has the
  pattern.
- **Interior mapping for every pane** (van Dongen, as §6d) with sheer
  curtains, drapes and a share of lit rooms; glass is black and glossy, the
  room is emitted light weighted by 1 − Fresnel, so windows mirror the sky at
  grazing angles down the street and show the room face-on.
- **A shot is deterministic.** Simulation at a fixed step (100 Hz) from a
  pre-roll before frame 0; the recorder asks the page for frame *i* in order.
  Traffic is the IDM (Treiber 2000) per lane, a red light being a standing car
  at the stop line; the crowd keeps right, slows behind slower walkers, goes
  round kiosks and terraces. Choreography is in the light timing: a queue
  waits while people cross on the zebra, then pulls away.
- **One browser frame per rendered frame.** TRAA keeps its history once per
  animation frame; frames rendered back to back in one task resolved to one
  flat colour. Await `requestAnimationFrame` between frames and read the
  canvas with `toDataURL` in the same task as the draw (a screenshot taken
  later gets a composited, possibly stale buffer).
- **Velocity for everything that moves**, or motion blur and TRAA smear it:
  a skinned `positionNode` must also assign `positionPrevious` from the
  previous frame's bones (skinning.ts keeps a second bone texture), and an
  instance must keep its slot for the whole shot. LODs for instanced cars and
  people are therefore decided once, by running the deterministic traffic
  ahead and picking whoever comes within ~55 m of the camera path.
- **Motion blur** (three's `motionBlur`) after TRAA at a 180° shutter: half the
  frame's velocity (NDC → uv: ×0.5, y flipped). Its input must be a texture
  node: `convertToTexture(traaNode)`.
- **Measure the triangle budget per group** (`?hide=people,traffic`): the first
  full frame was 21 M triangles over the camera and four cascades. Cars at
  8 k each, a city of them, were most of it; then people (4 k each). Coarse
  cars (2 k) and bodies (1.3 k) beyond the camera's reach, buildings merged in
  70 m chunks (so each cascade culls them) brought it to 9 M.
- **A cloud deck needs the far plane.** A flat altocumulus layer at 3.2 km lit
  by the low sun gives the evening sky its colour; seen at 10° it is 18 km
  away, so the far plane is 60 km (fine with reversed depth).
- **A film camera's finish** (after mexicat/pdoom-video and lemomo-ai/lemo-opuscar):
  render offline frames at 2× and let ffmpeg scale them down (Lanczos), which
  smooths what TAA leaves stepped (railings, twigs, road lines); halation — a
  high-threshold bloom (pre-exposed level > 1.6) tinted (1, 0.18, 0.04), so only
  lanterns, brake lights and glints get the red-orange fringe; lateral
  chromatic aberration growing with r² (~1.2 px in a 1080p corner); and the
  grain added by ffmpeg after the downscale (`noise=c0s=5:c0f=t+u`, `-tune
  grain`), never in the page, where a supersampled frame would average it away
  and every frame would become incompressible.
- **Autumn**: plane bark mottled by noise thresholds, leaf cards from a canvas
  of five-lobed leaves tinted per card from green to gold to rust, a share of
  sunlight through the leaves toward the viewer, fallen leaves on the ground
  as a cellular decal, thickest under the crowns and swept into the gutters.

## 6y. A cockpit you sit in (Contrail `render/cockpitModel.ts`)

The old office was a dozen boxes: a hood, a flat panel, four cubes for dials,
square sills, no floor. Looking sideways showed the desert through it. Against
footage of a real cockpit, what makes it read as a place:

- **Close the tub**: walls, floor, footwell, bulkheads, a roof over the knee
  well.
- **Frame the view with real parts**: sill rails with two rows of bolt heads,
  a padded glare shield with a stitched lip, and on it the HUD (projector, a
  tall frame, a tinted combiner) and the warning lamps.
- **Panels, not a panel**: display bezels with their push-buttons and corner
  rockers, round instruments (case, printed face, bezel ring, glass), caution
  tiles, the gear handle, switch panels on the consoles with toggles and
  knobs, throttle and side stick, the pilot's legs.
- **Print the faces**: one canvas atlas for legends, seams, Dzus fasteners
  and dial faces. Use 2 px/mm for small text, less for big faces, and 0.6
  px/mm for the bare backing. At one density the atlas overflowed.
- **Bevel everything** (a box's edge catches no light), tessellate the big
  faces, and bake AO at 2 cm with 45 cm reach at 0.6 strength. A bubble
  canopy floods the tub with sky, so full strength turned it black.
- **Shadows**: in the seat views the sun's shadow map shrinks to ±3 m round
  the eye (3 mm texels), sits 30 m out, and gets a 3 mm normal bias. The
  outside view's 5 cm normal bias would lift every shadow off a switch panel.
- **Put things where the eye is**: the keypad set into the panel's top sat
  behind the glare shield's lip, out of sight. It stands out under the lip
  instead, and the default view looks 11° down, so the whole panel is in
  view.
- **Mind the HUD clip**: the symbology fits into the combiner's outline. A
  realistically narrow glass stacked the corner data over the ladder, so it
  is 33° wide.
- **Hands on the controls**: FL's MakeHuman hand (`handMesh.ts`), posed
  round each grip and gloved (sage Nomex backs, leather palms). Place it by
  a basis: the grip's axis, where the back of the hand faces, the forearm
  from their cross product. The grip's axis passes through a fixed point
  under the palm. A gauntlet and the suit's sleeve run back to the elbow on
  the armrest. The stick and throttle groups carry the hands and arms and
  move with the input: a few degrees of stick, 7.5 cm of throttle.
- **A live gyro**: the standby attitude ball is its own canvas, redrawn every
  frame, because a horizon that steps at the displays' 15 Hz reads as
  broken. It is self-lit like the screens, so it reads in the panel's shade.
- **A view for them**: a "panel" camera (36° down, 80° wide, eased in) shows
  the displays, the gyro and both hands. In the forward view they are below
  the frame.
- Keep an instrument's face in front of its case. A face set inside the
  case's closed cylinder was hidden by the cap, and every dial read as a
  dark disc.

## 6w. Decals that belong to their surface (lagoon `render/footprints.ts`)

A decal is seen where its colour differs from the ground and where its alpha
ends. Footprints sat in rectangles: their rim ran past the quad and was cut by
its edges, and their flat sand colour stood out on the photographed beach.
Size the quad for the whole effect plus a margin, fade alpha to zero inside
its edges whatever the shape does, and shade the decal with the ground's own
inputs (the same photograph and macro variation at the same world UVs, the same
wetness) so only the change — the dent — shows.

## 6aa. Cheap fixes from a screenshot tour (November 2026)

A tour of all five games with `tools/measure/shots.mjs` listed what gave the
picture away, each fix limited to constants, formulas and geometry already in
the scene (no pass, texture, light, draw call or pipeline added). The list
and its state: `docs/wytyczne-prace-rutynowe.md` §3. What was learnt:

- **Measure the cause before fixing it.** The forest's burnt-out sunflecks
  were blamed on a 7-stop exposure floor; the meter showed the eye 3.4 stops
  under the preset, so the floor was not what bound it. A probe of
  `presetEv`, `adaptedEv` and the metered EV at the view took one run.
- **Outdoors, the eye opens 2.5 stops at most** (FL `EXPOSURE.minEvBelowPresetOutdoors`):
  the darkest place by day without a roof is a canopy's shade, 2–3 stops
  under open sun. Metering the shaded floor fully (EV 11.9 at noon) burnt the
  sunlit litter white; stopped at 12.8 it keeps its texture. The 7 stops stay
  for maps with rooms.
- **A roof is boards underneath** (FL range): a slab of one dark material is
  dark on every face, and its underside, lit only by what the ground bounces,
  was a black band across the view. Give the underside the material it really
  has, from the looks the map already uses, so the merged world mesh gains
  no draw call.
- **A leaf card's texture is drawn at the card's scale** (FL `streetTree.ts`):
  a 2 m card with one spray of eleven leaves made half-metre leaves. Several
  smaller sprays on the same texture (`broadleafCluster(…, sprays)`) cost
  nothing and turned origami into foliage.
- **Impostors are matte** (Contrail, Ridgeline `forest.ts`): a crown is a
  volume of leaves, not a surface. With the ordinary specular, the flat side
  cards of the impostors mirrored the sky at a grazing look and dotted every
  forest seen from the air with pale grey posts. `specularIntensity: 0` on a
  physical material, as the grass's `matte` option; one material, the same
  pipelines.
- **A cloud's shadow keeps a floor** (Contrail `clouds.ts`): under a cloud the
  cloud itself sends down the light it scatters. Without it only the blue sky
  lit the ground and brown fields turned violet; 15 % of the sun is enough.
- **A river needs a bank**: a band of wet silt on the land side of the water's
  cover edge, and lighter shallows over it (Ridgeline `terrainMesh.ts`).
- **Half of the guesses were wrong.** Of eleven tasks written from screenshots,
  the stated cause held for five; the others were found to be something else
  (exposure, specular, a mesh's light rather than its occlusion) or changed
  nothing measurable and were reverted. Measure before and after every one.
- **Find the pixel's owner before changing its colour.** Bright specks in a
  far meadow survived fading the grass's dry tips; hiding the grass removed
  them all, and their colour had not moved — the blades themselves, not their
  tips. Hide one system at a time and count (a pixel brighter than 1.35 × the
  median of its 5 × 5 neighbourhood).

## 6h. Animals and enemies (lagoon `render/creatures.ts`, `render/guerrillas.ts`)

- **The same rigid-segment rig as the soldiers** (§6c), one InstancedMesh per
  segment per species, posed from the headless logic each frame through a small
  matrix stack (`push`/`t`/`rx`/`emit`/`pop`). Bodies are lathes along the
  spine (`along()`, flattened for the croc's head and the boar's wedge), limbs
  tapered capsules hanging along −Y from their joint.
- **Joints bent the animal's way.** A cat's fore leg: upper arm back to the
  elbow, forearm straight down; its hind leg: thigh forward to the knee, shin
  back to the hock. Straight posts read as a toy. Stalking folds the elbows up
  behind the shoulders. Tails hang down and back (a *negative* `rx` swings −Y
  backwards) and curl at the tip; a charging boar carries it straight up.
- **Gait from speed**: one phase per animal advanced by speed / stride length;
  walk = lateral sequence, gallop = the pairs close in phase with a spine flex;
  the croc and shark get a travelling lateral wave (`sin(φ − k·0.9)`, larger
  toward the tail); the croc swims with its legs folded back.
- **One material, per-vertex kind** (tiger stripes along z or y, bristle, scutes,
  countershaded skin, plain eyes and teeth), patterns in **`positionGeometry`**:
  in an instanced mesh `positionLocal` is already the instanced position, so
  stripes crawl over a walking animal and countershading follows world height
  (a shark at −2 m went all belly white).
- **What sells the threat**: the croc's eyes and nostrils standing proud so they
  are what shows at the waterline; the shark's dorsal fin breaking the surface;
  muzzle flash, smoke and a tracer (life cut at the first raycast hit) for every
  enemy shot; blood puffs, or a red cloud and a ripple under water; HUD arcs
  pointing at whoever hit you.
- **Bodies, not dolls** (round 3: "make the enemies look real"). Thin
  cylinders with a ball at each joint read as a robot or a toy at any distance,
  whatever the kit on them. What fixed it, in all three games' enemies (FL
  `render/actors.ts`, lagoon `render/guerrillas.ts` and `creatures.ts`, Tanks
  `render/infantryModel.ts`), keeping the instanced rigid segments:
  - **Clothed limbs lathed through measured profiles**: a thigh in trousers is
    ~18 cm across at the top and 12 at the knee, a sleeve full at the deltoid;
    the section oval; domes at both ends so a bent joint shows no gap. Press the
    cloth's **folds** in as rings that wander round the limb where it bunches
    (crotch, behind the knee, elbow, over the boot) and darken the creases with
    a per-vertex `shade`.
  - **One loft for a trunk**: hips with a seat, an animal's body deep at the
    chest and tucked up at the waist (`bodyLoft()`); ellipsoids end to end make
    a string of lumps. Split it between segments where it flexes, each loft's
    rings running past the split.
  - **A face**: brow, nose, cheekbones, jaw pressed into the head sphere; eyes in
    shadowed sockets, brows, stubble as `shade`. Boots from a side profile,
    hands as a grip (palm, a roll of curled fingers, a thumb).
  - **Arms that bend**: two-bone IK with an outward-and-down pole; a straight
    stick from shoulder to grip is a mannequin.
  - **Dirt where it collects**: a per-vertex `grime` (boots, trouser bottoms,
    knees) blended to mud in noisy blotches.
  - **A coat as the animal wears it**: a tiger's stripes are bands down from the
    spine, each its own width, tapering toward a cream belly, some doubled or
    broken — stripes from noise zero-crossings look like scribbles. Cream as a
    per-vertex `white` (belly, throat, under the paws), not a white ellipsoid
    stuck on.
- **No two men alike** (round 3: "the uniforms blend into everything"). One
  camouflage on every soldier, matched to the ground, makes a squad a single
  smear. Give each instance its own kit through a per-instance attribute
  (`InstancedBufferAttribute`, read in TSL with `attribute('kit')`, filled per
  segment so every part of one man agrees): a camo scheme (woodland,
  multicam, urban, desert, ranger green), a plain colour for plate carrier and
  helmet cover, and a dash of high-contrast kit (FL: a red recognition band
  round the upper arm). Guerrillas: tiger-stripe or a plain shirt, their own
  trousers, skin, hat or bandana. Tanks infantry: one uniform colour per man
  (`camo` vertex weight = 1 only on the uniform, so boots and kit keep theirs).
  Pick the palettes so their *luminance* differs, not just their hue: at
  50 m and in shade only value separates a man from the bushes behind him.
- **Real clothes and vehicles from Blender, offline** (Paris, `tools/people`,
  `tools/vehicles`). When a human or a car must hold up at a few metres,
  procedural lathes stop short; build them on a PC with Blender instead and
  load the result as data. People: MPFB (MakeHuman for Blender) with the CC0
  system assets — macros for sex, age, ethnicity, weight, height; the default
  rig; skin, eyes, brows, lashes, hair, clothes, shoes picked *by keyword* from
  whatever is installed (so the script survives another asset pack); every
  piece evaluated at rest, turned into the game's frame, MakeHuman's 163 bones
  folded into the game's 15, decimated to a budget per piece (the body
  favoured; hair and brow *cards* are never collapsed), AO baked by Cycles with
  the whole character present, written as positions, normals, uvs, 4 bones,
  AO and one index range per material. The game poses each character on its
  **own joints** (`life/rig.ts`): bind frames and limb lengths from the
  exported joints, never the procedural rig's constants, or a tall man's
  knees bend in his thighs. Vehicles: scale to the real length, the front to
  −Z, wheels recentred on their axles and named, head and rear lamps split
  out for the game to drive, symmetric decimation for LODs, AO, glTF + Draco,
  and the licence (CC-BY needs the credit) in the JSON beside it.
- **Photo sets over procedural where you stand on it** (Field Line round 4):
  asphalt with real cracks, 30 cm slabs, weathered render, floorboards,
  planks, slate, rust, a container's chipped paint, a tarred roof — each a
  Poly Haven scan (colour, ARM as ORM, displacement as height) at 512 px, the
  road at 1024. Tile at the scan's *measured* size, not a round number: a 1.8 m
  photograph of 30 cm slabs tiled at 2.4 m makes 40 cm slabs. When the mesh's
  UVs are metres (a terrain) divide them by the photo's size in the material;
  when per-slab effects key on a grid (`slabbed`), give them the photo's own
  slab count. Match a scan's mean colour to the look's sheet colour so
  photographed and generated surfaces sit in one palette.

---

## 7. Water and the shoreline

**Files:** Lagoon `render/water.ts`, `render/shoreField.ts`, `render/shoreWaves.ts`,
`render/caustics.ts`, `render/waterFx.ts`, `render/ground.ts` (swash, wet sand,
caustic lookup), `config.ts` (`WAVES`, `SHORE`).

The shoreline is where water looks fake first. The design target (from the
coastal checklist in §10) is one continuous chain driven by the **real seabed**:

> offshore swell → slows and shortens in the shallows → bends to the depth contours
> → grows → breaks → foam → runs up the sand → drains back → wet sand → dries.

### 7.1 The water surface

1. **Radial grid** centred on the camera (rings 0.35 m apart near the eye, growing
   4.5 % per ring out to 6 km), snapped to the finest spacing so it never swims.
2. **Depth map**: seabed height baked once into a half-float texture over the bay
   (shared with the wave field so `heightAt` runs once per cell).
3. **Wind chop**: a few Gerstner components (GPU Gems 1 ch. 1) with analytic
   normals, damped in very shallow water.
4. **Shading by hand** (`MeshBasicNodeMaterial`, every term explicit):
   - **refraction**: `viewportSharedTexture(screenUV + distortion)` — the floor
     already rendered behind the water, distorted less where it is shallow;
   - **Beer–Lambert absorption** along the path down and back up, per RGB channel
     (clear sea water ≈ 0.45 / 0.07 / 0.045 per metre, Pope & Fry 1997): red dies
     first, so white sand under a metre of water turns turquoise, deep water navy;
   - **single scattering** (turquoise in the shallows → navy in the deep) lit by
     sun and sky; light through the backs of crests;
   - **Schlick Fresnel** (F0 = 0.02), **reflection of the same analytic sky**, and a
     tight glint lobe of the sun and moon;
   - detail normals from two wind-scrolled ripple layers (faded with distance to
     avoid aliasing), splash rings and rain rings;
   - at the waterline the water fades into the wet sand behind it (thin film).

### 7.2 Shore wave field (eikonal, baked at load)

`render/shoreField.ts` — ported from Tidewater's `ShoreField`.

1. Grid over the bay (512², 1.2 m cells). Per cell: depth `d`, phase speed
   `c(d) = ω / k(d)` with **Eckart's approximation**
   `k = (ω²/g) / √tanh(ω² d / g)` (full dispersion, so deep water matches a plane
   wave exactly).
2. **Fast Marching Method** for `|∇T| = 1 / c`: sources are the border water cells
   with a plane-wave arrival `T = (x·dir)/c₀ + offset`; a binary heap pops the
   smallest `T`; the upwind first-order update is
   `a + f` if `|a − b| ≥ f`, else `½ (a + b + √(2f² − (a − b)²))`, `f = h / c`.
3. **Path loss**: accumulate `Σ ds / depth` from the upwind neighbour, and
   attenuate by `exp(−μ · loss)` — a long shallow channel calms the lagoon.
4. Extend onto land one ring per pass (reading the previous pass only):
   the **shoreline arrival time** carried inland unchanged (swash timing), and `T`
   continued slowly up the beach. Smooth `T` three times (removes FMM kinks).
5. Direction = normalised ∇T; **exposure** = alignment with the swell × path loss.
6. Store RGBA **float32** (`T`, dir × exposure, shore `T`): arrival times reach
   hundreds of seconds, beyond half-float precision. Float32 is not filterable
   everywhere, so the shader does **bilinear by hand from four `textureLoad`s**.

Cost: ~0.4 s at 512² once the heights are shared (the heights themselves were
1.5 s: share them). Unit tests: dispersion limits, fronts turning to meet a
straight beach, the lagoon beach reached through the channel with less energy.

### 7.2b An enclosed lake (FL `maps/lake.ts`, `render/shoreField.ts`, `render/water.ts`)

The same machinery on a small lake in Field Line's forest, with four changes:

1. **Carve the basin into the height function** (pure data: an ellipse with a
   gentle bowl at most 1.3 m deep and banks that rise above the water out to 1.3
   radii, then blend back to the terrain). The level is a little under the lowest
   ground on the blend rim. Tests: the banks are above the water all round, and
   no spawn, patrol, pickup, tree or track is in it. Logic reads the same data:
   wading slows the player (half speed at 1 m) and forbids going prone.
2. **Sources = the upwind shore** (water cells whose upwind neighbour is dry): a
   lake has no open boundary to feed a plane wave in from. **Fetch** (distance
   travelled over water) is accumulated along the same fast-marching paths and
   sets the height, `A ∝ √(fetch / 90 m)` — short, fetch-limited wind waves
   (period 1.7 s, ~5 cm in the forest's 5 m/s wind).
3. **Water on a physical material** instead of hand shading: a
   `MeshPhysicalNodeMaterial` with `ior 1.333` takes the environment reflection,
   the sun's highlight and its shadows and the fog from the scene's own lights;
   the refracted bed, absorption and scattering go in `emissiveNode × (1 −
   Fresnel)`; foam is diffuse `colorNode` with its own roughness; the edge fades
   out with `opacityNode` on the per-vertex depth. Wave normals go through
   `transformNormalToView` (a material's `normalNode` is view space).
4. The terrain's swash code runs only inside the lake's ellipse (elsewhere,
   ground at the same height would get wet patches from the clamped field), and
   reeds grow in clumps along the waterline.

### 7.3 Shore waves (`render/shoreWaves.ts`)

1. **Phase**: `s = (t − T(x)) / P + wobble(along)` counts waves; the crest of
   wave `m` passes when `s = m`; `u = s − round(s)` is −½…½, **u < 0 is the
   front of the wave** (shoreward points see each crest later).
2. **Every wave is an individual**: height from a set pattern (groups of ~7,
   bigger in the middle), a per-wave hash, and an along-shore variation (a few
   sines whose phases depend on `m`), so waves peel along the beach instead of
   closing out in one straight line. Hand the height over between consecutive
   waves in the trough (`mix` over the last 18 % of each half) so there is no step.
3. **Shoaling**: Green's law, `A = A₀ (d_ref / d)^¼`, capped.
4. **Depth-limited breaking**: `H = 2A ≤ γ d` with `γ ≈ 0.78`; `breaking =
   smoothstep(0.8, 1.15, A / (γd/2))`; the amplitude is capped at `γd/2`.
5. **Shape**: elliptic orbits — vertical `A`, horizontal `A / tanh(kd)` (flatter
   and longer in the shallows), clamped so `k × horizontal ≤ 0.9` (no loops). Water
   behind the crest moves forward and water ahead moves back, so crests bunch up.
6. **Forward lean**: warp the phase `g(u) = 2πu − β sin²(πu)` with `β = 1.2 ×
   breaking`, so the front face steepens as the wave breaks (`g′ > 0` for β < 2).
7. **Normal analytically**: along the travel direction ξ, `du/dξ = −1/λ`, so
   `dY/dξ = A sin g · g′ / λ`, `dX/dξ = 1 − H cos g · g′ / λ`; slope = dY/dX.
8. Pass the **continuous** wave count `s` to the fragment shader as a varying (the
   wrapped phase would jump inside a triangle) along with breaking and direction.
9. The long swell of the old Gerstner set only runs outside the baked field
   (fade over the field's last 6 %); the short chop runs everywhere.

### 7.4 Surf foam

- **Roller**: whitewater on the crest and its front face where the wave breaks.
- **Trail**: behind it the foam decays with the time since the crest passed,
  `age = fract(s) · P`, over `foamLifeS`, drifting shoreward with the bore. Keep
  the foam life well under one wave period (1.8 s for a 3.6 s period) in calm
  water: at 4.5 s every breaker's foam overlapped the next one's and the whole
  inner surf zone stayed white.
- **Lace** (after Tidewater's lace texture): a tileable texture whose R channel
  is "hole-ness" — round holes of many sizes (three scales of jittered points, each
  with its own radius, strongly domain-warped) plus fbm mottling — G small bubbles,
  B mottling, A a per-cell random. `cover = smoothstep(R − 0.08, R + 0.08, amount)`:
  fresh foam is a dense mat; as it thins, holes open and merge until only
  irregular strands and patches remain. (Our first version used Worley F2 − F1
  cell edges: at every amount it read as a regular honeycomb / paving stones —
  exactly what the coastal checklist warns against.) Offset the lace per wave (hash of `m`) so no two
  waves leave the same pattern. **Multiply the result by `smoothstep(0.03, 0.12,
  amount)`**: with any mottling offset in the threshold, zero foam otherwise still
  draws the whole strand net over every beach and every square metre of water
  (our first screenshot).
- A thin lacy edge where the water meets the sand; storm whitecaps on the chop;
  splash foam; the surf zone scatters a little milkier (stirred sand).

### 7.5 Swash, backwash and wet sand (ground shader)

All analytic — no simulation texture, so it costs nothing on phones outside the
beach band (the code runs inside a TSL `If` on the ground's height).

1. At a sand point `y` metres above sea level, the latest wave's time since it
   reached the shore: `τ = frac((t − T_shore) / P + wobble)`.
2. **Run-up** (vertical): `R(τ) = R_max × (1 − (1 − τ/up)^1.5)` while running up
   (decelerating), then `R_max × (1 − sb^1.6)` while draining
   (`sb = (τ − up)/down`, a backwash that starts slowly and accelerates), with
   `R_max ≈ 2.1 A` of the wave as it arrives, and a **lobed front** (three sines
   along the shore whose phases depend on the wave).
3. **Sheet**: `R(τ) − y > 0` → a film of water: darker and a touch green-blue,
   normals flattened, **roughness ≈ 0.14, not a mirror** (at 0.03 the whole run-up
   band reflected the sky as a solid white strip); a thin **foam line at the
   leading edge** while running up; a few foam patches riding the backwash while
   it drains (lace stretched along the flow looked like a comb: avoid). Only **above the still waterline** (`y > 0`):
   below it the water surface draws the waves, and swash foam on the seabed shows
   through the water as a white blanket.
4. **Wet history**: for each of the last six waves, when did its backwash uncover
   this height (invert the backwash curve), and `wet = max exp(−since / dryTime)`
   with `dryTime ≈ 28 s` × a noise factor so the dry line is ragged. The wet band
   follows the set's biggest run-ups and dries over half a minute.
5. **Wet sand look**: darker (× (1 − wet × porosity)), a little more saturated,
   roughness → 0.2, normals 40 % flatter.
6. It runs inside `If` in a TSL `Fn`, so every texture read in there needs an
   explicit mip level (WGSL): take it from the camera distance,
   `log2(dist × pixelAngle × texelsPerMetre)`.

### 7.6 Caustics by photon splatting (`render/caustics.ts`)

After Evan Wallace's *WebGL Water* (also Tidewater's approach):

1. A grid covering one tile of the ripple pattern **plus a margin** is drawn
   into a small float target (256² High, 128² Low) **every frame**, additive.
2. Each vertex samples the **same two ripple layers the water shows** (tiles
   9.9 m and 3.3 m, ratio 3, so the combined pattern repeats every tile), refracts
   the sun (`refract(−L, N, 1/1.333)`) and moves to where the ray lands on a floor
   plane `D` below, relative to where it lands under a flat surface.
3. The fragment writes `area before / area after` (from `dFdx`/`dFdy` of the
   rest and landed positions): exactly the light concentration, so focusing forms
   the bright network by itself and it moves with the ripples. Two planes
   (1.2 m in R, 3.0 m in G), blended by the real depth at lookup. Check it by
   reading the target back (`readRenderTargetPixelsAsync`): the mean must be ≈ 1
   (energy conserved); a flat network means too little focusing — gentle detail
   normals at shallow depth barely focus, so the splat scales the ripple slopes
   by 1.5.
4. The ground looks it up where **its sun ray entered the water**
   (`p.xz − refractedShift × depth`) and adds `(I − 1) × direct sun × albedo`,
   faded with depth.
5. Write the vertex as `vec4(x·2−1, 1 − y·2, 0, 1)` via `material.vertexNode`:
   texel row 0 is NDC y = +1 on both backends (three flips WebGL render-target
   reads to match WebGPU), and make the grid `DoubleSide` (the flip reverses the
   winding, and refraction can fold triangles).
6. Vertex-stage texture reads need `.level(0)` (WGSL has no implicit LOD there).
7. High draws the lagoon's tile at 512² from a 192-cell grid (2 cm texels): at
   256² the network smeared into blobs a metre from a diver's mask.
8. Dispersion (lagoon): the floor looks the tile up **once per colour**, each at
   the entry point of that colour's sun ray (water's index 1.3291 red, 1.333
   green, 1.3369 blue). The focal depth differs by under 1 %, so one tile serves
   all three; only the entry point moves, giving thin coloured fringes that grow
   with depth. Not worth it in Field Line's 0.4–1.2 m lake (fringes < 0.6 cm).

### 7.7 Interactive ripples (`render/rippleField.ts`, shared by all three games)

Splash rings used to be analytic: a uniform array of 24 sources, each summed
in every water pixel. That costs a loop per pixel over the whole lagoon,
cannot show a wake (a moving source would need a new slot every frame), and
rings run straight through sand banks. The replacement is a small height field
stepped on the CPU:

1. **Grid**: 128² cells (96² on Low) round the camera — 0.2 m in Field Line
   (26 m), 0.25 m in the lagoon (32 m), 0.5 m in Tanks (64 m). Two time levels
   and a land mask (`isWater(x, z)`: the ground under the still water level).
2. **Step**: the damped wave equation at a fixed 30 Hz,
   `h' = (2h − h₋ + C²·∇²h)·damp`, `C = c·Δt/Δx`, five-point Laplacian, at most
   three steps per frame. With c = 1.1 m/s (lake, lagoon) or 2.4 m/s (Tanks) C²
   stays far below the 2-D stability limit of 0.5. Land cells are held at 0, so
   rings reflect off banks and islets. The steepest part of a ring trails its
   leading front (at c·t) a little, as 2-D waves do.
3. **Upload**: central-difference slopes go into an RGBA8 texture (R, G =
   ∂h/∂x, ∂h/∂z in ±0.6; B = |h| as agitation, 1 at 12 cm), linear filtered.
   The water shader reads it once per pixel and leans the normal against the
   gradient; B above ~0.35 adds froth, so a blast or a heavy stone churns the
   surface and a wading wake (a few cm) does not. Cells at the window's edge
   are held flat and the sample fades there.
4. **Following**: the window re-centres in whole cells once the camera has
   moved 12 cells, shifting both time levels and the mask, so a ring stays put
   in the world. Only newly exposed cells call `isWater`.
5. **Idle**: once every |h| is under 20 µm the field zeroes itself, uploads one
   flat frame and stops stepping, so calm water costs nothing on the CPU.
6. **Sources**: `disturb(x, z, radius, depth)` pushes a raised-cosine dip.
   Splashes call it once (stone: radius 0.12 + 0.15·s, depth 0.012 + 0.04·s;
   shell: 0.9–2.1 m, 0.25–0.45 m); anything moving through water calls it every
   frame scaled by `dt·60` (legs: 0.3 m, ≤ 4 mm; tank bow: 1.4 m, ≤ 3 cm), so
   the wake does not depend on the frame rate.

Cost: one 128² step is ~16 k cell updates (≈ 0.1 ms in V8), plus a 64 KB
texture upload per frame while anything moves. It needs no render target, so
it behaves the same on the WebGL 2 fallback. Tests: `tests/rippleField.test.ts`
in Field Line (ring speed, calming down, land held still, re-centring).

### 7.8 Swash at lake scale (Tanks `world/terrain.ts`)

The lagoon's swash (§7.5)
comes from its baked shore field; a small upland lake has no swell, only wind
chop, so Tanks fakes it cheaply in the terrain shader: a film runs up to
4–22 cm above the still level and back, with the same phase as the lake
shader's shore-foam fronts (`sin(1.22·t + noise)`), the bank stays dark and
glossy up to the highest run-up, and a lacy foam line rides the film's edge.

### 7.9 Open-sea FFT (lagoon `render/ocean.ts`, shared with Tanks)

Deep water
(fading in from 2.5 m to 10 m depth) takes its detail normals from a
Tessendorf FFT: a 64 m patch (256² High, 128² Low) sampled twice at different
scales and a rotation, scaled with the storm's wave height. The tiled ripple
normals stay at full strength over the shallows, because the caustics pass
splats exactly those, and at half strength in the deep for detail finer than
the FFT grid. The FFT runs every frame (spectrum, 2·log₂N butterfly passes,
resolve with mipmaps); its targets are filed under "water" in the pass timer.
Each pass writes its result through `fragmentNode`, not `colorNode`: the
colour path clamped every channel at 0 and forced alpha to 1, which turned the
signed spectrum into garbage (a straight band of nonsense slopes across the
water in both games). Checked by reading the target back and comparing with a
CPU DFT of the same spectrum (max difference 2·10⁻⁴).

**Domain warp against tiling** (`render/waveWarp.ts`, shared file for file by
the lagoon and Tanks; after ClearWater6.1's `wave_warp`, SamG-Coder, MIT). Even
two rotated lookups of a 64 m patch show their period as a grid towards the
horizon. Look the patch up at `xz + (n₁ − ½, n₂ − ½)·A` instead, with n₁, n₂ two
C²-continuous (quintic) value noises over cells four patches wide and A ≈ 0.7 of
the patch, and carry the slope through the warp's Jacobian
`(I + A·∇n)ᵀ` so the normals still belong to the drawn surface. Cost: eight
hashes and a few multiplies per pixel.

### 7.10 Sun glints by pixel footprint

A fixed specular exponent either sparkles (single pixels flicker on and off far
out) or is dull near the swimmer. Take the footprint `f = |fwidth(p.xz)|` (metres
of water per pixel) and set the exponent to `mix(90, 900, 1/(1 + 800 f²))`,
scaling the lobe's amplitude with the exponent so its energy stays constant:
a tight star close by, a soft glitter path far out, no aliasing in between
(ClearWater6.1). On a lit material (Field Line's lake) do the same through the
roughness: `0.04 + 0.18 · (1 − 1/(1 + 800 f²))`.

### 7.11 Sand ripples on the shallow bed (lagoon `render/ground.ts`)

Wave-formed ripples about 20 cm apart, after ClearWater6.1's `sand_relief`:
`h = A(cos φ + 0.18 cos(2φ + 0.6))` (sharp crests, flat troughs) with
φ = k·(xz·d) + bend, d the swell's propagation direction from the baked shore
field, bend a slow noise, plus a weaker family 26° off. The normal comes from the
analytic gradient (never tiles); weight it by sand coverage, 0.1–4 m depth,
swell exposure and `1/(1 + 600 f²)` so it cannot shimmer. Under water the
caustic light dominates, so tilt the caustics' N·L by the same gradient, or the
ripples barely show.

### 7.12 Screen-space reflection on water (`render/screenReflection.ts`, High only)

The sky alone is a poor mirror: at the grazing angles where Fresnel makes water
most reflective, the palms, pines, rocks and boats belong in it. The water is
drawn after the opaque scene, so it can march its own reflected ray: 20 points
along it in world space (0.3 m growing ×1.45, out to ~350 m), each projected to
the screen and compared with a copy of the depth buffer; a point less than a
step's thickness behind the scene is a hit, refined by 4 bisections; the scene
colour there is the reflection, faded over the last tenth of the screen edge and
mixed over the analytic sky by its weight. Rules learnt:

- **Unroll it**, no `Break`: WGSL forbids implicit-LOD sampling in non-uniform
  control flow. Only assignments go inside `If`.
- **The depth copy must match the depth buffer's format.** three's shared
  `viewportDepthTexture()` copy is `depth24plus`; a reversed depth buffer is
  `depth32float`, and every frame's copy then fails ("Source and destination
  formats do not match"). Construct `new ViewportDepthTextureNode(uv, null, t)`
  with your own `DepthTexture` whose `type = FloatType` when
  `builder.renderer.reversedDepthBuffer`.
- **One base depth node, sampled through `.sample(uv)` clones.** Each viewport
  texture node keeps its own copy of the framebuffer when drawing into a render
  target, so 24 separate nodes meant 24 copies and 24 texture bindings (WebGPU
  allows 16 per stage: the water pipeline was invalid). Clones made by
  `.sample()` share their base node's copy and binding.
- **Capture loop values before `If`.** TSL runs an `If` body later, when the
  shader is built, so a JS `let` changed by the unrolling loop is read at its
  final value in every branch (all twenty branches stored the last step's
  bounds and no hit ever refined). Copy it into a `const` inside the loop body.
  Likewise freeze a bisection midpoint with `.toVar()` before reassigning the
  bounds it is made of.
- `perspectiveDepthToViewZ` already handles reversed depth.
- Thickness grows with the step (`max(0.5 m, 1.2 × step)`) so thin trunks are
  hit but a ray passing far behind a foreground rock does not pick it up.
- **Check that the refined point lies on the surface.** A true intersection
  converges: ray depth and scene depth meet. A ray that only passed behind an
  edge converges onto the depth discontinuity and the gap stays wide; drop the
  hit when the gap exceeds about the final interval (it painted bright sand
  patches far out in the water).
- Debug it with false colour, not by eye: write `found`, the gap, the hit
  distance or the hit's height into the reflection channels, and show the
  mirror alone (`mix(under·0.2, reflection, max(fresnel, weight))`). Long
  vertical streaks of bright objects on rippled water are physical (the
  ripples tilt the rays), not a bug.
- Used by the lagoon (water shader), Field Line (lake emissive, the probe's
  specular scaled by `1 − weight`) and Tanks (lakes).
- The frame governor switches it off through a uniform (a branch on a uniform
  is uniform control flow) right after the sun shafts, before resolution.

### 7.12b A planar mirror for calm lakes (Tanks `render/planarMirror.ts`, High only)

SSR cannot mirror what is not on screen, so the hills behind a lake and the sky
over a town were missing from the reflection. On a calm lake the whole far shore
should stand in the water upside down. The fix is to draw the scene once more
from the camera reflected in the water plane, at half resolution, and have the
water sample that image at its own screen position (x mirrored) shifted by the
wave normal: `n.xz · 0.05 / (1 + 0.015·d)`.

- **Not three's `reflector()` here.** Inside the MRT scene pass on the WebGL2
  backend it rendered nothing. Its oblique near plane also assumes a standard
  depth range, and with a reversed depth buffer it clipped the whole image.
  `node.sample(uv)` has a further trap: the clone keeps its own default
  texture, while the reflector only updates the original node.
- **Render it yourself before the frame**, outside any pass, with `setMRT(null)`.
  Reflect the eye, the look-at point and the up vector in the plane.
- **Use the reversed-depth oblique frustum.** Replace row 3 with `row4 − a·C`, with
  C the water plane in view space, so the near test `z_c ≤ w_c` becomes
  `a·(C·v) ≥ 0`. Pick `a = (row4·q)/(C·q)`, with q the frustum's far corner
  (NDC z = 0 when reversed), so the far plane still passes through q. Check the
  mirror target's pixels: sky at the bottom, the treeline, then the clipped
  half.
- **Keep the second draw cheap.** Hide the water and the grass, and set
  `shadow.autoUpdate = false` on the sun and the cascade lights: the cascades
  fit the main camera, so the main pass's maps serve as they are. Skip the
  mirror when no lake is near or the eye is underwater. Draw it once during
  the loading warm-up, so its plain-target pipelines compile then. When the
  frame governor drops reflections, stop rendering it and fall back to the sky.

### 7.12c Terrain that reads like an aerial photo (Ridgeline `render/landCover.ts`)

A real DEM with an orthophoto beats noise because the colour follows the relief:
snow lies in gullies and on north faces, scree fans out under the cliffs, grass
is damp in hollows and dry on spurs. Bake the relief and paint by it:

- **Curvature in the normal map's alpha.** For the near grid use a ±40 m
  Laplacian, computed in one pass on the main thread after the bake; tanh with
  a gain set so the 10th/90th percentiles land near ∓0.55. A 10 m stencil
  mostly sees the knolls, not the gullies a helicopter sees.
- **Snow from height plus aspect plus relief.** The snow line drops about 240 m
  on a north face and about 260 m in a gully, rises on ridges, and breaks into
  patches with a 400 m noise. On cliffs, snow stays only on the strata ledges
  and in gully streaks.
- **Scree** where a hollow meets a 35–45° slope, above the fields and the
  forest: pale and speckled, faded out before it aliases.
- **Damp green in gullies, dry yellowed sward on ridges**, on the open slopes
  only.

### 7.13 A wake that lasts (lagoon `render/wakeFoam.ts`)

From the seaplane scene *Halcyon* (an AI-made three.js demo): what sells a
moving hull is not the bow wave but the white trail it leaves, widening and
tearing into lace far behind. The ripple field (§7.7) cannot hold it: its
window is 24–32 m and it only knows how stirred the water is *now*.

- A second CPU field round the camera: 0.5 m cells, 192² on High (96 m),
  one R8 texture. Each 1/15 s step: `f ← (f + k·∇²f)·e^(−Δt/τ)` with
  τ = 9 s and diffusion 0.05 m²/s, so a trail widens as it thins. Re-centre
  by whole cells as for the ripples; stop stepping once everything is under
  0.004 and upload one clear frame.
- Stamp along the segment each source moved since last frame (every 0.3 m,
  the amount shared out) so a long frame leaves no gaps; a jump over 8 m is
  a teleport and stamps once. The transom (propeller wash, by throttle and
  speed) and both quarters (by speed²) are sources; every splash leaves a
  patch of bubbles too.
- A source leaves about `rate × 0.5 m / speed` per cell: aim for ~0.7 at
  cruising speed. At 1.2+ the whole trail is a white sheet; the look is a
  white core with lace at the edges.
- The water shader feeds the amount to the surf's `laceCover` (own offset and
  scale so it never repeats the surf's net): thin foam is lace, not grey.

---
## 8. Phones: budget and stutter-proofing

Target here: a Pixel 9 Pro XL in an Android WebView (WebGL2 fallback is common).

**Lesson:** "the picture looks low-res on the phone" was the 1× pixel-ratio cap
on touch screens, not a missing effect. Render phones at 2× (sharp on any screen
a hand holds; native 3× would triple the cost), keep TRAA on every preset, and
let the frame governor take the resolution down when it must. Contrail exposes
the choice as High / Balanced (cheaper effects, still 2×) / Fast (1×).

### 8.1 Presets

| Setting | High | Low (default on touch devices) |
|---|---|---|
| Pixel ratio | device (up to 4) × render scale; 2 on touch screens | 2 on touch screens (a "Fast" preset: 1) |
| TRAA + sharpen | on, sharpen 0.3 | on, sharpen 0.25 (the velocity target is drawn anyway; FXAA left the phone picture soft) |
| Frame governor floor | render scale 0.58 | render scale 0.42 (steps 0.5, 0.42 added for 2× phones) |
| Sun shafts | 16+ samples | 0 samples (pass skipped) |
| Shadows | 4 cascades, 2048–4096 px | 2 cascades, 1024 px |
| Leaf translucency | on | off |
| Tree LOD / shadow ring | 110 m | 60 m |
| Grass density / draw distance | 1 × / 48 m | 0.3 × / 26 m |
| Undergrowth, jungle cards, far trees | full | thinned |
| Caustics target / grid | 256² / 128 | 128² / 64 |
| Environment probe | 256 px | 128 px |
| Auto-exposure readback | every 6th frame | every 6th frame |

### 8.2 Budgets to watch

- **≤ 16 sampled textures per shader stage** (see §2).
- **Draw calls × shadow cascades**: every shadow-casting mesh is drawn once per
  cascade. 256 small chunks × 4 cascades tripled the draw calls; one streamed
  mesh per kind fixed it.
- **Triangles in shadow passes**: cast shadows only from what is near.
- **Overdraw** of alpha-tested grass and leaves: density and draw distance on Low.
- **GPU→CPU readbacks**: throttle.
- **Load time**: its own budget and its own traps, §8.4.

### 8.3 Stutter: build every pipeline behind the loading screen

"Stutters now and then" on a phone is almost always a **shader or pipeline built
mid-game**. The three.js r186 rules we had to learn:

1. **Warm up by rendering, not with `renderer.compileAsync`.** `compileAsync`
   skips hidden objects and objects outside the frustum and compiles for the
   plain framebuffer, not for the post chain's scene pass (half-float colour +
   velocity MRT), so a real frame was always needed as well. Worse, in r186 it
   handles its objects one after another, yielding to the browser between each
   and awaiting each pipeline in turn: on WebGPU it settled one pipeline and
   then sat out its whole timeout (20 s here, on every load), and with the
   timeout removed it was still slower than no precompile at all (§8.4, table).
   All five games now go straight to the warm-up frames.
2. The shader cache key includes: the material, the vertex layout (attribute names,
   item sizes, normalisation), `receiveShadow`, the **light set** (which lights,
   which cast shadows), `scene.environment`/fog — and, for an instanced mesh
   whose matrices fit a uniform buffer, **the mesh itself** (§8.4 item 3 removes
   that for static meshes).
3. **Warm-up** (`render/warmup.ts`, identical in every game): traverse the scene,
   take **one object per cache key**, force it (and its ancestors) visible,
   un-culled and with `count ≥ 1`, render the real pipeline once, restore.
   An object that must never be revealed (a procedural body an imported one
   replaced, whose layout would exceed the vertex-buffer limit) carries
   `userData.noWarmup = true`.
4. **The scene pass renders at most once per animation frame** (three's
   `NodeFrame.frameId` advances in the renderer's own animation loop). Our
   warm-up first rendered a normal frame and then the reveal frame *in the same
   animation frame*, so the reveal frame drew nothing and nothing hidden was ever
   compiled. **Await a `requestAnimationFrame` between them.**
5. **Warm up with instanced meshes non-empty** (fill streams at the spawn).
6. **Every camera that draws the scene warms up too**: a scope, a mirror, a
   sensor view render the same objects through their own render contexts. Give
   such a target the scene pass's formats, MRT and sample count (§8.4 item 4) and
   it builds nothing of its own; left different, Field Line's scope built 41
   pipelines the first time the player aimed (a 10 s freeze on a phone).
7. Everything that can appear later must exist in the scene at load: holstered
   weapons, the first muzzle flash, decals, particles, rain, night lights (at
   intensity 0), prop "gallery" copies. Never add a light or toggle `castShadow`
   during play.
8. Share materials between props (a cache), never create a material or a canvas
   texture mid-game.

**Proof it worked** (§9.3): the pipeline count after loading stays constant
through equipping weapons, aiming each sight, firing, storm, night, turning
around and teleporting across the map.

### 8.4 Loading time

Players said it first: "the games take long to load, on the PC and on the
phone". Loading is a budget like the frame is, and it has three parts that
need three different tools (`tools/measure/`, §9.1b):

| Part | Seen with | What it was here |
|---|---|---|
| Main-thread work: terrain, scatter, procedural textures | `profile.mjs` (CPU profile by function and file) | Lagoon: 15 s of a 110 s software-GPU load in one noise function |
| Uploads: images and canvases into GPU textures | `load.mjs` (each `copyExternalImageToTexture`, by source kind and size) | Lagoon: 56 s in 75 uploads, 47 s of it six canvases |
| Pipelines: one shader build per material × layout × pass | `load.mjs` (pipelines and modules per `[load]` stage, and "gpu idle") | Lagoon 559 builds, Field Line 208 |

**"Ready" is not loaded.** Pipelines are built on the GPU's side; the game
reports ready and the first seconds still stall. `load.mjs` waits on
`GPUQueue.onSubmittedWorkDone()` after ready and prints **gpu idle**: that is
the loading time a player feels, and the number to compare.

What cut it, in the order of what it gave:

1. **No `compileAsync` precompile** (§8.3 item 1). Seconds to gpu idle on
   software WebGPU, with the old precompile / a parallel one / none:

   | Game | old | parallel | none |
   |---|---|---|---|
   | Field Line | 70.9 | 74.6 | 59.1 |
   | Lagoon | 159 | 190 | 148.5 |
   | Tanks | 75.6 | 65 | 55.6 |
   | Ridgeline | 24.6 | 29 | 24.6 |
   | Contrail | 21.1 | 27.1 | 21.1 |

2. **Canvases drawn once are made in memory**:
   `canvas.getContext('2d', { willReadFrequently: true })`. A 2D canvas lives on
   the GPU by default, and copying it into a WebGPU texture reads it back across
   contexts: 8 s per 2048² atlas on a software GPU, and the first such copy pays
   to set the path up whatever its size (a 128 × 170 label: 5.9 s). In memory
   the same 75 uploads took 0.6 s instead of 56 s. For atlases, labels, signs,
   leaf cards, decals: anything drawn at load and then left alone. **Not** for a
   canvas redrawn every frame (cockpit displays, a minimap): there the GPU does
   the drawing, and moving it to the CPU could cost more than the copy saves —
   measure before changing one.
3. **Static instanced meshes share their shaders** (`render/instancing.ts`).
   r186 hands an instanced mesh's matrices to the shader in a uniform buffer
   while they fit one (64 KiB: 1024 matrices) and declares that buffer under the
   mesh's own name and length, so every such mesh built its own shaders in the
   scene pass, in each shadow cascade and in every second camera, though most
   share a material with others: 333 of Lagoon's 559 builds. Past the limit the
   matrices come as a vertex attribute, declared alike for every mesh.
   `markStaticInstances(mesh)` on a mesh filled once (plants, rocks, props,
   parked cars, a skyline), then `shareStaticInstanceShaders(renderer, scene)`
   before the first frame, gives each room for one matrix past the limit:
   nothing more is drawn, the cost is ~130 KiB of memory per mesh. Lagoon
   144.1 → 117.8 s (60 meshes), Field Line 75.5 → 71.5 s (5 meshes). Not for
   meshes refilled every frame (they would upload the whole larger buffer), nor
   for one whose layout would then pass WebGPU's 8 vertex buffers (the function
   skips those).
4. **A second camera's target is a twin of the scene pass's**
   (FL `stage.sceneTargetLike`, `optics.ts`): cloned from the pass's own render
   target after its first frame (three sets its sample count and its colour and
   depth types then), with the same MRT, and with the velocity node given the
   second camera's unjittered projection as TRAA gives it the main one's — the
   projection is part of the generated shader. Keep the textures' names: the MRT
   finds its outputs by name, and a renamed colour texture has no output
   ("getNodeType of undefined"). Field Line's first aim through the scope: 41
   pipelines and 27 s on the software GPU before, none after.
   **Only for a camera drawn now and then.** The twin also writes the scene
   pass's other outputs (velocity, normal) and works out every vertex's
   previous position. Tanks' water mirror, drawn every frame on High, as a
   twin: 321 → 285 pipelines, GPU idle at load 114 → 104 s, but frames
   5–9 % slower (alternated runs, 2026-11-11). Rejected: the patch is in
   `docs/wyniki-testow/2026-11-11/tanks-lustro/`. For a mirror, warm it with
   the same objects hidden as in play, and keep out of it any material with
   its own `mrtNode` (next item).
4a. **A material's own `mrtNode` needs an output in every target it is drawn
   into.** Outputs are matched to the target's texture names; with none
   matching, the fragment shader's output struct is empty and fails to compile
   ("structures must have at least one member"), and the invalid pipeline
   voids the command buffer it is in. Tanks' rain (`mrtNode {normal,
   velocity}`) drawn into the water mirror (one texture, "water mirror") did
   this on High; the rain is now hidden from the mirror.
5. **Noise without trigonometry** (`core/noise.ts`): gradient noise took a
   cosine and a sine per lattice corner; a 65 536-entry table of directions,
   indexed by the hash's top bits, gives the same field to within 4·10⁻⁵
   (heights move by a millimetre) four times faster. Lagoon's island stage
   5 s → 1.5 s, undergrowth 8 s → 1.8 s.
6. **Compute once what two systems share**: the near ground mesh and the grass
   field stood on two copies of the same 103 000-sample height grid; the
   wave-field solver's per-cell allocations (1.9 s → 0.4 s). The profile by file
   shows these as one function reached from two callers.
7. **Tell the player, and yourself**: each stage logs `[load] <stage>: <s>`, and
   the pause menu shows "Loaded in X s" with the four longest stages
   (FL `main.ts`, `ui/menu.ts`), so a slow phone reports where its time went
   without a cable.

What is left, and what it would take (not done here): the count of pipelines
itself (one material per kind of surface with switches as uniforms, instead of
a material per prop), baking the remaining per-start generation to files, and
compressed textures for the rest (KTX2: the photographed sets and the cars' GLB textures are still
decoded to RGBA8, four times the memory and upload of a block format; the characters' atlases are done,
below).

**State on 2026-11-10** (Field Line, High, software WebGPU, `tools/measure/load.mjs`; the baseline of
`docs/przebudowa-gier-aaa.md` stage 0 — later changes are compared with it):

| Map | Pipelines | Shader modules | Image uploads | Ready | GPU idle |
|---|---|---|---|---|---|
| range | 156 | 215 | 38, 0.10 s | 30.7 s | 60.2 s |
| forest | 170 | 231 | 42, 0.22 s | 56.8 s | 114.8 s |
| city | 204 | 273 | 120, 0.36 s | 113.6 s | 128.4 s |

Low preset, and texture memory (`load.mjs` wraps `GPUDevice.createTexture` and counts a texture as
*uploaded* once `writeTexture` or `copyExternalImageToTexture` fills it; everything else is a render target,
a bake or a shadow map. Usage flags cannot tell them apart: three sets RENDER_ATTACHMENT on most textures):

| Map | Pipelines High / Low | Ready / GPU idle, Low | Uploaded textures High | Low | Render targets High |
|---|---|---|---|---|---|
| range | 156 / 118 | 25.3 / 40.1 s | 336 MB | 207 MB | 175 MB (Low 52) |
| forest | 170 / 129 | 39.5 / 66.6 s | 392 MB | 264 MB | — |
| city | 204 / 166 | 90.1 / 103.4 s | 1265 MB | 320 MB | — |

The city's High figure is mostly the parked cars: 45 GLB textures at 2048², about 960 MB as RGBA8 with mips.

Draw calls and triangles at the benchmark spots (`scripts/benchView.mjs --gpu webgpu --no-present`; without
`--no-present` this headless Chrome loses the WebGPU device and every row reads 0):

| Map | High: calls (spots) | High: triangles | Low: calls | Low: triangles |
|---|---|---|---|---|
| range | 146 / 105 | 1.16 M | 107 / 77 | 0.49 M |
| forest | 167–224 | 6.8–8.3 M | 103–123 | 3.0–3.5 M |
| city | 573–742 | 15.9–16.5 M | 288–328 | 8.2–8.3 M |

The other four games (`load.mjs`, High / Low, software WebGPU, 2026-11-10):

| Game | Pipelines | Ready / GPU idle | Uploaded textures | Render targets |
|---|---|---|---|---|
| Castaway Lagoon | 268 / 233 | 79.9 / 93.5 s; 65.1 / 70.8 s | 540 / 411 MB | 454 / 56 MB |
| Tanks | 321 / 171 | 72.0 / 94.2 s; 43.6 / 50.5 s | 185 / 184 MB | 156 / 55 MB |
| Contrail | 69 / 64 | 24.0 / 29.6 s; 18.3 / 21.6 s | 184 / 184 MB | 95 / 74 MB |
| Ridgeline | 64 / 62 | 31.3 / 38.3 s; 22.4 / 25.4 s | 85 / 77 MB | 117 / 82 MB |

Read across: the city's 16 M triangles and 700 draw calls on High are the largest frame cost in the five
games (stage 1b, levels of detail, starts there); Tanks builds the most pipelines (321, stage 1c); Lagoon's
High carries 454 MB of render targets. Tanks High logs a WGSL error ("structures must have at least one
member", a `MeshBasicNodeMaterial` pipeline) before any of this stage's changes (found and fixed in stage
1c: the rain drawn into the water mirror, §8.4 item 4a). Still to add: the phone's
own numbers.

**KTX2 pilot (stage 1a): the characters' atlases.** The MPFB soldiers' atlases were drawn into a canvas
at every start (2048² per character near, 512² far: RGBA8, a third more with mips) from about 60 piece
textures. They are baked now (`tools/assets/bake_atlases.mjs`): the game is opened with
`globalThis.__keepAtlases`, the drawn canvases are read back and encoded with Basis Universal (npm
`ktx2-encoder`), and `mpfbCast.ts` loads `<name>.ktx2` through `KTX2Loader`, falling back to drawing when a
file is missing or fails. The piece textures leave the game's build (a `vite build --mode bake` build
carries them for the baker). Measured on Field Line:

| | Before | KTX2 |
|---|---|---|
| Forest, High, uploaded textures | 392 MB | 290 MB (34 MB block-compressed) |
| Forest, Low | 264 MB | 258 MB (Low draws the far atlases only) |
| Range, High / Low (ready, GPU idle unchanged: 28.0 → 28.3 s, 56.9 → 55.1 s) | 336 / 207 MB | 234 / 201 MB |
| Pipelines, forest High | 170 | 170 |
| Forest High, ready / GPU idle (two clean rounds) | 115.0 / 151.4 s, 55.5 / 133.6 s | 105.2 / 141.4 s, 49.6 / 104.1 s |
| Build (dist) | 65.7 MB | 66.7 MB (+1.0: atlases 10.7, transcoder 0.6, pieces −10.3) |

Choice of format, measured on the rifleman's near atlas (RGB PSNR against the drawn atlas, file): ETC1S
q200 35–36 dB, 0.37 MB, blocky up close on faces and insignia; UASTC 48–50 dB, 2.0 MB; **UASTC + RDO 1
45.6 dB, 1.65 MB** (taken); RDO 2 43.3 dB, 1.54 MB; RDO 4 41.1 dB, 1.44 MB. The far atlases (seen small)
take ETC1S at ~50 KiB. On a device the transcoder picks ASTC 4×4 for UASTC and ETC2 for ETC1S (BC7 / BC1–3
on desktops); a device with none of them gets RGBA8 back, correct but without the saving. Checked on
both backends: WebGPU and the WebGL2 fallback show the same atlas pixels (a one-plane test page; the whole
game does not reach ready on headless WebGL2 within 7 minutes, with or without KTX2). The build grows
by 1.6 MB: UASTC carries more bits than the JPEG/PNG pieces did. That is the price of a texture the
GPU reads directly; it is paid once on disk and saves on every start and in every frame's memory.

**Repeated (P7): Lagoon's and Tanks' characters, and the cars.** Lagoon bakes its own band
(`castaway-lagoon/src/render/guerrillaCast.ts`, the same bake as Field Line); Tanks loads Field Line's
far atlases directly (one `mpfbCast.ts` in both games, so the same layout). The nine parked car models of
`shared/vehicles` (Field Line's city, Paris) had their textures re-encoded inside the GLB
(`tools/assets/ktx2_glb.mjs`, `KHR_texture_basisu`): near level `auto` (ETC1S, and UASTC where ETC1S falls
below 40 dB: the headlamp atlas at 28.6 dB, most wheel roughness maps, three bodies), the far levels ETC1S
throughout (seen from afar; 30–46 dB). Software WebGPU, the texture formats a desktop GPU takes (see the
trap below), two or four alternating runs each:

| | Uploaded textures before → after | GPU idle before → after | Build |
|---|---|---|---|
| Field Line city, High | 1265 → 506 MB (432 MB with ASTC/ETC2, as on a phone) | 125.5, 126.7 → 121.2, 127.5 s | 65.7 → 73.1 MB (cars +6.4, atlases +1.0) |
| Field Line city, Low | 320 → 262 MB | not compared (one run after, 87.7 s with ASTC) | |
| Castaway Lagoon, High | 540 → 438 MB | mean of 4: 93.5 → 94.6 s (noise; loading the band +0.3 s) | 34.0 → 32.1 MB |
| Tanks, High | 185 → 179 MB | 88.4, 86.8 → 81.7, 84.4 s | 34.9 → 35.2 MB |

Pipelines unchanged everywhere. A parked car at 3–5 m, before and after, High and Low: mean difference
0.7/255, the differing pixels on edges only (anti-aliasing jitter), not on paint or lamps. Paris loads the
same two cars through the same loader (its build 34.6 → 37.1 MB).

**The other downloaded models** (2026-11-10). Every game's glTF loader now comes from one `render/gltf.ts`
(`modelLoader()`, one shared KTX2 loader, set once after `renderer.init()`; Lagoon starts its renderer
before loading models for this). Re-encoding all of them measured (software WebGPU, BC formats,
alternating runs): Field Line range 234 → 126 MB, Lagoon 438 → 288, Tanks 179 → 65, Contrail 184 → 94,
Ridgeline 85 → 77; GPU idle unchanged within noise except Contrail +2 s (the jet fills the chase view, and
SwiftShader samples BC7 27 % slower than RGBA8); but the builds grew by 15, 20, 14, 7 and 5 MB. UASTC is
8 bits a texel and zstd packs it ~1.5×; detailed maps (normal maps, worn metal) go UASTC throughout and a
weapon's file grows 4–5× (the AK 1.6 → 7.5 MB). The user's rule: **keep KTX2 where a model saves at least
10 MB of GPU memory per MB of file**. Kept: cargo_truck, staff_car, mbt_west, ifv_west, jeep_open,
boat_cutter, jet_talon, jet_wraith, pistol_9mm (and sport with the cars). Back to JPEG: the AK, carbine, bolt
rifle, knife, skiff, Bulat, BMP, T-90 and the Warden (estimated 27 MB, measured 8: Ridgeline draws only
some of its maps; Ridgeline keeps its old loader). Result, one run each against the stage-0 builds:

| Game | Uploaded textures | Build |
|---|---|---|
| Field Line (range, High) | 234 → 198 MB | 73.1 → 75.6 MB |
| Castaway Lagoon (High) | 438 → 380 MB | 32.1 → 36.8 MB |
| Tanks (High) | 179 → 97 MB | 35.2 → 41.6 MB |
| Contrail (High) | 184 → 94 MB | 21.8 → 28.9 MB |

**Stage 1b, first step: the far cars' shadows from lod2** (2026-11-11). `tools/measure/passes.mjs` splits
a frame's draw calls and triangles by pass and object. The city on High drew 16.5 M triangles, 13.5 M of
them in shadow passes (four sun cascades and the weapon light), 9 M of those the far parked cars: lod1,
every car on the map, in every cascade (instanced and unculled). A visible third level (lod2 beyond
120 m) cut the triangles to 10.6 M but raised the draw calls from 742 to 913 (one per part, pass and
model; 854 with bounding-sphere culling), so it was dropped. Taken instead: **a shadow-only stand-in**.
The view keeps lod0/lod1; the far lod1 stops casting; lod2 casts in its place from a camera layer only
the cascades draw (`render/layers.ts`: a shadow camera whose mask holds only layer 0 copies the view's
mask each frame, so giving it a second bit makes it keep its own; CSMShadowNode clones the sun's shadow
per cascade, layers included). The stand-in takes lod1's material (the cascades draw with their own
depth material anyway; lod2's would upload 18 more textures). High: 16.5 → 9.7 M triangles (shadows
13.5 → 6.6 M), draw calls 742 → 715, pipelines and texture memory unchanged, GPU idle unchanged (alternating
runs). Low (one set of cars, 1024² cascades): every car's shadow from lod2, 8.3 → 5.6 M triangles, same
draw calls. Screenshots show no difference in the cars or their shadows (`docs/wyniki-testow/`).

**The same for the forest's scans** (2026-11-11): rocks, stumps and the fallen trunk (1500–2500 triangles
each, instanced over the whole map) were 2.6 M of the forest's 5 M shadow triangles on High. Their stand-ins
come from `tools/assets/shadow_mesh.mjs`: welded by position (the scans split vertices at UV seams),
simplified with meshoptimizer to 2 % of the mesh's size in error (256–847 triangles, a centimetre or two
on a stump, under a near cascade's texel), written beside the scan as `<name>_shadow.bin`. High 7.7 → 5.7 M
triangles, Low 3.5 → 2.6 M, draw calls and pipelines unchanged, GPU idle unchanged, 97 KB of files. A
screenshot cannot isolate the change in a forest: the canopy's sunflecks move with the wind between runs;
the error bound is the check.

**Ridgeline's column: draw calls, not triangles** (2026-11-11). `passes.mjs --game ridgeline` showed
1632 draw calls a frame on both presets for 1.2 M triangles: each target vehicle was dozens of small
meshes (757 calls for the fittings alone). The template of each kind is now merged after its AO bake,
one mesh per material and shadow flag, the hull in the vehicle's space and the turret in its own
(`targetView.ts` `mergeByMaterial`; the materials read only position, normal and the baked `ao`, so the
uvs go and every part becomes non-indexed). 1632 → 234 calls, pipelines 64 → 56, triangles and the
picture unchanged. Build any detailed vehicle or prop from parts, then merge it before it is cloned.

**Tanks' terrain chunks** (2026-11-11): 256 chunks of 128 m, each its own draw call in the view, the
water's reflection and the cascades (~310 in the view of the frame's 985). Chunks at LOD 2 and coarser
are now merged per region of 2 × 2 chunks and level (`world/terrain.ts`), rebuilt when a chunk changes
level; the near ones stay as they were. 985 → 742 calls on High, 496 → 374 on Low, triangles +0.6 %.
Bigger regions cut more calls but cost triangles (a region is culled whole: 4 × 4, 679 calls and +1.6 %;
one mesh per level, 626 and +4 %; 256 m chunks, 671 and +7 %, since a chunk takes its nearest point's
detail). Trap: the warm-up renders hidden meshes to compile them, so an empty merged mesh (no attributes)
built three pipelines of its own; keep empty ones out of the scene.

**And Lagoon** (2026-11-11): its boulders the same way (1 % error for the big ones, which are metres
across), and the jungle's trunks with a stand-in built in the same function from the same random draws
(half the rings, 6 sides for 9, the same sway attributes so the shadow moves with the trunk). High
13.4 → 12.2 M triangles, Low 5.4 → 4.6 M, draw calls and pipelines unchanged, GPU idle 7 % shorter. The
ferns (2.7 M shadow triangles on High) stay: their shadow comes from the leaves' cut-out, which a
stand-in without the leaf texture's uvs would lose.

The cars' GLBs grow by 6.4 MB because the near level keeps UASTC where ETC1S would show (lamps, sharp
edges); the far levels stay at the JPEGs' size. Every game that loads one of these files needs
`GLTFLoader.setKTX2Loader`: check with `grep -rn "<model>_lod"` before re-encoding a shared model.

**Traps**

- A software GPU compiles 5–20× slower than a phone and uploads differently:
  the counts are exact, the seconds only rank runs on one machine. The canvas
  change above moved 55 s of main-thread time and 15 s of the total: the main
  thread had been waiting where the GPU was the limit anyway.
- Vite emits every file an `import.meta.glob` names, even in a branch that can never run. To keep files
  out of the game's build, put the glob in its own module and import it dynamically behind
  `import.meta.env.MODE === 'bake'` (FL `soldierTex.ts`): Vite drops that branch and the module with it.
- `KTX2Loader.detectSupport(renderer)` asks the renderer which compressed formats the device has; call it
  after `renderer.init()`, or it sees none and transcodes everything to RGBA8. Leave the transcoder path unset:
  three r186's loader then points at its own `basis_transcoder.js` / `.wasm` with `new URL(…, import.meta.url)`,
  which Vite emits into the build (the APK works offline). Setting a path *and* copying the files into
  `public/` ships them twice (0.6 MB each time), as the first version of the pilot did.
- **Shadow cascades draw every caster again**, per cascade: an unculled instanced mesh spread over the
  map (`frustumCulled = false`, as for instances that move between levels) goes into all of them. Count
  them with `tools/measure/passes.mjs`; a coarser stand-in on a shadow-only layer cuts their triangles
  without a draw call (see stage 1b above). A visible extra level adds a call per part, pass and model.
- **A software GPU makes compressed textures look slow.** SwiftShader offers ASTC and ETC2, so KTX2Loader
  picks ASTC, and SwiftShader decodes ASTC and ETC2 on every texture read: twelve full-screen 1024² draws
  took 580 ms (ASTC) and 549 ms (ETC2) against 200 ms for RGBA8 and 255 ms for BC7, while the uploads were
  3–5× faster. The city's cars measured +7 s with ASTC and nothing with BC7. Measure KTX2 with
  `load.mjs --hide-features texture-compression-astc,texture-compression-etc2` (the desktop's formats);
  a phone samples ASTC in hardware. Alternate the runs (before, after, after, before): this machine slows
  over a series, and a fixed order once read as a 5 % loss that the reversed order turned into a gain.
- A baked atlas is a copy of a layout. Bake again after changing a character, a piece texture or the
  atlas layout; a stale one puts the wrong picture under the uvs (and loads without an error).
- Do not edit sources while a headless run uses the dev server: hot reload
  restarts the page mid-measurement. Measure a build (`tools/measure/serve.mjs`).
- A table lookup changes results in the last digits. Terrain is consistent as
  long as logic and rendering call the same function (§0); do not mix the old
  and the new noise in one world.

---

## 9. Verification

### 9.1 Every change

1. `npx tsc --noEmit -p .` and the unit tests (`npx vitest run`).
2. A production build served statically (`vite build --outDir …`, `npx
   http-server …`). **Not** the Vite dev server for screenshots: HMR reloads kill
   long headless runs.
3. Headless Chromium with SwiftShader
   (`--use-angle=swiftshader --enable-unsafe-swiftshader`), `?autostart&debug`
   hooks to skip the menu, script input and read stats. SwiftShader is slow
   (minutes per frame with vegetation): keep the viewport small for numbers,
   640×360 for looks, and give screenshots long timeouts.
4. Look at the image. Then take **frames several seconds apart** for anything that
   moves (waves, swash, foam, caustics).
5. **Phone emulation**: a context with `deviceScaleFactor: 3, isMobile: true,
   hasTouch: true` at ~800 × 380 checks the touch layout and that the canvas
   really renders at 2× (`canvas.width / clientWidth`).
6. **Do not judge flight or driving behaviour headless**: SwiftShader's frame
   rate makes wall-clock key presses a fraction of their simulated length (§14).
   Fly the simulation in unit tests and use the browser for pictures only.

### 9.1b The scripts (`tools/measure/`)

One folder, no dependencies beyond Playwright, for any game here and for a new
one that keeps the debug contract (§0b):

| Script | Answers |
|---|---|
| `serve.mjs <dir> [port]` | serves a production build (never measure through the dev server) |
| `shots.mjs --game … --views '[…]' --out …` | screenshots at fixed views, before and after a change; `--extra '&q=low'`, `--gpu webgl` |
| `load.mjs --game …` | loading: the game's `[load]` stages, pipelines and shader modules per stage, slow image uploads, ready and **gpu idle** (§8.4) |
| `profile.mjs --game …` | CPU profile of loading by function and by source file |

The per-game `scripts/benchView.mjs` (frame cost at the benchmark spots, §9.2)
stays where it is.

### 9.2 Numbers to log: the measurement routine

`drawCalls`, `triangles` (from `renderer.info`), CPU and GPU frame time per
pass, load time — and for any performance change **the same numbers before and
after at the same fixed views**. All three games share `render/perf.ts` file
for file:

- **Fixed benchmark spots** (`app/bench.ts` per game): spawn, spawn turned
  round, and the heaviest views of the map (Field Line: squad ground,
  extraction, the lake; Lagoon: shore, jungle, outpost deck, islet). A spot is
  a position and a look direction, nothing random.
- **Benchmark run**: pause menu → *Benchmark* (on the phone, where real numbers
  come from), or `?autostart&bench` in a browser. Logic is paused, the
  governor is off, each spot settles 45 frames (streaming, exposure, a GPU
  timer batch) and records 120. One row per spot: fps, p95 frame time, CPU
  render time, calls, triangles, GPU ms per pass. *Copy* puts the table on the
  clipboard for the report.
- **Headless**: `node scripts/benchView.mjs --save before`, change, then
  `--save after --compare before` (Playwright; `PLAYWRIGHT_MODULE` points at a
  global install). Calls and triangles are exact anywhere; SwiftShader times
  only compare runs on the same machine.
- **GPU time per pass** (`PassTimer`): the renderer is created with
  `trackTimestamp: true` and a custom `renderer.inspector`. Three calls
  `inspector.beginRender(uid, scene, camera, target)` for every render and
  writes a timestamp pair under the same uid; the inspector sorts uids into
  groups (main scene + eye camera = `scene`; main scene + any other camera =
  `shadows`; a `QuadMesh` = `post`; offscreen targets registered by name, e.g.
  caustics = `water`, the rifle scope = `scope`). Every 12 frames
  `renderer.resolveTimestampsAsync('render')` fills
  `backend.timestampQueryPool.render.timestamps` (uid → ms); sum per group,
  divide by the frames in the batch. WebGPU needs the `timestamp-query`
  feature (Chrome quantises to 100 µs); WebGL2 needs
  `EXT_disjoint_timer_query_webgl2`, which most phones lack — the overlay then
  says "n/a" and CPU numbers carry the comparison.
- **CPU time per section** (`CpuTimer.lap`): update, streaming, scope, water,
  submit (the render call itself).
- **F3 overlay**: fps, frame ms, governor level, CPU and GPU breakdowns, calls,
  triangles, EV, backend.

### 9.2b Frame governor (dynamic resolution)

`FrameGovernor` (from Tanks, now shared) holds 60 fps by trading image
quality, never gameplay. Each one-second window it takes the 70th and 90th
percentile of frame intervals: p70 over 1/52 s → one step cheaper (quickly,
2.5 s cooldown); p90 under 1/58.5 s for 8 windows → one step better (slowly),
never back to a level that just failed (60 s memory). Isolated hitches don't
move it. Steps, cheapest loss first: sun shafts off (a uniform loop count, so
no recompile), then render scale 100 → 87 → 76 → 67 → 58 %. **A switch must
not recompile** — uniforms and render-target size only — or the governor
measures its own hitch. Added here: a run of steps down is judged after two
steps; if p70 did not improve by 8 % (a display capped at 30 Hz, a CPU-bound
frame), it goes back up and stays for a minute instead of blurring the image
for nothing. Off in benchmarks; a settings toggle for players.

### 9.3 Pipeline tracer (catches stutter sources)

```js
const pl = renderer._pipelines;              // three r186 internals, test only
const orig = pl.getForRender.bind(pl);
window.__new = [];
pl.getForRender = (ro, promises) => {
  const before = pl.caches.size;
  const res = orig(ro, promises);
  if (pl.caches.size > before) window.__new.push(`${ro.material.name}@${ro.object.name}`);
  return res;
};
```

Install it after loading (or during loading via `addInitScript` polling for the
renderer, to see what the warm-up itself compiles), then drive the game through
everything a player can do — equip each weapon, fire, change weather and time,
turn around, teleport across the map — and require **zero** new pipelines.

### 9.4 Unit tests worth having

- Pure functions: terrain heights, the wave-field solver (dispersion limits, fronts
  turning to the beach, energy through a channel), map generators.
- Streaming: a refill never exceeds capacity and always contains every instance
  within the radius (compare as float32!), near + far sets cover each instance once.

---

## 10. Quality checklist for a coastline (use as acceptance criteria)

Condensed from the "Real-Time Coastal Simulator" prompt in
`hajimetwi3/hajimetwi3-prompt-okiba` (MIT); ✔ = done in the lagoon.

- ✔ Beach, seabed, water surface and swash share one height/depth dataset.
- ✔ Waves slow, shorten and bend with depth; grow in the shallows; break where
  depth-limited; lose energy after breaking.
- ✔ Waves are individuals (sets, along-shore variation): no whole-coast
  synchronised line, no identical breakers.
- ✔ Foam has a history (made at the break, carried, decaying into lace) — **no
  periodic white bands parallel to the shore**, no rectangular foam edges.
- ✔ Swash runs up, slows, drains back; the wet line follows the recent run-ups and
  dries over time with a ragged edge — no fixed blue strip on the sand.
- ✔ Wet sand darker, slightly more saturated, smoother, glossier; not a mirror,
  not black paint.
- ✔ Shallow water shows the floor; colour from absorption along the real path, not
  a depth gradient; not swimming-pool cyan.
- ✔ Caustics tied to the surface and the sun direction, not a scrolling texture.
- ✗ Underwater view, surface crossing, total internal reflection (the lagoon's
  player wades, does not swim).
- ✗ Plunging lip, spray, stranded foam simulation (Tidewater does these on the
  GPU; too heavy for the phone budget here).
- Check at 0 s, 5 s, 20 s, 60 s; max and min storm settings; low sun; phone preset.

---

## 11. three.js r186 pitfalls (quick list)

| Symptom | Cause | Fix |
|---|---|---|
| Stuck at "compiling shaders" on phones; ground vanishes on desktop WebGPU | > 16 textures in one shader | texture arrays; count bindings |
| Cloned foliage draws solid quads | `NodeMaterial.copy()` loses `alphaTest` | restore after `clone()` |
| Leaves solid with `alphaToCoverage` | A2C without MSAA disables alpha test | leave A2C off with TRAA |
| Hitch when walking through vegetation | per-`InstancedMesh` shader build | one streamed mesh per kind |
| Hidden things compile on first use | `compileAsync` skips hidden/culled | reveal one per cache key + warm frame |
| Warm-up frame compiled nothing | pass renders once per animation frame | await rAF before the warm frame |
| Instanced plants visible only in shadows | pre-compiled while `count = 0` | fill before compile; reveal with count ≥ 1 |
| Hitch at dusk/dawn | toggling `castShadow` | never toggle; fade intensity |
| Hitch every sky re-bake | new PMREM target per bake | re-bake into the same target |
| Rows of identical ovals or a seam across a procedural texture | tiled noise with one period for both axes, scaled differently on each (`tileFbm(u*2, v*12, 2)` repeats six times across) | per-axis periods (`tileFbmXY(u*A, v*B, A, B)`); audit every call for scale ≠ period |
| Black environment | sky dome beyond the probe camera's far plane | scale the dome inside it |
| Float32 data texture blurry/wrong on some GPUs | float32 not filterable | nearest + manual bilinear with `textureLoad` |
| Vertex-shader texture read fails on WebGPU | implicit LOD in the vertex stage | `.level(0)` |
| Render-target lookup mirrored | NDC y vs texel rows | write y inverted; texel row 0 = NDC +1 on both backends |
| Test compared positions wrongly | buffers are float32 | compare `Math.fround` values |
| A second camera's picture (scope, mirror) shows upside down | texel row 0 of a render target is the top of its image on both backends | sample it with `v = 0.5 − y/2`, not `0.5 + y/2` |
| `Cannot read properties of null (reading 'If')` at load, game never ready | `If` / `Loop` / `toVar` used outside a TSL `Fn` | build that code in `Fn(([a, b]) => …)` and return a vector |
| WGSL compile error: sampling in non-uniform control flow | `texture()` with implicit LOD inside `If` (WebGL accepts it, WebGPU does not) | pass an explicit `.level()` computed outside the branch (e.g. from camera distance) |
| WebGPU only: `Failed to execute 'createView' … 'swizzle' … not of type 'GPUTextureComponentSwizzle'`, never finishes loading | three r186 sets `swizzle: 'rgba'` on every texture view; older Chromium/WebView builds (e.g. 140) implement an older swizzle draft | shim `GPUTexture.prototype.createView` to retry without the (identity) swizzle (`render/webgpuCompat.ts`), installed before the renderer |
| Headless tests only ever exercise WebGL2 | Playwright's headless shell has no WebGPU adapter | full Chromium with `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface` gives a software WebGPU adapter: test WGSL there too |
| Software WebGPU: "A valid external Instance reference no longer exists", device lost at once | Chromium 141 headless loses the device as soon as a canvas context is configured/presented (a bare device without a canvas lives) | test-only init script that replaces `GPUCanvasContext.configure/getCurrentTexture` with an ordinary texture (`benchView.mjs --no-present`): nothing is shown, every shader still compiles and errors still surface |
| Headless test hangs with an idle browser | a page error stopped loading; the script waits for "ready" | always log `pageerror` and console errors; time out early |
| A data pass (FFT, simulation) into a float render target gives garbage; one straight band of nonsense across the water | through `colorNode` a node material clamps each channel at 0 and forces alpha to 1 when opaque, so signed data and anything in `.w` are lost | write the result with `material.fragmentNode` (skips the colour and output stages), `transparent: true, blending: NoBlending`; verify against a CPU reference by reading the target back |
| High preset only, WebGPU: a straight line across the middle of the screen and grain over the ground | GTAO at `resolutionScale < 1` gathers four depths and keeps the min (the farthest with a reversed depth buffer); occlusion multiplied in after TRAA leaves its per-pixel noise un-averaged | GTAO at full resolution (fewer samples), applied to the scene colour before TRAA with `useTemporalFiltering = true` (Tanks `render/pipeline.ts`) |
| Every frame, WebGPU: `copyFramebufferToTexture: Source and destination formats do not match. depth32float depth24plus` | `viewportDepthTexture()` copies into a shared `depth24plus` texture, but a reversed depth buffer is `depth32float` | own `DepthTexture` with `type = FloatType` passed as the third argument of `ViewportDepthTextureNode` (§7.12) |
| Water pipeline invalid: "number of sampled textures (32) … exceeds the maximum per-stage limit (16)" after adding a screen-space march | every `viewportDepthTexture()` / viewport texture node keeps its own framebuffer copy and binding | build one base node and read it with `base.sample(uv)` (§7.12) |
| A branch built in an unrolled JS loop uses the wrong (last) loop value | an `If(cond, () => …)` body runs when the shader is built, after the loop has finished | copy the loop variable into a block-scoped `const` before `If` (§7.12) |
| Sand (or any splat) shows little squares | a texture sampler that paints whole hash cells (`floor(u·64)`) | draw a rotated soft ellipse inside the cell instead |
| Read-back rows look mirrored on WebGL only | `readRenderTargetPixelsAsync` flips WebGL rows to match WebGPU | compare with row `N − 1 − y`; `screenCoordinate` and `textureLoad` agree on both backends |
| A post-pass effect that needs world positions (aerial perspective, clouds) reads nothing or the wrong place | inside a post pass `cameraPosition` / camera matrices are the full-screen quad's camera | pass the scene camera's `projectionMatrixInverse`, `matrixWorld` and position as `uniform(...)` (Contrail `render/stage.ts`) |
| Distances from depth wrong by orders of magnitude on WebGL only (haze everywhere or nowhere) | `getViewPosition` maps depth to −1…1 under WebGL, but with `reversedDepthBuffer` the WebGL backend switches clip control to 0…1 | unproject yourself with NDC z = depth when the buffer is reversed (or on WebGPU), `depth·2 − 1` otherwise |
| Sky pixels (reversed depth 0) get "near" treatment | the far plane is not infinity; unprojecting depth 0 gives garbage | `select(depth <= 0, hugeDistance, length(viewPos))` |
| Scene colour reads black inside a `select` branch of a post pass | the pass texture node used as `colour.rgb` inside the branch | sample explicitly: `colour.sample(uv).rgb` |
| TRAA shows a smeared or black frame after an expression was inserted before it | TRAA re-samples its input at reprojected positions and needs a texture | wrap the expression in `convertToTexture(...)` before `traa(...)` |
| Debug colour views all grey or white | bloom spreads huge debug values (e.g. 1e7 for the sky) over the whole screen | clamp debug outputs to 0…1 before the post chain |
| WebGPU only: `TextureViewDimension::e2D … not compatible with … e3D` for a `Data3DTexture` sampled in an `rtt()` pass (setting `is3DTexture` does not cure it) | r186's WebGPU backend binds the volume through a 2-D view | store the volume as a 2-D atlas of z slices with a one-texel wrapped border and lerp two bilinear fetches (Contrail `render/clouds.ts` `volumeAtlas`); identical on WebGL2 and phones |
| Volumetric clouds cover the whole sky at "50 %" coverage | raw Perlin-Worley values bunch around 0.6–0.8, and a column is cloudy if any height in it is | histogram-equalise the baked noise and calibrate the threshold against measured column coverage in a unit test |
| Contrails, flames and other transparents vanish whenever a cloud lies behind them | a cloud (or fog) composite in post only knows the depth of opaque surfaces, so it covers anything transparent | put those objects on their own layer and draw them in an overlay `pass()` (`setLayers`) composited after the clouds, hidden behind opaque surfaces by comparing fragment depth with the scene pass's depth texture (Contrail `render/stage.ts`) |
| An overlay pass composites as solid black | a pass referenced from inside `convertToTexture` (RTT) renders after `resetRendererState`, which clears to opaque black, ignoring your clear alpha | store transmittance in alpha instead of coverage: blend colour premultiplied and alpha as `dst × (1 − α)` (`overlayBlending`), composite `base × a + rgb` |
| Ray-march grain shows as diagonal stripes in fast flight | interleaved gradient noise has a diagonal structure; TRAA rejects history while the scene moves fast | add per-pixel white noise to the IGN offset, and refine the step after the first hit inside the medium |
| `bumpMap(expression)` on a procedural pattern (panel lines, seams) does nothing | `BumpMapNode` re-samples its input as a texture at offset UVs; an expression has no UVs to offset, so its gradient is zero | build the perturbed normal from the expression's own screen derivatives (`h.dFdx()`, `h.dFdy()`, Mikkelsen's surface gradient), as `bumpNormal` in Contrail `render/jetMaterials.ts` |
| Procedural panels stretch and squeeze across a curved hull | the pattern is drawn in model space (x, y, z), which is not the skin | write a skin-coordinate attribute in metres (along, arc length around) while building the geometry and draw panels in that |
| Fine lines (seams, rivets) shimmer or thicken into dark bands at a distance | an `smoothstep(w, w + fwidth)` edge keeps every line at least a pixel wide | scale the line's coverage by `2w / fwidth` so sub-pixel lines fade instead of thickening (`lineAA`) |
| Every tree past ~200 m upside down | impostor atlas rows read bottom-up; render targets are top-origin on both backends | `v = species + (1 − corner.y)` (§5.5); check impostors alone, close up |
| GPU-generated forest grows in neat rows ("orchard") | TSL `hash()` casts its seed to `uint`, so negative world cells all hash alike | `fract(sin(dot(cell, vec2(12.9898 + k·1.37, 78.233 + k·2.71)) + k·0.618) · 43758.5453)` and a full-cell jitter |
| WebGL: "Active draw buffers with missing fragment shader outputs" when baking into an MRT target | render-target textures not named like the MRT outputs | `target.textures[i].name = 'albedo'` etc., matching `mrt({ albedo, normal })` |
| WebGL: "Active draw buffers with missing fragment shader outputs" every frame, a decal or overlay never shows | its material sets `fragmentNode` (one vec4), but the scene pass renders to several targets (MRT for TRAA/SSR); WebGL drops the draw | use `colorNode` + `opacityNode` (the output stage fills every target); blend with `CustomBlending` for premultiplied effects |
| "No stack defined for assign" from a material callback | nodes that assign (`toVar`, `assign`) built outside a `Fn` or callback | build them inside the callback that runs at compile time (e.g. inside `receivedShadowNode`) |
| Cockpit displays flicker | screen plane coplanar with its bezel's face (z-fighting) | 3–4 mm proud; mipmapped canvas texture so text stops shimmering under TRAA |
| A delayed one-shot sound (far explosion) plays at full volume at once | an `AudioParam` holds its default (gain 1) until its first scheduled event | `gain.value = 0` before scheduling, or `start(at)` the source at the event time |
| Android flavour's own `signingConfig` ignored | a build type's `signingConfig` overrides the flavour's | set the default on `defaultConfig`, override per flavour |
| Low cloud layer turns blocky on phones | one bilinear tap upsampling a ¼-resolution layer | a 4-tap tent when the layer is below ½ resolution |
| Lamp-lit or other night-only shading in an `If(uniform)` branch: fine at night, by day façades mirror the sky and blocks go black | TSL declares a shared variable (`normalWorld`, `normalWorldGeometry`) where it is first built; built first inside the branch, it is only assigned when the branch runs, and the material's own lighting reads it unset | build it before the branch: `const out = normalWorld.mul(0).toVar()` (FL `materials.ts` `lampLit`) |
| Lit windows (or any per-object hash) speckle pixel by pixel | the hash key uses `normalWorld`, which carries the normal map | key on `normalWorldGeometry` |
| Camouflage or coat patterns slide over a moving instanced figure; countershading follows world height | in an instanced mesh `positionLocal` is the position *after* the instance matrix | key segment-space patterns to `positionGeometry` (§6h) |
| Paired limbs or wheels instanced with a mirrored matrix render inside out | instanced draws set the front face per mesh, not per instance | build both sides from symmetric geometry; never negate an axis per instance |
| Shaded faces turned toward the camera (a vehicle's rear, trunks, walls) render near black on High only | three r186's GTAO under a reversed depth buffer marks them fully occluded (seen in its AO target: black on every camera-facing plane, white on the ground); depth-derived normals and a flipped depth both make it worse; the pipeline multiplied the whole colour by it | compare High with a no-AO preset at one view before trusting AO; Tanks runs without GTAO until it is fixed upstream |
| Film grain or dither draws as vertical stripes | TSL `hash()` takes a float; given a pixel coordinate it hashes x alone | a 2-D hash: `fract(sin(dot(p, vec2(12.9898, 78.233))) · 43758.5453)` |
| The ground under real trees is painted as tree tops | a far-canopy colour (for hills beyond the modelled trees) applied by height and distance from shore only | fade it in with distance from the eye (lagoon: 45–110 m) |
| Most parked cars the same colour (the palette's fallback) | `hash >> n` on a hash above 2³¹ is negative in JS; `negative % len` stays negative and the array lookup is `undefined` | shift hashes with `>>>`; clamp indices with `Math.abs` |
| A baked model's shared materials get darker each time another model is baked | the AO bake multiplies a material's `colorNode` by grime per bake | mark materials once (`WeakSet`) |
| Road paint, bullet holes, tracks and scorch marks never show | the renderer uses a reversed depth buffer (near = 1), and three.js passes `polygonOffset` to the GPU unflipped: a negative bias pushes the decal *behind* its surface | with `reversedDepthBuffer: true`, use positive `polygonOffsetFactor` / `Units` |
| A `CSMShadowNode` throws "Cannot read properties of undefined (reading 'oneMinus')" and nothing renders | setting `csm.camera` by hand before the first render skips its `_init`, so it has no cascade lights | leave `camera` unset; the node takes the rendering camera on first use (call `updateFrustums()` only once it has one) |
| `motionBlur(traa(...), …)` fails with "sample is not a function" | the blur samples its input at offset uvs; a TRAA node is not a texture node | `motionBlur(convertToTexture(aa), velocityUv, samples)` |
| Skinned figures smear under TRAA and motion blur | the velocity pass compares the skinned position with `positionPrevious`, the unskinned bind pose | assign `positionPrevious` in the `positionNode` from last frame's bone matrices |
| Frames rendered in a loop for a recording come out as one flat colour | TRAA's history advances once per animation frame | one `requestAnimationFrame` per rendered frame; read the canvas in that task |
| Sunlit ground burnt white in a forest at noon | auto exposure allowed to open as far as for a room, and it meters the canopy's shade | an outdoor floor of ~2.5 stops under the preset (§6aa) |
| A roof or canopy reads as a black band from under it | one dark material on every face of the slab | the underside in its own material (boards, plaster), from the map's existing looks |
| Every load waits 20 s at "compiling shaders", then starts anyway | `renderer.compileAsync` settles one pipeline and hangs until its timeout (it yields and awaits per object) | no precompile; warm-up frames only (§8.3) |
| Seconds per texture at the first frame, worst on the first one | a 2D canvas is GPU-backed; `copyExternalImageToTexture` reads it back across contexts | `getContext('2d', { willReadFrequently: true })` for canvases drawn once (§8.4) |
| Hundreds of shader builds for a few dozen materials | each instanced mesh under 1024 instances gets a uniform buffer named after itself | `markStaticInstances` + `shareStaticInstanceShaders` (§8.4) |
| First look through a scope or mirror freezes the game | its render target differs from the scene pass's (formats, MRT, samples), so every object builds again | a target cloned from the scene pass's, same MRT, velocity given the camera's projection (§8.4) |
| "getNodeType of undefined" after sharing a target with the scene pass | the MRT maps outputs by texture name and the target's texture was renamed | keep the cloned textures' names |
| "Vertex buffer count (9) exceeds the maximum (8)" during warm-up | the reveal forced a hidden stand-in mesh (many attributes + instancing) to draw | `userData.noWarmup = true` on meshes that never draw |
| "position not found" warning for a placeholder mesh | a `Mesh` with an empty geometry | a speck of real geometry (`PlaneGeometry(0.001)`), invisible |
| CI builds the APKs and then fails | workflow artifacts of every run filled the Actions storage quota | publish to a rolling release only; artifacts on other branches with `retention-days` |

---

## 12. Large worlds: flight and vehicle simulators

**Games:** Contrail (`contrail/`, jets over 100 km), Ridgeline (`ridgeline/`, an
attack helicopter over 20 km of ridges). What changes when the player covers
kilometres a minute and sees 100+ km.

### 12.1 Terrain at map scale

1. **Bake the height function into float grids at load**, not per query: a near
   grid (Contrail 102.4 km at 50 m, Ridgeline 20.48 km at 10 m) and a coarse far
   grid to the horizon, read by the CPU (collision, radar altimeter, AI line of
   sight, placement) and the GPU (vertex stage) with the **same bilinear**. What
   you see is what you hit.
2. **Bake on all cores**: split the grid into bands of rows and post each band
   to a module worker (`sim/terrainWorker.ts`, `onWorkers`/`bakeGridParallel`),
   with a single-thread fallback when workers are missing. The normal and
   land-cover maps are baked the same way, each band with one extra row either
   side. A unit test checks that the band bake equals the single-thread bake.
3. **CDLOD** (Strugar 2009): a quadtree selected on the CPU by distance and
   frustum, drawn as **one instanced mesh** of 32 × 32-cell patches; each vertex
   reads four heights (`textureLoad`, the same bilinear as the CPU) and morphs to
   the coarser level over the last quarter of its range. No cracks, no pops, one
   draw call. Tune leaf size, levels, leaf range and the node cap per game
   (Contrail 1600 m / 10 / 3600 m / 1000; Ridgeline 320 m / 10 / 760 m / 900).
4. **Earth curvature** in the vertex stage (`d²/2R` drop) and the same drop for
   the cloud layer, so the overcast meets the horizon.
5. **Rock and snow from slope**, not height alone: rock strata (banded colour)
   only on cliff patches, snow that slides off steep faces, so ridges read
   from 10 km.
6. **Tried and dropped:** a hydraulic-erosion pass on the grid. Within the
   load-time budget it made silt lakes and streaks instead of valleys. The
   relief now gets its look from light (§12.2) and resolution, not erosion.

### 12.2 Mountain shadows and sky occlusion, baked on the GPU (`render/terrainShadow.ts`)

Without them the relief is lit like a plastic model: every sun-facing slope
bright, every gully as open to the sky as a summit. Both come from **horizon
angles** over the near height grid, computed in **one full-screen `QuadMesh`
pass into a `RenderTarget`** (≈1 M texels × ~150 height reads: milliseconds on
a GPU, minutes on a CPU), and again when the sun moves (time-of-day change):

- **r = sun visibility**: march towards the sun with geometric steps (56 steps
  out to `sunM`: Contrail 20 km, Ridgeline 6 km); lit if the sun stands above the
  steepest terrain angle along the way, with a soft edge for the disc.
- **g = sky visibility**: the horizon angle in 8 directions × 14 steps out to
  `skyM` (3 km / 1.2 km); each contributes `1 − sin(horizon)`.

The terrain material multiplies the sun shadow by r inside
`receivedShadowNode` (with the cloud shadow) and feeds g to `aoNode`. Forests
(§12.3) sample the same texture so a tree in a ridge's shadow is dark too.

### 12.3 Forests generated on the GPU (`render/forest.ts`)

No list of trees anywhere. Each **ring is ONE instanced draw** of N × N
camera-facing impostor quads on a grid that moves with the camera in whole
cells; the instance index alone gives the cell (no per-instance attributes).
Per cell, a **hash** gives the jitter (a full cell, or rows show), the species,
the size and the yaw; a coarse hash makes stands and clearings. The vertex
stage reads the forest density (cover map: forest minus water and rock) and the
height (`texture().level(0)` in the vertex stage), and collapses the quad where
there is no forest. A 100 km map costs the same as a park, and a tree is always
in the same place when you come back.

- Two rings: dense and small near, sparse and larger far (Contrail High
  `{256 × 256, 11 m}` + `{192 × 192, 34 m from 1250 m}`; Ridgeline
  `{256, 7 m}` + `{192, 22 m from 800 m}`). Low uses fewer cells.
- Atlas: three procedural species (spruce of ruffled tiers, pine, broadleaf),
  8 views round the trunk **plus one from above**, unlit albedo and
  object-space normals through a named MRT. The top view blends in with the
  camera's elevation, so from altitude you see crowns, not edge-on cards.
- **Crowns of clusters, not solids.** A broadleaf lobe as one ruffled
  icosahedron reads as a green cloud from a hovering helicopter. Build each
  lobe from dozens of small clusters biased to its outer shell (gaps let the
  sky through, the silhouette breaks into leafy bumps), run limbs from the
  trunk to the lobes so they show in the gaps, and mix sun and shade greens.
  It is baked into the atlas once, so it costs nothing per frame.
- **Gameplay objects must not stand in it.** Vehicles parked "on the river
  bank" sat inside riverside woods and were invisible. Place them by querying
  the same cover function the bake uses (`sourceCover(...).forest`) and search
  outwards for open, level ground.

### 12.4 Sky, clouds and their shadows

- **Hillaire 2020 sky** (`render/atmosphere.ts`): transmittance, multiple
  scattering, sky-view and aerial-perspective LUTs, all quad passes written
  through `fragmentNode` (the colour path clamps raw data). Valid from the
  runway to 15 km+, unlike the Preetham sky. Sun, sky and haze share one
  pre-exposed scale.
- **Volumetric cloud slab** (`render/clouds.ts`): ray march at ½ (High) or ¼
  (Low) resolution inside the post chain, before TRAA (which averages the
  jittered start). Below ½ resolution, upsample with a **4-tap tent**, not one
  bilinear tap, or the edges turn to blocks on phones. Dual-lobe HG phase,
  Wrenninge's multiple-scattering octaves, Hillaire's energy-conserving steps,
  each pixel's cloud hazed at its transmittance-weighted depth.
- **Cloud shadows on the ground**: `clouds.shadeReceivers(scene)` wraps every
  receiver's `receivedShadowNode`, multiplying by the cloud's transmittance
  towards the sun (and by the material's own `userData.shadowFactor`, e.g. the
  terrain's horizon shadow). Build the cloud-shadow nodes **inside** the
  callback (see §11).
- The game logic reads the same density formula (`sim/cloudField.ts`), so
  what the player sees hiding him is what the AI cannot see through.
- **What made them read as clouds, not grey cotton** (Ridgeline, after a
  screenshot tour: soft blobs of one height, flat grey, blurred edges):
  1. **Cloud types in the weather map** (its G channel): a type 0…1 sets
     each cloud's relative top, 0.35 (flat stratocumulus) to 1 (cumulus to
     the layer's top), so one layer holds towers beside low heaps. The
     spread closes as the coverage reaches 1, or an overcast has holes.
  2. **Height profile**: a flat base rounded over the bottom 8 %, tapering
     over the upper half of the cloud's own top (towers narrow as they rise).
  3. **Detail erosion, Schneider's way**: two octaves of the Worley detail
     (the second 3.1× finer), its coordinates warped by the shape value
     (±130 m, curls the edges), and inverted above the base — wispy
     undersides, billowy tops. Detail voxels went from 50 m to ~7 m.
  4. **Billows in the shape volume** (its G channel, a Worley fbm with cells
     of 1.1 km to 280 m, fetched with the shape in one RG lookup): a remap
     `(shape − cut) / (1 − cut)`, `cut = 0.4 (1 − billow)`, carves grooves
     between cells and leaves domes. The light march sees them, so a body
     shades as heaped billows, not a smooth slab; zero extra fetches.
  5. **Hard edges**: density × 4, clamped to 1, after the erosion. The
     coverage remap ramps density over the shape noise's own scale (100 m+),
     a dozen pixels of fuzz from a few kilometres. Keep the gain in the
     light march and the ground shadows too, but march the light at **half
     the view extinction**, or the saturated cores go grey.
  6. **Sky occlusion inside the cloud**: the local density stands in for the
     column above (`exp(−ρ σ min(top − h, 250 m) · 0.25)`) and scales the
     ambient term. A real sample up there cost a fifth more per step and
     **lost the WebGL device** on SwiftShader (black frames, "context
     lost"): count fetches per step before adding any.
  7. **Beer–powder** (Schneider 2015) on the sun term, at 60 %:
     `1 − 0.6 exp(−140 σt)`, faded out towards the sun. Rims seen away from
     the sun darken and every billow outlines itself.
  8. **Overcasts are smoother**: billows and erosion scale by
     `1 − 0.6 c⁴`; at full coverage a deck otherwise comes out holed.
  9. Every one of these changes the coverage statistics: re-fit the coverage
     exponent against the test that measures cloudy columns (1.8 → 1.3
     here), on the CPU and in the shader together.

### 12.5 Vehicles, wrecks and effects in the open

- **Vehicles on slopes**: pitch and roll each model from four ground samples
  around it, every frame for movers.
- **Bake AO into ground vehicles too** (Tanks `render/aoBake.ts`): seen from
  behind or against the sun a tank is lit by the sky alone, and without
  occlusion its parts merge into one dark slab. Bake hull and turret apart (the
  turret traverses), once per model kind into a cache (12 rays, 1.2 m for a
  45 000-vertex tank, at load), and give instanced parts a fixed value — their
  material reads `ao` too. Per-vertex AO only shows where there are vertices:
  on a hull of big plates it darkens the small parts and little else.
  Splitting triangles to 0.35 m first tripled the vertices and cost 0.4 s per
  tank spawned mid-fight — only worth it with geometry shared per model kind.
- **Runways and airfield grass up close** (Contrail `airbase.ts`,
  `terrainMesh.ts`): a terrain made for the view from altitude is flat paint
  from the cockpit on the ground. Each concrete slab a shade apart (hash per
  7.5 m slab), speckled aggregate, tar-dark joints, hairline cracks as warped
  noise isolines in a share of the slabs, oil down the centreline; grass
  clumps and dry tufts faded in by pixel footprint (`fwidth`), mown stripes
  round the airfield.
- **Ground vehicles as machines** (Ridgeline `render/targetView.ts`, §6j):
  tracks with a link groove every 15 cm in the material, road wheels, sprocket,
  idler and return rollers, skirts with rubber edges, stowage bins, smoke
  dischargers, a cupola gun, an antenna; tyred wheels (`heliDetail.wheel`),
  hatches and periscopes on carriers; a glazed cab, grille, lamps, mirrors and a
  hooped cover on trucks. Field paint dusty below ~1.3 m, streaked on the sides,
  faded on top. Build and AO-bake one template per kind and paint, clone it per
  vehicle (shared geometry: no bake when a column spawns).
- **Destroyed**: swap to a charred material, throw the turret askew; a smoke
  column as an `InstancedMesh` of dark puffs that rise, swell and drift on a
  loop (7 per wreck, one draw for all), plus a flickering emissive fire for
  the first ~40 s.
- **Emission in physical units on the overlay layer** (Contrail §11 trap):
  tracers (`LineSegments`, 1900 K × 60 000 cd/m²), motor flames, fireballs,
  wreck fires. Smoke and dust are lit scene geometry.
- **Smoke trails** of rockets and missiles: the contrail ribbon (`trails.ts`), a
  ring buffer of points drawn as one camera-facing strip, lit with a forward
  scattering lobe; its noise scale is for big trails, so keep widths ≥ 0.25 m.

---

### 12.6 The ground from a helicopter (Ridgeline)

A colour-only terrain shader (fields, heath, strata from noise) holds up from
1 km and falls apart below 100 m: the pad, a low hover and the pilot's seat
showed flat green plates. What fixed it, all from the other games' kits:

1. **One land-cover function for every consumer** (`render/landCover.ts`):
   world position, baked normal and cover map in; air-view albedo, the
   close-range layer weights (meadow, soil, rock, litter) and the grass
   density (tall sward, short stubble/heath, sedge, canopy shade) out. Pure
   ALU plus its inputs, so the terrain runs it per fragment and the grass per
   blade (vertex stage, `texture().level(0)` for the maps).
2. **Close-range layers as ratios** (`render/groundTextures.ts`, after Tanks):
   four procedural 512² layers (256² Low) with height in alpha and normal +
   cavity AO in a second array. The terrain multiplies its air-view colour by
   each layer's albedo **divided by the layer's mean**: the mips average the
   ratio to 1, so from altitude the land is exactly what it was, and from the
   pad it has blades, clods, pebbles, joints and needles. Height blend,
   stochastic tiling on High, rock projected on the slope's own plane, and a
   second lookup 7.3× coarser and rotated, which carries the pattern to a few
   hundred metres where the first has mipped away. Skip all lookups beyond
   4 km. Where the air view has no colour for a layer (worn heath, the floor
   under the crowns seen from below them), use the layer's own mean colour.
3. **Meadow mottling** (two noise lookups at 1.9 m and 7.3 m: tussocks,
   yellower and bluer patches), **worn bare patches**, **mower's swaths**
   (2.6 m bands, faded by 2.5 km before they alias), tracks as darker earth
   instead of white lines, and a wider per-field brightness range. Procedural
   noise has no mips: fade every such term out by distance.
4. **Real grass blades** from the shared `grassField.ts`, now taking the ground
   and the density as shader functions, fed from **two small maps baked
   round the camera** (105 m at 0.5 m texels, one quad pass each, again when
   the camera has moved 4 m): density (RGBA8) and colour + height (RGBA16F,
   height relative to the camera's ground). Evaluating the land cover and
   the mesh height per blade vertex (twenty noises, nine loads, half a
   million vertices) **lost the GPU device**. The height is the rendered
   mesh's own (`meshHeightNode`: level-0 vertices are the bilinear at the
   10 m lattice, cut b–c like the patch index buffer); blades take the
   colour of the field they stand in (`groundTint` 0.8); off above 90 m. The
   ridge shadow reaches them through `material.userData.shadowFactor`.
   Bake passes write `fragmentNode` (the colour path would clamp heights).
4b. **Matte blades** (`matte: true`: a physical material with
   `specularIntensity: 0`): a blade's shading normal leans up, so from a few
   metres up it is seen at a grazing angle where Fresnel reflects ~40 % of
   the sky; under Ridgeline's bright sky probe the meadow turned to frost.
   A Lambert material lost the sky's diffuse light too and drew black dashes.
5. **Rotor downwash**: `grass.blow(x, z, r, strength)` lays the blades outward
   from the hub's ground point and sets them thrashing (the trampling map's
   A channel, decaying in 0.35 s; the shader pulses the push and whips each
   blade across it at its own phase). Strength from the thrust over the
   weight, the rotor speed squared and `(1 − h / 2.5D)²`; radius
   `R · (1.7 + h/D)`; the trampling window follows the helicopter, not the
   chase camera (`update(..., focus)`), at 0.45 m cells (58 m).

## 13. Cockpits, displays and the HUD

- **Cockpit geometry relative to the eye** (x right, y up, −z forward): one
  layout serves several airframes; only the eye point moves. Model what the
  eye sees: glare shield, panel, sills, consoles, stick and collective, and in a
  tandem cockpit the front seat's station and helmet. The crew figure of the
  seat the camera is in is hidden; the canopy glass drops to ~0.1 opacity from
  inside (0.6 outside).
- **Live displays**: one 2-D canvas (512 × 256) redrawn ~10 times a second
  into a `CanvasTexture` (engine page with tapes, a heading-up map baked once
  as shaded relief). Rules learned the hard way:
  - **Constant output brightness** (`MeshBasicNodeMaterial`, colour × a level
    ~1.3), not lit and not exposed with the scene: an eye adapted to the cockpit
    reads them at noon and at dusk.
  - **Never coplanar with the bezel**: a screen flush with its frame's face
    z-fights and flickers. Put it 3–4 mm proud.
  - **Mipmapped** (`LinearMipmapLinearFilter`, anisotropy 4): a 512-px page
    shown at ~300 screen px aliases differently under each TRAA jitter, and
    thin text shimmers.
  - A second seat's view can be blocked by its own instruments; check every
    camera seat's centre of view and lower the hardware below the eye line.
- **Rotor blur**: blades as meshes while slow; from ~40 % rotor speed a disc
  whose shader draws each blade as its **exposure smear** (the angle swept in
  one frame, `ω·dt`, at least a few degrees), blended in by rotor speed.
- **HUD on a canvas**, symbology projected through the camera. Test "behind the
  camera" in view space (`z > −0.5` after `matrixWorldInverse`), not with the
  NDC z of `project()`, which misbehaves with a reversed depth buffer.
- **Weapon symbology** (Ridgeline `ui/hud.ts`): target diamonds for what the
  sensor sees; the gun cross where the turret's rounds land; a rocket cue ring
  at the impact point of a rocket simulated now with the **same fixed-step
  integrator** as real rockets (otherwise the cue and the hits disagree at
  grazing angles); a missile seeker box; a laser spot with its range.
- **An on-screen aim cursor** moved by the mouse or the right thumb; the sight
  line is the ray `vec3(cursorNdc, 0.5).unproject(camera) − camera.position`,
  marched against the height grid (growing steps, then bisection) for the aim
  point. The camera stays with the vehicle.

---

## 14. Controls and flight computers (what players actually asked for)

The rotor and jet models are physical; the **controls** decide whether anyone
can fly them. Each item below came from a player's complaint.

1. **Keys never flip.** W is nose down / forward, S nose up, whatever the
   "invert" setting; that setting belongs to a thumb stick only.
2. **A/D turn, Q/E rotate.** In a hover a sideways input is mostly a yaw (with
   ~30 % bank); with speed it blends to a banked turn the computer
   coordinates. Pedals stay pure yaw.
3. **The mouse aims, it does not fly**, once the game has weapons. It moves a
   cursor over the view; the camera and the aircraft carry on. Rotating the
   camera with the aim made fixed-weapon cues drift off the axis.
4. **On touch the right thumb never touches the flight controls.** A right-side
   drag that silently added to the cyclic made the helicopter "unstable".
5. **A flight computer is on by default** (SAS), off = the bare airframe:
   - **attitude hold**: the stick commands a pitch/bank attitude (±20° / ±29°),
     PI on attitude plus rate damping; at hover speeds the reference leans
     against drift so a centred stick settles into a hover;
   - **heading hold**: pedals command a yaw rate; the tail rotor is **fed
     forward from main-rotor torque** (`dir·Q / arm`), plus a PI on yaw rate.
     Without the feed-forward any collective change spun the aircraft at
     60–150 °/s; at speed a centred pedal asks for the coordinated turn rate
     `g·sin φ / V`;
   - **height hold with a neutral detent**: the power lever is a vertical-speed
     command (below the middle mark descend, at it hold, above it climb, ±8 m/s
     at the stops). The computer integrates the hover collective itself, moves
     it rate-limited (0.5 lever/s), stays under a 98 % torque limit (no
     wind-up while limited), keeps a straight-down descent under the vortex
     ring's onset (2.5 m/s at hover speeds, the full rate only with airspeed)
     and eases off near the ground for a soft touchdown. The touch lever springs
     back to the detent when released.
6. **Fixed weapons go where the nose points.** Rockets leave at the aircraft's
   speed *along* the pod line plus their launch speed, not inheriting a sideways
   drift (fins weathercock them at once); otherwise the cue sits off the axis.
7. **Turn-on tilt steering in flight** (a TILT toggle, CAL to set hands-off);
   iOS grants motion only inside a tap (`DeviceMotionEvent.requestPermission`).
8. **Test the controls in a unit simulation**, not by flying headless:
   SwiftShader renders a frame every few seconds, so a 25-second key press is
   two seconds of simulated flight. Tests here: hover, climb/hold/descend and
   soft landing, heading held through lever snatches, attitude step response,
   key mapping (W never flips, A yaws at hover and banks at speed), rockets on
   the axis while drifting.

9. **Pause when the controls are let go**, once the player has actually played.
   That means losing the pointer lock (Esc, P), the touch pause button, or
   Android's Back (`window.__gamePause`, which returns true when it paused).
   The fixed-step loop stops stepping but keeps drawing with no time passing.
   Suspend the AudioContext. Do not pause before the first flight: test scripts
   drive the game without a pointer lock. Put the pause layer and button on
   `body`: a `position: fixed` `#ui` is its own stacking context, under the touch
   controls' z-index, and a phone tap never reached the button.
10. **Every pause menu has Quit game.** In the APK it calls `AndroidApp.quit()` (a
    `@JavascriptInterface` that runs `finishAndRemoveTask`). In a browser it calls
    `window.close()`, which a tab the player opened ignores, and then falls back
    to the start menu.

## 15. Sources and credits

- **Tidewater** by Dan Greenheck (MIT), github.com/dgreenheck/tidewater — the
  eikonal shore-wave field, the per-wave height model and swash run-up, the lace
  foam idea, and photon-splat caustics. Ported and simplified for phones here;
  credited in the file headers.
- **"Real-Time Coastal Simulator"** prompt, hajimetwi3/hajimetwi3-prompt-okiba (MIT) —
  the coastal quality checklist (§10).
- Evan Wallace, *WebGL Water* — caustics by rasterised photon splatting.
- **ClearWater6.1 / RTXShowcase** by SamG-Coder (MIT),
  github.com/SamG-Coder/RTXShowcase — footprint-adaptive glints, the wave-patch
  domain warp with its Jacobian, sand relief, RGB dispersion in caustics (§7.6, §7.9–7.11).
- GPU Gems 1 ch. 1 (Gerstner waves), GPU Gems 3 ch. 13 (light scattering).
- Lagarde & de Rousiers 2014, *Moving Frostbite to PBR* — physical light units,
  pre-exposure.
- Pope & Fry 1997 — pure-water absorption.
- The repository's `references/` sheets (PBR materials, lighting values).
- Hillaire 2020, *A Scalable and Production Ready Sky and Atmosphere Rendering
  Technique* (EGSR) — the sky and aerial-perspective LUTs (§12.4); Bruneton 2017
  for the coefficients.
- Hillaire 2016, *Physically Based Sky, Atmosphere and Cloud Rendering in
  Frostbite* (SIGGRAPH course) — energy-conserving cloud integration;
  Wrenninge et al. 2013, *Oz: The Great and Volumetric* — multiple-scattering
  octaves.
- Strugar 2009, *Continuous Distance-Dependent Level of Detail for Rendering
  Heightmaps* — CDLOD terrain (§12.1).
- Max 1988, *Horizon Mapping: Shadows for Bump-Mapped Surfaces* — the horizon
  angle idea behind the mountain-shadow and sky-visibility bake (§12.2).
- Leishman, *Principles of Helicopter Aerodynamics* — blade-element thrust with
  momentum inflow; Cheeseman & Bennett 1955 — ground effect (the rotorcraft
  model behind §14).
