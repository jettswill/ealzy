import { OpenAiProvider } from "../src/infrastructure/openai.js";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.zveno.ai/v1";
const model = process.env.OPENAI_MODEL ?? "openai/gpt-4o-mini";

if (!apiKey) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const companionModel = process.env.OPENAI_COMPANION_MODEL || undefined;
const ai = new OpenAiProvider(apiKey, model, baseURL, undefined, companionModel);

const cases = [
  {
    name: "decide (remember)",
    run: () => ai.decide("Запомни: Маша любит походы"),
    check: (r: { intent?: string; person_query?: string | null; content?: string | null }) =>
      r.intent === "remember" && Boolean(r.person_query) && Boolean(r.content),
  },
  {
    name: "decide (recommend)",
    run: () => ai.decide("Куда сходить с Машей?"),
    check: (r: { intent?: string }) => r.intent === "recommend",
  },
  {
    name: "recommend",
    run: () =>
      ai.recommend("Куда сходить с Машей?", { name: "Маша" }, [
        { id: "mem-1", content: "любит походы", category: "interest" },
      ]),
    check: (r: unknown) =>
      Array.isArray(r) && r.length >= 3 && typeof (r[0] as { title?: string }).title === "string",
  },
  {
    name: "companion",
    run: () =>
      ai.companion("Что сделать сегодня вечером?", {
        goals: [],
        tasks: [],
        memories: [],
      }),
    check: (r: { answer?: string }) => typeof r.answer === "string" && r.answer.length > 0,
  },
  {
    name: "extractExperience",
    run: () =>
      ai.extractExperience(
        "Вчера были с Машей в ресторане X, понравилась атмосфера",
        "2026-07-09T12:00:00Z",
      ),
    check: (r: unknown) => Boolean(r && typeof r === "object" && "experience" in r),
  },
  {
    name: "reflect",
    run: () =>
      ai.reflect({
        week: "2026-W28",
        tasks_completed: 2,
        goals: [],
        experiences: [],
      }),
    check: (r: { wins?: unknown[]; next_steps?: unknown[] }) =>
      Array.isArray(r.wins) && Array.isArray(r.next_steps),
  },
];

console.log(`Provider: ${baseURL} / ${model} (companion: ${companionModel ?? model})\n`);

let passed = 0;
for (const testCase of cases) {
  try {
    const result = await testCase.run();
    if (!testCase.check(result as never)) {
      console.log(`FAIL ${testCase.name}:`, JSON.stringify(result).slice(0, 400));
      continue;
    }
    passed++;
    console.log(`OK   ${testCase.name}`);
    console.log(`     ${JSON.stringify(result).slice(0, 200)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL ${testCase.name}: ${message}\n`);
  }
}

console.log(`\nResult: ${passed}/${cases.length} passed`);
process.exit(passed === cases.length ? 0 : 1);
