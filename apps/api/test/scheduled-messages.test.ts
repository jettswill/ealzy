import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  fallbackDigest,
  goalCheckInDue,
  notificationDue,
  ScheduledMessageService,
  weeklyReflectionDue,
} from "../src/modules/assistant/scheduled-messages.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { Task, UserProfile } from "../src/types.js";

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
  sent: { chatId: number; text: string; options?: Record<string, unknown> }[] = [];
  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
    this.sent.push({ chatId, text, options });
  }
  async answerCallbackQuery() {
    return Promise.resolve();
  }
}

const baseProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  owner_id: "00000000-0000-4000-8000-000000000001",
  self_person_id: "00000000-0000-4000-8000-000000000002",
  bio: null,
  values: [],
  communication_style: null,
  timezone: "UTC",
  locale: "ru",
  context_summary: null,
  weekly_reflection_enabled: false,
  morning_digest_enabled: true,
  morning_digest_time: "08:00",
  weekly_digest_enabled: true,
  weekly_digest_time: "09:00",
  evening_sync_enabled: true,
  evening_sync_time: "21:00",
  last_morning_digest_on: null,
  last_weekly_digest_on: null,
  last_evening_sync_on: null,
  last_goal_checkin_on: null,
  onboarding_completed_at: null,
  last_active_at: null,
  last_reengagement_at: null,
  reengagement_enabled: true,
  updated_at: "2026-08-24T00:00:00.000Z",
  ...overrides,
});

