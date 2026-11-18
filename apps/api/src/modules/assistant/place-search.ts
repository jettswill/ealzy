import type { ActivityType, PlaceCandidate } from "../../types.js";
import { type WebPlaceFinder, webCandidates } from "./web-places.js";

// Поиск мест под тип активности рядом с человеком. Сами места в базу не
// пишем: их там окажется только то, с чем человек что-то сделал («хочу»,
// «был»). Источник — 2ГИС, если задан ключ (там есть рейтинг и фото), иначе
// OpenStreetMap: бесплатно, без рейтинга, для популярных типов — по тегам
// рядом с точкой, для остальных — по названию в окрестности. Если и там
// пусто — веб-поиск Илзи (web-places.ts).

export interface NearbyQuery {
  type: Pick<ActivityType, "id" | "name" | "search_query">;
  lat: number | null;
  lon: number | null;
  city: string | null;
  limit?: number;
  /** «Сейчас» — ищем ближе. */
  radiusM?: number;
  /** Можно ли идти в веб-поиск (он облачный и платный — только при живой квоте). */
  allowWeb?: boolean;
}
export interface PlaceSearch {
  nearby(query: NearbyQuery): Promise<PlaceCandidate[]>;
}
type Fetch = typeof fetch;

const USER_AGENT = "Ealzy/1.0 (+https://ealzy.ru)";

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}

export function yandexMapsUrl(name: string, address?: string | null, city?: string | null) {
  const text = [name, address, city].filter(Boolean).join(" ");
  return `https://yandex.ru/maps/?text=${encodeURIComponent(text)}`;
}

const queryOf = (type: NearbyQuery["type"]) => type.search_query || type.name;
const hasPoint = (q: NearbyQuery) => q.lat != null && q.lon != null;

// ——— 2ГИС ———————————————————————————————————————————————————————————————

export async function search2gis(
  key: string,
  q: NearbyQuery,
  fetchImpl: Fetch = fetch,
): Promise<PlaceCandidate[]> {
  const params = new URLSearchParams({
    q: hasPoint(q) ? queryOf(q.type) : `${queryOf(q.type)} ${q.city ?? ""}`.trim(),
    page_size: String(Math.min(q.limit ?? 10, 10)),
    fields:
      "items.point,items.address,items.reviews,items.external_content,items.contact_groups,items.schedule",
    key,
  });
  if (hasPoint(q)) {
    params.set("location", `${q.lon},${q.lat}`);
    params.set("sort", "distance");
    params.set("radius", String(Math.min(q.radiusM ?? 15_000, 40_000)));
  }
  const response = await fetchImpl(`https://catalog.api.2gis.com/3.0/items?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    result?: { items?: Record<string, unknown>[] };
  };
  return (payload.result?.items ?? [])
    .map((item): PlaceCandidate | null => {
      const id = typeof item.id === "string" ? item.id : null;
      const name = typeof item.name === "string" ? item.name : null;
      if (!id || !name) return null;
      const point = item.point as { lat?: number; lon?: number } | undefined;
      const reviews = item.reviews as
        { general_rating?: number | string; general_review_count?: number } | undefined;
      const photos = ((item.external_content as { main_photo_url?: string }[] | undefined) ?? [])
        .map((content) => content.main_photo_url)
        .filter((url): url is string => Boolean(url))
        .slice(0, 6);
      const contacts = (
        (item.contact_groups as { contacts?: { type?: string; value?: string }[] }[]) ?? []
      ).flatMap((group) => group.contacts ?? []);
      const phone = contacts.find((c) => c.type === "phone")?.value ?? null;
      const website = contacts.find((c) => c.type === "website")?.value ?? null;
      const rating = reviews?.general_rating != null ? Number(reviews.general_rating) : null;
      const address = typeof item.address_name === "string" ? item.address_name : null;
      const lat = point?.lat ?? null;
      const lon = point?.lon ?? null;
      const firm = id.split("_")[0];
      return {
        source: "2gis",
        source_id: id,
        name,
        address,
        city: q.city,
        lat,
        lon,
        rating: Number.isFinite(rating) ? Math.round(rating! * 10) / 10 : null,
        rating_count: reviews?.general_review_count ?? null,
        image_url: photos[0] ?? null,
        photos,
        phone,
        website,
        hours: null,
        twogis_url: `https://2gis.ru/firm/${firm}`,
        distance_m:
          hasPoint(q) && lat != null && lon != null
            ? distanceMeters(q.lat!, q.lon!, lat, lon)
            : null,
        maps_url: yandexMapsUrl(name, address, q.city),
      };
    })
    .filter((item): item is PlaceCandidate => Boolean(item));
}

