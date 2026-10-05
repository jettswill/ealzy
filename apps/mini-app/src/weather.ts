const GEO_KEY = "ealzy.geo";
const CACHE_MS = 30 * 60 * 1000;

export type GeoPlace = { lat: number; lon: number; label: string; saved_at?: number };
export type WeatherSnapshot = {
  temperature: number;
  weatherCode: number;
  label: string;
};

export const TIMEZONE_PLACES: Record<string, GeoPlace> = {
  "Europe/Moscow": { lat: 55.7558, lon: 37.6173, label: "Москва" },
  "Europe/Kaliningrad": { lat: 54.7104, lon: 20.4522, label: "Калининград" },
  "Europe/Samara": { lat: 53.1959, lon: 50.1002, label: "Самара" },
  "Asia/Yekaterinburg": { lat: 56.8389, lon: 60.6057, label: "Екатеринбург" },
  "Asia/Novosibirsk": { lat: 55.0084, lon: 82.9357, label: "Новосибирск" },
  "Asia/Krasnoyarsk": { lat: 56.0153, lon: 92.8932, label: "Красноярск" },
  "Asia/Irkutsk": { lat: 52.2864, lon: 104.305, label: "Иркутск" },
  "Asia/Vladivostok": { lat: 43.1155, lon: 131.8855, label: "Владивосток" },
  "Europe/Kiev": { lat: 50.4501, lon: 30.5234, label: "Киев" },
  "Europe/Kyiv": { lat: 50.4501, lon: 30.5234, label: "Киев" },
  "Europe/Minsk": { lat: 53.9006, lon: 27.559, label: "Минск" },
  "Europe/Berlin": { lat: 52.52, lon: 13.405, label: "Берлин" },
  "Europe/London": { lat: 51.5074, lon: -0.1278, label: "Лондон" },
  "Europe/Paris": { lat: 48.8566, lon: 2.3522, label: "Париж" },
  "America/New_York": { lat: 40.7128, lon: -74.006, label: "Нью-Йорк" },
  UTC: { lat: 51.5074, lon: -0.1278, label: "UTC" },
};

export const TIMEZONE_PLACES_EN: Record<string, string> = {
  "Europe/Moscow": "Moscow",
  "Europe/Kaliningrad": "Kaliningrad",
  "Europe/Samara": "Samara",
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
  UTC: "UTC",
};

export function placeForTimezone(timezone: string, language = "ru"): GeoPlace {
  const place = TIMEZONE_PLACES[timezone] ?? TIMEZONE_PLACES["Europe/Moscow"]!;
  if (language === "en") {
    return { ...place, label: TIMEZONE_PLACES_EN[timezone] ?? TIMEZONE_PLACES_EN["Europe/Moscow"]! };
  }
  return place;
}

export function weatherEmoji(code: number) {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "🌨️";
  return "⛈️";
}

export function formatClock(now: Date, timezone: string, locale = "ru-RU") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    timeStyle: "short",
  }).format(now);
}

export function formatDayLabel(now: Date, timezone: string, locale = "ru-RU") {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(now);
}

function readCachedPlace(): GeoPlace | null {
  try {
    const raw = localStorage.getItem(GEO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeoPlace;
    if (
      typeof parsed.lat !== "number" ||
      typeof parsed.lon !== "number" ||
      typeof parsed.label !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePlace(place: GeoPlace) {
  try {
    localStorage.setItem(GEO_KEY, JSON.stringify({ ...place, saved_at: Date.now() }));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: CACHE_MS,
    });
  });
}

export async function fetchWeather(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("weather unavailable");
  const body = (await response.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
  };
  const temperature = body.current?.temperature_2m;
  const weatherCode = body.current?.weather_code;
  if (typeof temperature !== "number" || typeof weatherCode !== "number") {
    throw new Error("weather unavailable");
  }
  return { temperature, weatherCode };
}

export async function reverseGeocode(lat: number, lon: number, language = "ru") {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${language}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
  };
  return body.city || body.locality || body.principalSubdivision || null;
}

export async function resolveWeather(timezone: string, language = "ru"): Promise<WeatherSnapshot> {
  const fallback = placeForTimezone(timezone, language);
  const cached = readCachedPlace();
  const fresh = Boolean(cached?.saved_at && Date.now() - cached.saved_at < CACHE_MS);
  let place = (fresh ? cached : null) ?? cached ?? fallback;
  if (!fresh) {
    try {
      const position = await currentPosition();
      place = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        label: cached?.label ?? fallback.label,
      };
      const named = await reverseGeocode(place.lat, place.lon, language).catch(() => null);
      if (named) place.label = named;
      savePlace(place);
    } catch {
      if (!cached) savePlace(fallback);
      place = cached ?? fallback;
    }
  }
  const weather = await fetchWeather(place.lat, place.lon);
  return { ...weather, label: place.label };
}
