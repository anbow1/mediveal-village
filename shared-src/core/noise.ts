// Value + gradient noise for terrain and procedural textures. Deterministic.

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Each lattice point's gradient direction, from the top 16 bits of its hash: a table instead of a cosine and
 * a sine per corner. Terrain and scatter call this tens of millions of times while the game loads, and the
 * two trig calls were most of it (4× faster; the angles move by at most 1e-4 rad, heights by a millimetre).
 */
const GRAD_BITS = 16;
const GRAD_X = new Float64Array(1 << GRAD_BITS);
const GRAD_Y = new Float64Array(1 << GRAD_BITS);
for (let i = 0; i < 1 << GRAD_BITS; i++) {
  const a = ((i + 0.5) / (1 << GRAD_BITS)) * Math.PI * 2;
  GRAD_X[i] = Math.cos(a);
  GRAD_Y[i] = Math.sin(a);
}

/** The gradient at lattice point (cx, cy) dotted with the offset (dx, dy); hash2's bits, unscaled. */
function grad(cx: number, cy: number, seed: number, dx: number, dy: number): number {
  let h = (cx * 374761393 + cy * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  const k = h >>> (32 - GRAD_BITS);
  return (GRAD_X[k] as number) * dx + (GRAD_Y[k] as number) * dy;
}

/** 2D gradient noise in about [-1, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const n00 = grad(ix, iy, seed, fx, fy);
  const n10 = grad(ix + 1, iy, seed, fx - 1, fy);
  const n01 = grad(ix, iy + 1, seed, fx, fy - 1);
  const n11 = grad(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  return (n00 + (n10 - n00) * u + (n01 - n00) * v + (n00 - n10 - n01 + n11) * u * v) * 1.41;
}

export function fbm2(x: number, y: number, octaves: number, seed = 0, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(fx, fy, seed + i * 17);
    norm += amp;
    amp *= gain;
    fx *= lacunarity;
    fy *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal: sharp crests, used for the forest ridge line. */
export function ridged2(x: number, y: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(fx, fy, seed + i * 31));
    n *= n * weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
  }
  return sum;
}

/** Tileable value noise on a period, for textures that must wrap. */
export function tileNoise(x: number, y: number, period: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const w = (v: number): number => ((v % period) + period) % period;
  const a = hash2(w(ix), w(iy), seed);
  const b = hash2(w(ix + 1), w(iy), seed);
  const c = hash2(w(ix), w(iy + 1), seed);
  const d = hash2(w(ix + 1), w(iy + 1), seed);
  const u = fade(fx);
  const v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function tileFbm(x: number, y: number, period: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let p = period;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(fx, fy, p, seed + i * 13);
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    p *= 2;
  }
  return sum;
}

/**
 * Tileable value noise with its own period on each axis, for textures stretched along one: a board's grain
 * is long along the board and fine across it, and one period for both repeated the across-pattern several
 * times over the tile (rows of identical knots and cracks).
 */
export function tileNoiseXY(x: number, y: number, periodX: number, periodY: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const wx = (v: number): number => ((v % periodX) + periodX) % periodX;
  const wy = (v: number): number => ((v % periodY) + periodY) % periodY;
  const a = hash2(wx(ix), wy(iy), seed);
  const b = hash2(wx(ix + 1), wy(iy), seed);
  const c = hash2(wx(ix), wy(iy + 1), seed);
  const d = hash2(wx(ix + 1), wy(iy + 1), seed);
  const u = fade(fx);
  const v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal sum of `tileNoiseXY`: (x, y) in [0, periodX) × [0, periodY) tiles. */
export function tileFbmXY(x: number, y: number, periodX: number, periodY: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    const k = 2 ** i;
    sum += amp * tileNoiseXY(x * k, y * k, periodX * k, periodY * k, seed + i * 13);
    amp *= 0.5;
  }
  return sum;
}
