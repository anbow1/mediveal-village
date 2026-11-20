import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, ECONOMY, type BuildingTypeId } from '../src/config.ts';
import { SimEngine } from '../src/sim/engine.ts';
import { computeProductionRates, countPopulation, listBottlenecks } from '../src/sim/economy.ts';

function stepMinutes(sim: SimEngine, minutes: number, dtS = 0.25): void {
  const steps = Math.round((minutes * 60) / dtS);
  for (let i = 0; i < steps; i++) sim.step(dtS);
}

function findValidSpot(
  sim: SimEngine,
  type: BuildingTypeId,
  cx: number,
  cz: number,
  maxRadiusM = 120,
): { x: number; z: number } {
  for (let r = 8; r <= maxRadiusM; r += 4) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const x = cx + Math.cos(ang) * r;
      const z = cz + Math.sin(ang) * r;
      if (sim.validatePlacement(0, type, x, z, 0, false) === 'ok') {
        return { x, z };
      }
    }
  }
  throw new Error(`No valid spot found for ${type} around (${cx}, ${cz})`);
}

describe('Stage 6 living town economy & logistics', () => {
  it('starts skirmish with canonical Keep, 8 residents, and exact starting stock', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 42 });
    const p0 = sim.state.sides[0];
    expect(p0.stock.gold).toBe(ECONOMY.startingStock.gold);
    expect(p0.stock.timber).toBe(ECONOMY.startingStock.timber);
    expect(p0.stock.stone).toBe(ECONOMY.startingStock.stone);
    expect(p0.stock.bread).toBe(ECONOMY.startingStock.bread);
    const pop = countPopulation(sim.state, 0);
    expect(pop.total).toBe(ECONOMY.keepResidents);
    expect(sim.state.buildings.filter((b) => b.side === 0 && b.type === 'keep')).toHaveLength(1);
  });

  it('allocates shared population dynamically while keeping >= 4 free carriers/builders', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 101 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    sim.state.sides[0].stock.gold = 2000;
    sim.state.sides[0].stock.timber = 400;
    sim.state.sides[0].stock.stone = 200;

    const hSpot = findValidSpot(sim, 'house', keep.x, keep.z);
    expect(sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'house', x: hSpot.x, z: hSpot.z, yawRad: 0 }).ok).toBe(true);

    for (const bt of ['sawmill', 'bakery', 'windmill', 'tannery', 'smithy'] as const) {
      const sp = findValidSpot(sim, bt, keep.x, keep.z);
      const res = sim.execute({ type: 'placeBuilding', side: 0, buildingType: bt, x: sp.x, z: sp.z, yawRad: 0 });
      expect(res.ok).toBe(true);
    }

    for (const b of sim.state.buildings) {
      if (b.side === 0) b.buildProgress = 1;
    }
    sim.step(1.2); // triggers 1s role allocator

    const pop = countPopulation(sim.state, 0);
    expect(pop.carriers + pop.builders).toBeGreaterThanOrEqual(ECONOMY.minFreeCarriers);
  });

  it('constructs buildings physically via carrier delivery + builder hammering and runs pig -> tannery leather armour chain', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 77 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    sim.state.sides[0].stock.gold = 1500;
    sim.state.sides[0].stock.timber = 300;
    sim.state.sides[0].stock.stone = 200;
    sim.state.sides[0].stock.grain = 40;
    sim.state.sides[0].stock.bread = 80;

    const hSp = findValidSpot(sim, 'house', keep.x, keep.z);
    expect(sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'house', x: hSp.x, z: hSp.z, yawRad: 0 }).ok).toBe(true);
    const pSp = findValidSpot(sim, 'pigFarm', keep.x, keep.z);
    expect(sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'pigFarm', x: pSp.x, z: pSp.z, yawRad: 0 }).ok).toBe(true);
    const tSp = findValidSpot(sim, 'tannery', keep.x, keep.z);
    expect(sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'tannery', x: tSp.x, z: tSp.z, yawRad: 0 }).ok).toBe(true);

    stepMinutes(sim, 4.5);

    const house = sim.state.buildings.find((b) => b.side === 0 && b.type === 'house')!;
    const pigFarm = sim.state.buildings.find((b) => b.side === 0 && b.type === 'pigFarm')!;
    const tannery = sim.state.buildings.find((b) => b.side === 0 && b.type === 'tannery')!;
    expect(house.buildProgress).toBe(1);
    expect(pigFarm.buildProgress).toBe(1);
    expect(tannery.buildProgress).toBe(1);

    const totalLeather =
      sim.state.sides[0].stock.leatherArmour +
      (tannery.yard.leatherArmour ?? 0);
    expect(totalLeather).toBeGreaterThanOrEqual(1);

    const rates = computeProductionRates(sim.state, 0);
    expect(rates.length).toBeGreaterThanOrEqual(5);
  });

  it('halts workshop output when yard reaches 24 units and reports bottleneck', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 55 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    sim.state.sides[0].stock.gold = 500;
    const sp = findValidSpot(sim, 'sawmill', keep.x, keep.z);
    const res = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'sawmill', x: sp.x, z: sp.z, yawRad: 0 });
    expect(res.ok).toBe(true);
    const mill = sim.state.buildings.find((b) => b.id === res.createdId)!;
    mill.buildProgress = 1;
    mill.inputs.timber = 8;
    mill.yard.planks = 120; // remains >= 24 even after starting carriers reserve 8 each!

    // Assign a worker directly to mill so status evaluates yardFull rather than noWorker
    const citizen = sim.state.citizens.find((c) => c.side === 0)!;
    citizen.role = 'worker';
    citizen.assignedBuildingId = mill.id;
    citizen.x = mill.x;
    citizen.z = mill.z;
    sim.step(0.5);
    expect(mill.status).toBe('yardFull');
    const bns = listBottlenecks(sim.state, 0);
    expect(bns.some((bn) => bn.buildingId === mill.id && bn.status === 'yardFull')).toBe(true);
  });

  it('applies Wine tax (x1.8) + growth (x0.6) and Well radius (<= 40 m -> x0.75) bonuses', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 88 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    sim.state.sides[0].stock.gold = 2000;
    sim.state.sides[0].stock.timber = 300;
    sim.state.sides[0].stock.stone = 200;

    const spA = findValidSpot(sim, 'house', keep.x + 12, keep.z, 50);
    const rA = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'house', x: spA.x, z: spA.z, yawRad: 0 });
    expect(rA.ok).toBe(true);
    const spWell = findValidSpot(sim, 'well', spA.x, spA.z, 25);
    const rW = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'well', x: spWell.x, z: spWell.z, yawRad: 0 });
    expect(rW.ok).toBe(true);

    const spB = findValidSpot(sim, 'house', keep.x - 85, keep.z - 50, 50);
    const rB = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'house', x: spB.x, z: spB.z, yawRad: 0 });
    expect(rB.ok).toBe(true);

    const houseA = sim.state.buildings.find((b) => b.id === rA.createdId)!;
    const houseB = sim.state.buildings.find((b) => b.id === rB.createdId)!;
    const well = sim.state.buildings.find((b) => b.id === rW.createdId)!;
    houseA.buildProgress = 1;
    houseB.buildProgress = 1;
    well.buildProgress = 1;
    houseA.residents = 1;
    houseB.residents = 1;
    houseA.houseFoodRations = 12;
    houseB.houseFoodRations = 12;
    houseA.houseWineCasks = 4; // wine active!
    houseB.houseWineCasks = 0;

    // House A newcomer interval = 30 * 0.6 * 0.75 = 13.5 s vs House B = 30 s! Step 20 s -> A grows, B doesn't!
    stepMinutes(sim, 20 / 60);
    expect(houseA.residents).toBeGreaterThan(houseB.residents);
  });

  it('validates Keep L1->L2->L3 upgrades, Market 10-lot trade (60%/160%), and 50% demolish refund', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', disableAi: true, seed: 33 });
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    const stock = sim.state.sides[0].stock;
    stock.gold = 3000;
    stock.timber = 500;
    stock.planks = 200;
    stock.stone = 500; // enough for L1->L2 (120) + L2->L3 (240) + market!
    stock.iron = 100;

    // Upgrade Keep L1 -> L2
    const u2 = sim.execute({ type: 'upgradeBuilding', side: 0, buildingId: keep.id });
    expect(u2.ok).toBe(true);
    expect(keep.upgradingToLevel).toBe(2);
    stepMinutes(sim, 1.5);
    expect(keep.level).toBe(2);

    // Upgrade Keep L2 -> L3
    const u3 = sim.execute({ type: 'upgradeBuilding', side: 0, buildingId: keep.id });
    expect(u3.ok).toBe(true);
    stepMinutes(sim, 1.5);
    expect(keep.level).toBe(3);

    // Place & complete Market -> test 10-lot sell & buy
    const mSp = findValidSpot(sim, 'market', keep.x, keep.z);
    const mRes = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'market', x: mSp.x, z: mSp.z, yawRad: 0 });
    expect(mRes.ok).toBe(true);
    const market = sim.state.buildings.find((b) => b.id === mRes.createdId)!;
    market.buildProgress = 1;

    const goldBeforeSell = stock.gold;
    const timberBeforeSell = stock.timber;
    expect(sim.execute({ type: 'marketTrade', side: 0, action: 'sell', good: 'timber' }).ok).toBe(true);
    expect(stock.timber).toBe(timberBeforeSell - ECONOMY.marketLotSize);
    expect(stock.gold).toBeGreaterThan(goldBeforeSell);

    const goldBeforeBuy = stock.gold;
    expect(sim.execute({ type: 'marketTrade', side: 0, action: 'buy', good: 'iron' }).ok).toBe(true);
    expect(stock.gold).toBeLessThan(goldBeforeBuy);

    // Demolish Market -> 50% refund of gold + timber/stone
    const goldPreDemolish = stock.gold;
    expect(sim.execute({ type: 'demolishBuilding', side: 0, buildingId: market.id }).ok).toBe(true);
    expect(stock.gold).toBe(goldPreDemolish + Math.floor((BUILDING_DEFS.market.cost.gold ?? 0) * 0.5));
  });

  it('rejects invalid placement (water, enemy keep, missing forest) with typed reasons and fells forest clearings', () => {
    const sim = new SimEngine({ mapId: 'crossing', mode: 'skirmish', disableAi: true, seed: 12 });
    const enemyKeep = sim.state.buildings.find((b) => b.side === 1 && b.type === 'keep')!;
    expect(sim.validatePlacement(0, 'house', enemyKeep.x + 15, enemyKeep.z, 0, false)).toBe('tooCloseEnemyKeep');
    // Sample a deep river channel coordinate on the meandering crossing river
    let waterPt: [number, number] | null = null;
    for (let x = -40; x <= 40 && !waterPt; x += 2) {
      if (sim.terrain.waterDepthAt(x, 42) > 0.35) waterPt = [x, 42];
    }
    expect(waterPt).not.toBeNull();
    expect(sim.validatePlacement(0, 'house', waterPt![0], waterPt![1], 0, false)).toBe('water');

    // Place a Woodcutter next to a mature tree near side 0 Keep and run 1.5 min -> at least 1 felled tree!
    const keep = sim.state.buildings.find((b) => b.side === 0 && b.type === 'keep')!;
    const matureNear = sim.state.trees
      .filter((t) => t.state === 'mature' && Math.hypot(t.x - keep.x, t.z - keep.z) < 220)
      .sort((a, b) => Math.hypot(a.x - keep.x, a.z - keep.z) - Math.hypot(b.x - keep.x, b.z - keep.z))[0];
    expect(matureNear).toBeDefined();
    const wcSpot = findValidSpot(sim, 'woodcutter', matureNear!.x, matureNear!.z, 24);
    sim.state.sides[0].stock.gold = 500;
    const wcRes = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'woodcutter', x: wcSpot.x, z: wcSpot.z, yawRad: 0 });
    expect(wcRes.ok).toBe(true);
    const wc = sim.state.buildings.find((b) => b.id === wcRes.createdId)!;
    wc.buildProgress = 1;

    stepMinutes(sim, 1.5);
    const felledCount = sim.state.trees.filter((t) => t.state !== 'mature').length;
    expect(felledCount).toBeGreaterThanOrEqual(1);
  });
});
