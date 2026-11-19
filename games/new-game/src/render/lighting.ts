// Physical lighting rig, Cascaded Shadow Maps (CSMShadowNode), persistent ground-bounce PMREM probe,
// and single unified analytic sky/fog/water atmosphere (GUIDE.md §4, NUMBERS.md, playbook §4).
// All 4 lighting presets switch strictly via uniform updates + in-place PMREM rebake (0 new pipelines).

import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  type RenderTarget,
  type WebGPURenderer,
} from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import {
  LIGHTING_PRESETS,
  type LightingPresetConfig,
  type LightingPresetId,
  type QualityPresetConfig,
} from '../config.ts';
import {
  computeCsmSplits,
  exposureFromEv100,
  presetAnchorEv100,
  sunDirectionFromAngles,
  type LinearRgb,
} from '../sim/lightingMath.ts';
import {
  createHeightFogNode,
  createPhysicalSkyUniforms,
  createSkyDomeMaterial,
  createSkyProbeMaterial,
  updatePhysicalSkyUniforms,
  type PhysicalSkyUniforms,
} from './sky.ts';

/**
 * Layer reserved for coarse opaque R7 shadow stand-in meshes.
 * Main camera renders layer 0 only; sun shadow camera enables layers 0 + 1 so Three.js
 * preserves its own layer mask instead of copying the main camera's mask (and CSMShadowNode
 * clones `sun.shadow.camera` including `layers.mask` to every cascade).
 */
export const SHADOW_ONLY_LAYER = 1;

export interface LightingState {
  readonly presetId: LightingPresetId;
  readonly config: LightingPresetConfig;
  readonly anchorEv100: number;
  readonly preExposure: number;
  readonly sunDirection: Vector3;
  readonly sunRgb: LinearRgb;
}

export interface ShadowConfigSummary {
  readonly cascades: number;
  readonly maxFarM: number;
  readonly mapSizePx: number;
  readonly fade: boolean;
  readonly initialized: boolean;
}

export class LightingRig {
  readonly sun: DirectionalLight;
  readonly csm: CSMShadowNode;
  readonly hemi: HemisphereLight;
  readonly skyDome: Mesh;
  readonly skyUniforms: PhysicalSkyUniforms;

  private readonly quality: QualityPresetConfig;
  private readonly hostScene: Scene;
  private readonly probeScene: Scene;
  private pmrem: PMREMGenerator | null = null;
  private probeTarget: RenderTarget | null = null;

  state: LightingState;

