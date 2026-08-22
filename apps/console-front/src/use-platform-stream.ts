import {
  createPlatformClient,
  type DisasterType,
  type EventDraft,
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

  /**
   * Push an event into the dashboard without the backend. Used to verify
   * alert, zone, shelter, and route rendering while those endpoints are
   * still being built; it never reaches the platform.
   */
  const previewEvent = useCallback((next: PlatformEvent | null) => {
    setEvent(next);
  }, []);

  return {
    client,
    frame,
    streaming,
    event,
    previewEvent,
    selectedType,
    connection,
    publishing,
    errorMessage,
    setSelectedType,
    publish,
  };
}
