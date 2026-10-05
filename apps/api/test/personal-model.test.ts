import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "../src/repository.js";
import {
  composePortrait,
  inferBehaviorPatterns,
  inferCommunicationStyle,
  inferImplicitSelfFacts,
  mergeSelfFacts,
  refreshPortrait,
} from "../src/modules/assistant/personal-model.js";

function task(overrides: {
  title: string;
  due_at?: string | null;
  status?: "todo" | "in_progress" | "done";
  assignee?: "user" | "ealzy";
  importance?: number;
  urgency?: number;
}) {
  return {
    status: "todo" as const,
    due_at: null,
    assignee: "user" as const,
    importance: 3,
    urgency: 3,
    ...overrides,
  };
}

describe("personal model", () => {
  it("reads postponement and backlog from open tasks, not Ealzy queue work", () => {
    const patterns = inferBehaviorPatterns({
      timezone: "Europe/Moscow",
      locale: "ru",
      now: new Date("2026-09-04T12:00:00.000Z"),
      tasks: [
        task({ title: "Оплатить счета", due_at: "2026-08-01T12:00:00.000Z" }),
        task({ title: "Налоги", due_at: "2026-08-10T12:00:00.000Z" }),
        task({ title: "Страховка", due_at: "2026-08-20T12:00:00.000Z" }),
        task({ title: "Разбор почты" }),
        task({ title: "Купить лампочки" }),
        task({ title: "Навести порядок" }),
        task({ title: "Связаться с бухгалтером" }),
        task({ title: "Разобрать загрузки" }),
        task({ title: "Протереть стол" }),
        task({ title: "Ealzy queue", assignee: "ealzy", due_at: "2026-01-01T12:00:00.000Z" }),
      ],
    });
    expect(patterns.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["overdue_cluster", "undated_backlog", "postpones"]),
    );
    expect(patterns.some((item) => item.detail.includes("Ealzy queue"))).toBe(false);
  });

  it("notices kept and broken promises", () => {
    const patterns = inferBehaviorPatterns({
      timezone: "Europe/Moscow",
      locale: "en",
      tasks: [],
      promises: [
        {
          title: "Lights out by 23:30",
          status: "active",
          stats: { keeping_days: 14, last_checkin_status: "keeping", broken_count: 0 },
        },
        {
          title: "Run three times a week",
          status: "active",
          stats: { keeping_days: 0, last_checkin_status: "broken", broken_count: 1 },
        },
      ],
    });
    expect(patterns.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["keeps_promises", "broken_promise"]),
    );
  });

  it("learns durable habits from speech and skips one-off mood", () => {
    expect(inferImplicitSelfFacts("я устал")).toEqual([]);
    expect(inferImplicitSelfFacts("сегодня тяжёлый день")).toEqual([]);
    expect(inferImplicitSelfFacts("опять отложил отчёт")).toEqual([
      expect.objectContaining({ content: "часто откладываю дела", category: "personality" }),
    ]);
    expect(inferImplicitSelfFacts("я сова")).toEqual([
      expect.objectContaining({ content: expect.stringMatching(/сова/) }),
    ]);
    expect(inferImplicitSelfFacts("давай короче, без воды пожалуйста")).toEqual([
      expect.objectContaining({ content: "предпочитаю короткие ответы без воды" }),
    ]);
    expect(inferCommunicationStyle("короче, я пошёл в магазин")).toBeNull();
    expect(inferCommunicationStyle("говори короче пожалуйста")).toBe("коротко и по делу");
    expect(inferCommunicationStyle("Коротко и по делу")).toBe("коротко и по делу");
  });

  it("merges overlapping theses and composes a portrait under the length cap", () => {
    const merged = mergeSelfFacts(
      [{ memory_id: null, content: "я сова", category: "preference", occurred_at: null }],
      [{ memory_id: null, content: "я сова", category: "preference", occurred_at: null }],
      [{ memory_id: null, content: "люблю тишину", category: "interest", occurred_at: null }],
    );
    expect(merged).toHaveLength(2);
    const portrait = composePortrait({
      locale: "ru",
      values: ["здоровье", "спокойствие"],
      memories: [{ content: "лучше думаю вечером", category: "preference" }],
      patterns: [{ kind: "overdue_cluster", detail: "часто копит просрочку (4): счета" }],
    });
    expect(portrait).toMatch(/Ценности: здоровье/);
    expect(portrait).toMatch(/лучше думаю вечером/);
    expect(portrait).not.toMatch(/Стиль общения|Дела в срок|коротко и по делу/i);
    expect(portrait).not.toMatch(/просроч|отклад|негодя/i);
    expect(portrait.length).toBeLessThanOrEqual(1200);
  });

  it("writes a durable portrait after observing overdue work", async () => {
    const repository = new InMemoryRepository();
    const owner = (await repository.upsertTelegramUser({ telegram_id: 77, name: "A" })).id;
    await repository.updateProfile(owner, { values: ["здоровье"], locale: "ru" });
    const self = (await repository.getSelfPerson(owner))!;
    await repository.createMemory(owner, self.id, {
      content: "склонен откладывать дела",
      category: "personality",
      metadata: { source: "behavior_inference" },
    });
    for (const title of ["Счета", "Налоги", "Страховка"]) {
      await repository.createTask(owner, {
        title,
        due_at: "2026-08-01T12:00:00.000Z",
      });
    }
    const portrait = await refreshPortrait(
      repository,
      owner,
      new Date("2026-09-04T12:00:00.000Z"),
    );
    expect(portrait).toMatch(/Ценности: здоровье/);
    expect(portrait).not.toMatch(/склонен откладывать|копит просрочен|Дела в срок/i);
    const profile = await repository.getProfile(owner);
    expect(profile?.context_summary).toBe(portrait);
    const memories = await repository.listMemories(owner, self.id);
    expect(memories.some((memory) => memory.metadata?.source === "behavior_inference")).toBe(false);
  });
});
