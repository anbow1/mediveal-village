// A shadow stand-in for a scanned mesh (Field Line's SCN1 `mesh.bin`, render/scanModels.ts): the same
// shape with as few triangles as a given error allows, drawn only by the sun's cascades
// (render/layers.ts). The cascades draw every caster again, once per cascade; a scan's UV seams and
// normals, which kept its visible mesh at 1500–2500 triangles, mean nothing to a depth map.
//
//   node tools/assets/shadow_mesh.mjs field-line/src/assets/scan/rock_moss/mesh_01.bin [--error 0.01] [--out <file>]
//
// The vertices are welded by position (the scan splits them along its UV seams), then simplified with
// meshoptimizer until the error reaches --error, as a fraction of the mesh's size (default 0.01: a
// centimetre on a metre-high stump, below a near cascade's texel). Written as SCN1 beside the input
// (`<name>_shadow.bin`), with smooth normals and zero uvs, so the game's parser reads it unchanged.
//
// meshoptimizer (MIT) comes from a game's node_modules (a dependency of three's tooling there), or
// MESHOPT_MODULE=/path/to/meshoptimizer/index.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = { error: '0.01' };
const inputs = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[++i];
  else inputs.push(a);
}
if (inputs.length === 0) throw new Error('give one or more SCN1 mesh files');
if (args.out && inputs.length > 1) throw new Error('--out takes one input');
const modulePath = process.env.MESHOPT_MODULE ?? join(dirname(fileURLToPath(import.meta.url)), '../../field-line/node_modules/meshoptimizer/index.js');
const { MeshoptSimplifier } = await import(pathToFileURL(modulePath).href);
await MeshoptSimplifier.ready;
const errorLimit = Number(args.error);
const MAGIC = 0x314e4353; // 'SCN1'

for (const file of inputs) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const head = new Uint32Array(ab, 0, 4);
  if (head[0] !== MAGIC) throw new Error(`${file}: not an SCN1 mesh`);
  const n = head[1];
  const m = head[2];
  const position = new Float32Array(ab, 16, n * 3);
  const indexOffset = 16 + n * 32;
  const index = n > 65535 ? new Uint32Array(ab, indexOffset, m) : new Uint16Array(ab, indexOffset, m);

  // Weld: one vertex per position, so the simplifier may collapse across the UV seams.
  const remap = MeshoptSimplifier.generatePositionRemap(position, 3);
  const welded = Uint32Array.from(index, (i) => remap[i]);
  const [simplified, error] = MeshoptSimplifier.simplify(welded, position, 3, 3, errorLimit, ['Prune']);
  // Keep only the vertices still used, renumbered: compactMesh rewrites the indices in place.
  const original = simplified.slice();
  const [, count] = MeshoptSimplifier.compactMesh(simplified);
  const compact = simplified;
  const used = new Map();
  for (let i = 0; i < compact.length; i++) used.set(compact[i], original[i]);
  const pos = new Float32Array(count * 3);
  for (const [to, from] of used) pos.set(position.subarray(from * 3, from * 3 + 3), to * 3);
  // Smooth normals from the faces (the depth pass ignores them; the format carries them).
  const nrm = new Float32Array(count * 3);
  for (let t = 0; t < compact.length; t += 3) {
    const [a, b, c] = [compact[t], compact[t + 1], compact[t + 2]];
    const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) nrm[v * 3 + k] += f[k];
  }
  for (let v = 0; v < count; v++) {
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) nrm[v * 3 + k] /= l;
  }
  const wide = count > 65535;
  const outIndex = wide ? Uint32Array.from(compact) : Uint16Array.from(compact);
  const indexBytes = outIndex.byteLength + (outIndex.byteLength % 4);
  const out = new ArrayBuffer(16 + count * 32 + indexBytes);
  new Uint32Array(out, 0, 4).set([MAGIC, count, compact.length, 0]);
  new Float32Array(out, 16, count * 3).set(pos);
  new Float32Array(out, 16 + count * 12, count * 3).set(nrm);
  // uvs stay zero
  (wide ? new Uint32Array(out, 16 + count * 32, compact.length) : new Uint16Array(out, 16 + count * 32, compact.length)).set(outIndex);
  const target = args.out ?? file.replace(/\.bin$/, '_shadow.bin');
  writeFileSync(target, new Uint8Array(out));
  console.log(`${file}: ${m / 3} → ${compact.length / 3} triangles (error ${(error * 100).toFixed(2)} % of the size) → ${target}`);
}
