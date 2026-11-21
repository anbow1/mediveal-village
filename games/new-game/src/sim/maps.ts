// Pure-TS deterministic 560 x 560 m Campaign & Skirmish map layout generator (zero three.js, unit-tested).
// Generates all 5 Marchland layouts (`crossing`, `openField`, `forest`, `valley`, `fortress`) strictly
// following `docs/CAMPAIGN.md` (19.11), `NUMBERS.md`, and `BRIEF.md`:
//   - `crossing`  (Missions 1-2 default): north-south river, stone causeway + 2 gravel fords,
//                                         complete west-bank town, east-bank Crimson war camp in sight.
//   - `openField` (Skirmish): rolling plains, twin flanking lakes, central tactical ridge, 2 towns.
//   - `forest`    (Skirmish): dense woodland glades, winding cobbled timber roads, logging town & camp.
//   - `valley`    (Missions 3-4): twin mountain ridges 175 m off axis (peak every 52 m), west Keep,
//                                 central village 274 m away with 6 rebuildable ruins, east pass.
//   - `fortress`  (Mission 5): 7 m high plateau flat to 100 m radius (no lake/ore/forest on plateau),
//                              outer 124 x 112 m wall (8 towers + main gate), inner 84 x 70 m wall
//                              (4 towers + offset left gate), central `fortress_donzon`, enemy garrison
//                              town inside walls, southern river ford & player siege camp with cannons!

import { WORLD } from '../config.ts';
import {
  TerrainField,
  type FlatTerraceSpec,
  type MapLayoutId,
  type MountainPeakSpec,
  type TerrainConfig,
} from './terrain.ts';

export type BuildingKind =
  | 'keep_l1'
  | 'house_l1'
  | 'woodcutter_l1'
  | 'sawmill_l1'
  | 'forester_l1'
  | 'hunter_l1'
  | 'quarry_l1'
  | 'iron_mine_l1'
  | 'farm_l1'
  | 'vineyard_l1'
  | 'winery_l1'
  | 'windmill_l1'
  | 'bakery_l1'
  | 'brewery_l1'
  | 'pig_farm_l1'
  | 'butcher_l1'
  | 'tavern_l1'
  | 'tannery_l1'
  | 'smelter_l1'
  | 'smithy_l1'
  | 'armourer_l1'
  | 'fletcher_l1'
  | 'stable_l1'
  | 'barracks_l1'
  | 'gun_foundry_l1'
  | 'watchtower_l1'
  | 'gate_l1'
  | 'chapel_l1'
  | 'market_l1'
  | 'well_l1'
  | 'storehouse_l1'
  | 'fisher_l1'
  | 'camp_tent_l1'
  | 'ruin_house'
  | 'fortress_donzon';

export interface BuildingPlacementSpec {
  readonly kind: BuildingKind;
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly yardRx: number;
  readonly yardRz: number;
  readonly team: 0 | 1;
}

export interface WallSegmentSpec {
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
}

export interface FarmStripSpec {
  readonly cx: number;
  readonly cz: number;
  readonly lenM: number;
  readonly widM: number;
  readonly yawRad: number;
}

export interface TreeSpec {
  readonly species: 'oak' | 'pine' | 'birch';
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
}

export interface RockSpec {
  readonly kind: 'rock_moss_a' | 'rock_moss_b' | 'boulder';
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
}

export interface FernSpec {
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
}

export interface PropSpec {
  readonly kind: 'barrel' | 'crate' | 'bucket' | 'pier' | 'stump' | 'sapling' | 'cannon';
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
}

export interface CapturePointSpec {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly z: number;
}

export interface ResourceOutcropSpec {
  readonly kind: 'stone' | 'ore';
  readonly x: number;
  readonly z: number;
}

export interface UnitPlacementSpec {
  readonly archetype: 'swordsman' | 'archer' | 'citizen';
  readonly team: 0 | 1;
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
  readonly clip: 'idle' | 'walk' | 'attack';
  readonly phase01: number;
  readonly speedMul: number;
  readonly tintVar: number;
  readonly patrol?: readonly (readonly [number, number])[];
}

export interface MapLayoutSpec {
  readonly id: MapLayoutId;
  readonly title: string;
  readonly subtitle: string;
  readonly terrainConfig: TerrainConfig;
  readonly playerKeepXZ: readonly [number, number];
  readonly enemyCenterXZ: readonly [number, number];
  readonly calibrationXZ: readonly [number, number];
  readonly buildings: readonly BuildingPlacementSpec[];
  readonly walls: readonly WallSegmentSpec[];
  readonly farmStrips: readonly FarmStripSpec[];
  readonly roads: readonly (readonly (readonly [number, number])[])[];
  readonly capturePoints: readonly CapturePointSpec[];
  readonly outcrops: readonly ResourceOutcropSpec[];
  readonly trees: readonly TreeSpec[];
  readonly rocks: readonly RockSpec[];
  readonly ferns: readonly FernSpec[];
  readonly props: readonly PropSpec[];
  readonly units: readonly UnitPlacementSpec[];
}

export const ALL_MAP_IDS: readonly MapLayoutId[] = [
  'crossing',
  'openField',
  'forest',
  'valley',
  'fortress',
];

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Emits 2.0 m curtain wall segments between (x0, z0) and (x1, z1), leaving optional gaps for gates/towers. */
function appendWallRun(
  out: WallSegmentSpec[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  gapRanges: readonly (readonly [number, number])[] = [],
  faceOutwardFlip = false,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1.5) return;
  const count = Math.max(1, Math.round(len / 2.0));
  const yaw = Math.atan2(-dz, dx) + (faceOutwardFlip ? Math.PI : 0);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const distAlong = t * len;
    const inGap = gapRanges.some(([g0, g1]) => distAlong >= g0 && distAlong <= g1);
    if (inGap) continue;
    out.push({
      x: x0 + dx * t,
      z: z0 + dz * t,
      yawRad: yaw,
    });
  }
}

/** Emits a neat military regiment block (swordsmen or archers) facing a direction. */
function appendRegiment(
  out: UnitPlacementSpec[],
  archetype: 'swordsman' | 'archer',
  team: 0 | 1,
  cx: number,
  cz: number,
  cols: number,
  rows: number,
  yawRad: number,
  spacingM: number,
  rng: () => number,
  clip: 'idle' | 'walk' | 'attack' = 'idle',
): void {
  const forwardX = Math.sin(yawRad);
  const forwardZ = Math.cos(yawRad);
  const rightX = Math.cos(yawRad);
  const rightZ = -Math.sin(yawRad);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = (c - (cols - 1) * 0.5) * spacingM + (rng() - 0.5) * 0.24;
      const lz = -(r - (rows - 1) * 0.5) * spacingM + (rng() - 0.5) * 0.24;
      out.push({
        archetype,
        team,
        x: cx + rightX * lx + forwardX * lz,
        z: cz + rightZ * lx + forwardZ * lz,
        yawRad: yawRad + (rng() - 0.5) * 0.14,
        scale: 0.96 + rng() * 0.08,
        clip,
        phase01: rng(),
        speedMul: 0.42 + rng() * 0.14,
        tintVar: 0.92 + rng() * 0.16,
      });
    }
  }
}

/**
 * Emits a grid-planned medieval player settlement anchored around (ox, oz):
 *   - Main East-West High Street along `z = oz`
 *   - West Cross Street along `x = ox - dir * 4` & East Cross Street along `x = ox + dir * 20`
 *   - Every building sits off the street inside a grid block with its front entrance (`+Z` rotated by `yawRad`)
 *     facing directly toward the adjacent street.
 *   - Related buildings are grouped into 4 logistics districts:
 *       1. Keep & Central Depot + Forestry (West block: Keep, Storehouse, Woodcutter)
 *       2. Food Production Chain (South-West & South-Central: Farm -> Windmill -> Bakery)
 *       3. Civic & Residential Quarter (Central block: Market, Well, Chapel, 4× House within Well radius)
 *       4. Military & Armaments Quarter (East block: Smithy directly opposite Barracks)
 */
