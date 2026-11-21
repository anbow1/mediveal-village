// Stage 6 Complete Bilingual Medieval RTS HUD, Minimap, Menus, Campaign & End-Screen Charts.
// All DOM lives cleanly inside #loading, #ui, #hud, and #stats (title-safe & mobile-landscape responsive).

import {
  ALL_GOODS,
  ALL_UNIT_TYPES,
  BUILDING_DEFS,
  CAMPAIGN,
  ECONOMY,
  EQUIPMENT_GOODS,
  GOOD_TO_WORKSHOP,
  GOOD_VALUE_GOLD,
  isEquipmentWorkshop,
  TRANSPORT_LEVELS,
  UNIT_DEFS,
  WORLD,
  type BuildingBranch,
  type BuildingTypeId,
  type GoodId,
  type LangCode,
  type LightingPresetId,
  type QualityPreset,
  type ResourceMap,
  type UnitTypeId,
} from '../config.ts';
import type { PlacementTool } from '../app/input.ts';
import { countAliveSoldiers, countSideArmyMen, getArmyCap } from '../sim/combat.ts';
import { inspectBuildingUpgrade, inspectRegimentReinforce, inspectTransportUpgrade } from '../sim/commands.ts';
import { computeProductionRates, countFoodRationsInStock, countPopulation, listBottlenecks } from '../sim/economy.ts';
import { ALL_MAP_IDS } from '../sim/maps.ts';
import type { TerrainField, MapLayoutId } from '../sim/terrain.ts';
import type {
  AiPersonality,
  BuildingEntity,
  CampaignMissionId,
  Difficulty,
  FormationKind,
  GameMode,
  PlacementRejectionReason,
  RegimentEntity,
  SimCommand,
  SimWorldState,
  StanceKind,
} from '../sim/types.ts';
import { listSaveSlots, loadCampaignProgress } from './campaignStore.ts';
import { qualityLabel, STRINGS, type Strings } from './strings.ts';

export interface HudCallbacks {
  readonly onLaunchGame: (cfg: {
    mode: GameMode;
    mapId: MapLayoutId;
    difficulty: Difficulty;
    aiPersonality: AiPersonality;
    missionId?: CampaignMissionId;
    showcaseMode?: boolean;
  }) => void;
  readonly onResume: () => void;
  readonly onRestart: () => void;
  readonly onTogglePause: () => void;
  readonly onSetSpeed: (speed: 0.5 | 1 | 2) => void;
  readonly onOpenPauseMenu: () => void;
  readonly onRunBenchmark: () => void;
  readonly onRotateCamera: (deltaYawRad: number) => void;
  readonly onJumpCamera: (x: number, z: number) => void;
  readonly onMinimapOrder: (x: number, z: number) => void;
  readonly onChangeLighting: (preset: LightingPresetId) => void;
  readonly onToggleGovernor: (enabled: boolean) => void;
  readonly onChangeQuality: (quality: QualityPreset) => void;
  readonly onChangeLang: (lang: LangCode) => void;
  readonly onChangeVolume: (vol01: number) => void;
  readonly onExecute: (cmd: SimCommand) => boolean;
  readonly onSelectTool: (tool: PlacementTool) => void;
  readonly onRotatePlacement: () => void;
  readonly onSelectRegiment: (id: number, additive: boolean, jump: boolean) => void;
  readonly onSaveSlot: (slot: 1 | 2 | 3) => void;
  readonly onLoadSlot: (slot: 1 | 2 | 3) => void;
  readonly onExportSave: () => void;
  readonly onImportSave: (json: string) => void;
  readonly onNextMission: () => void;
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
const BUILD_BRANCHES: readonly BuildingBranch[] = ['town', 'materials', 'food', 'craft', 'military'];
const MARKET_GOODS: readonly GoodId[] = ALL_GOODS.filter((g) => g !== 'gold');
const RANK_CHOICES: readonly number[] = [1, 2, 3, 4, 6];

const GOOD_ICONS: Record<GoodId, string> = {
  gold: '🪙',
  timber: '🪵',
  planks: '🪚',
  stone: '🪨',
  grain: '🌾',
  flour: '🥡',
  bread: '🍞',
  fish: '🐟',
  meat: '🥩',
  sausages: '🌭',
  grapes: '🍇',
  wine: '🍷',
  ale: '🍺',
  hides: '🦌',
  leatherArmour: '🦺',
  ironOre: '⛏',
  iron: '🔩',
  weapons: '⚔',
  mail: '🛡',
  bows: '🏹',
  horses: '🐎',
};

const UNIT_ICONS: Record<UnitTypeId, string> = {
  militia: '🪓',
  pikemen: '🔱',
  archers: '🏹',
  swordsmen: '⚔',
  halberdiers: '⚜',
  crossbowmen: '🎯',
  lightCav: '🐎',
  heavyCav: '🏇',
  cannon: '💣',
  mortar: '☄',
};

const EQUIP_ORDER_UNITS: readonly UnitTypeId[] = [
  'pikemen',
  'archers',
  'swordsmen',
  'halberdiers',
  'crossbowmen',
  'lightCav',
  'heavyCav',
];

function formatCostShort(cost: ResourceMap): string {
  const abbr: Partial<Record<GoodId, string>> = {
    gold: 'g',
    timber: 't',
    planks: 'pl',
    stone: 's',
    weapons: 'wpn',
    leatherArmour: 'lea',
    mail: 'ml',
    bows: 'bw',
    horses: 'hr',
    iron: 'ir',
  };
  const parts: string[] = [];
  for (const k of Object.keys(cost) as GoodId[]) {
    const v = cost[k];
    if (v && v > 0) parts.push(`${v}${abbr[k] ?? k}`);
  }
  return parts.join(' ');
}

function unitAbbr(u: UnitTypeId): string {
  switch (u) {
    case 'militia': return 'MIL';
    case 'pikemen': return 'PIK';
    case 'archers': return 'ARC';
    case 'swordsmen': return 'SWD';
    case 'halberdiers': return 'HLB';
    case 'crossbowmen': return 'XBW';
    case 'lightCav': return 'LCV';
    case 'heavyCav': return 'HCV';
    case 'cannon': return 'CNN';
    case 'mortar': return 'MRT';
  }
}

export class GameHud {
  private readonly loadingEl: HTMLDivElement;
  private readonly loadingStageEl: HTMLDivElement;
  private readonly loadingBarFillEl: HTMLDivElement;

  private readonly uiRoot: HTMLDivElement;
  private readonly startMenuEl: HTMLDivElement;
  private readonly pauseMenuEl: HTMLDivElement;
  private readonly endModalEl: HTMLDivElement;
  private readonly benchModalEl: HTMLDivElement;
  private readonly benchPreEl: HTMLPreElement;
  private readonly benchStatusEl: HTMLDivElement;
  private readonly benchCopyBtn: HTMLButtonElement;

  private readonly hudEl: HTMLDivElement;
  private readonly resBarEl: HTMLDivElement;
  private readonly objStripEl: HTMLDivElement;
  private readonly speedBarEl: HTMLDivElement;
  private readonly pauseBadgeEl: HTMLSpanElement;
  private readonly drawerEl: HTMLDivElement;
  private readonly drawerBodyEl: HTMLDivElement;
  private readonly alertsEl: HTMLDivElement;
  private readonly inspectorEl: HTMLDivElement;
  private readonly regStripEl: HTMLDivElement;
  private readonly minimapCanvas: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly hoverTipEl: HTMLDivElement;
  private readonly statsEl: HTMLPreElement;

  private minimapBase: ImageData | null = null;
  private minimapMapId: MapLayoutId | null = null;
  private minimapDragging = false;

  private lang: LangCode;
  private quality: QualityPreset;
  private lighting: LightingPresetId;
  private mapId: MapLayoutId;
  private volume = 0.65;
  private governorEnabled = true;
  private totalLoadS = 0;
  private lastBenchText = '';
  private simSpeed: 0.5 | 1 | 2 = 1;
  private paused = false;

  // Start menu sub-view state
  private menuView: 'home' | 'campaign' | 'skirmish' | 'defence' = 'home';
  private selMap: MapLayoutId;
  private selDiff: Difficulty = 'normal';
  private selPers: AiPersonality = 'raider';
  private selMission: CampaignMissionId = 1;

  // Gameplay HUD interactive tab state
  private activeTab: 'build' | 'recruit' | 'production' | 'buildings' | null = 'build';
  private activeBranch: BuildingBranch = 'town';
  private activeTool: PlacementTool = null;
  private showResLabels = false;
  private lastHudRefreshMs = 0;
  private lastDrawerRefreshMs = 0;
  private lastInspectorSig = '';
  private buildingJumpCursor = 0;
  private lastEndShown = false;

  // Latest snapshot refs for button handlers
  private latestState: SimWorldState | null = null;
  private latestSelectedRegs: ReadonlySet<number> = new Set();
  private latestSelectedBld: number | null = null;
  private latestGroups: ReadonlyMap<number, number[]> = new Map();

  constructor(
    parent: HTMLElement,
    initialLang: LangCode,
    initialQuality: QualityPreset,
    initialLighting: LightingPresetId,
    initialMap: MapLayoutId,
    initialVolume: number,
    private readonly cb: HudCallbacks,
  ) {
    this.lang = initialLang;
    this.quality = initialQuality;
    this.lighting = initialLighting;
    this.mapId = initialMap;
    this.selMap = initialMap;
    this.volume = initialVolume;

    // 1. Loading Screen
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

    // 2. Menus Root (#ui)
    this.uiRoot = document.createElement('div');
    this.uiRoot.id = 'ui';
    parent.appendChild(this.uiRoot);

    this.startMenuEl = document.createElement('div');
    this.startMenuEl.className = 'screen-modal hidden';
    this.pauseMenuEl = document.createElement('div');
    this.pauseMenuEl.className = 'screen-modal hidden';
    this.endModalEl = document.createElement('div');
    this.endModalEl.className = 'screen-modal hidden';
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
    const benchClose = document.createElement('button');
    benchClose.className = 'btn';
    benchClose.textContent = this.str.close;
    benchClose.addEventListener('click', () => this.hideBenchmarkModal());
    const benchPanel = document.createElement('div');
    benchPanel.className = 'panel panel-wide';
    const benchRow = document.createElement('div');
    benchRow.className = 'btn-row';
    benchRow.append(this.benchCopyBtn, benchClose);
    benchPanel.append(this.benchStatusEl, this.benchPreEl, benchRow);
    this.benchModalEl.appendChild(benchPanel);
    this.uiRoot.append(this.startMenuEl, this.pauseMenuEl, this.endModalEl, this.benchModalEl);

    // 3. Gameplay HUD (#hud) — strictly title-safe!
    this.hudEl = document.createElement('div');
    this.hudEl.id = 'hud';
    this.hudEl.className = 'hidden';

    // Top bar: Resources | Objective | Speed & Pause & Menu
    const topBar = document.createElement('div');
    topBar.className = 'hud-top rts-top-bar';
    this.resBarEl = document.createElement('div');
    this.resBarEl.className = 'rts-res-bar';
    this.objStripEl = document.createElement('div');
    this.objStripEl.className = 'rts-obj-strip';
    this.pauseBadgeEl = document.createElement('span');
    this.pauseBadgeEl.className = 'pause-badge hidden';
    this.speedBarEl = document.createElement('div');
    this.speedBarEl.className = 'hud-group rts-speed-bar';
    topBar.append(this.resBarEl, this.objStripEl, this.pauseBadgeEl, this.speedBarEl);

    // Middle row: Left Command Drawer + Right Alerts
    const midRow = document.createElement('div');
    midRow.className = 'rts-mid-row';

    this.drawerEl = document.createElement('div');
    this.drawerEl.className = 'rts-drawer';
    this.drawerBodyEl = document.createElement('div');
    this.drawerBodyEl.className = 'rts-drawer-body';
    this.drawerEl.appendChild(this.drawerBodyEl);

    this.alertsEl = document.createElement('div');
    this.alertsEl.className = 'rts-alerts';

    midRow.append(this.drawerEl, this.alertsEl);

    // Bottom row: Inspector + Regiment Cards + Sunlit Minimap
    const botRow = document.createElement('div');
    botRow.className = 'rts-bot-row';

    const botCenter = document.createElement('div');
    botCenter.className = 'rts-bot-center';
    this.inspectorEl = document.createElement('div');
    this.inspectorEl.className = 'rts-inspector hidden';
    this.regStripEl = document.createElement('div');
    this.regStripEl.className = 'rts-reg-strip';
    botCenter.append(this.inspectorEl, this.regStripEl);

    const minimapWrap = document.createElement('div');
    minimapWrap.className = 'rts-minimap-wrap';
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = 160;
    this.minimapCanvas.height = 160;
    this.minimapCanvas.className = 'rts-minimap';
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    minimapWrap.appendChild(this.minimapCanvas);

    botRow.append(botCenter, minimapWrap);

    this.hoverTipEl = document.createElement('div');
    this.hoverTipEl.className = 'rts-hover-tip hidden';

    this.hudEl.append(topBar, midRow, botRow, this.hoverTipEl);
    parent.appendChild(this.hudEl);

    // 4. F3 Performance Stats (#stats)
    this.statsEl = document.createElement('pre');
    this.statsEl.id = 'stats';
    this.statsEl.className = 'hidden';
    parent.appendChild(this.statsEl);

    this.attachMinimapEvents();
    this.rebuildTopControls();
    this.rebuildDrawer();
    this.rebuildMenus();
  }

