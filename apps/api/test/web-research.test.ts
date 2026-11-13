import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import type { AiProvider } from "../src/modules/assistant/index.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { DiscoveryClient } from "../src/modules/assistant/discovery.js";
import {
  attachWebSources,
  dedupeSources,
  needsLiveWeb,
  stripInlineLinks,
} from "../src/modules/assistant/web-research.js";

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
const setup = (ai?: AiProvider, discovery?: DiscoveryClient) => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return { repository, telegram, app: createApp({ repository, telegram, env, ai, discovery }) };
};
const auth = async (ownerId: string) => ({
  Authorization: `Bearer ${await createSession(ownerId, sessionSecret, 900)}`,
});

describe("live web research before Ilzi answers", () => {
  it("picks messages that need fresh data and skips pure capture", () => {
    for (const text of [
      "Надо в Москву на выходные, глянь поезда",
      "Сколько стоит Сапсан до Москвы в субботу?",
      "Какая погода в Питере завтра?",
      "Что идёт в театрах на выходных?",
      "Хочу на выходные в Казань, что посмотреть?",
    ]) {
      expect(needsLiveWeb(text), text).toBe(true);
    }
    for (const text of [
      "Напомни купить билеты в пятницу",
      "Привет!",
      "Как дела с моими задачами?",
      "Запиши: позвонить маме",
    ]) {
      expect(needsLiveWeb(text), text).toBe(false);
    }
  });

  it("cleans tracking from sources and appends them once", () => {
    const sources = dedupeSources([
      { title: "", url: "https://rasp.yandex.ru/train/spb--moscow?utm_source=openai" },
      { title: "", url: "https://rasp.yandex.ru/train/spb--moscow" },
      { title: "Ozon", url: "https://www.ozon.ru/travel/railway/?utm_source=openai&x=1" },
    ]);
    expect(sources.map((source) => source.url)).toEqual([
      "https://rasp.yandex.ru/train/spb--moscow",
      "https://www.ozon.ru/travel/railway/?x=1",
    ]);
    const research = { fetched_at: "", query: "", summary: "", sources };
    const answer = attachWebSources("Лучше «Сапсан» в 9:00.", research, "ru-RU");
    expect(answer).toContain(
      "Источники:\n• [rasp.yandex.ru](https://rasp.yandex.ru/train/spb--moscow)",
    );
    expect(
      stripInlineLinks(
        "Сапсан 05:30. ([rasp.yandex.ru](https://rasp.yandex.ru/x?utm_source=openai))",
      ),
    ).toBe("Сапсан 05:30.");
  });

  it("feeds the fresh brief to Ilzi and lists sources under the answer", async () => {
    const seen: { query?: string; workspace?: unknown } = {};
    const ai = fallbackAi({
      async research(query) {
        seen.query = query;
        return {
          fetched_at: "2026-11-13T09:00:00.000Z",
          query,
          summary: "Сапсан 751А 05:30 → 09:23, от 3 420 ₽.",
          sources: [
            { title: "Яндекс Расписания", url: "https://rasp.yandex.ru/train/spb--moscow" },
          ],
        };
      },
      async companion(_query, context) {
        seen.workspace = (context as { workspace?: unknown }).workspace;
        return { answer: "Бери «Сапсан» в 05:30 — к 09:23 будешь в Москве." };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 901, name: "A" });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "Какие поезда в Москву в субботу утром?", source_channel: "mini_app" });
    expect(replied.status).toBe(201);
    expect(seen.query).toMatch(/поезда в Москву/);
    expect(JSON.stringify(seen.workspace)).toMatch(/web_research.*Сапсан 751А/);
    expect(replied.body.data.response.answer).toMatch(/Сапсан/);
    expect(replied.body.data.response.answer).toMatch(/Источники:[\s\S]*rasp\.yandex\.ru/);
  });

  it("answers without the brief when the search fails", async () => {
    const ai = fallbackAi({
      async research() {
        throw new Error("timeout");
      },
      async companion() {
        return { answer: "Живых данных сейчас нет, но вот как проверить быстро." };
      },
    });
    const { app, repository } = setup(ai);
    const user = await repository.upsertTelegramUser({ telegram_id: 902, name: "A" });
    const replied = await request(app)
      .post("/api/companion/messages")
      .set(await auth(user.id))
      .send({ content: "Какая погода в Москве в субботу?", source_channel: "mini_app" });
    expect(replied.status).toBe(201);
    expect(replied.body.data.response.answer).toMatch(/Живых данных/);
    expect(replied.body.data.response.answer).not.toMatch(/Источники/);
  });
});
