import { type RoutePlan, recommendedLeg } from "@salgil/platform-client";
import { useI18n } from "../../../i18n";

export function EvacuationResult({
  plan,
  preview,
}: {
  readonly plan: RoutePlan;
  readonly preview: boolean;
}) {
  const { t } = useI18n();
  const best = recommendedLeg(plan);
  const unreachable = plan.routes.filter((leg) => !leg.found);
  let capacityBasis = "";
  if (best?.capacity_basis === "annual_file") {
    capacityBasis = ` · ${t("route.annualCapacity")}`;
  } else if (best?.capacity_basis) {
    capacityBasis = ` · ${best.capacity_basis}`;
  }
  const formatMinutes = (value: number | null | undefined): string =>
    value === null || value === undefined
      ? "—"
      : t("route.minutes", { count: Math.round(value) });
  const formatKm = (metres: number | null | undefined): string =>
    metres === null || metres === undefined
      ? "—"
      : `${(metres / 1000).toFixed(1)} km`;

  return (
    <div className="evacuation-result">
      {preview ? (
        <p className="evacuation-flag">{t("route.sampleFlag")}</p>
      ) : null}

      {best ? (
        <dl className="evacuation-metrics">
          <div>
            <dt>{t("route.nearest")}</dt>
            <dd>{best.shelter_name}</dd>
          </div>
          <div>
            <dt>{t("route.travel")}</dt>
            <dd>
              {formatMinutes(best.duration_minutes)} ·{" "}
              {formatKm(best.distance_m)}
            </dd>
          </div>
          <div>
            <dt>{t("route.peakRisk")}</dt>
            <dd>
              {best.max_risk === null || best.max_risk === undefined
                ? "—"
                : best.max_risk.toFixed(2)}
            </dd>
          </div>
          {best.shelter_capacity !== null &&
          best.shelter_capacity !== undefined ? (
            <div>
              <dt>{t("route.capacity")}</dt>
              <dd>
                {best.shelter_capacity}
                <small>{capacityBasis}</small>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="evacuation-flag" role="status">
          {t("route.noShelter")}
        </p>
      )}

      {unreachable.length > 0 ? (
        <ul className="evacuation-blocked">
          {unreachable.map((leg) => (
            <li key={leg.shelter_id}>
              <strong>{leg.shelter_name}</strong>
              <span>{leg.reason ?? t("route.unreachable")}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {plan.field_reports_applied > 0 ? (
        <p className="evacuation-note">
          {t("route.closures", { count: plan.field_reports_applied })}
        </p>
      ) : null}
      {plan.prediction_is_stub ? (
        <p className="evacuation-note is-warning">
          {t("route.predictionStub")}
        </p>
      ) : null}
      {plan.warnings.map((warning) => (
        <p className="evacuation-note is-warning" key={warning}>
          {warning}
        </p>
      ))}

      <p className="evacuation-notice">{plan.notice}</p>
      <p className="evacuation-attribution">{plan.attribution}</p>
    </div>
  );
}
