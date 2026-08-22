/**
 * Sample routing data, shaped exactly like `POST /routing/evacuation` and
 * `GET /shelters`.
 *
 * It exists so the alert, risk-zone, shelter, and route displays can be
 * checked while the backend is unreachable. It is always labelled as sample
 * data on screen — the one thing worse than no route is a made-up one the
 * operator believes.
 *
 * Coordinates are real, around Jinbo-myeon in Cheongsong-gun.
 */

import type {
  PlatformEvent,
  RoutePlan,
  Shelter,
} from "@salgil/platform-client";

/** A circle as a polygon ring; the zone contract has no radius form. */
function circle(
  lat: number,
  lon: number,
  radiusMeters: number,
  segments = 48,
): { lat: number; lon: number }[] {
  const latDegrees = radiusMeters / 110574;
  const lonDegrees = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return {
      lat: lat + Math.sin(angle) * latDegrees,
      lon: lon + Math.cos(angle) * lonDegrees,
    };
  });
}

/**
 * Predicted hazard areas. `origin` is what the badge runs the simulation
 * from, so it sits where the model expects the hazard to start rather than at
 * the centre of the drawn circle.
 */
export const DEMO_ZONES: NonNullable<PlatformEvent["zones"]> = [
  {
    id: "demo-landslide",
    label: "Slope failure risk · Jinbo-myeon",
    hazard: "landslide",
    severity: "warning",
    origin: { lat: 36.5031, lon: 129.0361 },
    polygon: circle(36.503, 129.038, 2600),
  },
  {
    id: "demo-wildfire",
    label: "Wildfire spread forecast",
    hazard: "wildfire",
    severity: "watch",
    origin: { lat: 36.5295, lon: 129.0742 },
    polygon: circle(36.528, 129.072, 3100),
  },
];

export const DEMO_SHELTERS: Shelter[] = [
  {
    id: "demo-shelter-jinbo",
    region_code: "47750",
    name: "Jinbo Sports Center",
    address: "Jinbo-myeon, Cheongsong-gun",
    lat: 36.5138,
    lon: 129.0521,
    capacity: 420,
    capacity_basis: "annual_file",
    hazards: ["wildfire", "landslide", "flood"],
    facility_type: "gymnasium",
    distance_km: 2.1,
    source_attribution: "Sample data",
    data_mode: "synthetic",
  },
  {
    id: "demo-shelter-bunam",
    region_code: "47750",
    name: "Bunam Community Center",
    address: "Bunam-myeon, Cheongsong-gun",
    lat: 36.4795,
    lon: 129.0608,
    capacity: 120,
    capacity_basis: "annual_file",
    hazards: ["wildfire", "landslide"],
    facility_type: "community_hall",
    distance_km: 4.4,
    source_attribution: "Sample data",
    data_mode: "synthetic",
  },
];

export const DEMO_ROUTE_PLAN: RoutePlan = {
  origin: { lat: 36.5012, lon: 129.0332, community_name: "Sangchon" },
  hazard: "landslide",
  mode: "foot",
  mode_name: "도보",
  mode_note: null,
  routes: [
    {
      shelter_id: "demo-shelter-jinbo",
      shelter_name: "Jinbo Sports Center",
      shelter_capacity: 420,
      capacity_basis: "annual_file",
      found: true,
      reason: null,
      geometry: [
        [129.0332, 36.5012],
        [129.0405, 36.5061],
        [129.0472, 36.5104],
        [129.0521, 36.5138],
      ],
      distance_m: 2480,
      duration_minutes: 31,
      straight_line_km: 1.9,
      max_risk: 0.34,
      mean_risk: 0.12,
      avoided_edges: 7,
      blocked_by_reports: [],
    },
    {
      shelter_id: "demo-shelter-bunam",
      shelter_name: "Bunam Community Center",
      shelter_capacity: 120,
      capacity_basis: "annual_file",
      found: false,
      reason: "Road 12 is closed by a confirmed field report",
      geometry: [],
      distance_m: null,
      duration_minutes: null,
      straight_line_km: 4.4,
      max_risk: null,
      mean_risk: null,
      avoided_edges: 12,
      blocked_by_reports: [
        {
          kind: "road_closure",
          lat: 36.4922,
          lon: 129.0427,
          radius_m: 300,
          detail: "Road 12 closed",
        },
      ],
    },
  ],
  recommended: "demo-shelter-jinbo",
  prediction_used: true,
  prediction_model: "sample",
  prediction_is_stub: true,
  horizons_minutes: [30, 60, 120],
  field_reports_applied: 1,
  road_network: "sample",
  attribution: "© OpenStreetMap contributors, ODbL 1.0",
  is_derived: true,
  notice:
    "이 경로는 도로망과 모델 예측으로 계산한 제안입니다. 실시간 통제와 현장 상황이 모두 반영된 것이 아니며, 공식 안전경로가 아닙니다. 이동 전 담당자가 확인해야 합니다.",
  warnings: [],
  generated_at: "2026-08-22T14:10:00Z",
};

/**
 * The alert the dashboard raises alongside the sample plan. Carries the same
 * zones, so the panel that reads `event.zones` and the map draw the one set.
 */
export const DEMO_EVENT: PlatformEvent = {
  id: "demo-landslide-alert",
  sequence: 1,
  type: "landslide",
  mode: "live",
  phase: "initial",
  presentation: "3d",
  headline: "Slope failure risk rising in Jinbo-myeon, Cheongsong",
  instruction:
    "Move away from slopes and valley floors, and follow the suggested route to the nearest reachable shelter.",
  createdAt: "2026-08-22T14:10:00Z",
  rainfallMmPerHour: 72,
  zones: DEMO_ZONES,
};
