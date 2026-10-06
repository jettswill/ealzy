import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import type { MemoryCategory, Person, PersonDateKind, PersonResolution } from "../../types.js";
import { partsFromIso } from "./dates.js";

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);

export const MEMORY_CATEGORIES = [
  "interest",
  "dislike",
  "favorite_place",
  "favorite_food",
  "gift",
  "size",
  "dream",
  "important_date",
  "story",
  "personality",
  "experience",
  "preference",
  "skill",
  "important_event",
  "important_fact",
  "other",
] as const;

// Модель не всегда попадает в имена полей: вместо person_name приходит name
// или person, вместо content — fact или text. Раньше такой ответ молча терялся
// (person_name пустой → персона не создаётся), а Илзи при этом писала «запомнила».
const PERSON_FACT_ALIASES: Record<string, readonly string[]> = {
  person_name: ["name", "person", "who"],
  relationship: ["relation", "role"],
  content: ["fact", "text", "note", "memory"],
  occurred_at: ["date", "birthday", "when"],
  date_kind: ["kind", "date_type"],
  date_year: ["year"],
};

function withPersonFactAliases(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  for (const [field, aliases] of Object.entries(PERSON_FACT_ALIASES)) {
    if (row[field] != null && row[field] !== "") continue;
    const alias = aliases.find((key) => row[key] != null && row[key] !== "");
    if (alias) row[field] = row[alias];
  }
  // {"name": "Оля", "birthday": "14.11"} — дата без вида, но вид понятен из имени поля.
  if ((row.date_kind == null || row.date_kind === "") && row.birthday) row.date_kind = "birthday";
  return row;
}

const CompanionPersonFactShape = z.object({
  person_name: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()).transform((value) => value ?? ""),
  relationship: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  content: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  category: z.preprocess(
    emptyToNull,
    z.enum(MEMORY_CATEGORIES).nullable().catch(null),
  ),
  occurred_at: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
  date_kind: z.preprocess(
    emptyToNull,
    z.enum(["birthday", "met", "wedding", "anniversary", "other"]).nullable().catch(null),
  ),
  date_year: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(1800).max(2100).nullable().catch(null),
  ),
});
export const CompanionPersonFactSchema = z.preprocess(
  withPersonFactAliases,
  CompanionPersonFactShape,
);
export type CompanionPersonFact = z.infer<typeof CompanionPersonFactShape>;

/**
 * Факт о другом человеке не должен дублироваться в «Важных фактах» о самом
 * пользователе: «У сестры Оли день рождения 14 ноября» — это карточка Оли.
 */
export function selfFactIsAboutSavedPerson(
  content: string | null | undefined,
  facts: Pick<CompanionPersonFact, "person_name" | "relationship">[],
): boolean {
  const text = String(content ?? "");
  if (!text.trim()) return false;
  const words = text.split(/[^\p{L}-]+/u).filter(Boolean);
  return facts.some((fact) => {
    const name = fact.person_name?.trim();
    if (!name) return false;
    if (personMentionedIn(text, { name, aliases: [], is_self: false })) return true;
    const relationship = relationshipFromWord(fact.relationship) ?? relationshipFromWord(name);
    return Boolean(relationship && words.some((word) => relationshipFromWord(word) === relationship));
  });
}
export type PersonEntity = { type: "person"; id: string; label: string };

const RELATIONSHIPS = [
  "друг",
  "подруга",
  "приятель",
  "приятельница",
  "брат",
  "сестра",
  "мама",
  "папа",
  "отец",
  "мать",
  "жена",
  "муж",
  "сын",
  "дочь",
  "коллега",
  "начальник",
  "бабушка",
  "дедушка",
  "партнёр",
  "партнер",
  "девушка",
  "парень",
  "кузен",
  "кузина",
] as const;
const SKIP_NAMES = new Set([
  "я",
  "меня",
  "мне",
  "мой",
  "моя",
  "мои",
  "мы",
  "ты",
  "он",
  "она",
  "они",
  "это",
  "кто",
  "что",
  "друг",
  "подруга",
]);
const MONTHS: [RegExp, number][] = [
  [/январ\p{L}*/iu, 1],
  [/феврал\p{L}*/iu, 2],
  [/март\p{L}*/iu, 3],
  [/апрел\p{L}*/iu, 4],
  [/ма[йя]\p{L}*/iu, 5],
  [/июн\p{L}*/iu, 6],
  [/июл\p{L}*/iu, 7],
  [/август\p{L}*/iu, 8],
  [/сентябр\p{L}*/iu, 9],
  [/октябр\p{L}*/iu, 10],
  [/ноябр\p{L}*/iu, 11],
  [/декабр\p{L}*/iu, 12],
];

