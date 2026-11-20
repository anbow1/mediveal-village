// Single source of truth for Marchland tuning constants (SI units in every identifier).
// Reference values: NUMBERS.md, GUIDE.md, docs/ECONOMY.md, docs/BUILDINGS.md, docs/UNITS.md.

export type QualityPreset = 'high' | 'low';
export type ToneMappingChoice = 'aces' | 'agx';
export type LightingPresetId = 'clearNoon' | 'lateAutumn' | 'goldenHour' | 'overcast';
export type LangCode = 'en' | 'pl';

export interface LightingPresetConfig {
  readonly id: LightingPresetId;
  /** Direct sun illuminance on a perpendicular surface (lux). Source: NUMBERS.md. */
  readonly sunIlluminanceLux: number;
  /** Diffuse hemispherical sky illuminance on a horizontal surface (lux). */
  readonly skyIlluminanceLux: number;
  /** Direct sun colour temperature (kelvin). Source: NUMBERS.md. */
  readonly sunKelvin: number;
  /** Sky zenith/dome colour temperature (kelvin). Source: NUMBERS.md. */
  readonly skyKelvin: number;
  /** Sun elevation above horizon (degrees). */
  readonly sunElevationDeg: number;
  /** Sun compass azimuth clockwise from +Z (degrees). */
  readonly sunAzimuthDeg: number;
  /** Screen-space sun shaft weight (0..1; multiplied by preset sample count). */
  readonly sunShaftStrength: number;
  /** Ground bounce albedo luminance factor for hemisphere/probe lower half. */
  readonly groundBounceFactor: number;
  /** Aerial perspective ground-level extinction coefficient (1/m). */
  readonly fogDensityPerM: number;
  /** Exponential height-fog vertical falloff (1/m; 0.014 -> ~71 m valley mist scale height). */
  readonly fogHeightFalloffPerM: number;
  /** Procedural high-altitude cloud deck coverage (0..1). */
  readonly cloudCoverage: number;
  /** Procedural cloud edge softness (0..1; higher in overcast for smooth cloud deck). */
  readonly cloudSoftness: number;
  /** Ambient ground contact-shadow opacity under foundations, trunks, barrels, and boots (0..1). */
  readonly contactShadowOpacity: number;
}

export interface QualityPresetConfig {
  readonly id: QualityPreset;
  /** Max device pixel ratio (phones use 2x with TRAA + sharpen per GUIDE.md §7). */
  readonly maxDpr: number;
  /** CSM shadow cascade count (High 3–4, Low 2 per GUIDE.md §4). */
  readonly shadowCascades: number;
  /** Shadow map resolution per cascade (px). */
  readonly shadowMapSizePx: number;
  /** Maximum CSM shadow distance from camera (m). */
  readonly shadowMaxFarM: number;
  /** Practical-logarithmic split blend lambda (0 = uniform, 1 = logarithmic). */
  readonly shadowSplitLambda: number;
  /** Extra light-space frustum pull-back margin so behind-camera hills/trees cast cleanly (m). */
  readonly shadowLightMarginM: number;
  /** Base cascade-0 depth bias (CSMShadowNode scales by i + 1 across cascades). */
  readonly shadowBias: number;
  /** World-space normal offset bias to prevent shadow acne on sloping masonry & timber (m). */
  readonly shadowNormalBias: number;
  /** TRAA enabled on every preset (GUIDE.md §2b, §4, §7). */
  readonly traaEnabled: boolean;
  /** CAS-style sharpen amount after tone map + sRGB (~0.30 High, ~0.25 Low). */
  readonly sharpenStrength: number;
  /** Radial sun shaft tap count (High 24, Low 0). */
  readonly sunShaftSamples: number;
  /** Physical bloom intensity (kept subtle so daylight does not haze). */
  readonly bloomStrength: number;
  /** Physical bloom threshold in pre-exposed linear scene units. */
  readonly bloomThreshold: number;
  /** Physical bloom blur radius. */
  readonly bloomRadius: number;
}

export interface GovernorStep {
  readonly label: string;
  readonly renderScale: number;
  readonly sunShaftSamples: number;
  readonly bloomEnabled: boolean;
}

export const SIM = {
  /** Fixed simulation tick interval (60 Hz, GUIDE.md §1). */
  fixedStepS: 1 / 60,
  /** Clamp incoming frame delta to avoid spiral of death after tab switches. */
  maxFrameDtS: 0.1,
  /** Maximum simulation ticks caught up in one visual frame. */
  maxStepsPerFrame: 4,
  defaultSeed: 3,
} as const;

export const WORLD = {
  /** Playable square battlefield side length (m). Source: docs/GAMEPLAY.md 2026-11-13. */
  sizeM: 560,
  halfSizeM: 280,
  /** Physical constants (SI). Source: GUIDE.md §4, NUMBERS.md. */
  gravityMs2: 9.81,
  airDensityKgM3: 1.225,
  speedOfSoundMs: 343,
} as const;

export const CAMERA = {
  fovDeg: 45,
  /** Reversed depth handles near 0.25 m .. far 1800 m cleanly without z-fighting. */
  nearM: 0.25,
  farM: 1800,
  minDistanceM: 8,
  /** High enough to frame the full 560 m map in strategic overview. */
  maxDistanceM: 520,
  defaultDistanceM: 52,
  /** ~45 deg downward RTS pitch. */
  defaultPitchRad: 0.76,
  minPitchRad: 0.16,
  maxPitchRad: 1.48,
  /** Pan speed at 50 m distance (scales linearly with distance). */
  panSpeedAt50mMs: 42,
  rotateSpeedRadS: 1.8,
  wheelZoomFactor: 0.14,
  /** Exponential smoothing time constant for camera motion (s). */
  smoothTauS: 0.08,
} as const;

export const CALIBRATION = {
  /** Standard photographic 18 % diffuse reflectance card/cube (linear). */
  greyReflectanceLinear: 0.18,
  greyRoughness: 0.9,
  cubeSizeM: 2.0,
  /** Default ground albedo for Stage 1 test slab (dry soil #6b5a47 from NUMBERS.md). */
  groundBaseHex: 0x6b5a47,
  groundRoughness: 0.92,
} as const;

