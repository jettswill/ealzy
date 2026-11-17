import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  applyCompanionTaskActions,
  companionClock,
  endOfIsoWeek,
  groundCompanionTaskAnswer,
  groundCompanionAgendaAnswer,
  groundRejectedGoalWriteAnswer,
  resolveCompanionDueAt,
  normalizeTaskTitle,
  parseEstimateMinutes,
  similarTaskTitles,
  agendaQueryDay,
  packCompanionTaskDue,
  omitAgendaMutations,
  inferCompanionTaskActions,
  mergeCompanionTaskActions,
  isDescriptionEditIntent,
  normalizeDescriptionEdits,
  parseCompanionResponse,
  resolveDescriptionTarget,
  titleFromQuotedMessage,
  conversationTurns,
  type CompanionTaskAction,
} from "../src/modules/assistant/companion.js";
import {
  continuedGoalWriteIntent,
  goalRefineIntent,
  goalSyncAllowsCreate,
  isGoalTopicShift,
  shouldReplaceGoalTitle,
  similarGoalTitles,
} from "../src/modules/assistant/goal-plan.js";

const friday = new Date("2026-08-28T12:00:00.000Z");

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

describe("resolveCompanionDueAt", () => {
  const now = new Date("2026-08-27T15:00:00.000Z");

  it("maps «на сегодня» to today even when the model sends a stale date", () => {
    expect(
      resolveCompanionDueAt("2023-10-27", "Europe/Moscow", "добавь дело на сегодня", now),
    ).toBe("2026-08-27T09:00:00.000Z");
  });

  it("stores a date without a user-specified time as local noon", () => {
    expect(resolveCompanionDueAt("2026-08-28", "Europe/Moscow", "перенеси на завтра", now)).toBe(
      "2026-08-28T09:00:00.000Z",
    );
  });

  it("keeps the time when the user explicitly specifies it", () => {
    expect(
      resolveCompanionDueAt(
        "2026-08-28T15:30:00.000Z",
        "Europe/Moscow",
        "перенеси на завтра в 18:30",
        now,
      ),
    ).toBe("2026-08-28T15:30:00.000Z");
  });

  it("accepts today/tomorrow tokens from the model when the user named a day", () => {
    expect(resolveCompanionDueAt("today", "UTC", "remind me today", now)).toBe(
      "2026-08-27T12:00:00.000Z",
    );
    expect(resolveCompanionDueAt("завтра", "UTC", "позвони маме завтра", now)).toBe(
      "2026-08-28T12:00:00.000Z",
    );
  });

  it("keeps a future ISO date the user named", () => {
    expect(resolveCompanionDueAt("2026-12-01", "UTC", "купи билеты до 1 декабря", now)).toBe(
      "2026-12-01T12:00:00.000Z",
    );
    expect(resolveCompanionDueAt("2026-12-01", "UTC", "купи билеты к 1.12", now)).toBe(
      "2026-12-01T12:00:00.000Z",
    );
  });

  it("drops a date the model invented when the user named none", () => {
    expect(resolveCompanionDueAt("2026-12-01", "UTC", "купи билеты", now)).toBeNull();
    expect(resolveCompanionDueAt("tomorrow", "UTC", "позвони маме", now)).toBeNull();
    expect(
      resolveCompanionDueAt("2026-09-12", "UTC", "Нужно разобрать внутренние документы", now),
    ).toBeNull();
  });

  it("maps «до конца декабря» to December 31 regardless of the model's guess", () => {
    expect(
      resolveCompanionDueAt("2026-11-29", "UTC", "Надо сделать отчёт до конца декабря", now),
    ).toBe("2026-12-31T12:00:00.000Z");
    expect(resolveCompanionDueAt(null, "UTC", "закрыть долги до конца месяца", now)).toBe(
      "2026-08-31T12:00:00.000Z",
    );
    expect(resolveCompanionDueAt(null, "UTC", "к концу года выучить испанский", now)).toBe(
      "2026-12-31T12:00:00.000Z",
    );
  });

  it("maps «до конца следующей недели» to the next Sunday, not a hallucinated month", () => {
    expect(
      resolveCompanionDueAt(
        "2026-11-03",
        "UTC",
        "Надо до конца следующей недели это сделать",
        friday,
      ),
    ).toBe("2026-09-06T12:00:00.000Z");
  });

  it("reads the deadline from a recent turn when the current message has no date", () => {
    expect(
      resolveCompanionDueAt(null, "UTC", "Сделал?", friday, [
        "Сегодня август",
        "Ноября?",
        "Надо до конца следующей недели это сделать",
      ]),
    ).toBe("2026-09-06T12:00:00.000Z");
  });

  it("does not treat «Сегодня август» as a due date", () => {
    expect(resolveCompanionDueAt(null, "UTC", "Сегодня август", friday)).toBeNull();
  });

  it("does not schedule from an agenda question about today", () => {
    expect(
      resolveCompanionDueAt(null, "Europe/Moscow", "какие дела есть на сегодня?", now),
    ).toBeNull();
    expect(
      resolveCompanionDueAt(null, "Europe/Moscow", "кактe дела есть на сегодня", now),
    ).toBeNull();
  });
});

