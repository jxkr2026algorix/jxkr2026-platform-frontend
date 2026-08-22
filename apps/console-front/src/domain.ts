import type { MapPoint, Scenario } from "@salgil/map-webgpu-canvas/protocol";

export type View = "situation" | "plan" | "contact" | "patrol";
export type CommunityName = "Sangchon" | "Wolwe" | "Bunam" | "Juwangsan";

/** Cheongsong-gun: the district the console opens on. */
export const DEFAULT_DISTRICT_CODE = "47750";

/**
 * Nothing is happening when the console opens. Booting into a hazard scenario
 * painted the whole province in susceptibility colour and told the operator an
 * incident was under way when none had been declared.
 */
export const DEFAULT_MAP_SCENARIO: Scenario = "clear";
export const DEFAULT_RAINFALL_MM_PER_HOUR = 72;

export interface Community {
  name: CommunityName;
  residents: number;
  status: string;
  hazard: string;
  support: string;
  shelter: string;
  transport: string;
  update: string;
  note: string;
  mapPoint: MapPoint;
}

export const communities: readonly Community[] = [
  {
    name: "Sangchon",
    residents: 34,
    status: "Evacuate now",
    hazard: "Slope failure risk",
    support: "12 mobility needs",
    shelter: "Jinbo Sports Center",
    transport: "Bus 1 · ambulance",
    update: "14:08 · sensor fusion",
    note: "Exposure and mobility needs place Sangchon first. The eastern approach is blocked.",
    mapPoint: { x: 0.52, y: 0.42 },
  },
  {
    name: "Wolwe",
    residents: 27,
    status: "Prepare evacuation",
    hazard: "Wildfire approach",
    support: "4 assisted transfers",
    shelter: "Jinbo Sports Center",
    transport: "Bus 1",
    update: "14:06 · fire watch",
    note: "Wildfire movement has narrowed the safe departure window. Keep the western route clear.",
    mapPoint: { x: 0.7, y: 0.3 },
  },
  {
    name: "Bunam",
    residents: 15,
    status: "Monitor access",
    hazard: "Road access disruption",
    support: "2 transport needs",
    shelter: "Bunam Community Center",
    transport: "Response van",
    update: "14:02 · road team",
    note: "The primary bridge remains open, but the northern approach requires active monitoring.",
    mapPoint: { x: 0.6, y: 0.6 },
  },
  {
    name: "Juwangsan",
    residents: 10,
    status: "Monitor services",
    hazard: "Power and communications outage",
    support: "Radio check required",
    shelter: "Juwangsan Visitor Center",
    transport: "Standby vehicle",
    update: "13:56 · utility report",
    note: "Power and communications remain unstable. Maintain radio contact and standby transport.",
    mapPoint: { x: 0.76, y: 0.52 },
  },
];

export interface ScenarioOption {
  value: Exclude<Scenario, "clear">;
  label: string;
  summary: string;
}

export const scenarioOptions: readonly ScenarioOption[] = [
  {
    value: "rain",
    label: "Heavy rain",
    summary: "Rapid river rise, lowland flooding, and road closures.",
  },
  {
    value: "flood",
    label: "Flood",
    summary: "River overflow may inundate homes, farmland, and access roads.",
  },
  {
    value: "landslide",
    label: "Landslide",
    summary:
      "Saturated slopes and burned forests can fail with little warning.",
  },
  {
    value: "wildfire",
    label: "Wildfire",
    summary:
      "Dry weather and strong wind can drive rapid mountain fire spread.",
  },
  {
    value: "earthquake",
    label: "Earthquake",
    summary:
      "Building damage, infrastructure failure, and liquefaction are possible.",
  },
  {
    value: "nuclear",
    label: "Nuclear accident",
    summary: "Radiological release requires coordinated wide-area evacuation.",
  },
  {
    value: "typhoon",
    label: "Typhoon",
    summary:
      "Strong wind and rainfall can combine across multiple hazard zones.",
  },
  {
    value: "tsunami",
    label: "Tsunami",
    summary: "An offshore earthquake may threaten Gyeongbuk's east coast.",
  },
  {
    value: "heatwave",
    label: "Heatwave",
    summary: "Older residents and outdoor workers need cooling-center support.",
  },
  {
    value: "coldwave",
    label: "Cold wave",
    summary:
      "Exposure, frozen utilities, and vulnerable households need monitoring.",
  },
  {
    value: "snow",
    label: "Heavy snow",
    summary: "Mountain roads may close and isolate rural communities.",
  },
  {
    value: "drought",
    label: "Drought",
    summary:
      "Water shortages require sustained supply and agricultural response.",
  },
  {
    value: "chemical",
    label: "Chemical incident",
    summary:
      "Industrial releases require fast plume prediction and evacuation.",
  },
];

export const navItems: readonly {
  view: View;
  path: `/${string}`;
  label: string;
  shortLabel: string;
}[] = [
  {
    view: "situation",
    path: "/situation",
    label: "Situation",
    shortLabel: "Situation",
  },
  {
    view: "plan",
    path: "/evacuation-plan",
    label: "Evacuation plan",
    shortLabel: "Plan",
  },
  {
    view: "contact",
    path: "/contact-status",
    label: "Contact status",
    shortLabel: "Contacts",
  },
  {
    view: "patrol",
    path: "/field-tasks",
    label: "Field tasks",
    shortLabel: "Field",
  },
];