// ——— OpenStreetMap ——————————————————————————————————————————————————————

/** Популярные типы → теги OSM. Остальное ищем по названию. */
const OSM_TAGS: { test: RegExp; filters: string[] }[] = [
  { test: /кофе|кофейн|каппинг/iu, filters: ['["amenity"="cafe"]'] },
  { test: /пекарн|круассан/iu, filters: ['["shop"="bakery"]'] },
  { test: /кондитер|десерт/iu, filters: ['["shop"="confectionery"]', '["amenity"="cafe"]'] },
  { test: /мороженое|джелатер/iu, filters: ['["amenity"="ice_cream"]'] },
  { test: /чайн|чайхан/iu, filters: ['["amenity"="cafe"]["cuisine"~"tea"]'] },
  {
    test: /паб|пивн|тапрум|крафт/iu,
    filters: ['["amenity"="pub"]', '["amenity"="bar"]["drink:beer"]'],
  },
  {
    test: /(?<!\p{L})бар(?!абан)|рюмочн|наливочн|коктейл|спикизи/iu,
    filters: ['["amenity"="bar"]', '["amenity"="pub"]'],
  },
  { test: /кальян/iu, filters: ['["amenity"="hookah_lounge"]'] },
  { test: /ночной клуб|техно|рейв/iu, filters: ['["amenity"="nightclub"]'] },
  { test: /грузин/iu, filters: ['["amenity"="restaurant"]["cuisine"~"georgian"]'] },
  { test: /итальян|траттор/iu, filters: ['["amenity"="restaurant"]["cuisine"~"italian"]'] },
  { test: /пицц/iu, filters: ['["amenity"~"restaurant|fast_food"]["cuisine"~"pizza"]'] },
  { test: /суши/iu, filters: ['["amenity"="restaurant"]["cuisine"~"sushi|japanese"]'] },
  {
    test: /рамен|изакая|япон/iu,
    filters: ['["amenity"="restaurant"]["cuisine"~"ramen|japanese"]'],
  },
  { test: /корей/iu, filters: ['["amenity"="restaurant"]["cuisine"~"korean"]'] },
  { test: /китай|димсам/iu, filters: ['["amenity"="restaurant"]["cuisine"~"chinese"]'] },
  {
    test: /вьетнам|(?<!\p{L})фо(?!\p{L})/iu,
    filters: ['["amenity"="restaurant"]["cuisine"~"vietnamese"]'],
  },
  { test: /тайск/iu, filters: ['["amenity"="restaurant"]["cuisine"~"thai"]'] },
  { test: /узбек|плов/iu, filters: ['["amenity"="restaurant"]["cuisine"~"uzbek|central_asian"]'] },
  { test: /армян/iu, filters: ['["amenity"="restaurant"]["cuisine"~"armenian"]'] },
  { test: /индий/iu, filters: ['["amenity"="restaurant"]["cuisine"~"indian"]'] },
  { test: /мексик|тако/iu, filters: ['["amenity"="restaurant"]["cuisine"~"mexican"]'] },
  { test: /бургер/iu, filters: ['["amenity"~"restaurant|fast_food"]["cuisine"~"burger"]'] },
  { test: /стейк/iu, filters: ['["amenity"="restaurant"]["cuisine"~"steak"]'] },
  { test: /вегет|веган/iu, filters: ['["amenity"="restaurant"]["diet:vegan"~"yes|only"]'] },
  { test: /шаверм/iu, filters: ['["amenity"="fast_food"]["cuisine"~"shawarma|kebab"]'] },
  { test: /ресторан|бистро|гастробар|кухн|бранч/iu, filters: ['["amenity"="restaurant"]'] },
  { test: /кинотеатр|кино(?!\p{L})|ночной сеанс/iu, filters: ['["amenity"="cinema"]'] },
  { test: /театр|спектакл|мюзикл|балет|опер/iu, filters: ['["amenity"="theatre"]'] },
  { test: /музе/iu, filters: ['["tourism"="museum"]'] },
  {
    test: /галере|выставк|арт-кластер/iu,
    filters: ['["tourism"="gallery"]', '["tourism"="museum"]'],
  },
  { test: /планетари/iu, filters: ['["amenity"="planetarium"]'] },
  { test: /ботанич|оранжере/iu, filters: ['["leisure"="garden"]["garden:type"="botanical"]'] },
  { test: /зоопарк/iu, filters: ['["tourism"="zoo"]'] },
  { test: /смотров|панорам/iu, filters: ['["tourism"="viewpoint"]'] },
  { test: /усадьб|парк(?!ур|инг)|лесопарк|сквер/iu, filters: ['["leisure"="park"]'] },
  { test: /набережн/iu, filters: ['["leisure"="park"]', '["place"="square"]'] },
  { test: /боулинг/iu, filters: ['["leisure"="bowling_alley"]'] },
  { test: /картинг/iu, filters: ['["sport"="karting"]'] },
  { test: /скалодром|скалолаз|боулдеринг/iu, filters: ['["sport"="climbing"]'] },
  { test: /бан[яи]|саун|хаммам/iu, filters: ['["leisure"="sauna"]', '["amenity"="public_bath"]'] },
  { test: /аквапарк/iu, filters: ['["leisure"="water_park"]'] },
  { test: /бассейн/iu, filters: ['["leisure"="sports_centre"]["sport"="swimming"]'] },
  { test: /квест/iu, filters: ['["leisure"="escape_game"]'] },
  { test: /каток/iu, filters: ['["leisure"="ice_rink"]'] },
  { test: /батут/iu, filters: ['["leisure"="trampoline_park"]'] },
  { test: /бильярд/iu, filters: ['["sport"="billiards"]'] },
  {
    test: /теннис|падел|сквош|бадминтон/iu,
    filters: ['["sport"~"tennis|padel|squash|badminton"]'],
  },
  { test: /йога/iu, filters: ['["sport"="yoga"]'] },
  { test: /стадион|матч/iu, filters: ['["leisure"="stadium"]'] },
  {
    test: /собор|храм|церк|монастыр|мечет|дацан|кирх|костёл/iu,
    filters: ['["amenity"="place_of_worship"]'],
  },
  {
    test: /достопримечательн|памятник|особняк|дворец|крепост/iu,
    filters: ['["tourism"="attraction"]', '["historic"]'],
  },
];

