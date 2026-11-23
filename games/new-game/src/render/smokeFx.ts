// Lightweight single-draw-call rising chimney smoke puffs spawned at static map `smoke_0` empties
// AND dynamically built completed cottages/bakeries/smithies/taverns/keeps!
// Advances deterministically on the 60 Hz simulation clock with zero per-frame allocations.

import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  Object3D,
  PlaneGeometry,
  Vector3,
} from 'three/webgpu';
import {
  clamp,
  float,
  length,
  mix,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import type { PhysicalSkyUniforms } from './sky.ts';

export interface ChimneySmokeHandles {
  readonly mesh: InstancedMesh;
  readonly setDynamicEmitters: (positions: readonly Vector3[]) => void;
  readonly update: (simTimeS: number, cameraPos: Vector3) => void;
  readonly dispose: () => void;
}

const ZERO_MAT = new Matrix4().makeScale(0, 0, 0);
const MAX_CHIMNEY_EMITTERS = 48;

/**
 * Builds one pre-allocated instanced translucent woodsmoke batch (1 draw call) supporting both
 * static starting chimneys and dynamically built village cottages, bakeries, taverns, and smithies.
 */
export function buildChimneySmoke(
  staticEmitters: readonly Vector3[],
  skyUniforms: PhysicalSkyUniforms,
  puffsPerEmitter = 6,
): ChimneySmokeHandles {
  const capEmitters = Math.max(MAX_CHIMNEY_EMITTERS, staticEmitters.length);
  const maxInstances = Math.max(1, capEmitters * puffsPerEmitter);
  const geo = new PlaneGeometry(1, 1);

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.name = 'MarchlandChimneySmokeMat';

  // Soft radial wisp cloud alpha (no textures needed; warm woodsmoke tinted by ambient sky/ground bounce)
  const p = uv(0).mul(2.0).sub(vec2(1.0));
  const r = length(p);
  const softDisc = float(1.0).sub(smoothstep(float(0.08), float(0.96), r));
  const uSmokeOpacity = uniform(0.28);

  // Pale warm woodsmoke tracks preset EV100 automatically via sky horizon luminance
  const smokeLum = mix(skyUniforms.uHorizonColor.rgb, vec3(0.55, 0.52, 0.48), float(0.45));
  mat.colorNode = clamp(smokeLum.mul(0.85), vec3(0.08), vec3(0.9));
  mat.opacityNode = softDisc.mul(softDisc).mul(uSmokeOpacity);

  const mesh = new InstancedMesh(geo, mat, maxInstances);
  mesh.name = 'ChimneySmokePuffs';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);

  const baseEmitters: Vector3[] = staticEmitters.map((v) => v.clone());
  let activeEmitters: Vector3[] = baseEmitters.slice(0, capEmitters);

  const setDynamicEmitters = (positions: readonly Vector3[]): void => {
    const merged: Vector3[] = [];
    for (const v of baseEmitters) {
      if (merged.length >= capEmitters) break;
      merged.push(v);
    }
    for (const v of positions) {
      if (merged.length >= capEmitters) break;
      // Avoid doubling smoke on top of a static starting chimney
      let dup = false;
      for (let i = 0; i < baseEmitters.length; i++) {
        const b = baseEmitters[i]!;
        if (Math.abs(b.x - v.x) < 2.4 && Math.abs(b.z - v.z) < 2.4) {
          dup = true;
          break;
        }
      }
      if (!dup) merged.push(v.clone());
    }
    activeEmitters = merged;
  };

  const dummy = new Object3D();
  const cycleS = 6.4;

  const update = (simTimeS: number, cameraPos: Vector3): void => {
    const emitCount = activeEmitters.length;
    if (emitCount === 0) {
      mesh.setMatrixAt(0, ZERO_MAT);
      mesh.count = 1;
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    let idx = 0;
    for (let e = 0; e < emitCount; e++) {
      const origin = activeEmitters[e]!;
      for (let k = 0; k < puffsPerEmitter; k++) {
        const phase = k / puffsPerEmitter;
        const driftSeed = (e * 13.7 + k * 2.91) % 6.283;
        const age = ((simTimeS / cycleS) + phase) % 1.0;
        // Smooth fade-in/out scale envelope (shrinks cleanly to 0 at start & end so zero pop!)
        const env = Math.sin(age * Math.PI);
        const scale = (0.38 + age * 1.45) * Math.pow(env, 0.45);
        const rise = age * 4.8;
        const windX = age * 2.4 + Math.sin(age * 4.5 + driftSeed) * 0.26 * age;
        const windZ = age * 1.1 + Math.cos(age * 3.8 + driftSeed) * 0.22 * age;

        dummy.position.set(origin.x + windX, origin.y + rise, origin.z + windZ);
        dummy.lookAt(cameraPos);
        dummy.rotation.z += driftSeed + age * 1.1;
        dummy.scale.setScalar(Math.max(0.001, scale));
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, idx * 16);
    mesh.instanceMatrix.needsUpdate = true;
  };

  // Seed initial matrices at t = 0 so warm-up frame renders real smoke immediately (playbook §11)
  update(0, new Vector3(0, 10, 20));

  return {
    mesh,
    setDynamicEmitters,
    update,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
