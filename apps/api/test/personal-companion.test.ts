import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  AssistantOrchestrator,
  ExperienceService,
  PersonalContextBuilder,
  extractExperience,
  focusedSearchQuery,
  toCompanionWorkspace,
  type AiProvider,
} from "../src/modules/assistant/index.js";
import { companionClock } from "../src/modules/assistant/companion.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { DiscoveryClient } from "../src/modules/assistant/discovery.js";

const botToken = "123456:abcdefghijklmnopqrstuvwxyz";
const secret = "webhook-secret-at-least-sixteen";
const sessionSecret = "session-secret-at-least-thirty-two-characters";
const env = {
  CORS_ORIGIN: "*",
  TELEGRAM_BOT_TOKEN: botToken,
  TELEGRAM_WEBHOOK_SECRET: secret,
  TELEGRAM_MINI_APP_URL: "https://example.com/app",
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: 300,
  TELEGRAM_LOGIN_MAX_AGE_SECONDS: 86_400,
  SESSION_SECRET: sessionSecret,
  SESSION_TTL_SECONDS: 900,
  CRON_SECRET: "cron-secret-at-least-sixteen",
};
class FakeTelegram implements TelegramGateway {
  sent: { chatId: number; text: string }[] = [];
  async sendMessage(chatId: number, text: string) {
    this.sent.push({ chatId, text });
  }
  async answerCallbackQuery() {
    return Promise.resolve();
  }
}
const fallbackAi = (overrides: Partial<AiProvider> = {}): AiProvider => ({
  async decide() {
    return {
      intent: "other",
      person_query: null,
      content: null,
      category: null,
      title: null,
      space_name: null,
    };
  },
  async recommend() {
    return [1, 2, 3].map((n) => ({ title: `Idea ${n}`, rationale: "General" }));
  },
  ...overrides,
});
const setup = (ai?: AiProvider, discovery?: DiscoveryClient) => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return { repository, telegram, app: createApp({ repository, telegram, env, ai, discovery }) };
};
const auth = async (ownerId: string) => ({
  Authorization: `Bearer ${await createSession(ownerId, sessionSecret, 900)}`,
});

describe("profile, planning, and repository contracts", () => {
  it("provisions tenant-isolated self profiles and rich self memories", async () => {
    const { app, repository } = setup();
    const a = await repository.upsertTelegramUser({ telegram_id: 1, name: "A" });
    const b = await repository.upsertTelegramUser({ telegram_id: 2, name: "B" });
    const created = await request(app)
      .post("/api/me/memories")
      .set(await auth(a.id))
      .send({
        content: "Люблю камерные театры",
        category: "preference",
        importance: 5,
        confidence: 0.92,
        occurred_at: "2026-07-01T10:00:00.000Z",
        metadata: { source: "manual" },
      });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      importance: 5,
      confidence: 0.92,
      metadata: { source: "manual" },
    });
    expect(
      (
        await request(app)
          .get("/api/me")
          .set(await auth(a.id))
      ).body.data.self.memories,
    ).toHaveLength(1);
    expect(
      (
        await request(app)
          .get("/api/me")
          .set(await auth(b.id))
      ).body.data.self.memories,
    ).toHaveLength(0);
    expect(repository.betaMetrics).toEqual([
      expect.objectContaining({ owner_id: a.id, name: "first_self_fact" }),
    ]);
  });

  it("supports goals, projects, and owned task links", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 3, name: "A" });
    const headers = await auth(user.id);
    const goal = (
      await request(app)
        .post("/api/goals")
        .set(headers)
        .send({ title: "Run a marathon", priority: 5 })
    ).body.data;
    const project = (
      await request(app)
        .post("/api/projects")
        .set(headers)
        .send({ name: "Training", goal_id: goal.id })
    ).body.data;
    const task = await request(app)
      .post("/api/tasks")
      .set(headers)
      .send({ title: "Long run", goal_id: goal.id, project_id: project.id });
    expect(task.status).toBe(201);
    expect(task.body.data).toMatchObject({ goal_id: goal.id, project_id: project.id });
    expect(
      (
        await request(app)
          .patch(`/api/projects/${project.id}`)
          .set(headers)
          .send({ status: "completed" })
      ).body.data.status,
    ).toBe("completed");
  });

  it("creates goals and projects from explicit bot commands", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 4, name: "A" });
    const assistant = new AssistantOrchestrator(repository);

    expect((await assistant.handle(user.id, "Цель: пробежать марафон")).intent).toBe("create_goal");
    expect((await assistant.handle(user.id, "Проект: план тренировок")).intent).toBe(
      "create_project",
    );
    expect(await repository.listGoals(user.id)).toEqual([
      expect.objectContaining({ title: "пробежать марафон" }),
    ]);
    expect(await repository.listProjects(user.id)).toEqual([
      expect.objectContaining({ name: "план тренировок" }),
    ]);
  });
});

