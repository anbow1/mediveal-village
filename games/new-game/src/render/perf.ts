import { type Camera, InspectorBase, type Object3D, type RenderTarget, type Renderer } from 'three/webgpu';
import { type GpuTimes, PASS_GROUPS, type PassGroup } from './benchRecorder.ts';

// Frame measurement and the frame-rate governor, shared file for file by Field
// Line, Castaway Lagoon and Tanks (docs/graphics-playbook.md §9).
//
// PassTimer: three's renderer reports every render call to its inspector with
// the scene, camera and target, and (with trackTimestamp) writes a GPU
// timestamp pair for it under the same uid. The inspector sorts each uid into
// a pass group; resolving the queries every few frames gives GPU milliseconds
// per group. Without timestamp support (most WebGL2 phones, SwiftShader) the
// groups stay empty and only the CPU numbers are shown.
//
// FrameGovernor: holds the frame rate by trading image quality, never gameplay.

export { type BenchSample, BenchRecorder, formatBench, type GpuTimes, PASS_GROUPS, type PassGroup } from './benchRecorder.ts';

interface TimestampPool {
  timestamps: Map<string, number>;
}
interface TimestampBackend {
  trackTimestamp: boolean;
  timestampQueryPool: { render?: TimestampPool | null };
}

/** Frames between query resolves: enough to amortise the readback, few enough to stay under the pool's 1024 pairs. */
const RESOLVE_EVERY_FRAMES = 12;

export class PassTimer extends InspectorBase implements GpuTimes {
  /** The game's own scene and eye camera: their pass is 'scene'; the scene from any other camera is 'shadows'. */
  mainScene: Object3D | null = null;
  mainCamera: Camera | null = null;
  /** GPU milliseconds per group, per frame, from the last resolved batch. */
  readonly gpuMs: Record<PassGroup, number> = { scene: 0, shadows: 0, water: 0, scope: 0, post: 0, other: 0 };
  gpuTotalMs = 0;
  /** True once a resolve has returned numbers: the backend supports timestamps. */
  hasGpuTimes = false;
  /**
   * False on the WebGL2 backend: a GL timer query cannot nest, and three renders the scene pass
   * from inside the post chain's own render, so the outer query holds both and the inner one is
   * skipped. Only the total is right there; the split per pass needs WebGPU (one query pair per pass).
   */
  perPass = true;
  private readonly groupOf = new Map<string, PassGroup>();
  private readonly named = new WeakMap<RenderTarget, PassGroup>();
  private framesSinceResolve = 0;
  private resolving = false;

  /** Offscreen targets the game renders into itself (caustics, scope): named here, grouped by name. */
  name(target: RenderTarget, group: PassGroup): void {
    this.named.set(target, group);
  }

  override beginRender(uid: string, scene: Object3D, camera: Camera, target: RenderTarget | null): void {
    this.groupOf.set(uid, this.classify(scene, camera, target));
  }

  private classify(scene: Object3D, camera: Camera, target: RenderTarget | null): PassGroup {
    const named = target ? this.named.get(target) : undefined;
    if (named) return named;
    if (scene === this.mainScene) return camera === this.mainCamera ? 'scene' : 'shadows';
    // Post passes draw a QuadMesh (a Mesh passed as the "scene"); anything else is a probe bake or similar.
    return (scene as Object3D & { isMesh?: boolean }).isMesh === true ? 'post' : 'other';
  }

  /** Call once per displayed frame, after rendering. Resolves the GPU queries every few frames. */
  poll(renderer: Renderer): void {
    if (++this.framesSinceResolve < RESOLVE_EVERY_FRAMES || this.resolving) return;
    const backend = renderer.backend as unknown as TimestampBackend;
    if (!backend.trackTimestamp) {
      this.groupOf.clear();
      return;
    }
    this.framesSinceResolve = 0;
    this.perPass = 'isWebGPUBackend' in backend;
    this.resolving = true;
    renderer
      .resolveTimestampsAsync('render')
      .then(() => this.collect(backend.timestampQueryPool.render?.timestamps))
      .catch((err: unknown) => console.warn('GPU timestamp readback failed:', err))
      .finally(() => {
        this.resolving = false;
      });
  }

  private collect(times: Map<string, number> | undefined): void {
    if (!times || times.size === 0) return;
    const sums: Record<PassGroup, number> = { scene: 0, shadows: 0, water: 0, scope: 0, post: 0, other: 0 };
    const frames = new Set<string>();
    let total = 0;
    for (const [uid, ms] of times) {
      const frame = uid.slice(uid.lastIndexOf(':f') + 2);
      frames.add(frame);
      const g = this.groupOf.get(uid) ?? 'other';
      sums[g] += ms;
      total += ms;
      this.groupOf.delete(uid);
    }
    // Labels of frames rendered but not yet resolved stay; anything older than the batch is dropped.
    if (this.groupOf.size > 4096) this.groupOf.clear();
    const n = Math.max(1, frames.size);
    for (const g of PASS_GROUPS) this.gpuMs[g] = sums[g] / n;
    this.gpuTotalMs = total / n;
    this.hasGpuTimes = true;
  }

  /** "scene 5.1 · shadows 1.2 · post 0.8 ms", or an empty string without timestamp support. */
  summary(): string {
    if (!this.hasGpuTimes) return '';
    if (!this.perPass) return `GPU ${this.gpuTotalMs.toFixed(1)} ms (split per pass needs WebGPU)`;
    const parts = PASS_GROUPS.filter((g) => this.gpuMs[g] >= 0.05).map((g) => `${g} ${this.gpuMs[g].toFixed(1)}`);
    return `GPU ${this.gpuTotalMs.toFixed(1)} ms: ${parts.join(' · ')}`;
  }
}

