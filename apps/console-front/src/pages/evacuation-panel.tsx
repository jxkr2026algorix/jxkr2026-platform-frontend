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
  SCENARIO_TO_HAZARD,
  type Shelter,
  type TransportMode,
} from "@salgil/platform-client";
import { useState } from "react";
import {
  DEMO_EVENT,
  DEMO_ROUTE_PLAN,
  DEMO_SHELTERS,
  DEMO_ZONES,
} from "../demo-evacuation";
import { useI18n } from "../i18n";
import { EvacuationControls } from "./_components/EvacuationControls";
import { EvacuationResult } from "./_components/EvacuationResult";
import { closureRing, districtAt, originFor } from "./evacuation-map";

interface EvacuationPanelProps {
  readonly client: PlatformClient;
  readonly hazardType: DisasterType;
  readonly districtCode: string | null;
  readonly onMapCommand: (command: DashboardCommand) => void;
  /** Raises an alert locally, for checking the display without a backend. */
  readonly onPreviewEvent: (event: PlatformEvent | null) => void;
}

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
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<TransportMode>("foot");
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);

  const hazard = SCENARIO_TO_HAZARD[hazardType];
  const origin = originFor(districtCode);
  let originLabel = origin.label;
  if (locale === "ko") {
    originLabel = districtCode
      ? (districtByCode(districtCode)?.name ?? "청송군")
      : "청송군";
  }

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
            label: `${leg.shelter_name} · ${
              leg.duration_minutes === null ||
              leg.duration_minutes === undefined
                ? "—"
                : t("route.minutes", {
                    count: Math.round(leg.duration_minutes),
                  })
            }`,
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
          // Stub-mode risk is not on the model's scale, and at the default
          // threshold it marks every road impassable. Remove once a
          // calibrated model is serving.
          blockThreshold: 0.8,
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
      if (!(cause instanceof Error)) throw cause;
      setPlan(null);
      setError(t("route.serviceError"));
      console.warn("evacuation routing failed", cause);
    } finally {
      setPending(false);
    }
  };

  const runPreview = () => {
    setError("");
    setPreview(true);
    setPlan(DEMO_ROUTE_PLAN);
    // Move the selector to the district the sample sits in, so the rail and
    // the map agree about where the operator is looking.
    const home = districtAt(36.5012, 129.0332);
    if (home && home !== districtCode) {
      onMapCommand({ type: "map:focus-district", payload: { code: home } });
    }
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

  return (
    <section className="rail-section evacuation-panel">
      <div className="rail-title">
        <p className="rail-section-label">{t("route.title")}</p>
        <span>{originLabel}</span>
      </div>

      <EvacuationControls
        mode={mode}
        pending={pending}
        hasPlan={plan !== null}
        onModeChange={setMode}
        onPlan={() => void runPlan()}
        onPreview={runPreview}
        onClear={clear}
      />

      {error ? (
        <p className="evacuation-error" role="alert">
          {error}
        </p>
      ) : null}

      {plan ? <EvacuationResult plan={plan} preview={preview} /> : null}
    </section>
  );
}
