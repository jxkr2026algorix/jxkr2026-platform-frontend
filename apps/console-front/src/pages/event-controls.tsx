import type { DisasterType, PlatformEvent } from "@salgil/platform-client";

/**
 * Every hazard happens in a place. There is no area-wide disaster to declare:
 * the operator always marks where it is before it can be simulated.
 */
const eventOptions: readonly {
  readonly type: DisasterType;
  readonly label: string;
}[] = [
  { type: "rain", label: "Heavy rain" },
  { type: "flood", label: "Flood" },
  { type: "landslide", label: "Landslide" },
  { type: "wildfire", label: "Wildfire" },
  { type: "earthquake", label: "Earthquake" },
  { type: "heatwave", label: "Heatwave" },
];

type EventControlsProps = {
  /** Null until the operator picks one; nothing is chosen on load. */
  readonly selectedType: DisasterType | null;
  readonly placementArmed: boolean;
  readonly publishing: boolean;
  readonly errorMessage: string;
  readonly latestEvent: PlatformEvent | null;
  readonly onSelect: (type: DisasterType | null) => void;
  readonly onDeclare: (type: DisasterType) => void;
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
            <small>Mark the area</small>
          </button>
        ))}
      </fieldset>

      {selected ? (
        <div className="event-confirm">
          <button
            className="button"
            type="button"
            disabled={publishing}
            onClick={() => onDeclare(selected.type)}
          >
            {publishing
              ? "Declaring…"
              : `Mark ${selected.label.toLowerCase()} area on the map`}
          </button>
        </div>
      ) : (
        <p className="placement-prompt">
          Pick a hazard, then mark its area on the map.
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
