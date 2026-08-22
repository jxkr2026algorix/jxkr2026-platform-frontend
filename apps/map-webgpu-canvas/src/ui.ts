/**
 * Standalone control panel for developing and demoing without the dashboard.
 * The dashboard drives the same engine methods through the postMessage
 * bridge; this panel is hidden when embedded (unless ?ui=1).
 */

import type { Engine } from "./gpu/engine";
import type { Scenario } from "./protocol";

const SCENARIO_LABELS: Record<Scenario, string> = {
  clear: "맑음",
  rain: "강우",
  flood: "집중호우",
  wildfire: "산불",
  landslide: "산사태",
  typhoon: "태풍",
  earthquake: "지진",
  tsunami: "지진해일",
  nuclear: "원전사고",
  chemical: "화학사고",
  heatwave: "폭염",
  coldwave: "한파",
  snow: "대설",
  drought: "가뭄",
};

export class ControlPanel {
  private readonly scenarioButtons = new Map<Scenario, HTMLButtonElement>();
  private readonly viewButtons = new Map<string, HTMLButtonElement>();
  private readonly basemapButtons = new Map<string, HTMLButtonElement>();
  private playButton!: HTMLButtonElement;
  private overlayButton!: HTMLButtonElement;
  private hint!: HTMLParagraphElement;
  private rainSlider!: HTMLInputElement;
  private rainOutput!: HTMLOutputElement;
  private metricsBox!: HTMLDivElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly engine: Engine,
  ) {
    this.build();
    this.root.hidden = false;
    setInterval(() => this.refresh(), 500);
  }

  private build(): void {
    const heading = document.createElement("h2");
    heading.textContent = "재난 시뮬레이션";
    this.root.append(heading);

    // Scenario list
    const scenarioGroup = document.createElement("div");
    scenarioGroup.className = "group";
    const scenarioList = document.createElement("div");
    scenarioList.className = "scenario-list";
    for (const [scenario, label] of Object.entries(SCENARIO_LABELS) as [
      Scenario,
      string,
    ][]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        this.engine.setScenario(scenario);
        this.syncRainSlider();
      });
      this.scenarioButtons.set(scenario, button);
      scenarioList.append(button);
    }
    scenarioGroup.append(scenarioList);
    this.root.append(scenarioGroup);

    // Rainfall slider
    const rainGroup = document.createElement("div");
    rainGroup.className = "group";
    const labelRow = document.createElement("div");
    labelRow.className = "label-row";
    const rainLabel = document.createElement("label");
    rainLabel.textContent = "강우량";
    rainLabel.htmlFor = "rain-slider";
    this.rainOutput = document.createElement("output");
    this.rainOutput.textContent = "0 mm/h";
    labelRow.append(rainLabel, this.rainOutput);
    this.rainSlider = document.createElement("input");
    this.rainSlider.type = "range";
    this.rainSlider.id = "rain-slider";
    this.rainSlider.min = "0";
    this.rainSlider.max = "120";
    this.rainSlider.step = "4";
    this.rainSlider.value = "0";
    this.rainSlider.addEventListener("input", () => {
      const value = Number(this.rainSlider.value);
      this.engine.setRainfall(value);
      this.rainOutput.textContent = `${value} mm/h`;
    });
    rainGroup.append(labelRow, this.rainSlider);
    this.root.append(rainGroup);

    // View mode
    const viewRow = document.createElement("div");
    viewRow.className = "row";
    for (const [mode, label] of [
      ["auto", "자동"],
      ["flat", "2D"],
      ["tilted", "3D"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-pressed", mode === "auto" ? "true" : "false");
      button.addEventListener("click", () => this.engine.setViewMode(mode));
      this.viewButtons.set(mode, button);
      viewRow.append(button);
    }
    this.root.append(viewRow);

    // Basemap style
    const basemapRow = document.createElement("div");
    basemapRow.className = "row";
    for (const [style, label] of [
      ["satellite", "위성"],
      ["map", "지도"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute(
        "aria-pressed",
        style === "satellite" ? "true" : "false",
      );
      button.addEventListener("click", () => {
        this.engine.setBasemapStyle(style);
        this.refresh();
      });
      this.basemapButtons.set(style, button);
      basemapRow.append(button);
    }
    this.root.append(basemapRow);

    // Sim controls
    const simRow = document.createElement("div");
    simRow.className = "row";
    this.playButton = document.createElement("button");
    this.playButton.type = "button";
    this.playButton.textContent = "일시정지";
    this.playButton.addEventListener("click", () => {
      this.engine.simControl(this.engine.playing ? "pause" : "play");
      this.refresh();
    });
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "초기화";
    resetButton.addEventListener("click", () =>
      this.engine.simControl("reset"),
    );
    const igniteButton = document.createElement("button");
    igniteButton.type = "button";
    igniteButton.textContent = "발화";
    igniteButton.addEventListener("click", () => {
      const point = this.engine.pickIgnitePoint();
      this.engine.ignite(point.x, point.y);
    });
    simRow.append(this.playButton, resetButton, igniteButton);
    this.root.append(simRow);

    // Hazard-susceptibility overlay toggle.
    const overlayRow = document.createElement("div");
    overlayRow.className = "row";
    this.overlayButton = document.createElement("button");
    this.overlayButton.type = "button";
    this.overlayButton.textContent = "위험 지역 표시";
    this.overlayButton.setAttribute("aria-pressed", "true");
    this.overlayButton.addEventListener("click", () => {
      this.engine.setOverlay(!this.engine.overlayEnabled);
      this.refresh();
    });
    overlayRow.append(this.overlayButton);
    this.root.append(overlayRow);

    this.hint = document.createElement("p");
    this.hint.className = "hint";
    this.root.append(this.hint);

    this.metricsBox = document.createElement("div");
    this.metricsBox.className = "metrics";
    this.root.append(this.metricsBox);
  }

  private syncRainSlider(): void {
    const value = Math.round(this.engine.rainfall);
    this.rainSlider.value = String(value);
    this.rainOutput.textContent = `${value} mm/h`;
  }

  private refresh(): void {
    const state = this.engine.getState();
    for (const [scenario, button] of this.scenarioButtons) {
      button.setAttribute(
        "aria-pressed",
        scenario === state.scenario ? "true" : "false",
      );
    }
    for (const [mode, button] of this.viewButtons) {
      button.setAttribute(
        "aria-pressed",
        mode === this.engine.viewMode ? "true" : "false",
      );
    }
    this.playButton.textContent = state.playing ? "일시정지" : "재생";
    for (const [style, button] of this.basemapButtons) {
      button.setAttribute(
        "aria-pressed",
        style === this.engine.basemapStyle ? "true" : "false",
      );
    }
    this.overlayButton.setAttribute(
      "aria-pressed",
      this.engine.overlayEnabled ? "true" : "false",
    );
    this.hint.textContent =
      state.scenario === "clear"
        ? "호우·홍수·산사태·해일은 자동으로 3D 전환됩니다"
        : "지도를 클릭하면 그 지점에서 재난이 발생합니다";
    const h = state.hazards;
    this.metricsBox.innerHTML = "";
    const lines: [string, string][] = [
      ["FPS", String(state.fps)],
      ["경과", `${state.simTimeSeconds.toFixed(0)}초`],
      ["침수 면적", `${(h.flood.coverageRatio * 100).toFixed(1)}%`],
      ["연소 셀", String(h.wildfire.burningCells)],
      ["산사태 위험", h.landslide.riskIndex.toFixed(2)],
    ];
    for (const [label, value] of lines) {
      const row = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = `${label} `;
      row.append(strong, document.createTextNode(value));
      this.metricsBox.append(row);
    }
  }
}

const ZONE_ICONS: Record<string, string> = {
  flood: "\u{1F30A}",
  tsunami: "\u{1F30A}",
  wildfire: "\u{1F525}",
  landslide: "\u26F0\uFE0F",
  earthquake: "\u{1F6A8}",
  typhoon: "\u{1F300}",
  nuclear: "\u2622\uFE0F",
  chemical: "\u{1F9EA}",
  snow: "\u2744\uFE0F",
  heatwave: "\u{1F321}\uFE0F",
  coldwave: "\u{1F976}",
  drought: "\u{1F3DC}\uFE0F",
};
const ZONE_ICON_DEFAULT = "\u26A0\uFE0F";

export interface ZoneLabelItem {
  id: string;
  label: string;
  hazard?: string;
  centroid: { x: number; y: number };
}

/**
 * Floating badge labels for server-driven risk zones. Each badge tracks its
 * polygon centroid on screen every frame via the engine's projection.
 */
export class ZoneLabels {
  private items: { data: ZoneLabelItem; el: HTMLDivElement }[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly engine: Engine,
  ) {
    const tick = () => {
      for (const item of this.items) {
        const at = this.engine.projectPoint(
          item.data.centroid.x,
          item.data.centroid.y,
        );
        if (at) {
          item.el.hidden = false;
          item.el.style.transform = `translate(-50%, -50%) translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
        } else {
          item.el.hidden = true;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  set(zones: ZoneLabelItem[]): void {
    this.container.replaceChildren();
    this.items = zones.map((data) => {
      const el = document.createElement("div");
      el.className = "zone-badge";
      el.hidden = true;
      const icon = document.createElement("span");
      icon.textContent = ZONE_ICONS[data.hazard ?? ""] ?? ZONE_ICON_DEFAULT;
      const text = document.createElement("span");
      text.textContent = data.label;
      el.append(icon, text);
      this.container.append(el);
      return { data, el };
    });
  }
}

let statusTimer: ReturnType<typeof setTimeout> | null = null;

export function showStatus(message: string, holdMs = 4000): void {
  const box = document.getElementById("status");
  if (!box) return;
  box.textContent = message;
  box.classList.add("visible");
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => box.classList.remove("visible"), holdMs);
}
