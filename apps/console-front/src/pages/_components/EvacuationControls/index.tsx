import { type TransportMode, transportModes } from "@salgil/platform-client";
import { useI18n } from "../../../i18n";

type EvacuationControlsProps = {
  readonly mode: TransportMode;
  readonly pending: boolean;
  readonly hasPlan: boolean;
  readonly onModeChange: (mode: TransportMode) => void;
  readonly onPlan: () => void;
  readonly onClear: () => void;
};

export function EvacuationControls({
  mode,
  pending,
  hasPlan,
  onModeChange,
  onPlan,
  onClear,
}: EvacuationControlsProps) {
  const { t } = useI18n();
  const modeLabels: Readonly<Record<TransportMode, string>> = {
    foot: t("route.foot"),
    assisted: t("route.assisted"),
    bicycle: t("route.bicycle"),
    car: t("route.car"),
  };

  return (
    <>
      <fieldset className="compact-controls">
        <legend>{t("route.transport")}</legend>
        <div className="segmented-track">
          {transportModes.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => onModeChange(option)}
            >
              <span className="segmented-label">{modeLabels[option]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="evacuation-actions">
        <button
          className="button"
          type="button"
          disabled={pending}
          onClick={onPlan}
        >
          {pending ? t("route.planning") : t("route.plan")}
        </button>
        {hasPlan ? (
          <button className="button secondary" type="button" onClick={onClear}>
            {t("route.clear")}
          </button>
        ) : null}
      </div>
    </>
  );
}
