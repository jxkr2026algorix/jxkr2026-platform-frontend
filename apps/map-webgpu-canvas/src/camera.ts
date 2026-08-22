/**
 * Orbit camera with a smooth "flat map" (top-down) <-> "tilted 3D" transition.
 * In flat mode dragging pans like a slippy map; in tilted mode dragging orbits
 * and shift/right/two-finger drag pans.
 */

import {
  clamp,
  damp,
  type Mat4,
  mat4Identity,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  type Vec3,
} from "./math";

export type CameraMode = "flat" | "tilted";

const DEFAULT_DISTANCE_FACTOR = 1.65;
const MAX_DISTANCE_FACTOR = 1.8;

interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

export class OrbitCamera {
  private yaw = Math.PI * 0.25;
  private yawGoal = Math.PI * 0.25;
  private pitchTilted = 0.98;
  private distance: number;
  private distanceGoal: number;
  private target: Vec3;
  private targetGoal: Vec3;
  /** 1 = fully flat top-down, 0 = fully tilted. */
  private flatBlend = 1;
  private flatGoal = 1;
  mode: CameraMode = "flat";

  private readonly view = mat4Identity();
  private readonly proj = mat4Identity();
  readonly viewProj = mat4Identity();
  readonly eye: Vec3 = [0, 0, 0];

  private pointers: PointerState[] = [];
  private detachController: AbortController | null = null;
  private pinchDistance = 0;
  private shakeAmp = 0;
  onUserInteraction: (() => void) | null = null;
  /** Fired on a short, motionless click/tap with client coordinates. */
  onTap: ((clientX: number, clientY: number) => void) | null = null;

  constructor(
    private readonly worldSize: number,
    private readonly sampleHeight: (u: number, v: number) => number,
  ) {
    const half = worldSize / 2;
    this.target = [half, this.sampleHeight(0.5, 0.5), half];
    this.targetGoal = [...this.target];
    this.distance = worldSize * DEFAULT_DISTANCE_FACTOR;
    this.distanceGoal = this.distance;
  }

  setMode(mode: CameraMode): void {
    if (mode === "tilted" && this.mode !== "tilted" && this.flatBlend > 0.6) {
      this.yaw = this.yawGoal - Math.PI * 1.25;
    }
    this.mode = mode;
    this.flatGoal = mode === "flat" ? 1 : 0;
    this.distanceGoal = clamp(
      this.distanceGoal,
      this.worldSize * 0.08,
      this.worldSize * MAX_DISTANCE_FACTOR,
    );
    if (mode === "flat") {
      this.distanceGoal = Math.max(this.distanceGoal, this.worldSize * 0.7);
    }
  }

  get blend(): number {
    return this.flatBlend;
  }

  /** Normalized look-at point (0..1), for reporting to the dashboard. */
  get centerUV(): { x: number; y: number } {
    return {
      x: (this.targetGoal[0] ?? 0) / this.worldSize,
      y: (this.targetGoal[2] ?? 0) / this.worldSize,
    };
  }

  get currentDistance(): number {
    return this.distanceGoal;
  }

  /** Earthquake shake amplitude in meters; decays are the caller's job. */
  setShake(amplitudeMeters: number): void {
    this.shakeAmp = Math.max(0, amplitudeMeters);
  }

  /** Smoothly move the look-at point / zoom (dashboard-driven sync). */
  flyTo(u?: number, v?: number, distanceMeters?: number): void {
    const margin = 0.03;
    if (u !== undefined && v !== undefined) {
      const cu = clamp(u, margin, 1 - margin);
      const cv = clamp(v, margin, 1 - margin);
      this.targetGoal[0] = cu * this.worldSize;
      this.targetGoal[2] = cv * this.worldSize;
      this.targetGoal[1] = this.sampleHeight(cu, cv);
    }
    if (distanceMeters !== undefined) {
      this.distanceGoal = clamp(
        distanceMeters,
        this.worldSize * 0.008,
        this.worldSize * MAX_DISTANCE_FACTOR,
      );
    }
  }

