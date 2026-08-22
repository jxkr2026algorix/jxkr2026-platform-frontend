import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";
import type {
  DisasterType,
  IncidentMode,
  PlatformEvent,
} from "@salgil/platform-client";
import type { useMapBridge } from "../use-map-bridge";
import { DistrictStatusPanel } from "./district-status-panel";
import { SituationControls } from "./situation-controls";

type MapBridge = ReturnType<typeof useMapBridge>;

interface SituationPageProps {
  readonly map: MapBridge;
  readonly mode: IncidentMode;
  readonly selectedType: DisasterType;
  readonly placementArmed: boolean;
  readonly publishing: boolean;
  readonly errorMessage: string;
  readonly latestEvent: PlatformEvent | null;
  readonly onMapCommand: (command: DashboardCommand) => void;
  readonly onModeChange: (mode: IncidentMode) => void;
  readonly onEventSelect: (type: DisasterType, needsLocation: boolean) => void;
}

export function SituationPage({
  map,
  mode,
  selectedType,
  placementArmed,
  publishing,
  errorMessage,
  latestEvent,
  onMapCommand,
  onModeChange,
  onEventSelect,
}: SituationPageProps) {
  return (
    <section className="view map-view" aria-labelledby="situation-title">
      <section
        className="spatial-workspace"
        aria-label="Cheongsong spatial operations workspace"
      >
        <SituationControls
          map={map}
          mode={mode}
          selectedType={selectedType}
          placementArmed={placementArmed}
          publishing={publishing}
          errorMessage={errorMessage}
          latestEvent={latestEvent}
          onMapCommand={onMapCommand}
          onModeChange={onModeChange}
          onEventSelect={onEventSelect}
        />
        <DistrictStatusPanel
          districtCode={map.status.controls.districtCode}
          loading={map.status.controls.districtLoading}
          event={latestEvent}
        />
      </section>
    </section>
  );
}
