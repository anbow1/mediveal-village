// Stage 6 Live Dynamic Simulation World Synchronizer (R1, R4, zero mid-play GPU pipelines!):
// Synchronizes newly constructed/upgrading/destroyed buildings, construction scaffolding,
// dynamic stone walls & auto-opening gates, felled trees -> stumps/saplings, and newly laid
// cobbled roads / building yards directly into GroundWorksMap + pre-allocated InstancedMeshes!
// Every InstancedMesh is added to the scene BEFORE renderer.warmUp() with count = 1, scale = 0
// so ZERO GPU pipelines are ever compiled during live gameplay.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Scene,
} from 'three/webgpu';
import { BUILDING_DEFS } from '../config.ts';
import { computeBuildingStripTransform } from '../sim/economy.ts';
import type { GroundWorksMap } from '../sim/groundWorks.ts';
import type { BuildingKind } from '../sim/maps.ts';
import type { TerrainField } from '../sim/terrain.ts';
import type { BuildingEntity, SimWorldState } from '../sim/types.ts';
import type { PlacementGhostPreview } from './combatFx.ts';
import type { MarchlandBuildingLevelKey } from './marchlandBuildings.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { markStaticInstances } from './instancing.ts';

export interface SimBuildingTemplate {
  readonly lod0: Object3D;
}

export interface TreeBatchHook {
  readonly species: 'oak' | 'pine' | 'birch';
  readonly setTreeVisible: (x: number, z: number, visible: boolean) => void;
}

export interface GateLeafHook {
  readonly x: number;
  readonly z: number;
  readonly leafL: Object3D | null;
  readonly leafR: Object3D | null;
}

export interface StaticBuildingHook {
  readonly x: number;
  readonly z: number;
  readonly isGate?: boolean;
  readonly setVisible: (visible: boolean) => void;
}

export interface SimRendererHandles {
  readonly sync: (state: SimWorldState, placementGhost?: PlacementGhostPreview | null) => void;
  readonly dispose: () => void;
}

const ZERO_MAT = new Matrix4().makeScale(0, 0, 0);
const TEMP_MAT = new Matrix4();
const TEMP_POS = new Vector3();
const TEMP_QUAT = new Quaternion();
const TEMP_SCALE = new Vector3();
const UP = new Vector3(0, 1, 0);

interface ExtractedPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

/** Unpacks quantized Meshopt integer attributes cleanly to Float32 so applyMatrix4 never overflows Int16 and vertex layouts match BldBatch_*. */
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

function extractPartsFromRoot(root: Object3D, overrideMat?: Material): ExtractedPart[] {
  root.updateMatrixWorld(true);
  const parts: ExtractedPart[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const rawMat = Array.isArray(o.material) ? o.material[0] : o.material;
    const mat = overrideMat ?? rawMat;
    if (!mat) return;
    const srcGeo = o.geometry as BufferGeometry;
    if (!srcGeo.getAttribute('position')) return;
    if (overrideMat && !srcGeo.getAttribute('uv')) return;
    const g = dequantizeGeometry(srcGeo);
    g.applyMatrix4(o.matrixWorld);
    parts.push({ geometry: g, material: mat });
  });
  return parts;
}

/** Deterministic lightweight RNG for organic vineyard leaf card placement. */
function makeVineRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Paints a 256×256 alpha-cutout vine leaf spray card (ported from FPS/marchland foliage.ts). */
function createVineLeafTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const rand = makeVineRng(41);
    const count = 280;
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * size * 0.45;
      const x = size * 0.5 + Math.cos(a) * r;
      const y = size * 0.5 + Math.sin(a) * r;
      const depth = i / count;
      const light = 0.48 + depth * 0.48 + (rand() - 0.5) * 0.14;
      const hue = (rand() - 0.5) * 0.08;
      const cr = Math.round(255 * Math.min(1, light * (1 + hue)));
      const cg = Math.round(255 * Math.min(1, light));
      const cb = Math.round(255 * Math.min(1, light * (1 - hue)));
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rand() * Math.PI * 2);
      // Palmate grapevine leaf silhouette (3 overlapping soft lobes)
      const rx = 6.5 + rand() * 5.5;
      const ry = 4.2 + rand() * 3.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.ellipse(rx * 0.35, -ry * 0.4, rx * 0.55, ry * 0.55, 0.5, 0, Math.PI * 2);
      ctx.ellipse(-rx * 0.35, -ry * 0.4, rx * 0.55, ry * 0.55, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Layer 1: Oak trellis posts, training wires, and gnarled woody vine trunks for 2 parallel 9.6 m vineyard rows. */
function buildVineTrellisPostsGeometry(): BufferGeometry {
  const geos: BufferGeometry[] = [];
  const pushBox = (w: number, h: number, d: number, x: number, y: number, z: number, r: number, g: number, b: number) => {
    const raw = new BoxGeometry(w, h, d);
    raw.translate(x, y, z);
    const box = raw.index ? raw.toNonIndexed() : raw;
    const cnt = box.getAttribute('position').count;
    const cols = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      cols[i * 3] = r;
      cols[i * 3 + 1] = g;
      cols[i * 3 + 2] = b;
    }
    box.setAttribute('color', new Float32BufferAttribute(cols, 3));
    geos.push(box);
  };

  for (const rz of [-0.75, 0.75]) {
    // 5 slim oak trellis stakes along the 9.6 m row
    for (const px of [-4.6, -2.3, 0.0, 2.3, 4.6]) {
      pushBox(0.09, 1.42, 0.09, px, 0.71, rz, 0.37, 0.28, 0.21);
    }
    // Two horizontal training wires
    pushBox(9.3, 0.025, 0.025, 0.0, 1.15, rz, 0.32, 0.27, 0.22);
    pushBox(9.3, 0.022, 0.022, 0.0, 0.72, rz, 0.32, 0.27, 0.22);
    // Woody vine trunks rising between stakes
    for (const vx of [-3.45, -1.15, 1.15, 3.45]) {
      pushBox(0.11, 0.56, 0.11, vx, 0.28, rz, 0.33, 0.23, 0.16);
      pushBox(0.07, 0.32, 0.07, vx - 0.14, 0.62, rz + 0.03, 0.35, 0.25, 0.17);
      pushBox(0.07, 0.32, 0.07, vx + 0.14, 0.62, rz - 0.03, 0.35, 0.25, 0.17);
    }
  }
  const merged = mergeGeometries(geos, false) ?? new BoxGeometry(1, 1, 1);
  for (const g of geos) g.dispose();
  return merged;
}

