// Unified physical water surface for enclosed village lakes, meandering rivers & shallow fords
// (playbook §7.1 & §7.2b, GUIDE.md §4).
// Uses the EXACT `TerrainField` height grid vertices (2.0 m cells over 560 x 560 m), emitting ONLY
// wet cells + a 2 m shoreline skirt into 1 single draw call with zero shoreline seams or Z-fighting,
// driven by `sky.ts` analytic physical sky reflection, Beer-Lambert depth absorption, Schlick Fresnel,
// domain-warped fetch-damped wind ripples, and smooth thin-film shoreline alpha fade.

import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
} from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  vec3,
} from 'three/tsl';
import type { TerrainField } from '../sim/terrain.ts';
import { buildFullSkyNodeForWater, type PhysicalSkyUniforms } from './sky.ts';

export interface LakeWaterHandles {
  readonly mesh: Mesh;
  readonly dispose: () => void;
}

/**
 * Builds 1 unified physical water mesh covering every lake, pond, river channel, and shallow ford
 * on the active 560 x 560 m `TerrainField` (skipping dry land cells to stay ultra-lean).
 */
export function buildLakeWater(
  terrain: TerrainField,
  skyUniforms: PhysicalSkyUniforms,
  heightGrid?: Float32Array,
): LakeWaterHandles {
  const wl = terrain.config.river?.waterLevelM ?? terrain.config.lake.waterLevelM;
  const n = terrain.config.gridResolution;
  const half = terrain.halfSizeM;
  const step = terrain.cellSizeM;
  const grid = heightGrid ?? terrain.bakeHeightGrid();

  // Map grid vertex indices -> compact emitted water vertex indices (only wet cells + 1-cell shore collar)
  const vertMap = new Int32Array(n * n).fill(-1);
  const positions: number[] = [];
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
      // Emit cell if any corner is wet (or within 0.08 m of waterline for smooth thin-film fade)
      if (Math.max(d00, d10, d01, d11) > -0.06) {
        const v00 = getVert(ix, iz);
        const v10 = getVert(ix + 1, iz);
        const v01 = getVert(ix, iz + 1);
        const v11 = getVert(ix + 1, iz + 1);
        // Match PlaneGeometry rotated -PI/2 winding (+Y up)
        indices.push(v00, v01, v10, v10, v01, v11);
      }
    }
  }

  // Fallback degenerate triangle if a map ever had zero water (keeps pipeline warm with 0 visible pixels)
  if (indices.length === 0) {
    positions.push(0, wl - 10, 0, 0.01, wl - 10, 0, 0, wl - 10, 0.01);
    depths.push(-10, -10, -10);
    indices.push(0, 1, 2);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('aDepth', new Float32BufferAttribute(depths, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();

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
  const t = skyUniforms.uWaterTimeS;

  // Subtle river flow drift along river axis (zero drift on enclosed lakes)
  const flowX = terrain.config.river?.axis === 'ew' ? t.mul(0.55) : float(0.0);
  const flowZ = terrain.config.river?.axis === 'ns' ? t.mul(0.55) : float(0.0);

  // Domain-warped 5-octave non-orthogonal wind ripples (zero checkerboard grid at low angles!)
  const waveAmp = smoothstep(float(0.0), float(0.42), safeDepth);
  const wx0 = wp.x.sub(flowX);
  const wz0 = wp.z.sub(flowZ);
  const warpX = sin(wz0.mul(0.55).add(t.mul(0.42))).mul(0.9);
  const warpZ = cos(wx0.mul(0.48).sub(t.mul(0.37))).mul(0.9);
  const wx = wx0.add(warpX);
  const wz = wz0.add(warpZ);
  const w1 = sin(wx.mul(1.7).add(wz.mul(0.62)).add(t.mul(1.25)));
  const w2 = cos(wx.mul(0.95).sub(wz.mul(2.45)).sub(t.mul(1.55)));
  const w3 = sin(wx.mul(3.8).add(wz.mul(2.1)).add(t.mul(1.9)));
  const w4 = cos(wx.mul(5.3).sub(wz.mul(4.1)).sub(t.mul(2.35)));
  const w5 = sin(wx.mul(8.1).add(wz.mul(6.7)).add(t.mul(2.8)));
  const nx = w1.mul(0.008).add(w2.mul(0.007)).add(w3.mul(0.006)).add(w4.mul(0.0045)).add(w5.mul(0.003)).mul(waveAmp);
  const nz = w2.mul(0.008).sub(w1.mul(0.006)).add(w3.mul(0.0055)).sub(w4.mul(0.0045)).add(w5.mul(0.003)).mul(waveAmp);
  const N = normalize(vec3(nx, float(1.0), nz));

  const V = normalize(cameraPosition.sub(wp));
  const NdotV = clamp(dot(N, V), 0.02, 1.0);
  // Physical air->water Schlick Fresnel (F0 = 0.02)
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(NdotV), float(4.6))));

  // Unified analytic sky + clouds + golden-hour scatter reflection
  const R = normalize(reflect(V.negate(), N));
  const reflDir = normalize(vec3(R.x, max(R.y, float(0.02)), R.z));
  const skyRefl = buildFullSkyNodeForWater(reflDir, skyUniforms);

  // Sun specular glints on wind ripples
  const H = normalize(V.add(skyUniforms.uSunDir));
  const specTight = pow(clamp(dot(N, H), 0.0, 1.0), float(180.0)).mul(skyUniforms.uSunDiskGain).mul(0.55);
  const specBroad = pow(clamp(dot(N, H), 0.0, 1.0), float(30.0)).mul(skyUniforms.uMieStrength).mul(0.28);
  const reflection = skyRefl.add(skyUniforms.uSunGlowColor.mul(specTight.add(specBroad)));

  // Beer-Lambert depth absorption over sandy-silt bed (shallow warm gravel fords -> fresh deep blue-teal water)
  const bounceRgb = skyUniforms.uGroundBounceColor.rgb;
  const shallowBed = bounceRgb.mul(vec3(0.66, 0.62, 0.44));
  const deepScatter = bounceRgb.mul(vec3(0.07, 0.25, 0.34));
  const absorbR = exp(safeDepth.mul(-2.2));
  const absorbG = exp(safeDepth.mul(-1.15));
  const absorbB = exp(safeDepth.mul(-1.35));
  const bedTransmitted = shallowBed.mul(vec3(absorbR, absorbG, absorbB));
  const waterBody = mix(deepScatter, bedTransmitted.add(deepScatter.mul(0.35)), exp(safeDepth.mul(-1.1)));

  // Thin-film smooth shoreline fade into the wet-silt terrain margin (zero hard edge)
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
