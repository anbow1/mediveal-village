// Encodes Poly Haven surface PNGs to KTX2 (Basis Universal) with PSNR verification.
// Also supports `--bench-one` for the mandatory Stage 2 single-texture PNG vs KTX2 benchmark
// before batch conversion (`GUIDE.md` §3 Stage 2).
//
// Usage:
//   KTX2_TOOLS=/tmp/ktx2-tools/node_modules node games/new-game/tools/assets/encode_surfaces.mjs --bench-one
//   KTX2_TOOLS=/tmp/ktx2-tools/node_modules node games/new-game/tools/assets/encode_surfaces.mjs --all-surfaces
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = join(here, '../..');
const srcDir = '/tmp/marchland-src/surfaces_png';
const basisDir = join(gameRoot, 'node_modules/three/examples/jsm/libs/basis');

const basis = await new Function(
  'require',
  '__dirname',
  `${readFileSync(join(basisDir, 'basis_transcoder.js'), 'utf8')}; return BASIS;`,
)(createRequire(import.meta.url), basisDir)({
  wasmBinary: readFileSync(join(basisDir, 'basis_transcoder.wasm')),
});
basis.initializeBasis();

function measurePsnr(ktx2Bytes, rgba) {
  const file = new basis.KTX2File(ktx2Bytes);
  file.startTranscoding();
  const dst = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, 13)); // RGBA32
  file.transcodeImage(dst, 0, 0, 0, 13, 0, -1, -1);
  file.close();
  file.delete();
  let se = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = dst[i + c] - rgba[i + c];
      se += d * d;
    }
  }
  const mse = se / ((rgba.length / 4) * 3);
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}

async function encodePng(pngPath, { mode, srgb, normal, rdo = 1, quality }) {
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const t0 = performance.now();
  const q = quality ?? (mode === 'etc1s' ? 200 : 2);
  const ktx2 = await encodeToKTX2(new Uint8Array(1), {
    isUASTC: mode === 'uastc',
    ...(mode === 'etc1s'
      ? { qualityLevel: q, compressionLevel: 2 }
      : { uastcLDRQualityLevel: q, needSupercompression: true, enableRDO: rdo > 0, rdoQualityLevel: rdo || 1 }),
    generateMipmap: true,
    isPerceptual: srgb,
    isSetKTX2SRGBTransferFunc: srgb,
    isNormalMap: normal,
    imageDecoder: async () => ({ data: rgba, width: info.width, height: info.height }),
  });
  const ms = performance.now() - t0;
  const db = measurePsnr(ktx2, rgba);
  return { ktx2, width: info.width, height: info.height, psnrDb: db, encodeMs: ms };
}

const args = new Set(process.argv.slice(2));

if (args.has('--bench-one')) {
  const benchDir = join(gameRoot, 'public/assets/bench');
  mkdirSync(benchDir, { recursive: true });
  const pngSrc = join(srcDir, 'plaster_albedo_1024.png');
  copyFileSync(pngSrc, join(benchDir, 'plaster_1024.png'));
  const pngBytes = statSync(pngSrc).size;

  const etc1s = await encodePng(pngSrc, { mode: 'etc1s', srgb: true, normal: false });
  writeFileSync(join(benchDir, 'plaster_1024_etc1s.ktx2'), etc1s.ktx2);

  const uastc = await encodePng(pngSrc, { mode: 'uastc', srgb: true, normal: false, rdo: 1 });
  writeFileSync(join(benchDir, 'plaster_1024_uastc.ktx2'), uastc.ktx2);

  const report = {
    source: 'clay_plaster (1024x1024 Diffuse)',
    pngKiB: +(pngBytes / 1024).toFixed(1),
    etc1sKiB: +(etc1s.ktx2.length / 1024).toFixed(1),
    etc1sPsnrDb: +etc1s.psnrDb.toFixed(2),
    uastcRdo1KiB: +(uastc.ktx2.length / 1024).toFixed(1),
    uastcRdo1PsnrDb: +uastc.psnrDb.toFixed(2),
  };
  console.log('=== SINGLE-TEXTURE BENCHMARK ENCODE (1024x1024 clay_plaster) ===');
  console.log(JSON.stringify(report, null, 2));
}

if (args.has('--all-surfaces')) {
  const meta = JSON.parse(readFileSync(join(srcDir, 'surfaces_meta.json'), 'utf8'));
  const outDir = join(gameRoot, 'public/assets/surfaces');
  mkdirSync(outDir, { recursive: true });

  // Uniform compression mode per array texture so all 12 layers share one GPU block format
  // inside CompressedArrayTexture (UASTC+RDO1 for normal & albedo -> BC7/ASTC 45+ dB; ETC1S q200 for ORM -> check PSNR).
  const stats = [];
  let totalPng = 0;
  let totalKtx2 = 0;

  for (const surf of meta) {
    const row = { id: surf.id, index: surf.index, tileSizeM: surf.tileSizeM };
    for (const kind of ['albedo', 'normal', 'orm']) {
      const pngPath = join(srcDir, `${surf.id}_${kind}.png`);
      const pngSize = statSync(pngPath).size;
      totalPng += pngSize;
      // Albedo & Normal use UASTC + RDO 1 (BC7 / ASTC 4x4, >= 43 dB, crisp brick/thatch/normal);
      // ORM uses UASTC + RDO 1.5 (preserves clean separate R=AO, G=Roughness, B=Metalness channels without cross-talk).
      const isNormal = kind === 'normal';
      const isSrgb = kind === 'albedo';
      const rdo = kind === 'orm' ? 1.5 : 1.0;
      const res = await encodePng(pngPath, { mode: 'uastc', srgb: isSrgb, normal: isNormal, rdo });
      const outPath = join(outDir, `${surf.id}_${kind}.ktx2`);
      writeFileSync(outPath, res.ktx2);
      totalKtx2 += res.ktx2.length;
      row[kind] = {
        file: `assets/surfaces/${surf.id}_${kind}.ktx2`,
        bytes: res.ktx2.length,
        psnrDb: +res.psnrDb.toFixed(2),
      };
    }
    stats.push(row);
    console.log(
      `[${String(surf.index).padStart(2, '0')}] ${surf.id.padEnd(10)} | ` +
        `alb ${(row.albedo.bytes / 1024).toFixed(0)} KiB (${row.albedo.psnrDb} dB) · ` +
        `nor ${(row.normal.bytes / 1024).toFixed(0)} KiB (${row.normal.psnrDb} dB) · ` +
        `orm ${(row.orm.bytes / 1024).toFixed(0)} KiB (${row.orm.psnrDb} dB)`,
    );
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ size: 512, layers: stats }, null, 2));
  console.log(
    `\nTotal 12 surfaces (36 maps): PNG ${(totalPng / 1024 / 1024).toFixed(2)} MB -> KTX2 ${(totalKtx2 / 1024 / 1024).toFixed(2)} MB`,
  );
}