export function osmFilters(type: NearbyQuery["type"]) {
  const text = `${type.name} ${type.search_query ?? ""}`;
  return OSM_TAGS.find((entry) => entry.test.test(text))?.filters ?? null;
}

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function osmCandidate(element: OsmElement, q: NearbyQuery): PlaceCandidate | null {
  const tags = element.tags ?? {};
  const name = tags.name ?? tags["name:ru"];
  if (!name) return null;
  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(", ");
  const address = street || null;
  return {
    source: "osm",
    source_id: `${element.type}/${element.id}`,
    name,
    address,
    city: tags["addr:city"] ?? q.city,
    lat,
    lon,
    rating: null,
    rating_count: null,
    image_url: null,
    photos: [],
    phone: tags.phone ?? tags["contact:phone"] ?? null,
    website: tags.website ?? tags["contact:website"] ?? null,
    hours: tags.opening_hours ?? null,
    twogis_url: null,
    distance_m:
      hasPoint(q) && lat != null && lon != null ? distanceMeters(q.lat!, q.lon!, lat, lon) : null,
    maps_url: yandexMapsUrl(name, address, q.city),
  };
}

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Тип заведения для поиска Nominatim по виду POI: amenity=cafe → «cafe». */
export function poiKind(filters: string[] | null) {
  const match = filters?.[0]?.match(/^\["(?:amenity|tourism|leisure|shop)"="([a-z_]+)"\]/);
  return match?.[1] ?? null;
}

