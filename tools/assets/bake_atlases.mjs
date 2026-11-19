// Bakes the MPFB characters' texture atlases to KTX2 (block-compressed on the GPU: a quarter of the
// memory of the RGBA8 canvas they are drawn into at load, nothing to fetch or draw).
//
//   cd field-line && npx vite build --base ./ --mode bake --outDir /tmp/fl && cd ..
//   node tools/measure/serve.mjs /tmp/fl 4173 &
//   node tools/assets/bake_atlases.mjs --game field-line --out field-line/src/assets/people/atlas
//
// The bake mode build carries the characters' own piece textures, which the game's build leaves out (it only
// loads the baked atlases). The atlases are taken from the game itself: the page is opened with `globalThis.__keepAtlases` set, so
// mpfbCast.ts draws every atlas as it always does and keeps the canvases; their pixels are read back and
// encoded here. A baked atlas is therefore the drawn one, texel for texel, before compression. Bake again
// whenever a character, its textures or the atlas layout (mpfbCast.ts tileShare, ATLAS) change: a stale
// atlas puts the wrong picture under the uvs.
//
// --url      where the build is served (default http://localhost:4173/)
// --game     an entry of GAMES in tools/measure/lib.mjs (field-line, castaway-lagoon, tanks)
// --out      the folder for <name>_<lod>.ktx2
// --mode     the near (_full) atlases: uastc (default) or etc1s; --far-mode the far ones: etc1s (default) or uastc.
//            Measured on Field Line's rifleman (RGB PSNR against the drawn atlas, file size, 2048²): ETC1S q200
//            36 dB, 0.37 MB — blocky up close; UASTC 50 dB, 2.0 MB; UASTC + RDO 1 45.6 dB, 1.65 MB (default).
//            The far atlases (512², seen small) lose nothing visible in ETC1S at 50 KiB.
// --quality  ETC1S quality 1–255 (default 200) / UASTC level 0–4 (default 2)
// --rdo      UASTC rate-distortion quality (default 1: smaller files for ~4 dB; 0 = off)
// --raw      also write each drawn atlas as <name>_<lod>.rgba (raw RGBA8, top row first), to measure what
//            the compression costs (PSNR against the decoded KTX2)
//
// Needs Playwright (as tools/measure) and ktx2-encoder (`npm i -D ktx2-encoder`, MIT, Basis Universal inside),
// or KTX2_ENCODER_MODULE=/path/to/ktx2-encoder/dist/node/index.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameOf, launch, openGame, parseArgs } from '../measure/lib.mjs';

const args = parseArgs();
const out = args.out;
if (!out) throw new Error('--out <folder> is required');
const modes = { full: args.mode ?? 'uastc', far: args['far-mode'] ?? 'etc1s' };
for (const m of Object.values(modes)) if (m !== 'etc1s' && m !== 'uastc') throw new Error(`mode '${m}' is not etc1s or uastc`);
const rdo = Number(args.rdo ?? 1);
const { encodeToKTX2 } = await import(process.env.KTX2_ENCODER_MODULE ?? 'ktx2-encoder');

const game = gameOf(args.game ?? 'field-line');
const { browser, page, errors } = await launch('webgpu');
await page.addInitScript(() => {
  globalThis.__keepAtlases = true;
});
// High: both levels of every character are drawn.
await openGame(page, args.url ?? 'http://localhost:4173/', game, '&q=high');
const atlases = await page.evaluate(() =>
  (globalThis.__atlases ?? []).map(({ base, canvas }) => {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Base64 in chunks: a 2048² atlas is 16 MB of pixels.
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { base, width: canvas.width, height: canvas.height, rgba: btoa(bin) };
  }),
);
await browser.close();
for (const e of errors) console.log('page error:', e);
if (atlases.length === 0) throw new Error('no atlases were drawn: is this a game with an MPFB cast, and was the build made after mpfbCast.ts kept them?');

mkdirSync(out, { recursive: true });
for (const a of atlases) {
  const rgba = new Uint8Array(Buffer.from(a.rgba, 'base64'));
  const t0 = Date.now();
  const mode = a.base.endsWith('_far') ? modes.far : modes.full;
  const quality = Number(args.quality ?? (mode === 'etc1s' ? 200 : 2));
  const ktx2 = await encodeToKTX2(new Uint8Array(1), {
    isUASTC: mode === 'uastc',
    // ETC1S's quality; UASTC's level, rate-distortion and Zstandard on top.
    ...(mode === 'etc1s' ? { qualityLevel: quality, compressionLevel: 2 } : { uastcLDRQualityLevel: quality, needSupercompression: true, enableRDO: rdo > 0, rdoQualityLevel: rdo || 1 }),
    generateMipmap: true,
    isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true,
    // The pixels are already decoded: hand them over as they are.
    imageDecoder: async () => ({ data: rgba, width: a.width, height: a.height }),
  });
  if (args.raw) writeFileSync(join(out, `${a.base}.rgba`), rgba);
  const file = join(out, `${a.base}.ktx2`);
  writeFileSync(file, ktx2);
  console.log(`${file}: ${a.width}², ${(ktx2.length / 1024).toFixed(0)} KiB (${mode}), ${Date.now() - t0} ms`);
}
