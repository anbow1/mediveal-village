// Pure-TS single-height-function terrain model (zero three.js, deterministic, unit-tested).
// Shared identically by simulation/placement/pathing (`src/sim/`), terrain geometry (`terrainMesh.ts`),
// R2 Bézier grass blades (`grassField.ts`), and enclosed lake water (`lakeWater.ts`).

import { WORLD } from '../config.ts';
import { fbm2, noise2 } from '../core/noise.ts';

export interface LakeBasinSpec {
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusXM: number;
  readonly radiusZM: number;
  readonly maxDepthM: number;
  readonly waterLevelM: number;
}

export interface TerrainConfig {
  readonly seed: number;
  readonly sizeM: number;
  /** Coarse height grid resolution shared with GPU R32F DataTexture (281 -> 2.0 m cells over 560 m, or 161 over slice). */
  readonly gridResolution: number;
  readonly lake: LakeBasinSpec;
}

/**
 * Default Stage 4 vertical slice terrain configuration (fits cleanly inside the 560 x 560 m world):
 * - Village green & Keep terrace centered at (0, 0) (gently level ~1.15 m so buildings never float/clip)
 * - Enclosed village lake basin carved cleanly in the south-east at (26, 22) (water level = 0.0 m, depth 1.35 m)
 * - Gentle wooded knoll rising north-west around (-30, -28) up to ~5.2 m (slope grounding & rock scree)
 * - Open meadow field east/south-east for opposing regiments & road approach through Wall + Gate
 */
