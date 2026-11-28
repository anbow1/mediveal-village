// Pure-TS Living Medieval Town Economy, Shared Population & Physical Carrier Logistics (zero three.js).
// Matches docs/ECONOMY.md & docs/BUILDINGS.md canonical rules and numbers.

import {
  AI_AGES,
  ALL_GOODS,
  BUILDING_DEFS,
  CARRIER_PRIORITY,
  CART_SPACING,
  ECONOMY,
  EQUIPMENT_GOODS,
  FOOD_GOODS,
  FOOD_RATIONS_PER_UNIT,
  GOOD_TO_WORKSHOP,
  GREAT,
  isEquipmentWorkshop,
  isFirearmWorkshop,
  KEEP_BAYS,
  MEDIEVAL_MAX_LEVEL,
  TRANSPORT_LEVELS,
  type EraNumber,
  type GoodId,
  type ResourceMap,
} from '../config.ts';
import type { NavGrid } from './pathing.ts';
import type { TerrainField } from './terrain.ts';
import type { ForestGrid } from './trees.ts';
import type {
  BuildingEntity,
  SideId,
  SideState,
  SimWorldState,
  TownsfolkEntity,
} from './types.ts';

/** Returns the Era (1 = Middle Ages, 2 = Early Modern, 3 = 19th Century) corresponding to a Keep level 1..5. */
export function eraOfKeepLevel(keepLevel: number): EraNumber {
  if (keepLevel <= MEDIEVAL_MAX_LEVEL) return 1;
  return keepLevel >= 5 ? 3 : 2;
}

/** Returns the current Era (1..3) of `side` from its Keep level. */
export function eraOfSide(state: SimWorldState, side: SideId): EraNumber {
  const keep = findKeep(state, side);
  return keep ? eraOfKeepLevel(keep.level) : 1;
}

/** Workshop speed multiplier granted by a completed Manufactory (1.2x). */
export function greatWorkSpeedFactor(state: SimWorldState, side: SideId): number {
  return state.sides[side]?.hasManufactory ? GREAT.manufactoryWorkSpeedMultiplier : 1.0;
}

/** House gold tax multiplier granted by a completed Town Hall (1.25x). */
export function greatTaxFactor(state: SimWorldState, side: SideId): number {
  return state.sides[side]?.hasTownHall ? GREAT.townHallGoldMultiplier : 1.0;
}

export interface ProductionRateEntry {
  readonly good: GoodId;
  readonly stock: number;
  readonly producedPerMin: number;
  readonly netPerMin: number;
}

export interface BottleneckEntry {
  readonly buildingId: number;
  readonly buildingType: BuildingEntity['type'];
  readonly x: number;
  readonly z: number;
  readonly status: BuildingEntity['status'];
  readonly missingGood?: GoodId;
}

export function totalMapUnits(map: ResourceMap): number {
  let sum = 0;
  for (const k of Object.keys(map) as GoodId[]) {
    sum += map[k] ?? 0;
  }
  return sum;
}

export function countFoodRationsInStock(stock: Record<GoodId, number>): number {
  let total = 0;
  for (const g of FOOD_GOODS) {
    total += (stock[g] ?? 0) * (FOOD_RATIONS_PER_UNIT[g] ?? 1);
  }
  return total;
}

/** Consumes `rationsNeeded` from a side's Keep food store (preferring sausages -> bread -> fish). Returns true if fully fed. */
export function consumeRationsFromStock(side: SideState, rationsNeeded: number): boolean {
  let rem = rationsNeeded;
  // Prefer bread, fish, then sausages so small fractions consume cleanly
  const order: readonly GoodId[] = ['bread', 'fish', 'sausages'];
  for (const g of order) {
    if (rem <= 1e-6) break;
    const perUnit = FOOD_RATIONS_PER_UNIT[g] ?? 1;
    const availUnits = side.stock[g] ?? 0;
    if (availUnits <= 0) continue;
    const takeUnits = Math.min(availUnits, rem / perUnit);
    side.stock[g] = Math.max(0, availUnits - takeUnits);
    recordConsumed(side, g, takeUnits);
    rem -= takeUnits * perUnit;
  }
  return rem <= 1e-4;
}

export function recordProduced(side: SideState, good: GoodId, amount: number): void {
  if (amount <= 0) return;
  side.currentBucketProduced[good] = (side.currentBucketProduced[good] ?? 0) + amount;
}

export function recordConsumed(side: SideState, good: GoodId, amount: number): void {
  if (amount <= 0) return;
  side.currentBucketConsumed[good] = (side.currentBucketConsumed[good] ?? 0) + amount;
}

export function findKeep(state: SimWorldState, side: SideId): BuildingEntity | null {
  for (const b of state.buildings) {
    if (b.side === side && b.type === 'keep' && b.hp > 0) return b;
  }
  return null;
}

export function findNearestDepot(
  state: SimWorldState,
  side: SideId,
  x: number,
  z: number,
): BuildingEntity | null {
  let best: BuildingEntity | null = null;
  let bestSq = Infinity;
  for (const b of state.buildings) {
    if (b.side !== side || b.hp <= 0 || b.buildProgress < 1) continue;
    if (b.type !== 'keep' && b.type !== 'storehouse') continue;
    const dSq = (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z);
    if (dSq < bestSq) {
      bestSq = dSq;
      best = b;
    }
  }
  return best;
}

export function computeMaterialDeliveryFraction(b: BuildingEntity): number {
  let needed = 0;
  let delivered = 0;
  for (const g of Object.keys(b.buildCostNeeded) as GoodId[]) {
    if (g === 'gold') continue;
    const n = b.buildCostNeeded[g] ?? 0;
    if (n <= 0) continue;
    needed += n;
    delivered += Math.min(n, b.buildCostDelivered[g] ?? 0);
  }
  return needed <= 0 ? 1.0 : Math.min(1.0, delivered / needed);
}

/** Spawns a new townsfolk resident belonging to `homeBuildingId`. */
export function spawnCitizen(state: SimWorldState, side: SideId, home: BuildingEntity): TownsfolkEntity {
  const c: TownsfolkEntity = {
    id: state.nextEntityId++,
    side,
    role: 'carrier',
    homeBuildingId: home.id,
    assignedBuildingId: null,
    x: home.x + Math.sin(home.yawRad) * 3.5,
    z: home.z + Math.cos(home.yawRad) * 3.5,
    yawRad: home.yawRad,
    travelM: 0,
    fleeing: false,
    fleeClearTimerS: 0,
    path: [],
    carryJob: null,
    recruitTargetBuildingId: null,
    recruitOrderId: null,
    workPhase: 'atShop',
    workTargetX: home.x,
    workTargetZ: home.z,
    workTargetTreeId: null,
    workTimerS: 0,
    carryingGood: null,
    carryingAmount: 0,
  };
  state.citizens.push(c);
  return c;
}

/**
 * Computes exact world-space position & orientation of strip `stripIndex` (0..11) behind a Farm or Vineyard
 * (opposite the front door `+Z` local, arranged in 2 columns × 6 rows, 11.2 × 2.6 m per strip; docs/ECONOMY.md §5-§6).
 */
export function computeBuildingStripTransform(
  b: { readonly x: number; readonly z: number; readonly yawRad: number },
  stripIndex: number,
): { readonly cx: number; readonly cz: number; readonly lenM: number; readonly widM: number; readonly yawRad: number } {
  const col = stripIndex % 2;
  const row = Math.floor(stripIndex / 2);
  const lateralM = col === 0 ? -6.1 : 6.1;
  const rearM = -(8.4 + row * 3.35);
  const fx = Math.sin(b.yawRad);
  const fz = Math.cos(b.yawRad);
  const rx = Math.cos(b.yawRad);
  const rz = -Math.sin(b.yawRad);
  return {
    cx: b.x + rx * lateralM + fx * rearM,
    cz: b.z + rz * lateralM + fz * rearM,
    lenM: 11.2,
    widM: 2.6,
    yawRad: -b.yawRad,
  };
}

/** Distributes any queued side-level equipment orders onto existing workshops of the matching type. */
export function distributeQueuedEquipmentOrders(state: SimWorldState, side: SideId): void {
  const eqOrders = state.sides[side].equipmentOrders;
  if (!eqOrders) return;
  const orderGoods: readonly GoodId[] = [...EQUIPMENT_GOODS, 'muskets', 'powder'];
  for (const g of orderGoods) {
    const amt = Math.floor(eqOrders[g] ?? 0);
    if (amt <= 0) continue;
    const wType = GOOD_TO_WORKSHOP[g];
    if (!wType) continue;
    const shops = state.buildings.filter((b) => b.side === side && b.hp > 0 && b.type === wType);
    if (shops.length === 0) continue;
    shops.sort((a, b) => (a.pendingOrders ?? 0) - (b.pendingOrders ?? 0));
    const target = shops[0]!;
    target.pendingOrders = (target.pendingOrders ?? 0) + amt;
    eqOrders[g] = 0;
  }
}

