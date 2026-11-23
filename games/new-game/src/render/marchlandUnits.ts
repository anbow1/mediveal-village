// GPU-Skinned High-Detail Medieval Soldiers, 40-Bone Animated Warhorses, Townsfolk & Transport Renderer
// Imported from anbow1/FPS (marchland) — 100% WebGPU TSL bone-matrix DataTexture instancing (1 draw call per kind,
// zero mid-play shader pipeline compilations):
//   - All 10 military unit types with Mixamo combat, walk/run, block, flinch & death clips
//   - 40-bone animated warhorses (idle, walk, gallop, graze, fall) + saddle cloth / caparison + lance, sword & shield
//   - Large heraldic heater shield attached to Halberdiers (Landsknecht) left forearm bone
//   - 7 diverse rigged male/female townsfolk with work animations (chop, swing, digging, harvest, fishing, boxwalk)
//   - Transport upgrades: L2 handcart.json pushed by carriers, L3 wagon.json + animated warhorse draft horse!

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  MeshStandardNodeMaterial,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  Vector3,
  type Node,
  type Scene,
} from 'three/webgpu';
import { abs, attribute, cos, Fn, int, ivec2, mix, normalLocal, sin, textureLoad, vec3, vec4 } from 'three/tsl';
import { UNIT_DEFS, type BuildingTypeId, type QualityPreset, type UnitTypeId } from '../config.ts';
import type { RegimentEntity, SimWorldState, SoldierEntity } from '../sim/types.ts';

interface ClipSpec {
  readonly name: string;
  readonly start: number;
  readonly frames: number;
  readonly fps: number;
  readonly travelM?: number;
}

interface RiggedModel {
  readonly bones: string[];
  readonly clips: ClipSpec[];
  readonly frames: number[];
  readonly positions: number[];
  readonly normals: number[];
  readonly colours: number[];
  readonly surface: number[];
  readonly skin: number[];
  readonly weights: number[];
  readonly triangles: number[];
  readonly saddle?: { readonly bone: number; readonly y: number; readonly z: number };
}

interface BodyModel {
  readonly pivots: { readonly hipY: number; readonly hipZ: number; readonly shoulderY: number; readonly shoulderZ: number };
  readonly positions: number[];
  readonly normals: number[];
  readonly colours: number[];
  readonly surface: number[];
  readonly limbs: number[];
  readonly triangles: number[];
}

interface PropModel {
  readonly size: number[];
  readonly positions: number[];
  readonly normals: number[];
  readonly colours: number[];
  readonly triangles: number[];
}

interface Clip {
  readonly start: number;
  readonly frames: number;
  readonly fps: number;
  readonly travelM?: number;
  readonly lower?: boolean;
}

interface SkinnedUnitPool {
  readonly mesh: InstancedMesh;
  readonly place: InstancedBufferAttribute;
  readonly anim: InstancedBufferAttribute;
  readonly side: InstancedBufferAttribute;
  readonly frame: InstancedBufferAttribute;
  readonly boneTex: DataTexture;
  readonly material: MeshStandardNodeMaterial;
  readonly fps: number;
  readonly strikes: Clip[];
  readonly guard: number;
  readonly blockHeld: number;
  readonly idle: Clip | null;
  readonly walk: Clip | null;
  readonly run: Clip | null;
  readonly impact: Clip | null;
  readonly deaths: Clip[];
  readonly draw: Clip | null;
  readonly shield: boolean;
  readonly reach: number;
  readonly horse?: { readonly idle: Clip; readonly walk: Clip; readonly gallop: Clip; readonly graze: Clip | null };
  readonly mounted: boolean;
}

interface EnginePool {
  readonly mesh: InstancedMesh;
  readonly place: InstancedBufferAttribute;
  readonly anim: InstancedBufferAttribute;
  readonly side: InstancedBufferAttribute;
  readonly material: MeshStandardNodeMaterial;
  readonly size: readonly number[];
}

interface FolkClips {
  readonly boxwalk: Clip;
  readonly boxidle: Clip;
  readonly walk: Clip;
  readonly idle: Clip;
  readonly pickup: Clip;
  readonly putdown: Clip;
  readonly digging: Clip;
  readonly fishing: Clip;
  readonly chop: Clip;
  readonly swing: Clip;
  readonly harvest: Clip;
}

interface FolkPool {
  readonly mesh: InstancedMesh;
  readonly place: InstancedBufferAttribute;
  readonly side: InstancedBufferAttribute;
  readonly frame: InstancedBufferAttribute;
  readonly boneTex: DataTexture;
  readonly material: MeshStandardNodeMaterial;
  readonly clips: FolkClips;
  count: number;
}

export interface MarchlandUnitsHandles {
  readonly syncFromSim: (state: SimWorldState, heightAt: (x: number, z: number) => number, simClockS: number) => void;
  readonly dispose: () => void;
}

const TEAM_COLORS = [new Color(0x2858a8), new Color(0xa82828)] as const;
const UNIT_CAP = 260;
const FOLK_CAP = 120;
const CART_CAP = 160;
const WALK_SWING_RAD = 0.62;
const STRIKE_RAD = 1.35;
const STRIKE_S = 0.45;
const FALL_S = 0.5;
const SINK_S = 2.0;
const BODY_SECONDS = 6.0;
const WALK_CYCLE_M = 1.6;
const RUN_CYCLE_M = 2.5;
const GALLOP_FROM_MS = 1.8;
const GALLOP_CYCLE_M = 3.0;
const AT_EASE_AFTER_S = 5.0;
const HOLD_AFTER_SHOT = 0.3;
const RECOIL_S = 1.6;
const IDENTITY_MAT = new Matrix4();
const ZERO_MAT = new Matrix4().makeScale(0, 0, 0);
const TEMP_MAT = new Matrix4();
const TEMP_POS = new Vector3();
const TEMP_QUAT = new Quaternion();
const TEMP_SCALE = new Vector3(1, 1, 1);
const UP = new Vector3(0, 1, 0);

const DIGGER_BUILDINGS: ReadonlySet<BuildingTypeId> = new Set(['quarry', 'ironMine']);
const HARVEST_BUILDINGS: ReadonlySet<BuildingTypeId> = new Set(['farm', 'vineyard']);

function interleave(g: BufferGeometry, parts: readonly [name: string, size: number, data: ArrayLike<number>][]): void {
  const stride = parts.reduce((sum, [, size]) => sum + size, 0);
  const first = parts[0]!;
  const n = first[2].length / first[1];
  const array = new Float32Array(n * stride);
  let offset = 0;
  for (const [, size, data] of parts) {
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < size; c++) {
        array[i * stride + offset + c] = data[i * size + c] ?? 0;
      }
    }
    offset += size;
  }
  const buffer = new InterleavedBuffer(array, stride);
  offset = 0;
  for (const [name, size] of parts) {
    g.setAttribute(name, new InterleavedBufferAttribute(buffer, size, offset));
    offset += size;
  }
}

function createBoneTexture(model: RiggedModel): DataTexture {
  const nb = model.bones.length;
  const frames = Math.floor(model.frames.length / (nb * 12));
  const data = new Float32Array(nb * 3 * frames * 4);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < nb; b++) {
      for (let r = 0; r < 3; r++) {
        const src = (f * nb + b) * 12 + r * 4;
        const dst = (f * nb * 3 + b * 3 + r) * 4;
        for (let c = 0; c < 4; c++) data[dst + c] = model.frames[src + c] ?? 0;
      }
    }
  }
  const tex = new DataTexture(data, nb * 3, frames, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function sanitizeNormals(normals: number[]): number[] {
  const out = normals.slice();
  for (let i = 0; i + 2 < out.length; i += 3) {
    const nx = out[i]!;
    const ny = out[i + 1]!;
    const nz = out[i + 2]!;
    const len = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(len) || len < 1e-4) {
      out[i] = 0;
      out[i + 1] = 1;
      out[i + 2] = 0;
    } else if (Math.abs(len - 1) > 1e-3) {
      out[i] = nx / len;
      out[i + 1] = ny / len;
      out[i + 2] = nz / len;
    }
  }
  return out;
}

function createSkinnedMaterial(bones: DataTexture, mounted = false): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    name: mounted ? 'MarchlandSkinnedHorseman' : 'MarchlandSkinnedFootman',
    side: DoubleSide,
  });
  const skin = attribute('aSkin', 'vec4');
  const weight = attribute('aWeight', 'vec4');
  const part = attribute('aPart', 'vec4');
  const surface = attribute('aSurface', 'vec3');
  const place = attribute('aPlace', 'vec4');
  const anim = attribute('aAnim', 'vec4');
  const side = attribute('aSide', 'float');
  const frame = attribute('aFrame', 'float');
  const t0 = TEAM_COLORS[0];
  const t1 = TEAM_COLORS[1];

  const row = (bone: Node<'float'>, r: number) =>
    textureLoad(bones, ivec2(int(bone).mul(3).add(r), int(frame)));

  const skinned = (v: Node<'vec3'>, w: number) => {
    const v4 = vec4(v, w);
    const one = (bone: Node<'float'>, k: Node<'float'>) =>
      vec3(row(bone, 0).dot(v4), row(bone, 1).dot(v4), row(bone, 2).dot(v4)).mul(k);
    return one(skin.x, weight.x).add(one(skin.y, weight.y)).add(one(skin.z, weight.z)).add(one(skin.w, weight.w));
  };

  const pose = (v: Node<'vec3'>) => {
    const cf = cos(anim.w);
    const sf = sin(anim.w);
    const fallen = mounted
      ? vec3(v.x.mul(cf).sub(v.y.mul(sf)), v.x.mul(sf).add(v.y.mul(cf)), v.z)
      : vec3(v.x, v.y.mul(cf).sub(v.z.mul(sf)), v.y.mul(sf).add(v.z.mul(cf)));
    const cy = cos(place.w);
    const sy = sin(place.w);
    return vec3(fallen.x.mul(cy).add(fallen.z.mul(sy)), fallen.y, fallen.z.mul(cy).sub(fallen.x.mul(sy)));
  };

  m.positionNode = Fn(() => {
    const p = skinned(vec3(attribute('position', 'vec3')), 1);
    const angle = part.z.mul(sin(anim.x)).mul(anim.y).mul(WALK_SWING_RAD).add(part.w.mul(anim.z));
    const c = cos(angle);
    const s = sin(angle);
    const ry = p.y.sub(part.x);
    const rz = p.z.sub(part.y);
    const bob = abs(sin(anim.x)).mul(anim.y).mul(0.05);
    const swung = vec3(p.x, part.x.add(ry.mul(c)).add(rz.mul(s)).add(bob), part.y.sub(ry.mul(s)).add(rz.mul(c)));
    const sn = skinned(vec3(attribute('normal', 'vec3')), 0).add(vec3(0, 1e-5, 0)).normalize();
    normalLocal.assign(pose(sn));
    return pose(swung).add(place.xyz);
  })();
  m.colorNode = mix(
    attribute('color', 'vec3'),
    mix(vec3(t0.r, t0.g, t0.b), vec3(t1.r, t1.g, t1.b), side),
    surface.z,
  );
  m.metalnessNode = surface.x;
  m.roughnessNode = surface.y;
  return m;
}

function createStaticUnitMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ name: 'MarchlandEngineMat', side: DoubleSide });
  const surface = attribute('aSurface', 'vec3');
  const place = attribute('aPlace', 'vec4');
  const side = attribute('aSide', 'float');
  const t0 = TEAM_COLORS[0];
  const t1 = TEAM_COLORS[1];

  const turn = (v: Node<'vec3'>) => {
    const cy = cos(place.w);
    const sy = sin(place.w);
    return vec3(v.x.mul(cy).add(v.z.mul(sy)), v.y, v.z.mul(cy).sub(v.x.mul(sy)));
  };

  m.positionNode = Fn(() => {
    normalLocal.assign(turn(vec3(attribute('normal', 'vec3')).add(vec3(0, 1e-5, 0)).normalize()));
    return turn(vec3(attribute('position', 'vec3'))).add(place.xyz);
  })();
  m.colorNode = mix(
    attribute('color', 'vec3'),
    mix(vec3(t0.r, t0.g, t0.b), vec3(t1.r, t1.g, t1.b), side),
    surface.z,
  );
  m.metalnessNode = surface.x;
  m.roughnessNode = surface.y;
  return m;
}

