// Lightweight single-draw-call rising chimney smoke puffs spawned at every `smoke_0` empty
// (cottages, bakery, keep). Advances deterministically on the 60 Hz simulation clock.

import {
  InstancedMesh,
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

interface PuffState {
  readonly emitterIndex: number;
  readonly phase: number;
  readonly driftSeed: number;
}

export interface ChimneySmokeHandles {
  readonly mesh: InstancedMesh;
  readonly update: (simTimeS: number, cameraPos: Vector3) => void;
  readonly dispose: () => void;
}

/**
 * Builds one instanced translucent smoke-puff batch for all `smoke_0` chimney emitters (1 draw call).
 * Each emitter spawns `puffsPerEmitter` billboarding soft woodsmoke wisps that rise, expand, drift
 * downwind, and fade naturally without any per-frame GPU buffer allocations.
 */
export function buildChimneySmoke(
  emitters: readonly Vector3[],
  skyUniforms: PhysicalSkyUniforms,
  puffsPerEmitter = 8,
): ChimneySmokeHandles {
  const count = Math.max(1, emitters.length * puffsPerEmitter);
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

  const mesh = new InstancedMesh(geo, mat, count);
  mesh.name = 'ChimneySmokePuffs';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;

  const puffs: PuffState[] = [];
  for (let e = 0; e < emitters.length; e++) {
    for (let k = 0; k < puffsPerEmitter; k++) {
      puffs.push({
        emitterIndex: e,
        phase: k / puffsPerEmitter,
        driftSeed: (e * 13.7 + k * 2.91) % 6.283,
      });
    }
  }

  const dummy = new Object3D();
  const cycleS = 6.4;

  const update = (simTimeS: number, cameraPos: Vector3): void => {
    if (emitters.length === 0) {
      mesh.count = 0;
      return;
    }
    mesh.count = puffs.length;
    for (let i = 0; i < puffs.length; i++) {
      const pf = puffs[i]!;
      const origin = emitters[pf.emitterIndex]!;
      const age = ((simTimeS / cycleS) + pf.phase) % 1.0;
      // Smooth fade-in/out scale envelope (shrinks cleanly to 0 at start & end so zero pop!)
      const env = Math.sin(age * Math.PI);
      const scale = (0.38 + age * 1.45) * Math.pow(env, 0.45);
      const rise = age * 4.8;
      const windX = age * 2.4 + Math.sin(age * 4.5 + pf.driftSeed) * 0.26 * age;
      const windZ = age * 1.1 + Math.cos(age * 3.8 + pf.driftSeed) * 0.22 * age;

      dummy.position.set(origin.x + windX, origin.y + rise, origin.z + windZ);
      dummy.lookAt(cameraPos);
      dummy.rotation.z += pf.driftSeed + age * 1.1;
      dummy.scale.setScalar(Math.max(0.001, scale));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  // Seed initial matrices at t = 0 so warm-up frame renders real smoke immediately (playbook §11)
  update(0, new Vector3(0, 10, 20));

  return {
    mesh,
    update,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