const normalize = (value: string) => value.toLocaleLowerCase().trim();
const relationshipPattern = RELATIONSHIPS.join("|");

// Родство, которое по-русски почти всегда заменяет имя: «мама любит пионы»,
// «у жены день рождения», «записать сына к врачу». Раньше такие упоминания
// молча терялись — usableName считал слово родства не-именем и возвращал "",
// поэтому ни персона, ни факт не создавались. Список закрытый и намеренно
// узкий: только роли, где имя собственное обычно опускают. «Друг», «коллега»,
// «начальник» сюда не входят — их без имени не отличить друг от друга.
const RELATIONSHIP_NAMES = [
  "мама",
  "папа",
  "отец",
  "мать",
  "жена",
  "муж",
  "сын",
  "дочь",
  "брат",
  "сестра",
  "бабушка",
  "дедушка",
  "партнёр",
  "партнер",
  "девушка",
  "парень",
] as const;

// Падежи, которые правило по окончанию не выводит (слова на «ь» и беглые гласные).
const IRREGULAR_RELATIONSHIP_FORMS: Record<string, string[]> = {
  отец: ["отца", "отцу", "отцом", "отце"],
  мать: ["матери", "матерью"],
  дочь: ["дочери", "дочерью", "дочка", "дочки", "дочке", "дочку", "дочкой"],
  муж: ["мужа", "мужу", "мужем", "муже"],
  парень: ["парня", "парню", "парнем", "парне"],
};

function relationshipForms(word: string): string[] {
  const forms = new Set<string>([word, ...(IRREGULAR_RELATIONSHIP_FORMS[word] ?? [])]);
  if (/[ая]$/u.test(word)) {
    const stem = word.slice(0, -1);
    for (const ending of ["ы", "и", "е", "у", "ой", "ей"]) forms.add(stem + ending);
  } else if (/[бвгджзклмнпрстфхцчшщр]$/u.test(word)) {
    for (const ending of ["а", "у", "ом", "ем", "е"]) forms.add(word + ending);
  }
  return [...forms];
}

const RELATIONSHIP_BY_FORM = new Map<string, string>();
for (const word of RELATIONSHIP_NAMES) {
  for (const form of relationshipForms(word)) {
    if (!RELATIONSHIP_BY_FORM.has(form)) RELATIONSHIP_BY_FORM.set(form, word);
  }
}

// Только именительный падеж — для шаблона «жена Аня», где родство стоит перед
// именем. Косвенные падежи сюда не берём: «с мужем Ивана» не должно заводить
// персону «Ивана» с родством «муж».
const relationshipNamePattern = RELATIONSHIP_NAMES.join("|");

/** Каноническое родство, если слово (в любом падеже) им является. */
export function relationshipFromWord(value: string | null | undefined): string | null {
  const key = normalize(String(value ?? "").replace(/[^\p{L}-]/gu, ""));
  if (!key) return null;
  return RELATIONSHIP_BY_FORM.get(key) ?? null;
}

export function displayPersonName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("ru-RU"));
}

export function personNameKeys(value: string): string[] {
  const q = normalize(value);
  if (!q) return [];
  const keys = new Set([q]);
  if (q.endsWith("ме")) keys.add(`${q.slice(0, -1)}а`);
  if (q.endsWith("шке")) keys.add(`${q.slice(0, -1)}а`);
  if (q.endsWith("и") || q.endsWith("ы")) keys.add(`${q.slice(0, -1)}а`);
  if (q.endsWith("ей") || q.endsWith("ой")) keys.add(`${q.slice(0, -2)}а`);
  if (q.endsWith("у") && q.length > 3) keys.add(`${q.slice(0, -1)}а`);
  if (q.endsWith("ю") && q.length > 3) keys.add(`${q.slice(0, -1)}я`);
  if (q.endsWith("а") && q.length > 2) {
    keys.add(`${q.slice(0, -1)}у`);
    keys.add(`${q.slice(0, -1)}е`);
    keys.add(`${q.slice(0, -1)}ы`);
    keys.add(`${q.slice(0, -1)}и`);
  }
  if (q.endsWith("я") && q.length > 2) {
    keys.add(`${q.slice(0, -1)}ю`);
    keys.add(`${q.slice(0, -1)}е`);
    keys.add(`${q.slice(0, -1)}и`);
  }
  return [...keys];
}

