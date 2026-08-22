import {
  DASHBOARD_SOURCE,
  type DashboardCommand,
  MAP_SOURCE,
  PROTOCOL_VERSION,
  type RiskZone,
  type Scenario,
  type TriggerKind,
} from "@salgil/map-webgpu-canvas/protocol";
import {
  createPlatformClient,
  type DisasterType,
  openSituationStream,
  type PlatformEvent,
  type RoutePlan,
  recommendedLeg,
  SCENARIO_TO_HAZARD,
  type Shelter,
} from "@salgil/platform-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

const mapScenarios: Record<DisasterType, Scenario> = {
  rain: "rain",
  flood: "flood",
  wildfire: "wildfire",
  landslide: "landslide",
  earthquake: "earthquake",
  typhoon: "typhoon",
  tsunami: "tsunami",
  heatwave: "clear",
  coldwave: "clear",
  snow: "rain",
  drought: "clear",
  chemical: "chemical",
  nuclear: "nuclear",
};

const triggerKinds: readonly TriggerKind[] = [
  "flood",
  "wildfire",
  "landslide",
  "earthquake",
  "tsunami",
  "chemical",
  "nuclear",
];

function isTriggerKind(type: DisasterType): type is TriggerKind {
  return triggerKinds.some((trigger) => trigger === type);
}

function getMapLocation(): { src: string; origin: string } {
  const configuredUrl = import.meta.env.VITE_MAP_URL ?? "http://localhost:5183";
  const url = new URL(configuredUrl, window.location.href);
  url.searchParams.set("origin", window.location.origin);
  url.searchParams.set("ui", "0");
  url.searchParams.set("scenario", "clear");
  // Residents read a plan of their own area; they do not pan the province.
  url.searchParams.set("district", "47750");
  url.searchParams.set("interaction", "0");
  return { src: url.toString(), origin: url.origin };
}

/**
 * Where the resident is. The device has no fix in the prototype, so this is
 * the shared demo site; a real build reads geolocation.
 */
const ORIGIN = {
  lat: 36.43,
  lon: 129.05,
  label: "Jinbo-myeon, Cheongsong",
} as const;

type PlatformRiskZone = NonNullable<PlatformEvent["zones"]>[number];

/** A radius as a polygon ring, since the zone contract has no circle form. */
function ringAround(
  lat: number,
  lon: number,
  radiusMeters: number,
): { lat: number; lon: number }[] {
  const dLat = radiusMeters / 110574;
  const dLon = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2;
    return {
      lat: lat + Math.sin(angle) * dLat,
      lon: lon + Math.cos(angle) * dLon,
    };
  });
}

function toMapRiskZone(zone: PlatformRiskZone): RiskZone {
  return {
    id: zone.id,
    polygon: zone.polygon,
    ...(zone.label ? { label: zone.label } : {}),
    ...(zone.hazard ? { hazard: zone.hazard } : {}),
    ...(zone.severity ? { severity: zone.severity } : {}),
    ...(zone.color ? { color: zone.color } : {}),
  };
}

