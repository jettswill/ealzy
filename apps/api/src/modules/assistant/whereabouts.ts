import type { Whereabouts } from "../../types.js";

// Где человек сейчас. Город определяет сам iPhone (по геолокации, на устройстве),
// погоду — бесплатный Open-Meteo; сервер получает только город, страну, точку,
// округлённую до ~10 км, и погоду. Илзи берёт это как контекст: советы по месту,
// поездка (город не совпадает с домашним), погода для планов на улице.

/** Отметка свежая — значит, человек скорее всего ещё там. */
export const WHEREABOUTS_FRESH_MS = 72 * 3600_000;
/** Погода старше этого — уже не «сейчас». */
const WEATHER_FRESH_MS = 6 * 3600_000;

export function isFreshWhereabouts(place: Whereabouts | null | undefined, now = Date.now()) {
  return !!place && now - Date.parse(place.last_seen_at) <= WHEREABOUTS_FRESH_MS;
}

/** Коды погоды WMO (Open-Meteo) по-русски. */
export function weatherText(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  if (code === 0) return "ясно";
  if (code === 1) return "малооблачно";
  if (code === 2) return "переменная облачность";
  if (code === 3) return "пасмурно";
  if (code === 45 || code === 48) return "туман";
  if (code >= 51 && code <= 57) return "морось";
  if (code === 65 || code === 82) return "ливень";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 81)) return "дождь";
  if (code === 75 || code === 86) return "сильный снег";
  if ((code >= 71 && code <= 77) || code === 85) return "снег";
  if (code >= 95) return "гроза";
  return null;
}

/** Местная дата YYYY-MM-DD в поясе человека. */
function localDate(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function roundCoordinate(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value * 10) / 10;
}

/** Для workspace.now: где человек, с какого дня и какая там была погода. */
export function compactWhereabouts(place: Whereabouts, timezone: string, now = Date.now()) {
  const weatherFresh =
    place.weather_temp !== null &&
    place.weather_at !== null &&
    now - Date.parse(place.weather_at) <= WEATHER_FRESH_MS;
  const temp = weatherFresh ? Math.round(place.weather_temp!) : null;
  return {
    city: place.city,
    ...(place.country ? { country: place.country } : {}),
    since: localDate(place.arrived_at, place.timezone || timezone),
    ...(weatherFresh
      ? {
          weather: [temp! > 0 ? `+${temp}°` : `${temp}°`, weatherText(place.weather_code)]
            .filter(Boolean)
            .join(", "),
        }
      : {}),
  };
}
