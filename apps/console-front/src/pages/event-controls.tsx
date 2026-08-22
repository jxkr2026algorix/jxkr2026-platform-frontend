import type { DisasterType, PlatformEvent } from "@salgil/platform-client";

const eventOptions: readonly {
  readonly type: DisasterType;
  readonly label: string;
  readonly needsLocation: boolean;
}[] = [
  { type: "rain", label: "Heavy rain", needsLocation: false },
  { type: "heatwave", label: "Heatwave", needsLocation: false },
  { type: "wildfire", label: "Wildfire", needsLocation: true },
  { type: "flood", label: "Flood", needsLocation: true },
  { type: "landslide", label: "Landslide", needsLocation: true },
  { type: "earthquake", label: "Earthquake", needsLocation: true },
];

type EventControlsProps = {
  /** Null until the operator picks one; nothing is chosen on load. */
  readonly selectedType: DisasterType | null;
  readonly placementArmed: boolean;
  readonly publishing: boolean;
  readonly errorMessage: string;
  readonly latestEvent: PlatformEvent | null;
  readonly onSelect: (type: DisasterType | null) => void;
  readonly onDeclare: (type: DisasterType, needsLocation: boolean) => void;
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
  onSelect,
  onDeclare,
  onReset,
}: EventControlsProps) {
  const selected = eventOptions.find((o) => o.type === selectedType);

  return (
    <div className="event-controls">
      <div className="event-control-heading">
        <p className="rail-section-label">Declare an incident</p>
      </div>
      <fieldset className="event-grid" disabled={publishing}>
        <legend className="sr-only">Hazard type</legend>
        {eventOptions.map((option) => (
          <button
            key={option.type}
            type="button"
            aria-pressed={selectedType === option.type}
            onClick={() =>
              onSelect(selectedType === option.type ? null : option.type)
            }
          >
            <span>{option.label}</span>
            <small>{option.needsLocation ? "Pick on map" : "Area-wide"}</small>
          </button>
        ))}
      </fieldset>

      {selected ? (
        <div className="event-confirm">
          <button
            className="button"
            type="button"
            disabled={publishing}
            onClick={() => onDeclare(selected.type, selected.needsLocation)}
          >
            {publishing
              ? "Declaring…"
              : selected.needsLocation
                ? `Declare ${selected.label.toLowerCase()} — pick the origin`
                : `Declare ${selected.label.toLowerCase()}`}
          </button>
          <button
            className="link-button"
            type="button"
            onClick={() => onSelect(null)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <p className="placement-prompt">
          Pick a hazard to declare one, or use Sample data to check the display.
        </p>
      )}

      {placementArmed ? (
        <p className="placement-prompt" role="status">
          Select the origin on the map.
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
        Reset board
      </button>
    </div>
  );
}
