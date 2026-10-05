import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema } from "./common.js";
import { conversationSchema, messageSchema, messageSourceChannelSchema } from "./conversations.js";
import { experienceStatusSchema, experienceTypeSchema } from "./experiences.js";
import { memoryCategorySchema, memoryConfidenceSchema, memoryImportanceSchema } from "./memory.js";
import {
  goalHorizonSchema,
  goalPrioritySchema,
  goalStatusSchema,
  projectStatusSchema,
} from "./planning.js";

export const CONTEXT_ENTITY_KINDS = [
  "memory",
  "person",
  "goal",
  "project",
  "task",
  "space",
  "message",
  "recommendation",
  "experience",
] as const;

export const contextEntityKindSchema = z.enum(CONTEXT_ENTITY_KINDS);

export const contextReferenceSchema = z
  .object({
    kind: contextEntityKindSchema,
    id: entityIdSchema,
  })
  .strict();

export const contextMemorySummarySchema = z
  .object({
    id: entityIdSchema,
    person_id: entityIdSchema,
    content: z.string().trim().min(1).max(4000),
    category: memoryCategorySchema,
    importance: memoryImportanceSchema,
    confidence: memoryConfidenceSchema,
  })
  .strict();

export const contextGoalSummarySchema = z
  .object({
    id: entityIdSchema,
    title: z.string().trim().min(1).max(300),
    status: goalStatusSchema,
    horizon: goalHorizonSchema,
    priority: goalPrioritySchema,
  })
  .strict();

export const contextProjectSummarySchema = z
  .object({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(300),
    status: projectStatusSchema,
    goal_id: entityIdSchema.nullable(),
  })
  .strict();

export const contextPersonSummarySchema = z
  .object({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().max(120).nullable(),
    memory_ids: z.array(entityIdSchema),
  })
  .strict();

export const contextExperienceSummarySchema = z
  .object({
    id: entityIdSchema,
    type: experienceTypeSchema,
    title: z.string().trim().min(1).max(300),
    occurred_at: isoDateTimeSchema,
    participants: z.array(entityIdSchema),
    outcome: z.string().trim().max(4000).nullable(),
    status: experienceStatusSchema,
  })
  .strict();

export const recommendationOutcomeSummarySchema = z
  .object({
    recommendation_id: entityIdSchema,
    item_index: z.number().int().nonnegative(),
    outcome: z.enum(["liked", "disliked", "used"]),
    note: z.string().trim().max(2000).nullable(),
  })
  .strict();

export const personalContextSummarySchema = z
  .object({
    generated_at: isoDateTimeSchema,
    profile: z
      .object({
        bio: z.string().trim().max(4000).nullable(),
        values: z.array(z.string().trim().min(1).max(120)),
        communication_style: z.string().trim().max(1000).nullable(),
        timezone: z.string().trim().min(1).max(100),
        locale: z.string().trim().min(2).max(35),
        context_summary: z.string().trim().max(10000).nullable(),
      })
      .strict()
      .nullable(),
    self_memories: z.array(contextMemorySummarySchema),
    goals: z.array(contextGoalSummarySchema),
    projects: z.array(contextProjectSummarySchema),
    related_people: z.array(contextPersonSummarySchema),
    experiences: z.array(contextExperienceSummarySchema),
    recent_message_ids: z.array(entityIdSchema),
    recommendation_outcomes: z.array(recommendationOutcomeSummarySchema),
  })
  .strict();

export const companionRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(10000),
    conversation_id: entityIdSchema.optional(),
    source_channel: messageSourceChannelSchema.exclude(["system"]).default("mini_app"),
  })
  .strict();

export const companionResponseSchema = z
  .object({
    conversation: conversationSchema,
    message: messageSchema,
    context_summary: personalContextSummarySchema,
    context_references: z.array(contextReferenceSchema),
  })
  .strict();

export type ContextEntityKind = z.infer<typeof contextEntityKindSchema>;
export type ContextReference = z.infer<typeof contextReferenceSchema>;
export type PersonalContextSummary = z.infer<typeof personalContextSummarySchema>;
export type CompanionRequest = z.input<typeof companionRequestSchema>;
export type NormalizedCompanionRequest = z.output<typeof companionRequestSchema>;
export type CompanionResponse = z.infer<typeof companionResponseSchema>;
