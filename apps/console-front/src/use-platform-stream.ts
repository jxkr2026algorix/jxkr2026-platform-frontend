import {
  createPlatformClient,
  type DisasterType,
  type EventDraft,
  type IncidentDeclared,
  openSituationStream,
  type PlatformConnection,
  type PlatformEvent,
  type PredictionFrame,
} from "@salgil/platform-client";
import { useCallback, useEffect, useMemo, useState } from "react";

export function usePlatformStream() {
  const client = useMemo(
    () =>
      createPlatformClient({
        apiUrl: import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform",
        regionCode: import.meta.env.VITE_PLATFORM_REGION_CODE ?? "47750",
        watchAllRegions: true,
      }),
    [],
  );
  const [event, setEvent] = useState<PlatformEvent | null>(null);

  // Nothing is pre-selected: a hazard showing as chosen on load invites a
  // confirm press that declares an incident nobody picked.
  const [selectedType, setSelectedType] = useState<DisasterType | null>(null);
  const [connection, setConnection] =
    useState<PlatformConnection>("connecting");
  const [publishing, setPublishing] = useState(false);
  /** Latest hazard-field frame from the platform, with its grid decoded. */
  const [frame, setFrame] = useState<{
    readonly frame: PredictionFrame;
    readonly values: Float32Array;
  } | null>(null);
  const [streaming, setStreaming] = useState(false);
  /**
   * The incident the stream last declared, kept whole. The drill flag rides
   * the stream rather than being inferred, because a drill that looks real
   * teaches people to ignore the next real one; the coordinates ride it for a
   * plainer reason — an incident declared from the assistant has no other way
   * to tell the map which county it is in.
   */
  const [declared, setDeclared] = useState<IncidentDeclared | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Spread arrives as frames on the stream, not in a response body: the
  // first horizon is worth drawing long before the last one exists.
  useEffect(() => {
    const close = openSituationStream({
      apiUrl: import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform",
      onConnectionChange: setStreaming,
      onEvent: (event) => {
        if (event.kind === "frame") {
          setFrame({ frame: event.frame, values: event.values });
        }
        if (event.kind === "incident") setDeclared(event.incident);
      },
    });
    return close;
  }, []);

  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      switch (message.kind) {
        case "disaster.event":
          // The active incident is not the operator's pending pick. Setting
          // the pick from an incoming event made a hazard button look pressed
          // on open and offered to declare what was already declared.
          setEvent(message.event);
          return;
        case "incident.clear":
          setEvent(null);
          return;
        case "control.sync":
          return;
      }
    });
    const unsubscribeConnection = client.subscribeConnection(setConnection);
    client.start();
    return () => {
      unsubscribe();
      unsubscribeConnection();
      client.stop();
    };
  }, [client]);

  const publish = useCallback(
    async (draft: Omit<EventDraft, "mode">) => {
      setPublishing(true);
      setErrorMessage("");
      try {
        // The live/training split is gone: every incident is a real one.
        return await client.publish({ ...draft, mode: "live" });
      } catch (error) {
        if (error instanceof Error) {
          setErrorMessage(
            "Could not record the incident. Check the platform connection and permissions.",
          );
          throw error;
        }
        throw error;
      } finally {
        setPublishing(false);
      }
    },
    [client],
  );

  // Either channel is enough. The stream is instant; the polled event is what
  // a console opened after the exercise started has.
  const drill = declared?.drill
    ? { title: declared.title }
    : event?.drill || event?.mode === "training"
      ? { title: event.headline }
      : null;

  /**
   * Where the open incident is, whichever channel said so first. Memoized on
   * the coordinates themselves: a fresh object every render re-fires the
   * effects that watch it, and those drive the map.
   */
  const lat = declared?.lat ?? event?.at?.lat ?? null;
  const lon = declared?.lon ?? event?.at?.lon ?? null;
  const incidentAt = useMemo(
    () => (lat === null || lon === null ? null : { lat, lon }),
    [lat, lon],
  );

  return {
    client,
    declared,
    drill,
    incidentAt,
    frame,
    streaming,
    event,
    selectedType,
    connection,
    publishing,
    errorMessage,
    setSelectedType,
    publish,
  };
}
