import type { ActivityCategory, ActivitySpin, ActivityType, Place } from "../../types.js";
import type { AppRepository } from "../../repository.js";
import {
  activityCategoryHint,
  fitsSeason,
  loadActivityCatalog,
  localMonth,
  mapsSearchUrl,
  shuffle,
  visitedTypes,
} from "./activities.js";

// Колесо «Удиви меня»: человек говорит, чего хочет (спокойное, активное или
// что-то конкретное), когда и с кем, может оставить только новое — сервер
// собирает подходящие типы, раскладывает до восьми на колесо и сам выбирает,
// где оно остановится. Три вращения за местный день; перед повтором можно
// написать, что не так, — следующее вращение это учтёт.

export const WHEEL_SPINS_PER_DAY = 3;
export const WHEEL_SEGMENTS = 8;

export type WheelMood = "calm" | "active" | "any";
export type WheelWhen = "now" | "today" | "weekend";
export type WheelCompany = "solo" | "pair" | "friends" | "kids";
export interface WheelRequest {
  mood: WheelMood;
  want: string | null;
  when: WheelWhen;
  company: WheelCompany;
  city: string | null;
  only_new: boolean;
  feedback: string | null;
}

type Rng = () => number;

/** Что человек написал перед повтором, превращённое в фильтры. */
export interface FeedbackFilters {
  maxPrice: number | null;
  indoorOnly: boolean;
  nearOnly: boolean;
  minEmotion: number | null;
  maxActivity: number | null;
  minActivity: number | null;
  maxHours: number | null;
  excludeCategories: Set<string>;
  excludeTypes: Set<string>;
}

const OUT_OF_TOWN = /загород|поездка/iu;

export function feedbackFilters(
  text: string | null | undefined,
  last: ActivityType | null,
): FeedbackFilters {
  const said = (text ?? "").toLocaleLowerCase();
  const filters: FeedbackFilters = {
    maxPrice: null,
    indoorOnly: false,
    nearOnly: false,
    minEmotion: null,
    maxActivity: null,
    minActivity: null,
    maxHours: null,
    excludeCategories: new Set(),
    excludeTypes: new Set(),
  };
  if (!said.trim()) return filters;
  if (/дорог|денег|бюджет|дешевл|expensive|cheaper/iu.test(said))
    filters.maxPrice = Math.max(1, (last?.price_level ?? 3) - 1);
  if (/далек|далёк|за\s*город|ехать|дорога|far/iu.test(said)) filters.nearOnly = true;
  if (/холод|мороз|дожд|на\s+улиц|мокро|cold|rain|outside/iu.test(said)) filters.indoorOnly = true;
  if (/скучн|банальн|обычн|слишком\s+спокойн|хочу\s+(?:драйв|адреналин|эмоци)|boring/iu.test(said))
    filters.minEmotion = 4;
  if (
    /устал|лень|тяжел|тяжёл|не\s+хочу\s+(?:двигат|напряг|потеть)|слишком\s+активн|tired|lazy/iu.test(
      said,
    )
  )
    filters.maxActivity = 2;
  if (/подвигат|размяться|активн(?:ее|ого)|энерги|more\s+active/iu.test(said))
    filters.minActivity = 3;
  if (/долго|нет\s+времени|быстр|коротк|too\s+long/iu.test(said)) filters.maxHours = 2;
  if (last) {
    // Что бы ни написали, выпавшее только что не повторяем; «не то» и
    // «не люблю» убирают всю его категорию — иначе колесо даст соседа.
    filters.excludeTypes.add(last.id);
    if (
      /не\s+то|не\s+люблю|не\s+хочу|надоел|другое|не\s+моё|не\s+мое|не\s+нрав|был[аи]?\s+(?:уже|там)|уже\s+был|not\s+(?:this|my)/iu.test(
        said,
      )
    )
      filters.excludeCategories.add(last.category_id);
  }
  return filters;
}

