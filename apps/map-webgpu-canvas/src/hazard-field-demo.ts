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
/** Elevation and drainage for a window, computed once and reused per horizon. */
export interface WindowTerrain {
  readonly heights: Float32Array;
  readonly acc: Float32Array;
  readonly slope: Float32Array;
  readonly n: number;
  readonly win: FieldWindow;
}

export async function loadWindowTerrain(
  win: FieldWindow,
): Promise<WindowTerrain | null> {
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
  const slope = new Float32Array(n * n);
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
      slope[idx] = Math.hypot(hx, hy);
    }
  }
  return { heights, acc, slope, n, win };
}

export function floodFieldAt(
  terrain: WindowTerrain,
  rainfallMmPerHour: number,
  horizonMinutes: number,
): HazardField {
  const { n, acc, slope, win } = terrain;
  const values = new Float32Array(n * n);
  const intensity = Math.max(rainfallMmPerHour, 1) / 80;
  // Water reaches the trunk first and works up the tributaries. Time enters
  // as a falling bar on how much catchment a cell needs before it fills, so
  // successive horizons extend the network rather than deepening a puddle.
  // Starts at the trunk network rather than at nothing: a first frame with no
  // water on it looks like a failure, not like an early forecast.
  const reach = Math.min(1, 0.55 + horizonMinutes / 220);
  const rise = Math.min(1.6, 0.55 + horizonMinutes / 90);

  for (let idx = 0; idx < n * n; idx++) {
    // Catchment scaled logarithmically: a channel two orders of magnitude
    // larger is deeper, not a hundred times deeper.
    const catchment = Math.log10(1 + (acc[idx] ?? 1)) / Math.log10(1 + n * n);
    if (catchment < 1 - reach) continue;
    // The slope penalty is gentle on purpose. Steep reaches genuinely hold
    // less water, but penalising them hard broke every channel into
    // disconnected pools — and a drainage network that does not connect
    // tells an operator nothing about where the water is going.
    const flat = 1 / (1 + (slope[idx] ?? 0) * 0.18);
    // The exponent decides how much catchment a gully needs before it counts.
    // Lower and every hillside crease floods.
    values[idx] = Math.max(0, catchment ** 2.15 * flat * 17 * intensity * rise);
  }

  return {
    hazard: "flood",
    bbox: [win.west, win.south, win.east, win.north],
    width: n,
    height: n,
    values,
    horizonMinutes,
    threshold: 0.09,
    isStub: true,
  };
}

/**
 * Wildfire spread from an ignition point. Fire runs uphill and downwind, so
 * the front is not a circle: the cost of reaching a cell falls with upslope
 * and with alignment to the wind, and the horizon is a budget on that cost.
 */
export function wildfireFieldAt(
  terrain: WindowTerrain,
  origin: { u: number; v: number },
  wind: { x: number; y: number },
  horizonMinutes: number,
): HazardField {
  const { n, heights, win } = terrain;
  const values = new Float32Array(n * n);
  const cellMeters =
    ((win.east - win.west) *
      111_320 *
      Math.cos(((win.north + win.south) / 2) * (Math.PI / 180))) /
    n;
  // Metres of front advance in the horizon, at a rate a crown fire manages.
  const budget = Math.max(120, (horizonMinutes / 60) * 900);

  const start = Math.min(
    n * n - 1,
    Math.max(
      0,
      Math.round(origin.v * (n - 1)) * n + Math.round(origin.u * (n - 1)),
    ),
  );
  const cost = new Float32Array(n * n).fill(Number.POSITIVE_INFINITY);
  cost[start] = 0;
  // Dial-style bucket queue: costs are bounded and coarse, so this is a
  // Dijkstra without the heap.
  let frontier = [start];
  const windLen = Math.hypot(wind.x, wind.y) || 1;
  const wx = wind.x / windLen;
  const wy = wind.y / windLen;

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const idx of frontier) {
      const base = cost[idx] ?? 0;
      if (base > budget) continue;
      const x = idx % n;
      const y = (idx / n) | 0;
      const h = heights[idx] ?? 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const ni = ny * n + nx;
          const step = cellMeters * (dx && dy ? Math.SQRT2 : 1);
          const rise = (heights[ni] ?? h) - h;
          // Uphill is cheap, downhill expensive: fire preheats the fuel above
          // it. Downwind is cheap for the same reason.
          const slopeFactor =
            rise > 0
              ? 1 / (1 + (rise / step) * 3.2)
              : 1 + Math.min(2, -rise / step);
          const align = (dx * wx + dy * wy) / (dx && dy ? Math.SQRT2 : 1);
          const windFactor = 1 / (1 + Math.max(0, align) * 1.6);
          // Floor the discount. Uphill and downwind both make fire faster, but
          // multiplied together they let the front outrun its own time budget
          // several times over and the burn covers the whole window at once.
          const ease = Math.max(0.45, slopeFactor * windFactor);
          const candidate = base + step * ease;
          if (
            candidate < (cost[ni] ?? Number.POSITIVE_INFINITY) &&
            candidate <= budget
          ) {
            cost[ni] = candidate;
            next.push(ni);
          }
        }
      }
    }
    frontier = next;
  }

  for (let idx = 0; idx < n * n; idx++) {
    const c = cost[idx] ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(c)) continue;
    // 1 at the origin, falling to 0 at the front, so the interior reads as
    // burnt and the edge as the active fire line.
    values[idx] = Math.max(0, 1 - c / budget);
  }

  return {
    hazard: "wildfire",
    bbox: [win.west, win.south, win.east, win.north],
    width: n,
    height: n,
    values,
    horizonMinutes,
    threshold: 0.02,
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
