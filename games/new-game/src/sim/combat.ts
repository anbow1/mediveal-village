// Pure-TS Deterministic Regiment Combat, Formations, Morale, Ballistics, Siege & Capture Engine (zero three.js).
// Matches docs/UNITS.md, docs/GAMEPLAY.md §5–§6, and BRIEF.md F15–F17.

import {
  BUILDING_DEFS,
  COMBAT,
  ECONOMY,
  STANCES,
  UNIT_DEFS,
  type GoodId,
  type ResourceMap,
  type UnitTypeId,
} from '../config.ts';
import { consumeRationsFromStock, findKeep, recordConsumed, recordProduced, spawnCitizen } from './economy.ts';
import type { NavGrid } from './pathing.ts';
import type { TerrainField } from './terrain.ts';
import type {
  BuildingEntity,
  FormationKind,
  GateEntity,
  RegimentEntity,
  SideId,
  SimWorldState,
  SoldierEntity,
  WallSegmentEntity,
} from './types.ts';

/** Deterministic seeded PRNG step mutating `state.rngState` (xorshift32). */
export function nextSimRand(state: SimWorldState): number {
  let x = state.rngState | 0;
  if (x === 0) x = 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.rngState = x >>> 0;
  return state.rngState / 4294967296;
}

export function normalizeAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export function countAliveSoldiers(reg: RegimentEntity): number {
  let n = 0;
  for (const s of reg.soldiers) if (s.alive) n++;
  return n;
}

export function countSideArmyMen(state: SimWorldState, side: SideId): number {
  let n = 0;
  for (const reg of state.regiments) {
    if (reg.side !== side) continue;
    const def = UNIT_DEFS[reg.unitType];
    const alive = countAliveSoldiers(reg);
    if (alive <= 0) continue;
    n += def.unitClass === 'siege' ? Math.ceil((alive / def.count) * def.crewCount) : alive;
  }
  // Garrisoned archers/crossbowmen on watchtowers count toward the army limit (FPS/marchland menAlive)
  for (const b of state.buildings) {
    if (b.side === side && b.hp > 0 && b.type === 'watchtower' && b.garrisonCount > 0) {
      n += b.garrisonCount;
    }
  }
  return n;
}

export function getArmyCap(state: SimWorldState): number {
  return state.scenario.mode === 'campaign' ? COMBAT.campaignArmyCap : COMBAT.skirmishArmyCap;
}

export function getRegimentMaxMen(state: SimWorldState, unitType: UnitTypeId): number {
  const def = UNIT_DEFS[unitType];
  if (def.unitClass === 'siege') return def.count;
  if (state.scenario.mode === 'campaign') return COMBAT.campaignRegimentMaxMen;
  return def.count;
}

/** Computes target local (right, forward) formation offsets for each soldier slot. */
export function computeFormationSlotOffset(
  slotIdx: number,
  totalAlive: number,
  width: number,
  formation: FormationKind,
  unitClass: 'infantry' | 'ranged' | 'cavalry' | 'siege',
): { right: number; forward: number } {
  const baseSpacing = unitClass === 'cavalry' ? 2.15 : unitClass === 'siege' ? 4.4 : 1.48;
  const spacing = formation === 'loose' ? baseSpacing * 1.65 : formation === 'schiltron' ? baseSpacing * 0.88 : baseSpacing;

  if (formation === 'schiltron') {
    const ring = Math.floor(slotIdx / 8);
    const inRing = slotIdx % 8;
    const ringCount = Math.min(8, Math.max(1, totalAlive - ring * 8));
    const angle = (inRing / ringCount) * Math.PI * 2;
    const rad = (ring + 1) * spacing * 1.05;
    return { right: Math.cos(angle) * rad, forward: Math.sin(angle) * rad };
  }

  if (formation === 'wedge') {
    // Triangular spearhead: row 0 = 1 man, row 1 = 2 men, row 2 = 3 men...
    let row = 0;
    let acc = 0;
    while (acc + row + 1 <= slotIdx) {
      acc += row + 1;
      row++;
    }
    const col = slotIdx - acc;
    const colsInRow = row + 1;
    return {
      right: (col - (colsInRow - 1) * 0.5) * spacing * 0.95,
      forward: -row * spacing * 1.1 + spacing,
    };
  }

  const effWidth =
    formation === 'column'
      ? Math.max(2, Math.min(4, width))
      : Math.max(1, Math.min(12, Math.min(width, totalAlive)));
  const row = Math.floor(slotIdx / effWidth);
  const col = slotIdx % effWidth;
  const colsInRow = Math.min(effWidth, totalAlive - row * effWidth);
  const totalRows = Math.ceil(totalAlive / effWidth);
  return {
    right: (col - (colsInRow - 1) * 0.5) * spacing,
    forward: ((totalRows - 1) * 0.5 - row) * spacing * (formation === 'column' ? 1.18 : 1.0),
  };
}

/** Spawns a fresh regiment of `unitType` at `(x, z)` facing `yawRad`. */
export function spawnRegiment(
  state: SimWorldState,
  side: SideId,
  unitType: UnitTypeId,
  x: number,
  z: number,
  yawRad: number,
  opts?: {
    count?: number;
    kills?: number;
    veteranTier?: 0 | 1 | 2;
    noUpkeep?: boolean;
    scenarioTag?: string;
    formation?: FormationKind;
  },
): RegimentEntity {
  const def = UNIT_DEFS[unitType];
  const count = opts?.count ?? def.count;
  const maxMen = Math.max(count, getRegimentMaxMen(state, unitType));
  const width = Math.max(1, Math.min(def.unitClass === 'cavalry' ? 4 : def.unitClass === 'siege' ? 2 : 6, count));
  const formation = opts?.formation ?? 'line';
  const soldiers: SoldierEntity[] = [];

  const fx = Math.sin(yawRad);
  const fz = Math.cos(yawRad);
  const rx = Math.cos(yawRad);
  const rz = -Math.sin(yawRad);

  for (let i = 0; i < count; i++) {
    const off = computeFormationSlotOffset(i, count, width, formation, def.unitClass);
    soldiers.push({
      slotIndex: i,
      alive: true,
      hp: def.hp,
      maxHp: def.hp,
      x: x + rx * off.right + fx * off.forward,
      z: z + rz * off.right + fz * off.forward,
      yawRad,
      travelM: nextSimRand(state) * 2.0,
      clip: 'idle',
      attackAnimTimerS: 0,
      meleeCooldownS: nextSimRand(state) * 0.8,
      rangedCooldownS: nextSimRand(state) * 1.2,
      tintVar: 0.92 + nextSimRand(state) * 0.16,
    });
  }

  const vetTier = opts?.veteranTier ?? 0;
  const maxMorale = def.morale + vetTier * COMBAT.vetMaxMoraleBonusPerTier;

  const reg: RegimentEntity = {
    id: state.nextEntityId++,
    side,
    unitType,
    x,
    z,
    yawRad,
    formation,
    stance: 'guard',
    holdFire: false,
    width,
    maxMen,
    soldiers,
    captainAlive: def.unitClass !== 'siege',
    morale: maxMorale,
    maxMorale,
    fatigue: 0,
    routing: false,
    kills: opts?.kills ?? 0,
    veteranTier: vetTier,
    currentSpeedMs: 0,
    chargeTimerS: 0,
    outOfCombatS: 10,
    order: null,
    orderQueue: [],
    path: [],
    refittingTo: null,
    refitTimerS: 0,
    reinforceTimerS: 0,
    garrisonedInBuildingId: null,
    noUpkeep: opts?.noUpkeep,
    scenarioTag: opts?.scenarioTag,
  };
  state.regiments.push(reg);
  return reg;
}

/** Updates veteran tier from kills per man (0.6 -> Tier 1, 1.5 -> Tier 2 per GAMEPLAY.md §6). */
export function refreshRegimentStats(state: SimWorldState, reg: RegimentEntity): void {
  const def = UNIT_DEFS[reg.unitType];
  const alive = Math.max(1, countAliveSoldiers(reg));
  const kpm = reg.kills / alive;
  if (kpm >= COMBAT.vetTier2KillsPerMan) reg.veteranTier = 2;
  else if (kpm >= COMBAT.vetTier1KillsPerMan) reg.veteranTier = 1;
  else reg.veteranTier = 0;

  const sideState = state.sides[reg.side];
  let maxM = def.morale + reg.veteranTier * COMBAT.vetMaxMoraleBonusPerTier;
  if (!reg.captainAlive && def.unitClass !== 'siege') maxM -= COMBAT.missingCaptainMaxMoralePenalty;
  if (sideState.hasChapel) maxM += ECONOMY.chapelMoraleBonus;
  if (sideState.armyStarving && !reg.noUpkeep) maxM -= ECONOMY.starvingArmyMoralePenalty;
  if (sideState.unpaidPenaltyActive && !reg.noUpkeep) maxM -= COMBAT.unpaidMoralePenalty;
  if (reg.formation === 'loose') maxM -= 6;
  reg.maxMorale = Math.max(12, maxM);
  if (reg.morale > reg.maxMorale) reg.morale = reg.maxMorale;
}

