import { describe, expect, it } from "vitest";
import { localMidday } from "../src/time.js";
import { parseTaskText } from "../src/modules/import/text.js";
import { InMemoryRepository } from "../src/repository.js";
import { applyBrainDump } from "../src/modules/assistant/first-session.js";

// Час дня в поясе пользователя — то, что он реально увидит в списке дел.
function localHour(iso: string, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso)),
  );
}

describe("середина дня считается по поясу человека", () => {
  it("даёт полдень в Москве, Тбилиси и Владивостоке", () => {
    for (const zone of ["Europe/Moscow", "Asia/Tbilisi", "Asia/Vladivostok", "America/New_York"]) {
      expect(localHour(localMidday("2026-10-03", zone), zone)).toBe(12);
    }
  });

  it("не уезжает в соседние сутки", () => {
    for (const zone of ["Asia/Vladivostok", "Pacific/Auckland", "America/Los_Angeles"]) {
      const iso = localMidday("2026-10-03", zone);
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso));
      expect(day).toBe("2026-10-03");
    }
  });

  it("переживает переход на летнее время", () => {
    // В ночь на 25 октября 2026 Берлин переводит часы назад.
    expect(localHour(localMidday("2026-10-24", "Europe/Berlin"), "Europe/Berlin")).toBe(12);
    expect(localHour(localMidday("2026-10-25", "Europe/Berlin"), "Europe/Berlin")).toBe(12);
  });

  it("откатывается на UTC на мусорном поясе", () => {
    expect(localMidday("2026-10-03", "Moon/Base")).toBe("2026-10-03T12:00:00.000Z");
    expect(localMidday("2026-10-03", "")).toBe("2026-10-03T12:00:00.000Z");
  });
});

describe("сроки дел, созданных без времени", () => {
  it("разбор текста ставит полдень по поясу, а не 12:00 UTC", () => {
    const now = new Date("2026-10-01T06:00:00.000Z");
    const [task] = parseTaskText("Отправить смету завтра", now, "Asia/Vladivostok");
    expect(task?.due_at).toBeTruthy();
    expect(localHour(task!.due_at!, "Asia/Vladivostok")).toBe(12);
  });

  it("выгрузка головы не роняет дела на вечер", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 31, name: "A" })).id;
    await repository.updateProfile(owner, { timezone: "Asia/Vladivostok" });
    const result = await applyBrainDump(repository, owner, "Дописать отчёт\nЗаписать сына к врачу");
    expect(result.tasks.length).toBeGreaterThan(0);
    for (const task of result.tasks) {
      expect(task.due_at).toBeTruthy();
      // Раньше здесь было 22:00 — дело «на сегодня» падало на поздний вечер.
      expect(localHour(task.due_at!, "Asia/Vladivostok")).toBe(12);
    }
  });
});
