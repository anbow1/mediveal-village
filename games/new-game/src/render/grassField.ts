// Real vertex-generated Roberts R2 low-discrepancy Bézier grass blades (docs/graphics-playbook.md §5.6).
// 3 camera-focus rings (3 draw calls total), exact GPU height lookup from TerrainField R32F DataTexture
// (`textureLoad` with matching PlaneGeometry diagonal split -> zero floating/sinking blades on slopes),
// groundWorks density masking (zero blades in water/roads/ploughed strips/yards), travelling wind gusts,
// root-to-tip AO, and 1/sqrt(keep) width compensation so blades stay >= 1.3 px wide without comb aliasing.

import {
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardNodeMaterial,
  Object3D,
  Vector2,
} from 'three/webgpu';
import {
  attribute,
  clamp,
  cos,
  float,
  floor,
  fract,
  int,
  ivec2,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { QualityPreset } from '../config.ts';
import type { GroundWorksMap } from '../sim/groundWorks.ts';
import type { TerrainField } from '../sim/terrain.ts';
import { buildCloudShadowNode, type PhysicalSkyUniforms } from './sky.ts';

/** Roberts R2 2D quasirandom sequence constants (Martin Roberts 2018; any prefix is evenly distributed). */
const R2_G = 1.324717957244746;
const R2_A1 = 1 / R2_G;
const R2_A2 = 1 / (R2_G * R2_G);

interface RingSpec {
  readonly name: string;
  readonly segments: number;
  readonly bladesPerTile: number;
  readonly minRadiusTiles: number;
  readonly maxRadiusTiles: number;
  readonly fadeStartM: number;
  readonly fadeEndM: number;
  readonly widthScale: number;
}

export interface GrassFieldHandles {
  readonly meshes: readonly InstancedMesh[];
  readonly totalBlades: number;
  readonly totalTriangles: number;
  readonly update: (focusX: number, focusZ: number, simTimeS: number) => void;
  readonly dispose: () => void;
}

/**
 * Builds one tile geometry containing `bladeCount` R2-ordered tapered Bézier blades
 * (each blade has `segments` stacked quads + pointed tip = `segments * 2 - 1` tris).
 * Per-vertex attributes:
 *   position: (side [-1..+1], t [0..1] along blade height, rank [0..1] in R2 sequence)
 *   aBlade:   (localX [0..tileSizeM], localZ [0..tileSizeM], yawRad, randScale [0.7..1.35])
 */
function buildGrassTileGeometry(tileSizeM: number, bladeCount: number, segments: number): BufferGeometry {
  const vertsPerBlade = segments * 2 + 1;
  const trisPerBlade = Math.max(1, segments * 2 - 1);

  const positions = new Float32Array(bladeCount * vertsPerBlade * 3);
  const bladeAttr = new Float32Array(bladeCount * vertsPerBlade * 4);
  const indices = new Uint32Array(bladeCount * trisPerBlade * 3);

  let vCursor = 0;
  let iCursor = 0;

  for (let b = 0; b < bladeCount; b++) {
    const rank = (b + 0.5) / bladeCount;
    // Roberts R2 quasirandom tile coordinates + slight organic jitter to kill any lattice regularity
    const u0 = (0.5 + (b + 1) * R2_A1) % 1;
    const v0 = (0.5 + (b + 1) * R2_A2) % 1;
    const h1 = Math.sin(b * 12.9898 + 1.23) * 43758.5453;
    const h2 = Math.sin(b * 78.233 + 4.56) * 43758.5453;
    const jx = (h1 - Math.floor(h1) - 0.5) * 0.14;
    const jz = (h2 - Math.floor(h2) - 0.5) * 0.14;
    const lx = (((u0 + jx) % 1) + 1) % 1 * tileSizeM;
    const lz = (((v0 + jz) % 1) + 1) % 1 * tileSizeM;

    const h3 = Math.sin(b * 37.719 + 7.89) * 43758.5453;
    const yaw = (h3 - Math.floor(h3)) * Math.PI * 2;
    const h4 = Math.sin(b * 93.137 + 2.11) * 43758.5453;
    const rScale = 0.72 + (h4 - Math.floor(h4)) * 0.62;

    const baseV = vCursor;
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      // Left & right edge vertices
      for (const side of [-1, 1]) {
        const p3 = vCursor * 3;
        positions[p3] = side;
        positions[p3 + 1] = t;
        positions[p3 + 2] = rank;
        const p4 = vCursor * 4;
        bladeAttr[p4] = lx;
        bladeAttr[p4 + 1] = lz;
        bladeAttr[p4 + 2] = yaw;
        bladeAttr[p4 + 3] = rScale;
        vCursor++;
      }
    }
    // Single pointed tip vertex (t = 1.0)
    const p3 = vCursor * 3;
    positions[p3] = 0;
    positions[p3 + 1] = 1;
    positions[p3 + 2] = rank;
    const p4 = vCursor * 4;
    bladeAttr[p4] = lx;
    bladeAttr[p4 + 1] = lz;
    bladeAttr[p4 + 2] = yaw;
    bladeAttr[p4 + 3] = rScale;
    vCursor++;

    // Stitch quad rungs + pointed tip triangle
    for (let s = 0; s < segments - 1; s++) {
      const r0 = baseV + s * 2;
      const r1 = r0 + 2;
      indices[iCursor++] = r0;
      indices[iCursor++] = r0 + 1;
      indices[iCursor++] = r1 + 1;
      indices[iCursor++] = r0;
      indices[iCursor++] = r1 + 1;
      indices[iCursor++] = r1;
    }
    const lastRung = baseV + (segments - 1) * 2;
    const tip = baseV + segments * 2;
    indices[iCursor++] = lastRung;
    indices[iCursor++] = lastRung + 1;
    indices[iCursor++] = tip;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('aBlade', new Float32BufferAttribute(bladeAttr, 4));
  geo.setIndex(Array.from(indices));
  // Large local bounding sphere avoids incorrect frustum culling of vertex-displaced grass tiles
  geo.computeBoundingSphere();
  if (geo.boundingSphere) geo.boundingSphere.radius = tileSizeM * 2;
  return geo;
}

/** Collects tile offsets `(tx, tz)` belonging to an annular ring `[minRadiusTiles, maxRadiusTiles)`. */
function buildRingTileOffsets(minRadiusTiles: number, maxRadiusTiles: number): [number, number][] {
  const out: [number, number][] = [];
  const rCeil = Math.ceil(maxRadiusTiles);
  for (let tz = -rCeil; tz <= rCeil; tz++) {
    for (let tx = -rCeil; tx <= rCeil; tx++) {
      const d = Math.hypot(tx, tz);
      if (d >= minRadiusTiles && d < maxRadiusTiles) {
        out.push([tx, tz]);
      }
    }
  }
  return out;
}

/**
 * Builds the 3-ring Roberts R2 Bézier grass field sharing `TerrainField`'s exact R32F height grid
 * and `GroundWorksMap` RGBA8 cover texture (only 3 draw calls total!).
 */
export function buildGrassField(
  terrain: TerrainField,
  groundWorks: GroundWorksMap,
  heightTexture: DataTexture,
  groundWorksTexture: DataTexture,
  quality: QualityPreset,
  skyUniforms?: PhysicalSkyUniforms,
): GrassFieldHandles {
  if (quality === 'minimal') {
    return {
      meshes: [],
      totalBlades: 0,
      totalTriangles: 0,
      update: () => undefined,
      dispose: () => undefined,
    };
  }
  const tileSizeM = 3.2;
  const isHigh = quality === 'high';

  const ringSpecs: readonly RingSpec[] = [
    {
      name: 'GrassRing0_Near',
      segments: 3,
      bladesPerTile: isHigh ? 420 : 180,
      minRadiusTiles: 0,
      maxRadiusTiles: 3.8,
      fadeStartM: 10,
      fadeEndM: 19,
      widthScale: 0.90,
    },
    {
      name: 'GrassRing1_Mid',
      segments: 2,
      bladesPerTile: isHigh ? 115 : 54,
      minRadiusTiles: 3.8,
      maxRadiusTiles: 7.8,
      fadeStartM: 19,
      fadeEndM: 32,
      widthScale: 1.28,
    },
    {
      name: 'GrassRing2_Far',
      segments: 1,
      bladesPerTile: isHigh ? 38 : 18,
      minRadiusTiles: 7.8,
      maxRadiusTiles: 12.2,
      fadeStartM: 30,
      fadeEndM: 46,
      widthScale: 1.75,
    },
  ];

  const uFocusXZ = uniform(new Vector2(0, 0));
  const uWindTimeS = uniform(0.0);

  const gridN = terrain.config.gridResolution;
  const halfWorld = terrain.halfSizeM;
  const cellSize = terrain.cellSizeM;
  const gwHalf = groundWorks.halfSpanM;
  const gwSpan = groundWorks.spanM;
  const waterLevel = terrain.config.lake.waterLevelM;

  // Shared TSL grass material driven by per-ring uniforms/instance attributes (all 3 rings share 1 shader!)
  const createRingMaterial = (spec: RingSpec): MeshStandardNodeMaterial => {
    const mat = new MeshStandardNodeMaterial({
      roughness: 0.88,
      metalness: 0.0,
      side: DoubleSide,
    });
    mat.name = `MarchlandGrassMat_${spec.segments}seg`;

    const aTileOffset = attribute('aTileOffset', 'vec2');
    const aBlade = attribute('aBlade', 'vec4');
    const side = positionLocal.x;
    const t = positionLocal.y;
    const rank = positionLocal.z;

    // World root position of this grass blade (snapped to tile grid around focus point -> zero swimming!)
    const snapFocus = floor(uFocusXZ.div(float(tileSizeM))).mul(float(tileSizeM));
    const rootXZ = snapFocus.add(aTileOffset.mul(float(tileSizeM))).add(aBlade.xy);

    // Exact terrain height lookup via R32F textureLoad + PlaneGeometry diagonal split (fx + fz <= 1)
    const maxIdx = float(gridN - 2);
    const gx = clamp(rootXZ.x.add(float(halfWorld)).div(float(cellSize)), float(0.0), maxIdx);
    const gz = clamp(rootXZ.y.add(float(halfWorld)).div(float(cellSize)), float(0.0), maxIdx);
    const ix = int(floor(gx));
    const iz = int(floor(gz));
    const fx = fract(gx);
    const fz = fract(gz);

    const h00 = texture(heightTexture).load(ivec2(ix, iz)).r;
    const h10 = texture(heightTexture).load(ivec2(ix.add(int(1)), iz)).r;
    const h01 = texture(heightTexture).load(ivec2(ix, iz.add(int(1)))).r;
    const h11 = texture(heightTexture).load(ivec2(ix.add(int(1)), iz.add(int(1)))).r;

    const triA = h00.add(fx.mul(h10.sub(h00))).add(fz.mul(h01.sub(h00)));
    const triB = h11.add(float(1.0).sub(fx).mul(h01.sub(h11))).add(float(1.0).sub(fz).mul(h10.sub(h11)));
    const groundY = select(fx.add(fz).lessThanEqual(float(1.0)), triA, triB);

    // Approximate terrain slope from adjacent cell heights to suppress grass on steep rock scree
    const dHx = h10.sub(h00).div(float(cellSize));
    const dHz = h01.sub(h00).div(float(cellSize));
    const slopeSq = dHx.mul(dHx).add(dHz.mul(dHz));
    const slopeKeep = float(1.0).sub(smoothstep(float(0.08), float(0.24), slopeSq));

    // Sample dynamic groundWorks RGBA8 at vertex stage with explicit .level(0) (playbook §11)
    const gwUv = clamp(rootXZ.add(vec2(gwHalf)).div(float(gwSpan)), vec2(0.002), vec2(0.998));
    const inGw = rootXZ.x
      .greaterThan(float(-gwHalf + 0.5))
      .and(rootXZ.x.lessThan(float(gwHalf - 0.5)))
      .and(rootXZ.y.greaterThan(float(-gwHalf + 0.5)))
      .and(rootXZ.y.lessThan(float(gwHalf - 0.5)));
    const gw = texture(groundWorksTexture, gwUv).level(float(0.0));
    const dirtW = inGw.select(gw.r, float(0.0));
    const cobbleW = inGw.select(gw.g, float(0.0));
    const farmW = inGw.select(gw.b, float(0.0));
    const canopyW = inGw.select(gw.a, float(0.0));

    // Dry above lake bank (> +0.16 m), off cobbled roads, off ploughed farm strips, off bare dirt yards
    const dryKeep = smoothstep(float(waterLevel + 0.14), float(waterLevel + 0.36), groundY);
    const roadClear = float(1.0).sub(smoothstep(float(0.06), float(0.26), cobbleW));
    const farmClear = float(1.0).sub(smoothstep(float(0.05), float(0.22), farmW));
    // Grass thins out smoothly BEFORE bare trampled dirt shows (playbook §5.6 #8)
    const dirtClear = float(1.0).sub(smoothstep(float(0.14), float(0.54), dirtW));
    const canopyClear = float(1.0).sub(canopyW.mul(0.55));

    // Organic two-sine clump field breaks up uniform lawn look
    const clump = sin(rootXZ.x.mul(0.42).add(sin(rootXZ.y.mul(0.37)).mul(1.6)))
      .mul(cos(rootXZ.y.mul(0.48).sub(rootXZ.x.mul(0.29))))
      .mul(0.5)
      .add(0.5);

    // Distance-based smooth rank prefix culling (no pop: blades shrink over last 15% of kept ranks)
    const distM = length(rootXZ.sub(uFocusXZ));
    const distFade = float(1.0).sub(smoothstep(float(spec.fadeStartM), float(spec.fadeEndM), distM));
    const densityMask = dryKeep.mul(roadClear).mul(farmClear).mul(dirtClear).mul(canopyClear).mul(slopeKeep);
    const keepFrac = clamp(densityMask.mul(distFade).mul(float(0.68).add(clump.mul(0.45))), float(0.0), float(1.0));
    const rankScale = smoothstep(rank.sub(0.02), rank.add(0.14), keepFrac);

    // Shoreline sedge grows slightly taller near damp lake bank; meadow stays realistic 20–36 cm
    const nearShore = smoothstep(float(waterLevel + 0.95), float(waterLevel + 0.25), groundY).mul(dryKeep);
    const baseHeight = float(0.19).add(clump.mul(0.14)).add(nearShore.mul(0.15)).mul(aBlade.w).mul(rankScale);
    // Widen surviving blades by 1/sqrt(keep) to maintain >= 1.3 px visual coverage without striping (playbook §5.6 #2)
    const widthComp = clamp(float(1.0).div(sqrt(max(keepFrac, float(0.2)))), float(1.0), float(1.85));
    const halfWidth = float(0.026).mul(float(spec.widthScale)).mul(widthComp).mul(float(1.0).sub(t.mul(0.86))).mul(rankScale);

    // Travelling wind gust waves bending quadratic Bézier blade smoothly along lean direction
    const yaw = aBlade.z;
    const faceDirX = cos(yaw);
    const faceDirZ = sin(yaw);
    const sideDirX = faceDirZ.negate();
    const sideDirZ = faceDirX;

    const gustPhase = rootXZ.x.mul(0.18).add(rootXZ.y.mul(0.13)).sub(uWindTimeS.mul(1.85));
    const gust = sin(gustPhase).mul(0.5).add(0.5).mul(sin(gustPhase.mul(0.43).add(1.1)).mul(0.5).add(0.5));
    const windBend = float(0.08).add(gust.mul(0.19)).mul(baseHeight);

    // Quadratic Bézier arch: horizontal lean grows as t^2 so roots stay upright & tips gracefully arc (avoids corduroy!)
    const staticLean = baseHeight.mul(0.56);
    const bendT = t.mul(t);
    const archX = faceDirX.mul(staticLean).add(float(0.86).mul(windBend)).mul(bendT);
    const archZ = faceDirZ.mul(staticLean).add(float(0.51).mul(windBend)).mul(bendT);
    const archY = baseHeight.mul(t).mul(float(1.0).sub(t.mul(0.28)));

    const worldX = rootXZ.x.add(archX).add(sideDirX.mul(side).mul(halfWidth));
    const worldY = groundY.sub(float(0.03)).add(archY);
    const worldZ = rootXZ.y.add(archZ).add(sideDirZ.mul(side).mul(halfWidth));

    mat.positionNode = vec3(worldX, worldY, worldZ);

    // Shading normal blended mostly straight up so field shades coherently with terrain (playbook §5.6 #5)
    mat.normalNode = normalize(vec3(faceDirX.mul(0.26), float(0.95), faceDirZ.mul(0.26)));

    // Ground-matched verdant European meadow palette (lush green base & sunlit emerald-gold tips)
    const macroCol = sin(rootXZ.x.mul(0.043).add(sin(rootXZ.y.mul(0.039)).mul(2.1)))
      .mul(sin(rootXZ.y.mul(0.051).sub(rootXZ.x.mul(0.034))))
      .mul(0.5)
      .add(0.5);
    const rootTint = vec3(0.085, 0.165, 0.045);
    const tipGreen = mix(vec3(0.16, 0.33, 0.075), vec3(0.26, 0.36, 0.085), macroCol);
    const tipDry = vec3(0.35, 0.33, 0.105);
    const bladeTip = mix(tipGreen, tipDry, clamp(aBlade.w.sub(0.84).mul(0.85), float(0.0), float(0.45)));
    const shadeCanopy = mix(float(1.0), float(0.68), canopyW);
    const cloudShade = skyUniforms ? buildCloudShadowNode(rootXZ, skyUniforms, 0.20) : float(1.0);
    const bladeCol = mix(rootTint, bladeTip, sqrt(clamp(t, float(0.0), float(1.0)))).mul(shadeCanopy).mul(cloudShade);
    mat.colorNode = bladeCol;

    return mat;
  };

  const meshes: InstancedMesh[] = [];
  const geometries: BufferGeometry[] = [];
  const materials: MeshStandardNodeMaterial[] = [];
  let totalBlades = 0;
  let totalTriangles = 0;

  const dummy = new Object3D();
  dummy.position.set(0, 0, 0);
  dummy.updateMatrix();

  for (const spec of ringSpecs) {
    const offsets = buildRingTileOffsets(spec.minRadiusTiles, spec.maxRadiusTiles);
    const geo = buildGrassTileGeometry(tileSizeM, spec.bladesPerTile, spec.segments);
    const offsetArr = new Float32Array(offsets.length * 2);
    for (let i = 0; i < offsets.length; i++) {
      offsetArr[i * 2] = offsets[i]![0];
      offsetArr[i * 2 + 1] = offsets[i]![1];
    }
    geo.setAttribute('aTileOffset', new InstancedBufferAttribute(offsetArr, 2));

    const mat = createRingMaterial(spec);
    const inst = new InstancedMesh(geo, mat, offsets.length);
    inst.name = spec.name;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;

    for (let i = 0; i < offsets.length; i++) {
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;

    meshes.push(inst);
    geometries.push(geo);
    materials.push(mat);

    const ringBlades = offsets.length * spec.bladesPerTile;
    totalBlades += ringBlades;
    totalTriangles += ringBlades * Math.max(1, spec.segments * 2 - 1);
  }

  return {
    meshes,
    totalBlades,
    totalTriangles,
    update(focusX: number, focusZ: number, simTimeS: number) {
      uFocusXZ.value.set(focusX, focusZ);
      uWindTimeS.value = simTimeS;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
