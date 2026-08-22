import { PROVINCE_CODE } from "@salgil/map-webgpu-canvas/districts";
import type {
  BasemapStyle,
  DashboardCommand,
  MapStatePayload,
  Scenario,
  ViewMode,
} from "@salgil/map-webgpu-canvas/protocol";
import {
  DEFAULT_DISTRICT_CODE,
  DEFAULT_MAP_SCENARIO,
  DEFAULT_RAINFALL_MM_PER_HOUR,
} from "./domain";

export interface MapControlState {
  readonly basemap: BasemapStyle;
  readonly scenario: Scenario;
  readonly rainfallMmPerHour: number;
  /** What the operator chose, including "auto". */
  readonly viewMode: ViewMode;
  /** What the map is actually showing. Under "auto" the two differ. */
  readonly effectiveView: Exclude<ViewMode, "auto">;
  readonly playing: boolean;
  readonly overlayEnabled: boolean;
  /** Focused 시/군 code, or null for the province-wide view. */
  readonly districtCode: string | null;
  readonly districtOverlay: boolean;
  /** True while the renderer reloads terrain for a remote district. */
  readonly districtLoading: boolean;
}

export type PendingMapControls = Partial<
  Pick<
    MapControlState,
    | "basemap"
    | "scenario"
    | "rainfallMmPerHour"
    | "viewMode"
    | "playing"
    | "districtCode"
    | "districtOverlay"
  >
>;

interface OptimisticControlUpdate {
  readonly controls: MapControlState;
  readonly pending: PendingMapControls;
}

export const initialMapControls: MapControlState = {
  basemap: "satellite",
  scenario: DEFAULT_MAP_SCENARIO,
  rainfallMmPerHour: DEFAULT_RAINFALL_MM_PER_HOUR,
  // Auto by default: the view follows the hazard, and with nothing running
  // that resolves to 2D — which is where the operator wants to start anyway.
  viewMode: "auto",
  effectiveView: "flat",
  playing: false,
  // Off until asked for: susceptibility is an analytical layer, and at
  // province scale its cells are 600 m across and read as blocky noise.
  overlayEnabled: false,
  districtCode: DEFAULT_DISTRICT_CODE,
  districtOverlay: true,
  districtLoading: false,
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
    case "map:set-basemap":
      return {
        controls: { ...controls, basemap: command.payload.style },
        pending: { ...pending, basemap: command.payload.style },
      };
    case "map:focus-district": {
      const code = command.payload.code;
      // The renderer treats the province sentinel and null identically; the
      // console keeps only null so the 비례대표 row stays the selected one.
      const districtCode = code === PROVINCE_CODE ? null : code;
      return {
        controls: { ...controls, districtCode, districtLoading: true },
        pending: { ...pending, districtCode },
      };
    }
    case "map:set-district-overlay":
      return {
        controls: { ...controls, districtOverlay: command.payload.enabled },
        pending: { ...pending, districtOverlay: command.payload.enabled },
      };
    case "map:ignite":
    case "map:trigger":
    case "map:set-zones":
    case "map:set-markers":
    case "map:set-routes":
    case "map:set-camera":
    case "map:zoom":
    case "map:set-hazard-field":
    case "map:arm-placement":
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
  const keepBasemap =
    pending.basemap !== undefined && pending.basemap !== mapState.basemap;
  // A focus request stays pending until the renderer reports the same
  // district, which for 울릉군 is only after its terrain has loaded.
  const keepDistrict =
    pending.districtCode !== undefined &&
    pending.districtCode !== mapState.district.selected;
  const keepDistrictOverlay =
    pending.districtOverlay !== undefined &&
    pending.districtOverlay !== mapState.district.overlay;

  return {
    controls: {
      ...controls,
      basemap: keepBasemap ? controls.basemap : mapState.basemap,
      scenario: keepScenario ? controls.scenario : mapState.scenario,
      rainfallMmPerHour: keepRainfall
        ? controls.rainfallMmPerHour
        : mapState.rainfallMmPerHour,
      // "auto" is a standing choice, not a transient one. The map reports the
      // concrete mode it resolved to, and overwriting the selection with it
      // made the control read 3D moments after the operator picked Auto.
      viewMode:
        controls.viewMode === "auto"
          ? "auto"
          : keepView
            ? controls.viewMode
            : mapState.viewMode,
      effectiveView: mapState.viewMode,
      playing: keepPlaying ? controls.playing : mapState.playing,
      districtCode: keepDistrict
        ? controls.districtCode
        : mapState.district.selected,
      districtOverlay: keepDistrictOverlay
        ? controls.districtOverlay
        : mapState.district.overlay,
      districtLoading: mapState.district.loading || keepDistrict,
    },
    pending: {
      ...(keepBasemap ? { basemap: pending.basemap } : {}),
      ...(keepScenario ? { scenario: pending.scenario } : {}),
      ...(keepRainfall ? { rainfallMmPerHour: pending.rainfallMmPerHour } : {}),
      ...(keepView ? { viewMode: pending.viewMode } : {}),
      ...(keepPlaying ? { playing: pending.playing } : {}),
      ...(keepDistrict ? { districtCode: pending.districtCode } : {}),
      ...(keepDistrictOverlay
        ? { districtOverlay: pending.districtOverlay }
        : {}),
    },
  };
}
