import type { AppRepository } from "../../repository.js";
import { languageOf } from "../../locale.js";
import type { Experience, Memory, Project } from "../../types.js";

export const DATE_PREP_DAYS = 14;
export type PersonGender = "female" | "male" | "unknown";
export type RelationRole =
  | "partner"
  | "parent"
  | "child"
  | "sibling"
  | "family"
  | "friend"
  | "colleague"
  | "other";
export type DatePrepActionId = "gift" | "flowers" | "table" | "outing";
export type DatePrepOffer = {
  kind: "search_products" | "search_places" | "plan";
  title: string;
  instruction: string;
};
export type UpcomingDate = {
  person: string | null;
  person_id?: string | null;
  relationship?: string | null;
  gender?: PersonGender;
  label: string;
  date: string;
  days_until: number;
  kind: "birthday" | "holiday" | "date";
  gift_history?: string[];
  tastes?: string[];
};

const FEMALE_REL =
  /жена|девушк|подруг|мама|мать|сестр|дочь|бабушк|т[её]т|кузин|приятельниц|супруг[аи]/iu;
const MALE_REL =
  /муж(?!чин)|парень|друг|папа|отец|брат|сын|дедушк|дяд|кузен|приятель(?!ниц)|супруг(?![аи])/iu;
const PARTNER_REL = /жена|муж|девушк|парень|партн[её]р|супруг/iu;
const PARENT_REL = /мама|мать|папа|отец|родител/iu;
const CHILD_REL = /сын|дочь|реб[её]нок|дети/iu;
const SIBLING_REL = /брат|сестр/iu;
const FAMILY_REL = /бабушк|дедушк|т[её]т|дяд|кузен|кузин|родствен/iu;
const FRIEND_REL = /друг|подруг|приятел/iu;
const COLLEAGUE_REL = /коллег|начальник|сотрудник|босс|шеф/iu;
const MALE_A_NAMES = new Set([
  "никита",
  "илья",
  "кузьма",
  "фома",
  "савва",
  "добрыня",
  "данила",
  "миша",
  "дима",
  "коля",
  "ваня",
  "паша",
  "лёша",
  "леша",
  "жора",
  "гоша",
  "гриша",
  "боря",
  "толя",
  "витя",
  "вова",
  "саня",
  "серёжа",
  "сережа",
  "андрюша",
  "костя",
  "рома",
  "тема",
  "тёма",
]);
const AMBIGUOUS_NAMES = new Set(["саша", "женя", "валя", "шура", "тося"]);

function stripDirective(text: string) {
  return text.replace(/^сделай сам:\s*/iu, "").trim();
}

export function firstName(person: string | null | undefined) {
  return person?.trim().split(/\s+/)[0] ?? "";
}

export function inferPersonGender(input: {
  name?: string | null;
  relationship?: string | null;
}): PersonGender {
  const rel = input.relationship?.trim() ?? "";
  if (rel && FEMALE_REL.test(rel)) return "female";
  if (rel && MALE_REL.test(rel)) return "male";
  const name = firstName(input.name).toLocaleLowerCase("ru-RU");
  if (!name) return "unknown";
  if (AMBIGUOUS_NAMES.has(name)) return "unknown";
  if (MALE_A_NAMES.has(name)) return "male";
  if (/любовь|нинель/u.test(name)) return "female";
  if (/[ая]$/u.test(name)) return "female";
  if (/[бвгджзклмнпрстфхцчшщйь]$/u.test(name)) return "male";
  return "unknown";
}

export function inferRelationRole(relationship?: string | null): RelationRole {
  const rel = relationship?.trim() ?? "";
  if (!rel) return "other";
  if (PARTNER_REL.test(rel)) return "partner";
  if (PARENT_REL.test(rel)) return "parent";
  if (CHILD_REL.test(rel)) return "child";
  if (SIBLING_REL.test(rel)) return "sibling";
  if (FAMILY_REL.test(rel)) return "family";
  if (FRIEND_REL.test(rel)) return "friend";
  if (COLLEAGUE_REL.test(rel)) return "colleague";
  return "other";
}

export function datePrepKind(item: Pick<UpcomingDate, "kind" | "label">): "birthday" | "celebration" | "holiday" | "date" {
  if (item.kind === "birthday" || /рожден|birthday/iu.test(item.label)) return "birthday";
  if (item.kind === "holiday") return "holiday";
  if (/свад|годовщ|wedding|anniversary|знаком|встретил|\bmet\b/iu.test(item.label))
    return "celebration";
  return "date";
}

function holidayAudience(label: string): PersonGender {
  if (/8 марта|валентин|valentine/iu.test(label)) return "female";
  if (/23 февраля/iu.test(label)) return "male";
  return "unknown";
}

