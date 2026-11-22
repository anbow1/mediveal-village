// Single unified analytic physical sky function (GUIDE.md §4, docs/graphics-playbook.md §4).
// Drives all four atmosphere consumers from one uniform block without pipeline rebuilds:
//   1. Sky dome (Rayleigh zenith + warm solar horizon + Mie scatter + procedural cloud deck + sun disc)
//   2. Persistent PMREM environment probe (same sky + physically lit warm soil ground bounce)
//   3. Height-integrated aerial perspective (`scene.fogNode`)
//   4. Physical calm water reflections & sun glints (ready for Stage 3 pond + Stage 4 lake/river)

import {
  BackSide,
  Color,
  MeshBasicNodeMaterial,
  Vector3,
} from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fog,
  fract,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  select,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { LightingPresetConfig, LightingPresetId } from '../config.ts';
import { kelvinToLinearRgb, type LinearRgb } from '../sim/lightingMath.ts';

export function createPhysicalSkyUniforms() {
  return {
    uSunDir: uniform(new Vector3(0.4, 0.8, 0.4)),
    uZenithColor: uniform(new Color(0.14, 0.36, 0.86)),
    uHorizonColor: uniform(new Color(0.68, 0.78, 0.9)),
    uAntiSolarHorizon: uniform(new Color(0.58, 0.7, 0.86)),
    uSunGlowColor: uniform(new Color(1.0, 0.94, 0.82)),
    uGroundBounceColor: uniform(new Color(0.16, 0.14, 0.11)),
    uCloudSunColor: uniform(new Color(1.0, 0.96, 0.9)),
    uCloudShadeColor: uniform(new Color(0.52, 0.58, 0.68)),
    uSunDiskGain: uniform(5.0),
    uMieStrength: uniform(0.32),
    uHazeExponent: uniform(3.0),
    uCloudCoverage: uniform(0.4),
    uCloudSoftness: uniform(0.4),
    uCloudDrift: uniform(0.0),
    uFogDensity: uniform(0.0009),
    uFogHeightFalloff: uniform(0.014),
    uHazeShare: uniform(1.0),
    uSkyRadiance: uniform(0.14),
    uContactShadowGain: uniform(0.4),
    uWaterTimeS: uniform(0.0),
  };
}

export type PhysicalSkyUniforms = ReturnType<typeof createPhysicalSkyUniforms>;
export type FloatUniform = PhysicalSkyUniforms['uContactShadowGain'];

type Vec2Node = ReturnType<typeof vec2>['xy'];
type Vec3Node = ReturnType<typeof vec3>['xyz'];

export interface SkyPresetParams {
  readonly presetId: LightingPresetId;
  readonly config: LightingPresetConfig;
  readonly preExposure: number;
  readonly sunDirection: Vector3;
}

/**
 * Updates the single shared sky/fog/probe/water uniform set from physical lux, kelvin,
 * sun angle, and pre-exposure (zero allocations, zero pipeline rebuilds).
 */