function appendPlayerTown(
  ox: number,
  oz: number,
  facingEast: boolean,
  buildings: BuildingPlacementSpec[],
  farmStrips: FarmStripSpec[],
  props: PropSpec[],
  units: UnitPlacementSpec[],
  rng: () => number,
): void {
  const dir = facingEast ? 1 : -1;
  const fYaw = facingEast ? Math.PI * 0.5 : -Math.PI * 0.5;
  const bYaw = facingEast ? -Math.PI * 0.5 : Math.PI * 0.5;
  const sYaw = 0.0;
  const nYaw = Math.PI;

  buildings.push(
    // 1. Keep, Central Depot & Forestry (West of West Cross Street x = ox - dir * 4, entrances facing East onto street)
    { kind: 'keep_l1', x: ox - dir * 16, z: oz, yawRad: fYaw, yardRx: 11.5, yardRz: 9.5, team: 0 },
    { kind: 'storehouse_l1', x: ox - dir * 14, z: oz - 14, yawRad: fYaw, yardRx: 7.5, yardRz: 6.2, team: 0 },
    { kind: 'woodcutter_l1', x: ox - dir * 14, z: oz - 26, yawRad: fYaw, yardRx: 6.8, yardRz: 5.8, team: 0 },

    // 2. Food Chain District (Farm -> Windmill -> Bakery grouped along South-West & Main Street)
    { kind: 'farm_l1', x: ox - dir * 30, z: oz + 14, yawRad: fYaw, yardRx: 7.4, yardRz: 5.8, team: 0 },
    { kind: 'windmill_l1', x: ox - dir * 14, z: oz + 14, yawRad: fYaw, yardRx: 6.2, yardRz: 6.2, team: 0 },
    { kind: 'bakery_l1', x: ox + dir * 4, z: oz + 11, yawRad: nYaw, yardRx: 6.8, yardRz: 5.5, team: 0 },

    // 3. Civic & Residential Quarter (Central grid block around Market & Well; all houses within 40 m of Well)
    { kind: 'market_l1', x: ox + dir * 4, z: oz - 11, yawRad: sYaw, yardRx: 8.5, yardRz: 7.5, team: 0 },
    { kind: 'well_l1', x: ox + dir * 12, z: oz - 8, yawRad: sYaw, yardRx: 3.4, yardRz: 3.4, team: 0 },
    { kind: 'chapel_l1', x: ox + dir * 4, z: oz - 24, yawRad: bYaw, yardRx: 7.5, yardRz: 9.5, team: 0 },
    { kind: 'house_l1', x: ox + dir * 13, z: oz + 11, yawRad: nYaw, yardRx: 6.0, yardRz: 5.6, team: 0 },
    { kind: 'house_l1', x: ox + dir * 13, z: oz - 20, yawRad: fYaw, yardRx: 6.0, yardRz: 5.6, team: 0 },
    { kind: 'house_l1', x: ox + dir * 4, z: oz + 22, yawRad: bYaw, yardRx: 6.0, yardRz: 5.6, team: 0 },
    { kind: 'house_l1', x: ox + dir * 13, z: oz + 22, yawRad: fYaw, yardRx: 6.0, yardRz: 5.6, team: 0 },

    // 4. Military & Armaments District (East block: Smithy & Barracks paired across Main High Street)
    { kind: 'smithy_l1', x: ox + dir * 28, z: oz - 11, yawRad: sYaw, yardRx: 6.8, yardRz: 5.8, team: 0 },
    { kind: 'barracks_l1', x: ox + dir * 28, z: oz + 12, yawRad: nYaw, yardRx: 9.5, yardRz: 7.2, team: 0 },
  );

  // Golden ripening wheat strips neatly aligned behind the Farm
  for (let i = 0; i < 4; i++) {
    farmStrips.push({
      cx: ox - dir * 42,
      cz: oz + 5 + i * 5.8,
      lenM: 16.5,
      widM: 4.4,
      yawRad: 0.0,
    });
  }

  // Village props tucked neatly beside workshop yards (off the streets)
  props.push(
    { kind: 'crate', x: ox + dir * 7.5, z: oz - 7.5, yawRad: 0.0, scale: 1.05 },
    { kind: 'barrel', x: ox + dir * 8.6, z: oz - 7.5, yawRad: 0.0, scale: 1.0 },
    { kind: 'crate', x: ox + dir * 7.5, z: oz + 7.5, yawRad: 0.0, scale: 1.0 },
    { kind: 'crate', x: ox + dir * 8.4, z: oz + 7.5, yawRad: 0.5, scale: 0.92 },
    { kind: 'bucket', x: ox + dir * 12.8, z: oz - 6.2, yawRad: 0.3, scale: 1.0 },
    { kind: 'bucket', x: ox + dir * 11.2, z: oz - 6.2, yawRad: 1.4, scale: 1.0 },
    { kind: 'barrel', x: ox - dir * 10.5, z: oz - 12.5, yawRad: 0.0, scale: 1.0 },
    { kind: 'barrel', x: ox - dir * 10.5, z: oz - 13.6, yawRad: 0.8, scale: 0.95 },
    { kind: 'crate', x: ox - dir * 10.5, z: oz + 12.5, yawRad: 0.0, scale: 1.05 },
    { kind: 'barrel', x: ox + dir * 25.0, z: oz - 7.5, yawRad: 0.0, scale: 1.0 },
  );
  for (let k = 0; k < 7; k++) {
    const a = k * 0.95;
    props.push({
      kind: k % 2 === 0 ? 'stump' : 'sapling',
      x: ox - dir * (22 + Math.cos(a) * 5.5),
      z: oz - 34 + Math.sin(a) * 4.8,
      yawRad: rng() * Math.PI * 2,
      scale: 0.88 + rng() * 0.35,
    });
  }

  // 16 living MakeHuman villagers patrolling along the orthogonal grid streets
  const loops: readonly (readonly (readonly [number, number])[])[] = [
    [[ox - dir * 4, oz], [ox + dir * 20, oz], [ox + dir * 20, oz - 18], [ox - dir * 4, oz - 18]],
    [[ox - dir * 4, oz], [ox + dir * 20, oz], [ox + dir * 20, oz + 18], [ox - dir * 4, oz + 18]],
    [[ox - dir * 4, oz - 22], [ox - dir * 4, oz + 22], [ox + dir * 20, oz + 22], [ox + dir * 20, oz - 22]],
    [[ox + dir * 20, oz - 16], [ox + dir * 20, oz + 16], [ox + dir * 32, oz], [ox - dir * 4, oz]],
  ];
  for (let i = 0; i < 16; i++) {
    const loop = loops[i % loops.length]!;
    const p0 = loop[i % loop.length]!;
    const moving = i < 12;
    units.push({
      archetype: 'citizen',
      team: 0,
      x: p0[0] + (rng() - 0.5) * 2.0,
      z: p0[1] + (rng() - 0.5) * 2.0,
      yawRad: rng() * Math.PI * 2,
      scale: 0.95 + rng() * 0.10,
      clip: moving ? 'walk' : i % 2 === 0 ? 'attack' : 'idle',
      phase01: rng(),
      speedMul: moving ? 0.82 + rng() * 0.18 : 0.48 + rng() * 0.16,
      tintVar: 0.88 + rng() * 0.22,
      patrol: moving ? loop : undefined,
    });
  }
}

/** Returns the orthogonal internal town street network for a grid-planned player town anchored at (ox, oz). */
function getPlayerTownGridRoads(ox: number, oz: number, facingEast: boolean): (readonly (readonly [number, number])[])[] {
  const dir = facingEast ? 1 : -1;
  return [
    // West Cross Street & East Cross Street
    [[ox - dir * 4, oz - 26], [ox - dir * 4, oz], [ox - dir * 4, oz + 26]],
    [[ox + dir * 20, oz - 24], [ox + dir * 20, oz], [ox + dir * 20, oz + 24]],
  ];
}

/**
 * Generates deterministic visible stone/ore outcrops, dense interlocking woodland groves,
 * mossy boulders, and forest ferns across the whole 560 x 560 m map while strictly respecting
 * settlements, water, roads, farms, outcrops, and Mission 5's bare fortress plateau.
 */
