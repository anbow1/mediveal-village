// Fixed-timestep simulation loop (60 Hz) with active pause & step cap (no three.js).

import { SIM } from '../config.ts';

export interface LoopCallbacks {
  onStep: (fixedDtS: number, simTimeS: number) => void;
  onRender: (realDtS: number, alpha: number) => void;
}

export class FixedStepLoop {
  /** Active pause stops simulation ticks while camera, orders, and rendering continue. */
  paused = false;
  speedMultiplier = 1;
  simTimeS = 0;
  tickCount = 0;
  private accumulatorS = 0;

  constructor(private readonly callbacks: LoopCallbacks, readonly fixedStepS = SIM.fixedStepS) {}

  /** Advance one visual frame given real elapsed wall-clock seconds `rawDtS`. */
  frame(rawDtS: number): number {
    const dtS = Math.min(SIM.maxFrameDtS, Math.max(0, rawDtS));
    let steps = 0;
    if (!this.paused) {
      this.accumulatorS += dtS * this.speedMultiplier;
      while (this.accumulatorS >= this.fixedStepS && steps < SIM.maxStepsPerFrame) {
        this.simTimeS += this.fixedStepS;
        this.tickCount++;
        this.callbacks.onStep(this.fixedStepS, this.simTimeS);
        this.accumulatorS -= this.fixedStepS;
        steps++;
      }
      // Drop excess lag rather than spiraling when capped.
      if (steps >= SIM.maxStepsPerFrame && this.accumulatorS > this.fixedStepS) {
        this.accumulatorS = 0;
      }
    }
    const alpha = this.accumulatorS / this.fixedStepS;
    this.callbacks.onRender(dtS, alpha);
    return steps;
  }

  /** Deterministically fast-forward simulation by `seconds` (used by `__debug.step` and tests). */
  stepSeconds(seconds: number): number {
    const ticks = Math.max(0, Math.round(seconds / this.fixedStepS));
    for (let i = 0; i < ticks; i++) {
      this.simTimeS += this.fixedStepS;
      this.tickCount++;
      this.callbacks.onStep(this.fixedStepS, this.simTimeS);
    }
    return ticks;
  }
}
