/**
 * Situation stream (`GET /api/v1/stream`).
 *
 * Polling cannot carry spread. Frames arrive every few seconds, so a screen
 * that asks every five skips between them, and the console and the phone end
 * up drawing different moments. Since the evacuation route is planned on top
 * of that field, both have to be looking at the same one.
 */

import { z } from "zod";

/** A hazard field frame, matching the platform's PredictionResult grid. */
export const predictionFrameSchema = z.object({
  prediction_id: z.string(),
  recipe: z.string(),
  hazard: z.string(),
  horizon_minutes: z.number().default(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** [west, south, east, north] in degrees. */
  bbox: z.array(z.number()).length(4),
  /** float32 little-endian, base64. Row-major, north row first. */
  values_b64: z.string(),
  /** Always true: this is a model output, not an official hazard grade. */
  is_derived: z.boolean().default(true),
  is_stub: z.boolean().default(false),
  feature_mode: z.string().nullish(),
  derived_notice: z.string().nullish(),
});

export type PredictionFrame = z.infer<typeof predictionFrameSchema>;

export const renderStateSchema = z.object({
  district_code: z.string().nullish(),
  scenario: z.string().nullish(),
  view_mode: z.string().nullish(),
  incident_id: z.string().nullish(),
  playing: z.boolean().nullish(),
  horizon_minutes: z.number().nullish(),
  source: z.string().default("console"),
});

export type SharedRenderState = z.infer<typeof renderStateSchema>;

export const incidentDeclaredSchema = z.object({
  incident_id: z.string(),
  code: z.string().nullish(),
  title: z.string(),
  hazard: z.string(),
  region_name: z.string().nullish(),
  /**
   * A drill, not an incident. This has to travel with the event: a screen
   * showing only the incident list has no other way to tell them apart, and a
   * drill that looks real teaches people to ignore the next real one.
   */
  drill: z.boolean().default(false),
  mode: z.string().nullish(),
  lat: z.number().nullish(),
  lon: z.number().nullish(),
});

export type IncidentDeclared = z.infer<typeof incidentDeclaredSchema>;

export type StreamEvent =
  | { kind: "open" }
  | { kind: "frame"; frame: PredictionFrame; values: Float32Array }
  | { kind: "render-state"; state: SharedRenderState }
  | { kind: "spread-complete"; frames: number }
  | { kind: "incident"; incident: IncidentDeclared };

/** Decode the packed grid. Base64 float32 is six times smaller than JSON. */
export function decodeFrameValues(frame: PredictionFrame): Float32Array {
  const binary = atob(frame.values_b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, frame.width * frame.height);
}

export interface StreamOptions {
  readonly apiUrl: string;
  readonly incidentId?: string;
  readonly onEvent: (event: StreamEvent) => void;
  readonly onConnectionChange?: (connected: boolean) => void;
}

/**
 * Subscribe to the stream. Returns a function that closes it.
 *
 * EventSource reconnects on its own, which is what we want: the map should
 * pick the field back up after a dropped connection without the operator
 * doing anything.
 */
export function openSituationStream(options: StreamOptions): () => void {
  const url = new URL(
    `${options.apiUrl.replace(/\/+$/, "")}/stream`,
    window.location.href,
  );
  if (options.incidentId)
    url.searchParams.set("incident_id", options.incidentId);

  const source = new EventSource(url.toString(), { withCredentials: false });

  source.addEventListener("open", () => options.onConnectionChange?.(true));
  source.addEventListener("error", () => options.onConnectionChange?.(false));

  source.addEventListener("stream.open", () =>
    options.onEvent({ kind: "open" }),
  );

  source.addEventListener("prediction.frame", (event) => {
    try {
      const frame = predictionFrameSchema.parse(
        JSON.parse((event as MessageEvent<string>).data),
      );
      options.onEvent({
        kind: "frame",
        frame,
        values: decodeFrameValues(frame),
      });
    } catch (error) {
      // One malformed frame must not take the stream down; the next one may
      // be fine, and a blank map is worse than a stale one.
      console.warn("discarding malformed prediction frame", error);
    }
  });

  source.addEventListener("render.state", (event) => {
    try {
      options.onEvent({
        kind: "render-state",
        state: renderStateSchema.parse(
          JSON.parse((event as MessageEvent<string>).data),
        ),
      });
    } catch (error) {
      console.warn("discarding malformed render state", error);
    }
  });

  source.addEventListener("incident.declared", (event) => {
    try {
      options.onEvent({
        kind: "incident",
        incident: incidentDeclaredSchema.parse(
          JSON.parse((event as MessageEvent<string>).data),
        ),
      });
    } catch (error) {
      console.warn("discarding malformed incident event", error);
    }
  });

  source.addEventListener("spread.complete", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        frames?: number;
      };
      options.onEvent({ kind: "spread-complete", frames: data.frames ?? 0 });
    } catch {
      options.onEvent({ kind: "spread-complete", frames: 0 });
    }
  });

  return () => source.close();
}
