import { InstancedMesh, type Material, type Object3D } from 'three/webgpu';

// Shader warm-up behind the loading screen (rules §9: no hitch the first time
// something is seen). renderer.compileAsync() cannot do this on its own: it
// skips hidden objects and anything outside the camera's view, and it
// compiles for the plain framebuffer, not for the post-processing scene pass
// (half-float colour plus a velocity target) the game actually draws into.
// So every pipeline the player could meet later — a weapon still holstered,
// the first muzzle flash, the first enemy, rain, a scenery object behind the
// spawn point, a distant level of detail — used to compile mid-game, which on
// a phone is a visible stutter. Here the real pipeline renders one frame in
// which one object per distinct shader build (see pipelineKey) is forced
// visible, un-culled and with at least one instance; then everything is put
// back. One per build, not every hidden object, keeps that frame cheap.

/**
 * Mirrors what three r186 builds a shader per (RenderObject.getMaterialCacheKey
 * plus the pass): the material, the vertex layout, the shadow flags, and —
 * for instanced meshes — the mesh itself, since each InstancedMesh gets its
 * own build.
 */
function pipelineKey(o: Object3D & { material?: Material | Material[]; geometry?: { attributes: Record<string, { itemSize?: number; normalized?: boolean }> } }): string | null {
  if (!o.material || !o.geometry) return null;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const attrs = Object.entries(o.geometry.attributes)
    .map(([name, a]) => `${name}${a.itemSize ?? ''}${a.normalized ? 'n' : ''}`)
    .sort()
    .join(',');
  const own = o instanceof InstancedMesh || ((o as { count?: number }).count ?? 1) > 1 ? o.uuid : '';
  return `${o.type}|${mats.map((m) => m.uuid).join('+')}|${attrs}|${o.receiveShadow}|${o.castShadow}|${own}`;
}

/**
 * Forces one object per shader build visible, un-culled and with at least one
 * instance; returns the function that puts everything back.
 */
export function revealOnePerPipeline(scene: Object3D): () => void {
  const restore: (() => void)[] = [];
  const seen = new Set<string>();
  const reveal = (o: Object3D): void => {
    for (let a: Object3D | null = o; a; a = a.parent) {
      if (a.visible) continue;
      const hidden = a;
      hidden.visible = true;
      restore.push(() => {
        hidden.visible = false;
      });
    }
    if (o.frustumCulled) {
      o.frustumCulled = false;
      restore.push(() => {
        o.frustumCulled = true;
      });
    }
    if (o instanceof InstancedMesh && o.count === 0) {
      o.count = 1;
      restore.push(() => {
        o.count = 0;
      });
    }
  };
  scene.traverse((o) => {
    // Objects hidden for good (a body the loaded models replaced) are never drawn: nothing to warm.
    if (o.userData['noWarmup'] === true) return;
    const key = pipelineKey(o);
    if (key === null || seen.has(key)) return;
    seen.add(key);
    reveal(o);
  });
  // Undo in reverse, so an ancestor revealed for two objects ends hidden again.
  return () => {
    for (let i = restore.length - 1; i >= 0; i--) (restore[i] as () => void)();
  };
}

export function warmAllPipelines(scene: Object3D, render: () => void): void {
  const restore = revealOnePerPipeline(scene);
  try {
    render();
  } finally {
    restore();
  }
}
