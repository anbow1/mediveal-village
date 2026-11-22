// Stage 6 Pre-Warmed Combat, Logistics & Tactical Overlay VFX Renderer (R1, R4, zero mid-play pipelines!):
// Renders in 8 pre-allocated InstancedMeshes (all seeded with count = 1, scale = 0 & markStaticInstances before warmUp()):
//   1. Sculpted medieval warhorses under Light & Heavy Cavalry (barrel chest, arched neck, head/ears, 4 legs, tail & saddle)
//   2. Field Cannons & Siege Mortars (tapered gun barrel + heavy oak trail carriage + twin wheels + axle)
//   3. Carried goods bundles on Carriers (colour-coded crates/sacks/timber bobbing on shoulder)
//   4. Ballistic Arrows & Crossbow Bolts oriented along exact flight velocity tangent
//   5. Ballistic Cannonballs & Mortar Shells on exact parabolic arcs
//   6. Soft feathered camera-facing TSL blackpowder smoke & impact dust wisps (zero hard-edge spheres!)
//   7. Regiment Heraldic Standards (3.4 m spear flagpole + spear tip + fluttering swallowtail banner)
//   8. Sleek Tactical Ground Rings (selected regiments/building, Ctrl+right-drag formation slots, placement ghost)

import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three/webgpu';
import { abs, attribute, dot, float, normalView, pow, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { markStaticInstances } from './instancing.ts';
import { BUILDING_DEFS, UNIT_DEFS, type BuildingTypeId, type GoodId } from '../config.ts';
import type { FormationKind, FxEvent, SimWorldState } from '../sim/types.ts';
import { computeFormationSlotOffset, countAliveSoldiers } from '../sim/combat.ts';
import { computeBuildingStripTransform } from '../sim/economy.ts';

export interface FormationGhostUnitPreview {
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly width: number;
  readonly ranks?: number;
  readonly count: number;
  readonly unitClass: 'infantry' | 'ranged' | 'cavalry' | 'siege';
  readonly formation?: FormationKind;
}

export interface FormationGhostPreview {
  readonly active: boolean;
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly width: number;
  readonly ranks?: number;
  readonly count: number;
  readonly unitClass: 'infantry' | 'ranged' | 'cavalry' | 'siege';
  readonly formation?: FormationKind;
  readonly units?: readonly FormationGhostUnitPreview[];
}

export interface PlacementGhostPreview {
  readonly active: boolean;
  readonly mode: 'building' | 'road' | 'wall' | 'gate';
  readonly buildingType?: BuildingTypeId;
  readonly x: number;
  readonly z: number;
  readonly x1?: number;
  readonly z1?: number;
  readonly yawRad: number;
  readonly valid: boolean;
}

interface PuffParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ageS: number;
  maxAgeS: number;
  startScale: number;
  endScale: number;
  spin: number;
  color: Color;
}

export interface CombatFxHandles {
  readonly spawnFxEvents: (events: readonly FxEvent[]) => void;
  readonly update: (
    dtS: number,
    state: SimWorldState,
    cameraPos: Vector3,
    heightAt: (x: number, z: number) => number,
    selectedRegimentIds: ReadonlySet<number>,
    selectedBuildingId: number | null,
    formationGhost: FormationGhostPreview | null,
    placementGhost: PlacementGhostPreview | null,
    paused: boolean,
    skipProceduralUnits?: boolean,
  ) => void;
  readonly dispose: () => void;
}

const ZERO_MAT = new Matrix4().makeScale(0, 0, 0);
const TEMP_MAT = new Matrix4();
const TEMP_POS = new Vector3();
const TEMP_QUAT = new Quaternion();
const TEMP_SCALE = new Vector3();
const TEMP_EULER = new Euler();
const UP = new Vector3(0, 1, 0);
const DIR_TMP = new Vector3();

const GOOD_COLORS: Partial<Record<GoodId, number>> = {
  timber: 0x6b472b,
  planks: 0xa67c4e,
  stone: 0x9aa0a6,
  grain: 0xd9b84a,
  flour: 0xe6dec8,
  bread: 0xc28a3d,
  fish: 0x688ba3,
  meat: 0x993d35,
  sausages: 0x8a392d,
  hides: 0x735238,
  grapes: 0x5c2c66,
  wine: 0x731d2c,
  ale: 0xb07d2b,
  ironOre: 0x59524c,
  iron: 0x677078,
  weapons: 0x86919c,
  leatherArmour: 0x6e4a2e,
  mail: 0x99a3ad,
  bows: 0x855c33,
  horses: 0x6e4324,
};

const COL_COBALT = new Color(0x2856a8);
const COL_CRIMSON = new Color(0xa82a2a);
const COL_ROUT = new Color(0xe8e4d8);
const COL_GOLD = new Color(0xd9a838);
const COL_VALID = new Color(0x3dc468);
const COL_INVALID = new Color(0xd93838);
const COL_HORSE_BAY = new Color(0x6e4226);
const COL_HORSE_CHESTNUT = new Color(0x522e1a);
const COL_HORSE_DAPPLE = new Color(0x6e7378);
const COL_CRATE_DEFAULT = new Color(0x8c653e);
const COL_SMOKE = new Color(0xc9c6be);
const COL_DUST = new Color(0x9e8868);
const COL_FIRE = new Color(0xe0963d);
const COL_ARROW = new Color(0x523a22);
const COL_IRON = new Color(0x363b42);
const COL_BRONZE = new Color(0x7c6844);
const COL_TMP = new Color();

