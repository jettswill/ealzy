import { describe, expect, it } from "vitest";
import { groundMemoryClaimAnswer } from "../src/modules/assistant/companion.js";

const PROD_ANSWER =
  "Приняла: мама любит керамику ручной работы и пионы, не пьёт кофе.\n\nДень рождения — 3 октября.\n\nЭто сохраню для подбора подарков и напоминаний, чтобы не упустить важное.";

describe("groundMemoryClaimAnswer", () => {
  it("does not let Ealzy promise a save that never happened", () => {
    const grounded = groundMemoryClaimAnswer(PROD_ANSWER, {
      locale: "ru",
      savedMemory: false,
    });
    expect(grounded).not.toBe(PROD_ANSWER);
    expect(grounded).toContain("не сохранила");
    expect(grounded.startsWith(PROD_ANSWER)).toBe(true);
  });

  it("leaves the answer alone when the fact really was written", () => {
    expect(groundMemoryClaimAnswer(PROD_ANSWER, { locale: "ru", savedMemory: true })).toBe(
      PROD_ANSWER,
    );
  });

  it("catches the softer wording too", () => {
    expect(
      groundMemoryClaimAnswer("Держу в голове: мама ценит керамику и пионы.", {
        locale: "ru",
        savedMemory: false,
      }),
    ).toContain("не сохранила");
  });

  it("stays silent when the answer is about a task, not a memory", () => {
    const answer = "Записал дело: купить подарок маме. Срок — 1 октября.";
    expect(groundMemoryClaimAnswer(answer, { locale: "ru", savedMemory: false })).toBe(answer);
  });

  it("stays silent when nothing was promised", () => {
    const answer = "Давай разберём неделю: три дела на сегодня и созвон с подрядчиком.";
    expect(groundMemoryClaimAnswer(answer, { locale: "ru", savedMemory: false })).toBe(answer);
  });

  it("works in English", () => {
    const grounded = groundMemoryClaimAnswer("Got it, I'll remember that she likes ceramics.", {
      locale: "en",
      savedMemory: false,
    });
    expect(grounded).toContain("haven't saved it yet");
  });

  it("does not stack the same correction twice", () => {
    const once = groundMemoryClaimAnswer(PROD_ANSWER, { locale: "ru", savedMemory: false });
    expect(groundMemoryClaimAnswer(once, { locale: "ru", savedMemory: false })).toBe(once);
  });
});