function scatterNatureAcrossWorld(
  terrain: TerrainField,
  layout: {
    readonly id: MapLayoutId;
    readonly playerKeepXZ: readonly [number, number];
    readonly enemyCenterXZ: readonly [number, number];
    readonly buildings: readonly BuildingPlacementSpec[];
    readonly farmStrips: readonly FarmStripSpec[];
    readonly roads: readonly (readonly (readonly [number, number])[])[];
    readonly calibrationXZ: readonly [number, number];
  },
  targetTrees: number,
  targetRocks: number,
  targetFerns: number,
  rng: () => number,
): { outcrops: ResourceOutcropSpec[]; trees: TreeSpec[]; rocks: RockSpec[]; ferns: FernSpec[] } {
  const outcrops: ResourceOutcropSpec[] = [];
  const trees: TreeSpec[] = [];
  const rocks: RockSpec[] = [];
  const ferns: FernSpec[] = [];
  const fp = terrain.config.fortressPlateau;

  const isNearRoad = (x: number, z: number, padM: number): boolean => {
    for (const poly of layout.roads) {
      for (let i = 0; i < poly.length - 1; i++) {
        const [x0, z0] = poly[i]!;
        const [x1, z1] = poly[i + 1]!;
        const dx = x1 - x0;
        const dz = z1 - z0;
        const lenSq = Math.max(1e-4, dx * dx + dz * dz);
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / lenSq));
        if (Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) < padM) return true;
      }
    }
    return false;
  };

  // 1. Place 6 guaranteed, clear, dry-land Stone & Iron Ore outcrops (shared by 3D renderer, minimap & SimEngine!)
  const findDryOutcropSpot = (idealX: number, idealZ: number): [number, number] => {
    const isGood = (x: number, z: number): boolean => {
      if (Math.abs(x) > 235 || Math.abs(z) > 235) return false;
      if (terrain.heightAt(x, z) < 0.45 || terrain.slopeAt(x, z) > 0.24) return false;
      if (fp && Math.hypot(x - fp.cx, z - fp.cz) < fp.flatRadiusM + 10) return false;
      if (Math.hypot(x - layout.calibrationXZ[0], z - layout.calibrationXZ[1]) < 14) return false;
      if (isNearRoad(x, z, 7.5)) return false;
      for (const b of layout.buildings) {
        if (Math.hypot(x - b.x, z - b.z) < Math.max(b.yardRx, b.yardRz) + 9.0) return false;
      }
      for (const fs of layout.farmStrips) {
        if (Math.hypot(x - fs.cx, z - fs.cz) < Math.max(fs.lenM, fs.widM) * 0.6 + 7.0) return false;
      }
      for (const o of outcrops) {
        if (Math.hypot(x - o.x, z - o.z) < 26) return false;
      }
      return true;
    };
    if (isGood(idealX, idealZ)) return [idealX, idealZ];
    for (let r = 6; r <= 72; r += 6) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const cx = idealX + Math.cos(ang) * r;
        const cz = idealZ + Math.sin(ang) * r;
        if (isGood(cx, cz)) return [Math.round(cx), Math.round(cz)];
      }
    }
    return [idealX, idealZ];
  };

  const [pkx, pkz] = layout.playerKeepXZ;
  const [ekx, ekz] = layout.enemyCenterXZ;
  const desiredOutcrops: readonly { kind: 'stone' | 'ore'; x: number; z: number }[] = [
    { kind: 'stone', x: pkx - 28, z: pkz + 32 },
    { kind: 'ore', x: pkx - 32, z: pkz - 34 },
    { kind: 'stone', x: ekx + 28, z: ekz - 32 },
    { kind: 'ore', x: ekx + 32, z: ekz + 34 },
    { kind: 'stone', x: 0, z: -110 },
    { kind: 'ore', x: 0, z: 110 },
  ];
  for (const d of desiredOutcrops) {
    const [ox, oz] = findDryOutcropSpot(d.x, d.z);
    outcrops.push({ kind: d.kind, x: ox, z: oz });
  }

  const isBlockedForTree = (x: number, z: number): boolean => {
    if (Math.abs(x) > 258 || Math.abs(z) > 258) return true;
    if (Math.hypot(x - layout.calibrationXZ[0], z - layout.calibrationXZ[1]) < 14) return true;
    // Mission 5 rule: ZERO forest on the 100 m fortress plateau!
    if (fp && Math.hypot(x - fp.cx, z - fp.cz) < fp.flatRadiusM + 18) return true;
    const h = terrain.heightAt(x, z);
    if (h < 0.45) return true;
    if (terrain.slopeAt(x, z) > 0.25) return true;
    if (isNearRoad(x, z, 6.8)) return true;
    for (const o of outcrops) {
      // Keep Stone & Iron Ore outcrops in crisp open clearings so players always spot them!
      if (Math.hypot(x - o.x, z - o.z) < 12.0) return true;
    }
    for (const b of layout.buildings) {
      if (Math.hypot(x - b.x, z - b.z) < Math.max(b.yardRx, b.yardRz) + 6.2) return true;
    }
    for (const fs of layout.farmStrips) {
      if (Math.hypot(x - fs.cx, z - fs.cz) < Math.max(fs.lenM, fs.widM) * 0.65 + 4.8) return true;
    }
    // Keep central battlefield corridor open for clear tactical sightlines
    if (layout.id === 'crossing' && x > -22 && x < 72 && Math.abs(z) < 42) return true;
    if (layout.id === 'openField' && Math.abs(x) < 75 && Math.abs(z) < 55) return true;
    if (layout.id === 'valley' && Math.abs(z) < 48 && x > -105 && x < 165) return true;
    if (layout.id === 'fortress' && Math.abs(x) < 52 && z > 20 && z < 195) return true;
    return false;
  };

  // 2. Dense, interlocking medieval woodland groves (O(1) spatial hash prevents overlapping trunks!)
  const speciesCycle: readonly ('oak' | 'pine' | 'birch')[] = ['oak', 'pine', 'birch'];
  const groveCenters: [number, number, 'oak' | 'pine' | 'birch', number][] = [
    // Guaranteed thick timber woods near Player & Enemy towns for minute-1 Woodcutter / Tutorial!
    [pkx - 42, pkz - 12, 'oak', 26],
    [pkx + 14, pkz - 52, 'birch', 24],
    [ekx + 42, ekz + 12, 'oak', 26],
    [ekx - 14, ekz + 52, 'pine', 24],
  ];
  const extraGroves = layout.id === 'forest' ? 24 : 16;
  for (let g = 0; g < extraGroves; g++) {
    const gx = (rng() - 0.5) * 465;
    const gz = (rng() - 0.5) * 465;
    const rad = (layout.id === 'forest' ? 30 : 25) + rng() * 14;
    groveCenters.push([gx, gz, speciesCycle[g % 3]!, rad]);
  }

  // 4 m spatial grid for O(1) trunk clearance checks (>= 3.45 m spacing -> lush interlocking canopies!)
  const minTrunkDistSq = 3.45 * 3.45;
  const gridMap = new Map<number, TreeSpec[]>();
  const cellKey = (cx: number, cz: number): number => ((cx + 512) << 12) | (cz + 512);
  const hasNearbyTrunk = (x: number, z: number): boolean => {
    const cx = Math.floor(x / 4);
    const cz = Math.floor(z / 4);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = gridMap.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const t of bucket) {
          const ex = t.x - x;
          const ez = t.z - z;
          if (ex * ex + ez * ez < minTrunkDistSq) return true;
        }
      }
    }
    return false;
  };
  const registerTree = (t: TreeSpec): void => {
    trees.push(t);
    const k = cellKey(Math.floor(t.x / 4), Math.floor(t.z / 4));
    const bucket = gridMap.get(k);
    if (bucket) bucket.push(t);
    else gridMap.set(k, [t]);
  };

  let attempts = 0;
  const maxAttempts = targetTrees * 18;
  while (trees.length < targetTrees && attempts < maxAttempts) {
    attempts++;
    const useGrove = rng() < 0.94;
    let x: number;
    let z: number;
    let preferred: 'oak' | 'pine' | 'birch';
    if (useGrove) {
      const gr = groveCenters[Math.floor(rng() * groveCenters.length)]!;
      // Dense core clustering (pow 0.72) creates true thick woodland interiors with organic tapered edges
      const rad = Math.pow(rng(), 0.72) * gr[3];
      const ang = rng() * Math.PI * 2;
      x = gr[0] + Math.cos(ang) * rad;
      z = gr[1] + Math.sin(ang) * rad;
      preferred = rng() < 0.76 ? gr[2] : speciesCycle[Math.floor(rng() * 3)]!;
    } else {
      x = (rng() - 0.5) * 490;
      z = (rng() - 0.5) * 490;
      preferred = speciesCycle[Math.floor(rng() * 3)]!;
    }

    if (isBlockedForTree(x, z)) continue;
    if (hasNearbyTrunk(x, z)) continue;

    // Highland slopes favor Scots Pine; riverside favors Silver Birch & Oak
    const h = terrain.heightAt(x, z);
    const sp: 'oak' | 'pine' | 'birch' =
      h > 6.5 ? 'pine' : h < 1.35 && rng() < 0.52 ? 'birch' : preferred;

    registerTree({
      species: sp,
      x,
      z,
      yawRad: rng() * Math.PI * 2,
      scale: 0.90 + rng() * 0.48,
    });
  }

  // 3. Scatter Poly Haven CC0 photogrammetry mossy boulders & rocks along slopes, riverbanks & groves
  const rockKinds: readonly ('rock_moss_a' | 'rock_moss_b' | 'boulder')[] = [
    'rock_moss_a',
    'rock_moss_b',
    'boulder',
  ];
  let rAtt = 0;
  while (rocks.length < targetRocks && rAtt < targetRocks * 16) {
    rAtt++;
    const x = (rng() - 0.5) * 490;
    const z = (rng() - 0.5) * 490;
    if (Math.hypot(x - layout.calibrationXZ[0], z - layout.calibrationXZ[1]) < 12) continue;
    if (fp && Math.hypot(x - fp.cx, z - fp.cz) < fp.flatRadiusM + 4) continue;
    if (isNearRoad(x, z, 6.0)) continue;
    const h = terrain.heightAt(x, z);
    const sl = terrain.slopeAt(x, z);
    const scenicSite = sl > 0.055 || (h > 0.12 && h < 1.05) || rng() < 0.22;
    if (!scenicSite || h < -0.10) continue;
    let clear = true;
    for (const b of layout.buildings) {
      if (Math.hypot(x - b.x, z - b.z) < Math.max(b.yardRx, b.yardRz) + 3.5) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    rocks.push({
      kind: rockKinds[Math.floor(rng() * 3)]!,
      x,
      z,
      yawRad: rng() * Math.PI * 2,
      scale: 0.72 + rng() * 1.15 + (sl > 0.14 ? 0.55 : 0),
    });
  }

  // 4. Scatter Poly Haven CC0 forest ferns tucked naturally near tree trunks & shaded woodland undergrowth
  for (let i = 0; i < targetFerns && trees.length > 0; i++) {
    const host = trees[Math.floor(rng() * trees.length)]!;
    const a = rng() * Math.PI * 2;
    const r = 1.4 + rng() * 3.8;
    const fx = host.x + Math.cos(a) * r;
    const fz = host.z + Math.sin(a) * r;
    if (Math.abs(fx) > 258 || Math.abs(fz) > 258) continue;
    if (terrain.heightAt(fx, fz) < 0.25) continue;
    if (isNearRoad(fx, fz, 4.5)) continue;
    ferns.push({
      x: fx,
      z: fz,
      yawRad: rng() * Math.PI * 2,
      scale: 0.78 + rng() * 0.52,
    });
  }

  return { outcrops, trees, rocks, ferns };
}

