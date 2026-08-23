/**
 * What a typed request is asking the console to declare.
 *
 * The assistant panel answers most questions through the model, but a request
 * to start a training incident is handled here so it still works when no model
 * is configured. That shortcut used to drop everything except the hazard, so
 * "청송 산불 훈련" and "포항 산불 훈련" produced the same incident at the same
 * demo coordinates — the county in the sentence was read by nobody. This reads
 * it, and hands back the district so the incident can be filed where it was
 * asked for.
 */

import { DISTRICTS, type District } from "@salgil/map-webgpu-canvas/districts";
import type { DisasterType } from "@salgil/platform-client";

/**
 * The hazards this shortcut can raise. Narrower than `DisasterType` on
 * purpose: these are the ones the console has both incident copy and a
 * translated label for, and an intent for any other would name itself in the
 * headline with a key that does not exist.
 */
export type TrainingHazard = (typeof HAZARD_TERMS)[number][0];

export interface IncidentIntent {
  readonly type: TrainingHazard;
  /** The county named in the request, or null to use the console's own. */
  readonly district: District | null;
}

/** Only the hazards the console has copy and a translated label for. */
const HAZARD_TERMS = [
  ["wildfire", ["wildfire", "forest fire", "산불"]],
  ["rain", ["heavy rain", "rainstorm", "호우", "폭우"]],
  ["flood", ["flood", "inundation", "홍수", "침수"]],
  ["landslide", ["landslide", "산사태"]],
  ["heatwave", ["heatwave", "heat wave", "폭염"]],
  ["earthquake", ["earthquake", "지진"]],
] satisfies readonly (readonly [DisasterType, readonly string[]])[];

const TRAINING_TERMS = ["training", "drill", "exercise", "훈련", "연습"];

/**
 * Every way a county gets written in a sentence: the full Korean name, the
 * bare stem people actually type, and the romanization with its administrative
 * suffix dropped. Built once — the table is 22 rows and never changes.
 */
const DISTRICT_TERMS: readonly (readonly [string, District])[] =
  DISTRICTS.flatMap((district) => {
    const bareKorean = district.name.replace(/[시군]$/u, "");
    const bareEnglish = district.nameEn
      .toLowerCase()
      .replace(/-(si|gun)$/u, "");
    return [
      district.name,
      bareKorean,
      district.nameEn.toLowerCase(),
      bareEnglish,
    ].map((term) => [term, district] as const);
  })
    // Longest first: "경산" must not win a query that says "경산시", and a stem
    // that is a prefix of another county's must never shadow the longer one.
    .sort(([a], [b]) => b.length - a.length);

/**
 * Whether a term appears in the query as a place name rather than as part of
 * a longer word. Korean is agglutinative — "청송에", "청송군의" — so a bare
 * substring match is what is wanted there. Latin text is not: "Gyeongsangbuk-do"
 * contains "gyeongsan", and matching it declared incidents in Gyeongsan-si
 * every time someone named the province.
 */
function mentions(query: string, term: string): boolean {
  if (!/[a-z]/u.test(term)) return query.includes(term);
  let from = 0;
  while (true) {
    const at = query.indexOf(term, from);
    if (at === -1) return false;
    const before = query[at - 1] ?? "";
    const after = query[at + term.length] ?? "";
    if (!/[a-z]/u.test(before) && !/[a-z]/u.test(after)) return true;
    from = at + 1;
  }
}

/** The county named in the query, if any. */
export function districtInQuery(query: string): District | null {
  const normalized = query.toLocaleLowerCase();
  return (
    DISTRICT_TERMS.find(([term]) => mentions(normalized, term))?.[1] ?? null
  );
}

/**
 * The incident a training request is asking for, or null when the request is
 * not one — an ordinary question belongs to the model, not to this shortcut.
 */
export function resolveTrainingIntent(query: string): IncidentIntent | null {
  const normalized = query.toLocaleLowerCase();
  if (!TRAINING_TERMS.some((term) => normalized.includes(term))) return null;
  const type = HAZARD_TERMS.find(([, terms]) =>
    terms.some((term) => normalized.includes(term)),
  )?.[0];
  if (!type) return null;
  return { type, district: districtInQuery(normalized) };
}