const WORD = /[\p{L}\p{N}]+/gu;
const stem = (word: string) => word.toLocaleLowerCase().slice(0, Math.max(4, word.length - 2));

/** Типы, прямо названные в «что-то конкретное»: «кофейня», «картинг», «бар». */
export function typesNamedIn(want: string, types: ActivityType[]) {
  const words = (want.match(WORD) ?? []).filter((w) => w.length >= 4).map(stem);
  if (!words.length) return [];
  return types.filter((type) => {
    const hay = `${type.name} ${type.search_query ?? ""}`.toLocaleLowerCase();
    return words.some((word) => hay.includes(word));
  });
}

function fitsMood(type: ActivityType, mood: WheelMood) {
  if (mood === "calm") return type.activity_level <= 2 && type.emotion_level <= 3;
  // «Активное» — про движение, а не про яркие эмоции за столиком.
  if (mood === "active") return type.activity_level >= 3;
  return true;
}

function fitsWhen(type: ActivityType, when: WheelWhen) {
  const far = OUT_OF_TOWN.test(type.geo ?? "");
  if (when === "now") return !far && type.duration_hours <= 3;
  if (when === "today") return !/поездка/iu.test(type.geo ?? "") && type.duration_hours <= 8;
  return true;
}

function fitsCompany(type: ActivityType, company: WheelCompany) {
  if (company !== "kids" && type.category_id === "kids") return false;
  if (company === "solo") return type.min_people <= 1;
  if (company === "pair") return type.min_people <= 2;
  if (company === "kids") return type.kids_ok;
  return true;
}

function fitsFeedback(type: ActivityType, f: FeedbackFilters) {
  if (f.excludeTypes.has(type.id) || f.excludeCategories.has(type.category_id)) return false;
  if (f.maxPrice != null && type.price_level > f.maxPrice) return false;
  if (f.indoorOnly && type.setting === "outdoor") return false;
  if (f.nearOnly && OUT_OF_TOWN.test(type.geo ?? "")) return false;
  if (f.minEmotion != null && type.emotion_level < f.minEmotion) return false;
  if (f.maxActivity != null && type.activity_level > f.maxActivity) return false;
  if (f.minActivity != null && type.activity_level < f.minActivity) return false;
  if (f.maxHours != null && type.duration_hours > f.maxHours) return false;
  return true;
}

export interface WheelPoolInput {
  types: ActivityType[];
  request: WheelRequest;
  month: number;
  tried: Set<string>;
  skipped: Set<string>;
  /** Что уже выпадало сегодня — второй раз не кладём на колесо. */
  wonToday: Set<string>;
  last: ActivityType | null;
}

/** Все типы, подходящие под запрос; конкретная просьба сужает, но не обнуляет выбор. */
export function wheelPool(input: WheelPoolInput) {
  return wheelPoolDetailed(input).pool;
}

/** То же плюс какие из типов человек назвал сам — им на колесе сектор шире. */
export function wheelPoolDetailed(input: WheelPoolInput): {
  pool: ActivityType[];
  focused: Set<string>;
} {
  const { request } = input;
  const feedback = feedbackFilters(request.feedback, input.last);
  const base = input.types.filter(
    (type) =>
      fitsSeason(type.season, input.month) &&
      !input.skipped.has(type.id) &&
      !input.wonToday.has(type.id) &&
      (!request.only_new || !input.tried.has(type.id)) &&
      fitsWhen(type, request.when) &&
      fitsCompany(type, request.company) &&
      fitsFeedback(type, feedback),
  );
  const want = request.want?.trim();
  if (want) {
    const named = typesNamedIn(want, base);
    if (named.length) return focusedPool(named, base);
    const category = activityCategoryHint(want);
    if (category) {
      const inCategory = base.filter((type) => type.category_id === category);
      if (inCategory.length) return focusedPool(inCategory, base);
    }
  }
  return { pool: base.filter((type) => fitsMood(type, request.mood)), focused: new Set() };
}

function focusedPool(focused: ActivityType[], base: ActivityType[]) {
  return {
    pool: withNeighbours(focused, base),
    focused: new Set(focused.map((type) => type.id)),
  };
}

