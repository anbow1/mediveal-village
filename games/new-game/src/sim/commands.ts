// Pure-TS Single Deterministic Command Dispatcher (zero three.js).
// Player, AI, and Campaign scenarios execute identical commands through `executeCommand()`.

import {
  BUILDING_DEFS,
  CAMPAIGN,
  COMBAT,
  ECONOMY,
  EQUIPMENT_GOODS,
  GOOD_TO_WORKSHOP,
  GOOD_VALUE_GOLD,
  isEquipmentWorkshop,
  REINFORCE,
  TRANSPORT_LEVELS,
  UNIT_DEFS,
  WORLD,
  type BuildingTypeId,
  type GoodId,
  type ResourceMap,
} from '../config.ts';
import {
  computeFormationSlotOffset,
  countAliveSoldiers,
  countSideArmyMen,
  disbandRegimentToTown,
  getArmyCap,
  normalizeAngle,
  pushAlert,
  refreshRegimentStats,
  spawnRegiment,
} from './combat.ts';
import { distributeQueuedEquipmentOrders, findKeep } from './economy.ts';
import type { NavGrid } from './pathing.ts';
import type { TerrainField } from './terrain.ts';
import type { ForestGrid } from './trees.ts';
import type {
  BuildingEntity,
  CommandResult,
  PlacementRejectionReason,
  SavedFormationSlot,
  SideId,
  SimCommand,
  SimWorldState,
} from './types.ts';

export function hasResources(stock: Record<GoodId, number>, cost: ResourceMap): boolean {
  for (const g of Object.keys(cost) as GoodId[]) {
    if ((stock[g] ?? 0) < (cost[g] ?? 0)) return false;
  }
  return true;
}

export function spendGoldOnly(stock: Record<GoodId, number>, cost: ResourceMap): void {
  const gold = cost.gold ?? 0;
  if (gold > 0) stock.gold = Math.max(0, stock.gold - gold);
}

export function spendAllResources(stock: Record<GoodId, number>, cost: ResourceMap): void {
  for (const g of Object.keys(cost) as GoodId[]) {
    stock[g] = Math.max(0, (stock[g] ?? 0) - (cost[g] ?? 0));
  }
}

/** Computes exact upgrade resource cost for moving a building to `targetLevel` (L2+: half timber as planks!). */
export function computeUpgradeCost(b: BuildingEntity, targetLevel: 2 | 3): ResourceMap {
  if (b.type === 'keep') {
    return { ...ECONOMY.keepLevels[targetLevel - 1]!.cost };
  }
  const base = BUILDING_DEFS[b.type].cost;
  const mul = ECONOMY.levelCostMul[targetLevel - 1]!;
  const out: ResourceMap = {};
  for (const g of Object.keys(base) as GoodId[]) {
    const raw = Math.ceil((base[g] ?? 0) * mul);
    if (g === 'timber' && targetLevel >= 2 && raw >= 2) {
      const planks = Math.floor(raw * 0.5);
      out.timber = raw - planks;
      out.planks = (out.planks ?? 0) + planks;
    } else if (raw > 0) {
      out[g] = raw;
    }
  }
  return out;
}

export interface UpgradeCheck {
  readonly canUpgrade: boolean;
  readonly targetLevel: 2 | 3 | null;
  readonly cost: ResourceMap;
  readonly missing: ResourceMap;
  readonly reason: 'ok' | 'maxLevel' | 'constructing' | 'alreadyUpgrading' | 'needsKeepUpgrade' | 'insufficientResources';
  readonly requiredKeepLevel?: number;
}

/** Evaluates upgrade cost, exact resource shortfalls, and blocking reasons for UI & command dispatch. */
export function inspectBuildingUpgrade(
  state: SimWorldState,
  side: SideId,
  b: BuildingEntity,
): UpgradeCheck {
  const def = BUILDING_DEFS[b.type];
  if (b.level >= def.maxLevel) {
    return { canUpgrade: false, targetLevel: null, cost: {}, missing: {}, reason: 'maxLevel' };
  }
  const targetLvl = (b.level + 1) as 2 | 3;
  const cost = computeUpgradeCost(b, targetLvl);
  const stock = state.sides[side].stock;
  const missing: ResourceMap = {};
  let hasMissing = false;
  for (const g of Object.keys(cost) as GoodId[]) {
    const req = cost[g] ?? 0;
    const have = Math.floor(stock[g] ?? 0);
    if (req > have) {
      missing[g] = req - have;
      hasMissing = true;
    }
  }

  if (b.buildProgress < 1) {
    return { canUpgrade: false, targetLevel: targetLvl, cost, missing, reason: 'constructing' };
  }
  if (b.upgradingToLevel !== null) {
    return { canUpgrade: false, targetLevel: targetLvl, cost, missing, reason: 'alreadyUpgrading' };
  }
  if (b.type === 'barracks') {
    const keep = findKeep(state, side);
    const maxBar = keep ? ECONOMY.keepLevels[keep.level - 1]!.maxBarracksLevel : 1;
    if (targetLvl > maxBar) {
      return {
        canUpgrade: false,
        targetLevel: targetLvl,
        cost,
        missing,
        reason: 'needsKeepUpgrade',
        requiredKeepLevel: targetLvl,
      };
    }
  }
  if (hasMissing) {
    return { canUpgrade: false, targetLevel: targetLvl, cost, missing, reason: 'insufficientResources' };
  }
  return { canUpgrade: true, targetLevel: targetLvl, cost, missing: {}, reason: 'ok' };
}

/**
 * Validates free building placement against every rule in `docs/ECONOMY.md` §7 & `docs/BUILDINGS.md`:
 *   - Map bounds, dry non-water, non-impassable mountain/ridge, max ground rise <= 2.2 m
 *   - Within Keep reach (280/330/380 m; farms/vineyards +60 m; +70 m around own buildings; anywhere for gatherers/towers)
 *   - At least 90 m from enemy Keep
 *   - Clearance >= 1.5 m from all buildings & active walls
 *   - Terrain requirements (forest <= 26 m, lake <= 16 m, stone/ore outcrop <= 15 m)
 *   - Max 64 buildings per side & gold affordability
 */
