// Re-encodes the textures inside glTF binaries (.glb) to KTX2 (KHR_texture_basisu): the GPU keeps them
// block-compressed, a quarter to an eighth of the memory of the RGBA8 a JPEG or PNG decodes to.
//
//   node tools/assets/ktx2_glb.mjs shared/vehicles/sedan/sedan_lod0.glb --out /tmp/sedan_lod0.glb
//   node tools/assets/ktx2_glb.mjs shared/vehicles/*/*_lod[01].glb --in-place
//
// Colour textures (base colour, emissive: sRGB) and data textures (metal/roughness, occlusion: linear) each
// take a mode; normal maps are always UASTC (ETC1S blocks bend them visibly):
// --color    auto (default), etc1s or uastc
// --data     auto (default), etc1s or uastc
//            auto: ETC1S first (as small as the JPEG, an eighth of the memory of RGBA8), decoded back and
//            compared with the source; below --min-psnr it is encoded again as UASTC (twice ETC1S's memory,
//            a few times its file). Measured on the shared sedan (RGB PSNR, file): body colour ETC1S 42 dB
//            262 KiB; headlamp atlas ETC1S 28.6 dB, UASTC 37.6 dB 975 KiB; wheel roughness ETC1S 35.8 dB.
//            Smooth paint and tyres pass in ETC1S; fine print and sharp edges go to UASTC.
// --min-psnr the auto threshold in dB (default 40)
// --quality  ETC1S quality 1–255 (default 200) / UASTC level 0–4 (default 2)
// --rdo      UASTC rate-distortion quality (default 1; 0 = off)
// --transcoder the folder with three's basis_transcoder.js / .wasm, for auto (default three's examples/jsm/libs/basis
//            under field-line/node_modules)
// --out      the output file (one input only), or --in-place to overwrite each input
// --raw      also write each decoded source image as <out>.<texture index>.rgba (raw RGBA8, top row first),
//            to measure what the compression costs
//
// Worth it or not: UASTC is 8 bits a texel and zstd packs it only ~1.5×, where a JPEG packs ~10×, so a model
// whose maps are detailed (normal maps, worn metal: UASTC throughout) grows 4–5× on disk. Keep KTX2 where
// it saves at least 10 MB of GPU memory per MB it adds to the file (estimate: RGBA8 with mips is
// 5.3 B a texel, UASTC 1.3, ETC1S 0.7), and the JPEGs elsewhere. Measured on the shared models: the cars,
// jeep, lorries, the Abrams and Bradley, both jets and the pistol pass; the AK, carbine, bolt rifle,
// knife, skiff, Bulat, BMP and T-90 do not (2–8 MB of file for 12–48 MB of memory each), nor the Warden:
// Ridgeline measured 8 MB less memory for 1.6 MB more build (the game draws only some of its maps). The
// estimate ranks; the game's own load.mjs memory decides.
//
// A loader then needs KTX2 support (`GLTFLoader.setKTX2Loader(new KTX2Loader()
// .detectSupport(renderer))`): every game that loads the files must have it, or they stop loading.
// Textures already in KTX2 are left as they are, so running twice changes nothing.
//
// Needs, beside Node: @gltf-transform/core and /extensions (MIT), sharp (Apache-2.0, decodes JPEG and PNG)
// and ktx2-encoder (MIT, Basis Universal): `npm i -D @gltf-transform/core @gltf-transform/extensions
// @gltf-transform/functions sharp ktx2-encoder` in a scratch folder, and KTX2_TOOLS=<that folder>/node_modules.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The packages live in a scratch folder, not in this repository: KTX2_TOOLS=<that folder>/node_modules.
const modules = process.env.KTX2_TOOLS;
if (!modules) throw new Error('set KTX2_TOOLS to the node_modules folder that holds the packages (see the head of this file)');
const req = createRequire(join(modules, 'noop.js'));
// ktx2-encoder exports only an ES module for Node, which require.resolve cannot find: its file directly.
const load = (name) => import(name === 'ktx2-encoder' ? pathToFileURL(join(modules, 'ktx2-encoder/dist/node/index.js')).href : pathToFileURL(req.resolve(name)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRTextureBasisu } = await load('@gltf-transform/extensions');
const { getTextureColorSpace, listTextureSlots } = await load('@gltf-transform/functions');
const sharp = (await load('sharp')).default;
const { encodeToKTX2 } = await load('ktx2-encoder');

// Files anywhere on the line; --in-place and --raw take no value, every other option takes one.
const FLAGS = new Set(['in-place', 'raw']);
const args = {};
const inputs = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) inputs.push(a);
  else if (FLAGS.has(a.slice(2))) args[a.slice(2)] = true;
  else args[a.slice(2)] = process.argv[++i];
}
if (inputs.length === 0) throw new Error('give one or more .glb files');
if (!args['in-place'] && !(args.out && inputs.length === 1)) throw new Error('give --out <file> for one input, or --in-place');
const modes = { color: args.color ?? 'auto', data: args.data ?? 'auto' };
for (const m of Object.values(modes)) if (!['auto', 'etc1s', 'uastc'].includes(m)) throw new Error(`mode '${m}' is not auto, etc1s or uastc`);
const rdo = Number(args.rdo ?? 1);
const minPsnr = Number(args['min-psnr'] ?? 40);

