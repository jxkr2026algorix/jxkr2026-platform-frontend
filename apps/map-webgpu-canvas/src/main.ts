import { DashboardBridge } from "./bridge";
import {
  DEFAULT_REGION,
  drawBuildings,
  type GeoReference,
  IMAGERY_URL,
  loadBuildingFootprints,
  loadDetailPatch,
  loadRealTerrain,
  loadStreetDetailPatch,
  TMAP_ENABLED,
} from "./dem";
import { Engine, type HazardEvent } from "./gpu/engine";
import {
  clampRainfall,
  type DashboardToMap,
  MAX_RAINFALL_MM_PER_HOUR,
  PROTOCOL_VERSION,
  type RiskZone,
  type RiskZonePoint,
  SCENARIOS,
  type Scenario,
} from "./protocol";
import { GRID_SIZE, generateTerrain, type TerrainData } from "./terrain-gen";
import { ControlPanel, showStatus, ZoneLabels } from "./ui";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
const fallbackBox = document.getElementById("fallback") as HTMLElement;
const panelBox = document.getElementById("panel") as HTMLElement;

const HAZARD_LABELS = {
  flood: "Flood",
  wildfire: "Wildfire",
  landslide: "Landslide",
  earthquake: "Earthquake",
  tsunami: "Tsunami",
  nuclear: "Radiological release",
  chemical: "Chemical release",
} as const;
const SEVERITY_LABELS = {
  none: "cleared",
  advisory: "advisory",
  watch: "watch",
  warning: "warning",
} as const;

let engine: Engine | null = null;
let bridge: DashboardBridge;
let zoneLabels: ZoneLabels | null = null;
let geoRef: GeoReference | null = null;

const SEVERITY_COLORS: Record<string, [number, number, number]> = {
  warning: [0.937, 0.267, 0.267],
  watch: [0.976, 0.451, 0.086],
  advisory: [0.918, 0.702, 0.031],
};

function toNormalized(pt: RiskZonePoint): { x: number; y: number } | null {
  if (typeof pt.x === "number" && typeof pt.y === "number") {
    return { x: pt.x, y: pt.y };
  }
  if (typeof pt.lat === "number" && typeof pt.lon === "number" && geoRef) {
    const { west, east, north, south } = geoRef;
    return {
      x: (pt.lon - west) / (east - west),
      y: (north - pt.lat) / (north - south),
    };
  }
  return null;
}

function zoneColor(zone: RiskZone): [number, number, number] {
  const hex = zone.color?.match(/^#?([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16) / 255,
      Number.parseInt(hex.slice(2, 4), 16) / 255,
      Number.parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return SEVERITY_COLORS[zone.severity ?? ""] ?? [0.2, 0.4, 1];
}

function applyZones(zones: RiskZone[]): void {
  if (!engine) return;
  const converted = zones
    .map((zone) => ({
      zone,
      points: zone.polygon
        .map(toNormalized)
        .filter((pt): pt is { x: number; y: number } => pt !== null),
    }))
    .filter((entry) => entry.points.length >= 3);
  engine.setZones(
    converted.map(({ zone, points }) => ({ color: zoneColor(zone), points })),
  );
  zoneLabels?.set(
    converted
      .filter(({ zone }) => zone.label)
      .map(({ zone, points }) => {
        let cx = 0;
        let cy = 0;
        for (const pt of points) {
          cx += pt.x;
          cy += pt.y;
        }
        return {
          id: zone.id,
          label: zone.label ?? "",
          ...(zone.hazard !== undefined ? { hazard: zone.hazard } : {}),
          centroid: { x: cx / points.length, y: cy / points.length },
        };
      }),
  );
}

function handleCommand(command: DashboardToMap): void {
  const ack = (ok: boolean, error?: string) => {
    if (command.id === undefined) return;
    const payload: { id: string; ok: boolean; error?: string } = {
      id: command.id,
      ok,
    };
    if (error !== undefined) payload.error = error;
    bridge.send({ type: "map:ack", payload });
  };

  if (command.type === "map:ping") {
    bridge.send({ type: "map:pong", payload: {} });
    ack(true);
    return;
  }
  if (!engine) {
    ack(false, "not-ready");
    return;
  }

  switch (command.type) {
    case "map:set-scenario": {
      const { scenario, rainfallMmPerHour } = command.payload;
      if (!SCENARIOS.includes(scenario)) {
        ack(false, "unknown-scenario");
        bridge.send({
          type: "map:error",
          payload: { code: "bad-command", message: `unknown scenario` },
        });
        return;
      }
      if (rainfallMmPerHour !== undefined) {
        engine.setScenario(scenario, clampRainfall(rainfallMmPerHour));
      } else {
        engine.setScenario(scenario);
      }
      break;
    }
    case "map:set-rainfall":
      engine.setRainfall(clampRainfall(command.payload.mmPerHour));
      break;
    case "map:set-view":
      engine.setViewMode(command.payload.mode);
      break;
    case "map:sim-control":
      engine.simControl(command.payload.action, command.payload.speed);
      break;
    case "map:ignite":
      engine.ignite(command.payload.x, command.payload.y);
      break;
    case "map:trigger":
      engine.triggerAt(
        command.payload.hazard,
        command.payload.x,
        command.payload.y,
      );
      break;
    case "map:set-overlay":
      engine.setOverlay(command.payload.enabled);
      break;
    case "map:set-camera":
      engine.setCamera(command.payload.center, command.payload.distanceMeters);
      break;
    case "map:set-zones":
      applyZones(command.payload.zones ?? []);
      break;
    case "map:set-basemap":
      engine.setBasemapStyle(command.payload.style);
      if (command.payload.style === "map" && !engine.streetBasemapReady) {
        showStatus("Loading standard map tiles…", 6000);
      }
      break;
  }
  ack(true);
}

function sendReady(webgpuSupported: boolean, geo: GeoReference | null): void {
  const world: {
    gridSize: number;
    sizeMeters: number;
    georeference?: {
      centerLat: number;
      centerLon: number;
      west: number;
      east: number;
      north: number;
      south: number;
    };
  } = {
    gridSize: GRID_SIZE,
    sizeMeters: geo?.sizeMeters ?? 2048,
  };
  if (geo && geo.source !== "procedural") {
    world.georeference = {
      centerLat: geo.centerLat,
      centerLon: geo.centerLon,
      west: geo.west,
      east: geo.east,
      north: geo.north,
      south: geo.south,
    };
  }
  bridge.send({
    type: "map:ready",
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      webgpuSupported,
      world,
      capabilities: {
        scenarios: SCENARIOS,
        maxRainfallMmPerHour: MAX_RAINFALL_MM_PER_HOUR,
      },
    },
  });
}