/** Classifies attack arc relative to defender's facing (`front`, `flank`, or `rear`). */
export function classifyAttackArc(
  attackerX: number,
  attackerZ: number,
  defender: RegimentEntity,
): 'front' | 'flank' | 'rear' {
  // Schiltron has all-round frontage against cavalry and infantry!
  if (defender.formation === 'schiltron') return 'front';
  const toAttX = attackerX - defender.x;
  const toAttZ = attackerZ - defender.z;
  const len = Math.hypot(toAttX, toAttZ);
  if (len < 1e-4) return 'front';
  const dfx = Math.sin(defender.yawRad);
  const dfz = Math.cos(defender.yawRad);
  const dot = (toAttX * dfx + toAttZ * dfz) / len;
  if (dot >= 0.45) return 'front';
  if (dot <= -0.45) return 'rear';
  return 'flank';
}

export function pushAlert(
  state: SimWorldState,
  side: SideId,
  kind: SimWorldState['alerts'][number]['kind'],
  x: number,
  z: number,
  detail: string,
): void {
  // Throttle duplicate alerts of the same kind within 20 s
  const recent = state.alerts.find((a) => a.side === side && a.kind === kind && state.timeS - a.timeS < 20);
  if (recent) return;
  state.alerts.push({
    id: state.nextAlertId++,
    timeS: state.timeS,
    side,
    kind,
    x,
    z,
    detail,
  });
  if (state.alerts.length > 24) state.alerts.shift();
}

function applyDamageToRegiment(
  state: SimWorldState,
  defender: RegimentEntity,
  attacker: RegimentEntity | null,
  rawDamage: number,
  armorPierce: number,
  isMissile: boolean,
  arc: 'front' | 'flank' | 'rear',
  extraMoraleShock = 0,
): number {
  const def = UNIT_DEFS[defender.unitType];
  const aliveList = defender.soldiers.filter((s) => s.alive);
  if (aliveList.length === 0) return 0;

  // Front-arc shield block for missiles (Shield Wall doubles arrow block, capped at 0.85)
  if (isMissile && arc === 'front' && def.shieldBlock > 0) {
    const effBlock =
      defender.stance === 'shieldWall'
        ? Math.min(0.85, def.shieldBlock * STANCES.shieldWall.arrowBlockMul)
        : def.shieldBlock;
    if (nextSimRand(state) < effBlock) return 0;
  }

  const effArmor = def.armour * (1 - armorPierce);
  const arcMul = arc === 'rear' ? COMBAT.rearDamageMul : arc === 'flank' ? COMBAT.flankDamageMul : 1.0;
  const dmg = Math.max(1, rawDamage * (1 - effArmor) * arcMul);

  // Pick a live soldier (weighted toward front ranks)
  const victim = aliveList[Math.floor(nextSimRand(state) * Math.min(aliveList.length, 6))] ?? aliveList[0]!;
  victim.hp -= dmg;
  victim.hurtAtS = state.timeS;

  let killed = 0;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.deadS = 0;
    killed = 1;
    state.sides[defender.side].totalLosses++;
    if (attacker) {
      attacker.kills++;
      state.sides[attacker.side].totalKills++;
    }

    // Captain survival roll when regiment loses soldiers (higher chance when below 50% strength)
    const remaining = aliveList.length - 1;
    if (defender.captainAlive && def.unitClass !== 'siege') {
      const capChance = remaining === 0 ? 1.0 : 1.0 / Math.max(3, remaining + 2);
      if (nextSimRand(state) < capChance) {
        defender.captainAlive = false;
        defender.morale = Math.max(0, defender.morale - COMBAT.captainDeathMoraleShock);
      }
    }

    // Morale drop proportional to casualty fraction
    const lossFrac = 1 / Math.max(1, defender.maxMen);
    const wedgeFlankExtra = defender.formation === 'wedge' && arc !== 'front' ? 1.35 : 1.0;
    defender.morale = Math.max(0, defender.morale - COMBAT.moraleLossPerCasualtyFrac * lossFrac * wedgeFlankExtra);

    // Track Mission 5 lost player cannons
    if (defender.side === 0 && (defender.unitType === 'cannon' || defender.unitType === 'mortar')) {
      state.scenario.playerCannonsLost++;
    }
  }

  if (extraMoraleShock > 0) {
    defender.morale = Math.max(0, defender.morale - extraMoraleShock);
  }
  defender.outOfCombatS = 0;

  if (!defender.routing && defender.morale <= COMBAT.routThresholdMorale && countAliveSoldiers(defender) > 0) {
    defender.routing = true;
    defender.order = null;
    defender.orderQueue = [];
    defender.path = [];
    pushAlert(state, defender.side, 'regimentRout', defender.x, defender.z, defender.unitType);
  }

  return killed;
}

/** Checks & advances recruitment queues at Keep, Barracks, and Gun Foundry. */
function stepRecruitmentQueues(state: SimWorldState, dtS: number): void {
  for (const b of state.buildings) {
    if (b.hp <= 0 || b.buildProgress < 1 || b.recruitQueue.length === 0) continue;
    const head = b.recruitQueue[0]!;
    if (head.arrivedCrew >= head.neededCrew) {
      head.trainTimerS += dtS;
      if (head.trainTimerS >= 2.0) {
        const fx = Math.sin(b.yawRad);
        const fz = Math.cos(b.yawRad);
        spawnRegiment(state, b.side, head.unitType, b.x + fx * 10, b.z + fz * 10, b.yawRad);
        b.recruitQueue.shift();
      }
    }
  }
}

/** Pays army upkeep (0.2 gold/man/min) and soldier food rations (0.25 rations/man/min) from Keep stock. */
function stepArmyLogistics(state: SimWorldState, dtS: number): void {
  for (const side of [0, 1] as const) {
    const s = state.sides[side];
    let payingMen = 0;
    for (const reg of state.regiments) {
      if (reg.side !== side || reg.noUpkeep) continue;
      const alive = countAliveSoldiers(reg);
      if (alive <= 0) continue;
      const def = UNIT_DEFS[reg.unitType];
      payingMen += def.unitClass === 'siege' ? Math.ceil((alive / def.count) * def.crewCount) : alive;
    }
    if (side === 0 || state.scenario.mode !== 'campaign') {
      for (const b of state.buildings) {
        if (b.side === side && b.hp > 0 && b.type === 'watchtower' && b.garrisonCount > 0) {
          payingMen += b.garrisonCount;
        }
      }
    }

    if (payingMen === 0) {
      s.armyStarving = false;
      s.unpaidUpkeepS = 0;
      s.unpaidPenaltyActive = false;
      continue;
    }

    // Soldier rations
    const needRations = (payingMen * ECONOMY.soldierRationsPerMin / 60) * dtS;
    const fed = consumeRationsFromStock(s, needRations);
    s.armyStarving = !fed;
    if (!fed) {
      const keep = findKeep(state, side);
      if (keep) pushAlert(state, side, 'hunger', keep.x, keep.z, 'army');
    }

    // Soldier gold upkeep
    const needGold = (payingMen * COMBAT.upkeepGoldPerManPerMin / 60) * dtS;
    if (s.stock.gold >= needGold) {
      s.stock.gold -= needGold;
      recordConsumed(s, 'gold', needGold);
      s.unpaidUpkeepS = Math.max(0, s.unpaidUpkeepS - dtS * 2);
      if (s.unpaidUpkeepS === 0) s.unpaidPenaltyActive = false;
    } else {
      s.stock.gold = 0;
      s.unpaidUpkeepS += dtS;
      if (s.unpaidUpkeepS >= COMBAT.unpaidGraceS) {
        s.unpaidPenaltyActive = true;
      }
    }
  }
}

