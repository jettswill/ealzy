import type { Experience, Memory, Person } from "../../types.js";
import { bcp47, cityForLocale, formatMoney, languageOf } from "../../locale.js";
import { personDateLabel } from "./dates.js";
import {
  collectGiftHistory,
  collectTastes,
  datePrepOffers,
  inferPersonGender,
  type PersonGender,
  type UpcomingDate,
} from "./date-prep.js";
import {
  distillLifeQuery,
  isLifeHelpId,
  isMailTalk,
  isTaskCapture,
  lifeHelpId,
  lifeHelpOffer,
  lifeHelpRule,
  mailReplyOffer,
  nearbyQuery,
  offerLifeId,
  repairQuery,
  type LifeHelpId,
} from "./life-help.js";

export {
  DATE_PREP_DAYS,
  datePrepActionHint,
  datePrepKind,
  datePrepOffers,
  datesNeedingPrep,
  upcomingDateDigestLines,
  type UpcomingDate,
} from "./date-prep.js";

export const OFFER_KINDS = [
  "draft",
  "plan",
  "rewrite",
  "summarize",
  "research",
  "hint",
  "search_products",
  "search_places",
  "remind",
] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];
export type CapabilityOffer = {
  kind: OfferKind;
  title: string;
  instruction: string;
};
export type ReminderTaskAction = {
  op: "create";
  task_id: null;
  title: string;
  due_at: string;
  goal_id: null;
  project_id: null;
  kind: "task";
  importance: null;
  urgency: null;
  assignee: "user";
};

export type DiscoveryKind = "products" | "places" | "gifts" | "web" | "fx";
export type PlaceKind = "restaurant" | "entertainment" | "place";
export type DiscoveryHit = {
  kind: "product" | "place" | "shop" | "web";
  title: string;
  subtitle: string;
  url: string;
  price: string | null;
  source: string;
};
export type DiscoveryIntent = {
  type: DiscoveryKind;
  query: string;
  city: string | null;
  maxPrice: number | null;
  minPrice: number | null;
  brand: string | null;
  category: string | null;
  placeKind: PlaceKind;
  locale?: string | null;
};
export type DiscoveryClient = {
  search(intent: DiscoveryIntent): Promise<DiscoveryHit[]>;
};
export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown>; text?: () => Promise<string> }>;

const USER_AGENT = "Ealzy/1.0 (https://ealzy.ru)";
const FETCH_MS = 3_200;
const MONTHS: [RegExp, number][] = [
  [/январ/iu, 1],
  [/феврал/iu, 2],
  [/март/iu, 3],
  [/апрел/iu, 4],
  [/ма[йя]/iu, 5],
  [/июн/iu, 6],
  [/июл/iu, 7],
  [/август/iu, 8],
  [/сентябр/iu, 9],
  [/октябр/iu, 10],
  [/ноябр/iu, 11],
  [/декабр/iu, 12],
];
const HOLIDAYS: { month: number; day: number; label: string }[] = [
  { month: 1, day: 1, label: "Новый год" },
  { month: 2, day: 14, label: "День святого Валентина" },
  { month: 2, day: 23, label: "23 февраля" },
  { month: 3, day: 8, label: "8 Марта" },
  { month: 5, day: 9, label: "9 мая" },
  { month: 12, day: 31, label: "Новый год" },
];

export const GOAL_SYNC_OFFER_TITLES = {
  ru: "Свериться по целям",
  en: "Sync on goals",
} as const;

export function goalSyncOffer(locale?: string | null): CapabilityOffer {
  const ru = languageOf(locale) !== "en";
  return {
    kind: "plan",
    title: ru ? GOAL_SYNC_OFFER_TITLES.ru : GOAL_SYNC_OFFER_TITLES.en,
    instruction: ru
      ? "Синк по целям и плану. Поговори со мной как спокойный ментор по тайм-менеджменту и психолог: без пафоса и давления. Сначала пойми истинные мотивы. Если «зачем» мутное — задай один точный вопрос и не вываливай план. Когда направление ясно: обнови или создай цели, запиши план и создай дела с goal_id. Не выдумывай факты."
      : "Goals and plan sync. Talk with me as a calm time-management mentor and psychologist: no guru talk, no pressure. First get at the real motives. If the why is fuzzy, ask one precise question and don't dump a plan. When direction is clear: create or update goals, write the plan, and create tasks with that goal_id. Don't invent facts.",
  };
}

export const CAPABILITY_HINTS: CapabilityOffer[] = [
  {
    kind: "remind",
    title: "Напомнить о праздниках",
    instruction:
      "Посмотри ближайшие дни рождения и праздники из контекста. Кратко перечисли даты и создай задачи-напоминания, если даты есть.",
  },
  {
    kind: "search_products",
    title: "Подобрать подарок",
    instruction:
      "Подбери подарок по людям и вкусам из контекста и найди реальные товары по запросу и бюджету, если он назван.",
  },
  {
    kind: "search_places",
    title: "Куда сходить",
    instruction: "Найди рестораны и развлечения в сохранённом городе, куда можно сходить.",
  },
  {
    kind: "search_products",
    title: "Найти товар",
    instruction: "Найди товары по моему запросу и параметрам: название, бренд, бюджет если указан.",
  },
  {
    kind: "research",
    title: "Найти в интернете",
    instruction: "Найди в интернете по текущему вопросу и покажи источники из результатов поиска.",
  },
];

export function cityForTimezone(timezone: string | null | undefined, locale?: string | null) {
  return cityForLocale(timezone, locale);
}

export function stripCompanionDirective(text: string) {
  return text.replace(/^сделай сам:\s*/iu, "").trim();
}

export { isTaskCapture, lifeHelpId } from "./life-help.js";

