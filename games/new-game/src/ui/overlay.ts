// Stage 1 UI: loading screen, start menu, pause menu (with Benchmark & load time), HUD, F3 overlay.
// Uses #ui, #hud, #stats so `tools/measure/shots.mjs` hides overlays cleanly by default.

import type { LangCode, LightingPresetId, QualityPreset } from '../config.ts';
import { ALL_MAP_IDS } from '../sim/maps.ts';
import type { MapLayoutId } from '../sim/terrain.ts';
import { qualityLabel, STRINGS, type Strings } from './strings.ts';

const MAP_LABELS: Record<LangCode, Record<MapLayoutId, string>> = {
  en: {
    crossing: 'River Crossing (M1–M2)',
    openField: 'Open Field',
    forest: 'Ancient Forest',
    valley: 'Mountain Valley (M3–M4)',
    fortress: 'Citadel Fortress (M5)',
  },
  pl: {
    crossing: 'Przeprawa (M1–M2)',
    openField: 'Otwarte pole',
    forest: 'Bór',
    valley: 'Dolina (M3–M4)',
    fortress: 'Twierdza (M5)',
  },
};

export interface OverlayCallbacks {
  onStartPlay: () => void;
  onResume: () => void;
  onTogglePause: () => void;
  onOpenPauseMenu: () => void;
  onRunBenchmark: () => void;
  onRotateCamera: (deltaYawRad: number) => void;
  onChangeLighting: (preset: LightingPresetId) => void;
  onToggleGovernor: (enabled: boolean) => void;
  onChangeQuality: (quality: QualityPreset) => void;
  onChangeMap: (mapId: MapLayoutId) => void;
  onChangeLang: (lang: LangCode) => void;
}

export interface PerfSnapshot {
  readonly fps: number;
  readonly frameMs: number;
  readonly governorLabel: string;
  readonly governorEnabled: boolean;
  readonly renderScale: number;
  readonly cpuSummary: string;
  readonly gpuSummary: string;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly ev100: number;
  readonly lightingPreset: LightingPresetId;
  readonly quality: QualityPreset;
  readonly backend: 'WebGPU' | 'WebGL2';
  readonly toneMapping: string;
  readonly simTimeS: number;
  readonly paused: boolean;
}

const LIGHTING_ORDER: readonly LightingPresetId[] = ['clearNoon', 'lateAutumn', 'goldenHour', 'overcast'];

export class OverlayUi {
  private readonly loadingEl: HTMLDivElement;
  private readonly loadingStageEl: HTMLDivElement;
  private readonly loadingBarFillEl: HTMLDivElement;
  private readonly uiRoot: HTMLDivElement;
  private readonly startMenuEl: HTMLDivElement;
  private readonly pauseMenuEl: HTMLDivElement;
  private readonly benchModalEl: HTMLDivElement;
  private readonly benchPreEl: HTMLPreElement;
  private readonly benchStatusEl: HTMLDivElement;
  private readonly benchCopyBtn: HTMLButtonElement;
  private readonly loadedLineEl: HTMLDivElement;
  private readonly hudEl: HTMLDivElement;
  private readonly pauseBadgeEl: HTMLSpanElement;
  private readonly pauseBtnEl: HTMLButtonElement;
  private readonly mapBadgeEl: HTMLSpanElement;
  private readonly lightingBadgeEl: HTMLSpanElement;
  private readonly statsEl: HTMLPreElement;
  private readonly govBtnEl: HTMLButtonElement;

  private lang: LangCode;
  private quality: QualityPreset;
  private lighting: LightingPresetId;
  private mapId: MapLayoutId;
  private governorEnabled = true;
  private totalLoadS = 0;
  private lastBenchText = '';

