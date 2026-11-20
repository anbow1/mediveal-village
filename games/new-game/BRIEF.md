# Marchland — Game Brief (Stage 0)

> **Source basis:** `games/new-game/DESCRIPTION.md` was left as an unfilled template; this brief synthesizes the complete Marchland design rules in `docs/GAMEPLAY.md`, `docs/ECONOMY.md`, `docs/BUILDINGS.md`, `docs/UNITS.md`, `docs/CAMPAIGN.md`, `docs/BLENDER.md`, `docs/PLAYBOOK.md`, `docs/ASSETS.md`, `docs/ROUTINE.md`, `NUMBERS.md`, and `GUIDE.md`.

## 1. Concept & Four Pillars

**Marchland** is a realistic medieval village builder and tactical regiment real-time strategy game (browser WebGPU/WebGL2 + Android APK, bilingual Polish / English).

1. **Visible economy.** Every good physically sits in a building yard or is carried by a townsfolk carrier (on back, handcart, or wagon). Bottlenecks are visible on the map before numbers show them.
2. **One shared population.** Every person is a worker, carrier, builder, or soldier. Raising a regiment pulls townspeople out of the economy; disbanding returns them to civilian work and equipment to storage.
3. **Formation warfare.** 10 unit types fighting in 8–12 man regiments (up to 20 in campaign), decided by morale, facing, flanks/rear, terrain elevation/cover, fatigue, charge shock, and combined arms rather than APM micro.
4. **Focused single session.** 560 × 560 m map, 25–35 minute skirmishes (plus Defence, Tutorial, and a 5-mission Campaign), with **Active Pause** + Shift command queuing as a first-class play mode (essential on phones/tablets).

## 2. Hard Rules & Non-Goals

### Engineering & Rendering Contract (`GUIDE.md` §1, §2, §4)
- **Fixed stack:** `three.js` r186, `WebGPURenderer` with its own WebGL2 fallback (single code path; **never** `WebGLRenderer`), all custom shaders in **TSL node materials** (no `ShaderMaterial`, `onBeforeCompile`, `EffectComposer`), single `RenderPipeline`, strict TypeScript (`strict: true`, no `any`), Vite bundler.
- **Deterministic headless simulation:** All game logic in `src/sim/` with **zero** `three.js` or DOM imports, fixed 60 Hz step (`dt = 1/60 s`), seeded PRNG (`?seed=`), tested in Node (`vitest`). Player and AI execute identical commands through `src/sim/commands.ts`.
- **Single source of truth:** All tuning numbers live in `src/config.ts` with SI units in names (`speedMs`, `sunIlluminanceLux`, `buildRadiusM`) and rationale comments. Generated docs (`ECONOMY.md`, `BUILDINGS.md`, `UNITS.md`) must stay in sync via `npm run docs` and a doc-sync unit test.
- **Shared infrastructure:** Copy `shared-src/` unchanged (`core/noise.ts`, `render/warmup.ts`, `render/instancing.ts`, `render/perf.ts`, `render/benchRecorder.ts`, `render/webgpuCompat.ts`, `render/instanceStream.ts`).
- **Physical units & lighting:** SI (1 unit = 1 m, g = 9.81 m/s², air = 1.225 kg/m³, sound = 343 m/s). Sun in lux, colour from kelvin, `EV100 = log2(lux · 100 / 250)`, `exposure = 1 / (1.2 · 2^EV100)` with pre-exposure. Single sky function driving sky dome, env probe (with ground bounce), fog, and water reflections. Never fix dark undersides with ambient light.
- **Post-processing chain order:** HDR pass + MRT velocity → GTAO (High only, full-res, before TAA, verified against r186 reversed-depth blackening) → TRAA (High **and** Low) → sun shafts (High) → physical bloom → exposure, ACES tone map (A/B tested vs AgX), sRGB → sharpen (~0.30 High / ~0.25 Low) → unbloomed HUD. All toggles are uniforms, never graph rebuilds.
- **Zero shader stutters in play:** Build all pipelines behind the loading screen via real warm-up frames (`warmup.ts`); **never** `compileAsync()`. Use `markStaticInstances` for static instanced meshes; keep shader sampled textures ≤ 16 per stage via three `DataArrayTexture`s (albedo, normal, ORM) for all terrain & building surfaces. Zero new pipelines after load.
- **Realism rules R1–R12:** Real models/kits for shapes the eye knows (trees, buildings, people, soldiers, horses, siege guns, props); code for fields (terrain, sky, water, grass, particles, scatter). Baked vertex-colour AO always; KTX2 textures (UASTC normals; ETC1S ≥ 40 dB PSNR or UASTC colour/ORM; `detectSupport(renderer)` after `renderer.init()`, no `setTranscoderPath`); 3 LODs + matte impostors beyond 100 m + coarse opaque shadow stand-ins (R7); 100 × 100 m vertical slice approved before full world (R10); phone is the ultimate judge (R11).
- **Content & licence rules:** CC0 / CC BY 4.0 only (every third-party file logged in `CREDITS.md` and `ASSETS.md`); zero NC/Sketchfab Standard/ripped assets; no raw Mixamo files redistributed in repo; invented heraldry only (no real coats of arms, flags, or brands); no blood or gore; no fog of war; no tech tree; no microtransactions.
- **Measurement & evidence:** Every stage reports via `GUIDE.md` §6 format; every measurement logged newest-first in `games/new-game/RESULTS.md` with alternating before/after runs, `tools/measure/load.mjs`, `shots.mjs`, `passes.mjs`, and `tsc --noEmit` + `vitest` + `vite build`.