export function personMentionedIn(query: string, person: Pick<Person, "name" | "aliases" | "is_self">) {
  if (person.is_self) return false;
  const haystack = ` ${normalize(query).replace(/[^\p{L}-]+/gu, " ")} `;
  const terms = [person.name, ...person.aliases].flatMap(personNameKeys);
  return terms.some((term) => term.length > 1 && haystack.includes(` ${term} `));
}

export async function resolvePerson(
  repository: AppRepository,
  ownerId: string,
  query: string,
): Promise<PersonResolution> {
  const forms = new Set(personNameKeys(query));
  const candidates = (await repository.listPeople(ownerId)).filter(
    (person) =>
      !person.is_self &&
      [person.name, ...person.aliases].some((value) => forms.has(normalize(value))),
  );
  if (candidates.length === 1) return { status: "unique", person: candidates[0]! };
  if (candidates.length > 1) return { status: "ambiguous", people: candidates };
  const byRelationship = (await repository.listPeople(ownerId)).filter(
    (person) =>
      !person.is_self &&
      person.relationship &&
      forms.has(normalize(person.relationship)),
  );
  if (byRelationship.length === 1) return { status: "unique", person: byRelationship[0]! };
  if (byRelationship.length > 1) return { status: "ambiguous", people: byRelationship };
  return { status: "not_found", people: [] };
}

export function parseFactDateParts(value: string): {
  day: number;
  month: number;
  year: number | null;
} | null {
  const dotted = value.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year: number | null = dotted[3] ? Number(dotted[3]) : null;
    if (year != null && year < 100) year += year >= 50 ? 1900 : 2000;
    return { day, month, year };
  }
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  for (const [pattern, month] of MONTHS) {
    const match = value.match(new RegExp(`(\\d{1,2})\\s*${pattern.source}(?:\\s*(\\d{4}))?`, "iu"));
    if (!match) continue;
    const day = Number(match[1]);
    const year = match[2] ? Number(match[2]) : null;
    if (day < 1 || day > 31) continue;
    return { day, month, year };
  }
  return null;
}

export function parseFactDate(value: string): string | null {
  const parts = parseFactDateParts(value);
  if (!parts) return null;
  const year = parts.year ?? 2000;
  return `${String(year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T12:00:00.000Z`;
}

function toOccurredAt(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  return parseFactDate(value);
}

function dateKindFromFact(fact: CompanionPersonFact): PersonDateKind | null {
  if (fact.date_kind) return fact.date_kind;
  const text = `${fact.content ?? ""}`.toLocaleLowerCase();
  if (/рожден|birthday/iu.test(text)) return "birthday";
  if (/свад|wedding|пожени/iu.test(text)) return "wedding";
  if (/знаком|we met/iu.test(text)) return "met";
  if (fact.category === "important_date" && fact.occurred_at) return "other";
  return null;
}

function dateFromFact(fact: CompanionPersonFact) {
  const kind = dateKindFromFact(fact);
  const parts = partsFromIso(toOccurredAt(fact.occurred_at));
  if (!kind || !parts) return null;
  if (kind === "other" && !fact.content?.trim()) return null;
  return {
    kind,
    label: kind === "other" ? fact.content!.trim().slice(0, 80) : null,
    month: parts.month,
    day: parts.day,
    year: fact.date_year === undefined ? parts.year : fact.date_year,
  };
}

function usableName(value: string | null | undefined) {
  // «мама», «у жены», «сыну» — это и есть имя персоны для тех ролей, где
  // имя собственное обычно не называют. Приводим к именительному падежу,
  // чтобы «маме» и «мамы» попадали в одну и ту же карточку.
  const relationship = relationshipFromWord(value);
  if (relationship) return displayPersonName(relationship);
  const name = displayPersonName(value ?? "");
  if (name.length < 2) return "";
  if (SKIP_NAMES.has(normalize(name))) return "";
  if (RELATIONSHIPS.includes(normalize(name) as (typeof RELATIONSHIPS)[number])) return "";
  return name;
}

