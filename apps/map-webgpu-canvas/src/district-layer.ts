/**
 * District boundary overlay.
 *
 * The 시/군 outlines from the national boundary dataset are rasterized into a
 * single RGBA canvas in normalized map space and uploaded as one texture, so
 * the terrain shader composites them in a single sample. Drawing them with
 * Canvas2D (rather than per-cell polygon fills like the risk zones) keeps the
 * hairlines antialiased at province scale, where a boundary is well under one
 * simulation cell wide.
 */

import boundaries from "./data/gyeongbuk-boundaries.json";
import { DISTRICTS, type GeoBounds, latLonToMapPoint } from "./districts";

/** Texture resolution; 2048 gives ~90 m per pixel over the whole province. */
const OVERLAY_SIZE = 2048;

const RINGS = boundaries.rings as Record<string, number[][]>;

export interface DistrictOverlayOptions {
  bounds: GeoBounds;
  /** Code of the district to emphasize, or null for none. */
  selected?: string | null;
}

/** Every district outline as normalized map-space rings, cached per bounds. */
function projectRings(
  code: string,
  bounds: GeoBounds,
): { x: number; y: number }[][] {
  return (RINGS[code] ?? []).map((flat) => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      points.push(latLonToMapPoint(flat[i + 1] ?? 0, flat[i] ?? 0, bounds));
    }
    return points;
  });
}

/**
 * True when any part of the ring set falls on the canvas. Focusing 울릉군
 * puts the 21 mainland districts ~200 km off-canvas (and vice versa), so
 * culling keeps the rasterizer from pushing huge coordinates at Canvas2D.
 */
function intersectsCanvas(rings: { x: number; y: number }[][]): boolean {
  for (const ring of rings) {
    for (const point of ring) {
      if (
        point.x >= -0.05 &&
        point.x <= 1.05 &&
        point.y >= -0.05 &&
        point.y <= 1.05
      ) {
        return true;
      }
    }
  }
  return false;
}

function trace(
  ctx: CanvasRenderingContext2D,
  rings: { x: number; y: number }[][],
  size: number,
): void {
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i++) {
      const point = ring[i];
      if (!point) continue;
      const x = point.x * size;
      const y = point.y * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/**
 * Draw all 22 boundaries, with the selected district filled and outlined more
 * strongly. Returns null when there is no georeference to project against.
 */
export function renderDistrictOverlay(
  options: DistrictOverlayOptions,
): HTMLCanvasElement | null {
  const { bounds, selected = null } = options;
  const size = OVERLAY_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const district of DISTRICTS) {
    const rings = projectRings(district.code, bounds);
    if (rings.length === 0 || !intersectsCanvas(rings)) continue;
    const isSelected = district.code === selected;

    // No fill on the selected district. The map is always framed on one, so a
    // tint across it covered most of the screen in flat blue — which read as
    // standing water and washed out the terrain underneath. The weight of the
    // outline is enough to say which district is selected.

    trace(ctx, rings, size);
    // A dark halo first, so the hairline stays readable over both the
    // satellite drape and the light street basemap.
    ctx.strokeStyle = isSelected
      ? "rgba(10, 24, 60, 0.55)"
      : "rgba(12, 18, 32, 0.32)";
    ctx.lineWidth = isSelected ? 7 : 4.5;
    ctx.stroke();
    ctx.strokeStyle = isSelected
      ? "rgba(120, 165, 255, 0.98)"
      : "rgba(255, 255, 255, 0.72)";
    ctx.lineWidth = isSelected ? 3.4 : 1.7;
    ctx.stroke();
  }

  return canvas;
}
