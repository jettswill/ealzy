import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  continueGuidedIntro,
  guidedIntroQuestions,
  startOrResumeGuidedIntro,
} from "../src/modules/assistant/guided-intro.js";

describe("guided intro", () => {
  it("asks work then goal, stores facts, and starts a dump", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 77, name: "A" });
    const first = await startOrResumeGuidedIntro(repository, user.id, "ru");
    expect(first.total).toBe(2);
    expect(first.question).toBe(guidedIntroQuestions("ru")[0]);
    expect(first.done).toBe(false);

    const extract = async () => ({
      memories: [{ content: "дизайнер", category: "skill" }],
      goals: ["Собрать портфолио"],
      people: ["Маша"],
    });
    let step = first;
    for (let i = 0; i < 2; i++) {
      step = await continueGuidedIntro(repository, user.id, `ответ ${i + 1}`, "ru", extract);
    }
    expect(step.done).toBe(true);
    expect(step.step).toBe(2);
    expect(step.question).toMatch(/Собрать портфолио|дел из головы/);
    const self = (await repository.getSelfPerson(user.id))!;
    const memories = await repository.listMemories(user.id, self.id);
    expect(memories.map((item) => item.content)).toContain("дизайнер");
    expect((await repository.listGoals(user.id)).map((item) => item.title)).toContain(
      "Собрать портфолио",
    );
    expect((await repository.listPeople(user.id)).some((person) => person.name === "Маша")).toBe(
      true,
    );
    expect(await repository.findActivePendingAction(user.id, 77, "first_brain_dump")).toBeTruthy();
    expect((await repository.getProfile(user.id))?.onboarding_completed_at).toBeTruthy();
  });
});