  constructor(
    parent: HTMLElement,
    initialLang: LangCode,
    initialQuality: QualityPreset,
    initialLighting: LightingPresetId,
    initialMap: MapLayoutId,
    private readonly cb: OverlayCallbacks,
  ) {
    this.lang = initialLang;
    this.quality = initialQuality;
    this.lighting = initialLighting;
    this.mapId = initialMap;

    // Loading screen with real byte progress bar
    this.loadingEl = document.createElement('div');
    this.loadingEl.id = 'loading';
    this.loadingEl.className = 'screen-modal';
    this.loadingStageEl = document.createElement('div');
    this.loadingStageEl.className = 'loading-stage';
    const barTrack = document.createElement('div');
    barTrack.className = 'loading-bar-track';
    this.loadingBarFillEl = document.createElement('div');
    this.loadingBarFillEl.className = 'loading-bar-fill';
    barTrack.appendChild(this.loadingBarFillEl);
    this.loadingEl.innerHTML = `<div class="panel"><h1>${this.str.title}</h1><p class="subtitle">${this.str.loading}</p></div>`;
    this.loadingEl.querySelector('.panel')?.append(barTrack, this.loadingStageEl);
    parent.appendChild(this.loadingEl);

    // Menus container (#ui)
    this.uiRoot = document.createElement('div');
    this.uiRoot.id = 'ui';
    parent.appendChild(this.uiRoot);

    // Start Menu
    this.startMenuEl = document.createElement('div');
    this.startMenuEl.className = 'screen-modal hidden';
    this.uiRoot.appendChild(this.startMenuEl);

    // Pause Menu
    this.pauseMenuEl = document.createElement('div');
    this.pauseMenuEl.className = 'screen-modal hidden';
    this.loadedLineEl = document.createElement('div');
    this.loadedLineEl.className = 'loaded-line';
    this.govBtnEl = document.createElement('button');
    this.uiRoot.appendChild(this.pauseMenuEl);

    // Benchmark Results Modal
    this.benchModalEl = document.createElement('div');
    this.benchModalEl.className = 'screen-modal hidden';
    this.benchPreEl = document.createElement('pre');
    this.benchPreEl.className = 'bench-output';
    this.benchStatusEl = document.createElement('div');
    this.benchStatusEl.className = 'bench-status';
    this.benchCopyBtn = document.createElement('button');
    this.benchCopyBtn.className = 'btn';
    this.benchCopyBtn.addEventListener('click', () => {
      if (!this.lastBenchText) return;
      navigator.clipboard?.writeText(this.lastBenchText).catch(() => undefined);
      this.benchCopyBtn.textContent = this.str.copied;
      window.setTimeout(() => {
        this.benchCopyBtn.textContent = this.str.copy;
      }, 1500);
    });
    const benchCloseBtn = document.createElement('button');
    benchCloseBtn.className = 'btn';
    benchCloseBtn.textContent = this.str.close;
    benchCloseBtn.addEventListener('click', () => this.hideBenchmarkModal());

    const benchPanel = document.createElement('div');
    benchPanel.className = 'panel panel-wide';
    const benchActions = document.createElement('div');
    benchActions.className = 'btn-row';
    benchActions.append(this.benchCopyBtn, benchCloseBtn);
    benchPanel.append(this.benchStatusEl, this.benchPreEl, benchActions);
    this.benchModalEl.appendChild(benchPanel);
    this.uiRoot.appendChild(this.benchModalEl);

    // Minimal HUD (#hud) — title-safe 90%
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'hud';
    this.hudEl.className = 'hidden';
    this.pauseBadgeEl = document.createElement('span');
    this.pauseBadgeEl.className = 'pause-badge hidden';
    this.pauseBtnEl = document.createElement('button');
    this.pauseBtnEl.className = 'hud-btn';
    this.pauseBtnEl.addEventListener('click', () => this.cb.onTogglePause());
    this.mapBadgeEl = document.createElement('span');
    this.mapBadgeEl.className = 'hud-chip';
    this.lightingBadgeEl = document.createElement('span');
    this.lightingBadgeEl.className = 'hud-chip';

    const rotLeft = document.createElement('button');
    rotLeft.className = 'hud-btn';
    rotLeft.textContent = '⟲';
    rotLeft.addEventListener('click', () => this.cb.onRotateCamera(-Math.PI / 6));

    const rotRight = document.createElement('button');
    rotRight.className = 'hud-btn';
    rotRight.textContent = '⟳';
    rotRight.addEventListener('click', () => this.cb.onRotateCamera(Math.PI / 6));

    const menuBtn = document.createElement('button');
    menuBtn.className = 'hud-btn';
    menuBtn.dataset['role'] = 'menuBtn';
    menuBtn.addEventListener('click', () => this.cb.onOpenPauseMenu());

    const topBar = document.createElement('div');
    topBar.className = 'hud-top';
    const leftGroup = document.createElement('div');
    leftGroup.className = 'hud-group';
    leftGroup.append(this.mapBadgeEl, this.lightingBadgeEl, this.pauseBadgeEl);
    const rightGroup = document.createElement('div');
    rightGroup.className = 'hud-group';
    rightGroup.append(rotLeft, rotRight, this.pauseBtnEl, menuBtn);
    topBar.append(leftGroup, rightGroup);

    const hintEl = document.createElement('div');
    hintEl.className = 'hud-hint';
    hintEl.dataset['role'] = 'hint';

    this.hudEl.append(topBar, hintEl);
    parent.appendChild(this.hudEl);

    // F3 Performance Overlay (#stats)
    this.statsEl = document.createElement('pre');
    this.statsEl.id = 'stats';
    this.statsEl.className = 'hidden';
    parent.appendChild(this.statsEl);

    this.rebuildMenus();
  }