export function suggestDatePrepActions(input: {
  item: Pick<UpcomingDate, "kind" | "label" | "gender" | "relationship" | "person">;
  selfGender?: PersonGender;
}): DatePrepActionId[] {
  const kind = datePrepKind(input.item);
  const role = inferRelationRole(input.item.relationship);
  const gender =
    input.item.gender && input.item.gender !== "unknown"
      ? input.item.gender
      : inferPersonGender({ name: input.item.person, relationship: input.item.relationship });
  const audience = input.item.person ? gender : holidayAudience(input.item.label);
  const actions: DatePrepActionId[] = [];

  const gift =
    kind !== "holiday" || /валентин|8 марта|новый год|23 февраля|valentine/iu.test(input.item.label);
  if (gift) actions.push("gift");

  const allowFlowers =
    audience === "female" &&
    role !== "colleague" &&
    (kind === "holiday"
      ? /8 марта|валентин|valentine/iu.test(input.item.label)
      : role === "partner" ||
        role === "parent" ||
        role === "sibling" ||
        role === "family" ||
        role === "friend" ||
        (role === "other" && Boolean(input.item.person)));
  if (allowFlowers) actions.push("flowers");

  const tableOk =
    role !== "colleague" &&
    role !== "child" &&
    kind !== "holiday" &&
    (kind === "celebration" ||
      role === "partner" ||
      role === "friend" ||
      role === "parent" ||
      role === "family" ||
      role === "other");
  const outingOk =
    !tableOk &&
    role !== "colleague" &&
    (kind === "holiday" || role === "friend" || !input.item.person);

  if (tableOk) actions.push("table");
  else if (outingOk) actions.push("outing");

  const order: DatePrepActionId[] =
    kind === "celebration"
      ? ["table", "gift", "flowers", "outing"]
      : ["gift", "flowers", "table", "outing"];
  return [...new Set(actions)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export function collectGiftHistory(
  memories: Pick<Memory, "category" | "content" | "status">[] | undefined,
  experiences: Pick<
    Experience,
    "type" | "title" | "description" | "positive_signals" | "participant_ids"
  >[] = [],
  personId?: string | null,
) {
  const notes: string[] = [];
  for (const memory of memories ?? []) {
    if (memory.status && memory.status !== "active") continue;
    const giftLike =
      memory.category === "gift" ||
      /подар|дарил|купил[аи]?\s+(?:ей|ему)|iphone|айфон|airpods/iu.test(memory.content);
    if (!giftLike) continue;
    const note = memory.content.trim().slice(0, 160);
    if (note) notes.push(note);
  }
  for (const experience of experiences) {
    if (experience.type !== "gift") continue;
    if (personId && !experience.participant_ids.includes(personId)) continue;
    const note = (experience.title || experience.description || experience.positive_signals[0] || "")
      .trim()
      .slice(0, 160);
    if (note) notes.push(note);
  }
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = note.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

export function collectTastes(memories: Pick<Memory, "category" | "content" | "status">[] | undefined) {
  return (memories ?? [])
    .filter(
      (memory) =>
        (!memory.status || memory.status === "active") &&
        /interest|preference|favorite_food|dislike/.test(memory.category),
    )
    .map((memory) => memory.content.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function datesNeedingPrep(dates: UpcomingDate[], withinDays = DATE_PREP_DAYS) {
  return dates.filter((item) => item.days_until >= 0 && item.days_until <= withinDays);
}

export function whenPhrase(days: number, ru: boolean) {
  if (days === 0) return ru ? "сегодня" : "today";
  if (days === 1) return ru ? "завтра" : "tomorrow";
  if (days >= 12 && days <= 14) return ru ? "через 2 недели" : "in 2 weeks";
  return ru ? `через ${days} дн.` : `in ${days} days`;
}

const ACTION_HINT: Record<DatePrepActionId, { ru: string; en: string }> = {
  gift: { ru: "подарок", en: "a gift" },
  flowers: { ru: "цветы", en: "flowers" },
  table: { ru: "столик", en: "a table" },
  outing: { ru: "куда сходить", en: "a place to go" },
};

export function datePrepActionHint(
  item: UpcomingDate,
  locale?: string | null,
  selfGender?: PersonGender,
) {
  const ru = languageOf(locale) !== "en";
  const actions = suggestDatePrepActions({ item, selfGender });
  const labels = actions.map((id) => (ru ? ACTION_HINT[id].ru : ACTION_HINT[id].en));
  const past = item.gift_history?.[0];
  const hint =
    labels.length === 0
      ? ""
      : labels.length === 1
        ? labels[0]!
        : ru
          ? `${labels.slice(0, -1).join(", ")} или ${labels.at(-1)}`
          : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
  if (!hint) return past ? (ru ? `в прошлом — ${past}` : `last time — ${past}`) : "";
  if (!past) return hint;
  const short = past.length > 48 ? `${past.slice(0, 45)}…` : past;
  return ru ? `${hint}; в прошлом — ${short}` : `${hint}; last time — ${short}`;
}

export function upcomingDateDigestLines(
  dates: UpcomingDate[],
  locale?: string | null,
  selfGender?: PersonGender,
) {
  const ru = languageOf(locale) !== "en";
  const soon = datesNeedingPrep(dates);
  if (!soon.length) return [];
  return [
    ru ? "Близкие даты:" : "Upcoming dates:",
    ...soon.slice(0, 4).map((item) => {
      const who = item.person ? `${item.person} — ` : "";
      const hint = datePrepActionHint(item, locale, selfGender);
      const when = whenPhrase(item.days_until, ru);
      return hint
        ? `• ${who}${item.label} (${when}) — ${hint}`
        : `• ${who}${item.label} (${when})`;
    }),
  ];
}

function giftContextLine(item: UpcomingDate, ru: boolean) {
  const past = item.gift_history?.[0];
  const tastes = (item.tastes ?? []).slice(0, 3).join(", ");
  const parts: string[] = [];
  if (past)
    parts.push(
      ru
        ? `Прошлый опыт: ${past}. От этого отталкивайся по формату и бюджету; не копируй тот же подарок один в один.`
        : `Past gift: ${past}. Use that as format and budget; do not copy the same gift.`,
    );
  if (tastes)
    parts.push(ru ? `Вкусы: ${tastes}.` : `Tastes: ${tastes}.`);
  else if (!past)
    parts.push(
      ru
        ? "Подбери по вкусам из focused_people и people_index."
        : "Use tastes from focused_people and people_index.",
    );
  return parts.join(" ");
}

function projectTitle(item: UpcomingDate, ru: boolean) {
  const who = firstName(item.person);
  const kind = datePrepKind(item);
  if (kind === "birthday" && who) return ru ? `День рождения ${who}` : `${who}'s birthday`;
  if (who) return `${item.label} ${who}`.trim();
  return item.label.trim() || (ru ? "Праздник" : "Celebration");
}

const DISCUSS_HINT: Record<DatePrepActionId, { ru: string; en: string }> = {
  gift: { ru: "подарок", en: "a gift" },
  flowers: { ru: "цветы", en: "flowers" },
  table: { ru: "столик", en: "a table" },
  outing: { ru: "куда сходить", en: "a place to go" },
};

export function datePrepProjectDraft(
  item: UpcomingDate,
  locale?: string | null,
  selfGender?: PersonGender,
) {
  const ru = languageOf(locale) !== "en";
  const suggestions = suggestDatePrepActions({ item, selfGender });
  const name = projectTitle(item, ru);
  if (!name.trim()) return null;
  return { name, suggestions, due_at: item.date };
}

function discussHints(suggestions: DatePrepActionId[], ru: boolean) {
  const labels = suggestions.map((id) => (ru ? DISCUSS_HINT[id].ru : DISCUSS_HINT[id].en));
  if (!labels.length) return ru ? "что реально нужно" : "what is actually needed";
  if (labels.length === 1) return labels[0]!;
  return ru
    ? `${labels.slice(0, -1).join(", ")} или ${labels.at(-1)}`
    : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}`;
}

export function datePrepOffers(
  dates: UpcomingDate[],
  locale?: string | null,
  selfGender?: PersonGender,
): DatePrepOffer[] {
  const ru = languageOf(locale) !== "en";
  const soon = datesNeedingPrep(dates);
  if (!soon.length) return [];
  const item = soon[0]!;
  const actions = suggestDatePrepActions({ item, selfGender });
  const who = firstName(item.person);
  const when = whenPhrase(item.days_until, ru);
  const occasion = item.label.trim() || (ru ? "дата" : "date");
  const whoLead = who ? `${who}: ` : "";
  const relation = item.relationship?.trim();
  const relationBit = relation
    ? ru
      ? ` Это ${relation}.`
      : ` They are your ${relation}.`
    : "";
  const genderBit =
    item.gender === "male"
      ? ru
        ? " Получатель — мужчина: без цветов."
        : " Recipient is male: no flowers."
      : "";
  const giftLine = giftContextLine(item, ru);

  const byId: Record<DatePrepActionId, DatePrepOffer> = {
    gift: {
      kind: "search_products",
      title: who ? (ru ? `Подарок: ${who}` : `Gift: ${who}`) : ru ? "Подобрать подарок" : "Pick a gift",
      instruction: ru
        ? `${whoLead}${occasion} ${when}.${relationBit}${genderBit} ${giftLine} Найди реальные товары через поиск. Не выдумывай магазины и ссылки.`
        : `${whoLead}${occasion} ${when}.${relationBit}${genderBit} ${giftLine} Search for real products. Do not invent shops or URLs.`,
    },
    flowers: {
      kind: "search_products",
      title: ru ? "Купить цветы" : "Buy flowers",
      instruction: ru
        ? `${whoLead}${occasion} ${when}.${relationBit} Подбери цветы, которые уместны именно ей. Найди реальные букеты. Не предлагай цветы мужчине.`
        : `${whoLead}${occasion} ${when}.${relationBit} Pick flowers that fit her. Search for real bouquets. Never suggest flowers for a man.`,
    },
    table: {
      kind: "search_places",
      title: who ? (ru ? `Столик: ${who}` : `Table: ${who}`) : ru ? "Забронировать столик" : "Book a table",
      instruction: ru
        ? `${whoLead}${occasion} ${when}.${relationBit} Найди ресторан в городе из locations или workspace.now.city и предложи забронировать столик. Не выдумывай адреса.`
        : `${whoLead}${occasion} ${when}.${relationBit} Find a restaurant in the city from locations or workspace.now.city and offer to book a table. Do not invent addresses.`,
    },
    outing: {
      kind: "search_places",
      title: ru ? "Куда сходить" : "Where to go",
      instruction: ru
        ? `${occasion} ${when}. Подбери куда сходить в городе из workspace.now.city. Не выдумывай места.`
        : `${occasion} ${when}. Suggest a place to go in workspace.now.city. Do not invent venues.`,
    },
  };

  const actionOffers = actions.map((id) => byId[id]);
  const project = datePrepProjectDraft(item, locale, selfGender);
  const offers = actionOffers.slice(0, 2);
  if (project) {
    const hints = discussHints(project.suggestions, ru);
    const giftBit = giftContextLine(item, ru);
    offers.push({
      kind: "plan",
      title: ru ? `Проект: ${project.name}` : `Project: ${project.name}`,
      instruction: (
        ru
          ? `Создай проект «${project.name}». Срок ${project.due_at}. Только пустой проект, без дел.${relationBit}${genderBit} ${giftBit} Потом обсуди подготовку: что реально нужно (${hints}). Дела не создавай, пока я не соглашусь. Что ты можешь сделать сама (подобрать варианты подарка, найти ресторан, сравнить места) — предложи, что возьмёшь на себя. Покупку и бронь оставляй мне, если я не попрошу иначе. Не используй goal_actions.`
          : `Create project "${project.name}". Due ${project.due_at}. Empty project only, no tasks.${relationBit}${genderBit} ${giftBit} Then discuss prep: what is actually needed (${hints}). Do not create tasks until I agree. What you can do yourself (gift options, find a restaurant, compare places) — offer to take on. Leave buying and booking to me unless I ask. Do not use goal_actions.`
      ).slice(0, 800),
    });
  }
  return offers.slice(0, 3);
}

export function datePrepEalzyOffers(
  dates: UpcomingDate[],
  project: { id: string; name: string },
  locale?: string | null,
  selfGender?: PersonGender,
): DatePrepOffer[] {
  const ru = languageOf(locale) !== "en";
  return datePrepOffers(dates, locale, selfGender)
    .filter((offer) => offer.kind !== "plan")
    .slice(0, 2)
    .map((offer) => ({
      ...offer,
      instruction: (
        ru
          ? `${offer.instruction} Проект уже есть: ${project.name} (${project.id}). Если я согласен, что ты это сделаешь — создай дело на себя (assignee ealzy) с этим project_id. Мне дело не ставь, пока я не попрошу.`
          : `${offer.instruction} The project already exists: ${project.name} (${project.id}). If I agree you should do this, create a task for yourself (assignee ealzy) with that project_id. Do not create a task for me unless I ask.`
      ).slice(0, 800),
    }));
}

export function inferDatePrepProject(text: string): {
  name: string;
  due_at: string | null;
} | null {
  const raw = stripDirective(text);
  const ruMatch = raw.match(/создай проект\s+[«"]([^«»"]+)[»"]/iu);
  const enMatch = raw.match(/create(?: a)? project\s+"([^"]+)"/iu);
  const match = ruMatch ?? enMatch;
  if (!match) return null;
  const due_at = raw.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  return { name: match[1]!.trim(), due_at };
}

export async function applyDatePrepProject(
  repository: AppRepository,
  ownerId: string,
  text: string,
  existing: Project[] = [],
) {
  const draft = inferDatePrepProject(text);
  if (!draft) return null;
  const same = existing.find(
    (project) =>
      project.status === "active" &&
      project.name.toLocaleLowerCase() === draft.name.toLocaleLowerCase(),
  );
  if (same) return { project: same, created: false as const };
  const project = await repository.createProject(ownerId, {
    name: draft.name,
    description: draft.due_at ? `${draft.name} · ${draft.due_at}` : draft.name,
  });
  return { project, created: true as const };
}
