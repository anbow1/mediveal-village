// Fixed benchmark views and runner (docs/graphics-playbook.md §9.2, BRIEF.md §6).
// Pure TS (no three.js): builds deterministic per-map camera spots for all 5 560 x 560 m campaign maps
// so before/after screenshots, height sweeps, EV100 calibration, and 560 m pan checks are 100% repeatable.

import { BENCH } from '../config.ts';
import type { FreeCameraPose, RtsCameraGoal } from '../sim/cameraMath.ts';
import { buildMapLayout, type MapLayoutSpec } from '../sim/maps.ts';
import { TerrainField } from '../sim/terrain.ts';
import { BenchRecorder, type BenchSample, formatBench, type GpuTimes } from '../render/benchRecorder.ts';

export type BenchSpotCamera =
  | { readonly mode: 'rts'; readonly goal: RtsCameraGoal }
  | { readonly mode: 'free'; readonly pose: FreeCameraPose };

export interface BenchSpot {
  readonly name: string;
  readonly camera: BenchSpotCamera;
}

function makeLookAt(terrain: TerrainField) {
  return (
    eyeX: number,
    eyeAboveGroundM: number,
    eyeZ: number,
    lookX: number,
    lookAboveGroundM: number,
    lookZ: number,
  ): FreeCameraPose => {
    const eyeY = terrain.heightAt(eyeX, eyeZ) + eyeAboveGroundM;
    const lookY = terrain.heightAt(lookX, lookZ) + lookAboveGroundM;
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
  };
}

/**
 * Generates 12 deterministic benchmark & visual verification spots for any of the 5 campaign maps.
 */
