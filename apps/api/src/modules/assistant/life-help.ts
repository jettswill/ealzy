import { languageOf } from "../../locale.js";
import type { CapabilityOffer, DiscoveryIntent, PlaceKind } from "./discovery.js";

export type LifeHelpId =
  | "fx"
  | "weather"
  | "pharmacy"
  | "travel"
  | "tickets"
  | "repair"
  | "flowers"
  | "delivery"
  | "docs"
  | "post"
  | "mfc"
  | "bank"
  | "restaurant"
  | "entertainment"
  | "buy";

export const LIFE_HELP_IDS: LifeHelpId[] = [
  "fx",
  "weather",
  "pharmacy",
  "travel",
  "tickets",
  "repair",
  "flowers",
  "delivery",
  "docs",
  "post",
  "mfc",
  "bank",
  "restaurant",
  "entertainment",
  "buy",
];

export function isLifeHelpId(value: string | null | undefined): value is LifeHelpId {
  return Boolean(value && LIFE_HELP_IDS.includes(value as LifeHelpId));
}

type LifeHelpRule = {
  id: LifeHelpId;
  type: DiscoveryIntent["type"];
  category: string;
  placeKind: PlaceKind;
  pattern: RegExp;
};

const WEEKDAY =
  /понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|завтра|сегодня|послезавтра/iu;

const RULES: LifeHelpRule[] = [
  {
    id: "fx",
    type: "fx",
    category: "fx",
    placeKind: "place",
    pattern:
      /(?:поменя(?:ть|й|ем)|обмен(?:ять)?)\s+(?:деньг|валют)|обменник|обмен\s+валют|курс(?:ы)?\s+(?:валют|доллар|евро|юан|фунт)|наличн(?:ый|ые|ого)\s+курс|(?:купи(?:ть)?|прода(?:ть|й)|менять|поменять)\s+(?:доллар|евро|юан|фунт|валют)|(?:доллар|евро|юан|фунт|\busd\b|\beur\b|\bgbp\b|\bcny\b).{0,24}(?:руб|rub|обмен)|exchange (?:money|currency|dollars|euros)|currency exchange|bureau de change|cash (?:rate|usd|eur)/iu,
  },
  {
    id: "weather",
    type: "web",
    category: "weather",
    placeKind: "place",
    pattern: /погод[аеуы]|зонтик|осадк|сколько\s+градус|будет\s+дожд/iu,
  },
  {
    id: "pharmacy",
    type: "places",
    category: "pharmacy",
    placeKind: "place",
    pattern: /аптек|лекарств|таблетк|рецепт(?:у|ы|ов)?\b|парацетамол|ибупрофен/iu,
  },
  {
    id: "travel",
    type: "web",
    category: "travel",
    placeKind: "place",
    pattern:
      /(?:билет.{0,28}(?:поезд|электричк|самолёт|самолет|авиа|жд\b)|авиабилет|ж\/д|на\s+поезд|на\s+самолёт|на\s+самолет|aviasales|tutu|поездк[ауи]|лететь\s+в|ехать\s+в)/iu,
  },
  {
    id: "tickets",
    type: "web",
    category: "tickets",
    placeKind: "entertainment",
    pattern: /кино|концерт|афиш|спектакл|стендап|билет.{0,20}(?:театр|кино|концерт)|театр.{0,12}билет/iu,
  },
  {
    id: "repair",
    type: "web",
    category: "repair",
    placeKind: "place",
    pattern:
      /сантехник|электрик|мастер\s+на\s+час|вызвать\s+мастер|починить|ремонт\s+(?:стирал|холодильн|посудомо|смесител|квартир|телефон|ноутбук)/iu,
  },
  {
    id: "flowers",
    type: "products",
    category: "flowers",
    placeKind: "place",
    pattern: /букет|флорист|цвет(?:ы|ов|ами|очек)\b/iu,
  },
  {
    id: "delivery",
    type: "web",
    category: "delivery",
    placeKind: "place",
    pattern: /доставк[ауи]\s+(?:еды|еду)|заказать\s+еду|яндекс\s+еду|голодн/iu,
  },
  {
    id: "docs",
    type: "web",
    category: "docs",
    placeKind: "place",
    pattern: /загран|госуслуг|полис\s+омс|справка\s+(?:2-?ндфл|о\s+доход)|паспорт(?!\s+на\s+имя)/iu,
  },
  {
    id: "post",
    type: "places",
    category: "post",
    placeKind: "place",
    pattern: /почт[аеуы]\s+росси|отделени[ея]\s+почт|посылк|бандерол|отправить\s+посыл/iu,
  },
  {
    id: "mfc",
    type: "places",
    category: "mfc",
    placeKind: "place",
    pattern: /\bмфц\b|мои\s+документы/iu,
  },
  {
    id: "bank",
    type: "places",
    category: "bank",
    placeKind: "place",
    pattern: /банкомат|отделени[ея]\s+(?:банка|сбер)|сбер\s+рядом/iu,
  },
  {
    id: "restaurant",
    type: "places",
    category: "restaurant",
    placeKind: "restaurant",
    pattern: /ресторан|кафе|бар|ужин|обед|куда\s+поесть|забронировать\s+столик/iu,
  },
  {
    id: "entertainment",
    type: "places",
    category: "entertainment",
    placeKind: "entertainment",
    pattern: /куда\s+сходить|развлечен|театр|музей|клуб|прогулк|выставк/iu,
  },
  {
    id: "buy",
    type: "products",
    category: "buy",
    placeKind: "place",
    pattern:
      /купи(?:ть)?|закаж[иу]|товар|продукт|наушник|телефон|книг|парфюм|косметик|часов|ноутбук|планшет|колонк/iu,
  },
];

