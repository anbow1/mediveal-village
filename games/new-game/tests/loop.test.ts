import { describe, expect, it } from 'vitest';
import { SIM } from '../src/config.ts';
import { FixedStepLoop } from '../src/core/loop.ts';
import { Rng } from '../src/sim/rng.ts';

describe('FixedStepLoop and deterministic Rng', () => {
  it('runs fixed 60 Hz ticks and respects active pause while still rendering', () => {
    let steps = 0;
    let renders = 0;
    const loop = new FixedStepLoop({
      onStep: () => {
        steps++;
      },
      onRender: () => {
        renders++;
      },
    });

    // 0.1 s at 60 Hz would be 6 steps, capped at SIM.maxStepsPerFrame (4).
    const ran = loop.frame(0.1);
    expect(ran).toBe(SIM.maxStepsPerFrame);
    expect(steps).toBe(SIM.maxStepsPerFrame);
    expect(renders).toBe(1);

    // Active pause stops simulation ticks while keeping render frames alive.
    loop.paused = true;
    expect(loop.frame(0.05)).toBe(0);
    expect(steps).toBe(SIM.maxStepsPerFrame);
    expect(renders).toBe(2);

    // Deterministic fast-forward via stepSeconds works regardless of active pause.
    const fastTicks = loop.stepSeconds(1.0);
    expect(fastTicks).toBe(60);
    expect(loop.simTimeS).toBeCloseTo((SIM.maxStepsPerFrame + 60) * SIM.fixedStepS, 6);
  });

  it('saves and restores PRNG state identically for deterministic replay/snapshots', () => {
    const a = new Rng(42);
    for (let i = 0; i < 15; i++) a.next();
    const saved = a.save();
    const seq1 = [a.next(), a.next(), a.int(0, 100), a.range(-5, 5)];

    const b = new Rng(999);
    b.restore(saved);
    const seq2 = [b.next(), b.next(), b.int(0, 100), b.range(-5, 5)];
    expect(seq2).toEqual(seq1);
  });
});