export const WHEEL_MIN_SEGMENTS = 4;

/**
 * Узкий запрос («экстрим» в ноябре, «кофейня») даёт два-четыре типа — колесо
 * из двух секторов не крутят. Добираем самыми похожими: сначала та же
 * категория, потом близкие по активности и эмоциям.
 */
function withNeighbours(focused: ActivityType[], base: ActivityType[]) {
  if (focused.length >= WHEEL_MIN_SEGMENTS) return focused;
  const ids = new Set(focused.map((type) => type.id));
  const categories = new Set(focused.map((type) => type.category_id));
  const avg = (pick: (type: ActivityType) => number) =>
    focused.reduce((sum, type) => sum + pick(type), 0) / focused.length;
  const activity = avg((type) => type.activity_level);
  const emotion = avg((type) => type.emotion_level);
  const distance = (type: ActivityType) =>
    (categories.has(type.category_id) ? 0 : 2) +
    Math.abs(type.activity_level - activity) +
    Math.abs(type.emotion_level - emotion);
  const neighbours = base
    .filter((type) => !ids.has(type.id))
    .sort((a, b) => distance(a) - distance(b) || a.sort - b.sort)
    .slice(0, WHEEL_MIN_SEGMENTS - focused.length);
  return [...focused, ...neighbours];
}

/** До восьми разных типов на колесо, не больше двух из одной категории, если хватает. */
export function wheelSegments(
  pool: ActivityType[],
  rng: Rng,
  size = WHEEL_SEGMENTS,
  focused = new Set<string>(),
) {
  if (focused.size) {
    // Названное — всё, что влезает; добивка — после, и порядок перемешан.
    const named = shuffle(
      pool.filter((type) => focused.has(type.id)),
      rng,
    ).slice(0, size);
    const rest = pool.filter((type) => !focused.has(type.id));
    return shuffle([...named, ...rest].slice(0, size), rng);
  }
  const shuffled = shuffle(pool, rng);
  const picked: ActivityType[] = [];
  const perCategory = new Map<string, number>();
  for (const type of shuffled) {
    if (picked.length >= size) break;
    const used = perCategory.get(type.category_id) ?? 0;
    if (used >= 2) continue;
    perCategory.set(type.category_id, used + 1);
    picked.push(type);
  }
  for (const type of shuffled) {
    if (picked.length >= size) break;
    if (!picked.includes(type)) picked.push(type);
  }
  return picked;
}

/** Честный выбор с весами: вероятность сектора равна его доле на колесе. */
export function weightedIndex(weights: number[], rng: Rng) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let point = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    point -= weights[i]!;
    if (point < 0) return i;
  }
  return weights.length - 1;
}

