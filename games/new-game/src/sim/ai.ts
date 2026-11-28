// Pure-TS Fair-Economy AI Controller with 3 Personalities & Tactical Counter-Composition (zero three.js).
// Rules (docs/GAMEPLAY.md §7 & BRIEF.md F19):
//   - Executes ONLY `executeCommand()` (identical economy rules, ZERO free units or hidden resources!).
//   - 3 personalities: `builder` (Gospodarz), `raider` (Zagończyk), `knight` (Rycerz).
//   - 1-minute counter-composition evaluation against opponent's army classes.
//   - Tactical battle control: infantry line, archers behind, flanking cavalry, reserve relieving < 40% morale,
//     plus capture-point dispatch and Keep upgrade before Barracks upgrade!

import {
  AI_AGES,
  ALL_GOODS,
  BUILDING_DEFS,
  ECONOMY,
  GOOD_VALUE_GOLD,
  UNIT_DEFS,
  type BuildingTypeId,
  type GoodId,
  type UnitTypeId,
} from '../config.ts';
import { countAliveSoldiers, nextSimRand } from './combat.ts';
import { executeCommand, hasResources, validateBuildingPlacement } from './commands.ts';
import { countPopulation, eraOfKeepLevel, findKeep } from './economy.ts';
import type { NavGrid } from './pathing.ts';
import type { TerrainField } from './terrain.ts';
import type { ForestGrid } from './trees.ts';
import type {
  AiPersonality,
  Difficulty,
  RegimentEntity,
  SideId,
  SimWorldState,
} from './types.ts';

export function getAiProductionMultiplier(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 0.78;
  if (difficulty === 'hard') return 1.28;
  return 1.0;
}

export function getAiReactionIntervalS(difficulty: Difficulty): number {
  if (difficulty === 'easy') return 6.0;
  if (difficulty === 'hard') return 1.0;
  return 3.0;
}

interface BuildGoal {
  readonly type: BuildingTypeId;
  readonly count: number;
}

function getBuildOrder(personality: AiPersonality): readonly BuildGoal[] {
  const base: BuildGoal[] = [
    { type: 'woodcutter', count: 2 },
    { type: 'house', count: 2 },
    { type: 'hunter', count: 1 },
    { type: 'farm', count: 1 },
    { type: 'windmill', count: 1 },
    { type: 'bakery', count: 1 },
    { type: 'quarry', count: 1 },
    { type: 'tannery', count: 1 },
    { type: 'fletcher', count: 1 },
    { type: 'barracks', count: 1 },
    { type: 'house', count: 4 },
    { type: 'ironMine', count: 1 },
    { type: 'smelter', count: 1 },
    { type: 'smithy', count: 1 },
    { type: 'hunter', count: 2 },
    { type: 'farm', count: 2 },
    { type: 'woodcutter', count: 3 },
    { type: 'house', count: 6 },
    { type: 'sawmill', count: 1 },
  ];

  if (personality === 'raider') {
    base.push(
      { type: 'stable', count: 1 },
      { type: 'butcher', count: 1 },
      { type: 'house', count: 7 },
      { type: 'armourer', count: 1 },
    );
  } else if (personality === 'knight') {
    base.push(
      { type: 'armourer', count: 1 },
      { type: 'stable', count: 1 },
      { type: 'gunFoundry', count: 1 },
      { type: 'chapel', count: 1 },
      { type: 'house', count: 8 },
    );
  } else {
    // builder (Gospodarz)
    base.push(
      { type: 'well', count: 1 },
      { type: 'farm', count: 3 },
      { type: 'house', count: 8 },
      { type: 'armourer', count: 1 },
      { type: 'butcher', count: 1 },
      { type: 'market', count: 1 },
      { type: 'chapel', count: 1 },
      { type: 'gunFoundry', count: 1 },
    );
  }
  return base;
}

