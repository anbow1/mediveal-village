// Pure-TS Live Forest Felling, Regrowth & 12 m Clearing Cell Manager (zero three.js).
// Rules (docs/GAMEPLAY.md & BRIEF.md F07):
//   - Woodcutter fells nearest mature tree <= 48 m (8 s chop -> 8 timber) and plants a sapling (600 s regrowth).
//   - Forester accelerates nearby sapling growth (2x within 42 m) and replants bare stumps.
//   - Clearing > 50% of original trees inside a 12 m cell removes forest slow/cover & unlocks building!

import { ECONOMY, WORLD } from '../config.ts';
import type { BuildingEntity, TreeEntity } from './types.ts';

const CELL_M = ECONOMY.forestCellSizeM; // 12 m
const GRID_N = Math.ceil(WORLD.sizeM / CELL_M); // 47 x 47

export class ForestGrid {
  private readonly initialCount: Uint16Array;
  private readonly matureCount: Uint16Array;

  constructor(trees: readonly TreeEntity[]) {
    this.initialCount = new Uint16Array(GRID_N * GRID_N);
    this.matureCount = new Uint16Array(GRID_N * GRID_N);
    this.rebuild(trees);
  }

  private cellIndex(x: number, z: number): number {
    const gx = Math.max(0, Math.min(GRID_N - 1, Math.floor((x + WORLD.halfSizeM) / CELL_M)));
    const gz = Math.max(0, Math.min(GRID_N - 1, Math.floor((z + WORLD.halfSizeM) / CELL_M)));
    return gz * GRID_N + gx;
  }

  rebuild(trees: readonly TreeEntity[]): void {
    this.initialCount.fill(0);
    this.matureCount.fill(0);
    for (const t of trees) {
      const idx = this.cellIndex(t.x, t.z);
      this.initialCount[idx]!++;
      if (t.state === 'mature') this.matureCount[idx]!++;
    }
  }

  refreshMatureCounts(trees: readonly TreeEntity[]): void {
    this.matureCount.fill(0);
    for (const t of trees) {
      if (t.state === 'mature') {
        const idx = this.cellIndex(t.x, t.z);
        this.matureCount[idx]!++;
      }
    }
  }

  /**
   * True if `(x, z)` still has active forest cover (> 0 mature trees and >= 50% of original trees standing).
   * Once > 50% of trees in the 12 m cell are felled, forest slow/cover disappears and building is allowed!
   */
  isForestAt(x: number, z: number): boolean {
    const idx = this.cellIndex(x, z);
    const init = this.initialCount[idx]!;
    if (init === 0) return false;
    const cur = this.matureCount[idx]!;
    return cur > 0 && cur * 2 >= init;
  }

  /** Distance (m) to nearest mature tree from `(x, z)` (Infinity if none within `maxDistM`). */
  nearestMatureTree(
    trees: readonly TreeEntity[],
    x: number,
    z: number,
    maxDistM: number,
    ignoreReserved = false,
  ): TreeEntity | null {
    let best: TreeEntity | null = null;
    let bestSq = maxDistM * maxDistM;
    for (const t of trees) {
      if (t.state !== 'mature') continue;
      if (ignoreReserved && t.reservedByCitizenId !== null) continue;
      const dx = t.x - x;
      const dz = t.z - z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = t;
      }
    }
    return best;
  }

  /** Fells a mature tree into a newly planted sapling (1 sapling planted per felled tree) and updates clearing cell. */
  fellTree(tree: TreeEntity): boolean {
    if (tree.state !== 'mature') return false;
    tree.state = 'sapling';
    tree.regrowTimerS = ECONOMY.saplingRegrowS;
    tree.reservedByCitizenId = null;
    const idx = this.cellIndex(tree.x, tree.z);
    if (this.matureCount[idx]! > 0) this.matureCount[idx]!--;
    return true;
  }

  /** Advances sapling regrowth (2x faster within 42 m of an active Forester's Hut). Returns true if any tree matured. */
  stepRegrowth(trees: readonly TreeEntity[], buildings: readonly BuildingEntity[], dtS: number): boolean {
    const foresters: BuildingEntity[] = [];
    for (const b of buildings) {
      if (b.type === 'forester' && b.buildProgress >= 1 && !b.paused && b.hp > 0) {
        foresters.push(b);
      }
    }

    let changed = false;
    const fRadSq = ECONOMY.foresterRadiusM * ECONOMY.foresterRadiusM;
    for (const t of trees) {
      if (t.state === 'stump') {
        // Forester automatically plants saplings at bare stumps within 42 m
        for (const f of foresters) {
          const dx = t.x - f.x;
          const dz = t.z - f.z;
          if (dx * dx + dz * dz <= fRadSq) {
            t.state = 'sapling';
            t.regrowTimerS = ECONOMY.saplingRegrowS;
            changed = true;
            break;
          }
        }
        continue;
      }
      if (t.state !== 'sapling') continue;

      let speed = 1.0;
      for (const f of foresters) {
        const dx = t.x - f.x;
        const dz = t.z - f.z;
        if (dx * dx + dz * dz <= fRadSq) {
          speed = ECONOMY.foresterRegrowMultiplier;
          break;
        }
      }
      t.regrowTimerS -= dtS * speed;
      if (t.regrowTimerS <= 0) {
        t.state = 'mature';
        t.regrowTimerS = 0;
        const idx = this.cellIndex(t.x, t.z);
        this.matureCount[idx]!++;
        changed = true;
      }
    }
    return changed;
  }
}
