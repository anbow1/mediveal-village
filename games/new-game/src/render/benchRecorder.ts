// Benchmark rows and their table, shared file for file by Field Line, Castaway
// Lagoon and Tanks (docs/graphics-playbook.md §9). No three.js import: the
// numbers come in from whichever renderer the game runs.

export type PassGroup = 'scene' | 'shadows' | 'water' | 'scope' | 'post' | 'other';
export const PASS_GROUPS: readonly PassGroup[] = ['scene', 'shadows', 'water', 'scope', 'post', 'other'];

/** GPU milliseconds per pass group, from timestamp queries where the backend has them. */
export interface GpuTimes {
  readonly hasGpuTimes: boolean;
  readonly gpuTotalMs: number;
  readonly gpuMs: Readonly<Record<PassGroup, number>>;
  /** False where only the total is trustworthy (see PassTimer.perPass). */
  readonly perPass: boolean;
}

/** No timestamp queries (a WebGL renderer without the timer extension). */
export const NO_GPU_TIMES: GpuTimes = { hasGpuTimes: false, gpuTotalMs: 0, gpuMs: { scene: 0, shadows: 0, water: 0, scope: 0, post: 0, other: 0 }, perPass: false };

/** One benchmark spot's numbers. GPU times are null where the backend has no timestamp queries. */
export interface BenchSample {
  spot: string;
  fps: number;
  /** 95th-percentile frame interval: judder shows here before it shows in the mean. */
  p95Ms: number;
  /** CPU time of the render call (scene traversal, uniform updates, command encoding). */
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  gpuMs: number | null;
  gpu: Partial<Record<PassGroup, number>>;
}

/**
 * Frame numbers at one fixed view. The benchmark puts the camera at each named spot, lets
 * streaming and exposure settle, then records a fixed number of frames with the governor off,
 * so runs before and after a change compare like for like (docs/graphics-playbook.md §9).
 */
export class BenchRecorder {
  private readonly intervals: number[] = [];
  private cpu = 0;
  private calls = 0;
  private tris = 0;

  frame(intervalS: number, cpuMs: number, drawCalls: number, triangles: number): void {
    if (intervalS > 0) this.intervals.push(intervalS);
    this.cpu += cpuMs;
    this.calls = drawCalls;
    this.tris = triangles;
  }

  get frames(): number {
    return this.intervals.length;
  }

  finish(spot: string, timer: GpuTimes): BenchSample {
    const n = Math.max(1, this.intervals.length);
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const mean = this.intervals.reduce((a, b) => a + b, 0) / n;
    const gpu: Partial<Record<PassGroup, number>> = {};
    if (timer.hasGpuTimes && timer.perPass) for (const g of PASS_GROUPS) if (timer.gpuMs[g] >= 0.01) gpu[g] = round2(timer.gpuMs[g]);
    return {
      spot,
      fps: Math.round(1 / Math.max(1e-6, mean)),
      p95Ms: round2((sorted[Math.floor(n * 0.95)] ?? mean) * 1000),
      cpuMs: round2(this.cpu / n),
      drawCalls: this.calls,
      triangles: this.tris,
      gpuMs: timer.hasGpuTimes ? round2(timer.gpuTotalMs) : null,
      gpu,
    };
  }
}

/** A plain-text table of benchmark rows, to read on a phone and paste into a report. */
export function formatBench(title: string, rows: readonly BenchSample[]): string {
  const lines = [title, 'spot            fps  p95ms  cpu  calls  Mtris  gpu ms (per pass)'];
  for (const r of rows) {
    const split = Object.entries(r.gpu).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
    const gpu = r.gpuMs === null ? 'n/a' : split ? `${r.gpuMs.toFixed(1)} (${split})` : r.gpuMs.toFixed(1);
    lines.push(
      `${r.spot.padEnd(14)} ${String(r.fps).padStart(4)} ${r.p95Ms.toFixed(1).padStart(6)} ${r.cpuMs.toFixed(1).padStart(4)} ${String(r.drawCalls).padStart(6)} ${(r.triangles / 1e6).toFixed(2).padStart(6)}  ${gpu}`,
    );
  }
  return lines.join('\n');
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
