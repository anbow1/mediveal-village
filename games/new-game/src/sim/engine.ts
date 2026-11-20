// Pure-TS Deterministic 60 Hz Marchland Simulation Engine (zero three.js or DOM imports!).
// Owns:
//   - TerrainField + MapLayoutSpec + NavGrid (2 m A*) + ForestGrid (12 m clearing)
//   - Fixed 60 Hz step(dtS) driving Economy, Combat, Fair-Economy AI, and Game Modes / Campaign M1–M5
//   - Full deterministic JSON serialization (`toSnapshot` / `fromSnapshot`) + bit-identical `getFingerprint()`!

import {
  ALL_GOODS,
  BUILDING_DEFS,
  CAMPAIGN,
  ECONOMY,
  SIM,
  type BuildingTypeId,
  type GoodId,
} from '../config.ts';
import { getAiProductionMultiplier, getAiReactionIntervalS, stepAiForSide } from './ai.ts';
import { countAliveSoldiers, spawnRegiment, stepCombat } from './combat.ts';
import { executeCommand, validateBuildingPlacement } from './commands.ts';
import { countPopulation, spawnCitizen, stepEconomy } from './economy.ts';
import { buildMapLayout, type BuildingKind, type MapLayoutSpec } from './maps.ts';
import { applyMissionSetup, createInitialTutorialSteps, stepScenario } from './modes.ts';
import { NavGrid } from './pathing.ts';
import { TerrainField } from './terrain.ts';
import { ForestGrid } from './trees.ts';
import type {
  BuildingEntity,
  CommandResult,
  PlacementRejectionReason,
  SideId,
  SideState,
  SimCommand,
  SimInitOptions,
  SimWorldState,
} from './types.ts';

function createEmptyStock(): Record<GoodId, number> {
  const s = {} as Record<GoodId, number>;
  for (const g of ALL_GOODS) s[g] = 0;
  return s;
}

function createSideState(side: SideId): SideState {
  const stock = createEmptyStock();
  for (const g of Object.keys(ECONOMY.startingStock) as GoodId[]) {
    stock[g] = ECONOMY.startingStock[g] ?? 0;
  }
  return {
    side,
    stock,
    ledger: [],
    currentBucketProduced: {},
    currentBucketConsumed: {},
    ledgerAccumS: 0,
    unpaidUpkeepS: 0,
    unpaidPenaltyActive: false,
    armyStarving: false,
    hasChapel: false,
    totalKills: 0,
    totalLosses: 0,
    buildingsLost: 0,
    tributePaid: false,
  };
}

function mapVisualKindToBuildingType(kind: BuildingKind): BuildingTypeId {
  switch (kind) {
    case 'keep_l1':
    case 'fortress_donzon':
      return 'keep';
    case 'house_l1':
      return 'house';
    case 'woodcutter_l1':
      return 'woodcutter';
    case 'farm_l1':
      return 'farm';
    case 'windmill_l1':
      return 'windmill';
    case 'bakery_l1':
      return 'bakery';
    case 'watchtower_l1':
      return 'watchtower';
    case 'gate_l1':
      return 'gate';
    case 'chapel_l1':
      return 'chapel';
    case 'smithy_l1':
      return 'smithy';
    case 'barracks_l1':
      return 'barracks';
    case 'market_l1':
      return 'market';
    case 'well_l1':
      return 'well';
    case 'storehouse_l1':
      return 'storehouse';
    case 'fisher_l1':
      return 'fisher';
    case 'camp_tent_l1':
      return 'campTent';
    case 'ruin_house':
      return 'ruin';
  }
}

export interface SimSnapshot {
  readonly version: 1;
  readonly options: SimInitOptions;
  readonly state: SimWorldState;
}

export class SimEngine {
  readonly options: SimInitOptions;
  readonly layout: MapLayoutSpec;
  readonly terrain: TerrainField;
  readonly nav: NavGrid;
  readonly forest: ForestGrid;
  state: SimWorldState;
  private navDirty = false;
  /** Optional symmetric AI-vs-AI testing switch (enables fair AI on side 0 as well!). */
  aiControlsSide0 = false;

