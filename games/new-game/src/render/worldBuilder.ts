// Stage 5 Whole 560 x 560 m World Builder (R1, R2, R4, R5, R7, R10):
// Renders all 5 Campaign & Skirmish 560 x 560 m maps (`crossing`, `openField`, `forest`, `valley`, `fortress`)
// with flat draw calls & zero mid-play shader compiles:
//   - Single-height-function TerrainField + 6-layer height-blended TSL terrain + 512x512 GroundWorksMap over 560 m
//   - Unified 1-draw-call physical lakes, meandering rivers & shallow gravel fords (`lakeWater.ts`)
//   - 3-ring Roberts R2 Bézier grass blades tracking camera focus anywhere across 560 x 560 m
//   - 18 medieval buildings (zero embedded textures, shared 12-layer KTX2 array + ground-footing weathering)
//     including Mission 5's monumental `fortress_donzon`, twin destructible wall rings & 12 watchtowers
//   - 420-540 batched 3-species trees with warm sun-backlit foliage translucency + >100 m impostors + R7 shadows
//   - Poly Haven CC0 photogrammetry mossy rocks/boulders, forest ferns, siege cannons, crates, buckets, pier & stumps
//   - 160-185 GPU-bone-instanced MakeHuman CC0 soldiers & villagers (`unitInstancer.ts`, <= 12 draw calls total)
//   - Chimney smoke plumes, swaying golden wheat strips, shoreline reeds, contact shadows & 18% grey CalibrationRig

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  cameraPosition,
  clamp,
  dot,
  float,
  max,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  texture,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { CALIBRATION, type QualityPreset } from '../config.ts';
import { GroundWorksMap } from '../sim/groundWorks.ts';
import {
  PROP_LOD_THRESHOLDS,
  selectLodLevel,
  TREE_LOD_THRESHOLDS,
  type LodLevel,
  type LodThresholds,
} from '../sim/lodMath.ts';
import { computeBuildingStripTransform } from '../sim/economy.ts';
import {
  buildMapLayout,
  type BuildingKind,
  type FarmStripSpec,
  type MapLayoutSpec,
} from '../sim/maps.ts';
import { TerrainField, type MapLayoutId } from '../sim/terrain.ts';
import type { BuildingEntity, SimWorldState } from '../sim/types.ts';
import {
  type AssetLoader,
  type AssetManifest,
  createByteProgressTracker,
} from './assetLoader.ts';
import {
  buildCombatFx,
  type CombatFxHandles,
  type FormationGhostPreview,
  type PlacementGhostPreview,
} from './combatFx.ts';
import { ContactShadowBatch } from './contactShadows.ts';
import { buildGrassField, type GrassFieldHandles } from './grassField.ts';
import { markStaticInstances } from './instancing.ts';
import { buildLakeWater, type LakeWaterHandles } from './lakeWater.ts';
import { SHADOW_ONLY_LAYER } from './lighting.ts';
import {
  buildSimWorldRenderer,
  type GateLeafHook,
  type SimRendererHandles,
  type StaticBuildingHook,
  type TreeBatchHook,
} from './simRenderer.ts';
import type { PhysicalSkyUniforms } from './sky.ts';
import { buildChimneySmoke, type ChimneySmokeHandles } from './smokeFx.ts';
import { loadSurfaceLibrary, type SurfaceLibrary } from './surfaces.ts';
import { buildTerrainMesh, type TerrainRenderHandles } from './terrainMesh.ts';
import {
  buildUnitInstancer,
  type InstancedUnitSpawn,
  type UnitInstancerHandles,
} from './unitInstancer.ts';
import { buildMarchlandUnits, type MarchlandUnitsHandles } from './marchlandUnits.ts';
import { loadMarchlandBuildingLevels } from './marchlandBuildings.ts';

interface SubMeshPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

interface LodTemplate {
  readonly lod0: Object3D;
  readonly lod1: Object3D;
  readonly lod2: Object3D;
  readonly shadow: Object3D;
  readonly impostorTex?: Texture;
  readonly impostorWidthM?: number;
  readonly impostorHeightM?: number;
  readonly impostorBottomSinkM?: number;
}

interface LodActor {
  readonly root: Group;
  readonly lodNodes: readonly [Object3D, Object3D, Object3D];
  readonly shadowNode: Object3D;
  readonly thresholds: LodThresholds;
  level: LodLevel;
}

interface InstancedPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
  readonly matrix: Matrix4;
  level: LodLevel;
  hidden?: boolean;
}

interface MultiLodInstancedBatch {
  readonly placements: InstancedPlacement[];
  readonly thresholds: LodThresholds;
  readonly lodBuckets: readonly [InstancedMesh[], InstancedMesh[], InstancedMesh[]];
  readonly impostorMesh: InstancedMesh | null;
  readonly shadowMesh: InstancedMesh | null;
  readonly impostorMat: MeshStandardNodeMaterial | null;
  readonly impostorGeo: BufferGeometry | null;
  readonly shadowDistanceM: number;
  dirtyBuckets: boolean;
}

export interface WorldHandles {
  readonly mapId: MapLayoutId;
  readonly layout: MapLayoutSpec;
  readonly terrain: TerrainField;
  readonly groundWorks: GroundWorksMap;
  readonly surfaces: SurfaceLibrary;
  readonly manifest: AssetManifest;
  readonly grass: GrassFieldHandles;
  readonly units: UnitInstancerHandles;
  readonly combatFx: CombatFxHandles;
  readonly simRenderer: SimRendererHandles;
  readonly update: (dtS: number, cameraPos: Vector3, cameraDir: Vector3, paused: boolean) => void;
  /** Stage 6 live simulation synchronization driving GPU units, combat FX, dynamic buildings, felled trees & GroundWorks. */
  readonly syncSimWorld: (
    dtS: number,
    state: SimWorldState,
    cameraPos: Vector3,
    cameraDir: Vector3,
    selectedRegimentIds: ReadonlySet<number>,
    selectedBuildingId: number | null,
    formationGhost: FormationGhostPreview | null,
    placementGhost: PlacementGhostPreview | null,
    paused: boolean,
  ) => void;
  readonly getLodSummary: () => Record<string, number>;
  readonly getWorldMetrics: () => {
    readonly mapId: MapLayoutId;
    readonly grassBlades: number;
    readonly grassTriangles: number;
    readonly treeCount: number;
    readonly rockCount: number;
    readonly fernCount: number;
    readonly buildingCount: number;
    readonly unitCount: number;
    readonly wallSegments: number;
    readonly reedClumps: number;
    readonly wheatClusters: number;
  };
  readonly dispose: () => void;
}

const ZERO_MATRIX = new Matrix4().makeScale(0, 0, 0);
const UP_AXIS = new Vector3(0, 1, 0);
const TEMP_MAT = new Matrix4();
const TEMP_POS = new Vector3();
const TEMP_QUAT = new Quaternion();
const TEMP_SCALE = new Vector3();

/** Converts quantized Meshopt integer attributes cleanly to Float32 before matrix baking or instancing. */
function dequantizeGeometry(src: BufferGeometry): BufferGeometry {
  const geo = src.clone();
  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(name);
    if (!attr) continue;
    const isFloat = attr.array instanceof Float32Array && !attr.normalized;
    if (!isFloat) {
      const itemSize = attr.itemSize;
      const out = new Float32Array(attr.count * itemSize);
      for (let i = 0; i < attr.count; i++) {
        out[i * itemSize] = attr.getX(i);
        if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
        if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
        if (itemSize > 3) out[i * itemSize + 3] = attr.getW(i);
      }
      geo.setAttribute(name, new Float32BufferAttribute(out, itemSize));
    }
  }
  return geo;
}

function extractStaticParts(root: Object3D, materialOverride?: Material): SubMeshPart[] {
  root.updateMatrixWorld(true);
  const parts: SubMeshPart[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geo = dequantizeGeometry(o.geometry as BufferGeometry);
    geo.applyMatrix4(o.matrixWorld);
    geo.computeBoundingSphere();
    const mat = materialOverride ?? (Array.isArray(o.material) ? o.material[0] : o.material);
    if (mat) parts.push({ geometry: geo, material: mat });
  });
  return parts;
}

/**
 * Upgrades alpha-tested foliage materials (oak/pine/birch canopies & Poly Haven ferns) with warm
 * sun-backlit subsurface translucency (`pow(max(0, dot(-V, uSunDir)), 3.0)`) using zero extra textures!
 */
