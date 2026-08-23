import {
  districtByCode,
  PROVINCE_CODE,
} from "@salgil/map-webgpu-canvas/districts";
import type { PlatformEvent } from "@salgil/platform-client";
import type { ReactNode } from "react";
import { ViewportActions } from "../components/ViewportActions";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n/messages";

interface DistrictStatusPanelProps {
  readonly districtCode: string | null;
  readonly loading: boolean;
  readonly event: PlatformEvent | null;
  /** Address of the resident app, shown as a QR at the top of the rail. */
  readonly mobileUrl: string;
  /** Rendered below the status sections, e.g. the evacuation routing panel. */
  readonly children?: ReactNode;
}

type WeatherSnapshot = {
  readonly conditionKey: TranslationKey;
  readonly temperature: string;
  readonly humidity: string;
  readonly wind: string;
};

const weatherByDistrict: Record<string, WeatherSnapshot> = {
  "47110": {
    conditionKey: "district.clear",
    temperature: "27°C",
    humidity: "58%",
    wind: "E 2.4m/s",
  },
  "47130": {
    conditionKey: "district.partlyCloudy",
    temperature: "25°C",
    humidity: "62%",
    wind: "SE 1.8m/s",
  },
  "47150": {
    conditionKey: "district.clear",
    temperature: "26°C",
    humidity: "55%",
    wind: "NE 1.5m/s",
  },
  "47170": {
    conditionKey: "district.cloudy",
    temperature: "24°C",
    humidity: "67%",
    wind: "E 2.1m/s",
  },
  "47190": {
    conditionKey: "district.clear",
    temperature: "28°C",
    humidity: "53%",
    wind: "S 2.8m/s",
  },
  "47210": {
    conditionKey: "district.partlyCloudy",
    temperature: "24°C",
    humidity: "61%",
    wind: "NE 1.7m/s",
  },
  "47230": {
    conditionKey: "district.clear",
    temperature: "26°C",
    humidity: "56%",
    wind: "S 2.0m/s",
  },
  "47250": {
    conditionKey: "district.partlyCloudy",
    temperature: "25°C",
    humidity: "59%",
    wind: "W 1.6m/s",
  },
  "47280": {
    conditionKey: "district.cloudy",
    temperature: "23°C",
    humidity: "69%",
    wind: "NE 2.5m/s",
  },
  "47290": {
    conditionKey: "district.clear",
    temperature: "27°C",
    humidity: "54%",
    wind: "SE 2.2m/s",
  },
};

const defaultWeather: WeatherSnapshot = {
  conditionKey: "district.partlyCloudy",
  temperature: "24°C",
  humidity: "63%",
  wind: "NE 1.9m/s",
};

const recentEvents = [
  { time: "14:10", labelKey: "district.recentWildfire" },
  { time: "13:42", labelKey: "district.recentRiver" },
  { time: "12:55", labelKey: "district.recentChannel" },
] as const;

export function DistrictStatusPanel({
  districtCode,
  loading,
  event,
  mobileUrl,
  children,
}: DistrictStatusPanelProps) {
  const { locale, t } = useI18n();
  const weather = districtCode
    ? (weatherByDistrict[districtCode] ?? defaultWeather)
    : defaultWeather;
  const district = districtCode ? districtByCode(districtCode) : undefined;
  let districtName = t("district.selected");
  if (districtCode === null || districtCode === PROVINCE_CODE) {
    districtName = t("district.province");
  } else if (district) {
    districtName = locale === "ko" ? district.name : district.nameEn;
  }

  return (
    <aside
      className="district-status-panel"
      aria-label={t("district.summary", { district: districtName })}
    >
      <ViewportActions mobileUrl={mobileUrl} />
      <p className="district-status-kicker">{t("district.status")}</p>
      <h2>{districtName}</h2>
      <section aria-label={t("district.weatherConditions")}>
        <div className="district-status-heading">
          <strong>{t("district.weather")}</strong>
          <span>{t(weather.conditionKey)}</span>
        </div>
        <dl className="weather-metrics">
          <div>
            <dt>{t("district.temperature")}</dt>
            <dd>{weather.temperature}</dd>
          </div>
          <div>
            <dt>{t("district.humidity")}</dt>
            <dd>{weather.humidity}</dd>
          </div>
          <div>
            <dt>{t("district.wind")}</dt>
            <dd>{weather.wind}</dd>
          </div>
        </dl>
        <p className="district-data-note">{t("district.demoWeather")}</p>
      </section>
      <section
        className="district-event-summary"
        aria-label={t("district.platformAlert")}
      >
        <strong>{t("district.platformAlert")}</strong>
        {loading ? (
          <p role="status">{t("district.syncing")}</p>
        ) : event ? (
          <p>{event.headline}</p>
        ) : (
          <p>{t("district.noAlerts")}</p>
        )}
      </section>
      <section
        className="district-history"
        aria-label={t("district.recentEvents")}
      >
        <strong>{t("district.recentEvents")}</strong>
        <ol>
          {recentEvents.map((recentEvent) => (
            <li key={recentEvent.time}>
              <time>{recentEvent.time}</time>
              <span>{t(recentEvent.labelKey)}</span>
            </li>
          ))}
        </ol>
      </section>
      {children}
    </aside>
  );
}