  constructor(options: SimInitOptions, restoredState?: SimWorldState) {
    this.options = options;
    this.layout = buildMapLayout(options.mapId);
    this.terrain = new TerrainField(this.layout.terrainConfig);
    this.nav = new NavGrid(this.terrain);

    if (restoredState) {
      this.state = structuredClone(restoredState);
      this.forest = new ForestGrid(this.state.trees);
      this.rebuildNav();
      return;
    }

    const seed = options.seed ?? SIM.defaultSeed;
    const mode = options.mode ?? 'skirmish';
    const missionId = mode === 'campaign' ? (options.missionId ?? 1) : null;
    const difficulty = options.difficulty ?? 'normal';
    const aiPersonality = options.aiPersonality ?? (['builder', 'raider', 'knight'] as const)[seed % 3]!;

    const state: SimWorldState = {
      mapId: options.mapId,
      seed,
      tick: 0,
      timeS: 0,
      nextEntityId: 1,
      nextOrderId: 1,
      nextAlertId: 1,
      rngState: (seed * 2654435761) >>> 0 || 1,
      sides: [createSideState(0), createSideState(1)],
      buildings: [],
      walls: [],
      gates: [],
      roads: this.layout.roads.flatMap((poly) => {
        const segs: { x0: number; z0: number; x1: number; z1: number; widthM: number }[] = [];
        for (let i = 0; i + 1 < poly.length; i++) {
          segs.push({
            x0: poly[i]![0],
            z0: poly[i]![1],
            x1: poly[i + 1]![0],
            z1: poly[i + 1]![1],
            widthM: 4.5,
          });
        }
        return segs;
      }),
      trees: this.layout.trees.map((t, idx) => ({
        id: idx + 1,
        species: t.species,
        x: t.x,
        z: t.z,
        yawRad: t.yawRad,
        scale: t.scale,
        state: 'mature',
        regrowTimerS: 0,
        reservedByCitizenId: null,
      })),
      outcrops: [],
      citizens: [],
      regiments: [],
      projectiles: [],
      capturePoints: this.layout.capturePoints.map((cp, idx) => ({
        id: cp.id,
        kind: idx === 0 ? 'village' : idx === 1 ? 'mine' : 'quarry',
        label: cp.label,
        x: cp.x,
        z: cp.z,
        owner: null,
        capturingSide: null,
        captureProgressS: 0,
        incomeAccumS: 0,
      })),
      alerts: [],
      fxEvents: [],
      timeline: [],
      scenario: {
        mode,
        missionId,
        difficulty,
        aiPersonality,
        deadlineS: mode === 'defence' ? CAMPAIGN.defenceWinTimeS : null,
        waveIndex: 0,
        nextWaveTimeS: CAMPAIGN.defenceFirstWaveS,
        firedTriggers: [],
        allEnemyRoutingS: 0,
        playerNoRegimentsS: 0,
        fortressBreachedAtS: null,
        playerCannonsLost: 0,
        tutorialSteps: mode === 'tutorial' ? createInitialTutorialSteps() : [],
        outcome: 'playing',
        outcomeReason: '',
        starsEarned: 0,
      },
      roleAllocTimerS: 0,
      aiTimerS: 0,
      timelineTimerS: 0,
      visualRevision: 1,
    };
    state.nextEntityId = state.trees.length + 10;

    const [pkx, pkz] = this.layout.playerKeepXZ;
    const [ekx, ekz] = this.layout.enemyCenterXZ;
    // Seed stone & iron ore outcrops directly from shared MapLayoutSpec so 3D rock clusters, minimap & Quarry/Mine placement match 100%
    for (const o of this.layout.outcrops) {
      state.outcrops.push({ kind: o.kind, x: o.x, z: o.z });
    }

    const addCompletedBuilding = (
      side: SideId,
      type: BuildingTypeId,
      x: number,
      z: number,
      yawRad: number,
      isFortressDonzon = false,
    ): BuildingEntity => {
      const def = BUILDING_DEFS[type];
      const b: BuildingEntity = {
        id: state.nextEntityId++,
        side,
        type,
        level: 1,
        x,
        z,
        yawRad,
        hp: def.maxHp,
        maxHp: def.maxHp,
        buildProgress: 1,
        buildCostNeeded: {},
        buildCostDelivered: {},
        upgradingToLevel: null,
        upgradeTimerS: 0,
        paused: false,
        status: 'idle',
        inputs: {},
        yard: {},
        residents: type === 'keep' ? ECONOMY.keepResidents : type === 'house' ? 4 : 0,
        houseFoodRations: type === 'house' ? 5 : 0,
        houseWineCasks: 0,
        hungry: false,
        growthTimerS: 0,
        cycleTimerS: 0,
        yardFullTimerS: 0,
        strips:
          type === 'farm' || type === 'vineyard'
            ? Array.from({ length: ECONOMY.farmStripsByLevel[0] }, () => ({ phase: 'growing' as const, timerS: 20, growth01: 0.35 }))
            : [],
        recruitQueue: [],
        fireCooldownS: 0,
        garrisonRegimentIds: [],
        garrisonType: null,
        garrisonCount: 0,
        isFortressDonzon,
      };
      state.buildings.push(b);
      for (let i = 0; i < b.residents; i++) {
        spawnCitizen(state, side, b);
      }
      return b;
    };

    if (options.showcaseMode || mode === 'campaign') {
      // Populate from MapLayoutSpec buildings, walls & gates!
      for (const spec of this.layout.buildings) {
        const bType = mapVisualKindToBuildingType(spec.kind);
        if (bType === 'gate') {
          state.gates.push({
            id: state.nextEntityId++,
            side: spec.team,
            x: spec.x,
            z: spec.z,
            yawRad: spec.yawRad,
            hp: ECONOMY.gateHp,
            maxHp: ECONOMY.gateHp,
            openFraction: 0,
            destroyed: false,
          });
        } else {
          addCompletedBuilding(spec.team, bType, spec.x, spec.z, spec.yawRad, spec.kind === 'fortress_donzon');
        }
      }
      for (const w of this.layout.walls) {
        const wSide: SideId = Math.hypot(w.x - pkx, w.z - pkz) < Math.hypot(w.x - ekx, w.z - ekz) ? 0 : 1;
        state.walls.push({
          id: state.nextEntityId++,
          side: wSide,
          x: w.x,
          z: w.z,
          yawRad: w.yawRad,
          hp: ECONOMY.wallSegmentHp,
          maxHp: ECONOMY.wallSegmentHp,
          destroyed: false,
        });
      }

      // Ensure both sides have a Keep on Skirmish/Showcase; on Campaign M1-M4 player always has Keep
      if (!state.buildings.some((b) => b.side === 0 && b.type === 'keep')) {
        addCompletedBuilding(0, 'keep', pkx, pkz, 0.15);
      }
      if (options.showcaseMode && mode !== 'campaign') {
        // Spawn lively opposing medieval armies for immediate playable action!
        spawnRegiment(state, 0, 'swordsmen', pkx + 88, pkz - 2, Math.PI * 0.5);
        spawnRegiment(state, 0, 'pikemen', pkx + 88, pkz + 14, Math.PI * 0.5);
        spawnRegiment(state, 0, 'archers', pkx + 68, pkz - 4, Math.PI * 0.5);
        spawnRegiment(state, 0, 'lightCav', pkx + 68, pkz + 18, Math.PI * 0.5);
        spawnRegiment(state, 1, 'swordsmen', ekx - 42, ekz - 2, -Math.PI * 0.5);
        spawnRegiment(state, 1, 'crossbowmen', ekx - 28, ekz + 10, -Math.PI * 0.5);
        spawnRegiment(state, 1, 'heavyCav', ekx - 40, ekz - 16, -Math.PI * 0.5);
        if (!state.buildings.some((b) => b.side === 1 && b.type === 'keep')) {
          addCompletedBuilding(1, 'keep', ekx, ekz, -Math.PI * 0.5);
        }
      }
      if (mode === 'campaign' && missionId !== null) {
        applyMissionSetup(state, missionId, options.carryOver);
      }
    } else {
      // Pure minute-one Skirmish / Defence / Tutorial start: Keep + 8 residents + 340g / 90t / 40s / 40b!
      addCompletedBuilding(0, 'keep', pkx, pkz, 0.15);
      if (mode === 'skirmish') {
        addCompletedBuilding(1, 'keep', ekx, ekz, -Math.PI * 0.5);
      }
    }

    this.state = state;
    this.forest = new ForestGrid(this.state.trees);
    this.rebuildNav();
  }

