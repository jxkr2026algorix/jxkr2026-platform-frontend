/**
 * Map glyphs for hazards and places.
 *
 * All paths are stroke-only inside a 16x16 box, drawn with a single weight and
 * round joins. Stroke reads better than fill at the 11-12 px these render at,
 * and one weight across the set keeps a wildfire badge from shouting louder
 * than a shelter badge for reasons of drawing rather than severity.
 *
 * Each mark is built from the hazard's own shape — a slope shedding debris, a
 * seismograph trace, water stepping up a bank — rather than a generic warning
 * triangle with a letter in it.
 */

export type GlyphName =
  | "rain"
  | "flood"
  | "landslide"
  | "wildfire"
  | "earthquake"
  | "tsunami"
  | "typhoon"
  | "heatwave"
  | "coldwave"
  | "snow"
  | "drought"
  | "chemical"
  | "nuclear"
  | "shelter"
  | "community"
  | "responder"
  | "warning";

export const GLYPHS: Record<GlyphName, string> = {
  // Cloud with falling rain.
  rain: "M4.6 9.2a2.5 2.5 0 0 1 .6-4.9 3.3 3.3 0 0 1 6.2-.6 2.7 2.7 0 0 1 .6 5.4M5.6 11.4l-.7 2.3M8.2 11.4l-.7 2.3M10.8 11.4l-.7 2.3",
  // Water stepping up a bank: two levels, the upper one newly reached.
  flood:
    "M1.6 12.4c1.5 0 1.5-1.3 3-1.3s1.5 1.3 3 1.3 1.5-1.3 3-1.3 1.5 1.3 2.8 1.3M1.6 8.6c1.5 0 1.5-1.3 3-1.3s1.5 1.3 3 1.3 1.5-1.3 3-1.3 1.5 1.3 2.8 1.3M11.4 4.6V1.9M11.4 1.9 9.9 3.4M11.4 1.9l1.5 1.5",
  // A slope that has let go, with debris running out below it.
  landslide:
    "M1.4 13.2 6.6 4.3l2.6 3.7M10.6 10.5h.01M13.2 12.4h.01M9.4 13.2h.01",
  // Flame with the inner tongue that makes it read as fire, not a leaf.
  wildfire:
    "M8 14.1c2.6 0 4.4-1.8 4.4-4.1 0-2.6-2.3-3.5-2.3-6.1 0 0-1.9 1.2-1.9 3.3 0 1-.7 1.5-1.2 1-.5-.5-.4-1.3-.4-1.3S3.6 7.4 3.6 9.7c0 2.5 1.8 4.4 4.4 4.4Z",
  // Seismograph trace across a baseline.
  earthquake: "M1.4 8h2.4l1.7-4.9 2.3 9.4 1.7-5.9 1.2 1.4h3.9",
  // A curling wave over a swell.
  tsunami:
    "M1.5 13c1.9 0 1.9-1.5 3.8-1.5S7.2 13 9 13s1.9-1.5 3.8-1.5M2.9 9.3c0-3.2 2.5-5.7 5.7-5.7 2.1 0 3.5 1.2 3.5 2.7 0 1.2-1 2.1-2.1 2.1-.9 0-1.5-.5-1.5-1.3",
  // Two spiral arms around a calm centre.
  typhoon:
    "M8 8c0-2.5 2-4.5 4.5-4.5 1.3 0 2.3.8 2.3 1.9M8 8c0 2.5-2 4.5-4.5 4.5-1.3 0-2.3-.8-2.3-1.9M8 7.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6Z",
  // Sun over heat shimmer.
  heatwave:
    "M8 3.2a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4ZM8 .9v1.2M8 9.7v1.2M2.9 5.9H1.7M14.3 5.9h-1.2M4.4 2.3l.9.9M11.6 2.3l-.9.9M2.4 13c1.4 0 1.4-1.1 2.8-1.1s1.4 1.1 2.8 1.1 1.4-1.1 2.8-1.1 1.4 1.1 2.8 1.1",
  // Thermometer reading low, flanked by frost. A bare thermometer is too
  // narrow to sit beside the other marks without looking undersized.
  coldwave:
    "M9.6 9.3V3.4a1.6 1.6 0 0 0-3.2 0v5.9a2.9 2.9 0 1 0 3.2 0ZM8 11.4v-1.9M2.2 4.4l2.2 2.2M4.4 4.4 2.2 6.6M11.6 4.4l2.2 2.2M13.8 4.4l-2.2 2.2",
  // Snowflake: three axes with barbs.
  snow: "M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5M6.4 2.9 8 4.5l1.6-1.6M6.4 13.1 8 11.5l1.6 1.6",
  // A last drop over cracked ground.
  drought:
    "M8 1.9s2.4 2.9 2.4 4.3a2.4 2.4 0 0 1-4.8 0C5.6 4.8 8 1.9 8 1.9ZM1.7 11.2h3.5l1.4 1.9M14.3 11.2h-3.2l-1.2 1.9M6.6 13.1l-.6 1.6M9.9 13.1l.6 1.6",
  // Flask with a release.
  chemical:
    "M6.4 1.9v3.7L2.9 11.8a1.6 1.6 0 0 0 1.4 2.4h7.4a1.6 1.6 0 0 0 1.4-2.4L9.6 5.6V1.9M5.6 1.9h4.8M4.6 9.8h6.8",
  // Trefoil reduced to three blades around a core.
  nuclear:
    "M8 6.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8ZM8 6.6V2.2a5.8 5.8 0 0 1 3 .8M9.2 8.7l3.8 2.2a5.8 5.8 0 0 1-2.2 2.2M6.8 8.7 3 10.9a5.8 5.8 0 0 0 2.2 2.2",
  // Roof with a figure moving under it — the evacuation pictogram, not a house.
  shelter:
    "M1.6 7.4 8 2.2l6.4 5.2M4.4 8.9v5.1M11.6 8.9v5.1M4.4 14h7.2M8 9.4v2.6M8 12l-1.4 2M8 12l1.4 2M8 9.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z",
  // A small settlement: two roofs on a shared ground line.
  community:
    "M1.6 8.2 5.2 5l3.6 3.2M2.9 8.2v4.9h4.6V8.2M9 10.4l2.6-2.2 2.8 2.2M10.2 10.4v2.7h3.6v-2.7M1.4 13.1h13.2",
  // Chevron: a team moving in.
  responder:
    "M8 1.9 13.6 4v4.4c0 3.1-2.3 5.2-5.6 6.1-3.3-.9-5.6-3-5.6-6.1V4L8 1.9ZM5.6 8.1 7.4 10l3.2-3.4",
  // Fallback when the hazard is unknown.
  warning: "M8 2.3 14.6 13.4H1.4L8 2.3ZM8 6.6v3.2M8 11.6h.01",
};

/** Backend hazard slugs to a glyph. Unknown hazards fall back to a warning. */
const HAZARD_GLYPHS: Record<string, GlyphName> = {
  rain: "rain",
  heavy_rain: "rain",
  flood: "flood",
  landslide: "landslide",
  wildfire: "wildfire",
  earthquake: "earthquake",
  tsunami: "tsunami",
  typhoon: "typhoon",
  heatwave: "heatwave",
  coldwave: "coldwave",
  cold_wave: "coldwave",
  snow: "snow",
  heavy_snow: "snow",
  drought: "drought",
  chemical: "chemical",
  chemical_accident: "chemical",
  nuclear: "nuclear",
  road_closure: "warning",
};

export function glyphForHazard(hazard: string | undefined): GlyphName {
  return HAZARD_GLYPHS[hazard ?? ""] ?? "warning";
}