  constructor(scene: Scene, quality: QualityPresetConfig, initialPreset: LightingPresetId = 'lateAutumn') {
    this.hostScene = scene;
    this.quality = quality;
    this.skyUniforms = createPhysicalSkyUniforms();

    // 1. Directional sun with Cascaded Shadow Maps (3 cascades High 2048 px / 2 Low 1024 px, fade=true).
    this.sun = new DirectionalLight(0xffffff, 1);
    this.sun.name = 'SunLight';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSizePx, quality.shadowMapSizePx);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 640;
    this.sun.shadow.bias = quality.shadowBias;
    this.sun.shadow.normalBias = quality.shadowNormalBias;
    // Enable layers 0 (direct casters like animated LOD0 units) and 1 (R7 coarse opaque shadow stand-ins).
    // CSMShadowNode clones `this.sun.shadow` (and its camera layers mask) for each cascade on first setup.
    this.sun.shadow.camera.layers.enable(0);
    this.sun.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);

    // Leave `csm.camera` unset until first render (playbook §11: setting it early skips _init()).
    this.csm = new CSMShadowNode(this.sun, {
      cascades: quality.shadowCascades,
      maxFar: quality.shadowMaxFarM,
      mode: 'custom',
      lightMargin: quality.shadowLightMarginM,
      customSplitsCallback: (cascades, near, far, target) => {
        const splits = computeCsmSplits(cascades, near, far, quality.shadowSplitLambda);
        for (const s of splits) target.push(s);
      },
    });
    this.csm.fade = true;
    this.sun.shadow.shadowNode = this.csm;

    scene.add(this.sun);
    scene.add(this.sun.target);

    // 2. Physical sky + warm soil ground-bounce hemisphere light (balanced with PMREM diffuse IBL).
    this.hemi = new HemisphereLight(0x9ec0ff, 0x4b4032, 1);
    this.hemi.name = 'SkyHemisphereLight';
    scene.add(this.hemi);

    // 3. Single analytic sky dome (fog disabled; follows camera position).
    const skyMat = createSkyDomeMaterial(this.skyUniforms);
    this.skyDome = new Mesh(new SphereGeometry(900, 32, 20), skyMat);
    this.skyDome.name = 'SkyDome';
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -1000;
    scene.add(this.skyDome);

    // 4. Lightweight probe scene sharing the exact same sky + warm ground-bounce uniforms for PMREM.
    // Radius 24 m sits well inside PMREM camera far plane (60 m) so the probe is never clipped black.
    this.probeScene = new Scene();
    const probeDome = new Mesh(new SphereGeometry(24, 32, 18), createSkyProbeMaterial(this.skyUniforms));
    probeDome.name = 'SkyProbeDome';
    this.probeScene.add(probeDome);

    // 5. Height-integrated physical aerial perspective driven by the exact same sky horizon scatter.
    scene.fog = null;
    scene.fogNode = createHeightFogNode(this.skyUniforms);

    this.state = this.buildState(initialPreset, { r: 1, g: 1, b: 1 });
    this.applyPreset(initialPreset);
  }

  /**
   * Initializes the single persistent-target PMREM sky reflection probe after `await renderer.init()`.
   * Re-uses one `RenderTarget` across every lighting preset switch (zero allocations / zero pipeline churn).
   */
  initSkyProbe(renderer: WebGPURenderer): void {
    if (this.pmrem) return;
    this.pmrem = new PMREMGenerator(renderer);
    this.rebakeSkyProbe();
    // Balanced IBL gives realistic sky + warm ground-bounce reflection on kettle helms, mail, swords,
    // cottage eaves, and barrel hoops while hemisphere + IBL diffuse stays anchored to physical skyLux.
    this.hostScene.environmentIntensity = 0.55;
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

  private buildState(presetId: LightingPresetId, sunRgb: LinearRgb): LightingState {
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
      sunRgb,
    };
  }

  /** Updates lights, unified sky/fog/water uniforms, and re-bakes the persistent PMREM probe (0 new pipelines). */
  applyPreset(presetId: LightingPresetId): LightingState {
    const baseState = this.buildState(presetId, { r: 1, g: 1, b: 1 });
    const { config, preExposure, sunDirection } = baseState;

    const { sunRgb, skyRgb } = updatePhysicalSkyUniforms(this.skyUniforms, {
      presetId,
      config,
      preExposure,
      sunDirection,
    });

    const st: LightingState = { ...baseState, sunRgb };
    this.state = st;

    // Direct sun light: intensity = lux * preExposure (BRDF_Lambert divides by pi in three r186).
    this.sun.color.setRGB(sunRgb.r, sunRgb.g, sunRgb.b);
    this.sun.intensity = config.sunIlluminanceLux * preExposure;
    this.sun.position.copy(sunDirection).multiplyScalar(140);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    // Hemisphere diffuse sky + warm soil ground bounce (trimmed when sky PMREM probe supplies diffuse IBL
    // so horizontal diffuse illuminance stays within +-0.10 stops of Frostbite EV100 across all 4 presets).
    const hemiShare = this.probeTarget
      ? presetId === 'overcast'
        ? 0.22
        : presetId === 'clearNoon'
          ? 0.56
          : 0.48
      : 1.0;
    const groundTintR = 0.52 * config.groundBounceFactor;
    const groundTintG = 0.43 * config.groundBounceFactor;
    const groundTintB = 0.31 * config.groundBounceFactor;
    this.hemi.color.setRGB(skyRgb.r, skyRgb.g, skyRgb.b);
    const totalBounceScale =
      ((config.sunIlluminanceLux * Math.max(0.16, sunDirection.y) + config.skyIlluminanceLux) /
        Math.max(1, config.skyIlluminanceLux)) *
      0.72;
    this.hemi.groundColor.setRGB(
      groundTintR * sunRgb.r * totalBounceScale + skyRgb.r * 0.18,
      groundTintG * sunRgb.g * totalBounceScale + skyRgb.g * 0.16,
      groundTintB * sunRgb.b * totalBounceScale + skyRgb.b * 0.13,
    );
    this.hemi.intensity = config.skyIlluminanceLux * preExposure * hemiShare;

    // Re-bake sky probe in-place into the existing target (zero pipeline or RenderTarget churn).
    if (this.pmrem) {
      this.rebakeSkyProbe();
    }

    return st;
  }

  /** Recomputes CSM frustums after viewport/aspect resize, strictly after CSM has initialized. */
  onCameraResize(): void {
    if (this.csm.camera !== null) {
      this.csm.updateFrustums();
    }
  }

  /** Advances deterministic cloud drift and calm water ripples on the 60 Hz sim clock. */
  advanceAtmosphere(dtS: number): void {
    if (dtS <= 0) return;
    this.skyUniforms.uCloudDrift.value += dtS * 0.0022;
    this.skyUniforms.uWaterTimeS.value += dtS;
  }

  /** Keeps sky dome centered on the camera so it never clips into world geometry. */
  followCamera(camPos: Vector3): void {
    this.skyDome.position.copy(camPos);
  }

  getShadowInfo(): ShadowConfigSummary {
    return {
      cascades: this.quality.shadowCascades,
      maxFarM: this.quality.shadowMaxFarM,
      mapSizePx: this.quality.shadowMapSizePx,
      fade: this.csm.fade,
      initialized: this.csm.camera !== null,
    };
  }

  dispose(): void {
    this.csm.dispose();
    this.probeTarget?.dispose();
    this.pmrem?.dispose();
    this.probeTarget = null;
    this.pmrem = null;
  }
}
