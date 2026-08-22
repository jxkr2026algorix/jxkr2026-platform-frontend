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
  type MobileSession,
  type PlatformEvent,
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
  return { src: url.toString(), origin: url.origin };
}

function toMapRiskZone(zone: MobileSession["riskZones"][number]): RiskZone {
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
  const [session, setSession] = useState<MobileSession | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      if (message.kind === "disaster.event") {
        setEvent(message.event);
        setAcknowledged(false);
      }
      if (message.kind === "incident.clear") setEvent(null);
    });
    client.start();
    client
      .getMobileSession()
      .then(setSession)
      .catch(() => undefined);
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
    postMapCommand({
      type: "map:set-markers",
      payload: {
        markers: [
          ...(session
            ? [
                {
                  id: "assigned-shelter",
                  at: session.shelter,
                  label: session.shelter.label,
                  kind: "shelter" as const,
                },
              ]
            : []),
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
        routes: session
          ? [
              {
                id: "assigned-route",
                path: session.route,
                label: "Evacuation route",
                state: "advised",
              },
            ]
          : [],
      },
    });
    postMapCommand({
      type: "map:set-zones",
      payload: {
        zones: (event?.zones ?? session?.riskZones ?? []).map(toMapRiskZone),
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
  }, [event, mapReady, postMapCommand, session]);

  const instruction =
    event?.instruction ??
    session?.caution ??
    "Stay clear of hazard zones and follow official evacuation guidance.";
  const shelter = session?.shelter.label ?? "Assignment pending";
  const travelTime = session ? `${session.estimatedMinutes} min` : "—";

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

      <header className="mobile-header">
        <a className="mobile-brand" href="/" aria-label="SALGIL mobile home">
          <img src="/salgil-mark.svg" alt="" width="30" height="30" />
          <strong>Salgil</strong>
        </a>
        <span>Jinbo-myeon</span>
      </header>

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
            <dd>{session ? "Official blue route" : "Awaiting assignment"}</dd>
          </div>
          <div>
            <dt>Guidance</dt>
            <dd>{instruction}</dd>
          </div>
        </dl>

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
