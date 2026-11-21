// Pure-TS Marchland Simulation Types (zero three.js or DOM imports, strict TS, no any).

import type {
  BuildingTypeId,
  GoodId,
  ResourceMap,
  UnitTypeId,
} from '../config.ts';
import type { MapLayoutId } from './terrain.ts';

export type SideId = 0 | 1;
export type GameMode = 'skirmish' | 'defence' | 'tutorial' | 'campaign';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type AiPersonality = 'builder' | 'raider' | 'knight';
export type KeepSlot = 0 | 1 | 2;
export type CampaignMissionId = 1 | 2 | 3 | 4 | 5;

export type FormationKind = 'line' | 'column' | 'schiltron' | 'wedge' | 'loose';
export type StanceKind = 'hold' | 'guard' | 'skirmish' | 'shieldWall' | 'pikeWall';

export type OrderKind =
  | 'march'
  | 'run'
  | 'attack'
  | 'charge'
  | 'retreatFacing'
  | 'halt'
  | 'fallbackKeep'
  | 'garrison';

export interface RegimentOrder {
  readonly kind: OrderKind;
  readonly x: number;
  readonly z: number;
  readonly facingYawRad?: number;
  readonly width?: number;
  readonly ranks?: number;
  readonly targetRegimentId?: number;
  readonly targetBuildingId?: number;
  readonly targetWallId?: number;
}

export type CitizenRole = 'worker' | 'builder' | 'carrier' | 'recruit';

export interface CarryJob {
  readonly good: GoodId;
  readonly amount: number;
  readonly fromBuildingId: number;
  readonly toBuildingId: number;
  /** True if carrying to construction materials store, false for normal input/pantry/depot. */
  readonly forConstruction: boolean;
  /** True once picked up from source (visually carried on back!). */
  pickedUp: boolean;
  transferTimerS: number;
}

export interface TownsfolkEntity {
  readonly id: number;
  side: SideId;
  role: CitizenRole;
  homeBuildingId: number;
  assignedBuildingId: number | null;
  x: number;
  z: number;
  yawRad: number;
  travelM: number;
  fleeing: boolean;
  fleeClearTimerS: number;
  /** Target position or waypoint path for walking. */
  path: { x: number; z: number }[];
  carryJob: CarryJob | null;
  /** Active recruit order destination (barracks/keep ID + regiment type). */
  recruitTargetBuildingId: number | null;
  recruitOrderId: number | null;
  /** Work trip state for woodcutter/fisher/forester. */
  workPhase: 'atShop' | 'toField' | 'working' | 'returning';
  workTargetX: number;
  workTargetZ: number;
  workTargetTreeId: number | null;
  workTimerS: number;
  carryingGood: GoodId | null;
  carryingAmount: number;
}

export interface FarmStripState {
  phase: 'uncleared' | 'sowing' | 'growing' | 'ready';
  timerS: number;
  /** 0..1 visual growth progress (ploughed -> green -> golden wheat / vine). */
  growth01: number;
}

export interface RecruitQueueItem {
  readonly orderId: number;
  readonly unitType: UnitTypeId;
  readonly neededCrew: number;
  arrivedCrew: number;
  trainTimerS: number;
}

export type BuildingStatus =
  | 'constructing'
  | 'upgrading'
  | 'working'
  | 'paused'
  | 'noWorker'
  | 'noInput'
  | 'yardFull'
  | 'idle'
  | 'ruin';

