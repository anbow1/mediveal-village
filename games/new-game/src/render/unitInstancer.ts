// Stage 5 GPU Bone-Matrix DataTexture Instanced Character Renderer (R1, R2, R4, R7):
// Renders 160-200+ animated MakeHuman CC0 soldiers & villagers across BOTH Marchland Cobalt
// and Enemy Crimson factions in <= 9 draw calls total (LOD0 + LOD1 + LOD2 + R7 shadow per archetype):
//   - Bakes `idle`, `walk`, and `attack` clips at load into a compact RGBA32F DataTexture
//     (3 row-major vec4 texels per bone x totalFrames; NearestFilter + integer `textureLoad`
//      -> 100% WebGPU + WebGL2 core-spec compatible, zero linear float filter dependency!)
//   - Per-instance `aUnitPosYaw` (x, y, z, yawRad) + `aUnitMeta` (frameRow, teamFlag, scale, tintVar)
//   - Zero-extra-texture TSL faction heraldry swap turns Marchland woad cobalt -> feudal madder
//     crimson right inside the same instanced draw call (works on surcoat, kite shield, & archer hood!)
//   - Empty LOD buckets keep `count = 1` with `scale = 0` so all GPU pipelines compile during warmUp().

import {
  AnimationClip,
  AnimationMixer,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  NearestFilter,
  Object3D,
  Quaternion,
  RGBAFormat,
  SkinnedMesh,
  Vector3,
  type Scene,
} from 'three/webgpu';
import {
  Fn,
  attribute,
  clamp,
  cos,
  dot,
  float,
  int,
  ivec2,
  max,
  mix,
  normalGeometry,
  normalLocal,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  texture,
  uv,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
import { UNIT_DEFS } from '../config.ts';
import { selectLodLevel, UNIT_LOD_THRESHOLDS, type LodLevel } from '../sim/lodMath.ts';
import type { SimWorldState } from '../sim/types.ts';
import type { AssetLoader, ByteProgressTracker } from './assetLoader.ts';
import { SHADOW_ONLY_LAYER } from './lighting.ts';

export type UnitArchetype = 'swordsman' | 'archer' | 'citizen';
export type UnitAnimClip = 'idle' | 'walk' | 'attack';

export interface InstancedUnitSpawn {
  readonly archetype: UnitArchetype;
  /** 0 = Marchland Cobalt, 1 = Enemy Feudal Crimson, 2 = Ochre Gold */
  readonly team: 0 | 1 | 2;
  x: number;
  y: number;
  z: number;
  yawRad: number;
  scale: number;
  clip: UnitAnimClip;
  phase01: number;
  speedMul: number;
  tintVar: number;
  /** Optional simple patrol waypoints for living village & garrison motion in Stage 5 preview. */
  readonly patrol?: readonly (readonly [number, number])[];
  patrolSpeedMs?: number;
  patrolProgress?: number;
}

export interface UnitInstancerHandles {
  readonly units: InstancedUnitSpawn[];
  readonly update: (
    dtS: number,
    cameraPos: Vector3,
    paused: boolean,
    heightAt?: (x: number, z: number) => number,
  ) => void;
  /** Stage 6: packs live SimWorldState soldiers & townsfolk into GPU buffers with zero foot slide! */
  readonly syncFromSim: (
    state: SimWorldState,
    cameraPos: Vector3,
    heightAt: (x: number, z: number) => number,
    simClockS: number,
  ) => void;
  readonly getLodCounts: () => Record<string, number>;
  readonly getUnitCount: () => number;
  readonly setVisible: (visible: boolean) => void;
  readonly dispose: () => void;
}

interface ClipSpan {
  readonly startRow: number;
  readonly frameCount: number;
  readonly durationS: number;
}

interface BakedArchetype {
  readonly archetype: UnitArchetype;
  readonly maxInstances: number;
  readonly boneTex: DataTexture;
  readonly clips: Record<UnitAnimClip, ClipSpan>;
  readonly lodMeshes: readonly [InstancedMesh, InstancedMesh, InstancedMesh];
  readonly lodPosAttrs: readonly [InstancedBufferAttribute, InstancedBufferAttribute, InstancedBufferAttribute];
  readonly lodMetaAttrs: readonly [InstancedBufferAttribute, InstancedBufferAttribute, InstancedBufferAttribute];
  readonly shadowMesh: InstancedMesh;
  readonly material: MeshStandardNodeMaterial;
  readonly shadowMat: MeshStandardNodeMaterial;
  readonly geometries: readonly BufferGeometry[];
  readonly unitIndices: number[];
}

const IDENTITY_MAT = new Matrix4();
const ZERO_MAT = new Matrix4().makeScale(0, 0, 0);
const TEMP_MAT = new Matrix4();
const TEMP_POS = new Vector3();
const TEMP_QUAT = new Quaternion();
const TEMP_SCALE = new Vector3(1, 1, 1);
const UP_AXIS = new Vector3(0, 1, 0);

/** Converts Meshopt/quantized geometry attributes cleanly to Float32 so GPU instancing never clips or drops skinning data. */
function dequantizeSkinnedGeometry(src: BufferGeometry): BufferGeometry {
  const geo = src.clone();
  for (const attrName of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(attrName);
    if (!attr) continue;
    const isFloat32 = attr.array instanceof Float32Array && !attr.normalized;
    if (!isFloat32) {
      const itemSize = attr.itemSize;
      const out = new Float32Array(attr.count * itemSize);
      for (let i = 0; i < attr.count; i++) {
        out[i * itemSize] = attr.getX(i);
        if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
        if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
        if (itemSize > 3) out[i * itemSize + 3] = attr.getW(i);
      }
      geo.setAttribute(attrName, new Float32BufferAttribute(out, itemSize));
    }
  }
  // Ensure vertex color attribute exists so `vertexColor()` node always resolves cleanly
  if (!geo.getAttribute('color')) {
    const count = geo.getAttribute('position').count;
    const cols = new Float32Array(count * 3);
    cols.fill(1.0);
    geo.setAttribute('color', new Float32BufferAttribute(cols, 3));
  }
  if (!geo.getAttribute('skinIndex')) {
    const count = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Float32BufferAttribute(new Float32Array(count * 4), 4));
    const sw = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) sw[i * 4] = 1.0;
    geo.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
  }
  return geo;
}

