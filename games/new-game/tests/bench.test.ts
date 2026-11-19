import { describe, expect, it } from 'vitest';
import { BENCH_SPOTS, BenchSession, findBenchSpot } from '../src/app/bench.ts';
import { InputBindings } from '../src/app/bindings.ts';
import { NO_GPU_TIMES } from '../src/render/benchRecorder.ts';

describe('BenchSession and InputBindings', () => {
  it('visits every fixed spot, settles, samples, and formats the benchmark table', () => {
    const visited: string[] = [];
    const subset = [findBenchSpot('calibration'), findBenchSpot('town')];
    const session = new BenchSession(subset, 'Test Run', (s) => visited.push(s.name), 2, 3);

    let result = null;
    for (let i = 0; i < 20 && !result; i++) {
      result = session.tick(1 / 60, 2.5, 12, 4200, NO_GPU_TIMES);
    }

    expect(visited).toEqual(['calibration', 'town']);
    expect(result).not.toBeNull();
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0]?.fps).toBe(60);
    expect(result?.rows[0]?.drawCalls).toBe(12);
    expect(result?.text).toContain('Test Run');
    expect(result?.text).toContain('calibration');
    expect(result?.text).toContain('town');
    expect(BENCH_SPOTS.length).toBeGreaterThanOrEqual(8);
  });

  it('rebinds keyboard actions cleanly without affecting other bindings', () => {
    const bindings = new InputBindings();
    expect(bindings.actionForCode('Space')).toBe('pause');
    expect(bindings.actionForCode('F3')).toBe('perfOverlay');
    bindings.rebind('pause', ['KeyP']);
    expect(bindings.actionForCode('Space')).toBeNull();
    expect(bindings.actionForCode('KeyP')).toBe('pause');
  });
});
