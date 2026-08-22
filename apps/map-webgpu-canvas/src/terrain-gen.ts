/**
 * Procedural terrain for the prototype: a mountainous north-east ridge, a
 * central valley basin that collects water, and a drainage channel running
 * to the south-west. Generated once on the CPU and uploaded as textures.
 */

import { clamp, lerp } from "./math";

export const GRID_SIZE = 512;
export const WORLD_SIZE_METERS = 2048;
export const CELL_SIZE_METERS = WORLD_SIZE_METERS / GRID_SIZE;

export interface TerrainData {
  gridSize: number;
  worldSize: number;
  /** Height in meters per grid cell, row-major, gridSize^2 entries. */
  heights: Float32Array;
  /** Vegetation fuel density 0..1 per grid cell. */
  fuel: Float32Array;
  minHeight: number;
  maxHeight: number;
  /** Bilinear height lookup with normalized coordinates (0..1). */
  sampleHeight(u: number, v: number): number;
}

function hash2(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

function ridged(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.55;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency) * 2 - 1);
    sum += n * n * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.11;
  }
  return sum / total;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function generateTerrain(): TerrainData {
  const n = GRID_SIZE;
  const heights = new Float32Array(n * n);
  const fuel = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const v = j / (n - 1);

      const warp = fbm(u * 3 + 11.7, v * 3 + 4.2, 3) - 0.5;
      // Mountains rise toward the north (small v) and east (large u).
      const mountainMask = smoothstep(
        0.32,
        0.92,
        (1 - v) * 0.62 + u * 0.5 + warp * 0.35,
      );
      const peaks = ridged(u * 4.5 + 2.3, v * 4.5 + 7.9, 5);
      const rolling = fbm(u * 6 + 31.4, v * 6 + 17.8, 5);

      // Drainage channel curving from the north-east down to the south-west.
      const channelX = 0.34 + 0.22 * (1 - v) + 0.06 * Math.sin(v * 9 + 1.2);
      const channelDist = Math.abs(u - channelX);
      const channel =
        (1 - smoothstep(0.0, 0.09, channelDist)) * (0.35 + v * 0.4);

      // Shallow basin in the south-west quadrant where floods pool.
      const basinDist = Math.hypot(u - 0.3, v - 0.72);
      const basin = (1 - smoothstep(0.05, 0.34, basinDist)) * 1.0;

      let height =
        14 +
        mountainMask * peaks * 300 +
        (rolling - 0.5) * 26 * (0.4 + mountainMask);
      height -= channel * 16;
      height -= basin * 10;
      heights[j * n + i] = Math.max(3, height);
    }
  }

  // Slope-aware vegetation: forests on mid slopes, sparse on rock and in
  // the wet basin floor.
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (const h of heights) {
    if (h < minHeight) minHeight = h;
    if (h > maxHeight) maxHeight = h;
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const h = heights[idx] ?? 0;
      const hx =
        (heights[j * n + Math.min(i + 1, n - 1)] ?? h) -
        (heights[j * n + Math.max(i - 1, 0)] ?? h);
      const hy =
        (heights[Math.min(j + 1, n - 1) * n + i] ?? h) -
        (heights[Math.max(j - 1, 0) * n + i] ?? h);
      const slope = Math.hypot(hx, hy) / (2 * CELL_SIZE_METERS);
      const u = i / (n - 1);
      const v = j / (n - 1);
      const patch = fbm(u * 9 + 51.2, v * 9 + 63.1, 4);
      const heightBand = smoothstep(8, 30, h) * (1 - smoothstep(200, 290, h));
      const slopeBand = 1 - smoothstep(0.55, 1.0, slope);
      fuel[idx] = clamp(
        (patch * 1.35 - 0.18) * heightBand * (0.35 + 0.65 * slopeBand),
        0,
        1,
      );
    }
  }

  const sampleHeight = (u: number, v: number): number => {
    const x = clamp(u, 0, 1) * (n - 1);
    const y = clamp(v, 0, 1) * (n - 1);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ix1 = Math.min(ix + 1, n - 1);
    const iy1 = Math.min(iy + 1, n - 1);
    const a = heights[iy * n + ix] ?? 0;
    const b = heights[iy * n + ix1] ?? 0;
    const c = heights[iy1 * n + ix] ?? 0;
    const d = heights[iy1 * n + ix1] ?? 0;
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };

  return {
    gridSize: n,
    worldSize: WORLD_SIZE_METERS,
    heights,
    fuel,
    minHeight,
    maxHeight,
    sampleHeight,
  };
}

export interface StaticRisk {
  /** rgba32float texel data: r flood-prone 0..1, g steepness 0..1, b/a unused. */
  data: Float32Array;
}

/**
 * Static hazard-susceptibility layers computed once from the DEM:
 * D8 flow accumulation marks flood-prone valley floors and channels,
 * and slope magnitude marks landslide-prone faces.
 */
export function computeStaticRisk(terrain: TerrainData): StaticRisk {
  const n = terrain.gridSize;
  const cell = terrain.worldSize / n;
  const { heights } = terrain;
  const acc = new Float32Array(n * n).fill(1);

  const order = Array.from({ length: n * n }, (_, i) => i);
  order.sort((a, b) => (heights[b] ?? 0) - (heights[a] ?? 0));

  for (const idx of order) {
    const i = idx % n;
    const j = Math.floor(idx / n);
    const h = heights[idx] ?? 0;
    let bestDrop = 0;
    let bestIdx = -1;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nIdx = nj * n + ni;
        const drop = (h - (heights[nIdx] ?? 0)) / Math.hypot(di, dj);
        if (drop > bestDrop) {
          bestDrop = drop;
          bestIdx = nIdx;
        }
      }
    }
    if (bestIdx >= 0) {
      acc[bestIdx] = (acc[bestIdx] ?? 1) + (acc[idx] ?? 1);
    }
  }

  let maxAcc = 1;
  for (const value of acc) {
    if (value > maxAcc) maxAcc = value;
  }
  const logMax = Math.log(1 + maxAcc);
  const range = Math.max(terrain.maxHeight - terrain.minHeight, 1);

  const data = new Float32Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const h = heights[idx] ?? 0;
      const heightNorm = (h - terrain.minHeight) / range;
      const flow = Math.log(1 + (acc[idx] ?? 1)) / logMax;
      // Channels and low valley floors; uplands cannot flood.
      const lowland = 1 - smoothstepValue(0.22, 0.55, heightNorm);
      const floodProne = clamp(flow * 1.35, 0, 1) * lowland;

      const hx =
        (heights[j * n + Math.min(i + 1, n - 1)] ?? h) -
        (heights[j * n + Math.max(i - 1, 0)] ?? h);
      const hy =
        (heights[Math.min(j + 1, n - 1) * n + i] ?? h) -
        (heights[Math.max(j - 1, 0) * n + i] ?? h);
      const slope =
        (Math.hypot(hx, hy) / (2 * cell)) * Math.max(1, Math.sqrt(cell / 94));
      const steep = clamp((slope - 0.28) / 0.6, 0, 1);

      data[idx * 4] = floodProne;
      data[idx * 4 + 1] = steep;
    }
  }
  return { data };
}

function smoothstepValue(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
