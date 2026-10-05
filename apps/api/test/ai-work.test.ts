import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  applyCompanionTaskActions,
  pickNextAiWork,
  type AiProvider,
} from "../src/modules/assistant/index.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { Task } from "../src/types.js";

const sessionSecret = "session-secret-at-least-thirty-two-characters";
const env = {
  CORS_ORIGIN: "*",
  TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret-at-least-sixteen",
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
    return [];
  },
  ...overrides,
});

const setup = (ai?: AiProvider) => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return { repository, telegram, app: createApp({ repository, telegram, env, ai }) };
};

const auth = async (ownerId: string) => ({
  Authorization: `Bearer ${await createSession(ownerId, sessionSecret, 900)}`,
});

const asTask = (overrides: Partial<Task>): Task => ({
  id: "t1",
  owner_id: "o",
  space_id: null,
  person_id: null,
  goal_id: null,
  project_id: null,
  due_at: null,
  completed_at: null,
  title: "Work",
  description: null,
  status: "todo",
  assignee: "ealzy",
  agent_locked_at: null,
  agent_attempts: 0,
  agent_result: null,
  created_at: "2026-08-27T10:00:00.000Z",
  updated_at: "2026-08-27T10:00:00.000Z",
  ...overrides,
});

describe("ealzy work queue", () => {
  it("picks the earliest due ealzy task", () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    const next = pickNextAiWork(
      [
        asTask({
          id: "later",
          due_at: "2026-08-27T15:00:00.000Z",
          created_at: "2026-08-27T09:00:00.000Z",
        }),
        asTask({
          id: "soon",
          due_at: "2026-08-27T11:00:00.000Z",
          created_at: "2026-08-27T10:00:00.000Z",
        }),
        asTask({ id: "user", assignee: "user", due_at: "2026-08-27T10:00:00.000Z" }),
        asTask({ id: "future", due_at: "2026-08-28T12:00:00.000Z" }),
      ],
      now,
    );
    expect(next?.id).toBe("soon");
  });

  it("creates ealzy tasks on the calendar without running them in the same chat", async () => {
    const { repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 41, name: "A" });
    await applyCompanionTaskActions(
      repository,
      user.id,
      [
        {
          op: "create",
          task_id: null,
          title: "Найти билеты",
          due_at: null,
          estimate_minutes: null,
          goal_id: null,
          project_id: null,
          kind: "task",
          importance: null,
          urgency: null,
          assignee: "ealzy",
        },
      ],
      { timezone: "UTC", userText: "поручи себе найти билеты" },
    );
    const tasks = await repository.listTasks(user.id);
    expect(tasks).toEqual([
      expect.objectContaining({
        title: "Найти билеты",
        assignee: "ealzy",
        status: "todo",
      }),
    ]);
    expect(tasks[0]?.due_at).toBeTruthy();
  });

  it("skips claiming while another ealzy task is running", async () => {
    const repository = new InMemoryRepository();
    const owner = await repository.upsertTelegramUser({ telegram_id: 42, name: "A" });
    const now = new Date("2026-08-27T12:00:00.000Z");
    await repository.createTask(owner.id, {
      title: "Running",
      assignee: "ealzy",
      status: "in_progress",
      agent_locked_at: now.toISOString(),
      due_at: now.toISOString(),
    });
    await repository.createTask(owner.id, {
      title: "Waiting",
      assignee: "ealzy",
      due_at: now.toISOString(),
    });
    expect(await repository.claimNextAiWork(now)).toBeNull();
  });

  it("processes one due ealzy task through companion and notifies telegram", async () => {
    const seen: string[] = [];
    const ai = fallbackAi({
      async companion(query) {
        seen.push(String(query));
        return {
          answer: "Сравнил варианты и выписал три рейса.",
          context_used: [],
          follow_up: null,
          task_actions: [],
          offers: [],
          search_actions: [],
          person_facts: [],
        };
      },
    });
    const { app, repository, telegram } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 43, name: "A" });
    const created = await repository.createTask(user.id, {
      title: "Найти билеты",
      description: "Москва — Сочи на выходные",
      assignee: "ealzy",
      due_at: "2026-08-27T10:00:00.000Z",
    });
    expect((await request(app).post("/internal/ai-work")).status).toBe(401);
    const response = await request(app)
      .post("/internal/ai-work")
      .set("x-cron-secret", env.CRON_SECRET);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ processed: 1, task_id: created.id });
    expect(seen[0]).toMatch(/^Сделай сам: Найти билеты/);
    expect(await repository.listTasks(user.id)).toEqual([
      expect.objectContaining({
        id: created.id,
        status: "done",
        agent_result: expect.stringContaining("три рейса"),
      }),
    ]);
    expect(telegram.sent[0]?.text).toMatch(/Ealzy сделал: Найти билеты/);
    const busy = await request(app)
      .post("/internal/ai-work")
      .set("x-cron-secret", env.CRON_SECRET);
    expect(busy.body.data).toEqual({ processed: 0 });
  });

  it("lets companion schedule ealzy follow-up work from a user discussion", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Возьму поиск билетов на себя.",
          context_used: [],
          follow_up: null,
          task_actions: [
            {
              op: "create",
              task_id: null,
              title: "Сравнить рейсы",
              due_at: null,
              estimate_minutes: null,
              goal_id: null,
              assignee: "ealzy",
            },
          ],
          offers: [],
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 44, name: "A" });
    const response = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "Давай разберём поездку", source_channel: "mini_app" });
    expect(response.status).toBe(201);
    expect(await repository.listTasks(user.id)).toEqual([
      expect.objectContaining({ title: "Сравнить рейсы", assignee: "ealzy", status: "todo" }),
    ]);
  });
});
