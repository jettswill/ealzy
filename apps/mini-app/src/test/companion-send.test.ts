import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import {
  companionTurnFromHistory,
  isAiUnavailableMessage,
  isRecoverableCompanionError,
  raceCompanionSend,
  recoverCompanionTurn,
  retryableUserContent,
  visibleCompanionMessages,
} from "../companion-send";
import type { ConversationMessage } from "../types";

function message(
  id: string,
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  return { id, role, content, conversation_id: "c1" };
}

afterEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("companion send recovery", () => {
  it("treats dropped connections and gateway failures as recoverable", () => {
    expect(isRecoverableCompanionError(new ApiError("offline", 0))).toBe(true);
    expect(isRecoverableCompanionError(new ApiError("timeout", 408))).toBe(true);
    expect(isRecoverableCompanionError(new ApiError("bad gateway", 502))).toBe(true);
    expect(isRecoverableCompanionError(new ApiError("expired", 401))).toBe(false);
    expect(isRecoverableCompanionError(new Error("offline"))).toBe(false);
  });

  it("finds a completed turn that landed after the client lost the response", () => {
    const previous = [message("m1", "assistant", "How can I help?")];
    const latest = [
      ...previous,
      message("m2", "user", "I need advice"),
      message("m3", "assistant", "Let’s break it down."),
    ];
    expect(companionTurnFromHistory(previous, latest, "I need advice")).toEqual({
      messages: latest,
      complete: true,
    });
  });

  it("keeps a user message that saved before the assistant reply arrived", () => {
    const previous = [message("m1", "assistant", "How can I help?")];
    const latest = [...previous, message("m2", "user", "I need advice")];
    expect(companionTurnFromHistory(previous, latest, "I need advice")).toEqual({
      messages: latest,
      complete: false,
    });
  });

  it("polls history until the assistant reply appears", async () => {
    const previous = [message("m1", "assistant", "How can I help?")];
    const loads = [
      previous,
      [...previous, message("m2", "user", "I need advice")],
      [
        ...previous,
        message("m2", "user", "I need advice"),
        message("m3", "assistant", "Let’s break it down."),
      ],
    ];
    const loadMessages = vi.fn(async () => loads.shift() ?? []);
    const recovered = await recoverCompanionTurn(loadMessages, previous, "I need advice", {
      delay: async () => undefined,
    });
    expect(loadMessages).toHaveBeenCalledTimes(3);
    expect(recovered?.complete).toBe(true);
    expect(recovered?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Let’s break it down.",
    });
  });

  it("still recovers if the browser marked the tab offline after the send left", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const previous = [message("m1", "assistant", "How can I help?")];
    const latest = [
      ...previous,
      message("m2", "user", "hello"),
      message("m3", "assistant", "I’m here."),
    ];
    const loadMessages = vi.fn(async () => latest);
    await expect(
      recoverCompanionTurn(loadMessages, previous, "hello", { delay: async () => undefined }),
    ).resolves.toEqual({ messages: latest, complete: true });
  });

  it("gives up only after history never shows the sent turn", async () => {
    const loadMessages = vi.fn(async () => [message("m1", "assistant", "How can I help?")]);
    await expect(
      recoverCompanionTurn(loadMessages, [], "hello", {
        attempts: 3,
        delay: async () => undefined,
      }),
    ).resolves.toBeNull();
    expect(loadMessages).toHaveBeenCalledTimes(3);
  });

  it("stops quickly when history cannot be loaded at all", async () => {
    const loadMessages = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      recoverCompanionTurn(loadMessages, [], "hello", { delay: async () => undefined }),
    ).resolves.toBeNull();
    expect(loadMessages).toHaveBeenCalledTimes(3);
  });

  it("shows a hung send from history without waiting for the POST to die", async () => {
    const previous = [message("m1", "assistant", "How can I help?")];
    const latest = [
      ...previous,
      message("m2", "user", "I need advice"),
      message("m3", "assistant", "Let’s break it down."),
    ];
    const send = vi.fn(
      () =>
        new Promise<never>(() => {
          // The client request can hang while the server already finished.
        }),
    );
    const result = await raceCompanionSend(send, async () => latest, previous, "I need advice", {
      delay: async () => undefined,
      warmupMs: 0,
    });
    expect(result).toEqual({ messages: latest });
    expect(send).toHaveBeenCalled();
  });

  it("keeps a successful POST even if history is still empty", async () => {
    const previous = [message("m1", "assistant", "How can I help?")];
    const result = await raceCompanionSend(
      async () => ({
        assistant_message: { id: "m3", role: "assistant", content: "Let’s break it down." },
      }),
      async () => previous,
      previous,
      "I need advice",
      { delay: async () => undefined, warmupMs: 0 },
    );
    expect(result).toMatchObject({
      reply: { assistant_message: { content: "Let’s break it down." } },
    });
  });

  it("recovers from a dropped POST once history has the reply", async () => {
    const previous = [message("m1", "assistant", "How can I help?")];
    const latest = [
      ...previous,
      message("m2", "user", "I need advice"),
      message("m3", "assistant", "Let’s break it down."),
    ];
    const result = await raceCompanionSend(
      async () => {
        throw new ApiError("Could not connect to Ealzy. Check your connection and try again.", 0);
      },
      async () => latest,
      previous,
      "I need advice",
      { delay: async () => undefined, warmupMs: 0 },
    );
    expect(result).toEqual({ messages: latest });
  });

  it("finds the last user request after an AI outage reply", () => {
    const failed = {
      ...message("m3", "assistant", "Сейчас не удалось связаться с AI. Я сохранил сообщение."),
      metadata: { ai_unavailable: true },
    };
    const history = [
      message("m1", "assistant", "How can I help?"),
      message("m2", "user", "какие дела на сегодня?"),
      failed,
    ];
    expect(isAiUnavailableMessage(failed)).toBe(true);
    expect(isAiUnavailableMessage(history[0])).toBe(false);
    expect(retryableUserContent(history)).toBe("какие дела на сегодня?");
    expect(visibleCompanionMessages(history).map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(retryableUserContent([...history.slice(0, 2)])).toBe("какие дела на сегодня?");
    expect(
      visibleCompanionMessages([
        ...history,
        message("m4", "user", "какие дела на сегодня?"),
        { ...failed, id: "m5" },
      ]).map((item) => item.id),
    ).toEqual(["m1", "m2"]);
    expect(
      retryableUserContent([
        ...history,
        message("m4", "user", "какие дела на сегодня?"),
        message("m5", "assistant", "Сегодня три дела."),
      ]),
    ).toBe("");
  });

  it("treats an in-place retry as complete once the existing turn gets a reply", () => {
    const previous = [
      message("m1", "assistant", "How can I help?"),
      message("m2", "user", "какие дела на сегодня?"),
    ];
    const latest = [...previous, message("m3", "assistant", "Сегодня три дела.")];
    expect(companionTurnFromHistory(previous, latest, "какие дела на сегодня?")).toEqual({
      messages: latest,
      complete: true,
    });
    expect(
      companionTurnFromHistory(previous, previous, "какие дела на сегодня?")?.complete,
    ).toBe(false);
  });
});