function showFallback(): void {
  canvas.style.display = "none";
  fallbackBox.hidden = false;
}

async function loadTerrain(): Promise<{
  terrain: TerrainData;
  geo: GeoReference | null;
  imagery: HTMLCanvasElement | null;
  street: HTMLCanvasElement | null;
}> {
  if (params.get("terrain") === "procedural") {
    return {
      terrain: generateTerrain(),
      geo: null,
      imagery: null,
      street: null,
    };
  }
  try {
    const options = { ...DEFAULT_REGION };
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    const km = Number(params.get("km"));
    if (Number.isFinite(lat) && lat !== 0) options.centerLat = lat;
    if (Number.isFinite(lon) && lon !== 0) options.centerLon = lon;
    if (Number.isFinite(km) && km > 0) {
      options.sizeMeters = km * 1000;
      // Town-scale views keep near-real relief; province scale needs more.
      options.exaggeration = km >= 80 ? 3.2 : 1.6;
    }
    const exagg = Number(params.get("exagg"));
    if (Number.isFinite(exagg) && exagg > 0) options.exaggeration = exagg;
    const result = await loadRealTerrain(options);
    return {
      terrain: result.terrain,
      geo: result.geo,
      imagery: result.imagery,
      street: result.street,
    };
  } catch (error) {
    console.warn("real terrain unavailable, using procedural fallback", error);
    showStatus("Measured terrain is unavailable. Using generated terrain.");
    return {
      terrain: generateTerrain(),
      geo: null,
      imagery: null,
      street: null,
    };
  }
}

