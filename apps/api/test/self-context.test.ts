import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  applyCompanionSelfFacts,
  inferCompanionSelfFacts,
  selectSelfTheses,
  toSelfThesis,
} from "../src/modules/assistant/self-context.js";

describe("companion self context", () => {
  it("extracts short theses and skips people intros and one-off tasks", () => {
    expect(inferCompanionSelfFacts("я люблю ранние подъёмы")).toEqual([
      expect.objectContaining({ content: "люблю ранние подъёмы", category: "interest" }),
    ]);
    expect(inferCompanionSelfFacts("мне важно не перерабатывать")).toEqual([
      expect.objectContaining({ content: "важно не перерабатывать", category: "preference" }),
    ]);
    expect(inferCompanionSelfFacts("запомни, я лучше думаю вечером")).toEqual([
      expect.objectContaining({ content: "я лучше думаю вечером" }),
    ]);
    expect(inferCompanionSelfFacts("у меня есть друг дима, день рождения 29.03.1994")).toEqual([]);
    expect(inferCompanionSelfFacts("я хочу сегодня купить хлеб")).toEqual([]);
  });

  it("stores theses on the self person and prefers query-relevant facts", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 1, name: "A" })).id;
    await applyCompanionSelfFacts(repository, owner, [
      {
        memory_id: null,
        content: "лучше думаю вечером",
        category: "preference",
        occurred_at: null,
      },
      { memory_id: null, content: "не ем мясо", category: "dislike", occurred_at: null },
    ]);
    const self = (await repository.getSelfPerson(owner))!;
    const stored = await repository.listMemories(owner, self.id);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "лучше думаю вечером", category: "preference" }),
        expect.objectContaining({ content: "не ем мясо", category: "dislike" }),
      ]),
    );
    await repository.createMemory(owner, self.id, {
      content: "люблю камерные театры",
      category: "preference",
      importance: 2,
    });
    const selected = selectSelfTheses(await repository.listMemories(owner, self.id), "вечером", 2);
    expect(selected[0]?.content).toMatch(/вечером/);
  });

  it("updates an existing thesis instead of creating a duplicate", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 2, name: "A" })).id;
    await applyCompanionSelfFacts(repository, owner, [
      { memory_id: null, content: "лучше думаю вечером", category: "preference", occurred_at: null },
    ]);
    const self = (await repository.getSelfPerson(owner))!;
    const first = await repository.listMemories(owner, self.id);
    expect(first).toHaveLength(1);
    await applyCompanionSelfFacts(repository, owner, [
      {
        memory_id: first[0]!.id,
        content: "лучше думаю утром",
        category: "preference",
        occurred_at: null,
      },
    ]);
    const afterId = await repository.listMemories(owner, self.id);
    expect(afterId).toHaveLength(1);
    expect(afterId[0]).toMatchObject({ id: first[0]!.id, content: "лучше думаю утром" });
    await applyCompanionSelfFacts(repository, owner, [
      { memory_id: null, content: "лучше думаю ночью", category: "preference", occurred_at: null },
    ]);
    const afterRelated = await repository.listMemories(owner, self.id);
    expect(afterRelated).toHaveLength(1);
    expect(afterRelated[0]).toMatchObject({ id: first[0]!.id, content: "лучше думаю ночью" });
  });

  it("keeps theses short", () => {
    const long = `я ${"очень ".repeat(40)}устаю от шума`;
    expect(toSelfThesis(long).length).toBeLessThanOrEqual(180);
  });
});
