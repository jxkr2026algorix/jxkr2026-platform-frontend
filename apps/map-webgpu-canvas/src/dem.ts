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

import { PROVINCE_REGION } from "./districts";
import {
  globalPxToLat,
  globalPxToLon,
  latToGlobalPx,
  lonToGlobalPx,
  metersPerPixel,
  TILE_SIZE as TILE,
} from "./geo";
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
  /** Street-map composite (map style), loaded in parallel; may be null. */
  street: HTMLCanvasElement | null;
}

const TERRARIUM_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const IMAGERY_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
/** Google-Maps-like light street map (CARTO Voyager, OSM data). */
export const STREET_URL = (z: number, x: number, y: number) =>
  `https://${"abcd"[(x + y) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;

// TMap raster tiles (SK open API) are used for the map style when an app
// key is configured; they carry full Korean building/POI detail. Tiles are
// standard Web Mercator XYZ, so positions line up with everything else.
const TMAP_KEY = (
  (import.meta.env.VITE_TMAP_APP_KEY as string | undefined) ?? ""
).trim();
// The SDK's tile backend serves TMS-scheme tiles (y flipped) without CORS
// headers, so requests go through the dev-server proxy (see vite.config.ts).
// {ytms} = (2^z - 1 - y) for TMS endpoints; {y} is standard XYZ.
const TMAP_TEMPLATE =
  ((import.meta.env.VITE_TMAP_TILE_URL as string | undefined) ?? "").trim() ||
  "/tmap-tiles{s}/{z}/{x}/{ytms}.png?version=20220406";

export const TMAP_ENABLED = TMAP_KEY.length > 0;

const TMAP_URL = (z: number, x: number, y: number) =>
  TMAP_TEMPLATE.replace("{s}", String(1 + ((x + y) % 3)))
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{ytms}", String(2 ** z - 1 - y))
    .replace("{y}", String(y))
    .replace("{key}", TMAP_KEY);

/** Street basemap: TMap when configured, CARTO as automatic fallback. */
export async function loadStreetBasemap(
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
): Promise<HTMLCanvasElement | null> {
  if (TMAP_ENABLED) {
    const canvas = await loadBasemap(
      centerLat,
      centerLon,
      sizeMeters,
      TMAP_URL,
    );
    if (canvas) return canvas;
    console.warn("TMap tiles unavailable; falling back to CARTO street map");
  }
  return loadBasemap(centerLat, centerLon, sizeMeters, STREET_URL);
}

/** High-zoom street detail patch with the same TMap-first fallback. */
export async function loadStreetDetailPatch(
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  options?: CompositeOptions,
): Promise<DetailPatch | null> {
  if (TMAP_ENABLED) {
    const patch = await loadDetailPatch(
      centerLat,
      centerLon,
      sizeMeters,
      TMAP_URL,
      options,
    );
    if (patch || options?.signal?.aborted) return patch;
  }
  return loadDetailPatch(centerLat, centerLon, sizeMeters, STREET_URL, options);
}

// Persistent tile cache (Cache Storage): DEM, satellite, street, and
// detail-patch tiles all pass through here, so repeat loads of the same
// region skip the network entirely.
const TILE_CACHE_NAME = "salgil-tiles-v1";
let tileCachePromise: Promise<Cache | null> | undefined;

function getTileCache(): Promise<Cache | null> {
  tileCachePromise ??= (async () => {
    try {
      return await caches.open(TILE_CACHE_NAME);
    } catch {
      return null; // e.g. insecure context; fall back to network-only
    }
  })();
  return tileCachePromise;
}

async function fetchTileBitmap(
  url: string,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  const cache = await getTileCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return await createImageBitmap(await hit.blob());
    } catch {
      // Corrupt entry; fall through to the network.
    }
  }
  const response = await fetch(url, {
    mode: "cors",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`tile fetch failed: ${response.status}`);
  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch {
      // Quota exceeded or opaque response; serving from network is fine.
    }
  }
  return createImageBitmap(await response.blob());
}

export interface CompositeOptions {
  signal?: AbortSignal;
  /** Called as tiles land, so callers can show partial progress. */
  onProgress?: (canvas: HTMLCanvasElement) => void;
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
  options?: CompositeOptions,
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
        fetchTileBitmap(urlFor(zoom, tx, ty), options?.signal).then(
          (bitmap) => {
            ctx.drawImage(
              bitmap,
              (tx * TILE - pxMinX) * scale,
              (ty * TILE - pxMinY) * scale,
              TILE * scale,
              TILE * scale,
            );
            bitmap.close();
            options?.onProgress?.(canvas);
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

/** Province-scale views need extra vertical relief to read as 3D. */
export const PROVINCE_EXAGGERATION = 3.2;

/**
 * The whole of mainland Gyeongsangbuk-do, squared off in Mercator space from
 * the national 시군구 boundary dataset: Sangju/Gimcheon in the west, the
 * Uljin-Pohang coastline in the east, Bonghwa in the north, and
 * Gyeongju/Cheongdo in the south. Every 시/군 except the offshore 울릉군 is
 * inside this box, so the default view shows the entire province.
 */
export const DEFAULT_REGION: RealTerrainOptions = {
  centerLat: PROVINCE_REGION.centerLat,
  centerLon: PROVINCE_REGION.centerLon,
  sizeMeters: PROVINCE_REGION.sizeMeters,
  exaggeration: PROVINCE_EXAGGERATION,
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

  // Satellite drape and the street basemap load in parallel so the map
  // style is available the moment the user toggles it. Both are non-fatal.
  const [imagery, street] = await Promise.all([
    loadBasemap(centerLat, centerLon, sizeMeters, IMAGERY_URL),
    loadStreetBasemap(centerLat, centerLon, sizeMeters),
  ]);

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
    street,
  };
}

export interface DetailPatch {
  canvas: HTMLCanvasElement;
  /** Geographic bounds of the patch (degrees). */
  west: number;
  east: number;
  north: number;
  south: number;
}

/**
 * High-zoom detail patch for the area the camera is looking at, so streets
 * and building footprints appear as you zoom in (slippy-map style LOD).
 * Prefers the highest zoom (up to 17) that fits the tile budget.
 */
export async function loadDetailPatch(
  centerLat: number,
  centerLon: number,
  sizeMeters: number,
  urlFor: (z: number, x: number, y: number) => string,
  options?: CompositeOptions,
): Promise<DetailPatch | null> {
  const TILE_BUDGET = 110;
  for (let zoom = 17; zoom >= 12; zoom--) {
    const mpp = metersPerPixel(centerLat, zoom);
    const pxSize = sizeMeters / mpp;
    const tilesAcross = Math.floor(pxSize / TILE) + 1;
    if (tilesAcross * tilesAcross > TILE_BUDGET) continue;
    const minX = lonToGlobalPx(centerLon, zoom) - pxSize / 2;
    const minY = latToGlobalPx(centerLat, zoom) - pxSize / 2;
    try {
      const canvas = await compositeTiles(
        urlFor,
        zoom,
        minX,
        minY,
        pxSize,
        Math.min(2048, Math.round(pxSize)),
        options,
      );
      return {
        canvas,
        west: globalPxToLon(minX, zoom),
        east: globalPxToLon(minX + pxSize, zoom),
        north: globalPxToLat(minY, zoom),
        south: globalPxToLat(minY + pxSize, zoom),
      };
    } catch {
      if (options?.signal?.aborted) return null;
      // Fall through to a coarser zoom.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// OSM building footprints (vector polygons) for the detail patch.
// Coverage in Korea is uneven and the public Overpass servers are
// best-effort, so failures are silent: the raster tiles underneath keep
// whatever buildings they render on their own.
// ---------------------------------------------------------------------------

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export async function loadBuildingFootprints(
  patch: DetailPatch,
): Promise<{ lat: number; lon: number }[][]> {
  const query =
    `[out:json][timeout:12];` +
    `way["building"](${patch.south},${patch.west},${patch.north},${patch.east});` +
    `out geom 6000;`;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) throw new Error(`overpass ${response.status}`);
  const json = (await response.json()) as {
    elements?: { type: string; geometry?: { lat: number; lon: number }[] }[];
  };
  return (json.elements ?? [])
    .filter((el) => el.type === "way" && (el.geometry?.length ?? 0) >= 3)
    .map((el) => el.geometry as { lat: number; lon: number }[]);
}

const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Draw building polygons onto the patch canvas (fill + outline). */
export function drawBuildings(
  patch: DetailPatch,
  buildings: { lat: number; lon: number }[][],
  style: "satellite" | "map",
): void {
  const ctx = patch.canvas.getContext("2d");
  if (!ctx) return;
  const w = patch.canvas.width;
  const h = patch.canvas.height;
  const yTop = mercY(patch.north);
  const ySpan = mercY(patch.south) - yTop;
  const xSpan = patch.east - patch.west;

  ctx.save();
  if (style === "map") {
    ctx.fillStyle = "rgba(118, 124, 138, 0.32)";
    ctx.strokeStyle = "rgba(84, 90, 104, 0.75)";
  } else {
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  }
  ctx.lineWidth = Math.max(1, w / 2048);
  ctx.beginPath();
  for (const ring of buildings) {
    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i];
      if (!pt) continue;
      const x = ((pt.lon - patch.west) / xSpan) * w;
      const y = ((mercY(pt.lat) - yTop) / ySpan) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
