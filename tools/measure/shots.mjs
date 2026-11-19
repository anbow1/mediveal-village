// Screenshots of a built game at fixed views, on a software GPU.
//
//   node tools/measure/serve.mjs castaway-lagoon/dist 4173 &
//   node tools/measure/shots.mjs --game castaway-lagoon --out shots/before \
//        --views '[{"pitch":-0.15},{"turn":2.4,"pitch":-0.05}]'
//
// --url      where the build is served (default http://localhost:4173/)
// --game     an entry of GAMES in lib.mjs (default generic)
// --views    JSON array; each view is handed to the game's `place` (see lib.mjs), plus:
//            "frames": animation frames to settle before the shot (default 12: streaming, exposure, TRAA),
//            "eval":   a script run in the page after placing (weather, time of day, a weapon)
// --extra    appended to the query, e.g. '&q=low&map=city'
// --gpu      webgpu (default) or webgl
// --size     WxH (default 800x450: a software frame takes seconds; go larger for a close look only)
// --hide     CSS selector of overlays to hide (default '#ui, #stats, #hud')
//
// Compare before and after at the same views; for anything that moves, take several frames apart.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { frames, gameOf, launch, openGame, parseArgs } from './lib.mjs';

const args = parseArgs();
const game = gameOf(args.game ?? 'generic');
const views = JSON.parse(args.views ?? '[{}]');
const out = args.out ?? 'shot';
const [w, h] = (args.size ?? '800x450').split('x').map(Number);
mkdirSync(dirname(out), { recursive: true });

const { browser, page, errors } = await launch(args.gpu ?? 'webgpu', { width: w, height: h });
const loadS = await openGame(page, args.url ?? 'http://localhost:4173/', game, args.extra ?? '');
console.log(`playing after ${loadS.toFixed(1)} s`);
if (args.hide !== 'none') {
  await page.evaluate((sel) => {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }, args.hide ?? '#ui, #stats, #hud');
}
for (const [i, v] of views.entries()) {
  await page.evaluate(game.place, v);
  if (v.eval) console.log('eval:', await page.evaluate((src) => String((0, eval)(src)), v.eval));
  await frames(page, v.frames ?? 12);
  const file = `${out}_${v.name ?? i}.png`;
  await page.screenshot({ path: file, timeout: 900_000 });
  console.log('wrote', file);
}
for (const e of errors) console.log('ERROR', e);
await browser.close();
process.exit(errors.length ? 1 : 0);
