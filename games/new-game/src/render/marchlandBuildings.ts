// High-Detail L1 / L2 / L3 Medieval Building Architecture Loader (imported from anbow1/FPS marchland):
// Loads texture-free architectural GLBs (`assets/marchland/buildings/<prefix>_{1,2,3}.glb`) and converts
// each building's material tags (`plaster#ece4d6`, `beam#8a7258`, `tiles#c26a4a`, `iron#4a4c50`, etc.)
// directly into `surfaces.buildingMaterial` vertex attributes (`position`, `normal`, box-projected `uv`,
// `uv1 = [layer / 15, isIron ? 0 : 1]`, `color = linear RGB tint * subtle vertical AO`).
// Every building variant merges into ONE BufferGeometry -> 1 InstancedMesh draw call, ZERO extra textures,
// and ZERO extra GPU shader pipelines!

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingTypeId, QualityPreset } from '../config.ts';
import type { AssetLoader } from './assetLoader.ts';

/** Maps mediveal-village BuildingTypeId -> marchland/buildings/ filename prefix. */
const MARCHLAND_BUILDING_PREFIX: Partial<Record<BuildingTypeId, string>> = {
  house: 'house',
  woodcutter: 'woodcutter',
  quarry: 'quarry',
  farm: 'farm',
  fisher: 'fisher',
  windmill: 'windmill',
  bakery: 'bakery',
  pigFarm: 'pigFarm',
  butcher: 'butcher',
  vineyard: 'vineyard',
  winery: 'winery',
  tannery: 'tannery',
  ironMine: 'ironMine',
  smelter: 'smelter',
  smithy: 'smithy',
  armourer: 'armourer',
  fletcher: 'fletcher',
  stable: 'stable',
  barracks: 'barracks',
  watchtower: 'tower',
};

interface SurfaceTag {
  readonly layer: number;
  readonly isIron: boolean;
  readonly defaultHex: number;
  readonly uvScale: number;
}

/**
 * Maps marchland GLB material base names to mediveal-village's 12-layer KTX2 SURFACE_LAYERS:
 *   0: grass, 1: dirt, 2: cobble, 3: plaster, 4: beam, 5: boards,
 *   6: thatch, 7: shingles, 8: rubble, 9: ashlar, 10: bark, 11: linen
 */
