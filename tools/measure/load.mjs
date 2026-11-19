// Where a game's loading time goes: what the game logs per stage, how many pipelines and shader
// modules each stage built, which texture uploads were slow, and how much GPU memory textures take.
//
//   node tools/measure/serve.mjs castaway-lagoon/dist 4173 &
//   node tools/measure/load.mjs --game castaway-lagoon [--extra '&q=low'] [--json load.json]
//
// The game prints `[load] <stage>: <seconds>` lines (see field-line/src/main.ts); the builds between two
// such lines are counted under the later one. "gpu idle" is when the GPU has finished everything that
// was queued while loading (GPUQueue.onSubmittedWorkDone): pipelines compile on the GPU's side, so the
// game can say it is ready long before the picture stops stalling. That number, not "ready", is the
// loading time a player feels.
//
// WebGPU only (the counters wrap the WebGPU API). A software GPU is 5–20× slower than a phone at
// compiling: compare runs on one machine, and read the counts (pipelines, modules, uploads) as exact.
//
// --hide-features  comma-separated WebGPU features the page must not see. For KTX2 textures pass
//                  texture-compression-astc,texture-compression-etc2: the software GPU (SwiftShader) offers
//                  both, so KTX2Loader picks ASTC, and SwiftShader decodes ASTC and ETC2 on every texture
//                  read (measured: 12 full-screen draws 580 ms against 200 ms for RGBA8 and 255 ms for BC7).
//                  Hidden, the loader takes BC7/BC1 as on a desktop GPU, which SwiftShader samples at RGBA8's
//                  speed: the time then measures the game, not the emulator. Phones sample ASTC in hardware.
import { writeFileSync } from 'node:fs';
import { gameOf, launch, openGame, parseArgs } from './lib.mjs';

const args = parseArgs();
const game = gameOf(args.game ?? 'generic');
const { browser, page, errors } = await launch('webgpu');

if (args['hide-features']) {
  await page.addInitScript((hidden) => {
    const has = GPUSupportedFeatures.prototype.has;
    GPUSupportedFeatures.prototype.has = function (name) {
      return !hidden.includes(name) && has.call(this, name);
    };
  }, args['hide-features'].split(','));
}

await page.addInitScript(() => {
  const ev = (window.__ev = []);
  const wrap = (proto, name) => {
    const f = proto[name];
    proto[name] = function (...a) {
      const t0 = performance.now();
      const r = f.apply(this, a);
      if (r && typeof r.then === 'function') r.then(() => ev.push({ k: name, t: t0, d: performance.now() - t0 }));
      else ev.push({ k: name, t: t0, d: performance.now() - t0 });
      return r;
    };
  };
  const requestDevice = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (...a) {
    const d = await requestDevice.apply(this, a);
    window.__dev = d;
    return d;
  };
  wrap(GPUDevice.prototype, 'createRenderPipeline');
  wrap(GPUDevice.prototype, 'createRenderPipelineAsync');
  wrap(GPUDevice.prototype, 'createComputePipeline');
  wrap(GPUDevice.prototype, 'createShaderModule');
  // Texture memory: every texture the device creates, its bytes from size, format and mip levels. Textures
  // the CPU uploads (images, generated data) are counted apart from those the GPU renders: only the former
  // shrink with KTX2.
  const BYTES = { r8unorm: 1, rg8unorm: 2, rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4, r16float: 2, rg16float: 4, rgba16float: 8, r32float: 4, rg32float: 8, rgba32float: 16, depth16unorm: 2, depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4, rgb10a2unorm: 4, rg11b10ufloat: 4, r32uint: 4, rgba32uint: 16 };
  window.__textures = [];
  const createTexture = GPUDevice.prototype.createTexture;
  GPUDevice.prototype.createTexture = function (d) {
    const t = createTexture.call(this, d);
    const sz = Array.isArray(d.size) ? d.size : [d.size.width, d.size.height ?? 1, d.size.depthOrArrayLayers ?? 1];
    const [w, h, layers] = [sz[0], sz[1] ?? 1, sz[2] ?? 1];
    const levels = d.mipLevelCount ?? 1;
    // Block-compressed formats: bytes per 4 × 4 block (BC1/ETC2 RGB 8, the rest 16), as bytes per texel.
    const block = /^(bc1|etc2-rgb8|eac-r11)/.test(d.format) ? 0.5 : /^(bc|etc2|eac|astc)/.test(d.format) ? 1 : null;
    const per = block ?? BYTES[d.format] ?? 4;
    let bytes = 0;
    for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * per;
    bytes *= layers * (d.sampleCount ?? 1);
    // "Uploaded" is decided later: three gives most textures RENDER_ATTACHMENT (it renders their mipmaps), so
    // usage cannot tell an asset from a render target; a texture the CPU writes into is an asset.
    const rec = { w, h, layers, levels, format: d.format, bytes, uploaded: false, compressed: block !== null };
    window.__textures.push(rec);
    texRecord.set(t, rec);
    return t;
  };
  const texRecord = new WeakMap();
  const markUploaded = (dst) => {
    const r = texRecord.get(dst.texture);
    if (r) r.uploaded = true;
  };
  const writeTexture = GPUQueue.prototype.writeTexture;
  GPUQueue.prototype.writeTexture = function (dst, ...rest) {
    markUploaded(dst);
    return writeTexture.call(this, dst, ...rest);
  };
  // Uploads of images and canvases: a GPU-backed 2D canvas is read back across contexts (see the playbook).
  const copy = GPUQueue.prototype.copyExternalImageToTexture;
  window.__uploads = [];
  GPUQueue.prototype.copyExternalImageToTexture = function (src, dst, size) {
    const t0 = performance.now();
    markUploaded(dst);
    const r = copy.call(this, src, dst, size);
    const s = src.source;
    window.__uploads.push({ kind: s.constructor.name, w: s.width, h: s.height, ms: performance.now() - t0 });
    return r;
  };
  const log = console.log;
  console.log = (...a) => {
    if (typeof a[0] === 'string' && a[0].startsWith('[load]')) ev.push({ k: 'LOAD ' + a[0].slice(7), t: performance.now(), d: 0 });
    log(...a);
  };
});

