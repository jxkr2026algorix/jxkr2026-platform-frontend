import ky from "ky";
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

export type PlatformConnection = "connecting" | "live" | "unavailable";

type PlatformClientConfig = {
  readonly apiUrl: string;
  readonly regionCode: string;
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

  async getMobileSession(): Promise<MobileSession> {
    const response = await ky
      .get(`${this.config.apiUrl}/mobile/session`, { retry: 0, timeout: 4_000 })
      .json<unknown>();
    return mobileSessionSchema.parse(response);
  }

  private get incidentsUrl(): string {
    return `${this.config.apiUrl.replace(/\/+$/, "")}/incidents`;
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
            region_code: this.config.regionCode,
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
