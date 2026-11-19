// Builds `public/assets/manifest.json` with exact relative asset paths and byte counts
// so the loading screen reports true downloaded byte progress (GUIDE.md §3 Stage 2).
// Also removes temporary `public/assets/bench/` benchmark fixtures if present.

import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = join(here, '../..');
const publicDir = join(gameRoot, 'public');
const assetsDir = join(publicDir, 'assets');

// Remove temporary single-texture PNG vs KTX2 benchmark fixtures before shipping dist/.
rmSync(join(assetsDir, 'bench'), { recursive: true, force: true });

const files = [];
function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (e.isFile() && (e.name.endsWith('.glb') || e.name.endsWith('.ktx2'))) {
      const rel = relative(publicDir, full).replace(/\\/g, '/');
      files.push({ path: rel, bytes: statSync(full).size });
    }
  }
}

walk(assetsDir);

const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
const manifest = { totalBytes, files };
const outPath = join(assetsDir, 'manifest.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `[manifest] ${files.length} binary assets, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total -> ${outPath}`,
);