/** Runs every 1 s: automatically allocates workers -> builders (30% of free, max 3/site) -> carriers (min 4 free!). */
export function allocateRolesForSide(state: SimWorldState, side: SideId): void {
  distributeQueuedEquipmentOrders(state, side);
  const citizens = state.citizens.filter((c) => c.side === side && c.role !== 'recruit');
  const activeSites = state.buildings.filter(
    (b) => b.side === side && b.hp > 0 && (b.buildProgress < 1 || b.upgradingToLevel !== null),
  );
  const workshops = state.buildings.filter(
    (b) =>
      b.side === side &&
      b.hp > 0 &&
      b.buildProgress >= 1 &&
      b.upgradingToLevel === null &&
      !b.paused &&
      BUILDING_DEFS[b.type].workers > 0 &&
      (!isEquipmentWorkshop(b.type) || (b.pendingOrders ?? 0) > 0),
  );

  // Reserve at least 4 carriers + 1 builder if any site is building/upgrading (docs/ECONOMY.md §2)
  const reserveCount = ECONOMY.minFreeCarriers + (activeSites.length > 0 ? 1 : 0);
  const maxWorkers = Math.max(0, citizens.length - reserveCount);

  // Validate existing worker assignments first
  const assignedShopIds = new Set<number>();
  const usedCitizenIds = new Set<number>();
  let workerCount = 0;

  for (const c of citizens) {
    if (c.role === 'worker' && c.assignedBuildingId !== null && workerCount < maxWorkers) {
      const shop = workshops.find((w) => w.id === c.assignedBuildingId);
      if (shop && !assignedShopIds.has(shop.id)) {
        assignedShopIds.add(shop.id);
        usedCitizenIds.add(c.id);
        workerCount++;
        continue;
      }
    }
  }

  // Assign nearest free citizens to unmanned workshops
  for (const shop of workshops) {
    if (workerCount >= maxWorkers) break;
    if (assignedShopIds.has(shop.id)) continue;
    let best: TownsfolkEntity | null = null;
    let bestSq = Infinity;
    for (const c of citizens) {
      if (usedCitizenIds.has(c.id)) continue;
      // Don't rip a carrier mid-delivery with cargo on their back
      if (c.carryJob && c.carryJob.pickedUp) continue;
      const dSq = (c.x - shop.x) * (c.x - shop.x) + (c.z - shop.z) * (c.z - shop.z);
      if (dSq < bestSq) {
        bestSq = dSq;
        best = c;
      }
    }
    if (best) {
      best.role = 'worker';
      best.assignedBuildingId = shop.id;
      best.carryJob = null;
      best.workPhase = 'atShop';
      assignedShopIds.add(shop.id);
      usedCitizenIds.add(best.id);
      workerCount++;
    }
  }

  // Remaining citizens split into builders (30% of free hands, max 3 per site) and carriers
  const freeCitizens = citizens.filter((c) => !usedCitizenIds.has(c.id));
  const maxBuilders =
    activeSites.length === 0
      ? 0
      : Math.min(
          activeSites.length * ECONOMY.maxBuildersPerSite,
          Math.max(1, Math.round(freeCitizens.length * ECONOMY.builderShareOfFree)),
        );

  const siteBuilderCounts = new Map<number, number>();
  let builderCount = 0;

  for (const c of freeCitizens) {
    // Keep carriers holding active cargo as carriers until delivered
    if (c.carryJob && c.carryJob.pickedUp) {
      c.role = 'carrier';
      c.assignedBuildingId = null;
      continue;
    }
    if (builderCount < maxBuilders && activeSites.length > 0) {
      // Pick active site with fewest builders (< 3)
      let targetSite: BuildingEntity | null = null;
      let minCount: number = ECONOMY.maxBuildersPerSite;
      for (const s of activeSites) {
        const cnt = siteBuilderCounts.get(s.id) ?? 0;
        if (cnt < minCount) {
          minCount = cnt;
          targetSite = s;
        }
      }
      if (targetSite) {
        c.role = 'builder';
        c.assignedBuildingId = targetSite.id;
        c.carryJob = null;
        siteBuilderCounts.set(targetSite.id, (siteBuilderCounts.get(targetSite.id) ?? 0) + 1);
        builderCount++;
        continue;
      }
    }
    c.role = 'carrier';
    c.assignedBuildingId = null;
  }
}

/** Moves a citizen along their current path/destination with road (1.4x) and forest (0.7x) speeds. */
function moveCitizenToward(
  c: TownsfolkEntity,
  tx: number,
  tz: number,
  dtS: number,
  nav: NavGrid,
  usePathing = false,
  arrivalRadiusM = 2.2,
  paceMul = 1.0,
): boolean {
  const directDist = Math.hypot(tx - c.x, tz - c.z);
  if (directDist <= arrivalRadiusM) {
    c.path = [];
    return true;
  }

  let destX = tx;
  let destZ = tz;

  if (usePathing) {
    const last = c.path[c.path.length - 1];
    if (!last || Math.hypot(last.x - tx, last.z - tz) > arrivalRadiusM + 4.5) {
      if (directDist > arrivalRadiusM + 8) {
        c.path = nav.findPath(c.x, c.z, tx, tz, c.side, 4000);
      } else {
        c.path = [{ x: tx, z: tz }];
      }
    }
    if (c.path.length > 0) {
      destX = c.path[0]!.x;
      destZ = c.path[0]!.z;
    }
  }

  const dx = destX - c.x;
  const dz = destZ - c.z;
  const dist = Math.hypot(dx, dz);
  const speed = ECONOMY.citizenWalkSpeedMs * paceMul * nav.speedMultiplierAt(c.x, c.z) * (c.fleeing ? 1.35 : 1.0);
  const step = speed * dtS;

  if (dist <= Math.max(0.45, step)) {
    c.x = destX;
    c.z = destZ;
    c.travelM += dist;
    if (usePathing && c.path.length > 0) {
      c.path.shift();
      return c.path.length === 0 && Math.hypot(tx - c.x, tz - c.z) <= arrivalRadiusM + 1.5;
    }
    return Math.hypot(tx - c.x, tz - c.z) <= arrivalRadiusM + 1.5;
  }

  c.yawRad = Math.atan2(dx, dz);
  c.x += (dx / dist) * step;
  c.z += (dz / dist) * step;
  c.travelM += step;
  return Math.hypot(tx - c.x, tz - c.z) <= arrivalRadiusM;
}

/** Finds nearest building (producer yard or depot) holding at least 1 unit of `good`. */
function findSourceForGood(
  state: SimWorldState,
  side: SideId,
  good: GoodId,
  destX: number,
  destZ: number,
  allowDepots = true,
  excludeBuildingId = -1,
): { building: BuildingEntity; fromDepot: boolean; available: number } | null {
  const sideState = state.sides[side];
  let best: { building: BuildingEntity; fromDepot: boolean; available: number } | null = null;
  let bestDist = Infinity;

  // Check producer yards first
  for (const b of state.buildings) {
    if (b.side !== side || b.hp <= 0 || b.id === excludeBuildingId) continue;
    const avail = Math.floor(b.yard[good] ?? 0);
    if (avail <= 0) continue;
    const d = Math.hypot(b.x - destX, b.z - destZ);
    if (d < bestDist) {
      bestDist = d;
      best = { building: b, fromDepot: false, available: avail };
    }
  }

  // Check Keep + Storehouses (shared town stock)
  if (allowDepots && Math.floor(sideState.stock[good] ?? 0) > 0) {
    const depot = findNearestDepot(state, side, destX, destZ);
    if (depot && depot.id !== excludeBuildingId) {
      const d = Math.hypot(depot.x - destX, depot.z - destZ);
      if (d < bestDist) {
        best = { building: depot, fromDepot: true, available: Math.floor(sideState.stock[good] ?? 0) };
      }
    }
  }

  return best;
}

/**
 * Assigns the highest-priority carrier job for an idle carrier following docs/ECONOMY.md §3 strict 6-tier queue:
 *   1. Food to house with empty pantry
 *   2. Timber / planks / stone to construction / upgrade site
 *   3. Food to house below 5 rations (+ wine to house below 3 casks)
 *   4. Yard output to Keep/Storehouse when town stock is low (< 8)
 *   5. Raw material to active workshop with input < 8 (empty first; skip full yard >= 24)
 *   6. Remaining yard output (>= 4 units) to nearest Keep/Storehouse
 */
