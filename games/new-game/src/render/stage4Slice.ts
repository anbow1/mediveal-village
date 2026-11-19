// Stage 4 — 100 x 100 m Vertical Slice at Final Quality (R1, R5, R10):
// Composes a living medieval village settlement + enclosed lake + wooded NW ridge + opposing regiments:
//   - Single-height-function TerrainField + 6-layer height-blended TSL terrain (0.45 m to 460 m zero tiling)
//   - Dynamic RGBA8 GroundWorksMap (dirt yards, cobbled roads, ploughed farm strips, Gaussian tree shade)
//   - 3-ring Roberts R2 Bézier grass blades (3 draw calls) sharing exact R32F height & groundWorks masks
//   - Enclosed physical lake water (unified sky reflection + Beer-Lambert depth + wet silt + shoreline reeds)
//   - 9 medieval buildings (Keep, 3 Cottages, Woodcutter, Farm + wheat strips, Windmill with rotating sails,
//     Bakery with steaming oven, Watchtower, Gate with open twin leaves, instanced Curtain Wall segments)
//   - 3 tree species (Oak, Scots Pine, Silver Birch) batched into per-species multi-LOD InstancedMeshes +
//     >100 m matte impostors + coarse R7 shadow stand-ins + forestry stumps & saplings
//   - 8 animated villagers walking village lanes + 12 Marchland Cobalt vs 12 Enemy Crimson swordsmen
//     (zero-extra-texture TSL heraldic team-swap shader) + rising chimney smoke + terrain-conforming contact shadows
//   - Stage 1/3 18% grey CalibrationRig preserved cleanly at (-38, y, 36) for unbroken 4-preset EV100 checks.

import {
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  BufferGeometry,
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
import {
  attribute,
  clamp,
  float,
  max,
  mix,
  positionLocal,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vertexColor,
} from 'three/tsl';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CALIBRATION, type QualityPreset } from '../config.ts';
import { GroundWorksMap } from '../sim/groundWorks.ts';
import {
  BUILDING_LOD_THRESHOLDS,
  PROP_LOD_THRESHOLDS,
  selectLodLevel,
  TREE_LOD_THRESHOLDS,
  UNIT_LOD_THRESHOLDS,
  type LodLevel,
  type LodThresholds,
} from '../sim/lodMath.ts';
import { STAGE4_TERRAIN_CONFIG, TerrainField } from '../sim/terrain.ts';
import {
  type AssetLoader,
  type AssetManifest,
  createByteProgressTracker,
} from './assetLoader.ts';
import { ContactShadowBatch } from './contactShadows.ts';
import { buildGrassField, type GrassFieldHandles } from './grassField.ts';
import { markStaticInstances } from './instancing.ts';
import { buildLakeWater, type LakeWaterHandles } from './lakeWater.ts';
import { SHADOW_ONLY_LAYER } from './lighting.ts';
import type { PhysicalSkyUniforms } from './sky.ts';
import { buildChimneySmoke, type ChimneySmokeHandles } from './smokeFx.ts';
import { loadSurfaceLibrary, type SurfaceLibrary } from './surfaces.ts';
import { buildTerrainMesh, type TerrainRenderHandles } from './terrainMesh.ts';

/** World XZ anchor of the Stage 1/3 18% grey calibration plinth (level clear ground SW of farm). */
export const STAGE4_CALIBRATION_XZ: readonly [number, number] = [-38, 36];

interface LodTemplate {
  readonly lod0: Object3D;
  readonly lod1: Object3D;
  readonly lod2: Object3D;
  readonly shadow: Object3D;
  readonly animations: readonly AnimationClip[];
  readonly impostorTex?: Texture;
  readonly impostorWidthM?: number;
  readonly impostorHeightM?: number;
  readonly impostorBottomSinkM?: number;
  readonly skinned: boolean;
  readonly castFromLod0: boolean;
}

interface LodActor {
  readonly kind: 'building' | 'unit' | 'prop';
  readonly root: Group;
  readonly lodNodes: readonly [Object3D, Object3D, Object3D, Object3D | null];
  readonly shadowNode: Object3D;
  readonly thresholds: LodThresholds;
  readonly castFromLod0: boolean;
  readonly billboardNode: Object3D | null;
  level: LodLevel;
}

interface TreePlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
  readonly matrix: Matrix4;
  level: LodLevel;
}

interface SubMeshPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

interface TreeSpeciesBatch {
  readonly species: 'oak' | 'pine' | 'birch';
  readonly placements: TreePlacement[];
  readonly lodBuckets: readonly [InstancedMesh[], InstancedMesh[], InstancedMesh[]];
  readonly impostorMesh: InstancedMesh;
  readonly shadowMesh: InstancedMesh;
  readonly impostorMat: MeshStandardNodeMaterial;
  readonly impostorGeo: BufferGeometry;
  dirtyBuckets: boolean;
}

interface CitizenWalker {
  readonly actor: LodActor;
  readonly waypoints: readonly (readonly [number, number])[];
  readonly speedMs: number;
  progress: number;
}

export interface Stage4SliceHandles {
  readonly terrain: TerrainField;
  readonly groundWorks: GroundWorksMap;
  readonly surfaces: SurfaceLibrary;
  readonly manifest: AssetManifest;
  readonly grass: GrassFieldHandles;
  readonly update: (dtS: number, cameraPos: Vector3, cameraDir: Vector3, paused: boolean) => void;
  readonly getLodSummary: () => Record<string, number>;
  readonly getSliceMetrics: () => {
    readonly grassBlades: number;
    readonly grassTriangles: number;
    readonly treeCount: number;
    readonly buildingCount: number;
    readonly unitCount: number;
    readonly wallSegments: number;
    readonly reedClumps: number;
    readonly wheatClusters: number;
  };
  readonly dispose: () => void;
}

const ZERO_MATRIX = new Matrix4().makeScale(0, 0, 0);

function collectMeshMaterials(root: Object3D): Map<string, Material> {
  const map = new Map<string, Material>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat) return;
    if (mat.name) map.set(mat.name, mat);
    if (!map.has('__default')) map.set('__default', mat);
  });
  return map;
}

function configureModelMaterials(
  root: Object3D,
  opts: { alphaCutoutNames?: readonly string[]; forceVertexColor?: boolean },
): void {
  const cutoutSet = new Set(opts.alphaCutoutNames ?? []);
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const geom = o.geometry as BufferGeometry;
    const hasColor = geom.hasAttribute('color');
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat instanceof MeshStandardMaterial) {
        if (hasColor && (opts.forceVertexColor ?? true)) {
          mat.vertexColors = true;
        }
        if (cutoutSet.has(mat.name) || o.name.toLowerCase().includes('canopy')) {
          mat.transparent = false;
          mat.alphaTest = 0.45;
          mat.side = DoubleSide;
          mat.depthWrite = true;
          mat.roughness = 0.78;
          mat.metalness = 0.0;
        }
        mat.needsUpdate = true;
      }
    }
  });
}

function applySharedMaterialsFromLod0(
  target: Object3D,
  lod0Mats: Map<string, Material>,
  barkFallbackName?: string,
  leafFallbackName?: string,
): void {
  const fallback = lod0Mats.get('__default');
  target.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const cur = Array.isArray(o.material) ? o.material[0] : o.material;
    const byName = cur?.name ? lod0Mats.get(cur.name) : undefined;
    const lower = o.name.toLowerCase();
    const byObject =
      lower.includes('canopy') && leafFallbackName
        ? lod0Mats.get(leafFallbackName)
        : lower.includes('trunk') && barkFallbackName
          ? lod0Mats.get(barkFallbackName)
          : undefined;
    const chosen = byObject ?? byName ?? fallback;
    if (chosen) o.material = chosen;
  });
}

function overrideAllMaterials(root: Object3D, material: Material): void {
  root.traverse((o) => {
    if (o instanceof Mesh) o.material = material;
  });
}

function setVisibleMeshFlags(root: Object3D, castShadow: boolean, receiveShadow: boolean): void {
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.layers.set(0);
      o.castShadow = castShadow;
      o.receiveShadow = receiveShadow;
    }
  });
}

function configureShadowStandIn(root: Object3D, shadowMat: Material): void {
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.material = shadowMat;
      o.layers.set(SHADOW_ONLY_LAYER);
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
}

/**
 * Converts quantized / normalized / interleaved attributes (from `KHR_mesh_quantization` / Meshopt)
 * into clean standard `Float32BufferAttribute`s so `geo.applyMatrix4(matrixWorld)` never overflows
 * or clamps vertex positions to `[-1, +1]`.
 */
function dequantizeGeometry(source: BufferGeometry): BufferGeometry {
  const geo = new BufferGeometry();
  const idx = source.getIndex();
  if (idx) {
    geo.setIndex(idx.clone());
  }
  for (const name of Object.keys(source.attributes)) {
    const attr = source.getAttribute(name);
    if (!attr) continue;
    const itemSize = attr.itemSize;
    const arr = new Float32Array(attr.count * itemSize);
    for (let i = 0; i < attr.count; i++) {
      const base = i * itemSize;
      arr[base] = attr.getX(i);
      if (itemSize > 1) arr[base + 1] = attr.getY(i);
      if (itemSize > 2) arr[base + 2] = attr.getZ(i);
      if (itemSize > 3) arr[base + 3] = attr.getW(i);
    }
    geo.setAttribute(name, new Float32BufferAttribute(arr, itemSize));
  }
  return geo;
}

/** Extracts baked world-space mesh parts from a static GLTF scene for GPU instancing. */
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
 * Zero-extra-texture TSL enemy heraldry material derived from `SwordsmanPBR`:
 * shifts Marchland woad cobalt (`b > max(r, g)`) into historically dyed medieval crimson wool/linen
 * while preserving 100% of the linen weave, folds, mud hem, steel, chainmail, leather, skin,
 * ochre chevron trim, normal map, roughness/metalness ORM, skeletal skinning, and Cycles AO.
 */