/** Smoothed CPU milliseconds per named section of the frame. */
export class CpuTimer {
  readonly ms: Record<string, number> = {};
  private t0 = 0;

  begin(): void {
    this.t0 = performance.now();
  }

  /** Ends the section started by begin() and starts the next one. */
  lap(name: string): void {
    const t = performance.now();
    const prev = this.ms[name];
    this.ms[name] = prev === undefined ? t - this.t0 : prev + (t - this.t0 - prev) * 0.05;
    this.t0 = t;
  }

  summary(): string {
    return Object.entries(this.ms)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(' · ');
  }
}

/** A frame is on time below this: 52 fps leaves room for timer jitter on a 60 Hz display. */
const SLOW_S = 1 / 52;
const FAST_S = 1 / 58.5;
/** A step down must cut the typical frame time by at least this share, or it bought nothing. */
const MIN_GAIN = 0.08;

/**
 * Keeps the frame rate at the display's 60 Hz by trading image quality, never gameplay.
 * Frame times are judged by percentiles of a one-second window, so a single slow frame does nothing.
 * Going down is quick; going up is slow and remembers a level that failed, so it never oscillates.
 * A step down that did not make frames faster (a phone capped at 30 Hz, or a CPU-bound frame) is
 * undone and the governor stays there for a minute: lowering the image would buy nothing.
 *
 * `steps` run from best to cheapest; `apply` switches the game to one. Switching must not
 * recompile shaders (a hitch the governor would then measure): uniforms and render size only.
 */
export class FrameGovernor<S> {
  level = 0;
  /** False: stay at level 0 (benchmarks, or the player turned it off). */
  enabled = true;
  private samples = new Float32Array(512);
  private n = 0;
  private window = 0;
  private cooldown = 2;
  private goodFor = 0;
  /** Level that was too slow the last time we tried it, and how long to stay away from it. */
  private ceiling = -1;
  private ceilingT = 0;
  /** Deepest level worth using, and for how long (set when a step down gained nothing). */
  private floor = Number.POSITIVE_INFINITY;
  private floorT = 0;
  /** Where the current run of steps down began, to check it bought something. */
  private descent: { from: number; p70: number } | null = null;

  constructor(
    private readonly steps: readonly S[],
    private readonly apply: (step: S, level: number) => void,
  ) {
    if (steps.length === 0) throw new Error('FrameGovernor needs at least one step');
  }

  get step(): S {
    return this.steps[this.level] as S;
  }

  /** Back to full quality, and forget what was learnt (a new map, new settings). */
  reset(): void {
    this.n = this.window = this.goodFor = 0;
    this.cooldown = 2;
    this.ceiling = -1;
    this.ceilingT = 0;
    this.floor = Number.POSITIVE_INFINITY;
    this.floorT = 0;
    this.descent = null;
    if (this.level !== 0) this.set(0);
  }

  /** `dt` is the real frame interval (s); only call while the game is being played. */
  update(dt: number): void {
    if (!this.enabled) {
      if (this.level !== 0) this.set(0);
      return;
    }
    if (dt <= 0 || dt > 1) return; // back from a hidden tab or a breakpoint: not performance data
    this.cooldown -= dt;
    this.ceilingT -= dt;
    this.floorT -= dt;
    if (this.n < this.samples.length) this.samples[this.n++] = dt;
    this.window += dt;
    if (this.window < 1) return;
    // Percentiles ignore isolated hitches (GC, a texture upload) but catch judder: step down when
    // over 30 % of frames miss vsync, step up only when 90 % are comfortably on time.
    const sorted = this.samples.subarray(0, this.n).sort();
    const p70 = sorted[Math.floor(this.n * 0.7)] as number;
    const p90 = sorted[Math.floor(this.n * 0.9)] as number;
    this.n = this.window = 0;
    if (this.cooldown > 0) return;
    // Judge a descent after two steps, not one: a single cheap step (the shafts) may gain too
    // little to show, while the resolution steps behind it would.
    if (this.descent) {
      const { from, p70: before } = this.descent;
      if (p70 <= before * (1 - MIN_GAIN)) this.descent = null;
      else if (this.level - from >= 2) {
        this.descent = null;
        this.floor = from;
        this.floorT = 60;
        this.set(from);
        this.cooldown = 2.5;
        this.goodFor = 0;
        return;
      }
    }
    const deepest = Math.min(this.steps.length - 1, this.floorT > 0 ? this.floor : Number.POSITIVE_INFINITY);
    if (p70 > SLOW_S && this.level < deepest) {
      if (this.goodFor < 3) this.ceiling = this.level; // we just came up and it failed
      this.ceilingT = 60;
      this.descent ??= { from: this.level, p70 };
      this.set(this.level + 1);
      this.cooldown = 2.5;
      this.goodFor = 0;
      return;
    }
    if (p90 < FAST_S) this.goodFor++;
    else this.goodFor = 0;
    const blocked = this.ceilingT > 0 && this.level - 1 <= this.ceiling;
    if (this.goodFor >= 8 && this.level > 0 && !blocked) {
      this.set(this.level - 1);
      this.cooldown = 3;
      this.goodFor = 0;
    }
  }

  private set(level: number): void {
    this.level = level;
    this.apply(this.steps[level] as S, level);
  }
}
