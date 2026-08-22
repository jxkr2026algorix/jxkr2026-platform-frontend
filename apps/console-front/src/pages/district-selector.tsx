import { DISTRICTS, PROVINCE_CODE } from "@salgil/map-webgpu-canvas/districts";
import { FloatingSelect } from "../components/FloatingSelect";

interface DistrictSelectorProps {
  readonly selected: string | null;
  readonly loading: boolean;
  readonly onSelect: (code: string) => void;
}

export function DistrictSelector({
  selected,
  loading,
  onSelect,
}: DistrictSelectorProps) {
  const options = [
    { value: PROVINCE_CODE, label: "Gyeongsangbuk-do" },
    ...DISTRICTS.map((district) => ({
      value: district.code,
      label: district.nameEn,
    })),
  ];

  return (
    <div className="district-selector">
      <FloatingSelect
        label="District"
        value={selected ?? PROVINCE_CODE}
        options={options}
        disabled={loading}
        onValueChange={onSelect}
      />
      <p role="status">
        {loading
          ? "Loading terrain for the selected district."
          : "Choose a district to move the map camera."}
      </p>
    </div>
  );
}
