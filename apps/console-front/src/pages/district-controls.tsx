import { DISTRICTS, PROVINCE_CODE } from "@salgil/map-webgpu-canvas/districts";

interface DistrictControlsProps {
  /** Focused 행정표준코드, or null for the province-wide (비례대표) view. */
  readonly selected: string | null;
  readonly loading: boolean;
  readonly overlayEnabled: boolean;
  readonly onSelect: (code: string | null) => void;
  readonly onOverlayChange: (enabled: boolean) => void;
}

const formatCoordinate = (lat: number, lon: number): string =>
  `${lat.toFixed(3)}°N ${lon.toFixed(3)}°E`;

/**
 * The province's 22 시/군 constituencies plus 비례대표. Selecting a row flies
 * the map to that district's real surveyed centroid; 비례대표 has no
 * constituency, so it frames the whole province instead.
 */
export function DistrictControls({
  selected,
  loading,
  overlayEnabled,
  onSelect,
  onOverlayChange,
}: DistrictControlsProps) {
  return (
    <div className="rail-section district-section">
      <div className="rail-title">
        <p className="rail-section-label">Gyeongbuk districts</p>
        <span>{DISTRICTS.length} districts</span>
      </div>
      <label className="check-row">
        <input
          className="check-input"
          type="checkbox"
          checked={overlayEnabled}
          onChange={(event) => onOverlayChange(event.target.checked)}
        />
        <span className="check-box" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <title>Selected</title>
            <path d="m3.5 8.2 2.8 2.8 6.2-6.2" />
          </svg>
        </span>
        <span className="check-label">Boundary overlay</span>
        <b>SGIS</b>
      </label>
      <div
        className="community-list district-list"
        role="listbox"
        aria-label="Gyeongbuk electoral districts"
        aria-busy={loading}
      >
        <button
          className="community-row district-row"
          type="button"
          role="option"
          aria-selected={selected === null}
          onClick={() => onSelect(PROVINCE_CODE)}
        >
          <span aria-hidden="true">—</span>
          <span>
            <strong>Province-wide</strong>
            <small>Proportional · whole province</small>
          </span>
        </button>
        {DISTRICTS.map((district, index) => (
          <button
            className="community-row district-row"
            key={district.code}
            type="button"
            role="option"
            aria-selected={selected === district.code}
            onClick={() => onSelect(district.code)}
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span>
              <strong>{district.nameEn}</strong>
              <small>
                {district.kind === "si" ? "City" : "County"} ·{" "}
                {formatCoordinate(district.center[1], district.center[0])}
              </small>
            </span>
          </button>
        ))}
      </div>
      {loading ? (
        <p className="district-loading" role="status">
          Loading measured terrain for the selected district…
        </p>
      ) : null}
    </div>
  );
}