export interface BuildingEntity {
  readonly id: number;
  side: SideId;
  type: BuildingTypeId;
  /** For Mission 4 rebuildable ruins: original building type restored at half price. */
  ruinTargetType?: BuildingTypeId;
  level: 1 | 2 | 3;
  x: number;
  z: number;
  yawRad: number;
  hp: number;
  maxHp: number;
  /** 0..1 construction progress; 1 = completed. */
  buildProgress: number;
  /** Construction / upgrade materials needed vs delivered on site. */
  buildCostNeeded: ResourceMap;
  buildCostDelivered: ResourceMap;
  /** Upgrade state (if upgrading from level -> level+1). */
  upgradingToLevel: (2 | 3) | null;
  upgradeTimerS: number;
  paused: boolean;
  status: BuildingStatus;
  /** Workshop input buffer (max 8 per good) and yard output buffer (max 24 total). */
  inputs: ResourceMap;
  yard: ResourceMap;
  /** Remaining production orders for armament workshops (starts at 0; regulated via Barracks). */
  pendingOrders?: number;
  /** House residents & pantry (rations + wine casks). */
  residents: number;
  houseFoodRations: number;
  houseWineCasks: number;
  hungry: boolean;
  growthTimerS: number;
  /** Active work cycle progress (seconds). */
  cycleTimerS: number;
  /** Time spent with full yard (triggers bottleneck alert after 60 s). */
  yardFullTimerS: number;
  /** Farm / Vineyard strips behind the building. */
  strips: FarmStripState[];
  /** Barracks / Keep / GunFoundry recruitment queue (max 3). */
  recruitQueue: RecruitQueueItem[];
  /** Watchtower / Keep arrow cooldown & garrisoned archer/crossbowmen count. */
  fireCooldownS: number;
  garrisonRegimentIds: number[];
  garrisonType: 'archers' | 'crossbowmen' | null;
  garrisonCount: number;
  /** Mission 5 indestructible Fortress Donżon flag. */
  indestructible?: boolean;
  /** True if this building is the Fortress Donżon visual override. */
  isFortressDonzon?: boolean;
}

