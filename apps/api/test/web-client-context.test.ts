import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import { applyWebClientContext } from "../src/modules/auth/index.js";

async function webOwner(repository: InMemoryRepository) {
  const user = await repository.upsertOAuthUser({
    auth_user_id: "11111111-1111-4111-8111-111111111111",
    name: "Аня",
    email: "anya@example.com",
  });
  return user.id;
}

describe("часовой пояс и сводка при веб-входе", () => {
  it("записывает пояс браузера и включает утреннюю сводку", async () => {
    const repository = new InMemoryRepository();
    const owner = await webOwner(repository);
    // Провижининг не знает про браузер: пояс UTC, но утренняя сводка уже включена —
    // она по умолчанию у всех.
    expect((await repository.getProfile(owner))?.timezone).toBe("UTC");
    expect((await repository.getProfile(owner))?.morning_digest_enabled).toBe(true);

    const applied = await applyWebClientContext(repository, owner, "Europe/Moscow");

    expect(applied.timezone).toBe(true);
    const profile = await repository.getProfile(owner);
    expect(profile?.timezone).toBe("Europe/Moscow");
    expect(profile?.morning_digest_enabled).toBe(true);
  });

  it("включает сводку и тому, у кого браузерный пояс действительно UTC", async () => {
    const repository = new InMemoryRepository();
    const owner = await webOwner(repository);
    const applied = await applyWebClientContext(repository, owner, "UTC");
    expect(applied.timezone).toBe(false);
    expect((await repository.getProfile(owner))?.morning_digest_enabled).toBe(true);
  });

  it("не трогает пояс, который человек уже выбрал сам", async () => {
    const repository = new InMemoryRepository();
    const owner = await webOwner(repository);
    await repository.updateProfile(owner, { timezone: "Asia/Tbilisi" });

    const applied = await applyWebClientContext(repository, owner, "Europe/Berlin");

    expect(applied).toEqual({ timezone: false, morning_digest: false });
    expect((await repository.getProfile(owner))?.timezone).toBe("Asia/Tbilisi");
  });

  it("не включает сводку повторно, если её выключили", async () => {
    const repository = new InMemoryRepository();
    const owner = await webOwner(repository);
    await applyWebClientContext(repository, owner, "Europe/Moscow");
    await repository.updateProfile(owner, { morning_digest_enabled: false });

    // Повторный вход: пояс уже настоящий, значит трогать ничего нельзя.
    const applied = await applyWebClientContext(repository, owner, "Europe/Moscow");

    expect(applied).toEqual({ timezone: false, morning_digest: false });
    expect((await repository.getProfile(owner))?.morning_digest_enabled).toBe(false);
  });

  it("молчит на мусорном поясе", async () => {
    const repository = new InMemoryRepository();
    const owner = await webOwner(repository);
    expect(await applyWebClientContext(repository, owner, "Moon/Base")).toEqual({
      timezone: false,
      morning_digest: false,
    });
    expect(await applyWebClientContext(repository, owner, undefined)).toEqual({
      timezone: false,
      morning_digest: false,
    });
    expect((await repository.getProfile(owner))?.timezone).toBe("UTC");
  });

  it("не лезет в настройки Telegram-аккаунта", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 77, name: "Пётр" });
    await repository.updateProfile(user.id, { timezone: "UTC", morning_digest_enabled: false });

    const applied = await applyWebClientContext(repository, user.id, "Europe/Moscow");

    expect(applied.morning_digest).toBe(false);
    expect((await repository.getProfile(user.id))?.morning_digest_enabled).toBe(false);
  });
});