/** Finds the first SkinnedMesh or Mesh inside a loaded GLTF scene. */
function findPrimaryMesh(root: Object3D): Mesh {
  let found: Mesh | null = null;
  root.traverse((o) => {
    if (!found && o instanceof SkinnedMesh) found = o;
  });
  if (!found) {
    root.traverse((o) => {
      if (!found && o instanceof Mesh) found = o;
    });
  }
  if (!found) {
    throw new Error('Unit GLB contains no mesh');
  }
  return found;
}

/**
 * Bakes `idle`, `walk`, and `attack` skeletal animations into an RGBA32F DataTexture:
 *   width  = numBones * 3  (3 row-major vec4 rows of each affine 4x4 skinning matrix)
 *   height = totalFrames   (sum of clip frame counts)
 */
function bakeBoneTexture(
  root: Object3D,
  skinned: SkinnedMesh,
  animations: readonly AnimationClip[],
): { boneTex: DataTexture; clips: Record<UnitAnimClip, ClipSpan>; numBones: number } {
  const skeleton = skinned.skeleton;
  const numBones = Math.max(1, skeleton.bones.length);
  const clipSpecs: readonly { readonly key: UnitAnimClip; readonly frames: number; readonly fallbackDur: number }[] = [
    { key: 'idle', frames: 28, fallbackDur: 2.0 },
    { key: 'walk', frames: 24, fallbackDur: 1.0 },
    { key: 'attack', frames: 28, fallbackDur: 1.2 },
  ];

  const totalFrames = clipSpecs.reduce((acc, c) => acc + c.frames, 0);
  const width = numBones * 3;
  const data = new Float32Array(width * totalFrames * 4);

  const mixer = new AnimationMixer(root);
  const mSkin = new Matrix4();
  const mFinal = new Matrix4();
  const clips = {} as Record<UnitAnimClip, ClipSpan>;

  let rowCursor = 0;
  for (const spec of clipSpecs) {
    const clip =
      animations.find((a) => a.name.toLowerCase().includes(spec.key)) ??
      animations[0] ??
      null;
    const durationS = clip && clip.duration > 0.05 ? clip.duration : spec.fallbackDur;
    clips[spec.key] = { startRow: rowCursor, frameCount: spec.frames, durationS };

    mixer.stopAllAction();
    const action = clip ? mixer.clipAction(clip) : null;
    if (action) {
      action.reset();
      action.play();
    }

    for (let f = 0; f < spec.frames; f++) {
      const sampleT = (f / spec.frames) * durationS;
      if (action) {
        mixer.setTime(sampleT);
      }
      root.updateMatrixWorld(true);
      skeleton.update();

      const rowBase = (rowCursor + f) * width * 4;
      for (let b = 0; b < numBones; b++) {
        // Compute exact glTF skinning transform in root-local coordinates:
        //   finalMat = skinned.matrixWorld * bindMatrixInverse * boneWorld * boneInverse * bindMatrix
        const boneWorld = skeleton.bones[b]!.matrixWorld;
        const boneInv = skeleton.boneInverses[b]!;
        mSkin.multiplyMatrices(boneWorld, boneInv);
        mFinal.multiplyMatrices(skinned.bindMatrixInverse, mSkin);
        mFinal.multiply(skinned.bindMatrix);
        mFinal.premultiply(skinned.matrixWorld);

        const e = mFinal.elements;
        const off = rowBase + b * 12;
        // Row 0
        data[off + 0] = e[0]!;
        data[off + 1] = e[4]!;
        data[off + 2] = e[8]!;
        data[off + 3] = e[12]!;
        // Row 1
        data[off + 4] = e[1]!;
        data[off + 5] = e[5]!;
        data[off + 6] = e[9]!;
        data[off + 7] = e[13]!;
        // Row 2
        data[off + 8] = e[2]!;
        data[off + 9] = e[6]!;
        data[off + 10] = e[10]!;
        data[off + 11] = e[14]!;
      }
    }
    rowCursor += spec.frames;
  }

  mixer.stopAllAction();

  const boneTex = new DataTexture(data, width, totalFrames, RGBAFormat, FloatType);
  boneTex.minFilter = NearestFilter;
  boneTex.magFilter = NearestFilter;
  boneTex.wrapS = ClampToEdgeWrapping;
  boneTex.wrapT = ClampToEdgeWrapping;
  boneTex.generateMipmaps = false;
  boneTex.needsUpdate = true;

  return { boneTex, clips, numBones };
}

