import type {
  DashboardCommand,
  ViewMode,
} from "@salgil/map-webgpu-canvas/protocol";
import {
  type CommunityName,
  communities,
  DEFAULT_MAP_SCENARIO,
  DEFAULT_RAINFALL_MM_PER_HOUR,
  scenarioOptions,
  type View,
} from "../domain";
import type { useMapBridge } from "../use-map-bridge";

type MapBridge = ReturnType<typeof useMapBridge>;

interface SituationPageProps {
  map: MapBridge;
  selectedCommunity: CommunityName;
  reported: boolean;
  onSelectCommunity: (name: CommunityName) => void;
  onNavigate: (view: View) => void;
  onMapCommand: (command: DashboardCommand) => void;
}

const viewLabels: Record<ViewMode, string> = {
  flat: "2D",
  tilted: "3D",
  auto: "Auto",
};

export function SituationPage({
  map,
  selectedCommunity,
  reported,
  onSelectCommunity,
  onNavigate,
  onMapCommand,
}: SituationPageProps) {
  const selected = communities.find((item) => item.name === selectedCommunity);
  const mapState = map.status.state;
  const selectedScenario =
    scenarioOptions.find(
      (option) => option.value === (mapState?.scenario ?? DEFAULT_MAP_SCENARIO),
    ) ??
    scenarioOptions.find((option) => option.value === DEFAULT_MAP_SCENARIO);

  if (!selected || !selectedScenario) return null;

  const handleScenario = (value: string) => {
    const scenario = scenarioOptions.find((option) => option.value === value);
    if (scenario) {
      onMapCommand({
        type: "map:set-scenario",
        payload: { scenario: scenario.value },
      });
    }
  };

  const handleView = (mode: ViewMode) => {
    onMapCommand({ type: "map:set-view", payload: { mode } });
  };

  return (
    <section className="view map-view" aria-labelledby="situation-title">
      <div className="spatial-heading">
        <div>
          <p className="breadcrumb">Incident 2026-0822-01 · Level 2 response</p>
          <h1 id="situation-title">Cheongsong operational map</h1>
          <p>
            Multi-hazard exposure, evacuation routes, shelters, and field
            resources.
          </p>
        </div>
        <div className="spatial-actions">
          <span className="state-text is-approved">
            <i />
            Live operating picture
          </span>
          <button
            className="button primary"
            type="button"
            onClick={() => onNavigate("plan")}
          >
            Review evacuation plan
          </button>
        </div>
      </div>

      <section
        className="spatial-workspace"
        aria-label="Cheongsong spatial operations workspace"
      >
        <aside
          className="layer-rail"
          aria-label="Map controls and community priority"
        >
          <div className="rail-section">
            <p className="rail-section-label">Simulation</p>
            <label className="select-field">
              <span>Incident scenario</span>
              <select
                value={selectedScenario.value}
                onChange={(event) => handleScenario(event.target.value)}
              >
                {scenarioOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="scenario-summary">{selectedScenario.summary}</p>
            <label className="range-field">
              <span>
                <b>Rainfall</b>
                <strong>
                  {Math.round(
                    mapState?.rainfallMmPerHour ?? DEFAULT_RAINFALL_MM_PER_HOUR,
                  )}{" "}
                  mm/h
                </strong>
              </span>
              <input
                type="range"
                min="0"
                max="120"
                value={
                  mapState?.rainfallMmPerHour ?? DEFAULT_RAINFALL_MM_PER_HOUR
                }
                onChange={(event) =>
                  onMapCommand({
                    type: "map:set-rainfall",
                    payload: { mmPerHour: Number(event.target.value) },
                  })
                }
              />
            </label>
            <fieldset className="compact-controls">
              <legend className="sr-only">Map view</legend>
              {(["flat", "tilted", "auto"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={mapState?.viewMode === mode}
                  onClick={() => handleView(mode)}
                >
                  {viewLabels[mode]}
                </button>
              ))}
            </fieldset>
            <label className="check-row">
              <input
                type="checkbox"
                checked={map.status.overlayEnabled}
                onChange={(event) =>
                  onMapCommand({
                    type: "map:set-overlay",
                    payload: { enabled: event.target.checked },
                  })
                }
              />
              <span>Hazard overlay</span>
              <b>3</b>
            </label>
            <div className="simulation-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  onMapCommand({
                    type: "map:sim-control",
                    payload: { action: mapState?.playing ? "pause" : "play" },
                  })
                }
              >
                {mapState?.playing ? "Pause" : "Play"}
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

        <div className="map-stage">
          <div className="map-command-bar">
            <div>
              <strong>Operational area</strong>
              <span>Gyeongsangbuk-do · live simulation</span>
            </div>
            <div className="map-stat-cluster">
              <span>
                <b>{mapState ? Math.round(mapState.fps) : "—"}</b> fps
              </span>
              <span>
                <b>{selectedScenario.label}</b> scenario
              </span>
            </div>
          </div>
          {reported && (
            <div className="map-revision-banner" role="status">
              <strong>Route revised</strong>
              <span>North bypass · new access closure</span>
            </div>
          )}
          <section
            className="operations-timeline"
            aria-label="Latest operational events"
          >
            <div className="timeline-heading">Latest events</div>
            <ol>
              <li>
                <time>{reported ? "14:18" : "14:10"}</time>
                <span>
                  {reported
                    ? "North bypass proposed after new closure"
                    : "County Road 12 closure verified"}
                </span>
              </li>
              <li>
                <time>14:06</time>
                <span>Wildfire watch added near Wolwe</span>
              </li>
              <li>
                <time>13:58</time>
                <span>Sangchon moved to evacuation priority 1</span>
              </li>
            </ol>
          </section>
        </div>

        <aside
          className="object-inspector"
          aria-live="polite"
          aria-label="Selected community details"
        >
          <div className="inspector-heading">
            <span>Selected community</span>
            <strong>{selected.name}</strong>
            <small>{selected.status}</small>
          </div>
          <dl className="inspector-data">
            <div>
              <dt>Residents</dt>
              <dd>{selected.residents}</dd>
            </div>
            <div>
              <dt>Primary hazard</dt>
              <dd>{selected.hazard}</dd>
            </div>
            <div>
              <dt>Support needs</dt>
              <dd>{selected.support}</dd>
            </div>
            <div>
              <dt>Assigned shelter</dt>
              <dd>{selected.shelter}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>{selected.transport}</dd>
            </div>
            <div>
              <dt>Last update</dt>
              <dd>
                {reported && selected.name === "Sangchon"
                  ? "14:18 · field report"
                  : selected.update}
              </dd>
            </div>
          </dl>
          <div className="inspector-note">
            <span>Decision basis</span>
            <p>
              {reported && selected.name === "Sangchon"
                ? "A new closure blocks the eastern approach. Use the north bypass and review the plan again."
                : selected.note}
            </p>
          </div>
          <button
            className="button primary inspector-action"
            type="button"
            onClick={() => onNavigate("plan")}
          >
            Review assignment
          </button>
          <button
            className="button secondary inspector-action"
            type="button"
            onClick={() => onSelectCommunity(selected.name)}
          >
            Center on map
          </button>
        </aside>
      </section>
    </section>
  );
}