function upgradeFoliageTranslucency(
  srcMat: Material,
  skyUniforms: PhysicalSkyUniforms,
  disposables: Material[],
  strength = 0.26,
): Material {
  if (!(srcMat instanceof MeshStandardMaterial) || !srcMat.map) return srcMat;
  const mat = new MeshStandardNodeMaterial({
    map: srcMat.map,
    normalMap: srcMat.normalMap,
    roughnessMap: srcMat.roughnessMap,
    metalnessMap: srcMat.metalnessMap,
    aoMap: srcMat.aoMap,
    roughness: Math.max(0.68, srcMat.roughness),
    metalness: 0.0,
    alphaTest: srcMat.alphaTest > 0 ? srcMat.alphaTest : 0.42,
    side: DoubleSide,
    vertexColors: srcMat.vertexColors,
  });
  mat.name = `${srcMat.name || 'Foliage'}_SSS`;

  const V = normalize(cameraPosition.sub(positionWorld));
  const backDot = max(float(0.0), dot(V.negate(), skyUniforms.uSunDir));
  const sss = pow(backDot, float(3.0)).mul(float(strength));
  const texRgb = texture(srcMat.map, uv(0)).rgb;
  // Warm golden-olive transmitted leaf glow on backlit canopy edges
  mat.emissiveNode = texRgb.mul(skyUniforms.uSunGlowColor).mul(vec3(1.15, 1.05, 0.52)).mul(sss);
  disposables.push(mat);
  return mat;
}

/**
 * Matches LOD1/LOD2 materials strictly from LOD0 by object role (`canopy` / `trunk`) FIRST,
 * then by material name (fixes deduplicated placeholder materials on trees).
 */
function applySharedMaterialsFromLod0(
  lod0: Object3D,
  target: Object3D,
  skyUniforms: PhysicalSkyUniforms,
  disposables: Material[],
  isFoliageAsset = false,
): void {
  const byName = new Map<string, Material>();
  const byRole = new Map<string, Material>();
  let fallback: Material | null = null;

  lod0.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    let m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) return;
    const isLeaf =
      isFoliageAsset &&
      (o.name.toLowerCase().includes('canopy') ||
        o.name.toLowerCase().includes('leaf') ||
        o.name.toLowerCase().includes('fern') ||
        (m instanceof MeshStandardMaterial && m.alphaTest > 0));
    if (isLeaf && !(m instanceof MeshStandardNodeMaterial)) {
      m = upgradeFoliageTranslucency(m, skyUniforms, disposables);
      o.material = m;
    }
    if (!fallback) fallback = m;
    if (m.name) byName.set(m.name, m);
    const n = o.name.toLowerCase();
    if (n.includes('canopy') || n.includes('leaf')) byRole.set('canopy', m);
    if (n.includes('trunk') || n.includes('bark')) byRole.set('trunk', m);
  });

  target.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const n = o.name.toLowerCase();
    let matched: Material | undefined;
    if (n.includes('canopy') || n.includes('leaf')) matched = byRole.get('canopy');
    else if (n.includes('trunk') || n.includes('bark')) matched = byRole.get('trunk');
    if (!matched) {
      const cur = Array.isArray(o.material) ? o.material[0] : o.material;
      if (cur?.name) matched = byName.get(cur.name);
    }
    if (matched ?? fallback) {
      o.material = (matched ?? fallback)!;
    }
  });
}

function setShadowProxyFlags(root: Object3D, shadowMat: Material): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.material = shadowMat;
    o.castShadow = true;
    o.receiveShadow = false;
    o.layers.set(SHADOW_ONLY_LAYER);
  });
}

function setVisibleMeshFlags(root: Object3D, overrideMat?: Material): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (overrideMat) o.material = overrideMat;
    o.castShadow = false;
    o.receiveShadow = true;
    o.layers.set(0);
  });
}

