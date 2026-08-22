import type {
  DashboardCommand,
  MapStatePayload,
  Scenario,
  ViewMode,
} from "@salgil/map-webgpu-canvas/protocol";
import { DEFAULT_MAP_SCENARIO, DEFAULT_RAINFALL_MM_PER_HOUR } from "./domain";

export interface MapControlState {
  readonly scenario: Scenario;
  readonly rainfallMmPerHour: number;
  readonly viewMode: ViewMode;
  readonly playing: boolean;
  readonly overlayEnabled: boolean;
}

export type PendingMapControls = Partial<
  Pick<
    MapControlState,
    "scenario" | "rainfallMmPerHour" | "viewMode" | "playing"
  >
>;

interface OptimisticControlUpdate {
  readonly controls: MapControlState;
  readonly pending: PendingMapControls;
}

export const initialMapControls: MapControlState = {
  scenario: DEFAULT_MAP_SCENARIO,
  rainfallMmPerHour: DEFAULT_RAINFALL_MM_PER_HOUR,
  viewMode: "tilted",
  playing: false,
  overlayEnabled: true,
};

export function applyOptimisticControlCommand(
  controls: MapControlState,
  pending: PendingMapControls,
  command: DashboardCommand,
): OptimisticControlUpdate {
  switch (command.type) {
    case "map:set-scenario": {
      const rainfall = command.payload.rainfallMmPerHour;
      return {
        controls: {
          ...controls,
          scenario: command.payload.scenario,
          ...(rainfall === undefined ? {} : { rainfallMmPerHour: rainfall }),
        },
        pending: {
          ...pending,
          scenario: command.payload.scenario,
          ...(rainfall === undefined ? {} : { rainfallMmPerHour: rainfall }),
        },
      };
    }
    case "map:set-rainfall":
      return {
        controls: {
          ...controls,
          rainfallMmPerHour: command.payload.mmPerHour,
        },
        pending: {
          ...pending,
          rainfallMmPerHour: command.payload.mmPerHour,
        },
      };
    case "map:set-view":
      return {
        controls: { ...controls, viewMode: command.payload.mode },
        pending: { ...pending, viewMode: command.payload.mode },
      };
    case "map:sim-control": {
      if (command.payload.action === "reset") return { controls, pending };
      const playing = command.payload.action === "play";
      return {
        controls: { ...controls, playing },
        pending: { ...pending, playing },
      };
    }
    case "map:set-overlay":
      return {
        controls: { ...controls, overlayEnabled: command.payload.enabled },
        pending,
      };
    case "map:ignite":
    case "map:trigger":
    case "map:set-basemap":
    case "map:set-zones":
    case "map:set-camera":
    case "map:ping":
      return { controls, pending };
  }
}

export function reconcileMapControls(
  controls: MapControlState,
  pending: PendingMapControls,
  mapState: MapStatePayload,
): OptimisticControlUpdate {
  const keepScenario =
    pending.scenario !== undefined && pending.scenario !== mapState.scenario;
  const keepRainfall =
    pending.rainfallMmPerHour !== undefined &&
    pending.rainfallMmPerHour !== mapState.rainfallMmPerHour;
  const keepView =
    pending.viewMode !== undefined && pending.viewMode !== mapState.viewMode;
  const keepPlaying =
    pending.playing !== undefined && pending.playing !== mapState.playing;

  return {
    controls: {
      ...controls,
      scenario: keepScenario ? controls.scenario : mapState.scenario,
      rainfallMmPerHour: keepRainfall
        ? controls.rainfallMmPerHour
        : mapState.rainfallMmPerHour,
      viewMode: keepView ? controls.viewMode : mapState.viewMode,
      playing: keepPlaying ? controls.playing : mapState.playing,
    },
    pending: {
      ...(keepScenario ? { scenario: pending.scenario } : {}),
      ...(keepRainfall ? { rainfallMmPerHour: pending.rainfallMmPerHour } : {}),
      ...(keepView ? { viewMode: pending.viewMode } : {}),
      ...(keepPlaying ? { playing: pending.playing } : {}),
    },
  };
}