export function validateBuildingPlacement(
  state: SimWorldState,
  side: SideId,
  buildingType: BuildingTypeId,
  x: number,
  z: number,
  _yawRad: number,
  terrain: TerrainField,
  forest: ForestGrid,
  checkResources = true,
): PlacementRejectionReason {
  const def = BUILDING_DEFS[buildingType];
  if (!def.buildable) return 'blocked';

  const margin = WORLD.halfSizeM - 10;
  if (Math.abs(x) > margin || Math.abs(z) > margin) return 'outOfBounds';

  // Max 64 buildings per side
  let sideCount = 0;
  for (const b of state.buildings) {
    if (b.side === side && b.hp > 0 && b.type !== 'ruin') sideCount++;
  }
  if (sideCount >= ECONOMY.maxBuildingsPerSide) return 'maxBuildings';

  // Water & impassable mountain check across footprint
  const r = def.radiusM;
  let minH = Infinity;
  let maxH = -Infinity;
  const samplePts: readonly (readonly [number, number])[] = [
    [x, z],
    [x + r * 0.75, z],
    [x - r * 0.75, z],
    [x, z + r * 0.75],
    [x, z - r * 0.75],
  ];
  for (const [sx, sz] of samplePts) {
    if (terrain.waterDepthAt(sx, sz) > 0.05) return 'water';
    if (terrain.isImpassable(sx, sz)) return 'mountain';
    const h = terrain.heightAt(sx, sz);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  if (maxH - minH > ECONOMY.maxGroundRiseM) return 'tooSteep';

  // Keep reach & enemy keep exclusion
  const ownKeep = findKeep(state, side);
  const enemyKeep = findKeep(state, side === 0 ? 1 : 0);
  if (enemyKeep && Math.hypot(x - enemyKeep.x, z - enemyKeep.z) < ECONOMY.enemyKeepMinDistM) {
    return 'tooCloseEnemyKeep';
  }
  if (!def.anywhereOnMap && ownKeep) {
    const kLvl = ECONOMY.keepLevels[ownKeep.level - 1]!;
    const reachM = def.farmReachBonus ? kLvl.farmReachM : kLvl.reachM;
    let inReach = Math.hypot(x - ownKeep.x, z - ownKeep.z) <= reachM;
    if (!inReach) {
      for (const b of state.buildings) {
        if (b.side === side && b.hp > 0 && Math.hypot(x - b.x, z - b.z) <= ECONOMY.ownBuildingExtendM) {
          inReach = true;
          break;
        }
      }
    }
    if (!inReach) return 'outOfReach';
  }

  // Clearance >= 1.5 m from existing buildings
  for (const b of state.buildings) {
    if (b.hp <= 0) continue;
    const minD = r + BUILDING_DEFS[b.type].radiusM + ECONOMY.minBuildingClearanceM;
    if (Math.hypot(x - b.x, z - b.z) < minD) return 'blocked';
  }

  // Terrain specialty constraints
  if (def.terrainReq === 'forest') {
    const distM = def.terrainReqDistM ?? 26;
    const tree = forest.nearestMatureTree(state.trees, x, z, distM, false);
    if (!tree) return 'needsForest';
  } else if (def.terrainReq === 'lake') {
    const distM = def.terrainReqDistM ?? 16;
    let foundWater = false;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (let d = 3; d <= distM; d += 3) {
        if (terrain.waterDepthAt(x + Math.cos(ang) * d, z + Math.sin(ang) * d) > 0.15) {
          foundWater = true;
          break;
        }
      }
      if (foundWater) break;
    }
    if (!foundWater) return 'needsLake';
  } else if (def.terrainReq === 'stone' || def.terrainReq === 'ore') {
    const distM = def.terrainReqDistM ?? 15;
    const ok = state.outcrops.some((o) => o.kind === def.terrainReq && Math.hypot(x - o.x, z - o.z) <= distM);
    if (!ok) return def.terrainReq === 'stone' ? 'needsStone' : 'needsOre';
  }

  // Affordability check (gold paid at once; materials must exist in town stock to start!)
  if (checkResources) {
    const s = state.sides[side];
    if ((s.stock.gold ?? 0) < (def.cost.gold ?? 0)) return 'insufficientResources';
  }

  return 'ok';
}

