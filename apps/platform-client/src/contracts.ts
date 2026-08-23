import { z } from "zod";

export const disasterTypes = [
  "rain",
  "flood",
  "wildfire",
  "landslide",
  "earthquake",
  "typhoon",
  "tsunami",
  "heatwave",
  "coldwave",
  "snow",
  "drought",
  "chemical",
  "nuclear",
] as const;

export type DisasterType = (typeof disasterTypes)[number];
export type IncidentMode = "live" | "training";

export const mapPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: z.string(),
});

export const riskZoneSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  hazard: z.string().optional(),
  severity: z.enum(["none", "advisory", "watch", "warning"]).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  polygon: z.array(
    z.union([
      z.object({ x: z.number(), y: z.number() }),
      z.object({ lat: z.number(), lon: z.number() }),
    ]),
  ),
  /**
   * Predicted point of origin. Activating the zone on the map runs the
   * simulation from here, so this is where a prediction becomes a scenario.
   */
  origin: z
    .union([
      z.object({ x: z.number(), y: z.number() }),
      z.object({ lat: z.number(), lon: z.number() }),
    ])
    .optional(),
  /** False for a read-only annotation, e.g. a confirmed road closure. */
  activatable: z.boolean().optional(),
});

export const platformEventSchema = z.object({
  id: z.string(),
  sequence: z.number().int().nonnegative(),
  type: z.enum(disasterTypes),
  mode: z.enum(["live", "training"]),
  phase: z.enum(["initial", "update", "resolved"]),
  presentation: z.enum(["2d", "3d"]),
  headline: z.string(),
  instruction: z.string(),
  createdAt: z.string(),
  location: mapPointSchema.optional(),
  /**
   * Where the incident actually is. `location` is a normalized viewport point,
   * which an incident raised outside this browser — from the assistant, or
   * another console — has no way to produce.
   */
  at: z.object({ lat: z.number(), lon: z.number() }).optional(),
  /**
   * A drill. Carried on the event, not only on the live stream: a phone that
   * scans the QR after the exercise starts learns about it by polling, and a
   * drill that reads as real teaches people to ignore the next one.
   */
  drill: z.boolean().optional(),
  rainfallMmPerHour: z.number().min(0).max(120).optional(),
  zones: z.array(riskZoneSchema).optional(),
});

export type PlatformEvent = z.infer<typeof platformEventSchema>;

export const mobileSessionSchema = z.object({
  id: z.string(),
  currentLocation: mapPointSchema,
  shelter: mapPointSchema,
  route: z.array(mapPointSchema).min(2),
  riskZones: z.array(riskZoneSchema),
  caution: z.string(),
  estimatedMinutes: z.number().int().positive(),
});

export type MobileSession = z.infer<typeof mobileSessionSchema>;

export const platformMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disaster.event"), event: platformEventSchema }),
  z.object({ kind: z.literal("incident.clear") }),
  z.object({
    kind: z.literal("control.sync"),
    mode: z.enum(["live", "training"]),
    selectedType: z.enum(disasterTypes),
  }),
]);

export type PlatformMessage = z.infer<typeof platformMessageSchema>;

export type EventDraft = {
  readonly type: DisasterType;
  readonly mode: IncidentMode;
  readonly location?: z.infer<typeof mapPointSchema>;
  readonly rainfallMmPerHour?: number;
  /**
   * The 시군구 the incident belongs to, when it is not the county this console
   * was configured for. An incident raised from the assistant names its own
   * place, and filing it under the console's home county puts it on the wrong
   * side of the province.
   */
  readonly regionCode?: string;
  /**
   * Where it actually is. Without this the event reaches the map with no
   * coordinates at all, and the demo fallback moves it to the sample site.
   */
  readonly at?: { readonly lat: number; readonly lon: number };
  /** Headline naming the place, when the caller resolved one. */
  readonly headline?: string;
};

export const DEMO_LOCATION = {
  x: 0.52,
  y: 0.42,
  label: "Shared demo site, Jinbo-myeon, Cheongsong",
} as const;
