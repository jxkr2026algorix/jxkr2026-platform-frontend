import { cameraForBbox } from "@salgil/map-webgpu-canvas/districts";
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
  demoOriginNear,
  openSituationStream,
  type PlatformEvent,
  type RoutePlan,
  recommendedLeg,
  SCENARIO_TO_HAZARD,
  type Shelter,
} from "@salgil/platform-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NotificationPermissionGate } from "./notification-permission-gate";
import { notifyIncident, notifyRouteBlocked } from "./notifications";

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
  url.searchParams.set("district", "47750");
  url.searchParams.set("interaction", "1");
  return { src: url.toString(), origin: url.origin };
}

/**
 * Fallback position, used only when the incident carries no coordinates.
 * The device has no fix in the prototype; a real build reads geolocation.
 */
const FALLBACK_ORIGIN = {
  lat: 36.43,
  lon: 129.05,
  label: "Demo location · Jinbo-myeon",
} as const;

function cameraForRoute(
  geometry: readonly (readonly number[])[],
): { center: { lat: number; lon: number }; distanceMeters: number } | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  for (const coordinate of geometry) {
    const lon = coordinate[0];
    const lat = coordinate[1];
    if (lon === undefined || lat === undefined) continue;
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }

  if (![west, south, east, north].every(Number.isFinite)) return null;
  const longitudePadding = Math.max((east - west) * 0.16, 0.0012);
  const latitudePadding = Math.max((north - south) * 0.16, 0.0012);
  const camera = cameraForBbox(
    [
      west - longitudePadding,
      south - latitudePadding,
      east + longitudePadding,
      north + latitudePadding,
    ],
    40,
    0.7,
  );
  return {
    center: { lat: camera.lat, lon: camera.lon },
    distanceMeters: Math.max(camera.distanceMeters, 4_200),
  };
}

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
        // This screen is the audience view reached by QR: the people holding it
        // are wherever the demo is, not in one particular county. Filtering to
        // a home region means an exercise started anywhere else never arrives.
        // A resident build would set this false and filter to their own county.
        watchAllRegions: true,
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
  const [isSheetCollapsed, setIsSheetCollapsed] = useState(false);
  /** Hazard the platform is actively streaming spread for, if any. */
  const [liveHazard, setLiveHazard] = useState<string | null>(null);
  /**
   * Where the stream says the incident is. The polled event can only carry a
   * normalized `map_origin`, which an incident raised elsewhere — from the
   * assistant, or another console — never has.
   */
  const [streamedAt, setStreamedAt] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [streamDrill, setStreamDrill] = useState(false);
  /** The routing service could not be reached. Said, never papered over. */
  const [routeError, setRouteError] = useState(false);
  const notifiedIncidentRef = useRef("");
  const blockedRouteRef = useRef("");

  // The stream is what makes this a warning rather than a page someone has to
  // refresh. Polling still runs underneath as the fallback: a resident whose
  // connection drops the SSE must not stop being told there is a fire.
  useEffect(() => {
    const close = openSituationStream({
      apiUrl: import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform",
      onEvent: (streamEvent) => {
        if (streamEvent.kind === "frame")
          setLiveHazard(streamEvent.frame.hazard);
        if (streamEvent.kind === "incident") {
          setStreamDrill(streamEvent.incident.drill);
          const { lat, lon } = streamEvent.incident;
          setStreamedAt(
            typeof lat === "number" && typeof lon === "number"
              ? { lat, lon }
              : null,
          );
        }
      },
    });
    return close;
  }, []);

  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      if (message.kind === "disaster.event") {
        setEvent(message.event);
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

  /**
   * Spawn near the incident rather than at one shared point. Every phone
   * reporting the same coordinate made the demo look like one person, which is
   * not the case an evacuation order is about.
   *
   * Keyed on the incident, and taken from the declared position rather than the
   * live stream, so the position holds still. One that moved between frames
   * would drag the route and the map marker with it, and the plan would appear
   * to change for no reason.
   */
  const origin = useMemo(
    () =>
      demoOriginNear(
        event?.at,
        event?.id ?? event?.createdAt ?? "no-incident",
        FALLBACK_ORIGIN,
      ),
    [event?.at, event?.id, event?.createdAt],
  );

  useEffect(() => {
    // Nothing has happened. Showing a route anyway meant this screen always
    // had one, so the arrival of a real emergency changed nothing visible.
    if (!event) {
      setPlan(null);
      setShelters([]);
      return;
    }
    let cancelled = false;
    setRouteError(false);
    const hazard = SCENARIO_TO_HAZARD[event.type];
    void Promise.all([
      client.planEvacuation({
        hazard,
        lat: origin.lat,
        lon: origin.lon,
        mode: "foot",
        // The inference server is in stub mode, whose synthetic risk is not on
        // the model's scale: at the default threshold it marks every road
        // impassable. Drop this once a calibrated model is serving.
        blockThreshold: 0.8,
      }),
      client
        .findShelters({ hazard, lat: origin.lat, lon: origin.lon, limit: 6 })
        .catch(() => [] as Shelter[]),
    ])
      .then(([nextPlan, nextShelters]) => {
        if (cancelled) return;
        setPlan(nextPlan);
        setShelters(nextShelters);
      })
      .catch(() => {
        if (cancelled) return;
        // No invented route. A resident who follows a fabricated line during a
        // real fire is worse off than one who is told the route is unavailable
        // and waits for the announcement.
        setPlan(null);
        setShelters([]);
        setRouteError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, event, origin]);

  const postMapCommand = useCallback(
    (command: DashboardCommand) => {
      frameRef.current?.contentWindow?.postMessage(
        { source: DASHBOARD_SOURCE, v: PROTOCOL_VERSION, ...command },
        mapLocation.origin,
      );
    },
    [mapLocation.origin],
  );

  // Either channel is enough. A phone that scans the QR after the exercise
  // has started never sees the stream event that announced it, and a drill it
  // reads as real teaches the person holding it to ignore the next one.
  // Said plainly on screen and in the notification, because a drill that reads
  // as real teaches people to ignore the next one — and the real one after.
  const drill =
    streamDrill || event?.drill === true || event?.mode === "training";
  const declaredAt = streamedAt ?? event?.at ?? null;

  const best = plan ? recommendedLeg(plan) : undefined;
  const routeCamera = useMemo(
    () => (best ? cameraForRoute(best.geometry) : null),
    [best],
  );

  const fitRoute = useCallback(() => {
    if (!routeCamera) return;
    postMapCommand({ type: "map:set-camera", payload: routeCamera });
  }, [postMapCommand, routeCamera]);

  const handleSheetToggle = useCallback(() => {
    setIsSheetCollapsed((collapsed) => !collapsed);
    window.requestAnimationFrame(fitRoute);
  }, [fitRoute]);

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
            at: { lat: origin.lat, lon: origin.lon },
            label: origin.label,
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
          ...((declaredAt ?? event?.location)
            ? [
                {
                  id: `incident-${event?.id ?? "declared"}`,
                  at: declaredAt ?? event?.location ?? origin,
                  ...(event?.headline ? { label: event.headline } : {}),
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
    if (routeCamera) {
      postMapCommand({ type: "map:set-camera", payload: routeCamera });
    }
  }, [
    declaredAt,
    event,
    mapReady,
    origin,
    plan,
    postMapCommand,
    routeCamera,
    shelters,
  ]);

  useEffect(() => {
    if (!event) return;
    const version = `${event.id}:${event.sequence}`;
    if (notifiedIncidentRef.current === version) return;
    notifiedIncidentRef.current = version;
    // The notification arrives without the screen around it, so it carries the
    // marker itself — unless the headline already carries it, which is how a
    // drill started from the assistant arrives. Prefixing twice reads as a bug
    // and undermines the one word that has to be believed.
    const marked = drill && !event.headline.startsWith("[훈련]");
    notifyIncident(
      marked ? `[훈련] ${event.headline}` : event.headline,
      drill
        ? `훈련 상황입니다. 실제 재난이 아닙니다. ${event.instruction}`
        : event.instruction,
    );
  }, [event, drill]);

  useEffect(() => {
    if (!plan) return;
    // Only the closures that actually sit on a route matter here. A hazard
    // somewhere in the county is not a reason to interrupt someone walking.
    const blocked = plan.routes
      .flatMap((leg) => leg.blocked_by_reports)
      .map((block) => block.detail ?? block.kind)
      .join("|");
    if (!blocked || blockedRouteRef.current === blocked) return;
    const previous = blockedRouteRef.current;
    blockedRouteRef.current = blocked;
    // Silent on the first plan: that is the route being given, not changed.
    if (!previous) return;
    notifyRouteBlocked(
      blocked.split("|")[0] ?? "A road on your route is closed",
      recommendedLeg(plan)?.shelter_name ?? "the nearest shelter",
    );
  }, [plan]);
  const instruction =
    event?.instruction ??
    "Stay clear of hazard zones and follow official evacuation guidance.";
  const shelter = best?.shelter_name ?? "No reachable shelter yet";
  const travelTime =
    best?.duration_minutes === null || best?.duration_minutes === undefined
      ? "—"
      : `${Math.round(best.duration_minutes)} min`;
  /**
   * Shelters the router could not reach. Only worth showing when there is no
   * route at all: with a route in hand, a list of places you cannot walk to
   * reads as "the roads are blocked" and is the operator's problem, not the
   * problem of the person holding the phone.
   */
  const unreachable = best
    ? []
    : (plan?.routes.filter((leg) => !leg.found) ?? []);

  return (
    <main className="mobile-shell">
      <div
        className={`mobile-map${isSheetCollapsed ? " is-sheet-collapsed" : ""}`}
      >
        <iframe
          ref={frameRef}
          src={mapLocation.src}
          title="SALGIL evacuation map"
          tabIndex={-1}
          onLoad={() => setMapReady(false)}
        />
        {!mapReady ? <span className="map-loading">Loading map</span> : null}
        <nav className="mobile-map-zoom" aria-label="Map zoom controls">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() =>
              postMapCommand({ type: "map:zoom", payload: { factor: 0.72 } })
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() =>
              postMapCommand({ type: "map:zoom", payload: { factor: 1.38 } })
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>
        </nav>
        <button
          className="fit-route-button"
          type="button"
          disabled={!routeCamera}
          onClick={fitRoute}
        >
          View full route
        </button>
      </div>

      {drill ? (
        <p className="drill-strip" role="status">
          훈련 상황입니다 — 실제 재난이 아닙니다
        </p>
      ) : null}

      <section
        className={`mobile-sheet${isSheetCollapsed ? " is-collapsed" : ""}`}
        aria-live="polite"
      >
        <button
          className="sheet-toggle"
          type="button"
          aria-controls="mobile-sheet-content"
          aria-expanded={!isSheetCollapsed}
          aria-label={
            isSheetCollapsed
              ? "Show evacuation guidance"
              : "Hide evacuation guidance"
          }
          onClick={handleSheetToggle}
        >
          <span className="sheet-handle" aria-hidden="true" />
          {isSheetCollapsed ? <span>Show guidance</span> : null}
        </button>

        <div id="mobile-sheet-content" hidden={isSheetCollapsed}>
          <div className="mobile-intro">
            <div>
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

          {/*
            Two different things, said differently. A hazard the public data
            cannot route for is a known limit, and telling the resident the
            calculation failed sends them looking for a route that was never
            going to exist.
          */}
          {plan && plan.shelter_guidance_available === false ? (
            <p className="route-unavailable" role="alert">
              {plan.hazard_limitation ??
                "이 재난은 갈 곳을 안내할 공개 데이터가 없습니다."}{" "}
              안내 방송과 현장 지시를 따르세요.
            </p>
          ) : routeError ? (
            <p className="route-unavailable" role="alert">
              대피 경로를 계산하지 못했습니다. 안내 방송과 현장 지시를 따르세요.
            </p>
          ) : null}

          {unreachable.length > 0 ? (
            <>
              <p className="blocked-routes-title">도달할 수 없는 대피소</p>
              <ul className="blocked-routes">
                {unreachable.map((leg) => (
                  <li key={leg.shelter_id}>
                    <strong>{leg.shelter_name}</strong>
                    <span>{leg.reason ?? "Unreachable"}</span>
                  </li>
                ))}
              </ul>
            </>
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
        </div>
      </section>

      <NotificationPermissionGate />
    </main>
  );
}