/** Executes any gameplay command deterministically for Player, AI, or Scenario triggers. */
export function executeCommand(
  state: SimWorldState,
  cmd: SimCommand,
  terrain: TerrainField,
  _nav: NavGrid,
  forest: ForestGrid,
  onNavDirty: () => void,
): CommandResult {
  const sideState = state.sides[cmd.side];

  switch (cmd.type) {
    case 'placeBuilding': {
      const check = validateBuildingPlacement(state, cmd.side, cmd.buildingType, cmd.x, cmd.z, cmd.yawRad, terrain, forest, true);
      if (check !== 'ok') return { ok: false, reason: check };

      const def = BUILDING_DEFS[cmd.buildingType];
      spendGoldOnly(sideState.stock, def.cost);

      const needed: ResourceMap = {};
      for (const g of Object.keys(def.cost) as GoodId[]) {
        if (g !== 'gold' && (def.cost[g] ?? 0) > 0) needed[g] = def.cost[g];
      }
      const noMaterials = Object.keys(needed).length === 0;
      const b: BuildingEntity = {
        id: state.nextEntityId++,
        side: cmd.side,
        type: cmd.buildingType,
        level: 1,
        x: cmd.x,
        z: cmd.z,
        yawRad: cmd.yawRad,
        hp: Math.round(def.maxHp * 0.2),
        maxHp: def.maxHp,
        buildProgress: noMaterials ? 0.05 : 0.0,
        buildCostNeeded: needed,
        buildCostDelivered: {},
        upgradingToLevel: null,
        upgradeTimerS: 0,
        paused: false,
        status: 'constructing',
        inputs: {},
        yard: {},
        residents: 0,
        houseFoodRations: cmd.buildingType === 'house' ? 3 : 0,
        houseWineCasks: 0,
        hungry: false,
        growthTimerS: 0,
        cycleTimerS: 0,
        yardFullTimerS: 0,
        strips:
          cmd.buildingType === 'farm' || cmd.buildingType === 'vineyard'
            ? Array.from({ length: ECONOMY.farmStripsByLevel[0] }, () => ({ phase: 'uncleared' as const, timerS: 0, growth01: 0 }))
            : [],
        recruitQueue: [],
        fireCooldownS: 0,
        garrisonRegimentIds: [],
        garrisonType: null,
        garrisonCount: 0,
        pendingOrders: 0,
      };
      state.buildings.push(b);
      distributeQueuedEquipmentOrders(state, cmd.side);
      onNavDirty();
      state.visualRevision++;
      return { ok: true, reason: 'ok', createdId: b.id };
    }

    case 'upgradeBuilding': {
      const b = state.buildings.find((x) => x.id === cmd.buildingId && x.side === cmd.side && x.hp > 0);
      if (!b) return { ok: false, reason: 'invalidBuilding' };
      const check = inspectBuildingUpgrade(state, cmd.side, b);
      if (!check.canUpgrade || !check.targetLevel) {
        return {
          ok: false,
          reason:
            check.reason === 'maxLevel' || check.reason === 'needsKeepUpgrade' || check.reason === 'insufficientResources'
              ? check.reason
              : 'invalidBuilding',
        };
      }
      const targetLvl = check.targetLevel;
      const cost = check.cost;

      if (b.type === 'keep') {
        spendAllResources(sideState.stock, cost);
        b.buildCostNeeded = {};
        b.buildCostDelivered = {};
      } else {
        spendGoldOnly(sideState.stock, cost);
        const needed: ResourceMap = {};
        for (const g of Object.keys(cost) as GoodId[]) {
          if (g !== 'gold' && (cost[g] ?? 0) > 0) needed[g] = cost[g];
        }
        b.buildCostNeeded = needed;
        b.buildCostDelivered = {};
      }

      b.upgradingToLevel = targetLvl;
      b.upgradeTimerS = 0;
      b.status = 'upgrading';
      // Release workshop worker during upgrade so they help carry materials / build (docs/MANUAL.md §7.5)
      for (const c of state.citizens) {
        if (c.role === 'worker' && c.assignedBuildingId === b.id) {
          c.role = 'carrier';
          c.assignedBuildingId = null;
          c.workPhase = 'atShop';
        }
      }
      state.visualRevision++;
      return { ok: true, reason: 'ok' };
    }

    case 'demolishBuilding': {
      const idx = state.buildings.findIndex((x) => x.id === cmd.buildingId && x.side === cmd.side && x.hp > 0);
      if (idx === -1) return { ok: false, reason: 'invalidBuilding' };
      const b = state.buildings[idx]!;
      if (b.type === 'keep' || b.indestructible) return { ok: false, reason: 'cannotDemolishKeep' };

      // 50% base cost refund + whatever lay in the yard (docs/BUILDINGS.md)
      const baseCost = BUILDING_DEFS[b.type].cost;
      for (const g of Object.keys(baseCost) as GoodId[]) {
        const ref = Math.floor((baseCost[g] ?? 0) * ECONOMY.demolishRefundFrac);
        if (ref > 0) sideState.stock[g] = (sideState.stock[g] ?? 0) + ref;
      }
      for (const g of Object.keys(b.yard) as GoodId[]) {
        const amt = b.yard[g] ?? 0;
        if (amt > 0) sideState.stock[g] = (sideState.stock[g] ?? 0) + amt;
      }

      // Release assigned workers/builders and remove house residents belonging to demolished house
      for (const c of state.citizens) {
        if (c.assignedBuildingId === b.id) {
          c.assignedBuildingId = null;
          c.role = 'carrier';
        }
      }
      if (b.type === 'house') {
        const keep = findKeep(state, cmd.side);
        if (keep) {
          for (const c of state.citizens) {
            if (c.homeBuildingId === b.id) c.homeBuildingId = keep.id;
          }
        }
      }

      state.buildings.splice(idx, 1);
      onNavDirty();
      state.visualRevision++;
      return { ok: true, reason: 'ok' };
    }

    case 'togglePauseBuilding': {
      const b = state.buildings.find((x) => x.id === cmd.buildingId && x.side === cmd.side && x.hp > 0);
      if (!b) return { ok: false, reason: 'invalidBuilding' };
      b.paused = !b.paused;
      b.status = b.paused ? 'paused' : 'idle';
      return { ok: true, reason: 'ok' };
    }

    case 'rotateBuilding': {
      const b = state.buildings.find((x) => x.id === cmd.buildingId && x.side === cmd.side && x.hp > 0);
      if (!b || b.buildProgress >= 1) return { ok: false, reason: 'cannotRotateCompleted' };
      b.yawRad = cmd.yawRad;
      state.visualRevision++;
      return { ok: true, reason: 'ok' };
    }

    case 'rebuildRuin': {
      const b = state.buildings.find((x) => x.id === cmd.buildingId && x.side === cmd.side && x.type === 'ruin' && x.hp > 0);
      if (!b) return { ok: false, reason: 'invalidRuin' };
      const targetType: BuildingTypeId = b.ruinTargetType ?? 'house';
      const baseCost = BUILDING_DEFS[targetType].cost;
      const halfGold = Math.ceil((baseCost.gold ?? 0) * 0.5);
      if (sideState.stock.gold < halfGold) return { ok: false, reason: 'insufficientResources' };
      sideState.stock.gold -= halfGold;

      const needed: ResourceMap = {};
      for (const g of Object.keys(baseCost) as GoodId[]) {
        if (g !== 'gold' && (baseCost[g] ?? 0) > 0) needed[g] = Math.ceil((baseCost[g] ?? 0) * 0.5);
      }
      b.type = targetType;
      b.maxHp = BUILDING_DEFS[targetType].maxHp;
      b.hp = Math.round(b.maxHp * 0.25);
      b.buildProgress = Object.keys(needed).length === 0 ? 0.1 : 0.0;
      b.buildCostNeeded = needed;
      b.buildCostDelivered = {};
      b.status = 'constructing';
      state.visualRevision++;
      return { ok: true, reason: 'ok' };
    }

    case 'placeRoad': {
      const dist = Math.hypot(cmd.x1 - cmd.x0, cmd.z1 - cmd.z0);
      if (dist < 1.5) return { ok: false, reason: 'tooShort' };
      const stoneCost = 1;
      if (sideState.stock.stone < stoneCost) return { ok: false, reason: 'insufficientResources' };
      sideState.stock.stone -= stoneCost;
      state.roads.push({ x0: cmd.x0, z0: cmd.z0, x1: cmd.x1, z1: cmd.z1, widthM: 4.0 });
      onNavDirty();
      state.visualRevision++;
      return { ok: true, reason: 'ok' };
    }

    case 'placeWall': {
      const dx = cmd.x1 - cmd.x0;
      const dz = cmd.z1 - cmd.z0;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.8) return { ok: false, reason: 'tooShort' };
      // Space 2.08 m wall segments at <= 1.80 m centers so adjacent segments overlap by >= 0.28 m with zero gaps!
      const segs = Math.max(1, Math.ceil(dist / 1.80));
      const stoneCost = Math.max(1, Math.ceil((dist / 10) * ECONOMY.wallStonePer10M));
      if (sideState.stock.stone < stoneCost) return { ok: false, reason: 'insufficientResources' };
      const enemyKeep = findKeep(state, cmd.side === 0 ? 1 : 0);
      // `wall_segment` runs along its local X axis (2.08 m wide in X, 1.55 m thick in Z), so align local X with (dx, dz)!
      const yaw = Math.atan2(-dz, dx);
      for (let i = 0; i < segs; i++) {
        const t = segs === 1 ? 0.5 : (i + 0.5) / segs;
        const wx = cmd.x0 + dx * t;
        const wz = cmd.z0 + dz * t;
        if (terrain.waterDepthAt(wx, wz) > 0.1 || terrain.isImpassable(wx, wz)) {
          return { ok: false, reason: 'blocked' };
        }
        if (enemyKeep && Math.hypot(wx - enemyKeep.x, wz - enemyKeep.z) < ECONOMY.enemyKeepMinDistM) {
          return { ok: false, reason: 'tooCloseEnemyKeep' };
        }
      }
      sideState.stock.stone -= stoneCost;
      for (let i = 0; i < segs; i++) {
        const t = segs === 1 ? 0.5 : (i + 0.5) / segs;
        state.walls.push({
          id: state.nextEntityId++,
          side: cmd.side,
          x: cmd.x0 + dx * t,
          z: cmd.z0 + dz * t,
          yawRad: yaw,
          hp: ECONOMY.wallSegmentHp,
          maxHp: ECONOMY.wallSegmentHp,
          destroyed: false,
        });
      }
      onNavDirty();
      state.visualRevision++;
      return { ok: true, reason: 'ok' };
    }

    case 'placeGate': {
      if (!hasResources(sideState.stock, ECONOMY.gateCost)) return { ok: false, reason: 'insufficientResources' };
      if (terrain.waterDepthAt(cmd.x, cmd.z) > 0.1 || terrain.isImpassable(cmd.x, cmd.z)) {
        return { ok: false, reason: 'blocked' };
      }
      spendAllResources(sideState.stock, ECONOMY.gateCost);
      // If placed on/near an existing friendly wall, auto-align gate yaw to the wall line!
      let gateYaw = cmd.yawRad;
      let nearestWallDist = 5.5;
      for (const w of state.walls) {
        if (!w.destroyed && w.side === cmd.side) {
          const d = Math.hypot(w.x - cmd.x, w.z - cmd.z);
          if (d < nearestWallDist) {
            nearestWallDist = d;
            gateYaw = w.yawRad;
          }
        }
      }
      // Replace any wall segments within 3.6 m of gate center so the 6.4 m gatehouse joins flush with wall ends!
      for (const w of state.walls) {
        if (!w.destroyed && Math.hypot(w.x - cmd.x, w.z - cmd.z) <= 3.6) {
          w.destroyed = true;
          w.hp = 0;
        }
      }
      const g = {
        id: state.nextEntityId++,
        side: cmd.side,
        x: cmd.x,
        z: cmd.z,
        yawRad: gateYaw,
        hp: ECONOMY.gateHp,
        maxHp: ECONOMY.gateHp,
        openFraction: 0,
        destroyed: false,
      };
      state.gates.push(g);
      onNavDirty();
      state.visualRevision++;
      return { ok: true, reason: 'ok', createdId: g.id };
    }

    case 'marketTrade': {
      if (cmd.good === 'gold') return { ok: false, reason: 'cannotTradeGold' };
      const hasMarket = state.buildings.some(
        (b) => b.side === cmd.side && b.type === 'market' && b.buildProgress >= 1 && b.hp > 0 && !b.paused,
      );
      if (!hasMarket) return { ok: false, reason: 'needsMarket' };

      const lot = ECONOMY.marketLotSize;
      const baseUnitPrice = GOOD_VALUE_GOLD[cmd.good];
      if (cmd.action === 'sell') {
        if ((sideState.stock[cmd.good] ?? 0) < lot) return { ok: false, reason: 'insufficientResources' };
        sideState.stock[cmd.good] -= lot;
        sideState.stock.gold += Math.round(lot * baseUnitPrice * ECONOMY.marketSellMul);
      } else {
        const buyPrice = Math.round(lot * baseUnitPrice * ECONOMY.marketBuyMul);
        if (sideState.stock.gold < buyPrice) return { ok: false, reason: 'insufficientResources' };
        sideState.stock.gold -= buyPrice;
        sideState.stock[cmd.good] = (sideState.stock[cmd.good] ?? 0) + lot;
      }
      return { ok: true, reason: 'ok' };
    }

    case 'recruit': {
      const def = UNIT_DEFS[cmd.unitType];
      // Check army cap
      const curArmy = countSideArmyMen(state, cmd.side);
      const queuedArmy = state.buildings
        .filter((b) => b.side === cmd.side && b.hp > 0)
        .reduce((s, b) => s + b.recruitQueue.reduce((q, it) => q + it.neededCrew, 0), 0);
      if (curArmy + queuedArmy + def.crewCount > getArmyCap(state)) {
        return { ok: false, reason: 'armyCapReached' };
      }

      // Find appropriate recruitment building (Keep for militia, Barracks for infantry/cav, GunFoundry for artillery)
      let trainer: BuildingEntity | null = null;
      if (cmd.buildingId !== undefined) {
        trainer = state.buildings.find((b) => b.id === cmd.buildingId && b.side === cmd.side && b.hp > 0 && b.buildProgress >= 1) ?? null;
      }
      if (!trainer) {
        if (def.gunFoundryLevel > 0) {
          trainer = state.buildings.find(
            (b) => b.side === cmd.side && b.type === 'gunFoundry' && b.buildProgress >= 1 && b.hp > 0 && b.level >= def.gunFoundryLevel && b.recruitQueue.length < COMBAT.barracksQueueMax,
          ) ?? null;
        } else if (def.barracksLevel === 0) {
          trainer = findKeep(state, cmd.side);
        } else {
          trainer = state.buildings.find(
            (b) => b.side === cmd.side && b.type === 'barracks' && b.buildProgress >= 1 && b.hp > 0 && b.level >= def.barracksLevel && b.recruitQueue.length < COMBAT.barracksQueueMax,
          ) ?? null;
        }
      }
      if (!trainer) return { ok: false, reason: 'needsBarracks' };
      if (trainer.recruitQueue.length >= COMBAT.barracksQueueMax) return { ok: false, reason: 'queueFull' };
      if (def.gunFoundryLevel > 0 && (trainer.type !== 'gunFoundry' || trainer.level < def.gunFoundryLevel)) {
        return { ok: false, reason: 'needsGunFoundry' };
      }
      if (def.barracksLevel > 0 && (trainer.type !== 'barracks' || trainer.level < def.barracksLevel)) {
        return { ok: false, reason: 'needsBarracksLevel' };
      }

      // Check shared population: must always leave >= 4 free townspeople! (docs/ECONOMY.md §2)
      const nonRecruits = state.citizens.filter((c) => c.side === cmd.side && c.role !== 'recruit');
      if (nonRecruits.length - def.crewCount < ECONOMY.minFreeCarriers) {
        return { ok: false, reason: 'notEnoughPeople' };
      }

      // Check resources
      if (!hasResources(sideState.stock, def.cost)) return { ok: false, reason: 'insufficientResources' };
      spendAllResources(sideState.stock, def.cost);

      const orderId = state.nextOrderId++;
      trainer.recruitQueue.push({
        orderId,
        unitType: cmd.unitType,
        neededCrew: def.crewCount,
        arrivedCrew: 0,
        trainTimerS: 0,
      });

      // Pull `crewCount` townsfolk (carriers/builders first, then nearest workers) to walk to barracks!
      const sorted = [...nonRecruits].sort((a, b) => {
        const pA = a.role === 'carrier' ? 0 : a.role === 'builder' ? 1 : 2;
        const pB = b.role === 'carrier' ? 0 : b.role === 'builder' ? 1 : 2;
        if (pA !== pB) return pA - pB;
        return Math.hypot(a.x - trainer!.x, a.z - trainer!.z) - Math.hypot(b.x - trainer!.x, b.z - trainer!.z);
      });
      for (let i = 0; i < def.crewCount && i < sorted.length; i++) {
        const c = sorted[i]!;
        if (c.carryJob) {
          sideState.stock[c.carryJob.good] = (sideState.stock[c.carryJob.good] ?? 0) + c.carryJob.amount;
          c.carryJob = null;
        }
        c.role = 'recruit';
        c.assignedBuildingId = null;
        c.recruitTargetBuildingId = trainer.id;
        c.recruitOrderId = orderId;
        c.path = [];
      }

      return { ok: true, reason: 'ok', createdId: orderId };
    }

    case 'refitRegiment': {
      const reg = state.regiments.find((r) => r.id === cmd.regimentId && r.side === cmd.side);
      if (!reg || reg.refittingTo !== null || reg.outOfCombatS < 2) return { ok: false, reason: 'invalidRegiment' };
      const curDef = UNIT_DEFS[reg.unitType];
      if (!curDef.refitTargets.includes(cmd.targetType)) return { ok: false, reason: 'invalidRefitTarget' };
      const tgtDef = UNIT_DEFS[cmd.targetType];

      const barracks = state.buildings.find(
        (b) =>
          b.side === cmd.side &&
          b.type === 'barracks' &&
          b.buildProgress >= 1 &&
          b.hp > 0 &&
          b.level >= tgtDef.barracksLevel &&
          Math.hypot(b.x - reg.x, b.z - reg.z) <= COMBAT.refitRadiusM,
      );
      if (!barracks) return { ok: false, reason: 'needsNearbyBarracks' };

      // Pay only missing equipment per alive man + positive gold difference (docs/UNITS.md §5)
      const alive = countAliveSoldiers(reg);
      const diffCost: ResourceMap = {};
      const goldDiff = Math.max(0, Math.round((((tgtDef.cost.gold ?? 0) - (curDef.cost.gold ?? 0)) * alive) / tgtDef.count));
      if (goldDiff > 0) diffCost.gold = goldDiff;
      for (const g of Object.keys(tgtDef.equipPerMan) as GoodId[]) {
        const need = (tgtDef.equipPerMan[g] ?? 0) - (curDef.equipPerMan[g] ?? 0);
        if (need > 0) diffCost[g] = need * alive;
      }
      if (!hasResources(sideState.stock, diffCost)) return { ok: false, reason: 'insufficientResources' };
      spendAllResources(sideState.stock, diffCost);

      reg.refittingTo = cmd.targetType;
      reg.refitTimerS = 0;
      reg.order = null;
      reg.orderQueue = [];
      reg.path = [];
      return { ok: true, reason: 'ok' };
    }

    case 'mergeRegiments': {
      const a = state.regiments.find((r) => r.id === cmd.primaryId && r.side === cmd.side);
      const b = state.regiments.find((r) => r.id === cmd.secondaryId && r.side === cmd.side);
      if (!a || !b || a.id === b.id || a.unitType !== b.unitType) return { ok: false, reason: 'cannotMerge' };
      if (UNIT_DEFS[a.unitType].unitClass === 'siege') return { ok: false, reason: 'cannotMergeSiege' };

      const aliveA = a.soldiers.filter((s) => s.alive);
      const aliveB = b.soldiers.filter((s) => s.alive);
      const cap = a.maxMen;
      const room = Math.max(0, cap - aliveA.length);
      if (room === 0) return { ok: false, reason: 'primaryFull' };

      const take = Math.min(room, aliveB.length);
      const totalKills = a.kills + (b.kills * take) / Math.max(1, aliveB.length);
      b.kills = Math.max(0, b.kills - (b.kills * take) / Math.max(1, aliveB.length));
      a.kills = totalKills;

      let moved = 0;
      for (const s of b.soldiers) {
        if (!s.alive || moved >= take) continue;
        s.alive = false;
        const deadSlot = a.soldiers.find((x) => !x.alive);
        if (deadSlot) {
          deadSlot.alive = true;
          deadSlot.hp = s.hp;
          deadSlot.maxHp = s.maxHp;
          deadSlot.x = a.x;
          deadSlot.z = a.z;
        } else {
          a.soldiers.push({
            ...s,
            slotIndex: a.soldiers.length,
            alive: true,
          });
        }
        moved++;
      }

      if (!a.captainAlive && b.captainAlive) a.captainAlive = true;
      refreshRegimentStats(state, a);
      if (countAliveSoldiers(b) === 0) {
        state.regiments = state.regiments.filter((r) => r.id !== b.id);
      } else {
        refreshRegimentStats(state, b);
      }
      return { ok: true, reason: 'ok' };
    }

    case 'disbandRegiment': {
      const reg = state.regiments.find((r) => r.id === cmd.regimentId && r.side === cmd.side);
      if (!reg) return { ok: false, reason: 'invalidRegiment' };
      disbandRegimentToTown(state, reg);
      return { ok: true, reason: 'ok' };
    }

    case 'issueOrder': {
      const keep = findKeep(state, cmd.side);
      let issued = 0;
      for (const rId of cmd.regimentIds) {
        const reg = state.regiments.find((r) => r.id === rId && r.side === cmd.side);
        if (!reg || reg.routing || reg.refittingTo !== null) continue;
        const def = UNIT_DEFS[reg.unitType];

        // Militia home-defence rule: ignores orders > 115 m from own Keep or attacking buildings/walls!
        if (def.homeDefenceRadiusM !== undefined && keep) {
          if (cmd.order.targetBuildingId !== undefined || cmd.order.targetWallId !== undefined) continue;
          if (Math.hypot(cmd.order.x - keep.x, cmd.order.z - keep.z) > def.homeDefenceRadiusM) continue;
        }

        // Ungarrison if currently inside a Watchtower
        if (reg.garrisonedInBuildingId !== null && cmd.order.kind !== 'garrison') {
          const tb = state.buildings.find((b) => b.id === reg.garrisonedInBuildingId);
          if (tb) {
            tb.garrisonRegimentIds = tb.garrisonRegimentIds.filter((id) => id !== reg.id);
            tb.garrisonCount = Math.max(0, tb.garrisonCount - countAliveSoldiers(reg));
            if (tb.garrisonCount === 0) tb.garrisonType = null;
          }
          reg.garrisonedInBuildingId = null;
        }

        const resolvedOrder =
          cmd.order.kind === 'fallbackKeep' && keep
            ? { ...cmd.order, x: keep.x + 12, z: keep.z + 12 }
            : cmd.order;

        if (cmd.queue && reg.order !== null) {
          reg.orderQueue.push(resolvedOrder);
        } else {
          if (resolvedOrder.ranks !== undefined) {
            reg.ranks = Math.max(1, Math.min(8, resolvedOrder.ranks));
            reg.width = Math.max(1, Math.ceil(Math.max(1, countAliveSoldiers(reg)) / reg.ranks));
          } else if (resolvedOrder.width !== undefined) {
            reg.width = Math.max(1, Math.min(20, resolvedOrder.width));
            reg.ranks = Math.max(1, Math.ceil(Math.max(1, countAliveSoldiers(reg)) / reg.width));
          }
          reg.order = resolvedOrder;
          reg.orderQueue = [];
          reg.path = [];
          if (
            reg.stance === 'pikeWall' &&
            (resolvedOrder.kind === 'march' ||
              resolvedOrder.kind === 'run' ||
              resolvedOrder.kind === 'attack' ||
              resolvedOrder.kind === 'charge' ||
              resolvedOrder.kind === 'fallbackKeep')
          ) {
            reg.stance = 'guard';
          }
        }
        issued++;
      }
      return { ok: issued > 0, reason: issued > 0 ? 'ok' : 'noEligibleRegiments' };
    }

    case 'orderUnitEquipment': {
      const def = UNIT_DEFS[cmd.unitType];
      const countMul = Math.max(1, Math.round(cmd.count ?? 1));
      if (!sideState.equipmentOrders) sideState.equipmentOrders = {};
      let orderedAny = false;
      for (const g of EQUIPMENT_GOODS) {
        const amt = Math.round((def.cost[g] ?? 0) * countMul);
        if (amt <= 0) continue;
        orderedAny = true;
        const wType = GOOD_TO_WORKSHOP[g];
        const shops = wType
          ? state.buildings.filter((b) => b.side === cmd.side && b.hp > 0 && b.type === wType)
          : [];
        if (shops.length > 0) {
          shops.sort((a, b) => (a.pendingOrders ?? 0) - (b.pendingOrders ?? 0));
          const target = shops[0]!;
          target.pendingOrders = (target.pendingOrders ?? 0) + amt;
        } else {
          sideState.equipmentOrders[g] = (sideState.equipmentOrders[g] ?? 0) + amt;
        }
      }
      return { ok: orderedAny, reason: orderedAny ? 'ok' : 'noEquipmentNeeded' };
    }

    case 'setBuildingOrder': {
      if (cmd.buildingId === -1) {
        // Clear all equipment orders across all workshops and side queue
        sideState.equipmentOrders = {};
        for (const b of state.buildings) {
          if (b.side === cmd.side && isEquipmentWorkshop(b.type)) {
            b.pendingOrders = 0;
          }
        }
        return { ok: true, reason: 'ok' };
      }
      const b = state.buildings.find((x) => x.id === cmd.buildingId && x.side === cmd.side && x.hp > 0);
      if (!b || !isEquipmentWorkshop(b.type)) return { ok: false, reason: 'invalidBuilding' };
      b.pendingOrders = Math.max(0, Math.round(cmd.orders));
      return { ok: true, reason: 'ok' };
    }

    case 'setFormation': {
      for (const rId of cmd.regimentIds) {
        const reg = state.regiments.find((r) => r.id === rId && r.side === cmd.side);
        if (!reg) continue;
        const def = UNIT_DEFS[reg.unitType];
        if (cmd.formation === 'schiltron' && def.antiCavBonus === 0) continue;
        if (cmd.formation === 'wedge' && def.unitClass !== 'cavalry') continue;
        reg.formation = cmd.formation;
      }
      return { ok: true, reason: 'ok' };
    }

    case 'setRanks': {
      const clampedRanks = Math.max(1, Math.min(8, Math.round(cmd.ranks)));
      let updated = 0;
      for (const rId of cmd.regimentIds) {
        const reg = state.regiments.find((r) => r.id === rId && r.side === cmd.side);
        if (!reg) continue;
        const alive = Math.max(1, countAliveSoldiers(reg));
        reg.ranks = Math.min(alive, clampedRanks);
        reg.width = Math.max(1, Math.ceil(alive / reg.ranks));
        updated++;
      }
      return { ok: updated > 0, reason: updated > 0 ? 'ok' : 'noEligibleRegiments' };
    }

    case 'saveArmyFormation': {
      const regs = cmd.regimentIds
        .map((id) => state.regiments.find((r) => r.id === id && r.side === cmd.side && countAliveSoldiers(r) > 0))
        .filter((r): r is NonNullable<typeof r> => r !== undefined);
      if (regs.length < 2) return { ok: false, reason: 'needMultipleRegiments' };

      if (!sideState.savedFormations) sideState.savedFormations = [];
      let cx = 0;
      let cz = 0;
      let sumSin = 0;
      let sumCos = 0;
      for (const r of regs) {
        cx += r.x;
        cz += r.z;
        sumSin += Math.sin(r.yawRad);
        sumCos += Math.cos(r.yawRad);
      }
      cx /= regs.length;
      cz /= regs.length;
      const baseYaw = Math.hypot(sumSin, sumCos) > 1e-3 ? Math.atan2(sumSin, sumCos) : regs[0]!.yawRad;
      const fx = Math.sin(baseYaw);
      const fz = Math.cos(baseYaw);
      const rx = Math.cos(baseYaw);
      const rz = -Math.sin(baseYaw);

      // Check if regiments are overly clumped (< 4 m apart); if so, arrange into a neat tactical multi-line formation
      let clumped = false;
      for (let i = 0; i < regs.length && !clumped; i++) {
        for (let j = i + 1; j < regs.length; j++) {
          if (Math.hypot(regs[i]!.x - regs[j]!.x, regs[i]!.z - regs[j]!.z) < 4.0) {
            clumped = true;
            break;
          }
        }
      }

      const slots: SavedFormationSlot[] = regs.map((r, idx) => {
        const alive = Math.max(1, countAliveSoldiers(r));
        const ranks = r.ranks ?? Math.max(1, Math.ceil(alive / Math.max(1, r.width)));
        const width = Math.max(1, Math.ceil(alive / ranks));
        if (clumped) {
          const def = UNIT_DEFS[r.unitType];
          const isRear = def.unitClass === 'ranged' || def.unitClass === 'siege';
          const rightM = (idx - (regs.length - 1) * 0.5) * 11.5;
          const forwardM = isRear ? -5.5 : 3.5;
          return {
            regimentId: r.id,
            unitType: r.unitType,
            rightM,
            forwardM,
            relYawRad: 0,
            formation: r.formation,
            ranks,
            width,
          };
        }
        const dx = r.x - cx;
        const dz = r.z - cz;
        return {
          regimentId: r.id,
          unitType: r.unitType,
          rightM: Number((dx * rx + dz * rz).toFixed(2)),
          forwardM: Number((dx * fx + dz * fz).toFixed(2)),
          relYawRad: Number(normalizeAngle(r.yawRad - baseYaw).toFixed(3)),
          formation: r.formation,
          ranks,
          width,
        };
      });

      const nextId = sideState.savedFormations.reduce((m, f) => Math.max(m, f.id), 0) + 1;
      const name = cmd.name?.trim() || `F${nextId}`;
      sideState.savedFormations.push({ id: nextId, name, slots });
      return { ok: true, reason: 'ok', createdId: nextId };
    }

    case 'deleteArmyFormation': {
      if (!sideState.savedFormations) return { ok: false, reason: 'notFound' };
      const before = sideState.savedFormations.length;
      sideState.savedFormations = sideState.savedFormations.filter((f) => f.id !== cmd.formationId);
      return { ok: sideState.savedFormations.length < before, reason: 'ok' };
    }

    case 'setStance': {
      let updated = 0;
      for (const rId of cmd.regimentIds) {
        const reg = state.regiments.find((r) => r.id === rId && r.side === cmd.side);
        if (!reg) continue;
        const def = UNIT_DEFS[reg.unitType];
        if (cmd.stance === 'shieldWall' && def.shieldBlock < 0.2) continue;
        if (cmd.stance === 'pikeWall' && (def.antiCavBonus <= 0 || def.unitClass !== 'infantry')) continue;
        reg.stance = cmd.stance;
        if (cmd.stance === 'pikeWall') {
          reg.order = null;
          reg.orderQueue = [];
          reg.path = [];
        }
        updated++;
      }
      return { ok: updated > 0, reason: updated > 0 ? 'ok' : 'notThisUnit' };
    }

    case 'setHoldFire': {
      for (const rId of cmd.regimentIds) {
        const reg = state.regiments.find((r) => r.id === rId && r.side === cmd.side);
        if (reg) reg.holdFire = cmd.holdFire;
      }
      return { ok: true, reason: 'ok' };
    }

    case 'setGoodPriority': {
      if (!sideState.goodPriorities) sideState.goodPriorities = {};
      sideState.goodPriorities[cmd.good] = cmd.priority;
      return { ok: true, reason: 'ok' };
    }

    case 'reinforceRegiment': {
      const check = inspectRegimentReinforce(state, cmd.side, cmd.regimentId);
      if (!check.canReinforce || check.missingMen <= 0) {
        return { ok: false, reason: check.reason };
      }
      const reg = state.regiments.find((r) => r.id === cmd.regimentId && r.side === cmd.side);
      if (!reg) return { ok: false, reason: 'notFound' };
      const def = UNIT_DEFS[reg.unitType];

      // Pull `missingMen` free townsfolk (carriers/builders first)
      const nonRecruits = state.citizens.filter((c) => c.side === cmd.side && c.role !== 'recruit');
      if (nonRecruits.length - check.missingMen < ECONOMY.minFreeCarriers) {
        return { ok: false, reason: 'notEnoughPeople' };
      }
      const sorted = [...nonRecruits].sort((a, b) => {
        const pA = a.role === 'carrier' ? 0 : a.role === 'builder' ? 1 : 2;
        const pB = b.role === 'carrier' ? 0 : b.role === 'builder' ? 1 : 2;
        if (pA !== pB) return pA - pB;
        return Math.hypot(a.x - reg.x, a.z - reg.z) - Math.hypot(b.x - reg.x, b.z - reg.z);
      });
      const removeIds = new Set<number>();
      for (let i = 0; i < check.missingMen && i < sorted.length; i++) {
        const c = sorted[i]!;
        if (c.carryJob) {
          sideState.stock[c.carryJob.good] = (sideState.stock[c.carryJob.good] ?? 0) + c.carryJob.amount;
          c.carryJob = null;
        }
        removeIds.add(c.id);
      }
      state.citizens = state.citizens.filter((c) => !removeIds.has(c.id));
      spendAllResources(sideState.stock, check.cost);

      // Revive fallen soldier slots cleanly into formation while preserving veteranTier & kills!
      const fx = Math.sin(reg.yawRad);
      const fz = Math.cos(reg.yawRad);
      const rx = Math.cos(reg.yawRad);
      const rz = -Math.sin(reg.yawRad);
      let restored = 0;
      for (let i = 0; i < reg.soldiers.length && restored < check.missingMen; i++) {
        const s = reg.soldiers[i]!;
        if (s.alive) continue;
        const off = computeFormationSlotOffset(i, reg.soldiers.length, reg.width, reg.formation, def.unitClass);
        s.alive = true;
        s.hp = def.hp;
        s.maxHp = def.hp;
        s.x = reg.x + rx * off.right + fx * off.forward;
        s.z = reg.z + rz * off.right + fz * off.forward;
        s.yawRad = reg.yawRad;
        s.clip = 'idle';
        s.attackAnimTimerS = 0;
        s.deadS = undefined;
        s.hurtAtS = undefined;
        restored++;
      }
      reg.captainAlive = true;
      reg.morale = Math.min(reg.maxMorale, reg.morale + 15);
      return { ok: true, reason: 'ok' };
    }

    case 'upgradeTransport': {
      const check = inspectTransportUpgrade(state, cmd.side);
      if (!check.canUpgrade || check.targetLevel === null) {
        return { ok: false, reason: check.reason };
      }
      spendAllResources(sideState.stock, check.cost);
      sideState.upgradingTransportTo = check.targetLevel;
      sideState.transportUpgradeTimerS = TRANSPORT_LEVELS[check.targetLevel - 1]!.seconds;
      return { ok: true, reason: 'ok' };
    }

    case 'ungarrisonWatchtower': {
      const tb = state.buildings.find(
        (b) => b.id === cmd.buildingId && b.side === cmd.side && b.type === 'watchtower' && b.hp > 0,
      );
      if (!tb || tb.garrisonCount <= 0 || !tb.garrisonType) {
        return { ok: false, reason: 'noGarrison' };
      }
      const gType = tb.garrisonType;
      const gCount = tb.garrisonCount;
      let outX = tb.x + Math.sin(tb.yawRad) * 6.5;
      let outZ = tb.z + Math.cos(tb.yawRad) * 6.5;
      const isClear = (x: number, z: number): boolean =>
        terrain.waterDepthAt(x, z) <= 0.1 && !terrain.isImpassable(x, z);
      if (!isClear(outX, outZ)) {
        for (let k = 0; k < 8; k++) {
          const ang = tb.yawRad + (k * Math.PI) / 4;
          const cx = tb.x + Math.sin(ang) * 7.0;
          const cz = tb.z + Math.cos(ang) * 7.0;
          if (isClear(cx, cz)) {
            outX = cx;
            outZ = cz;
            break;
          }
        }
      }

      // If an incomplete friendly regiment of the same type is waiting right outside (<= 14 m), fold them back in!
      const nearby = state.regiments.find(
        (r) =>
          r.side === cmd.side &&
          r.unitType === gType &&
          !r.routing &&
          r.garrisonedInBuildingId === null &&
          countAliveSoldiers(r) > 0 &&
          countAliveSoldiers(r) + gCount <= r.maxMen &&
          Math.hypot(r.x - tb.x, r.z - tb.z) <= 14,
      );

      let targetRegId: number;
      if (nearby) {
        let toAdd = gCount;
        const hp = UNIT_DEFS[gType].hp;
        for (const sol of nearby.soldiers) {
          if (toAdd <= 0) break;
          if (!sol.alive) {
            sol.alive = true;
            sol.hp = hp;
            sol.maxHp = hp;
            sol.x = outX;
            sol.z = outZ;
            sol.yawRad = nearby.yawRad;
            sol.deadS = 0;
            sol.speedMs = 0;
            sol.clip = 'idle';
            toAdd--;
          }
        }
        targetRegId = nearby.id;
      } else {
        const spawned = spawnRegiment(state, cmd.side, gType, outX, outZ, tb.yawRad, { count: gCount });
        targetRegId = spawned.id;
      }

      tb.garrisonCount = 0;
      tb.garrisonType = null;
      tb.garrisonRegimentIds = [];
      state.visualRevision++;
      return { ok: true, reason: 'ok', createdId: targetRegId };
    }

    case 'payTribute': {
      if (state.scenario.mode !== 'campaign' || state.scenario.missionId !== 1) {
        return { ok: false, reason: 'notMission1' };
      }
      if (sideState.tributePaid) return { ok: false, reason: 'alreadyPaid' };
      if (!hasResources(sideState.stock, CAMPAIGN.m1Tribute)) {
        return { ok: false, reason: 'insufficientResources' };
      }
      spendAllResources(sideState.stock, CAMPAIGN.m1Tribute);
      sideState.tributePaid = true;
      const keep = findKeep(state, cmd.side);
      if (keep) pushAlert(state, cmd.side, 'tributePaid', keep.x, keep.z, 'tribute');
      return { ok: true, reason: 'ok' };
    }
  }
}