function createCrimsonSwordsmanMaterial(source: Material | undefined): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 1.0,
  });
  mat.name = 'EnemyCrimsonSwordsmanMat';

  if (source instanceof MeshStandardMaterial) {
    mat.normalMap = source.normalMap;
    mat.roughnessMap = source.roughnessMap;
    mat.metalnessMap = source.metalnessMap;
    mat.aoMap = source.aoMap;
    mat.roughness = source.roughness;
    mat.metalness = source.metalness;
    if (source.map) {
      const texCol = texture(source.map, uv(0)).rgb;
      // Channel-max value preserves linear fabric brightness when shifting woad blue -> feudal madder crimson.
      const val = max(texCol.r, max(texCol.g, texCol.b));
      const blueExcess = smoothstep(float(0.010), float(0.042), texCol.b.sub(max(texCol.r, texCol.g).mul(1.05)));
      const crimson = vec3(val.mul(1.85), val.mul(0.15), val.mul(0.13));
      const swapped = mix(texCol, crimson, blueExcess);
      mat.colorNode = clamp(swapped.mul(vertexColor().rgb), vec3(0.012), vec3(0.84));
    }
  }
  return mat;
}

/** Builds a lush ripening golden wheat-sheaf batch (8 arched stalks per sheaf, swaying in the wind). */
function buildWheatField(
  terrain: TerrainField,
  strips: readonly { readonly cx: number; readonly cz: number; readonly lenM: number; readonly widM: number; readonly yawRad: number }[],
  quality: QualityPreset,
): { mesh: InstancedMesh; uWindTime: { value: number }; count: number; dispose: () => void } {
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

    // 5-vertex arched ripening wheat stalk + heavy golden seed head
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
    indices.push(
      vBase, vBase + 1, vBase + 3,
      vBase, vBase + 3, vBase + 2,
      vBase + 2, vBase + 3, vBase + 4,
    );
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
  // Perturb `positionLocal` (never raw attribute!) so Three.js applies InstancedMesh instanceMatrix intact!
  const bend = clamp(positionLocal.y, float(0.0), float(1.0));
  const sway = sin(uWindTime.mul(1.85).add(positionLocal.x.mul(2.5))).mul(0.065).mul(bend).mul(bend);
  mat.positionNode = positionLocal.add(vec3(sway, float(0.0), sway.mul(0.55)));

  const spacingM = quality === 'high' ? 0.44 : 0.62;
  const matrices: Matrix4[] = [];
  const dummy = new Object3D();
  let seed = 101;
  const nextRand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (const st of strips) {
    const ca = Math.cos(st.yawRad);
    const sa = Math.sin(st.yawRad);
    const nx = Math.max(2, Math.floor((st.lenM - 0.35) / spacingM));
    const nz = Math.max(2, Math.floor((st.widM - 0.35) / spacingM));
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const lx = -st.lenM * 0.46 + (ix + 0.5 + (nextRand() - 0.5) * 0.42) * ((st.lenM * 0.92) / nx);
        const lz = -st.widM * 0.46 + (iz + 0.5 + (nextRand() - 0.5) * 0.42) * ((st.widM * 0.92) / nz);
        const wx = st.cx + lx * ca - lz * sa;
        const wz = st.cz + lx * sa + lz * ca;
        const wy = terrain.heightAt(wx, wz);
        dummy.position.set(wx, wy, wz);
        dummy.rotation.set(0, nextRand() * Math.PI * 2, 0);
        const sc = 0.88 + nextRand() * 0.32;
        dummy.scale.set(sc, sc * (0.9 + nextRand() * 0.25), sc);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
    }
  }

  const mesh = new InstancedMesh(geo, mat, Math.max(1, matrices.length));
  mesh.name = 'FarmWheatClusters';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]!);
  }
  mesh.count = Math.max(1, matrices.length);
  mesh.instanceMatrix.needsUpdate = true;
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

/** Builds the Stage 1/3 18% grey calibration plinth & PBR reference swatches grounded on TerrainField. */
function buildCalibrationRig(scene: Scene, terrain: TerrainField): { dispose: () => void } {
  const [cx, cz] = STAGE4_CALIBRATION_XZ;
  const cy = terrain.heightAt(cx, cz);

  const group = new Group();
  group.name = 'CalibrationRig';
  group.position.set(cx, cy, cz);

  const greyMat = new MeshStandardNodeMaterial({
    roughness: CALIBRATION.greyRoughness,
    metalness: 0.0,
  });
  greyMat.name = 'GreyCard18Material';
  greyMat.color.setRGB(CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear, CALIBRATION.greyReflectanceLinear);

  const cubeSize = CALIBRATION.cubeSizeM;
  const cubeGeo = new BoxGeometry(cubeSize, cubeSize, cubeSize);
  const greyCube = new Mesh(cubeGeo, greyMat);
  greyCube.name = 'GreyCard18Cube';
  greyCube.position.set(0, 0.24 + cubeSize * 0.5, 0);
  greyCube.castShadow = true;
  greyCube.receiveShadow = true;
  group.add(greyCube);

  interface SwatchDef {
    shape: 'box' | 'sphere';
    x: number;
    y: number;
    z: number;
    sx: number;
    sy: number;
    sz: number;
    r: number;
    g: number;
    b: number;
    rough: number;
    metal: number;
  }
  const swatches: SwatchDef[] = [
    // Deep foundation plinth sinks -0.40 m so it stays grounded even on slight gentle slope
    { shape: 'box', x: 0, y: -0.08, z: 0, sx: 11.4, sy: 0.64, sz: 4.2, r: 0.21, g: 0.2, b: 0.19, rough: 0.88, metal: 0.0 },
    { shape: 'box', x: -3.6, y: 0.84, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.026, g: 0.026, b: 0.027, rough: 0.96, metal: 0.0 },
    { shape: 'box', x: -2.2, y: 0.84, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.18, g: 0.18, b: 0.18, rough: 0.9, metal: 0.0 },
    { shape: 'box', x: 2.2, y: 0.84, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.21, g: 0.2, b: 0.19, rough: 0.85, metal: 0.0 },
    { shape: 'box', x: 3.6, y: 0.84, z: 0, sx: 1.0, sy: 1.2, sz: 1.0, r: 0.67, g: 0.67, b: 0.63, rough: 0.72, metal: 0.0 },
    { shape: 'sphere', x: 4.9, y: 0.82, z: 0, sx: 0.58, sy: 0.58, sz: 0.58, r: 0.562, g: 0.565, b: 0.578, rough: 0.3, metal: 1.0 },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const surf: number[] = [];
  const indices: number[] = [];
  let vertOffset = 0;
  for (const s of swatches) {
    const geo = s.shape === 'sphere' ? new SphereGeometry(s.sx, 24, 16) : new BoxGeometry(s.sx, s.sy, s.sz);
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    const idx = geo.getIndex();
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i) + s.x, pos.getY(i) + s.y, pos.getZ(i) + s.z);
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      const ao = pos.getY(i) < 0 ? 0.84 : 1.0;
      colours.push(s.r * ao, s.g * ao, s.b * ao);
      surf.push(s.rough, s.metal);
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vertOffset);
    }
    vertOffset += pos.count;
    geo.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new Float32BufferAttribute(colours, 3));
  merged.setAttribute('aSurf', new Float32BufferAttribute(surf, 2));
  merged.setIndex(indices);

  const swatchMat = new MeshStandardNodeMaterial({ vertexColors: true });
  swatchMat.name = 'PbrSwatchMaterial';
  const aSurf = attribute('aSurf', 'vec2');
  swatchMat.roughnessNode = aSurf.x;
  swatchMat.metalnessNode = aSurf.y;

  const swatchMesh = new Mesh(merged, swatchMat);
  swatchMesh.name = 'PbrCalibrationSwatches';
  swatchMesh.castShadow = true;
  swatchMesh.receiveShadow = true;
  group.add(swatchMesh);
  scene.add(group);

  return {
    dispose() {
      cubeGeo.dispose();
      greyMat.dispose();
      merged.dispose();
      swatchMat.dispose();
    },
  };
}

/**
 * Loads all 103 Stage 4 manifest files in parallel with real byte progress and constructs
 * the complete 100 x 100 m medieval village vertical slice at final Stage 4 quality.
 */
