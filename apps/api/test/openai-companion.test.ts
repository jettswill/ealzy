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
