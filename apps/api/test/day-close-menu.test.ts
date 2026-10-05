import { describe, expect, it } from "vitest";
import {
  dayCloseActionKeyboard,
  dayCloseCallbackData,
  dayCloseDiscussInstruction,
  dayCloseListKeyboard,
  dayCloseMenuPrompt,
  parseDayCloseCallback,
} from "../src/modules/assistant/pending-actions.js";

describe("evening task action menu", () => {
  const pendingId = "11111111-1111-4111-8111-111111111111";
  const task = { id: "22222222-2222-4222-8222-222222222222", title: "Изучать курсы Вани" };

  it("lists task names instead of a grid of actions", () => {
    const keyboard = dayCloseListKeyboard(pendingId, [task], "ru");
    expect(keyboard).toEqual([[expect.objectContaining({ text: "Изучать курсы Вани" })]]);
    expect(parseDayCloseCallback(keyboard[0]![0]!.callback_data)).toMatchObject({
      action: "select",
    });
    expect(dayCloseMenuPrompt("ru")).toMatch(/выберите задачу/);
  });

  it("shows done, discuss and tomorrow for one task", () => {
    const keyboard = dayCloseActionKeyboard(pendingId, task, "ru");
    expect(keyboard.map((row) => row.map((button) => button.text))).toEqual([
      ["Изучать курсы Вани"],
      ["Выполнено"],
      ["Обсудить с Илзи"],
      ["Перенести на завтра"],
      ["← Все задачи"],
    ]);
    expect(parseDayCloseCallback(keyboard[2]![0]!.callback_data)).toMatchObject({
      action: "discuss",
    });
    expect(parseDayCloseCallback(keyboard[4]![0]!.callback_data)).toMatchObject({ action: "back" });
    expect(dayCloseCallbackData(pendingId, task.id, "done").length).toBeLessThanOrEqual(64);
    expect(dayCloseDiscussInstruction(task, "ru")).toMatch(/Изучать курсы Вани/);
  });
});
