import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import {
  createDayClosePending,
  createGoalCheckInPending,
  createPersonDisambiguation,
  dayCloseCallbackData,
  goalCheckInCallbackData,
  pendingCallbackData,
  type AiProvider,
} from "../src/modules/assistant/index.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import { startTelegramPolling } from "../src/infrastructure/telegram.js";

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
  callbacks: string[] = [];
  edits: {
    chatId: number;
    messageId: number;
    replyMarkup: { inline_keyboard: { text: string; callback_data?: string }[][] };
  }[] = [];
  files = new Map<string, { bytes: Uint8Array; filename: string; mime: string }>();
  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
    this.sent.push({ chatId, text, options });
  }
  async answerCallbackQuery(id: string) {
    this.callbacks.push(id);
  }
  async editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    replyMarkup: { inline_keyboard: { text: string; callback_data?: string }[][] },
  ) {
    this.edits.push({ chatId, messageId, replyMarkup });
  }
  async downloadFile(fileId: string) {
    return this.files.get(fileId) ?? null;
  }
}

const setup = (ai?: AiProvider) => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return { repository, telegram, app: createApp({ repository, telegram, env, ai }) };
};

const webhook = (app: Express, body: Record<string, unknown>) =>
  request(app)
    .post(`/webhooks/telegram/${secret}`)
    .set("x-telegram-bot-api-secret-token", secret)
    .send(body);

async function commandUser(repository: InMemoryRepository, telegramId: number, name = "A") {
  const user = await repository.upsertTelegramUser({ telegram_id: telegramId, name });
  await repository.updateConversationMode(user.id, "command");
  return user;
}

