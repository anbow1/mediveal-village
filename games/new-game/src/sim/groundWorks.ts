// Pure-TS dynamic ground works & land-cover map (zero three.js, unit-tested).
// Encodes RGBA8 cover over the village slice & battlefield:
//   R = trampled village dirt / yard / road shoulder (0..255)
//   G = cobbled stone road surface (0..255)
//   B = ploughed dark agricultural furrows & crop bed (0..255)
//   A = forest canopy shade & needle/leaf litter (0..255)
// Shared by terrain surface shader (`terrainMesh.ts`) AND R2 Bézier grass density (`grassField.ts`).

export interface GroundWorksSample {
  readonly dirt: number;
  readonly cobble: number;
  readonly farm: number;
  readonly canopy: number;
}

export class GroundWorksMap {
  readonly resolution: number;
  readonly spanM: number;
  readonly halfSpanM: number;
  readonly data: Uint8Array;

  constructor(resolution = 256, spanM = 160) {
    this.resolution = resolution;
    this.spanM = spanM;
    this.halfSpanM = spanM * 0.5;
    this.data = new Uint8Array(resolution * resolution * 4);
  }

  private worldToIndex(v: number): number {
    return ((v + this.halfSpanM) / this.spanM) * (this.resolution - 1);
  }

  private setMaxChannel(ix: number, iz: number, channel: 0 | 1 | 2 | 3, value01: number): void {
    if (ix < 0 || ix >= this.resolution || iz < 0 || iz >= this.resolution) return;
    const idx = (iz * this.resolution + ix) * 4 + channel;
    const byte = Math.max(0, Math.min(255, Math.round(value01 * 255)));
    if (byte > this.data[idx]!) {
      this.data[idx] = byte;
    }
  }

  private addChannel(ix: number, iz: number, channel: 0 | 1 | 2 | 3, value01: number): void {
    if (ix < 0 || ix >= this.resolution || iz < 0 || iz >= this.resolution) return;
    const idx = (iz * this.resolution + ix) * 4 + channel;
    const next = Math.min(255, this.data[idx]! + Math.round(value01 * 255));
    this.data[idx] = next;
  }

