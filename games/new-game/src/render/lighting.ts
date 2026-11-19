// Physical lighting rig and single sky function (GUIDE.md §4, NUMBERS.md).
// Drives sun, hemisphere sky/ground bounce, sky dome, and fog from one preset without recompiling.

import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  type RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu';
import { clamp, dot, float, mix, normalize, positionLocal, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { LIGHTING_PRESETS, type LightingPresetConfig, type LightingPresetId, type QualityPresetConfig } from '../config.ts';
import { exposureFromEv100, kelvinToLinearRgb, presetAnchorEv100, sunDirectionFromAngles } from '../sim/lightingMath.ts';

/**
 * Layer reserved for coarse opaque R7 shadow stand-in meshes.
 * Main camera renders layer 0 only; sun shadow camera enables layers 0 + 1 so Three.js
 * preserves its own layer mask instead of copying the main camera's mask (playbook §9.3 / Stage 1b).
 */
export const SHADOW_ONLY_LAYER = 1;

export interface LightingState {
  readonly presetId: LightingPresetId;
  readonly config: LightingPresetConfig;
  readonly anchorEv100: number;
  readonly preExposure: number;
  readonly sunDirection: Vector3;
}

export class LightingRig {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly skyDome: Mesh;
  readonly fog: FogExp2;

  private readonly hostScene: Scene;
  private readonly probeScene: Scene;
  private pmrem: PMREMGenerator | null = null;
  private probeTarget: RenderTarget | null = null;

  private readonly uSunDir = uniform(new Vector3(0.4, 0.8, 0.4));
  private readonly uZenithColor = uniform(new Color(0.18, 0.42, 0.85));
  private readonly uHorizonColor = uniform(new Color(0.68, 0.78, 0.9));
  private readonly uGroundColor = uniform(new Color(0.22, 0.19, 0.15));
  private readonly uSunGlowColor = uniform(new Color(1.0, 0.96, 0.88));
  private readonly uSunDiskGain = uniform(float(4.0));
  private readonly uHazeExponent = uniform(float(3.2));

  state: LightingState;

  constructor(scene: Scene, quality: QualityPresetConfig, initialPreset: LightingPresetId = 'clearNoon') {
    this.hostScene = scene;

    this.sun = new DirectionalLight(0xffffff, 1);
    this.sun.name = 'SunLight';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSizePx, quality.shadowMapSizePx);
    // Stage 1/2 directional frustum covers the village showcase & calibration core; Stage 3 upgrades to CSMShadowNode.
    const half = 42;
    this.sun.shadow.camera.left = -half;
    this.sun.shadow.camera.right = half;
    this.sun.shadow.camera.top = half;
    this.sun.shadow.camera.bottom = -half;
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.bias = -0.00045;
    this.sun.shadow.normalBias = quality.shadowMapSizePx <= 1024 ? 0.055 : 0.026;
    // Enable both layer 0 (direct casters like animated LOD0 units) and layer 1 (coarse opaque R7 shadow stand-ins).
    this.sun.shadow.camera.layers.enable(0);
    this.sun.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new HemisphereLight(0x9ec0ff, 0x4b4032, 1);
    this.hemi.name = 'SkyHemisphereLight';
    scene.add(this.hemi);

    const skyMat = this.createSkyMaterial('PhysicalSkyMaterial');
    this.skyDome = new Mesh(new SphereGeometry(900, 32, 20), skyMat);
    this.skyDome.name = 'SkyDome';
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -1000;
    scene.add(this.skyDome);

    // Lightweight sky-only scene sharing the exact same uniforms for the persistent PMREM reflection probe.
    this.probeScene = new Scene();
    const probeDome = new Mesh(new SphereGeometry(24, 24, 14), this.createSkyMaterial('SkyProbeMaterial'));
    probeDome.name = 'SkyProbeDome';
    this.probeScene.add(probeDome);

    this.fog = new FogExp2(0xc8d8e8, 0.00055);
    scene.fog = this.fog;

    this.state = this.buildState(initialPreset);
    this.applyPreset(initialPreset);
  }

  private createSkyMaterial(name: string): MeshBasicNodeMaterial {
    const skyMat = new MeshBasicNodeMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    skyMat.name = name;

    const dir = normalize(positionLocal);
    const up = clamp(dir.y, 0.0, 1.0);
    // Keep Rayleigh zenith saturated; haze concentrates toward horizon (GUIDE.md §2b: never lilac/grey zenith).
    const hazeFactor = pow(float(1.0).sub(up), this.uHazeExponent);
    const upperSky = mix(this.uZenithColor, this.uHorizonColor, hazeFactor);
    const belowHorizon = mix(this.uHorizonColor, this.uGroundColor, smoothstep(float(0.0), float(-0.18), dir.y));
    const baseSky = mix(belowHorizon, upperSky, smoothstep(float(-0.02), float(0.02), dir.y));

    const sunCos = clamp(dot(dir, this.uSunDir), 0.0, 1.0);
    const mieHalo = pow(sunCos, float(18.0)).mul(0.28);
    const sunDisk = smoothstep(float(0.99935), float(0.99985), sunCos).mul(this.uSunDiskGain);
    const finalSky = baseSky.add(this.uSunGlowColor.mul(mieHalo.add(sunDisk)));
    skyMat.colorNode = vec3(finalSky);
    return skyMat;
  }

  /**
   * Initializes the single persistent-target PMREM sky reflection probe after `await renderer.init()`.
   * Re-uses one `RenderTarget` across every lighting preset switch (zero allocations / zero pipeline churn).
   */
  initSkyProbe(renderer: WebGPURenderer): void {
    if (this.pmrem) return;
    this.pmrem = new PMREMGenerator(renderer);
    this.rebakeSkyProbe();
    // Balanced IBL gives realistic sky/ground specular reflection on kettle helms, chainmail, swords,
    // and barrel hoops while hemisphere + IBL diffuse stays anchored to physical skyLux.
    this.hostScene.environmentIntensity = 0.55;
    // Re-apply preset so hemisphere diffuse compensates cleanly for active IBL.
    this.applyPreset(this.state.presetId);
  }

  private rebakeSkyProbe(): void {
    if (!this.pmrem) return;
    this.probeTarget = this.pmrem.fromScene(this.probeScene, 0.02, 0.1, 60, {
      size: 128,
      renderTarget: this.probeTarget ?? undefined,
    });
    this.hostScene.environment = this.probeTarget.texture;
  }

  private buildState(presetId: LightingPresetId): LightingState {
    const config = LIGHTING_PRESETS[presetId];
    const anchorEv100 = presetAnchorEv100(config.sunIlluminanceLux, config.skyIlluminanceLux, config.sunElevationDeg);
    const preExposure = exposureFromEv100(anchorEv100);
    const d = sunDirectionFromAngles(config.sunElevationDeg, config.sunAzimuthDeg);
    return {
      presetId,
      config,
      anchorEv100,
      preExposure,
      sunDirection: new Vector3(d.x, d.y, d.z).normalize(),
    };
  }

  /** Updates lights, sky uniforms, fog, and re-bakes the persistent PMREM probe (0 new pipelines). */
  applyPreset(presetId: LightingPresetId): LightingState {
    const st = this.buildState(presetId);
    this.state = st;
    const { config, preExposure, sunDirection } = st;

    const sunRgb = kelvinToLinearRgb(config.sunKelvin);
    const skyRgb = kelvinToLinearRgb(config.skyKelvin);

    // Direct sun light: intensity = lux * preExposure (BRDF_Lambert divides by pi in three r186).
    this.sun.color.setRGB(sunRgb.r, sunRgb.g, sunRgb.b);
    this.sun.intensity = config.sunIlluminanceLux * preExposure;
    this.sun.position.copy(sunDirection).multiplyScalar(110);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    // Hemisphere diffuse sky + warm soil ground bounce (trimmed when sky PMREM probe supplies diffuse IBL
    // so total horizontal diffuse sky illuminance stays anchored to physical skyLux).
    const hemiShare = this.probeTarget ? 0.52 : 1.0;
    const groundTintR = 0.42 * config.groundBounceFactor;
    const groundTintG = 0.35 * config.groundBounceFactor;
    const groundTintB = 0.27 * config.groundBounceFactor;
    this.hemi.color.setRGB(skyRgb.r, skyRgb.g, skyRgb.b);
    const totalBounceScale =
      ((config.sunIlluminanceLux * Math.max(0.15, sunDirection.y) + config.skyIlluminanceLux) /
        Math.max(1, config.skyIlluminanceLux)) *
      0.55;
    this.hemi.groundColor.setRGB(
      groundTintR * sunRgb.r * totalBounceScale + skyRgb.r * 0.14,
      groundTintG * sunRgb.g * totalBounceScale + skyRgb.g * 0.14,
      groundTintB * sunRgb.b * totalBounceScale + skyRgb.b * 0.11,
    );
    this.hemi.intensity = config.skyIlluminanceLux * preExposure * hemiShare;

    // Sky dome luminance in pre-exposed linear units (sky luminance ~ skyLux / pi).
    const skyLum = (config.skyIlluminanceLux / Math.PI) * preExposure;
    const isOvercast = presetId === 'overcast';
    const isGolden = presetId === 'goldenHour';

    // Rayleigh zenith stays distinctly blue in clear sky, neutral cool-grey in overcast.
    const zenithR = isOvercast ? 0.56 : isGolden ? 0.16 : 0.14;
    const zenithG = isOvercast ? 0.6 : isGolden ? 0.31 : 0.36;
    const zenithB = isOvercast ? 0.65 : isGolden ? 0.68 : 0.86;
    const zenithGain = isOvercast ? 1.55 : 2.2;
    this.uZenithColor.value.setRGB(zenithR * skyLum * zenithGain, zenithG * skyLum * zenithGain, zenithB * skyLum * zenithGain);

    // Horizon blends sky scattering with warm sun haze so fog & horizon share one hue.
    const hazeMix = isGolden ? 0.62 : isOvercast ? 0.08 : 0.22;
    const horizonGain = isOvercast ? 1.65 : 2.35;
    const hzR = (skyRgb.r * (1 - hazeMix) + sunRgb.r * hazeMix) * skyLum * horizonGain;
    const hzG = (skyRgb.g * (1 - hazeMix) + sunRgb.g * hazeMix) * skyLum * horizonGain;
    const hzB = (skyRgb.b * (1 - hazeMix) + sunRgb.b * hazeMix) * skyLum * horizonGain;
    this.uHorizonColor.value.setRGB(hzR, hzG, hzB);
    this.uGroundColor.value.setRGB(hzR * 0.28, hzG * 0.24, hzB * 0.19);

    this.uSunDir.value.copy(sunDirection);
    this.uSunGlowColor.value.setRGB(sunRgb.r * skyLum * 2.8, sunRgb.g * skyLum * 2.8, sunRgb.b * skyLum * 2.8);
    this.uSunDiskGain.value = isOvercast ? 0.15 : isGolden ? 6.5 : 5.0;
    this.uHazeExponent.value = isGolden ? 2.1 : isOvercast ? 1.8 : 3.2;

    // Match exponential fog colour directly to the horizon of the same sky function.
    this.fog.color.setRGB(hzR, hzG, hzB);
    this.fog.density = config.fogDensityPerM;

    // Re-bake sky probe in-place into the existing target (zero pipeline or target churn).
    if (this.pmrem) {
      this.rebakeSkyProbe();
    }

    return st;
  }

  /** Keeps sky dome centered on the camera so it never clips into world geometry. */
  followCamera(camPos: Vector3): void {
    this.skyDome.position.copy(camPos);
  }

  dispose(): void {
    this.probeTarget?.dispose();
    this.pmrem?.dispose();
    this.probeTarget = null;
    this.pmrem = null;
  }
}
