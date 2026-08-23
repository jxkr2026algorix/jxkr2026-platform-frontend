/**
 * Current weather for one district (`GET /situation/weather`).
 *
 * This replaces the demo table the console used to carry. The values come from
 * KMA observations through the backend, and three things about them matter on
 * screen:
 *
 * - a missing value is `null`, never `0`. No rainfall reading and 0 mm of
 *   rainfall are different facts, and a failed lookup must not read as clear
 *   weather.
 * - `state` distinguishes "read it" from "could not read it". `UNVERIFIED`
 *   must not be painted as fine.
 * - `attribution` is the KOGL source line and has to stay visible.
 */

import { z } from "zod";

export const weatherReadingSchema = z.object({
  kind: z.string(),
  value: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  station: z.string().nullable().default(null),
  observed_at: z.string().nullable().default(null),
  is_forecast: z.boolean().default(false),
  stale: z.boolean().default(false),
});

export const weatherSnapshotSchema = z.object({
  region: z.object({
    code: z.string().nullable().default(null),
    name: z.string().nullable().default(null),
  }),
  state: z.enum(["DATA", "NONE", "UNVERIFIED"]),
  readings: z.array(weatherReadingSchema).default([]),
  temperature_c: z.number().nullable().default(null),
  humidity_pct: z.number().nullable().default(null),
  wind_speed_ms: z.number().nullable().default(null),
  wind_direction_deg: z.number().nullable().default(null),
  rainfall_1h_mm: z.number().nullable().default(null),
  observed_at: z.string().nullable().default(null),
  stale: z.boolean().default(false),
  caveats: z.array(z.string()).default([]),
  attribution: z.string().nullable().default(null),
  source_url: z.string().nullable().default(null),
  fetched_at: z.string(),
});

export type WeatherReading = z.infer<typeof weatherReadingSchema>;
export type WeatherSnapshot = z.infer<typeof weatherSnapshotSchema>;

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

/** Compass point for a bearing in degrees. `null` in, `null` out. */
export function compassPoint(degrees: number | null): string | null {
  if (degrees === null || Number.isNaN(degrees)) return null;
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[index] ?? null;
}

/**
 * Wind as one string, e.g. `SSW 0.4m/s`. Returns `null` rather than a partial
 * string when the speed is missing: "SSW —" reads as a measurement that is not
 * one.
 */
export function formatWind(
  speedMs: number | null,
  directionDeg: number | null,
): string | null {
  if (speedMs === null) return null;
  const point = compassPoint(directionDeg);
  const speed = `${speedMs.toFixed(1)}m/s`;
  return point ? `${point} ${speed}` : speed;
}
