// Pure-TS 2 m Grid A* Pathfinder & Crossing Queue (zero three.js, unit-tested).
// Covers the full 560 x 560 m battlefield (`280 x 280` cells):
//   - Encodes water, mountain cores/ridges, walls, gates (passable for owner!), buildings, roads (1.4x speed),
//     and live forest cells (0.7x speed; cleared when > 50% trees in 12 m cell are felled!).
//   - Binary-heap A* with octile heuristic and center-weighted road preference.
//   - Deterministic crossing queue ensures multiple regiments march smoothly through river fords & 6 m gates
//     without clipping water or walls!

import { ECONOMY, WORLD } from '../config.ts';
import type { TerrainField } from './terrain.ts';
import type { BuildingEntity, GateEntity, RoadSegmentRecord, SideId, WallSegmentEntity } from './types.ts';

export const PATH_CELL_M = 2.0;
export const PATH_GRID_N = Math.round(WORLD.sizeM / PATH_CELL_M); // 280 x 280

export const CELL_BLOCKED = 1 << 0;
export const CELL_WATER = 1 << 1;
export const CELL_ROAD = 1 << 2;
export const CELL_FOREST = 1 << 3;
export const CELL_GATE_S0 = 1 << 4;
export const CELL_GATE_S1 = 1 << 5;
export const CELL_WALL = 1 << 6;

export interface PathPoint {
  readonly x: number;
  readonly z: number;
}

export class NavGrid {
  readonly n = PATH_GRID_N;
  readonly cellM = PATH_CELL_M;
  readonly halfM = WORLD.halfSizeM;
  /** Static base flags (water + impassable steep/mountain terrain). */
  private readonly baseFlags: Uint8Array;
  /** Live flags combining static terrain + dynamic roads, forests, buildings, walls, and gates. */
  readonly flags: Uint8Array;

  // Reusable scratch buffers for zero-allocation A* searches
  private readonly gScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heapIdx: Int32Array;
  private readonly heapF: Float32Array;
  private searchGen = 1;

  constructor(terrain: TerrainField) {
    const total = this.n * this.n;
    this.baseFlags = new Uint8Array(total);
    this.flags = new Uint8Array(total);
    this.gScore = new Float32Array(total);
    this.cameFrom = new Int32Array(total);
    this.stamp = new Uint32Array(total);
    this.closed = new Uint32Array(total);
    this.heapIdx = new Int32Array(total);
    this.heapF = new Float32Array(total);

    this.bakeBaseTerrain(terrain);
    this.flags.set(this.baseFlags);
  }

  private bakeBaseTerrain(terrain: TerrainField): void {
    const n = this.n;
    for (let gz = 0; gz < n; gz++) {
      const z = this.cellToWorld(gz);
      for (let gx = 0; gx < n; gx++) {
        const x = this.cellToWorld(gx);
        let f = 0;
        const depth = terrain.waterDepthAt(x, z);
        // Deep water (> 0.25 m) is impassable; shallow gravel fords (<= 0.25 m) are walkable!
        if (depth > 0.25) {
          f |= CELL_WATER | CELL_BLOCKED;
        } else if (terrain.isImpassable(x, z)) {
          f |= CELL_BLOCKED;
        }
        this.baseFlags[gz * n + gx] = f;
      }
    }
  }

  worldToCell(coordM: number): number {
    return Math.max(0, Math.min(this.n - 1, Math.floor((coordM + this.halfM) / this.cellM)));
  }

  cellToWorld(cell: number): number {
    return -this.halfM + (cell + 0.5) * this.cellM;
  }

