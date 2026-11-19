# tools/measure — pictures and numbers from a built game

Headless Chromium on a software GPU: the same WebGPU path a phone takes (or its
WebGL2 fallback), with no graphics card. `docs/graphics-playbook.md` §8.4 and §9
say what the numbers mean and what they caught.

Needs Node 20+ and Playwright (`npm i -D playwright`, or
`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs` for a global install;
`CHROME_PATH` picks another Chromium).

```
cd <game> && npx vite build --base ./ && cd ..
node tools/measure/serve.mjs <game>/dist 4173 &          # never the dev server: it reloads on every edit

node tools/measure/shots.mjs   --game <game> --out shots/before --views '[{"pitch":-0.1},{"turn":3.14}]'
node tools/measure/load.mjs    --game <game>              # stages, pipelines, uploads, texture memory, ready, gpu idle
node tools/measure/profile.mjs --game <game> --top 30     # CPU profile of loading
node tools/measure/passes.mjs  --game <game>              # draw calls and triangles per pass and object
```

| Script | Use it when |
|---|---|
| `serve.mjs <dir> [port]` | always: serves the build |
| `shots.mjs` | before and after any change to the picture, at the same views; `--extra '&q=low'` for the phone preset, `--gpu webgl` for the fallback |
| `load.mjs` | after adding a material, an instanced mesh, a canvas texture, a second camera; write the pipeline count in the commit |
| `profile.mjs` | a `[load]` stage got slower and you need the function |
| `passes.mjs` | the frame has more triangles or draw calls than it should: which objects, in which pass (shadow cascades count every caster again) |

`--game` picks an adapter in `lib.mjs` (how to skip the menu, when the game is
ready, how to place the camera). The five games here each have one. **A new
game needs none** if it keeps this contract, and then runs as `--game generic`:

- `?autostart` starts play without a click; `&q=high|low` picks the preset
  without touching stored settings;
- `window.__ready = true` once the first frames have been drawn;
- with `&debug`: `window.__debug.place({x, y, z, yaw, pitch})` and
  `window.__debug.spot(name)` (a benchmark spot) put the camera somewhere;
- loading prints `[load] <stage>: <seconds> s` per stage, and a total.

Reading the numbers:

- **Counts are exact** (pipelines, shader modules, uploads, draw calls). **Seconds
  only rank runs on one machine**: a software GPU compiles 5–20× slower than a
  phone. The phone's own numbers come from the in-game Benchmark and the
  "Loaded in X s" line of the pause menu.
- **gpu idle**, not ready, is the loading time a player feels.
- A software frame takes seconds: count animation frames, not time, and never
  judge driving or flying from a headless run.