export const EXPOSURE = {
  /** Outdoor auto-exposure floor below preset anchor EV100 (GUIDE.md §2b: ≤ 2.5 stops). */
  outdoorFloorStops: -2.5,
  /** Outdoor auto-exposure ceiling above preset anchor EV100. */
  outdoorCeilStops: 2.0,
  /** Bright-to-dark eye adaptation time constant (s, GUIDE.md §4). */
  adaptDownS: 2.0,
  /** Dark-to-bright eye adaptation time constant (s, GUIDE.md §4). */
  adaptUpS: 0.5,
  /** Default filmic tone mapper (A/B tested vs AgX in Stage 1). */
  defaultToneMapping: 'aces' as ToneMappingChoice,
} as const;

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPresetConfig> = {
  clearNoon: {
    id: 'clearNoon',
    sunIlluminanceLux: 100_000,
    skyIlluminanceLux: 22_000,
    sunKelvin: 5400,
    skyKelvin: 11_200,
    sunElevationDeg: 65,
    sunAzimuthDeg: 35,
    sunShaftStrength: 0.22,
    groundBounceFactor: 0.28,
    fogDensityPerM: 0.00045,
    fogHeightFalloffPerM: 0.015,
    cloudCoverage: 0.28,
    cloudSoftness: 0.34,
    contactShadowOpacity: 0.36,
  },
  lateAutumn: {
    id: 'lateAutumn',
    // Default Marchland look (docs/PLAYBOOK.md §2): vibrant late-afternoon early autumn, 30 deg sun, crisp shadows.
    sunIlluminanceLux: 45_000,
    skyIlluminanceLux: 11_000,
    sunKelvin: 4200,
    skyKelvin: 9400,
    sunElevationDeg: 30,
    sunAzimuthDeg: 48,
    sunShaftStrength: 0.48,
    groundBounceFactor: 0.27,
    fogDensityPerM: 0.00092,
    fogHeightFalloffPerM: 0.016,
    cloudCoverage: 0.4,
    cloudSoftness: 0.38,
    contactShadowOpacity: 0.42,
  },
  goldenHour: {
    id: 'goldenHour',
    sunIlluminanceLux: 12_000,
    skyIlluminanceLux: 4_500,
    sunKelvin: 3000,
    skyKelvin: 9800,
    sunElevationDeg: 12,
    sunAzimuthDeg: 65,
    sunShaftStrength: 0.78,
    groundBounceFactor: 0.25,
    fogDensityPerM: 0.00122,
    fogHeightFalloffPerM: 0.017,
    cloudCoverage: 0.45,
    cloudSoftness: 0.42,
    contactShadowOpacity: 0.42,
  },
  overcast: {
    id: 'overcast',
    // Overcast keeps ~19 % directional sky-break key light (GUIDE.md §2b: crisp northern emerald/slate overcast).
    sunIlluminanceLux: 2_000,
    skyIlluminanceLux: 8_500,
    sunKelvin: 5800,
    skyKelvin: 7600,
    sunElevationDeg: 48,
    sunAzimuthDeg: 40,
    sunShaftStrength: 0.0,
    groundBounceFactor: 0.3,
    fogDensityPerM: 0.00135,
    fogHeightFalloffPerM: 0.015,
    cloudCoverage: 0.86,
    cloudSoftness: 0.74,
    contactShadowOpacity: 0.48,
  },
};

export const QUALITY_PRESETS: Record<QualityPreset, QualityPresetConfig> = {
  high: {
    id: 'high',
    maxDpr: 2,
    shadowCascades: 3,
    shadowMapSizePx: 2048,
    shadowMaxFarM: 320,
    shadowSplitLambda: 0.68,
    shadowLightMarginM: 160,
    shadowBias: -0.00018,
    shadowNormalBias: 0.022,
    traaEnabled: true,
    sharpenStrength: 0.3,
    sunShaftSamples: 24,
    bloomStrength: 0.14,
    bloomThreshold: 1.85,
    bloomRadius: 0.42,
  },
  low: {
    id: 'low',
    maxDpr: 2,
    shadowCascades: 2,
    shadowMapSizePx: 1024,
    shadowMaxFarM: 200,
    shadowSplitLambda: 0.62,
    shadowLightMarginM: 130,
    shadowBias: -0.00028,
    shadowNormalBias: 0.044,
    traaEnabled: true,
    sharpenStrength: 0.25,
    sunShaftSamples: 0,
    bloomStrength: 0.09,
    bloomThreshold: 2.1,
    bloomRadius: 0.35,
  },
};

/** FrameGovernor quality steps: uniforms & render scale only, never recompiles shaders. */
export const GOVERNOR_STEPS: Record<QualityPreset, readonly GovernorStep[]> = {
  high: [
    { label: 'L0 100%', renderScale: 1.0, sunShaftSamples: 24, bloomEnabled: true },
    { label: 'L1 no-shafts', renderScale: 1.0, sunShaftSamples: 0, bloomEnabled: true },
    { label: 'L2 87%', renderScale: 0.87, sunShaftSamples: 0, bloomEnabled: true },
    { label: 'L3 76%', renderScale: 0.76, sunShaftSamples: 0, bloomEnabled: true },
    { label: 'L4 67%', renderScale: 0.67, sunShaftSamples: 0, bloomEnabled: false },
    { label: 'L5 58%', renderScale: 0.58, sunShaftSamples: 0, bloomEnabled: false },
  ],
  low: [
    { label: 'L0 100%', renderScale: 1.0, sunShaftSamples: 0, bloomEnabled: true },
    { label: 'L1 85%', renderScale: 0.85, sunShaftSamples: 0, bloomEnabled: true },
    { label: 'L2 72%', renderScale: 0.72, sunShaftSamples: 0, bloomEnabled: false },
    { label: 'L3 60%', renderScale: 0.6, sunShaftSamples: 0, bloomEnabled: false },
    { label: 'L4 50%', renderScale: 0.5, sunShaftSamples: 0, bloomEnabled: false },
    { label: 'L5 42%', renderScale: 0.42, sunShaftSamples: 0, bloomEnabled: false },
  ],
};

export const BENCH = {
  /** Real hardware frames per spot (docs/graphics-playbook.md §9.2). */
  settleFrames: 45,
  sampleFrames: 120,
  /** Shortened counts when running `?bench&fast` on software GPUs. */
  fastSettleFrames: 3,
  fastSampleFrames: 5,
} as const;

// ============================================================================
// Stage 6 — Canonical Economy, Buildings (31), Units (10), Combat & Campaign
// Single source of truth matching docs/{ECONOMY,BUILDINGS,UNITS,GAMEPLAY,CAMPAIGN}.md.
// ============================================================================