/** Builds a swaying golden wheat field batch across all farm strips on the map (1 draw call!). */
function buildWheatField(
  terrain: TerrainField,
  strips: readonly FarmStripSpec[],
  quality: QualityPreset,
): {
  mesh: InstancedMesh;
  uWindTime: { value: number };
  count: number;
  syncDynamicFarms: (buildings: readonly BuildingEntity[]) => void;
  dispose: () => void;
} {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const stalkCount = 8;
  let vBase = 0;
  for (let s = 0; s < stalkCount; s++) {
    const a = (s / stalkCount) * Math.PI * 2 + 0.25;
    const rad = 0.05 + (s % 2) * 0.11;
    const ox = Math.cos(a) * rad;
    const oz = Math.sin(a) * rad;
    const dx = Math.cos(a + 0.8);
    const dz = Math.sin(a + 0.8);
    const h = 0.78 + (s % 3) * 0.14;
    const lean = 0.22;
    const w0 = 0.068;
    const w1 = 0.052;
    const pts: readonly [number, number, number, number, number, number][] = [
      [ox - dx * w0, -0.02, oz - dz * w0, 0.28, 0.23, 0.08],
      [ox + dx * w0, -0.02, oz + dz * w0, 0.28, 0.23, 0.08],
      [ox + Math.cos(a) * lean * 0.45 - dx * w1, h * 0.58, oz + Math.sin(a) * lean * 0.45 - dz * w1, 0.58, 0.45, 0.14],
      [ox + Math.cos(a) * lean * 0.45 + dx * w1, h * 0.58, oz + Math.sin(a) * lean * 0.45 + dz * w1, 0.58, 0.45, 0.14],
      [ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean, 0.78, 0.60, 0.19],
    ];
    for (const [px, py, pz, cr, cg, cb] of pts) {
      positions.push(px, py, pz);
      normals.push(Math.cos(a) * 0.22, 0.96, Math.sin(a) * 0.22);
      colors.push(cr, cg, cb);
    }
    indices.push(vBase, vBase + 1, vBase + 3, vBase, vBase + 3, vBase + 2, vBase + 2, vBase + 3, vBase + 4);
    vBase += 5;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);

  const uWindTime = uniform(0.0);
  const mat = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    side: DoubleSide,
  });
  mat.name = 'MarchlandWheatFieldMat';
  const bend = clamp(positionLocal.y, float(0.0), float(1.0));
  const sway = sin(uWindTime.mul(1.85).add(positionLocal.x.mul(2.5))).mul(0.065).mul(bend).mul(bend);
  mat.positionNode = positionLocal.add(vec3(sway, float(0.0), sway.mul(0.55)));

  const spacingM = quality === 'high' ? 0.56 : quality === 'low' ? 0.78 : 1.15;
  const maxC = 2400;
  const mesh = new InstancedMesh(geo, mat, maxC);
  mesh.name = 'MarchlandWheatClusters';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  markStaticInstances(mesh);

  const dummy = new Object3D();
  const populateFromStrips = (
    activeStrips: readonly { readonly cx: number; readonly cz: number; readonly lenM: number; readonly widM: number; readonly yawRad: number; readonly growth01: number }[],
  ): number => {
    let seed = 101;
    const nextRand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let count = 0;
    for (const st of activeStrips) {
      if (st.growth01 <= 0.01) continue;
      const ca = Math.cos(st.yawRad);
      const sa = Math.sin(st.yawRad);
      const nx = Math.max(2, Math.floor((st.lenM - 0.35) / spacingM));
      const nz = Math.max(2, Math.floor((st.widM - 0.35) / spacingM));
      const hScale = 0.28 + 0.82 * st.growth01;
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          if (count >= maxC) break;
          const lx = -st.lenM * 0.46 + (ix + 0.5 + (nextRand() - 0.5) * 0.42) * ((st.lenM * 0.92) / nx);
          const lz = -st.widM * 0.46 + (iz + 0.5 + (nextRand() - 0.5) * 0.42) * ((st.widM * 0.92) / nz);
          const wx = st.cx + lx * ca - lz * sa;
          const wz = st.cz + lx * sa + lz * ca;
          dummy.position.set(wx, terrain.heightAt(wx, wz), wz);
          dummy.rotation.set(0, nextRand() * Math.PI * 2, 0);
          const s = 0.85 + nextRand() * 0.36;
          dummy.scale.set(s, s * (0.9 + nextRand() * 0.25) * hScale, s);
          dummy.updateMatrix();
          mesh.setMatrixAt(count++, dummy.matrix);
        }
      }
    }
    if (count === 0) {
      mesh.setMatrixAt(0, ZERO_MATRIX);
      mesh.count = 1;
      mesh.visible = false;
    } else {
      mesh.visible = true;
      mesh.count = count;
    }
    const uploadCount = Math.max(1, count);
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, uploadCount * 16);
    mesh.instanceMatrix.needsUpdate = true;
    return count;
  };

  const initialCount = populateFromStrips(
    strips.map((s) => ({ ...s, growth01: 1.0 })),
  );

  const syncDynamicFarms = (buildings: readonly BuildingEntity[]): void => {
    const dynStrips: { cx: number; cz: number; lenM: number; widM: number; yawRad: number; growth01: number }[] = [];
    for (const b of buildings) {
      if (b.hp <= 0 || b.buildProgress < 1 || b.type !== 'farm') continue;
      for (let si = 0; si < b.strips.length; si++) {
        const st = b.strips[si]!;
        const tr = computeBuildingStripTransform(b, si);
        const g01 =
          st.phase === 'ready'
            ? 1.0
            : st.phase === 'growing'
              ? Math.max(0.22, st.growth01)
              : st.phase === 'sowing'
                ? 0.18
                : 0.08;
        dynStrips.push({ ...tr, growth01: g01 });
      }
    }
    populateFromStrips(dynStrips);
  };

  return {
    mesh,
    uWindTime,
    count: initialCount,
    syncDynamicFarms,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Builds swaying shoreline reeds tucked along riverbanks & lake margins (1 draw call!). */
function buildShorelineReeds(
  terrain: TerrainField,
  quality: QualityPreset,
): { mesh: InstancedMesh; uWindTime: { value: number }; count: number; dispose: () => void } {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const bladeCount = 6;
  let vBase = 0;
  for (let b = 0; b < bladeCount; b++) {
    const a = (b / bladeCount) * Math.PI * 2;
    const rad = 0.08 + (b % 2) * 0.09;
    const ox = Math.cos(a) * rad;
    const oz = Math.sin(a) * rad;
    const h = 0.92 + (b % 3) * 0.26;
    const lean = 0.24;
    const w = 0.048;
    const dx = -Math.sin(a) * w;
    const dz = Math.cos(a) * w;
    const pts: readonly [number, number, number, number, number, number][] = [
      [ox - dx, -0.04, oz - dz, 0.14, 0.20, 0.08],
      [ox + dx, -0.04, oz + dz, 0.14, 0.20, 0.08],
      [ox + Math.cos(a) * lean * 0.5 - dx * 0.65, h * 0.55, oz + Math.sin(a) * lean * 0.5 - dz * 0.65, 0.24, 0.34, 0.12],
      [ox + Math.cos(a) * lean * 0.5 + dx * 0.65, h * 0.55, oz + Math.sin(a) * lean * 0.5 + dz * 0.65, 0.24, 0.34, 0.12],
      [ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean, 0.42, 0.44, 0.16],
    ];
    for (const [px, py, pz, cr, cg, cb] of pts) {
      positions.push(px, py, pz);
      normals.push(Math.cos(a) * 0.25, 0.95, Math.sin(a) * 0.25);
      colors.push(cr, cg, cb);
    }
    indices.push(vBase, vBase + 1, vBase + 3, vBase, vBase + 3, vBase + 2, vBase + 2, vBase + 3, vBase + 4);
    vBase += 5;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);

  const uWindTime = uniform(0.0);
  const mat = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0.0,
    side: DoubleSide,
  });
  mat.name = 'MarchlandShoreReedsMat';
  const bend = clamp(positionLocal.y, float(0.0), float(1.2));
  const sway = sin(uWindTime.mul(1.55).add(positionLocal.z.mul(2.0))).mul(0.09).mul(bend).mul(bend);
  mat.positionNode = positionLocal.add(vec3(sway, float(0.0), sway.mul(0.5)));

  const matrices: Matrix4[] = [];
  const dummy = new Object3D();
  let seed = 707;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const target = quality === 'high' ? 190 : quality === 'low' ? 105 : 40;
  const wl = terrain.config.river?.waterLevelM ?? terrain.config.lake.waterLevelM;
  for (let attempt = 0; attempt < target * 45 && matrices.length < target; attempt++) {
    const x = (rand() - 0.5) * 440;
    const z = (rand() - 0.5) * 440;
    const h = terrain.heightAt(x, z);
    if (h > wl - 0.16 && h < wl + 0.14) {
      dummy.position.set(x, h, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      const s = 0.78 + rand() * 0.55;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
  }

  const maxC = Math.max(1, matrices.length);
  const mesh = new InstancedMesh(geo, mat, maxC);
  mesh.name = 'MarchlandShorelineReeds';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  if (matrices.length === 0) {
    mesh.setMatrixAt(0, ZERO_MATRIX);
    mesh.count = 1;
  } else {
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]!);
    mesh.count = matrices.length;
  }
  markStaticInstances(mesh);

  return {
    mesh,
    uWindTime,
    count: matrices.length,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Builds the Stage 1/3/4/5 18% grey CalibrationRig on flat clear ground for EV100 checks. */
function buildCalibrationRig(x: number, y: number, z: number): { group: Group; dispose: () => void } {
  const group = new Group();
  group.name = 'CalibrationRig';
  group.position.set(x, y, z);

  const cubeSize = CALIBRATION.cubeSizeM;
  const plinthGeo = new BoxGeometry(4.4, 0.44, 3.2);
  const cardGeo = new BoxGeometry(cubeSize, cubeSize, cubeSize);
  const sphereGeo = new SphereGeometry(0.48, 32, 20);

  const plinthMat = new MeshStandardNodeMaterial({ color: 0x3b3833, roughness: 0.92, metalness: 0.0 });
  const cardMat = new MeshStandardNodeMaterial({
    roughness: CALIBRATION.greyRoughness,
    metalness: 0.0,
  });
  cardMat.name = 'GreyCard18Material';
  cardMat.color.setRGB(CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear);

  const diffuseMat = new MeshStandardNodeMaterial({
    roughness: CALIBRATION.greyRoughness,
    metalness: 0.0,
  });
  diffuseMat.color.setRGB(CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear);

  const glossyMat = new MeshStandardNodeMaterial({ color: 0x808080, roughness: 0.14, metalness: 0.94 });

  const plinth = new Mesh(plinthGeo, plinthMat);
  plinth.position.y = 0.06;
  plinth.receiveShadow = true;
  group.add(plinth);

  const card = new Mesh(cardGeo, cardMat);
  card.name = 'GreyCard18Cube';
  card.position.set(0, 0.28 + cubeSize * 0.5, -0.15);
  card.castShadow = true;
  card.receiveShadow = true;
  group.add(card);

  const dSphere = new Mesh(sphereGeo, diffuseMat);
  dSphere.position.set(-1.38, 0.76, 0.35);
  dSphere.castShadow = true;
  dSphere.receiveShadow = true;
  group.add(dSphere);

  const gSphere = new Mesh(sphereGeo, glossyMat);
  gSphere.position.set(1.38, 0.76, 0.35);
  gSphere.castShadow = true;
  gSphere.receiveShadow = true;
  group.add(gSphere);

  return {
    group,
    dispose() {
      plinthGeo.dispose();
      cardGeo.dispose();
      sphereGeo.dispose();
      plinthMat.dispose();
      cardMat.dispose();
      diffuseMat.dispose();
      glossyMat.dispose();
    },
  };
}

/** Builds subtle historical stone cairn & heraldic banner poles for the 3 strategic capture points. */
function buildCapturePointMarkers(
  terrain: TerrainField,
  layout: MapLayoutSpec,
  buildingMat: Material,
): { group: Group; dispose: () => void } {
  const group = new Group();
  group.name = 'StrategicCapturePoints';
  const poleGeo = new BoxGeometry(0.14, 5.2, 0.14);
  const flagGeo = new BoxGeometry(1.75, 0.92, 0.06);
  const cairnGeo = new BoxGeometry(1.65, 0.72, 1.65);
  {
    const count = cairnGeo.getAttribute('position').count;
    const uv1 = new Float32Array(count * 2);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      uv1[i * 2] = 8 / 11; // Rubble stone layer
      uv1[i * 2 + 1] = 0.0;
      col[i * 3] = 0.88;
      col[i * 3 + 1] = 0.86;
      col[i * 3 + 2] = 0.82;
    }
    cairnGeo.setAttribute('uv1', new Float32BufferAttribute(uv1, 2));
    cairnGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
  }
  const poleMat = new MeshStandardNodeMaterial({ color: 0x4b3b2c, roughness: 0.88, metalness: 0.0 });
  const flagMat = new MeshStandardNodeMaterial({ color: 0xc29e4a, roughness: 0.84, metalness: 0.0 });

  for (const cp of layout.capturePoints) {
    const y = terrain.heightAt(cp.x, cp.z);
    const holder = new Group();
    holder.name = cp.id;
    holder.position.set(cp.x, y, cp.z);

    const cairn = new Mesh(cairnGeo, buildingMat);
    cairn.position.y = 0.25;
    cairn.receiveShadow = true;
    holder.add(cairn);

    const pole = new Mesh(poleGeo, poleMat);
    pole.position.y = 2.6;
    holder.add(pole);

    const flag = new Mesh(flagGeo, flagMat);
    flag.position.set(0.92, 4.65, 0);
    holder.add(flag);

    group.add(holder);
  }

  return {
    group,
    dispose() {
      poleGeo.dispose();
      flagGeo.dispose();
      cairnGeo.dispose();
      poleMat.dispose();
      flagMat.dispose();
    },
  };
}

