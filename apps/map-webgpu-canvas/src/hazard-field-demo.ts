/**
 * Interim hazard fields, computed on the client from the loaded DEM.
 *
 * Spread belongs to the platform's models — `flood_extent`, `wildfire_spread`
 * and the rest already exist as recipes, and their output is what
 * `map:set-hazard-field` is shaped for. Until that stream is live, this
 * produces frames of the same shape so the rendering path is exercised and
 * the demo has something truthful to show.
 *
 * The flood field is a real drainage calculation, not a decoration: D8 flow
 * directions over the DEM, accumulated downhill. That is why the result
 * follows valleys and branches like a river network instead of pooling in a
 * disc — the terrain decides where the water goes.
 */

import type { HazardField } from "./protocol";
import type { TerrainData } from "./terrain-gen";

/** Frames are square; 512 over a 12 km window is a ~23 m cell. */
const FIELD_SIZE = 512;

export interface FieldWindow {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Terrain heights sampled over a geographic window, in the field's grid. */
function sampleHeights(
  terrain: TerrainData,
  bounds: { west: number; east: number; north: number; south: number },
  win: FieldWindow,
  n: number,
): Float32Array {
  const heights = new Float32Array(n * n);
  const u0 = (win.west - bounds.west) / (bounds.east - bounds.west);
  const u1 = (win.east - bounds.west) / (bounds.east - bounds.west);
  const v0 = (bounds.north - win.north) / (bounds.north - bounds.south);
  const v1 = (bounds.north - win.south) / (bounds.north - bounds.south);
  for (let j = 0; j < n; j++) {
    const v = v0 + ((v1 - v0) * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const u = u0 + ((u1 - u0) * i) / (n - 1);
      heights[j * n + i] = terrain.sampleHeight(u, v);
    }
  }
  return heights;
}

/**
 * D8 flow accumulation. Cells are processed from high to low, so every cell's
 * own catchment has already drained into it by the time it is visited.
 */
function flowAccumulation(heights: Float32Array, n: number): Float32Array {
  const acc = new Float32Array(n * n).fill(1);
  const order = Array.from({ length: n * n }, (_, i) => i).sort(
    (a, b) => (heights[b] ?? 0) - (heights[a] ?? 0),
  );
  for (const idx of order) {
    const x = idx % n;
    const y = (idx / n) | 0;
    const h = heights[idx] ?? 0;
    let bestIdx = -1;
    let bestDrop = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ni = ny * n + nx;
        // Steepest descent, distance-weighted so diagonals do not win by
        // default on a smooth slope.
        const drop = (h - (heights[ni] ?? 0)) / (dx && dy ? Math.SQRT2 : 1);
        if (drop > bestDrop) {
          bestDrop = drop;
          bestIdx = ni;
        }
      }
    }
    if (bestIdx >= 0) acc[bestIdx] = (acc[bestIdx] ?? 0) + (acc[idx] ?? 0);
  }
  return acc;
}

/**
 * Inundation depth from rainfall over a window. Depth rises with upstream
 * catchment and falls with local slope: water runs off a hillside and stands
 * on a valley floor.
 */
export function floodField(
  terrain: TerrainData,
  bounds: { west: number; east: number; north: number; south: number },
  win: FieldWindow,
  rainfallMmPerHour: number,
): HazardField {
  const n = FIELD_SIZE;
  const heights = sampleHeights(terrain, bounds, win, n);
  const acc = flowAccumulation(heights, n);
  const values = new Float32Array(n * n);
  const intensity = Math.max(rainfallMmPerHour, 1) / 80;

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
      const slope = Math.hypot(hx, hy);
      // Catchment scaled logarithmically: a channel two orders of magnitude
      // larger is deeper, not a hundred times deeper.
      const catchment = Math.log10(1 + (acc[idx] ?? 1)) / Math.log10(1 + n * n);
      const flat = 1 / (1 + slope * 0.55);
      values[idx] = Math.max(0, catchment ** 2.6 * flat * 14 * intensity);
    }
  }

  return {
    hazard: "flood",
    bbox: [win.west, win.south, win.east, win.north],
    width: n,
    height: n,
    values,
    threshold: 0.12,
    isStub: true,
  };
}

/** A square window of `sizeMeters` centred on a point. */
export function windowAround(
  lat: number,
  lon: number,
  sizeMeters: number,
): FieldWindow {
  const dLat = sizeMeters / 2 / 110574;
  const dLon = sizeMeters / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lon - dLon,
    east: lon + dLon,
    south: lat - dLat,
    north: lat + dLat,
  };
}