function resolveSurfaceTag(matName: string): {
  layer: number;
  isIron: boolean;
  r: number;
  g: number;
  b: number;
  uvScale: number;
} {
  const hashIdx = matName.indexOf('#');
  const baseRaw = (hashIdx >= 0 ? matName.slice(0, hashIdx) : matName).trim().toLowerCase();
  const hexPart = hashIdx >= 0 ? matName.slice(hashIdx + 1).trim() : '';

  const table: Record<string, SurfaceTag> = {
    grass: { layer: 0, isIron: false, defaultHex: 0x8ea46b, uvScale: 0.35 },
    leaves: { layer: 0, isIron: false, defaultHex: 0x7a9a50, uvScale: 0.55 },
    dirt: { layer: 1, isIron: false, defaultHex: 0xb8a68e, uvScale: 0.4 },
    mud: { layer: 1, isIron: false, defaultHex: 0x8f7a64, uvScale: 0.45 },
    farm_soil: { layer: 1, isIron: false, defaultHex: 0x7c6248, uvScale: 0.45 },
    cobble: { layer: 2, isIron: false, defaultHex: 0xd0ccc4, uvScale: 0.45 },
    plaster: { layer: 3, isIron: false, defaultHex: 0xebe3d5, uvScale: 0.42 },
    paint: { layer: 3, isIron: false, defaultHex: 0xe0d6c4, uvScale: 0.45 },
    beam: { layer: 4, isIron: false, defaultHex: 0xb09a78, uvScale: 0.5 },
    bow: { layer: 4, isIron: false, defaultHex: 0x8c7448, uvScale: 0.6 },
    wicker: { layer: 4, isIron: false, defaultHex: 0x9c7b4a, uvScale: 0.7 },
    boards: { layer: 5, isIron: false, defaultHex: 0xa89580, uvScale: 0.48 },
    leather: { layer: 5, isIron: false, defaultHex: 0x7a5436, uvScale: 0.55 },
    hide: { layer: 5, isIron: false, defaultHex: 0xa98a62, uvScale: 0.55 },
    thatch: { layer: 6, isIron: false, defaultHex: 0xe6d4a8, uvScale: 0.45 },
    straw: { layer: 6, isIron: false, defaultHex: 0xd9c688, uvScale: 0.5 },
    shingles: { layer: 7, isIron: false, defaultHex: 0x9da3a8, uvScale: 0.48 },
    tiles: { layer: 7, isIron: false, defaultHex: 0xd67856, uvScale: 0.52 },
    rubble: { layer: 8, isIron: false, defaultHex: 0xc2bbb0, uvScale: 0.38 },
    rock: { layer: 8, isIron: false, defaultHex: 0xa8a49c, uvScale: 0.38 },
    ore: { layer: 8, isIron: false, defaultHex: 0x7a4a3a, uvScale: 0.5 },
    charcoal: { layer: 8, isIron: false, defaultHex: 0x262422, uvScale: 0.6 },
    soot: { layer: 8, isIron: false, defaultHex: 0x2c2826, uvScale: 0.6 },
    slag: { layer: 8, isIron: true, defaultHex: 0x3a3634, uvScale: 0.55 },
    ashlar: { layer: 9, isIron: false, defaultHex: 0xdcd6ca, uvScale: 0.36 },
    bark: { layer: 10, isIron: false, defaultHex: 0x9c8872, uvScale: 0.5 },
    linen: { layer: 11, isIron: false, defaultHex: 0xd8cfb8, uvScale: 0.55 },
    cloth: { layer: 11, isIron: false, defaultHex: 0xd4c8b0, uvScale: 0.55 },
    sack: { layer: 11, isIron: false, defaultHex: 0xc9b48a, uvScale: 0.6 },
    team: { layer: 11, isIron: false, defaultHex: 0x3a64ad, uvScale: 0.55 },
    iron: { layer: 8, isIron: true, defaultHex: 0x565a60, uvScale: 0.5 },
    steel: { layer: 8, isIron: true, defaultHex: 0xa4acb4, uvScale: 0.5 },
    glass: { layer: 9, isIron: true, defaultHex: 0x2a343d, uvScale: 0.5 },
    ember: { layer: 8, isIron: false, defaultHex: 0xe86424, uvScale: 0.5 },
    bread: { layer: 3, isIron: false, defaultHex: 0xc8924e, uvScale: 0.6 },
    meat: { layer: 11, isIron: false, defaultHex: 0x8c4238, uvScale: 0.6 },
    fish: { layer: 11, isIron: false, defaultHex: 0x9aaab4, uvScale: 0.6 },
    grapes: { layer: 0, isIron: false, defaultHex: 0x56284a, uvScale: 0.6 },
    wine: { layer: 11, isIron: false, defaultHex: 0x6a1c28, uvScale: 0.6 },
    liquor: { layer: 5, isIron: false, defaultHex: 0x6c4624, uvScale: 0.6 },
    water: { layer: 9, isIron: true, defaultHex: 0x364a4e, uvScale: 0.5 },
  };

  const entry = table[baseRaw] ?? { layer: 8, isIron: false, defaultHex: 0xc4beb4, uvScale: 0.42 };
  const col = new Color();
  if (/^[0-9a-fA-F]{6}$/.test(hexPart)) {
    col.setHex(parseInt(hexPart, 16));
  } else {
    col.setHex(entry.defaultHex);
  }
  // Keep vertex tint luminous enough when multiplied with KTX2 PBR albedo textures
  const boost = entry.isIron ? 1.0 : entry.layer === 3 ? 0.96 : 1.12;
  return {
    layer: entry.layer,
    isIron: entry.isIron,
    r: Math.min(1.0, col.r * boost),
    g: Math.min(1.0, col.g * boost),
    b: Math.min(1.0, col.b * boost),
    uvScale: entry.uvScale,
  };
}

