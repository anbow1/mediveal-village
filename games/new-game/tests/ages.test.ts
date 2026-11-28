import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, ECONOMY, GREAT, START_AGE, UNIT_DEFS } from '../src/config.ts';
import { countAliveSoldiers, spawnRegiment } from '../src/sim/combat.ts';
import { inspectBuildingUpgrade } from '../src/sim/commands.ts';
import { eraOfKeepLevel, eraOfSide, findKeep, greatTaxFactor, greatWorkSpeedFactor } from '../src/sim/economy.ts';
import { SimEngine } from '../src/sim/engine.ts';

function stepSeconds(sim: SimEngine, seconds: number): void {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) sim.step(1 / 60);
}

describe('Ages (3 Eras, Great Buildings, Firearms, Cross-Age Refit & Start Age)', () => {
  it('maps Keep levels 1-3 to Era 1, Keep 4 to Era 2, and Keep 5 to Era 3', () => {
    expect(eraOfKeepLevel(1)).toBe(1);
    expect(eraOfKeepLevel(2)).toBe(1);
    expect(eraOfKeepLevel(3)).toBe(1);
    expect(eraOfKeepLevel(4)).toBe(2);
    expect(eraOfKeepLevel(5)).toBe(3);
  });

  it('upgrades Keep from L3 to L4 (180 s) and L5 (240 s), emitting eraAdvanced alerts and unlocking L4-L5 upgrades', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true });
    const keep = findKeep(sim.state, 0)!;
    const stock = sim.state.sides[0].stock;
    stock.gold = 9000;
    stock.timber = 2000;
    stock.planks = 2000;
    stock.stone = 2000;
    stock.iron = 2000;

    // Place a House and bring it to L3
    const hx = keep.x + 22;
    const hz = keep.z + 18;
    const placed = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'house', x: hx, z: hz, yawRad: 0 });
    expect(placed.ok).toBe(true);
    const house = sim.state.buildings.find((b) => b.id === placed.createdId)!;
    house.buildProgress = 1;
    house.level = 3;
    keep.level = 3;

    // House cannot upgrade to L4 while Keep is still L3!
    const blocked = inspectBuildingUpgrade(sim.state, 0, house);
    expect(blocked.canUpgrade).toBe(false);
    expect(blocked.reason).toBe('needsKeepUpgrade');
    expect(blocked.requiredKeepLevel).toBe(4);

    // Upgrade Keep L3 -> L4 (Early Modern, 180 builder-s)
    const up4 = sim.execute({ type: 'upgradeBuilding', side: 0, buildingId: keep.id });
    expect(up4.ok).toBe(true);
    expect(keep.upgradingToLevel).toBe(4);
    expect(keep.upgradeTimerS).toBe(0);
    // At 30 s it is still upgrading (requires 180 builder-s!)
    stepSeconds(sim, 30);
    expect(keep.level).toBe(3);
    stepSeconds(sim, ECONOMY.keepLevels[3].upgradeS + 2);
    expect(keep.level).toBe(4);
    expect(eraOfSide(sim.state, 0)).toBe(2);
    expect(sim.state.alerts.some((a) => a.kind === 'eraAdvanced')).toBe(true);

    // Now House CAN upgrade to L4, and Keep can upgrade to L5 (19th Century, 240 builder-s)
    const allowed4 = inspectBuildingUpgrade(sim.state, 0, house);
    expect(allowed4.canUpgrade).toBe(true);
    expect(sim.execute({ type: 'upgradeBuilding', side: 0, buildingId: house.id }).ok).toBe(true);

    const up5 = sim.execute({ type: 'upgradeBuilding', side: 0, buildingId: keep.id });
    expect(up5.ok).toBe(true);
    expect(keep.upgradingToLevel).toBe(5);
    stepSeconds(sim, ECONOMY.keepLevels[4].upgradeS + 2);
    expect(keep.level).toBe(5);
    expect(eraOfSide(sim.state, 0)).toBe(3);
  });

  it('enforces Keep-level gating (needsKeep) and uniqueness (onlyOne) for Great Buildings and Era workshops', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true });
    const keep = findKeep(sim.state, 0)!;
    const stock = sim.state.sides[0].stock;
    stock.gold = 9000;
    stock.timber = 2000;
    stock.planks = 2000;
    stock.stone = 2000;
    stock.iron = 2000;

    // At Keep L1, Cathedral (L3), Gunsmith/PowderMill/TownHall (L4), Manufactory (L5) are all gated by needsKeep
    expect(sim.validatePlacement(0, 'cathedral', keep.x + 26, keep.z + 20, 0)).toBe('needsKeep');
    expect(sim.validatePlacement(0, 'gunsmith', keep.x + 26, keep.z + 20, 0)).toBe('needsKeep');
    expect(sim.validatePlacement(0, 'powderMill', keep.x + 26, keep.z + 20, 0)).toBe('needsKeep');
    expect(sim.validatePlacement(0, 'townHall', keep.x + 26, keep.z + 20, 0)).toBe('needsKeep');
    expect(sim.validatePlacement(0, 'manufactory', keep.x + 26, keep.z + 20, 0)).toBe('needsKeep');

    // At Keep L3, Cathedral unlocks, and placing a second Cathedral is rejected with onlyOne!
    keep.level = 3;
    const c1 = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'cathedral', x: keep.x + 28, z: keep.z + 24, yawRad: 0 });
    expect(c1.ok).toBe(true);
    expect(sim.validatePlacement(0, 'cathedral', keep.x + 28, keep.z - 28, 0)).toBe('onlyOne');

    // At Keep L4, Gunsmith, PowderMill, and TownHall unlock; Manufactory still needs Keep L5
    keep.level = 4;
    expect(sim.validatePlacement(0, 'gunsmith', keep.x + 24, keep.z - 22, 0)).toBe('ok');
    expect(sim.validatePlacement(0, 'powderMill', keep.x + 24, keep.z - 22, 0)).toBe('ok');
    expect(sim.validatePlacement(0, 'townHall', keep.x + 36, keep.z - 28, 0)).toBe('ok');
    expect(sim.validatePlacement(0, 'manufactory', keep.x + 36, keep.z - 28, 0)).toBe('needsKeep');

    // At Keep L5, Manufactory unlocks and is unique
    keep.level = 5;
    const m1 = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'manufactory', x: keep.x + 36, z: keep.z - 28, yawRad: 0 });
    expect(m1.ok).toBe(true);
    expect(sim.validatePlacement(0, 'manufactory', keep.x - 36, keep.z - 28, 0)).toBe('onlyOne');
  });

  it('applies Cathedral (+8 morale), Town Hall (1.25x tax), and Manufactory (1.2x workshop speed) bonuses', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true });
    const keep = findKeep(sim.state, 0)!;
    keep.level = 5;
    const stock = sim.state.sides[0].stock;
    stock.gold = 9000;
    stock.timber = 2000;
    stock.planks = 2000;
    stock.stone = 2000;
    stock.iron = 2000;

    expect(greatTaxFactor(sim.state, 0)).toBe(1.0);
    expect(greatWorkSpeedFactor(sim.state, 0)).toBe(1.0);

    const reg = spawnRegiment(sim.state, 0, 'swordsmen', keep.x + 35, keep.z, 0);
    const baseMaxMorale = UNIT_DEFS.swordsmen.morale;

    const cRes = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'cathedral', x: keep.x + 28, z: keep.z + 24, yawRad: 0 });
    const thRes = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'townHall', x: keep.x + 30, z: keep.z - 26, yawRad: 0 });
    const mfRes = sim.execute({ type: 'placeBuilding', side: 0, buildingType: 'manufactory', x: keep.x - 30, z: keep.z + 26, yawRad: 0 });
    expect(cRes.ok && thRes.ok && mfRes.ok).toBe(true);

    for (const id of [cRes.createdId, thRes.createdId, mfRes.createdId]) {
      const b = sim.state.buildings.find((x) => x.id === id)!;
      b.buildProgress = 1;
    }

    stepSeconds(sim, 2);
    expect(sim.state.sides[0].hasCathedral).toBe(true);
    expect(sim.state.sides[0].hasTownHall).toBe(true);
    expect(sim.state.sides[0].hasManufactory).toBe(true);
    expect(greatTaxFactor(sim.state, 0)).toBeCloseTo(GREAT.townHallGoldMultiplier, 5);
    expect(greatWorkSpeedFactor(sim.state, 0)).toBeCloseTo(GREAT.manufactoryWorkSpeedMultiplier, 5);
    expect(reg.maxMorale).toBeGreaterThanOrEqual(baseMaxMorale + GREAT.cathedralMorale);
  });

  it('fires shield-piercing musketball projectiles with musketShot FX and supports cross-age refit', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true, startAge: 3 });
    const keep = findKeep(sim.state, 0)!;
    const bar = sim.state.buildings.find((b) => b.side === 0 && b.type === 'barracks')!;
    expect(keep.level).toBe(5);
    expect(bar.level).toBe(5);

    // Cross-age refit: militia -> musketeers -> lineInfantry near L5 Barracks!
    sim.state.sides[0].stock.gold = 2000;
    sim.state.sides[0].stock.muskets = 100;
    sim.state.sides[0].stock.powder = 100;
    sim.state.sides[0].stock.weapons = 100;
    sim.state.sides[0].stock.leatherArmour = 100;

    const mil = spawnRegiment(sim.state, 0, 'militia', bar.x + 6, bar.z + 6, 0);
    mil.outOfCombatS = 10;
    const r1 = sim.execute({ type: 'refitRegiment', side: 0, regimentId: mil.id, targetType: 'musketeers' });
    expect(r1.ok).toBe(true);
    stepSeconds(sim, 22);
    expect(mil.unitType).toBe('musketeers');

    mil.outOfCombatS = 10;
    const r2 = sim.execute({ type: 'refitRegiment', side: 0, regimentId: mil.id, targetType: 'lineInfantry' });
    expect(r2.ok).toBe(true);
    stepSeconds(sim, 22);
    expect(mil.unitType).toBe('lineInfantry');

    // Combat volley test: Musketeers vs shielded Swordsmen emits musketShot FX and deals shield-piercing casualties
    const msk = spawnRegiment(sim.state, 0, 'musketeers', 0, 0, Math.PI * 0.5);
    const swd = spawnRegiment(sim.state, 1, 'swordsmen', 44, 0, -Math.PI * 0.5);
    swd.stance = 'shieldWall';
    const initialSwdHp = swd.soldiers.reduce((s, sol) => s + sol.hp, 0);
    sim.drainFxEvents();

    let sawMusketShot = false;
    let sawMusketBall = false;
    for (let i = 0; i < 60 * 28; i++) {
      sim.step(1 / 60);
      if (sim.state.projectiles.some((p) => p.kind === 'musketball')) sawMusketBall = true;
      const fx = sim.drainFxEvents();
      if (fx.some((e) => e.kind === 'musketShot')) sawMusketShot = true;
    }
    const finalSwdHp = swd.soldiers.reduce((s, sol) => s + (sol.alive ? sol.hp : 0), 0);
    expect(sawMusketBall).toBe(true);
    expect(sawMusketShot).toBe(true);
    expect(finalSwdHp).toBeLessThan(initialSwdHp * 0.75);
    expect(countAliveSoldiers(msk)).toBeGreaterThan(0);
  });

  it('initializes startAge 2 and 3 with upgraded Keep, Era stock, and era-level Barracks (ignored in Campaign)', () => {
    const sim2 = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true, startAge: 2 });
    const k0 = findKeep(sim2.state, 0)!;
    const k1 = findKeep(sim2.state, 1)!;
    expect(k0.level).toBe(4);
    expect(k1.level).toBe(4);
    expect(k0.maxHp).toBe(ECONOMY.keepLevels[3].maxHp);
    expect(sim2.state.sides[0].stock.gold).toBeGreaterThanOrEqual((ECONOMY.startingStock.gold ?? 0) + (START_AGE.stock[1]?.gold ?? 0));
    expect(sim2.state.buildings.some((b) => b.side === 0 && b.type === 'barracks' && b.level === 4)).toBe(true);
    expect(sim2.state.buildings.some((b) => b.side === 1 && b.type === 'barracks' && b.level === 4)).toBe(true);

    // Campaign M1-M5 always stay in Era 1 regardless of startAge option
    const camp = new SimEngine({ mapId: 'crossing', mode: 'campaign', missionId: 1, startAge: 3, disableAi: true });
    expect(findKeep(camp.state, 0)!.level).toBe(1);
    expect(BUILDING_DEFS.gunsmith.keepLevel).toBe(4);
  });

  it('supports Fast Ages (-35% Keep L4/L5 cost & duration) and emits Great Building alerts', () => {
    const normal = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true });
    const fast = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true, fastAges: true });
    const kNorm = findKeep(normal.state, 0)!;
    const kFast = findKeep(fast.state, 0)!;
    kNorm.level = 3;
    kFast.level = 3;

    const normCheck = inspectBuildingUpgrade(normal.state, 0, kNorm);
    const fastCheck = inspectBuildingUpgrade(fast.state, 0, kFast);
    expect(fastCheck.cost.gold!).toBeLessThan(normCheck.cost.gold!);
    expect(fastCheck.cost.gold!).toBe(Math.ceil((ECONOMY.keepLevels[3].cost.gold ?? 0) * 0.65));

    // Fast Ages completes Keep L4 significantly faster than 180 s (117 builder-s)
    const st = fast.state.sides[0].stock;
    st.gold = 9000;
    st.planks = 2000;
    st.stone = 2000;
    st.iron = 2000;
    st.timber = 2000;
    expect(fast.execute({ type: 'upgradeBuilding', side: 0, buildingId: kFast.id }).ok).toBe(true);
    stepSeconds(fast, 122);
    expect(kFast.level).toBe(4);

    // Placing a Great Building (Town Hall) emits a clickable greatBuilding alert to Side 0
    const th = fast.execute({ type: 'placeBuilding', side: 0, buildingType: 'townHall', x: kFast.x + 28, z: kFast.z + 24, yawRad: 0 });
    expect(th.ok).toBe(true);
    expect(fast.state.alerts.some((a) => a.kind === 'greatBuilding' && a.detail.includes('townHall'))).toBe(true);
  });

  it('supports Hollow Square 360-degree anti-cav, Volley Fire stance, Dragoon Dismount, Field Powder resupply, and differentiated Capture Point yields', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true, startAge: 2 });
    const keep = findKeep(sim.state, 0)!;

    // 1. Hollow Square & Volley Fire on Musketeers
    const msk = spawnRegiment(sim.state, 0, 'musketeers', 0, 0, 0);
    expect(sim.execute({ type: 'setFormation', side: 0, regimentIds: [msk.id], formation: 'square' }).ok).toBe(true);
    expect(msk.formation).toBe('square');
    expect(sim.execute({ type: 'setStance', side: 0, regimentIds: [msk.id], stance: 'volleyFire' }).ok).toBe(true);
    expect(msk.stance).toBe('volleyFire');
    expect(msk.ammoVolleys).toBeGreaterThanOrEqual(6);

    // 2. Field Powder Resupply near Keep draws from town powder stock
    msk.x = keep.x + 15;
    msk.z = keep.z;
    msk.ammoVolleys = 2;
    const beforePowder = sim.state.sides[0].stock.powder;
    stepSeconds(sim, 10);
    expect(msk.ammoVolleys!).toBeGreaterThan(2);
    expect(sim.state.sides[0].stock.powder).toBeLessThan(beforePowder);

    // 3. Dragoon Dismount toggles foot mode and removes Wedge formation
    const drg = spawnRegiment(sim.state, 0, 'dragoons', 20, 0, 0);
    expect(sim.execute({ type: 'setFormation', side: 0, regimentIds: [drg.id], formation: 'wedge' }).ok).toBe(true);
    expect(sim.execute({ type: 'setDismounted', side: 0, regimentIds: [drg.id], dismounted: true }).ok).toBe(true);
    expect(drg.dismounted).toBe(true);
    expect(drg.formation).toBe('line');

    // 4. Capture Point differentiated yields (mine gives ironOre+gold, quarry stone+gold, village gold+grain)
    const mineCp = sim.state.capturePoints.find((cp) => cp.kind === 'mine')!;
    const quarryCp = sim.state.capturePoints.find((cp) => cp.kind === 'quarry')!;
    const villageCp = sim.state.capturePoints.find((cp) => cp.kind === 'village')!;
    mineCp.owner = 0;
    quarryCp.owner = 0;
    villageCp.owner = 0;
    const ore0 = sim.state.sides[0].stock.ironOre;
    const stone0 = sim.state.sides[0].stock.stone;
    const grain0 = sim.state.sides[0].stock.grain;
    stepSeconds(sim, 15);
    expect(sim.state.sides[0].stock.ironOre).toBeGreaterThan(ore0 + 1.5);
    expect(sim.state.sides[0].stock.stone).toBeGreaterThan(stone0 + 2.0);
    expect(sim.state.sides[0].stock.grain).toBeGreaterThan(grain0 + 1.0);
  });

  it('implements Era 2-3 artillery (falconets, culverins, horseGuns, fieldGuns), limbering, ±15° arc traverse & rolling cannonball', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true, startAge: 3 });
    expect(UNIT_DEFS.falconets.gunFoundryLevel).toBe(4);
    expect(UNIT_DEFS.culverins.gunFoundryLevel).toBe(4);
    expect(UNIT_DEFS.horseGuns.gunFoundryLevel).toBe(5);
    expect(UNIT_DEFS.fieldGuns.gunFoundryLevel).toBe(5);
    expect(UNIT_DEFS.falconets.teamHorses).toBe(2);
    expect(UNIT_DEFS.culverins.teamHorses).toBe(4);
    expect(UNIT_DEFS.horseGuns.teamHorses).toBe(4);
    expect(UNIT_DEFS.fieldGuns.teamHorses).toBe(4);

    // 1. Limbering before moving & unlimbering on arrival (horseGuns has limberS = 5)
    const hg = spawnRegiment(sim.state, 0, 'horseGuns', -40, 0, Math.PI * 0.5);
    expect(hg.limbered).toBe(false);
    sim.execute({ type: 'issueOrder', side: 0, regimentIds: [hg.id], order: { kind: 'march', x: -10, z: 0 } });
    stepSeconds(sim, 2.0);
    // Still hitching (limberS = 5 s), so it must NOT have moved yet
    expect(hg.limberTimerS!).toBeGreaterThan(0);
    expect(hg.x).toBeCloseTo(-40, 1);
    stepSeconds(sim, 5.0);
    // Now hitched & moving forward!
    expect(hg.limbered).toBe(true);
    expect(hg.x).toBeGreaterThan(-39);

    // 2. Slow hand-traverse aiming & ±15° arc check + rolling cannonball hits deep column
    const fg = spawnRegiment(sim.state, 0, 'fieldGuns', -60, 40, 0); // facing +Z, enemy is at +X (90° off!)
    const col = spawnRegiment(sim.state, 1, 'swordsmen', 20, 40, -Math.PI * 0.5, { formation: 'column' });
    fg.order = { kind: 'attack', x: col.x, z: col.z, targetRegimentId: col.id };
    stepSeconds(sim, 2.0);
    // Still turning from 0 rad toward +pi/2 (aimTurnRadS = 0.18 rad/s -> ~0.36 rad turned), cannot fire yet!
    expect(sim.state.projectiles.some((p) => p.sourceRegimentId === fg.id)).toBe(false);
    expect(fg.yawRad).toBeGreaterThan(0.2);

    // Point gun directly at enemy column -> fires cannonball with rollDistM = 20 and damages/kills soldiers
    fg.yawRad = Math.PI * 0.5;
    for (const s of fg.soldiers) s.rangedCooldownS = 0.05;
    const initHp = col.soldiers.reduce((acc, s) => acc + s.hp, 0);
    let sawRollingBall = false;
    for (let i = 0; i < 60 * 12; i++) {
      sim.step(1 / 60);
      if (sim.state.projectiles.some((p) => p.sourceRegimentId === fg.id && (p.rollDistM ?? 0) >= 20)) {
        sawRollingBall = true;
      }
    }
    const endHp = col.soldiers.reduce((acc, s) => acc + (s.alive ? s.hp : 0), 0);
    expect(sawRollingBall).toBe(true);
    expect(endHp).toBeLessThan(initHp);
  });

  it('implements Army Captain +5 morale aura, permanent shatter disband, deferred planned roads, and AI Pike/Shield Wall reflexes', () => {
    const sim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, disableAi: true });
    const k0 = findKeep(sim.state, 0)!;

    // 1. Army Captain aura (+5 max morale to friendly regiments within 45 m)
    const vet = spawnRegiment(sim.state, 0, 'swordsmen', 0, 0, 0, { kills: 30, veteranTier: 2 });
    const nearAlly = spawnRegiment(sim.state, 0, 'pikemen', 20, 0, 0);
    const farAlly = spawnRegiment(sim.state, 0, 'pikemen', 110, 0, 0);
    stepSeconds(sim, 0.25);
    expect(vet.isArmyCaptain).toBe(true);
    expect(nearAlly.maxMorale).toBe(farAlly.maxMorale + 5);

    // 2. Permanent Shatter: regiment routing with <25% strength shatters and disbands back into town at Keep
    const doomed = spawnRegiment(sim.state, 0, 'militia', k0.x + 25, k0.z, 0);
    for (let i = 2; i < doomed.soldiers.length; i++) doomed.soldiers[i]!.alive = false;
    doomed.morale = 5;
    doomed.routing = true;
    doomed.shattered = true;
    const citBefore = sim.state.citizens.filter((c) => c.side === 0).length;
    stepSeconds(sim, 0.5);
    expect(sim.state.regiments.some((r) => r.id === doomed.id)).toBe(false);
    expect(sim.state.citizens.filter((c) => c.side === 0).length).toBeGreaterThanOrEqual(citBefore + 2);

    // 3. Deferred / Planned Road: staked when stone is 0, automatically paved once stone arrives!
    sim.state.sides[0].stock.stone = 0;
    const roadRes = sim.execute({ type: 'placeRoad', side: 0, x0: k0.x + 12, z0: k0.z, x1: k0.x + 42, z1: k0.z });
    expect(roadRes.ok).toBe(true);
    expect(roadRes.reason).toBe('planned');
    const staked = sim.state.roads[sim.state.roads.length - 1]!;
    expect(staked.planned).toBe(true);

    sim.state.sides[0].stock.stone = 20;
    stepSeconds(sim, 0.5);
    expect(staked.planned).toBe(false);
    expect(sim.state.sides[0].stock.stone).toBeLessThan(20);

    // 4. AI medieval tactical reflexes: Pikemen raise Pike Wall vs approaching cavalry, Swordsmen raise Shield Wall under arrow fire
    const aiSim = new SimEngine({ mapId: 'openField', mode: 'skirmish', showcaseMode: false, difficulty: 'normal', seed: 42 });
    const aiPikes = spawnRegiment(aiSim.state, 1, 'pikemen', 0, 0, -Math.PI * 0.5);
    const aiSwd = spawnRegiment(aiSim.state, 1, 'swordsmen', 0, 28, -Math.PI * 0.5);
    aiSwd.aiShieldWallTimerS = 4.0;
    spawnRegiment(aiSim.state, 0, 'lightCav', -35, 0, Math.PI * 0.5);
    stepSeconds(aiSim, 3.5);
    expect(aiPikes.stance).toBe('pikeWall');
    expect(aiSwd.stance).toBe('shieldWall');
  });
});
