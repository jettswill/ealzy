import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  applyDatePrepProject,
  datePrepOffers,
  inferDatePrepProject,
  inferPersonGender,
  inferRelationRole,
  suggestDatePrepActions,
} from "../src/modules/assistant/date-prep.js";

describe("date prep gender and relationship", () => {
  it("infers gender from relationship and Russian names", () => {
    expect(inferPersonGender({ name: "Катя", relationship: "девушка" })).toBe("female");
    expect(inferPersonGender({ name: "Дима", relationship: "друг" })).toBe("male");
    expect(inferPersonGender({ name: "Маша" })).toBe("female");
    expect(inferPersonGender({ name: "Иван" })).toBe("male");
    expect(inferRelationRole("жена")).toBe("partner");
    expect(inferRelationRole("коллега")).toBe("colleague");
  });

  it("never suggests flowers for a man, including a male friend", () => {
    const actions = suggestDatePrepActions({
      item: {
        person: "Дима",
        relationship: "друг",
        gender: "male",
        label: "День рождения",
        kind: "birthday",
      },
      selfGender: "male",
    });
    expect(actions).toContain("gift");
    expect(actions).not.toContain("flowers");
  });

  it("suggests flowers and a table for a girlfriend or wife", () => {
    expect(
      suggestDatePrepActions({
        item: {
          person: "Катя",
          relationship: "девушка",
          gender: "female",
          label: "День рождения",
          kind: "birthday",
        },
        selfGender: "male",
      }),
    ).toEqual(["gift", "flowers", "table"]);
  });

  it("skips a romantic table and flowers for a colleague", () => {
    expect(
      suggestDatePrepActions({
        item: {
          person: "Оля",
          relationship: "коллега",
          gender: "female",
          label: "День рождения",
          kind: "birthday",
        },
      }),
    ).toEqual(["gift"]);
  });
});

describe("date prep offers and project", () => {
  it("uses past gifts as format and budget, without copying them", () => {
    const offers = datePrepOffers([
      {
        person: "Катя",
        relationship: "девушка",
        gender: "female",
        label: "День рождения",
        date: "2026-09-25",
        days_until: 14,
        kind: "birthday",
        gift_history: ["на прошлый день рождения дарили последний iPhone"],
        tastes: ["техника"],
      },
    ]);
    expect(offers[0]?.instruction).toMatch(/iPhone/);
    expect(offers[0]?.instruction).toMatch(/не копируй|формату и бюджету/);
    expect(offers.some((offer) => offer.title.startsWith("Проект:"))).toBe(true);
    expect(offers.find((offer) => offer.kind === "plan")?.instruction).toMatch(
      /пустой проект|Empty project/,
    );
    expect(offers.find((offer) => offer.kind === "plan")?.instruction).not.toMatch(
      /с подзадачами/,
    );
  });

  it("parses a project chip and creates the project only when asked", async () => {
    expect(inferDatePrepProject("привет")).toBeNull();
    const draft = inferDatePrepProject(
      "Создай проект «День рождения Кати». Срок 2026-09-25. Только пустой проект, без дел.",
    );
    expect(draft).toEqual({
      name: "День рождения Кати",
      due_at: "2026-09-25",
    });
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 91, name: "A" })).id;
    const created = await applyDatePrepProject(
      repository,
      owner,
      "Создай проект «День рождения Кати». Срок 2026-09-25. Только пустой проект, без дел.",
    );
    expect(created?.created).toBe(true);
    expect((await repository.listProjects(owner)).map((item) => item.name)).toEqual([
      "День рождения Кати",
    ]);
    expect(await repository.listTasks(owner)).toEqual([]);
    const again = await applyDatePrepProject(
      repository,
      owner,
      "Создай проект «День рождения Кати». Срок 2026-09-25. Только пустой проект, без дел.",
      await repository.listProjects(owner),
    );
    expect(again?.created).toBe(false);
    expect(await repository.listTasks(owner)).toEqual([]);
  });
});
