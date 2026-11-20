// Stage 6 Playable Marchland Game Host:
// Wires deterministic 60 Hz SimEngine -> GPU-instanced WorldHandles + CombatFx + SimWorldRenderer,
// RtsInputController (marquee select, Ctrl+right-drag formations, Shift queuing, free placement),
// Positional Web Audio (343 m/s delay + ambient wind/birds), Bilingual GameHud + Minimap + Save/Load!

import { Vector3, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
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
import { buildStage5World, type WorldHandles } from '../render/worldBuilder.ts';
import { findKeep } from '../sim/economy.ts';
import { SimEngine } from '../sim/engine.ts';
import { buildCampaignCarryOver } from '../sim/modes.ts';
import type { MapLayoutId } from '../sim/terrain.ts';
import type {
  AiPersonality,
  CampaignMissionId,
  Difficulty,
  GameMode,
  SimCommand,
} from '../sim/types.ts';
import {
  loadCampaignProgress,
  loadGameFromSlot,
  recordMissionVictory,
  saveGameToSlot,
} from '../ui/campaignStore.ts';
import { GameHud } from '../ui/hud.ts';
import { SoundEngine } from '../ui/sound.ts';
import {
  type BenchResult,
  BenchSession,
  type BenchSpot,
  createBenchSpotsForWorld,
  findBenchSpot,
} from './bench.ts';
import { InputBindings } from './bindings.ts';
import { RtsInputController } from './input.ts';
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
  readonly mapId: MapLayoutId;
  readonly initialSpot?: string | null;
  readonly mode?: GameMode;
  readonly missionId?: CampaignMissionId;
  readonly difficulty?: Difficulty;
  readonly aiPersonality?: AiPersonality;
  readonly showcaseMode?: boolean;
}

