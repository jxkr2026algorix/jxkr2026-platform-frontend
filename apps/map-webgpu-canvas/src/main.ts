import { DashboardBridge } from "./bridge";
import {
  DEFAULT_REGION,
  type GeoReference,
  loadBasemap,
  loadRealTerrain,
  STREET_URL,
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
  flood: "침수",
  wildfire: "산불",
  landslide: "산사태",
  earthquake: "지진",
  tsunami: "지진해일",
  nuclear: "방사성물질 확산",
  chemical: "유해화학물질 확산",
} as const;
const SEVERITY_LABELS = {
  none: "해제",
  advisory: "주의",
  watch: "경계",
  warning: "경보",
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
        showStatus("일반 지도 타일을 불러오는 중…", 6000);
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
}> {
  if (params.get("terrain") === "procedural") {
    return { terrain: generateTerrain(), geo: null, imagery: null };
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
    };
  } catch (error) {
    console.warn("real terrain unavailable, using procedural fallback", error);
    showStatus("실측 지형을 불러오지 못해 절차 생성 지형을 사용합니다.");
    return { terrain: generateTerrain(), geo: null, imagery: null };
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

  showStatus("지형 데이터를 불러오는 중…", 15000);
  const { terrain, geo, imagery } = await loadTerrain();
  geoRef = geo;

  try {
    engine = await Engine.create(canvas, terrain, imagery);
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
        ? `${label} 상황 해제`
        : `${label} ${severity} — 시뮬레이션 감지`,
    );
  };
  engine.onError = (code, message) => {
    bridge.send({ type: "map:error", payload: { code, message } });
    showFallback();
  };
  engine.onTrigger = (hazard) => {
    showStatus(`${HAZARD_LABELS[hazard]} 발생 지점을 지정했습니다`, 2500);
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

  // Street basemap ("map" style) loads in the background so the first paint
  // is not delayed; the style toggle activates as soon as it lands.
  if (geo) {
    void loadBasemap(
      geo.centerLat,
      geo.centerLon,
      geo.sizeMeters,
      STREET_URL,
    ).then((canvas) => {
      if (canvas && engine) engine.setStreetBasemap(canvas);
    });
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
    showStatus("경상북도 실측 지형·위성영상 로드 완료");
  }
}

void main();
