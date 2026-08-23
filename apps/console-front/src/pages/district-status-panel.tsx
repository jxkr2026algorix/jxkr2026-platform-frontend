import {
  districtByCode,
  PROVINCE_CODE,
} from "@salgil/map-webgpu-canvas/districts";
import { formatWind, type PlatformEvent } from "@salgil/platform-client";
import type { ReactNode } from "react";
import { ViewportActions } from "../components/ViewportActions";
import { useI18n } from "../i18n";
import { useWeather } from "../use-weather";

interface DistrictStatusPanelProps {
  readonly districtCode: string | null;
  readonly loading: boolean;
  readonly event: PlatformEvent | null;
  /** Address of the resident app, shown as a QR at the top of the rail. */
  readonly mobileUrl: string;
  /** Rendered below the status sections, e.g. the evacuation routing panel. */
  readonly children?: ReactNode;
}

/** Observation time, so a reading is never shown without when it was taken. */
const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
});

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
  const weather = useWeather(districtCode);
  const snapshot = weather.status === "ready" ? weather.snapshot : null;

  /**
   * A reading the backend did not send stays a dash. Filling it in would put a
   * number on screen that no instrument produced, and nothing downstream could
   * tell it apart from an observation.
   */
  const show = (value: string | null | undefined) => value ?? "—";
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
      <div className="viewport-actions">
        <ViewportActions mobileUrl={mobileUrl} />
      </div>
      <p className="district-status-kicker">{t("district.status")}</p>
      <h2>{districtName}</h2>
      <section aria-label={t("district.weatherConditions")}>
        <div className="district-status-heading">
          <strong>{t("district.weather")}</strong>
          <span>
            {weather.status === "loading"
              ? t("district.weatherLoading")
              : snapshot?.observed_at
                ? timeFormatter.format(new Date(snapshot.observed_at))
                : ""}
          </span>
        </div>
        <dl className="weather-metrics">
          <div>
            <dt>{t("district.temperature")}</dt>
            <dd>
              {show(
                snapshot?.temperature_c != null
                  ? `${snapshot.temperature_c.toFixed(1)}°C`
                  : null,
              )}
            </dd>
          </div>
          <div>
            <dt>{t("district.humidity")}</dt>
            <dd>
              {show(
                snapshot?.humidity_pct != null
                  ? `${Math.round(snapshot.humidity_pct)}%`
                  : null,
              )}
            </dd>
          </div>
          <div>
            <dt>{t("district.wind")}</dt>
            <dd>
              {show(
                formatWind(
                  snapshot?.wind_speed_ms ?? null,
                  snapshot?.wind_direction_deg ?? null,
                ),
              )}
            </dd>
          </div>
          <div>
            <dt>{t("district.rainfall")}</dt>
            <dd>
              {show(
                snapshot?.rainfall_1h_mm != null
                  ? `${snapshot.rainfall_1h_mm.toFixed(1)}mm`
                  : null,
              )}
            </dd>
          </div>
        </dl>
        {/*
          A reading that could not be fetched must not read as clear weather,
          and one past its refresh cycle must carry its time. Both are stated
          rather than left to the blank dashes above.
        */}
        {weather.status === "unavailable" ||
        snapshot?.state === "UNVERIFIED" ? (
          <p className="district-data-note district-data-warning" role="status">
            {t("district.weatherUnavailable")}
          </p>
        ) : snapshot?.stale ? (
          <p className="district-data-note district-data-warning">
            {t("district.weatherStale")}
          </p>
        ) : snapshot?.attribution ? (
          <p className="district-data-note">{snapshot.attribution}</p>
        ) : null}
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
