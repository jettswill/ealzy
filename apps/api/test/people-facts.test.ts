import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  applyCompanionPersonFacts,
  CompanionPersonFactSchema,
  inferCompanionPersonFacts,
  selfFactIsAboutSavedPerson,
  parseFactDate,
  relationshipFromWord,
} from "../src/modules/assistant/people.js";
import { savePeopleFromBio } from "../src/modules/assistant/first-session.js";

describe("companion person facts", () => {
  it("accepts the field names the chat model tends to use instead of the schema ones", async () => {
    const fact = CompanionPersonFactSchema.parse({
      name: "Оля",
      relation: "сестра",
      birthday: "14.11",
    });
    expect(fact).toMatchObject({
      person_name: "Оля",
      relationship: "сестра",
      occurred_at: "14.11",
      date_kind: "birthday",
    });
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 501, name: "A" });
    const entities = await applyCompanionPersonFacts(repository, user.id, [fact]);
    expect(entities.map((entity) => entity.label)).toEqual(["Оля"]);
    const people = await repository.listPeople(user.id);
    const olya = people.find((person) => person.name === "Оля");
    expect(olya?.relationship).toBe("сестра");
  });

  it("reads family from an onboarding bio: capitalised role, and a birthday owned by «у брата Кости»", () => {
    const facts = inferCompanionPersonFacts(
      "Дизайнер-фрилансер. Жена Марина, дочь Соня 5 лет. У брата Кости день рождения 20 октября. Важно не срывать сроки.",
      { maxLength: 2000 },
    );
    expect(facts.map((fact) => [fact.person_name, fact.relationship, fact.date_kind])).toEqual([
      ["Марина", "жена", null],
      ["Соня", "дочь", null],
      ["Костя", "брат", "birthday"],
    ]);
    expect(facts[2]?.occurred_at).toBe("2000-10-20T12:00:00.000Z");
  });

  it("names the person in the nominative when the birthday is said as «у Оли», «у Павла»", () => {
    const one = (text: string) => inferCompanionPersonFacts(text).map((fact) => fact.person_name);
    expect(one("Запомни: у сестры Оли день рождения 14 ноября")).toEqual(["Оля"]);
    expect(one("у Димы день рождения 29.03.1994")).toEqual(["Дима"]);
    expect(one("у Павла день рождения 3 марта")).toEqual(["Павел"]);
    expect(one("у мамы день рождения 3 октября")).toEqual(["Мама"]);
  });

  it("keeps a fact about a saved person out of the user's own facts", () => {
    const facts = [{ person_name: "Оля", relationship: "сестра" }];
    expect(selfFactIsAboutSavedPerson("У сестры Оли день рождения 14 ноября", facts)).toBe(true);
    expect(selfFactIsAboutSavedPerson("Сестра любит горький шоколад", facts)).toBe(true);
    expect(selfFactIsAboutSavedPerson("Руковожу отделом маркетинга", facts)).toBe(false);
    expect(selfFactIsAboutSavedPerson("Люблю бегать по утрам", [])).toBe(false);
  });

  it("parses a friend, birthday and interests from natural phrases", () => {
    const intro = inferCompanionPersonFacts(
      "у меня есть друг дима, день рождения 29.03.1994",
    );
    expect(intro).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ person_name: "Дима", relationship: "друг" }),
        expect.objectContaining({
          person_name: "Дима",
          category: "important_date",
          occurred_at: "1994-03-29T12:00:00.000Z",
        }),
      ]),
    );
    const likes = inferCompanionPersonFacts("дима любит машины и бмв");
    expect(likes.map((fact) => fact.content)).toEqual(["любит машины", "любит бмв"]);
    expect(parseFactDate("29 марта 1994")).toBe("1994-03-29T12:00:00.000Z");
  });

  it("parses wedding and when-we-met dates", () => {
    expect(inferCompanionPersonFacts("познакомились 12 марта 2020")).toEqual([]);
    const withName = inferCompanionPersonFacts(
      "у меня есть подруга маша, познакомились 12 марта 2020, свадьба 5 июня 2022",
    );
    expect(withName).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ person_name: "Маша", date_kind: "met", date_year: 2020 }),
        expect.objectContaining({ person_name: "Маша", date_kind: "wedding", date_year: 2022 }),
      ]),
    );
  });

  it("creates a person profile and memories", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 1, name: "A" })).id;
    const facts = inferCompanionPersonFacts(
      "у меня есть друг дима, день рождения 29.03.1994",
    );
    const entities = await applyCompanionPersonFacts(repository, owner, facts, "msg-1");
    const dima = (await repository.listPeople(owner)).find((person) => person.name === "Дима");
    expect(dima?.relationship).toBe("друг");
    expect(entities).toEqual([expect.objectContaining({ type: "person", label: "Дима" })]);
    expect(await repository.listMemories(owner, dima!.id)).toEqual([
      expect.objectContaining({
        category: "important_date",
        source_message_id: "msg-1",
      }),
    ]);
    expect(await repository.listDates(owner, dima!.id)).toEqual([
      expect.objectContaining({ kind: "birthday", month: 3, day: 29, year: 1994 }),
    ]);
    await applyCompanionPersonFacts(
      repository,
      owner,
      inferCompanionPersonFacts("дима любит машины и бмв"),
    );
    const memories = await repository.listMemories(owner, dima!.id);
    expect(memories.filter((memory) => memory.category === "interest")).toHaveLength(2);
    expect((await repository.listPeople(owner)).filter((person) => !person.is_self)).toHaveLength(1);
  });

  it("treats a relationship word as the person when no name is given", () => {
    const facts = inferCompanionPersonFacts(
      "мама любит керамику ручной работы и пионы, не пьёт кофе. Её день рождения 3 октября.",
    );
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          person_name: "Мама",
          relationship: "мама",
          content: "любит керамику ручной работы",
        }),
        expect.objectContaining({ person_name: "Мама", content: "любит пионы" }),
        expect.objectContaining({
          person_name: "Мама",
          date_kind: "birthday",
          occurred_at: "2000-10-03T12:00:00.000Z",
        }),
      ]),
    );
    // «не пьёт кофе» — не интерес, записывать его как «любит не пьёт кофе» нельзя.
    expect(facts.some((fact) => fact.content?.includes("не пьёт"))).toBe(false);
  });

  it("maps inflected relationship words to one canonical person", () => {
    expect(relationshipFromWord("мамы")).toBe("мама");
    expect(relationshipFromWord("сыну")).toBe("сын");
    expect(relationshipFromWord("матери")).toBe("мать");
    expect(relationshipFromWord("коллеги")).toBeNull();
  });

  it("does not invent a person from an oblique relationship before a name", () => {
    expect(inferCompanionPersonFacts("обсудил с мужем Ивана подготовку отчёта")).toEqual([]);
  });

  it("turns the onboarding bio into people and dates", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 7, name: "A" })).id;
    await savePeopleFromBio(
      repository,
      owner,
      "Руковожу отделом маркетинга, двое детей. Сейчас важно не заваливать семью: жена Аня, сын Лёва 7 лет, у мамы день рождения 3 октября. На работе квартальный отчёт.",
    );
    const people = (await repository.listPeople(owner)).filter((person) => !person.is_self);
    expect(people.map((person) => [person.name, person.relationship]).sort()).toEqual([
      ["Аня", "жена"],
      ["Лёва", "сын"],
      ["Мама", "мама"],
    ]);
    const mother = people.find((person) => person.name === "Мама")!;
    expect(await repository.listDates(owner, mother.id)).toEqual([
      expect.objectContaining({ kind: "birthday", month: 10, day: 3 }),
    ]);
  });
});
