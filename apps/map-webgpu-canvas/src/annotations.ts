/**
 * Map annotation overlay: the static UI drawn above the 3D canvas from
 * front-end or platform signals.
 *
 * Geometry (zone outlines, route polylines) is an SVG layer; labels are HTML
 * chips so they keep the product's type and blur treatment, which SVG text
 * cannot reproduce. Both are re-projected every frame through the engine, so
 * annotations stay pinned to the terrain as the camera moves.
 *
 * Nothing here touches the renderer: annotations are a presentation layer, and
 * the simulation neither reads nor is affected by them.
 */

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

const SVG_NS = "http://www.w3.org/2000/svg";

const SEVERITY_COLORS: Record<string, string> = {
  warning: "#ef4444",
  watch: "#f97316",
  advisory: "#eab308",
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
  facility: "#5c6068",
  incident: "#ef4444",
  responder: "#22c55e",
};

/**
 * Glyph paths in a 16x16 box, centered on (8,8). Shapes rather than emoji:
 * they stay legible at chip size and inherit the accent color.
 */
const MARKER_GLYPHS: Record<MarkerKind, string> = {
  shelter: "M8 2.4 13.6 8 8 13.6 2.4 8Z",
  community: "M3.4 3.4h9.2v9.2H3.4Z",
  facility: "M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3Z",
  incident: "M8 2.6 14 13.2H2Z",
  responder:
    "M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2Zm0 3.4a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z",
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

/** One resolved annotation: normalized geometry plus its rendered nodes. */
interface ZoneItem {
  points: Projected[];
  path: SVGPathElement;
  chip: HTMLElement | null;
  centroid: Projected;
}

interface RouteItem {
  points: Projected[];
  path: SVGPathElement;
  chip: HTMLElement | null;
  /** Index into `points` where the label sits. */
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

      const color =
        normalizeHex(zone.color) ??
        SEVERITY_COLORS[zone.severity ?? "none"] ??
        SEVERITY_COLORS.none ??
        "#3366ff";
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("fill", withAlpha(color, 0.16));
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-dasharray", "8 6");
      path.setAttribute("stroke-linejoin", "round");
      this.zoneGroup.append(path);

      let cx = 0;
      let cy = 0;
      for (const point of points) {
        cx += point.x;
        cy += point.y;
      }
      this.zones.push({
        points,
        path,
        chip: zone.label
          ? this.addChip("hazard", zone.label, color, false)
          : null,
        centroid: { x: cx / points.length, y: cy / points.length },
      });
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
        normalizeHex(route.color) ?? ROUTE_COLORS[state] ?? ROUTE_COLORS.open;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color ?? "#22c55e");
      path.setAttribute("stroke-width", state === "blocked" ? "5" : "4");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      if (state === "blocked") path.setAttribute("stroke-dasharray", "10 8");
      this.routeGroup.append(path);

      this.routes.push({
        points,
        path,
        chip: route.label
          ? this.addChip(
              state === "blocked" ? "blocked" : "route",
              route.label,
              color ?? "#22c55e",
              false,
            )
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
        chip: this.addChip(
          "place",
          marker.label ?? "",
          color,
          marker.selected === true,
          kind,
        ),
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
  // Per-frame projection
  // -------------------------------------------------------------------------

  private addChip(
    variant: "hazard" | "place" | "route" | "blocked",
    label: string,
    color: string,
    selected: boolean,
    glyph?: MarkerKind,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = `annotation-chip is-${variant}${selected ? " is-selected" : ""}`;
    el.hidden = true;
    el.style.setProperty("--chip-accent", color);

    if (glyph) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("class", "annotation-chip-glyph");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", MARKER_GLYPHS[glyph]);
      svg.append(path);
      el.append(svg);
    }
    if (label) {
      const text = document.createElement("span");
      text.textContent = label;
      el.append(text);
    }
    this.chips.append(el);
    return el;
  }

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
    chip.style.transform = `translate(-50%, -50%) translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
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
        this.place(route.chip, null);
        continue;
      }
      route.path.setAttribute("d", toPath(screen as Projected[]));
      this.place(route.chip, screen[route.labelIndex] ?? null);
    }

    for (const marker of this.markers) {
      this.place(marker.chip, this.screen(marker.at));
    }
  }
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