describe("webhook natural language flows", () => {
  it("remembers an explicit fact through the webhook", async () => {
    const { app, repository, telegram } = setup();
    await commandUser(repository, 100);
    await webhook(app, {
      update_id: 1,
      message: {
        message_id: 1,
        text: "Запомни: Маша любит походы",
        chat: { id: 100 },
        from: { id: 100, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Запомнил|Создал профиль/);
    const user = repository.users[0]!;
    const masha = (await repository.listPeople(user.id)).find((person) => !person.is_self);
    expect(masha?.name).toBe("Маша");
    expect(await repository.listMemories(user.id, masha!.id)).toHaveLength(1);
  });

  it("creates recommendations from natural language", async () => {
    const ai: AiProvider = {
      async decide(text) {
        return {
          intent: "recommend",
          person_query: "Маша",
          content: text,
          category: null,
          title: null,
          space_name: null,
        };
      },
      async recommend() {
        return [
          {
            title: "Пикник",
            rationale: "General idea",
            memory_ids: [],
            experience_ids: [],
            is_generic: true,
          },
          {
            title: "Поход",
            rationale: "Because hikes",
            memory_ids: [],
            experience_ids: [],
            is_generic: false,
          },
          {
            title: "Музей",
            rationale: "Fallback",
            memory_ids: [],
            experience_ids: [],
            is_generic: true,
          },
        ];
      },
    };
    const { app, repository, telegram } = setup(ai);
    const user = (await commandUser(repository, 101)).id;
    await repository.createPerson(user, { name: "Маша" });
    await webhook(app, {
      update_id: 2,
      message: {
        message_id: 2,
        text: "Куда сходить с Машей?",
        chat: { id: 101 },
        from: { id: 101, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Пикник|Поход/);
    expect((await repository.listRecommendations(user))[0]?.items[0]).toMatchObject({
      is_generic: expect.any(Boolean),
    });
  });

  it("captures experience phrasing through the webhook", async () => {
    const { app, repository } = setup();
    const user = await commandUser(repository, 102);
    await repository.createPerson(user.id, { name: "Маша" });
    await webhook(app, {
      update_id: 3,
      message: {
        message_id: 3,
        text: "Вчера были с Машей в ресторане X, понравилось",
        chat: { id: 102 },
        from: { id: 102, first_name: "A" },
      },
    });
    expect(await repository.listExperiences(user.id)).toHaveLength(1);
  });

  it("handles companion mode messages", async () => {
    const ai: AiProvider = {
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
      async companion(query) {
        return {
          answer: `Companion: ${query}`,
          context_used: ["goal"],
          follow_up: "Anything else?",
        };
      },
    };
    const { app, repository, telegram } = setup(ai);
    await webhook(app, {
      update_id: 4,
      message: {
        message_id: 4,
        text: "/companion",
        chat: { id: 103 },
        from: { id: 103, first_name: "A" },
      },
    });
    await webhook(app, {
      update_id: 5,
      message: {
        message_id: 5,
        text: "What should I focus on?",
        chat: { id: 103 },
        from: { id: 103, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Companion:/);
    const assistant = repository.messages.filter((message) => message.role === "assistant").at(-1);
    expect(assistant?.metadata).toMatchObject({
      context_used: ["goal"],
      follow_up: "Anything else?",
    });
  });

  it("passes a Telegram reply into companion context", async () => {
    let seen: { workspace?: { replied_to?: unknown }; conversation?: { content?: string }[] } | undefined;
    const ai: AiProvider = {
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
      async companion(query, context) {
        seen = context as typeof seen;
        return {
          answer: `Companion: ${query}`,
          context_used: [],
          follow_up: null,
        };
      },
    };
    const { app, repository } = setup(ai);
    await webhook(app, {
      update_id: 401,
      message: {
        message_id: 401,
        text: "добавь задачу Купить лекарства",
        chat: { id: 401 },
        from: { id: 401, first_name: "A" },
      },
    });
    await webhook(app, {
      update_id: 402,
      message: {
        message_id: 402,
        text: "добавь в описание аптечку для ребёнка",
        chat: { id: 401 },
        from: { id: 401, first_name: "A" },
        reply_to_message: {
          message_id: 401,
          text: "добавь задачу Купить лекарства",
          from: { id: 401, first_name: "A" },
        },
      },
    });
    const reply = repository.messages.filter((message) => message.role === "user").at(-1);
    expect(reply?.metadata).toMatchObject({
      reply_to: {
        telegram_message_id: 401,
        content: "добавь задачу Купить лекарства",
      },
    });
    expect(seen?.workspace).toMatchObject({
      replied_to: {
        content: expect.stringContaining("Купить лекарства"),
      },
    });
    expect(JSON.stringify(seen?.conversation ?? [])).toMatch(/replied-to|Купить лекарства/);
  });

  it("resolves ambiguous people through callback_query", async () => {
    const { app, repository, telegram } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 104, name: "A" });
    await repository.createPerson(user.id, { name: "Маша", aliases: ["мама"] });
    await repository.createPerson(user.id, { name: "Ира", aliases: ["мама"] });
    const pending = await createPersonDisambiguation(
      repository,
      user.id,
      104,
      {
        intent: "remember",
        person_query: "мама",
        content: "любит чай",
        category: "preference",
        importance: 3,
        confidence: 0.8,
        occurred_at: null,
        metadata: {},
        title: null,
        space_name: null,
      },
      (await repository.listPeople(user.id)).filter((person) => !person.is_self),
      randomUUID(),
    );
    const personId = (await repository.listPeople(user.id)).find(
      (person) => person.name === "Маша",
    )!.id;
    await webhook(app, {
      update_id: 6,
      callback_query: {
        id: "cb-1",
        data: pendingCallbackData(pending.pending.id, personId),
        from: { id: 104, first_name: "A" },
        message: { message_id: 6, chat: { id: 104 } },
      },
    });
    expect(telegram.callbacks).toContain("cb-1");
    expect(telegram.sent.at(-1)?.text).toMatch(/Запомнил/);
    const masha = (await repository.listPeople(user.id)).find((person) => person.name === "Маша")!;
    expect(
      (await repository.listMemories(user.id, masha.id)).some((memory) =>
        memory.content.includes("чай"),
      ),
    ).toBe(true);
  });

  it("completes experience follow-up instead of creating a duplicate", async () => {
    const { app, repository, telegram } = setup();
    const user = await commandUser(repository, 105);
    const experience = await repository.createExperience(user.id, {
      type: "activity",
      title: "Kayaking",
      status: "follow_up_due",
    });
    await repository.createPendingAction(user.id, {
      telegram_chat_id: 105,
      action: "experience_follow_up",
      payload: { kind: "experience_follow_up", experience_id: experience.id },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    await webhook(app, {
      update_id: 7,
      message: {
        message_id: 7,
        text: "Было классно, понравилась природа",
        chat: { id: 105 },
        from: { id: 105, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Спасибо за отзыв/);
    expect(await repository.listExperiences(user.id)).toHaveLength(1);
    expect((await repository.getExperience(user.id, experience.id))?.status).toBe("completed");
  });

  it("creates a birthday organization bundle through the webhook", async () => {
    const { app, repository, telegram } = setup();
    const user = await commandUser(repository, 106);
    await repository.createPerson(user.id, { name: "Мама", aliases: ["мама", "мамы"] });
    await webhook(app, {
      update_id: 8,
      message: {
        message_id: 8,
        text: "Помоги организовать день рождения мамы",
        chat: { id: 106 },
        from: { id: 106, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Собрал план/);
    expect(await repository.listSpaces(user.id)).toHaveLength(1);
    expect(await repository.listTasks(user.id)).toHaveLength(1);
    expect(await repository.listRecommendations(user.id)).toHaveLength(1);
  });

  it("transcribes a voice note into a remember command", async () => {
    const ai: AiProvider = {
      async decide() {
        return {
          intent: "remember",
          person_query: "Маша",
          content: "любит чай",
          category: "interest",
          title: null,
          space_name: null,
        };
      },
      async recommend() {
        return [];
      },
      async transcribe() {
        return "Запомни: Маша любит чай";
      },
    };
    const { app, repository, telegram } = setup(ai);
    await commandUser(repository, 107);
    telegram.files.set("voice1", {
      bytes: new Uint8Array([1, 2, 3]),
      filename: "voice.ogg",
      mime: "audio/ogg",
    });
    await webhook(app, {
      update_id: 9,
      message: {
        message_id: 9,
        voice: { file_id: "voice1", mime_type: "audio/ogg", file_size: 12 },
        chat: { id: 107 },
        from: { id: 107, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Запомнил|Создал профиль/);
    const user = repository.users[0]!;
    const masha = (await repository.listPeople(user.id)).find((person) => person.name === "Маша");
    expect(masha).toBeTruthy();
    expect(await repository.listMemories(user.id, masha!.id)).toHaveLength(1);
  });

  it("remembers a forwarded note", async () => {
    const { app, repository, telegram } = setup();
    await commandUser(repository, 108);
    await webhook(app, {
      update_id: 10,
      message: {
        message_id: 10,
        text: "Запомни: Маша любит чай",
        forward_date: 1_700_000_000,
        forward_from: { first_name: "Ира" },
        chat: { id: 108 },
        from: { id: 108, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Запомнил|Создал профиль/);
    const user = repository.users[0]!;
    const stored = repository.messages.find((message) => message.role === "user");
    expect(stored?.content).toMatch(/переслано от Ира/);
    expect(stored?.metadata).toMatchObject({ capture: "forward" });
    const masha = (await repository.listPeople(user.id)).find((person) => person.name === "Маша");
    expect(masha).toBeTruthy();
  });

  it("closes leftover tasks from evening buttons without consuming the pending action", async () => {
    const { app, repository, telegram } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 109, name: "A" });
    const task = await repository.createTask(user.id, {
      title: "Buy flowers",
      due_at: "2026-08-24T12:00:00.000Z",
    });
    const extra = await repository.createTask(user.id, {
      title: "Call mom",
      due_at: "2026-08-24T15:00:00.000Z",
    });
    const { pending } = await createDayClosePending(
      repository,
      user.id,
      109,
      [task, extra],
      "2026-08-24",
      "ru",
    );
    await webhook(app, {
      update_id: 11,
      callback_query: {
        id: "cb-day-1",
        data: dayCloseCallbackData(pending.id, task.id, "done"),
        from: { id: 109, first_name: "A" },
        message: { message_id: 20, chat: { id: 109 } },
      },
    });
    expect((await repository.listTasks(user.id)).find((item) => item.id === task.id)?.status).toBe(
      "done",
    );
    expect(await repository.findActivePendingAction(user.id, 109, "day_close")).toBeTruthy();
    await webhook(app, {
      update_id: 12,
      callback_query: {
        id: "cb-day-2",
        data: dayCloseCallbackData(pending.id, extra.id, "tomorrow"),
        from: { id: 109, first_name: "A" },
        message: { message_id: 20, chat: { id: 109 } },
      },
    });
    // Полдень по поясу пользователя (Europe/Moscow), а не полдень UTC:
    // раньше «перенести на завтра» ставило дело на 15:00 по местному времени.
    expect((await repository.listTasks(user.id)).find((item) => item.id === extra.id)?.due_at).toBe(
      "2026-08-25T09:00:00.000Z",
    );
    expect(telegram.sent.at(-1)?.text).toMatch(/На завтра: Call mom/);
    expect(telegram.edits.at(-1)?.replyMarkup.inline_keyboard).toEqual([]);
  });

  it("opens a task action menu from the evening list and can go back", async () => {
    const { app, repository, telegram } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 1091, name: "A" });
    const task = await repository.createTask(user.id, {
      title: "Buy flowers",
      due_at: "2026-08-24T12:00:00.000Z",
    });
    const extra = await repository.createTask(user.id, {
      title: "Call mom",
      due_at: "2026-08-24T15:00:00.000Z",
    });
    const { pending, keyboard } = await createDayClosePending(
      repository,
      user.id,
      1091,
      [task, extra],
      "2026-08-24",
      "ru",
    );
    expect(keyboard).toEqual([
      [expect.objectContaining({ text: "Buy flowers" })],
      [expect.objectContaining({ text: "Call mom" })],
    ]);
    expect(keyboard.every((row) => row.every((button) => button.callback_data.length <= 64))).toBe(
      true,
    );
    await webhook(app, {
      update_id: 21,
      callback_query: {
        id: "cb-day-select",
        data: dayCloseCallbackData(pending.id, extra.id, "select"),
        from: { id: 1091, first_name: "A" },
        message: { message_id: 21, chat: { id: 1091 } },
      },
    });
    expect(telegram.sent).toHaveLength(0);
    const actions = telegram.edits.at(-1)?.replyMarkup.inline_keyboard;
    expect(actions?.[0]?.[0]?.text).toBe("Call mom");
    expect(actions?.slice(1).map((row) => row.map((button) => button.text))).toEqual([
      ["Выполнено"],
      ["Обсудить с Илзи"],
      ["Перенести на завтра"],
      ["← Все задачи"],
    ]);
    await webhook(app, {
      update_id: 22,
      callback_query: {
        id: "cb-day-back",
        data: dayCloseCallbackData(pending.id, extra.id, "back"),
        from: { id: 1091, first_name: "A" },
        message: { message_id: 21, chat: { id: 1091 } },
      },
    });
    expect(telegram.edits.at(-1)?.replyMarkup.inline_keyboard).toEqual([
      [expect.objectContaining({ text: "Buy flowers" })],
      [expect.objectContaining({ text: "Call mom" })],
    ]);
  });

  it("starts a companion turn when discussing a leftover task", async () => {
    const ai: AiProvider = {
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
      async companion(query) {
        return {
          answer: `Разберём: ${query.slice(0, 50)}`,
          context_used: ["tasks"],
          follow_up: null,
        };
      },
    };
    const { app, repository, telegram } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 1092, name: "A" });
    const task = await repository.createTask(user.id, {
      title: "Buy flowers",
      due_at: "2026-08-24T12:00:00.000Z",
    });
    const { pending } = await createDayClosePending(
      repository,
      user.id,
      1092,
      [task],
      "2026-08-24",
      "ru",
    );
    await webhook(app, {
      update_id: 23,
      callback_query: {
        id: "cb-day-discuss",
        data: dayCloseCallbackData(pending.id, task.id, "discuss"),
        from: { id: 1092, first_name: "A" },
        message: { message_id: 22, chat: { id: 1092 } },
      },
    });
    expect((await repository.listTasks(user.id)).find((item) => item.id === task.id)?.status).toBe(
      "todo",
    );
    expect(telegram.sent.at(-1)?.text).toMatch(/Buy flowers/);
    expect(
      telegram.edits.at(-1)?.replyMarkup.inline_keyboard.some((row) =>
        row.some((button) => button.text === "Обсудить с Илзи"),
      ),
    ).toBe(true);
  });

  it("pauses a goal from the weekly check-in button", async () => {
    const { app, repository, telegram } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 110, name: "A" });
    const goal = await repository.createGoal(user.id, { title: "Learn French" });
    const { pending } = await createGoalCheckInPending(repository, user.id, 110, goal.id, "ru");
    await webhook(app, {
      update_id: 13,
      callback_query: {
        id: "cb-goal-1",
        data: goalCheckInCallbackData(pending.id, "pause"),
        from: { id: 110, first_name: "A" },
        message: { message_id: 30, chat: { id: 110 } },
      },
    });
    expect((await repository.getGoal(user.id, goal.id))?.status).toBe("paused");
    expect(telegram.sent.at(-1)?.text).toMatch(/на паузу/);
    expect(await repository.findActivePendingAction(user.id, 110, "goal_checkin")).toBeNull();
  });

  it("starts a goals and plan sync when the invite is accepted", async () => {
    const ai: AiProvider = {
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
      async companion(query) {
        return {
          answer: `Начинаем синк: ${query.slice(0, 40)}`,
          context_used: ["goals"],
          follow_up: null,
        };
      },
    };
    const { app, repository, telegram } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 111, name: "A" });
    await repository.createGoal(user.id, { title: "Learn French" });
    const { pending } = await createGoalCheckInPending(repository, user.id, 111, null, "ru");
    await webhook(app, {
      update_id: 14,
      callback_query: {
        id: "cb-goal-2",
        data: goalCheckInCallbackData(pending.id, "plan"),
        from: { id: 111, first_name: "A" },
        message: { message_id: 31, chat: { id: 111 } },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Начинаем синк: Синк по целям и плану/);
  });

  it("answers free-form text, voice intent, and forwards in companion mode", async () => {
    const ai: AiProvider = {
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
      async companion(query) {
        return {
          answer: `Понял и сделал: ${query}`,
          context_used: [],
          follow_up: null,
        };
      },
    };
    const { app, telegram } = setup(ai);
    await webhook(app, {
      update_id: 90,
      message: {
        message_id: 90,
        text: "добавь задачу купить молоко",
        chat: { id: 200 },
        from: { id: 200, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Понял и сделал: добавь задачу купить молоко/);
  });

  it("asks for text or voice when the message has nothing to capture", async () => {
    const { app, telegram } = setup();
    await webhook(app, {
      update_id: 91,
      message: {
        message_id: 91,
        chat: { id: 201 },
        from: { id: 201, first_name: "A" },
      },
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/голосом|перешлите/);
  });

  it("long-polls getUpdates when Telegram cannot reach the webhook", async () => {
    const seen: number[] = [];
    const controller = new AbortController();
    let calls = 0;
    const telegram: TelegramGateway = {
      async sendMessage() {},
      async answerCallbackQuery() {},
      async deleteWebhook() {},
      async getUpdates() {
        calls += 1;
        if (calls > 1) {
          controller.abort();
          return [];
        }
        return [
          {
            update_id: 501,
            message: { message_id: 1, text: "hi", chat: { id: 1 }, from: { id: 1, first_name: "A" } },
          },
        ];
      },
    };
    await startTelegramPolling(
      {
        handle: async (raw) => {
          seen.push((raw as { update_id: number }).update_id);
        },
      },
      telegram,
      { signal: controller.signal, timeoutSeconds: 0 },
    );
    expect(seen).toEqual([501]);
  });
});