/**
 * Builds the GPU-skinned TSL PBR material shared by all LODs and BOTH Cobalt & Crimson factions
 * of an archetype (`swordsman`, `archer`, or `citizen`).
 */
function createInstancedSkinnedMaterial(
  archetype: UnitArchetype,
  sourceMat: MeshStandardMaterial,
  boneTex: DataTexture,
): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: sourceMat.roughness,
    metalness: sourceMat.metalness,
  });
  mat.name = `MarchlandGpuSkinned_${archetype}`;

  // Reuse LOD0's KTX2 PBR normal, roughness, metalness, and AO maps with zero duplication
  mat.normalMap = sourceMat.normalMap;
  mat.roughnessMap = sourceMat.roughnessMap;
  mat.metalnessMap = sourceMat.metalnessMap;
  mat.aoMap = sourceMat.aoMap;

  const posYaw = attribute('aUnitPosYaw', 'vec4');
  const meta = attribute('aUnitMeta', 'vec4');

  // GPU Vertex Skinning + Per-Instance World Transform (`scale -> yaw -> translate`)
  const skinAndPlace = Fn(() => {
    const p4 = vec4(positionGeometry, float(1.0));
    const n3 = normalGeometry;
    const sIdx = attribute('skinIndex', 'vec4');
    const sWgt = attribute('skinWeight', 'vec4');
    const frameRow = int(meta.x);

    const sampleRow = (boneIdxNode: ReturnType<typeof int>, rowOffset: number) =>
      texture(boneTex).load(ivec2(boneIdxNode.mul(int(3)).add(int(rowOffset)), frameRow));

    const b0 = int(sIdx.x);
    const b1 = int(sIdx.y);
    const b2 = int(sIdx.z);
    const b3 = int(sIdx.w);

    const w0 = sWgt.x;
    const w1 = sWgt.y;
    const w2 = sWgt.z;
    const w3 = sWgt.w;
    const wSum = max(w0.add(w1).add(w2).add(w3), float(0.0001));
    const invW = float(1.0).div(wSum);
    const nw0 = w0.mul(invW);
    const nw1 = w1.mul(invW);
    const nw2 = w2.mul(invW);
    const nw3 = w3.mul(invW);

    const m0 = sampleRow(b0, 0).mul(nw0)
      .add(sampleRow(b1, 0).mul(nw1))
      .add(sampleRow(b2, 0).mul(nw2))
      .add(sampleRow(b3, 0).mul(nw3));
    const m1 = sampleRow(b0, 1).mul(nw0)
      .add(sampleRow(b1, 1).mul(nw1))
      .add(sampleRow(b2, 1).mul(nw2))
      .add(sampleRow(b3, 1).mul(nw3));
    const m2 = sampleRow(b0, 2).mul(nw0)
      .add(sampleRow(b1, 2).mul(nw1))
      .add(sampleRow(b2, 2).mul(nw2))
      .add(sampleRow(b3, 2).mul(nw3));

    const skPos = vec3(dot(m0, p4), dot(m1, p4), dot(m2, p4)).mul(meta.z);
    const skNor = normalize(vec3(dot(m0.xyz, n3), dot(m1.xyz, n3), dot(m2.xyz, n3)));

    const c = cos(posYaw.w);
    const s = sin(posYaw.w);
    // Standard Three.js Y-up right-handed yaw rotation: x' = x*c + z*s, z' = -x*s + z*c
    const rotPos = vec3(
      skPos.x.mul(c).add(skPos.z.mul(s)),
      skPos.y,
      skPos.z.mul(c).sub(skPos.x.mul(s)),
    );
    const rotNor = normalize(
      vec3(
        skNor.x.mul(c).add(skNor.z.mul(s)),
        skNor.y,
        skNor.z.mul(c).sub(skNor.x.mul(s)),
      ),
    );

    normalLocal.assign(rotNor);
    return rotPos.add(posYaw.xyz);
  });

  mat.positionNode = skinAndPlace();

  // Fragment Color: KTX2 Albedo + zero-texture Enemy Crimson heraldry swap + subtle per-unit cloth tint + Cycles AO!
  if (sourceMat.map) {
    const texCol = texture(sourceMat.map, uv(0)).rgb;
    const teamFlag = meta.y; // 0 = Marchland Cobalt, 1 = Enemy Feudal Crimson
    const tintVar = meta.w;  // 0.90..1.10 organic individual variation

    // Channel-max value preserves linear brightness when transforming woad blue -> feudal madder crimson
    // on swordsman surcoat + Poly Haven kite shield AND archer chaperon hood!
    const val = max(texCol.r, max(texCol.g, texCol.b));
    const blueExcess = smoothstep(float(0.010), float(0.042), texCol.b.sub(max(texCol.r, texCol.g).mul(1.05)));
    const crimson = vec3(val.mul(1.85), val.mul(0.15), val.mul(0.13));
    const teamSwapped = mix(texCol, crimson, blueExcess.mul(teamFlag));
    mat.colorNode = clamp(teamSwapped.mul(vertexColor().rgb).mul(tintVar), vec3(0.012), vec3(0.84));
  }

  return mat;
}

