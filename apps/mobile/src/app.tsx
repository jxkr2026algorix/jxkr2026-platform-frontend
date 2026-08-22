import {
  createPlatformClient,
  type MobileSession,
  type PlatformEvent,
} from "@salgil/platform-client";
import { useEffect, useMemo, useState } from "react";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

export function App() {
  const client = useMemo(
    () =>
      createPlatformClient({
        apiUrl: import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform",
        regionCode: import.meta.env.VITE_PLATFORM_REGION_CODE ?? "47750",
      }),
    [],
  );
  const [event, setEvent] = useState<PlatformEvent | null>(null);
  const [session, setSession] = useState<MobileSession | null>(null);
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

  const instruction =
    event?.instruction ??
    session?.caution ??
    "Stay clear of hazard zones and follow official evacuation guidance.";
  const shelter = session?.shelter.label ?? "Assignment pending";
  const travelTime = session ? `${session.estimatedMinutes} min` : "—";

  return (
    <main className="mobile-shell">
      <header className="mobile-header">
        <a className="mobile-brand" href="/" aria-label="SALGIL mobile home">
          <img src="/salgil-mark.svg" alt="" width="32" height="32" />
          <strong>Salgil</strong>
        </a>
        <span>Resident guidance</span>
      </header>

      <section className="mobile-intro" aria-live="polite">
        <p>{event ? "Current incident" : "Emergency guidance"}</p>
        <h1>{event?.headline ?? "No active incident in your area"}</h1>
        <span>
          {event
            ? `${event.mode === "training" ? "Training" : "Alert"} · ${timeFormatter.format(new Date(event.createdAt))}`
            : "We will show official instructions here when an incident is issued."}
        </span>
      </section>

      <section className="guidance-panel" aria-labelledby="evacuation-title">
        <div className="panel-heading">
          <h2 id="evacuation-title">Evacuation</h2>
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
      </section>

      <section className="response-section" aria-labelledby="response-title">
        <div>
          <h2 id="response-title">Your response</h2>
          <p>Confirm once you have reviewed the evacuation information.</p>
        </div>
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