export const STAGE4_TERRAIN_CONFIG: TerrainConfig = {
  seed: 3,
  sizeM: WORLD.sizeM,
  gridResolution: 281,
  lake: {
    centerX: 25,
    centerZ: 21,
    radiusXM: 16.5,
    radiusZM: 11.5,
    maxDepthM: 1.35,
    waterLevelM: 0.0,
  },
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic single height function shared by game logic, terrain mesh, grass blades, and water.
 * All heights in SI metres; lake surface sits at `config.lake.waterLevelM` (0.0 m).
 */
export class TerrainField {
  readonly config: TerrainConfig;
  readonly halfSizeM: number;
  readonly cellSizeM: number;

  constructor(config: TerrainConfig = STAGE4_TERRAIN_CONFIG) {
    this.config = config;
    this.halfSizeM = config.sizeM * 0.5;
    this.cellSizeM = config.sizeM / (config.gridResolution - 1);
  }

  /** Evaluates organic distorted normalized radius inside the enclosed lake basin (< 1.0 = inside lake). */
  lakeNormalizedRadius(x: number, z: number): number {
    const lk = this.config.lake;
    const dx = (x - lk.centerX) / lk.radiusXM;
    const dz = (z - lk.centerZ) / lk.radiusZM;
    const baseR = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    // Natural organic shoreline undulation (zero geometric ellipse look)
    const warp =
      0.11 * Math.sin(angle * 3 + 0.55) +
      0.065 * Math.cos(angle * 5 - 1.1) +
      0.035 * Math.sin(angle * 7 + 2.2);
    return Math.max(0, baseR + warp);
  }

  /** Analytic terrain height in metres at world (x, z). */
  heightAt(x: number, z: number): number {
    const s = this.config.seed;
    // 1. Broad rolling central-European valley macro relief (fbm2 & noise2 return ~[-1, 1])
    const macro = fbm2(x * 0.0085 + 11.3, z * 0.0085 - 7.1, 4, s, 2.05, 0.48);
    const micro = noise2(x * 0.032 - 3.7, z * 0.032 + 5.2, s + 41);
    let h = 1.45 + macro * 2.2 + micro * 0.22;

    // 2. Gentle town plateau terrace around village center (-4, -2) so Keep, Cottages, Bakery & Farm sit level
    const townDist = Math.hypot((x + 4) / 36, (z + 2) / 30);
    const townFlat = 1 - smoothstep(0.55, 1.35, townDist);
    h = h * (1 - townFlat) + 1.25 * townFlat;

    // 3. Wooded knoll / hillside rising to the north-west (-32, -30) for real slope grounding & rock scree
    const knollDist = Math.hypot((x + 32) / 26, (z + 30) / 24);
    const knoll = Math.pow(1 - smoothstep(0.0, 1.35, knollDist), 1.65) * 4.6;
    h += knoll;

    // 4. Distant rolling border hills beyond the 100 x 100 m vertical slice (> 95 m) for scenic skyline
    const rCenter = Math.hypot(x, z);
    const rimRise = smoothstep(88, 225, rCenter);
    const rimNoise = fbm2(x * 0.011 + 2.4, z * 0.011 + 9.8, 3, s + 97, 2.1, 0.5) * 0.5 + 0.5;
    h += rimRise * (4.0 + Math.max(0, rimNoise) * 14.0);

    // 5. Carved enclosed lake basin in south-east (playbook §7.2b: gentle banks rising above water, bowl <= 1.35 m deep)
    const lk = this.config.lake;
    const lr = this.lakeNormalizedRadius(x, z);
    if (lr < 1.55) {
      // Smooth bank collar around 1.0..1.55 guarantees banks stay dry above waterLevelM everywhere
      const bankCollar = 1 - smoothstep(0.95, 1.55, lr);
      const bankTarget = Math.max(h, lk.waterLevelM + 0.58 + (lr - 0.95) * 0.9);
      h = h * (1 - bankCollar * 0.85) + bankTarget * (bankCollar * 0.85);

      if (lr < 1.08) {
        // Bowl drops cleanly from dry shore (+0.32 m at r=1.08 -> 0.0 m at r=0.98 -> -maxDepthM at center)
        const shoreT = smoothstep(1.08, 0.96, lr);
        const bowlT = Math.pow(Math.max(0, 1 - lr / 0.98), 1.35);
        const lakeBed = lk.waterLevelM - lk.maxDepthM * bowlT;
        h = h * (1 - shoreT) + lakeBed * shoreT;
      }
    }

    return h;
  }

  /** Water depth (> 0 inside the lake basin, 0 on dry land). */
  waterDepthAt(x: number, z: number): number {
    return Math.max(0, this.config.lake.waterLevelM - this.heightAt(x, z));
  }

  isWater(x: number, z: number): boolean {
    return this.waterDepthAt(x, z) > 0.01;
  }

  /** Central-difference surface normal (unit length, +Y up). */
  normalAt(x: number, z: number, epsM = 0.5): { x: number; y: number; z: number } {
    const hL = this.heightAt(x - epsM, z);
    const hR = this.heightAt(x + epsM, z);
    const hD = this.heightAt(x, z - epsM);
    const hU = this.heightAt(x, z + epsM);
    const nx = hL - hR;
    const ny = 2 * epsM;
    const nz = hD - hU;
    const inv = 1 / Math.hypot(nx, ny, nz);
    return { x: nx * inv, y: ny * inv, z: nz * inv };
  }

  /** Slope magnitude (1 - normal.y, 0 = flat, > 0.14 = steep rocky scree). */
  slopeAt(x: number, z: number): number {
    return 1 - this.normalAt(x, z).y;
  }

  /**
   * Builds a Float32Array R32F height grid [gridResolution x gridResolution] matching the exact
   * vertex grid used by `terrainMesh.ts` and `grassField.ts` (`textureLoad` exact triangle lookup).
   */
  bakeHeightGrid(): Float32Array {
    const n = this.config.gridResolution;
    const data = new Float32Array(n * n);
    const half = this.halfSizeM;
    const step = this.cellSizeM;
    for (let iz = 0; iz < n; iz++) {
      const z = -half + iz * step;
      for (let ix = 0; ix < n; ix++) {
        const x = -half + ix * step;
        data[iz * n + ix] = this.heightAt(x, z);
      }
    }
    return data;
  }

  /**
   * Exact CPU mirror of the GPU `grassField.ts` triangle-split height interpolation on `bakeHeightGrid()`.
   * Uses the same `(0,0)-(1,1)` diagonal split (`fx >= fz` vs `fx < fz`) as Three.js `PlaneGeometry`
   * rotated `-PI/2` on X so grass blades never float or sink on slopes (playbook §5.6 #3).
   */
  sampleGridHeight(grid: Float32Array, x: number, z: number): number {
    const n = this.config.gridResolution;
    const half = this.halfSizeM;
    const gx = Math.max(0, Math.min(n - 1.0001, (x + half) / this.cellSizeM));
    const gz = Math.max(0, Math.min(n - 1.0001, (z + half) / this.cellSizeM));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = grid[iz * n + ix]!;
    const h10 = grid[iz * n + ix + 1]!;
    const h01 = grid[(iz + 1) * n + ix]!;
    const h11 = grid[(iz + 1) * n + ix + 1]!;
    // PlaneGeometry splits each cell along diagonal (1,0)-(0,1) -> fx + fz <= 1 vs > 1
    if (fx + fz <= 1) {
      return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    }
    return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  }
}
