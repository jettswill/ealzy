import { describe, expect, it } from "vitest";
import {
  COMPANION_AI_MAX_TOKENS,
  COMPANION_AI_TEMPERATURE,
  COMPANION_AI_TIMEOUT_MS,
  COMPANION_CONVERSATION_CHARS,
  COMPANION_CONVERSATION_TURNS,
  chatCompletionControls,
  companionPayload,
  compactCompanionWorkspace,
  OpenAiProvider,
} from "../src/infrastructure/openai.js";

describe("fast companion packing", () => {
  it("keeps the model call interactive while allowing a complete reply", () => {
    expect(COMPANION_AI_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
    expect(COMPANION_AI_MAX_TOKENS).toBeLessThanOrEqual(2_000);
    expect(COMPANION_AI_TEMPERATURE).toBeGreaterThan(0);
  });

  it("uses sampling on GPT-4.1 and skips temperature on GPT-5", () => {
    expect(
      chatCompletionControls("openai/gpt-4.1", {
        maxTokens: 1_800,
        temperature: 0.6,
      }),
    ).toEqual({
      temperature: 0.6,
      max_tokens: 1_800,
    });
    expect(chatCompletionControls("openai/gpt-5-mini", { maxTokens: 900 })).toEqual({
      reasoning_effort: "none",
      max_completion_tokens: 900,
    });
    expect(chatCompletionControls("openai/gpt-4o-mini", { maxTokens: 360 })).toEqual({
      temperature: 0,
      max_tokens: 360,
    });
  });

  it("drops duplicate capability text and empty mail from the model payload", () => {
    const packed = compactCompanionWorkspace({
      capabilities: ["tasks: create a task"],
      tasks: [{ title: "Купить молоко" }],
      discovery_results: [],
      mail: { accounts: [], important: [], meetings: [], drafts: [], playbooks: [] },
    });
    expect(packed).toEqual({ tasks: [{ title: "Купить молоко" }] });
  });

  it("keeps the last conversation turns with enough context", () => {
    const packed = companionPayload({
      workspace: { capabilities: ["web"], tasks: [] },
      conversation: Array.from({ length: 16 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `turn ${index} ${"x".repeat(1_400)}`,
      })),
    });
    expect(packed.conversation).toHaveLength(COMPANION_CONVERSATION_TURNS);
    expect(packed.conversation[0]?.content.length).toBeLessThanOrEqual(COMPANION_CONVERSATION_CHARS + 1);
    expect(packed.workspace).toEqual({ tasks: [] });
  });
});

describe("companion model", () => {
  const reply = (text: string) => ({
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: JSON.stringify({ answer: text }) } }] };
    },
  });
  function providerWith(create: (body: { model: string }) => unknown, companionModel?: string) {
    const provider = new OpenAiProvider(
      "key",
      "openai/gpt-4.1",
      "https://example.com/v1",
      undefined,
      companionModel,
    );
    const calls: Record<string, unknown>[] = [];
    (provider as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: async (body: { model: string }) => {
            calls.push(body);
            return create(body);
          },
        },
      },
    };
    return { provider, calls };
  }

  it("talks on the companion model with that model's own controls", async () => {
    const { provider, calls } = providerWith(() => reply("Привет"), "openai/gpt-6.1-sol");
    await expect(provider.companion("Привет", {})).resolves.toEqual({ answer: "Привет" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "openai/gpt-6.1-sol",
      // gpt-6 у шлюза не принимает «none»: без этого чат уходил на запасную модель.
      reasoning_effort: "minimal",
      max_completion_tokens: COMPANION_AI_MAX_TOKENS,
    });
    expect(calls[0]).not.toHaveProperty("temperature");
  });

  it("stays on the base model when no companion model is set", async () => {
    const { provider, calls } = providerWith(() => reply("Привет"));
    await provider.companion("Привет", {});
    expect(calls.map((call) => call.model)).toEqual(["openai/gpt-4.1"]);
    expect(calls[0]).toMatchObject({ temperature: COMPANION_AI_TEMPERATURE });
  });

  it("answers on the base model when the companion model rejects the request", async () => {
    const { provider, calls } = providerWith((body) => {
      if (body.model === "openai/gpt-6.1-sol") throw new Error("404 model not found");
      return reply("Отвечаю запасной моделью");
    }, "openai/gpt-6.1-sol");
    await expect(provider.companion("Привет", {})).resolves.toEqual({
      answer: "Отвечаю запасной моделью",
    });
    expect(calls.map((call) => call.model)).toEqual(["openai/gpt-6.1-sol", "openai/gpt-4.1"]);
  });

  it("does not swap models once the answer has started streaming", async () => {
    const { provider, calls } = providerWith(
      () => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: '{"answer":"Начала отвечать' } }] };
          throw new Error("stream broke");
        },
      }),
      "openai/gpt-6.1-sol",
    );
    const seen: string[] = [];
    await expect(
      provider.companionStream("Привет", {}, (answer) => seen.push(answer)),
    ).rejects.toThrow("stream broke");
    expect(seen.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });
});