export async function buildStage4Slice(
  scene: Scene,
  loader: AssetLoader,
  skyUniforms: PhysicalSkyUniforms,
  anisotropy: number,
  quality: QualityPreset,
  onProgress: (loadedBytes: number, totalBytes: number) => void,
): Promise<Stage4SliceHandles> {
  const manifestRes = await fetch('assets/manifest.json');
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch assets/manifest.json: HTTP ${manifestRes.status}`);
  }
  const manifest = (await manifestRes.json()) as AssetManifest;
  const tracker = createByteProgressTracker(manifest.totalBytes, onProgress);

  // Load 12-layer KTX2 surface arrays + every Stage 4 GLB & KTX2 impostor concurrently.
  const loadLod4 = (base: string) =>
    Promise.all([
      loader.loadGlb(`${base}_lod0.glb`, tracker),
      loader.loadGlb(`${base}_lod1.glb`, tracker),
      loader.loadGlb(`${base}_lod2.glb`, tracker),
      loader.loadGlb(`${base}_shadow.glb`, tracker),
    ]);

  const [
    surfaces,
    houseGltf,
    houseImpostorTex,
    keepGltf,
    woodcutterGltf,
    farmGltf,
    windmillGltf,
    bakeryGltf,
    watchtowerGltf,
    wallGltf,
    gateGltf,
    oakGltf,
    oakImpostorTex,
    pineGltf,
    pineImpostorTex,
    birchGltf,
    birchImpostorTex,
    stumpLod0,
    saplingLod0,
    reedsLod0,
    swordsmanGltf,
    citizenGltf,
    barrelGltf,
  ] = await Promise.all([
    loadSurfaceLibrary(loader, anisotropy, tracker),
    loadLod4('assets/buildings/house_l1'),
    loader.loadKtx2('assets/buildings/house_l1_impostor.ktx2', true, tracker),
    loadLod4('assets/buildings/keep_l1'),
    loadLod4('assets/buildings/woodcutter_l1'),
    loadLod4('assets/buildings/farm_l1'),
    loadLod4('assets/buildings/windmill_l1'),
    loadLod4('assets/buildings/bakery_l1'),
    loadLod4('assets/buildings/watchtower_l1'),
    loadLod4('assets/buildings/wall_segment'),
    loadLod4('assets/buildings/gate_l1'),
    loadLod4('assets/trees/oak'),
    loader.loadKtx2('assets/trees/oak_impostor.ktx2', true, tracker),
    loadLod4('assets/trees/pine'),
    loader.loadKtx2('assets/trees/pine_impostor.ktx2', true, tracker),
    loadLod4('assets/trees/birch'),
    loader.loadKtx2('assets/trees/birch_impostor.ktx2', true, tracker),
    loader.loadGlb('assets/trees/stump_lod0.glb', tracker),
    loader.loadGlb('assets/trees/sapling_lod0.glb', tracker),
    loader.loadGlb('assets/trees/reeds_lod0.glb', tracker),
    loadLod4('assets/units/swordsman'),
    loadLod4('assets/units/citizen'),
    loadLod4('assets/props/barrel'),
  ]);

  // 1. Single-height-function terrain & RGBA8 groundWorks land-cover map.
  const terrain = new TerrainField(STAGE4_TERRAIN_CONFIG);
  const groundWorks = new GroundWorksMap(256, 160);

  // Stamp cobbled village road network (Keep -> Village Green -> Bakery -> Eastern Gate -> Battlefield meadow)
  groundWorks.stampRoadPolyline(
    [
      [-13.5, -9.5],
      [-7.5, -4.5],
      [0.5, -2.5],
      [8.5, -1.6],
      [15.5, -0.8],
      [22.0, -0.5],
      [30.5, -0.5],
      [42.5, -0.5],
      [54.0, -0.2],
    ],
    1.65,
    1.5,
  );
  // Branch road south-west from Village Green to Windmill & Farm
  groundWorks.stampRoadPolyline(
    [
      [-1.0, -2.5],
      [-3.5, 4.0],
      [-4.0, 11.5],
      [-12.0, 15.5],
      [-18.0, 16.5],
    ],
    1.25,
    1.2,
  );
  // Branch cart track west to Woodcutter clearing
  groundWorks.stampRoadPolyline(
    [
      [-7.5, -4.5],
      [-15.5, -6.2],
      [-23.5, -8.2],
    ],
    1.1,
    1.15,
  );
  // Soft path down to lake bank water-drawing spot
  groundWorks.stampRoadPolyline(
    [
      [8.5, -1.6],
      [11.5, 6.0],
      [13.0, 11.5],
    ],
    0.85,
    1.1,
  );

  // Building trampled-earth yards
  groundWorks.stampYard(-14.0, -15.0, 9.2, 8.2, 0.92); // Keep courtyard
  groundWorks.stampYard(1.5, -10.5, 6.2, 4.8, 0.88);   // House North
  groundWorks.stampYard(11.5, -9.2, 6.0, 4.6, 0.86);   // House East
  groundWorks.stampYard(-14.5, 4.5, 5.8, 5.2, 0.86);   // House West
  groundWorks.stampYard(8.0, 2.2, 5.4, 4.6, 0.88);     // Bakery yard
  groundWorks.stampYard(-3.5, 16.5, 5.4, 5.4, 0.85);   // Windmill mound yard
  groundWorks.stampYard(-18.5, 17.0, 6.8, 5.8, 0.90);  // Farm barn yard
  groundWorks.stampYard(-26.5, -8.5, 7.2, 6.2, 0.90);  // Woodcutter timber yard
  groundWorks.stampYard(22.0, -13.5, 4.2, 4.2, 0.82);  // Watchtower plinth
  groundWorks.stampYard(22.0, -0.5, 4.6, 5.0, 0.88);   // Gate apron
  groundWorks.stampYard(STAGE4_CALIBRATION_XZ[0], STAGE4_CALIBRATION_XZ[1], 8.0, 4.2, 0.72); // Calibration plinth

  // 4 ploughed dark-loam agricultural strips south-west of Farm
  const wheatStrips = [
    { cx: -23.5, cz: 25.0, lenM: 5.4, widM: 4.0, yawRad: 0.08 },
    { cx: -16.8, cz: 25.5, lenM: 5.4, widM: 4.0, yawRad: 0.08 },
    { cx: -23.2, cz: 30.8, lenM: 5.4, widM: 4.0, yawRad: 0.08 },
    { cx: -16.5, cz: 31.3, lenM: 5.4, widM: 4.0, yawRad: 0.08 },
  ] as const;
  for (const st of wheatStrips) {
    groundWorks.stampFarmStrip(st.cx, st.cz, st.lenM, st.widM, st.yawRad);
  }

  // Deterministic tree placements across the 100 x 100 m vertical slice + distant >115 m impostor grove
  interface TreeSpec {
    readonly species: 'oak' | 'pine' | 'birch';
    readonly x: number;
    readonly z: number;
    readonly yaw: number;
    readonly scale: number;
  }
  const treeSpecs: readonly TreeSpec[] = [
    // Wooded NW ridge (proves hillside grounding y = 2.4..5.8 m, 3 species mixed)
    { species: 'pine', x: -34.5, z: -26.0, yaw: 0.4, scale: 1.05 },
    { species: 'pine', x: -28.0, z: -31.5, yaw: 1.9, scale: 1.12 },
    { species: 'pine', x: -40.5, z: -32.0, yaw: 3.1, scale: 0.96 },
    { species: 'pine', x: -31.0, z: -38.5, yaw: 4.6, scale: 1.08 },
    { species: 'pine', x: -21.5, z: -33.5, yaw: 2.3, scale: 0.94 },
    { species: 'pine', x: -42.0, z: -20.5, yaw: 5.2, scale: 1.02 },
    { species: 'pine', x: -37.5, z: -15.0, yaw: 0.9, scale: 0.92 },
    { species: 'pine', x: -24.5, z: -25.5, yaw: 3.8, scale: 0.98 },
    { species: 'oak', x: -29.5, z: -21.0, yaw: 1.1, scale: 1.04 },
    { species: 'oak', x: -38.0, z: -25.5, yaw: 2.7, scale: 0.95 },
    { species: 'oak', x: -16.5, z: -28.5, yaw: 4.1, scale: 1.06 },
    { species: 'oak', x: -44.0, z: -28.0, yaw: 0.3, scale: 1.10 },
    { species: 'birch', x: -32.0, z: -18.5, yaw: 2.2, scale: 0.98 },
    { species: 'birch', x: -23.0, z: -20.5, yaw: 5.4, scale: 0.92 },
    { species: 'birch', x: -36.0, z: -34.0, yaw: 1.5, scale: 1.05 },
    { species: 'birch', x: -19.0, z: -24.0, yaw: 3.6, scale: 0.96 },

    // Village green, cottages & western farm hedgerow (framed cleanly off cobbled roads)
    { species: 'oak', x: -6.2, z: -13.2, yaw: 0.65, scale: 0.98 },
    { species: 'oak', x: 16.2, z: -12.0, yaw: 2.35, scale: 0.92 },
    { species: 'oak', x: -21.5, z: 7.5, yaw: 4.4, scale: 1.02 },
    { species: 'oak', x: -29.5, z: 13.5, yaw: 1.8, scale: 1.05 },
    { species: 'oak', x: -8.5, z: 24.5, yaw: 3.3, scale: 0.96 },
    { species: 'birch', x: 7.2, z: -16.8, yaw: 0.8, scale: 0.95 },
    { species: 'birch', x: -8.2, z: 9.2, yaw: 2.9, scale: 0.90 },
    { species: 'birch', x: 15.2, z: 6.2, yaw: 4.9, scale: 0.96 },
    { species: 'birch', x: -29.0, z: 22.0, yaw: 1.3, scale: 1.00 },
    { species: 'pine', x: -33.5, z: 2.5, yaw: 2.6, scale: 0.96 },
    { species: 'pine', x: -36.5, z: -5.5, yaw: 4.2, scale: 1.04 },
    { species: 'pine', x: -34.0, z: 18.0, yaw: 0.7, scale: 0.98 },

    // Northern approach & eastern flank beyond curtain wall
    { species: 'pine', x: 11.0, z: -26.0, yaw: 1.4, scale: 1.06 },
    { species: 'pine', x: 20.5, z: -25.5, yaw: 3.5, scale: 1.00 },
    { species: 'oak', x: 2.5, z: -24.5, yaw: 5.1, scale: 1.02 },
    { species: 'birch', x: 27.5, z: -21.0, yaw: 2.1, scale: 0.94 },
    { species: 'oak', x: 35.5, z: -18.5, yaw: 0.9, scale: 1.05 },
    { species: 'pine', x: 42.0, z: -22.0, yaw: 4.4, scale: 1.08 },
    { species: 'birch', x: 47.5, z: -14.5, yaw: 1.7, scale: 0.98 },

    // Scenic enclosed lake shore grove (strictly on dry banks above lake rim)
    { species: 'birch', x: 6.2, z: 22.5, yaw: 0.5, scale: 1.02 },
    { species: 'birch', x: 11.0, z: 34.8, yaw: 3.1, scale: 0.96 },
    { species: 'oak', x: 21.5, z: 38.2, yaw: 1.9, scale: 1.04 },
    { species: 'birch', x: 35.8, z: 36.8, yaw: 4.6, scale: 0.98 },
    { species: 'oak', x: 45.2, z: 30.0, yaw: 2.4, scale: 1.02 },
    { species: 'pine', x: 48.2, z: 18.5, yaw: 5.5, scale: 1.06 },
    { species: 'birch', x: 43.8, z: 10.5, yaw: 1.2, scale: 0.92 },

    // Midground & >115 m distant grove (exercises LOD2 + >100 m matte impostors live in every overview/RTS view!)
    { species: 'oak', x: 52.0, z: -56.0, yaw: 1.7, scale: 1.04 },
    { species: 'pine', x: 60.0, z: -62.0, yaw: 0.8, scale: 1.08 },
    { species: 'birch', x: 44.0, z: -60.0, yaw: 3.2, scale: 0.98 },
    { species: 'oak', x: -58.0, z: -116.0, yaw: 1.2, scale: 1.06 },
    { species: 'oak', x: -42.0, z: -112.0, yaw: 4.1, scale: 0.95 },
    { species: 'pine', x: -66.0, z: -120.0, yaw: 2.4, scale: 1.12 },
    { species: 'pine', x: -50.0, z: -124.0, yaw: 5.1, scale: 1.04 },
    { species: 'birch', x: -36.0, z: -118.0, yaw: 0.7, scale: 1.02 },
    { species: 'birch', x: -72.0, z: -112.0, yaw: 3.6, scale: 0.98 },

    // Rolling northern & western wooded ridge skyline (0 extra draw calls via batched tree instancing!)
    { species: 'pine', x: -52.0, z: -42.0, yaw: 1.1, scale: 1.12 },
    { species: 'oak', x: -46.0, z: -50.0, yaw: 2.8, scale: 1.08 },
    { species: 'pine', x: -34.0, z: -54.0, yaw: 4.2, scale: 1.15 },
    { species: 'birch', x: -24.0, z: -48.0, yaw: 0.5, scale: 1.02 },
    { species: 'oak', x: -12.0, z: -56.0, yaw: 3.3, scale: 1.10 },
    { species: 'pine', x: -4.0, z: -64.0, yaw: 5.0, scale: 1.16 },
    { species: 'birch', x: 8.0, z: -58.0, yaw: 1.9, scale: 1.04 },
    { species: 'pine', x: 18.0, z: -66.0, yaw: 2.6, scale: 1.14 },
    { species: 'oak', x: 28.0, z: -54.0, yaw: 4.7, scale: 1.08 },
    { species: 'pine', x: 38.0, z: -72.0, yaw: 0.9, scale: 1.15 },
    { species: 'oak', x: 64.0, z: -48.0, yaw: 3.8, scale: 1.06 },
    { species: 'pine', x: 74.0, z: -58.0, yaw: 1.4, scale: 1.12 },
    { species: 'birch', x: 68.0, z: -34.0, yaw: 5.3, scale: 1.00 },
    { species: 'pine', x: -64.0, z: -68.0, yaw: 2.2, scale: 1.18 },
    { species: 'oak', x: -26.0, z: -78.0, yaw: 4.1, scale: 1.12 },
    { species: 'pine', x: -10.0, z: -86.0, yaw: 0.6, scale: 1.20 },
    { species: 'pine', x: 6.0, z: -92.0, yaw: 3.0, scale: 1.18 },
    { species: 'oak', x: 24.0, z: -84.0, yaw: 1.5, scale: 1.14 },
    { species: 'birch', x: 46.0, z: -88.0, yaw: 4.9, scale: 1.06 },
    { species: 'pine', x: 58.0, z: -94.0, yaw: 2.7, scale: 1.20 },
    { species: 'oak', x: -54.0, z: -20.0, yaw: 3.5, scale: 1.08 },
    { species: 'pine', x: -58.0, z: -4.0, yaw: 1.2, scale: 1.10 },
    { species: 'birch', x: -52.0, z: 12.0, yaw: 4.4, scale: 1.02 },
    { species: 'oak', x: 58.0, z: 30.0, yaw: 2.1, scale: 1.06 },
  ];

  // Stamp Gaussian forest-floor canopy shade & needle/leaf litter under every tree in the slice
  for (const t of treeSpecs) {
    const rad = t.species === 'oak' ? 4.8 : t.species === 'pine' ? 3.8 : 3.6;
    groundWorks.stampTreeCanopy(t.x, t.z, rad * t.scale, 0.58);
  }

  // 2. Build displaced 560 x 560 m terrain mesh + enclosed lake water + 3-ring Roberts R2 Bézier grass!
  const terrainRender: TerrainRenderHandles = buildTerrainMesh(terrain, groundWorks, surfaces);
  scene.add(terrainRender.mesh);

  const lakeWater: LakeWaterHandles = buildLakeWater(terrain, skyUniforms);
  scene.add(lakeWater.mesh);

  const grass: GrassFieldHandles = buildGrassField(
    terrain,
    groundWorks,
    terrainRender.heightTexture,
    terrainRender.groundWorksTexture,
    quality,
  );
  for (const gm of grass.meshes) {
    scene.add(gm);
  }

  // 3. Configure shared materials on every asset template.
  const shadowStandInMat = new MeshStandardNodeMaterial({ roughness: 1.0, metalness: 0.0 });
  shadowStandInMat.name = 'ShadowStandInMaterial';

  const buildingPairs = [
    houseGltf,
    keepGltf,
    woodcutterGltf,
    farmGltf,
    windmillGltf,
    bakeryGltf,
    watchtowerGltf,
    wallGltf,
    gateGltf,
  ] as const;
  for (const [g0, g1, g2, gSh] of buildingPairs) {
    overrideAllMaterials(g0.scene, surfaces.buildingMaterial);
    overrideAllMaterials(g1.scene, surfaces.buildingMaterial);
    overrideAllMaterials(g2.scene, surfaces.buildingMaterial);
    configureShadowStandIn(gSh.scene, shadowStandInMat);
  }

  // Configure Oak, Pine, Birch (LOD1/LOD2 share LOD0 KTX2 materials -> 0 extra textures!)
  const setupTreeMaterials = (
    gltf: readonly [{ scene: Object3D }, { scene: Object3D }, { scene: Object3D }, { scene: Object3D }],
    barkName: string,
    leafName: string,
  ): void => {
    configureModelMaterials(gltf[0].scene, { alphaCutoutNames: [leafName], forceVertexColor: true });
    const mats = collectMeshMaterials(gltf[0].scene);
    applySharedMaterialsFromLod0(gltf[1].scene, mats, barkName, leafName);
    applySharedMaterialsFromLod0(gltf[2].scene, mats, barkName, leafName);
    configureShadowStandIn(gltf[3].scene, shadowStandInMat);
  };
  setupTreeMaterials(oakGltf, 'OakBarkPBR', 'OakLeavesCutout');
  setupTreeMaterials(pineGltf, 'PineBarkPBR', 'PineLeavesCutout');
  setupTreeMaterials(birchGltf, 'BirchBarkPBR', 'BirchLeavesCutout');

  configureModelMaterials(stumpLod0.scene, { forceVertexColor: true });
  configureModelMaterials(saplingLod0.scene, { alphaCutoutNames: ['SaplingLeavesCutout'], forceVertexColor: true });
  configureModelMaterials(reedsLod0.scene, { forceVertexColor: true });

  // Configure Units (Marchland Cobalt Swordsman, Enemy Crimson Swordsman, Peasant Citizen)
  configureModelMaterials(swordsmanGltf[0].scene, { forceVertexColor: true });
  const swordsmanMats = collectMeshMaterials(swordsmanGltf[0].scene);
  applySharedMaterialsFromLod0(swordsmanGltf[1].scene, swordsmanMats);
  applySharedMaterialsFromLod0(swordsmanGltf[2].scene, swordsmanMats);
  configureShadowStandIn(swordsmanGltf[3].scene, shadowStandInMat);
  const crimsonSwordsmanMat = createCrimsonSwordsmanMaterial(swordsmanMats.get('__default'));

  configureModelMaterials(citizenGltf[0].scene, { forceVertexColor: true });
  const citizenMats = collectMeshMaterials(citizenGltf[0].scene);
  applySharedMaterialsFromLod0(citizenGltf[1].scene, citizenMats);
  applySharedMaterialsFromLod0(citizenGltf[2].scene, citizenMats);
  configureShadowStandIn(citizenGltf[3].scene, shadowStandInMat);

  configureModelMaterials(barrelGltf[0].scene, { forceVertexColor: true });
  const barrelMats = collectMeshMaterials(barrelGltf[0].scene);
  applySharedMaterialsFromLod0(barrelGltf[1].scene, barrelMats);
  applySharedMaterialsFromLod0(barrelGltf[2].scene, barrelMats);
  configureShadowStandIn(barrelGltf[3].scene, shadowStandInMat);

  const makeBuildingTemplate = (
    gltf: readonly [{ scene: Object3D }, { scene: Object3D }, { scene: Object3D }, { scene: Object3D }],
    impostor?: { tex: Texture; w: number; h: number; sink: number },
  ): LodTemplate => ({
    lod0: gltf[0].scene,
    lod1: gltf[1].scene,
    lod2: gltf[2].scene,
    shadow: gltf[3].scene,
    animations: [],
    impostorTex: impostor?.tex,
    impostorWidthM: impostor?.w,
    impostorHeightM: impostor?.h,
    impostorBottomSinkM: impostor?.sink,
    skinned: false,
    castFromLod0: false,
  });

  const houseTemplate = makeBuildingTemplate(houseGltf, { tex: houseImpostorTex, w: 12.2, h: 12.2, sink: 3.25 });
  const keepTemplate = makeBuildingTemplate(keepGltf);
  const woodcutterTemplate = makeBuildingTemplate(woodcutterGltf);
  const farmTemplate = makeBuildingTemplate(farmGltf);
  const windmillTemplate = makeBuildingTemplate(windmillGltf);
  const bakeryTemplate = makeBuildingTemplate(bakeryGltf);
  const watchtowerTemplate = makeBuildingTemplate(watchtowerGltf);
  const gateTemplate = makeBuildingTemplate(gateGltf);

  const swordsmanTemplate: LodTemplate = {
    lod0: swordsmanGltf[0].scene,
    lod1: swordsmanGltf[1].scene,
    lod2: swordsmanGltf[2].scene,
    shadow: swordsmanGltf[3].scene,
    animations: swordsmanGltf[0].animations,
    skinned: true,
    castFromLod0: true,
  };
  const citizenTemplate: LodTemplate = {
    lod0: citizenGltf[0].scene,
    lod1: citizenGltf[1].scene,
    lod2: citizenGltf[2].scene,
    shadow: citizenGltf[3].scene,
    animations: citizenGltf[0].animations,
    skinned: true,
    castFromLod0: true,
  };
  const barrelTemplate: LodTemplate = {
    lod0: barrelGltf[0].scene,
    lod1: barrelGltf[1].scene,
    lod2: barrelGltf[2].scene,
    shadow: barrelGltf[3].scene,
    animations: [],
    skinned: false,
    castFromLod0: false,
  };

  // Shared matte impostor material helper (roughness 0.92, metalness 0, alphaTest 0.45, DoubleSide — never glossy)
  const impostorMaterials = new Map<Texture, MeshStandardNodeMaterial>();
  const getImpostorMaterial = (tex: Texture, name: string): MeshStandardNodeMaterial => {
    const existing = impostorMaterials.get(tex);
    if (existing) return existing;
    const m = new MeshStandardNodeMaterial({
      map: tex,
      roughness: 0.92,
      metalness: 0.0,
      alphaTest: 0.45,
      side: DoubleSide,
      transparent: false,
    });
    m.name = name;
    impostorMaterials.set(tex, m);
    return m;
  };

  const makeImpostorQuadGeo = (widthM: number, heightM: number, bottomSinkM: number): BufferGeometry => {
    const geo = new PlaneGeometry(widthM, heightM);
    const uvAttr = geo.getAttribute('uv');
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setY(i, 1.0 - uvAttr.getY(i));
    }
    uvAttr.needsUpdate = true;
    geo.translate(0, heightM * 0.5 - bottomSinkM, 0);
    return geo;
  };

  const actors: LodActor[] = [];
  const mixers: AnimationMixer[] = [];
  const disposableGeos: BufferGeometry[] = [];
  const disposableMats: Material[] = [shadowStandInMat, crimsonSwordsmanMat];
  const smokeEmitters: Vector3[] = [];
  const rotatingSails: Object3D[] = [];

  const spawnActor = (
    kind: LodActor['kind'],
    name: string,
    tpl: LodTemplate,
    thresholds: LodThresholds,
    x: number,
    z: number,
    yawRad: number,
    scale = 1.0,
    opts?: {
      yOffset?: number;
      animSpec?: { clipName: string; phaseOffsetS: number; speed?: number };
      materialOverride?: Material;
    },
  ): LodActor => {
    const y = terrain.heightAt(x, z) + (opts?.yOffset ?? 0);
    const root = new Group();
    root.name = name;
    root.position.set(x, y, z);
    root.rotation.y = yawRad;
    root.scale.setScalar(scale);

    const n0 = tpl.skinned ? cloneSkinned(tpl.lod0) : tpl.lod0.clone(true);
    const n1 = tpl.lod1.clone(true);
    const n2 = tpl.lod2.clone(true);
    const nSh = tpl.shadow.clone(true);

    n0.name = `${name}_lod0`;
    n1.name = `${name}_lod1`;
    n2.name = `${name}_lod2`;
    nSh.name = `${name}_shadow`;

    if (opts?.materialOverride) {
      overrideAllMaterials(n0, opts.materialOverride);
      overrideAllMaterials(n1, opts.materialOverride);
      overrideAllMaterials(n2, opts.materialOverride);
    }

    setVisibleMeshFlags(n0, tpl.castFromLod0, true);
    setVisibleMeshFlags(n1, false, true);
    setVisibleMeshFlags(n2, false, true);
    configureShadowStandIn(nSh, shadowStandInMat);

    if (tpl.skinned) {
      n0.traverse((o) => {
        if (o instanceof Mesh) o.frustumCulled = false;
      });
    }

    let impNode: Mesh | null = null;
    if (tpl.impostorTex && tpl.impostorWidthM && tpl.impostorHeightM) {
      const geo = makeImpostorQuadGeo(tpl.impostorWidthM, tpl.impostorHeightM, tpl.impostorBottomSinkM ?? 0.35);
      disposableGeos.push(geo);
      const impMat = getImpostorMaterial(tpl.impostorTex, `${kind}_ImpostorMat`);
      impNode = new Mesh(geo, impMat);
      impNode.name = `${name}_impostor`;
      impNode.layers.set(0);
      impNode.castShadow = false;
      impNode.receiveShadow = true;
      impNode.visible = false;
      root.add(impNode);
    }

    n0.visible = true;
    n1.visible = false;
    n2.visible = false;
    nSh.visible = !tpl.castFromLod0;

    root.add(n0, n1, n2, nSh);
    scene.add(root);

    // Collect `smoke_0` chimney empties from buildings once world transform is known.
    if (kind === 'building') {
      root.updateMatrixWorld(true);
      n0.traverse((o) => {
        if (o.name === 'smoke_0' || o.name.startsWith('smoke_0.')) {
          const wp = new Vector3();
          o.getWorldPosition(wp);
          smokeEmitters.push(wp);
        }
      });
    }

    if (tpl.skinned && opts?.animSpec && tpl.animations.length > 0) {
      const clip = tpl.animations.find((c) => c.name === opts.animSpec?.clipName) ?? tpl.animations[0];
      if (clip) {
        const mixer = new AnimationMixer(n0);
        const action = mixer.clipAction(clip);
        action.timeScale = opts.animSpec.speed ?? 1.0;
        action.play();
        mixer.update(opts.animSpec.phaseOffsetS);
        mixers.push(mixer);
      }
    }

    const actor: LodActor = {
      kind,
      root,
      lodNodes: [n0, n1, n2, impNode],
      shadowNode: nSh,
      thresholds,
      castFromLod0: tpl.castFromLod0,
      billboardNode: impNode,
      level: 0,
    };
    actors.push(actor);
    return actor;
  };

  // ==================== 4. PLACE MEDIEVAL VILLAGE BUILDINGS & FORTIFICATIONS ====================
  const contactBatch = new ContactShadowBatch();
  let buildingCount = 0;

  // Keep L1 commanding the NW village rise
  spawnActor('building', 'Keep_L1', keepTemplate, BUILDING_LOD_THRESHOLDS, -14.0, -15.0, 0.25, 1.0);
  contactBatch.addRect(-14.0, -15.0, 11.4, 9.6, 0.25, 0.96, 1.15);
  buildingCount++;

  // 3 Cottages lining the village green & cobbled lane
  spawnActor('building', 'House_North', houseTemplate, BUILDING_LOD_THRESHOLDS, 1.5, -10.5, 0.08, 1.0);
  contactBatch.addRect(1.5, -10.5, 8.2, 5.6, 0.08, 0.95, 0.95);
  buildingCount++;

  spawnActor('building', 'House_East', houseTemplate, BUILDING_LOD_THRESHOLDS, 11.5, -9.2, -0.24, 1.0);
  contactBatch.addRect(11.5, -9.2, 8.2, 5.6, -0.24, 0.95, 0.95);
  buildingCount++;

  spawnActor('building', 'House_West', houseTemplate, BUILDING_LOD_THRESHOLDS, -14.5, 4.5, 1.38, 1.0);
  contactBatch.addRect(-14.5, 4.5, 8.2, 5.6, 1.38, 0.95, 0.95);
  buildingCount++;

  // Bakery L1 beside the main cobbled lane (domed stone bread oven + steaming chimney)
  spawnActor('building', 'Bakery_L1', bakeryTemplate, BUILDING_LOD_THRESHOLDS, 8.0, 2.2, -2.85, 1.0);
  contactBatch.addRect(8.0, 2.2, 6.4, 5.0, -2.85, 0.92, 0.85);
  buildingCount++;

  // Windmill L1 on gentle southern rise (collect `sails` across all 3 LODs to spin smoothly!)
  const windmillActor = spawnActor('building', 'Windmill_L1', windmillTemplate, BUILDING_LOD_THRESHOLDS, -3.5, 16.5, -0.45, 1.0);
  contactBatch.addDisc(-3.5, 16.5, 3.6, 0.92, 0.45);
  for (const lodNode of windmillActor.lodNodes) {
    lodNode?.traverse((o) => {
      if (o.name === 'sails' || o.name.startsWith('sails.')) {
        rotatingSails.push(o);
      }
    });
  }
  buildingCount++;

  // Farm L1 + 4 ploughed golden wheat strips behind it
  spawnActor('building', 'Farm_L1', farmTemplate, BUILDING_LOD_THRESHOLDS, -18.5, 17.0, 0.15, 1.0);
  contactBatch.addRect(-18.5, 17.0, 9.2, 6.0, 0.15, 0.92, 0.95);
  buildingCount++;

  const wheatField = buildWheatField(terrain, wheatStrips, quality);
  scene.add(wheatField.mesh);

  // Woodcutter L1 tucked against NW pine/oak ridge
  spawnActor('building', 'Woodcutter_L1', woodcutterTemplate, BUILDING_LOD_THRESHOLDS, -26.5, -8.5, 0.88, 1.0);
  contactBatch.addRect(-26.5, -8.5, 6.6, 5.2, 0.88, 0.88, 0.85);
  buildingCount++;

  // Eastern Fortification: Watchtower L1 + Gate L1 (leaves swung open inward) + 12 instanced Wall Segments!
  spawnActor('building', 'Watchtower_North', watchtowerTemplate, BUILDING_LOD_THRESHOLDS, 22.0, -13.5, Math.PI * 0.5, 1.0);
  contactBatch.addRect(22.0, -13.5, 4.4, 4.4, Math.PI * 0.5, 0.95, 0.85);
  buildingCount++;

  const gateActor = spawnActor('building', 'Gate_East', gateTemplate, BUILDING_LOD_THRESHOLDS, 22.0, -0.5, Math.PI * 0.5, 1.0);
  contactBatch.addRect(22.0, -0.5, 6.8, 3.4, Math.PI * 0.5, 0.95, 0.85);
  for (const lodNode of gateActor.lodNodes) {
    lodNode?.traverse((o) => {
      if (o.name === 'leaf_l' || o.name.startsWith('leaf_l.')) o.rotation.y = 0.88;
      if (o.name === 'leaf_r' || o.name.startsWith('leaf_r.')) o.rotation.y = -0.88;
    });
  }
  buildingCount++;

  // 12 instanced curtain wall segments flanking Gate & Watchtower down to the enclosed lake bank (2 draw calls total!)
  const wallPlacements: readonly (readonly [number, number, number])[] = [
    // North run between Gate (z = -0.5) and Watchtower (z = -13.5)
    [22.0, -4.6, Math.PI * 0.5],
    [22.0, -6.6, Math.PI * 0.5],
    [22.0, -8.6, Math.PI * 0.5],
    [22.0, -10.6, Math.PI * 0.5],
    // North return flanking Watchtower westward
    [19.2, -14.6, Math.PI],
    [17.2, -14.6, Math.PI],
    [15.2, -14.6, Math.PI],
    [13.2, -14.6, Math.PI],
    // South run from Gate down to the enclosed lake bank (natural moat flank!)
    [22.0, 3.6, Math.PI * 0.5],
    [22.0, 5.6, Math.PI * 0.5],
    [22.0, 7.6, Math.PI * 0.5],
    [22.0, 9.6, Math.PI * 0.5],
  ];
  const wallVisParts = extractStaticParts(wallGltf[0].scene, surfaces.buildingMaterial);
  const wallShParts = extractStaticParts(wallGltf[3].scene, shadowStandInMat);
  const dummyObj = new Object3D();
  for (const part of wallVisParts) {
    disposableGeos.push(part.geometry);
    const im = new InstancedMesh(part.geometry, part.material, wallPlacements.length);
    im.name = 'CurtainWall_Instanced';
    im.layers.set(0);
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < wallPlacements.length; i++) {
      const [wx, wz, yaw] = wallPlacements[i]!;
      dummyObj.position.set(wx, terrain.heightAt(wx, wz) - 0.12, wz);
      dummyObj.rotation.set(0, yaw, 0);
      dummyObj.scale.setScalar(1);
      dummyObj.updateMatrix();
      im.setMatrixAt(i, dummyObj.matrix);
      contactBatch.addRect(wx, wz, 2.2, 1.5, yaw, 0.85, 0.55);
    }
    im.instanceMatrix.needsUpdate = true;
    markStaticInstances(im);
    scene.add(im);
  }
  for (const part of wallShParts) {
    disposableGeos.push(part.geometry);
    const imSh = new InstancedMesh(part.geometry, part.material, wallPlacements.length);
    imSh.name = 'CurtainWall_Shadow';
    imSh.layers.set(SHADOW_ONLY_LAYER);
    imSh.castShadow = true;
    imSh.receiveShadow = false;
    imSh.frustumCulled = false;
    for (let i = 0; i < wallPlacements.length; i++) {
      const [wx, wz, yaw] = wallPlacements[i]!;
      dummyObj.position.set(wx, terrain.heightAt(wx, wz) - 0.12, wz);
      dummyObj.rotation.set(0, yaw, 0);
      dummyObj.scale.setScalar(1);
      dummyObj.updateMatrix();
      imSh.setMatrixAt(i, dummyObj.matrix);
    }
    imSh.instanceMatrix.needsUpdate = true;
    markStaticInstances(imSh);
    scene.add(imSh);
  }

  // Distant hamlet (> 115 m NW + midground NE) exercising >100 m matte building impostors & CSM Cascade 2!
  spawnActor('building', 'House_MidgroundNE', houseTemplate, BUILDING_LOD_THRESHOLDS, 42.0, -58.0, -0.45, 1.0);
  contactBatch.addRect(42.0, -58.0, 8.2, 5.6, -0.45, 0.88, 0.95);
  spawnActor('building', 'House_DistantNW', houseTemplate, BUILDING_LOD_THRESHOLDS, -52.0, -114.0, 0.35, 1.0);
  buildingCount += 2;

  // ==================== 5. BATCHED MULTI-LOD INSTANCED TREES (OAK, PINE, BIRCH) ====================
  const buildTreeBatch = (
    species: 'oak' | 'pine' | 'birch',
    gltf: readonly [{ scene: Object3D }, { scene: Object3D }, { scene: Object3D }, { scene: Object3D }],
    impostorTex: Texture,
    impW: number,
    impH: number,
    impSink: number,
  ): TreeSpeciesBatch => {
    const specs = treeSpecs.filter((t) => t.species === species);
    const placements: TreePlacement[] = specs.map((t) => {
      const y = terrain.heightAt(t.x, t.z);
      const m = new Matrix4();
      dummyObj.position.set(t.x, y, t.z);
      dummyObj.rotation.set(0, t.yaw, 0);
      dummyObj.scale.setScalar(t.scale);
      dummyObj.updateMatrix();
      m.copy(dummyObj.matrix);
      contactBatch.addDisc(t.x, t.z, 1.25 * t.scale, 0.88, 0.28);
      contactBatch.addDisc(t.x, t.z, (species === 'oak' ? 4.4 : 3.5) * t.scale, 0.34, 0.22);
      return { x: t.x, y, z: t.z, yawRad: t.yaw, scale: t.scale, matrix: m, level: 0 };
    });

    const maxCount = Math.max(1, placements.length);
    const makeLodInsts = (lodScene: Object3D, lodIdx: number): InstancedMesh[] => {
      const parts = extractStaticParts(lodScene);
      return parts.map((p, idx) => {
        disposableGeos.push(p.geometry);
        const im = new InstancedMesh(p.geometry, p.material, maxCount);
        im.name = `Trees_${species}_lod${lodIdx}_p${idx}`;
        im.layers.set(0);
        im.castShadow = false;
        im.receiveShadow = true;
        im.frustumCulled = false;
        // Seed slot 0 with zero-scale so count >= 1 during warmUp() compiles every LOD pipeline cleanly!
        im.setMatrixAt(0, ZERO_MATRIX);
        im.count = 1;
        im.instanceMatrix.needsUpdate = true;
        scene.add(im);
        return im;
      });
    };

    const lod0Meshes = makeLodInsts(gltf[0].scene, 0);
    const lod1Meshes = makeLodInsts(gltf[1].scene, 1);
    const lod2Meshes = makeLodInsts(gltf[2].scene, 2);

    const impostorGeo = makeImpostorQuadGeo(impW, impH, impSink);
    const impostorMat = getImpostorMaterial(impostorTex, `Tree_${species}_ImpostorMat`);
    const impostorMesh = new InstancedMesh(impostorGeo, impostorMat, maxCount);
    impostorMesh.name = `Trees_${species}_impostor`;
    impostorMesh.layers.set(0);
    impostorMesh.castShadow = false;
    impostorMesh.receiveShadow = true;
    impostorMesh.frustumCulled = false;
    impostorMesh.setMatrixAt(0, ZERO_MATRIX);
    impostorMesh.count = 1;
    impostorMesh.instanceMatrix.needsUpdate = true;
    scene.add(impostorMesh);

    const shParts = extractStaticParts(gltf[3].scene, shadowStandInMat);
    const shGeo = shParts[0]!.geometry;
    disposableGeos.push(shGeo);
    const shadowMesh = new InstancedMesh(shGeo, shadowStandInMat, maxCount);
    shadowMesh.name = `Trees_${species}_shadow`;
    shadowMesh.layers.set(SHADOW_ONLY_LAYER);
    shadowMesh.castShadow = true;
    shadowMesh.receiveShadow = false;
    shadowMesh.frustumCulled = false;
    for (let i = 0; i < placements.length; i++) {
      shadowMesh.setMatrixAt(i, placements[i]!.matrix);
    }
    shadowMesh.count = placements.length;
    shadowMesh.instanceMatrix.needsUpdate = true;
    markStaticInstances(shadowMesh);
    scene.add(shadowMesh);

    return {
      species,
      placements,
      lodBuckets: [lod0Meshes, lod1Meshes, lod2Meshes],
      impostorMesh,
      shadowMesh,
      impostorMat,
      impostorGeo,
      dirtyBuckets: true,
    };
  };

  const treeBatches: TreeSpeciesBatch[] = [
    buildTreeBatch('oak', oakGltf, oakImpostorTex, 11.8, 11.8, 0.35),
    buildTreeBatch('pine', pineGltf, pineImpostorTex, 13.0, 13.0, 0.4),
    buildTreeBatch('birch', birchGltf, birchImpostorTex, 11.2, 11.2, 0.7),
  ];

  // ==================== 6. FORESTRY CLEARING (STUMPS + SAPLINGS), LAKE REEDS & BARRELS ====================
  const stumpPositions: readonly (readonly [number, number, number, number])[] = [
    [-22.2, -13.0, 0.4, 1.05],
    [-25.0, -14.8, 1.8, 0.92],
    [-29.2, -14.0, 3.1, 1.12],
    [-31.0, -10.8, 4.4, 0.96],
    [-21.8, -5.2, 2.3, 0.88],
    [-28.5, -3.6, 5.2, 1.02],
    [-32.5, -6.2, 0.9, 1.08],
  ];
  for (const part of extractStaticParts(stumpLod0.scene)) {
    disposableGeos.push(part.geometry);
    const im = new InstancedMesh(part.geometry, part.material, stumpPositions.length);
    im.name = 'WoodcutterStumps';
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < stumpPositions.length; i++) {
      const [sx, sz, yaw, sc] = stumpPositions[i]!;
      dummyObj.position.set(sx, terrain.heightAt(sx, sz), sz);
      dummyObj.rotation.set(0, yaw, 0);
      dummyObj.scale.setScalar(sc);
      dummyObj.updateMatrix();
      im.setMatrixAt(i, dummyObj.matrix);
      contactBatch.addDisc(sx, sz, 0.65 * sc, 0.85, 0.35);
    }
    im.instanceMatrix.needsUpdate = true;
    markStaticInstances(im);
    scene.add(im);
  }

  const saplingPositions: readonly (readonly [number, number, number, number])[] = [
    [-23.6, -16.8, 0.7, 1.0],
    [-27.5, -16.4, 2.1, 0.88],
    [-33.0, -13.2, 4.0, 1.12],
    [-30.5, -2.5, 1.5, 0.94],
    [-19.5, -17.5, 3.6, 1.05],
    [-11.2, -23.0, 5.0, 0.96],
  ];
  for (const part of extractStaticParts(saplingLod0.scene)) {
    disposableGeos.push(part.geometry);
    const im = new InstancedMesh(part.geometry, part.material, saplingPositions.length);
    im.name = `ForestSaplings_${part.material.name}`;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < saplingPositions.length; i++) {
      const [sx, sz, yaw, sc] = saplingPositions[i]!;
      dummyObj.position.set(sx, terrain.heightAt(sx, sz), sz);
      dummyObj.rotation.set(0, yaw, 0);
      dummyObj.scale.setScalar(sc);
      dummyObj.updateMatrix();
      im.setMatrixAt(i, dummyObj.matrix);
      contactBatch.addDisc(sx, sz, 0.85 * sc, 0.52, 0.25);
    }
    im.instanceMatrix.needsUpdate = true;
    markStaticInstances(im);
    scene.add(im);
  }

  // Ring the enclosed lake shoreline with organic clumps of reeds & cattails (1 draw call!)
  const reedMatrices: Matrix4[] = [];
  const lk = terrain.config.lake;
  for (let i = 0; i < 42; i++) {
    const ang = (i / 42) * Math.PI * 2 + (i % 3) * 0.04;
    // Leave a clean sandy water-drawing clearing on the NW shore facing the village path
    if (ang > 3.55 && ang < 4.15) continue;
    // Binary search radial distance to find the exact shallow shore (heightAt ~ 0.03 m)
    let lo = 0.75;
    let hi = 1.25;
    for (let it = 0; it < 8; it++) {
      const mid = (lo + hi) * 0.5;
      const rx = lk.centerX + Math.cos(ang) * lk.radiusXM * mid;
      const rz = lk.centerZ + Math.sin(ang) * lk.radiusZM * mid;
      if (terrain.heightAt(rx, rz) < 0.02) lo = mid;
      else hi = mid;
    }
    const rFinal = (lo + hi) * 0.5 + ((i % 2 === 0 ? -0.02 : 0.02));
    const rx = lk.centerX + Math.cos(ang) * lk.radiusXM * rFinal;
    const rz = lk.centerZ + Math.sin(ang) * lk.radiusZM * rFinal;
    const ry = terrain.heightAt(rx, rz);
    dummyObj.position.set(rx, ry - 0.04, rz);
    dummyObj.rotation.set(0, ang + (i * 1.37), 0);
    const sc = 0.85 + (i % 4) * 0.14;
    dummyObj.scale.set(sc, sc * (0.9 + (i % 3) * 0.14), sc);
    dummyObj.updateMatrix();
    reedMatrices.push(dummyObj.matrix.clone());
  }
  for (const part of extractStaticParts(reedsLod0.scene)) {
    disposableGeos.push(part.geometry);
    const im = new InstancedMesh(part.geometry, part.material, Math.max(1, reedMatrices.length));
    im.name = 'LakeShoreReeds';
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < reedMatrices.length; i++) {
      im.setMatrixAt(i, reedMatrices[i]!);
    }
    im.instanceMatrix.needsUpdate = true;
    markStaticInstances(im);
    scene.add(im);
  }

  // Photogrammetry barrels clustered organically beside cottages, bakery, keep & woodcutter
  const barrelSpecs: readonly (readonly [number, number, number, number])[] = [
    [-2.0, -6.5, 0.4, 1.0],
    [-2.75, -6.9, 1.85, 0.96],
    [-2.15, -7.4, 3.1, 1.03],
    [5.2, 4.1, 0.9, 1.0],
    [5.9, 4.4, 2.4, 0.95],
    [-9.2, -11.4, 1.1, 1.02],
    [-8.5, -11.8, 3.9, 0.94],
    [-24.2, -6.2, 0.5, 1.04],
    [-14.8, 14.2, 2.2, 0.98],
    [13.4, -5.8, 4.1, 0.96],
  ];
  for (let i = 0; i < barrelSpecs.length; i++) {
    const [bx, bz, yaw, sc] = barrelSpecs[i]!;
    spawnActor('prop', `Barrel_${i}`, barrelTemplate, PROP_LOD_THRESHOLDS, bx, bz, yaw, sc);
    contactBatch.addDisc(bx, bz, 0.56 * sc, 0.92, 0.4);
  }

  // ==================== 7. LIVING VILLAGERS + 2 OPPOSING REGIMENTS ====================
  const walkers: CitizenWalker[] = [];
  let unitCount = 0;

  // 5 walking peasants strolling along the village cobbled streets & farm tracks on the 60 Hz clock
  const patrolPaths: readonly { readonly pts: readonly (readonly [number, number])[]; readonly phase: number; readonly speed: number }[] = [
    { pts: [[-11.0, -8.0], [-4.5, -3.5], [3.0, -2.0], [12.0, -1.0], [18.5, -0.5]], phase: 0.12, speed: 1.25 },
    { pts: [[16.5, -1.2], [7.5, -1.8], [-1.0, -2.6], [-3.8, 5.2], [-4.2, 11.2]], phase: 0.44, speed: 1.18 },
    { pts: [[-5.0, 12.0], [-11.5, 15.0], [-16.8, 15.8], [-11.0, 7.5], [-3.2, -1.5]], phase: 0.76, speed: 1.22 },
    { pts: [[-9.0, -5.2], [-16.5, -6.4], [-22.5, -8.2], [-15.0, -5.8]], phase: 0.28, speed: 1.15 },
    { pts: [[6.5, -1.2], [10.8, 4.5], [12.8, 10.6], [9.5, 4.0]], phase: 0.61, speed: 1.12 },
  ];
  for (let i = 0; i < patrolPaths.length; i++) {
    const p = patrolPaths[i]!;
    const [x0, z0] = p.pts[0]!;
    const actor = spawnActor('unit', `Citizen_Walker_${i}`, citizenTemplate, UNIT_LOD_THRESHOLDS, x0, z0, 0, 1.0, {
      animSpec: { clipName: 'walk', phaseOffsetS: i * 0.37, speed: 0.92 },
    });
    walkers.push({ actor, waypoints: p.pts, speedMs: p.speed, progress: p.phase });
    unitCount++;
  }

  // 3 stationary working citizens (Bakery counter, Farm barn door, House North porch)
  const idleCitizens: readonly (readonly [number, number, number])[] = [
    [7.2, -0.3, -2.6],
    [-16.2, 14.5, 0.55],
    [0.2, -6.6, 0.25],
  ];
  for (let i = 0; i < idleCitizens.length; i++) {
    const [cx, cz, yaw] = idleCitizens[i]!;
    spawnActor('unit', `Citizen_Worker_${i}`, citizenTemplate, UNIT_LOD_THRESHOLDS, cx, cz, yaw, 1.0, {
      animSpec: { clipName: 'idle', phaseOffsetS: i * 0.85, speed: 0.95 },
    });
    contactBatch.addDisc(cx, cz, 0.52, 0.78, 0.25);
    unitCount++;
  }

  // 1 Village Gate Guard standing hero pose near House North / cobbled lane for crisp `unit` close-up!
  spawnActor('unit', 'Swordsman_Captain', swordsmanTemplate, UNIT_LOD_THRESHOLDS, 2.6, -4.6, -0.28, 1.0, {
    animSpec: { clipName: 'idle', phaseOffsetS: 0.2, speed: 0.9 },
  });
  contactBatch.addDisc(2.6, -4.6, 0.62, 0.85, 0.26);
  unitCount++;

  // Marchland Cobalt-Ochre Vanguard Regiment (2 x 6 disciplined close-order formation outside Eastern Gate, facing East)
  for (let rank = 0; rank < 2; rank++) {
    for (let file = 0; file < 6; file++) {
      const ux = 32.5 - rank * 1.65;
      const uz = -4.2 + file * 1.45;
      spawnActor('unit', `Marchland_Sword_${rank}_${file}`, swordsmanTemplate, UNIT_LOD_THRESHOLDS, ux, uz, Math.PI * 0.5, 1.0, {
        animSpec: { clipName: 'idle', phaseOffsetS: (rank * 6 + file) * 0.23, speed: 0.88 },
      });
      contactBatch.addDisc(ux, uz, 0.58, 0.82, 0.26);
      unitCount++;
    }
  }

  // Opposing Crimson Regiment (2 x 6 battle line across the eastern meadow facing West — zero extra textures!)
  for (let rank = 0; rank < 2; rank++) {
    for (let file = 0; file < 6; file++) {
      const ux = 43.2 + rank * 1.65;
      const uz = -4.2 + file * 1.45;
      spawnActor('unit', `Crimson_Sword_${rank}_${file}`, swordsmanTemplate, UNIT_LOD_THRESHOLDS, ux, uz, -Math.PI * 0.5, 1.0, {
        animSpec: { clipName: 'idle', phaseOffsetS: (rank * 6 + file) * 0.31 + 0.5, speed: 0.92 },
        materialOverride: crimsonSwordsmanMat,
      });
      contactBatch.addDisc(ux, uz, 0.58, 0.82, 0.26);
      unitCount++;
    }
  }

  // ==================== 8. CHIMNEY SMOKE, CALIBRATION RIG & TERRAIN CONTACT SHADOWS ====================
  const chimneySmoke: ChimneySmokeHandles = buildChimneySmoke(smokeEmitters, skyUniforms, quality === 'high' ? 8 : 5);
  scene.add(chimneySmoke.mesh);

  const calRig = buildCalibrationRig(scene, terrain);
  contactBatch.addRect(STAGE4_CALIBRATION_XZ[0], STAGE4_CALIBRATION_XZ[1], 11.4, 4.2, 0.0, 0.72, 0.55);

  const contactShadowsMesh = contactBatch.build(
    skyUniforms.uContactShadowGain,
    0.018,
    (x, z) => terrain.heightAt(x, z),
  );
  scene.add(contactShadowsMesh);
  disposableGeos.push(contactShadowsMesh.geometry as BufferGeometry);

  // ==================== 9. DETERMINISTIC 60 HZ UPDATE & LOD / GRASS FOCUS ====================
  let simTimeS = 0;
  const tmpPos = new Vector3();
  const tmpQuat = new Quaternion();
  const tmpScale = new Vector3();
  const tmpMat = new Matrix4();
  const upAxis = new Vector3(0, 1, 0);

  const updateWalkers = (dtS: number): void => {
    for (const w of walkers) {
      const pts = w.waypoints;
      const segs = pts.length;
      if (segs < 2) continue;
      let totalLen = 0;
      const segLens: number[] = [];
      for (let i = 0; i < segs; i++) {
        const [ax, az] = pts[i]!;
        const [bx, bz] = pts[(i + 1) % segs]!;
        const d = Math.hypot(bx - ax, bz - az);
        segLens.push(d);
        totalLen += d;
      }
      w.progress = (w.progress + (dtS * w.speedMs) / Math.max(1, totalLen)) % 1.0;
      let dist = w.progress * totalLen;
      let si = 0;
      while (si < segs - 1 && dist > segLens[si]!) {
        dist -= segLens[si]!;
        si++;
      }
      const [ax, az] = pts[si]!;
      const [bx, bz] = pts[(si + 1) % segs]!;
      const t = dist / Math.max(1e-4, segLens[si]!);
      const wx = ax + (bx - ax) * t;
      const wz = az + (bz - az) * t;
      const wy = terrain.heightAt(wx, wz);
      w.actor.root.position.set(wx, wy, wz);
      w.actor.root.rotation.y = Math.atan2(bx - ax, bz - az);
    }
  };

  // Place walkers cleanly on their starting waypoints at t = 0
  updateWalkers(0);

  const rebuildTreeBatch = (batch: TreeSpeciesBatch, cameraPos: Vector3): void => {
    const buckets: [TreePlacement[], TreePlacement[], TreePlacement[], TreePlacement[]] = [[], [], [], []];
    for (const p of batch.placements) {
      buckets[p.level]!.push(p);
    }

    for (let l = 0; l < 3; l++) {
      const list = buckets[l]!;
      const meshes = batch.lodBuckets[l]!;
      for (const im of meshes) {
        if (list.length === 0) {
          im.setMatrixAt(0, ZERO_MATRIX);
          im.count = 1;
        } else {
          for (let i = 0; i < list.length; i++) {
            im.setMatrixAt(i, list[i]!.matrix);
          }
          im.count = list.length;
        }
        im.instanceMatrix.needsUpdate = true;
      }
    }

    const impList = buckets[3]!;
    if (impList.length === 0) {
      batch.impostorMesh.setMatrixAt(0, ZERO_MATRIX);
      batch.impostorMesh.count = 1;
    } else {
      for (let i = 0; i < impList.length; i++) {
        const p = impList[i]!;
        const yaw = Math.atan2(cameraPos.x - p.x, cameraPos.z - p.z);
        tmpPos.set(p.x, p.y, p.z);
        tmpQuat.setFromAxisAngle(upAxis, yaw);
        tmpScale.setScalar(p.scale);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        batch.impostorMesh.setMatrixAt(i, tmpMat);
      }
      batch.impostorMesh.count = impList.length;
    }
    batch.impostorMesh.instanceMatrix.needsUpdate = true;
    batch.dirtyBuckets = false;
  };

  const update = (dtS: number, cameraPos: Vector3, cameraDir: Vector3, paused: boolean): void => {
    if (!paused && dtS > 0) {
      simTimeS += dtS;
      for (const m of mixers) m.update(dtS);
      for (const sail of rotatingSails) sail.rotation.z += dtS * 0.72;
      updateWalkers(dtS);
    }

    // Center R2 Bézier grass rings on the camera's ground focus point (works cleanly at both 0.45 m and RTS altitude!)
    let focusX = cameraPos.x;
    let focusZ = cameraPos.z;
    if (cameraDir.y < -0.05) {
      const tHit = Math.max(0, Math.min(72, (1.25 - cameraPos.y) / cameraDir.y));
      focusX = cameraPos.x + cameraDir.x * tHit;
      focusZ = cameraPos.z + cameraDir.z * tHit;
    } else {
      focusX = cameraPos.x + cameraDir.x * 14.0;
      focusZ = cameraPos.z + cameraDir.z * 14.0;
    }
    grass.update(focusX, focusZ, simTimeS);
    wheatField.uWindTime.value = simTimeS;
    chimneySmoke.update(simTimeS, cameraPos);

    // Update actor LODs & matte impostor billboards
    for (const actor of actors) {
      actor.root.getWorldPosition(tmpPos);
      const dist = tmpPos.distanceTo(cameraPos);
      const next = selectLodLevel(dist, actor.level, actor.thresholds);
      if (next !== actor.level) {
        actor.level = next;
        const [n0, n1, n2, imp] = actor.lodNodes;
        n0.visible = next === 0;
        n1.visible = next === 1;
        n2.visible = next === 2;
        if (imp) imp.visible = next === 3;
        if (actor.castFromLod0) {
          actor.shadowNode.visible = next !== 0;
        }
      }
      if (actor.billboardNode && actor.billboardNode.visible) {
        const dx = cameraPos.x - tmpPos.x;
        const dz = cameraPos.z - tmpPos.z;
        actor.billboardNode.rotation.y = Math.atan2(dx, dz) - actor.root.rotation.y;
      }
    }

    // Update batched instanced tree LODs & billboard rotations
    for (const batch of treeBatches) {
      let hasImpostors = false;
      for (const p of batch.placements) {
        const dist = Math.hypot(p.x - cameraPos.x, p.y - cameraPos.y, p.z - cameraPos.z);
        const next = selectLodLevel(dist, p.level, TREE_LOD_THRESHOLDS);
        if (next !== p.level) {
          p.level = next;
          batch.dirtyBuckets = true;
        }
        if (p.level === 3) hasImpostors = true;
      }
      if (batch.dirtyBuckets || hasImpostors) {
        rebuildTreeBatch(batch, cameraPos);
      }
    }
  };

  const getLodSummary = (): Record<string, number> => {
    const counts: Record<string, number> = { lod0: 0, lod1: 0, lod2: 0, impostor: 0 };
    for (const a of actors) {
      const k = a.level === 3 ? 'impostor' : `lod${a.level}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    for (const b of treeBatches) {
      for (const p of b.placements) {
        const k = p.level === 3 ? 'impostor' : `lod${p.level}`;
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    return counts;
  };

  const getSliceMetrics = () => ({
    grassBlades: grass.totalBlades,
    grassTriangles: grass.totalTriangles,
    treeCount: treeSpecs.length,
    buildingCount,
    unitCount,
    wallSegments: wallPlacements.length,
    reedClumps: reedMatrices.length,
    wheatClusters: wheatField.count,
  });

  const dispose = (): void => {
    terrainRender.dispose();
    lakeWater.dispose();
    grass.dispose();
    wheatField.dispose();
    chimneySmoke.dispose();
    calRig.dispose();
    surfaces.dispose();
    (contactShadowsMesh.material as Material).dispose();
    houseImpostorTex.dispose();
    oakImpostorTex.dispose();
    pineImpostorTex.dispose();
    birchImpostorTex.dispose();
    for (const b of treeBatches) b.impostorGeo.dispose();
    for (const m of impostorMaterials.values()) m.dispose();
    for (const m of disposableMats) m.dispose();
    for (const g of disposableGeos) g.dispose();
  };

  return {
    terrain,
    groundWorks,
    surfaces,
    manifest,
    grass,
    update,
    getLodSummary,
    getSliceMetrics,
    dispose,
  };
}
