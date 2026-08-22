/**
 * SALGIL map iframe messaging protocol.
 *
 * This file is the source of truth for the dashboard <-> map contract.
 * The dashboard embeds this app in an iframe and talks to it exclusively
 * through `window.postMessage`. Human-readable documentation lives in
 * ../PROTOCOL.md and must be kept in sync with these types.
 */

export const PROTOCOL_VERSION = 1 as const;

export const MAP_SOURCE = "salgil-map" as const;
export const DASHBOARD_SOURCE = "salgil-dashboard" as const;

export const MAX_RAINFALL_MM_PER_HOUR = 120;

export type Scenario =
  | "clear"
  | "rain"
  | "flood"
  | "wildfire"
  | "landslide"
  | "typhoon"
  | "earthquake"
  | "tsunami"
  | "nuclear"
  | "chemical"
  | "heatwave"
  | "coldwave"
  | "snow"
  | "drought";

export const SCENARIOS: readonly Scenario[] = [
  "clear",
  "rain",
  "flood",
  "wildfire",
  "landslide",
  "typhoon",
  "earthquake",
  "tsunami",
  "nuclear",
  "chemical",
  "heatwave",
  "coldwave",
  "snow",
  "drought",
];

/** "flat" is the top-down 2D map look; "tilted" is the 3D perspective view. */
export type ViewMode = "flat" | "tilted" | "auto";

/** Ground imagery: satellite photos or a cartographic street map. */
export type BasemapStyle = "satellite" | "map";

/** Hazards with continuously simulated metrics. */
export type HazardKind = "flood" | "wildfire" | "landslide";

/** Everything that can be triggered at a point or reported as an event. */
export type TriggerKind =
  | HazardKind
  | "earthquake"
  | "tsunami"
  | "nuclear"
  | "chemical";
export type HazardSeverity = "none" | "advisory" | "watch" | "warning";
export type HazardPhase = "started" | "escalated" | "deescalated" | "ended";

/** Normalized map coordinate: (0,0) = north-west corner, (1,1) = south-east. */
export interface MapPoint {
  x: number;
  y: number;
}

/**
 * A vertex of a risk-zone polygon. Either normalized map coordinates (x/y)
 * or geographic coordinates (lat/lon, converted via the georeference).
 */
export interface RiskZonePoint {
  x?: number;
  y?: number;
  lat?: number;
  lon?: number;
}

/**
 * DRAFT — server data shape is not final; this is the adapter target.
 * A named risk area drawn as a translucent polygon fill with a floating
 * badge label (icon + text) at its centroid.
 */
