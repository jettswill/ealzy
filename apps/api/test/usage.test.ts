import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  attachUsageSink,
  loadUsageSummary,
  metricForSchema,
  runWithUsageOwner,
  summarizeUsage,
  tokensFromCompletionUsage,
  tokensFromTranscriptionUsage,
  utcDate,
  utcMonthStart,
} from "../src/modules/billing/usage.js";
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
  CRON_SECRET: "cron-secret-at-least-sixteen",
};

class FakeTelegram implements TelegramGateway {
  async sendMessage() {
    return Promise.resolve();
  }
  async answerCallbackQuery() {
    return Promise.resolve();
  }
}

describe("token usage metering", () => {
  it("maps schema names and OpenAI usage payloads", () => {
    expect(metricForSchema("companion_response")).toBe("companion");
    expect(metricForSchema("weekly_reflection")).toBe("reflect");
    expect(tokensFromCompletionUsage({ prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 })).toEqual({
      prompt_tokens: 80,
      completion_tokens: 20,
      total_tokens: 100,
    });
    expect(
      tokensFromTranscriptionUsage({
        type: "tokens",
        input_tokens: 40,
        output_tokens: 12,
        total_tokens: 52,
      }),
    ).toEqual({ prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 });
  });

  it("aggregates tokens per user, day, and metric", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 11, name: "A" })).id;
    const other = (await repository.upsertTelegramUser({ telegram_id: 12, name: "B" })).id;
    const today = new Date("2026-09-04T10:00:00.000Z");
    const yesterday = new Date("2026-09-03T10:00:00.000Z");
    await repository.incrementUsage(
      owner,
      { metric: "companion", prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      today,
    );
    await repository.incrementUsage(
      owner,
      { metric: "companion", prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      today,
    );
    await repository.incrementUsage(
      owner,
      { metric: "digest", prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
      yesterday,
    );
    await repository.incrementUsage(
      other,
      { metric: "companion", prompt_tokens: 999, completion_tokens: 1, total_tokens: 1000 },
      today,
    );

    const summary = summarizeUsage(
      await repository.listUsageCounters(owner, utcMonthStart(today), utcDate(today)),
      today,
    );
    expect(summary.today).toBe("2026-09-04");
    expect(summary.today_usage.total_tokens).toBe(200);
    expect(summary.today_usage.call_count).toBe(2);
    expect(summary.today_usage.by_metric.companion?.call_count).toBe(2);
    expect(summary.month_usage.total_tokens).toBe(430);
    expect(summary.month_usage.call_count).toBe(3);
    expect(summary.month_usage.by_metric.digest?.total_tokens).toBe(230);
  });

  it("attributes OpenAI usage through the owner context", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 13, name: "A" })).id;
    let recorded = 0;
    const original = repository.incrementUsage.bind(repository);
    repository.incrementUsage = async (...args) => {
      recorded += 1;
      return original(...args);
    };
    const ai = {
      bindUsage(
        sink: (usage: {
          metric: string;
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        }) => void,
      ) {
        this.sink = sink;
      },
      sink: undefined as
        | ((usage: {
            metric: string;
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          }) => void)
        | undefined,
    };
    attachUsageSink(ai, repository);
    await runWithUsageOwner(owner, async () => {
      ai.sink?.({ metric: "companion", prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
      await Promise.resolve();
    });
    expect(recorded).toBe(1);
    const rows = await repository.listUsageCounters(owner, "2026-01-01", "2026-12-31");
    expect(rows[0]?.total_tokens).toBe(15);
  });

  it("returns this user's token usage from GET /api/billing/usage", async () => {
    const repository = new InMemoryRepository();
    const telegram = new FakeTelegram();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 14, name: "Anna" });
    const stranger = await repository.upsertTelegramUser({ telegram_id: 15, name: "Ira" });
    await repository.incrementUsage(user.id, {
      metric: "companion",
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    });
    await repository.incrementUsage(stranger.id, {
      metric: "companion",
      prompt_tokens: 8000,
      completion_tokens: 200,
      total_tokens: 8200,
    });
    const res = await request(app)
      .get("/api/billing/usage")
      .set({ Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` });
    expect(res.status).toBe(200);
    expect(res.body.data.today_usage.total_tokens).toBe(150);
    expect(res.body.data.today_usage.call_count).toBe(1);
    expect(res.body.data.month_usage.total_tokens).toBe(150);
    expect(res.body.data.today_usage.by_metric.companion.prompt_tokens).toBe(120);
    const loaded = await loadUsageSummary(repository, user.id);
    expect(loaded.today_usage.total_tokens).toBe(150);
  });
});