function parsePrice(text: string) {
  const match = text.match(
    /(?:до|не\s+дороже|бюджет(?:ом)?|max(?:imum)?|under|upto|под)\s*(\d(?:[\d\s]{1,8})|\d+)\s*(тыс(?:яч)?|k|к|₽|руб(?:лей)?|rub)?/iu,
  );
  if (!match) return null;
  const amount = Number(String(match[1]).replace(/\s/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "").toLowerCase();
  if (unit.startsWith("тыс") || unit === "k" || unit === "к") return amount * 1000;
  return amount;
}

function parseCity(text: string) {
  const match = text.match(
    /(?:^|[\s,])(?:в|во|near|in)\s+([A-ZА-ЯЁ][\p{L}-]{2,24}(?:[ -][A-ZА-ЯЁ][\p{L}-]{2,24})?)/u,
  );
  return match?.[1] ?? null;
}

function talkSignals(text: string) {
  const raw = stripCompanionDirective(text);
  const webTalk =
    /(?:в\s+интернете|погугли|загугли|поиск в сети|wiki|wikipedia|\bgoogle\b|яндекс|что\s+такое|кто\s+так(?:ой|ая)|новост[иь])/iu.test(
      raw,
    ) || /найд[ийте].*(?:интернет|в сети)/iu.test(raw);
  const placeTalk =
    /ресторан|кафе|бар|куда\s+сходить|развлечен|театр|кино|музей|концерт|клуб|прогулк|выставк/iu.test(
      raw,
    );
  const productTalk =
    /товар|продукт|купи|наушник|телефон|подар|книг|букет|парфюм|косметик|часов|ноутбук|планшет|колонк/iu.test(
      raw,
    );
  const giftTalk = /подар|что\s+подарить|на\s+день\s+рожден/iu.test(raw);
  const remindTalk = /напомн|день\s*рожден|праздник|birthday|important date/iu.test(raw);
  const fxTalk =
    /(?:поменя(?:ть|й|ем)|обмен(?:ять)?)\s+(?:деньг|валют)|обменник|обмен\s+валют|курс(?:ы)?\s+(?:валют|доллар|евро|юан|фунт)|наличн(?:ый|ые|ого)\s+курс|(?:купи(?:ть)?|прода(?:ть|й)|менять|поменять)\s+(?:доллар|евро|юан|фунт|валют)|(?:доллар|евро|юан|фунт|\busd\b|\beur\b|\bgbp\b|\bcny\b).{0,24}(?:руб|rub|обмен)|exchange (?:money|currency|dollars|euros)|currency exchange|bureau de change|cash (?:rate|usd|eur)/iu.test(
      raw,
    );
  const searchVerb =
    /(?:найд[ийте]|подбер[иу]|поищ[иу]|ищу|искать|купить|закаж[иу]|подобрать|подбери)/iu.test(raw);
  const showVerb = /покажи|подскаж[иу]/iu.test(raw);
  return { raw, webTalk, placeTalk, productTalk, giftTalk, remindTalk, fxTalk, searchVerb, showVerb };
}

export function isExplicitDiscoveryRequest(text: string): boolean {
  if (isTaskCapture(stripCompanionDirective(text))) return false;
  const { webTalk, placeTalk, productTalk, giftTalk, fxTalk, searchVerb, showVerb, raw } =
    talkSignals(text);
  return (
    searchVerb ||
    /куда\s+сходить|что\s+подарить|идеи\s+подар/iu.test(raw) ||
    webTalk ||
    (showVerb &&
      (productTalk || placeTalk || giftTalk || webTalk || fxTalk || Boolean(lifeHelpId(raw))))
  );
}

function isFxOffer(offer: CapabilityOffer) {
  return /обменник|выгодн(?:ый|ые|ого)?\s+курс|cash rate|currency exchange|курс.*(?:валют|доллар|евро)|best cash/iu.test(
    `${offer.title} ${offer.instruction}`,
  );
}

export function offerFitsCurrentTask(offer: CapabilityOffer, userText: string): boolean {
  const title = offer.title.trim();
  if (!title) return false;
  if (/^(?:найти|find):/iu.test(title)) return true;
  if (/^(?:подарок|gift|столик|table|проект|project):/iu.test(title)) return true;
  if (title === GOAL_SYNC_OFFER_TITLES.ru || title === GOAL_SYNC_OFFER_TITLES.en) return true;
  const { webTalk, placeTalk, productTalk, giftTalk, remindTalk, fxTalk, raw } =
    talkSignals(userText);
  const helpId = lifeHelpId(raw);
  const offerId = offerLifeId(offer);
  if (offerId) {
    if (offerId === helpId) return true;
    if (offerId === "entertainment" && helpId === "tickets") return true;
    if (offerId === "tickets" && helpId === "entertainment") return true;
    return false;
  }
  const lower = title.toLocaleLowerCase();
  if (isFxOffer(offer)) return fxTalk;
  const genericPlace =
    offer.kind === "search_places" ||
    /куда сходить|забронировать столик|where to go|book a table/iu.test(lower);
  const genericProduct =
    offer.kind === "search_products" ||
    /найти товар|подобрать подарок|find (?:a )?product|pick a gift|купить цветы|buy flowers/iu.test(
      lower,
    );
  const genericWeb = offer.kind === "research" || /найти в интернете|search the web/iu.test(lower);
  const genericRemind =
    offer.kind === "remind" || /напомнить о праздник|remind.*holiday/iu.test(lower);
  if (genericPlace) return !helpId && (placeTalk || giftTalk);
  if (genericProduct) return !helpId && (productTalk || giftTalk);
  if (genericWeb) return webTalk && !helpId;
  if (genericRemind) return remindTalk;
  return true;
}

function fxIntent(
  query: string,
  city: string,
  maxPrice: number | null,
): DiscoveryIntent {
  return {
    type: "fx",
    query: query || "обмен валют",
    city,
    maxPrice,
    minPrice: null,
    brand: null,
    category: null,
    placeKind: "place",
  };
}

export function inferDiscoveryIntent(text: string, defaultCity = "Москва"): DiscoveryIntent | null {
  const { raw, webTalk, placeTalk, productTalk, giftTalk, fxTalk } = talkSignals(text);
  if (raw.length < 4 || raw.length > 400) return null;
  const wantsSearch = isExplicitDiscoveryRequest(text);
  const rule = lifeHelpRule(raw);
  if (!wantsSearch && !placeTalk && !giftTalk && !fxTalk && !rule && !productTalk) return null;
  if (
    /мне\s+плохо|тревог|грустн|депресс|не\s+могу\s+спать|расстро/iu.test(raw) &&
    !wantsSearch &&
    !placeTalk &&
    !rule
  ) {
    return null;
  }
  const city = parseCity(raw) ?? defaultCity;
  const maxPrice = parsePrice(raw);
  const query = distillLifeQuery(raw) || raw;
  if (rule) {
    return {
      type: rule.type,
      query,
      city,
      maxPrice,
      minPrice: null,
      brand: null,
      category: rule.category,
      placeKind: rule.placeKind,
    };
  }
  if (fxTalk) return fxIntent(query || raw, city, maxPrice);
  if (giftTalk && (placeTalk || /идеи|куда/iu.test(raw))) {
    return {
      type: "gifts",
      query: query || raw,
      city,
      maxPrice,
      minPrice: null,
      brand: null,
      category: null,
      placeKind: "place",
    };
  }
  if (placeTalk) {
    const placeKind: PlaceKind = /театр|кино|музей|концерт|развлечен|клуб|выставк/iu.test(raw)
      ? "entertainment"
      : /ресторан|кафе|бар|ужин|обед/iu.test(raw)
        ? "restaurant"
        : "place";
    return {
      type: "places",
      query: query || raw,
      city,
      maxPrice,
      minPrice: null,
      brand: null,
      category: null,
      placeKind,
    };
  }
  if (giftTalk) {
    return {
      type: "gifts",
      query: query || raw,
      city,
      maxPrice,
      minPrice: null,
      brand: null,
      category: null,
      placeKind: "place",
    };
  }
  if (webTalk && !productTalk) {
    return {
      type: "web",
      query: query || raw,
      city,
      maxPrice,
      minPrice: null,
      brand: null,
      category: null,
      placeKind: "place",
    };
  }
  if (wantsSearch || productTalk) {
    return {
      type: "products",
      query: query || raw,
      city,
      maxPrice,
      minPrice: null,
      brand: null,
      category: "buy",
      placeKind: "place",
    };
  }
  return null;
}

export function intentFromSearchAction(
  action: {
    type: DiscoveryKind;
    query: string;
    city?: string | null;
    max_price?: number | null;
    min_price?: number | null;
    brand?: string | null;
    category?: string | null;
  },
  defaultCity: string,
): DiscoveryIntent | null {
  const query = action.query.trim();
  if (!query) return null;
  if (action.type === "fx" || talkSignals(query).fxTalk) {
    return fxIntent(query, action.city?.trim() || defaultCity, action.max_price ?? null);
  }
  const rule = lifeHelpRule(query);
  return {
    type: rule?.type ?? action.type,
    query,
    city: action.city?.trim() || defaultCity,
    maxPrice: action.max_price ?? null,
    minPrice: action.min_price ?? null,
    brand: action.brand?.trim() || null,
    category: rule?.category || action.category?.trim() || null,
    placeKind:
      rule?.placeKind ??
      (action.type === "places"
        ? /театр|кино|музей|концерт|развлечен/iu.test(query)
          ? "entertainment"
          : /ресторан|кафе|бар/iu.test(query)
            ? "restaurant"
            : "place"
        : "place"),
  };
}

const SHORT_QUERY_MAX = 60;

function containsDigits(text: string) {
  return /\d/.test(text);
}

const FX_CODE_PATTERNS: { code: string; pattern: RegExp }[] = [
  { code: "USD", pattern: /доллар|\busd\b|бакс/iu },
  { code: "EUR", pattern: /евро|\beur\b/iu },
  { code: "CNY", pattern: /юан|\bcny\b|yuan/iu },
  { code: "GBP", pattern: /фунт|\bgbp\b/iu },
];

function fxCodesFrom(text: string): string[] {
  const codes = FX_CODE_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => item.code);
  return codes.length ? [...new Set(codes)] : ["USD", "EUR"];
}

function currencyExchangeOffer(intent: DiscoveryIntent, locale?: string | null): CapabilityOffer {
  const ru = languageOf(locale) !== "en";
  const city = intent.city?.trim() || "";
  const codes = fxCodesFrom(intent.query);
  const pair = codes.join(", ");
  const title = (
    ru
      ? city
        ? `Выгодный курс · ${city}`
        : "Выгодный курс рядом"
      : city
        ? `Best cash rates · ${city}`
        : "Best cash rates nearby"
  ).slice(0, 120);
  const instruction = (
    ru
      ? `Найди обменники рядом с выгодным курсом${city ? ` в ${city}` : ""}: живые наличные курсы ${pair} к рублю, сравнение пунктов и адреса рядом. Не выдумывай курсы и адреса — только из результатов поиска.`
      : `Find nearby currency exchangers with the best live cash ${pair} rates${city ? ` in ${city}` : ""}. Compare offices and list nearby addresses. Do not invent rates or addresses — only from search results.`
  ).slice(0, 800);
  return { kind: "search_places", title, instruction };
}

