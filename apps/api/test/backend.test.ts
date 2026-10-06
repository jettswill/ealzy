import { createHash, createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession, verifyTelegramInitData } from "../src/modules/auth/index.js";
import {
  AssistantOrchestrator,
  resolvePerson,
  type AiProvider,
} from "../src/modules/assistant/index.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";

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
};
class FakeTelegram implements TelegramGateway {
  sent: { chatId: number; text: string; options?: Record<string, unknown> }[] = [];
  callbacks: string[] = [];
  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
    this.sent.push({ chatId, text, options });
  }
  async answerCallbackQuery(id: string) {
    this.callbacks.push(id);
  }
}
const signedInitData = (user: object, authDate: number, token = botToken) => {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "AAE",
    user: JSON.stringify(user),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
  return params.toString();
};
const setup = (ai?: AiProvider) => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return { repository, telegram, app: createApp({ repository, telegram, env, ai }) };
};
const auth = async (ownerId: string) => ({
  Authorization: `Bearer ${await createSession(ownerId, sessionSecret, 900)}`,
});

describe("Telegram initData", () => {
  it("verifies HMAC and freshness and rejects tampering", () => {
    const now = 1_800_000_000;
    const data = signedInitData({ id: 42, first_name: "Анна" }, now);
    expect(verifyTelegramInitData(data, botToken, 300, now).id).toBe(42);
    const tampered = new URLSearchParams(data);
    tampered.set("user", JSON.stringify({ id: 42, first_name: "Ира" }));
    expect(() => verifyTelegramInitData(tampered.toString(), botToken, 300, now)).toThrow();
    expect(() =>
      verifyTelegramInitData(
        signedInitData({ id: 42, first_name: "Анна" }, now - 301),
        botToken,
        300,
        now,
      ),
    ).toThrow(/expired/i);
  });
});

describe("tenant-safe API", () => {
  it("derives ownership from session and ignores owner_id input", async () => {
    const { app, repository } = setup();
    const first = await repository.upsertTelegramUser({ telegram_id: 1, name: "A" });
    const second = await repository.upsertTelegramUser({ telegram_id: 2, name: "B" });
    const created = await request(app)
      .post("/api/people")
      .set(await auth(first.id))
      .send({ name: "Маша", owner_id: second.id });
    expect(created.status).toBe(400);
    const valid = await request(app)
      .post("/api/people")
      .set(await auth(first.id))
      .send({ name: "Маша" });
    expect(valid.status).toBe(201);
    const hidden = await request(app)
      .get(`/api/people/${valid.body.data.id}`)
      .set(await auth(second.id));
    expect(hidden.status).toBe(404);
  });
});

describe("webhook idempotency", () => {
  it("handles each update and message only once", async () => {
    const { app, telegram, repository } = setup();
    const update = {
      update_id: 10,
      message: {
        message_id: 20,
        text: "/start",
        chat: { id: 30 },
        from: { id: 40, first_name: "Аня" },
      },
    };
    const first = await request(app)
      .post(`/webhooks/telegram/${secret}`)
      .set("x-telegram-bot-api-secret-token", secret)
      .send(update);
    const second = await request(app)
      .post(`/webhooks/telegram/${secret}`)
      .set("x-telegram-bot-api-secret-token", secret)
      .send(update);
    expect(first.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]!.text).toMatch(/Привет! Я Илзи/);
    expect(repository.messages).toHaveLength(2);
    expect(repository.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});

describe("person resolver and memory flow", () => {
  it("resolves aliases, reports ambiguity, and deduplicates explicit memory", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 1, name: "A" })).id;
    const masha = await repository.createPerson(owner, { name: "Маша", aliases: ["мама"] });
    expect(await resolvePerson(repository, owner, "мама")).toMatchObject({
      status: "unique",
      person: { id: masha.id },
    });
    await repository.createPerson(owner, { name: "Ира", aliases: ["мама"] });
    expect((await resolvePerson(repository, owner, "мама")).status).toBe("ambiguous");
    const assistant = new AssistantOrchestrator(repository);
    const first = await assistant.handle(owner, "Запомни: Маша любит походы", randomUUID());
    const second = await assistant.handle(owner, "Запомни: Маша любит походы", randomUUID());
    expect(first.text).toMatch(/Запомнил/);
    expect(second.text).toMatch(/уже сохранён/);
    expect(await repository.listMemories(owner, masha.id)).toHaveLength(1);
  });

  it("creates a profile from the first explicit memory and understands a size fact", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 5, name: "A" })).id;
    const assistant = new AssistantOrchestrator(repository);

    expect((await assistant.handle(owner, "Запомни: Маша любит походы")).text).toMatch(
      /Создал профиль Маша/,
    );
    expect((await assistant.handle(owner, "У Маши размер кольца 16.5")).text).toMatch(/Запомнил/);

    const masha = (await repository.listPeople(owner)).find((person) => !person.is_self)!;
    expect(await repository.listMemories(owner, masha.id)).toEqual([
      expect.objectContaining({ category: "interest" }),
      expect.objectContaining({ category: "size", content: "размер кольца 16.5" }),
    ]);
  });
});

