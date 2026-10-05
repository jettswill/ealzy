import { describe, expect, it } from "vitest";
import { computeReliability, summarizeAchievementHolders } from "../src/modules/assistant/reliability.js";

function task(overrides: {
  title?: string;
  due_at?: string | null;
  status?: "todo" | "in_progress" | "done" | "cancelled";
  assignee?: "user" | "ealzy";
  completed_at?: string | null;
  updated_at?: string | null;
}) {
  return {
    status: "todo" as const,
    due_at: null,
    assignee: "user" as const,
    completed_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("on-time reliability", () => {
  it("ignores undated, cancelled and Ealzy work, and does not judge a low score", () => {
    const stats = computeReliability(
      [
        task({ due_at: "2026-08-01T12:00:00.000Z" }),
        task({ due_at: "2026-08-02T12:00:00.000Z" }),
        task({ due_at: "2026-08-03T12:00:00.000Z" }),
        task({ due_at: null }),
        task({ due_at: "2026-08-01T12:00:00.000Z", status: "cancelled" }),
        task({
          due_at: "2026-08-01T12:00:00.000Z",
          assignee: "ealzy",
          status: "todo",
        }),
      ],
      "UTC",
      new Date("2026-09-04T12:00:00.000Z"),
    );
    expect(stats).toMatchObject({
      dated: 3,
      on_time: 0,
      percent: 0,
      praise: "none",
      achievements: [],
    });
  });

  it("counts done-before-due as on time and praises from 60% and 90%", () => {
    const solid = computeReliability(
      [
        task({
          due_at: "2026-08-10T12:00:00.000Z",
          status: "done",
          completed_at: "2026-08-09T12:00:00.000Z",
        }),
        task({
          due_at: "2026-08-11T12:00:00.000Z",
          status: "done",
          completed_at: "2026-08-11T12:00:00.000Z",
        }),
        task({ due_at: "2026-08-01T12:00:00.000Z" }),
      ],
      "UTC",
      new Date("2026-08-20T12:00:00.000Z"),
    );
    expect(solid.percent).toBe(67);
    expect(solid.praise).toBe("solid");

    const excellent = computeReliability(
      [
        task({
          due_at: "2026-08-10T12:00:00.000Z",
          status: "done",
          completed_at: "2026-08-10T09:00:00.000Z",
        }),
        task({
          due_at: "2026-08-11T12:00:00.000Z",
          status: "done",
          completed_at: "2026-08-11T09:00:00.000Z",
        }),
        task({
          due_at: "2026-08-12T12:00:00.000Z",
          status: "done",
          completed_at: "2026-08-12T09:00:00.000Z",
        }),
      ],
      "UTC",
      new Date("2026-08-20T12:00:00.000Z"),
    );
    expect(excellent.percent).toBe(100);
    expect(excellent.praise).toBe("excellent");
  });

  it("unlocks 90%+ day achievements for consecutive due days", () => {
    const tasks = Array.from({ length: 7 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return task({
        due_at: `2026-08-${day}T12:00:00.000Z`,
        status: "done",
        completed_at: `2026-08-${day}T09:00:00.000Z`,
      });
    });
    const stats = computeReliability(tasks, "UTC", new Date("2026-08-07T18:00:00.000Z"));
    expect(stats.best_streak).toBe(7);
    expect(stats.current_streak).toBe(7);
    expect(stats.achievements).toEqual([7]);
  });

  it("breaks the current streak after a late day but keeps the best run", () => {
    const tasks = [
      task({
        due_at: "2026-08-01T12:00:00.000Z",
        status: "done",
        completed_at: "2026-08-01T09:00:00.000Z",
      }),
      task({
        due_at: "2026-08-02T12:00:00.000Z",
        status: "done",
        completed_at: "2026-08-02T09:00:00.000Z",
      }),
      task({
        due_at: "2026-08-03T12:00:00.000Z",
        status: "done",
        completed_at: "2026-08-04T09:00:00.000Z",
      }),
      task({
        due_at: "2026-08-04T12:00:00.000Z",
        status: "done",
        completed_at: "2026-08-04T09:00:00.000Z",
      }),
    ];
    const stats = computeReliability(tasks, "UTC", new Date("2026-08-04T18:00:00.000Z"));
    expect(stats.best_streak).toBe(2);
    expect(stats.current_streak).toBe(1);
    expect(stats.achievements).toEqual([]);
  });

  it("counts early closes and ignores tasks whose deadline has not come yet", () => {
    const stats = computeReliability(
      [
        task({
          due_at: "2026-09-20T12:00:00.000Z",
          status: "done",
          completed_at: "2026-09-04T09:00:00.000Z",
        }),
        task({ due_at: "2026-09-20T12:00:00.000Z" }),
        task({ due_at: "2026-09-30T12:00:00.000Z" }),
        task({ due_at: "2026-09-04T12:00:00.000Z" }),
        task({
          due_at: "2026-09-01T12:00:00.000Z",
          status: "done",
          completed_at: "2026-09-01T09:00:00.000Z",
        }),
        task({ due_at: "2026-08-20T12:00:00.000Z" }),
      ],
      "UTC",
      new Date("2026-09-04T18:00:00.000Z"),
    );
    expect(stats).toMatchObject({
      dated: 3,
      on_time: 2,
      percent: 67,
    });
  });

  it("counts how many people hold each 90%+ streak mark", () => {
    const week = Array.from({ length: 7 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return task({
        due_at: `2026-08-${day}T12:00:00.000Z`,
        status: "done",
        completed_at: `2026-08-${day}T09:00:00.000Z`,
      });
    });
    expect(
      summarizeAchievementHolders(
        [
          { timezone: "UTC", tasks: week },
          { timezone: "UTC", tasks: [task({ due_at: "2026-08-01T12:00:00.000Z" })] },
        ],
        new Date("2026-08-07T18:00:00.000Z"),
      ),
    ).toEqual({
      users: 2,
      holders: { 7: 1, 30: 0, 60: 0, 100: 0, 360: 0 },
    });
  });
});