  private get str(): Strings {
    return STRINGS[this.lang];
  }

  setLoadingStage(label: string, fraction?: number): void {
    this.loadingStageEl.textContent = label;
    if (fraction !== undefined) {
      const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
      this.loadingBarFillEl.style.width = `${pct}%`;
    }
  }

  setLoadingProgress(loadedBytes: number, totalBytes: number): void {
    const frac = Math.max(0, Math.min(1, loadedBytes / Math.max(1, totalBytes)));
    const pct = Math.round(frac * 100);
    const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
    this.loadingBarFillEl.style.width = `${pct}%`;
    this.loadingStageEl.textContent = `assets ${pct}% · ${loadedMb} / ${totalMb} MB`;
  }

  hideLoading(totalLoadSeconds: number): void {
    this.totalLoadS = totalLoadSeconds;
    this.loadingBarFillEl.style.width = '100%';
    this.loadingEl.classList.add('hidden');
    this.loadedLineEl.textContent = this.str.loadedIn(totalLoadSeconds);
  }

  showStartMenu(): void {
    this.startMenuEl.classList.remove('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.hudEl.classList.add('hidden');
  }

  showGameplay(): void {
    this.startMenuEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
  }

  showPauseMenu(): void {
    this.pauseMenuEl.classList.remove('hidden');
    this.loadedLineEl.textContent = this.str.loadedIn(this.totalLoadS);
  }

  hidePauseMenu(): void {
    this.pauseMenuEl.classList.add('hidden');
  }

  isPauseMenuOpen(): boolean {
    return !this.pauseMenuEl.classList.contains('hidden');
  }

  isStartMenuOpen(): boolean {
    return !this.startMenuEl.classList.contains('hidden');
  }

  showBenchmarkRunning(progressText: string): void {
    this.pauseMenuEl.classList.add('hidden');
    this.benchModalEl.classList.remove('hidden');
    this.benchStatusEl.textContent = `${this.str.benchmarkRunning} ${progressText}`;
    this.benchPreEl.textContent = '';
    this.benchCopyBtn.disabled = true;
  }

  showBenchmarkResult(tableText: string): void {
    this.lastBenchText = tableText;
    this.benchModalEl.classList.remove('hidden');
    this.benchStatusEl.textContent = this.str.benchmark;
    this.benchPreEl.textContent = tableText;
    this.benchCopyBtn.disabled = false;
    this.benchCopyBtn.textContent = this.str.copy;
  }

  hideBenchmarkModal(): void {
    this.benchModalEl.classList.add('hidden');
  }

  toggleStatsOverlay(): void {
    this.statsEl.classList.toggle('hidden');
  }

  setStatsVisible(visible: boolean): void {
    this.statsEl.classList.toggle('hidden', !visible);
  }

  setPaused(paused: boolean): void {
    this.pauseBadgeEl.classList.toggle('hidden', !paused);
    this.pauseBadgeEl.textContent = this.str.pausedBadge;
    this.pauseBtnEl.textContent = paused ? this.str.playBtn : this.str.pauseBtn;
  }

  setLighting(preset: LightingPresetId): void {
    this.lighting = preset;
    this.lightingBadgeEl.textContent = this.str.lightingNames[preset];
    this.rebuildMenus();
  }

  setGovernorEnabled(enabled: boolean): void {
    this.governorEnabled = enabled;
    this.govBtnEl.textContent = `${this.str.governorLabel}: ${enabled ? this.str.on : this.str.off}`;
  }

  setLang(lang: LangCode): void {
    this.lang = lang;
    this.rebuildMenus();
  }

  updateStats(s: PerfSnapshot): void {
    if (this.statsEl.classList.contains('hidden')) return;
    const scalePct = Math.round(s.renderScale * 100);
    const lines = [
      `${s.fps.toFixed(0)} fps (${s.frameMs.toFixed(1)} ms) · ${s.backend} · ${s.quality.toUpperCase()} · ${s.toneMapping.toUpperCase()}`,
      `gov: ${s.governorEnabled ? s.governorLabel : 'OFF'} · scale ${scalePct}% · EV100 ${s.ev100.toFixed(2)} (${s.lightingPreset})`,
      `calls ${s.drawCalls} · tris ${(s.triangles / 1000).toFixed(1)}k · sim ${s.simTimeS.toFixed(1)}s${s.paused ? ' [PAUSED]' : ''}`,
      `CPU ms: ${s.cpuSummary || 'n/a'}`,
      s.gpuSummary || 'GPU ms: n/a (no timestamp queries)',
    ];
    this.statsEl.textContent = lines.join('\n');
  }

  private rebuildMenus(): void {
    const s = this.str;
    const mapLabel = MAP_LABELS[this.lang][this.mapId];
    const mapPrefix = this.lang === 'pl' ? 'Mapa' : 'Map';
    this.mapBadgeEl.textContent = mapLabel;
    this.lightingBadgeEl.textContent = s.lightingNames[this.lighting];
    const menuBtn = this.hudEl.querySelector<HTMLButtonElement>('[data-role="menuBtn"]');
    if (menuBtn) menuBtn.textContent = s.menuBtn;
    const hintEl = this.hudEl.querySelector<HTMLDivElement>('[data-role="hint"]');
    if (hintEl) hintEl.textContent = s.controlsHint;
    this.benchCopyBtn.textContent = s.copy;

    const cycleMap = (): void => {
      const idx = (ALL_MAP_IDS.indexOf(this.mapId) + 1) % ALL_MAP_IDS.length;
      this.cb.onChangeMap(ALL_MAP_IDS[idx] ?? 'crossing');
    };

    // Start menu DOM
    this.startMenuEl.innerHTML = '';
    const startPanel = document.createElement('div');
    startPanel.className = 'panel';
    const h1 = document.createElement('h1');
    h1.textContent = s.title;
    const sub = document.createElement('p');
    sub.className = 'subtitle';
    sub.textContent = s.subtitle;

    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-primary';
    playBtn.textContent = s.play;
    playBtn.addEventListener('click', () => this.cb.onStartPlay());

    const startMapBtn = document.createElement('button');
    startMapBtn.className = 'btn';
    startMapBtn.textContent = `${mapPrefix}: ${mapLabel}`;
    startMapBtn.addEventListener('click', cycleMap);

    const qBtn = document.createElement('button');
    qBtn.className = 'btn';
    qBtn.textContent = `${s.qualityLabel}: ${qualityLabel(s, this.quality)}`;
    qBtn.addEventListener('click', () => {
      const next: QualityPreset = this.quality === 'high' ? 'low' : 'high';
      this.cb.onChangeQuality(next);
    });

    const langBtn = document.createElement('button');
    langBtn.className = 'btn';
    langBtn.textContent = `${s.langLabel}: ${this.lang.toUpperCase()}`;
    langBtn.addEventListener('click', () => {
      this.cb.onChangeLang(this.lang === 'en' ? 'pl' : 'en');
    });

    startPanel.append(h1, sub, playBtn, startMapBtn, qBtn, langBtn);
    this.startMenuEl.appendChild(startPanel);

    // Pause menu DOM
    this.pauseMenuEl.innerHTML = '';
    const pausePanel = document.createElement('div');
    pausePanel.className = 'panel';
    const ph = document.createElement('h2');
    ph.textContent = s.title;

    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'btn btn-primary';
    resumeBtn.textContent = s.resume;
    resumeBtn.addEventListener('click', () => this.cb.onResume());

    const pauseMapBtn = document.createElement('button');
    pauseMapBtn.className = 'btn';
    pauseMapBtn.textContent = `${mapPrefix}: ${mapLabel}`;
    pauseMapBtn.addEventListener('click', cycleMap);

    const benchBtn = document.createElement('button');
    benchBtn.className = 'btn';
    benchBtn.textContent = s.benchmark;
    benchBtn.addEventListener('click', () => this.cb.onRunBenchmark());

    const lightBtn = document.createElement('button');
    lightBtn.className = 'btn';
    lightBtn.textContent = `${s.lightingLabel}: ${s.lightingNames[this.lighting]}`;
    lightBtn.addEventListener('click', () => {
      const idx = (LIGHTING_ORDER.indexOf(this.lighting) + 1) % LIGHTING_ORDER.length;
      const next = LIGHTING_ORDER[idx] ?? 'clearNoon';
      this.cb.onChangeLighting(next);
    });

    this.govBtnEl.className = 'btn';
    this.govBtnEl.textContent = `${s.governorLabel}: ${this.governorEnabled ? s.on : s.off}`;
    this.govBtnEl.onclick = () => this.cb.onToggleGovernor(!this.governorEnabled);

    const pLangBtn = document.createElement('button');
    pLangBtn.className = 'btn';
    pLangBtn.textContent = `${s.langLabel}: ${this.lang.toUpperCase()}`;
    pLangBtn.addEventListener('click', () => this.cb.onChangeLang(this.lang === 'en' ? 'pl' : 'en'));

    this.loadedLineEl.textContent = s.loadedIn(this.totalLoadS);
    pausePanel.append(ph, resumeBtn, pauseMapBtn, benchBtn, lightBtn, this.govBtnEl, pLangBtn, this.loadedLineEl);
    this.pauseMenuEl.appendChild(pausePanel);
  }
}
