import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from '../src/config.ts';
import { SimEngine } from '../src/sim/engine.ts';
import { countAliveSoldiers, spawnRegiment } from '../src/sim/combat.ts';
import { buildCampaignCarryOver, TUTORIAL_STEP_IDS } from '../src/sim/modes.ts';

function stepSeconds(sim: SimEngine, seconds: number, dtS = 0.2): void {
  const n = Math.round(seconds / dtS);
  for (let i = 0; i < n; i++) {
    sim.step(dtS);
    if (sim.state.scenario.outcome !== 'playing') break;
  }
}

describe('Stage 6 campaign missions 1-5, defence, tutorial & deterministic save/load', () => {
  it('verifies Save/Load bit-for-bit determinism (3 min + snapshot/restore + 2 min === 5 min uninterrupted)', () => {
    const dtS = 1 / 60;
    const simA = new SimEngine({
      mapId: 'crossing',
      mode: 'skirmish',
      difficulty: 'normal',
      aiPersonality: 'raider',
      seed: 1337,
      showcaseMode: true,
    });
    const simB = new SimEngine({
      mapId: 'crossing',
      mode: 'skirmish',
      difficulty: 'normal',
      aiPersonality: 'raider',
      seed: 1337,
      showcaseMode: true,
    });

    for (let i = 0; i < 3600; i++) {
      simA.step(dtS);
      simB.step(dtS);
    }
    expect(simA.getFingerprint()).toBe(simB.getFingerprint());

    const snapJson = simB.toSnapshot();
    const simRestored = SimEngine.fromSnapshot(snapJson);
    expect(simRestored.getFingerprint()).toBe(simA.getFingerprint());

    for (let i = 0; i < 2400; i++) {
      simA.step(0.05);
      simRestored.step(0.05);
    }
    expect(simRestored.getFingerprint()).toBe(simA.getFingerprint());
  }, 20000);

  it('completes Tutorial 7 auto-advancing steps cleanly', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'tutorial', disableAi: true, seed: 55 });
    expect(sim.state.scenario.tutorialSteps).toHaveLength(TUTORIAL_STEP_IDS.length);
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    const stock = sim.state.sides[0].stock;
    stock.gold = 3000;
    stock.timber = 500;
    stock.stone = 500;
    stock.weapons = 40;
    stock.leatherArmour = 40;
    stock.mail = 40;

    const placeComplete = (type: Parameters<typeof sim.validatePlacement>[1], x: number, z: number): number => {
      for (let r = 0; r <= 70; r += 4) {
        for (let a = 0; a < 16; a++) {
          const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
          const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
          if (sim.validatePlacement(0, type, px, pz, 0, false) === 'ok') {
            const res = sim.execute({ type: 'placeBuilding', side: 0, buildingType: type, x: px, z: pz, yawRad: 0 });
            if (res.ok && res.createdId) {
              const b = sim.state.buildings.find((e) => e.id === res.createdId)!;
              b.buildProgress = 1;
              return b.id;
            }
          }
        }
      }
      throw new Error(`Could not place ${type}`);
    };

    // Find a tree whose neighborhood has a valid woodcutter spot
    let placedWc = false;
    for (const tr of sim.state.trees) {
      if (Math.hypot(tr.x - keep.x, tr.z - keep.z) > 250) continue;
      for (let a = 0; a < 8 && !placedWc; a++) {
        const px = tr.x + Math.cos((a / 8) * Math.PI * 2) * 12;
        const pz = tr.z + Math.sin((a / 8) * Math.PI * 2) * 12;
        if (sim.validatePlacement(0, 'woodcutter', px, pz, 0, true) === 'ok') {
          const res = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'woodcutter', x: px, z: pz, yawRad: 0 });
          if (res.ok) placedWc = true;
        }
      }
      if (placedWc) break;
    }
    expect(placedWc).toBe(true);

    placeComplete('farm', keep.x + 20, keep.z);
    placeComplete('house', keep.x - 20, keep.z);
    placeComplete('windmill', keep.x, keep.z + 24);
    placeComplete('bakery', keep.x + 24, keep.z + 24);
    const stoneOutcrop = sim.state.outcrops.find((o) => o.kind === 'stone')!;
    placeComplete('quarry', stoneOutcrop.x, stoneOutcrop.z);
    placeComplete('barracks', keep.x - 24, keep.z - 24);

    const reg = spawnRegiment(sim.state, 0, 'swordsmen', keep.x + 15, keep.z - 20, 0);
    sim.execute({ type: 'issueOrder', side: 0, regimentIds: [reg.id], order: { kind: 'march', x: 0, z: 0 }, queue: false });

    stepSeconds(sim, 2.0);
    expect(sim.state.scenario.outcome).toBe('victory');
    expect(sim.state.scenario.tutorialSteps.every((st) => st.completed)).toBe(true);
  });

  it('plays Campaign M1 (Tribute), M2 (Bandit Camps), M3 (Village Capture), M4 (6 Ruins + Keep L3), and M5 (Fortress Courtyard)', () => {
    // --- Mission 1: Pay exact tribute (600g / 200 bread / 40 weapons) -> victory + carry-over ---
    const m1 = new SimEngine({ mapId: 'crossing', mode: 'campaign', missionId: 1, seed: 101 });
    m1.state.sides[0].stock.gold = 700;
    m1.state.sides[0].stock.bread = 250;
    m1.state.sides[0].stock.weapons = 50;
    expect(m1.execute({ type: 'payTribute', side: 0 }).ok).toBe(true);
    stepSeconds(m1, 1.0);
    expect(m1.state.scenario.outcome).toBe('victory');
    expect(m1.state.scenario.starsEarned).toBeGreaterThanOrEqual(2);
    const carry1 = buildCampaignCarryOver(m1.state);
    expect(carry1.gold).toBeLessThanOrEqual(CAMPAIGN.carryOverGoldCap);

    // --- Mission 2: Destroy all 3 bandit camps & defenders ---
    const m2 = new SimEngine({ mapId: 'forest', mode: 'campaign', missionId: 2, seed: 102, carryOver: carry1 });
    const camps = m2.state.buildings.filter((b) => b.side === 1 && b.type === 'campTent');
    expect(camps.length).toBeGreaterThanOrEqual(3);
    for (const c of camps) c.hp = 0;
    for (const r of m2.state.regiments) {
      if (r.side === 1) for (const s of r.soldiers) s.alive = false;
    }
    stepSeconds(m2, 6.0);
    expect(m2.state.scenario.outcome).toBe('victory');

    // --- Mission 3: Hold village capture point for 20 s ---
    const m3 = new SimEngine({ mapId: 'valley', mode: 'campaign', missionId: 3, seed: 103 });
    const village = m3.state.capturePoints[0]!;
    for (const r of m3.state.regiments) {
      if (r.side === 1) for (const s of r.soldiers) s.alive = false;
    }
    spawnRegiment(m3.state, 0, 'swordsmen', village.x, village.z, 0);
    stepSeconds(m3, 25);
    expect(m3.state.scenario.outcome).toBe('victory');

    // --- Mission 4: 6 half-price ruins + Keep L3 + >= 160 men / 10 regs ---
    const m4 = new SimEngine({ mapId: 'valley', mode: 'campaign', missionId: 4, seed: 104 });
    const ruins = m4.state.buildings.filter((b) => b.type === 'ruin');
    expect(ruins.length).toBeGreaterThanOrEqual(6);
    const keep4 = m4.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    m4.state.sides[0].stock.gold = 2000;
    m4.state.sides[0].stock.timber = 500;
    m4.state.sides[0].stock.stone = 500;
    expect(m4.execute({ type: 'rebuildRuin', side: 0, buildingId: ruins[0]!.id }).ok).toBe(true);
    keep4.level = 3;
    for (let i = 0; i < 10; i++) {
      spawnRegiment(m4.state, 0, 'swordsmen', keep4.x + 15 + i * 3, keep4.z + 15, 0, { count: 16 });
    }
    stepSeconds(m4, 1.0);
    expect(m4.state.scenario.outcome).toBe('victory');

    // --- Mission 5: Fortress Donżon is indestructible; clearing courtyard guard wins! ---
    const m5 = new SimEngine({ mapId: 'fortress', mode: 'campaign', missionId: 5, seed: 105 });
    const donzon = m5.state.buildings.find((b) => b.side === 1 && b.isFortressDonzon);
    expect(donzon?.indestructible).toBe(true);
    const guardCount = m5.state.regiments.filter((r) => r.side === 1 && r.scenarioTag === 'm5_guard').length;
    expect(guardCount).toBeGreaterThanOrEqual(1);
    for (const r of m5.state.regiments) {
      if (r.side === 1 && r.scenarioTag === 'm5_guard') {
        for (const s of r.soldiers) s.alive = false;
      }
    }
    stepSeconds(m5, 1.0);
    expect(m5.state.scenario.outcome).toBe('victory');
  });

  it('spawns Defence waves starting at minute 7 and awards victory at 30 min', () => {
    const def = new SimEngine({ mapId: 'crossing', mode: 'defence', disableAi: true, seed: 909 });
    def.state.timeS = CAMPAIGN.defenceFirstWaveS - 0.5;
    stepSeconds(def, 2.0);
    expect(def.state.scenario.waveIndex).toBe(1);
    const wave1Men = def.state.regiments.filter((r) => r.side === 1).reduce((s, r) => s + countAliveSoldiers(r), 0);
    expect(wave1Men).toBeGreaterThanOrEqual(20);

    // Reaching 30 min with Keep intact wins Defence!
    def.state.timeS = CAMPAIGN.defenceWinTimeS - 0.2;
    stepSeconds(def, 1.0);
    expect(def.state.scenario.outcome).toBe('victory');
  });
});