---

## 3. Feature List & Acceptance Criteria

### A. Core, Renderer & Verification Contract
| ID | Feature | Acceptance Criterion |
|---|---|---|
| **F01** | **WebGPU + WebGL2 single-path renderer & physical post chain** | Grey 18 % card under 100 000 lx noon sun exposes at expected EV100 within ±0.15 stops; ACES vs AgX A/B recorded in `RESULTS.md`; TRAA + sharpen active on both High and Low; 0 console errors on headless WebGPU and WebGL2 small test page. |
| **F02** | **Debug, measurement & benchmark contract** | `?autostart`, `&q=high\|low`, `&debug`, `&scene=town\|battle`, `&seed=N`, `&lang=pl\|en`, `?bench` all work; `window.__ready === true` after first frames; `window.__debug.place/spot/step` work; `[load] <stage>: <s> s` printed per stage + total shown in pause menu; `shots.mjs` and `load.mjs --game generic` pass cleanly; F3 overlay & Benchmark button output full table. |
| **F03** | **Zero-hitch warm-up & frame governor** | `load.mjs` reports 0 new pipelines after load across all presets, time presets, and combat; no frame > 50 ms after second 1 on desktop; governor steps down AO → shafts → reflections → render scale (100 % → 58 % desktop, 42 % phone at 2× DPR) without recompiling. |
| **F04** | **Asset pipeline (KTX2, Meshopt, LODs, impostors, surface array)** | One-texture KTX2 benchmark logged before batch conversion; all surface scans packed into 3 `DataArrayTexture`s (≤ 16 sampled textures/stage); all GLBs Meshopt-compressed with 3 LODs + matte impostors (> 100 m) + coarse opaque shadow meshes (R7); no texture upload > 50 ms; byte-accurate loading bar. |

### B. World, Lighting & Visual Craft
| ID | Feature | Acceptance Criterion |
|---|---|---|
| **F05** | **Physical atmosphere, CSM shadows & lighting presets** | Single sky function drives dome, env probe (with ground bounce), fog, and water; 4 lighting presets (Late Autumn Afternoon default 30°, Clear Noon 65°, Golden Hour 12°, Overcast) switch with 0 new pipelines; CSM 3–4 cascades (High) / 2 (Low) with fade, no shadow seams/acne; undersides readable without raising ambient. |
| **F06** | **Single-height-function terrain & dynamic ground works** | Logic (`src/sim/`) and mesh (`src/render/`) share one height function (zero floating buildings/trees/soldiers); 6+ scanned surfaces blended by cover map + dynamic `groundWorks` map (trampled dirt, ploughed furrows, crops, cobblestone roads) sampled at near + far dual scales to eliminate tiling. |
| **F07** | **Live forest, felling/regrowth, grass & water** | ≥ 3 tree species (Oak, Scots Pine, Silver Birch) backed by `sim/trees.ts`; woodcutters fell nearest mature tree ≤ 48 m (8 timber), plant sapling (10 min regrowth), clearing > 50 % trees in 12 m cell removes forest slow/cover and allows building; R2 Bézier grass blades ≥ 1.3 px tint-matched to ground near camera; lakes/rivers have wet silt shore band and lighter shallows. |
| **F08** | **Five map layouts & symmetric keep placement** | *Open Field*, *Crossing* (river + stone causeway + 2 fords), *Forest* (dense wood + 105 m clearings + 24 m central road), *Valley* (Campaign M3–4), *Fortress* (Campaign M5); 3 symmetric keep placements (corner 600 m apart, west/south edges 495 m apart, 180° rotational symmetry); impassable mountain cores & rock ridges block movement/building/roads; 3 capturable center points (rich mine 8 ore/min, quarry 10 stone/min, village 15 gold + 6 grain/min; 20 s capture within 30 m uncontested). |
| **F09** | **Visual quality bar (Stage 4 slice & Stage 8 critic)** | 100 × 100 m vertical slice inspected at 0.45 m, 1.7 m, and RTS altitude beside `target-look/` photos on High & Low; all §2b giveaways checked and resolved (no burnt-out sunflecks, black undersides, origami foliage, shiny impostors, flat walls, comb grass, showroom-clean surfaces, or compression artefacts). |