  rebuildNav(): void {
    this.nav.rebuildDynamic(
      this.state.roads,
      this.state.buildings,
      this.state.walls,
      this.state.gates,
      (x, z) => this.forest.isForestAt(x, z),
    );
    this.navDirty = false;
  }

  validatePlacement(
    side: SideId,
    buildingType: BuildingTypeId,
    x: number,
    z: number,
    yawRad: number,
    checkResources = true,
  ): PlacementRejectionReason {
    return validateBuildingPlacement(this.state, side, buildingType, x, z, yawRad, this.terrain, this.forest, checkResources);
  }

  execute(cmd: SimCommand): CommandResult {
    return executeCommand(this.state, cmd, this.terrain, this.nav, this.forest, () => {
      this.navDirty = true;
    });
  }

  /** Advances deterministic simulation by exactly `dtS` (usually `1/60 s`). */
  step(dtS = SIM.fixedStepS): void {
    if (this.navDirty) this.rebuildNav();

    this.state.tick++;
    this.state.timeS += dtS;

    const aiProdMul = getAiProductionMultiplier(this.state.scenario.difficulty);
    const { forestChanged } = stepEconomy(this.state, dtS, this.terrain, this.nav, this.forest, aiProdMul);
    if (forestChanged) this.navDirty = true;

    const { navDirty: combatNavDirty } = stepCombat(this.state, dtS, this.terrain, this.nav);
    if (combatNavDirty) this.navDirty = true;

    // Fair-economy AI (Skirmish & AI-vs-AI tests; respects reaction delay 6s / 3s / 1s!)
    if (!this.options.disableAi && this.state.scenario.mode === 'skirmish') {
      this.state.aiTimerS += dtS;
      const reactS = getAiReactionIntervalS(this.state.scenario.difficulty);
      if (this.state.aiTimerS >= reactS) {
        this.state.aiTimerS -= reactS;
        stepAiForSide(
          this.state,
          1,
          this.state.scenario.aiPersonality,
          this.state.scenario.difficulty,
          this.terrain,
          this.nav,
          this.forest,
          () => {
            this.navDirty = true;
          },
        );
        if (this.aiControlsSide0) {
          stepAiForSide(
            this.state,
            0,
            'builder',
            this.state.scenario.difficulty,
            this.terrain,
            this.nav,
            this.forest,
            () => {
              this.navDirty = true;
            },
          );
        }
      }
    }

    stepScenario(this.state, dtS);

    // Sample timeline telemetry every 30 s for end-screen graphs
    this.state.timelineTimerS += dtS;
    if (this.state.timelineTimerS >= 30) {
      this.state.timelineTimerS -= 30;
      const p0Pop = countPopulation(this.state, 0).total;
      const p1Pop = countPopulation(this.state, 1).total;
      const p0Army = this.state.regiments.filter((r) => r.side === 0).reduce((s, r) => s + countAliveSoldiers(r), 0);
      const p1Army = this.state.regiments.filter((r) => r.side === 1).reduce((s, r) => s + countAliveSoldiers(r), 0);
      this.state.timeline.push({
        timeS: Math.round(this.state.timeS),
        p0Pop,
        p0Army,
        p0Gold: Math.floor(this.state.sides[0].stock.gold),
        p1Pop,
        p1Army,
        p1Gold: Math.floor(this.state.sides[1].stock.gold),
      });
    }

    if (this.navDirty) this.rebuildNav();
  }