export interface ReinforceInspection {
  readonly canReinforce: boolean;
  readonly reason: 'ok' | 'notFound' | 'fullStrength' | 'inCombat' | 'needsNearbyBarracks' | 'notEnoughPeople' | 'insufficientResources';
  readonly missingMen: number;
  readonly cost: ResourceMap;
}

export function inspectRegimentReinforce(
  state: SimWorldState,
  side: SideId,
  regimentId: number,
): ReinforceInspection {
  const reg = state.regiments.find((r) => r.id === regimentId && r.side === side);
  if (!reg) return { canReinforce: false, reason: 'notFound', missingMen: 0, cost: {} };
  const def = UNIT_DEFS[reg.unitType];
  if (def.unitClass === 'siege') {
    return { canReinforce: false, reason: 'fullStrength', missingMen: 0, cost: {} };
  }
  const alive = countAliveSoldiers(reg);
  const missingMen = Math.max(0, reg.maxMen - alive);
  if (alive <= 0 || missingMen === 0) {
    return { canReinforce: false, reason: 'fullStrength', missingMen: 0, cost: {} };
  }
  if (reg.outOfCombatS < REINFORCE.quietS || reg.routing) {
    return { canReinforce: false, reason: 'inCombat', missingMen, cost: {} };
  }
  const nearTrainer = state.buildings.some((b) => {
    if (b.side !== side || b.hp <= 0 || b.buildProgress < 1) return false;
    if (def.barracksLevel === 0) {
      if (b.type !== 'keep' && b.type !== 'barracks') return false;
    } else {
      if (b.type !== 'barracks' || b.level < def.barracksLevel) return false;
    }
    return Math.hypot(b.x - reg.x, b.z - reg.z) <= REINFORCE.radiusM + BUILDING_DEFS[b.type].radiusM;
  });
  if (!nearTrainer) {
    return { canReinforce: false, reason: 'needsNearbyBarracks', missingMen, cost: {} };
  }

  const cost: ResourceMap = {};
  const goldCost = Math.max(1, Math.round(((def.cost.gold ?? 0) * missingMen) / Math.max(1, def.count)));
  if (goldCost > 0) cost.gold = goldCost;
  for (const g of Object.keys(def.equipPerMan) as GoodId[]) {
    const req = (def.equipPerMan[g] ?? 0) * missingMen;
    if (req > 0) cost[g] = req;
  }

  const nonRecruits = state.citizens.filter((c) => c.side === side && c.role !== 'recruit');
  if (nonRecruits.length - missingMen < ECONOMY.minFreeCarriers) {
    return { canReinforce: false, reason: 'notEnoughPeople', missingMen, cost };
  }
  if (!hasResources(state.sides[side].stock, cost)) {
    return { canReinforce: false, reason: 'insufficientResources', missingMen, cost };
  }
  return { canReinforce: true, reason: 'ok', missingMen, cost };
}

