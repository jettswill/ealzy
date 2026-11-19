import { RU_CITIES } from "./ru-cities.data.js";

// Справочник городов России: подсказки при вводе, приведение названия к одному
// виду («спб», «Питер», «Сункт-Петербург» → «Санкт-Петербург») и город из фразы
// в чате («я живу в Нижнем Новгороде»). Свой город человек хранит в базе (основной
// адрес в карточке «Я»), и все поиски мест идут по справочному названию.

export interface City {
  name: string;
  /**
   * Как храним и показываем: название, а у одноимённых городов — с регионом
   * («Кировск, Мурманская область»), чтобы потом найти именно этот.
   */
  title: string;
  /** Пусто у городов федерального значения. */
  region: string;
  lat: number;
  lon: number;
  population: number;
}

const seenRows = new Set<string>();
const ROWS = RU_CITIES.filter(([name, region]) => {
  const key = `${name}|${region}`;
  if (seenRows.has(key)) return false;
  seenRows.add(key);
  return true;
});

/** Нижний регистр, ё → е, дефисы и точки → пробелы, без «г.» и «город». */
export function normalizeCityText(value: string) {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/(^|\s)(г\.|г |город )/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Как люди называют города в разговоре. */
const ALIASES: Record<string, string> = {
  спб: "Санкт-Петербург",
  питер: "Санкт-Петербург",
  петербург: "Санкт-Петербург",
  "с петербург": "Санкт-Петербург",
  "санкт петербург": "Санкт-Петербург",
  ленинград: "Санкт-Петербург",
  мск: "Москва",
  масква: "Москва",
  екб: "Екатеринбург",
  екат: "Екатеринбург",
  нск: "Новосибирск",
  новосиб: "Новосибирск",
  нн: "Нижний Новгород",
  нижний: "Нижний Новгород",
  ростов: "Ростов-на-Дону",
  "ростов на дону": "Ростов-на-Дону",
  питербург: "Санкт-Петербург",
  владик: "Владивосток",
  челяба: "Челябинск",
  "набережные челны": "Набережные Челны",
  челны: "Набережные Челны",
  кенинг: "Калининград",
  калик: "Калининград",
  симф: "Симферополь",
};

const nameCounts = new Map<string, number>();
for (const [name] of ROWS) {
  const key = normalizeCityText(name);
  nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
}
const CITIES: City[] = ROWS.map(([name, region, lat, lon, population]) => {
  const key = normalizeCityText(name);
  // Одноимённые и те, чьё название — сокращение другого («Ростов»), — с регионом.
  const ambiguous = (nameCounts.get(key) ?? 0) > 1 || (key in ALIASES && ALIASES[key] !== name);
  return { name, title: ambiguous ? `${name}, ${region}` : name, region, lat, lon, population };
});

const byNorm = new Map<string, City>();
for (const city of CITIES) {
  const key = normalizeCityText(city.name);
  // Одинаковые названия в разных регионах: по умолчанию — самый крупный (список отсортирован).
  if (!byNorm.has(key)) byNorm.set(key, city);
}
const aliasCity = (key: string) => {
  const target = ALIASES[key];
  return target ? byNorm.get(normalizeCityText(target)) : undefined;
};

/** Расстояние Дамерау — Левенштейна с ранним выходом, когда больше `max`. */
function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2]! + 1);
      }
      row.push(value);
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = row;
  }
  return prev[b.length]!;
}

const allowedTypos = (length: number) => (length >= 9 ? 2 : length >= 5 ? 1 : 0);

/**
 * Подсказки при вводе: сначала точное и сокращения, потом начало названия, начало
 * любого слова, вхождение и опечатки; внутри — крупные города выше.
 */
export function searchCities(query: string, limit = 8): City[] {
  const q = normalizeCityText(query);
  if (!q) return CITIES.slice(0, limit);
  const scored = new Map<City, number>();
  const put = (city: City | undefined, score: number) => {
    if (!city) return;
    const was = scored.get(city);
    if (was === undefined || score < was) scored.set(city, score);
  };
  put(aliasCity(q), 0);
  for (const city of CITIES) {
    const name = normalizeCityText(city.name);
    if (name === q) put(city, 0);
    else if (name.startsWith(q)) put(city, 1);
    else if (name.split(" ").some((word) => word.startsWith(q))) put(city, 2);
    else if (q.length >= 3 && name.includes(q)) put(city, 3);
    else {
      const max = allowedTypos(q.length);
      if (max && editDistance(q, name.slice(0, q.length), max) <= max) put(city, 4);
    }
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || b[0].population - a[0].population)
    .slice(0, limit)
    .map(([city]) => city);
}

