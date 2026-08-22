/**
 * Shelters and evacuation routing (`GET /shelters`, `POST /routing/evacuation`).
 *
 * Two constraints from the backend's data contract carry into every consumer
 * of these types, and the UI has to honour both:
 *
 *  - A route is a **suggestion**, never an official safe route. `notice` and
 *    `attribution` must reach the screen; `isDerived` must not be dropped.
 *  - `capacity` comes from an annually refreshed file. It is not live
 *    occupancy, so it is only ever shown together with `capacityBasis`.
 */

import { z } from "zod";

/** Walking is the default: it needs the fewest assumptions about the road. */
export const transportModes = ["foot", "assisted", "bicycle", "car"] as const;
export type TransportMode = (typeof transportModes)[number];

export const shelterSchema = z.object({
  id: z.string(),
  region_code: z.string(),
  name: z.string(),
  address: z.string().nullish(),
  lat: z.number().nullish(),
  lon: z.number().nullish(),
  capacity: z.number().nullish(),
  /** Provenance of `capacity`. "annual_file" means it is not live occupancy. */
  capacity_basis: z.string().nullish(),
  /** Hazards this facility covers. Never reuse a shelter for another hazard. */
  hazards: z.array(z.string()),
  facility_type: z.string().nullish(),
  distance_km: z.number().nullish(),
  source_attribution: z.string().nullish(),
  data_mode: z.string().default("synthetic"),
});

export type Shelter = z.infer<typeof shelterSchema>;

const blockedSegmentSchema = z.object({
  kind: z.string(),
  lat: z.number(),
  lon: z.number(),
  radius_m: z.number(),
  detail: z.string().nullish(),
});

export const routeLegSchema = z.object({
  shelter_id: z.string(),
  shelter_name: z.string(),
  shelter_capacity: z.number().nullish(),
  capacity_basis: z.string().nullish(),
  found: z.boolean(),
  /** Why no route exists. "no shelter nearby" and "all roads blocked" differ. */
  reason: z.string().nullish(),
  /** GeoJSON LineString coordinates, [[lon, lat], ...]. */
  geometry: z.array(z.array(z.number())).default([]),
  distance_m: z.number().nullish(),
  duration_minutes: z.number().nullish(),
  straight_line_km: z.number().nullish(),
  /** Peak risk along the route, measured at the time of passage. */
  max_risk: z.number().nullish(),
  mean_risk: z.number().nullish(),
  avoided_edges: z.number().default(0),
  blocked_by_reports: z.array(blockedSegmentSchema).default([]),
});

export type RouteLeg = z.infer<typeof routeLegSchema>;

export const routePlanSchema = z.object({
  origin: z.looseObject({
    lat: z.number().nullish(),
    lon: z.number().nullish(),
    community_name: z.string().nullish(),
  }),
  hazard: z.string(),
  mode: z.string(),
  mode_name: z.string(),
  mode_note: z.string().nullish(),
  /** Ordered by arrival time; unreachable shelters stay in with a reason. */
  routes: z.array(routeLegSchema),
  recommended: z.string().nullish(),
  prediction_used: z.boolean().default(false),
  prediction_model: z.string().nullish(),
  /** True when the model is a stub — the route is illustrative, not predictive. */
  prediction_is_stub: z.boolean().default(false),
  horizons_minutes: z.array(z.number()).default([]),
  /** Field reports beat predictions: these are confirmed closures, not odds. */
  field_reports_applied: z.number().default(0),
  road_network: z.string().nullish(),
  attribution: z.string(),
  is_derived: z.boolean().default(true),
  /** Must be shown. The route is a suggestion, not an official safe route. */
  notice: z.string(),
  warnings: z.array(z.string()).default([]),
  generated_at: z.string(),
});

export type RoutePlan = z.infer<typeof routePlanSchema>;

export interface RouteRequest {
  readonly hazard: string;
  readonly lat?: number;
  readonly lon?: number;
  readonly communityId?: string;
  readonly mode?: TransportMode;
  readonly incidentId?: string;
  readonly maxShelters?: number;
  /**
   * Horizons the prediction is sampled at. These must span the time the
   * evacuation itself takes, or the route is planned against stale risk.
   */
  readonly horizonsMinutes?: readonly number[];
  readonly departAfterMinutes?: number;
}

/** Request body in the backend's snake_case, omitting unset fields. */
export function toRouteRequestBody(
  request: RouteRequest,
): Record<string, unknown> {
  return {
    hazard: request.hazard,
    mode: request.mode ?? "foot",
    ...(request.communityId ? { community_id: request.communityId } : {}),
    ...(request.lat !== undefined ? { lat: request.lat } : {}),
    ...(request.lon !== undefined ? { lon: request.lon } : {}),
    ...(request.incidentId ? { incident_id: request.incidentId } : {}),
    ...(request.maxShelters ? { max_shelters: request.maxShelters } : {}),
    ...(request.horizonsMinutes
      ? { horizons_minutes: [...request.horizonsMinutes] }
      : {}),
    ...(request.departAfterMinutes !== undefined
      ? { depart_after_minutes: request.departAfterMinutes }
      : {}),
  };
}

/** The leg the plan recommends, or the first reachable one. */
export function recommendedLeg(plan: RoutePlan): RouteLeg | undefined {
  const byId = plan.routes.find(
    (leg) => leg.shelter_id === plan.recommended && leg.found,
  );
  return byId ?? plan.routes.find((leg) => leg.found);
}