const readyS = await openGame(page, args.url ?? 'http://localhost:4173/', game, args.extra ?? '');
const t0 = Date.now();
await page.evaluate(() => window.__dev?.queue.onSubmittedWorkDone());
const idleS = readyS + (Date.now() - t0) / 1000;
const { ev, uploads, textures } = await page.evaluate(() => ({ ev: window.__ev, uploads: window.__uploads, textures: window.__textures }));

ev.sort((a, b) => a.t - b.t);
const stages = [];
let acc = {};
const close = (name) => {
  stages.push({ stage: name, ...acc });
  acc = {};
};
for (const e of ev) {
  if (e.k.startsWith('LOAD ')) close(e.k.slice(5));
  else {
    const a = (acc[e.k] ??= { n: 0, s: 0 });
    a.n++;
    a.s += e.d / 1000;
  }
}
close('(after the last stage)');

const short = { createRenderPipeline: 'pipelines', createRenderPipelineAsync: 'pipelines (async)', createComputePipeline: 'compute', createShaderModule: 'modules' };
console.log('\nstage — builds');
for (const s of stages) {
  const parts = Object.entries(s).filter(([k]) => k !== 'stage').map(([k, v]) => `${v.n} ${short[k]} ${v.s.toFixed(2)} s`);
  console.log(`  ${s.stage}${parts.length ? ' — ' + parts.join(', ') : ''}`);
}
const total = (k) => ev.filter((e) => e.k === k).length;
console.log(`\npipelines ${total('createRenderPipeline') + total('createRenderPipelineAsync')}, shader modules ${total('createShaderModule')}`);

const by = new Map();
for (const u of uploads) {
  const k = `${u.kind} ${u.w}×${u.h}`;
  const e = by.get(k) ?? { n: 0, ms: 0 };
  e.n++;
  e.ms += u.ms;
  by.set(k, e);
}
const slow = [...by.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8);
console.log(`\nimage uploads ${uploads.length}, ${(uploads.reduce((s, u) => s + u.ms, 0) / 1000).toFixed(2)} s; slowest kinds:`);
for (const [k, e] of slow) console.log(`  ${e.n} × ${k}: ${(e.ms / 1000).toFixed(2)} s`);

const mb = (list) => list.reduce((sum, t) => sum + t.bytes, 0) / 2 ** 20;
const sampled = textures.filter((t) => t.uploaded);
const targets = textures.filter((t) => !t.uploaded);
const textureMemory = { sampledMB: +mb(sampled).toFixed(1), targetsMB: +mb(targets).toFixed(1), sampledCount: sampled.length, compressedMB: +mb(sampled.filter((t) => t.compressed)).toFixed(1) };
console.log(`\ntexture memory: ${textureMemory.sampledMB} MB in ${sampled.length} uploaded textures (images, generated data; ${textureMemory.compressedMB} MB block-compressed), ${textureMemory.targetsMB} MB in ${targets.length} rendered ones (targets, bakes, shadow maps); largest uploaded:`);
const kinds = new Map();
for (const t of sampled) {
  const k = `${t.w}×${t.h}${t.layers > 1 ? `×${t.layers}` : ''} ${t.format}`;
  const e = kinds.get(k) ?? { n: 0, bytes: 0 };
  e.n++;
  e.bytes += t.bytes;
  kinds.set(k, e);
}
for (const [k, e] of [...kinds.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8)) console.log(`  ${e.n} × ${k}: ${(e.bytes / 2 ** 20).toFixed(1)} MB`);

console.log(`\nready after ${readyS.toFixed(1)} s, gpu idle after ${idleS.toFixed(1)} s`);
if (args.json) writeFileSync(args.json, JSON.stringify({ readyS, idleS, stages, uploads: Object.fromEntries(by), textureMemory }, null, 1));
for (const e of errors) console.log('ERROR', e);
await browser.close();
