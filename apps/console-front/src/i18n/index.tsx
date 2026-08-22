import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { z } from "zod";
import { messages, type TranslationKey } from "./messages";

const localeSchema = z.enum(["ko", "en"]);
const localeStorageKey = "salgil-console-locale";

export type Locale = z.infer<typeof localeSchema>;
type TranslationValues = Readonly<Record<string, string | number>>;

type I18nContextValue = {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: (key: TranslationKey, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

class MissingI18nProviderError extends Error {
  constructor() {
    super("useI18n must be used inside I18nProvider");
    this.name = "MissingI18nProviderError";
  }
}

function getInitialLocale(): Locale {
  const storedLocale = localeSchema.safeParse(
    window.localStorage.getItem(localeStorageKey),
  );
  if (storedLocale.success) return storedLocale.data;
  return navigator.languages.some((language) => language.startsWith("ko"))
    ? "ko"
    : "en";
}

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((nextLocale: Locale) => {
    window.localStorage.setItem(localeStorageKey, nextLocale);
    updateLocale(nextLocale);
  }, []);

  const t = useCallback(
    (key: TranslationKey, values: TranslationValues = {}) => {
      let translated = messages[locale][key];
      for (const [name, value] of Object.entries(values)) {
        translated = translated.replaceAll(`{${name}}`, String(value));
      }
      return translated;
    },
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.title");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t("app.description"));
  }, [locale, t]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new MissingI18nProviderError();
  return context;
}
