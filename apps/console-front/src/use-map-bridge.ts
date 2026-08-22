import {
  DASHBOARD_SOURCE,
  type DashboardCommand,
  MAP_SOURCE,
  type MapPoint,
  type MapStatePayload,
  type MapToDashboard,
  PROTOCOL_VERSION,
  SCENARIOS,
  type Scenario,
  type TriggerKind,
} from "@salgil/map-webgpu-canvas/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DISTRICT_CODE,
  DEFAULT_MAP_SCENARIO,
  DEFAULT_RAINFALL_MM_PER_HOUR,
} from "./domain";
import {
  applyOptimisticControlCommand,
  initialMapControls,
  type MapControlState,
  type PendingMapControls,
  reconcileMapControls,
} from "./map-control-state";

export type MapConnection = "loading" | "ready" | "unsupported" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isScenario(value: unknown): value is Scenario {
  return typeof value === "string" && SCENARIOS.some((item) => item === value);
}

function isSeverity(value: unknown): boolean {
  return ["none", "advisory", "watch", "warning"].some(
    (severity) => severity === value,
  );
}

function isTriggerKind(value: unknown): value is TriggerKind {
  return [
    "flood",
    "wildfire",
    "landslide",
    "earthquake",
    "tsunami",
    "nuclear",
    "chemical",
  ].some((kind) => kind === value);
}

function isMapStatePayload(value: unknown): value is MapStatePayload {
  if (
    !isRecord(value) ||
    !isRecord(value.hazards) ||
    !isRecord(value.camera) ||
    !isRecord(value.district)
  ) {
    return false;
  }
  const { flood, wildfire, landslide } = value.hazards;
  const { center, distanceMeters } = value.camera;
  if (!isRecord(flood) || !isRecord(wildfire) || !isRecord(landslide)) {
    return false;
  }
  const hasValidScenarioState =
    isScenario(value.scenario) &&
    (value.viewMode === "flat" || value.viewMode === "tilted") &&
    isFiniteNumber(value.rainfallMmPerHour);
  const hasValidBasemap =
    value.basemap === "satellite" || value.basemap === "map";
  const hasValidPlaybackState =
    typeof value.playing === "boolean" &&
    isFiniteNumber(value.speed) &&
    isFiniteNumber(value.simTimeSeconds) &&
    isFiniteNumber(value.fps);
  const hasValidCameraState =
    isRecord(center) &&
    isFiniteNumber(center.x) &&
    isFiniteNumber(center.y) &&
    isFiniteNumber(distanceMeters);
  const { selected, overlay, loading } = value.district;
  const hasValidDistrictState =
    (selected === null || typeof selected === "string") &&
    typeof overlay === "boolean" &&
    typeof loading === "boolean";
  const hasValidHazardState =
    isFiniteNumber(flood.coverageRatio) &&
    isSeverity(flood.severity) &&
    isFiniteNumber(wildfire.burningCells) &&
    isSeverity(wildfire.severity) &&
    isFiniteNumber(landslide.riskIndex) &&
    isSeverity(landslide.severity);
  return (
    hasValidScenarioState &&
    hasValidBasemap &&
    hasValidPlaybackState &&
    hasValidCameraState &&
    hasValidDistrictState &&
    hasValidHazardState
  );
}

function isMapMessage(value: unknown): value is MapToDashboard {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  const payload = value.payload;
  if (value.source !== MAP_SOURCE || value.v !== PROTOCOL_VERSION) return false;
  if (value.type === "map:ready") {
    const { world, capabilities } = payload;
    const hasValidProtocol = payload.protocolVersion === PROTOCOL_VERSION;
    const hasValidWorld =
      isRecord(world) &&
      isFiniteNumber(world.gridSize) &&
      isFiniteNumber(world.sizeMeters);
    const hasValidCapabilities =
      isRecord(capabilities) &&
      Array.isArray(capabilities.scenarios) &&
      capabilities.scenarios.every(isScenario) &&
      isFiniteNumber(capabilities.maxRainfallMmPerHour);
    return (
      hasValidProtocol &&
      typeof payload.webgpuSupported === "boolean" &&
      hasValidWorld &&
      hasValidCapabilities
    );
  }
  if (value.type === "map:state") return isMapStatePayload(payload);
  if (value.type === "map:point-selected") {
    return (
      isTriggerKind(payload.hazard) &&
      isRecord(payload.at) &&
      isFiniteNumber(payload.at.x) &&
      isFiniteNumber(payload.at.y)
    );
  }
  if (value.type === "map:error") {
    const validCode = [
      "webgpu-unsupported",
      "device-lost",
      "bad-command",
      "internal",
    ].some((code) => code === payload.code);
    return validCode && typeof payload.message === "string";
  }
  return false;
}

