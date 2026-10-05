import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  applyCompanionTaskActions,
  datesInAnswer,
  dueDayMonth,
  groundCompanionTaskAnswer,
  type CompanionTaskAction,
} from "../src/modules/assistant/companion.js";
import { applyBrainDump } from "../src/modules/assistant/first-session.js";

const createAction = (title: string, dueAt: string | null = null): CompanionTaskAction => ({
  op: "create",
  task_id: null,
  title,
  due_at: dueAt,
  estimate_minutes: null,
  goal_id: null,
  project_id: null,
  kind: "task",
  importance: null,
  urgency: null,
  assignee: "user",
});

async function seedOwner() {
  const repository = new InMemoryRepository();
  const owner = (await repository.upsertTelegramUser({ telegram_id: 11, name: "A" })).id;
  return { repository, owner };
}

describe("связка дела с человеком и целью", () => {
  it("привязывает дело к человеку, о котором шёл разговор", async () => {
    const { repository, owner } = await seedOwner();
    const mother = await repository.createPerson(owner, { name: "Мама", relationship: "мама" });
    const entities = await applyCompanionTaskActions(
      repository,
      owner,
      [createAction("Купить подарок")],
      { timezone: "Europe/Moscow", userText: "Что подарить маме на день рождения?" },
    );
    expect(entities).toHaveLength(1);
    const task = (await repository.listTasks(owner)).find((item) => item.title === "Купить подарок");
    expect(task?.person_id).toBe(mother.id);
  });

  it("не привязывает дело к недавно обсуждённой цели", async () => {
    // Продукт сознательно этого не делает: «купить молоко» не должно оказаться
    // в цели «Выучить французский». Проверяем, что связка людей это не сломала.
    const { repository, owner } = await seedOwner();
    await repository.createGoal(owner, { title: "Выучить французский", priority: 4 });
    await applyCompanionTaskActions(repository, owner, [createAction("Купить молоко")], {
      timezone: "Europe/Moscow",
      userText: "купить молоко",
    });
    const task = (await repository.listTasks(owner)).find((item) => item.title === "Купить молоко");
    expect(task?.goal_id).toBeNull();
  });

  it("не угадывает, когда кандидатов несколько", async () => {
    const { repository, owner } = await seedOwner();
    await repository.createPerson(owner, { name: "Аня", relationship: "жена" });
    await repository.createPerson(owner, { name: "Лёва", relationship: "сын" });
    await applyCompanionTaskActions(repository, owner, [createAction("Забронировать столик")], {
      timezone: "Europe/Moscow",
      userText: "Хочу сводить Аню и Лёву поужинать",
    });
    const task = (await repository.listTasks(owner)).find(
      (item) => item.title === "Забронировать столик",
    );
    expect(task?.person_id).toBeNull();
  });

  it("связывает дела из выгрузки головы по названию", async () => {
    const { repository, owner } = await seedOwner();
    const lev = await repository.createPerson(owner, { name: "Лёва", relationship: "сын" });
    const result = await applyBrainDump(
      repository,
      owner,
      "Дописать квартальный отчёт\nЗаписать Лёву к стоматологу",
    );
    const dentist = result.tasks.find((task) => task.title.includes("стоматолог"));
    const report = result.tasks.find((task) => task.title.includes("отчёт"));
    expect(dentist?.person_id).toBe(lev.id);
    expect(report?.person_id).toBeNull();
  });
});

describe("сверка названной даты с записанной", () => {
  it("находит явные даты в ответе и не ловит лишнее", () => {
    expect(datesInAnswer("ставлю задачу купить подарок до 1 октября")).toEqual([
      { day: 1, month: 10 },
    ]);
    expect(datesInAnswer("Срок 29.03, не позже")).toEqual([{ day: 29, month: 3 }]);
    expect(datesInAnswer("сын Лёва 7 лет")).toEqual([]);
    expect(datesInAnswer("Поставил на завтра, к вечеру.")).toEqual([]);
  });

  it("читает срок в часовом поясе пользователя", () => {
    expect(dueDayMonth("2026-10-03T09:00:00+00:00", "Europe/Moscow")).toEqual({ day: 3, month: 10 });
    expect(dueDayMonth("2026-10-03T21:30:00+00:00", "Europe/Moscow")).toEqual({ day: 4, month: 10 });
  });

  it("дописывает настоящий срок, когда в ответе названа другая дата", () => {
    // Реальный случай из прода: в ответе «до 1 октября», в базе — 3 октября.
    const answer =
      "Отлично, ищу мастерские по керамике в Москве и ставлю задачу купить подарок до 1 октября. " +
      "Дальше можно будет выбрать конкретную мастерскую и записаться, чтобы успеть без спешки и не откладывать всё на последний день. " +
      "Если захочешь, отдельно посмотрю флористов и сравню, что удобнее по дороге, а ещё подскажу, как упаковать, чтобы довезти целым.";
    const grounded = groundCompanionTaskAnswer(
      answer,
      [
        {
          type: "task",
          id: "t1",
          label: "Купить подарок маме",
          op: "create",
          due_at: "2026-10-03T09:00:00.000Z",
        },
      ],
      { locale: "ru", timezone: "Europe/Moscow" },
    );
    expect(grounded).not.toBe(answer);
    expect(grounded).toContain("Купить подарок маме");
    expect(grounded).toMatch(/3 окт/);
  });

  it("молчит, когда названная дата совпадает с записанной", () => {
    const answer =
      "Записала: купить подарок маме к 3 октября, чтобы не оставлять это на последний день, " +
      "и заодно посмотреть варианты заранее — так спокойнее и выбор шире, чем в день перед самым праздником. " +
      "Если появится идея получше, поменяем: пока это просто напоминание не упустить дату, а не окончательное решение.";
    const grounded = groundCompanionTaskAnswer(
      answer,
      [
        {
          type: "task",
          id: "t1",
          label: "купить подарок маме",
          op: "create",
          due_at: "2026-10-03T09:00:00.000Z",
        },
      ],
      { locale: "ru", timezone: "Europe/Moscow" },
    );
    expect(grounded).toBe(answer);
  });
});
