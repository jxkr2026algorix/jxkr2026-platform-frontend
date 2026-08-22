import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";
import {
  type DisasterType,
  type PlatformEvent,
  SCENARIO_TO_HAZARD,
} from "@salgil/platform-client";
import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { DashboardBrandHeader } from "./components/DashboardBrandHeader";
import { MapCanvas } from "./components/MapCanvas";
import { SituationPage } from "./pages/situation-page";
import { useMapBridge } from "./use-map-bridge";
import { usePlatformStream } from "./use-platform-stream";

export function App() {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [placementArmed, setPlacementArmed] = useState(false);
  const map = useMapBridge();
  const platform = usePlatformStream();
  const mobileUrl = useMemo(
    () =>
      new URL(
        import.meta.env.VITE_MOBILE_URL ?? "/mobile/",
        window.location.href,
      ).toString(),
    [],
  );
  const handleMapCommand = (command: DashboardCommand) => map.send(command);

  useEffect(() => {
    const event = platform.event;
    if (!event) return;
    map.send({
      type: "map:set-scenario",
      payload: {
        scenario: event.type,
        ...(event.rainfallMmPerHour !== undefined
          ? { rainfallMmPerHour: event.rainfallMmPerHour }
          : {}),
      },
    });
    map.send({
      type: "map:set-view",
      payload: { mode: event.presentation === "3d" ? "auto" : "flat" },
    });
    // Play, not pause: an incident that renders as a frozen frame reads as a
    // broken map. Swap back to pause once the platform streams spread state.
    map.send({ type: "map:sim-control", payload: { action: "play" } });
    map.send({
      type: "map:set-zones",
      payload: {
        zones: (event.zones ?? []).map((zone) => ({
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
    if (event.phase !== "initial") return;
    switch (event.type) {
      case "wildfire":
      case "flood":
      case "landslide":
      case "earthquake":
      case "tsunami":
      case "nuclear":
      case "chemical":
        if (event.location) {
          map.send({
            type: "map:trigger",
            payload: {
              hazard: event.type,
              x: event.location.x,
              y: event.location.y,
            },
          });
          map.send({
            type: "map:set-camera",
            payload: {
              center: event.location,
              distanceMeters: event.presentation === "3d" ? 42_000 : 94_000,
            },
          });
        }
        break;
      case "rain":
      case "typhoon":
      case "heatwave":
      case "coldwave":
      case "snow":
      case "drought":
        break;
      default:
        event.type satisfies never;
    }
  }, [map.send, platform.event]);

  useEffect(() => {
    const selection = map.status.pointSelection;
    if (!placementArmed || !selection) return;
    if (selection.hazard !== platform.selectedType) return;
    setPlacementArmed(false);
    const placed = platform.selectedType;
    if (selection.lat !== undefined && selection.lon !== undefined) {
      void platform.client
        .startSpread({
          hazard: SCENARIO_TO_HAZARD[placed],
          lat: selection.lat,
          lon: selection.lon,
          sizeMeters: (selection.radiusMeters ?? 6000) * 2,
        })
        .catch(() => undefined);
    }
    void platform
      .publish({
        type: placed,
        location: {
          x: selection.at.x,
          y: selection.at.y,
          label: "Dashboard selected origin",
        },
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error)) throw error;
      });
  }, [
    map.status.pointSelection,
    placementArmed,
    platform.publish,
    platform.selectedType,
    platform.client.startSpread,
  ]);

  /** Pick a hazard. Nothing is published until it is confirmed. */
  const handleEventSelect = (type: DisasterType | null) => {
    platform.setSelectedType(type);
    setPlacementArmed(false);
    map.send({ type: "map:arm-placement", payload: { hazard: null } });
    if (type)
      map.send({ type: "map:set-scenario", payload: { scenario: type } });
  };

  /**
   * Confirm the pick. Every hazard is placed on the map first — a disaster
   * without a location cannot be simulated or routed around.
   */
  const handleEventDeclare = (type: DisasterType) => {
    setPlacementArmed(true);
    // The map takes the area; nothing is published until the operator marks
    // where the incident is.
    map.send({
      type: "map:arm-placement",
      payload: {
        hazard: type as never,
        radiusMeters: 6000,
      },
    });
  };

  /**
   * Put the board back to how it opened: no alert, no annotations, the
   * simulation stopped, and the camera on the default district. Anything an
   * operator did during a walkthrough is cleared in one action.
   */
  const handleReset = () => {
    setPlacementArmed(false);
    platform.previewEvent(null);
    map.send({ type: "map:set-zones", payload: { zones: [] } });
    map.send({ type: "map:set-markers", payload: { markers: [] } });
    map.send({ type: "map:set-routes", payload: { routes: [] } });
    map.send({ type: "map:sim-control", payload: { action: "reset" } });
    map.send({ type: "map:set-scenario", payload: { scenario: "clear" } });
    map.send({ type: "map:set-view", payload: { mode: "flat" } });
    // The district stays: reset clears the incident, not where the operator
    // is looking.
  };

  // Platform-computed spread reaches the map as-is. The renderer draws the
  // field it is given; it does not decide how a hazard behaves.
  useEffect(() => {
    const latest = platform.frame;
    if (!latest) return;
    const { frame, values } = latest;
    const [west, south, east, north] = frame.bbox;
    map.send({
      type: "map:set-hazard-field",
      payload: {
        field: {
          hazard: frame.hazard,
          bbox: [west ?? 0, south ?? 0, east ?? 0, north ?? 0],
          width: frame.width,
          height: frame.height,
          values,
          horizonMinutes: frame.horizon_minutes,
          isStub: frame.is_stub,
        },
      },
    });
  }, [map.send, platform.frame]);

  const createTrainingEvent = (type: DisasterType): Promise<PlatformEvent> =>
    platform.publish({ type });

  return (
    <div
      className={`app-shell view-situation${assistantOpen ? " is-assistant-open" : ""}`}
    >
      <MapCanvas map={map} />
      <DashboardBrandHeader mobileUrl={mobileUrl} />

      <div className="workspace">
        <main
          className="route-main route-situation"
          id="main-content"
          tabIndex={-1}
        >
          <Routes>
            <Route
              path="/situation"
              element={
                <SituationPage
                  map={map}
                  client={platform.client}
                  selectedType={platform.selectedType}
                  placementArmed={placementArmed}
                  publishing={platform.publishing}
                  errorMessage={platform.errorMessage}
                  latestEvent={platform.event}
                  onMapCommand={handleMapCommand}
                  onEventSelect={handleEventSelect}
                  onEventDeclare={handleEventDeclare}
                  onPreviewEvent={platform.previewEvent}
                  onReset={handleReset}
                />
              }
            />
            <Route path="/" element={<Navigate to="/situation" replace />} />
            <Route path="*" element={<Navigate to="/situation" replace />} />
          </Routes>
        </main>
      </div>
      <AssistantDrawer
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        onCreateTrainingEvent={createTrainingEvent}
      />
    </div>
  );
}