export function isTaskCapture(text: string) {
  return (
    /(?:поставь(?:те)?|добавь(?:те)?|запиши(?:те)?)\s+(?:мне\s+)?(?:дел[оа]|задач[уиа]|встречу)?|(?:дел[оа]|задач[уиа])\s+на\s+\S+|(?:напомни(?:ть)?\s+(?:мне\s+)?)на\s+/iu.test(
      text,
    ) ||
    /(?:надо|нужно)(?:\s+бы)?.{0,80}(?:купи(?:ть)?|позвон|записаться|отправить|оплатить|забрать).{0,80}(?:,|\s+и\s+|\s+потом\s+|\s+ещё\s+|\s+еще\s+)/iu.test(
      text,
    )
  );
}

export function isMailTalk(text: string) {
  return /письм|inbox|\bemail\b|gmail|ответить\s+на\s+письм|черновик\s+ответа/iu.test(text);
}

export function lifeHelpId(text: string): LifeHelpId | null {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.id;
  }
  return null;
}

export function lifeHelpRule(text: string): LifeHelpRule | null {
  const id = lifeHelpId(text);
  return RULES.find((rule) => rule.id === id) ?? null;
}

export function distillLifeQuery(text: string) {
  return text
    .replace(/^сделай сам:\s*/iu, "")
    .replace(
      /^(?:поставь(?:те)?|добавь(?:те)?|запиши(?:те)?)\s+(?:мне\s+)?(?:дел[оа]|задач[уиа])?\s*/iu,
      "",
    )
    .replace(new RegExp(`^на\\s+(?:${WEEKDAY.source})\\s+`, "iu"), "")
    .replace(
      /^(?:пожалуйста|pls|please)?\s*(?:найд[ийте]|подбер[иу]|поищ[иу]|покажи|подскаж[иу]|ищу|погугли|загугли|купи(?:ть)?|закаж[иу](?:ть)?)\s+/iu,
      "",
    )
    .replace(/^(?:что\s+такое|кто\s+так(?:ой|ая))\s+/iu, "")
    .trim();
}

export function repairQuery(text: string) {
  if (/сантех/iu.test(text)) return "сантехник";
  if (/электр/iu.test(text)) return "электрик";
  if (/холодиль/iu.test(text)) return "ремонт холодильника";
  if (/стирал/iu.test(text)) return "ремонт стиральной машины";
  if (/посудомо/iu.test(text)) return "ремонт посудомойки";
  if (/телефон|ноутбук/iu.test(text)) return "ремонт техники";
  return "мастер на час";
}

export function nearbyQuery(id: LifeHelpId, city: string) {
  if (id === "pharmacy") return `аптека ${city}`;
  if (id === "post") return `почта России ${city}`;
  if (id === "mfc") return `МФЦ ${city}`;
  if (id === "bank") return `отделение банка ${city}`;
  if (id === "flowers") return `цветы магазин ${city}`;
  if (id === "restaurant") return `ресторан ${city}`;
  if (id === "entertainment") return `развлечения ${city}`;
  return city;
}

