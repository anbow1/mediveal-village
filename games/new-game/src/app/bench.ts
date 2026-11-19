// Fixed benchmark views and runner (docs/graphics-playbook.md §9.2, BRIEF.md §6).
// Pure TS (no three.js): uses shared BenchRecorder & formatBench.

import { BENCH } from '../config.ts';
import type { FreeCameraPose, RtsCameraGoal } from '../sim/cameraMath.ts';
import { STAGE4_TERRAIN_CONFIG, TerrainField } from '../sim/terrain.ts';
import { BenchRecorder, type BenchSample, formatBench, type GpuTimes } from '../render/benchRecorder.ts';

export type BenchSpotCamera =
  | { readonly mode: 'rts'; readonly goal: RtsCameraGoal }
  | { readonly mode: 'free'; readonly pose: FreeCameraPose };

export interface BenchSpot {
  readonly name: string;
  readonly camera: BenchSpotCamera;
}

const benchTerrain = new TerrainField(STAGE4_TERRAIN_CONFIG);

function freeLookAt(
  eyeX: number,
  eyeAboveGroundM: number,
  eyeZ: number,
  lookX: number,
  lookAboveGroundM: number,
  lookZ: number,
): FreeCameraPose {
  const eyeY = benchTerrain.heightAt(eyeX, eyeZ) + eyeAboveGroundM;
  const lookY = benchTerrain.heightAt(lookX, lookZ) + lookAboveGroundM;
  const dx = lookX - eyeX;
  const dy = lookY - eyeY;
  const dz = lookZ - eyeZ;
  const horiz = Math.max(1e-5, Math.hypot(dx, dz));
  return {
    x: eyeX,
    y: eyeY,
    z: eyeZ,
    yawRad: Math.atan2(-dx, -dz),
    pitchRad: Math.atan2(dy, horiz),
  };
}

/**
 * Fixed camera views shared across every Stage 4–8 capture and benchmark.
 * No randomness: before/after screenshots and numbers always compare identical pixels.
 */
export const BENCH_SPOTS: readonly BenchSpot[] = [
  {
    name: 'showcase',
    camera: { mode: 'free', pose: freeLookAt(14.5, 14.5, 36.5, 1.5, 2.2, -4.5) },
  },
  {
    name: 'building',
    camera: { mode: 'free', pose: freeLookAt(8.2, 4.0, -0.5, 1.5, 2.7, -10.5) },
  },
  {
    name: 'unit',
    camera: { mode: 'free', pose: freeLookAt(1.3, 1.42, -1.65, 2.55, 1.05, -4.6) },
  },
  {
    name: 'calibration',
    camera: { mode: 'free', pose: freeLookAt(-35.6, 4.3, 43.8, -38.0, 1.15, 36.0) },
  },
  {
    name: 'town',
    camera: { mode: 'rts', goal: { targetX: -2, targetZ: -1, distanceM: 58, yawRad: 0.35, pitchRad: 0.72 } },
  },
  {
    name: 'rally',
    camera: { mode: 'rts', goal: { targetX: 33, targetZ: -1, distanceM: 38, yawRad: 0.65, pitchRad: 0.65 } },
  },
  {
    name: 'field',
    camera: { mode: 'rts', goal: { targetX: 24, targetZ: 15, distanceM: 56, yawRad: -0.35, pitchRad: 0.58 } },
  },
  {
    name: 'close',
    camera: { mode: 'rts', goal: { targetX: -2, targetZ: -4, distanceM: 22, yawRad: 0.35, pitchRad: 0.46 } },
  },
  {
    name: 'enemy',
    camera: { mode: 'rts', goal: { targetX: 38.0, targetZ: -1.0, distanceM: 22, yawRad: 0.08, pitchRad: 0.50 } },
  },
  {
    name: 'overview',
    camera: { mode: 'rts', goal: { targetX: 0, targetZ: 0, distanceM: 420, yawRad: 0, pitchRad: 1.34 } },
  },
  {
    name: 'ground_045m',
    camera: { mode: 'free', pose: freeLookAt(-4.8, 0.45, 0.2, 2.2, 1.85, -8.5) },
  },
  {
    name: 'eye_170m',
    camera: { mode: 'free', pose: freeLookAt(-7.2, 1.7, -3.2, 14.0, 2.6, -1.2) },
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
