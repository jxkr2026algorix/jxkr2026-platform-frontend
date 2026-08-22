/**
 * Standalone control panel for developing and demoing without the dashboard.
 * The dashboard drives the same engine methods through the postMessage
 * bridge; this panel is hidden when embedded (unless ?ui=1).
 */

import type { Engine } from "./gpu/engine";
import type { Scenario } from "./protocol";

const SCENARIO_LABELS: Record<Scenario, string> = {
  clear: "Clear",
  rain: "Rain",
  flood: "Flood",
  wildfire: "Wildfire",
  landslide: "Landslide",
  typhoon: "Typhoon",
  earthquake: "Earthquake",
  tsunami: "Tsunami",
  nuclear: "Nuclear accident",
  chemical: "Chemical incident",
  heatwave: "Heatwave",
  coldwave: "Cold wave",
  snow: "Heavy snow",
  drought: "Drought",
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
    private engine: Engine,
  ) {
    this.build();
    this.root.hidden = false;
    setInterval(() => this.refresh(), 500);
  }

  /** Re-point at the engine rebuilt by a terrain-region reload. */
  setEngine(engine: Engine): void {
    this.engine = engine;
  }

  private build(): void {
    const heading = document.createElement("h2");
    heading.textContent = "Disaster simulation";
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
    rainLabel.textContent = "Rainfall";
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
      ["auto", "Auto"],
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
      ["satellite", "Satellite"],
      ["map", "Map"],
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
    this.playButton.textContent = "Pause";
    this.playButton.addEventListener("click", () => {
      this.engine.simControl(this.engine.playing ? "pause" : "play");
      this.refresh();
    });
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset";
    resetButton.addEventListener("click", () =>
      this.engine.simControl("reset"),
    );
    const igniteButton = document.createElement("button");
    igniteButton.type = "button";
    igniteButton.textContent = "Ignite";
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
    this.overlayButton.textContent = "Show hazard areas";
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
    this.playButton.textContent = state.playing ? "Pause" : "Play";
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
        ? "Rain, flood, landslide, and tsunami scenarios switch to 3D automatically"
        : "Pick a hazard, then click the map";
    const h = state.hazards;
    this.metricsBox.innerHTML = "";
    const lines: [string, string][] = [
      ["FPS", String(state.fps)],
      ["Elapsed", `${state.simTimeSeconds.toFixed(0)} sec`],
      ["Flooded area", `${(h.flood.coverageRatio * 100).toFixed(1)}%`],
      ["Burning cells", String(h.wildfire.burningCells)],
      ["Landslide risk", h.landslide.riskIndex.toFixed(2)],
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

let statusTimer: ReturnType<typeof setTimeout> | null = null;

export function showStatus(message: string, holdMs = 4000): void {
  const box = document.getElementById("status");
  if (!box) return;
  box.textContent = message;
  box.classList.add("visible");
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => box.classList.remove("visible"), holdMs);
}
