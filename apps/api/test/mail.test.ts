import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import { encryptSecret, decryptSecret } from "../src/modules/mail/crypto.js";
import { classifyMail, meetingTaskTitle } from "../src/modules/mail/classify.js";
import { MemoryMailGateway } from "../src/modules/mail/gateway.js";
import { inferMailProvider } from "../src/modules/mail/providers.js";
import { isMailDueForSync } from "../src/modules/mail/service.js";
import {
  mailSendCallbackData,
  type AiProvider,
} from "../src/modules/assistant/index.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import {
  CompanionResponseSchema,
  parseCompanionResponse,
} from "../src/modules/assistant/companion.js";

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
  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
    this.sent.push({ chatId, text, options });
  }
  async answerCallbackQuery(id: string) {
    this.callbacks.push(id);
  }
}

const setup = (ai?: AiProvider, mail = new MemoryMailGateway()) => {
  const repository = new InMemoryRepository();
  const telegram = new FakeTelegram();
  return {
    repository,
    telegram,
    mail,
    app: createApp({ repository, telegram, env, ai, mail }),
  };
};

const auth = async (ownerId: string) => ({
  Authorization: `Bearer ${await createSession(ownerId, sessionSecret, 900)}`,
});

describe("mail classification and secrets", () => {
  it("encrypts IMAP secrets and classifies meetings vs newsletters", () => {
    const secretValue = encryptSecret("app-password", sessionSecret);
    expect(secretValue).not.toContain("app-password");
    expect(decryptSecret(secretValue, sessionSecret)).toBe("app-password");
    expect(inferMailProvider("me@yandex.ru")).toBe("yandex");
    expect(
      classifyMail({
        from_address: "boss@company.com",
        subject: "Встреча завтра в Zoom",
        snippet: "Подключайтесь к zoom.us/j/1 завтра в 12:00",
      }).is_meeting,
    ).toBe(true);
    expect(
      classifyMail({
        from_address: "noreply@shop.com",
        subject: "Скидки недели",
        snippet: "Unsubscribe from this newsletter",
      }).is_important,
    ).toBe(false);
    expect(
      classifyMail({
        from_address: "billing@corp.com",
        subject: "Invoice #12",
        snippet: "Please pay the invoice",
      }).is_important,
    ).toBe(true);
    expect(meetingTaskTitle("Re: Weekly sync", "Anna")).toMatch(/Weekly sync/);
  });

  it("defaults companion mail_actions when the model omits them", () => {
    const parsed = CompanionResponseSchema.parse({
      answer: "Ок",
      context_used: [],
      follow_up: null,
      task_actions: [],
      offers: [],
      search_actions: [],
      person_facts: [],
      goal_plan: null,
    });
    expect(parsed.mail_actions).toEqual([]);
  });

  it("keeps extra task_actions instead of wiping the array past the old limit of 5", () => {
    const parsed = CompanionResponseSchema.parse({
      answer: "Записала все дела.",
      task_actions: Array.from({ length: 6 }, (_, index) => ({
        op: "create",
        task_id: null,
        title: `Дело ${index + 1}`,
        due_at: null,
      })),
    });
    expect(parsed.task_actions).toHaveLength(6);
  });

  it("accepts compact companion JSON that omits empty fields", () => {
    const parsed = CompanionResponseSchema.parse({
      answer: "Сегодня три дела: созвон, магазин и отчёт.",
    });
    expect(parsed.answer).toMatch(/три дела/);
    expect(parsed.context_used).toEqual([]);
    expect(parsed.follow_up).toBeNull();
    expect(parsed.task_actions).toEqual([]);
    expect(parsed.offers).toEqual([]);
  });

  it("coerces messy companion JSON instead of dropping the answer", () => {
    const parsed = CompanionResponseSchema.parse({
      answer: "Сегодня три дела.",
      context_used: "tasks",
      offers: { kind: "plan", title: "Набросать план", instruction: "Составь план" },
      search_actions: { type: "web", query: "дела" },
    });
    expect(parsed.answer).toBe("Сегодня три дела.");
    expect(parsed.context_used).toEqual(["tasks"]);
    expect(parsed.offers).toEqual([
      { kind: "plan", title: "Набросать план", instruction: "Составь план" },
    ]);
    expect(parsed.search_actions[0]).toMatchObject({ type: "web", query: "дела" });
  });

  it("keeps the answer when extra companion fields are unusable", () => {
    const parsed = parseCompanionResponse({
      answer: "Давай начнём с просрочки.",
      context_used: "tasks and goals together",
      offers: { broken: true },
      person_facts: { name: 1 },
    });
    expect(parsed.answer).toBe("Давай начнём с просрочки.");
    expect(parsed.context_used).toEqual(["tasks and goals together"]);
    expect(parsed.offers).toEqual([]);
  });
});