describe("scheduled notification timing", () => {
  it("fires inside the local window and not twice the same local day", () => {
    const profile = baseProfile();
    const mondayMorning = new Date("2026-08-24T08:05:00.000Z");
    expect(notificationDue(profile, "morning_digest", mondayMorning)).toBe(true);
    expect(notificationDue(profile, "weekly_digest", mondayMorning)).toBe(false);
    expect(notificationDue(profile, "evening_sync", mondayMorning)).toBe(false);

    const mondayWeekly = new Date("2026-08-24T09:05:00.000Z");
    expect(notificationDue(profile, "weekly_digest", mondayWeekly)).toBe(true);
    expect(
      notificationDue(
        baseProfile({ last_weekly_digest_on: "2026-08-24" }),
        "weekly_digest",
        mondayWeekly,
      ),
    ).toBe(false);

    const tuesdayWeekly = new Date("2026-08-25T09:05:00.000Z");
    expect(notificationDue(profile, "weekly_digest", tuesdayWeekly)).toBe(false);

    const evening = new Date("2026-08-24T21:05:00.000Z");
    expect(notificationDue(profile, "evening_sync", evening)).toBe(true);
    expect(notificationDue(profile, "morning_digest", evening)).toBe(false);
  });

  it("respects the user timezone", () => {
    const profile = baseProfile({ timezone: "Europe/Moscow" });
    expect(notificationDue(profile, "morning_digest", new Date("2026-08-24T05:05:00.000Z"))).toBe(
      true,
    );
    expect(notificationDue(profile, "morning_digest", new Date("2026-08-24T08:05:00.000Z"))).toBe(
      false,
    );
  });

  it("schedules a goal check-in even when every digest is off", () => {
    const profile = baseProfile({
      morning_digest_enabled: false,
      weekly_digest_enabled: false,
      evening_sync_enabled: false,
    });
    expect(goalCheckInDue(profile, new Date("2026-08-24T08:05:00.000Z"))).toBe(true);
    expect(
      goalCheckInDue(
        { ...profile, last_goal_checkin_on: "2026-08-24" },
        new Date("2026-08-24T08:05:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("digest copy", () => {
  const task = (title: string, due_at: string | null): Task => ({
    id: title,
    owner_id: "o",
    space_id: null,
    person_id: null,
    goal_id: null,
    project_id: null,
    due_at,
    completed_at: null,
    title,
    description: null,
    status: "todo",
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
  });

  it("lists today's work and asks an evening reflection question", () => {
    const morning = fallbackDigest("morning_digest", baseProfile(), {
      today: [task("Call Masha", "2026-08-24T12:00:00.000Z")],
      overdue: [task("Pay rent", "2026-08-20T12:00:00.000Z")],
      week: [],
      tomorrow: [],
      undated: [],
    });
    expect(morning).toMatch(/Утро спокойное: 2 дела, 1 просрочено/);
    expect(morning).toMatch(/Главное сегодня: \*\*Pay rent\*\* — просрочено/);
    expect(morning).toMatch(/Ещё в фокусе:/);
    expect(morning).toMatch(/• Call Masha/);

    const push = fallbackDigest("morning_digest", baseProfile(), {
      today: [],
      overdue: [],
      week: [],
      tomorrow: [],
      undated: [],
      push: [{ ...task("Ship the deck", null), importance: 5, urgency: 5 }],
    });
    expect(push).toMatch(/Не откладывать/);
    expect(push).toMatch(/Ship the deck/);

    const withAi = fallbackDigest("morning_digest", baseProfile(), {
      today: [
        {
          ...task("Find flights", "2026-08-24T12:00:00.000Z"),
          assignee: "ealzy",
        },
      ],
      overdue: [],
      week: [],
      tomorrow: [],
      undated: [],
    });
    expect(withAi).toMatch(/\[ИИ\] \*\*Find flights\*\*/);

    const evening = fallbackDigest("evening_sync", baseProfile(), {
      today: [],
      overdue: [],
      week: [],
      tomorrow: [task("Pack", "2026-08-25T12:00:00.000Z")],
      undated: [],
      leftover: [task("Buy flowers", "2026-08-24T12:00:00.000Z")],
      upcoming: [
        {
          person: "Маша",
          label: "День рождения 1 сентября",
          date: "2026-09-01",
          days_until: 8,
          kind: "birthday",
        },
      ],
    });
    expect(evening).toMatch(/Вечерний синк/);
    expect(evening).toMatch(/Pack/);
    expect(evening).toMatch(/Buy flowers/);
    expect(evening).toMatch(/Маша/);
    expect(evening).toMatch(/Как вы сейчас/);

    const morningDates = fallbackDigest("morning_digest", baseProfile(), {
      today: [],
      overdue: [],
      week: [],
      tomorrow: [],
      undated: [],
      upcoming: [
        {
          person: "Маша",
          label: "День рождения 1 сентября",
          date: "2026-09-01",
          days_until: 8,
          kind: "birthday",
        },
      ],
    });
    expect(morningDates).toMatch(/Про близких/);
    expect(morningDates).toMatch(/Маша/);
    expect(morningDates).toMatch(/подарок/);
  });

  it("keeps the morning brief to one focus, the night's mail and one personal moment", () => {
    const brief = fallbackDigest("morning_digest", baseProfile(), {
      today: [
        task("Отправить смету", "2026-08-24T12:00:00.000Z"),
        task("Созвон с подрядчиком", "2026-08-24T12:00:00.000Z"),
        task("Ревью оффера", "2026-08-24T12:00:00.000Z"),
        task("Забрать заказ", "2026-08-24T12:00:00.000Z"),
        task("Обновить лендинг", "2026-08-24T12:00:00.000Z"),
      ],
      overdue: [],
      week: [],
      tomorrow: [],
      undated: [],
      weekday: "Tue",
      mail: [
        { from: "boss@example.com", subject: "Смета по проекту", is_meeting: false },
        { from: "calendar@example.com", subject: "Синк в четверг 15:00", is_meeting: true },
      ],
      upcoming: [
        {
          person: "Маша",
          label: "День рождения 1 сентября",
          date: "2026-09-01",
          days_until: 8,
          kind: "birthday",
        },
      ],
    });
    expect(brief.startsWith("Вторник. ")).toBe(true);
    expect(brief).toMatch(/Главное сегодня: \*\*Отправить смету\*\*/);
    expect(brief).toMatch(/За ночь: 2 письма по делу/);
    expect(brief).toMatch(/• встреча — Синк в четверг 15:00/);
    expect(brief).toMatch(/Про близких: Маша/);
    expect(brief).toMatch(/Ещё 4 дела в работе/);
    expect(brief.split("\n").filter(Boolean).length).toBeLessThanOrEqual(8);
    expect(brief).not.toMatch(/Как идут цели/);
  });

  it("asks for a next step instead of an empty count", () => {
    const goal = {
      id: "g1",
      owner_id: "o",
      title: "Запустить лендинг",
      description: null,
      status: "active" as const,
      horizon: "short" as const,
      priority: 3,
      target_date: null,
      current_plan: null,
      plan_revised_at: null,
      source_note_id: null,
      created_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
    };
    const morning = fallbackDigest("morning_digest", baseProfile(), {
      today: [],
      overdue: [],
      week: [],
      tomorrow: [],
      undated: [],
      goals: [goal],
    });
    expect(morning).toMatch(/Запустить лендинг/);
    expect(morning).toMatch(/план на сегодня|скинь 3 дела/i);
    expect(morning).not.toMatch(/дел с датой нет/);

    const evening = fallbackDigest("evening_sync", baseProfile(), {
      today: [],
      overdue: [],
      week: [],
      tomorrow: [],
      undated: [],
      leftover: [],
    });
    expect(evening).toMatch(/Скинь 3 дела/);
    expect(evening).not.toMatch(/дел с датой нет/);
  });
});

describe("scheduled message delivery", () => {
  it("saves notification settings and sends each Telegram digest once", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 77, name: "Anna" });
    const saved = await request(app)
      .patch("/api/me")
      .set({ Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` })
      .send({
        timezone: "UTC",
        morning_digest_enabled: true,
        morning_digest_time: "08:00",
        weekly_digest_enabled: true,
        weekly_digest_time: "09:00",
        evening_sync_enabled: true,
        evening_sync_time: "21:00",
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.morning_digest_enabled).toBe(true);

    await repository.createTask(user.id, {
      title: "Buy flowers",
      due_at: "2026-08-24T12:00:00.000Z",
    });
    await repository.createTask(user.id, {
      title: "Find flights",
      due_at: "2026-08-24T18:00:00.000Z",
      assignee: "ealzy",
    });
    const person = await repository.createPerson(user.id, { name: "Маша" });
    await repository.createMemory(user.id, person.id, {
      content: "День рождения 1 сентября",
      category: "important_date",
      occurred_at: "1994-09-01T00:00:00.000Z",
    });
    expect((await request(app).post("/internal/scheduled-messages")).status).toBe(401);

    const service = new ScheduledMessageService(repository, telegram);
    expect((await service.run(new Date("2026-08-24T08:05:00.000Z"))).sent.morning_digest).toBe(1);
    expect((await service.run(new Date("2026-08-24T08:10:00.000Z"))).sent.morning_digest).toBe(0);
    expect((await service.run(new Date("2026-08-24T09:05:00.000Z"))).sent.weekly_digest).toBe(1);
    expect((await service.run(new Date("2026-08-24T21:05:00.000Z"))).sent.evening_sync).toBe(1);
    expect(telegram.sent).toHaveLength(4);
    expect(repository.betaMetrics.filter((event) => event.name === "digest_sent")).toHaveLength(3);
    expect(telegram.sent.some((item) => /целей пока нет|свериться/i.test(item.text))).toBe(true);
    expect(telegram.sent[0]?.text).toMatch(/Buy flowers/);
    expect(telegram.sent[0]?.text).toMatch(/Маша/);
    expect(telegram.sent.at(-1)?.text).toMatch(/Buy flowers/);
    expect(telegram.sent.at(-1)?.text).not.toMatch(/Find flights/);
    expect(telegram.sent.at(-1)?.text).toMatch(/Маша/);
    expect(telegram.sent.at(-1)?.text).toMatch(/выберите задачу/);
    const keyboard = (
      telegram.sent.at(-1)?.options as
        | { reply_markup?: { inline_keyboard?: { text: string; callback_data: string }[][] } }
        | undefined
    )?.reply_markup?.inline_keyboard;
    expect(keyboard?.some((row) => row.some((button) => button.text === "Buy flowers"))).toBe(true);
    expect(keyboard?.every((row) => row.length === 1)).toBe(true);
    expect(keyboard?.every((row) => row.every((button) => button.callback_data.length <= 64))).toBe(
      true,
    );
    expect(await repository.findActivePendingAction(user.id, 77, "day_close")).toBeTruthy();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-24T21:10:00.000Z"));
    const triggered = await request(app)
      .post("/internal/scheduled-messages")
      .set("x-cron-secret", env.CRON_SECRET);
    vi.useRealTimers();
    expect(triggered.status).toBe(200);
    expect(triggered.body.data.sent.morning_digest).toBe(0);
  });

  it("invites a global goals and plan sync on the weekly window", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 78, name: "Anna" });
    await request(app)
      .patch("/api/me")
      .set({ Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` })
      .send({
        timezone: "UTC",
        weekly_digest_enabled: true,
        weekly_digest_time: "09:00",
        evening_sync_enabled: false,
        morning_digest_enabled: false,
      });
    await repository.createGoal(user.id, { title: "Learn French", horizon: "long" });
    const service = new ScheduledMessageService(repository, telegram);
    expect((await service.run(new Date("2026-08-24T09:05:00.000Z"))).sent.weekly_digest).toBe(1);
    const ping = telegram.sent.find((item) => /свериться/i.test(item.text));
    expect(ping?.text).toMatch(/Learn French/);
    const keyboard = (
      ping?.options as
        | { reply_markup?: { inline_keyboard?: { text: string; callback_data: string }[][] } }
        | undefined
    )?.reply_markup?.inline_keyboard;
    expect(keyboard?.[0]?.some((button) => button.text === "Давай")).toBe(true);
    expect(keyboard?.[0]?.every((button) => button.callback_data.length <= 64)).toBe(true);
    expect(await repository.findActivePendingAction(user.id, 78, "goal_checkin")).toBeTruthy();
    expect((await repository.getProfile(user.id))?.last_goal_checkin_on).toBe("2026-08-24");
    expect((await service.run(new Date("2026-08-24T21:05:00.000Z"))).sent.evening_sync).toBe(0);
    expect(telegram.sent.filter((item) => /свериться/i.test(item.text))).toHaveLength(1);
  });

  it("invites a first goals conversation even when none exist yet", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const user = await repository.upsertTelegramUser({ telegram_id: 79, name: "Anna" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: true,
      morning_digest_time: "08:00",
    });
    const service = new ScheduledMessageService(repository, telegram);
    await service.run(new Date("2026-08-24T08:05:00.000Z"));
    const ping = telegram.sent.find((item) => /целей пока нет/i.test(item.text));
    expect(ping?.text).toMatch(/первый план/i);
    expect(await repository.findActivePendingAction(user.id, 79, "goal_checkin")).toBeTruthy();
  });

  it("sends a goal check-in when every digest toggle is off", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const user = await repository.upsertTelegramUser({ telegram_id: 80, name: "Anna" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: false,
      weekly_digest_enabled: false,
      evening_sync_enabled: false,
    });
    const service = new ScheduledMessageService(repository, telegram);
    await service.run(new Date("2026-08-24T08:05:00.000Z"));
    expect(telegram.sent.some((item) => /цел/i.test(item.text))).toBe(true);
    expect(await repository.findActivePendingAction(user.id, 80, "goal_checkin")).toBeTruthy();
  });

  it("sends a Monday evening weekly reflection without a Profile tap", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const user = await repository.upsertTelegramUser({ telegram_id: 81, name: "Anna" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: false,
      weekly_digest_enabled: false,
      evening_sync_enabled: false,
      weekly_reflection_enabled: true,
      last_goal_checkin_on: "2026-08-24",
    });
    await repository.createGoal(user.id, { title: "Learn French" });
    expect(
      weeklyReflectionDue(
        (await repository.getProfile(user.id))!,
        new Date("2026-08-24T21:05:00.000Z"),
      ),
    ).toBe(true);
    const service = new ScheduledMessageService(repository, telegram);
    await service.run(new Date("2026-08-24T21:05:00.000Z"));
    expect(telegram.sent.some((item) => /Обзор недели/i.test(item.text))).toBe(true);
    expect(await repository.listReflections(user.id)).toHaveLength(1);
    telegram.sent = [];
    await service.run(new Date("2026-08-24T21:20:00.000Z"));
    expect(telegram.sent).toHaveLength(0);
    expect(await repository.listReflections(user.id)).toHaveLength(1);
  });

  it("starts a tomorrow dump when evening is empty", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const user = await repository.upsertTelegramUser({ telegram_id: 82, name: "Anna" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: false,
      weekly_digest_enabled: false,
      evening_sync_enabled: true,
      weekly_reflection_enabled: false,
      last_goal_checkin_on: "2026-08-25",
    });
    const service = new ScheduledMessageService(repository, telegram);
    await service.run(new Date("2026-08-25T21:05:00.000Z"));
    expect(telegram.sent[0]?.text).toMatch(/Скинь 3 дела/);
    expect(await repository.findActivePendingAction(user.id, 82, "first_brain_dump")).toBeTruthy();
    expect(
      (await repository.findActivePendingAction(user.id, 82, "first_brain_dump"))?.payload,
    ).toMatchObject({ due: "tomorrow" });
  });

  it("suggests an undated task in the morning without dating it", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const user = await repository.upsertTelegramUser({ telegram_id: 83, name: "Anna" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: true,
      weekly_digest_enabled: false,
      evening_sync_enabled: false,
      last_goal_checkin_on: "2026-08-25",
    });
    await repository.createTask(user.id, {
      title: "Дописать оффер",
      importance: 4,
      urgency: 3,
    });
    const service = new ScheduledMessageService(repository, telegram);
    await service.run(new Date("2026-08-25T08:05:00.000Z"));
    expect((await repository.listTasks(user.id))[0]?.due_at).toBeNull();
    expect(telegram.sent[0]?.text).toMatch(/Дописать оффер/);
    expect(telegram.sent[0]?.text).toMatch(/можно взять/i);
    expect(telegram.sent[0]?.text).not.toMatch(/Поставила на сегодня/);
    expect(await repository.findActivePendingAction(user.id, 83, "first_brain_dump")).toBeNull();
  });

  it("starts a today dump when morning has nothing dated", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const user = await repository.upsertTelegramUser({ telegram_id: 84, name: "Anna" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: true,
      weekly_digest_enabled: false,
      evening_sync_enabled: false,
      last_goal_checkin_on: "2026-08-25",
    });
    await repository.createGoal(user.id, { title: "Запустить лендинг" });
    const service = new ScheduledMessageService(repository, telegram);
    await service.run(new Date("2026-08-25T08:05:00.000Z"));
    expect(telegram.sent[0]?.text).toMatch(/скинь 3 дела/i);
    expect(await repository.findActivePendingAction(user.id, 84, "first_brain_dump")).toBeTruthy();
    expect(
      (await repository.findActivePendingAction(user.id, 84, "first_brain_dump"))?.payload,
    ).toMatchObject({ due: "today" });
  });

  it("still writes the digest to conversation history for a web user without Telegram", async () => {
    // P0-1 from the 22.09 audit: every delivery branch used to bail out on
    // `!user.telegram_id`, so a person signed in via OAuth never got a single
    // proactive message — not even in their own chat history. The Telegram
    // send is still skipped for them (there's no chat_id to send to), but the
    // digest itself must now land in their conversation so opening the app
    // is a real touchpoint, not a blank screen.
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const user = await repository.upsertOAuthUser({ auth_user_id: "oauth-1", name: "Web Anna" });
    await repository.updateProfile(user.id, {
      timezone: "UTC",
      morning_digest_enabled: true,
      weekly_digest_enabled: false,
      evening_sync_enabled: false,
      last_goal_checkin_on: "2026-08-25",
    });
    await repository.createTask(user.id, {
      title: "Оплатить хостинг",
      due_at: "2026-08-25T10:00:00.000Z",
    });
    const service = new ScheduledMessageService(repository, telegram);
    const result = await service.run(new Date("2026-08-25T08:05:00.000Z"));
    expect(result.sent.morning_digest).toBe(1);
    expect(telegram.sent).toHaveLength(0);
    const conversation = await repository.getPrimaryConversation(user.id);
    const messages = await repository.listMessages(user.id, conversation.id);
    const digestMessage = messages.find(
      (message) => message.role === "assistant" && message.metadata?.scheduled === "morning_digest",
    );
    expect(digestMessage?.content).toMatch(/Оплатить хостинг/);
  });
});
