import { type BufferGeometry, Color, InstancedMesh, type Material, Matrix4, Sphere, Vector3 } from 'three/webgpu';
import { markStaticInstances } from './instancing.ts';

// Distance-limited instancing with ONE InstancedMesh per plant kind. three
// r186 keys every InstancedMesh's shader build by the mesh's own uuid, so a
// forest split into hundreds of per-chunk meshes built a shader each time a
// new chunk first came into view — a hitch every few steps on a phone — and
// each chunk cost a draw call per shadow cascade. Here all placements are
// binned on a grid once, and the single mesh is refilled from the cells within
// (or, for a far level of detail, beyond) a radius whenever the camera crosses
// into another cell. Its capacity is the largest refill any cell can need, so
// the buffer never grows and the shader never changes.

export interface StreamPlacement {
  matrix: Matrix4;
  colour?: Color;
}

export interface StreamOptions {
  cellM: number;
  /** Draw instances within this distance (m) of the camera; Infinity for all. */
  radiusM: number;
  /** Draw the instances beyond the radius instead (a far level of detail). */
  outside?: boolean;
  /** With `outside`: and only those within this distance (m) — a ring, the impostors take over beyond. */
  maxM?: number;
  castShadow: boolean;
  receiveShadow?: boolean;
}

export class InstanceStream {
  readonly mesh: InstancedMesh;
  private readonly matrices: Float32Array;
  private readonly colours: Float32Array | null;
  private readonly cells = new Map<number, number[]>();
  private readonly cellCentres: { key: number; x: number; z: number }[] = [];
  private currentCell = Number.NaN;
  private readonly bounds: Sphere;

  constructor(geometry: BufferGeometry, material: Material, placements: readonly StreamPlacement[], private readonly opts: StreamOptions) {
    const n = placements.length;
    this.matrices = new Float32Array(n * 16);
    const anyColour = placements.some((p) => p.colour);
    this.colours = anyColour ? new Float32Array(n * 3).fill(1) : null;
    const pos = new Vector3();
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    placements.forEach((p, i) => {
      p.matrix.toArray(this.matrices, i * 16);
      if (p.colour && this.colours) p.colour.toArray(this.colours, i * 3);
      pos.setFromMatrixPosition(p.matrix);
      minX = Math.min(minX, pos.x);
      minZ = Math.min(minZ, pos.z);
      maxX = Math.max(maxX, pos.x);
      maxZ = Math.max(maxZ, pos.z);
      const key = this.keyOf(pos.x, pos.z);
      let list = this.cells.get(key);
      if (!list) {
        list = [];
        this.cells.set(key, list);
        this.cellCentres.push({ key, x: (Math.floor(pos.x / opts.cellM) + 0.5) * opts.cellM, z: (Math.floor(pos.z / opts.cellM) + 0.5) * opts.cellM });
      }
      list.push(i);
    });
    const capacity = Math.max(1, this.largestRefill());
    this.mesh = markStaticInstances(new InstancedMesh(geometry, material, capacity));
    this.mesh.castShadow = opts.castShadow;
    this.mesh.receiveShadow = opts.receiveShadow ?? true;
    if (this.colours) this.mesh.setColorAt(0, new Color(1, 1, 1));
    // One sphere for everything the mesh may hold: exact per refill would need a pass over the instances.
    const cx = n > 0 ? (minX + maxX) / 2 : 0;
    const cz = n > 0 ? (minZ + maxZ) / 2 : 0;
    this.bounds = new Sphere(new Vector3(cx, 0, cz), n > 0 ? Math.hypot(maxX - minX, maxZ - minZ) / 2 + 60 : 1);
    this.mesh.boundingSphere = this.bounds.clone();
    this.mesh.count = 0;
    if (!Number.isFinite(opts.radiusM)) this.fill(null);
  }

  private keyOf(x: number, z: number): number {
    return Math.floor(x / this.opts.cellM) * 65536 + Math.floor(z / this.opts.cellM);
  }

  /**
   * From the centre of the camera's cell: the camera may be anywhere in its
   * cell until the next refill, and a plant anywhere in its own, hence one
   * cell diagonal of margin.
   */
  private selected(camX: number, camZ: number, c: { x: number; z: number }): boolean {
    const d = Math.hypot(c.x - camX, c.z - camZ);
    const slack = this.opts.cellM * 1.42;
    const near = d - slack < this.opts.radiusM;
    if (!this.opts.outside) return near;
    return !near && (this.opts.maxM === undefined || d - slack < this.opts.maxM);
  }

  /** The most instances any camera cell can select: the fixed capacity. */
  private largestRefill(): number {
    if (!Number.isFinite(this.opts.radiusM) || (this.opts.outside && this.opts.maxM === undefined)) return this.matrices.length / 16;
    const cell = this.opts.cellM;
    const xs = this.cellCentres.map((c) => c.x);
    const zs = this.cellCentres.map((c) => c.z);
    const reach = Math.ceil((this.opts.maxM ?? this.opts.radiusM) / cell) + 2;
    let best = 0;
    // Every cell the camera could stand in, empty ones included.
    for (let x = Math.min(...xs) - reach * cell; x <= Math.max(...xs) + reach * cell; x += cell) {
      for (let z = Math.min(...zs) - reach * cell; z <= Math.max(...zs) + reach * cell; z += cell) {
        let n = 0;
        for (const c of this.cellCentres) if (this.selected(x, z, c)) n += (this.cells.get(c.key) as number[]).length;
        best = Math.max(best, n);
      }
    }
    return best;
  }

  private fill(camera: Vector3 | null): void {
    const dst = this.mesh.instanceMatrix.array as Float32Array;
    const dstColour = this.mesh.instanceColor ? (this.mesh.instanceColor.array as Float32Array) : null;
    const capacity = this.mesh.instanceMatrix.count;
    let n = 0;
    for (const c of this.cellCentres) {
      if (camera && !this.selected(camera.x, camera.z, c)) continue;
      for (const i of this.cells.get(c.key) as number[]) {
        if (n >= capacity) break;
        dst.set(this.matrices.subarray(i * 16, i * 16 + 16), n * 16);
        if (dstColour && this.colours) dstColour.set(this.colours.subarray(i * 3, i * 3 + 3), n * 3);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, Math.max(1, n) * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Refills when the camera has moved into another cell. */
  update(camera: Vector3): void {
    if (!Number.isFinite(this.opts.radiusM)) return;
    const key = this.keyOf(camera.x, camera.z);
    if (key === this.currentCell) return;
    this.currentCell = key;
    const c = this.opts.cellM;
    this.fill(new Vector3((Math.floor(camera.x / c) + 0.5) * c, 0, (Math.floor(camera.z / c) + 0.5) * c));
  }
}