/** Handles Keep & garrisoned Watchtower arrows plus automatic twin-leaf gate opening for friendlies. */
function stepFortifications(state: SimWorldState, dtS: number, terrain: TerrainField): void {
  // 1. Auto-opening friendly gates
  const openRadSq = ECONOMY.gateOpenRadiusM * ECONOMY.gateOpenRadiusM;
  for (const g of state.gates) {
    if (g.destroyed || g.hp <= 0) {
      g.openFraction = 1;
      continue;
    }
    let friendlyNear = false;
    for (const c of state.citizens) {
      if (c.side === g.side && (c.x - g.x) * (c.x - g.x) + (c.z - g.z) * (c.z - g.z) <= openRadSq) {
        friendlyNear = true;
        break;
      }
    }
    if (!friendlyNear) {
      for (const r of state.regiments) {
        if (r.side === g.side && countAliveSoldiers(r) > 0 && (r.x - g.x) * (r.x - g.x) + (r.z - g.z) * (r.z - g.z) <= openRadSq * 1.6) {
          friendlyNear = true;
          break;
        }
      }
    }
    const targetOpen = friendlyNear ? 1 : 0;
    g.openFraction += (targetOpen - g.openFraction) * Math.min(1, dtS * 4.5);
  }

  // 2. Keep & Watchtower defensive missile fire
  for (const b of state.buildings) {
    if (b.hp <= 0 || b.buildProgress < 1) continue;
    if (b.type !== 'keep' && b.type !== 'watchtower') continue;

    let rangeM = 0;
    let reloadS = 1.0;
    let dmg = 9;
    let ap = 0;
    let shots = 1;
    let kind: 'arrow' | 'bolt' = 'arrow';

    if (b.type === 'keep') {
      const kLvl = ECONOMY.keepLevels[b.level - 1]!;
      rangeM = kLvl.arrowRangeM;
      reloadS = kLvl.arrowIntervalS;
      dmg = kLvl.arrowDamage;
    } else if (b.garrisonCount > 0 && b.garrisonType) {
      const uDef = UNIT_DEFS[b.garrisonType];
      if (!uDef.ranged) continue;
      rangeM = uDef.ranged.maxRangeM + ECONOMY.watchtowerRangeBonusM;
      // FPS/marchland stepTowers: garrisoned men fire one after another from the battlements
      reloadS = uDef.ranged.reloadS / Math.max(1, b.garrisonCount);
      dmg = uDef.ranged.damage;
      ap = uDef.ranged.armorPierce;
      shots = 1;
      kind = b.garrisonType === 'crossbowmen' ? 'bolt' : 'arrow';
    } else {
      continue;
    }

    b.fireCooldownS -= dtS;
    if (b.fireCooldownS > 0) continue;

    // Nearest enemy regiment in range
    let target: RegimentEntity | null = null;
    let bestDist = rangeM;
    for (const reg of state.regiments) {
      if (reg.side === b.side || reg.garrisonedInBuildingId !== null || countAliveSoldiers(reg) === 0) continue;
      const d = Math.hypot(reg.x - b.x, reg.z - b.z);
      if (d <= bestDist) {
        bestDist = d;
        target = reg;
      }
    }
    if (!target) continue;

    b.fireCooldownS = reloadS;
    const sy = terrain.heightAt(b.x, b.z) + (b.type === 'keep' ? 7.5 : 8.5);
    const ty = terrain.heightAt(target.x, target.z) + 1.1;
    const speed = kind === 'bolt' ? 48 : 38;
    const flightS = Math.max(0.25, bestDist / speed);

    for (let i = 0; i < shots; i++) {
      state.projectiles.push({
        id: state.nextEntityId++,
        side: b.side,
        kind,
        sourceRegimentId: null,
        x: b.x,
        y: sy,
        z: b.z,
        startX: b.x,
        startY: sy,
        startZ: b.z,
        targetX: target.x + (nextSimRand(state) - 0.5) * 3.0,
        targetY: ty,
        targetZ: target.z + (nextSimRand(state) - 0.5) * 3.0,
        flightTimeS: flightS,
        elapsedS: 0,
        arcHeightM: kind === 'bolt' ? Math.min(5, bestDist * 0.06) : Math.min(14, bestDist * 0.16),
        damage: dmg,
        armorPierce: ap,
        splashRadiusM: 0,
        buildingDamage: 0,
        targetRegimentId: target.id,
        targetBuildingId: null,
        targetWallId: null,
        shooterAccuracyMul: 1.15,
      });
    }
  }
}

/** Updates 3 strategic capture points (20 s uncontested within 30 m -> mine/quarry/village income!). */
function stepCapturePoints(state: SimWorldState, dtS: number): void {
  const radSq = COMBAT.captureRadiusM * COMBAT.captureRadiusM;
  for (const cp of state.capturePoints) {
    let has0 = false;
    let has1 = false;
    for (const reg of state.regiments) {
      if (reg.routing || reg.garrisonedInBuildingId !== null || countAliveSoldiers(reg) === 0) continue;
      const dSq = (reg.x - cp.x) * (reg.x - cp.x) + (reg.z - cp.z) * (reg.z - cp.z);
      if (dSq <= radSq) {
        if (reg.side === 0) has0 = true;
        else has1 = true;
      }
    }

    if (has0 && !has1) {
      if (cp.owner !== 0) {
        if (cp.capturingSide !== 0) {
          cp.capturingSide = 0;
          cp.captureProgressS = 0;
        }
        cp.captureProgressS += dtS;
        if (cp.captureProgressS >= COMBAT.captureTimeS) {
          cp.owner = 0;
          cp.capturingSide = null;
          cp.captureProgressS = 0;
          pushAlert(state, 0, 'pointCaptured', cp.x, cp.z, cp.label);
        }
      }
    } else if (has1 && !has0) {
      if (cp.owner !== 1) {
        if (cp.capturingSide !== 1) {
          cp.capturingSide = 1;
          cp.captureProgressS = 0;
        }
        cp.captureProgressS += dtS;
        if (cp.captureProgressS >= COMBAT.captureTimeS) {
          cp.owner = 1;
          cp.capturingSide = null;
          cp.captureProgressS = 0;
          pushAlert(state, 1, 'pointCaptured', cp.x, cp.z, cp.label);
        }
      }
    } else if (has0 && has1) {
      // Contested: progress pauses (nobody captures)
    } else {
      cp.captureProgressS = Math.max(0, cp.captureProgressS - dtS * 0.5);
    }

    if (cp.owner !== null) {
      const income: ResourceMap = COMBAT.captureIncomePerMin[cp.kind];
      const s = state.sides[cp.owner];
      for (const g of Object.keys(income) as GoodId[]) {
        const amt = ((income[g] ?? 0) / 60) * dtS;
        s.stock[g] = (s.stock[g] ?? 0) + amt;
        recordProduced(s, g, amt);
      }
    }
  }
}

/** Steps ballistic projectiles in flight and resolves ground/regiment/wall/building impacts. */
function stepProjectiles(state: SimWorldState, dtS: number, nav: NavGrid): boolean {
  let navDirty = false;
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i]!;
    p.elapsedS += dtS;
    const t = Math.min(1, p.elapsedS / Math.max(0.05, p.flightTimeS));
    p.x = p.startX + (p.targetX - p.startX) * t;
    p.z = p.startZ + (p.targetZ - p.startZ) * t;
    p.y = p.startY + (p.targetY - p.startY) * t + 4 * p.arcHeightM * t * (1 - t);

    if (t < 1) continue;

    // Resolve impact!
    const shooter = p.sourceRegimentId !== null ? state.regiments.find((r) => r.id === p.sourceRegimentId) ?? null : null;

    if (p.kind === 'mortar' || p.kind === 'cannonball') {
      state.fxEvents.push({
        kind: 'mortarImpact',
        x: p.targetX,
        y: p.targetY,
        z: p.targetZ,
        intensity: p.kind === 'mortar' ? 1.4 : 1.0,
      });
    }

    // 1. Direct building damage
    if (p.targetBuildingId !== null && p.buildingDamage > 0) {
      const b = state.buildings.find((x) => x.id === p.targetBuildingId);
      if (b && b.hp > 0 && !b.indestructible) {
        b.hp = Math.max(0, b.hp - p.buildingDamage);
        if (b.hp <= 0) {
          state.sides[b.side].buildingsLost++;
          pushAlert(state, b.side, 'buildingLost', b.x, b.z, b.type);
          navDirty = true;
          state.visualRevision++;
        }
      }
    }

    // 2. Direct wall / gate siege damage
    if (p.targetWallId !== null && p.buildingDamage > 0) {
      const w = state.walls.find((x) => x.id === p.targetWallId);
      if (w && !w.destroyed && w.hp > 0) {
        w.hp = Math.max(0, w.hp - p.buildingDamage);
        if (w.hp <= 0) {
          w.destroyed = true;
          navDirty = true;
          state.visualRevision++;
          if (state.scenario.fortressBreachedAtS === null) state.scenario.fortressBreachedAtS = state.timeS;
          pushAlert(state, w.side, 'wallBreached', w.x, w.z, 'wall');
          state.fxEvents.push({ kind: 'wallCollapse', x: w.x, y: p.targetY, z: w.z, intensity: 1.2 });
        }
      } else {
        const g = state.gates.find((x) => x.id === p.targetWallId);
        if (g && !g.destroyed && g.hp > 0) {
          g.hp = Math.max(0, g.hp - p.buildingDamage);
          if (g.hp <= 0) {
            g.destroyed = true;
            navDirty = true;
            state.visualRevision++;
            if (state.scenario.fortressBreachedAtS === null) state.scenario.fortressBreachedAtS = state.timeS;
            pushAlert(state, g.side, 'wallBreached', g.x, g.z, 'gate');
            state.fxEvents.push({ kind: 'wallCollapse', x: g.x, y: p.targetY, z: g.z, intensity: 1.3 });
          }
        }
      }
    }

    // 3. Regiment hits (direct or splash radius)
    const impactRadius = Math.max(3.2, p.splashRadiusM + 2.2);
    for (const reg of state.regiments) {
      if (reg.side === p.side || reg.garrisonedInBuildingId !== null || countAliveSoldiers(reg) === 0) continue;
      const d = Math.hypot(reg.x - p.targetX, reg.z - p.targetZ);
      const isDirect = reg.id === p.targetRegimentId && d <= 9.0;
      if (!isDirect && d > impactRadius) continue;

      // Accuracy & cover modifiers (loose formation −40%, forest cover −35%)
      let acc =
        p.kind === 'cannonball'
          ? 0.58
          : p.kind === 'mortar'
            ? 0.65
            : p.kind === 'bolt'
              ? 0.26
              : 0.145;
      acc *= p.shooterAccuracyMul;
      if (reg.formation === 'loose') acc *= 1 - COMBAT.missileLooseReduction;
      if (nav.isForestCellAt(reg.x, reg.z)) acc *= 1 - COMBAT.missileForestCover;
      // Shorter range is noticeably more accurate
      const flightDist = Math.hypot(p.targetX - p.startX, p.targetZ - p.startZ);
      acc *= Math.max(0.75, Math.min(1.25, 1.25 - flightDist / 160));

      if (p.splashRadiusM > 0) {
        // Artillery splash can hit multiple men in dense formations
        const splashRolls = p.kind === 'mortar' ? 3 : 2;
        for (let r = 0; r < splashRolls; r++) {
          if (nextSimRand(state) < acc) {
            const arc = classifyAttackArc(p.startX, p.startZ, reg);
            applyDamageToRegiment(state, reg, shooter, p.damage, p.armorPierce, true, arc, p.kind === 'mortar' ? 5 : 3);
          }
        }
      } else if (nextSimRand(state) < acc) {
        const arc = classifyAttackArc(p.startX, p.startZ, reg);
        applyDamageToRegiment(state, reg, shooter, p.damage, p.armorPierce, true, arc, 0.4);
        state.fxEvents.push({ kind: 'arrowHit', x: p.targetX, y: p.targetY, z: p.targetZ, intensity: 0.5 });
      }
      if (isDirect && p.splashRadiusM === 0) break;
    }

    state.projectiles.splice(i, 1);
  }
  return navDirty;
}

