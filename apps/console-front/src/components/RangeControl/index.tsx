interface RangeControlProps {
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly unit: string;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
}

export function RangeControl({
  label,
  max,
  min,
  unit,
  value,
  onValueChange,
}: RangeControlProps) {
  const progress = (value - min) / (max - min);

  return (
    <label className="range-field">
      <span>
        <b>{label}</b>
        <strong>
          {Math.round(value)} {unit}
        </strong>
      </span>
      <span className="range-control">
        <span aria-hidden="true" className="range-control-track">
          <span
            className="range-control-fill"
            style={{ transform: `scaleX(${progress})` }}
          />
        </span>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          aria-valuetext={`${Math.round(value)} ${unit}`}
          onChange={(event) => onValueChange(Number(event.target.value))}
        />
      </span>
    </label>
  );
}