describe("parseEstimateMinutes", () => {
  it("reads an effort from the user text and ignores a clock time", () => {
    expect(parseEstimateMinutes("добавь звонок на 20 минут")).toBe(20);
    expect(parseEstimateMinutes("займёт полчаса")).toBe(30);
    expect(parseEstimateMinutes("это на 2 часа")).toBe(120);
    expect(parseEstimateMinutes("перенеси на завтра в 15:00")).toBeNull();
  });
});

describe("companionClock", () => {
  it("exposes the current date and week bounds", () => {
    expect(companionClock("UTC", friday)).toMatchObject({
      date: "2026-08-28",
      weekday: "Friday",
      end_of_this_week: "2026-08-30",
      end_of_next_week: "2026-09-06",
    });
    expect(endOfIsoWeek("2026-08-28", 1)).toBe("2026-09-06");
  });
});

describe("similarTaskTitles", () => {
  it("treats the same errand as one task", () => {
    expect(similarTaskTitles("Снять машины с учета в МРЭО", "Снять машины с учета в мрэо")).toBe(
      true,
    );
    expect(similarTaskTitles("Позвонить в банк", "Позвонить маме")).toBe(false);
  });

  it("keeps distinct quantities as distinct tasks", () => {
    expect(similarTaskTitles("Anki 20 карточек", "Anki 10 карточек вечером")).toBe(false);
    expect(similarTaskTitles("Anki 20 карточек", "Anki 20 карточек вечером")).toBe(true);
  });
});

describe("similarGoalTitles", () => {
  it("matches a short restatement of the same outcome", () => {
    expect(similarGoalTitles("Выучить французский", "французский")).toBe(true);
  });

  it("does not merge outcomes that differ by quantity", () => {
    expect(similarGoalTitles("Пробежать 10 км", "Пробежать 5 км")).toBe(false);
  });

  it("does not merge distinct outcomes that share a verb", () => {
    expect(similarGoalTitles("Выучить французский язык", "Выучить испанский язык")).toBe(false);
  });
});

describe("shouldReplaceGoalTitle", () => {
  it("does not shrink a specific goal to a short restatement", () => {
    expect(shouldReplaceGoalTitle("Выучить французский", "французский")).toBe(false);
    expect(shouldReplaceGoalTitle("Выучить французский", "Выучить французский до B2")).toBe(true);
  });
});

describe("continuedGoalWriteIntent", () => {
  it("treats a short assent as a plan write", () => {
    expect(continuedGoalWriteIntent("да, давай вечерние карточки")).toBe(true);
    expect(continuedGoalWriteIntent("давай")).toBe(true);
    expect(continuedGoalWriteIntent("Разложи цель «Выучить французский»")).toBe(true);
  });

  it("leaves discuss, thanks and why-questions as talk", () => {
    expect(continuedGoalWriteIntent("Давай обсудим цель «Выучить французский»")).toBe(false);
    expect(continuedGoalWriteIntent("Давай разберём дело «Anki 20 карточек»")).toBe(false);
    expect(continuedGoalWriteIntent("давай подумаем")).toBe(false);
    expect(continuedGoalWriteIntent("давай разберёмся")).toBe(false);
    expect(continuedGoalWriteIntent("давай сначала про зачем")).toBe(false);
    expect(continuedGoalWriteIntent("давай не сейчас")).toBe(false);
    expect(continuedGoalWriteIntent("спасибо, подумаю")).toBe(false);
    expect(continuedGoalWriteIntent("а зачем это?")).toBe(false);
  });
});