export function discoverySearchOffer(
  intent: DiscoveryIntent,
  locale?: string | null,
): CapabilityOffer {
  const scenario = intent.type === "fx" ? "fx" : intent.category;
  if (isLifeHelpId(scenario) && scenario !== "buy") {
    return lifeHelpOffer(scenario, intent, locale);
  }
  if (intent.type === "fx") return currencyExchangeOffer(intent, locale);
  const ru = languageOf(locale) !== "en";
  const kind: OfferKind = intent.type === "places" ? "search_places" : "search_products";
  const rawQuery = intent.query.trim() || (ru ? "это" : "this");
  // A distilled phrase ("наушники sony") is worth decorating with city/price.
  // A long raw sentence, or one that already mentions a number or the city
  // itself, most likely carries that context already — appending city/price
  // again would just repeat it back awkwardly.
  const queryHasCity = Boolean(intent.city) && rawQuery.toLocaleLowerCase().includes(intent.city!.toLocaleLowerCase());
  const queryHasPrice = intent.maxPrice != null && containsDigits(rawQuery);
  const isShortQuery = rawQuery.length <= SHORT_QUERY_MAX;
  const priceBit =
    isShortQuery && !queryHasPrice && intent.maxPrice != null
      ? ru
        ? ` до ${formatMoney(intent.maxPrice, locale)}`
        : ` under ${formatMoney(intent.maxPrice, locale)}`
      : "";
  const cityBit =
    isShortQuery && !queryHasCity && intent.city ? (ru ? ` в ${intent.city}` : ` in ${intent.city}`) : "";
  const query = isShortQuery ? rawQuery : rawQuery.slice(0, SHORT_QUERY_MAX).trim();
  const ellipsis = isShortQuery ? "" : "…";
  const title = (
    ru ? `Найти: ${query}${ellipsis}${cityBit}${priceBit}` : `Find: ${query}${ellipsis}${cityBit}${priceBit}`
  ).slice(0, 120);
  const instruction = (
    ru ? `Найди ${rawQuery}${cityBit}${priceBit}` : `Find ${rawQuery}${cityBit}${priceBit}`
  ).slice(0, 800);
  return { kind, title, instruction };
}

function nextOccurrence(month: number, day: number, timezone: string, now: Date) {
  const year = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric" }).format(now),
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  let date = `${year}-${pad(month)}-${pad(day)}`;
  if (date < today) date = `${year + 1}-${pad(month)}-${pad(day)}`;
  const days = Math.round(
    (Date.parse(`${date}T12:00:00.000Z`) - Date.parse(`${today}T12:00:00.000Z`)) / 86_400_000,
  );
  return { date, days_until: days };
}

