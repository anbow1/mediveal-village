// Where a frame's draw calls and triangles go: per object and material, split into shadow passes, other
// render targets (the scene pass, bakes, reflections) and the screen. Averages over a few frames.
//
//   node tools/measure/serve.mjs field-line/dist 4173 &
//   node tools/measure/passes.mjs [--game field-line] --extra '&map=city&q=high' [--view '{"turn":3.14}'] [--top 30]
//
// It wraps three's renderer.info.update, which every draw goes through. A shadow pass is told by the scene's
// override material (three's shadow maps draw everything with their depth material). The renderer and the
// scene come from each game's debug hooks (STAGES below); a new game adds its line.
// Measured with it (2026-11-11): the city's 16.5 M triangles on High were 13.5 M in the sun's four cascades
// and the weapon light's shadow, 9 M of those the far parked cars (playbook §8.4).
import { frames, gameOf, launch, openGame, parseArgs } from './lib.mjs';

const args = parseArgs();
const gameName = args.game ?? 'field-line';
const game = gameOf(gameName);
// Where each game keeps its renderer and scene (an expression run in the page).
const STAGES = {
  'field-line': 'window.__fps.view.stage',
  'castaway-lagoon': 'window.__lagoon.view.stage',
  tanks: '({ renderer: window.__game.pipeline.renderer, scene: window.__game.pipeline.scene })',
  contrail: 'window.__contrail.stage',
  ridgeline: 'window.__ridgeline.stage',
};
const stageExpr = STAGES[gameName];
if (!stageExpr) throw new Error(`no renderer hook for '${gameName}': add it to STAGES`);
const { browser, page } = await launch('webgpu');
await openGame(page, args.url ?? 'http://localhost:4173/', game, args.extra ?? (gameName === 'field-line' ? '&map=city&q=high' : '&q=high'));
if (args.view) await page.evaluate(game.place, JSON.parse(args.view));
await frames(page, 10);
const FRAMES = 3;
await page.evaluate((expr) => {
  const { renderer, scene } = (0, eval)(expr);
  const tally = (window.__tally = new Map());
  const update = renderer.info.update.bind(renderer.info);
  renderer.info.update = (object, count, instances) => {
    const pass = scene.overrideMaterial ? 'shadow' : renderer.getRenderTarget() ? 'target' : 'screen';
    let name = object.name;
    for (let p = object.parent; !name && p; p = p.parent) if (p.name) name = `${p.name}/${object.type}`;
    const material = Array.isArray(object.material) ? object.material[0]?.name : object.material?.name;
    const key = `${pass} | ${name || object.type} | ${material ?? ''}`;
    const e = tally.get(key) ?? { calls: 0, tris: 0 };
    e.calls++;
    if (object.isMesh) e.tris += instances * (count / 3);
    tally.set(key, e);
    return update(object, count, instances);
  };
}, stageExpr);
await frames(page, FRAMES);
const rows = await page.evaluate((n) => [...window.__tally.entries()].map(([key, v]) => ({ key, calls: v.calls / n, tris: v.tris / n })), FRAMES);
await browser.close();

const passes = {};
for (const r of rows) {
  const p = r.key.split(' | ')[0];
  passes[p] ??= { calls: 0, tris: 0 };
  passes[p].calls += r.calls;
  passes[p].tris += r.tris;
}
for (const [p, v] of Object.entries(passes)) console.log(`${p.padEnd(7)} ${String(Math.round(v.calls)).padStart(5)} calls ${(v.tris / 1e6).toFixed(2).padStart(7)} M triangles`);
console.log('\nlargest (triangles per frame, calls per frame, pass | object | material):');
rows.sort((a, b) => b.tris - a.tris);
for (const r of rows.slice(0, Number(args.top ?? 30))) console.log(`${(r.tris / 1e6).toFixed(3).padStart(7)} M ${String(Math.round(r.calls)).padStart(5)}  ${r.key}`);
