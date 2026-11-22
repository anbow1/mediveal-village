// Unified physical water surface for enclosed village lakes, meandering rivers & shallow fords
// (upgraded with FPS/marchland landView.ts techniques):
//   - High preset: MeshPhysicalNodeMaterial (IOR 1.333, receiveShadow = true) + real 4-tap underwater
//     bed refraction via viewportSharedTexture + exact Snell-refracted Beer-Lambert absorption + PMREM reflections
//   - Low preset: MeshPhysicalNodeMaterial (IOR 1.333, receiveShadow = true) + seamless FBM distance-calmed
//     ripples + PMREM Fresnel reflections & sun glints (no screen-copy overhead for smooth tablet play)
//   - Minimal preset: ultra-lightweight MeshBasicNodeMaterial with distance-calmed wavelets & analytic sky reflection

import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  NoColorSpace,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  screenUV,
  sin,
  smoothstep,
  sqrt,
  texture,
  transformNormalToView,
  varying,
  vec2,
  vec3,
  viewportSharedTexture,
} from 'three/tsl';
import type { QualityPreset } from '../config.ts';
import type { TerrainField } from '../sim/terrain.ts';
import { buildFullSkyNodeForWater, type PhysicalSkyUniforms } from './sky.ts';

export interface LakeWaterHandles {
  readonly mesh: Mesh;
  readonly dispose: () => void;
}

/** Deterministic seamless tiling 2D value-noise FBM for organic water ripples (ported from FPS/marchland). */
function buildTileableRippleTexture(size = 128): DataTexture {
  const hash2 = (ix: number, iy: number, period: number, seed: number): number => {
    const x = ((ix % period) + period) % period;
    const y = ((iy % period) + period) % period;
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const sampleOctave = (u: number, v: number, period: number, seed: number): number => {
    const fx = u * period;
    const fy = v * period;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const a = hash2(ix, iy, period, seed);
    const b = hash2(ix + 1, iy, period, seed);
    const c = hash2(ix, iy + 1, period, seed);
    const d = hash2(ix + 1, iy + 1, period, seed);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const f =
        sampleOctave(u, v, 6, 9) * 0.56 +
        sampleOctave(u, v, 12, 23) * 0.29 +
        sampleOctave(u, v, 24, 41) * 0.15;
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(f * 255)));
    }
  }
  const tex = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds 1 unified physical water mesh covering every lake, pond, river channel, and shallow ford
 * on the active 560 x 560 m `TerrainField` (skipping dry land cells to stay ultra-lean).
 */