function parseMonthDay(value: string): { month: number; day: number } | null {
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { month: Number(iso[2]), day: Number(iso[3]) };
  const numbered = value.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (numbered) {
    const day = Number(numbered[1]);
    const month = Number(numbered[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
  }
  for (const [pattern, month] of MONTHS) {
    const match = value.match(new RegExp(`(\\d{1,2})\\s*${pattern.source}`, "iu"));
    if (match) {
      const day = Number(match[1]);
      if (day >= 1 && day <= 31) return { month, day };
    }
  }
  return null;
}

export function upcomingImportantDates(
  people: {
    id?: string;
    name: string;
    is_self?: boolean;
    relationship?: string | null;
    memories: Pick<Memory, "category" | "content" | "occurred_at" | "status">[];
    dates?: { kind: string; label?: string | null; month: number; day: number; year?: number | null }[];
  }[],
  timezone = "Europe/Moscow",
  now = new Date(),
  withinDays = 45,
  extras: { experiences?: Experience[] } = {},
): UpcomingDate[] {
  const found: UpcomingDate[] = [];
  for (const person of people) {
    const seenDays = new Set<string>();
    const gender = inferPersonGender({ name: person.name, relationship: person.relationship });
    const gift_history = person.is_self
      ? []
      : collectGiftHistory(person.memories, extras.experiences, person.id);
    const tastes = person.is_self ? [] : collectTastes(person.memories);
    const relationship = person.is_self ? null : person.relationship ?? null;
    const personId = person.is_self ? null : person.id ?? null;
    const who = person.is_self ? null : person.name;
    for (const date of person.dates ?? []) {
      const next = nextOccurrence(date.month, date.day, timezone, now);
      if (next.days_until > withinDays) continue;
      const key = `${date.month}-${date.day}`;
      seenDays.add(key);
      found.push({
        person: who,
        person_id: personId,
        relationship,
        gender: who ? gender : "unknown",
        label: personDateLabel(date),
        date: next.date,
        days_until: next.days_until,
        kind: date.kind === "birthday" ? "birthday" : "date",
        gift_history,
        tastes,
      });
    }
    for (const memory of person.memories) {
      if (memory.status && memory.status !== "active") continue;
      if (memory.category !== "important_date" && memory.category !== "important_event") continue;
      const parsed = parseMonthDay(memory.occurred_at ?? "") ?? parseMonthDay(memory.content);
      if (!parsed) continue;
      if (seenDays.has(`${parsed.month}-${parsed.day}`)) continue;
      const next = nextOccurrence(parsed.month, parsed.day, timezone, now);
      if (next.days_until > withinDays) continue;
      found.push({
        person: who,
        person_id: personId,
        relationship,
        gender: who ? gender : "unknown",
        label: memory.content,
        date: next.date,
        days_until: next.days_until,
        kind: /рожден|birthday/iu.test(memory.content) ? "birthday" : "date",
        gift_history,
        tastes,
      });
    }
  }
  for (const holiday of HOLIDAYS) {
    const next = nextOccurrence(holiday.month, holiday.day, timezone, now);
    if (next.days_until > withinDays) continue;
    found.push({
      person: null,
      label: holiday.label,
      date: next.date,
      days_until: next.days_until,
      kind: "holiday",
    });
  }
  found.sort((a, b) => a.days_until - b.days_until || a.label.localeCompare(b.label));
  const seen = new Set<string>();
  return found
    .filter((item) => {
      const key = `${item.date}:${item.person ?? ""}:${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function reminderTasksFromDates(dates: UpcomingDate[]): ReminderTaskAction[] {
  return dates.slice(0, 5).map((item) => ({
    op: "create" as const,
    task_id: null,
    title: item.person
      ? `${item.kind === "birthday" ? "День рождения" : item.label}: ${item.person}`
      : `Напомнить: ${item.label}`,
    due_at: item.date,
    goal_id: null,
    project_id: null,
    kind: "task" as const,
    importance: null,
    urgency: null,
    assignee: "user" as const,
  }));
}

export function inferBirthdayReminders(text: string, dates: UpcomingDate[]): ReminderTaskAction[] {
  const raw = stripCompanionDirective(text);
  const wants =
    /напомн/iu.test(raw) ||
    /создай(?:те)?\s+задач/iu.test(raw) ||
    /сделай сам:.*(?:напомн|дням? рожден|праздник)/iu.test(text);
  if (!wants || !dates.length) return [];
  if (!/день\s*рожден|праздник|important date|birthday|напомн/iu.test(raw)) return [];
  return reminderTasksFromDates(dates);
}

function isLightTurn(text: string) {
  const raw = stripCompanionDirective(text);
  if (isTaskCapture(raw)) return false;
  if (raw.length > 180) return false;
  if (/(?:мне\s+плохо|тревог|грустн|депресс|ненавиж|устал[ао]?)/iu.test(raw)) return false;
  return (
    /^(?:привет|здравствуй|хай|hello|hi|что\s+умеешь|чем\s+можешь|help|помоги)\b/iu.test(raw) ||
    raw.length < 48
  );
}

function contextualHelpOffers(
  text: string,
  city: string,
  locale?: string | null,
): CapabilityOffer[] {
  const intent = inferDiscoveryIntent(text, city);
  if (!intent) return [];
  return [discoverySearchOffer(intent, locale)];
}

function dedupeOffers(offers: CapabilityOffer[]) {
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = offer.title.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeCapabilityOffers(
  offers: CapabilityOffer[],
  input: {
    userText: string;
    upcomingDates: UpcomingDate[];
    recentOfferTitles: string[];
    didSearch: boolean;
    locale?: string | null;
    goalSyncDue?: boolean;
    selfGender?: PersonGender;
    city?: string | null;
    canDraftMail?: boolean;
  },
): CapabilityOffer[] {
  const city = input.city?.trim() || parseCity(input.userText) || "Москва";
  const existing = dedupeOffers([
    ...(input.didSearch ? [] : contextualHelpOffers(input.userText, city, input.locale)),
    ...offers,
    ...(input.canDraftMail && isMailTalk(input.userText) ? [mailReplyOffer(input.locale)] : []),
  ])
    .filter((offer) => offer.title.trim() && offerFitsCurrentTask(offer, input.userText))
    .slice(0, 3);
  if (input.didSearch) return existing.slice(0, 3);
  const recent = new Set(input.recentOfferTitles.map((title) => title.toLocaleLowerCase()));
  const unused = CAPABILITY_HINTS.filter((hint) => !recent.has(hint.title.toLocaleLowerCase()));
  const capabilityQuestion =
    /что\s+умеешь|чем\s+можешь|что\s+ты\s+можешь|что\s+ещё|what can you/iu.test(input.userText);
  const picked: CapabilityOffer[] = [];
  const sync = goalSyncOffer(input.locale);
  const canSync =
    Boolean(input.goalSyncDue) &&
    isLightTurn(input.userText) &&
    !recent.has(sync.title.toLocaleLowerCase()) &&
    !existing.some((item) => item.title === sync.title);
  if (capabilityQuestion) {
    if (canSync) picked.push(sync);
    picked.push(...unused.slice(0, 3 - picked.length));
  } else if (isLightTurn(input.userText)) {
    const prep = datePrepOffers(input.upcomingDates, input.locale, input.selfGender).filter(
      (offer) => !recent.has(offer.title.toLocaleLowerCase()),
    );
    picked.push(...prep.slice(0, 3));
    if (canSync && picked.length < 3) picked.push(sync);
  }
  const merged = [...existing];
  for (const hint of picked) {
    if (merged.some((item) => item.title === hint.title)) continue;
    merged.push(hint);
  }
  if (!capabilityQuestion) {
    for (const hint of unused) {
      if (merged.length >= 3) break;
      if (merged.some((item) => item.title === hint.title || item.kind === hint.kind)) continue;
      if (!offerFitsCurrentTask(hint, input.userText)) continue;
      merged.push(hint);
    }
  }
  return merged.slice(0, 3);
}

export function formatSearchResults(hits: DiscoveryHit[], locale?: string | null) {
  if (!hits.length) return "";
  const heading = languageOf(locale) === "en" ? "Here's what I found:" : "Вот что нашлось:";
  return [
    heading,
    ...hits.map((hit) => {
      const extra = [hit.subtitle, hit.price].filter(Boolean).join(" · ");
      return `• ${hit.title}${extra ? ` — ${extra}` : ""}\n  ${hit.url}`;
    }),
  ].join("\n");
}

export function attachSearchAnswer(answer: string, hits: DiscoveryHit[], locale?: string | null) {
  if (!hits.length) return answer;
  const block = formatSearchResults(hits, locale);
  if (hits.some((hit) => answer.includes(hit.url))) return answer;
  return `${answer.trim()}\n\n${block}`;
}

function marketplaceHits(
  query: string,
  maxPrice: number | null,
  locale?: string | null,
): DiscoveryHit[] {
  const text = encodeURIComponent(query);
  const price = maxPrice ? `&priceto=${Math.round(maxPrice)}` : "";
  const en = languageOf(locale) === "en";
  const money = maxPrice ? formatMoney(maxPrice, locale) : null;
  const priceLabel = money
    ? en
      ? `up to ${money}`
      : `до ${money}`
    : en
      ? "live search"
      : "живой поиск по запросу";
  return [
    {
      kind: "shop",
      title: `Яндекс Маркет: ${query}`,
      subtitle: priceLabel,
      url: `https://market.yandex.ru/search?text=${text}${price}`,
      price: money,
      source: "Яндекс Маркет",
    },
    {
      kind: "shop",
      title: `Google Shopping: ${query}`,
      subtitle: priceLabel,
      url: `https://www.google.com/search?tbm=shop&q=${text}${maxPrice ? `+до+${Math.round(maxPrice)}` : ""}`,
      price: null,
      source: "Google Shopping",
    },
    {
      kind: "shop",
      title: `Avito: ${query}`,
      subtitle: en ? "listings for this query" : "объявления по запросу",
      url: `https://www.avito.ru/all?q=${text}`,
      price: null,
      source: "Avito",
    },
  ];
}

async function fetchJson(fetchImpl: FetchLike, url: string, timeout = FETCH_MS): Promise<unknown> {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal,
  });
  if (!response.ok) return null;
  return response.json();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function productQuery(intent: DiscoveryIntent) {
  return [intent.brand, intent.category, intent.query].filter(Boolean).join(" ").trim();
}

// В карточку маркетплейса уходил текст просьбы целиком — «Яндекс Маркет:
// Что подарить маме на день рождения?». Оставляем предмет поиска, а не вопрос.
export function shoppingQuery(query: string) {
  const cleaned = query
    .trim()
    .replace(/[?!.]+$/u, "")
    .replace(/^(?:да|ок|окей|хорошо|давай)[,\s]+/iu, "")
    .replace(/^(?:что\s+)?(?:по|пре)?дарить\s+/iu, "подарок ")
    .replace(
      /^(?:подбери(?:те)?|найди(?:те)?|посоветуй(?:те)?|помоги\s+выбрать|выбери|покажи|хочу\s+купить|нужно\s+купить|где\s+купить|идеи\s+(?:для|на))\s+(?:мне\s+)?/iu,
      "",
    )
    .replace(/^(?:find|suggest|show|recommend|where\s+to\s+buy|ideas\s+for)\s+(?:me\s+)?/iu, "")
    .trim();
  return cleaned || query.trim();
}

/**
 * «Что подарить Ире?» — вопрос-совет, а не просьба найти товар. Поиск по самому
 * вопросу («подарок Ире на день рождения» на маркетплейсе) ничего не даёт, поэтому
 * здесь карточки появляются только из search_actions: Илзи сама решает, что стоит
 * за идеей — место, вещь или сертификат. «Найди ему подарок» сюда не относится.
 */
export function isGiftAdviceQuestion(text: string): boolean {
  const { giftTalk, searchVerb } = talkSignals(text);
  return giftTalk && !searchVerb;
}

/**
 * Карточки под ответом о подарке по решению модели: место → карты (рестораны,
 * студии — там, где человек живёт), вещь → маркетплейс по названию вещи.
 * Ссылки-поиски, без сетевых запросов: ответ не ждёт каталогов.
 */
export function giftActionHits(
  actions: { type: DiscoveryKind; query: string; city?: string | null; max_price?: number | null }[],
  defaultCity: string | null,
  locale?: string | null,
): DiscoveryHit[] {
  const hits: DiscoveryHit[] = [];
  for (const action of actions.slice(0, 2)) {
    const query = action.query.trim();
    if (!query) continue;
    if (action.type === "places") {
      const city = action.city?.trim() || defaultCity || "";
      const where =
        city && !query.toLocaleLowerCase().includes(city.toLocaleLowerCase())
          ? `${query} ${city}`
          : query;
      hits.push(...mapsHits(where, locale));
    } else if (action.type === "products" || action.type === "gifts") {
      const shop = marketplaceHits(shoppingQuery(query), action.max_price ?? null, locale)[0];
      if (shop) hits.push(shop);
    }
  }
  return hits;
}

function placeQuery(intent: DiscoveryIntent) {
  const city = intent.city || "Москва";
  if (intent.placeKind === "place" && /куда\s+сходить|развлечен/iu.test(intent.query)) {
    return `ресторан кафе кино театр ${city}`;
  }
  if (intent.placeKind === "restaurant" && !/ресторан|кафе|бар/iu.test(intent.query)) {
    return `ресторан ${intent.query} ${city}`.trim();
  }
  if (
    intent.placeKind === "entertainment" &&
    !/театр|кино|музей|концерт|парк/iu.test(intent.query)
  ) {
    return `${intent.query} развлечения ${city}`.trim();
  }
  return /москв|питер|санкт|город|city/iu.test(intent.query)
    ? intent.query
    : `${intent.query} ${city}`.trim();
}

function notNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

export async function searchPlaces(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveryHit[]> {
  const q = encodeURIComponent(placeQuery(intent));
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${q}&addressdetails=1&limit=6&accept-language=${languageOf(intent.locale)}`;
  try {
    const payload = await fetchJson(fetchImpl, url);
    if (!Array.isArray(payload)) return [];
    return payload
      .map((item) => {
        const row = asRecord(item);
        if (!row) return null;
        const title = textOf(row.name) || textOf(row.display_name).split(",")[0] || "";
        const display = textOf(row.display_name);
        if (!title || !display) return null;
        const osmType = textOf(row.osm_type) || "node";
        const osmId = textOf(row.osm_id);
        const kind = textOf(row.type) || textOf(row.addresstype) || "place";
        return {
          kind: "place" as const,
          title,
          subtitle: `${kind} · ${display}`,
          url: osmId
            ? `https://www.openstreetmap.org/${osmType}/${osmId}`
            : `https://yandex.ru/maps/?text=${encodeURIComponent(display)}`,
          price: null,
          source: "OpenStreetMap",
        };
      })
      .filter(notNull)
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function searchBooks(
  query: string,
  fetchImpl: FetchLike,
  locale?: string | null,
): Promise<DiscoveryHit[]> {
  const lang = languageOf(locale);
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=4&langRestrict=${lang}`;
  const payload = asRecord(await fetchJson(fetchImpl, url));
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => {
      const row = asRecord(item);
      const info = asRecord(row?.volumeInfo);
      const sale = asRecord(row?.saleInfo);
      const title = textOf(info?.title);
      if (!title) return null;
      const authors = Array.isArray(info?.authors)
        ? info.authors.filter((value) => typeof value === "string").join(", ")
        : "";
      const price = asRecord(sale?.listPrice);
      const amount = typeof price?.amount === "number" ? formatMoney(price.amount, locale) : null;
      const link =
        textOf(sale?.buyLink) || textOf(info?.infoLink) || textOf(info?.canonicalVolumeLink);
      if (!link) return null;
      return {
        kind: "product" as const,
        title,
        subtitle: authors
          ? `${languageOf(locale) === "en" ? "book" : "книга"} · ${authors}`
          : languageOf(locale) === "en"
            ? "book"
            : "книга",
        url: link,
        price: amount,
        source: "Google Books",
      };
    })
    .filter(notNull);
}

async function searchOpenFacts(
  host: string,
  query: string,
  fetchImpl: FetchLike,
  source: string,
): Promise<DiscoveryHit[]> {
  const url = `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=4`;
  const payload = asRecord(await fetchJson(fetchImpl, url));
  const products = Array.isArray(payload?.products) ? payload.products : [];
  return products
    .map((item) => {
      const row = asRecord(item);
      const title = textOf(row?.product_name) || textOf(row?.generic_name);
      const code = textOf(row?.code);
      if (!title || !code) return null;
      const brands = textOf(row?.brands);
      return {
        kind: "product" as const,
        title,
        subtitle: brands || source,
        url: `https://${host}/product/${code}`,
        price: null,
        source,
      };
    })
    .filter(notNull);
}

