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
  /** Aerial perspective extinction coefficient (1/m). */
  readonly fogDensityPerM: number;
}

export interface QualityPresetConfig {
  readonly id: QualityPreset;
  /** Max device pixel ratio (phones use 2x with TRAA + sharpen per GUIDE.md §7). */
  readonly maxDpr: number;
  /** CSM shadow cascade count (High 3–4, Low 2 per GUIDE.md §4). */
  readonly shadowCascades: number;
  /** Shadow map resolution per cascade (px). */
  readonly shadowMapSizePx: number;
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
    skyIlluminanceLux: 18_000,
    sunKelvin: 5500,
    skyKelvin: 10_000,
    sunElevationDeg: 65,
    sunAzimuthDeg: 35,
    sunShaftStrength: 0.15,
    groundBounceFactor: 0.22,
    fogDensityPerM: 0.00055,
  },
  lateAutumn: {
    id: 'lateAutumn',
    // Default Marchland look (docs/PLAYBOOK.md §2): late-afternoon early autumn, 30 deg sun, long shadows.
    sunIlluminanceLux: 45_000,
    skyIlluminanceLux: 11_000,
    sunKelvin: 4400,
    skyKelvin: 8500,
    sunElevationDeg: 30,
    sunAzimuthDeg: 48,
    sunShaftStrength: 0.42,
    groundBounceFactor: 0.24,
    fogDensityPerM: 0.00085,
  },
  goldenHour: {
    id: 'goldenHour',
    sunIlluminanceLux: 12_000,
    skyIlluminanceLux: 4_500,
    sunKelvin: 3200,
    skyKelvin: 9000,
    sunElevationDeg: 12,
    sunAzimuthDeg: 65,
    sunShaftStrength: 0.72,
    groundBounceFactor: 0.2,
    fogDensityPerM: 0.0012,
  },
  overcast: {
    id: 'overcast',
    // Overcast keeps ~15 % directional fill (GUIDE.md §2b: never pure blue-violet shadow).
    sunIlluminanceLux: 1_200,
    skyIlluminanceLux: 8_000,
    sunKelvin: 6200,
    skyKelvin: 7000,
    sunElevationDeg: 48,
    sunAzimuthDeg: 40,
    sunShaftStrength: 0.0,
    groundBounceFactor: 0.28,
    fogDensityPerM: 0.0014,
  },
};

export const QUALITY_PRESETS: Record<QualityPreset, QualityPresetConfig> = {
  high: {
    id: 'high',
    maxDpr: 2,
    shadowCascades: 3,
    shadowMapSizePx: 2048,
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
  fastSettleFrames: 6,
  fastSampleFrames: 12,
} as const;