/** Main 60 Hz Regiment Movement, Formations, Melee, Missile, Morale & Siege step. */
export function stepCombat(
  state: SimWorldState,
  dtS: number,
  terrain: TerrainField,
  nav: NavGrid,
): { navDirty: boolean } {
  let navDirty = false;

  stepRecruitmentQueues(state, dtS);
  stepArmyLogistics(state, dtS);
  stepFortifications(state, dtS, terrain);
  stepCapturePoints(state, dtS);
  if (stepProjectiles(state, dtS, nav)) navDirty = true;

  // Step every active regiment
  for (const reg of state.regiments) {
    const aliveMen = countAliveSoldiers(reg);
    if (aliveMen <= 0) continue;
    if (reg.garrisonedInBuildingId !== null) continue;

    const def = UNIT_DEFS[reg.unitType];
    refreshRegimentStats(state, reg);
    reg.outOfCombatS += dtS;
    if (reg.chargeTimerS > 0) reg.chargeTimerS = Math.max(0, reg.chargeTimerS - dtS);

    // 1. Active refitting (20 s stationary near barracks)
    if (reg.refittingTo !== null) {
      reg.refitTimerS += dtS;
      reg.currentSpeedMs = 0;
      if (reg.refitTimerS >= COMBAT.refitDurationS) {
        const newDef = UNIT_DEFS[reg.refittingTo];
        reg.unitType = reg.refittingTo;
        reg.refittingTo = null;
        reg.refitTimerS = 0;
        reg.maxMen = Math.max(aliveMen, getRegimentMaxMen(state, reg.unitType));
        const moraleFrac = reg.morale / Math.max(1, reg.maxMorale);
        for (const s of reg.soldiers) {
          if (!s.alive) continue;
          const hpFrac = s.hp / Math.max(1, s.maxHp);
          s.maxHp = newDef.hp;
          s.hp = Math.max(1, newDef.hp * hpFrac);
        }
        refreshRegimentStats(state, reg);
        reg.morale = Math.min(reg.maxMorale, reg.maxMorale * moraleFrac);
        state.visualRevision++;
      }
      continue;
    }

    // 2. Routing & Rallying
    const keep = findKeep(state, reg.side);
    if (reg.routing) {
      const rallyMul = reg.captainAlive || def.unitClass === 'siege' ? 1.0 : COMBAT.missingCaptainRallySpeedMul;
      if (reg.outOfCombatS > 4) {
        reg.morale = Math.min(reg.maxMorale, reg.morale + COMBAT.moraleRecoveryOutOfCombatPerS * rallyMul * dtS);
      }
      if (reg.morale >= COMBAT.rallyThresholdMorale && aliveMen >= 2) {
        reg.routing = false;
      } else if (keep) {
        const dx = keep.x - reg.x;
        const dz = keep.z - reg.z;
        const d = Math.hypot(dx, dz);
        if (d > 8) {
          const spd = def.runSpeedMs * 1.05 * nav.speedMultiplierAt(reg.x, reg.z);
          const nx = reg.x + (dx / d) * spd * dtS;
          const nz = reg.z + (dz / d) * spd * dtS;
          if (nav.isWalkableAt(nx, nz, reg.side)) {
            reg.x = nx;
            reg.z = nz;
          }
          reg.yawRad = Math.atan2(dx, dz);
          reg.currentSpeedMs = spd;
        }
      }
      updateSoldierSlotPositions(reg, dtS, terrain, nav, true);
      continue;
    }

    // Out-of-combat morale recovery & automatic reinforcement near Barracks/Keep
    if (reg.outOfCombatS >= COMBAT.reinforceOutOfCombatS) {
      const rallyMul = reg.captainAlive || def.unitClass === 'siege' ? 1.0 : COMBAT.missingCaptainRallySpeedMul;
      reg.morale = Math.min(reg.maxMorale, reg.morale + COMBAT.moraleRecoveryOutOfCombatPerS * rallyMul * dtS);

      if (aliveMen < reg.maxMen && def.unitClass !== 'siege') {
        const homeDepot = state.buildings.find(
          (b) =>
            b.side === reg.side &&
            b.hp > 0 &&
            b.buildProgress >= 1 &&
            (reg.unitType === 'militia' ? b.type === 'keep' : b.type === 'barracks') &&
            Math.hypot(b.x - reg.x, b.z - reg.z) <= COMBAT.reinforceRadiusM,
        );
        if (homeDepot && countSideArmyMen(state, reg.side) < getArmyCap(state)) {
          reg.reinforceTimerS += dtS;
          if (reg.reinforceTimerS >= COMBAT.reinforcePerManS) {
            const sideState = state.sides[reg.side];
            const perManGold = Math.ceil((def.cost.gold ?? 0) / def.count);
            let canPay = sideState.stock.gold >= perManGold;
            for (const g of Object.keys(def.equipPerMan) as GoodId[]) {
              if ((sideState.stock[g] ?? 0) < (def.equipPerMan[g] ?? 0)) canPay = false;
            }
            const freeCiv = state.citizens.find((c) => c.side === reg.side && c.role !== 'recruit');
            const totalFree = state.citizens.filter((c) => c.side === reg.side && c.role !== 'recruit').length;
            if (canPay && freeCiv && totalFree > ECONOMY.minFreeCarriers) {
              reg.reinforceTimerS = 0;
              sideState.stock.gold -= perManGold;
              for (const g of Object.keys(def.equipPerMan) as GoodId[]) {
                sideState.stock[g] = Math.max(0, (sideState.stock[g] ?? 0) - (def.equipPerMan[g] ?? 0));
              }
              // Pull 1 townsfolk into regiment
              const homeB = state.buildings.find((b) => b.id === freeCiv.homeBuildingId);
              if (homeB && homeB.residents > 0) homeB.residents--;
              state.citizens = state.citizens.filter((c) => c.id !== freeCiv.id);

              // Revive dead slot or expand up to campaign maxMen (20)
              const deadSlot = reg.soldiers.find((s) => !s.alive);
              if (deadSlot) {
                deadSlot.alive = true;
                deadSlot.hp = def.hp;
                deadSlot.maxHp = def.hp;
                deadSlot.x = reg.x;
                deadSlot.z = reg.z;
              } else if (reg.soldiers.length < reg.maxMen) {
                reg.soldiers.push({
                  slotIndex: reg.soldiers.length,
                  alive: true,
                  hp: def.hp,
                  maxHp: def.hp,
                  x: reg.x,
                  z: reg.z,
                  yawRad: reg.yawRad,
                  travelM: 0,
                  clip: 'idle',
                  attackAnimTimerS: 0,
                  meleeCooldownS: 0.5,
                  rangedCooldownS: 0.5,
                  tintVar: 0.92 + nextSimRand(state) * 0.16,
                });
              }
              // Reinforcement also replaces a fallen Captain (GAMEPLAY.md §6)
              if (!reg.captainAlive) reg.captainAlive = true;
            }
          }
        }
      }
    }

    // 3. Militia 115 m home-defence tether (docs/UNITS.md §1)
    if (def.homeDefenceRadiusM !== undefined && keep) {
      const distKeep = Math.hypot(reg.x - keep.x, reg.z - keep.z);
      if (distKeep > def.homeDefenceRadiusM) {
        reg.order = { kind: 'march', x: keep.x + 14, z: keep.z + 14 };
        reg.orderQueue = [];
        reg.path = [];
      }
    }

    // 4. Locate nearest visible enemy regiment
    let nearestEnemy: RegimentEntity | null = null;
    let nearestEnemyDist = Infinity;
    for (const other of state.regiments) {
      if (other.side === reg.side || other.garrisonedInBuildingId !== null || countAliveSoldiers(other) === 0) continue;
      const d = Math.hypot(other.x - reg.x, other.z - reg.z);
      if (d < nearestEnemyDist) {
        nearestEnemyDist = d;
        nearestEnemy = other;
      }
    }

    // 5. Stance reactions (Guard responds within 12 m; Skirmish kites infantry < 32 m)
    if (!reg.order && nearestEnemy) {
      if (reg.stance === 'skirmish' && def.ranged && nearestEnemyDist < COMBAT.skirmishKeepDistM && !nearestEnemy.routing) {
        const awayX = reg.x - nearestEnemy.x;
        const awayZ = reg.z - nearestEnemy.z;
        const al = Math.max(0.01, Math.hypot(awayX, awayZ));
        const destX = Math.max(-268, Math.min(268, reg.x + (awayX / al) * 16));
        const destZ = Math.max(-268, Math.min(268, reg.z + (awayZ / al) * 16));
        if (nav.isWalkableAt(destX, destZ, reg.side)) {
          reg.order = { kind: 'run', x: destX, z: destZ };
        }
      } else if (reg.stance === 'guard' && !def.ranged && nearestEnemyDist <= COMBAT.guardRadiusM && !nearestEnemy.routing) {
        if (!def.homeDefenceRadiusM || !keep || Math.hypot(nearestEnemy.x - keep.x, nearestEnemy.z - keep.z) <= def.homeDefenceRadiusM) {
          reg.order = { kind: 'attack', x: nearestEnemy.x, z: nearestEnemy.z, targetRegimentId: nearestEnemy.id };
        }
      }
    }

    // 6. Execute active movement / attack / garrison order
    let inMeleeRange = false;
    let meleeTarget: RegimentEntity | null = null;
    let siegeTargetBuilding: BuildingEntity | null = null;
    let siegeTargetWall: WallSegmentEntity | GateEntity | null = null;

    if (reg.order) {
      const ord = reg.order;
      if (ord.kind === 'halt') {
        reg.order = null;
        reg.path = [];
        reg.currentSpeedMs = 0;
      } else if (ord.kind === 'garrison' && ord.targetBuildingId !== undefined) {
        const tb = state.buildings.find((b) => b.id === ord.targetBuildingId && b.side === reg.side && b.hp > 0);
        if (!tb) {
          reg.order = null;
        } else if (Math.hypot(tb.x - reg.x, tb.z - reg.z) <= 8.5) {
          if (tb.type === 'watchtower' && (reg.unitType === 'archers' || reg.unitType === 'crossbowmen')) {
            let room = ECONOMY.watchtowerGarrisonCap - tb.garrisonCount;
            if (room > 0 && (tb.garrisonType === null || tb.garrisonType === reg.unitType)) {
              // FPS/marchland stepGarrisoning: transfer up to `room` (max 4) soldiers into the tower; the rest stay outside!
              // Take from the rear ranks first so slot 0 (Captain) remains with the remaining soldiers outside if any stay.
              let entered = 0;
              for (let si = reg.soldiers.length - 1; si >= 0 && room > 0; si--) {
                const sol = reg.soldiers[si]!;
                if (!sol.alive) continue;
                sol.alive = false;
                sol.deadS = 999; // Gone inside the tower — no corpse left on the ground
                tb.garrisonCount += 1;
                room -= 1;
                entered += 1;
              }
              if (entered > 0) {
                tb.garrisonType = reg.unitType;
                state.visualRevision++;
              }
            }
          }
          reg.order = null;
          reg.path = [];
          reg.currentSpeedMs = 0;
          if (countAliveSoldiers(reg) === 0) {
            reg.captainAlive = false;
            continue;
          }
        } else {
          moveRegimentAlongPath(reg, tb.x, tb.z, false, dtS, nav);
        }
      } else if (ord.kind === 'attack' || ord.kind === 'charge') {
        const isRun = ord.kind === 'charge' || def.unitClass === 'cavalry';
        if (ord.targetRegimentId !== undefined) {
          const tgt = state.regiments.find((r) => r.id === ord.targetRegimentId && countAliveSoldiers(r) > 0 && r.garrisonedInBuildingId === null);
          if (!tgt) {
            reg.order = reg.orderQueue.shift() ?? null;
            reg.path = [];
          } else {
            const d = Math.hypot(tgt.x - reg.x, tgt.z - reg.z);
            const engageDist = Math.max(4.5, def.weaponReachM + 2.6);
            if (def.ranged && ord.kind === 'attack' && d <= def.ranged.maxRangeM * 0.92 && d >= def.ranged.minRangeM) {
              // Ranged/siege stops to fire!
              reg.yawRad = Math.atan2(tgt.x - reg.x, tgt.z - reg.z);
              reg.currentSpeedMs = 0;
            } else if (d <= engageDist) {
              inMeleeRange = true;
              meleeTarget = tgt;
              reg.yawRad = Math.atan2(tgt.x - reg.x, tgt.z - reg.z);
              if (reg.currentSpeedMs >= COMBAT.chargeMinSpeedMs && reg.chargeTimerS <= 0) {
                reg.chargeTimerS = COMBAT.chargeDurationS;
                applyChargeImpact(state, reg, tgt, terrain);
              }
              reg.currentSpeedMs = 0;
            } else {
              const blockedOrDone = moveRegimentAlongPath(reg, tgt.x, tgt.z, isRun, dtS, nav);
              if (blockedOrDone && d > engageDist) {
                const bw =
                  state.walls.find((w) => w.side !== reg.side && !w.destroyed && w.hp > 0 && Math.hypot(w.x - reg.x, w.z - reg.z) <= 5.5) ??
                  state.gates.find((g) => g.side !== reg.side && !g.destroyed && g.hp > 0 && Math.hypot(g.x - reg.x, g.z - reg.z) <= 5.5) ??
                  null;
                if (bw) siegeTargetWall = bw;
              }
            }
          }
        } else if (ord.targetBuildingId !== undefined) {
          const tb = state.buildings.find((b) => b.id === ord.targetBuildingId && b.hp > 0);
          if (!tb || def.homeDefenceRadiusM !== undefined) {
            reg.order = reg.orderQueue.shift() ?? null;
            reg.path = [];
          } else {
            const d = Math.hypot(tb.x - reg.x, tb.z - reg.z);
            if (def.ranged && d <= def.ranged.maxRangeM * 0.95 && d >= def.ranged.minRangeM) {
              reg.yawRad = Math.atan2(tb.x - reg.x, tb.z - reg.z);
              reg.currentSpeedMs = 0;
              siegeTargetBuilding = tb;
            } else if (d <= BUILDING_DEFS[tb.type].radiusM + 4.5) {
              reg.yawRad = Math.atan2(tb.x - reg.x, tb.z - reg.z);
              reg.currentSpeedMs = 0;
              siegeTargetBuilding = tb;
            } else {
              const blockedOrDone = moveRegimentAlongPath(reg, tb.x, tb.z, isRun, dtS, nav);
              if (blockedOrDone && d > BUILDING_DEFS[tb.type].radiusM + 4.5) {
                const bw =
                  state.walls.find((w) => w.side !== reg.side && !w.destroyed && w.hp > 0 && Math.hypot(w.x - reg.x, w.z - reg.z) <= 5.5) ??
                  state.gates.find((g) => g.side !== reg.side && !g.destroyed && g.hp > 0 && Math.hypot(g.x - reg.x, g.z - reg.z) <= 5.5) ??
                  null;
                if (bw) siegeTargetWall = bw;
              }
            }
          }
        } else if (ord.targetWallId !== undefined) {
          const tw =
            state.walls.find((w) => w.id === ord.targetWallId && !w.destroyed && w.hp > 0) ??
            state.gates.find((g) => g.id === ord.targetWallId && !g.destroyed && g.hp > 0) ??
            null;
          if (!tw || def.homeDefenceRadiusM !== undefined) {
            reg.order = reg.orderQueue.shift() ?? null;
            reg.path = [];
          } else {
            const d = Math.hypot(tw.x - reg.x, tw.z - reg.z);
            if (def.ranged && d <= def.ranged.maxRangeM * 0.95 && d >= def.ranged.minRangeM) {
              reg.yawRad = Math.atan2(tw.x - reg.x, tw.z - reg.z);
              reg.currentSpeedMs = 0;
              siegeTargetWall = tw;
            } else if (d <= 5.2) {
              reg.yawRad = Math.atan2(tw.x - reg.x, tw.z - reg.z);
              reg.currentSpeedMs = 0;
              siegeTargetWall = tw;
            } else {
              moveRegimentAlongPath(reg, tw.x, tw.z, isRun, dtS, nav);
            }
          }
        } else {
          // Attack-move toward coordinates: engage any enemy within 18 m
          if (nearestEnemy && nearestEnemyDist <= 18 && !nearestEnemy.routing) {
            reg.order = { kind: ord.kind, x: nearestEnemy.x, z: nearestEnemy.z, targetRegimentId: nearestEnemy.id };
          } else {
            const done = moveRegimentAlongPath(reg, ord.x, ord.z, isRun, dtS, nav);
            if (done) {
              const bw =
                state.walls.find((w) => w.side !== reg.side && !w.destroyed && w.hp > 0 && Math.hypot(w.x - reg.x, w.z - reg.z) <= 5.5) ??
                state.gates.find((g) => g.side !== reg.side && !g.destroyed && g.hp > 0 && Math.hypot(g.x - reg.x, g.z - reg.z) <= 5.5) ??
                null;
              if (bw && Math.hypot(ord.x - reg.x, ord.z - reg.z) > 4.5) {
                siegeTargetWall = bw;
              } else {
                if (ord.facingYawRad !== undefined) reg.yawRad = ord.facingYawRad;
                reg.order = reg.orderQueue.shift() ?? null;
                reg.path = [];
              }
            }
          }
        }
      } else {
        // March / Run / RetreatFacing / FallbackKeep
        const isRun = ord.kind === 'run' || ord.kind === 'fallbackKeep';
        const done = moveRegimentAlongPath(reg, ord.x, ord.z, isRun, dtS, nav, ord.kind === 'retreatFacing');
        if (ord.ranks !== undefined) {
          reg.ranks = Math.max(1, Math.min(8, ord.ranks));
          reg.width = Math.max(1, Math.ceil(aliveMen / reg.ranks));
        } else if (ord.width !== undefined) {
          reg.width = Math.max(1, Math.min(20, ord.width));
          reg.ranks = Math.max(1, Math.ceil(aliveMen / reg.width));
        }
        if (done) {
          if (ord.facingYawRad !== undefined) reg.yawRad = ord.facingYawRad;
          reg.order = reg.orderQueue.shift() ?? null;
          reg.path = [];
          reg.currentSpeedMs = 0;
        }
      }
    } else {
      reg.currentSpeedMs = 0;
    }

    // 7. Automatic close melee engagement if enemy is physically touching (<= 4.6 m)
    if (!inMeleeRange && nearestEnemy && nearestEnemyDist <= Math.max(4.6, def.weaponReachM + 2.4)) {
      inMeleeRange = true;
      meleeTarget = nearestEnemy;
    }

    // 8. Fatigue update
    if (inMeleeRange) {
      reg.fatigue = Math.min(1, reg.fatigue + COMBAT.fatigueMeleePerS * dtS);
    } else if (reg.currentSpeedMs > def.walkSpeedMs * 1.25) {
      reg.fatigue = Math.min(1, reg.fatigue + COMBAT.fatigueRunPerS * dtS);
    } else if (reg.currentSpeedMs < 0.2) {
      reg.fatigue = Math.max(0, reg.fatigue - COMBAT.fatigueRecoverIdlePerS * dtS);
    }

    // 9. Resolve Melee Combat
    if (inMeleeRange && meleeTarget && def.meleeDamage > 0) {
      reg.outOfCombatS = 0;
      const arc = classifyAttackArc(reg.x, reg.z, meleeTarget);
      const tgtDef = UNIT_DEFS[meleeTarget.unitType];
      const elevDiff = terrain.heightAt(reg.x, reg.z) - terrain.heightAt(meleeTarget.x, meleeTarget.z);
      const uphillPen = elevDiff < -COMBAT.elevationHeightThresholdM ? COMBAT.uphillMeleeAttackPenalty : 0;

      const chargeMul =
        (reg.formation === 'wedge' ? 1.3 : 1.0) *
        (elevDiff > COMBAT.elevationHeightThresholdM ? 1 + COMBAT.downhillChargeBonusFrac : 1.0);
      // Braced pikes/halberds negate frontal cavalry charge bonus (Pike Wall always negates frontal charges!)
      const cavBlockedByPikes =
        (def.unitClass === 'cavalry' &&
          tgtDef.antiCavBonus > 0 &&
          arc === 'front' &&
          meleeTarget.currentSpeedMs < 2.2) ||
        (meleeTarget.stance === 'pikeWall' && arc === 'front');

      const chargeAtk = reg.chargeTimerS > 0 && !cavBlockedByPikes ? def.chargeAttackBonus * chargeMul : 0;
      const pikeWallCavMul = reg.stance === 'pikeWall' ? STANCES.pikeWall.antiCavMul : 1.0;
      const antiCavAtk =
        tgtDef.unitClass === 'cavalry'
          ? def.antiCavBonus * (reg.formation === 'schiltron' ? 1.35 : 1.0) * pikeWallCavMul
          : 0;
      const arcAtk = arc === 'rear' ? COMBAT.rearAttackBonus : arc === 'flank' ? COMBAT.flankAttackBonus : 0;
      const capPen = !reg.captainAlive ? COMBAT.missingCaptainAttackPenalty : 0;
      const fatPen = reg.fatigue > 0.7 ? COMBAT.fatigueExhaustedAttackPenalty : 0;
      const shieldDef = arc === 'front' ? (tgtDef.shieldDefence ?? 0) : 0;
      const stanceDef =
        arc === 'front'
          ? meleeTarget.stance === 'pikeWall'
            ? STANCES.pikeWall.defenceBonus
            : meleeTarget.stance === 'shieldWall'
              ? STANCES.shieldWall.defenceBonus
              : 0
          : 0;
      const effAtk = def.attack + reg.veteranTier * COMBAT.vetAttackBonusPerTier + chargeAtk + antiCavAtk + arcAtk - capPen - fatPen - uphillPen;
      const effDef = tgtDef.defence + shieldDef + stanceDef + meleeTarget.veteranTier * COMBAT.vetDefenceBonusPerTier - (arc === 'rear' ? 4 : arc === 'flank' ? 2 : 0);

      const hitChance = Math.max(
        COMBAT.minHitChance,
        Math.min(COMBAT.maxHitChance, COMBAT.baseHitChance + (effAtk - effDef) * COMBAT.hitChancePerPoint),
      );

      const antiCavDmgBonus = tgtDef.unitClass === 'cavalry' && def.antiCavBonus > 0 ? def.antiCavBonus * 0.55 : 0;
      const meleeAp = tgtDef.unitClass === 'cavalry' && def.antiCavBonus > 0 ? 0.48 : 0;
      const chargeDmgMul = reg.chargeTimerS > 0 && !cavBlockedByPikes ? 1.5 : 1.0;
      const swingIntervalS = reg.unitType === 'swordsmen' ? 1.28 : reg.unitType === 'halberdiers' ? 1.54 : COMBAT.meleeSwingIntervalS;

      // Front-rank fighting limit (~7 men fight simultaneously; 3 m pikes bring 2nd rank in!)
      const activeFighters = Math.min(aliveMen, def.weaponReachM >= 2.8 ? 10 : 7);
      let fightersProcessed = 0;
      for (const s of reg.soldiers) {
        if (!s.alive) continue;
        fightersProcessed++;
        if (fightersProcessed > activeFighters) break;
        s.meleeCooldownS -= dtS;
        if (s.meleeCooldownS <= 0) {
          s.meleeCooldownS = swingIntervalS * (0.88 + nextSimRand(state) * 0.24);
          s.clip = 'attack';
          s.attackAnimTimerS = 0.65;
          s.sinceAttackS = 0;
          if (nextSimRand(state) < hitChance) {
            const shock = arc === 'rear' ? 2.6 : arc === 'flank' ? 1.5 : 0.25;
            applyDamageToRegiment(
              state,
              meleeTarget,
              reg,
              (def.meleeDamage + antiCavDmgBonus) * chargeDmgMul,
              meleeAp,
              false,
              arc,
              shock,
            );
            if (nextSimRand(state) < 0.22) {
              state.fxEvents.push({ kind: 'swordClash', x: meleeTarget.x, y: terrain.heightAt(meleeTarget.x, meleeTarget.z) + 1.2, z: meleeTarget.z, intensity: 0.7 });
            }
          }
        }
      }
    }

    // 10. Melee siege vs buildings & walls (when non-militia infantry batters a wall/gate/building)
    if (!def.ranged && (siegeTargetBuilding || siegeTargetWall) && def.meleeDamage > 0) {
      const targetObj = siegeTargetBuilding ?? siegeTargetWall!;
      for (const s of reg.soldiers) {
        if (!s.alive) continue;
        s.meleeCooldownS -= dtS;
        if (s.meleeCooldownS <= 0) {
          s.meleeCooldownS = COMBAT.meleeSwingIntervalS;
          s.clip = 'attack';
          s.attackAnimTimerS = 0.6;
          s.sinceAttackS = 0;
          const bDmg = Math.max(1.5, def.meleeDamage * 0.45);
          if (siegeTargetBuilding && !siegeTargetBuilding.indestructible) {
            siegeTargetBuilding.hp = Math.max(0, siegeTargetBuilding.hp - bDmg);
            if (siegeTargetBuilding.hp <= 0) {
              state.sides[siegeTargetBuilding.side].buildingsLost++;
              pushAlert(state, siegeTargetBuilding.side, 'buildingLost', siegeTargetBuilding.x, siegeTargetBuilding.z, siegeTargetBuilding.type);
              navDirty = true;
              state.visualRevision++;
            }
          } else if (siegeTargetWall && !siegeTargetWall.destroyed) {
            siegeTargetWall.hp = Math.max(0, siegeTargetWall.hp - bDmg);
            if (siegeTargetWall.hp <= 0) {
              siegeTargetWall.destroyed = true;
              navDirty = true;
              state.visualRevision++;
              if (state.scenario.fortressBreachedAtS === null) state.scenario.fortressBreachedAtS = state.timeS;
              pushAlert(state, siegeTargetWall.side, 'wallBreached', targetObj.x, targetObj.z, 'wall');
            }
          }
        }
      }
    }

    // 11. Ranged & Artillery Volleys (not while in melee, moving fast, or Hold Fire)
    if (def.ranged && !inMeleeRange && !reg.holdFire && reg.currentSpeedMs < 0.6) {
      const rSpec = def.ranged;
      const regElev = terrain.heightAt(reg.x, reg.z);

      // Select target: explicit order target or nearest enemy in range
      let fireRegTarget: RegimentEntity | null = null;
      let fireBldTarget: BuildingEntity | null = siegeTargetBuilding;
      let fireWallTarget: WallSegmentEntity | GateEntity | null = siegeTargetWall;

      if (!fireBldTarget && !fireWallTarget) {
        if (reg.order?.targetRegimentId !== undefined) {
          const explicit = state.regiments.find((r) => r.id === reg.order?.targetRegimentId && countAliveSoldiers(r) > 0 && r.garrisonedInBuildingId === null);
          if (explicit) {
            const d = Math.hypot(explicit.x - reg.x, explicit.z - reg.z);
            const effMax = rSpec.maxRangeM * (regElev - terrain.heightAt(explicit.x, explicit.z) > COMBAT.elevationHeightThresholdM ? 1 + COMBAT.downhillRangeBonusFrac : 1);
            if (d >= rSpec.minRangeM && d <= effMax) fireRegTarget = explicit;
          }
        }
        if (!fireRegTarget && nearestEnemy) {
          const effMax = rSpec.maxRangeM * (regElev - terrain.heightAt(nearestEnemy.x, nearestEnemy.z) > COMBAT.elevationHeightThresholdM ? 1 + COMBAT.downhillRangeBonusFrac : 1);
          if (nearestEnemyDist >= rSpec.minRangeM && nearestEnemyDist <= effMax) {
            fireRegTarget = nearestEnemy;
          }
        }
      }

      const tgtPos = fireRegTarget
        ? { x: fireRegTarget.x, z: fireRegTarget.z }
        : fireBldTarget
          ? { x: fireBldTarget.x, z: fireBldTarget.z }
          : fireWallTarget
            ? { x: fireWallTarget.x, z: fireWallTarget.z }
            : null;

      if (tgtPos) {
        reg.yawRad = Math.atan2(tgtPos.x - reg.x, tgtPos.z - reg.z);
        const dist = Math.hypot(tgtPos.x - reg.x, tgtPos.z - reg.z);
        const accMul = 1 + reg.veteranTier * COMBAT.vetAccuracyBonusPerTier;

        for (const s of reg.soldiers) {
          if (!s.alive) continue;
          s.rangedCooldownS -= dtS;
          if (s.rangedCooldownS <= 0) {
            s.rangedCooldownS = rSpec.reloadS * (0.92 + nextSimRand(state) * 0.16);
            s.clip = 'attack';
            s.attackAnimTimerS = 0.7;
            s.sinceAttackS = 0;
            const sy = terrain.heightAt(s.x, s.z) + 1.45;
            const ty = terrain.heightAt(tgtPos.x, tgtPos.z) + 1.05;
            const spread = rSpec.kind === 'mortar' ? 2.6 : rSpec.kind === 'cannonball' ? 1.8 : 2.8;
            const tx = tgtPos.x + (nextSimRand(state) - 0.5) * spread;
            const tz = tgtPos.z + (nextSimRand(state) - 0.5) * spread;
            const flightS = Math.max(0.25, dist / rSpec.projectileSpeedMs);
            const arcH =
              rSpec.kind === 'mortar'
                ? Math.min(48, Math.max(18, dist * 0.36))
                : rSpec.kind === 'cannonball'
                  ? Math.min(3.5, dist * 0.03)
                  : rSpec.kind === 'bolt'
                    ? Math.min(5, dist * 0.06)
                    : Math.min(15, dist * 0.16);

            state.projectiles.push({
              id: state.nextEntityId++,
              side: reg.side,
              kind: rSpec.kind,
              sourceRegimentId: reg.id,
              x: s.x,
              y: sy,
              z: s.z,
              startX: s.x,
              startY: sy,
              startZ: s.z,
              targetX: tx,
              targetY: ty,
              targetZ: tz,
              flightTimeS: flightS,
              elapsedS: 0,
              arcHeightM: arcH,
              damage: rSpec.damage,
              armorPierce: rSpec.armorPierce,
              splashRadiusM: rSpec.splashRadiusM,
              buildingDamage: rSpec.buildingDamage,
              targetRegimentId: fireRegTarget?.id ?? null,
              targetBuildingId: fireBldTarget?.id ?? null,
              targetWallId: fireWallTarget?.id ?? null,
              shooterAccuracyMul: accMul,
            });

            if (rSpec.kind === 'cannonball' || rSpec.kind === 'mortar') {
              state.fxEvents.push({ kind: 'cannonMuzzle', x: s.x, y: sy, z: s.z, intensity: rSpec.kind === 'mortar' ? 1.3 : 1.0 });
            }
          }
        }
      }
    }

    // 12. Update individual soldier slot positions & zero-foot-slide `travelM`
    updateSoldierSlotPositions(reg, dtS, terrain, nav, false);
  }

  // Prune completely wiped-out regiments
  for (let i = state.regiments.length - 1; i >= 0; i--) {
    const r = state.regiments[i]!;
    if (countAliveSoldiers(r) === 0) {
      pushAlert(state, r.side, 'regimentLost', r.x, r.z, r.unitType);
      state.regiments.splice(i, 1);
    }
  }

  return { navDirty };
}