describe("isGoalTopicShift", () => {
  it("treats a new errand as leaving the goal", () => {
    expect(isGoalTopicShift("купить молоко")).toBe(true);
    expect(isGoalTopicShift("это скорее про свободу")).toBe(false);
    expect(isGoalTopicShift("да, давай вечерние карточки")).toBe(false);
  });
});

describe("goalRefineIntent", () => {
  it("recognizes a relevance check", () => {
    expect(goalRefineIntent("Посмотри цель «Выучить французский». Она ещё актуальна?")).toBe(true);
    expect(goalRefineIntent("да, давай вечерние карточки")).toBe(false);
  });
});

describe("goalSyncAllowsCreate", () => {
  const french = { title: "Выучить французский", status: "active" as const };

  it("blocks a bare weekly sync from inventing a new goal", () => {
    expect(goalSyncAllowsCreate("Синк по целям и плану.", [french])).toBe(false);
    expect(
      goalSyncAllowsCreate(
        [
          "Синк по целям и плану.",
          "Поговори со мной как спокойный ментор по тайм-менеджменту и психолог: без пафоса, без диагнозов, без давления.",
          "Сейчас в работе:",
          "• Выучить французский [g1] — дел пока нет; плана ещё нет",
        ].join("\n"),
        [french],
      ),
    ).toBe(false);
  });

  it("still creates when the person named a new outcome or has no goals yet", () => {
    expect(goalSyncAllowsCreate("Синк по целям и плану. Хочу выучить французский.", [french])).toBe(
      true,
    );
    expect(
      goalSyncAllowsCreate("Синк по целям и плану. Хочу пробежать 10 км в октябре.", [french]),
    ).toBe(true);
    expect(goalSyncAllowsCreate("Синк по целям и плану.", [])).toBe(true);
  });
});

