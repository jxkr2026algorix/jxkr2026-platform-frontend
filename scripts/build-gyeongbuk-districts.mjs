/**
 * Generates apps/map-webgpu-canvas/src/data/gyeongbuk-districts.json from the
 * national administrative-boundary dataset.
 *
 * Source: Statistics Korea (통계청) SGIS 2018 시군구 경계, redistributed as
 * GeoJSON (WGS84) by github.com/southkorea/southkorea-maps under its
 * public-data terms. Only the 22 Gyeongsangbuk-do 시/군 are kept; Pohang's two
 * 구 are merged back into 포항시, and 군위군 is dropped because it moved to
 * Daegu in July 2023.
 *
 * Usage:
 *   node scripts/build-gyeongbuk-districts.mjs [path/to/source.json]
 * With no argument the source is downloaded to a temp file.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "apps/map-webgpu-canvas/src/data");
/** Metadata only: small enough for the console bundle to import directly. */
const OUT_DISTRICTS = join(DATA_DIR, "gyeongbuk-districts.json");
/** Boundary rings: renderer-only, imported by the district overlay layer. */
const OUT_BOUNDARIES = join(DATA_DIR, "gyeongbuk-boundaries.json");
const SOURCE_URL =
  "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-municipalities-2018-geo.json";

/** Simplification tolerance in degrees (~150 m); province-scale rendering. */
const TOLERANCE = 0.0013;
/** Rings smaller than this share of the district's largest ring are dropped. */
const MIN_RING_SHARE = 0.0006;
/** Rings below this share do not contribute to the focus bounding box. */
const BBOX_RING_SHARE = 0.02;
const PRECISION = 4;

/**
 * The 22 Gyeongsangbuk-do 시/군, in the order used by the console picker
 * (10 시 then 12 군, both in the official listing order).
 */
const DISTRICTS = [
  { code: "47110", name: "포항시", nameEn: "Pohang-si", kind: "si", source: ["37011", "37012"] },
  { code: "47130", name: "경주시", nameEn: "Gyeongju-si", kind: "si", source: ["37020"] },
  { code: "47150", name: "김천시", nameEn: "Gimcheon-si", kind: "si", source: ["37030"] },
  { code: "47170", name: "안동시", nameEn: "Andong-si", kind: "si", source: ["37040"] },
  { code: "47190", name: "구미시", nameEn: "Gumi-si", kind: "si", source: ["37050"] },
  { code: "47210", name: "영주시", nameEn: "Yeongju-si", kind: "si", source: ["37060"] },
  { code: "47230", name: "영천시", nameEn: "Yeongcheon-si", kind: "si", source: ["37070"] },
  { code: "47250", name: "상주시", nameEn: "Sangju-si", kind: "si", source: ["37080"] },
  { code: "47280", name: "문경시", nameEn: "Mungyeong-si", kind: "si", source: ["37090"] },
  { code: "47290", name: "경산시", nameEn: "Gyeongsan-si", kind: "si", source: ["37100"] },
  { code: "47730", name: "의성군", nameEn: "Uiseong-gun", kind: "gun", source: ["37320"] },
  { code: "47750", name: "청송군", nameEn: "Cheongsong-gun", kind: "gun", source: ["37330"] },
  { code: "47760", name: "영양군", nameEn: "Yeongyang-gun", kind: "gun", source: ["37340"] },
  { code: "47770", name: "영덕군", nameEn: "Yeongdeok-gun", kind: "gun", source: ["37350"] },
  { code: "47820", name: "청도군", nameEn: "Cheongdo-gun", kind: "gun", source: ["37360"] },
  { code: "47830", name: "고령군", nameEn: "Goryeong-gun", kind: "gun", source: ["37370"] },
  { code: "47840", name: "성주군", nameEn: "Seongju-gun", kind: "gun", source: ["37380"] },
  { code: "47850", name: "칠곡군", nameEn: "Chilgok-gun", kind: "gun", source: ["37390"] },
  { code: "47900", name: "예천군", nameEn: "Yecheon-gun", kind: "gun", source: ["37400"] },
  { code: "47920", name: "봉화군", nameEn: "Bonghwa-gun", kind: "gun", source: ["37410"] },
  { code: "47930", name: "울진군", nameEn: "Uljin-gun", kind: "gun", source: ["37420"] },
  { code: "47940", name: "울릉군", nameEn: "Ulleung-gun", kind: "gun", source: ["37430"] },
];

const round = (value) => Number(value.toFixed(PRECISION));

/** Perpendicular distance from p to the segment a-b, in degrees. */
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Iterative Douglas-Peucker; recursion would overflow on the long rings. */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let maxDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = segmentDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Signed-area magnitude in square degrees; only used to rank rings. */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum) / 2;
}

