import { describe, expect, it } from "vitest";
import {
  COMPANION_EVAL_SCENARIOS,
  runCompanionEval,
  runCompanionEvalGenerated,
} from "../src/modules/assistant/companion-eval.js";
import { InMemoryRepository } from "../src/repository.js";
import { PersonalContextBuilder, toCompanionWorkspace, omitEalzyQueueMutations, omitUnsolicitedPromiseCaptures, omitAgendaMutations } from "../src/modules/assistant/index.js";

describe("companion eval pipeline", () => {
  it("has 25 scenarios", () => {
    expect(COMPANION_EVAL_SCENARIOS).toHaveLength(28);
  });

  it("drops mutations on Ealzy-assigned queue work", () => {
    expect(
      omitEalzyQueueMutations(
        [
          { op: "complete", title: "Собрать план поездки" },
          { op: "create", title: "Купить молоко" },
        ],
        [{ title: "Собрать план поездки", assignee: "ealzy" }],
      ),
    ).toEqual([{ op: "create", title: "Купить молоко" }]);
    expect(
      omitEalzyQueueMutations(
        [{ op: "complete", title: null, task_id: null }],
        [{ title: "Собрать план поездки", assignee: "ealzy" }],
      ),
    ).toEqual([]);
    expect(
      omitEalzyQueueMutations(
        [{ op: "complete", title: "Сдать отчёт" }],
        [
          { title: "Собрать план поездки", assignee: "ealzy" },
          { title: "Сдать отчёт", assignee: "user" },
        ],
      ),
    ).toEqual([{ op: "complete", title: "Сдать отчёт" }]);
    expect(
      omitUnsolicitedPromiseCaptures(
        [{ op: "create", title: "Пробежка" }],
        "Сорвался с обещанием бегать",
        [{ last_checkin_status: "broken" }],
      ),
    ).toEqual([]);
    expect(
      omitUnsolicitedPromiseCaptures(
        [{ op: "create", title: "Купить лекарства" }],
        "купить лекарства",
        [{ last_checkin_status: "broken" }],
      ),
    ).toEqual([{ op: "create", title: "Купить лекарства" }]);
    expect(
      omitAgendaMutations(
        [{ op: "update", title: "Составить план обучения продажам" }],
        "какие дела есть на сегодня?",
      ),
    ).toEqual([]);
    expect(
      omitAgendaMutations(
        [{ op: "create", title: "Купить молоко" }],
        "какие дела на сегодня? и ещё поставь купить молоко",
      ),
    ).toEqual([{ op: "create", title: "Купить молоко" }]);
  });

  it("passes prompt contracts and heuristic judges", () => {
    const result = runCompanionEval();
    expect(result.failed, result.failed.map((item) => item.id).join(", ")).toEqual([]);
    expect(result.passed).toBe(result.total);
  });

  it("runs a generator against all workspace fixtures", async () => {
    const ids: string[] = [];
    const result = await runCompanionEvalGenerated(async (scenario) => {
      ids.push(scenario.id);
      expect(scenario.workspace).toBeTypeOf("object");
      expect(JSON.stringify(scenario.workspace).length).toBeGreaterThan(2);
      return scenario.response;
    });
    expect(ids).toEqual(COMPANION_EVAL_SCENARIOS.map((scenario) => scenario.id));
    expect(result.failed, result.failed.map((item) => item.id).join(", ")).toEqual([]);
  });

  it("packs projects, spaces and overflow into the workspace", async () => {
    const repository = new InMemoryRepository();
    const user = await repository.upsertTelegramUser({ telegram_id: 90, name: "A" });
    // Портрет собирается только из сказанного человеком (био, ценности, память)
    // и из сильных сторон; у пустого аккаунта он честно пустой, а просрочка и
    // бэклог идут отдельно в patterns.
    await repository.updateProfile(user.id, { bio: "Продакт, двое детей" });
    const goal = await repository.createGoal(user.id, { title: "Запустить лендинг" });
    await repository.createProject(user.id, { name: "Редизайн", goal_id: goal.id });
    await repository.createSpace(user.id, { name: "Работа", type: "work" });
    for (let i = 0; i < 25; i++) {
      await repository.createTask(user.id, {
        title: `Task ${i}`,
        due_at: i < 4 ? "2020-01-01T12:00:00.000Z" : null,
      });
    }
    const context = await new PersonalContextBuilder(repository).build(user.id, "редизайн работа");
    expect(context.tasks.length).toBe(PersonalContextBuilder.limits.tasks);
    expect(context.overflow.extra_tasks).toBeGreaterThan(0);
    expect(context.overflow.extra_overdue).toBeGreaterThan(0);
    const workspace = toCompanionWorkspace(context);
    expect(workspace.projects.some((item) => item.name === "Редизайн")).toBe(true);
    expect(workspace.spaces.some((item) => item.name === "Работа")).toBe(true);
    expect(workspace.overflow.extra_tasks).toBe(context.overflow.extra_tasks);
    expect(workspace.self.portrait).toContain("Продакт");
    expect(workspace.self.patterns.some((item) => item.kind === "overdue_cluster")).toBe(true);
    expect(workspace.self.patterns.some((item) => item.kind === "undated_backlog")).toBe(true);
  });
});