export function updatePhysicalSkyUniforms(
  u: PhysicalSkyUniforms,
  params: SkyPresetParams,
): { sunRgb: LinearRgb; skyRgb: LinearRgb } {
  const { presetId, config, preExposure, sunDirection } = params;
  const sunRgb = kelvinToLinearRgb(config.sunKelvin);
  const skyRgb = kelvinToLinearRgb(config.skyKelvin);

  const skyLum = (config.skyIlluminanceLux / Math.PI) * preExposure;
  u.uSkyRadiance.value = skyLum;
  const isOvercast = presetId === 'overcast';
  const isGolden = presetId === 'goldenHour';
  const isAutumn = presetId === 'lateAutumn';

  // Rayleigh zenith stays distinctly rich cerulean-blue on clear/autumn days, deep twilight indigo at sunset,
  // and crisp cool slate-blue in overcast (never washed-out beige or lilac).
  const zenithR = isOvercast ? 0.52 : isGolden ? 0.08 : isAutumn ? 0.08 : 0.07;
  const zenithG = isOvercast ? 0.59 : isGolden ? 0.21 : isAutumn ? 0.30 : 0.34;
  const zenithB = isOvercast ? 0.71 : isGolden ? 0.66 : isAutumn ? 0.86 : 0.96;
  const zenithGain = isOvercast ? 1.48 : isGolden ? 1.85 : 2.25;
  u.uZenithColor.value.setRGB(
    zenithR * skyLum * zenithGain,
    zenithG * skyLum * zenithGain,
    zenithB * skyLum * zenithGain,
  );

  // Horizon blends Rayleigh scatter with solar warm haze so dome, fog, and water share one crisp hue without milky washout.
  const hazeMix = isGolden ? 0.76 : isAutumn ? 0.40 : isOvercast ? 0.12 : 0.18;
  const horizonGain = isOvercast ? 1.46 : isGolden ? 2.0 : 1.98;
  const hzR = (skyRgb.r * (1 - hazeMix) + sunRgb.r * hazeMix) * skyLum * horizonGain;
  const hzG = (skyRgb.g * (1 - hazeMix) + sunRgb.g * hazeMix) * skyLum * horizonGain;
  const hzB = (skyRgb.b * (1 - hazeMix) + sunRgb.b * hazeMix) * skyLum * horizonGain;
  u.uHorizonColor.value.setRGB(hzR, hzG, hzB);

  // Anti-solar horizon stays distinctly cooler azure opposite the sun (natural sunset/autumn sky contrast).
  const antiMix = isGolden ? 0.18 : isOvercast ? 0.10 : 0.08;
  const antiGain = isOvercast ? 1.42 : isGolden ? 1.45 : 1.85;
  u.uAntiSolarHorizon.value.setRGB(
    (skyRgb.r * (1 - antiMix) + sunRgb.r * antiMix) * skyLum * antiGain,
    (skyRgb.g * (1 - antiMix) + sunRgb.g * antiMix) * skyLum * antiGain,
    (skyRgb.b * (1 - antiMix) + sunRgb.b * antiMix) * skyLum * antiGain,
  );

  // Physically lit living meadow / warm soil ground bounce for the lower hemisphere of the PMREM probe.
  const sinElev = Math.max(0.12, sunDirection.y);
  const bounceGain = ((config.groundBounceFactor / 0.24) * preExposure) / Math.PI;
  const directHoriz = config.sunIlluminanceLux * sinElev;
  const gR = (directHoriz * sunRgb.r + config.skyIlluminanceLux * skyRgb.r) * bounceGain * 0.29;
  const gG = (directHoriz * sunRgb.g + config.skyIlluminanceLux * skyRgb.g) * bounceGain * 0.29;
  const gB = (directHoriz * sunRgb.b + config.skyIlluminanceLux * skyRgb.b) * bounceGain * 0.17;
  u.uGroundBounceColor.value.setRGB(gR, gG, gB);

  // Solar forward-scatter glow & cloud lighting colours in pre-exposed linear HDR units.
  const glowScale = isOvercast ? 0.32 : isGolden ? 3.2 : isAutumn ? 2.75 : 2.55;
  u.uSunGlowColor.value.setRGB(
    sunRgb.r * skyLum * glowScale,
    sunRgb.g * skyLum * glowScale,
    sunRgb.b * skyLum * glowScale,
  );

  const cloudSunScale = isOvercast ? 1.44 : isGolden ? 2.85 : isAutumn ? 2.65 : 2.75;
  u.uCloudSunColor.value.setRGB(
    (sunRgb.r * 0.8 + 0.2) * skyLum * cloudSunScale,
    (sunRgb.g * 0.8 + 0.2) * skyLum * cloudSunScale,
    (sunRgb.b * 0.8 + 0.2) * skyLum * cloudSunScale,
  );

  const cloudShadeScale = isOvercast ? 1.12 : isGolden ? 0.82 : 1.04;
  u.uCloudShadeColor.value.setRGB(
    (skyRgb.r * 0.55 + (hzR / Math.max(0.001, skyLum * horizonGain)) * 0.45) * skyLum * cloudShadeScale,
    (skyRgb.g * 0.55 + (hzG / Math.max(0.001, skyLum * horizonGain)) * 0.45) * skyLum * cloudShadeScale,
    (skyRgb.b * 0.55 + (hzB / Math.max(0.001, skyLum * horizonGain)) * 0.45) * skyLum * cloudShadeScale,
  );

  u.uSunDir.value.copy(sunDirection);
  u.uSunDiskGain.value = isOvercast ? 0.08 : isGolden ? 6.8 : isAutumn ? 5.6 : 5.0;
  u.uMieStrength.value = isOvercast ? 0.1 : isGolden ? 0.58 : isAutumn ? 0.38 : 0.26;
  u.uHazeExponent.value = isGolden ? 2.0 : isAutumn ? 2.6 : isOvercast ? 1.6 : 3.2;
  u.uCloudCoverage.value = config.cloudCoverage;
  u.uCloudSoftness.value = config.cloudSoftness;
  u.uFogDensity.value = config.fogDensityPerM;
  u.uFogHeightFalloff.value = config.fogHeightFalloffPerM;
  u.uContactShadowGain.value = config.contactShadowOpacity;

  return { sunRgb, skyRgb };
}

