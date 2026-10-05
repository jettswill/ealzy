import { z } from "zod";
import { entityIdSchema, isoDateSchema, isoDateTimeSchema, nonEmptyPatchSchema } from "./common.js";

export const SCHEDULED_NOTIFICATION_KINDS = [
  "morning_digest",
  "weekly_digest",
  "evening_sync",
] as const;
export const notificationTimeSchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use HH:MM in 24-hour time");

export const userProfileSchema = z
  .object({
    owner_id: entityIdSchema,
    self_person_id: entityIdSchema,
    bio: z.string().trim().max(4000).nullable(),
    values: z.array(z.string().trim().min(1).max(120)).max(50),
    communication_style: z.string().trim().max(1000).nullable(),
    timezone: z.string().trim().min(1).max(100),
    locale: z.string().trim().min(2).max(35),
    context_summary: z.string().trim().max(10000).nullable(),
    weekly_reflection_enabled: z.boolean(),
    morning_digest_enabled: z.boolean(),
    morning_digest_time: notificationTimeSchema,
    weekly_digest_enabled: z.boolean(),
    weekly_digest_time: notificationTimeSchema,
    evening_sync_enabled: z.boolean(),
    evening_sync_time: notificationTimeSchema,
    last_morning_digest_on: isoDateSchema.nullable(),
    last_weekly_digest_on: isoDateSchema.nullable(),
    last_evening_sync_on: isoDateSchema.nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

const editableUserProfileShape = {
  bio: z.string().trim().max(4000).nullable(),
  values: z.array(z.string().trim().min(1).max(120)).max(50),
  communication_style: z.string().trim().max(1000).nullable(),
  timezone: z.string().trim().min(1).max(100),
  locale: z.string().trim().min(2).max(35),
  weekly_reflection_enabled: z.boolean(),
  morning_digest_enabled: z.boolean(),
  morning_digest_time: notificationTimeSchema,
  weekly_digest_enabled: z.boolean(),
  weekly_digest_time: notificationTimeSchema,
  evening_sync_enabled: z.boolean(),
  evening_sync_time: notificationTimeSchema,
  onboarding_completed_at: isoDateTimeSchema.nullable(),
};

export const updateUserProfileSchema = nonEmptyPatchSchema(editableUserProfileShape);

export type UserProfile = z.infer<typeof userProfileSchema>;
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