/**
 * Loads all 3 MakeHuman CC0 character archetypes (`swordsman`, `archer`, `citizen`), bakes their
 * animation bone textures, and creates multi-LOD GPU-instanced meshes + R7 shadow stand-ins.
 */
export async function buildUnitInstancer(
  scene: Scene,
  loader: AssetLoader,
  spawns: readonly InstancedUnitSpawn[],
  tracker?: ByteProgressTracker,
): Promise<UnitInstancerHandles> {
  const units = spawns.map((u) => ({ ...u }));
  const archetypes: readonly UnitArchetype[] = ['swordsman', 'archer', 'citizen'];
  const batches: BakedArchetype[] = [];

  for (const archetype of archetypes) {
    const unitIndices: number[] = [];
    for (let i = 0; i < units.length; i++) {
      if (units[i]!.archetype === archetype) unitIndices.push(i);
    }
    const minCap = archetype === 'swordsman' ? 260 : archetype === 'archer' ? 160 : 180;
    const maxInstances = Math.max(minCap, unitIndices.length);

    const [g0, g1, g2, gSh] = await Promise.all([
      loader.loadGlb(`assets/units/${archetype}_lod0.glb`, tracker),
      loader.loadGlb(`assets/units/${archetype}_lod1.glb`, tracker),
      loader.loadGlb(`assets/units/${archetype}_lod2.glb`, tracker),
      loader.loadGlb(`assets/units/${archetype}_shadow.glb`, tracker),
    ]);

    const mesh0 = findPrimaryMesh(g0.scene);
    const mesh1 = findPrimaryMesh(g1.scene);
    const mesh2 = findPrimaryMesh(g2.scene);
    const meshSh = findPrimaryMesh(gSh.scene);

    if (!(mesh0 instanceof SkinnedMesh)) {
      throw new Error(`Expected SkinnedMesh in ${archetype}_lod0.glb`);
    }
    const srcMat = Array.isArray(mesh0.material) ? mesh0.material[0] : mesh0.material;
    if (!(srcMat instanceof MeshStandardMaterial)) {
      throw new Error(`Expected MeshStandardMaterial on ${archetype}_lod0.glb`);
    }

    const { boneTex, clips } = bakeBoneTexture(g0.scene, mesh0, g0.animations);

    const geo0 = dequantizeSkinnedGeometry(mesh0.geometry as BufferGeometry);
    const geo1 = dequantizeSkinnedGeometry(mesh1.geometry as BufferGeometry);
    const geo2 = dequantizeSkinnedGeometry(mesh2.geometry as BufferGeometry);
    const geoSh = dequantizeSkinnedGeometry(meshSh.geometry as BufferGeometry);
    meshSh.updateMatrixWorld(true);
    geoSh.applyMatrix4(meshSh.matrixWorld);

    // One shared TSL material per LOD? Wait: `instancedBufferAttribute(attr)` binds a specific
    // InstancedBufferAttribute reference per mesh, so each LOD gets its own thin material wrapper
    // sharing the EXACT same GPU boneTex & KTX2 textures (0 extra VRAM, same shader graph!).
    const lodMeshes: InstancedMesh[] = [];
    const lodPosAttrs: InstancedBufferAttribute[] = [];
    const lodMetaAttrs: InstancedBufferAttribute[] = [];
    const lodMaterials: MeshStandardNodeMaterial[] = [];

    const geos = [geo0, geo1, geo2] as const;
    for (let li = 0; li < 3; li++) {
      const g = geos[li]!;
      const posYawArr = new Float32Array(maxInstances * 4);
      const metaArr = new Float32Array(maxInstances * 4);
      // Seed slot 0 with scale=0 so even an empty LOD bucket warms up cleanly with 0 pixels!
      metaArr[2] = 0.0;
      metaArr[3] = 1.0;

      const posYawAttr = new InstancedBufferAttribute(posYawArr, 4);
      const metaAttr = new InstancedBufferAttribute(metaArr, 4);
      g.setAttribute('aUnitPosYaw', posYawAttr);
      g.setAttribute('aUnitMeta', metaAttr);

      const mat = createInstancedSkinnedMaterial(archetype, srcMat, boneTex);
      const inst = new InstancedMesh(g, mat, maxInstances);
      inst.name = `UnitBatch_${archetype}_lod${li}`;
      inst.castShadow = false; // R7 coarse shadow proxy casts crisp shadows into CSM!
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      for (let i = 0; i < maxInstances; i++) {
        inst.setMatrixAt(i, IDENTITY_MAT);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.count = 1; // Always >= 1 during warmUp!
      scene.add(inst);

      lodMeshes.push(inst);
      lodPosAttrs.push(posYawAttr);
      lodMetaAttrs.push(metaAttr);
      lodMaterials.push(mat);
    }

    // Coarse opaque R7 shadow stand-in InstancedMesh on SHADOW_ONLY_LAYER (1 draw call per archetype!)
    const shadowMat = new MeshStandardNodeMaterial({ color: 0x333333, roughness: 1.0, metalness: 0.0 });
    shadowMat.name = `UnitShadowProxyMat_${archetype}`;
    const shadowMesh = new InstancedMesh(geoSh, shadowMat, maxInstances);
    shadowMesh.name = `UnitShadow_${archetype}`;
    shadowMesh.castShadow = true;
    shadowMesh.receiveShadow = false;
    shadowMesh.frustumCulled = false;
    shadowMesh.layers.set(SHADOW_ONLY_LAYER);
    shadowMesh.setMatrixAt(0, ZERO_MAT);
    shadowMesh.count = 1;
    shadowMesh.instanceMatrix.needsUpdate = true;
    scene.add(shadowMesh);

    batches.push({
      archetype,
      maxInstances,
      boneTex,
      clips,
      lodMeshes: lodMeshes as unknown as readonly [InstancedMesh, InstancedMesh, InstancedMesh],
      lodPosAttrs: lodPosAttrs as unknown as readonly [InstancedBufferAttribute, InstancedBufferAttribute, InstancedBufferAttribute],
      lodMetaAttrs: lodMetaAttrs as unknown as readonly [InstancedBufferAttribute, InstancedBufferAttribute, InstancedBufferAttribute],
      shadowMesh,
      material: lodMaterials[0]!,
      shadowMat,
      geometries: [geo0, geo1, geo2, geoSh],
      unitIndices,
    });
  }

  // Track LOD distribution for HUD/bench diagnostics
  const lodCounts: Record<string, number> = { lod0: 0, lod1: 0, lod2: 0 };
  const unitLevels: LodLevel[] = new Array(units.length).fill(0);

  const update = (
    dtS: number,
    cameraPos: Vector3,
    paused: boolean,
    heightAt?: (x: number, z: number) => number,
  ): void => {
    // 1. Advance patrolling villagers & unit animation phases
    if (!paused && dtS > 0) {
      for (const u of units) {
        if (u.patrol && u.patrol.length >= 2) {
          const pts = u.patrol;
          const speed = u.patrolSpeedMs ?? 1.45;
          const curIdx = Math.floor(u.patrolProgress ?? 0) % pts.length;
          const nextIdx = (curIdx + 1) % pts.length;
          const [x0, z0] = pts[curIdx]!;
          const [x1, z1] = pts[nextIdx]!;
          const segLen = Math.max(0.1, Math.hypot(x1 - x0, z1 - z0));
          u.patrolProgress = ((u.patrolProgress ?? 0) + (speed * dtS) / segLen) % pts.length;
          const fIdx = Math.floor(u.patrolProgress) % pts.length;
          const nIdx = (fIdx + 1) % pts.length;
          const frac = u.patrolProgress - Math.floor(u.patrolProgress);
          const [ax, az] = pts[fIdx]!;
          const [bx, bz] = pts[nIdx]!;
          u.x = ax + (bx - ax) * frac;
          u.z = az + (bz - az) * frac;
          if (heightAt) u.y = heightAt(u.x, u.z);
          u.yawRad = Math.atan2(bx - ax, bz - az);
        }
        u.phase01 = (u.phase01 + dtS * u.speedMul) % 1.0;
      }
    }

    lodCounts.lod0 = 0;
    lodCounts.lod1 = 0;
    lodCounts.lod2 = 0;

    // 2. Pack each archetype's live instances into LOD0 / LOD1 / LOD2 buckets + shadow batch
    for (const batch of batches) {
      const counts = [0, 0, 0] as [number, number, number];
      let shadowCount = 0;

      for (const ui of batch.unitIndices) {
        const u = units[ui]!;
        const dist = Math.hypot(cameraPos.x - u.x, cameraPos.y - u.y, cameraPos.z - u.z);
        const rawLevel = selectLodLevel(dist, unitLevels[ui]!, UNIT_LOD_THRESHOLDS);
        const clampedLod = Math.min(2, rawLevel) as 0 | 1 | 2;
        unitLevels[ui] = clampedLod;
        if (clampedLod === 0) lodCounts.lod0!++;
        else if (clampedLod === 1) lodCounts.lod1!++;
        else lodCounts.lod2!++;

        const clipSpan = batch.clips[u.clip];
        const frameInClip = Math.floor(u.phase01 * clipSpan.frameCount) % clipSpan.frameCount;
        const frameRow = clipSpan.startRow + frameInClip;

        const slot = counts[clampedLod]++;
        const posArr = batch.lodPosAttrs[clampedLod].array as Float32Array;
        const metaArr = batch.lodMetaAttrs[clampedLod].array as Float32Array;
        const o = slot * 4;
        posArr[o + 0] = u.x;
        posArr[o + 1] = u.y;
        posArr[o + 2] = u.z;
        posArr[o + 3] = u.yawRad;
        metaArr[o + 0] = frameRow;
        metaArr[o + 1] = u.team;
        metaArr[o + 2] = u.scale;
        metaArr[o + 3] = u.tintVar;

        // Shadow proxy update (within CSM max shadow distance ~135 m to keep shadow pass lean)
        if (dist < 145) {
          TEMP_POS.set(u.x, u.y, u.z);
          TEMP_QUAT.setFromAxisAngle(UP_AXIS, u.yawRad);
          TEMP_SCALE.set(u.scale, u.scale, u.scale);
          TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
          batch.shadowMesh.setMatrixAt(shadowCount++, TEMP_MAT);
        }
      }

      for (let li = 0; li < 3; li++) {
        const c = counts[li]!;
        const mesh = batch.lodMeshes[li]!;
        const posAttr = batch.lodPosAttrs[li]!;
        const metaAttr = batch.lodMetaAttrs[li]!;
        if (c === 0) {
          // Keep count = 1 with scale = 0 so pipeline never drops & never stalls
          (metaAttr.array as Float32Array)[2] = 0.0;
          mesh.count = 1;
        } else {
          mesh.count = c;
        }
        posAttr.needsUpdate = true;
        metaAttr.needsUpdate = true;
      }

      if (shadowCount === 0) {
        batch.shadowMesh.setMatrixAt(0, ZERO_MAT);
        batch.shadowMesh.count = 1;
      } else {
        batch.shadowMesh.count = shadowCount;
      }
      batch.shadowMesh.instanceMatrix.needsUpdate = true;
    }
  };

  let lastLiveCount = units.length;
  const batchByType: Record<UnitArchetype, BakedArchetype> = {
    swordsman: batches[0]!,
    archer: batches[1]!,
    citizen: batches[2]!,
  };

  /**
   * Stage 6 live simulation sync: maps every alive soldier (infantry, archers, cavalry riders,
   * siege crew & Captains) and townsfolk citizen directly into the pre-allocated LOD buckets.
   * Walk clip frame advances strictly from `travelM / strideLengthM` -> ZERO foot slide!
   */
  const syncFromSim = (
    state: SimWorldState,
    cameraPos: Vector3,
    heightAt: (x: number, z: number) => number,
    simClockS: number,
  ): void => {
    lodCounts.lod0 = 0;
    lodCounts.lod1 = 0;
    lodCounts.lod2 = 0;

    const lodCountsByArch: Record<UnitArchetype, [number, number, number]> = {
      swordsman: [0, 0, 0],
      archer: [0, 0, 0],
      citizen: [0, 0, 0],
    };
    const shCountsByArch: Record<UnitArchetype, number> = {
      swordsman: 0,
      archer: 0,
      citizen: 0,
    };

    let liveTotal = 0;

    const pushActor = (
      arch: UnitArchetype,
      team: 0 | 1 | 2,
      x: number,
      y: number,
      z: number,
      yawRad: number,
      scale: number,
      clip: UnitAnimClip,
      phase01: number,
      tintVar: number,
    ): void => {
      const batch = batchByType[arch];
      const dist = Math.hypot(cameraPos.x - x, cameraPos.y - y, cameraPos.z - z);
      const clampedLod: 0 | 1 | 2 = dist < UNIT_LOD_THRESHOLDS.lod1M ? 0 : dist < UNIT_LOD_THRESHOLDS.lod2M ? 1 : 2;
      const counts = lodCountsByArch[arch];
      if (counts[clampedLod] >= batch.maxInstances) return;

      const slot = counts[clampedLod]++;
      if (clampedLod === 0) lodCounts.lod0!++;
      else if (clampedLod === 1) lodCounts.lod1!++;
      else lodCounts.lod2!++;
      liveTotal++;

      const clipSpan = batch.clips[clip];
      const normPhase = ((phase01 % 1) + 1) % 1;
      const frameInClip = Math.floor(normPhase * clipSpan.frameCount) % clipSpan.frameCount;
      const frameRow = clipSpan.startRow + frameInClip;

      const posArr = batch.lodPosAttrs[clampedLod].array as Float32Array;
      const metaArr = batch.lodMetaAttrs[clampedLod].array as Float32Array;
      const o = slot * 4;
      posArr[o + 0] = x;
      posArr[o + 1] = y;
      posArr[o + 2] = z;
      posArr[o + 3] = yawRad;
      metaArr[o + 0] = frameRow;
      metaArr[o + 1] = team;
      metaArr[o + 2] = scale;
      metaArr[o + 3] = tintVar;

      if (dist < 145 && shCountsByArch[arch] < batch.maxInstances) {
        TEMP_POS.set(x, y, z);
        TEMP_QUAT.setFromAxisAngle(UP_AXIS, yawRad);
        TEMP_SCALE.set(scale, scale, scale);
        TEMP_MAT.compose(TEMP_POS, TEMP_QUAT, TEMP_SCALE);
        batch.shadowMesh.setMatrixAt(shCountsByArch[arch]++, TEMP_MAT);
      }
    };

    // 1. All living soldiers (infantry, ranged, mounted cavalry riders, siege gunners)
    for (const reg of state.regiments) {
      if (reg.garrisonedInBuildingId !== null) continue;
      const def = UNIT_DEFS[reg.unitType];
      const arch: UnitArchetype = def.visualArchetype;
      const isCav = def.unitClass === 'cavalry';
      const isSiege = def.unitClass === 'siege';
      const baseScale =
        reg.unitType === 'heavyCav'
          ? 1.06
          : reg.unitType === 'halberdiers' || reg.unitType === 'swordsmen'
            ? 1.03
            : reg.unitType === 'militia'
              ? 0.96
              : 1.0;

      for (const s of reg.soldiers) {
        if (!s.alive) continue;
        const groundY = heightAt(s.x, s.z);
        if (isSiege) {
          // Place two visible gunners flanking each cannon/mortar piece
          const rx = Math.cos(s.yawRad);
          const rz = -Math.sin(s.yawRad);
          for (const sideSign of [-1, 1] as const) {
            const gx = s.x + rx * sideSign * 1.15;
            const gz = s.z + rz * sideSign * 1.15;
            const clip: UnitAnimClip = s.clip === 'walk' ? 'walk' : s.attackAnimTimerS > 0 ? 'attack' : 'idle';
            const phase =
              clip === 'walk'
                ? s.travelM / 1.45
                : clip === 'attack'
                  ? 1 - s.attackAnimTimerS
                  : simClockS * 0.42 + s.tintVar * 3.1 + sideSign * 0.3;
            pushActor('citizen', reg.side, gx, heightAt(gx, gz), gz, s.yawRad, 0.98, clip, phase, s.tintVar);
          }
          continue;
        }

        const clip: UnitAnimClip = s.clip;
        // Zero foot slide: walk cycle phase locks strictly to distance walked (1.45 m/cycle infantry, 2.6 m/cycle cavalry)!
        const phase =
          clip === 'walk'
            ? s.travelM / (isCav ? 2.6 : 1.45)
            : clip === 'attack'
              ? Math.max(0, 1 - s.attackAnimTimerS * 1.15)
              : simClockS * 0.42 + s.tintVar * 4.7;
        const riderLift = isCav ? 0.58 + (clip === 'walk' ? Math.abs(Math.sin(s.travelM * 2.3)) * 0.12 : 0) : 0;
        const capBoost = reg.captainAlive && s.slotIndex === 0 ? 1.07 : 1.0;
        pushActor(arch, reg.side, s.x, groundY + riderLift, s.z, s.yawRad, baseScale * capBoost, clip, phase, s.tintVar);
      }
    }

    // 2. All townsfolk (carriers, builders, workers, woodcutters, farmers, fishers)
    for (const c of state.citizens) {
      const groundY = heightAt(c.x, c.z);
      const isMoving = c.path.length > 0 || c.fleeing || c.workPhase === 'toField' || c.workPhase === 'returning';
      const isWorking = c.workPhase === 'working' || c.role === 'builder';
      const clip: UnitAnimClip = isMoving ? 'walk' : isWorking ? 'attack' : 'idle';
      const phase =
        clip === 'walk'
          ? c.travelM / 1.42
          : clip === 'attack'
            ? simClockS * 0.85 + c.id * 0.17
            : simClockS * 0.38 + c.id * 0.31;
      const tint = 0.92 + ((c.id * 37) % 17) * 0.01;
      pushActor('citizen', c.side, c.x, groundY, c.z, c.yawRad, 0.97, clip, phase, tint);
    }

    lastLiveCount = liveTotal;

    // Upload all 3 archetype LOD buckets + shadow proxy meshes cleanly (empty buckets stay count=1, scale=0!)
    for (const batch of batches) {
      const counts = lodCountsByArch[batch.archetype];
      for (let li = 0; li < 3; li++) {
        const c = counts[li]!;
        const mesh = batch.lodMeshes[li]!;
        const posAttr = batch.lodPosAttrs[li]!;
        const metaAttr = batch.lodMetaAttrs[li]!;
        if (c === 0) {
          (metaAttr.array as Float32Array)[2] = 0.0;
          mesh.count = 1;
        } else {
          mesh.count = c;
        }
        posAttr.needsUpdate = true;
        metaAttr.needsUpdate = true;
      }

      const shCount = shCountsByArch[batch.archetype];
      if (shCount === 0) {
        batch.shadowMesh.setMatrixAt(0, ZERO_MAT);
        batch.shadowMesh.count = 1;
      } else {
        batch.shadowMesh.count = shCount;
      }
      batch.shadowMesh.instanceMatrix.needsUpdate = true;
    }
  };

  // Seed initial transforms immediately before warmUp()
  update(0, new Vector3(0, 22, 36), true);

  return {
    units,
    update,
    syncFromSim,
    getLodCounts: () => ({ ...lodCounts }),
    getUnitCount: () => lastLiveCount,
    setVisible(visible: boolean) {
      for (const batch of batches) {
        for (const m of batch.lodMeshes) m.visible = visible;
        batch.shadowMesh.visible = visible;
      }
    },
    dispose() {
      for (const batch of batches) {
        for (const m of batch.lodMeshes) {
          scene.remove(m);
          (m.material as MeshStandardNodeMaterial).dispose();
        }
        scene.remove(batch.shadowMesh);
        batch.shadowMat.dispose();
        for (const g of batch.geometries) g.dispose();
        batch.boneTex.dispose();
      }
    },
  };
}
