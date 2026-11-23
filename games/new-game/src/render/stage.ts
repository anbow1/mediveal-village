// WebGPU + WebGL2 single-path stage: HDR pass + MRT velocity -> TRAA -> sun shafts -> bloom ->
// exposure + ACES/AgX tone map + sRGB (once) -> CAS-style sharpen (playbook §1, GUIDE.md §4).

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  HalfFloatType,
  NoToneMapping,
  PerspectiveCamera,
  RenderPipeline,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  clamp,
  convertToTexture,
  dot,
  float,
  int,
  ivec2,
  max,
  min,
  mix,
  mrt,
  output,
  pass,
  renderOutput,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { CAMERA, QUALITY_PRESETS, type GovernorStep, type QualityPreset, type ToneMappingChoice } from '../config.ts';
import { installWebGpuCompat } from './webgpuCompat.ts';
import { shareStaticInstanceShaders } from './instancing.ts';
import { PassTimer } from './perf.ts';
import { warmAllPipelines } from './warmup.ts';

export interface StageOptions {
  readonly container: HTMLElement;
  readonly quality: QualityPreset;
  readonly toneMapping: ToneMappingChoice;
}

export class RenderStage {
  readonly renderer: WebGPURenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly passTimer: PassTimer;
  readonly pipeline: RenderPipeline | null;
  readonly quality: QualityPreset;
  readonly toneMapping: ToneMappingChoice;

  private readonly uSunScreenPos = uniform(new Vector2(0.5, 0.5));
  private readonly uSunShaftWeight = uniform(float(0.0));
  private readonly uSunShaftSamples = uniform(int(0));
  private readonly uSunShaftTint = uniform(new Vector3(1, 0.94, 0.82));
  private readonly uRelativeExposure = uniform(float(1.0));
  private readonly uSharpenStrength = uniform(float(0.3));
  private readonly uTexelSize = uniform(new Vector2(1 / 1280, 1 / 720));
  private readonly uViewportSize = uniform(new Vector2(1280, 720));
  private readonly bloomNode: ReturnType<typeof bloom> | null;

  private baseDpr = 1;
  private renderScale = 1;
  private lastWidth = 0;
  private lastHeight = 0;
  private readonly tmpVec3 = new Vector3();