  /** Stamps a soft elliptical trampled-earth yard under a building or muster square. */
  stampYard(cx: number, cz: number, radiusXM: number, radiusZM: number, strength = 0.92): void {
    const rMax = Math.max(radiusXM, radiusZM);
    const minX = Math.max(0, Math.floor(this.worldToIndex(cx - rMax)));
    const maxX = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(cx + rMax)));
    const minZ = Math.max(0, Math.floor(this.worldToIndex(cz - rMax)));
    const maxZ = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(cz + rMax)));
    const step = this.spanM / (this.resolution - 1);

    for (let iz = minZ; iz <= maxZ; iz++) {
      const wz = -this.halfSpanM + iz * step;
      for (let ix = minX; ix <= maxX; ix++) {
        const wx = -this.halfSpanM + ix * step;
        const d = Math.hypot((wx - cx) / radiusXM, (wz - cz) / radiusZM);
        if (d >= 1) continue;
        // Wide soft falloff avoids painted-stain rim (playbook §5.6 #8)
        const t = Math.max(0, Math.min(1, (1 - d) / 0.55));
        const w = t * t * (3 - 2 * t) * strength;
        this.setMaxChannel(ix, iz, 0, w);
      }
    }
  }

  /** Stamps a cobbled medieval stone road along a polyline with soft dirt shoulders. */
  stampRoadPolyline(points: readonly (readonly [number, number])[], halfWidthM = 1.65, shoulderM = 1.45): void {
    const step = this.spanM / (this.resolution - 1);
    const totalR = halfWidthM + shoulderM;

    for (let s = 0; s < points.length - 1; s++) {
      const [x0, z0] = points[s]!;
      const [x1, z1] = points[s + 1]!;
      const minX = Math.max(0, Math.floor(this.worldToIndex(Math.min(x0, x1) - totalR)));
      const maxX = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(Math.max(x0, x1) + totalR)));
      const minZ = Math.max(0, Math.floor(this.worldToIndex(Math.min(z0, z1) - totalR)));
      const maxZ = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(Math.max(z0, z1) + totalR)));

      const dx = x1 - x0;
      const dz = z1 - z0;
      const lenSq = Math.max(1e-6, dx * dx + dz * dz);

      for (let iz = minZ; iz <= maxZ; iz++) {
        const wz = -this.halfSpanM + iz * step;
        for (let ix = minX; ix <= maxX; ix++) {
          const wx = -this.halfSpanM + ix * step;
          const proj = Math.max(0, Math.min(1, ((wx - x0) * dx + (wz - z0) * dz) / lenSq));
          const px = x0 + proj * dx;
          const pz = z0 + proj * dz;
          const dist = Math.hypot(wx - px, wz - pz);
          if (dist >= totalR) continue;
          // Crisp cobbled stone carriage-way with subtle worn cart-rut dirt crown down the center
          if (dist < halfWidthM + 0.48) {
            const ct = Math.max(0, Math.min(1, (halfWidthM + 0.48 - dist) / 0.58));
            const cobbleEdge = ct * ct * (3 - 2 * ct);
            this.setMaxChannel(ix, iz, 1, cobbleEdge);
            if (dist < halfWidthM * 0.34) {
              const rutT = 1 - dist / Math.max(0.1, halfWidthM * 0.34);
              this.setMaxChannel(ix, iz, 0, rutT * 0.38);
            }
          }
          // Soft trampled dirt shoulder outside the stone curb
          const st = Math.max(0, Math.min(1, (totalR - dist) / (shoulderM + 0.5)));
          this.setMaxChannel(ix, iz, 0, st * st * (3 - 2 * st) * 0.88);
        }
      }
    }
  }

  /** Stamps a rotated rectangular ploughed farm strip (B channel) with subtle surrounding dirt verge. */
  stampFarmStrip(cx: number, cz: number, lengthM: number, widthM: number, yawRad: number): void {
    const bound = Math.hypot(lengthM * 0.5, widthM * 0.5) + 1.2;
    const minX = Math.max(0, Math.floor(this.worldToIndex(cx - bound)));
    const maxX = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(cx + bound)));
    const minZ = Math.max(0, Math.floor(this.worldToIndex(cz - bound)));
    const maxZ = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(cz + bound)));
    const step = this.spanM / (this.resolution - 1);
    const ca = Math.cos(-yawRad);
    const sa = Math.sin(-yawRad);
    const hx = lengthM * 0.5;
    const hz = widthM * 0.5;

    for (let iz = minZ; iz <= maxZ; iz++) {
      const wz = -this.halfSpanM + iz * step;
      for (let ix = minX; ix <= maxX; ix++) {
        const wx = -this.halfSpanM + ix * step;
        const rx = (wx - cx) * ca - (wz - cz) * sa;
        const rz = (wx - cx) * sa + (wz - cz) * ca;
        const ox = Math.max(0, Math.abs(rx) - hx);
        const oz = Math.max(0, Math.abs(rz) - hz);
        const d = Math.hypot(ox, oz);
        if (d < 0.55) {
          const ft = Math.max(0, Math.min(1, (0.55 - d) / 0.55));
          this.setMaxChannel(ix, iz, 2, ft * ft * (3 - 2 * ft));
        }
        if (d < 1.15) {
          const dt = Math.max(0, Math.min(1, (1.15 - d) / 1.15));
          this.setMaxChannel(ix, iz, 0, dt * 0.5);
        }
      }
    }
  }

  /** Accumulates Gaussian tree canopy shade & needle/leaf litter (playbook §3 #7). */
  stampTreeCanopy(cx: number, cz: number, crownRadiusM: number, weight = 0.65): void {
    const r = crownRadiusM * 1.45;
    const minX = Math.max(0, Math.floor(this.worldToIndex(cx - r)));
    const maxX = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(cx + r)));
    const minZ = Math.max(0, Math.floor(this.worldToIndex(cz - r)));
    const maxZ = Math.min(this.resolution - 1, Math.ceil(this.worldToIndex(cz + r)));
    const step = this.spanM / (this.resolution - 1);
    const inv2Sig = 1 / (2 * (crownRadiusM * 0.62) * (crownRadiusM * 0.62));

    for (let iz = minZ; iz <= maxZ; iz++) {
      const wz = -this.halfSpanM + iz * step;
      for (let ix = minX; ix <= maxX; ix++) {
        const wx = -this.halfSpanM + ix * step;
        const d2 = (wx - cx) * (wx - cx) + (wz - cz) * (wz - cz);
        if (d2 > r * r) continue;
        const g = Math.exp(-d2 * inv2Sig) * weight;
        this.addChannel(ix, iz, 3, g);
      }
    }
  }

  /** Bilinear sample at world (x, z) in [0..1] per channel. */
  sample(x: number, z: number): GroundWorksSample {
    const u = (x + this.halfSpanM) / this.spanM;
    const v = (z + this.halfSpanM) / this.spanM;
    if (u <= 0 || u >= 1 || v <= 0 || v >= 1) {
      return { dirt: 0, cobble: 0, farm: 0, canopy: 0 };
    }
    const gx = u * (this.resolution - 1);
    const gz = v * (this.resolution - 1);
    const ix = Math.min(this.resolution - 2, Math.floor(gx));
    const iz = Math.min(this.resolution - 2, Math.floor(gz));
    const fx = gx - ix;
    const fz = gz - iz;
    const out = [0, 0, 0, 0];
    const i00 = (iz * this.resolution + ix) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + this.resolution * 4;
    const i11 = i01 + 4;
    for (let c = 0; c < 4; c++) {
      const a = this.data[i00 + c]! + fx * (this.data[i10 + c]! - this.data[i00 + c]!);
      const b = this.data[i01 + c]! + fx * (this.data[i11 + c]! - this.data[i01 + c]!);
      out[c] = (a + fz * (b - a)) / 255;
    }
    return { dirt: out[0]!, cobble: out[1]!, farm: out[2]!, canopy: out[3]! };
  }
}