describe("applyCompanionTaskActions", () => {
  it("creates once, then adds a deadline to the same task instead of duplicating", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 91, name: "A" });
    const title = "Снять машины с учета в МРЭО";
    await applyCompanionTaskActions(
      repository,
      user.id,
      [createAction(title), createAction(title)],
      {
        timezone: "UTC",
        userText: "Нужно ещё снять машины с учета в мрэо",
        now: friday,
      },
    );
    await applyCompanionTaskActions(repository, user.id, [createAction(title, "2026-11-03")], {
      timezone: "UTC",
      userText: "Надо до конца следующей недели это сделать",
      now: friday,
    });
    const open = (await repository.listTasks(user.id)).filter(
      (task) => task.status === "todo" || task.status === "in_progress",
    );
    expect(open).toEqual([expect.objectContaining({ title, due_at: "2026-09-06T12:00:00.000Z" })]);
  });

  it("does not swallow a different quantity into an existing similar task", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 92, name: "A" });
    await applyCompanionTaskActions(repository, user.id, [createAction("Anki 20 карточек")], {
      timezone: "UTC",
      userText: "поставь Anki 20 карточек",
      now: friday,
    });
    await applyCompanionTaskActions(
      repository,
      user.id,
      [createAction("Anki 10 карточек вечером")],
      {
        timezone: "UTC",
        userText: "ещё Anki 10 карточек вечером",
        now: friday,
      },
    );
    const open = (await repository.listTasks(user.id)).filter(
      (task) => task.status === "todo" || task.status === "in_progress",
    );
    expect(open.map((task) => task.title).sort()).toEqual([
      "Anki 10 карточек вечером",
      "Anki 20 карточек",
    ]);
  });

  it("stores an effort estimate from the user text", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 94, name: "A" });
    await applyCompanionTaskActions(repository, user.id, [createAction("Позвонить в банк")], {
      timezone: "UTC",
      userText: "добавь позвонить в банк на 20 минут",
      now: friday,
    });
    const open = (await repository.listTasks(user.id)).filter(
      (task) => task.status === "todo" || task.status === "in_progress",
    );
    expect(open).toEqual([
      expect.objectContaining({ title: "Позвонить в банк", estimate_minutes: 20 }),
    ]);
  });

  it("collapses a burst of duplicate open tasks onto one dated item", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 92, name: "A" });
    for (let i = 0; i < 5; i++) {
      await repository.createTask(user.id, { title: "Снять машины с учета в МРЭО" });
    }
    await applyCompanionTaskActions(
      repository,
      user.id,
      [createAction("Снять машины с учета в МРЭО")],
      {
        timezone: "UTC",
        userText: "Сделал?",
        recentUserTexts: ["Надо до конца следующей недели это сделать"],
        now: friday,
      },
    );
    const tasks = await repository.listTasks(user.id);
    expect(tasks.filter((task) => task.status === "todo")).toEqual([
      expect.objectContaining({
        title: "Снять машины с учета в МРЭО",
        due_at: "2026-09-06T12:00:00.000Z",
      }),
    ]);
    expect(tasks.filter((task) => task.status === "cancelled")).toHaveLength(4);
  });

  it("attaches a matching orphan task to the new goal and does not steal one from another goal", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 93, name: "A" });
    const other = await repository.createGoal(user.id, { title: "Other" });
    const foreign = await repository.createTask(user.id, {
      title: "Anki 20 карточек",
      goal_id: other.id,
    });
    const orphan = await repository.createTask(user.id, { title: "Anki 20 карточек" });
    const french = await repository.createGoal(user.id, { title: "Выучить французский" });
    await applyCompanionTaskActions(
      repository,
      user.id,
      [
        {
          op: "create",
          task_id: null,
          title: "Anki 20 карточек",
          due_at: "2026-08-25",
          estimate_minutes: null,
          goal_id: french.id,
          project_id: null,
          kind: "task",
          importance: null,
          urgency: null,
          assignee: "user",
        },
      ],
      { timezone: "UTC", userText: "план по французскому", now: friday },
    );
    const tasks = await repository.listTasks(user.id);
    expect(tasks.find((task) => task.id === orphan.id)).toMatchObject({
      goal_id: french.id,
    });
    expect(tasks.find((task) => task.id === foreign.id)).toMatchObject({
      goal_id: other.id,
    });
  });

  it("writes notes onto the existing task instead of creating another", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 95, name: "A" });
    const existing = await repository.createTask(user.id, { title: "Купить лекарства" });
    const userText =
      "добавь в описание задачи необходимые лекасртва для поездки с ребенком 5 лет заграницу";
    const actions = normalizeDescriptionEdits(
      [
        createAction(
          "в описание задачи необходимые лекасртва для поездки с ребенком 5 лет заграницу",
        ),
      ],
      userText,
      [existing],
      [
        "Добавил в описание.",
        "— жаропонижающее (парацетамол/ибупрофен)",
        "— средство от аллергии",
      ].join("\n"),
    );
    await applyCompanionTaskActions(repository, user.id, actions, {
      timezone: "UTC",
      userText,
      now: friday,
    });
    const open = (await repository.listTasks(user.id)).filter(
      (task) => task.status === "todo" || task.status === "in_progress",
    );
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ id: existing.id, title: "Купить лекарства" });
    expect(open[0]?.description).toMatch(/парацетамол/i);
  });
});

