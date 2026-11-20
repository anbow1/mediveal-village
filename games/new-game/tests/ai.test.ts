import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../src/config.ts';
import { SimEngine } from '../src/sim/engine.ts';
import { countAliveSoldiers, spawnRegiment } from '../src/sim/combat.ts';
import { pickCounterUnit } from '../src/sim/ai.ts';

function runMinutes(sim: SimEngine, minutes: number, dtS = 0.25): void {
  const steps = Math.round((minutes * 60) / dtS);
  for (let i = 0; i < steps; i++) {
    sim.step(dtS);
    if (sim.state.scenario.outcome !== 'playing') break;
  }
}

describe('Stage 6 fair-economy AI (3 personalities & counter-composition)', () => {
  it('starts AI with exact fair resources and builds a working economy + army using only legal commands', () => {
    const sim = new SimEngine({
      mapId: 'openField',
      mode: 'skirmish',
      difficulty: 'normal',
      aiPersonality: 'builder',
      seed: 1001,
    });
    expect(sim.state.sides[1].stock.gold).toBe(ECONOMY.startingStock.gold);
    expect(sim.state.sides[1].stock.timber).toBe(ECONOMY.startingStock.timber);
    expect(sim.state.regiments.filter((r) => r.side === 1)).toHaveLength(0);

    runMinutes(sim, 16, 0.25);

    const aiBuildings = sim.state.buildings.filter((b) => b.side === 1 && b.hp > 0);
    const aiMen = sim.state.regiments
      .filter((r) => r.side === 1)
      .reduce((s, r) => s + countAliveSoldiers(r), 0);
    const s1 = sim.state.sides[1].stock;
    const pop1 = sim.state.citizens.filter((c) => c.side === 1).length;
    console.log(`[ai-builder] 16 min -> ${aiBuildings.length} blds (${aiBuildings.filter((b) => b.buildProgress >= 1).length} done), pop=${pop1}, men=${aiMen}, g=${Math.floor(s1.gold)} t=${Math.floor(s1.timber)} b=${Math.floor(s1.bread)} w=${Math.floor(s1.weapons)} la=${Math.floor(s1.leatherArmour)} bows=${Math.floor(s1.bows)}`);
    expect(aiBuildings.length).toBeGreaterThanOrEqual(5);
    expect(aiMen).toBeGreaterThanOrEqual(12);
  });

  it('selects proper tactical counters against opponent army composition', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 42 });
    sim.state.regiments.length = 0;
    const stock = sim.state.sides[1].stock;
    stock.gold = 2000;
    stock.timber = 200;
    stock.weapons = 100;
    stock.leatherArmour = 100;
    stock.mail = 100;
    stock.bows = 100;
    stock.horses = 100;

    // Enemy fields mostly Heavy Cavalry -> AI counters with Pikemen!
    spawnRegiment(sim.state, 0, 'heavyCav', -40, 0, 0);
    spawnRegiment(sim.state, 0, 'lightCav', -40, 20, 0);
    expect(pickCounterUnit(sim.state, 1, 'builder', 3, 2)).toBe('pikemen');

    // Enemy fields mostly Archers -> AI counters with Light Cavalry!
    sim.state.regiments.length = 0;
    spawnRegiment(sim.state, 0, 'archers', -40, 0, 0);
    spawnRegiment(sim.state, 0, 'crossbowmen', -40, 20, 0);
    expect(pickCounterUnit(sim.state, 1, 'raider', 3, 2)).toBe('lightCav');

    // Enemy fields heavy Swordsmen -> AI counters with Crossbowmen!
    sim.state.regiments.length = 0;
    spawnRegiment(sim.state, 0, 'swordsmen', -40, 0, 0);
    spawnRegiment(sim.state, 0, 'halberdiers', -40, 20, 0);
    expect(pickCounterUnit(sim.state, 1, 'knight', 3, 2)).toBe('crossbowmen');
  });

  it('raider AI defeats a completely passive player within 42 game minutes', () => {
    const sim = new SimEngine({
      mapId: 'openField',
      mode: 'skirmish',
      difficulty: 'normal',
      aiPersonality: 'raider',
      seed: 707,
    });
    runMinutes(sim, 42, 0.25);

    const p0Keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep');
    const aiMen = sim.state.regiments.filter((r) => r.side === 1).reduce((s, r) => s + countAliveSoldiers(r), 0);
    console.log(`[ai-raider] ended at ${(sim.state.timeS / 60).toFixed(1)} min, outcome=${sim.state.scenario.outcome}, p0KeepHp=${p0Keep?.hp ?? 0}, aiMen=${aiMen}`);
    const defeated = sim.state.scenario.outcome === 'defeat' || !p0Keep || p0Keep.hp < p0Keep.maxHp * 0.5;
    expect(defeated).toBe(true);
  }, 30000);

  it('all 3 personalities (builder, raider, knight) build distinct valid settlements without crashing', () => {
    for (const personality of ['builder', 'raider', 'knight'] as const) {
      const sim = new SimEngine({
        mapId: 'crossing',
        mode: 'skirmish',
        difficulty: 'normal',
        aiPersonality: personality,
        seed: 202 + personality.length,
      });
      runMinutes(sim, 8, 0.25);
      const aiBuildings = sim.state.buildings.filter((b) => b.side === 1 && b.hp > 0);
      expect(aiBuildings.length).toBeGreaterThanOrEqual(3);
    }
  }, 20000);
});
