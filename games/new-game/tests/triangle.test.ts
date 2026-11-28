import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config.ts';
import { pickFoe } from '../src/sim/ai.ts';
import { spawnRegiment } from '../src/sim/combat.ts';
import { findKeep } from '../src/sim/economy.ts';
import { SimEngine } from '../src/sim/engine.ts';
import { buildMapLayout } from '../src/sim/maps.ts';
import { TerrainField } from '../src/sim/terrain.ts';

function stepSeconds(sim: SimEngine, seconds: number): void {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) sim.step(1 / 60);
}

describe('Three Lords (triangle) 860x860 m map & 3-way Skirmish rules', () => {
  it('builds a symmetric 860x860 m map with 3 equidistant Keeps on a 320 m circle, 9 outcrops, and 3 capture points', () => {
    const layout = buildMapLayout('triangle');
    const terrain = new TerrainField(layout.terrainConfig);

    expect(layout.sideCount).toBe(3);
    expect(terrain.config.sizeM).toBe(WORLD.triangleSizeM);
    expect(terrain.halfSizeM).toBe(WORLD.triangleHalfSizeM);
    expect(layout.thirdKeepXZ).toBeDefined();

    const keeps = [layout.playerKeepXZ, layout.enemyCenterXZ, layout.thirdKeepXZ!] as const;
    for (const [kx, kz] of keeps) {
      expect(Math.hypot(kx, kz)).toBeCloseTo(WORLD.triangleRadiusM, 0);
      expect(terrain.heightAt(kx, kz)).toBeGreaterThan(0.5);
      expect(terrain.isWater(kx, kz)).toBe(false);
    }

    // Pairwise keep distance on an equilateral triangle of radius 320 m is 320 * sqrt(3) ~= 554.3 m
    const d01 = Math.hypot(keeps[0][0] - keeps[1][0], keeps[0][1] - keeps[1][1]);
    const d12 = Math.hypot(keeps[1][0] - keeps[2][0], keeps[1][1] - keeps[2][1]);
    const d20 = Math.hypot(keeps[2][0] - keeps[0][0], keeps[2][1] - keeps[0][1]);
    expect(d01).toBeCloseTo(554.3, 0);
    expect(d12).toBeCloseTo(554.3, 0);
    expect(d20).toBeCloseTo(554.3, 0);

    // 9 outcrops total (3 per town: 2 stone + 1 iron ore)
    expect(layout.outcrops.length).toBe(9);
    expect(layout.capturePoints.length).toBe(3);
  });

  it('spawns 3 living factions on triangle Skirmish and knocks out a fallen AI town without ending the match early', () => {
    const sim = new SimEngine({ mapId: 'triangle', mode: 'skirmish', showcaseMode: false, disableAi: true });
    expect(sim.state.sideCount).toBe(3);
    expect(sim.state.sides[0].absent).toBeFalsy();
    expect(sim.state.sides[1].absent).toBeFalsy();
    expect(sim.state.sides[2].absent).toBeFalsy();

    const k0 = findKeep(sim.state, 0)!;
    const k1 = findKeep(sim.state, 1)!;
    const k2 = findKeep(sim.state, 2)!;
    expect(k0 && k1 && k2).toBeTruthy();

    // Give Side 1 a regiment and a house, then destroy Side 1's Keep
    spawnRegiment(sim.state, 1, 'swordsmen', k1.x + 15, k1.z, 0);
    const hRes = sim.execute({ type: 'placeBuilding', side: 1, buildingType: 'house', x: k1.x - 18, z: k1.z, yawRad: 0 });
    expect(hRes.ok).toBe(true);
    const s1House = sim.state.buildings.find((b) => b.id === hRes.createdId)!;
    s1House.buildProgress = 1;

    k1.hp = 0;
    stepSeconds(sim, 0.25);

    // Side 1 is knocked out (absent, zero regiments/citizens, house ruined, townFell alert), match STILL playing!
    expect(sim.state.sides[1].absent).toBe(true);
    expect(sim.state.regiments.some((r) => r.side === 1)).toBe(false);
    expect(sim.state.citizens.some((c) => c.side === 1)).toBe(false);
    expect(s1House.type).toBe('ruin');
    expect(sim.state.alerts.some((a) => a.kind === 'townFell')).toBe(true);
    expect(sim.state.scenario.outcome).toBe('playing');

    // Destroy Side 2's Keep -> all foes fallen -> Victory!
    k2.hp = 0;
    stepSeconds(sim, 0.25);
    expect(sim.state.sides[2].absent).toBe(true);
    expect(sim.state.scenario.outcome).toBe('victory');
    expect(sim.state.scenario.outcomeReason).toBe('enemyKeepDestroyed');
  });

  it('pickFoe prioritizes threats near home, prefers weaker rivals, and spreads pressure via sharedFoeMen', () => {
    const sim = new SimEngine({ mapId: 'triangle', mode: 'skirmish', showcaseMode: false, disableAi: true });
    const k0 = findKeep(sim.state, 0)!;
    const k1 = findKeep(sim.state, 1)!;
    const k2 = findKeep(sim.state, 2)!;

    // Give Side 0 a huge army (60 men), Side 2 a tiny army (16 men) -> Side 1 picks weaker Side 2
    spawnRegiment(sim.state, 0, 'swordsmen', k0.x, k0.z, 0);
    spawnRegiment(sim.state, 0, 'pikemen', k0.x + 10, k0.z, 0);
    spawnRegiment(sim.state, 0, 'archers', k0.x - 10, k0.z, 0);
    spawnRegiment(sim.state, 2, 'militia', k2.x, k2.z, 0);
    expect(pickFoe(sim.state, 1)).toBe(2);

    // If Side 0 marches right up to Side 1's Keep (< 110 m), Side 1 switches target to the immediate threat (Side 0)!
    spawnRegiment(sim.state, 0, 'heavyCav', k1.x + 30, k1.z, 0);
    expect(pickFoe(sim.state, 1)).toBe(0);

    // Clear threat; if armies are equal and Side 2 is already attacking Side 0, Side 1 prefers Side 2 (sharedFoeMen penalty)
    sim.state.regiments = [];
    spawnRegiment(sim.state, 0, 'swordsmen', k0.x, k0.z, 0);
    spawnRegiment(sim.state, 2, 'swordsmen', k2.x, k2.z, 0);
    sim.state.sides[2].aiTargetSide = 0;
    sim.state.sides[2].aiAttacking = true;
    expect(pickFoe(sim.state, 1)).toBe(2);
  });

  it('runs 3-lord AI skirmish deterministically and preserves bit-identical fingerprint across snapshot round-trip', () => {
    const sim = new SimEngine({ mapId: 'triangle', mode: 'skirmish', seed: 77, showcaseMode: false, startAge: 2 });
    sim.aiControlsSide0 = true;
    stepSeconds(sim, 30);

    // Every living side should have constructed/started buildings or maintained healthy stock
    expect(sim.state.buildings.filter((b) => b.side === 1 && b.hp > 0).length).toBeGreaterThanOrEqual(2);
    expect(sim.state.buildings.filter((b) => b.side === 2 && b.hp > 0).length).toBeGreaterThanOrEqual(2);

    const snap = sim.toSnapshot();
    const restored = SimEngine.fromSnapshot(snap);
    restored.aiControlsSide0 = true;
    stepSeconds(sim, 10);
    stepSeconds(restored, 10);
    expect(restored.getFingerprint()).toBe(sim.getFingerprint());
  }, 15_000);

  it('keeps 3xAI Three Lords skirmish numerically clean and within performance budget over an extended match', () => {
    const sim = new SimEngine({ mapId: 'triangle', mode: 'skirmish', seed: 303, showcaseMode: false, startAge: 2, fastAges: true });
    sim.aiControlsSide0 = true;
    const t0 = performance.now();
    // Simulate 15 minutes (900 s) at 0.25 s macro steps (3600 steps) across all 3 AI towns
    const steps = 3600;
    for (let i = 0; i < steps; i++) {
      sim.step(0.25);
      if (sim.state.scenario.outcome !== 'playing') break;
    }
    const elapsedMs = performance.now() - t0;
    const avgMs = elapsedMs / steps;

    expect(avgMs).toBeLessThan(4.0);
    for (const r of sim.state.regiments) {
      expect(Number.isFinite(r.x)).toBe(true);
      expect(Number.isFinite(r.z)).toBe(true);
      expect(Number.isFinite(r.morale)).toBe(true);
    }
    for (const c of sim.state.citizens) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.z)).toBe(true);
    }
    // At least one side should have expanded beyond starting Keep+Barracks
    const maxBuildings = Math.max(
      ...[0, 1, 2].map((s) => sim.state.buildings.filter((b) => b.side === s && b.hp > 0).length),
    );
    expect(maxBuildings).toBeGreaterThanOrEqual(4);
  }, 20_000);
});