export type GoodId =
  | 'gold'
  | 'timber'
  | 'planks'
  | 'stone'
  | 'grain'
  | 'flour'
  | 'bread'
  | 'fish'
  | 'meat'
  | 'sausages'
  | 'hides'
  | 'grapes'
  | 'wine'
  | 'ale'
  | 'ironOre'
  | 'iron'
  | 'weapons'
  | 'leatherArmour'
  | 'mail'
  | 'bows'
  | 'horses';

export const ALL_GOODS: readonly GoodId[] = [
  'gold',
  'timber',
  'planks',
  'stone',
  'grain',
  'flour',
  'bread',
  'fish',
  'meat',
  'sausages',
  'hides',
  'grapes',
  'wine',
  'ale',
  'ironOre',
  'iron',
  'weapons',
  'leatherArmour',
  'mail',
  'bows',
  'horses',
];

export const FOOD_GOODS: readonly GoodId[] = ['bread', 'fish', 'sausages'];

export type ResourceMap = Partial<Record<GoodId, number>>;

/** Base trade value in gold per unit (Market trades 10-lots at 60% sell / 160% buy). */
export const GOOD_VALUE_GOLD: Record<GoodId, number> = {
  gold: 1,
  timber: 2,
  planks: 3,
  stone: 3,
  grain: 2,
  flour: 3,
  bread: 4,
  fish: 4,
  meat: 4,
  sausages: 7,
  hides: 4,
  grapes: 4,
  wine: 8,
  ale: 5,
  ironOre: 4,
  iron: 7,
  weapons: 10,
  leatherArmour: 9,
  mail: 14,
  bows: 8,
  horses: 16,
};

/** Food ration value per unit (bread = 1, fish = 1, sausages = 2 per docs/ECONOMY.md §4). */
export const FOOD_RATIONS_PER_UNIT: Partial<Record<GoodId, number>> = {
  bread: 1,
  fish: 1,
  sausages: 2,
};

export const ECONOMY = {
  /** Starting stock per side (docs/ECONOMY.md §9). */
  startingStock: { gold: 340, timber: 90, stone: 40, bread: 40 } as ResourceMap,
  /** Starting Keep household residents. */
  keepResidents: 8,
  /** House capacity per level 1–3. */
  houseCapacityByLevel: [8, 12, 16] as readonly [number, number, number],
  /** Seconds between newcomers into a fed house with room. */
  newcomerIntervalS: 30,
  /** Wine speeds house growth to 60% of normal time. */
  wineGrowthMultiplier: 0.6,
  /** Well within 40 m accelerates house growth by 25% (0.75× time). */
  wellRadiusM: 40,
  wellGrowthMultiplier: 0.75,
  /** Resident tax per fed person per minute (gold). */
  taxPerFedPersonPerMin: 1.2,
  /** Wine multiplies household tax by 1.8×. */
  wineTaxMultiplier: 1.8,
  /** Keep passive income per minute (gold). */
  keepTaxPerMin: 24,
  /** Food rations eaten per minute by residents and soldiers. */
  residentRationsPerMin: 0.3,
  soldierRationsPerMin: 0.25,
  /** Target rations stocked in each house pantry. */
  houseFoodTargetRations: 5,
  /** Wine casks stocked per house & consumption per minute per resident. */
  houseWineTargetCasks: 3,
  residentWinePerMin: 0.05,
  /** Hungry house work speed multiplier (50%). */
  hungryWorkSpeedMul: 0.5,
  /** Morale penalty when Keep food store is empty. */
  starvingArmyMoralePenalty: 25,
  /** Carrier & worker locomotion (m/s). */
  citizenWalkSpeedMs: 2.0,
  roadSpeedMultiplier: 1.4,
  forestSpeedMultiplier: 0.7,
  /** Carrier capacity & load/unload duration (s). */
  carrierCapacity: 8,
  carrierTransferS: 1.0,
  /** Workshop input & yard output capacities. */
  workshopInputMax: 8,
  workshopYardMax: 24,
  yardPickupThreshold: 4,
  /** Role allocator guarantees at least 4 free carriers (+1 builder if building). */
  minFreeCarriers: 4,
  builderShareOfFree: 0.3,
  maxBuildersPerSite: 3,
  /** Worker threat flee distance & return delay (s). */
  workerFleeRadiusM: 32,
  workerReturnDelayS: 6,
  /** Building level multipliers & upgrade builder-seconds. */
  levelCostMul: [1.0, 1.5, 2.5] as readonly [number, number, number],
  levelSpeedMul: [1.0, 1.6, 2.3] as readonly [number, number, number],
  upgradeBuilderS: 15,
  buildBaseBuilderS: 14,
  demolishRefundFrac: 0.5,
  /** Keep L1–3 parameters (docs/BUILDINGS.md). */
  keepLevels: [
    { level: 1, reachM: 280, farmReachM: 340, maxBarracksLevel: 1, maxHp: 1800, arrowIntervalS: 1.0, arrowRangeM: 55, arrowDamage: 9, cost: {} as ResourceMap, upgradeS: 0 },
    { level: 2, reachM: 330, farmReachM: 390, maxBarracksLevel: 2, maxHp: 2600, arrowIntervalS: 0.75, arrowRangeM: 55, arrowDamage: 9, cost: { gold: 250, timber: 60, stone: 120 } as ResourceMap, upgradeS: 60 },
    { level: 3, reachM: 380, farmReachM: 440, maxBarracksLevel: 3, maxHp: 3600, arrowIntervalS: 0.5, arrowRangeM: 55, arrowDamage: 9, cost: { gold: 500, timber: 100, stone: 240 } as ResourceMap, upgradeS: 60 },
  ] as const,
  /** Placement rules (docs/ECONOMY.md §7). */
  ownBuildingExtendM: 70,
  enemyKeepMinDistM: 90,
  maxGroundRiseM: 2.2,
  minBuildingClearanceM: 1.5,
  maxBuildingsPerSide: 64,
  /** Market trade lot size & sell/buy fractions. */
  marketLotSize: 10,
  marketSellMul: 0.6,
  marketBuyMul: 1.6,
  /** Chapel morale bonus. */
  chapelMoraleBonus: 6,
  /** Watchtower garrison slots & extra bow/crossbow range (m). */
  watchtowerGarrisonCap: 4,
  watchtowerRangeBonusM: 12,
  /** Road, Wall & Gate costs and HP. */
  roadStonePer10M: 1.7,
  wallStonePer10M: 15,
  wallSegmentLenM: 2.0,
  wallSegmentHp: 260,
  gateCost: { timber: 20, stone: 12 } as ResourceMap,
  gateWidthM: 6.0,
  gateHp: 400,
  gateOpenRadiusM: 9.0,
  /** Forest felling & regrowth (docs/GAMEPLAY.md). */
  woodcutterFellRadiusM: 48,
  woodcutterTimberPerTree: 8,
  woodcutterChopS: 8,
  saplingRegrowS: 600,
  foresterRegrowMultiplier: 2.0,
  foresterRadiusM: 42,
  forestCellSizeM: 12,
  /** Farm & Vineyard strip cycles (docs/ECONOMY.md §5–6). */
  farmClearS: 7,
  farmSowS: 5,
  farmGrowS: 60,
  farmHarvestS: 6,
  farmGrainPerStrip: 6,
  farmStripsByLevel: [4, 8, 12] as readonly [number, number, number],
  vineyardPlantS: 15,
  vineyardGrowS: 110,
  vineyardHarvestS: 7,
  vineyardGrapesPerStrip: 3,
  fisherTripS: 10,
  fisherFishPerTrip: 3,
} as const;

