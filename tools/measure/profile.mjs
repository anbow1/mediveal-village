// A CPU profile of a game's loading: which functions and which source files the main thread spent it in.
//
//   node tools/measure/serve.mjs castaway-lagoon/dist 4173 &
//   node tools/measure/profile.mjs --game castaway-lagoon [--out load.cpuprofile] [--top 30]
//
// Profile a build made with `vite build --minify false` (or the dev server, with no edits while it runs)
// so the names are the source's. Open the .cpuprofile in Chrome DevTools → Performance for the full tree.
// "(idle)" on a software GPU is the main thread waiting for the GPU; on a phone that wait is shorter but
// has the same causes (pipeline builds, uploads): see load.mjs for those.
import { writeFileSync } from 'node:fs';
import { gameOf, launch, openGame, parseArgs } from './lib.mjs';

const args = parseArgs();
const game = gameOf(args.game ?? 'generic');
const top = Number(args.top ?? 30);
const { browser, page } = await launch(args.gpu ?? 'webgpu');
page.on('console', (m) => {
  if (m.text().startsWith('[load]')) console.log(m.text());
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
await cdp.send('Profiler.start');
await openGame(page, args.url ?? 'http://localhost:4173/', game, args.extra ?? '');
const { profile } = await cdp.send('Profiler.stop');
if (args.out) writeFileSync(args.out, JSON.stringify(profile));

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
const inclusive = new Map();
profile.samples.forEach((id, i) => {
  const us = profile.timeDeltas[i] ?? 0;
  const f = byId.get(id).callFrame;
  const key = `${f.functionName || '(anonymous)'} @ ${f.url.split('/').slice(-2).join('/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + us);
  // Each file once per sample, however deep its own calls nest.
  const seen = new Set();
  for (let at = id; at !== undefined; at = parent.get(at)) {
    const file = byId.get(at).callFrame.url.match(/\/(src\/[^?]+|assets\/[^?]+)/)?.[1];
    if (file && !seen.has(file)) {
      seen.add(file);
      inclusive.set(file, (inclusive.get(file) ?? 0) + us);
    }
  }
});
const print = (title, map) => {
  console.log(`\n${title}`);
  for (const [k, us] of [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${(us / 1e6).toFixed(2).padStart(8)} s  ${k}`);
};
print('self time, by function', self);
print('inclusive time, by file', inclusive);
await browser.close();