### C. Economy, Population & Logistics
| ID | Feature | Acceptance Criterion |
|---|---|---|
| **F10** | **Shared population & automatic role allocation** | Keep starts with 8 people; House holds 8 / 12 / 16 (L1–3), +1 newcomer every 30 s when fed (18 s with wine, 25 % faster within 40 m of Well); auto-assigned every 1 s: 1 worker/active workshop → builders (30 % of free hands, max 3/site) → carriers (minimum 4 free + 1 builder reserved); tax 1.2 gold/min per fed person (×1.8 with wine) + 24 gold/min Keep; workers flee when enemy regiment < 32 m and return 6 s after clear. Unit-tested in `tests/economy.test.ts`. |
| **F11** | **Physical carrier logistics & building construction** | Input store max 8, yard output max 24 (halts production when full; carriers collect at ≥ 4); carriers carry up to 8 of one good (1 s load/unload), move 2.0 m/s (1.4× road, 0.7× forest), serve strict 6-tier priority queue; construction requires delivered timber & stone (half timber as planks for L2+) and progresses visually in stages (clip-plane `cutY` foundation → walls → roof); Storehouse acts as secondary town depot. Unit-tested: pig farm → tannery chain yields target armour rate; full yard halts work. |
| **F12** | **Food & wine consumption** | Residents eat 0.3 rations/min, soldiers 0.25 rations/min (bread = 1, fish = 1, sausage = 2); hungry house works at 50 % speed, pays 0 tax, stops growing; empty Keep food store applies −25 army morale; Winery wine delivered to houses (up to 3 casks, 0.05 wine/min/person) boosts tax ×1.8 and growth time ×0.6. Unit-tested. |
| **F13** | **Free building placement, roads, walls & gates** | Free placement within 280 m Keep radius (330/380 at L2/L3; farms/vineyards +60 m; woodcutter/quarry/mine/tower anywhere ≥ 90 m from enemy keep; +70 m extension around own buildings), max 2.2 m ground rise, not water, ≥ 1.5 m clearance, max 64 buildings/side, rotatable with `R` before & during build, ghost preview with green/red reason; point-to-point stone roads (1.7 stone / 10 m) with 2 m grid A* pathing; point-to-point walls (15 stone / 10 m, 260 HP per 2 m) and gates (20 timber, 12 stone, 6 m, 400 HP, twin leaves auto-open for friendlies, block enemies). Unit-tested. |
| **F14** | **All 31 buildings & full production chains** | All buildings from `docs/BUILDINGS.md` implemented with exact costs, terrain constraints (forest ≤ 26 m, lake ≤ 16 m, outcrop ≤ 15 m, open rear strips for farms/vineyards), recipes, levels 1–3 (cost ×1/1.5/2.5, speed ×1/1.6/2.3, 15 builder-s upgrade), demolition (50 % refund + yard goods), Keep L1–3 upgrades, Market 10-lot trade (60 % sell / 160 % buy), Tavern ale→gold, Chapel +6 morale, Well growth bonus, Sawmill planks, Forester sapling growth boost, Hunter meat+hide, Watchtower garrison (up to 4 archers/crossbowmen, +12 m range). Every chain covered by unit tests. |