/** Normalizes primitives to non-indexed {position, normal, uv} before merging into one GPU-instanced mesh. */
function mergePartGeos(parts: BufferGeometry[]): BufferGeometry {
  const normalized: BufferGeometry[] = [];
  for (const raw of parts) {
    const g = raw.index ? raw.toNonIndexed() : raw.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) {
      const cnt = g.getAttribute('position').count;
      g.setAttribute('uv', raw.getAttribute('uv')?.clone() ?? new BufferAttribute(new Float32Array(cnt * 2), 2));
    }
    normalized.push(g);
    raw.dispose();
  }
  const merged = mergeGeometries(normalized, false);
  for (const g of normalized) g.dispose();
  if (!merged) throw new Error('Failed to merge CombatFx geometry');
  return merged;
}

/**
 * Sculpted anatomical medieval warhorse facing +Z:
 * barrel torso & hindquarters, arched muscular neck, sculpted head/muzzle & twin ears,
 * flowing mane & tail, high medieval war-saddle, and 4 jointed stride-posed legs reaching y = 0.
 */
function buildWarhorseGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, tx: number, ty: number, tz: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    g.scale(sx, sy, sz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(tx, ty, tz);
    parts.push(g);
  };

  // Barrel torso, chest & rounded hindquarters (back sits at y ~ 1.38 m for mounted rider!)
  add(new CylinderGeometry(0.32, 0.34, 1.05, 10), 0, 1.12, 0.0, Math.PI * 0.5, 0, 0, 0.94, 1.0, 1.02);
  add(new SphereGeometry(0.34, 10, 7), 0, 1.15, 0.50, 0, 0, 0, 0.92, 0.98, 1.02); // chest/withers
  add(new SphereGeometry(0.33, 10, 7), 0, 1.14, -0.52, 0, 0, 0, 0.95, 0.98, 1.08); // croup/hindquarters

  // High medieval war-saddle (pommel + cantle + saddle cloth)
  add(new BoxGeometry(0.56, 0.14, 0.54), 0, 1.40, -0.02);
  add(new BoxGeometry(0.46, 0.16, 0.10), 0, 1.49, 0.22); // high front pommel
  add(new BoxGeometry(0.48, 0.18, 0.11), 0, 1.50, -0.26); // high rear cantle

  // Arched crested neck + mane ridge
  add(new CylinderGeometry(0.14, 0.26, 0.84, 8), 0, 1.52, 0.78, 0.56, 0, 0, 0.86, 1.0, 1.0);
  add(new BoxGeometry(0.07, 0.72, 0.14), 0, 1.58, 0.67, 0.56, 0, 0); // mane crest

  // Sculpted horse head, tapered muzzle & twin alert ears
  add(new SphereGeometry(0.16, 8, 6), 0, 1.88, 1.05, 0, 0, 0, 0.86, 0.95, 1.12);
  add(new CylinderGeometry(0.085, 0.135, 0.44, 7), 0, 1.72, 1.24, 2.02, 0, 0, 0.85, 1.0, 1.0);
  add(new ConeGeometry(0.042, 0.16, 4), -0.08, 2.04, 1.01, 0.15, 0, 0.16);
  add(new ConeGeometry(0.042, 0.16, 4), 0.08, 2.04, 1.01, 0.15, 0, -0.16);

  // Flowing tail sweeping back from croup
  add(new CylinderGeometry(0.075, 0.035, 0.82, 6), 0, 0.88, -0.96, 0.36, 0, 0);

  // Four jointed legs with upper shoulder/thigh, lower cannon & hooves touching y = 0 (gentle active stride!)
  const legSpecs = [
    { x: -0.20, zTop: 0.54, tiltU: -0.16, tiltL: 0.06 },  // front-left
    { x: 0.20, zTop: 0.54, tiltU: 0.14, tiltL: -0.08 },   // front-right
    { x: -0.21, zTop: -0.56, tiltU: 0.18, tiltL: -0.12 }, // hind-left
    { x: 0.21, zTop: -0.56, tiltU: -0.14, tiltL: 0.10 },  // hind-right
  ];
  for (const lg of legSpecs) {
    // Upper thigh/shoulder
    add(new CylinderGeometry(0.085, 0.125, 0.52, 7), lg.x, 0.74, lg.zTop + lg.tiltU * 0.14, lg.tiltU, 0, 0);
    // Lower cannon bone
    const zLow = lg.zTop + lg.tiltU * 0.28 + lg.tiltL * 0.12;
    add(new CylinderGeometry(0.055, 0.075, 0.46, 6), lg.x, 0.29, zLow, lg.tiltL, 0, 0);
    // Hoof resting cleanly at ground
    add(new CylinderGeometry(0.068, 0.082, 0.11, 6), lg.x, 0.055, zLow + lg.tiltL * 0.06);
  }

  return mergePartGeos(parts);
}

/** Authentic medieval field artillery: tapered barrel + cascabel + heavy oak trail carriage + twin spoked wheels + axle. */
function buildArtilleryGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, tx: number, ty: number, tz: number, rx = 0, ry = 0, rz = 0) => {
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(tx, ty, tz);
    parts.push(g);
  };
  // Tapered bronze/iron cannon barrel + breech cascabel
  add(new CylinderGeometry(0.14, 0.22, 2.25, 10), 0, 0.94, 0.22, Math.PI * 0.5);
  add(new SphereGeometry(0.14, 8, 6), 0, 0.94, -0.96);
  // Heavy oak carriage cheeks + trail + axle
  add(new BoxGeometry(0.16, 0.34, 2.15), -0.24, 0.64, -0.38, -0.18);
  add(new BoxGeometry(0.16, 0.34, 2.15), 0.24, 0.64, -0.38, -0.18);
  add(new BoxGeometry(0.56, 0.18, 0.26), 0, 0.44, -1.32);
  add(new CylinderGeometry(0.08, 0.08, 1.38, 8), 0, 0.58, 0.24, 0, 0, Math.PI * 0.5);
  // Twin tall wooden artillery wheels
  add(new CylinderGeometry(0.58, 0.58, 0.12, 14), -0.62, 0.58, 0.24, 0, 0, Math.PI * 0.5);
  add(new CylinderGeometry(0.58, 0.58, 0.12, 14), 0.62, 0.58, 0.24, 0, 0, Math.PI * 0.5);
  return mergePartGeos(parts);
}

