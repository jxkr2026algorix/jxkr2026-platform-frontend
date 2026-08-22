import {
  cameraForBbox,
  districtByCode,
} from "@salgil/map-webgpu-canvas/districts";
import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";
import {
  type DisasterType,
  type PlatformClient,
  type PlatformEvent,
  type RoutePlan,
  recommendedLeg,
  SCENARIO_TO_HAZARD,
  type Shelter,
  type TransportMode,
  transportModes,
} from "@salgil/platform-client";
import { useState } from "react";
import {
  DEMO_EVENT,
  DEMO_ROUTE_PLAN,
  DEMO_SHELTERS,
  DEMO_ZONES,
} from "../demo-evacuation";

interface EvacuationPanelProps {
  readonly client: PlatformClient;
  readonly hazardType: DisasterType;
  readonly districtCode: string | null;
  readonly onMapCommand: (command: DashboardCommand) => void;
  /** Raises an alert locally, for checking the display without a backend. */
  readonly onPreviewEvent: (event: PlatformEvent | null) => void;
}

const modeLabels: Record<TransportMode, string> = {
  foot: "On foot",
  assisted: "Assisted",
  bicycle: "Bicycle",
  car: "Car",
};

/** Origin for the plan: the focused district's surveyed centroid. */
function originFor(districtCode: string | null): {
  lat: number;
  lon: number;
  label: string;
} {
  const district = districtCode ? districtByCode(districtCode) : undefined;
  if (!district) {
    // Cheongsong: the shared demo site the rest of the prototype uses.
    return { lat: 36.4361, lon: 129.0572, label: "Cheongsong-gun" };
  }
  return {
    lat: district.center[1],
    lon: district.center[0],
    label: district.nameEn,
  };
}

/** A blocked-segment radius as a polygon ring, for the zone layer. */
function closureRing(
  lat: number,
  lon: number,
  radiusMeters: number,
): { lat: number; lon: number }[] {
  const latDegrees = radiusMeters / 110574;
  const lonDegrees = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    return {
      lat: lat + Math.sin(angle) * latDegrees,
      lon: lon + Math.cos(angle) * lonDegrees,
    };
  });
}

const formatMinutes = (value: number | null | undefined): string =>
  value === null || value === undefined ? "—" : `${Math.round(value)} min`;

const formatKm = (metres: number | null | undefined): string =>
  metres === null || metres === undefined
    ? "—"
    : `${(metres / 1000).toFixed(1)} km`;

/**
 * Evacuation routing (`POST /routing/evacuation`) and the shelters it chose
 * between (`GET /shelters`).
 *
 * The backend is explicit that a computed route is a suggestion, not an
 * official safe route, so the plan's `notice` and OSM `attribution` are
 * rendered with the result and the line is drawn in the advisory style rather
 * than a confident "this way is safe" green.
 */