function assignCarrierJob(state: SimWorldState, c: TownsfolkEntity): void {
  const side = c.side;
  const sideState = state.sides[side];
  const carryCap = TRANSPORT_LEVELS[(sideState.transportLevel ?? 1) - 1]!.capacity;
  const buildings = state.buildings;

  // Count in-flight reservations per (toBuildingId, good) so carriers don't pile 5 trips onto one slot
  const inFlight = new Map<string, number>();
  for (const other of state.citizens) {
    if (other.side === side && other.carryJob) {
      const key = `${other.carryJob.toBuildingId}:${other.carryJob.good}`;
      inFlight.set(key, (inFlight.get(key) ?? 0) + other.carryJob.amount);
    }
  }
  const getReserved = (bId: number, good: GoodId): number => inFlight.get(`${bId}:${good}`) ?? 0;

  const tryPickFood = (house: BuildingEntity, needRations: number): boolean => {
    for (const fg of FOOD_GOODS) {
      const src = findSourceForGood(state, side, fg, house.x, house.z, true, house.id);
      if (!src) continue;
      const perUnit = FOOD_RATIONS_PER_UNIT[fg] ?? 1;
      const wantUnits = Math.max(1, Math.min(carryCap, Math.ceil(needRations / perUnit), src.available));
      if (wantUnits <= 0) continue;
      // Reserve immediately from source per docs/ECONOMY.md §3 ("disappears from source ledger on acceptance")
      if (src.fromDepot) sideState.stock[fg] = Math.max(0, (sideState.stock[fg] ?? 0) - wantUnits);
      else src.building.yard[fg] = Math.max(0, (src.building.yard[fg] ?? 0) - wantUnits);
      c.carryJob = {
        good: fg,
        amount: wantUnits,
        fromBuildingId: src.building.id,
        toBuildingId: house.id,
        forConstruction: false,
        pickedUp: false,
        transferTimerS: 0,
      };
      c.path = [];
      return true;
    }
    return false;
  };

  // Tier 1: House with empty pantry
  const emptyHouses = buildings
    .filter((b) => b.side === side && b.hp > 0 && b.type === 'house' && b.buildProgress >= 1 && b.houseFoodRations < 0.5)
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
  for (const h of emptyHouses) {
    const incoming = FOOD_GOODS.reduce((s, g) => s + getReserved(h.id, g) * (FOOD_RATIONS_PER_UNIT[g] ?? 1), 0);
    if (incoming >= ECONOMY.houseFoodTargetRations) continue;
    if (tryPickFood(h, ECONOMY.houseFoodTargetRations - h.houseFoodRations - incoming)) return;
  }

  // Tier 2: Timber / planks / stone / iron to construction or upgrade sites
  const sites = buildings
    .filter((b) => b.side === side && b.hp > 0 && (b.buildProgress < 1 || b.upgradingToLevel !== null))
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
  for (const s of sites) {
    for (const matGood of ['timber', 'planks', 'stone', 'iron'] as const) {
      const needed = (s.buildCostNeeded[matGood] ?? 0) - (s.buildCostDelivered[matGood] ?? 0) - getReserved(s.id, matGood);
      if (needed <= 0) continue;
      const src = findSourceForGood(state, side, matGood, s.x, s.z, true, s.id);
      if (!src) continue;
      const take = Math.min(carryCap, Math.ceil(needed), src.available);
      if (take <= 0) continue;
      if (src.fromDepot) sideState.stock[matGood] = Math.max(0, (sideState.stock[matGood] ?? 0) - take);
      else src.building.yard[matGood] = Math.max(0, (src.building.yard[matGood] ?? 0) - take);
      c.carryJob = {
        good: matGood,
        amount: take,
        fromBuildingId: src.building.id,
        toBuildingId: s.id,
        forConstruction: true,
        pickedUp: false,
        transferTimerS: 0,
      };
      c.path = [];
      return;
    }
  }

  // Tier 3: House below 5 rations
  const lowHouses = buildings
    .filter((b) => b.side === side && b.hp > 0 && b.type === 'house' && b.buildProgress >= 1 && b.houseFoodRations < ECONOMY.houseFoodTargetRations)
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
  for (const h of lowHouses) {
    const incoming = FOOD_GOODS.reduce((s, g) => s + getReserved(h.id, g) * (FOOD_RATIONS_PER_UNIT[g] ?? 1), 0);
    const need = ECONOMY.houseFoodTargetRations - h.houseFoodRations - incoming;
    if (need < 1) continue;
    if (tryPickFood(h, need)) return;
  }

  // Tier 3b: Wine to houses (< 3 casks) after food, before workshop inputs (docs/ECONOMY.md §5)
  const wineHouses = buildings
    .filter((b) => b.side === side && b.hp > 0 && b.type === 'house' && b.buildProgress >= 1 && b.houseWineCasks < ECONOMY.houseWineTargetCasks - 0.5)
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
  for (const h of wineHouses) {
    const need = ECONOMY.houseWineTargetCasks - h.houseWineCasks - getReserved(h.id, 'wine');
    if (need < 1) continue;
    const src = findSourceForGood(state, side, 'wine', h.x, h.z, true, h.id);
    if (!src) break;
    const take = Math.min(carryCap, Math.ceil(need), src.available);
    if (src.fromDepot) sideState.stock.wine = Math.max(0, sideState.stock.wine - take);
    else src.building.yard.wine = Math.max(0, (src.building.yard.wine ?? 0) - take);
    c.carryJob = {
      good: 'wine',
      amount: take,
      fromBuildingId: src.building.id,
      toBuildingId: h.id,
      forConstruction: false,
      pickedUp: false,
      transferTimerS: 0,
    };
    c.path = [];
    return;
  }

  const goodPriScore = (g: GoodId): number => {
    const p = sideState.goodPriorities?.[g] ?? 0;
    return p > 0 ? CARRIER_PRIORITY.high : p < 0 ? CARRIER_PRIORITY.low : 0;
  };

  // Tier 4: Yard output to nearest depot when Keep stock of that good is low (< 8) or marked high priority
  let bestTier4: { b: BuildingEntity; g: GoodId; amt: number; depot: BuildingEntity; score: number } | null = null;
  for (const b of buildings) {
    if (b.side !== side || b.hp <= 0 || b.buildProgress < 1) continue;
    for (const g of Object.keys(b.yard) as GoodId[]) {
      const avail = Math.floor(b.yard[g] ?? 0);
      if (avail <= 0) continue;
      const pri = goodPriScore(g);
      if ((sideState.stock[g] ?? 0) >= 8 && pri <= 0) continue;
      const depot = findNearestDepot(state, side, b.x, b.z);
      if (!depot || depot.id === b.id) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      const score = pri - d * 4;
      if (!bestTier4 || score > bestTier4.score) {
        bestTier4 = { b, g, amt: Math.min(carryCap, avail), depot, score };
      }
    }
  }
  if (bestTier4 && bestTier4.score > -700) {
    bestTier4.b.yard[bestTier4.g] = Math.max(0, (bestTier4.b.yard[bestTier4.g] ?? 0) - bestTier4.amt);
    c.carryJob = {
      good: bestTier4.g,
      amount: bestTier4.amt,
      fromBuildingId: bestTier4.b.id,
      toBuildingId: bestTier4.depot.id,
      forConstruction: false,
      pickedUp: false,
      transferTimerS: 0,
    };
    c.path = [];
    return;
  }

  // Tier 5: Raw materials to workshops (priority-weighted, empty input first; skip workshops with full yard >= 24!)
  const workshopNeeds: { b: BuildingEntity; g: GoodId; need: number; score: number }[] = [];
  for (const b of buildings) {
    if (b.side !== side || b.hp <= 0 || b.buildProgress < 1 || b.paused) continue;
    const recipe = BUILDING_DEFS[b.type].recipe;
    if (!recipe) continue;
    if (totalMapUnits(b.yard) >= ECONOMY.workshopYardMax) continue;
    for (const g of Object.keys(recipe.inputs) as GoodId[]) {
      const have = (b.inputs[g] ?? 0) + getReserved(b.id, g);
      const need = ECONOMY.workshopInputMax - have;
      if (need < 1) continue;
      const empty = (b.inputs[g] ?? 0) < (recipe.inputs[g] ?? 1);
      const dist = Math.hypot(b.x - c.x, b.z - c.z);
      const outBonus = Object.keys(recipe.outputs).reduce((mx, og) => Math.max(mx, goodPriScore(og as GoodId)), 0);
      const score = Math.max(goodPriScore(g), outBonus) + (empty ? 320 : 0) - dist * 4;
      workshopNeeds.push({ b, g, need, score });
    }
  }
  workshopNeeds.sort((a, b) => b.score - a.score);
  for (const req of workshopNeeds) {
    const src = findSourceForGood(state, side, req.g, req.b.x, req.b.z, true, req.b.id);
    if (!src) continue;
    const take = Math.min(carryCap, Math.floor(req.need), src.available);
    if (take <= 0) continue;
    if (src.fromDepot) sideState.stock[req.g] = Math.max(0, (sideState.stock[req.g] ?? 0) - take);
    else src.building.yard[req.g] = Math.max(0, (src.building.yard[req.g] ?? 0) - take);
    c.carryJob = {
      good: req.g,
      amount: take,
      fromBuildingId: src.building.id,
      toBuildingId: req.b.id,
      forConstruction: false,
      pickedUp: false,
      transferTimerS: 0,
    };
    c.path = [];
    return;
  }

  // Tier 6: Collect yard output >= 4 to nearest depot (priority-weighted)
  let bestTier6: { b: BuildingEntity; g: GoodId; amt: number; depot: BuildingEntity; score: number } | null = null;
  for (const b of buildings) {
    if (b.side !== side || b.hp <= 0 || b.buildProgress < 1) continue;
    const totalYard = totalMapUnits(b.yard);
    if (totalYard < ECONOMY.yardPickupThreshold) continue;
    for (const g of Object.keys(b.yard) as GoodId[]) {
      const avail = Math.floor(b.yard[g] ?? 0);
      if (avail <= 0) continue;
      const depot = findNearestDepot(state, side, b.x, b.z);
      if (!depot || depot.id === b.id) continue;
      const d = Math.hypot(b.x - c.x, b.z - c.z);
      const score = goodPriScore(g) - d * 4;
      if (!bestTier6 || score > bestTier6.score) {
        bestTier6 = { b, g, amt: Math.min(carryCap, avail), depot, score };
      }
    }
  }
  if (bestTier6) {
    bestTier6.b.yard[bestTier6.g] = Math.max(0, (bestTier6.b.yard[bestTier6.g] ?? 0) - bestTier6.amt);
    c.carryJob = {
      good: bestTier6.g,
      amount: bestTier6.amt,
      fromBuildingId: bestTier6.b.id,
      toBuildingId: bestTier6.depot.id,
      forConstruction: false,
      pickedUp: false,
      transferTimerS: 0,
    };
    c.path = [];
  }
}

