import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  applyBrainDump,
  BRAIN_DUMP_ACTION,
  composeFirstMove,
  finishOnboardingActivation,
  handleBrainDumpReply,
  inferValues,
  parseBrainDump,
} from "../src/modules/assistant/first-session.js";

describe("first session activation", () => {
  it("parses a comma list onto today and skips a one-off skip phrase", () => {
    const parsed = parseBrainDump(
      "позвонить маме, оплатить счета, дописать оффер",
      "Europe/Moscow",
      new Date("2026-09-04T12:00:00.000Z"),
    );
    expect(parsed.map((item) => item.title)).toEqual([
      "позвонить маме",
      "оплатить счета",
      "дописать оффер",
    ]);
    expect(parsed.every((item) => item.due_at?.startsWith("2026-09-04"))).toBe(true);
    expect(parseBrainDump("позже", "Europe/Moscow")).toEqual([]);
  });

  it("names the active goal in the first Ilzi move", () => {
    expect(
      composeFirstMove({
        goalTitle: "Запустить лендинг",
        values: ["спокойствие"],
        locale: "ru",
      }),
    ).toMatch(/Запустить лендинг/);
    expect(composeFirstMove({ goalTitle: "Ship the landing", locale: "en" })).toMatch(
      /Ship the landing/,
    );
    expect(inferValues("мне важно спокойствие и здоровье")).toEqual(["спокойствие", "здоровье"]);
  });

  it("captures tasks under the goal, a promise, and writes a weekly plan", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 88, name: "A" })).id;
    await repository.createGoal(owner, { title: "Запустить лендинг" });
    const first = await finishOnboardingActivation(repository, owner, 88, "ru");
    expect(first).toMatch(/Запустить лендинг/);
    expect(first).toMatch(/дел из головы/);
    expect(await repository.findActivePendingAction(owner, 88, BRAIN_DUMP_ACTION)).toBeTruthy();
    const goal = (await repository.listGoals(owner))[0];
    expect(goal?.current_plan).toMatch(/этой неделе/);
    expect((await repository.getProfile(owner))?.weekly_reflection_enabled).toBe(true);
    expect((await repository.getProfile(owner))?.weekly_digest_enabled).toBe(true);

    const pending = (await repository.findActivePendingAction(owner, 88, BRAIN_DUMP_ACTION))!;
    const dump = await handleBrainDumpReply(
      repository,
      owner,
      pending,
      "позвонить маме, оплатить счета\nобещаю ложиться до 23:30",
    );
    expect(dump.handled).toBe(true);
    expect(dump.tasks.map((task) => task.title)).toEqual(["позвонить маме", "оплатить счета"]);
    expect(dump.tasks[0]?.goal_id).toBe(goal?.id);
    expect(dump.promise?.title).toMatch(/23:30/);
    expect(dump.reply).toMatch(/сегодня/);
    expect(await repository.findActivePendingAction(owner, 88, BRAIN_DUMP_ACTION)).toBeNull();
  });

  it("leaves a long conversational reply for the companion", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 89, name: "A" })).id;
    await finishOnboardingActivation(repository, owner, 89, "ru");
    const pending = (await repository.findActivePendingAction(owner, 89, BRAIN_DUMP_ACTION))!;
    const dump = await handleBrainDumpReply(
      repository,
      owner,
      pending,
      "Я пока не готов выгружать список, давай сначала поговорим про то, как я вообще живу и что меня сейчас держит в напряжении каждый вечер.",
    );
    expect(dump.handled).toBe(false);
    expect(await repository.findActivePendingAction(owner, 89, BRAIN_DUMP_ACTION)).toBeTruthy();
  });

  it("dates dumped work for today even without a pending telegram action", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 90, name: "A" })).id;
    await repository.updateProfile(owner, { timezone: "UTC" });
    const result = await applyBrainDump(
      repository,
      owner,
      "купить хлеб, забрать почту",
      new Date("2026-09-04T08:00:00.000Z"),
    );
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((task) => task.due_at?.startsWith("2026-09-04"))).toBe(true);
  });

  it("dates an evening dump onto tomorrow", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-04T08:00:00.000Z"));
    try {
      const repository = new InMemoryRepository();
      const owner = (await repository.upsertTelegramUser({ telegram_id: 91, name: "A" })).id;
      await repository.updateProfile(owner, { timezone: "UTC" });
      const pending = await repository.createPendingAction(owner, {
        telegram_chat_id: 91,
        action: BRAIN_DUMP_ACTION,
        payload: { kind: BRAIN_DUMP_ACTION, due: "tomorrow" },
        expires_at: "2026-09-05T12:00:00.000Z",
      });
      const dump = await handleBrainDumpReply(
        repository,
        owner,
        pending,
        "позвонить маме, оплатить счета",
      );
      expect(dump.handled).toBe(true);
      expect(dump.tasks.every((task) => task.due_at?.startsWith("2026-09-05"))).toBe(true);
      expect(dump.reply).toMatch(/завтра/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a fallback goal and dump when mini-app finishes without a chat id", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 92, name: "A" })).id;
    const first = await finishOnboardingActivation(repository, owner, null, "ru");
    expect(first).toMatch(/Навести порядок в дне/);
    expect(first).toMatch(/дел из головы/);
    expect((await repository.listGoals(owner)).map((goal) => goal.title)).toEqual([
      "Навести порядок в дне",
    ]);
    expect(await repository.findActivePendingAction(owner, 92, BRAIN_DUMP_ACTION)).toBeTruthy();
    expect((await repository.getProfile(owner))?.weekly_digest_enabled).toBe(true);
  });
});