export type BuildingTypeId =
  | 'keep'
  | 'house'
  | 'storehouse'
  | 'market'
  | 'tavern'
  | 'chapel'
  | 'well'
  | 'woodcutter'
  | 'sawmill'
  | 'forester'
  | 'hunter'
  | 'quarry'
  | 'farm'
  | 'fisher'
  | 'windmill'
  | 'bakery'
  | 'brewery'
  | 'pigFarm'
  | 'butcher'
  | 'vineyard'
  | 'winery'
  | 'tannery'
  | 'ironMine'
  | 'smelter'
  | 'smithy'
  | 'armourer'
  | 'fletcher'
  | 'stable'
  | 'barracks'
  | 'gunFoundry'
  | 'watchtower'
  | 'gate'
  | 'ruin'
  | 'campTent';

export type BuildingBranch =
  | 'town'
  | 'materials'
  | 'food'
  | 'craft'
  | 'military';

export type TerrainRequirement = 'any' | 'forest' | 'lake' | 'stone' | 'ore' | 'openRear';

export interface BuildingRecipe {
  readonly inputs: ResourceMap;
  readonly outputs: ResourceMap;
  readonly cycleS: number;
}

export interface BuildingDef {
  readonly id: BuildingTypeId;
  readonly branch: BuildingBranch;
  /** Visual 3D model template key from `maps.ts` (`BuildingKind`). */
  readonly modelKind:
    | 'keep_l1'
    | 'house_l1'
    | 'woodcutter_l1'
    | 'sawmill_l1'
    | 'forester_l1'
    | 'hunter_l1'
    | 'quarry_l1'
    | 'iron_mine_l1'
    | 'farm_l1'
    | 'vineyard_l1'
    | 'winery_l1'
    | 'windmill_l1'
    | 'bakery_l1'
    | 'brewery_l1'
    | 'pig_farm_l1'
    | 'butcher_l1'
    | 'tavern_l1'
    | 'tannery_l1'
    | 'smelter_l1'
    | 'smithy_l1'
    | 'armourer_l1'
    | 'fletcher_l1'
    | 'stable_l1'
    | 'barracks_l1'
    | 'gun_foundry_l1'
    | 'watchtower_l1'
    | 'gate_l1'
    | 'chapel_l1'
    | 'market_l1'
    | 'well_l1'
    | 'storehouse_l1'
    | 'fisher_l1'
    | 'camp_tent_l1'
    | 'ruin_house'
    | 'fortress_donzon';
  readonly cost: ResourceMap;
  readonly maxHp: number;
  readonly workers: number;
  readonly radiusM: number;
  readonly terrainReq: TerrainRequirement;
  readonly terrainReqDistM?: number;
  /** True if woodcutter/quarry/mine/watchtower can be placed anywhere >= 90 m from enemy keep. */
  readonly anywhereOnMap?: boolean;
  /** True if farm/vineyard gets +60 m keep reach bonus. */
  readonly farmReachBonus?: boolean;
  readonly maxLevel: 1 | 3;
  readonly buildable: boolean;
  readonly recipe?: BuildingRecipe;
}

