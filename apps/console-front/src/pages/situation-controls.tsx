import type {
  BasemapStyle,
  DashboardCommand,
} from "@salgil/map-webgpu-canvas/protocol";
import type { DisasterType, PlatformEvent } from "@salgil/platform-client";
import { motion } from "motion/react";
import { SegmentIndicator } from "../components/SegmentIndicator";
import { useI18n } from "../i18n";
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
  readonly eventMode: "simulate" | "declare";
  readonly onEventModeChange: (mode: "simulate" | "declare") => void;
  readonly onEventDeclare: (
    type: DisasterType,
    mode: "simulate" | "declare",
  ) => void;
  readonly onReset: () => void;
}

/**
 * Auto is a choice of its own: leave it on and the view follows the hazard —
 * 3D where water depth over terrain is the thing being read, 2D where extent
 * is. Picking 2D or 3D pins it, which is why all three are on the control
 * rather than the mode changing underneath a selection that still says 2D.
 */
const viewModes = ["auto", "flat", "tilted"] as const;

export function SituationControls({
  map,
  selectedType,
  placementArmed,
  publishing,
  errorMessage,
  latestEvent,
  onMapCommand,
  onEventSelect,
  eventMode,
  onEventModeChange,
  onEventDeclare,
  onReset,
}: SituationControlsProps) {
  const { t } = useI18n();
  const controls = map.status.controls;
  const basemapLabels: Readonly<Record<BasemapStyle, string>> = {
    satellite: t("map.satellite"),
    map: t("map.standard"),
  };

  return (
    <aside
      className="operations-panel operations-panel-left"
      aria-label={t("map.controls")}
    >
      <div className="panel-intro">
        <h1 id="situation-title">{t("map.title")}</h1>
      </div>
      <div className="rail-section">
        <EventControls
          selectedType={selectedType}
          placementArmed={placementArmed}
          publishing={publishing}
          errorMessage={errorMessage}
          latestEvent={latestEvent}
          onSelect={onEventSelect}
          mode={eventMode}
          onModeChange={onEventModeChange}
          onDeclare={onEventDeclare}
          onReset={onReset}
        />
        <div className="map-display-controls">
          <fieldset className="compact-controls">
            <legend>{t("map.view")}</legend>
            <motion.div className="segmented-track" layoutRoot>
              {viewModes.map((mode) => (
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
                  <span className="segmented-label">
                    {t(`map.view.${mode}`)}
                    {/* Auto is otherwise opaque: this says what it picked. */}
                    {mode === "auto" && controls.viewMode === "auto" ? (
                      <em>{t(`map.view.${controls.effectiveView}`)}</em>
                    ) : null}
                  </span>
                </button>
              ))}
            </motion.div>
          </fieldset>
          <fieldset className="compact-controls">
            <legend>{t("map.basemap")}</legend>
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
