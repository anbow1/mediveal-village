import { describe, expect, it } from 'vitest';
import {
  BUILDING_LOD_THRESHOLDS,
  PROP_LOD_THRESHOLDS,
  selectLodLevel,
  TREE_LOD_THRESHOLDS,
  UNIT_LOD_THRESHOLDS,
} from '../src/sim/lodMath.ts';

describe('selectLodLevel', () => {
  it('selects LOD0, LOD1, LOD2, and >100 m impostor cleanly for buildings and trees', () => {
    expect(selectLodLevel(10, 0, BUILDING_LOD_THRESHOLDS)).toBe(0);
    expect(selectLodLevel(40, 0, BUILDING_LOD_THRESHOLDS)).toBe(1);
    expect(selectLodLevel(80, 1, BUILDING_LOD_THRESHOLDS)).toBe(2);
    expect(selectLodLevel(112, 2, BUILDING_LOD_THRESHOLDS)).toBe(3);

    expect(selectLodLevel(10, 0, TREE_LOD_THRESHOLDS)).toBe(0);
    expect(selectLodLevel(110, 0, TREE_LOD_THRESHOLDS)).toBe(3);
  });

  it('applies hysteresis when stepping back closer so LODs do not pop', () => {
    // At 32 m building steps down 0 -> 1. Moving back to 30.5 m (inside 3 m hysteresis) stays at LOD1.
    expect(selectLodLevel(32.1, 0, BUILDING_LOD_THRESHOLDS)).toBe(1);
    expect(selectLodLevel(30.5, 1, BUILDING_LOD_THRESHOLDS)).toBe(1);
    // Crossing below 32 - 3 = 29 m returns cleanly to LOD0.
    expect(selectLodLevel(28.5, 1, BUILDING_LOD_THRESHOLDS)).toBe(0);

    // Same for impostor boundary at 105 m (hysteresis 3 m -> return to LOD2 below 102 m).
    expect(selectLodLevel(106, 2, BUILDING_LOD_THRESHOLDS)).toBe(3);
    expect(selectLodLevel(103.5, 3, BUILDING_LOD_THRESHOLDS)).toBe(3);
    expect(selectLodLevel(101.0, 3, BUILDING_LOD_THRESHOLDS)).toBe(2);
  });

  it('caps units and props without impostor at LOD2', () => {
    expect(selectLodLevel(200, 0, UNIT_LOD_THRESHOLDS)).toBe(2);
    expect(selectLodLevel(120, 0, PROP_LOD_THRESHOLDS)).toBe(2);
  });
});