interface RawVertBuf {
  positions: number[];
  normals: number[];
  colours: number[];
  surface: number[];
  part: number[];
}

function pushBox(
  buf: RawVertBuf,
  cx: number,
  y0: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  hex: number,
  metal: number,
  rough: number,
  team: number,
  partVec: readonly [number, number, number, number] = [0, 0, 0, 0],
): void {
  const col = new Color(hex);
  const hx = sx * 0.5;
  const hz = sz * 0.5;
  const y1 = y0 + sy;
  const faces: readonly { n: readonly [number, number, number]; v: readonly (readonly [number, number, number])[] }[] = [
    { n: [0, 0, 1], v: [[-hx, y0, hz], [hx, y0, hz], [hx, y1, hz], [-hx, y1, hz]] },
    { n: [0, 0, -1], v: [[hx, y0, -hz], [-hx, y0, -hz], [-hx, y1, -hz], [hx, y1, -hz]] },
    { n: [1, 0, 0], v: [[hx, y0, hz], [hx, y0, -hz], [hx, y1, -hz], [hx, y1, hz]] },
    { n: [-1, 0, 0], v: [[-hx, y0, -hz], [-hx, y0, hz], [-hx, y1, hz], [-hx, y1, -hz]] },
    { n: [0, 1, 0], v: [[-hx, y1, hz], [hx, y1, hz], [hx, y1, -hz], [-hx, y1, -hz]] },
    { n: [0, -1, 0], v: [[-hx, y0, -hz], [hx, y0, -hz], [hx, y0, hz], [-hx, y0, hz]] },
  ];
  for (const f of faces) {
    const idx = [0, 1, 2, 0, 2, 3];
    for (const k of idx) {
      const pt = f.v[k]!;
      buf.positions.push(cx + pt[0], pt[1], cz + pt[2]);
      buf.normals.push(f.n[0], f.n[1], f.n[2]);
      buf.colours.push(col.r, col.g, col.b);
      buf.surface.push(metal, rough, team);
      buf.part.push(partVec[0], partVec[1], partVec[2], partVec[3]);
    }
  }
}

function pushTri(
  buf: RawVertBuf,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  col: Color,
  metal: number,
  rough: number,
  team: number,
  partVec: readonly [number, number, number, number],
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  for (const pt of [a, b, c]) {
    buf.positions.push(pt[0], pt[1], pt[2]);
    buf.normals.push(nx, ny, nz);
    buf.colours.push(col.r, col.g, col.b);
    buf.surface.push(metal, rough, team);
    buf.part.push(partVec[0], partVec[1], partVec[2], partVec[3]);
  }
}

function pushQuad(
  buf: RawVertBuf,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
  col: Color,
  metal: number,
  rough: number,
  team: number,
  partVec: readonly [number, number, number, number],
): void {
  pushTri(buf, a, b, c, col, metal, rough, team, partVec);
  pushTri(buf, a, c, d, col, metal, rough, team, partVec);
}

/**
 * Sculpted 14th-century curved Gothic Heater Shield:
 * smooth tapered pointed silhouette, convex front curvature, thin beveled steel border trim,
 * raised central iron boss & subtle heraldic cross band, and dark oak wooden backing.
 */
function pushHeaterShield(
  buf: RawVertBuf,
  cx: number,
  y0: number,
  cz: number,
  width: number,
  height: number,
  partVec: readonly [number, number, number, number] = [0, 0, 0, 0],
  yawRad = -0.58,
): void {
  const cy = Math.cos(yawRad);
  const sy = Math.sin(yawRad);
  const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [
    cx + lx * cy + lz * sy,
    y0 + ly,
    cz - lx * sy + lz * cy,
  ];

  // Authentic Gothic heater half-width profile from top (v = 1) down to bottom point (v = 0)
  const vSteps: readonly [number, number][] = [
    [0.0, 0.0],
    [0.14, 0.42],
    [0.32, 0.72],
    [0.54, 0.91],
    [0.76, 0.99],
    [0.92, 1.0],
    [1.0, 0.97],
  ];
  const uCols = [-1.0, -0.55, -0.14, 0.14, 0.55, 1.0];
  const hw = width * 0.5;
  const curveDepth = width * 0.16;
  const thick = 0.022;

  const colField = new Color(0xc8c4bc);
  const colRim = new Color(0xb4b8be);
  const colCross = new Color(0xd8b44c);
  const colWood = new Color(0x463222);

  const ptAt = (vIdx: number, u: number, front: boolean): [number, number, number] => {
    const [v, wFrac] = vSteps[vIdx]!;
    const lx = u * hw * wFrac;
    const archTop = v > 0.9 ? (1 - u * u) * height * 0.032 : 0;
    const ly = v * height + archTop;
    const bow = (1 - u * u) * curveDepth * Math.max(0.25, wFrac);
    const lz = front ? -bow : -bow + thick;
    return toWorld(lx, ly, lz);
  };

  for (let vi = 0; vi < vSteps.length - 1; vi++) {
    const vMid = (vSteps[vi]![0] + vSteps[vi + 1]![0]) * 0.5;
    for (let ui = 0; ui < uCols.length - 1; ui++) {
      const u0 = uCols[ui]!;
      const u1 = uCols[ui + 1]!;
      const uMid = (u0 + u1) * 0.5;
      const isCross = Math.abs(uMid) < 0.16 || (vMid > 0.54 && vMid < 0.76);
      const isOuterBand = vi === 0 || vi === vSteps.length - 2 || ui === 0 || ui === uCols.length - 2;

      const f00 = ptAt(vi, u0, true);
      const f10 = ptAt(vi, u1, true);
      const f11 = ptAt(vi + 1, u1, true);
      const f01 = ptAt(vi + 1, u0, true);
      // Front face (faces outward -Z in local shield space)
      const cFront = isCross ? colCross : colField;
      const metalFront = isCross ? 0.65 : 0.06;
      const roughFront = isCross ? 0.36 : 0.58;
      const teamFront = isCross ? 0.0 : 0.92;
      pushQuad(buf, f00, f01, f11, f10, cFront, metalFront, roughFront, teamFront, partVec);

      // Dark oak wooden back face
      const b00 = ptAt(vi, u0, false);
      const b10 = ptAt(vi, u1, false);
      const b11 = ptAt(vi + 1, u1, false);
      const b01 = ptAt(vi + 1, u0, false);
      pushQuad(buf, b00, b10, b11, b01, colWood, 0.0, 0.88, 0.0, partVec);

      // Thin metallic steel edge bevel along the outer shield contour
      if (isOuterBand) {
        if (ui === 0) pushQuad(buf, b00, b01, f01, f00, colRim, 0.88, 0.34, 0.0, partVec);
        if (ui === uCols.length - 2) pushQuad(buf, f10, f11, b11, b10, colRim, 0.88, 0.34, 0.0, partVec);
        if (vi === vSteps.length - 2) pushQuad(buf, f01, b01, b11, f11, colRim, 0.88, 0.34, 0.0, partVec);
      }
    }
  }

  // Raised sculpted central steel boss (umbo) on the heraldic cross intersection
  const bossY = height * 0.64;
  const bossR = width * 0.13;
  const apex = toWorld(0, bossY, -curveDepth - 0.042);
  const segs = 6;
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const p0 = toWorld(Math.cos(a0) * bossR, bossY + Math.sin(a0) * bossR, -curveDepth - 0.004);
    const p1 = toWorld(Math.cos(a1) * bossR, bossY + Math.sin(a1) * bossR, -curveDepth - 0.004);
    pushTri(buf, p0, apex, p1, colRim, 0.92, 0.28, 0.0, partVec);
  }
}

/**
 * Sculpted 3D Medieval Knight's War Lance (or Light Cavalry Spear):
 * 8-sided tapered ash-wood shaft tilted naturally forward, conical steel vamplate handguard,
 * faceted 4-sided diamond steel spearpoint, and flowing curved swallowtail heraldic pennon!
 */
function pushWarLance(
  buf: RawVertBuf,
  gripX: number,
  gripY: number,
  gripZ: number,
  poleLen: number,
  heavy: boolean,
  partVec: readonly [number, number, number, number],
): void {
  // Natural martial forward cant (~16 deg toward -Z) instead of a rigid vertical broomstick
  const tiltRad = heavy ? 0.28 : 0.22;
  const ct = Math.cos(tiltRad);
  const st = Math.sin(tiltRad);
  // Local axis: s along lance shaft (0 = grip hand, positive = toward tip), lx = right, lz = perpendicular back
  const toWorld = (lx: number, s: number, lz: number): [number, number, number] => [
    gripX + lx,
    gripY + s * ct + lz * st,
    gripZ - s * st + lz * ct,
  ];

  const colWood = new Color(0x5d4129);
  const colGrip = new Color(0x2e2118);
  const colSteel = new Color(0xc8cdd4);
  const colGold = new Color(0xd6ae46);
  const colPennon = new Color(0xd0ccc4);

  const pushFrustum = (
    s0: number,
    s1: number,
    r0: number,
    r1: number,
    sides: number,
    col: Color,
    metal: number,
    rough: number,
  ) => {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const sn0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const sn1 = Math.sin(a1);
      const p00 = toWorld(c0 * r0, s0, sn0 * r0);
      const p10 = toWorld(c1 * r0, s0, sn1 * r0);
      const p11 = toWorld(c1 * r1, s1, sn1 * r1);
      const p01 = toWorld(c0 * r1, s1, sn0 * r1);
      pushQuad(buf, p00, p10, p11, p01, col, metal, rough, 0.0, partVec);
    }
  };

  const buttS = -poleLen * 0.26;
  const tipBaseS = poleLen * 0.74;
  // Counterbalance butt -> leather grip -> tapered fluted lance shaft -> steel socket ferrule
  pushFrustum(buttS, -0.14, heavy ? 0.036 : 0.026, heavy ? 0.024 : 0.021, 7, colWood, 0.0, 0.85);
  pushFrustum(-0.14, 0.14, heavy ? 0.022 : 0.020, heavy ? 0.022 : 0.020, 7, colGrip, 0.0, 0.90);
  if (heavy) {
    // Classic conical polished steel vamplate handguard in front of knight's gauntlet!
    pushFrustum(0.14, 0.34, 0.115, 0.036, 8, colSteel, 0.94, 0.28);
    // Vamplate rear rim disc
    const rimCenter = toWorld(0, 0.14, 0);
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      const a1 = ((i + 1) / 8) * Math.PI * 2;
      pushTri(
        buf,
        rimCenter,
        toWorld(Math.cos(a1) * 0.115, 0.14, Math.sin(a1) * 0.115),
        toWorld(Math.cos(a0) * 0.115, 0.14, Math.sin(a0) * 0.115),
        colSteel,
        0.92,
        0.34,
        0.0,
        partVec,
      );
    }
    pushFrustum(0.34, tipBaseS - 0.12, 0.034, 0.017, 7, colWood, 0.0, 0.82);
  } else {
    pushFrustum(0.14, tipBaseS - 0.10, 0.022, 0.015, 6, colWood, 0.0, 0.84);
  }
  // Polished steel ferrule collar
  pushFrustum(tipBaseS - 0.12, tipBaseS, 0.018, 0.021, 6, colSteel, 0.92, 0.32);

  // Faceted 4-sided diamond-section steel lancehead
  const headLen = heavy ? 0.38 : 0.32;
  const shoulderS = tipBaseS + 0.07;
  const tipPt = toWorld(0, tipBaseS + headLen, 0);
  const wB = heavy ? 0.034 : 0.028;
  const dB = heavy ? 0.016 : 0.013;
  const ring: [number, number, number][] = [
    toWorld(wB, shoulderS, 0),
    toWorld(0, shoulderS, dB),
    toWorld(-wB, shoulderS, 0),
    toWorld(0, shoulderS, -dB),
  ];
  const baseR: [number, number, number][] = [
    toWorld(0.018, tipBaseS, 0),
    toWorld(0, tipBaseS, 0.014),
    toWorld(-0.018, tipBaseS, 0),
    toWorld(0, tipBaseS, -0.014),
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pushQuad(buf, baseR[i]!, baseR[j]!, ring[j]!, ring[i]!, colSteel, 0.96, 0.24, 0.0, partVec);
    pushTri(buf, ring[i]!, ring[j]!, tipPt, colSteel, 0.96, 0.22, 0.0, partVec);
  }

  // Flowing curved forked swallowtail heraldic pennon streaming behind the lancehead (+Z)
  if (heavy) {
    const pTop = tipBaseS - 0.04;
    const pBot = pTop - 0.26;
    const segs = 4;
    const len = 0.72;
    for (let k = 0; k < segs; k++) {
      const f0 = k / segs;
      const f1 = (k + 1) / segs;
      const z0 = 0.02 + f0 * len;
      const z1 = 0.02 + f1 * len;
      const wave0 = Math.sin(f0 * Math.PI * 1.6) * 0.045;
      const wave1 = Math.sin(f1 * Math.PI * 1.6) * 0.045;
      const drop0 = f0 * 0.11;
      const drop1 = f1 * 0.11;
      const half0 = (pTop - pBot) * 0.5 * (1 - f0 * 0.52);
      const half1 = (pTop - pBot) * 0.5 * (1 - f1 * 0.52);
      const mid0 = (pTop + pBot) * 0.5 - drop0;
      const mid1 = (pTop + pBot) * 0.5 - drop1;
      if (k < segs - 1) {
        const a = toWorld(wave0, mid0 + half0, z0);
        const b = toWorld(wave1, mid1 + half1, z1);
        const c = toWorld(wave1, mid1 - half1, z1);
        const d = toWorld(wave0, mid0 - half0, z0);
        pushQuad(buf, a, b, c, d, colPennon, 0.0, 0.72, 0.92, partVec);
        // Subtle gold heraldic header stripe near socket
        if (k === 0) {
          const ga = toWorld(wave0 + 0.004, mid0 + half0 * 0.35, z0);
          const gb = toWorld(wave1 + 0.004, mid1 + half1 * 0.35, z1);
          const gc = toWorld(wave1 + 0.004, mid1 - half1 * 0.35, z1);
          const gd = toWorld(wave0 + 0.004, mid0 - half0 * 0.35, z0);
          pushQuad(buf, ga, gb, gc, gd, colGold, 0.55, 0.42, 0.0, partVec);
        }
      } else {
        // Forked swallowtail twin tips!
        const topA = toWorld(wave0, mid0 + half0, z0);
        const midA = toWorld(wave0, mid0, z0);
        const botA = toWorld(wave0, mid0 - half0, z0);
        const tipUp = toWorld(wave1, mid1 + half1 * 0.95, z1 + 0.14);
        const tipDn = toWorld(wave1, mid1 - half1 * 0.95, z1 + 0.14);
        pushTri(buf, topA, tipUp, midA, colPennon, 0.0, 0.72, 0.92, partVec);
        pushTri(buf, midA, tipDn, botA, colPennon, 0.0, 0.72, 0.92, partVec);
      }
    }
  }
}