interface DebugApi {
  readonly place: (v: DebugPlaceArgs) => void;
  readonly spot: (name: string) => void;
  readonly step: (seconds: number) => number;
  readonly setLighting: (preset: LightingPresetId) => void;
  readonly startBench: (fast?: boolean) => void;
  readonly installPipelineTracer: () => void;
  readonly getNewPipelines: () => readonly string[];
  readonly execute: (cmd: SimCommand) => boolean;
  readonly selectAll: () => void;
  readonly setSpeed: (speed: 0.5 | 1 | 2) => void;
  readonly setPaused: (paused: boolean) => void;
  readonly getSim: () => SimEngine;
  readonly getStats: () => {
    backend: 'WebGPU' | 'WebGL2';
    quality: QualityPreset;
    toneMapping: ToneMappingChoice;
    lighting: LightingPresetId;
    mapId: MapLayoutId;
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
    worldMetrics: ReturnType<WorldHandles['getWorldMetrics']>;
    benchResult: BenchResult | null;
    simTick: number;
    regimentCount: number;
    citizenCount: number;
    buildingCount: number;
    projectileCount: number;
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
  private readonly world: WorldHandles;
  private readonly benchSpots: readonly BenchSpot[];
  private readonly bindings: InputBindings;
  private readonly camCtrl: RtsCameraController;
  private readonly inputCtrl: RtsInputController;
  private readonly sound: SoundEngine;
  private readonly loop: FixedStepLoop;
  private readonly cpuTimer = new CpuTimer();
  private readonly governor: FrameGovernor<(typeof GOVERNOR_STEPS)['high'][number]>;
  private readonly ui: GameHud;
  private readonly camDir = new Vector3();
  private readonly camRight = new Vector3();

  private sim: SimEngine;
  private simSpeed: 0.5 | 1 | 2 = 1;
  private speedAccum = 0;
  private recordedVictory = false;

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
    world: WorldHandles,
    sim: SimEngine,
    benchSpots: readonly BenchSpot[],
    ui: GameHud,
    bindings: InputBindings,
    camCtrl: RtsCameraController,
    sound: SoundEngine,
    private readonly opts: BootOptions,
  ) {
    this.stage = stage;
    this.lighting = lighting;
    this.assetLoader = assetLoader;
    this.world = world;
    this.sim = sim;
    this.benchSpots = benchSpots;
    this.ui = ui;
    this.bindings = bindings;
    this.camCtrl = camCtrl;
    this.sound = sound;

    this.inputCtrl = new RtsInputController(stage.renderer.domElement, stage.camera, camCtrl, {
      getSim: () => this.sim,
      isPlaying: () => this.playing && !this.ui.isPauseMenuOpen() && !this.ui.isStartMenuOpen(),
      onExecute: (cmd) => this.executeSimCommand(cmd),
      onPlayUiSound: (kind) => this.sound.playUi(kind),
      onSelectionChanged: () => {
        this.ui.setActiveTool(this.inputCtrl.placementTool);
        this.ui.refreshInspector();
      },
      onPlacementHover: (reason, sx, sy) => this.ui.setPlacementHover(reason, sx, sy),
    });

    this.governor = new FrameGovernor(GOVERNOR_STEPS[opts.quality], (step) => {
      this.stage.applyGovernorStep(step);
    });
    this.stage.applyGovernorStep(this.governor.step);

    this.loop = new FixedStepLoop({
      onStep: () => this.stepSimulation(SIM.fixedStepS),
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
    const sound = new SoundEngine();
    let gameRef: Game | null = null;

    const ui = new GameHud(opts.container, opts.lang, opts.quality, opts.lighting, opts.mapId, sound.getVolume(), {
      onLaunchGame: (cfg) => gameRef?.launchMatch(cfg),
      onResume: () => gameRef?.resumeFromPauseMenu(),
      onRestart: () => gameRef?.restartCurrentMatch(),
      onTogglePause: () => gameRef?.toggleActivePause(),
      onSetSpeed: (sp) => gameRef?.setSimSpeed(sp),
      onOpenPauseMenu: () => gameRef?.openPauseMenu(),
      onRunBenchmark: () => gameRef?.startBenchmark(opts.fastBench),
      onRotateCamera: (dyaw) => gameRef?.camCtrl.rotateBy(dyaw),
      onJumpCamera: (x, z) => gameRef?.camCtrl.jumpTo(x, z),
      onMinimapOrder: (x, z) => gameRef?.inputCtrl.issueContextOrderAt(x, z, false, false),
      onChangeLighting: (preset) => gameRef?.setLightingPreset(preset),
      onToggleGovernor: (enabled) => gameRef?.setGovernorEnabled(enabled),
      onChangeQuality: (q) => {
        const url = new URL(window.location.href);
        url.searchParams.set('q', q);
        window.location.href = url.toString();
      },
      onChangeLang: (lang) => ui.setLang(lang),
      onChangeVolume: (vol) => sound.setVolume(vol),
      onExecute: (cmd) => gameRef?.executeSimCommand(cmd) ?? false,
      onSelectTool: (tool) => gameRef?.inputCtrl.setPlacementTool(tool),
      onRotatePlacement: () => gameRef?.inputCtrl.rotatePlacement(),
      onSelectRegiment: (id, additive, jump) => {
        if (!gameRef) return;
        gameRef.inputCtrl.selectRegiments([id], additive);
        if (jump) {
          const r = gameRef.sim.state.regiments.find((x) => x.id === id);
          if (r) gameRef.camCtrl.jumpTo(r.x, r.z);
        }
      },
      onSaveSlot: (slot) => gameRef?.saveSlot(slot),
      onLoadSlot: (slot) => gameRef?.loadSlot(slot),
      onExportSave: () => gameRef?.exportSaveJson(),
      onImportSave: (json) => gameRef?.importSaveJson(json),
      onNextMission: () => gameRef?.launchNextCampaignMission(),
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

    const world = await buildStage5World(
      stage.scene,
      assetLoader,
      opts.quality,
      anisotropy,
      lighting.skyUniforms,
      opts.mapId,
      (loadedBytes, totalBytes) => {
        ui.setLoadingProgress(loadedBytes, totalBytes);
      },
    );
    markStage('assets');

    // Create deterministic Stage 6 SimEngine matching active map & mode!
    const campProg = loadCampaignProgress();
    const carryOver =
      opts.mode === 'campaign' && opts.missionId && opts.missionId > 1
        ? campProg.carryOverByMission[opts.missionId]
        : undefined;
    const sim = new SimEngine({
      mapId: opts.mapId,
      mode: opts.mode ?? 'skirmish',
      missionId: opts.missionId,
      difficulty: opts.difficulty ?? 'normal',
      aiPersonality: opts.aiPersonality ?? 'raider',
      showcaseMode: opts.showcaseMode ?? true,
      carryOver,
    });

    const benchSpots = createBenchSpotsForWorld(world.layout, world.terrain);
    const camCtrl = new RtsCameraController(
      stage.camera,
      stage.renderer.domElement,
      bindings,
      (x, z) => world.terrain.heightAt(x, z),
    );
    const startSpot = opts.initialSpot && benchSpots.some((s) => s.name === opts.initialSpot) ? opts.initialSpot : 'showcase';
    camCtrl.applySpotCamera(findBenchSpot(startSpot, benchSpots).camera);
    const initDir = new Vector3();
    stage.camera.getWorldDirection(initDir);
    lighting.followCamera(stage.camera.position);

    // Sync live SimWorld once BEFORE warmUp() so every dynamic mesh & VFX compiles during warmUp() (0 mid-play pipelines!)
    world.syncSimWorld(0, sim.state, stage.camera.position, initDir, new Set(), null, null, null, true);
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

    const game = new Game(stage, lighting, assetLoader, world, sim, benchSpots, ui, bindings, camCtrl, sound, opts);
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

  private stepSimulation(baseDtS: number): void {
    // Support 0.5x, 1x, 2x deterministic simulation speed!
    this.speedAccum += this.simSpeed;
    const steps = Math.floor(this.speedAccum);
    this.speedAccum -= steps;

    for (let i = 0; i < steps; i++) {
      this.sim.step(baseDtS);
    }

    // Drain FX events -> spawn visual cannon smoke/impact dust & physical 343 m/s Web Audio!
    const fx = this.sim.drainFxEvents();
    if (fx.length > 0) {
      this.world.combatFx.spawnFxEvents(fx);
      this.camRight.set(1, 0, 0).applyQuaternion(this.stage.camera.quaternion);
      this.sound.playSimEvents(
        fx,
        this.stage.camera.position.x,
        this.stage.camera.position.y,
        this.stage.camera.position.z,
        this.camRight.x,
        this.camRight.z,
      );
    }

    // Ambient forest birdsong (< 80 m from mature trees)
    const camP = this.stage.camera.position;
    let nearestTreeD = 999;
    const trees = this.sim.state.trees;
    for (let i = 0; i < trees.length; i += 4) {
      const tr = trees[i]!;
      if (tr.state !== 'mature') continue;
      const d = Math.hypot(tr.x - camP.x, tr.z - camP.z);
      if (d < nearestTreeD) nearestTreeD = d;
    }
    this.sound.updateAmbient(baseDtS, nearestTreeD);

    // Record campaign victory unlock & carry-over automatically!
    const sc = this.sim.state.scenario;
    if (!this.recordedVictory && sc.mode === 'campaign' && sc.missionId !== null && sc.outcome === 'victory') {
      this.recordedVictory = true;
      recordMissionVictory(sc.missionId, (sc.starsEarned || 1) as 1 | 2 | 3, buildCampaignCarryOver(this.sim.state));
      this.sound.playUi('horn');
    }

    this.lighting.advanceAtmosphere(baseDtS * Math.max(0.5, this.simSpeed));
  }

  private executeSimCommand(cmd: SimCommand): boolean {
    const res = this.sim.execute(cmd);
    if (res.ok) {
      this.ui.refreshInspector();
    }
    return res.ok;
  }

  private launchMatch(cfg: {
    mode: GameMode;
    mapId: MapLayoutId;
    difficulty: Difficulty;
    aiPersonality: AiPersonality;
    missionId?: CampaignMissionId;
    showcaseMode?: boolean;
  }): void {
    this.sound.unlock();
    // If map differs from loaded 3D terrain, reload with clean URL params for that map & mode!
    if (cfg.mapId !== this.world.mapId) {
      const url = new URL(window.location.href);
      url.searchParams.set('autostart', '1');
      url.searchParams.set('map', cfg.mapId);
      url.searchParams.set('mode', cfg.mode);
      url.searchParams.set('diff', cfg.difficulty);
      url.searchParams.set('ai', cfg.aiPersonality);
      url.searchParams.set('showcase', cfg.showcaseMode ? '1' : '0');
      if (cfg.missionId) url.searchParams.set('mission', String(cfg.missionId));
      else url.searchParams.delete('mission');
      window.location.href = url.toString();
      return;
    }

    const campProg = loadCampaignProgress();
    const carryOver =
      cfg.mode === 'campaign' && cfg.missionId && cfg.missionId > 1
        ? campProg.carryOverByMission[cfg.missionId]
        : undefined;

    this.sim = new SimEngine({
      mapId: cfg.mapId,
      mode: cfg.mode,
      missionId: cfg.missionId,
      difficulty: cfg.difficulty,
      aiPersonality: cfg.aiPersonality,
      showcaseMode: cfg.showcaseMode ?? false,
      carryOver,
    });
    this.recordedVictory = false;
    this.inputCtrl.selectedRegimentIds.clear();
    this.inputCtrl.selectedBuildingId = null;
    this.inputCtrl.setPlacementTool(null);

    const keep = findKeep(this.sim.state, 0);
    if (keep) this.camCtrl.jumpTo(keep.x, keep.z, true);
    this.enterPlay();
  }

  private restartCurrentMatch(): void {
    const o = this.sim.options;
    this.launchMatch({
      mode: o.mode ?? 'skirmish',
      mapId: o.mapId,
      difficulty: o.difficulty ?? 'normal',
      aiPersonality: o.aiPersonality ?? 'raider',
      missionId: o.missionId,
      showcaseMode: o.showcaseMode,
    });
  }

  private launchNextCampaignMission(): void {
    const cur = this.sim.state.scenario.missionId;
    if (!cur || cur >= 5) return;
    const next = (cur + 1) as CampaignMissionId;
    const missionMaps: Record<CampaignMissionId, MapLayoutId> = {
      1: 'crossing',
      2: 'forest',
      3: 'valley',
      4: 'valley',
      5: 'fortress',
    };
    this.launchMatch({
      mode: 'campaign',
      mapId: missionMaps[next],
      difficulty: this.sim.state.scenario.difficulty,
      aiPersonality: 'builder',
      missionId: next,
      showcaseMode: false,
    });
  }

  private saveSlot(slot: 1 | 2 | 3): void {
    const snap = this.sim.toSnapshot();
    const sc = this.sim.state.scenario;
    saveGameToSlot(slot, snap, {
      label: sc.mode === 'campaign' ? `M${sc.missionId}` : `${sc.mode}/${this.sim.state.mapId}`,
      mapId: this.sim.state.mapId,
      mode: sc.mode,
      timeS: this.sim.state.timeS,
    });
    this.sound.playUi('uiClick');
  }

  private loadSlot(slot: 1 | 2 | 3): void {
    const snap = loadGameFromSlot(slot);
    if (!snap) return;
    this.importSaveJson(snap);
  }

  private exportSaveJson(): void {
    const snap = this.sim.toSnapshot();
    const blob = new Blob([snap], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marchland-save-${this.sim.state.mapId}-${Math.floor(this.sim.state.timeS)}s.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importSaveJson(json: string): void {
    try {
      const restored = SimEngine.fromSnapshot(json);
      if (restored.state.mapId !== this.world.mapId) {
        // Save into slot 3 and reload map? Simpler: restore directly when map matches!
        this.sound.playUi('uiError');
        return;
      }
      this.sim = restored;
      this.inputCtrl.selectedRegimentIds.clear();
      this.inputCtrl.selectedBuildingId = null;
      this.inputCtrl.setPlacementTool(null);
      this.ui.hidePauseMenu();
      this.enterPlay();
      this.sound.playUi('uiClick');
    } catch {
      this.sound.playUi('uiError');
    }
  }

  private exposeDebugApi(): void {
    window.__debug = {
      place: (v) => {
        this.camCtrl.place(v);
        this.syncVisualFrame(0, true);
      },
      spot: (name) => {
        this.camCtrl.applySpotCamera(findBenchSpot(name, this.benchSpots).camera);
        this.syncVisualFrame(0, true);
      },
      step: (seconds) => {
        const res = this.loop.stepSeconds(seconds);
        this.syncVisualFrame(0, false);
        return res;
      },
      setLighting: (preset) => this.setLightingPreset(preset),
      startBench: (fast = false) => this.startBenchmark(fast),
      installPipelineTracer: () => this.installPipelineTracer(),
      getNewPipelines: () => [...this.newPipelines],
      execute: (cmd) => {
        const ok = this.executeSimCommand(cmd);
        this.syncVisualFrame(0, this.loop.paused);
        return ok;
      },
      selectAll: () => this.inputCtrl.selectAllPlayerArmy(),
      setSpeed: (speed) => this.setSimSpeed(speed),
      setPaused: (paused) => {
        this.loop.paused = paused;
        this.ui.setPaused(paused);
        this.sound.setPaused(paused);
      },
      getSim: () => this.sim,
      getStats: () => ({
        backend: this.stage.backendName,
        quality: this.stage.quality,
        toneMapping: this.stage.toneMapping,
        lighting: this.lighting.state.presetId,
        mapId: this.world.mapId,
        anchorEv100: this.lighting.state.anchorEv100,
        preExposure: this.lighting.state.preExposure,
        drawCalls: this.stage.renderer.info.render.drawCalls,
        triangles: this.stage.renderer.info.render.triangles,
        renderScale: this.stage.currentRenderScale,
        governorLevel: this.governor.level,
        simTimeS: this.sim.state.timeS,
        paused: this.loop.paused,
        loadTotalS: this.loadTotalS,
        lods: this.world.getLodSummary(),
        shadows: this.lighting.getShadowInfo(),
        worldMetrics: this.world.getWorldMetrics(),
        benchResult: this.lastBenchResult,
        simTick: this.sim.state.tick,
        regimentCount: this.sim.state.regiments.length,
        citizenCount: this.sim.state.citizens.length,
        buildingCount: this.sim.state.buildings.filter((b) => b.hp > 0).length,
        projectileCount: this.sim.state.projectiles.length,
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
    const unlockOnce = (): void => this.sound.unlock();
    window.addEventListener('pointerdown', unlockOnce, { once: true });
    window.addEventListener('keydown', unlockOnce, { once: true });

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
        return;
      }
      if (!this.playing) return;

      if (action === 'pause' && !this.ui.isPauseMenuOpen()) {
        e.preventDefault();
        this.toggleActivePause();
      } else if (action === 'menu') {
        e.preventDefault();
        if (this.inputCtrl.cancelPlacementStepOrTool()) {
          this.sound.playUi('uiClick');
        } else if (this.inputCtrl.selectedRegimentIds.size > 0 || this.inputCtrl.selectedBuildingId !== null) {
          this.inputCtrl.selectBuilding(null);
        } else if (this.ui.isPauseMenuOpen()) {
          this.resumeFromPauseMenu();
        } else {
          this.openPauseMenu();
        }
      } else if (e.code === 'KeyT' && !this.ui.isPauseMenuOpen()) {
        this.inputCtrl.toggleGridSnap();
        this.sound.playUi('uiClick');
      } else if (action === 'nextLighting') {
        const idx = (LIGHTING_ORDER.indexOf(this.lighting.state.presetId) + 1) % LIGHTING_ORDER.length;
        this.setLightingPreset(LIGHTING_ORDER[idx] ?? 'lateAutumn');
      } else if (action === 'buildRoad' && !this.ui.isPauseMenuOpen()) {
        this.inputCtrl.setPlacementTool(this.inputCtrl.placementTool?.kind === 'road' ? null : { kind: 'road' });
      } else if (action === 'rotateBuilding') {
        if (this.inputCtrl.placementTool) {
          this.inputCtrl.rotatePlacement();
          this.sound.playUi('uiClick');
        } else if (this.inputCtrl.selectedBuildingId !== null) {
          const sb = this.sim.state.buildings.find((b) => b.id === this.inputCtrl.selectedBuildingId && b.side === 0 && b.hp > 0);
          if (sb && sb.buildProgress < 1) {
            this.executeSimCommand({ type: 'rotateBuilding', side: 0, buildingId: sb.id, yawRad: sb.yawRad + Math.PI * 0.5 });
          }
        }
      } else if (action === 'haltRegiment' && this.inputCtrl.selectedRegimentIds.size > 0) {
        this.executeSimCommand({
          type: 'issueOrder',
          side: 0,
          regimentIds: [...this.inputCtrl.selectedRegimentIds],
          order: { kind: 'halt', x: 0, z: 0 },
        });
      } else if (action === 'formLine' && this.inputCtrl.selectedRegimentIds.size > 0) {
        e.preventDefault();
        this.executeSimCommand({ type: 'setFormation', side: 0, regimentIds: [...this.inputCtrl.selectedRegimentIds], formation: 'line' });
      } else if (action === 'formColumn' && this.inputCtrl.selectedRegimentIds.size > 0) {
        e.preventDefault();
        this.executeSimCommand({ type: 'setFormation', side: 0, regimentIds: [...this.inputCtrl.selectedRegimentIds], formation: 'column' });
      } else if (action === 'formSpecial' && this.inputCtrl.selectedRegimentIds.size > 0) {
        e.preventDefault();
        this.executeSimCommand({ type: 'setFormation', side: 0, regimentIds: [...this.inputCtrl.selectedRegimentIds], formation: 'loose' });
      } else if (action === 'speedDown') {
        this.setSimSpeed(this.simSpeed === 2 ? 1 : 0.5);
      } else if (action === 'speedUp') {
        this.setSimSpeed(this.simSpeed === 0.5 ? 1 : 2);
      } else if (action === 'selectAllArmy') {
        this.inputCtrl.selectAllPlayerArmy();
      } else if (action === 'jumpKeep') {
        const keep = findKeep(this.sim.state, 0);
        if (keep) this.camCtrl.jumpTo(keep.x, keep.z);
      } else if (action.startsWith('group')) {
        const num = Number(action.slice(5));
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          this.inputCtrl.handleGroupKey(num, e.ctrlKey || e.metaKey);
        }
      } else if (action.startsWith('bookmark')) {
        const slot = Number(action.slice(8));
        if (slot >= 1 && slot <= 4) {
          e.preventDefault();
          this.inputCtrl.handleBookmarkKey(slot, e.ctrlKey || e.metaKey);
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      this.bindings.onKeyUp(e);
    });
  }

  enterPlay(): void {
    this.playing = true;
    this.loop.paused = false;
    this.sound.setPaused(false);
    this.ui.showGameplay();
    this.ui.setPaused(false);
    this.ui.setSpeed(this.simSpeed);
  }

  toggleActivePause(): void {
    this.loop.paused = !this.loop.paused;
    this.sound.setPaused(this.loop.paused);
    this.ui.setPaused(this.loop.paused);
  }

  setSimSpeed(speed: 0.5 | 1 | 2): void {
    this.simSpeed = speed;
    if (this.loop.paused) {
      this.loop.paused = false;
      this.sound.setPaused(false);
      this.ui.setPaused(false);
    }
    this.ui.setSpeed(speed);
  }

  openPauseMenu(): void {
    this.loop.paused = true;
    this.sound.setPaused(true);
    this.ui.setPaused(true);
    this.ui.showPauseMenu();
  }

  resumeFromPauseMenu(): void {
    this.ui.hidePauseMenu();
    this.loop.paused = false;
    this.sound.setPaused(false);
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
    this.enterPlay();
    this.lastBenchResult = null;
    window.__benchResult = null;
    this.loop.paused = true;
    this.sound.setPaused(true);
    this.ui.setPaused(true);
    this.governor.enabled = false;
    this.governor.reset();
    const title = `Marchland Stage 6 (${this.world.mapId}) · ${this.stage.backendName} · ${this.stage.quality.toUpperCase()} · ${this.lighting.state.presetId}`;
    this.benchSession = new BenchSession(
      this.benchSpots,
      title,
      (spot) => {
        this.camCtrl.applySpotCamera(spot.camera);
        this.syncVisualFrame(0, true);
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
      this.rafId = requestAnimationFrame(tick);
      const dtS = Math.max(0, (nowMs - this.lastRafMs) / 1000);
      this.lastRafMs = nowMs;
      if (dtS > 0.0001) {
        const instFps = Math.min(240, 1 / dtS);
        this.smoothedFps = this.smoothedFps * 0.9 + instFps * 0.1;
        this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + dtS * 1000 * 0.1;
      }
      this.loop.frame(dtS);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private syncVisualFrame(realDtS: number, paused: boolean): void {
    this.stage.camera.getWorldDirection(this.camDir);
    this.lighting.followCamera(this.stage.camera.position);
    this.inputCtrl.pruneDeadSelections();

    this.world.syncSimWorld(
      realDtS,
      this.sim.state,
      this.stage.camera.position,
      this.camDir,
      this.inputCtrl.selectedRegimentIds,
      this.inputCtrl.selectedBuildingId,
      this.inputCtrl.getFormationGhost(),
      this.inputCtrl.getPlacementGhost(),
      paused,
    );

    this.stage.updateSunShafts(
      this.lighting.state.sunDirection,
      this.lighting.state.config.sunShaftStrength,
      this.lighting.state.sunRgb,
    );
  }

  private renderFrame(realDtS: number): void {
    this.cpuTimer.begin();

    if (!this.benchSession && this.playing && !this.ui.isPauseMenuOpen()) {
      this.camCtrl.update(realDtS);
      this.governor.update(realDtS);
    }

    this.syncVisualFrame(realDtS, this.loop.paused || !this.playing);
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

    if (this.playing) {
      this.ui.syncFromSim(
        this.sim.state,
        this.world.terrain,
        this.camCtrl.current.targetX,
        this.camCtrl.current.targetZ,
        this.inputCtrl.selectedRegimentIds,
        this.inputCtrl.selectedBuildingId,
        this.inputCtrl.controlGroups,
      );
    }

    this.ui.updatePerfOverlay({
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
      simTimeS: this.sim.state.timeS,
      paused: this.loop.paused,
    });
    this.cpuTimer.lap('hud');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.inputCtrl.dispose();
    this.camCtrl.dispose();
    this.sound.dispose();
    this.world.dispose();
    this.lighting.dispose();
    this.assetLoader.dispose();
    this.stage.dispose();
  }
}
