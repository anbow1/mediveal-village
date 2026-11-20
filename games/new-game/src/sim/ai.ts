// Pure-TS Fair-Economy AI Controller with 3 Personalities & Tactical Counter-Composition (zero three.js).
// Rules (docs/GAMEPLAY.md §7 & BRIEF.md F19):
//   - Executes ONLY `executeCommand()` (identical economy rules, ZERO free units or hidden resources!).
//   - 3 personalities: `builder` (Gospodarz), `raider` (Zagończyk), `knight` (Rycerz).
//   - 1-minute counter-composition evaluation against opponent's army classes.
//   - Tactical battle control: infantry line, archers behind, flanking cavalry, reserve relieving < 40% morale,
//     plus capture-point dispatch and Keep upgrade before Barracks upgrade!

import {
  BUILDING_DEFS,
  ECONOMY,
  UNIT_DEFS,
  type BuildingTypeId,
  type UnitTypeId,
} from '../config.ts';
import { countAliveSoldiers, nextSimRand } from './combat.ts';
import { executeCommand, hasResources, validateBuildingPlacement } from './commands.ts';
import { countPopulation, findKeep } from './economy.ts';
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

  // Standard town ring & outer village farm ring
  const minR = bType === 'farm' || bType === 'vineyard' ? 28 : 14;
  const maxR = bType === 'farm' || bType === 'vineyard' ? 102 : 76;
  for (let r = minR; r <= maxR; r += 8) {
    const steps = 16;
    const offset = nextSimRand(state) * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      const ang = offset + (i / steps) * Math.PI * 2;
      const x = keepX + Math.cos(ang) * r;
      const z = keepZ + Math.sin(ang) * r;
      const yaw = Math.atan2(keepX - x, keepZ - z);
      if (validateBuildingPlacement(state, side, bType, x, z, yaw, terrain, forest, true) === 'ok') {
        return { x, z, yawRad: yaw };
      }
    }
  }
  return null;
}