/** All 31 gameplay buildings + Gate, Ruin, Camp Tent matching docs/BUILDINGS.md — each with its own bespoke 3D model! */
export const BUILDING_DEFS: Record<BuildingTypeId, BuildingDef> = {
  keep:        { id: 'keep',        branch: 'town',      modelKind: 'keep_l1',        cost: {}, maxHp: 1800, workers: 0, radiusM: 7.5, terrainReq: 'any', maxLevel: 3, buildable: false },
  house:       { id: 'house',       branch: 'town',      modelKind: 'house_l1',       cost: { gold: 40, timber: 10 }, maxHp: 250, workers: 0, radiusM: 4.5, terrainReq: 'any', maxLevel: 3, buildable: true },
  storehouse:  { id: 'storehouse',  branch: 'town',      modelKind: 'storehouse_l1',  cost: { gold: 60, timber: 40, stone: 10 }, maxHp: 400, workers: 1, radiusM: 5.5, terrainReq: 'any', maxLevel: 3, buildable: true },
  market:      { id: 'market',      branch: 'town',      modelKind: 'market_l1',      cost: { gold: 80, timber: 40, stone: 20 }, maxHp: 400, workers: 1, radiusM: 6.0, terrainReq: 'any', maxLevel: 3, buildable: true },
  tavern:      { id: 'tavern',      branch: 'town',      modelKind: 'tavern_l1',      cost: { gold: 80, timber: 30, stone: 10 }, maxHp: 300, workers: 1, radiusM: 5.0, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { ale: 1 }, outputs: { gold: 2 }, cycleS: 5 } },
  chapel:      { id: 'chapel',      branch: 'town',      modelKind: 'chapel_l1',      cost: { gold: 120, timber: 20, stone: 50 }, maxHp: 450, workers: 1, radiusM: 5.8, terrainReq: 'any', maxLevel: 3, buildable: true },
  well:        { id: 'well',        branch: 'town',      modelKind: 'well_l1',        cost: { gold: 25, stone: 15 }, maxHp: 200, workers: 1, radiusM: 2.8, terrainReq: 'any', maxLevel: 3, buildable: true },
  woodcutter:  { id: 'woodcutter',  branch: 'materials', modelKind: 'woodcutter_l1',  cost: { gold: 30 }, maxHp: 250, workers: 1, radiusM: 4.5, terrainReq: 'forest', terrainReqDistM: 26, anywhereOnMap: true, maxLevel: 3, buildable: true },
  sawmill:     { id: 'sawmill',     branch: 'materials', modelKind: 'sawmill_l1',     cost: { gold: 60, timber: 30, stone: 10 }, maxHp: 300, workers: 1, radiusM: 5.0, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { timber: 2 }, outputs: { planks: 2 }, cycleS: 6 } },
  forester:    { id: 'forester',    branch: 'materials', modelKind: 'forester_l1',    cost: { gold: 35, timber: 10 }, maxHp: 250, workers: 1, radiusM: 4.2, terrainReq: 'forest', terrainReqDistM: 26, maxLevel: 3, buildable: true },
  hunter:      { id: 'hunter',      branch: 'food',      modelKind: 'hunter_l1',      cost: { gold: 40, timber: 10 }, maxHp: 250, workers: 1, radiusM: 4.2, terrainReq: 'forest', terrainReqDistM: 26, maxLevel: 3, buildable: true, recipe: { inputs: {}, outputs: { meat: 1, hides: 1 }, cycleS: 14 } },
  quarry:      { id: 'quarry',      branch: 'materials', modelKind: 'quarry_l1',      cost: { gold: 40, timber: 10 }, maxHp: 300, workers: 1, radiusM: 4.8, terrainReq: 'stone', terrainReqDistM: 15, anywhereOnMap: true, maxLevel: 3, buildable: true, recipe: { inputs: {}, outputs: { stone: 1 }, cycleS: 6 } },
  farm:        { id: 'farm',        branch: 'food',      modelKind: 'farm_l1',        cost: { gold: 40, timber: 10 }, maxHp: 250, workers: 1, radiusM: 5.2, terrainReq: 'openRear', farmReachBonus: true, maxLevel: 3, buildable: true },
  fisher:      { id: 'fisher',      branch: 'food',      modelKind: 'fisher_l1',      cost: { gold: 40, timber: 10 }, maxHp: 250, workers: 1, radiusM: 4.5, terrainReq: 'lake', terrainReqDistM: 16, maxLevel: 3, buildable: true },
  windmill:    { id: 'windmill',    branch: 'food',      modelKind: 'windmill_l1',    cost: { gold: 70, timber: 30 }, maxHp: 300, workers: 1, radiusM: 4.6, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { grain: 2 }, outputs: { flour: 2 }, cycleS: 6 } },
  bakery:      { id: 'bakery',      branch: 'food',      modelKind: 'bakery_l1',      cost: { gold: 50, timber: 15, stone: 5 }, maxHp: 300, workers: 1, radiusM: 4.8, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { flour: 1 }, outputs: { bread: 1 }, cycleS: 5 } },
  brewery:     { id: 'brewery',     branch: 'food',      modelKind: 'brewery_l1',     cost: { gold: 60, timber: 25, stone: 10 }, maxHp: 300, workers: 1, radiusM: 4.8, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { grain: 2 }, outputs: { ale: 2 }, cycleS: 8 } },
  pigFarm:     { id: 'pigFarm',     branch: 'food',      modelKind: 'pig_farm_l1',    cost: { gold: 60, timber: 20 }, maxHp: 250, workers: 1, radiusM: 5.0, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { grain: 1 }, outputs: { meat: 2, hides: 1 }, cycleS: 12 } },
  butcher:     { id: 'butcher',     branch: 'food',      modelKind: 'butcher_l1',     cost: { gold: 60, timber: 15, stone: 10 }, maxHp: 300, workers: 1, radiusM: 4.6, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { meat: 1 }, outputs: { sausages: 1 }, cycleS: 5 } },
  vineyard:    { id: 'vineyard',    branch: 'food',      modelKind: 'vineyard_l1',    cost: { gold: 70, timber: 20 }, maxHp: 250, workers: 1, radiusM: 5.2, terrainReq: 'openRear', farmReachBonus: true, maxLevel: 3, buildable: true },
  winery:      { id: 'winery',      branch: 'food',      modelKind: 'winery_l1',      cost: { gold: 90, timber: 20, stone: 20 }, maxHp: 300, workers: 1, radiusM: 5.0, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { grapes: 3 }, outputs: { wine: 2 }, cycleS: 12 } },
  tannery:     { id: 'tannery',     branch: 'craft',     modelKind: 'tannery_l1',     cost: { gold: 60, timber: 15, stone: 10 }, maxHp: 300, workers: 1, radiusM: 4.8, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { hides: 1 }, outputs: { leatherArmour: 1 }, cycleS: 8 } },
  ironMine:    { id: 'ironMine',    branch: 'materials', modelKind: 'iron_mine_l1',   cost: { gold: 80, timber: 25 }, maxHp: 300, workers: 1, radiusM: 4.8, terrainReq: 'ore', terrainReqDistM: 15, anywhereOnMap: true, maxLevel: 3, buildable: true, recipe: { inputs: {}, outputs: { ironOre: 1 }, cycleS: 6 } },
  smelter:     { id: 'smelter',     branch: 'craft',     modelKind: 'smelter_l1',     cost: { gold: 90, timber: 20, stone: 30 }, maxHp: 350, workers: 1, radiusM: 5.0, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { timber: 1, ironOre: 2 }, outputs: { iron: 2 }, cycleS: 9 } },
  smithy:      { id: 'smithy',      branch: 'craft',     modelKind: 'smithy_l1',      cost: { gold: 80, timber: 20, stone: 20 }, maxHp: 350, workers: 1, radiusM: 5.0, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { timber: 1, iron: 1 }, outputs: { weapons: 1 }, cycleS: 7 } },
  armourer:    { id: 'armourer',    branch: 'craft',     modelKind: 'armourer_l1',    cost: { gold: 120, timber: 20, stone: 40 }, maxHp: 350, workers: 1, radiusM: 5.0, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { iron: 2 }, outputs: { mail: 1 }, cycleS: 12 } },
  fletcher:    { id: 'fletcher',    branch: 'craft',     modelKind: 'fletcher_l1',    cost: { gold: 60, timber: 20 }, maxHp: 250, workers: 1, radiusM: 4.5, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { timber: 1 }, outputs: { bows: 1 }, cycleS: 8 } },
  stable:      { id: 'stable',      branch: 'craft',     modelKind: 'stable_l1',      cost: { gold: 100, timber: 40, stone: 10 }, maxHp: 300, workers: 1, radiusM: 5.8, terrainReq: 'any', maxLevel: 3, buildable: true, recipe: { inputs: { grain: 3 }, outputs: { horses: 1 }, cycleS: 25 } },
  barracks:    { id: 'barracks',    branch: 'military',  modelKind: 'barracks_l1',    cost: { gold: 100, timber: 30, stone: 30 }, maxHp: 450, workers: 0, radiusM: 6.5, terrainReq: 'any', maxLevel: 3, buildable: true },
  gunFoundry:  { id: 'gunFoundry',  branch: 'military',  modelKind: 'gun_foundry_l1', cost: { gold: 150, timber: 40, stone: 60 }, maxHp: 500, workers: 1, radiusM: 6.0, terrainReq: 'any', maxLevel: 3, buildable: true },
  watchtower:  { id: 'watchtower',  branch: 'military',  modelKind: 'watchtower_l1',  cost: { gold: 40, timber: 15, stone: 60 }, maxHp: 900, workers: 0, radiusM: 3.4, terrainReq: 'any', anywhereOnMap: true, maxLevel: 3, buildable: true },
  gate:        { id: 'gate',        branch: 'military',  modelKind: 'gate_l1',        cost: { timber: 20, stone: 12 }, maxHp: 400, workers: 0, radiusM: 3.2, terrainReq: 'any', anywhereOnMap: true, maxLevel: 1, buildable: true },
  ruin:        { id: 'ruin',        branch: 'town',      modelKind: 'ruin_house',     cost: {}, maxHp: 150, workers: 0, radiusM: 4.5, terrainReq: 'any', maxLevel: 1, buildable: false },
  campTent:    { id: 'campTent',    branch: 'military',  modelKind: 'camp_tent_l1',   cost: {}, maxHp: 220, workers: 0, radiusM: 3.8, terrainReq: 'any', maxLevel: 1, buildable: false },
};