  private constructor(
    renderer: WebGPURenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    passTimer: PassTimer,
    quality: QualityPreset,
    toneMapping: ToneMappingChoice,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.passTimer = passTimer;
    this.quality = quality;
    this.toneMapping = toneMapping;

    const qCfg = QUALITY_PRESETS[quality];
    this.uSunShaftSamples.value = qCfg.sunShaftSamples;
    this.uSharpenStrength.value = qCfg.sharpenStrength;
    const tmEnum = toneMapping === 'agx' ? AgXToneMapping : ACESFilmicToneMapping;

    if (!qCfg.traaEnabled) {
      // Minimal preset for low-end / 3 GB mobile & tablet GPUs (iPad 7, Tab S2 / Adreno 510):
      // render directly to the canvas framebuffer with built-in tone mapping — zero HalfFloatType FBO,
      // zero MRT, zero post-processing passes (halves VRAM & works on older WebGL2 drivers).
      renderer.toneMapping = tmEnum;
      renderer.toneMappingExposure = 1.0;
      this.bloomNode = null;
      this.pipeline = null;
      return;
    }

    // 1. HDR scene pass with MRT { output, velocity } for TRAA (playbook §1).
    const scenePass = pass(scene, camera, { type: HalfFloatType });
    scenePass.setMRT(mrt({ output, velocity }));

    const sceneColor = scenePass.getTextureNode('output');
    const sceneDepth = scenePass.getTextureNode('depth');
    const sceneVelocity = scenePass.getTextureNode('velocity');

    // 2. TRAA on BOTH High and Low presets (GUIDE.md §2b, §4, §7).
    const aaNode = traa(sceneColor, sceneDepth, sceneVelocity, camera);
    const aaTex = convertToTexture(aaNode);

    // 3. Screen-space radial sun shafts sampling sky pixels only (reversed depth <= 0.0001).
    // Uses textureLoad (no implicit LOD) so it compiles cleanly under WGSL non-uniform control flow.
    const sunShafts = Fn(() => {
      const accum = float(0.0).toVar();
      const samples = this.uSunShaftSamples;
      const weight = this.uSunShaftWeight;
      const maxCoord = this.uViewportSize.sub(vec2(1.0));
      If(samples.greaterThan(int(0)).and(weight.greaterThan(0.001)), () => {
        const uv0 = screenUV;
        const delta = this.uSunScreenPos.sub(uv0).div(float(samples).max(1.0));
        const coord = uv0.toVar();
        const decay = float(1.0).toVar();
        Loop(samples, () => {
          coord.addAssign(delta);
          const clampedUv = clamp(coord, vec2(0.001), vec2(0.999));
          const texel = ivec2(clamp(clampedUv.mul(this.uViewportSize), vec2(0.0), maxCoord));
          // Reversed depth: far plane (sky) sits at 0.0; solid geometry > 0.0001 occludes beams.
          const d = sceneDepth.load(texel).r;
          const isSky = float(1.0).sub(clamp(d.mul(5000.0), 0.0, 1.0));
          accum.addAssign(isSky.mul(decay));
          decay.mulAssign(0.94);
        });
        accum.divAssign(float(samples).max(1.0));
      });
      return this.uSunShaftTint.mul(accum.mul(weight));
    });

    const withShafts = vec4(aaTex.rgb.add(sunShafts()), aaTex.a);

    // 4. Physical bloom (subtle highlight halo; threshold in pre-exposed linear HDR units).
    this.bloomNode = bloom(withShafts, qCfg.bloomStrength, qCfg.bloomRadius, qCfg.bloomThreshold);
    const hdrCombined = vec4(withShafts.rgb.add(this.bloomNode.rgb).mul(this.uRelativeExposure), float(1.0));

    // 5. Tone map + sRGB output transform ONCE (outputColorTransform = false prevents double transform).
    const toneMapped = renderOutput(hdrCombined, tmEnum, SRGBColorSpace);
    const srgbTex = convertToTexture(toneMapped);

    // 6. 5-tap CAS-style contrast-adaptive sharpen in sRGB (wins back TRAA softness).
    const casSharpen = Fn(() => {
      const uv0 = screenUV;
      const c = srgbTex.sample(uv0).rgb;
      const dx = vec2(this.uTexelSize.x, float(0.0));
      const dy = vec2(float(0.0), this.uTexelSize.y);
      const n = srgbTex.sample(uv0.add(dy)).rgb;
      const s = srgbTex.sample(uv0.sub(dy)).rgb;
      const e = srgbTex.sample(uv0.add(dx)).rgb;
      const w = srgbTex.sample(uv0.sub(dx)).rgb;

      const mn = min(c, min(min(n, s), min(e, w)));
      const mx = max(c, max(max(n, s), max(e, w)));
      // Contrast-adaptive weight attenuates sharpening on flat sky/edges to prevent ringing.
      const amp = clamp(min(mn, vec3(1.0).sub(mx)).div(max(mx, vec3(0.001))), 0.0, 1.0);
      const localAvg = n.add(s).add(e).add(w).mul(0.25);
      const sharpened = clamp(c.add(c.sub(localAvg).mul(amp).mul(this.uSharpenStrength.mul(1.8))), 0.0, 1.0);
      const baseCol = mix(c, sharpened, clamp(this.uSharpenStrength.mul(4.0), 0.0, 1.0));

      // Restrained European photographic grading (Manor Lords / Kingdom Come palette):
      // gentle vibrance recovery without oversaturated neon greens, subtle cool-shadow / warm-sun
      // split-toning, soft S-curve contrast, and a very gentle optical lens vignette.
      const lum = dot(baseCol, vec3(0.2126, 0.7152, 0.0722));
      const maxCh = max(baseCol.r, max(baseCol.g, baseCol.b));
      const minCh = min(baseCol.r, min(baseCol.g, baseCol.b));
      const chroma = maxCh.sub(minCh);
      const satGain = float(1.06).add(float(0.14).mul(float(1.0).sub(chroma)));
      const balanced = clamp(vec3(lum).add(baseCol.sub(vec3(lum)).mul(satGain)), 0.0, 1.0);
      // Cool sky tint in deep shadows, subtle golden warmth in sunlit highlights
      const shadowW = float(1.0).sub(smoothstep(float(0.05), float(0.38), lum));
      const highW = smoothstep(float(0.45), float(0.92), lum);
      const splitToned = clamp(
        balanced.add(vec3(-0.008, -0.002, 0.012).mul(shadowW)).add(vec3(0.012, 0.006, -0.007).mul(highW)),
        0.0,
        1.0,
      );
      const contrasted = mix(splitToned, smoothstep(vec3(0.0), vec3(1.0), splitToned), float(0.10));
      // Subtle optical edge vignette (~8% at corners) focuses the eye on the village/battlefield
      const vc = uv0.sub(vec2(0.5));
      const vig = float(1.0).sub(smoothstep(float(0.18), float(0.56), dot(vc, vc)).mul(0.09));
      const graded = contrasted.mul(vig);
      return vec4(graded, float(1.0));
    });

    this.pipeline = new RenderPipeline(renderer, casSharpen());
    this.pipeline.outputColorTransform = false;
  }