type NominatimRow = {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string>;
};

function nominatimCandidate(row: NominatimRow, q: NearbyQuery): PlaceCandidate | null {
  const name = row.name || row.display_name?.split(",")[0];
  if (!name || !row.osm_id) return null;
  const lat = row.lat ? Number(row.lat) : null;
  const lon = row.lon ? Number(row.lon) : null;
  const address = [row.address?.road, row.address?.house_number].filter(Boolean).join(", ") || null;
  return {
    source: "osm",
    source_id: `${row.osm_type ?? "node"}/${row.osm_id}`,
    name,
    address,
    city: row.address?.city ?? row.address?.town ?? q.city,
    lat,
    lon,
    rating: null,
    rating_count: null,
    image_url: null,
    photos: [],
    phone: null,
    website: null,
    hours: null,
    twogis_url: null,
    distance_m:
      hasPoint(q) && lat != null && lon != null ? distanceMeters(q.lat!, q.lon!, lat, lon) : null,
    maps_url: yandexMapsUrl(name, address, q.city),
  };
}

async function nominatim(params: URLSearchParams, q: NearbyQuery, fetchImpl: Fetch) {
  const response = await fetchImpl(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) return [];
  const rows = (await response.json()) as NominatimRow[];
  return rows
    .map((row) => nominatimCandidate(row, q))
    .filter((item): item is PlaceCandidate => Boolean(item))
    .sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
}

/**
 * OpenStreetMap по ступеням: Overpass по тегам вокруг точки (два зеркала) →
 * Nominatim по виду заведения в окрестности → Nominatim по названию.
 */
export async function searchOsm(q: NearbyQuery, fetchImpl: Fetch = fetch) {
  const limit = q.limit ?? 10;
  const filters = osmFilters(q.type);
  const radius = Math.min(q.radiusM ?? 5_000, 20_000);
  if (filters && hasPoint(q)) {
    const body =
      `[out:json][timeout:12];(` +
      filters.map((f) => `nwr${f}["name"](around:${radius},${q.lat},${q.lon});`).join("") +
      `);out center ${Math.max(limit * 4, 30)};`;
    for (const endpoint of OVERPASS) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: `data=${encodeURIComponent(body)}`,
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as { elements?: OsmElement[] };
        const found = (payload.elements ?? [])
          .map((element) => osmCandidate(element, q))
          .filter((item): item is PlaceCandidate => Boolean(item))
          .sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
        if (found.length) return found.slice(0, limit);
        break;
      } catch {
        // Зеркало не ответило — пробуем следующее.
      }
    }
  }
  const base = () =>
    new URLSearchParams({
      format: "jsonv2",
      // Берём с запасом: Nominatim отдаёт не по расстоянию, сортируем сами.
      limit: "40",
      addressdetails: "1",
      "accept-language": "ru",
    });
  const box = (params: URLSearchParams, meters = radius) => {
    if (!hasPoint(q)) return params;
    const dLat = meters / 111_000;
    const dLon = dLat / Math.max(0.2, Math.cos((q.lat! * Math.PI) / 180));
    params.set("viewbox", `${q.lon! - dLon},${q.lat! + dLat},${q.lon! + dLon},${q.lat! - dLat}`);
    params.set("bounded", "1");
    return params;
  };
  const kind = poiKind(filters);
  if (kind && hasPoint(q)) {
    const params = box(base());
    params.set("amenity", kind);
    const found = await nominatim(params, q, fetchImpl).catch(() => []);
    if (found.length) return found.slice(0, limit);
  }
  // По названию совпадений меньше — ищем шире.
  const params = box(base(), Math.max(radius, 15_000));
  params.set("q", hasPoint(q) ? queryOf(q.type) : `${queryOf(q.type)} ${q.city ?? ""}`.trim());
  return (await nominatim(params, q, fetchImpl)).slice(0, limit);
}

