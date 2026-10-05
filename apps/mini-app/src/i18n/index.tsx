import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth";
import type { SelfProfile } from "../types";
import {
  applyDocumentLocale,
  bcp47,
  detectTimeZone,
  formatDate as formatDateValue,
  formatDateShort,
  formatInteger,
  formatMoney,
  formatNumber,
  formatTemperature,
  formatTime,
  interpolate,
  isValidTimeZone,
  languageOf,
  localeTag,
  persistLanguage,
  readStoredLanguage,
  TZ_BOOTSTRAP_KEY,
  type Language,
  pluralWord,
} from "./locale";
import { messages } from "./messages";

type Vars = Record<string, string | number>;

function lookup(language: Language, path: string): string {
  const parts = path.split(".");
  let current: unknown = messages[language];
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      current = messages.ru;
      for (const fallback of parts) {
        if (!current || typeof current !== "object" || !(fallback in current)) return path;
        current = (current as Record<string, unknown>)[fallback];
      }
      break;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : path;
}

interface LocaleContextValue {
  language: Language;
  locale: string;
  timezone: string;
  t: (key: string, vars?: Vars) => string;
  setLanguage: (language: Language) => Promise<void>;
  setTimezone: (timezone: string) => Promise<void>;
  applyProfile: (profile: Pick<SelfProfile, "locale" | "timezone">) => void;
  formatDate: (value?: string | Date | null) => string;
  formatTime: (value: string | Date) => string;
  formatDayLabel: (value?: Date) => string;
  formatClock: (value?: Date) => string;
  formatInteger: (value: number) => string;
  formatTemperature: (value: number) => string;
  formatMoney: (value: number) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { api, status } = useAuth();
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage() ?? "ru");
  const [timezone, setTimezoneState] = useState(() => detectTimeZone());
  const [locale, setLocale] = useState(() => localeTag(readStoredLanguage() ?? "ru", detectTimeZone()));

  const applyProfile = useCallback((profile: Pick<SelfProfile, "locale" | "timezone">) => {
    const nextLanguage = languageOf(profile.locale);
    const nextZone = isValidTimeZone(profile.timezone) ? profile.timezone : detectTimeZone();
    setLanguageState(nextLanguage);
    setTimezoneState(nextZone);
    setLocale(bcp47(profile.locale, nextZone));
    persistLanguage(nextLanguage);
    applyDocumentLocale(nextLanguage);
  }, []);

  useEffect(() => {
    applyDocumentLocale(language);
  }, [language]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    void api
      .me()
      .then(async (profile) => {
        if (!active) return;
        applyProfile(profile);
        const detected = detectTimeZone();
        let bootstrapped = false;
        try {
          bootstrapped = localStorage.getItem(TZ_BOOTSTRAP_KEY) === "1";
        } catch {
          bootstrapped = true;
        }
        const isDefaultTimezone = !profile.timezone || profile.timezone === "UTC" || profile.timezone === "Europe/Moscow";
        if (!bootstrapped && isDefaultTimezone && detected !== profile.timezone && detected !== "UTC") {
          const saved = await api.updateMe({
            timezone: detected,
            locale: localeTag(languageOf(profile.locale), detected),
          });
          if (!active) return;
          try {
            localStorage.setItem(TZ_BOOTSTRAP_KEY, "1");
          } catch {
            // Ignore quota / private-mode failures.
          }
          applyProfile(saved);
        } else if (!bootstrapped) {
          try {
            localStorage.setItem(TZ_BOOTSTRAP_KEY, "1");
          } catch {
            // Ignore quota / private-mode failures.
          }
        }
      })
      .catch(() => {
        // Keep the last known locale if the profile request fails.
      });
    return () => {
      active = false;
    };
  }, [api, applyProfile, status]);

  const t = useCallback(
    (key: string, vars?: Vars) => interpolate(lookup(language, key), vars),
    [language],
  );

  const persist = useCallback(
    async (patch: { locale?: string; timezone?: string }) => {
      if (status !== "authenticated") return;
      try {
        const saved = await api.updateMe(patch);
        applyProfile(saved);
      } catch {
        // Keep the optimistic UI if saving fails; the form can surface errors.
      }
    },
    [api, applyProfile, status],
  );

  const setLanguage = useCallback(
    async (next: Language) => {
      const nextLocale = localeTag(next, timezone);
      setLanguageState(next);
      setLocale(nextLocale);
      persistLanguage(next);
      applyDocumentLocale(next);
      await persist({ locale: nextLocale });
    },
    [persist, timezone],
  );

  const setTimezone = useCallback(
    async (next: string) => {
      const zone = isValidTimeZone(next) ? next : detectTimeZone();
      const nextLocale = localeTag(language, zone);
      setTimezoneState(zone);
      setLocale(nextLocale);
      await persist({ timezone: zone, locale: nextLocale });
    },
    [language, persist],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      locale,
      timezone,
      t,
      setLanguage,
      setTimezone,
      applyProfile,
      formatDate: (value) => formatDateValue(value, locale, timezone),
      formatTime: (value) => formatTime(value, locale, timezone),
      formatDayLabel: (value = new Date()) => formatDateShort(value, locale, timezone),
      formatClock: (value = new Date()) => formatTime(value, locale, timezone),
      formatInteger: (value) => formatInteger(value, locale),
      formatTemperature: (value) => formatTemperature(value, locale),
      formatMoney: (value) => formatMoney(value, locale),
      formatNumber: (value, options) => formatNumber(value, locale, options),
    }),
    [applyProfile, language, locale, setLanguage, setTimezone, t, timezone],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useI18n must be used within LocaleProvider");
  return value;
}

export function useI18nOptional() {
  return useContext(LocaleContext);
}

export { pluralWord };

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className={`flex items-center gap-2 text-sm ${className}`}>
      <span className="text-muted">{t("auth.language")}</span>
      <select
        className="input w-auto min-h-10 py-1"
        value={language}
        aria-label={t("auth.language")}
        onChange={(event) => void setLanguage(event.target.value as Language)}
      >
        <option value="ru">{t("profile.russian")}</option>
        <option value="en">{t("profile.english")}</option>
      </select>
    </label>
  );
}
