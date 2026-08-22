import {
  createPlatformClient,
  type DisasterType,
  type EventDraft,
  type IncidentMode,
  type PlatformConnection,
  type PlatformEvent,
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
  const [mode, setMode] = useState<IncidentMode>("training");
  const [selectedType, setSelectedType] = useState<DisasterType>("landslide");
  const [connection, setConnection] =
    useState<PlatformConnection>("connecting");
  const [publishing, setPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      switch (message.kind) {
        case "disaster.event":
          setEvent(message.event);
          setMode(message.event.mode);
          setSelectedType(message.event.type);
          return;
        case "incident.clear":
          setEvent(null);
          return;
        case "control.sync":
          setMode(message.mode);
          setSelectedType(message.selectedType);
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
    async (draft: EventDraft) => {
      setPublishing(true);
      setErrorMessage("");
      try {
        return await client.publish(draft);
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

  return {
    event,
    mode,
    selectedType,
    connection,
    publishing,
    errorMessage,
    setMode,
    setSelectedType,
    publish,
  };
}
