import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";
import type { DisasterType, PlatformEvent } from "@salgil/platform-client";
import { useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { Navigate, NavLink, Route, Routes } from "react-router";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { DEFAULT_DISTRICT_CODE } from "./domain";
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
    map.send({ type: "map:sim-control", payload: { action: "pause" } });
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
    void platform
      .publish({
        type: platform.selectedType,
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
  ]);

  const handleEventSelect = (type: DisasterType, needsLocation: boolean) => {
    platform.setSelectedType(type);
    if (needsLocation) {
      setPlacementArmed(true);
      map.send({ type: "map:set-scenario", payload: { scenario: type } });
      map.send({ type: "map:set-view", payload: { mode: "auto" } });
      map.send({ type: "map:sim-control", payload: { action: "pause" } });
      return;
    }
    setPlacementArmed(false);
    void platform
      .publish({
        type,
        ...(type === "rain" ? { rainfallMmPerHour: 72 } : {}),
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error)) throw error;
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
    map.send({
      type: "map:focus-district",
      payload: { code: DEFAULT_DISTRICT_CODE },
    });
  };

  const createTrainingEvent = (type: DisasterType): Promise<PlatformEvent> =>
    platform.publish({ type });

  return (
    <div
      className={`app-shell view-situation${assistantOpen ? " is-assistant-open" : ""}`}
    >
      <div className="map-canvas">
        <iframe
          ref={map.frame.ref}
          src={map.frame.src}
          title="SALGIL 3D multi-hazard map"
          allow="fullscreen"
        />
        {map.status.connection !== "ready" && (
          <div
            className="map-feedback"
            role={map.status.connection === "error" ? "alert" : "status"}
          >
            <strong>
              {map.status.connection === "loading"
                ? "Loading operational map"
                : "3D map unavailable"}
            </strong>
            <span>
              {map.status.errorMessage ||
                "Operational controls remain available while the renderer reconnects."}
            </span>
          </div>
        )}
      </div>
      <aside className="side-nav">
        <NavLink
          className="brand"
          to="/situation"
          aria-label="SALGIL operations home"
        >
          <span className="brand-lockup">
            <img src="/salgil-mark.svg" alt="" />
            <strong>Salgil</strong>
          </span>
        </NavLink>
        <span className="mobile-qr" role="img" aria-label="Mobile demo QR code">
          <QRCode value={mobileUrl} size={42} level="M" />
        </span>
      </aside>

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
