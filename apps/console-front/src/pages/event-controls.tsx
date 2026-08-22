import type {
  DisasterType,
  IncidentMode,
  PlatformEvent,
} from "@salgil/platform-client";

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
  readonly mode: IncidentMode;
  readonly selectedType: DisasterType;
  readonly placementArmed: boolean;
  readonly publishing: boolean;
  readonly errorMessage: string;
  readonly latestEvent: PlatformEvent | null;
  readonly onModeChange: (mode: IncidentMode) => void;
  readonly onSelect: (type: DisasterType, needsLocation: boolean) => void;
};

export function EventControls({
  mode,
  selectedType,
  placementArmed,
  publishing,
  errorMessage,
  latestEvent,
  onModeChange,
  onSelect,
}: EventControlsProps) {
  return (
    <div className="event-controls">
      <div className="event-control-heading">
        <p className="rail-section-label">Event control</p>
      </div>
      <fieldset className="incident-mode">
        <legend className="sr-only">Incident mode</legend>
        {(["training", "live"] as const).map((nextMode) => (
          <button
            key={nextMode}
            type="button"
            disabled={publishing}
            aria-pressed={mode === nextMode}
            onClick={() => onModeChange(nextMode)}
          >
            {nextMode === "training" ? "Training" : "Live"}
          </button>
        ))}
      </fieldset>
      <fieldset className="event-grid">
        <legend className="sr-only">Create disaster event</legend>
        {eventOptions.map((option) => (
          <button
            key={option.type}
            type="button"
            disabled={publishing}
            aria-pressed={selectedType === option.type}
            onClick={() => onSelect(option.type, option.needsLocation)}
          >
            <span>{option.label}</span>
            <small>{option.needsLocation ? "Pick on map" : "Start now"}</small>
          </button>
        ))}
      </fieldset>
      {placementArmed ? (
        <p className="placement-prompt" role="status">
          Select one point on the map. Only the origin is rendered locally.
        </p>
      ) : null}
      {publishing ? (
        <p className="placement-prompt" role="status">
          Recording incident on the platform…
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
    </div>
  );
}