// ==============================================================================
// 5 CAMPAIGN & SKIRMISH MAP GENERATORS (560 x 560 m)
// ==============================================================================

function buildCrossingMap(): MapLayoutSpec {
  const rng = createRng(101);
  const terraces: FlatTerraceSpec[] = [
    { cx: -72, cz: 0, radiusXM: 54, radiusZM: 46, heightM: 1.65, blendM: 22 },
    { cx: 108, cz: 6, radiusXM: 42, radiusZM: 38, heightM: 1.75, blendM: 20 },
    { cx: -52, cz: 68, radiusXM: 16, radiusZM: 16, heightM: 1.65, blendM: 12 }, // calibration plinth terrace
  ];
  const terrainConfig: TerrainConfig = {
    profile: 'crossing',
    seed: 11,
    sizeM: WORLD.sizeM,
    gridResolution: 281,
    lake: { centerX: -12, centerZ: 56, radiusXM: 20, radiusZM: 14, maxDepthM: 1.35, waterLevelM: 0.0 },
    river: {
      axis: 'ns',
      baseCoordM: 24,
      meanderAmpM: 13,
      meanderFreq: 0.013,
      halfWidthM: 10.5,
      maxDepthM: 1.45,
      waterLevelM: 0.0,
      crossings: [
        { coordM: 6, halfSpanM: 6.2, kind: 'causeway' },
        { coordM: -90, halfSpanM: 10.0, kind: 'ford' },
        { coordM: 96, halfSpanM: 10.0, kind: 'ford' },
      ],
    },
    terraces,
  };

  const terrain = new TerrainField(terrainConfig);
  const buildings: BuildingPlacementSpec[] = [];
  const walls: WallSegmentSpec[] = [];
  const farmStrips: FarmStripSpec[] = [];
  const props: PropSpec[] = [];
  const units: UnitPlacementSpec[] = [];

  // 1. West Bank Complete Medieval Town anchored around (-66, 0)
  appendPlayerTown(-66, 0, true, buildings, farmStrips, props, units, rng);

  // Fisher's Hut + Poly Haven CC0 Wooden Pier on the village lake shore (-12, 56)
  buildings.push({ kind: 'fisher_l1', x: -29, z: 48, yawRad: 1.15, yardRx: 5.5, yardRz: 5.0, team: 0 });
  props.push({ kind: 'pier', x: -22.5, z: 52.5, yawRad: 1.15, scale: 0.95 });

  // Western Defensive Curtain Wall + Gatehouse + 3 Watchtowers guarding the river causeway approach!
  buildings.push(
    { kind: 'gate_l1', x: -16, z: 6, yawRad: Math.PI * 0.5, yardRx: 5.5, yardRz: 5.5, team: 0 },
    { kind: 'watchtower_l1', x: -16, z: -18, yawRad: Math.PI * 0.5, yardRx: 4.5, yardRz: 4.5, team: 0 },
    { kind: 'watchtower_l1', x: -16, z: 30, yawRad: Math.PI * 0.5, yardRx: 4.5, yardRz: 4.5, team: 0 },
    { kind: 'watchtower_l1', x: -42, z: -36, yawRad: 0.0, yardRx: 4.5, yardRz: 4.5, team: 0 },
  );
  // Extend wall runs right into watchtower (-16,-18 / -16,30) & gatehouse (-16,6) masonry so zero gaps appear
  appendWallRun(walls, -16, -17.6, -16, 3.0, [], false);
  appendWallRun(walls, -16, 9.0, -16, 29.6, [], false);

  // 2. East Bank Enemy Crimson War Camp (grid-aligned along camp road z = 6, entrances facing the road!)
  buildings.push(
    { kind: 'gate_l1', x: 78, z: 6, yawRad: -Math.PI * 0.5, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'watchtower_l1', x: 78, z: -14, yawRad: -Math.PI * 0.5, yardRx: 4.5, yardRz: 4.5, team: 1 },
    { kind: 'watchtower_l1', x: 78, z: 26, yawRad: -Math.PI * 0.5, yardRx: 4.5, yardRz: 4.5, team: 1 },
    { kind: 'camp_tent_l1', x: 100, z: -6, yawRad: 0.0, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 112, z: -6, yawRad: 0.0, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 100, z: 18, yawRad: Math.PI, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 112, z: 18, yawRad: Math.PI, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 124, z: 6, yawRad: -Math.PI * 0.5, yardRx: 6.2, yardRz: 6.2, team: 1 },
  );
  appendWallRun(walls, 78, -13.6, 78, 3.0, [], true);
  appendWallRun(walls, 78, 9.0, 78, 25.6, [], true);
  // Enemy siege cannons & supply crates overlooking the river crossing
  props.push(
    { kind: 'cannon', x: 64, z: -3, yawRad: -Math.PI * 0.5, scale: 1.0 },
    { kind: 'cannon', x: 64, z: 15, yawRad: -Math.PI * 0.5, scale: 1.0 },
    { kind: 'crate', x: 96, z: -2, yawRad: 0.0, scale: 1.0 },
    { kind: 'barrel', x: 97.5, z: -2, yawRad: 0.0, scale: 1.0 },
    { kind: 'crate', x: 96, z: 14, yawRad: 0.0, scale: 1.05 },
  );

  // 3. Opposing Armies (160+ total GPU-instanced MakeHuman soldiers & villagers!)
  // Marchland Cobalt defenders mustered at eastern gate & river causeway bridgehead
  appendRegiment(units, 'swordsman', 0, -4, 1, 6, 4, Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'swordsman', 0, -4, 14, 5, 4, Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'archer', 0, -24, -6, 6, 3, Math.PI * 0.5, 1.6, rng, 'idle');
  appendRegiment(units, 'archer', 0, -24, 18, 6, 3, Math.PI * 0.5, 1.6, rng, 'idle');
  // Forward clash picket on central causeway
  appendRegiment(units, 'swordsman', 0, 14, 6, 4, 2, Math.PI * 0.5, 1.45, rng, 'attack');
  // Enemy Crimson invader divisions on the east bank facing west across the river
  appendRegiment(units, 'swordsman', 1, 56, 2, 6, 4, -Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'swordsman', 1, 56, 15, 6, 4, -Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'archer', 1, 68, -8, 6, 3, -Math.PI * 0.5, 1.6, rng, 'attack');
  appendRegiment(units, 'archer', 1, 68, 22, 6, 3, -Math.PI * 0.5, 1.6, rng, 'idle');
  appendRegiment(units, 'swordsman', 1, 90, 6, 4, 3, -Math.PI * 0.5, 1.6, rng, 'walk');

  const roads: readonly (readonly (readonly [number, number])[])[] = [
    [[-74, 0], [-30, 0], [-16, 6], [24, 6], [78, 6], [116, 6]],
    ...getPlayerTownGridRoads(-66, 0, true),
    [[-46, 24], [-30, 44]],
    [[-16, -18], [-12, -55], [24, -90], [64, -84], [78, -14]],
    [[-16, 30], [-6, 68], [24, 96], [66, 86], [78, 26]],
  ];

  const capturePoints: readonly CapturePointSpec[] = [
    { id: 'cp_north_ford', label: 'North Ford', x: terrain.riverCenterAt(-90), z: -90 },
    { id: 'cp_causeway', label: 'Stone Causeway', x: terrain.riverCenterAt(6), z: 6 },
    { id: 'cp_south_ford', label: 'South Ford', x: terrain.riverCenterAt(96), z: 96 },
  ];

  const calibrationXZ: readonly [number, number] = [-52, 68];
  const nature = scatterNatureAcrossWorld(
    terrain,
    { id: 'crossing', playerKeepXZ: [-82, -4], enemyCenterXZ: [104, 6], buildings, farmStrips, roads, calibrationXZ },
    1050,
    135,
    380,
    rng,
  );

  return {
    id: 'crossing',
    title: 'River Crossing',
    subtitle: 'Missions 1–2 · River, stone causeway, twin fords & east-bank invader camp',
    terrainConfig,
    playerKeepXZ: [-82, -4],
    enemyCenterXZ: [104, 6],
    calibrationXZ,
    buildings,
    walls,
    farmStrips,
    roads,
    capturePoints,
    ...nature,
    props,
    units,
  };
}