function applyChargeImpact(
  state: SimWorldState,
  attacker: RegimentEntity,
  defender: RegimentEntity,
  terrain: TerrainField,
): void {
  const def = UNIT_DEFS[attacker.unitType];
  const tgtDef = UNIT_DEFS[defender.unitType];
  const arc = classifyAttackArc(attacker.x, attacker.z, defender);

  // Frontal charge into braced pikes/halberds severely punishes cavalry (Pike Wall deals 2x counter-charge!)
  if (def.unitClass === 'cavalry' && tgtDef.antiCavBonus > 0 && arc === 'front' && (defender.currentSpeedMs < 2.2 || defender.stance === 'pikeWall')) {
    const pwMul = defender.stance === 'pikeWall' ? STANCES.pikeWall.antiCavMul : 1.0;
    const counterHits = Math.min(6, Math.ceil(countAliveSoldiers(defender) * 0.42));
    for (let k = 0; k < counterHits; k++) {
      applyDamageToRegiment(state, attacker, defender, (tgtDef.meleeDamage + tgtDef.antiCavBonus * 0.85) * pwMul, 0.48, false, 'front', 7);
    }
    return;
  }

  const elevDiff = terrain.heightAt(attacker.x, attacker.z) - terrain.heightAt(defender.x, defender.z);
  const downhillMul = elevDiff > COMBAT.elevationHeightThresholdM ? 1 + COMBAT.downhillChargeBonusFrac : 1.0;
  const wedgeMul = attacker.formation === 'wedge' ? 1.3 : 1.0;
  const arcShock = arc === 'rear' ? COMBAT.rearMoraleShock : arc === 'flank' ? COMBAT.flankMoraleShock : 0;
  const shock = (def.chargeMoraleShock * wedgeMul + arcShock) * downhillMul;

  const impactSwings = Math.min(countAliveSoldiers(attacker), def.unitClass === 'cavalry' ? 6 : 4);
  for (let i = 0; i < impactSwings; i++) {
    applyDamageToRegiment(
      state,
      defender,
      attacker,
      (def.meleeDamage * 1.5 + def.chargeAttackBonus * 0.75) * wedgeMul * downhillMul,
      def.unitClass === 'cavalry' ? 0.25 : 0.0,
      false,
      arc,
      i === 0 ? shock : 0,
    );
  }
  state.fxEvents.push({
    kind: 'horn',
    x: attacker.x,
    y: terrain.heightAt(attacker.x, attacker.z) + 1.5,
    z: attacker.z,
    intensity: 1.0,
  });
}