export function lifeHelpOffer(
  id: LifeHelpId,
  intent: Pick<DiscoveryIntent, "query" | "city" | "maxPrice">,
  locale?: string | null,
): CapabilityOffer {
  const ru = languageOf(locale) !== "en";
  const city = intent.city?.trim() || "";
  const cityBit = city ? (ru ? ` в ${city}` : ` in ${city}`) : "";
  const item = distillLifeQuery(intent.query).slice(0, 60) || (ru ? "это" : "this");
  const byId: Record<LifeHelpId, CapabilityOffer> = {
    fx: {
      kind: "search_places",
      title: ru
        ? city
          ? `Выгодный курс · ${city}`
          : "Выгодный курс рядом"
        : city
          ? `Best cash rates · ${city}`
          : "Best cash rates nearby",
      instruction: ru
        ? `Найди обменники рядом с выгодным курсом${cityBit}: живые наличные курсы USD и EUR к рублю, сравнение пунктов и адреса рядом. Не выдумывай курсы и адреса — только из результатов поиска.`
        : `Find nearby currency exchangers with live cash rates${cityBit}. Do not invent rates or addresses.`,
    },
    weather: {
      kind: "research",
      title: ru ? (city ? `Погода · ${city}` : "Погода") : city ? `Weather · ${city}` : "Weather",
      instruction: ru
        ? `Найди фактическую погоду${cityBit} на сейчас и ближайшие дни. Не выдумывай градусы — только из результатов.`
        : `Find the actual weather${cityBit} for now and the next days. Do not invent temperatures.`,
    },
    pharmacy: {
      kind: "search_places",
      title: ru
        ? city
          ? `Аптеки рядом · ${city}`
          : "Аптеки рядом"
        : city
          ? `Pharmacies · ${city}`
          : "Pharmacies nearby",
      instruction: ru
        ? `Найди аптеки рядом${cityBit}, лучше круглосуточные. Адреса и карта. Не выдумывай точки.`
        : `Find nearby pharmacies${cityBit}, preferably 24h. Do not invent addresses.`,
    },
    travel: {
      kind: "research",
      title: ru ? "Билеты: поезд и самолёт" : "Train and flight tickets",
      instruction: ru
        ? `Найди билеты на поезд и самолёт по запросу «${item}»${cityBit}. Живые агрегаторы, без выдуманных рейсов и цен.`
        : `Find train and flight tickets for «${item}»${cityBit}. Live aggregators only, no invented fares.`,
    },
    tickets: {
      kind: "research",
      title: ru ? (city ? `Афиша · ${city}` : "Афиша") : city ? `What's on · ${city}` : "What's on",
      instruction: ru
        ? `Найди актуальное кино, концерты и билеты${cityBit} по запросу «${item}». Только живые афиши, без выдуманных сеансов.`
        : `Find current cinema, concerts and tickets${cityBit} for «${item}». Live listings only.`,
    },
    repair: {
      kind: "research",
      title: ru
        ? city
          ? `Мастер рядом · ${city}`
          : "Мастер рядом"
        : city
          ? `A repair pro · ${city}`
          : "A repair pro nearby",
      instruction: ru
        ? `Найди мастера (${repairQuery(intent.query)})${cityBit}: YouDo, Профи, Авито. Не выдумывай телефоны.`
        : `Find a repair pro (${repairQuery(intent.query)})${cityBit}. Do not invent phone numbers.`,
    },
    flowers: {
      kind: "search_products",
      title: ru
        ? city
          ? `Букеты рядом · ${city}`
          : "Букеты рядом"
        : city
          ? `Bouquets · ${city}`
          : "Bouquets nearby",
      instruction: ru
        ? `Найди живые букеты и цветочные${cityBit}. Магазины и доставка. Не выдумывай витрины.`
        : `Find real bouquets and florists${cityBit}. Do not invent shops.`,
    },
    delivery: {
      kind: "search_places",
      title: ru
        ? city
          ? `Еда с доставкой · ${city}`
          : "Еда с доставкой"
        : city
          ? `Food delivery · ${city}`
          : "Food delivery",
      instruction: ru
        ? `Найди доставку еды${cityBit} по текущему запросу. Живые сервисы, без выдуманных ресторанов.`
        : `Find food delivery${cityBit}. Live services only.`,
    },
    docs: {
      kind: "research",
      title: ru ? "Госуслуги и справки" : "Official documents",
      instruction: ru
        ? `Найди официальный путь оформить «${item}»: Госуслуги и МФЦ${cityBit}. Не выдумывай сроки и пошлины.`
        : `Find the official way to get «${item}». Do not invent fees or wait times.`,
    },
    post: {
      kind: "search_places",
      title: ru
        ? city
          ? `Почта рядом · ${city}`
          : "Почта рядом"
        : city
          ? `Post office · ${city}`
          : "Post office nearby",
      instruction: ru
        ? `Найди отделения Почты России${cityBit}. Адреса и карта, без выдуманных точек.`
        : `Find post offices${cityBit}. Do not invent addresses.`,
    },
    mfc: {
      kind: "search_places",
      title: ru ? (city ? `МФЦ рядом · ${city}` : "МФЦ рядом") : city ? `MFC · ${city}` : "MFC nearby",
      instruction: ru
        ? `Найди МФЦ / «Мои документы»${cityBit}. Адреса и карта.`
        : `Find public service centers${cityBit}.`,
    },
    bank: {
      kind: "search_places",
      title: ru
        ? city
          ? `Банк рядом · ${city}`
          : "Банк рядом"
        : city
          ? `Bank nearby · ${city}`
          : "Bank nearby",
      instruction: ru
        ? `Найди отделения банка и банкоматы${cityBit}. Адреса и карта.`
        : `Find bank branches and ATMs${cityBit}.`,
    },
    restaurant: {
      kind: "search_places",
      title: ru
        ? city
          ? `Куда поесть · ${city}`
          : "Куда поесть"
        : city
          ? `Where to eat · ${city}`
          : "Where to eat",
      instruction: ru
        ? `Найди рестораны и кафе${cityBit} по запросу «${item}». Живые места, без выдуманных адресов.`
        : `Find restaurants${cityBit} for «${item}». Do not invent addresses.`,
    },
    entertainment: {
      kind: "search_places",
      title: ru
        ? city
          ? `Куда сходить · ${city}`
          : "Куда сходить"
        : city
          ? `Where to go · ${city}`
          : "Where to go",
      instruction: ru
        ? `Найди куда сходить${cityBit} по запросу «${item}». Живые места, без выдуманных адресов.`
        : `Find places to go${cityBit} for «${item}». Do not invent addresses.`,
    },
    buy: {
      kind: "search_products",
      title: (ru ? `Найти: ${item}` : `Find: ${item}`).slice(0, 120),
      instruction: (
        ru
          ? `Найди «${item}»${cityBit} с живыми ценами в маркетплейсах. Не выдумывай магазины и ссылки.`
          : `Find «${item}»${cityBit} with live marketplace prices. Do not invent shops.`
      ).slice(0, 800),
    },
  };
  const offer = byId[id];
  return { ...offer, title: offer.title.slice(0, 120), instruction: offer.instruction.slice(0, 800) };
}

