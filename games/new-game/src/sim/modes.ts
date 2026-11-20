// Pure-TS Game Modes & 5-Mission Campaign Scenario Engine (zero three.js).
// Implements Skirmish, Defence, 7-step Tutorial, and Campaign Missions 1–5 per docs/CAMPAIGN.md & BRIEF.md F20–F21.

import {
  CAMPAIGN,
  ECONOMY,
  type BuildingTypeId,
  type UnitTypeId,
} from '../config.ts';
import { countAliveSoldiers, pushAlert, spawnRegiment } from './combat.ts';
import { findKeep } from './economy.ts';
import type {
  BuildingEntity,
  CampaignCarryOver,
  CampaignMissionId,
  RegimentEntity,
  SimWorldState,
  TutorialStepState,
} from './types.ts';

export const TUTORIAL_STEP_IDS = [
  'buildWoodcutter',
  'buildFarmAndHouse',
  'buildMillAndBakery',
  'buildQuarry',
  'recruitMilitia',
  'moveRegiment',
  'buildBarracks',
] as const;

export function createInitialTutorialSteps(): TutorialStepState[] {
  return TUTORIAL_STEP_IDS.map((id) => ({ id, completed: false }));
}

/** Extracts carry-over army (up to 8 veteran regiments) and treasury (50% gold capped at 800) at mission victory. */
export function buildCampaignCarryOver(state: SimWorldState): CampaignCarryOver {
  const playerRegs = state.regiments
    .filter((r) => r.side === 0 && countAliveSoldiers(r) > 0)
    .sort((a, b) => b.veteranTier - a.veteranTier || countAliveSoldiers(b) - countAliveSoldiers(a))
    .slice(0, CAMPAIGN.maxCarryOverRegiments);

  return {
    gold: Math.min(CAMPAIGN.carryOverGoldCap, Math.floor(state.sides[0].stock.gold * CAMPAIGN.carryOverGoldFrac)),
    regiments: playerRegs.map((r) => ({
      unitType: r.unitType,
      aliveMen: countAliveSoldiers(r),
      kills: Math.floor(r.kills),
      veteranTier: r.veteranTier,
    })),
  };
}