async function searchItunes(query: string, fetchImpl: FetchLike): Promise<DiscoveryHit[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=ru&limit=4`;
  const payload = asRecord(await fetchJson(fetchImpl, url));
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .map((item) => {
      const row = asRecord(item);
      const title = textOf(row?.trackName) || textOf(row?.collectionName);
      const link = textOf(row?.trackViewUrl) || textOf(row?.collectionViewUrl);
      if (!title || !link) return null;
      const artist = textOf(row?.artistName);
      return {
        kind: "product" as const,
        title,
        subtitle: artist
          ? `${textOf(row?.kind) || "media"} · ${artist}`
          : textOf(row?.kind) || "media",
        url: link,
        price: null,
        source: "iTunes",
      };
    })
    .filter(notNull);
}

// Раньше сырой текст запроса уходил веером во все четыре каталога сразу.
// На «что подарить маме на день рождения» iTunes закономерно отвечал песнями
// «С днём рождения, мама!», а Open Food Facts — штрихкодами продуктов: карточки
// появлялись ровно в тот момент, ради которого человек и пришёл, и обесценивали
// нормальный ответ. Теперь каждый каталог спрашиваем, только если запрос
// действительно про его предметную область. Если предметной области нет —
// показываем живой поиск по маркетплейсам и ничего не выдумываем.
const CATALOG_TOPICS: { source: "books" | "food" | "beauty" | "music"; test: RegExp }[] = [
  {
    source: "books",
    test: /книг|книж|почитат|издани|романа?(?!\p{L})|учебник|комикс|book|novel|reading/iu,
  },
  {
    source: "music",
    test: /музык|песн|альбом|плейлист|саундтрек|винил|подкаст|music|song|album|soundtrack|vinyl|podcast/iu,
  },
  {
    source: "food",
    test: /ед[ауы](?!\p{L})|продукт|снек|сладост|шокола|конфет|чай(?!\p{L})|кофе(?!\p{L})|food|snack|tea|coffee|chocolate|candy/iu,
  },
  {
    source: "beauty",
    test: /космет|крем(?!\p{L})|уход за|парфюм|духи|шампун|бальзам|beauty|cosmetic|perfume|skincare|shampoo/iu,
  },
];

export function catalogTopicsFor(intent: {
  query: string;
  category?: string | null;
  brand?: string | null;
}) {
  const text = [intent.brand, intent.category, intent.query].filter(Boolean).join(" ");
  return CATALOG_TOPICS.filter((topic) => topic.test.test(text)).map((topic) => topic.source);
}

export async function searchProducts(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveryHit[]> {
  const query = productQuery(intent);
  const topics = new Set(catalogTopicsFor(intent));
  const lookups: Promise<DiscoveryHit[]>[] = [];
  if (topics.has("books")) lookups.push(searchBooks(query, fetchImpl, intent.locale));
  if (topics.has("food"))
    lookups.push(searchOpenFacts("world.openfoodfacts.org", query, fetchImpl, "Open Food Facts"));
  if (topics.has("beauty"))
    lookups.push(
      searchOpenFacts("world.openbeautyfacts.org", query, fetchImpl, "Open Beauty Facts"),
    );
  if (topics.has("music")) lookups.push(searchItunes(query, fetchImpl));
  const catalog = lookups.length
    ? (await Promise.allSettled(lookups)).flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      )
    : [];
  const unique: DiscoveryHit[] = [];
  const seen = new Set<string>();
  for (const hit of [
    ...catalog,
    ...marketplaceHits(shoppingQuery(query), intent.maxPrice, intent.locale),
  ]) {
    const key = hit.url;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return unique.slice(0, 8);
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchText(fetchImpl: FetchLike, url: string, timeout = FETCH_MS) {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetchImpl(url, {
    headers: { accept: "*/*", "user-agent": USER_AGENT },
    signal,
  });
  if (!response.ok) return "";
  if (typeof response.text === "function") return response.text();
  try {
    return JSON.stringify(await response.json());
  } catch {
    return "";
  }
}

async function searchWikipedia(
  query: string,
  fetchImpl: FetchLike,
  locale?: string | null,
): Promise<DiscoveryHit[]> {
  const host = languageOf(locale) === "en" ? "en.wikipedia.org" : "ru.wikipedia.org";
  const url = `https://${host}/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=4&namespace=0&format=json`;
  const payload = await fetchJson(fetchImpl, url);
  if (!Array.isArray(payload) || payload.length < 4) return [];
  const titles = Array.isArray(payload[1]) ? payload[1] : [];
  const descs = Array.isArray(payload[2]) ? payload[2] : [];
  const urls = Array.isArray(payload[3]) ? payload[3] : [];
  return titles
    .map((title, index) => {
      const name = textOf(title);
      const link = textOf(urls[index]);
      if (!name || !link) return null;
      return {
        kind: "web" as const,
        title: name,
        subtitle: textOf(descs[index]) || "Wikipedia",
        url: link,
        price: null,
        source: "Wikipedia",
      };
    })
    .filter(notNull);
}