function buildOpenFieldMap(): MapLayoutSpec {
  const rng = createRng(202);
  const terrainConfig: TerrainConfig = {
    profile: 'openField',
    seed: 23,
    sizeM: WORLD.sizeM,
    gridResolution: 281,
    lake: { centerX: -95, centerZ: 92, radiusXM: 24, radiusZM: 16, maxDepthM: 1.4, waterLevelM: 0.0 },
    extraLakes: [
      { centerX: 105, centerZ: -88, radiusXM: 22, radiusZM: 15, maxDepthM: 1.35, waterLevelM: 0.0 },
    ],
    terraces: [
      { cx: -125, cz: 0, radiusXM: 54, radiusZM: 46, heightM: 1.8, blendM: 22 },
      { cx: 125, cz: 0, radiusXM: 46, radiusZM: 42, heightM: 1.8, blendM: 22 },
      { cx: -70, cz: 58, radiusXM: 16, radiusZM: 16, heightM: 1.8, blendM: 12 },
    ],
  };
  const terrain = new TerrainField(terrainConfig);
  const buildings: BuildingPlacementSpec[] = [];
  const walls: WallSegmentSpec[] = [];
  const farmStrips: FarmStripSpec[] = [];
  const props: PropSpec[] = [];
  const units: UnitPlacementSpec[] = [];

  appendPlayerTown(-118, 0, true, buildings, farmStrips, props, units, rng);
  buildings.push(
    { kind: 'fisher_l1', x: -115, z: 78, yawRad: 0.75, yardRx: 5.5, yardRz: 5.0, team: 0 },
    // East rival lord's fortified manor & garrison (grid-aligned along z = 0 road, entrances facing road!)
    { kind: 'keep_l1', x: 136, z: 0, yawRad: -Math.PI * 0.5, yardRx: 11.5, yardRz: 9.5, team: 1 },
    { kind: 'barracks_l1', x: 116, z: -12, yawRad: 0.0, yardRx: 9.5, yardRz: 7.0, team: 1 },
    { kind: 'house_l1', x: 116, z: 12, yawRad: Math.PI, yardRx: 6.0, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 98, z: -10, yawRad: 0.0, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 98, z: 10, yawRad: Math.PI, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'watchtower_l1', x: 86, z: -20, yawRad: -Math.PI * 0.5, yardRx: 4.5, yardRz: 4.5, team: 1 },
    { kind: 'watchtower_l1', x: 86, z: 20, yawRad: -Math.PI * 0.5, yardRx: 4.5, yardRz: 4.5, team: 1 },
  );
  props.push(
    { kind: 'pier', x: -108, z: 83, yawRad: 0.75, scale: 0.95 },
    { kind: 'cannon', x: -32, z: -12, yawRad: Math.PI * 0.5, scale: 1.0 },
    { kind: 'cannon', x: 32, z: 12, yawRad: -Math.PI * 0.5, scale: 1.0 },
  );

  // Grand pitched field battle across central sunlit ridge!
  appendRegiment(units, 'swordsman', 0, -24, -4, 6, 4, Math.PI * 0.5, 1.55, rng, 'walk');
  appendRegiment(units, 'swordsman', 0, -24, 14, 6, 4, Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'archer', 0, -44, 4, 8, 3, Math.PI * 0.5, 1.6, rng, 'attack');
  appendRegiment(units, 'swordsman', 1, 24, -4, 6, 4, -Math.PI * 0.5, 1.55, rng, 'walk');
  appendRegiment(units, 'swordsman', 1, 24, 14, 6, 4, -Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'archer', 1, 44, 4, 8, 3, -Math.PI * 0.5, 1.6, rng, 'attack');

  const roads: readonly (readonly (readonly [number, number])[])[] = [
    [[-126, 0], [-82, 0], [0, 0], [88, 0], [126, 0]],
    ...getPlayerTownGridRoads(-118, 0, true),
    [[-122, 26], [-115, 72]],
  ];
  const capturePoints: readonly CapturePointSpec[] = [
    { id: 'cp_north', label: 'Northern Meadow', x: 0, z: -72 },
    { id: 'cp_ridge', label: 'Central Ridge', x: 0, z: 0 },
    { id: 'cp_south', label: 'Southern Orchard', x: 0, z: 72 },
  ];
  const calibrationXZ: readonly [number, number] = [-70, 58];
  const nature = scatterNatureAcrossWorld(
    terrain,
    { id: 'openField', playerKeepXZ: [-134, -4], enemyCenterXZ: [136, -2], buildings, farmStrips, roads, calibrationXZ },
    920,
    115,
    340,
    rng,
  );

  return {
    id: 'openField',
    title: 'Open Field',
    subtitle: 'Skirmish · Rolling central-European plains, twin lakes & pitched battle ridge',
    terrainConfig,
    playerKeepXZ: [-134, -4],
    enemyCenterXZ: [136, -2],
    calibrationXZ,
    buildings,
    walls,
    farmStrips,
    roads,
    capturePoints,
    ...nature,
    props,
    units,
  };
}

