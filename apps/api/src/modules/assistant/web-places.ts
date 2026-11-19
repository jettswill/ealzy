import type { PlaceCandidate } from "../../types.js";

// Третий слой поиска мест: когда в каталоге карт (2ГИС / OpenStreetMap) под
// редкий тип ничего нет — «искусственная волна», «верёвочный парк», «кёрлинг»,
// — Илзи ищет в интернете (статьи, подборки, сайты заведений), а координаты
// для расстояния берём у OpenStreetMap по адресу. Рейтингов здесь нет, поэтому
// такие места помечены «из интернета», а в базу они попадают, как и прочие,
// только когда человек сказал «хочу» или «был».

export interface WebPlaceQuery {
  type_name: string;
  search_query: string | null;
  city: string;
  /** Район, метро или адрес, рядом с которым ищем; null — по всему городу. */
  near?: string | null;
  locale?: string | null;
}
export interface WebPlaceHit {
  name: string;
  address: string | null;
  website: string | null;
  note: string | null;
}
export type WebPlaceFinder = (query: WebPlaceQuery) => Promise<WebPlaceHit[]>;
type Fetch = typeof fetch;

const USER_AGENT = "Ealzy/1.0 (+https://ealzy.ru)";
const MAX_HITS = 6;

const clean = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/**
 * Ответ модели — JSON-массив, но веб-модели любят обернуть его в ```json,
 * добавить фразу до или после и вставить сноски «[1]». Достаём массив терпимо.
 */
export function parseWebPlaces(text: string): WebPlaceHit[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    try {
      raw = JSON.parse(text.slice(start, end + 1).replace(/\[\d{1,2}\]/g, ""));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WebPlaceHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = clean(row.name, 200)?.replace(/\s*\[\d{1,2}\]/g, "");
    if (!name) continue;
    const key = name.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    const website = clean(row.website ?? row.url, 300);
    out.push({
      name,
      address: clean(row.address, 300)?.replace(/\s*\[\d{1,2}\]/g, "") ?? null,
      website: website && /^https?:\/\//i.test(website) ? website : null,
      note: clean(row.note ?? row.description, 200)?.replace(/\s*\[\d{1,2}\]/g, "") ?? null,
    });
    if (out.length >= MAX_HITS) break;
  }
  return out;
}

/** Устойчивый id для места из интернета: одно и то же место — одна строка в базе. */
export function webSourceId(hit: Pick<WebPlaceHit, "name" | "address">, city: string) {
  const norm = (value: string | null) =>
    (value ?? "")
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  return `${norm(city)}|${norm(hit.name)}|${norm(hit.address)}`.slice(0, 120);
}

export interface GeoArea {
  lat: number;
  lon: number;
  /** Короткое название найденного: «Петроградский район», «Чкаловская». */
  label: string;
}

/**
 * Район, метро, улица или адрес словами → точка внутри города. Метро ищем и
 * как станцию: «м. Чкаловская» → «станция метро Чкаловская».
 */
export async function geocodeArea(
  text: string,
  city: string | null,
  fetchImpl: Fetch = fetch,
): Promise<GeoArea | null> {
  const raw = text.trim();
  if (!raw) return null;
  const metro = raw.match(/^(?:м\.?|метро)\s+(.+)$/iu);
  const variants = metro ? [`станция метро ${metro[1]}`, metro[1]!] : [raw];
  for (const variant of variants) {
    const q =
      city && !variant.toLocaleLowerCase("ru").includes(city.toLocaleLowerCase("ru"))
        ? `${variant}, ${city}`
        : variant;
    const params = new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      q,
      "accept-language": "ru",
    });
    try {
      const response = await fetchImpl(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const rows = (await response.json()) as {
        lat?: string;
        lon?: string;
        name?: string;
        display_name?: string;
      }[];
      const row = rows[0];
      const lat = Number(row?.lat);
      const lon = Number(row?.lon);
      if (!row?.lat || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const label = (row.name || row.display_name?.split(",")[0] || raw).trim().slice(0, 80);
      return { lat, lon, label };
    } catch {
      // Геокодер не ответил — пробуем следующий вариант.
    }
  }
  return null;
}

/**
 * geocodeArea с памятью на сутки: районы и метро не переезжают, а Nominatim
 * просит не дёргать его чаще раза в секунду. Промахи не запоминаем.
 */
export function cachedAreaGeocoder(fetchImpl: Fetch = fetch, ttlMs = 24 * 60 * 60 * 1000) {
  const cache = new Map<string, { at: number; area: GeoArea }>();
  return async (text: string, city: string | null) => {
    const norm = (value: string | null) =>
      (value ?? "").toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
    const key = `${norm(text)}|${norm(city)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.area;
    const area = await geocodeArea(text, city, fetchImpl);
    if (area) {
      if (cache.size >= 1_000) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), area });
    }
    return area;
  };
}

/** Адрес → точка через Nominatim. Не нашли — место остаётся, но без расстояния. */
export async function geocode(
  address: string,
  city: string,
  fetchImpl: Fetch = fetch,
): Promise<{ lat: number; lon: number } | null> {
  const q = address.toLocaleLowerCase("ru").includes(city.toLocaleLowerCase("ru"))
    ? address
    : `${city}, ${address}`;
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", q, "accept-language": "ru" });
  try {
    const response = await fetchImpl(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as { lat?: string; lon?: string }[];
    const lat = Number(rows[0]?.lat);
    const lon = Number(rows[0]?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && rows[0]?.lat ? { lat, lon } : null;
  } catch {
    return null;
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Находки из интернета → кандидаты с точкой. Nominatim просит не чаще запроса
 * в секунду, поэтому геокодим по очереди; `gapMs` в тестах — 0.
 */
export async function webCandidates(
  hits: WebPlaceHit[],
  city: string,
  options: { fetch?: Fetch; gapMs?: number } = {},
): Promise<Omit<PlaceCandidate, "distance_m" | "maps_url">[]> {
  const gap = options.gapMs ?? 1_100;
  const out: Omit<PlaceCandidate, "distance_m" | "maps_url">[] = [];
  for (const [index, hit] of hits.entries()) {
    if (index > 0 && hit.address && gap) await pause(gap);
    const point = hit.address ? await geocode(hit.address, city, options.fetch) : null;
    out.push({
      source: "web",
      source_id: webSourceId(hit, city),
      name: hit.name,
      address: hit.address,
      city,
      lat: point?.lat ?? null,
      lon: point?.lon ?? null,
      rating: null,
      rating_count: null,
      image_url: null,
      photos: [],
      phone: null,
      website: hit.website,
      hours: null,
      twogis_url: null,
      note: hit.note,
    });
  }
  return out;
}
