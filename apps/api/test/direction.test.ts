import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { computeGoalStats, computePromiseStats, daysBetween } from "../src/direction.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { Goal, SelfPromise, Task } from "../src/types.js";

class FakeTelegram implements TelegramGateway {
  async sendMessage() {
    return Promise.resolve();
  }
  async answerCallbackQuery() {
    return Promise.resolve();
  }
}

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

const goal = (overrides: Partial<Goal> = {}): Goal => ({
  id: "g1",
  owner_id: "o",
  title: "Run a 10k",
  description: null,
  status: "active",
  horizon: "short",
  priority: 3,
  target_date: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  owner_id: "o",
  space_id: null,
  person_id: null,
  goal_id: "g1",
  project_id: null,
  due_at: null,
  completed_at: null,
  title: "Buy shoes",
  description: null,
  status: "todo",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("goal and promise stats", () => {
  it("counts linked tasks and days a goal has been active", () => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    const stats = computeGoalStats(
      goal(),
      [
        task({ id: "1", status: "done" }),
        task({ id: "2", status: "todo" }),
        task({ id: "3", status: "cancelled" }),
      ],
      now,
    );
    expect(stats).toMatchObject({
      task_count: 2,
      done_count: 1,
      open_count: 1,
      progress: 50,
      days_active: 10,
    });
  });

  it("tracks keeping streaks and due check-ins for promises", () => {
    const now = new Date("2026-08-24T00:00:00.000Z");
    const promise: SelfPromise = {
      id: "p1",
      owner_id: "o",
      title: "Sleep by 23:00",
      description: null,
      status: "active",
      started_at: "2026-08-01T00:00:00.000Z",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    const keeping = computePromiseStats(promise, [], now);
    expect(keeping.keeping_days).toBe(daysBetween(promise.started_at, now));
    expect(keeping.due_for_checkin).toBe(true);
    expect(keeping.praise_days).toBe(14);

    const broken = computePromiseStats(
      promise,
      [
        {
          id: "c1",
          owner_id: "o",
          promise_id: "p1",
          status: "broken",
          note: null,
          created_at: "2026-08-23T00:00:00.000Z",
        },
      ],
      now,
    );
    expect(broken.keeping_days).toBe(0);
    expect(broken.broken_count).toBe(1);
    expect(broken.due_for_checkin).toBe(false);
  });
});

describe("goals and promises API", () => {
  it("links tasks to a goal and records a promise check-in", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram: new FakeTelegram(), env });
    const user = await repository.upsertTelegramUser({ telegram_id: 91, name: "Anna" });
    const token = await createSession(user.id, sessionSecret, 900);
    const auth = { Authorization: `Bearer ${token}` };

    const createdGoal = await request(app)
      .post("/api/goals")
      .set(auth)
      .send({ title: "Learn French", horizon: "long" });
    expect(createdGoal.status).toBe(201);
    const goalId = createdGoal.body.data.id as string;

    await request(app)
      .post("/api/tasks")
      .set(auth)
      .send({ title: "Anki 20 cards", goal_id: goalId, status: "done" });
    await request(app).post("/api/tasks").set(auth).send({ title: "Watch a film", goal_id: goalId });

    const listed = await request(app).get("/api/goals").set(auth);
    expect(listed.status).toBe(200);
    const row = listed.body.data.find((item: { id: string }) => item.id === goalId);
    expect(row.stats).toMatchObject({ task_count: 2, done_count: 1, open_count: 1, progress: 50 });

    const detail = await request(app).get(`/api/goals/${goalId}`).set(auth);
    expect(detail.body.data.tasks).toHaveLength(2);

    const createdPromise = await request(app)
      .post("/api/promises")
      .set(auth)
      .send({ title: "Phone away after 21:00" });
    expect(createdPromise.status).toBe(201);
    const promiseId = createdPromise.body.data.id as string;
    expect(createdPromise.body.data.stats.due_for_checkin).toBe(false);

    const checkin = await request(app)
      .post(`/api/promises/${promiseId}/checkins`)
      .set(auth)
      .send({ status: "keeping" });
    expect(checkin.status).toBe(201);
    expect(checkin.body.data.promise.stats.keeping_count).toBe(1);
    expect(checkin.body.data.promise.stats.last_checkin_status).toBe("keeping");
  });

  it("archives open tasks when a goal is deleted and keeps them linked", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram: new FakeTelegram(), env });
    const user = await repository.upsertTelegramUser({ telegram_id: 92, name: "Anna" });
    const token = await createSession(user.id, sessionSecret, 900);
    const auth = { Authorization: `Bearer ${token}` };
    const goalId = (
      await request(app).post("/api/goals").set(auth).send({ title: "Run a 10k" })
    ).body.data.id as string;
    const openId = (
      await request(app)
        .post("/api/tasks")
        .set(auth)
        .send({ title: "Buy shoes", goal_id: goalId })
    ).body.data.id as string;
    const doneId = (
      await request(app)
        .post("/api/tasks")
        .set(auth)
        .send({ title: "Download a plan", goal_id: goalId, status: "done" })
    ).body.data.id as string;

    expect((await request(app).delete(`/api/goals/${goalId}`).set(auth)).status).toBe(204);
    const archived = await repository.getGoal(user.id, goalId);
    expect(archived?.status).toBe("cancelled");
    expect((await repository.listTasks(user.id)).find((task) => task.id === openId)).toMatchObject({
      status: "cancelled",
      goal_id: goalId,
    });
    expect((await repository.listTasks(user.id)).find((task) => task.id === doneId)).toMatchObject({
      status: "done",
      goal_id: goalId,
    });
  });
});