export function localDateKey(now: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

type WheelRepository = Pick<
  AppRepository,
  | "listActivityCatalog"
  | "listPlaceVisits"
  | "listPlaces"
  | "listActivitySpins"
  | "createActivitySpin"
  | "isAdmin"
>;

export interface WheelSegment {
  id: string;
  /** Доля колеса: названное человеком весит 2, добивка и обычные — 1. */
  weight: number;
  name: string;
  emoji: string | null;
  category: string;
}
export interface WheelResult {
  spin_id: string;
  segments: WheelSegment[];
  winner_index: number;
  winner: {
    type: ActivityType;
    category: ActivityCategory | null;
    places: Place[];
    maps_url: string;
  };
  spins_used: number;
  /** null — без ограничения (администратор). */
  spins_left: number | null;
  spins_limit: number;
}

export class WheelError extends Error {
  constructor(
    readonly status: number,
    readonly code: "WHEEL_LIMIT" | "WHEEL_EMPTY",
    message: string,
  ) {
    super(message);
  }
}

export async function wheelStatus(
  repository: Pick<WheelRepository, "listActivitySpins" | "isAdmin">,
  ownerId: string,
  timezone: string,
  now = new Date(),
) {
  const [spins, unlimited] = await Promise.all([
    repository.listActivitySpins(ownerId, localDateKey(now, timezone)),
    repository.isAdmin(ownerId),
  ]);
  return {
    spins_used: spins.length,
    spins_left: unlimited ? null : Math.max(0, WHEEL_SPINS_PER_DAY - spins.length),
    spins_limit: WHEEL_SPINS_PER_DAY,
    today: spins,
  };
}

export async function spinWheel(
  repository: WheelRepository,
  ownerId: string,
  request: WheelRequest,
  options: { timezone: string; city: string | null; now?: Date; rng?: Rng },
): Promise<WheelResult> {
  const now = options.now ?? new Date();
  const rng = options.rng ?? Math.random;
  const day = localDateKey(now, options.timezone);
  const [spins, unlimited, catalog, visits] = await Promise.all([
    repository.listActivitySpins(ownerId, day),
    repository.isAdmin(ownerId),
    loadActivityCatalog(repository),
    repository.listPlaceVisits(ownerId),
  ]);
  if (!unlimited && spins.length >= WHEEL_SPINS_PER_DAY)
    throw new WheelError(429, "WHEEL_LIMIT", "Колесо на сегодня всё — три вращения в день");
  const byId = new Map(catalog.types.map((type) => [type.id, type]));
  const lastSpin: ActivitySpin | undefined = spins.at(-1);
  const last = lastSpin?.result_type_id ? (byId.get(lastSpin.result_type_id) ?? null) : null;
  const visitedPlaceIds = new Set(visits.filter((v) => v.place_id).map((v) => v.place_id!));
  const visitedPlaces = visitedPlaceIds.size
    ? (await repository.listPlaces({ limit: 200 })).filter((p) => visitedPlaceIds.has(p.id))
    : [];
  const { tried, skipped } = visitedTypes(visits, visitedPlaces);
  const { pool, focused } = wheelPoolDetailed({
    types: catalog.types,
    request,
    month: localMonth(now, options.timezone),
    tried,
    skipped,
    wonToday: new Set(spins.map((s) => s.result_type_id).filter((id): id is string => Boolean(id))),
    last,
  });
  if (!pool.length)
    throw new WheelError(
      422,
      "WHEEL_EMPTY",
      "Под такой запрос ничего не нашлось — ослабь условия или напиши по-другому",
    );
  const segments = wheelSegments(pool, rng, WHEEL_SEGMENTS, focused);
  const weights = segments.map((type) => (focused.has(type.id) ? 2 : 1));
  const winnerIndex = weightedIndex(weights, rng);
  const winner = segments[winnerIndex]!;
  const candidates = await repository.listPlaces({
    typeIds: [winner.id],
    city: options.city,
    limit: 60,
  });
  const places = shuffle(
    candidates.filter((place) => !request.only_new || !visitedPlaceIds.has(place.id)),
    rng,
  ).slice(0, 3);
  const spin = await repository.createActivitySpin(ownerId, {
    local_date: day,
    request: { ...request },
    feedback: request.feedback?.slice(0, 500) || null,
    segment_ids: segments.map((type) => type.id),
    result_type_id: winner.id,
  });
  const names = new Map(catalog.categories.map((c) => [c.id, c]));
  const used = spins.length + 1;
  return {
    spin_id: spin.id,
    segments: segments.map((type) => ({
      id: type.id,
      weight: focused.has(type.id) ? 2 : 1,
      name: type.name,
      emoji: type.emoji,
      category: names.get(type.category_id)?.name ?? type.category_id,
    })),
    winner_index: winnerIndex,
    winner: {
      type: winner,
      category: names.get(winner.category_id) ?? null,
      places,
      maps_url: mapsSearchUrl(winner.search_query || winner.name, options.city),
    },
    spins_used: used,
    spins_left: unlimited ? null : Math.max(0, WHEEL_SPINS_PER_DAY - used),
    spins_limit: WHEEL_SPINS_PER_DAY,
  };
}
