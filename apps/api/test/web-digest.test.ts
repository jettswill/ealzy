import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import { composeDigestText } from "../src/modules/assistant/scheduled-messages.js";

describe("сводка дня для веба", () => {
  it("собирается для пользователя без Telegram", async () => {
    const repository = new InMemoryRepository();
    // Вход через OAuth: telegram_id нет, а значит ни одно проактивное сообщение
    // до человека не доходит — сводку он может только увидеть на экране.
    const owner = (await repository.upsertTelegramUser({ telegram_id: 21, name: "A" })).id;
    const profile = (await repository.getProfile(owner))!;
    const at = new Date("2026-09-23T06:00:00.000Z");
    await repository.createTask(owner, {
      title: "Дописать квартальный отчёт",
      due_at: "2026-09-23T09:00:00.000Z",
    });
    await repository.createTask(owner, {
      title: "Записать Лёву к стоматологу",
      due_at: "2026-09-23T12:00:00.000Z",
    });

    const text = await composeDigestText(repository, profile, "morning_digest", at);

    expect(text).toContain("Дописать квартальный отчёт");
    expect(text).toContain("Записать Лёву к стоматологу");
  });

  it("не падает на пустом аккаунте", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 22, name: "B" })).id;
    const profile = (await repository.getProfile(owner))!;
    const text = await composeDigestText(
      repository,
      profile,
      "morning_digest",
      new Date("2026-09-23T06:00:00.000Z"),
    );
    expect(typeof text).toBe("string");
  });
});
