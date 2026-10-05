import { z } from "zod";
import { entityIdSchema, isoDateSchema, isoDateTimeSchema, metadataSchema } from "./common.js";

export const reflectionEntrySchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    detail: z.string().trim().min(1).max(4000),
    source_ids: z.array(entityIdSchema),
  })
  .strict();

export const reflectionSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    period_start: isoDateSchema,
    period_end: isoDateSchema,
    wins: z.array(reflectionEntrySchema),
    improvements: z.array(reflectionEntrySchema),
    next_steps: z.array(reflectionEntrySchema),
    source_snapshot: metadataSchema,
    created_at: isoDateTimeSchema,
  })
  .strict()
  .refine((value) => value.period_start <= value.period_end, {
    message: "period_start must be on or before period_end",
    path: ["period_end"],
  });

export const createWeeklyReflectionSchema = z
  .object({
    period_start: isoDateSchema.optional(),
    period_end: isoDateSchema.optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.period_start === undefined ||
      value.period_end === undefined ||
      value.period_start <= value.period_end,
    {
      message: "period_start must be on or before period_end",
      path: ["period_end"],
    },
  );

export type ReflectionEntry = z.infer<typeof reflectionEntrySchema>;
export type Reflection = z.infer<typeof reflectionSchema>;
export type CreateWeeklyReflectionInput = z.infer<typeof createWeeklyReflectionSchema>;
