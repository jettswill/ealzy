import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import {
  ONBOARDING_MORE_CALLBACK,
  handleOnboardingReply,
  startGuidedOnboarding,
  startOnboardingMore,
} from "../src/modules/assistant/guided-onboarding.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";

const secret = "webhook-secret-at-least-sixteen";
const sessionSecret = "session-secret-at-least-thirty-two-characters";
const env = {
  CORS_ORIGIN: "*",
  TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz",
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
  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
    this.sent.push({ chatId, text, options });
  }
  async answerCallbackQuery(id: string) {
    this.callbacks.push(id);
  }
}

const emptyExtract = async () => ({ memories: [], goals: [], people: [] });

describe("guided onboarding", () => {
  it("creates a goal even when extraction is empty and offers three more questions", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 11, name: "Аня" });
    const chatId = 11;
    await startGuidedOnboarding(repository, user.id, chatId, "ru");

    const reply = async (text: string) => {
      const pending = await repository.findActivePendingAction(
        user.id,
        chatId,
        "guided_onboarding",
      );
      expect(pending).toBeTruthy();
      return handleOnboardingReply(repository, user.id, pending!, text, "ru", emptyExtract);
    };

    const first = await reply("Я дизайнер, сейчас много заказов");
    expect(first.done).toBe(false);
    expect(await repository.listGoals(user.id)).toHaveLength(0);

    const second = await reply("Хочу спокойно запускать свои проекты");
    expect(second.done).toBe(true);
    expect(second.offerMore).toBe(true);
    expect(second.reply).toMatch(/спокойно запускать свои проекты/);
    expect(second.reply).toMatch(/дел из головы/);
    expect((await repository.listGoals(user.id)).map((goal) => goal.title)).toEqual([
      "Хочу спокойно запускать свои проекты",
    ]);
    expect((await repository.getProfile(user.id))?.onboarding_completed_at).toBeTruthy();
    expect(
      repository.betaMetrics.some(
        (event) => event.owner_id === user.id && event.name === "onboarding_complete",
      ),
    ).toBe(true);
    expect(await repository.findActivePendingAction(user.id, chatId, "guided_onboarding")).toBeNull();

    const extraStart = await startOnboardingMore(repository, user.id, chatId, "ru");
    expect(extraStart).toMatch(/ритм|жаворонок|сова/i);
    expect(await repository.findActivePendingAction(user.id, chatId, "first_brain_dump")).toBeNull();

    const extra1 = await reply("Сова, сложное после обеда уже тяжело");
    expect(extra1.done).toBe(false);
    const extra2 = await reply("Закрыть первый платный продукт");
    expect(extra2.done).toBe(false);
    const extra3 = await reply("Коротко и по делу");
    expect(extra3.done).toBe(true);
    expect(extra3.offerMore).toBe(false);
    expect((await repository.getProfile(user.id))?.communication_style).toBe("коротко и по делу");
    const memories = await repository.listMemories(user.id, (await repository.getSelfPerson(user.id))!.id);
    expect(memories.map((memory) => memory.content).join(" ")).toMatch(/сова/i);
  });
});

describe("guided onboarding webhook", () => {
  it("finishes with Mini App and more-questions buttons, then continues", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const app = createApp({ repository, telegram, env });
    const webhook = (body: Record<string, unknown>) =>
      request(app)
        .post(`/webhooks/telegram/${secret}`)
        .set("x-telegram-bot-api-secret-token", secret)
        .send(body);

    await webhook({
      update_id: 1,
      message: {
        message_id: 1,
        text: "/start",
        chat: { id: 44 },
        from: { id: 44, first_name: "Аня" },
      },
    });
    expect(telegram.sent[0]?.text).toMatch(/личный помощник/);

    await webhook({
      update_id: 2,
      message: {
        message_id: 2,
        text: "Работаю продактом",
        chat: { id: 44 },
        from: { id: 44, first_name: "Аня" },
      },
    });
    await webhook({
      update_id: 3,
      message: {
        message_id: 3,
        text: "Хочу меньше распыляться",
        chat: { id: 44 },
        from: { id: 44, first_name: "Аня" },
      },
    });

    const done = telegram.sent.at(-1);
    const keyboard = (
      done?.options as
        | { reply_markup?: { inline_keyboard?: { text: string; callback_data?: string; web_app?: { url: string } }[][] } }
        | undefined
    )?.reply_markup?.inline_keyboard;
    expect(keyboard?.[0]?.[0]?.web_app?.url).toBe("https://example.com/app");
    expect(keyboard?.[1]?.[0]?.callback_data).toBe(ONBOARDING_MORE_CALLBACK);
    const owner = repository.users.find((item) => item.telegram_id === 44);
    expect(owner).toBeTruthy();
    expect((await repository.listGoals(owner!.id)).length).toBeGreaterThan(0);

    await webhook({
      update_id: 5,
      message: {
        message_id: 5,
        text: "позвонить маме, оплатить счета, дописать оффер",
        chat: { id: 44 },
        from: { id: 44, first_name: "Аня" },
      },
    });
    const tasks = await repository.listTasks(owner!.id);
    expect(tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining(["позвонить маме", "оплатить счета", "дописать оффер"]),
    );
    expect(telegram.sent.at(-1)?.text).toMatch(/сегодня/);

    await webhook({
      update_id: 6,
      callback_query: {
        id: "cb-more",
        data: ONBOARDING_MORE_CALLBACK,
        from: { id: 44, first_name: "Аня" },
        message: { message_id: 10, chat: { id: 44 } },
      },
    });
    expect(telegram.callbacks).toContain("cb-more");
    expect(telegram.sent.at(-1)?.text).toMatch(/ритм|жаворонок|сова/i);
  });
});
