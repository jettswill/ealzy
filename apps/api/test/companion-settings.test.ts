import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  inferCompanionSettings,
  PersonalContextBuilder,
  toCompanionWorkspace,
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
const setup = (ai?: AiProvider) => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return { repository, telegram, app: createApp({ repository, telegram, env, ai }) };
};
const auth = async (ownerId: string) => ({
  Authorization: `Bearer ${await createSession(ownerId, sessionSecret, 900)}`,
});

describe("inferCompanionSettings", () => {
  it("reads Telegram digest time and off switches from chat", () => {
    expect(inferCompanionSettings("Присылай утреннее в телеграм в 7:30")).toEqual({
      morning_digest_enabled: true,
      morning_digest_time: "07:30",
    });
    expect(inferCompanionSettings("выключи вечерний синк")).toEqual({
      evening_sync_enabled: false,
    });
    expect(inferCompanionSettings("все уведомления на 9:00")).toEqual({
      morning_digest_enabled: true,
      morning_digest_time: "09:00",
      weekly_digest_enabled: true,
      weekly_digest_time: "09:00",
      evening_sync_enabled: true,
      evening_sync_time: "09:00",
    });
  });

  it("reads timezone, locale and profile fields", () => {
    expect(inferCompanionSettings("поставь часовой пояс Новосибирск")).toEqual({
      timezone: "Asia/Novosibirsk",
    });
    expect(inferCompanionSettings("переключи на английский")).toEqual({ locale: "en" });
    expect(inferCompanionSettings("ценности: семья, здоровье")).toEqual({
      values: ["семья", "здоровье"],
    });
  });

  it("does not treat a casual morning mention as a settings change", () => {
    expect(inferCompanionSettings("утром в 7 я бегаю")).toBeNull();
  });
});

describe("companion chat settings", () => {
  it("exposes live notification settings in the workspace", async () => {
    const { repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 901, name: "Ann" });
    await repository.updateProfile(user.id, {
      morning_digest_time: "07:15",
      evening_sync_enabled: false,
    });
    const workspace = toCompanionWorkspace(
      await new PersonalContextBuilder(repository).build(user.id, "настройки"),
    );
    expect(workspace.settings).toMatchObject({
      telegram_linked: true,
      timezone: "Europe/Moscow",
      morning_digest_time: "07:15",
      evening_sync_enabled: false,
    });
    expect(workspace.capabilities.some((item) => item.startsWith("settings:"))).toBe(true);
  });

  it("saves notification times from an Ilzi reply", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Утро теперь в 07:30, вечер выключила.",
          context_used: ["settings"],
          follow_up: null,
          settings: {
            morning_digest_enabled: true,
            morning_digest_time: "07:30",
            evening_sync_enabled: false,
          },
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 902, name: "Ann" });
    const reply = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Присылай утреннее в телеграм в 7:30, вечернее выключи",
        source_channel: "mini_app",
      });
    expect(reply.status).toBe(201);
    expect(await repository.getProfile(user.id)).toMatchObject({
      morning_digest_enabled: true,
      morning_digest_time: "07:30",
      evening_sync_enabled: false,
    });
    expect(reply.body.data.assistant_message.content).toMatch(/07:30/);
    expect(reply.body.data.assistant_message.metadata.settings).toMatchObject({
      morning_digest_time: "07:30",
      evening_sync_enabled: false,
    });
  });

  it("applies notification settings even when the model is down", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 903, name: "Ann" });
    const reply = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({
        content: "Присылай утреннее в телеграм в 6:45",
        source_channel: "telegram",
      });
    expect(reply.status).toBe(201);
    expect(await repository.getProfile(user.id)).toMatchObject({
      morning_digest_enabled: true,
      morning_digest_time: "06:45",
    });
    expect(reply.body.data.assistant_message.content).toMatch(/06:45/);
  });

  it("switches timezone and language from chat", async () => {
    const ai = fallbackAi({
      async companion() {
        return {
          answer: "Timezone set.",
          context_used: ["settings"],
          follow_up: null,
          settings: { timezone: "Asia/Novosibirsk", locale: "en" },
        };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 904, name: "Ann" });
    const reply = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "поставь часовой пояс Новосибирск и переключи на английский" });
    expect(reply.status).toBe(201);
    expect(await repository.getProfile(user.id)).toMatchObject({
      timezone: "Asia/Novosibirsk",
      locale: "en-US",
    });
  });
});
