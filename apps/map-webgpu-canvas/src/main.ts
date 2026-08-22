import { MapAnnotations } from "./annotations";
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
  PROVINCE_EXAGGERATION,
  type RealTerrainOptions,
  TMAP_ENABLED,
} from "./dem";
import { DEMO_MARKERS, DEMO_ROUTES, DEMO_ZONES } from "./demo-annotations";
import { renderDistrictOverlay } from "./district-layer";
import {
  cameraForBbox,
  districtByCode,
  latLonToMapPoint,
  mapPointToLatLon,
  PROVINCE_BBOX,
  PROVINCE_CODE,
  PROVINCE_REGION,
  provinceRegionForAspect,
  regionForDistrict,
} from "./districts";
import type { RegionBox } from "./geo";
import { Engine, type HazardEvent } from "./gpu/engine";
import { floodField, windowAround } from "./hazard-field-demo";
import {
  type AnyPoint,
  clampRainfall,
  type DashboardToMap,
  type HazardField,
  MAX_RAINFALL_MM_PER_HOUR,
  type MapMarker,
  type MapRoute,
  type MapStatePayload,
  PROTOCOL_VERSION,
  type RiskZone,
  type RiskZonePoint,
  SCENARIOS,
  type Scenario,
  type TriggerKind,
} from "./protocol";
import { GRID_SIZE, generateTerrain, type TerrainData } from "./terrain-gen";
import { ControlPanel, showStatus } from "./ui";

const params = new URLSearchParams(location.search);

/**
 * Cheongsong-gun. The map opens framed on a district rather than the whole
 * province: a province-wide first frame is mostly terrain with no operational
 * meaning, and on a wide window it puts the map's own edge on screen.
 * Override with `?district=<행정표준코드>`, or `?district=47000` for the
 * province view.
 */
const DEFAULT_DISTRICT_CODE = "47750";
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
let annotations: MapAnnotations | null = null;
let controlPanel: ControlPanel | null = null;
let geoRef: GeoReference | null = null;

/** Terrain region currently loaded, and the district framed inside it. */
let currentRegion: RegionBox = PROVINCE_REGION;
/**
 * The province region this session booted with. It is sized to the console's
 * viewport rather than being `PROVINCE_REGION`, so returning to the
 * whole-province view has to remember it instead of recomputing it.
 */
let homeRegion: RegionBox = PROVINCE_REGION;
let selectedDistrict: string | null = null;
let districtOverlayOn = true;
let regionLoading = false;
/** Last annotations received, so they survive a terrain-region reload. */
let activeZones: RiskZone[] = [];
let activeMarkers: MapMarker[] = [];
let activeRoutes: MapRoute[] = [];

function toNormalized(pt: RiskZonePoint | AnyPoint): {
  x: number;
  y: number;
} | null {
  if (typeof pt.x === "number" && typeof pt.y === "number") {
    return { x: pt.x, y: pt.y };
  }
  if (typeof pt.lat === "number" && typeof pt.lon === "number" && geoRef) {
    return latLonToMapPoint(pt.lat, pt.lon, geoRef);
  }
  return null;
}

/**
 * Annotations are presentation only: the overlay resolves each point against
 * the georeference and draws it above the canvas. Nothing reaches the
 * simulation, so a bad payload can never corrupt renderer state.
 */
function applyZones(zones: RiskZone[]): void {
  activeZones = zones;
  annotations?.setZones(zones);
}

function applyMarkers(markers: MapMarker[]): void {
  activeMarkers = markers;
  annotations?.setMarkers(markers);
}

function applyRoutes(routes: MapRoute[]): void {
  activeRoutes = routes;
  annotations?.setRoutes(routes);
}

/** Re-resolve every layer, e.g. after a terrain region swap moved the bounds. */
function reapplyAnnotations(): void {
  annotations?.setZones(activeZones);
  annotations?.setMarkers(activeMarkers);
  annotations?.setRoutes(activeRoutes);
}

