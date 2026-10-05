import { afterEach, describe, expect, it, vi } from "vitest";
import { getTelegramInitData, waitForTelegramInitData } from "../telegram-init-data";

describe("Telegram Mini App init data", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    delete window.Telegram;
  });
  it("reads tgWebAppData from the hash and the query string", () => {
    window.history.replaceState(null, "", "/#tgWebAppData=from-hash");
    window.Telegram = {};
    expect(getTelegramInitData()).toBe("from-hash");

    window.history.replaceState(null, "", "/?tgWebAppData=from-query");
    expect(getTelegramInitData()).toBe("from-query");
  });

  it("waits until Telegram injects initData", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    window.Telegram = { WebApp: { initData: "" } };
    const pending = waitForTelegramInitData(1000);
    window.setTimeout(() => {
      window.Telegram = { WebApp: { initData: "query_id=1" } };
    }, 120);
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe("query_id=1");
    vi.useRealTimers();
  });
});
