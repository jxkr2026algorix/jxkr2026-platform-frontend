import { DISTRICTS } from "@salgil/map-webgpu-canvas/districts";
import { z } from "zod";
import { callMcpTool } from "./mcp-client";

const hazardTerms = [
  ["heavy_rain", ["호우", "폭우", "강우", "heavy rain"]],
  ["flood", ["홍수", "침수", "flood"]],
  ["landslide", ["산사태", "landslide"]],
  ["wildfire", ["산불", "wildfire"]],
  ["typhoon", ["태풍", "typhoon"]],
  ["tsunami", ["지진해일", "해일", "tsunami"]],
  ["earthquake", ["지진", "earthquake"]],
  ["heatwave", ["폭염", "heatwave"]],
  ["cold_wave", ["한파", "cold wave"]],
  ["heavy_snow", ["대설", "폭설", "heavy snow"]],
  ["drought", ["가뭄", "drought"]],
  ["chemical_accident", ["화학", "chemical"]],
  ["nuclear", ["원전", "방사능", "nuclear"]],
] as const;

const regions = DISTRICTS.map((district) => ({
  backendName: district.name,
  searchTerms: [
    district.nameEn.toLowerCase(),
    district.name.replace(/[시군]$/, ""),
  ],
}));

const citationSchema = z.object({
  dataset_name: z.string(),
  provider: z.string(),
  source_url: z
    .string()
    .url()
    .refine(
      (value) => value.startsWith("https://") || value.startsWith("http://"),
    ),
  as_of: z.string().nullable().optional(),
});

const commonResultSchema = z
  .object({
    complete: z.boolean().optional(),
    warnings: z.array(z.string()).optional(),
    citations: z.array(citationSchema).optional(),
  })
  .passthrough();

const hazardResultSchema = commonResultSchema.extend({
  record_count: z.number(),
  records: z.array(
    z.object({
      payload: z.record(z.string(), z.unknown()),
      source: z.object({
        provider: z.string(),
        dataset_name: z.string(),
      }),
      freshness: z.object({
        as_of: z.string().nullable(),
        usable_for_decision: z.boolean(),
      }),
    }),
  ),
});

const dataHealthSchema = z.object({
  summary: z.object({
    connectors: z.number(),
    available: z.number(),
    pending_review: z.number(),
    requires_local_file: z.number(),
  }),
});

const datasetSearchSchema = z.object({
  count: z.number(),
  callable_now: z.number(),
  notes: z.array(z.string()),
  datasets: z.array(
    z.object({
      name: z.string(),
      provider: z.string(),
      dev_ready: z.boolean(),
      source_url: z
        .string()
        .url()
        .refine(
          (value) =>
            value.startsWith("https://") || value.startsWith("http://"),
        ),
    }),
  ),
});

const hazardCapabilitiesSchema = z.object({
  summary: z.object({
    ready: z.array(z.string()),
    partial: z.array(z.string()),
    blocked: z.array(z.string()),
  }),
  how_to_read: z.string(),
});

export type AssistantCitation = {
  readonly label: string;
  readonly url: string;
  readonly asOf?: string;
};

export type AssistantAnswer = {
  readonly text: string;
  readonly details: readonly string[];
  readonly warning?: string;
  readonly citations: readonly AssistantCitation[];
};

type ToolRoute = {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
};

function includesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function uniqueCitations(
  citations: readonly z.infer<typeof citationSchema>[],
): AssistantCitation[] {
  const unique = new Map<string, AssistantCitation>();
  for (const citation of citations) {
    const key = `${citation.provider}-${citation.dataset_name}-${citation.source_url}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      label: `${citation.provider} · ${citation.dataset_name}`,
      url: citation.source_url,
      ...(citation.as_of ? { asOf: citation.as_of } : {}),
    });
  }
  return [...unique.values()].slice(0, 3);
}

function routeQuery(query: string): ToolRoute {
  const normalized = query.toLowerCase();
  if (includesAny(normalized, ["데이터 상태", "원천 상태", "data health"])) {
    return { name: "gbsafe_data_health", args: {} };
  }
  if (includesAny(normalized, ["대응 범위", "지원 범위", "coverage"])) {
    return { name: "gbsafe_hazard_capabilities", args: {} };
  }
  const hazard = hazardTerms.find(([, terms]) =>
    includesAny(normalized, terms),
  )?.[0];
  if (hazard || includesAny(normalized, ["현재", "상황", "위험", "status"])) {
    const matchedRegion = regions.find((region) =>
      region.searchTerms.some((term) => normalized.includes(term)),
    );
    return {
      name: "gbsafe_hazard_context",
      args: {
        region: matchedRegion?.backendName ?? "청송군",
        ...(hazard ? { hazard } : {}),
      },
    };
  }

  return {
    name: "gbsafe_search_datasets",
    args: { query, limit: 5 },
  };
}

function formatHazardResult(value: unknown): AssistantAnswer | null {
  const parsed = hazardResultSchema.safeParse(value);
  if (!parsed.success) return null;
  const rainfall = parsed.data.records.find(
    (record) => record.payload.kind === "rainfall_1h",
  );
  const headline = parsed.data.records.find(
    (record) => typeof record.payload.headline === "string",
  );
  const observedAt = parsed.data.records.find(
    (record) => record.freshness.as_of !== null,
  )?.freshness.as_of;
  const details = [
    headline && typeof headline.payload.headline === "string"
      ? headline.payload.headline
      : null,
    rainfall && typeof rainfall.payload.value === "number"
      ? `Rainfall in the last hour: ${rainfall.payload.value} ${String(rainfall.payload.unit ?? "mm")}`
      : null,
    observedAt ? `Observed at ${observedAt}` : null,
    `${parsed.data.record_count} public data records checked`,
  ].filter((detail): detail is string => detail !== null);
  const missingSourceCount = parsed.data.warnings?.length ?? 0;
  return {
    text:
      parsed.data.complete === false
        ? "Some sources are unavailable, so the current situation cannot be assessed completely. This summary uses verified data only."
        : "Available public data has been checked.",
    details,
    ...(missingSourceCount > 0
      ? {
          warning: `${missingSourceCount} data sources could not be checked. Verify source status before making an evacuation decision.`,
        }
      : {}),
    citations: uniqueCitations(parsed.data.citations ?? []),
  };
}

function formatDataHealth(value: unknown): AssistantAnswer | null {
  const parsed = dataHealthSchema.safeParse(value);
  if (!parsed.success) return null;
  const summary = parsed.data.summary;
  return {
    text: `${summary.available} of ${summary.connectors} data sources are available now.`,
    details: [
      `${summary.pending_review} pending review`,
      `${summary.requires_local_file} require local files`,
    ],
    citations: [],
  };
}

function formatDatasetSearch(value: unknown): AssistantAnswer | null {
  const parsed = datasetSearchSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    text: `Found ${parsed.data.count} relevant datasets; ${parsed.data.callable_now} are callable now.`,
    details: parsed.data.datasets.map(
      (dataset) =>
        `${dataset.provider} · ${dataset.name}${dataset.dev_ready ? "" : " · Review required"}`,
    ),
    ...(parsed.data.notes[0] ? { warning: parsed.data.notes[0] } : {}),
    citations: parsed.data.datasets.map((dataset) => ({
      label: `${dataset.provider} · ${dataset.name}`,
      url: dataset.source_url,
    })),
  };
}

function formatHazardCapabilities(value: unknown): AssistantAnswer | null {
  const parsed = hazardCapabilitiesSchema.safeParse(value);
  if (!parsed.success) return null;
  const { ready, partial, blocked } = parsed.data.summary;
  return {
    text: `${ready.length} of 13 hazard types have complete detection, risk, and shelter coverage.`,
    details: [
      `Full coverage · ${ready.join(", ")}`,
      `Partial coverage · ${partial.join(", ")}`,
      `Detection limited · ${blocked.join(", ")}`,
    ],
    warning:
      "Partial coverage may lack risk or shelter data, and detection-limited hazards may not confirm whether an incident occurred. Do not make evacuation decisions from this answer alone.",
    citations: [],
  };
}

export async function answerAssistantQuery(
  query: string,
): Promise<AssistantAnswer> {
  const route = routeQuery(query);
  const result = await callMcpTool(route.name, route.args);
  return (
    formatHazardResult(result) ??
    formatDataHealth(result) ??
    formatHazardCapabilities(result) ??
    formatDatasetSearch(result) ?? {
      text: "The public data request completed, but its format cannot be summarized here.",
      details: ["Try again with a district name and hazard type."],
      citations: [],
    }
  );
}