describe("shared companion ledger and context", () => {
  it("shares Telegram and Mini App history and persists both roles", async () => {
    const ai = fallbackAi({
      async companion(query) {
        return { answer: `Reply: ${query}`, context_used: [], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const command = {
      update_id: 1,
      message: {
        message_id: 1,
        text: "/companion",
        chat: { id: 10 },
        from: { id: 10, first_name: "A" },
      },
    };
    await request(app)
      .post(`/webhooks/telegram/${secret}`)
      .set("x-telegram-bot-api-secret-token", secret)
      .send(command);
    const user = repository.users[0]!;
    const mini = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "Help me choose", source_channel: "mini_app" });
    expect(mini.status).toBe(201);
    const conversation = await repository.getPrimaryConversation(user.id);
    const history = await request(app)
      .get(`/api/conversations/${conversation.id}/messages`)
      .set(await auth(user.id));
    expect(history.body.data.map((x: { role: string }) => x.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(
      new Set(history.body.data.map((x: { conversation_id: string }) => x.conversation_id)),
    ).toEqual(new Set([conversation.id]));
  });

  it("creates and completes tasks from companion replies", async () => {
    const ai = fallbackAi({
      async companion(query) {
        if (query.includes("добавь")) {
          return {
            answer: "Записал звонок в банк.",
            context_used: [],
            follow_up: null,
            task_actions: [
              { op: "create", task_id: null, title: "Позвонить в банк", due_at: null },
            ],
            offers: [
              {
                kind: "plan",
                title: "Набросать план",
                instruction: "Составь короткий план разговора с банком",
              },
            ],
          };
        }
        return {
          answer: "Отметил звонок выполненным.",
          context_used: [],
          follow_up: null,
          task_actions: [
            { op: "complete", task_id: null, title: "Позвонить в банк", due_at: null },
          ],
          offers: [],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 23, name: "A" });
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "добавь задачу Позвонить в банк", source_channel: "mini_app" });
    expect(created.status).toBe(201);
    expect(await repository.listTasks(user.id)).toEqual([
      expect.objectContaining({ title: "Позвонить в банк", status: "todo" }),
    ]);
    expect(created.body.data.assistant_message.metadata.offers[0].title).toBe("Набросать план");
    const completed = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "готово Позвонить в банк", source_channel: "mini_app" });
    expect(completed.status).toBe(201);
    expect(await repository.listTasks(user.id)).toEqual([
      expect.objectContaining({ title: "Позвонить в банк", status: "done" }),
    ]);
  });

  it("captures every errand from a spoken dump even when the model writes none", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Поняла, много всего навалилось.",
          context_used: [],
          follow_up: null,
          task_actions: [],
          offers: [],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 94, name: "A" });
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content:
          "слушай надо купить молоко, позвонить в банк, записаться к врачу и отправить документы",
        source_channel: "telegram",
      });
    expect(created.status).toBe(201);
    const titles = (await repository.listTasks(user.id)).map((task) => task.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Купить молоко",
        "Позвонить в банк",
        "Записаться к врачу",
        "Отправить документы",
      ]),
    );
    expect(titles).toHaveLength(4);
    expect(created.body.data.response.answer).toMatch(/молоко/);
    expect(created.body.data.response.answer).toMatch(/банк/);
  });

  it("adds a research task for tomorrow instead of dumping tomorrow's list", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "На завтра\n\n1. Поменять деньги\n2. Проверить чек-листы от АЗС",
          context_used: [],
          follow_up: null,
          task_actions: [],
          offers: [],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 95, name: "A" });
    await repository.createTask(user.id, { title: "Поменять деньги", due_at: "2026-09-22T12:00:00.000Z" });
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content:
          "добавь еще одну задачу на завтра. Свериться с ИИ-шкой. Какие самые важные для АЗС-ок пункты проверки существуют, что им надо контролировать, чтобы им больше зарабатывать и для клиентов делать больше.",
        source_channel: "telegram",
      });
    expect(created.status).toBe(201);
    const titles = (await repository.listTasks(user.id)).map((task) => task.title);
    expect(titles.some((title) => /АЗС|ИИ/i.test(title))).toBe(true);
    expect(created.body.data.response.answer).toMatch(/АЗС|ИИ/i);
    expect(created.body.data.response.answer).not.toMatch(/^На завтра\s*$/m);
  });

  it("does not create five copies of the same telegram errand and records the deadline", async () => {
    const title = "Снять машины с учета в МРЭО";
    const ai = fallbackAi({
      async companion(query) {
        return {
          answer: "Я создам задачу по снятию машин с учета в МРЭО. Подожди немного, я всё оформлю.",
          context_used: [],
          follow_up: null,
          task_actions: [
            {
              op: "create",
              task_id: null,
              title,
              due_at: query.includes("недел") ? "2026-11-03" : null,
            },
          ],
          offers: [],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 93, name: "Andrey" });
    const headers = await auth(user.id);
    const first = await request(app)
      .post("/api/companion/messages")
      .set(headers)
      .send({ content: "Нужно ещё снять машины с учета в мрэо", source_channel: "telegram" });
    expect(first.status).toBe(201);
    expect(first.body.data.response.answer).toMatch(/Записал дело/);
    expect(first.body.data.response.answer).not.toMatch(/создам|подожди|оформлю/i);
    const second = await request(app).post("/api/companion/messages").set(headers).send({
      content: "Надо до конца следующей недели это сделать",
      source_channel: "telegram",
    });
    expect(second.status).toBe(201);
    expect(second.body.data.response.answer).toMatch(/то же дело|Записал дело/);
    await request(app)
      .post("/api/companion/messages")
      .set(headers)
      .send({ content: "Ноября?", source_channel: "telegram" });
    await request(app)
      .post("/api/companion/messages")
      .set(headers)
      .send({ content: "Сегодня август", source_channel: "telegram" });
    const done = await request(app)
      .post("/api/companion/messages")
      .set(headers)
      .send({ content: "Сделал?", source_channel: "telegram" });
    expect(done.status).toBe(201);
    const open = (await repository.listTasks(user.id)).filter(
      (task) => task.status === "todo" || task.status === "in_progress",
    );
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ title });
    expect(open[0]?.due_at).toBeTruthy();
  });

  it("saves a goal plan, links new tasks, and archives stale ones", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 24, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Run a 10k" });
    const stale = await repository.createTask(user.id, {
      title: "Buy random gadgets",
      goal_id: goal.id,
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Собрал план на ближайшие две недели.",
          context_used: ["goal"],
          follow_up: null,
          task_actions: [
            {
              op: "create",
              task_id: null,
              title: "Three easy runs",
              due_at: "2026-08-30",
              goal_id: goal.id,
              assignee: "user",
            },
          ],
          goal_plan: {
            goal_id: goal.id,
            summary: "Бегать три раза в неделю и не срывать восстановление.",
            archive_task_ids: [stale.id],
          },
        };
      },
    });
    const app = createApp({
      repository,
      telegram: new FakeTelegram(),
      env,
      ai,
    });
    const planned = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: `Разложи цель «Run a 10k»`,
        source_channel: "mini_app",
      });
    expect(planned.status).toBe(201);
    const updated = await repository.getGoal(user.id, goal.id);
    expect(updated?.current_plan).toMatch(/три раза/);
    expect(updated?.plan_revised_at).toBeTruthy();
    const tasks = await repository.listTasks(user.id);
    expect(tasks.find((task) => task.id === stale.id)?.status).toBe("cancelled");
    expect(tasks.find((task) => task.title === "Three easy runs")).toMatchObject({
      goal_id: goal.id,
      status: "todo",
    });
  });

  it("creates a goal from companion and binds tasks to that plan", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Зафиксировал цель и ближайшие шаги.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "create",
              title: "Выучить французский",
              current_plan: "Каждый день 20 карточек и одно короткое аудио.",
              tasks: [{ title: "Anki 20 карточек", due_at: "2026-08-25", assignee: "user" }],
            },
          ],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 25, name: "A" });
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Синк по целям и плану. Хочу выучить французский.",
        source_channel: "mini_app",
      });
    expect(created.status).toBe(201);
    const goals = await repository.listGoals(user.id);
    expect(goals.some((goal) => goal.title === "Выучить французский")).toBe(true);
    const goal = goals.find((item) => item.title === "Выучить французский");
    expect(goal?.current_plan).toMatch(/карточек/);
    expect(
      (await repository.listTasks(user.id)).find((task) => task.title === "Anki 20 карточек"),
    ).toMatchObject({ goal_id: goal?.id, assignee: "user" });
    expect((await repository.getProfile(user.id))?.last_goal_checkin_on).toBeTruthy();
    expect(created.body.data.assistant_message.metadata.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "goal", label: "Выучить французский" }),
        expect.objectContaining({ type: "task", label: "Anki 20 карточек" }),
      ]),
    );
  });

  it("does not invent a new goal on a bare weekly sync", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 272, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Собрала план на неделю: утренние марафоны.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "create",
              title: "Стать продуктивнее",
              current_plan: "Утренние марафоны.",
              tasks: [{ title: "Встать в пять", due_at: null, assignee: "user" }],
            },
            {
              op: "update",
              goal_id: goal.id,
              title: "Выучить французский",
              current_plan: "20 карточек по вечерам.",
              tasks: [{ title: "Anki вечером", due_at: null, assignee: "user" }],
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: [
          "Синк по целям и плану.",
          "Поговори со мной как спокойный ментор по тайм-менеджменту и психолог: без пафоса, без диагнозов, без давления.",
          "Сейчас в работе:",
          `• Выучить французский [${goal.id}] — дел пока нет; план: Вечерние карточки.`,
        ].join("\n"),
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    const goals = await repository.listGoals(user.id);
    expect(goals).toHaveLength(1);
    expect(goals[0]?.id).toBe(goal.id);
    expect(goals[0]?.current_plan).toMatch(/вечерам/);
    expect((await repository.listTasks(user.id)).map((task) => task.title)).toEqual(["Anki вечером"]);
    expect(replied.body.data.response.answer).toMatch(/Обновила план: Выучить французский/);
    expect(replied.body.data.response.answer).not.toMatch(/Стать продуктивнее/);
  });

  it("does not invent a goal from casual chat even if the model emits one", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Похоже, французский для тебя скорее про свободу, чем про оценки.",
          context_used: ["self"],
          follow_up: "Что в этом для тебя самое живое?",
          goal_actions: [
            {
              op: "create",
              title: "Выучить французский",
              current_plan: "Учить каждый день.",
              tasks: [{ title: "Купить учебник", due_at: null, assignee: "user" }],
            },
          ],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 26, name: "A" });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Иногда думаю, что хотелось бы как-то заняться французским",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect(await repository.listGoals(user.id)).toEqual([]);
    expect(await repository.listTasks(user.id)).toEqual([]);
  });

  it("does not rewrite an existing goal from casual chat", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 261, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Французский у тебя скорее про свободу.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "create",
              title: "Выучить французский",
              current_plan: "Учить каждый день с утра.",
              tasks: [{ title: "Купить учебник", due_at: null, assignee: "user" }],
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Иногда думаю, что хотелось бы как-то заняться французским",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect(await repository.listGoals(user.id)).toHaveLength(1);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBe("Вечерние карточки.");
    expect(await repository.listTasks(user.id)).toEqual([]);
  });

  it("binds next tasks to the goal being discussed even without goal_id", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 262, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Выучить французский" });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Тогда ближайший шаг — короткие карточки вечером.",
          context_used: ["goals"],
          follow_up: null,
          task_actions: [
            {
              op: "create",
              task_id: null,
              title: "Anki 20 карточек",
              due_at: "2026-08-25",
              assignee: "user",
            },
          ],
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "Учить каждый день с утра.",
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Давай обсудим цель «Выучить французский»",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect(await repository.listGoals(user.id)).toHaveLength(1);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBeNull();
    expect(
      (await repository.listTasks(user.id)).find((task) => task.title === "Anki 20 карточек"),
    ).toMatchObject({ goal_id: goal.id });
  });

  it("does not claim a plan write when discuss dropped the goal update", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 275, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Собрала план на неделю: утренние марафоны.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "Учить каждый день с утра.",
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Давай обсудим цель «Выучить французский»",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBe("Вечерние карточки.");
    expect(replied.body.data.response.answer).toMatch(/не записывала/);
    expect(replied.body.data.response.answer).not.toMatch(/Собрала план/);
  });

  it("updates the plan on a short follow-up after discussing a goal", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 263, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Выучить французский" });
    let turn = 0;
    const ai = fallbackAi({
      async companion() {
        turn += 1;
        if (turn === 1) {
          return {
            answer: "Это про свободу говорить или про оценки?",
            context_used: ["goals"],
            follow_up: null,
          };
        }
        return {
          answer: "Тогда вечерние карточки на этой неделе.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "20 карточек по вечерам.",
              tasks: [{ title: "Anki вечером", due_at: "2026-08-26", assignee: "user" }],
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const headers = await auth(user.id);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "Давай обсудим цель «Выучить французский»",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "да, давай вечерние карточки",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toMatch(/вечерам/);
    expect(
      (await repository.listTasks(user.id)).find((task) => task.title === "Anki вечером"),
    ).toMatchObject({ goal_id: goal.id });
  });

  it("keeps the discussed goal after a longer talk and still writes on assent", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 270, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Выучить французский" });
    let turn = 0;
    const ai = fallbackAi({
      async companion() {
        turn += 1;
        if (turn < 6) {
          return {
            answer: "Это про свободу, не про оценки. Что мешает вечером?",
            context_used: ["goals"],
            follow_up: null,
          };
        }
        return {
          answer: "Тогда вечерние карточки на этой неделе.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "20 карточек по вечерам.",
              tasks: [{ title: "Anki вечером", due_at: "2026-08-26", assignee: "user" }],
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const headers = await auth(user.id);
    const talk = async (content: string) =>
      request(app).post("/api/companion/messages").set(headers).send({
        content,
        source_channel: "mini_app",
      });
    expect((await talk("Давай обсудим цель «Выучить французский»")).status).toBe(201);
    for (const content of [
      "это скорее про свободу",
      "вечером обычно есть 20 минут",
      "оценки не важны",
      "без утреннего марафона",
    ]) {
      expect((await talk(content)).status).toBe(201);
    }
    expect((await talk("да, давай вечерние карточки")).status).toBe(201);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toMatch(/вечерам/);
    expect(
      (await repository.listTasks(user.id)).find((task) => task.title === "Anki вечером"),
    ).toMatchObject({ goal_id: goal.id });
  });

  it("does not write the old goal plan after the chat moved to an errand", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 271, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    let turn = 0;
    const ai = fallbackAi({
      async companion() {
        turn += 1;
        if (turn === 1) {
          return { answer: "Это про свободу или про оценки?", context_used: ["goals"], follow_up: null };
        }
        if (turn === 2) {
          return { answer: "Записала молоко.", context_used: ["tasks"], follow_up: null };
        }
        return {
          answer: "Тогда утренний марафон.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "Учить каждый день с утра.",
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const headers = await auth(user.id);
    const talk = async (content: string) =>
      request(app).post("/api/companion/messages").set(headers).send({
        content,
        source_channel: "mini_app",
      });
    expect((await talk("Давай обсудим цель «Выучить французский»")).status).toBe(201);
    expect((await talk("купить молоко")).status).toBe(201);
    expect((await talk("да, давай вечерние карточки")).status).toBe(201);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBe("Вечерние карточки.");
  });

  it("does not rewrite the discussed goal after a thanks-only follow-up", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 265, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    let turn = 0;
    const ai = fallbackAi({
      async companion() {
        turn += 1;
        if (turn === 1) {
          return {
            answer: "Это про свободу говорить или про оценки?",
            context_used: ["goals"],
            follow_up: null,
          };
        }
        return {
          answer: "Хорошо, пусть полежит.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "Учить каждый день с утра.",
              tasks: [{ title: "Купить учебник", due_at: null, assignee: "user" }],
            },
          ],
          task_actions: [
            {
              op: "create",
              task_id: null,
              title: "Купить учебник",
              due_at: null,
              assignee: "user",
            },
          ],
          goal_plan: {
            goal_id: goal.id,
            summary: "Учить каждый день с утра.",
            archive_task_ids: [],
          },
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const headers = await auth(user.id);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "Давай обсудим цель «Выучить французский»",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "спасибо, подумаю",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBe("Вечерние карточки.");
    expect(await repository.listTasks(user.id)).toEqual([]);
  });

  it("does not rewrite the plan when the follow-up is still talking", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 273, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    let turn = 0;
    const ai = fallbackAi({
      async companion() {
        turn += 1;
        if (turn === 1) {
          return {
            answer: "Это про свободу говорить или про оценки?",
            context_used: ["goals"],
            follow_up: null,
          };
        }
        return {
          answer: "Давай сначала про зачем, без нового плана.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "Учить каждый день с утра.",
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const headers = await auth(user.id);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "Давай обсудим цель «Выучить французский»",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "давай подумаем",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBe("Вечерние карточки.");
  });

  it("does not bind an unrelated errand to a recently discussed goal", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 266, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Выучить французский" });
    let turn = 0;
    const ai = fallbackAi({
      async companion() {
        turn += 1;
        if (turn === 1) {
          return {
            answer: "Это про свободу говорить или про оценки?",
            context_used: ["goals"],
            follow_up: null,
          };
        }
        return {
          answer: "Записала молоко.",
          context_used: ["tasks"],
          follow_up: null,
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const headers = await auth(user.id);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "Давай обсудим цель «Выучить французский»",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app).post("/api/companion/messages").set(headers).send({
          content: "купить молоко",
          source_channel: "mini_app",
        })
      ).status,
    ).toBe(201);
    expect(
      (await repository.listTasks(user.id)).find((task) => task.title === "Купить молоко"),
    ).toMatchObject({ goal_id: null });
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBeNull();
  });

  it("keeps a follow-up task on the same goal when unpacking a linked task", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 264, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    await repository.createTask(user.id, {
      title: "Anki 20 карточек",
      goal_id: goal.id,
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Тогда сузим до десяти карточек сегодня вечером.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              current_plan: "Учить каждый день с утра.",
            },
          ],
          task_actions: [
            {
              op: "create",
              task_id: null,
              title: "Anki 10 карточек вечером",
              due_at: "2026-08-25",
              assignee: "user",
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Давай разберём дело «Anki 20 карточек»",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toBe("Вечерние карточки.");
    const tasks = await repository.listTasks(user.id);
    expect(tasks.find((task) => task.title === "Anki 20 карточек")).toMatchObject({
      goal_id: goal.id,
      status: "todo",
    });
    expect(tasks.find((task) => task.title === "Anki 10 карточек вечером")).toMatchObject({
      goal_id: goal.id,
    });
  });

  it("refines a goal's wording without overwriting this week's plan", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 267, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Формулировку уточнила до разговорного уровня. Недельный план не трогала.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              title: "Выучить французский до разговорного B1",
              horizon: "medium",
              current_plan: "Учить каждый день с утра.",
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: `Посмотри цель «Выучить французский» [${goal.id}]. Она ещё актуальна и корректно сформулирована?`,
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    const updated = await repository.getGoal(user.id, goal.id);
    expect(updated?.title).toBe("Выучить французский до разговорного B1");
    expect(updated?.horizon).toBe("medium");
    expect(updated?.current_plan).toBe("Вечерние карточки.");
    expect(replied.body.data.response.answer).toMatch(
      /Уточнила цель: Выучить французский до разговорного B1/,
    );
    expect(replied.body.data.response.answer).not.toMatch(/Обновила план/);
  });

  it("does not complete a goal or wipe notes on a plan write", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 268, name: "A" });
    const goal = await repository.createGoal(user.id, {
      title: "Выучить французский",
      description: "Ради свободы говорить, не оценок.",
      current_plan: "Вечерние карточки.",
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Собрала план на неделю.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "update",
              goal_id: goal.id,
              title: "французский",
              description: "",
              status: "completed",
              current_plan: "20 карточек по вечерам.",
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Разложи цель «Выучить французский»",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    const updated = await repository.getGoal(user.id, goal.id);
    expect(updated?.status).toBe("active");
    expect(updated?.title).toBe("Выучить французский");
    expect(updated?.description).toBe("Ради свободы говорить, не оценок.");
    expect(updated?.current_plan).toMatch(/вечерам/);
  });

  it("creates at most one next task on a goal check-in", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 269, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Выучить французский" });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Сдвинулись карточки. Один следующий шаг — короткое аудио.",
          context_used: ["goals"],
          follow_up: null,
          task_actions: [
            { op: "create", task_id: null, title: "Аудио 5 минут", due_at: null, assignee: "user" },
            { op: "create", task_id: null, title: "Купить учебник", due_at: null, assignee: "user" },
            { op: "create", task_id: null, title: "Найти репетитора", due_at: null, assignee: "user" },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Давай проверим цель «Выучить французский»",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect((await repository.listTasks(user.id)).map((task) => task.title)).toEqual(["Аудио 5 минут"]);
    expect((await repository.listTasks(user.id))[0]).toMatchObject({ goal_id: goal.id });
  });

  it("creates at most three next tasks when discussing a goal", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 274, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Выучить французский" });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Ближайшие шаги на эту неделю.",
          context_used: ["goals"],
          follow_up: null,
          task_actions: [
            { op: "create", task_id: null, title: "Anki вечером", due_at: null, assignee: "user" },
            { op: "create", task_id: null, title: "Аудио 5 минут", due_at: null, assignee: "user" },
            { op: "create", task_id: null, title: "Купить учебник", due_at: null, assignee: "user" },
            { op: "create", task_id: null, title: "Найти репетитора", due_at: null, assignee: "user" },
            { op: "create", task_id: null, title: "Записаться на клуб", due_at: null, assignee: "user" },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Давай обсудим цель «Выучить французский»",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect((await repository.listTasks(user.id)).map((task) => task.title)).toEqual([
      "Anki вечером",
      "Аудио 5 минут",
      "Купить учебник",
    ]);
    expect((await repository.listTasks(user.id))[0]).toMatchObject({ goal_id: goal.id });
  });

  it("updates a matching goal instead of creating a duplicate", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 27, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Выучить французский" });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Обновила план по французскому.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "create",
              title: "французский",
              current_plan: "20 карточек по вечерам, без утренних марафонов.",
              tasks: [{ title: "Anki вечером", due_at: "2026-08-26", assignee: "user" }],
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Разложи цель «Выучить французский»",
        source_channel: "mini_app",
      });
    expect(replied.status).toBe(201);
    expect(await repository.listGoals(user.id)).toHaveLength(1);
    expect((await repository.getGoal(user.id, goal.id))?.title).toBe("Выучить французский");
    expect((await repository.getGoal(user.id, goal.id))?.current_plan).toMatch(/вечерам/);
    expect(
      (await repository.listTasks(user.id)).find((task) => task.title === "Anki вечером"),
    ).toMatchObject({ goal_id: goal.id });
  });

  it("does not cancel open goal tasks unless they are listed to archive", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 28, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Run a 10k" });
    const keep = await repository.createTask(user.id, {
      title: "Easy Sunday run",
      goal_id: goal.id,
    });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "План на неделю: три лёгких пробежки.",
          context_used: ["goal"],
          follow_up: null,
          task_actions: [
            {
              op: "create",
              task_id: null,
              title: "Three easy runs",
              due_at: "2026-08-30",
              goal_id: goal.id,
              assignee: "user",
            },
          ],
          goal_plan: {
            goal_id: goal.id,
            summary: "Три лёгких пробежки и сон.",
            archive_task_ids: [],
          },
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    const planned = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: `Разложи цель «Run a 10k»`,
        source_channel: "mini_app",
      });
    expect(planned.status).toBe(201);
    const tasks = await repository.listTasks(user.id);
    expect(tasks.find((task) => task.id === keep.id)?.status).toBe("todo");
    expect(tasks.find((task) => task.title === "Three easy runs")?.status).toBe("todo");
  });

  it("binds a new plan's tasks to the goal instead of swallowing them into an unrelated similar task", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 29, name: "A" });
    const other = await repository.createGoal(user.id, { title: "Купить подарки" });
    await repository.createTask(user.id, {
      title: "Anki 20 карточек",
      goal_id: other.id,
    });
    const orphan = await repository.createTask(user.id, { title: "Anki 20 карточек" });
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Зафиксировала французский и ближайший шаг.",
          context_used: ["goals"],
          follow_up: null,
          goal_actions: [
            {
              op: "create",
              title: "Выучить французский",
              current_plan: "Вечерние карточки.",
              tasks: [{ title: "Anki 20 карточек", due_at: "2026-08-25", assignee: "user" }],
            },
          ],
        };
      },
    });
    const app = createApp({ repository, telegram: new FakeTelegram(), env, ai });
    await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Синк по целям и плану. Хочу выучить французский.",
        source_channel: "mini_app",
      });
    const french = (await repository.listGoals(user.id)).find(
      (goal) => goal.title === "Выучить французский",
    );
    expect(french).toBeTruthy();
    const tasks = await repository.listTasks(user.id);
    expect(tasks.find((task) => task.id === orphan.id)).toMatchObject({
      goal_id: french?.id,
      status: "todo",
    });
    expect(tasks.find((task) => task.goal_id === other.id)?.title).toBe("Anki 20 карточек");
  });

  it("accepts Mini App companion body with source_channel", async () => {
    const ai = fallbackAi({
      async companion(query) {
        return { answer: `Reply: ${query}`, context_used: ["values"], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 22, name: "A" });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "Need advice", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    expect(response.body.data.response.answer).toMatch(/Need advice/);
  });

  it("streams companion answer deltas before the persisted reply", async () => {
    const ai = fallbackAi({
      async companionStream(_query, _context, onAnswerDelta) {
        onAnswerDelta?.("Hello");
        onAnswerDelta?.("Hello there");
        return { answer: "Hello there", context_used: [], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 24, name: "A" });
    const response = await request(app)
      .post("/api/companion/messages/stream")
      .set(await auth(user.id))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
        res.on("error", callback);
      })
      .send({ content: "hi", source_channel: "mini_app" });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    const body = String(response.body);
    expect(body).toContain('"type":"delta"');
    expect(body).toContain("Hello there");
    expect(body).toContain('"type":"done"');
    expect(body).toMatch(/data:.*"answer":"Hello"/);
  });

  it("uses a safe outage fallback without hidden memory writes", async () => {
    const ai = fallbackAi({
      async companion() {
        throw new Error("outage");
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 20, name: "A" });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "I feel stuck" });
    expect(response.status).toBe(201);
    expect(response.body.data.response.answer).toMatch(/не удалось/);
    expect(response.body.data.assistant_message.metadata.ai_unavailable).toBe(true);
    expect(response.body.data.assistant_message.metadata.offers).toEqual([]);
    expect(response.body.data.response.offers).toEqual([]);
    expect(repository.memories).toHaveLength(0);
    expect(repository.messages).toHaveLength(1);
    expect(repository.messages[0]?.role).toBe("user");
  });

  it("retries the last unanswered companion turn in place", async () => {
    let calls = 0;
    const ai = fallbackAi({
      async companion(query) {
        calls += 1;
        if (calls === 1) throw new Error("outage");
        return { answer: `Reply: ${query}`, context_used: ["values"], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 21, name: "A" });
    const first = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "как настроение?", source_channel: "mini_app" });
    expect(first.status).toBe(201);
    expect(first.body.data.assistant_message.metadata.ai_unavailable).toBe(true);
    const retried = await request(app)
      .post("/api/companion/messages/retry")
      .set(await auth(user.id))
      .send({ source_channel: "mini_app" });
    expect(retried.status).toBe(201);
    expect(retried.body.data.user_message.id).toBe(first.body.data.user_message.id);
    expect(retried.body.data.assistant_message.content).toMatch(/как настроение/);
    expect(retried.body.data.assistant_message.metadata.ai_unavailable).toBeUndefined();
    expect(repository.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("collapses duplicate failed companion turns on retry", async () => {
    const { app, repository } = setup(
      fallbackAi({
        async companion() {
          return { answer: "Сегодня три дела.", context_used: [], follow_up: null };
        },
      }),
    );
    const user = await repository.upsertTelegramUser({ telegram_id: 25, name: "A" });
    const conversation = await repository.getPrimaryConversation(user.id);
    const first = await repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "user",
      content: "как настроение?",
      intent: "companion",
      source_channel: "mini_app",
      metadata: {},
    });
    await repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "assistant",
      content:
        "Сейчас не удалось связаться с AI. Я сохранил сообщение в общей истории — попробуйте ещё раз позже.",
      intent: "companion",
      source_channel: "mini_app",
      metadata: { ai_unavailable: true },
    });
    await repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "user",
      content: "как настроение?",
      intent: "companion",
      source_channel: "mini_app",
      metadata: {},
    });
    await repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "assistant",
      content:
        "Сейчас не удалось связаться с AI. Я сохранил сообщение в общей истории — попробуйте ещё раз позже.",
      intent: "companion",
      source_channel: "mini_app",
      metadata: { ai_unavailable: true },
    });
    const retried = await request(app)
      .post("/api/companion/messages/retry")
      .set(await auth(user.id))
      .send({});
    expect(retried.status).toBe(201);
    expect(retried.body.data.user_message.id).toBe(first?.id);
    expect(retried.body.data.assistant_message.content).toBe("Сегодня три дела.");
    expect(repository.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "user", content: "как настроение?" },
      { role: "assistant", content: "Сегодня три дела." },
    ]);
  });

  it("lists only today's tasks and does not invent 09:00", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer:
            "На сегодня у тебя запланированы следующие дела:\n1. Переделать отчеты — срок до 09:00.\n2. Начать работу по своей осознанности",
          context_used: ["tasks"],
          follow_up: null,
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 26, name: "A" });
    const today = companionClock("Europe/Moscow").date;
    const tomorrow = new Date(`${today}T12:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    await repository.createTask(user.id, {
      title: "Построить план работ по лоцен",
      due_at: `${today}T09:00:00.000Z`,
    });
    await repository.createTask(user.id, {
      title: "Переделать отчеты по залу в инциденты",
      due_at: `${tomorrowKey}T09:00:00.000Z`,
    });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "какие дела есть на сегодня?", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    const answer = response.body.data.assistant_message.content as string;
    expect(answer).toMatch(/Построить план работ по лоцен/);
    expect(answer).not.toMatch(/отчеты по залу/);
    expect(answer).not.toMatch(/09:00/);
    expect(await repository.listTasks(user.id)).toHaveLength(2);
  });

  it("still replies when creating a task fails", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Записал тёмную тему.",
          context_used: [],
          follow_up: null,
          task_actions: [
            { op: "create", task_id: "not-a-uuid", title: "Тёмная тема", due_at: null },
          ],
          offers: [],
        };
      },
    });
    const { app, repository } = setup(ai);
    repository.createTask = async () => {
      throw Object.assign(new Error('new row for relation "tasks" violates check constraint'), {
        code: "23514",
      });
    };
    const user = await repository.upsertTelegramUser({ telegram_id: 24, name: "A" });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "Нужно добавить темную тему в приложение", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    expect(response.body.data.assistant_message.content).toMatch(/тёмную тему/);
    expect(await repository.listTasks(user.id)).toEqual([]);
  });

  it("stores short self theses from companion and uses them in later context", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Учту: вечером тебе яснее думается.",
          context_used: ["self"],
          follow_up: null,
          self_facts: [
            { content: "лучше думаю вечером", category: "preference", occurred_at: null },
          ],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 41, name: "A" });
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "Я лучше думаю вечером", source_channel: "mini_app" });
    expect(created.status).toBe(201);
    const self = (await repository.getSelfPerson(user.id))!;
    expect(await repository.listMemories(user.id, self.id)).toEqual([
      expect.objectContaining({ content: "лучше думаю вечером", category: "preference" }),
    ]);
    const context = await new PersonalContextBuilder(repository).build(user.id, "вечерний план");
    expect(context.self_memories.map((memory) => memory.content)).toContain("лучше думаю вечером");
  });

  it("learns implicit habits and writes a portrait without «запомни»", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Ок, буду короче.",
          context_used: ["self"],
          follow_up: null,
          self_facts: [],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 43, name: "A" });
    for (const title of ["Счета", "Налоги", "Страховка"]) {
      await repository.createTask(user.id, {
        title,
        due_at: "2026-08-01T12:00:00.000Z",
      });
    }
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Я сова. Давай короче, без воды пожалуйста.",
        source_channel: "mini_app",
      });
    expect(created.status).toBe(201);
    const self = (await repository.getSelfPerson(user.id))!;
    const memories = await repository.listMemories(user.id, self.id);
    expect(memories.map((memory) => memory.content).join(" ")).toMatch(/сова/);
    expect(memories.map((memory) => memory.content).join(" ")).toMatch(/короткие ответы/);
    const profile = await repository.getProfile(user.id);
    expect(profile?.communication_style).toBe("коротко и по делу");
    expect(profile?.context_summary).toMatch(/сова|коротко/i);
    expect(profile?.context_summary).not.toMatch(/Стиль общения|Дела в срок/i);
    expect(profile?.context_summary).not.toMatch(/склонен откладывать|копит просрочен/i);
    const workspace = toCompanionWorkspace(
      await new PersonalContextBuilder(repository).build(user.id, "что делать"),
    );
    expect(workspace.self.portrait).toBeTruthy();
    expect(workspace.self.patterns.some((item) => item.kind === "overdue_cluster")).toBe(true);
  });

  it("updates a stored self thesis when the user corrects it", async () => {
    let turn = 0;
    const ai = fallbackAi({
      async companion() {
        turn += 1;
        if (turn === 1) {
          return {
            answer: "Записала: лучше думаешь вечером.",
            context_used: ["self"],
            follow_up: null,
            self_facts: [
              { content: "лучше думаю вечером", category: "preference", occurred_at: null },
            ],
          };
        }
        return {
          answer: "Обновила: лучше думаешь утром.",
          context_used: ["self"],
          follow_up: null,
          self_facts: [
            { content: "лучше думаю утром", category: "preference", occurred_at: null },
          ],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 42, name: "A" });
    const headers = await auth(user.id);
    expect(
      (await request(app).post("/api/companion/messages").set(headers).send({
        content: "Я лучше думаю вечером",
        source_channel: "mini_app",
      })).status,
    ).toBe(201);
    expect(
      (await request(app).post("/api/companion/messages").set(headers).send({
        content: "Нет, лучше утром",
        source_channel: "mini_app",
      })).status,
    ).toBe(201);
    const self = (await repository.getSelfPerson(user.id))!;
    const memories = await repository.listMemories(user.id, self.id);
    expect(memories).toHaveLength(1);
    expect(memories[0]?.content).toBe("лучше думаю утром");
  });

  it("enforces context section limits", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 21, name: "A" });
    const self = (await repository.getSelfPerson(user.id))!;
    for (let i = 0; i < 20; i++)
      await repository.createMemory(user.id, self.id, {
        content: `Fact ${i}`,
        category: "other",
        importance: (i % 5) + 1,
      });
    const context = await new PersonalContextBuilder(repository).build(user.id, "hello");
    expect(context.self_memories).toHaveLength(PersonalContextBuilder.limits.selfMemories);
  });

  it("keeps query-matching goals, promises and tasks inside context limits", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 51, name: "A" });
    for (let i = 0; i < PersonalContextBuilder.limits.goals + 2; i++)
      await repository.createGoal(user.id, { title: `Other goal ${i}` });
    const french = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "30 минут практики каждый день",
    });
    for (let i = 0; i < PersonalContextBuilder.limits.promises + 2; i++)
      await repository.createPromise(user.id, { title: `Habit ${i}` });
    await repository.createPromise(user.id, { title: "Не пропускать французский" });
    for (let i = 0; i < PersonalContextBuilder.limits.tasks + 2; i++)
      await repository.createTask(user.id, { title: `Buy milk ${i}` });
    await repository.createTask(user.id, {
      title: "Повторить французский",
      goal_id: french.id,
    });
    const context = await new PersonalContextBuilder(repository).build(
      user.id,
      "как идёт французский?",
    );
    expect(context.goals.map((goal) => goal.title)).toContain("Выучить французский");
    expect(context.promises.map((item) => item.title)).toContain("Не пропускать французский");
    expect(context.tasks.map((task) => task.title)).toContain("Повторить французский");
    expect(context.goals).toHaveLength(PersonalContextBuilder.limits.goals);
    expect(context.promises).toHaveLength(PersonalContextBuilder.limits.promises);
    expect(context.tasks).toHaveLength(PersonalContextBuilder.limits.tasks);
  });

  it("on weekly sync prefers goals that still need a week plan", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 53, name: "A" });
    for (let i = 0; i < PersonalContextBuilder.limits.goals; i++) {
      await repository.createGoal(user.id, {
        title: `Planned goal ${i}`,
        current_plan: "Уже есть план.",
      });
    }
    await repository.createGoal(user.id, { title: "Выучить французский" });
    const context = await new PersonalContextBuilder(repository).build(
      user.id,
      "Синк по целям и плану.",
    );
    expect(context.goals.map((goal) => goal.title)).toContain("Выучить французский");
  });

  it("keeps the discussed goal and its tasks in context on a short follow-up", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 52, name: "A" });
    for (let i = 0; i < PersonalContextBuilder.limits.goals + 2; i++) {
      await repository.createGoal(user.id, { title: `Other goal ${i}` });
    }
    const french = await repository.createGoal(user.id, {
      title: "Выучить французский",
      current_plan: "Вечерние карточки.",
    });
    for (let i = 0; i < PersonalContextBuilder.limits.tasks + 2; i++) {
      await repository.createTask(user.id, { title: `Buy milk ${i}` });
    }
    await repository.createTask(user.id, {
      title: "Anki 20 карточек",
      goal_id: french.id,
    });
    const conversation = await repository.getPrimaryConversation(user.id);
    await repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "user",
      content: "Давай обсудим цель «Выучить французский»",
      intent: "companion",
      source_channel: "mini_app",
      metadata: {},
    });
    const context = await new PersonalContextBuilder(repository).build(
      user.id,
      "да, давай вечерние карточки",
    );
    const workspace = toCompanionWorkspace(context);
    expect(context.goals[0]?.title).toBe("Выучить французский");
    expect(context.tasks.map((task) => task.title)).toContain("Anki 20 карточек");
    expect(workspace.goals[0]?.open_tasks.some((task) => task.title === "Anki 20 карточек")).toBe(
      true,
    );
    expect(context.goals).toHaveLength(PersonalContextBuilder.limits.goals);
    expect(context.tasks).toHaveLength(PersonalContextBuilder.limits.tasks);
  });

  it("attaches a person from recent chat when the query uses a pronoun", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 31, name: "A" });
    const dima = await repository.createPerson(user.id, { name: "Дима", relationship: "друг" });
    await repository.createMemory(user.id, dima.id, {
      content: "любит машины",
      category: "interest",
    });
    const conversation = await repository.getPrimaryConversation(user.id);
    await repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "user",
      content: "у меня есть друг дима",
      intent: "companion",
      source_channel: "mini_app",
      metadata: {},
    });
    const context = await new PersonalContextBuilder(repository).build(
      user.id,
      "найди ему подарок",
    );
    expect(context.relevant_person?.name).toBe("Дима");
    expect(context.people_index).toEqual([
      expect.objectContaining({ name: "Дима", relationship: "друг" }),
    ]);
    expect(context.relevant_people[0]?.memories.map((memory) => memory.content)).toContain(
      "любит машины",
    );
    expect(
      focusedSearchQuery("найди ему подарок", {
        name: "Дима",
        memories: [{ content: "любит машины", category: "interest" }],
      }),
    ).toMatch(/Дима.*машин/i);
    // Человек назван по имени: в магазине ищем по его вкусам, а не «подарок Оле».
    expect(
      focusedSearchQuery("Что подарить Оле на день рождения?", {
        name: "Оля",
        memories: [
          { content: "Любит настольные игры", category: "interest" },
          { content: "День рождения 14 ноября", category: "important_date" },
        ],
      }),
    ).toBe("подарок настольные игры");
    expect(
      focusedSearchQuery("Что подарить Оле на день рождения?", { name: "Оля", memories: [] }),
    ).toBe("Что подарить Оле на день рождения?");
  });

  it("searches real products from a companion request", async () => {
    const discovery: DiscoveryClient = {
      async search() {
        return [
          {
            kind: "product",
            title: "Sony WH-1000XM5",
            subtitle: "наушники",
            url: "https://example.com/sony-wh",
            price: "7990 ₽",
            source: "test",
          },
        ];
      },
    };
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Нашла варианты по вашему запросу.",
          context_used: [],
          follow_up: null,
          task_actions: [],
          offers: [],
        };
      },
    });
    const { app, repository } = setup(ai, discovery);
    const user = await repository.upsertTelegramUser({ telegram_id: 25, name: "A" });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "найди наушники sony до 8000", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    expect(response.body.data.assistant_message.metadata.search_results).toEqual([
      expect.objectContaining({ title: "Sony WH-1000XM5", url: "https://example.com/sony-wh" }),
    ]);
    expect(response.body.data.response.answer).toMatch(/Sony WH-1000XM5|example.com\/sony-wh/);
  });

  it("offers live exchanger rates instead of a generic web search when capturing money exchange", async () => {
    const searched: string[] = [];
    const discovery: DiscoveryClient = {
      async search(intent) {
        searched.push(intent.type);
        return [
          {
            kind: "web",
            title: "ЦБ: USD 92,12 ₽",
            subtitle: "официальный курс на сегодня",
            url: "https://www.cbr.ru/currency_base/daily/",
            price: "92,12 ₽",
            source: "ЦБ РФ",
          },
          {
            kind: "place",
            title: "Обменник на Арбате",
            subtitle: "Москва",
            url: "https://www.openstreetmap.org/node/123",
            price: null,
            source: "OpenStreetMap",
          },
        ];
      },
    };
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Поставил задачу «Поменять деньги» на понедельник.",
          context_used: [],
          follow_up: null,
          task_actions: [{ op: "create", task_id: null, title: "Поменять деньги", due_at: "2026-09-21" }],
          offers: [
            {
              kind: "research",
              title: "Найти в интернете",
              instruction: "Найди в интернете по текущему вопросу",
            },
          ],
        };
      },
    });
    const { app, repository } = setup(ai, discovery);
    const user = await repository.upsertTelegramUser({ telegram_id: 271, name: "A" });
    const captured = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "поставь дело на понедельник поменять деньги",
        source_channel: "mini_app",
      });
    expect(captured.status).toBe(201);
    expect(searched).toEqual([]);
    const titles = (
      (captured.body.data.assistant_message.metadata.offers as { title: string; instruction: string }[]) ??
      []
    ).map((offer) => offer.title);
    expect(titles).toEqual(expect.arrayContaining([expect.stringMatching(/Выгодный курс/)]));
    expect(titles).not.toContain("Найти в интернете");
    const chip = (
      captured.body.data.assistant_message.metadata.offers as { title: string; instruction: string }[]
    ).find((offer) => /Выгодный курс/.test(offer.title));
    const found = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: `Сделай сам: ${chip?.instruction}`,
        source_channel: "mini_app",
      });
    expect(found.status).toBe(201);
    expect(searched).toEqual(["fx"]);
    expect(found.body.data.assistant_message.metadata.search_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "ЦБ: USD 92,12 ₽" }),
        expect.objectContaining({ title: "Обменник на Арбате" }),
      ]),
    );
    expect(found.body.data.response.answer).toMatch(/ЦБ: USD 92,12|Обменник на Арбате/);
  });

  it("uses saved cities for self and people when matching products and places", async () => {
    const cities: string[] = [];
    const discovery: DiscoveryClient = {
      async search(intent) {
        cities.push(intent.city ?? "");
        return [
          {
            kind: "place",
            title: "Cafe",
            subtitle: intent.city ?? "",
            url: "https://example.com/cafe",
            price: null,
            source: "test",
          },
        ];
      },
    };
    const { app, repository } = setup(
      fallbackAi({
        async companion() {
          return {
            answer: "Нашла места рядом.",
            context_used: ["city"],
            follow_up: null,
            task_actions: [],
            offers: [],
          };
        },
      }),
      discovery,
    );
    const user = await repository.upsertTelegramUser({ telegram_id: 41, name: "A" });
    const self = (await repository.getSelfPerson(user.id))!;
    await repository.createLocation(user.id, self.id, { city: "Казань", address: "ул. Баумана 1" });
    const dima = await repository.createPerson(user.id, { name: "Дима" });
    await repository.createLocation(user.id, dima.id, { city: "Сочи" });
    const context = await new PersonalContextBuilder(repository).build(user.id, "hello");
    expect(context.city).toBe("Казань");
    expect(context.self_locations).toEqual([
      expect.objectContaining({ city: "Казань", address: "ул. Баумана 1" }),
    ]);
    expect(context.people_index).toEqual([expect.objectContaining({ name: "Дима", city: "Сочи" })]);
    const forSelf = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "найди ресторан рядом", source_channel: "mini_app" });
    expect(forSelf.status).toBe(201);
    const conversation = await repository.getPrimaryConversation(user.id);
    await repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "user",
      content: "у меня есть друг дима",
      intent: "companion",
      source_channel: "mini_app",
      metadata: {},
    });
    const forDima = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "найди ему ресторан", source_channel: "mini_app" });
    expect(forDima.status).toBe(201);
    expect(cities).toContain("Казань");
    expect(cities).toContain("Сочи");
  });

  it("quietly offers a capability chip on a greeting", async () => {
    const ai = fallbackAi({
      async companion() {
        return { answer: "Привет. Я рядом.", context_used: [], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 26, name: "A" });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "привет", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    const titles = (
      (response.body.data.assistant_message.metadata.offers as { title: string }[]) ?? []
    ).map((offer) => offer.title);
    expect(titles).not.toContain("Найти товар");
    expect(titles).not.toContain("Куда сходить");
    expect(response.body.data.response.answer).not.toMatch(/Яндекс Маркет|Google|Apple/);
  });

  it("offers gift and table chips two weeks before a birthday", async () => {
    const ai = fallbackAi({
      async companion() {
        return { answer: "Привет. Я рядом.", context_used: ["upcoming_dates"], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 261, name: "A" });
    const masha = await repository.createPerson(user.id, { name: "Маша" });
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 12);
    await repository.createDate(user.id, masha.id, {
      kind: "birthday",
      month: soon.getUTCMonth() + 1,
      day: soon.getUTCDate(),
      year: null,
    });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "привет", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    expect(response.body.data.assistant_message.metadata.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Подарок: Маша" }),
        expect.objectContaining({ title: "Проект: День рождения Маша" }),
      ]),
    );
    expect(await repository.listProjects(user.id)).toEqual([]);
  });

  it("does not offer flowers for a male friend", async () => {
    const ai = fallbackAi({
      async companion() {
        return { answer: "Привет. Я рядом.", context_used: ["upcoming_dates"], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 262, name: "A" });
    const dima = await repository.createPerson(user.id, { name: "Дима", relationship: "друг" });
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    await repository.createDate(user.id, dima.id, {
      kind: "birthday",
      month: soon.getUTCMonth() + 1,
      day: soon.getUTCDate(),
      year: null,
    });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "привет", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    const titles = (response.body.data.assistant_message.metadata.offers as { title: string }[]).map(
      (offer) => offer.title,
    );
    expect(titles.some((title) => /цвет/i.test(title))).toBe(false);
    expect(titles).toEqual(expect.arrayContaining(["Подарок: Дима"]));
  });

  it("mentions a past gift in the birthday offer and creates a prep project only when asked", async () => {
    const ai = fallbackAi({
      async companion() {
        return { answer: "Ок, собираю подготовку.", context_used: ["upcoming_dates"], follow_up: null };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 263, name: "A" });
    const katya = await repository.createPerson(user.id, { name: "Катя", relationship: "девушка" });
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 12);
    await repository.createDate(user.id, katya.id, {
      kind: "birthday",
      month: soon.getUTCMonth() + 1,
      day: soon.getUTCDate(),
      year: null,
    });
    await repository.createMemory(user.id, katya.id, {
      content: "на прошлый день рождения дарили последний iPhone",
      category: "gift",
    });
    const hello = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "привет", source_channel: "mini_app" });
    const gift = (hello.body.data.assistant_message.metadata.offers as { title: string; instruction: string }[]).find(
      (offer) => offer.title === "Подарок: Катя",
    );
    expect(gift?.instruction).toMatch(/iPhone/);
    expect(await repository.listProjects(user.id)).toEqual([]);
    const chip = (hello.body.data.assistant_message.metadata.offers as { title: string; instruction: string }[]).find(
      (offer) => offer.title.startsWith("Проект:"),
    );
    expect(chip?.instruction).toMatch(/пустой проект|без дел/);
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: chip?.instruction, source_channel: "mini_app" });
    expect(created.status).toBe(201);
    expect((await repository.listProjects(user.id)).map((item) => item.name)).toEqual([
      expect.stringMatching(/День рождения Катя/),
    ]);
    expect(await repository.listTasks(user.id)).toEqual([]);
    expect(created.body.data.assistant_message.metadata.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Подарок: Катя" }),
      ]),
    );
    expect(created.body.data.assistant_message.content).toMatch(/что могу взять на себя|проект/i);
  });

  it("creates birthday reminder tasks when asked", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Напомню про день рождения Маши.",
          context_used: ["upcoming_dates"],
          follow_up: null,
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 27, name: "A" });
    const masha = await repository.createPerson(user.id, { name: "Маша" });
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 12);
    await repository.createMemory(user.id, masha.id, {
      content: "День рождения",
      category: "important_date",
      occurred_at: soon.toISOString(),
    });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "напомни о днях рождения", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    expect(await repository.listTasks(user.id)).toEqual([
      expect.objectContaining({ title: "День рождения: Маша" }),
    ]);
  });

  it("saves a mentioned friend, birthday and interests from chat", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Записал Диму.",
          context_used: [],
          follow_up: null,
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 28, name: "A" });
    const created = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "у меня есть друг дима, день рождения 29.03.1994",
        source_channel: "mini_app",
      });
    expect(created.status).toBe(201);
    const dima = (await repository.listPeople(user.id)).find((person) => person.name === "Дима");
    expect(dima?.relationship).toBe("друг");
    expect(created.body.data.assistant_message.metadata.entities).toEqual([
      expect.objectContaining({ type: "person", label: "Дима" }),
    ]);
    await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "дима любит машины и бмв", source_channel: "mini_app" });
    expect(await repository.listMemories(user.id, dima!.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "important_date" }),
        expect.objectContaining({ category: "interest", content: "любит машины" }),
        expect.objectContaining({ category: "interest", content: "любит бмв" }),
      ]),
    );
  });

  it("uses conversation people for a follow-up gift search", async () => {
    const captured: {
      intent: { type: string; query: string } | null;
      context: {
        workspace?: {
          focused_people?: { name: string }[];
          capabilities?: string[];
          now?: { date?: string; end_of_next_week?: string };
        };
        conversation?: { role: string; content: string }[];
      } | null;
    } = { intent: null, context: null };
    const discovery: DiscoveryClient = {
      async search(intent) {
        captured.intent = intent;
        return [
          {
            kind: "product",
            title: "Модель BMW",
            subtitle: "подарок",
            url: "https://example.com/bmw",
            price: null,
            source: "test",
          },
        ];
      },
    };
    const ai = fallbackAi({
      async companion(_query, context) {
        captured.context = context as typeof captured.context;
        return {
          answer: "Подобрала подарок.",
          context_used: ["focused_people"],
          follow_up: null,
          task_actions: [],
          offers: [],
          search_actions: [],
          person_facts: [],
        };
      },
    });
    const { app, repository } = setup(ai, discovery);
    const user = await repository.upsertTelegramUser({ telegram_id: 32, name: "A" });
    const headers = await auth(user.id);
    await request(app).post("/api/companion/messages").set(headers).send({
      content: "у меня есть друг дима, день рождения 29.03.1994",
      source_channel: "mini_app",
    });
    await request(app)
      .post("/api/companion/messages")
      .set(headers)
      .send({ content: "дима любит машины и бмв", source_channel: "mini_app" });
    const gift = await request(app)
      .post("/api/companion/messages")
      .set(headers)
      .send({ content: "найди ему подарок", source_channel: "mini_app" });
    expect(gift.status).toBe(201);
    expect(captured.intent?.type).toBe("gifts");
    expect(captured.intent?.query).toMatch(/Дима/i);
    expect(captured.intent?.query).toMatch(/машин/i);
    expect(captured.context?.workspace?.focused_people?.[0]?.name).toBe("Дима");
    expect(captured.context?.workspace?.capabilities?.some((item) => item.includes("web"))).toBe(
      true,
    );
    expect(captured.context?.workspace?.now?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(captured.context?.workspace?.now?.end_of_next_week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(captured.context?.conversation?.some((turn) => /дима/i.test(turn.content))).toBe(true);
    expect(gift.body.data.assistant_message.metadata.search_results).toEqual([
      expect.objectContaining({ url: "https://example.com/bmw" }),
    ]);
  });
});

describe("feedback and weekly reflection", () => {
  it("stores recommendation feedback and handles empty and nonempty weeks", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 30, name: "A" });
    const recommendation = await repository.createRecommendation(user.id, {
      query: "Ideas",
      items: [1, 2, 3].map((n) => ({ title: `I${n}`, rationale: "General" })),
      memory_ids: [],
    });
    const feedback = await request(app)
      .post(`/api/recommendations/${recommendation.id}/feedback`)
      .set(await auth(user.id))
      .send({ item_index: 0, outcome: "used", note: "Worked" });
    expect(feedback.status).toBe(201);
    const empty = await request(app)
      .post("/api/reflections/weekly")
      .set(await auth(user.id));
    expect(empty.body.data.improvements[0]).toMatch(/недостаточно/);
    expect(repository.betaMetrics).toEqual([
      expect.objectContaining({ owner_id: user.id, name: "reflection_completed" }),
    ]);
    await repository.createTask(user.id, { title: "Finish report" });
    const nonempty = await request(app)
      .post("/api/reflections/weekly")
      .set(await auth(user.id));
    expect(nonempty.body.data.next_steps).toContain("Finish report");
  });
});

describe("experience memory", () => {
  it("extracts, resolves participants, and writes confirmed preference provenance", async () => {
    expect(
      extractExperience("Вчера были с Машей в ресторане X, Маше понравилось уютное место"),
    ).toMatchObject({
      type: "restaurant",
      participant_query: "Машей",
      place: "X",
    });
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 40, name: "A" });
    const masha = await repository.createPerson(user.id, { name: "Маша" });
    const result = await new ExperienceService(repository).capture(
      user.id,
      "Вчера были с Машей в ресторане X, Маше понравилось уютное место",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result?.experience?.participant_ids).toEqual([masha.id]);
    expect((await repository.listMemories(user.id, masha.id))[0]).toMatchObject({
      category: "preference",
      source_message_id: "00000000-0000-4000-8000-000000000001",
      metadata: { experience_id: result?.experience?.id },
    });
  });

  it("uses structured AI extraction for experience phrasing beyond the fallback", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 43, name: "A" });
    const ai = fallbackAi({
      async extractExperience() {
        return {
          experience: {
            type: "event",
            title: "Камерный концерт",
            place: "Дом музыки",
            participant_query: null,
            positive_signals: ["камерная атмосфера"],
            negative_signals: [],
            emotions: ["inspired"],
            occurred_at: "2026-07-09T18:00:00.000Z",
          },
        };
      },
    });
    const captured = await new ExperienceService(repository, ai).capture(
      user.id,
      "Недавно отлично провели вечер на камерном концерте",
      "00000000-0000-4000-8000-000000000002",
    );
    expect(captured?.experience).toMatchObject({
      type: "event",
      title: "Камерный концерт",
      positive_signals: ["камерная атмосфера"],
    });
  });

  it("finds due follow-ups and exposes protected external triggering", async () => {
    const { app, repository, telegram } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 41, name: "A" });
    await repository.createExperience(user.id, {
      type: "activity",
      title: "Kayaking",
      status: "planned",
      follow_up_at: "2020-01-01T00:00:00.000Z",
    });
    expect(await repository.findDueExperienceFollowUps(undefined, user.id)).toHaveLength(1);
    expect((await request(app).post("/internal/experience-follow-ups")).status).toBe(401);
    const triggered = await request(app)
      .post("/internal/experience-follow-ups")
      .set("x-cron-secret", env.CRON_SECRET);
    expect(triggered.body.data.triggered).toBe(1);
    expect(telegram.sent[0]?.text).toMatch(/Как вам/);
  });

  it("passes experiences and feedback into recommendation context", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 42, name: "A" });
    const masha = await repository.createPerson(user.id, { name: "Маша" });
    await repository.createExperience(user.id, {
      type: "restaurant",
      title: "Quiet dinner",
      place: "X",
      participant_ids: [masha.id],
      positive_signals: ["quiet"],
      status: "completed",
    });
    let received: { experiences: unknown[] } | undefined;
    const ai = fallbackAi({
      async decide() {
        return {
          intent: "recommend",
          person_query: "Маша",
          content: "ideas",
          category: null,
          title: null,
          space_name: null,
        };
      },
      async recommend(_query, _person, _memories, context) {
        received = context;
        return [1, 2, 3].map((n) => ({
          title: `Novel ${n}`,
          rationale: "Similar calm feeling; experience ID cited",
        }));
      },
    });
    await new AssistantOrchestrator(repository, ai).handle(user.id, "Куда сходить с Машей?");
    expect(received?.experiences).toHaveLength(1);
  });
});