const INDECLINABLE_NAMES = new Set([
  "мери", "софи", "натали", "эмили", "люси", "гоги", "джонни", "генри", "гарри", "тони", "реми",
]);
const IRREGULAR_GENITIVE_NAMES: Record<string, string> = {
  павла: "Павел",
  льва: "Лев",
  петра: "Пётр",
};

/**
 * «у Кости», «у Оли», «у Ивана» → Костя, Оля, Иван. Правило по окончанию, без
 * словаря: слова родства и несклоняемые имена не трогает. Нужна, чтобы карточка
 * человека называлась именем, а не его родительным падежом.
 */
export function nominativeName(value: string): string {
  const word = value.trim();
  const lower = normalize(word);
  if (word.length < 3 || relationshipFromWord(word) || INDECLINABLE_NAMES.has(lower)) return word;
  if (!/^\p{Lu}/u.test(word)) return word;
  if (IRREGULAR_GENITIVE_NAMES[lower]) return IRREGULAR_GENITIVE_NAMES[lower]!;
  const stem = word.slice(0, -1);
  const before = lower.at(-2) ?? "";
  if (lower.endsWith("ии")) return `${stem}я`;
  if (lower.endsWith("ы")) return `${stem}а`;
  if (lower.endsWith("и")) return /[гкхжшчщ]/u.test(before) ? `${stem}а` : `${stem}я`;
  if (lower.endsWith("а") && /[бвгджзклмнпрстфхцчшщ]/u.test(before)) return stem;
  if (lower.endsWith("я")) return /[аеёиоуыэюя]/u.test(before) ? `${stem}й` : `${stem}ь`;
  return word;
}

function pushFact(
  facts: CompanionPersonFact[],
  fact: Omit<CompanionPersonFact, "date_kind" | "date_year"> &
    Partial<Pick<CompanionPersonFact, "date_kind" | "date_year">>,
) {
  const person_name = usableName(fact.person_name);
  if (!person_name) return;
  const content = fact.content?.trim() || null;
  facts.push({
    person_name,
    relationship:
      fact.relationship?.trim() || relationshipFromWord(fact.person_name) || null,
    content,
    category: content ? fact.category : null,
    occurred_at: toOccurredAt(fact.occurred_at),
    date_kind: fact.date_kind ?? null,
    date_year: fact.date_year ?? null,
  });
}

// Правила дат захватывают всё до запятой или перевода строки, поэтому в текст
// факта утекал остаток предложения: «День рождения 3 октября. На работе отчёт».
// Обрезаем по началу следующего предложения, но не трогаем даты вида 29.03.1994.
function clipFactText(value: string) {
  const cut = value.search(/\.\s+\p{Lu}/u);
  const clipped = (cut >= 0 ? value.slice(0, cut) : value).trim();
  return clipped.replace(/[.!?]+$/g, "").trim();
}

function splitInterests(value: string) {
  return value
    .split(/\s*(?:,| и )\s*/iu)
    .map((part) => part.replace(/[.!?]+$/g, "").trim())
    .filter((part) => part.length > 1)
    // «мама любит керамику, не пьёт кофе» — второй кусок это не интерес,
    // и записывать его как «любит не пьёт кофе» хуже, чем не записать.
    .filter((part) => !/^(?:не|ни)\s/iu.test(part))
    .slice(0, 4);
}