function moveRegimentAlongPath(
  reg: RegimentEntity,
  destX: number,
  destZ: number,
  run: boolean,
  dtS: number,
  nav: NavGrid,
  keepFacing = false,
): boolean {
  const def = UNIT_DEFS[reg.unitType];
  if (reg.path.length === 0) {
    if (nav.hasSafeClearLine(reg.x, reg.z, destX, destZ, reg.side)) {
      reg.path = [{ x: destX, z: destZ }];
    } else {
      reg.path = nav.findPath(reg.x, reg.z, destX, destZ, reg.side, 18_000);
    }
  }

  const wp = reg.path[0];
  if (!wp) {
    // Destination is sealed behind an impassable wall or river and we are already at the closest reachable cell!
    reg.currentSpeedMs = 0;
    return true;
  }
  const dx = wp.x - reg.x;
  const dz = wp.z - reg.z;
  const dist = Math.hypot(dx, dz);

  let formSpeedMul = 1.0;
  if (reg.formation === 'column') formSpeedMul = 1.2;
  else if (reg.formation === 'schiltron') formSpeedMul = 0.5;
  const stanceSpeedMul =
    reg.stance === 'shieldWall'
      ? STANCES.shieldWall.speedMul
      : reg.stance === 'pikeWall'
        ? STANCES.pikeWall.speedMul
        : 1.0;
  const fatigueMul = 1 - reg.fatigue * 0.22;
  const terrainMul = nav.speedMultiplierAt(reg.x, reg.z);
  const baseSpd = run && reg.stance !== 'shieldWall' && reg.stance !== 'pikeWall' ? def.runSpeedMs : def.walkSpeedMs;
  const speed = baseSpd * formSpeedMul * stanceSpeedMul * fatigueMul * terrainMul;
  const step = speed * dtS;

  if (dist <= Math.max(0.55, step)) {
    if (nav.isWalkableAt(wp.x, wp.z, reg.side)) {
      reg.x = wp.x;
      reg.z = wp.z;
    }
    reg.currentSpeedMs = speed;
    if (reg.path.length > 0) reg.path.shift();
    return reg.path.length === 0;
  }

  const nx = reg.x + (dx / dist) * step;
  const nz = reg.z + (dz / dist) * step;
  if (nav.isWalkableAt(nx, nz, reg.side)) {
    reg.x = nx;
    reg.z = nz;
  } else {
    // Recompute safe path around newly built obstacle/wall
    reg.path = nav.findPath(reg.x, reg.z, destX, destZ, reg.side, 18_000);
    if (reg.path.length === 0) {
      reg.currentSpeedMs = 0;
      return true;
    }
  }
  if (!keepFacing) {
    reg.yawRad = Math.atan2(dx, dz);
  }
  reg.currentSpeedMs = speed;
  return false;
}

