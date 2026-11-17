import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  computeQuota,
  loadQuota,
  periodEnd,
  periodStart,
  quotaMessage,
} from "../src/modules/billing/quota.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { QuotaPlan } from "../src/types.js";

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

const free: QuotaPlan = {
  plan: "free",
  title: "Бесплатно",
  period: "week",
  period_tokens: 1000,
  window_hours: 5,
  window_tokens: 400,
  updated_at: "2026-11-01T00:00:00.000Z",
};

const hour = (iso: string, total_tokens: number) => ({
  owner_id: "u",
  hour_start: iso,
  total_tokens,
  call_count: 1,
});

describe("cloud quota", () => {
  it("weeks start on Monday and months on the 1st (UTC)", () => {
    const at = new Date("2026-11-19T15:30:00.000Z"); // четверг
    expect(periodStart("week", at).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(periodEnd("week", at).toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(periodStart("month", at).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(periodEnd("month", at).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("is ok, then low, then exhausted for the period", () => {
    const at = new Date("2026-11-19T15:30:00.000Z");
    const base = { plan: free, planUntil: null, enforced: true, at };
    expect(computeQuota({ ...base, hours: [hour("2026-11-17T10:00:00.000Z", 300)] }).state).toBe(
      "ok",
    );
    expect(
      computeQuota({
        ...base,
        hours: [hour("2026-11-16T10:00:00.000Z", 500), hour("2026-11-17T10:00:00.000Z", 350)],
      }).state,
    ).toBe("low");
    const out = computeQuota({
      ...base,
      hours: [
        hour("2026-11-09T10:00:00.000Z", 5000), // прошлая неделя не считается
        hour("2026-11-16T10:00:00.000Z", 700),
        hour("2026-11-17T10:00:00.000Z", 300),
      ],
    });
    expect(out.state).toBe("exhausted");
    expect(out.period.used).toBe(1000);
    expect(out.available_at).toBe("2026-11-23T00:00:00.000Z");
  });

  it("limits a burst within the sliding window and says when it frees up", () => {
    const at = new Date("2026-11-19T15:30:00.000Z");
    const status = computeQuota({
      plan: free,
      planUntil: null,
      enforced: true,
      at,
      hours: [hour("2026-11-19T12:00:00.000Z", 250), hour("2026-11-19T15:00:00.000Z", 200)],
    });
    expect(status.state).toBe("exhausted");
    expect(status.window.used).toBe(450);
    // Как только час 12:00 выпадет из окна в 5 часов — останется 200 < 400.
    expect(status.window.resets_at).toBe("2026-11-19T17:00:00.000Z");
    expect(status.available_at).toBe("2026-11-19T17:00:00.000Z");
  });

  it("zero limits mean unlimited", () => {
    const status = computeQuota({
      plan: { ...free, period_tokens: 0, window_tokens: 0 },
      planUntil: null,
      enforced: true,
      at: new Date("2026-11-19T15:30:00.000Z"),
      hours: [hour("2026-11-19T15:00:00.000Z", 10_000_000)],
    });
    expect(status.state).toBe("ok");
  });

  it("expired subscription falls back to free", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 21, name: "A" });
    await repository.setUserPlan(user.id, "pro", "2026-01-01T00:00:00.000Z");
    expect((await loadQuota(repository, user.id)).plan).toBe("free");
    await repository.setUserPlan(user.id, "pro", null);
    expect((await loadQuota(repository, user.id)).plan).toBe("pro");
  });

  it("explains in Russian when the cloud comes back", () => {
    const status = computeQuota({
      plan: free,
      planUntil: null,
      enforced: true,
      at: new Date("2026-11-19T15:30:00.000Z"),
      hours: [hour("2026-11-17T10:00:00.000Z", 1000)],
    });
    expect(quotaMessage(status)).toContain("на эту неделю закончились");
    expect(quotaMessage(status)).toContain("23 ноября в 03:00");
  });

  it("blocks companion messages with 429 only when limits are enforced", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram: new FakeTelegram(), env });
    const user = await repository.upsertTelegramUser({ telegram_id: 22, name: "Anna" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    await repository.updateQuotaPlan("free", { period_tokens: 100, window_tokens: 0 });
    await repository.incrementUsage(user.id, {
      metric: "companion",
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });

    const quota = await request(app).get("/api/billing/quota").set(auth);
    expect(quota.status).toBe(200);
    expect(quota.body.data).toMatchObject({ plan: "free", enforced: false, state: "exhausted" });

    const allowed = await request(app)
      .post("/api/companion/messages")
      .set(auth)
      .send({ content: "привет", source_channel: "mini_app" });
    expect(allowed.status).not.toBe(429);

    await repository.setQuotaEnforced(true);
    const blocked = await request(app)
      .post("/api/companion/messages")
      .set(auth)
      .send({ content: "привет", source_channel: "mini_app" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(blocked.body.error.details).toMatchObject({ state: "exhausted", plan: "free" });
  });

  it("lets the first admin claim the panel and change limits and plans", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram: new FakeTelegram(), env });
    const admin = await repository.upsertTelegramUser({ telegram_id: 31, name: "Founder" });
    const other = await repository.upsertTelegramUser({
      telegram_id: 32,
      name: "Ira",
      username: "ira",
    });
    const adminAuth = {
      Authorization: `Bearer ${await createSession(admin.id, sessionSecret, 900)}`,
    };
    const otherAuth = {
      Authorization: `Bearer ${await createSession(other.id, sessionSecret, 900)}`,
    };

    expect((await request(app).get("/api/admin/quota").set(adminAuth)).body.data).toEqual({
      is_admin: false,
    });
    expect((await request(app).post("/api/admin/claim").set(adminAuth)).status).toBe(200);
    expect((await request(app).post("/api/admin/claim").set(otherAuth)).status).toBe(403);
    expect(
      (await request(app).put("/api/admin/quota").set(otherAuth).send({ enforced: true })).status,
    ).toBe(403);

    const saved = await request(app)
      .put("/api/admin/quota")
      .set(adminAuth)
      .send({ enforced: true, plans: [{ plan: "free", period_tokens: 5000 }] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.enforced).toBe(true);
    expect(saved.body.data.plans.find((p: QuotaPlan) => p.plan === "free").period_tokens).toBe(
      5000,
    );

    const own = await request(app).get("/api/billing/quota").set(adminAuth);
    expect(own.body.data).toMatchObject({ plan: "unlimited", state: "ok" });

    const upgraded = await request(app)
      .put("/api/admin/users/@ira/plan")
      .set(adminAuth)
      .send({ plan: "pro", until: "2027-01-01T00:00:00.000Z" });
    expect(upgraded.status).toBe(200);
    expect(upgraded.body.data.quota).toMatchObject({ plan: "pro" });
  });
});
