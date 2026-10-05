import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema, nonEmptyPatchSchema } from "./common.js";
import { memoryCategorySchema, memoryConfidenceSchema } from "./memory.js";

export const EXPERIENCE_TYPES = [
  "restaurant",
  "theater",
  "trip",
  "event",
  "gift",
  "activity",
  "other",
] as const;

export const EXPERIENCE_STATUSES = [
  "recorded",
  "follow_up_pending",
  "followed_up",
  "archived",
] as const;

export const EXPERIENCE_FOLLOW_UP_STATUSES = ["pending", "completed", "dismissed"] as const;

export const experienceTypeSchema = z.enum(EXPERIENCE_TYPES);
export const experienceStatusSchema = z.enum(EXPERIENCE_STATUSES);
export const experienceFollowUpStatusSchema = z.enum(EXPERIENCE_FOLLOW_UP_STATUSES);

export const experiencePreferenceUpdateSchema = z
  .object({
    person_id: entityIdSchema,
    category: memoryCategorySchema,
    content: z.string().trim().min(1).max(4000),
    confidence: memoryConfidenceSchema,
  })
  .strict();

const experienceWriteShape = {
  type: experienceTypeSchema,
  title: z.string().trim().min(1).max(300),
  place: z.string().trim().max(500).nullable(),
  description: z.string().trim().max(4000).nullable(),
  occurred_at: isoDateTimeSchema,
  participants: z.array(entityIdSchema).max(100),
  positive_signals: z.array(z.string().trim().min(1).max(500)).max(100),
  negative_signals: z.array(z.string().trim().min(1).max(500)).max(100),
  emotions: z.array(z.string().trim().min(1).max(120)).max(50),
  outcome: z.string().trim().max(4000).nullable(),
  source_message_id: entityIdSchema.nullable(),
  planned_task_id: entityIdSchema.nullable(),
  space_id: entityIdSchema.nullable(),
  follow_up_at: isoDateTimeSchema.nullable(),
  status: experienceStatusSchema,
  preference_updates: z.array(experiencePreferenceUpdateSchema).max(100),
};

export const experienceSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    ...experienceWriteShape,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const createExperienceSchema = z
  .object({
    ...experienceWriteShape,
    place: experienceWriteShape.place.default(null),
    description: experienceWriteShape.description.default(null),
    participants: experienceWriteShape.participants.default([]),
    positive_signals: experienceWriteShape.positive_signals.default([]),
    negative_signals: experienceWriteShape.negative_signals.default([]),
    emotions: experienceWriteShape.emotions.default([]),
    outcome: experienceWriteShape.outcome.default(null),
    source_message_id: experienceWriteShape.source_message_id.default(null),
    planned_task_id: experienceWriteShape.planned_task_id.default(null),
    space_id: experienceWriteShape.space_id.default(null),
    follow_up_at: experienceWriteShape.follow_up_at.default(null),
    status: experienceStatusSchema.default("recorded"),
    preference_updates: experienceWriteShape.preference_updates.default([]),
  })
  .strict();

export const updateExperienceSchema = nonEmptyPatchSchema(experienceWriteShape);

export const experienceListFiltersSchema = z
  .object({
    type: experienceTypeSchema.optional(),
    status: experienceStatusSchema.optional(),
    participant_id: entityIdSchema.optional(),
    occurred_from: isoDateTimeSchema.optional(),
    occurred_to: isoDateTimeSchema.optional(),
    follow_up_before: isoDateTimeSchema.optional(),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.occurred_from === undefined ||
      value.occurred_to === undefined ||
      value.occurred_from <= value.occurred_to,
    {
      message: "occurred_from must be on or before occurred_to",
      path: ["occurred_to"],
    },
  );

export const experienceFollowUpSchema = z
  .object({
    experience_id: entityIdSchema,
    follow_up_at: isoDateTimeSchema.nullable(),
    status: experienceFollowUpStatusSchema,
    note: z.string().trim().max(2000).nullable(),
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const updateExperienceFollowUpSchema = nonEmptyPatchSchema({
  follow_up_at: isoDateTimeSchema.nullable(),
  status: experienceFollowUpStatusSchema,
  note: z.string().trim().max(2000).nullable(),
});

export type ExperienceType = z.infer<typeof experienceTypeSchema>;
export type ExperienceStatus = z.infer<typeof experienceStatusSchema>;
export type ExperienceFollowUpStatus = z.infer<typeof experienceFollowUpStatusSchema>;
export type ExperiencePreferenceUpdate = z.infer<typeof experiencePreferenceUpdateSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type CreateExperienceInput = z.input<typeof createExperienceSchema>;
export type NormalizedCreateExperienceInput = z.output<typeof createExperienceSchema>;
export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>;
export type ExperienceListFilters = z.input<typeof experienceListFiltersSchema>;
export type NormalizedExperienceListFilters = z.output<typeof experienceListFiltersSchema>;
export type ExperienceFollowUp = z.infer<typeof experienceFollowUpSchema>;
export type UpdateExperienceFollowUpInput = z.infer<typeof updateExperienceFollowUpSchema>;
