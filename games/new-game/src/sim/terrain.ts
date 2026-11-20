// Pure-TS single-height-function terrain model (zero three.js, deterministic, unit-tested).
// Shared identically by simulation/placement/pathing (`src/sim/`), terrain geometry (`terrainMesh.ts`),
// R2 Bézier grass blades (`grassField.ts`), and physical lakes/rivers (`lakeWater.ts`).
// Supports Stage 4 vertical slice (`slice`) AND all 5 full 560 x 560 m Campaign/Skirmish map layouts:
//   - `crossing`  (Missions 1-2: river, stone causeway, 2 gravel fords, west town, east war camp)
//   - `openField` (rolling plains, twin flanking lakes, central tactical ridge)
//   - `forest`    (wooded highlands, winding glades, secluded forest tarn)
//   - `valley`    (Missions 3-4: twin mountain ridges 175 m off axis w/ peaks every 52 m + pass)
//   - `fortress`  (Mission 5: 7 m high citadel plateau flat to 100 m radius + southern river ford)

import { WORLD } from '../config.ts';
import { fbm2, noise2 } from '../core/noise.ts';

export type MapLayoutId = 'crossing' | 'openField' | 'forest' | 'valley' | 'fortress';
export type TerrainProfileId = 'slice' | MapLayoutId;

export interface LakeBasinSpec {
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusXM: number;
  readonly radiusZM: number;
  readonly maxDepthM: number;
  readonly waterLevelM: number;
}

export interface RiverSpec {
  /** 'ns' = runs north-south along Z (center X varies with Z); 'ew' = runs east-west along X (center Z varies with X). */
  readonly axis: 'ns' | 'ew';
  readonly baseCoordM: number;
  readonly meanderAmpM: number;
  readonly meanderFreq: number;
  readonly halfWidthM: number;
  readonly maxDepthM: number;
  readonly waterLevelM: number;
  /** Passable shallow gravel fords (depth ~0.16 m) and raised dry stone causeways (+0.45 m). */
  readonly crossings: readonly {
    readonly coordM: number;
    readonly halfSpanM: number;
    readonly kind: 'causeway' | 'ford';
  }[];
}

export interface FlatTerraceSpec {
  readonly cx: number;
  readonly cz: number;
  readonly radiusXM: number;
  readonly radiusZM: number;
  readonly heightM: number;
  readonly blendM: number;
}

export interface MountainPeakSpec {
  readonly cx: number;
  readonly cz: number;
  readonly radiusM: number;
  readonly heightM: number;
}

export interface TerrainConfig {
  readonly profile: TerrainProfileId;
  readonly seed: number;
  readonly sizeM: number;
  /** Coarse height grid resolution shared with GPU R32F DataTexture (281 -> 2.0 m cells over 560 m). */
  readonly gridResolution: number;
  readonly lake: LakeBasinSpec;
  readonly extraLakes?: readonly LakeBasinSpec[];
  readonly river?: RiverSpec;
  readonly terraces?: readonly FlatTerraceSpec[];
  readonly peaks?: readonly MountainPeakSpec[];
  readonly fortressPlateau?: {
    readonly cx: number;
    readonly cz: number;
    readonly flatRadiusM: number;
    readonly slopeOuterRadiusM: number;
    readonly heightM: number;
    /** Gentle southern approach ramp azimuth & width for siege access. */
    readonly rampZDir: 1 | -1;
    readonly rampHalfWidthM: number;
  };
}

/**
 * Default Stage 4 vertical slice terrain configuration (kept 100% intact for unit test continuity).
 */