/** Helper building a multi-LOD GPU InstancedMesh batch (trees, mossy rocks, walls, cannons, repeated buildings). */
function createMultiLodBatch(
  scene: Scene,
  namePrefix: string,
  tpl: LodTemplate,
  placements: InstancedPlacement[],
  thresholds: LodThresholds,
  shadowMat: Material,
  materialOverride: Material | undefined,
  shadowDistanceM: number,
): MultiLodInstancedBatch {
  const maxC = Math.max(1, placements.length);
  const lodParts = [
    extractStaticParts(tpl.lod0, materialOverride),
    extractStaticParts(tpl.lod1, materialOverride),
    extractStaticParts(tpl.lod2, materialOverride),
  ] as const;
  const shadowParts = extractStaticParts(tpl.shadow, shadowMat);

  const lodBuckets: [InstancedMesh[], InstancedMesh[], InstancedMesh[]] = [[], [], []];
  for (let li = 0; li < 3; li++) {
    for (let pi = 0; pi < lodParts[li]!.length; pi++) {
      const part = lodParts[li]![pi]!;
      const im = new InstancedMesh(part.geometry, part.material, maxC);
      im.name = `${namePrefix}_lod${li}_p${pi}`;
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.setMatrixAt(0, ZERO_MATRIX);
      im.count = 1;
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      lodBuckets[li]!.push(im);
    }
  }

  // Optional >100 m matte billboard impostor (trees)
  let impostorMesh: InstancedMesh | null = null;
  let impostorMat: MeshStandardNodeMaterial | null = null;
  let impostorGeo: BufferGeometry | null = null;
  if (tpl.impostorTex) {
    const iw = tpl.impostorWidthM ?? 8.5;
    const ih = tpl.impostorHeightM ?? 10.5;
    const sink = tpl.impostorBottomSinkM ?? 0.35;
    impostorGeo = new PlaneGeometry(iw, ih);
    const impUv = impostorGeo.getAttribute('uv');
    for (let i = 0; i < impUv.count; i++) {
      impUv.setY(i, 1.0 - impUv.getY(i));
    }
    impUv.needsUpdate = true;
    impostorGeo.translate(0, ih * 0.5 - sink, 0);
    impostorMat = new MeshStandardNodeMaterial({
      map: tpl.impostorTex,
      alphaTest: 0.45,
      roughness: 0.94,
      metalness: 0.0,
      side: DoubleSide,
    });
    impostorMat.name = `${namePrefix}_impostorMat`;
    impostorMesh = new InstancedMesh(impostorGeo, impostorMat, maxC);
    impostorMesh.name = `${namePrefix}_impostors`;
    impostorMesh.castShadow = false;
    impostorMesh.receiveShadow = true;
    impostorMesh.frustumCulled = false;
    impostorMesh.setMatrixAt(0, ZERO_MATRIX);
    impostorMesh.count = 1;
    impostorMesh.instanceMatrix.needsUpdate = true;
    scene.add(impostorMesh);
  }

  // Coarse opaque R7 shadow proxy InstancedMesh (layer 1)
  let shadowMesh: InstancedMesh | null = null;
  if (shadowParts.length > 0) {
    shadowMesh = new InstancedMesh(shadowParts[0]!.geometry, shadowMat, maxC);
    shadowMesh.name = `${namePrefix}_shadow`;
    shadowMesh.castShadow = true;
    shadowMesh.receiveShadow = false;
    shadowMesh.frustumCulled = false;
    shadowMesh.layers.set(SHADOW_ONLY_LAYER);
    shadowMesh.setMatrixAt(0, ZERO_MATRIX);
    shadowMesh.count = 1;
    shadowMesh.instanceMatrix.needsUpdate = true;
    scene.add(shadowMesh);
  }

  return {
    placements,
    thresholds,
    lodBuckets,
    impostorMesh,
    shadowMesh,
    impostorMat,
    impostorGeo,
    shadowDistanceM,
    dirtyBuckets: true,
  };
}

/**
 * Builds the complete 560 x 560 m Stage 5 World for any of the 5 campaign/skirmish maps!
 */