/** Medieval regiment banner standard: 3.4 m spear flagpole + finial + fluttering swallowtail heraldic pennant. */
function buildBannerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const pole = new CylinderGeometry(0.032, 0.042, 3.45, 6);
  pole.translate(0, 1.725, 0);
  parts.push(pole);

  const finial = new ConeGeometry(0.075, 0.28, 5);
  finial.translate(0, 3.58, 0);
  parts.push(finial);

  // Heraldic banner hanging from horizontal crossbar, streaming cleanly to the side
  const crossbar = new CylinderGeometry(0.025, 0.025, 0.95, 5);
  crossbar.rotateZ(Math.PI * 0.5);
  crossbar.translate(0.45, 3.24, 0);
  parts.push(crossbar);

  const cloth = new BoxGeometry(0.92, 0.72, 0.045);
  cloth.translate(0.47, 2.86, 0);
  parts.push(cloth);

  const tail = new ConeGeometry(0.32, 0.52, 4);
  tail.rotateZ(-Math.PI * 0.5);
  tail.scale(1.0, 1.0, 0.18);
  tail.translate(1.12, 2.86, 0);
  parts.push(tail);

  return mergePartGeos(parts);
}

function makeInstanced(
  scene: Scene,
  name: string,
  geo: BufferGeometry,
  mat: MeshStandardNodeMaterial | MeshBasicNodeMaterial,
  maxCount: number,
  castShadow = false,
): InstancedMesh {
  const im = new InstancedMesh(geo, mat, maxCount);
  im.name = name;
  im.castShadow = castShadow;
  im.receiveShadow = !castShadow && mat instanceof MeshStandardNodeMaterial;
  im.frustumCulled = false;
  im.instanceMatrix.setUsage(DynamicDrawUsage);
  markStaticInstances(im);
  im.setMatrixAt(0, ZERO_MAT);
  im.setColorAt(0, COL_GOLD);
  im.count = 1;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  scene.add(im);
  return im;
}

function finalizeBatch(im: InstancedMesh, count: number): void {
  const uploadCount = Math.max(1, count);
  if (count === 0) {
    im.setMatrixAt(0, ZERO_MAT);
    im.count = 1;
  } else {
    im.count = count;
  }
  im.instanceMatrix.clearUpdateRanges();
  im.instanceMatrix.addUpdateRange(0, uploadCount * 16);
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) {
    im.instanceColor.clearUpdateRanges();
    im.instanceColor.addUpdateRange(0, uploadCount * 3);
    im.instanceColor.needsUpdate = true;
  }
}