  /** Drains per-frame audio/visual FX events (cannon blasts, mortar impacts, sword clashes, etc.). */
  drainFxEvents(): SimWorldState['fxEvents'] {
    if (this.state.fxEvents.length === 0) return [];
    const copy = this.state.fxEvents.slice();
    this.state.fxEvents.length = 0;
    return copy;
  }

  /** Serializes full deterministic simulation state for save/load (BRIEF.md F22). */
  toSnapshot(): string {
    const snap: SimSnapshot = {
      version: 1,
      options: this.options,
      state: this.state,
    };
    return JSON.stringify(snap);
  }

  /** Restores an exact bit-deterministic `SimEngine` from a snapshot string. */
  static fromSnapshot(json: string): SimEngine {
    const snap = JSON.parse(json) as SimSnapshot;
    if (snap.version !== 1) throw new Error(`Unsupported snapshot version: ${String(snap.version)}`);
    return new SimEngine(snap.options, snap.state);
  }

  /** Deterministic numeric fingerprint (FNV-1a 32-bit over core state) verifying save/load determinism! */
  getFingerprint(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      const iv = Math.round(v * 1000) | 0;
      h ^= iv & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (iv >> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (iv >> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (iv >> 24) & 0xff;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.state.tick);
    mix(this.state.rngState);
    for (const s of this.state.sides) {
      mix(s.stock.gold);
      mix(s.stock.timber);
      mix(s.stock.stone);
      mix(s.stock.bread);
      mix(s.stock.weapons);
      mix(s.totalKills);
      mix(s.totalLosses);
    }
    for (const b of this.state.buildings) {
      mix(b.id);
      mix(b.hp);
      mix(b.buildProgress);
      mix(b.residents);
      mix(b.houseFoodRations);
    }
    for (const c of this.state.citizens) {
      mix(c.id);
      mix(c.x);
      mix(c.z);
    }
    for (const r of this.state.regiments) {
      mix(r.id);
      mix(r.x);
      mix(r.z);
      mix(r.morale);
      mix(countAliveSoldiers(r));
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
}