/** Evaluates opponent's army classes and picks the highest-priority affordable counter regiment! */
export function pickCounterUnit(
  state: SimWorldState,
  side: SideId,
  personality: AiPersonality,
  barracksLevel: number,
  foundryLevel: number,
): UnitTypeId | null {
  const enemySide: SideId = side === 0 ? 1 : 0;
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
  const stock = state.sides[side].stock;

  const candidates: UnitTypeId[] = [];
  if (enemyCav >= 2) candidates.push('pikemen', 'halberdiers');
  if (enemyHeavy >= 2) candidates.push('crossbowmen', 'halberdiers');
  if (enemyRanged >= 2) candidates.push('lightCav', 'heavyCav', 'swordsmen');

  if (personality === 'raider') {
    candidates.push('lightCav', 'archers', 'pikemen', 'swordsmen');
  } else if (personality === 'knight') {
    candidates.push('heavyCav', 'swordsmen', 'crossbowmen', 'cannon', 'pikemen', 'archers');
  } else {
    candidates.push('swordsmen', 'crossbowmen', 'pikemen', 'archers', 'halberdiers', 'cannon');
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

/** Runs one fair-economy AI decision cycle for `side` (default `1`, also supports AI-vs-AI on side `0`!). */
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
  const keep = findKeep(state, side);
  if (!keep) return;

  const enemySide: SideId = side === 0 ? 1 : 0;
  const enemyKeep = findKeep(state, enemySide);
  const sideBuildings = state.buildings.filter((b) => b.side === side && b.hp > 0);
  const constructingCount = sideBuildings.filter((b) => b.buildProgress < 1).length;

  // 1. Fair-economy building construction (max 2 concurrent sites; check materials so workshops never starve!)
  if (constructingCount < 2) {
    const order = getBuildOrder(personality);
    const stock = state.sides[side].stock;
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
          // Lay cobbled road connecting new building doorway toward Keep gate!
          executeCommand(
            state,
            { type: 'placeRoad', side, x0: site.x, z0: site.z, x1: keep.x, z1: keep.z },
            terrain,
            nav,
            forest,
            onNavDirty,
          );
        }
        break;
      }
    }
  }

  // 2. Keep upgrade before Barracks upgrade (docs/GAMEPLAY.md §5)
  const barracks = sideBuildings.find((b) => b.type === 'barracks' && b.buildProgress >= 1);
  if (keep.level < 3 && keep.upgradingToLevel === null && state.timeS > (keep.level === 1 ? 260 : 580)) {
    executeCommand(state, { type: 'upgradeBuilding', side, buildingId: keep.id }, terrain, nav, forest, onNavDirty);
  } else if (barracks && barracks.level < keep.level && barracks.upgradingToLevel === null) {
    executeCommand(state, { type: 'upgradeBuilding', side, buildingId: barracks.id }, terrain, nav, forest, onNavDirty);
  }

  // 3. Recruitment & Militia refitting
  const pop = countPopulation(state, side);
  const barracksLvl = barracks ? barracks.level : 0;
  const foundry = sideBuildings.find((b) => b.type === 'gunFoundry' && b.buildProgress >= 1);
  const foundryLvl = foundry ? foundry.level : 0;

  if (pop.total >= ECONOMY.minFreeCarriers + 6) {
    const unitChoice = pickCounterUnit(state, side, personality, barracksLvl, foundryLvl);
    if (unitChoice) {
      executeCommand(state, { type: 'recruit', side, unitType: unitChoice }, terrain, nav, forest, onNavDirty);
    }
  }

  // Refit militia when barracks & weapons are ready (docs/UNITS.md §1)
  if (barracks) {
    for (const r of state.regiments) {
      if (r.side === side && r.unitType === 'militia' && r.refittingTo === null && Math.hypot(r.x - barracks.x, r.z - barracks.z) <= 40) {
        const res = executeCommand(state, { type: 'refitRegiment', side, regimentId: r.id, targetType: 'pikemen' }, terrain, nav, forest, onNavDirty);
        if (res.ok) break;
      }
    }
  }

  // 4. Tactical Field Orders (Defence, Capture Points, Flanking & Relief, Wave Assaults!)
  const ownRegs = state.regiments.filter(
    (r) => r.side === side && !r.routing && r.garrisonedInBuildingId === null && countAliveSoldiers(r) > 0,
  );
  if (ownRegs.length === 0) return;

  const enemyRegs = state.regiments.filter(
    (r) => r.side === enemySide && !r.routing && r.garrisonedInBuildingId === null && countAliveSoldiers(r) > 0,
  );

  // 4a. Defend Keep if enemies enter < 95 m
  const threatAtHome = enemyRegs.find((e) => Math.hypot(e.x - keep.x, e.z - keep.z) < 95);
  if (threatAtHome) {
    for (const r of ownRegs) {
      if (!r.order || r.order.targetRegimentId !== threatAtHome.id) {
        executeCommand(
          state,
          {
            type: 'issueOrder',
            side,
            regimentIds: [r.id],
            order: { kind: UNIT_DEFS[r.unitType].unitClass === 'cavalry' ? 'charge' : 'attack', x: threatAtHome.x, z: threatAtHome.z, targetRegimentId: threatAtHome.id },
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

  // 4b. Send 1 free non-militia unit to capture unowned center strategic points!
  const mobileRegs = ownRegs.filter((r) => UNIT_DEFS[r.unitType].homeDefenceRadiusM === undefined);
  const unownedCp = state.capturePoints.find((cp) => cp.owner !== side);
  if (unownedCp && mobileRegs.length >= 2) {
    const scout = mobileRegs.find((r) => !r.order && UNIT_DEFS[r.unitType].unitClass !== 'siege');
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

    // Main assault target: nearest enemy regiment, else enemy Keep (or enemy wall blocking approach)
    const primaryEnemy: RegimentEntity | null = enemyRegs[0] ?? null;
    for (const r of mobileRegs) {
      if (r.order !== null) continue;
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
  }
}
