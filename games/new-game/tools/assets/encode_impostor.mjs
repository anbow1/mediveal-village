// Dilates RGBA edge colors outward into transparent pixels (preventing dark mipmap halos)
// and encodes an impostor PNG to KTX2 UASTC + RDO 1 with full mipmaps.
//
// Usage:
//   KTX2_TOOLS=/tmp/ktx2-tools/node_modules node games/new-game/tools/assets/encode_impostor.mjs in.png out.ktx2

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modules = process.env.KTX2_TOOLS ?? '/tmp/ktx2-tools/node_modules';
const req = createRequire(join(modules, 'noop.js'));
const load = (name) =>
  import(
    name === 'ktx2-encoder'
      ? pathToFileURL(join(modules, 'ktx2-encoder/dist/node/index.js')).href
      : pathToFileURL(req.resolve(name)).href
  );

const sharp = (await load('sharp')).default;
const { encodeToKTX2 } = await load('ktx2-encoder');

const [inArg, outArg] = process.argv.slice(2);
if (!inArg || !outArg) {
  console.error('Usage: encode_impostor.mjs <in.png> <out.ktx2>');
  process.exit(1);
}

const { data, info } = await sharp(resolve(inArg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const w = info.width;
const h = info.height;
const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

// Dilate RGB from opaque pixels (alpha > 16) into transparent neighbors so mipmaps stay color-clean.
const solid = new Uint8Array(w * h);
const rgb = new Float32Array(w * h * 3);
for (let i = 0; i < w * h; i++) {
  const a = rgba[i * 4 + 3];
  solid[i] = a > 16 ? 1 : 0;
  rgb[i * 3] = rgba[i * 4];
  rgb[i * 3 + 1] = rgba[i * 4 + 1];
  rgb[i * 3 + 2] = rgba[i * 4 + 2];
}

for (let pass = 0; pass < 16; pass++) {
  const nextSolid = solid.slice();
  const nextRgb = rgb.slice();
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (solid[idx]) continue;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      if (x > 0 && solid[idx - 1]) {
        const k = (idx - 1) * 3;
        r += rgb[k];
        g += rgb[k + 1];
        b += rgb[k + 2];
        n++;
      }
      if (x + 1 < w && solid[idx + 1]) {
        const k = (idx + 1) * 3;
        r += rgb[k];
        g += rgb[k + 1];
        b += rgb[k + 2];
        n++;
      }
      if (y > 0 && solid[idx - w]) {
        const k = (idx - w) * 3;
        r += rgb[k];
        g += rgb[k + 1];
        b += rgb[k + 2];
        n++;
      }
      if (y + 1 < h && solid[idx + w]) {
        const k = (idx + w) * 3;
        r += rgb[k];
        g += rgb[k + 1];
        b += rgb[k + 2];
        n++;
      }
      if (n > 0) {
        nextSolid[idx] = 1;
        nextRgb[idx * 3] = r / n;
        nextRgb[idx * 3 + 1] = g / n;
        nextRgb[idx * 3 + 2] = b / n;
        changed++;
      }
    }
  }
  solid.set(nextSolid);
  rgb.set(nextRgb);
  if (changed === 0) break;
}

for (let i = 0; i < w * h; i++) {
  rgba[i * 4] = Math.max(0, Math.min(255, Math.round(rgb[i * 3])));
  rgba[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(rgb[i * 3 + 1])));
  rgba[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(rgb[i * 3 + 2])));
}

const ktx2 = await encodeToKTX2(new Uint8Array(1), {
  isUASTC: true,
  uastcLDRQualityLevel: 2,
  needSupercompression: true,
  enableRDO: true,
  rdoQualityLevel: 1,
  generateMipmap: true,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
  isNormalMap: false,
  imageDecoder: async () => ({ data: rgba, width: w, height: h }),
});

const outPath = resolve(outArg);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, ktx2);
console.log(`[encode_impostor] ${inArg} (${w}x${h}) -> ${outArg} (${(ktx2.length / 1024).toFixed(1)} KiB)`);