export async function buildStage5World(
  scene: Scene,
  loader: AssetLoader,
  quality: QualityPreset,
  anisotropy: number,
  skyUniforms: PhysicalSkyUniforms,
  mapId: MapLayoutId,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
  onStage?: (label: string, frac01: number) => void,
): Promise<WorldHandles> {
  const layout = buildMapLayout(mapId);
  const terrain = new TerrainField(layout.terrainConfig);

  // Full 560 x 560 m dynamic GroundWorksMap at 512 x 512 (~1.09 m texel resolution across whole battlefield!)
  const groundWorks = new GroundWorksMap(512, layout.terrainConfig.sizeM);
  for (const road of layout.roads) {
    groundWorks.stampRoadPolyline(road, 2.0, 1.8);
  }
  for (const tr of layout.trees) {
    const crownR = tr.species === 'oak' ? 5.0 : tr.species === 'pine' ? 3.8 : 4.0;
    groundWorks.stampTreeCanopy(tr.x, tr.z, crownR * tr.scale, 0.78);
  }
  // Stamp clear rocky gravel pads under all Stone & Iron Ore outcrops so deposits pop visually on meadows!
  for (const oc of layout.outcrops) {
    groundWorks.stampYard(oc.x, oc.z, 7.5, 7.5, 0.76);
  }
  // Keep calibration plinth cleanly surrounded by short grass/clear pad
  groundWorks.stampYard(layout.calibrationXZ[0], layout.calibrationXZ[1], 3.8, 3.8, 0.35);

  const manifest = (await fetch('assets/manifest.json').then((r) => r.json())) as AssetManifest;
  const tracker = createByteProgressTracker(manifest.totalBytes, onProgress);

  // 1. Load 12-layer KTX2 surface library (zero extra textures for all 18 buildings & terrain!)
  const surfaces = await loadSurfaceLibrary(loader, anisotropy, tracker, quality);

  // 2. Terrain mesh + unified physical lakes/rivers + 3-ring Roberts R2 Bézier grass
  const terrainHandles: TerrainRenderHandles = buildTerrainMesh(terrain, groundWorks, surfaces);
  scene.add(terrainHandles.mesh);

  const waterHandles: LakeWaterHandles = buildLakeWater(terrain, skyUniforms, terrainHandles.heightGrid);
  scene.add(waterHandles.mesh);

  const grass = buildGrassField(
    terrain,
    groundWorks,
    terrainHandles.heightTexture,
    terrainHandles.groundWorksTexture,
    quality,
  );
  for (const gm of grass.meshes) scene.add(gm);

  const shadowProxyMat = new MeshStandardNodeMaterial({ color: 0x333333, roughness: 1.0, metalness: 0.0 });
  shadowProxyMat.name = 'Stage5ShadowProxyMat';
  const disposableMats: Material[] = [shadowProxyMat];
  const disposableGeos: BufferGeometry[] = [];

  // Helper to load a 4-LOD static template
  const loadLodTemplate = async (
    basePath: string,
    opts?: {
      overrideMat?: Material;
      impostorUrl?: string;
      impostorW?: number;
      impostorH?: number;
      impostorSink?: number;
      isFoliage?: boolean;
    },
  ): Promise<LodTemplate> => {
    const [g0, g1, g2, gSh, impTex] = await Promise.all([
      loader.loadGlb(`${basePath}_lod0.glb`, tracker),
      loader.loadGlb(`${basePath}_lod1.glb`, tracker),
      loader.loadGlb(`${basePath}_lod2.glb`, tracker),
      loader.loadGlb(`${basePath}_shadow.glb`, tracker),
      opts?.impostorUrl ? loader.loadKtx2(opts.impostorUrl, true, tracker) : Promise.resolve(undefined),
    ]);
    if (opts?.overrideMat) {
      setVisibleMeshFlags(g0.scene, opts.overrideMat);
      setVisibleMeshFlags(g1.scene, opts.overrideMat);
      setVisibleMeshFlags(g2.scene, opts.overrideMat);
    } else {
      applySharedMaterialsFromLod0(g0.scene, g1.scene, skyUniforms, disposableMats, opts?.isFoliage);
      applySharedMaterialsFromLod0(g0.scene, g2.scene, skyUniforms, disposableMats, opts?.isFoliage);
      setVisibleMeshFlags(g0.scene);
      setVisibleMeshFlags(g1.scene);
      setVisibleMeshFlags(g2.scene);
    }
    setShadowProxyFlags(gSh.scene, shadowProxyMat);
    return {
      lod0: g0.scene,
      lod1: g1.scene,
      lod2: g2.scene,
      shadow: gSh.scene,
      impostorTex: impTex,
      impostorWidthM: opts?.impostorW,
      impostorHeightM: opts?.impostorH,
      impostorBottomSinkM: opts?.impostorSink,
    };
  };

  // Pre-load all map building kinds + all player-buildable zero-texture templates (~1.1 MB total, 0 extra textures -> 0 mid-play GPU pipelines!)
  const ALWAYS_BUILDABLE_KINDS: readonly BuildingKind[] = [
    'keep_l1',
    'house_l1',
    'woodcutter_l1',
    'sawmill_l1',
    'forester_l1',
    'hunter_l1',
    'quarry_l1',
    'iron_mine_l1',
    'farm_l1',
    'vineyard_l1',
    'winery_l1',
    'windmill_l1',
    'bakery_l1',
    'brewery_l1',
    'pig_farm_l1',
    'butcher_l1',
    'tavern_l1',
    'tannery_l1',
    'smelter_l1',
    'smithy_l1',
    'armourer_l1',
    'fletcher_l1',
    'stable_l1',
    'barracks_l1',
    'gun_foundry_l1',
    'watchtower_l1',
    'gate_l1',
    'chapel_l1',
    'market_l1',
    'well_l1',
    'storehouse_l1',
    'fisher_l1',
  ];
  const usedBuildingKinds = Array.from(new Set([...layout.buildings.map((b) => b.kind), ...ALWAYS_BUILDABLE_KINDS]));
  const buildingTemplates = new Map<BuildingKind, LodTemplate>();
  // Bounded concurrency (3 templates = up to 12 GLB fetches at once) prevents Safari/iPadOS connection stalls
  let bldCursor = 0;
  const bldWorker = async (): Promise<void> => {
    while (bldCursor < usedBuildingKinds.length) {
      const kind = usedBuildingKinds[bldCursor++]!;
      const tpl = await loadLodTemplate(`assets/buildings/${kind}`, { overrideMat: surfaces.buildingMaterial });
      buildingTemplates.set(kind, tpl);
    }
  };
  await Promise.all(Array.from({ length: 3 }, () => bldWorker()));

  // Load wall_segment (always available for dynamic wall construction), 3 tree species, rocks, fern, cannon, and props in parallel!
  const hasCannons = layout.props.some((p) => p.kind === 'cannon');
  const [
    wallTpl,
    oakTpl,
    pineTpl,
    birchTpl,
    rockATpl,
    rockBTpl,
    boulderTpl,
    cannonTpl,
    fernGltf,
    barrelGltf,
    crateGltf,
    bucketGltf,
    pierGltf,
    stumpGltf,
    saplingGltf,
  ] = await Promise.all([
    loadLodTemplate('assets/buildings/wall_segment', { overrideMat: surfaces.buildingMaterial }),
    loadLodTemplate('assets/trees/oak', { impostorUrl: 'assets/trees/oak_impostor.ktx2', impostorW: 11.8, impostorH: 11.8, impostorSink: 0.35, isFoliage: true }),
    loadLodTemplate('assets/trees/pine', { impostorUrl: 'assets/trees/pine_impostor.ktx2', impostorW: 13.0, impostorH: 13.0, impostorSink: 0.40, isFoliage: true }),
    loadLodTemplate('assets/trees/birch', { impostorUrl: 'assets/trees/birch_impostor.ktx2', impostorW: 11.2, impostorH: 11.2, impostorSink: 0.70, isFoliage: true }),
    loadLodTemplate('assets/nature/rock_moss_a'),
    loadLodTemplate('assets/nature/rock_moss_b'),
    loadLodTemplate('assets/nature/boulder'),
    hasCannons ? loadLodTemplate('assets/units/cannon') : Promise.resolve(null),
    loader.loadGlb('assets/nature/fern_lod0.glb', tracker),
    loader.loadGlb('assets/props/barrel_lod0.glb', tracker),
    loader.loadGlb('assets/props/crate_lod0.glb', tracker),
    loader.loadGlb('assets/props/bucket_lod0.glb', tracker),
    loader.loadGlb('assets/props/pier_lod0.glb', tracker),
    loader.loadGlb('assets/trees/stump_lod0.glb', tracker),
    loader.loadGlb('assets/trees/sapling_lod0.glb', tracker),
  ]);

  // Upgrade Poly Haven fern foliage with backlit subsurface translucency!
  fernGltf.scene.traverse((o: Object3D) => {
    if (!(o instanceof Mesh)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m) o.material = upgradeFoliageTranslucency(m, skyUniforms, disposableMats, 0.32);
  });

  // 3. Place Buildings: all non-animated buildings and wall segments are rendered dynamically by `simRenderer`
  // (`DynBld_*` and `DynWalls`) from `state.buildings` & `state.walls` so there are zero duplicate GPU pipelines
  // and zero ghost walls/buildings in Tutorial or Skirmish mode! Only buildings with articulated child sub-nodes
  // (`windmill_l1` rotating sails and `gate_l1` opening oak gate leaves) use static LOD actors hooked to `staticBuildings`.
  const lodActors: LodActor[] = [];
  const multiLodBatches: MultiLodInstancedBatch[] = [];
  const windmillSails: Object3D[] = [];
  const smokePositions: Vector3[] = [];
  const staticBuildings: StaticBuildingHook[] = [];
  const staticGates: GateLeafHook[] = [];
  const treeHooks: TreeBatchHook[] = [];
  const animatedBuildingKinds = new Set<BuildingKind>(['windmill_l1', 'gate_l1']);

  // Keep architectural timber framing, chapel belfries & watchtower galleries sharp across full RTS views
  const stage5BuildingLod: LodThresholds = { lod1M: 75, lod2M: 155, hysteresisM: 4.0 };

  // Group buildings by kind
  const buildingsByKind = new Map<BuildingKind, typeof layout.buildings[number][]>();
  for (const b of layout.buildings) {
    const arr = buildingsByKind.get(b.kind) ?? [];
    arr.push(b);
    buildingsByKind.set(b.kind, arr);
  }

  for (const [kind, list] of buildingsByKind) {
    const tpl = buildingTemplates.get(kind)!;

    // Extract any `smoke_0` emitter offset from LOD0
    const findSmokeOffset = (rootObj: Object3D): Vector3 | null => {
      let out: Vector3 | null = null;
      rootObj.updateMatrixWorld(true);
      rootObj.traverse((o) => {
        if (!out && o.name.toLowerCase().includes('smoke')) {
          out = new Vector3();
          o.getWorldPosition(out);
        }
      });
      return out;
    };
    const smokeOffset = findSmokeOffset(tpl.lod0);

    // Non-animated buildings are rendered by simRenderer's pre-warmed DynBld_<kind> instanced pools.
    // Record chimney smoke positions for Keep / Donżon which are always present at map start.
    if (!animatedBuildingKinds.has(kind)) {
      if (smokeOffset && (kind === 'keep_l1' || kind === 'fortress_donzon')) {
        for (const b of list) {
          const y = terrain.heightAt(b.x, b.z);
          const sx = b.x + smokeOffset.x * Math.cos(b.yawRad) + smokeOffset.z * Math.sin(b.yawRad);
          const sz = b.z - smokeOffset.x * Math.sin(b.yawRad) + smokeOffset.z * Math.cos(b.yawRad);
          smokePositions.push(new Vector3(sx, y + smokeOffset.y, sz));
        }
      }
      continue;
    }

    // Individual LOD actor for animated buildings (Windmill rotating sails, Gate opening oak leaves)
    for (const b of list) {
      const y = terrain.heightAt(b.x, b.z);
      const root = new Group();
      root.name = `Bld_${kind}`;
      root.position.set(b.x, y, b.z);
      root.rotation.y = b.yawRad;

      const n0 = tpl.lod0.clone(true);
      const n1 = tpl.lod1.clone(true);
      const n2 = tpl.lod2.clone(true);
      const sh = tpl.shadow.clone(true);
      n1.visible = false;
      n2.visible = false;
      root.add(n0, n1, n2, sh);
      scene.add(root);

      // Register rotating windmill sails & animated oak gate leaves
      if (kind === 'windmill_l1') {
        for (const node of [n0, n1, n2]) {
          node.traverse((o) => {
            if (o.name.toLowerCase().includes('sails')) windmillSails.push(o);
          });
        }
      } else if (kind === 'gate_l1') {
        for (const node of [n0, n1, n2]) {
          let leafL: Object3D | null = null;
          let leafR: Object3D | null = null;
          node.traverse((o) => {
            if (o.name === 'leaf_l') {
              o.rotation.y = -1.12;
              leafL = o;
            }
            if (o.name === 'leaf_r') {
              o.rotation.y = 1.12;
              leafR = o;
            }
          });
          staticGates.push({ x: b.x, z: b.z, leafL, leafR });
        }
      }

      lodActors.push({
        root,
        lodNodes: [n0, n1, n2],
        shadowNode: sh,
        thresholds: stage5BuildingLod,
        level: 0,
      });
      staticBuildings.push({
        x: b.x,
        z: b.z,
        isGate: kind === 'gate_l1',
        setVisible: (vis) => {
          root.visible = vis;
        },
      });
    }
  }

  // 5. Batched 3-Species Forest (`oak`, `pine`, `birch`, 420-540 trees in <= 24 draw calls total!)
  const treeTpls: Record<'oak' | 'pine' | 'birch', LodTemplate> = {
    oak: oakTpl,
    pine: pineTpl,
    birch: birchTpl,
  };
  for (const sp of ['oak', 'pine', 'birch'] as const) {
    const list = layout.trees.filter((t) => t.species === sp);
    if (list.length === 0) continue;
    const placements: InstancedPlacement[] = list.map((t) => {
      const y = terrain.heightAt(t.x, t.z);
      TEMP_POS.set(t.x, y, t.z);
      TEMP_QUAT.setFromAxisAngle(UP_AXIS, t.yawRad);
      TEMP_SCALE.set(t.scale, t.scale, t.scale);
      return { x: t.x, y, z: t.z, yawRad: t.yawRad, scale: t.scale, matrix: new Matrix4().compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE), level: 0 };
    });
    const tBatch = createMultiLodBatch(
      scene,
      `Trees_${sp}`,
      treeTpls[sp],
      placements,
      TREE_LOD_THRESHOLDS,
      shadowProxyMat,
      undefined,
      145,
    );
    multiLodBatches.push(tBatch);
    treeHooks.push({
      species: sp,
      setTreeVisible: (x, z, vis) => {
        for (const pl of placements) {
          if (Math.abs(pl.x - x) < 0.8 && Math.abs(pl.z - z) < 0.8) {
            const wantHidden = !vis;
            if (Boolean(pl.hidden) !== wantHidden) {
              pl.hidden = wantHidden;
              tBatch.dirtyBuckets = true;
            }
            break;
          }
        }
      },
    });
  }

  // 6. Poly Haven CC0 Photogrammetry Mossy Rocks & Boulders (multi-LOD instanced!)
  const rockTpls: Record<'rock_moss_a' | 'rock_moss_b' | 'boulder', LodTemplate> = {
    rock_moss_a: rockATpl,
    rock_moss_b: rockBTpl,
    boulder: boulderTpl,
  };
  for (const rk of ['rock_moss_a', 'rock_moss_b', 'boulder'] as const) {
    const list = layout.rocks.filter((r) => r.kind === rk);
    if (list.length === 0) continue;
    const placements: InstancedPlacement[] = list.map((r) => {
      const y = terrain.heightAt(r.x, r.z) - 0.14 * r.scale;
      TEMP_POS.set(r.x, y, r.z);
      TEMP_QUAT.setFromAxisAngle(UP_AXIS, r.yawRad);
      TEMP_SCALE.set(r.scale, r.scale, r.scale);
      return { x: r.x, y, z: r.z, yawRad: r.yawRad, scale: r.scale, matrix: new Matrix4().compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE), level: 0 };
    });
    multiLodBatches.push(
      createMultiLodBatch(
        scene,
        `Nature_${rk}`,
        rockTpls[rk],
        placements,
        PROP_LOD_THRESHOLDS,
        shadowProxyMat,
        undefined,
        115,
      ),
    );
  }

  const staticInstancedMeshes: InstancedMesh[] = [];

  // 6b. Unmistakable 3D Stone & Iron Ore Outcrops (1 single InstancedMesh, sharp cleft quarry rock, 0 extra textures!)
  if (layout.outcrops.length > 0) {
    const parts: BufferGeometry[] = [];
    const specs: readonly [number, number, number, number, number, number, number, number][] = [
      [0.0, 1.35, 0.0, 2.5, 2.15, 2.0, 0.25, 0.14],
      [-2.1, 0.95, 0.75, 1.9, 1.45, 1.6, 1.05, -0.18],
      [2.15, 1.05, -0.65, 2.0, 1.6, 1.65, 2.15, 0.12],
      [0.45, 0.72, 2.05, 1.8, 1.15, 1.45, 0.85, -0.1],
      [-1.25, 0.68, -1.95, 1.65, 1.1, 1.5, 2.55, 0.15],
      [2.85, 0.52, 1.45, 1.35, 0.85, 1.25, 1.55, -0.12],
      [-2.95, 0.48, -0.85, 1.25, 0.82, 1.2, 0.55, 0.1],
    ];
    for (const [tx, ty, tz, sx, sy, sz, ry, rx] of specs) {
      // Detail 0 -> crisp angular quarried rock facets (never smooth snowballs!)
      const g = new DodecahedronGeometry(1.0, 0);
      g.scale(sx, sy, sz);
      g.rotateX(rx);
      g.rotateY(ry);
      g.translate(tx, ty, tz);
      const nonIdx = g.index ? g.toNonIndexed() : g;
      nonIdx.computeVertexNormals();
      parts.push(nonIdx);
      if (nonIdx !== g) g.dispose();
    }
    const outcropGeo = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    disposableGeos.push(outcropGeo);

    const outcropMat = new MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.90, metalness: 0.12 });
    outcropMat.name = 'MarchlandOutcropMat';
    disposableMats.push(outcropMat);

    // 2 layered angular clusters per outcrop (weathered base + cleft granite/iron-vein crown)
    const totalInstances = layout.outcrops.length * 2;
    const outcropMesh = new InstancedMesh(outcropGeo, outcropMat, totalInstances);
    outcropMesh.name = 'MarchlandOutcrops';
    outcropMesh.castShadow = true;
    outcropMesh.receiveShadow = true;
    outcropMesh.frustumCulled = false;
    markStaticInstances(outcropMesh);

    const colStoneBase = new Color(0x7c838a);
    const colStoneCrown = new Color(0xa5acb3);
    const colOreBase = new Color(0x3c4148);
    const colOreVein = new Color(0xb85e27);
    let cursor = 0;
    layout.outcrops.forEach((o, i) => {
      const y = terrain.heightAt(o.x, o.z) - 0.18;
      const yaw = (i * 1.9 + 0.3) % (Math.PI * 2);
      if (o.kind === 'stone') {
        TEMP_POS.set(o.x, y, o.z);
        TEMP_QUAT.setFromAxisAngle(UP_AXIS, yaw);
        TEMP_SCALE.set(1.12, 0.96, 1.12);
        outcropMesh.setMatrixAt(cursor, TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE));
        outcropMesh.setColorAt(cursor, colStoneBase);
        cursor++;

        TEMP_POS.set(o.x + 0.25, y + 0.55, o.z - 0.2);
        TEMP_QUAT.setFromAxisAngle(UP_AXIS, yaw + 1.35);
        TEMP_SCALE.set(0.76, 1.05, 0.72);
        outcropMesh.setMatrixAt(cursor, TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE));
        outcropMesh.setColorAt(cursor, colStoneCrown);
        cursor++;
      } else {
        TEMP_POS.set(o.x, y, o.z);
        TEMP_QUAT.setFromAxisAngle(UP_AXIS, yaw);
        TEMP_SCALE.set(1.08, 1.12, 1.08);
        outcropMesh.setMatrixAt(cursor, TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE));
        outcropMesh.setColorAt(cursor, colOreBase);
        cursor++;

        TEMP_POS.set(o.x + 0.15, y + 1.38, o.z - 0.1);
        TEMP_QUAT.setFromAxisAngle(UP_AXIS, yaw + 1.1);
        TEMP_SCALE.set(0.48, 0.58, 0.48);
        outcropMesh.setMatrixAt(cursor, TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE));
        outcropMesh.setColorAt(cursor, colOreVein);
        cursor++;
      }
    });
    outcropMesh.instanceMatrix.needsUpdate = true;
    if (outcropMesh.instanceColor) outcropMesh.instanceColor.needsUpdate = true;
    scene.add(outcropMesh);
    staticInstancedMeshes.push(outcropMesh);
  }

  // 7. Poly Haven CC0 Siege Field Cannons (multi-LOD instanced!)
  if (cannonTpl) {
    const cannonList = layout.props.filter((p) => p.kind === 'cannon');
    if (cannonList.length > 0) {
      const placements: InstancedPlacement[] = cannonList.map((p) => {
        const y = terrain.heightAt(p.x, p.z);
        TEMP_POS.set(p.x, y, p.z);
        TEMP_QUAT.setFromAxisAngle(UP_AXIS, p.yawRad);
        TEMP_SCALE.set(p.scale, p.scale, p.scale);
        return { x: p.x, y, z: p.z, yawRad: p.yawRad, scale: p.scale, matrix: new Matrix4().compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE), level: 0 };
      });
      multiLodBatches.push(
        createMultiLodBatch(
          scene,
          'SiegeCannons',
          cannonTpl,
          placements,
          PROP_LOD_THRESHOLDS,
          shadowProxyMat,
          undefined,
          135,
        ),
      );
    }
  }

  // 8. Static 1-Draw-Call Batched Props & Forest Ferns (Poly Haven CC0 ferns, crates, buckets, pier, stumps, barrels, carts!)
  const addStaticBatch = (
    name: string,
    sourceRoot: Object3D,
    items: readonly { readonly x: number; readonly z: number; readonly yawRad: number; readonly scale: number; readonly yOverride?: number }[],
    castShadow = false,
  ): void => {
    if (items.length === 0) return;
    const parts = extractStaticParts(sourceRoot);
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]!;
      disposableGeos.push(part.geometry);
      const im = new InstancedMesh(part.geometry, part.material, items.length);
      im.name = `${name}_p${pi}`;
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.frustumCulled = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const y = it.yOverride ?? terrain.heightAt(it.x, it.z);
        TEMP_POS.set(it.x, y, it.z);
        TEMP_QUAT.setFromAxisAngle(UP_AXIS, it.yawRad);
        TEMP_SCALE.set(it.scale, it.scale, it.scale);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        im.setMatrixAt(i, TEMP_MAT);
      }
      im.count = items.length;
      markStaticInstances(im);
      scene.add(im);
      staticInstancedMeshes.push(im);
    }
  };

  addStaticBatch('PolyHavenFerns', fernGltf.scene, layout.ferns, false);
  const propSources: Record<string, Object3D> = {
    barrel: barrelGltf.scene,
    crate: crateGltf.scene,
    bucket: bucketGltf.scene,
    pier: pierGltf.scene,
    stump: stumpGltf.scene,
    sapling: saplingGltf.scene,
  };
  const wl = terrain.config.river?.waterLevelM ?? terrain.config.lake.waterLevelM;
  for (const [pKind, srcRoot] of Object.entries(propSources)) {
    const items = layout.props
      .filter((p) => p.kind === pKind)
      .map((p) => ({
        x: p.x,
        z: p.z,
        yawRad: p.yawRad,
        scale: p.scale,
        // Seat wooden pier cleanly just above water level (`wl - 0.15 m`) so its pilings sit submerged!
        yOverride: pKind === 'pier' ? wl - 0.15 : undefined,
      }));
    addStaticBatch(`Prop_${pKind}`, srcRoot, items, pKind === 'pier');
  }

  // 9. GPU-Bone-Instanced MakeHuman CC0 Soldiers & Villagers (160-185 units in <= 12 draw calls!)
  const unitSpawns: InstancedUnitSpawn[] = layout.units.map((u) => ({
    archetype: u.archetype,
    team: u.team,
    x: u.x,
    y: terrain.heightAt(u.x, u.z),
    z: u.z,
    yawRad: u.yawRad,
    scale: u.scale,
    clip: u.clip,
    phase01: u.phase01,
    speedMul: u.speedMul,
    tintVar: u.tintVar,
    patrol: u.patrol,
    patrolSpeedMs: 1.45,
    patrolProgress: u.phase01 * (u.patrol?.length ?? 1),
  }));
  const unitInstancer = await buildUnitInstancer(scene, loader, unitSpawns, tracker);

  // 10. Swaying Golden Wheat, Shoreline Reeds, Chimney Smoke, Capture Points, Contact Shadows & Calibration Rig
  const wheat = buildWheatField(terrain, [], quality);
  scene.add(wheat.mesh);

  const reeds = buildShorelineReeds(terrain, quality);
  scene.add(reeds.mesh);

  const smokeHandles: ChimneySmokeHandles = buildChimneySmoke(smokePositions, skyUniforms);
  scene.add(smokeHandles.mesh);

  const captureMarkers = buildCapturePointMarkers(terrain, layout, surfaces.buildingMaterial);
  scene.add(captureMarkers.group);

  // Terrain-conforming ambient ground contact shadows (1 draw call anchoring buildings, trees, props & regiments!)
  const contactBatch = new ContactShadowBatch();
  for (const b of layout.buildings) {
    if (b.kind === 'keep_l1' || b.kind === 'fortress_donzon') {
      contactBatch.addRect(b.x, b.z, b.yardRx * 1.15, b.yardRz * 1.15, b.yawRad, 0.92, 0.95);
    }
  }
  for (const tr of layout.trees) {
    contactBatch.addDisc(tr.x, tr.z, 1.45 * tr.scale, 0.72, 0.25);
  }
  for (const p of layout.props) {
    if (p.kind !== 'pier') contactBatch.addDisc(p.x, p.z, p.kind === 'cannon' ? 1.55 : 0.85, 0.78, 0.28);
  }
  const contactShadowMesh = contactBatch.build(
    skyUniforms.uContactShadowGain,
    0.018,
    (x, z) => terrain.heightAt(x, z),
  );
  scene.add(contactShadowMesh);

  const calX = layout.calibrationXZ[0];
  const calZ = layout.calibrationXZ[1];
  const calibrationRig = buildCalibrationRig(calX, terrain.heightAt(calX, calZ), calZ);
  scene.add(calibrationRig.group);

  // Per-frame update state
  let simTimeS = 0;
  let lastImpostorYaw = -999;
  const focusPos = new Vector3();
  const lodSummary: Record<string, number> = { lod0: 0, lod1: 0, lod2: 0, impostor: 0 };

  const update = (dtS: number, cameraPos: Vector3, cameraDir: Vector3, paused: boolean): void => {
    if (!paused) {
      simTimeS += dtS;
      for (const sails of windmillSails) {
        sails.rotation.z -= dtS * 0.58;
      }
      wheat.uWindTime.value = simTimeS;
      reeds.uWindTime.value = simTimeS;
      smokeHandles.update(simTimeS, cameraPos);
    }

    // Center 3-ring grass field on camera's ground look-target (clamped cleanly within 560 m map)
    const tGround = cameraDir.y < -0.05 ? Math.min(52, Math.max(0, (cameraPos.y - 1.5) / -cameraDir.y)) : 16;
    focusPos.set(
      Math.max(-255, Math.min(255, cameraPos.x + cameraDir.x * tGround)),
      0,
      Math.max(-255, Math.min(255, cameraPos.z + cameraDir.z * tGround)),
    );
    grass.update(focusPos.x, focusPos.z, simTimeS);

    lodSummary.lod0 = 0;
    lodSummary.lod1 = 0;
    lodSummary.lod2 = 0;
    lodSummary.impostor = 0;

    // 1. Hero building LOD switches
    for (const actor of lodActors) {
      const dist = cameraPos.distanceTo(actor.root.position);
      const next = Math.min(2, selectLodLevel(dist, actor.level, actor.thresholds)) as 0 | 1 | 2;
      if (next !== actor.level) {
        actor.level = next;
        actor.lodNodes[0].visible = next === 0;
        actor.lodNodes[1].visible = next === 1;
        actor.lodNodes[2].visible = next === 2;
      }
      if (next === 0) lodSummary.lod0!++;
      else if (next === 1) lodSummary.lod1!++;
      else lodSummary.lod2!++;
    }

    // 2. Multi-LOD Instanced Batches (trees, mossy rocks, walls, repeated buildings, siege cannons)
    const camYaw = Math.atan2(cameraPos.x - focusPos.x, cameraPos.z - focusPos.z);
    const yawChanged = Math.abs(camYaw - lastImpostorYaw) > 0.04;
    if (yawChanged) lastImpostorYaw = camYaw;

    for (const batch of multiLodBatches) {
      let changed = batch.dirtyBuckets;
      const hasImp = batch.impostorMesh !== null;
      for (const p of batch.placements) {
        if (p.hidden) continue;
        const dist = Math.hypot(cameraPos.x - p.x, cameraPos.y - p.y, cameraPos.z - p.z);
        const rawNext = selectLodLevel(dist, p.level, batch.thresholds);
        const next = (hasImp ? rawNext : Math.min(2, rawNext)) as LodLevel;
        if (next !== p.level) {
          p.level = next;
          changed = true;
        }
        if (next === 0) lodSummary.lod0!++;
        else if (next === 1) lodSummary.lod1!++;
        else if (next === 2) lodSummary.lod2!++;
        else lodSummary.impostor!++;
      }

      if (changed || (hasImp && yawChanged)) {
        batch.dirtyBuckets = false;
        const c = [0, 0, 0] as [number, number, number];
        let impCount = 0;
        let shCount = 0;

        for (const p of batch.placements) {
          if (p.hidden) continue;
          if (p.level < 3) {
            const idx = c[p.level as 0 | 1 | 2]++;
            for (const m of batch.lodBuckets[p.level as 0 | 1 | 2]!) {
              m.setMatrixAt(idx, p.matrix);
            }
          } else if (batch.impostorMesh) {
            const billYaw = Math.atan2(cameraPos.x - p.x, cameraPos.z - p.z);
            TEMP_POS.set(p.x, p.y, p.z);
            TEMP_QUAT.setFromAxisAngle(UP_AXIS, billYaw);
            TEMP_SCALE.set(p.scale, p.scale, p.scale);
            TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
            batch.impostorMesh.setMatrixAt(impCount++, TEMP_MAT);
          }

          // Only populate shadow proxy within CSM shadow cascade radius -> keeps shadow pass super lean!
          if (batch.shadowMesh) {
            const dSq = (cameraPos.x - p.x) * (cameraPos.x - p.x) + (cameraPos.z - p.z) * (cameraPos.z - p.z);
            if (dSq < batch.shadowDistanceM * batch.shadowDistanceM) {
              batch.shadowMesh.setMatrixAt(shCount++, p.matrix);
            }
          }
        }

        for (let li = 0; li < 3; li++) {
          for (const m of batch.lodBuckets[li]!) {
            if (c[li]! === 0) {
              m.setMatrixAt(0, ZERO_MATRIX);
              m.count = 1;
            } else {
              m.count = c[li]!;
            }
            m.instanceMatrix.needsUpdate = true;
          }
        }
        if (batch.impostorMesh) {
          if (impCount === 0) {
            batch.impostorMesh.setMatrixAt(0, ZERO_MATRIX);
            batch.impostorMesh.count = 1;
          } else {
            batch.impostorMesh.count = impCount;
          }
          batch.impostorMesh.instanceMatrix.needsUpdate = true;
        }
        if (batch.shadowMesh) {
          if (shCount === 0) {
            batch.shadowMesh.setMatrixAt(0, ZERO_MATRIX);
            batch.shadowMesh.count = 1;
          } else {
            batch.shadowMesh.count = shCount;
          }
          batch.shadowMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }

    // 3. GPU Bone-Instanced Characters (Stage 5 standalone patrol fallback)
    if (!simDrivenUnits) {
      unitInstancer.update(dtS, cameraPos, paused, (x, z) => terrain.heightAt(x, z));
    }
    const uLod = unitInstancer.getLodCounts();
    lodSummary.lod0! += uLod.lod0 ?? 0;
    lodSummary.lod1! += uLod.lod1 ?? 0;
    lodSummary.lod2! += uLod.lod2 ?? 0;
  };

  let simDrivenUnits = false;

  // Stage 6 Pre-warmed Combat VFX, High-Detail FPS/Marchland Units & Buildings, and Live Dynamic Sim World Synchronizer (all added BEFORE warmUp!)
  // Run sequentially with live stage progress so mobile/iPadOS Safari never stalls or exceeds peak RAM.
  onStage?.('units & troops…', 0.80);
  const marchlandUnits = await buildMarchlandUnits(scene, quality, (done, total) => {
    onStage?.(`units ${done}/${total}`, 0.80 + (done / Math.max(1, total)) * 0.08);
  }).catch((): MarchlandUnitsHandles | null => null);

  if (quality !== 'minimal') {
    onStage?.('buildings…', 0.88);
  }
  const marchlandBuildingLevels = await loadMarchlandBuildingLevels(loader, quality, (done, total) => {
    onStage?.(`buildings ${done}/${total}`, 0.88 + (done / Math.max(1, total)) * 0.06);
  });
  onStage?.('preparing world…', 0.94);
  const combatFx = buildCombatFx(scene);
  const simRenderer = buildSimWorldRenderer({
    scene,
    terrain,
    groundWorks,
    syncGroundWorks: () => terrainHandles.syncGroundWorks(),
    syncDynamicFarms: (blds) => wheat.syncDynamicFarms(blds),
    buildingMaterial: surfaces.buildingMaterial,
    siteBuildingMaterial: surfaces.siteBuildingMaterial,
    buildingTemplates,
    marchlandBuildingLevels,
    wallTemplate: wallTpl,
    stumpRoot: stumpGltf.scene,
    saplingRoot: saplingGltf.scene,
    staticBuildings,
    staticGates,
    treeHooks,
  });

  const syncSimWorld: WorldHandles['syncSimWorld'] = (
    dtS,
    state,
    cameraPos,
    cameraDir,
    selectedRegimentIds,
    selectedBuildingId,
    formationGhost,
    placementGhost,
    paused,
  ) => {
    simDrivenUnits = true;
    const hAt = (x: number, z: number): number => terrain.heightAt(x, z);
    simRenderer.sync(state, placementGhost);
    if (marchlandUnits) {
      unitInstancer.setVisible(false);
      marchlandUnits.syncFromSim(state, hAt, state.timeS);
    } else {
      unitInstancer.setVisible(true);
      unitInstancer.syncFromSim(state, cameraPos, hAt, state.timeS);
    }
    combatFx.update(
      dtS,
      state,
      cameraPos,
      hAt,
      selectedRegimentIds,
      selectedBuildingId,
      formationGhost,
      placementGhost,
      paused,
      marchlandUnits !== null,
    );
    update(dtS, cameraPos, cameraDir, paused);
  };

  // Seed initial LOD matrices & smoke immediately BEFORE renderer.warmUp() so every pipeline compiles at load!
  const initPos = new Vector3(layout.playerKeepXZ[0] + 24, 24, layout.playerKeepXZ[1] + 44);
  const initDir = new Vector3(-0.35, -0.45, -0.82).normalize();
  smokeHandles.update(0, initPos);
  update(0, initPos, initDir, true);

  return {
    mapId,
    layout,
    terrain,
    groundWorks,
    surfaces,
    manifest,
    grass,
    units: unitInstancer,
    combatFx,
    simRenderer,
    update,
    syncSimWorld,
    getLodSummary: () => ({ ...lodSummary }),
    getWorldMetrics: () => ({
      mapId,
      grassBlades: grass.totalBlades,
      grassTriangles: grass.totalTriangles,
      treeCount: layout.trees.length,
      rockCount: layout.rocks.length,
      fernCount: layout.ferns.length,
      buildingCount: layout.buildings.length,
      unitCount: unitInstancer.getUnitCount(),
      wallSegments: layout.walls.length,
      reedClumps: reeds.count,
      wheatClusters: wheat.count,
    }),
    dispose() {
      marchlandUnits?.dispose();
      combatFx.dispose();
      simRenderer.dispose();
      scene.remove(terrainHandles.mesh);
      terrainHandles.dispose();
      scene.remove(waterHandles.mesh);
      waterHandles.dispose();
      for (const gm of grass.meshes) scene.remove(gm);
      grass.dispose();
      scene.remove(wheat.mesh);
      wheat.dispose();
      scene.remove(reeds.mesh);
      reeds.dispose();
      scene.remove(smokeHandles.mesh);
      smokeHandles.dispose();
      scene.remove(captureMarkers.group);
      captureMarkers.dispose();
      scene.remove(contactShadowMesh);
      contactShadowMesh.geometry.dispose();
      (contactShadowMesh.material as Material).dispose();
      scene.remove(calibrationRig.group);
      calibrationRig.dispose();
      unitInstancer.dispose();
      for (const actor of lodActors) scene.remove(actor.root);
      for (const batch of multiLodBatches) {
        for (const list of batch.lodBuckets) {
          for (const m of list) {
            scene.remove(m);
            m.geometry.dispose();
          }
        }
        if (batch.impostorMesh) scene.remove(batch.impostorMesh);
        batch.impostorGeo?.dispose();
        batch.impostorMat?.dispose();
        if (batch.shadowMesh) {
          scene.remove(batch.shadowMesh);
          batch.shadowMesh.geometry.dispose();
        }
      }
      for (const im of staticInstancedMeshes) scene.remove(im);
      for (const g of disposableGeos) g.dispose();
      for (const m of disposableMats) m.dispose();
      surfaces.dispose();
    },
  };
}