export interface RiskZone {
  id: string;
  /** Badge text, e.g. "산사태 위험 · 안동시 임동면". */
  label?: string;
  /** Hazard kind for the badge icon; free-form strings are accepted. */
  hazard?: string;
  severity?: HazardSeverity;
  /** Fill/badge accent override, "#rrggbb". Defaults by severity. */
  color?: string;
  polygon: RiskZonePoint[];
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

interface EnvelopeBase {
  v: typeof PROTOCOL_VERSION;
  /** Correlation id. Commands carrying an id receive a `map:ack` echoing it. */
  id?: string;
}

export type DashboardToMap = EnvelopeBase & {
  source: typeof DASHBOARD_SOURCE;
} & DashboardCommand;

export type MapToDashboard = EnvelopeBase & {
  source: typeof MAP_SOURCE;
} & MapEvent;

// ---------------------------------------------------------------------------
// Commands (dashboard -> map)
// ---------------------------------------------------------------------------

export type DashboardCommand =
  | {
      type: "map:set-scenario";
      payload: {
        scenario: Scenario;
        /** Overrides the scenario's default rainfall when provided. */
        rainfallMmPerHour?: number;
      };
    }
  | {
      type: "map:set-rainfall";
      payload: { mmPerHour: number };
    }
  | {
      type: "map:set-view";
      payload: { mode: ViewMode };
    }
  | {
      type: "map:sim-control";
      payload: {
        action: "play" | "pause" | "reset";
        /** Simulation speed multiplier, clamped to [0.25, 4]. */
        speed?: number;
      };
    }
  | {
      /** Manually start a fire at a normalized map coordinate. */
      type: "map:ignite";
      payload: MapPoint;
    }
  | {
      /**
       * Trigger a hazard at a normalized map coordinate: wildfire ignites,
       * flood injects a water burst, landslide releases a debris flow.
       * Clicking the map does the same for the active scenario.
       */
      type: "map:trigger";
      payload: MapPoint & { hazard: TriggerKind };
    }
  | {
      /** Toggle the hazard-susceptibility zone overlay (default on). */
      type: "map:set-overlay";
      payload: { enabled: boolean };
    }
  | {
      /** Basemap style: satellite imagery or a street map (Google-Maps-like). */
      type: "map:set-basemap";
      payload: { style: BasemapStyle };
    }
  | {
      /**
       * Replace the externally supplied risk zones (server-driven). Each zone
       * is filled on the terrain and labeled with a floating badge. An empty
       * array clears the layer.
       */
      type: "map:set-zones";
      payload: { zones: RiskZone[] };
    }
  | {
      /**
       * Move the 3D camera; the primary hook for keeping this view in sync
       * with a 2D map beside it (e.g. on the 2D map's moveend). The current
       * camera is reported back in every `map:state` for the reverse sync.
       */
      type: "map:set-camera";
      payload: {
        /** Normalized look-at point. Omit to keep the current center. */
        center?: MapPoint;
        /** Camera distance from the look-at point, in meters. */
        distanceMeters?: number;
      };
    }
  | {
      type: "map:ping";
      payload?: Record<string, never>;
    };

export type DashboardCommandType = DashboardCommand["type"];

// ---------------------------------------------------------------------------
// Events (map -> dashboard)
// ---------------------------------------------------------------------------

export interface HazardMetrics {
  flood: {
    /** Share of land cells covered by standing water, 0..1. */
    coverageRatio: number;
    severity: HazardSeverity;
  };
  wildfire: {
    burningCells: number;
    severity: HazardSeverity;
  };
  landslide: {
    /** Peak slope-failure risk index, 0..1+ (>= 1 means an active slide). */
    riskIndex: number;
    severity: HazardSeverity;
  };
}

export interface MapStatePayload {
  scenario: Scenario;
  viewMode: Exclude<ViewMode, "auto">;
  rainfallMmPerHour: number;
  playing: boolean;
  speed: number;
  simTimeSeconds: number;
  fps: number;
  basemap: BasemapStyle;
  /** Current look-at point and distance, for syncing an adjacent 2D map. */
  camera: {
    center: MapPoint;
    distanceMeters: number;
  };
  hazards: HazardMetrics;
}

export type MapEvent =
  | {
      /** Sent once the renderer is initialized (or failed to initialize). */
      type: "map:ready";
      payload: {
        protocolVersion: typeof PROTOCOL_VERSION;
        webgpuSupported: boolean;
        world: {
          gridSize: number;
          sizeMeters: number;
          /**
           * Present when the terrain was loaded from a real DEM. Normalized
           * map points map linearly onto this Web-Mercator bounding box.
           */
          georeference?: {
            centerLat: number;
            centerLon: number;
            west: number;
            east: number;
            north: number;
            south: number;
          };
        };
        capabilities: {
          scenarios: readonly Scenario[];
          maxRainfallMmPerHour: number;
        };
      };
    }
  | {
      /** Periodic snapshot, throttled to roughly 2 Hz. */
      type: "map:state";
      payload: MapStatePayload;
    }
  | {
      /** Edge-triggered hazard lifecycle notification. */
      type: "map:hazard";
      payload: {
        hazard: TriggerKind;
        phase: HazardPhase;
        severity: HazardSeverity;
        /** Representative location, when known. */
        at?: MapPoint;
      };
    }
  | {
      type: "map:ack";
      payload: { id: string; ok: boolean; error?: string };
    }
  | {
      type: "map:error";
      payload: {
        code: "webgpu-unsupported" | "device-lost" | "bad-command" | "internal";
        message: string;
      };
    }
  | {
      type: "map:pong";
      payload: Record<string, never>;
    };

export type MapEventType = MapEvent["type"];

// ---------------------------------------------------------------------------
// Guards & helpers
// ---------------------------------------------------------------------------

const COMMAND_TYPES: readonly string[] = [
  "map:set-scenario",
  "map:set-rainfall",
  "map:set-view",
  "map:sim-control",
  "map:ignite",
  "map:trigger",
  "map:set-overlay",
  "map:set-basemap",
  "map:set-zones",
  "map:set-camera",
  "map:ping",
];

export function isDashboardToMap(data: unknown): data is DashboardToMap {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record["source"] === DASHBOARD_SOURCE &&
    record["v"] === PROTOCOL_VERSION &&
    typeof record["type"] === "string" &&
    COMMAND_TYPES.includes(record["type"])
  );
}

export function makeMapEvent(event: MapEvent, id?: string): MapToDashboard {
  const envelope: MapToDashboard = {
    source: MAP_SOURCE,
    v: PROTOCOL_VERSION,
    ...event,
  };
  if (id !== undefined) envelope.id = id;
  return envelope;
}

export function clampRainfall(mmPerHour: number): number {
  if (!Number.isFinite(mmPerHour)) return 0;
  return Math.min(MAX_RAINFALL_MM_PER_HOUR, Math.max(0, mmPerHour));
}
