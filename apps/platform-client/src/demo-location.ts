/**
 * Where the resident is standing, for a build with no GPS fix.
 *
 * The prototype has no geolocation, so every phone reported the same point.
 * With one shared coordinate the demo looks like one person; scattering the
 * spawn near the incident makes the several-people case visible — which is the
 * case the evacuation order is actually about.
 *
 * **This is a demo position, not a fix.** A real build reads geolocation, and
 * the label says so on screen so nobody reads it as where someone is.
 *
 * Deterministic per incident: the same incident always spawns the same point.
 * A position that moved between renders would drag the route and the map marker
 * with it, and a resident watching the screen would see the plan change for no
 * reason.
 */

/** Metres from the incident. Close enough to be affected, far enough to move. */
const MIN_DISTANCE_M = 500;
const MAX_DISTANCE_M = 1800;

const METRES_PER_DEGREE_LAT = 111_320;

export interface DemoOrigin {
  readonly lat: number;
  readonly lon: number;
  readonly label: string;
  /** Metres from the incident, so the label can say how close this is. */
  readonly distanceM: number | null;
}

/**
 * 32-bit string hash with an avalanche step. Stable across reloads, which is
 * the whole point.
 *
 * The final mix matters here: incident ids run in sequence (`…-01`, `…-02`),
 * and without it the low bits barely move, so consecutive incidents spawned
 * residents on the same side of the fire.
 */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

/** Two independent [0, 1) draws from one seed. */
function draws(seed: string): readonly [number, number] {
  const first = hash(seed);
  const second = hash(`${seed}:${first}`);
  return [first / 0x100000000, second / 0x100000000];
}

export function demoOriginNear(
  incident: { readonly lat: number; readonly lon: number } | undefined,
  seed: string,
  fallback: {
    readonly lat: number;
    readonly lon: number;
    readonly label: string;
  },
): DemoOrigin {
  if (
    !incident ||
    !Number.isFinite(incident.lat) ||
    !Number.isFinite(incident.lon)
  ) {
    return { ...fallback, distanceM: null };
  }

  const [bearingDraw, distanceDraw] = draws(seed);
  const bearing = bearingDraw * 2 * Math.PI;
  // Square-root keeps the draw uniform over the ring rather than clustering it
  // at the inner edge, so repeated demos do not all start the same distance out.
  const distance =
    MIN_DISTANCE_M +
    Math.sqrt(distanceDraw) * (MAX_DISTANCE_M - MIN_DISTANCE_M);

  const northM = Math.cos(bearing) * distance;
  const eastM = Math.sin(bearing) * distance;

  const lat = incident.lat + northM / METRES_PER_DEGREE_LAT;
  const lonScale = Math.max(Math.cos((incident.lat * Math.PI) / 180), 1e-6);
  const lon = incident.lon + eastM / (METRES_PER_DEGREE_LAT * lonScale);

  return {
    lat,
    lon,
    label: `Demo location · ${(distance / 1000).toFixed(1)}km from the incident`,
    distanceM: Math.round(distance),
  };
}
