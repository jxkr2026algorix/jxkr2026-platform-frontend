import type { DisasterType, PlatformEvent } from "@salgil/platform-client";
import { motion } from "motion/react";
import { SegmentIndicator } from "../components/SegmentIndicator";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n/messages";

/**
 * Every hazard happens in a place. There is no area-wide disaster to declare:
 * the operator always marks where it is before it can be simulated.
 */
const eventOptions: readonly {
  readonly type: DisasterType;
  readonly labelKey: TranslationKey;
}[] = [
  { type: "rain", labelKey: "event.rain" },
  { type: "flood", labelKey: "event.flood" },
  { type: "landslide", labelKey: "event.landslide" },
  { type: "wildfire", labelKey: "event.wildfire" },
  { type: "earthquake", labelKey: "event.earthquake" },
  { type: "heatwave", labelKey: "event.heatwave" },
];

type EventControlsProps = {
  /** Null until the operator picks one; nothing is chosen on load. */
  readonly selectedType: DisasterType | null;
  readonly placementArmed: boolean;
  readonly publishing: boolean;
  readonly errorMessage: string;
  readonly latestEvent: PlatformEvent | null;
  readonly onSelect: (type: DisasterType | null) => void;
  /** "simulate" rehearses locally; "declare" records a real incident. */
  readonly mode: "simulate" | "declare";
  readonly onModeChange: (mode: "simulate" | "declare") => void;
  readonly onDeclare: (
    type: DisasterType,
    mode: "simulate" | "declare",
  ) => void;
  readonly onReset: () => void;
};

/**
 * Declaring an incident is a two-step act: pick the hazard, then confirm.
 *
 * The first version published on the first click, which is why it had to be
 * hidden behind a lock. Choose-then-confirm needs no lock and no explaining —
 * the pending choice is visible, and the confirm button says exactly what will
 * happen when it is pressed.
 */
export function EventControls({
  selectedType,
  placementArmed,
  publishing,
  errorMessage,
  latestEvent,
  mode,
  onModeChange,
  onSelect,
  onDeclare,
  onReset,
}: EventControlsProps) {
  const { locale, t } = useI18n();
  const selected = eventOptions.find((o) => o.type === selectedType);
  const selectedLabel = selected ? t(selected.labelKey) : "";
  // English reads better mid-sentence in lower case; Korean has no such case.
  const hazardLabel =
    locale === "en" ? selectedLabel.toLowerCase() : selectedLabel;

  return (
    <div className="event-controls">
      <div className="event-control-heading">
        <p className="rail-section-label">{t("event.declare")}</p>
      </div>
      {/* The mode is chosen before the hazard, and it stays visible while the
          hazard is picked. Rehearsing a scenario and telling the county a fire
          is burning are different acts, and which one is armed must be legible
          at the moment of the click, not inferable from a button colour. */}
      <fieldset className="compact-controls">
        <legend className="sr-only">{t("event.declare")}</legend>
        <motion.div className="segmented-track segmented-track-two" layoutRoot>
          {(["simulate", "declare"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => onModeChange(option)}
            >
              {mode === option ? (
                <SegmentIndicator layoutId="event-mode-segment" />
              ) : null}
              <span className="segmented-label">
                {t(`event.mode.${option}`)}
              </span>
            </button>
          ))}
        </motion.div>
      </fieldset>
      <p className="event-mode-hint">{t(`event.modeHint.${mode}`)}</p>
      <fieldset className="event-grid" disabled={publishing}>
        <legend className="sr-only">{t("event.type")}</legend>
        {eventOptions.map((option) => (
          <button
            key={option.type}
            type="button"
            aria-pressed={selectedType === option.type}
            onClick={() =>
              onSelect(selectedType === option.type ? null : option.type)
            }
          >
            <span>{t(option.labelKey)}</span>
          </button>
        ))}
      </fieldset>

      {selected ? (
        <div className="event-confirm">
          <button
            className={mode === "declare" ? "button critical" : "button"}
            type="button"
            disabled={publishing}
            onClick={() => onDeclare(selected.type, mode)}
          >
            {publishing
              ? t("event.declaring")
              : t(mode === "declare" ? "event.declareReal" : "event.simulate", {
                  hazard: hazardLabel,
                })}
          </button>
        </div>
      ) : null}

      {placementArmed ? (
        <p className="placement-prompt" role="status">
          {t("event.placeArea")}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="event-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {latestEvent ? (
        <div className="latest-platform-event" aria-live="polite">
          <strong>{latestEvent.headline}</strong>
        </div>
      ) : null}
      <button
        className="button secondary event-reset"
        type="button"
        onClick={onReset}
      >
        {t("event.reset")}
      </button>
    </div>
  );
}
