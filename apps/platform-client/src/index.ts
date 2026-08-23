import ky from "ky";
import { z } from "zod";
import {
  type EventDraft,
  type MobileSession,
  mobileSessionSchema,
  type PlatformEvent,
  type PlatformMessage,
  platformEventSchema,
  platformMessageSchema,
} from "./contracts";
import {
  backendIncidentSchema,
  createIncidentPayload,
  incidentPageSchema,
  incidentToPlatformEvent,
} from "./incidents";
import {
  type RoutePlan,
  type RouteRequest,
  routePlanSchema,
  type Shelter,
  shelterSchema,
  toRouteRequestBody,
} from "./routing";
import { type WeatherSnapshot, weatherSnapshotSchema } from "./weather";

export {
  DEMO_LOCATION,
  type DisasterType,
  disasterTypes,
  type EventDraft,
  type IncidentMode,
  type MobileSession,
  type PlatformEvent,
  type PlatformMessage,
} from "./contracts";
export { HAZARD_TO_SCENARIO, SCENARIO_TO_HAZARD } from "./incidents";
export {
  type RouteLeg,
  type RoutePlan,
  type RouteRequest,
  recommendedLeg,
  type Shelter,
  type TransportMode,
  transportModes,
} from "./routing";
export {
  decodeFrameValues,
  type IncidentDeclared,
  openSituationStream,
  type PredictionFrame,
  type SharedRenderState,
  type StreamEvent,
} from "./stream";
export {
  compassPoint,
  formatWind,
  type WeatherReading,
  type WeatherSnapshot,
} from "./weather";

export type PlatformConnection = "connecting" | "live" | "unavailable";

type PlatformClientConfig = {
  readonly apiUrl: string;
  /** The county an incident declared from this screen belongs to. */
  readonly regionCode: string;
  /**
   * Watch every county rather than just `regionCode`. The provincial console
   * covers all 22 — filtering its own view to one of them hides an incident
   * declared anywhere else, including one the assistant just started.
   */
  readonly watchAllRegions?: boolean;
  readonly pollIntervalMs?: number;
};

type Listener = (message: PlatformMessage) => void;
type ConnectionListener = (connection: PlatformConnection) => void;

const CHANNEL_NAME = "salgil-platform-incidents";
const LAST_EVENT_KEY = "salgil:last-platform-incident";

export class PlatformRequestError extends Error {
  readonly name = "PlatformRequestError";
}

export class PlatformClient {
  private readonly listeners = new Set<Listener>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private channel: BroadcastChannel | null = null;
  private pollTimer: number | null = null;
  private activeRequest: AbortController | null = null;
  private polling = false;
  private latestVersion = "";

  constructor(private readonly config: PlatformClientConfig) {}