  /**
   * Bind pointer/wheel input. Listeners are tied to an AbortController so a
   * terrain reload (which rebuilds the engine on the same canvas) can drop
   * the old camera's handlers instead of stacking a second set on top.
   */
  attach(canvas: HTMLCanvasElement): void {
    this.detachController?.abort();
    const controller = new AbortController();
    this.detachController = controller;
    const { signal } = controller;
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add("dragging");
        this.pointers.push({
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          startTime: performance.now(),
        });
        if (this.pointers.length === 2) {
          const [a, b] = this.pointers as [PointerState, PointerState];
          this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        const pointer = this.pointers.find((p) => p.id === event.pointerId);
        if (!pointer) return;
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        this.onUserInteraction?.();

        if (this.pointers.length === 2) {
          const [a, b] = this.pointers as [PointerState, PointerState];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinchDistance > 0) {
            this.zoomBy(this.pinchDistance / Math.max(dist, 1));
          }
          this.pinchDistance = dist;
          this.pan(dx * 0.5, dy * 0.5);
          return;
        }

        const wantsPan =
          this.flatBlend > 0.5 ||
          event.shiftKey ||
          (event.buttons & 2) !== 0 ||
          (event.buttons & 4) !== 0;
        if (wantsPan) {
          this.pan(dx, dy);
        } else {
          this.yaw -= dx * 0.005;
          this.yawGoal = this.yaw;
          this.pitchTilted = clamp(this.pitchTilted + dy * 0.004, 0.35, 1.35);
        }
      },
      { signal },
    );
    const release = (event: PointerEvent) => {
      const pointer = this.pointers.find((p) => p.id === event.pointerId);
      if (
        pointer &&
        event.type === "pointerup" &&
        this.pointers.length === 1 &&
        event.button === 0 &&
        Math.hypot(
          event.clientX - pointer.startX,
          event.clientY - pointer.startY,
        ) < 6 &&
        performance.now() - pointer.startTime < 500
      ) {
        this.onTap?.(event.clientX, event.clientY);
      }
      this.pointers = this.pointers.filter((p) => p.id !== event.pointerId);
      if (this.pointers.length < 2) this.pinchDistance = 0;
      if (this.pointers.length === 0) canvas.classList.remove("dragging");
    };
    canvas.addEventListener("pointerup", release, { signal });
    canvas.addEventListener("pointercancel", release, { signal });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.onUserInteraction?.();
        this.zoomBy(Math.exp(event.deltaY * 0.0012));
      },
      { signal },
    );
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
      signal,
    });
  }

  /** Release every listener bound by {@link attach}. */
  detach(): void {
    this.detachController?.abort();
    this.detachController = null;
    this.pointers = [];
  }

  private zoomBy(factor: number): void {
    // Deep zoom allowed: the detail LOD swaps in building-level tiles.
    this.distanceGoal = clamp(
      this.distanceGoal * factor,
      this.worldSize * 0.008,
      this.worldSize * MAX_DISTANCE_FACTOR,
    );
  }

  /** Yaw eases to north-up while in flat map mode. */
  private effectiveYaw(): number {
    return this.yaw * (1 - this.flatBlend);
  }

  private pan(dxPixels: number, dyPixels: number): void {
    const scale = this.distance * 0.0011;
    const sin = Math.sin(this.effectiveYaw());
    const cos = Math.cos(this.effectiveYaw());
    const moveX = (-dxPixels * cos - dyPixels * sin) * scale;
    const moveZ = (dxPixels * sin - dyPixels * cos) * scale;
    // Loose clamp here; update() applies the view-extent-aware bound.
    const margin = this.worldSize * 0.02;
    this.targetGoal[0] = clamp(
      this.targetGoal[0] + moveX,
      margin,
      this.worldSize - margin,
    );
    this.targetGoal[2] = clamp(
      this.targetGoal[2] + moveZ,
      margin,
      this.worldSize - margin,
    );
    this.targetGoal[1] = this.sampleHeight(
      this.targetGoal[0] / this.worldSize,
      this.targetGoal[2] / this.worldSize,
    );
  }

  update(dt: number, aspect: number): void {
    this.flatBlend = damp(this.flatBlend, this.flatGoal, 3.2, dt);
    this.yaw = damp(this.yaw, this.yawGoal, 2.6, dt);
    this.distance = damp(this.distance, this.distanceGoal, 5, dt);

    // Keep the visible area inside the map: in flat mode the margin equals
    // the half-extent of the viewport, so dragging stops at the map edge
    // instead of revealing the void beyond it.
    const halfH = Math.tan((20 * Math.PI) / 180) * this.distanceGoal;
    const halfW = halfH * Math.max(aspect, 0.5);
    const base = this.worldSize * 0.02;
    const marginX = Math.min(
      this.worldSize * 0.5,
      base + (halfW * 0.95 - base) * this.flatBlend,
    );
    const marginZ = Math.min(
      this.worldSize * 0.5,
      base + (halfH * 0.95 - base) * this.flatBlend,
    );
    this.targetGoal[0] = clamp(
      this.targetGoal[0],
      Math.max(marginX, base),
      Math.min(this.worldSize - marginX, this.worldSize - base),
    );
    this.targetGoal[2] = clamp(
      this.targetGoal[2],
      Math.max(marginZ, base),
      Math.min(this.worldSize - marginZ, this.worldSize - base),
    );

    for (let axis = 0; axis < 3; axis++) {
      this.target[axis] = damp(
        this.target[axis] ?? 0,
        this.targetGoal[axis] ?? 0,
        6,
        dt,
      );
    }

    const pitch =
      this.pitchTilted * (1 - this.flatBlend) + 1.522 * this.flatBlend;
    const yaw = this.effectiveYaw();
    const horizontal = Math.cos(pitch) * this.distance;
    const eyeX = this.target[0] + Math.sin(yaw) * horizontal;
    const eyeZ = this.target[2] + Math.cos(yaw) * horizontal;
    let eyeY = this.target[1] + Math.sin(pitch) * this.distance;
    const groundY =
      this.sampleHeight(eyeX / this.worldSize, eyeZ / this.worldSize) + 12;
    if (eyeY < groundY) eyeY = groundY;
    this.eye[0] = eyeX + (Math.random() - 0.5) * this.shakeAmp;
    this.eye[1] = eyeY + (Math.random() - 0.5) * this.shakeAmp * 0.6;
    this.eye[2] = eyeZ + (Math.random() - 0.5) * this.shakeAmp;

    mat4LookAt(this.view, this.eye, this.target, [0, 1, 0]);
    mat4Perspective(
      this.proj,
      (40 * Math.PI) / 180,
      aspect,
      Math.max(2, this.worldSize * 0.001),
      this.worldSize * 5,
    );
    mat4Multiply(this.viewProj as Mat4, this.proj, this.view);
  }
}