### D. Army, Formations, Combat & Siege
| ID | Feature | Acceptance Criterion |
|---|---|---|
| **F15** | **All 10 unit types, recruitment, refitting & upkeep** | Militia (Keep L0, home defence ≤ 115 m, no building attacks), Pikemen, Archers, Swordsmen, Halberdiers, Crossbowmen, Light Cavalry, Heavy Cavalry, Field Cannon (2 guns/6 crew, Gun Foundry L1), Mortar (1 gun/5 crew, Gun Foundry L2) with exact stats/costs from `docs/UNITS.md`; barracks queue max 3; recruits walk from town to barracks; refitting within 40 m of barracks pays only missing equipment + gold diff over 20 s; reinforcement within 40 m after 5 s out of combat; upkeep 0.2 gold/man/min (unpaid > 1 min → −15 max morale). Unit-tested. |
| **F16** | **Formations, stances, orders & crossing movement** | Formations: Line, Column (+20 % speed, narrower front), Pike Schiltron/Hedgehog (all-round anti-cav, −50 % move), Heavy Cav Wedge (+30 % charge, weaker flanks), Loose Skirmish (−40 % missile loss, lower melee morale); Ctrl+right-drag sets facing (always left of drag) and width 4–12; stances (Hold, Guard 12 m, Skirmish, Hold Fire); orders (March, Run, Attack, Charge, Retreat facing enemy, Halt, Fall back to Keep, Garrison Keep/Tower); snake-column pathing along 2 m A* center-weighted tracks + deterministic crossing queue at fords/bridges/gates. Unit-tested (`tests/crossing.test.ts` passes 4 regiments through ford & gate without clipping water/walls). |
| **F17** | **Tactical combat, ballistics, morale, elevation, veterans & captains** | Deterministic melee + missile combat with armour, AP, shield block, flank/rear bonuses, cavalry charge shock, pike/halberd anti-cav bonus, elevation modifiers (+15 % ranged range downhill, +25 % downhill charge, −1 uphill melee), fatigue, morale shock/rout/rally; 2 veteran tiers (0.6 & 1.5 kills/man: +1 atk/def, +8 max morale, +12 % ranged accuracy); regiment Captain behind ranks (death −12 morale; missing −1 atk, −10 max morale, 50 % rally speed); cannon/mortar siege damage against walls, gates, towers, keeps. Balance matrix (10 × 10, 30 seeds/pair) meets `GAMEPLAY.md` §6 targets: equal duel 45–75 s, flank charge breaks in 10–15 s, arrows inflict 15–25 % on unarmoured over 80 m, every unit has a cheaper counter. |
| **F18** | **GPU-instanced animated characters, horses & effects** | One `InstancedMesh` per soldier/citizen type with GPU bone-matrix texture skinning (`DataTexture` RGBA float, ≤ 8 vertex buffers via interleaving), `travelM`-matched stride (zero foot slide), rider mounted on warhorse saddle bone with caparison, gun crews at artillery; layered smoke/dust/impact/debris effects, chimney smoke at `smoke_*` empties, animated windmill sails & gate leaves, no TRAA smear on moving units. |