/** Regions are compared by value; main() rebuilds the object on startup. */
function sameRegion(a: RegionBox, b: RegionBox): boolean {
  return (
    Math.abs(a.centerLat - b.centerLat) < 1e-6 &&
    Math.abs(a.centerLon - b.centerLon) < 1e-6 &&
    Math.abs(a.sizeMeters - b.sizeMeters) < 1
  );
}

/** Redraw the 시/군 boundary overlay for the current region and selection. */
function refreshDistrictOverlay(): void {
  if (!engine) return;
  if (!geoRef) {
    engine.setDistrictOverlay(null);
    return;
  }
  engine.setDistrictOverlay(
    renderDistrictOverlay({ bounds: geoRef, selected: selectedDistrict }),
  );
}

/**
 * Frame a 시/군 by its real bounding box. Districts inside the loaded region
 * are a camera move; anything outside it (울릉군) needs its own terrain.
 */
async function focusDistrict(code: string | null): Promise<void> {
  const normalized = code && code !== PROVINCE_CODE ? code : null;
  const district = normalized ? districtByCode(normalized) : undefined;
  if (normalized && !district) throw new Error("unknown-district");
  selectedDistrict = district ? district.code : null;

  const target = district
    ? regionForDistrict(district, currentRegion)
    : {
        region: homeRegion,
        reload: !sameRegion(currentRegion, homeRegion),
      };
  if (target.reload) await switchRegion(target.region);

  refreshDistrictOverlay();
  if (!engine) return;
  if (!district) {
    // 비례대표 / province view: frame Gyeongbuk itself rather than the loaded
    // square. The surrounding terrain exists only so a wide viewport has real
    // ground in it instead of void.
    const province = cameraForBbox(PROVINCE_BBOX, 40, 0.95);
    const center = geoRef
      ? latLonToMapPoint(province.lat, province.lon, geoRef)
      : { x: 0.5, y: 0.5 };
    engine.setCamera(center, province.distanceMeters);
    return;
  }
  const framing = cameraForBbox(district.bbox);
  const center = geoRef
    ? latLonToMapPoint(framing.lat, framing.lon, geoRef)
    : { x: 0.5, y: 0.5 };
  engine.setCamera(center, framing.distanceMeters);
}

/**
 * Backend hazard slugs to the renderer's simulated hazards. Anything not
 * listed has no point-source simulation, so its badge stays inert rather
 * than pretending to run something.
 */
const HAZARD_TO_TRIGGER: Record<string, TriggerKind> = {
  flood: "flood",
  wildfire: "wildfire",
  landslide: "landslide",
  earthquake: "earthquake",
  tsunami: "tsunami",
  nuclear: "nuclear",
  chemical: "chemical",
  chemical_accident: "chemical",
  heavy_rain: "flood",
  typhoon: "flood",
};

/**
 * An operator activated a predicted risk zone. The prediction is the input to
 * the simulation: switch to that scenario, seed it at the predicted origin,
 * and start running so the spread can be watched from there.
 */
