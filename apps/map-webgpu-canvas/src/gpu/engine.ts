/**
 * Simulation engine: owns the WebGPU device, all resources and systems,
 * the frame loop, and the hazard-severity state machines that feed the
 * dashboard bridge.
 */

import { OrbitCamera } from "../camera";
import { clamp, damp, mat4Identity, mat4Inverse, smoothstep } from "../math";
import type {
  HazardKind,
  HazardMetrics,
  HazardPhase,
  HazardSeverity,
  MapPoint,
  MapStatePayload,
  Scenario,
  TriggerKind,
  ViewMode,
} from "../protocol";
import { computeStaticRisk, type TerrainData } from "../terrain-gen";
import { createGridTexture, GlobalsWriter, ROW } from "./common";
import { MipmapGenerator, mipLevelsFor } from "./mipmap";
import {
  DEBRIS_COUNT,
  initialRainData,
  ParticleSystems,
  RAIN_COUNT,
} from "./particles";
import { GridSim, type GridTextures, STATS_BUFFER_SIZE } from "./sim";
import { SurfaceRenderer } from "./surface";

const WATER_DT = 1 / 120;
const FIRE_DT = 0.1;
const MSAA = 4;
const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";

interface ScenarioPreset {
  rainfall: number;
  wind: [number, number];
  apiGain: number;
  autoIgnite: boolean;
}

const PRESETS: Record<Scenario, ScenarioPreset> = {
  clear: { rainfall: 0, wind: [2, 1], apiGain: 1, autoIgnite: false },
  rain: { rainfall: 24, wind: [3, 2], apiGain: 1, autoIgnite: false },
  flood: { rainfall: 96, wind: [4, 3], apiGain: 1, autoIgnite: false },
  wildfire: { rainfall: 0, wind: [7, 3], apiGain: 1, autoIgnite: true },
  landslide: { rainfall: 72, wind: [3, 2], apiGain: 1.6, autoIgnite: false },
  typhoon: { rainfall: 85, wind: [10, 6], apiGain: 1.3, autoIgnite: false },
  earthquake: { rainfall: 0, wind: [2, 1], apiGain: 1, autoIgnite: false },
  tsunami: { rainfall: 0, wind: [4, 2], apiGain: 1, autoIgnite: false },
  nuclear: { rainfall: 0, wind: [-4, -2], apiGain: 1, autoIgnite: false },
  chemical: { rainfall: 0, wind: [3, 1.5], apiGain: 1, autoIgnite: false },
  heatwave: { rainfall: 0, wind: [1, 0.5], apiGain: 1, autoIgnite: false },
  coldwave: { rainfall: 0, wind: [3, 2], apiGain: 1, autoIgnite: false },
  snow: { rainfall: 45, wind: [3, 2], apiGain: 0.2, autoIgnite: false },
  drought: { rainfall: 0, wind: [2, 1], apiGain: 1, autoIgnite: false },
};

const SCENARIO_CODE: Record<Scenario, number> = {
  clear: 0,
  rain: 1,
  flood: 2,
  wildfire: 3,
  landslide: 4,
  typhoon: 5,
  earthquake: 6,
  tsunami: 7,
  nuclear: 8,
  chemical: 9,
  heatwave: 10,
  coldwave: 11,
  snow: 12,
  drought: 13,
};

/** Scenarios whose payoff is water on terrain; auto view goes 3D for these. */
const WATER_3D_SCENARIOS: readonly Scenario[] = [
  "rain",
  "flood",
  "landslide",
  "tsunami",
];

/** What a map click triggers in each scenario. */
const CLICK_TRIGGER: Partial<Record<Scenario, TriggerKind>> = {
  rain: "flood",
  flood: "flood",
  typhoon: "flood",
  wildfire: "wildfire",
  landslide: "landslide",
  earthquake: "earthquake",
  tsunami: "tsunami",
  nuclear: "nuclear",
  chemical: "chemical",
};

/**
 * Default event sites for the Gyeongsangbuk-do region, as normalized map
 * coordinates of the default 180 km box: Gyeongju (quakes), the East Sea
 * off Pohang (tsunami), Wolseong NPP, and the Gumi industrial complex.
 */
const AUTO_EVENT: Partial<
  Record<Scenario, { kind: TriggerKind; x: number; y: number; delay: number }>
> = {
  earthquake: { kind: "earthquake", x: 0.72, y: 0.8, delay: 1.5 },
  tsunami: { kind: "tsunami", x: 0.93, y: 0.52, delay: 2 },
  nuclear: { kind: "nuclear", x: 0.858, y: 0.9, delay: 0.5 },
  chemical: { kind: "chemical", x: 0.333, y: 0.655, delay: 0.5 },
};

interface HazardMachine {
  severity: HazardSeverity;
  lastAt: { x: number; y: number } | null;
}

export interface HazardEvent {
  hazard: TriggerKind;
  phase: HazardPhase;
  severity: HazardSeverity;
  at?: { x: number; y: number };
}

const SEVERITY_ORDER: HazardSeverity[] = [
  "none",
  "advisory",
  "watch",
  "warning",
];

function severityFrom(
  value: number,
  thresholds: [number, number, number],
  previous: HazardSeverity,
): HazardSeverity {
  // 10% hysteresis so severities do not flap at a boundary.
  const idx = SEVERITY_ORDER.indexOf(previous);
  const scaled = thresholds.map((t, i) => (i < idx ? t * 0.9 : t));
  if (value >= (scaled[2] ?? Number.POSITIVE_INFINITY)) return "warning";
  if (value >= (scaled[1] ?? Number.POSITIVE_INFINITY)) return "watch";
  if (value >= (scaled[0] ?? Number.POSITIVE_INFINITY)) return "advisory";
  return "none";
}

export class Engine {
  scenario: Scenario = "clear";
  viewMode: ViewMode = "auto";
  playing = true;
  speed = 1;
  private rainTarget = 0;
  private rainCurrent = 0;
  private wind: [number, number] = [2, 1];
  private apiGain = 1;
  private apiIndex = 0;
  private simTime = 0;
  private fps = 60;
  private waterAcc = 0;
  private fireAcc = 0;
  private frameCounter = 0;
  private lastTime = 0;
  private running = true;

