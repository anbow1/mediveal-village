// Fixed benchmark views and runner (docs/graphics-playbook.md §9.2, BRIEF.md §6).
// Pure TS (no three.js): uses shared BenchRecorder & formatBench.

import { BENCH } from '../config.ts';
import type { FreeCameraPose, RtsCameraGoal } from '../sim/cameraMath.ts';
import { BenchRecorder, type BenchSample, formatBench, type GpuTimes } from '../render/benchRecorder.ts';

export type BenchSpotCamera =
  | { readonly mode: 'rts'; readonly goal: RtsCameraGoal }
  | { readonly mode: 'free'; readonly pose: FreeCameraPose };

export interface BenchSpot {
  readonly name: string;
  readonly camera: BenchSpotCamera;
}

/**
 * Fixed camera views shared across every stage (Stage 1 calibration through Stage 8 critic).
 * No randomness: before/after screenshots and numbers always compare identical pixels.
 */
export const BENCH_SPOTS: readonly BenchSpot[] = [
  {
    name: 'showcase',
    camera: { mode: 'free', pose: { x: 8.8, y: 5.2, z: 13.8, yawRad: 0.543, pitchRad: -0.187 } },
  },
  {
    name: 'building',
    camera: { mode: 'free', pose: { x: 6.8, y: 4.2, z: 8.2, yawRad: 0.562, pitchRad: -0.125 } },
  },
  {
    name: 'unit',
    camera: { mode: 'free', pose: { x: 1.1, y: 1.38, z: 6.75, yawRad: -0.363, pitchRad: -0.116 } },
  },
  {
    name: 'calibration',
    camera: { mode: 'free', pose: { x: -23.8, y: 4.3, z: 30.0, yawRad: 0.22, pitchRad: -0.38 } },
  },
  {
    name: 'town',
    camera: { mode: 'rts', goal: { targetX: 0, targetZ: 0, distanceM: 55, yawRad: 0.45, pitchRad: 0.78 } },
  },
  {
    name: 'rally',
    camera: { mode: 'rts', goal: { targetX: 28, targetZ: 18, distanceM: 36, yawRad: 0.9, pitchRad: 0.68 } },
  },
  {
    name: 'field',
    camera: { mode: 'rts', goal: { targetX: 90, targetZ: -60, distanceM: 88, yawRad: -0.4, pitchRad: 0.72 } },
  },
  {
    name: 'close',
    camera: { mode: 'rts', goal: { targetX: 0, targetZ: 0, distanceM: 12, yawRad: 0.55, pitchRad: 0.42 } },
  },
  {
    name: 'enemy',
    camera: { mode: 'rts', goal: { targetX: -140, targetZ: -140, distanceM: 68, yawRad: -2.4, pitchRad: 0.76 } },
  },
  {
    name: 'overview',
    camera: { mode: 'rts', goal: { targetX: 0, targetZ: 0, distanceM: 460, yawRad: 0, pitchRad: 1.38 } },
  },
  {
    name: 'ground_045m',
    camera: { mode: 'free', pose: { x: -5.6, y: 0.45, z: 7.6, yawRad: -0.695, pitchRad: 0.048 } },
  },
  {
    name: 'eye_170m',
    camera: { mode: 'free', pose: { x: -5.8, y: 1.7, z: 9.8, yawRad: -0.602, pitchRad: -0.009 } },
  },
];

export function findBenchSpot(name: string): BenchSpot {
  const spot = BENCH_SPOTS.find((s) => s.name === name);
  if (!spot) {
    throw new Error(`Unknown benchmark spot '${name}'. Available: ${BENCH_SPOTS.map((s) => s.name).join(', ')}`);
  }
  return spot;
}

export interface BenchResult {
  readonly title: string;
  readonly rows: readonly BenchSample[];
  readonly text: string;
}

/**
 * Stateful frame-by-frame benchmark runner: places the camera at each fixed spot, settles
 * streaming/exposure/TRAA for `settleFrames`, records `sampleFrames`, and produces a table.
 */
export class BenchSession {
  private spotIndex = 0;
  private settleLeft = 0;
  private recorder = new BenchRecorder();
  private readonly rows: BenchSample[] = [];
  private finished = false;

  constructor(
    private readonly spots: readonly BenchSpot[],
    private readonly title: string,
    private readonly applySpot: (spot: BenchSpot) => void,
    private readonly settleFrames: number = BENCH.settleFrames,
    private readonly sampleFrames: number = BENCH.sampleFrames,
  ) {
    if (spots.length === 0) throw new Error('BenchSession needs at least one spot');
    this.beginSpot(0);
  }

  get done(): boolean {
    return this.finished;
  }

  get currentSpotName(): string {
    return this.spots[Math.min(this.spotIndex, this.spots.length - 1)]?.name ?? '';
  }

  get progressText(): string {
    return `${Math.min(this.spotIndex + 1, this.spots.length)}/${this.spots.length} (${this.currentSpotName})`;
  }

  private beginSpot(index: number): void {
    this.spotIndex = index;
    this.settleLeft = this.settleFrames;
    this.recorder = new BenchRecorder();
    const spot = this.spots[index];
    if (spot) this.applySpot(spot);
  }

  /** Advance one rendered frame; returns completed BenchResult on the final frame. */
  tick(intervalS: number, cpuMs: number, drawCalls: number, triangles: number, timer: GpuTimes): BenchResult | null {
    if (this.finished) return null;
    if (this.settleLeft > 0) {
      this.settleLeft--;
      return null;
    }
    this.recorder.frame(intervalS, cpuMs, drawCalls, triangles);
    if (this.recorder.frames < this.sampleFrames) return null;

    const spot = this.spots[this.spotIndex];
    if (spot) this.rows.push(this.recorder.finish(spot.name, timer));
    if (this.spotIndex + 1 < this.spots.length) {
      this.beginSpot(this.spotIndex + 1);
      return null;
    }
    this.finished = true;
    return {
      title: this.title,
      rows: this.rows,
      text: formatBench(this.title, this.rows),
    };
  }
}