/** Sculpted medieval arming sword in dark leather scabbard with steel crossguard & wheel pommel. */
function pushArmingSword(
  buf: RawVertBuf,
  x: number,
  y: number,
  z: number,
  partVec: readonly [number, number, number, number],
): void {
  // Scabbard angled gently backward at left hip
  pushBox(buf, x, y - 0.42, z + 0.08, 0.036, 0.78, 0.022, 0x35251a, 0.05, 0.84, 0.0, partVec);
  // Steel scabbard chape & locket
  pushBox(buf, x, y - 0.46, z + 0.08, 0.026, 0.06, 0.024, 0xbec4cc, 0.92, 0.34, 0.0, partVec);
  // Crossguard, leather grip & brass wheel pommel
  pushBox(buf, x, y + 0.36, z + 0.08, 0.17, 0.028, 0.034, 0xc2c7ce, 0.94, 0.30, 0.0, partVec);
  pushBox(buf, x, y + 0.39, z + 0.08, 0.026, 0.14, 0.026, 0x2d1d14, 0.0, 0.88, 0.0, partVec);
  pushBox(buf, x, y + 0.53, z + 0.08, 0.048, 0.048, 0.030, 0xcba648, 0.82, 0.32, 0.0, partVec);
}

/** Cuts a saddle blanket (lightCav) or full caparison with gilt hem (heavyCav) from the warhorse's own skinned mesh. */
function buildCaparison(horse: RiggedModel, heavy: boolean) {
  const sy = horse.saddle?.y ?? 1.4;
  const sz = horse.saddle?.z ?? 0;
  const [front, back, drop, out] = heavy ? [0.85, 0.75, 0.62, 0.035] : [0.36, 0.34, 0.4, 0.025];
  const hemY = sy - drop + 0.07;
  const n = horse.positions.length / 3;
  const inside = (i: number): boolean => {
    const y = horse.positions[i * 3 + 1]!;
    const dz = horse.positions[i * 3 + 2]! - sz;
    return dz > -front && dz < back && y > sy - drop && y < sy + 0.06;
  };
  const map = new Int32Array(n).fill(-1);
  const c = {
    positions: [] as number[],
    normals: [] as number[],
    colours: [] as number[],
    surface: [] as number[],
    skin: [] as number[],
    weights: [] as number[],
    triangles: [] as number[],
  };
  for (let t = 0; t + 2 < horse.triangles.length; t += 3) {
    const tri = [horse.triangles[t]!, horse.triangles[t + 1]!, horse.triangles[t + 2]!];
    if (!tri.every(inside)) continue;
    for (const v of tri) {
      if (map[v] === -1) {
        map[v] = c.skin.length / 4;
        const nx = horse.normals[v * 3]!;
        const ny = horse.normals[v * 3 + 1]!;
        const nz = horse.normals[v * 3 + 2]!;
        const y = horse.positions[v * 3 + 1]!;
        c.positions.push(horse.positions[v * 3]! + nx * out, y + ny * out, horse.positions[v * 3 + 2]! + nz * out);
        c.normals.push(nx, ny, nz);
        const hem = heavy && y < hemY;
        // Rich deep medieval wool/velvet base tint (avoids pastel pink washout in bright sunlight!)
        c.colours.push(...(hem ? [0.64, 0.48, 0.14] : [0.56, 0.54, 0.50]));
        c.surface.push(hem ? 0.55 : 0, hem ? 0.42 : 0.90, hem ? 0 : 0.88);
        for (let k = 0; k < 4; k++) {
          c.skin.push(horse.skin[v * 4 + k]!);
          c.weights.push(horse.weights[v * 4 + k]!);
        }
      }
      c.triangles.push(map[v]!);
    }
  }
  return c;
}

const RIDE = { gallop: { lean: -0.14, sway: 0.09, beats: 1 }, walk: { lean: -0.03, sway: 0.03, beats: 2 } };

function withRiderBone(horse: RiggedModel, walk: Clip, gallop: Clip): RiggedModel {
  const nb = horse.bones.length;
  const frames = Math.floor(horse.frames.length / (nb * 12));
  const out = new Array<number>(frames * (nb + 1) * 12);
  const sy = horse.saddle?.y ?? 1.4;
  const sz = horse.saddle?.z ?? 0;
  const sBone = horse.saddle?.bone ?? 0;
  const pivot = new Vector3(0, sy, sz);
  const toPivot = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const fromPivot = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const saddle = new Matrix4();
  const rock = new Matrix4();
  const lean = (f: number): number => {
    for (const [clip, ride] of [
      [gallop, RIDE.gallop],
      [walk, RIDE.walk],
    ] as const) {
      if (f >= clip.start && f < clip.start + clip.frames) {
        return ride.lean + ride.sway * Math.sin(((f - clip.start) / clip.frames) * Math.PI * 2 * ride.beats);
      }
    }
    return 0;
  };
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < nb * 12; i++) out[f * (nb + 1) * 12 + i] = horse.frames[f * nb * 12 + i]!;
    const m = (f * nb + sBone) * 12;
    const row = (k: number): number => horse.frames[m + k]!;
    saddle.set(row(0), row(1), row(2), row(3), row(4), row(5), row(6), row(7), row(8), row(9), row(10), row(11), 0, 0, 0, 1);
    rock.makeRotationX(lean(f)).premultiply(toPivot).multiply(fromPivot);
    const e = saddle.multiply(rock).elements;
    const o = (f * (nb + 1) + nb) * 12;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) out[o + r * 4 + c] = e[c * 4 + r]!;
    }
  }
  return { ...horse, bones: [...horse.bones, 'Rider'], frames: out };
}

function findReachFrame(model: RiggedModel, clip: Clip): number {
  const joint = model.bones.indexOf('Sword_joint');
  if (joint < 0) return clip.start;
  const n = model.positions.length / 3;
  let tip = -1;
  for (let i = 0; i < n; i++) {
    if (model.skin[i * 4] !== joint) continue;
    if (tip < 0 || model.positions[i * 3 + 2]! < model.positions[tip * 3 + 2]!) tip = i;
  }
  if (tip < 0) return clip.start;
  const x = model.positions[tip * 3]!;
  const y = model.positions[tip * 3 + 1]!;
  const z = model.positions[tip * 3 + 2]!;
  const nb = model.bones.length;
  let best = clip.start;
  let bestZ = Number.POSITIVE_INFINITY;
  for (let f = clip.start; f < clip.start + clip.frames; f++) {
    const o = (f * nb + joint) * 12 + 8;
    const tz = model.frames[o]! * x + model.frames[o + 1]! * y + model.frames[o + 2]! * z + model.frames[o + 3]!;
    const ty = model.frames[o - 4]! * x + model.frames[o - 3]! * y + model.frames[o - 2]! * z + model.frames[o - 1]!;
    const score = tz + Math.max(0, ty - 1.6) * 1.5;
    if (score < bestZ) {
      bestZ = score;
      best = f;
    }
  }
  return best;
}