/** Military equipment goods produced by order-regulated armament workshops (started at 0 orders, ordered via Barracks). */
export const EQUIPMENT_GOODS: readonly GoodId[] = [
  'weapons',
  'bows',
  'mail',
  'leatherArmour',
  'horses',
];

export const EQUIPMENT_WORKSHOP_TYPES: readonly BuildingTypeId[] = [
  'smithy',
  'fletcher',
  'armourer',
  'tannery',
  'stable',
];

export const GOOD_TO_WORKSHOP: Partial<Record<GoodId, BuildingTypeId>> = {
  weapons: 'smithy',
  bows: 'fletcher',
  mail: 'armourer',
  leatherArmour: 'tannery',
  horses: 'stable',
};

export function isEquipmentWorkshop(type: BuildingTypeId): boolean {
  return (
    type === 'smithy' ||
    type === 'fletcher' ||
    type === 'armourer' ||
    type === 'tannery' ||
    type === 'stable'
  );
}

export type UnitTypeId =
  | 'militia'
  | 'pikemen'
  | 'archers'
  | 'swordsmen'
  | 'halberdiers'
  | 'crossbowmen'
  | 'lightCav'
  | 'heavyCav'
  | 'cannon'
  | 'mortar';

export const ALL_UNIT_TYPES: readonly UnitTypeId[] = [
  'militia',
  'pikemen',
  'archers',
  'swordsmen',
  'halberdiers',
  'crossbowmen',
  'lightCav',
  'heavyCav',
  'cannon',
  'mortar',
];

export type UnitClass = 'infantry' | 'ranged' | 'cavalry' | 'siege';

export interface UnitDef {
  readonly id: UnitTypeId;
  readonly unitClass: UnitClass;
  readonly visualArchetype: 'swordsman' | 'archer' | 'citizen';
  /** Required Barracks level (0 = Keep, 1–3 = Barracks, gunFoundryLevel for artillery). */
  readonly barracksLevel: number;
  readonly gunFoundryLevel: number;
  /** Number of fighting models (guns for artillery) and townspeople crew drawn from town. */
  readonly count: number;
  readonly crewCount: number;
  /** Full regiment recruitment cost (docs/UNITS.md §2). */
  readonly cost: ResourceMap;
  /** Per-man equipment list (used for refit diff & disband return). */
  readonly equipPerMan: ResourceMap;
  readonly hp: number;
  readonly attack: number;
  readonly defence: number;
  /** Armour damage mitigation fraction (0..0.45). */
  readonly armour: number;
  readonly meleeDamage: number;
  readonly morale: number;
  readonly walkSpeedMs: number;
  readonly runSpeedMs: number;
  /** Front-arc missile shield block probability (0..0.80). */
  readonly shieldBlock: number;
  /** Bonus melee attack against cavalry (pikemen +8, halberdiers +5). */
  readonly antiCavBonus: number;
  /** Melee weapon reach (m). */
  readonly weaponReachM: number;
  /** Cavalry/infantry charge attack bonus & morale shock. */
  readonly chargeAttackBonus: number;
  readonly chargeMoraleShock: number;
  /** Ranged / siege weapon parameters (undefined for pure melee). */
  readonly ranged?: {
    readonly minRangeM: number;
    readonly maxRangeM: number;
    readonly damage: number;
    readonly armorPierce: number;
    readonly reloadS: number;
    readonly splashRadiusM: number;
    readonly buildingDamage: number;
    readonly projectileSpeedMs: number;
    readonly kind: 'arrow' | 'bolt' | 'cannonball' | 'mortar';
  };
  /** Militia home-defence radius limit (115 m, no building attacks). */
  readonly homeDefenceRadiusM?: number;
  /** Valid refit target types (docs/UNITS.md §5). */
  readonly refitTargets: readonly UnitTypeId[];
  /** Approximate gold-equivalent cost for balance-matrix cheaper-counter verification. */
  readonly valueGold: number;
}