function buildForestMap(): MapLayoutSpec {
  const rng = createRng(303);
  const terrainConfig: TerrainConfig = {
    profile: 'forest',
    seed: 37,
    sizeM: WORLD.sizeM,
    gridResolution: 281,
    lake: { centerX: 8, centerZ: -64, radiusXM: 21, radiusZM: 15, maxDepthM: 1.45, waterLevelM: 0.0 },
    terraces: [
      { cx: -115, cz: -12, radiusXM: 50, radiusZM: 44, heightM: 2.0, blendM: 20 },
      { cx: 112, cz: 18, radiusXM: 42, radiusZM: 38, heightM: 2.2, blendM: 20 },
      { cx: -58, cz: 54, radiusXM: 16, radiusZM: 16, heightM: 2.0, blendM: 12 },
    ],
  };
  const terrain = new TerrainField(terrainConfig);
  const buildings: BuildingPlacementSpec[] = [];
  const walls: WallSegmentSpec[] = [];
  const farmStrips: FarmStripSpec[] = [];
  const props: PropSpec[] = [];
  const units: UnitPlacementSpec[] = [];

  appendPlayerTown(-110, -12, true, buildings, farmStrips, props, units, rng);
  buildings.push(
    { kind: 'woodcutter_l1', x: -55, z: -24, yawRad: 0.0, yardRx: 6.5, yardRz: 6.0, team: 0 },
    { kind: 'fisher_l1', x: -12, z: -56, yawRad: 1.0, yardRx: 5.5, yardRz: 5.0, team: 0 },
    { kind: 'watchtower_l1', x: 0, z: -6, yawRad: 0.0, yardRx: 4.5, yardRz: 4.5, team: 1 },
    // East bandit camp grid-aligned along z = 16 road with entrances facing the road
    { kind: 'camp_tent_l1', x: 102, z: 6, yawRad: 0.0, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 114, z: 6, yawRad: 0.0, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 108, z: 26, yawRad: Math.PI, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'barracks_l1', x: 128, z: 16, yawRad: -Math.PI * 0.5, yardRx: 9.0, yardRz: 7.0, team: 1 },
  );
  props.push({ kind: 'pier', x: -5, z: -59, yawRad: 1.0, scale: 0.92 });

  appendRegiment(units, 'swordsman', 0, -42, -6, 6, 4, 1.4, 1.55, rng, 'walk');
  appendRegiment(units, 'swordsman', 0, -48, 12, 5, 4, 1.4, 1.55, rng, 'idle');
  appendRegiment(units, 'archer', 0, -58, 4, 6, 3, 1.4, 1.6, rng, 'idle');
  appendRegiment(units, 'swordsman', 1, 52, 10, 6, 4, -1.5, 1.55, rng, 'idle');
  appendRegiment(units, 'swordsman', 1, 56, -8, 5, 4, -1.5, 1.55, rng, 'walk');
  appendRegiment(units, 'archer', 1, 68, 18, 6, 3, -1.5, 1.6, rng, 'attack');

  const roads: readonly (readonly (readonly [number, number])[])[] = [
    [[-118, -12], [-74, -12], [-22, -4], [24, 6], [76, 16], [118, 16]],
    ...getPlayerTownGridRoads(-110, -12, true),
    [[-16, -4], [-8, -50]],
    [[4, 4], [10, 74]],
  ];
  const capturePoints: readonly CapturePointSpec[] = [
    { id: 'cp_tarn', label: 'Forest Tarn', x: 8, z: -42 },
    { id: 'cp_glade', label: 'Logging Crossroads', x: 0, z: 4 },
    { id: 'cp_south_glade', label: 'South Glade', x: 10, z: 74 },
  ];
  const calibrationXZ: readonly [number, number] = [-58, 54];
  const nature = scatterNatureAcrossWorld(
    terrain,
    { id: 'forest', playerKeepXZ: [-126, -16], enemyCenterXZ: [112, 16], buildings, farmStrips, roads, calibrationXZ },
    1450,
    145,
    480,
    rng,
  );

  return {
    id: 'forest',
    title: 'Ancient Forest',
    subtitle: 'Skirmish · Dense highland woodland, mossy boulders, timber roads & glades',
    terrainConfig,
    playerKeepXZ: [-126, -16],
    enemyCenterXZ: [112, 16],
    calibrationXZ,
    buildings,
    walls,
    farmStrips,
    roads,
    capturePoints,
    ...nature,
    props,
    units,
  };
}

function buildValleyMap(): MapLayoutSpec {
  const rng = createRng(404);
  // Exact docs/CAMPAIGN.md (19.11): twin mountain ridges flanking central axis (175 m off axis, peak every 52 m!)
  const peaks: MountainPeakSpec[] = [];
  for (let x = -234; x <= 234; x += 52) {
    peaks.push(
      { cx: x + (rng() - 0.5) * 10, cz: -175 + (rng() - 0.5) * 14, radiusM: 58, heightM: 22 + rng() * 12 },
      { cx: x + (rng() - 0.5) * 10, cz: 175 + (rng() - 0.5) * 14, radiusM: 58, heightM: 22 + rng() * 12 },
    );
  }
  // Mountain pass shoulders narrowing the far eastern entrance (x = +225)
  peaks.push(
    { cx: 235, cz: -85, radiusM: 64, heightM: 24 },
    { cx: 235, cz: 85, radiusM: 64, heightM: 24 },
  );

  const terrainConfig: TerrainConfig = {
    profile: 'valley',
    seed: 47,
    sizeM: WORLD.sizeM,
    gridResolution: 281,
    lake: { centerX: -24, centerZ: -86, radiusXM: 26, radiusZM: 16, maxDepthM: 1.4, waterLevelM: 0.0 },
    terraces: [
      { cx: -156, cz: 0, radiusXM: 54, radiusZM: 44, heightM: 1.8, blendM: 20 },
      { cx: 118, cz: 0, radiusXM: 46, radiusZM: 40, heightM: 1.9, blendM: 20 }, // 274 m from player Keep!
      { cx: -92, cz: 66, radiusXM: 16, radiusZM: 16, heightM: 1.8, blendM: 12 },
    ],
    peaks,
  };
  const terrain = new TerrainField(terrainConfig);
  const buildings: BuildingPlacementSpec[] = [];
  const walls: WallSegmentSpec[] = [];
  const farmStrips: FarmStripSpec[] = [];
  const props: PropSpec[] = [];
  const units: UnitPlacementSpec[] = [];

  // Player Keep at West end (-156, -4)
  appendPlayerTown(-140, 0, true, buildings, farmStrips, props, units, rng);

  // Central Valley Village centered at (+118, 0) — EXACTLY 274 m from Player Keep (-156, 0)!
  // Grid-planned around the main valley road (z = 0) and cross street (x = 118), with all entrances facing the streets!
  buildings.push(
    { kind: 'market_l1', x: 110, z: -11, yawRad: 0.0, yardRx: 8.5, yardRz: 7.5, team: 1 },
    { kind: 'well_l1', x: 126, z: -9, yawRad: 0.0, yardRx: 3.4, yardRz: 3.4, team: 1 },
    { kind: 'watchtower_l1', x: 96, z: -11, yawRad: 0.0, yardRx: 4.8, yardRz: 4.8, team: 1 },
    { kind: 'house_l1', x: 110, z: 11, yawRad: Math.PI, yardRx: 6.2, yardRz: 5.8, team: 1 },
    { kind: 'house_l1', x: 126, z: 11, yawRad: Math.PI, yardRx: 6.2, yardRz: 5.8, team: 1 },
    { kind: 'house_l1', x: 110, z: 22, yawRad: Math.PI * 0.5, yardRx: 6.2, yardRz: 5.8, team: 1 },
    // 6 Rebuildable Burned Cottage Ruins neatly aligned on the village street grid facing z = 0 and x = 118 (docs/CAMPAIGN.md M4!)
    { kind: 'ruin_house', x: 96, z: 11, yawRad: Math.PI, yardRx: 5.5, yardRz: 5.0, team: 1 },
    { kind: 'ruin_house', x: 110, z: -22, yawRad: Math.PI * 0.5, yardRx: 5.5, yardRz: 5.0, team: 1 },
    { kind: 'ruin_house', x: 126, z: -20, yawRad: -Math.PI * 0.5, yardRx: 5.5, yardRz: 5.0, team: 1 },
    { kind: 'ruin_house', x: 138, z: -11, yawRad: 0.0, yardRx: 5.5, yardRz: 5.0, team: 1 },
    { kind: 'ruin_house', x: 138, z: 11, yawRad: Math.PI, yardRx: 5.5, yardRz: 5.0, team: 1 },
    { kind: 'ruin_house', x: 126, z: 22, yawRad: -Math.PI * 0.5, yardRx: 5.5, yardRz: 5.0, team: 1 },
    // East pass enemy relief camp aligned along z = 0 road
    { kind: 'camp_tent_l1', x: 212, z: -11, yawRad: 0.0, yardRx: 5.5, yardRz: 5.5, team: 1 },
    { kind: 'camp_tent_l1', x: 212, z: 11, yawRad: Math.PI, yardRx: 5.5, yardRz: 5.5, team: 1 },
  );

  // Player liberation column advancing down the valley road + Enemy village garrison
  appendRegiment(units, 'swordsman', 0, -55, -5, 6, 4, Math.PI * 0.5, 1.55, rng, 'walk');
  appendRegiment(units, 'swordsman', 0, -55, 11, 6, 4, Math.PI * 0.5, 1.55, rng, 'walk');
  appendRegiment(units, 'archer', 0, -76, 3, 7, 3, Math.PI * 0.5, 1.6, rng, 'walk');
  appendRegiment(units, 'swordsman', 1, 78, -6, 6, 4, -Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'swordsman', 1, 78, 12, 6, 4, -Math.PI * 0.5, 1.55, rng, 'idle');
  appendRegiment(units, 'archer', 1, 96, 4, 7, 3, -Math.PI * 0.5, 1.6, rng, 'attack');
  appendRegiment(units, 'swordsman', 1, 198, 0, 5, 4, -Math.PI * 0.5, 1.6, rng, 'walk');

  const roads: readonly (readonly (readonly [number, number])[])[] = [
    [[-148, 0], [-104, 0], [0, 0], [118, 0], [235, 0]],
    ...getPlayerTownGridRoads(-140, 0, true),
    [[118, -26], [118, 0], [118, 26]],
    [[-144, -26], [-120, -42], [-45, -72]],
  ];
  const capturePoints: readonly CapturePointSpec[] = [
    { id: 'cp_west_gate', label: 'Valley Road', x: -16, z: 0 },
    { id: 'cp_village', label: 'Valley Village Square', x: 118, z: 0 },
    { id: 'cp_pass', label: 'Mountain Pass', x: 210, z: 0 },
  ];
  const calibrationXZ: readonly [number, number] = [-92, 66];
  const nature = scatterNatureAcrossWorld(
    terrain,
    { id: 'valley', playerKeepXZ: [-156, -4], enemyCenterXZ: [118, 0], buildings, farmStrips, roads, calibrationXZ },
    1150,
    160,
    400,
    rng,
  );

  return {
    id: 'valley',
    title: 'Mountain Valley',
    subtitle: 'Missions 3–4 · Twin mountain ridges, occupied central village w/ 6 ruins & mountain pass',
    terrainConfig,
    playerKeepXZ: [-156, -4],
    enemyCenterXZ: [118, 0],
    calibrationXZ,
    buildings,
    walls,
    farmStrips,
    roads,
    capturePoints,
    ...nature,
    props,
    units,
  };
}