export function createBenchSpotsForWorld(
  layout: MapLayoutSpec,
  terrain: TerrainField,
): readonly BenchSpot[] {
  const lookAt = makeLookAt(terrain);
  const [kx, kz] = layout.playerKeepXZ;
  const [ex, ez] = layout.enemyCenterXZ;
  const [calX, calZ] = layout.calibrationXZ;

  // Pick a front-rank Marchland Cobalt swordsman for the crisp unit close-up!
  const heroUnit =
    layout.units.find((u) => u.archetype === 'swordsman' && u.team === 0) ??
    layout.units[0] ??
    { x: kx + 15, z: kz + 5, yawRad: 0 };
  const fx = Math.sin(heroUnit.yawRad);
  const fz = Math.cos(heroUnit.yawRad);
  const rx = Math.cos(heroUnit.yawRad);
  const rz = -Math.sin(heroUnit.yawRad);
  // Stand 3.4 m in front and slightly right of the swordsman looking straight at his helm, face, estoc & kite shield!
  const unitEyeX = heroUnit.x + fx * 3.1 + rx * 1.15;
  const unitEyeZ = heroUnit.z + fz * 3.1 + rz * 1.15;

  if (layout.id === 'fortress') {
    return [
      // Dramatic siege vista looking up the south approach ramp at siege cannons, outer gate, twin walls & Donżon!
      { name: 'showcase', camera: { mode: 'free', pose: lookAt(36, 26, 118, 0, 10, -28) } },
      // Monumental central Fortress Donżon close-up inside inner courtyard
      { name: 'building', camera: { mode: 'free', pose: lookAt(18, 9.5, -16, 0, 7.5, -48) } },
      { name: 'unit', camera: { mode: 'free', pose: lookAt(unitEyeX, 1.48, unitEyeZ, heroUnit.x, 1.05, heroUnit.z) } },
      { name: 'calibration', camera: { mode: 'free', pose: lookAt(calX + 2.4, 4.3, calZ + 7.8, calX, 1.15, calZ) } },
      { name: 'town', camera: { mode: 'rts', goal: { targetX: 0, targetZ: 170, distanceM: 68, yawRad: 0.25, pitchRad: 0.68 } } },
      { name: 'rally', camera: { mode: 'rts', goal: { targetX: 0, targetZ: 74, distanceM: 46, yawRad: 0.42, pitchRad: 0.56 } } },
      { name: 'field', camera: { mode: 'rts', goal: { targetX: 0, targetZ: 12, distanceM: 96, yawRad: 0.28, pitchRad: 0.58 } } },
      { name: 'close', camera: { mode: 'free', pose: lookAt(-12, 3.2, 96, -3, 1.8, 82) } },
      { name: 'enemy', camera: { mode: 'rts', goal: { targetX: 0, targetZ: -44, distanceM: 88, yawRad: 0.35, pitchRad: 0.64 } } },
      { name: 'overview', camera: { mode: 'rts', goal: { targetX: 0, targetZ: 24, distanceM: 430, yawRad: 0.0, pitchRad: 1.32 } } },
      { name: 'ground_045m', camera: { mode: 'free', pose: lookAt(-10, 0.45, 95, 0, 4.5, 42) } },
      { name: 'eye_170m', camera: { mode: 'free', pose: lookAt(12, 1.7, 94, 0, 9.5, -24) } },
    ];
  }

  if (layout.id === 'valley') {
    return [
      // Sweeping view down the twin-mountain valley toward central village w/ 6 ruins & distant pass!
      { name: 'showcase', camera: { mode: 'free', pose: lookAt(56, 22, 46, 118, 4.0, -4) } },
      { name: 'building', camera: { mode: 'free', pose: lookAt(kx + 24, 5.5, kz + 18, kx + 4, 3.2, kz) } },
      { name: 'unit', camera: { mode: 'free', pose: lookAt(unitEyeX, 1.48, unitEyeZ, heroUnit.x, 1.05, heroUnit.z) } },
      { name: 'calibration', camera: { mode: 'free', pose: lookAt(calX + 2.4, 4.3, calZ + 7.8, calX, 1.15, calZ) } },
      { name: 'town', camera: { mode: 'rts', goal: { targetX: kx + 18, targetZ: kz, distanceM: 66, yawRad: 0.35, pitchRad: 0.70 } } },
      { name: 'rally', camera: { mode: 'rts', goal: { targetX: -52, targetZ: 2, distanceM: 44, yawRad: 0.55, pitchRad: 0.62 } } },
      { name: 'field', camera: { mode: 'rts', goal: { targetX: 118, targetZ: 0, distanceM: 76, yawRad: -0.25, pitchRad: 0.62 } } },
      { name: 'close', camera: { mode: 'rts', goal: { targetX: 112, targetZ: 6, distanceM: 32, yawRad: 0.32, pitchRad: 0.48 } } },
      { name: 'enemy', camera: { mode: 'rts', goal: { targetX: 196, targetZ: 0, distanceM: 64, yawRad: -0.30, pitchRad: 0.62 } } },
      { name: 'overview', camera: { mode: 'rts', goal: { targetX: 10, targetZ: 0, distanceM: 440, yawRad: 0.0, pitchRad: 1.32 } } },
      { name: 'ground_045m', camera: { mode: 'free', pose: lookAt(-120, 0.45, 14, -104, 2.2, -4) } },
      { name: 'eye_170m', camera: { mode: 'free', pose: lookAt(88, 1.7, 16, 122, 2.5, -2) } },
    ];
  }

  // Default `crossing`, `openField`, `forest` spots anchored dynamically to Keep, Market, Crossing & Enemy Camp
  const townCx = kx + 20;
  const townCz = kz + 4;
  const fieldCx = layout.id === 'crossing' ? 24 : 0;
  const fieldCz = layout.id === 'crossing' ? 6 : 0;

  return [
    // Sweeping vista framing west medieval town, cobbled road, river crossing & opposing armies!
    { name: 'showcase', camera: { mode: 'free', pose: lookAt(townCx + 34, 17.5, townCz + 44, townCx - 2, 2.5, townCz - 4) } },
    // Architectural hero shot of Lord's Keep, Chapel & Market square
    { name: 'building', camera: { mode: 'free', pose: lookAt(kx + 20, 5.2, kz + 18, kx + 2, 3.6, kz - 2) } },
    // Intimate close-up of our MakeHuman CC0 Marchland Swordsman (helm, face, estoc, kite shield, chainmail!)
    { name: 'unit', camera: { mode: 'free', pose: lookAt(unitEyeX, 1.48, unitEyeZ, heroUnit.x, 1.05, heroUnit.z) } },
    // Unbroken 18% grey CalibrationRig view for all 4 lighting presets
    { name: 'calibration', camera: { mode: 'free', pose: lookAt(calX + 2.4, 4.3, calZ + 7.8, calX, 1.15, calZ) } },
    { name: 'town', camera: { mode: 'rts', goal: { targetX: townCx, targetZ: townCz, distanceM: 64, yawRad: 0.35, pitchRad: 0.70 } } },
    { name: 'rally', camera: { mode: 'rts', goal: { targetX: fieldCx - 16, targetZ: fieldCz + 4, distanceM: 42, yawRad: 0.52, pitchRad: 0.60 } } },
    { name: 'field', camera: { mode: 'rts', goal: { targetX: fieldCx + 8, targetZ: fieldCz + 6, distanceM: 68, yawRad: -0.25, pitchRad: 0.56 } } },
    { name: 'close', camera: { mode: 'rts', goal: { targetX: townCx + 6, targetZ: townCz + 4, distanceM: 26, yawRad: 0.35, pitchRad: 0.46 } } },
    { name: 'enemy', camera: { mode: 'rts', goal: { targetX: ex - 18, targetZ: ez + 4, distanceM: 56, yawRad: -0.35, pitchRad: 0.58 } } },
    { name: 'overview', camera: { mode: 'rts', goal: { targetX: 0, targetZ: 0, distanceM: 440, yawRad: 0.0, pitchRad: 1.32 } } },
    { name: 'ground_045m', camera: { mode: 'free', pose: lookAt(townCx + 17, 0.45, townCz + 4, townCx - 6, 2.0, townCz - 2) } },
    { name: 'eye_170m', camera: { mode: 'free', pose: lookAt(townCx + 19, 1.7, townCz + 3, townCx - 8, 3.0, townCz - 4) } },
  ];
}

const defaultLayout = buildMapLayout('crossing');
const defaultTerrain = new TerrainField(defaultLayout.terrainConfig);

/** Default Crossing spots exported for backwards compatibility with unit tests. */
export const BENCH_SPOTS: readonly BenchSpot[] = createBenchSpotsForWorld(defaultLayout, defaultTerrain);

export function findBenchSpot(name: string, spots: readonly BenchSpot[] = BENCH_SPOTS): BenchSpot {
  const spot = spots.find((s) => s.name === name);
  if (!spot) {
    throw new Error(`Unknown benchmark spot '${name}'. Available: ${spots.map((s) => s.name).join(', ')}`);
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
