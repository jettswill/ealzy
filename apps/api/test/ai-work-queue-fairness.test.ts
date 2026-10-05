import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";

const HOUR = 60 * 60 * 1000;

async function seed(repository: InMemoryRepository, telegramId: number) {
  return (await repository.upsertTelegramUser({ telegram_id: telegramId, name: "U" })).id;
}

describe("очередь «Поручить Ealzy»", () => {
  it("зависшая задача одного пользователя не блокирует остальных", async () => {
    const repository = new InMemoryRepository();
    const stuck = await seed(repository, 401);
    const other = await seed(repository, 402);
    const now = new Date("2026-09-23T10:00:00.000Z");

    const stuckTask = await repository.createTask(stuck, {
      title: "Зависшее поручение",
      assignee: "ealzy",
      due_at: new Date(now.getTime() - HOUR).toISOString(),
    });
    // Свежая блокировка: задача взята в работу минуту назад и ещё не протухла.
    await repository.updateTask(stuck, stuckTask.id, {
      status: "in_progress",
      agent_locked_at: new Date(now.getTime() - 60_000).toISOString(),
    });
    const waiting = await repository.createTask(other, {
      title: "Поручение другого человека",
      assignee: "ealzy",
      due_at: new Date(now.getTime() - HOUR).toISOString(),
    });

    const claimed = await repository.claimNextAiWork(now);
    expect(claimed?.id).toBe(waiting.id);
    expect(claimed?.owner_id).toBe(other);
  });

  it("но у одного владельца по-прежнему одно дело за раз", async () => {
    const repository = new InMemoryRepository();
    const owner = await seed(repository, 403);
    const now = new Date("2026-09-23T10:00:00.000Z");

    const busy = await repository.createTask(owner, {
      title: "Уже в работе",
      assignee: "ealzy",
      due_at: new Date(now.getTime() - HOUR).toISOString(),
    });
    await repository.updateTask(owner, busy.id, {
      status: "in_progress",
      agent_locked_at: new Date(now.getTime() - 60_000).toISOString(),
    });
    await repository.createTask(owner, {
      title: "Ждёт своей очереди",
      assignee: "ealzy",
      due_at: new Date(now.getTime() - HOUR).toISOString(),
    });

    expect(await repository.claimNextAiWork(now)).toBeNull();
  });

  it("блокировка конкретного владельца видна отдельно", async () => {
    const repository = new InMemoryRepository();
    const first = await seed(repository, 404);
    const second = await seed(repository, 405);
    const now = new Date("2026-09-23T10:00:00.000Z");
    const task = await repository.createTask(first, { title: "В работе", assignee: "ealzy" });
    await repository.updateTask(first, task.id, {
      status: "in_progress",
      agent_locked_at: new Date(now.getTime() - 60_000).toISOString(),
    });
    expect(await repository.hasFreshAiWorkLock(now, undefined, first)).toBe(true);
    expect(await repository.hasFreshAiWorkLock(now, undefined, second)).toBe(false);
  });
});
