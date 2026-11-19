// Pure-TS LOD level selection with distance hysteresis (GUIDE.md §3 Stage 2, §5).
// Level 0 = LOD0 (hero close-up), 1 = LOD1 (mid RTS), 2 = LOD2 (far), 3 = matte impostor card (> 100 m).

export type LodLevel = 0 | 1 | 2 | 3;

export interface LodThresholds {
  /** Distance (m) where LOD0 steps down to LOD1. */
  readonly lod1M: number;
  /** Distance (m) where LOD1 steps down to LOD2. */
  readonly lod2M: number;
  /** Optional distance (m) where LOD2 steps down to matte impostor card (> 100 m per GUIDE.md). */
  readonly impostorM?: number;
  /** Hysteresis margin (m) preventing back-and-forth popping when camera hovers near a threshold. */
  readonly hysteresisM?: number;
}

export const BUILDING_LOD_THRESHOLDS: LodThresholds = {
  lod1M: 32,
  lod2M: 70,
  impostorM: 105,
  hysteresisM: 3.0,
};

export const TREE_LOD_THRESHOLDS: LodThresholds = {
  lod1M: 28,
  lod2M: 64,
  impostorM: 102,
  hysteresisM: 3.0,
};

export const UNIT_LOD_THRESHOLDS: LodThresholds = {
  lod1M: 24,
  lod2M: 58,
  hysteresisM: 2.0,
};

export const PROP_LOD_THRESHOLDS: LodThresholds = {
  lod1M: 18,
  lod2M: 46,
  hysteresisM: 2.0,
};

/**
 * Selects the active LOD level (0..3) given Euclidean camera distance `distM` and the previous level.
 * Upgrading back to finer detail requires moving `hysteresisM` closer than the step-down boundary.
 */
export function selectLodLevel(distM: number, prev: LodLevel, t: LodThresholds): LodLevel {
  const h = t.hysteresisM ?? 2.5;
  const imp = t.impostorM;

  // Step down (coarser) at nominal thresholds; step up (finer) only inside threshold - hysteresis.
  if (imp !== undefined) {
    if (prev === 3) {
      if (distM >= imp - h) return 3;
    } else if (distM >= imp) {
      return 3;
    }
  }

  if (prev >= 2) {
    if (distM >= t.lod2M - h) return 2;
  } else if (distM >= t.lod2M) {
    return 2;
  }

  if (prev >= 1) {
    if (distM >= t.lod1M - h) return 1;
  } else if (distM >= t.lod1M) {
    return 1;
  }

  return 0;
}