### E. AI, Modes, Campaign, UI, Audio & Delivery
| ID | Feature | Acceptance Criterion |
|---|---|---|
| **F19** | **Fair-economy AI with 3 personalities & tactical behaviour** | AI uses identical `commands.ts` economy (zero free units); 3 personalities (*Builder/Gospodarz*, *Raider/Zagończyk*, *Knight/Rycerz*); 1-minute counter-composition evaluation; line/ranged/flank-cav/reserve tactics & morale relief (< 40 %); difficulty scales production multiplier, reaction delay (6 s Easy → 1 s Hard), and flank/relief usage. Headless AI-vs-AI sim finishes in 25–40 min on *Open Field*, *Crossing*, and *Forest*; AI defeats passive player in 30–38 min. |
| **F20** | **Game modes: Skirmish, Defence & Tutorial** | *Skirmish*: 5 maps, 3 keep slots, difficulty & AI personality; *Defence*: no enemy town, escalating waves every 4 min from min 7, win at 30 min with star rating; *Tutorial*: 7 auto-completing state-driven steps (Woodcutter, Farm+House, Windmill+Bakery, Quarry, Militia, Move regiment, Barracks). |
| **F21** | **5-Mission Campaign** | Mission scenario engine (triggers, objectives, stars, briefing/debriefing, persistent progress in `localStorage`), carry-over of up to 8 regiments (with veterans) + 50 % gold (cap 800), campaign cap 200 soldiers & regiments up to 20 with Merge button: M1 *Tribute* (600 g / 200 bread / 40 weapons in 30 min or 200-man assault), M2 *Camp Across the River*, M3 *Retaking the Village* (*Valley*: twin ridges every 52 m at 175 m off axis, village 274 m from keep held by 5 regiments + 4-crossbow tower, min-12 relief, march on town +3 min if uncaptured), M4 *Rebuilding & Great Army* (player-owned market, 6 rebuildable ½-price ruins — 3 houses, bakery, windmill, market — target ≥ 160 men / ≥ 10 regiments / Keep L3, 2/3/4-regiment raids at min 8/16/24), M5 *The Fortress* (*Fortress*: 7 m plateau flat to 100 m, destructible gameplay outer ring 124 × 112 m / 8 towers + inner ring 84 × 70 m / 4 towers with 2× HP and 2 crossbowmen/tower, central keep donżon cut out from castle mesh / indestructible, working enemy town inside spawning 1 regiment/5 min from mortar-destructible barracks, 230 m / 150 s gate sortie against guns, min-15 rear relief, 2 heavy-cav courtyard guard; start with M4 army + 2 cannons + 2 mortars + barracks & gun foundry; win on guard defeated, lose on camp lost or 1 min without regiments, star 2 = breach < 10 min & 0 guns lost). Bot-verified per mission in `tests/campaign.test.ts`. |
| **F22** | **HUD, controls, active pause, production, alerts, minimap, save & settings** | Title-safe 90 % layout; top bar (population/free, rations & balance, army, speed & Active Pause); Build / Recruit (with verified counter tooltips) / Production (2-min rates + bottleneck jump) tabs; persistent bottom regiment cards; clickable alerts with camera jump & pulsing minimap pings; sunlit-shaded minimap; Ctrl+1–9 groups, double-click type select, Ctrl+F5–F8 camera bookmarks; full deterministic save/load (`toSnapshot`/`fromSnapshot` passes identical-fingerprint test after 3+2 min); end-screen timeline charts; validated settings; rebindable `bindings.ts`; full PL/EN `strings.ts`; full touch controls. |
| **F23** | **Positional audio & ambient soundscape** | Web Audio API positional sound with speed-of-sound delay (343 m/s, delayed one-shots initialized at `gain = 0`), layered combat impacts (Kenney CC0 MP3s), procedural ambient wind + forest birds (< 80 m from trees, zero per-frame node allocations, mutes on pause), master volume setting. |
| **F24** | **Offline PWA & Android APK** | Vite build ≤ 80 MB with hash-manifest service worker (`ignoreVary: true`) and iPad/mobile icons; Capacitor/Android WebView APK builds cleanly and starts on phone; GitHub Actions rolling release workflow (single rolling release, no per-run artifact spam). |

---

## 4. Performance, Loading & Memory Budgets (`GUIDE.md` §3 & `NUMBERS.md`)

| Budget Metric | High (Desktop 1440p) | Low (Phone / Tablet) | Notes |
|---|---|---|---|
| **Frame time / FPS** | 60 fps, GPU ≤ 14.0 ms | 60 fps with governor | Governor drops AO → shafts → reflections → render scale |
| **GPU pass breakdown (High)** | CSM ≤ 2.2 · Opaque ≤ 3.8 · AO/SSR ≤ 1.6 · Sky/Fog ≤ 0.8 · Transp/Part ≤ 1.8 · Post ≤ 1.2 · Signature (skinning/grass) ≤ 2.0 · HUD ≤ 0.3 ms | Scaled proportionally | Measured via GPU timestamps (`perf.ts`) |
| **CPU main thread** | Sim/Physics ≤ 2.0 · AI/Logic ≤ 2.5 · Submit/Cull ≤ 3.5 · Audio/Stream ≤ 0.8 ms | Same or tighter | Fixed 60 Hz step, zero per-frame allocations |
| **Draw calls** | ≤ 2 500 (target < 400 with instancing) | ≤ 700 (target < 250) | One `InstancedMesh` per unit/tree/building kind |
| **Triangles / frame** | ≤ 12 M (incl. CSM cascades) | ≤ 2 M (incl. CSM cascades) | Measured per pass via `passes.mjs`; coarse shadow stand-ins |
| **Unique materials** | ≤ 120 (target < 40) | ≤ 80 (target < 30) | Shared `DataArrayTexture` surface material + instanced unit material |
| **Pipelines after load** | ≤ 150 target, **0 new in play** | Same (≤ 150, **0 new**) | Verified by `load.mjs` pipeline tracer |
| **Loading (GPU idle)** | ≤ 10 s target | ≤ 20 s target | Measured on real device; software GPU ranks runs only |
| **Build size (`dist/`)** | ≤ 80 MB | Same (≤ 80 MB) | Includes KTX2 textures, Meshopt GLBs, baked rigs, audio |
| **Texture memory** | Set after Stage 4 vertical slice | Set on first phone run (Stage 2/4) | KTX2 UASTC/ETC1S; kept only where ≥ 10 MB VRAM saved / MB file |

