export type Language = "ru" | "en";

export function pluralWord(
  language: Language,
  count: number,
  forms: { one: string; few: string; many: string },
) {
  if (language === "en") return count === 1 ? forms.one : forms.many;
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms.one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms.few;
  return forms.many;
}

export const LANGUAGE_KEY = "ealzy.language";
export const TZ_BOOTSTRAP_KEY = "ealzy.tz.bootstrapped";

export const COMMON_TIMEZONES = [
  "Europe/Moscow",
  "Europe/Kaliningrad",
  "Europe/Samara",
  "Europe/Kirov",
  "Asia/Yekaterinburg",
  "Asia/Novosibirsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Vladivostok",
  "Europe/Kyiv",
  "Europe/Minsk",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
] as const;

export function languageOf(locale: string | null | undefined): Language {
  return (locale ?? "").toLowerCase().startsWith("en") ? "en" : "ru";
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function detectTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

export function bcp47(locale: string | null | undefined, timeZone = "UTC") {
  const language = languageOf(locale);
  if (locale && /[a-z]{2,3}-[A-Za-z0-9]+/.test(locale)) return locale;
  if (language === "ru") return "ru-RU";
  if (timeZone === "Europe/London" || timeZone === "Europe/Dublin") return "en-GB";
  if (timeZone.startsWith("Europe/") || timeZone.startsWith("Africa/")) return "en-GB";
  return "en-US";
}

export function localeTag(language: Language, timeZone: string) {
  return bcp47(language, timeZone);
}

export function readStoredLanguage(): Language | null {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY);
    return value === "en" || value === "ru" ? value : null;
  } catch {
    return null;
  }
}

export function persistLanguage(language: Language) {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function applyDocumentLocale(language: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}

export function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function formatDateTime(
  value: string | Date,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: isValidTimeZone(timeZone) ? timeZone : undefined,
    ...options,
  }).format(date);
}

export function formatDate(value: string | Date | null | undefined, locale: string, timeZone: string) {
  if (!value) return "";
  return formatDateTime(value, locale, timeZone, { dateStyle: "medium" });
}

export function formatTime(value: string | Date, locale: string, timeZone: string) {
  return formatDateTime(value, locale, timeZone, { timeStyle: "short" });
}

export function formatDateShort(value: string | Date, locale: string, timeZone: string) {
  return formatDateTime(value, locale, timeZone, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatInteger(value: number, locale: string) {
  return formatNumber(value, locale, { maximumFractionDigits: 0 });
}

export function formatTemperature(value: number, locale: string) {
  return `${formatInteger(Math.round(value), locale)}°`;
}

export function formatMoney(amount: number, locale: string, currency = "RUB") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
