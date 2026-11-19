import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  compactWhereabouts,
  isFreshWhereabouts,
  weatherText,
} from "../src/modules/assistant/whereabouts.js";
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

describe("whereabouts", () => {
  it("keeps one stay per city and starts a new one when the city changes", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 21, name: "A" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    const at = new Date().toISOString();
    const moscow = await request(app)
      .put("/api/me/whereabouts")
      .set(auth)
      .send({
        city: "Москва",
        country: "Россия",
        lat: 55.75583,
        lon: 37.6173,
        timezone: "Europe/Moscow",
        weather: { temp: -3.4, code: 71, at },
      });
    expect(moscow.status).toBe(200);
    expect(moscow.body.data.city).toBe("Москва");
    await request(app)
      .put("/api/me/whereabouts")
      .set(auth)
      .send({ city: "москва", country: "Россия", lat: 55.7, lon: 37.6 });
    expect(repository.whereabouts).toHaveLength(1);
    expect(repository.whereabouts[0]!.lat).toBe(55.7);

    await request(app)
      .put("/api/me/whereabouts")
      .set(auth)
      .send({ city: "Санкт-Петербург", country: "Россия", lat: 59.93, lon: 30.33 });
    expect(repository.whereabouts).toHaveLength(2);
    const current = await repository.getCurrentWhereabouts(user.id);
    expect(current?.city).toBe("Санкт-Петербург");
    expect(current?.lat).toBe(59.9);
  });

  it("rejects junk", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 22, name: "A" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    const bad = await request(app)
      .put("/api/me/whereabouts")
      .set(auth)
      .send({ city: "", lat: 200 });
    expect(bad.status).toBe(400);
  });

  it("describes the place and weather for Ilzi", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const place = {
      id: "w",
      owner_id: "u",
      city: "Санкт-Петербург",
      country: "Россия",
      lat: 59.9,
      lon: 30.3,
      timezone: "Europe/Moscow",
      arrived_at: "2026-11-18T22:30:00Z",
      last_seen_at: "2026-11-19T11:00:00Z",
      weather_temp: 2.6,
      weather_code: 61,
      weather_at: "2026-11-19T10:00:00Z",
    };
    expect(isFreshWhereabouts(place, now)).toBe(true);
    expect(compactWhereabouts(place, "UTC", now)).toEqual({
      city: "Санкт-Петербург",
      country: "Россия",
      since: "2026-11-19",
      weather: "+3°, дождь",
    });
    expect(
      compactWhereabouts({ ...place, weather_at: "2026-11-18T00:00:00Z" }, "UTC", now),
    ).not.toHaveProperty("weather");
    expect(isFreshWhereabouts({ ...place, last_seen_at: "2026-11-10T00:00:00Z" }, now)).toBe(false);
    expect(weatherText(0)).toBe("ясно");
    expect(weatherText(75)).toBe("сильный снег");
  });
});