---

## 5. Build Order (Stages 0–8, `GUIDE.md` §3)

Each stage ends with its Check, a `GUIDE.md` §6 report, an entry in `games/new-game/RESULTS.md`, and a **stop for user approval**.

- **Stage 0 (this stage) — Brief, bar, budget (no code):** `BRIEF.md`, `target-look/README.md`, `ASSETS.md`, `RESULTS.md` initialized. Stop for approval & asset-source confirmation.
- **Stage 1 — Skeleton & measurement:** Vite + strict TS + `vitest` in `games/new-game/`; copy `shared-src/` unchanged; `WebGPURenderer` + TSL post chain + EV100 exposure (grey card under 100 000 lx sun); full debug contract (`?autostart`, `&q=`, `&debug`, `__ready`, `__debug`, `[load]`, F3, `?bench`, Benchmark button); touch/mouse RTS camera rig; CI & Android APK scaffold. *Check:* `shots.mjs` & `load.mjs --game generic` pass; `tsc` & tests clean.
- **Stage 2 — Asset pipeline (R6–R9):** KTX2 single-texture benchmark vs PNG (memory & upload time logged); 3 `DataArrayTexture` surface array library; GLB + Meshopt + 3 LODs + impostor + coarse shadow mesh pipeline; byte-progress streaming manifest & warm-up; 1 tree, 1 building (House L1), 1 prop (barrel/crate) end-to-end. *Check:* `load.mjs` before/after, no upload > 50 ms, phone baseline sets memory/load budgets.
- **Stage 3 — Light & atmosphere (R2, R3):** Physical sun in lux + kelvin, CSM (3–4 High / 2 Low, fade), physical sky function shared by dome/env-probe/fog/water, 4 time/weather presets (Late Autumn Afternoon, Noon, Golden Hour, Overcast) with 0 pipeline rebuilds, vertex-colour AO + contact shadows. *Check:* grey card exposure at every preset, readable undersides, unified sunset hue.
- **Stage 4 — Vertical slice, 100 × 100 m at final quality (R1, R5, R10):** Minute-one village slice: single-height terrain with 6+ scanned ground layers + dynamic road/field `groundWorks`, Keep L1, House L1, Woodcutter + live felling clearing, Farm with ripening strips, Windmill (turning sails), Bakery (chimney smoke), Watchtower, Wall + Gate, lake shore with wet silt, R2 grass near camera, 3 tree species, citizens & 2 opposing regiments. Inspected at 0.45 m, 1.7 m, and RTS camera beside `target-look/` photos on High & Low; extrapolate budgets to 560 × 560 m map. **Stop for approval before full world.**
- **Stage 5 — Whole world (560 × 560 m):** All 5 map generators (*Open Field*, *Crossing*, *Forest*, *Valley*, *Fortress*), symmetric keep placements, impassable mountains/ridges, outcrops, 3 capturable center points, cell-streamed instanced forests/rocks/shrubs with dithered LOD → impostor transitions, all 31 buildings (L1–3), walls/gates. *Check:* flat draw calls moving across map, no frame > 50 ms, 0 new pipelines, `passes.mjs` per-pass triangle audit.
- **Stage 6 — Gameplay, simulation & motion (R4):** Full headless 60 Hz sim (`src/sim/`) with unit tests (M1 living town economy/logistics/wine/felling → M2 combat/formations/morale/captains/veterans/siege/balance matrix → M3 map points/keep upgrades/crossings → M5 AI personalities/counters/Skirmish/Defence/Tutorial → Campaign M1–M5); GPU-instanced skinned soldiers/citizens/warhorses with zero foot slide; layered effects & positional audio; full bilingual HUD, active pause, save/load, settings, production & minimap. *Check:* all `vitest` suites & balance matrix green, multi-second motion screenshots without TRAA smear, < 200 ms feedback.
- **Stage 7 — Phone & offline delivery (R11):** Low preset at 2× DPR with TRAA + governor tuning; full benchmark at every view + 3 min play; offline service worker (`ignoreVary: true`); Android APK verification.
- **Stage 8 — Critic loop:** Fixed views at Noon, Golden Hour, Late Afternoon, Overcast side-by-side with `target-look/` photos; ranked giveaway list with cause & cost; top-5 fixes with before/after crops & diff ×8; `CREDITS.md` audit; final report including honest platform ceiling (R12).