export function offerLifeId(offer: Pick<CapabilityOffer, "title" | "instruction">): LifeHelpId | null {
  const blob = `${offer.title} ${offer.instruction}`;
  const pairs: [RegExp, LifeHelpId][] = [
    [/выгодн(?:ый|ые|ого)?\s+курс|обменник|best cash|currency exchange/iu, "fx"],
    [/погода|weather ·|фактическ(?:ую|ая)\s+погод/iu, "weather"],
    [/^аптек/iu, "pharmacy"],
    [/поезд и самолёт|train and flight/iu, "travel"],
    [/^афиш|^what's on/iu, "tickets"],
    [/^мастер рядом|repair pro/iu, "repair"],
    [/^букет/iu, "flowers"],
    [/^еда с достав/iu, "delivery"],
    [/^госуслуг|official documents/iu, "docs"],
    [/^почта рядом/iu, "post"],
    [/^мфц/iu, "mfc"],
    [/^банк рядом/iu, "bank"],
    [/^куда поесть|where to eat/iu, "restaurant"],
    [/^куда сходить ·|where to go ·/iu, "entertainment"],
  ];
  for (const [pattern, id] of pairs) {
    if (pattern.test(offer.title) || pattern.test(blob)) return id;
  }
  return null;
}

export function mailReplyOffer(locale?: string | null): CapabilityOffer {
  const ru = languageOf(locale) !== "en";
  return {
    kind: "draft",
    title: ru ? "Набросать ответ" : "Draft a reply",
    instruction: ru
      ? "Напиши черновик ответа на важное письмо из workspace.mail.important. mail_actions.op=draft_reply. Не отправляй."
      : "Draft a reply to an important message in workspace.mail.important. mail_actions.op=draft_reply. Do not send.",
  };
}