function buildMountedPool(
  scene: Scene,
  name: string,
  heavy: boolean,
  horse: RiggedModel,
  rider: BodyModel,
): SkinnedUnitPool | null {
  const named = (nm: string): Clip | null => horse.clips.find((c) => c.name === nm) ?? null;
  const idle = named('idle');
  const walk = named('walk');
  const gallop = named('gallop');
  if (!idle || !walk || !gallop) return null;

  const sy = horse.saddle?.y ?? 1.4;
  const sz = horse.saddle?.z ?? 0;
  const dy = sy - rider.pivots.hipY;
  const dz = sz - rider.pivots.hipZ;
  const shY = rider.pivots.shoulderY + dy;
  const shZ = rider.pivots.shoulderZ + dz;

  // Build rider + fitted surcoat + lance/pike + side sword + heraldic heater shield!
  const extras: RawVertBuf = { positions: [], normals: [], colours: [], surface: [], part: [] };
  const shieldPart: readonly [number, number, number, number] = [shY, shZ, -0.15, 0];
  const weaponPart: readonly [number, number, number, number] = [shY - 0.5, shZ - 0.1, 0.12, 1];

  // Shield angled naturally along the rider's front-left shoulder/flank
  pushHeaterShield(
    extras,
    -0.34,
    sy - 0.04,
    sz - 0.14,
    heavy ? 0.44 : 0.36,
    heavy ? 0.60 : 0.50,
    shieldPart,
    -0.62,
  );

  // Primary polearm: Heavy Knight = 3.35 m sculpted war lance with steel vamplate & swallowtail pennon; Light Cav = 2.55 m spear
  const poleLen = heavy ? 3.35 : 2.55;
  pushWarLance(extras, 0.33, shY - 0.42, sz - 0.14, poleLen, heavy, weaponPart);

  // Side arming sword in leather scabbard at left hip
  pushArmingSword(extras, -0.25, sy + 0.06, sz + 0.04, [0, 0, 0, 0]);

  // Fitted surcoat over rider torso
  const coatTris: number[] = [];
  for (let k = 0; k + 2 < rider.triangles.length; k += 3) {
    const c0 = rider.triangles[k]!;
    const c1 = rider.triangles[k + 1]!;
    const c2 = rider.triangles[k + 2]!;
    if (
      [c0, c1, c2].every(
        (v) =>
          rider.limbs[v] === 0 &&
          rider.positions[v * 3 + 1]! > rider.pivots.hipY - 0.22 &&
          rider.positions[v * 3 + 1]! < rider.pivots.shoulderY - 0.03,
      )
    ) {
      coatTris.push(c0, c1, c2);
    }
  }

  const cloth = buildCaparison(horse, heavy);
  const nh = horse.positions.length / 3;
  const nc = cloth.skin.length / 4;
  const nr = rider.triangles.length;
  const ne = extras.positions.length / 3;
  const nCoat = coatTris.length;
  const total = nh + nc + nr + ne + nCoat;

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const surf = new Float32Array(total * 3);
  const skin = new Float32Array(total * 4);
  const weights = new Float32Array(total * 4);
  const part = new Float32Array(total * 4);

  // 1. Horse
  pos.set(horse.positions, 0);
  nor.set(horse.normals, 0);
  col.set(horse.colours, 0);
  surf.set(horse.surface, 0);
  skin.set(horse.skin, 0);
  weights.set(horse.weights, 0);

  // 2. Caparison / Saddle cloth
  pos.set(cloth.positions, nh * 3);
  nor.set(cloth.normals, nh * 3);
  col.set(cloth.colours, nh * 3);
  surf.set(cloth.surface, nh * 3);
  skin.set(cloth.skin, nh * 4);
  weights.set(cloth.weights, nh * 4);

  // 3. Rider body (bound to synthetic Rider bone = horse.bones.length)
  const riderBone = horse.bones.length;
  const ARM_PARTS: readonly (readonly [number, number, number, number])[] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [shY, shZ, -0.5, 0],
    [shY, shZ, 0.5, -0.45],
  ];
  let cursor = nh + nc;
  for (let k = 0; k < nr; k++) {
    const v = rider.triangles[k]!;
    pos[cursor * 3] = rider.positions[v * 3]!;
    pos[cursor * 3 + 1] = rider.positions[v * 3 + 1]! + dy;
    pos[cursor * 3 + 2] = rider.positions[v * 3 + 2]! + dz;
    nor[cursor * 3] = rider.normals[v * 3]!;
    nor[cursor * 3 + 1] = rider.normals[v * 3 + 1]!;
    nor[cursor * 3 + 2] = rider.normals[v * 3 + 2]!;
    // Light cavalry gets leather-brown armour tint; heavy knights keep polished steel plate!
    const tintMul = heavy ? 1.0 : 0.72;
    col[cursor * 3] = rider.colours[v * 3]! * (heavy ? 1.0 : 0.88);
    col[cursor * 3 + 1] = rider.colours[v * 3 + 1]! * tintMul;
    col[cursor * 3 + 2] = rider.colours[v * 3 + 2]! * (heavy ? 1.0 : 0.56);
    surf[cursor * 3] = heavy ? rider.surface[v * 2]! : rider.surface[v * 2]! * 0.25;
    surf[cursor * 3 + 1] = heavy ? rider.surface[v * 2 + 1]! : 0.82;
    surf[cursor * 3 + 2] = 0;
    const p = ARM_PARTS[rider.limbs[v] ?? 0]!;
    part[cursor * 4] = p[0];
    part[cursor * 4 + 1] = p[1];
    part[cursor * 4 + 2] = p[2];
    part[cursor * 4 + 3] = p[3];
    skin[cursor * 4] = riderBone;
    weights[cursor * 4] = 1;
    cursor++;
  }

  // 4. Extras (shield, lance/pike, sword)
  for (let k = 0; k < ne; k++) {
    pos[cursor * 3] = extras.positions[k * 3]!;
    pos[cursor * 3 + 1] = extras.positions[k * 3 + 1]!;
    pos[cursor * 3 + 2] = extras.positions[k * 3 + 2]!;
    nor[cursor * 3] = extras.normals[k * 3]!;
    nor[cursor * 3 + 1] = extras.normals[k * 3 + 1]!;
    nor[cursor * 3 + 2] = extras.normals[k * 3 + 2]!;
    col[cursor * 3] = extras.colours[k * 3]!;
    col[cursor * 3 + 1] = extras.colours[k * 3 + 1]!;
    col[cursor * 3 + 2] = extras.colours[k * 3 + 2]!;
    surf[cursor * 3] = extras.surface[k * 3]!;
    surf[cursor * 3 + 1] = extras.surface[k * 3 + 1]!;
    surf[cursor * 3 + 2] = extras.surface[k * 3 + 2]!;
    part[cursor * 4] = extras.part[k * 4]!;
    part[cursor * 4 + 1] = extras.part[k * 4 + 1]!;
    part[cursor * 4 + 2] = extras.part[k * 4 + 2]!;
    part[cursor * 4 + 3] = extras.part[k * 4 + 3]!;
    skin[cursor * 4] = riderBone;
    weights[cursor * 4] = 1;
    cursor++;
  }

  // 5. Fitted surcoat
  for (let k = 0; k < nCoat; k++) {
    const v = coatTris[k]!;
    const nx = rider.normals[v * 3]!;
    const ny = rider.normals[v * 3 + 1]!;
    const nz = rider.normals[v * 3 + 2]!;
    pos[cursor * 3] = rider.positions[v * 3]! + nx * 0.022;
    pos[cursor * 3 + 1] = rider.positions[v * 3 + 1]! + dy + ny * 0.022;
    pos[cursor * 3 + 2] = rider.positions[v * 3 + 2]! + dz + nz * 0.022;
    nor[cursor * 3] = nx;
    nor[cursor * 3 + 1] = ny;
    nor[cursor * 3 + 2] = nz;
    col[cursor * 3] = 0.85;
    col[cursor * 3 + 1] = 0.84;
    col[cursor * 3 + 2] = 0.8;
    surf[cursor * 3] = 0;
    surf[cursor * 3 + 1] = 0.85;
    surf[cursor * 3 + 2] = 0.9;
    skin[cursor * 4] = riderBone;
    weights[cursor * 4] = 1;
    cursor++;
  }

  const index = new Uint32Array(horse.triangles.length + cloth.triangles.length + nr + ne + nCoat);
  index.set(horse.triangles, 0);
  for (let i = 0; i < cloth.triangles.length; i++) index[horse.triangles.length + i] = cloth.triangles[i]! + nh;
  const baseUnindexed = horse.triangles.length + cloth.triangles.length;
  for (let i = 0; i < nr + ne + nCoat; i++) index[baseUnindexed + i] = nh + nc + i;

  const g = new BufferGeometry();
  interleave(g, [
    ['position', 3, pos],
    ['normal', 3, nor],
    ['color', 3, col],
    ['aSurface', 3, surf],
  ]);
  interleave(g, [
    ['aSkin', 4, skin],
    ['aWeight', 4, weights],
    ['aPart', 4, part],
  ]);
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();

  const place = new InstancedBufferAttribute(new Float32Array(UNIT_CAP * 4), 4);
  const anim = new InstancedBufferAttribute(new Float32Array(UNIT_CAP * 4), 4);
  const side = new InstancedBufferAttribute(new Float32Array(UNIT_CAP), 1);
  const frame = new InstancedBufferAttribute(new Float32Array(UNIT_CAP), 1);
  for (const attr of [place, anim, side, frame]) attr.setUsage(DynamicDrawUsage);
  g.setAttribute('aPlace', place);
  g.setAttribute('aAnim', anim);
  g.setAttribute('aSide', side);
  g.setAttribute('aFrame', frame);

  const boneTex = createBoneTexture(withRiderBone(horse, walk, gallop));
  const material = createSkinnedMaterial(boneTex, true);
  const mesh = new InstancedMesh(g, material, UNIT_CAP);
  mesh.name = name;
  for (let i = 0; i < UNIT_CAP; i++) mesh.setMatrixAt(i, IDENTITY_MAT);
  // Pre-warm with count = 1 parked underground so GPU pipeline compiles during warmUp()
  place.setXYZW(0, 0, -500, 0, 0);
  mesh.count = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const fallClip = named('fall');
  return {
    mesh,
    place,
    anim,
    side,
    frame,
    boneTex,
    material,
    fps: idle.fps,
    strikes: [],
    guard: idle.start,
    blockHeld: idle.start,
    idle,
    walk,
    run: gallop,
    impact: null,
    deaths: fallClip ? [fallClip] : [],
    draw: null,
    shield: true,
    reach: idle.start,
    horse: { idle, walk, gallop, graze: named('graze') },
    mounted: true,
  };
}

function buildRiggedFootPool(
  scene: Scene,
  name: string,
  model: RiggedModel,
  attachLargeShield = false,
): SkinnedUnitPool | null {
  const strikes: Clip[] = model.clips
    .filter((c) => /slash|thrust|stab|recoil|chop|lower/.test(c.name.toLowerCase()))
    .map((c) => ({ start: c.start, frames: c.frames, fps: c.fps, lower: c.name.toLowerCase() === 'lower' }));
  const strike = model.clips.find((c) => /slash|thrust|stab|recoil|chop|lower/.test(c.name.toLowerCase()));
  const block = model.clips.find((c) => c.name.toLowerCase().includes('block'));
  if (!strike || !block) return null;

  const named = (nm: string): Clip | null => model.clips.find((c) => c.name.toLowerCase() === nm) ?? null;
  const deaths = model.clips.filter((c) => c.name.toLowerCase().startsWith('death'));

  const n = model.positions.length / 3;
  const shieldBuf: RawVertBuf = { positions: [], normals: [], colours: [], surface: [], part: [] };
  let shieldBone = -1;
  if (attachLargeShield) {
    shieldBone = model.bones.indexOf('Shield_joint');
    if (shieldBone < 0) shieldBone = model.bones.indexOf('LeftForeArm');
    if (shieldBone >= 0) {
      // Attach large heraldic Landsknecht shield on left forearm in rest-pose space
      let ax = -0.34;
      let ay = 1.02;
      let az = -0.14;
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        if (model.skin[i * 4] === shieldBone) {
          ax += model.positions[i * 3]!;
          ay += model.positions[i * 3 + 1]!;
          az += model.positions[i * 3 + 2]!;
          cnt++;
        }
      }
      if (cnt > 0) {
        ax = (ax + 0.34) / cnt - 0.08;
        ay = (ay - 1.02) / cnt - 0.42;
        az = (az + 0.14) / cnt - 0.12;
      }
      pushHeaterShield(shieldBuf, ax, ay, az, 0.56, 0.86);
    }
  }

  const ns = shieldBuf.positions.length / 3;
  const total = n + ns;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const surf = new Float32Array(total * 3);
  const skin = new Float32Array(total * 4);
  const weights = new Float32Array(total * 4);
  const part = new Float32Array(total * 4);

  pos.set(model.positions, 0);
  nor.set(sanitizeNormals(model.normals), 0);
  col.set(model.colours, 0);
  surf.set(model.surface, 0);
  skin.set(model.skin, 0);
  weights.set(model.weights, 0);

  if (ns > 0 && shieldBone >= 0) {
    pos.set(shieldBuf.positions, n * 3);
    nor.set(shieldBuf.normals, n * 3);
    col.set(shieldBuf.colours, n * 3);
    surf.set(shieldBuf.surface, n * 3);
    for (let i = 0; i < ns; i++) {
      skin[(n + i) * 4] = shieldBone;
      weights[(n + i) * 4] = 1;
    }
  }

  const index = new Uint32Array(model.triangles.length + ns);
  index.set(model.triangles, 0);
  for (let i = 0; i < ns; i++) index[model.triangles.length + i] = n + i;

  const g = new BufferGeometry();
  interleave(g, [
    ['position', 3, pos],
    ['normal', 3, nor],
    ['color', 3, col],
    ['aSurface', 3, surf],
  ]);
  interleave(g, [
    ['aSkin', 4, skin],
    ['aWeight', 4, weights],
    ['aPart', 4, part],
  ]);
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();

  const place = new InstancedBufferAttribute(new Float32Array(UNIT_CAP * 4), 4);
  const anim = new InstancedBufferAttribute(new Float32Array(UNIT_CAP * 4), 4);
  const side = new InstancedBufferAttribute(new Float32Array(UNIT_CAP), 1);
  const frame = new InstancedBufferAttribute(new Float32Array(UNIT_CAP), 1);
  for (const attr of [place, anim, side, frame]) attr.setUsage(DynamicDrawUsage);
  g.setAttribute('aPlace', place);
  g.setAttribute('aAnim', anim);
  g.setAttribute('aSide', side);
  g.setAttribute('aFrame', frame);

  const boneTex = createBoneTexture(model);
  const material = createSkinnedMaterial(boneTex, false);
  const mesh = new InstancedMesh(g, material, UNIT_CAP);
  mesh.name = name;
  for (let i = 0; i < UNIT_CAP; i++) mesh.setMatrixAt(i, IDENTITY_MAT);
  place.setXYZW(0, 0, -500, 0, 0);
  mesh.count = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    mesh,
    place,
    anim,
    side,
    frame,
    boneTex,
    material,
    fps: strike.fps,
    strikes,
    guard: block.start,
    blockHeld: block.start + Math.floor(block.frames * 0.5),
    idle: named('idle'),
    walk: named('walk'),
    run: named('run'),
    impact: named('impact'),
    deaths,
    draw: named('draw'),
    shield: attachLargeShield || model.skin.some((b, i) => i % 4 === 0 && b === model.bones.indexOf('Shield_joint')),
    reach: findReachFrame(model, strike),
    mounted: false,
  };
}

