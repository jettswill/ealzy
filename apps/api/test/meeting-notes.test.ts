import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import { recentMeetingNotes } from "../src/modules/assistant/meeting-notes.js";
import { compactMeetingNotes } from "../src/modules/assistant/companion-workspace.js";
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

async function setup() {
  const repository = new InMemoryRepository();
  const app = createApp({ repository, telegram, env });
  const user = await repository.upsertTelegramUser({ telegram_id: 11, name: "A" });
  const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
  return { repository, app, user, auth };
}

const meeting = {
  external_id: "ABC:123",
  starts_at: "2026-11-18T16:00:00+03:00",
  ends_at: "2026-11-18T17:00:00+03:00",
  title: "Созвон с Петей",
};

describe("meeting notes", () => {
  it("saves notes from a meeting into regular notes and reopens them by the event", async () => {
    const { repository, app, user, auth } = await setup();
    const empty = await request(app)
      .get("/api/calendar/meeting-note")
      .set(auth)
      .query({ external_id: meeting.external_id, starts_at: meeting.starts_at });
    expect(empty.status).toBe(200);
    expect(empty.body.data).toBeNull();

    const first = await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({
        ...meeting,
        body: "Договорились:\nПетя шлёт смету",
        client_mutation_id: randomUUID(),
      });
    expect(first.status).toBe(200);
    expect(first.body.data.revision).toBe(1);

    const second = await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({
        ...meeting,
        starts_at: "2026-11-18T13:00:00Z",
        body: "Договорились:\nПетя шлёт смету до пятницы",
        client_mutation_id: randomUUID(),
      });
    expect(second.body.data.note_id).toBe(first.body.data.note_id);
    expect(second.body.data.revision).toBe(2);

    const notes = await repository.listNotes(user.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toMatch(/^Встреча: Созвон с Петей · 18 ноя/);
    expect(notes[0]!.plain_text).toBe("Договорились:\nПетя шлёт смету до пятницы");
    expect(notes[0]!.content).toMatchObject({ type: "doc" });

    const reopened = await request(app)
      .get("/api/calendar/meeting-note")
      .set(auth)
      .query({ external_id: meeting.external_id, starts_at: "2026-11-18T13:00:00.000Z" });
    expect(reopened.body.data.body).toBe("Договорились:\nПетя шлёт смету до пятницы");

    // Повтор той же встречи на следующей неделе — своя заметка.
    await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({
        ...meeting,
        starts_at: "2026-11-25T16:00:00+03:00",
        ends_at: "2026-11-25T17:00:00+03:00",
        body: "Вторая встреча",
        client_mutation_id: randomUUID(),
      });
    expect(await repository.listNotes(user.id)).toHaveLength(2);
  });

  it("wins over a parallel edit on the website", async () => {
    const { repository, app, user, auth } = await setup();
    const first = await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({ ...meeting, body: "раз", client_mutation_id: randomUUID() });
    await repository.mutateNote(user.id, first.body.data.note_id, {
      base_revision: 1,
      client_mutation_id: randomUUID(),
      title: "правка с сайта",
      content: {},
      plain_text: "с сайта",
    });
    const next = await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({ ...meeting, body: "два", client_mutation_id: randomUUID() });
    expect(next.status).toBe(200);
    expect(next.body.data.body).toBe("два");
    expect(next.body.data.revision).toBe(3);
  });

  it("gives Ilzi fresh meeting notes in local time", async () => {
    const { repository, app, user, auth } = await setup();
    const now = new Date();
    const start = new Date(now.getTime() - 3600_000).toISOString();
    await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({
        ...meeting,
        starts_at: start,
        ends_at: now.toISOString(),
        body: "Петя шлёт смету",
        client_mutation_id: randomUUID(),
      });
    await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({
        ...meeting,
        external_id: "blank",
        starts_at: start,
        ends_at: now.toISOString(),
        body: "   ",
        client_mutation_id: randomUUID(),
      });
    const context = await recentMeetingNotes(repository, user.id);
    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({ title: "Созвон с Петей", notes: "Петя шлёт смету" });
    const compact = compactMeetingNotes(context, "Europe/Moscow");
    expect(compact[0]).toMatchObject({ meeting: "Созвон с Петей", notes: "Петя шлёт смету" });
    expect(compact[0]!.start).toMatch(/^\d{2}:\d{2}$/);
  });

  it("rejects a bad request", async () => {
    const { app, auth } = await setup();
    const bad = await request(app)
      .put("/api/calendar/meeting-note")
      .set(auth)
      .send({ ...meeting, body: "x" });
    expect(bad.status).toBe(400);
  });
});
