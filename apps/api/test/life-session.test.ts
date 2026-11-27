import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  fallbackProposal,
  groundedDue,
  normalizeProposal,
  type LifeContext,
} from "../src/modules/assistant/life-session.js";
import type { AiProvider } from "../src/modules/assistant/index.js";
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

function baseAi(extra: Partial<AiProvider>): AiProvider {
  return {
    async decide() {
      return { intent: "other" };
    },
    async recommend() {
      return [];
    },
    ...extra,
  };
}

async function setup(ai?: AiProvider) {
  const repository = new InMemoryRepository();
  const app = createApp({ repository, telegram, env, ai });
  const user = await repository.upsertTelegramUser({ telegram_id: 21, name: "A" });
  const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
  return { repository, app, user, auth };
}

const context: LifeContext = {
  now_local: "27 ноября, 10:00",
  weekday: "пятница",
  timezone: "Europe/Moscow",
  today: "2026-11-27",
  goals: [],
  open_tasks: [],
  calendar: [],
  previous_sessions: [],
};

describe("life session", () => {
  it("keeps a deadline only when the user said it", () => {
    const now = new Date("2026-11-27T07:00:00Z");
    const said = "надо до пятницы следующей отправить смету, и когда-нибудь выучить испанский";
    expect(
      groundedDue({ due_phrase: "до пятницы", due_date: "2026-12-04" }, said, "Europe/Moscow", now),
    ).toMatch(/^2026-12-04T09:00:00/);
    // Модель придумала срок — во фразах человека его нет.
    expect(
      groundedDue(
        { due_phrase: "к понедельнику", due_date: "2026-11-30" },
        said,
        "Europe/Moscow",
        now,
      ),
    ).toBeNull();
    expect(
      groundedDue({ due_phrase: null, due_date: "2026-11-30" }, said, "Europe/Moscow", now),
    ).toBeNull();
  });

  it("turns a repeat of an existing task into an update and drops unknown ids", () => {
    const withTask: LifeContext = {
      ...context,
      goals: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Английский до B2",
          horizon: "medium",
          plan: null,
          open_tasks: 0,
          done_tasks: 0,
        },
      ],
      open_tasks: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Позвонить Пете про смету",
          due: null,
          estimate_minutes: null,
          goal_id: null,
          importance: 3,
          urgency: 3,
          kind: "task",
        },
      ],
    };
    const proposal = normalizeProposal(
      {
        summary: "Услышала.",
        reflection: null,
        goals: [
          {
            key: "g1",
            op: "create",
            goal_id: null,
            title: "Английский до B2",
            horizon: "medium",
            why: null,
          },
          {
            key: "g2",
            op: "touch",
            goal_id: "33333333-3333-4333-8333-333333333333",
            title: "Нет такой",
            horizon: null,
            why: null,
          },
        ],
        tasks: [
          {
            key: "t1",
            title: "Позвонить Пете про смету",
            description: null,
            bucket: "now",
            due_phrase: null,
            due_date: null,
            estimate_minutes: 10,
            sphere: "work",
            goal_key: null,
            importance: 4,
            urgency: 4,
            assignee: "user",
            existing_task_id: null,
          },
          {
            key: "t2",
            title: "Записаться на пробный урок английского",
            description: null,
            bucket: "week",
            due_phrase: null,
            due_date: null,
            estimate_minutes: null,
            sphere: "growth",
            goal_key: "g1",
            importance: 3,
            urgency: 2,
            assignee: "user",
            existing_task_id: null,
          },
          {
            key: "t3",
            title: "записаться на пробный урок английского!",
            description: null,
            bucket: "later",
            due_phrase: null,
            due_date: null,
            estimate_minutes: null,
            sphere: "growth",
            goal_key: null,
            importance: 3,
            urgency: 2,
            assignee: "user",
            existing_task_id: null,
          },
        ],
        thoughts: ["Устал от работы"],
        now: {
          task_key: "t1",
          reason: "Пять минут, и смета сдвинется",
          first_step: "Открыть контакт Пети",
        },
        alignment: null,
        questions: [],
      },
      withTask,
      "позвонить Пете про смету, и хочу наконец английский",
    );
    expect(proposal.goals).toHaveLength(1);
    expect(proposal.goals[0]).toMatchObject({
      op: "touch",
      goal_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(proposal.tasks.map((task) => task.key)).toEqual(["t1", "t2"]);
    expect(proposal.tasks[0]!.existing_task_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(proposal.now?.task_key).toBe("t1");
  });

  it("falls back to a plain list when there is no model", () => {
    const proposal = fallbackProposal("Купить корм коту. Позвонить маме\nОтправить смету");
    expect(proposal.tasks.map((task) => task.title)).toEqual([
      "Купить корм коту.",
      "Позвонить маме",
      "Отправить смету",
    ]);
  });

  it("proposes, then creates only what the user accepted, and keeps thoughts in a note", async () => {
    let seen: { mode: string; transcript: string } | null = null;
    const ai = baseAi({
      async lifeSession(input) {
        seen = { mode: input.mode, transcript: input.transcript };
        return {
          summary: "Ты хочешь свой бизнес и устал от рутины. Разложила.",
          reflection: null,
          goals: [
            {
              key: "g1",
              op: "create",
              goal_id: null,
              title: "Запустить свой бизнес",
              horizon: "long",
              why: "свобода",
            },
          ],
          tasks: [
            {
              key: "t1",
              title: "Набросать одну страницу про идею бизнеса",
              description: null,
              bucket: "now",
              due_phrase: null,
              due_date: null,
              estimate_minutes: 30,
              sphere: "work",
              goal_key: "g1",
              importance: 4,
              urgency: 3,
              assignee: "user",
              existing_task_id: null,
            },
            {
              key: "t2",
              title: "Купить корм коту",
              description: null,
              bucket: "today",
              due_phrase: null,
              due_date: null,
              estimate_minutes: 15,
              sphere: "home",
              goal_key: null,
              importance: 3,
              urgency: 4,
              assignee: "user",
              existing_task_id: null,
            },
            {
              key: "t3",
              title: "Сравнить курсы по маркетингу",
              description: null,
              bucket: "later",
              due_phrase: null,
              due_date: null,
              estimate_minutes: null,
              sphere: "growth",
              goal_key: "g1",
              importance: 2,
              urgency: 2,
              assignee: "ealzy",
              existing_task_id: null,
            },
          ],
          thoughts: ["Боюсь, что не потяну"],
          now: {
            task_key: "t1",
            reason: "Это двигает главную цель",
            first_step: "Открыть заметки",
          },
          alignment: "Корм — быт, бизнес — к цели.",
          questions: ["Сколько часов в неделю готов давать бизнесу?"],
        };
      },
    });
    const { repository, app, user, auth } = await setup(ai);
    const created = await request(app)
      .post("/api/sessions")
      .set(auth)
      .send({
        mode: "strategy",
        text: "хочу свой бизнес, корм коту купить, курсы по маркетингу глянуть",
      });
    expect(created.status).toBe(201);
    expect(seen).toMatchObject({ mode: "strategy" });
    expect(created.body.data.proposal.tasks).toHaveLength(3);
    expect(await repository.listTasks(user.id)).toHaveLength(0);

    const applied = await request(app)
      .post(`/api/sessions/${created.body.data.id}/apply`)
      .set(auth)
      .send({ tasks: [{ key: "t1" }, { key: "t2", bucket: "week" }], goals: ["g1"] });
    expect(applied.status).toBe(200);
    const tasks = await repository.listTasks(user.id);
    expect(tasks.map((task) => task.title).sort()).toEqual([
      "Купить корм коту",
      "Набросать одну страницу про идею бизнеса",
    ]);
    const goals = await repository.listGoals(user.id);
    expect(goals.map((goal) => goal.title)).toEqual(["Запустить свой бизнес"]);
    const main = tasks.find((task) => task.title.startsWith("Набросать"))!;
    expect(main.goal_id).toBe(goals[0]!.id);
    expect(main.due_at).not.toBeNull(); // «сейчас» — на сегодня
    expect(applied.body.data.now_task_id).toBe(main.id);
    // Человек перенёс корм на неделю — срока нет, его никто не называл.
    expect(tasks.find((task) => task.title === "Купить корм коту")!.due_at).toBeNull();

    const notes = await repository.listNotes(user.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toMatch(/^Стратегическая сессия · /);
    expect(notes[0]!.plain_text).toContain("Боюсь, что не потяну");
    expect(notes[0]!.plain_text).toContain("хочу свой бизнес");

    // Повторное «принять» ничего не дублирует.
    await request(app)
      .post(`/api/sessions/${created.body.data.id}/apply`)
      .set(auth)
      .send({ tasks: [{ key: "t1" }], goals: ["g1"] });
    expect(await repository.listTasks(user.id)).toHaveLength(2);

    const list = await request(app).get("/api/sessions").set(auth);
    expect(list.body.data[0].applied_at).not.toBeNull();
  });

  it("works without a model and suggests what to do now by rules", async () => {
    const { repository, app, user, auth } = await setup();
    const created = await request(app)
      .post("/api/sessions")
      .set(auth)
      .send({ text: "Купить корм коту. Позвонить маме" });
    expect(created.body.data.proposal.tasks).toHaveLength(2);
    await repository.createTask(user.id, {
      title: "Отправить смету",
      importance: 5,
      urgency: 5,
      due_at: new Date().toISOString(),
    });
    const focus = await request(app).post("/api/focus/now").set(auth).send({});
    expect(focus.status).toBe(200);
    expect(focus.body.data).toMatchObject({ title: "Отправить смету", source: "rule" });
  });

  it("transcribes an uploaded recording", async () => {
    const ai = baseAi({
      async transcribe(file) {
        expect(file.mime).toBe("audio/mp4");
        expect(file.bytes.byteLength).toBe(4);
        return "купить корм коту";
      },
    });
    const { app, auth } = await setup(ai);
    const res = await request(app)
      .post("/api/sessions/transcribe")
      .set(auth)
      .set("content-type", "audio/mp4")
      .send(Buffer.from([1, 2, 3, 4]));
    expect(res.status).toBe(200);
    expect(res.body.data.text).toBe("купить корм коту");
  });
});
