import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createSession } from "../src/modules/auth/index.js";
import type { AiProvider } from "../src/modules/assistant/index.js";
import { InMemoryRepository } from "../src/repository.js";
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
  async sendMessage() {
    return undefined;
  },
  async answerCallbackQuery() {
    return undefined;
  },
};
const auth = async (ownerId: string) => ({
  Authorization: `Bearer ${await createSession(ownerId, sessionSecret, 900)}`,
});
const ai = (proposal: unknown): AiProvider => ({
  async decide() {
    return {};
  },
  async recommend() {
    return [];
  },
  async previewNoteAction() {
    return proposal;
  },
});

describe("offline-first notes", () => {
  it("creates and updates idempotently, reports conflicts, and tombstones", async () => {
    const repository = new InMemoryRepository();
    const app = createApp({ repository, telegram, env });
    const first = await repository.upsertTelegramUser({ telegram_id: 1, name: "A" });
    const second = await repository.upsertTelegramUser({ telegram_id: 2, name: "B" });
    const headers = await auth(first.id);
    const noteId = randomUUID();
    const createMutation = {
      base_revision: 0,
      client_mutation_id: randomUUID(),
      title: "Черновик",
      content: { type: "doc", content: [] },
      plain_text: "Первый текст",
    };

    const created = await request(app)
      .put(`/api/notes/${noteId}`)
      .set(headers)
      .send(createMutation);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: noteId,
      title: "Черновик",
      revision: 1,
      deleted_at: null,
    });

    const repeated = await request(app)
      .put(`/api/notes/${noteId}`)
      .set(headers)
      .send(createMutation);
    expect(repeated.status).toBe(201);
    expect(repeated.body.data.revision).toBe(1);
    expect(await repository.listNoteRevisions(first.id)).toEqual([
      expect.objectContaining({ title: "Черновик" }),
    ]);

    const updated = await request(app)
      .put(`/api/notes/${noteId}`)
      .set(headers)
      .send({
        ...createMutation,
        base_revision: 1,
        client_mutation_id: randomUUID(),
        title: "Готовая заметка",
        plain_text: "Второй текст",
      });
    expect(updated.body.data.revision).toBe(2);

    const conflict = await request(app)
      .put(`/api/notes/${noteId}`)
      .set(headers)
      .send({ ...createMutation, client_mutation_id: randomUUID() });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.details.server_note).toMatchObject({
      revision: 2,
      title: "Готовая заметка",
      plain_text: "Второй текст",
    });

    const hidden = await request(app)
      .get("/api/notes")
      .set(await auth(second.id));
    expect(hidden.body.data).toEqual([]);

    const deleted = await request(app)
      .delete(`/api/notes/${noteId}`)
      .set(headers)
      .send({ base_revision: 2, client_mutation_id: randomUUID() });
    expect(deleted.body.data).toMatchObject({ revision: 3 });
    expect(deleted.body.data.deleted_at).toBeTruthy();
    expect(await repository.listNoteRevisions(first.id)).toHaveLength(3);

    const exported = await request(app).get("/api/account/export").set(headers);
    expect(exported.body.data.notes).toHaveLength(1);
    expect(exported.body.data.note_revisions).toHaveLength(3);
    expect(exported.body.data.note_actions).toEqual([]);
  });

  it("previews without domain writes and confirms each action exactly once", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 3, name: "A" });
    const app = createApp({
      repository,
      telegram,
      env,
      ai: ai({
        kind: "plan",
        title: "Запуск",
        description: null,
        current_plan: "Сначала проверить спрос",
        tasks: [{ title: "Провести интервью", description: null, due_at: null }],
      }),
    });
    const headers = await auth(user.id);
    const noteId = randomUUID();
    await request(app)
      .put(`/api/notes/${noteId}`)
      .set(headers)
      .send({
        base_revision: 0,
        client_mutation_id: randomUUID(),
        title: "План запуска",
        content: { type: "doc" },
        plain_text: "План запуска",
      });

    const preview = await request(app)
      .post(`/api/notes/${noteId}/actions/preview`)
      .set(headers)
      .send({ instruction: "Сделай план по этой заметке" });
    expect(preview.status).toBe(201);
    expect(await repository.listGoals(user.id)).toHaveLength(0);
    expect(await repository.listTasks(user.id)).toHaveLength(0);

    const invalid = await request(app)
      .post(`/api/note-actions/${preview.body.data.id}/confirm`)
      .set(headers)
      .send({
        proposal: {
          kind: "plan",
          goal_id: randomUUID(),
          current_plan: "Устаревший формат",
          tasks: [],
        },
      });
    expect(invalid.status).toBe(400);
    expect(await repository.listGoals(user.id)).toHaveLength(0);

    const editedProposal = {
      kind: "plan",
      title: "Запуск после интервью",
      description: "Отредактировано пользователем",
      current_plan: "Сначала провести пять интервью",
      tasks: [{ title: "Провести 5 интервью", description: null, due_at: null }],
    };
    const first = await request(app)
      .post(`/api/note-actions/${preview.body.data.id}/confirm`)
      .set(headers)
      .send({ proposal: editedProposal });
    const second = await request(app)
      .post(`/api/note-actions/${preview.body.data.id}/confirm`)
      .set(headers)
      .send({
        proposal: { kind: "goal", goal: { title: "Не должна создаться", description: null } },
      });
    expect(first.body.data.status).toBe("confirmed");
    expect(second.body.data.result).toEqual(first.body.data.result);
    expect(second.body.data.proposal).toEqual(editedProposal);
    const goals = await repository.listGoals(user.id);
    expect(goals).toEqual([
      expect.objectContaining({
        title: "Запуск после интервью",
        description: "Отредактировано пользователем",
        current_plan: "Сначала провести пять интервью",
        source_note_id: noteId,
      }),
    ]);
    expect(await repository.listTasks(user.id)).toEqual([
      expect.objectContaining({ goal_id: goals[0]!.id, source_note_id: noteId }),
    ]);
  });

  it.each([
    ["goal", { kind: "goal", goal: { title: "Новая цель", description: null } }, "goal_id"],
    [
      "tasks",
      { kind: "tasks", tasks: [{ title: "Одна задача", description: null, due_at: null }] },
      "task_ids",
    ],
  ])("confirms a %s proposal", async (_kind, proposal, resultKey) => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({
      telegram_id: Math.floor(Math.random() * 1_000_000) + 10,
      name: "A",
    });
    const app = createApp({ repository, telegram, env, ai: ai(proposal) });
    const headers = await auth(user.id);
    const noteId = randomUUID();
    await request(app).put(`/api/notes/${noteId}`).set(headers).send({
      base_revision: 0,
      client_mutation_id: randomUUID(),
      title: "",
      content: {},
      plain_text: "Черновик",
    });
    const preview = await request(app)
      .post(`/api/notes/${noteId}/actions/preview`)
      .set(headers)
      .send({ instruction: "Выполни" });
    const confirmed = await request(app)
      .post(`/api/note-actions/${preview.body.data.id}/confirm`)
      .set(headers)
      .send({});
    expect(confirmed.body.data.result).toHaveProperty(resultKey);
  });
});
