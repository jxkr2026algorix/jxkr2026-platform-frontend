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

const regions = [
  "포항시",
  "경주시",
  "김천시",
  "안동시",
  "구미시",
  "영주시",
  "영천시",
  "상주시",
  "문경시",
  "경산시",
  "의성군",
  "청송군",
  "영양군",
  "영덕군",
  "청도군",
  "고령군",
  "성주군",
  "칠곡군",
  "예천군",
  "봉화군",
  "울진군",
  "울릉군",
] as const;

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
      normalized.includes(region.replace(/[시군]$/, "")),
    );
    return {
      name: "gbsafe_hazard_context",
      args: {
        region: matchedRegion ?? "청송군",
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
      ? `최근 1시간 강우 ${rainfall.payload.value} ${String(rainfall.payload.unit ?? "mm")}`
      : null,
    observedAt ? `관측 시각 ${observedAt}` : null,
    `${parsed.data.record_count}건의 공공데이터 레코드 확인`,
  ].filter((detail): detail is string => detail !== null);
  const missingSourceCount = parsed.data.warnings?.length ?? 0;
  return {
    text:
      parsed.data.complete === false
        ? "일부 원천을 확인하지 못해 현재 상황을 완전하게 판단할 수 없습니다. 확인된 자료만 요약합니다."
        : "현재 조회 가능한 공공데이터를 확인했습니다.",
    details,
    ...(missingSourceCount > 0
      ? {
          warning: `확인하지 못한 데이터 원천이 ${missingSourceCount}개 있습니다. 대피 판단 전 원천 상태를 별도로 확인하세요.`,
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
    text: `${summary.connectors}개 데이터 원천 중 ${summary.available}개를 지금 사용할 수 있습니다.`,
    details: [
      `심의 대기 ${summary.pending_review}개`,
      `로컬 파일 필요 ${summary.requires_local_file}개`,
    ],
    citations: [],
  };
}

function formatDatasetSearch(value: unknown): AssistantAnswer | null {
  const parsed = datasetSearchSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    text: `${parsed.data.count}개 관련 데이터셋을 찾았고 ${parsed.data.callable_now}개는 즉시 호출할 수 있습니다.`,
    details: parsed.data.datasets.map(
      (dataset) =>
        `${dataset.provider} · ${dataset.name}${dataset.dev_ready ? "" : " · 심의 필요"}`,
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
    text: `13개 재난 유형 중 ${ready.length}개는 탐지·위험도·대피소 정보를 모두 확인할 수 있습니다.`,
    details: [
      `전체 지원 · ${ready.join(", ")}`,
      `부분 지원 · ${partial.join(", ")}`,
      `탐지 제한 · ${blocked.join(", ")}`,
    ],
    warning:
      "부분 지원은 위험도나 대피소 자료가 부족하고, 탐지 제한 재난은 발생 여부도 확인할 수 없습니다. 이 답만으로 대피를 결정하지 마세요.",
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
      text: "공공데이터 조회는 완료했지만 이 화면에서 요약할 수 없는 형식입니다.",
      details: ["질문을 지역명과 재난 유형을 포함해 다시 입력해 주세요."],
      citations: [],
    }
  );
}
