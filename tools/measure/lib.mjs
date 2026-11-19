// Shared by the scripts in this folder: the browser, its software GPU, and what each game exposes.
//
// Playwright: `npm i -D playwright`, or PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs for a global one.
// CHROME_PATH picks another Chromium.

/** Software renderers: the same code path as a phone (WebGPU) or its fallback (WebGL2), no GPU needed. */
export const GPU_FLAGS = {
  webgpu: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader'],
  webgl: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

/** `--key value` and bare `--flag` arguments as an object. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    out[a.slice(2)] = next !== undefined && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

export async function launch(gpu = 'webgpu', viewport = { width: 800, height: 450 }) {
  const flags = GPU_FLAGS[gpu];
  if (!flags) throw new Error(`--gpu '${gpu}' is not one of: ${Object.keys(GPU_FLAGS).join(', ')}`);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const browser = await chromium.launch({ args: flags, executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page: ${e.message.slice(0, 300)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  return { browser, page, errors };
}

/** Waits `n` animation frames: a software renderer's frame takes seconds, so count frames, not time. */
export async function frames(page, n) {
  for (let k = 0; k < n; k++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

/**
 * What each game needs to reach play without a click and to be put somewhere.
 *
 * A new game should meet the first contract and need no entry of its own (`--game generic`):
 * `?autostart` skips the menu, `window.__ready === true` once the first frames are drawn, and
 * `window.__debug.place({x, y, z, yaw, pitch})` or `window.__debug.spot(name)` moves the camera.
 * The entries below adapt the games written before that contract.
 *
 * `place` runs in the page with one view object from --views.
 */
export const GAMES = {
  generic: {
    query: '?autostart&debug',
    ready: 'window.__ready === true',
    place: (v) => {
      if (v.spot !== undefined) window.__debug.spot(v.spot);
      else window.__debug.place(v);
    },
  },
  'field-line': {
    // &map=range|city|forest, &time=…, &q=high|low
    query: '?autostart&debug&nostats',
    ready: 'window.__ready === true',
    place: (v) => {
      const pl = window.__fps.game.player;
      if (v.x !== undefined) {
        pl.body.position.set(v.x, v.y, v.z);
        pl.prevPosition.copy(pl.body.position);
        pl.body.velocity.set(0, 0, 0);
      }
      if (v.yaw !== undefined) pl.yawRad = v.yaw;
      if (v.turn !== undefined) pl.yawRad += v.turn;
      if (v.pitch !== undefined) pl.pitchRad = v.pitch;
    },
  },
  'castaway-lagoon': {
    query: '?autostart',
    ready: 'window.__ready === true',
    place: (v) => {
      const pl = window.__lagoon.game.player;
      if (v.x !== undefined) {
        pl.pos.x = pl.prev.x = v.x;
        pl.pos.y = pl.prev.y = v.y;
        pl.pos.z = pl.prev.z = v.z;
      }
      if (v.dx !== undefined) {
        pl.pos.x = pl.prev.x = pl.pos.x + v.dx;
        pl.pos.z = pl.prev.z = pl.pos.z + (v.dz ?? 0);
      }
      if (v.yaw !== undefined) pl.yawRad = v.yaw;
      if (v.turn !== undefined) pl.yawRad += v.turn;
      if (v.pitch !== undefined) pl.pitchRad = v.pitch;
    },
  },
  tanks: {
    // Views name a benchmark spot: {"spot": "village"}; &q=high|low
    query: '?debug',
    ready: "window.__game && window.__spots && !document.getElementById('btn-play').disabled",
    start: () => {
      for (const el of document.querySelectorAll('.overlay, #menu, #start, .screen')) el.style.display = 'none';
      window.__game.pause(false);
    },
    place: (v) => {
      const s = window.__spots.find((x) => x.name === v.spot);
      if (!s) throw new Error(`no benchmark spot '${v.spot}'; there are: ${window.__spots.map((x) => x.name).join(', ')}`);
      window.__game.benchPlace(s.x, s.z, s.yawRad + (v.turn ?? 0));
    },
  },
  contrail: {
    // Views pick a camera: {"mode": "chase" | "cockpit" | "panel" | "orbit"}; &spawn=air&alt=1500, &time=morning|noon|dusk
    query: '?autostart&mute',
    ready: 'window.__contrail && window.__contrail.frames > 5',
    place: (v) => {
      if (v.mode !== undefined) window.__contrail.rig.mode = v.mode;
    },
  },
  ridgeline: {
    // Views pick a camera: {"mode": "chase" | "cockpit" | "gunner" | "orbit"}; &spawn=air&alt=30, &time=morning|noon|dusk|rain
    query: '?autostart&mute',
    ready: 'window.__ridgeline && window.__ridgeline.frames > 5',
    place: (v) => {
      if (v.mode !== undefined) window.__ridgeline.rig.mode = v.mode;
    },
  },
};

export function gameOf(name) {
  const g = GAMES[name];
  if (!g) throw new Error(`--game '${name}' is not one of: ${Object.keys(GAMES).join(', ')}`);
  return g;
}

/** Opens the game and waits until it plays. `extra` is appended to the game's query (`&q=low&map=city`). */
export async function openGame(page, url, game, extra = '') {
  const t0 = Date.now();
  await page.goto(url.replace(/\/?$/, '/') + game.query + extra);
  await page.waitForFunction(game.ready, null, { timeout: 2_400_000, polling: 1000 });
  if (game.start) await page.evaluate(game.start);
  return (Date.now() - t0) / 1000;
}