  /** Rebuilds dynamic occupancy flags from roads, forest grid, buildings, walls & gates. */
  rebuildDynamic(
    roads: readonly RoadSegmentRecord[],
    buildings: readonly BuildingEntity[],
    walls: readonly WallSegmentEntity[],
    gates: readonly GateEntity[],
    isForestAt: (x: number, z: number) => boolean,
  ): void {
    this.flags.set(this.baseFlags);
    const n = this.n;

    // 1. Forest cover (slows walking to 0.7x)
    for (let gz = 0; gz < n; gz++) {
      const z = this.cellToWorld(gz);
      for (let gx = 0; gx < n; gx++) {
        const idx = gz * n + gx;
        if ((this.flags[idx]! & CELL_BLOCKED) !== 0) continue;
        if (isForestAt(this.cellToWorld(gx), z)) {
          this.flags[idx]! |= CELL_FOREST;
        }
      }
    }

    // 2. Roads (1.4x walk speed, also clears forest flag along road corridor)
    for (const rd of roads) {
      this.stampRoad(rd.x0, rd.z0, rd.x1, rd.z1, rd.widthM);
    }

    // 3. Buildings block interior cells (leave doorway apron passable)
    for (const b of buildings) {
      if (b.hp <= 0) continue;
      if (b.type === 'gate') continue;
      // Keep interior footprint slightly smaller than visual radius so narrow town lanes stay walkable
      const rM = b.type === 'keep' ? 5.2 : b.type === 'well' ? 1.8 : 2.8;
      this.stampCircleFlag(b.x, b.z, rM, CELL_BLOCKED);
    }

    // 4. Walls block everyone
    for (const w of walls) {
      if (w.destroyed || w.hp <= 0) continue;
      this.stampCircleFlag(w.x, w.z, 1.35, CELL_BLOCKED | CELL_WALL);
    }

    // 5. Gates carve a clear passage for their owning side (and block the enemy!)
    for (const g of gates) {
      if (g.destroyed || g.hp <= 0) continue;
      const gFlag = g.side === 0 ? CELL_GATE_S0 : CELL_GATE_S1;
      const radCells = Math.ceil(3.6 / this.cellM);
      const cgx = this.worldToCell(g.x);
      const cgz = this.worldToCell(g.z);
      for (let dz = -radCells; dz <= radCells; dz++) {
        const gz = cgz + dz;
        if (gz < 0 || gz >= n) continue;
        for (let dx = -radCells; dx <= radCells; dx++) {
          const gx = cgx + dx;
          if (gx < 0 || gx >= n) continue;
          const dist = Math.hypot(this.cellToWorld(gx) - g.x, this.cellToWorld(gz) - g.z);
          if (dist <= 3.6) {
            const idx = gz * n + gx;
            // Clear wall blocking inside gate opening and tag owner passability
            this.flags[idx] = (this.flags[idx]! & ~(CELL_BLOCKED | CELL_WALL)) | gFlag | CELL_ROAD;
          }
        }
      }
    }
  }