  static async create(opts: StageOptions): Promise<RenderStage> {
    installWebGpuCompat();

    const qCfg = QUALITY_PRESETS[opts.quality];
    const usePostPipeline = qCfg.traaEnabled;
    const renderer = new WebGPURenderer({
      antialias: false,
      trackTimestamp: usePostPipeline,
      reversedDepthBuffer: usePostPipeline,
    });
    renderer.toneMapping = NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = qCfg.shadowCascades > 0;

    const passTimer = new PassTimer();
    renderer.inspector = passTimer;

    await renderer.init();

    const scene = new Scene();
    const width = Math.max(1, opts.container.clientWidth || window.innerWidth);
    const height = Math.max(1, opts.container.clientHeight || window.innerHeight);
    // Without reversed depth (Low & Minimal presets), lift near plane from 0.25 m to 1.5 m
    // so 16/24-bit mobile depth buffers keep crisp precision with zero foreground Z-fighting.
    const camNear = usePostPipeline ? CAMERA.nearM : 1.5;
    const camFar = usePostPipeline ? CAMERA.farM : 1200;
    const camera = new PerspectiveCamera(CAMERA.fovDeg, width / height, camNear, camFar);

    passTimer.mainScene = scene;
    passTimer.mainCamera = camera;

    opts.container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const stage = new RenderStage(renderer, scene, camera, passTimer, opts.quality, opts.toneMapping);
    stage.resize(width, height);
    return stage;
  }

  get backendName(): 'WebGPU' | 'WebGL2' {
    return 'isWebGPUBackend' in (this.renderer.backend as object) ? 'WebGPU' : 'WebGL2';
  }

  get currentRenderScale(): number {
    return this.renderScale;
  }

  /** Shares shaders across static instanced meshes and warms every pipeline via one real frame. */
  async warmUp(): Promise<{ sharedInstances: number }> {
    const sharedInstances = shareStaticInstanceShaders(this.renderer, this.scene);
    // Playbook §11: wait for a real animation frame so PassNode renders and builds every pipeline.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    warmAllPipelines(this.scene, () => {
      if (this.pipeline) {
        this.pipeline.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    });
    return { sharedInstances };
  }

  /** Apply governor step via uniforms and render scale only (0 shader recompiles). */
  applyGovernorStep(step: GovernorStep): void {
    const qCfg = QUALITY_PRESETS[this.quality];
    this.uSunShaftSamples.value = Math.min(qCfg.sunShaftSamples, step.sunShaftSamples);
    if (this.bloomNode) {
      this.bloomNode.strength.value = step.bloomEnabled ? qCfg.bloomStrength : 0.0;
    }
    if (Math.abs(step.renderScale - this.renderScale) > 0.001) {
      this.renderScale = step.renderScale;
      this.applyPixelSize();
    }
  }

  /** Relative exposure offset (stops from preset anchor EV100). 0.0 = exact preset anchor EV100. */
  setExposureOffsetStops(stops: number): void {
    const gain = Math.pow(2, stops);
    this.uRelativeExposure.value = gain;
    if (!this.pipeline) {
      this.renderer.toneMappingExposure = gain;
    }
  }

  /** Projects sun world direction to screen UV and scales sun shaft weight by view alignment. */
  updateSunShafts(
    sunDirection: Vector3,
    presetStrength: number,
    sunRgb?: { readonly r: number; readonly g: number; readonly b: number },
  ): void {
    if (sunRgb) {
      this.uSunShaftTint.value.set(sunRgb.r, sunRgb.g, sunRgb.b);
    }
    const camForward = this.camera.getWorldDirection(this.tmpVec3);
    const alignment = camForward.dot(sunDirection);
    if (alignment <= 0.1 || presetStrength <= 0.001) {
      this.uSunShaftWeight.value = 0.0;
      return;
    }
    const sunWorld = this.camera.position.clone().addScaledVector(sunDirection, 500);
    sunWorld.project(this.camera);
    const sx = sunWorld.x * 0.5 + 0.5;
    const sy = 1.0 - (sunWorld.y * 0.5 + 0.5);
    this.uSunScreenPos.value.set(sx, sy);
    const fade = Math.max(0, Math.min(1, (alignment - 0.1) / 0.55));
    this.uSunShaftWeight.value = presetStrength * fade * 0.32;
  }

  resize(width: number, height: number): void {
    this.lastWidth = Math.max(1, Math.floor(width));
    this.lastHeight = Math.max(1, Math.floor(height));
    const qCfg = QUALITY_PRESETS[this.quality];
    this.baseDpr = Math.min(qCfg.maxDpr, window.devicePixelRatio || 1);
    this.camera.aspect = this.lastWidth / this.lastHeight;
    this.camera.updateProjectionMatrix();
    this.applyPixelSize();
  }

  private applyPixelSize(): void {
    const dpr = Math.max(0.4, this.baseDpr * this.renderScale);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.lastWidth, this.lastHeight, false);
    const pw = Math.max(1, Math.floor(this.lastWidth * dpr));
    const ph = Math.max(1, Math.floor(this.lastHeight * dpr));
    this.uTexelSize.value.set(1 / pw, 1 / ph);
    this.uViewportSize.value.set(pw, ph);
  }

  render(): void {
    if (this.pipeline) {
      this.pipeline.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.passTimer.poll(this.renderer);
  }

  dispose(): void {
    this.pipeline?.dispose();
    this.renderer.dispose();
  }
}