/** 2D smooth value noise (playbook §11: 2D hash avoids 1D vertical stripes). */
function valueNoise2D(p: Vec2Node) {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0)));

  const h00 = fract(sin(dot(i, vec2(127.1, 311.7))).mul(43758.5453));
  const h10 = fract(sin(dot(i.add(vec2(1.0, 0.0)), vec2(127.1, 311.7))).mul(43758.5453));
  const h01 = fract(sin(dot(i.add(vec2(0.0, 1.0)), vec2(127.1, 311.7))).mul(43758.5453));
  const h11 = fract(sin(dot(i.add(vec2(1.0, 1.0)), vec2(127.1, 311.7))).mul(43758.5453));

  const nx0 = mix(h00, h10, u.x);
  const nx1 = mix(h01, h11, u.x);
  return mix(nx0, nx1, u.y);
}

/** 3-octave domain-warped sky cloud fBM (zero textures, compiles fast on WebGPU & WebGL2). */
function cloudFbm(p: Vec2Node) {
  const warp = vec2(sin(p.y.mul(0.75).add(0.4)), cos(p.x.mul(0.68).sub(0.3))).mul(0.32);
  const q = p.add(warp);
  const n1 = valueNoise2D(q);
  // Rotate second & third octaves to break axis alignment.
  const q2 = vec2(q.x.mul(1.68).sub(q.y.mul(1.31)), q.x.mul(1.31).add(q.y.mul(1.68))).add(vec2(5.2, 1.3));
  const n2 = valueNoise2D(q2);
  const q3 = vec2(q2.x.mul(1.75).add(q2.y.mul(1.18)), q2.y.mul(1.75).sub(q2.x.mul(1.18))).add(vec2(2.7, 9.1));
  const n3 = valueNoise2D(q3);
  return n1.mul(0.56).add(n2.mul(0.29)).add(n3.mul(0.15));
}

/**
 * Shared analytic Rayleigh + solar-horizon + Mie scattering function (no clouds / no hard sun disc).
 * Used directly by sky dome, PMREM probe, height fog, and water reflections so every horizon agrees.
 */
