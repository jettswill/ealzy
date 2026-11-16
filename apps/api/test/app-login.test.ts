import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession, parseAppLoginStart } from "../src/modules/auth/index.js";
import { oauthAppRedirect, oauthClientFromState, startOAuthUrl } from "../src/modules/auth/oauth.js";
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
  VITE_TELEGRAM_BOT_USERNAME: "@ealzy_bot",
};

class FakeTelegram implements TelegramGateway {
  sent: { chatId: number; text: string }[] = [];
  async sendMessage(chatId: number, text: string) {
    this.sent.push({ chatId, text });
  }
  async answerCallbackQuery() {}
}

const setup = () => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return { repository, telegram, app: createApp({ repository, telegram, env }) };
};

const startUpdate = (nonce: string, updateId = 1, messageId = 1) => ({
  update_id: updateId,
  message: {
    message_id: messageId,
    text: `/start applogin_${nonce}`,
    chat: { id: 30 },
    from: { id: 40, first_name: "Аня" },
  },
});

describe("app login via Telegram", () => {
  afterEach(() => vi.useRealTimers());

  it("parses only well-formed start payloads", () => {
    const nonce = "a".repeat(32);
    expect(parseAppLoginStart(`/start applogin_${nonce}`)).toBe(nonce);
    expect(parseAppLoginStart(`/start@ealzy_bot applogin_${nonce}`)).toBe(nonce);
    expect(parseAppLoginStart("/start applogin_short")).toBeNull();
    expect(parseAppLoginStart("/start")).toBeNull();
    expect(parseAppLoginStart(`купить applogin_${nonce}`)).toBeNull();
  });

  it("issues a bot link, approves it in the bot and hands out one session", async () => {
    const { app, telegram, repository } = setup();
    const started = await request(app).post("/api/auth/app-login/start").send({});
    expect(started.status).toBe(201);
    const { nonce, telegram_url } = started.body.data;
    expect(telegram_url).toBe(`https://t.me/ealzy_bot?start=applogin_${nonce}`);

    const pending = await request(app).post("/api/auth/app-login/poll").send({ nonce });
    expect(pending.body.data.status).toBe("pending");

    const webhook = await request(app)
      .post(`/webhooks/telegram/${secret}`)
      .set("x-telegram-bot-api-secret-token", secret)
      .send(startUpdate(nonce));
    expect(webhook.status).toBe(200);
    expect(telegram.sent.at(-1)!.text).toMatch(/вход в приложение Ealzy подтверждён/);
    // Код входа не попадает в переписку с Илзи.
    expect(repository.messages.some((m) => m.content.includes(nonce))).toBe(false);

    const approved = await request(app).post("/api/auth/app-login/poll").send({ nonce });
    expect(approved.body.data.status).toBe("approved");
    expect(approved.body.data.token).toEqual(expect.any(String));
    expect(approved.body.data.user.telegram_id).toBe(40);

    const me = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${approved.body.data.token}`);
    expect(me.status).toBe(200);

    const again = await request(app).post("/api/auth/app-login/poll").send({ nonce });
    expect(again.body.data.status).toBe("expired");
  });

  it("rejects unknown and stale codes", async () => {
    const { app, telegram, repository } = setup();
    const unknown = "b".repeat(32);
    await request(app)
      .post(`/webhooks/telegram/${secret}`)
      .set("x-telegram-bot-api-secret-token", secret)
      .send(startUpdate(unknown));
    expect(telegram.sent.at(-1)!.text).toMatch(/устарела/);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    const started = await request(app).post("/api/auth/app-login/start").send({});
    const { nonce } = started.body.data;
    vi.setSystemTime(new Date("2026-11-16T10:11:00Z"));
    expect(await repository.approveAppLoginRequest(nonce, "x")).toBe(false);
    const poll = await request(app).post("/api/auth/app-login/poll").send({ nonce });
    expect(poll.body.data.status).toBe("expired");
  });
});

describe("OAuth return to the iOS app", () => {
  const oauthEnv = {
    ...env,
    GOOGLE_OAUTH_CLIENT_ID: "client",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://example.com/api/auth/oauth/google/callback",
  };

  it("keeps the client in state and redirects to ealzy://", async () => {
    const url = new URL(await startOAuthUrl(oauthEnv, "google", "login", undefined, "ios"));
    const state = url.searchParams.get("state");
    expect(await oauthClientFromState(oauthEnv, state)).toBe("ios");
    expect(oauthAppRedirect(oauthEnv, { kind: "session", token: "t" }, "ios")).toBe(
      "ealzy://auth/callback#token=t",
    );
    const web = new URL(await startOAuthUrl(oauthEnv, "google", "login"));
    expect(await oauthClientFromState(oauthEnv, web.searchParams.get("state"))).toBe("web");
    expect(await oauthClientFromState(oauthEnv, "garbage")).toBe("web");
    expect(oauthAppRedirect(oauthEnv, { kind: "session", token: "t" })).toBe(
      "https://example.com/app/auth/callback#token=t",
    );
  });
});

describe("devices", () => {
  it("registers a push token once and moves it between accounts", async () => {
    const { app, repository } = setup();
    const a = await repository.upsertTelegramUser({ telegram_id: 1, name: "A" });
    const b = await repository.upsertTelegramUser({ telegram_id: 2, name: "B" });
    const token = "f".repeat(64);
    const body = { platform: "ios", push_token: token, environment: "sandbox", app_version: "0.1" };
    const first = await request(app)
      .post("/api/devices")
      .set("Authorization", `Bearer ${await createSession(a.id, sessionSecret, 900)}`)
      .send(body);
    expect(first.status).toBe(201);
    await request(app)
      .post("/api/devices")
      .set("Authorization", `Bearer ${await createSession(b.id, sessionSecret, 900)}`)
      .send(body);
    expect(repository.devices).toHaveLength(1);
    expect(repository.devices[0]!.owner_id).toBe(b.id);
    const removed = await request(app)
      .delete("/api/devices")
      .set("Authorization", `Bearer ${await createSession(b.id, sessionSecret, 900)}`)
      .send({ push_token: token });
    expect(removed.status).toBe(204);
    expect(repository.devices).toHaveLength(0);
  });
});