describe("groundCompanionTaskAnswer", () => {
  it("replaces a promise to create with what was actually saved", () => {
    expect(
      groundCompanionTaskAnswer(
        "Я создам задачу. Подожди немного, я всё оформлю.",
        [
          {
            type: "task",
            id: "t1",
            label: "Снять машины с учета в МРЭО",
            op: "create",
            due_at: "2026-09-06T12:00:00.000Z",
          },
        ],
        { locale: "ru", timezone: "UTC" },
      ),
    ).toMatch(/Записал дело: Снять машины с учета в МРЭО/);
  });

  it("says the follow-up is the same task", () => {
    expect(
      groundCompanionTaskAnswer(
        "Я создал задачу по снятию машин с учета в МРЭО.",
        [
          {
            type: "task",
            id: "t1",
            label: "Снять машины с учета в МРЭО",
            op: "update",
            due_at: "2026-09-06T12:00:00.000Z",
          },
        ],
        { locale: "ru", timezone: "UTC" },
      ),
    ).toMatch(/Это то же дело/);
  });

  it("does not let a tomorrow-list dump hide a captured task", () => {
    expect(
      groundCompanionTaskAnswer(
        "На завтра\n\n1. Поменять деньги\n2. Проверить чек-листы от АЗС",
        [
          {
            type: "task",
            id: "t-azs",
            label: "Свериться с ИИ: важные пункты проверки АЗС",
            op: "create",
            due_at: "2026-09-22T09:00:00.000Z",
          },
        ],
        { locale: "ru", timezone: "UTC" },
      ),
    ).toMatch(/Свериться с ИИ: важные пункты проверки АЗС/);
    expect(
      groundCompanionAgendaAnswer("Поставила сверку по АЗС на завтра.", [], {
        locale: "ru",
        timezone: "UTC",
        userText:
          "добавь еще одну задачу на завтра. Свериться с ИИ-шкой. Какие пункты проверки АЗС?",
      }),
    ).toBe("Поставила сверку по АЗС на завтра.");
  });

  it("keeps a coaching reply and names what was saved", () => {
    const text = groundCompanionTaskAnswer(
      "Французский у тебя про свободу, не про оценки. Поэтому план на неделю — короткие вечерние карточки, без утреннего марафона.",
      [
        {
          type: "goal",
          id: "g1",
          label: "Выучить французский",
          op: "create",
        },
        {
          type: "task",
          id: "t1",
          label: "Anki вечером",
          op: "create",
          due_at: null,
        },
      ],
      { locale: "ru", timezone: "UTC" },
    );
    expect(text).toMatch(/про свободу/);
    expect(text).toMatch(/Anki вечером/);
  });

  it("names a plan update instead of pretending a new goal was saved", () => {
    expect(
      groundCompanionTaskAnswer(
        "Тогда вечерние карточки, без утреннего марафона.",
        [
          {
            type: "goal",
            id: "g1",
            label: "Выучить французский",
            op: "update",
          },
        ],
        { locale: "ru", timezone: "UTC" },
      ),
    ).toMatch(/Обновила план: Выучить французский/);
  });

  it("names a wording refine instead of pretending the week plan changed", () => {
    expect(
      groundCompanionTaskAnswer(
        "Формулировку уточнила до разговорного уровня. Недельный план не трогала.",
        [
          {
            type: "goal",
            id: "g1",
            label: "Выучить французский до разговорного B1",
            op: "update",
          },
        ],
        { locale: "ru", timezone: "UTC", goalRecap: "refine" },
      ),
    ).toMatch(/Уточнила цель: Выучить французский до разговорного B1/);
    expect(
      groundCompanionTaskAnswer(
        "Формулировку уточнила до разговорного уровня. Недельный план не трогала.",
        [
          {
            type: "goal",
            id: "g1",
            label: "Выучить французский до разговорного B1",
            op: "update",
          },
        ],
        { locale: "ru", timezone: "UTC", goalRecap: "refine" },
      ),
    ).not.toMatch(/Обновила план/);
  });
});

describe("groundRejectedGoalWriteAnswer", () => {
  it("corrects a saved-plan claim when nothing was written", () => {
    expect(
      groundRejectedGoalWriteAnswer("Собрала план на неделю: утренние марафоны.", [], {
        locale: "ru",
      }),
    ).toBe("Это пока в разговоре — в цель и план недели не записывала.");
  });

  it("keeps the talk and drops the false saved-plan sentence", () => {
    expect(
      groundRejectedGoalWriteAnswer(
        "Французский у тебя про свободу, не про оценки. Собрала план на неделю: утренние марафоны. Что мешает вечером?",
        [],
        { locale: "ru" },
      ),
    ).toBe(
      "Французский у тебя про свободу, не про оценки. Что мешает вечером?\n\nЭто пока в разговоре — в цель и план недели не записывала.",
    );
  });

  it("keeps a real goal write and a talk-only reply", () => {
    expect(
      groundRejectedGoalWriteAnswer(
        "Обновила план: Выучить французский.",
        [{ type: "goal", id: "g1", label: "Выучить французский", op: "update" }],
        { locale: "ru" },
      ),
    ).toMatch(/Обновила план/);
    expect(
      groundRejectedGoalWriteAnswer("Это про свободу, не про оценки. Что мешает вечером?", [], {
        locale: "ru",
      }),
    ).toMatch(/про свободу/);
  });
});