  start(): void {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      const parsed = platformMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      this.rememberVersion(parsed.data);
      this.emit(parsed.data);
    });
    const saved = localStorage.getItem(LAST_EVENT_KEY);
    if (saved) {
      try {
        const parsed = platformEventSchema.safeParse(JSON.parse(saved));
        if (parsed.success) {
          this.latestVersion = this.eventVersion(parsed.data);
          this.emit({ kind: "disaster.event", event: parsed.data });
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    this.setConnection("connecting");
    void this.pollIncidents();
    this.pollTimer = window.setInterval(
      () => void this.pollIncidents(),
      this.config.pollIntervalMs ?? 2_000,
    );
  }

  stop(): void {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.channel?.close();
    this.channel = null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  async publish(draft: EventDraft): Promise<PlatformEvent> {
    try {
      const response = await ky
        .post(this.incidentsUrl, {
          json: createIncidentPayload(draft, this.config.regionCode),
          retry: 0,
          timeout: 8_000,
        })
        .json<unknown>();
      const incident = backendIncidentSchema.parse(response);
      const event = incidentToPlatformEvent(incident);
      if (!event) {
        throw new PlatformRequestError("Unsupported incident hazard", {
          cause: incident.hazard,
        });
      }
      this.latestVersion = this.eventVersion(event);
      this.broadcast({ kind: "disaster.event", event });
      this.broadcast({
        kind: "control.sync",
        mode: event.mode,
        selectedType: event.type,
      });
      this.setConnection("live");
      return event;
    } catch (error) {
      this.setConnection("unavailable");
      if (error instanceof PlatformRequestError) throw error;
      if (error instanceof Error) {
        throw new PlatformRequestError("Failed to create platform incident", {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Shelters usable for one hazard. `hazard` is required by the backend on
   * purpose: an earthquake shelter is not a flood shelter, and letting the
   * question be asked without it invites exactly that substitution.
   */
  async findShelters(options: {
    hazard: string;
    regionCode?: string;
    lat?: number;
    lon?: number;
    limit?: number;
  }): Promise<Shelter[]> {
    const search = new URLSearchParams({ hazard: options.hazard });
    if (options.regionCode) search.set("region_code", options.regionCode);
    if (options.lat !== undefined) search.set("lat", String(options.lat));
    if (options.lon !== undefined) search.set("lon", String(options.lon));
    if (options.limit) search.set("limit", String(options.limit));
    const response = await ky
      .get(`${this.baseUrl}/shelters?${search}`, { retry: 0, timeout: 8_000 })
      .json<unknown>();
    return z.array(shelterSchema).parse(response);
  }

  /**
   * Current weather for one district. `region` takes either the 5-digit code
   * or the Korean name; the backend resolves both.
   *
   * Deliberately not cached here: a stale reading presented as current is the
   * failure this endpoint exists to remove.
   */
  async getWeather(region: string): Promise<WeatherSnapshot> {
    const response = await ky
      .get(
        `${this.baseUrl}/situation/weather?region=${encodeURIComponent(region)}`,
        {
          retry: 0,
          timeout: 15_000,
        },
      )
      .json<unknown>();
    return weatherSnapshotSchema.parse(response);
  }

  /**
   * Ask the platform to compute spread for an incident. Frames arrive on the
   * situation stream, not in this response — the first one is worth showing
   * before the last one exists.
   */
  async startSpread(request: {
    hazard: string;
    lat: number;
    lon: number;
    incidentId?: string;
    regionCode?: string;
    sizeMeters?: number;
    horizonsMinutes?: readonly number[];
  }): Promise<{ horizonsMinutes: number[] }> {
    const response = await ky
      .post(`${this.baseUrl}/stream/spread`, {
        json: {
          hazard: request.hazard,
          lat: request.lat,
          lon: request.lon,
          ...(request.incidentId ? { incident_id: request.incidentId } : {}),
          ...(request.regionCode ? { region_code: request.regionCode } : {}),
          ...(request.sizeMeters ? { size_m: request.sizeMeters } : {}),
          ...(request.horizonsMinutes
            ? { horizons_minutes: [...request.horizonsMinutes] }
            : {}),
        },
        retry: 0,
        timeout: 10_000,
      })
      .json<{ horizons_minutes?: number[] }>();
    return { horizonsMinutes: response.horizons_minutes ?? [] };
  }

  /** Broadcast what this screen is looking at, so the others can follow. */
  async shareRenderState(state: {
    districtCode?: string | null;
    scenario?: string | null;
    viewMode?: string | null;
    incidentId?: string | null;
    source?: "console" | "mobile";
  }): Promise<void> {
    await ky
      .post(`${this.baseUrl}/stream/render-state`, {
        json: {
          ...(state.districtCode ? { district_code: state.districtCode } : {}),
          ...(state.scenario ? { scenario: state.scenario } : {}),
          ...(state.viewMode ? { view_mode: state.viewMode } : {}),
          ...(state.incidentId ? { incident_id: state.incidentId } : {}),
          source: state.source ?? "console",
        },
        retry: 0,
        timeout: 5_000,
      })
      .json<unknown>()
      .catch(() => undefined);
  }

  /**
   * Evacuation routes that avoid the predicted hazard. The result is a
   * suggestion: callers must surface `notice` and `attribution` rather than
   * presenting it as an official safe route.
   */
  async planEvacuation(request: RouteRequest): Promise<RoutePlan> {
    const response = await ky
      .post(`${this.baseUrl}/routing/evacuation`, {
        json: toRouteRequestBody(request),
        retry: 0,
        timeout: 20_000,
      })
      .json<unknown>();
    return routePlanSchema.parse(response);
  }

  private get baseUrl(): string {
    return this.config.apiUrl.replace(/\/+$/, "");
  }

  async getMobileSession(): Promise<MobileSession> {
    const response = await ky
      .get(`${this.config.apiUrl}/mobile/session`, { retry: 0, timeout: 4_000 })
      .json<unknown>();
    return mobileSessionSchema.parse(response);
  }

  private get incidentsUrl(): string {
    return `${this.baseUrl}/incidents`;
  }

  private async pollIncidents(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    const controller = new AbortController();
    this.activeRequest = controller;
    try {
      const response = await ky
        .get(this.incidentsUrl, {
          searchParams: {
            status: "open",
            ...(this.config.watchAllRegions
              ? {}
              : { region_code: this.config.regionCode }),
            limit: 50,
            offset: 0,
          },
          retry: 0,
          signal: controller.signal,
          timeout: 8_000,
        })
        .json<unknown>();
      const page = incidentPageSchema.parse(response);
      let latest: PlatformEvent | null = null;
      for (const incident of page.items) {
        latest = incidentToPlatformEvent(incident);
        if (latest) break;
      }
      if (latest) {
        const version = this.eventVersion(latest);
        if (version !== this.latestVersion) {
          this.latestVersion = version;
          this.broadcast({ kind: "disaster.event", event: latest });
          this.broadcast({
            kind: "control.sync",
            mode: latest.mode,
            selectedType: latest.type,
          });
        }
      } else if (this.latestVersion !== "empty") {
        this.latestVersion = "empty";
        this.broadcast({ kind: "incident.clear" });
      }
      this.setConnection("live");
    } catch (error) {
      if (error instanceof Error) {
        if (error.name !== "AbortError") this.setConnection("unavailable");
        return;
      }
      throw error;
    } finally {
      if (this.activeRequest === controller) this.activeRequest = null;
      this.polling = false;
    }
  }

  private eventVersion(event: PlatformEvent): string {
    return `${event.id}:${event.sequence}`;
  }

  private rememberVersion(message: PlatformMessage): void {
    if (message.kind === "disaster.event") {
      this.latestVersion = this.eventVersion(message.event);
    }
    if (message.kind === "incident.clear") this.latestVersion = "empty";
  }

  private broadcast(message: PlatformMessage): void {
    if (message.kind === "disaster.event") {
      localStorage.setItem(LAST_EVENT_KEY, JSON.stringify(message.event));
    }
    if (message.kind === "incident.clear") {
      localStorage.removeItem(LAST_EVENT_KEY);
    }
    this.emit(message);
    this.channel?.postMessage(message);
  }

  private emit(message: PlatformMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  private setConnection(connection: PlatformConnection): void {
    for (const listener of this.connectionListeners) listener(connection);
  }
}

export function createPlatformClient(config: PlatformClientConfig) {
  return new PlatformClient(config);
}
