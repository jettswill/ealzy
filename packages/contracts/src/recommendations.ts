import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema } from "./common.js";
import { contextReferenceSchema } from "./companion.js";

export const RECOMMENDATION_FEEDBACK_OUTCOMES = ["liked", "disliked", "used"] as const;

export const recommendationFeedbackOutcomeSchema = z.enum(RECOMMENDATION_FEEDBACK_OUTCOMES);
export const recommendationContextReferenceSchema = contextReferenceSchema;

export const recommendationItemSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    rationale: z.string().trim().min(1).max(4000),
    url: z.url().nullable().optional(),
    memory_ids: z.array(entityIdSchema).default([]),
    context_references: z.array(recommendationContextReferenceSchema).default([]),
    is_generic: z.boolean().default(false),
  })
  .strict();

export const recommendationSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    person_id: entityIdSchema.nullable(),
    space_id: entityIdSchema.nullable(),
    task_id: entityIdSchema.nullable(),
    query: z.string().trim().min(1).max(4000),
    items: z.array(recommendationItemSchema).min(1).max(20),
    memory_ids: z.array(entityIdSchema),
    context_references: z.array(recommendationContextReferenceSchema).default([]),
    created_at: isoDateTimeSchema,
  })
  .strict();

export const recommendationFeedbackSchema = z
  .object({
    id: entityIdSchema,
    recommendation_id: entityIdSchema,
    owner_id: entityIdSchema,
    item_index: z.number().int().nonnegative(),
    outcome: recommendationFeedbackOutcomeSchema,
    note: z.string().trim().max(2000).nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const createRecommendationFeedbackSchema = z
  .object({
    item_index: z.number().int().nonnegative(),
    outcome: recommendationFeedbackOutcomeSchema,
    note: z.string().trim().max(2000).nullable().default(null),
  })
  .strict();

export type RecommendationItem = z.output<typeof recommendationItemSchema>;
export type Recommendation = z.output<typeof recommendationSchema>;
export type RecommendationContextReference = z.infer<typeof recommendationContextReferenceSchema>;
export type RecommendationFeedbackOutcome = z.infer<typeof recommendationFeedbackOutcomeSchema>;
export type RecommendationFeedback = z.infer<typeof recommendationFeedbackSchema>;
export type CreateRecommendationFeedbackInput = z.input<typeof createRecommendationFeedbackSchema>;