/** Searches candidate spiral positions matching terrain requirements to place a building legally. */
function findLegalSiteForBuilding(
  state: SimWorldState,
  side: SideId,
  bType: BuildingTypeId,
  keepX: number,
  keepZ: number,
  terrain: TerrainField,
  forest: ForestGrid,
): { x: number; z: number; yawRad: number } | null {
  const def = BUILDING_DEFS[bType];

  // Specialized terrain targets: search directly around nearest valid feature
  if (def.terrainReq === 'stone' || def.terrainReq === 'ore') {
    const outcrops = state.outcrops
      .filter((o) => o.kind === def.terrainReq)
      .sort((a, b) => Math.hypot(a.x - keepX, a.z - keepZ) - Math.hypot(b.x - keepX, b.z - keepZ));
    for (const o of outcrops) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = o.x + Math.cos(ang) * 9.5;
        const z = o.z + Math.sin(ang) * 9.5;
        if (validateBuildingPlacement(state, side, bType, x, z, ang, terrain, forest, true) === 'ok') {
          return { x, z, yawRad: Math.atan2(keepX - x, keepZ - z) };
        }
      }
    }
    return null;
  }

  if (def.terrainReq === 'forest') {
    const existingWc = bType === 'woodcutter'
      ? state.buildings.filter((b) => b.side === side && b.type === 'woodcutter' && b.hp > 0)
      : [];
    const nearTrees = state.trees
      .filter((t) => t.state === 'mature' && Math.hypot(t.x - keepX, t.z - keepZ) <= 265)
      .sort((a, b) => Math.hypot(a.x - keepX, a.z - keepZ) - Math.hypot(b.x - keepX, b.z - keepZ))
      .slice(0, 60);
    for (const tree of nearTrees) {
      if (existingWc.some((w) => Math.hypot(tree.x - w.x, tree.z - w.z) < 32)) continue;
      for (let r = 8; r <= 24; r += 5) {
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2;
          const x = tree.x + Math.cos(ang) * r;
          const z = tree.z + Math.sin(ang) * r;
          if (validateBuildingPlacement(state, side, bType, x, z, ang, terrain, forest, true) === 'ok') {
            return { x, z, yawRad: Math.atan2(keepX - x, keepZ - z) };
          }
        }
      }
    }
    return null;
  }

  // Grid-based town planner: leaves axial streets (|dx| < 8 or |dz| < 8) open, groups related buildings by sector,
  // and aligns every building entrance orthogonally toward the nearest street!
  const stepM = 12;
  const isFarm = bType === 'farm' || bType === 'vineyard';
  const minR = isFarm ? 24 : 12;
  const maxR = isFarm ? 96 : 72;
  const frontSign = keepX <= 0 ? 1 : -1;

  // Preferred sector direction per building branch so related chains cluster together
  const prefX =
    def.branch === 'military' || def.branch === 'craft'
      ? frontSign
      : def.branch === 'food'
        ? -frontSign
        : 0;
  const prefZ = def.branch === 'food' ? 1 : def.branch === 'craft' ? -1 : 0;

  const candidates: { x: number; z: number; yawRad: number; score: number }[] = [];
  for (let gx = -maxR; gx <= maxR; gx += stepM) {
    for (let gz = -maxR; gz <= maxR; gz += stepM) {
      if (Math.abs(gx) < 8 || Math.abs(gz) < 8) continue; // Keep axial streets clear!
      const dist = Math.hypot(gx, gz);
      if (dist < minR || dist > maxR) continue;
      const x = Math.round((keepX + gx) / 4) * 4;
      const z = Math.round((keepZ + gz) / 4) * 4;
      // Face entrance orthogonally toward the nearest axial street (z = keepZ or x = keepX)
      const yawRad =
        Math.abs(gz) <= Math.abs(gx)
          ? gz < 0
            ? 0.0
            : Math.PI
          : gx < 0
            ? Math.PI * 0.5
            : -Math.PI * 0.5;
      const sectorAlign = (prefX * Math.sign(gx) + prefZ * Math.sign(gz)) * 10;
      const score = dist - sectorAlign;
      candidates.push({ x, z, yawRad, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  for (const c of candidates) {
    if (validateBuildingPlacement(state, side, bType, c.x, c.z, c.yawRad, terrain, forest, true) === 'ok') {
      return { x: c.x, z: c.z, yawRad: c.yawRad };
    }
  }

  // Fallback spiral if grid cells are full
  for (let r = minR; r <= maxR + 16; r += 8) {
    const steps = 16;
    const offset = nextSimRand(state) * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      const ang = offset + (i / steps) * Math.PI * 2;
      const x = keepX + Math.cos(ang) * r;
      const z = keepZ + Math.sin(ang) * r;
      const yaw = Math.round(Math.atan2(keepX - x, keepZ - z) / (Math.PI * 0.5)) * (Math.PI * 0.5);
      if (validateBuildingPlacement(state, side, bType, x, z, yaw, terrain, forest, true) === 'ok') {
        return { x, z, yawRad: yaw };
      }
    }
  }
  return null;
}

/** Returns true if `side` is still in the match (not absent and its Keep still stands). */
function isSideStanding(state: SimWorldState, side: SideId): boolean {
  const s = state.sides[side];
  if (!s || s.absent) return false;
  return findKeep(state, side) !== null;
}

/**
 * Picks which rival lord `side` should march against on 2- or 3-lord maps:
 * 1. If any enemy has troops within 110 m of our Keep, prioritize the biggest threat near home.
 * 2. Otherwise pick the weaker surviving rival (by living men + distance/8), penalizing a rival
 *    that another AI is already attacking by `+AI_AGES.sharedFoeMen` so two AIs don't blindly pile on one lord!
 */
export function pickFoe(state: SimWorldState, side: SideId): SideId | null {
  const others = state.sides
    .map((s) => s.side)
    .filter((s) => s !== side && isSideStanding(state, s));
  if (others.length <= 1) return others[0] ?? null;

  const ownKeep = findKeep(state, side);
  const kx = ownKeep?.x ?? 0;
  const kz = ownKeep?.z ?? 0;
  const near = new Map<SideId, number>();
  const men = new Map<SideId, number>();

  for (const r of state.regiments) {
    if (r.side === side) continue;
    const alive = countAliveSoldiers(r);
    if (alive === 0) continue;
    men.set(r.side, (men.get(r.side) ?? 0) + alive);
    if (Math.hypot(r.x - kx, r.z - kz) < 110) {
      near.set(r.side, (near.get(r.side) ?? 0) + alive);
    }
  }

  let best = others[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of others) {
    const threat = near.get(s) ?? 0;
    const foeKeep = findKeep(state, s);
    const dist = foeKeep ? Math.hypot(foeKeep.x - kx, foeKeep.z - kz) : 0;
    const taken = state.sides.some(
      (other) => other.side !== side && !other.absent && other.aiTargetSide === s && other.aiAttacking,
    )
      ? AI_AGES.sharedFoeMen
      : 0;
    const score = threat > 0 ? -threat : (men.get(s) ?? 0) + taken + dist / 8;
    if (score < bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function agesOpen(state: SimWorldState): boolean {
  const openTimeS = state.scenario.fastAges ? AI_AGES.fastAgesAfterS : AI_AGES.agesAfterS;
  return (state.scenario.startAge ?? 1) >= 2 || state.timeS >= openTimeS;
}

function unitEra(u: UnitTypeId): number {
  const bl = UNIT_DEFS[u].barracksLevel;
  return bl >= 5 ? 3 : bl >= 4 ? 2 : 1;
}

const AGES_BUILD_ORDER: readonly BuildingTypeId[] = [
  'cathedral',
  'gunsmith',
  'powderMill',
  'townHall',
  'manufactory',
];

const MODERNISE_TARGETS: Partial<Record<UnitTypeId, readonly UnitTypeId[]>> = {
  militia: ['lineInfantry', 'musketeers', 'swordsmen', 'pikemen'],
  pikemen: ['lineInfantry', 'musketeers'],
  swordsmen: ['lineInfantry', 'musketeers'],
  halberdiers: ['lineInfantry', 'musketeers'],
  archers: ['riflemen', 'musketeers'],
  crossbowmen: ['riflemen', 'musketeers'],
  musketeers: ['lineInfantry'],
  lightCav: ['hussars', 'dragoons'],
  heavyCav: ['cuirassiers', 'hussars'],
  cuirassiers: ['hussars'],
  dragoons: ['hussars'],
};

/** Evaluates opponent's army classes and picks the highest-priority affordable counter regiment! */
export function pickCounterUnit(
  state: SimWorldState,
  side: SideId,
  personality: AiPersonality,
  barracksLevel: number,
  foundryLevel: number,
  targetFoe?: SideId | null,
): UnitTypeId | null {
  const enemySide: SideId = targetFoe ?? pickFoe(state, side) ?? (side === 0 ? 1 : 0);
  let enemyCav = 0;
  let enemyHeavy = 0;
  let enemyRanged = 0;
  for (const r of state.regiments) {
    if (r.side !== enemySide || countAliveSoldiers(r) === 0) continue;
    const d = UNIT_DEFS[r.unitType];
    if (d.unitClass === 'cavalry') enemyCav++;
    else if (d.unitClass === 'ranged') enemyRanged++;
    else if (d.armour >= 0.30 || r.unitType === 'halberdiers') enemyHeavy++;
  }

  const ownMilitia = state.regiments.filter((r) => r.side === side && r.unitType === 'militia').length;
  const sideState = state.sides[side];
  if (!sideState) return null;
  const stock = sideState.stock;

  const candidates: UnitTypeId[] = [];
  // Later ages prioritize the age's own firearm, modern cavalry, and mobile artillery arms first!
  if (barracksLevel >= 5 || foundryLevel >= 5) {
    candidates.push('lineInfantry', 'riflemen', 'hussars', 'cuirassiers', 'horseGuns', 'fieldGuns', 'cannon');
  } else if (barracksLevel >= 4 || foundryLevel >= 4) {
    candidates.push('musketeers', 'cuirassiers', 'dragoons', 'falconets', 'culverins', 'pikemen', 'halberdiers', 'cannon');
  }

  if (enemyCav >= 2) candidates.push('pikemen', 'halberdiers');
  if (enemyHeavy >= 2) candidates.push('riflemen', 'musketeers', 'crossbowmen', 'halberdiers');
  if (enemyRanged >= 2) candidates.push('hussars', 'cuirassiers', 'dragoons', 'lightCav', 'heavyCav', 'swordsmen');

  if (personality === 'raider') {
    candidates.push('hussars', 'dragoons', 'horseGuns', 'falconets', 'lightCav', 'archers', 'pikemen', 'swordsmen');
  } else if (personality === 'knight') {
    candidates.push('cuirassiers', 'heavyCav', 'fieldGuns', 'culverins', 'swordsmen', 'crossbowmen', 'cannon', 'pikemen', 'archers');
  } else {
    candidates.push('lineInfantry', 'musketeers', 'fieldGuns', 'culverins', 'swordsmen', 'crossbowmen', 'pikemen', 'archers', 'halberdiers', 'cannon');
  }
  if (ownMilitia < 2) candidates.push('militia');

  for (const u of candidates) {
    const def = UNIT_DEFS[u];
    if (def.gunFoundryLevel > 0 && foundryLevel < def.gunFoundryLevel) continue;
    if (def.barracksLevel > 0 && barracksLevel < def.barracksLevel) continue;
    if (hasResources(stock, def.cost)) return u;
  }
  return null;
}

/** Runs one fair-economy AI decision cycle for `side` (supports 2- or 3-lord maps and AI-vs-AI!). */
export function stepAiForSide(
  state: SimWorldState,
  side: SideId,
  personality: AiPersonality,
  difficulty: Difficulty,
  terrain: TerrainField,
  nav: NavGrid,
  forest: ForestGrid,
  onNavDirty: () => void,
): void {
  const sideState = state.sides[side];
  if (!sideState || sideState.absent) return;
  const keep = findKeep(state, side);
  if (!keep) return;

  const enemySide = pickFoe(state, side);
  sideState.aiTargetSide = enemySide ?? undefined;
  const enemyKeep = enemySide !== null ? findKeep(state, enemySide) : null;
  const sideBuildings = state.buildings.filter((b) => b.side === side && b.hp > 0);
  const constructingCount = sideBuildings.filter((b) => b.buildProgress < 1).length;
  const keepEra = eraOfKeepLevel(keep.level);
  const barracks = sideBuildings.find((b) => b.type === 'barracks' && b.buildProgress >= 1);
  const stock = sideState.stock;

  // 0. In Era 2+ with a Barracks, prioritize Gunsmith & Powder Mill before expanding medieval chains
  let placedAgesBuilding = false;
  if (constructingCount < 2 && keepEra >= 2 && barracks) {
    for (const gType of ['gunsmith', 'powderMill'] as const) {
      if (sideBuildings.some((b) => b.type === gType)) continue;
      const def = BUILDING_DEFS[gType];
      if (!hasResources(stock, def.cost)) continue;
      const site = findLegalSiteForBuilding(state, side, gType, keep.x, keep.z, terrain, forest);
      if (!site) continue;
      const res = executeCommand(
        state,
        { type: 'placeBuilding', side, buildingType: gType, x: site.x, z: site.z, yawRad: site.yawRad },
        terrain,
        nav,
        forest,
        onNavDirty,
      );
      if (res.ok) {
        placedAgesBuilding = true;
        break;
      }
    }
  }

  // 1. Fair-economy building construction (max 2 concurrent sites; check materials so workshops never starve!)
  if (!placedAgesBuilding && constructingCount < 2) {
    const order = getBuildOrder(personality);
    for (const goal of order) {
      const existing = sideBuildings.filter((b) => b.type === goal.type).length;
      if (existing >= goal.count) continue;
      const def = BUILDING_DEFS[goal.type];
      if ((stock.gold ?? 0) < (def.cost.gold ?? 0)) break;
      if (goal.type !== 'woodcutter' && (stock.timber ?? 0) < (def.cost.timber ?? 0)) break;
      if (goal.type !== 'quarry' && (stock.stone ?? 0) < (def.cost.stone ?? 0)) break;
      const site = findLegalSiteForBuilding(state, side, goal.type, keep.x, keep.z, terrain, forest);
      if (!site) continue;
      const res = executeCommand(
        state,
        { type: 'placeBuilding', side, buildingType: goal.type, x: site.x, z: site.z, yawRad: site.yawRad },
        terrain,
        nav,
        forest,
        onNavDirty,
      );
      if (res.ok) {
        if (stock.stone >= 45) {
          // Lay orthogonal cobbled street segment connecting the new block toward the Keep axial street!
          const roadCornerX = Math.abs(site.z - keep.z) <= Math.abs(site.x - keep.x) ? site.x : keep.x;
          const roadCornerZ = Math.abs(site.z - keep.z) <= Math.abs(site.x - keep.x) ? keep.z : site.z;
          executeCommand(
            state,
            { type: 'placeRoad', side, x0: roadCornerX, z0: roadCornerZ, x1: keep.x, z1: keep.z },
            terrain,
            nav,
            forest,
            onNavDirty,
          );
        }
        placedAgesBuilding = true;
        break;
      }
    }
  }

  // 1b. Great Buildings, Era 2+ Iron expansion & later-age workshops once Ages are open
  if (!placedAgesBuilding && constructingCount < 2 && agesOpen(state)) {
    // In Era 2+ (or Keep L3 preparing for Era 2), expand iron supply with a 2nd ironMine & 2nd smelter so musketeers never stall!
    if (keep.level >= 3) {
      for (const ironType of ['ironMine', 'smelter'] as const) {
        const count = sideBuildings.filter((b) => b.type === ironType).length;
        if (count >= 2) continue;
        const def = BUILDING_DEFS[ironType];
        if (!hasResources(stock, def.cost)) continue;
        const site = findLegalSiteForBuilding(state, side, ironType, keep.x, keep.z, terrain, forest);
        if (!site) continue;
        const res = executeCommand(
          state,
          { type: 'placeBuilding', side, buildingType: ironType, x: site.x, z: site.z, yawRad: site.yawRad },
          terrain,
          nav,
          forest,
          onNavDirty,
        );
        if (res.ok) {
          placedAgesBuilding = true;
          break;
        }
      }
    }
    if (!placedAgesBuilding) {
      for (const aType of AGES_BUILD_ORDER) {
        const def = BUILDING_DEFS[aType];
        if (keep.level < (def.keepLevel ?? 1)) continue;
        if (sideBuildings.some((b) => b.type === aType)) continue;
        if (!hasResources(stock, def.cost)) continue;
        const site = findLegalSiteForBuilding(state, side, aType, keep.x, keep.z, terrain, forest);
        if (!site) continue;
        const res = executeCommand(
          state,
          { type: 'placeBuilding', side, buildingType: aType, x: site.x, z: site.z, yawRad: site.yawRad },
          terrain,
          nav,
          forest,
          onNavDirty,
        );
        if (res.ok) break;
      }
    }
  }

  // 2. Keep upgrade (L1->L3 normally; L3->L5 once Ages are open, buying missing planks/iron/stone at Market!)
  const maxKeepTarget = agesOpen(state) ? 5 : 3;
  if (keep.level < maxKeepTarget && keep.upgradingToLevel === null) {
    const minTimeForLevel = keep.level === 1 ? 260 : keep.level === 2 ? 580 : 0;
    if (state.timeS >= minTimeForLevel) {
      const nextKeep = ECONOMY.keepLevels[keep.level as 1 | 2 | 3 | 4];
      if (nextKeep && keep.level >= 3 && sideBuildings.some((b) => b.type === 'market' && b.buildProgress >= 1)) {
        const keepCost: Partial<Record<GoodId, number>> = nextKeep.cost;
        const keepGold = keepCost.gold ?? 0;
        for (const g of ALL_GOODS) {
          if (g === 'gold') continue;
          const req = keepCost[g] ?? 0;
          if (req <= 0 || (stock[g] ?? 0) >= req) continue;
          const lotPrice = Math.round(ECONOMY.marketLotSize * GOOD_VALUE_GOLD[g] * ECONOMY.marketBuyMul);
          if (stock.gold - lotPrice >= keepGold) {
            executeCommand(state, { type: 'marketTrade', side, good: g, action: 'buy' }, terrain, nav, forest, onNavDirty);
            break;
          }
        }
      }
      executeCommand(state, { type: 'upgradeBuilding', side, buildingId: keep.id }, terrain, nav, forest, onNavDirty);
    }
  }
  if (barracks && barracks.level < keep.level && barracks.upgradingToLevel === null) {
    executeCommand(state, { type: 'upgradeBuilding', side, buildingId: barracks.id }, terrain, nav, forest, onNavDirty);
  }
  const foundryUp = sideBuildings.find((b) => b.type === 'gunFoundry' && b.buildProgress >= 1);
  if (foundryUp && foundryUp.level < keep.level && foundryUp.upgradingToLevel === null) {
    executeCommand(state, { type: 'upgradeBuilding', side, buildingId: foundryUp.id }, terrain, nav, forest, onNavDirty);
  }
  // In Era 2+, upgrade ironMine & smelter (up to L3) so firearm armies have plentiful iron!
  if (keepEra >= 2) {
    const ironUpgradeTarget = sideBuildings.find(
      (b) =>
        (b.type === 'ironMine' || b.type === 'smelter' || b.type === 'gunsmith' || b.type === 'powderMill') &&
        b.buildProgress >= 1 &&
        b.upgradingToLevel === null &&
        b.level < Math.min(3, keep.level),
    );
    if (ironUpgradeTarget) {
      executeCommand(state, { type: 'upgradeBuilding', side, buildingId: ironUpgradeTarget.id }, terrain, nav, forest, onNavDirty);
    }
  }

  // 2b. Regulate armament workshop orders through Barracks (`orderUnitEquipment`) when equipment stock + pendingOrders are low
  const orderUnits: UnitTypeId[] =
    personality === 'raider'
      ? ['archers', 'pikemen', 'lightCav', 'swordsmen']
      : personality === 'knight'
        ? ['pikemen', 'archers', 'swordsmen', 'heavyCav']
        : ['pikemen', 'archers', 'swordsmen', 'crossbowmen'];
  if (keepEra >= 2) orderUnits.unshift('musketeers', 'cuirassiers', 'dragoons');
  if (keepEra >= 3) orderUnits.unshift('lineInfantry', 'riflemen', 'hussars');

  for (const u of orderUnits) {
    const uDef = UNIT_DEFS[u];
    for (const eqGood of ['weapons', 'bows', 'leatherArmour', 'mail', 'horses', 'muskets', 'powder'] as const) {
      const req = uDef.cost[eqGood] ?? 0;
      if (req <= 0) continue;
      const wType =
        eqGood === 'weapons'
          ? 'smithy'
          : eqGood === 'bows'
            ? 'fletcher'
            : eqGood === 'leatherArmour'
              ? 'tannery'
              : eqGood === 'mail'
                ? 'armourer'
                : eqGood === 'horses'
                  ? 'stable'
                  : eqGood === 'muskets'
                    ? 'gunsmith'
                    : 'powderMill';
      const shops = sideBuildings.filter((b) => b.type === wType);
      if (shops.length === 0) continue;
      const pending = shops.reduce((s, b) => s + (b.pendingOrders ?? 0), 0);
      if ((stock[eqGood] ?? 0) + pending < req) {
        executeCommand(state, { type: 'orderUnitEquipment', side, unitType: u }, terrain, nav, forest, onNavDirty);
        break;
      }
    }
  }

  // 3. Recruitment & Militia/Cross-Age modernization refitting
  const pop = countPopulation(state, side);
  const barracksLvl = barracks ? barracks.level : 0;
  const foundry = sideBuildings.find((b) => b.type === 'gunFoundry' && b.buildProgress >= 1);
  const foundryLvl = foundry ? foundry.level : 0;

  if (pop.total >= ECONOMY.minFreeCarriers + 6) {
    const unitChoice = pickCounterUnit(state, side, personality, barracksLvl, foundryLvl, enemySide);
    if (unitChoice) {
      executeCommand(state, { type: 'recruit', side, unitType: unitChoice }, terrain, nav, forest, onNavDirty);
    }
  }

  // Refit militia or outdated Era 1/2 regiments near Barracks when arms & barracks level are ready!
  if (barracks) {
    let refitted = false;
    for (const r of state.regiments) {
      if (refitted) break;
      if (r.side !== side || r.refittingTo !== null || r.routing || r.outOfCombatS < 3) continue;
      if (Math.hypot(r.x - barracks.x, r.z - barracks.z) > 40) continue;
      const isMilitia = r.unitType === 'militia';
      if (!isMilitia && unitEra(r.unitType) >= keepEra) continue;
      const targets = MODERNISE_TARGETS[r.unitType] ?? [];
      for (const tgt of targets) {
        if (!UNIT_DEFS[r.unitType].refitTargets.includes(tgt)) continue;
        if (barracks.level < UNIT_DEFS[tgt].barracksLevel) continue;
        const res = executeCommand(
          state,
          { type: 'refitRegiment', side, regimentId: r.id, targetType: tgt },
          terrain,
          nav,
          forest,
          onNavDirty,
        );
        if (res.ok) {
          refitted = true;
          break;
        }
      }
    }
  }

  // 4. Tactical Field Orders (Defence against ANY foe, Capture Points, Flanking & Relief, Wave Assaults!)
  const ownRegs = state.regiments.filter(
    (r) => r.side === side && !r.routing && r.garrisonedInBuildingId === null && countAliveSoldiers(r) > 0,
  );
  if (ownRegs.length === 0) {
    sideState.aiAttacking = false;
    return;
  }

  const allHostileRegs = state.regiments.filter(
    (r) => r.side !== side && !r.routing && r.garrisonedInBuildingId === null && countAliveSoldiers(r) > 0,
  );
  const foeRegs = enemySide !== null ? allHostileRegs.filter((r) => r.side === enemySide) : [];

  // 4.0 Tactical Stance & Formation reflexes (RULES.md §11 & PLAN §3.2):
  //   - Pike/halberd infantry braces Pike Wall vs approaching cavalry (< 55 m)
  //   - Shielded infantry raises Shield Wall for 4 s when taking arrow/bolt fire
  //   - Musketeers / Line Infantry form Hollow Square vs nearby cavalry (< 26 m) & Volley Fire vs infantry!
  if (difficulty !== 'easy') {
    for (const r of ownRegs) {
      const rDef = UNIT_DEFS[r.unitType];
      if (rDef.unitClass === 'infantry' && rDef.antiCavBonus > 0) {
        const cavApproaching = allHostileRegs.some(
          (e) =>
            UNIT_DEFS[e.unitType].unitClass === 'cavalry' &&
            !e.dismounted &&
            Math.hypot(e.x - r.x, e.z - r.z) < 55,
        );
        if (cavApproaching && r.stance !== 'pikeWall') {
          executeCommand(state, { type: 'setStance', side, regimentIds: [r.id], stance: 'pikeWall' }, terrain, nav, forest, onNavDirty);
        } else if (!cavApproaching && r.stance === 'pikeWall') {
          const cavStillClose = allHostileRegs.some(
            (e) =>
              UNIT_DEFS[e.unitType].unitClass === 'cavalry' &&
              !e.dismounted &&
              Math.hypot(e.x - r.x, e.z - r.z) < 68,
          );
          if (!cavStillClose) {
            executeCommand(state, { type: 'setStance', side, regimentIds: [r.id], stance: 'guard' }, terrain, nav, forest, onNavDirty);
          }
        }
      } else if (rDef.unitClass === 'infantry' && rDef.shieldBlock >= 0.2) {
        if ((r.aiShieldWallTimerS ?? 0) > 0 && r.stance !== 'shieldWall') {
          executeCommand(state, { type: 'setStance', side, regimentIds: [r.id], stance: 'shieldWall' }, terrain, nav, forest, onNavDirty);
        } else if ((r.aiShieldWallTimerS ?? 0) <= 0 && r.stance === 'shieldWall') {
          executeCommand(state, { type: 'setStance', side, regimentIds: [r.id], stance: 'guard' }, terrain, nav, forest, onNavDirty);
        }
      }

      if (r.unitType !== 'musketeers' && r.unitType !== 'lineInfantry') continue;
      const nearCav = allHostileRegs.some(
        (e) =>
          UNIT_DEFS[e.unitType].unitClass === 'cavalry' &&
          !e.dismounted &&
          Math.hypot(e.x - r.x, e.z - r.z) < 26,
      );
      if (nearCav && r.formation !== 'square') {
        executeCommand(state, { type: 'setFormation', side, regimentIds: [r.id], formation: 'square' }, terrain, nav, forest, onNavDirty);
      } else if (!nearCav && r.formation === 'square') {
        const cavStillClose = allHostileRegs.some(
          (e) =>
            UNIT_DEFS[e.unitType].unitClass === 'cavalry' &&
            !e.dismounted &&
            Math.hypot(e.x - r.x, e.z - r.z) < 38,
        );
        if (!cavStillClose) {
          executeCommand(state, { type: 'setFormation', side, regimentIds: [r.id], formation: 'line' }, terrain, nav, forest, onNavDirty);
        }
      }
      const nearInf = allHostileRegs.some((e) => Math.hypot(e.x - r.x, e.z - r.z) < 62);
      if (nearInf && r.stance !== 'volleyFire') {
        executeCommand(state, { type: 'setStance', side, regimentIds: [r.id], stance: 'volleyFire' }, terrain, nav, forest, onNavDirty);
      }
    }
  }

  // 4a. Defend Keep if ANY enemy enters < 95 m (keep braced Pike Wall / Square holding steady!)
  const threatAtHome = allHostileRegs.find((e) => Math.hypot(e.x - keep.x, e.z - keep.z) < 95);
  if (threatAtHome) {
    sideState.aiAttacking = false;
    for (const r of ownRegs) {
      if (r.stance === 'pikeWall' || r.formation === 'square') continue;
      if (!r.order || r.order.targetRegimentId !== threatAtHome.id) {
        executeCommand(
          state,
          {
            type: 'issueOrder',
            side,
            regimentIds: [r.id],
            order: {
              kind: UNIT_DEFS[r.unitType].unitClass === 'cavalry' ? 'charge' : 'attack',
              x: threatAtHome.x,
              z: threatAtHome.z,
              targetRegimentId: threatAtHome.id,
            },
          },
          terrain,
          nav,
          forest,
          onNavDirty,
        );
      }
    }
    return;
  }

  // 4b. Send 1 free non-militia unit to capture nearest unowned strategic point!
  const mobileRegs = ownRegs.filter((r) => UNIT_DEFS[r.unitType].homeDefenceRadiusM === undefined);
  const unownedCp = state.capturePoints
    .filter((cp) => cp.owner !== side)
    .sort((a, b) => Math.hypot(a.x - keep.x, a.z - keep.z) - Math.hypot(b.x - keep.x, b.z - keep.z))[0];
  if (unownedCp && mobileRegs.length >= 2) {
    const scout = mobileRegs.find(
      (r) => !r.order && r.stance !== 'pikeWall' && r.formation !== 'square' && UNIT_DEFS[r.unitType].unitClass !== 'siege',
    );
    if (scout) {
      executeCommand(
        state,
        { type: 'issueOrder', side, regimentIds: [scout.id], order: { kind: 'march', x: unownedCp.x, z: unownedCp.z } },
        terrain,
        nav,
        forest,
        onNavDirty,
      );
    }
  }

  // 4c. Escalating attack waves (Raider strikes early with 2+ regs; Builder/Knight muster 4+ regs)
  const waveThreshold = personality === 'raider' ? 2 : personality === 'knight' ? 3 : 4;
  if (mobileRegs.length >= waveThreshold && enemyKeep) {
    sideState.aiAttacking = true;
    const useFlankAndRelief = difficulty !== 'easy';
    // Morale relief: pull back battered regiment (< 40% morale) if reserve available
    if (useFlankAndRelief) {
      for (const r of mobileRegs) {
        if (r.morale < r.maxMorale * 0.4 && r.outOfCombatS < 3) {
          executeCommand(
            state,
            { type: 'issueOrder', side, regimentIds: [r.id], order: { kind: 'fallbackKeep', x: keep.x, z: keep.z } },
            terrain,
            nav,
            forest,
            onNavDirty,
          );
        }
      }
    }

    // Main assault target: nearest regiment of chosen foe, else chosen foe's Keep
    const primaryEnemy: RegimentEntity | null =
      foeRegs.slice().sort((a, b) => Math.hypot(a.x - keep.x, a.z - keep.z) - Math.hypot(b.x - keep.x, b.z - keep.z))[0] ??
      null;
    for (const r of mobileRegs) {
      if (r.order !== null || r.stance === 'pikeWall' || r.formation === 'square') continue;
      const def = UNIT_DEFS[r.unitType];
      if (primaryEnemy) {
        // Flanking cavalry arcs around enemy line on Normal/Hard!
        if (useFlankAndRelief && def.unitClass === 'cavalry' && Math.hypot(r.x - primaryEnemy.x, r.z - primaryEnemy.z) > 28) {
          const flankX = primaryEnemy.x + Math.cos(primaryEnemy.yawRad) * 24;
          const flankZ = primaryEnemy.z - Math.sin(primaryEnemy.yawRad) * 24;
          executeCommand(
            state,
            { type: 'issueOrder', side, regimentIds: [r.id], order: { kind: 'charge', x: flankX, z: flankZ } },
            terrain,
            nav,
            forest,
            onNavDirty,
          );
          executeCommand(
            state,
            { type: 'issueOrder', side, regimentIds: [r.id], order: { kind: 'charge', x: primaryEnemy.x, z: primaryEnemy.z, targetRegimentId: primaryEnemy.id }, queue: true },
            terrain,
            nav,
            forest,
            onNavDirty,
          );
        } else {
          executeCommand(
            state,
            {
              type: 'issueOrder',
              side,
              regimentIds: [r.id],
              order: { kind: def.unitClass === 'cavalry' ? 'charge' : 'attack', x: primaryEnemy.x, z: primaryEnemy.z, targetRegimentId: primaryEnemy.id },
            },
            terrain,
            nav,
            forest,
            onNavDirty,
          );
        }
      } else {
        executeCommand(
          state,
          {
            type: 'issueOrder',
            side,
            regimentIds: [r.id],
            order: { kind: 'attack', x: enemyKeep.x, z: enemyKeep.z, targetBuildingId: enemyKeep.id },
          },
          terrain,
          nav,
          forest,
          onNavDirty,
        );
      }
    }
  } else {
    sideState.aiAttacking = false;
  }
}