/**
 * Название → город справочника или null. Точное совпадение, сокращение, падежная
 * форма («в Москве», «в Нижнем Новгороде»), опечатка — если вариант один ясный.
 */
export function resolveCity(raw: string | null | undefined): City | null {
  if (!raw) return null;
  const q = normalizeCityText(raw);
  if (!q || q.length > 60) return null;
  // «Кировск, Мурманская область» — как мы храним одноимённые.
  const comma = raw.indexOf(",");
  if (comma > 0) {
    const name = normalizeCityText(raw.slice(0, comma));
    const region = normalizeCityText(raw.slice(comma + 1));
    const exact = CITIES.find(
      (city) =>
        normalizeCityText(city.name) === name &&
        (!region || normalizeCityText(city.region).includes(region)),
    );
    if (exact) return exact;
    return resolveCity(raw.slice(0, comma));
  }
  const direct = aliasCity(q) ?? byNorm.get(q);
  if (direct) return direct;
  for (const form of baseForms(q)) {
    const found = byNorm.get(form) ?? aliasCity(form);
    if (found) return found;
  }
  const max = allowedTypos(q.length);
  if (!max) return null;
  let best: City | null = null;
  let bestDistance = max + 1;
  for (const city of CITIES) {
    const distance = editDistance(q, normalizeCityText(city.name), max);
    if (distance < bestDistance) {
      best = city;
      bestDistance = distance;
    }
  }
  return bestDistance <= max ? best : null;
}

/** Каноническое название, если город из справочника; иначе как было (обрезанное). */
export function canonicalCityName(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().slice(0, 80);
  if (!trimmed) return null;
  return resolveCity(trimmed)?.title ?? trimmed;
}

// Предложный падеж → именительный: «Москве» → «Москва», «Казани» → «Казань»,
// «Петербурге» → «Петербург», «Нижнем Новгороде» → «Нижний Новгород».
const WORD_ENDINGS: [RegExp, string][] = [
  [/ем$/u, "ий"],
  [/ом$/u, "ый"],
  [/ом$/u, "ий"],
  [/ой$/u, "ая"],
  [/ой$/u, "ое"],
  [/ах$/u, "и"],
  [/ах$/u, "ы"],
  [/ске$/u, "ск"],
  [/е$/u, ""],
  [/е$/u, "а"],
  [/е$/u, "я"],
  [/и$/u, "ь"],
  [/и$/u, "я"],
  [/и$/u, "а"],
];

function wordForms(word: string): string[] {
  const forms = new Set([word]);
  for (const [ending, replacement] of WORD_ENDINGS) {
    if (word.length > 3 && ending.test(word)) forms.add(word.replace(ending, replacement));
  }
  return [...forms];
}

function baseForms(phrase: string): string[] {
  const words = phrase.split(" ").slice(0, 4);
  let combos = [""];
  for (const word of words) {
    const next: string[] = [];
    for (const head of combos) {
      for (const form of wordForms(word)) next.push(head ? `${head} ${form}` : form);
    }
    combos = next.slice(0, 200);
  }
  // «Ростове на Дону»: служебные слова не склоняются — оставляем исходные варианты.
  return combos;
}

/**
 * Город, где человек живёт, из его сообщения: «я живу в Казани», «переехал в
 * Питер», «мой город — Тверь». Только когда название находится в справочнике.
 */
export function cityFromMessage(text: string): City | null {
  const match = text.match(
    /(?:^|[^\p{L}])(?:я\s+)?(?:сейчас\s+)?(?:живу|живём|живем|переехал[аи]?|перебрал(?:ся|ась|ись))\s+(?:сейчас\s+)?(?:в|во)\s+([\p{L}][\p{L}\s.-]{1,60})|(?:^|[^\p{L}])мой\s+город\s*[—:-]?\s*([\p{L}][\p{L}\s.-]{1,60})/iu,
  );
  const tail = (match?.[1] ?? match?.[2])?.trim();
  if (!tail) return null;
  // Название — первые 1–4 слова; пробуем от длинного к короткому.
  const words = tail.split(/\s+/).slice(0, 4);
  for (let count = words.length; count >= 1; count--) {
    const candidate = words.slice(0, count).join(" ");
    const q = normalizeCityText(candidate);
    const exact = byNorm.get(q) ?? aliasCity(q);
    if (exact) return exact;
    for (const form of baseForms(q)) {
      const found = byNorm.get(form) ?? aliasCity(form);
      if (found) return found;
    }
  }
  return null;
}

export function cityLabel(city: Pick<City, "name" | "region">) {
  // Для подсказок: регион виден всегда, кроме городов федерального значения.
  return city.region ? `${city.name}, ${city.region}` : city.name;
}
