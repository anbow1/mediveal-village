// Optimizes a Blender-exported .glb:
//   1. Optional embedded-texture KTX2 re-encoding via repo's `tools/assets/ktx2_glb.mjs` (pass `--ktx2`).
//   2. Deduplicate, prune, quantize, and EXT_meshopt_compression via @gltf-transform + meshoptimizer.
//
// Usage:
//   KTX2_TOOLS=/tmp/ktx2-tools/node_modules node games/new-game/tools/blender/optimize_glb.mjs \
//     in.glb out.glb [--ktx2] [--color auto|etc1s|uastc] [--data auto|etc1s|uastc] [--min-psnr 38]

import { execFileSync } from 'node:child_process';
import { copyFileSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modules = process.env.KTX2_TOOLS ?? '/tmp/ktx2-tools/node_modules';
const req = createRequire(join(modules, 'noop.js'));
const load = (name) => import(pathToFileURL(req.resolve(name)).href);

const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { dedup, prune, meshopt } = await load('@gltf-transform/functions');
const meshoptPkg = await load('meshoptimizer');
const MeshoptEncoder = meshoptPkg.MeshoptEncoder;
await MeshoptEncoder.ready;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const gameRoot = resolve(here, '../..');

const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) positional.push(a);
  else if (a === '--ktx2' || a === '--no-meshopt') flags[a.slice(2)] = true;
  else flags[a.slice(2)] = argv[++i];
}

if (positional.length < 2) {
  console.error('Usage: optimize_glb.mjs <in.glb> <out.glb> [--ktx2] [--color auto|etc1s|uastc] [--data auto|etc1s|uastc]');
  process.exit(1);
}

const inPath = resolve(positional[0]);
const outPath = resolve(positional[1]);
const rawSize = statSync(inPath).size;

let workingPath = inPath;
let tempKtx2 = null;

if (flags.ktx2) {
  tempKtx2 = `${outPath}.ktx2tmp.glb`;
  const ktx2Script = join(repoRoot, 'tools/assets/ktx2_glb.mjs');
  const transcoderDir = join(gameRoot, 'node_modules/three/examples/jsm/libs/basis');
  const ktxArgs = [
    ktx2Script,
    inPath,
    '--out',
    tempKtx2,
    '--transcoder',
    transcoderDir,
    '--color',
    flags.color ?? 'auto',
    '--data',
    flags.data ?? 'auto',
    '--min-psnr',
    flags['min-psnr'] ?? '38',
  ];
  execFileSync(process.execPath, ktxArgs, {
    stdio: 'inherit',
    env: { ...process.env, KTX2_TOOLS: modules },
  });
  workingPath = tempKtx2;
}

if (flags['no-meshopt']) {
  copyFileSync(workingPath, outPath);
} else {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(workingPath);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(outPath, doc);
}

if (tempKtx2) {
  try {
    unlinkSync(tempKtx2);
  } catch {
    // ignore cleanup error
  }
}

const finalSize = statSync(outPath).size;
console.log(
  `[optimize_glb] ${positional[0]} -> ${positional[1]}: ${(rawSize / 1024).toFixed(1)} KiB -> ${(finalSize / 1024).toFixed(1)} KiB (${((1 - finalSize / rawSize) * 100).toFixed(1)}% saved)`,
);
