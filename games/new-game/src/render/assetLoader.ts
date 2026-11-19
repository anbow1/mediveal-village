// Stage 2 asset loader: byte-accurate streaming fetch, KTX2Loader (after renderer.init, no setTranscoderPath),
// GLTFLoader + MeshoptDecoder, and CompressedArrayTexture assembly for uniform-format KTX2 layer sets.

import {
  CompressedArrayTexture,
  CompressedTexture,
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  UnsignedByteType,
  type WebGPURenderer,
} from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export interface AssetManifestEntry {
  readonly path: string;
  readonly bytes: number;
}

export interface AssetManifest {
  readonly totalBytes: number;
  readonly files: readonly AssetManifestEntry[];
}

export interface ByteProgressTracker {
  readonly totalBytes: number;
  loadedBytes: number;
  report(deltaBytes: number): void;
}

export function createByteProgressTracker(
  totalBytes: number,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
): ByteProgressTracker {
  const tracker: ByteProgressTracker = {
    totalBytes: Math.max(1, totalBytes),
    loadedBytes: 0,
    report(deltaBytes: number) {
      tracker.loadedBytes = Math.min(tracker.totalBytes, tracker.loadedBytes + Math.max(0, deltaBytes));
      onProgress(tracker.loadedBytes, tracker.totalBytes);
    },
  };
  onProgress(0, tracker.totalBytes);
  return tracker;
}

/** Fetches a binary asset while reporting real downloaded byte chunks for the loading bar. */
export async function fetchArrayBufferWithProgress(
  url: string,
  tracker?: ByteProgressTracker,
): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  if (!response.body || !tracker) {
    const buf = await response.arrayBuffer();
    tracker?.report(buf.byteLength);
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      total += value.byteLength;
      tracker.report(value.byteLength);
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export class AssetLoader {
  readonly ktx2: KTX2Loader;
  readonly gltf: GLTFLoader;
  private readonly texLoader = new TextureLoader();

  /**
   * MUST be constructed AFTER `await renderer.init()` so `KTX2Loader.detectSupport(renderer)`
   * reads live GPU compressed format support (BC7 / ASTC / ETC2).
   * Intentionally does NOT call `setTranscoderPath()` so Vite bundles basis_transcoder once via import.meta.url.
   */
  constructor(renderer: WebGPURenderer) {
    this.ktx2 = new KTX2Loader();
    this.ktx2.detectSupport(renderer);

    this.gltf = new GLTFLoader();
    this.gltf.setKTX2Loader(this.ktx2);
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  async loadKtx2(url: string, srgb: boolean, tracker?: ByteProgressTracker): Promise<CompressedTexture> {
    const buffer = await fetchArrayBufferWithProgress(url, tracker);
    const tex = await new Promise<CompressedTexture>((resolve, reject) => {
      this.ktx2.parse(buffer, resolve, reject);
    });
    tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Loads N uniform-resolution, uniform-mode KTX2 files in parallel and concatenates every mip
   * level into one `CompressedArrayTexture` (or `DataArrayTexture` if GPU lacks block compression).
   */
  async loadKtx2Array(
    urls: readonly string[],
    srgb: boolean,
    anisotropy: number,
    tracker?: ByteProgressTracker,
  ): Promise<CompressedArrayTexture | DataArrayTexture> {
    if (urls.length === 0) throw new Error('loadKtx2Array requires at least one URL');
    const layers = await Promise.all(urls.map((u) => this.loadKtx2(u, srgb, tracker)));
    const first = layers[0];
    if (!first) throw new Error('loadKtx2Array: empty result');

    const width = first.image.width;
    const height = first.image.height;
    const depth = layers.length;
    const format = first.format;
    const type = first.type;

    if ((format as number) === (RGBAFormat as number)) {
      // Uncompressed fallback: copy mip 0 from every layer into a DataArrayTexture with auto mips.
      const sliceBytes = width * height * 4;
      const merged = new Uint8Array(sliceBytes * depth);
      for (let z = 0; z < depth; z++) {
        const mip0 = layers[z]?.mipmaps[0];
        if (!mip0) throw new Error(`Missing mip 0 on layer ${z}`);
        merged.set(new Uint8Array(mip0.data.buffer, mip0.data.byteOffset, sliceBytes), z * sliceBytes);
      }
      const arr = new DataArrayTexture(merged, width, height, depth);
      arr.format = RGBAFormat;
      arr.type = UnsignedByteType;
      arr.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      arr.wrapS = RepeatWrapping;
      arr.wrapT = RepeatWrapping;
      arr.minFilter = LinearMipmapLinearFilter;
      arr.magFilter = LinearFilter;
      arr.generateMipmaps = true;
      arr.anisotropy = anisotropy;
      arr.needsUpdate = true;
      for (const l of layers) l.dispose();
      return arr;
    }

    const mipCount = first.mipmaps.length;
    const combinedMipmaps: { data: Uint8Array; width: number; height: number }[] = [];
    for (let m = 0; m < mipCount; m++) {
      const m0 = first.mipmaps[m];
      if (!m0) throw new Error(`Missing mip ${m} on layer 0`);
      const sliceLen = m0.data.byteLength;
      const concat = new Uint8Array(sliceLen * depth);
      for (let z = 0; z < depth; z++) {
        const lm = layers[z]?.mipmaps[m];
        if (!lm || lm.data.byteLength !== sliceLen) {
          throw new Error(
            `KTX2 array format mismatch at layer ${z} mip ${m}: expected ${sliceLen} B, got ${lm?.data.byteLength ?? 0} B`,
          );
        }
        concat.set(new Uint8Array(lm.data.buffer, lm.data.byteOffset, sliceLen), z * sliceLen);
      }
      combinedMipmaps.push({ data: concat, width: m0.width, height: m0.height });
    }

    const arr = new CompressedArrayTexture(combinedMipmaps, width, height, depth, format, type);
    arr.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    arr.wrapS = RepeatWrapping;
    arr.wrapT = RepeatWrapping;
    arr.minFilter = mipCount > 1 ? LinearMipmapLinearFilter : LinearFilter;
    arr.magFilter = LinearFilter;
    arr.generateMipmaps = false;
    arr.anisotropy = anisotropy;
    arr.needsUpdate = true;
    for (const l of layers) l.dispose();
    return arr;
  }

  async loadGlb(url: string, tracker?: ByteProgressTracker): Promise<GLTF> {
    const buffer = await fetchArrayBufferWithProgress(url, tracker);
    const basePath = url.slice(0, url.lastIndexOf('/') + 1);
    return await new Promise<GLTF>((resolve, reject) => {
      this.gltf.parse(buffer, basePath, resolve, reject);
    });
  }

  async loadPngTexture(url: string, srgb: boolean): Promise<Texture> {
    const tex = await this.texLoader.loadAsync(url);
    tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  dispose(): void {
    this.ktx2.dispose();
  }
}
