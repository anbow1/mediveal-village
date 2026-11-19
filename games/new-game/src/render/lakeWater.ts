// Physical enclosed village lake water surface (playbook §7.1 & §7.2b, GUIDE.md §4).
// Driven by the exact same `sky.ts` analytic physical sky function + real seabed depth (`TerrainField`),
// Beer-Lambert shallow-to-deep absorption, Schlick Fresnel, fetch-damped wind ripples, and thin-film shore fade.

import {
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
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
 * Builds the enclosed village lake mesh sitting at `terrain.config.lake.waterLevelM` (0.0 m)
 * with exact per-vertex seabed depth from `terrain.heightAt(x, z)` so shorelines never clip or float.
 */
export function buildLakeWater(terrain: TerrainField, skyUniforms: PhysicalSkyUniforms): LakeWaterHandles {
  const lk = terrain.config.lake;
  const spanX = lk.radiusXM * 2.55;
  const spanZ = lk.radiusZM * 2.55;
  const geo = new PlaneGeometry(spanX, spanZ, 56, 44);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.getAttribute('position');
  const depths = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i) + lk.centerX;
    const wz = pos.getZ(i) + lk.centerZ;
    pos.setXYZ(i, wx, lk.waterLevelM, wz);
    // Signed depth: > 0 in water, < 0 on dry bank (drives smooth shoreline fade)
    depths[i] = lk.waterLevelM - terrain.heightAt(wx, wz);
  }
  pos.needsUpdate = true;
  geo.setAttribute('aDepth', new Float32BufferAttribute(depths, 1));
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

  // Organic fetch- and depth-damped wind ripples (domain-warped non-orthogonal waves -> zero checkerboard grid!)
  const waveAmp = smoothstep(float(0.0), float(0.45), safeDepth);
  const warpX = sin(wp.z.mul(0.55).add(t.mul(0.42))).mul(0.9);
  const warpZ = cos(wp.x.mul(0.48).sub(t.mul(0.37))).mul(0.9);
  const wx = wp.x.add(warpX);
  const wz = wp.z.add(warpZ);
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

  // Exact same analytic sky + clouds + golden-hour scatter as the sky dome & height fog
  const R = normalize(reflect(V.negate(), N));
  const reflDir = normalize(vec3(R.x, max(R.y, float(0.02)), R.z));
  const skyRefl = buildFullSkyNodeForWater(reflDir, skyUniforms);

  // Sun specular glints on wind ripples
  const H = normalize(V.add(skyUniforms.uSunDir));
  const specTight = pow(clamp(dot(N, H), 0.0, 1.0), float(180.0)).mul(skyUniforms.uSunDiskGain).mul(0.55);
  const specBroad = pow(clamp(dot(N, H), 0.0, 1.0), float(30.0)).mul(skyUniforms.uMieStrength).mul(0.28);
  const reflection = skyRefl.add(skyUniforms.uSunGlowColor.mul(specTight.add(specBroad)));

  // Beer-Lambert depth absorption over sandy-silt lakebed (shallows warm tan-olive -> deep pond teal-olive)
  const bounceRgb = skyUniforms.uGroundBounceColor.rgb;
  const shallowBed = bounceRgb.mul(vec3(0.68, 0.62, 0.44));
  const deepScatter = bounceRgb.mul(vec3(0.11, 0.22, 0.19));
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
  mesh.name = 'VillageEnclosedLake';
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