export interface TransportUpgradeInspection {
  readonly canUpgrade: boolean;
  readonly reason: 'ok' | 'maxLevel' | 'alreadyUpgrading' | 'needsKeepUpgrade' | 'insufficientResources';
  readonly currentLevel: 1 | 2 | 3;
  readonly targetLevel: (2 | 3) | null;
  readonly requiredKeepLevel: number | null;
  readonly cost: ResourceMap;
  readonly missing: ResourceMap;
}

export function inspectTransportUpgrade(state: SimWorldState, side: SideId): TransportUpgradeInspection {
  const s = state.sides[side];
  const currentLevel: 1 | 2 | 3 = s.transportLevel ?? 1;
  if (s.upgradingTransportTo !== null && s.upgradingTransportTo !== undefined) {
    return {
      canUpgrade: false,
      reason: 'alreadyUpgrading',
      currentLevel,
      targetLevel: s.upgradingTransportTo,
      requiredKeepLevel: null,
      cost: {},
      missing: {},
    };
  }
  if (currentLevel >= 3) {
    return {
      canUpgrade: false,
      reason: 'maxLevel',
      currentLevel,
      targetLevel: null,
      requiredKeepLevel: null,
      cost: {},
      missing: {},
    };
  }
  const targetLevel = (currentLevel + 1) as 2 | 3;
  const def = TRANSPORT_LEVELS[targetLevel - 1]!;
  const keep = findKeep(state, side);
  if (!keep || keep.level < def.keepLevel) {
    return {
      canUpgrade: false,
      reason: 'needsKeepUpgrade',
      currentLevel,
      targetLevel,
      requiredKeepLevel: def.keepLevel,
      cost: def.cost,
      missing: {},
    };
  }
  const missing: ResourceMap = {};
  for (const g of Object.keys(def.cost) as GoodId[]) {
    const req = def.cost[g] ?? 0;
    const have = Math.floor(s.stock[g] ?? 0);
    if (req > have) missing[g] = req - have;
  }
  if (Object.keys(missing).length > 0) {
    return {
      canUpgrade: false,
      reason: 'insufficientResources',
      currentLevel,
      targetLevel,
      requiredKeepLevel: def.keepLevel,
      cost: def.cost,
      missing,
    };
  }
  return {
    canUpgrade: true,
    reason: 'ok',
    currentLevel,
    targetLevel,
    requiredKeepLevel: def.keepLevel,
    cost: def.cost,
    missing: {},
  };
}

