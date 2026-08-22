import type {
  BasemapStyle,
  DashboardCommand,
  ViewMode,
} from "@salgil/map-webgpu-canvas/protocol";
import type { DisasterType, PlatformEvent } from "@salgil/platform-client";
import { motion } from "motion/react";
import { SegmentIndicator } from "../components/SegmentIndicator";
import type { useMapBridge } from "../use-map-bridge";
import { DistrictSelector } from "./district-selector";
import { EventControls } from "./event-controls";

type MapBridge = ReturnType<typeof useMapBridge>;

interface SituationControlsProps {
  readonly map: MapBridge;
  readonly selectedType: DisasterType | null;
  readonly placementArmed: boolean;
  readonly publishing: boolean;
  readonly errorMessage: string;
  readonly latestEvent: PlatformEvent | null;
  readonly onMapCommand: (command: DashboardCommand) => void;
  readonly onEventSelect: (type: DisasterType | null) => void;
  readonly onEventDeclare: (type: DisasterType, needsLocation: boolean) => void;
  readonly onReset: () => void;
}

/**
 * Only the two the operator chooses between. "auto" still exists in the
 * protocol, but exposing it meant a hazard button could silently flip the
 * view mode out from under a deliberate 2D/3D choice.
 */
const viewLabels: Record<Exclude<ViewMode, "auto">, string> = {
  flat: "2D",
  tilted: "3D",
};

const basemapLabels: Record<BasemapStyle, string> = {
  satellite: "Satellite",
  map: "Map",
};

export function SituationControls({
  map,
  selectedType,
  placementArmed,
  publishing,
  errorMessage,
  latestEvent,
  onMapCommand,
  onEventSelect,
  onEventDeclare,
  onReset,
}: SituationControlsProps) {
  const controls = map.status.controls;

  return (
    <aside
      className="operations-panel operations-panel-left"
      aria-label="Event and map controls"
    >
      <div className="panel-intro">
        <h1 id="situation-title">Cheongsong operational map</h1>
      </div>
      <div className="rail-section">
        <EventControls
          selectedType={selectedType}
          placementArmed={placementArmed}
          publishing={publishing}
          errorMessage={errorMessage}
          latestEvent={latestEvent}
          onSelect={onEventSelect}
          onDeclare={onEventDeclare}
          onReset={onReset}
        />
        <div className="map-display-controls">
          <fieldset className="compact-controls">
            <legend>Map view</legend>
            <motion.div
              className="segmented-track segmented-track-two"
              layoutRoot
            >
              {(["flat", "tilted"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={controls.viewMode === mode}
                  onClick={() =>
                    onMapCommand({ type: "map:set-view", payload: { mode } })
                  }
                >
                  {controls.viewMode === mode ? (
                    <SegmentIndicator layoutId="map-view-segment" />
                  ) : null}
                  <span className="segmented-label">{viewLabels[mode]}</span>
                </button>
              ))}
            </motion.div>
          </fieldset>
          <fieldset className="compact-controls">
            <legend>Basemap</legend>
            <motion.div
              className="segmented-track segmented-track-two"
              layoutRoot
            >
              {(["satellite", "map"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={controls.basemap === style}
                  onClick={() =>
                    onMapCommand({
                      type: "map:set-basemap",
                      payload: { style },
                    })
                  }
                >
                  {controls.basemap === style ? (
                    <SegmentIndicator layoutId="basemap-segment" />
                  ) : null}
                  <span className="segmented-label">
                    {basemapLabels[style]}
                  </span>
                </button>
              ))}
            </motion.div>
          </fieldset>
        </div>
        <DistrictSelector
          selected={controls.districtCode}
          loading={controls.districtLoading}
          onSelect={(code) =>
            onMapCommand({ type: "map:focus-district", payload: { code } })
          }
        />
      </div>
    </aside>
  );
}
