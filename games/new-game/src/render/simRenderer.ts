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
import { computeBuildingStripTransform } from '../sim/economy.ts';
import type { GroundWorksMap } from '../sim/groundWorks.ts';
import type { BuildingKind } from '../sim/maps.ts';
import type { TerrainField } from '../sim/terrain.ts';
import type { BuildingEntity, SimWorldState } from '../sim/types.ts';
import type { PlacementGhostPreview } from './combatFx.ts';
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

/** Builds a vertex-colored 3D grapevine trellis strip (2 parallel 10 m staked vine rows with green foliage & purple grape clusters). */
function buildVineyardStripGeometry(): BufferGeometry {
  const geos: BufferGeometry[] = [];
  const pushColoredBox = (w: number, h: number, d: number, x: number, y: number, z: number, r: number, g: number, b: number) => {
    const raw = new BoxGeometry(w, h, d);
    raw.translate(x, y, z);
    const box = raw.index ? raw.toNonIndexed() : raw;
    const cnt = box.getAttribute('position').count;
    const cols = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      cols[i * 3 + 0] = r;
      cols[i * 3 + 1] = g;
      cols[i * 3 + 2] = b;
    }
    box.setAttribute('color', new Float32BufferAttribute(cols, 3));
    geos.push(box);
  };

  for (const rz of [-0.68, 0.68]) {
    // 5 oak trellis posts along the 10.2 m strip row
    for (const px of [-4.4, -2.2, 0.0, 2.2, 4.4]) {
      pushColoredBox(0.14, 1.48, 0.14, px, 0.72, rz, 0.42, 0.30, 0.19);
    }
    // Horizontal timber trellis rail
    pushColoredBox(9.2, 0.09, 0.09, 0.0, 1.18, rz, 0.46, 0.34, 0.22);
    // Lush green grapevine leaf hedge along the trellis wire
    for (const vx of [-3.3, -1.1, 1.1, 3.3]) {
      pushColoredBox(2.05, 0.72, 0.44, vx, 1.05, rz, 0.22, 0.52, 0.16);
      pushColoredBox(1.65, 0.45, 0.54, vx, 1.24, rz, 0.28, 0.62, 0.20);
      // Hanging purple grape clusters beneath the vine canopy
      pushColoredBox(0.24, 0.30, 0.24, vx - 0.45, 0.68, rz, 0.36, 0.12, 0.44);
      pushColoredBox(0.24, 0.30, 0.24, vx + 0.45, 0.66, rz, 0.36, 0.12, 0.44);
    }
  }
  const merged = mergeGeometries(geos, false) ?? new BoxGeometry(1, 1, 1);
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

