import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  AssistantOrchestrator,
  eventBundleLabels,
  parseOrganizeEventRequest,
} from "../src/modules/assistant/index.js";

describe("parseOrganizeEventRequest", () => {
  it("detects birthday organization requests with a person", () => {
    expect(parseOrganizeEventRequest("Помоги организовать день рождения мамы")).toEqual({
      person_query: "мамы",
      event_kind: "birthday",
    });
    expect(parseOrganizeEventRequest("Plan a birthday for Masha")).toEqual({
      person_query: "Masha",
      event_kind: "birthday",
    });
  });

  it("returns null for unrelated messages", () => {
    expect(parseOrganizeEventRequest("Куда сходить с Машей?")).toBeNull();
    expect(parseOrganizeEventRequest("Запомни: Маша любит походы")).toBeNull();
  });
});

describe("organize_event bundle", () => {
  it("creates linked space, task, and recommendation", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 50, name: "A" })).id;
    await repository.createPerson(owner, { name: "Мама", aliases: ["мама", "мамы"] });
    const assistant = new AssistantOrchestrator(repository);
    const result = await assistant.handle(owner, "Помоги организовать день рождения мамы");
    expect(result.intent).toBe("organize_event");
    expect(result.text).toMatch(/Пространство/);
    expect(result.text).toMatch(/Задача/);

    const spaces = await repository.listSpaces(owner);
    const tasks = await repository.listTasks(owner);
    const recommendations = await repository.listRecommendations(owner);
    expect(spaces).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(recommendations).toHaveLength(1);
    expect(spaces[0]).toMatchObject({
      name: eventBundleLabels("birthday", "Мама").spaceName,
      person_ids: [expect.any(String)],
    });
    expect(tasks[0]).toMatchObject({
      title: eventBundleLabels("birthday", "Мама").taskTitle,
      space_id: spaces[0]!.id,
    });
    expect(recommendations[0]).toMatchObject({
      person_id: tasks[0]!.person_id,
      space_id: spaces[0]!.id,
      task_id: tasks[0]!.id,
    });
    expect(recommendations[0]!.items.length).toBeGreaterThanOrEqual(3);
  });

  it("returns disambiguation when the honoree is ambiguous", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 51, name: "A" })).id;
    await repository.createPerson(owner, { name: "Маша", aliases: ["мама"] });
    await repository.createPerson(owner, { name: "Ира", aliases: ["мама"] });
    const result = await new AssistantOrchestrator(repository).handle(
      owner,
      "Организуй день рождения мамы",
    );
    expect(result.disambiguation?.candidates).toHaveLength(2);
    expect(await repository.listSpaces(owner)).toHaveLength(0);
  });
});