function updateSoldierSlotPositions(
  reg: RegimentEntity,
  dtS: number,
  _terrain: TerrainField,
  nav: NavGrid,
  isRouting: boolean,
): void {
  const def = UNIT_DEFS[reg.unitType];
  const aliveList = reg.soldiers.filter((s) => s.alive);
  const totalAlive = aliveList.length;
  if (totalAlive === 0) return;

  // Automatically narrow into snake-column when crossing a narrow ford or 6 m gate so soldiers NEVER clip water or walls!
  const nearNarrowEdge =
    !nav.isWalkableAt(reg.x + 3.2, reg.z, reg.side) ||
    !nav.isWalkableAt(reg.x - 3.2, reg.z, reg.side) ||
    !nav.isWalkableAt(reg.x, reg.z + 3.2, reg.side) ||
    !nav.isWalkableAt(reg.x, reg.z - 3.2, reg.side);

  const baseWidth =
    reg.ranks && reg.ranks >= 1
      ? Math.max(1, Math.ceil(totalAlive / reg.ranks))
      : reg.width;
  reg.width = baseWidth;
  const effFormation: FormationKind = nearNarrowEdge && reg.currentSpeedMs > 0.3 ? 'column' : reg.formation;
  const effWidth = nearNarrowEdge && reg.currentSpeedMs > 0.3 ? Math.min(2, baseWidth) : baseWidth;

  const fx = Math.sin(reg.yawRad);
  const fz = Math.cos(reg.yawRad);
  const rx = Math.cos(reg.yawRad);
  const rz = -Math.sin(reg.yawRad);
  const regMoving = reg.currentSpeedMs > 0.12;
  const baseCatchUp = regMoving
    ? Math.max(reg.currentSpeedMs * 1.3, def.walkSpeedMs * 1.05)
    : def.walkSpeedMs * 1.15;
  const maxCatchUp = Math.max(def.runSpeedMs * 1.3, def.walkSpeedMs * 1.3);

  for (const s of reg.soldiers) {
    if (!s.alive) {
      s.deadS = (s.deadS ?? 0) + dtS;
      s.speedMs = 0;
    }
  }

  for (let idx = 0; idx < totalAlive; idx++) {
    const s = aliveList[idx]!;
    s.sinceAttackS = (s.sinceAttackS ?? 99) + dtS;
    const off = computeFormationSlotOffset(idx, totalAlive, effWidth, effFormation, def.unitClass);
    let tx = reg.x + rx * off.right + fx * off.forward;
    let tz = reg.z + rz * off.right + fz * off.forward;

    // Guarantee individual soldier slot stays strictly walkable (never steps into water or inside a wall!)
    if (!nav.isWalkableAt(tx, tz, reg.side)) {
      tx = reg.x;
      tz = reg.z;
    }

    const dx = tx - s.x;
    const dz = tz - s.z;
    const dist = Math.hypot(dx, dz);

    if (s.attackAnimTimerS > 0) {
      s.attackAnimTimerS = Math.max(0, s.attackAnimTimerS - dtS);
    }

    // Smooth FPS/marchland catch-up: match regiment gait cleanly instead of overshooting & snapping to 0 every other tick!
    const desiredSpeed = dist > 1.2 ? maxCatchUp : baseCatchUp;
    const maxStep = desiredSpeed * dtS;
    const moveThreshold = regMoving ? 0.015 : 0.06;

    if (dist > moveThreshold) {
      const move = Math.min(dist, maxStep);
      const nx = s.x + (dx / dist) * move;
      const nz = s.z + (dz / dist) * move;
      if (nav.isWalkableAt(nx, nz, reg.side)) {
        s.x = nx;
        s.z = nz;
      } else {
        s.x = reg.x;
        s.z = reg.z;
      }
      s.travelM += move;
      const instSpeed = dtS > 1e-4 ? move / dtS : reg.currentSpeedMs;
      const targetSpeed = regMoving ? Math.max(instSpeed, reg.currentSpeedMs * 0.9) : instSpeed;
      const prevSpeed = s.speedMs ?? targetSpeed;
      s.speedMs = prevSpeed + (targetSpeed - prevSpeed) * Math.min(1, dtS * 8);
      if (isRouting || dist > 0.7) {
        const targetYaw = Math.atan2(dx, dz);
        let diff = targetYaw - s.yawRad;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        s.yawRad += diff * Math.min(1, dtS * 8);
      } else {
        let diff = reg.yawRad - s.yawRad;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        s.yawRad += diff * Math.min(1, dtS * 10);
      }
      if (s.attackAnimTimerS <= 0) s.clip = 'walk';
    } else {
      let diff = reg.yawRad - s.yawRad;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      s.yawRad += diff * Math.min(1, dtS * 10);
      const prevSpeed = s.speedMs ?? 0;
      const targetSpeed = regMoving ? reg.currentSpeedMs : 0;
      s.speedMs = prevSpeed + (targetSpeed - prevSpeed) * Math.min(1, dtS * 8);
      if (regMoving) {
        s.travelM += reg.currentSpeedMs * dtS;
        if (s.attackAnimTimerS <= 0) s.clip = 'walk';
      } else {
        if (s.speedMs < 0.05) s.speedMs = 0;
        if (s.attackAnimTimerS <= 0) s.clip = 'idle';
      }
    }
  }
}

