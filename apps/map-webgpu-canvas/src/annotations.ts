/**
 * Map annotation overlay: the operating picture drawn above the 3D canvas
 * from front-end or platform signals.
 *
 * Geometry (zone outlines, route lines) is an SVG layer; labels are HTML
 * chips, because they need the product's Pretendard GOV stack and a real
 * shadow, neither of which SVG text gives us. Both are re-projected every
 * frame through the engine, so annotations stay pinned to the terrain.
 *
 * The visual language is deliberately quiet: white label chips with a hairline
 * border and a small colour-carrying glyph, thin outlines, and a light tint
 * inside hazard areas. The basemap underneath has to stay readable — the
 * operator is reading terrain and roads *through* the hazard, not instead of
 * it — so nothing here floods an area with colour.
 *
 * Nothing here touches the renderer: annotations are presentation, and the
 * simulation neither reads them nor is affected by them.
 */

import { GLYPHS, type GlyphName, glyphForHazard } from "./glyphs";
import type {
  AnyPoint,
  MapMarker,
  MapRoute,
  MarkerKind,
  RiskZone,
} from "./protocol";

interface Projected {
  x: number;
  y: number;
}

/** Resolves a protocol point to normalized map coordinates. */
export type PointResolver = (point: AnyPoint) => Projected | null;

/** Projects a normalized map point to CSS pixels; null when behind camera. */
export interface Projector {
  projectPointUnclipped(u: number, v: number): Projected | null;
  readonly viewportSize: { width: number; height: number };
}

/** Fired when an operator activates a predicted risk zone's badge. */
export type ZoneActivateHandler = (zone: {
  id: string;
  hazard: string | undefined;
  /** Predicted origin in normalized map coordinates. */
  at: Projected;
}) => void;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Semantic tokens from the design contract. Severity is a scale, not a set. */
const SEVERITY_COLORS: Record<string, string> = {
  warning: "#ef4444",
  watch: "#f97316",
  advisory: "#d97706",
  none: "#3366ff",
};

const ROUTE_COLORS: Record<string, string> = {
  open: "#22c55e",
  advised: "#f97316",
  blocked: "#ef4444",
};

const MARKER_COLORS: Record<MarkerKind, string> = {
  shelter: "#3366ff",
  community: "#3366ff",
  facility: "#3366ff",
  incident: "#ef4444",
  responder: "#22c55e",
};

/** Places get the mark for what they are, hazards for what they do. */
const MARKER_GLYPHS: Record<MarkerKind, GlyphName> = {
  shelter: "shelter",
  community: "community",
  facility: "community",
  incident: "warning",
  responder: "responder",
};

const HEX = /^#?([0-9a-f]{6})$/i;

function normalizeHex(value: string | undefined): string | null {
  const hex = value?.match(HEX)?.[1];
  return hex ? `#${hex}` : null;
}

