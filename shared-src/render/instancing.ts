import { InstancedBufferAttribute, InstancedMesh, type Object3D, type WebGPURenderer } from 'three/webgpu';

// Static instanced meshes sharing their shaders. three r186 hands an instanced mesh's matrices to the shader
// in a uniform buffer while they fit one (64 KiB: 1024 matrices), and declares that buffer in the shader
// under the mesh's own name and length, so every such mesh built shaders of its own: in the scene pass, in
// each shadow pass, in the scope, though most share a material with others (Castaway Lagoon: 333 of the
// 559 shader builds at load, 29 once the buffers' names were set aside; Field Line: 87 of 208, 27).
// Past the limit the matrices come as a vertex attribute instead, declared alike for every mesh, and meshes
// with one material and one vertex layout share one build. A mesh marked `userData.staticInstances` gets
// room for one matrix more than the limit holds: nothing more is drawn (its count stays), and since it is
// filled once (or refilled now and then, with an update range) the larger buffer costs memory, about
// 130 KiB with the previous frame's copy the velocity reads, not uploads. Meshes refilled every frame
// (animals, men, particles) are not marked: they would upload the whole larger buffer each time.

/** WebGPU's guaranteed vertex buffers: the attribute path takes two (this frame's matrices and the last). */
const MAX_VERTEX_BUFFERS = 8;
/** Past this many matrices the memory is not worth it (a device with a larger uniform buffer limit). */
const MAX_CAPACITY = 4096;

/** Marks an instanced mesh as filled once (or rarely), for shareStaticInstanceShaders. */
export function markStaticInstances(mesh: InstancedMesh): InstancedMesh {
  mesh.userData['staticInstances'] = true;
  return mesh;
}

/**
 * Gives every marked mesh under `root` room past the uniform buffer limit, so its shaders are shared. Call
 * once the world is built and before its first frame. Returns how many meshes it changed.
 */
export function shareStaticInstanceShaders(renderer: WebGPURenderer, root: Object3D): number {
  const caps = (renderer.backend as unknown as { capabilities?: { getUniformBufferLimit?: () => number } }).capabilities;
  const limitBytes = caps?.getUniformBufferLimit?.() ?? 65536;
  const capacity = Math.floor(limitBytes / 64) + 1;
  if (capacity > MAX_CAPACITY) return 0;
  let changed = 0;
  root.traverse((o) => {
    if (!(o instanceof InstancedMesh) || o.userData['staticInstances'] !== true) return;
    const old = o.instanceMatrix;
    if (old.count >= capacity) return;
    const buffers = Object.keys(o.geometry.attributes).length + (o.instanceColor ? 1 : 0) + 2;
    if (buffers > MAX_VERTEX_BUFFERS) return;
    const array = new Float32Array(capacity * 16);
    array.set(old.array as Float32Array);
    const attr = new InstancedBufferAttribute(array, 16);
    attr.setUsage(old.usage);
    o.instanceMatrix = attr;
    changed++;
  });
  return changed;
}