---

## 6. Fixed Verification Views (`app/bench.ts`)

| View ID (`spot`) | Purpose |
|---|---|
| `town` | Starter village & Keep from standard RTS altitude (45° pitch, ~55 m distance) |
| `rally` | Barracks / muster yard + road junction + walls & gate (~35 m distance) |
| `field` | Center battlefield / river crossing / capture points (~85 m distance) |
| `close` | Close-up on soldiers, townsfolk, horses, and workshop yards (~12 m distance) |
| `enemy` | Enemy keep / fortress walls and towers (~65 m distance) |
| `overview` | Full 560 × 560 m strategic overview from high altitude (fog-free readability) |
| `ground_045m` | R5/Stage 4 quality check at 0.45 m above ground (soil, grass blades, wall footing, wear) |
| `eye_170m` | R5/Stage 4 quality check at 1.70 m human eye height (village street, timber eaves, foliage, horizon) |

---

## 7. Reconciled Rules & Stated Assumptions (for Stage 0 Approval)

1. **Canonical numbers (`src/config.ts` docs beat earlier prose):** Where `docs/ECONOMY.md`, `docs/BUILDINGS.md`, `docs/UNITS.md`, and `docs/CAMPAIGN.md` §6 differ from earlier paragraphs in `docs/GAMEPLAY.md`, we adopt the newer generated/dated numbers:
   - Map size **560 × 560 m** (not 400 × 400 m).
   - Keep build reach **280 / 330 / 380 m** (farms/vineyards **340 / 390 / 440 m**; resource gatherers & towers anywhere ≥ 90 m from enemy keep; +70 m from own buildings).
   - House capacity **8 / 12 / 16**, newcomer every **30 s** (fed), tax **1.2 gold/min** + **24 gold/min** Keep; carrier capacity **8**, walk speed **2.0 m/s**; yard output max **24**, input max **8**; starting stock **340 gold, 90 timber, 40 stone, 40 bread, 8 residents**.
   - Siege units are **Field Cannon** (Gun Foundry L1) and **Mortar** (Gun Foundry L2) per `UNITS.md`, replacing earlier mentions of ballista/trebuchet.
   - Army cap **100** in Skirmish/Defence (12 inf / 8 cav), **200** in Campaign (regiments reinforced/merged up to 20).
   - Latest mouse bindings (`GAMEPLAY.md` §1): middle-drag pans, right-drag rotates, right-click orders, Ctrl+right-drag sets front & width (4–12, facing left of drag).
2. **TRAA on Low preset:** `GUIDE.md` §2b, §4, and §7 mandate TRAA + sharpen on **every** preset (including Low on phones at 2× DPR), superseding `PLAYBOOK.md` §2's mention of FXAA on Low.
3. **Project directory:** Assumed to live in `games/new-game/` per `GUIDE.md` §3 and `FIRST-MESSAGE.md` (can be renamed to `games/marchland/` if preferred before Stage 1).
4. **Asset provenance & tooling (requires confirmation before Stage 1/2):**
   - `asset-pack/` contains the loader (`marchland-assets.js`) and `FORMATS.md`, **not** the binary models, textures, or MP3s.
   - `games/new-game/references/` currently has no real photographs.
   - `blender` and `toktx`/`ktx` are not preinstalled in this Linux VM (Node 24, npm 11, Python 3.11, and Chromium are preinstalled; Node tools like `@gltf-transform/cli` / `ktx-parse` / `basis_universal` or user-space binaries can be checked in Stage 2).
   - No third-party files will be downloaded until you confirm whether to use CC0/CC BY downloads or supply the `marchland-assets` archive.