export function buildSimWorldRenderer(opts: {
  readonly scene: Scene;
  readonly terrain: TerrainField;
  readonly groundWorks: GroundWorksMap;
  readonly syncGroundWorks: () => void;
  readonly syncDynamicFarms?: (buildings: readonly BuildingEntity[]) => void;
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
    syncDynamicFarms,
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
    const cap =
      kind === 'house_l1' || kind === 'farm_l1' || kind === 'watchtower_l1' || kind === 'camp_tent_l1' || kind === 'ruin_house'
        ? 48
        : 20;
    const meshes = createPreWarmedPool(scene, `DynBld_${kind}`, parts, cap, true);
    allMeshes.push(...meshes);
    dynamicBuildingPools.set(kind, { meshes, cap });
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

  // 4. Pre-warmed 3D Vineyard Grapevine Trellis Rows (staked oak trellises + green vines + purple grape bunches!)
  const vineGeo = buildVineyardStripGeometry();
  disposableGeos.push(vineGeo);
  const vineMat = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
  });
  vineMat.name = 'MarchlandVineyardTrellisMat';
  const dynVineMesh = new InstancedMesh(vineGeo, vineMat, 128);
  dynVineMesh.name = 'DynVineyardRows';
  dynVineMesh.castShadow = false;
  dynVineMesh.receiveShadow = true;
  dynVineMesh.frustumCulled = false;
  markStaticInstances(dynVineMesh);
  dynVineMesh.setMatrixAt(0, ZERO_MAT);
  dynVineMesh.count = 1;
  dynVineMesh.instanceMatrix.needsUpdate = true;
  scene.add(dynVineMesh);
  allMeshes.push(dynVineMesh);

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
    let scafCount = 0;
    let vineCount = 0;

    for (const b of state.buildings) {
      if (b.hp <= 0) continue;

      // Render 3D staked grapevine trellises behind every completed Vineyard!
      if (b.type === 'vineyard' && b.buildProgress >= 1) {
        for (let si = 0; si < b.strips.length && vineCount < 128; si++) {
          const st = b.strips[si]!;
          const tr = computeBuildingStripTransform(b, si);
          const y = terrain.heightAt(tr.cx, tr.cz);
          const growH =
            st.phase === 'ready'
              ? 1.05
              : st.phase === 'growing'
                ? 0.42 + 0.63 * st.growth01
                : 0.35;
          TEMP_POS.set(tr.cx, y, tr.cz);
          TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
          TEMP_SCALE.set(1.0, growH, 1.0);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          dynVineMesh.setMatrixAt(vineCount++, TEMP_MAT);
        }
      }

      // If an un-upgraded L1 static animated building (e.g. windmill) sits here and isn't upgrading, don't double-draw
      const staticMatch = matchStaticBuilding(b.x, b.z);
      if (staticMatch && b.buildProgress >= 1 && b.upgradingToLevel === null && b.level === 1 && b.type !== 'ruin') {
        continue;
      }

      const kind: BuildingKind = b.isFortressDonzon ? 'fortress_donzon' : BUILDING_DEFS[b.type].modelKind;
      const pool = dynamicBuildingPools.get(kind);
      if (!pool) continue;
      const idx = poolCounts.get(kind) ?? 0;
      if (idx >= pool.cap) continue;

      const y = terrain.heightAt(b.x, b.z);
      const scaleY = b.buildProgress < 1 ? 0.22 + 0.78 * b.buildProgress : 1.0;
      const levelScale = b.level === 3 ? 1.18 : b.level === 2 ? 1.09 : 1.0;
      TEMP_POS.set(b.x, y, b.z);
      TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
      TEMP_SCALE.set(levelScale, scaleY * levelScale, levelScale);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      for (const m of pool.meshes) m.setMatrixAt(idx, TEMP_MAT);
      poolCounts.set(kind, idx + 1);

      if ((b.buildProgress < 1 || b.upgradingToLevel !== null) && scafCount < 24) {
        const r = BUILDING_DEFS[b.type].radiusM * 1.45 * levelScale;
        const prog = b.buildProgress < 1 ? b.buildProgress : 0.75;
        TEMP_POS.set(b.x, y, b.z);
        TEMP_QUAT.setFromAxisAngle(UP, b.yawRad);
        TEMP_SCALE.set(r, 3.6 + 2.4 * prog, r);
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

    // Live 3D building / gate placement preview right under the player's cursor rotating live with R!
    if (placementGhost && placementGhost.active && (placementGhost.mode === 'building' || placementGhost.mode === 'gate')) {
      const ghostKind: BuildingKind =
        placementGhost.mode === 'gate'
          ? 'gate_l1'
          : BUILDING_DEFS[placementGhost.buildingType ?? 'house'].modelKind;
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

    for (const [kind, pool] of dynamicBuildingPools) {
      commitPool(pool.meshes, poolCounts.get(kind) ?? 0);
    }
    commitPool([dynScafMesh], scafCount);
    commitPool([dynVineMesh], vineCount);

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
      for (const g of disposableGeos) g.dispose();
      scafMat.dispose();
      vineMat.dispose();
    },
  };
}
