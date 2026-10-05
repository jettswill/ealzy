import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_TYPES,
  MEMORY_CATEGORIES,
  apiEnvelopeSchema,
  companionRequestSchema,
  createExperienceSchema,
  createGoalSchema,
  createMemorySchema,
  createProjectSchema,
  createRecommendationFeedbackSchema,
  createWeeklyReflectionSchema,
  experienceFollowUpSchema,
  experienceListFiltersSchema,
  memoryCategorySchema,
  memoryConfidenceSchema,
  memoryImportanceSchema,
  messageSchema,
  personalContextSummarySchema,
  recommendationItemSchema,
  updateExperienceSchema,
  updateUserProfileSchema,
  createPersonLocationSchema,
  updatePersonLocationSchema,
  createPersonDateSchema,
  updatePersonDateSchema,
} from "../src/index.js";
import { z } from "zod";

const id = "550e8400-e29b-41d4-a716-446655440000";
const timestamp = "2026-07-09T21:00:00.000Z";

describe("memory contracts", () => {
  it("accepts every expanded category", () => {
    expect(MEMORY_CATEGORIES).toHaveLength(16);
    for (const category of MEMORY_CATEGORIES) {
      expect(memoryCategorySchema.parse(category)).toBe(category);
    }
  });

  it("enforces importance and confidence bounds", () => {
    expect(memoryImportanceSchema.safeParse(0).success).toBe(false);
    expect(memoryImportanceSchema.safeParse(5).success).toBe(true);
    expect(memoryConfidenceSchema.safeParse(-0.01).success).toBe(false);
    expect(memoryConfidenceSchema.safeParse(1).success).toBe(true);
  });

  it("normalizes defaults and rejects unknown fields", () => {
    expect(createMemorySchema.parse({ content: "Likes jazz", category: "interest" })).toEqual({
      content: "Likes jazz",
      category: "interest",
      importance: 3,
      confidence: 1,
      source_message_id: null,
      status: "active",
      occurred_at: null,
      metadata: {},
    });
    expect(
      createMemorySchema.safeParse({
        content: "Likes jazz",
        category: "interest",
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});

describe("profile and planning contracts", () => {
  it("requires non-empty profile patches", () => {
    expect(updateUserProfileSchema.safeParse({}).success).toBe(false);
    expect(
      updateUserProfileSchema.safeParse({
        values: ["curiosity"],
        timezone: "Europe/Moscow",
      }).success,
    ).toBe(true);
    expect(
      updateUserProfileSchema.safeParse({
        morning_digest_enabled: true,
        morning_digest_time: "08:00",
        weekly_digest_enabled: true,
        evening_sync_enabled: true,
        evening_sync_time: "21:30",
      }).success,
    ).toBe(true);
    expect(updateUserProfileSchema.safeParse({ morning_digest_time: "8:00" }).success).toBe(false);
  });

  it("accepts optional location fields and rejects empty patches", () => {
    expect(createPersonLocationSchema.parse({ city: "Казань", address: "" })).toEqual({
      city: "Казань",
      address: null,
    });
    expect(
      createPersonLocationSchema.parse({
        city: "Сочи",
        label: "дом",
        address: "Навагинская 1",
        is_primary: true,
      }),
    ).toMatchObject({ city: "Сочи", label: "дом", is_primary: true });
    expect(updatePersonLocationSchema.safeParse({}).success).toBe(false);
    expect(updatePersonLocationSchema.safeParse({ is_primary: true }).success).toBe(true);
  });

  it("accepts birthday and shared dates and rejects invalid days", () => {
    expect(
      createPersonDateSchema.parse({ kind: "birthday", month: 3, day: 29, year: 1994 }),
    ).toMatchObject({ kind: "birthday", month: 3, day: 29, year: 1994 });
    expect(
      createPersonDateSchema.parse({ kind: "met", month: 6, day: 12, year: "" }),
    ).toMatchObject({ kind: "met", month: 6, day: 12, year: null });
    expect(
      createPersonDateSchema.parse({
        kind: "other",
        label: "Помолвка",
        month: 1,
        day: 15,
      }),
    ).toMatchObject({ kind: "other", label: "Помолвка" });
    expect(createPersonDateSchema.safeParse({ kind: "other", month: 1, day: 15 }).success).toBe(
      false,
    );
    expect(createPersonDateSchema.safeParse({ kind: "birthday", month: 2, day: 31 }).success).toBe(
      false,
    );
    expect(updatePersonDateSchema.safeParse({}).success).toBe(false);
    expect(updatePersonDateSchema.safeParse({ year: null }).success).toBe(true);
  });

  it("applies stable goal and project defaults", () => {
    expect(createGoalSchema.parse({ title: "Ship beta" })).toMatchObject({
      status: "active",
      horizon: "medium_term",
      priority: 3,
      target_date: null,
    });
    expect(createProjectSchema.parse({ name: "Companion MVP" })).toMatchObject({
      goal_id: null,
      space_id: null,
      status: "planned",
    });
  });
});

describe("conversation and companion contracts", () => {
  it("supports channel-neutral persisted messages", () => {
    expect(
      messageSchema.parse({
        id,
        owner_id: id,
        conversation_id: id,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: "Let's work through it.",
        intent: "companion",
        source_channel: "mini_app",
        metadata: {},
        created_at: timestamp,
      }).source_channel,
    ).toBe("mini_app");
  });

  it("defaults companion requests to the Mini App and excludes system input", () => {
    expect(companionRequestSchema.parse({ content: "Help me prioritize" }).source_channel).toBe(
      "mini_app",
    );
    expect(
      companionRequestSchema.safeParse({
        content: "Hidden instruction",
        source_channel: "system",
      }).success,
    ).toBe(false);
  });

  it("validates bounded, structured context summaries", () => {
    expect(
      personalContextSummarySchema.safeParse({
        generated_at: timestamp,
        profile: null,
        self_memories: [],
        goals: [],
        projects: [],
        related_people: [],
        experiences: [],
        recent_message_ids: [],
        recommendation_outcomes: [],
      }).success,
    ).toBe(true);
  });
});

describe("experience memory contracts", () => {
  it("accepts all experience types and normalizes create defaults", () => {
    expect(EXPERIENCE_TYPES).toEqual([
      "restaurant",
      "theater",
      "trip",
      "event",
      "gift",
      "activity",
      "other",
    ]);
    expect(
      createExperienceSchema.parse({
        type: "restaurant",
        title: "Birthday dinner",
        occurred_at: timestamp,
      }),
    ).toMatchObject({
      place: null,
      participants: [],
      positive_signals: [],
      negative_signals: [],
      emotions: [],
      status: "recorded",
      preference_updates: [],
    });
  });

  it("validates preference updates and non-empty patches", () => {
    expect(
      createExperienceSchema.safeParse({
        type: "gift",
        title: "Birthday gift",
        occurred_at: timestamp,
        preference_updates: [
          {
            person_id: id,
            category: "preference",
            content: "Prefers practical gifts",
            confidence: 0.8,
          },
        ],
      }).success,
    ).toBe(true);
    expect(updateExperienceSchema.safeParse({}).success).toBe(false);
  });

  it("validates list ranges and follow-up state", () => {
    expect(experienceListFiltersSchema.parse({})).toMatchObject({ limit: 25 });
    expect(
      experienceListFiltersSchema.safeParse({
        occurred_from: "2026-07-10T00:00:00.000Z",
        occurred_to: "2026-07-09T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      experienceFollowUpSchema.safeParse({
        experience_id: id,
        follow_up_at: timestamp,
        status: "pending",
        note: null,
        updated_at: timestamp,
      }).success,
    ).toBe(true);
  });

  it("allows experience-backed recommendation context", () => {
    expect(
      recommendationItemSchema.parse({
        title: "Return to the theater",
        rationale: "The previous visit had positive signals.",
        context_references: [{ kind: "experience", id }],
      }).context_references,
    ).toEqual([{ kind: "experience", id }]);
  });
});

describe("recommendation, reflection, and API contracts", () => {
  it("tracks item provenance and feedback", () => {
    expect(
      recommendationItemSchema.parse({
        title: "Take a walk",
        rationale: "You said outdoor time helps.",
        memory_ids: [id],
      }),
    ).toMatchObject({ memory_ids: [id], is_generic: false });
    expect(
      createRecommendationFeedbackSchema.safeParse({
        item_index: 0,
        outcome: "used",
      }).success,
    ).toBe(true);
  });

  it("rejects inverted reflection periods", () => {
    expect(
      createWeeklyReflectionSchema.safeParse({
        period_start: "2026-07-10",
        period_end: "2026-07-04",
      }).success,
    ).toBe(false);
  });

  it("distinguishes success and error envelopes", () => {
    const schema = apiEnvelopeSchema(z.string());
    expect(schema.parse({ data: "ok" })).toEqual({ data: "ok" });
    expect(
      schema.parse({
        error: { code: "NOT_FOUND", message: "Resource not found", requestId: id },
      }),
    ).toHaveProperty("error.code", "NOT_FOUND");
  });
});