/** Canonical 10 Marchland regiment types matching docs/UNITS.md §2–§5 exactly. */
export const UNIT_DEFS: Record<UnitTypeId, UnitDef> = {
  militia: {
    id: 'militia', unitClass: 'infantry', visualArchetype: 'swordsman',
    barracksLevel: 0, gunFoundryLevel: 0, count: 12, crewCount: 12,
    cost: { gold: 30, timber: 12 }, equipPerMan: { timber: 1 },
    hp: 24, attack: 4, defence: 5, armour: 0.0, meleeDamage: 4, morale: 45,
    walkSpeedMs: 1.4, runSpeedMs: 3.1, shieldBlock: 0.20, antiCavBonus: 0, weaponReachM: 1.8,
    chargeAttackBonus: 1, chargeMoraleShock: 2, homeDefenceRadiusM: 115,
    refitTargets: ['pikemen', 'archers', 'swordsmen', 'halberdiers', 'crossbowmen'],
    valueGold: 54,
  },
  pikemen: {
    id: 'pikemen', unitClass: 'infantry', visualArchetype: 'swordsman',
    barracksLevel: 1, gunFoundryLevel: 0, count: 12, crewCount: 12,
    cost: { gold: 50, leatherArmour: 12, weapons: 12 }, equipPerMan: { leatherArmour: 1, weapons: 1 },
    hp: 30, attack: 6, defence: 7, armour: 0.20, meleeDamage: 5, morale: 60,
    walkSpeedMs: 1.4, runSpeedMs: 2.9, shieldBlock: 0.35, antiCavBonus: 8, weaponReachM: 3.0,
    chargeAttackBonus: 2, chargeMoraleShock: 3,
    refitTargets: ['halberdiers', 'swordsmen'],
    valueGold: 278,
  },
  archers: {
    id: 'archers', unitClass: 'ranged', visualArchetype: 'archer',
    barracksLevel: 1, gunFoundryLevel: 0, count: 12, crewCount: 12,
    cost: { gold: 50, leatherArmour: 12, bows: 12 }, equipPerMan: { leatherArmour: 1, bows: 1 },
    hp: 24, attack: 3, defence: 3, armour: 0.20, meleeDamage: 3, morale: 50,
    walkSpeedMs: 1.4, runSpeedMs: 3.1, shieldBlock: 0.0, antiCavBonus: 0, weaponReachM: 1.5,
    chargeAttackBonus: 0, chargeMoraleShock: 0,
    ranged: { minRangeM: 6, maxRangeM: 80, damage: 16, armorPierce: 0.0, reloadS: 6, splashRadiusM: 0, buildingDamage: 1.5, projectileSpeedMs: 38, kind: 'arrow' },
    refitTargets: ['crossbowmen'],
    valueGold: 254,
  },
  swordsmen: {
    id: 'swordsmen', unitClass: 'infantry', visualArchetype: 'swordsman',
    barracksLevel: 2, gunFoundryLevel: 0, count: 12, crewCount: 12,
    cost: { gold: 90, weapons: 12, mail: 12 }, equipPerMan: { weapons: 1, mail: 1 },
    hp: 36, attack: 9, defence: 9, armour: 0.40, meleeDamage: 7, morale: 75,
    walkSpeedMs: 1.4, runSpeedMs: 2.7, shieldBlock: 0.35, antiCavBonus: 0, weaponReachM: 1.8,
    chargeAttackBonus: 3, chargeMoraleShock: 4,
    refitTargets: ['halberdiers'],
    valueGold: 378,
  },
  halberdiers: {
    id: 'halberdiers', unitClass: 'infantry', visualArchetype: 'swordsman',
    barracksLevel: 2, gunFoundryLevel: 0, count: 12, crewCount: 12,
    cost: { gold: 100, weapons: 12, mail: 12 }, equipPerMan: { weapons: 1, mail: 1 },
    hp: 30, attack: 9, defence: 6, armour: 0.25, meleeDamage: 7.5, morale: 68,
    walkSpeedMs: 1.4, runSpeedMs: 2.7, shieldBlock: 0.0, antiCavBonus: 6, weaponReachM: 2.0,
    chargeAttackBonus: 3, chargeMoraleShock: 4,
    refitTargets: ['swordsmen'],
    valueGold: 388,
  },
  crossbowmen: {
    id: 'crossbowmen', unitClass: 'ranged', visualArchetype: 'archer',
    barracksLevel: 2, gunFoundryLevel: 0, count: 12, crewCount: 12,
    cost: { gold: 80, timber: 12, leatherArmour: 12, bows: 12 }, equipPerMan: { timber: 1, leatherArmour: 1, bows: 1 },
    hp: 26, attack: 4, defence: 5, armour: 0.20, meleeDamage: 4, morale: 55,
    walkSpeedMs: 1.4, runSpeedMs: 2.9, shieldBlock: 0.30, antiCavBonus: 0, weaponReachM: 1.5,
    chargeAttackBonus: 0, chargeMoraleShock: 0,
    ranged: { minRangeM: 6, maxRangeM: 70, damage: 30, armorPierce: 0.60, reloadS: 10, splashRadiusM: 0, buildingDamage: 2.0, projectileSpeedMs: 48, kind: 'bolt' },
    refitTargets: [],
    valueGold: 308,
  },
  lightCav: {
    id: 'lightCav', unitClass: 'cavalry', visualArchetype: 'swordsman',
    barracksLevel: 2, gunFoundryLevel: 0, count: 8, crewCount: 8,
    cost: { gold: 100, leatherArmour: 8, weapons: 8, horses: 8 }, equipPerMan: { leatherArmour: 1, weapons: 1, horses: 1 },
    hp: 40, attack: 7, defence: 5, armour: 0.20, meleeDamage: 6, morale: 65,
    walkSpeedMs: 3.6, runSpeedMs: 8.5, shieldBlock: 0.15, antiCavBonus: 0, weaponReachM: 2.2,
    chargeAttackBonus: 8, chargeMoraleShock: 9,
    refitTargets: ['heavyCav'],
    valueGold: 380,
  },
  heavyCav: {
    id: 'heavyCav', unitClass: 'cavalry', visualArchetype: 'swordsman',
    barracksLevel: 3, gunFoundryLevel: 0, count: 8, crewCount: 8,
    cost: { gold: 160, weapons: 8, mail: 8, horses: 8 }, equipPerMan: { weapons: 1, mail: 1, horses: 1 },
    hp: 52, attack: 10, defence: 9, armour: 0.45, meleeDamage: 8, morale: 85,
    walkSpeedMs: 3.6, runSpeedMs: 7.5, shieldBlock: 0.30, antiCavBonus: 0, weaponReachM: 2.4,
    chargeAttackBonus: 12, chargeMoraleShock: 15,
    refitTargets: [],
    valueGold: 480,
  },
  cannon: {
    id: 'cannon', unitClass: 'siege', visualArchetype: 'citizen',
    barracksLevel: 0, gunFoundryLevel: 1, count: 2, crewCount: 6,
    cost: { gold: 140, timber: 12, iron: 12 }, equipPerMan: {},
    hp: 80, attack: 0, defence: 0, armour: 0.0, meleeDamage: 0, morale: 55,
    walkSpeedMs: 0.9, runSpeedMs: 0.9, shieldBlock: 0.70, antiCavBonus: 0, weaponReachM: 1.5,
    chargeAttackBonus: 0, chargeMoraleShock: 0,
    ranged: { minRangeM: 10, maxRangeM: 120, damage: 55, armorPierce: 0.90, reloadS: 10, splashRadiusM: 1.4, buildingDamage: 30, projectileSpeedMs: 72, kind: 'cannonball' },
    refitTargets: [],
    valueGold: 248,
  },
  mortar: {
    id: 'mortar', unitClass: 'siege', visualArchetype: 'citizen',
    barracksLevel: 0, gunFoundryLevel: 2, count: 1, crewCount: 5,
    cost: { gold: 200, stone: 8, iron: 10 }, equipPerMan: {},
    hp: 120, attack: 0, defence: 0, armour: 0.0, meleeDamage: 0, morale: 60,
    walkSpeedMs: 0.6, runSpeedMs: 0.6, shieldBlock: 0.80, antiCavBonus: 0, weaponReachM: 1.5,
    chargeAttackBonus: 0, chargeMoraleShock: 0,
    ranged: { minRangeM: 40, maxRangeM: 150, damage: 30, armorPierce: 0.50, reloadS: 15, splashRadiusM: 3.5, buildingDamage: 110, projectileSpeedMs: 36, kind: 'mortar' },
    refitTargets: [],
    valueGold: 294,
  },
};

