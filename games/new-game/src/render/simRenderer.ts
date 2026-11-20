// Stage 6 Live Dynamic Simulation World Synchronizer (R1, R4, zero mid-play GPU pipelines!):
// Synchronizes newly constructed/upgrading/destroyed buildings, construction scaffolding,
// dynamic stone walls & auto-opening gates, felled trees -> stumps/saplings, and newly laid
// cobbled roads / building yards directly into GroundWorksMap + pre-allocated InstancedMeshes!
// Every InstancedMesh is added to the scene BEFORE renderer.warmUp() with count = 1, scale = 0
// so ZERO GPU pipelines are ever compiled during live gameplay.

import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
  type Scene,
} from 'three/webgpu';
import { BUILDING_DEFS } from '../config.ts';
import type { GroundWorksMap } from '../sim/groundWorks.ts';
import type { BuildingKind } from '../sim/maps.ts';
import type { TerrainField } from '../sim/terrain.ts';
import type { SimWorldState } from '../sim/types.ts';
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
  readonly setVisible: (visible: boolean) => void;
}

export interface SimRendererHandles {
  readonly sync: (state: SimWorldState) => void;
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

export function buildSimWorldRenderer(opts: {
  readonly scene: Scene;
  readonly terrain: TerrainField;
  readonly groundWorks: GroundWorksMap;
  readonly syncGroundWorks: () => void;
  readonly buildingMaterial: Material;
  readonly buildingTemplates: ReadonlyMap<BuildingKind, SimBuildingTemplate>;
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
    buildingMaterial,
    buildingTemplates,
    wallTemplate,
    stumpRoot,
    saplingRoot,
    staticBuildings,
    staticGates,
    treeHooks,
  } = opts;

  const disposableGeos: BufferGeometry[] = [];
  const allMeshes: InstancedMesh[] = [];

  // 1. Pre-warmed dynamic building pools for every loaded BuildingKind (0 new pipelines in play!)
  const dynamicBuildingPools = new Map<BuildingKind, { meshes: InstancedMesh[]; cap: number }>();
  for (const [kind, tpl] of buildingTemplates) {
    const parts = extractPartsFromRoot(tpl.lod0, buildingMaterial);
    for (const p of parts) disposableGeos.push(p.geometry);
    const cap = kind === 'house_l1' || kind === 'farm_l1' ? 40 : 18;
    const meshes = createPreWarmedPool(scene, `DynBld_${kind}`, parts, cap, true);
    allMeshes.push(...meshes);
    dynamicBuildingPools.set(kind, { meshes, cap });
  }

  // 2. Pre-warmed dynamic walls, stumps & saplings
  let dynWallMeshes: InstancedMesh[] = [];
  if (wallTemplate) {
    const wParts = extractPartsFromRoot(wallTemplate.lod0, buildingMaterial);
    for (const p of wParts) disposableGeos.push(p.geometry);
    dynWallMeshes = createPreWarmedPool(scene, 'DynWalls', wParts, 200, true);
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

  // 3. Open 4-corner oak timber scaffolding frame around active construction sites (zero translucent block!)
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

  const treeHookBySpecies = new Map<string, TreeBatchHook>();
  for (const th of treeHooks) treeHookBySpecies.set(th.species, th);

  // Track which static Stage 5 buildings already exist at boot so we never double-render them!
  const matchStaticBuilding = (x: number, z: number): StaticBuildingHook | null => {
    for (const sb of staticBuildings) {
      if (Math.abs(sb.x - x) < 1.2 && Math.abs(sb.z - z) < 1.2) return sb;
    }
    return null;
  };

  const stampedBuildingIds = new Set<number>();
  const hiddenTreeIds = new Set<number>();
  let stampedRoadCount = 0;
  let lastRevision = -1;
  let lastConstructingHash = -1;

  const sync = (state: SimWorldState): void => {
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

    // Check if any building is currently constructing (so scaleY animates smoothly!)
    let constructingHash = 0;
    for (const b of state.buildings) {
      if (b.buildProgress < 1 && b.hp > 0) {
        constructingHash += Math.round(b.buildProgress * 100) * (b.id & 31);
      }
    }
    if (state.visualRevision === lastRevision && constructingHash === lastConstructingHash) {
      return;
    }
    lastRevision = state.visualRevision;
    lastConstructingHash = constructingHash;

    // 1. Stamp newly added roads & newly placed buildings into GroundWorksMap!
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
    }
    if (gwDirty) {
      syncGroundWorks();
    }

    // 2. Sync static building visibility (hide if destroyed or absent in non-showcase Skirmish!)
    for (const sb of staticBuildings) {
      const aliveHere = state.buildings.some(
        (b) => b.hp > 0 && Math.abs(b.x - sb.x) < 1.2 && Math.abs(b.z - sb.z) < 1.2,
      );
      sb.setVisible(aliveHere);
    }

    // 3. Pack dynamic (newly placed / rebuilt / constructing) buildings into pre-warmed pools
    const poolCounts = new Map<BuildingKind, number>();
    for (const k of dynamicBuildingPools.keys()) poolCounts.set(k, 0);
    let scafCount = 0;

    for (const b of state.buildings) {
      if (b.hp <= 0) continue;
      // If a static hero/batch building already sits here AND construction is complete, don't double-draw
      const staticMatch = matchStaticBuilding(b.x, b.z);
      if (staticMatch && b.buildProgress >= 1 && b.type !== 'ruin') continue;

      const kind: BuildingKind = b.isFortressDonzon ? 'fortress_donzon' : BUILDING_DEFS[b.type].modelKind;
      const pool = dynamicBuildingPools.get(kind);
      if (!pool) continue;
      const idx = poolCounts.get(kind) ?? 0;
      if (idx >= pool.cap) continue;

      const y = terrain.heightAt(b.x, b.z);
      const scaleY = b.buildProgress < 1 ? 0.22 + 0.78 * b.buildProgress : 1.0;
      const levelScale = b.level === 3 ? 1.12 : b.level === 2 ? 1.06 : 1.0;
      TEMP_POS.set(b.x, y, b.z);
      TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
      TEMP_SCALE.set(levelScale, scaleY * levelScale, levelScale);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      for (const m of pool.meshes) m.setMatrixAt(idx, TEMP_MAT);
      poolCounts.set(kind, idx + 1);

      if (b.buildProgress < 1 && scafCount < 24) {
        const r = BUILDING_DEFS[b.type].radiusM * 1.45;
        TEMP_POS.set(b.x, y, b.z);
        TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
        TEMP_SCALE.set(r, 3.6 + 2.4 * b.buildProgress, r);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        dynScafMesh.setMatrixAt(scafCount++, TEMP_MAT);
      }
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

    for (const [kind, pool] of dynamicBuildingPools) {
      commitPool(pool.meshes, poolCounts.get(kind) ?? 0);
    }
    commitPool([dynScafMesh], scafCount);

    // 4. Dynamic player/AI built walls
    if (dynWallMeshes.length > 0) {
      let wCount = 0;
      for (const w of state.walls) {
        if (w.destroyed || w.hp <= 0 || wCount >= 200) continue;
        // Skip walls already baked into initial layout if untouched? Dynamic pool draws ALL active dynamic walls cleanly!
        const y = terrain.heightAt(w.x, w.z);
        TEMP_POS.set(w.x, y, w.z);
        TEMP_QUAT.setFromAxisAngle(UP, w.yawRad);
        TEMP_SCALE.set(1, 1, 1);
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
      for (const g of disposableGeos) g.dispose();
      scafMat.dispose();
    },
  };
}
