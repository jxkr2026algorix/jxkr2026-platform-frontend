import { NavLink } from "react-router";
import { type Locale, useI18n } from "../../i18n";

const localeOptions = ["ko", "en"] as const satisfies readonly Locale[];
const salgilLogoByLocale: Readonly<Record<Locale, string>> = {
  ko: "/brand/salgil-ko.svg",
  en: "/brand/salgil-en.svg",
};

export function DashboardBrandHeader() {
  const { locale, setLocale, t } = useI18n();

  return (
    <aside className="side-nav">
      <header className="dashboard-brand-header">
        <NavLink className="brand" to="/situation" aria-label={t("brand.home")}>
          <span className="brand-lockup">
            <img
              className="brand-logo brand-logo-salgil"
              src={salgilLogoByLocale[locale]}
              alt={t("brand.salgil")}
            />
            <span className="brand-collaboration-mark" aria-hidden="true">
              ×
            </span>
            <img
              className="brand-logo brand-logo-partner"
              src="/brand/gyeongbuk.svg"
              alt={t("brand.partner")}
            />
          </span>
        </NavLink>
        <fieldset className="locale-switch">
          <legend className="sr-only">{t("locale.label")}</legend>
          {localeOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={locale === option}
              onClick={() => setLocale(option)}
            >
              {t(`locale.${option}`)}
            </button>
          ))}
        </fieldset>
      </header>
    </aside>
  );
}
