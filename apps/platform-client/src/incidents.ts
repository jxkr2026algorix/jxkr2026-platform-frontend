import { z } from "zod";
import {
  DEMO_LOCATION,
  type DisasterType,
  type EventDraft,
  mapPointSchema,
  type PlatformEvent,
} from "./contracts";

const incidentEvidenceSchema = z
  .object({
    source: z.string().optional(),
    mode: z.enum(["live", "training"]).optional(),
    map_origin: mapPointSchema.optional(),
    rainfall_mm_per_hour: z.number().min(0).max(120).optional(),
  })
  .loose();

export const backendIncidentSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  region_code: z.string(),
  region_name: z.string(),
  hazard: z.string(),
  hazard_korean: z.string().nullable().optional(),
  level: z.number().int().min(1).max(3),
  status: z.enum(["open", "monitoring", "closed"]),
  summary: z.string().nullable().optional(),
  declared_by: z.string(),
  declared_at: z.string(),
  opening_evidence: incidentEvidenceSchema.nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const incidentPageSchema = z.object({
  items: z.array(backendIncidentSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

type BackendIncident = z.infer<typeof backendIncidentSchema>;

const EVENT_COPY: Record<
  DisasterType,
  { readonly headline: string; readonly instruction: string }
> = {
  rain: {
    headline: "Heavy rain detected in Cheongsong",
    instruction: "Avoid rivers and low-lying areas. Follow live guidance.",
  },
  flood: {
    headline: "Flood risk detected in low-lying areas",
    instruction: "Leave underground spaces and prepare to move uphill.",
  },
  wildfire: {
    headline: "Wildfire detected near the shared demo site",
    instruction: "Follow the guided route away from the smoke.",
  },
  landslide: {
    headline: "Landslide risk has increased on steep slopes",
    instruction: "Avoid hillsides and valleys. Move to the assigned shelter.",
  },
  earthquake: {
    headline: "Earthquake detected in Gyeongsangbuk-do",
    instruction:
      "Protect your head, then move to an open area after shaking stops.",
  },
  typhoon: {
    headline: "The region has entered the typhoon impact zone",
    instruction: "Stay indoors and keep away from windows and falling objects.",
  },
  tsunami: {
    headline: "Tsunami response activated for the east coast",
    instruction: "Leave coastal areas and river mouths. Move to higher ground.",
  },
  heatwave: {
    headline: "Heatwave warning issued",
    instruction: "Limit outdoor activity and use the nearest cooling shelter.",
  },
  coldwave: {
    headline: "Cold wave response activated",
    instruction: "Limit outdoor activity and check water and heating systems.",
  },
  snow: {
    headline: "Heavy snow risk on mountain roads",
    instruction: "Avoid unnecessary travel and check road closure guidance.",
  },
  drought: {
    headline: "Drought response activated",
    instruction: "Check water-supply guidance and reduce water use.",
  },
  chemical: {
    headline: "Chemical incident response activated",
    instruction: "Move upwind and follow shelter-in-place guidance.",
  },
  nuclear: {
    headline: "Nuclear incident response activated",
    instruction: "Follow official guidance to shelter or prepare to evacuate.",
  },
};

export const SCENARIO_TO_HAZARD: Record<DisasterType, string> = {
  rain: "heavy_rain",
  flood: "flood",
  wildfire: "wildfire",
  landslide: "landslide",
  earthquake: "earthquake",
  typhoon: "typhoon",
  tsunami: "tsunami",
  heatwave: "heatwave",
  coldwave: "cold_wave",
  snow: "heavy_snow",
  drought: "drought",
  chemical: "chemical_accident",
  nuclear: "nuclear",
};

const HAZARD_TO_SCENARIO: Readonly<Record<string, DisasterType>> = {
  heavy_rain: "rain",
  flood: "flood",
  wildfire: "wildfire",
  landslide: "landslide",
  earthquake: "earthquake",
  typhoon: "typhoon",
  tsunami: "tsunami",
  heatwave: "heatwave",
  cold_wave: "coldwave",
  heavy_snow: "snow",
  drought: "drought",
  chemical_accident: "chemical",
  nuclear: "nuclear",
};

export function createIncidentPayload(draft: EventDraft, regionCode: string) {
  const copy = EVENT_COPY[draft.type];
  return {
    title: copy.headline,
    region_code: regionCode,
    hazard: SCENARIO_TO_HAZARD[draft.type],
    level: 1,
    summary: copy.instruction,
    opening_evidence: {
      source: "salgil-frontend",
      mode: draft.mode,
      ...(draft.location ? { map_origin: draft.location } : {}),
      ...(draft.rainfallMmPerHour === undefined
        ? {}
        : { rainfall_mm_per_hour: draft.rainfallMmPerHour }),
    },
  };
}

export function incidentToPlatformEvent(
  incident: BackendIncident,
): PlatformEvent | null {
  const type = HAZARD_TO_SCENARIO[incident.hazard];
  if (!type) return null;
  const copy = EVENT_COPY[type];
  const location =
    incident.opening_evidence?.map_origin ??
    (type === "wildfire" ? DEMO_LOCATION : undefined);
  return {
    id: incident.id,
    sequence: Date.parse(incident.updated_at),
    type,
    mode: incident.opening_evidence?.mode ?? "live",
    phase:
      incident.status === "closed"
        ? "resolved"
        : incident.status === "monitoring"
          ? "update"
          : "initial",
    presentation: ["wildfire", "flood", "landslide"].includes(type)
      ? "3d"
      : "2d",
    headline: incident.title || copy.headline,
    instruction: incident.summary ?? copy.instruction,
    createdAt: incident.declared_at,
    ...(location ? { location } : {}),
    ...(incident.opening_evidence?.rainfall_mm_per_hour === undefined
      ? {}
      : { rainfallMmPerHour: incident.opening_evidence.rainfall_mm_per_hour }),
  };
}
