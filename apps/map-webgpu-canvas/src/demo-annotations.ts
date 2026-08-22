/**
 * Dev fixture for the annotation overlay, loaded with `?demo=annotations`.
 *
 * Real coordinates around Jinbo-myeon, Cheongsong-gun, so it also exercises
 * the `{lat, lon}` path rather than only normalized points. Delete this file
 * once the platform stream carries markers and routes.
 */

import type { MapMarker, MapRoute, RiskZone } from "./protocol";

/** A circle as a polygon ring, since the protocol has no radius form. */
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

export const DEMO_ZONES: RiskZone[] = [
  {
    id: "demo-landslide",
    label: "Landslide risk · Jinbo-myeon, Cheongsong",
    hazard: "landslide",
    severity: "warning",
    polygon: circle(36.503, 129.038, 2600),
  },
  {
    id: "demo-wildfire",
    label: "Wildfire spread forecast",
    hazard: "wildfire",
    severity: "watch",
    polygon: circle(36.528, 129.072, 3100),
  },
];

export const DEMO_MARKERS: MapMarker[] = [
  {
    id: "demo-sangchon",
    at: { lat: 36.5012, lon: 129.0332 },
    label: "Sangchon Village",
    kind: "community",
    selected: true,
  },
  {
    id: "demo-jinbo",
    at: { lat: 36.5138, lon: 129.0521 },
    label: "Jinbo Gymnasium",
    kind: "shelter",
  },
  {
    id: "demo-bunam",
    at: { lat: 36.4795, lon: 129.0608 },
    label: "Bunam Community Hall",
    kind: "shelter",
  },
  {
    id: "demo-staging",
    at: { lat: 36.4931, lon: 129.0812 },
    label: "Cheongsong Forward Command",
    kind: "responder",
  },
];

export const DEMO_ROUTES: MapRoute[] = [
  {
    id: "demo-route-open",
    label: "Evacuation route · 12 min",
    state: "open",
    path: [
      { lat: 36.5012, lon: 129.0332 },
      { lat: 36.5061, lon: 129.0405 },
      { lat: 36.5104, lon: 129.0472 },
      { lat: 36.5138, lon: 129.0521 },
    ],
  },
  {
    id: "demo-route-blocked",
    label: "Road 12 closed",
    state: "blocked",
    path: [
      { lat: 36.4968, lon: 129.0349 },
      { lat: 36.4922, lon: 129.0427 },
      { lat: 36.4901, lon: 129.0508 },
    ],
  },
];