describe("recommendations, tasks and spaces", () => {
  it("passes only resolved person's memories and stores structured rationale", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 1, name: "A" })).id;
    const masha = await repository.createPerson(owner, { name: "Маша" });
    const ira = await repository.createPerson(owner, { name: "Ира" });
    await repository.createMemory(owner, masha.id, {
      content: "любит походы",
      category: "interest",
    });
    await repository.createMemory(owner, ira.id, { content: "любит театр", category: "interest" });
    let context: { content: string }[] = [];
    const ai: AiProvider = {
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
      async recommend(_q, _p, memories) {
        context = memories;
        return [1, 2, 3].map((n) => ({ title: `Идея ${n}`, rationale: "Потому что любит походы" }));
      },
    };
    await new AssistantOrchestrator(repository, ai).handle(owner, "Хочу удивить Машу");
    expect(context.map((m) => m.content)).toEqual(["любит походы"]);
    const saved = (await repository.listRecommendations(owner))[0]!;
    expect(saved.person_id).toBe(masha.id);
    expect(saved.items).toHaveLength(3);
    expect(saved.items[0]!.rationale).toBe("Потому что любит походы");
  });

  it("supports standalone tasks and spaces with owned participants", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 7, name: "A" });
    const headers = await auth(user.id);
    const person = (await request(app).post("/api/people").set(headers).send({ name: "Маша" })).body
      .data;
    const task = await request(app)
      .post("/api/tasks")
      .set(headers)
      .send({ title: "Выбрать подарок", person_id: person.id });
    expect(task.status).toBe(201);
    expect(task.body.data.space_id).toBeNull();
    const space = await request(app)
      .post("/api/spaces")
      .set(headers)
      .send({ name: "Мы", context: "Выходные", person_ids: [person.id] });
    expect(space.status).toBe(201);
    expect(space.body.data.person_ids).toEqual([person.id]);
    const patched = await request(app)
      .patch(`/api/tasks/${task.body.data.id}`)
      .set(headers)
      .send({ status: "done", space_id: space.body.data.id });
    expect(patched.body.data).toMatchObject({ status: "done", space_id: space.body.data.id });
    const detail = await request(app).get(`/api/spaces/${space.body.data.id}`).set(headers);
    expect(detail.body.data.people).toEqual([expect.objectContaining({ id: person.id })]);
    expect(detail.body.data.tasks).toEqual([expect.objectContaining({ id: task.body.data.id })]);
  });

  it("creates the next occurrence after completing a recurring task", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 71, name: "A" });
    const headers = await auth(user.id);
    const first = await request(app).post("/api/tasks").set(headers).send({
      title: "Weekly review",
      due_at: "2026-09-01T09:00:00.000Z",
      recurrence_frequency: "weekly",
    });

    expect(first.status).toBe(201);
    expect(first.body.data.recurrence_series_id).toBeTruthy();
    await request(app)
      .patch(`/api/tasks/${first.body.data.id}`)
      .set(headers)
      .send({ title: "One-off review", recurrence_scope: "instance" });
    await request(app)
      .patch(`/api/tasks/${first.body.data.id}`)
      .set(headers)
      .send({ status: "done" });

    const second = (await repository.listTasks(user.id)).find(
      (task) => task.due_at === "2026-09-08T09:00:00.000Z",
    );
    expect(second).toMatchObject({
      title: "Weekly review",
      status: "todo",
      recurrence_series_id: first.body.data.recurrence_series_id,
    });

    await request(app)
      .patch(`/api/tasks/${second!.id}`)
      .set(headers)
      .send({ title: "Team review", recurrence_scope: "series" });
    await request(app).patch(`/api/tasks/${second!.id}`).set(headers).send({ status: "done" });
    expect(await repository.listTasks(user.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Team review",
          status: "todo",
          due_at: "2026-09-15T09:00:00.000Z",
        }),
      ]),
    );
  });

  it("reuses a client-supplied task id so offline retries stay idempotent", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 8, name: "A" });
    const headers = await auth(user.id);
    const id = randomUUID();
    const first = await request(app)
      .post("/api/tasks")
      .set(headers)
      .send({ id, title: "Buy milk" });
    const second = await request(app)
      .post("/api/tasks")
      .set(headers)
      .send({ id, title: "Buy milk" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(
      (await repository.listTasks(user.id)).filter((task) => task.title === "Buy milk"),
    ).toHaveLength(1);
  });
});

