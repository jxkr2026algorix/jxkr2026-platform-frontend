import type {
  BasemapStyle,
  DashboardCommand,
  ViewMode,
} from "@salgil/map-webgpu-canvas/protocol";
import { motion } from "motion/react";
import { FloatingSelect } from "../components/FloatingSelect";
import { RangeControl } from "../components/RangeControl";
import { SegmentIndicator } from "../components/SegmentIndicator";
import {
  type CommunityName,
  communities,
  type ScenarioOption,
  scenarioOptions,
  type View,
} from "../domain";
import type { useMapBridge } from "../use-map-bridge";

type MapBridge = ReturnType<typeof useMapBridge>;

interface SituationControlsProps {
  readonly map: MapBridge;
  readonly selectedCommunity: CommunityName;
  readonly selectedScenario: ScenarioOption;
  readonly onSelectCommunity: (name: CommunityName) => void;
  readonly onMapCommand: (command: DashboardCommand) => void;
  readonly onNavigate: (view: View) => void;
}

const viewLabels: Record<ViewMode, string> = {
  flat: "2D",
  tilted: "3D",
  auto: "Auto",
};

const basemapLabels: Record<BasemapStyle, string> = {
  satellite: "Satellite",
  map: "Map",
};

export function SituationControls({
  map,
  selectedCommunity,
  selectedScenario,
  onSelectCommunity,
  onMapCommand,
  onNavigate,
}: SituationControlsProps) {
  const mapState = map.status.state;
  const controls = map.status.controls;

  const selectScenario = (value: string) => {
    const scenario = scenarioOptions.find((option) => option.value === value);
    if (scenario) {
      onMapCommand({
        type: "map:set-scenario",
        payload: { scenario: scenario.value },
      });
    }
  };

  return (
    <aside
      className="operations-panel operations-panel-left"
      aria-label="Incident overview, map controls, and community priority"
    >
      <div className="panel-intro">
        <p className="breadcrumb">Incident 2026-0822-01 · Level 2 response</p>
        <h1 id="situation-title">Cheongsong operational map</h1>
        <div className="panel-intro-actions">
          <span className="state-text is-approved">
            <i />
            Live operating picture
          </span>
          <button
            className="button primary"
            type="button"
            onClick={() => onNavigate("plan")}
          >
            Review plan
          </button>
        </div>
        <div className="panel-map-status">
          <span>Gyeongsangbuk-do · live simulation</span>
          <b>{mapState ? `${Math.round(mapState.fps)} fps` : "Connecting"}</b>
        </div>
      </div>
      <div className="rail-section">
        <p className="rail-section-label">Simulation</p>
        <FloatingSelect
          label="Incident scenario"
          value={selectedScenario.value}
          options={scenarioOptions.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onValueChange={selectScenario}
        />
        <p className="scenario-summary">{selectedScenario.summary}</p>
        <RangeControl
          label="Rainfall"
          min={0}
          max={120}
          unit="mm/h"
          value={controls.rainfallMmPerHour}
          onValueChange={(mmPerHour) =>
            onMapCommand({
              type: "map:set-rainfall",
              payload: { mmPerHour },
            })
          }
        />
        <div className="map-display-controls">
          <fieldset className="compact-controls">
            <legend>Map view</legend>
            <motion.div className="segmented-track" layoutRoot>
              {(["flat", "tilted", "auto"] as const).map((mode) => (
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
        <label className="check-row">
          <input
            className="check-input"
            type="checkbox"
            checked={controls.overlayEnabled}
            onChange={(event) =>
              onMapCommand({
                type: "map:set-overlay",
                payload: { enabled: event.target.checked },
              })
            }
          />
          <span className="check-box" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <title>Selected</title>
              <path d="m3.5 8.2 2.8 2.8 6.2-6.2" />
            </svg>
          </span>
          <span className="check-label">Hazard overlay</span>
          <b>3 layers</b>
        </label>
        <div className="simulation-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() =>
              onMapCommand({
                type: "map:sim-control",
                payload: { action: controls.playing ? "pause" : "play" },
              })
            }
          >
            {controls.playing ? "Pause" : "Play"}
          </button>
          <button
            className="button text"
            type="button"
            onClick={() =>
              onMapCommand({
                type: "map:sim-control",
                payload: { action: "reset" },
              })
            }
          >
            Reset simulation
          </button>
        </div>
      </div>

      <div className="rail-section priority-section">
        <div className="rail-title">
          <p className="rail-section-label">Community priority</p>
          <span>86 residents</span>
        </div>
        <div
          className="community-list"
          role="listbox"
          aria-label="Community priority"
        >
          {communities.map((community, index) => (
            <button
              className="community-row"
              key={community.name}
              type="button"
              role="option"
              aria-selected={selectedCommunity === community.name}
              onClick={() => onSelectCommunity(community.name)}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{community.name}</strong>
                <small>{community.hazard}</small>
              </span>
              <b>{community.residents}</b>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