  private igniteRequest: { x: number; y: number } | null = null;
  private autoIgniteAt = 0;
  private lastBurningTime = -1e9;
  private lastIgnitePoint: { x: number; y: number } | null = null;
  private waterBurst: { x: number; y: number; until: number } | null = null;
  private tsunamiBurst: { x: number; y: number; until: number } | null = null;
  /** Active point event drawn by the terrain shader (quake/plume). */
  private eventState: {
    kind: 1 | 3 | 4;
    x: number;
    y: number;
    start: number;
  } | null = null;
  private autoEvent: {
    kind: TriggerKind;
    x: number;
    y: number;
    at: number;
  } | null = null;
  private activePointHazard: TriggerKind | null = null;
  private scenarioStart = 0;
  private weatherSnow = 0;
  private weatherTemp = 0;
  private weatherDrought = 0;
  private overlayOn = false;
  private overlayCurrent = 0;
  basemapStyle: import("../protocol").BasemapStyle = "satellite";
  private streetReady = false;
  private styleBlend = 0;
  private detailRect = { x: 0, y: 0, size: 0 };
  private detailOn = false;
  private detailBlend = 0;
  private detailTexRef: GPUTexture | null = null;
  private districtTexRef: GPUTexture | null = null;
  private districtOn = true;
  private districtBlend = 0;
  private fieldTexRef: GPUTexture | null = null;
  private fieldRect = { x: 0, y: 0, w: 0, h: 0 };
  private fieldMeta = { kind: 0, threshold: 0, peak: 1 };
  private fieldBlend = 0;
  private fieldOn = false;
  private armedHazard: TriggerKind | null = null;
  private armedRadius = 6000;
  /**
   * Rainfall footprint in normalized coordinates. A radius of 10 means
   * province-wide, which the sim reads as "no footprint".
   */
  private rainArea = { x: 0.5, y: 0.5, radius: 10, feather: 0.45 };
  /** 0..1 fade applied to every particle system; see renderFrame. */
  private particleVisibility = 0;
  /** Fire smoke and debris, which stay legible in the flat plan view. */
  private emberVisibility = 0;

  private readonly debrisQueue: {
    start: number;
    count: number;
    x: number;
    y: number;
  }[] = [];
  private debrisRing = 0;
  private recentSlides: { x: number; y: number; time: number }[] = [];
  private lastSlideTime = -1e9;

  private metrics = {
    floodedRatio: 0,
    burningCells: 0,
    riskIndex: 0,
  };
  private readonly machines: Record<HazardKind, HazardMachine> = {
    flood: { severity: "none", lastAt: { x: 0.3, y: 0.72 } },
    wildfire: { severity: "none", lastAt: null },
    landslide: { severity: "none", lastAt: null },
  };

  onHazard: ((event: HazardEvent) => void) | null = null;
  onError: ((code: "device-lost", message: string) => void) | null = null;
  /** Fired when a map click triggers a hazard (for UI feedback). */
  onTrigger: ((hazard: TriggerKind, at: MapPoint) => void) | null = null;
  /** Fired when an armed placement click lands. */
  onPlace:
    | ((hazard: TriggerKind, at: MapPoint, radiusMeters: number) => void)
    | null = null;
  /** Where the pointer is while armed, so a preview ring can follow it. */
  onHoverPlacement:
    | ((at: MapPoint | null, radiusMeters: number) => void)
    | null = null;

  private msaaTex: GPUTexture | null = null;
  private depthTex: GPUTexture | null = null;
  private canvasSize: [number, number] = [0, 0];
  private statsBusy = false;
  private satBlend = 0;
  private satBlendTarget = 0;

