import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import { parseTaskText } from "../src/modules/import/text.js";
import { itemsFromTodoist, markDuplicates } from "../src/modules/import/service.js";
import { profileCompleteness } from "../src/modules/import/completeness.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { TodoistGateway } from "../src/modules/import/todoist.js";

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
  TODOIST_CLIENT_ID: "todoist-client",
  TODOIST_CLIENT_SECRET: "todoist-secret",
};

class FakeTelegram implements TelegramGateway {
  async sendMessage() {
    return Promise.resolve();
  }
  async answerCallbackQuery() {
    return Promise.resolve();
  }
}

const fakeTodoist: TodoistGateway = {
  async exchangeCode() {
    return "todoist-access";
  },
  async listProjects() {
    return [
      { id: "inbox", name: "Inbox", is_inbox_project: true },
      { id: "work", name: "Работа" },
    ];
  },
  async listTasks() {
    return [
      {
        id: "t1",
        content: "Дописать оффер",
        project_id: "work",
        due: { date: "2026-09-15" },
        priority: 4,
      },
      { id: "t2", content: "Купить молоко", project_id: "inbox" },
    ];
  },
};

describe("text task import parser", () => {
  it("parses twenty lines with dates and priorities", () => {
    const lines = [
      "Купить молоко",
      "Позвонить маме завтра",
      "Отчёт 15.09",
      "Презентация 2026-09-20 !1",
      "Счёт p2",
      ...Array.from({ length: 15 }, (_, i) => `Дело ${i + 1}`),
    ];
    const parsed = parseTaskText(lines.join("\n"), new Date("2026-09-04T12:00:00.000Z"), "UTC");
    expect(parsed).toHaveLength(20);
    expect(parsed[1]).toMatchObject({
      title: "Позвонить маме",
      due_at: "2026-09-05T12:00:00.000Z",
    });
    expect(parsed[2]?.due_at).toBe("2026-09-15T12:00:00.000Z");
    expect(parsed[3]).toMatchObject({ title: "Презентация", importance: 5 });
    expect(parsed[4]?.importance).toBe(4);
  });
});

describe("todoist mapping", () => {
  it("skips inbox projects and maps priority plus due date", () => {
    const items = itemsFromTodoist(
      [
        { id: "inbox", name: "Inbox", is_inbox_project: true },
        { id: "work", name: "Работа" },
      ],
      [
        {
          id: "t1",
          content: "Дописать оффер",
          project_id: "work",
          due: { date: "2026-09-15" },
          priority: 4,
        },
        { id: "t2", content: "Купить молоко", project_id: "inbox" },
      ],
    );
    expect(items.filter((item) => item.kind === "project").map((item) => item.title)).toEqual([
      "Работа",
    ]);
    const offer = items.find((item) => item.title === "Дописать оффер");
    expect(offer).toMatchObject({
      project_title: "Работа",
      due_at: "2026-09-15T12:00:00.000Z",
      importance: 5,
    });
    expect(items.find((item) => item.title === "Купить молоко")?.project_title).toBeNull();
  });

  it("marks title+due duplicates", () => {
    const items = markDuplicates(
      [
        {
          id: "1",
          kind: "task",
          title: "Купить молоко",
          due_at: null,
          importance: null,
          project_title: null,
          source_id: "x",
          duplicate: false,
        },
      ],
      [{ title: "купить молоко", due_at: null } as never],
      new Set(),
    );
    expect(items[0]?.duplicate).toBe(true);
  });
});

describe("profile completeness", () => {
  it("scores weighted items and stays clickable", () => {
    const report = profileCompleteness({
      telegramLinked: false,
      hasPortrait: false,
      timezone: "Europe/Moscow",
      hasGoals: true,
      hasDigests: false,
    });
    expect(report.percent).toBe(40);
    expect(report.items.find((item) => item.id === "goals")?.href).toBe("/goals");
    expect(report.items.find((item) => item.id === "telegram")?.href).toBe("/profile#loop");
    expect(report.items.map((item) => item.id)).not.toContain("mail");
    expect(report.items.map((item) => item.id)).not.toContain("people");
    expect(report.items.map((item) => item.id)).not.toContain("bio");
    expect(report.items.map((item) => item.id)).not.toContain("locations");
  });
});

describe("import HTTP", () => {
  it("previews text, confirms tasks, and skips duplicates", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram: new FakeTelegram(), env, todoist: fakeTodoist });
    const user = await repository.upsertTelegramUser({ telegram_id: 88, name: "A" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    await repository.updateProfile(user.id, { timezone: "UTC" });
    const preview = await request(app).post("/api/import/text/preview").set(auth).send({
      text: "Купить молоко\nПозвонить маме завтра\n",
    });
    expect(preview.status).toBe(201);
    expect(preview.body.data.items).toHaveLength(2);
    expect(preview.body.data.access_token).toBeUndefined();
    const confirmed = await request(app)
      .post(`/api/import/${preview.body.data.id}/confirm`)
      .set(auth)
      .send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.log.created_tasks).toBe(2);
    expect((await repository.listTasks(user.id)).map((task) => task.title)).toEqual([
      "Купить молоко",
      "Позвонить маме",
    ]);
    const again = await request(app)
      .post("/api/import/text/preview")
      .set(auth)
      .send({ text: "Купить молоко" });
    expect(again.body.data.items[0].duplicate).toBe(true);
    const skipped = await request(app)
      .post(`/api/import/${again.body.data.id}/confirm`)
      .set(auth)
      .send({});
    expect(skipped.body.data.log.skipped_duplicates).toBe(1);
    expect(await repository.listTasks(user.id)).toHaveLength(2);
  });

  it("imports Todoist projects and tasks through a token preview", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram: new FakeTelegram(), env, todoist: fakeTodoist });
    const user = await repository.upsertTelegramUser({ telegram_id: 89, name: "A" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    const preview = await request(app)
      .post("/api/import/todoist/preview")
      .set(auth)
      .send({ token: "todoist-personal-token" });
    expect(preview.status).toBe(201);
    const confirmed = await request(app)
      .post(`/api/import/${preview.body.data.id}/confirm`)
      .set(auth)
      .send({});
    expect(confirmed.body.data.log.created_projects).toBe(1);
    expect(confirmed.body.data.log.created_tasks).toBe(2);
    const projects = await repository.listProjects(user.id);
    expect(projects.map((item) => item.name)).toContain("Работа");
    const tasks = await repository.listTasks(user.id);
    expect(tasks.find((task) => task.title === "Дописать оффер")?.project_id).toBe(projects[0]?.id);
  });

  it("returns a Todoist OAuth url when configured", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram: new FakeTelegram(), env, todoist: fakeTodoist });
    const user = await repository.upsertTelegramUser({ telegram_id: 90, name: "A" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    const status = await request(app).get("/api/import/todoist/status").set(auth);
    expect(status.body.data.oauth).toBe(true);
    const start = await request(app).get("/api/import/todoist/start").set(auth);
    expect(start.body.data.url).toMatch(/todoist\.com\/oauth\/authorize/);
    expect(start.body.data.url).toMatch(/client_id=todoist-client/);
  });
});