export interface WallSegmentEntity {
  readonly id: number;
  readonly side: SideId;
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface GateEntity {
  readonly id: number;
  readonly side: SideId;
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  hp: number;
  maxHp: number;
  /** 0 = closed, 1 = open (auto-opens for friendlies within 9 m). */
  openFraction: number;
  destroyed: boolean;
}

export interface TreeEntity {
  readonly id: number;
  readonly species: 'oak' | 'pine' | 'birch';
  readonly x: number;
  readonly z: number;
  readonly yawRad: number;
  readonly scale: number;
  state: 'mature' | 'stump' | 'sapling';
  regrowTimerS: number;
  reservedByCitizenId: number | null;
}

export interface SoldierEntity {
  readonly slotIndex: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  yawRad: number;
  /** Total meters walked -> drives foot-locked animation stride (zero foot slide!). */
  travelM: number;
  /** Instantaneous movement speed (m/s) for walk/run/gallop clip selection. */
  speedMs?: number;
  clip: 'idle' | 'walk' | 'attack';
  attackAnimTimerS: number;
  /** Seconds elapsed since last melee strike or shot (drives rigged strike/recoil clips). */
  sinceAttackS?: number;
  /** Simulation time when last wounded (drives rigged impact/flinch clip). */
  hurtAtS?: number;
  /** Seconds elapsed since death (drives rigged death clip & body sink). */
  deadS?: number;
  meleeCooldownS: number;
  rangedCooldownS: number;
  tintVar: number;
}

export interface RegimentEntity {
  readonly id: number;
  readonly side: SideId;
  unitType: UnitTypeId;
  x: number;
  z: number;
  yawRad: number;
  formation: FormationKind;
  stance: StanceKind;
  holdFire: boolean;
  /** Number of soldiers in front rank (1..20). */
  width: number;
  /** Configured number of ranks/rows (szeregi, 1..6). */
  ranks?: number;
  maxMen: number;
  soldiers: SoldierEntity[];
  /** Regiment Captain alive behind ranks (not present on artillery). */
  captainAlive: boolean;
  morale: number;
  maxMorale: number;
  /** 0 = fresh, 1 = exhausted. */
  fatigue: number;
  routing: boolean;
  /** Cumulative kills for 2 veteran tiers (0.6 and 1.5 kills/man). */
  kills: number;
  veteranTier: 0 | 1 | 2;
  /** Current speed (m/s) & active charge timer (s). */
  currentSpeedMs: number;
  chargeTimerS: number;
  /** Time since last engaged in combat (for out-of-combat reinforcement & morale recovery). */
  outOfCombatS: number;
  /** Active order + Shift-queued follow-up orders. */
  order: RegimentOrder | null;
  orderQueue: RegimentOrder[];
  /** Path waypoints computed by A* for current march/attack order. */
  path: { x: number; z: number }[];
  /** Refitting state (20 s at <= 40 m from own barracks). */
  refittingTo: UnitTypeId | null;
  refitTimerS: number;
  /** Reinforcement accumulator (s). */
  reinforceTimerS: number;
  /** Garrisoned inside Watchtower or Keep ID (null if on field). */
  garrisonedInBuildingId: number | null;
  /** True for Defence wave units or scenario units that pay no gold upkeep. */
  noUpkeep?: boolean;
  /** Optional scenario role tag (e.g., 'm5_guard', 'm5_sortie', 'm2_camp'). */
  scenarioTag?: string;
}

export interface ProjectileEntity {
  readonly id: number;
  readonly side: SideId;
  readonly kind: 'arrow' | 'bolt' | 'cannonball' | 'mortar';
  readonly sourceRegimentId: number | null;
  x: number;
  y: number;
  z: number;
  readonly startX: number;
  readonly startY: number;
  readonly startZ: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  readonly flightTimeS: number;
  elapsedS: number;
  readonly arcHeightM: number;
  readonly damage: number;
  readonly armorPierce: number;
  readonly splashRadiusM: number;
  readonly buildingDamage: number;
  readonly targetRegimentId: number | null;
  readonly targetBuildingId: number | null;
  readonly targetWallId: number | null;
  readonly shooterAccuracyMul: number;
}

export interface CapturePointEntity {
  readonly id: string;
  readonly kind: 'mine' | 'quarry' | 'village';
  readonly label: string;
  readonly x: number;
  readonly z: number;
  owner: SideId | null;
  capturingSide: SideId | null;
  captureProgressS: number;
  incomeAccumS: number;
}

export interface OutcropEntity {
  readonly kind: 'stone' | 'ore';
  readonly x: number;
  readonly z: number;
}

export interface AlertEvent {
  readonly id: number;
  readonly timeS: number;
  readonly side: SideId;
  readonly kind:
    | 'enemyInVillage'
    | 'enemyAtKeep'
    | 'hunger'
    | 'regimentRout'
    | 'regimentLost'
    | 'buildingLost'
    | 'wallBreached'
    | 'yardFull'
    | 'pointCaptured'
    | 'tributePaid'
    | 'waveIncoming'
    | 'missionInfo';
  readonly x: number;
  readonly z: number;
  readonly detail: string;
}

export interface FxEvent {
  readonly kind: 'cannonMuzzle' | 'mortarImpact' | 'arrowHit' | 'swordClash' | 'horn' | 'buildHammer' | 'woodChop' | 'wallCollapse';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly intensity: number;
}

export interface ProductionWindowSample {
  readonly timeS: number;
  readonly produced: ResourceMap;
  readonly consumed: ResourceMap;
}

export interface SavedFormationSlot {
  readonly regimentId: number;
  readonly unitType: UnitTypeId;
  /** Local right offset (m) relative to formation centroid & facing. */
  readonly rightM: number;
  /** Local forward offset (m) relative to formation centroid & facing. */
  readonly forwardM: number;
  /** Relative yaw offset (rad) from overall formation facing. */
  readonly relYawRad: number;
  readonly formation: FormationKind;
  readonly ranks: number;
  readonly width: number;
}

export interface SavedArmyFormation {
  readonly id: number;
  readonly name: string;
  readonly slots: readonly SavedFormationSlot[];
}

export interface SideState {
  readonly side: SideId;
  /** Shared town warehouse (Keep + all completed Storehouses). */
  stock: Record<GoodId, number>;
  /** Rolling 2-minute production/consumption ledger (sampled every 10 s). */
  ledger: ProductionWindowSample[];
  currentBucketProduced: ResourceMap;
  currentBucketConsumed: ResourceMap;
  ledgerAccumS: number;
  /** Gold upkeep unpaid duration (s). */
  unpaidUpkeepS: number;
  unpaidPenaltyActive: boolean;
  /** Starvation flag (Keep food store empty -> −25 army morale). */
  armyStarving: boolean;
  /** Active Chapel count (> 0 -> +6 army morale). */
  hasChapel: boolean;
  /** Telemetry counters for end-screen timeline charts & star ratings. */
  totalKills: number;
  totalLosses: number;
  buildingsLost: number;
  tributePaid: boolean;
  /** Transport logistics level (1 = On Foot, 2 = Handcarts, 3 = Horse & Wagon). */
  transportLevel: 1 | 2 | 3;
  upgradingTransportTo: 2 | 3 | null;
  transportUpgradeTimerS: number;
  /** Per-good carrier priority (-1 = low, 0 = normal, 1 = high). */
  goodPriorities?: Partial<Record<GoodId, -1 | 0 | 1>>;
  /** Queued barracks equipment orders waiting for a workshop of that type to be built/assigned. */
  equipmentOrders?: ResourceMap;
  /** Multi-regiment formations saved by the player/side. */
  savedFormations?: SavedArmyFormation[];
}

export interface TimelinePoint {
  readonly timeS: number;
  readonly p0Pop: number;
  readonly p0Army: number;
  readonly p0Gold: number;
  readonly p1Pop: number;
  readonly p1Army: number;
  readonly p1Gold: number;
}

export interface TutorialStepState {
  readonly id: string;
  readonly completed: boolean;
}

export interface ScenarioState {
  readonly mode: GameMode;
  readonly missionId: CampaignMissionId | null;
  readonly difficulty: Difficulty;
  readonly aiPersonality: AiPersonality;
  /** Mission / Defence countdown or elapsed milestones. */
  deadlineS: number | null;
  waveIndex: number;
  nextWaveTimeS: number;
  /** Tracked scenario triggers fired so each fires exactly once. */
  firedTriggers: string[];
  /** Mission 1 post-deadline rout timer (needs 180 s all enemy routing/dead). */
  allEnemyRoutingS: number;
  /** Mission 5 zero-regiment defeat timer (60 s) + breach time + cannons lost. */
  playerNoRegimentsS: number;
  fortressBreachedAtS: number | null;
  playerCannonsLost: number;
  /** Tutorial 7-step progress. */
  tutorialSteps: TutorialStepState[];
  /** Victory / Defeat outcome + star rating (1..3). */
  outcome: 'playing' | 'victory' | 'defeat';
  outcomeReason: string;
  starsEarned: number;
}

export interface CarryOverRegimentSpec {
  readonly unitType: UnitTypeId;
  readonly aliveMen: number;
  readonly kills: number;
  readonly veteranTier: 0 | 1 | 2;
}

export interface CampaignCarryOver {
  readonly gold: number;
  readonly regiments: readonly CarryOverRegimentSpec[];
}

export interface SimInitOptions {
  readonly mapId: MapLayoutId;
  readonly seed?: number;
  readonly mode?: GameMode;
  readonly missionId?: CampaignMissionId;
  readonly difficulty?: Difficulty;
  readonly aiPersonality?: AiPersonality;
  readonly keepSlot?: KeepSlot;
  readonly carryOver?: CampaignCarryOver;
  /** If true, populates rich demo town + opposing armies right away (used for Stage 5/6 showcase & battle testing). */
  readonly showcaseMode?: boolean;
  /** Disable AI controller (for deterministic headless unit tests & duels). */
  readonly disableAi?: boolean;
}

export type PlacementRejectionReason =
  | 'ok'
  | 'outOfBounds'
  | 'water'
  | 'mountain'
  | 'tooSteep'
  | 'outOfReach'
  | 'tooCloseEnemyKeep'
  | 'blocked'
  | 'needsForest'
  | 'needsLake'
  | 'needsStone'
  | 'needsOre'
  | 'maxBuildings'
  | 'insufficientResources';

export type SimCommand =
  | { readonly type: 'placeBuilding'; readonly side: SideId; readonly buildingType: BuildingTypeId; readonly x: number; readonly z: number; readonly yawRad: number }
  | { readonly type: 'upgradeBuilding'; readonly side: SideId; readonly buildingId: number }
  | { readonly type: 'demolishBuilding'; readonly side: SideId; readonly buildingId: number }
  | { readonly type: 'togglePauseBuilding'; readonly side: SideId; readonly buildingId: number }
  | { readonly type: 'rotateBuilding'; readonly side: SideId; readonly buildingId: number; readonly yawRad: number }
  | { readonly type: 'rebuildRuin'; readonly side: SideId; readonly buildingId: number }
  | { readonly type: 'placeRoad'; readonly side: SideId; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }
  | { readonly type: 'placeWall'; readonly side: SideId; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }
  | { readonly type: 'placeGate'; readonly side: SideId; readonly x: number; readonly z: number; readonly yawRad: number }
  | { readonly type: 'marketTrade'; readonly side: SideId; readonly good: GoodId; readonly action: 'buy' | 'sell' }
  | { readonly type: 'recruit'; readonly side: SideId; readonly unitType: UnitTypeId; readonly buildingId?: number }
  | { readonly type: 'orderUnitEquipment'; readonly side: SideId; readonly unitType: UnitTypeId; readonly count?: number }
  | { readonly type: 'setBuildingOrder'; readonly side: SideId; readonly buildingId: number; readonly orders: number }
  | { readonly type: 'refitRegiment'; readonly side: SideId; readonly regimentId: number; readonly targetType: UnitTypeId }
  | { readonly type: 'reinforceRegiment'; readonly side: SideId; readonly regimentId: number }
  | { readonly type: 'mergeRegiments'; readonly side: SideId; readonly primaryId: number; readonly secondaryId: number }
  | { readonly type: 'disbandRegiment'; readonly side: SideId; readonly regimentId: number }
  | { readonly type: 'issueOrder'; readonly side: SideId; readonly regimentIds: readonly number[]; readonly order: RegimentOrder; readonly queue?: boolean }
  | { readonly type: 'setFormation'; readonly side: SideId; readonly regimentIds: readonly number[]; readonly formation: FormationKind }
  | { readonly type: 'setRanks'; readonly side: SideId; readonly regimentIds: readonly number[]; readonly ranks: number }
  | { readonly type: 'saveArmyFormation'; readonly side: SideId; readonly regimentIds: readonly number[]; readonly name?: string }
  | { readonly type: 'deleteArmyFormation'; readonly side: SideId; readonly formationId: number }
  | { readonly type: 'setStance'; readonly side: SideId; readonly regimentIds: readonly number[]; readonly stance: StanceKind }
  | { readonly type: 'setHoldFire'; readonly side: SideId; readonly regimentIds: readonly number[]; readonly holdFire: boolean }
  | { readonly type: 'setGoodPriority'; readonly side: SideId; readonly good: GoodId; readonly priority: -1 | 0 | 1 }
  | { readonly type: 'upgradeTransport'; readonly side: SideId }
  | { readonly type: 'ungarrisonWatchtower'; readonly side: SideId; readonly buildingId: number }
  | { readonly type: 'payTribute'; readonly side: SideId };

export interface CommandResult {
  readonly ok: boolean;
  readonly reason: string;
  readonly createdId?: number;
}

export interface RoadSegmentRecord {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly widthM: number;
}

export interface SimWorldState {
  readonly mapId: MapLayoutId;
  readonly seed: number;
  tick: number;
  timeS: number;
  nextEntityId: number;
  nextOrderId: number;
  nextAlertId: number;
  rngState: number;
  sides: [SideState, SideState];
  buildings: BuildingEntity[];
  walls: WallSegmentEntity[];
  gates: GateEntity[];
  roads: RoadSegmentRecord[];
  trees: TreeEntity[];
  outcrops: OutcropEntity[];
  citizens: TownsfolkEntity[];
  regiments: RegimentEntity[];
  projectiles: ProjectileEntity[];
  capturePoints: CapturePointEntity[];
  alerts: AlertEvent[];
  /** Per-frame transient FX events drained by renderer & sound engine each frame. */
  fxEvents: FxEvent[];
  timeline: TimelinePoint[];
  scenario: ScenarioState;
  /** 1-second role allocator & AI reaction accumulators. */
  roleAllocTimerS: number;
  aiTimerS: number;
  timelineTimerS: number;
  /** Dirty flags so renderer knows when dynamic GroundWorks / buildings / trees changed. */
  visualRevision: number;
}