5. **Target devices & priority ranking (assumed until user fills `DESCRIPTION.md` §4 & §6):**
   - Desktop: modern WebGPU browser (1440p 60 fps target) + headless Chromium SwiftShader CI.
   - Phone: mid-range Android / iPad (Low preset, 2× DPR, TRAA + governor, 60 fps target).
   - Priority order assumed: **1. Smoothness on phone · 2. Looks · 3. Short loading · 4. World size**.

---

## 8. Stage 5 Upgraded Visual & Realism Guidelines (User-Authorized)

Per explicit user authorization at the Stage 4 → Stage 5 gate (*upgrade visual guidelines wherever higher realism can be achieved using Blender and free CC0/CC BY 4.0 3D models*), the following architectural and graphical upgrades supersede earlier low-poly approximations while keeping every performance, memory, and licence ceiling intact:

1. **Anatomical MakeHuman CC0 Characters + Poly Haven Photogrammetry Gear (replaces procedural pill/capsule soldiers):**
   - `swordsman`, `archer`, and `citizen` are built from the MakeHuman CC0 anatomical outer body mesh (`base.obj`, `default.mhskel`, `default_weights.mhw`, CC0 1.0) posed in Blender 5.0 with world-axis natural lowered-arm stances, bone-region garment extraction, rounded-toe convex-hull leather boots/turnshoes, Cycles vertex AO, 19-bone `idle`/`walk`/`attack` NLA rigs, and packed 1024² Albedo/Normal + 512² ORM KTX2 atlases (`1.27–2.11 MB` across all 4 LODs).
   - Swordsmen wield genuine Poly Haven CC0 photogrammetry **`antique_estoc`** swords and **`kite_shield`**s (overpainted with invented Marchland Cobalt-Ochre chevron heraldry); Archers wear quilted gambesons, cobalt chaperon hoods, feathered back quivers, and curved English yew warbows.
2. **GPU Bone-Matrix `DataTexture` Instanced Character Renderer (`src/render/unitInstancer.ts`):**
   - Bakes `idle`/`walk`/`attack` skeletal matrices into an `RGBA32F` `DataTexture` (`NearestFilter` + integer `textureLoad` — 100% WebGPU + WebGL2 core-spec compatible) and renders **160–200+ animated soldiers & villagers across BOTH Marchland Cobalt and Enemy Crimson factions in ≤ 12 draw calls total**, performing zero-extra-texture TSL Cobalt→Crimson heraldry swapping in the same instanced draw call.
3. **Poly Haven CC0 Photogrammetry Nature, Artillery & Village Props:**
   - Replaced procedural rocks, stumps, artillery, and yard props with 11 real Poly Haven CC0 photogrammetry scans (`rock_moss_set_01` ×2, `boulder_01`, `tree_stump_01`, `fern_02`, `cannon_01`, `wooden_crate_01`, `wooden_bucket_01`, `modular_wooden_pier`, plus `wine_barrel_01` and `brown_leather`/`medieval_wood` scans — all credited in `CREDITS.md`, Meshopt + KTX2, coarse R7 shadow proxies).
4. **360° Museum-Craft Buildings & Ground-Footing / Foliage Shader Realism:**
   - Upgraded 5 core buildings (`keep_l1`, `windmill_l1`, `bakery_l1`, `farm_l1`, `watchtower_l1`) to full 360° timber framing and airtight gables, and added 10 new village & campaign buildings (`chapel_l1`, `smithy_l1`, `barracks_l1`, `market_l1`, `well_l1`, `storehouse_l1`, `fisher_l1`, `camp_tent_l1`, `ruin_house`, and Mission 5's monumental 19 m `fortress_donzon`) — **all 19 building types with 0 embedded textures** sharing the 12-layer KTX2 BC7 surface arrays (`12.0 MB` VRAM).
   - Added organic TSL ground-footing damp/moss weathering (`positionLocal.y < 0.95 m` + macro noise) on `buildingMaterial` (`src/render/surfaces.ts`) and warm sun-backlit foliage subsurface translucency on Oak, Scots Pine, Silver Birch, and Poly Haven woodland ferns (`src/render/worldBuilder.ts`) — zero extra textures or passes.
   - Building LOD distances raised to `75 m / 155 m` (`stage5BuildingLod`) so half-timbering, chapel belfry posts, and watchtower galleries stay razor-sharp across normal RTS camera altitudes while dropping cleanly to coarse `LOD2` in strategic `overview`.