/** Disbands a regiment, returning alive soldiers to town citizens and equipment to Keep stock. */
export function disbandRegimentToTown(state: SimWorldState, reg: RegimentEntity): void {
  const def = UNIT_DEFS[reg.unitType];
  const alive = countAliveSoldiers(reg);
  const keep = findKeep(state, reg.side);
  const s = state.sides[reg.side];

  // Return equipment
  for (const g of Object.keys(def.equipPerMan) as GoodId[]) {
    s.stock[g] = (s.stock[g] ?? 0) + (def.equipPerMan[g] ?? 0) * alive;
  }

  // Return people to town houses / Keep
  const returnPeople = def.unitClass === 'siege' ? Math.ceil((alive / def.count) * def.crewCount) : alive;
  if (keep) {
    for (let i = 0; i < returnPeople; i++) {
      const house = state.buildings.find(
        (b) =>
          b.side === reg.side &&
          b.type === 'house' &&
          b.buildProgress >= 1 &&
          b.hp > 0 &&
          b.residents < ECONOMY.houseCapacityByLevel[b.level - 1]!,
      );
      const home = house ?? keep;
      home.residents++;
      spawnCitizen(state, reg.side, home);
    }
  }

  state.regiments = state.regiments.filter((r) => r.id !== reg.id);
}