  readonly camera: OrbitCamera;

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly canvas: HTMLCanvasElement,
    private readonly format: GPUTextureFormat,
    private readonly terrain: TerrainData,
    private readonly globals: GlobalsWriter,
    private readonly textures: GridTextures,
    private readonly sim: GridSim,
    private readonly particles: ParticleSystems,
    private readonly surface: SurfaceRenderer,
    private readonly statsStaging: GPUBuffer,
    private readonly mipmaps: MipmapGenerator,
    hasImagery: boolean,
    hasStreet: boolean,
  ) {
    this.camera = new OrbitCamera(terrain.worldSize, terrain.sampleHeight);
    this.camera.attach(canvas);
    this.camera.onTap = (clientX, clientY) => {
      const point = this.pick(clientX, clientY);
      if (!point) return;
      // Armed placement wins: the operator is marking an incident area, not
      // poking the local simulation.
      if (this.armedHazard) {
        const hazard = this.armedHazard;
        this.armedHazard = null;
        this.canvas.classList.remove("placing");
        this.onHoverPlacement?.(null, this.armedRadius);
        this.onPlace?.(hazard, point, this.armedRadius);
        return;
      }
      const hazard = CLICK_TRIGGER[this.scenario];
      if (!hazard) return;
      this.triggerAt(hazard, point.x, point.y);
      this.onTrigger?.(hazard, point);
    };
    // While armed, the pointer drags a ring showing what area the click will
    // cover. Placing a hazard blind and finding out afterwards is worse than
    // a moment of preview.
    this.camera.onHover = (clientX, clientY) => {
      if (!this.armedHazard) return;
      this.onHoverPlacement?.(this.pick(clientX, clientY), this.armedRadius);
    };
    this.satBlendTarget = hasImagery ? 1 : 0;
    this.satBlend = this.satBlendTarget;
    this.streetReady = hasStreet;
    device.lost.then((info) => {
      if (this.running) this.onError?.("device-lost", info.message);
    });
  }

  static async create(
    canvas: HTMLCanvasElement,
    terrain: TerrainData,
    imagery: HTMLCanvasElement | null,
    street: HTMLCanvasElement | null = null,
  ): Promise<Engine> {
    const gpu = navigator.gpu;
    if (!gpu) throw new Error("WebGPU unavailable");
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("No WebGPU canvas context");
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    // Shared across every basemap upload, including later swaps.
    const mipmaps = new MipmapGenerator(device);

    const n = terrain.gridSize;
    const textures: GridTextures = {
      height: createGridTexture(device, "height", "r32float", n),
      waterA: createGridTexture(device, "waterA", "r32float", n),
      waterB: createGridTexture(device, "waterB", "r32float", n),
      fluxA: createGridTexture(device, "fluxA", "rgba32float", n),
      fluxB: createGridTexture(device, "fluxB", "rgba32float", n),
      fireA: createGridTexture(device, "fireA", "rgba32float", n),
      fireB: createGridTexture(device, "fireB", "rgba32float", n),
    };
    device.queue.writeTexture(
      { texture: textures.height },
      terrain.heights,
      { bytesPerRow: n * 4 },
      [n, n],
    );
    const fireInit = buildFireInit(terrain);
    device.queue.writeTexture(
      { texture: textures.fireA },
      fireInit,
      { bytesPerRow: n * 16 },
      [n, n],
    );
    device.queue.writeTexture(
      { texture: textures.fireB },
      fireInit,
      { bytesPerRow: n * 16 },
      [n, n],
    );

    let satTex: GPUTexture;
    if (imagery) {
      satTex = device.createTexture({
        label: "satellite",
        size: [imagery.width, imagery.height],
        format: "rgba8unorm",
        mipLevelCount: mipLevelsFor(imagery.width, imagery.height),
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture(
        { source: imagery },
        { texture: satTex },
        [imagery.width, imagery.height],
      );
      mipmaps.generate(satTex, "rgba8unorm");
    } else {
      satTex = device.createTexture({
        label: "satellite-placeholder",
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }

    // Hazard field starts empty; frames arrive from the platform.
    const fieldTex = device.createTexture({
      label: "hazard-field-placeholder",
      size: [1, 1],
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: fieldTex },
      new Float32Array(1),
      { bytesPerRow: 4 },
      [1, 1],
    );

    // Boundary overlay starts empty; main.ts uploads the rasterized 시/군
    // outlines once the georeference is known.
    const districtTex = device.createTexture({
      label: "district-boundaries-placeholder",
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: districtTex },
      new Uint8Array(4),
      { bytesPerRow: 4 },
      [1, 1],
    );

    let streetTex: GPUTexture;
    if (street) {
      streetTex = device.createTexture({
        label: "street-basemap",
        size: [street.width, street.height],
        format: "rgba8unorm",
        mipLevelCount: mipLevelsFor(street.width, street.height),
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture(
        { source: street },
        { texture: streetTex },
        [street.width, street.height],
      );
      mipmaps.generate(streetTex, "rgba8unorm");
    } else {
      streetTex = device.createTexture({
        label: "street-basemap-placeholder",
        size: [1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }
    const detailTex = device.createTexture({
      label: "detail-patch-placeholder",
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const riskTex = createGridTexture(device, "static-risk", "rgba32float", n);
    device.queue.writeTexture(
      { texture: riskTex },
      computeStaticRisk(terrain).data,
      { bytesPerRow: n * 16 },
      [n, n],
    );

    const globals = new GlobalsWriter(device);
    const targets = {
      format,
      sampleCount: MSAA,
      depthFormat: DEPTH_FORMAT,
    };
    const sim = new GridSim(device, globals.buffer, textures, n);
    const particles = new ParticleSystems(
      device,
      globals.buffer,
      textures.height,
      textures.waterA,
      textures.fireA,
      targets,
      terrain.worldSize,
    );
    const surface = new SurfaceRenderer(
      device,
      globals.buffer,
      textures.height,
      textures.waterA,
      textures.fireA,
      satTex,
      riskTex,
      streetTex,
      fieldTex,
      detailTex,
      districtTex,
      n,
      targets,
    );
    const statsStaging = device.createBuffer({
      label: "stats-staging",
      size: STATS_BUFFER_SIZE,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    return new Engine(
      device,
      context,
      canvas,
      format,
      terrain,
      globals,
      textures,
      sim,
      particles,
      surface,
      statsStaging,
      mipmaps,
      imagery !== null,
      street !== null,
    );
  }

  // -------------------------------------------------------------------------
  // Public control surface
  // -------------------------------------------------------------------------

  setScenario(scenario: Scenario, rainfallOverride?: number): void {
    this.scenario = scenario;
    this.scenarioStart = this.simTime;
    const preset = PRESETS[scenario];
    this.rainTarget = rainfallOverride ?? preset.rainfall;
    this.wind = [...preset.wind];
    this.apiGain = preset.apiGain;
    if (preset.autoIgnite) {
      this.autoIgniteAt = this.simTime + 1.2;
    }
    this.eventState = null;
    this.tsunamiBurst = null;
    this.endPointHazard();
    this.scheduleAutoEvent();
    this.applyAutoView();
  }

  private scheduleAutoEvent(): void {
    const auto = AUTO_EVENT[this.scenario];
    this.autoEvent = auto
      ? { kind: auto.kind, x: auto.x, y: auto.y, at: this.simTime + auto.delay }
      : null;
  }

  private startPointHazard(kind: TriggerKind, at: MapPoint): void {
    if (this.activePointHazard === kind) return;
    this.endPointHazard();
    this.activePointHazard = kind;
    this.onHazard?.({
      hazard: kind,
      phase: "started",
      severity: "warning",
      at,
    });
  }

  private endPointHazard(): void {
    if (!this.activePointHazard) return;
    this.onHazard?.({
      hazard: this.activePointHazard,
      phase: "ended",
      severity: "none",
    });
    this.activePointHazard = null;
  }

  setRainfall(mmPerHour: number): void {
    this.rainTarget = clamp(mmPerHour, 0, 120);
    this.applyAutoView();
  }

  get rainfall(): number {
    return this.rainTarget;
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.applyAutoView();
  }

  private applyAutoView(): void {
    if (this.viewMode === "auto") {
      // Only water hazards benefit from the 3D view (terrain + water depth);
      // everything else reads better as a top-down map. Manual 2D/3D wins.
      // 3D earns its cost only where water depth over terrain is the thing
      // being read: heavy rain, flood, landslide, tsunami. Wildfire, typhoon,
      // heat, cold, snow, and drought are spatial extent questions and read
      // better as a plan, so they stay in 2D.
      const wants3d =
        WATER_3D_SCENARIOS.includes(this.scenario) ||
        (this.scenario === "clear" && this.rainTarget > 0);
      this.camera.setMode(wants3d ? "tilted" : "flat");
    } else {
      this.camera.setMode(this.viewMode);
    }
  }

  simControl(action: "play" | "pause" | "reset", speed?: number): void {
    if (speed !== undefined) this.speed = clamp(speed, 0.25, 4);
    if (action === "play") this.playing = true;
    if (action === "pause") this.playing = false;
    if (action === "reset") this.reset();
  }

  ignite(x: number, y: number): void {
    this.igniteRequest = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    this.lastIgnitePoint = this.igniteRequest;
    this.fireAcc = Math.max(this.fireAcc, FIRE_DT);
    this.lastBurningTime = this.simTime;
  }

  /** Trigger a hazard or point event at a normalized map coordinate. */
  triggerAt(hazard: TriggerKind, x: number, y: number): void {
    const px = clamp(x, 0.01, 0.99);
    const py = clamp(y, 0.01, 0.99);
    switch (hazard) {
      case "wildfire":
        this.ignite(px, py);
        return;
      case "flood":
        this.waterBurst = { x: px, y: py, until: this.simTime + 3 };
        return;
      case "landslide":
        this.spawnSlide(px, py);
        return;
      case "earthquake":
        this.eventState = { kind: 1, x: px, y: py, start: this.simTime };
        // Quakes shake debris loose on nearby steep slopes.
        this.spawnSlide(clamp(px + 0.015, 0, 1), clamp(py - 0.01, 0, 1));
        this.spawnSlide(clamp(px - 0.012, 0, 1), clamp(py + 0.014, 0, 1));
        this.startPointHazard("earthquake", { x: px, y: py });
        this.focusOn(px, py);
        return;
      case "tsunami":
        this.tsunamiBurst = { x: px, y: py, until: this.simTime + 5 };
        this.startPointHazard("tsunami", { x: px, y: py });
        this.focusOn(px - 0.1, py, 0.34);
        return;
      case "nuclear":
        this.eventState = { kind: 3, x: px, y: py, start: this.simTime };
        this.startPointHazard("nuclear", { x: px, y: py });
        this.focusOn(px, py);
        return;
      case "chemical":
        this.eventState = { kind: 4, x: px, y: py, start: this.simTime };
        this.startPointHazard("chemical", { x: px, y: py });
        this.focusOn(px, py);
        return;
    }
  }

  /** Bring the camera to an event site so the effect is on screen. */
  private focusOn(u: number, v: number, distanceFactor = 0.28): void {
    this.camera.flyTo(u, v, this.terrain.worldSize * distanceFactor);
  }

  private spawnSlide(px: number, py: number): void {
    const count = 2000;
    this.debrisQueue.push({ start: this.debrisRing, count, x: px, y: py });
    this.debrisRing = (this.debrisRing + count) % DEBRIS_COUNT;
    this.recentSlides.push({ x: px, y: py, time: this.simTime });
    this.machines.landslide.lastAt = { x: px, y: py };
    if (this.machines.landslide.severity === "none") {
      this.machines.landslide.severity = "warning";
      this.onHazard?.({
        hazard: "landslide",
        phase: "started",
        severity: "warning",
        at: { x: px, y: py },
      });
    }
  }

  setOverlay(enabled: boolean): void {
    this.overlayOn = enabled;
  }

  setCamera(center?: MapPoint, distanceMeters?: number): void {
    this.camera.flyTo(center?.x, center?.y, distanceMeters);
  }

  /**
   * Allow or block manual pan/orbit/zoom. Embedded maps are driven by
   * district selection only, so the view always frames somewhere meaningful.
   */
  /**
   * Place an upstream hazard-field frame on the map. `rect` is the frame's
   * bbox in normalized map coordinates; `values` is row-major, north first.
   */
  setHazardField(
    frame: {
      width: number;
      height: number;
      values: Float32Array;
      rect: { x: number; y: number; w: number; h: number };
      kind: number;
      threshold: number;
    } | null,
  ): void {
    if (!frame || frame.width < 1 || frame.height < 1) {
      this.fieldOn = false;
      return;
    }
    const tex = this.device.createTexture({
      label: "hazard-field",
      size: [frame.width, frame.height],
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: tex },
      frame.values,
      { bytesPerRow: frame.width * 4 },
      [frame.width, frame.height],
    );
    this.surface.setFieldTexture(tex);
    this.fieldTexRef?.destroy();
    this.fieldTexRef = tex;
    this.fieldRect = frame.rect;
    // Normalize against a high percentile, not the maximum. A drainage field
    // is heavy-tailed — one main channel can be twenty times its tributaries —
    // so scaling by the peak leaves everything but that channel invisible.
    // Sampled rather than fully sorted: a percentile does not need every cell.
    const sample: number[] = [];
    for (let i = 0; i < frame.values.length; i += 7) {
      const v = frame.values[i] ?? 0;
      if (v > frame.threshold) sample.push(v);
    }
    sample.sort((a, b) => a - b);
    const reference =
      sample.length > 0
        ? (sample[Math.floor(sample.length * 0.92)] ?? frame.threshold)
        : frame.threshold + 1;
    this.fieldMeta = {
      kind: frame.kind,
      threshold: frame.threshold,
      peak: Math.max(reference, frame.threshold + 1e-3),
    };
    this.fieldOn = true;
  }

  /** Confine rainfall to a footprint, or pass null for province-wide rain. */
  setRainArea(
    area: { x: number; y: number; radiusMeters: number } | null,
  ): void {
    if (!area) {
      this.rainArea = { x: 0.5, y: 0.5, radius: 10, feather: 0.45 };
      return;
    }
    this.rainArea = {
      x: area.x,
      y: area.y,
      radius: Math.max(area.radiusMeters / this.terrain.worldSize, 0.004),
      feather: 0.45,
    };
  }

  setNavigable(navigable: boolean): void {
    this.camera.setNavigable(navigable);
  }

  /** Arm the next map click to place an incident area, or disarm with null. */
  armPlacement(hazard: TriggerKind | null, radiusMeters?: number): void {
    this.armedHazard = hazard;
    if (radiusMeters && radiusMeters > 0) this.armedRadius = radiusMeters;
    this.canvas.classList.toggle("placing", hazard !== null);
    if (!hazard) this.onHoverPlacement?.(null, this.armedRadius);
  }

  /** Metres per normalized map unit, for sizing an overlay in ground terms. */
  get worldSizeMeters(): number {
    return this.terrain.worldSize;
  }

  /** Step the zoom; the camera clamps so the terrain still covers the view. */
  zoomBy(factor: number): void {
    this.camera.zoomBy(factor);
  }

  /** Normalized look-at point the camera is easing toward. */
  get cameraCenter(): MapPoint {
    return this.camera.centerUV;
  }

  setBasemapStyle(style: import("../protocol").BasemapStyle): void {
    if (style !== this.basemapStyle) this.clearDetailPatch();
    this.basemapStyle = style;
  }

  /** Drape a freshly fetched high-zoom patch over the given rect. */
  setDetailPatch(
    canvas: HTMLCanvasElement,
    rect: { x: number; y: number; size: number },
  ): void {
    const tex = this.device.createTexture({
      label: "detail-patch",
      size: [canvas.width, canvas.height],
      format: "rgba8unorm",
      mipLevelCount: mipLevelsFor(canvas.width, canvas.height),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: canvas },
      { texture: tex },
      [canvas.width, canvas.height],
    );
    this.mipmaps.generate(tex, "rgba8unorm");
    this.surface.setDetailTexture(tex);
    // The bind group now references the new texture; the old one can go.
    this.detailTexRef?.destroy();
    this.detailTexRef = tex;
    this.detailRect = rect;
    this.detailOn = true;
  }

  clearDetailPatch(): void {
    this.detailOn = false;
  }

  /**
   * Upload a rasterized 시/군 boundary overlay covering the whole map, or
   * `null` to clear it. Rasterization lives in district-layer.ts so the
   * engine stays independent of the boundary dataset.
   */
  setDistrictOverlay(canvas: HTMLCanvasElement | null): void {
    if (!canvas) {
      this.districtTexRef?.destroy();
      this.districtTexRef = null;
      return;
    }
    const tex = this.device.createTexture({
      label: "district-boundaries",
      size: [canvas.width, canvas.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: canvas },
      { texture: tex },
      [canvas.width, canvas.height],
    );
    this.surface.setDistrictTexture(tex);
    this.districtTexRef?.destroy();
    this.districtTexRef = tex;
  }

  setDistrictOverlayEnabled(enabled: boolean): void {
    this.districtOn = enabled;
  }

  get districtOverlayEnabled(): boolean {
    return this.districtOn;
  }

  get streetBasemapReady(): boolean {
    return this.streetReady;
  }

  /** Upload the lazily loaded street basemap and enable the map style. */
  setStreetBasemap(canvas: HTMLCanvasElement): void {
    const tex = this.device.createTexture({
      label: "street-basemap",
      size: [canvas.width, canvas.height],
      format: "rgba8unorm",
      mipLevelCount: mipLevelsFor(canvas.width, canvas.height),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: canvas },
      { texture: tex },
      [canvas.width, canvas.height],
    );
    this.mipmaps.generate(tex, "rgba8unorm");
    this.surface.setStreetTexture(tex);
    this.streetReady = true;
  }

  /**
   * Project a normalized map point to canvas pixels, keeping points that fall
   * outside the viewport. Null only when the point is behind the camera.
   * Polygon and polyline overlays need this: culling individual vertices
   * would tear the shape apart as it crosses the screen edge.
   */
  projectPointUnclipped(u: number, v: number): { x: number; y: number } | null {
    const world = this.terrain.worldSize;
    const wx = u * world;
    const wz = v * world;
    const wy = this.terrain.sampleHeight(u, v);
    const m = this.camera.viewProj;
    const cw =
      (m[3] ?? 0) * wx + (m[7] ?? 0) * wy + (m[11] ?? 0) * wz + (m[15] ?? 1);
    if (cw <= 0.001) return null;
    const cx =
      ((m[0] ?? 0) * wx + (m[4] ?? 0) * wy + (m[8] ?? 0) * wz + (m[12] ?? 0)) /
      cw;
    const cy =
      ((m[1] ?? 0) * wx + (m[5] ?? 0) * wy + (m[9] ?? 0) * wz + (m[13] ?? 0)) /
      cw;
    return {
      x: (cx * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (1 - (cy * 0.5 + 0.5)) * this.canvas.clientHeight,
    };
  }

  /** Project a normalized map point to canvas pixels (null when off screen). */
  projectPoint(u: number, v: number): { x: number; y: number } | null {
    const at = this.projectPointUnclipped(u, v);
    if (!at) return null;
    const margin = 0.15;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (
      at.x < -margin * width ||
      at.x > width * (1 + margin) ||
      at.y < -margin * height ||
      at.y > height * (1 + margin)
    ) {
      return null;
    }
    return at;
  }

  /** Canvas size in CSS pixels, for sizing the annotation overlay. */
  get viewportSize(): { width: number; height: number } {
    return {
      width: this.canvas.clientWidth,
      height: this.canvas.clientHeight,
    };
  }

  get overlayEnabled(): boolean {
    return this.overlayOn;
  }

  /** Screen coordinates -> normalized map point via heightfield raycast. */
  pick(clientX: number, clientY: number): MapPoint | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const inv = mat4Identity();
    if (!mat4Inverse(inv, this.camera.viewProj)) return null;
    const unproject = (z: number): [number, number, number] => {
      const w =
        (inv[3] ?? 0) * ndcX +
        (inv[7] ?? 0) * ndcY +
        (inv[11] ?? 0) * z +
        (inv[15] ?? 1);
      return [
        ((inv[0] ?? 0) * ndcX +
          (inv[4] ?? 0) * ndcY +
          (inv[8] ?? 0) * z +
          (inv[12] ?? 0)) /
          w,
        ((inv[1] ?? 0) * ndcX +
          (inv[5] ?? 0) * ndcY +
          (inv[9] ?? 0) * z +
          (inv[13] ?? 0)) /
          w,
        ((inv[2] ?? 0) * ndcX +
          (inv[6] ?? 0) * ndcY +
          (inv[10] ?? 0) * z +
          (inv[14] ?? 0)) /
          w,
      ];
    };
    const near = unproject(0);
    const far = unproject(1);
    const dirLen = Math.hypot(
      far[0] - near[0],
      far[1] - near[1],
      far[2] - near[2],
    );
    if (dirLen < 1e-6) return null;
    const dir = [
      (far[0] - near[0]) / dirLen,
      (far[1] - near[1]) / dirLen,
      (far[2] - near[2]) / dirLen,
    ] as const;

    const world = this.terrain.worldSize;
    const heightAt = (px: number, pz: number) =>
      this.terrain.sampleHeight(px / world, pz / world);
    const step = world / 500;
    let prevT = 0;
    for (let t = step; t < world * 3; t += step) {
      const px = near[0] + dir[0] * t;
      const py = near[1] + dir[1] * t;
      const pz = near[2] + dir[2] * t;
      if (py < heightAt(px, pz)) {
        // Bisect between prevT and t for a precise hit.
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          const mx = near[0] + dir[0] * mid;
          const my = near[1] + dir[1] * mid;
          const mz = near[2] + dir[2] * mid;
          if (my < heightAt(mx, mz)) hi = mid;
          else lo = mid;
        }
        const hx = near[0] + dir[0] * hi;
        const hz = near[2] + dir[2] * hi;
        const u = hx / world;
        const v = hz / world;
        if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return null;
        return { x: clamp(u, 0, 1), y: clamp(v, 0, 1) };
      }
      prevT = t;
    }
    return null;
  }

  /** Highest-fuel high-ground cell; used for scenario auto-ignition. */
  pickIgnitePoint(): { x: number; y: number } {
    const n = this.terrain.gridSize;
    let best = 0;
    let bestIdx = (n / 2) * n + n / 2;
    for (let j = 8; j < n - 8; j += 2) {
      for (let i = 8; i < n - 8; i += 2) {
        const idx = j * n + i;
        const heightNorm =
          ((this.terrain.heights[idx] ?? 0) - this.terrain.minHeight) /
          Math.max(this.terrain.maxHeight - this.terrain.minHeight, 1);
        const score =
          (this.terrain.fuel[idx] ?? 0) * (0.35 + heightNorm) +
          Math.random() * 0.05;
        if (score > best) {
          best = score;
          bestIdx = idx;
        }
      }
    }
    return { x: (bestIdx % n) / (n - 1), y: Math.floor(bestIdx / n) / (n - 1) };
  }

  private reset(): void {
    const n = this.terrain.gridSize;
    const zerosR = new Float32Array(n * n);
    const zerosRgba = new Float32Array(n * n * 4);
    const fireInit = buildFireInit(this.terrain);
    const q = this.device.queue;
    q.writeTexture(
      { texture: this.textures.waterA },
      zerosR,
      { bytesPerRow: n * 4 },
      [n, n],
    );
    q.writeTexture(
      { texture: this.textures.waterB },
      zerosR,
      { bytesPerRow: n * 4 },
      [n, n],
    );
    q.writeTexture(
      { texture: this.textures.fluxA },
      zerosRgba,
      { bytesPerRow: n * 16 },
      [n, n],
    );
    q.writeTexture(
      { texture: this.textures.fluxB },
      zerosRgba,
      { bytesPerRow: n * 16 },
      [n, n],
    );
    q.writeTexture(
      { texture: this.textures.fireA },
      fireInit,
      { bytesPerRow: n * 16 },
      [n, n],
    );
    q.writeTexture(
      { texture: this.textures.fireB },
      fireInit,
      { bytesPerRow: n * 16 },
      [n, n],
    );
    q.writeBuffer(
      this.particles.rainBuffer,
      0,
      initialRainData(this.terrain.worldSize),
    );
    q.writeBuffer(this.particles.fireBuffer, 0, new Float32Array(8192 * 8));
    q.writeBuffer(this.particles.debrisBuffer, 0, new Float32Array(16384 * 8));
    this.apiIndex = 0;
    this.simTime = 0;
    this.waterAcc = 0;
    this.fireAcc = 0;
    this.igniteRequest = null;
    this.waterBurst = null;
    this.tsunamiBurst = null;
    this.eventState = null;
    this.endPointHazard();
    if (this.scenario === "wildfire") this.autoIgniteAt = 1.2;
    this.scenarioStart = 0;
    this.scheduleAutoEvent();
    this.debrisQueue.length = 0;
    this.debrisRing = 0;
    this.recentSlides = [];
    this.metrics = { floodedRatio: 0, burningCells: 0, riskIndex: 0 };
    for (const machine of Object.values(this.machines)) {
      machine.severity = "none";
    }
  }

  /**
   * Everything the engine itself knows. District selection is owned by
   * main.ts (it drives terrain reloads), which merges it in before the
   * `map:state` event is sent.
   */
  getState(): Omit<MapStatePayload, "district"> {
    return {
      scenario: this.scenario,
      viewMode: this.camera.mode,
      rainfallMmPerHour: Math.round(this.rainTarget),
      playing: this.playing,
      speed: this.speed,
      simTimeSeconds: Math.round(this.simTime * 10) / 10,
      fps: Math.round(this.fps),
      basemap: this.basemapStyle,
      camera: {
        center: this.camera.centerUV,
        distanceMeters: Math.round(this.camera.currentDistance),
      },
      hazards: this.hazardMetrics(),
    };
  }

  private hazardMetrics(): HazardMetrics {
    return {
      flood: {
        coverageRatio: Math.round(this.metrics.floodedRatio * 1000) / 1000,
        severity: this.machines.flood.severity,
      },
      wildfire: {
        burningCells: this.metrics.burningCells,
        severity: this.machines.wildfire.severity,
      },
      landslide: {
        riskIndex: Math.round(this.metrics.riskIndex * 100) / 100,
        severity: this.machines.landslide.severity,
      },
    };
  }

  destroy(): void {
    this.running = false;
    this.camera.detach();
    this.device.destroy();
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  start(): void {
    this.lastTime = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const realDt = clamp((now - this.lastTime) / 1000, 0, 0.05);
      this.lastTime = now;
      if (realDt > 0) {
        this.fps = damp(this.fps, 1 / Math.max(realDt, 1e-4), 1.5, realDt);
      }
      try {
        this.renderFrame(realDt);
      } catch (error) {
        this.running = false;
        this.onError?.("device-lost", String(error));
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private ensureTargets(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (
      width === this.canvasSize[0] &&
      height === this.canvasSize[1] &&
      this.msaaTex &&
      this.depthTex
    ) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvasSize = [width, height];
    this.msaaTex?.destroy();
    this.depthTex?.destroy();
    this.msaaTex = this.device.createTexture({
      label: "msaa",
      size: [width, height],
      sampleCount: MSAA,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTex = this.device.createTexture({
      label: "depth",
      size: [width, height],
      sampleCount: MSAA,
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private renderFrame(realDt: number): void {
    this.ensureTargets();
    const simDt = this.playing ? realDt * this.speed : 0;
    this.simTime += simDt;
    this.frameCounter++;

    // Rainfall eases toward its target; saturation index integrates rain.
    this.rainCurrent = damp(this.rainCurrent, this.rainTarget, 1.2, realDt);
    if (this.playing) {
      this.apiIndex += (this.rainCurrent / 120) * 0.045 * this.apiGain * simDt;
      if (this.rainCurrent < 5) {
        this.apiIndex *= Math.exp(-simDt / 45);
      }
      this.apiIndex = clamp(this.apiIndex, 0, 1.5);
    }

    // Scenario auto-ignition.
    if (
      this.scenario === "wildfire" &&
      this.autoIgniteAt > 0 &&
      this.simTime >= this.autoIgniteAt
    ) {
      this.autoIgniteAt = 0;
      this.ignite(
        ...(Object.values(this.pickIgnitePoint()) as [number, number]),
      );
    }

    // Scheduled scenario events (quake, tsunami, plumes).
    if (this.autoEvent && this.simTime >= this.autoEvent.at) {
      const { kind, x, y } = this.autoEvent;
      this.autoEvent = null;
      this.triggerAt(kind, x, y);
    }

    // Typhoon: a cyclone tracks north along the east coast; the global wind
    // is the cyclonic flow evaluated at the map center plus translation.
    if (this.scenario === "typhoon") {
      const progress = ((this.simTime - this.scenarioStart) % 110) / 110;
      const cx = 0.88 - 0.18 * progress;
      const cy = 1.15 - 1.3 * progress;
      const rx = 0.5 - cx;
      const ry = 0.5 - cy;
      const dist = Math.hypot(rx, ry) + 1e-4;
      const tangential = 13 * Math.min(1.3 / (dist + 0.25), 2.2);
      this.wind = [
        (-ry / dist) * tangential - 0.6,
        (rx / dist) * tangential - 3.6,
      ];
    }

    // Earthquake camera shake, decaying over ~12 seconds.
    if (this.eventState?.kind === 1) {
      const elapsed = this.simTime - this.eventState.start;
      const amp =
        elapsed < 12
          ? this.terrain.worldSize * 0.002 * Math.exp(-elapsed * 0.3)
          : 0;
      this.camera.setShake(amp);
    } else {
      this.camera.setShake(0);
    }

    const fireActive =
      this.scenario === "wildfire" ||
      this.metrics.burningCells > 0 ||
      this.igniteRequest !== null ||
      this.simTime - this.lastBurningTime < 12;
    if (this.metrics.burningCells > 0) this.lastBurningTime = this.simTime;

    // Water substep pairs (each pair advances 2 * WATER_DT of sim time).
    this.waterAcc += simDt;
    let pairs = Math.floor(this.waterAcc / (2 * WATER_DT));
    pairs = Math.min(pairs, 4);
    this.waterAcc = Math.min(this.waterAcc - pairs * 2 * WATER_DT, 0.1);

    this.fireAcc += simDt;
    const fireTick =
      (this.playing || this.igniteRequest !== null) && this.fireAcc >= FIRE_DT;
    if (fireTick) this.fireAcc = Math.min(this.fireAcc - FIRE_DT, FIRE_DT);

    const statsDue = this.frameCounter % 30 === 0 && !this.statsBusy;

    this.writeGlobals(realDt, simDt, fireTick);

    const encoder = this.device.createCommandEncoder();
    if (statsDue) {
      encoder.clearBuffer(this.sim.statsBuffer);
    }
    const compute = encoder.beginComputePass();
    if (this.playing) {
      for (let p = 0; p < pairs; p++) {
        this.sim.waterStepPair(compute);
      }
    }
    this.particles.compute(compute, fireActive);
    if (fireTick) {
      this.sim.fireTick(compute);
    }
    if (statsDue) {
      this.sim.statsPass(compute);
    }
    compute.end();
    if (fireTick) {
      encoder.copyTextureToTexture(
        { texture: this.textures.fireB },
        { texture: this.textures.fireA },
        [this.terrain.gridSize, this.terrain.gridSize],
      );
      if (this.igniteRequest) this.igniteRequest = null;
    }
    if (statsDue) {
      encoder.copyBufferToBuffer(
        this.sim.statsBuffer,
        0,
        this.statsStaging,
        0,
        STATS_BUFFER_SIZE,
      );
      this.statsBusy = true;
    }

    const msaaView = this.msaaTex?.createView();
    const depthView = this.depthTex?.createView();
    if (!msaaView || !depthView) return;
    const swap = this.context.getCurrentTexture().createView();
    const storm = clamp(this.rainCurrent / 60, 0, 1);
    const sky = this.skyColor(storm);
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: msaaView,
          resolveTarget: swap,
          clearValue: { r: sky[0], g: sky[1], b: sky[2], a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    this.surface.draw(pass);
    const rainInstances = Math.floor(
      clamp(this.rainCurrent / 120, 0, 1) * RAIN_COUNT,
    );
    // Below this the systems contribute nothing visible, so skip the draws.
    if (Math.max(this.particleVisibility, this.emberVisibility) > 0.01) {
      this.particles.draw(pass, rainInstances, fireActive);
    }
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    // The one-frame debris burst has been consumed.
    if (this.debrisQueue.length > 0) this.debrisQueue.shift();

    if (statsDue) this.readStats();
  }

  private weatherTargets(): [number, number, number] {
    switch (this.scenario) {
      case "snow":
        return [1, -0.5, 0];
      case "coldwave":
        return [0.22, -1, 0];
      case "heatwave":
        return [0, 1, 0.35];
      case "drought":
        return [0, 0.45, 1];
      default:
        return [0, 0, 0];
    }
  }

  private skyColor(storm: number): [number, number, number] {
    const flat = this.camera.blend;
    const day: [number, number, number] = [0.52, 0.71, 0.93];
    const stormy: [number, number, number] = [0.33, 0.38, 0.48];
    const mapBg: [number, number, number] = [0.93, 0.94, 0.95];
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const skyC = (day[i] ?? 0) * (1 - storm) + (stormy[i] ?? 0) * storm;
      out[i] = skyC * (1 - flat) + (mapBg[i] ?? 0) * flat * (1 - storm * 0.5);
    }
    // Climate tinting: snow pales the sky, heat warms it, cold cools it.
    const snowySky: [number, number, number] = [0.84, 0.86, 0.89];
    const heat = Math.max(this.weatherTemp, 0);
    const cold = Math.max(-this.weatherTemp, 0);
    for (let i = 0; i < 3; i++) {
      out[i] =
        (out[i] ?? 0) * (1 - this.weatherSnow * 0.6) +
        (snowySky[i] ?? 0) * this.weatherSnow * 0.6;
    }
    out[0] *= 1 + heat * 0.06 - cold * 0.05;
    out[2] *= 1 - heat * 0.1 + cold * 0.07;
    return out;
  }

  private writeGlobals(realDt: number, simDt: number, fireTick: boolean): void {
    const g = this.globals;
    const cam = this.camera;
    const aspect = this.canvasSize[0] / Math.max(this.canvasSize[1], 1);
    cam.update(realDt, aspect);

    const storm = clamp(this.rainCurrent / 60, 0, 1);
    const world = this.terrain.worldSize;
    const time = performance.now() / 1000;
    const sun = normalize3(0.42, 0.75, 0.35);

    g.setMat4(0, cam.viewProj);
    g.setVec4(ROW.camPos, cam.eye[0], cam.eye[1], cam.eye[2], time);
    g.setVec4(ROW.sunDir, sun[0], sun[1], sun[2], storm);
    g.setVec4(
      ROW.world,
      world,
      world / this.terrain.gridSize,
      this.terrain.gridSize,
      cam.blend,
    );
    // Snowfall drives particles and wetness but does not pool as water.
    const inflow =
      this.playing && this.scenario !== "snow" ? this.rainCurrent / 2600 : 0;
    g.setVec4(
      ROW.rain,
      clamp(this.rainCurrent / 120, 0, 1),
      inflow,
      this.wind[0],
      this.wind[1],
    );
    g.setVec4(ROW.sim, WATER_DT, FIRE_DT, this.simTime, this.apiIndex);
    this.satBlend = damp(this.satBlend, this.satBlendTarget, 2, realDt);
    this.overlayCurrent = damp(
      this.overlayCurrent,
      this.overlayOn ? 1 : 0,
      3,
      realDt,
    );
    // Trigger slot: fire ignition rides the fire tick; a water burst stays
    // active for a few seconds so the pool has time to form.
    let triggerKind = 0;
    let triggerX = 0;
    let triggerY = 0;
    const ignite = this.igniteRequest;
    if (ignite && fireTick) {
      triggerKind = 1;
      triggerX = ignite.x;
      triggerY = ignite.y;
    } else if (this.waterBurst) {
      if (this.simTime > this.waterBurst.until) {
        this.waterBurst = null;
      } else {
        triggerKind = 2;
        triggerX = this.waterBurst.x;
        triggerY = this.waterBurst.y;
      }
    } else if (this.tsunamiBurst) {
      if (this.simTime > this.tsunamiBurst.until) {
        this.tsunamiBurst = null;
      } else {
        triggerKind = 3;
        triggerX = this.tsunamiBurst.x;
        triggerY = this.tsunamiBurst.y;
      }
    }
    g.setVec4(ROW.fx, triggerX, triggerY, triggerKind, this.overlayCurrent);

    const event = this.eventState;
    g.setVec4(
      ROW.event,
      event?.x ?? 0,
      event?.y ?? 0,
      event ? this.simTime - event.start : 0,
      event?.kind ?? 0,
    );

    // Weather state eases toward the scenario's climate targets.
    const [snowT, tempT, droughtT] = this.weatherTargets();
    this.weatherSnow = damp(
      this.weatherSnow,
      snowT,
      snowT > this.weatherSnow ? 0.06 : 0.5,
      realDt,
    );
    this.weatherTemp = damp(this.weatherTemp, tempT, 0.5, realDt);
    this.weatherDrought = damp(this.weatherDrought, droughtT, 0.25, realDt);
    this.styleBlend = damp(
      this.styleBlend,
      this.basemapStyle === "map" && this.streetReady ? 1 : 0,
      4,
      realDt,
    );
    g.setVec4(
      ROW.weather,
      this.weatherSnow,
      this.weatherTemp,
      this.weatherDrought,
      this.styleBlend,
    );
    const districtGoal = this.districtOn && this.districtTexRef ? 1 : 0;
    this.districtBlend = damp(this.districtBlend, districtGoal, 5, realDt);
    // Particles only mean something at town scale. Framed on a district they
    // are sub-pixel specks — tens of thousands of them — which reads as noise
    // over the terrain rather than as weather. Fade them in as the camera
    // closes, and drop them entirely in the flat plan view.
    // Distance is what decides whether a particle means anything: framed on a
    // district they are sub-pixel specks, tens of thousands of them, and read
    // as noise over the terrain rather than as weather.
    const nearness =
      1 - smoothstep(world * 0.05, world * 0.14, this.camera.currentDistance);
    // Rain is vertical streaks, so a plan view has nothing to show and it goes
    // in 2D. Smoke and embers are a plume with a footprint, which reads from
    // directly overhead — and a fire with nothing rising off it looks dead.
    this.particleVisibility = nearness * (1 - cam.blend * 0.92);
    this.emberVisibility = nearness;
    g.setVec4(
      ROW.district,
      this.districtBlend,
      this.particleVisibility,
      this.emberVisibility,
      0,
    );
    g.setVec4(
      ROW.rainArea,
      this.rainArea.x,
      this.rainArea.y,
      this.rainArea.radius,
      this.rainArea.feather,
    );
    this.fieldBlend = damp(this.fieldBlend, this.fieldOn ? 1 : 0, 4, realDt);
    g.setVec4(
      ROW.fieldRect,
      this.fieldRect.x,
      this.fieldRect.y,
      this.fieldRect.w,
      this.fieldRect.h,
    );
    g.setVec4(
      ROW.fieldMeta,
      this.fieldBlend,
      this.fieldMeta.kind,
      this.fieldMeta.threshold,
      this.fieldMeta.peak,
    );
    this.detailBlend = damp(this.detailBlend, this.detailOn ? 1 : 0, 4, realDt);
    g.setVec4(
      ROW.detail,
      this.detailRect.x,
      this.detailRect.y,
      this.detailRect.size,
      this.detailBlend,
    );

    const fogColor: [number, number, number] = [
      0.72 - storm * 0.24,
      0.79 - storm * 0.24,
      0.9 - storm * 0.2,
    ];
    const fogDensity = ((0.1 + storm * 0.22) / world) * (1 - cam.blend * 0.85);
    g.setVec4(ROW.fog, fogColor[0], fogColor[1], fogColor[2], fogDensity);

    const spawnTop = Math.max(
      cam.eye[1] + world * 0.04,
      this.terrain.maxHeight + world * 0.03,
    );
    const camTargetU = clamp(cam.eye[0], 0, world);
    const camTargetV = clamp(cam.eye[2], 0, world);
    g.setVec4(ROW.misc, camTargetU, camTargetV, spawnTop, simDt);

    const burst = this.debrisQueue[0];
    g.setVec4(
      ROW.debris,
      burst?.start ?? 0,
      burst?.count ?? 0,
      burst?.x ?? 0,
      burst?.y ?? 0,
    );
    g.setVec4(
      ROW.layers,
      this.satBlend,
      SCENARIO_CODE[this.scenario],
      this.terrain.minHeight,
      this.terrain.maxHeight,
    );
    g.upload();
  }

  private readStats(): void {
    this.statsStaging.mapAsync(GPUMapMode.READ).then(
      () => {
        const data = new Uint32Array(
          this.statsStaging.getMappedRange().slice(0),
        );
        this.statsStaging.unmap();
        this.statsBusy = false;
        this.consumeStats(data);
      },
      () => {
        this.statsBusy = false;
      },
    );
  }

  private consumeStats(data: Uint32Array): void {
    const n = this.terrain.gridSize;
    const total = n * n;
    this.metrics.floodedRatio = (data[0] ?? 0) / total;
    this.metrics.burningCells = data[1] ?? 0;
    this.metrics.riskIndex = (data[2] ?? 0) / 1000;
    const candidateCount = Math.min(data[3] ?? 0, 64);

    if (candidateCount > 0) {
      this.maybeTriggerSlides(data, candidateCount);
    }

    this.updateMachine("flood", this.metrics.floodedRatio, [0.02, 0.06, 0.12], {
      x: 0.3,
      y: 0.72,
    });
    this.updateMachine(
      "wildfire",
      this.metrics.burningCells,
      [5, 80, 300],
      this.lastIgnitePoint,
    );
    this.updateMachine(
      "landslide",
      this.metrics.riskIndex,
      [0.45, 0.65, 0.85],
      this.machines.landslide.lastAt,
    );
  }

  private maybeTriggerSlides(data: Uint32Array, count: number): void {
    // Debris flows only auto-release in scenarios where they are the story;
    // during plain rain/flood the risk is reported but nothing pops.
    if (this.scenario !== "landslide" && this.scenario !== "typhoon") return;
    const now = this.simTime;
    if (now - this.lastSlideTime < 6) return;
    const n = this.terrain.gridSize;
    const world = 1;
    this.recentSlides = this.recentSlides.filter((s) => now - s.time < 30);
    let triggered = 0;
    for (let i = 0; i < count && triggered < 2; i++) {
      const packed = data[4 + i] ?? 0;
      const x = (packed & 0xffff) / (n - 1);
      const y = (packed >>> 16) / (n - 1);
      const tooClose = this.recentSlides.some(
        (s) => Math.hypot(s.x - x, s.y - y) < world * 0.08,
      );
      if (tooClose) continue;
      this.recentSlides.push({ x, y, time: now });
      const count_ = 1500;
      this.debrisQueue.push({ start: this.debrisRing, count: count_, x, y });
      this.debrisRing = (this.debrisRing + count_) % 16384;
      this.machines.landslide.lastAt = { x, y };
      this.lastSlideTime = now;
      triggered++;
    }
  }

  private updateMachine(
    kind: HazardKind,
    value: number,
    thresholds: [number, number, number],
    at: { x: number; y: number } | null,
  ): void {
    const machine = this.machines[kind];
    const next = severityFrom(value, thresholds, machine.severity);
    if (next === machine.severity) return;
    const prevIdx = SEVERITY_ORDER.indexOf(machine.severity);
    const nextIdx = SEVERITY_ORDER.indexOf(next);
    let phase: HazardPhase;
    if (prevIdx === 0) phase = "started";
    else if (nextIdx === 0) phase = "ended";
    else if (nextIdx > prevIdx) phase = "escalated";
    else phase = "deescalated";
    machine.severity = next;
    if (at) machine.lastAt = at;
    const event: HazardEvent = { hazard: kind, phase, severity: next };
    if (machine.lastAt) event.at = machine.lastAt;
    this.onHazard?.(event);
  }
}

function buildFireInit(terrain: TerrainData): Float32Array {
  const n = terrain.gridSize;
  const data = new Float32Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = terrain.fuel[i] ?? 0;
    data[i * 4 + 3] = 0.25;
  }
  return data;
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}