function activateZone(zone: {
  id: string;
  hazard: string | undefined;
  at: { x: number; y: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}): void {
  if (!engine) return;
  const hazard = HAZARD_TO_TRIGGER[zone.hazard ?? ""];
  if (!hazard) {
    showStatus("No simulation is available for this hazard.", 3000);
    return;
  }
  // Frame the zone before running it: the operator pressed the alert to look
  // at that place, and a simulation they cannot see is not worth starting.
  const world = currentRegion.sizeMeters;
  const span =
    Math.max(
      zone.bounds.maxX - zone.bounds.minX,
      zone.bounds.maxY - zone.bounds.minY,
    ) * world;
  engine.setCamera(
    zone.at,
    (span * 1.9) / (2 * Math.tan((20 * Math.PI) / 180)),
  );
  engine.setScenario(hazard === "flood" ? "flood" : hazard);
  engine.triggerAt(hazard, zone.at.x, zone.at.y);
  engine.simControl("play");
  bridge.send({
    type: "map:alert-activated",
    payload: { id: zone.id, hazard, at: zone.at },
  });
  showStatus("Simulating from the predicted origin", 3000);
}

/** Terrain of the loaded region, kept for the interim client-side fields. */
let terrainRef: TerrainData | null = null;

/**
 * Interim source for the hazard field while the platform's spread stream is
 * being built: compute the drainage-driven flood extent for a window around
 * the camera. Replaced wholesale once `map:set-hazard-field` is fed upstream.
 */
function computeLocalFloodField(sizeMeters = 12000): boolean {
  if (!engine || !geoRef || !terrainRef) return false;
  const center = engine.cameraCenter;
  const { lat, lon } = mapPointToLatLon(center.x, center.y, geoRef);
  const win = windowAround(lat, lon, sizeMeters);
  return applyHazardField(
    floodField(terrainRef, geoRef, win, engine.rainfall || 60),
  );
}

/** Field colour ramps, keyed off the hazard the recipe produced. */
const FIELD_KIND: Record<string, number> = {
  flood: 0,
  flood_extent: 0,
  rain: 0,
  heavy_rain: 0,
  rain_nowcast: 0,
  tsunami: 0,
  wildfire: 1,
  wildfire_spread: 1,
  landslide: 2,
  landslide_risk: 2,
};

/**
 * Place an upstream hazard frame. The grid carries its own bbox, so it is
 * mapped through the georeference rather than assumed to line up with the
 * simulation grid — the two have no reason to share a resolution.
 */
function applyHazardField(field: HazardField | null): boolean {
  if (!engine) return false;
  if (!field) {
    engine.setHazardField(null);
    return true;
  }
  if (!geoRef) return false;
  const [west, south, east, north] = field.bbox;
  const nw = latLonToMapPoint(north, west, geoRef);
  const se = latLonToMapPoint(south, east, geoRef);
  const values =
    field.values instanceof Float32Array
      ? field.values
      : Float32Array.from(field.values);
  if (values.length !== field.width * field.height) return false;
  engine.setHazardField({
    width: field.width,
    height: field.height,
    values,
    rect: { x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y },
    kind: FIELD_KIND[field.hazard] ?? 2,
    threshold: field.threshold ?? 0.05,
  });
  return true;
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
    case "map:set-rainfall": {
      engine.setRainfall(clampRainfall(command.payload.mmPerHour));
      const area = command.payload.area;
      const at = area ? toNormalized(area.center) : null;
      engine.setRainArea(
        at ? { ...at, radiusMeters: area?.radiusMeters ?? 12000 } : null,
      );
      break;
    }
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
    case "map:set-camera": {
      const center = command.payload.center;
      const point = center ? toNormalized(center) : null;
      if (center && !point) {
        ack(false, "no-georeference");
        return;
      }
      engine.setCamera(point ?? undefined, command.payload.distanceMeters);
      break;
    }
    case "map:focus-district": {
      if (regionLoading) {
        ack(false, "region-loading");
        return;
      }
      void focusDistrict(command.payload.code).catch((error) => {
        bridge.send({
          type: "map:error",
          payload: { code: "bad-command", message: String(error) },
        });
      });
      break;
    }
    case "map:set-hazard-field": {
      if (!applyHazardField(command.payload.field)) {
        ack(false, "bad-field");
        return;
      }
      break;
    }
    case "map:zoom": {
      const factor = command.payload.factor;
      if (!Number.isFinite(factor) || factor <= 0) {
        ack(false, "bad-factor");
        return;
      }
      engine.zoomBy(factor);
      break;
    }
    case "map:set-district-overlay":
      districtOverlayOn = command.payload.enabled;
      engine.setDistrictOverlayEnabled(districtOverlayOn);
      break;
    case "map:set-zones":
      applyZones(command.payload.zones ?? []);
      break;
    case "map:set-markers":
      applyMarkers(command.payload.markers ?? []);
      break;
    case "map:set-routes":
      applyRoutes(command.payload.routes ?? []);
      break;
    case "map:set-basemap":
      engine.setBasemapStyle(command.payload.style);
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

interface LoadedTerrain {
  terrain: TerrainData;
  geo: GeoReference | null;
  imagery: HTMLCanvasElement | null;
  street: HTMLCanvasElement | null;
}

/** Town-scale views keep near-real relief; province scale needs more. */
function exaggerationFor(sizeMeters: number): number {
  return sizeMeters >= 80000 ? PROVINCE_EXAGGERATION : 1.6;
}

/**
 * The region to load at startup. The province square is widened to the
 * viewport's aspect ratio, so a wide console window is filled with real
 * ground and no district sits on the edge of the loaded data. Explicit
 * `?lat/lon/km` still wins.
 */
function initialRegion(): RealTerrainOptions {
  const sized = provinceRegionForAspect(
    window.innerWidth / Math.max(window.innerHeight, 1),
  );
  const options: RealTerrainOptions = {
    ...DEFAULT_REGION,
    centerLat: sized.centerLat,
    centerLon: sized.centerLon,
    sizeMeters: sized.sizeMeters,
    exaggeration: exaggerationFor(sized.sizeMeters),
  };
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const km = Number(params.get("km"));
  if (Number.isFinite(lat) && lat !== 0) options.centerLat = lat;
  if (Number.isFinite(lon) && lon !== 0) options.centerLon = lon;
  if (Number.isFinite(km) && km > 0) {
    options.sizeMeters = km * 1000;
    options.exaggeration = exaggerationFor(options.sizeMeters);
  }
  const exagg = Number(params.get("exagg"));
  if (Number.isFinite(exagg) && exagg > 0) options.exaggeration = exagg;
  return options;
}

async function loadTerrain(
  options: RealTerrainOptions,
): Promise<LoadedTerrain> {
  if (params.get("terrain") === "procedural") {
    return {
      terrain: generateTerrain(),
      geo: null,
      imagery: null,
      street: null,
    };
  }
  try {
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

function wireEngine(target: Engine): void {
  target.onHazard = (event: HazardEvent) => {
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
  target.onError = (code, message) => {
    bridge.send({ type: "map:error", payload: { code, message } });
    showFallback();
  };
  target.onTrigger = (hazard, at) => {
    bridge.send({ type: "map:point-selected", payload: { hazard, at } });
    showStatus(`${HAZARD_LABELS[hazard]} origin selected`, 2500);
  };
}

/**
 * Rebuild the world around a different terrain region. Only 울릉군 needs this
 * today — every mainland 시/군 already sits inside the province region — so
 * the cost of tearing the engine down is paid once, on demand. Operator-set
 * scenario, weather, and view state is carried across the rebuild.
 */
async function switchRegion(region: RegionBox): Promise<void> {
  if (!engine || regionLoading) return;
  regionLoading = true;
  showStatus("Loading measured terrain for the selected district…", 0);
  const previous = engine;
  const carried = {
    scenario: previous.scenario,
    rainfall: previous.rainfall,
    viewMode: previous.viewMode,
    basemap: previous.basemapStyle,
    overlay: previous.overlayEnabled,
    playing: previous.playing,
  };
  try {
    const loaded = await loadTerrain({
      ...region,
      exaggeration: exaggerationFor(region.sizeMeters),
      timeoutMs: DEFAULT_REGION.timeoutMs,
    });
    previous.destroy();
    engine = await Engine.create(
      canvas,
      loaded.terrain,
      loaded.imagery,
      loaded.street,
    );
    geoRef = loaded.geo;
    currentRegion = region;
    wireEngine(engine);
    engine.setScenario(carried.scenario, carried.rainfall);
    engine.setViewMode(carried.viewMode);
    engine.setBasemapStyle(carried.basemap);
    engine.setOverlay(carried.overlay);
    engine.setDistrictOverlayEnabled(districtOverlayOn);
    engine.simControl(carried.playing ? "play" : "pause");
    controlPanel?.setEngine(engine);
    reapplyAnnotations();
    engine.start();
    sendReady(true, geoRef);
    showStatus("Terrain ready", 2000);
  } catch (error) {
    // The old engine is already gone if the failure came after destroy();
    // surface it rather than pretending the region changed.
    bridge.send({
      type: "map:error",
      payload: { code: "internal", message: String(error) },
    });
    showStatus("Could not load terrain for that district.", 4000);
  } finally {
    regionLoading = false;
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

  const region = initialRegion();
  const { terrain, geo, imagery, street } = await loadTerrain(region);
  geoRef = geo;
  terrainRef = terrain;
  currentRegion = {
    centerLat: region.centerLat,
    centerLon: region.centerLon,
    sizeMeters: region.sizeMeters,
  };
  homeRegion = currentRegion;

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

  wireEngine(engine);
  refreshDistrictOverlay();

  // Embedded maps are driven by district selection, not by hand. Standalone
  // keeps free navigation so the renderer stays workable in development.
  const navigable = params.get("interaction") !== "0";
  engine.setNavigable(navigable);
  // 2D by default: the operating picture is read as a plan, not a landscape.
  engine.setViewMode("flat");

  const initialScenario = params.get("scenario") as Scenario | null;
  if (initialScenario && SCENARIOS.includes(initialScenario)) {
    engine.setScenario(initialScenario);
  }
  const initialRain = Number(params.get("rain"));
  if (Number.isFinite(initialRain) && params.get("rain") !== null) {
    engine.setRainfall(clampRainfall(initialRain));
  }

  // The embedded map used to boot paused, on the plan that spread would
  // arrive from the platform stream. That is not built yet, so pausing meant
  // rain never pooled and fire never moved — the map looked broken rather
  // than pending. Run locally until the backend drives it.
  engine.start();
  startDetailLod();
  if (TMAP_ENABLED) {
    const attribution = document.getElementById("attribution");
    if (attribution) {
      attribution.textContent = `© TMap(SK) ${attribution.textContent ?? ""}`;
    }
  }

  const overlayContainer = document.getElementById("map-annotations");
  if (overlayContainer) {
    // The overlay reads the engine through a narrow projector interface, so
    // it stays swappable across the rebuild a region change performs.
    annotations = new MapAnnotations(
      overlayContainer,
      {
        projectPointUnclipped: (u, v) =>
          engine?.projectPointUnclipped(u, v) ?? null,
        get viewportSize() {
          return engine?.viewportSize ?? { width: 0, height: 0 };
        },
      },
      toNormalized,
    );
    annotations.onActivateZone = activateZone;
    if (params.get("demo") === "flood") {
      // Give the terrain a moment to settle before the one-off computation.
      setTimeout(() => computeLocalFloodField(), 400);
    }
    if (params.get("demo") === "annotations") {
      applyZones(DEMO_ZONES);
      applyMarkers(DEMO_MARKERS);
      applyRoutes(DEMO_ROUTES);
    } else {
      reapplyAnnotations();
    }
  }
  sendReady(true, geo);
  // Frame the opening district once the georeference exists, so the first
  // thing on screen is a place rather than the whole loaded square.
  void focusDistrict(params.get("district") ?? DEFAULT_DISTRICT_CODE).catch(
    () => undefined,
  );
  setInterval(() => {
    if (!engine) return;
    const payload: MapStatePayload = {
      ...engine.getState(),
      district: {
        selected: selectedDistrict,
        overlay: engine.districtOverlayEnabled,
        loading: regionLoading,
      },
    };
    bridge.send({ type: "map:state", payload });
  }, 500);

  const uiParam = params.get("ui");
  const showPanel = uiParam === "1" || (!bridge.embedded && uiParam !== "0");
  if (showPanel) {
    controlPanel = new ControlPanel(panelBox, engine);
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
    // Hysteresis: a patch covers more than the viewport, so it only has to be
    // refetched once the camera has genuinely left it. Tighter thresholds meant
    // a slow pan refetched continuously and each swap showed.
    const needsReload =
      !requested ||
      requested.style !== state.basemap ||
      Math.abs(requested.size - size) / requested.size > 0.55 ||
      Math.hypot(requested.x - cx, requested.y - cy) * world > size * 0.34;
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

    // Uploaded once, complete. Publishing half-composited canvases as tiles
    // landed made the patch visibly assemble itself on screen, which is what
    // the flicker during zoom actually was.
    const options = { signal: abort.signal };
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
