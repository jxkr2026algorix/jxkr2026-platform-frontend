import {
  districtByCode,
  PROVINCE_CODE,
} from "@salgil/map-webgpu-canvas/districts";
import type { PlatformEvent } from "@salgil/platform-client";

interface DistrictStatusPanelProps {
  readonly districtCode: string | null;
  readonly loading: boolean;
  readonly event: PlatformEvent | null;
}

type WeatherSnapshot = {
  readonly condition: string;
  readonly temperature: string;
  readonly humidity: string;
  readonly wind: string;
};

const weatherByDistrict: Record<string, WeatherSnapshot> = {
  "47110": {
    condition: "Clear",
    temperature: "27°C",
    humidity: "58%",
    wind: "E 2.4m/s",
  },
  "47130": {
    condition: "Partly cloudy",
    temperature: "25°C",
    humidity: "62%",
    wind: "SE 1.8m/s",
  },
  "47150": {
    condition: "Clear",
    temperature: "26°C",
    humidity: "55%",
    wind: "NE 1.5m/s",
  },
  "47170": {
    condition: "Cloudy",
    temperature: "24°C",
    humidity: "67%",
    wind: "E 2.1m/s",
  },
  "47190": {
    condition: "Clear",
    temperature: "28°C",
    humidity: "53%",
    wind: "S 2.8m/s",
  },
  "47210": {
    condition: "Partly cloudy",
    temperature: "24°C",
    humidity: "61%",
    wind: "NE 1.7m/s",
  },
  "47230": {
    condition: "Clear",
    temperature: "26°C",
    humidity: "56%",
    wind: "S 2.0m/s",
  },
  "47250": {
    condition: "Partly cloudy",
    temperature: "25°C",
    humidity: "59%",
    wind: "W 1.6m/s",
  },
  "47280": {
    condition: "Cloudy",
    temperature: "23°C",
    humidity: "69%",
    wind: "NE 2.5m/s",
  },
  "47290": {
    condition: "Clear",
    temperature: "27°C",
    humidity: "54%",
    wind: "SE 2.2m/s",
  },
};

const defaultWeather: WeatherSnapshot = {
  condition: "Partly cloudy",
  temperature: "24°C",
  humidity: "63%",
  wind: "NE 1.9m/s",
};

const recentEvents = [
  { time: "14:10", label: "Wildfire watch zones rechecked." },
  { time: "13:42", label: "River levels returned to the normal range." },
  { time: "12:55", label: "Emergency alert channel connection verified." },
] as const;

function getDistrictName(code: string | null): string {
  if (code === null || code === PROVINCE_CODE) return "Gyeongsangbuk-do";
  return districtByCode(code)?.nameEn ?? "Selected district";
}

export function DistrictStatusPanel({
  districtCode,
  loading,
  event,
}: DistrictStatusPanelProps) {
  const weather = districtCode
    ? (weatherByDistrict[districtCode] ?? defaultWeather)
    : defaultWeather;
  const districtName = getDistrictName(districtCode);

  return (
    <aside
      className="district-status-panel"
      aria-label={`${districtName} status summary`}
    >
      <p className="district-status-kicker">District status</p>
      <h2>{districtName}</h2>
      <section aria-label="Weather conditions">
        <div className="district-status-heading">
          <strong>Weather</strong>
          <span>{weather.condition}</span>
        </div>
        <dl className="weather-metrics">
          <div>
            <dt>Temperature</dt>
            <dd>{weather.temperature}</dd>
          </div>
          <div>
            <dt>Humidity</dt>
            <dd>{weather.humidity}</dd>
          </div>
          <div>
            <dt>Wind</dt>
            <dd>{weather.wind}</dd>
          </div>
        </dl>
        <p className="district-data-note">
          Demo weather snapshot · Live weather API pending
        </p>
      </section>
      <section className="district-event-summary" aria-label="Platform alert">
        <strong>Platform alert</strong>
        {loading ? (
          <p role="status">Syncing map data.</p>
        ) : event ? (
          <p>{event.headline}</p>
        ) : (
          <p>No active platform alerts.</p>
        )}
      </section>
      <section className="district-history" aria-label="Recent events">
        <strong>Recent events</strong>
        <ol>
          {recentEvents.map((recentEvent) => (
            <li key={recentEvent.time}>
              <time>{recentEvent.time}</time>
              <span>{recentEvent.label}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
