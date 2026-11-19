import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import { resetActivityCatalogCache } from "../src/modules/assistant/activities.js";
import { hasSubscription } from "../src/modules/billing/subscription.js";
import { outingDigestLines, outingTask } from "../src/modules/assistant/outings.js";
import type { ActivityCatalog, ActivityType, Outing } from "../src/types.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";

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
};
const telegram: TelegramGateway = { async sendMessage() {}, async answerCallbackQuery() {} };

const kvest: ActivityType = {
  id: "kvest",
  category_id: "games",
  name: "Квест",
  emoji: "🗝",
  description: null,
  activity_level: 2,
  emotion_level: 4,
  price_level: 2,
  duration_hours: 1.5,
  season: "all",
  setting: "indoor",
  min_people: 2,
  kids_ok: false,
  search_query: "квест",
  geo: null,
  sort: 0,
};
const catalog: ActivityCatalog = {
  categories: [{ id: "games", name: "Игры", emoji: "🎲", sort: 0 }],
  types: [kvest],
};
const candidate = {
  source: "2gis" as const,
  source_id: "70000001",
  name: "Клаустрофобия",
  address: "Литейный, 10",
  city: "Санкт-Петербург",
  lat: 59.94,
  lon: 30.35,
  rating: 4.9,
  rating_count: 812,
  image_url: null,
  photos: [],
  phone: "+7 812 000-00-00",
  website: "https://phobia.ru",
  hours: "10:00–23:00",
  twogis_url: "https://2gis.ru/spb/firm/70000001",
};

beforeEach(() => resetActivityCatalogCache());

async function setup(plan: string | null = "pro") {
  const repository = new InMemoryRepository();
  repository.activityCatalog = catalog;
  const app = createApp({ repository, telegram, env });
  const user = await repository.upsertTelegramUser({ telegram_id: 909, name: "Андрей" });
  if (plan) await repository.setUserPlan(user.id, plan, null);
  const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
  return { repository, app, auth, user };
}

describe("подписка", () => {
  it("платный тариф, пока действует, или админ", async () => {
    const repository = new InMemoryRepository();
    expect(await hasSubscription(repository, "u1")).toBe(false);
    await repository.setUserPlan("u1", "free", null);
    expect(await hasSubscription(repository, "u1")).toBe(false);
    await repository.setUserPlan("u1", "pro", "2026-01-01T00:00:00Z");
    expect(await hasSubscription(repository, "u1", new Date("2026-02-01"))).toBe(false);
    await repository.setUserPlan("u1", "pro", null);
    expect(await hasSubscription(repository, "u1")).toBe(true);
  });

  it("без подписки колесо и места закрыты, статус говорит об этом", async () => {
    const { app, auth } = await setup(null);
    const status = await request(app).get("/api/activities/wheel").set(auth);
    expect(status.status).toBe(200);
    expect(status.body.data.subscribed).toBe(false);
    const spin = await request(app).post("/api/activities/wheel").set(auth).send({});
    expect(spin.status).toBe(402);
    expect(spin.body.error.code).toBe("SUBSCRIPTION_REQUIRED");
    const nearby = await request(app).get("/api/places/nearby?type=kvest").set(auth);
    expect(nearby.status).toBe(402);
    const plan = await request(app)
      .post("/api/places/plan")
      .set(auth)
      .send({ candidate, activity_type_id: "kvest" });
    expect(plan.status).toBe(402);
    // Города и интерес к подписке открыты всем.
    expect((await request(app).get("/api/cities?q=спб").set(auth)).status).toBe(200);
    expect(
      (await request(app).post("/api/subscription/request").set(auth).send({ feature: "surprise" }))
        .status,
    ).toBe(201);
  });
});

