import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createByteProgressTracker, type AssetManifest } from '../src/render/assetLoader.ts';

describe('Stage 2 asset manifest and byte progress tracker', () => {
  it('matches every binary asset file on disk with exact byte totals', () => {
    const publicDir = join(process.cwd(), 'public');
    const manifest = JSON.parse(readFileSync(join(publicDir, 'assets/manifest.json'), 'utf8')) as AssetManifest;
    expect(manifest.files.length).toBeGreaterThanOrEqual(50);

    let sum = 0;
    for (const entry of manifest.files) {
      const diskBytes = statSync(join(publicDir, entry.path)).size;
      expect(entry.bytes).toBe(diskBytes);
      sum += diskBytes;
    }
    expect(manifest.totalBytes).toBe(sum);
    // Keep total raw assets well below the 80 MB build ceiling.
    expect(manifest.totalBytes).toBeLessThan(80 * 1024 * 1024);
  });

  it('reports monotonic byte progress clamped to totalBytes', () => {
    const events: [number, number][] = [];
    const tracker = createByteProgressTracker(1000, (loaded, total) => events.push([loaded, total]));
    expect(events[0]).toEqual([0, 1000]);
    tracker.report(350);
    tracker.report(400);
    tracker.report(500);
    expect(tracker.loadedBytes).toBe(1000);
    expect(events[events.length - 1]).toEqual([1000, 1000]);
  });
});
