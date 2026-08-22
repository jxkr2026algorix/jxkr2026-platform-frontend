/**
 * Web-Mercator helpers shared by the tile loader, the district registry, and
 * the renderer. Normalized Mercator units run 0..1 across the whole world:
 * x = 0 at 180°W, y = 0 at the north edge of the projection.
 */

export const EARTH_RADIUS_METERS = 6378137;
export const TILE_SIZE = 256;

export const mercatorX = (lon: number): number => (lon + 180) / 360;

export const mercatorY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

export const mercatorToLon = (x: number): number => x * 360 - 180;

export const mercatorToLat = (y: number): number =>
  ((2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2) * 180) /
  Math.PI;

/** Ground meters spanned by one full normalized Mercator unit at `lat`. */
export const metersPerMercatorUnit = (lat: number): number =>
  2 * Math.PI * EARTH_RADIUS_METERS * Math.cos((lat * Math.PI) / 180);

export const lonToGlobalPx = (lon: number, zoom: number): number =>
  mercatorX(lon) * TILE_SIZE * 2 ** zoom;

export const latToGlobalPx = (lat: number, zoom: number): number =>
  mercatorY(lat) * TILE_SIZE * 2 ** zoom;

export const globalPxToLon = (px: number, zoom: number): number =>
  mercatorToLon(px / (TILE_SIZE * 2 ** zoom));

export const globalPxToLat = (py: number, zoom: number): number =>
  mercatorToLat(py / (TILE_SIZE * 2 ** zoom));

export const metersPerPixel = (lat: number, zoom: number): number =>
  metersPerMercatorUnit(lat) / (TILE_SIZE * 2 ** zoom);

/** Geographic bounding box, [west, south, east, north] in degrees. */
export type Bbox = readonly [number, number, number, number];

/** Square terrain region, in the shape `loadRealTerrain` consumes. */
export interface RegionBox {
  centerLat: number;
  centerLon: number;
  sizeMeters: number;
}

/**
 * The smallest square Mercator region that contains `bbox`, scaled by
 * `margin` (1.06 leaves a ~3% breathing strip on each side). The renderer's
 * terrain is always a Mercator square, so the region has to be squared in
 * projected space rather than in degrees.
 */
export function regionForBbox(bbox: Bbox, margin = 1.06): RegionBox {
  const [west, south, east, north] = bbox;
  const x0 = mercatorX(west);
  const x1 = mercatorX(east);
  const y0 = mercatorY(north);
  const y1 = mercatorY(south);
  const span = Math.max(x1 - x0, y1 - y0) * margin;
  const centerLat = mercatorToLat((y0 + y1) / 2);
  return {
    centerLat,
    centerLon: mercatorToLon((x0 + x1) / 2),
    sizeMeters: span * metersPerMercatorUnit(centerLat),
  };
}

/** Geographic bounds of a square Mercator region. */
export function bboxForRegion(region: RegionBox): Bbox {
  const span = region.sizeMeters / metersPerMercatorUnit(region.centerLat);
  const cx = mercatorX(region.centerLon);
  const cy = mercatorY(region.centerLat);
  return [
    mercatorToLon(cx - span / 2),
    mercatorToLat(cy + span / 2),
    mercatorToLon(cx + span / 2),
    mercatorToLat(cy - span / 2),
  ];
}

/** True when `inner` lies entirely inside `outer`. */
export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[2] <= outer[2] &&
    inner[3] <= outer[3]
  );
}