describe("account deletion", () => {
  it("removes the user and all owned data", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 99, name: "Delete me" });
    await repository.createPerson(user.id, { name: "Маша" });
    const exported = await request(app)
      .get("/api/account/export")
      .set(await auth(user.id));
    expect(exported.status).toBe(200);
    expect(exported.body.data.people).toEqual([
      expect.objectContaining({ is_self: true, memories: [] }),
      expect.objectContaining({ name: "Маша", memories: [] }),
    ]);
    const response = await request(app)
      .delete("/api/account")
      .set(await auth(user.id));
    expect(response.status).toBe(204);
    expect(await repository.listPeople(user.id)).toEqual([]);
    expect(repository.users).toEqual([]);
  });
});

describe("telegram login and oauth registration", () => {
  const signedLogin = (
    user: { id: number; first_name: string; username?: string },
    authDate: number,
  ) => {
    const payload: Record<string, string | number> = {
      id: user.id,
      first_name: user.first_name,
      auth_date: authDate,
    };
    if (user.username) payload.username = user.username;
    const check = Object.entries(payload)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name}=${String(value)}`)
      .join("\n");
    const secret = createHash("sha256").update(botToken).digest();
    return { ...payload, hash: createHmac("sha256", secret).update(check).digest("hex") };
  };

  it("creates a session from the Telegram Login Widget", async () => {
    const { app } = setup();
    const response = await request(app)
      .post("/api/auth/telegram-login")
      .send(signedLogin({ id: 88, first_name: "Ira" }, Math.floor(Date.now() / 1000)));
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ telegram_id: 88, name: "Ira" });
    expect(response.body.data.token).toBeTruthy();
    expect(Date.parse(response.body.data.expires_at)).toBeGreaterThan(Date.now());
  });

  it("accepts a Login Widget payload whose photo_url is not in the HMAC", async () => {
    const { app } = setup();
    const signed = signedLogin({ id: 89, first_name: "Ira" }, Math.floor(Date.now() / 1000));
    const response = await request(app)
      .post("/api/auth/telegram-login")
      .send({ ...signed, photo_url: "https://cdn.telegram.org/user.jpg" });
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ telegram_id: 89, name: "Ira" });
  });

  it("exposes the Telegram bot id without authentication", async () => {
    const { app } = setup();
    const response = await request(app).get("/api/auth/telegram/config");
    expect(response.status).toBe(200);
    expect(response.body.data.bot_id).toBe("123456");
  });

  it("refreshes a session and restarts the expiry window", async () => {
    const { app } = setup();
    const created = await request(app)
      .post("/api/auth/telegram-login")
      .send(signedLogin({ id: 91, first_name: "Oleg" }, Math.floor(Date.now() / 1000)));
    const token = created.body.data.token as string;
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .set("Authorization", `Bearer ${token}`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.token).toBeTruthy();
    expect(Date.parse(refreshed.body.data.expires_at)).toBeGreaterThan(Date.now() + 60_000);
  });

  it("creates an account from Apple, Google or Yandex", async () => {
    const authUserId = "550e8400-e29b-41d4-a716-446655440000";
    const { repository } = setup();
    const supabaseAuth = {
      async getUser(token: string) {
        if (token !== "oauth-token") return { data: { user: null }, error: new Error("no") };
        return {
          data: {
            user: {
              id: authUserId,
              email: "anna@example.com",
              user_metadata: { full_name: "Anna Google" },
            },
          },
          error: null,
        };
      },
    };
    const oauthApp = createApp({
      repository,
      telegram: new FakeTelegram(),
      env,
      supabaseAuth,
    });
    const created = await request(oauthApp)
      .post("/api/auth/oauth/exchange")
      .send({ access_token: "oauth-token" });
    expect(created.status).toBe(200);
    expect(created.body.data.user).toMatchObject({
      auth_user_id: authUserId,
      email: "anna@example.com",
      name: "Anna Google",
      telegram_id: null,
    });
    const again = await request(oauthApp)
      .post("/api/auth/oauth/exchange")
      .send({ access_token: "oauth-token" });
    expect(again.body.data.user.id).toBe(created.body.data.user.id);
  });

  it("redirects website users to Google sign-in", async () => {
    const { repository } = setup();
    const app = createApp({
      repository,
      telegram: new FakeTelegram(),
      env: {
        ...env,
        GOOGLE_OAUTH_CLIENT_ID: "google-client.apps.googleusercontent.com",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://ealzy.ru/api/integrations/google/callback",
      },
    });
    const response = await request(app).get("/api/auth/oauth/google/start").redirects(0);
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("accounts.google.com");
    expect(response.headers.location).toContain("google-client.apps.googleusercontent.com");
  });

  it("links Telegram onto an existing OAuth account", async () => {
    const { app, repository } = setup();
    const oauth = await repository.upsertOAuthUser({
      auth_user_id: "550e8400-e29b-41d4-a716-446655440111",
      name: "Anna",
      email: "anna@example.com",
    });
    const linked = await request(app)
      .post("/api/auth/telegram/link")
      .set(await auth(oauth.id))
      .send(signedLogin({ id: 501, first_name: "Anna" }, Math.floor(Date.now() / 1000)));
    expect(linked.status).toBe(200);
    expect(linked.body.data.telegram_id).toBe(501);
  });

  it("opens a guest session with no Telegram or OAuth identity", async () => {
    const { app } = setup();
    const response = await request(app)
      .post("/api/auth/guest")
      .send({ timezone: "Europe/Moscow" });
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({
      telegram_id: null,
      auth_user_id: null,
      is_guest: true,
    });
    expect(response.body.data.token).toBeTruthy();
    expect(Date.parse(response.body.data.expires_at)).toBeGreaterThan(Date.now());
  });

  it("keeps a guest's data on the same account after linking Telegram", async () => {
    const { app, repository } = setup();
    const guestResponse = await request(app).post("/api/auth/guest").send({});
    const guestId = guestResponse.body.data.user.id as string;
    await repository.createGoal(guestId, { title: "Guest goal", priority: 3 });

    const linked = await request(app)
      .post("/api/auth/telegram/link")
      .set(await auth(guestId))
      .send(signedLogin({ id: 777, first_name: "Was Guest" }, Math.floor(Date.now() / 1000)));
    expect(linked.status).toBe(200);
    expect(linked.body.data.id).toBe(guestId);
    expect(linked.body.data.telegram_id).toBe(777);
    expect(linked.body.data.is_guest).toBe(false);

    const goals = await repository.listGoals(guestId);
    expect(goals).toHaveLength(1);
    expect(goals[0]?.title).toBe("Guest goal");
  });

  it("keeps telegram_id on the profile after saving notification settings", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 77, name: "Anna" });
    const saved = await request(app)
      .patch("/api/me")
      .set(await auth(user.id))
      .send({ morning_digest_enabled: true, morning_digest_time: "08:00" });
    expect(saved.status).toBe(200);
    expect(saved.body.data.telegram_id).toBe(77);
    expect(saved.body.data.morning_digest_enabled).toBe(true);
    expect(saved.body.data.reliability).toMatchObject({
      percent: 0,
      dated: 0,
      achievements: [],
    });
  });
});

describe("person locations", () => {
  it("stores optional city and address for self and people, isolated by owner", async () => {
    const { app, repository } = setup();
    const first = await repository.upsertTelegramUser({ telegram_id: 11, name: "A" });
    const second = await repository.upsertTelegramUser({ telegram_id: 12, name: "B" });
    const headers = await auth(first.id);
    const selfLocation = await request(app)
      .post("/api/me/locations")
      .set(headers)
      .send({ city: "Казань", address: "ул. Баумана 12", label: "дом" });
    expect(selfLocation.status).toBe(201);
    expect(selfLocation.body.data).toMatchObject({
      city: "Казань",
      address: "ул. Баумана 12",
      label: "дом",
      is_primary: true,
    });
    const me = await request(app).get("/api/me").set(headers);
    expect(me.body.data.locations).toEqual([
      expect.objectContaining({ city: "Казань", is_primary: true }),
    ]);
    const person = await request(app).post("/api/people").set(headers).send({ name: "Маша" });
    const personLocation = await request(app)
      .post(`/api/people/${person.body.data.id}/locations`)
      .set(headers)
      .send({ city: "Сочи", address: "" });
    expect(personLocation.status).toBe(201);
    expect(personLocation.body.data).toMatchObject({
      city: "Сочи",
      address: null,
      is_primary: true,
    });
    const hidden = await request(app)
      .get(`/api/people/${person.body.data.id}/locations`)
      .set(await auth(second.id));
    expect(hidden.status).toBe(404);
    const work = await request(app)
      .post("/api/me/locations")
      .set(headers)
      .send({ city: "Москва", label: "работа", is_primary: true });
    expect(work.status).toBe(201);
    const listed = await request(app).get("/api/me/locations").set(headers);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ city: "Москва", is_primary: true }),
      expect.objectContaining({ city: "Казань", is_primary: false }),
    ]);
  });
});

describe("profile payload", () => {
  it("reads the whole-community achievement cohort once, not on every /api/me", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 15, name: "A" });
    const headers = await auth(user.id);
    let scans = 0;
    const original = repository.listReliabilityCohort.bind(repository);
    repository.listReliabilityCohort = async () => {
      scans += 1;
      return original();
    };
    const first = await request(app).get("/api/me").set(headers);
    const second = await request(app).get("/api/me").set(headers);
    expect(first.status).toBe(200);
    expect(second.body.data.reliability.community).toEqual(first.body.data.reliability.community);
    expect(first.body.data.reliability.community.users).toBe(1);
    expect(scans).toBe(1);
  });
});

describe("person dates", () => {
  it("stores birthday and shared dates for self and people", async () => {
    const { app, repository } = setup();
    const first = await repository.upsertTelegramUser({ telegram_id: 13, name: "A" });
    const second = await repository.upsertTelegramUser({ telegram_id: 14, name: "B" });
    const headers = await auth(first.id);
    const selfBirthday = await request(app)
      .post("/api/me/dates")
      .set(headers)
      .send({ kind: "birthday", month: 1, day: 15, year: 1990 });
    expect(selfBirthday.status).toBe(201);
    expect(selfBirthday.body.data).toMatchObject({
      kind: "birthday",
      month: 1,
      day: 15,
      year: 1990,
    });
    const me = await request(app).get("/api/me").set(headers);
    expect(me.body.data.dates).toEqual([
      expect.objectContaining({ kind: "birthday", month: 1, day: 15 }),
    ]);
    const person = await request(app).post("/api/people").set(headers).send({ name: "Маша" });
    const birthday = await request(app)
      .post(`/api/people/${person.body.data.id}/dates`)
      .set(headers)
      .send({ kind: "birthday", month: 3, day: 29, year: 1994 });
    expect(birthday.status).toBe(201);
    const met = await request(app)
      .post(`/api/people/${person.body.data.id}/dates`)
      .set(headers)
      .send({ kind: "met", month: 6, day: 12, year: 2020 });
    expect(met.status).toBe(201);
    const updatedBirthday = await request(app)
      .post(`/api/people/${person.body.data.id}/dates`)
      .set(headers)
      .send({ kind: "birthday", month: 3, day: 30, year: 1994 });
    expect(updatedBirthday.status).toBe(201);
    expect(updatedBirthday.body.data.id).toBe(birthday.body.data.id);
    expect(updatedBirthday.body.data.day).toBe(30);
    const listed = await request(app)
      .get(`/api/people/${person.body.data.id}/dates`)
      .set(headers);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ kind: "birthday", day: 30 }),
      expect.objectContaining({ kind: "met", month: 6, day: 12 }),
    ]);
    const hidden = await request(app)
      .get(`/api/people/${person.body.data.id}/dates`)
      .set(await auth(second.id));
    expect(hidden.status).toBe(404);
    const other = await request(app)
      .post(`/api/people/${person.body.data.id}/dates`)
      .set(headers)
      .send({ kind: "other", month: 2, day: 14 });
    expect(other.status).toBe(400);
  });
});
