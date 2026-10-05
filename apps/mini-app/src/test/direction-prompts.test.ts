import { describe, expect, it } from "vitest";
import { goalSyncPrompt } from "../direction-prompts";
import type { Goal } from "../types";

function goal(partial: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  return {
    status: "active",
    ...partial,
  };
}

describe("goalSyncPrompt", () => {
  it("names existing goals by id so the sync updates them", () => {
    const text = goalSyncPrompt(
      [
        goal({
          id: "g1",
          title: "Выучить французский",
          current_plan: "Вечерние карточки.",
        }),
      ],
      "ru",
    );
    expect(text).toMatch(/^Синк по целям и плану\./);
    expect(text).toMatch(/Выучить французский \[g1\]/);
    expect(text).toMatch(/план: Вечерние карточки/);
    expect(text).not.toMatch(/активных целей пока нет/);
  });

  it("does not pretend there are no goals when the list is still empty", () => {
    const text = goalSyncPrompt([], "ru");
    expect(text).toMatch(/^Синк по целям и плану\./);
    expect(text).not.toMatch(/активных целей пока нет/);
    expect(text).not.toMatch(/Сейчас в работе/);
  });
});
