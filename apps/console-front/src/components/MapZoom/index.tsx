import type { DashboardCommand } from "@salgil/map-webgpu-canvas/protocol";

interface MapZoomProps {
  readonly onMapCommand: (command: DashboardCommand) => void;
}

/** One step is about 28%: noticeable without being disorienting. */
const STEP = 1.28;

/**
 * Zoom controls for the map. The steps are relative, so a button press does
 * not depend on the dashboard's copy of the camera distance, which lags by up
 * to half a second. Panning stays on the canvas; the renderer clamps both so
 * the view can never leave the loaded terrain.
 */
export function MapZoom({ onMapCommand }: MapZoomProps) {
  const zoom = (factor: number) =>
    onMapCommand({ type: "map:zoom", payload: { factor } });

  return (
    <fieldset className="map-zoom">
      <legend className="sr-only">Map zoom</legend>
      <button type="button" onClick={() => zoom(1 / STEP)} aria-label="Zoom in">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
      <button type="button" onClick={() => zoom(STEP)} aria-label="Zoom out">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8h9" />
        </svg>
      </button>
    </fieldset>
  );
}
