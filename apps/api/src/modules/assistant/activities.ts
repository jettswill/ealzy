import type {
  ActivityCatalog,
  ActivityIdea,
  ActivityType,
  Place,
  PlaceVisit,
} from "../../types.js";
import type { AppRepository } from "../../repository.js";
import { tasteFor, tasteIndex, weightedShuffle } from "./tastes.js";

// Справочник «чем заняться» (supabase/migrations/041_activity_catalog_seed.sql):
// ~400 типов активностей от кофейни до прыжка с парашютом. Илзи видит из него
// небольшую подборку только тогда, когда человек спрашивает, куда сходить,
// а конкретные места берёт из своей базы мест — не выдумывает.

const OUTING =
  /куда\s+(?:бы\s+|можно\s+|ещё\s+|еще\s+)?(?:сходить|пойти|сводить|съездить|поехать|выбраться|податься)|чем\s+(?:бы\s+)?(?:заняться|занять(?:ся)?)|что\s+(?:бы\s+)?(?:поделать|интересного)|где\s+(?:бы\s+|можно\s+)?(?:поесть|поужинать|пообедать|позавтракать|выпить|посидеть|погулять|отдохнуть)|скучно|удиви\s+меня|случайн\S*\s+(?:место|активност|кофейн|ресторан)|нов\S*\s+(?:кофейн|ресторан|бар|мест)|иде[яиюй]\S*\s+(?:на|для)\s+(?:выходн|вечер|свидан|вторник|отпуск)|где\s+я\s+ещё\s+не\s+был|где\s+я\s+еще\s+не\s+был|where\s+to\s+go|what\s+to\s+do|something\s+fun/iu;

export function isOutingRequest(text: string) {
  return OUTING.test(text);
}

const CATEGORY_HINTS: { category: string; test: RegExp }[] = [
  { category: "coffee-tea", test: /коф[еэ]|кофейн|завтрак|чайн|десерт|coffee|breakfast/iu },
  {
    category: "bars-nightlife",
    test: /(?<!\p{L})бар|выпить|коктейл|вин[оа]|пив[оа]|клуб|потанцевать|bar|drink/iu,
  },
  {
    category: "restaurants",
    test: /поесть|поужинать|пообедать|ресторан|кухн|ужин|обед|суши|рамен|пицц|food|dinner|restaurant/iu,
  },
  { category: "parks-walks", test: /погулять|прогул|парк|набережн|walk|park/iu },
  { category: "museums-tours", test: /музе|выставк|экскурс|museum|exhibition/iu },
  {
    category: "stage-music",
    test: /театр|концерт|спектакл|джаз|стендап|theatre|theater|concert/iu,
  },
  { category: "extreme", test: /адреналин|экстрим|страшн|adrenaline|extreme/iu },
  { category: "creative", test: /мастер[-\s]?класс|своими\s+руками|творч|workshop/iu },
  { category: "relax", test: /(?<!\p{L})спа(?!\p{L})|бан[яюи]|расслаб|релакс|spa|relax/iu },
  { category: "water", test: /(?<!\p{L})сап(?!\p{L})|каяк|на\s+воде|water/iu },
  { category: "sport-try", test: /спорт|потренир|подвигать|sport|workout/iu },
];

export function activityCategoryHint(text: string): string | null {
  return CATEGORY_HINTS.find((hint) => hint.test.test(text))?.category ?? null;
}

const WITH_KIDS =
  /с\s+(?:детьми|ребёнк|ребенк|сыном|дочк|дочерью|малыш)|для\s+(?:детей|ребёнка|ребенка)|kids|children/iu;

/** Номер месяца 1–12 в часовом поясе человека. */
export function localMonth(now: Date, timezone: string) {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: timezone }).format(now),
    );
  } catch {
    return now.getUTCMonth() + 1;
  }
}

export function fitsSeason(season: ActivityType["season"], month: number) {
  if (season === "all") return true;
  if (season === "summer") return month >= 6 && month <= 8;
  if (season === "warm") return month >= 5 && month <= 9;
  return month === 12 || month <= 3;
}

type Rng = () => number;