export const COMBAT = {
  /** Army caps & barracks queue limits (docs/UNITS.md & docs/CAMPAIGN.md). */
  skirmishArmyCap: 100,
  campaignArmyCap: 200,
  campaignRegimentMaxMen: 20,
  barracksQueueMax: 3,
  /** Upkeep in gold per soldier per minute; > 60 s unpaid applies −15 max morale. */
  upkeepGoldPerManPerMin: 0.2,
  unpaidGraceS: 60,
  unpaidMoralePenalty: 15,
  /** Refit & reinforcement parameters (docs/UNITS.md §5 & GAMEPLAY.md §6). */
  refitRadiusM: 40,
  refitDurationS: 20,
  reinforceRadiusM: 40,
  reinforceOutOfCombatS: 5,
  reinforcePerManS: 2.5,
  /** Melee cadence & hit probability tuning (calibrated for 45–75 s equal duels!). */
  meleeSwingIntervalS: 1.45,
  baseHitChance: 0.40,
  hitChancePerPoint: 0.042,
  minHitChance: 0.08,
  maxHitChance: 0.80,
  /** Flank & rear combat bonuses (GAMEPLAY.md §6: flank charge breaks in 10–15 s!). */
  flankAttackBonus: 5,
  rearAttackBonus: 9,
  flankMoraleShock: 14,
  rearMoraleShock: 24,
  flankDamageMul: 1.35,
  rearDamageMul: 1.65,
  /** Elevation modifiers (GAMEPLAY.md §5). */
  elevationHeightThresholdM: 1.2,
  downhillRangeBonusFrac: 0.15,
  downhillChargeBonusFrac: 0.25,
  uphillMeleeAttackPenalty: 1,
  /** Charge impact speed threshold & brace negation vs pikes/halberds. */
  chargeMinSpeedMs: 4.0,
  chargeDurationS: 3.5,
  /** Missile accuracy tuning (calibrated so 80 m volley takes 15–25% of unarmoured men!). */
  missileBaseAccuracy: 0.27,
  missileLooseReduction: 0.40,
  missileForestCover: 0.35,
  /** Morale recovery, rout & rally thresholds. */
  routThresholdMorale: 10,
  rallyThresholdMorale: 36,
  moraleRecoveryOutOfCombatPerS: 2.6,
  moraleLossPerCasualtyFrac: 46,
  /** Fatigue (0 = fresh, 1 = exhausted). */
  fatigueRunPerS: 0.014,
  fatigueMeleePerS: 0.018,
  fatigueRecoverIdlePerS: 0.025,
  fatigueExhaustedAttackPenalty: 2,
  /** Captain bonuses & death shock (docs/GAMEPLAY.md §6). */
  captainDeathMoraleShock: 12,
  missingCaptainAttackPenalty: 1,
  missingCaptainMaxMoralePenalty: 10,
  missingCaptainRallySpeedMul: 0.5,
  /** Two Veteran tiers (0.6 and 1.5 kills/man: +1 atk/def, +8 max morale, +12% accuracy each). */
  vetTier1KillsPerMan: 0.6,
  vetTier2KillsPerMan: 1.5,
  vetAttackBonusPerTier: 1,
  vetDefenceBonusPerTier: 1,
  vetMaxMoraleBonusPerTier: 8,
  vetAccuracyBonusPerTier: 0.12,
  /** Guard stance response radius (m) & Skirmish kite distance (m). */
  guardRadiusM: 12,
  skirmishKeepDistM: 32,
  /** Strategic capture points (docs/GAMEPLAY.md §5). */
  captureRadiusM: 30,
  captureTimeS: 20,
  captureIncomePerMin: {
    mine: { ironOre: 8 } as ResourceMap,
    quarry: { stone: 10 } as ResourceMap,
    village: { gold: 15, grain: 6 } as ResourceMap,
  },
} as const;

export const CAMPAIGN = {
  /** Carry-over limits between missions (docs/CAMPAIGN.md §2 & §6). */
  maxCarryOverRegiments: 8,
  carryOverGoldFrac: 0.5,
  carryOverGoldCap: 800,
  /** Mission 1 tribute requirement & timer (30 min = 1800 s). */
  m1Tribute: { gold: 600, bread: 200, weapons: 40 } as ResourceMap,
  m1DeadlineS: 1800,
  routWinS: 180,
  /** Mission 3 relief timer (12 min = 720 s). */
  m3ReliefTimeS: 720,
  m3MarchDelayS: 180,
  /** Mission 4 target & raid timers (8, 16, 24 min). */
  m4TargetMen: 160,
  m4TargetRegiments: 10,
  m4RaidTimesS: [480, 960, 1440] as readonly [number, number, number],
  /** Mission 5 Fortress sortie, relief & barracks spawn timers. */
  m5WallHpMul: 2.0,
  m5SortieTriggerM: 230,
  m5SortieReturnS: 150,
  m5ReliefTimeS: 900,
  m5BarracksSpawnS: 300,
  m5BreachStarTimeS: 600,
  /** Defence mode wave interval (4 min from min 7, win at 30 min). */
  defenceFirstWaveS: 420,
  defenceWaveIntervalS: 240,
  defenceWinTimeS: 1800,
} as const;