/** Layer 2: Organic tilted vine leaf cards trained along the 2 trellis wires (ported from FPS/marchland vineRowGeometry). */
function buildVineLeafRowGeometry(): BufferGeometry {
  const rand = makeVineRng(137);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const lengthM = 9.2;
  const steps = 18;
  for (const rz of [-0.75, 0.75]) {
    for (let i = 0; i < steps; i++) {
      const x = -lengthM * 0.5 + (i + 0.5) * (lengthM / steps) + (rand() - 0.5) * 0.18;
      for (const side of [-1, 1, 0]) {
        const y = side === 0 ? 1.12 + (rand() - 0.5) * 0.08 : 0.62 + rand() * 0.38;
        const s = side === 0 ? 0.78 : 0.92;
        const nx = (rand() - 0.5) * 0.55;
        const ny = side === 0 ? 1 : 0.52;
        const nz = side === 0 ? 0 : side;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const base = pos.length / 3;
        const ax: readonly [number, number, number] = [1, 0, 0];
        const bx: readonly [number, number, number] = side === 0 ? [0, 0, 1] : [0, 1, -side * 0.45];
        const cz = rz + side * 0.19;
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const) {
          pos.push(
            x + (ax[0] * a + bx[0] * b) * s * 0.5,
            y + (ax[1] * a + bx[1] * b) * s * 0.5,
            cz + (ax[2] * a + bx[2] * b) * s * 0.5,
          );
          nor.push(nx / nl, ny / nl, nz / nl);
          uv.push((a + 1) * 0.5, (b + 1) * 0.5);
          const shade = 0.52 + 0.45 * Math.min(1, y / 1.15);
          col.push(shade, shade, shade);
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** Layer 3: Sculpted hanging grape bunches under the foliage canopy (tinted per-instance from young green to deep purple). */
function buildVineGrapeClustersGeometry(): BufferGeometry {
  const geos: BufferGeometry[] = [];
  for (const rz of [-0.75, 0.75]) {
    for (let i = 0; i < 12; i++) {
      const gx = -4.2 + i * 0.76;
      const side = i % 2 === 0 ? 1 : -1;
      const gz = rz + side * 0.22;
      // 3 tapered berry-cluster lobules forming a recognizable hanging conical grape bunch!
      const parts: readonly (readonly [number, number, number, number])[] = [
        [0, 0.66, 0, 0.085],
        [-0.045, 0.61, 0.025, 0.072],
        [0.045, 0.60, -0.02, 0.07],
        [0, 0.52, 0.01, 0.06],
      ];
      for (const [ox, oy, oz, rad] of parts) {
        const sph = new IcosahedronGeometry(rad, 0);
        sph.scale(0.95, 1.25, 0.95);
        sph.translate(gx + ox, oy, gz + oz);
        const nonIdx = sph.index ? sph.toNonIndexed() : sph;
        geos.push(nonIdx);
      }
    }
  }
  const merged = mergeGeometries(geos, false) ?? new BoxGeometry(0.1, 0.1, 0.1);
  for (const g of geos) g.dispose();
  return merged;
}

function createPreWarmedPool(
  scene: Scene,
  name: string,
  parts: readonly ExtractedPart[],
  capacity: number,
  castShadow = true,
): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const im = new InstancedMesh(p.geometry, p.material, capacity);
    im.name = `${name}_p${i}`;
    im.castShadow = castShadow;
    im.receiveShadow = true;
    im.frustumCulled = false;
    markStaticInstances(im);
    im.setMatrixAt(0, ZERO_MAT);
    im.count = 1;
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    out.push(im);
  }
  return out;
}

function commitPool(meshes: readonly InstancedMesh[], count: number): void {
  const uploadCount = Math.max(1, count);
  for (const m of meshes) {
    if (count === 0) {
      m.setMatrixAt(0, ZERO_MAT);
      m.count = 1;
      m.visible = false;
    } else {
      m.visible = true;
      m.count = count;
    }
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.addUpdateRange(0, uploadCount * 16);
    m.instanceMatrix.needsUpdate = true;
  }
}

/** Builds a unit rubble-stone plinth (1 x 1 x 1 spanning y = -1..0) compatible with surfaces.buildingMaterial (layer 8). */
function buildPlinthGeometry(): BufferGeometry {
  const raw = new BoxGeometry(1, 1, 1);
  raw.translate(0, -0.5, 0);
  const g = raw.index ? raw.toNonIndexed() : raw;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const cnt = pos.count;
  const uv0 = new Float32Array(cnt * 2);
  const uv1 = new Float32Array(cnt * 2);
  const col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) {
      uv0[i * 2] = x * 2.2;
      uv0[i * 2 + 1] = z * 2.2;
    } else if (nx >= nz) {
      uv0[i * 2] = z * 2.2;
      uv0[i * 2 + 1] = y * 1.1;
    } else {
      uv0[i * 2] = x * 2.2;
      uv0[i * 2 + 1] = y * 1.1;
    }
    uv1[i * 2] = 8 / 15.0; // Rubble stone layer
    uv1[i * 2 + 1] = 1.0; // non-iron
    col[i * 3] = 0.78;
    col[i * 3 + 1] = 0.75;
    col[i * 3 + 2] = 0.69;
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv0, 2));
  g.setAttribute('uv1', new Float32BufferAttribute(uv1, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

export function buildSimWorldRenderer(opts: {
  readonly scene: Scene;
  readonly terrain: TerrainField;
  readonly groundWorks: GroundWorksMap;
  readonly syncGroundWorks: () => void;
  readonly syncDynamicFarms?: (buildings: readonly BuildingEntity[]) => void;
  readonly buildingMaterial: Material;
  readonly siteBuildingMaterial?: Material;
  readonly buildingTemplates: ReadonlyMap<BuildingKind, SimBuildingTemplate>;
  readonly marchlandBuildingLevels?: ReadonlyMap<MarchlandBuildingLevelKey, BufferGeometry>;
  readonly wallTemplate: SimBuildingTemplate | null;
  readonly stumpRoot: Object3D;
  readonly saplingRoot: Object3D;
  readonly staticBuildings: readonly StaticBuildingHook[];
  readonly staticGates: readonly GateLeafHook[];
  readonly treeHooks: readonly TreeBatchHook[];
}): SimRendererHandles {
  const {
    scene,
    terrain,
    groundWorks,
    syncGroundWorks,
    syncDynamicFarms,
    buildingMaterial,
    siteBuildingMaterial,
    buildingTemplates,
    marchlandBuildingLevels,
    wallTemplate,
    stumpRoot,
    saplingRoot,
    staticBuildings,
    staticGates,
    treeHooks,
  } = opts;

  const disposableGeos: BufferGeometry[] = [];
  const allMeshes: InstancedMesh[] = [];
  const siteSlots: Mesh[] = [];

  // 1. Pre-warmed dynamic building pools for every loaded BuildingKind (0 new pipelines in play!)
  const dynamicBuildingPools = new Map<BuildingKind, { meshes: InstancedMesh[]; cap: number }>();
  for (const [kind, tpl] of buildingTemplates) {
    const parts = extractPartsFromRoot(tpl.lod0, buildingMaterial);
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      disposableGeos.push(p.geometry);
    }
    const cap =
      kind === 'house_l1' || kind === 'farm_l1' || kind === 'watchtower_l1' || kind === 'camp_tent_l1' || kind === 'ruin_house'
        ? 48
        : 20;
    const meshes = createPreWarmedPool(scene, `DynBld_${kind}`, parts, cap, true);
    allMeshes.push(...meshes);
    dynamicBuildingPools.set(kind, { meshes, cap });
  }

  // 1b. Pre-warmed high-detail L1/L2/L3 architectural pools from FPS/marchland (shared buildingMaterial -> 0 extra shaders!)
  const marchlandLevelPools = new Map<MarchlandBuildingLevelKey, { mesh: InstancedMesh; cap: number }>();
  if (marchlandBuildingLevels) {
    for (const [key, geo] of marchlandBuildingLevels) {
      geo.computeBoundingBox();
      disposableGeos.push(geo);
      const cap = key.startsWith('house_') || key.startsWith('farm_') || key.startsWith('watchtower_') ? 48 : 20;
      const im = new InstancedMesh(geo, buildingMaterial, cap);
      im.name = `MarchlandBld_${key}`;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      markStaticInstances(im);
      im.setMatrixAt(0, ZERO_MAT);
      im.count = 1;
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      allMeshes.push(im);
      marchlandLevelPools.set(key, { mesh: im, cap });
    }
  }

  // 1c. Pre-warmed rubble-stone plinths under buildings on slopes (1 draw call, shared buildingMaterial!)
  const plinthGeo = buildPlinthGeometry();
  disposableGeos.push(plinthGeo);
  const dynPlinthMesh = new InstancedMesh(plinthGeo, buildingMaterial, 160);
  dynPlinthMesh.name = 'DynBuildingPlinths';
  dynPlinthMesh.castShadow = true;
  dynPlinthMesh.receiveShadow = true;
  dynPlinthMesh.frustumCulled = false;
  markStaticInstances(dynPlinthMesh);
  dynPlinthMesh.setMatrixAt(0, ZERO_MAT);
  dynPlinthMesh.count = 1;
  dynPlinthMesh.instanceMatrix.needsUpdate = true;
  scene.add(dynPlinthMesh);
  allMeshes.push(dynPlinthMesh);

  // 1d. Pre-warmed course-by-course construction site slots (zero mid-play shader compiles!)
  if (siteBuildingMaterial) {
    for (let i = 0; i < 16; i++) {
      const m = new Mesh(plinthGeo, siteBuildingMaterial);
      m.name = `ConstructionSiteSlot_${i}`;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      // Keep slot 0 visible at scale 0 before warmUp() so siteBuildingMaterial compiles during load!
      m.visible = i === 0;
      m.scale.set(0, 0, 0);
      m.userData['cutY'] = 1e6;
      scene.add(m);
      siteSlots.push(m);
    }
  }

  // 2. Pre-warmed dynamic walls (capacity 520 covers Mission 5's 360 fortress wall segments + player walls!), stumps & saplings
  let dynWallMeshes: InstancedMesh[] = [];
  if (wallTemplate) {
    const wParts = extractPartsFromRoot(wallTemplate.lod0, buildingMaterial);
    for (const p of wParts) disposableGeos.push(p.geometry);
    dynWallMeshes = createPreWarmedPool(scene, 'DynWalls', wParts, 520, true);
    allMeshes.push(...dynWallMeshes);
  }

  const stumpParts = extractPartsFromRoot(stumpRoot);
  for (const p of stumpParts) disposableGeos.push(p.geometry);
  const dynStumpMeshes = createPreWarmedPool(scene, 'DynStumps', stumpParts, 160, false);
  allMeshes.push(...dynStumpMeshes);

  const saplingParts = extractPartsFromRoot(saplingRoot);
  for (const p of saplingParts) disposableGeos.push(p.geometry);
  const dynSaplingMeshes = createPreWarmedPool(scene, 'DynSaplings', saplingParts, 160, false);
  allMeshes.push(...dynSaplingMeshes);

  // 3. Open 4-corner oak timber scaffolding frame around active construction & upgrade sites
  const beamGeos: BufferGeometry[] = [];
  const addBeam = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = new BoxGeometry(w, h, d);
    b.translate(x, y, z);
    beamGeos.push(b);
  };
  const postW = 0.045;
  addBeam(postW, 1.0, postW, -0.5, 0.5, -0.5);
  addBeam(postW, 1.0, postW, 0.5, 0.5, -0.5);
  addBeam(postW, 1.0, postW, -0.5, 0.5, 0.5);
  addBeam(postW, 1.0, postW, 0.5, 0.5, 0.5);
  addBeam(1.04, postW * 0.7, postW * 0.7, 0, 0.65, -0.5);
  addBeam(1.04, postW * 0.7, postW * 0.7, 0, 0.65, 0.5);
  addBeam(postW * 0.7, postW * 0.7, 1.04, -0.5, 0.65, 0);
  addBeam(postW * 0.7, postW * 0.7, 1.04, 0.5, 0.65, 0);
  const scafGeo = mergeGeometries(beamGeos, false) ?? new BoxGeometry(1, 1, 1);
  for (const bg of beamGeos) bg.dispose();
  disposableGeos.push(scafGeo);
  const scafMat = new MeshStandardNodeMaterial({
    color: 0x7c5a35,
    roughness: 0.92,
    metalness: 0.0,
  });
  scafMat.name = 'MarchlandScaffoldMat';
  const dynScafMesh = new InstancedMesh(scafGeo, scafMat, 24);
  dynScafMesh.name = 'DynScaffold';
  dynScafMesh.frustumCulled = false;
  markStaticInstances(dynScafMesh);
  dynScafMesh.setMatrixAt(0, ZERO_MAT);
  dynScafMesh.count = 1;
  dynScafMesh.instanceMatrix.needsUpdate = true;
  scene.add(dynScafMesh);
  allMeshes.push(dynScafMesh);

  // 4. Pre-warmed 3-Layer Realistic Vineyards (ported from FPS/marchland vinesView.ts: oak trellises, alpha leaf cards & ripening grape bunches!)
  const vinePostGeo = buildVineTrellisPostsGeometry();
  const vineLeafGeo = buildVineLeafRowGeometry();
  const vineGrapeGeo = buildVineGrapeClustersGeometry();
  disposableGeos.push(vinePostGeo, vineLeafGeo, vineGrapeGeo);

  const vinePostMat = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
  });
  vinePostMat.name = 'MarchlandVinePostsMat';

  const vineLeafTex = createVineLeafTexture();
  const vineLeafMat = new MeshStandardNodeMaterial({
    name: 'MarchlandVineLeavesMat',
    map: vineLeafTex,
    alphaTest: 0.42,
    side: DoubleSide,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
  });

  const vineGrapeMat = new MeshStandardNodeMaterial({
    name: 'MarchlandVineGrapesMat',
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0.04,
  });

  const VINE_CAP = 128;
  const dynVinePostMesh = new InstancedMesh(vinePostGeo, vinePostMat, VINE_CAP);
  dynVinePostMesh.name = 'DynVineyardPosts';
  const dynVineLeafMesh = new InstancedMesh(vineLeafGeo, vineLeafMat, VINE_CAP);
  dynVineLeafMesh.name = 'DynVineyardLeaves';
  const dynVineGrapeMesh = new InstancedMesh(vineGrapeGeo, vineGrapeMat, VINE_CAP);
  dynVineGrapeMesh.name = 'DynVineyardGrapes';

  const vineTint = new Color();
  const leafGreen = new Color(0x4b7d26);
  const leafAutumn = new Color(0xa59234);
  for (const vm of [dynVinePostMesh, dynVineLeafMesh, dynVineGrapeMesh]) {
    vm.castShadow = vm !== dynVineGrapeMesh;
    vm.receiveShadow = true;
    vm.frustumCulled = false;
    markStaticInstances(vm);
    vm.setMatrixAt(0, ZERO_MAT);
    vm.setColorAt(0, vineTint.setRGB(1, 1, 1));
    vm.count = 1;
    vm.instanceMatrix.needsUpdate = true;
    if (vm.instanceColor) vm.instanceColor.needsUpdate = true;
    scene.add(vm);
    allMeshes.push(vm);
  }

  const treeHookBySpecies = new Map<string, TreeBatchHook>();
  for (const th of treeHooks) treeHookBySpecies.set(th.species, th);

  // Track which static animated Stage 5 buildings (windmill, gate) exist at boot so we never double-render them
  const matchStaticBuilding = (x: number, z: number): StaticBuildingHook | null => {
    for (const sb of staticBuildings) {
      if (!sb.isGate && Math.abs(sb.x - x) < 1.2 && Math.abs(sb.z - z) < 1.2) return sb;
    }
    return null;
  };

  const stampedBuildingIds = new Set<number>();
  const stampedStripCounts = new Map<number, number>();
  const hiddenTreeIds = new Set<number>();
  let stampedRoadCount = 0;
  let lastRevision = -1;
  let lastConstructingHash = -1;
  let lastGhostHash = -1;

  const sync = (state: SimWorldState, placementGhost?: PlacementGhostPreview | null): void => {
    // Animate static gate oak leaves every frame smoothly from `gate.openFraction` (0..1)!
    for (const g of state.gates) {
      for (const sg of staticGates) {
        if (Math.abs(sg.x - g.x) < 2.2 && Math.abs(sg.z - g.z) < 2.2) {
          const swing = g.destroyed ? 1.48 : g.openFraction * 1.32;
          if (sg.leafL) sg.leafL.rotation.y = -swing;
          if (sg.leafR) sg.leafR.rotation.y = swing;
        }
      }
    }

    // Check if any building is currently constructing/upgrading, if farm/vineyard crops grew, or if placementGhost moved!
    let constructingHash = 0;
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;
      if (b.buildProgress < 1) {
        constructingHash += Math.round(b.buildProgress * 100) * (b.id & 31);
      }
      if (b.upgradingToLevel !== null) {
        constructingHash += (Math.round(b.upgradeTimerS * 10) + 500) * (b.id & 31);
      }
      if ((b.type === 'farm' || b.type === 'vineyard') && b.buildProgress >= 1) {
        for (let si = 0; si < b.strips.length; si++) {
          const st = b.strips[si]!;
          const pCode = st.phase === 'ready' ? 4 : st.phase === 'growing' ? 3 : st.phase === 'sowing' ? 2 : 1;
          constructingHash += (pCode * 37 + Math.round(st.growth01 * 20)) * ((b.id + si) & 31);
        }
      }
    }
    const ghostHash =
      placementGhost && placementGhost.active && (placementGhost.mode === 'building' || placementGhost.mode === 'gate')
        ? Math.round(placementGhost.x * 10) * 73856093 ^
          Math.round(placementGhost.z * 10) * 19349663 ^
          Math.round(placementGhost.yawRad * 100)
        : 0;

    if (
      state.visualRevision === lastRevision &&
      constructingHash === lastConstructingHash &&
      ghostHash === lastGhostHash
    ) {
      return;
    }
    lastRevision = state.visualRevision;
    lastConstructingHash = constructingHash;
    lastGhostHash = ghostHash;

    // 1. Stamp newly added roads, newly placed buildings, and Farm/Vineyard ploughed strips into GroundWorksMap!
    let gwDirty = false;
    if (state.roads.length > stampedRoadCount) {
      for (let i = stampedRoadCount; i < state.roads.length; i++) {
        const rd = state.roads[i]!;
        groundWorks.stampRoadPolyline([[rd.x0, rd.z0], [rd.x1, rd.z1]], rd.widthM * 0.42, 1.2);
      }
      stampedRoadCount = state.roads.length;
      gwDirty = true;
    }
    for (const b of state.buildings) {
      if (b.hp > 0 && !stampedBuildingIds.has(b.id)) {
        stampedBuildingIds.add(b.id);
        const r = BUILDING_DEFS[b.type].radiusM * 1.15;
        groundWorks.stampYard(b.x, b.z, r, r, 0.88);
        gwDirty = true;
      }
      if (b.hp > 0 && b.buildProgress >= 1 && (b.type === 'farm' || b.type === 'vineyard')) {
        const prevStrips = stampedStripCounts.get(b.id) ?? 0;
        if (b.strips.length > prevStrips) {
          for (let si = prevStrips; si < b.strips.length; si++) {
            const st = computeBuildingStripTransform(b, si);
            groundWorks.stampFarmStrip(st.cx, st.cz, st.lenM, st.widM, st.yawRad);
          }
          stampedStripCounts.set(b.id, b.strips.length);
          gwDirty = true;
        }
      }
    }
    if (gwDirty) {
      syncGroundWorks();
    }

    // 2. Sync static animated building/gate visibility (hide if destroyed, absent, or currently upgrading/scaled!)
    for (const sb of staticBuildings) {
      if (sb.isGate) {
        const aliveGate = state.gates.some(
          (g) => !g.destroyed && g.hp > 0 && Math.abs(g.x - sb.x) < 2.2 && Math.abs(g.z - sb.z) < 2.2,
        );
        sb.setVisible(aliveGate);
      } else {
        const aliveStatic = state.buildings.some(
          (b) =>
            b.hp > 0 &&
            b.buildProgress >= 1 &&
            b.upgradingToLevel === null &&
            b.level === 1 &&
            b.type !== 'ruin' &&
            Math.abs(b.x - sb.x) < 1.2 &&
            Math.abs(b.z - sb.z) < 1.2,
        );
        sb.setVisible(aliveStatic);
      }
    }

    // 3. Pack all non-static buildings (plus upgraded/constructing static buildings & live placement ghost!) into pre-warmed pools
    const poolCounts = new Map<BuildingKind, number>();
    for (const k of dynamicBuildingPools.keys()) poolCounts.set(k, 0);
    const marchlandCounts = new Map<MarchlandBuildingLevelKey, number>();
    for (const k of marchlandLevelPools.keys()) marchlandCounts.set(k, 0);
    let scafCount = 0;
    let vinePostCount = 0;
    let vineLeafCount = 0;
    let vineGrapeCount = 0;
    let plinthCount = 0;
    let siteSlotIdx = 0;

    for (const b of state.buildings) {
      if (b.hp <= 0) continue;

      const y = terrain.heightAt(b.x, b.z);

      // Rubble-stone plinth under any building sitting on sloped ground so corners never float!
      if (plinthCount < 160 && b.type !== 'fisher') {
        const halfSpan = Math.max(2.6, BUILDING_DEFS[b.type].radiusM * 0.86);
        const cb = Math.cos(b.yawRad);
        const sb = Math.sin(b.yawRad);
        let minCornerH = y;
        for (const sx of [-halfSpan, halfSpan]) {
          for (const sz of [-halfSpan, halfSpan]) {
            const wx = b.x + sx * cb + sz * sb;
            const wz = b.z - sx * sb + sz * cb;
            const ch = terrain.heightAt(wx, wz);
            if (ch < minCornerH) minCornerH = ch;
          }
        }
        const drop = y - minCornerH;
        if (drop > 0.10) {
          const span = halfSpan * 2.05;
          TEMP_POS.set(b.x, y + 0.08, b.z);
          TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
          TEMP_SCALE.set(span, drop + 0.45, span);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          dynPlinthMesh.setMatrixAt(plinthCount++, TEMP_MAT);
        }
      }

      // Render 3-layer realistic staked grapevine trellises, ripening leaf canopy cards & hanging grape bunches!
      if (b.type === 'vineyard' && b.buildProgress >= 1) {
        for (let si = 0; si < b.strips.length && vinePostCount < VINE_CAP; si++) {
          const st = b.strips[si]!;
          const tr = computeBuildingStripTransform(b, si);
          const vy = terrain.heightAt(tr.cx, tr.cz);
          const ripe = st.phase === 'ready';
          const growth = ripe ? 1 : st.phase === 'growing' ? st.growth01 : st.phase === 'sowing' ? 0.15 : 0.05;
          const canopyH = 0.52 + 0.50 * Math.min(1, growth * 1.45);
          const bunch = ripe ? 1 : Math.max(0, (growth - 0.3) / 0.7);

          TEMP_POS.set(tr.cx, vy, tr.cz);
          TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
          TEMP_SCALE.set(1.0, 1.0, 1.0);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          dynVinePostMesh.setMatrixAt(vinePostCount, TEMP_MAT);
          dynVinePostMesh.setColorAt(vinePostCount, vineTint.setRGB(1, 1, 1));
          vinePostCount++;

          TEMP_SCALE.set(1.0, canopyH, 1.0);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          dynVineLeafMesh.setMatrixAt(vineLeafCount, TEMP_MAT);
          dynVineLeafMesh.setColorAt(vineLeafCount, vineTint.copy(leafGreen).lerp(leafAutumn, bunch * 0.28));
          vineLeafCount++;

          if (bunch > 0.05 && vineGrapeCount < VINE_CAP) {
            const gScale = 0.45 + 0.65 * bunch;
            TEMP_SCALE.set(1.0, gScale * canopyH, gScale);
            TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
            dynVineGrapeMesh.setMatrixAt(vineGrapeCount, TEMP_MAT);
            // Green young berries darken cleanly into deep vintage purple!
            dynVineGrapeMesh.setColorAt(
              vineGrapeCount,
              vineTint.setRGB(0.35 - 0.18 * bunch, 0.45 - 0.37 * bunch, 0.12 + 0.19 * bunch),
            );
            vineGrapeCount++;
          }
        }
      }

      // If an un-upgraded L1 static animated building (e.g. windmill) sits here and isn't upgrading, don't double-draw
      const staticMatch = matchStaticBuilding(b.x, b.z);
      if (staticMatch && b.buildProgress >= 1 && b.upgradingToLevel === null && b.level === 1 && b.type !== 'ruin') {
        continue;
      }

      const scaleY = b.buildProgress < 1 ? 0.22 + 0.78 * b.buildProgress : 1.0;
      const lvl = (b.level >= 3 ? 3 : b.level === 2 ? 2 : 1) as 1 | 2 | 3;
      const mKey = `${b.type}_${lvl}` as MarchlandBuildingLevelKey;
      const mPool = !b.isFortressDonzon ? marchlandLevelPools.get(mKey) : undefined;

      // Course-by-course shader construction clipping for active construction sites!
      if (b.buildProgress < 1 && siteSlotIdx < siteSlots.length) {
        const kind: BuildingKind = b.isFortressDonzon ? 'fortress_donzon' : BUILDING_DEFS[b.type].modelKind;
        const fallbackPool = dynamicBuildingPools.get(kind);
        const siteGeo = mPool ? mPool.mesh.geometry : fallbackPool?.meshes[0]?.geometry;
        if (siteGeo) {
          const slot = siteSlots[siteSlotIdx++]!;
          slot.geometry = siteGeo;
          slot.position.set(b.x, y, b.z);
          slot.rotation.set(0, b.yawRad, 0);
          const levelScale = mPool ? 1.0 : b.level === 3 ? 1.18 : b.level === 2 ? 1.09 : 1.0;
          slot.scale.set(levelScale, levelScale, levelScale);
          const topH = (siteGeo.boundingBox?.max.y ?? 6.5) * levelScale;
          const footingM = 0.35;
          const cutH = b.buildProgress < 0.12
            ? (b.buildProgress / 0.12) * footingM
            : footingM + ((b.buildProgress - 0.12) / 0.88) * Math.max(2.0, topH - footingM);
          slot.userData['cutY'] = y + cutH;
          slot.visible = true;
        }
      } else if (mPool) {
        const idx = marchlandCounts.get(mKey) ?? 0;
        if (idx < mPool.cap) {
          TEMP_POS.set(b.x, y, b.z);
          TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
          TEMP_SCALE.set(1.0, scaleY, 1.0);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          mPool.mesh.setMatrixAt(idx, TEMP_MAT);
          marchlandCounts.set(mKey, idx + 1);
        }
      } else {
        const kind: BuildingKind = b.isFortressDonzon ? 'fortress_donzon' : BUILDING_DEFS[b.type].modelKind;
        const pool = dynamicBuildingPools.get(kind);
        if (!pool) continue;
        const idx = poolCounts.get(kind) ?? 0;
        if (idx >= pool.cap) continue;
        const levelScale = b.level === 3 ? 1.18 : b.level === 2 ? 1.09 : 1.0;
        TEMP_POS.set(b.x, y, b.z);
        TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
        TEMP_SCALE.set(levelScale, scaleY * levelScale, levelScale);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        for (const m of pool.meshes) m.setMatrixAt(idx, TEMP_MAT);
        poolCounts.set(kind, idx + 1);
      }

      if ((b.buildProgress < 1 || b.upgradingToLevel !== null) && scafCount < 24) {
        const scafLevelMul = b.level === 3 ? 1.15 : b.level === 2 ? 1.07 : 1.0;
        const r = BUILDING_DEFS[b.type].radiusM * 1.45 * scafLevelMul;
        const prog = b.buildProgress < 1 ? b.buildProgress : 0.75;
        TEMP_POS.set(b.x, y, b.z);
        TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
        TEMP_SCALE.set(r, 3.6 + 2.4 * prog, r);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        dynScafMesh.setMatrixAt(scafCount++, TEMP_MAT);
      }
    }

    for (let i = siteSlotIdx; i < siteSlots.length; i++) {
      siteSlots[i]!.visible = false;
    }

    // Dynamic player-built gates (drawn via DynBld_gate_l1 pool if not matching static gate)
    const gatePool = dynamicBuildingPools.get('gate_l1');
    if (gatePool) {
      for (const g of state.gates) {
        if (g.destroyed || g.hp <= 0) continue;
        const isStatic = staticGates.some((sg) => Math.abs(sg.x - g.x) < 2.2 && Math.abs(sg.z - g.z) < 2.2);
        if (isStatic) continue;
        const idx = poolCounts.get('gate_l1') ?? 0;
        if (idx >= gatePool.cap) break;
        const y = terrain.heightAt(g.x, g.z);
        TEMP_POS.set(g.x, y, g.z);
        TEMP_QUAT.setFromAxisAngle(UP, g.yawRad);
        TEMP_SCALE.set(1, 1, 1);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        for (const m of gatePool.meshes) m.setMatrixAt(idx, TEMP_MAT);
        poolCounts.set('gate_l1', idx + 1);
      }
    }

    // Live 3D building / gate placement preview right under the player's cursor rotating live with R!
    if (placementGhost && placementGhost.active && (placementGhost.mode === 'building' || placementGhost.mode === 'gate')) {
      const ghostType = placementGhost.buildingType ?? 'house';
      const mGhostKey = `${ghostType}_1` as MarchlandBuildingLevelKey;
      const mGhostPool = placementGhost.mode === 'building' ? marchlandLevelPools.get(mGhostKey) : undefined;
      if (mGhostPool) {
        const idx = marchlandCounts.get(mGhostKey) ?? 0;
        if (idx < mGhostPool.cap) {
          const y = terrain.heightAt(placementGhost.x, placementGhost.z);
          TEMP_POS.set(placementGhost.x, y + 0.04, placementGhost.z);
          TEMP_QUAT.setFromAxisAngle(UP, placementGhost.yawRad);
          TEMP_SCALE.set(1, 1, 1);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          mGhostPool.mesh.setMatrixAt(idx, TEMP_MAT);
          marchlandCounts.set(mGhostKey, idx + 1);
        }
      } else {
        const ghostKind: BuildingKind =
          placementGhost.mode === 'gate'
            ? 'gate_l1'
            : BUILDING_DEFS[ghostType].modelKind;
        const gPool = dynamicBuildingPools.get(ghostKind);
        if (gPool) {
          const idx = poolCounts.get(ghostKind) ?? 0;
          if (idx < gPool.cap) {
            const y = terrain.heightAt(placementGhost.x, placementGhost.z);
            TEMP_POS.set(placementGhost.x, y + 0.04, placementGhost.z);
            TEMP_QUAT.setFromAxisAngle(UP, placementGhost.yawRad);
            TEMP_SCALE.set(1, 1, 1);
            TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
            for (const m of gPool.meshes) m.setMatrixAt(idx, TEMP_MAT);
            poolCounts.set(ghostKind, idx + 1);
          }
        }
      }
    }

    for (const [kind, pool] of dynamicBuildingPools) {
      commitPool(pool.meshes, poolCounts.get(kind) ?? 0);
    }
    for (const [key, pool] of marchlandLevelPools) {
      commitPool([pool.mesh], marchlandCounts.get(key) ?? 0);
    }
    commitPool([dynPlinthMesh], plinthCount);
    commitPool([dynScafMesh], scafCount);
    commitPool([dynVinePostMesh], vinePostCount);
    commitPool([dynVineLeafMesh], vineLeafCount);
    commitPool([dynVineGrapeMesh], vineGrapeCount);
    if (dynVinePostMesh.instanceColor) dynVinePostMesh.instanceColor.needsUpdate = true;
    if (dynVineLeafMesh.instanceColor) dynVineLeafMesh.instanceColor.needsUpdate = true;
    if (dynVineGrapeMesh.instanceColor) dynVineGrapeMesh.instanceColor.needsUpdate = true;

    // Sync swaying 3D golden wheat stalks on all player/AI Farm strips!
    if (syncDynamicFarms) {
      syncDynamicFarms(state.buildings);
    }

    // 4. All active walls (player/AI built + Campaign fortress walls; slightly overlapped 1.06x along local X so zero cracks!)
    if (dynWallMeshes.length > 0) {
      let wCount = 0;
      for (const w of state.walls) {
        if (w.destroyed || w.hp <= 0 || wCount >= 520) continue;
        const y = terrain.heightAt(w.x, w.z);
        TEMP_POS.set(w.x, y, w.z);
        TEMP_QUAT.setFromAxisAngle(UP, w.yawRad);
        TEMP_SCALE.set(1.06, 1, 1);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        for (const m of dynWallMeshes) m.setMatrixAt(wCount, TEMP_MAT);
        wCount++;
      }
      commitPool(dynWallMeshes, wCount);
    }

    // 5. Felled Trees -> Stumps & Saplings (hide mature tree in world batch + render stump/sapling!)
    let stumpCount = 0;
    let saplingCount = 0;
    for (const tr of state.trees) {
      if (tr.state === 'mature') {
        if (hiddenTreeIds.has(tr.id)) {
          hiddenTreeIds.delete(tr.id);
          treeHookBySpecies.get(tr.species)?.setTreeVisible(tr.x, tr.z, true);
        }
        continue;
      }
      if (!hiddenTreeIds.has(tr.id)) {
        hiddenTreeIds.add(tr.id);
        treeHookBySpecies.get(tr.species)?.setTreeVisible(tr.x, tr.z, false);
      }
      const y = terrain.heightAt(tr.x, tr.z);
      TEMP_POS.set(tr.x, y, tr.z);
      TEMP_QUAT.setFromAxisAngle(UP, tr.yawRad);
      if (tr.state === 'stump' && stumpCount < 160) {
        TEMP_SCALE.set(tr.scale * 0.9, tr.scale * 0.9, tr.scale * 0.9);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        for (const m of dynStumpMeshes) m.setMatrixAt(stumpCount, TEMP_MAT);
        stumpCount++;
      } else if (tr.state === 'sapling' && saplingCount < 160) {
        const gScale = 0.55 + Math.min(1, tr.regrowTimerS / 600) * 1.1;
        TEMP_SCALE.set(gScale, gScale, gScale);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        for (const m of dynSaplingMeshes) m.setMatrixAt(saplingCount, TEMP_MAT);
        saplingCount++;
      }
    }
    commitPool(dynStumpMeshes, stumpCount);
    commitPool(dynSaplingMeshes, saplingCount);
  };

  return {
    sync,
    dispose() {
      for (const m of allMeshes) scene.remove(m);
      for (const sm of siteSlots) scene.remove(sm);
      for (const g of disposableGeos) g.dispose();
      scafMat.dispose();
      vinePostMat.dispose();
      vineLeafMat.dispose();
      vineGrapeMat.dispose();
      vineLeafTex.dispose();
    },
  };
}