export const STAGE4_TERRAIN_CONFIG: TerrainConfig = {
  profile: 'slice',
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
 * All heights in SI metres; water surface sits at `config.lake.waterLevelM` (0.0 m).
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

  /** Evaluates organic distorted normalized radius inside any enclosed lake basin (< 1.0 = inside lake). */
  lakeNormalizedRadius(x: number, z: number, lk: LakeBasinSpec = this.config.lake): number {
    const dx = (x - lk.centerX) / lk.radiusXM;
    const dz = (z - lk.centerZ) / lk.radiusZM;
    const baseR = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const warp =
      0.11 * Math.sin(angle * 3 + 0.55) +
      0.065 * Math.cos(angle * 5 - 1.1) +
      0.035 * Math.sin(angle * 7 + 2.2);
    return Math.max(0, baseR + warp);
  }

  /** Returns river centerline coordinate along perpendicular axis for a given longitudinal coord. */
  riverCenterAt(alongCoordM: number): number {
    const rv = this.config.river;
    if (!rv) return 1e9;
    return (
      rv.baseCoordM +
      Math.sin(alongCoordM * rv.meanderFreq + 0.4) * rv.meanderAmpM +
      Math.sin(alongCoordM * rv.meanderFreq * 2.15 - 1.2) * (rv.meanderAmpM * 0.32)
    );
  }

  /** Signed normalized distance to river channel (< 1.0 = in channel, > 1.0 = dry bank). */
  riverNormalizedDistance(x: number, z: number): number {
    const rv = this.config.river;
    if (!rv) return 999;
    const along = rv.axis === 'ns' ? z : x;
    const across = rv.axis === 'ns' ? x : z;
    const center = this.riverCenterAt(along);
    const widthWarp = 1.0 + 0.14 * Math.sin(along * 0.045 + 1.1);
    return Math.abs(across - center) / (rv.halfWidthM * widthWarp);
  }

  /** Applies carved organic enclosed lake depression with guaranteed dry bank collar. */
  private applyLakeBasin(h: number, x: number, z: number, lk: LakeBasinSpec): number {
    const lr = this.lakeNormalizedRadius(x, z, lk);
    if (lr >= 1.55) return h;
    const bankCollar = 1 - smoothstep(0.95, 1.55, lr);
    const bankTarget = Math.max(h, lk.waterLevelM + 0.58 + (lr - 0.95) * 0.9);
    let out = h * (1 - bankCollar * 0.85) + bankTarget * (bankCollar * 0.85);
    if (lr < 1.08) {
      const shoreT = smoothstep(1.08, 0.96, lr);
      const bowlT = Math.pow(Math.max(0, 1 - lr / 0.98), 1.35);
      const lakeBed = lk.waterLevelM - lk.maxDepthM * bowlT;
      out = out * (1 - shoreT) + lakeBed * shoreT;
    }
    return out;
  }

  /** Applies meandering river channel with raised dry stone causeway & shallow passable gravel fords. */
  private applyRiverChannel(h: number, x: number, z: number, rv: RiverSpec): number {
    const nr = this.riverNormalizedDistance(x, z);
    if (nr >= 2.1) return h;

    const along = rv.axis === 'ns' ? z : x;
    // Gentle floodplain bank taper approaching river edges
    const bankBlend = 1 - smoothstep(1.02, 2.05, nr);
    const bankTarget = Math.max(rv.waterLevelM + 0.52, Math.min(h, rv.waterLevelM + 1.35));
    let out = h * (1 - bankBlend * 0.72) + bankTarget * (bankBlend * 0.72);

    if (nr < 1.16) {
      const channelT = smoothstep(1.16, 0.92, nr);
      const depthProfile = Math.pow(Math.max(0, 1 - nr / 0.96), 1.25);
      let bedY = rv.waterLevelM - rv.maxDepthM * depthProfile;

      // Apply stone causeways (dry road deck) & shallow gravel fords
      for (const cr of rv.crossings) {
        const dAlong = Math.abs(along - cr.coordM);
        if (dAlong < cr.halfSpanM + 5.5) {
          const ct = 1 - smoothstep(cr.halfSpanM - 1.5, cr.halfSpanM + 5.5, dAlong);
          if (cr.kind === 'causeway') {
            bedY = bedY * (1 - ct) + (rv.waterLevelM + 0.58) * ct;
          } else {
            // Shallow gravel ford (~0.14 m water depth — visibly wet & easily fordable!)
            const fordBed = rv.waterLevelM - 0.14 * depthProfile;
            bedY = bedY * (1 - ct) + fordBed * ct;
          }
        }
      }
      out = out * (1 - channelT) + bedY * channelT;
    }
    return out;
  }

  /** Analytic terrain height in metres at world (x, z). */
  heightAt(x: number, z: number): number {
    const s = this.config.seed;
    const profile = this.config.profile;

    // Preserve exact Stage 4 vertical slice profile bit-for-bit when profile === 'slice'
    if (profile === 'slice') {
      const macro = fbm2(x * 0.0085 + 11.3, z * 0.0085 - 7.1, 4, s, 2.05, 0.48);
      const micro = noise2(x * 0.032 - 3.7, z * 0.032 + 5.2, s + 41);
      let h = 1.45 + macro * 2.2 + micro * 0.22;

      const townDist = Math.hypot((x + 4) / 36, (z + 2) / 30);
      const townFlat = 1 - smoothstep(0.55, 1.35, townDist);
      h = h * (1 - townFlat) + 1.25 * townFlat;

      const knollDist = Math.hypot((x + 32) / 26, (z + 30) / 24);
      const knoll = Math.pow(1 - smoothstep(0.0, 1.35, knollDist), 1.65) * 4.6;
      h += knoll;

      const rCenter = Math.hypot(x, z);
      const rimRise = smoothstep(88, 225, rCenter);
      const rimNoise = fbm2(x * 0.011 + 2.4, z * 0.011 + 9.8, 3, s + 97, 2.1, 0.5) * 0.5 + 0.5;
      h += rimRise * (4.0 + Math.max(0, rimNoise) * 14.0);

      return this.applyLakeBasin(h, x, z, this.config.lake);
    }

    // ---- Stage 5 Full 560 x 560 m Campaign & Skirmish Maps ----
    const reliefAmp = profile === 'openField' ? 2.4 : profile === 'forest' ? 4.2 : profile === 'valley' ? 2.8 : 2.6;
    const macro = fbm2(x * 0.0068 + 9.4, z * 0.0068 - 5.3, 4, s, 2.05, 0.48);
    const mid = fbm2(x * 0.019 - 2.1, z * 0.019 + 4.7, 3, s + 23, 2.0, 0.45);
    const micro = noise2(x * 0.042 + 6.3, z * 0.042 - 1.9, s + 47);
    let h = 1.85 + macro * reliefAmp + mid * 0.55 + micro * 0.16;

    // Gentle tactical center hill on openField
    if (profile === 'openField') {
      const ridge = Math.pow(1 - smoothstep(0, 72, Math.hypot(x / 1.35, z / 0.85)), 1.6) * 3.4;
      h += ridge;
    }

    // Distant perimeter mountain horizon frame near map edge (> 215 m from center)
    const edgeDist = Math.max(Math.abs(x), Math.abs(z));
    const rimT = smoothstep(205, 278, edgeDist);
    const rimNoise = fbm2(x * 0.012 + 3.1, z * 0.012 + 8.4, 3, s + 91, 2.1, 0.5) * 0.5 + 0.5;
    h += rimT * (4.5 + Math.max(0, rimNoise) * 13.5);

    // Explicit settlement / camp terraces so villages and keeps sit level without floating
    if (this.config.terraces) {
      for (const tr of this.config.terraces) {
        const d = Math.hypot((x - tr.cx) / tr.radiusXM, (z - tr.cz) / tr.radiusZM);
        if (d < 1.0 + tr.blendM / Math.min(tr.radiusXM, tr.radiusZM)) {
          const blendR = 1.0 + tr.blendM / Math.min(tr.radiusXM, tr.radiusZM);
          const flat = 1 - smoothstep(0.72, blendR, d);
          h = h * (1 - flat) + tr.heightM * flat;
        }
      }
    }

    // Mission 5 Fortress 7 m Citadel Plateau (flat to 100 m radius, steep sides, gentle south siege ramp!)
    const fp = this.config.fortressPlateau;
    if (fp) {
      const dx = x - fp.cx;
      const dz = z - fp.cz;
      const dist = Math.hypot(dx, dz);
      // Slight organic rock contour outside the strict 100 m flat top
      const ang = Math.atan2(dz, dx);
      const outerR = fp.slopeOuterRadiusM + Math.sin(ang * 5 + 0.7) * 5.5 + Math.cos(ang * 3 - 0.5) * 4.0;

      // Broad approach ramp extending from south gate (+Z) smoothly down from 7 m -> 1.8 m
      const onRampSide = dz * fp.rampZDir > 0;
      const rampLat = Math.abs(dx);
      const rampMask = onRampSide
        ? (1 - smoothstep(fp.rampHalfWidthM * 0.65, fp.rampHalfWidthM * 1.45, rampLat)) *
          smoothstep(fp.flatRadiusM - 6, fp.flatRadiusM + 8, Math.abs(dz))
        : 0;

      if (dist <= fp.flatRadiusM) {
        h = fp.heightM;
      } else if (dist < outerR + 32) {
        const effOuter = outerR + rampMask * 30.0;
        const slopeT = 1 - smoothstep(fp.flatRadiusM, effOuter, dist);
        const shaped = rampMask > 0.25 ? slopeT : Math.pow(slopeT, 0.72);
        h = h * (1 - shaped) + fp.heightM * shaped;
      }
    }

    // Mountain ridge peaks (e.g., Mission 3-4 Valley twin ridges 175 m off axis, peak every 52 m!)
    if (this.config.peaks) {
      for (const pk of this.config.peaks) {
        const d = Math.hypot(x - pk.cx, z - pk.cz);
        if (d < pk.radiusM) {
          const u = 1 - d / pk.radiusM;
          const crag = 0.88 + 0.24 * Math.abs(noise2(x * 0.06, z * 0.06, s + 131));
          h += u * u * (3 - 2 * u) * pk.heightM * crag;
        }
      }
    }

    // Carve water bodies LAST (except never carving into Mission 5's fortress plateau!)
    const inFortressFlat =
      fp !== undefined && Math.hypot(x - fp.cx, z - fp.cz) < fp.flatRadiusM + 14;
    if (!inFortressFlat) {
      if (this.config.lake.radiusXM > 1) {
        h = this.applyLakeBasin(h, x, z, this.config.lake);
      }
      if (this.config.extraLakes) {
        for (const lk of this.config.extraLakes) {
          h = this.applyLakeBasin(h, x, z, lk);
        }
      }
      if (this.config.river) {
        h = this.applyRiverChannel(h, x, z, this.config.river);
      }
    }

    return h;
  }

  /** Water depth (> 0 inside lake or river channel, 0 on dry land & raised causeways). */
  waterDepthAt(x: number, z: number): number {
    const wl = this.config.river?.waterLevelM ?? this.config.lake.waterLevelM;
    return Math.max(0, wl - this.heightAt(x, z));
  }

  isWater(x: number, z: number): boolean {
    return this.waterDepthAt(x, z) > 0.01;
  }

  /** True when water is too deep for infantry to wade (> 0.35 m; shallow 0.14 m fords are passable!). */
  isDeepWater(x: number, z: number): boolean {
    return this.waterDepthAt(x, z) > 0.35;
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

  /** Slope magnitude (1 - normal.y, 0 = flat, > 0.14 = steep rocky scree, > 0.32 = impassable cliff). */
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
   * Uses the same `(0,0)-(1,1)` diagonal split as Three.js `PlaneGeometry` rotated `-PI/2` on X.
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
    if (fx + fz <= 1) {
      return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    }
    return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  }
}