function buildEnginePool(scene: Scene, name: string, model: PropModel): EnginePool {
  const n = model.triangles.length;
  const flagBuf: RawVertBuf = { positions: [], normals: [], colours: [], surface: [], part: [] };
  const back = (model.size[2] ?? 1.6) * 0.5 + 0.2;
  pushBox(flagBuf, 0, 0, back, 0.05, 1.6, 0.05, 0x4a3b30, 0, 0.9, 0);
  pushBox(flagBuf, 0.25, 1.15, back, 0.5, 0.35, 0.03, 0xffffff, 0, 0.7, 1);
  const nf = flagBuf.positions.length / 3;
  const total = n + nf;

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const surf = new Float32Array(total * 3);
  for (let k = 0; k < n; k++) {
    const v = model.triangles[k]!;
    pos[k * 3] = model.positions[v * 3]!;
    pos[k * 3 + 1] = model.positions[v * 3 + 1]!;
    pos[k * 3 + 2] = model.positions[v * 3 + 2]!;
    nor[k * 3] = model.normals[v * 3]!;
    nor[k * 3 + 1] = model.normals[v * 3 + 1]!;
    nor[k * 3 + 2] = model.normals[v * 3 + 2]!;
    col[k * 3] = model.colours[v * 3]!;
    col[k * 3 + 1] = model.colours[v * 3 + 1]!;
    col[k * 3 + 2] = model.colours[v * 3 + 2]!;
    surf[k * 3] = 0.25;
    surf[k * 3 + 1] = 0.72;
    surf[k * 3 + 2] = 0;
  }
  pos.set(flagBuf.positions, n * 3);
  nor.set(flagBuf.normals, n * 3);
  col.set(flagBuf.colours, n * 3);
  surf.set(flagBuf.surface, n * 3);

  const g = new BufferGeometry();
  interleave(g, [
    ['position', 3, pos],
    ['normal', 3, nor],
    ['color', 3, col],
    ['aSurface', 3, surf],
  ]);
  g.computeBoundingSphere();

  const place = new InstancedBufferAttribute(new Float32Array(48 * 4), 4);
  const anim = new InstancedBufferAttribute(new Float32Array(48 * 4), 4);
  const side = new InstancedBufferAttribute(new Float32Array(48), 1);
  for (const attr of [place, anim, side]) attr.setUsage(DynamicDrawUsage);
  g.setAttribute('aPlace', place);
  g.setAttribute('aAnim', anim);
  g.setAttribute('aSide', side);

  const material = createStaticUnitMaterial();
  const mesh = new InstancedMesh(g, material, 48);
  mesh.name = name;
  for (let i = 0; i < 48; i++) mesh.setMatrixAt(i, IDENTITY_MAT);
  place.setXYZW(0, 0, -500, 0, 0);
  mesh.count = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return { mesh, place, anim, side, material, size: model.size };
}

function buildFolkPool(scene: Scene, name: string, model: RiggedModel): FolkPool | null {
  const find = (nm: string): Clip | null => model.clips.find((c) => c.name === nm) ?? null;
  const idle = find('idle');
  const walk = find('walk');
  if (!idle || !walk) return null;
  const clips: FolkClips = {
    boxwalk: find('boxwalk') ?? walk,
    boxidle: find('boxidle') ?? idle,
    walk,
    idle,
    pickup: find('pickup') ?? idle,
    putdown: find('putdown') ?? idle,
    digging: find('digging') ?? idle,
    fishing: find('fishing') ?? idle,
    chop: find('chop') ?? idle,
    swing: find('swing') ?? idle,
    harvest: find('harvest') ?? idle,
  };

  const n = model.positions.length / 3;
  const g = new BufferGeometry();
  interleave(g, [
    ['position', 3, model.positions],
    ['normal', 3, sanitizeNormals(model.normals)],
    ['color', 3, model.colours],
    ['aSurface', 3, model.surface],
  ]);
  interleave(g, [
    ['aSkin', 4, model.skin],
    ['aWeight', 4, model.weights],
    ['aPart', 4, new Float32Array(n * 4)],
  ]);
  g.setIndex(model.triangles);
  g.computeBoundingSphere();

  const place = new InstancedBufferAttribute(new Float32Array(FOLK_CAP * 4), 4);
  const anim = new InstancedBufferAttribute(new Float32Array(FOLK_CAP * 4), 4);
  const side = new InstancedBufferAttribute(new Float32Array(FOLK_CAP), 1);
  const frame = new InstancedBufferAttribute(new Float32Array(FOLK_CAP), 1);
  for (const attr of [place, anim, side, frame]) attr.setUsage(DynamicDrawUsage);
  g.setAttribute('aPlace', place);
  g.setAttribute('aAnim', anim);
  g.setAttribute('aSide', side);
  g.setAttribute('aFrame', frame);

  const boneTex = createBoneTexture(model);
  const material = createSkinnedMaterial(boneTex, false);
  const mesh = new InstancedMesh(g, material, FOLK_CAP);
  mesh.name = name;
  for (let i = 0; i < FOLK_CAP; i++) mesh.setMatrixAt(i, IDENTITY_MAT);
  place.setXYZW(0, 0, -500, 0, 0);
  mesh.count = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return { mesh, place, side, frame, boneTex, material, clips, count: 0 };
}

