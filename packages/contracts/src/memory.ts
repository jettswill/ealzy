import { z } from "zod";
import {
  entityIdSchema,
  isoDateTimeSchema,
  metadataSchema,
  nonEmptyPatchSchema,
} from "./common.js";

export const MEMORY_CATEGORIES = [
  "interest",
  "dislike",
  "favorite_place",
  "favorite_food",
  "gift",
  "size",
  "dream",
  "important_date",
  "story",
  "personality",
  "experience",
  "preference",
  "skill",
  "important_event",
  "important_fact",
  "other",
] as const;

export const MEMORY_IMPORTANCE_MIN = 1;
export const MEMORY_IMPORTANCE_MAX = 5;
export const MEMORY_IMPORTANCE_DEFAULT = 3;
export const MEMORY_CONFIDENCE_MIN = 0;
export const MEMORY_CONFIDENCE_MAX = 1;
export const MEMORY_CONFIDENCE_DEFAULT = 1;

export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES);
export const memoryImportanceSchema = z
  .number()
  .int()
  .min(MEMORY_IMPORTANCE_MIN)
  .max(MEMORY_IMPORTANCE_MAX);
export const memoryConfidenceSchema = z
  .number()
  .min(MEMORY_CONFIDENCE_MIN)
  .max(MEMORY_CONFIDENCE_MAX);
export const memoryStatusSchema = z.enum(["active", "archived"]);

export const memorySchema = z
  .object({
    id: entityIdSchema,
    person_id: entityIdSchema,
    content: z.string().trim().min(1).max(4000),
    category: memoryCategorySchema,
    importance: memoryImportanceSchema,
    confidence: memoryConfidenceSchema,
    source_message_id: entityIdSchema.nullable(),
    status: memoryStatusSchema,
    occurred_at: isoDateTimeSchema.nullable(),
    metadata: metadataSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

const memoryWriteShape = {
  content: z.string().trim().min(1).max(4000),
  category: memoryCategorySchema,
  importance: memoryImportanceSchema,
  confidence: memoryConfidenceSchema,
  source_message_id: entityIdSchema.nullable(),
  status: memoryStatusSchema,
  occurred_at: isoDateTimeSchema.nullable(),
  metadata: metadataSchema,
};

export const createMemorySchema = z
  .object({
    ...memoryWriteShape,
    importance: memoryImportanceSchema.default(MEMORY_IMPORTANCE_DEFAULT),
    confidence: memoryConfidenceSchema.default(MEMORY_CONFIDENCE_DEFAULT),
    source_message_id: entityIdSchema.nullable().default(null),
    status: memoryStatusSchema.default("active"),
    occurred_at: isoDateTimeSchema.nullable().default(null),
    metadata: metadataSchema.default({}),
  })
  .strict();

export const updateMemorySchema = nonEmptyPatchSchema(memoryWriteShape);

export type MemoryCategory = z.infer<typeof memoryCategorySchema>;
export type MemoryImportance = z.infer<typeof memoryImportanceSchema>;
export type MemoryConfidence = z.infer<typeof memoryConfidenceSchema>;
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;
export type Memory = z.infer<typeof memorySchema>;
export type CreateMemoryInput = z.input<typeof createMemorySchema>;
export type NormalizedCreateMemoryInput = z.output<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
