import { cameraForBbox, districtAt } from "@salgil/map-webgpu-canvas/districts";
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
  type RouteLeg,
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

/**
 * Which way the shelter is, in words.
 *
 * Everything else this screen says about the route — the line on the map, the
 * risk zones it bends around, the closed roads — is pixels. Someone using a
 * screen reader is handed a shelter name and a duration and told to walk. A
 * bearing and a distance are the least that makes the instruction followable
 * without seeing it.
 */
const COMPASS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;

function bearingWord(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): string {
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  const degrees = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8] ?? "north";
}

function walkingDirections(
  leg: RouteLeg | undefined,
  from: { lat: number; lon: number },
): string | null {
  if (!leg?.found) return null;
  const end = leg.geometry.at(-1);
  const lon = end?.[0];
  const lat = end?.[1];
  const distance =
    typeof leg.distance_m === "number"
      ? leg.distance_m >= 1000
        ? `${(leg.distance_m / 1000).toFixed(1)} km`
        : `${Math.round(leg.distance_m / 10) * 10} m`
      : null;
  const heading =
    typeof lat === "number" && typeof lon === "number"
      ? bearingWord(from, { lat, lon })
      : null;
  if (!distance && !heading) return null;
  if (distance && heading)
    return `About ${distance} away, heading ${heading} from you.`;
  return distance ? `About ${distance} away.` : `Heading ${heading} from you.`;
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
  const headlineRef = useRef<HTMLHeadingElement>(null);

  /**
   * Where focus goes when the notification dialog closes. Without this it
   * lands on `document.body` and a screen reader starts the document over —
   * at the moment an alert may be arriving.
   */
  const focusHeadline = useCallback(() => {
    headlineRef.current?.focus();
  }, []);

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

  const declaredAt = streamedAt ?? event?.at ?? null;

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
  const best = plan ? recommendedLeg(plan) : undefined;

  /**
   * What the assertive region says. Held in state rather than derived, so it
   * changes exactly when the incident does: recomputing it every render made
   * the region re-announce on unrelated updates, and an evacuation order
   * repeating every few seconds is one people learn to tune out.
   */
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!event) {
      setAnnouncement("");
      return;
    }
    setAnnouncement(
      `${drill ? "Training exercise, not a real emergency. " : ""}${event.headline}. ${event.instruction}`,
    );
  }, [event, drill]);

  /**
   * The tab and lock-screen title is the one string the OS shows without the
   * app being open. "SALGIL Mobile" spends it on the product name.
   */
  useEffect(() => {
    document.title = event
      ? `${drill ? "[Training] " : ""}${event.headline} · SALGIL`
      : "SALGIL — Evacuation guidance";
  }, [event, drill]);

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
    // Real coordinates first, the normalized point only as a fallback. A
    // normalized point is a position in the viewport that produced it — the
    // console's wide desktop camera — and this phone renders it against a
    // 58dvh frame with a different aspect, which is how the two screens ended
    // up showing the same incident in two different places. An incident
    // declared from the assistant has no normalized point at all, so on this
    // path it used to raise nothing here whatsoever.
    const ignitionAt = declaredAt ?? event?.location ?? null;
    if (
      ignitionAt &&
      event &&
      isTriggerKind(event.type) &&
      lastTriggeredEventRef.current !== eventVersion
    ) {
      lastTriggeredEventRef.current = eventVersion;
      postMapCommand({
        type: "map:trigger",
        payload: { hazard: event.type, ...ignitionAt },
      });
    }
    // Follow the incident. The frame was pinned to district 47750 in the
    // iframe URL and never moved, so an incident anywhere else was triggered
    // at the right coordinate and drawn off the edge of the screen — which
    // read, correctly, as "the phone always shows Cheongsong".
    if (declaredAt) {
      const district = districtAt(declaredAt.lat, declaredAt.lon);
      if (district) {
        postMapCommand({
          type: "map:focus-district",
          payload: { code: district },
        });
      }
    }
    // The route frames both ends, so it wins once there is one. Before that,
    // the incident itself is the only thing worth looking at.
    if (routeCamera) {
      postMapCommand({ type: "map:set-camera", payload: routeCamera });
    } else if (declaredAt) {
      postMapCommand({
        type: "map:set-camera",
        payload: { center: declaredAt, distanceMeters: 24_000 },
      });
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
  // An em dash announces as nothing at all, and "nothing" is not the same
  // answer as "we do not know yet".
  const travelTime =
    best?.duration_minutes === null || best?.duration_minutes === undefined
      ? "Not known yet"
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
  const directions = walkingDirections(best, origin);

  return (
    <main className="mobile-shell">
      {/*
        The one region that interrupts. It is in the DOM from first paint and
        never unmounts, because a live region created at the same moment as its
        text is a live region most screen readers never announce — and the text
        it carries is the evacuation order. `alert` rather than `status`: this
        has to cut across whatever is being read, not queue behind it.
      */}
      <div className="sr-only" role="alert" aria-atomic="true">
        {announcement}
      </div>

      <div
        className={`mobile-map${isSheetCollapsed ? " is-sheet-collapsed" : ""}`}
        aria-busy={!mapReady}
      >
        <iframe
          ref={frameRef}
          src={mapLocation.src}
          title="SALGIL evacuation map"
          onLoad={() => setMapReady(false)}
        />
        {/* Persistent, for the same reason as the alert above. Empty is
            hidden by CSS rather than by unmounting. */}
        <p className="map-loading" role="status">
          {mapReady ? "" : "Loading map"}
        </p>
        {/* Zoom is not navigation. As a nav it put a second landmark in the
            rotor of an app that has three. */}
        <fieldset className="mobile-map-zoom" aria-label="Map zoom">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() =>
              postMapCommand({ type: "map:zoom", payload: { factor: 0.72 } })
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h14" />
            </svg>
          </button>
        </fieldset>
        {/* aria-disabled, not disabled: a disabled button leaves the tab order
            entirely, so the one user who cannot see that there is no route is
            also the one never told why. */}
        <button
          className="fit-route-button"
          type="button"
          aria-disabled={!routeCamera}
          aria-describedby={routeCamera ? undefined : "fit-route-reason"}
          onClick={() => routeCamera && fitRoute()}
        >
          View full route
        </button>
        {routeCamera ? null : (
          <span id="fit-route-reason" className="sr-only">
            No route to show yet
          </span>
        )}
      </div>

      {/*
        Whether this is real. Both languages: the document is English, the
        sentence that has to be believed is Korean, and a screen reader with an
        English voice reads unmarked Hangul as noise.
      */}
      <p className="drill-strip" role="status">
        {drill ? (
          <>
            <strong lang="ko">훈련 상황입니다 — 실제 재난이 아닙니다</strong>
            <span>Training exercise — not a real emergency</span>
          </>
        ) : null}
      </p>

      <section
        className={`mobile-sheet${isSheetCollapsed ? " is-collapsed" : ""}`}
        aria-labelledby="incident-headline"
      >
        <button
          className="sheet-toggle"
          type="button"
          aria-controls="mobile-sheet-content"
          aria-expanded={!isSheetCollapsed}
          onClick={handleSheetToggle}
        >
          <span className="sheet-handle" aria-hidden="true" />
          {/* Labelled in both states. The grab handle alone was a 34x4px bar
              at 1.15:1 against the sheet — no name, and nothing to see. */}
          <span>{isSheetCollapsed ? "Show guidance" : "Hide guidance"}</span>
        </button>

        {/*
          Outside the collapsible container on purpose. Everything used to be
          inside it, so a collapsed sheet left the document with no heading, no
          incident and no instruction — and the map behind it is an opaque
          iframe. Collapsing a panel must not empty the page.
        */}
        <div className="mobile-intro">
          <h1 id="incident-headline" ref={headlineRef} tabIndex={-1}>
            {event?.headline ?? "No active incident in your area"}
          </h1>
          <p className={`incident-mode${drill ? " is-training" : ""}`}>
            <strong>
              {event
                ? drill
                  ? "Training exercise"
                  : "Live alert"
                : "Monitoring"}
            </strong>
            {event ? (
              <time dateTime={event.createdAt}>
                {timeFormatter.format(new Date(event.createdAt))}
              </time>
            ) : null}
          </p>
        </div>

        <div id="mobile-sheet-content" hidden={isSheetCollapsed}>
          <div className="panel-heading">
            <h2>Evacuation</h2>
            <strong>
              {/* The number alone reads as "12 min" next to "Evacuation",
                  with nothing saying 12 minutes of what. */}
              <span className="sr-only">Estimated walking time: </span>
              {travelTime}
            </strong>
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
                {directions ? (
                  <span className="route-directions">{directions}</span>
                ) : null}
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
              {/* Marked, like the other Korean on this screen: the document is
                  English, and an English voice reads unmarked Hangul as noise.
                  This branch has even less to offer than the one below it —
                  there is no route to be had at all — so it gets the number
                  too. */}
              <span lang="ko">
                {plan.hazard_limitation ??
                  "이 재난은 갈 곳을 안내할 공개 데이터가 없습니다."}{" "}
                안내 방송과 현장 지시를 따르세요.
              </span>
              <a className="emergency-call" href="tel:119">
                Call 119
              </a>
            </p>
          ) : routeError ? (
            <p className="route-unavailable" role="alert">
              <span lang="ko">
                대피 경로를 계산하지 못했습니다. 안내 방송과 현장 지시를
                따르세요.
              </span>
              <span>
                The evacuation route could not be calculated. Follow official
                broadcasts and on-site instructions.
              </span>
              {/* The one failure path where the app has nothing left to give.
                  It can still give a phone number. */}
              <a className="emergency-call" href="tel:119">
                Call 119
              </a>
            </p>
          ) : null}

          {unreachable.length > 0 ? (
            <>
              <p className="blocked-routes-title" lang="ko">
                도달할 수 없는 대피소
              </p>
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

          <p className="live-spread" role="status">
            {liveHazard ? "Live spread forecast for this area" : ""}
          </p>

          {plan ? (
            <p className="route-notice">
              {plan.notice}
              <small>{plan.attribution}</small>
            </p>
          ) : null}
        </div>
      </section>

      <NotificationPermissionGate onDismissed={focusHeadline} />
    </main>
  );
}
