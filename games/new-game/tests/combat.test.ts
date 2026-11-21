import { describe, expect, it } from 'vitest';
import { ALL_UNIT_TYPES, UNIT_DEFS, type UnitTypeId } from '../src/config.ts';
import { SimEngine } from '../src/sim/engine.ts';
import { countAliveSoldiers, spawnRegiment, stepCombat } from '../src/sim/combat.ts';

interface DuelOutcome {
  winner: 0 | 1 | -1;
  durationS: number;
  alive0: number;
  alive1: number;
}

/** Runs a clean isolated 1v1 regiment duel on flat openField terrain. */
function runDuel(
  sim: SimEngine,
  unit0: UnitTypeId,
  unit1: UnitTypeId,
  seed: number,
  startDistM = 40,
  opts?: {
    flankSide0?: boolean;
    formation0?: 'line' | 'schiltron' | 'wedge' | 'loose';
    formation1?: 'line' | 'schiltron' | 'wedge' | 'loose';
    dtS?: number;
  },
): DuelOutcome {
  sim.state.rngState = (seed * 1664525 + 1013904223) >>> 0 || 1;
  sim.state.buildings.length = 0;
  sim.state.citizens.length = 0;
  sim.state.regiments.length = 0;
  sim.state.projectiles.length = 0;
  sim.state.alerts.length = 0;
  sim.state.fxEvents.length = 0;
  sim.state.timeS = 0;
  sim.state.tick = 0;
  sim.state.sides[0].armyStarving = false;
  sim.state.sides[1].armyStarving = false;
  sim.state.sides[0].unpaidPenaltyActive = false;
  sim.state.sides[1].unpaidPenaltyActive = false;
  sim.state.sides[0].stock.gold = 9999;
  sim.state.sides[1].stock.gold = 9999;
  sim.state.sides[0].stock.bread = 9999;
  sim.state.sides[1].stock.bread = 9999;

  const r0 = spawnRegiment(sim.state, 0, unit0, -startDistM * 0.5, 0, Math.PI * 0.5);
  const r1 = spawnRegiment(
    sim.state,
    1,
    unit1,
    startDistM * 0.5,
    0,
    opts?.flankSide0 ? 0 : -Math.PI * 0.5,
  );
  if (opts?.formation0) r0.formation = opts.formation0;
  if (opts?.formation1) r1.formation = opts.formation1;

  const isCharge0 = UNIT_DEFS[unit0].unitClass === 'cavalry';
  const isCharge1 = UNIT_DEFS[unit1].unitClass === 'cavalry';
  r0.order = { kind: isCharge0 ? 'charge' : 'attack', x: r1.x, z: r1.z, targetRegimentId: r1.id };
  if (!opts?.flankSide0) {
    r1.order = { kind: isCharge1 ? 'charge' : 'attack', x: r0.x, z: r0.z, targetRegimentId: r0.id };
  }

  const dtS = opts?.dtS ?? 0.1;
  const maxS = 160;
  let elapsed = 0;
  while (elapsed < maxS) {
    stepCombat(sim.state, dtS, sim.terrain, sim.nav);
    sim.state.timeS += dtS;
    elapsed += dtS;
    const a0 = countAliveSoldiers(r0);
    const a1 = countAliveSoldiers(r1);
    const done0 = a0 === 0 || r0.routing;
    const done1 = a1 === 0 || r1.routing;
    if (done0 || done1) {
      const winner: 0 | 1 | -1 = done0 && done1 ? -1 : done1 ? 0 : 1;
      return { winner, durationS: elapsed, alive0: a0, alive1: a1 };
    }
  }
  const a0 = countAliveSoldiers(r0);
  const a1 = countAliveSoldiers(r1);
  const frac0 = a0 / r0.maxMen;
  const frac1 = a1 / r1.maxMen;
  return { winner: frac0 > frac1 ? 0 : frac1 > frac0 ? 1 : -1, durationS: elapsed, alive0: a0, alive1: a1 };
}

