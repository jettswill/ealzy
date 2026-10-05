import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  AssistantOrchestrator,
  ExperienceService,
  enrichRecommendationItems,
  type AiProvider,
} from "../src/modules/assistant/index.js";

const mockRecommendAi = (items: unknown[]): AiProvider => ({
  async decide(text) {
    if (/запомни/i.test(text))
      return {
        intent: "remember",
        person_query: "Маша",
        content: "любит походы",
        category: "interest",
        title: null,
        space_name: null,
      };
    return {
      intent: "recommend",
      person_query: "Маша",
      content: text,
      category: null,
      title: null,
      space_name: null,
    };
  },
  async recommend(_query, _person, memories) {
    return items.length
      ? items
      : [
          {
            title: "Поход",
            rationale: "Because memory",
            memory_ids: memories.slice(0, 1).map((memory) => memory.id),
            experience_ids: [],
            is_generic: false,
          },
          { title: "A", rationale: "g", memory_ids: [], experience_ids: [], is_generic: true },
          { title: "B", rationale: "g", memory_ids: [], experience_ids: [], is_generic: true },
        ];
  },
});

describe("AI eval harness", () => {
  it("maps remember commands to interest category with source message", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 1, name: "A" })).id;
    const messageId = randomUUID();
    const assistant = new AssistantOrchestrator(repository, mockRecommendAi([]));
    await assistant.handle(owner, "Запомни: Маша любит походы", messageId);
    const masha = (await repository.listPeople(owner)).find((person) => !person.is_self)!;
    expect(await repository.listMemories(owner, masha.id)).toEqual([
      expect.objectContaining({
        category: "interest",
        source_message_id: messageId,
      }),
    ]);
  });

  it("returns generic recommendation items when no memories exist", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 2, name: "A" })).id;
    await repository.createPerson(owner, { name: "Маша" });
    const assistant = new AssistantOrchestrator(repository);
    await assistant.handle(owner, "Куда сходить с Машей?");
    const saved = (await repository.listRecommendations(owner))[0]!;
    expect(saved.items.every((item) => item.is_generic)).toBe(true);
  });

  it("attaches provenance when AI cites memory IDs", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 3, name: "A" })).id;
    const masha = await repository.createPerson(owner, { name: "Маша" });
    const memory = (
      await repository.createMemory(owner, masha.id, {
        content: "любит походы",
        category: "interest",
      })
    ).memory;
    const enriched = enrichRecommendationItems(
      [
        {
          title: "Новый маршрут",
          rationale: "Потому что любит походы",
          memory_ids: [memory.id],
          experience_ids: [],
          is_generic: false,
        },
        { title: "A", rationale: "g", is_generic: true },
        { title: "B", rationale: "g", is_generic: true },
      ],
      [memory],
      [],
    );
    expect(enriched[0]?.provenance).toEqual([
      expect.objectContaining({ type: "memory", id: memory.id, label: "любит походы" }),
    ]);
  });

  it("does not write memory from companion-only flows", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 4, name: "A" })).id;
    const ai: AiProvider = {
      async decide() {
        return {
          intent: "other",
          person_query: null,
          content: "advice",
          category: null,
          title: null,
          space_name: null,
        };
      },
      async recommend() {
        return [];
      },
      async companion() {
        return { answer: "Try one small step.", context_used: [], follow_up: null };
      },
    };
    const assistant = new AssistantOrchestrator(repository, ai);
    await assistant.handle(owner, "What should I do tonight?");
    expect(await repository.listPeople(owner)).toHaveLength(1);
    const self = (await repository.getSelfPerson(owner))!;
    expect(await repository.listMemories(owner, self.id)).toHaveLength(0);
  });

  it("completes follow-up without creating duplicate experiences", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 5, name: "A" })).id;
    const experience = await repository.createExperience(owner, {
      type: "restaurant",
      title: "Quiet dinner",
      status: "follow_up_due",
    });
    const service = new ExperienceService(repository);
    await service.completeFollowUp(owner, experience.id, "Понравилась атмосфера");
    expect(await repository.listExperiences(owner)).toHaveLength(1);
    expect((await repository.getExperience(owner, experience.id))?.status).toBe("completed");
  });
});