function buildSkyScatterNode(dir: Vec3Node, u: PhysicalSkyUniforms) {
  const up = clamp(dir.y, 0.0, 1.0);
  const sunCos = dot(dir, u.uSunDir);
  const sunAlign = clamp(sunCos.mul(0.5).add(0.5), 0.0, 1.0);
  const sunPos = clamp(sunCos, 0.0, 1.0);

  // Azimuthal horizon blends smoothly between warm sunward haze and calmer anti-solar horizon.
  const horizonCol = mix(u.uAntiSolarHorizon, u.uHorizonColor, pow(sunAlign, float(1.4)));
  const hazeFactor = pow(float(1.0).sub(up), u.uHazeExponent);
  const upperSky = mix(u.uZenithColor, horizonCol, hazeFactor);

  // Broad Mie forward glow concentrated near the horizon toward the sun + tighter corona.
  const horizonBand = pow(float(1.0).sub(up), float(2.2));
  const mieBroad = pow(sunPos, float(5.0)).mul(u.uMieStrength).mul(float(0.35).add(horizonBand.mul(0.85)));
  const mieTight = pow(sunPos, float(32.0)).mul(u.uMieStrength).mul(0.55);
  return upperSky.add(u.uSunGlowColor.mul(mieBroad.add(mieTight)));
}

/**
 * Full sky function including the procedural cloud deck, optional solar disc, and physically lit
 * warm soil ground-bounce hemisphere below the horizon.
 */
function buildFullSkyNode(
  dir: Vec3Node,
  u: PhysicalSkyUniforms,
  opts: { includeSunDisk: boolean; clampSunGlowForProbe: boolean },
) {
  const clearSky = buildSkyScatterNode(dir, u);
  const sunPos = clamp(dot(dir, u.uSunDir), 0.0, 1.0);

  // Procedural high-altitude cloud deck visible cleanly from low eye/RTS pitch up to zenith.
  const projDenom = max(dir.y, float(0.0)).add(0.2);
  const cloudUv = dir.xz.div(projDenom).mul(0.54).add(vec2(u.uCloudDrift, u.uCloudDrift.mul(0.35)));
  const n = cloudFbm(cloudUv);
  const lo = float(1.0).sub(u.uCloudCoverage).sub(u.uCloudSoftness.mul(0.24));
  const hi = float(1.0).sub(u.uCloudCoverage).add(u.uCloudSoftness.mul(0.36)).add(0.1);
  const cloudDensity = smoothstep(lo, hi, n).mul(smoothstep(float(0.015), float(0.11), dir.y));

  // Silver-lining & sunlit cloud rims toward the sun, softer shaded cloud cores away from sun.
  const silverLining = pow(sunPos, float(4.0)).mul(0.6).add(pow(sunPos, float(20.0)).mul(0.45));
  const rimTerm = float(1.0).sub(cloudDensity.mul(0.42));
  const litCloud = mix(u.uCloudShadeColor, u.uCloudSunColor, clamp(float(0.25).add(silverLining.mul(rimTerm)), 0.0, 1.0));
  // Blend cloud edges gently into horizon haze so distant clouds sit inside the atmosphere.
  const distHaze = pow(float(1.0).sub(clamp(dir.y, 0.0, 1.0)), float(5.0)).mul(0.32);
  const cloudColor = mix(litCloud, u.uHorizonColor, distHaze);

  const skyWithClouds = mix(clearSky, cloudColor, cloudDensity.mul(0.94));

  // Physical solar disc (attenuated by thick cloud cover; softly clamped inside PMREM probe).
  const diskMask = smoothstep(float(0.9993), float(0.99985), sunPos).mul(float(1.0).sub(cloudDensity.mul(0.88)));
  const sunContrib = opts.includeSunDisk
    ? u.uSunGlowColor.mul(diskMask.mul(u.uSunDiskGain))
    : opts.clampSunGlowForProbe
      ? u.uSunGlowColor.mul(pow(sunPos, float(64.0)).mul(0.65).mul(float(1.0).sub(cloudDensity.mul(0.7))))
      : vec3(0.0);

  const upperFinal = skyWithClouds.add(sunContrib);

  // Lower hemisphere: physically lit warm soil ground bounce (critical for readable undersides in PMREM).
  const sunGroundLift = float(1.0).add(clamp(dot(dir.xz, u.uSunDir.xz), 0.0, 1.0).mul(0.24));
  const groundHemi = u.uGroundBounceColor.mul(sunGroundLift);
  const horizonEdge = mix(u.uAntiSolarHorizon, u.uHorizonColor, clamp(dot(dir, u.uSunDir).mul(0.5).add(0.5), 0.0, 1.0));
  const lowerFinal = mix(horizonEdge.mul(0.75), groundHemi, smoothstep(float(0.0), float(-0.22), dir.y));

  return mix(lowerFinal, upperFinal, smoothstep(float(-0.02), float(0.025), dir.y));
}