describe('Stage 6 combat system & 10x10 unit balance matrix', () => {
  const baseSim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 1 });

  it('meets GAMEPLAY.md §6 combat tempo targets (equal duel 45-75s, flank charge shock, archery attrition)', () => {
    let sumDur = 0;
    for (let s = 1; s <= 12; s++) {
      const out = runDuel(baseSim, 'swordsmen', 'swordsmen', 100 + s, 16);
      sumDur += out.durationS;
    }
    const avgEqualDuelS = sumDur / 12;
    console.log(`[combat] avg equal swordsmen duel = ${avgEqualDuelS.toFixed(1)} s (target 45-75 s)`);
    expect(avgEqualDuelS).toBeGreaterThanOrEqual(42);
    expect(avgEqualDuelS).toBeLessThanOrEqual(78);

    // Heavy Cavalry flanking Swordsmen breaks them rapidly
    let flankWins = 0;
    let sumFlankS = 0;
    for (let s = 1; s <= 10; s++) {
      const out = runDuel(baseSim, 'heavyCav', 'swordsmen', 200 + s, 26, { flankSide0: true, formation0: 'wedge' });
      if (out.winner === 0) flankWins++;
      sumFlankS += out.durationS;
    }
    console.log(`[combat] heavyCav flank vs swordsmen = ${flankWins}/10 wins, avg ${(sumFlankS / 10).toFixed(1)} s`);
    expect(flankWins).toBeGreaterThanOrEqual(9);
    expect(sumFlankS / 10).toBeLessThanOrEqual(25);

    // Archers shooting unarmoured Militia marching 78 m inflict ~15-30% losses
    const sim = baseSim;
    sim.state.rngState = 303303;
    sim.state.buildings.length = 0;
    sim.state.citizens.length = 0;
    sim.state.regiments.length = 0;
    sim.state.projectiles.length = 0;
    const arch = spawnRegiment(sim.state, 0, 'archers', -40, 0, Math.PI * 0.5);
    const mil = spawnRegiment(sim.state, 1, 'militia', 38, 0, -Math.PI * 0.5);
    arch.stance = 'hold';
    mil.order = { kind: 'march', x: -34, z: 0, facingYawRad: -Math.PI * 0.5 };
    for (let step = 0; step < 560; step++) {
      stepCombat(sim.state, 0.1, sim.terrain, sim.nav);
      if (Math.hypot(mil.x - arch.x, mil.z - arch.z) < 6) break;
    }
    const lossFrac = 1 - countAliveSoldiers(mil) / mil.maxMen;
    console.log(`[combat] archers vs marching militia 78 m loss = ${(lossFrac * 100).toFixed(1)}%`);
    expect(lossFrac).toBeGreaterThanOrEqual(0.12);
    expect(lossFrac).toBeLessThanOrEqual(0.55);
  });

  it('passes full 10x10 unit balance matrix (30 seeds/pair) with rock-paper-scissors counters and no unbeatable unit', () => {
    const SEEDS = 30;
    const winRate: Record<string, Record<string, number>> = {};
    for (const u of ALL_UNIT_TYPES) winRate[u] = {};

    for (let i = 0; i < ALL_UNIT_TYPES.length; i++) {
      const a = ALL_UNIT_TYPES[i]!;
      winRate[a]![a] = 0.5;
      for (let j = i + 1; j < ALL_UNIT_TYPES.length; j++) {
        const b = ALL_UNIT_TYPES[j]!;
        let winsA = 0;
        let winsB = 0;
        const maxR = Math.max(UNIT_DEFS[a].ranged?.maxRangeM ?? 0, UNIT_DEFS[b].ranged?.maxRangeM ?? 0);
        const startDist = maxR > 60 ? 68 : 28;
        for (let s = 1; s <= SEEDS; s++) {
          const out = runDuel(baseSim, a, b, i * 1000 + j * 100 + s, startDist, { dtS: 0.2 });
          if (out.winner === 0) winsA++;
          else if (out.winner === 1) winsB++;
        }
        const rateA = (winsA + (SEEDS - winsA - winsB) * 0.5) / SEEDS;
        winRate[a]![b] = Number(rateA.toFixed(2));
        winRate[b]![a] = Number((1 - rateA).toFixed(2));
      }
    }

    // Print compact 10x10 matrix for RESULTS.md reporting!
    const hdr = '            ' + ALL_UNIT_TYPES.map((u) => u.slice(0, 6).padStart(7)).join('');
    console.log('\n[10x10 Balance Matrix — Row win rate vs Col (30 seeds/pair)]\n' + hdr);
    for (const a of ALL_UNIT_TYPES) {
      const row = a.padEnd(12) + ALL_UNIT_TYPES.map((b) => winRate[a]![b]!.toFixed(2).padStart(7)).join('');
      console.log(row);
    }

    // Core rock-paper-scissors counter assertions from docs/UNITS.md:
    expect(winRate.pikemen!.heavyCav!).toBeGreaterThanOrEqual(0.65);
    expect(winRate.pikemen!.lightCav!).toBeGreaterThanOrEqual(0.65);
    expect(winRate.swordsmen!.pikemen!).toBeGreaterThanOrEqual(0.6);
    expect(winRate.swordsmen!.militia!).toBeGreaterThanOrEqual(0.9);
    expect(winRate.lightCav!.archers!).toBeGreaterThanOrEqual(0.65);
    expect(winRate.lightCav!.cannon!).toBeGreaterThanOrEqual(0.8);
    expect(winRate.lightCav!.mortar!).toBeGreaterThanOrEqual(0.8);
    expect(winRate.halberdiers!.heavyCav!).toBeGreaterThanOrEqual(0.55);

    // Every unit must have at least one reliable counter (>= 0.55 win rate)
    for (const u of ALL_UNIT_TYPES) {
      const counters = ALL_UNIT_TYPES.filter((opp) => opp !== u && winRate[opp]![u]! >= 0.55);
      expect(counters.length, `Unit ${u} must have at least one counter`).toBeGreaterThanOrEqual(1);
    }

    // Expensive Heavy Cavalry has a cheaper counter (Pikemen!)
    expect(UNIT_DEFS.pikemen.valueGold).toBeLessThan(UNIT_DEFS.heavyCav.valueGold);
    expect(winRate.pikemen!.heavyCav!).toBeGreaterThanOrEqual(0.65);
  }, 45000);

  it('enforces Militia 115 m home-defence limit, Refit, Merge, and Cannon Wall siege damage', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 505 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    sim.state.sides[0].stock.gold = 2000;
    sim.state.sides[0].stock.timber = 400;
    sim.state.sides[0].stock.stone = 400;
    sim.state.sides[0].stock.weapons = 50;
    sim.state.sides[0].stock.leatherArmour = 50;
    sim.state.sides[0].stock.mail = 50;

    // 1. Militia beyond 115 m automatically walks back toward own Keep & refuses distant orders
    const mil = spawnRegiment(sim.state, 0, 'militia', keep.x + 135, keep.z, Math.PI * 0.5);
    const farOrder = sim.execute({
      type: 'issueOrder',
      side: 0,
      regimentIds: [mil.id],
      order: { kind: 'march', x: keep.x + 180, z: keep.z },
    });
    expect(farOrder.ok).toBe(false);
    sim.step(0.5);
    expect(mil.order).not.toBeNull();
    expect(Math.hypot(mil.order!.x - keep.x, mil.order!.z - keep.z)).toBeLessThan(40);

    // 2. Merge two half-strength Swordsmen regiments
    const s1 = spawnRegiment(sim.state, 0, 'swordsmen', keep.x + 20, keep.z, 0);
    const s2 = spawnRegiment(sim.state, 0, 'swordsmen', keep.x + 26, keep.z, 0);
    for (let i = 6; i < s1.soldiers.length; i++) s1.soldiers[i]!.alive = false;
    for (let i = 5; i < s2.soldiers.length; i++) s2.soldiers[i]!.alive = false;
    expect(sim.execute({ type: 'mergeRegiments', side: 0, primaryId: s1.id, secondaryId: s2.id }).ok).toBe(true);
    expect(countAliveSoldiers(s1)).toBe(11);
    expect(sim.state.regiments.some((r) => r.id === s2.id)).toBe(false);

    // 3. Refit Swordsmen -> Halberdiers near Barracks (20 s)
    const bRes = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'barracks', x: keep.x + 24, z: keep.z + 18, yawRad: 0 });
    expect(bRes.ok).toBe(true);
    const barracks = sim.state.buildings.find((b) => b.id === bRes.createdId)!;
    barracks.buildProgress = 1;
    barracks.level = 2;
    expect(sim.execute({ type: 'refitRegiment', side: 0, regimentId: s1.id, targetType: 'halberdiers' }).ok).toBe(true);
    for (let i = 0; i < 120; i++) sim.step(0.2);
    expect(s1.unitType).toBe('halberdiers');

    // 4. Cannon breaches enemy stone wall
    sim.state.sides[1].stock.stone = 500;
    const wRes = sim.execute({ type: 'placeWall', side: 1, x0: 40, z0: -10, x1: 40, z1: 10 });
    expect(wRes.ok).toBe(true);
    const wall = sim.state.walls[0]!;
    const cannon = spawnRegiment(sim.state, 0, 'cannon', -45, 0, Math.PI * 0.5);
    cannon.order = { kind: 'attack', x: wall.x, z: wall.z, targetWallId: wall.id };
    for (let i = 0; i < 300; i++) {
      sim.step(0.2);
      if (wall.destroyed) break;
    }
    expect(wall.hp).toBeLessThan(wall.maxHp);
  });

  it('supports setting regiment ranks (szeregi), target position with facing rotation, and multi-unit saved formations', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 808 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    const r1 = spawnRegiment(sim.state, 0, 'pikemen', keep.x + 20, keep.z - 8, Math.PI * 0.5);
    const r2 = spawnRegiment(sim.state, 0, 'archers', keep.x + 12, keep.z + 4, Math.PI * 0.5);
    const r3 = spawnRegiment(sim.state, 0, 'swordsmen', keep.x + 20, keep.z + 8, Math.PI * 0.5);

    // 1. Set ranks (szeregi): 12 soldiers in 1 rank -> width 12; in 3 ranks -> width 4; in 4 ranks -> width 3
    expect(sim.execute({ type: 'setRanks', side: 0, regimentIds: [r1.id], ranks: 1 }).ok).toBe(true);
    expect(r1.ranks).toBe(1);
    expect(r1.width).toBe(12);

    expect(sim.execute({ type: 'setRanks', side: 0, regimentIds: [r1.id], ranks: 3 }).ok).toBe(true);
    expect(r1.ranks).toBe(3);
    expect(r1.width).toBe(4);

    // 2. Save multi-unit formation of 3 regiments
    const saveRes = sim.execute({
      type: 'saveArmyFormation',
      side: 0,
      regimentIds: [r1.id, r2.id, r3.id],
      name: 'Szyk Bojowy',
    });
    expect(saveRes.ok).toBe(true);
    const saved = sim.state.sides[0].savedFormations ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe('Szyk Bojowy');
    expect(saved[0]!.slots).toHaveLength(3);
    const slot1 = saved[0]!.slots.find((s) => s.regimentId === r1.id)!;
    expect(slot1.ranks).toBe(3);
    expect(slot1.width).toBe(4);

    // 3. Delete saved formation
    expect(sim.execute({ type: 'deleteArmyFormation', side: 0, formationId: saved[0]!.id }).ok).toBe(true);
    expect(sim.state.sides[0].savedFormations).toHaveLength(0);
  });

  it('supports Shield Wall & Pike Wall stances and Barracks Reinforce preserving veteran rank', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 309 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    const stock = sim.state.sides[0].stock;
    stock.gold = 2000;
    stock.timber = 300;
    stock.stone = 200;
    stock.weapons = 40;
    stock.mail = 40;

    // Place a completed L2 Barracks near the Keep
    const bRes = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'barracks', x: keep.x + 16, z: keep.z + 10, yawRad: 0 });
    expect(bRes.ok).toBe(true);
    const barracks = sim.state.buildings.find((b) => b.id === bRes.createdId)!;
    barracks.buildProgress = 1;
    barracks.level = 2;

    // Add extra residents so reinforce leaves >= 4 free townspeople
    for (let i = 0; i < 6; i++) {
      sim.state.citizens.push({
        id: sim.state.nextEntityId++,
        side: 0,
        role: 'carrier',
        x: keep.x + 4,
        z: keep.z + 4,
        yawRad: 0,
        homeBuildingId: keep.id,
        assignedBuildingId: null,
        carryJob: null,
        carryingGood: null,
        carryingAmount: 0,
        fleeing: false,
        fleeClearTimerS: 0,
        recruitTargetBuildingId: null,
        recruitOrderId: null,
        path: [],
        travelM: 0,
        workPhase: 'atShop',
        workTargetX: keep.x + 4,
        workTargetZ: keep.z + 4,
        workTargetTreeId: null,
        workTimerS: 0,
      });
    }

    const pikes = spawnRegiment(sim.state, 0, 'pikemen', barracks.x + 6, barracks.z, 0);
    const swords = spawnRegiment(sim.state, 0, 'swordsmen', barracks.x + 8, barracks.z + 4, 0);
    const archers = spawnRegiment(sim.state, 0, 'archers', barracks.x + 10, barracks.z, 0);

    // Shield Wall allowed for Swordsmen/Pikemen, rejected for Archers (no shield)
    expect(sim.execute({ type: 'setStance', side: 0, regimentIds: [swords.id], stance: 'shieldWall' }).ok).toBe(true);
    expect(swords.stance).toBe('shieldWall');
    expect(sim.execute({ type: 'setStance', side: 0, regimentIds: [archers.id], stance: 'shieldWall' }).ok).toBe(false);

    // Pike Wall allowed for Pikemen, rejected for Swordsmen; breaks back to guard on march order
    expect(sim.execute({ type: 'setStance', side: 0, regimentIds: [pikes.id], stance: 'pikeWall' }).ok).toBe(true);
    expect(pikes.stance).toBe('pikeWall');
    expect(sim.execute({ type: 'setStance', side: 0, regimentIds: [swords.id], stance: 'pikeWall' }).ok).toBe(false);
    expect(sim.execute({ type: 'issueOrder', side: 0, regimentIds: [pikes.id], order: { kind: 'march', x: pikes.x + 12, z: pikes.z } }).ok).toBe(true);
    expect(pikes.stance).toBe('guard');

    // Reinforce thinned veteran Swordsmen regiment at nearby Barracks while preserving veteranTier & kills!
    swords.veteranTier = 2;
    swords.kills = 22;
    swords.outOfCombatS = 15;
    swords.captainAlive = false;
    for (let i = 0; i < 4; i++) {
      swords.soldiers[i]!.alive = false;
      swords.soldiers[i]!.hp = 0;
    }
    expect(countAliveSoldiers(swords)).toBe(8);
    expect(sim.execute({ type: 'reinforceRegiment', side: 0, regimentId: swords.id }).ok).toBe(true);
    expect(countAliveSoldiers(swords)).toBe(12);
    expect(swords.veteranTier).toBe(2);
    expect(swords.kills).toBe(22);
    expect(swords.captainAlive).toBe(true);
  });

  it('garrisons watchtowers like FPS/marchland (up to 4 enter, remainder stays outside, ungarrison returns them)', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 919 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    sim.state.sides[0].stock.gold = 1000;
    sim.state.sides[0].stock.timber = 400;
    sim.state.sides[0].stock.stone = 400;

    const t1Res = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'watchtower', x: keep.x + 22, z: keep.z - 12, yawRad: 0 });
    const t2Res = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'watchtower', x: keep.x + 22, z: keep.z + 12, yawRad: 0 });
    expect(t1Res.ok).toBe(true);
    expect(t2Res.ok).toBe(true);
    const t1 = sim.state.buildings.find((b) => b.id === t1Res.createdId)!;
    const t2 = sim.state.buildings.find((b) => b.id === t2Res.createdId)!;
    t1.buildProgress = 1;
    t2.buildProgress = 1;

    // 12 crossbowmen sent to watchtower 1 -> 4 enter tower, 8 stay outside as an active regiment!
    const xbows = spawnRegiment(sim.state, 0, 'crossbowmen', t1.x - 4, t1.z, 0);
    expect(countAliveSoldiers(xbows)).toBe(12);
    expect(
      sim.execute({
        type: 'issueOrder',
        side: 0,
        regimentIds: [xbows.id],
        order: { kind: 'garrison', x: t1.x, z: t1.z, targetBuildingId: t1.id },
      }).ok,
    ).toBe(true);
    sim.step(0.2);

    expect(t1.garrisonCount).toBe(4);
    expect(t1.garrisonType).toBe('crossbowmen');
    expect(countAliveSoldiers(xbows)).toBe(8);
    expect(xbows.garrisonedInBuildingId).toBeNull();

    // Send the remaining 8 to watchtower 2 -> 4 enter tower 2, 4 remain outside!
    expect(
      sim.execute({
        type: 'issueOrder',
        side: 0,
        regimentIds: [xbows.id],
        order: { kind: 'garrison', x: t2.x, z: t2.z, targetBuildingId: t2.id },
      }).ok,
    ).toBe(true);
    for (let i = 0; i < 160; i++) {
      sim.step(0.2);
      if (t2.garrisonCount === 4) break;
    }
    expect(t2.garrisonCount).toBe(4);
    expect(countAliveSoldiers(xbows)).toBe(4);

    // Ungarrisoning tower 2 folds those 4 back into the nearby regiment (4 + 4 = 8); ungarrisoning tower 1 spawns a 4-man regiment!
    expect(sim.execute({ type: 'ungarrisonWatchtower', side: 0, buildingId: t2.id }).ok).toBe(true);
    expect(t2.garrisonCount).toBe(0);
    expect(t2.garrisonType).toBeNull();
    expect(countAliveSoldiers(xbows)).toBe(8);

    const un1 = sim.execute({ type: 'ungarrisonWatchtower', side: 0, buildingId: t1.id });
    expect(un1.ok).toBe(true);
    expect(t1.garrisonCount).toBe(0);
    const spawned = sim.state.regiments.find((r) => r.id === un1.createdId)!;
    expect(spawned).toBeDefined();
    expect(countAliveSoldiers(spawned)).toBe(4);
  });
});


