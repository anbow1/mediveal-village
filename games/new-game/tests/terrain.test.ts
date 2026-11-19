import { describe, expect, it } from 'vitest';
import { BENCH_SPOTS, findBenchSpot } from '../src/app/bench.ts';
import { GroundWorksMap } from '../src/sim/groundWorks.ts';
import { STAGE4_TERRAIN_CONFIG, TerrainField } from '../src/sim/terrain.ts';

describe('Stage 4 TerrainField and GroundWorksMap (pure TS)', () => {
  const terrain = new TerrainField(STAGE4_TERRAIN_CONFIG);

  it('produces a deterministic level town terrace, wooded NW knoll, and enclosed dry-bank lake basin', () => {
    // Village terrace around (-4, -2) stays level and dry for buildings
    const townH = terrain.heightAt(-4, -2);
    expect(townH).toBeGreaterThan(0.9);
    expect(townH).toBeLessThan(1.6);
    expect(terrain.slopeAt(-4, -2)).toBeLessThan(0.02);

    // NW wooded knoll rises cleanly above the village green
    const knollH = terrain.heightAt(-32, -30);
    expect(knollH).toBeGreaterThan(4.5);
    expect(terrain.isWater(-32, -30)).toBe(false);

    // Enclosed village lake bowl is deeply submerged at center and surrounded by dry banks on every angle
    const lk = terrain.config.lake;
    const centerH = terrain.heightAt(lk.centerX, lk.centerZ);
    expect(centerH).toBeLessThan(-1.0);
    expect(terrain.waterDepthAt(lk.centerX, lk.centerZ)).toBeGreaterThan(1.0);
    expect(terrain.isWater(lk.centerX, lk.centerZ)).toBe(true);

    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const bx = lk.centerX + Math.cos(a) * lk.radiusXM * 1.25;
      const bz = lk.centerZ + Math.sin(a) * lk.radiusZM * 1.25;
      expect(terrain.heightAt(bx, bz)).toBeGreaterThan(lk.waterLevelM + 0.2);
      expect(terrain.isWater(bx, bz)).toBe(false);
    }
  });

  it('matches baked R32F height grid exactly at vertices and smoothly across PlaneGeometry triangles', () => {
    const grid = terrain.bakeHeightGrid();
    expect(grid.length).toBe(terrain.config.gridResolution * terrain.config.gridResolution);

    // Exact match on 2.0 m grid vertices (even integer coordinates over [-280..+280])
    for (const [x, z] of [
      [0, 0],
      [-32, -30],
      [26, 22],
      [14, -10],
      [-38, 36],
    ] as const) {
      expect(terrain.sampleGridHeight(grid, x, z)).toBeCloseTo(terrain.heightAt(x, z), 3);
    }

    // Sub-cell triangle interpolation agrees closely with analytic height on steep knoll slope
    for (const [x, z] of [
      [-25.3, -24.7],
      [-24.7, -25.3],
      [19.4, 17.8],
      [18.8, 18.6],
    ] as const) {
      const analytic = terrain.heightAt(x, z);
      const tri = terrain.sampleGridHeight(grid, x, z);
      expect(Math.abs(analytic - tri)).toBeLessThan(0.08);
    }
  });

  it('stamps and samples yards, cobbled roads, farm strips, and tree canopy litter accurately', () => {
    const gw = new GroundWorksMap(128, 120);
    gw.stampYard(0, 0, 6, 6, 0.9);
    gw.stampRoadPolyline(
      [
        [-20, 10],
        [20, 10],
      ],
      1.6,
      1.4,
    );
    gw.stampFarmStrip(-20, -20, 8, 6, 0);
    gw.stampTreeCanopy(20, -20, 5, 0.7);

    expect(gw.sample(0, 0).dirt).toBeGreaterThan(0.8);
    expect(gw.sample(0, 10).cobble).toBeGreaterThan(0.85);
    expect(gw.sample(0, 12.2).dirt).toBeGreaterThan(0.2);
    expect(gw.sample(-20, -20).farm).toBeGreaterThan(0.85);
    expect(gw.sample(20, -20).canopy).toBeGreaterThan(0.55);
    // Clean untouched meadow outside stamps reads 0 across all 4 channels
    const clean = gw.sample(45, 45);
    expect(clean.dirt + clean.cobble + clean.farm + clean.canopy).toBe(0);
  });

  it('keeps ground_045m and eye_170m fixed views strictly +0.45 m and +1.70 m above local terrain', () => {
    expect(BENCH_SPOTS.length).toBe(12);
    const g045 = findBenchSpot('ground_045m').camera;
    const e170 = findBenchSpot('eye_170m').camera;
    expect(g045.mode).toBe('free');
    expect(e170.mode).toBe('free');
    if (g045.mode === 'free') {
      expect(g045.pose.y - terrain.heightAt(g045.pose.x, g045.pose.z)).toBeCloseTo(0.45, 4);
    }
    if (e170.mode === 'free') {
      expect(e170.pose.y - terrain.heightAt(e170.pose.x, e170.pose.z)).toBeCloseTo(1.7, 4);
    }
  });
});
