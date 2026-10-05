import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAiProvider } from "../src/infrastructure/openai.js";
import { omitAgendaMutations, omitEalzyQueueMutations, omitUnsolicitedPromiseCaptures } from "../src/modules/assistant/companion.js";
import {
  COMPANION_EVAL_SCENARIOS,
  parseCompanionEvalResponse,
  runCompanionEvalGenerated,
} from "../src/modules/assistant/companion-eval.js";

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  override: true,
});

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is required for live companion eval");
  process.exit(1);
}

const ai = new OpenAiProvider(
  apiKey,
  process.env.OPENAI_MODEL ?? "openai/gpt-4o-mini",
  process.env.OPENAI_BASE_URL ?? "https://api.zveno.ai/v1",
);

const result = await runCompanionEvalGenerated(
  async (scenario) => {
    process.stderr.write(`eval ${scenario.id}…\n`);
    const raw = await ai.companion(scenario.query, { workspace: scenario.workspace });
    const parsed = parseCompanionEvalResponse(raw);
    const tasks = Array.isArray(scenario.workspace.tasks)
      ? (scenario.workspace.tasks as { id?: string; title?: string; assignee?: string }[])
      : [];
    const promises = Array.isArray(scenario.workspace.promises)
      ? (scenario.workspace.promises as { last_checkin_status?: string | null }[])
      : [];
    return {
      ...parsed,
      task_actions: omitAgendaMutations(
        omitUnsolicitedPromiseCaptures(
          omitEalzyQueueMutations(parsed.task_actions ?? [], tasks),
          scenario.query,
          promises,
        ),
        scenario.query,
      ),
    };
  },
  { mode: "live" },
);

for (const scenario of result.scenarios) {
  const status = scenario.failed.length ? "FAIL" : "ok";
  console.log(`\n[${status}] ${scenario.id} — ${scenario.title}`);
  console.log(scenario.answer.slice(0, 280));
  if (scenario.failed.length) {
    console.log(`  task_ops=${scenario.task_ops.join(",") || "∅"} goal_ops=${scenario.goal_ops.join(",") || "∅"}`);
    console.log(scenario.failed.map((item) => `  - ${item.id}`).join("\n"));
  }
}

console.log(
  JSON.stringify(
    {
      scenarios: result.scenarioCount,
      expected: COMPANION_EVAL_SCENARIOS.length,
      passed: result.passed,
      total: result.total,
      failed: result.failed.map((item) => item.id),
    },
    null,
    2,
  ),
);

if (result.scenarioCount !== COMPANION_EVAL_SCENARIOS.length) process.exit(1);
if (result.failed.length) process.exit(1);