export function EvacuationPanel({
  client,
  hazardType,
  districtCode,
  onMapCommand,
  onPreviewEvent,
}: EvacuationPanelProps) {
  const [mode, setMode] = useState<TransportMode>("foot");
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  const hazard = SCENARIO_TO_HAZARD[hazardType];
  const origin = originFor(districtCode);

  const draw = (
    next: RoutePlan,
    shelters: Shelter[],
    zones: NonNullable<PlatformEvent["zones"]>,
  ) => {
    // Frame what is actually drawn. The district centroid is not it: a plan
    // can sit 15 km from the centre of its own county and land off screen.
    const seen: { lat: number; lon: number }[] = [
      { lat: origin.lat, lon: origin.lon },
    ];
    for (const zone of zones) {
      for (const point of zone.polygon) {
        // Normalized {x,y} vertices carry no geography, so only real
        // coordinates contribute to the framing box.
        if ("lat" in point && "lon" in point) {
          seen.push({ lat: point.lat, lon: point.lon });
        }
      }
    }
    for (const leg of next.routes) {
      for (const [lon, lat] of leg.geometry) {
        if (lat !== undefined && lon !== undefined) seen.push({ lat, lon });
      }
    }
    for (const shelter of shelters) {
      if (typeof shelter.lat === "number" && typeof shelter.lon === "number") {
        seen.push({ lat: shelter.lat, lon: shelter.lon });
      }
    }

    onMapCommand({
      type: "map:set-zones",
      // Rebuilt rather than spread: the platform types every optional field
      // as `| undefined`, which exactOptionalPropertyTypes rejects.
      payload: {
        zones: zones.map((zone) => ({
          id: zone.id,
          polygon: zone.polygon,
          ...(zone.label !== undefined ? { label: zone.label } : {}),
          ...(zone.hazard !== undefined ? { hazard: zone.hazard } : {}),
          ...(zone.severity !== undefined ? { severity: zone.severity } : {}),
          ...(zone.color !== undefined ? { color: zone.color } : {}),
          ...(zone.origin !== undefined ? { origin: zone.origin } : {}),
          ...(zone.activatable !== undefined
            ? { activatable: zone.activatable }
            : {}),
        })),
      },
    });
    onMapCommand({
      type: "map:set-markers",
      payload: {
        markers: [
          {
            id: "route-origin",
            at: { lat: origin.lat, lon: origin.lon },
            label: origin.label,
            kind: "community",
            selected: true,
          },
          ...shelters
            .filter((s) => s.lat !== null && s.lat !== undefined && s.lon)
            .map((s) => ({
              id: s.id,
              at: { lat: s.lat as number, lon: s.lon as number },
              label: s.name,
              kind: "shelter" as const,
            })),
        ],
      },
    });
    onMapCommand({
      type: "map:set-routes",
      payload: {
        routes: next.routes
          .filter((leg) => leg.found && leg.geometry.length >= 2)
          .map((leg) => ({
            id: leg.shelter_id,
            // GeoJSON is [lon, lat]; the map takes real coordinates directly.
            path: leg.geometry.map(([lon, lat]) => ({
              lat: lat ?? 0,
              lon: lon ?? 0,
            })),
            label: `${leg.shelter_name} · ${formatMinutes(leg.duration_minutes)}`,
            // "advised", never "open": an unverified route must not read as
            // an official safe route.
            state: "advised" as const,
          })),
      },
    });
    const framing = cameraForBbox(
      [
        Math.min(...seen.map((p) => p.lon)),
        Math.min(...seen.map((p) => p.lat)),
        Math.max(...seen.map((p) => p.lon)),
        Math.max(...seen.map((p) => p.lat)),
      ],
      40,
      0.7,
    );
    onMapCommand({
      type: "map:set-camera",
      payload: {
        center: { lat: framing.lat, lon: framing.lon },
        distanceMeters: framing.distanceMeters,
      },
    });
  };

  const runPlan = async () => {
    setPending(true);
    setError("");
    setPreview(false);
    try {
      const [next, shelters] = await Promise.all([
        client.planEvacuation({
          hazard,
          lat: origin.lat,
          lon: origin.lon,
          mode,
        }),
        client
          .findShelters({ hazard, lat: origin.lat, lon: origin.lon, limit: 8 })
          .catch(() => [] as Shelter[]),
      ]);
      setPlan(next);
      // Confirmed closures are facts, not forecasts, so they are drawn as
      // solid warning areas rather than dashed predictions.
      draw(
        next,
        shelters,
        next.routes.flatMap((leg) =>
          leg.blocked_by_reports.map((block, index) => ({
            id: `${leg.shelter_id}-block-${index}`,
            label: block.detail ?? "Access blocked",
            hazard: block.kind,
            severity: "warning" as const,
            activatable: false,
            polygon: closureRing(block.lat, block.lon, block.radius_m),
          })),
        ),
      );
    } catch (cause) {
      setPlan(null);
      setError(
        "Could not reach the routing service. Use sample data to check the display.",
      );
      console.warn("evacuation routing failed", cause);
    } finally {
      setPending(false);
    }
  };

  const runPreview = () => {
    setError("");
    setPreview(true);
    setPlan(DEMO_ROUTE_PLAN);
    // The alert banner reads the platform event, so the preview raises one
    // too — otherwise the map fills in while the dashboard stays silent.
    onPreviewEvent(DEMO_EVENT);
    draw(DEMO_ROUTE_PLAN, DEMO_SHELTERS, DEMO_ZONES);
  };

  const clear = () => {
    setPlan(null);
    if (preview) onPreviewEvent(null);
    setPreview(false);
    setError("");
    onMapCommand({ type: "map:set-zones", payload: { zones: [] } });
    onMapCommand({ type: "map:set-routes", payload: { routes: [] } });
    onMapCommand({ type: "map:set-markers", payload: { markers: [] } });
  };

  const best = plan ? recommendedLeg(plan) : undefined;
  const unreachable = plan?.routes.filter((leg) => !leg.found) ?? [];

  return (
    <section className="rail-section evacuation-panel">
      <div className="rail-title">
        <p className="rail-section-label">Evacuation routing</p>
        <span>{origin.label}</span>
      </div>

      <fieldset className="compact-controls">
        <legend>Transport</legend>
        <div className="segmented-track">
          {transportModes.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              <span className="segmented-label">{modeLabels[option]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="evacuation-actions">
        <button
          className="button"
          type="button"
          disabled={pending}
          onClick={() => void runPlan()}
        >
          {pending ? "Planning…" : "Plan routes"}
        </button>
        <button className="button secondary" type="button" onClick={runPreview}>
          Sample data
        </button>
        {plan ? (
          <button className="button secondary" type="button" onClick={clear}>
            Clear
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="evacuation-error" role="alert">
          {error}
        </p>
      ) : null}

      {plan ? (
        <div className="evacuation-result">
          {preview ? (
            <p className="evacuation-flag">
              Sample data — not from the routing service.
            </p>
          ) : null}

          {best ? (
            <dl className="evacuation-metrics">
              <div>
                <dt>Nearest reachable shelter</dt>
                <dd>{best.shelter_name}</dd>
              </div>
              <div>
                <dt>Travel</dt>
                <dd>
                  {formatMinutes(best.duration_minutes)} ·{" "}
                  {formatKm(best.distance_m)}
                </dd>
              </div>
              <div>
                <dt>Peak risk on route</dt>
                <dd>
                  {best.max_risk === null || best.max_risk === undefined
                    ? "—"
                    : best.max_risk.toFixed(2)}
                </dd>
              </div>
              {best.shelter_capacity !== null &&
              best.shelter_capacity !== undefined ? (
                <div>
                  <dt>Capacity</dt>
                  {/* Never shown alone: an annual file is not live occupancy. */}
                  <dd>
                    {best.shelter_capacity}
                    <small>
                      {best.capacity_basis === "annual_file"
                        ? " · annual file, not live occupancy"
                        : best.capacity_basis
                          ? ` · ${best.capacity_basis}`
                          : ""}
                    </small>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="evacuation-flag" role="status">
              No reachable shelter was found.
            </p>
          )}

          {unreachable.length > 0 ? (
            <ul className="evacuation-blocked">
              {unreachable.map((leg) => (
                <li key={leg.shelter_id}>
                  <strong>{leg.shelter_name}</strong>
                  <span>{leg.reason ?? "Unreachable"}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {plan.field_reports_applied > 0 ? (
            <p className="evacuation-note">
              {plan.field_reports_applied} confirmed closure
              {plan.field_reports_applied === 1 ? "" : "s"} from field reports
              applied.
            </p>
          ) : null}
          {plan.prediction_is_stub ? (
            <p className="evacuation-note is-warning">
              Prediction model is a stub — treat spread as illustrative.
            </p>
          ) : null}
          {plan.warnings.map((warning) => (
            <p className="evacuation-note is-warning" key={warning}>
              {warning}
            </p>
          ))}

          {/* Required by the data contract; do not remove. */}
          <p className="evacuation-notice">{plan.notice}</p>
          <p className="evacuation-attribution">{plan.attribution}</p>
        </div>
      ) : null}
    </section>
  );
}
