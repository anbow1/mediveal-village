// Stage 2 game host: boot timing ([load] logs), byte-accurate asset loading, PMREM sky probe,
// LOD/impostor updates, fixed 60 Hz skeletal animation, debug contract, governor & bench.

import type { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import {
  BENCH,
  GOVERNOR_STEPS,
  QUALITY_PRESETS,
  SIM,
  type LangCode,
  type LightingPresetId,
  type QualityPreset,
  type ToneMappingChoice,
} from '../config.ts';
import { FixedStepLoop } from '../core/loop.ts';
import { AssetLoader } from '../render/assetLoader.ts';
import { LightingRig, type ShadowConfigSummary } from '../render/lighting.ts';
import { CpuTimer, FrameGovernor } from '../render/perf.ts';
import { RenderStage } from '../render/stage.ts';
import { buildStage2World, type Stage2WorldHandles } from '../render/stage2Assets.ts';
import { OverlayUi } from '../ui/overlay.ts';
import { BENCH_SPOTS, type BenchResult, BenchSession, findBenchSpot } from './bench.ts';
import { InputBindings } from './bindings.ts';
import { type DebugPlaceArgs, RtsCameraController } from './rtsCamera.ts';

export interface BootOptions {
  readonly container: HTMLElement;
  readonly autostart: boolean;
  readonly debug: boolean;
  readonly autoBench: boolean;
  readonly fastBench: boolean;
  readonly quality: QualityPreset;
  readonly lighting: LightingPresetId;
  readonly toneMapping: ToneMappingChoice;
  readonly lang: LangCode;
  readonly initialSpot?: string | null;
}

interface DebugApi {
  readonly place: (v: DebugPlaceArgs) => void;
  readonly spot: (name: string) => void;
  readonly step: (seconds: number) => number;
  readonly setLighting: (preset: LightingPresetId) => void;
  readonly startBench: (fast?: boolean) => void;
  readonly installPipelineTracer: () => void;
  readonly getNewPipelines: () => readonly string[];
  readonly getStats: () => {
    backend: 'WebGPU' | 'WebGL2';
    quality: QualityPreset;
    toneMapping: ToneMappingChoice;
    lighting: LightingPresetId;
    anchorEv100: number;
    preExposure: number;
    drawCalls: number;
    triangles: number;
    renderScale: number;
    governorLevel: number;
    simTimeS: number;
    paused: boolean;
    loadTotalS: number;
    lods: Record<string, number>;
    shadows: ShadowConfigSummary;
    benchResult: BenchResult | null;
  };
  readonly renderer: WebGPURenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
}

declare global {
  interface Window {
    __ready?: boolean;
    __debug?: DebugApi;
    __benchResult?: BenchResult | null;
  }
}

const LIGHTING_ORDER: readonly LightingPresetId[] = ['lateAutumn', 'clearNoon', 'goldenHour', 'overcast'];

export class Game {
  private readonly stage: RenderStage;
  private readonly lighting: LightingRig;
  private readonly assetLoader: AssetLoader;
  private readonly world: Stage2WorldHandles;
  private readonly bindings: InputBindings;
  private readonly camCtrl: RtsCameraController;
  private readonly loop: FixedStepLoop;
  private readonly cpuTimer = new CpuTimer();
  private readonly governor: FrameGovernor<(typeof GOVERNOR_STEPS)['high'][number]>;
  private readonly ui: OverlayUi;

  private benchSession: BenchSession | null = null;
  private lastBenchResult: BenchResult | null = null;
  private rafId = 0;
  private lastRafMs = 0;
  private smoothedFps = 60;
  private smoothedFrameMs = 16.67;
  private loadTotalS = 0;
  private playing = false;
  private disposed = false;
  private newPipelines: string[] = [];
  private tracerInstalled = false;

  private constructor(
    stage: RenderStage,
    lighting: LightingRig,
    assetLoader: AssetLoader,
    world: Stage2WorldHandles,
    ui: OverlayUi,
    bindings: InputBindings,
    camCtrl: RtsCameraController,
    private readonly opts: BootOptions,
  ) {
    this.stage = stage;
    this.lighting = lighting;
    this.assetLoader = assetLoader;
    this.world = world;
    this.ui = ui;
    this.bindings = bindings;
    this.camCtrl = camCtrl;

    this.governor = new FrameGovernor(GOVERNOR_STEPS[opts.quality], (step) => {
      this.stage.applyGovernorStep(step);
    });
    this.stage.applyGovernorStep(this.governor.step);

    this.loop = new FixedStepLoop({
      onStep: () => {
        // Advance skeletal animations, cloud drift, and calm water ripples on the 60 Hz sim clock.
        this.world.update(SIM.fixedStepS, this.stage.camera.position, false);
        this.lighting.advanceAtmosphere(SIM.fixedStepS);
      },
      onRender: (realDtS) => this.renderFrame(realDtS),
    });

    this.attachWindowHandlers();
  }

  static async boot(opts: BootOptions): Promise<Game> {
    const tBoot = performance.now();
    let tPrev = tBoot;
    const markStage = (name: string): number => {
      const now = performance.now();
      const dt = (now - tPrev) / 1000;
      tPrev = now;
      console.log(`[load] ${name}: ${dt.toFixed(3)} s`);
      return dt;
    };

    const bindings = new InputBindings();
    let gameRef: Game | null = null;

    const ui = new OverlayUi(opts.container, opts.lang, opts.quality, opts.lighting, {
      onStartPlay: () => gameRef?.enterPlay(),
      onResume: () => gameRef?.resumeFromPauseMenu(),
      onTogglePause: () => gameRef?.toggleActivePause(),
      onOpenPauseMenu: () => gameRef?.openPauseMenu(),
      onRunBenchmark: () => gameRef?.startBenchmark(opts.fastBench),
      onRotateCamera: (dyaw) => gameRef?.camCtrl.rotateBy(dyaw),
      onChangeLighting: (preset) => gameRef?.setLightingPreset(preset),
      onToggleGovernor: (enabled) => gameRef?.setGovernorEnabled(enabled),
      onChangeQuality: (q) => {
        const url = new URL(window.location.href);
        url.searchParams.set('q', q);
        window.location.href = url.toString();
      },
      onChangeLang: (lang) => {
        ui.setLang(lang);
      },
    });

    ui.setLoadingStage('init renderer', 0.04);
    const stage = await RenderStage.create({
      container: opts.container,
      quality: opts.quality,
      toneMapping: opts.toneMapping,
    });
    markStage('renderer');

    ui.setLoadingStage('sky reflection probe', 0.08);
    const lighting = new LightingRig(stage.scene, QUALITY_PRESETS[opts.quality], opts.lighting);
    lighting.initSkyProbe(stage.renderer);
    markStage('sky-probe');

    // Construct AssetLoader strictly AFTER `await renderer.init()` so KTX2Loader detects live GPU block support.
    const assetLoader = new AssetLoader(stage.renderer);
    const maxAniso =
      typeof (stage.renderer as unknown as { getMaxAnisotropy?: () => number }).getMaxAnisotropy === 'function'
        ? (stage.renderer as unknown as { getMaxAnisotropy: () => number }).getMaxAnisotropy()
        : 8;
    const anisotropy = Math.min(opts.quality === 'high' ? 8 : 4, maxAniso);

    const world = await buildStage2World(
      stage.scene,
      assetLoader,
      lighting.skyUniforms,
      anisotropy,
      (loadedBytes, totalBytes) => {
        ui.setLoadingProgress(loadedBytes, totalBytes);
      },
    );
    markStage('assets');

    const camCtrl = new RtsCameraController(stage.camera, stage.renderer.domElement, bindings);
    // Start framed on optional ?spot=<name> or default village showcase.
    const startSpot = opts.initialSpot && BENCH_SPOTS.some((s) => s.name === opts.initialSpot) ? opts.initialSpot : 'showcase';
    camCtrl.applySpotCamera(findBenchSpot(startSpot).camera);
    lighting.followCamera(stage.camera.position);
    world.update(0, stage.camera.position, true);
    stage.updateSunShafts(lighting.state.sunDirection, lighting.state.config.sunShaftStrength, lighting.state.sunRgb);
    markStage('scene');

    ui.setLoadingStage('warmup pipelines', 0.96);
    await stage.warmUp();
    markStage('warmup');

    // Render two real animation frames before declaring ready so TRAA history settles.
    ui.setLoadingStage('first frames', 0.99);
    for (let i = 0; i < 2; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      stage.render();
    }
    markStage('first-frames');

    const totalS = (performance.now() - tBoot) / 1000;
    console.log(`[load] total: ${totalS.toFixed(3)} s`);

    const game = new Game(stage, lighting, assetLoader, world, ui, bindings, camCtrl, opts);
    gameRef = game;
    game.loadTotalS = totalS;
    ui.hideLoading(totalS);

    if (opts.debug) {
      game.exposeDebugApi();
    }

    if (opts.autostart || opts.autoBench) {
      game.enterPlay();
      if (opts.autoBench) {
        game.startBenchmark(opts.fastBench);
      }
    } else {
      ui.showStartMenu();
    }

    window.__ready = true;
    game.startRaf();
    return game;
  }

  private exposeDebugApi(): void {
    window.__debug = {
      place: (v) => {
        this.camCtrl.place(v);
        this.lighting.followCamera(this.stage.camera.position);
        this.world.update(0, this.stage.camera.position, true);
        this.stage.updateSunShafts(
          this.lighting.state.sunDirection,
          this.lighting.state.config.sunShaftStrength,
          this.lighting.state.sunRgb,
        );
      },
      spot: (name) => {
        this.camCtrl.applySpotCamera(findBenchSpot(name).camera);
        this.lighting.followCamera(this.stage.camera.position);
        this.world.update(0, this.stage.camera.position, true);
        this.stage.updateSunShafts(
          this.lighting.state.sunDirection,
          this.lighting.state.config.sunShaftStrength,
          this.lighting.state.sunRgb,
        );
      },
      step: (seconds) => this.loop.stepSeconds(seconds),
      setLighting: (preset) => this.setLightingPreset(preset),
      startBench: (fast = false) => this.startBenchmark(fast),
      installPipelineTracer: () => this.installPipelineTracer(),
      getNewPipelines: () => [...this.newPipelines],
      getStats: () => ({
        backend: this.stage.backendName,
        quality: this.stage.quality,
        toneMapping: this.stage.toneMapping,
        lighting: this.lighting.state.presetId,
        anchorEv100: this.lighting.state.anchorEv100,
        preExposure: this.lighting.state.preExposure,
        drawCalls: this.stage.renderer.info.render.drawCalls,
        triangles: this.stage.renderer.info.render.triangles,
        renderScale: this.stage.currentRenderScale,
        governorLevel: this.governor.level,
        simTimeS: this.loop.simTimeS,
        paused: this.loop.paused,
        loadTotalS: this.loadTotalS,
        lods: this.world.getLodSummary(),
        shadows: this.lighting.getShadowInfo(),
        benchResult: this.lastBenchResult,
      }),
      renderer: this.stage.renderer,
      scene: this.stage.scene,
      camera: this.stage.camera,
    };
  }

  /** Playbook §9.3 pipeline tracer: catches any new pipeline built after load. */
  private installPipelineTracer(): void {
    if (this.tracerInstalled) return;
    this.tracerInstalled = true;
    interface InternalPipelines {
      caches: Map<unknown, unknown>;
      getForRender: (ro: { material?: { name?: string }; object?: { name?: string } }, promises?: unknown) => unknown;
    }
    const pl = (this.stage.renderer as unknown as { _pipelines?: InternalPipelines })._pipelines;
    if (!pl || typeof pl.getForRender !== 'function') return;
    const orig = pl.getForRender.bind(pl);
    pl.getForRender = (ro, promises) => {
      const before = pl.caches.size;
      const res = orig(ro, promises);
      if (pl.caches.size > before) {
        this.newPipelines.push(`${ro.material?.name ?? 'unnamed'}@${ro.object?.name ?? 'unnamed'}`);
      }
      return res;
    };
  }

  private attachWindowHandlers(): void {
    window.addEventListener('resize', () => {
      this.stage.resize(this.opts.container.clientWidth || window.innerWidth, this.opts.container.clientHeight || window.innerHeight);
      this.lighting.onCameraResize();
    });
    window.addEventListener('blur', () => this.bindings.clearHeld());
    window.addEventListener('keydown', (e) => {
      const action = this.bindings.onKeyDown(e);
      if (!action) return;
      if (action === 'perfOverlay') {
        e.preventDefault();
        this.ui.toggleStatsOverlay();
      } else if (action === 'pause' && this.playing && !this.ui.isPauseMenuOpen()) {
        e.preventDefault();
        this.toggleActivePause();
      } else if (action === 'menu' && this.playing) {
        e.preventDefault();
        if (this.ui.isPauseMenuOpen()) this.resumeFromPauseMenu();
        else this.openPauseMenu();
      } else if (action === 'nextLighting' && this.playing) {
        const idx = (LIGHTING_ORDER.indexOf(this.lighting.state.presetId) + 1) % LIGHTING_ORDER.length;
        this.setLightingPreset(LIGHTING_ORDER[idx] ?? 'lateAutumn');
      }
    });
    window.addEventListener('keyup', (e) => {
      this.bindings.onKeyUp(e);
    });
  }

  enterPlay(): void {
    this.playing = true;
    this.loop.paused = false;
    this.ui.showGameplay();
    this.ui.setPaused(false);
  }

  toggleActivePause(): void {
    this.loop.paused = !this.loop.paused;
    this.ui.setPaused(this.loop.paused);
  }

  openPauseMenu(): void {
    this.loop.paused = true;
    this.ui.setPaused(true);
    this.ui.showPauseMenu();
  }

  resumeFromPauseMenu(): void {
    this.ui.hidePauseMenu();
    this.loop.paused = false;
    this.ui.setPaused(false);
  }

  setLightingPreset(preset: LightingPresetId): void {
    this.lighting.applyPreset(preset);
    this.ui.setLighting(preset);
    this.stage.updateSunShafts(
      this.lighting.state.sunDirection,
      this.lighting.state.config.sunShaftStrength,
      this.lighting.state.sunRgb,
    );
  }

  setGovernorEnabled(enabled: boolean): void {
    this.governor.enabled = enabled;
    if (!enabled) this.governor.reset();
    this.ui.setGovernorEnabled(enabled);
  }

  startBenchmark(fast = false): void {
    this.lastBenchResult = null;
    window.__benchResult = null;
    this.loop.paused = true;
    this.governor.enabled = false;
    this.governor.reset();
    const title = `Marchland Stage 3 · ${this.stage.backendName} · ${this.stage.quality.toUpperCase()} · ${this.lighting.state.presetId}`;
    this.benchSession = new BenchSession(
      BENCH_SPOTS,
      title,
      (spot) => {
        this.camCtrl.applySpotCamera(spot.camera);
        this.lighting.followCamera(this.stage.camera.position);
        this.world.update(0, this.stage.camera.position, true);
        this.stage.updateSunShafts(
          this.lighting.state.sunDirection,
          this.lighting.state.config.sunShaftStrength,
          this.lighting.state.sunRgb,
        );
      },
      fast ? BENCH.fastSettleFrames : BENCH.settleFrames,
      fast ? BENCH.fastSampleFrames : BENCH.sampleFrames,
    );
    this.ui.showBenchmarkRunning(this.benchSession.progressText);
  }

  private startRaf(): void {
    this.lastRafMs = performance.now();
    const tick = (nowMs: number): void => {
      if (this.disposed) return;
      const rawDtS = (nowMs - this.lastRafMs) / 1000;
      this.lastRafMs = nowMs;
      if (rawDtS > 0 && rawDtS < 1) {
        const instFps = 1 / rawDtS;
        this.smoothedFps += (instFps - this.smoothedFps) * 0.1;
        this.smoothedFrameMs += (rawDtS * 1000 - this.smoothedFrameMs) * 0.1;
      }
      this.loop.frame(rawDtS);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private renderFrame(realDtS: number): void {
    this.cpuTimer.begin();

    if (this.playing && !this.benchSession && !this.ui.isPauseMenuOpen()) {
      this.camCtrl.update(realDtS);
      this.governor.update(realDtS);
    }
    this.lighting.followCamera(this.stage.camera.position);
    this.world.update(0, this.stage.camera.position, true);
    this.stage.updateSunShafts(
      this.lighting.state.sunDirection,
      this.lighting.state.config.sunShaftStrength,
      this.lighting.state.sunRgb,
    );
    this.cpuTimer.lap('update');

    const tRender0 = performance.now();
    this.stage.render();
    const renderCpuMs = performance.now() - tRender0;
    this.cpuTimer.lap('draw');

    const info = this.stage.renderer.info.render;
    if (this.benchSession) {
      const done = this.benchSession.tick(realDtS, renderCpuMs, info.drawCalls, info.triangles, this.stage.passTimer);
      if (done) {
        this.lastBenchResult = done;
        window.__benchResult = done;
        this.benchSession = null;
        this.governor.enabled = true;
        this.ui.showBenchmarkResult(done.text);
        console.log(done.text);
      } else {
        this.ui.showBenchmarkRunning(this.benchSession.progressText);
      }
    }

    this.ui.updateStats({
      fps: this.smoothedFps,
      frameMs: this.smoothedFrameMs,
      governorLabel: this.governor.step.label,
      governorEnabled: this.governor.enabled,
      renderScale: this.stage.currentRenderScale,
      cpuSummary: this.cpuTimer.summary(),
      gpuSummary: this.stage.passTimer.summary(),
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      ev100: this.lighting.state.anchorEv100,
      lightingPreset: this.lighting.state.presetId,
      quality: this.stage.quality,
      backend: this.stage.backendName,
      toneMapping: this.stage.toneMapping,
      simTimeS: this.loop.simTimeS,
      paused: this.loop.paused,
    });
    this.cpuTimer.lap('hud');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.camCtrl.dispose();
    this.world.dispose();
    this.lighting.dispose();
    this.assetLoader.dispose();
    this.stage.dispose();
  }
}