/** Area-weighted centroid of a ring, falling back to its bbox center. */
function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/** Outer rings of a (Multi)Polygon geometry; holes are not rendered. */
function outerRings(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((polygon) => polygon[0]);
  }
  return [];
}

async function readSource(path) {
  if (path) return JSON.parse(readFileSync(path, "utf8"));
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`source fetch failed: ${response.status}`);
  return response.json();
}

const source = await readSource(process.argv[2]);
const byCode = new Map(
  source.features.map((feature) => [feature.properties.code, feature]),
);

const districts = DISTRICTS.map((district) => {
  const rings = district.source.flatMap((code) => {
    const feature = byCode.get(code);
    if (!feature) throw new Error(`missing source feature ${code}`);
    return outerRings(feature.geometry);
  });

  const ranked = rings
    .map((ring) => ({ ring, area: ringArea(ring) }))
    .sort((a, b) => b.area - a.area);
  const largest = ranked[0];
  const kept = ranked.filter((r) => r.area >= largest.area * MIN_RING_SHARE);

  // Two boxes, because they answer different questions. The focus box ignores
  // far-flung islets so "fly to this district" frames the inhabited body at a
  // useful zoom; the full box covers every ring, and it is what decides how
  // much terrain to load — Dokdo is Ulleung-gun and has to be on the map even
  // though framing the county on it would make Ulleungdo a speck.
  const focusRings = ranked.filter((r) => r.area >= largest.area * BBOX_RING_SHARE);
  const focusPoints = focusRings.flatMap((r) => r.ring);
  const lons = focusPoints.map((p) => p[0]);
  const lats = focusPoints.map((p) => p[1]);
  const centroid = ringCentroid(largest.ring);

  return {
    code: district.code,
    name: district.name,
    nameEn: district.nameEn,
    kind: district.kind,
    center: [round(centroid[0]), round(centroid[1])],
    bbox: [
      round(Math.min(...lons)),
      round(Math.min(...lats)),
      round(Math.max(...lons)),
      round(Math.max(...lats)),
    ],
    fullBbox: (() => {
      const all = kept.flatMap(({ ring }) => ring);
      return [
        round(Math.min(...all.map((p) => p[0]))),
        round(Math.min(...all.map((p) => p[1]))),
        round(Math.max(...all.map((p) => p[0]))),
        round(Math.max(...all.map((p) => p[1]))),
      ];
    })(),
    rings: kept.map(({ ring }) =>
      simplify(ring, TOLERANCE).flatMap((p) => [round(p[0]), round(p[1])]),
    ),
  };
});

// Province bbox over the mainland only: Ulleung-gun sits ~190 km offshore and
// would triple the terrain region the renderer has to cover.
const mainland = districts.filter((d) => d.code !== "47940");
const provinceBbox = [
  Math.min(...mainland.map((d) => d.bbox[0])),
  Math.min(...mainland.map((d) => d.bbox[1])),
  Math.max(...mainland.map((d) => d.bbox[2])),
  Math.max(...mainland.map((d) => d.bbox[3])),
];

mkdirSync(DATA_DIR, { recursive: true });

const provenance = {
  source: "\uD1B5\uACC4\uCCAD SGIS 2018 \uC2DC\uAD70\uAD6C \uACBD\uACC4 (WGS84)",
  sourceUrl: SOURCE_URL,
  note: "Generated by scripts/build-gyeongbuk-districts.mjs \u2014 do not edit by hand.",
};

writeFileSync(
  OUT_DISTRICTS,
  `${JSON.stringify(
    {
      ...provenance,
      provinceBbox: provinceBbox.map(round),
      districts: districts.map(({ rings, ...meta }) => meta),
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  OUT_BOUNDARIES,
  `${JSON.stringify(
    {
      ...provenance,
      toleranceDegrees: TOLERANCE,
      // Flattened [lon, lat, lon, lat, ...] per ring: ~40% smaller than nested
      // pairs once JSON-encoded, and it feeds the rasterizer without reshaping.
      rings: Object.fromEntries(districts.map((d) => [d.code, d.rings])),
    },
    null,
    0,
  )}\n`,
);

const vertices = districts.reduce(
  (sum, d) => sum + d.rings.reduce((n, r) => n + r.length / 2, 0),
  0,
);
console.log(
  `wrote ${OUT_DISTRICTS} and ${OUT_BOUNDARIES}\n  ${districts.length} districts, ` +
    `${vertices} vertices, province bbox ${provinceBbox.map((v) => v.toFixed(3)).join(", ")}`,
);
