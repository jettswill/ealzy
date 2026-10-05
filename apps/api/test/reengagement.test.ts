import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  canNudge,
  reengagementKind,
  runReengagement,
} from "../src/modules/engagement/reengagement.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";

class FakeTelegram implements TelegramGateway {
  sent: { chatId: number; text: string }[] = [];
  async sendMessage(chatId: number, text: string) {
    this.sent.push({ chatId, text });
  }
  async answerCallbackQuery() {
    return Promise.resolve();
  }
}

describe("re-engagement", () => {
  it("classifies 24h and 72h idle windows", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    expect(reengagementKind(now.toISOString(), now)).toBeNull();
    expect(reengagementKind("2026-09-03T11:00:00.000Z", now)).toBe("d1");
    expect(reengagementKind("2026-09-01T11:00:00.000Z", now)).toBe("d3");
    expect(canNudge("2026-09-03T12:00:00.000Z", now)).toBe(false);
    expect(canNudge("2026-09-01T12:00:00.000Z", now)).toBe(true);
  });

  it("sends at most one telegram nudge per 48h", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 501, name: "A" });
    await repository.updateProfile(user.id, {
      morning_digest_enabled: true,
      last_active_at: "2026-09-02T12:00:00.000Z",
    });
    const telegram = new FakeTelegram();
    const first = await runReengagement(repository, telegram, new Date("2026-09-04T12:00:00.000Z"));
    expect(first.sent).toBe(1);
    expect(telegram.sent[0]?.text).not.toMatch(/0 дел|0 task/i);
    expect(telegram.sent[0]?.text).toMatch(/дел|step|goal|цел/i);
    const second = await runReengagement(repository, telegram, new Date("2026-09-04T18:00:00.000Z"));
    expect(second.sent).toBe(0);
  });

  it("continues the goal thread when today is empty", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 502, name: "A" });
    await repository.updateProfile(user.id, {
      last_active_at: "2026-09-03T11:00:00.000Z",
    });
    await repository.createGoal(user.id, { title: "Запустить лендинг" });
    const telegram = new FakeTelegram();
    await runReengagement(repository, telegram, new Date("2026-09-04T12:00:00.000Z"));
    expect(telegram.sent[0]?.text).toMatch(/Запустить лендинг/);
    expect(telegram.sent[0]?.text).toMatch(/шаг/);
    expect(telegram.sent[0]?.text).not.toMatch(/0 дел/);
  });
});