async function searchDuckDuckGo(query: string, fetchImpl: FetchLike): Promise<DiscoveryHit[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const payload = asRecord(await fetchJson(fetchImpl, url));
  if (!payload) return [];
  const hits: DiscoveryHit[] = [];
  const heading = textOf(payload.Heading);
  const abstractUrl = textOf(payload.AbstractURL);
  const abstract = textOf(payload.AbstractText);
  if (heading && abstractUrl) {
    hits.push({
      kind: "web",
      title: heading,
      subtitle: abstract.slice(0, 180) || "DuckDuckGo",
      url: abstractUrl,
      price: null,
      source: "DuckDuckGo",
    });
  }
  const related = Array.isArray(payload.RelatedTopics) ? payload.RelatedTopics : [];
  const flatten = (items: unknown[]): unknown[] =>
    items.flatMap((item) => {
      const row = asRecord(item);
      if (!row) return [];
      return Array.isArray(row.Topics) ? row.Topics : [row];
    });
  for (const item of flatten(related).slice(0, 4)) {
    const row = asRecord(item);
    const text = textOf(row?.Text);
    const link = textOf(row?.FirstURL);
    if (!text || !link) continue;
    hits.push({
      kind: "web",
      title: text.split(" - ")[0]!.slice(0, 120),
      subtitle: text.slice(0, 180),
      url: link,
      price: null,
      source: "DuckDuckGo",
    });
  }
  return hits;
}

async function searchGoogleNews(query: string, fetchImpl: FetchLike): Promise<DiscoveryHit[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ru&gl=RU&ceid=RU:ru`;
  const xml = await fetchText(fetchImpl, url);
  if (!xml) return [];
  const items: DiscoveryHit[] = [];
  for (const block of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const chunk = block[1] ?? "";
    const title = decodeXml(
      chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ??
        chunk.match(/<title>([^<]+)<\/title>/i)?.[1] ??
        "",
    );
    const link = decodeXml(chunk.match(/<link>([^<]+)<\/link>/i)?.[1] ?? "");
    if (!title || !link) continue;
    items.push({
      kind: "web",
      title: title.slice(0, 160),
      subtitle: "новости",
      url: link,
      price: null,
      source: "Google News",
    });
    if (items.length >= 3) break;
  }
  return items;
}

export async function searchWeb(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveryHit[]> {
  const query = intent.query.trim();
  const en = languageOf(intent.locale) === "en";
  const [wiki, ddg, news] = await Promise.allSettled([
    searchWikipedia(query, fetchImpl, intent.locale),
    searchDuckDuckGo(query, fetchImpl),
    searchGoogleNews(query, fetchImpl),
  ]);
  const engines: DiscoveryHit[] = [
    {
      kind: "web",
      title: `Яндекс: ${query}`,
      subtitle: en ? "web search" : "поиск в интернете",
      url: `https://yandex.ru/search/?text=${encodeURIComponent(query)}`,
      price: null,
      source: "Яндекс",
    },
    {
      kind: "web",
      title: `Google: ${query}`,
      subtitle: en ? "web search" : "поиск в интернете",
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      price: null,
      source: "Google",
    },
  ];
  const unique: DiscoveryHit[] = [];
  const seen = new Set<string>();
  for (const hit of [
    ...(wiki.status === "fulfilled" ? wiki.value : []),
    ...(ddg.status === "fulfilled" ? ddg.value : []),
    ...(news.status === "fulfilled" ? news.value : []),
    ...engines,
  ]) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    unique.push(hit);
  }
  return unique.slice(0, 8);
}

const CITY_SLUGS: Record<string, string> = {
  москва: "moskva",
  москве: "moskva",
  москвы: "moskva",
  "санкт-петербург": "sankt-peterburg",
  "санкт петербург": "sankt-peterburg",
  петербург: "sankt-peterburg",
  петербурге: "sankt-peterburg",
  питер: "sankt-peterburg",
  спб: "sankt-peterburg",
  казань: "kazan",
  казани: "kazan",
  новосибирск: "novosibirsk",
  новосибирске: "novosibirsk",
  екатеринбург: "ekaterinburg",
  екатеринбурге: "ekaterinburg",
  "нижний новгород": "nizhniy_novgorod",
  самара: "samara",
  самаре: "samara",
};

function citySlug(city: string) {
  const key = city
    .trim()
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,]/g, "");
  return CITY_SLUGS[key] || key.replace(/\s+/g, "_");
}

function formatFxRate(value: number, locale?: string | null) {
  return `${new Intl.NumberFormat(bcp47(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ₽`;
}

function parseRate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const amount = Number(value.replace(",", ".").replace(/[^\d.]/g, ""));
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}

function parseBankiCashRates(html: string): { buy: number; sell: number } | null {
  const buy =
    parseRate(html.match(/"buy"\s*:\s*"?(\d+[.,]\d{1,4})"?/i)?.[1]) ??
    parseRate(html.match(/покупк[аеи]\s*(?:<\/?\w+[^>]*>|\s|:)*(\d+[.,]\d{2})/iu)?.[1]);
  const sell =
    parseRate(html.match(/"sell"\s*:\s*"?(\d+[.,]\d{1,4})"?/i)?.[1]) ??
    parseRate(html.match(/продаж[аи]\s*(?:<\/?\w+[^>]*>|\s|:)*(\d+[.,]\d{2})/iu)?.[1]);
  if (buy == null || sell == null || buy > 500 || sell > 500) return null;
  return { buy, sell };
}

async function readJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const parsed = await fetchJson(fetchImpl, url);
  if (parsed != null) return parsed;
  const text = await fetchText(fetchImpl, url);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function cbrRates(
  codes: string[],
  fetchImpl: FetchLike,
): Promise<{ code: string; value: number }[]> {
  const payload = asRecord(await readJson(fetchImpl, "https://www.cbr-xml-daily.ru/daily_json.js"));
  const valute = asRecord(payload?.Valute);
  if (!valute) return [];
  return codes.flatMap((code) => {
    const row = asRecord(valute[code]);
    const value = parseRate(row?.Value);
    const nominal = parseRate(row?.Nominal) ?? 1;
    return value != null ? [{ code, value: value / nominal }] : [];
  });
}

async function marketRates(
  codes: string[],
  fetchImpl: FetchLike,
): Promise<{ code: string; value: number }[]> {
  const payload = asRecord(await fetchJson(fetchImpl, "https://open.er-api.com/v6/latest/USD"));
  const rates = asRecord(payload?.rates) ?? asRecord(payload?.Rates);
  const usdRub = parseRate(rates?.RUB);
  if (usdRub == null) return [];
  const out: { code: string; value: number }[] = [];
  if (codes.includes("USD")) out.push({ code: "USD", value: usdRub });
  for (const code of codes) {
    if (code === "USD") continue;
    const perUsd = parseRate(rates?.[code]);
    if (perUsd != null && perUsd > 0) out.push({ code, value: usdRub / perUsd });
  }
  return out;
}