// three's Basis transcoder decodes what was encoded, to measure it. It is a script that defines `BASIS` and,
// under Node, reaches for `require` and `__dirname`: handed in, as this file is an ES module.
const basisDir = args.transcoder ?? join(dirname(fileURLToPath(import.meta.url)), '../../field-line/node_modules/three/examples/jsm/libs/basis');
const basis = await new Function('require', '__dirname', `${readFileSync(join(basisDir, 'basis_transcoder.js'), 'utf8')}; return BASIS;`)(createRequire(import.meta.url), basisDir)({ wasmBinary: readFileSync(join(basisDir, 'basis_transcoder.wasm')) });
basis.initializeBasis();
/** RGB(A) PSNR of level 0 of `ktx2` against the source pixels; alpha counts only where the source has any. */
function psnr(ktx2, rgba) {
  const file = new basis.KTX2File(ktx2);
  file.startTranscoding();
  const dst = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, 13)); // 13: RGBA32
  file.transcodeImage(dst, 0, 0, 0, 13, 0, -1, -1);
  file.close();
  file.delete();
  let alpha = false;
  for (let i = 3; i < rgba.length && !alpha; i += 4) alpha = rgba[i] < 255;
  const channels = alpha ? 4 : 3;
  let se = 0;
  for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < channels; c++) se += (dst[i + c] - rgba[i + c]) ** 2;
  return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / ((rgba.length / 4) * channels)));
}

async function encode(rgba, width, height, mode, srgb, normal) {
  const quality = Number(args.quality ?? (mode === 'etc1s' ? 200 : 2));
  return encodeToKTX2(new Uint8Array(1), {
    isUASTC: mode === 'uastc',
    ...(mode === 'etc1s' ? { qualityLevel: quality, compressionLevel: 2 } : { uastcLDRQualityLevel: quality, needSupercompression: true, enableRDO: rdo > 0, rdoQualityLevel: rdo || 1 }),
    generateMipmap: true,
    isPerceptual: srgb,
    isSetKTX2SRGBTransferFunc: srgb,
    isNormalMap: normal,
    // The pixels are already decoded: hand them over as they are.
    imageDecoder: async () => ({ data: rgba, width, height }),
  });
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of inputs) {
  const doc = await io.read(file);
  const out = args['in-place'] ? file : args.out;
  let before = 0;
  let after = 0;
  const textures = doc.getRoot().listTextures();
  for (const [i, tex] of textures.entries()) {
    if (tex.getMimeType() === 'image/ktx2') continue;
    const src = tex.getImage();
    if (!src) continue;
    // sRGB for colour, linear for data (gltf-transform answers 'srgb' or null; a texture in no slot is data).
    const srgb = getTextureColorSpace(tex) === 'srgb';
    const normal = listTextureSlots(tex).some((s) => s.startsWith('normal'));
    const wanted = normal ? 'uastc' : srgb ? modes.color : modes.data;
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (args.raw) writeFileSync(`${out}.${i}.rgba`, rgba);
    let mode = wanted === 'auto' ? 'etc1s' : wanted;
    let ktx2 = await encode(rgba, info.width, info.height, mode, srgb, normal);
    let db = psnr(ktx2, rgba);
    if (wanted === 'auto' && db < minPsnr) {
      mode = 'uastc';
      ktx2 = await encode(rgba, info.width, info.height, mode, srgb, normal);
      db = psnr(ktx2, rgba);
    }
    before += src.byteLength;
    after += ktx2.byteLength;
    console.log(`  ${tex.getName() || i}: ${info.width}×${info.height} ${srgb ? 'sRGB' : 'linear'} ${mode} ${db.toFixed(1)} dB, ${(src.byteLength / 1024).toFixed(0)} → ${(ktx2.byteLength / 1024).toFixed(0)} KiB`);
    tex.setImage(ktx2).setMimeType('image/ktx2');
  }
  if (after > 0) doc.createExtension(KHRTextureBasisu).setRequired(true);
  await io.write(out, doc);
  console.log(`${file} → ${out}: textures ${(before / 1024).toFixed(0)} → ${(after / 1024).toFixed(0)} KiB`);
}