/** Sky dome material (rendered on layer 0 around the camera, fog disabled). */
export function createSkyDomeMaterial(u: PhysicalSkyUniforms): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  mat.name = 'PhysicalSkyDomeMaterial';
  const dir = normalize(positionLocal);
  mat.colorNode = vec3(buildFullSkyNode(dir, u, { includeSunDisk: true, clampSunGlowForProbe: false }));
  return mat;
}

/** Shared reflection evaluation for calm lakes & rivers (exact same sky + cloud function as dome & fog). */
export function buildFullSkyNodeForWater(dir: Vec3Node, u: PhysicalSkyUniforms) {
  return buildFullSkyNode(dir, u, { includeSunDisk: false, clampSunGlowForProbe: false });
}

/** PMREM environment reflection probe material (same sky + warm soil ground bounce, no ringing spike). */
export function createSkyProbeMaterial(u: PhysicalSkyUniforms): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  mat.name = 'PhysicalSkyProbeMaterial';
  const dir = normalize(positionLocal);
  mat.colorNode = vec3(buildFullSkyNode(dir, u, { includeSunDisk: false, clampSunGlowForProbe: true }));
  return mat;
}

/**
 * Height-integrated physical aerial perspective node (`scene.fogNode`).
 * Formula from docs/graphics-playbook.md §4 #4:
 *   tau = rho0 * d * exp(-f * h0) * (1 - exp(-f * (h1 - h0))) / (f * (h1 - h0))
 * Fog colour reads the exact same analytic sky scatter function as the sky dome.
 */
export function createHeightFogNode(u: PhysicalSkyUniforms) {
  const viewVec = positionWorld.sub(cameraPosition);
  const dist = length(viewVec);
  const viewDir = viewVec.div(max(dist, float(0.001)));

  const h0 = max(cameraPosition.y, float(0.0));
  const h1 = max(positionWorld.y, float(0.0));
  const dh = h1.sub(h0);
  const uTerm = u.uFogHeightFalloff.mul(dh);

  // Taylor-safe evaluation of (1 - exp(-u)) / u when camera and target are at nearly equal height.
  const taylorRatio = float(1.0).sub(uTerm.mul(0.5)).add(uTerm.mul(uTerm).div(6.0));
  const exactRatio = float(1.0).sub(exp(uTerm.negate())).div(select(abs(uTerm).lessThan(0.002), float(1.0), uTerm));
  const heightRatio = select(abs(uTerm).lessThan(0.002), taylorRatio, exactRatio);

  const tau = max(
    float(0.0),
    u.uFogDensity.mul(u.uHazeShare).mul(dist).mul(exp(u.uFogHeightFalloff.mul(h0).negate())).mul(heightRatio),
  );
  const fogFactor = clamp(float(1.0).sub(exp(tau.negate())), 0.0, 0.94);

  // Sample the horizon scatter band along the view ray azimuth so distant haze matches the sky seamlessly.
  const scatterDir = normalize(vec3(viewDir.x, clamp(viewDir.y, 0.03, 0.28), viewDir.z));
  const fogColor = buildSkyScatterNode(scatterDir, u);

  return fog(fogColor, fogFactor);
}

/**
 * Physical calm-water material driven by the exact same analytic sky function (GUIDE.md §4, BRIEF.md F05).
 * Features an organic warped shoreline matching the wet-silt ground bank, crisp animated wind wavelets,
 * Schlick Fresnel (F0 = 0.02), deep olive-peat water body, and reflected sky + clouds + sun sparkle.
 */