describe("companion agenda packing", () => {
  it("hides the local-noon sentinel so Moscow 09:00 UTC is not a clock time", () => {
    expect(packCompanionTaskDue("2026-09-09T09:00:00.000Z", "Europe/Moscow", "2026-09-09")).toEqual(
      {
        due_on: "2026-09-09",
        due_time: null,
        when: "today",
      },
    );
    expect(packCompanionTaskDue("2026-09-10T09:00:00.000Z", "Europe/Moscow", "2026-09-09")).toEqual(
      {
        due_on: "2026-09-10",
        due_time: null,
        when: "tomorrow",
      },
    );
    expect(packCompanionTaskDue("2026-09-09T06:00:00.000Z", "Europe/Moscow", "2026-09-09")).toEqual(
      {
        due_on: "2026-09-09",
        due_time: "09:00",
        when: "today",
      },
    );
  });

  it("detects today/tomorrow agenda questions and ignores capture phrasing", () => {
    expect(agendaQueryDay("какие дела есть на сегодня?")).toBe("today");
    expect(agendaQueryDay("кактe дела есть на сегодня")).toBe("today");
    expect(agendaQueryDay("какие дела на завтра")).toBe("tomorrow");
    expect(agendaQueryDay("добавь отчёт на сегодня")).toBeNull();
    expect(agendaQueryDay("перенеси на завтра")).toBeNull();
    expect(
      agendaQueryDay(
        "добавь еще одну задачу на завтра. Свериться с ИИ-шкой. Какие самые важные для АЗС-ок пункты проверки существуют, что им надо контролировать, чтобы им больше зарабатывать и для клиентов делать больше.",
      ),
    ).toBeNull();
  });

  it("lists only today's tasks and never invents 09:00", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const answer = groundCompanionAgendaAnswer(
      "На сегодня у тебя запланированы следующие дела:\n* Переделать отчеты — срок до 09:00.\n* Начать работу по своей осознанности",
      [
        {
          title: "Построить план работ по лоцен",
          due_at: "2026-09-09T09:00:00.000Z",
          status: "todo",
          assignee: "user",
          recurrence_frequency: null,
        },
        {
          title: "Составить план обучения продажам",
          due_at: "2026-09-09T09:00:00.000Z",
          status: "todo",
          assignee: "user",
          recurrence_frequency: null,
        },
        {
          title: "Переделать отчеты по залу в инциденты",
          due_at: "2026-09-10T09:00:00.000Z",
          status: "todo",
          assignee: "user",
          recurrence_frequency: null,
        },
      ],
      {
        locale: "ru",
        timezone: "Europe/Moscow",
        userText: "какие дела есть на сегодня?",
        now,
      },
    );
    expect(answer).toMatch(/Построить план работ по лоцен/);
    expect(answer).toMatch(/Составить план обучения продажам/);
    expect(answer).not.toMatch(/отчеты по залу/);
    expect(answer).not.toMatch(/09:00/);
    expect(omitAgendaMutations([{ op: "update" }], "какие дела есть на сегодня?")).toEqual([]);
  });
});

