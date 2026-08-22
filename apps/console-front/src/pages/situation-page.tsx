import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";
import type {
  DisasterType,
  PlatformClient,
  PlatformEvent,
} from "@salgil/platform-client";
import { MapZoom } from "../components/MapZoom";
import { useI18n } from "../i18n";
import type { useMapBridge } from "../use-map-bridge";
import { DistrictStatusPanel } from "./district-status-panel";
import { EvacuationPanel } from "./evacuation-panel";
import { SituationControls } from "./situation-controls";

type MapBridge = ReturnType<typeof useMapBridge>;

interface SituationPageProps {
  readonly map: MapBridge;
  readonly client: PlatformClient;
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

export function SituationPage({
  map,
  client,
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
}: SituationPageProps) {
  const { t } = useI18n();

  return (
    <section className="view map-view" aria-labelledby="situation-title">
      <section className="spatial-workspace" aria-label={t("map.workspace")}>
        <MapZoom onMapCommand={onMapCommand} />
        <SituationControls
          map={map}
          selectedType={selectedType}
          placementArmed={placementArmed}
          publishing={publishing}
          errorMessage={errorMessage}
          latestEvent={latestEvent}
          onMapCommand={onMapCommand}
          onEventSelect={onEventSelect}
          eventMode={eventMode}
          onEventModeChange={onEventModeChange}
          onEventDeclare={onEventDeclare}
          onReset={onReset}
        />
        <DistrictStatusPanel
          districtCode={map.status.controls.districtCode}
          loading={map.status.controls.districtLoading}
          event={latestEvent}
        >
          <EvacuationPanel
            client={client}
            hazardType={latestEvent?.type ?? selectedType ?? "landslide"}
            districtCode={map.status.controls.districtCode}
            onMapCommand={onMapCommand}
          />
        </DistrictStatusPanel>
      </section>
    </section>
  );
}
