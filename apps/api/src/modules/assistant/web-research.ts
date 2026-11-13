// Живой интернет для Илзи. Модель чата отвечает строгим JSON, а веб-поиск у
// провайдера с JSON-режимом не совмещается, поэтому поиск — отдельный короткий
// шаг перед ответом: сводка фактов со ссылками кладётся в workspace.web_research,
// и Илзи отвечает уже с ней. Ищем только там, где без свежих данных ответ будет
// угадыванием: билеты, расписания, цены, погода, афиша, поездки, новости.

export type WebSource = { title: string; url: string };

export type WebResearchContext = {
  now: string;
  city: string | null;
  timezone: string | null;
  locale: string | null;
  recent: string[];
};

export type WebResearch = {
  fetched_at: string;
  query: string;
  summary: string;
  sources: WebSource[];
};

const TRAVEL =
  /билет|поезд|электричк|сапсан|ласточк|рейс|самол[её]т|перел[её]т|авиа|аэропорт|вокзал|поездк|съездить|съезжу|поехать\s+в|поеду\s+в|еду\s+в|лететь|полечу|отел[ьяеи]|гостиниц|хостел|апартамент|(?:^|\s)жиль[ёея]|\bticket|\btrain|\bflight|\bhotel/iu;
const EVENTS =
  /афиш|концерт|спектакл|театр|выставк|фестивал|(?:^|\s)матч|сеанс|что\s+(?:идёт|идет|посмотреть)|куда\s+сходить\s+в\s|showtimes|concert/iu;
const PRICES =
  /сколько\s+стоит|почём|почем|(?:^|\s)цен[аыуе](?=[\s,.?!]|$)|стоимост|курс\s+(?:валют|доллар|евро|юан)|часы\s+работы|до\s+скольки\s+работает|работает\s+ли|открыт[оа]?\s+ли|how\s+much|\bprice|opening\s+hours/iu;
const NEWS = /погод|прогноз|новост|что\s+случилось|что\s+происходит|\bweather|\bnews\b/iu;
const PLANNING =
  /план\s+поездк|маршрут|как\s+добраться|что\s+посмотреть|на\s+выходные\s+в\s|выходные\s+в\s+[А-ЯЁ]/u;
const EXPLICIT =
  /найди\s+в\s+интернете|в\s+интернете|загугли|погугли|поищи|посмотри\s+(?:в\s+сети|онлайн)|актуальн|search\s+the\s+web|look\s+(?:it\s+)?up/iu;
// Чистая запись дела или напоминания — поиск не нужен, человек просит записать.
const PURE_CAPTURE =
  /^\s*(?:напомни(?:те)?|запиши(?:те)?|добавь(?:те)?|поставь(?:те)?|отметь|закрой|удали)(?=[\s,.:!]|$)/iu;

export function needsLiveWeb(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length < 6) return false;
  if (EXPLICIT.test(raw)) return true;
  if (PURE_CAPTURE.test(raw)) return false;
  return (
    TRAVEL.test(raw) || EVENTS.test(raw) || PRICES.test(raw) || NEWS.test(raw) || PLANNING.test(raw)
  );
}

export function cleanSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key)) parsed.searchParams.delete(key);
    }
    const out = parsed.toString();
    return out.endsWith("?") ? out.slice(0, -1) : out;
  } catch {
    return url;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function dedupeSources(sources: WebSource[], limit = 6): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const source of sources) {
    if (!/^https?:\/\//i.test(source.url) || /[()\s]/.test(source.url)) continue;
    const url = cleanSourceUrl(source.url);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ title: (source.title || hostOf(url)).trim().slice(0, 120), url });
    if (out.length >= limit) break;
  }
  return out;
}

// Модель исследователя вставляет ссылки прямо в текст сводки: для Илзи это
// шум, источники идут отдельным списком.
export function stripInlineLinks(text: string): string {
  return (
    text
      .replace(/\s*\(\[[^\]]*\]\((https?:[^)]+)\)\)/g, "")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
      // Сноски Perplexity: «[2][10]».
      .replace(/(?:\s*\[\d{1,2}\])+/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// Под ответом — до трёх источников, если Илзи не сослалась на них сама.
export function attachWebSources(
  answer: string,
  research: WebResearch | null,
  locale?: string | null,
): string {
  if (!research?.sources.length) return answer;
  // Источники — к ответу с фактами. Уточняющий вопрос («из какого города?»)
  // со ссылками на случайные расписания выглядит как мусор.
  if (!/\d{1,2}:\d{2}|₽|°|\d\s?(?:руб|€|\$)/u.test(answer)) return answer;
  const fresh = research.sources.filter((source) => !answer.includes(source.url)).slice(0, 3);
  if (!fresh.length) return answer;
  const en = (locale ?? "").toLowerCase().startsWith("en");
  const heading = en ? "Sources:" : "Источники:";
  // Ссылкой с именем сайта: длинные адреса расписаний занимают пол-экрана.
  const lines = fresh.map((source) => `• [${hostOf(source.url)}](${source.url})`);
  return `${answer.trim()}\n\n${heading}\n${lines.join("\n")}`;
}
