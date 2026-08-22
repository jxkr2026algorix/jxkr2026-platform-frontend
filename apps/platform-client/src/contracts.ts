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
};

export const DEMO_LOCATION = {
  x: 0.52,
  y: 0.42,
  label: "Shared demo site, Jinbo-myeon, Cheongsong",
} as const;