describe("inferCompanionTaskActions", () => {
  it("still captures a single explicit add", () => {
    expect(
      inferCompanionTaskActions("добавь задачу Позвонить в банк").map((item) => item.title),
    ).toEqual(["Позвонить в банк"]);
  });

  it("splits a spoken dump of several errands", () => {
    expect(
      inferCompanionTaskActions(
        "слушай надо купить молоко, позвонить в банк, записаться к врачу и отправить документы",
      ).map((item) => item.title),
    ).toEqual(["Купить молоко", "Позвонить в банк", "Записаться к врачу", "Отправить документы"]);
  });

  it("splits two captures joined with и", () => {
    expect(
      inferCompanionTaskActions("добавь купить молоко и позвонить маме").map((item) => item.title),
    ).toEqual(["Купить молоко", "Позвонить маме"]);
  });

  it("does not turn a deadline follow-up or a question into tasks", () => {
    expect(inferCompanionTaskActions("Надо до конца следующей недели это сделать")).toEqual([]);
    expect(inferCompanionTaskActions("какие дела есть на сегодня?")).toEqual([]);
    expect(inferCompanionTaskActions("Хочу начать бегать")).toEqual([]);
    expect(inferCompanionTaskActions("Сорвался с обещанием бегать")).toEqual([]);
  });

  it("keeps a grocery list as one task when there is a single verb", () => {
    expect(
      inferCompanionTaskActions("надо купить хлеб и молоко").map((item) => item.title),
    ).toEqual(["Купить хлеб и молоко"]);
  });

  it("still completes a named task", () => {
    expect(inferCompanionTaskActions("готово Позвонить в банк")).toEqual([
      expect.objectContaining({ op: "complete", title: "Позвонить в банк" }),
    ]);
  });

  it("captures a research question after «добавь задачу на завтра»", () => {
    const actions = inferCompanionTaskActions(
      "добавь еще одну задачу на завтра. Свериться с ИИ-шкой. Какие самые важные для АЗС-ок пункты проверки существуют, что им надо контролировать, чтобы им больше зарабатывать и для клиентов делать больше.",
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ op: "create", due_at: "tomorrow" });
    expect(actions[0]?.title).toMatch(/АЗС|ИИ/i);
    expect(actions[0]?.title).not.toMatch(/^добавь/i);
  });

  it("captures a short infinitive errand without «добавь»", () => {
    expect(inferCompanionTaskActions("купить лекарства").map((item) => item.title)).toEqual([
      "Купить лекарства",
    ]);
  });

  it("does not turn a description edit into a new task", () => {
    expect(
      inferCompanionTaskActions(
        "добавь в описание задачи необходимые лекасртва для поездки с ребенком 5 лет заграницу",
      ),
    ).toEqual([]);
    expect(
      isDescriptionEditIntent(
        "добавь в описание задачи необходимые лекасртва для поездки с ребенком 5 лет заграницу",
      ),
    ).toBe(true);
  });

  it("completes and reschedules the quoted Telegram message", () => {
    const quoted = "Поставил задачу «Купить лекарства» на сегодня.";
    expect(titleFromQuotedMessage(quoted)).toBe("Купить лекарства");
    expect(inferCompanionTaskActions("готово", { quoted })).toEqual([
      expect.objectContaining({ op: "complete", title: "Купить лекарства" }),
    ]);
    expect(inferCompanionTaskActions("на завтра", { quoted })).toEqual([
      expect.objectContaining({ op: "update", title: "Купить лекарства", due_at: "tomorrow" }),
    ]);
  });
});

describe("mergeCompanionTaskActions", () => {
  it("fills in errands the model missed and splits a mega-title", () => {
    const inferred = inferCompanionTaskActions(
      "надо купить молоко, позвонить в банк, записаться к врачу и отправить документы",
    );
    expect(
      mergeCompanionTaskActions([createAction("Купить молоко")], inferred).map(
        (item) => item.title,
      ),
    ).toEqual(["Купить молоко", "Позвонить в банк", "Записаться к врачу", "Отправить документы"]);
    expect(
      mergeCompanionTaskActions(
        [createAction("купить молоко позвонить в банк записаться к врачу и отправить документы")],
        inferred,
      ).map((item) => item.title),
    ).toEqual(["Купить молоко", "Позвонить в банк", "Записаться к врачу", "Отправить документы"]);
  });
});

describe("normalizeDescriptionEdits", () => {
  const meds = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Купить лекарства",
    status: "todo" as const,
    created_at: new Date().toISOString(),
  };
  const userText =
    "добавь в описание задачи необходимые лекасртва для поездки с ребенком 5 лет заграницу";
  const answer = [
    "Добавил в описание задачи «Купить лекарства» список.",
    "",
    "• Купить лекарства — сегодня, с описанием для поездки:",
    "— жаропонижающее (парацетамол/ибупрофен)",
    "— средство от аллергии",
    "— капли в нос",
  ].join("\n");

  it("rewrites a leftover create into an update of the open task", () => {
    const actions = normalizeDescriptionEdits(
      mergeCompanionTaskActions([], inferCompanionTaskActions(userText)).concat([
        createAction(
          "в описание задачи необходимые лекасртва для поездки с ребенком 5 лет заграницу",
        ),
      ]),
      userText,
      [meds],
      answer,
    );
    expect(actions).toEqual([
      expect.objectContaining({
        op: "update",
        task_id: meds.id,
        title: "Купить лекарства",
      }),
    ]);
    expect(actions[0]?.description).toMatch(/парацетамол/i);
    expect(actions.map((item) => item.title).join(" ")).not.toMatch(/в описание задачи/i);
  });

  it("keeps a model description on the existing task", () => {
    const parsed = parseCompanionResponse({
      answer: "Добавил список в описание.",
      task_actions: [
        {
          op: "update",
          task_id: meds.id,
          title: "Купить лекарства",
          description: "• парацетамол\n• антигистамин",
        },
      ],
    });
    expect(parsed.task_actions[0]).toMatchObject({
      op: "update",
      description: "• парацетамол\n• антигистамин",
    });
    expect(normalizeDescriptionEdits(parsed.task_actions, userText, [meds], parsed.answer)).toEqual(
      [
        expect.objectContaining({
          op: "update",
          task_id: meds.id,
          description: "• парацетамол\n• антигистамин",
        }),
      ],
    );
  });
});