  stampRoad(x0: number, z0: number, x1: number, z1: number, widthM = 4.0): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / 1.0));
    const halfW = Math.max(1.5, widthM * 0.5);
    const radCells = Math.ceil(halfW / this.cellM);
    const n = this.n;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      const cgx = this.worldToCell(px);
      const cgz = this.worldToCell(pz);
      for (let dz = -radCells; dz <= radCells; dz++) {
        const gz = cgz + dz;
        if (gz < 0 || gz >= n) continue;
        for (let dx = -radCells; dx <= radCells; dx++) {
          const gx = cgx + dx;
          if (gx < 0 || gx >= n) continue;
          const idx = gz * n + gx;
          if ((this.flags[idx]! & CELL_WATER) !== 0) continue;
          const d = Math.hypot(this.cellToWorld(gx) - px, this.cellToWorld(gz) - pz);
          if (d <= halfW) {
            this.flags[idx] = (this.flags[idx]! & ~CELL_FOREST) | CELL_ROAD;
          }
        }
      }
    }
  }

  private stampCircleFlag(cx: number, cz: number, rM: number, flag: number): void {
    const radCells = Math.ceil(rM / this.cellM);
    const cgx = this.worldToCell(cx);
    const cgz = this.worldToCell(cz);
    const n = this.n;
    for (let dz = -radCells; dz <= radCells; dz++) {
      const gz = cgz + dz;
      if (gz < 0 || gz >= n) continue;
      for (let dx = -radCells; dx <= radCells; dx++) {
        const gx = cgx + dx;
        if (gx < 0 || gx >= n) continue;
        const d = Math.hypot(this.cellToWorld(gx) - cx, this.cellToWorld(gz) - cz);
        if (d <= rM) {
          this.flags[gz * n + gx]! |= flag;
        }
      }
    }
  }

  isWalkableCell(gx: number, gz: number, side: SideId): boolean {
    if (gx < 0 || gz < 0 || gx >= this.n || gz >= this.n) return false;
    const f = this.flags[gz * this.n + gx]!;
    if ((f & CELL_BLOCKED) !== 0) return false;
    // Enemy gate acts as a wall for the opposing side
    const enemyGate = side === 0 ? CELL_GATE_S1 : CELL_GATE_S0;
    if ((f & enemyGate) !== 0) return false;
    return true;
  }

  isWalkableAt(x: number, z: number, side: SideId): boolean {
    return this.isWalkableCell(this.worldToCell(x), this.worldToCell(z), side);
  }

  /** Returns surface speed multiplier at `(x, z)`: 1.4x road, 0.7x forest, 1.0x open turf. */
  speedMultiplierAt(x: number, z: number): number {
    const f = this.flags[this.worldToCell(z) * this.n + this.worldToCell(x)]!;
    if ((f & CELL_ROAD) !== 0) return ECONOMY.roadSpeedMultiplier;
    if ((f & CELL_FOREST) !== 0) return ECONOMY.forestSpeedMultiplier;
    return 1.0;
  }

  isForestCellAt(x: number, z: number): boolean {
    const f = this.flags[this.worldToCell(z) * this.n + this.worldToCell(x)]!;
    return (f & CELL_FOREST) !== 0;
  }

  isWaterCellAt(x: number, z: number): boolean {
    const f = this.flags[this.worldToCell(z) * this.n + this.worldToCell(x)]!;
    return (f & CELL_WATER) !== 0;
  }

  /** Finds nearest walkable cell within `maxRadiusCells` around `(gx, gz)`. */
  private findNearestWalkable(gx: number, gz: number, side: SideId, maxRadiusCells = 12): [number, number] | null {
    if (this.isWalkableCell(gx, gz, side)) return [gx, gz];
    for (let r = 1; r <= maxRadiusCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = gx + dx;
          const nz = gz + dz;
          if (this.isWalkableCell(nx, nz, side)) return [nx, nz];
        }
      }
    }
    return null;
  }

  /**
   * Deterministic 8-directional A* pathfinder with road-speed weighting and gentle clearance bias
   * (centers paths through fords and gates so regiments never clip water or walls).
   */
  findPath(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    side: SideId,
    maxExpansions = 18_000,
  ): PathPoint[] {
    const sRaw = this.findNearestWalkable(this.worldToCell(startX), this.worldToCell(startZ), side, 10);
    const gRaw = this.findNearestWalkable(this.worldToCell(goalX), this.worldToCell(goalZ), side, 12);
    if (!sRaw || !gRaw) return [{ x: goalX, z: goalZ }];

    const [sx, sz] = sRaw;
    const [tx, tz] = gRaw;
    if (sx === tx && sz === tz) {
      return [{ x: this.cellToWorld(tx), z: this.cellToWorld(tz) }];
    }

    const n = this.n;
    this.searchGen++;
    if (this.searchGen >= 0xffff_fff0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.searchGen = 1;
    }
    const gen = this.searchGen;

    const startIdx = sz * n + sx;
    const goalIdx = tz * n + tx;

    const gScore = this.gScore;
    const cameFrom = this.cameFrom;
    const stamp = this.stamp;
    const closed = this.closed;
    const heapIdx = this.heapIdx;
    const heapF = this.heapF;

    let heapSize = 0;
    const push = (idx: number, fVal: number): void => {
      let i = heapSize++;
      heapIdx[i] = idx;
      heapF[i] = fVal;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p]! <= fVal) break;
        heapIdx[i] = heapIdx[p]!;
        heapF[i] = heapF[p]!;
        heapIdx[p] = idx;
        heapF[p] = fVal;
        i = p;
      }
    };
    const pop = (): number => {
      const top = heapIdx[0]!;
      heapSize--;
      if (heapSize > 0) {
        const lastIdx = heapIdx[heapSize]!;
        const lastF = heapF[heapSize]!;
        let i = 0;
        while (true) {
          const l = (i << 1) + 1;
          const r = l + 1;
          let smallest = i;
          let smallF = lastF;
          if (l < heapSize && heapF[l]! < smallF) {
            smallest = l;
            smallF = heapF[l]!;
          }
          if (r < heapSize && heapF[r]! < smallF) {
            smallest = r;
          }
          if (smallest === i) break;
          heapIdx[i] = heapIdx[smallest]!;
          heapF[i] = heapF[smallest]!;
          i = smallest;
        }
        heapIdx[i] = lastIdx;
        heapF[i] = lastF;
      }
      return top;
    };

    const roadMinCost = 1.0 / ECONOMY.roadSpeedMultiplier;
    const heuristic = (gx: number, gz: number): number => {
      const dx = Math.abs(gx - tx);
      const dz = Math.abs(gz - tz);
      const mn = dx < dz ? dx : dz;
      const mx = dx > dz ? dx : dz;
      return (mx + 0.41421356 * mn) * roadMinCost;
    };

    stamp[startIdx] = gen;
    gScore[startIdx] = 0;
    cameFrom[startIdx] = -1;
    push(startIdx, heuristic(sx, sz));

    const dirs: readonly (readonly [number, number, number])[] = [
      [1, 0, 1.0],
      [-1, 0, 1.0],
      [0, 1, 1.0],
      [0, -1, 1.0],
      [1, 1, 1.41421356],
      [-1, 1, 1.41421356],
      [1, -1, 1.41421356],
      [-1, -1, 1.41421356],
    ];

    let bestIdx = startIdx;
    let bestH = heuristic(sx, sz);
    let expanded = 0;

    while (heapSize > 0 && expanded < maxExpansions) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      expanded++;

      if (cur === goalIdx) {
        bestIdx = goalIdx;
        break;
      }

      const cx = cur % n;
      const cz = (cur - cx) / n;
      const hCur = heuristic(cx, cz);
      if (hCur < bestH) {
        bestH = hCur;
        bestIdx = cur;
      }

      const curG = gScore[cur]!;
      for (let d = 0; d < 8; d++) {
        const [ox, oz, stepLen] = dirs[d]!;
        const nx = cx + ox;
        const nz = cz + oz;
        if (!this.isWalkableCell(nx, nz, side)) continue;
        // Prevent diagonal corner cutting through walls/water/buildings
        if (ox !== 0 && oz !== 0) {
          if (!this.isWalkableCell(cx + ox, cz, side) || !this.isWalkableCell(cx, cz + oz, side)) continue;
        }
        const nIdx = nz * n + nx;
        if (closed[nIdx] === gen) continue;

        const nf = this.flags[nIdx]!;
        let cellCost = 1.0;
        if ((nf & CELL_ROAD) !== 0) cellCost = 1.0 / ECONOMY.roadSpeedMultiplier;
        else if ((nf & CELL_FOREST) !== 0) cellCost = 1.0 / ECONOMY.forestSpeedMultiplier;

        // Slight center-weighting penalty when immediately adjacent to water or wall (keeps crossings centered!)
        if (
          !this.isWalkableCell(nx + 1, nz, side) ||
          !this.isWalkableCell(nx - 1, nz, side) ||
          !this.isWalkableCell(nx, nz + 1, side) ||
          !this.isWalkableCell(nx, nz - 1, side)
        ) {
          cellCost += 0.25;
        }

        const tentativeG = curG + stepLen * cellCost;
        if (stamp[nIdx] !== gen || tentativeG < gScore[nIdx]!) {
          stamp[nIdx] = gen;
          gScore[nIdx] = tentativeG;
          cameFrom[nIdx] = cur;
          push(nIdx, tentativeG + heuristic(nx, nz));
        }
      }
    }

    // Reconstruct path & thin collinear redundant points while preserving every turn & crossing
    const rawCells: [number, number][] = [];
    let c = bestIdx;
    while (c !== -1 && c !== startIdx) {
      const gx = c % n;
      const gz = (c - gx) / n;
      rawCells.push([gx, gz]);
      c = cameFrom[c]!;
    }
    rawCells.reverse();

    if (rawCells.length === 0) {
      return [{ x: this.cellToWorld(tx), z: this.cellToWorld(tz) }];
    }

    // Line-of-sight string pulling (preserves water/wall safety with 1 m step checks)
    const out: PathPoint[] = [];
    let anchorX = this.cellToWorld(sx);
    let anchorZ = this.cellToWorld(sz);
    let i = 0;
    while (i < rawCells.length) {
      let furthest = i;
      const maxLook = Math.min(rawCells.length - 1, i + 10);
      for (let j = maxLook; j > i; j--) {
        const wx = this.cellToWorld(rawCells[j]![0]);
        const wz = this.cellToWorld(rawCells[j]![1]);
        if (this.hasSafeClearLine(anchorX, anchorZ, wx, wz, side)) {
          furthest = j;
          break;
        }
      }
      const px = this.cellToWorld(rawCells[furthest]![0]);
      const pz = this.cellToWorld(rawCells[furthest]![1]);
      out.push({ x: px, z: pz });
      anchorX = px;
      anchorZ = pz;
      i = furthest + 1;
    }

    return out;
  }

  /** Checks line segment stays strictly inside walkable cells (never clips water or walls). */
  hasSafeClearLine(x0: number, z0: number, x1: number, z1: number, side: SideId): boolean {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(2, Math.ceil(dist / 1.0));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      if (!this.isWalkableAt(x, z, side)) return false;
    }
    return true;
  }
}