/** Меньше стольких находок на картах — добираем веб-поиском. */
export const WEB_FALLBACK_BELOW = 3;
const WEB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WEB_CACHE_MAX = 500;

/**
 * 2ГИС с ключом, иначе OpenStreetMap; сбой 2ГИС тоже уводит в OSM. Если карты
 * под тип почти пусты и есть веб-поиск — добираем местами из интернета.
 * Веб-находки по (тип, город) живут в памяти неделю: тот же запрос не стоит
 * второго похода в интернет, а расстояние до человека пересчитываем каждый раз.
 */
export function createPlaceSearch(
  options: {
    dgisKey?: string | null;
    fetch?: Fetch;
    web?: WebPlaceFinder | null;
    /** Пауза между запросами к геокодеру; в тестах — 0. */
    geocodeGapMs?: number;
  } = {},
) {
  const fetchImpl = options.fetch ?? fetch;
  type WebRow = Awaited<ReturnType<typeof webCandidates>>[number];
  const webCache = new Map<string, { at: number; rows: Promise<WebRow[]> }>();

  const fromWeb = (query: NearbyQuery): Promise<WebRow[]> => {
    const city = query.city!;
    const key = `${query.type.id}|${city.toLocaleLowerCase("ru")}`;
    const hit = webCache.get(key);
    if (hit && Date.now() - hit.at < WEB_CACHE_TTL_MS) return hit.rows;
    const rows = options.web!({
      type_name: query.type.name,
      search_query: query.type.search_query ?? null,
      city,
    }).then((hits) =>
      webCandidates(hits, city, { fetch: fetchImpl, gapMs: options.geocodeGapMs }),
    );
    if (webCache.size >= WEB_CACHE_MAX) webCache.delete(webCache.keys().next().value!);
    webCache.set(key, { at: Date.now(), rows });
    // Сбой не кэшируем: в следующий раз попробуем снова.
    rows.catch(() => webCache.delete(key));
    return rows;
  };

  const maps = async (query: NearbyQuery) => {
    if (options.dgisKey) {
      try {
        const found = await search2gis(options.dgisKey, query, fetchImpl);
        if (found.length) return found;
      } catch {
        // Каталог недоступен — идём в OpenStreetMap.
      }
    }
    try {
      return await searchOsm(query, fetchImpl);
    } catch {
      return [];
    }
  };

  return {
    async nearby(query: NearbyQuery) {
      const found = await maps(query);
      if (!options.web || !query.allowWeb || !query.city || found.length >= WEB_FALLBACK_BELOW) {
        return found;
      }
      let rows: WebRow[];
      try {
        rows = await fromWeb(query);
      } catch {
        return found;
      }
      const names = new Set(found.map((place) => place.name.toLocaleLowerCase("ru")));
      const hasPoint_ = hasPoint(query);
      const extra: PlaceCandidate[] = rows
        .filter((row) => !names.has(row.name.toLocaleLowerCase("ru")))
        .map((row) => ({
          ...row,
          distance_m:
            hasPoint_ && row.lat != null && row.lon != null
              ? distanceMeters(query.lat!, query.lon!, row.lat, row.lon)
              : null,
          maps_url: yandexMapsUrl(row.name, row.address, row.city),
        }))
        .sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
      return [...found, ...extra].slice(0, Math.max(query.limit ?? 10, found.length));
    },
  } satisfies PlaceSearch;
}
