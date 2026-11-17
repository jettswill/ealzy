import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import { compactCalendar } from "../src/modules/assistant/companion-workspace.js";
import {
  calendarLine,
  ScheduledMessageService,
} from "../src/modules/assistant/scheduled-messages.js";
import { pushPreview, type PushGateway } from "../src/infrastructure/apns.js";
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
const telegram: TelegramGateway = {
  async sendMessage() {},
  async answerCallbackQuery() {},
};

describe("phone calendar sync", () => {
  it("replaces the window and shows events to Ilzi in local time", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 9, name: "A" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    const window = { source: "ios", from: "2026-11-17T00:00:00+03:00", to: "2026-11-24T00:00:00+03:00" };
    const first = await request(app)
      .put("/api/calendar/events")
      .set(auth)
      .send({
        ...window,
        events: [
          {
            external_id: "box",
            title: "Бокс",
            starts_at: "2026-11-17T09:00:00+03:00",
            ends_at: "2026-11-17T10:30:00+03:00",
            location: "Зал на Тверской",
          },
          {
            external_id: "old",
            title: "Отменённая встреча",
            starts_at: "2026-11-18T14:00:00+03:00",
            ends_at: "2026-11-18T15:00:00+03:00",
          },
        ],
      });
    expect(first.status).toBe(200);
    expect(first.body.data.stored).toBe(2);

    // Встречу удалили на телефоне — новая отправка окна её убирает.
    await request(app)
      .put("/api/calendar/events")
      .set(auth)
      .send({
        ...window,
        events: [
          {
            external_id: "box",
            title: "Бокс",
            starts_at: "2026-11-17T09:00:00+03:00",
            ends_at: "2026-11-17T10:30:00+03:00",
            location: "Зал на Тверской",
          },
        ],
      });
    const stored = await repository.listCalendarEvents(
      user.id,
      "2026-11-16T00:00:00.000Z",
      "2026-11-25T00:00:00.000Z",
    );
    expect(stored.map((e) => e.title)).toEqual(["Бокс"]);
    expect(compactCalendar(stored, "Europe/Moscow")).toEqual([
      {
        title: "Бокс",
        date: "2026-11-17",
        start: "09:00",
        end: "10:30",
        all_day: false,
        location: "Зал на Тверской",
      },
    ]);
  });

  it("rejects a window that is too wide", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 10, name: "A" });
    const response = await request(app)
      .put("/api/calendar/events")
      .set({ Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` })
      .send({ source: "ios", from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z", events: [] });
    expect(response.status).toBe(400);
  });
});

describe("push to the iOS app", () => {
  it("makes a short plain preview", () => {
    expect(pushPreview("**Фокус:** смета\n\nВ перерывах: оплатить интернет")).toBe(
      "Фокус: смета В перерывах: оплатить интернет",
    );
    expect(pushPreview("a".repeat(300)).length).toBe(180);
  });

  it("sends the morning digest as a push too", async () => {
    const repository = new InMemoryRepository();
    const pushes: { ownerId: string; title: string }[] = [];
    const push: PushGateway = {
      async notifyOwner(ownerId, message) {
        pushes.push({ ownerId, title: message.title });
        return 1;
      },
    };
    const user = await repository.upsertTelegramUser({ telegram_id: 501, name: "A" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: true,
      morning_digest_time: "08:00",
    });
    const service = new ScheduledMessageService(repository, telegram, undefined, push);
    const result = await service.run(new Date("2026-08-24T08:05:00.000Z"));
    expect(result.sent.morning_digest).toBe(1);
    expect(pushes).toEqual([{ ownerId: user.id, title: "План на сегодня" }]);
  });
});

describe("morning plan follows the phone calendar", () => {
  it("waits for the boxing session to end and mentions the calendar", async () => {
    const repository = new InMemoryRepository();
    const sent: string[] = [];
    const tg: TelegramGateway = {
      async sendMessage(_chatId, text) {
        sent.push(text);
      },
      async answerCallbackQuery() {},
    };
    const user = await repository.upsertTelegramUser({ telegram_id: 777, name: "A" });
    await repository.updateProfile(user.id, {
      timezone: "Europe/Moscow",
      morning_digest_enabled: true,
      morning_digest_time: "08:30",
    });
    await repository.createTask(user.id, { title: "Дописать смету", due_at: "2026-11-17T09:00:00.000Z" });
    await repository.replaceCalendarEvents(user.id, {
      source: "ios",
      from: "2026-11-16T21:00:00.000Z",
      to: "2026-11-24T21:00:00.000Z",
      events: [
        {
          external_id: "box",
          title: "Бокс",
          starts_at: "2026-11-17T06:00:00.000Z", // 09:00 МСК
          ends_at: "2026-11-17T07:30:00.000Z", // 10:30 МСК
          all_day: false,
          location: null,
          calendar_title: null,
        },
      ],
    });
    const service = new ScheduledMessageService(repository, tg);
    // 08:35 МСК — до тренировки меньше получаса: ждём.
    expect((await service.run(new Date("2026-11-17T05:35:00.000Z"))).sent.morning_digest).toBe(0);
    // 09:40 — тренировка идёт, обычное окно (до 10:00) ещё открыто, но молчим.
    expect((await service.run(new Date("2026-11-17T06:40:00.000Z"))).sent.morning_digest).toBe(0);
    // 10:45 — после тренировки, обычное окно уже закрылось, но план приходит.
    expect((await service.run(new Date("2026-11-17T07:45:00.000Z"))).sent.morning_digest).toBe(1);
    expect(sent.at(-1)).toContain("В календаре: 09:00 Бокс");
  });

  it("formats at most three events", () => {
    const events = ["А", "Б", "В", "Г"].map((title, i) => ({ title, start: `1${i}:00`, all_day: false }));
    expect(calendarLine(events, true)).toBe("В календаре: 10:00 А, 11:00 Б, 12:00 В и ещё 1");
    expect(calendarLine([], true)).toBeNull();
  });
});
