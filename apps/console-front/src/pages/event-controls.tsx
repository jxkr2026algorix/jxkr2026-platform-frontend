import type { DisasterType, PlatformEvent } from "@salgil/platform-client";
import { useState } from "react";

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
  readonly selectedType: DisasterType;
  readonly onReset: () => void;
  readonly placementArmed: boolean;
  readonly publishing: boolean;
  readonly errorMessage: string;
  readonly latestEvent: PlatformEvent | null;
  readonly onSelect: (type: DisasterType, needsLocation: boolean) => void;
};

export function EventControls({
  selectedType,
  onReset,
  placementArmed,
  publishing,
  errorMessage,
  latestEvent,
  onSelect,
}: EventControlsProps) {
  // These buttons record a real incident on the platform, so they start
  // locked. Unlocking is a deliberate act, and it does not survive a reset.
  const [unlocked, setUnlocked] = useState(false);

  const reset = () => {
    setUnlocked(false);
    onReset();
  };

  return (
    <div className="event-controls">
      <div className="event-control-heading">
        <p className="rail-section-label">Event control</p>
      </div>
      <label className="check-row">
        <input
          className="check-input"
          type="checkbox"
          checked={unlocked}
          onChange={(event) => setUnlocked(event.target.checked)}
        />
        <span className="check-box" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <title>Selected</title>
            <path d="m3.5 8.2 2.8 2.8 6.2-6.2" />
          </svg>
        </span>
        <span className="check-label">Allow recording incidents</span>
      </label>
      <fieldset className="event-grid" disabled={!unlocked || publishing}>
        <legend className="sr-only">Create disaster event</legend>
        {eventOptions.map((option) => (
          <button
            key={option.type}
            type="button"
            aria-pressed={selectedType === option.type}
            onClick={() => onSelect(option.type, option.needsLocation)}
          >
            <span>{option.label}</span>
            <small>{option.needsLocation ? "Pick on map" : "Start now"}</small>
          </button>
        ))}
      </fieldset>
      {!unlocked ? (
        <p className="placement-prompt">
          Recording is off. Turn it on to declare an incident, or use Sample
          data to check the display.
        </p>
      ) : null}
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
      <button
        className="button secondary event-reset"
        type="button"
        onClick={reset}
      >
        Reset board
      </button>
    </div>
  );
}