export function shuffle<T>(items: T[], rng: Rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export interface PickOptions {
  /** Личный вкус: «никогда» убирает тип, вес двигает его вперёд или назад. */
  taste?: (type: ActivityType) => { never: boolean; score: number; reason: string | null };
  catalog: ActivityCatalog;
  visits: PlaceVisit[];
  places?: Pick<Place, "id" | "activity_type_ids">[];
  text: string;
  month: number;
  limit?: number;
  category?: string | null;
  rng?: Rng;
}

/** Типы, которые человек уже пробовал (по дневнику) и которые просил не предлагать. */
export function visitedTypes(
  visits: PlaceVisit[],
  places: Pick<Place, "id" | "activity_type_ids">[] = [],
) {
  const placeTypes = new Map(places.map((place) => [place.id, place.activity_type_ids]));
  const tried = new Set<string>();
  const skipped = new Set<string>();
  for (const visit of visits) {
    const types = [
      ...(visit.activity_type_id ? [visit.activity_type_id] : []),
      ...(visit.place_id ? (placeTypes.get(visit.place_id) ?? []) : []),
    ];
    for (const id of types) {
      if (visit.status === "visited") tried.add(id);
      // «Не предлагать» про место без отдельного типа гасит только место, не весь тип.
      if (visit.status === "skip" && !visit.place_id) skipped.add(id);
    }
  }
  return { tried, skipped };
}

/**
 * Подборка типов «чем заняться»: подходят по сезону, поводу и детям; сначала
 * то, чего человек ещё не пробовал; без повода — не больше двух из одной
 * категории, чтобы подборка была разной.
 */
export function pickActivityIdeas(options: PickOptions): ActivityIdea[] {
  const rng = options.rng ?? Math.random;
  const limit = options.limit ?? 8;
  const category = options.category ?? activityCategoryHint(options.text);
  const kids = WITH_KIDS.test(options.text);
  const { tried, skipped } = visitedTypes(options.visits, options.places);
  const names = new Map(options.catalog.categories.map((c) => [c.id, c.name]));
  const pool = options.catalog.types.filter(
    (type) =>
      fitsSeason(type.season, options.month) &&
      !skipped.has(type.id) &&
      (!kids || type.kids_ok) &&
      (!category || type.category_id === category) &&
      !options.taste?.(type).never,
  );
  const weight = (type: ActivityType) => Math.exp(1.1 * (options.taste?.(type).score ?? 0));
  const ordered = [
    ...weightedShuffle(
      pool.filter((type) => !tried.has(type.id)),
      weight,
      rng,
    ),
    ...weightedShuffle(
      pool.filter((type) => tried.has(type.id)),
      weight,
      rng,
    ),
  ];
  const perCategory = new Map<string, number>();
  const picked: ActivityType[] = [];
  for (const type of ordered) {
    if (picked.length >= limit) break;
    const used = perCategory.get(type.category_id) ?? 0;
    if (!category && used >= 2) continue;
    perCategory.set(type.category_id, used + 1);
    picked.push(type);
  }
  return picked.map((type) => ({
    type_id: type.id,
    name: type.name,
    category: names.get(type.category_id) ?? type.category_id,
    emoji: type.emoji,
    price_level: type.price_level,
    activity_level: type.activity_level,
    emotion_level: type.emotion_level,
    setting: type.setting,
    search_query: type.search_query,
    tried: tried.has(type.id),
    taste: options.taste?.(type).reason ?? null,
    places: [],
  }));
}

/** Места к идеям: только из базы, без тех, где человек уже был или просил не предлагать. */
export function attachPlaces(
  ideas: ActivityIdea[],
  places: Place[],
  visits: PlaceVisit[],
  perIdea = 2,
) {
  const seen = new Set(visits.filter((v) => v.place_id).map((v) => v.place_id!));
  return ideas.map((idea) => ({
    ...idea,
    places: places
      .filter((place) => place.activity_type_ids.includes(idea.type_id) && !seen.has(place.id))
      .slice(0, perIdea)
      .map((place) => ({
        id: place.id,
        name: place.name,
        address: place.address,
        rating: place.yandex_rating,
      })),
  }));
}

/** Яндекс Карты с поиском вокруг точки: масштаб — под радиус. */
export function mapsAreaUrl(query: string, area: { lat: number; lon: number; radius_m: number }) {
  const zoom =
    area.radius_m <= 1_500 ? 15 : area.radius_m <= 4_000 ? 14 : area.radius_m <= 9_000 ? 13 : 12;
  const params = new URLSearchParams({
    text: query,
    ll: `${area.lon.toFixed(5)},${area.lat.toFixed(5)}`,
    z: String(zoom),
  });
  return `https://yandex.ru/maps/?${params}`;
}

export function mapsSearchUrl(query: string, city?: string | null) {
  const text = [query, city].filter(Boolean).join(" ");
  return `https://yandex.ru/maps/?text=${encodeURIComponent(text)}`;
}

// Справочник меняется только выкладкой — держим его в памяти процесса.
let cached: { at: number; catalog: ActivityCatalog } | null = null;
const CATALOG_TTL_MS = 10 * 60_000;

export async function loadActivityCatalog(repository: Pick<AppRepository, "listActivityCatalog">) {
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.catalog;
  const catalog = await repository.listActivityCatalog();
  if (catalog.types.length) cached = { at: Date.now(), catalog };
  return catalog;
}

export function resetActivityCatalogCache() {
  cached = null;
}

/** Идеи с местами для workspace Илзи; пусто, если справочник ещё не залит. */
export async function buildActivityIdeas(
  repository: Pick<
    AppRepository,
    "listActivityCatalog" | "listPlaceVisits" | "listPlaces" | "listActivityPreferences"
  >,
  ownerId: string,
  input: { text: string; city: string | null; timezone: string; now?: Date; limit?: number },
): Promise<ActivityIdea[]> {
  const catalog = await loadActivityCatalog(repository);
  if (!catalog.types.length) return [];
  const [visits, prefs] = await Promise.all([
    repository.listPlaceVisits(ownerId),
    repository.listActivityPreferences(ownerId),
  ]);
  const tastes = tasteIndex(prefs);
  const visitedPlaceIds = visits.filter((v) => v.place_id).map((v) => v.place_id!);
  const visitedPlaces = visitedPlaceIds.length
    ? (await repository.listPlaces({ limit: 200 })).filter((p) => visitedPlaceIds.includes(p.id))
    : [];
  const ideas = pickActivityIdeas({
    catalog,
    visits,
    places: visitedPlaces,
    text: input.text,
    month: localMonth(input.now ?? new Date(), input.timezone),
    limit: input.limit ?? 8,
    taste: (type) => tasteFor(type, tastes),
  });
  if (!ideas.length) return [];
  const places = await repository.listPlaces({
    typeIds: ideas.map((idea) => idea.type_id),
    city: input.city,
    limit: 60,
  });
  return attachPlaces(ideas, places, visits);
}

/** Кнопка «Удиви меня»: один случайный тип и до трёх мест, где человек ещё не был. */
export async function surpriseActivity(
  repository: Pick<AppRepository, "listActivityCatalog" | "listPlaceVisits" | "listPlaces">,
  ownerId: string,
  input: {
    category?: string | null;
    typeId?: string | null;
    city: string | null;
    timezone: string;
    now?: Date;
    rng?: Rng;
  },
) {
  const catalog = await loadActivityCatalog(repository);
  const visits = await repository.listPlaceVisits(ownerId);
  let type = input.typeId ? catalog.types.find((t) => t.id === input.typeId) : undefined;
  if (!type) {
    const [idea] = pickActivityIdeas({
      catalog,
      visits,
      text: "",
      category: input.category ?? null,
      month: localMonth(input.now ?? new Date(), input.timezone),
      limit: 1,
      rng: input.rng,
    });
    type = idea ? catalog.types.find((t) => t.id === idea.type_id) : undefined;
  }
  if (!type) return null;
  const seen = new Set(visits.filter((v) => v.place_id).map((v) => v.place_id!));
  const all = await repository.listPlaces({ typeIds: [type.id], city: input.city, limit: 60 });
  const fresh = all.filter((place) => !seen.has(place.id));
  const places = shuffle(fresh, input.rng ?? Math.random).slice(0, 3);
  return {
    type,
    category: catalog.categories.find((c) => c.id === type.category_id) ?? null,
    places,
    maps_url: mapsSearchUrl(type.search_query || type.name, input.city),
  };
}