export async function searchCurrencyExchange(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveryHit[]> {
  const ru = languageOf(intent.locale) !== "en";
  const city = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const codes = fxCodesFrom(intent.query);
  const slug = citySlug(city);
  const [official, market, cashPages, offices] = await Promise.all([
    cbrRates(codes, fetchImpl).catch(() => []),
    marketRates(codes, fetchImpl).catch(() => []),
    Promise.all(
      codes.map(async (code) => {
        const url = `https://www.banki.ru/products/currency/cash/${code.toLowerCase()}/${slug}/`;
        const html = await fetchText(fetchImpl, url).catch(() => "");
        return { code, url, rates: html ? parseBankiCashRates(html) : null };
      }),
    ),
    searchPlaces(
      {
        ...intent,
        type: "places",
        placeKind: "place",
        query: ru ? `обмен валют ${city}` : `currency exchange ${city}`,
      },
      fetchImpl,
    ).catch(() => [] as DiscoveryHit[]),
  ]);
  const hits: DiscoveryHit[] = [];
  const officialByCode = new Map(official.map((item) => [item.code, item.value]));
  const marketByCode = new Map(market.map((item) => [item.code, item.value]));
  if (official.length) {
    hits.push({
      kind: "web",
      title: ru
        ? `ЦБ: ${official.map((item) => `${item.code} ${formatFxRate(item.value, intent.locale)}`).join(" · ")}`
        : `CBR: ${official.map((item) => `${item.code} ${formatFxRate(item.value, intent.locale)}`).join(" · ")}`,
      subtitle: ru ? "официальный курс на сегодня" : "official rate today",
      url: "https://www.cbr.ru/currency_base/daily/",
      price: formatFxRate(official[0]!.value, intent.locale),
      source: ru ? "ЦБ РФ" : "CBR",
    });
  }
  for (const page of cashPages) {
    const cash = page.rates;
    const baseline = officialByCode.get(page.code) ?? marketByCode.get(page.code);
    hits.push({
      kind: "web",
      title: cash
        ? ru
          ? `Лучший наличный ${page.code} в ${city}: ${formatFxRate(cash.buy, intent.locale)} / ${formatFxRate(cash.sell, intent.locale)}`
          : `Best cash ${page.code} in ${city}: ${formatFxRate(cash.buy, intent.locale)} / ${formatFxRate(cash.sell, intent.locale)}`
        : ru
          ? `Наличный ${page.code} в ${city} — сравнение обменников`
          : `Cash ${page.code} in ${city} — office comparison`,
      subtitle: cash
        ? ru
          ? "покупка / продажа · живые котировки"
          : "buy / sell · live quotes"
        : baseline != null
          ? ru
            ? `ориентир ЦБ ${formatFxRate(baseline, intent.locale)}`
            : `CBR baseline ${formatFxRate(baseline, intent.locale)}`
          : ru
            ? "лучшие курсы обменников сейчас"
            : "best office rates now",
      url: page.url,
      price: cash ? formatFxRate(cash.buy, intent.locale) : null,
      source: "Банки.ру",
    });
  }
  hits.push({
    kind: "web",
    title: ru ? `Обменники на карте · ${city}` : `Exchangers on the map · ${city}`,
    subtitle: ru ? "пункты рядом" : "nearby offices",
    url: `https://yandex.ru/maps/?text=${encodeURIComponent(ru ? `обмен валют ${city}` : `currency exchange ${city}`)}`,
    price: null,
    source: "Яндекс Карты",
  });
  const unique: DiscoveryHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...hits, ...offices]) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    unique.push(hit);
  }
  return unique.slice(0, 8);
}

function afishaSlug(city: string) {
  const key = city
    .trim()
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,]/g, "");
  const slugs: Record<string, string> = {
    москва: "moscow",
    москве: "moscow",
    "санкт-петербург": "saint-petersburg",
    петербург: "saint-petersburg",
    питер: "saint-petersburg",
    спб: "saint-petersburg",
    казань: "kazan",
    казани: "kazan",
    новосибирск: "novosibirsk",
    екатеринбург: "yekaterinburg",
    сочи: "sochi",
  };
  return slugs[key] || citySlug(city);
}

function mapsHits(query: string, locale?: string | null): DiscoveryHit[] {
  const ru = languageOf(locale) !== "en";
  const text = encodeURIComponent(query);
  return [
    {
      kind: "place",
      title: ru ? `Яндекс Карты: ${query}` : `Yandex Maps: ${query}`,
      subtitle: ru ? "точки рядом" : "nearby",
      url: `https://yandex.ru/maps/?text=${text}`,
      price: null,
      source: "Яндекс Карты",
    },
    {
      kind: "place",
      title: `2ГИС: ${query}`,
      subtitle: ru ? "адреса и часы" : "addresses and hours",
      url: `https://2gis.ru/search/${text}`,
      price: null,
      source: "2ГИС",
    },
  ];
}

async function searchNearbyErrand(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike,
  query: string,
): Promise<DiscoveryHit[]> {
  const places = await searchPlaces(
    { ...intent, type: "places", placeKind: "place", query },
    fetchImpl,
  ).catch(() => [] as DiscoveryHit[]);
  const unique: DiscoveryHit[] = [];
  const seen = new Set<string>();
  for (const hit of [...mapsHits(query, intent.locale), ...places]) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    unique.push(hit);
  }
  return unique.slice(0, 8);
}

function wmoWeather(code: number, ru: boolean) {
  if (code === 0) return ru ? "ясно" : "clear";
  if (code <= 3) return ru ? "малооблачно" : "partly cloudy";
  if (code <= 48) return ru ? "туман" : "fog";
  if (code <= 67 || (code >= 80 && code <= 82)) return ru ? "дождь" : "rain";
  if (code <= 77 || code === 85 || code === 86) return ru ? "снег" : "snow";
  if (code >= 95) return ru ? "гроза" : "storm";
  return ru ? "пасмурно" : "overcast";
}

async function searchWeather(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike,
): Promise<DiscoveryHit[]> {
  const ru = languageOf(intent.locale) !== "en";
  const city = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const geo = asRecord(
    await fetchJson(
      fetchImpl,
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=${languageOf(intent.locale)}`,
    ),
  );
  const loc = asRecord(Array.isArray(geo?.results) ? geo.results[0] : null);
  const lat = typeof loc?.latitude === "number" ? loc.latitude : null;
  const lon = typeof loc?.longitude === "number" ? loc.longitude : null;
  const hits: DiscoveryHit[] = [];
  if (lat != null && lon != null) {
    const forecast = asRecord(
      await fetchJson(
        fetchImpl,
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`,
      ),
    );
    const current = asRecord(forecast?.current);
    const daily = asRecord(forecast?.daily);
    const temp = typeof current?.temperature_2m === "number" ? current.temperature_2m : null;
    const code = typeof current?.weather_code === "number" ? current.weather_code : 1;
    const maxes = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
    const mins = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
    const hi = typeof maxes[0] === "number" ? Math.round(maxes[0]) : null;
    const lo = typeof mins[0] === "number" ? Math.round(mins[0]) : null;
    if (temp != null) {
      hits.push({
        kind: "web",
        title: ru
          ? `${city}: сейчас ${Math.round(temp)}° · ${wmoWeather(code, true)}`
          : `${city}: ${Math.round(temp)}° now · ${wmoWeather(code, false)}`,
        subtitle:
          hi != null && lo != null
            ? ru
              ? `сегодня ${lo}…${hi}°`
              : `today ${lo}…${hi}°`
            : ru
              ? "факт по месту"
              : "live conditions",
        url: `https://yandex.ru/pogoda/${encodeURIComponent(city)}`,
        price: `${Math.round(temp)}°`,
        source: "Open-Meteo",
      });
    }
  }
  hits.push(
    {
      kind: "web",
      title: ru ? `Яндекс Погода · ${city}` : `Yandex Weather · ${city}`,
      subtitle: ru ? "подробный прогноз" : "detailed forecast",
      url: `https://yandex.ru/pogoda/${encodeURIComponent(city)}`,
      price: null,
      source: "Яндекс Погода",
    },
    {
      kind: "web",
      title: `Gismeteo · ${city}`,
      subtitle: ru ? "прогноз на дни" : "multi-day forecast",
      url: `https://www.gismeteo.ru/search/${encodeURIComponent(city)}/`,
      price: null,
      source: "Gismeteo",
    },
  );
  return hits.slice(0, 8);
}

function searchTickets(intent: DiscoveryIntent): DiscoveryHit[] {
  const ru = languageOf(intent.locale) !== "en";
  const city = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const slug = afishaSlug(city);
  const q = encodeURIComponent(distillLifeQuery(intent.query) || city);
  const hits: DiscoveryHit[] = [
    {
      kind: "web",
      title: ru ? `Яндекс Афиша · ${city}` : `Yandex Afisha · ${city}`,
      subtitle: ru ? "кино и концерты сейчас" : "cinema and concerts now",
      url: `https://afisha.yandex.ru/${slug}`,
      price: null,
      source: "Яндекс Афиша",
    },
    {
      kind: "web",
      title: ru ? `Афиша · ${city}` : `Afisha · ${city}`,
      subtitle: ru ? "расписание сеансов" : "showtimes",
      url: `https://www.afisha.ru/search/?query=${q}`,
      price: null,
      source: "Афиша",
    },
    {
      kind: "web",
      title: "Kudago",
      subtitle: ru ? "куда сходить в городе" : "what's on in town",
      url: `https://kudago.com/search/?query=${q}`,
      price: null,
      source: "Kudago",
    },
    ...mapsHits(`кино ${city}`, intent.locale),
  ];
  return hits.slice(0, 8);
}