export function buildLakeWater(
  terrain: TerrainField,
  skyUniforms: PhysicalSkyUniforms,
  heightGrid?: Float32Array,
  quality: QualityPreset = 'high',
): LakeWaterHandles {
  const wl = terrain.config.river?.waterLevelM ?? terrain.config.lake.waterLevelM;
  const n = terrain.config.gridResolution;
  const half = terrain.halfSizeM;
  const step = terrain.cellSizeM;
  const grid = heightGrid ?? terrain.bakeHeightGrid();

  // Map grid vertex indices -> compact emitted water vertex indices (only wet cells + 1-cell shore collar)
  const vertMap = new Int32Array(n * n).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  const depths: number[] = [];
  const indices: number[] = [];

  const getVert = (ix: number, iz: number): number => {
    const gIdx = iz * n + ix;
    const existing = vertMap[gIdx]!;
    if (existing >= 0) return existing;
    const wx = -half + ix * step;
    const wz = -half + iz * step;
    const d = wl - grid[gIdx]!;
    const outIdx = positions.length / 3;
    positions.push(wx, wl, wz);
    normals.push(0, 1, 0);
    depths.push(d);
    vertMap[gIdx] = outIdx;
    return outIdx;
  };

  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const d00 = wl - grid[iz * n + ix]!;
      const d10 = wl - grid[iz * n + (ix + 1)]!;
      const d01 = wl - grid[(iz + 1) * n + ix]!;
      const d11 = wl - grid[(iz + 1) * n + (ix + 1)]!;
      if (Math.max(d00, d10, d01, d11) > -0.06) {
        const v00 = getVert(ix, iz);
        const v10 = getVert(ix + 1, iz);
        const v01 = getVert(ix, iz + 1);
        const v11 = getVert(ix + 1, iz + 1);
        indices.push(v00, v01, v10, v10, v01, v11);
      }
    }
  }

  if (indices.length === 0) {
    positions.push(0, wl - 10, 0, 0.01, wl - 10, 0, 0, wl - 10, 0.01);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    depths.push(-10, -10, -10);
    indices.push(0, 1, 2);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('aDepth', new Float32BufferAttribute(depths, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();

  const t = skyUniforms.uWaterTimeS;
  const flowX = terrain.config.river?.axis === 'ew' ? t.mul(0.55) : float(0.0);
  const flowZ = terrain.config.river?.axis === 'ns' ? t.mul(0.55) : float(0.0);

  // High & Low presets: Physical water surface (IOR 1.333, PMREM sky/sun reflection, receives shadows!).
  // High adds real 4-tap underwater refraction via viewportSharedTexture (FPS/marchland landView.ts).
  if (quality !== 'minimal') {
    const ripples = buildTileableRippleTexture(128);
    const useRefraction = quality === 'high';
    const mat = new MeshPhysicalNodeMaterial({
      transparent: true,
      depthWrite: useRefraction,
      metalness: 0.0,
      ior: 1.333,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    mat.name = useRefraction ? 'MarchlandPhysicalRefractWaterMat' : 'MarchlandPhysicalWaterMat';

    const depth = varying(attribute('aDepth', 'float'), 'vWaterDepth');
    const safeDepth = max(depth, float(0.0));
    const wp = positionWorld;
    const xz = vec2(wp.x.sub(flowX), wp.z.sub(flowZ));

    // Two layers of FBM ripples drifting across each other, calmed with distance so overview never shimmers
    const a = texture(ripples, xz.div(9.0).add(vec2(t.mul(0.016), t.mul(0.009)))).r;
    const b = texture(ripples, xz.div(5.3).add(vec2(t.mul(-0.012), t.mul(0.014)))).r;
    const c = texture(ripples, xz.div(9.0).add(vec2(0.37, 0.19)).add(vec2(t.mul(0.016), t.mul(0.009)))).r;

    const toEye = cameraPosition.sub(wp);
    const dist = length(toEye);
    const V = toEye.div(max(dist, float(0.001)));

    const calm = smoothstep(float(0.02), float(0.35), safeDepth).div(dist.mul(0.012).add(1.0));
    const N = normalize(vec3(a.sub(b).mul(calm.mul(0.24)), float(1.0), c.sub(b).mul(calm.mul(0.24))));
    mat.normalNode = transformNormalToView(N);

    const NdotV = clamp(dot(N, V), 0.001, 1.0);
    const fresnel = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(NdotV), float(5.0))));

    // Exact Snell-refracted optical path length through water (IOR 1.333 -> n^2 = 1.77)
    const cosIn = sqrt(max(float(0.04), float(1.0).sub(float(1.0).sub(V.y.mul(V.y)).div(1.77))));
    const path = safeDepth.div(max(cosIn, float(0.15))).add(safeDepth);
    // Natural peaty lowland river/lake Beer-Lambert absorption (red absorbs first, deep turns teal-olive)
    const transmittance = exp(vec3(0.68, 0.28, 0.22).mul(path).negate());
    const shallowScatter = vec3(0.08, 0.15, 0.11);
    const deepScatter = vec3(0.02, 0.07, 0.085);
    const scatter = mix(shallowScatter, deepScatter, smoothstep(float(0.28), float(1.5), safeDepth))
      .mul(skyUniforms.uSkyRadiance)
      .mul(float(1.0).sub(transmittance.g));

    // Distance-adapted roughness keeps sun glints crisp up close and silky from afar
    mat.roughnessNode = float(0.045).add(a.mul(0.06)).add(smoothstep(float(35.0), float(260.0), dist).mul(0.12));

    if (useRefraction) {
      // 4-tap depth-softened underwater refraction of the real terrain bed & wading soldiers behind the surface!
      const distortion = N.xz.mul(0.036).mul(smoothstep(float(0.0), float(0.8), safeDepth)).div(dist.mul(0.02).add(1.0));
      const seen = clamp(screenUV.add(vec2(distortion.x, distortion.y.negate())), vec2(0.002), vec2(0.998));
      const spread = smoothstep(float(0.0), float(0.6), safeDepth).mul(0.0032).div(dist.mul(0.01).add(1.0));
      const behind = viewportSharedTexture(seen.add(vec2(spread, spread.mul(0.4))))
        .rgb.add(viewportSharedTexture(seen.add(vec2(spread.negate(), spread.mul(-0.4)))).rgb)
        .add(viewportSharedTexture(seen.add(vec2(spread.mul(-0.4), spread))).rgb)
        .add(viewportSharedTexture(seen.add(vec2(spread.mul(0.4), spread.negate()))).rgb)
        .mul(0.25);

      mat.colorNode = vec3(0.0);
      mat.emissiveNode = behind.mul(transmittance).add(scatter).mul(float(1.0).sub(fresnel));
      mat.opacityNode = smoothstep(float(0.0), float(0.07), depth);
    } else {
      // Low preset: physical PMREM reflections + shadows on water without viewportSharedTexture copy
      const bounceRgb = skyUniforms.uGroundBounceColor.rgb;
      const bedCol = bounceRgb.mul(vec3(0.58, 0.54, 0.38)).mul(transmittance);
      mat.colorNode = vec3(0.01, 0.03, 0.035);
      mat.emissiveNode = bedCol.add(scatter).mul(float(1.0).sub(fresnel));
      mat.opacityNode = clamp(
        smoothstep(float(0.0), float(0.10), depth).mul(mix(float(0.74), float(0.95), smoothstep(float(0.08), float(0.65), safeDepth))),
        0.0,
        0.96,
      );
    }

    const mesh = new Mesh(geo, mat);
    mesh.name = 'MarchlandWaterSurface';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 5;

    return {
      mesh,
      dispose() {
        geo.dispose();
        mat.dispose();
        ripples.dispose();
      },
    };
  }

  // Minimal preset: ultra-lightweight analytic water (zero PMREM/refraction overhead for 3 GB tablets)
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  mat.name = 'MarchlandLakeWaterMaterial';

  const depth = attribute('aDepth', 'float');
  const safeDepth = max(depth, float(0.0));
  const wp = positionWorld;
  const toEye = cameraPosition.sub(wp);
  const dist = length(toEye);
  const V = toEye.div(max(dist, float(0.001)));

  const waveAmp = smoothstep(float(0.0), float(0.42), safeDepth).div(dist.mul(0.012).add(1.0));
  const wx0 = wp.x.sub(flowX);
  const wz0 = wp.z.sub(flowZ);
  const warpX = sin(wz0.mul(0.55).add(t.mul(0.42))).mul(0.9);
  const warpZ = cos(wx0.mul(0.48).sub(t.mul(0.37))).mul(0.9);
  const wx = wx0.add(warpX);
  const wz = wz0.add(warpZ);
  const w1 = sin(wx.mul(1.7).add(wz.mul(0.62)).add(t.mul(1.25)));
  const w2 = cos(wx.mul(0.95).sub(wz.mul(2.45)).sub(t.mul(1.55)));
  const w3 = sin(wx.mul(3.8).add(wz.mul(2.1)).add(t.mul(1.9)));
  const nx = w1.mul(0.011).add(w2.mul(0.009)).add(w3.mul(0.007)).mul(waveAmp);
  const nz = w2.mul(0.011).sub(w1.mul(0.008)).add(w3.mul(0.006)).mul(waveAmp);
  const N = normalize(vec3(nx, float(1.0), nz));

  const NdotV = clamp(dot(N, V), 0.02, 1.0);
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(NdotV), float(4.6))));

  const R = normalize(reflect(V.negate(), N));
  const reflDir = normalize(vec3(R.x, max(R.y, float(0.02)), R.z));
  const skyRefl = buildFullSkyNodeForWater(reflDir, skyUniforms);

  const H = normalize(V.add(skyUniforms.uSunDir));
  const specTight = pow(clamp(dot(N, H), 0.0, 1.0), float(180.0)).mul(skyUniforms.uSunDiskGain).mul(0.55);
  const specBroad = pow(clamp(dot(N, H), 0.0, 1.0), float(30.0)).mul(skyUniforms.uMieStrength).mul(0.28);
  const reflection = skyRefl.add(skyUniforms.uSunGlowColor.mul(specTight.add(specBroad)));

  const bounceRgb = skyUniforms.uGroundBounceColor.rgb;
  const shallowBed = bounceRgb.mul(vec3(0.66, 0.62, 0.44));
  const deepScatter = bounceRgb.mul(vec3(0.07, 0.25, 0.34));
  const absorbR = exp(safeDepth.mul(-2.2));
  const absorbG = exp(safeDepth.mul(-1.15));
  const absorbB = exp(safeDepth.mul(-1.35));
  const bedTransmitted = shallowBed.mul(vec3(absorbR, absorbG, absorbB));
  const waterBody = mix(deepScatter, bedTransmitted.add(deepScatter.mul(0.35)), exp(safeDepth.mul(-1.1)));

  const shoreAlpha = smoothstep(float(0.0), float(0.14), depth);
  const reflWeight = clamp(fresnel.mul(1.3).add(0.18).mul(smoothstep(float(0.02), float(0.32), safeDepth)), 0.06, 0.96);
  const finalColor = mix(waterBody, reflection, reflWeight);

  mat.colorNode = vec3(finalColor);
  mat.opacityNode = clamp(shoreAlpha.mul(mix(float(0.76), float(0.96), smoothstep(float(0.08), float(0.65), safeDepth))), 0.0, 0.96);

  const mesh = new Mesh(geo, mat);
  mesh.name = 'MarchlandWaterSurface';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 3;

  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