export function buildCombatFx(scene: Scene): CombatFxHandles {
  const geos: BufferGeometry[] = [];
  const mats: (MeshStandardNodeMaterial | MeshBasicNodeMaterial)[] = [];

  // Shared solid PBR material supporting per-instance colour (1 compiled shader family for horses, cannons, crates, arrows, banners!)
  const solidMat = new MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.16 });
  solidMat.name = 'MarchlandCombatFxSolid';
  mats.push(solidMat);

  // Soft feathered billboarding TSL smoke/dust wisp material (matches chimney smoke realism — zero hard opaque spheres!)
  // Volumetric lit blackpowder smoke (ported from FPS/marchland shotSmokeView.ts):
  // thin at the rim, thick in the core via view-space normal dot Z -> soft billowing 3D cloud lit by sun & sky!
  const puffFadeAttr = new InstancedBufferAttribute(new Float32Array(180), 1);
  puffFadeAttr.setUsage(DynamicDrawUsage);
  const puffGeo = new IcosahedronGeometry(1, 1);
  puffGeo.setAttribute('aFade', puffFadeAttr);
  geos.push(puffGeo);

  const smokeMat = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  smokeMat.name = 'MarchlandCombatFxSmoke';
  {
    const facing = pow(abs(dot(normalView, vec3(0, 0, 1))), float(1.6));
    smokeMat.opacityNode = attribute('aFade', 'float').mul(facing).mul(float(0.54));
  }
  mats.push(smokeMat);

  // Crisp bright muzzle flash material (120 ms blink on cannon/mortar shots & blasts)
  const flashMat = new MeshBasicNodeMaterial({ color: 0xffd27a, fog: true });
  flashMat.name = 'MarchlandCombatFxFlash';
  mats.push(flashMat);

  // Sleek double-sided tactical ground overlay material (thin selection rings, formation slots, build ghost)
  const ringMat = new MeshStandardNodeMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.05,
    emissive: 0x201c12,
    emissiveIntensity: 0.32,
    transparent: true,
    opacity: 0.48,
    side: DoubleSide,
    depthWrite: false,
  });
  ringMat.name = 'MarchlandCombatFxRing';
  mats.push(ringMat);

  // 1. Sculpted medieval warhorses (cap 84)
  const horseGeo = buildWarhorseGeometry();
  geos.push(horseGeo);
  const horseMesh = makeInstanced(scene, 'Fx_Warhorses', horseGeo, solidMat, 84, true);

  // 2. Sculpted medieval field artillery (cap 24)
  const cannonGeo = buildArtilleryGeometry();
  geos.push(cannonGeo);
  const cannonMesh = makeInstanced(scene, 'Fx_Artillery', cannonGeo, solidMat, 24, true);

  // 3. Carried goods bundles on Carriers (cap 140)
  const crateGeo = new BoxGeometry(0.44, 0.36, 0.44);
  geos.push(crateGeo);
  const crateMesh = makeInstanced(scene, 'Fx_CarriedGoods', crateGeo, solidMat, 140, false);

  // 4. Ballistic Arrows & Crossbow Bolts (cap 240)
  const arrowGeo = new CylinderGeometry(0.025, 0.032, 1.15, 5);
  arrowGeo.rotateX(Math.PI * 0.5);
  geos.push(arrowGeo);
  const arrowMesh = makeInstanced(scene, 'Fx_Arrows', arrowGeo, solidMat, 240, false);

  // 5. Ballistic Cannonballs & Mortar Shells (cap 48)
  const shellGeo = new SphereGeometry(0.20, 8, 6);
  geos.push(shellGeo);
  const shellMesh = makeInstanced(scene, 'Fx_Shells', shellGeo, solidMat, 48, false);

  // 6. Volumetric Fresnel blackpowder smoke & dust clouds (cap 180) + crisp muzzle flashes (cap 24)
  const puffMesh = makeInstanced(scene, 'Fx_BattleSmoke', puffGeo, smokeMat, 180, false);
  puffMesh.renderOrder = 6;
  const flashGeo = new IcosahedronGeometry(1, 0);
  geos.push(flashGeo);
  const flashMesh = makeInstanced(scene, 'Fx_MuzzleFlash', flashGeo, flashMat, 24, false);
  flashMesh.renderOrder = 7;

  // 7. Regiment Heraldic Standards (3.4 m spear flagpole + swallowtail pennant, cap 64)
  const bannerGeo = buildBannerGeometry();
  geos.push(bannerGeo);
  const bannerMesh = makeInstanced(scene, 'Fx_RegimentBanners', bannerGeo, solidMat, 64, false);

  // 8. Sleek Tactical Ground Rings (cap 256)
  const ringGeo = new RingGeometry(0.91, 1.0, 36);
  ringGeo.rotateX(-Math.PI * 0.5);
  geos.push(ringGeo);
  const ringMesh = makeInstanced(scene, 'Fx_TacticalRings', ringGeo, ringMat, 256, false);

  // Active particle pools (bounded, zero GC thrash)
  const puffs: PuffParticle[] = [];
  interface FlashParticle {
    x: number;
    y: number;
    z: number;
    size: number;
    ageS: number;
    maxAgeS: number;
  }
  const flashes: FlashParticle[] = [];

  const spawnFlash = (x: number, y: number, z: number, size: number, maxAgeS = 0.14): void => {
    if (flashes.length >= 24) flashes.shift();
    flashes.push({ x, y, z, size, ageS: 0, maxAgeS });
  };

  const spawnPuff = (
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxAgeS: number,
    startScale: number,
    endScale: number,
    color: Color,
  ): void => {
    if (puffs.length >= 180) puffs.shift();
    puffs.push({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      ageS: 0,
      maxAgeS,
      startScale,
      endScale,
      spin: (x * 1.7 + z * 2.3) % 6.283,
      color: color.clone(),
    });
  };

  const spawnFxEvents = (events: readonly FxEvent[]): void => {
    for (const ev of events) {
      if (ev.kind === 'cannonMuzzle') {
        spawnFlash(ev.x, ev.y + 1.05, ev.z, 1.15, 0.13);
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2 + ev.x;
          const r = 0.25 + (i % 3) * 0.36;
          spawnPuff(
            ev.x + Math.cos(ang) * r,
            ev.y + 0.95 + (i % 2) * 0.28,
            ev.z + Math.sin(ang) * r,
            Math.cos(ang) * 0.78 + 0.35,
            0.42 + (i % 4) * 0.22,
            Math.sin(ang) * 0.78 + 0.2,
            3.8 + (i % 3) * 0.6,
            0.55,
            2.15,
            COL_SMOKE,
          );
        }
      } else if (ev.kind === 'mortarImpact' || ev.kind === 'wallCollapse') {
        const count = ev.kind === 'wallCollapse' ? 10 : 7;
        spawnFlash(ev.x, ev.y + 0.65, ev.z, ev.kind === 'wallCollapse' ? 1.45 : 1.25, 0.16);
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2 + ev.z * 0.3;
          spawnPuff(
            ev.x + Math.cos(ang) * 0.85,
            ev.y + 0.5 + (i % 2) * 0.25,
            ev.z + Math.sin(ang) * 0.85,
            Math.cos(ang) * 1.25 + 0.3,
            1.15 + (i % 3) * 0.42,
            Math.sin(ang) * 1.25,
            3.2 + (i % 3) * 0.55,
            0.7,
            2.65,
            i % 2 === 0 ? COL_DUST : COL_SMOKE,
          );
        }
      } else if (ev.kind === 'buildHammer' || ev.kind === 'woodChop') {
        spawnPuff(ev.x, ev.y + 0.8, ev.z, 0.25, 0.75, 0.12, 1.35, 0.4, 1.15, COL_DUST);
      }
    }
  };

  let animClockS = 0;

  const update = (
    dtS: number,
    state: SimWorldState,
    _cameraPos: Vector3,
    heightAt: (x: number, z: number) => number,
    selectedRegimentIds: ReadonlySet<number>,
    selectedBuildingId: number | null,
    formationGhost: FormationGhostPreview | null,
    placementGhost: PlacementGhostPreview | null,
    paused: boolean,
    skipProceduralUnits = false,
  ): void => {
    if (!paused && dtS > 0) {
      animClockS += dtS;
    }

    let horseCount = 0;
    let cannonCount = 0;
    let bannerCount = 0;
    let ringCount = 0;

    for (const reg of state.regiments) {
      if (reg.garrisonedInBuildingId !== null) continue;
      const alive = countAliveSoldiers(reg);
      if (alive <= 0) continue;
      const def = UNIT_DEFS[reg.unitType];

      // Sculpted Cavalry Warhorses (skipped when 40-bone marchland warhorses are active)
      if (!skipProceduralUnits && def.unitClass === 'cavalry') {
        for (const s of reg.soldiers) {
          if (!s.alive || horseCount >= 84) continue;
          const y = heightAt(s.x, s.z);
          const bob = s.clip === 'walk' ? Math.abs(Math.sin(s.travelM * 2.3)) * 0.12 : 0;
          const pitch = s.clip === 'walk' ? Math.sin(s.travelM * 2.3) * 0.055 : 0;
          TEMP_POS.set(s.x, y + bob, s.z);
          TEMP_EULER.set(pitch, s.yawRad, 0, 'YXZ');
          TEMP_QUAT.setFromEuler(TEMP_EULER);
          const sc = reg.unitType === 'heavyCav' ? 1.07 : 0.97;
          TEMP_SCALE.set(sc, sc, sc);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          horseMesh.setMatrixAt(horseCount, TEMP_MAT);
          horseMesh.setColorAt(
            horseCount,
            reg.unitType === 'heavyCav' ? COL_HORSE_DAPPLE : s.tintVar > 1.0 ? COL_HORSE_BAY : COL_HORSE_CHESTNUT,
          );
          horseCount++;
        }
      }

      // Field Artillery Guns (skipped when marchland cannon/mortar models are active)
      if (!skipProceduralUnits && def.unitClass === 'siege') {
        for (const s of reg.soldiers) {
          if (!s.alive || cannonCount >= 24) continue;
          const y = heightAt(s.x, s.z);
          TEMP_POS.set(s.x, y, s.z);
          TEMP_EULER.set(reg.unitType === 'mortar' ? -0.52 : -0.05, s.yawRad, 0, 'YXZ');
          TEMP_QUAT.setFromEuler(TEMP_EULER);
          TEMP_SCALE.set(reg.unitType === 'mortar' ? 1.15 : 1.0, 1.0, reg.unitType === 'mortar' ? 0.72 : 1.0);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          cannonMesh.setMatrixAt(cannonCount, TEMP_MAT);
          cannonMesh.setColorAt(cannonCount, reg.unitType === 'mortar' ? COL_IRON : COL_BRONZE);
          cannonCount++;
        }
      }

      // Regiment heraldic standard (spear flagpole + fluttering banner planted cleanly at regiment center!)
      if (bannerCount < 64) {
        const by = heightAt(reg.x, reg.z);
        const flutter = Math.sin(animClockS * 4.5 + reg.id * 1.7) * 0.14;
        TEMP_POS.set(reg.x, by, reg.z);
        TEMP_QUAT.setFromAxisAngle(UP, reg.yawRad + flutter);
        const moraleScale = reg.routing ? 0.72 : 0.88 + (reg.morale / Math.max(1, reg.maxMorale)) * 0.22;
        TEMP_SCALE.set(moraleScale, moraleScale, moraleScale);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        bannerMesh.setMatrixAt(bannerCount, TEMP_MAT);
        const col = reg.routing ? COL_ROUT : reg.side === 0 ? COL_COBALT : COL_CRIMSON;
        if (reg.veteranTier > 0 && !reg.routing) {
          COL_TMP.copy(col).lerp(COL_GOLD, reg.veteranTier === 2 ? 0.42 : 0.22);
          bannerMesh.setColorAt(bannerCount, COL_TMP);
        } else {
          bannerMesh.setColorAt(bannerCount, col);
        }
        bannerCount++;
      }

      // Sleek tactical selection ring under selected regiments
      if (selectedRegimentIds.has(reg.id) && ringCount < 256) {
        const ry = heightAt(reg.x, reg.z) + 0.12;
        const rad = def.unitClass === 'cavalry' ? 4.8 : def.unitClass === 'siege' ? 3.8 : 4.0;
        TEMP_POS.set(reg.x, ry, reg.z);
        TEMP_QUAT.identity();
        TEMP_SCALE.set(rad, 1, rad);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        ringMesh.setMatrixAt(ringCount, TEMP_MAT);
        ringMesh.setColorAt(ringCount, reg.side === 0 ? COL_GOLD : COL_CRIMSON);
        ringCount++;
      }
    }

    // Selected building ring
    if (selectedBuildingId !== null && ringCount < 256) {
      const sb = state.buildings.find((b) => b.id === selectedBuildingId && b.hp > 0);
      if (sb) {
        const rad = BUILDING_DEFS[sb.type].radiusM + 1.4;
        TEMP_POS.set(sb.x, heightAt(sb.x, sb.z) + 0.14, sb.z);
        TEMP_QUAT.identity();
        TEMP_SCALE.set(rad, 1, rad);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        ringMesh.setMatrixAt(ringCount, TEMP_MAT);
        ringMesh.setColorAt(ringCount, COL_GOLD);
        ringCount++;
      }
    }

    // Capture point ownership rings (always live on the 3 strategic points!)
    for (const cp of state.capturePoints) {
      if (ringCount >= 256) break;
      const pulse = 1.0 + Math.sin(animClockS * 2.6) * 0.03;
      TEMP_POS.set(cp.x, heightAt(cp.x, cp.z) + 0.13, cp.z);
      TEMP_QUAT.identity();
      TEMP_SCALE.set(6.2 * pulse, 1, 6.2 * pulse);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      ringMesh.setMatrixAt(ringCount, TEMP_MAT);
      ringMesh.setColorAt(ringCount, cp.owner === 0 ? COL_COBALT : cp.owner === 1 ? COL_CRIMSON : COL_GOLD);
      ringCount++;
    }

    // Target position & direction formation slot ghost preview (supports single unit, ranks, and multi-unit formations!)
    if (formationGhost && formationGhost.active) {
      const unitsToDraw: readonly FormationGhostUnitPreview[] =
        formationGhost.units && formationGhost.units.length > 0
          ? formationGhost.units
          : [
              {
                x: formationGhost.x,
                z: formationGhost.z,
                yawRad: formationGhost.yawRad,
                width: formationGhost.width,
                count: formationGhost.count,
                formation: formationGhost.formation ?? 'line',
                unitClass: formationGhost.unitClass,
              },
            ];
      for (const u of unitsToDraw) {
        const fx = Math.sin(u.yawRad);
        const fz = Math.cos(u.yawRad);
        const rx = Math.cos(u.yawRad);
        const rz = -Math.sin(u.yawRad);
        const slots = Math.min(36, u.count);
        const form = u.formation ?? 'line';
        for (let i = 0; i < slots && ringCount < 256; i++) {
          const off = computeFormationSlotOffset(
            i,
            slots,
            u.width,
            form,
            u.unitClass,
          );
          const gx = u.x + rx * off.right + fx * off.forward;
          const gz = u.z + rz * off.right + fz * off.forward;
          TEMP_POS.set(gx, heightAt(gx, gz) + 0.16, gz);
          TEMP_QUAT.identity();
          TEMP_SCALE.set(0.68, 1, 0.68);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          ringMesh.setMatrixAt(ringCount, TEMP_MAT);
          ringMesh.setColorAt(ringCount, COL_VALID);
          ringCount++;
        }
      }
    }

    // Building / Road / Wall / Gate placement ghost ring(s)
    if (placementGhost && placementGhost.active && ringCount < 256) {
      const col = placementGhost.valid ? COL_VALID : COL_INVALID;
      if ((placementGhost.mode === 'road' || placementGhost.mode === 'wall') && placementGhost.x1 !== undefined && placementGhost.z1 !== undefined) {
        const dist = Math.hypot(placementGhost.x1 - placementGhost.x, placementGhost.z1 - placementGhost.z);
        const steps = Math.max(2, Math.min(24, Math.ceil(dist / 3.5)));
        for (let i = 0; i <= steps && ringCount < 256; i++) {
          const t = i / steps;
          const px = placementGhost.x + (placementGhost.x1 - placementGhost.x) * t;
          const pz = placementGhost.z + (placementGhost.z1 - placementGhost.z) * t;
          TEMP_POS.set(px, heightAt(px, pz) + 0.16, pz);
          TEMP_QUAT.identity();
          TEMP_SCALE.set(placementGhost.mode === 'wall' ? 1.3 : 1.9, 1, placementGhost.mode === 'wall' ? 1.3 : 1.9);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          ringMesh.setMatrixAt(ringCount, TEMP_MAT);
          ringMesh.setColorAt(ringCount, col);
          ringCount++;
        }
      } else {
        const rad = placementGhost.buildingType ? BUILDING_DEFS[placementGhost.buildingType].radiusM : 3.4;
        TEMP_POS.set(placementGhost.x, heightAt(placementGhost.x, placementGhost.z) + 0.18, placementGhost.z);
        TEMP_QUAT.identity();
        TEMP_SCALE.set(rad, 1, rad);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        ringMesh.setMatrixAt(ringCount, TEMP_MAT);
        ringMesh.setColorAt(ringCount, col);
        ringCount++;

        // Front entrance / doorway apron ring pointing out the building's doorway direction (+Z local rotated by yawRad)!
        if (ringCount < 256) {
          const fx = Math.sin(placementGhost.yawRad);
          const fz = Math.cos(placementGhost.yawRad);
          const ex = placementGhost.x + fx * (rad + 1.45);
          const ez = placementGhost.z + fz * (rad + 1.45);
          TEMP_POS.set(ex, heightAt(ex, ez) + 0.20, ez);
          TEMP_QUAT.identity();
          TEMP_SCALE.set(1.25, 1, 1.25);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          ringMesh.setMatrixAt(ringCount, TEMP_MAT);
          ringMesh.setColorAt(ringCount, col);
          ringCount++;
        }

        // When placing a Quarry or Iron Mine, pulse bright 15 m build-radius rings around EVERY matching deposit!
        const wantKind =
          placementGhost.buildingType === 'quarry'
            ? 'stone'
            : placementGhost.buildingType === 'ironMine'
              ? 'ore'
              : null;
        if (wantKind) {
          const pulse = 1.0 + Math.sin(animClockS * 4.2) * 0.035;
          const reqDist = BUILDING_DEFS[placementGhost.buildingType!].terrainReqDistM ?? 15;
          COL_TMP.setHex(wantKind === 'stone' ? 0xd8ecff : 0xf09543);
          for (const oc of state.outcrops) {
            if (oc.kind !== wantKind || ringCount >= 256) continue;
            TEMP_POS.set(oc.x, heightAt(oc.x, oc.z) + 0.22, oc.z);
            TEMP_QUAT.identity();
            TEMP_SCALE.set(reqDist * pulse, 1, reqDist * pulse);
            TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
            ringMesh.setMatrixAt(ringCount, TEMP_MAT);
            ringMesh.setColorAt(ringCount, COL_TMP);
            ringCount++;
          }
        }
      }
    }

    // 2. Carried goods crates/sacks visibly held by Carriers + Building Entrance Direction Arrow & Farm/Vineyard Strip Previews!
    let crateCount = 0;
    for (const c of state.citizens) {
      if (!c.carryingGood || crateCount >= 110) continue;
      const y = heightAt(c.x, c.z);
      const bob = Math.abs(Math.sin(c.travelM * 3.1)) * 0.08;
      const fx = Math.sin(c.yawRad) * 0.34;
      const fz = Math.cos(c.yawRad) * 0.34;
      TEMP_POS.set(c.x + fx, y + 1.18 + bob, c.z + fz);
      TEMP_QUAT.setFromAxisAngle(UP, c.yawRad);
      const scale = c.carryingGood === 'timber' || c.carryingGood === 'planks' ? 1.2 : 0.9;
      TEMP_SCALE.set(scale * 0.9, 0.85, c.carryingGood === 'timber' ? 1.7 : scale);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      crateMesh.setMatrixAt(crateCount, TEMP_MAT);
      const hex = GOOD_COLORS[c.carryingGood];
      if (hex !== undefined) {
        COL_TMP.setHex(hex);
        crateMesh.setColorAt(crateCount, COL_TMP);
      } else {
        crateMesh.setColorAt(crateCount, COL_CRATE_DEFAULT);
      }
      crateCount++;
    }

    // Helper drawing a bold 4-piece 3D Entrance / Doorway Direction Arrow (threshold bar + shaft + twin chevron wings)
    const pushEntranceDirectionArrow = (bx: number, bz: number, yawRad: number, radM: number, arrowCol: Color) => {
      if (crateCount + 4 > 140) return;
      const fx = Math.sin(yawRad);
      const fz = Math.cos(yawRad);
      const rx = Math.cos(yawRad);
      const rz = -Math.sin(yawRad);

      // 1) Wide doorway threshold bar right across the front entrance (+Z local)
      const tx = bx + fx * (radM * 0.86);
      const tz = bz + fz * (radM * 0.86);
      TEMP_POS.set(tx, heightAt(tx, tz) + 0.24, tz);
      TEMP_QUAT.setFromAxisAngle(UP, yawRad);
      TEMP_SCALE.set(5.4, 0.85, 1.35);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      crateMesh.setMatrixAt(crateCount, TEMP_MAT);
      crateMesh.setColorAt(crateCount, arrowCol);
      crateCount++;

      // 2) Outward-pointing arrow shaft from doorway threshold into the front apron
      const sx = bx + fx * (radM + 1.15);
      const sz = bz + fz * (radM + 1.15);
      TEMP_POS.set(sx, heightAt(sx, sz) + 0.24, sz);
      TEMP_QUAT.setFromAxisAngle(UP, yawRad);
      TEMP_SCALE.set(1.55, 0.85, 6.2);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      crateMesh.setMatrixAt(crateCount, TEMP_MAT);
      crateMesh.setColorAt(crateCount, arrowCol);
      crateCount++;

      // 3 & 4) Left & right chevron arrowhead wings meeting at (radM + 2.45 m)
      for (const side of [-1, 1] as const) {
        const wx = bx + fx * (radM + 1.95) + rx * (side * 0.62);
        const wz = bz + fz * (radM + 1.95) + rz * (side * 0.62);
        TEMP_POS.set(wx, heightAt(wx, wz) + 0.26, wz);
        TEMP_QUAT.setFromAxisAngle(UP, yawRad - side * 0.62);
        TEMP_SCALE.set(1.35, 0.90, 4.2);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        crateMesh.setMatrixAt(crateCount, TEMP_MAT);
        crateMesh.setColorAt(crateCount, arrowCol);
        crateCount++;
      }
    };

    if (formationGhost && formationGhost.active) {
      pushEntranceDirectionArrow(formationGhost.x, formationGhost.z, formationGhost.yawRad, 2.6, COL_VALID);
    }

    if (placementGhost && placementGhost.active && (placementGhost.mode === 'building' || placementGhost.mode === 'gate')) {
      const rad = placementGhost.buildingType ? BUILDING_DEFS[placementGhost.buildingType].radiusM : 3.4;
      const col = placementGhost.valid ? COL_VALID : COL_INVALID;
      pushEntranceDirectionArrow(placementGhost.x, placementGhost.z, placementGhost.yawRad, rad, col);

      // For Farm & Vineyard: preview the 12 rear cultivated field strips in Level 1 (green), Level 2 (amber), Level 3 (pale gold) (docs/MANUAL.md §4.1)!
      if (placementGhost.buildingType === 'farm' || placementGhost.buildingType === 'vineyard') {
        for (let si = 0; si < 12 && crateCount < 140; si++) {
          const st = computeBuildingStripTransform(placementGhost, si);
          TEMP_POS.set(st.cx, heightAt(st.cx, st.cz) + 0.16, st.cz);
          TEMP_QUAT.setFromAxisAngle(UP, placementGhost.yawRad);
          TEMP_SCALE.set(22.0, 0.35, 4.8);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          crateMesh.setMatrixAt(crateCount, TEMP_MAT);
          if (!placementGhost.valid) {
            crateMesh.setColorAt(crateCount, COL_INVALID);
          } else {
            COL_TMP.setHex(si < 4 ? 0x3dc468 : si < 8 ? 0xd9a838 : 0xe8deb5);
            crateMesh.setColorAt(crateCount, COL_TMP);
          }
          crateCount++;
        }
      }
    } else if (selectedBuildingId !== null) {
      const sb = state.buildings.find((b) => b.id === selectedBuildingId && b.hp > 0);
      if (sb && sb.type !== 'ruin') {
        const rad = BUILDING_DEFS[sb.type].radiusM;
        pushEntranceDirectionArrow(sb.x, sb.z, sb.yawRad, rad, COL_GOLD);
      }
    }

    // 3. Ballistic Projectiles (Arrows/Bolts + Cannonballs/Mortar Shells)
    let arrowCount = 0;
    let shellCount = 0;
    for (const p of state.projectiles) {
      const t = Math.max(0, Math.min(1, p.elapsedS / Math.max(0.05, p.flightTimeS)));
      const dtFlight = Math.max(0.05, p.flightTimeS);
      const vx = (p.targetX - p.startX) / dtFlight;
      const vz = (p.targetZ - p.startZ) / dtFlight;
      const vy = (p.targetY - p.startY + 4 * p.arcHeightM * (1 - 2 * t)) / dtFlight;

      if (p.kind === 'arrow' || p.kind === 'bolt') {
        if (arrowCount >= 240) continue;
        TEMP_POS.set(p.x, p.y, p.z);
        DIR_TMP.set(vx, vy, vz).normalize();
        const yaw = Math.atan2(DIR_TMP.x, DIR_TMP.z);
        const pitch = -Math.asin(Math.max(-0.98, Math.min(0.98, DIR_TMP.y)));
        TEMP_EULER.set(pitch, yaw, 0, 'YXZ');
        TEMP_QUAT.setFromEuler(TEMP_EULER);
        TEMP_SCALE.set(1, 1, p.kind === 'bolt' ? 0.78 : 1.15);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        arrowMesh.setMatrixAt(arrowCount, TEMP_MAT);
        arrowMesh.setColorAt(arrowCount, p.kind === 'bolt' ? COL_IRON : COL_ARROW);
        arrowCount++;
      } else {
        if (shellCount >= 48) continue;
        TEMP_POS.set(p.x, p.y, p.z);
        TEMP_QUAT.identity();
        const s = p.kind === 'mortar' ? 1.45 : 1.0;
        TEMP_SCALE.set(s, s, s);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        shellMesh.setMatrixAt(shellCount, TEMP_MAT);
        shellMesh.setColorAt(shellCount, p.kind === 'mortar' ? COL_FIRE : COL_IRON);
        shellCount++;
      }
    }

    // 4. Advance & Pack Volumetric View-Fresnel Blackpowder Smoke & Impact Dust Clouds
    const fadeArr = puffFadeAttr.array as Float32Array;
    let puffCount = 0;
    for (let i = puffs.length - 1; i >= 0; i--) {
      const pf = puffs[i]!;
      if (!paused && dtS > 0) {
        pf.ageS += dtS;
        pf.x += pf.vx * dtS;
        pf.y += pf.vy * dtS;
        pf.z += pf.vz * dtS;
        const drag = Math.exp(-dtS * 0.8);
        pf.vx *= drag;
        pf.vz *= drag;
      }
      if (pf.ageS >= pf.maxAgeS) {
        puffs.splice(i, 1);
        continue;
      }
      if (puffCount >= 180) continue;
      const u = pf.ageS / pf.maxAgeS;
      const sc = Math.max(0.05, pf.startScale + (pf.endScale - pf.startScale) * Math.sqrt(u));
      TEMP_POS.set(pf.x, pf.y, pf.z);
      TEMP_QUAT.setFromAxisAngle(UP, pf.spin + u * 0.6);
      TEMP_SCALE.set(sc, sc * 0.85, sc);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      puffMesh.setMatrixAt(puffCount, TEMP_MAT);
      // Softly cool smoke tint as it expands and dissipates
      COL_TMP.copy(pf.color).multiplyScalar(0.88 - u * 0.16);
      puffMesh.setColorAt(puffCount, COL_TMP);
      fadeArr[puffCount] = Math.pow(Math.max(0, 1 - u), 1.5);
      puffCount++;
    }
    if (puffCount === 0) {
      fadeArr[0] = 0;
    }
    puffFadeAttr.clearUpdateRanges();
    puffFadeAttr.addUpdateRange(0, Math.max(1, puffCount));
    puffFadeAttr.needsUpdate = true;

    // 5. Advance & Pack Crisp 120 ms Cannon/Mortar Muzzle Flashes
    let flashCount = 0;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i]!;
      if (!paused && dtS > 0) {
        fl.ageS += dtS;
      }
      if (fl.ageS >= fl.maxAgeS) {
        flashes.splice(i, 1);
        continue;
      }
      if (flashCount >= 24) continue;
      const u = fl.ageS / fl.maxAgeS;
      const sc = Math.max(0.05, fl.size * (1 - u * 0.72));
      TEMP_POS.set(fl.x, fl.y, fl.z);
      TEMP_QUAT.setFromAxisAngle(UP, fl.ageS * 14);
      TEMP_SCALE.set(sc, sc * 0.75, sc);
      TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
      flashMesh.setMatrixAt(flashCount, TEMP_MAT);
      flashMesh.setColorAt(flashCount, COL_FIRE);
      flashCount++;
    }

    finalizeBatch(horseMesh, horseCount);
    finalizeBatch(cannonMesh, cannonCount);
    finalizeBatch(crateMesh, crateCount);
    finalizeBatch(arrowMesh, arrowCount);
    finalizeBatch(shellMesh, shellCount);
    finalizeBatch(puffMesh, puffCount);
    finalizeBatch(flashMesh, flashCount);
    finalizeBatch(bannerMesh, bannerCount);
    finalizeBatch(ringMesh, ringCount);
  };

  return {
    spawnFxEvents,
    update,
    dispose() {
      for (const m of [
        horseMesh,
        cannonMesh,
        crateMesh,
        arrowMesh,
        shellMesh,
        puffMesh,
        flashMesh,
        bannerMesh,
        ringMesh,
      ]) {
        scene.remove(m);
      }
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