function buildFortressMap(): MapLayoutSpec {
  const rng = createRng(505);
  const fcx = 0;
  const fcz = -48;

  // Exact docs/CAMPAIGN.md Mission 5 Fortress layout:
  //   - 7 m high citadel plateau flat to 100 m radius (ZERO lake/ore/forest on plateau!)
  //   - Outer wall 124 x 112 m (8 watchtowers + main South Gatehouse)
  //   - Inner wall 84 x 70 m (4 watchtowers + offset West/Left Gate so no direct line of fire!)
  //   - Monumental central `fortress_donzon` + working enemy garrison town inside walls
  //   - Southern river + shallow ford + Player Siege Camp with cannons!
  const terrainConfig: TerrainConfig = {
    profile: 'fortress',
    seed: 59,
    sizeM: WORLD.sizeM,
    gridResolution: 281,
    lake: { centerX: 0, centerZ: 0, radiusXM: 0, radiusZM: 0, maxDepthM: 0, waterLevelM: 0.0 },
    river: {
      axis: 'ew',
      baseCoordM: 116,
      meanderAmpM: 9,
      meanderFreq: 0.015,
      halfWidthM: 9.5,
      maxDepthM: 1.35,
      waterLevelM: 0.0,
      crossings: [
        { coordM: 0, halfSpanM: 12.0, kind: 'ford' },
        { coordM: -95, halfSpanM: 9.0, kind: 'ford' },
      ],
    },
    terraces: [
      { cx: 0, cz: 174, radiusXM: 56, radiusZM: 34, heightM: 1.85, blendM: 18 }, // player siege camp
      { cx: -78, cz: 162, radiusXM: 16, radiusZM: 16, heightM: 1.85, blendM: 12 }, // calibration plinth
    ],
    fortressPlateau: {
      cx: fcx,
      cz: fcz,
      flatRadiusM: 100,
      slopeOuterRadiusM: 132,
      heightM: 7.0,
      rampZDir: 1,
      rampHalfWidthM: 24,
    },
  };
  const terrain = new TerrainField(terrainConfig);
  const buildings: BuildingPlacementSpec[] = [];
  const walls: WallSegmentSpec[] = [];
  const farmStrips: FarmStripSpec[] = [];
  const props: PropSpec[] = [];
  const units: UnitPlacementSpec[] = [];

  // 1. Monumental Central Fortress Donżon at (fcx, fcz) on 7.0 m plateau!
  buildings.push({
    kind: 'fortress_donzon',
    x: fcx,
    z: fcz,
    yawRad: 0.0,
    yardRx: 18,
    yardRz: 16,
    team: 1,
  });

  // 2. OUTER WALL RING: 124 x 112 m (halfX = 62, halfZ = 56) — 8 watchtowers + Main South Gatehouse!
  const ox = 62;
  const oz = 56;
  const outerTowers: readonly [number, number, number][] = [
    [fcx - ox, fcz - oz, Math.PI],
    [fcx, fcz - oz, Math.PI],
    [fcx + ox, fcz - oz, Math.PI],
    [fcx - ox, fcz, -Math.PI * 0.5],
    [fcx + ox, fcz, Math.PI * 0.5],
    [fcx - ox, fcz + oz, 0],
    [fcx - 16, fcz + oz, 0],
    [fcx + 16, fcz + oz, 0],
  ];
  for (const [tx, tz, ty] of outerTowers) {
    buildings.push({ kind: 'watchtower_l1', x: tx, z: tz, yawRad: ty, yardRx: 4.5, yardRz: 4.5, team: 1 });
  }
  // Main South Gatehouse centered at (fcx, fcz + oz) facing South (+Z toward player siege camp!)
  buildings.push({ kind: 'gate_l1', x: fcx, z: fcz + oz, yawRad: 0.0, yardRx: 6.0, yardRz: 6.0, team: 1 });
  // Outer curtain walls (embed cleanly into watchtowers, leaving only exact 5.8 m opening for South Gatehouse!)
  appendWallRun(walls, fcx - ox + 0.8, fcz - oz, fcx + ox - 0.8, fcz - oz, [], true);
  appendWallRun(walls, fcx - ox + 0.8, fcz + oz, fcx + ox - 0.8, fcz + oz, [[ox - 3.7, ox + 2.1]], false);
  appendWallRun(walls, fcx - ox, fcz - oz + 0.8, fcx - ox, fcz + oz - 0.8, [], false);
  appendWallRun(walls, fcx + ox, fcz - oz + 0.8, fcx + ox, fcz + oz - 0.8, [], true);

  // 3. INNER WALL RING: 84 x 70 m (halfX = 42, halfZ = 35) — 4 corner watchtowers + Offset West Gate!
  const ix = 42;
  const iz = 35;
  for (const [tx, tz, ty] of [
    [fcx - ix, fcz - iz, Math.PI],
    [fcx + ix, fcz - iz, Math.PI],
    [fcx - ix, fcz + iz, 0],
    [fcx + ix, fcz + iz, 0],
  ] as const) {
    buildings.push({ kind: 'watchtower_l1', x: tx, z: tz, yawRad: ty, yardRx: 4.4, yardRz: 4.4, team: 1 });
  }
  // Offset inner gate in the LEFT/WEST wall (no straight shot from outer south gate!)
  buildings.push({ kind: 'gate_l1', x: fcx - ix, z: fcz + 8, yawRad: -Math.PI * 0.5, yardRx: 5.5, yardRz: 5.5, team: 1 });
  appendWallRun(walls, fcx - ix + 0.8, fcz - iz, fcx + ix - 0.8, fcz - iz, [], true);
  appendWallRun(walls, fcx - ix + 0.8, fcz + iz, fcx + ix - 0.8, fcz + iz, [], false);
  appendWallRun(walls, fcx - ix, fcz - iz + 0.8, fcx - ix, fcz + iz - 0.8, [[iz + 4.3, iz + 10.1]], false);
  appendWallRun(walls, fcx + ix, fcz - iz + 0.8, fcx + ix, fcz + iz - 0.8, [], true);

  // 4. Working Enemy Garrison Town tucked inside the Fortress walls (grid-aligned, entrances facing courtyard lanes!)
  buildings.push(
    { kind: 'barracks_l1', x: fcx + 22, z: fcz + 20, yawRad: -Math.PI * 0.5, yardRx: 8.5, yardRz: 6.5, team: 1 },
    { kind: 'smithy_l1', x: fcx + 22, z: fcz - 18, yawRad: -Math.PI * 0.5, yardRx: 6.5, yardRz: 5.5, team: 1 },
    { kind: 'bakery_l1', x: fcx - 22, z: fcz - 18, yawRad: Math.PI * 0.5, yardRx: 6.5, yardRz: 5.5, team: 1 },
    { kind: 'storehouse_l1', x: fcx - 24, z: fcz + 20, yawRad: Math.PI * 0.5, yardRx: 7.5, yardRz: 6.0, team: 1 },
    { kind: 'house_l1', x: fcx - 50, z: fcz - 24, yawRad: Math.PI * 0.5, yardRx: 5.5, yardRz: 5.2, team: 1 },
    { kind: 'house_l1', x: fcx - 50, z: fcz - 8, yawRad: Math.PI * 0.5, yardRx: 5.5, yardRz: 5.2, team: 1 },
    { kind: 'house_l1', x: fcx + 50, z: fcz - 16, yawRad: -Math.PI * 0.5, yardRx: 5.5, yardRz: 5.2, team: 1 },
    { kind: 'house_l1', x: fcx + 50, z: fcz + 14, yawRad: -Math.PI * 0.5, yardRx: 5.5, yardRz: 5.2, team: 1 },
    { kind: 'well_l1', x: fcx - 18, z: fcz - 2, yawRad: 0.0, yardRx: 3.2, yardRz: 3.2, team: 1 },
  );

  // 5. Player Siege Camp South of the River (grid-aligned along x = 0 approach road, grouped for logistics!)
  buildings.push(
    { kind: 'barracks_l1', x: -16, z: 172, yawRad: Math.PI * 0.5, yardRx: 9.5, yardRz: 7.0, team: 0 },
    { kind: 'smithy_l1', x: -16, z: 186, yawRad: Math.PI * 0.5, yardRx: 7.0, yardRz: 6.0, team: 0 },
    { kind: 'storehouse_l1', x: 16, z: 178, yawRad: -Math.PI * 0.5, yardRx: 8.0, yardRz: 6.5, team: 0 },
    { kind: 'camp_tent_l1', x: -32, z: 172, yawRad: Math.PI * 0.5, yardRx: 5.5, yardRz: 5.5, team: 0 },
    { kind: 'camp_tent_l1', x: 32, z: 172, yawRad: -Math.PI * 0.5, yardRx: 5.5, yardRz: 5.5, team: 0 },
    { kind: 'watchtower_l1', x: -42, z: 156, yawRad: Math.PI, yardRx: 4.5, yardRz: 4.5, team: 0 },
    { kind: 'watchtower_l1', x: 42, z: 156, yawRad: Math.PI, yardRx: 4.5, yardRz: 4.5, team: 0 },
  );
  // 4 Poly Haven CC0 Siege Field Cannons deployed facing North (-Z) up the fortress approach ramp!
  props.push(
    { kind: 'cannon', x: -14, z: 86, yawRad: Math.PI, scale: 1.08 },
    { kind: 'cannon', x: -5, z: 84, yawRad: Math.PI, scale: 1.08 },
    { kind: 'cannon', x: 5, z: 84, yawRad: Math.PI, scale: 1.08 },
    { kind: 'cannon', x: 14, z: 86, yawRad: Math.PI, scale: 1.08 },
    { kind: 'crate', x: -18, z: 90, yawRad: 0.3, scale: 1.0 },
    { kind: 'crate', x: 18, z: 90, yawRad: -0.4, scale: 1.0 },
    { kind: 'barrel', x: -16.5, z: 91.2, yawRad: 0.2, scale: 1.0 },
    { kind: 'crate', x: -24, z: 162, yawRad: 0.35, scale: 1.05 },
    { kind: 'barrel', x: 24, z: 162, yawRad: -0.35, scale: 1.0 },
  );

  // 6. Opposing Siege & Fortress Armies (180+ MakeHuman soldiers!)
  // Player Cobalt Assault Army across the southern ford & siege battery
  appendRegiment(units, 'swordsman', 0, -24, 62, 6, 4, Math.PI, 1.55, rng, 'walk');
  appendRegiment(units, 'swordsman', 0, 24, 62, 6, 4, Math.PI, 1.55, rng, 'walk');
  appendRegiment(units, 'archer', 0, 0, 74, 8, 3, Math.PI, 1.6, rng, 'attack');
  appendRegiment(units, 'swordsman', 0, 0, 148, 6, 3, Math.PI, 1.6, rng, 'idle');
  // Enemy Crimson Courtyard Guard, Outer Bailey Garrison & Sally Force
  appendRegiment(units, 'swordsman', 1, 0, fcz + 22, 6, 3, 0.0, 1.55, rng, 'idle'); // Courtyard elite guard
  appendRegiment(units, 'swordsman', 1, -24, fcz + 45, 5, 3, 0.0, 1.55, rng, 'idle');
  appendRegiment(units, 'swordsman', 1, 24, fcz + 45, 5, 3, 0.0, 1.55, rng, 'idle');
  appendRegiment(units, 'archer', 1, 0, fcz + 48, 8, 2, 0.0, 1.6, rng, 'attack');
  appendRegiment(units, 'swordsman', 1, 0, fcz + 68, 5, 3, 0.0, 1.55, rng, 'attack'); // Sally out of main gate!
  // Enemy town villagers inside fortress walls
  for (let i = 0; i < 8; i++) {
    units.push({
      archetype: 'citizen',
      team: 1,
      x: fcx + (rng() - 0.5) * 65,
      z: fcz + (rng() - 0.5) * 45,
      yawRad: rng() * Math.PI * 2,
      scale: 0.96 + rng() * 0.08,
      clip: 'walk',
      phase01: rng(),
      speedMul: 0.78,
      tintVar: 0.9 + rng() * 0.18,
    });
  }

  const roads: readonly (readonly (readonly [number, number])[])[] = [
    [[0, 186], [0, 116], [0, 62], [0, fcz + oz], [0, fcz + 44], [-52, fcz + 44], [-52, fcz + 8], [fcx - ix, fcz + 8], [fcx - 16, fcz + 10], [fcx, fcz + 14]],
  ];
  const capturePoints: readonly CapturePointSpec[] = [
    { id: 'cp_ford', label: 'Southern River Ford', x: 0, z: 116 },
    { id: 'cp_gate', label: 'Outer Gatehouse Approach', x: 0, z: fcz + oz + 16 },
    { id: 'cp_courtyard', label: 'Citadel Inner Courtyard', x: fcx, z: fcz + 18 },
  ];
  const calibrationXZ: readonly [number, number] = [-78, 162];
  const nature = scatterNatureAcrossWorld(
    terrain,
    { id: 'fortress', playerKeepXZ: [0, 174], enemyCenterXZ: [fcx, fcz], buildings, farmStrips, roads, calibrationXZ },
    1050,
    155,
    380,
    rng,
  );

  return {
    id: 'fortress',
    title: 'Citadel Fortress',
    subtitle: 'Mission 5 · 7 m citadel plateau, twin destructible walls, 12 towers, Donżon & siege cannons',
    terrainConfig,
    playerKeepXZ: [0, 174],
    enemyCenterXZ: [fcx, fcz],
    calibrationXZ,
    buildings,
    walls,
    farmStrips,
    roads,
    capturePoints,
    ...nature,
    props,
    units,
  };
}

/** Generates the complete deterministic 560 x 560 m map layout for any of the 5 campaign/skirmish maps. */
export function buildMapLayout(id: MapLayoutId): MapLayoutSpec {
  switch (id) {
    case 'crossing':
      return buildCrossingMap();
    case 'openField':
      return buildOpenFieldMap();
    case 'forest':
      return buildForestMap();
    case 'valley':
      return buildValleyMap();
    case 'fortress':
      return buildFortressMap();
  }
}

export function parseMapId(raw: string | null | undefined): MapLayoutId {
  if (!raw) return 'crossing';
  const norm = raw.trim().toLowerCase();
  if (norm === 'openfield' || norm === 'open') return 'openField';
  if (norm === 'forest' || norm === 'bor') return 'forest';
  if (norm === 'valley' || norm === 'dolina') return 'valley';
  if (norm === 'fortress' || norm === 'twierdza') return 'fortress';
  return 'crossing';
}
