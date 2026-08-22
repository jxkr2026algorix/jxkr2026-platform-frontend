import { DISTRICTS, PROVINCE_CODE } from "@salgil/map-webgpu-canvas/districts";
import { FloatingSelect } from "../components/FloatingSelect";
import { useI18n } from "../i18n";

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
  const { locale, t } = useI18n();
  const options = [
    { value: PROVINCE_CODE, label: t("district.province") },
    ...DISTRICTS.map((district) => ({
      value: district.code,
      label: locale === "ko" ? district.name : district.nameEn,
    })),
  ];

  return (
    <div className="district-selector">
      <FloatingSelect
        label={t("district.label")}
        value={selected ?? PROVINCE_CODE}
        options={options}
        disabled={loading}
        onValueChange={onSelect}
      />
      <p role="status">
        {loading ? t("district.loading") : t("district.help")}
      </p>
    </div>
  );
}
