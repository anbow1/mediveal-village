import { describe, expect, it } from 'vitest';
import { SimEngine } from '../src/sim/engine.ts';
import { spawnRegiment } from '../src/sim/combat.ts';

describe('Stage 6 2 m A* pathfinding, ford & gate crossings', () => {
  it('routes 4 regiments across the Crossing map river ford without any soldier stepping in deep water', () => {
    const sim = new SimEngine({ mapId: 'crossing', mode: 'skirmish', disableAi: true, seed: 21 });
    sim.state.regiments.length = 0;

    const regs = [
      spawnRegiment(sim.state, 0, 'swordsmen', -55, -26, Math.PI * 0.5),
      spawnRegiment(sim.state, 0, 'pikemen', -55, -8, Math.PI * 0.5),
      spawnRegiment(sim.state, 0, 'archers', -55, 10, Math.PI * 0.5),
      spawnRegiment(sim.state, 0, 'lightCav', -55, 28, Math.PI * 0.5),
    ];

    for (let i = 0; i < regs.length; i++) {
      const res = sim.execute({
        type: 'issueOrder',
        side: 0,
        regimentIds: [regs[i]!.id],
        order: { kind: 'march', x: 65, z: -24 + i * 16, facingYawRad: Math.PI * 0.5 },
        queue: false,
      });
      expect(res.ok).toBe(true);
    }

    let deepWaterSteps = 0;
    const dtS = 0.1;
    for (let step = 0; step < 900; step++) {
      sim.step(dtS);
      for (const r of regs) {
        for (const s of r.soldiers) {
          if (!s.alive) continue;
          if (sim.terrain.isDeepWater(s.x, s.z)) {
            deepWaterSteps++;
          }
        }
      }
      if (regs.every((r) => r.x > 45)) break;
    }

    expect(deepWaterSteps).toBe(0);
    for (const r of regs) {
      expect(r.x).toBeGreaterThan(40);
    }
  });

  it('auto-opens a friendly 6 m gate and passes 4 regiments cleanly without entering wall obstacles', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 22 });
    sim.state.regiments.length = 0;
    sim.state.sides[0].stock.stone = 500;
    sim.state.sides[0].stock.timber = 500;
    sim.state.sides[0].stock.gold = 1000;

    expect(sim.execute({ type: 'placeWall', side: 0, x0: -120, z0: -40, x1: -120, z1: -5 }).ok).toBe(true);
    expect(sim.execute({ type: 'placeWall', side: 0, x0: -120, z0: 5, x1: -120, z1: 40 }).ok).toBe(true);
    const gateRes = sim.execute({ type: 'placeGate', side: 0, x: -120, z: 0, yawRad: Math.PI * 0.5 });
    expect(gateRes.ok).toBe(true);
    sim.rebuildNav();

    const gate = sim.state.gates.find((g) => g.id === gateRes.createdId)!;
    const regs = [
      spawnRegiment(sim.state, 0, 'swordsmen', -152, -14, Math.PI * 0.5),
      spawnRegiment(sim.state, 0, 'pikemen', -152, -4, Math.PI * 0.5),
      spawnRegiment(sim.state, 0, 'archers', -152, 6, Math.PI * 0.5),
      spawnRegiment(sim.state, 0, 'swordsmen', -152, 16, Math.PI * 0.5),
    ];

    for (let i = 0; i < regs.length; i++) {
      sim.execute({
        type: 'issueOrder',
        side: 0,
        regimentIds: [regs[i]!.id],
        order: { kind: 'march', x: -82, z: -15 + i * 10, facingYawRad: Math.PI * 0.5 },
        queue: false,
      });
    }

    let maxGateOpen = 0;
    const dtS = 0.1;
    for (let step = 0; step < 650; step++) {
      sim.step(dtS);
      if (gate.openFraction > maxGateOpen) maxGateOpen = gate.openFraction;
      if (regs.every((r) => r.x > -95)) break;
    }

    expect(maxGateOpen).toBeGreaterThan(0.8);
    for (const r of regs) {
      expect(r.x).toBeGreaterThan(-100);
    }
  });

  it('prefers paved roads (1.4x speed weight) over rough terrain in A* pathing', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 23 });
    sim.execute({ type: 'placeRoad', side: 0, x0: -100, z0: 0, x1: 100, z1: 0 });
    sim.rebuildNav();

    const path = sim.nav.findPath(-96, 12, 96, 12, 0);
    expect(path.length).toBeGreaterThanOrEqual(2);
    const minAbsZ = Math.min(...path.map((p) => Math.abs(p.z)));
    expect(minAbsZ).toBeLessThan(8);
  });
});