export function App() {
  const client = useMemo(
    () =>
      createPlatformClient({
        apiUrl: import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform",
        regionCode: import.meta.env.VITE_PLATFORM_REGION_CODE ?? "47750",
      }),
    [],
  );
  const mapLocation = useMemo(getMapLocation, []);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const lastTriggeredEventRef = useRef("");
  const [event, setEvent] = useState<PlatformEvent | null>(null);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  /** Hazard the platform is actively streaming spread for, if any. */
  const [liveHazard, setLiveHazard] = useState<string | null>(null);

  // The stream is what makes this a warning rather than a page someone has to
  // refresh. Polling still runs underneath as the fallback: a resident whose
  // connection drops the SSE must not stop being told there is a fire.
  useEffect(() => {
    const close = openSituationStream({
      apiUrl: import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform",
      onEvent: (streamEvent) => {
        if (streamEvent.kind === "frame")
          setLiveHazard(streamEvent.frame.hazard);
      },
    });
    return close;
  }, []);

  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      if (message.kind === "disaster.event") {
        setEvent(message.event);
        setAcknowledged(false);
      }
      if (message.kind === "incident.clear") setEvent(null);
    });
    client.start();
    return () => {
      unsubscribe();
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    const handleMessage = (messageEvent: MessageEvent<unknown>) => {
      if (
        messageEvent.origin !== mapLocation.origin ||
        messageEvent.source !== frameRef.current?.contentWindow ||
        typeof messageEvent.data !== "object" ||
        messageEvent.data === null
      ) {
        return;
      }
      const data = messageEvent.data as Record<string, unknown>;
      if (
        data.source === MAP_SOURCE &&
        data.v === PROTOCOL_VERSION &&
        data.type === "map:ready"
      ) {
        setMapReady(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [mapLocation.origin]);

  useEffect(() => {
    if (!event) {
      setPlan(null);
      setShelters([]);
      return;
    }
    let cancelled = false;
    const hazard = SCENARIO_TO_HAZARD[event.type];
    void Promise.all([
      client.planEvacuation({
        hazard,
        ...ORIGIN,
        mode: "foot",
        // The inference server is in stub mode, whose synthetic risk is not on
        // the model's scale: at the default threshold it marks every road
        // impassable. Drop this once a calibrated model is serving.
        blockThreshold: 0.8,
      }),
      client
        .findShelters({ hazard, lat: ORIGIN.lat, lon: ORIGIN.lon, limit: 6 })
        .catch(() => [] as Shelter[]),
    ])
      .then(([nextPlan, nextShelters]) => {
        if (cancelled) return;
        setPlan(nextPlan);
        setShelters(nextShelters);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, event]);

  const postMapCommand = useCallback(
    (command: DashboardCommand) => {
      frameRef.current?.contentWindow?.postMessage(
        { source: DASHBOARD_SOURCE, v: PROTOCOL_VERSION, ...command },
        mapLocation.origin,
      );
    },
    [mapLocation.origin],
  );

  useEffect(() => {
    if (!mapReady) return;
    postMapCommand({
      type: "map:set-scenario",
      payload: {
        scenario: event ? mapScenarios[event.type] : "clear",
        ...(event?.rainfallMmPerHour !== undefined
          ? { rainfallMmPerHour: event.rainfallMmPerHour }
          : {}),
      },
    });
    postMapCommand({ type: "map:set-view", payload: { mode: "flat" } });
    postMapCommand({ type: "map:set-basemap", payload: { style: "map" } });
    postMapCommand({
      type: "map:set-markers",
      payload: {
        markers: [
          {
            id: "current-location",
            at: { lat: ORIGIN.lat, lon: ORIGIN.lon },
            label: ORIGIN.label,
            kind: "community" as const,
            selected: true,
          },
          ...shelters
            .filter(
              (s) => typeof s.lat === "number" && typeof s.lon === "number",
            )
            .map((s) => ({
              id: s.id,
              at: { lat: s.lat as number, lon: s.lon as number },
              label: s.name,
              kind: "shelter" as const,
            })),
          ...(event?.location
            ? [
                {
                  id: `incident-${event.id}`,
                  at: event.location,
                  label: event.location.label,
                  kind: "incident" as const,
                  selected: true,
                },
              ]
            : []),
        ],
      },
    });
    postMapCommand({
      type: "map:set-routes",
      payload: {
        routes: (plan?.routes ?? [])
          .filter((leg) => leg.found && leg.geometry.length >= 2)
          .map((leg) => ({
            id: leg.shelter_id,
            // GeoJSON order is [lon, lat].
            path: leg.geometry.map(([lon, lat]) => ({
              lat: lat ?? 0,
              lon: lon ?? 0,
            })),
            label: leg.shelter_name,
            // "advised", never "open": this is a suggested route, not a
            // verified official safe route.
            state: "advised" as const,
          })),
      },
    });
    postMapCommand({
      type: "map:set-zones",
      payload: {
        zones: [
          ...(event?.zones ?? []).map(toMapRiskZone),
          // Confirmed closures from field reports. These are facts, not
          // forecasts, so they are drawn solid and are not activatable.
          ...(plan?.routes ?? []).flatMap((leg) =>
            leg.blocked_by_reports.map((block, index) => ({
              id: `${leg.shelter_id}-block-${index}`,
              label: block.detail ?? "Access blocked",
              hazard: block.kind,
              severity: "warning" as const,
              activatable: false,
              polygon: ringAround(block.lat, block.lon, block.radius_m),
            })),
          ),
        ],
      },
    });

    const eventVersion = event ? `${event.id}:${event.sequence}` : "";
    if (
      event?.location &&
      isTriggerKind(event.type) &&
      lastTriggeredEventRef.current !== eventVersion
    ) {
      lastTriggeredEventRef.current = eventVersion;
      postMapCommand({
        type: "map:trigger",
        payload: {
          hazard: event.type,
          x: event.location.x,
          y: event.location.y,
        },
      });
    }
  }, [event, mapReady, plan, postMapCommand, shelters]);

  const best = plan ? recommendedLeg(plan) : undefined;
  const instruction =
    event?.instruction ??
    "Stay clear of hazard zones and follow official evacuation guidance.";
  const shelter = best?.shelter_name ?? "No reachable shelter yet";
  const travelTime =
    best?.duration_minutes === null || best?.duration_minutes === undefined
      ? "—"
      : `${Math.round(best.duration_minutes)} min`;
  const blocked = plan?.routes.filter((leg) => !leg.found) ?? [];

  return (
    <main className="mobile-shell">
      <div className="mobile-map">
        <iframe
          ref={frameRef}
          src={mapLocation.src}
          title="SALGIL evacuation map"
          tabIndex={-1}
          onLoad={() => setMapReady(false)}
        />
        {!mapReady ? <span className="map-loading">Loading map</span> : null}
      </div>

      <section className="mobile-sheet" aria-live="polite">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="mobile-intro">
          <div>
            <p>{event ? "Current incident" : "Emergency guidance"}</p>
            <h1>{event?.headline ?? "No active incident in your area"}</h1>
          </div>
          <span>
            {event
              ? `${event.mode === "training" ? "Training" : "Alert"} · ${timeFormatter.format(new Date(event.createdAt))}`
              : "Monitoring official alerts"}
          </span>
        </div>

        <div className="panel-heading">
          <h2>Evacuation</h2>
          <strong>{travelTime}</strong>
        </div>
        <dl className="guidance-list">
          <div>
            <dt>Assigned shelter</dt>
            <dd>{shelter}</dd>
          </div>
          <div>
            <dt>Route</dt>
            {/* Never "official": the backend's data contract forbids
                presenting a computed route as a verified safe route. */}
            <dd>
              {best
                ? "Suggested route, avoiding predicted risk"
                : "Awaiting a reachable route"}
            </dd>
          </div>
          <div>
            <dt>Guidance</dt>
            <dd>{instruction}</dd>
          </div>
        </dl>

        {blocked.length > 0 ? (
          <ul className="blocked-routes">
            {blocked.map((leg) => (
              <li key={leg.shelter_id}>
                <strong>{leg.shelter_name}</strong>
                <span>{leg.reason ?? "Unreachable"}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {liveHazard ? (
          <p className="live-spread" role="status">
            Live spread forecast for this area
          </p>
        ) : null}

        {plan ? (
          <p className="route-notice">
            {plan.notice}
            <small>{plan.attribution}</small>
          </p>
        ) : null}

        <button
          className="acknowledge-button"
          type="button"
          disabled={acknowledged}
          onClick={() => setAcknowledged(true)}
        >
          {acknowledged ? "Guidance reviewed" : "Review guidance"}
        </button>
      </section>
    </main>
  );
}
