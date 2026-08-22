import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";
import {
  type CommunityName,
  communities,
  DEFAULT_MAP_SCENARIO,
  scenarioOptions,
  type View,
} from "../domain";
import type { useMapBridge } from "../use-map-bridge";
import { SituationControls } from "./situation-controls";
import { SituationInspector } from "./situation-inspector";

type MapBridge = ReturnType<typeof useMapBridge>;

interface SituationPageProps {
  readonly assistantOpen: boolean;
  readonly map: MapBridge;
  readonly selectedCommunity: CommunityName;
  readonly reported: boolean;
  readonly onSelectCommunity: (name: CommunityName) => void;
  readonly onNavigate: (view: View) => void;
  readonly onMapCommand: (command: DashboardCommand) => void;
}

export function SituationPage({
  assistantOpen,
  map,
  selectedCommunity,
  reported,
  onSelectCommunity,
  onNavigate,
  onMapCommand,
}: SituationPageProps) {
  const selected = communities.find((item) => item.name === selectedCommunity);
  const selectedScenario =
    scenarioOptions.find(
      (option) => option.value === map.status.controls.scenario,
    ) ??
    scenarioOptions.find((option) => option.value === DEFAULT_MAP_SCENARIO);

  if (!selected || !selectedScenario) return null;

  return (
    <section className="view map-view" aria-labelledby="situation-title">
      <section
        className="spatial-workspace"
        aria-label="Cheongsong spatial operations workspace"
      >
        <SituationControls
          map={map}
          selectedCommunity={selectedCommunity}
          selectedScenario={selectedScenario}
          onSelectCommunity={onSelectCommunity}
          onMapCommand={onMapCommand}
          onNavigate={onNavigate}
        />

        <div className="map-stage">
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

        <SituationInspector
          community={selected}
          hidden={assistantOpen}
          reported={reported}
          onSelectCommunity={onSelectCommunity}
          onNavigate={onNavigate}
        />
      </section>
    </section>
  );
}