function getBuildingById(state: SimWorldState, id: number): BuildingEntity | null {
  for (const b of state.buildings) if (b.id === id) return b;
  return null;
}

/** Main 60 Hz economy & living-town step. */
export function stepEconomy(
  state: SimWorldState,
  dtS: number,
  terrain: TerrainField,
  nav: NavGrid,
  forest: ForestGrid,
  aiProdMul: number,
): { forestChanged: boolean } {
  // 1. 1-second automatic role allocation across all active sides
  state.roleAllocTimerS += dtS;
  if (state.roleAllocTimerS >= 1.0) {
    state.roleAllocTimerS -= 1.0;
    for (const s of state.sides) {
      if (!s.absent) allocateRolesForSide(state, s.side);
    }
  }

  // 1b. Transport Upgrade timers (L1 On Foot -> L2 Handcarts -> L3 Horse & Wagon)
  for (const sideSt of state.sides) {
    if (sideSt.absent) continue;
    if (sideSt.upgradingTransportTo !== null) {
      sideSt.transportUpgradeTimerS -= dtS;
      if (sideSt.transportUpgradeTimerS <= 0) {
        sideSt.transportLevel = sideSt.upgradingTransportTo;
        sideSt.upgradingTransportTo = null;
        sideSt.transportUpgradeTimerS = 0;
        state.visualRevision++;
      }
    }
  }

  // 2. Sapling regrowth (Forester speeds up 2x) & auto-paving of planned roads once stone arrives
  let forestChanged = forest.stepRegrowth(state.trees, state.buildings, dtS);
  for (const rd of state.roads) {
    if (!rd.planned) continue;
    const rdSide = state.sides[rd.side ?? 0];
    if (!rdSide || rdSide.absent) continue;
    const need = rd.stoneNeeded ?? 1;
    if ((rdSide.stock.stone ?? 0) >= need) {
      rdSide.stock.stone -= need;
      recordConsumed(rdSide, 'stone', need);
      rd.planned = false;
      forestChanged = true;
      state.visualRevision++;
    }
  }

  // Build quick building lookup & worker-presence sets
  const buildingById = new Map<number, BuildingEntity>();
  const buildersAtSite = new Map<number, number>();
  const workerAtShop = new Map<number, TownsfolkEntity>();
  for (const b of state.buildings) buildingById.set(b.id, b);

  // Track active Chapels, Great Buildings (Cathedral, Town Hall, Manufactory) & Wells per side
  for (const s of state.sides) {
    s.hasChapel = false;
    s.hasCathedral = false;
    s.hasTownHall = false;
    s.hasManufactory = false;
  }
  const wells: BuildingEntity[] = [];
  for (const b of state.buildings) {
    if (b.hp <= 0 || b.buildProgress < 1) continue;
    const st = state.sides[b.side];
    if (!st || st.absent) continue;
    if (b.type === 'chapel' && !b.paused) st.hasChapel = true;
    else if (b.type === 'cathedral' && !b.paused) st.hasCathedral = true;
    else if (b.type === 'townHall' && !b.paused) st.hasTownHall = true;
    else if (b.type === 'manufactory' && !b.paused) st.hasManufactory = true;
    else if (b.type === 'well' && !b.paused) wells.push(b);
  }

  // 3. Step townsfolk (threat fleeing, carriers, builders, field workers, recruits)
  const enemyFleeSq = ECONOMY.workerFleeRadiusM * ECONOMY.workerFleeRadiusM;
  for (const c of state.citizens) {
    const keep = findKeep(state, c.side);
    // Check nearby enemy regiments (< 32 m)
    let enemyNear = false;
    for (const reg of state.regiments) {
      if (reg.side === c.side || reg.routing || reg.garrisonedInBuildingId !== null) continue;
      let anyAlive = false;
      for (const s of reg.soldiers) {
        if (s.alive) {
          anyAlive = true;
          break;
        }
      }
      if (!anyAlive) continue;
      const dSq = (reg.x - c.x) * (reg.x - c.x) + (reg.z - c.z) * (reg.z - c.z);
      if (dSq <= enemyFleeSq) {
        enemyNear = true;
        break;
      }
    }

    if (enemyNear) {
      c.fleeing = true;
      c.fleeClearTimerS = ECONOMY.workerReturnDelayS;
    } else if (c.fleeing) {
      c.fleeClearTimerS -= dtS;
      if (c.fleeClearTimerS <= 0) {
        c.fleeing = false;
        c.fleeClearTimerS = 0;
      }
    }

    if (c.fleeing && keep) {
      moveCitizenToward(c, keep.x, keep.z, dtS, nav, false, BUILDING_DEFS.keep.radiusM + 1.2);
      continue;
    }

    // Recruit walking to barracks/keep
    if (c.role === 'recruit' && c.recruitTargetBuildingId !== null) {
      const targetB = buildingById.get(c.recruitTargetBuildingId);
      if (!targetB || targetB.hp <= 0) {
        c.role = 'carrier';
        c.recruitTargetBuildingId = null;
        c.recruitOrderId = null;
        continue;
      }
      const arrived = moveCitizenToward(c, targetB.x, targetB.z, dtS, nav, true, BUILDING_DEFS[targetB.type].radiusM + 1.8);
      if (arrived) {
        const qItem = targetB.recruitQueue.find((q) => q.orderId === c.recruitOrderId);
        if (qItem) qItem.arrivedCrew++;
        // Remove townsfolk from civilian pool (now part of the regiment!)
        const home = buildingById.get(c.homeBuildingId);
        if (home && home.residents > 0) home.residents--;
        c.assignedBuildingId = -999; // Mark for removal
      }
      continue;
    }

    // Builder walking to & building construction/upgrade site
    if (c.role === 'builder' && c.assignedBuildingId !== null) {
      const site = buildingById.get(c.assignedBuildingId);
      if (!site || site.hp <= 0 || (site.buildProgress >= 1 && site.upgradingToLevel === null)) {
        c.role = 'carrier';
        c.assignedBuildingId = null;
        c.workPhase = 'atShop';
        continue;
      }
      const siteRad = BUILDING_DEFS[site.type].radiusM;
      // Orbit between 4 scaffolding corners around the site while hammering!
      const cornerIdx = (c.id + Math.floor(state.timeS / 3.8)) % 4;
      const cornerAng = site.yawRad + (cornerIdx + 0.5) * Math.PI * 0.5;
      const tx = site.x + Math.sin(cornerAng) * (siteRad + 0.95);
      const tz = site.z + Math.cos(cornerAng) * (siteRad + 0.95);
      const dist = Math.hypot(site.x - c.x, site.z - c.z);
      if (dist > siteRad + 2.2) {
        c.workPhase = 'toField';
        moveCitizenToward(c, tx, tz, dtS, nav, true, 0.9);
      } else {
        buildersAtSite.set(site.id, (buildersAtSite.get(site.id) ?? 0) + 1);
        if (Math.hypot(tx - c.x, tz - c.z) > 0.75) {
          c.workPhase = 'toField';
          moveCitizenToward(c, tx, tz, dtS, nav, false, 0.5);
        } else {
          c.workPhase = 'working';
          c.path = [];
          c.yawRad = Math.atan2(site.x - c.x, site.z - c.z);
        }
      }
      continue;
    }

    // Carrier executing 6-tier physical logistics job (with 10 Keep perimeter stations per docs/RULES.md §3!)
    if (c.role === 'carrier') {
      c.workPhase = 'atShop';
      if (!c.carryJob) {
        assignCarrierJob(state, c);
      }
      const job = c.carryJob;
      if (job) {
        const fromB = buildingById.get(job.fromBuildingId);
        const toB = buildingById.get(job.toBuildingId);
        if (!toB || toB.hp <= 0 || (!job.pickedUp && (!fromB || fromB.hp <= 0))) {
          // Return cargo to side stock if destination vanished
          state.sides[c.side].stock[job.good] = (state.sides[c.side].stock[job.good] ?? 0) + job.amount;
          c.carryJob = null;
          c.carryingGood = null;
          c.carryingAmount = 0;
          continue;
        }
        const keepStationPos = (targetB: BuildingEntity, otherX: number, otherZ: number): { x: number; z: number; reachM: number } => {
          if (targetB.type !== 'keep') {
            return { x: targetB.x, z: targetB.z, reachM: BUILDING_DEFS[targetB.type].radiusM + 1.8 };
          }
          const baseAng = Math.atan2(otherZ - targetB.z, otherX - targetB.x);
          const bayCount = KEEP_BAYS.count;
          const stationIdx = ((Math.round((baseAng / (Math.PI * 2)) * bayCount) + (c.id % 3) - 1) % bayCount + bayCount) % bayCount;
          const stAng = (stationIdx / bayCount) * Math.PI * 2;
          const stR = BUILDING_DEFS.keep.radiusM + KEEP_BAYS.outM;
          return {
            x: targetB.x + Math.cos(stAng) * stR,
            z: targetB.z + Math.sin(stAng) * stR,
            reachM: 1.9,
          };
        };
        const tLevel = state.sides[c.side].transportLevel ?? 1;
        let carrierPace = TRANSPORT_LEVELS[tLevel - 1]!.pace;
        // Cart & wagon road spacing: slow slightly if trailing another carrier closer than barrowGapM/wagonGapM
        if (tLevel >= 2) {
          const minGap = tLevel >= 3 ? CART_SPACING.wagonGapM : CART_SPACING.barrowGapM;
          const fx = Math.sin(c.yawRad);
          const fz = Math.cos(c.yawRad);
          for (const other of state.citizens) {
            if (other.id === c.id || other.side !== c.side || other.role !== 'carrier' || !other.carryJob) continue;
            const dx = other.x - c.x;
            const dz = other.z - c.z;
            const ahead = dx * fx + dz * fz;
            if (ahead > 0.2 && ahead < minGap) {
              const lateral = Math.abs(dx * fz - dz * fx);
              if (lateral < CART_SPACING.laneM) {
                carrierPace *= 0.45;
                break;
              }
            }
          }
        }
        if (!job.pickedUp && fromB) {
          const st = keepStationPos(fromB, toB.x, toB.z);
          const arrived = moveCitizenToward(c, st.x, st.z, dtS, nav, true, st.reachM, carrierPace);
          if (arrived) {
            c.yawRad = Math.atan2(fromB.x - c.x, fromB.z - c.z);
            job.transferTimerS += dtS;
            if (job.transferTimerS >= ECONOMY.carrierTransferS) {
              job.pickedUp = true;
              job.transferTimerS = 0;
              c.carryingGood = job.good;
              c.carryingAmount = job.amount;
              c.path = [];
            }
          }
        } else {
          const st = keepStationPos(toB, fromB ? fromB.x : c.x, fromB ? fromB.z : c.z);
          const arrived = moveCitizenToward(c, st.x, st.z, dtS, nav, true, st.reachM, carrierPace);
          if (arrived) {
            c.yawRad = Math.atan2(toB.x - c.x, toB.z - c.z);
            job.transferTimerS += dtS;
            if (job.transferTimerS >= ECONOMY.carrierTransferS) {
              // Deposit into destination!
              if (job.forConstruction) {
                toB.buildCostDelivered[job.good] = (toB.buildCostDelivered[job.good] ?? 0) + job.amount;
              } else if (toB.type === 'keep' || toB.type === 'storehouse') {
                state.sides[c.side].stock[job.good] = (state.sides[c.side].stock[job.good] ?? 0) + job.amount;
              } else if (toB.type === 'house') {
                if (job.good === 'wine') {
                  toB.houseWineCasks = Math.min(ECONOMY.houseWineTargetCasks + 1, toB.houseWineCasks + job.amount);
                } else {
                  const perUnit = FOOD_RATIONS_PER_UNIT[job.good] ?? 1;
                  toB.houseFoodRations += job.amount * perUnit;
                }
              } else {
                toB.inputs[job.good] = (toB.inputs[job.good] ?? 0) + job.amount;
              }
              c.carryJob = null;
              c.carryingGood = null;
              c.carryingAmount = 0;
              c.path = [];
            }
          }
        }
      } else if (keep) {
        // Idle carrier waits scattered around the Keep square using golden-angle distribution (docs/PLAYBOOK.md §4.7)
        const goldAng = c.id * 2.3999632;
        const waitR = 8.8 + (c.id % 4) * 1.45;
        const wx = keep.x + Math.cos(goldAng) * waitR;
        const wz = keep.z + Math.sin(goldAng) * waitR;
        if (Math.hypot(wx - c.x, wz - c.z) > 1.8) {
          moveCitizenToward(c, wx, wz, dtS, nav, false, 1.2);
        }
      }
      continue;
    }

    // Worker assigned to workshop / gatherer
    if (c.role === 'worker' && c.assignedBuildingId !== null) {
      const shop = buildingById.get(c.assignedBuildingId);
      if (
        !shop ||
        shop.hp <= 0 ||
        shop.paused ||
        shop.buildProgress < 1 ||
        shop.upgradingToLevel !== null ||
        (isEquipmentWorkshop(shop.type) && (shop.pendingOrders ?? 0) <= 0)
      ) {
        c.role = 'carrier';
        c.assignedBuildingId = null;
        c.workPhase = 'atShop';
        continue;
      }

      const home = buildingById.get(c.homeBuildingId);
      const speedMul =
        ECONOMY.levelSpeedMul[shop.level - 1]! *
        (home?.hungry ? ECONOMY.hungryWorkSpeedMul : 1.0) *
        (c.side === 1 ? aiProdMul : 1.0);

      // Specialized walking gatherers: Woodcutter & Fisher
      if (shop.type === 'woodcutter') {
        workerAtShop.set(shop.id, c);
        if (totalMapUnits(shop.yard) >= ECONOMY.workshopYardMax) {
          shop.status = 'yardFull';
          c.workPhase = 'atShop';
          continue;
        }
        if (c.workPhase === 'atShop') {
          const tree =
            forest.nearestMatureTree(state.trees, shop.x, shop.z, ECONOMY.woodcutterFellRadiusM, true) ??
            forest.nearestMatureTree(state.trees, shop.x, shop.z, ECONOMY.woodcutterFellRadiusM * 2, true);
          if (!tree) {
            shop.status = 'idle';
            continue;
          }
          tree.reservedByCitizenId = c.id;
          c.workTargetTreeId = tree.id;
          c.workTargetX = tree.x;
          c.workTargetZ = tree.z;
          c.workPhase = 'toField';
          c.workTimerS = 0;
        } else if (c.workPhase === 'toField') {
          shop.status = 'working';
          if (moveCitizenToward(c, c.workTargetX, c.workTargetZ, dtS, nav, false)) {
            c.workPhase = 'working';
            c.workTimerS = 0;
          }
        } else if (c.workPhase === 'working') {
          shop.status = 'working';
          c.yawRad = Math.atan2(c.workTargetX - c.x, c.workTargetZ - c.z);
          c.workTimerS += dtS * speedMul;
          if (c.workTimerS >= ECONOMY.woodcutterChopS) {
            const tree = state.trees.find((t) => t.id === c.workTargetTreeId);
            if (tree && tree.state === 'mature') {
              if (forest.fellTree(tree)) forestChanged = true;
              state.visualRevision++;
              state.fxEvents.push({ kind: 'woodChop', x: tree.x, y: terrain.heightAt(tree.x, tree.z), z: tree.z, intensity: 0.8 });
            }
            c.workTargetTreeId = null;
            c.carryingGood = 'timber';
            c.carryingAmount = ECONOMY.woodcutterTimberPerTree;
            c.workPhase = 'returning';
          }
        } else if (c.workPhase === 'returning') {
          shop.status = 'working';
          if (moveCitizenToward(c, shop.x, shop.z, dtS, nav, false, BUILDING_DEFS[shop.type].radiusM + 1.1)) {
            shop.yard.timber = (shop.yard.timber ?? 0) + ECONOMY.woodcutterTimberPerTree;
            recordProduced(state.sides[c.side], 'timber', ECONOMY.woodcutterTimberPerTree);
            c.carryingGood = null;
            c.carryingAmount = 0;
            c.workPhase = 'atShop';
          }
        }
        workerAtShop.set(shop.id, c);
        continue;
      }

      if (shop.type === 'fisher') {
        if (totalMapUnits(shop.yard) >= ECONOMY.workshopYardMax) {
          shop.status = 'yardFull';
          c.workPhase = 'atShop';
          continue;
        }
        shop.status = 'working';
        const dockX = shop.x + Math.sin(shop.yawRad) * 6;
        const dockZ = shop.z + Math.cos(shop.yawRad) * 6;
        if (c.workPhase === 'atShop') {
          c.workPhase = 'toField';
        } else if (c.workPhase === 'toField') {
          if (moveCitizenToward(c, dockX, dockZ, dtS, nav, false)) {
            c.workPhase = 'working';
            c.workTimerS = 0;
          }
        } else if (c.workPhase === 'working') {
          c.yawRad = shop.yawRad;
          c.workTimerS += dtS * speedMul;
          if (c.workTimerS >= ECONOMY.fisherTripS) {
            c.carryingGood = 'fish';
            c.carryingAmount = ECONOMY.fisherFishPerTrip;
            c.workPhase = 'returning';
          }
        } else if (c.workPhase === 'returning') {
          if (moveCitizenToward(c, shop.x, shop.z, dtS, nav, false, BUILDING_DEFS[shop.type].radiusM + 1.1)) {
            shop.yard.fish = (shop.yard.fish ?? 0) + ECONOMY.fisherFishPerTrip;
            recordProduced(state.sides[c.side], 'fish', ECONOMY.fisherFishPerTrip);
            c.carryingGood = null;
            c.carryingAmount = 0;
            c.workPhase = 'atShop';
          }
        }
        workerAtShop.set(shop.id, c);
        continue;
      }

      // Farmers & Vintners walk directly onto their rear cultivated field strips and hoe/sow/harvest!
      if (shop.type === 'farm' || shop.type === 'vineyard') {
        workerAtShop.set(shop.id, c);
        let activeStripIdx = shop.strips.findIndex((s) => s.phase === 'ready');
        if (activeStripIdx < 0) activeStripIdx = shop.strips.findIndex((s) => s.phase === 'sowing');
        if (activeStripIdx < 0) activeStripIdx = shop.strips.findIndex((s) => s.phase === 'uncleared');
        if (activeStripIdx < 0) activeStripIdx = Math.floor(state.timeS / 5 + c.id) % Math.max(1, shop.strips.length);
        const st = computeBuildingStripTransform(shop, Math.max(0, activeStripIdx));
        const sweep = Math.sin(state.timeS * 0.45 + c.id) * (st.lenM * 0.32);
        const tx = st.cx + Math.cos(shop.yawRad) * sweep;
        const tz = st.cz - Math.sin(shop.yawRad) * sweep;
        if (Math.hypot(tx - c.x, tz - c.z) > 1.4) {
          c.workPhase = 'toField';
          moveCitizenToward(c, tx, tz, dtS, nav, false, 0.9);
        } else {
          c.workPhase = 'working';
          c.path = [];
          c.yawRad = shop.yawRad + Math.PI + Math.sin(state.timeS * 1.2 + c.id) * 0.45;
        }
        continue;
      }

      // Quarrymen & Iron Miners work between the pit/tunnel portal and the rock outcrop!
      if (shop.type === 'quarry' || shop.type === 'ironMine') {
        workerAtShop.set(shop.id, c);
        const wantKind = shop.type === 'quarry' ? 'stone' : 'ore';
        const oc = state.outcrops.find((o) => o.kind === wantKind && Math.hypot(o.x - shop.x, o.z - shop.z) <= 18);
        const useOutcrop = oc && Math.floor((state.timeS + c.id * 3) / 6) % 2 === 0;
        const fx = Math.sin(shop.yawRad);
        const fz = Math.cos(shop.yawRad);
        const tx = useOutcrop ? oc.x - fx * 1.6 : shop.x + fx * 1.8;
        const tz = useOutcrop ? oc.z - fz * 1.6 : shop.z + fz * 1.8;
        if (Math.hypot(tx - c.x, tz - c.z) > 1.2) {
          c.workPhase = 'toField';
          moveCitizenToward(c, tx, tz, dtS, nav, false, 0.8);
        } else {
          c.workPhase = shop.status === 'working' ? 'working' : 'atShop';
          c.path = [];
          c.yawRad = useOutcrop && oc ? Math.atan2(oc.x - c.x, oc.z - c.z) : Math.atan2(shop.x - c.x, shop.z - c.z);
        }
        continue;
      }

      // Foresters & Hunters patrol between their lodge and nearby forest saplings/trees!
      if (shop.type === 'forester' || shop.type === 'hunter') {
        workerAtShop.set(shop.id, c);
        const phaseSlot = Math.floor((state.timeS + c.id * 2) / 5) % 3;
        const ang = shop.yawRad + (phaseSlot - 1) * 0.95;
        const rad = phaseSlot === 1 ? 2.4 : 7.5;
        const tx = shop.x + Math.sin(ang) * rad;
        const tz = shop.z + Math.cos(ang) * rad;
        if (Math.hypot(tx - c.x, tz - c.z) > 1.2) {
          c.workPhase = 'toField';
          moveCitizenToward(c, tx, tz, dtS, nav, false, 0.8);
        } else {
          c.workPhase = 'working';
          c.path = [];
          c.yawRad = ang;
        }
        continue;
      }

      // All other Workshop Artisans (Smithy, Bakery, Sawmill, Windmill, Brewery, PigFarm, Butcher, Winery,
      // Tannery, Smelter, Armourer, Fletcher, Stable, GunFoundry, Tavern, etc.):
      // Stand at the front workbench/forge apron, alternate between workbench & yard stack, face the building, and animate working!
      const fx = Math.sin(shop.yawRad);
      const fz = Math.cos(shop.yawRad);
      const rx = Math.cos(shop.yawRad);
      const rz = -Math.sin(shop.yawRad);
      const stationSide = Math.floor((state.timeS + c.id * 1.7) / 4.5) % 2 === 0 ? -0.95 : 0.95;
      const frontDist = BUILDING_DEFS[shop.type].radiusM + 0.65;
      const tx = shop.x + fx * frontDist + rx * stationSide;
      const tz = shop.z + fz * frontDist + rz * stationSide;
      if (Math.hypot(shop.x - c.x, shop.z - c.z) > BUILDING_DEFS[shop.type].radiusM + 2.6) {
        c.workPhase = 'toField';
        moveCitizenToward(c, tx, tz, dtS, nav, true, 1.0);
      } else {
        workerAtShop.set(shop.id, c);
        if (Math.hypot(tx - c.x, tz - c.z) > 0.65) {
          c.workPhase = 'toField';
          moveCitizenToward(c, tx, tz, dtS, nav, false, 0.4);
        } else {
          c.path = [];
          c.yawRad = Math.atan2(shop.x - c.x, shop.z - c.z);
          c.workPhase = shop.status === 'working' ? 'working' : 'atShop';
        }
      }
    }
  }

  // Prune citizens who arrived at barracks to become soldiers
  if (state.citizens.some((c) => c.assignedBuildingId === -999)) {
    state.citizens = state.citizens.filter((c) => c.assignedBuildingId !== -999);
  }

  // 3b. Deterministic collision resolution: keep citizens outside solid building footprints/plinths & separated from each other!
  const citizens = state.citizens;
  for (let i = 0; i < citizens.length; i++) {
    const a = citizens[i]!;
    for (let j = i + 1; j < citizens.length; j++) {
      const b = citizens[j]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dSq = dx * dx + dz * dz;
      const minGap = 0.88;
      if (dSq < minGap * minGap) {
        const d = Math.sqrt(dSq);
        const nx = d > 1e-4 ? dx / d : Math.cos((a.id + j) * 2.1);
        const nz = d > 1e-4 ? dz / d : Math.sin((a.id + j) * 2.1);
        const push = Math.min(0.12, (minGap - d) * 0.5);
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
  }
  for (const c of citizens) {
    for (const b of state.buildings) {
      if (b.hp <= 0 || b.type === 'gate' || b.type === 'ruin') continue;
      // Keep stone plinth (~7.0 m) & solid walls (~0.78 * radiusM) keep citizens visually outside masonry
      const solidR =
        b.type === 'keep'
          ? 7.0
          : b.type === 'well'
            ? 1.85
            : Math.max(2.75, BUILDING_DEFS[b.type].radiusM * 0.78);
      const dx = c.x - b.x;
      const dz = c.z - b.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < solidR * solidR) {
        const d = Math.sqrt(dSq);
        const nx = d > 1e-4 ? dx / d : Math.sin(b.yawRad);
        const nz = d > 1e-4 ? dz / d : Math.cos(b.yawRad);
        c.x = b.x + nx * (solidR + 0.12);
        c.z = b.z + nz * (solidR + 0.12);
      }
    }
  }

  // 4. Step buildings (construction, upgrades, recipes, farms, vineyards, houses, tax, food, wine)
  for (const b of state.buildings) {
    if (b.hp <= 0) continue;
    const def = BUILDING_DEFS[b.type];
    const sideState = state.sides[b.side];

    if (b.type === 'ruin') {
      b.status = 'ruin';
      continue;
    }

    // Active construction
    if (b.buildProgress < 1) {
      b.status = 'constructing';
      const maxAllowed = computeMaterialDeliveryFraction(b);
      const builders = buildersAtSite.get(b.id) ?? 0;
      const buildDuration = def.buildBuilderS ?? ECONOMY.buildBaseBuilderS;
      if (builders > 0 && b.buildProgress < maxAllowed) {
        b.buildProgress = Math.min(maxAllowed, b.buildProgress + (dtS * builders) / buildDuration);
        if (b.buildProgress >= 0.9999) {
          b.buildProgress = 1;
          b.hp = b.maxHp;
          b.buildCostNeeded = {};
          b.buildCostDelivered = {};
          b.status = 'idle';
          if (def.unique) {
            state.alerts.push({
              id: state.nextAlertId++,
              timeS: state.timeS,
              side: 0,
              kind: 'greatBuilding',
              x: b.x,
              z: b.z,
              detail: `completed:${b.type}:${b.side}`,
            });
            if (state.alerts.length > 24) state.alerts.shift();
            state.fxEvents.push({ kind: 'horn', x: b.x, y: terrain.heightAt(b.x, b.z) + 5, z: b.z, intensity: 1.15 });
          }
          state.visualRevision++;
          state.fxEvents.push({ kind: 'buildHammer', x: b.x, y: terrain.heightAt(b.x, b.z), z: b.z, intensity: 1.0 });
        }
      }
      continue;
    }

    // Active upgrade (advances proportionally as materials arrive; scales HP with level!)
    if (b.upgradingToLevel !== null) {
      b.status = 'upgrading';
      const matFrac = computeMaterialDeliveryFraction(b);
      const builders = Math.max(matFrac > 0 ? 1 : 0, buildersAtSite.get(b.id) ?? 0);
      const baseKeepDuration = b.type === 'keep' ? ECONOMY.keepLevels[b.upgradingToLevel - 1]!.upgradeS : ECONOMY.upgradeBuilderS;
      const targetDuration =
        b.type === 'keep' && b.upgradingToLevel >= 4 && state.scenario.fastAges
          ? Math.max(10, Math.round(baseKeepDuration * AI_AGES.fastAgesTimeMul))
          : baseKeepDuration;
      const maxTimerAllowed = matFrac * targetDuration;
      if (builders > 0 && b.upgradeTimerS < maxTimerAllowed) {
        b.upgradeTimerS = Math.min(maxTimerAllowed, b.upgradeTimerS + dtS * builders);
        if (b.upgradeTimerS >= targetDuration - 0.001) {
          const prevEra = b.type === 'keep' ? eraOfKeepLevel(b.level) : 1;
          b.level = b.upgradingToLevel;
          b.upgradingToLevel = null;
          b.upgradeTimerS = 0;
          b.buildCostNeeded = {};
          b.buildCostDelivered = {};
          const hpRatio = b.hp / Math.max(1, b.maxHp);
          if (b.type === 'keep') {
            const kLvl = ECONOMY.keepLevels[b.level - 1]!;
            b.maxHp = kLvl.maxHp;
            const newEra = eraOfKeepLevel(b.level);
            if (newEra > prevEra) {
              state.alerts.push({
                id: state.nextAlertId++,
                timeS: state.timeS,
                side: b.side,
                kind: 'eraAdvanced',
                x: b.x,
                z: b.z,
                detail: `era_${newEra}:${b.side}`,
              });
              if (b.side !== 0) {
                state.alerts.push({
                  id: state.nextAlertId++,
                  timeS: state.timeS,
                  side: 0,
                  kind: 'eraAdvanced',
                  x: b.x,
                  z: b.z,
                  detail: `era_${newEra}:${b.side}`,
                });
              }
              while (state.alerts.length > 24) state.alerts.shift();
              state.fxEvents.push({ kind: 'horn', x: b.x, y: terrain.heightAt(b.x, b.z) + 5, z: b.z, intensity: 1.2 });
            }
          } else {
            // Every building scales HP with level
            b.maxHp = BUILDING_DEFS[b.type].maxHp * b.level;
          }
          b.hp = Math.round(b.maxHp * Math.max(0.5, hpRatio));
          if (b.type === 'farm' || b.type === 'vineyard') {
            const targetStrips = ECONOMY.farmStripsByLevel[b.level - 1]!;
            while (b.strips.length < targetStrips) {
              b.strips.push({ phase: 'uncleared', timerS: 0, growth01: 0 });
            }
          }
          b.status = 'idle';
          state.visualRevision++;
          state.fxEvents.push({ kind: 'buildHammer', x: b.x, y: terrain.heightAt(b.x, b.z), z: b.z, intensity: 1.0 });
        }
      }
      continue;
    }

    // Keep passive tax & Keep crew food consumption
    if (b.type === 'keep') {
      b.status = 'working';
      const keepGold = (ECONOMY.keepTaxPerMin / 60) * dtS;
      sideState.stock.gold += keepGold;
      recordProduced(sideState, 'gold', keepGold);
      const crewRations = (b.residents * ECONOMY.residentRationsPerMin / 60) * dtS;
      consumeRationsFromStock(sideState, crewRations);
      continue;
    }

    // House: food, wine, tax (Town Hall +25%), newcomers (Well 0.75x & Cathedral 0.75x)
    if (b.type === 'house') {
      const cap = ECONOMY.houseCapacityByLevel[b.level - 1]!;
      const eatRations = (b.residents * ECONOMY.residentRationsPerMin / 60) * dtS;
      if (b.houseFoodRations >= eatRations) {
        b.houseFoodRations -= eatRations;
        b.hungry = false;
      } else {
        b.houseFoodRations = 0;
        b.hungry = true;
      }

      let hasWine = false;
      if (!b.hungry && b.houseWineCasks > 0) {
        const drink = (b.residents * ECONOMY.residentWinePerMin / 60) * dtS;
        b.houseWineCasks = Math.max(0, b.houseWineCasks - drink);
        hasWine = true;
      }

      if (!b.hungry) {
        b.status = 'working';
        const tax =
          (b.residents * ECONOMY.taxPerFedPersonPerMin / 60) *
          (hasWine ? ECONOMY.wineTaxMultiplier : 1.0) *
          greatTaxFactor(state, b.side) *
          dtS;
        sideState.stock.gold += tax;
        recordProduced(sideState, 'gold', tax);

        if (b.residents < cap) {
          let nearWell = false;
          const wrSq = ECONOMY.wellRadiusM * ECONOMY.wellRadiusM;
          for (const w of wells) {
            if (w.side === b.side && (w.x - b.x) * (w.x - b.x) + (w.z - b.z) * (w.z - b.z) <= wrSq) {
              nearWell = true;
              break;
            }
          }
          const interval =
            ECONOMY.newcomerIntervalS *
            (hasWine ? ECONOMY.wineGrowthMultiplier : 1.0) *
            (nearWell ? ECONOMY.wellGrowthMultiplier : 1.0) *
            (sideState.hasCathedral ? GREAT.cathedralGrowthMultiplier : 1.0);
          b.growthTimerS += dtS;
          if (b.growthTimerS >= interval) {
            b.growthTimerS -= interval;
            b.residents++;
            spawnCitizen(state, b.side, b);
          }
        }
      } else {
        b.status = 'noInput';
        b.growthTimerS = 0;
      }
      continue;
    }

    if (b.paused) {
      b.status = 'paused';
      continue;
    }

    if (b.type === 'woodcutter' || b.type === 'fisher') {
      if (!workerAtShop.has(b.id)) b.status = 'noWorker';
      if (totalMapUnits(b.yard) >= ECONOMY.workshopYardMax) {
        b.status = 'yardFull';
        b.yardFullTimerS += dtS;
      } else {
        b.yardFullTimerS = 0;
      }
      continue;
    }

    // Farm & Vineyard strip lifecycle
    if (b.type === 'farm' || b.type === 'vineyard') {
      const worker = workerAtShop.get(b.id);
      const isVine = b.type === 'vineyard';
      const targetStrips = ECONOMY.farmStripsByLevel[b.level - 1]!;
      while (b.strips.length < targetStrips) {
        b.strips.push({ phase: 'uncleared', timerS: 0, growth01: 0 });
      }

      // Passive ripening of growing strips happens regardless of farmer presence!
      const growS = isVine ? ECONOMY.vineyardGrowS : ECONOMY.farmGrowS;
      for (const st of b.strips) {
        if (st.phase === 'growing') {
          st.timerS += dtS;
          st.growth01 = Math.min(1, st.timerS / growS);
          if (st.timerS >= growS) {
            st.phase = 'ready';
            st.timerS = 0;
            st.growth01 = 1;
          }
        }
      }

      if (!worker) {
        b.status = 'noWorker';
        continue;
      }
      if (totalMapUnits(b.yard) >= ECONOMY.workshopYardMax) {
        b.status = 'yardFull';
        b.yardFullTimerS += dtS;
        continue;
      }
      b.yardFullTimerS = 0;

      const home = buildingById.get(worker.homeBuildingId);
      const speedMul =
        ECONOMY.levelSpeedMul[b.level - 1]! *
        (home?.hungry ? ECONOMY.hungryWorkSpeedMul : 1.0) *
        greatWorkSpeedFactor(state, b.side) *
        (b.side !== 0 ? aiProdMul : 1.0);

      // Farmer prioritizes: ready (harvest) -> sowing -> uncleared (clear/plant)
      const active =
        b.strips.find((s) => s.phase === 'ready') ??
        b.strips.find((s) => s.phase === 'sowing') ??
        b.strips.find((s) => s.phase === 'uncleared') ??
        null;

      if (!active) {
        b.status = 'working';
        continue;
      }
      b.status = 'working';
      active.timerS += dtS * speedMul;

      if (active.phase === 'uncleared') {
        const req = isVine ? ECONOMY.vineyardPlantS : ECONOMY.farmClearS;
        if (active.timerS >= req) {
          active.timerS = 0;
          active.phase = isVine ? 'growing' : 'sowing';
        }
      } else if (active.phase === 'sowing') {
        if (active.timerS >= ECONOMY.farmSowS) {
          active.timerS = 0;
          active.phase = 'growing';
          active.growth01 = 0;
        }
      } else if (active.phase === 'ready') {
        const req = isVine ? ECONOMY.vineyardHarvestS : ECONOMY.farmHarvestS;
        if (active.timerS >= req) {
          active.timerS = 0;
          active.growth01 = 0;
          if (isVine) {
            b.yard.grapes = (b.yard.grapes ?? 0) + ECONOMY.vineyardGrapesPerStrip;
            recordProduced(sideState, 'grapes', ECONOMY.vineyardGrapesPerStrip);
            active.phase = 'growing'; // Vines never re-sow!
          } else {
            b.yard.grain = (b.yard.grain ?? 0) + ECONOMY.farmGrainPerStrip;
            recordProduced(sideState, 'grain', ECONOMY.farmGrainPerStrip);
            active.phase = 'sowing';
          }
        }
      }
      continue;
    }

    // Standard recipe workshops (all remaining craft/food/extraction buildings)
    if (def.recipe) {
      if (isEquipmentWorkshop(b.type) && (b.pendingOrders ?? 0) <= 0) {
        b.status = 'idle';
        b.cycleTimerS = 0;
        continue;
      }
      const worker = workerAtShop.get(b.id);
      if (!worker) {
        b.status = 'noWorker';
        continue;
      }
      if (totalMapUnits(b.yard) >= ECONOMY.workshopYardMax) {
        b.status = 'yardFull';
        b.yardFullTimerS += dtS;
        continue;
      }
      b.yardFullTimerS = 0;

      // Verify inputs available
      let hasInputs = true;
      for (const g of Object.keys(def.recipe.inputs) as GoodId[]) {
        if ((b.inputs[g] ?? 0) < (def.recipe.inputs[g] ?? 0)) {
          hasInputs = false;
          break;
        }
      }
      if (!hasInputs) {
        b.status = 'noInput';
        continue;
      }

      const home = buildingById.get(worker.homeBuildingId);
      const firearmSurgeMul = isFirearmWorkshop(b.type) && (b.pendingOrders ?? 0) > 0 ? 1.25 : 1.0;
      const speedMul =
        ECONOMY.levelSpeedMul[b.level - 1]! *
        (home?.hungry ? ECONOMY.hungryWorkSpeedMul : 1.0) *
        greatWorkSpeedFactor(state, b.side) *
        firearmSurgeMul *
        (b.side !== 0 ? aiProdMul : 1.0);

      b.status = 'working';
      b.cycleTimerS += dtS * speedMul;
      if (b.cycleTimerS >= def.recipe.cycleS) {
        b.cycleTimerS -= def.recipe.cycleS;
        for (const g of Object.keys(def.recipe.inputs) as GoodId[]) {
          const req = def.recipe.inputs[g] ?? 0;
          b.inputs[g] = Math.max(0, (b.inputs[g] ?? 0) - req);
          recordConsumed(sideState, g, req);
        }
        let totalOut = 0;
        for (const g of Object.keys(def.recipe.outputs) as GoodId[]) {
          const out = def.recipe.outputs[g] ?? 0;
          totalOut += out;
          if (g === 'gold') {
            sideState.stock.gold += out;
          } else {
            b.yard[g] = (b.yard[g] ?? 0) + out;
          }
          recordProduced(sideState, g, out);
        }
        if (isEquipmentWorkshop(b.type)) {
          b.pendingOrders = Math.max(0, (b.pendingOrders ?? 0) - Math.max(1, totalOut));
          if (b.pendingOrders <= 0) {
            b.cycleTimerS = 0;
            b.status = 'idle';
          }
        } else if (isFirearmWorkshop(b.type) && (b.pendingOrders ?? 0) > 0) {
          b.pendingOrders = Math.max(0, (b.pendingOrders ?? 0) - Math.max(1, totalOut));
        }
      }
    } else if (def.workers > 0) {
      b.status = workerAtShop.has(b.id) ? 'working' : 'noWorker';
    } else {
      b.status = 'idle';
    }
  }

  // 5. Rolling 2-minute production ledger snapshot every 10 s (12 buckets = 120 s)
  for (const s of state.sides) {
    s.ledgerAccumS += dtS;
    if (s.ledgerAccumS >= 10.0) {
      s.ledgerAccumS -= 10.0;
      s.ledger.push({
        timeS: state.timeS,
        produced: { ...s.currentBucketProduced },
        consumed: { ...s.currentBucketConsumed },
      });
      s.currentBucketProduced = {};
      s.currentBucketConsumed = {};
      if (s.ledger.length > 12) s.ledger.shift();
    }
  }

  return { forestChanged };
}

/** Computes live 2-minute production rates and net balances (/min) for the HUD Production tab. */
export function computeProductionRates(state: SimWorldState, side: SideId): ProductionRateEntry[] {
  const s = state.sides[side];
  const windowS = Math.max(10, s.ledger.length * 10 + s.ledgerAccumS);
  const toPerMin = 60 / windowS;
  const out: ProductionRateEntry[] = [];

  for (const g of ALL_GOODS) {
    let prod = s.currentBucketProduced[g] ?? 0;
    let cons = s.currentBucketConsumed[g] ?? 0;
    for (const bucket of s.ledger) {
      prod += bucket.produced[g] ?? 0;
      cons += bucket.consumed[g] ?? 0;
    }
    const stock = Math.floor(s.stock[g] ?? 0);
    if (stock > 0 || prod > 0 || cons > 0 || g === 'gold' || g === 'timber' || g === 'stone' || g === 'bread') {
      out.push({
        good: g,
        stock,
        producedPerMin: +(prod * toPerMin).toFixed(1),
        netPerMin: +((prod - cons) * toPerMin).toFixed(1),
      });
    }
  }
  return out;
}

/** Lists active workshop bottlenecks (missing input, full yard, truly unassigned worker, paused) for quick camera jump! */
export function listBottlenecks(state: SimWorldState, side: SideId): BottleneckEntry[] {
  const assignedWorkplaces = new Set<number>();
  for (const c of state.citizens) {
    if (c.side === side && c.assignedBuildingId !== null) assignedWorkplaces.add(c.assignedBuildingId);
  }
  const out: BottleneckEntry[] = [];
  for (const b of state.buildings) {
    if (b.side !== side || b.hp <= 0 || b.buildProgress < 1) continue;
    if (b.status === 'noWorker' && assignedWorkplaces.has(b.id)) continue;
    if (b.status === 'noInput' || b.status === 'yardFull' || b.status === 'noWorker' || b.status === 'paused') {
      let missingGood: GoodId | undefined;
      if (b.status === 'noInput') {
        const recipe = BUILDING_DEFS[b.type].recipe;
        if (recipe) {
          for (const g of Object.keys(recipe.inputs) as GoodId[]) {
            if ((b.inputs[g] ?? 0) < (recipe.inputs[g] ?? 0)) {
              missingGood = g;
              break;
            }
          }
        }
      }
      out.push({
        buildingId: b.id,
        buildingType: b.type,
        x: b.x,
        z: b.z,
        status: b.status,
        missingGood,
      });
    }
  }
  return out;
}

export function countPopulation(state: SimWorldState, side: SideId): {
  total: number;
  free: number;
  workers: number;
  carriers: number;
  builders: number;
  recruits: number;
  capacity: number;
} {
  let workers = 0;
  let carriers = 0;
  let builders = 0;
  let recruits = 0;
  for (const c of state.citizens) {
    if (c.side !== side) continue;
    if (c.role === 'worker') workers++;
    else if (c.role === 'carrier') carriers++;
    else if (c.role === 'builder') builders++;
    else recruits++;
  }
  let capacity = 0;
  for (const b of state.buildings) {
    if (b.side !== side || b.hp <= 0 || b.buildProgress < 1) continue;
    if (b.type === 'keep') capacity += ECONOMY.keepResidents;
    else if (b.type === 'house') capacity += ECONOMY.houseCapacityByLevel[b.level - 1]!;
  }
  return {
    total: workers + carriers + builders + recruits,
    free: carriers + builders,
    workers,
    carriers,
    builders,
    recruits,
    capacity,
  };
}

export { getBuildingById };