/** Applies Campaign Mission 1–5 starting units, scenario flags, ruins, walls, and carry-over armies! */
export function applyMissionSetup(
  state: SimWorldState,
  missionId: CampaignMissionId,
  carryOver?: CampaignCarryOver,
): void {
  const playerKeep = findKeep(state, 0);
  const px = playerKeep?.x ?? -100;
  const pz = playerKeep?.z ?? 0;

  // Apply carried-over treasury & veteran regiments (missions 2–5)
  if (carryOver) {
    state.sides[0].stock.gold = Math.max(state.sides[0].stock.gold, carryOver.gold + 200);
    for (let i = 0; i < carryOver.regiments.length; i++) {
      const cr = carryOver.regiments[i]!;
      spawnRegiment(state, 0, cr.unitType, px + 24 + (i % 4) * 11, pz - 16 + Math.floor(i / 4) * 14, Math.PI * 0.5, {
        count: cr.aliveMen,
        kills: cr.kills,
        veteranTier: cr.veteranTier,
      });
    }
  }

  if (missionId === 1) {
    // Mission 1: Tribute — 30 min deadline; visible Crimson host across the river watching!
    state.scenario.deadlineS = CAMPAIGN.m1DeadlineS;
    const enemyUnits: readonly (readonly [UnitTypeId, number, number])[] = [
      ['heavyCav', 96, -18],
      ['heavyCav', 96, 22],
      ['swordsmen', 86, -8],
      ['swordsmen', 86, 8],
      ['swordsmen', 102, 0],
      ['halberdiers', 102, -14],
      ['halberdiers', 102, 16],
      ['crossbowmen', 114, -10],
      ['crossbowmen', 114, 4],
      ['crossbowmen', 114, 18],
    ];
    for (const [ut, x, z] of enemyUnits) {
      spawnRegiment(state, 1, ut, x, z, -Math.PI * 0.5, { count: 20, noUpkeep: true, scenarioTag: 'm1_invader' });
    }
    pushAlert(state, 0, 'missionInfo', 86, 0, 'M1: Pay 600g / 200 bread / 40 weapons within 30 min');
  } else if (missionId === 2) {
    // Mission 2: Camp Across the River — 3 camp regiments + 2 flanking raiding detachments
    spawnRegiment(state, 1, 'swordsmen', 92, 0, -Math.PI * 0.5, { count: 16, noUpkeep: true, scenarioTag: 'm2_camp' });
    spawnRegiment(state, 1, 'pikemen', 92, 12, -Math.PI * 0.5, { count: 16, noUpkeep: true, scenarioTag: 'm2_camp' });
    spawnRegiment(state, 1, 'crossbowmen', 106, 6, -Math.PI * 0.5, { count: 14, noUpkeep: true, scenarioTag: 'm2_camp' });
    spawnRegiment(state, 1, 'lightCav', 135, -105, -Math.PI * 0.5, { count: 10, noUpkeep: true, scenarioTag: 'm2_raider_n' });
    spawnRegiment(state, 1, 'lightCav', 135, 110, -Math.PI * 0.5, { count: 10, noUpkeep: true, scenarioTag: 'm2_raider_s' });
    if (state.regiments.filter((r) => r.side === 0).length === 0) {
      spawnRegiment(state, 0, 'swordsmen', px + 26, pz - 8, Math.PI * 0.5, { count: 16 });
      spawnRegiment(state, 0, 'pikemen', px + 26, pz + 8, Math.PI * 0.5, { count: 16 });
      spawnRegiment(state, 0, 'archers', px + 14, pz, Math.PI * 0.5, { count: 16 });
    }
    pushAlert(state, 0, 'missionInfo', 92, 6, 'M2: Clear the enemy war camp across the river');
  } else if (missionId === 3) {
    // Mission 3: Retaking the Village (Valley) — 5 enemy regiments + 4-crossbow tower at central village (x=118)
    const vx = 118;
    const vz = 0;
    const defs: readonly [UnitTypeId, number, number][] = [
      ['swordsmen', vx - 14, vz - 6],
      ['pikemen', vx - 14, vz + 8],
      ['halberdiers', vx + 4, vz - 10],
      ['crossbowmen', vx + 8, vz + 8],
      ['archers', vx + 16, vz],
    ];
    for (const [ut, x, z] of defs) {
      spawnRegiment(state, 1, ut, x, z, -Math.PI * 0.5, { count: 16, noUpkeep: true, scenarioTag: 'm3_garrison' });
    }
    // Garrison village watchtower with 4 crossbowmen
    const vTower = state.buildings.find((b) => b.type === 'watchtower' && Math.hypot(b.x - vx, b.z - vz) < 40);
    if (vTower) {
      vTower.side = 1;
      vTower.garrisonType = 'crossbowmen';
      vTower.garrisonCount = 4;
    }
    pushAlert(state, 0, 'missionInfo', vx, vz, 'M3: Hold the central village square for 20 s');
  } else if (missionId === 4) {
    // Mission 4: Rebuilding & Great Army — central village & 6 half-price ruins belong to Player!
    const ruinTargets: readonly BuildingTypeId[] = ['house', 'house', 'house', 'bakery', 'windmill', 'market'];
    let rIdx = 0;
    for (const b of state.buildings) {
      if (b.x > 60 && b.x < 170) {
        b.side = 0;
        if (b.type === 'ruin') {
          b.ruinTargetType = ruinTargets[rIdx % ruinTargets.length]!;
          rIdx++;
        }
      }
    }
    pushAlert(state, 0, 'missionInfo', 118, 0, 'M4: Rebuild ruins, reach Keep L3 & 160 soldiers in 10 regiments');
  } else if (missionId === 5) {
    // Mission 5: The Fortress — 2x wall/gate HP, 2 crossbowmen per tower, indestructible Donżon,
    // player starts with carried-over army + 2 cannons + 2 mortars + barracks & gun foundry!
    for (const w of state.walls) {
      w.maxHp = Math.round(ECONOMY.wallSegmentHp * CAMPAIGN.m5WallHpMul);
      w.hp = w.maxHp;
    }
    for (const g of state.gates) {
      g.maxHp = Math.round(ECONOMY.gateHp * CAMPAIGN.m5WallHpMul);
      g.hp = g.maxHp;
    }
    for (const b of state.buildings) {
      if (b.side === 1 && b.type === 'watchtower') {
        b.garrisonType = 'crossbowmen';
        b.garrisonCount = 2;
      }
      if (b.side === 1 && b.type === 'keep') {
        b.indestructible = true;
        b.isFortressDonzon = true;
      }
    }

    // Ensure player siege battery: 2 cannons + 2 mortars + assault regiments if no carryOver!
    spawnRegiment(state, 0, 'cannon', -10, 88, Math.PI, { count: 2 });
    spawnRegiment(state, 0, 'cannon', 10, 88, Math.PI, { count: 2 });
    spawnRegiment(state, 0, 'mortar', -18, 98, Math.PI, { count: 1 });
    spawnRegiment(state, 0, 'mortar', 18, 98, Math.PI, { count: 1 });
    if (state.regiments.filter((r) => r.side === 0 && r.unitType !== 'cannon' && r.unitType !== 'mortar').length === 0) {
      const defaults: readonly [UnitTypeId, number, number][] = [
        ['swordsmen', -24, 68],
        ['swordsmen', 24, 68],
        ['pikemen', -12, 74],
        ['halberdiers', 12, 74],
        ['crossbowmen', 0, 80],
        ['heavyCav', -34, 82],
      ];
      for (const [ut, x, z] of defaults) {
        spawnRegiment(state, 0, ut, x, z, Math.PI, { count: 20 });
      }
    }

    // Fortress Defenders: outer bailey garrison, gate sortie force, and 2 elite Courtyard Heavy Cav Guard!
    spawnRegiment(state, 1, 'heavyCav', -12, -26, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_guard' });
    spawnRegiment(state, 1, 'heavyCav', 12, -26, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_guard' });
    spawnRegiment(state, 1, 'heavyCav', -16, 12, 0, { count: 12, noUpkeep: true, scenarioTag: 'm5_sortie' });
    spawnRegiment(state, 1, 'swordsmen', 16, 12, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_sortie' });
    spawnRegiment(state, 1, 'pikemen', -32, -10, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_bailey' });
    spawnRegiment(state, 1, 'halberdiers', 32, -10, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_bailey' });
    spawnRegiment(state, 1, 'crossbowmen', 0, -2, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_bailey' });

    pushAlert(state, 0, 'missionInfo', 0, -48, 'M5: Breach the twin walls and defeat the Courtyard Guard');
  }
}

function orderRegimentsTo(regs: readonly RegimentEntity[], x: number, z: number, targetBldId?: number): void {
  for (const r of regs) {
    if (r.routing || countAliveSoldiers(r) === 0) continue;
    r.order = {
      kind: 'attack',
      x,
      z,
      targetBuildingId: targetBldId,
    };
    r.path = [];
  }
}

/** Steps scenario triggers, Tutorial auto-steps, Defence waves, Campaign M1–M5 & victory/defeat evaluation! */
export function stepScenario(state: SimWorldState, dtS: number): void {
  const sc = state.scenario;
  if (sc.outcome !== 'playing') return;

  const p0Keep = findKeep(state, 0);
  const p1Keep = findKeep(state, 1);

  // 1. Tutorial 7 state-driven auto-completing steps (BRIEF.md F20)
  if (sc.mode === 'tutorial') {
    const p0Blds = state.buildings.filter((b) => b.side === 0 && b.hp > 0);
    const has = (t: BuildingTypeId) => p0Blds.some((b) => b.type === t);
    const checks: Record<string, boolean> = {
      buildWoodcutter: has('woodcutter'),
      buildFarmAndHouse: has('farm') && has('house'),
      buildMillAndBakery: has('windmill') && has('bakery'),
      buildQuarry: has('quarry'),
      recruitMilitia: state.regiments.some((r) => r.side === 0) || p0Blds.some((b) => b.recruitQueue.length > 0),
      moveRegiment: state.regiments.some((r) => r.side === 0 && (r.order !== null || r.soldiers.some((s) => s.travelM > 4))),
      buildBarracks: has('barracks'),
    };
    let allDone = true;
    for (let i = 0; i < sc.tutorialSteps.length; i++) {
      const step = sc.tutorialSteps[i]!;
      if (!step.completed && checks[step.id]) {
        sc.tutorialSteps[i] = { id: step.id, completed: true };
      }
      if (!sc.tutorialSteps[i]!.completed) allDone = false;
    }
    if (allDone) {
      sc.outcome = 'victory';
      sc.outcomeReason = 'tutorialComplete';
      sc.starsEarned = 3;
    }
    if (!p0Keep) {
      sc.outcome = 'defeat';
      sc.outcomeReason = 'keepLost';
    }
    return;
  }

  // 2. Defence mode: 10 escalating waves every 4 min from min 7, win at 30 min!
  if (sc.mode === 'defence') {
    if (!p0Keep) {
      sc.outcome = 'defeat';
      sc.outcomeReason = 'keepLost';
      return;
    }
    if (state.timeS >= sc.nextWaveTimeS && sc.waveIndex < 10) {
      sc.waveIndex++;
      sc.nextWaveTimeS = state.timeS + CAMPAIGN.defenceWaveIntervalS;
      const sx = -p0Keep.x > 0 ? 195 : -195;
      const sz = 0;
      const waveCount = Math.min(6, 1 + Math.ceil(sc.waveIndex * 0.6));
      const pool: readonly UnitTypeId[] =
        sc.waveIndex <= 2
          ? ['pikemen', 'archers']
          : sc.waveIndex <= 5
            ? ['swordsmen', 'crossbowmen', 'lightCav']
            : ['swordsmen', 'halberdiers', 'heavyCav', 'crossbowmen'];
      const spawned: RegimentEntity[] = [];
      for (let k = 0; k < waveCount; k++) {
        const ut = pool[(sc.waveIndex + k) % pool.length]!;
        spawned.push(spawnRegiment(state, 1, ut, sx, sz + (k - waveCount * 0.5) * 14, Math.atan2(p0Keep.x - sx, p0Keep.z - sz), { noUpkeep: true }));
      }
      orderRegimentsTo(spawned, p0Keep.x, p0Keep.z, p0Keep.id);
      pushAlert(state, 0, 'waveIncoming', sx, sz, `Wave ${sc.waveIndex}/10`);
    }
    if (state.timeS >= CAMPAIGN.defenceWinTimeS) {
      sc.outcome = 'victory';
      sc.outcomeReason = 'defenceSurvived';
      sc.starsEarned = state.sides[0].buildingsLost === 0 ? 3 : state.sides[0].totalLosses < 40 ? 2 : 1;
    }
    return;
  }

  // 3. Campaign Missions 1–5
  if (sc.mode === 'campaign' && sc.missionId !== null) {
    const m = sc.missionId;

    if (m === 1) {
      if (!p0Keep) {
        sc.outcome = 'defeat';
        sc.outcomeReason = 'keepLost';
        return;
      }
      if (state.sides[0].tributePaid) {
        sc.outcome = 'victory';
        sc.outcomeReason = 'tributePaid';
        const p0Regs = state.regiments.filter((r) => r.side === 0 && countAliveSoldiers(r) > 0).length;
        sc.starsEarned = p0Regs >= 4 ? 3 : 2;
        return;
      }
      // Deadline elapsed -> 200-man invader host assaults player town!
      if (state.timeS >= CAMPAIGN.m1DeadlineS) {
        if (!sc.firedTriggers.includes('m1_assault')) {
          sc.firedTriggers.push('m1_assault');
          const invaders = state.regiments.filter((r) => r.side === 1);
          orderRegimentsTo(invaders, p0Keep.x, p0Keep.z, p0Keep.id);
          pushAlert(state, 0, 'enemyAtKeep', p0Keep.x, p0Keep.z, 'Tribute deadline expired — invader host attacks!');
        }
        const activeInvaders = state.regiments.filter((r) => r.side === 1 && !r.routing && countAliveSoldiers(r) > 0);
        if (activeInvaders.length === 0) {
          sc.allEnemyRoutingS += dtS;
          if (sc.allEnemyRoutingS >= CAMPAIGN.routWinS || state.regiments.filter((r) => r.side === 1).length === 0) {
            sc.outcome = 'victory';
            sc.outcomeReason = 'invadersDefeated';
            sc.starsEarned = 3;
          }
        } else {
          sc.allEnemyRoutingS = 0;
        }
      }
      return;
    }

    if (m === 2) {
      if (!p0Keep) {
        sc.outcome = 'defeat';
        sc.outcomeReason = 'keepLost';
        return;
      }
      // Flanking raiders return to reinforce the camp at min 5 and min 10!
      if (state.timeS >= 300 && !sc.firedTriggers.includes('m2_raider_n')) {
        sc.firedTriggers.push('m2_raider_n');
        orderRegimentsTo(state.regiments.filter((r) => r.scenarioTag === 'm2_raider_n'), 96, 4);
      }
      if (state.timeS >= 600 && !sc.firedTriggers.includes('m2_raider_s')) {
        sc.firedTriggers.push('m2_raider_s');
        orderRegimentsTo(state.regiments.filter((r) => r.scenarioTag === 'm2_raider_s'), 96, 8);
      }
      const campEnemies = state.regiments.filter(
        (r) => r.side === 1 && countAliveSoldiers(r) > 0 && Math.hypot(r.x - 96, r.z - 6) < 65,
      );
      if (campEnemies.length === 0 && state.timeS > 5) {
        sc.outcome = 'victory';
        sc.outcomeReason = 'campCleared';
        const totalInitial = Math.max(1, state.sides[0].totalLosses + state.regiments.filter((r) => r.side === 0).reduce((s, r) => s + countAliveSoldiers(r), 0));
        sc.starsEarned = state.sides[0].totalLosses / totalInitial < 0.3 ? 3 : 2;
      }
      return;
    }

    if (m === 3) {
      if (!p0Keep) {
        sc.outcome = 'defeat';
        sc.outcomeReason = 'keepLost';
        return;
      }
      // Min 12 enemy relief arrives from east mountain pass
      if (state.timeS >= CAMPAIGN.m3ReliefTimeS && !sc.firedTriggers.includes('m3_relief')) {
        sc.firedTriggers.push('m3_relief');
        const relief = [
          spawnRegiment(state, 1, 'heavyCav', 210, -8, -Math.PI * 0.5, { count: 16, noUpkeep: true, scenarioTag: 'm3_relief' }),
          spawnRegiment(state, 1, 'swordsmen', 216, 4, -Math.PI * 0.5, { count: 16, noUpkeep: true, scenarioTag: 'm3_relief' }),
          spawnRegiment(state, 1, 'crossbowmen', 222, 12, -Math.PI * 0.5, { count: 16, noUpkeep: true, scenarioTag: 'm3_relief' }),
        ];
        orderRegimentsTo(relief, 118, 0);
        pushAlert(state, 0, 'waveIncoming', 210, 0, 'Enemy relief force enters the eastern pass!');
      }
      // +3 min after relief: if village still enemy-held, march on player town!
      if (state.timeS >= CAMPAIGN.m3ReliefTimeS + CAMPAIGN.m3MarchDelayS && !sc.firedTriggers.includes('m3_march')) {
        sc.firedTriggers.push('m3_march');
        orderRegimentsTo(state.regiments.filter((r) => r.side === 1), p0Keep.x, p0Keep.z, p0Keep.id);
      }
      // Win when central village capture point is held by Player for 20 s!
      const villageCp = state.capturePoints.find((cp) => cp.kind === 'village') ?? state.capturePoints[0];
      if (villageCp && villageCp.owner === 0) {
        // Flip surviving central village buildings to player!
        for (const b of state.buildings) {
          if (Math.hypot(b.x - villageCp.x, b.z - villageCp.z) < 48 && b.hp > 0) b.side = 0;
        }
        sc.outcome = 'victory';
        sc.outcomeReason = 'villageRetaken';
        sc.starsEarned = state.timeS < CAMPAIGN.m3ReliefTimeS ? 3 : 2;
      }
      return;
    }

    if (m === 4) {
      if (!p0Keep) {
        sc.outcome = 'defeat';
        sc.outcomeReason = 'keepLost';
        return;
      }
      // Raids of 2, 3, and 4 full regiments at min 8, 16, 24!
      const raidSizes = [2, 3, 4] as const;
      for (let i = 0; i < 3; i++) {
        const key = `m4_raid_${i}`;
        if (state.timeS >= CAMPAIGN.m4RaidTimesS[i]! && !sc.firedTriggers.includes(key)) {
          sc.firedTriggers.push(key);
          const spawned: RegimentEntity[] = [];
          const types: readonly UnitTypeId[] = ['swordsmen', 'crossbowmen', 'heavyCav', 'halberdiers'];
          for (let k = 0; k < raidSizes[i]!; k++) {
            spawned.push(spawnRegiment(state, 1, types[k % types.length]!, 215, -14 + k * 12, -Math.PI * 0.5, { count: 16, noUpkeep: true }));
          }
          orderRegimentsTo(spawned, p0Keep.x, p0Keep.z, p0Keep.id);
          pushAlert(state, 0, 'waveIncoming', 215, 0, `Raid ${i + 1}/3 advancing down the valley!`);
        }
      }
      // Win: Keep L3 AND >= 160 soldiers in >= 10 regiments!
      const p0Regs = state.regiments.filter((r) => r.side === 0 && countAliveSoldiers(r) > 0);
      const totalMen = p0Regs.reduce((s, r) => s + countAliveSoldiers(r), 0);
      if (p0Keep.level >= 3 && p0Regs.length >= CAMPAIGN.m4TargetRegiments && totalMen >= CAMPAIGN.m4TargetMen) {
        sc.outcome = 'victory';
        sc.outcomeReason = 'greatArmyRaised';
        sc.starsEarned = state.sides[0].buildingsLost === 0 ? 3 : 2;
      }
      return;
    }

    if (m === 5) {
      // Loss: camp lost (Keep destroyed) OR 60 s with zero living player regiments!
      const p0Regs = state.regiments.filter((r) => r.side === 0 && countAliveSoldiers(r) > 0);
      if (!p0Keep) {
        sc.outcome = 'defeat';
        sc.outcomeReason = 'campLost';
        return;
      }
      if (p0Regs.length === 0) {
        sc.playerNoRegimentsS += dtS;
        if (sc.playerNoRegimentsS >= 60) {
          sc.outcome = 'defeat';
          sc.outcomeReason = 'armyLost';
          return;
        }
      } else {
        sc.playerNoRegimentsS = 0;
      }

      // Trigger 1: Gate sortie when any player cannon/mortar comes within 230 m of Donżon (0, -48)!
      if (!sc.firedTriggers.includes('m5_sortie')) {
        const gunNear = p0Regs.find(
          (r) => (r.unitType === 'cannon' || r.unitType === 'mortar') && Math.hypot(r.x - 0, r.z - -48) <= CAMPAIGN.m5SortieTriggerM,
        );
        if (gunNear) {
          sc.firedTriggers.push('m5_sortie');
          orderRegimentsTo(state.regiments.filter((r) => r.scenarioTag === 'm5_sortie'), gunNear.x, gunNear.z);
          pushAlert(state, 0, 'enemyInVillage', gunNear.x, gunNear.z, 'Fortress sortie charging your siege guns!');
        }
      }

      // Trigger 2: Min 15 rear relief force behind player camp!
      if (state.timeS >= CAMPAIGN.m5ReliefTimeS && !sc.firedTriggers.includes('m5_relief')) {
        sc.firedTriggers.push('m5_relief');
        const relief = [
          spawnRegiment(state, 1, 'heavyCav', -45, 225, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_relief' }),
          spawnRegiment(state, 1, 'swordsmen', 0, 228, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_relief' }),
          spawnRegiment(state, 1, 'crossbowmen', 45, 225, 0, { count: 16, noUpkeep: true, scenarioTag: 'm5_relief' }),
        ];
        orderRegimentsTo(relief, p0Keep.x, p0Keep.z, p0Keep.id);
        pushAlert(state, 0, 'waveIncoming', 0, 225, 'Enemy relief army arrives behind your camp!');
      }

      // Trigger 3: Enemy interior Barracks spawns 1 regiment every 5 min while standing!
      const spawnIdx = Math.floor(state.timeS / CAMPAIGN.m5BarracksSpawnS);
      if (spawnIdx >= 1 && !sc.firedTriggers.includes(`m5_bar_${spawnIdx}`)) {
        const enemyBar = state.buildings.find((b: BuildingEntity) => b.side === 1 && b.type === 'barracks' && b.hp > 0);
        if (enemyBar) {
          sc.firedTriggers.push(`m5_bar_${spawnIdx}`);
          const rot: readonly UnitTypeId[] = ['swordsmen', 'crossbowmen', 'pikemen'];
          spawnRegiment(state, 1, rot[spawnIdx % 3]!, enemyBar.x, enemyBar.z + 8, 0, { count: 14, noUpkeep: true });
        }
      }

      // Victory: Courtyard Guard defeated!
      const guardsAlive = state.regiments.filter((r) => r.scenarioTag === 'm5_guard' && countAliveSoldiers(r) > 0);
      if (guardsAlive.length === 0) {
        sc.outcome = 'victory';
        sc.outcomeReason = 'fortressCaptured';
        const fastBreachAndGunsSafe =
          sc.fortressBreachedAtS !== null &&
          sc.fortressBreachedAtS <= CAMPAIGN.m5BreachStarTimeS &&
          sc.playerCannonsLost === 0;
        sc.starsEarned = fastBreachAndGunsSafe ? 3 : 2;
      }
      return;
    }
  }

  // 4. Skirmish victory / defeat: lose Keep -> defeat; destroy enemy Keep -> victory!
  if (!p0Keep) {
    sc.outcome = 'defeat';
    sc.outcomeReason = 'keepLost';
  } else if (!p1Keep) {
    sc.outcome = 'victory';
    sc.outcomeReason = 'enemyKeepDestroyed';
    sc.starsEarned = state.sides[0].buildingsLost === 0 ? 3 : 2;
  }
}
