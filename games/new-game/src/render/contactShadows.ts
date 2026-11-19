// Reusable single-draw-call ambient ground contact shadows (Stage 3 grounding + Stage 4–6 ready).
// Softly anchors stone wall footings, oak root flares, wine barrels, and soldier boots to the earth
// in both harsh sun and diffuse overcast without triggering r186 reversed-depth GTAO darkening.

import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
} from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  float,
  length,
  max,
  select,
  smoothstep,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import type { FloatUniform } from './sky.ts';

interface ContactQuadSpec {
  readonly x: number;
  readonly z: number;
  readonly halfW: number;
  readonly halfD: number;
  readonly yawRad: number;
  readonly strength: number;
  /** 0 = soft radial disc (trunks, barrels, boots), 1 = soft rounded rectangle (building plinths). */
  readonly shape: number;
  /** Normalized inner box half-extent in [0..1] for rounded-rect contact shadows (e.g. 0.72). */
  readonly inner: number;
}

export class ContactShadowBatch {
  private readonly specs: ContactQuadSpec[] = [];

  /** Adds a soft rectangular foundation contact shadow hugging a building or plinth footprint. */
  addRect(
    x: number,
    z: number,
    widthM: number,
    depthM: number,
    yawRad: number,
    strength = 1.0,
    featherM = 0.85,
  ): void {
    const halfW = widthM * 0.5 + featherM;
    const halfD = depthM * 0.5 + featherM;
    const inner = Math.max(0.25, Math.min(0.88, 1 - featherM / Math.max(halfW, halfD)));
    this.specs.push({ x, z, halfW, halfD, yawRad, strength, shape: 1, inner });
  }

  /** Adds a soft radial disc contact shadow under a tree trunk/canopy, barrel, or soldier. */
  addDisc(x: number, z: number, radiusM: number, strength = 0.9, innerCore = 0.25): void {
    this.specs.push({
      x,
      z,
      halfW: radiusM,
      halfD: radiusM,
      yawRad: 0,
      strength,
      shape: 0,
      inner: Math.max(0.05, Math.min(0.75, innerCore)),
    });
  }

  /** Compiles all registered contact shadows into a single merged Mesh (1 draw call). */
  build(uGlobalGain: FloatUniform, yOffsetM = 0.012): Mesh {
    const positions: number[] = [];
    const uvs: number[] = [];
    const params: number[] = [];
    const indices: number[] = [];

    let vBase = 0;
    for (const q of this.specs) {
      const c = Math.cos(q.yawRad);
      const s = Math.sin(q.yawRad);
      const corners: readonly [number, number, number, number][] = [
        [-q.halfW, -q.halfD, 0, 0],
        [q.halfW, -q.halfD, 1, 0],
        [q.halfW, q.halfD, 1, 1],
        [-q.halfW, q.halfD, 0, 1],
      ];
      for (const [lx, lz, u, v] of corners) {
        const wx = q.x + lx * c + lz * s;
        const wz = q.z - lx * s + lz * c;
        positions.push(wx, yOffsetM, wz);
        uvs.push(u, v);
        params.push(q.strength, q.shape, q.inner);
      }
      // CCW winding facing +Y so front-face culling shows from above.
      indices.push(vBase, vBase + 3, vBase + 2, vBase, vBase + 2, vBase + 1);
      vBase += 4;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aContact', new Float32BufferAttribute(params, 3));
    geo.setIndex(indices);

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      // Positive polygonOffset pushes toward camera under reversedDepthBuffer: true (playbook §11).
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    });
    mat.name = 'MarchlandContactShadowMat';

    const localP = uv(0).mul(2.0).sub(vec2(1.0));
    const aContact = attribute('aContact', 'vec3');
    const strength = aContact.x;
    const isRect = aContact.y.greaterThan(0.5);
    const inner = aContact.z;

    // Disc distance in [0..1]
    const discD = length(localP);
    const discFalloff = float(1.0).sub(smoothstep(inner, float(1.0), discD));

    // Rounded rectangle SDF in [-1..1]^2
    const rectExcess = max(abs(localP).sub(vec2(inner)), vec2(0.0));
    const rectD = length(rectExcess).div(max(float(1.0).sub(inner), float(0.05)));
    const rectFalloff = float(1.0).sub(smoothstep(float(0.0), float(1.0), rectD));

    const shapeFalloff = select(isRect, rectFalloff, discFalloff);
    // Warm earth occlusion colour (never cool blue/black; preserves >10 sRGB floor in shadow).
    mat.colorNode = vec3(0.025, 0.02, 0.015);
    mat.opacityNode = clamp(shapeFalloff.mul(shapeFalloff).mul(strength).mul(uGlobalGain), 0.0, 0.68);

    const mesh = new Mesh(geo, mat);
    mesh.name = 'GroundContactShadows';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    return mesh;
  }
}
