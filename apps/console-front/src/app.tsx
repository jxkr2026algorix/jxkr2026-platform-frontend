import { districtAt } from "@salgil/map-webgpu-canvas/districts";
import type {
  DashboardCommand,
  TriggerKind,
} from "@salgil/map-webgpu-canvas/protocol";
import {
  type DisasterType,
  HAZARD_TO_SCENARIO,
  type PlatformEvent,
  SCENARIO_TO_HAZARD,
} from "@salgil/platform-client";
import { type CSSProperties, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import type { IncidentIntent } from "./assistant-intent";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { DashboardBrandHeader } from "./components/DashboardBrandHeader";
import { MapCanvas } from "./components/MapCanvas";
import { useI18n } from "./i18n";
import { SituationPage } from "./pages/situation-page";
import { useSidebarTheme } from "./theme";
import { useAssistantWidth } from "./use-assistant-width";
import { useMapBridge } from "./use-map-bridge";
import { usePlatformStream } from "./use-platform-stream";

/** Hazards that start at a point, so a trigger has somewhere to go. */
const POINT_HAZARDS: readonly DisasterType[] = [
  "wildfire",
  "flood",
  "landslide",
  "earthquake",
  "tsunami",
  "nuclear",
  "chemical",
];

export function App() {
  const { locale, t } = useI18n();
  const { sidebarTheme } = useSidebarTheme();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistant = useAssistantWidth();
  const [placementArmed, setPlacementArmed] = useState(false);
  /**
   * What the next map click means. Rehearsing a scenario must not reach the
   * platform: a drill that pages residents is worse than no drill.
   */
  const [placementMode, setPlacementMode] = useState<"simulate" | "declare">(
    "simulate",
  );
  const map = useMapBridge();
  const platform = usePlatformStream();
  /**
   * The address the QR encodes. Deliberately the deployed one and not
   * `VITE_MOBILE_URL`: that points at this machine, and a phone in the room
   * cannot reach localhost. A QR nobody can open is worse than no QR.
   */
  const mobileUrl =
    import.meta.env.VITE_MOBILE_PUBLIC_URL ??
    "https://mobile.salgil.gyeongbuk.kr";
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
        // Only when there is no real coordinate. An incident that knows where
        // it is gets its trigger from the effect below, off lat/lon; running
        // both put two ignition points on the map for one fire.
        if (event.location && !event.at) {
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
    if (placementMode === "simulate") {
      // Rehearsal: the map runs it and nothing leaves this screen.
      return;
    }
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
        // The real coordinate, whenever the map has a georeference for the
        // click. `location` is a point in *this* viewport and means nothing
        // outside it: the phone draws the same x/y against its own camera and
        // its own aspect ratio, and put the fire somewhere else entirely.
        ...(selection.lat !== undefined && selection.lon !== undefined
          ? { at: { lat: selection.lat, lon: selection.lon } }
          : {}),
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error)) throw error;
      });
  }, [
    map.status.pointSelection,
    placementArmed,
    placementMode,
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
  /**
   * Picking a hazard arms the map straight away. The mode segment already
   * says what the click will do, so a second confirm step was a click without
   * a decision in it.
   */
  const handleEventDeclare = (
    type: DisasterType,
    mode: "simulate" | "declare",
  ) => {
    platform.setSelectedType(type);
    setPlacementArmed(true);
    setPlacementMode(mode);
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
   * Put the board back to how it opened: no annotations, the simulation
   * stopped, and the camera on the default district. Anything an operator did
   * during a walkthrough is cleared in one action.
   *
   * It does not clear the alert. An incident the platform still has open is
   * not something this screen gets to decide is over.
   */
  const handleReset = () => {
    setPlacementArmed(false);
    map.send({ type: "map:set-zones", payload: { zones: [] } });
    map.send({ type: "map:set-markers", payload: { markers: [] } });
    map.send({ type: "map:set-routes", payload: { routes: [] } });
    map.send({ type: "map:sim-control", payload: { action: "reset" } });
    map.send({ type: "map:set-scenario", payload: { scenario: "clear" } });
    map.send({ type: "map:set-view", payload: { mode: "auto" } });
    // The district stays: reset clears the incident, not where the operator
    // is looking.
  };

  /**
   * An incident declared on the stream — by the assistant, or by another
   * console — is shown where it actually is. The polling path can only offer
   * a normalized `map_origin`, which an incident raised from outside this
   * browser never has; the stream carries real coordinates, so the map is
   * driven from those.
   */
  useEffect(() => {
    const scenario = platform.declared
      ? HAZARD_TO_SCENARIO[platform.declared.hazard]
      : platform.event?.type;
    const point = platform.incidentAt;
    if (!scenario || !point) return;
    const { lat, lon } = point;
    const district = districtAt(lat, lon);
    if (district) {
      map.send({ type: "map:focus-district", payload: { code: district } });
    }
    map.send({ type: "map:set-scenario", payload: { scenario } });
    // Only hazards that start somewhere get a trigger. A heatwave has no
    // ignition point, and asking the map for one lands the whole county
    // under a hazard the model never placed there.
    if (POINT_HAZARDS.includes(scenario)) {
      map.send({
        type: "map:trigger",
        payload: { hazard: scenario as TriggerKind, lat, lon },
      });
      // Close in on the origin. Framed to the whole county the fire is a few
      // pixels across and the operator sees nothing happen at all.
      map.send({
        type: "map:set-camera",
        payload: {
          center: { lat, lon },
          distanceMeters: scenario === "earthquake" ? 60_000 : 24_000,
        },
      });
    }
    map.send({ type: "map:sim-control", payload: { action: "play" } });
  }, [map.send, platform.declared, platform.event, platform.incidentAt]);

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

  /**
   * An incident the assistant was asked for. The district it named rides along
   * as a region code and real coordinates: without them the platform files the
   * incident under this console's own county and the map, having nowhere to
   * put it, falls back to the shared demo site — which is how a fire asked for
   * in Pohang ended up burning next to Cheongsong.
   */
  const createTrainingEvent = ({
    type,
    district,
  }: IncidentIntent): Promise<PlatformEvent> =>
    platform.publish({
      type,
      ...(district
        ? {
            regionCode: district.code,
            at: { lat: district.center[1], lon: district.center[0] },
            headline: t("assistant.incidentHeadline", {
              hazard: t(`event.${type}`),
              region: locale === "ko" ? district.name : district.nameEn,
            }),
          }
        : {}),
    });

  return (
    <div
      className={`app-shell view-situation${assistantOpen ? " is-assistant-open" : ""}`}
      data-sidebar-theme={sidebarTheme}
      // The timeline underneath sizes itself against the panel, so the width
      // lives on the shell rather than only on the panel that owns the handle.
      style={
        { "--assistant-drawer-width": `${assistant.width}px` } as CSSProperties
      }
    >
      <MapCanvas map={map} />
      <DashboardBrandHeader />
      {/* Across the top of the screen, not tucked into a panel: if the whole
          view does not say this is an exercise, someone will act on it. */}
      {platform.drill ? (
        <div className="drill-banner" role="status">
          <strong>{t("drill.banner")}</strong>
          <span>{platform.drill.title}</span>
        </div>
      ) : null}

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
                  mobileUrl={mobileUrl}
                  onMapCommand={handleMapCommand}
                  onEventSelect={handleEventSelect}
                  eventMode={placementMode}
                  onEventModeChange={setPlacementMode}
                  onEventDeclare={handleEventDeclare}
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
        width={assistant.width}
        onWidthChange={assistant.setWidth}
      />
    </div>
  );
}