export function createCalmWaterMaterial(u: PhysicalSkyUniforms): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    // Positive polygonOffset for reversedDepthBuffer: true (playbook §11).
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  mat.name = 'MarchlandCalmWaterMaterial';

  const wp = positionWorld;
  const t = u.uWaterTimeS;

  // Multi-frequency organic wind wavelets clearly breaking up sky & sunset reflections.
  const w1 = sin(wp.x.mul(4.1).add(wp.z.mul(2.8)).add(t.mul(1.3)));
  const w2 = cos(wp.x.mul(7.3).sub(wp.z.mul(5.9)).sub(t.mul(1.7)));
  const w3 = sin(wp.z.mul(12.2).add(wp.x.mul(4.6)).add(t.mul(1.05)));
  const w4 = cos(wp.x.mul(16.5).add(wp.z.mul(13.1)).sub(t.mul(2.1)));
  const nx = w1.mul(0.024).add(w2.mul(0.018)).add(w3.mul(0.011)).add(w4.mul(0.007));
  const nz = w2.mul(0.024).sub(w1.mul(0.015)).add(w3.mul(0.014)).sub(w4.mul(0.007));
  const N = normalize(vec3(nx, float(1.0), nz));

  const V = normalize(cameraPosition.sub(wp));
  const NdotV = clamp(dot(N, V), 0.02, 1.0);

  // Physical Schlick Fresnel for air -> water interface (IOR 1.333 -> F0 = 0.02) + grazing clarity boost.
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(NdotV), float(4.2))));

  // Reflect view ray off rippled normal into THE EXACT SAME analytic sky + cloud function.
  const R = normalize(reflect(V.negate(), N));
  const reflDir = normalize(vec3(R.x, max(R.y, float(0.02)), R.z));
  const skyRefl = buildFullSkyNode(reflDir, u, { includeSunDisk: false, clampSunGlowForProbe: false });

  // Crisp sun specular sparkle on animated wind wavelets.
  const H = normalize(V.add(u.uSunDir));
  const specTight = pow(clamp(dot(N, H), 0.0, 1.0), float(140.0)).mul(u.uSunDiskGain).mul(0.45);
  const specBroad = pow(clamp(dot(N, H), 0.0, 1.0), float(28.0)).mul(u.uMieStrength).mul(0.32);
  const reflection = skyRefl.add(u.uSunGlowColor.mul(specTight.add(specBroad)));

  // Organic warped pond silhouette matching the wet-silt bank in surfaces.ts (zero geometric oval look).
  const lp = positionLocal.xy;
  const edgeWarp = sin(lp.x.mul(3.1).add(lp.y.mul(2.4)).add(0.5))
    .mul(0.11)
    .add(cos(lp.x.mul(5.2).sub(lp.y.mul(4.1))).mul(0.065));
  const radial = length(lp).add(edgeWarp);

  // Deep realistic olive-peat village pond body transitioning to warmer translucent silty shallows.
  const bounceRgb = u.uGroundBounceColor.rgb;
  const deepBody = bounceRgb.mul(vec3(0.15, 0.24, 0.2));
  const shallowEdge = smoothstep(float(0.55), float(0.88), radial);
  const waterBody = mix(deepBody, bounceRgb.mul(vec3(0.42, 0.38, 0.29)), shallowEdge);

  // Subtle ripple shimmer on the reflection blend so water reads unmistakably as liquid at RTS pitch.
  const reflMix = clamp(fresnel.mul(1.35).add(0.28).mul(float(1.0).sub(shallowEdge.mul(0.42))), 0.12, 0.96);
  const finalWater = mix(waterBody, reflection, reflMix);
  mat.colorNode = vec3(finalWater);
  // Crisp natural waterline fading smoothly into damp mud over ~15 cm.
  mat.opacityNode = float(1.0).sub(smoothstep(float(0.82), float(0.92), radial)).mul(0.96);

  return mat;
}
