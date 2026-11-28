// High-Detail L1 / L2 / L3 Medieval Building Architecture Loader (imported from anbow1/FPS marchland):
// Loads texture-free architectural GLBs (`assets/marchland/buildings/<prefix>_{1,2,3}.glb`) and converts
// each building's material tags (`plaster#ece4d6`, `beam#8a7258`, `tiles#c26a4a`, `iron#4a4c50`, etc.)
// directly into `surfaces.buildingMaterial` vertex attributes (`position`, `normal`, box-projected `uv`,
// `uv1 = [layer / 15, isIron ? 0 : 1]`, `color = linear RGB tint * subtle vertical AO`).
// Every building variant merges into ONE BufferGeometry -> 1 InstancedMesh draw call, ZERO extra textures,
// and ZERO extra GPU shader pipelines!

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
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
  cathedral: 'cathedral',
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

interface PartBox {
  readonly kind: 'box' | 'cyl' | 'cone';
  readonly w: number;
  readonly h: number;
  readonly d: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly mat: string;
}

function buildProceduralBuildingGeometry(specs: readonly PartBox[]): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const s of specs) {
    const raw =
      s.kind === 'cyl'
        ? new CylinderGeometry(s.w * 0.5, s.d * 0.5, s.h, 8)
        : s.kind === 'cone'
          ? new ConeGeometry(s.w * 0.5, s.h, 4)
          : new BoxGeometry(s.w, s.h, s.d);
    if (s.kind === 'cone') raw.rotateY(Math.PI * 0.25);
    raw.translate(s.x, s.y, s.z);
    const g = raw.index ? raw.toNonIndexed() : raw;
    if (raw.index) raw.dispose();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    }

    const tag = resolveSurfaceTag(s.mat);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const count = pos.count;
    const uv0 = new Float32Array(count * 2);
    const uv1 = new Float32Array(count * 2);
    const col = new Float32Array(count * 3);
    const layerEnc = tag.layer / 15.0;
    const ironEnc = tag.isIron ? 0.0 : 1.0;

    for (let i = 0; i < count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));
      if (ny >= nx && ny >= nz) {
        uv0[i * 2] = px * tag.uvScale;
        uv0[i * 2 + 1] = pz * tag.uvScale;
      } else if (nx >= nz) {
        uv0[i * 2] = pz * tag.uvScale;
        uv0[i * 2 + 1] = py * tag.uvScale;
      } else {
        uv0[i * 2] = px * tag.uvScale;
        uv0[i * 2 + 1] = py * tag.uvScale;
      }
      uv1[i * 2] = layerEnc;
      uv1[i * 2 + 1] = ironEnc;
      const h01 = Math.max(0, Math.min(1, (py + 0.25) / 5.5));
      const ao = 0.78 + 0.22 * h01;
      col[i * 3] = tag.r * ao;
      col[i * 3 + 1] = tag.g * ao;
      col[i * 3 + 2] = tag.b * ao;
    }
    g.setAttribute('uv', new Float32BufferAttribute(uv0, 2));
    g.setAttribute('uv1', new Float32BufferAttribute(uv1, 2));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false) ?? new BoxGeometry(1, 1, 1);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function registerAgesProceduralBuildings(result: Map<MarchlandBuildingLevelKey, BufferGeometry>): void {
  // 1. Gunsmith (Early Modern brick/stone bore-shop with forge chimney & musket awning)
  const gunsmithGeo = buildProceduralBuildingGeometry([
    { kind: 'box', w: 5.4, h: 0.7, d: 4.8, x: 0, y: 0.35, z: 0, mat: 'rubble#b4ada2' },
    { kind: 'box', w: 5.0, h: 2.9, d: 4.4, x: 0, y: 2.15, z: 0, mat: 'plaster#dfd3be' },
    { kind: 'box', w: 5.6, h: 0.28, d: 5.0, x: 0, y: 3.74, z: 0, mat: 'beam#6e543a' },
    { kind: 'cone', w: 6.4, h: 2.2, d: 6.4, x: 0, y: 4.95, z: 0, mat: 'tiles#b45a40' },
    { kind: 'box', w: 1.05, h: 6.2, d: 1.05, x: -1.7, y: 3.1, z: -1.4, mat: 'ashlar#a8a096' },
    { kind: 'box', w: 2.4, h: 0.22, d: 1.6, x: 0.2, y: 2.35, z: 2.7, mat: 'boards#7d5d3d' },
    { kind: 'box', w: 1.1, h: 1.9, d: 0.2, x: 0.2, y: 1.15, z: 2.25, mat: 'beam#4d3826' },
  ]);
  for (const l of [1, 2, 3] as const) result.set(`gunsmith_${l}`, gunsmithGeo.clone());
  gunsmithGeo.dispose();

  // 2. Powder Mill (heavy blast-walled stone & timber blackpowder mill with slate roof & drying shed)
  const powderMillGeo = buildProceduralBuildingGeometry([
    { kind: 'box', w: 5.8, h: 1.4, d: 5.2, x: 0, y: 0.7, z: 0, mat: 'rubble#9f998e' },
    { kind: 'box', w: 4.6, h: 2.4, d: 4.2, x: 0, y: 2.6, z: -0.2, mat: 'boards#8c7256' },
    { kind: 'cone', w: 5.9, h: 2.1, d: 5.9, x: 0, y: 4.85, z: -0.2, mat: 'shingles#646c74' },
    { kind: 'cyl', w: 2.2, h: 0.45, d: 2.2, x: 2.5, y: 1.4, z: 0, mat: 'beam#5e462e' },
    { kind: 'box', w: 1.6, h: 1.8, d: 1.6, x: -2.2, y: 0.9, z: 1.6, mat: 'ashlar#b4aea4' },
  ]);
  for (const l of [1, 2, 3] as const) result.set(`powderMill_${l}`, powderMillGeo.clone());
  powderMillGeo.dispose();

  // 3. Cathedral (Unique Great Building: Gothic cruciform ashlar stone cathedral with twin bell towers & spires!)
  const cathedralGeo = buildProceduralBuildingGeometry([
    { kind: 'box', w: 7.4, h: 1.0, d: 11.4, x: 0, y: 0.5, z: 0, mat: 'rubble#b5afa4' },
    // Main Nave
    { kind: 'box', w: 5.6, h: 6.4, d: 9.8, x: 0, y: 4.2, z: -0.2, mat: 'ashlar#dcd6ca' },
    { kind: 'cone', w: 7.4, h: 3.0, d: 7.4, x: 0, y: 8.9, z: -0.6, mat: 'shingles#505b66' },
    // Transept arms
    { kind: 'box', w: 9.2, h: 5.4, d: 3.6, x: 0, y: 3.7, z: -1.4, mat: 'ashlar#d5cfc2' },
    // Twin Western Bell Towers flanking front portal (+Z)
    { kind: 'box', w: 2.4, h: 10.6, d: 2.4, x: -2.5, y: 5.8, z: 3.6, mat: 'ashlar#e0dad0' },
    { kind: 'box', w: 2.4, h: 10.6, d: 2.4, x: 2.5, y: 5.8, z: 3.6, mat: 'ashlar#e0dad0' },
    { kind: 'cone', w: 2.6, h: 4.6, d: 2.6, x: -2.5, y: 13.4, z: 3.6, mat: 'shingles#47525c' },
    { kind: 'cone', w: 2.6, h: 4.6, d: 2.6, x: 2.5, y: 13.4, z: 3.6, mat: 'shingles#47525c' },
    // Central crossing fleche spire & rose window accent
    { kind: 'cone', w: 1.5, h: 5.2, d: 1.5, x: 0, y: 12.2, z: -1.4, mat: 'shingles#3f4a54' },
    { kind: 'cyl', w: 1.8, h: 0.3, d: 1.8, x: 0, y: 5.4, z: 4.75, mat: 'glass#38506b' },
    { kind: 'box', w: 2.0, h: 3.0, d: 0.4, x: 0, y: 2.0, z: 4.75, mat: 'beam#4d3826' },
  ]);
  for (const l of [1, 2, 3] as const) result.set(`cathedral_${l}`, cathedralGeo.clone());
  cathedralGeo.dispose();

  // 4. Town Hall (Unique Great Building: Early Modern classical Rathaus with portico, mansard roof & clock belfry!)
  const townHallGeo = buildProceduralBuildingGeometry([
    { kind: 'box', w: 9.6, h: 1.1, d: 7.6, x: 0, y: 0.55, z: 0, mat: 'rubble#b4ada2' },
    { kind: 'box', w: 9.0, h: 5.4, d: 6.8, x: 0, y: 3.8, z: -0.2, mat: 'plaster#ede5d6' },
    { kind: 'box', w: 9.4, h: 0.45, d: 7.2, x: 0, y: 6.6, z: -0.2, mat: 'ashlar#d2cbbd' },
    // Steep mansard tile roof
    { kind: 'box', w: 8.6, h: 2.2, d: 6.2, x: 0, y: 7.8, z: -0.2, mat: 'tiles#b0543a' },
    // Front colonnade portico (+Z)
    { kind: 'box', w: 5.2, h: 0.6, d: 2.0, x: 0, y: 5.1, z: 3.6, mat: 'ashlar#dfd8cb' },
    { kind: 'cyl', w: 0.45, h: 4.2, d: 0.45, x: -2.0, y: 2.9, z: 4.1, mat: 'ashlar#e5dfd2' },
    { kind: 'cyl', w: 0.45, h: 4.2, d: 0.45, x: -0.7, y: 2.9, z: 4.1, mat: 'ashlar#e5dfd2' },
    { kind: 'cyl', w: 0.45, h: 4.2, d: 0.45, x: 0.7, y: 2.9, z: 4.1, mat: 'ashlar#e5dfd2' },
    { kind: 'cyl', w: 0.45, h: 4.2, d: 0.45, x: 2.0, y: 2.9, z: 4.1, mat: 'ashlar#e5dfd2' },
    // Central civic clock-belfry tower
    { kind: 'box', w: 2.5, h: 5.0, d: 2.5, x: 0, y: 10.6, z: 0.3, mat: 'ashlar#e0d9cc' },
    { kind: 'cone', w: 2.9, h: 3.4, d: 2.9, x: 0, y: 14.8, z: 0.3, mat: 'shingles#47535e' },
  ]);
  for (const l of [1, 2, 3] as const) result.set(`townHall_${l}`, townHallGeo.clone());
  townHallGeo.dispose();

  // 5. Manufactory (Unique Great Building: 19th-Century brick industrial hall with clerestory roof & tall smokestack!)
  const manufactoryGeo = buildProceduralBuildingGeometry([
    { kind: 'box', w: 10.6, h: 1.0, d: 7.4, x: 0, y: 0.5, z: 0, mat: 'rubble#9e968b' },
    // Main brick factory hall
    { kind: 'box', w: 10.0, h: 5.2, d: 6.6, x: 0, y: 3.6, z: 0, mat: 'tiles#a64d3a' },
    // Clerestory glass skylight ridge
    { kind: 'box', w: 8.6, h: 1.4, d: 3.2, x: 0, y: 6.9, z: 0, mat: 'shingles#505760' },
    { kind: 'box', w: 8.8, h: 0.65, d: 3.3, x: 0, y: 6.6, z: 0, mat: 'glass#3a4d5c' },
    // Side boiler annex
    { kind: 'box', w: 3.2, h: 3.6, d: 4.4, x: -5.4, y: 2.3, z: -0.6, mat: 'ashlar#a8a098' },
    // Tall 19th-century square brick smokestack
    { kind: 'box', w: 1.7, h: 12.6, d: 1.7, x: -4.8, y: 6.3, z: -2.2, mat: 'tiles#964332' },
    { kind: 'box', w: 2.05, h: 0.5, d: 2.05, x: -4.8, y: 12.6, z: -2.2, mat: 'iron#42464c' },
    // Double arched factory freight doors
    { kind: 'box', w: 2.8, h: 3.0, d: 0.35, x: 0.8, y: 2.0, z: 3.35, mat: 'beam#4d3928' },
  ]);
  for (const l of [1, 2, 3] as const) result.set(`manufactory_${l}`, manufactoryGeo.clone());
  manufactoryGeo.dispose();
}

/**
 * Loads L1/L2/L3 high-detail architectural GLB meshes from `assets/marchland/buildings/`
 * with bounded concurrency (avoids Safari/WebKit connection starvation on iPad/mobile)
 * and registers lightweight procedural meshes for the 5 Ages & Great Buildings (`gunsmith`,
 * `powderMill`, `cathedral`, `townHall`, `manufactory`).
 */
export async function loadMarchlandBuildingLevels(
  loader: AssetLoader,
  quality: QualityPreset = 'high',
  onProgress?: (done: number, total: number) => void,
): Promise<Map<MarchlandBuildingLevelKey, BufferGeometry>> {
  const result = new Map<MarchlandBuildingLevelKey, BufferGeometry>();
  // Always register procedural Era 2-3 & Great Building meshes (tiny, zero extra textures/shaders!)
  registerAgesProceduralBuildings(result);
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