function withAlpha(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function markerKind(marker: MapMarker): MarkerKind {
  const kind = marker.kind;
  return kind && kind in MARKER_COLORS ? kind : "facility";
}

/** One stroke weight across the whole set; see glyphs.ts. */
function glyphNode(name: GlyphName): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", "0 0 16 16");
  node.setAttribute("class", "annotation-chip-glyph");
  node.append(
    el("path", {
      d: GLYPHS[name],
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.6,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  return node;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function toPath(points: Projected[]): string {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    d += `${i === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }
  return d;
}

/** One resolved annotation: normalized geometry plus its rendered nodes. */
interface ZoneItem {
  points: Projected[];
  path: SVGPathElement;
  chip: HTMLElement | null;
  centroid: Projected;
}

interface RouteItem {
  points: Projected[];
  /** Casing under the coloured core, so the line survives satellite imagery. */
  casing: SVGPathElement;
  path: SVGPathElement;
  chip: HTMLElement | null;
  labelIndex: number;
}

interface MarkerItem {
  at: Projected;
  chip: HTMLElement;
}

export class MapAnnotations {
  private readonly svg: SVGSVGElement;
  private readonly zoneGroup: SVGGElement;
  private readonly routeGroup: SVGGElement;
  private readonly chips: HTMLDivElement;

  private zones: ZoneItem[] = [];
  private routes: RouteItem[] = [];
  private markers: MarkerItem[] = [];
  private viewport = { width: 0, height: 0 };

  /** Set by the host to run the simulation from an activated zone. */
  onActivateZone: ZoneActivateHandler | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly engine: Projector,
    private readonly resolve: PointResolver,
  ) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "annotation-svg");
    this.svg.setAttribute("aria-hidden", "true");
    // Routes read as being on the ground, so they sit under the zone tints.
    this.routeGroup = document.createElementNS(SVG_NS, "g");
    this.zoneGroup = document.createElementNS(SVG_NS, "g");
    this.svg.append(this.routeGroup, this.zoneGroup);

    this.chips = document.createElement("div");
    this.chips.className = "annotation-chips";
    this.container.append(this.svg, this.chips);

    const tick = () => {
      this.update();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Layer replacement
  // -------------------------------------------------------------------------

  setZones(zones: RiskZone[]): void {
    this.zoneGroup.replaceChildren();
    this.zones = [];
    for (const zone of zones) {
      const points = zone.polygon
        .map(this.resolve)
        .filter((point): point is Projected => point !== null);
      if (points.length < 3) continue;

      const severity = zone.severity ?? "none";
      const color =
        normalizeHex(zone.color) ??
        SEVERITY_COLORS[severity] ??
        SEVERITY_COLORS.none ??
        "#3366ff";
      // Dashed while the hazard is still a forecast, solid once it is a
      // warning: the outline itself says how sure we are.
      const predicted = severity !== "warning";
      const path = el("path", {
        fill: withAlpha(color, 0.13),
        stroke: color,
        "stroke-width": 1.75,
        "stroke-linejoin": "round",
        ...(predicted ? { "stroke-dasharray": "7 5" } : {}),
      });
      this.zoneGroup.append(path);

      let cx = 0;
      let cy = 0;
      for (const point of points) {
        cx += point.x;
        cy += point.y;
      }
      const centroid = { x: cx / points.length, y: cy / points.length };

      // A predicted zone the operator cannot run is of little use, so badges
      // are actionable unless the payload opts out.
      const activatable = zone.activatable !== false;
      const chip = zone.label
        ? this.addChip(zone.label, color, {
            glyph: glyphForHazard(zone.hazard),
            tone: "hazard",
          })
        : null;
      if (chip && activatable) {
        const origin =
          (zone.origin ? this.resolve(zone.origin) : null) ?? centroid;
        chip.classList.add("is-actionable");
        chip.setAttribute("role", "button");
        chip.setAttribute("tabindex", "0");
        chip.title = "Run the simulation from this predicted origin";
        const activate = () =>
          this.onActivateZone?.({
            id: zone.id,
            hazard: zone.hazard,
            at: origin,
          });
        chip.addEventListener("click", activate);
        chip.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        });
      }
      this.zones.push({ points, path, chip, centroid });
    }
    this.update();
  }

  setRoutes(routes: MapRoute[]): void {
    this.routeGroup.replaceChildren();
    this.routes = [];
    for (const route of routes) {
      const points = route.path
        .map(this.resolve)
        .filter((point): point is Projected => point !== null);
      if (points.length < 2) continue;

      const state = route.state ?? "open";
      const color =
        normalizeHex(route.color) ??
        ROUTE_COLORS[state] ??
        ROUTE_COLORS.open ??
        "#22c55e";
      const blocked = state === "blocked";
      const width = blocked ? 3 : 3.5;
      const casing = el("path", {
        fill: "none",
        stroke: "rgba(255, 255, 255, 0.9)",
        "stroke-width": width + 3,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });
      const path = el("path", {
        fill: "none",
        stroke: color,
        "stroke-width": width,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        ...(blocked ? { "stroke-dasharray": "2 6" } : {}),
      });
      this.routeGroup.append(casing, path);

      this.routes.push({
        points,
        casing,
        path,
        chip: route.label
          ? this.addChip(route.label, color, {
              ...(blocked ? { glyph: "warning" as const } : {}),
              tone: blocked ? "blocked" : "route",
            })
          : null,
        labelIndex: Math.floor((points.length - 1) / 2),
      });
    }
    this.update();
  }

  setMarkers(markers: MapMarker[]): void {
    for (const marker of this.markers) marker.chip.remove();
    this.markers = [];
    for (const marker of markers) {
      const at = this.resolve(marker.at);
      if (!at) continue;
      const kind = markerKind(marker);
      const color =
        normalizeHex(marker.color) ?? MARKER_COLORS[kind] ?? "#3366ff";
      this.markers.push({
        at,
        chip: this.addChip(marker.label ?? "", color, {
          glyph: MARKER_GLYPHS[kind],
          tone: "place",
          selected: marker.selected === true,
        }),
      });
    }
    this.update();
  }

  /** Drop every layer, e.g. before a terrain region swap. */
  clear(): void {
    this.setZones([]);
    this.setRoutes([]);
    this.setMarkers([]);
  }

  // -------------------------------------------------------------------------
  // Chips
  // -------------------------------------------------------------------------

  private addChip(
    label: string,
    color: string,
    options: {
      glyph?: GlyphName | undefined;
      tone: "place" | "hazard" | "route" | "blocked";
      selected?: boolean;
    },
  ): HTMLElement {
    const chip = document.createElement("div");
    chip.className = `annotation-chip is-${options.tone}${
      options.selected ? " is-selected" : ""
    }`;
    chip.hidden = true;
    chip.style.setProperty("--chip-accent", color);

    if (options.glyph) chip.append(glyphNode(options.glyph));
    if (label) {
      const text = document.createElement("span");
      text.textContent = label;
      chip.append(text);
    }
    this.chips.append(chip);
    return chip;
  }

  // -------------------------------------------------------------------------
  // Per-frame projection
  // -------------------------------------------------------------------------

  private place(chip: HTMLElement | null, at: Projected | null): void {
    if (!chip) return;
    const { width, height } = this.viewport;
    // Chips are culled at the viewport edge; geometry is not, so a partly
    // visible zone keeps its outline even once its badge has dropped out.
    if (!at || at.x < 0 || at.x > width || at.y < 0 || at.y > height) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    // The independent `translate` property, not `transform`: an inline
    // transform would override the stylesheet's hover and press states.
    chip.style.translate = `${at.x.toFixed(1)}px ${at.y.toFixed(1)}px`;
  }

  /** Project one normalized point, or null if it is behind the camera. */
  private screen(point: Projected): Projected | null {
    return this.engine.projectPointUnclipped(point.x, point.y);
  }

  private update(): void {
    const size = this.engine.viewportSize;
    if (
      size.width !== this.viewport.width ||
      size.height !== this.viewport.height
    ) {
      this.viewport = { width: size.width, height: size.height };
      this.svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    }

    for (const zone of this.zones) {
      const screen = zone.points.map((point) => this.screen(point));
      // Any vertex behind the camera makes the projection meaningless, so the
      // whole zone is hidden rather than drawn inside out.
      if (screen.some((point) => point === null)) {
        zone.path.setAttribute("d", "");
        this.place(zone.chip, null);
        continue;
      }
      zone.path.setAttribute("d", `${toPath(screen as Projected[])}Z`);
      this.place(zone.chip, this.screen(zone.centroid));
    }

    for (const route of this.routes) {
      const screen = route.points.map((point) => this.screen(point));
      if (screen.some((point) => point === null)) {
        route.path.setAttribute("d", "");
        route.casing.setAttribute("d", "");
        this.place(route.chip, null);
        continue;
      }
      const d = toPath(screen as Projected[]);
      route.path.setAttribute("d", d);
      route.casing.setAttribute("d", d);
      this.place(route.chip, screen[route.labelIndex] ?? null);
    }

    for (const marker of this.markers) {
      this.place(marker.chip, this.screen(marker.at));
    }
  }
}