async function main(): Promise<void> {
  bridge = new DashboardBridge(params.get("origin"), handleCommand);

  if (!navigator.gpu) {
    showFallback();
    sendReady(false, null);
    bridge.send({
      type: "map:error",
      payload: {
        code: "webgpu-unsupported",
        message: "navigator.gpu is not available in this browser",
      },
    });
    return;
  }

  showStatus("Loading terrain data…", 15000);
  const { terrain, geo, imagery, street } = await loadTerrain();
  geoRef = geo;

  try {
    engine = await Engine.create(canvas, terrain, imagery, street);
  } catch (error) {
    showFallback();
    sendReady(false, geo);
    bridge.send({
      type: "map:error",
      payload: { code: "webgpu-unsupported", message: String(error) },
    });
    return;
  }

  engine.onHazard = (event: HazardEvent) => {
    bridge.send({
      type: "map:hazard",
      payload: {
        hazard: event.hazard,
        phase: event.phase,
        severity: event.severity,
        ...(event.at ? { at: event.at } : {}),
      },
    });
    const label = HAZARD_LABELS[event.hazard];
    const severity = SEVERITY_LABELS[event.severity];
    showStatus(
      event.phase === "ended"
        ? `${label} cleared`
        : `${label} ${severity} — simulation detected`,
    );
  };
  engine.onError = (code, message) => {
    bridge.send({ type: "map:error", payload: { code, message } });
    showFallback();
  };
  engine.onTrigger = (hazard) => {
    showStatus(`${HAZARD_LABELS[hazard]} origin selected`, 2500);
  };

  const initialScenario = params.get("scenario") as Scenario | null;
  if (initialScenario && SCENARIOS.includes(initialScenario)) {
    engine.setScenario(initialScenario);
  }
  const initialRain = Number(params.get("rain"));
  if (Number.isFinite(initialRain) && params.get("rain") !== null) {
    engine.setRainfall(clampRainfall(initialRain));
  }

  engine.start();
  startDetailLod();
  if (TMAP_ENABLED) {
    const attribution = document.getElementById("attribution");
    if (attribution) {
      attribution.textContent = `© TMap(SK) ${attribution.textContent ?? ""}`;
    }
  }

  const zoneContainer = document.getElementById("zone-labels");
  if (zoneContainer) zoneLabels = new ZoneLabels(zoneContainer, engine);
  sendReady(true, geo);
  setInterval(() => {
    if (engine) bridge.send({ type: "map:state", payload: engine.getState() });
  }, 500);

  const uiParam = params.get("ui");
  const showPanel = uiParam === "1" || (!bridge.embedded && uiParam !== "0");
  if (showPanel) {
    new ControlPanel(panelBox, engine);
  }
  if (geo) {
    showStatus("Gyeongsangbuk-do terrain and satellite imagery loaded");
  }
}

/**
 * Slippy-map-style LOD: when the camera zooms in, fetch a high-zoom tile
 * patch (buildings and street detail) for the area in view and drape it
 * over the coarse basemap.
 */
function startDetailLod(): void {
  let generation = 0;
  let abortCurrent: AbortController | null = null;
  /** Last request we kicked off (pending or applied), to avoid re-requesting. */
  let requested: { x: number; y: number; size: number; style: string } | null =
    null;

  setInterval(() => {
    if (!engine || !geoRef) return;
    const state = engine.getState();
    const world = geoRef.sizeMeters;
    const dist = state.camera.distanceMeters;
    if (dist > world * 0.28) {
      if (requested) {
        abortCurrent?.abort();
        engine.clearDetailPatch();
        requested = null;
      }
      return;
    }
    const size = Math.min(Math.max(dist * 1.35, 2500), world * 0.35);
    const cx = state.camera.center.x;
    const cy = state.camera.center.y;
    const needsReload =
      !requested ||
      requested.style !== state.basemap ||
      Math.abs(requested.size - size) / requested.size > 0.35 ||
      Math.hypot(requested.x - cx, requested.y - cy) * world > size * 0.22;
    if (!needsReload) return;

    // Supersede any in-flight load immediately instead of queueing behind it.
    abortCurrent?.abort();
    const abort = new AbortController();
    abortCurrent = abort;
    const gen = ++generation;
    requested = { x: cx, y: cy, size, style: state.basemap };

    const lat = geoRef.north - cy * (geoRef.north - geoRef.south);
    const lon = geoRef.west + cx * (geoRef.east - geoRef.west);
    const sizeNorm = size / world;
    const rect = { x: cx - sizeNorm / 2, y: cy - sizeNorm / 2, size: sizeNorm };

    // Show tiles as they arrive rather than waiting for the full patch.
    let lastUpload = 0;
    const options = {
      signal: abort.signal,
      onProgress: (canvas: HTMLCanvasElement) => {
        const now = performance.now();
        if (gen !== generation || !engine || now - lastUpload < 300) return;
        lastUpload = now;
        engine.setDetailPatch(canvas, rect);
      },
    };
    const patchPromise =
      state.basemap === "map"
        ? loadStreetDetailPatch(lat, lon, size, options)
        : loadDetailPatch(lat, lon, size, IMAGERY_URL, options);
    void patchPromise
      .then((patch) => {
        if (gen !== generation || !engine) return;
        if (!patch) {
          // Failed (not superseded): allow a retry on the next tick.
          if (!abort.signal.aborted) requested = null;
          return;
        }
        engine.setDetailPatch(patch.canvas, rect);

        // Vector building footprints from OSM, composited on top once they
        // arrive. Best-effort: coverage is uneven and Overpass may be busy,
        // in which case the raster tiles' own buildings still show.
        if (size <= 12000) {
          const styleAtFetch = state.basemap;
          void loadBuildingFootprints(patch)
            .then((buildings) => {
              if (gen !== generation || !engine || buildings.length === 0) {
                return;
              }
              drawBuildings(patch, buildings, styleAtFetch);
              engine.setDetailPatch(patch.canvas, rect);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (gen === generation && !abort.signal.aborted) requested = null;
      });
  }, 250);
}

void main();