describe("«Пойду сюда»", () => {
  it("без времени — место в дневнике «хочу», без дела", async () => {
    const { app, auth, repository, user } = await setup();
    const res = await request(app)
      .post("/api/places/plan")
      .set(auth)
      .send({ candidate, activity_type_id: "kvest", when: null });
    expect(res.status).toBe(201);
    expect(res.body.data.task).toBeNull();
    expect(res.body.data.visit).toMatchObject({ status: "want", planned_for: null });
    const visits = await repository.listPlaceVisits(user.id);
    expect(visits).toHaveLength(1);
    const outings = await request(app).get("/api/outings").set(auth);
    expect(outings.body.data[0]).toMatchObject({
      place: "Клаустрофобия",
      phone: "+7 812 000-00-00",
      activity: "Квест",
      planned_for: null,
    });
    // Вкус к квестам чуть вырос.
    const prefs = await repository.listActivityPreferences(user.id);
    expect(prefs.find((p) => p.target_id === "kvest")?.visit_affinity).toBeGreaterThan(0);
  });

  it("со временем — дело в календаре с контактами; перенос не дублирует", async () => {
    const { app, auth, repository, user } = await setup();
    const first = await request(app).post("/api/places/plan").set(auth).send({
      candidate,
      activity_type_id: "kvest",
      when: "2026-11-21T12:00:00+03:00",
    });
    expect(first.status).toBe(201);
    const task = first.body.data.task;
    expect(task).toMatchObject({
      title: "🗝 Квест: Клаустрофобия",
      due_at: "2026-11-21T09:00:00.000Z",
      estimate_minutes: 90,
      kind: "meeting",
    });
    expect(task.description).toContain("Телефон: +7 812 000-00-00");
    expect(task.description).toContain("https://phobia.ru");
    expect(task.description).toContain("rtext=~59.94,30.35");
    const moved = await request(app).post("/api/places/plan").set(auth).send({
      place_id: first.body.data.place.id,
      activity_type_id: "kvest",
      when: "2026-11-22T15:00:00+03:00",
    });
    expect(moved.body.data.task.id).toBe(task.id);
    expect(moved.body.data.visit.planned_for).toBe("2026-11-22T12:00:00.000Z");
    const tasks = (await repository.listTasks(user.id)).filter((t) => t.title.includes("Квест"));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.due_at).toBe("2026-11-22T12:00:00.000Z");
  });

  it("«Пойду» запоминает решение по вращению", async () => {
    const { app, auth, repository, user } = await setup();
    const spin = await repository.createActivitySpin(user.id, {
      local_date: "2026-11-19",
      request: {},
      feedback: null,
      segment_ids: ["kvest"],
      result_type_id: "kvest",
    });
    const res = await request(app)
      .post("/api/activities/going")
      .set(auth)
      .send({ spin_id: spin.id, activity_type_id: "kvest" });
    expect(res.status).toBe(201);
    expect(repository.activitySpins[0]).toMatchObject({ decision: "going" });
  });
});

describe("вопросы после", () => {
  const at = new Date("2026-11-19T19:00:00Z");
  const base: Outing = {
    visit_id: "v",
    place_id: "p",
    place: "Клаустрофобия",
    address: "Литейный, 10",
    phone: null,
    website: null,
    activity: "Квест",
    activity_type_id: "kvest",
    emoji: "🗝",
    planned_for: null,
    task_id: null,
    updated_at: "2026-11-18T10:00:00Z",
  };

  it("вечером: без даты — «когда пойдёшь?», сегодня прошло — «как было?»", () => {
    const lines = outingDigestLines("evening_sync", [base], "Europe/Moscow", true, at);
    expect(lines.join("\n")).toContain("Когда пойдёшь?");
    const done = { ...base, planned_for: "2026-11-19T12:00:00Z" };
    expect(outingDigestLines("evening_sync", [done], "Europe/Moscow", true, at)[0]).toContain(
      "Как сходил",
    );
    // Только что выбрал — вечером не дёргаем.
    const fresh = { ...base, updated_at: "2026-11-19T17:00:00Z" };
    expect(outingDigestLines("evening_sync", [fresh], "Europe/Moscow", true, at)).toEqual([]);
  });

  it("утром — напоминание о сегодняшнем выходе", () => {
    const today = { ...base, planned_for: "2026-11-19T16:00:00Z" };
    const morning = new Date("2026-11-19T06:00:00Z");
    expect(outingDigestLines("morning_digest", [today], "Europe/Moscow", true, morning)[0]).toBe(
      "Сегодня в 19:00 — 🗝 Клаустрофобия, Литейный, 10.",
    );
  });

  it("дело без координат ведёт на карточку в 2ГИС", () => {
    const plan = outingTask(kvest, { ...candidate, lat: null, lon: null }, candidate.twogis_url);
    expect(plan.description).toContain("Как добраться: https://2gis.ru/spb/firm/70000001");
    expect(plan.minutes).toBe(90);
  });
});