function getMapLocation(): { src: string; origin: string } {
  const configuredUrl = import.meta.env.VITE_MAP_URL ?? "http://localhost:5183";
  const url = new URL(configuredUrl, window.location.href);
  url.searchParams.set("origin", window.location.origin);
  url.searchParams.set("ui", "0");
  url.searchParams.set("scenario", DEFAULT_MAP_SCENARIO);
  url.searchParams.set("rain", String(DEFAULT_RAINFALL_MM_PER_HOUR));
  url.searchParams.set("district", DEFAULT_DISTRICT_CODE);
  return { src: url.toString(), origin: url.origin };
}

export function useMapBridge() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [connection, setConnection] = useState<MapConnection>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [controls, setControls] = useState<MapControlState>(initialMapControls);
  const [pointSelection, setPointSelection] = useState<{
    readonly hazard: TriggerKind;
    readonly at: MapPoint;
    /** Real coordinate of the marked origin, when the map has a georeference. */
    readonly lat?: number;
    readonly lon?: number;
    readonly radiusMeters?: number;
    readonly nonce: number;
  } | null>(null);
  const controlsRef = useRef<MapControlState>(initialMapControls);
  const initializedRef = useRef(false);
  const pendingControlsRef = useRef<PendingMapControls>({});
  const pendingRainfallRef = useRef<DashboardCommand | null>(null);
  const rainfallFrameRef = useRef<number | null>(null);
  const mapLocation = useMemo(getMapLocation, []);

  const postCommand = useCallback(
    (command: DashboardCommand) => {
      frameRef.current?.contentWindow?.postMessage(
        {
          source: DASHBOARD_SOURCE,
          v: PROTOCOL_VERSION,
          ...command,
        },
        mapLocation.origin,
      );
    },
    [mapLocation.origin],
  );

  const send = useCallback(
    (command: DashboardCommand) => {
      const update = applyOptimisticControlCommand(
        controlsRef.current,
        pendingControlsRef.current,
        command,
      );
      controlsRef.current = update.controls;
      pendingControlsRef.current = update.pending;
      setControls(update.controls);

      if (command.type !== "map:set-rainfall") {
        postCommand(command);
        return;
      }

      pendingRainfallRef.current = command;
      if (rainfallFrameRef.current !== null) return;
      rainfallFrameRef.current = requestAnimationFrame(() => {
        const latestCommand = pendingRainfallRef.current;
        pendingRainfallRef.current = null;
        rainfallFrameRef.current = null;
        if (latestCommand) postCommand(latestCommand);
      });
    },
    [postCommand],
  );

  useEffect(
    () => () => {
      if (rainfallFrameRef.current !== null) {
        cancelAnimationFrame(rainfallFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== mapLocation.origin ||
        !isMapMessage(event.data)
      )
        return;
      const message = event.data;
      const initializeMap = () => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        send({
          type: "map:set-scenario",
          payload: {
            scenario: DEFAULT_MAP_SCENARIO,
            rainfallMmPerHour: DEFAULT_RAINFALL_MM_PER_HOUR,
          },
        });
        send({ type: "map:set-view", payload: { mode: "flat" } });
        send({ type: "map:set-overlay", payload: { enabled: false } });
        send({
          type: "map:focus-district",
          payload: { code: DEFAULT_DISTRICT_CODE },
        });
      };
      if (message.type === "map:ready") {
        setConnection(
          message.payload.webgpuSupported ? "ready" : "unsupported",
        );
        if (message.payload.webgpuSupported) {
          initializeMap();
        }
      }
      if (message.type === "map:state") {
        setConnection("ready");
        const update = reconcileMapControls(
          controlsRef.current,
          pendingControlsRef.current,
          message.payload,
        );
        controlsRef.current = update.controls;
        pendingControlsRef.current = update.pending;
        setControls(update.controls);
        initializeMap();
      }
      if (message.type === "map:error") {
        setConnection("error");
        setErrorMessage(message.payload.message);
      }
      if (message.type === "map:point-selected") {
        setPointSelection({
          hazard: message.payload.hazard,
          at: message.payload.at,
          ...(message.payload.lat !== undefined
            ? { lat: message.payload.lat }
            : {}),
          ...(message.payload.lon !== undefined
            ? { lon: message.payload.lon }
            : {}),
          ...(message.payload.radiusMeters !== undefined
            ? { radiusMeters: message.payload.radiusMeters }
            : {}),
          nonce: Date.now(),
        });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [mapLocation.origin, send]);

  return {
    frame: { ref: frameRef, src: mapLocation.src },
    status: { connection, controls, errorMessage, pointSelection },
    send,
  };
}
