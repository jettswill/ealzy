export type Language = "ru" | "en";

const TIMEZONE_CITIES_RU: Record<string, string> = {
  "Europe/Moscow": "Москва",
  "Europe/Kaliningrad": "Калининград",
  "Europe/Samara": "Самара",
  "Europe/Kirov": "Киров",
  "Asia/Yekaterinburg": "Екатеринбург",
  "Asia/Novosibirsk": "Новосибирск",
  "Asia/Krasnoyarsk": "Красноярск",
  "Asia/Irkutsk": "Иркутск",
  "Asia/Vladivostok": "Владивосток",
  "Europe/Kiev": "Киев",
  "Europe/Kyiv": "Киев",
  "Europe/Minsk": "Минск",
  "Europe/Berlin": "Берлин",
  "Europe/London": "Лондон",
  "Europe/Paris": "Париж",
  "America/New_York": "Нью-Йорк",
};

const TIMEZONE_CITIES_EN: Record<string, string> = {
  "Europe/Moscow": "Moscow",
  "Europe/Kaliningrad": "Kaliningrad",
  "Europe/Samara": "Samara",
  "Europe/Kirov": "Kirov",
  "Asia/Yekaterinburg": "Yekaterinburg",
  "Asia/Novosibirsk": "Novosibirsk",
  "Asia/Krasnoyarsk": "Krasnoyarsk",
  "Asia/Irkutsk": "Irkutsk",
  "Asia/Vladivostok": "Vladivostok",
  "Europe/Kiev": "Kyiv",
  "Europe/Kyiv": "Kyiv",
  "Europe/Minsk": "Minsk",
  "Europe/Berlin": "Berlin",
  "Europe/London": "London",
  "Europe/Paris": "Paris",
  "America/New_York": "New York",
};

export function languageOf(locale: string | null | undefined): Language {
  return (locale ?? "").toLowerCase().startsWith("en") ? "en" : "ru";
}

export function localeFromLanguageCode(code: string | null | undefined) {
  if (!code) return "ru-RU";
  return languageOf(code) === "en" ? "en-US" : "ru-RU";
}

export function bcp47(locale: string | null | undefined, timeZone = "UTC") {
  const language = languageOf(locale);
  if (locale && /[a-z]{2,3}-[A-Za-z0-9]+/.test(locale)) return locale;
  if (language === "ru") return "ru-RU";
  if (timeZone === "Europe/London" || timeZone === "Europe/Dublin") return "en-GB";
  if (timeZone.startsWith("Europe/") || timeZone.startsWith("Africa/")) return "en-GB";
  return "en-US";
}

export function cityForLocale(timezone: string | null | undefined, locale?: string | null) {
  const zone = timezone || "Europe/Moscow";
  if (languageOf(locale) === "en") return TIMEZONE_CITIES_EN[zone] ?? "Moscow";
  return TIMEZONE_CITIES_RU[zone] ?? "Москва";
}

export function formatInteger(value: number, locale: string | null | undefined) {
  return new Intl.NumberFormat(bcp47(locale), { maximumFractionDigits: 0 }).format(value);
}

export function formatMoney(amount: number, locale: string | null | undefined, currency = "RUB") {
  return new Intl.NumberFormat(bcp47(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value: string | Date, locale: string | null | undefined, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(bcp47(locale, timeZone), {
    timeZone,
    dateStyle: "medium",
  }).format(date);
}