describe("telegram reply context", () => {
  it("binds a description edit to the quoted task title", () => {
    const older = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Изучать курсы Вани",
      status: "todo" as const,
      created_at: "2026-09-20T10:00:00.000Z",
    };
    const meds = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Купить лекарства",
      status: "todo" as const,
      created_at: "2026-09-21T12:00:00.000Z",
    };
    expect(
      resolveDescriptionTarget(
        "добавь в описание аптечку",
        [older, meds],
        "Поставил задачу «Купить лекарства» на сегодня.",
      ),
    ).toMatchObject({ id: meds.id });
  });

  it("pins the quoted message into conversation turns", () => {
    const turns = conversationTurns(
      [
        {
          id: "1",
          owner_id: "u",
          conversation_id: "c",
          telegram_chat_id: null,
          telegram_message_id: null,
          role: "assistant",
          content: "Старое сообщение",
          intent: "companion",
          source_channel: "telegram",
          metadata: {},
          created_at: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "2",
          owner_id: "u",
          conversation_id: "c",
          telegram_chat_id: null,
          telegram_message_id: null,
          role: "user",
          content: "добавь в описание аптечку",
          intent: "companion",
          source_channel: "telegram",
          metadata: {},
          created_at: "2026-09-21T00:00:00.000Z",
        },
      ],
      "добавь в описание аптечку",
      12,
      {
        role: "assistant",
        content: "Поставил задачу «Купить лекарства» на сегодня.",
      },
    );
    expect(turns[0]).toMatchObject({
      role: "assistant",
      content: expect.stringContaining("Купить лекарства"),
    });
    expect(turns[0]?.content).toMatch(/replied-to/);
  });
});

describe("normalizeTaskTitle", () => {
  it("strips the spoken command wrapper and keeps the action", () => {
    expect(normalizeTaskTitle("Добавь задачу купить молоко")).toBe("Купить молоко");
    expect(normalizeTaskTitle("Илзи, добавь, пожалуйста, задачу: позвонить маме")).toBe(
      "Позвонить маме",
    );
    expect(normalizeTaskTitle("Добавь в список задачу — оплатить интернет")).toBe(
      "Оплатить интернет",
    );
    expect(normalizeTaskTitle("Поставь задачу, что надо продлить страховку")).toBe(
      "Продлить страховку",
    );
    expect(normalizeTaskTitle("Купить хлеб, добавь в список")).toBe("Купить хлеб");
    expect(normalizeTaskTitle("добавь задачу")).toBe("");
  });

  it("leaves real actions that start with the same verbs alone", () => {
    expect(normalizeTaskTitle("Поставить счётчики")).toBe("Поставить счётчики");
    expect(normalizeTaskTitle("Запиши сына в секцию")).toBe("Запиши сына в секцию");
  });
});

describe("applyCompanionTaskActions titles", () => {
  it("never saves «Добавь задачу» as the task title", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 991, name: "A" });
    await applyCompanionTaskActions(
      repository,
      user.id,
      [
        {
          op: "create",
          task_id: null,
          title: "Добавь задачу изучить курсы Вани",
          due_at: null,
          estimate_minutes: null,
          goal_id: null,
          project_id: null,
          kind: "task",
          importance: null,
          urgency: null,
          assignee: "user",
        },
        {
          op: "create",
          task_id: null,
          title: "Добавь задачу",
          due_at: "2026-11-29",
          estimate_minutes: null,
          goal_id: null,
          project_id: null,
          kind: "task",
          importance: null,
          urgency: null,
          assignee: "user",
        },
      ],
      {
        timezone: "UTC",
        userText: "добавь задачу изучить курсы Вани",
        now: new Date("2026-11-17T10:00:00Z"),
      },
    );
    const tasks = await repository.listTasks(user.id);
    expect(tasks.map((task) => [task.title, task.due_at ?? null])).toEqual([
      ["Изучить курсы Вани", null],
    ]);
  });
});