function buildPropMesh(scene: Scene, name: string, model: PropModel, dx: number, dy: number, dz: number, scale: number, tipBarrow = false): InstancedMesh {
  const n = model.triangles.length;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const cleanNormals = sanitizeNormals(model.normals);

  // Tip handcart so handles rise into carrier's hands (from FPS/marchland peopleView.ts)
  const cosA = tipBarrow ? Math.cos(-0.42) : 1;
  const sinA = tipBarrow ? Math.sin(-0.42) : 0;

  for (let k = 0; k < n; k++) {
    const v = model.triangles[k]!;
    const px = model.positions[v * 3]! * scale;
    let py = model.positions[v * 3 + 1]! * scale;
    let pz = model.positions[v * 3 + 2]! * scale;
    let ny = cleanNormals[v * 3 + 1]!;
    let nz = cleanNormals[v * 3 + 2]!;
    if (tipBarrow) {
      const ry = py - 0.18 * scale;
      const rz = pz - 0.59 * scale;
      py = 0.18 * scale + ry * cosA - rz * sinA;
      pz = 1.18 + ry * sinA + rz * cosA;
      const tny = ny * cosA - nz * sinA;
      const tnz = ny * sinA + nz * cosA;
      ny = tny;
      nz = tnz;
    }
    pos[k * 3] = px + dx;
    pos[k * 3 + 1] = py + dy;
    pos[k * 3 + 2] = pz + dz;
    nor[k * 3] = cleanNormals[v * 3]!;
    nor[k * 3 + 1] = ny;
    nor[k * 3 + 2] = nz;
    col[k * 3] = model.colours[v * 3]!;
    col[k * 3 + 1] = model.colours[v * 3 + 1]!;
    col[k * 3 + 2] = model.colours[v * 3 + 2]!;
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();

  const mat = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: DoubleSide });
  mat.name = `${name}_Mat`;
  const mesh = new InstancedMesh(g, mat, CART_CAP);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.setMatrixAt(0, ZERO_MAT);
  mesh.count = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function buildDraftHorsePool(scene: Scene, horse: RiggedModel): SkinnedUnitPool | null {
  const named = (nm: string): Clip | null => horse.clips.find((c) => c.name === nm) ?? null;
  const idle = named('idle');
  const walk = named('walk');
  const gallop = named('gallop');
  if (!idle || !walk || !gallop) return null;

  const n = horse.positions.length / 3;
  const g = new BufferGeometry();
  interleave(g, [
    ['position', 3, horse.positions],
    ['normal', 3, horse.normals],
    ['color', 3, horse.colours],
    ['aSurface', 3, horse.surface],
  ]);
  interleave(g, [
    ['aSkin', 4, horse.skin],
    ['aWeight', 4, horse.weights],
    ['aPart', 4, new Float32Array(n * 4)],
  ]);
  g.setIndex(horse.triangles);
  g.computeBoundingSphere();

  const horseCap = CART_CAP + 64;
  const place = new InstancedBufferAttribute(new Float32Array(horseCap * 4), 4);
  const anim = new InstancedBufferAttribute(new Float32Array(horseCap * 4), 4);
  const side = new InstancedBufferAttribute(new Float32Array(horseCap), 1);
  const frame = new InstancedBufferAttribute(new Float32Array(horseCap), 1);
  for (const attr of [place, anim, side, frame]) attr.setUsage(DynamicDrawUsage);
  g.setAttribute('aPlace', place);
  g.setAttribute('aAnim', anim);
  g.setAttribute('aSide', side);
  g.setAttribute('aFrame', frame);

  const boneTex = createBoneTexture(horse);
  const material = createSkinnedMaterial(boneTex, true);
  const mesh = new InstancedMesh(g, material, horseCap);
  mesh.name = 'MarchlandDraftAndPaddockHorses';
  for (let i = 0; i < horseCap; i++) mesh.setMatrixAt(i, IDENTITY_MAT);
  place.setXYZW(0, 0, -500, 0, 0);
  mesh.count = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    mesh,
    place,
    anim,
    side,
    frame,
    boneTex,
    material,
    fps: idle.fps,
    strikes: [],
    guard: idle.start,
    blockHeld: idle.start,
    idle,
    walk,
    run: gallop,
    impact: null,
    deaths: [],
    draw: null,
    shield: false,
    reach: idle.start,
    horse: { idle, walk, gallop, graze: named('graze') },
    mounted: true,
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function buildMarchlandUnits(
  scene: Scene,
  quality: QualityPreset = 'high',
  onProgress?: (done: number, total: number) => void,
): Promise<MarchlandUnitsHandles | null> {
  const base = 'assets/marchland';
  const unitPools = new Map<UnitTypeId, SkinnedUnitPool>();
  const engines = new Map<'cannon' | 'mortar', EnginePool>();
  const folkPools: FolkPool[] = [];
  let handcartMesh: InstancedMesh | null = null;
  let wagonMesh: InstancedMesh | null = null;
  let pigMesh: InstancedMesh | null = null;
  let draftHorsePool: SkinnedUnitPool | null = null;

  // Tier villager variety by preset so 3 GB tablets (iPad 7 / Tab S2) never hit WebKit OOM:
  // minimal: 2 (male+female), low: 4 (2 men + 2 women), high: all 7 variants.
  const folkFiles =
    quality === 'minimal'
      ? ['townsman.json', 'townswoman.json']
      : quality === 'low'
        ? ['townsman.json', 'townsman-beard.json', 'townswoman.json', 'townswoman-dress.json']
        : [
            'townsman.json',
            'townsman-wool.json',
            'townsman-beard.json',
            'townsman-linen.json',
            'townswoman.json',
            'townswoman-dress.json',
            'townswoman-worker.json',
          ];

  const totalSteps = 6 + 2 + 5 + folkFiles.length;
  let doneSteps = 0;
  const stepDone = () => {
    doneSteps++;
    onProgress?.(doneSteps, totalSteps);
  };

  // Load each rigged JSON one batch at a time (concurrency 2) and immediately convert it into compact
  // GPU buffers/DataTexture so the multi-MB JS JSON object can be garbage-collected right away!
  const runLimited = async <T,>(items: readonly T[], limit: number, fn: (item: T, idx: number) => Promise<void>): Promise<void> => {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const i = cursor++;
        await fn(items[i]!, i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  };

  const footSpecs: readonly [UnitTypeId, string, boolean][] = [
    ['militia', 'militia.json', false],
    ['pikemen', 'pikeman.json', false],
    ['archers', 'archer.json', false],
    ['crossbowmen', 'crossbowman.json', false],
    ['swordsmen', 'swordsman.json', false],
    // Halberdiers (Lancknechci): full plate + two-handed polearm (historically no shield!)
    ['halberdiers', 'halberdier.json', false],
  ];

  await runLimited(footSpecs, 2, async ([kind, file, largeShield]) => {
    const m = await fetchJson<RiggedModel>(`${base}/soldiers/${file}`);
    if (m) {
      const pool = buildRiggedFootPool(scene, `ML_Unit_${kind}`, m, largeShield);
      if (pool) unitPools.set(kind, pool);
    }
    stepDone();
  });

  // Mounted units + draft horse share warhorse.json & rider.json
  const [riderM, warhorseM] = await Promise.all([
    fetchJson<BodyModel>(`${base}/soldiers/rider.json`).finally(stepDone),
    fetchJson<RiggedModel>(`${base}/soldiers/warhorse.json`).finally(stepDone),
  ]);
  if (riderM && warhorseM) {
    const lc = buildMountedPool(scene, 'ML_Unit_lightCav', false, warhorseM, riderM);
    if (lc) unitPools.set('lightCav', lc);
    const hc = buildMountedPool(scene, 'ML_Unit_heavyCav', true, warhorseM, riderM);
    if (hc) unitPools.set('heavyCav', hc);
  }
  if (warhorseM) {
    draftHorsePool = buildDraftHorsePool(scene, warhorseM);
  }

  // Small prop JSONs (cannons, mortars, handcarts, wagons, livestock pigs)
  const [cannonM, mortarM, handcartM, wagonM, pigM] = await Promise.all([
    fetchJson<PropModel>(`${base}/props/cannon.json`).finally(stepDone),
    fetchJson<PropModel>(`${base}/props/mortar.json`).finally(stepDone),
    fetchJson<PropModel>(`${base}/props/handcart.json`).finally(stepDone),
    fetchJson<PropModel>(`${base}/props/wagon.json`).finally(stepDone),
    fetchJson<PropModel>(`${base}/props/pig.json`).finally(stepDone),
  ]);
  if (cannonM) engines.set('cannon', buildEnginePool(scene, 'ML_Engine_cannon', cannonM));
  if (mortarM) engines.set('mortar', buildEnginePool(scene, 'ML_Engine_mortar', mortarM));
  if (handcartM) handcartMesh = buildPropMesh(scene, 'ML_Handcarts', handcartM, 0, 0, 0, 1.2, true);
  if (wagonM) wagonMesh = buildPropMesh(scene, 'ML_Wagons', wagonM, 1.0, 0, -0.3, 1.0, false);
  if (pigM) pigMesh = buildPropMesh(scene, 'ML_LivestockPigs', pigM, 0, 0, 0, 1.0, false);

  // Townsfolk models (2 MB each): load 2 at a time so peak JS heap stays tiny on 3 GB iPads
  const builtFolks: (FolkPool | null)[] = new Array(folkFiles.length).fill(null);
  await runLimited(folkFiles, 2, async (file, idx) => {
    const fm = await fetchJson<RiggedModel>(`${base}/people/${file}`);
    if (fm) builtFolks[idx] = buildFolkPool(scene, `ML_Folk_${idx}`, fm);
    stepDone();
  });
  for (const fp of builtFolks) {
    if (fp) folkPools.push(fp);
  }

  if (!unitPools.has('swordsmen') || folkPools.length === 0) {
    console.warn('[marchlandUnits] Missing rigged models under assets/marchland; falling back.');
    return null;
  }

  // Per-entity visual motion trackers eliminate walk/idle flicker on soldiers & artillery crews AND prevent any worker sliding!
  interface MotionTracker {
    prevX: number;
    prevZ: number;
    smoothSpeed: number;
    strideM: number;
    moving: boolean;
    lastClockS: number;
  }
  const soldierMotion = new Map<number, MotionTracker>();
  const citizenMotion = new Map<number, MotionTracker>();
  let lastSyncClockS = -1;

  const updateTracker = (
    map: Map<number, MotionTracker>,
    key: number,
    x: number,
    z: number,
    simSpeedHint: number,
    clockS: number,
    enterSpeed: number,
    exitSpeed: number,
  ): MotionTracker => {
    let tr = map.get(key);
    if (!tr) {
      tr = { prevX: x, prevZ: z, smoothSpeed: simSpeedHint, strideM: 0, moving: simSpeedHint > enterSpeed, lastClockS: clockS };
      map.set(key, tr);
      return tr;
    }
    const dt = clockS - tr.lastClockS;
    if (dt > 1e-4) {
      const dx = x - tr.prevX;
      const dz = z - tr.prevZ;
      const moved = Math.hypot(dx, dz);
      // Ignore teleports > 8 m in a single step
      const instSpeed = moved < 8 ? moved / dt : 0;
      const targetSpeed = Math.max(instSpeed, simSpeedHint);
      const alpha = Math.min(1, dt * 7.5);
      tr.smoothSpeed += (targetSpeed - tr.smoothSpeed) * alpha;
      if (moved < 8) {
        tr.strideM += moved;
      }
      if (tr.moving) {
        if (tr.smoothSpeed < exitSpeed) tr.moving = false;
      } else if (tr.smoothSpeed > enterSpeed) {
        tr.moving = true;
      }
      tr.prevX = x;
      tr.prevZ = z;
      tr.lastClockS = clockS;
    }
    return tr;
  };

  const at = (c: Clip, t: number, fps: number): number => c.start + Math.min(c.frames - 1, Math.max(0, Math.floor(t * fps)));
  const cycle = (c: Clip, phase: number): number => c.start + (Math.floor((((phase % 1) + 1) % 1) * c.frames) % c.frames);

  const pickSoldierFrame = (
    pool: SkinnedUnitPool,
    reg: RegimentEntity,
    s: SoldierEntity,
    speed: number,
    isMoving: boolean,
    strideM: number,
    simClockS: number,
  ): number => {
    if (pool.horse) {
      const h = pool.horse;
      const loop = (c: Clip): number => cycle(c, simClockS / (c.frames / pool.fps) + s.slotIndex * 0.37);
      if (!s.alive) return pool.deaths[0] ? at(pool.deaths[0], s.deadS ?? 0, pool.fps) : h.idle.start;
      if (speed > GALLOP_FROM_MS) return cycle(h.gallop, strideM / GALLOP_CYCLE_M);
      if (isMoving) return cycle(h.walk, strideM / Math.max(0.5, h.walk.travelM ?? 1));
      const hurtS = simClockS - (s.hurtAtS ?? -1e9);
      const atEase = reg.outOfCombatS > AT_EASE_AFTER_S && (s.sinceAttackS ?? 99) > AT_EASE_AFTER_S && hurtS > AT_EASE_AFTER_S;
      return atEase && h.graze && s.slotIndex % 3 === 0 ? loop(h.graze) : loop(h.idle);
    }

    if (!s.alive) {
      const death = pool.deaths[s.slotIndex % Math.max(1, pool.deaths.length)];
      return death ? at(death, s.deadS ?? 0, pool.fps) : pool.guard;
    }

    const sinceAtk = s.sinceAttackS ?? 99;
    const blow = pool.strikes[s.slotIndex % Math.max(1, pool.strikes.length)];
    if (blow) {
      const strikeS = Math.min(blow.frames / pool.fps, 1.25);
      if (sinceAtk < strikeS) {
        const t = sinceAtk / strikeS;
        if (blow.lower) {
          if (t < HOLD_AFTER_SHOT) return blow.start + blow.frames - 1;
          return blow.start + Math.max(0, blow.frames - 1 - Math.floor(((t - HOLD_AFTER_SHOT) / (1 - HOLD_AFTER_SHOT)) * blow.frames));
        }
        return blow.start + Math.min(blow.frames - 1, Math.floor(t * blow.frames));
      }
    }

    const hurtS = simClockS - (s.hurtAtS ?? -1e9);
    if (pool.impact && hurtS >= 0 && hurtS < pool.impact.frames / pool.fps) {
      return at(pool.impact, hurtS, pool.fps);
    }

    const def = UNIT_DEFS[reg.unitType];
    if (isMoving) {
      if (pool.run && speed > (def.walkSpeedMs + def.runSpeedMs) * 0.5) {
        return cycle(pool.run, strideM / RUN_CYCLE_M);
      }
      if (pool.walk) {
        return cycle(pool.walk, strideM / ((pool.walk.travelM ?? 0) > 0.5 ? pool.walk.travelM! : WALK_CYCLE_M));
      }
    }

    if (pool.draw && def.ranged) {
      const drawS = pool.draw.frames / pool.fps;
      const shooting = sinceAtk < def.ranged.reloadS * 1.6;
      if (shooting && s.rangedCooldownS < drawS) {
        return at(pool.draw, drawS - s.rangedCooldownS, pool.fps);
      }
      return pool.idle ? cycle(pool.idle, simClockS / (pool.idle.frames / pool.fps) + s.slotIndex * 0.37) : pool.guard;
    }

    if (reg.stance === 'shieldWall' && pool.shield) return pool.blockHeld;
    if (reg.stance === 'pikeWall' || reg.formation === 'schiltron') return pool.reach;
    const fighting = reg.outOfCombatS < AT_EASE_AFTER_S || sinceAtk < AT_EASE_AFTER_S || hurtS < AT_EASE_AFTER_S;
    if (!fighting && pool.idle) {
      return cycle(pool.idle, simClockS / (pool.idle.frames / pool.fps) + s.slotIndex * 0.37);
    }
    return pool.shield ? pool.guard : pool.reach;
  };

  const syncFromSim = (state: SimWorldState, heightAt: (x: number, z: number) => number, simClockS: number): void => {
    // Reset motion trackers cleanly if a new match/snapshot loaded (clock jumped backwards)
    if (simClockS < lastSyncClockS - 0.5) {
      soldierMotion.clear();
      citizenMotion.clear();
    }
    lastSyncClockS = simClockS;

    // 1. Soldiers & Cavalry
    const unitCounts = new Map<UnitTypeId, number>();
    for (const k of unitPools.keys()) unitCounts.set(k, 0);
    const engineCounts: Record<'cannon' | 'mortar', number> = { cannon: 0, mortar: 0 };

    const bldById = new Map<number, BuildingTypeId>();
    for (const b of state.buildings) bldById.set(b.id, b.type);

    for (const reg of state.regiments) {
      if (reg.garrisonedInBuildingId !== null) continue;
      const def = UNIT_DEFS[reg.unitType];

      if (reg.unitType === 'cannon' || reg.unitType === 'mortar') {
        const ep = engines.get(reg.unitType);
        if (!ep) continue;
        const pArr = ep.place.array as Float32Array;
        const sArr = ep.side.array as Float32Array;
        for (const s of reg.soldiers) {
          if (!s.alive) continue;
          const idx = engineCounts[reg.unitType];
          if (idx >= 48) break;
          const trKey = reg.id * 64 + s.slotIndex;
          updateTracker(soldierMotion, trKey, s.x, s.z, reg.currentSpeedMs, simClockS, 0.14, 0.06);
          const sinceAtk = s.sinceAttackS ?? 99;
          let back = 0;
          if (sinceAtk < RECOIL_S) {
            const t = sinceAtk / RECOIL_S;
            back = (reg.unitType === 'mortar' ? 0.12 : 0.85) * (t < 0.08 ? t / 0.08 : (1 - t) ** 2);
          }
          const gx = s.x - Math.sin(s.yawRad) * back;
          const gz = s.z - Math.cos(s.yawRad) * back;
          pArr[idx * 4] = gx;
          pArr[idx * 4 + 1] = heightAt(gx, gz);
          pArr[idx * 4 + 2] = gz;
          pArr[idx * 4 + 3] = s.yawRad + Math.PI;
          sArr[idx] = reg.side;
          engineCounts[reg.unitType] = idx + 1;
        }
        continue;
      }

      const pool = unitPools.get(reg.unitType);
      if (!pool) continue;
      const pArr = pool.place.array as Float32Array;
      const aArr = pool.anim.array as Float32Array;
      const sArr = pool.side.array as Float32Array;
      const fArr = pool.frame.array as Float32Array;

      for (const s of reg.soldiers) {
        const deadS = s.deadS ?? 0;
        if (!s.alive && deadS >= BODY_SECONDS) continue;
        const idx = unitCounts.get(reg.unitType) ?? 0;
        if (idx >= UNIT_CAP) break;

        let y = heightAt(s.x, s.z);
        let fall = 0;
        if (!s.alive) {
          if (pool.deaths.length === 0) fall = Math.min(1, deadS / FALL_S) * (Math.PI * 0.5);
          y -= Math.max(0, deadS - (BODY_SECONDS - SINK_S)) * 0.45;
        }

        const trKey = reg.id * 64 + s.slotIndex;
        const simHint = s.alive ? Math.max(s.speedMs ?? 0, reg.currentSpeedMs * 0.85) : 0;
        const tr = updateTracker(soldierMotion, trKey, s.x, s.z, simHint, simClockS, 0.18, 0.08);
        const speed = s.alive ? tr.smoothSpeed : 0;
        const isMoving = s.alive && tr.moving;
        const strideM = Math.max(s.travelM, tr.strideM);
        const sinceAtk = s.sinceAttackS ?? 99;
        const strikeAmt = s.alive && sinceAtk < STRIKE_S ? Math.sin((sinceAtk / STRIKE_S) * Math.PI) : 0;

        pArr[idx * 4] = s.x;
        pArr[idx * 4 + 1] = y;
        pArr[idx * 4 + 2] = s.z;
        // FPS/marchland soldier models face -Z; heading yawRad looks along (+sin, +cos)
        pArr[idx * 4 + 3] = s.yawRad + Math.PI;

        aArr[idx * 4] = ((strideM / (pool.mounted ? 3.2 : 1.5)) % 1) * Math.PI * 2;
        aArr[idx * 4 + 1] = pool.walk ? 0 : Math.min(1, speed / Math.max(0.5, def.walkSpeedMs * 0.9));
        aArr[idx * 4 + 2] = strikeAmt * STRIKE_RAD;
        aArr[idx * 4 + 3] = fall;

        sArr[idx] = reg.side;
        fArr[idx] = pickSoldierFrame(pool, reg, s, speed, isMoving, strideM, simClockS);
        unitCounts.set(reg.unitType, idx + 1);
      }
    }

    // 1b. Render garrisoned Archers / Crossbowmen visibly standing on Watchtower battlements (FPS/marchland writeGarrisons)!
    const enemyKeepBySide = new Map<number, { x: number; z: number }>();
    for (const b of state.buildings) {
      if (b.type === 'keep' && b.hp > 0) enemyKeepBySide.set(b.side === 0 ? 1 : 0, { x: b.x, z: b.z });
    }
    for (const b of state.buildings) {
      if (b.type !== 'watchtower' || b.hp <= 0 || b.buildProgress < 1) continue;
      if (b.garrisonCount <= 0 || !b.garrisonType) continue;
      const pool = unitPools.get(b.garrisonType);
      if (!pool) continue;
      const uDef = UNIT_DEFS[b.garrisonType];
      const reloadS = uDef.ranged?.reloadS ?? 6;
      const topY = heightAt(b.x, b.z) + 9.0;

      // Aim toward nearest enemy regiment in range, else toward enemy Keep
      let lookX = enemyKeepBySide.get(b.side)?.x ?? b.x + (b.side === 0 ? 50 : -50);
      let lookZ = enemyKeepBySide.get(b.side)?.z ?? b.z;
      let nearestD = (uDef.ranged?.maxRangeM ?? 80) + 25;
      for (const reg of state.regiments) {
        if (reg.side === b.side || reg.garrisonedInBuildingId !== null) continue;
        if (!reg.soldiers.some((s) => s.alive)) continue;
        const d = Math.hypot(reg.x - b.x, reg.z - b.z);
        if (d < nearestD) {
          nearestD = d;
          lookX = reg.x;
          lookZ = reg.z;
        }
      }
      const lookYaw = Math.atan2(lookX - b.x, lookZ - b.z);
      const cb = Math.cos(b.yawRad);
      const sb = Math.sin(b.yawRad);
      const pArr = pool.place.array as Float32Array;
      const aArr = pool.anim.array as Float32Array;
      const sArr = pool.side.array as Float32Array;
      const fArr = pool.frame.array as Float32Array;
      const slots = Math.min(4, b.garrisonCount);

      for (let m = 0; m < slots; m++) {
        const idx = unitCounts.get(b.garrisonType) ?? 0;
        if (idx >= UNIT_CAP) break;
        const ax = (m % 2 === 0 ? -1 : 1) * 1.25;
        const az = (m < 2 ? -1 : 1) * 1.25;
        pArr[idx * 4] = b.x + ax * cb + az * sb;
        pArr[idx * 4 + 1] = topY;
        pArr[idx * 4 + 2] = b.z - ax * sb + az * cb;
        pArr[idx * 4 + 3] = lookYaw + Math.PI;
        aArr[idx * 4] = 0;
        aArr[idx * 4 + 1] = 0;
        aArr[idx * 4 + 2] = 0;
        aArr[idx * 4 + 3] = 0;
        sArr[idx] = b.side;
        if (pool.draw && b.fireCooldownS > 0 && b.fireCooldownS < reloadS * 0.5) {
          const drawS = pool.draw.frames / pool.fps;
          const phase = Math.max(0, Math.min(drawS, drawS * (1 - b.fireCooldownS / (reloadS * 0.5))));
          fArr[idx] = at(pool.draw, phase, pool.fps);
        } else {
          fArr[idx] = pool.idle
            ? cycle(pool.idle, simClockS / (pool.idle.frames / pool.fps) + (b.id + m) * 0.37)
            : pool.guard;
        }
        unitCounts.set(b.garrisonType, idx + 1);
      }
    }

    for (const [kind, pool] of unitPools) {
      const cnt = unitCounts.get(kind) ?? 0;
      if (cnt === 0) {
        pool.place.setXYZW(0, 0, -500, 0, 0);
        pool.mesh.count = 1;
        pool.mesh.visible = false;
      } else {
        pool.mesh.visible = true;
        pool.mesh.count = cnt;
      }
      pool.place.needsUpdate = true;
      pool.anim.needsUpdate = true;
      pool.side.needsUpdate = true;
      pool.frame.needsUpdate = true;
    }

    for (const kind of ['cannon', 'mortar'] as const) {
      const ep = engines.get(kind);
      if (!ep) continue;
      const cnt = engineCounts[kind];
      if (cnt === 0) {
        ep.place.setXYZW(0, 0, -500, 0, 0);
        ep.mesh.count = 1;
        ep.mesh.visible = false;
      } else {
        ep.mesh.visible = true;
        ep.mesh.count = cnt;
      }
      ep.place.needsUpdate = true;
      ep.side.needsUpdate = true;
    }

    // 2. Townsfolk (carriers, builders, workers) + Transport L2 Handcarts + L3 Wagons & Draft Horses!
    for (const fp of folkPools) fp.count = 0;
    let handcartCount = 0;
    let wagonCount = 0;
    let draftHorseCount = 0;

    for (const c of state.citizens) {
      if (folkPools.length === 0) break;
      const fp = folkPools[c.id % folkPools.length]!;
      const idx = fp.count;
      if (idx >= FOLK_CAP) continue;

      const y = heightAt(c.x, c.z);
      const pArr = fp.place.array as Float32Array;
      const sArr = fp.side.array as Float32Array;
      const fArr = fp.frame.array as Float32Array;
      const clips = fp.clips;

      pArr[idx * 4] = c.x;
      pArr[idx * 4 + 1] = y;
      pArr[idx * 4 + 2] = c.z;
      pArr[idx * 4 + 3] = c.yawRad + Math.PI;
      sArr[idx] = c.side;

      const tLvl = state.sides[c.side].transportLevel ?? 1;
      const isCarrier = c.role === 'carrier';
      const carrying = isCarrier && c.carryingGood !== null;
      const pathHint = c.path.length > 0 ? 1.0 : 0;
      const ctr = updateTracker(citizenMotion, c.id, c.x, c.z, pathHint, simClockS, 0.12, 0.05);
      const moving = ctr.moving;
      const strideM = Math.max(c.travelM, ctr.strideM);
      const bType = c.assignedBuildingId !== null ? bldById.get(c.assignedBuildingId) : undefined;

      let frameVal: number;
      if (moving) {
        const wClip = carrying && tLvl === 1 ? clips.boxwalk : clips.walk;
        frameVal = cycle(wClip, strideM / Math.max(0.6, wClip.travelM ?? WALK_CYCLE_M));
      } else if (c.role === 'builder' && c.workPhase === 'working') {
        frameVal = cycle(clips.swing, simClockS / (clips.swing.frames / clips.swing.fps) + c.id * 0.23);
      } else if (c.role === 'worker' && c.workPhase === 'working') {
        if (bType === 'woodcutter' || bType === 'forester') {
          frameVal = cycle(clips.chop, simClockS / (clips.chop.frames / clips.chop.fps) + c.id * 0.19);
        } else if (bType && DIGGER_BUILDINGS.has(bType)) {
          frameVal = cycle(clips.digging, simClockS / (clips.digging.frames / clips.digging.fps) + c.id * 0.29);
        } else if (bType && HARVEST_BUILDINGS.has(bType)) {
          frameVal = cycle(clips.harvest, simClockS / (clips.harvest.frames / clips.harvest.fps) + c.id * 0.31);
        } else if (bType === 'fisher') {
          frameVal = cycle(clips.fishing, simClockS / (clips.fishing.frames / clips.fishing.fps) + c.id * 0.17);
        } else {
          frameVal = cycle(clips.pickup, simClockS / (clips.pickup.frames / clips.pickup.fps) + c.id * 0.13);
        }
      } else {
        const iClip = carrying && tLvl === 1 ? clips.boxidle : clips.idle;
        frameVal = cycle(iClip, simClockS / (iClip.frames / iClip.fps) + c.id * 0.37);
      }
      fArr[idx] = frameVal;
      fp.count++;

      // Render L2 Handcart or L3 Horse & Wagon for active carriers!
      if (isCarrier && c.carryJob !== null) {
        if (tLvl === 2 && handcartMesh && handcartCount < CART_CAP) {
          TEMP_POS.set(c.x, y, c.z);
          TEMP_QUAT.setFromAxisAngle(UP, c.yawRad);
          TEMP_SCALE.set(1, 1, 1);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          handcartMesh.setMatrixAt(handcartCount++, TEMP_MAT);
        } else if (tLvl === 3 && wagonMesh && wagonCount < CART_CAP) {
          TEMP_POS.set(c.x, y, c.z);
          TEMP_QUAT.setFromAxisAngle(UP, c.yawRad);
          TEMP_SCALE.set(1, 1, 1);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          wagonMesh.setMatrixAt(wagonCount++, TEMP_MAT);

          if (draftHorsePool && draftHorseCount < CART_CAP) {
            const cosY = Math.cos(c.yawRad);
            const sinY = Math.sin(c.yawRad);
            const hx = c.x + 1.0 * cosY + 1.3 * sinY;
            const hz = c.z - 1.0 * sinY + 1.3 * cosY;
            const dP = draftHorsePool.place.array as Float32Array;
            const dF = draftHorsePool.frame.array as Float32Array;
            const dS = draftHorsePool.side.array as Float32Array;
            dP[draftHorseCount * 4] = hx;
            dP[draftHorseCount * 4 + 1] = heightAt(hx, hz);
            dP[draftHorseCount * 4 + 2] = hz;
            dP[draftHorseCount * 4 + 3] = c.yawRad + Math.PI;
            dS[draftHorseCount] = c.side;
            const hClips = draftHorsePool.horse!;
            dF[draftHorseCount] = moving
              ? cycle(hClips.walk, strideM / Math.max(0.6, hClips.walk.travelM ?? 1.2))
              : cycle(hClips.idle, simClockS / (hClips.idle.frames / draftHorsePool.fps) + c.id * 0.37);
            draftHorseCount++;
          }
        }
      }
    }

    // 3. Animated gun crewmen beside active cannons/mortars (FPS/marchland writeCrews: face forward & march smoothly while moving, load after firing!)
    if (folkPools.length > 0) {
      const fp = folkPools[0]!;
      const pArr = fp.place.array as Float32Array;
      const sArr = fp.side.array as Float32Array;
      const fArr = fp.frame.array as Float32Array;
      const { idle, walk, pickup, putdown } = fp.clips;
      for (const reg of state.regiments) {
        if (reg.unitType !== 'cannon' && reg.unitType !== 'mortar') continue;
        const reloadS = UNIT_DEFS[reg.unitType].ranged?.reloadS ?? 10;
        const spots: readonly (readonly [number, number, number])[] =
          reg.unitType === 'cannon'
            ? [
                [1.15, 0.5, 0.35],
                [-1.15, 0.2, -0.35],
              ]
            : [
                [1.3, 0.8, 0.4],
                [-1.3, 0.5, -0.45],
              ];
        for (const s of reg.soldiers) {
          if (!s.alive) continue;
          const tr = soldierMotion.get(reg.id * 64 + s.slotIndex);
          const gunMoving = tr ? tr.moving : reg.currentSpeedMs > 0.14;
          const gunStrideM = tr ? Math.max(s.travelM, tr.strideM) : s.travelM;
          const sinceAtk = s.sinceAttackS ?? 99;
          const w = s.yawRad + Math.PI;
          const cosW = Math.cos(w);
          const sinW = Math.sin(w);
          for (let k = 0; k < spots.length && fp.count < FOLK_CAP; k++) {
            const sp = spots[k]!;
            const wx = s.x + sp[0] * cosW + sp[1] * sinW;
            const wz = s.z + sp[1] * cosW - sp[0] * sinW;
            const idx = fp.count++;
            pArr[idx * 4] = wx;
            pArr[idx * 4 + 1] = heightAt(wx, wz);
            pArr[idx * 4 + 2] = wz;
            // Face straight ahead along march direction when pushing/walking; turn inward toward the gun when stationary!
            pArr[idx * 4 + 3] = gunMoving ? w : w + sp[2];
            sArr[idx] = reg.side;
            const offset = s.slotIndex * 1.9 + k * 0.7;
            if (gunMoving) {
              fArr[idx] = cycle(walk, gunStrideM / Math.max(0.5, walk.travelM ?? WALK_CYCLE_M));
            } else if (sinceAtk < reloadS * 0.8) {
              const pickS = pickup.frames / pickup.fps;
              const t = (sinceAtk + offset) % (pickS + putdown.frames / putdown.fps);
              fArr[idx] =
                t < pickS
                  ? pickup.start + Math.floor(t * pickup.fps)
                  : putdown.start + Math.min(putdown.frames - 1, Math.floor((t - pickS) * putdown.fps));
            } else {
              fArr[idx] = cycle(idle, (simClockS + offset) / (idle.frames / idle.fps));
            }
          }
        }
      }
    }

    for (const fp of folkPools) {
      if (fp.count === 0) {
        fp.place.setXYZW(0, 0, -500, 0, 0);
        fp.mesh.count = 1;
        fp.mesh.visible = false;
      } else {
        fp.mesh.visible = true;
        fp.mesh.count = fp.count;
      }
      fp.place.needsUpdate = true;
      fp.side.needsUpdate = true;
      fp.frame.needsUpdate = true;
    }

    if (handcartMesh) {
      if (handcartCount === 0) {
        handcartMesh.setMatrixAt(0, ZERO_MAT);
        handcartMesh.count = 1;
        handcartMesh.visible = false;
      } else {
        handcartMesh.visible = true;
        handcartMesh.count = handcartCount;
      }
      handcartMesh.instanceMatrix.needsUpdate = true;
    }

    if (wagonMesh) {
      if (wagonCount === 0) {
        wagonMesh.setMatrixAt(0, ZERO_MAT);
        wagonMesh.count = 1;
        wagonMesh.visible = false;
      } else {
        wagonMesh.visible = true;
        wagonMesh.count = wagonCount;
      }
      wagonMesh.instanceMatrix.needsUpdate = true;
    }

    // 5. Animated Livestock & Ambient Animals: wandering pigs in Pig Farm pens + grazing horses in Stable paddocks!
    let pigCount = 0;
    const hashAnimal = (a: number, b: number, c: number): number => {
      let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const horseCapTotal = CART_CAP + 64;
    for (const b of state.buildings) {
      if (b.hp <= 0 || b.buildProgress < 1) continue;
      if (b.type !== 'pigFarm' && b.type !== 'stable') continue;
      const isHorse = b.type === 'stable';
      const x0 = isHorse ? -2.8 : -3.8;
      const x1 = isHorse ? 2.8 : 3.8;
      const z0 = isHorse ? 0.8 : -1.2;
      const z1 = isHorse ? 2.9 : 3.2;
      const count = isHorse ? (b.level >= 2 ? 3 : 2) : 3 + b.level;
      const speedMs = isHorse ? 0.85 : 0.45;
      const legS = isHorse ? 18 : 11;
      const cb = Math.cos(b.yawRad);
      const sb = Math.sin(b.yawRad);

      for (let i = 0; i < count; i++) {
        const aid = b.id * 16 + i;
        const t = simClockS + hashAnimal(aid, 7, 7) * legS;
        const leg = Math.floor(t / legS);
        const into = t - leg * legS;
        const ax = x0 + (x1 - x0) * hashAnimal(aid, leg - 1, 0);
        const az = z0 + (z1 - z0) * hashAnimal(aid, leg - 1, 1);
        const bx = x0 + (x1 - x0) * hashAnimal(aid, leg, 0);
        const bz = z0 + (z1 - z0) * hashAnimal(aid, leg, 1);
        const dist = Math.hypot(bx - ax, bz - az);
        const walkS = dist / speedMs;
        const share = walkS > 0 ? Math.min(1, into / walkS) : 1;
        const lx = ax + (bx - ax) * share;
        const lz = az + (bz - az) * share;
        const heading = (dist > 0.01 ? Math.atan2(bx - ax, bz - az) : hashAnimal(aid, leg, 9) * Math.PI * 2) + b.yawRad;
        const wx = b.x + lx * cb + lz * sb;
        const wz = b.z - lx * sb + lz * cb;
        const wy = heightAt(wx, wz);

        if (!isHorse && pigMesh && pigCount < CART_CAP) {
          const bob = share < 1 ? Math.abs(Math.sin(dist * share * 7)) * 0.03 : 0;
          TEMP_POS.set(wx, wy + bob, wz);
          TEMP_QUAT.setFromAxisAngle(UP, heading + Math.PI);
          TEMP_SCALE.set(1, 1, 1);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          pigMesh.setMatrixAt(pigCount++, TEMP_MAT);
        } else if (isHorse && draftHorsePool && draftHorsePool.horse && draftHorseCount < horseCapTotal) {
          const pArr = draftHorsePool.place.array as Float32Array;
          const sArr = draftHorsePool.side.array as Float32Array;
          const fArr = draftHorsePool.frame.array as Float32Array;
          pArr[draftHorseCount * 4] = wx;
          pArr[draftHorseCount * 4 + 1] = wy;
          pArr[draftHorseCount * 4 + 2] = wz;
          pArr[draftHorseCount * 4 + 3] = heading + Math.PI;
          sArr[draftHorseCount] = b.side;
          const hc = draftHorsePool.horse;
          if (share < 1) {
            const cycleM = Math.max(0.6, hc.walk.travelM ?? 1);
            fArr[draftHorseCount] = cycle(hc.walk, (dist * share) / cycleM);
          } else {
            const restS = Math.max(0, into - walkS);
            const clip = hc.graze && hashAnimal(aid, leg, 3) < 0.55 ? hc.graze : hc.idle;
            fArr[draftHorseCount] = cycle(clip, (restS + hashAnimal(aid, 5, 5) * 10) / (clip.frames / clip.fps));
          }
          draftHorseCount++;
        }
      }
    }

    if (pigMesh) {
      if (pigCount === 0) {
        pigMesh.setMatrixAt(0, ZERO_MAT);
        pigMesh.count = 1;
        pigMesh.visible = false;
      } else {
        pigMesh.visible = true;
        pigMesh.count = pigCount;
      }
      pigMesh.instanceMatrix.needsUpdate = true;
    }

    if (draftHorsePool) {
      if (draftHorseCount === 0) {
        draftHorsePool.place.setXYZW(0, 0, -500, 0, 0);
        draftHorsePool.mesh.count = 1;
        draftHorsePool.mesh.visible = false;
      } else {
        draftHorsePool.mesh.visible = true;
        draftHorsePool.mesh.count = draftHorseCount;
      }
      draftHorsePool.place.needsUpdate = true;
      draftHorsePool.side.needsUpdate = true;
      draftHorsePool.frame.needsUpdate = true;
    }
  };

  const dispose = (): void => {
    for (const p of unitPools.values()) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.material.dispose();
      p.boneTex.dispose();
    }
    for (const ep of engines.values()) {
      scene.remove(ep.mesh);
      ep.mesh.geometry.dispose();
      ep.material.dispose();
    }
    for (const fp of folkPools) {
      scene.remove(fp.mesh);
      fp.mesh.geometry.dispose();
      fp.material.dispose();
      fp.boneTex.dispose();
    }
    if (handcartMesh) {
      scene.remove(handcartMesh);
      handcartMesh.geometry.dispose();
      (handcartMesh.material as MeshStandardNodeMaterial).dispose();
    }
    if (wagonMesh) {
      scene.remove(wagonMesh);
      wagonMesh.geometry.dispose();
      (wagonMesh.material as MeshStandardNodeMaterial).dispose();
    }
    if (pigMesh) {
      scene.remove(pigMesh);
      pigMesh.geometry.dispose();
      (pigMesh.material as MeshStandardNodeMaterial).dispose();
    }
    if (draftHorsePool) {
      scene.remove(draftHorsePool.mesh);
      draftHorsePool.mesh.geometry.dispose();
      draftHorsePool.material.dispose();
      draftHorsePool.boneTex.dispose();
    }
  };

  return { syncFromSim, dispose };
}