function searchTravel(intent: DiscoveryIntent): DiscoveryHit[] {
  const ru = languageOf(intent.locale) !== "en";
  const from = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const dest = parseCity(intent.query);
  const to = dest && dest.toLocaleLowerCase() !== from.toLocaleLowerCase() ? dest : "";
  const pair = to ? `${from} — ${to}` : from;
  const q = encodeURIComponent(to ? `${from} ${to}` : intent.query || from);
  const hits: DiscoveryHit[] = [
    {
      kind: "web",
      title: ru ? `Яндекс Путешествия · ${pair}` : `Yandex Travel · ${pair}`,
      subtitle: ru ? "авиа и поезда" : "flights and trains",
      url: `https://travel.yandex.ru/search/?query=${q}`,
      price: null,
      source: "Яндекс Путешествия",
    },
    {
      kind: "web",
      title: ru ? `Туту · ${pair}` : `Tutu · ${pair}`,
      subtitle: ru ? "поезда и автобусы" : "trains and buses",
      url: `https://www.tutu.ru/poezda/?nn=1&query=${q}`,
      price: null,
      source: "Туту",
    },
    {
      kind: "web",
      title: ru ? `Авиасейлс · ${pair}` : `Aviasales · ${pair}`,
      subtitle: ru ? "сравнение авиабилетов" : "flight comparison",
      url: `https://www.aviasales.ru/?q=${q}`,
      price: null,
      source: "Aviasales",
    },
    {
      kind: "web",
      title: "РЖД",
      subtitle: ru ? "официальные ж/д билеты" : "official rail tickets",
      url: `https://pass.rzd.ru/`,
      price: null,
      source: "РЖД",
    },
  ];
  return hits;
}

function searchRepair(intent: DiscoveryIntent): DiscoveryHit[] {
  const ru = languageOf(intent.locale) !== "en";
  const city = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const job = repairQuery(intent.query);
  const q = encodeURIComponent(`${job} ${city}`);
  const hits: DiscoveryHit[] = [
    {
      kind: "web",
      title: ru ? `Профи · ${job}` : `Profi · ${job}`,
      subtitle: ru ? `мастера в ${city}` : `pros in ${city}`,
      url: `https://profi.ru/search/?q=${q}`,
      price: null,
      source: "Профи.ру",
    },
    {
      kind: "web",
      title: ru ? `YouDo · ${job}` : `YouDo · ${job}`,
      subtitle: ru ? "заявки с отзывами" : "jobs with reviews",
      url: `https://youdo.com/search/?q=${q}`,
      price: null,
      source: "YouDo",
    },
    {
      kind: "shop",
      title: `Авито: ${job}`,
      subtitle: ru ? `услуги в ${city}` : `services in ${city}`,
      url: `https://www.avito.ru/all?q=${q}`,
      price: null,
      source: "Avito",
    },
  ];
  return hits;
}

function searchDelivery(intent: DiscoveryIntent): DiscoveryHit[] {
  const ru = languageOf(intent.locale) !== "en";
  const city = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const q = encodeURIComponent(distillLifeQuery(intent.query) || city);
  const hits: DiscoveryHit[] = [
    {
      kind: "web",
      title: ru ? `Яндекс Еда · ${city}` : `Yandex Eats · ${city}`,
      subtitle: ru ? "доставка сейчас" : "delivery now",
      url: `https://eda.yandex.ru/search?query=${q}`,
      price: null,
      source: "Яндекс Еда",
    },
    ...mapsHits(`доставка еды ${city}`, intent.locale),
  ];
  return hits;
}

function searchDocs(intent: DiscoveryIntent): DiscoveryHit[] {
  const ru = languageOf(intent.locale) !== "en";
  const city = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const q = encodeURIComponent(distillLifeQuery(intent.query) || (ru ? "Госуслуги" : "documents"));
  const hits: DiscoveryHit[] = [
    {
      kind: "web",
      title: ru ? "Госуслуги" : "Gosuslugi",
      subtitle: ru ? "официальное оформление" : "official filings",
      url: `https://www.gosuslugi.ru/search?query=${q}`,
      price: null,
      source: "Госуслуги",
    },
    {
      kind: "web",
      title: ru ? `МФЦ · ${city}` : `MFC · ${city}`,
      subtitle: ru ? "очно, если онлайн не хватит" : "in person if needed",
      url: `https://www.gosuslugi.ru/help/faq/mfc`,
      price: null,
      source: "Госуслуги",
    },
    ...mapsHits(`МФЦ ${city}`, intent.locale),
  ];
  return hits;
}

async function searchFlowers(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike,
): Promise<DiscoveryHit[]> {
  const ru = languageOf(intent.locale) !== "en";
  const city = intent.city?.trim() || (ru ? "Москва" : "Moscow");
  const [products, places] = await Promise.all([
    searchProducts({ ...intent, type: "products", query: "букет цветы" }, fetchImpl).catch(
      () => [] as DiscoveryHit[],
    ),
    searchNearbyErrand(intent, fetchImpl, nearbyQuery("flowers", city)),
  ]);
  const flowwow = {
    kind: "shop" as const,
    title: ru ? `Flowwow · ${city}` : `Flowwow · ${city}`,
    subtitle: ru ? "доставка букетов" : "bouquet delivery",
    url: `https://flowwow.com/search/?q=${encodeURIComponent(`букет ${city}`)}`,
    price: null,
    source: "Flowwow",
  };
  const unique: DiscoveryHit[] = [];
  const seen = new Set<string>();
  for (const hit of [flowwow, ...products.slice(0, 3), ...places]) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    unique.push(hit);
  }
  return unique.slice(0, 8);
}

async function searchLifeHelp(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike,
): Promise<DiscoveryHit[] | null> {
  const id = (intent.type === "fx" ? "fx" : intent.category) as string | null;
  if (!isLifeHelpId(id) || id === "buy" || id === "fx") return null;
  const city = intent.city?.trim() || "Москва";
  if (id === "weather") return searchWeather(intent, fetchImpl);
  if (id === "pharmacy" || id === "post" || id === "mfc" || id === "bank") {
    return searchNearbyErrand(intent, fetchImpl, nearbyQuery(id, city));
  }
  if (id === "flowers") return searchFlowers(intent, fetchImpl);
  if (id === "tickets") return searchTickets(intent);
  if (id === "travel") return searchTravel(intent);
  if (id === "repair") return searchRepair(intent);
  if (id === "delivery") return searchDelivery(intent);
  if (id === "docs") return searchDocs(intent);
  if (id === "restaurant") {
    return searchNearbyErrand(intent, fetchImpl, nearbyQuery("restaurant", city));
  }
  if (id === "entertainment") {
    return searchNearbyErrand(intent, fetchImpl, nearbyQuery("entertainment", city));
  }
  return null;
}

export async function runDiscovery(
  intent: DiscoveryIntent,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveryHit[]> {
  const specialized = await searchLifeHelp(intent, fetchImpl);
  if (specialized) return specialized;
  if (intent.type === "fx") return searchCurrencyExchange(intent, fetchImpl);
  if (intent.type === "web") return searchWeb(intent, fetchImpl);
  if (intent.type === "places") return searchPlaces(intent, fetchImpl);
  if (intent.type === "gifts") {
    const [products, places] = await Promise.all([
      searchProducts(intent, fetchImpl),
      searchPlaces(
        {
          ...intent,
          type: "places",
          placeKind: "restaurant",
          query: `ресторан кафе ${intent.query}`,
        },
        fetchImpl,
      ),
    ]);
    return [...products.slice(0, 5), ...places.slice(0, 3)].slice(0, 8);
  }
  return searchProducts(intent, fetchImpl);
}

export const defaultDiscoveryClient: DiscoveryClient = {
  search: (intent) => runDiscovery(intent),
};

export async function collectUpcomingDates(
  people: Person[],
  memoriesFor: (personId: string) => Promise<Memory[]>,
  timezone: string,
  now = new Date(),
  experiences: Experience[] = [],
) {
  const packed = await Promise.all(
    people.slice(0, 14).map(async (person) => ({
      id: person.id,
      name: person.name,
      is_self: person.is_self,
      relationship: person.relationship,
      memories: await memoriesFor(person.id),
      dates: person.dates ?? [],
    })),
  );
  return upcomingImportantDates(packed, timezone, now, 45, { experiences });
}