/** Converts a loaded marchland building GLB scene into a single merged BufferGeometry for `surfaces.buildingMaterial`. */
function convertMarchlandGlbToBuildingGeometry(root: Object3D): BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const srcGeo = obj.geometry as BufferGeometry;
    const posAttr = srcGeo.getAttribute('position');
    if (!posAttr || posAttr.count === 0) return;

    const rawMat = (Array.isArray(obj.material) ? obj.material[0] : obj.material) as Material | undefined;
    const matName = rawMat?.name ?? 'rubble';
    const tag = resolveSurfaceTag(matName);

    const g = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
    // Strip any extraneous attributes so mergeGeometries receives identical attribute layouts
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal') {
        g.deleteAttribute(k);
      }
    }
    g.applyMatrix4(obj.matrixWorld);
    if (!g.getAttribute('normal')) {
      g.computeVertexNormals();
    }

    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const count = pos.count;

    const uv0 = new Float32Array(count * 2);
    const uv1 = new Float32Array(count * 2);
    const col = new Float32Array(count * 3);

    const layerEnc = tag.layer / 15.0;
    const ironEnc = tag.isIron ? 0.0 : 1.0;

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));

      // Box-projected world-scale UVs matching mediveal-village KTX2 surface density
      if (ny >= nx && ny >= nz) {
        uv0[i * 2] = x * tag.uvScale;
        uv0[i * 2 + 1] = z * tag.uvScale;
      } else if (nx >= nz) {
        uv0[i * 2] = z * tag.uvScale;
        uv0[i * 2 + 1] = y * tag.uvScale;
      } else {
        uv0[i * 2] = x * tag.uvScale;
        uv0[i * 2 + 1] = y * tag.uvScale;
      }

      uv1[i * 2] = layerEnc;
      uv1[i * 2 + 1] = ironEnc;

      // Subtle architectural vertical AO so foundations & eaves read with crisp depth
      const h01 = Math.max(0, Math.min(1, (y + 0.25) / 3.8));
      const ao = 0.80 + 0.20 * h01;
      col[i * 3] = tag.r * ao;
      col[i * 3 + 1] = tag.g * ao;
      col[i * 3 + 2] = tag.b * ao;
    }

    g.setAttribute('uv', new Float32BufferAttribute(uv0, 2));
    g.setAttribute('uv1', new Float32BufferAttribute(uv1, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    parts.push(g);
  });

  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  return merged;
}

export type MarchlandBuildingLevelKey = `${BuildingTypeId}_${1 | 2 | 3}`;

/**
 * Loads L1/L2/L3 high-detail architectural GLB meshes from `assets/marchland/buildings/`
 * with bounded concurrency (avoids Safari/WebKit connection starvation on iPad/mobile)
 * and skips the optional 15 MB override pack on `minimal` preset to keep 3 GB tablets well under RAM limits.
 */
export async function loadMarchlandBuildingLevels(
  loader: AssetLoader,
  quality: QualityPreset = 'high',
  onProgress?: (done: number, total: number) => void,
): Promise<Map<MarchlandBuildingLevelKey, BufferGeometry>> {
  const result = new Map<MarchlandBuildingLevelKey, BufferGeometry>();
  if (quality === 'minimal') return result;

  // On `low` (tablets / 3 GB RAM), load L1 architectural overrides (20 GLBs instead of 60)
  // to save ~10 MB download and ~40 MB geometry RAM while keeping detailed L1 town architecture.
  const levels: readonly (1 | 2 | 3)[] = quality === 'low' ? [1] : [1, 2, 3];
  const jobs: { key: MarchlandBuildingLevelKey; url: string }[] = [];
  for (const [bType, prefix] of Object.entries(MARCHLAND_BUILDING_PREFIX) as [BuildingTypeId, string][]) {
    for (const level of levels) {
      jobs.push({
        key: `${bType}_${level}`,
        url: `assets/marchland/buildings/${prefix}_${level}.glb`,
      });
    }
  }

  let cursor = 0;
  let done = 0;
  const total = jobs.length;
  const concurrency = quality === 'low' ? 3 : 6;
  const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => {
        setTimeout(() => rej(new Error('timeout')), ms);
      }),
    ]);

  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]!;
      try {
        const gltf = await withTimeout(loader.loadGlb(job.url), 15000);
        const geo = convertMarchlandGlbToBuildingGeometry(gltf.scene);
        if (geo) result.set(job.key, geo);
        // Free raw GLB geometries immediately so peak memory stays low on 3 GB tablets
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
        });
      } catch {
        // Gracefully fall back to base mediveal-village L1 template if any GLB is absent or times out
      }
      done++;
      onProgress?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return result;
}
