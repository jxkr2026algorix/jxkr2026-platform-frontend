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

import { loadWindowHeights } from "./dem";
import type { HazardField } from "./protocol";

/** Frames are square; 512 over a 12 km window is a ~23 m cell. */
const FIELD_SIZE = 512;

export interface FieldWindow {
  west: number;
  south: number;
  east: number;
  north: number;
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
export async function floodField(
  win: FieldWindow,
  rainfallMmPerHour: number,
): Promise<HazardField | null> {
  const n = FIELD_SIZE;
  const heights = await loadWindowHeights(
    win.west,
    win.south,
    win.east,
    win.north,
    n,
  );
  if (!heights) return null;
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
      // The slope penalty is gentle on purpose. Steep reaches genuinely hold
      // less water, but penalising them hard broke every channel into
      // disconnected pools — and a drainage network that does not connect
      // tells an operator nothing about where the water is going.
      const flat = 1 / (1 + slope * 0.18);
      // The exponent decides how much catchment a gully needs before it
      // counts. Lower and every hillside crease floods; this keeps the
      // channels that carry real volume.
      values[idx] = Math.max(0, catchment ** 2.15 * flat * 17 * intensity);
    }
  }

  return {
    hazard: "flood",
    bbox: [win.west, win.south, win.east, win.north],
    width: n,
    height: n,
    values,
    threshold: 0.09,
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
