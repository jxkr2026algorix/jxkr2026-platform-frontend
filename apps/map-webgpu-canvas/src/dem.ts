/**
 * Real-terrain loader for the Gyeongsangbuk-do demo region.
 *
 * Elevation: AWS Terrain Tiles (terrarium encoding, no API key, CORS-enabled).
 * Imagery: Esri World Imagery tiles, draped over the terrain and also used to
 * derive the wildfire fuel map from vegetation greenness.
 *
 * Everything degrades gracefully: if tiles cannot be fetched the caller falls
 * back to the procedural terrain in terrain-gen.ts.
 */

import { clamp, lerp } from "./math";
import { GRID_SIZE, type TerrainData } from "./terrain-gen";

export interface GeoReference {
  centerLat: number;
  centerLon: number;
  sizeMeters: number;
  /** Bounding box in degrees. */
  west: number;
  east: number;
  north: number;
  south: number;
  source: "aws-terrain-tiles" | "procedural";
}

export interface RealTerrainResult {
  terrain: TerrainData;
  geo: GeoReference;
  /** Satellite composite ready for texture upload, or null if unavailable. */
  imagery: HTMLCanvasElement | null;
}

const TERRARIUM_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const IMAGERY_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
/** Google-Maps-like light street map (CARTO Voyager, OSM data). */
export const STREET_URL = (z: number, x: number, y: number) =>
  `https://${"abcd"[(x + y) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;

const TILE = 256;
const EARTH = 6378137;

function lonToGlobalPx(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE * 2 ** zoom;
}

function latToGlobalPx(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return ((1 - mercN / Math.PI) / 2) * TILE * 2 ** zoom;
}

function globalPxToLon(px: number, zoom: number): number {
  return (px / (TILE * 2 ** zoom)) * 360 - 180;
}

function globalPxToLat(py: number, zoom: number): number {
  const mercN = Math.PI * (1 - 2 * (py / (TILE * 2 ** zoom)));
  return ((2 * Math.atan(Math.exp(mercN)) - Math.PI / 2) * 180) / Math.PI;
}

function metersPerPixel(lat: number, zoom: number): number {
  return (
    (2 * Math.PI * EARTH * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** zoom)
  );
}

async function fetchTileBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`tile fetch failed: ${response.status}`);
  return createImageBitmap(await response.blob());
}

/**
 * Fetches all tiles intersecting the pixel bbox at `zoom` and composites the
 * bbox into a canvas of size outSize x outSize. Throws when more than a
 * quarter of the tiles fail.
 */
async function compositeTiles(
  urlFor: (z: number, x: number, y: number) => string,
  zoom: number,
  pxMinX: number,
  pxMinY: number,
  pxSize: number,
  outSize: number,
): Promise<HTMLCanvasElement> {
  const tileMin = {
    x: Math.floor(pxMinX / TILE),
    y: Math.floor(pxMinY / TILE),
  };
  const tileMax = {
    x: Math.floor((pxMinX + pxSize) / TILE),
    y: Math.floor((pxMinY + pxSize) / TILE),
  };
  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = true;
  const scale = outSize / pxSize;

  const jobs: Promise<boolean>[] = [];
  const maxIndex = 2 ** zoom - 1;
  for (let ty = tileMin.y; ty <= tileMax.y; ty++) {
    for (let tx = tileMin.x; tx <= tileMax.x; tx++) {
      if (tx < 0 || ty < 0 || tx > maxIndex || ty > maxIndex) continue;
      jobs.push(
        fetchTileBitmap(urlFor(zoom, tx, ty)).then(
          (bitmap) => {
            ctx.drawImage(
              bitmap,
              (tx * TILE - pxMinX) * scale,
              (ty * TILE - pxMinY) * scale,
              TILE * scale,
              TILE * scale,
            );
            bitmap.close();
            return true;
          },
          () => false,
        ),
      );
    }
  }
  const results = await Promise.all(jobs);
  const failed = results.filter((ok) => !ok).length;
  if (jobs.length === 0 || failed > jobs.length / 4) {
    throw new Error(`too many tile failures (${failed}/${jobs.length})`);
  }
  return canvas;
}

function bilinear(
  data: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
  decode: (r: number, g: number, b: number) => number,
): number {
  const cx = clamp(x, 0, size - 1);
  const cy = clamp(y, 0, size - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (px: number, py: number) => {
    const idx = (py * size + px) * 4;
    return decode(data[idx] ?? 0, data[idx + 1] ?? 0, data[idx + 2] ?? 0);
  };
  return lerp(
    lerp(at(x0, y0), at(x1, y0), fx),
    lerp(at(x0, y1), at(x1, y1), fx),
    fy,
  );
}

const decodeTerrarium = (r: number, g: number, b: number): number =>
  r * 256 + g + b / 256 - 32768;

function fuelFromImagery(imagery: HTMLCanvasElement): Float32Array {
  const n = GRID_SIZE;
  const small = document.createElement("canvas");
  small.width = n;
  small.height = n;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Float32Array(n * n).fill(0.4);
  ctx.drawImage(imagery, 0, 0, n, n);
  const pixels = ctx.getImageData(0, 0, n, n).data;
  const fuel = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const r = pixels[i * 4] ?? 0;
    const g = pixels[i * 4 + 1] ?? 0;
    const b = pixels[i * 4 + 2] ?? 0;
    const brightness = (r + g + b) / 3;
    const greenness = g - (r + b) / 2;
    // Forests read as dark green; paddies/grass lighter green. Water and
    // built-up gray areas carry no fuel.
    let f = clamp((greenness + 6) / 26, 0, 1);
    if (b > g + 8) f = 0; // water
    if (brightness > 190) f *= 0.15; // bare/urban bright surfaces
    fuel[i] = f * clamp(0.35 + brightness / 220, 0, 1);
  }
  return fuel;
}

function fuelFromSlope(heights: Float32Array, cellSize: number): Float32Array {
  const n = GRID_SIZE;
  const fuel = new Float32Array(n * n);
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
      const slope = Math.hypot(hx, hy) / (2 * cellSize);
      fuel[idx] = clamp(0.25 + slope * 1.6, 0, 1) * 0.8;
    }
  }
  return fuel;
}

export interface RealTerrainOptions {
  centerLat: number;
  centerLon: number;
  sizeMeters: number;
  /** Vertical exaggeration applied above the region's minimum height. */
  exaggeration: number;
  timeoutMs: number;
}

export const DEFAULT_REGION: RealTerrainOptions = {
  // The whole of Gyeongsangbuk-do: Mungyeong to the east coast (Pohang),
  // Andong/Uiseong in the center, Gyeongju to the south.
  centerLat: 36.35,
  centerLon: 128.75,
  sizeMeters: 180000,
  // Province-scale views need extra vertical relief to read as 3D.
  exaggeration: 3.2,
  timeoutMs: 22000,
};

/**
 * Composite a raster basemap covering the region at the highest zoom that
 * stays inside the tile budget, so a 24 km town view and a 180 km province
 * view both get the sharpest imagery we can reasonably fetch.
 */
export async function loadBasemap(
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  urlFor: (z: number, x: number, y: number) => string,
): Promise<HTMLCanvasElement | null> {
  const targetMpp = sizeMeters / GRID_SIZE;
  const baseZoom = clamp(
    Math.ceil(Math.log2(metersPerPixel(centerLat, 0) / targetMpp)),
    8,
    13,
  );
  const TILE_BUDGET = 300;
  for (const zoomOffset of [4, 3, 2, 1]) {
    const zoom = clamp(baseZoom + zoomOffset, 10, 16);
    const mpp = metersPerPixel(centerLat, zoom);
    const pxSize = sizeMeters / mpp;
    const tilesAcross = Math.floor(pxSize / TILE) + 1;
    if (tilesAcross * tilesAcross > TILE_BUDGET) continue;
    try {
      return await compositeTiles(
        urlFor,
        zoom,
        lonToGlobalPx(centerLon, zoom) - pxSize / 2,
        latToGlobalPx(centerLat, zoom) - pxSize / 2,
        pxSize,
        Math.min(4096, Math.round(pxSize)),
      );
    } catch {
      // Try the next coarser zoom.
    }
  }
  return null;
}

export async function loadRealTerrain(
  options: RealTerrainOptions,
): Promise<RealTerrainResult> {
  const work = loadRealTerrainInner(options);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("terrain tile load timed out")),
      options.timeoutMs,
    );
  });
  return Promise.race([work, timeout]);
}

async function loadRealTerrainInner(
  options: RealTerrainOptions,
): Promise<RealTerrainResult> {
  const { centerLat, centerLon, sizeMeters } = options;
  const n = GRID_SIZE;

  const targetMpp = sizeMeters / n;
  let demZoom = Math.ceil(Math.log2(metersPerPixel(centerLat, 0) / targetMpp));
  demZoom = clamp(demZoom, 8, 13);
  const demMpp = metersPerPixel(centerLat, demZoom);
  const demPxSize = sizeMeters / demMpp;
  const demMinX = lonToGlobalPx(centerLon, demZoom) - demPxSize / 2;
  const demMinY = latToGlobalPx(centerLat, demZoom) - demPxSize / 2;

  const demOut = 1024;
  const demCanvas = await compositeTiles(
    TERRARIUM_URL,
    demZoom,
    demMinX,
    demMinY,
    demPxSize,
    demOut,
  );
  const demCtx = demCanvas.getContext("2d", { willReadFrequently: true });
  if (!demCtx) throw new Error("2d context unavailable");
  const demPixels = demCtx.getImageData(0, 0, demOut, demOut).data;

  const heights = new Float32Array(n * n);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const px = (i / (n - 1)) * (demOut - 1);
      const py = (j / (n - 1)) * (demOut - 1);
      const h = bilinear(demPixels, demOut, px, py, decodeTerrarium);
      heights[j * n + i] = h;
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }
  }
  if (!Number.isFinite(minHeight) || maxHeight - minHeight < 5) {
    throw new Error("degenerate elevation data");
  }
  for (let i = 0; i < heights.length; i++) {
    heights[i] =
      minHeight +
      ((heights[i] ?? minHeight) - minHeight) * options.exaggeration;
  }
  maxHeight = minHeight + (maxHeight - minHeight) * options.exaggeration;

  // Satellite drape; failure is non-fatal (the procedural palette takes
  // over). The street basemap for the map style is loaded lazily later.
  const imagery = await loadBasemap(
    centerLat,
    centerLon,
    sizeMeters,
    IMAGERY_URL,
  );

  const cellSize = sizeMeters / n;
  const fuel = imagery
    ? fuelFromImagery(imagery)
    : fuelFromSlope(heights, cellSize);

  const sampleHeight = (u: number, v: number): number => {
    const x = clamp(u, 0, 1) * (n - 1);
    const y = clamp(v, 0, 1) * (n - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, n - 1);
    const y1 = Math.min(y0 + 1, n - 1);
    const fx = x - x0;
    const fy = y - y0;
    return lerp(
      lerp(heights[y0 * n + x0] ?? 0, heights[y0 * n + x1] ?? 0, fx),
      lerp(heights[y1 * n + x0] ?? 0, heights[y1 * n + x1] ?? 0, fx),
      fy,
    );
  };

  const geo: GeoReference = {
    centerLat,
    centerLon,
    sizeMeters,
    west: globalPxToLon(demMinX, demZoom),
    east: globalPxToLon(demMinX + demPxSize, demZoom),
    north: globalPxToLat(demMinY, demZoom),
    south: globalPxToLat(demMinY + demPxSize, demZoom),
    source: "aws-terrain-tiles",
  };

  return {
    terrain: {
      gridSize: n,
      worldSize: sizeMeters,
      heights,
      fuel,
      minHeight,
      maxHeight,
      sampleHeight,
    },
    geo,
    imagery,
  };
}