export function inferCompanionPersonFacts(
  text: string,
  options?: { maxLength?: number },
): CompanionPersonFact[] {
  const t = text.replace(/^сделай сам:\s*/iu, "").trim();
  if (t.length < 6 || t.length > (options?.maxLength ?? 500)) return [];
  const facts: CompanionPersonFact[] = [];
  let currentName = "";
  let currentRelationship: string | null = null;

  const intro = [
    ...t.matchAll(
      new RegExp(
        `(?:у\\s+меня\\s+есть|есть|это\\s+мой|это\\s+моя|мой|моя)\\s+(${relationshipPattern})\\s+([\\p{L}-]{2,30})`,
        "giu",
      ),
    ),
  ];
  for (const match of intro) {
    currentRelationship = normalize(match[1]!);
    currentName = usableName(match[2]!);
    pushFact(facts, {
      person_name: currentName,
      relationship: currentRelationship,
      content: null,
      category: null,
      occurred_at: null,
    });
  }

  // «жена Аня, сын Лёва» — так люди описывают семью в анкете и в письме.
  // Родство берём только в именительном падеже, а имя обязано начинаться с
  // заглавной: иначе «жена любит пионы» завело бы персону «Любит».
  const bare = [
    ...t.matchAll(
      new RegExp(
        `(?:^|[\\s,;.:()«"-])(${relationshipNamePattern})\\s+([\\p{L}-]{2,30})`,
        // i — ради «Жена Марина» в начале предложения; заглавную у имени
        // проверяем ниже руками, потому что с флагом i \\p{Lu} её не различает.
        "giu",
      ),
    ),
  ];
  for (const match of bare) {
    if (!/^\p{Lu}/u.test(match[2]!)) continue;
    const name = usableName(match[2]!);
    if (!name || relationshipFromWord(match[2]!)) continue;
    currentRelationship = normalize(match[1]!);
    currentName = name;
    pushFact(facts, {
      person_name: name,
      relationship: currentRelationship,
      content: null,
      category: null,
      occurred_at: null,
    });
  }

  // «дима любит машины», «мама любит керамику» — здесь и появляется человек,
  // о котором идёт речь дальше («её день рождения…»), поэтому правило стоит
  // до дат и обновляет currentName.
  const likes = [
    ...t.matchAll(/([\p{L}-]{2,30})\s+(не\s+любит|любит|фанат)\s+(.+)/giu),
  ];
  for (const match of likes) {
    const name = usableName(match[1]);
    if (!name) continue;
    const verb = normalize(match[2]!);
    const category: MemoryCategory = verb.includes("не") ? "dislike" : "interest";
    const prefix = category === "dislike" ? "не любит" : "любит";
    const relationship =
      relationshipFromWord(match[1]) ?? (name === currentName ? currentRelationship : null);
    currentName = name;
    currentRelationship = relationship;
    for (const item of splitInterests(match[3]!)) {
      pushFact(facts, {
        person_name: name,
        relationship,
        content: `${prefix} ${item}`,
        category,
        occurred_at: null,
      });
    }
  }

  // «у мамы день рождения 3 октября» — хозяин даты стоит ПЕРЕД словами
  // «день рождения», поэтому общее правило ниже его не видит и привязало бы
  // дату к последнему упомянутому человеку. Разбираем отдельно и вычёркиваем
  // разобранный кусок, чтобы общее правило не продублировало ту же дату.
  let birthdayScan = t;
  // «у Димы день рождения…» в начале текста уже разобрано здесь; общее правило
  // «у X …» в конце не должно завести второго человека из того же куска.
  let birthdayAtStart = false;
  const ownedBirthday = [
    ...t.matchAll(
      // \b здесь бесполезен: в JS это граница ASCII-слова, а вокруг кириллица.
      /(?:^|[\s,;:(.!?])у\s+(?!меня\s)([\p{L}-]{2,30})(?:\s+([\p{L}-]{2,30}))?\s+(?:день\s*рожден\p{L}*|др\.?)[\s,:—-]*([^\n,;]+)/giu,
    ),
  ];
  for (const match of ownedBirthday) {
    const said = clipFactText(match[3] ?? "");
    const parts = parseFactDateParts(said);
    const occurred_at = parts ? parseFactDate(said) : null;
    if (!occurred_at || !parts) continue;
    // «у брата Кости день рождения…» — родство и имя в родительном падеже.
    // Без этого дата уходила последнему названному человеку, а брат терялся.
    const role = relationshipFromWord(match[1]);
    const given = match[2] && /^\p{Lu}/u.test(match[2]) ? match[2] : "";
    if (match[2] && !(role && given)) continue;
    const name = given ? usableName(nominativeName(given)) : usableName(nominativeName(match[1]!));
    if (!name) continue;
    birthdayScan = birthdayScan.replace(match[0]!, " ".repeat(match[0]!.length));
    if ((match.index ?? 0) <= 1) birthdayAtStart = true;
    if (given) {
      currentName = name;
      currentRelationship = role;
    }
    pushFact(facts, {
      person_name: name,
      relationship: role,
      content: `День рождения ${said}`,
      category: "important_date",
      occurred_at,
      date_kind: "birthday",
      date_year: parts.year,
    });
  }

  const birthday = [
    ...birthdayScan.matchAll(
      // \p{L}* вместо \w*: \w в JS не покрывает кириллицу, из-за чего хвост
      // слова («…рождени|я») утекал в текст факта — «День рождения ия 3 октября».
      /(?:день\s*рожден\p{L}*|др\.?|родился|родилась|birthday)(?:\s+у\s+([\p{L}-]+))?[\s,:—-]*([^\n,;]+)/giu,
    ),
  ];
  for (const match of birthday) {
    const said = clipFactText(match[2] ?? "");
    const parts = parseFactDateParts(said);
    const occurred_at = parts ? parseFactDate(said) : null;
    if (!occurred_at || !parts) continue;
    const name = usableName(match[1]) || currentName;
    if (!name) continue;
    pushFact(facts, {
      person_name: name,
      relationship: name === currentName ? currentRelationship : null,
      content: `День рождения ${said}`,
      category: "important_date",
      occurred_at,
      date_kind: "birthday",
      date_year: parts.year,
    });
  }

  const met = [
    ...t.matchAll(
      /(?:познакомил(?:ись|ся|ась)|дата знакомства|we met)(?:\s+(?:с|у|with)\s+([\p{L}-]+))?[\s,:—-]*([^\n,;]+)/giu,
    ),
  ];
  for (const match of met) {
    const said = clipFactText(match[2] ?? "");
    const parts = parseFactDateParts(said);
    const occurred_at = parts ? parseFactDate(said) : null;
    if (!occurred_at || !parts) continue;
    const name = usableName(match[1]) || currentName;
    if (!name) continue;
    pushFact(facts, {
      person_name: name,
      relationship: name === currentName ? currentRelationship : null,
      content: `Знакомство ${said}`,
      category: "important_date",
      occurred_at,
      date_kind: "met",
      date_year: parts.year,
    });
  }

  const wedding = [
    ...t.matchAll(
      /(?:свадьб\p{L}*|поженились|годовщина\s+свадьбы|wedding)(?:\s+(?:у|с|of|for)\s+([\p{L}-]+))?[\s,:—-]*([^\n,;]+)/giu,
    ),
  ];
  for (const match of wedding) {
    const said = clipFactText(match[2] ?? "");
    const parts = parseFactDateParts(said);
    const occurred_at = parts ? parseFactDate(said) : null;
    if (!occurred_at || !parts) continue;
    const name = usableName(match[1]) || currentName;
    if (!name) continue;
    pushFact(facts, {
      person_name: name,
      relationship: name === currentName ? currentRelationship : null,
      content: `Свадьба ${said}`,
      category: "important_date",
      occurred_at,
      date_kind: "wedding",
      date_year: parts.year,
    });
  }

  const possessive = t.match(new RegExp(`^у\\s+(?!меня\\b)([\\p{L}-]+)\\s+(.+)$`, "iu"));
  if (possessive && !likes.length && !birthdayAtStart) {
    const name = usableName(possessive[1]);
    const content = possessive[2]!.trim();
    const alreadyDated = facts.some(
      (fact) => normalize(fact.person_name) === normalize(name) && fact.date_kind,
    );
    if (name && content && !alreadyDated && !/^есть\b/iu.test(content)) {
      const normalized = content.toLocaleLowerCase();
      const category: MemoryCategory = normalized.includes("не любит")
        ? "dislike"
        : normalized.includes("любит")
          ? "interest"
          : /рожден|праздник|свад|знаком/iu.test(normalized)
            ? "important_date"
            : "important_fact";
      const parts = parseFactDateParts(content);
      pushFact(facts, {
        person_name: name,
        relationship: null,
        content,
        category,
        occurred_at: parseFactDate(content),
        date_kind:
          category === "important_date"
            ? /рожден|birthday/iu.test(normalized)
              ? "birthday"
              : /свад|wedding|пожени/iu.test(normalized)
                ? "wedding"
                : /знаком|met/iu.test(normalized)
                  ? "met"
                  : "other"
            : null,
        date_year: parts?.year ?? null,
      });
    }
  }

  const unique: CompanionPersonFact[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const key = `${normalize(fact.person_name)}:${fact.relationship ?? ""}:${normalize(fact.content ?? "")}:${fact.category ?? ""}:${fact.date_kind ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
  }
  return unique.slice(0, 8);
}

function categoryFromContent(content: string): MemoryCategory {
  const text = content.toLocaleLowerCase();
  if (/рожден|birthday|свад|wedding|годовщин|знаком/iu.test(text)) return "important_date";
  if (/не\s+(?:любит|ест|пь[её]т|переносит|нос[ия]т)|аллерг|ненавид/iu.test(text)) return "dislike";
  if (/любит|обожает|увлека|фанат|нравит|коллекцион/iu.test(text)) return "interest";
  return "important_fact";
}

/**
 * Даты, которые человек назвал прямо («у сестры Оли день рождения 14 ноября»),
 * а модель в person_facts не вернула. Берём их из разбора текста, чтобы день
 * рождения не зависел от того, вспомнила ли модель про поле occurred_at.
 */
export function withStatedDates(
  facts: CompanionPersonFact[],
  text: string,
): CompanionPersonFact[] {
  const named = new Set(facts.map((fact) => normalize(usableName(fact.person_name))).filter(Boolean));
  if (!named.size) return facts;
  const extra = inferCompanionPersonFacts(text).filter((stated) => {
    if (!stated.date_kind || !stated.occurred_at) return false;
    const name = normalize(stated.person_name);
    if (!named.has(name)) return false;
    return !facts.some(
      (fact) =>
        normalize(usableName(fact.person_name)) === name &&
        (fact.date_kind === stated.date_kind ||
          Boolean(fact.occurred_at) ||
          /рожден|birthday|свад|знаком/iu.test(fact.content ?? "")),
    );
  });
  return extra.length ? [...facts, ...extra] : facts;
}

export async function applyCompanionPersonFacts(
  repository: AppRepository,
  ownerId: string,
  facts: CompanionPersonFact[],
  sourceMessageId?: string,
): Promise<PersonEntity[]> {
  const entities: PersonEntity[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const name = usableName(fact.person_name);
    if (!name) continue;
    // Модель часто возвращает person_name: "мама" без relationship — тогда
    // родство выводим из самого слова, иначе карточка останется безымянной ролью.
    const relationship =
      fact.relationship || relationshipFromWord(fact.person_name) || relationshipFromWord(name);
    const resolved = await resolvePerson(repository, ownerId, name);
    let person: Person | null = null;
    if (resolved.status === "unique") person = resolved.person;
    else if (resolved.status === "not_found") {
      person = await repository.createPerson(ownerId, {
        name,
        relationship,
      });
    } else {
      person =
        resolved.people.find((item) => normalize(item.name) === normalize(name)) ?? null;
    }
    if (!person || person.is_self) continue;
    if (relationship && person.relationship !== relationship) {
      const updated = await repository.updatePerson(ownerId, person.id, {
        relationship,
      });
      if (updated) person = updated;
    }
    // Модель нередко присылает текст факта без категории или дату только в
    // самом тексте. Раньше такой факт молча пропадал: карточка создавалась
    // пустой, а Илзи уже ответила «запомнила».
    const category = fact.content ? (fact.category ?? categoryFromContent(fact.content)) : null;
    const occurredAt =
      toOccurredAt(fact.occurred_at) ??
      (fact.content && /рожден|birthday|свад|wedding|знаком/iu.test(fact.content)
        ? parseFactDate(fact.content)
        : null);
    if (fact.content && category) {
      await repository.createMemory(ownerId, person.id, {
        content: fact.content,
        category,
        source_message_id: sourceMessageId ?? null,
        importance: category === "important_date" ? 5 : 4,
        confidence: 0.9,
        occurred_at: occurredAt,
        metadata: { source: "companion" },
      });
    }
    const dated = dateFromFact({ ...fact, category, occurred_at: occurredAt });
    if (dated) {
      await repository.createDate(ownerId, person.id, dated);
    }
    if (!seen.has(person.id)) {
      seen.add(person.id);
      entities.push({ type: "person", id: person.id, label: person.name });
    }
  }
  return entities;
}

export function formatPersonSaveAnswer(facts: CompanionPersonFact[], entities: PersonEntity[]) {
  if (!entities.length) return "";
  const names = entities.map((entity) => entity.label);
  const details = facts
    .filter((fact) => fact.content)
    .map((fact) => fact.content)
    .slice(0, 4);
  const relationship = facts.find((fact) => fact.relationship)?.relationship;
  const intro = relationship
    ? `Записал ${names.join(", ")} (${relationship})`
    : `Записал ${names.join(", ")}`;
  return details.length ? `${intro}: ${details.join("; ")}.` : `${intro}.`;
}