  private get str(): Strings {
    return STRINGS[this.lang];
  }

  private attachMinimapEvents(): void {
    const toWorld = (e: MouseEvent): { x: number; z: number } => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
      return {
        x: (u - 0.5) * WORLD.sizeM,
        z: (v - 0.5) * WORLD.sizeM,
      };
    };
    this.minimapCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.minimapCanvas.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const pt = toWorld(e);
      if (e.button === 0) {
        this.minimapDragging = true;
        this.cb.onJumpCamera(pt.x, pt.z);
      } else if (e.button === 2) {
        this.cb.onMinimapOrder(pt.x, pt.z);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.minimapDragging) return;
      const pt = toWorld(e);
      this.cb.onJumpCamera(pt.x, pt.z);
    });
    window.addEventListener('mouseup', () => {
      this.minimapDragging = false;
    });
  }

  /** Pre-bakes a crisp sunlit hillshaded parchment-terrain minimap bitmap once per map! */
  bakeMinimapBase(terrain: TerrainField, state: SimWorldState): void {
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const img = this.minimapCtx.createImageData(w, h);
    const d = img.data;
    const sunX = -0.62;
    const sunY = 0.62;
    const sunZ = -0.48;

    for (let py = 0; py < h; py++) {
      const wz = ((py + 0.5) / h - 0.5) * WORLD.sizeM;
      for (let px = 0; px < w; px++) {
        const wx = ((px + 0.5) / w - 0.5) * WORLD.sizeM;
        const idx = (py * w + px) * 4;
        const depth = terrain.waterDepthAt(wx, wz);
        if (depth > 0.05) {
          const deep = Math.min(1, depth / 1.4);
          d[idx + 0] = Math.round(52 - deep * 24);
          d[idx + 1] = Math.round(92 - deep * 30);
          d[idx + 2] = Math.round(124 - deep * 20);
          d[idx + 3] = 255;
          continue;
        }
        const n = terrain.normalAt(wx, wz, 2.0);
        const shade = Math.max(0.52, Math.min(1.22, n.x * sunX + n.y * sunY + n.z * sunZ + 0.35));
        const elev = terrain.heightAt(wx, wz);
        let r = 98;
        let g = 114;
        let b = 68;
        if (elev > 10 || terrain.slopeAt(wx, wz) > 0.22) {
          r = 122;
          g = 114;
          b = 102;
        } else if (elev > 5.5) {
          r = 114;
          g = 116;
          b = 76;
        }
        d[idx + 0] = Math.max(0, Math.min(255, Math.round(r * shade)));
        d[idx + 1] = Math.max(0, Math.min(255, Math.round(g * shade)));
        d[idx + 2] = Math.max(0, Math.min(255, Math.round(b * shade)));
        d[idx + 3] = 255;
      }
    }

    // Stamp dense mature forests clearly onto minimap base bitmap
    for (const tr of state.trees) {
      if (tr.state !== 'mature') continue;
      const px = Math.floor(((tr.x / WORLD.sizeM) + 0.5) * w);
      const py = Math.floor(((tr.z / WORLD.sizeM) + 0.5) * h);
      for (let oy = 0; oy <= 1; oy++) {
        for (let ox = 0; ox <= 1; ox++) {
          const tx = px + ox;
          const ty = py + oy;
          if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
          const idx = (ty * w + tx) * 4;
          d[idx + 0] = Math.round(d[idx + 0]! * 0.52);
          d[idx + 1] = Math.round(d[idx + 1]! * 0.72);
          d[idx + 2] = Math.round(d[idx + 2]! * 0.48);
        }
      }
    }

    this.minimapBase = img;
    this.minimapMapId = state.mapId;
  }

  private renderMinimap(state: SimWorldState, camX: number, camZ: number): void {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    if (this.minimapBase) {
      ctx.putImageData(this.minimapBase, 0, 0);
    } else {
      ctx.fillStyle = '#2d3524';
      ctx.fillRect(0, 0, w, h);
    }

    const toPx = (x: number): number => ((x / WORLD.sizeM) + 0.5) * w;
    const toPy = (z: number): number => ((z / WORLD.sizeM) + 0.5) * h;

    // Roads
    ctx.strokeStyle = 'rgba(196, 174, 132, 0.72)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const rd of state.roads) {
      ctx.moveTo(toPx(rd.x0), toPy(rd.z0));
      ctx.lineTo(toPx(rd.x1), toPy(rd.z1));
    }
    ctx.stroke();

    // Stone (pale silver-grey diamond) & Iron Ore (rust-copper diamond) resource outcrops
    for (const oc of state.outcrops) {
      const ox = toPx(oc.x);
      const oy = toPy(oc.z);
      const r = 4.2;
      ctx.beginPath();
      ctx.moveTo(ox, oy - r);
      ctx.lineTo(ox + r, oy);
      ctx.lineTo(ox, oy + r);
      ctx.lineTo(ox - r, oy);
      ctx.closePath();
      ctx.fillStyle = oc.kind === 'stone' ? '#e4e8ec' : '#e0803a';
      ctx.fill();
      ctx.strokeStyle = '#181613';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Walls
    ctx.fillStyle = '#c8c3b8';
    for (const wl of state.walls) {
      if (wl.destroyed) continue;
      ctx.fillRect(toPx(wl.x) - 1, toPy(wl.z) - 1, 2, 2);
    }

    // Capture points
    for (const cp of state.capturePoints) {
      ctx.strokeStyle = cp.owner === 0 ? '#4d8ef7' : cp.owner === 1 ? '#e04848' : '#e6bd53';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(toPx(cp.x), toPy(cp.z), 4.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Buildings
    for (const b of state.buildings) {
      if (b.hp <= 0) continue;
      ctx.fillStyle = b.type === 'ruin' ? '#8c867c' : b.side === 0 ? '#3f84f5' : '#d94343';
      const sz = b.type === 'keep' ? 5 : 3;
      ctx.fillRect(toPx(b.x) - sz * 0.5, toPy(b.z) - sz * 0.5, sz, sz);
    }

    // Regiments
    for (const r of state.regiments) {
      if (countAliveSoldiers(r) === 0) continue;
      ctx.fillStyle = r.routing ? '#f5f0e0' : r.side === 0 ? '#78b0ff' : '#ff6868';
      ctx.beginPath();
      ctx.arc(toPx(r.x), toPy(r.z), this.latestSelectedRegs.has(r.id) ? 3.2 : 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Camera reticle box
    const cx = toPx(camX);
    const cy = toPy(camZ);
    ctx.strokeStyle = '#f5e6c4';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(cx - 11, cy - 8, 22, 16);
  }

  setLoadingStage(label: string, fraction?: number): void {
    this.loadingStageEl.textContent = label;
    if (fraction !== undefined) {
      this.loadingBarFillEl.style.width = `${Math.max(0, Math.min(100, Math.round(fraction * 100)))}%`;
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
  }

  showStartMenu(): void {
    this.menuView = 'home';
    this.rebuildMenus();
    this.startMenuEl.classList.remove('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.endModalEl.classList.add('hidden');
    this.hudEl.classList.add('hidden');
  }

  showGameplay(): void {
    this.startMenuEl.classList.add('hidden');
    this.pauseMenuEl.classList.add('hidden');
    this.endModalEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
    this.lastEndShown = false;
  }

  showPauseMenu(): void {
    this.rebuildMenus();
    this.pauseMenuEl.classList.remove('hidden');
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
    this.paused = paused;
    this.pauseBadgeEl.classList.toggle('hidden', !paused);
    this.pauseBadgeEl.textContent = this.str.pausedBadge;
    this.rebuildTopControls();
  }

  setSpeed(speed: 0.5 | 1 | 2): void {
    this.simSpeed = speed;
    this.rebuildTopControls();
  }

  setActiveTool(tool: PlacementTool): void {
    this.activeTool = tool;
    this.rebuildDrawer();
    if (this.latestState) this.refreshInspector(true);
  }

  private buildBarracksEquipPanel(state: SimWorldState): HTMLDivElement {
    const s = this.str;
    const wrap = document.createElement('div');
    wrap.className = 'insp-equip-panel';

    const title = document.createElement('div');
    title.className = 'rts-sec-title';
    title.textContent = s.orderEquipTitle;
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'insp-equip-grid';
    for (const uId of EQUIP_ORDER_UNITS) {
      const def = UNIT_DEFS[uId];
      const eqParts: string[] = [];
      for (const g of EQUIPMENT_GOODS) {
        const amt = def.cost[g] ?? 0;
        if (amt > 0) eqParts.push(`${GOOD_ICONS[g]}${amt}`);
      }
      const btn = document.createElement('button');
      btn.className = 'insp-equip-btn';
      btn.setAttribute('data-order-equip', uId);
      btn.title = `${s.units[uId]} (${eqParts.join(' ')})`;
      btn.innerHTML =
        `<span class="eq-icon">${UNIT_ICONS[uId]}</span>` +
        `<span class="eq-name">${s.units[uId]}</span>` +
        `<small class="eq-cost">${eqParts.join(' ')}</small>`;
      btn.addEventListener('click', () => {
        this.cb.onExecute({ type: 'orderUnitEquipment', side: 0, unitType: uId });
        this.refreshInspector(true);
        if (this.activeTab === 'recruit') this.rebuildDrawer(true);
      });
      grid.appendChild(btn);
    }
    wrap.appendChild(grid);

    const sumRow = document.createElement('div');
    sumRow.className = 'insp-orders-summary';
    const lbl = document.createElement('span');
    lbl.className = 'insp-inline-lbl';
    lbl.textContent = `${s.ordersLabel}:`;
    sumRow.appendChild(lbl);

    let totalAll = 0;
    for (const g of EQUIPMENT_GOODS) {
      const wType = GOOD_TO_WORKSHOP[g];
      const shopOrders = wType
        ? state.buildings
            .filter((x) => x.side === 0 && x.hp > 0 && x.type === wType)
            .reduce((sum, x) => sum + (x.pendingOrders ?? 0), 0)
        : 0;
      const queued = state.sides[0].equipmentOrders?.[g] ?? 0;
      const tot = shopOrders + queued;
      totalAll += tot;
      const chip = document.createElement('span');
      chip.className = `eq-order-chip ${tot > 0 ? 'active' : ''}`;
      chip.title = `${s.goods[g]}: ${tot}`;
      chip.innerHTML = `${GOOD_ICONS[g]} ${s.goods[g]}: <strong>${tot}</strong>`;
      sumRow.appendChild(chip);
    }

    if (totalAll > 0) {
      const clr = document.createElement('button');
      clr.className = 'insp-btn danger';
      clr.setAttribute('data-clear-orders', '1');
      clr.textContent = `✕ ${s.clearOrdersBtn}`;
      clr.addEventListener('click', () => {
        this.cb.onExecute({ type: 'setBuildingOrder', side: 0, buildingId: -1, orders: 0 });
        this.refreshInspector(true);
        if (this.activeTab === 'recruit') this.rebuildDrawer(true);
      });
      sumRow.appendChild(clr);
    }
    wrap.appendChild(sumRow);
    return wrap;
  }

  setPlacementHover(reason: PlacementRejectionReason | null, screenX: number, screenY: number): void {
    if (!reason || !this.activeTool) {
      this.hoverTipEl.classList.add('hidden');
      return;
    }
    this.hoverTipEl.classList.remove('hidden');
    this.hoverTipEl.style.left = `${Math.min(window.innerWidth - 210, screenX + 16)}px`;
    this.hoverTipEl.style.top = `${Math.max(48, screenY - 26)}px`;
    const ok = reason === 'ok';
    this.hoverTipEl.className = `rts-hover-tip ${ok ? 'ok' : 'bad'}`;
    this.hoverTipEl.textContent = ok
      ? `${this.str.placementReasons.ok} · ${this.str.rotateHint}`
      : this.str.placementReasons[reason];
  }

  setLighting(preset: LightingPresetId): void {
    this.lighting = preset;
    this.rebuildMenus();
  }

  setGovernorEnabled(enabled: boolean): void {
    this.governorEnabled = enabled;
    this.rebuildMenus();
  }

  setLang(lang: LangCode): void {
    this.lang = lang;
    this.rebuildTopControls();
    this.rebuildDrawer();
    this.rebuildMenus();
    if (this.latestState) this.refreshInspector();
  }

  setMap(mapId: MapLayoutId): void {
    this.mapId = mapId;
    this.selMap = mapId;
    this.minimapMapId = null;
  }

  private rebuildTopControls(): void {
    const s = this.str;
    this.speedBarEl.innerHTML = '';

    const speeds: readonly (0.5 | 1 | 2)[] = [0.5, 1, 2];
    for (const sp of speeds) {
      const b = document.createElement('button');
      b.className = `hud-btn hud-btn-sm ${!this.paused && this.simSpeed === sp ? 'active' : ''}`;
      b.textContent = `${sp}×`;
      b.addEventListener('click', () => this.cb.onSetSpeed(sp));
      this.speedBarEl.appendChild(b);
    }

    const pauseBtn = document.createElement('button');
    pauseBtn.className = `hud-btn hud-btn-sm ${this.paused ? 'active' : ''}`;
    pauseBtn.textContent = this.paused ? `▶ ${s.playBtn}` : `❚❚ ${s.pauseBtn}`;
    pauseBtn.addEventListener('click', () => this.cb.onTogglePause());

    const rotL = document.createElement('button');
    rotL.className = 'hud-btn hud-btn-sm';
    rotL.textContent = '⟲';
    rotL.addEventListener('click', () => this.cb.onRotateCamera(-Math.PI / 6));

    const rotR = document.createElement('button');
    rotR.className = 'hud-btn hud-btn-sm';
    rotR.textContent = '⟳';
    rotR.addEventListener('click', () => this.cb.onRotateCamera(Math.PI / 6));

    const aaBtn = document.createElement('button');
    aaBtn.className = `hud-btn hud-btn-sm ${this.showResLabels ? 'active' : ''}`;
    aaBtn.textContent = 'Aa';
    aaBtn.title = this.lang === 'pl' ? 'Pokaż/ukryj nazwy towarów' : 'Toggle resource names';
    aaBtn.addEventListener('click', () => {
      this.showResLabels = !this.showResLabels;
      this.rebuildTopControls();
      this.lastHudRefreshMs = 0;
    });

    const langBtn = document.createElement('button');
    langBtn.className = 'hud-btn hud-btn-sm';
    langBtn.textContent = this.lang.toUpperCase();
    langBtn.addEventListener('click', () => this.cb.onChangeLang(this.lang === 'pl' ? 'en' : 'pl'));

    const menuBtn = document.createElement('button');
    menuBtn.className = 'hud-btn hud-btn-sm';
    menuBtn.textContent = s.menuBtn;
    menuBtn.addEventListener('click', () => this.cb.onOpenPauseMenu());

    this.speedBarEl.append(pauseBtn, rotL, rotR, aaBtn, langBtn, menuBtn);
  }

  private rebuildDrawer(bodyOnly = false): void {
    const s = this.str;
    // Tab header row (kept persistent when bodyOnly === true so tab clicks NEVER get swallowed by background refresh!)
    let tabBar = this.drawerEl.querySelector('.rts-tab-bar') as HTMLDivElement | null;
    if (!tabBar) {
      tabBar = document.createElement('div');
      tabBar.className = 'rts-tab-bar';
      this.drawerEl.insertBefore(tabBar, this.drawerBodyEl);
    }

    if (!bodyOnly || tabBar.children.length === 0) {
      tabBar.innerHTML = '';
      const tabBuildingsLabel = this.lang === 'pl' ? 'Budynki' : 'Buildings';
      const tabs: readonly { id: 'build' | 'recruit' | 'production' | 'buildings'; label: string }[] = [
        { id: 'build', label: s.tabBuild },
        { id: 'recruit', label: s.tabRecruit },
        { id: 'production', label: s.tabProduction },
        { id: 'buildings', label: tabBuildingsLabel },
      ];
      for (const t of tabs) {
        const btn = document.createElement('button');
        btn.className = `rts-tab-btn ${this.activeTab === t.id ? 'active' : ''}`;
        btn.setAttribute('data-tab', t.id);
        btn.textContent = t.label;
        btn.addEventListener('click', () => {
          this.activeTab = this.activeTab === t.id ? null : t.id;
          this.rebuildDrawer(false);
        });
        tabBar.appendChild(btn);
      }

      if (this.activeTool) {
        const rotBtn = document.createElement('button');
        rotBtn.className = 'rts-tab-btn';
        rotBtn.textContent = '↻ R';
        rotBtn.addEventListener('click', () => this.cb.onRotatePlacement());
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'rts-tab-btn bad';
        cancelBtn.textContent = `✕ ${s.cancelTool}`;
        cancelBtn.addEventListener('click', () => this.cb.onSelectTool(null));
        tabBar.append(rotBtn, cancelBtn);
      }
    }

    this.drawerBodyEl.classList.toggle('hidden', this.activeTab === null);
    this.drawerBodyEl.innerHTML = '';
    if (this.activeTab === null) return;

    if (this.activeTab === 'build') {
      // Branch selector pills
      const brRow = document.createElement('div');
      brRow.className = 'rts-branch-row';
      for (const br of BUILD_BRANCHES) {
        const b = document.createElement('button');
        b.className = `rts-pill ${this.activeBranch === br ? 'active' : ''}`;
        b.setAttribute('data-branch', br);
        b.textContent = s.branchNames[br];
        b.addEventListener('click', () => {
          this.activeBranch = br;
          this.rebuildDrawer(false);
        });
        brRow.appendChild(b);
      }
      this.drawerBodyEl.appendChild(brRow);

      // Quick Road / Wall / Gate strip
      const infraRow = document.createElement('div');
      infraRow.className = 'rts-infra-row';
      const infraItems: readonly { label: string; cost: string; tool: PlacementTool }[] = [
        { label: s.toolRoad, cost: '2s/10m', tool: { kind: 'road' } },
        { label: s.toolWall, cost: '15s/10m', tool: { kind: 'wall' } },
        { label: s.toolGate, cost: '20t 12s', tool: { kind: 'gate' } },
      ];
      for (const it of infraItems) {
        const btn = document.createElement('button');
        const isSel = this.activeTool?.kind === it.tool?.kind;
        btn.className = `rts-item-btn rts-item-sm ${isSel ? 'active' : ''}`;
        if (it.tool) btn.setAttribute('data-tool', it.tool.kind);
        btn.innerHTML = `<span>${it.label}</span><small>${it.cost}</small>`;
        btn.addEventListener('click', () => this.cb.onSelectTool(isSel ? null : it.tool));
        infraRow.appendChild(btn);
      }
      this.drawerBodyEl.appendChild(infraRow);

      // Buildings in selected branch
      const grid = document.createElement('div');
      grid.className = 'rts-item-grid';
      const stock = this.latestState?.sides[0].stock;
      const blds = (Object.keys(BUILDING_DEFS) as BuildingTypeId[]).filter(
        (id) => BUILDING_DEFS[id].buildable && BUILDING_DEFS[id].branch === this.activeBranch && id !== 'gate',
      );
      for (const bId of blds) {
        const def = BUILDING_DEFS[bId];
        const canAffordGold = !stock || stock.gold >= (def.cost.gold ?? 0);
        const isSel = this.activeTool?.kind === 'building' && this.activeTool.buildingType === bId;
        const btn = document.createElement('button');
        btn.className = `rts-item-btn ${isSel ? 'active' : ''} ${canAffordGold ? '' : 'dim'}`;
        btn.setAttribute('data-build', bId);
        btn.innerHTML = `<span>${s.buildings[bId]}</span><small>${formatCostShort(def.cost)}</small>`;
        btn.title = `${s.buildings[bId]} (${formatCostShort(def.cost)})`;
        btn.addEventListener('click', () => {
          this.cb.onSelectTool(isSel ? null : { kind: 'building', buildingType: bId });
        });
        grid.appendChild(btn);
      }
      this.drawerBodyEl.appendChild(grid);
    } else if (this.activeTab === 'recruit') {
      const state = this.latestState;
      if (state) {
        this.drawerBodyEl.appendChild(this.buildBarracksEquipPanel(state));
      }

      const grid = document.createElement('div');
      grid.className = 'rts-recruit-list';
      const stock = state?.sides[0].stock;
      const maxBarracks = state
        ? state.buildings.filter((b) => b.side === 0 && b.type === 'barracks' && b.buildProgress >= 1 && b.hp > 0).reduce((m, b) => Math.max(m, b.level), 0)
        : 0;
      const maxFoundry = state
        ? state.buildings.filter((b) => b.side === 0 && b.type === 'gunFoundry' && b.buildProgress >= 1 && b.hp > 0).reduce((m, b) => Math.max(m, b.level), 0)
        : 0;

      for (const uId of ALL_UNIT_TYPES) {
        const def = UNIT_DEFS[uId];
        const unlocked =
          (def.gunFoundryLevel > 0 ? maxFoundry >= def.gunFoundryLevel : true) &&
          (def.barracksLevel > 0 ? maxBarracks >= def.barracksLevel : true);
        let affordable = true;
        if (stock) {
          for (const g of Object.keys(def.cost) as GoodId[]) {
            if ((stock[g] ?? 0) < (def.cost[g] ?? 0)) affordable = false;
          }
        }
        const btn = document.createElement('button');
        btn.className = `rts-unit-btn ${unlocked && affordable ? '' : 'dim'}`;
        btn.title = s.unitCounterHint[uId];
        const reqTag =
          def.gunFoundryLevel > 0
            ? `Foundry L${def.gunFoundryLevel}`
            : def.barracksLevel > 0
              ? `Barracks L${def.barracksLevel}`
              : 'Keep';
        btn.innerHTML =
          `<div class="u-head"><strong>${UNIT_ICONS[uId]} ${s.units[uId]}</strong><span>${formatCostShort(def.cost)}</span></div>` +
          `<div class="u-hint">${s.unitCounterHint[uId]} <em class="u-req">[${reqTag}]</em></div>`;
        btn.addEventListener('click', () => {
          this.cb.onExecute({ type: 'recruit', side: 0, unitType: uId });
        });
        grid.appendChild(btn);
      }
      this.drawerBodyEl.appendChild(grid);
    } else if (this.activeTab === 'production' && this.latestState) {
      // Complete 21-good Production ledger + clickable Bottlenecks (docs/MANUAL.md §4.3)!
      const rates = computeProductionRates(this.latestState, 0);
      const bns = listBottlenecks(this.latestState, 0);
      const yardTotals: Partial<Record<GoodId, number>> = {};
      for (const b of this.latestState.buildings) {
        if (b.side !== 0 || b.hp <= 0) continue;
        for (const g of Object.keys(b.yard) as GoodId[]) {
          yardTotals[g] = (yardTotals[g] ?? 0) + (b.yard[g] ?? 0);
        }
      }

      const bnHeader = document.createElement('div');
      bnHeader.className = 'rts-sec-title';
      bnHeader.textContent = `${s.bottlenecksTitle} (${bns.length})`;
      this.drawerBodyEl.appendChild(bnHeader);

      if (bns.length === 0) {
        const okLine = document.createElement('div');
        okLine.className = 'rts-muted';
        okLine.textContent = s.noBottlenecks;
        this.drawerBodyEl.appendChild(okLine);
      } else {
        const bnList = document.createElement('div');
        bnList.className = 'rts-bn-list';
        for (const bn of bns.slice(0, 8)) {
          const btn = document.createElement('button');
          btn.className = 'rts-bn-btn';
          const miss = bn.missingGood ? ` (${s.goods[bn.missingGood]})` : '';
          btn.textContent = `⚠ ${s.buildings[bn.buildingType]} · ${s.statusLabels[bn.status] ?? bn.status}${miss}`;
          btn.addEventListener('click', () => this.cb.onJumpCamera(bn.x, bn.z));
          bnList.appendChild(btn);
        }
        this.drawerBodyEl.appendChild(bnList);
      }

      const yardHeader = this.lang === 'pl' ? 'Podw.' : 'Yards';
      const table = document.createElement('table');
      table.className = 'rts-prod-table';
      table.innerHTML = `<thead><tr><th>${s.prodHeaderGood}</th><th>${s.prodHeaderStock}</th><th>${yardHeader}</th><th>${s.prodHeaderRate}</th><th>${s.prodHeaderNet}</th><th>${s.priorityHeader}</th></tr></thead>`;
      const tb = document.createElement('tbody');
      const prios = this.latestState.sides[0].goodPriorities ?? {};
      for (const r of rates) {
        const tr = document.createElement('tr');
        const netCls = r.netPerMin > 0.1 ? 'pos' : r.netPerMin < -0.1 ? 'neg' : '';
        const yAmt = Math.floor(yardTotals[r.good] ?? 0);
        const curPri = (prios[r.good] ?? 0) as -1 | 0 | 1;
        tr.innerHTML =
          `<td>${s.goods[r.good]}</td>` +
          `<td><strong>${Math.floor(r.stock)}</strong></td>` +
          `<td>${yAmt > 0 ? yAmt : '·'}</td>` +
          `<td>+${r.producedPerMin.toFixed(1)}</td>` +
          `<td class="${netCls}">${r.netPerMin >= 0 ? '+' : ''}${r.netPerMin.toFixed(1)}</td>`;
        const tdPri = document.createElement('td');
        const priBtn = document.createElement('button');
        priBtn.className = `insp-btn ${curPri > 0 ? 'active' : ''}`;
        priBtn.style.padding = '1px 5px';
        priBtn.style.fontSize = '10px';
        priBtn.textContent = curPri > 0 ? '▲' : curPri < 0 ? '▼' : '·';
        priBtn.title =
          curPri > 0
            ? this.lang === 'pl'
              ? 'Priorytet: Wysoki'
              : 'Priority: High'
            : curPri < 0
              ? this.lang === 'pl'
                ? 'Priorytet: Niski'
                : 'Priority: Low'
              : this.lang === 'pl'
                ? 'Priorytet: Normalny'
                : 'Priority: Normal';
        priBtn.addEventListener('click', () => {
          const nextPri: -1 | 0 | 1 = curPri === 0 ? 1 : curPri === 1 ? -1 : 0;
          this.cb.onExecute({ type: 'setGoodPriority', side: 0, good: r.good, priority: nextPri });
          this.rebuildDrawer(true);
        });
        tdPri.appendChild(priBtn);
        tr.appendChild(tdPri);
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      this.drawerBodyEl.appendChild(table);
    } else if (this.activeTab === 'buildings' && this.latestState) {
      // 4th Tab: Buildings overview by type (count, levels, constructing, stalled, click to cycle camera & inspect; docs/MANUAL.md §4.4)
      const p0Blds = this.latestState.buildings.filter((b) => b.side === 0 && b.hp > 0);
      const byType = new Map<BuildingTypeId, BuildingEntity[]>();
      for (const b of p0Blds) {
        const arr = byType.get(b.type) ?? [];
        arr.push(b);
        byType.set(b.type, arr);
      }
      const listEl = document.createElement('div');
      listEl.className = 'rts-bn-list';
      for (const [bType, arr] of byType) {
        const l1 = arr.filter((x) => x.level === 1 && x.buildProgress >= 1).length;
        const l2 = arr.filter((x) => x.level === 2 && x.buildProgress >= 1).length;
        const l3 = arr.filter((x) => x.level === 3 && x.buildProgress >= 1).length;
        const constr = arr.filter((x) => x.buildProgress < 1 || x.upgradingToLevel !== null).length;
        const stalled = arr.filter((x) => x.buildProgress >= 1 && (x.status === 'noInput' || x.status === 'noWorker' || x.status === 'yardFull')).length;
        const lvlParts: string[] = [];
        if (l1 > 0) lvlParts.push(`${l1}×L1`);
        if (l2 > 0) lvlParts.push(`${l2}×L2`);
        if (l3 > 0) lvlParts.push(`${l3}×L3`);
        if (constr > 0) lvlParts.push(`⏳${constr}`);
        if (stalled > 0) lvlParts.push(`⚠${stalled}`);
        const row = document.createElement('button');
        row.className = 'rts-bn-btn';
        row.textContent = `${s.buildings[bType]} (${arr.length}) · ${lvlParts.join(' ')}`;
        row.addEventListener('click', () => {
          const target = arr[this.buildingJumpCursor % arr.length]!;
          this.buildingJumpCursor++;
          this.cb.onJumpCamera(target.x, target.z);
        });
        listEl.appendChild(row);
      }
      this.drawerBodyEl.appendChild(listEl);
    }
  }

  /** Refreshes dynamic resource counters, alerts, regiment cards, inspector, minimap & end screen. */
  syncFromSim(
    state: SimWorldState,
    terrain: TerrainField,
    camX: number,
    camZ: number,
    selectedRegimentIds: ReadonlySet<number>,
    selectedBuildingId: number | null,
    controlGroups: ReadonlyMap<number, number[]>,
  ): void {
    this.latestState = state;
    this.latestSelectedRegs = selectedRegimentIds;
    this.latestSelectedBld = selectedBuildingId;
    this.latestGroups = controlGroups;

    if (this.minimapMapId !== state.mapId) {
      this.bakeMinimapBase(terrain, state);
    }

    const now = performance.now();
    if (now - this.lastHudRefreshMs < 140) return;
    this.lastHudRefreshMs = now;

    this.renderMinimap(state, camX, camZ);

    const s = this.str;
    const p0 = state.sides[0];
    const pop = countPopulation(state, 0);
    const armyMen = countSideArmyMen(state, 0);
    const armyCap = getArmyCap(state);
    const rations = Math.floor(countFoodRationsInStock(p0.stock));

    const chip = (g: GoodId, extraCls = ''): string => {
      const val = Math.floor(p0.stock[g] ?? 0);
      const lbl = this.showResLabels ? ` ${s.goods[g]}` : '';
      return `<span class="res-chip ${extraCls}" title="${s.goods[g]}: ${val}">${GOOD_ICONS[g]}${lbl} ${val}</span>`;
    };
    const matGroup: readonly GoodId[] = ['gold', 'timber', 'planks', 'stone'];
    const foodGroup: readonly GoodId[] = ['grain', 'flour', 'bread', 'fish', 'meat', 'sausages', 'grapes', 'wine', 'ale'];
    const craftGroup: readonly GoodId[] = ['hides', 'leatherArmour', 'ironOre', 'iron', 'weapons', 'mail', 'bows', 'horses'];

    this.resBarEl.innerHTML =
      matGroup.map((g) => chip(g, g === 'gold' ? 'gold' : '')).join('') +
      `<span class="res-sep">|</span>` +
      foodGroup.map((g) => chip(g)).join('') +
      `<span class="res-sep">|</span>` +
      craftGroup.map((g) => chip(g)).join('') +
      `<span class="res-sep">|</span>` +
      `<span class="res-chip ${rations < 10 ? 'warn' : ''}" title="Racje żywności">🍽 ${rations}</span>` +
      `<span class="res-chip">👥 ${pop.total}/${pop.capacity} (${s.freeCarriersLabel} ${pop.carriers + pop.builders})</span>` +
      `<span class="res-chip ${p0.armyStarving || p0.unpaidPenaltyActive ? 'warn' : ''}">⚔ ${armyMen}/${armyCap}</span>`;

    // Objective / Scenario strip
    this.objStripEl.innerHTML = '';
    const sc = state.scenario;
    if (sc.mode === 'tutorial') {
      const nextStep = sc.tutorialSteps.find((st) => !st.completed);
      const done = sc.tutorialSteps.filter((st) => st.completed).length;
      const span = document.createElement('span');
      span.className = 'obj-chip';
      span.textContent = nextStep
        ? `[${done}/${sc.tutorialSteps.length}] ${s.tutorialSteps[nextStep.id] ?? nextStep.id}`
        : `✓ ${s.victoryTitle}`;
      this.objStripEl.appendChild(span);
    } else if (sc.mode === 'defence') {
      const span = document.createElement('span');
      span.className = 'obj-chip';
      const rem = Math.max(0, CAMPAIGN.defenceWinTimeS - state.timeS);
      span.textContent = `${s.waveLabel(sc.waveIndex)} · ${s.tributeCountdown(rem)}`;
      this.objStripEl.appendChild(span);
    } else if (sc.mode === 'campaign' && sc.missionId !== null) {
      const mt = s.missions[sc.missionId];
      const span = document.createElement('span');
      span.className = 'obj-chip';
      if (sc.missionId === 1 && !p0.tributePaid) {
        const rem = Math.max(0, CAMPAIGN.m1DeadlineS - state.timeS);
        span.textContent = `${mt.title} · ${s.tributeCountdown(rem)}`;
        this.objStripEl.appendChild(span);
        const payBtn = document.createElement('button');
        payBtn.className = 'hud-btn hud-btn-sm btn-primary';
        payBtn.textContent = s.payTributeBtn;
        payBtn.addEventListener('click', () => this.cb.onExecute({ type: 'payTribute', side: 0 }));
        this.objStripEl.appendChild(payBtn);
      } else {
        span.textContent = `${mt.title}: ${mt.objective}`;
        this.objStripEl.appendChild(span);
      }
    } else {
      const span = document.createElement('span');
      span.className = 'obj-chip';
      span.textContent = `${s.mapNames[state.mapId]} · ${s.tributeCountdown(state.timeS)}`;
      this.objStripEl.appendChild(span);
    }

    if (p0.unpaidPenaltyActive) {
      const w = document.createElement('span');
      w.className = 'obj-chip warn';
      w.textContent = s.upkeepUnpaid;
      this.objStripEl.appendChild(w);
    }
    if (p0.armyStarving) {
      const w = document.createElement('span');
      w.className = 'obj-chip warn';
      w.textContent = s.armyStarving;
      this.objStripEl.appendChild(w);
    }

    // Refresh Production / Buildings body at a calm 900 ms cadence without touching tab buttons or interrupting hover clicks!
    if (
      (this.activeTab === 'production' || this.activeTab === 'buildings') &&
      now - this.lastDrawerRefreshMs >= 900 &&
      !this.drawerEl.matches(':hover')
    ) {
      this.lastDrawerRefreshMs = now;
      this.rebuildDrawer(true);
    }

    // Clickable alerts feed (last 4 side-0 alerts within 45 s)
    this.alertsEl.innerHTML = '';
    const recentAlerts = state.alerts
      .filter((a) => a.side === 0 && state.timeS - a.timeS < 45)
      .slice(-4)
      .reverse();
    for (const al of recentAlerts) {
      const btn = document.createElement('button');
      btn.className = 'rts-alert-btn';
      btn.textContent = `⚑ ${al.detail || al.kind}`;
      btn.addEventListener('click', () => this.cb.onJumpCamera(al.x, al.z));
      this.alertsEl.appendChild(btn);
    }

    // Persistent Bottom Regiment Cards
    this.regStripEl.innerHTML = '';
    const p0Regs = state.regiments.filter((r) => r.side === 0 && countAliveSoldiers(r) > 0);
    for (const r of p0Regs) {
      const alive = countAliveSoldiers(r);
      const hpPct = Math.round((alive / Math.max(1, r.maxMen)) * 100);
      const morPct = Math.round((r.morale / Math.max(1, r.maxMorale)) * 100);
      let grpTag = '';
      for (const [gn, ids] of this.latestGroups) {
        if (ids.includes(r.id)) {
          grpTag = String(gn);
          break;
        }
      }
      const card = document.createElement('button');
      card.className = `rts-reg-card ${selectedRegimentIds.has(r.id) ? 'selected' : ''} ${r.routing ? 'routing' : ''}`;
      card.innerHTML =
        `<div class="rc-top"><span>${unitAbbr(r.unitType)}</span><span>${alive}/${r.maxMen}</span></div>` +
        `<div class="rc-bar"><div class="rc-hp" style="width:${hpPct}%"></div></div>` +
        `<div class="rc-bar"><div class="rc-mor" style="width:${morPct}%"></div></div>` +
        (grpTag ? `<span class="rc-grp">${grpTag}</span>` : '') +
        (r.veteranTier > 0 ? `<span class="rc-vet">${'★'.repeat(r.veteranTier)}</span>` : '');
      card.addEventListener('click', (ev) => this.cb.onSelectRegiment(r.id, ev.shiftKey, false));
      card.addEventListener('dblclick', () => this.cb.onSelectRegiment(r.id, false, true));
      this.regStripEl.appendChild(card);
    }

    this.refreshInspector(false);

    // Victory / Defeat End Screen trigger!
    if (sc.outcome !== 'playing' && !this.lastEndShown) {
      this.lastEndShown = true;
      this.showEndScreen(state);
    }
  }

  refreshInspector(force = true): void {
    const state = this.latestState;
    if (!state) {
      this.inspectorEl.classList.add('hidden');
      this.lastInspectorSig = '';
      return;
    }
    const s = this.str;

    // 1. Selected Regiment(s) Inspector
    if (this.latestSelectedRegs.size > 0) {
      const regs: RegimentEntity[] = [];
      for (const id of this.latestSelectedRegs) {
        const r = state.regiments.find((x) => x.id === id && countAliveSoldiers(x) > 0);
        if (r) regs.push(r);
      }
      if (regs.length === 0) {
        this.inspectorEl.classList.add('hidden');
        this.lastInspectorSig = '';
        return;
      }
      this.inspectorEl.classList.remove('hidden');

      const primary = regs[0]!;
      const def = UNIT_DEFS[primary.unitType];
      const alive = countAliveSoldiers(primary);
      const primaryRanks = primary.ranks ?? Math.max(1, Math.ceil(Math.max(1, alive) / Math.max(1, primary.width)));
      const ids = regs.map((r) => r.id);
      const isPose = this.activeTool?.kind === 'regimentPose';
      const savedForms = state.sides[0].savedFormations ?? [];
      const savedSig = savedForms.map((f) => `${f.id}:${f.slots.length}`).join('|');
      const regSig = `r:${ids.join(',')}:${primary.unitType}:${primary.formation}:${primaryRanks}:${primary.width}:${primary.stance}:${primary.holdFire}:${primary.routing}:${isPose}:${savedSig}:${this.lang}`;

      const headHtml =
        `<strong>${regs.length > 1 ? `${regs.length}× ` : ''}${UNIT_ICONS[primary.unitType]} ${s.units[primary.unitType]}</strong>` +
        `<span>${alive}/${primary.maxMen} · ${s.ranksLabel}: ${primaryRanks} (${primary.width}×${primaryRanks}) · ${s.moraleLabel} ${Math.round(primary.morale)}/${Math.round(primary.maxMorale)} · ${s.fatigueLabel} ${Math.round(primary.fatigue * 100)}%</span>` +
        `<span class="insp-cap">${primary.routing ? s.routingLabel : def.unitClass === 'siege' ? '' : primary.captainAlive ? s.captainAlive : s.captainFallen}${primary.veteranTier > 0 ? ` · ${s.veteranLabel} ${'★'.repeat(primary.veteranTier)}` : ''}</span>`;

      if (!force && regSig === this.lastInspectorSig) {
        const existingHead = this.inspectorEl.querySelector('.insp-head');
        if (existingHead) existingHead.innerHTML = headHtml;
        return;
      }
      this.lastInspectorSig = regSig;
      this.inspectorEl.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'insp-head';
      header.innerHTML = headHtml;
      this.inspectorEl.appendChild(header);

      const actRow = document.createElement('div');
      actRow.className = 'insp-actions';

      // Target Position & Mouse Rotation tool (`⌖ Ustaw pozycję`)
      const poseBtn = document.createElement('button');
      poseBtn.className = `insp-btn ${isPose ? 'active' : 'btn-primary'}`;
      poseBtn.setAttribute('data-set-pose', '1');
      poseBtn.textContent = s.setPoseBtn;
      poseBtn.title = s.setPoseHint;
      poseBtn.addEventListener('click', () => {
        this.cb.onSelectTool(isPose ? null : { kind: 'regimentPose' });
      });
      actRow.appendChild(poseBtn);

      // Save multi-unit formation button when 2+ regiments are selected
      if (regs.length >= 2) {
        const saveFormBtn = document.createElement('button');
        saveFormBtn.className = 'insp-btn';
        saveFormBtn.setAttribute('data-save-formation', '1');
        saveFormBtn.textContent = s.saveFormationBtn;
        saveFormBtn.addEventListener('click', () => {
          this.cb.onExecute({ type: 'saveArmyFormation', side: 0, regimentIds: ids });
          this.refreshInspector(true);
        });
        actRow.appendChild(saveFormBtn);
      }

      // Formations
      const forms: FormationKind[] = ['line', 'column', 'loose'];
      if (def.antiCavBonus > 0) forms.push('schiltron');
      if (def.unitClass === 'cavalry') forms.push('wedge');
      for (const f of forms) {
        const btn = document.createElement('button');
        btn.className = `insp-btn ${primary.formation === f ? 'active' : ''}`;
        btn.textContent = s.formations[f];
        btn.addEventListener('click', () => {
          this.cb.onExecute({ type: 'setFormation', side: 0, regimentIds: ids, formation: f });
          this.refreshInspector(true);
        });
        actRow.appendChild(btn);
      }

      // Ranks (`Szeregi`: 1, 2, 3, 4, 6)
      const rankLbl = document.createElement('span');
      rankLbl.className = 'insp-inline-lbl';
      rankLbl.textContent = `${s.ranksLabel}:`;
      actRow.appendChild(rankLbl);
      for (const rk of RANK_CHOICES) {
        const rkBtn = document.createElement('button');
        rkBtn.className = `insp-btn ${primaryRanks === rk ? 'active' : ''}`;
        rkBtn.setAttribute('data-rank', String(rk));
        rkBtn.textContent = `${rk}`;
        rkBtn.title = `${s.ranksLabel}: ${rk}`;
        rkBtn.addEventListener('click', () => {
          this.cb.onExecute({ type: 'setRanks', side: 0, regimentIds: ids, ranks: rk });
          this.refreshInspector(true);
        });
        actRow.appendChild(rkBtn);
      }

      // Stances (including Shield Wall & Pike Wall when unit is eligible)
      const stances: StanceKind[] = ['hold', 'guard', 'skirmish'];
      if (def.shieldBlock >= 0.2) stances.push('shieldWall');
      if (def.antiCavBonus > 0 && def.unitClass === 'infantry') stances.push('pikeWall');
      for (const st of stances) {
        const btn = document.createElement('button');
        btn.className = `insp-btn ${primary.stance === st ? 'active' : ''}`;
        btn.textContent = s.stances[st];
        btn.addEventListener('click', () => {
          this.cb.onExecute({ type: 'setStance', side: 0, regimentIds: ids, stance: st });
          this.refreshInspector(true);
        });
        actRow.appendChild(btn);
      }

      if (def.ranged) {
        const hf = document.createElement('button');
        hf.className = `insp-btn ${primary.holdFire ? 'active' : ''}`;
        hf.textContent = s.holdFireLabel;
        hf.addEventListener('click', () => {
          this.cb.onExecute({ type: 'setHoldFire', side: 0, regimentIds: ids, holdFire: !primary.holdFire });
          this.refreshInspector(true);
        });
        actRow.appendChild(hf);
      }

      const fb = document.createElement('button');
      fb.className = 'insp-btn';
      fb.textContent = s.fallbackBtn;
      fb.addEventListener('click', () =>
        this.cb.onExecute({ type: 'issueOrder', side: 0, regimentIds: ids, order: { kind: 'fallbackKeep', x: 0, z: 0 } }),
      );
      actRow.appendChild(fb);

      // Reinforce thinned regiment at nearby Barracks (preserves veteran rank!)
      if (regs.length === 1 && this.latestState) {
        const rfInfo = inspectRegimentReinforce(this.latestState, 0, primary.id);
        if (rfInfo.missingMen > 0) {
          const rfBtn = document.createElement('button');
          rfBtn.className = 'insp-btn';
          rfBtn.disabled = !rfInfo.canReinforce;
          rfBtn.textContent = `➕ ${s.reinforceBtn} (+${rfInfo.missingMen})`;
          const costStr = Object.entries(rfInfo.cost)
            .map(([g, a]) => `${a} ${s.goods[g as GoodId]}`)
            .join(', ');
          rfBtn.title = rfInfo.canReinforce
            ? `${s.reinforceBtn} (+${rfInfo.missingMen}): ${costStr}`
            : `${s.reinforceBtn}: ${rfInfo.reason}${costStr ? ` (${costStr})` : ''}`;
          rfBtn.addEventListener('click', () => {
            this.cb.onExecute({ type: 'reinforceRegiment', side: 0, regimentId: primary.id });
            this.refreshInspector(true);
          });
          actRow.appendChild(rfBtn);
        }
      }

      // Refit buttons when single regiment has valid refit targets
      if (regs.length === 1 && def.refitTargets.length > 0) {
        for (const tgt of def.refitTargets.slice(0, 2)) {
          const rf = document.createElement('button');
          rf.className = 'insp-btn';
          rf.textContent = `${s.refitBtn}: ${s.units[tgt]}`;
          rf.addEventListener('click', () =>
            this.cb.onExecute({ type: 'refitRegiment', side: 0, regimentId: primary.id, targetType: tgt }),
          );
          actRow.appendChild(rf);
        }
      }

      // Merge when 2 same-type regiments selected
      if (regs.length === 2 && regs[0]!.unitType === regs[1]!.unitType) {
        const mg = document.createElement('button');
        mg.className = 'insp-btn';
        mg.textContent = s.mergeBtn;
        mg.addEventListener('click', () =>
          this.cb.onExecute({ type: 'mergeRegiments', side: 0, primaryId: regs[0]!.id, secondaryId: regs[1]!.id }),
        );
        actRow.appendChild(mg);
      }

      const dis = document.createElement('button');
      dis.className = 'insp-btn danger';
      dis.textContent = s.disbandBtn;
      dis.addEventListener('click', () => {
        for (const id of ids) this.cb.onExecute({ type: 'disbandRegiment', side: 0, regimentId: id });
      });
      actRow.appendChild(dis);

      this.inspectorEl.appendChild(actRow);

      if (isPose) {
        const hint = document.createElement('div');
        hint.className = 'insp-upgrade-note';
        hint.textContent = `⌖ ${s.setPoseHint}`;
        this.inspectorEl.appendChild(hint);
      }

      // Saved Multi-Unit Formations list (selects units + enters target position preview!)
      if (savedForms.length > 0) {
        const sfRow = document.createElement('div');
        sfRow.className = 'insp-actions';
        const sfLbl = document.createElement('span');
        sfLbl.className = 'insp-inline-lbl';
        sfLbl.textContent = `${s.savedFormationsLabel}:`;
        sfRow.appendChild(sfLbl);

        for (const f of savedForms) {
          const aliveIds = f.slots
            .map((sl) => sl.regimentId)
            .filter((id) => state.regiments.some((r) => r.id === id && r.side === 0 && countAliveSoldiers(r) > 0));
          if (aliveIds.length === 0) continue;
          const isMatched =
            aliveIds.length === ids.length && aliveIds.every((id) => this.latestSelectedRegs.has(id));
          const fBtn = document.createElement('button');
          fBtn.className = `insp-btn ${isMatched ? 'active' : ''}`;
          fBtn.setAttribute('data-saved-formation', String(f.id));
          fBtn.textContent = `⚑ ${f.name} (${aliveIds.length})`;
          fBtn.addEventListener('click', () => {
            aliveIds.forEach((id, idx) => this.cb.onSelectRegiment(id, idx > 0, false));
            this.cb.onSelectTool({ kind: 'regimentPose' });
          });
          const delBtn = document.createElement('button');
          delBtn.className = 'insp-btn danger';
          delBtn.textContent = '✕';
          delBtn.addEventListener('click', () => {
            this.cb.onExecute({ type: 'deleteArmyFormation', side: 0, formationId: f.id });
            this.refreshInspector(true);
          });
          sfRow.append(fBtn, delBtn);
        }
        this.inspectorEl.appendChild(sfRow);
      }
      return;
    }

    // 2. Selected Building Inspector (diffed by signature so Upgrade/Pause/Demolish buttons NEVER drop clicks!)
    if (this.latestSelectedBld !== null) {
      const b: BuildingEntity | undefined = state.buildings.find((x) => x.id === this.latestSelectedBld && x.hp > 0);
      if (!b) {
        this.inspectorEl.classList.add('hidden');
        this.lastInspectorSig = '';
        return;
      }
      this.inspectorEl.classList.remove('hidden');

      const def = BUILDING_DEFS[b.type];
      const uCheck = inspectBuildingUpgrade(state, 0, b);
      const formatGoodList = (map: ResourceMap, includeSawmillHint = false): string => {
        const hasSawmill = state.buildings.some(
          (x) => x.side === 0 && x.type === 'sawmill' && x.hp > 0 && x.buildProgress >= 1,
        );
        const parts: string[] = [];
        for (const g of Object.keys(map) as GoodId[]) {
          const amt = map[g] ?? 0;
          if (amt <= 0) continue;
          const hint = includeSawmillHint && g === 'planks' && !hasSawmill ? ` (${s.sawmillHint})` : '';
          parts.push(`${amt} ${s.goods[g]}${hint}`);
        }
        return parts.join(', ');
      };

      const matProgressStr = (): string => {
        const parts: string[] = [];
        for (const g of Object.keys(b.buildCostNeeded) as GoodId[]) {
          const need = b.buildCostNeeded[g] ?? 0;
          if (need <= 0) continue;
          const deliv = Math.min(need, Math.floor(b.buildCostDelivered[g] ?? 0));
          parts.push(`${s.goods[g]} ${deliv}/${need}`);
        }
        return parts.length > 0 ? ` (${parts.join(', ')})` : '';
      };

      const isEquipShop = isEquipmentWorkshop(b.type);
      const equipOrdersStr = isEquipShop ? ` · ${s.ordersLabel}: ${b.pendingOrders ?? 0}` : '';
      const tCheck = b.type === 'keep' ? inspectTransportUpgrade(state, 0) : null;
      const transportStr =
        b.type === 'keep'
          ? ` · 🛞 ${s.transportLabel}: ${s.transportLevels[(state.sides[0].transportLevel ?? 1) - 1]}`
          : '';

      const extra =
        b.type === 'house'
          ? ` · ${s.residentsLabel}: ${b.residents}/${ECONOMY.houseCapacityByLevel[b.level - 1]} · 🍞${b.houseFoodRations.toFixed(1)} 🍷${b.houseWineCasks.toFixed(1)}`
          : b.buildProgress < 1
            ? ` · ${Math.round(b.buildProgress * 100)}%${matProgressStr()}`
            : b.upgradingToLevel !== null
              ? ` · → ${s.levelLabel}${b.upgradingToLevel}${matProgressStr()}`
              : (b.type === 'farm' || b.type === 'vineyard') && b.strips.length > 0
                ? ` · ${this.lang === 'pl' ? 'Pola' : 'Strips'}: ${b.strips.length}/12`
                : `${equipOrdersStr}${transportStr}`;

      const headHtml =
        `<strong>${s.buildings[b.type]} ${s.levelLabel}${b.level}/${def.maxLevel}</strong>` +
        `<span>${s.hpLabel} ${Math.round(b.hp)}/${b.maxHp} · ${s.statusLabels[b.status] ?? b.status}${extra}</span>`;

      let upgradeNoteText = '';
      let upgradeNoteWarn = false;
      if (b.side === 0 && b.type !== 'ruin' && def.maxLevel > 1) {
        if (uCheck.reason === 'maxLevel') {
          upgradeNoteText = `✓ ${s.upgradeMaxLevel(b.level)}`;
        } else if (uCheck.reason === 'alreadyUpgrading' && b.upgradingToLevel !== null) {
          const targetDur =
            b.type === 'keep'
              ? ECONOMY.keepLevels[b.upgradingToLevel - 1]!.upgradeS
              : ECONOMY.upgradeBuilderS;
          const pct = Math.min(99, Math.round((b.upgradeTimerS / Math.max(1, targetDur)) * 100));
          upgradeNoteText = `⏳ ${s.upgradeInProgress(b.upgradingToLevel, pct)}${matProgressStr()}`;
        } else if (!uCheck.canUpgrade && uCheck.targetLevel !== null) {
          upgradeNoteWarn = true;
          if (uCheck.reason === 'constructing') {
            upgradeNoteText = `⚠ ${s.upgradeWaitBuild(Math.round(b.buildProgress * 100))}`;
          } else if (uCheck.reason === 'needsKeepUpgrade') {
            upgradeNoteText = `⚠ ${s.upgradeNeedsKeep(uCheck.requiredKeepLevel ?? uCheck.targetLevel)}`;
          } else if (uCheck.reason === 'insufficientResources') {
            upgradeNoteText = `⚠ ${s.upgradeMissing(formatGoodList(uCheck.missing, true))}`;
          }
        }
      }

      const missingSig = Object.keys(uCheck.missing)
        .map((g) => `${g}:${uCheck.missing[g as GoodId]}`)
        .join(',');
      const equipSig =
        b.type === 'barracks'
          ? EQUIPMENT_GOODS.map((g) => {
              const wt = GOOD_TO_WORKSHOP[g];
              const sh = wt
                ? state.buildings
                    .filter((x) => x.side === 0 && x.hp > 0 && x.type === wt)
                    .reduce((sum, x) => sum + (x.pendingOrders ?? 0), 0)
                : 0;
              return `${g}:${sh + (state.sides[0].equipmentOrders?.[g] ?? 0)}`;
            }).join(',')
          : b.type === 'keep'
            ? `t:${state.sides[0].transportLevel ?? 1}:${state.sides[0].upgradingTransportTo ?? 0}:${Math.floor(state.sides[0].transportUpgradeTimerS ?? 0)}:${tCheck?.canUpgrade}:${tCheck?.reason}`
            : String(b.pendingOrders ?? 0);
      const bldSig = `b:${b.id}:${b.type}:${b.level}:${b.upgradingToLevel}:${b.paused}:${b.buildProgress < 1}:${uCheck.canUpgrade}:${uCheck.reason}:${missingSig}:${equipSig}:${this.lang}`;

      if (!force && bldSig === this.lastInspectorSig) {
        const existingHead = this.inspectorEl.querySelector('.insp-head');
        if (existingHead) existingHead.innerHTML = headHtml;
        const existingNote = this.inspectorEl.querySelector('.insp-upgrade-note');
        if (existingNote && upgradeNoteText) {
          existingNote.textContent = upgradeNoteText;
          existingNote.className = `insp-upgrade-note ${upgradeNoteWarn ? 'warn' : ''}`;
        }
        return;
      }
      this.lastInspectorSig = bldSig;
      this.inspectorEl.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'insp-head';
      head.innerHTML = headHtml;
      this.inspectorEl.appendChild(head);

      if (b.side === 0) {
        const actRow = document.createElement('div');
        actRow.className = 'insp-actions';

        if (b.type === 'ruin') {
          const base = BUILDING_DEFS.house.cost;
          const rCost: ResourceMap = {};
          const rMissing: ResourceMap = {};
          const stock = state.sides[0].stock;
          for (const g of Object.keys(base) as GoodId[]) {
            const req = Math.ceil((base[g] ?? 0) * 0.5);
            if (req > 0) {
              rCost[g] = req;
              const have = Math.floor(stock[g] ?? 0);
              if (req > have) rMissing[g] = req - have;
            }
          }
          const canRebuild = Object.keys(rMissing).length === 0;
          const rb = document.createElement('button');
          rb.className = `insp-btn ${canRebuild ? 'btn-primary' : 'disabled'}`;
          rb.disabled = !canRebuild;
          rb.textContent = `${s.rebuildRuinBtn} · ${formatGoodList(rCost)}`;
          rb.addEventListener('click', () => this.cb.onExecute({ type: 'rebuildRuin', side: 0, buildingId: b.id }));
          actRow.appendChild(rb);
          if (!canRebuild) {
            upgradeNoteText = `⚠ ${s.upgradeMissing(formatGoodList(rMissing))}`;
            upgradeNoteWarn = true;
          }
        } else {
          if (def.maxLevel > 1 && uCheck.targetLevel !== null && uCheck.reason !== 'alreadyUpgrading') {
            const costStr = formatGoodList(uCheck.cost);
            const up = document.createElement('button');
            up.className = `insp-btn ${uCheck.canUpgrade ? 'btn-primary' : 'disabled'}`;
            up.disabled = !uCheck.canUpgrade;
            up.textContent = `${s.upgradeBtn} → ${s.levelLabel}${uCheck.targetLevel} (${costStr})`;
            up.addEventListener('click', () => {
              this.cb.onExecute({ type: 'upgradeBuilding', side: 0, buildingId: b.id });
              this.refreshInspector(true);
            });
            actRow.appendChild(up);
          }

          if (b.type === 'keep' && tCheck && tCheck.reason !== 'maxLevel') {
            const tBtn = document.createElement('button');
            if (tCheck.reason === 'alreadyUpgrading' && tCheck.targetLevel !== null) {
              const tDef = TRANSPORT_LEVELS[tCheck.targetLevel - 1]!;
              const pct = Math.min(99, Math.round(((state.sides[0].transportUpgradeTimerS ?? 0) / Math.max(1, tDef.seconds)) * 100));
              tBtn.className = 'insp-btn disabled';
              tBtn.disabled = true;
              tBtn.textContent = `⏳ ${s.transportUpgrading(s.transportLevels[tCheck.targetLevel - 1]!, pct)}`;
            } else if (tCheck.targetLevel !== null) {
              const targetName = s.transportLevels[tCheck.targetLevel - 1]!;
              const tCostStr = formatGoodList(tCheck.cost);
              tBtn.className = `insp-btn ${tCheck.canUpgrade ? 'btn-primary' : 'disabled'}`;
              tBtn.disabled = !tCheck.canUpgrade;
              tBtn.setAttribute('data-upgrade-transport', String(tCheck.targetLevel));
              tBtn.textContent = `🛞 ${s.transportUpgradeBtn} → ${targetName} (${tCostStr})`;
              tBtn.addEventListener('click', () => {
                this.cb.onExecute({ type: 'upgradeTransport', side: 0 });
                this.refreshInspector(true);
              });
            }
            actRow.appendChild(tBtn);
          }

          if (b.buildProgress < 1 && b.type !== 'keep') {
            const rotB = document.createElement('button');
            rotB.className = 'insp-btn';
            rotB.textContent = '↻ R';
            rotB.addEventListener('click', () => {
              this.cb.onExecute({ type: 'rotateBuilding', side: 0, buildingId: b.id, yawRad: b.yawRad + Math.PI * 0.5 });
            });
            actRow.appendChild(rotB);
          }

          if (isEquipShop && b.buildProgress >= 1) {
            for (const delta of [12, 1, -12, 0] as const) {
              const oBtn = document.createElement('button');
              oBtn.className = 'insp-btn';
              oBtn.textContent =
                delta === 0
                  ? `${s.ordersLabel}: 0`
                  : delta > 0
                    ? `${s.ordersLabel} +${delta}`
                    : `${s.ordersLabel} ${delta}`;
              oBtn.addEventListener('click', () => {
                const nextOrders = delta === 0 ? 0 : Math.max(0, (b.pendingOrders ?? 0) + delta);
                this.cb.onExecute({ type: 'setBuildingOrder', side: 0, buildingId: b.id, orders: nextOrders });
                this.refreshInspector(true);
              });
              actRow.appendChild(oBtn);
            }
          }

          if (b.type !== 'keep' && b.buildProgress >= 1) {
            const ps = document.createElement('button');
            ps.className = 'insp-btn';
            ps.textContent = b.paused ? s.resumeShopBtn : s.pauseShopBtn;
            ps.addEventListener('click', () => {
              this.cb.onExecute({ type: 'togglePauseBuilding', side: 0, buildingId: b.id });
              this.refreshInspector(true);
            });
            actRow.appendChild(ps);
          }
          if (b.type !== 'keep') {
            const dm = document.createElement('button');
            dm.className = 'insp-btn danger';
            dm.textContent = s.demolishBtn;
            dm.addEventListener('click', () => {
              this.cb.onExecute({ type: 'demolishBuilding', side: 0, buildingId: b.id });
              this.refreshInspector(true);
            });
            actRow.appendChild(dm);
          }
        }
        this.inspectorEl.appendChild(actRow);

        if (upgradeNoteText) {
          const note = document.createElement('div');
          note.className = `insp-upgrade-note ${upgradeNoteWarn ? 'warn' : ''}`;
          note.textContent = upgradeNoteText;
          this.inspectorEl.appendChild(note);
        }

        // Barracks (`Koszary`): equipment ordering panel with clickable unit icons!
        if (b.type === 'barracks' && b.buildProgress >= 1) {
          this.inspectorEl.appendChild(this.buildBarracksEquipPanel(state));
        }

        // Market (`Targ`): full 20-good trade grid (from raw materials to weapons & armour)!
        if (b.type === 'market' && b.buildProgress >= 1) {
          const mRow = document.createElement('div');
          mRow.className = 'insp-market-grid';
          for (const g of MARKET_GOODS) {
            const sellP = Math.round(ECONOMY.marketLotSize * GOOD_VALUE_GOLD[g] * ECONOMY.marketSellMul);
            const buyP = Math.round(ECONOMY.marketLotSize * GOOD_VALUE_GOLD[g] * ECONOMY.marketBuyMul);
            const cell = document.createElement('div');
            cell.className = 'insp-market-cell';
            const lbl = document.createElement('span');
            lbl.className = 'mk-good';
            lbl.title = `${s.goods[g]} (${Math.floor(state.sides[0].stock[g] ?? 0)})`;
            lbl.textContent = `${GOOD_ICONS[g]} ${s.goods[g]}`;
            const bBtn = document.createElement('button');
            bBtn.className = 'insp-btn mk-btn';
            bBtn.setAttribute('data-market-buy', g);
            bBtn.title = `${s.marketBuy} ${s.goods[g]} (-${buyP}g)`;
            bBtn.textContent = `+10 (-${buyP}g)`;
            bBtn.addEventListener('click', () =>
              this.cb.onExecute({ type: 'marketTrade', side: 0, action: 'buy', good: g }),
            );
            const sBtn = document.createElement('button');
            sBtn.className = 'insp-btn mk-btn';
            sBtn.setAttribute('data-market-sell', g);
            sBtn.title = `${s.marketSell} ${s.goods[g]} (+${sellP}g)`;
            sBtn.textContent = `-10 (+${sellP}g)`;
            sBtn.addEventListener('click', () =>
              this.cb.onExecute({ type: 'marketTrade', side: 0, action: 'sell', good: g }),
            );
            cell.append(lbl, bBtn, sBtn);
            mRow.appendChild(cell);
          }
          this.inspectorEl.appendChild(mRow);
        }
      }
      return;
    }

    this.inspectorEl.classList.add('hidden');
    this.lastInspectorSig = '';
  }

  private showEndScreen(state: SimWorldState): void {
    const s = this.str;
    const sc = state.scenario;
    const isWin = sc.outcome === 'victory';
    this.endModalEl.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel panel-wide';

    const starsStr = isWin ? '★'.repeat(sc.starsEarned || 1) + '☆'.repeat(3 - (sc.starsEarned || 1)) : '';
    panel.innerHTML =
      `<h1>${isWin ? s.victoryTitle : s.defeatTitle} ${starsStr}</h1>` +
      `<p class="subtitle">${s.timeLabel}: ${s.tributeCountdown(state.timeS)} · ${s.killsLabel}: ${state.sides[0].totalKills} · ${s.lossesLabel}: ${state.sides[0].totalLosses}</p>`;

    // Timeline Chart Canvas (Population, Army & Gold over match time!)
    const chart = document.createElement('canvas');
    chart.width = 620;
    chart.height = 170;
    chart.className = 'end-chart';
    const ctx = chart.getContext('2d')!;
    ctx.fillStyle = '#191511';
    ctx.fillRect(0, 0, chart.width, chart.height);

    const tl = state.timeline;
    if (tl.length >= 2) {
      const drawSeries = (vals: number[], color: string, maxVal: number): void => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < vals.length; i++) {
          const x = 18 + (i / (vals.length - 1)) * (chart.width - 36);
          const y = chart.height - 20 - (vals[i]! / Math.max(1, maxVal)) * (chart.height - 38);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      const maxArmy = Math.max(20, ...tl.map((p) => Math.max(p.p0Army, p.p1Army)));
      const maxPop = Math.max(20, ...tl.map((p) => Math.max(p.p0Pop, p.p1Pop)));
      drawSeries(tl.map((p) => p.p0Pop), '#69a2ff', maxPop);
      drawSeries(tl.map((p) => p.p0Army), '#e6bd53', maxArmy);
      drawSeries(tl.map((p) => p.p1Army), '#e05858', maxArmy);
      ctx.fillStyle = '#d8ccb2';
      ctx.font = '11px system-ui';
      ctx.fillText('Blue: Pop  ·  Gold: Own Army  ·  Red: Enemy Army', 18, 14);
    }
    panel.appendChild(chart);

    const row = document.createElement('div');
    row.className = 'btn-row';
    if (isWin && sc.mode === 'campaign' && sc.missionId !== null && sc.missionId < 5) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-primary';
      nextBtn.textContent = s.nextMissionBtn;
      nextBtn.addEventListener('click', () => {
        this.endModalEl.classList.add('hidden');
        this.cb.onNextMission();
      });
      row.appendChild(nextBtn);
    }
    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn';
    restartBtn.textContent = s.restart;
    restartBtn.addEventListener('click', () => {
      this.endModalEl.classList.add('hidden');
      this.cb.onRestart();
    });
    const menuBtn = document.createElement('button');
    menuBtn.className = 'btn';
    menuBtn.textContent = s.returnMenuBtn;
    menuBtn.addEventListener('click', () => {
      this.endModalEl.classList.add('hidden');
      this.showStartMenu();
    });
    row.append(restartBtn, menuBtn);
    panel.appendChild(row);
    this.endModalEl.appendChild(panel);
    this.endModalEl.classList.remove('hidden');
  }

  private rebuildMenus(): void {
    const s = this.str;

    // --- 1. Start Menu ---
    this.startMenuEl.innerHTML = '';
    const startPanel = document.createElement('div');
    startPanel.className = `panel ${this.menuView !== 'home' ? 'panel-wide' : ''}`;

    if (this.menuView === 'home') {
      startPanel.innerHTML = `<h1>${s.title}</h1><p class="subtitle">${s.subtitle}</p>`;

      const playQuick = document.createElement('button');
      playQuick.className = 'btn btn-primary';
      playQuick.textContent = `⚔ ${s.play} (${s.mapNames[this.mapId]})`;
      playQuick.addEventListener('click', () =>
        this.cb.onLaunchGame({ mode: 'skirmish', mapId: this.mapId, difficulty: 'normal', aiPersonality: 'raider', showcaseMode: true }),
      );

      const campBtn = document.createElement('button');
      campBtn.className = 'btn';
      campBtn.textContent = `🏰 ${s.startCampaignBtn}`;
      campBtn.addEventListener('click', () => {
        this.menuView = 'campaign';
        this.rebuildMenus();
      });

      const skirBtn = document.createElement('button');
      skirBtn.className = 'btn';
      skirBtn.textContent = `🛡 ${s.startSkirmishBtn} / ${s.startDefenceBtn}`;
      skirBtn.addEventListener('click', () => {
        this.menuView = 'skirmish';
        this.rebuildMenus();
      });

      const tutBtn = document.createElement('button');
      tutBtn.className = 'btn';
      tutBtn.textContent = `📜 ${s.startTutorialBtn}`;
      tutBtn.addEventListener('click', () =>
        this.cb.onLaunchGame({ mode: 'tutorial', mapId: 'openField', difficulty: 'easy', aiPersonality: 'builder', showcaseMode: false }),
      );

      const langBtn = document.createElement('button');
      langBtn.className = 'btn';
      langBtn.textContent = `${s.langLabel}: ${this.lang === 'pl' ? 'Polski' : 'English'}`;
      langBtn.addEventListener('click', () => this.cb.onChangeLang(this.lang === 'pl' ? 'en' : 'pl'));

      const qualBtn = document.createElement('button');
      qualBtn.className = 'btn';
      qualBtn.textContent = `${s.qualityLabel}: ${qualityLabel(s, this.quality)}`;
      qualBtn.addEventListener('click', () => this.cb.onChangeQuality(this.quality === 'high' ? 'low' : 'high'));

      startPanel.append(playQuick, campBtn, skirBtn, tutBtn, langBtn, qualBtn);
    } else if (this.menuView === 'campaign') {
      const prog = loadCampaignProgress();
      startPanel.innerHTML = `<h2>${s.startCampaignBtn}</h2>`;
      const mList = document.createElement('div');
      mList.className = 'campaign-list';
      for (const mId of [1, 2, 3, 4, 5] as CampaignMissionId[]) {
        const mt = s.missions[mId];
        const stars = prog.stars[mId] ?? 0;
        const card = document.createElement('button');
        card.className = `campaign-card ${this.selMission === mId ? 'active' : ''}`;
        card.innerHTML =
          `<div class="cc-top"><strong>${mt.title}</strong><span>${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span></div>` +
          `<div class="cc-obj">${mt.objective}</div>`;
        card.addEventListener('click', () => {
          this.selMission = mId;
          this.rebuildMenus();
        });
        mList.appendChild(card);
      }
      const brief = document.createElement('p');
      brief.className = 'campaign-brief';
      brief.textContent = s.missions[this.selMission].briefing;

      const missionMaps: Record<CampaignMissionId, MapLayoutId> = {
        1: 'crossing',
        2: 'forest',
        3: 'valley',
        4: 'valley',
        5: 'fortress',
      };
      const row = document.createElement('div');
      row.className = 'btn-row';
      const back = document.createElement('button');
      back.className = 'btn';
      back.textContent = s.backBtn;
      back.addEventListener('click', () => {
        this.menuView = 'home';
        this.rebuildMenus();
      });
      const go = document.createElement('button');
      go.className = 'btn btn-primary';
      go.textContent = s.launchMatchBtn;
      go.addEventListener('click', () =>
        this.cb.onLaunchGame({
          mode: 'campaign',
          mapId: missionMaps[this.selMission],
          difficulty: this.selDiff,
          aiPersonality: 'builder',
          missionId: this.selMission,
          showcaseMode: false,
        }),
      );
      row.append(back, go);
      startPanel.append(mList, brief, row);
    } else {
      startPanel.innerHTML = `<h2>${s.startSkirmishBtn} & ${s.startDefenceBtn}</h2>`;
      const mapRow = document.createElement('div');
      mapRow.className = 'btn-row wrap';
      for (const m of ALL_MAP_IDS) {
        const b = document.createElement('button');
        b.className = `btn ${this.selMap === m ? 'btn-primary' : ''}`;
        b.textContent = s.mapNames[m];
        b.addEventListener('click', () => {
          this.selMap = m;
          this.rebuildMenus();
        });
        mapRow.appendChild(b);
      }
      const optRow = document.createElement('div');
      optRow.className = 'btn-row wrap';
      const diffBtn = document.createElement('button');
      diffBtn.className = 'btn';
      diffBtn.textContent = s.difficultyNames[this.selDiff];
      diffBtn.addEventListener('click', () => {
        const order: Difficulty[] = ['easy', 'normal', 'hard'];
        this.selDiff = order[(order.indexOf(this.selDiff) + 1) % order.length]!;
        this.rebuildMenus();
      });
      const persBtn = document.createElement('button');
      persBtn.className = 'btn';
      persBtn.textContent = s.personalityNames[this.selPers];
      persBtn.addEventListener('click', () => {
        const order: AiPersonality[] = ['builder', 'raider', 'knight'];
        this.selPers = order[(order.indexOf(this.selPers) + 1) % order.length]!;
        this.rebuildMenus();
      });
      optRow.append(diffBtn, persBtn);

      const goRow = document.createElement('div');
      goRow.className = 'btn-row';
      const back = document.createElement('button');
      back.className = 'btn';
      back.textContent = s.backBtn;
      back.addEventListener('click', () => {
        this.menuView = 'home';
        this.rebuildMenus();
      });
      const goSkir = document.createElement('button');
      goSkir.className = 'btn btn-primary';
      goSkir.textContent = s.startSkirmishBtn;
      goSkir.addEventListener('click', () =>
        this.cb.onLaunchGame({ mode: 'skirmish', mapId: this.selMap, difficulty: this.selDiff, aiPersonality: this.selPers, showcaseMode: false }),
      );
      const goDef = document.createElement('button');
      goDef.className = 'btn';
      goDef.textContent = s.startDefenceBtn;
      goDef.addEventListener('click', () =>
        this.cb.onLaunchGame({ mode: 'defence', mapId: this.selMap, difficulty: this.selDiff, aiPersonality: this.selPers, showcaseMode: false }),
      );
      goRow.append(back, goDef, goSkir);
      startPanel.append(mapRow, optRow, goRow);
    }
    this.startMenuEl.appendChild(startPanel);

    // --- 2. Pause & Save/Load Menu ---
    this.pauseMenuEl.innerHTML = '';
    const pPanel = document.createElement('div');
    pPanel.className = 'panel panel-wide';
    pPanel.innerHTML = `<h2>${s.title}</h2>`;

    const pGrid = document.createElement('div');
    pGrid.className = 'pause-grid';

    // Left column: Resume, Restart, Settings, Benchmark
    const leftCol = document.createElement('div');
    leftCol.className = 'pause-col';

    const resumeBtn = document.createElement('button');
    resumeBtn.className = 'btn btn-primary';
    resumeBtn.textContent = s.resume;
    resumeBtn.addEventListener('click', () => this.cb.onResume());

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn';
    restartBtn.textContent = s.restart;
    restartBtn.addEventListener('click', () => this.cb.onRestart());

    const volWrap = document.createElement('label');
    volWrap.className = 'vol-row';
    volWrap.innerHTML = `<span>${s.volumeLabel}: ${Math.round(this.volume * 100)}%</span>`;
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.min = '0';
    volSlider.max = '100';
    volSlider.value = String(Math.round(this.volume * 100));
    volSlider.addEventListener('input', () => {
      this.volume = Number(volSlider.value) / 100;
      volWrap.querySelector('span')!.textContent = `${s.volumeLabel}: ${Math.round(this.volume * 100)}%`;
      this.cb.onChangeVolume(this.volume);
    });
    volWrap.appendChild(volSlider);

    const lightBtn = document.createElement('button');
    lightBtn.className = 'btn';
    lightBtn.textContent = `${s.lightingLabel}: ${s.lightingNames[this.lighting]}`;
    lightBtn.addEventListener('click', () => {
      const next = LIGHTING_ORDER[(LIGHTING_ORDER.indexOf(this.lighting) + 1) % LIGHTING_ORDER.length]!;
      this.cb.onChangeLighting(next);
    });

    const govBtn = document.createElement('button');
    govBtn.className = 'btn';
    govBtn.textContent = `${s.governorLabel}: ${this.governorEnabled ? s.on : s.off}`;
    govBtn.addEventListener('click', () => this.cb.onToggleGovernor(!this.governorEnabled));

    const benchBtn = document.createElement('button');
    benchBtn.className = 'btn';
    benchBtn.textContent = s.benchmark;
    benchBtn.addEventListener('click', () => this.cb.onRunBenchmark());

    const mainBtn = document.createElement('button');
    mainBtn.className = 'btn';
    mainBtn.textContent = s.returnMenuBtn;
    mainBtn.addEventListener('click', () => this.showStartMenu());

    leftCol.append(resumeBtn, restartBtn, volWrap, lightBtn, govBtn, benchBtn, mainBtn);

    // Right column: Save / Load 3 Slots + JSON Export/Import
    const rightCol = document.createElement('div');
    rightCol.className = 'pause-col';
    const slHead = document.createElement('div');
    slHead.className = 'rts-sec-title';
    slHead.textContent = s.saveLoadTitle;
    rightCol.appendChild(slHead);

    const slots = listSaveSlots();
    for (const slotNum of [1, 2, 3] as const) {
      const meta = slots[slotNum - 1];
      const slotRow = document.createElement('div');
      slotRow.className = 'save-slot-row';
      const info = document.createElement('span');
      info.className = 'slot-info';
      info.textContent = meta
        ? `#${slotNum}: ${meta.label} (${s.tributeCountdown(meta.timeS)})`
        : `#${slotNum}: ${s.emptySlot}`;
      const saveB = document.createElement('button');
      saveB.className = 'insp-btn';
      saveB.textContent = s.saveSlotBtn;
      saveB.addEventListener('click', () => {
        this.cb.onSaveSlot(slotNum);
        this.rebuildMenus();
      });
      const loadB = document.createElement('button');
      loadB.className = 'insp-btn';
      loadB.textContent = s.loadSlotBtn;
      loadB.disabled = !meta;
      loadB.addEventListener('click', () => this.cb.onLoadSlot(slotNum));
      slotRow.append(info, saveB, loadB);
      rightCol.appendChild(slotRow);
    }

    const jsonRow = document.createElement('div');
    jsonRow.className = 'btn-row';
    const expBtn = document.createElement('button');
    expBtn.className = 'insp-btn';
    expBtn.textContent = s.exportJsonBtn;
    expBtn.addEventListener('click', () => this.cb.onExportSave());
    const impBtn = document.createElement('button');
    impBtn.className = 'insp-btn';
    impBtn.textContent = s.importJsonBtn;
    impBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        const txt = await f.text();
        this.cb.onImportSave(txt);
      });
      input.click();
    });
    jsonRow.append(expBtn, impBtn);
    rightCol.appendChild(jsonRow);

    const loadedEl = document.createElement('div');
    loadedEl.className = 'loaded-line';
    loadedEl.textContent = s.loadedIn(this.totalLoadS);
    rightCol.appendChild(loadedEl);

    pGrid.append(leftCol, rightCol);
    pPanel.appendChild(pGrid);
    this.pauseMenuEl.appendChild(pPanel);
  }

  updatePerfOverlay(snap: PerfSnapshot): void {
    if (this.statsEl.classList.contains('hidden')) return;
    this.statsEl.textContent = [
      `${snap.backend} · ${snap.quality.toUpperCase()} · ${snap.toneMapping} · ${snap.lightingPreset}`,
      `FPS: ${snap.fps.toFixed(1)} (${snap.frameMs.toFixed(2)} ms) · Scale: ${Math.round(snap.renderScale * 100)}%`,
      `Gov: ${snap.governorLabel} (${snap.governorEnabled ? 'ON' : 'OFF'})`,
      `CPU: ${snap.cpuSummary}`,
      `GPU: ${snap.gpuSummary}`,
      `Draws: ${snap.drawCalls} · Tris: ${snap.triangles.toLocaleString()} · EV100: ${snap.ev100.toFixed(2)}`,
      `Sim: ${snap.simTimeS.toFixed(1)} s ${snap.paused ? '[PAUSED]' : ''}`,
    ].join('\n');
  }
}