describe("mail accounts and sync", () => {
  it("connects through IMAP/SMTP, syncs a meeting into a dated task, and never auto-sends", async () => {
    const gateway = new MemoryMailGateway();
    gateway.inbox = [
      {
        provider_uid: "11",
        from_address: "alex@example.com",
        from_name: "Alex",
        to_address: "me@gmail.com",
        subject: "Встреча завтра",
        snippet: "Zoom call tomorrow about the contract",
        received_at: new Date().toISOString(),
        has_calendar_invite: true,
      },
      {
        provider_uid: "12",
        from_address: "noreply@news.com",
        from_name: null,
        to_address: "me@gmail.com",
        subject: "Weekly digest",
        snippet: "Unsubscribe here",
        received_at: new Date().toISOString(),
        has_calendar_invite: false,
      },
    ];
    const { app, repository, mail } = setup(undefined, gateway);
    const user = await repository.upsertTelegramUser({ telegram_id: 701, name: "Ann" });
    const created = await request(app)
      .post("/api/mail/accounts")
      .set(await auth(user.id))
      .send({ email: "me@gmail.com", password: "app-pass", provider: "gmail" });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe("me@gmail.com");
    expect(created.body.data.secret_cipher).toBeUndefined();
    expect(created.body.data.imap_host).toBe("imap.gmail.com");
    const messages = await request(app).get("/api/mail/messages").set(await auth(user.id));
    expect(messages.body.data.some((item: { is_meeting: boolean }) => item.is_meeting)).toBe(true);
    const tasks = await repository.listTasks(user.id);
    expect(tasks.some((task) => task.title.includes("Встреча"))).toBe(true);
    expect(mail.sent).toHaveLength(0);
    const playbooks = await request(app).get("/api/mail/playbooks").set(await auth(user.id));
    expect(playbooks.body.data.length).toBeGreaterThan(0);
  });

  it("prepares a draft and sends only after explicit confirmation", async () => {
    const gateway = new MemoryMailGateway();
    const { app, repository, mail } = setup(undefined, gateway);
    const user = await repository.upsertTelegramUser({ telegram_id: 702, name: "Ann" });
    await request(app)
      .post("/api/mail/accounts")
      .set(await auth(user.id))
      .send({ email: "me@yandex.ru", password: "app-pass", provider: "yandex" });
    const account = (await repository.listMailAccounts(user.id))[0]!;
    const message = await repository.upsertMailMessage(user.id, {
      account_id: account.id,
      provider_uid: "99",
      from_address: "friend@example.com",
      from_name: "Friend",
      subject: "Can we talk?",
      snippet: "Are you free Thursday?",
      is_important: true,
    });
    const drafted = await request(app)
      .post(`/api/mail/messages/${message.id}/draft`)
      .set(await auth(user.id))
      .send({});
    expect(drafted.status).toBe(201);
    expect(mail.sent).toHaveLength(0);
    const sent = await request(app)
      .post(`/api/mail/drafts/${drafted.body.data.id}/send`)
      .set(await auth(user.id));
    expect(sent.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe("friend@example.com");
    expect((await repository.getMailMessage(user.id, message.id))?.handled).toBe(true);
  });

  it("lets the companion draft a reply and asks Telegram before sending", async () => {
    const gateway = new MemoryMailGateway();
    const ai: AiProvider = {
      async decide() {
        return {
          intent: "companion",
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
      async companion() {
        return {
          answer: "Подготовила короткий ответ.",
          context_used: ["mail"],
          follow_up: null,
          task_actions: [],
          offers: [],
          search_actions: [],
          person_facts: [],
          goal_plan: null,
          mail_actions: [
            {
              op: "send",
              message_id: null,
              draft_id: null,
              account_id: null,
              to: "friend@example.com",
              subject: "Re: Hello",
              body: "Thanks, Thursday works.",
              title: null,
              due_at: null,
            },
          ],
        };
      },
    };
    const { app, repository, telegram, mail } = setup(ai, gateway);
    const user = await repository.upsertTelegramUser({ telegram_id: 703, name: "Ann" });
    await request(app)
      .post("/api/mail/accounts")
      .set(await auth(user.id))
      .send({ email: "me@mail.ru", password: "app-pass", provider: "mailru" });
    await request(app)
      .post("/webhooks/telegram/" + secret)
      .set("x-telegram-bot-api-secret-token", secret)
      .send({
        update_id: 80,
        message: {
          message_id: 80,
          text: "/companion",
          chat: { id: 703 },
          from: { id: 703, first_name: "Ann" },
        },
      });
    await request(app)
      .post("/webhooks/telegram/" + secret)
      .set("x-telegram-bot-api-secret-token", secret)
      .send({
        update_id: 81,
        message: {
          message_id: 81,
          text: "отправь ответ другу",
          chat: { id: 703 },
          from: { id: 703, first_name: "Ann" },
        },
      });
    expect(mail.sent).toHaveLength(0);
    const last = telegram.sent.at(-1);
    expect(last?.text).toMatch(/ответ/i);
    const keyboard = (
      last?.options as { reply_markup?: { inline_keyboard?: { callback_data: string }[][] } }
    )?.reply_markup?.inline_keyboard;
    const confirm = keyboard?.flat().find((button) => button.callback_data.startsWith("ms:"));
    expect(confirm?.callback_data).toMatch(/^ms:/);
    const pending = repository.pendingActions.find((item) => item.action === "send_mail");
    expect(pending).toBeTruthy();
    await request(app)
      .post("/webhooks/telegram/" + secret)
      .set("x-telegram-bot-api-secret-token", secret)
      .send({
        update_id: 82,
        callback_query: {
          id: "mail-send",
          data: mailSendCallbackData(pending!.id, "confirm"),
          from: { id: 703, first_name: "Ann" },
          message: { message_id: 82, chat: { id: 703 } },
        },
      });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.subject).toBe("Re: Hello");
  });

  it("exports mail without secrets and wipes it on account delete", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 704, name: "Ann" });
    await request(app)
      .post("/api/mail/accounts")
      .set(await auth(user.id))
      .send({ email: "me@gmail.com", password: "super-secret", provider: "gmail" });
    const exported = await request(app).get("/api/account/export").set(await auth(user.id));
    expect(exported.body.data.mail_accounts[0].email).toBe("me@gmail.com");
    expect(JSON.stringify(exported.body.data)).not.toContain("super-secret");
    expect(exported.body.data.mail_accounts[0].secret_cipher).toBeUndefined();
    await request(app).delete("/api/account").set(await auth(user.id));
    expect(repository.mailAccounts).toHaveLength(0);
  });

  it("runs mail sync from the external cron", async () => {
    const gateway = new MemoryMailGateway();
    gateway.inbox = [
      {
        provider_uid: "1",
        from_address: "hr@corp.com",
        from_name: "HR",
        to_address: "me@gmail.com",
        subject: "Action required: contract",
        snippet: "Please sign the договор today",
        received_at: new Date().toISOString(),
        has_calendar_invite: false,
      },
    ];
    const { app, repository } = setup(undefined, gateway);
    const user = await repository.upsertTelegramUser({ telegram_id: 705, name: "Ann" });
    await request(app)
      .post("/api/mail/accounts")
      .set(await auth(user.id))
      .send({ email: "me@gmail.com", password: "app-pass", provider: "gmail" });
    repository.mailAccounts[0]!.last_synced_at = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    const sync = await request(app)
      .post("/internal/mail-sync")
      .set("x-cron-secret", env.CRON_SECRET);
    expect(sync.status).toBe(200);
    expect(sync.body.data.synced).toBeGreaterThan(0);
  });

  it("skips a mailbox that was just synced and retries it from the app", async () => {
    const { app, repository } = setup();
    const user = await repository.upsertTelegramUser({ telegram_id: 706, name: "Ann" });
    await request(app)
      .post("/api/mail/accounts")
      .set(await auth(user.id))
      .send({ email: "me@gmail.com", password: "app-pass", provider: "gmail" });
    const cron = await request(app)
      .post("/internal/mail-sync")
      .set("x-cron-secret", env.CRON_SECRET);
    expect(cron.body.data.synced).toBe(0);
    repository.mailAccounts[0]!.last_synced_at = new Date(Date.now() - 3 * 60_000).toISOString();
    const opened = await request(app).post("/api/mail/sync").set(await auth(user.id));
    expect(opened.status).toBe(200);
    expect(opened.body.data.synced).toBeGreaterThan(0);
  });
});

describe("mail sync cadence", () => {
  it("treats failed or stale mailboxes as due and keeps a fresh one", () => {
    expect(isMailDueForSync({ status: "active", last_synced_at: null })).toBe(true);
    expect(isMailDueForSync({ status: "error", last_synced_at: new Date().toISOString() })).toBe(true);
    expect(
      isMailDueForSync({
        status: "active",
        last_synced_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      }),
    ).toBe(false);
    expect(
      isMailDueForSync({
        status: "active",
        last_synced_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
      }),
    ).toBe(true);
  });
});
